import { Rng } from '../../math/rng';
import type { LandformDef, MountainDef } from '../types';

export interface VariantOptions {
  seed: number;
  /** Mirror east ↔ west. */
  mirror?: boolean;
  /** Random displacement of landforms (m); trail waypoints on them follow. */
  jitter?: number;
  /** Multiplier of landform heights (ridges, valley depths...). */
  relief?: number;
  /** Multiplier of rockiness. */
  rugged?: number;
}

/**
 * Derives a new mountain from an existing one: mirrored and/or with every landform moved
 * and resized a little, deterministically from a seed. Trail waypoints sitting on a moved
 * landform (terrace, saddle) move with it, so routes still pass through the same places.
 */
export function variantOf(base: MountainDef, o: VariantOptions): MountainDef {
  const rng = new Rng(o.seed ^ 0x7a11);
  const sx = o.mirror ? -1 : 1;
  const flip = (p: [number, number]): [number, number] => [p[0] * sx, p[1]];
  const moves = new Map<string, [number, number]>();
  const key = (p: [number, number]): string => `${Math.round(p[0])},${Math.round(p[1])}`;
  const j = o.jitter ?? 0;
  const landforms: LandformDef[] = base.landforms.map((lf) => {
    const dx = rng.range(-j, j);
    const dz = rng.range(-j, j);
    // The summit plateau and the lake basin stay put (start and lake are tied to them).
    const fixed =
      lf.kind === 'basin' || (lf.at && lf.at[0] === base.summit.x && lf.at[1] === base.summit.z);
    const out: LandformDef = {
      ...lf,
      height: lf.height * (lf.kind === 'plateau' || lf.kind === 'meadow' ? 1 : (o.relief ?? 1)),
      radius: lf.radius * rng.range(0.9, 1.1),
      rugged: lf.rugged !== undefined ? Math.min(1, lf.rugged * (o.rugged ?? 1)) : undefined,
    };
    if (lf.at) {
      const f = flip(lf.at);
      const moved: [number, number] = fixed ? f : [f[0] + dx, f[1] + dz];
      moves.set(key(f), [moved[0] - f[0], moved[1] - f[1]]);
      out.at = moved;
    }
    if (lf.path) {
      // Linear landforms keep their ends (summit, lake) and bend in the middle.
      out.path = lf.path.map((p, k) => {
        const f = flip(p);
        const inner = k > 0 && k < lf.path!.length - 1;
        return inner ? [f[0] + dx, f[1] + dz] : f;
      });
    }
    return out;
  });
  const follow = (p: [number, number]): [number, number] => {
    const f = flip(p);
    for (const [k, d] of moves) {
      const [x, z] = k.split(',').map(Number);
      if (Math.hypot(x - f[0], z - f[1]) < 60) return [f[0] + d[0], f[1] + d[1]];
    }
    return f;
  };
  return {
    ...base,
    seed: o.seed,
    summit: { ...base.summit, x: base.summit.x * sx },
    landforms,
    lake: { ...base.lake, x: base.lake.x * sx },
    rivers: base.rivers.map((r) => ({ ...r, spring: flip(r.spring) })),
    trails: base.trails.map((t) => ({ ...t, waypoints: t.waypoints.map(follow) })),
    base: { ...base.base, x: base.base.x * sx },
    start: { ...base.start, x: base.start.x * sx },
  };
}
