import { Color } from 'three';
import type { PaletteKey, TimeOfDayId, WeatherId } from './types';

/**
 * The world palette: 13 entries × 2 tones (light, dark) = 26 flat colours (the last one is
 * the red/white paint of trail waymarks). Everything in the
 * world (terrain, props, jeep accessories, particles) picks its colours from here, so a new
 * look is just a new palette. Faces choose a tone with the seed – there is no noise texture.
 */
export type Palette = Record<PaletteKey, [string, string]>;

export const defaultPalette: Palette = {
  snow: ['#f2f5f7', '#d5dfe8'],
  rock: ['#8d8a87', '#6c6966'],
  scree: ['#b2aa9e', '#958d82'],
  alpine: ['#a9bb6a', '#8fa257'],
  meadow: ['#86b45a', '#6e9c48'],
  forest: ['#5c8a45', '#4b7638'],
  denseForest: ['#3f6c37', '#33592d'],
  trail: ['#c49a6c', '#a98156'],
  sand: ['#e3cf9b', '#cdb683'],
  water: ['#4aa3c7', '#3a87ab'],
  wood: ['#9a6a42', '#734d2f'],
  foliage: ['#4f8b46', '#3a6e3a'],
  paint: ['#efe9df', '#d4473a'],
};

/**
 * A theme recolours the palette for a time of day / weather: a tint blended in, a brightness
 * factor and a desaturation amount. Applied once when a world is built.
 */
export interface PaletteTheme {
  tint: string;
  tintAmount: number;
  brightness: number;
  desaturate: number;
}

export const timeThemes: Record<TimeOfDayId, PaletteTheme> = {
  dawn: { tint: '#ffb48a', tintAmount: 0.14, brightness: 0.95, desaturate: 0.05 },
  day: { tint: '#ffffff', tintAmount: 0, brightness: 1, desaturate: 0 },
  sunset: { tint: '#ff8a5c', tintAmount: 0.2, brightness: 0.92, desaturate: 0 },
  night: { tint: '#5368b8', tintAmount: 0.38, brightness: 0.62, desaturate: 0.25 },
};

export const weatherThemes: Record<WeatherId, PaletteTheme> = {
  clear: { tint: '#ffffff', tintAmount: 0, brightness: 1, desaturate: 0 },
  fog: { tint: '#c9d2da', tintAmount: 0.18, brightness: 1, desaturate: 0.25 },
  snow: { tint: '#e8eef5', tintAmount: 0.2, brightness: 1.02, desaturate: 0.2 },
};

/** Resolved palette: three.js colours ready for vertex colours and materials. */
export type ResolvedPalette = Record<PaletteKey, [Color, Color]>;

const grey = new Color();
function applyTheme(c: Color, t: PaletteTheme): Color {
  if (t.desaturate > 0) {
    const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
    c.lerp(grey.setRGB(l, l, l), t.desaturate);
  }
  if (t.tintAmount > 0) c.lerp(grey.set(t.tint), t.tintAmount);
  return c.multiplyScalar(t.brightness);
}

export function resolvePalette(palette: Palette, ...themes: PaletteTheme[]): ResolvedPalette {
  const out = {} as ResolvedPalette;
  for (const key of Object.keys(palette) as PaletteKey[]) {
    out[key] = palette[key].map((hex) => {
      const c = new Color(hex);
      for (const t of themes) applyTheme(c, t);
      return c;
    }) as [Color, Color];
  }
  return out;
}
