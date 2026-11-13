# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
