import type { Camera } from "./camera";
import { css, lit, mix, type Rgb } from "./sky";
import { at, clamp, hash, lerp, smoothstep, wrapAngle } from "./util";
import { SNOW_COLOR } from "./weather";
import {
  CATKINS,
  hasCatkin,
  type Leaf,
  LEAVES,
  leafSize,
  leavesOf,
  type LeafView,
  STRANDS,
  type StrandView,
  type WillowView,
} from "./willows";
import type { Vec } from "./wind";

/** Snow lying on a strand as deep as it holds hides this much of its leaves' color. */
const SNOW_COVER = 0.8;

/**
 * Colors of a living leaf: deep green where it leaves the twig, paling to yellow-green at its tip,
 * after the light, fresh green of a willow in leaf.
 */
const LIVING: { base: Rgb; tip: Rgb } = {
  base: [88, 120, 52],
  tip: [204, 214, 116],
};

/** The pale, silvery underside a leaf shows when the wind turns it over. */
const SILVER: Rgb = [200, 207, 188];

/** A color leaves turn late in the year, blending in over its span of the year. */
interface Stage {
  from: number;
  to: number;
  base: Rgb;
  tip: Rgb;
}

/**
 * Colors willow leaves turn as the year ends, in order, from midsummer at 0 to winter at 1: a
 * yellowing green, then clear gold, then old gold and brown as the last of them drop.
 */
const AUTUMN: readonly Stage[] = [
  { from: 0.26, to: 0.44, base: [140, 138, 58], tip: [214, 206, 108] },
  { from: 0.44, to: 0.62, base: [196, 156, 48], tip: [240, 214, 106] },
  { from: 0.66, to: 0.86, base: [164, 118, 52], tip: [214, 172, 88] },
  { from: 0.86, to: 0.98, base: [116, 84, 50], tip: [156, 118, 72] },
];

/**
 * The shadow, middle and light tones leaves are painted in: so far from a leaf's color where it
 * leaves the twig toward the color at its tip, then darkened to `shade`. The fourth is the
 * silvered underside of a leaf the wind has turned over.
 */
const TONES: readonly { toTip: number; shade: number }[] = [
  { toTip: 0.12, shade: 0.88 },
  { toTip: 0.5, shade: 1 },
  { toTip: 0.9, shade: 1 },
];
const SILVER_TONE = TONES.length;

/**
 * Leaves turn a little earlier or later than their strand, by up to `LEAVES.turns`. They are
 * painted in this many steps of it, so a strand's leaves share a few colors rather than one each.
 */
const TURN_STEPS = 4;

/**
 * How leaves are painted, after the populated trees of the references: every leaf a flat mark with
 * no outline, in a shadow, middle or light tone.
 */
const MARKS = {
  /** No leaf's mark is shorter than this, in CSS pixels. */
  minPx: 3.2,
  /**
   * No leaf's mark is narrower than this, in CSS pixels, so the leaves still read from afar, nor
   * wider than `stoutest` of its length, so from afar they read as fine strokes, like hatching.
   */
  thinnestPx: 0.9,
  stoutest: 0.3,
  /**
   * Leaves overlap thickly along a strand. Far off, where they would come closer than this along it
   * in CSS pixels, one in so many is painted, wider to cover for the rest.
   */
  gapPx: 2.6,
  /** Most leaves painted in a frame; past it, every strand is painted with fewer, wider ones. */
  budget: 30000,
  /** Leaves showing longer than this, in CSS pixels, take their full shape; smaller, a plainer one. */
  shapedPx: 7,
  /**
   * How a leaf's tone is chosen: from how high along its strand it hangs, how open its strand is
   * to the sky, whether its strand hangs in front of the wood, and a little at random. Below
   * `shadow` it takes the shadow tone, from `light` up the light one, and the middle tone between.
   */
  tone: {
    lit: 0.4,
    exposure: 0.5,
    front: 0.24,
    jitter: 0.5,
    shadow: 0.3,
    light: 0.64,
  },
  /** Strands behind the wood hang in its shade, every tone darkened to this. */
  behind: 0.88,
} as const;

/**
 * Leaves showing longer than `from` CSS pixels come into detail, their outlines fading in until
 * `to`, and their midribs showing from `rib`. Only so many are drawn in detail at once, those
 * nearest the middle of the view first.
 */
const DETAIL = {
  from: 18,
  to: 40,
  rib: 26,
  budget: 2600,
  /**
   * Width of the outlines and midribs, in CSS pixels, and how strongly they show: softer than a
   * blossom's, as a leaf is so narrow that a full line of ink would darken it.
   */
  line: 0.6,
  alpha: 0.5,
} as const;

/**
 * How leaves move in the wind: each streams toward the way it blows by up to `stream`, and flutters
 * by up to `angle` radians, both at full strength in a wind of `full` meters per second; and the
 * wind turns over up to `flip` of them at a time to show their silver undersides.
 */
const FLUTTER = { stream: 0.55, angle: 0.42, full: 14, flip: 0.85 } as const;

/** A twig is never drawn thinner than this, in CSS pixels, nor fainter than `TWIG_FAINTEST`. */
const TWIG_THINNEST_PX = 0.55;
const TWIG_FAINTEST = 0.4;

/**
 * Every strand hangs as a tress, after the willows of the references: past its arch it parts into
 * a few threads, its own carrying on the longest and the others fanning out a little to either side
 * of it, shorter, so the tress tapers to a point. The fan breathes as the wind flutters it.
 */
const TRESS = {
  /** Threads in a tress, the strand's own among them. */
  fewest: 2,
  most: 4,
  /** Each other thread's length, as a share of the strand's, from shortest to longest. */
  share: { from: 0.45, to: 0.9 },
  /** How far each fans out from the strand, in radians, from least to most. */
  splay: { from: 0.03, to: 0.1 },
  /** Where the threads part, in meters along the strand, or this share of a short one. */
  part: 0.3,
  partShare: 0.3,
  /** The other threads' twigs are this much as stout as the strand's. */
  thinner: 0.7,
  /** How much the fan opens and closes as the wind flutters it, as a share of its spread. */
  breathe: 0.3,
} as const;

/** Catkin colors: silver while closed in the bud, gold open, and brown as they wither. */
const CATKIN = {
  bud: [206, 204, 192] as Rgb,
  sheen: [238, 236, 228] as Rgb,
  open: [214, 180, 54] as Rgb,
  pollen: [246, 222, 108] as Rgb,
  withered: [146, 120, 72] as Rgb,
  /** Catkins showing longer than this, in CSS pixels, show their stamens. */
  detailPx: 9,
};

/** Where a strand runs on screen: its nodes, how far along it each is in meters, and how they curve. */
interface Course {
  points: readonly Vec[];
  along: readonly number[];
  /** The way it runs at each node, in CSS pixels per meter along it. */
  slopes: readonly Vec[];
}

/** Paths gathered for one color of leaf, or of catkin, all filled at once. */
interface Batch {
  color: Rgb;
  alpha: number;
  path: Path2D;
}

/** Paints in one layer of the strands, as they will be filled. */
interface Paints {
  batches: Map<string, Batch>;
  twigs: Map<number, Path2D>;
  outlines: Map<number, Path2D>;
  snow: Map<number, { path: Path2D; width: number }>;
}

/**
 * Draws the strands of one layer, those hanging behind the wood or those in front of it, and the
 * leaves falling: each strand a fine twig of ink dressed in leaf marks, its catkins among them,
 * every leaf streaming and fluttering in the wind it hangs in. Close in, leaves come into detail,
 * outlined in ink with their midribs. `light` is the light on the flowers, `ink` the wood's ink.
 */
export function drawWillow(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  view: WillowView,
  front: boolean,
  light: Rgb,
  ink: Rgb,
): void {
  const strands = view.strands.filter(
    (strand) => strand.front === front && inView(camera, strand),
  );
  const paints: Paints = {
    batches: new Map(),
    twigs: new Map(),
    outlines: new Map(),
    snow: new Map(),
  };
  const leafPx = LEAVES.length * camera.scale;
  const focus = { x: camera.width / 2, y: camera.height / 2 };
  let detailLeft = leafPx >= DETAIL.from ? DETAIL.budget : 0;
  // Strands nearest the middle of the view take the detail first.
  const courses = strands.map((strand) => courseOf(camera, strand));
  const order = strands
    .map((_, i) => i)
    .sort(
      (a, b) =>
        distanceFrom(at(courses, a), focus) -
        distanceFrom(at(courses, b), focus),
    );
  const tresses = order.map((i) =>
    threadsOf(camera, at(strands, i), at(courses, i), view.time),
  );
  const every = thinning(tresses.flat(), camera.scale);
  for (const [k, i] of order.entries()) {
    const strand = at(strands, i);
    for (const thread of at(tresses, k)) {
      addTwig(paints, camera, thread.strand, thread.course);
      detailLeft -= addLeaves(
        paints,
        camera,
        thread.strand,
        thread.course,
        view.time,
        every,
        detailLeft,
        thread.from,
      );
    }
    addSnow(paints, camera, strand, at(courses, i));
  }
  ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
  ctx.fillStyle = css(ink);
  for (const [alpha, path] of paints.twigs) {
    ctx.globalAlpha = alpha;
    ctx.fill(path);
  }
  fillBatches(ctx, paints.batches, light);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = css(ink);
  ctx.lineWidth = DETAIL.line;
  for (const [alpha, path] of paints.outlines) {
    ctx.globalAlpha = alpha;
    ctx.stroke(path);
  }
  ctx.strokeStyle = css(lit(SNOW_COLOR, light));
  for (const [alpha, { path, width }] of paints.snow) {
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.stroke(path);
  }
  ctx.globalAlpha = 1;
}

/** Draws the leaves that came off the strands, each in the color it had when it fell. */
export function drawFallingLeaves(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  leaves: readonly LeafView[],
  light: Rgb,
  ink: Rgb,
): void {
  const batches = new Map<string, Batch>();
  const outlines = new Map<number, Path2D>();
  for (const leaf of leaves) {
    const base = camera.toScreen(leaf.x, leaf.y);
    const length = Math.max(leaf.size * camera.scale, 1.5);
    if (
      base.x < -length ||
      base.y < -length ||
      base.x > camera.width + length ||
      base.y > camera.height + length
    ) {
      continue;
    }
    const age = Math.round(leaf.age * 50) / 50;
    const alpha = Math.round(leaf.alpha * 10) / 10;
    const tone = 1 + (leaf.variant > 0.6 ? 1 : 0);
    const path = batchFor(batches, `${tone} ${age} ${alpha}`, () => {
      const colors = leafColors(age, 0);
      return { color: toneColor(colors, tone), alpha };
    });
    const way = { x: Math.cos(leaf.angle), y: -Math.sin(leaf.angle) };
    const width = Math.max(MARKS.thinnestPx, LEAVES.width * length);
    addLeaf(
      path,
      base,
      way,
      length,
      width,
      (leaf.variant - 0.5) * 0.9,
      length >= MARKS.shapedPx,
    );
    if (length >= DETAIL.from) {
      const strength = smoothstep(DETAIL.from, DETAIL.to, length);
      const key = Math.round(DETAIL.alpha * strength * leaf.alpha * 10) / 10;
      let outline = outlines.get(key);
      if (outline === undefined) {
        outline = new Path2D();
        outlines.set(key, outline);
      }
      addLeaf(
        outline,
        base,
        way,
        length,
        width,
        (leaf.variant - 0.5) * 0.9,
        true,
      );
    }
  }
  ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
  fillBatches(ctx, batches, light);
  ctx.strokeStyle = css(ink);
  ctx.lineWidth = DETAIL.line;
  ctx.lineJoin = "round";
  for (const [alpha, path] of outlines) {
    ctx.globalAlpha = alpha;
    ctx.stroke(path);
  }
  ctx.globalAlpha = 1;
}

/** Whether any of a strand could show in the view, leaves, fanning threads and all. */
function inView(camera: Camera, strand: StrandView): boolean {
  const margin =
    (LEAVES.length + TRESS.splay.to * strand.length) * camera.scale + 2;
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const point of strand.points) {
    const p = camera.toScreen(point.x, point.y);
    left = Math.min(left, p.x);
    right = Math.max(right, p.x);
    top = Math.min(top, p.y);
    bottom = Math.max(bottom, p.y);
  }
  return (
    right + margin >= 0 &&
    left - margin <= camera.width &&
    bottom + margin >= 0 &&
    top - margin <= camera.height
  );
}

/**
 * How few of their leaves the strands are painted with, one in so many, so that those painted come
 * no closer than `MARKS.gapPx` along a strand at `scale` CSS pixels to the meter, and all of them
 * together stay within what a frame can afford.
 */
function thinning(threads: readonly Thread[], scale: number): number {
  const gap = LEAVES.spacing * scale;
  const close =
    gap >= MARKS.gapPx ? 1 : 2 ** Math.ceil(Math.log2(MARKS.gapPx / gap));
  const total = threads.reduce(
    (sum, thread) =>
      sum + (thread.strand.length - thread.from) / LEAVES.spacing,
    0,
  );
  const crowded =
    total / close > MARKS.budget
      ? 2 ** Math.ceil(Math.log2(total / close / MARKS.budget))
      : 1;
  return close * crowded;
}

/** Where a strand runs on screen, and how it curves through its nodes. */
function courseOf(camera: Camera, strand: StrandView): Course {
  return slopesOf(
    strand.points.map((p) => camera.toScreen(p.x, p.y)),
    strand.along,
  );
}

/**
 * One thread of a tress: drawn as a strand of its own along its course, with leaves from `from`
 * meters along it, past where it parts from the strand.
 */
interface Thread {
  strand: StrandView;
  course: Course;
  from: number;
}

/**
 * The threads of the tress a strand hangs as: its own, then the others, each following the strand
 * down from where they part, fanned out a little to one side of it, and opening and closing a little
 * as the wind flutters it.
 */
function threadsOf(
  camera: Camera,
  strand: StrandView,
  course: Course,
  time: number,
): Thread[] {
  const threads: Thread[] = [{ strand, course, from: 0 }];
  const part = Math.min(TRESS.part, TRESS.partShare * strand.length);
  const count =
    TRESS.fewest +
    Math.floor(
      hash(1, strand.variant * 1000) * (TRESS.most - TRESS.fewest + 1),
    );
  const speed = Math.hypot(strand.air.x, strand.air.y);
  const flutter = TRESS.breathe * Math.min(1, speed / FLUTTER.full);
  for (let k = 1; k < count; k += 1) {
    const h = (n: number): number => hash(k * 13 + n, strand.variant * 1000);
    const share = lerp(TRESS.share.from, TRESS.share.to, h(2));
    const length = strand.length * share;
    if (length <= part + LEAVES.spacing) {
      continue;
    }
    const side = k % 2 === 0 ? 1 : -1;
    const splay = side * lerp(TRESS.splay.from, TRESS.splay.to, h(3));
    const rate = 1.2 + 1.8 * h(4);
    const points: Vec[] = [];
    const along: number[] = [];
    const out = (s: number, p: Vec, slope: Vec): void => {
      const d = Math.hypot(slope.x, slope.y);
      const nx = d > 1e-9 ? -slope.y / d : 1;
      const ny = d > 1e-9 ? slope.x / d : 0;
      const open = 1 + flutter * Math.sin(time * rate + h(5) * 6.3 + s);
      const offset =
        Math.sin(splay) * Math.max(0, s - part) * open * camera.scale;
      points.push({ x: p.x + nx * offset, y: p.y + ny * offset });
      along.push(s);
    };
    for (const [i, s] of course.along.entries()) {
      if (s >= length) {
        break;
      }
      out(s, at(course.points, i), at(course.slopes, i));
    }
    const end = placeOn(course, length, 0);
    out(length, end.p, { x: end.way.x, y: end.way.y });
    if (points.length < 2) {
      continue;
    }
    const thread: StrandView = {
      ...strand,
      length,
      full: strand.full * share,
      root: strand.root * TRESS.thinner,
      variant: (strand.variant + 0.618 * k) % 1,
    };
    threads.push({
      strand: thread,
      course: slopesOf(points, along),
      from: part,
    });
  }
  return threads;
}

/** A course through `points`, `along` meters along their strand, its slope at each from its neighbors. */
function slopesOf(points: readonly Vec[], along: readonly number[]): Course {
  const count = points.length;
  const slopes: Vec[] = [];
  for (let i = 0; i < count; i += 1) {
    const before = Math.max(0, i - 1);
    const after = Math.min(count - 1, i + 1);
    const run = at(along, after) - at(along, before);
    const a = at(points, before);
    const b = at(points, after);
    slopes.push(
      run > 1e-9
        ? { x: (b.x - a.x) / run, y: (b.y - a.y) / run }
        : { x: 0, y: 1 },
    );
  }
  return { points, along, slopes };
}

/** How far the middle of a strand's course is from `focus`, in CSS pixels. */
function distanceFrom(course: Course, focus: Vec): number {
  const middle = at(course.points, Math.floor(course.points.length / 2));
  return Math.hypot(middle.x - focus.x, middle.y - focus.y);
}

/**
 * Where a strand's course is `s` meters along it, and the way it runs there as a unit vector: a
 * smooth curve through its nodes, its slope at each the slope of the chord across it.
 */
function placeOn(
  course: Course,
  s: number,
  from: number,
): { p: Vec; way: Vec; index: number } {
  const count = course.points.length;
  let i = clamp(from, 0, count - 2);
  while (i < count - 2 && at(course.along, i + 1) < s) {
    i += 1;
  }
  const s0 = at(course.along, i);
  const s1 = at(course.along, i + 1);
  const run = s1 - s0;
  const u = run > 1e-9 ? clamp((s - s0) / run, 0, 1) : 0;
  const p0 = at(course.points, i);
  const p1 = at(course.points, i + 1);
  const m0 = at(course.slopes, i);
  const m1 = at(course.slopes, i + 1);
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const p = {
    x: h00 * p0.x + h10 * run * m0.x + h01 * p1.x + h11 * run * m1.x,
    y: h00 * p0.y + h10 * run * m0.y + h01 * p1.y + h11 * run * m1.y,
  };
  const d00 = 6 * u2 - 6 * u;
  const d10 = 3 * u2 - 4 * u + 1;
  const d01 = -6 * u2 + 6 * u;
  const d11 = 3 * u2 - 2 * u;
  const dx = d00 * p0.x + d10 * run * m0.x + d01 * p1.x + d11 * run * m1.x;
  const dy = d00 * p0.y + d10 * run * m0.y + d01 * p1.y + d11 * run * m1.y;
  const d = Math.hypot(dx, dy);
  const way = d > 1e-9 ? { x: dx / d, y: dy / d } : { x: 0, y: 1 };
  return { p, way, index: i };
}

/**
 * Adds a strand's twig to its layer: a fine line of ink tapering from the wood to its tip. A twig
 * too fine to show at its true width is drawn at the thinnest a line shows, the fainter the finer
 * it truly is, so from afar it is a hairline under its leaves.
 */
function addTwig(
  paints: Paints,
  camera: Camera,
  strand: StrandView,
  course: Course,
): void {
  const length = strand.length;
  const steps = clamp(Math.ceil((length * camera.scale) / 8), 4, 90);
  const left: Vec[] = [];
  const right: Vec[] = [];
  let index = 0;
  let last: { p: Vec; way: Vec } = {
    p: at(course.points, 0),
    way: { x: 0, y: 1 },
  };
  for (let k = 0; k <= steps; k += 1) {
    const s = (length * k) / steps;
    const placed = placeOn(course, s, index);
    index = placed.index;
    const t = s / length;
    const radius = lerp(strand.root, STRANDS.twig.tip, Math.sqrt(t));
    const half = Math.max(TWIG_THINNEST_PX / 2, radius * camera.scale);
    left.push({
      x: placed.p.x - placed.way.y * half,
      y: placed.p.y + placed.way.x * half,
    });
    right.push({
      x: placed.p.x + placed.way.y * half,
      y: placed.p.y - placed.way.x * half,
    });
    last = placed;
  }
  const middle = (strand.root + STRANDS.twig.tip) * camera.scale;
  const faint = clamp(middle / TWIG_THINNEST_PX, TWIG_FAINTEST, 1);
  const alpha = Math.round(strand.alpha * faint * 20) / 20;
  let path = paints.twigs.get(alpha);
  if (path === undefined) {
    path = new Path2D();
    paints.twigs.set(alpha, path);
  }
  const first = at(left, 0);
  path.moveTo(first.x, first.y);
  for (const p of left) {
    path.lineTo(p.x, p.y);
  }
  const tip = Math.max(TWIG_THINNEST_PX / 2, STRANDS.twig.tip * camera.scale);
  const ahead = Math.atan2(last.way.y, last.way.x);
  path.arc(last.p.x, last.p.y, tip, ahead - Math.PI / 2, ahead + Math.PI / 2);
  for (const p of right.reverse()) {
    path.lineTo(p.x, p.y);
  }
}

/**
 * Adds a strand's leaves from `from` meters along it, and the catkins in their axils, to its layer,
 * one in `every` of them, and outlines up to `detail` of them. Returns how many it outlined.
 */
function addLeaves(
  paints: Paints,
  camera: Camera,
  strand: StrandView,
  course: Course,
  time: number,
  every: number,
  detail: number,
  from: number,
): number {
  const length = strand.length;
  const leafPx = LEAVES.length * camera.scale;
  // Painted one in `every`, each leaf is a little wider to cover for those left out.
  const widen = every ** 0.25;
  const speed = Math.hypot(strand.air.x, strand.air.y);
  const strength = Math.min(1, speed / FLUTTER.full);
  // The way the wind blows, on screen.
  const downwind = speed > 0 ? Math.atan2(-strand.air.y, strand.air.x) : 0;
  const age = Math.round(strand.age * 50) / 50;
  const snow = Math.round(strand.snow * 10) / 10;
  const alpha = Math.round(strand.alpha * 20) / 20;
  const catkinsShow = strand.age < CATKINS.drop;
  // The paths for each tone and each step of turning, found once for the strand.
  const shade = strand.front ? 1 : MARKS.behind;
  const paths = [...TONES.keys(), SILVER_TONE].map((tone) =>
    Array.from({ length: TURN_STEPS }, (_, step) => {
      const turn = turnOf(step);
      return batchFor(
        paints.batches,
        `${tone} ${step} ${age} ${snow} ${alpha} ${strand.front}`,
        () => {
          const color = toneColor(leafColors(age + turn, snow), tone);
          return {
            color: [color[0] * shade, color[1] * shade, color[2] * shade],
            alpha,
          };
        },
      );
    }),
  );
  const strong = smoothstep(DETAIL.from, DETAIL.to, leafPx);
  const outlineKey = Math.round(DETAIL.alpha * strong * strand.alpha * 10) / 10;
  let outlined = 0;
  let index = 0;
  let count = 0;
  for (const leaf of leavesOf(strand.variant, length)) {
    if (leaf.s > length) {
      break;
    }
    count += 1;
    if (count % every !== 0 || strand.age >= leaf.drops || leaf.s < from) {
      continue;
    }
    const placed = placeOn(course, leaf.s, index);
    index = placed.index;
    const size = leafSize(leaf, length, strand.full);
    const heading = leafHeading(leaf, placed.way, time, strength, downwind);
    const way = { x: Math.cos(heading), y: Math.sin(heading) };
    const shown = Math.max(MARKS.minPx, size * leafPx);
    const width = Math.min(
      MARKS.stoutest * shown,
      Math.max(MARKS.thinnestPx, LEAVES.width * shown) * widen,
    );
    // A hanging leaf droops: most curl down toward the ground.
    const curl = 0.7 * Math.abs(leaf.curl) * Math.sign(way.x) + 0.3 * leaf.curl;
    const flipped =
      Math.sin(time * (2.2 + 3 * leaf.variant) + leaf.variant * 41) >
      1 - FLUTTER.flip * strength;
    const tone = flipped ? SILVER_TONE : toneOf(leaf, strand);
    const path = at(at(paths, tone), turnStep(leaf));
    addLeaf(path, placed.p, way, shown, width, curl, shown >= MARKS.shapedPx);
    if (outlined < detail && outlineKey > 0) {
      let outline = paints.outlines.get(outlineKey);
      if (outline === undefined) {
        outline = new Path2D();
        paints.outlines.set(outlineKey, outline);
      }
      addLeaf(outline, placed.p, way, shown, width, curl, true);
      if (shown >= DETAIL.rib) {
        addRib(outline, placed.p, way, shown, width, curl);
      }
      outlined += 1;
    }
    if (catkinsShow && hasCatkin(leaf, length)) {
      addCatkin(
        paints,
        camera,
        strand,
        placed.p,
        placed.way,
        leaf,
        widen,
        outlined < detail,
      );
    }
  }
  return outlined;
}

/**
 * The way a leaf points on screen, in radians: off its twig toward the strand's tip, streaming
 * toward the way the wind blows and fluttering in it, `strength` of the way to as far as a full wind
 * takes them.
 */
function leafHeading(
  leaf: Leaf,
  way: Vec,
  time: number,
  strength: number,
  downwind: number,
): number {
  const along = Math.atan2(way.y, way.x) + leaf.side * leaf.angle;
  const streamed =
    along + wrapAngle(downwind - along) * FLUTTER.stream * strength * strength;
  const rate = 4 + 6 * leaf.variant + 5 * strength;
  return (
    streamed +
    FLUTTER.angle *
      strength *
      Math.sin(time * rate + leaf.variant * Math.PI * 2)
  );
}

/**
 * Which tone a leaf takes: light near the top of its strand, on a strand open to the sky and in
 * front of the wood; in shadow low in the curtain and behind the wood.
 */
function toneOf(leaf: Leaf, strand: StrandView): number {
  const { tone } = MARKS;
  const high = 1 - clamp(leaf.s / Math.max(0.6, strand.length), 0, 1);
  const t =
    tone.lit * high +
    tone.exposure * (strand.exposure - 0.5) +
    (strand.front ? tone.front : 0) +
    tone.jitter * (leaf.variant - 0.5);
  return t < tone.shadow ? 0 : t < tone.light ? 1 : 2;
}

/** Which of a few steps of turning earlier or later than its strand a leaf turns in. */
function turnStep(leaf: Leaf): number {
  const step = (2 * LEAVES.turns) / TURN_STEPS;
  return clamp(
    Math.floor((leaf.turn + LEAVES.turns) / step),
    0,
    TURN_STEPS - 1,
  );
}

/** How much earlier in the year than their strand the leaves of turning step `step` turn. */
function turnOf(step: number): number {
  return -LEAVES.turns + ((step + 0.5) * 2 * LEAVES.turns) / TURN_STEPS;
}

/**
 * Adds a leaf's mark to `path`, in CSS pixels: narrow and pointed, widest a third of the way out
 * from where it leaves its twig at `base`, running `way` for `length` and curling `curl` of its
 * width to one side. A small one takes a plainer shape.
 */
function addLeaf(
  path: Path2D,
  base: Vec,
  way: Vec,
  length: number,
  width: number,
  curl: number,
  shaped: boolean,
): void {
  const nx = -way.y;
  const ny = way.x;
  const point = (out: number, side: number): Vec => ({
    x: base.x + way.x * out * length + nx * side * width,
    y: base.y + way.y * out * length + ny * side * width,
  });
  const tip = point(1, curl);
  path.moveTo(base.x, base.y);
  if (shaped) {
    // A cubic's widest point lies about half way to its controls.
    const a = point(0.28, 0.95 + 0.3 * curl);
    const b = point(0.7, 0.45 + 0.7 * curl);
    const c = point(0.7, -0.45 + 0.7 * curl);
    const d = point(0.28, -0.95 + 0.3 * curl);
    path.bezierCurveTo(a.x, a.y, b.x, b.y, tip.x, tip.y);
    path.bezierCurveTo(c.x, c.y, d.x, d.y, base.x, base.y);
  } else {
    const a = point(0.4, 1 + 0.5 * curl);
    const b = point(0.4, -1 + 0.5 * curl);
    path.quadraticCurveTo(a.x, a.y, tip.x, tip.y);
    path.quadraticCurveTo(b.x, b.y, base.x, base.y);
  }
  // Filling closes it; closing each outline here is slow once a path holds thousands of leaves.
}

/** Adds a leaf's midrib to `path`: a fine line from its foot most of the way to its tip, along its curl. */
function addRib(
  path: Path2D,
  base: Vec,
  way: Vec,
  length: number,
  width: number,
  curl: number,
): void {
  const nx = -way.y;
  const ny = way.x;
  const end = {
    x: base.x + way.x * 0.86 * length + nx * 0.8 * curl * width,
    y: base.y + way.y * 0.86 * length + ny * 0.8 * curl * width,
  };
  const bend = {
    x: base.x + way.x * 0.45 * length + nx * 0.45 * curl * width,
    y: base.y + way.y * 0.45 * length + ny * 0.45 * curl * width,
  };
  path.moveTo(base.x, base.y);
  path.quadraticCurveTo(bend.x, bend.y, end.x, end.y);
}

/**
 * Adds the catkin in a leaf's axil to its strand's layer: a short, plump tassel leaning off the twig
 * on the side away from its leaf, silver in the bud, opening gold, and withering brown through early
 * autumn. Close in, it shows the stamens that make it fuzzy.
 */
function addCatkin(
  paints: Paints,
  camera: Camera,
  strand: StrandView,
  base: Vec,
  twig: Vec,
  leaf: Leaf,
  grow: number,
  detailed: boolean,
): void {
  const length = Math.max(
    2,
    CATKINS.length * camera.scale * grow * (0.8 + 0.4 * leaf.variant),
  );
  const width = Math.max(MARKS.thinnestPx * 1.2, CATKINS.width * length);
  const heading =
    Math.atan2(twig.y, twig.x) - leaf.side * (0.55 + 0.3 * leaf.variant);
  const way = { x: Math.cos(heading), y: Math.sin(heading) };
  const open = smoothstep(0, 1, strand.openness);
  const wither = smoothstep(CATKINS.wither.from, CATKINS.wither.to, strand.age);
  const age = Math.round(open * 10) / 10;
  const dead = Math.round(wither * 10) / 10;
  const alpha = Math.round(strand.alpha * 20) / 20;
  const body = batchFor(
    paints.batches,
    `catkin ${age} ${dead} ${alpha}`,
    () => ({
      color: mix(mix(CATKIN.bud, CATKIN.open, age), CATKIN.withered, dead),
      alpha,
    }),
  );
  const middle = {
    x: base.x + way.x * 0.55 * length,
    y: base.y + way.y * 0.55 * length,
  };
  addOval(body, middle, way, 0.5 * length, 0.5 * width);
  if (length < CATKIN.detailPx || !detailed) {
    return;
  }
  // Close in, it is fuzzy with stamens, lit gold on the side toward the sky, or a silky sheen in the bud.
  const shine = batchFor(
    paints.batches,
    `catkin-shine ${age} ${dead} ${alpha}`,
    () => ({
      color: mix(mix(CATKIN.sheen, CATKIN.pollen, age), CATKIN.withered, dead),
      alpha,
    }),
  );
  const tufts = Math.round(6 + 4 * age);
  const nx = -way.y;
  const ny = way.x;
  for (let k = 0; k < tufts; k += 1) {
    const out = 0.12 + (0.76 * (k + 0.5)) / tufts;
    const side = k % 2 === 0 ? 1 : -1;
    const bulge = Math.sin(Math.PI * out);
    const p = {
      x: base.x + way.x * out * length + nx * side * 0.42 * width * bulge,
      y: base.y + way.y * out * length + ny * side * 0.42 * width * bulge,
    };
    const r = (0.16 + 0.1 * age) * width;
    addOval(shine, p, way, r, r);
  }
}

/**
 * Adds a plump oval to `path` around `middle`, `along` from end to middle the way `way` runs and
 * `across` from side to middle: two curves, as a true ellipse is slow by the thousand.
 */
function addOval(
  path: Path2D,
  middle: Vec,
  way: Vec,
  along: number,
  across: number,
): void {
  const nx = -way.y * across * 2;
  const ny = way.x * across * 2;
  const head = { x: middle.x + way.x * along, y: middle.y + way.y * along };
  const tail = { x: middle.x - way.x * along, y: middle.y - way.y * along };
  path.moveTo(tail.x, tail.y);
  path.quadraticCurveTo(middle.x + nx, middle.y + ny, head.x, head.y);
  path.quadraticCurveTo(middle.x - nx, middle.y - ny, tail.x, tail.y);
}

/**
 * Adds the snow lying along a strand's arch to its layer: a white line along the top of the twig
 * where it runs near level, thicker the more snow lies on it.
 */
function addSnow(
  paints: Paints,
  camera: Camera,
  strand: StrandView,
  course: Course,
): void {
  if (strand.snow < 0.03) {
    return;
  }
  const width = clamp((0.5 + 2.6 * strand.snow) * (camera.scale / 60), 0.6, 4);
  const alpha = Math.round(strand.alpha * 20) / 20;
  let lying = paints.snow.get(alpha);
  if (lying === undefined) {
    lying = { path: new Path2D(), width };
    paints.snow.set(alpha, lying);
  }
  lying.width = Math.max(lying.width, width);
  const reach = Math.min(strand.length, 1.2 * STRANDS.reach);
  const steps = 12;
  let index = 0;
  let open = false;
  for (let k = 0; k <= steps; k += 1) {
    const placed = placeOn(course, (reach * k) / steps, index);
    index = placed.index;
    // Snow lies where the twig runs within 50 degrees of level.
    const level = Math.abs(placed.way.y) < 0.77;
    const p = { x: placed.p.x, y: placed.p.y - width / 2 };
    if (level && !open) {
      lying.path.moveTo(p.x, p.y);
      open = true;
    } else if (level) {
      lying.path.lineTo(p.x, p.y);
    } else {
      open = false;
    }
  }
}

/** The path gathering the marks of one color in `batches`, made with `make` the first time it is asked for. */
function batchFor(
  batches: Map<string, Batch>,
  key: string,
  make: () => { color: Rgb; alpha: number },
): Path2D {
  let batch = batches.get(key);
  if (batch === undefined) {
    batch = { ...make(), path: new Path2D() };
    batches.set(key, batch);
  }
  return batch.path;
}

/** Fills every batch in its color, lit by `light`. */
function fillBatches(
  ctx: CanvasRenderingContext2D,
  batches: ReadonlyMap<string, Batch>,
  light: Rgb,
): void {
  for (const batch of batches.values()) {
    ctx.globalAlpha = batch.alpha;
    ctx.fillStyle = css(lit(batch.color, light));
    ctx.fill(batch.path);
  }
}

/** Leaf colors at a time of year: the living colors, turned by however much of autumn has passed, and whitened by `snow`. */
function leafColors(
  age: number,
  snow: number,
): { base: Rgb; tip: Rgb; silver: Rgb } {
  let { base, tip } = LIVING;
  let silver = SILVER;
  for (const stage of AUTUMN) {
    const t = smoothstep(stage.from, stage.to, age);
    if (t <= 0) {
      break;
    }
    base = mix(base, stage.base, t);
    tip = mix(tip, stage.tip, t);
    silver = mix(silver, stage.tip, t);
  }
  const cover = SNOW_COVER * snow;
  return {
    base: mix(base, SNOW_COLOR, cover),
    tip: mix(tip, SNOW_COLOR, cover),
    silver: mix(silver, SNOW_COLOR, cover),
  };
}

/** The color of `tone` among a leaf's `colors`. */
function toneColor(
  colors: { base: Rgb; tip: Rgb; silver: Rgb },
  tone: number,
): Rgb {
  if (tone === SILVER_TONE) {
    return colors.silver;
  }
  const { toTip, shade } = at(TONES, tone);
  const color = mix(colors.base, colors.tip, toTip);
  return [color[0] * shade, color[1] * shade, color[2] * shade];
}
