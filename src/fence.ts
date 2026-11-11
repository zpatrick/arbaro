import type { Fence, Level } from "./level";
import { at, hash } from "./util";

/**
 * A weathered rail fence, after the reference of horses beyond an old fence: rough posts `post`
 * thick, varying by `thick`, and `height` tall, varying by `uneven`, sunk `sunk` into the ground,
 * their tops cut on a slant of up to `top`. Most stand nearly upright, leaning by up to `lean`
 * radians their own way; now and then, one time in `tilted`, one leans as far as `tilt`. Two rails,
 * `rail` thick, run between each post and the next at `rails` up the posts, the upper a little under
 * their tops; each is fixed to its posts where they stand at that height, runs `overhang` past them so
 * the rails of one bay cross those of the next, sits higher or lower at either end by up to
 * `wander`, and sags by up to `sag`. One lower rail in `broken` has come away at one end and rests
 * on the ground. One bay is the gate, with a brace across it.
 */
const FENCE = {
  post: 0.13,
  thick: 0.25,
  height: 1.12,
  uneven: 0.1,
  sunk: 0.2,
  top: 0.05,
  lean: 0.05,
  tilted: 5,
  tilt: 0.15,
  rails: [0.45, 0.9],
  rail: 0.07,
  overhang: 0.1,
  wander: 0.04,
  sag: 0.035,
  broken: 7,
} as const;

/** How far ahead a growing tip looks for the fence, and in what steps, in meters. */
const LOOK_AHEAD = { most: 2, step: 0.05 } as const;

/** One post as it stands: where its foot is, how it leans, how tall it is, and how thick. */
interface Post {
  x: number;
  ground: number;
  lean: number;
  height: number;
  half: number;
}

/**
 * The fence on `level`'s ground, in meters with y up, to be filled with the ground's ink: wound
 * clockwise, as every ink shape is, so where it overlaps the ground they fill as one.
 */
export function fenceShape(level: Level, fence: Fence): Path2D {
  const path = new Path2D();
  const posts = fence.posts.map((x, i) => postAt(level, x, i));
  for (const [i, post] of posts.entries()) {
    const topHalf = post.half * (0.82 + 0.16 * hash(i, 78));
    const slant = FENCE.top * (2 * hash(i, 77) - 1);
    const top = post.x + post.lean * post.height;
    quad(
      path,
      { x: post.x - post.half, y: post.ground - FENCE.sunk },
      { x: top - topHalf, y: post.ground + post.height + slant },
      { x: top + topHalf, y: post.ground + post.height - slant },
      { x: post.x + post.half, y: post.ground - FENCE.sunk },
    );
  }
  for (let i = 0; i + 1 < posts.length; i += 1) {
    const from = at(posts, i);
    const to = at(posts, i + 1);
    for (const [k, height] of FENCE.rails.entries()) {
      const n = i * 7 + k;
      const wander = (seed: number): number =>
        FENCE.wander * (2 * hash(n, seed) - 1);
      // The upper rail stays under the tops of both its posts.
      const highest = Math.min(from.height, to.height) - 0.08;
      const start = onPost(from, Math.min(height + wander(73), highest));
      const end = onPost(to, Math.min(height + wander(74), highest));
      const brokenAway =
        k === 0 && i !== fence.gate && hash(i, 79) < 1 / FENCE.broken;
      if (brokenAway) {
        // Come away at its far end, it lies from its post down to the ground near the next.
        const resting = {
          x: to.x - 0.25 * (to.x - from.x) * hash(i, 80),
          y: 0,
        };
        resting.y = level.groundAt(resting.x) + FENCE.rail / 2;
        rail(path, start, resting, 0, FENCE.overhang, 0);
        continue;
      }
      rail(
        path,
        start,
        end,
        FENCE.sag * (0.45 + 0.55 * hash(n, 75)),
        FENCE.overhang,
        FENCE.overhang,
      );
    }
  }
  // The gate's brace, from its hinge post at the lower rail to its latch post at the upper.
  const hinge = at(posts, fence.gate);
  const latch = at(posts, fence.gate + 1);
  rail(
    path,
    onPost(hinge, at(FENCE.rails, 0)),
    onPost(latch, Math.min(at(FENCE.rails, 1), latch.height - 0.08)),
    0,
    0,
    0,
  );
  return path;
}

/** Post `i` of a fence, standing at `x` on `level`'s ground. */
function postAt(level: Level, x: number, i: number): Post {
  const tilted = hash(i, 81) < 1 / FENCE.tilted;
  const lean = (tilted ? FENCE.tilt : FENCE.lean) * (2 * hash(i, 71) - 1);
  return {
    x,
    ground: level.groundAt(x),
    lean,
    height: FENCE.height + FENCE.uneven * (2 * hash(i, 72) - 1),
    half: (FENCE.post * (1 + FENCE.thick * (2 * hash(i, 76) - 1))) / 2,
  };
}

/** Where the middle of `post` is, `height` meters up it. */
function onPost(post: Post, height: number): { x: number; y: number } {
  return { x: post.x + post.lean * height, y: post.ground + height };
}

/**
 * How far a line from (x, y), heading `heading` radians counterclockwise from +x, runs before it
 * meets `level`'s fence: 0 from inside it, and Infinity if it meets none within `LOOK_AHEAD`.
 */
export function fenceAhead(
  level: Level,
  x: number,
  y: number,
  heading: number,
): number {
  const fence = level.fence;
  if (fence === undefined) {
    return Infinity;
  }
  const dx = Math.cos(heading);
  const dy = Math.sin(heading);
  for (let t = 0; t <= LOOK_AHEAD.most; t += LOOK_AHEAD.step) {
    if (inside(level, fence, x + dx * t, y + dy * t)) {
      return t;
    }
  }
  return Infinity;
}

/** Whether (x, y) lies within `fence`, taking it as solid from the ground to its top. */
function inside(level: Level, fence: Fence, x: number, y: number): boolean {
  const tallest = FENCE.height + FENCE.uneven + FENCE.top;
  const reach =
    (FENCE.post * (1 + FENCE.thick)) / 2 +
    FENCE.tilt * tallest +
    FENCE.overhang;
  const within =
    x >= at(fence.posts, 0) - reach &&
    x <= at(fence.posts, fence.posts.length - 1) + reach;
  const ground = level.groundAt(x);
  return within && y <= ground + tallest && y >= ground;
}

/** Adds the quadrilateral through `a`, `b`, `c` and `d`, in that order, to `path`. */
function quad(
  path: Path2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): void {
  path.moveTo(a.x, a.y);
  path.lineTo(b.x, b.y);
  path.lineTo(c.x, c.y);
  path.lineTo(d.x, d.y);
  path.closePath();
}

/** How many steps a sagging rail is drawn in, so the droop is a curve. */
const RAIL_STEPS = 6;

/**
 * Adds a rail from `a` to `b` to `path`, running on `past` meters beyond `a` and `beyond` meters
 * beyond `b`, sagging `sag` meters in the middle, wound clockwise.
 */
function rail(
  path: Path2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  sag: number,
  past: number,
  beyond: number,
): void {
  const half = FENCE.rail / 2;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const along = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  const start = { x: a.x - along.x * past, y: a.y - along.y * past };
  const end = { x: b.x + along.x * beyond, y: b.y + along.y * beyond };
  const [left, right] = start.x <= end.x ? [start, end] : [end, start];
  const atT = (t: number, side: number): { x: number; y: number } => {
    const droop = sag * 4 * t * (1 - t);
    return {
      x: left.x + (right.x - left.x) * t,
      y: left.y + (right.y - left.y) * t - droop + side * half,
    };
  };
  for (let i = 0; i <= RAIL_STEPS; i += 1) {
    const p = atT(i / RAIL_STEPS, 1);
    if (i === 0) {
      path.moveTo(p.x, p.y);
    } else {
      path.lineTo(p.x, p.y);
    }
  }
  for (let i = RAIL_STEPS; i >= 0; i -= 1) {
    const p = atT(i / RAIL_STEPS, -1);
    path.lineTo(p.x, p.y);
  }
  path.closePath();
}
