/**
 * End-to-end smoke test + README screenshots.
 *
 *   npm run build && npm run preview     # in one terminal (serves http://localhost:4173)
 *   npm run e2e                          # in another
 *
 * Desktop (1280×720) and mobile landscape (844×390, touch): menu → summit start (checks the
 * jeep starts near the top) → drive downhill → snap young trees (checks treeBroken) →
 * results. Fails on any console error and writes screenshots to docs/screenshots/.
 * Requires Playwright with Chromium installed.
 */
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const BASE = process.env.E2E_URL ?? 'http://localhost:4173/';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
const URL_E2E = `${BASE}${BASE.includes('?') ? '&' : '?'}e2e&autopilot`;

let playwright;
try {
  playwright = await import('playwright');
} catch {
  try {
    // Globally installed Playwright (NODE_PATH) is only visible to require().
    playwright = createRequire(import.meta.url)('playwright');
  } catch {
    playwright = null;
  }
}
if (!playwright) {
  console.error(
    'Playwright is not installed: npm i -D playwright && npx playwright install chromium',
  );
  process.exit(2);
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
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  // Software WebGL (CI) renders large frames slowly.
  page.setDefaultTimeout(120000);
  const shot = async (file) => {
    console.log(`  ${name}: ${file}`);
    await page.screenshot({ path: `${OUT}${name}-${file}.png`, timeout: 120000 });
  };
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  await page.goto(URL_E2E);
  await page.waitForSelector('.main-menu', { timeout: 60000 });
  await page.waitForTimeout(2500);
  await shot('menu');

  if (!touch) {
    await page.getByText('Garage').first().click();
    await page.waitForSelector('.garage', { timeout: 20000 });
    await page.waitForTimeout(1500);
    await shot('garage');
    await page.locator('.back-btn').first().click();
    await page.waitForSelector('.main-menu', { timeout: 30000 });
    await page.getByText('Mountains').first().click();
    await page.waitForSelector('.track-select', { timeout: 20000 });
    await page.waitForTimeout(800);
    await shot('mountains');
    await page.locator('.track-details .btn.primary').click();
  } else {
    await page.locator('.main-menu .btn.primary').click();
  }

  // Summit start (the ?e2e flag skips the fly-over).
  await page.waitForFunction(() => window.__md?.session?.phase === 'running', null, {
    timeout: 120000,
  });
  const start = await page.evaluate(() => {
    const s = window.__md.session;
    return { y: s.vehicle.physics.position.y, top: s.course.def.summit.height };
  });
  if (start.y < start.top - 150) throw new Error(`[${name}] not at the summit: y=${start.y}`);
  await page.waitForTimeout(touch ? 2500 : 4000);
  await shot('summit');

  // Drive: the autopilot follows the main trail for a while, mid-mountain.
  await page.evaluate(() => window.__md.trail(5200));
  await page.waitForTimeout(touch ? 6000 : 8000);
  await shot('drive');

  // Trees: launch the jeep at young trees in the forest until some snap.
  await page.evaluate(() => window.__md.trail(7700));
  await page.waitForTimeout(3000);
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => {
      window.__md.session.autopilot = null;
      return window.__md.aimAtTree('young', 13);
    });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(i === 0 ? 900 : 1600);
    if (i === 0) await shot('trees');
    await page.keyboard.up('KeyW');
  }
  const broken = await page.evaluate(() => window.__md.session.stats.treesBroken);
  if (broken < 1) throw new Error(`[${name}] no tree broken`);

  await page.evaluate(() => window.__md.finish());
  await page.waitForSelector('.results', { timeout: 30000 });
  await page.waitForTimeout(800);
  await shot('results');
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
  console.error(`E2E failed with ${errors.length} error(s):\n${errors.join('\n')}`);
  process.exit(1);
}
console.log(`E2E passed. Screenshots in ${OUT}`);
