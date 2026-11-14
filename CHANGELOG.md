# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
