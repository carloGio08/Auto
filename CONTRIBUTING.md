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
`trail(metres)`, `offroad(metres, lateral)`, `aimAtTree('young' | 'medium' | 'old')` and
`finish()`; `?autopilot` lets the built-in driver follow the main trail; `?e2e` also skips the
opening fly-over; **F3** toggles the FPS overlay; **F4** (dev server or `?debug`) shows the
debug map: slope classes, trails, bridges and fords, landforms and the jeep.

---

## How to add a mountain

1. Create `src/data/mountains/myMountain.ts` exporting a `MountainDef` (copy `alpine.ts`), or
   derive one from an existing mountain with `variantOf(base, { seed, mirror, jitter,
relief, rugged })` like `granite.ts` and the daily challenge do.
   - massif: `halfSize`, `summit { x, z, height, plateauRadius }`, `baseHeight`,
     per-direction `radii`, the radial `profile` (normalised distance → height fraction,
     flat stretches become terraces), `terracing { amount, scale }` (how much of the massif
     follows the stepped profile, mixed by noise), `noise` (`warp`, `broad` undulations baked
     in the heightmap, analytic `detail` stronger on rugged ground), `rimHeight`;
   - `landforms` (see below), `erosion` (`thermalIterations`, `talus`, `hydraulicPasses`,
     `hydraulicStrength`, `floorSmoothing`, `droplets`, `dropletStrength`), `relief`
     (intermediate relief by zone: `warp`, ridged `spurs`, smoothed `terraces`, `hummocks`,
     `gullies`), optional `farRanges` (see below), `lake`, `rivers` (springs: streams are
     traced down the flow graph to the lake);
   - `biomes`: altitude lines for snow, rock, tree line, dense forest and valley;
   - `trails`: a `main` trail from `start` to `base` plus `branch`/`shortcut` trails with
     waypoints (put them on terraces, saddles and valley floors), `width: [min, max]` (4–7 m),
     `targetGrade`, `maxGrade` (main ≈ 0.10 / 0.19, shortcuts up to 0.3) and optional
     `startOn` / `endOn`. Routing, hairpins, lay-bys, banking, surfaces, bridges, fords and
     the carving are automatic;
   - `start`, `base { x, z, radius }`, `props` densities, `hazards`, `collectibles`,
     `defaultTime`, `defaultWeather`, score `medals`, optional `unlockAfter` and `objectives`.
2. Add it to `src/data/mountains/index.ts` and its `mountain.<id>.name` / `.desc` strings.
3. Tune with the debug map (**F4**) and `npm test`: the slope mix (≈ 25 % flat < 8°, 45 %
   8–25°, 25 % 25–38°, < 5 % walls), continuity and no spikes, trail grades and radii, fords,
   placement and the full-descent bot are checked for every mountain. Generation runs in the
   terrain worker in 1–3 s.

## How to add a landform

Landforms are data in a mountain's `landforms` array, applied in order on top of the massif
and blended with smooth min/max (`src/terrain/landforms.ts`), never with hard seams:

| kind      | uses          | effect                                                        |
| --------- | ------------- | ------------------------------------------------------------- |
| `ridge`   | `path`        | rounded crest of `height`, `radius` half width                |
| `valley`  | `path` (down) | U valley `height` deep, floor descending evenly, `wall` slope |
| `cirque`  | `at`          | bowl with a steep back wall (`wall`) under a summit           |
| `plateau` | `at`          | flattened terrace at the natural altitude (+ `height`)        |
| `meadow`  | `at`          | gently undulating flat                                        |
| `saddle`  | `at`          | pass lowered by `height` across a ridge                       |
| `slope`   | `path`        | steep face (step of `height`)                                 |
| `hills`   | `at`          | rolling foothills of amplitude `height`                       |
| `basin`   | `at`          | lake basin                                                    |

`blend` sets the width of the transition, `rugged` (0..1) the rockiness (more detail, rock
colours, outcrops, a steeper talus allowed). To add a new kind: add it to `LandformKind` in
`src/data/types.ts`, implement it in `LandformField.apply()` (return the new height, set
`roughHere` / `flatten`), and add a row above. Keep blends wide: the slope test fails if
edges turn into walls.

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

## How to add a distant range

Distant ranges are landforms too, listed in the mountain's `farRanges` (usually large
`ridge`s with a `path`, a `radius` of a few km and a `height` of 700–2000 m). They are only
evaluated by the far-field ring (`terrain/farField.ts`), never by the playable heightmap, so
they cannot change the drivable terrain. Put the nearer, smaller ranges first-to-last in the
order you like: the aerial perspective gives each distance its own tone. Far-field spacing
and extent per quality preset are `farSpacing` / `farExtent` in `src/config.ts`.

## How to add a tree species or a pine variant

Trees are stylised low-poly pines built by `PropGeometry.pineTree(form, dark, light, sun,
snowy, seed, spruce)` in `src/world/propGeometry.ts`: a short trunk and `4 + form` faceted
cone tiers (`form` 0 young, 1 medium, 2 tall; `spruce` adds a tier and slims them), two greens
baked from the sun direction.

- **A species**: add a `TreeSpeciesDef` to `treeSpecies` in `src/data/vegetation.ts` —
  `shape` (`pine`, `spruce` or `larch`), `heights` per age in metres (6–25 m; the ages are
  also the destructible tiers of `data/trees.ts`), crown `width` as a fraction of the height,
  `zone` (normalised altitude band: 0 = valley line, 1 = tree line), `moisture` band,
  relative `weight`, `foliage` palette ramp and its two tones `[shaded, sunlit]`, optional
  `snowCap` (m below the snow line where the crown gets snow). Props builds 3 forms × plain /
  snowy and a middle-distance model for it automatically.
- **A pine variant** (another silhouette): add a parameter to `pineTree()` (tier count, tier
  profile, trunk height) and a `TreeShape` that selects it in the `Props` constructor; keep
  the unit size (1 m tall, crown 1 m wide, origin at the trunk base) and give `pineLow()` a
  matching three-tier silhouette so the LOD cross-fade stays smooth.

`tests/props.test.ts` checks heights, crown ratios, spacing and placement rules for every tree
placed; `tests/groundCover.test.ts` that crown colours stay between the two species tones.

## How to add an ecology rule

`ecologyAt()` (`src/world/propPlacement.ts`) samples one point for trees (8 m grid per cell)
and ground cover (8 m grid per tile): forest density from `BiomeModel` (altitude, slope,
wetness, clearings) shaped by the knobs of `ecology` in `src/data/vegetation.ts` —
`minTreeDistance` (Poisson disk), `clumping` (larger = more compact woods and wider glades),
`clusterScale`, `treeLineDensity` / `treeLineHeight`, `loneTrees`, `maxSlope`,
`trailClearance`. To add a rule, change `out[0]` there (e.g. fewer trees on scree: multiply by
`1 - weights[Mat.Scree]`), a habitat (`out[6..8]`) or a species weight in `speciesWeights()`.

## How to add a ground-cover type

1. Add the kind to `UndergrowthKind` and an `UndergrowthDef` to `undergrowth` in
   `src/data/vegetation.ts`: `size`, `habitat` (`forest`, `meadow`, `grass`, `edge`, `road`),
   `density` per 100 m², cap group (`grass`, `flowers`, `cover` → the preset limits
   `grassLimit`, `flowerLimit`, `coverLimit`), `wind`, `shadow`, `reach` (fraction of the
   cover distance where it is still drawn).
2. Build its unit-size geometry in `PropGeometry.undergrowth()` with palette tones only.
3. If it needs a special rule (like flower patches or pebbles on the trail), add it in
   `placeCover()` (`src/world/coverPlacement.ts`; pure, runs in the terrain worker).

`GroundCover` creates one capped instanced mesh per kind; `tests/groundCover.test.ts` checks
the trail stays clear, the caps per preset and the palette colours.

## How to add a rock type

Add the id to `ROCK_TYPES` and, if it is placed for a new reason, to `RockReason` /
`REASONS` in `src/world/propPlacement.ts`; place it in the rocks section of `placeCell()`
(never closer to the trail band than its size: see the boulder groups); build its geometry
in `PropGeometry` (`boulder()` shows flat facets and a lighter top) and map it in the `Props`
constructor (`rockGeo`). Rocks larger than 0.6 m get a collider. `tests/props.test.ts` keeps
the rock density low; `tests/groundCover.test.ts` keeps boulders off the driving line.

## How to add a palette material or theme

The world is coloured from `src/data/palette.ts`: one ramp of tones per material, ordered
dark → light (61 terrain colours and 9 for props).

- **Retint a material**: edit its ramp (2–7 tones). Terrain vertices pick a continuous tone
  along the ramp (large patches, curvature, wetness) and blend materials smoothly.
- **A new terrain material**: add its key to `PaletteKey` (`src/data/types.ts`) and a ramp to
  `defaultPalette`, add it to `MATERIALS` / `Mat` and `MATERIAL_SURFACE` in
  `src/terrain/biome.ts`, give it a weight in `BiomeModel.weights()` (altitude, slope,
  aspect, curvature, wetness...) and a tone bias in `BIAS` (`src/terrain/splat.ts`).
  `tests/palette.test.ts` checks that every material has a ramp and that colours change
  smoothly.
- **The daytime look**: the default palette is tuned for day / clear (yellow-green meadows,
  deep blue-green pines, warm orange road, grey-brown rocks); the light comes from the
  `day` entry of `timesOfDay` (`src/data/environment.ts`: sun elevation, azimuth, colour and
  intensity, hemisphere sky and ground colours, sky gradient) and the post-ACES grade from
  `config.graphics.grade`.
- **A time of day or weather mood**: add or edit an entry of `timeThemes` / `weatherThemes`
  (`tint`, `tintAmount`, `brightness`, `desaturate`). `resolvePalette()` applies the
  palette, then the time theme, then the weather theme, once when a world is built. A new time
  or weather id also needs its `TimeOfDayDef` / `WeatherDef` in `src/data/environment.ts` and
  `time.<id>` / `weather.<id>` strings.

## How to tune rocks, trees and tracks

- Placement rules are in `src/world/propPlacement.ts` (rock reasons: outcrop, talus,
  streambed, trailside, erratic; trees from `BiomeModel.forestDensity`).
- Tyre track looks per surface and fade times: `styles` in `src/effects/tireTracks.ts`;
  capacities in `TRACK_CAPACITY`.

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
