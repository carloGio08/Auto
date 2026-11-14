import { Color } from 'three';
import { config } from '../config';
import type { PaletteKey, TimeOfDayId, WeatherId } from './types';

/**
 * The world palette: one ramp of tones per material, ordered dark → light. Terrain colours
 * are smooth blends of these ramps (see terrain/splat.ts), props and particles pick tones
 * from them, so a new look is just a new palette: 61 terrain colours and 9 for props.
 */
export type Palette = Record<PaletteKey, string[]>;

export const defaultPalette: Palette = {
  // Snow: sunlit, shaded (blue-grey) and the snow → rock transition.
  snow: ['#cdd8e3', '#dde5ed', '#e9eff4', '#f3f6f9', '#fbfcfd'],
  snowShade: ['#8e9db0', '#a5b4c5', '#bccad8'],
  snowRock: ['#8a8984', '#a3a29b'],
  // Rock: warm greys and ochre, low saturation, in tune with the greens.
  rockLight: ['#968c79', '#a69b86', '#b5ab95', '#c3baa4'],
  rockDark: ['#5e574b', '#6d6556', '#7c7362', '#8c826e'],
  scree: ['#988e7b', '#a89e8a', '#b8ae99', '#c7bea9'],
  rockGrass: ['#80864f', '#979b5f'],
  // Ground: earth (trails, bare soil), mud, sand.
  earth: ['#74462a', '#8e5630', '#a86837', '#be7a41', '#cf8f52'],
  mud: ['#4a3a2c', '#5a4532', '#6b533c'],
  sand: ['#c8b383', '#d8c493', '#e6d4a6'],
  // Vegetation: dry alpine grass, grass, flowering meadow, undergrowth, forest floor, moss.
  dryGrass: ['#9e9a5a', '#b0a964', '#c2b872', '#d1c584'],
  grass: ['#4f8030', '#619336', '#74a63c', '#89b844', '#9ec84f'],
  flowers: ['#86ab52', '#a4bd5e', '#d8c86c', '#d6a9c8'],
  undergrowth: ['#3f5f2f', '#4c6d35', '#5b7c3d'],
  forest: ['#2a4a2a', '#345a31', '#3f6a38', '#4b7a40'],
  moss: ['#5d7a3a', '#6f8c43', '#82a050'],
  water: ['#2f6f91', '#3a87ab', '#4aa3c7'],
  // Props.
  wood: ['#5e3f26', '#734d2f', '#9a6a42'],
  foliage: ['#1e4a35', '#26603f', '#30744a', '#3f8a56'],
  paint: ['#d4473a', '#efe9df'],
};

/** Darkest and lightest tones of a ramp. */
export const dark = <T>(ramp: T[]): T => ramp[0];
export const light = <T>(ramp: T[]): T => ramp[ramp.length - 1];
/** Tone at t (0 = darkest, 1 = lightest), nearest entry. */
export const tone = <T>(ramp: T[], t: number): T =>
  ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1))))];

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
export type ResolvedPalette = Record<PaletteKey, Color[]>;

const grey = new Color();
function applyTheme(c: Color, t: PaletteTheme): Color {
  if (t.desaturate > 0) {
    const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
    c.lerp(grey.setRGB(l, l, l), t.desaturate);
  }
  if (t.tintAmount > 0) c.lerp(grey.set(t.tint), t.tintAmount);
  return c.multiplyScalar(t.brightness);
}

const hsl = { h: 0, s: 0, l: 0 };
/** Scales a colour's saturation (HSL), keeping hue and lightness. */
function vivid(c: Color, k: number): Color {
  if (k === 1) return c;
  c.getHSL(hsl);
  return c.setHSL(hsl.h, Math.min(1, hsl.s * k), hsl.l);
}

export function resolvePalette(palette: Palette, ...themes: PaletteTheme[]): ResolvedPalette {
  const out = {} as ResolvedPalette;
  for (const key of Object.keys(palette) as PaletteKey[]) {
    out[key] = palette[key].map((hex) => {
      const c = vivid(new Color(hex), config.world.vividness);
      for (const t of themes) applyTheme(c, t);
      return c;
    });
  }
  return out;
}

/** Number of colours declared in a palette. */
export const paletteSize = (p: Palette): number =>
  Object.values(p).reduce((n, ramp) => n + ramp.length, 0);
