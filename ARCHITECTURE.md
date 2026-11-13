# Mountain Drop — Architecture

This document is the technical plan of the game: how modules are organised, how data flows
between them, and the maths behind the terrain, the road and the vehicle physics.

## 1. Module map

```
                    ┌──────────────────────────── main.ts ────────────────────────────┐
                    │ builds GameContext, registers states, starts the Loop           │
                    └──────────────────────────────────┬──────────────────────────────┘
                                                       │
   ┌──────────────────────────────── GameContext (core/context.ts) ───────────────────────────┐
   │ renderer · view (scene+camera to draw) · input · audio · save · events · i18n · config   │
   │ ui (overlay root + screen stack) · quality (dynamic resolution) · registries (data/)     │
   └───────┬──────────────────┬──────────────────────┬───────────────────────┬────────────────┘
           │                  │                      │                       │
   core/stateMachine     input/ (actions)       audio/ (mixer)          data/ (registries)
   Boot → MainMenu → Garage / TrackSelect → Loading → Playing ⇄ Paused → Results → MainMenu
           │
           ▼  Loading builds a RunSession; Playing drives it
   ┌──────────────────────────── game/session.ts (RunSession) ─────────────────────────────┐
   │ World (terrain chunks, road mesh, props, sky, water, weather, lighting)              │
   │ Vehicle (physics body + 4 raycast wheels, visual model, telemetry)                   │
   │ CameraRig · Effects (particles, skidmarks, speed lines, post fx)                     │
   │ Systems (plugins declared by the mode): checkpoints, nitro, style, hazards,          │
   │          collectibles, ghost, medals, achievements                                    │
   │ HUD                                                                                   │
   └───────────────────────────────────────────────────────────────────────────────────────┘
```

**Rules**

- No globals or singletons: everything reachable from `GameContext` (app lifetime) or
  `RunSession` (one run). Both are passed explicitly.
- Systems never import each other. They talk via the typed `EventBus` (`core/events.ts`).
- Content (cars, tracks, upgrades, surfaces, hazards, weather, achievements) lives in `src/data/`
  as typed objects registered in `src/data/registry.ts`. Engine code only reads registries.
- All tuning numbers are in `src/config.ts` (grouped by area) plus `features` flags.

## 2. Main loop

`core/loop.ts` uses a fixed physics step of **1/120 s** with an accumulator:

```
frameDt = min(now - last, 0.1) * timeScale       // timeScale < 1 during slow-motion
acc += frameDt
while acc >= STEP and steps < MAX_STEPS:
    state.fixedUpdate(STEP)                       // physics + systems' fixed logic
    acc -= STEP
alpha = acc / STEP
state.update(frameDt, alpha)                      // interpolated visuals, camera, HUD
renderer.render(ctx.view.scene, ctx.view.camera)
```

The vehicle keeps `prev` and `curr` snapshots (position, orientation, wheel compression,
steering). Visuals are `lerp(prev, curr, alpha)` / `slerp`, so 60 Hz, 90 Hz and 144 Hz screens all
look smooth while the simulation stays deterministic. The hot path reuses pre-allocated
`Vector3`/`Quaternion` scratch objects — no allocations per step.

## 3. Terrain

`terrain/heightfield.ts` exposes a pure function `height(x, z)` (plus `normal`), built from:

1. **Natural mountain** `N(x,z)`: a long mountainside descending along +Z
   (`slope * z` profile with a summit dome near the start), ridged fractal noise for ridges and
   gullies, low-frequency fbm for broad shapes, and a valley/lake basin at the bottom.
2. **River channel**: a polyline carved into `N` (smooth V-shaped profile).
3. **Road carve**: for every point we find the closest road point through a uniform spatial
   grid (O(1) lookup). The projection uses normals interpolated between vertex normals
   (solving a quadratic per segment), so ownership of space is continuous on the inside of
   bends. With lateral distance `d`, road half width `w` and an adaptive shoulder
   `s = clamp(1.25·|R − N|, 9, 30)` (embankments widen with the cut/fill height):

   ```
   t  = smoothstep(w, w + s, d)
   Hr = (R1·k1 + R2·k2) / (k1 + k2),   k = 1 / (max(d − w, 0) + 0.3)²
   H  = mix(Hr, N(x,z), t)
   ```

   `R2` is the closest point on a _different_ part of the road (e.g. the next switchback
   leg). Its weight fades in with the separation along the road, which keeps `height()`
   continuous between legs (verified by tests).

   Bridges disable the carve (the road deck is a separate collision surface), so the river
   valley stays open beneath them.

The road profile is the natural height along the path, low-pass filtered (moving average over
~40 m) and clamped to a maximum grade, plus authored **features** (kickers/jumps, crests, dips)
expressed as offsets along the path length `s`.

Because `height()` is analytic, wheel raycasts are a couple of height lookups, terrain meshes are
generated per chunk on demand, and tests can probe any point.

### Road generation (`terrain/roadBuilder.ts`)

- Tracks declare a **layout**: explicit control points, or a seeded generator that produces a
  switchback descent (alternating lateral sweeps with hairpins, fast straights between them).
- Points are interpolated with a centripetal Catmull–Rom spline and resampled every 2 m into
  `RoadSample { x, z, y, s, tx, tz, width, surface, bank }`.
- Surface zones, bridges, the rock arch, jumps, checkpoints, hazards and collectibles are all
  placed by fraction of the path length so they survive layout changes.

### Meshes

- Terrain is split into 128 m chunks with 3 LODs (4 m / 8 m / 24 m cells), flat shaded with
  per-face colours from altitude, slope and noise (snow, rock, grass, undergrowth, dirt, sand),
  modulated by a tileable canvas detail texture. High-detail chunks are built lazily near the
  camera within a small per-frame time budget and disposed when far away.
- The road is a ribbon mesh (2 m segments, 6 lateral vertices) with a canvas dirt texture
  (wheel ruts, gravel), tinted per surface zone.

## 4. Vehicle physics (`vehicle/physics.ts`)

Rigid body: mass `m`, diagonal body-space inertia `I` (box approximation), position `p`,
orientation `q`, velocity `v`, angular velocity `ω`. Semi-implicit Euler at 120 Hz.

### Raycast suspension (per wheel)

```
mount   = p + q·mountLocal
dir     = -up(q)
hit     = ray/heightfield intersection (2 Newton iterations on the local tangent plane)
x       = clamp(restLength + radius - hitDistance, 0, maxTravel)     // compression
vRel    = dot(velocityAt(mount), up)                                  // + = extending
Fspring = k · x
Fdamp   = -c · vRel        (c_bump when compressing, c_rebound when extending)
Farb    = kArb · (x_this - x_other)                                   // anti-roll bar per axle
Fz      = max(0, Fspring + Fdamp + Farb)  (+ bump stop: kStop·(x - maxTravel·0.9)² )
```

Applied at the contact point along the suspension axis.

### Tyres (slip-angle model, arcade-tuned)

At each contact: `fwd` = steered wheel forward projected on the ground plane, `side` = n × fwd.

```
vLong = dot(vContact, fwd)    vLat = dot(vContact, side)
α     = atan2(vLat, max(|vLong|, vMin))                // slip angle
Fy    = -μlat · Fz · curve(α / αPeak)                   // curve: rises linearly, peaks at 1, then
                                                        // falls to `slideFactor` (sliding)
Fx    = drive + brake + rolling resistance
if |(Fx, Fy)| > μ · Fz → scale onto the friction circle (combined slip)
```

`μ = car.grip · surface.grip · upgrade · weather`. The handbrake multiplies rear lateral grip by
`handbrakeGrip` and locks the rear wheels, so the tail steps out; a small yaw-assist torque
helps catching drifts. At very low speed a velocity-cancelling lateral term prevents creeping on
slopes.

### Other forces

- Engine: constant power `P` with traction limit, `F = min(P / max(v, v0), Fmax)`; automatic
  gearbox simulated only for the engine sound.
- Steering angle `δ = steer · lerp(δmax, δmin, v / vSteerFalloff)`, rate limited.
- Aerodynamic drag `-c_d · v|v|`, downforce `-up · c_df · v²`, gravity `g` (tuneable, > 9.81 for
  snappier jumps).
- Air control: pitch/roll torques from throttle/brake/steer while airborne, plus a soft
  self-righting torque when there is no input. Inputs held at take-off are latched and only
  act after being released and pressed again (holding throttle over a jump must not
  nose-dive the car). Upside-down on the ground for >1.1 s → flip back.
- Handbrake: rear grip × `handbrakeGrip`, rear brakes locked, plus a steering yaw "flick";
  an arcade traction assist trims drive force beyond ~30° of body slip so drifts stay
  catchable. A separate `hold` input (all-wheel parking brake) keeps the car still during the
  countdown, because braking at rest engages reverse.
- Chassis contact: eight box corners are tested against `height()`; penetrating points receive
  a restitution/friction impulse and positional correction — the car can roll and land on its
  roof without tunnelling.
- Props: the chassis is two circles in XZ tested against cylinder colliders (trees, rocks,
  pillars) and capsule colliders (guardrails) stored in a spatial hash.
- Safety: speed/ω clamps, NaN detection → automatic reset to the last checkpoint.

### Telemetry (`vehicle/telemetry.ts`)

Watches the simulation and emits events: `airborne`, `landed` (air time, impact, perfect if all
four wheels land upright), `flip` (accumulated pitch/roll rotation), `drift` (slip angle above a
threshold for a duration), `nearMiss`, `crash`.

## 5. Game systems (plugins)

```ts
interface GameSystem {
  readonly id: SystemId;
  init(session: RunSession): void;
  fixedUpdate?(dt: number): void;
  update?(dt: number): void;
  dispose(): void;
}
```

Registered in `systems/index.ts` (`id → factory`). A mode declares which ids it activates
(`data/modes.ts`), e.g. time attack = checkpoints, nitro, style, hazards, collectibles, ghost,
medals. Systems subscribe to events in `init` and unsubscribe in `dispose`.

## 6. UI

Plain HTML/CSS overlays (`ui/`). Each state mounts its screen into `#ui-root`; modal sub-screens
(settings, records, credits) use a screen stack. `ui/focusNav.ts` provides spatial keyboard and
gamepad navigation with a visible focus ring. The HUD is DOM based and updated at most every
frame with cached values (no layout thrash: only `textContent` and `transform` writes).

## 7. Performance strategy

- Fixed draw distance per quality preset, fog hiding the far plane.
- Terrain chunks with LOD; props as `InstancedMesh` per 256 m cell (frustum culled per cell)
  and distance-culled.
- Shadows: one directional light whose shadow camera follows the car (tight frustum),
  map size from quality; disabled automatically if the frame budget is exceeded at minimum
  resolution scale ("Auto" quality).
- Dynamic resolution: average frame time over 1 s; scale down by 10 % if > 18.5 ms, up if
  < 14 ms, within `[0.55, 1]` × capped pixel ratio (max 2).
- Particles: two pooled `Points` buffers (normal + additive). Skidmarks: one ring-buffer mesh.
- Effects that can be CSS (vignette, flash, speed tint) are CSS.
- Everything created by a state is disposed in `exit()` (geometries, materials, textures,
  listeners) — `core/disposables.ts` collects them.

## 8. Persistence

`core/save.ts`: JSON in `localStorage` with `schemaVersion` and a list of migrations
(`v1 → v2 → …`). Ghosts are stored separately (quantised, base64) to keep the main blob small.

## 9. Testing

Vitest covers: `height()` (finite, continuous, matches the road, bridge decks above water),
road generation for every track and several daily seeds (spacing, grade, checkpoints, query vs
brute force), suspension (10 000 steps stable, settling, drop from 15 m without explosion),
handling per car (0–100, braking, lateral grip, drift recovery), an autopilot that must drive
a whole track, save migrations, content registry validation and core utilities. `scripts/e2e-screenshots.mjs` drives the built game
with Playwright through menu → race → results and captures screenshots.
