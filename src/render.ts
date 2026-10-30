import type { Camera } from './camera';
import { PALETTE } from './palette';
import { TRUNK, type Trunk } from './trunk';
import { at, invariant, Rng } from './util';

/** The trunk never renders thinner than this many CSS pixels across, so the tip survives zooming out. */
const MIN_WIDTH_PX = 1.1;
/** Strength of the pale sand grain over every ink shape. */
const INK_GRAIN = 0.075;
/** Length of the root flare's ground-side handle, as a fraction of how far the flare spreads. */
const FLARE_HUG = 0.6;
/** Length of the root flare's trunk-side handle, as a fraction of the height where it joins the trunk. */
const FLARE_LIFT = 0.5;

interface EdgePoint {
  x: number;
  y: number;
  /** Unit tangent of the centerline at this point, pointing toward the tip. */
  tx: number;
  ty: number;
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly grain: CanvasPattern;
  private sky: CanvasGradient | undefined;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    invariant(ctx !== null, 'Canvas 2D is not available.');
    this.ctx = ctx;
    const grain = ctx.createPattern(grainTile(), 'repeat');
    invariant(grain !== null, 'Could not create the grain pattern.');
    this.grain = grain;
  }

  resize(camera: Camera): void {
    this.canvas.width = Math.round(camera.width * camera.dpr);
    this.canvas.height = Math.round(camera.height * camera.dpr);
    const cx = camera.width * camera.dpr * 0.5;
    const cy = camera.groundY * camera.dpr;
    const sky = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(cx, cy) * 1.05);
    sky.addColorStop(0, PALETTE.paperGlow);
    sky.addColorStop(0.55, PALETTE.paper);
    sky.addColorStop(1, PALETTE.paperShade);
    this.sky = sky;
  }

  /** Draws in device pixels throughout so every ink shape shares one grain. */
  draw(camera: Camera, trunk: Trunk): void {
    const ctx = this.ctx;
    invariant(this.sky !== undefined, 'Renderer.resize must run before draw.');
    const width = this.canvas.width;
    const groundY = camera.groundY * camera.dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.sky;
    ctx.fillRect(0, 0, width, groundY);

    // The ground and trunk meet edge to edge along the ground line without overlapping, so the
    // grain lands on each pixel of ink exactly once.
    const ink = new Path2D();
    ink.rect(0, groundY, width, this.canvas.height - groundY);
    ink.addPath(trunkPath(trunk, MIN_WIDTH_PX / 2 / camera.scale), camera.worldTransform());
    ctx.fillStyle = PALETTE.ink;
    ctx.fill(ink);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = INK_GRAIN;
    ctx.fillStyle = this.grain;
    ctx.fill(ink);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}

/** Sparse pale specks on transparency, tiled over the ink. */
function grainTile(): HTMLCanvasElement {
  const size = 256;
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const ctx = tile.getContext('2d');
  invariant(ctx !== null, 'Canvas 2D is not available for the grain tile.');
  const image = ctx.createImageData(size, size);
  const rng = new Rng(7);
  for (let i = 0; i < size * size; i += 1) {
    image.data[i * 4] = 244;
    image.data[i * 4 + 1] = 236;
    image.data[i * 4 + 2] = 220;
    image.data[i * 4 + 3] = Math.round(Math.pow(rng.next(), 2.4) * 255);
  }
  ctx.putImageData(image, 0, 0);
  return tile;
}

/**
 * One closed silhouette: the root flare rising out of the ground on the left, up the left edge,
 * around the tip, down the right edge and back down through the right flare. It closes along
 * the ground line, where the ground takes over.
 */
function trunkPath(trunk: Trunk, minRadius: number): Path2D {
  const radius = (s: number): number => Math.max(minRadius, trunk.radiusAt(s));
  const left = edge(trunk, radius, 1);
  const right = edge(trunk, radius, -1);

  const baseRadius = radius(0);
  const maxRise = 0.3 * trunk.tip.y;
  const leftSpread = TRUNK.flareSpread * baseRadius * trunk.flare.left;
  const rightSpread = TRUNK.flareSpread * baseRadius * trunk.flare.right;
  const leftJoin = firstAbove(left, Math.min(TRUNK.flareRise * baseRadius * trunk.flare.left, maxRise));
  const rightJoin = firstAbove(right, Math.min(TRUNK.flareRise * baseRadius * trunk.flare.right, maxRise));
  const groundLeft = at(left, 0).x - leftSpread;
  const groundRight = at(right, 0).x + rightSpread;

  const path = new Path2D();
  path.moveTo(groundLeft, 0);
  const lj = at(left, leftJoin);
  const leftLift = lj.y * FLARE_LIFT;
  path.bezierCurveTo(groundLeft + leftSpread * FLARE_HUG, 0, lj.x - lj.tx * leftLift, lj.y - lj.ty * leftLift, lj.x, lj.y);
  smoothThrough(path, left.slice(leftJoin));

  const tip = trunk.tip;
  path.arc(tip.x, tip.y, radius(tip.s), tip.heading + Math.PI / 2, tip.heading - Math.PI / 2, true);

  smoothThrough(path, right.slice(rightJoin).reverse());
  const rj = at(right, rightJoin);
  const rightLift = rj.y * FLARE_LIFT;
  path.bezierCurveTo(rj.x - rj.tx * rightLift, rj.y - rj.ty * rightLift, groundRight - rightSpread * FLARE_HUG, 0, groundRight, 0);
  path.closePath();
  return path;
}

/** Offsets the centerline to one side: 1 for the left edge, -1 for the right. */
function edge(trunk: Trunk, radius: (s: number) => number, side: 1 | -1): EdgePoint[] {
  const points: EdgePoint[] = [];
  for (const p of trunk.points) {
    const tx = Math.cos(p.heading);
    const ty = Math.sin(p.heading);
    const r = radius(p.s) * side;
    const candidate = { x: p.x - ty * r, y: p.y + tx * r, tx, ty };
    const previous = points[points.length - 1];
    // Where thick wood curves tightly, the inner edge would fold back on itself. Dropping the
    // points that move backward leaves a clean crease instead of a loop.
    if (previous === undefined || (candidate.x - previous.x) * tx + (candidate.y - previous.y) * ty > 0) {
      points.push(candidate);
    }
  }
  return points;
}

function firstAbove(points: readonly EdgePoint[], height: number): number {
  const index = points.findIndex((p) => p.y >= height);
  invariant(index >= 0, `No trunk edge point reaches height ${height}.`);
  return index;
}

/** Continues `path` from points[0] through the rest, rounding each corner with a quadratic curve. */
function smoothThrough(path: Path2D, points: readonly EdgePoint[]): void {
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = at(points, i);
    const next = at(points, i + 1);
    path.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
  }
  const last = at(points, points.length - 1);
  path.lineTo(last.x, last.y);
}
