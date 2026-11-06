import "./style.css";
import { Camera } from "./camera";
import { Clouds } from "./clouds";
import { Debris } from "./debris";
import { DebugPanel, type WorldSettings } from "./debug-panel";
import { FlowDots } from "./flow";
import { type FlowerHover, Flowers, type FlowerSettings } from "./flowers";
import { Bears, type BearPose, type BearSettings } from "./bears";
import { Birds, type BirdSettings } from "./birds";
import { Hives, type HiveSettings } from "./hives";
import {
  advanceDay,
  clockTime,
  css,
  seasonName,
  type SkyLight,
  skyAt,
  type TimeSettings,
} from "./sky";
import { Keyboard } from "./input";
import { type Level, levelById, type LevelId } from "./level";
import type { Controls, Limb } from "./limb";
import type { Failure, Strength } from "./physics";
import { minimumRadius, pieceShapes, Renderer, treeShapes } from "./render";
import { Sea, type SeaSettings } from "./sea";
import type { Species } from "./species";
import { SpoutControl } from "./spout-control";
import {
  type Bounds,
  type Growth,
  type GrowthMode,
  type Obstacle,
  type Pick,
  Tree,
} from "./tree";
import { at, clamp, invariant } from "./util";
import { Weather, type WeatherSettings } from "./weather";
import { type StrandHover, Willows } from "./willows";
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
/** The clock in the corner moves on this many minutes at a time, so it ticks calmly. */
const CLOCK_STEP_MINUTES = 15;
/** How close to a spout, in CSS pixels, the pointer must be to pick it. */
const SPOUT_PICK_PX = 10;
/** How fast energy dots ride up the wood, in CSS pixels per second. */
const DOT_SPEED_PX = 90;
/** A press must move this far, in CSS pixels, before it pans the view, so a click stays a click. */
const PAN_THRESHOLD_PX = 3;
/** On ground falling away below the tree, the hint sits this far below the lowest of it kept in view. */
const HINT_BELOW_DEPTH_PX = 4;
/**
 * How far each pixel of scrolling zooms, in natural log of the zoom factor: once for a mouse
 * wheel, and once for a trackpad pinch, which scrolls far less for the same gesture.
 */
const ZOOM_PER_PX = { wheel: 0.0015, pinch: 0.01 } as const;
/** What the hint under the ground says in each growth mode. */
const HINTS: Record<GrowthMode, string> = {
  steer:
    "<span>Hold <kbd>↑</kbd> to grow</span><span><kbd>←</kbd> <kbd>→</kbd> to steer</span><span>Click a limb to select it, again to fork</span><span>Hold <kbd>C</kbd> and click to prune</span><span>Drag to pan, scroll to zoom, <kbd>F</kbd> to follow the tree</span><span><kbd>R</kbd> to replant</span>",
  flow: "<span>The roots feed every tip</span><span><kbd>←</kbd> <kbd>→</kbd> to steer</span><span>Click a limb to select it, again to fork</span><span>Click a spout to split the flow</span><span>Hold <kbd>C</kbd> and click to prune</span><span>Drag to pan, scroll to zoom, <kbd>F</kbd> to follow the tree</span><span><kbd>R</kbd> to replant</span>",
};

function element<T extends HTMLElement>(
  selector: string,
  type: new () => T,
): T {
  const found = document.querySelector(selector);
  invariant(found instanceof type, `Missing ${selector}.`);
  return found;
}

const stage = element("#stage", HTMLDivElement);
const canvas = element("#scene", HTMLCanvasElement);
const hint = element("#hint", HTMLDivElement);
const message = element("#message", HTMLDivElement);
const hud = element("#clock", HTMLDivElement);
const camera = new Camera();
const renderer = new Renderer(canvas);
const keyboard = new Keyboard(window);
const panel = new DebugPanel(element("#app", HTMLDivElement));
const wind = new Wind(panel.wind);
/** Where the tree grows. */
let level: Level = levelById(panel.world.level);
const weather = new Weather(panel.weather, level);
const clouds = new Clouds(panel.weather);
const sea = new Sea(panel.sea, level);
sea.settle(wind, panel.time.timeOfDay);
const spoutControl = new SpoutControl(stage);
const dots = new FlowDots();
/** A cherry's blossoms, and a willow's hanging strands: what grows on the thin wood of each. */
const flowers = new Flowers();
const willows = new Willows();
const hives = new Hives();
const birds = new Birds();
const bears = new Bears();

/** Where every tree is planted, along the ground. */
const PLANTING_X = 0;

let seed = 1;
/** The standing tree. Gone once it falls, until the next one is planted. */
let tree: Tree | undefined = new Tree(
  PLANTING_X,
  seed,
  level,
  panel.planting.species,
);
const debris: Debris[] = [];
let pointer: { x: number; y: number } | undefined;
/** Whether shift is held, which turns a click on the tree into placing or knocking off a flower. */
let shiftHeld = false;
/** Whether C is held, which turns a click on a limb into pruning it there. */
let pruneHeld = false;
/** Whether H is held, which turns a click on a limb into hanging a hive from it there. */
let hiveHeld = false;
/** Whether the next click on a limb hangs a hive there, as the debug panel's button asks. */
let placingHive = false;
/** Seconds of simulated time so far, which set the stars twinkling. */
let clock = 0;
/** What the selected limb last ran into as it was grown, so the news is given only once. */
let blockedBefore: Obstacle | undefined;
/**
 * A press that pans the view as it drags: where the pointer was last, and whether it has moved
 * far enough to count as a drag yet.
 */
let panning:
  { pointerId: number; x: number; y: number; dragging: boolean } | undefined;
let messageTimer: number | undefined;
/**
 * When set, frames still draw but time stands still, so a script can step the simulation exactly.
 * Set by the debug hook, or from the start by loading the page with `?frozen` in development.
 */
let frozen =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).has("frozen");

function resize(): void {
  camera.resize(stage.clientWidth, stage.clientHeight, window.devicePixelRatio);
  renderer.resize(camera);
}

/** Where a pointer event happened, in the scene's CSS pixels. */
function onScene(event: MouseEvent): { x: number; y: number } {
  const box = canvas.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

/**
 * Keeps the hint in the ground, a little below its edge, wherever panning has put the ground; on
 * ground that falls away below the tree, along the lowest of it in view.
 */
function placeHint(): void {
  const below =
    level.depth < 0
      ? camera.toScreen(0, level.depth).y + HINT_BELOW_DEPTH_PX
      : camera.groundRow + (camera.height - camera.groundY) * 0.42;
  const top = `${below}px`;
  if (hint.style.top !== top) {
    hint.style.top = top;
  }
}

function replant(): void {
  seed += 1;
  tree = new Tree(PLANTING_X, seed, level, panel.planting.species);
  spoutControl.close();
  dots.clear();
  flowers.clear();
  willows.clear();
  hives.clear();
  bears.clear();
  camera.release();
}

/** Points the camera at what `level` keeps in view: its horizon, and any ground below the tree. */
function frameLevel(): void {
  camera.horizon = level.horizon;
  camera.depth = level.depth;
  camera.lead = level.lead;
  camera.reach = level.reach;
}

/** Moves the scene to `next`, clearing everything from the last level, and plants a tree there. */
function useLevel(next: Level): void {
  level = next;
  frameLevel();
  weather.setLevel(level);
  sea.setLevel(level);
  sea.settle(wind, panel.time.timeOfDay);
  debris.length = 0;
  birds.clear();
  replant();
  const view = framing();
  if (view !== undefined) {
    camera.snap(view);
  }
}

/** Starts a press on the canvas that pans the view once it drags. */
function startPanning(event: PointerEvent): void {
  panning = { pointerId: event.pointerId, ...onScene(event), dragging: false };
  canvas.setPointerCapture(event.pointerId);
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

/** Shows the time and the season in the corner, in ink that shows against the sky in `light`. */
function showClock(light: SkyLight): void {
  const { timeOfDay, season } = panel.time;
  const text = `${clockTime(timeOfDay, CLOCK_STEP_MINUTES)} · ${seasonName(season)}`;
  if (hud.textContent !== text) {
    hud.textContent = text;
  }
  const color = css(light.guide);
  if (hud.style.color !== color) {
    hud.style.color = color;
  }
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

/**
 * Knocks off the flower under (x, y) in CSS pixels, or grows one on the thin wood there: a cherry's
 * blossoms, or a willow's hanging strand.
 */
function tendFlowers(standing: Tree, x: number, y: number): void {
  const world = camera.toWorld(x, y);
  const reach = PICK_TOLERANCE_PX / camera.scale;
  const pick = pickAt(standing, x, y);
  switch (standing.species) {
    case "cherry":
      if (flowers.knockOff(standing, world.x, world.y, reach, panel.flowers)) {
        return;
      }
      if (pick !== undefined && !flowers.place(pick)) {
        announce("Flowers only grow on thin wood");
      }
      return;
    case "willow":
      if (willows.knockOff(standing, world.x, world.y, reach)) {
        return;
      }
      if (pick !== undefined && !willows.place(pick)) {
        announce("Strands only hang from thin wood");
      }
      return;
    default: {
      const unknown: never = standing.species;
      throw new Error(`Unknown species ${String(unknown)}.`);
    }
  }
}

/** What a shift-click at (x, y) in CSS pixels would do to a cherry's flowers. */
function flowerHoverAt(standing: Tree, x: number, y: number): FlowerHover {
  const world = camera.toWorld(x, y);
  return flowers.hover(
    standing,
    world.x,
    world.y,
    PICK_TOLERANCE_PX / camera.scale,
    pickAt(standing, x, y),
    panel.flowers,
    panel.time.season,
  );
}

/** What a shift-click at (x, y) in CSS pixels would do to a willow's strands. */
function strandHoverAt(standing: Tree, x: number, y: number): StrandHover {
  const world = camera.toWorld(x, y);
  return willows.hover(
    standing,
    world.x,
    world.y,
    PICK_TOLERANCE_PX / camera.scale,
    pickAt(standing, x, y),
    panel.flowers,
    panel.time.season,
    sea,
  );
}

/** Severs `limb` at `s` and lets everything beyond fall, keeping the motion it had. */
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
  flowers.cut(standing, limb, s, panel.flowers);
  willows.cut(standing, limb, s);
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
  const s = standing.prunePoint(failure.limb, failure.s);
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
  // Bears act first, so whatever they push on is still on the tree when it moves.
  const pushes = bears.update(
    dt,
    {
      level,
      tree,
      hives: hives.targets(),
      fallenHives: hives.fallenHives(),
      debris,
      camera,
    },
    panel.bears,
  );
  if (tree !== undefined) {
    const standing = tree;
    for (const push of pushes) {
      standing.physics.push(push);
    }
    for (const failure of standing.update(
      dt,
      controls,
      wind,
      panel.strength,
      growth,
      [
        ...flowers.loads(standing),
        ...willows.loads(standing),
        ...hives.loads(standing),
        ...birds.loads(standing),
      ],
    )) {
      if (tree !== standing) {
        break;
      }
      giveWay(standing, failure);
    }
    if (standing.blocked !== undefined && standing.blocked !== blockedBefore) {
      announce(`The ${standing.blocked} is in the way`);
    }
    blockedBefore = standing.blocked;
  }
  advanceDay(panel.time, dt);
  clock += dt;
  sea.update(dt, wind, panel.time.timeOfDay);
  const conditions = {
    season: panel.time.season,
    wind,
    melt: weather.melt,
    hold: panel.strength.flowers,
    flowing: growth.mode === "flow",
    level,
    water: sea,
  };
  // Each tends only what grows on its own species of tree; the other only lets its last fall.
  flowers.update(
    dt,
    tree?.species === "cherry" ? tree : undefined,
    panel.flowers,
    conditions,
  );
  willows.update(
    dt,
    tree?.species === "willow" ? tree : undefined,
    panel.flowers,
    conditions,
  );
  debris.push(
    ...hives.update(dt, tree, panel.wildlife, {
      wind,
      daylight: skyAt(panel.time.timeOfDay).daylight,
      blooms: [...flowers.blooms(panel.flowers), ...willows.blooms()],
      hold: panel.strength.flowers,
      melt: weather.melt,
      threats: bears.threats(),
    }),
  );
  birds.update(dt, tree, camera, panel.birds);
  weather.update(
    dt,
    wind,
    camera,
    [
      ...flowers.catchers(panel.flowers),
      ...willows.catchers(panel.flowers),
      ...(tree === undefined ? [] : hives.catchers(tree)),
    ],
    sea,
  );
  clouds.update(dt, wind, camera, skyAt(panel.time.timeOfDay));
  if (tree !== undefined && growth.mode === "flow") {
    dots.update(dt, tree, growth.flowRate, DOT_SPEED_PX / camera.scale);
  } else {
    dots.clear();
  }
  for (const piece of debris) {
    piece.update(dt, wind, level, sea);
  }
  for (let i = debris.length - 1; i >= 0; i -= 1) {
    if (at(debris, i).done) {
      debris.splice(i, 1);
    }
  }
}

resize();
frameLevel();
camera.snap(tree.bounds());
showGrowthMode(panel.growth.mode);
panel.onGrowthMode = showGrowthMode;
panel.onFinishHives = () => hives.finish();
panel.onPlaceHive = () => {
  placingHive = true;
};
panel.onLevel = (id: LevelId) => useLevel(levelById(id));
panel.onSpecies = () => {
  replant();
  const view = framing();
  if (view !== undefined) {
    camera.snap(view);
  }
};
panel.onSendBear = () => bears.spawn(camera, level);
panel.onShowBear = (pose: BearPose) => bears.show(pose, camera, level, tree);
panel.onClearBears = () => bears.clear();
// The scene resizes with the window, and as the debug panel beside it opens and closes.
new ResizeObserver(resize).observe(stage);
window.addEventListener("resize", resize);
window.addEventListener("keydown", (event) => {
  if (event.key === "Shift") {
    shiftHeld = true;
  }
  if (event.code === "KeyC") {
    pruneHeld = true;
  }
  if (event.code === "KeyH") {
    hiveHeld = true;
  }
  if (event.code === "KeyR" && !event.repeat) {
    replant();
  }
  if (event.code === "KeyF" && !event.repeat) {
    camera.release();
  }
  if (event.code === "Escape") {
    spoutControl.close();
    placingHive = false;
  }
});
window.addEventListener("keyup", (event) => {
  if (event.key === "Shift") {
    shiftHeld = false;
  }
  if (event.code === "KeyC") {
    pruneHeld = false;
  }
  if (event.code === "KeyH") {
    hiveHeld = false;
  }
});
window.addEventListener("blur", () => {
  shiftHeld = false;
  pruneHeld = false;
  hiveHeld = false;
});
canvas.addEventListener("pointermove", (event) => {
  pointer = onScene(event);
  shiftHeld = event.shiftKey;
  if (panning === undefined || event.pointerId !== panning.pointerId) {
    return;
  }
  const dx = pointer.x - panning.x;
  const dy = pointer.y - panning.y;
  if (!panning.dragging && Math.hypot(dx, dy) < PAN_THRESHOLD_PX) {
    return;
  }
  panning = { ...panning, ...pointer, dragging: true };
  camera.pan(dx, dy);
});
canvas.addEventListener("pointerleave", () => {
  pointer = undefined;
});
for (const type of ["pointerup", "pointercancel"] as const) {
  canvas.addEventListener(type, (event) => {
    if (event.pointerId === panning?.pointerId) {
      panning = undefined;
    }
  });
}
// Scrolling zooms in and out around the foot of the tree, so zooming all the way in lands on its
// trunk. Once the player has dragged the view elsewhere, it zooms around the pointer instead.
canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const pixels =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaY * 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? event.deltaY * camera.height
          : event.deltaY;
    // A trackpad pinch arrives as a scroll with the control key held.
    const rate = event.ctrlKey ? ZOOM_PER_PX.pinch : ZOOM_PER_PX.wheel;
    const around = camera.panned
      ? onScene(event)
      : camera.toScreen(PLANTING_X, 0);
    camera.zoom(Math.exp(-pixels * rate), around.x, around.y);
  },
  { passive: false },
);
// Clicking a limb makes it the one that grows and steers. Clicking the limb that already is
// forks a new offshoot from that spot. Holding C, a click prunes the limb there instead, and
// everything beyond falls; holding H, a click hangs a hive from the limb there, to be built. In
// flow mode, clicking a spout opens it; a click anywhere else just
// closes the open one. While flowers are placed by hand, a shift-click places or knocks off a
// flower instead. Dragging from open space, or with the middle button from anywhere, pans the
// view.
canvas.addEventListener("pointerdown", (event) => {
  if (event.button === 1) {
    event.preventDefault();
    startPanning(event);
    return;
  }
  if (event.button !== 0) {
    return;
  }
  if (tree === undefined) {
    startPanning(event);
    return;
  }
  const { x, y } = onScene(event);
  if (pruneHeld) {
    const pick = pickAt(tree, x, y);
    if (pick === undefined) {
      startPanning(event);
      return;
    }
    const s = tree.prunePoint(pick.limb, pick.s);
    if (s !== undefined) {
      breakOff(tree, pick.limb, s);
    }
    return;
  }
  if (hiveHeld || placingHive) {
    const pick = pickAt(tree, x, y);
    if (pick === undefined) {
      startPanning(event);
      return;
    }
    hives.place(pick.limb, pick.s);
    placingHive = false;
    return;
  }
  if (placingFlowers(event)) {
    tendFlowers(tree, x, y);
    return;
  }
  if (panel.growth.mode === "flow") {
    const spout = spoutAt(tree, x, y);
    if (spout !== undefined) {
      spoutControl.open(spout);
      return;
    }
  }
  const pick = pickAt(tree, x, y);
  if (spoutControl.limb !== undefined) {
    spoutControl.close();
  } else if (pick !== undefined && pick.limb === tree.active) {
    tree.fork(pick.limb, pick.s, pick.side);
  } else if (pick !== undefined) {
    tree.select(pick.limb);
  }
  if (pick === undefined) {
    startPanning(event);
  }
});
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(MAX_STEP, (now - last) / 1000);
  last = now;
  const controls = keyboard.controls();
  if (!frozen) {
    // Faster speeds take more steps of the same size, so the simulation behaves the same.
    for (let i = 0; i < panel.simulationSpeed; i += 1) {
      step(dt, controls);
    }
  }
  const view = framing();
  if (view !== undefined) {
    camera.follow(view, dt);
  }
  const light = clouds.shine(skyAt(panel.time.timeOfDay));
  if (panel.time.dayRunning) {
    panel.showTimeOfDay();
  }
  panel.showSea(sea.significantHeight);
  showClock(light);
  const flowing = tree !== undefined && panel.growth.mode === "flow";
  const tending =
    tree !== undefined &&
    pointer !== undefined &&
    placingFlowers({ shiftKey: shiftHeld });
  const flowerHover =
    tending && tree?.species === "cherry" && pointer !== undefined
      ? flowerHoverAt(tree, pointer.x, pointer.y)
      : undefined;
  const strandHover =
    tending && tree?.species === "willow" && pointer !== undefined
      ? strandHoverAt(tree, pointer.x, pointer.y)
      : undefined;
  const hoveredSpout =
    flowing && tree !== undefined && pointer !== undefined && !tending
      ? spoutAt(tree, pointer.x, pointer.y)
      : undefined;
  const hover =
    tree === undefined ||
    pointer === undefined ||
    hoveredSpout !== undefined ||
    tending
      ? undefined
      : pickAt(tree, pointer.x, pointer.y);
  const pointing =
    hover !== undefined ||
    hoveredSpout !== undefined ||
    flowerHover?.ghost !== undefined ||
    flowerHover?.target !== undefined ||
    strandHover?.ghost !== undefined ||
    strandHover?.target !== undefined;
  canvas.style.cursor =
    panning?.dragging === true
      ? "grabbing"
      : (pruneHeld || hiveHeld || placingHive) && hover !== undefined
        ? "crosshair"
        : pointing
          ? "pointer"
          : "grab";
  placeHint();
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
    level,
    mountains: panel.world.mountains,
    fieldColors: panel.world.fieldColors,
    light,
    season: panel.time.season,
    clock,
    tree,
    debris,
    hover,
    strain: panel.showStrain,
    flowers: flowers.views(panel.flowers, panel.time.season),
    flowerHover,
    willow: willows.views(panel.flowers, panel.time.season),
    strandHover,
    flow: flowing
      ? { dots: dots.dots, hoveredSpout, openSpout: spoutControl.limb }
      : undefined,
    weather,
    sea,
    clouds,
    hives: hives.views(),
    bees: hives.bees(),
    birds: birds.views(),
    bears: bears.views(),
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
  /** Prunes limb `index` at `fraction` of its length, like a click with C held. */
  prune(index: number, fraction: number): void;
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
  /** Changes the time of day and of year, as the debug panel would. */
  time(settings: Partial<TimeSettings>): void;
  /** Changes the rain and snow, as the debug panel would. */
  weather(settings: Partial<WeatherSettings>): void;
  /** The rain and snow falling, and the snow lying on the ground and the barn. */
  weatherState(): Weather;
  /** Changes the sea, as the debug panel would. */
  sea(settings: Partial<SeaSettings>): void;
  /** The sea's waves, foam and spray. */
  seaState(): Sea;
  /** Sets the sea at once to how its settings and the wind would build it, as a sea long settled. */
  settleSea(): void;
  /**
   * Grows a flower by hand at `fraction` of limb `index`'s length, on its `side` (1 left, -1
   * right), like a shift-click.
   */
  placeFlower(index: number, fraction: number, side: 1 | -1): void;
  /**
   * How many flowers are on the tree, and how many have come off and not yet faded: a cherry's
   * blossoms or a willow's strands.
   */
  flowerCount(): { onTree: number; falling: number };
  /** The willow's strands and the leaves falling from them. */
  willows(): Willows;
  /** Hangs a hive at `fraction` of limb `index`'s length, to be built, like an H-click. */
  placeHive(index: number, fraction: number): void;
  /** The hives and their bees. */
  hives(): Hives;
  /** Changes the hives, as the debug panel would. */
  wildlife(settings: Partial<HiveSettings>): void;
  /** The birds about the scene. */
  birds(): Birds;
  /** Changes how often birds come and land, as the debug panel would. */
  birdSettings(settings: Partial<BirdSettings>): void;
  /** The bears about the scene. */
  bears(): Bears;
  /** Moves the scene to another level, as the debug panel would, and plants a tree there. */
  level(id: LevelId): void;
  /** Plants a tree of another species afresh, as the debug panel would. */
  species(id: Species): void;
  /** Changes where the tree grows, as the debug panel would. */
  world(settings: Partial<WorldSettings>): void;
  /** Sends a bear in from the edge of the view. */
  sendBear(): void;
  /** Shows a bear playing `pose` in place. */
  showBear(pose: BearPose): void;
  /** Changes whether hives draw bears, as the debug panel would. */
  bearSettings(settings: Partial<BearSettings>): void;
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
    prune(index, fraction) {
      const limb = at(standing().limbs, index);
      const s = standing().prunePoint(limb, limb.length * fraction);
      invariant(
        s !== undefined,
        `Nothing to prune at ${fraction} of limb ${index}.`,
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
    time(settings) {
      panel.setTime(settings);
    },
    weather(settings) {
      panel.setWeather(settings);
    },
    weatherState() {
      return weather;
    },
    sea(settings) {
      panel.setSea(settings);
    },
    seaState: () => sea,
    settleSea() {
      sea.settle(wind, panel.time.timeOfDay);
    },
    placeFlower(index, fraction, side) {
      const limb = at(standing().limbs, index);
      const pick = { limb, s: limb.length * fraction, side };
      invariant(
        standing().species === "willow"
          ? willows.place(pick)
          : flowers.place(pick),
        `No wood on limb ${index} is thin enough for a flower.`,
      );
    },
    flowerCount: () =>
      standing().species === "willow" ? willows.count() : flowers.count(),
    willows: () => willows,
    placeHive(index, fraction) {
      const limb = at(standing().limbs, index);
      hives.place(limb, limb.length * fraction);
    },
    hives: () => hives,
    wildlife(settings) {
      panel.setWildlife(settings);
    },
    birds: () => birds,
    birdSettings(settings) {
      panel.setBirds(settings);
    },
    bears: () => bears,
    level(id) {
      panel.setWorld({ level: id });
    },
    species(id) {
      panel.setPlanting({ species: id });
    },
    world(settings) {
      panel.setWorld(settings);
    },
    sendBear() {
      bears.spawn(camera, level);
    },
    showBear(pose) {
      bears.show(pose, camera, level, tree);
    },
    bearSettings(settings) {
      panel.setBears(settings);
    },
    freeze() {
      frozen = true;
    },
  };
}
