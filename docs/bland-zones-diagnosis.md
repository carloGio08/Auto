# Bland zones: diagnosis

The reference failure (`docs/reference/bad.png`) is a steep meadow slope at ~1200 m on the main
descent: a huge smooth beige hillside, sparse isolated grass blades, no rocks, no shrubs, no
flowers, almost no colour contrast and dark blurry blotches. It is reproduced by the worst-case
spot `steep-meadow-1200` (`?shot=richness&spot=0`, main trail 4.5 km from the summit, 16 m off the
trail; `docs/screenshots/richness/before-steep-meadow-1200-*.png`).

Tools used: the debug probe (`?debug&probe`, F6: biome, slope, ecology masks, colour ramp weights,
baked AO, cover instances by kind and the richness of the cell under the jeep), the jump route
(`?debug&goto=x,z,heading`), and sampling the generator functions directly (`ecologyAt`,
`BiomeModel.weights`, `TerrainColorer.vertex`).

## 1. Which biome covered it, and why the density was so low

- The point (−740, −615), 1192 m, 27–34° slope, sits just above the tree line (1040 m) and just
  below the rock line (1200 m). `BiomeModel.weights` painted every slope over ~23° (`slope >
0.42`) as **rock** (`smoothstep(0.42, 1.05, slope)`) and, above `treeLine − 180`, as **scree**
  (with a constant 0.3 base, so whole slopes, not only hollows), plus **bare soil** on 23–31°.
  Sampled along the trail at 4.5 km, the grass weight was **0.00** on both sides: the slope was
  "rock / scree / soil" in the material model.
- The ground cover took its habitats from those weights (`grass = Grass + DryGrass + ½
RockGrass`, `meadow = Flowers + ...`, bushes only at forest edges). With grass 0 and no forest
  edge above the tree line, **almost nothing** was placed: the few blades came from the
  interpolated edge of the next grassy cell. Shrubs had **no habitat at all** above the tree line.
- Rocks: the outcrop rule scaled with the rock material weight but at only 0.07 × weight per 9 m
  candidate (and the "≤ 30 % of the old density" rule), and the big boulder groups were tied to
  the trail edge, so a rock-coloured slope had **no rock props** on it.
- There was **no biome concept** with a prop set and a minimum density: nothing guaranteed that a
  zone got at least a few kinds of props.

## 2. Why the colour was one flat beige

- Ramps: the rock, scree and dry-grass ramps were warm beige/ochre greys (`rockLight` #968c79 →
  #c3baa4, `scree` #988e7b → #c7bea9, `dryGrass` #9e9a5a → #d1c584) with low saturation; on the
  slope they blended into one beige.
- Variation: only the large tone patches (~200 m, ~60 m) and the fine noise moved the tone; the
  materials themselves were uniform over hundreds of metres (one hue over ≫ 30 m).
- Light: sun 2.9 at 40° plus a 0.88 hemisphere fill on a slope facing the sun gives an irradiance
  above 3 × the albedo: with ACES this saturates the light, unsaturated beige ramps towards an
  even paler, sun-bleached beige.
- AO: the baked AO compares the height with rings of the 12 m heightmap; a smooth B-spline slope
  has no hollows, so AO was 1.00 everywhere (the probe reads `AO 1.00`).
- Relief: the heightmap is a 12 m cubic B-spline plus a 0.35 m detail noise (55 m scale): over
  any 30 m window a 15–40° slope was a plane (residual ≪ 0.1 m), so the lighting had nothing to
  model either.

## 3. The dark blurry blotches

Rendering the off-road view at 9.8 km (`docs/screenshots/desktop-offroad.png`) with shadows on
and off (`world.lighting.setShadows(false)`) showed **the blotches do not come from the shadow
map** (the terrain does not even cast shadows; it only receives them). They are baked into the
vertex colours and lighting:

- **Forest floor without trees**: the `forest` / `undergrowth` materials (the darkest ramps)
  followed `BiomeModel.forestDensity`, while the trees follow the same density raised to the
  clumping exponent **and multiplied by a low-frequency cluster noise**. Where the noise said
  "glade" there were no trees, but the dark forest-floor colour remained: dark soft patches on
  open slopes.
- **Rock colour on trail cuts and fills**: embankments are 40–50° steep, so they took the dark
  `rockDark` / `rockLight` ramp (no rock props there), smeared by the vertex interpolation into
  dark smudges beside the trail; rough-noise rock patches did the same on steep meadows.
- **Embankments facing away from the sun**: with a dark olive hemisphere ground colour
  (#56603c) and a strong sun, 45–50° fills turned away from the sun dropped to near black.

Not the cause: cloud shadows (clouds do not cast), shadow acne (the terrain is not in the shadow
map), AO blobs (AO 1.00 on those slopes), decals (the rut ribbons are only on the trail).

## Fixes (at the cause)

- **Biomes** (`src/data/biomes.ts`, classified in `ecologyAt` → `classifyBiome`): valley and
  steep meadows, alpine meadow, tree line, forest, forest edge, scree, rock band, snowfield,
  shore, each with a complete prop set (grass clumps, flower patches in five colours, round /
  spiky / mat shrubs, stones, saplings, ferns...), outcrop rate, minimum / maximum density,
  minimum kinds and meso-relief amplitudes.
- **Material model**: rock only on cliffs (> ~35°), in patches and on rugged crests, never on
  trail cuts and fills; scree only in concave or rugged aprons; dry grass, olive rocky grass and
  bare soil in mid-scale patches and contour bands; forest floor follows the tree clusters and
  stays off the trail embankments. Rock and scree ramps neutral grey, dry grass olive / ochre.
- **Richness pass** (`world/coverPlacement.ts`, `world/richness.ts`): every ~32 m cell is scored
  (variety, density, colour, relief); filler from the cell's own biome until the minimum kinds
  and density are met, extras dropped above the maximum.
- **Outcrops**: clusters of 3–7 pale blue-grey faceted rocks (lighter tops) along the contour
  lines, rate per biome, boosted on ribs; never on the driving line.
- **Meso relief** (`Mountain.mesoRelief`, mask baked by the generator): terracettes, gullies,
  ribs and bumps on 12–48° slopes outside the declared flats; smooth (bounded curvature).
- **Light**: sun 2.4, hemisphere 0.98 with a lighter ground bounce (#7a8458).
- **Haze**: the visibility fog starts at 450 m and fades over 900 m (the mid-distance on the
  shaded side of the valleys stays readable); aerial perspective remains for far terrain.

Results: `docs/world-richness.md` (sweep over five worlds) and the before / after screenshots in
`docs/screenshots/richness/`.
