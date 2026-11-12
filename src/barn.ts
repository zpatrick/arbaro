import type { Camera } from "./camera";
import { css, lit, mix, type Rgb, type SkyLight } from "./sky";
import { at, invariant, lerp, smoothstep, valueNoise, wrapAngle } from "./util";
import {
  hatchGap,
  LAMPLIGHT,
  layGlow,
  LINES,
  type Look,
  lookOf,
  PANE,
  type Point,
  SHADE,
  type Shaded,
  shadeFace,
  shapeOf,
  SNOW_COVERS,
  unit,
  type Vec3,
} from "./village";
import type { Wind } from "./wind";

/**
 * A red barn standing on the ground beside the tree, true to size, so there is something to judge
 * the tree's height by. It is drawn as the village's houses are, its faces lit and shaded by the
 * sun or the moon, but seen from the ground at eye level: its gable end, with its great doors,
 * toward the view, and its long side running back to the right, every meter it runs back lying
 * `recede` meters farther right on the page. All sizes are in meters, x is from the tree's roots,
 * and the barn runs `length` meters back from its gable end.
 */
const BARN = {
  x: 7.5,
  width: 7,
  length: 10,
  recede: 0.3,
  /** Height of the walls at the eaves, of the break where the roof's pitch eases, and of the ridge. */
  eaves: 3,
  break: 4.6,
  ridge: 5.8,
  /** How far in from the walls the roof's pitch breaks. */
  breakIn: 1.15,
  /**
   * How far the eaves reach out past the walls, and how far they dip; and how far the roof runs on
   * past each gable.
   */
  overhang: 0.35,
  dip: 0.15,
  verge: 0.3,
  /** The cupola astride the ridge halfway back: how wide and tall it is, and its cap. */
  cupola: { width: 1, height: 0.75, cap: 0.45, capOverhang: 0.12 },
  /** The great double doors at the foot of the gable, and the hayloft door above them. */
  door: { width: 2.8, height: 2.6 },
  loft: { width: 1.2, bottom: 3.5, top: 4.45 },
  /** Windows: how wide and tall, and the height of their sills; and how far apart they stand along the side. */
  window: { width: 0.8, height: 0.9, sill: 1.3, apart: 2.5 },
  /** The stone foundation along the foot of the walls. */
  plinth: 0.45,
  /** How wide the white boards up the corners are. */
  trim: 0.13,
  /** How far apart the battens on the boarded walls stand. */
  battens: 0.34,
  /** How far apart the courses of the roof lie, along its slope. */
  courses: 0.42,
} as const;

/** The barn's colors before the light on them. */
const PAINT = {
  walls: [150, 48, 38] as Rgb,
  doors: [124, 40, 32] as Rgb,
  roof: [74, 70, 70] as Rgb,
  trim: [238, 234, 224] as Rgb,
  stone: [130, 124, 114] as Rgb,
  iron: [52, 50, 50] as Rgb,
  /** The dark between the slats of the cupola's louvers. */
  louvers: [36, 30, 28] as Rgb,
} as const;

/**
 * The great doors' make: how wide the boards framing each leaf are, and the braces crossing it;
 * the iron strap hinges on the leaves, how long and deep, and how far in from each leaf's top and
 * bottom; and the pulls on the leaves where they meet, how tall and wide, how far either side of
 * the meeting, and how high their middles are.
 */
const DOORS = {
  frame: 0.13,
  brace: 0.11,
  hinge: { long: 0.5, deep: 0.06, from: 0.42 },
  pull: { tall: 0.32, wide: 0.035, apart: 0.065, at: 1.15 },
} as const;

/** The same for the hayloft door, which is smaller and braced only one way. */
const LOFT_DOOR = {
  frame: 0.1,
  brace: 0.09,
  hinge: { long: 0.36, deep: 0.05, from: 0.2 },
} as const;

/**
 * How wide the white casing round a window is; how far its sill reaches past the casing either
 * side, and how deep it is; and how deep the shadow under the sill is.
 */
const CASING = { width: 0.1, sill: { past: 0.06, deep: 0.07, shadow: 0.05 } } as const;

/**
 * The cupola's louvered sides: how far in from its corners, its top and the ridge the louvers are
 * set, how many slats they have, how much of each slat's share of the louvers it fills, and how
 * wide the boards up its corners are.
 */
const LOUVERS = { inset: 0.13, slats: 5, slat: 0.6, corners: 0.07 } as const;

/** How strongly the battens on the walls and the courses of the roof show, and from how many CSS pixels apart. */
const GRAIN = { alpha: 0.13, leastPx: 3 } as const;

/**
 * The stones of the foundation, two courses of them: how long each is, and how strongly the joints
 * between show once a stone is `leastPx` CSS pixels long.
 */
const STONES = { long: 0.55, alpha: 0.2, leastPx: 7 } as const;

/**
 * Shadows on the walls: how dark the shadow the roof throws down a lit wall is, and at most how far
 * down the long side it reaches, as a share of the walls' height; how dark the shadow under a
 * window's sill is; and the darkening at the foot of the walls, how far up and how dark.
 */
const SHADOW = {
  alpha: 0.26,
  deepest: 0.45,
  sill: 0.16,
  foot: { up: 0.25, alpha: 0.1 },
} as const;

/**
 * How dark it grows before each of the barn's windows is lit, from full day at 0 to deep night
 * at 1, those along its side first; and the lantern over its doors.
 */
const LIGHTS = { windows: [0.36, 0.48, 0.42, 0.6, 0.55], lantern: 0.3 } as const;

/**
 * The lantern over the doors, hung from a bracket on the wall: how far above the doors its hook
 * is, how far out from the wall, and how deep it is back toward the wall; its glow; and the pool
 * of its light on the doors below it, how far it reaches, how far below the lantern its middle
 * lies, and how strong it is.
 */
const LANTERN = {
  hook: 0.62,
  out: 0.28,
  deep: 0.22,
  glow: { reach: 1.1, alpha: 0.9 },
  pool: { reach: 1.9, below: 0.8, alpha: 0.32 },
} as const;

/** Width of the lines drawn on the barn, at least, in meters. */
const LEAST_LINE = 0.012;

/** A point of the barn, `x` along the ground, `y` up and `z` back from its gable end, on the page. */
function onPage(x: number, y: number, z: number): Point {
  return { x: x + BARN.recede * z, y };
}

const L = BARN.x - BARN.width / 2;
const R = BARN.x + BARN.width / 2;
const X = BARN.x;
const D = BARN.length;
/** How far back the roof's edges run, from in front of the gable end to behind the back of the barn. */
const FRONT = -BARN.verge;
const BACK = D + BARN.verge;

/** Height of the roof `dx` either side of the ridge, along its upper or lower pitch. */
function roofAt(dx: number): number {
  const half = BARN.width / 2;
  const upper = half - BARN.breakIn;
  const ax = Math.abs(dx);
  if (ax <= upper) {
    return BARN.ridge - ((BARN.ridge - BARN.break) * ax) / upper;
  }
  return (
    BARN.break -
    ((BARN.break - (BARN.eaves - BARN.dip)) * (ax - upper)) /
      (half + BARN.overhang - upper)
  );
}

/** The roofline over the gable end, from the eaves on the left over the ridge to the eaves on the right. */
const ROOFLINE: readonly Point[] = [
  { x: L - BARN.overhang, y: BARN.eaves - BARN.dip },
  { x: L + BARN.breakIn, y: BARN.break },
  { x: X, y: BARN.ridge },
  { x: R - BARN.breakIn, y: BARN.break },
  { x: R + BARN.overhang, y: BARN.eaves - BARN.dip },
];

/**
 * The underside of the roof over the gable end: the roofline brought in square to each pitch by
 * the roof's thickness, which is just enough for it to meet the tops of the walls, and cut plumb
 * at the eaves.
 */
const UNDER: readonly Point[] = underside();

function underside(): Point[] {
  const tip = at(ROOFLINE, 0);
  const knee = at(ROOFLINE, 1);
  const pitch = Math.atan2(knee.y - tip.y, knee.x - tip.x);
  const overWall =
    knee.y - ((knee.x - L) * (knee.y - tip.y)) / (knee.x - tip.x);
  const thick = (overWall - BARN.eaves) * Math.cos(pitch);
  const lines: { from: Point; along: Point }[] = [];
  for (let i = 0; i + 1 < ROOFLINE.length; i += 1) {
    const a = at(ROOFLINE, i);
    const b = at(ROOFLINE, i + 1);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const along = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    // In under the roof, to the right of the way the roofline runs.
    lines.push({
      from: { x: a.x + along.y * thick, y: a.y - along.x * thick },
      along,
    });
  }
  const plumb = (line: { from: Point; along: Point }, x: number): Point => ({
    x,
    y: line.from.y + ((x - line.from.x) * line.along.y) / line.along.x,
  });
  const points = [plumb(at(lines, 0), at(ROOFLINE, 0).x)];
  for (let i = 0; i + 1 < lines.length; i += 1) {
    const a = at(lines, i);
    const b = at(lines, i + 1);
    const cross = a.along.x * b.along.y - a.along.y * b.along.x;
    const s =
      ((b.from.x - a.from.x) * b.along.y - (b.from.y - a.from.y) * b.along.x) /
      cross;
    points.push({
      x: a.from.x + a.along.x * s,
      y: a.from.y + a.along.y * s,
    });
  }
  points.push(
    plumb(at(lines, lines.length - 1), at(ROOFLINE, ROOFLINE.length - 1).x),
  );
  return points;
}

/** Height of the roof's underside over the gable end at `x`. */
function underAt(x: number): number {
  for (let i = 0; i + 1 < UNDER.length; i += 1) {
    const a = at(UNDER, i);
    const b = at(UNDER, i + 1);
    if (x <= b.x || i + 2 === UNDER.length) {
      return a.y + ((x - a.x) * (b.y - a.y)) / (b.x - a.x);
    }
  }
  throw new Error("The roof has no underside.");
}

/** Corners of the barn's outline on the page, its foot sunk a little into the ground. */
const OUTLINE: readonly (readonly [number, number])[] = outlinePoints();

function outlinePoints(): [number, number][] {
  const { eaves, ridge, breakIn, overhang, dip, cupola } = BARN;
  const middle = D / 2;
  const capTop = ridge + cupola.height + cupola.cap;
  const p = (x: number, y: number, z: number): [number, number] => {
    const q = onPage(x, y, z);
    return [q.x, q.y];
  };
  return [
    p(L, -0.2, 0),
    p(L, eaves, 0),
    p(L - overhang, eaves - dip, FRONT),
    p(L + breakIn, BARN.break, FRONT),
    p(X, ridge, FRONT),
    p(X - cupola.width / 2, ridge, middle - cupola.width / 2),
    p(X - cupola.width / 2, ridge + cupola.height, middle - cupola.width / 2),
    p(
      X - cupola.width / 2 - cupola.capOverhang,
      ridge + cupola.height,
      middle - cupola.width / 2 - cupola.capOverhang,
    ),
    p(X, capTop, middle - cupola.width / 2 - cupola.capOverhang),
    p(X, capTop, middle + cupola.width / 2 + cupola.capOverhang),
    p(
      X + cupola.width / 2 + cupola.capOverhang,
      ridge + cupola.height,
      middle + cupola.width / 2 + cupola.capOverhang,
    ),
    p(X + cupola.width / 2, ridge + cupola.height, middle + cupola.width / 2),
    p(X + cupola.width / 2, ridge, middle + cupola.width / 2),
    p(X, ridge, BACK),
    p(R - breakIn, BARN.break, BACK),
    p(R + overhang, eaves - dip, BACK),
    p(R, eaves, D),
    p(R, -0.2, D),
  ];
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

/** Where the barn's walls stand on the page, in meters along the ground. */
export function barnWalls(): { left: number; right: number } {
  return { left: L, right: onPage(R, 0, D).x };
}

/** Height of the top of the barn above `x`, in meters: its roof, or 0 beside it. */
export function barnTopAt(x: number): number {
  let top = 0;
  for (let i = 0; i < OUTLINE.length; i += 1) {
    const [ax, ay] = at(OUTLINE, i);
    const [bx, by] = at(OUTLINE, (i + 1) % OUTLINE.length);
    if (ax !== bx && (x - ax) * (x - bx) <= 0) {
      top = Math.max(top, ay + ((x - ax) * (by - ay)) / (bx - ax));
    }
  }
  return top;
}

let shape: Path2D | undefined;

/** The barn's outline in device pixels, placed by `world`, for what stands against the light. */
export function barnShape(world: DOMMatrix): Path2D {
  shape ??= shapeOf(OUTLINE.map(([x, y]) => ({ x, y })));
  const placed = new Path2D();
  placed.addPath(shape, world);
  return placed;
}

/** A face of the barn: what it is painted, and whether snow lies on it. */
interface Face extends Shaded {
  paint: keyof typeof PAINT;
  snowy: boolean;
}

/** A window: its glass and glazing bars on the page, the middle of it, and how dark it grows before it is lit. */
interface Window {
  glass: Path2D;
  bars: Path2D;
  middle: Point;
  wakes: number;
}

/**
 * A wall of the barn and all that is on it: the wall and the foundation under it, the battens on
 * its boards and the joints between its stones, its windows, its white trim, the shadows under
 * its sills, the darkening at its foot, and its outline.
 */
interface Wall {
  wall: Face;
  plinth: Face;
  battens: Path2D;
  stones: Path2D;
  windows: Window[];
  trim: Path2D;
  sills: Path2D;
  foot: Path2D;
  outline: Path2D;
}

/** The gable end: a wall with the great doors and the hayloft door in it, and their iron. */
interface Gable extends Wall {
  doors: Path2D;
  iron: Path2D;
}

/**
 * The lantern over the doors: the plate on the wall and the arm reaching out from it to the ring
 * it hangs by; its iron, and the iron of its side, turned from the view; its glass in front and on
 * the side; the flame within, and the wires guarding the glass; and the middle of it.
 */
interface Lantern {
  plate: Path2D;
  arm: Path2D;
  iron: Path2D;
  side: Path2D;
  glass: Path2D;
  sideGlass: Path2D;
  flame: Path2D;
  wires: Path2D;
  middle: Point;
}

/** The cupola: its sides, right then front, its louvers and their slats, its corner boards, and its cap. */
interface Cupola {
  sides: Face[];
  louvers: Path2D;
  slats: Path2D;
  corners: Path2D;
  cap: Face[];
}

/** The barn, built once and drawn every frame, its parts in the order they are drawn. */
interface Built {
  side: Wall;
  gable: Gable;
  lantern: Lantern;
  /** The roof's near pitches, and the courses along them. */
  roof: Face[];
  courses: Path2D;
  /** The undersides of the roof's far pitches where they reach out past the gable and the left wall. */
  soffits: Face[];
  /** The board along the near eaves, and the boards along the roof's edge over the gable. */
  fascia: Face;
  verge: Face;
  cupola: Cupola;
  /** The foot of the weathervane's rod, on the ridge of the cupola's cap. */
  vane: Point;
}

let built: Built | undefined;

/**
 * Draws the barn in world meters placed by `world`, lit by `light` in `season`, from midsummer at
 * 0 to midwinter at 1, with snow lying `snow` meters deep and its weathervane turned to `heading`.
 * It is drawn from the back to the front, each part outlined as it is drawn so the nearer parts
 * hide the lines behind them: its long side, then its gable end with its doors, windows and
 * lantern, each wall shaded as far as it turns from the light and in the shadow the roof throws
 * down it; then the roof, the undersides of its overhang, the white boards along its edges, the
 * cupola, and the weathervane. Its windows light one by one as the evening comes on, and the
 * lantern throws a pool of light on the doors.
 */
export function drawBarn(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  world: DOMMatrix,
  light: SkyLight,
  season: number,
  snow: number,
  heading: number,
): void {
  built ??= buildBarn();
  const barn = built;
  const look = lookOf(light, season, snow, 0, 0);
  const k = camera.scale;
  const px = 1 / k;
  const gap = hatchGap(k);
  const paint = (color: Rgb): Rgb => lit(color, light.flowerLight);
  const thin = Math.max(LEAST_LINE, 0.6 * px);
  const glows: { middle: Point; reach: number; alpha: number }[] = [];
  ctx.save();
  ctx.setTransform(world);
  ctx.lineJoin = "round";

  const fill = (face: Face): void => {
    const color = face.snowy
      ? mix(PAINT[face.paint], look.snow, SNOW_COVERS.roof * look.snowy)
      : PAINT[face.paint];
    ctx.fillStyle = css(paint(color));
    ctx.fill(face.path);
    ctx.lineWidth = SHADE.widthPx * px;
    ctx.lineCap = "butt";
    shadeFace(ctx, face, look, gap, SHADE.tone, SHADE.strength, undefined);
  };
  const outline = (path: Path2D): void => {
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(LEAST_LINE, LINES.widthPx * px);
    ctx.strokeStyle = css(look.ink, LINES.outline);
    ctx.stroke(path);
  };
  const faint = (path: Path2D, alpha: number): void => {
    ctx.lineCap = "butt";
    ctx.lineWidth = thin;
    ctx.strokeStyle = css(look.ink, alpha);
    ctx.stroke(path);
  };
  // A wall up to its windows' glass: its boards, its foundation and its stones.
  const boards = (part: Wall): void => {
    fill(part.wall);
    if (BARN.battens * k >= GRAIN.leastPx) {
      faint(part.battens, GRAIN.alpha);
    }
    fill(part.plinth);
    if (STONES.long * k >= STONES.leastPx) {
      faint(part.stones, STONES.alpha);
    }
  };
  const glass = (part: Wall): void => {
    ctx.fillStyle = css(paint(mix(PANE.day, PANE.night, look.darkness)));
    for (const window of part.windows) {
      ctx.fill(window.glass);
    }
  };
  const trim = (part: Wall): void => {
    ctx.fillStyle = css(paint(PAINT.trim));
    ctx.fill(part.trim);
    ctx.fillStyle = css(look.ink, SHADOW.sill);
    ctx.fill(part.sills);
  };
  // The windows' lamps once lit, over any shadow, and their glazing bars, white by day and dark
  // against the lamplight.
  const lamps = (part: Wall): void => {
    for (const window of part.windows) {
      const burn = smoothstep(window.wakes, window.wakes + 0.06, look.darkness);
      if (burn > 0) {
        ctx.fillStyle = css(mix(PANE.night, LAMPLIGHT.pane, burn));
        ctx.fill(window.glass);
        glows.push({ middle: window.middle, reach: 1.3, alpha: 0.5 * burn });
      }
      ctx.lineCap = "butt";
      ctx.lineWidth = Math.max(LEAST_LINE, 0.04);
      ctx.strokeStyle = css(mix(paint(PAINT.trim), PANE.night, burn));
      ctx.stroke(window.bars);
    }
  };
  const foot = (part: Wall): void => {
    ctx.fillStyle = css(look.ink, SHADOW.foot.alpha);
    ctx.fill(part.foot);
  };

  // The long side, running back to the right, in the shadow of its eaves.
  const side = barn.side;
  boards(side);
  glass(side);
  trim(side);
  foot(side);
  drawEavesShadow(ctx, side.wall, look);
  lamps(side);
  outline(side.outline);

  // The gable end, with its doors, in the shadow of the roof reaching out over it.
  const gable = barn.gable;
  boards(gable);
  ctx.fillStyle = css(paint(PAINT.doors));
  ctx.fill(gable.doors);
  glass(gable);
  trim(gable);
  ctx.fillStyle = css(paint(PAINT.iron));
  ctx.fill(gable.iron);
  foot(gable);
  drawRakeShadow(ctx, gable.wall, look);
  lamps(gable);
  const lantern = smoothstep(
    LIGHTS.lantern,
    LIGHTS.lantern + 0.1,
    look.darkness,
  );
  if (lantern > 0) {
    drawPool(ctx, gable.wall, barn.lantern, lantern * look.darkness);
  }
  outline(gable.outline);
  drawLantern(ctx, barn.lantern, look, paint, lantern, px);
  if (lantern > 0) {
    glows.push({
      middle: barn.lantern.middle,
      reach: LANTERN.glow.reach,
      alpha: LANTERN.glow.alpha * lantern,
    });
  }

  // The roof over the near side, then the undersides of its far side where they show, and the
  // white boards along its edges.
  for (const face of barn.roof) {
    fill(face);
  }
  if (BARN.courses * k >= GRAIN.leastPx) {
    faint(barn.courses, GRAIN.alpha);
  }
  for (const face of barn.roof) {
    outline(face.path);
  }
  for (const face of barn.soffits) {
    fill(face);
    outline(face.path);
  }
  for (const face of [barn.fascia, barn.verge]) {
    fill(face);
    outline(face.path);
  }

  // The cupola astride the ridge, its side and then its front, its louvers and its cap.
  const { cupola } = barn;
  for (const face of cupola.sides) {
    fill(face);
  }
  ctx.fillStyle = css(paint(PAINT.louvers));
  ctx.fill(cupola.louvers);
  ctx.fillStyle = css(paint(PAINT.trim));
  ctx.fill(cupola.slats);
  ctx.fill(cupola.corners);
  for (const face of cupola.sides) {
    outline(face.path);
  }
  for (const face of cupola.cap) {
    fill(face);
    outline(face.path);
  }
  drawVane(ctx, barn.vane, heading, css(paint(PAINT.iron)), px);

  if (glows.length > 0) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    for (const glow of glows) {
      layGlow(
        ctx,
        world,
        camera.dpr,
        camera.scale,
        glow.middle,
        glow.reach,
        glow.reach,
        glow.alpha * look.darkness,
      );
    }
  }
  ctx.restore();
}

/**
 * The shadow the eaves throw down the long side while the light falls on it: from the foot of
 * the board along the eaves, cast down the wall along the light, deeper the higher the light and
 * the more it skims the wall.
 */
function drawEavesShadow(
  ctx: CanvasRenderingContext2D,
  wall: Face,
  look: Look,
): void {
  const { key, keyStrength } = look;
  if (keyStrength < 0.02 || key.x <= 0.02 || key.y <= 0) {
    return;
  }
  const drop = Math.min(
    (BARN.overhang * key.y) / key.x,
    SHADOW.deepest * BARN.eaves,
  );
  const low = at(UNDER, UNDER.length - 1).y - drop;
  const shadow = shapeOf([
    onPage(R, low, -1),
    onPage(R, low, D + 1),
    onPage(R, BARN.ridge, D + 1),
    onPage(R, BARN.ridge, -1),
  ]);
  ctx.save();
  ctx.clip(wall.path);
  ctx.fillStyle = css(look.ink, SHADOW.alpha * keyStrength);
  ctx.fill(shadow);
  ctx.restore();
}

/**
 * The shadow the roof throws down the gable end where it reaches out over it: the foot of the
 * boards along its edge cast back onto the wall along the light, and everything above that in
 * shade, so the shadow deepens as the sun climbs and swings across the gable through the day.
 */
function drawRakeShadow(
  ctx: CanvasRenderingContext2D,
  wall: Face,
  look: Look,
): void {
  const { key, keyStrength } = look;
  if (keyStrength < 0.02 || key.z <= 0.02 || key.y <= 0) {
    return;
  }
  // The light falls toward the view by `key.z`, so the boards `verge` in front of the wall cast
  // their foot this far along it.
  const reach = BARN.verge / key.z;
  const cast = UNDER.map((p) => ({
    x: p.x - reach * key.x,
    y: p.y - reach * key.y,
  }));
  const first = at(cast, 0);
  const last = at(cast, cast.length - 1);
  const shadow = shapeOf([
    { x: first.x - 1, y: first.y },
    ...cast,
    { x: last.x + 1, y: last.y },
    { x: last.x + 1, y: BARN.ridge + 1 },
    { x: first.x - 1, y: BARN.ridge + 1 },
  ]);
  ctx.save();
  ctx.clip(wall.path);
  ctx.fillStyle = css(look.ink, SHADOW.alpha * keyStrength);
  ctx.fill(shadow);
  ctx.restore();
}

/** The lantern's light pooling warm on the gable end and the doors below it, `strength` strong. */
function drawPool(
  ctx: CanvasRenderingContext2D,
  wall: Face,
  lantern: Lantern,
  strength: number,
): void {
  const { reach, below, alpha } = LANTERN.pool;
  const x = lantern.middle.x;
  const y = lantern.middle.y - below;
  const pool = ctx.createRadialGradient(x, y, 0, x, y, reach);
  pool.addColorStop(0, css(LAMPLIGHT.pane, alpha * strength));
  pool.addColorStop(0.5, css(LAMPLIGHT.pane, 0.35 * alpha * strength));
  pool.addColorStop(1, css(LAMPLIGHT.pane, 0));
  ctx.save();
  ctx.clip(wall.path);
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = pool;
  ctx.fillRect(x - reach, y - reach, reach * 2, reach * 2);
  ctx.restore();
}

/**
 * The lantern over the doors on its bracket: its glass dark by day, and by night `burning` bright
 * about its flame.
 */
function drawLantern(
  ctx: CanvasRenderingContext2D,
  lantern: Lantern,
  look: Look,
  paint: (color: Rgb) => Rgb,
  burning: number,
  px: number,
): void {
  const iron = css(paint(PAINT.iron));
  ctx.fillStyle = iron;
  ctx.fill(lantern.plate);
  ctx.strokeStyle = iron;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(LEAST_LINE, 0.018);
  ctx.stroke(lantern.arm);
  ctx.fillStyle = css(paint(mix(PAINT.iron, look.ink, 0.45)));
  ctx.fill(lantern.side);
  const pane = paint(mix(PANE.day, PANE.night, look.darkness));
  ctx.fillStyle = css(mix(pane, LAMPLIGHT.pane, burning));
  ctx.fill(lantern.glass);
  ctx.fillStyle = css(mix(mix(pane, look.ink, 0.3), LAMPLIGHT.pane, 0.7 * burning));
  ctx.fill(lantern.sideGlass);
  if (burning > 0) {
    ctx.fillStyle = css(LAMPLIGHT.heart, burning);
    ctx.fill(lantern.flame);
  }
  ctx.lineCap = "butt";
  ctx.lineWidth = Math.max(LEAST_LINE * 0.5, 0.008, 0.5 * px);
  ctx.strokeStyle = iron;
  ctx.stroke(lantern.wires);
  ctx.fillStyle = iron;
  ctx.fill(lantern.iron);
}

/** Builds the barn's walls, roof, trim, doors, windows, lantern and cupola on the page, once. */
function buildBarn(): Built {
  const { eaves, ridge, breakIn, overhang, dip, plinth } = BARN;
  const brk = BARN.break;
  const face = (
    points: Point[],
    normal: Vec3,
    paint: keyof typeof PAINT,
    snowy = false,
  ): Face => ({
    points,
    path: shapeOf(points),
    normal,
    hatch: undefined,
    paint,
    snowy,
  });
  const gableOn = (u: number, v: number): Point => ({ x: u, y: v });
  const sideOn = (u: number, v: number): Point => onPage(R, v, u);

  // The long side, `u` meters back from its front corner.
  const side: Wall = {
    wall: face(box(sideOn, 0, 0, D, eaves), unit(1, 0, 0), "walls"),
    plinth: face(box(sideOn, 0, 0, D, plinth), unit(1, 0, 0), "stone"),
    battens: new Path2D(),
    stones: stonesOn(sideOn, 0, D),
    windows: [],
    trim: new Path2D(),
    sills: new Path2D(),
    foot: shapeOf(box(sideOn, 0, 0, D, SHADOW.foot.up)),
    outline: new Path2D(),
  };
  for (let z = BARN.battens * 2; z < D - 0.05; z += BARN.battens * 2) {
    line(side.battens, sideOn(z, plinth), sideOn(z, eaves));
  }
  for (const [u0, u1] of [
    [0, BARN.trim],
    [D - BARN.trim, D],
  ] as const) {
    side.trim.addPath(shapeOf(box(sideOn, u0, plinth, u1, eaves)));
  }
  let lights = 0;
  for (let z = BARN.window.apart; z < D - 1; z += BARN.window.apart) {
    windowOn(side, sideOn, z, at(LIGHTS.windows, lights % LIGHTS.windows.length));
    lights += 1;
  }
  side.outline.addPath(side.wall.path);
  line(side.outline, sideOn(0, plinth), sideOn(D, plinth));

  // The gable end, up under the roof, with the great doors and the hayloft door in it.
  const { door, loft } = BARN;
  const d0 = X - door.width / 2;
  const d1 = X + door.width / 2;
  const l0 = X - loft.width / 2;
  const l1 = X + loft.width / 2;
  const u1 = at(UNDER, 1);
  const u2 = at(UNDER, 2);
  const u3 = at(UNDER, 3);
  const gable: Gable = {
    wall: face(
      [
        { x: L, y: 0 },
        { x: R, y: 0 },
        { x: R, y: eaves },
        u3,
        u2,
        u1,
        { x: L, y: eaves },
      ],
      unit(0, 0, 1),
      "walls",
    ),
    plinth: face(box(gableOn, L, 0, R, plinth), unit(0, 0, 1), "stone"),
    battens: new Path2D(),
    stones: stonesOn(gableOn, L, R),
    windows: [],
    trim: new Path2D(),
    sills: new Path2D(),
    foot: shapeOf(box(gableOn, L, 0, R, SHADOW.foot.up)),
    outline: new Path2D(),
    doors: new Path2D(),
    iron: new Path2D(),
  };
  for (let x = L + BARN.battens; x < R - 0.05; x += BARN.battens) {
    line(gable.battens, { x, y: plinth }, { x, y: underAt(x) });
  }
  // White boards up the corners, from the foundation to the roof's underside.
  const t = BARN.trim;
  gable.trim.addPath(
    shapeOf([
      { x: L, y: plinth },
      { x: L + t, y: plinth },
      { x: L + t, y: underAt(L + t) },
      { x: L, y: eaves },
    ]),
  );
  gable.trim.addPath(
    shapeOf([
      { x: R - t, y: plinth },
      { x: R, y: plinth },
      { x: R, y: eaves },
      { x: R - t, y: underAt(R - t) },
    ]),
  );
  for (const x of [(L + d0) / 2, (d1 + R) / 2]) {
    windowOn(gable, gableOn, x, at(LIGHTS.windows, lights % LIGHTS.windows.length));
    lights += 1;
  }

  // The great doors, each leaf framed and braced across in white, hung on strap hinges, with
  // pulls where they meet.
  gable.doors.addPath(shapeOf(box(gableOn, d0, 0, d1, door.height)));
  for (const [a, b, hinged] of [
    [d0, X, 1],
    [X, d1, -1],
  ] as const) {
    leaf(gable.trim, a, b, 0, door.height, DOORS.frame, DOORS.brace, true);
    const edge = hinged === 1 ? a : b;
    for (const y of [DOORS.hinge.from, door.height - DOORS.hinge.from]) {
      strap(gable.iron, edge, y, hinged, DOORS.hinge.long, DOORS.hinge.deep);
    }
  }
  const { pull } = DOORS;
  for (const side of [-1, 1]) {
    const x = X + side * pull.apart;
    gable.iron.addPath(
      shapeOf(
        box(
          gableOn,
          x - pull.wide / 2,
          pull.at - pull.tall / 2,
          x + pull.wide / 2,
          pull.at + pull.tall / 2,
        ),
      ),
    );
  }
  gable.doors.addPath(shapeOf(box(gableOn, l0, loft.bottom, l1, loft.top)));
  leaf(
    gable.trim,
    l0,
    l1,
    loft.bottom,
    loft.top,
    LOFT_DOOR.frame,
    LOFT_DOOR.brace,
    false,
  );
  for (const y of [
    loft.bottom + LOFT_DOOR.hinge.from,
    loft.top - LOFT_DOOR.hinge.from,
  ]) {
    strap(gable.iron, l0, y, 1, LOFT_DOOR.hinge.long, LOFT_DOOR.hinge.deep);
  }
  // Its outline, kept off the doors: the foundation's top either side of them, and the doors'
  // edges and the meeting of their leaves.
  gable.outline.addPath(gable.wall.path);
  line(gable.outline, { x: L, y: plinth }, { x: d0, y: plinth });
  line(gable.outline, { x: d1, y: plinth }, { x: R, y: plinth });
  gable.outline.moveTo(d0, 0);
  gable.outline.lineTo(d0, door.height);
  gable.outline.lineTo(d1, door.height);
  gable.outline.lineTo(d1, 0);
  line(gable.outline, { x: X, y: 0 }, { x: X, y: door.height });
  gable.outline.addPath(shapeOf(box(gableOn, l0, loft.bottom, l1, loft.top)));

  // The near pitches of the roof, the lower then the upper, and the courses along them.
  const roof = [
    face(
      [
        onPage(R + overhang, eaves - dip, FRONT),
        onPage(R + overhang, eaves - dip, BACK),
        onPage(R - breakIn, brk, BACK),
        onPage(R - breakIn, brk, FRONT),
      ],
      unit(brk - eaves + dip, overhang + breakIn, 0),
      "roof",
      true,
    ),
    face(
      [
        onPage(R - breakIn, brk, FRONT),
        onPage(R - breakIn, brk, BACK),
        onPage(X, ridge, BACK),
        onPage(X, ridge, FRONT),
      ],
      unit(ridge - brk, R - breakIn - X, 0),
      "roof",
      true,
    ),
  ];
  const courses = new Path2D();
  for (const [low, high] of [
    [eaves - dip, brk],
    [brk, ridge],
  ] as const) {
    const steps = Math.floor((high - low) / (BARN.courses * 0.6));
    for (let i = 1; i < steps; i += 1) {
      const y = low + ((high - low) * i) / steps;
      const x = rooflineAt(y);
      line(courses, onPage(x, y, FRONT), onPage(x, y, BACK));
    }
  }

  // Under the far pitches where they reach out past the gable end and the left wall, seen from
  // below: the lower one runs on under the eaves behind the corner, out to the foot of the board
  // along them.
  const toFront = (p: Point): Point => onPage(p.x, p.y, FRONT);
  const u0 = at(UNDER, 0);
  const below = (a: Point, b: Point): Vec3 => unit(b.y - a.y, a.x - b.x, 0);
  const soffits = [
    face(
      [toFront(u0), toFront(u1), u1, { x: L, y: eaves }, { x: L, y: u0.y }],
      below(at(ROOFLINE, 0), at(ROOFLINE, 1)),
      "trim",
    ),
    face(
      [toFront(u1), toFront(u2), u2, u1],
      below(at(ROOFLINE, 1), at(ROOFLINE, 2)),
      "trim",
    ),
  ];
  const u4 = at(UNDER, 4);
  const fascia = face(
    [
      onPage(R + overhang, u4.y, FRONT),
      onPage(R + overhang, u4.y, BACK),
      onPage(R + overhang, eaves - dip, BACK),
      onPage(R + overhang, eaves - dip, FRONT),
    ],
    unit(1, 0, 0),
    "trim",
  );
  const verge = face(
    [...ROOFLINE.map(toFront), ...[...UNDER].reverse().map(toFront)],
    unit(0, 0, 1),
    "trim",
  );

  return {
    side,
    gable,
    lantern: buildLantern(),
    roof,
    courses,
    soffits,
    fascia,
    verge,
    cupola: buildCupola(face),
    vane: VANE_FOOT,
  };
}

/** The corners of a box from (`u0`, `v0`) to (`u1`, `v1`) on a wall, placed on the page by `on`. */
function box(
  on: (u: number, v: number) => Point,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
): Point[] {
  return [on(u0, v0), on(u1, v0), on(u1, v1), on(u0, v1)];
}

/** Adds a line from `from` to `to` to `path`. */
function line(path: Path2D, from: Point, to: Point): void {
  path.moveTo(from.x, from.y);
  path.lineTo(to.x, to.y);
}

/**
 * The joints between the foundation's stones along a wall from `u0` to `u1`, placed by `on`: one
 * along the middle, and between the stones of each course, the upper course's set half a stone on.
 */
function stonesOn(
  on: (u: number, v: number) => Point,
  u0: number,
  u1: number,
): Path2D {
  const joints = new Path2D();
  const half = BARN.plinth / 2;
  line(joints, on(u0, half), on(u1, half));
  for (const [low, high, from] of [
    [0, half, u0 + STONES.long / 2],
    [half, BARN.plinth, u0 + STONES.long],
  ] as const) {
    for (let u = from; u < u1 - 0.1; u += STONES.long) {
      line(joints, on(u, low), on(u, high));
    }
  }
  return joints;
}

/**
 * A window `u` along `wall`, placed by `on`, lit once it grows `wakes` dark: its glass and
 * glazing bars, its white casing and sill, and the shadow under the sill.
 */
function windowOn(
  wall: Wall,
  on: (u: number, v: number) => Point,
  u: number,
  wakes: number,
): void {
  const { width, height, sill } = BARN.window;
  const f = CASING.width;
  const a = u - width / 2;
  const b = u + width / 2;
  const low = sill;
  const high = sill + height;
  for (const [u0, v0, u1, v1] of [
    [a - f, high, b + f, high + f],
    [a - f, low - f, b + f, low],
    [a - f, low, a, high],
    [b, low, b + f, high],
  ] as const) {
    wall.trim.addPath(shapeOf(box(on, u0, v0, u1, v1)));
  }
  const { past, deep, shadow } = CASING.sill;
  const ledge = low - f;
  wall.trim.addPath(
    shapeOf(box(on, a - f - past, ledge - deep, b + f + past, ledge)),
  );
  wall.sills.addPath(
    shapeOf(
      box(on, a - f - past, ledge - deep - shadow, b + f + past, ledge - deep),
    ),
  );
  const bars = new Path2D();
  line(bars, on(u, low), on(u, high));
  line(bars, on(a, (low + high) / 2), on(b, (low + high) / 2));
  wall.windows.push({
    glass: shapeOf(box(on, a, low, b, high)),
    bars,
    middle: on(u, (low + high) / 2),
    wakes,
  });
}

/**
 * A leaf of a door on the gable end, from `a` to `b` across and `y0` to `y1` up, added to `trim`:
 * the boards framing it `frame` wide, and braces `brace` wide from corner to corner inside the
 * frame, both ways for an X or one way, rising to the right.
 */
function leaf(
  trim: Path2D,
  a: number,
  b: number,
  y0: number,
  y1: number,
  frame: number,
  brace: number,
  both: boolean,
): void {
  const on = (u: number, v: number): Point => ({ x: u, y: v });
  for (const [u0, v0, u1, v1] of [
    [a, y1 - frame, b, y1],
    [a, y0, b, y0 + frame],
    [a, y0 + frame, a + frame, y1 - frame],
    [b - frame, y0 + frame, b, y1 - frame],
  ] as const) {
    trim.addPath(shapeOf(box(on, u0, v0, u1, v1)));
  }
  const inside = {
    left: a + frame,
    right: b - frame,
    bottom: y0 + frame,
    top: y1 - frame,
  };
  const corners: [Point, Point][] = [
    [
      { x: inside.left, y: inside.bottom },
      { x: inside.right, y: inside.top },
    ],
  ];
  if (both) {
    corners.push([
      { x: inside.left, y: inside.top },
      { x: inside.right, y: inside.bottom },
    ]);
  }
  for (const [from, to] of corners) {
    trim.addPath(shapeOf(clipToBox(bandAlong(from, to, brace), inside)));
  }
}

/** A band `width` wide along the line from `from` to `to`, running on past either end. */
function bandAlong(from: Point, to: Point, width: number): Point[] {
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
function clipToBox(
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
 * An iron strap hinge on a door whose edge is at `x`, `y` up, reaching `long` in across it toward
 * `inward` and `deep` deep at the edge, tapering to a round end, added to `iron`.
 */
function strap(
  iron: Path2D,
  x: number,
  y: number,
  inward: 1 | -1,
  long: number,
  deep: number,
): void {
  const end = x + inward * long;
  iron.addPath(
    shapeOf([
      { x, y: y - deep / 2 },
      { x: end, y: y - deep * 0.3 },
      { x: end, y: y + deep * 0.3 },
      { x, y: y + deep / 2 },
    ]),
  );
  iron.addPath(shapeOf(disc({ x: end, y }, deep * 0.45)));
}

/** A round shape about `middle`, `radius` across, as a polygon of `corners` corners. */
function disc(middle: Point, radius: number, corners = 14): Point[] {
  return Array.from({ length: corners }, (_, i) => {
    const angle = (i / corners) * Math.PI * 2;
    return {
      x: middle.x + Math.cos(angle) * radius,
      y: middle.y + Math.sin(angle) * radius,
    };
  });
}

/**
 * The lantern over the doors. It hangs from a ring on an arm reaching out from a plate on the wall:
 * under its little roof and the vent atop it, a box of glass, wider at the top, framed in iron and
 * guarded by wires, with a flame within, on a base that tapers to a drip. Its right side shows,
 * running back toward the wall.
 */
function buildLantern(): Lantern {
  const hookAt = BARN.door.height + LANTERN.hook;
  const hook = onPage(X, hookAt, -LANTERN.out);
  const side = BARN.recede * LANTERN.deep;
  const by = (dx: number, dy: number): Point => ({
    x: hook.x + dx,
    y: hook.y + dy,
  });
  // A band across the lantern from `top` down to `bottom`, `upper` and then `lower` either side of
  // its middle; and that band's side, running back from its right edge.
  const band = (top: number, upper: number, bottom: number, lower: number): Point[] => [
    by(-upper, top),
    by(upper, top),
    by(lower, bottom),
    by(-lower, bottom),
  ];
  const flank = (top: number, upper: number, bottom: number, lower: number): Point[] => [
    by(upper, top),
    by(upper + side, top),
    by(lower + side, bottom),
    by(lower, bottom),
  ];
  const iron = new Path2D();
  const sides = new Path2D();
  // The vent and its hat, the roof, and the brim under it.
  const cap: [number, number, number, number][] = [
    [-0.022, 0.03, -0.036, 0.056],
    [-0.036, 0.03, -0.072, 0.03],
    [-0.072, 0.05, -0.16, 0.165],
    [-0.16, 0.172, -0.178, 0.172],
  ];
  for (const [top, upper, bottom, lower] of cap) {
    iron.addPath(shapeOf(band(top, upper, bottom, lower)));
    sides.addPath(shapeOf(flank(top, upper, bottom, lower)));
  }
  // The glass, and the iron framing it: a band along its top and its foot, and a post up each
  // corner, the far one at the back of its side.
  const top = -0.178;
  const bottom = -0.43;
  const upper = 0.125;
  const lower = 0.1;
  const post = 0.018;
  iron.addPath(shapeOf(band(top, upper, top - 0.018, upper - 0.003)));
  iron.addPath(shapeOf(band(bottom + 0.016, lower + 0.002, bottom, lower)));
  iron.addPath(
    shapeOf([by(-upper, top), by(-upper + post, top), by(-lower + post, bottom), by(-lower, bottom)]),
  );
  iron.addPath(
    shapeOf([by(upper - post, top), by(upper, top), by(lower, bottom), by(lower - post, bottom)]),
  );
  sides.addPath(
    shapeOf([
      by(upper + side - post * 0.6, top),
      by(upper + side, top),
      by(lower + side, bottom),
      by(lower + side - post * 0.6, bottom),
    ]),
  );
  // Its base, the drip under it, and the burner the flame rises from.
  iron.addPath(shapeOf(band(bottom, 0.11, bottom - 0.03, 0.075)));
  sides.addPath(shapeOf(flank(bottom, 0.11, bottom - 0.03, 0.075)));
  iron.addPath(shapeOf([by(-0.04, bottom - 0.03), by(0.04, bottom - 0.03), by(0, bottom - 0.08)]));
  iron.addPath(shapeOf(band(-0.385, 0.022, -0.41, 0.03)));
  const flame = shapeOf(
    Array.from({ length: 16 }, (_, i) => {
      const angle = (i / 16) * Math.PI * 2;
      // Fuller below and drawn to a point above, as a candle's flame.
      const sharp = Math.sin(angle) > 0 ? 1 - 0.45 * Math.sin(angle) : 1;
      return by(0.022 * Math.cos(angle) * sharp, -0.31 + 0.045 * Math.sin(angle));
    }),
  );
  const wires = new Path2D();
  for (const dx of [-0.045, 0.045]) {
    line(wires, by(dx, top - 0.018), by(dx * 0.85, bottom + 0.016));
  }
  line(wires, by(-0.112, -0.3), by(0.112, -0.3));

  // The plate on the wall and the arm reaching out from it, braced, to the ring the lantern hangs by.
  const plate = shapeOf([
    { x: X - 0.045, y: hookAt - 0.08 },
    { x: X + 0.045, y: hookAt - 0.08 },
    { x: X + 0.045, y: hookAt + 0.2 },
    { x: X, y: hookAt + 0.23 },
    { x: X - 0.045, y: hookAt + 0.2 },
  ]);
  const arm = new Path2D();
  arm.moveTo(X, hookAt + 0.1);
  arm.bezierCurveTo(X - 0.02, hookAt + 0.15, hook.x + 0.01, hookAt + 0.13, hook.x, hookAt + 0.05);
  line(arm, { x: X, y: hookAt - 0.03 }, { x: X - 0.045, y: hookAt + 0.12 });
  arm.moveTo(hook.x + 0.018, hookAt + 0.01);
  arm.arc(hook.x, hookAt + 0.01, 0.018, 0, Math.PI * 2);

  return {
    plate,
    arm,
    iron,
    side: sides,
    glass: shapeOf(band(top, upper, bottom, lower)),
    sideGlass: shapeOf(flank(top, upper, bottom, lower)),
    flame,
    wires,
    middle: by(0, -0.3),
  };
}

/**
 * The cupola astride the ridge halfway back: its right side, and its front standing on the ridge
 * and on the near pitch beside it, the far pitch being out of sight; louvers in each, behind white
 * slats, and white boards up its corners; and its cap, a little roof with a white gable.
 */
function buildCupola(
  face: (points: Point[], normal: Vec3, paint: keyof typeof PAINT, snowy?: boolean) => Face,
): Cupola {
  const { ridge } = BARN;
  const { cupola } = BARN;
  const cw = cupola.width / 2;
  const z0 = D / 2 - cw;
  const z1 = D / 2 + cw;
  const top = ridge + cupola.height;
  const base = roofAt(cw);
  const co = cupola.capOverhang;
  const capTop = top + cupola.cap;
  const rightOn = (u: number, v: number): Point => onPage(X + cw, v, u);
  const frontOn = (u: number, v: number): Point => onPage(u, v, z0);
  const sides = [
    face(box(rightOn, z0, base, z1, top), unit(1, 0, 0), "walls"),
    face(
      [
        frontOn(X - cw, ridge),
        frontOn(X, ridge),
        frontOn(X + cw, base),
        frontOn(X + cw, top),
        frontOn(X - cw, top),
      ],
      unit(0, 0, 1),
      "walls",
    ),
  ];
  const louvers = new Path2D();
  const slats = new Path2D();
  const { inset, slats: count, slat } = LOUVERS;
  const low = ridge + inset * 0.8;
  const high = top - inset;
  const share = (high - low) / count;
  for (const [on, u0, u1] of [
    [rightOn, z0, z1],
    [frontOn, X - cw, X + cw],
  ] as const) {
    louvers.addPath(shapeOf(box(on, u0 + inset, low, u1 - inset, high)));
    for (let i = 0; i < count; i += 1) {
      const v = high - i * share;
      slats.addPath(
        shapeOf(box(on, u0 + inset, v - share * slat, u1 - inset, v)),
      );
    }
  }
  // Boards up its corners, each standing on the roof where that corner meets it.
  const c = LOUVERS.corners;
  const corners = new Path2D();
  corners.addPath(shapeOf(box(rightOn, z0, base, z0 + c, top)));
  corners.addPath(shapeOf(box(rightOn, z1 - c, base, z1, top)));
  corners.addPath(shapeOf(box(frontOn, X - cw, ridge, X - cw + c, top)));
  corners.addPath(
    shapeOf([
      frontOn(X + cw - c, roofAt(cw - c)),
      frontOn(X + cw, base),
      frontOn(X + cw, top),
      frontOn(X + cw - c, top),
    ]),
  );
  const cap = [
    face(
      [
        onPage(X + cw + co, top, z0 - co),
        onPage(X + cw + co, top, z1 + co),
        onPage(X, capTop, z1 + co),
        onPage(X, capTop, z0 - co),
      ],
      unit(cupola.cap, cw + co, 0),
      "roof",
      true,
    ),
    face(
      [
        onPage(X - cw - co, top, z0 - co),
        onPage(X + cw + co, top, z0 - co),
        onPage(X, capTop, z0 - co),
      ],
      unit(0, 0, 1),
      "trim",
    ),
  ];
  return { sides, louvers, slats, corners, cap };
}

/** How far out from the ridge the roof's edge is at height `y`, along its upper or lower pitch. */
function rooflineAt(y: number): number {
  const half = BARN.width / 2;
  const upper = half - BARN.breakIn;
  if (y >= BARN.break) {
    return X + (upper * (BARN.ridge - y)) / (BARN.ridge - BARN.break);
  }
  const low = BARN.eaves - BARN.dip;
  return (
    X +
    upper +
    ((half + BARN.overhang - upper) * (BARN.break - y)) / (BARN.break - low)
  );
}

/**
 * The weathervane on the ridge of the cupola's cap, in meters up from the foot of its rod: the rod,
 * how tall and how thick; a ball at its foot and another partway up; the arms of its compass, how
 * high, how far each reaches and how thick; the letters at their ends, how tall, how wide and how
 * thick their strokes, and how far past the arms; and how high the arrow turns. Seen from below,
 * every meter back from the view drops `drop` on the page, so the compass's arms reaching back and
 * toward the view show apart.
 */
const VANE = {
  rod: { tall: 1.02, thick: 0.035 },
  balls: [
    { at: 0.05, radius: 0.055 },
    { at: 0.24, radius: 0.04 },
  ],
  arms: { at: 0.44, reach: 0.34, thick: 0.022 },
  letters: { tall: 0.13, wide: 0.1, thick: 0.022, past: 0.07 },
  arrow: 0.86,
  drop: 0.3,
} as const;

/** Where the weathervane stands: on the ridge of the cupola's cap, halfway along it. */
const VANE_FOOT = onPage(
  X,
  BARN.ridge + BARN.cupola.height + BARN.cupola.cap,
  D / 2,
);

/**
 * The arrow the vane turns on, pointing the way the wind blows, in meters along it from the rod
 * and up from its middle: its shaft, its head, and the broad tail the wind pushes round.
 */
const ARROW: readonly (readonly (readonly [number, number])[])[] = [
  [
    [-0.44, -0.012],
    [0.4, -0.012],
    [0.4, 0.012],
    [-0.44, 0.012],
  ],
  [
    [0.37, 0.012],
    [0.34, 0.07],
    [0.6, 0],
    [0.34, -0.07],
    [0.37, -0.012],
  ],
  [
    [-0.36, 0.012],
    [-0.46, 0.13],
    [-0.68, 0.13],
    [-0.59, 0],
    [-0.68, -0.13],
    [-0.46, -0.13],
    [-0.36, -0.012],
  ],
];

/**
 * The cock standing on the arrow, facing the way the wind blows, in meters along the arrow and up
 * from it: its foot on the shaft, its breast, the wattle and beak and comb of its head, its back,
 * the sickle feathers of its tail, and back down its leg.
 */
const ROOSTER: readonly (readonly [number, number])[] = [
  [-0.035, 0.012],
  [0.075, 0.012],
  [0.07, 0.026],
  [0.032, 0.03],
  [0.04, 0.09],
  [0.075, 0.105],
  [0.11, 0.135],
  [0.128, 0.17],
  [0.128, 0.205],
  [0.115, 0.235],
  [0.122, 0.258],
  [0.14, 0.255],
  [0.15, 0.275],
  [0.142, 0.29],
  [0.178, 0.303],
  [0.148, 0.316],
  [0.152, 0.338],
  [0.163, 0.356],
  [0.143, 0.35],
  [0.138, 0.376],
  [0.121, 0.356],
  [0.108, 0.374],
  [0.097, 0.345],
  [0.088, 0.318],
  [0.075, 0.282],
  [0.058, 0.25],
  [0.02, 0.222],
  [-0.04, 0.208],
  [-0.08, 0.215],
  [-0.1, 0.25],
  [-0.118, 0.3],
  [-0.145, 0.355],
  [-0.185, 0.392],
  [-0.228, 0.39],
  [-0.2, 0.362],
  [-0.232, 0.348],
  [-0.252, 0.302],
  [-0.226, 0.298],
  [-0.25, 0.262],
  [-0.252, 0.218],
  [-0.228, 0.222],
  [-0.236, 0.178],
  [-0.212, 0.142],
  [-0.18, 0.128],
  [-0.13, 0.11],
  [-0.07, 0.095],
  [-0.015, 0.088],
  [0.006, 0.08],
  [0.002, 0.03],
  [-0.03, 0.026],
];

/** The compass's letters, as strokes across a box a unit wide and tall, from its middle. */
const LETTERS: Record<
  "N" | "E" | "S" | "W",
  readonly (readonly (readonly [number, number])[])[]
> = {
  N: [
    [
      [-0.5, -0.5],
      [-0.5, 0.5],
      [0.5, -0.5],
      [0.5, 0.5],
    ],
  ],
  E: [
    [
      [0.45, 0.5],
      [-0.5, 0.5],
      [-0.5, -0.5],
      [0.45, -0.5],
    ],
    [
      [-0.5, 0],
      [0.3, 0],
    ],
  ],
  S: [
    [
      [0.5, 0.32],
      [0.3, 0.5],
      [-0.3, 0.5],
      [-0.5, 0.28],
      [-0.32, 0.06],
      [0.32, -0.06],
      [0.5, -0.28],
      [0.3, -0.5],
      [-0.3, -0.5],
      [-0.5, -0.32],
    ],
  ],
  W: [
    [
      [-0.5, 0.5],
      [-0.25, -0.5],
      [0, 0.25],
      [0.25, -0.5],
      [0.5, 0.5],
    ],
  ],
};

/**
 * The weathervane in `iron`, its foot at `foot`, its arrow turned to `heading`: the rod and the
 * balls on it, the compass with its letters, east to the right and north away from the view, and
 * the arrow with the cock on it, outlined so it still shows as a line when it turns edge on.
 */
function drawVane(
  ctx: CanvasRenderingContext2D,
  foot: Point,
  heading: number,
  iron: string,
  px: number,
): void {
  const thin = Math.max(LEAST_LINE, 0.8 * px);
  // A point `u` right of the rod, `v` up from its foot and `w` back from the view.
  const point = (u: number, v: number, w: number): Point => ({
    x: foot.x + u + BARN.recede * w,
    y: foot.y + v - VANE.drop * w,
  });
  ctx.fillStyle = iron;
  ctx.strokeStyle = iron;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const { rod, arms, letters } = VANE;
  ctx.fillRect(foot.x - rod.thick / 2, foot.y, rod.thick, rod.tall);
  for (const ball of VANE.balls) {
    ctx.fill(shapeOf(disc({ x: foot.x, y: foot.y + ball.at }, ball.radius, 18)));
  }
  ctx.lineWidth = Math.max(thin, arms.thick);
  ctx.beginPath();
  for (const [du, dw] of [
    [1, 0],
    [0, 1],
  ] as const) {
    const from = point(-du * arms.reach, arms.at, -dw * arms.reach);
    const to = point(du * arms.reach, arms.at, dw * arms.reach);
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  }
  ctx.stroke();
  ctx.lineWidth = Math.max(thin, letters.thick);
  const out = arms.reach + letters.past;
  for (const [letter, du, dw] of [
    ["E", 1, 0],
    ["W", -1, 0],
    ["N", 0, 1],
    ["S", 0, -1],
  ] as const) {
    for (const stroke of LETTERS[letter]) {
      ctx.beginPath();
      stroke.forEach(([s, t], i) => {
        const across = s * letters.wide;
        const p = point(
          du * out + (dw === 0 ? across : 0),
          arms.at + t * letters.tall,
          dw * out + (dw === 0 ? 0 : across),
        );
        if (i === 0) {
          ctx.moveTo(p.x, p.y);
        } else {
          ctx.lineTo(p.x, p.y);
        }
      });
      ctx.stroke();
    }
  }
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  ctx.lineWidth = thin;
  for (const outline of [...ARROW, ROOSTER]) {
    const path = shapeOf(
      outline.map(([along, up]) => point(along * c, VANE.arrow + up, along * s)),
    );
    ctx.fill(path);
    ctx.stroke(path);
  }
}

/**
 * How the weathervane swings round to the wind: how fast it comes round for every meter a second
 * the wind blows, in radians a second, and at most; how far it overshoots, as a damping ratio; and
 * how soon it stills in calm air. The wind it catches veers about the upright as it blows, up to
 * `light` radians either way in a breeze and `strong` in a gale, wandering over about `seconds`.
 */
const SWING = { rate: 0.4, most: 5, damping: 0.3, friction: 0.5 } as const;
const VEER = { light: 0.6, strong: 0.15, seconds: 7 } as const;

/** The weathervane on the barn's cupola, swinging round to point the way the wind blows. */
export class Weathervane {
  /** Which way its arrow points, in radians from straight right, turning back away from the view. */
  heading = Math.PI;
  private spin = 0;
  private time = 0;
  /** Which way the wind blows, kept through a calm. */
  private from = Math.PI;

  /** Swings the vane on by `dt` seconds in `wind`. */
  update(dt: number, wind: Wind): void {
    this.time += dt;
    const air = wind.at(VANE_FOOT.x, VANE_FOOT.y + VANE.arrow, 0).x;
    const speed = Math.abs(air);
    if (speed > 0.05) {
      const veer =
        lerp(VEER.light, VEER.strong, smoothstep(2, 16, speed)) *
        valueNoise(this.time / VEER.seconds, 977);
      this.from = (air > 0 ? 0 : Math.PI) + veer;
    }
    const rate = Math.min(SWING.most, SWING.rate * speed);
    const off = wrapAngle(this.from - this.heading);
    // A vane pointing into the wind is balanced on a knife's edge, and comes round one way or
    // the other.
    const push =
      Math.sin(off) + 0.5 * Math.sign(off) * Math.max(0, -Math.cos(off));
    this.spin +=
      (rate * rate * push -
        (2 * SWING.damping * rate + SWING.friction) * this.spin) *
      dt;
    this.heading = wrapAngle(this.heading + this.spin * dt);
  }
}
