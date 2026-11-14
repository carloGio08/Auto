# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- More vivid colours: the whole palette's saturation is scaled by `config.world.vividness`
  (1.4), with less desaturation in the distance.
- Real visibility fog: the scene fades into the sky's horizon colour and the view ends at
  about 900 m on a clear day (closer in fog and snow); the sky melts into the fog near the
  horizon. Tunable with `config.world.fogVisibility`.

### Fixed

- Fog colours were applied in the wrong colour space (fogged objects came out darker than
  the sky).

## [2.2.0] - 2026-11-14

Landscape update: distant ranges, atmosphere, finer and calmer terrain, varied relief and
real forests.

### Added

- Far-field terrain ring (to 20 / 16 / 12 km by preset) built in the worker from the same
  landforms plus distant ranges declared in the data (`farRanges`), one draw call, seamless
  with the quadtree.
- Aerial perspective and height fog in every shader (replacing three.js' fog), sun halo and
  horizon glow, clouds on three layers.
- Intermediate relief by zone (`relief`): ridged spurs, smoothed terraces, hummocks,
  gullies from the flow accumulation, droplet erosion, moraine landform.
- Tree species as data (`data/vegetation.ts`), Poisson-disk forests with ecological,
  clumped density, realistic heights (6–25 m), three LODs with dithered cross-fades, canopy
  masses far away, undergrowth (bushes, grass, ferns, flowers, logs, stumps), tree limits per
  preset; placement in the worker.
- Baked ambient occlusion (`config.world.ao`).
- Tests: far-field continuity, triangle aspect ratio, shared jittered borders, neighbouring
  face colours, AO range, relief variation per 200 m window, tree placement rules, Poisson
  spacing, clustering, heights, LOD limits and colliders.
- `scripts/compare-screenshots.mjs`: before/after screenshots from fixed viewpoints.

### Changed

- Every jeep is 35 % faster (`config.driving.speedScale`: engine power × 1.35, drag ÷ 1.35²).
- LOD0 faces 0.85 / 1.25 / 2 m with deterministic XZ jitter and steep-edge refinement (> 90 %
  of triangles under 3:1); the budget shrinks the far rings first.
- Colours: no per-face noise, materials from the slope over ±3 m, low-frequency tone patches,
  warm grey and ochre rock emerging gradually (no grey-violet).
- Tree and rock colliders only within 180 m of the jeep; terrain is cut under bridge decks.

### Removed

- The ring of grey cones around the map and the flat fog band.

## [2.1.0] - 2026-11-14

Terrain update: an organic, designed mountain with smaller faces, organic trails, richer
colours, sensible props and tyre tracks.

### Added

- Data-driven landforms (ridges, valleys, cirques, plateaus, meadows, saddles, steep faces,
  foothills, lake basin) blended with smooth min/max over a terraced radial profile.
- Generation pipeline in a Web Worker with a progress bar: designed shape → 12 m heightmap →
  talus limiter, thermal erosion, priority-flood flow routing, stream-power incision and
  valley-floor smoothing → moisture and streams; cubic B-spline sampling plus analytic detail
  that depends on the zone. Slope mix ≈ 24 % flat, 44 % gentle/medium, 27 % steep, < 5 %
  walls (tested).
- Finer quadtree LOD: ~1 m faces near the jeep (1.5 m medium, 2.5 m low), then ~2.5, 6, 16 and
  48 m rings; triangle budget per preset; patches built in the worker with Int16 positions,
  Uint8 colours, Int8 normals and pooled buffers.
- Organic trails: minimum-cost routing with side-slope, turn and stream-crossing costs,
  bends relaxed to a 12 m radius, ~10 % average grade on the main trail (≤ 20 %); width
  4–7 m with a meandering band, lay-bys and viewpoints, shoulders, drainage ditches, rounded
  cut and fill; packed dirt, gravel and grassy two-tracks with ruts, puddles and stones; fords
  on branches, bridges on the main trail; new gravel surface.
- Palette of material ramps (61 terrain colours, 9 for props) and per-vertex splat colouring
  from altitude, slope, aspect, curvature, wetness and the snow line.
- Tyre tracks following the terrain with per-surface looks, pooling and fading; "Tyre tracks"
  setting (Off / Low / High).
- Purchasable premium paints and jeep accessories (roof rack, jerrycans and bags, light bar,
  snorkel, spare wheel) that can be switched on and off.
- `config.dev.testCoins` (100000) and `config.dev.unlockAll` for testing every paid item, with
  a "Test: reset coins" button in the settings.
- Debug map overlay (F4 in dev builds or with `?debug`): slope classes, trails, bridges and
  fords, landforms, jeep.
- Tests: slope mix, no spikes, trail grades and radii, fords, LOD0 edges and triangle budget,
  rock density and clear trails, palette and smooth colours, tyre track buffer, test coins and
  purchases, and a bot that drives every main trail to the base.

### Changed

- Rocks reduced by ~86 % and placed only as outcrops, talus, stream beds and a few trailside
  stones; new rock shapes. Trees follow the same forest density as the ground colours.
- Granite Massif and the daily challenge derive their landforms from the main massif
  (mirrored, moved, reshaped from a seed).
- The menu backdrop parks the jeep where the descent opens up below.
- Save schema v5 (paints, accessories; test coins top-up while the flag is on).

### Removed

- The analytic massif with spurs and authored cliffs, the old two-tone palette and the skid
  strips (replaced by the tyre tracks).

## [2.0.0] - 2026-11-14

Free-roam update: one huge mountain, a 4x4 jeep and no clock.

### Added

- Huge data-driven mountain (8 × 8 km, ~1800 m drop): rounded massif with domain warp and a
  configurable max slope, few authored cliffs, rivers, lake, biomes by altitude, natural
  borders; quadtree terrain streaming with LOD, skirts and flat shading.
- Trails carved into the terrain: grade-limited A\* routing with contour-following hairpins,
  branches and shortcuts, banking, variable width, footbridges; per-vertex trail colouring
  with partial snow up high; waymarks, cairns, signs, fences, summit overlook, base village.
- Palette of 13 × 2 flat colours with time-of-day and weather themes; gradient sky, low-poly
  clouds, cone/octahedron trees in three tiers.
- Four original 4x4 jeeps (Trailblazer, Scout, Crawler, Nomad) with a low-poly model: boxy
  tub, round headlights, wide flares, rollbar, spare wheel, roof rack with jerrycans and
  backpack, knobby tyres, visible half-shafts and coil-overs.
- Off-road physics: engine braking, ground stick with landing ramp-in, downforce, tolerant
  slip curve, no-bounce suspension, low centre of mass, anti-flip assist on the ground.
- Destructible trees (young / medium by impact energy / old solid) with tumbling debris,
  splinters, leaves, stumps, sound, shake and haptics; `treeBroken` event and stats.
- Instanced low-poly particles (dust, snow, gravel, mud, sparks, drops and rings, landing
  rings, wood, leaves, steam, nitro) and prism speed lines.
- Camera: high look-ahead chase, wide and hood views, free look, slope tilt, terrain/prop
  avoidance, tree fading, camera settings; skippable summit fly-over.
- Safe-spot resets (manual or automatic when upside down, in deep water or off the map).
- Daily challenge objectives with a HUD checklist; medals by objectives; HUD compass to the
  base, altitude and descent bar; results with distance, altitude dropped, trees, drift and
  jump records.
- Auto quality level recorded in Settings.

### Changed

- Save schema v4: keeps coins, unlocks, upgrades, achievements, stats and settings, maps the
  old cars to the jeeps, drops time records, medals and ghosts.
- Menu backdrop shows the jeep at the summit edge; "Tracks" became "Mountains".

### Removed

- Checkpoints, timer, countdown, time medals, time attack and ghosts.
- Air control and in-air self-righting; slow motion.
- The three old tracks and four old cars; canvas noise textures and sprite particles.

## [1.0.0] - 2026-11-13

### Added

- Raycast-suspension vehicle physics at 120 Hz with interpolated rendering: springs,
  bump/rebound damping, anti-roll bars, slip-angle tyres with a friction circle, handbrake
  drifts, traction assist, downforce, drag, air control, self-righting and chassis contacts.
- Analytic mountain heightfield `height(x, z)` with switchback road generation, carved cuts and
  fills, bridges over a river, jumps, bumps, rock arch, shortcuts and a lake at the bottom.
- Three handcrafted tracks (Pine Ridge, Granite Pass, Frostbite Peak) and a daily procedural
  challenge seeded by the date.
- Four cars with different handling (stable AWD, RWD drifter, light jumper, heavy truck),
  garage with purchases, paint and four upgrade lines.
- Gameplay systems as plugins: checkpoints with time bonus, nitro, style combos (drifts, air,
  flips, near misses, perfect landings, shortcuts), dynamic hazards (rolling boulders,
  rockslides, logs, mud, ice), coins and crystals, ghost of the best run, medals, achievements.
- Low-poly world: chunked LOD terrain with per-face colours and canvas detail textures,
  instanced forests and rocks, guardrails, fences, signs, gates, sky dome with sun, clouds and
  stars, distant mountains, water, snowfall, times of day (dawn, day, sunset, night with
  headlights) and weather (clear, fog, snow).
- Effects: dust/snow/mud spray, sparks, splashes, skid marks, speed lines, dynamic FOV, camera
  shake, slow motion on big perfect landings, CSS vignette and flashes.
- Procedural WebAudio: engine with gearbox, wind, tyres/gravel, impacts, nitro, UI sounds,
  generative ambient music, mixer with separate volumes.
- Menus: live 3D main menu, garage turntable, track/mode/time/weather selection, loading with
  tips, HUD with altitude bar, pause, results, records & achievements, settings (quality,
  audio, controls with key rebinding, touch/tilt, language, data reset), credits.
- Input: keyboard, gamepad, multitouch buttons and tilt steering mapped to actions.
- Mobile: landscape layout with safe areas, fullscreen, vibration, rotate hint.
- PWA: manifest, offline service worker with precached build.
- Adaptive quality: presets, pixel-ratio cap, dynamic resolution, automatic downgrade.
- Versioned saves with migrations, English and Italian translations.
- Tests (Vitest) for terrain, roads, suspension, handling, saves, registries and core; e2e
  smoke test and screenshots with Playwright; GitHub Actions CI and Pages deployment.
