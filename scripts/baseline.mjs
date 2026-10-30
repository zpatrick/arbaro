// Renders the scenes that define what the current build can produce and saves them under
// baselines/<name>/, so later steps can be compared against them.
//
// Usage: npm run baseline -- <name>

import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const name = process.argv[2];
if (!name) {
  throw new Error('Usage: npm run baseline -- <name>');
}
const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = fileURLToPath(new URL(`../baselines/${name}/`, import.meta.url));

const S_CURVE = [[3.5, true, 0], [1.4, true, 1], [1, true, 0], [2.2, true, -1], [1.5, true, 0]];

/**
 * Each step is [seconds, grow, steer], replayed at 60 Hz through the dev-only debug hook on a
 * freshly loaded page, so every scene starts from the same seed.
 */
const SCENES = [
  { file: '01-sprout', steps: [] },
  { file: '02-unsteered', steps: [[13, true, 0]] },
  { file: '03-s-curve', steps: S_CURVE },
  { file: '04-lean-limit', steps: [[1.5, true, 0], [6, true, -1]] },
  {
    file: '05-full-height',
    steps: [...S_CURVE, [3, true, 0], [1.5, true, 1], [2.5, true, -1], [8, true, 0]],
  },
  { file: '06-portrait', viewport: { width: 600, height: 900 }, steps: [[4, true, 0], [2, true, 1], [3, true, -1], [2, true, 0]] },
  { file: '07-flare-detail', scale: 3, crop: 'base', steps: S_CURVE },
  { file: '08-tip-detail', scale: 3, crop: 'tip', steps: S_CURVE },
];

const server = await createServer({ root, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) {
  throw new Error('Vite did not report a local URL.');
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const scene of SCENES) {
    const page = await browser.newPage({
      viewport: scene.viewport ?? { width: 1440, height: 900 },
      deviceScaleFactor: scene.scale ?? 1,
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error));
    await page.goto(url);
    await page.waitForFunction(() => window.__arbaro !== undefined);
    const anchors = await page.evaluate((steps) => {
      const debug = window.__arbaro;
      for (const [seconds, grow, steer] of steps) {
        debug.simulate(seconds, { grow, steer });
      }
      // Let growth coast to a full stop so nothing moves between here and the capture.
      debug.simulate(2, { grow: false, steer: 0 });
      const camera = debug.camera();
      const tip = debug.trunk().tip;
      const toScreen = (x, y) => ({
        x: camera.width / 2 + (x - camera.centerX) * camera.scale,
        y: camera.groundY - y * camera.scale,
      });
      return { base: toScreen(debug.trunk().baseX, 0), tip: toScreen(tip.x, tip.y) };
    }, scene.steps);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (errors.length > 0) {
      throw new Error(`Scene ${scene.file} raised: ${errors.map((e) => e.message).join('; ')}`);
    }
    const clip = scene.crop ? cropAround(anchors[scene.crop], scene.crop === 'tip' ? 0.25 : 0.6) : undefined;
    await page.screenshot({ path: `${outDir}${scene.file}.jpg`, type: 'jpeg', quality: 90, clip });
    await page.close();
    console.log(`baselines/${name}/${scene.file}.jpg`);
  }
} finally {
  await browser.close();
  await server.close();
}

/** A close-up box around `point`, which sits `down` of the way from the top of the box. */
function cropAround(point, down) {
  const width = 320;
  const height = 220;
  return { x: point.x - width / 2, y: point.y - height * down, width, height };
}
