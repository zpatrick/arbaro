// Scratch probe: reports where the horizon and the level's far ground sit, in world units and
// on screen, at several zooms.

import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, logLevel: "error" });
await server.listen();
const url = server.resolvedUrls?.local[0];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${url}?frozen`);
  await page.waitForFunction(() => window.__arbaro !== undefined);
  const out = await page.evaluate(() => {
    const debug = window.__arbaro;
    debug.level("cliff");
    debug.world({ mountains: true });
    debug.simulate(12, { grow: true, steer: 0 });
    const camera = debug.camera();
    const tree = debug.tree();
    const level = tree.level;
    const rows = [];
    for (const zoom of [1, 0.45, 2.2]) {
      if (zoom !== 1) {
        camera.zoom(zoom, camera.width / 2, camera.groundY);
      }
      const farX = camera.toWorld(camera.width, 0).x;
      rows.push({
        zoom,
        scale: Number(camera.scale.toFixed(3)),
        horizonWorld: Number(camera.horizon.toFixed(3)),
        horizonRow: Number(camera.horizonRow.toFixed(1)),
        farX: Number(farX.toFixed(1)),
        groundAtFarX: Number(level.groundAt(farX).toFixed(3)),
        groundRowAtFarX: Number(
          camera.toScreen(farX, level.groundAt(farX)).y.toFixed(1),
        ),
      });
    }
    return {
      rows,
      groundSamples: [10, 30, 60, 69, 80, 200, 1000].map((x) => ({
        x,
        y: Number(level.groundAt(x).toFixed(3)),
      })),
    };
  });
  console.log(JSON.stringify(out, null, 2));
} finally {
  await browser.close();
  await server.close();
}
