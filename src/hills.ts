import type { Camera } from "./camera";
import { type Hill, hillTop } from "./level";
import { css, lit, mix, type Rgb, type SkyLight } from "./sky";
import { at, smoothstep } from "./util";
import type { Vec } from "./wind";

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
 * Lines, in CSS pixels: how wide a hill's contour lines and its edge are; how far toward the ink they
 * are drawn on the sand; and, carved into the ink without colors as the barn's lines are, how
 * strongly each shows.
 */
const LINES = {
  contour: 1.1,
  edge: 1.4,
  contourInk: 0.45,
  edgeInk: 0.75,
  carved: { contour: 0.3, edge: 0.5 },
} as const;

/**
 * Draws a level's hills over its ground, which is already filled with ink, after the sand drawing
 * of a tree on hills (reference 14). Each is everything under its top: where it rises out of the
 * land around it, its top is the top of the ground, and below that its top runs on down into the
 * ground, so it stands in front of the plain dirt around it. It is raked in contour lines that
 * follow its top down, nested like the ridges of a fingerprint, in its sand for `season` under
 * `light` if `colors`, or else carved into the ink. `surface` is the ground line across the view, in
 * device pixels.
 */
export function drawHills(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  hills: readonly Hill[],
  surface: readonly Vec[],
  light: SkyLight,
  season: number,
  colors: boolean,
): void {
  const dpr = camera.dpr;
  const bottom = camera.height * dpr;
  const xs = surface.map((p) => camera.toWorld(p.x / dpr, 0).x);
  const rowOf = (x: number, height: number): number =>
    Math.min(bottom + 1, camera.toScreen(x, height).y * dpr);
  const gap = spaced(camera, CONTOURS.gap);
  const ground = new Path2D();
  for (const [i, p] of surface.entries()) {
    if (i === 0) {
      ground.moveTo(p.x, p.y);
    } else {
      ground.lineTo(p.x, p.y);
    }
  }
  ground.lineTo(at(surface, surface.length - 1).x, bottom + 1);
  ground.lineTo(at(surface, 0).x, bottom + 1);
  ground.closePath();

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clip(ground);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [n, hill] of hills.entries()) {
    // The columns its top shows in.
    const columns: number[] = [];
    for (const [i, x] of xs.entries()) {
      if (rowOf(x, hillTop(hill, x)) < bottom) {
        columns.push(i);
      }
    }
    if (columns.length < 2) {
      continue;
    }
    const span = xs.slice(at(columns, 0), at(columns, columns.length - 1) + 1);
    const across = surface.slice(
      at(columns, 0),
      at(columns, columns.length - 1) + 1,
    );
    const lineAt = (below: number): { path: Path2D; top: number } => {
      const path = new Path2D();
      let top = Infinity;
      for (const [i, x] of span.entries()) {
        const y = rowOf(x, hillTop(hill, x) - below);
        top = Math.min(top, y);
        if (i === 0) {
          path.moveTo(at(across, i).x, y);
        } else {
          path.lineTo(at(across, i).x, y);
        }
      }
      return { path, top };
    };
    const edge = lineAt(0).path;
    const shape = lineAt(0).path;
    shape.lineTo(at(across, across.length - 1).x, bottom + 1);
    shape.lineTo(at(across, 0).x, bottom + 1);
    shape.closePath();

    const sand = lit(
      seasoned(
        mix(
          SAND.pale,
          SAND.deep,
          hills.length > 1 ? n / (hills.length - 1) : 0,
        ),
        season,
      ),
      light.flowerLight,
    );
    ctx.save();
    ctx.clip(shape);
    // A hill hides what lies behind it: in its sand, or without colors in the ink.
    ctx.fillStyle = css(colors ? sand : light.ink);
    ctx.fill(shape);
    const lines = new Path2D();
    for (let j = 1; ; j += 1) {
      const line = lineAt(j * gap);
      if (line.top >= bottom) {
        break;
      }
      lines.addPath(line.path);
    }
    ctx.lineWidth = LINES.contour * dpr;
    ctx.strokeStyle = colors
      ? css(mix(sand, light.ink, LINES.contourInk))
      : css(light.sky.middle, LINES.carved.contour);
    ctx.stroke(lines);
    ctx.restore();
    ctx.lineWidth = LINES.edge * dpr;
    ctx.strokeStyle = colors
      ? css(mix(sand, light.ink, LINES.edgeInk))
      : css(light.sky.middle, LINES.carved.edge);
    ctx.stroke(edge);
  }
  ctx.restore();
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
