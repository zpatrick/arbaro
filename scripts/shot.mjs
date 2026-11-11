// Scratch harness: renders named scenes to /tmp/arbaro-shots for eyeballing during development.
// Usage: node scripts/shot.mjs <outDir>

import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const outDir = process.argv[2] ?? "/tmp/arbaro-shots";
const root = fileURLToPath(new URL("..", import.meta.url));

const TREE_OF_LIFE = [
  { seconds: 4.2, grow: true, steer: 0 },
  { fork: 0, at: 0.96, side: 1 },
  { seconds: 0.7, grow: true, steer: -1 },
  { seconds: 2.6, grow: true, steer: 0 },
  { select: 0 },
  { seconds: 0.6, grow: true, steer: 1 },
  { seconds: 2.8, grow: true, steer: 0 },
  { fork: 1, at: 0.55, side: 1 },
  { seconds: 0.5, grow: true, steer: -1 },
  { seconds: 1.6, grow: true, steer: 0 },
  { fork: 0, at: 0.75, side: -1 },
  { seconds: 0.5, grow: true, steer: 1 },
  { seconds: 1.6, grow: true, steer: 0 },
];

const SCENES = [
  {
    file: "cliff-default",
    level: "cliff",
    mountains: true,
    actions: TREE_OF_LIFE,
  },
  {
    file: "cliff-zoomed-out",
    level: "cliff",
    mountains: true,
    actions: TREE_OF_LIFE,
    zoom: 0.45,
  },
  {
    file: "cliff-zoomed-in",
    level: "cliff",
    mountains: true,
    actions: TREE_OF_LIFE,
    zoom: 2.2,
  },
  {
    file: "cliff-panned-right",
    level: "cliff",
    mountains: true,
    actions: TREE_OF_LIFE,
    pan: { dx: -420, dy: 0 },
  },
  {
    file: "cliff-panned-down",
    level: "cliff",
    mountains: true,
    actions: TREE_OF_LIFE,
    pan: { dx: -200, dy: 160 },
  },
  {
    file: "meadow-default",
    level: "meadow",
    mountains: true,
    actions: TREE_OF_LIFE,
  },
];

const server = await createServer({ root, logLevel: "error" });
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) {
  throw new Error("Vite did not report a local URL.");
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const scene of SCENES) {
    const page = await browser.newPage({
      viewport: scene.viewport ?? { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error));
    await page.goto(`${url}?frozen`);
    await page.waitForFunction(() => window.__arbaro !== undefined);
    await page.addStyleTag({ content: ".debug { display: none !important; }" });
    await page.evaluate((scene) => {
      const debug = window.__arbaro;
      debug.time({ timeOfDay: 0.5, dayRunning: false, season: 0 });
      if (scene.level !== undefined) {
        debug.level(scene.level);
      }
      if (scene.mountains !== undefined) {
        debug.world({ mountains: scene.mountains });
      }
      if (scene.growth !== undefined) {
        debug.growth(scene.growth);
      }
      for (const action of scene.actions ?? []) {
        if (action.fork !== undefined) {
          debug.fork(action.fork, action.at, action.side);
        } else if (action.select !== undefined) {
          debug.select(action.select);
        } else if (action.spout !== undefined) {
          debug.spout(action.spout, action.share);
        } else {
          debug.simulate(action.seconds, {
            grow: action.grow,
            steer: action.steer,
          });
        }
      }
      debug.simulate(2, { grow: false, steer: 0 });
      const camera = debug.camera();
      if (scene.zoom !== undefined) {
        camera.zoom(scene.zoom, camera.width / 2, camera.groundY);
      }
      if (scene.pan !== undefined) {
        camera.pan(scene.pan.dx, scene.pan.dy);
      }
    }, scene);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    if (errors.length > 0) {
      throw new Error(
        `Scene ${scene.file} raised: ${errors.map((e) => e.message).join("; ")}`,
      );
    }
    await page.screenshot({ path: `${outDir}/${scene.file}.png` });
    await page.close();
    console.log(`${outDir}/${scene.file}.png`);
  }
} finally {
  await browser.close();
  await server.close();
}
