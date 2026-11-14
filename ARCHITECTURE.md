# Mountain Drop — Architecture

This document is the technical plan of the game: how modules are organised, how data flows
between them, and the maths behind the mountain, the trails, the jeep physics and the
destructible trees.

Mountain Drop is a free-roam descent: one huge low-poly mountain (8 × 8 km, ~1800 m of drop),
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

## 3. The mountain (`terrain/mountain.ts`)

`MountainDef` (`data/mountains/*.ts`) describes the massif; `Mountain` turns it into an
analytic, smooth `heightNoWater(x, z)`:

1. **Massif**: distance from the summit, normalised by per-direction radii (N/S/E/W blended
   by angle) and a few soft spurs, fed through a _rounded ramp_ profile (linear with rounded
   ends) from `summit.height` down to `baseHeight`, with a flat summit plateau.
2. **Domain warp** (low-frequency noise offsets the sample point) and two fbm layers (`low`,
   `mid`) for broad shapes. Amplitudes are small so the slope stays under `maxSlope`
   — few cliffs; the explicit `cliffs` are short authored rock steps.
3. **Rim walls** at the border make natural map edges; a **lake** bowl at the base.
4. **Rivers** are traced by steepest descent from their springs and carved with a monotone
   bank profile (`min(h, riverBed)`), fading in so the surface stays continuous.

`height()` adds the water level logic; tests check finiteness, slope limits and continuity
(2 mm probes) on every mountain.

## 4. Trails carved into the terrain

### Routing (`terrain/trailRouter.ts`)

Trails are data: `TrailDef { waypoints, kind: main | branch | shortcut, width: [min, max],
targetGrade, maxGrade, startOn?, endOn? }`. Between waypoints a grade-limited **A\*** runs on a
32 m grid (16-neighbourhood) with a cost that prefers `targetGrade`, forbids `maxGrade`,
penalises turns and (for branches) running next to an existing trail. That naturally produces
hairpins that follow the contour lines. The path is then simplified (RDP), smoothed
(Chaikin ×3), relaxed to a minimum radius, smoothed again and resampled every metre.
Branches snap their ends onto their parent trail (`startOn` / `endOn`).

### Road (`terrain/road.ts`)

All trails share flat arrays (`x, z, y, tx, tz, curvature, halfWidth, bank, flags, trailOf`).
The height profile follows the natural ground, low-passed and grade-clamped; width varies and
widens in hairpins (`ROAD_HAIRPIN`), the cross-section is banked in bends, and where a trail
crosses a river the deck is lifted on a wooden footbridge (`ROAD_BRIDGE`). Queries use a
uniform grid; the projection interpolates vertex normals (one quadratic per segment) so
ownership of space is continuous on the inside of bends. A second candidate (another trail, or
the same trail more than 20 m away along it) is returned with a weight for blending.

### Carving (`terrain/terrain.ts`)

With lateral distance `d`, half width `w`, trail height `R` and an adaptive shoulder
`s = clamp(1.25·|R − N|, 9, 30)` (embankments widen with the cut/fill height):

```
t  = smoothstep(w, w + s, d)
Hr = (R1·k1 + R2·k2) / (k1 + k2),   k = 1 / (max(d − w, 0) + 0.3)²
H  = mix(Hr + bank·lateral, N(x,z), t)
```

There is no separate road mesh: the trail is part of the terrain and is coloured per vertex
(dirt in the centre, grass/rock/snow on the edges, partial snow cover up high). The same
`classify()` drives colours and physics surfaces (trail, grass, forest, snow, scree, rock,
mud, sand, ice, wood decks), so what you see is what you drive on.

### Placement (`terrain/course.ts`)

Pure data, no three.js: start on the summit plateau, the base zone, waymark posts with painted
bands, cairns above the tree line, signs pointing to the base, fences on the outside of
hairpins and along the village approach, coin lines and crystals off the trail.

## 5. Rendering the world

- **Terrain** (`terrain/terrainMesh.ts`): a quadtree over 10 km with up to 6 levels; LOD0
  cells are 2–3 m with flat shading. Patches are built row by row within a per-frame budget,
  coarser ancestors stand in until finer ones are ready, skirts hide cracks, unused patches
  are evicted. Geometry is non-indexed with normalised `Uint8` colours and `Int8` normals.
- **Palette** (`data/palette.ts`): 13 keys × 2 tones (snow, rock, scree, alpine, meadow,
  forest, dense forest, trail, sand, water, wood, foliage, paint). Time-of-day and weather
  themes recolour it (`resolvePalette`). No textures anywhere: flat colours, few-step
  lighting, gradient sky, low-poly clouds and a distant ring of peaks.
- **Props** (`world/props.ts`): streamed per 320 m cell with a deterministic RNG; one
  `InstancedMesh` per type per cell; cheap far cones beyond `treeDetailDistance`; colliders
  added and removed with their cell. Trees are stacked cones/octahedra in three tiers.
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
octahedra, tyre strips are tinted per surface. Emission scales with the quality preset.

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

- Quadtree terrain streaming with LOD and a build budget; fog hides the far plane.
- Props as `InstancedMesh` per cell, near/far variants, cells streamed around the camera.
- Shadows: one directional light following the jeep, map size from the preset.
- Dynamic resolution within `[0.55, 1]` × capped pixel ratio; "Auto" quality steps the preset
  down/up and records the level it settles on in Settings for the next start.
- Pooled particles and debris; everything a state creates is disposed in `exit()`.

## 13. Persistence

`core/save.ts`: JSON in `localStorage` with `schemaVersion` and migrations. v4 (the jeep
update) keeps coins, unlocks, upgrades, achievements, stats and settings, maps the old cars to
the jeeps and drops time records, medals and the replay ghosts.

## 14. Testing

Vitest: mountain height (finite, slope limit, continuity), carved trail coherence (centre
height, cross slope, bridges above water), trail routing and spacing, query vs brute force,
jeep handling and feel (no NaN in 10 000 steps, settling after a drop with limited rebound,
no air control, engine braking, anti-flip, crest stick, top speed), tree tiers and debris,
daily objectives, save migrations, registries and core utilities.
`scripts/e2e-screenshots.mjs` drives the built game with Playwright (menu → summit → drive →
trees broken → results) on desktop and mobile and captures screenshots.
