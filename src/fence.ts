import type { Fence, Level } from "./level";
import { at, hash } from "./util";

/**
 * A split-rail fence's measures, in meters, after the reference photo: posts `post` thick and
 * `height` tall, sunk `sunk` into the ground, each leaning by up to `lean` radians its own way and a
 * little taller or shorter, by up to `uneven`; `rails` rails between each post and the next, `rail`
 * thick, at these heights up the posts, each end a little higher or lower by up to `wander` and
 * sagging by up to `sag` between them; and a brace across the gate.
 */
const FENCE = {
  post: 0.12,
  height: 1.2,
  sunk: 0.15,
  lean: 0.05,
  uneven: 0.07,
  rails: [0.38, 0.7, 1.02],
  rail: 0.075,
  wander: 0.05,
  sag: 0.03,
} as const;

/** How far ahead a growing tip looks for the fence, and in what steps, in meters. */
const LOOK_AHEAD = { most: 2, step: 0.05 } as const;

/**
 * The fence on `level`'s ground, in meters with y up, to be filled with the ground's ink: wound
 * clockwise, as every ink shape is, so where it overlaps the ground they fill as one.
 */
export function fenceShape(level: Level, fence: Fence): Path2D {
  const path = new Path2D();
  const posts = [...fence.posts, ...fence.gate];
  for (const [i, x] of posts.entries()) {
    const ground = level.groundAt(x);
    const lean = FENCE.lean * (2 * hash(i, 71) - 1);
    const height = FENCE.height + FENCE.uneven * (2 * hash(i, 72) - 1);
    const half = FENCE.post / 2;
    const top = x + lean * height;
    quad(
      path,
      { x: x - half, y: ground - FENCE.sunk },
      { x: top - half, y: ground + height },
      { x: top + half, y: ground + height },
      { x: x + half, y: ground - FENCE.sunk },
    );
  }
  const spans: [number, number, number][] = [];
  for (let i = 0; i + 1 < fence.posts.length; i += 1) {
    spans.push([at(fence.posts, i), at(fence.posts, i + 1), i]);
  }
  spans.push([fence.gate[0], fence.gate[1], fence.posts.length]);
  for (const [from, to, n] of spans) {
    for (const [k, height] of FENCE.rails.entries()) {
      const wander = (seed: number): number =>
        FENCE.wander * (2 * hash(n * 7 + k, seed) - 1);
      rail(
        path,
        { x: from, y: level.groundAt(from) + height + wander(73) },
        { x: to, y: level.groundAt(to) + height + wander(74) },
        FENCE.sag * hash(n * 7 + k, 75),
      );
    }
  }
  // The gate's brace, from the foot of one post to the top of the other.
  const [hinge, latch] = fence.gate;
  rail(
    path,
    { x: hinge, y: level.groundAt(hinge) + at(FENCE.rails, 0) },
    {
      x: latch,
      y: level.groundAt(latch) + at(FENCE.rails, FENCE.rails.length - 1),
    },
    0,
  );
  return path;
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
  const reach = FENCE.post / 2 + FENCE.lean * FENCE.height;
  const along = (from: number, to: number): boolean =>
    x >= from - reach && x <= to + reach;
  const within =
    along(at(fence.posts, 0), at(fence.posts, fence.posts.length - 1)) ||
    along(fence.gate[0], fence.gate[1]);
  const ground = level.groundAt(x);
  return within && y <= ground + FENCE.height + FENCE.uneven && y >= ground;
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

/** Adds a rail from `a` to `b` to `path`, sagging `sag` meters in the middle, wound clockwise. */
function rail(
  path: Path2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  sag: number,
): void {
  const half = FENCE.rail / 2;
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - sag };
  const [left, right] = a.x <= b.x ? [a, b] : [b, a];
  path.moveTo(left.x, left.y + half);
  path.lineTo(middle.x, middle.y + half);
  path.lineTo(right.x, right.y + half);
  path.lineTo(right.x, right.y - half);
  path.lineTo(middle.x, middle.y - half);
  path.lineTo(left.x, left.y - half);
  path.closePath();
}
