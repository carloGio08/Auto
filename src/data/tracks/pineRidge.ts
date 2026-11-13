import type { TrackDef } from '../types';

/** Easy opener: wide dirt road through a pine forest, a few jumps, one bridge. */
export const pineRidge: TrackDef = {
  id: 'pine_ridge',
  nameKey: 'track.pine_ridge.name',
  descriptionKey: 'track.pine_ridge.desc',
  difficulty: 1,
  seed: 1337,
  layout: {
    kind: 'switchback',
    legs: 5,
    legLength: [190, 250],
    legHeading: 64,
    hairpinRadius: 19,
    wiggle: 14,
    runIn: 70,
    runOut: 120,
    firstDirection: 1,
  },
  roadWidth: 11,
  terrain: {
    summitHeight: 360,
    slope: 0.34,
    ridgeAmplitude: 34,
    noiseAmplitude: 14,
    snowLine: 310,
    lakeLevel: 52,
    lakeRadius: 240,
  },
  river: { x: 52, from: 0.66, width: 9, depth: 7, meander: 26 },
  roadSurface: 'dirt',
  surfaces: [
    { from: 0.0, to: 0.08, surface: 'gravel' },
    { from: 0.46, to: 0.52, surface: 'mud' },
  ],
  jumps: [
    { at: 0.16, height: 1.5, length: 16 },
    { at: 0.38, height: 1.8, length: 18 },
    { at: 0.67, height: 2.2, length: 20 },
    { at: 0.9, height: 1.6, length: 16 },
  ],
  bumps: [{ from: 0.56, to: 0.62, amplitude: 0.35 }],
  arch: 0.28,
  shortcuts: [
    { from: 0.22, to: 0.33, surface: 'grass', kickers: 1 },
    { from: 0.72, to: 0.83, surface: 'gravel', kickers: 2 },
  ],
  hazards: [
    { kind: 'log', at: 0.31, offset: 2 },
    { kind: 'mudPool', at: 0.5 },
    { kind: 'boulder', at: 0.74 },
  ],
  collectibles: { coins: 60, crystals: 5 },
  props: { trees: 1, rocks: 0.6, bushes: 1 },
  defaultTime: 'day',
  defaultWeather: 'clear',
  medals: { gold: 12000, silver: 7000, bronze: 3000 },
};
