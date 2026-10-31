// Renders the scenes that define what the current build can produce and saves them under
// baselines/<name>/, so later steps can be compared against them.
//
// Usage: npm run baseline -- <name>

import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const name = process.argv[2];
if (!name) {
  throw new Error("Usage: npm run baseline -- <name>");
}
const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = fileURLToPath(new URL(`../baselines/${name}/`, import.meta.url));

/** Holds the grow control, and optionally a steering direction, for `seconds`. */
const grow = (seconds, steer = 0) => ({ seconds, grow: true, steer });
/** Lets `seconds` pass without touching the controls. */
const still = (seconds) => ({ seconds, grow: false, steer: 0 });
const S_CURVE = [grow(3.5), grow(1.4, 1), grow(1), grow(2.2, -1), grow(1.5)];
const TREE_OF_LIFE = [
  grow(4.2),
  { fork: 0, at: 0.96, side: 1 },
  grow(0.7, -1),
  grow(2.6),
  { select: 0 },
  grow(0.6, 1),
  grow(2.8),
  { fork: 1, at: 0.55, side: 1 },
  grow(0.5, -1),
  grow(1.6),
  { fork: 0, at: 0.75, side: -1 },
  grow(0.5, 1),
  grow(1.6),
  { fork: 1, at: 0.97, side: -1 },
  grow(1.8),
  { fork: 0, at: 0.97, side: 1 },
  grow(1.8),
];

/** Sets the wind, as the debug panel would. */
const blow = (model, strength, direction = 0) => ({
  wind: { model, strength, direction },
});

/**
 * Each action either holds the controls for some seconds at 60 Hz, forks limb `fork` at a
 * fraction of its length, selects a limb, cuts limb `cut` at a fraction of its length, sets the
 * wind, or sets how much the tree can take, all through the dev-only debug hook on a freshly
 * loaded page so every scene starts from the same seed. `crop` frames a close-up around the
 * trunk's base, the active tip, where limb 1 forks off, or the tip of limb N (`tipN`).
 */
const SCENES = [
  { file: "01-sprout", actions: [] },
  { file: "02-unsteered", actions: [grow(13)] },
  { file: "03-s-curve", actions: S_CURVE },
  { file: "04-lean-limit", actions: [grow(1.5), grow(6, -1)] },
  {
    file: "05-full-height",
    actions: [...S_CURVE, grow(3), grow(1.5, 1), grow(2.5, -1), grow(8)],
  },
  {
    file: "06-portrait",
    viewport: { width: 600, height: 900 },
    actions: [grow(4), grow(2, 1), grow(3, -1), grow(2)],
  },
  { file: "07-flare-detail", scale: 3, crop: "base", actions: S_CURVE },
  { file: "08-tip-detail", scale: 3, crop: "tip", actions: S_CURVE },
  {
    file: "09-first-fork",
    actions: [grow(5), { fork: 0, at: 0.55, side: -1 }, grow(2.5)],
  },
  {
    file: "10-fork-detail",
    scale: 3,
    crop: "fork",
    actions: [grow(5), { fork: 0, at: 0.55, side: -1 }, grow(2.5)],
  },
  {
    file: "11-tip-elbow",
    actions: [grow(4), { fork: 0, at: 1, side: 1 }, grow(3)],
  },
  { file: "12-tree-of-life", actions: TREE_OF_LIFE },
  {
    file: "13-tree-of-life-detail",
    scale: 2,
    crop: "fork",
    actions: TREE_OF_LIFE,
  },
  {
    file: "14-gale",
    actions: [...TREE_OF_LIFE, blow("steady", 0.5), still(8)],
  },
  {
    file: "15-hurricane",
    actions: [...TREE_OF_LIFE, blow("steady", 1), still(8)],
  },
  // Wood and roots strong enough to ride out the hurricane, to see how forks hold up bent hard.
  {
    file: "16-hurricane-detail",
    scale: 3,
    crop: "fork",
    actions: [
      ...TREE_OF_LIFE,
      { strength: { wood: 4, roots: 4 } },
      blow("steady", 1),
      still(8),
    ],
  },
  {
    file: "17-down-and-left",
    actions: [...TREE_OF_LIFE, blow("steady", 0.8, -Math.PI * 0.75), still(8)],
  },
  {
    file: "18-trunk-in-gale",
    actions: [...S_CURVE, blow("steady", 0.6), still(8)],
  },
  {
    file: "19-after-the-storm",
    actions: [
      ...TREE_OF_LIFE,
      blow("gusty", 0.75),
      still(6),
      blow("steady", 0),
      still(4),
    ],
  },
  {
    file: "20-pruned",
    actions: [...TREE_OF_LIFE, still(2), { cut: 3, at: 0.35 }, still(3)],
  },
  {
    file: "21-pruned-stub-detail",
    scale: 3,
    crop: "tip3",
    actions: [...TREE_OF_LIFE, still(2), { cut: 3, at: 0.35 }, still(3)],
  },
  {
    file: "22-felled",
    actions: [...TREE_OF_LIFE, still(2), { cut: 0, at: 0.35 }, still(5)],
  },
  {
    file: "23-uprooted",
    actions: [
      ...TREE_OF_LIFE,
      { strength: { roots: 0.25 } },
      blow("steady", 0.55),
      still(6),
    ],
  },
  {
    file: "25-flow",
    actions: [
      { growth: { mode: "flow", flowRate: 1 } },
      still(14),
      { fork: 0, at: 0.55, side: 1 },
      { seconds: 5, grow: false, steer: -1 },
      still(8),
      { select: 0 },
      { fork: 0, at: 0.8, side: -1 },
      { seconds: 5, grow: false, steer: 1 },
      still(10),
      { spout: 2, share: 0.3 },
      still(14),
    ],
  },
  {
    file: "26-flow-spouts-detail",
    scale: 3,
    crop: "fork",
    actions: [
      { growth: { mode: "flow", flowRate: 1 } },
      still(14),
      { fork: 0, at: 0.55, side: 1 },
      { seconds: 5, grow: false, steer: -1 },
      still(8),
      { select: 0 },
      { fork: 0, at: 0.8, side: -1 },
      { seconds: 5, grow: false, steer: 1 },
      still(10),
      { spout: 2, share: 0.3 },
      still(14),
    ],
  },
  {
    file: "24-regrown",
    actions: [
      ...TREE_OF_LIFE,
      still(2),
      { cut: 2, at: 0.45 },
      still(3),
      { select: 2 },
      grow(2.5),
    ],
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
      deviceScaleFactor: scene.scale ?? 1,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error));
    // Frozen from the first frame, so time only moves when a scene steps it.
    await page.goto(`${url}?frozen`);
    await page.waitForFunction(() => window.__arbaro !== undefined);
    // The debug panel is a tool, not part of the picture.
    await page.addStyleTag({ content: ".debug { display: none !important; }" });
    const anchors = await page.evaluate((actions) => {
      const debug = window.__arbaro;
      // Let growth coast to a full stop before any wind, so every scene settles the same way.
      let settled = false;
      for (const action of actions) {
        if (action.fork !== undefined) {
          debug.fork(action.fork, action.at, action.side);
        } else if (action.select !== undefined) {
          debug.select(action.select);
        } else if (action.cut !== undefined) {
          debug.cut(action.cut, action.at);
        } else if (action.strength !== undefined) {
          debug.strength(action.strength);
        } else if (action.growth !== undefined) {
          debug.growth(action.growth);
        } else if (action.spout !== undefined) {
          debug.spout(action.spout, action.share);
        } else if (action.wind !== undefined) {
          if (!settled) {
            debug.simulate(2, { grow: false, steer: 0 });
            settled = true;
          }
          debug.wind(action.wind);
        } else {
          debug.simulate(action.seconds, {
            grow: action.grow,
            steer: action.steer,
          });
        }
      }
      if (!settled) {
        debug.simulate(2, { grow: false, steer: 0 });
      }
      const tree = debug.tree();
      if (tree === undefined) {
        return {};
      }
      const camera = debug.camera();
      const screen = (p) => camera.toScreen(p.x, p.y);
      const forked = tree.limbs[1]?.attachment;
      return {
        base: screen(tree.root.points[0]),
        tip: screen(tree.active.tip),
        fork:
          forked === undefined
            ? undefined
            : screen(forked.parent.pointAt(forked.s)),
        tips: tree.limbs.map((limb) => screen(limb.tip)),
      };
    }, scene.actions);
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
    let clip;
    if (scene.crop !== undefined) {
      const limbTip = /^tip(\d+)$/.exec(scene.crop);
      const anchor =
        limbTip === null
          ? anchors[scene.crop]
          : anchors.tips?.[Number(limbTip[1])];
      if (anchor === undefined) {
        throw new Error(
          `Scene ${scene.file} has no ${scene.crop} to crop around.`,
        );
      }
      clip = cropAround(anchor, scene.crop === "tip" ? 0.25 : 0.6);
    }
    await page.screenshot({
      path: `${outDir}${scene.file}.jpg`,
      type: "jpeg",
      quality: 90,
      clip,
    });
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
