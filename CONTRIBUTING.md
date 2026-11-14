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
`docs:`, `chore:`, `test:`). No external assets and no textures: geometry, colours (from the
palette), sounds and icons are generated in code (WebAudio, inline SVG).

Debug helpers (dev server or `?e2e`): `window.__md` exposes the session and
`trail(metres)`, `aimAtTree('young' | 'medium' | 'old')` and `finish()`; `?autopilot` lets the
built-in driver follow the main trail; `?e2e` also skips the opening fly-over; **F3** toggles
the FPS overlay.

---

## How to add a mountain

1. Create `src/data/mountains/myMountain.ts` exporting a `MountainDef` (copy `alpine.ts`):
   - shape: `halfSize`, `summit { x, z, height, plateauRadius }`, `baseHeight`, per-direction
     `radii`, `spurs`, `noise` (domain warp + two fbm layers), `maxSlope` (tests enforce it on
     the natural terrain, outside the authored `cliffs`), `rimHeight`, `lake`, `rivers`
     (springs; the course follows the steepest descent);
   - `biomes`: altitude lines for snow, rock, tree line, dense forest and valley;
   - `trails`: a `main` trail from `start` to `base` plus `branch`/`shortcut` trails with
     waypoints, `width: [min, max]`, `targetGrade`, `maxGrade` and optional `startOn` /
     `endOn` (id of the trail they leave from / rejoin). Routing, hairpins, banking,
     footbridges and the carving are automatic;
   - `start` (on the summit plateau) and `base { x, z, radius }` (the arrival zone);
   - `props` densities, `hazards` (`{ kind, at }` with `at` a fraction of the main trail),
     `collectibles`, `defaultTime`, `defaultWeather`, score `medals`, optional `unlockAfter`
     and `objectives`.
2. Add it to `src/data/mountains/index.ts`.
3. Add `mountain.<id>.name` / `mountain.<id>.desc` to `src/i18n/en.ts` and `src/i18n/it.ts`.
4. `npm test` — height continuity, slope limits, trail routing, carving and placement are
   checked for every mountain. Building a course takes a few hundred milliseconds; keep main
   trails around 8–12 km so a descent lasts 6–10 minutes.

## How to add a jeep

1. Create `src/data/cars/myJeep.ts` exporting a `CarDef` (copy `trailblazer.ts`):
   - `physics`: mass (1450–1850 kg), `comOffsetY` (negative = lower centre of mass),
     chassis box, wheelbase/track, wheel radius, suspension (spring N/m, bump < rebound
     damping, long `maxTravel`, anti-roll bars), tyres (`grip`, `rearBias` < 1 = looser
     tail), engine (power W, `awd`, brakes, `engineBrake`), aero drag (sets top speed) and
     downforce, nitro, `groundStick` (fraction of weight pressing it down) and `antiFlip`.
   - `look`: body `short` | `standard` | `long` (pickup bed), paint colours (first =
     default), accent (bumpers, flares, rollbar), and accessories: `roofRack`, `spareWheel`,
     `cargo` (jerrycans and backpack), `lightBar`, `snorkel`, `wheelWidth`.
   - `stats` (0..1 bars in the garage), `price` and optional `requiresAchievement`.
2. Add it to the array in `src/data/cars/index.ts`.
3. Add `car.<id>.name` / `car.<id>.desc` to both dictionaries.
4. `npm test` — `tests/registry.test.ts` validates every field; `tests/handling.test.ts`
   checks acceleration, top speed, braking, grip, drift recovery, settling after a drop, no air
   control, engine braking, anti-flip and crest stick for every jeep; `tests/suspension.test.ts`
   runs 10 000 mixed steps on the real mountain.

Tip: static compression = `mass × 15 / 4 / stiffness`; keep it around 25–35 % of
`maxTravel`, and rebound damping roughly twice the bump damping.

## How to add an upgrade

1. Add an `UpgradeDef` to `src/data/upgrades.ts`: `id`, costs per level and an
   `apply(physics, level)` function that scales the car's physics copy.
2. Add the id to `UpgradeId` in `src/data/types.ts` and its strings to the dictionaries.
   The garage lists it automatically.

## How to add a hazard

1. Add the kind to `HazardKind` in `src/data/types.ts` and its definition to
   `src/data/hazards.ts` (trigger distance, radius, optional surface).
2. Implement its behaviour in `src/systems/hazards.ts` (`setup()` for static hazards,
   `trigger()` for dynamic ones). Dynamic colliders go through `world.colliders.addDynamic`;
   use `PropGeometry` and palette colours for its look.
3. Place it on a mountain with `{ kind, at }` (`at` = fraction of the main trail).
4. Add `hazard.<kind>` strings to both dictionaries.

## How to add a palette theme

The whole world is coloured from `src/data/palette.ts`: 13 keys × 2 tones.

- **A new look for everything**: edit `defaultPalette` (keep each pair light/dark; the tests
  and the terrain classifier only care about the keys).
- **A time of day or weather mood**: add or edit an entry of `timeThemes` / `weatherThemes`
  (`tint`, `tintAmount`, `brightness`, `desaturate`). `resolvePalette()` applies the
  palette, then the time theme, then the weather theme, once when a world is built. A new time
  or weather id also needs its `TimeOfDayDef` / `WeatherDef` in `src/data/environment.ts` and
  `time.<id>` / `weather.<id>` strings.

## How to tune trees

`src/data/trees.ts` defines the three tiers: `breaks` (`always` / `energy` / `never`),
`minSpeed`, `breakEnergy` (J), `speedLoss`, number of debris `pieces`, `shake` and style
`score`. Debris pool size and lifetime are `config.world.debrisMax` / `debrisLifetime`.
`tests/trees.test.ts` checks the thresholds.

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

Add a `ModeDef` to `src/data/modes.ts` (systems list, `recordsEnabled`, `medalsBy`:
`score` or `objectives`) and its strings. Show it in the mode stepper in
`src/ui/screens/trackSelect.ts`. Objectives are data too (`src/data/objectives.ts`): give a
mountain an `objectives` list, or draw them like the daily challenge does.

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
values live in the jeep files.

## Save format changes

Bump `CURRENT_SCHEMA` in `src/core/save.ts` and add a migration from the previous version.
Never edit an old migration; add a test in `tests/save.test.ts`.
