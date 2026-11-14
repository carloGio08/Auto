# Mountain Drop — Architecture

This document is the technical plan of the game: how modules are organised, how data flows
between them, and the maths behind the mountain, the trails, the jeep physics and the
destructible trees.

Mountain Drop is a free-roam descent: one huge low-poly mountain (8 × 8 km, ~1600 m of drop),
a 4x4 jeep at the snowy summit and the base village by the lake as the only goal. There is no
timer and no checkpoint: the trail network is carved into the terrain and can be left anywhere.

## 1. Module map

```
                    ┌──────────────────────────── main.ts ────────────────────────────┐
                    │ builds GameContext, registers states, starts the Loop           │
                    └──────────────────────────────────┬──────────────────────────────┘
                                                       │
   ┌──────────────────────────────── GameContext (core/context.ts) ───────────────────────────┐
   │ renderer · view (scene+camera to draw) · input · audio · save · events · i18n · config   │
   │ ui (overlay root + screen stack) · device · registries (data/)                           │
   └───────┬──────────────────┬──────────────────────┬───────────────────────┬────────────────┘
           │                  │                      │                       │
   core/stateMachine     input/ (actions)       audio/ (mixer)          data/ (registries)
   Boot → MainMenu → Garage / TrackSelect → Loading → Playing ⇄ Paused → Results → MainMenu
           │
           ▼  Loading builds a RunSession; Playing drives it
   ┌──────────────────────────── game/session.ts (RunSession) ─────────────────────────────┐
   │ Course (terrain/course.ts): Mountain + routed trails (Road) + carved Terrain + placement│
   │ World: quadtree terrain mesh, streamed props, trail furniture, sky, water, weather    │
   │ Vehicle: rigid body + 4 raycast wheels, low-poly jeep model, telemetry                │
   │ CameraRig (chase / wide / hood, free look, fly-over) · Effects (instanced shards)      │
   │ Systems declared by the mode: nitro, style, hazards, collectibles, trees, objectives, │
   │          medals, achievements                                                         │
   │ Safe-spot history + automatic resets · HUD                                            │
   └───────────────────────────────────────────────────────────────────────────────────────┘
```

**Rules**

- No globals or singletons: everything reachable from `GameContext` (app lifetime) or
  `RunSession` (one run). Both are passed explicitly.
- Systems never import each other. They talk via the typed `EventBus` (`core/events.ts`).
- Content (mountains, jeeps, upgrades, surfaces, tree tiers, hazards, palette and themes,
  weather, objectives, achievements) lives in `src/data/` as typed objects. Engine code only
  reads them.
- All tuning numbers are in `src/config.ts` (grouped by area) plus `features` flags.

## 2. Main loop

`core/loop.ts` uses a fixed physics step of **1/120 s** with an accumulator:

```
frameDt = min(now - last, 0.1)
acc += frameDt
while acc >= STEP and steps < MAX_STEPS:
    state.fixedUpdate(STEP)                       // physics + systems' fixed logic
    acc -= STEP
alpha = acc / STEP
state.update(frameDt, alpha)                      // interpolated visuals, camera, HUD
renderer.render(ctx.view.scene, ctx.view.camera)
```

The vehicle keeps `prev` and `curr` snapshots (position, orientation, wheel compression,
steering). Visuals are `lerp(prev, curr, alpha)` / `slerp`, so 60, 90 and 144 Hz screens all
look smooth while the simulation stays deterministic. The hot paths (physics, particles,
debris, camera) reuse pre-allocated scratch objects — no allocations per step.

## 3. Generation pipeline: landforms → heightmap → erosion → trails → colours → props

```
MountainDef (data)                                    terrain worker (terrainWorker.ts)
  profile, landforms, erosion, rivers, trails  ──▶  generateTerrain():
                                                       1. LandformField on a 24 m grid,
                                                          Catmull-Rom upsampled to 12 m
                                                       2. talus limiter + thermal erosion
                                                       3. priority-flood flow routing,
                                                          stream-power incision, floor
                                                          smoothing, thermal again
                                                       4. moisture (flow), rockiness,
                                                          streams traced spring → lake
                                                     routeTrails()  (A* on 24 m grid)
                         CourseData (typed arrays) ◀─┘
  main thread: Course(def, data) → Mountain, Road, Terrain, BiomeModel, placement
  terrain worker keeps the same Course to build terrain patches on request
```

`TerrainService` (app lifetime, in `GameContext`) owns the worker, reports progress to the
loading screen and caches the last results; tests and the fallback run the same code
synchronously. Everything is deterministic from the definition and its seed.

### Landforms (`terrain/landforms.ts`, data in `data/mountains/*.ts`)

The massif is a warped elliptical distance from the summit (per-direction `radii`) through a
monotone cubic **radial profile**; a large-scale noise mixes the stepped profile (terraces and
faces) with an even rounded slope, so terraces come and go around the mountain. Broad noise
adds undulations; ridges rise at the map border. Then each **landform** (ridge, valley,
cirque, plateau, meadow, saddle, slope, hills, basin) is applied in order with smooth min/max
(`smin(a, b, k)`): valleys carve a floor that descends evenly along their path (gorges where
they cross terrace edges), cirques carve a bowl whose back wall is steep only on the uphill
side, plateaus and meadows flatten towards the altitude measured at their centre with a ramp
that widens with the height to absorb (no walls), saddles lower ridges. Each landform also
writes a **rockiness** used for detail amplitude, colours and outcrops.

### Heightmap and erosion (`terrain/generator.ts`, `terrain/erosion.ts`)

- 12 m spacing over ±1.33 × halfSize (≈ 890², 3 MB of `Float32` plus two `Uint8` maps): fits
  phones; the fine detail is analytic.
- **Talus limiter**: two-pass chamfer sweeps cut every cell back to the repose slope
  (rugged cells may stay steeper), then a few **thermal erosion** iterations round the edges
  and build scree aprons.
- **Hydraulic**: priority-flood (Barnes) visits cells from the outlets (lake, border) by
  increasing filled height; each cell drains to the cell that reached it, so depressions stay
  as natural hollows. Flow accumulation in reverse order, implicit **stream-power** incision
  (Braun–Willett) outlet-first, a flow-weighted blur that flattens valley floors.
- Moisture = log of the upstream area, blurred; streams follow the flow graph from their
  springs to the lake and meander where the floor is flat.

`Heightfield.sample()` is a uniform **cubic B-spline** (C², never overshooting: no spikes);
`Mountain.heightNoWater()` adds low-amplitude fbm detail (≈ 0.35 m on meadows, ≈ 2 m on
crags), `height()` carves the lake bed and the stream channels. Tests check the slope mix
(≈ 25 % < 8°, 45 % 8–25°, 25 % 25–38°, < 5 % walls), continuity and bounded curvature on
every mountain.

## 4. Trails carved into the terrain

### Routing (`terrain/trailRouter.ts`)

Trails are data: `TrailDef { waypoints, kind: main | branch | shortcut, width: [min, max],
targetGrade, maxGrade, startOn?, endOn? }`. Between waypoints a **minimum-cost A\*** runs on
a 24 m grid (16-neighbourhood): length × (1 + grade deviation²), ×40 above the limit, a turn
cost growing with the square of the turn (hairpins only where needed), a side-slope factor
(trails prefer terraces, saddles and valley floors over cutting across faces), a stream
crossing cost, and penalties near the lake, the border and existing trails. Dead-end spikes
at waypoints are snipped; the path is simplified (RDP), smoothed (Chaikin = quadratic
B-spline), its bends relaxed to a 12 m radius twice, then resampled every metre with only a
light final smoothing. Main trails: 14–16 km, ~10–11 % average, ≤ 20 % over 20 m.

### Road (`terrain/road.ts`)

All trails share flat arrays (`x, z, y, tx, tz, curvature, halfWidth, offset, bank, rut,
surf, flags, trailOf`). The profile follows the natural ground, low-passed and grade-clamped
(again after junction anchoring, bridges and fords). Width wanders between the def's limits
(4–7 m) and widens in hairpins; the worn band meanders (`offset`) and widens on the downhill
side at **lay-bys / viewpoints** every 400–800 m of straight. Surfaces change in stretches:
packed dirt, gravel, grassy two-track, with wheel ruts; puddles are hashed per 40 m cell.
Streams: wooden **bridges** on the main trail (deck lifted above the water), shallow
**fords** (0.35 m of water) with ramps scaled to the drop on branches. Queries use a uniform
grid and a projection along interpolated normals; a second candidate is blended at
switchbacks and junctions.

### Carving (`terrain/terrain.ts`)

With `d` the distance to the worn band (shifted by `offset`), half width `w`, trail height
`R` (banking, crown, ruts, grassy hump and puddles) and an adaptive embankment
`s = clamp(1.25·|R − N|, 9, 30)`:

```
shoulder  0.7 m flat beyond the edge
ditch     0.32 m deep on the cut side (natural ground above the trail)
t  = smoothstep(w + 0.7, w + 0.7 + s, d)          // rounded crest and toe
H  = mix(R, N(x, z), t)
```

The trail is part of the terrain mesh: no separate geometry. `trailGround()` tells dirt,
ruts, gravel, grassy middle, mud, snow and ford apart for colours and physics, with an
irregular band edge.

### Placement (`terrain/course.ts`, `world/propPlacement.ts`)

Pure data: start, base zone, waymarks, cairns, signs, fences, coins and crystals; rocks only
as outcrops (crests, faces), talus (scree under faces), stream beds, a few trailside stones
and rare erratics (~120 per km², 86 % fewer than before), never on a trail band; trees from
the same forest density as the ground colour; young (breakable) ones near the trails.

## 5. Rendering the world

- **Terrain LOD** (`terrain/terrainMesh.ts`): a quadtree whose depth and cells per patch are
  chosen so the finest faces are `terrainCell` (1 m high, 1.5 m medium, 2.5 m low). A node
  splits while its face size exceeds the target for its distance: LOD0 within `lod0Radius`
  (200/180/160 m), ~2.5 m to 600 m, ~6 m to 1.5 km, ~16 m to 3.5 km, ~48 m beyond (actual
  faces are power-of-two multiples, ≤ 1.45 × the target). Visible triangles are kept under
  the preset budget (1.5 M / 1 M / 0.6 M) by shrinking the rings (`lodScale`), LOD0 first in
  practice. Coarser ancestors stand in until finer patches arrive; skirts lit like the
  ground above hide cracks; fog hides the far LODs.
- **Patch building** (`terrain/patchBuilder.ts`, pure): heights and trail data on an
  (n + 3)² grid, colours per vertex, then non-indexed flat-shaded triangles split along the
  diagonal that follows the surface. Attributes are compact: `Int16` positions in 1/128 of a
  cell around the patch origin (the mesh is translated and scaled), normalised `Uint8`
  colours and `Int8` normals (≈ 36 B per triangle). Built in the worker; buffers of evicted
  patches are transferred back and pooled; the main thread only creates `BufferGeometry`.
  Without a worker the same builder runs time-sliced (`chunkBuildBudgetMs`).
- **Colours** (`data/palette.ts`, `terrain/biome.ts`, `terrain/splat.ts`): ramps of tones
  per material. `BiomeModel.weights()` gives smooth weights for snow (wobbling snow line,
  shaded on north faces and in hollows), snow-rock, light/dark rock (steep, rugged, convex
  crests), scree (concave under faces), rock-grass, dry alpine grass, grass, flowering
  meadows, undergrowth and forest floor (forest density), moss and mud (wet), sand (shore),
  earth (trail fringe, cuts). Each material's tone is chosen continuously along its ramp by
  large patches, curvature and wetness; faces average their corners with a tiny shade step.
  The trail band blends in over 0.8 m. Time-of-day and weather themes recolour the palette.
  The dominant material is also the physics surface (what you see is what you drive on).
- **Props** (`world/props.ts`): streamed per 320 m cell, one `InstancedMesh` per type per
  cell, cheap far cones beyond `treeDetailDistance`, colliders added and removed with their
  cell. Rock shapes: faceted boulders, layered slabs, leaning crags, rounded stream boulders.
- **Structures** (`world/structures.ts`): waymarks, cairns, signs, fences, footbridges, the
  village houses and the summit overlook, each a single instanced draw call.

## 6. Jeep physics (`vehicle/physics.ts`)

Rigid body: mass `m` (1450–1850 kg), diagonal body-space inertia (box approximation),
position, orientation, velocity, angular velocity. Semi-implicit Euler at 120 Hz.

### Raycast suspension (per wheel)

```
mount   = p + q·mountLocal
hit     = ray/heightfield intersection (2 Newton iterations on the local tangent plane)
x       = restLength + radius - hitDistance                         // compression
vRel    = dot(velocityAt(contact), up)
Fz      = k·x - c·vRel + kArb·(x - x_other)                          // c_rebound > c_bump
Fz     += min(bumpStop(x), 5 × static load)                         // capped: never a kick
if x > maxTravel: rigid hard stop impulse (restitution 0) + position projection
```

Stiff springs, high rebound damping, long travel and strong anti-roll bars keep the jeep flat
and stop it bouncing; tests drop every jeep from 4 m and check it settles within 1.5 s.

### Tyres

```
vLong = dot(vContact, fwd)    vLat = dot(vContact, side)
α     = atan2(vLat, max(|vLong|, vMin))
Fy    = -μ · Fz · curve(α / αPeak)     // a(2-a) up to the peak, then a slow fall to slideFactor
Fx    = drive + brakes + rolling resistance + engine braking (throttle released)
if |(Fx, Fy)| > μ · Fz → scaled onto the friction circle
```

`μ = jeep grip · surface grip · weather · upgrades`. The curve is tolerant past the peak so
slides are progressive. The handbrake lowers rear grip and adds a yaw flick; a drift assist
helps hold the angle and damps excessive yaw.

### Staying glued, and no air control

- **Ground stick**: with ≥ 2 wheels down, a force along the averaged ground normal
  (`groundStick` × weight) plus downforce ∝ v². It ramps in after a landing (no slam) and
  fades out in the air, so short crests stay glued but long jumps fly freely.
- **Low centre of mass** (`comOffsetY`) shortens the lever of tyre forces on body roll.
- **Anti-flip assist** only while touching the ground: roll/pitch beyond a limit relative to
  the ground normal is pushed back, with roll-rate damping.
- **In the air there is no control at all**: inputs never touch the angular velocity (tested);
  wheels keep spinning by inertia.
- Chassis contact uses eight box corners with zero restitution; props are circles/capsules in
  a spatial hash; NaN and speed clamps guard against tunnelling.

### Resets

The session samples a **safe spot** every ~2 s when the jeep is grounded, slow enough,
upright, on a gentle slope and not in water. `R` (or the touch button) puts the jeep back on
the latest one facing downhill; pressing again soon walks further back. Automatic resets fire
after 4 s upside down, in deep water or off the map. The camera re-frames smoothly.

## 7. Destructible trees

`data/trees.ts` defines the tiers: **young** always snap, **medium** snap when the impact
energy `½·m·v²` exceeds `breakEnergy` (≈ 27 km/h for 1.65 t), **old** never. The collision
world exposes a `breakHandler`; `systems/trees.ts` decides, turns the tree into a stump (props
remember broken ids across cell reloads), slows the jeep by the tier's `speedLoss`, and throws
1–3 rigid pieces (`world/treeDebris.ts`: rods with gravity, end-point ground impulses with
friction, a toppling torque about the base, sleeping, a 60-piece pool and a shrink-out after
20 s), splinters and leaves, shake, haptics and a crack sound. It emits `treeBroken`.

## 8. Camera (`vehicle/cameraRig.ts`)

- **chase / wide**: high and far; the heading follows the direction of travel through a
  damped spring (lags in drifts, never swings in reverse); vertical motion is low-passed; the
  look-at point moves ahead with speed and towards the ground ahead, so the view tilts down
  and rises on steep descents.
- **hood**: bonnet view.
- **Free look** from mouse drag, right stick or one-finger drag, auto-recentring.
- Terrain clearance along the sight line, rises above solid props, and trees between camera
  and jeep shrink away (`Props.setTreeScale`).
- Dynamic FOV, shake scaled by a setting, soft re-framing after resets, and the opening
  **fly-over** that swings from the slopes below onto the summit (skippable).

## 9. Effects (`effects/`)

`ShardSystem` keeps one pooled `InstancedMesh` per shape (tetra, octa, icosa, shard, diamond,
prism, leaf, octagonal ring) with per-instance position, velocity, spin, scale and palette
colour; particles pop in and shrink out (no transparency, no sorting). Kinds are data
(`shardKinds.ts`): dust, snow, gravel, mud, sparks, water drops and rings, landing rings, wood,
leaves, steam, nitro, pickups. Speed lines are instanced prisms, snowfall tumbling
octahedra. Emission scales with the quality preset.

**Tyre tracks** (`tireTracks.ts`): each wheel on the ground lays a strip (left, centre, right
vertices) every 0.4 m whose heights are sampled from the terrain 3.5 cm above it. Segments
live in a `TrackBuffer` ring (4000 on High, 1500 on Low): freed slots (expired or > 400 m
away) are reused first, else the oldest is overwritten; only the dirty range is uploaded. The
look per surface comes from the palette (snow grooves with lighter rims, dark mud, darker
soil, crushed grass, light gravel scratches, almost nothing on rock, none in water), opacity
and width from load, slip, braking and the handbrake, broken marks for spinning wheels; a
shader fades them over 60–120 s. One draw call.

## 10. Game systems (plugins)

```ts
interface GameSystem {
  readonly id: SystemId;
  init(session: RunSession): void;
  fixedUpdate?(dt: number): void;
  update?(dt: number, alpha: number): void;
  onReset?(): void;
  summary?(): { label: string; value: string }[];
  dispose(): void;
}
```

Registered in `systems/index.ts` (`id → factory`). A mode (`data/modes.ts`) lists the ids it
activates and how medals are earned: **Free descent** by style score, **Daily challenge** by
objectives completed (three objectives drawn from the date's seed in `data/objectives.ts`).

## 11. UI

Plain HTML/CSS overlays (`ui/`). Each state mounts its screen into `#ui`; modal sub-screens
(settings, records, credits) use a screen stack with spatial keyboard/gamepad focus. The HUD
(speed, altitude, compass to the base, descent bar, nitro, combo, objectives) is DOM based and
writes only `textContent`/`transform`.

## 12. Performance strategy

- Terrain: generation and patch building in a Web Worker, compact attributes, pooled
  buffers, a triangle budget per preset (rings shrink, faces keep their size), frustum
  culling per patch, fog over the far LODs.
- Props as `InstancedMesh` per cell, near/far variants, cells streamed around the camera.
- Shadows: one directional light following the jeep, map size from the preset.
- Dynamic resolution within `[0.55, 1]` × capped pixel ratio; "Auto" quality steps the preset
  down/up and records the level it settles on in Settings for the next start.
- Pooled particles and debris; everything a state creates is disposed in `exit()`.

## 13. Persistence

`core/save.ts`: JSON in `localStorage` with `schemaVersion` and migrations. v4 (the jeep
update) keeps coins, unlocks, upgrades, achievements, stats and settings, maps the old cars to
the jeeps and drops time records, medals and the replay ghosts. v5 adds bought paints and
accessories and, while `config.dev.testCoins` is set, tops profiles up to the test coins.

## 14. Testing

Vitest:

- terrain: slope mix within the targets, continuity, bounded curvature (no spikes), carved
  trail coherence, bridges above water; LOD0 face size and longest edge, triangle budget per
  preset, patch skirts and exact grid positions;
- trails: spacing, grade (average and over 20 m windows), minimum bend radius, shallow fords,
  width range, surface variety and lay-bys, query vs brute force;
- props: rock density (≤ 30 % of the old one), rocks with a reason, nothing on trail bands,
  forests on slopes rather than flats;
- palette: valid ramps, every material/surface colour declared, splat colours within the
  palette and smooth between neighbouring vertices;
- tyre tracks: capacity, ring order, pooling, dirty ranges, ground-following vertices, none in
  water;
- drivability: a bot drives every mountain's whole main trail with the real jeep physics, no
  stuck, no roll-over, never lost;
- jeep handling and feel, tree tiers and debris, objectives, save migrations (v5, test coins,
  every paid item affordable), registries and core utilities.

`scripts/e2e-screenshots.mjs` drives the built game with Playwright on desktop (1280×720) and
mobile landscape (844×390): menu → garage with the test coins (buys an upgrade, a paint and an
accessory) → summit → trail → off-trail with tyre tracks → trees (desktop) → results, failing
on console errors, and captures the README screenshots.
