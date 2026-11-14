/**
 * Worst-case richness spots (zones that used to look bland, see config.benchmark.spots):
 * renders each spot frozen with the default camera, High and Medium presets, desktop
 * 1280×720 and mobile 844×390, into docs/screenshots/richness/<label>-<spot>-<preset>-<device>.png.
 *
 *   npm run build && npm run preview      # serves http://localhost:4173
 *   node scripts/richness-screenshots.mjs before|after
 */
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const label = process.argv[2] ?? 'after';
const BASE = process.env.E2E_URL ?? 'http://localhost:4173/';
const OUT = new URL('../docs/screenshots/richness/', import.meta.url).pathname;
const PRESETS = (process.env.PRESETS ?? 'high,medium').split(',');
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

async function run(preset, device) {
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
    if (m.type() === 'error') errors.push(`[${tag}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}`));
  await page.goto(`${BASE}?shot=richness&spot=0&quality=${preset}&e2e`);
  await page.waitForFunction(() => document.documentElement.dataset.benchmark === 'running');
  const names = await page.evaluate(() => window.__md.spots);
  for (let i = 0; i < names.length; i++) {
    await page.evaluate((k) => window.__md.spot(k), i);
    await page.waitForTimeout(Number(process.env.SETTLE_MS ?? 8000));
    const file = `${OUT}${label}-${names[i]}-${preset}-${device}.png`;
    await page.screenshot({ path: file, timeout: 120000 });
    console.log(`  ${file}`);
  }
  await context.close();
}

await mkdir(OUT, { recursive: true });
try {
  for (const p of PRESETS) for (const dv of devices) await run(p, dv);
} catch (err) {
  errors.push(String(err));
}
await browser.close();
if (errors.length) {
  console.error(`Failed with ${errors.length} error(s):\n${errors.join('\n')}`);
  process.exit(1);
}
console.log('Richness screenshots done.');
