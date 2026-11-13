import type { SurfaceId } from '../data/types';

/**
 * Typed event map shared by every system. Payloads are plain objects; emitters may reuse
 * them, so handlers must not keep references.
 */
export interface GameEvents {
  // Run lifecycle
  'run:start': { trackId: string; modeId: string };
  'run:finish': { score: number };
  'run:reset': { manual: boolean };
  // Vehicle telemetry
  'vehicle:airborne': { speed: number };
  'vehicle:landed': { airTime: number; impact: number; perfect: boolean; distance: number };
  'vehicle:flip': { kind: 'backflip' | 'frontflip' | 'barrelRoll'; count: number };
  'vehicle:drift': { duration: number; angle: number; ended: boolean };
  'vehicle:nearMiss': { distance: number; speed: number };
  'vehicle:crash': { impact: number };
  'vehicle:splash': { speed: number };
  'vehicle:surface': { surface: SurfaceId };
  // Gameplay
  'collectible:picked': { kind: 'coin' | 'crystal'; value: number };
  'nitro:changed': { amount: number; active: boolean };
  'nitro:fill': { amount: number; reason: string };
  'style:trick': { label: string; points: number };
  'style:combo': { multiplier: number; pending: number };
  'style:comboLost': { lost: number };
  'style:comboBanked': { points: number };
  'hazard:triggered': { kind: string };
  'medal:awarded': { medal: 'gold' | 'silver' | 'bronze' | 'none' };
  'achievement:unlocked': { id: string };
  // Presentation
  'ui:toast': { text: string; tone?: 'good' | 'bad' | 'info' | 'gold' };
  'fx:shake': { amount: number };
  'fx:flash': { color: string; strength: number };
  haptic: { pattern: number | number[] };
  'settings:changed': Record<string, never>;
}
