import { at } from "./util";

/**
 * A small barn standing on the ground beside the tree, true to size, so there is something to
 * judge the tree's height by. All sizes are in meters, and x is from the tree's roots.
 */
const BARN = {
  x: 7.5,
  width: 7,
  /** Height of the walls at the eaves, of the break where the roof's pitch eases, and of the ridge. */
  eaves: 3,
  break: 4.6,
  ridge: 5.8,
  /** How far in from the walls the roof's pitch breaks. */
  breakIn: 1.15,
  /** How far the eaves reach out past the walls, and how far they dip. */
  overhang: 0.35,
  dip: 0.15,
  /** The cupola on the ridge: its width and height, and the cap over it. */
  cupola: { width: 1, height: 0.75, cap: 0.5, capOverhang: 0.12 },
  /** The double door at the foot of the gable, and the hayloft door above it. */
  door: { width: 2.8, height: 2.5 },
  loft: { width: 1.2, bottom: 3.35, top: 4.3 },
} as const;

/** Width of the lines carved into the barn, in meters. */
export const BARN_LINE = 0.045;

/** The barn's outline, in meters with y up, its foot sunk a little into the ground. */
export function barnOutline(): Path2D {
  const path = new Path2D();
  OUTLINE.forEach(([px, py], i) => {
    if (i === 0) {
      path.moveTo(px, py);
    } else {
      path.lineTo(px, py);
    }
  });
  path.closePath();
  return path;
}

/**
 * How far a line from (x, y), heading `heading` radians counterclockwise from +x, runs before it
 * meets the barn, in meters: 0 from inside it, and Infinity if it misses.
 */
export function barnAhead(x: number, y: number, heading: number): number {
  const dx = Math.cos(heading);
  const dy = Math.sin(heading);
  let nearest = Infinity;
  let crossings = 0;
  for (let i = 0; i < OUTLINE.length; i += 1) {
    const [ax, ay] = at(OUTLINE, i);
    const [bx, by] = at(OUTLINE, (i + 1) % OUTLINE.length);
    // Whether a line from (x, y) out to the right crosses this edge, to tell if it starts inside.
    if (ay > y !== by > y && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) {
      crossings += 1;
    }
    const ex = bx - ax;
    const ey = by - ay;
    const across = dx * ey - dy * ex;
    if (across === 0) {
      continue;
    }
    const t = ((ax - x) * ey - (ay - y) * ex) / across;
    const u = ((ax - x) * dy - (ay - y) * dx) / across;
    if (t >= 0 && u >= 0 && u <= 1) {
      nearest = Math.min(nearest, t);
    }
  }
  return crossings % 2 === 1 ? 0 : nearest;
}

/** Corners of the barn's outline, in meters with y up, its foot sunk a little into the ground. */
const OUTLINE: readonly (readonly [number, number])[] = outlinePoints();

function outlinePoints(): [number, number][] {
  const { x, width, eaves, ridge, breakIn, overhang, dip, cupola } = BARN;
  const half = width / 2;
  // Height of the upper roof a distance `dx` either side of the ridge.
  const roof = (dx: number): number =>
    ridge - ((ridge - BARN.break) * dx) / (half - breakIn);
  const shoulder = roof(cupola.width / 2);
  const top = shoulder + cupola.height;
  const side = (sign: 1 | -1): [number, number][] => [
    [x + sign * half, -0.2],
    [x + sign * half, eaves],
    [x + sign * (half + overhang), eaves - dip],
    [x + sign * (half - breakIn), BARN.break],
    [x + (sign * cupola.width) / 2, shoulder],
    [x + (sign * cupola.width) / 2, top],
    [x + sign * (cupola.width / 2 + cupola.capOverhang), top],
  ];
  return [
    ...side(-1),
    [x, top + cupola.cap] as [number, number],
    ...side(1).reverse(),
  ];
}

/**
 * Lines carved into the barn, in meters with y up: where the roof meets the walls, the double
 * door with a brace across each leaf, and the hayloft door above it.
 */
export function barnLines(): Path2D {
  const { x, width, eaves, door, loft } = BARN;
  const half = width / 2;
  const path = new Path2D();
  path.moveTo(x - half, eaves);
  path.lineTo(x + half, eaves);

  const left = x - door.width / 2;
  const right = x + door.width / 2;
  path.rect(left, 0, door.width, door.height);
  path.moveTo(x, 0);
  path.lineTo(x, door.height);
  for (const [from, to] of [
    [left, x],
    [x, right],
  ] as const) {
    path.moveTo(from, 0);
    path.lineTo(to, door.height);
    path.moveTo(from, door.height);
    path.lineTo(to, 0);
  }

  path.rect(
    x - loft.width / 2,
    loft.bottom,
    loft.width,
    loft.top - loft.bottom,
  );
  path.moveTo(x, loft.bottom);
  path.lineTo(x, loft.top);
  return path;
}
