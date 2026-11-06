import type { Camera } from "./camera";
import { css, lit, mix, type Rgb, type SkyLight } from "./sky";
import { at, hash, lerp, smoothstep } from "./util";
import type { Vec } from "./wind";

/**
 * A farm's ground is drawn after the sand drawing of a tree on hills (reference 14): a few hills
 * raked in contour lines, each rising out of the depths to just under the surface and falling away
 * again, its lines following its top down into the ground like the ridges of a fingerprint. Hills
 * stand one in front of another, and between them the ground is plain ink.
 *
 * Hills stand about `spacing` meters apart along the land, each a little to one side or the other
 * of its place, by up to `jitter` of the spacing. Its crest lies `crest` meters under the surface,
 * and its top arches away from it, lower on one side than the other: `side` meters out from the
 * crest it lies `drop` meters deeper, and ever more steeply further out.
 */
const HILLS = {
  spacing: 21,
  jitter: 0.5,
  crest: { from: 0.2, to: 0.6 },
  side: { from: 6.5, to: 10 },
  drop: 2.4,
} as const;

/**
 * Gap between a hill's contour lines, in meters, halved or doubled until it is from `nearestPx` to
 * twice that on screen, so the lines are as close however near the view.
 */
const CONTOURS = { gap: 0.2, nearestPx: 8 } as const;

/** Sand the hills are raked in by day at midsummer, from the palest hill to the deepest. */
const SAND = {
  pale: [216, 184, 128],
  deep: [190, 146, 86],
} as const satisfies Record<string, Rgb>;

/**
 * Through the fall the sand turns toward russet, and through the winter toward a cold grey-brown,
 * by up to these shares.
 */
const RUSSET: Rgb = [184, 132, 90];
const COLD: Rgb = [138, 128, 114];
const TURN = { fall: 0.3, winter: 0.5 } as const;

/**
 * Lines, in CSS pixels: how wide a hill's contour lines and its top are; how far toward the ink they
 * are drawn on the sand; and, carved into the ink without colors as the barn's lines are, how
 * strongly each shows.
 */
const LINES = {
  contour: 1.1,
  top: 1.4,
  contourInk: 0.45,
  topInk: 0.75,
  carved: { contour: 0.3, top: 0.5 },
} as const;

/** One hill: where its crest stands along the land, how far under the surface, and its sides. */
interface Hill {
  x: number;
  crest: number;
  left: number;
  right: number;
  /** Hills nearer the front are drawn over those behind them. */
  front: number;
  /** From the palest sand at 0 to the deepest at 1. */
  tone: number;
}

/**
 * Draws a farm's hills over its ground, which is already filled with ink: each raked in contour
 * lines, in its sand for `season` under `light` if `colors`, or else carved into the ink. `surface`
 * is the ground line across the view, in device pixels.
 */
export function drawFields(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  surface: readonly Vec[],
  light: SkyLight,
  season: number,
  colors: boolean,
): void {
  const dpr = camera.dpr;
  const xs = surface.map((p) => camera.toWorld(p.x / dpr, 0).x);
  const down = camera.scale * dpr;
  const bottom = camera.height * dpr;
  const gap = spaced(camera, CONTOURS.gap);
  // How far down the view reaches under the surface, in meters, at most.
  const deepest = (bottom - Math.min(...surface.map((p) => p.y))) / down;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const hill of hillsAcross(at(xs, 0), at(xs, xs.length - 1), deepest)) {
    // The columns its top shows in, and how far down the view its top lies in each.
    const columns: number[] = [];
    for (const [i, x] of xs.entries()) {
      const depth = topOf(hill, x);
      if (at(surface, i).y + depth * down < bottom) {
        columns.push(i);
      }
    }
    if (columns.length < 2) {
      continue;
    }
    const first = at(columns, 0);
    const last = at(columns, columns.length - 1);
    const span = xs.slice(first, last + 1);
    const across = surface.slice(first, last + 1);
    const tops = span.map((x) => topOf(hill, x));
    const rowsAt = (depths: readonly number[]): number[] =>
      depths.map((d, i) => Math.min(bottom + 1, at(across, i).y + d * down));
    const top = rowsAt(tops);
    const shape = lineThrough(across, top);
    shape.lineTo(at(across, across.length - 1).x, bottom + 1);
    shape.lineTo(at(across, 0).x, bottom + 1);
    shape.closePath();

    const sand = lit(
      seasoned(mix(SAND.pale, SAND.deep, hill.tone), season),
      light.flowerLight,
    );
    ctx.save();
    ctx.clip(shape);
    // A hill hides what lies behind it: in its sand, or without colors in the ink.
    ctx.fillStyle = css(colors ? sand : light.ink);
    ctx.fill(shape);
    const lines = new Path2D();
    for (let j = 1; ; j += 1) {
      const rows = rowsAt(tops.map((d) => d + j * gap));
      if (Math.min(...rows) >= bottom) {
        break;
      }
      lines.addPath(lineThrough(across, rows));
    }
    ctx.lineWidth = LINES.contour * dpr;
    ctx.strokeStyle = colors
      ? css(mix(sand, light.ink, LINES.contourInk))
      : css(light.sky.middle, LINES.carved.contour);
    ctx.stroke(lines);
    ctx.restore();
    ctx.lineWidth = LINES.top * dpr;
    ctx.strokeStyle = colors
      ? css(mix(sand, light.ink, LINES.topInk))
      : css(light.sky.middle, LINES.carved.top);
    ctx.stroke(lineThrough(across, top));
  }
  ctx.restore();
}

/**
 * The hills that show between `left` and `right` along the land, in a view reaching `deepest`
 * meters under the surface, from the one furthest back to the one nearest the front. Each is set by
 * where it stands, so it keeps its place as the view moves.
 */
function hillsAcross(left: number, right: number, deepest: number): Hill[] {
  const reach = HILLS.side.to * Math.sqrt(Math.max(deepest, 0) / HILLS.drop);
  const hills: Hill[] = [];
  for (
    let n = Math.floor((left - reach) / HILLS.spacing);
    n <= Math.ceil((right + reach) / HILLS.spacing);
    n += 1
  ) {
    hills.push({
      x: HILLS.spacing * (n + 0.5 + HILLS.jitter * (hash(n, 61) - 0.5)),
      crest: lerp(HILLS.crest.from, HILLS.crest.to, hash(n, 62)),
      left: lerp(HILLS.side.from, HILLS.side.to, hash(n, 63)),
      right: lerp(HILLS.side.from, HILLS.side.to, hash(n, 64)),
      front: hash(n, 65),
      tone: hash(n, 66),
    });
  }
  return hills.sort((a, b) => a.front - b.front);
}

/** How deep the top of `hill` lies under the surface at `x`, in meters: ever deeper down its sides. */
function topOf(hill: Hill, x: number): number {
  const u = (x - hill.x) / (x < hill.x ? hill.left : hill.right);
  return hill.crest + HILLS.drop * u * u;
}

/** A line through `rows` across `surface`'s columns, in device pixels. */
function lineThrough(surface: readonly Vec[], rows: readonly number[]): Path2D {
  const path = new Path2D();
  for (const [i, p] of surface.entries()) {
    if (i === 0) {
      path.moveTo(p.x, at(rows, i));
    } else {
      path.lineTo(p.x, at(rows, i));
    }
  }
  return path;
}

/** `gap` meters, halved or doubled until it is from `CONTOURS.nearestPx` to twice that on screen. */
function spaced(camera: Camera, gap: number): number {
  const px = gap * camera.scale;
  return gap * 2 ** -Math.floor(Math.log2(px / CONTOURS.nearestPx));
}

/** `color` turned with the year: toward russet through the fall, and grey-brown through the winter. */
function seasoned(color: Rgb, season: number): Rgb {
  const fall = TURN.fall * smoothstep(0.3, 0.7, season);
  const winter = TURN.winter * smoothstep(0.7, 1, season);
  return mix(mix(color, RUSSET, fall), COLD, winter);
}
