# Contributing to Mountain Drop

Thanks for helping! The engine is built so that new content and mechanics are added as
**data + one registration line**, without touching engine code. This guide shows how.

## Setup

```bash
npm install
npm run dev        # http://localhost:5173 (hot reload)
npm test           # Vitest
npm run lint       # ESLint + Prettier check
npm run build      # type-check + production build in dist/
```

Conventions: TypeScript strict, English code and comments, Prettier formatting,
[Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `perf:`,
`docs:`, `chore:`, `test:`). No external assets: geometry, textures, sounds and icons are
generated in code (canvas, WebAudio, inline SVG).

Debug helpers: `?autopilot` lets the built-in driver race, `?e2e` exposes `window.__md`
(`finish()` jumps to the finish line), **F3** toggles the FPS overlay.

---

## How to add a car

1. Create `src/data/cars/myCar.ts` exporting a `CarDef` (copy `ridgeRunner.ts` as a template):
   - `physics`: mass, chassis box, wheelbase/track, suspension (spring N/m, bump/rebound
     damping, anti-roll), tyres (grip, rear bias < 1 = more oversteer), engine (power in W,
     drive `awd`/`rwd`/`fwd`), aero drag (sets top speed), nitro, air control.
   - `look`: body style (`rally`, `coupe`, `buggy`, `truck`), paint colours, accent, spoiler.
   - `stats`: 0..1 values shown as bars in the garage.
   - `price` (0 = free) and optional `requiresAchievement`.
2. Add it to the array in `src/data/cars/index.ts`.
3. Add `car.<id>.name` / `car.<id>.desc` to `src/i18n/en.ts` and `src/i18n/it.ts`.
4. `npm test` — `tests/registry.test.ts` validates every field, `tests/handling.test.ts`
   checks acceleration, braking, grip and drift recovery for every car.

Tip: static suspension compression = `mass × 15 / 4 / stiffness`; keep it around
30–40 % of `maxTravel`. Damping around 0.3–0.5 of critical (`2·√(k·m/4)`).

## How to add a track

1. Create `src/data/tracks/myTrack.ts` exporting a `TrackDef` (copy `pineRidge.ts`):
   - `layout`: a seeded `switchback` generator (legs, leg length, heading, hairpin radius,
     wiggle) or explicit `points` (`[x, z]` control points, start near `0,0`, descending
     towards +Z).
   - `terrain`: summit height, slope, ridges/noise, snow line, lake level.
   - Everything along the road is a **fraction 0..1 of its length**: `surfaces`, `jumps`
     (moved automatically to the nearest straight), `bumps`, `arch`, `shortcuts`
     (auto-targeted to the leg below), `checkpoints`, `hazards`.
   - `river`: optional stream; bridges are created automatically where the road crosses it.
   - `medals` (seconds), `startTime` + `checkpointBonus` (must exceed the bronze time),
     `defaultTime`, `defaultWeather`, `unlockAfter`.
2. Add it to `src/data/tracks/index.ts`.
3. Add `track.<id>.name` / `track.<id>.desc` to both dictionaries.
4. `npm test` — road generation, heightfield continuity and the registry are checked for
   every track.

## How to add an upgrade

1. Add an `UpgradeDef` to `src/data/upgrades.ts`: `id`, costs per level and an
   `apply(physics, level)` function that scales the car's physics copy.
2. Add the id to `UpgradeId` in `src/data/types.ts` and its strings to the dictionaries.
   The garage lists it automatically.

## How to add a hazard

1. Add the kind to `HazardKind` in `src/data/types.ts` and its definition to
   `src/data/hazards.ts` (trigger distance, radius, optional surface).
2. Implement its behaviour in `src/systems/hazards.ts` (`setup()` for static hazards,
   `trigger()` for dynamic ones). Dynamic colliders go through `world.colliders.addDynamic`.
3. Place it in tracks with `{ kind, at, offset? }`.

## How to add a mechanic (gameplay system)

Systems are plugins. They never import each other and communicate through events.

1. Create `src/systems/mySystem.ts`:

   ```ts
   import { BaseSystem } from './system';

   export class MySystem extends BaseSystem {
     readonly id = 'mySystem' as const;
     protected setup(): void {
       this.onEvent('vehicle:landed', ({ airTime }) => {
         /* react */
       });
     }
     fixedUpdate(dt: number): void {
       /* 120 Hz logic: this.session.vehicle, this.session.course, ... */
     }
   }
   ```

2. Add `'mySystem'` to `SystemId` (`src/data/types.ts`) and register the factory in
   `src/systems/index.ts`.
3. Enable it in a mode (`src/data/modes.ts`) by adding the id to `systems`.
4. Need a new event? Add it to `GameEvents` in `src/core/events.ts` (typed payload).

## How to add a game mode

Add a `ModeDef` to `src/data/modes.ts` (systems list, timed, records) and its strings.
Show it in the mode stepper in `src/ui/screens/trackSelect.ts`.

## How to add a screen / state

1. Implement `GameState` (`enter`, `update`, `exit`, optional `fixedUpdate`) in
   `src/states/`. UI goes through `ctx.ui.setScreen()` / `ctx.ui.openModal()`.
2. Add the id to `StateId` in `src/core/context.ts` and one `register()` line in
   `src/main.ts`.

## How to add a language

1. Copy `src/i18n/it.ts` to `src/i18n/<code>.ts`, translate the values (the `Dictionary`
   type forces every key to exist).
2. Register it in `LANGUAGES` in `src/core/i18n.ts`. It appears in Settings and is picked
   automatically from the browser language.

## Tuning

All global tuning numbers are in `src/config.ts`, grouped by area (`physics`, `driving`,
`camera`, `gameplay`, `world`, `graphics`, `audio`) plus `features` flags. Car-specific
values live in the car files.

## Save format changes

Bump `CURRENT_SCHEMA` in `src/core/save.ts` and add a migration from the previous version.
Never edit an old migration; add a test in `tests/save.test.ts`.
