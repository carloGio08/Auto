/**
 * Visual benchmark: renders the fixed `?shot=benchmark` view in every quality preset on
 * desktop (1280×720) and mobile landscape (844×390) and saves
 * docs/screenshots/benchmark-<preset>-<device>.png. Fails on any console error or warning
 * from the renderer (shader compile/link messages).
 *
 *   npm run build && npm run preview      # serves http://localhost:4173
 *   node scripts/benchmark-screenshots.mjs [outDir]
 *
 * PRESETS=high,low and DEVICES=desktop narrow the set (handy while iterating).
 */
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const BASE = process.env.E2E_URL ?? 'http://localhost:4173/';
const OUT = process.argv[2] ?? new URL('../docs/screenshots/', import.meta.url).pathname;
const PRESETS = (process.env.PRESETS ?? 'high,medium,low').split(',');
const DEVICES = {
  desktop: { viewport: { width: 1280, height: 720 }, touch: false },
  mobile: { viewport: { width: 844, height: 390 }, touch: true },
};
const devices = (process.env.DEVICES ?? 'desktop,mobile').split(',');

let playwright;
try {
  playwright = await import('playwright');
} catch {
  playwright = createRequire(import.meta.url)('playwright');
}
const errors = [];
const browser = await playwright.chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function shot(preset, device) {
  const d = DEVICES[device];
  const context = await browser.newContext({
    viewport: d.viewport,
    hasTouch: d.touch,
    isMobile: d.touch,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(240000);
  const tag = `${preset}/${device}`;
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' || /THREE\.WebGLProgram|shader/i.test(t))
      errors.push(`[${tag}] ${m.type()}: ${t}`);
  });
  page.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}`));
  const t0 = Date.now();
  await page.goto(`${BASE}?shot=benchmark&quality=${preset}&e2e`);
  await page.waitForFunction(() => document.documentElement.dataset.benchmark === 'running');
  // Let the terrain, props and shadows stream in around the parked jeep.
  await page.waitForTimeout(Number(process.env.SETTLE_MS ?? 12000));
  const stats = await page.evaluate(() => {
    const md = window.__md;
    const w = md.session.world;
    const r = md.renderInfo();
    return {
      calls: r.calls,
      triangles: r.triangles,
      trees: w.props.visibleTrees,
      grass: w.cover.counts.grass,
      flowers: w.cover.counts.flowers,
      cover: w.cover.counts.cover,
    };
  });
  report.push({ preset, device, ...stats });
  const file = `${OUT}/benchmark-${preset}-${device}.png`.replace(/\/\//g, '/');
  await page.screenshot({ path: file, timeout: 120000 });
  console.log(`  ${file} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  await context.close();
}

const report = [];
await mkdir(OUT, { recursive: true });
try {
  for (const p of PRESETS) for (const dv of devices) await shot(p, dv);
} catch (err) {
  errors.push(String(err));
}
await browser.close();
if (errors.length) {
  console.error(`Failed with ${errors.length} error(s):\n${errors.join('\n')}`);
  process.exit(1);
}
console.table(report);
console.log('Benchmark screenshots done.');
