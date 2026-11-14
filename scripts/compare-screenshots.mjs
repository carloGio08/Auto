/**
 * Before/after screenshots from fixed viewpoints (same seed, position and camera).
 *
 *   npm run build && npm run preview      # serves http://localhost:4173
 *   node scripts/compare-screenshots.mjs before   (or: after)
 *
 * Desktop 1280×720 and mobile landscape 844×390. The jeep is parked on the main trail at
 * fixed distances (no autopilot), the chase camera snaps behind it, the terrain and props
 * stream in, then the view is captured to docs/screenshots/compare-<label>-<device>-<view>.png.
 * Fails on any console error.
 */
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const label = process.argv[2] ?? 'after';
const BASE = process.env.E2E_URL ?? 'http://localhost:4173/';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
const VIEWS = [
  ['summit', 260],
  ['slope', 6000],
  ['valley', 11500],
];

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

async function run(name, viewport, touch) {
  const context = await browser.newContext({
    viewport,
    hasTouch: touch,
    isMobile: touch,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(180000);
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  await page.goto(`${BASE}?e2e`);
  await page.waitForSelector('.main-menu', { timeout: 180000 });
  await page.locator('.main-menu .btn.primary').click();
  await page.waitForFunction(() => window.__md?.session?.phase === 'running', null, {
    timeout: 180000,
  });
  for (const [view, dist] of VIEWS) {
    await page.evaluate((d) => window.__md.trail(d), dist);
    await page.waitForTimeout(9000);
    const file = `${OUT}compare-${label}-${name}-${view}.png`;
    await page.screenshot({ path: file, timeout: 120000 });
    console.log(`  ${file}`);
  }
  await context.close();
}

await mkdir(OUT, { recursive: true });
try {
  await run('desktop', { width: 1280, height: 720 }, false);
  await run('mobile', { width: 844, height: 390 }, true);
} catch (err) {
  errors.push(String(err));
}
await browser.close();
if (errors.length) {
  console.error(`Failed with ${errors.length} error(s):\n${errors.join('\n')}`);
  process.exit(1);
}
