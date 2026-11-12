import { at, invariant, lerp } from "./util";
import type { Point } from "./village";

/**
 * The farm's buildings are seen from the ground at eye level, from in front and a little to the
 * right: every meter a thing stands back from the view lies `RECEDE` meters farther right on the
 * page, and no higher. So each building shows its front and its right side, and of its roofs the
 * pitches turned toward the view or to the right. All sizes are in meters, x along the ground from
 * the tree's roots.
 */
export const RECEDE = 0.3;

/** A point `x` along the ground, `y` up and `z` back from the view, on the page. */
export function onPage(x: number, y: number, z: number): Point {
  return { x: x + RECEDE * z, y };
}

/** The corners of a box from (`u0`, `v0`) to (`u1`, `v1`) on a wall, placed on the page by `on`. */
export function box(
  on: (u: number, v: number) => Point,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
): Point[] {
  return [on(u0, v0), on(u1, v0), on(u1, v1), on(u0, v1)];
}

/** Adds a line from `from` to `to` to `path`. */
export function line(path: Path2D, from: Point, to: Point): void {
  path.moveTo(from.x, from.y);
  path.lineTo(to.x, to.y);
}

/** A round shape about `middle`, `radius` across, as a polygon of `corners` corners. */
export function disc(middle: Point, radius: number, corners = 14): Point[] {
  return Array.from({ length: corners }, (_, i) => {
    const angle = (i / corners) * Math.PI * 2;
    return {
      x: middle.x + Math.cos(angle) * radius,
      y: middle.y + Math.sin(angle) * radius,
    };
  });
}

/** A band `width` wide along the line from `from` to `to`, running on past either end. */
export function bandAlong(from: Point, to: Point, width: number): Point[] {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  const nx = (-uy * width) / 2;
  const ny = (ux * width) / 2;
  const start = { x: from.x - ux * width, y: from.y - uy * width };
  const end = { x: to.x + ux * width, y: to.y + uy * width };
  return [
    { x: start.x + nx, y: start.y + ny },
    { x: end.x + nx, y: end.y + ny },
    { x: end.x - nx, y: end.y - ny },
    { x: start.x - nx, y: start.y - ny },
  ];
}

/** The part of the convex shape `points` inside `box`. */
export function clipToBox(
  points: readonly Point[],
  box: { left: number; right: number; bottom: number; top: number },
): Point[] {
  let kept = [...points];
  const sides: ((p: Point) => number)[] = [
    (p) => p.x - box.left,
    (p) => box.right - p.x,
    (p) => p.y - box.bottom,
    (p) => box.top - p.y,
  ];
  for (const inside of sides) {
    const next: Point[] = [];
    for (let i = 0; i < kept.length; i += 1) {
      const a = at(kept, i);
      const b = at(kept, (i + 1) % kept.length);
      const da = inside(a);
      const db = inside(b);
      if (da >= 0) {
        next.push(a);
      }
      if (da >= 0 !== db >= 0) {
        const f = da / (da - db);
        next.push({ x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) });
      }
    }
    kept = next;
  }
  invariant(kept.length >= 3, "A brace must cross the door it braces.");
  return kept;
}

/**
 * How far a line from (x, y), heading `heading` radians counterclockwise from +x, runs before it
 * meets any of the shapes `outlines`, in meters: 0 from inside one, and Infinity if it misses them.
 */
export function aheadOf(
  outlines: readonly (readonly Point[])[],
  x: number,
  y: number,
  heading: number,
): number {
  const dx = Math.cos(heading);
  const dy = Math.sin(heading);
  let nearest = Infinity;
  for (const outline of outlines) {
    let crossings = 0;
    for (let i = 0; i < outline.length; i += 1) {
      const a = at(outline, i);
      const b = at(outline, (i + 1) % outline.length);
      // Whether a line from (x, y) out to the right crosses this edge, to tell if it starts inside.
      if (
        a.y > y !== b.y > y &&
        x < a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y)
      ) {
        crossings += 1;
      }
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const across = dx * ey - dy * ex;
      if (across === 0) {
        continue;
      }
      const t = ((a.x - x) * ey - (a.y - y) * ex) / across;
      const u = ((a.x - x) * dy - (a.y - y) * dx) / across;
      if (t >= 0 && u >= 0 && u <= 1) {
        nearest = Math.min(nearest, t);
      }
    }
    if (crossings % 2 === 1) {
      return 0;
    }
  }
  return nearest;
}

/** Height of the top of the shapes `outlines` above `x`, in meters: the highest of them, or 0 beside them all. */
export function topOf(
  outlines: readonly (readonly Point[])[],
  x: number,
): number {
  let top = 0;
  for (const outline of outlines) {
    for (let i = 0; i < outline.length; i += 1) {
      const a = at(outline, i);
      const b = at(outline, (i + 1) % outline.length);
      if (a.x !== b.x && (x - a.x) * (x - b.x) <= 0) {
        top = Math.max(top, a.y + ((x - a.x) * (b.y - a.y)) / (b.x - a.x));
      }
    }
  }
  return top;
}
