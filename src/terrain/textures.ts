import { CanvasTexture, RepeatWrapping, SRGBColorSpace, LinearMipmapLinearFilter } from 'three';
import { Rng } from '../math/rng';
import { Simplex2 } from '../math/noise';

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas not available');
  return [c, ctx];
}

function finish(c: HTMLCanvasElement, repeat = true): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  return t;
}

/** Tileable value noise rendered to ImageData (wraps on both axes). */
function tileNoise(size: number, seed: number, scale: number, octaves: number): Float32Array {
  const n = new Simplex2(seed);
  const out = new Float32Array(size * size);
  // Sample a torus in 4D-ish via two 2D noises blended at the edges (cheap tileable trick).
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const f = (sx: number, sy: number): number => n.fbm(sx * scale, sy * scale, octaves);
      const a = f(u, v);
      const b = f(u - 1, v);
      const c = f(u, v - 1);
      const d = f(u - 1, v - 1);
      const top = a * (1 - u) + b * u;
      const bottom = c * (1 - u) + d * u;
      out[y * size + x] = top * (1 - v) + bottom * v;
    }
  }
  return out;
}

/**
 * Grey detail texture multiplied over terrain vertex colours: mottled noise, pebbles and grass
 * strokes. Kept bright (~0.85 average) so vertex colours stay readable.
 */
export function createTerrainDetailTexture(size = 256): CanvasTexture {
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size);
  const noise = tileNoise(size, 11, 6, 4);
  const fine = tileNoise(size, 23, 24, 2);
  for (let i = 0; i < size * size; i++) {
    const v = 0.86 + noise[i] * 0.1 + fine[i] * 0.06;
    const g = Math.max(0, Math.min(255, v * 255));
    img.data[i * 4] = g;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const rng = new Rng(5);
  for (let i = 0; i < 380; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(0.6, 2.2);
    ctx.fillStyle = `rgba(${rng.chance(0.5) ? '255,255,255' : '40,40,40'},${rng.range(0.05, 0.16)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineWidth = 1;
  for (let i = 0; i < 500; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    ctx.strokeStyle = `rgba(30,30,30,${rng.range(0.04, 0.1)})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-2, 2), y - rng.range(2, 5));
    ctx.stroke();
  }
  return finish(c);
}

/**
 * Dirt road texture (u across the road, v along it): darker wheel ruts, gravel speckles,
 * lighter crown and worn edges blending into grass. Greyscale-ish so surfaces can tint it.
 */
export function createRoadTexture(size = 256): CanvasTexture {
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size);
  const noise = tileNoise(size, 77, 5, 4);
  const fine = tileNoise(size, 91, 30, 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const i = y * size + x;
      // Ruts at ~28% and ~72% across.
      const rut =
        Math.exp(-Math.pow((u - 0.28) / 0.06, 2)) + Math.exp(-Math.pow((u - 0.72) / 0.06, 2));
      const edge = Math.pow(Math.abs(u - 0.5) * 2, 6);
      let v = 0.92 + noise[i] * 0.12 + fine[i] * 0.08 - rut * 0.13 + edge * 0.05;
      v = Math.max(0, Math.min(1.1, v));
      const g = v * 235;
      img.data[i * 4] = g;
      img.data[i * 4 + 1] = g * 0.97;
      img.data[i * 4 + 2] = g * 0.92;
      img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const rng = new Rng(3);
  for (let i = 0; i < 900; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(0.5, 1.8);
    const light = rng.chance(0.55);
    ctx.fillStyle = light
      ? `rgba(255,250,240,${rng.range(0.15, 0.4)})`
      : `rgba(40,30,20,${rng.range(0.15, 0.35)})`;
    ctx.fillRect(x, y, r, r);
  }
  // Tyre streaks along the ruts.
  for (let i = 0; i < 40; i++) {
    const x = (rng.chance(0.5) ? 0.28 : 0.72) * size + rng.range(-8, 8);
    const y = rng.range(0, size);
    ctx.strokeStyle = `rgba(30,22,15,${rng.range(0.05, 0.12)})`;
    ctx.lineWidth = rng.range(1, 3);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-2, 2), y + rng.range(20, 60));
    ctx.stroke();
  }
  return finish(c);
}

/** Wood planks for bridges. */
export function createPlankTexture(size = 128): CanvasTexture {
  const [c, ctx] = canvas(size);
  const rng = new Rng(9);
  const planks = 8;
  for (let p = 0; p < planks; p++) {
    const y = (p * size) / planks;
    const tone = rng.range(0.8, 1);
    ctx.fillStyle = `rgb(${Math.round(150 * tone)},${Math.round(108 * tone)},${Math.round(70 * tone)})`;
    ctx.fillRect(0, y, size, size / planks);
    for (let k = 0; k < 6; k++) {
      ctx.strokeStyle = `rgba(60,40,20,${rng.range(0.1, 0.25)})`;
      ctx.beginPath();
      const yy = y + rng.range(2, size / planks - 2);
      ctx.moveTo(0, yy);
      ctx.bezierCurveTo(
        size * 0.3,
        yy + rng.range(-2, 2),
        size * 0.6,
        yy + rng.range(-2, 2),
        size,
        yy,
      );
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(40,25,10,0.6)';
    ctx.fillRect(0, y, size, 1.5);
  }
  return finish(c);
}

/** Soft round sprite used by particles. */
export function createParticleTexture(size = 64): CanvasTexture {
  const [c, ctx] = canvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(c, false);
}

/** Checkered banner for start/finish gates. */
export function createCheckerTexture(size = 128): CanvasTexture {
  const [c, ctx] = canvas(size);
  const n = 8;
  for (let y = 0; y < n / 2; y++) {
    for (let x = 0; x < n; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
      ctx.fillRect((x * size) / n, (y * size) / (n / 2) / 2 + size / 4, size / n, size / n);
    }
  }
  ctx.fillStyle = '#f4f4f4';
  ctx.fillRect(0, 0, size, size / 4);
  ctx.fillRect(0, (size * 3) / 4, size, size / 4);
  return finish(c);
}
