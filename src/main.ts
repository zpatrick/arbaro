import "./style.css";
import { Camera } from "./camera";
import { Debris } from "./debris";
import { DebugPanel } from "./debug-panel";
import { FlowDots } from "./flow";
import { type FlowerHover, Flowers, type FlowerSettings } from "./flowers";
import { Keyboard } from "./input";
import type { Controls, Limb } from "./limb";
import type { Failure, Strength } from "./physics";
import { minimumRadius, pieceShapes, Renderer, treeShapes } from "./render";
import { SpoutControl } from "./spout-control";
import {
  type Bounds,
  type Growth,
  type GrowthMode,
  type Pick,
  Tree,
} from "./tree";
import { at, clamp, invariant } from "./util";
import { Wind, type WindSettings } from "./wind";

/** Longest frame step the simulation will take, so a stalled tab does not lurch forward. */
const MAX_STEP = 1 / 20;
/** How close to a limb, in CSS pixels, the pointer must be to pick it. */
const PICK_TOLERANCE_PX = 10;
/** Seconds a fallen tree lies on the ground before it fades. */
const FALLEN_TREE_LINGER = 12;
/** Spin, in radians per second, an uprooted tree starts falling with, the way it was pushed. */
const TOPPLE_SPIN = 0.08;
/** Seconds a message stays up. */
const MESSAGE_SECONDS = 2.6;
/** How close to a spout, in CSS pixels, the pointer must be to pick it. */
const SPOUT_PICK_PX = 10;
/** How fast energy dots ride up the wood, in CSS pixels per second. */
const DOT_SPEED_PX = 90;
/** What the hint under the ground says in each growth mode. */
const HINTS: Record<GrowthMode, string> = {
  steer:
    "<span>Hold <kbd>↑</kbd> to grow</span><span><kbd>←</kbd> <kbd>→</kbd> to steer</span><span>Click a limb to select it, again to fork</span><span>Right-click to cut</span><span><kbd>R</kbd> to replant</span>",
  flow: "<span>The roots feed every tip</span><span><kbd>←</kbd> <kbd>→</kbd> to steer</span><span>Click a limb to select it, again to fork</span><span>Click a spout to split the flow</span><span>Right-click to cut</span><span><kbd>R</kbd> to replant</span>",
};

function element<T extends HTMLElement>(
  selector: string,
  type: new () => T,
): T {
  const found = document.querySelector(selector);
  invariant(found instanceof type, `Missing ${selector}.`);
  return found;
}

const canvas = element("#scene", HTMLCanvasElement);
const hint = element("#hint", HTMLDivElement);
const message = element("#message", HTMLDivElement);
const camera = new Camera();
const renderer = new Renderer(canvas);
const keyboard = new Keyboard(window);
const panel = new DebugPanel(element("#app", HTMLDivElement));
const wind = new Wind(panel.wind);
const spoutControl = new SpoutControl(element("#app", HTMLDivElement));
const dots = new FlowDots();
const flowers = new Flowers();

let seed = 1;
/** The standing tree. Gone once it falls, until the next one is planted. */
let tree: Tree | undefined = new Tree(0, seed);
const debris: Debris[] = [];
let pointer: { x: number; y: number } | undefined;
/** Whether shift is held, which turns a click on the tree into placing or knocking off a flower. */
let shiftHeld = false;
let messageTimer: number | undefined;
/**
 * When set, frames still draw but time stands still, so a script can step the simulation exactly.
 * Set by the debug hook, or from the start by loading the page with `?frozen` in development.
 */
let frozen =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).has("frozen");

function resize(): void {
  camera.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
  renderer.resize(camera);
  hint.style.top = `${camera.groundY + (camera.height - camera.groundY) * 0.42}px`;
}

function replant(): void {
  seed += 1;
  tree = new Tree(0, seed);
  spoutControl.close();
  dots.clear();
  flowers.clear();
}

function showGrowthMode(mode: GrowthMode): void {
  hint.innerHTML = HINTS[mode];
  if (mode !== "flow") {
    spoutControl.close();
    dots.clear();
  }
}

/** The offshoot whose spout is within reach of (x, y) in CSS pixels, nearest first. */
function spoutAt(standing: Tree, x: number, y: number): Limb | undefined {
  let nearest: { limb: Limb; distance: number } | undefined;
  for (const limb of standing.limbs) {
    if (limb.attachment === undefined) {
      continue;
    }
    const p = limb.attachment.parent.pointAt(limb.attachment.s);
    const at = camera.toScreen(p.x, p.y);
    const distance = Math.hypot(at.x - x, at.y - y);
    if (
      distance <= SPOUT_PICK_PX &&
      (nearest === undefined || distance < nearest.distance)
    ) {
      nearest = { limb, distance };
    }
  }
  return nearest?.limb;
}

function announce(text: string): void {
  message.textContent = text;
  message.classList.add("shown");
  window.clearTimeout(messageTimer);
  messageTimer = window.setTimeout(
    () => message.classList.remove("shown"),
    MESSAGE_SECONDS * 1000,
  );
}

function pickAt(standing: Tree, x: number, y: number): Pick | undefined {
  const world = camera.toWorld(x, y);
  return standing.pick(world.x, world.y, PICK_TOLERANCE_PX / camera.scale);
}

/** Whether a click at the pointer would place or knock off a flower rather than grow the tree. */
function placingFlowers(event: { shiftKey: boolean }): boolean {
  return event.shiftKey && panel.flowers.placement === "hand";
}

/** Knocks off the flower under (x, y) in CSS pixels, or grows one on the thin wood there. */
function tendFlowers(standing: Tree, x: number, y: number): void {
  const world = camera.toWorld(x, y);
  if (flowers.knockOff(standing, world.x, world.y, panel.flowers)) {
    return;
  }
  const pick = pickAt(standing, x, y);
  if (pick !== undefined && !flowers.place(pick, panel.flowers)) {
    announce("Flowers only grow on thin wood");
  }
}

/** What a shift-click at (x, y) in CSS pixels would do to the flowers. */
function flowerHoverAt(standing: Tree, x: number, y: number): FlowerHover {
  const world = camera.toWorld(x, y);
  return flowers.hover(
    standing,
    world.x,
    world.y,
    pickAt(standing, x, y),
    panel.flowers,
  );
}

/** Cuts `limb` at `s` and lets everything beyond fall, keeping the motion it had. */
function breakOff(standing: Tree, limb: Limb, s: number): void {
  const piece = standing.piece(limb, s);
  const motion = standing.physics.velocityAt(
    limb,
    s,
    piece.center.x,
    piece.center.y,
  );
  debris.push(
    new Debris(pieceShapes(limb, s, minimumRadius(camera)), piece, motion),
  );
  standing.sever(limb, s);
}

/**
 * The roots let go: the whole tree tips over and falls. `turning` is the way the wind and its
 * weight were turning it, 1 for clockwise.
 */
function topple(standing: Tree, turning: 1 | -1): void {
  const piece = standing.piece(standing.root, 0);
  const motion = standing.physics.velocityAt(
    standing.root,
    0,
    piece.center.x,
    piece.center.y,
  );
  // Counterclockwise spin is positive.
  motion.spin -= turning * TOPPLE_SPIN;
  debris.push(
    new Debris(
      treeShapes(standing, minimumRadius(camera)),
      piece,
      motion,
      FALLEN_TREE_LINGER,
    ),
  );
  tree = undefined;
}

/** What the camera should keep in view: the standing tree and every piece that has not faded yet. */
function framing(): Bounds | undefined {
  let bounds = tree?.bounds();
  for (const piece of debris) {
    const b = piece.bounds();
    bounds =
      bounds === undefined
        ? b
        : {
            minX: Math.min(bounds.minX, b.minX),
            maxX: Math.max(bounds.maxX, b.maxX),
            maxY: Math.max(bounds.maxY, b.maxY),
          };
  }
  return bounds;
}

/** Lets a joint that failed give way. */
function giveWay(standing: Tree, failure: Failure): void {
  // Failures come innermost first, so a joint further out may already have fallen with an
  // earlier one this frame.
  if (!standing.has(failure.limb)) {
    return;
  }
  if (failure.kind === "uproot") {
    topple(standing, failure.turning);
    announce("The roots gave way");
    return;
  }
  const s = standing.cutPoint(failure.limb, failure.s);
  if (s === undefined) {
    return;
  }
  // It is the trunk that snapped if the whole crown comes down with it.
  const trunk =
    failure.limb === standing.root &&
    standing.root.children.every(
      (child) => child.attachment === undefined || child.attachment.s >= s,
    );
  breakOff(standing, failure.limb, s);
  announce(trunk ? "The trunk snapped" : "A limb snapped");
}

/** Advances everything by `dt` seconds. */
function step(dt: number, controls: Controls): void {
  const growth: Growth = panel.growth;
  if (tree !== undefined) {
    const standing = tree;
    for (const failure of standing.update(
      dt,
      controls,
      wind,
      panel.strength,
      growth,
    )) {
      if (tree !== standing) {
        break;
      }
      giveWay(standing, failure);
    }
  }
  flowers.update(dt, tree, panel.flowers, wind, panel.strength.flowers);
  if (tree !== undefined && growth.mode === "flow") {
    dots.update(dt, tree, growth.flowRate, DOT_SPEED_PX / camera.scale);
  } else {
    dots.clear();
  }
  for (const piece of debris) {
    piece.update(dt, wind);
  }
  for (let i = debris.length - 1; i >= 0; i -= 1) {
    if (at(debris, i).done) {
      debris.splice(i, 1);
    }
  }
}

resize();
camera.snap(tree.bounds());
showGrowthMode(panel.growth.mode);
panel.onGrowthMode = showGrowthMode;
window.addEventListener("resize", resize);
window.addEventListener("keydown", (event) => {
  if (event.key === "Shift") {
    shiftHeld = true;
  }
  if (event.code === "KeyR" && !event.repeat) {
    replant();
  }
  if (event.code === "Escape") {
    spoutControl.close();
  }
});
window.addEventListener("keyup", (event) => {
  if (event.key === "Shift") {
    shiftHeld = false;
  }
});
window.addEventListener("blur", () => {
  shiftHeld = false;
});
canvas.addEventListener("pointermove", (event) => {
  pointer = { x: event.clientX, y: event.clientY };
  shiftHeld = event.shiftKey;
});
canvas.addEventListener("pointerleave", () => {
  pointer = undefined;
});
// Clicking a limb makes it the one that grows and steers. Clicking the limb that already is
// forks a new offshoot from that spot. In flow mode, clicking a spout opens it; a click anywhere
// else just closes the open one. While flowers are placed by hand, a shift-click places or
// knocks off a flower instead.
canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || tree === undefined) {
    return;
  }
  if (placingFlowers(event)) {
    tendFlowers(tree, event.clientX, event.clientY);
    return;
  }
  if (panel.growth.mode === "flow") {
    const spout = spoutAt(tree, event.clientX, event.clientY);
    if (spout !== undefined) {
      spoutControl.open(spout);
      return;
    }
  }
  if (spoutControl.limb !== undefined) {
    spoutControl.close();
    return;
  }
  const pick = pickAt(tree, event.clientX, event.clientY);
  if (pick === undefined) {
    return;
  }
  if (pick.limb === tree.active) {
    tree.fork(pick.limb, pick.s, pick.side);
  } else {
    tree.select(pick.limb);
  }
});
// Right-clicking a limb cuts it there, and everything beyond falls.
canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (tree === undefined) {
    return;
  }
  const pick = pickAt(tree, event.clientX, event.clientY);
  if (pick === undefined) {
    return;
  }
  const s = tree.cutPoint(pick.limb, pick.s);
  if (s !== undefined) {
    breakOff(tree, pick.limb, s);
  }
});

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(MAX_STEP, (now - last) / 1000);
  last = now;
  const controls = keyboard.controls();
  if (!frozen) {
    step(dt, controls);
  }
  const view = framing();
  if (view !== undefined) {
    camera.follow(view, dt);
  }
  const flowing = tree !== undefined && panel.growth.mode === "flow";
  const flowerHover =
    tree !== undefined &&
    pointer !== undefined &&
    placingFlowers({ shiftKey: shiftHeld })
      ? flowerHoverAt(tree, pointer.x, pointer.y)
      : undefined;
  const hoveredSpout =
    flowing &&
    tree !== undefined &&
    pointer !== undefined &&
    flowerHover === undefined
      ? spoutAt(tree, pointer.x, pointer.y)
      : undefined;
  const hover =
    tree === undefined ||
    pointer === undefined ||
    hoveredSpout !== undefined ||
    flowerHover !== undefined
      ? undefined
      : pickAt(tree, pointer.x, pointer.y);
  const pointing =
    hover !== undefined ||
    hoveredSpout !== undefined ||
    flowerHover?.ghost !== undefined ||
    flowerHover?.target !== undefined;
  canvas.style.cursor = pointing ? "pointer" : "";
  // The open spout follows its fork as the tree sways, and closes if the fork is gone.
  const open = spoutControl.limb;
  if (open !== undefined) {
    if (
      tree === undefined ||
      !tree.has(open) ||
      open.attachment === undefined
    ) {
      spoutControl.close();
    } else {
      const p = open.attachment.parent.pointAt(open.attachment.s);
      const at = camera.toScreen(p.x, p.y);
      spoutControl.place(at.x, at.y);
    }
  }
  renderer.draw(camera, {
    tree,
    debris,
    hover,
    strain: panel.showStrain,
    flowers: flowers.views(panel.flowers),
    flowerHover,
    flow: flowing
      ? { dots: dots.dots, hoveredSpout, openSpout: spoutControl.limb }
      : undefined,
  });
  if (controls.grow || controls.steer !== 0) {
    hint.classList.add("quiet");
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

interface DebugHandle {
  /** Steps the simulation at 60 Hz as if `controls` were held for `seconds`, then frames the result. */
  simulate(seconds: number, controls: Controls): void;
  replant(): void;
  /** The standing tree, or undefined once it has fallen. */
  tree(): Tree | undefined;
  debris(): readonly Debris[];
  camera(): Camera;
  /** Forks limb `index` at `fraction` of its length toward `side` (1 left, -1 right), like a click. */
  fork(index: number, fraction: number, side: 1 | -1): void;
  /** Makes limb `index` the one that grows and steers, like a click. */
  select(index: number): void;
  /** Cuts limb `index` at `fraction` of its length, like a right-click. */
  cut(index: number, fraction: number): void;
  /** Changes the wind, as the debug panel would. */
  wind(settings: Partial<WindSettings>): void;
  /** Changes how much the tree can take, as the debug panel would. */
  strength(settings: Partial<Strength>): void;
  /** Changes how the tree grows, as the debug panel would. */
  growth(settings: Partial<Growth>): void;
  /** Sets the share of the flow the spout at limb `index`'s fork sends into it. */
  spout(index: number, share: number): void;
  /** Changes the flowers, as the debug panel would. */
  flowers(settings: Partial<FlowerSettings>): void;
  /**
   * Grows a flower by hand at `fraction` of limb `index`'s length, on its `side` (1 left, -1
   * right), like a shift-click.
   */
  placeFlower(index: number, fraction: number, side: 1 | -1): void;
  /** How many flowers are on the tree, and how many have come off and not yet faded. */
  flowerCount(): { onTree: number; falling: number };
  /** Stops time so frames can be captured exactly as simulated. */
  freeze(): void;
}

declare global {
  interface Window {
    __arbaro?: DebugHandle;
  }
}

if (import.meta.env.DEV) {
  const standing = (): Tree => {
    invariant(tree !== undefined, "There is no standing tree.");
    return tree;
  };
  window.__arbaro = {
    simulate(seconds, controls) {
      for (let i = 0; i < Math.round(seconds * 60); i += 1) {
        step(1 / 60, controls);
      }
      const view = framing();
      if (view !== undefined) {
        camera.snap(view);
      }
    },
    replant() {
      replant();
      camera.snap(standing().bounds());
    },
    tree: () => tree,
    debris: () => debris,
    camera: () => camera,
    fork(index, fraction, side) {
      const limb = at(standing().limbs, index);
      standing().fork(limb, limb.length * fraction, side);
      camera.snap(standing().bounds());
    },
    select(index) {
      standing().select(at(standing().limbs, index));
    },
    cut(index, fraction) {
      const limb = at(standing().limbs, index);
      const s = standing().cutPoint(limb, limb.length * fraction);
      invariant(
        s !== undefined,
        `Nothing to cut at ${fraction} of limb ${index}.`,
      );
      breakOff(standing(), limb, s);
    },
    wind(settings) {
      panel.set(settings);
    },
    strength(settings) {
      panel.setStrength(settings);
    },
    growth(settings) {
      panel.setGrowth(settings);
    },
    spout(index, share) {
      const limb = at(standing().limbs, index);
      invariant(limb.attachment !== undefined, `Limb ${index} has no spout.`);
      limb.spout = clamp(share, 0, 1);
    },
    flowers(settings) {
      panel.setFlowers(settings);
    },
    placeFlower(index, fraction, side) {
      const limb = at(standing().limbs, index);
      invariant(
        flowers.place({ limb, s: limb.length * fraction, side }, panel.flowers),
        `No wood on limb ${index} is thin enough for a flower.`,
      );
    },
    flowerCount: () => flowers.count(),
    freeze() {
      frozen = true;
    },
  };
}
