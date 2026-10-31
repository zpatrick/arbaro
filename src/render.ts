import type { Camera } from './camera';
import type { Limb } from './limb';
import { PALETTE } from './palette';
import { FLARE, type Pick, type Tree } from './tree';
import { at, invariant, Rng } from './util';

/** No limb renders thinner than this many CSS pixels across, so tips survive zooming out. */
const MIN_WIDTH_PX = 1.1;
/** Strength of the pale sand grain over every ink shape. */
const INK_GRAIN = 0.075;
/** Length of the root flare's ground-side handle, as a fraction of how far the flare spreads. */
const FLARE_HUG = 0.6;
/** Length of the root flare's trunk-side handle, as a fraction of the height where it joins the trunk. */
const FLARE_LIFT = 0.5;
/** Fillet in the narrow corner above an offshoot, in offshoot radii along each edge. */
const CROTCH_FILLET = 2.4;
/** Fillet in the wide corner beneath an offshoot, in offshoot radii along each edge. */
const COLLAR_FILLET = 1.6;
/** Shape of a fillet's curve: 0 cuts the corner straight across and 1 leaves it sharp. */
const FILLET_ROUNDNESS = 0.55;
/** Ring around the tip being grown, in CSS pixels. */
const TIP_RING_PX = 9;
/** Length of the line previewing where a fork will grow, in CSS pixels. */
const FORK_PREVIEW_PX = 22;

interface Vec {
  x: number;
  y: number;
}

interface EdgePoint extends Vec {
  /** Unit tangent of the centerline at this point, pointing toward the tip. */
  tx: number;
  ty: number;
  /** Distance along the limb's centerline. */
  s: number;
}

interface Edges {
  left: EdgePoint[];
  right: EdgePoint[];
}

/** A point along an edge, with the direction the edge runs there. */
interface EdgeStep extends Vec {
  tx: number;
  ty: number;
}

interface Crossing {
  point: Vec;
  /** Index of the first offshoot edge point past the crossing. */
  childNext: number;
  parentEdge: readonly EdgePoint[];
  /** Which of the parent's edges was crossed: 1 for its left, -1 for its right. */
  parentSide: 1 | -1;
  /** The crossing lies between this parent edge point and the next one. */
  parentIndex: number;
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
  draw(camera: Camera, tree: Tree, hover: Pick | undefined): void {
    const ctx = this.ctx;
    invariant(this.sky !== undefined, 'Renderer.resize must run before draw.');
    const width = this.canvas.width;
    const groundY = camera.groundY * camera.dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.sky;
    ctx.fillRect(0, 0, width, groundY);

    // Every ink shape is wound the same way and filled in one pass, so overlapping limbs read as
    // one silhouette and the grain lands on each pixel of ink exactly once.
    const ink = new Path2D();
    ink.rect(0, groundY, width, this.canvas.height - groundY);
    const world = camera.worldTransform();
    for (const shape of treeShapes(tree, MIN_WIDTH_PX / 2 / camera.scale)) {
      ink.addPath(shape, world);
    }
    ctx.fillStyle = PALETTE.ink;
    ctx.fill(ink);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = INK_GRAIN;
    ctx.fillStyle = this.grain;
    ctx.fill(ink);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    this.drawGuides(camera, tree, hover);
  }

  /** Marks the limb being grown, and previews what a click would do. */
  private drawGuides(camera: Camera, tree: Tree, hover: Pick | undefined): void {
    const ctx = this.ctx;
    ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
    ctx.lineWidth = 1.25;
    ctx.lineCap = 'round';
    if (tree.limbs.length > 1) {
      const tip = tree.active.tip;
      this.ring(camera.toScreen(tip.x, tip.y), 0.55);
    }
    if (hover === undefined) {
      return;
    }
    if (hover.limb !== tree.active) {
      const tip = hover.limb.tip;
      this.ring(camera.toScreen(tip.x, tip.y), 0.25);
      return;
    }
    const s = tree.forkPoint(hover.limb, hover.s);
    const from = hover.limb.pointAt(s);
    // The fork heading is worked out on the grown shape; turn it by however far the limb has swayed.
    const heading = tree.forkHeading(hover.limb, s, hover.side) + from.heading - hover.limb.restPointAt(s).heading;
    const start = camera.toScreen(from.x, from.y);
    ctx.strokeStyle = PALETTE.ink;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(start.x + Math.cos(heading) * FORK_PREVIEW_PX, start.y - Math.sin(heading) * FORK_PREVIEW_PX);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(start.x, start.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.paper;
    ctx.fill();
    ctx.stroke();
  }

  private ring(center: Vec, alpha: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = PALETTE.ink;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(center.x, center.y, TIP_RING_PX, 0, Math.PI * 2);
    ctx.stroke();
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
 * Every shape that makes up the tree, in world coordinates and all wound clockwise: one outline
 * per limb plus the fillets that blend each offshoot into its parent.
 */
function treeShapes(tree: Tree, minRadius: number): Path2D[] {
  const edges = new Map<Limb, Edges>();
  const shapes: Path2D[] = [];
  for (const limb of tree.limbs) {
    const own = { left: edge(limb, minRadius, 1), right: edge(limb, minRadius, -1) };
    edges.set(limb, own);
    if (limb.attachment === undefined) {
      shapes.push(rootOutline(tree, own, minRadius));
      continue;
    }
    shapes.push(limbOutline(limb, own, minRadius));
    const parent = edges.get(limb.attachment.parent);
    invariant(parent !== undefined, 'A parent limb must be outlined before its offshoots.');
    shapes.push(...forkFillets(limb, own, parent, minRadius));
  }
  return shapes;
}

/**
 * The trunk's silhouette: the root flare rising out of the ground on the left, up the left edge,
 * around the tip, down the right edge and back down through the right flare. It closes along
 * the ground line, where the ground takes over.
 */
function rootOutline(tree: Tree, { left, right }: Edges, minRadius: number): Path2D {
  const trunk = tree.root;
  const baseRadius = Math.max(minRadius, trunk.radiusAt(0));
  const maxRise = 0.3 * trunk.restTip.y;
  const leftSpread = FLARE.spread * baseRadius * tree.flare.left;
  const rightSpread = FLARE.spread * baseRadius * tree.flare.right;
  const leftJoin = firstAbove(left, Math.min(FLARE.rise * baseRadius * tree.flare.left, maxRise));
  const rightJoin = firstAbove(right, Math.min(FLARE.rise * baseRadius * tree.flare.right, maxRise));
  const groundLeft = at(left, 0).x - leftSpread;
  const groundRight = at(right, 0).x + rightSpread;

  const path = new Path2D();
  path.moveTo(groundLeft, 0);
  const lj = at(left, leftJoin);
  const leftLift = lj.y * FLARE_LIFT;
  path.bezierCurveTo(groundLeft + leftSpread * FLARE_HUG, 0, lj.x - lj.tx * leftLift, lj.y - lj.ty * leftLift, lj.x, lj.y);
  smoothThrough(path, left.slice(leftJoin));
  tipCap(path, trunk, minRadius);
  smoothThrough(path, right.slice(rightJoin).reverse());
  const rj = at(right, rightJoin);
  const rightLift = rj.y * FLARE_LIFT;
  path.bezierCurveTo(rj.x - rj.tx * rightLift, rj.y - rj.ty * rightLift, groundRight - rightSpread * FLARE_HUG, 0, groundRight, 0);
  path.closePath();
  return path;
}

/** An offshoot's silhouette. Its base sits inside its parent, so it closes straight across. */
function limbOutline(limb: Limb, { left, right }: Edges, minRadius: number): Path2D {
  const path = new Path2D();
  const start = at(left, 0);
  path.moveTo(start.x, start.y);
  smoothThrough(path, left);
  tipCap(path, limb, minRadius);
  smoothThrough(path, [...right].reverse());
  path.closePath();
  return path;
}

function tipCap(path: Path2D, limb: Limb, minRadius: number): void {
  const tip = limb.tip;
  path.arc(tip.x, tip.y, Math.max(minRadius, limb.radiusAt(tip.s)), tip.heading + Math.PI / 2, tip.heading - Math.PI / 2, true);
}

/**
 * Patches that round off the two corners where an offshoot's edges leave its parent: a tight
 * crotch on the side the offshoot leans toward, and a broad collar beneath it.
 */
function forkFillets(child: Limb, own: Edges, parent: Edges, minRadius: number): Path2D[] {
  invariant(child.attachment !== undefined, 'Only an offshoot has a fork to blend.');
  const forkS = child.attachment.s;
  const span = 6 * (child.attachment.parent.radiusAt(forkS) + child.radiusAt(0));
  const patches: Path2D[] = [];
  for (const [childEdge, outside] of [
    [own.left, 1],
    [own.right, -1],
  ] as const) {
    const crossing = firstCrossing(childEdge, parent, span, forkS - span, forkS + span);
    // A freshly forked offshoot can still be entirely inside its parent on one side. There is
    // no corner to round until its edge breaks out.
    if (crossing !== undefined) {
      patches.push(fillet(child, childEdge, crossing, outside, minRadius));
    }
  }
  return patches;
}

/** The first place the offshoot's edge, walking out from its base, crosses either parent edge. */
function firstCrossing(
  childEdge: readonly EdgePoint[],
  parent: Edges,
  childSpan: number,
  parentFrom: number,
  parentTo: number,
): Crossing | undefined {
  const windows = (
    [
      [parent.left, 1],
      [parent.right, -1],
    ] as const
  ).map(([parentEdge, parentSide]) => ({
    parentEdge,
    parentSide,
    from: Math.max(0, firstAtOrAfter(parentEdge, parentFrom) - 1),
    to: Math.min(parentEdge.length - 1, firstAtOrAfter(parentEdge, parentTo) + 1),
  }));
  for (let i = 0; i + 1 < childEdge.length && at(childEdge, i).s <= childSpan; i += 1) {
    const p1 = at(childEdge, i);
    const p2 = at(childEdge, i + 1);
    for (const { parentEdge, parentSide, from, to } of windows) {
      for (let j = from; j < to; j += 1) {
        const point = intersect(p1, p2, at(parentEdge, j), at(parentEdge, j + 1));
        if (point !== undefined) {
          return { point, childNext: i + 1, parentEdge, parentSide, parentIndex: j };
        }
      }
    }
  }
  return undefined;
}

/**
 * Rounds the corner between the offshoot's edge and its parent's edge at `crossing`. `outside` is
 * the side of the offshoot edge that faces away from the offshoot: 1 for its left edge.
 */
function fillet(child: Limb, childEdge: readonly EdgePoint[], crossing: Crossing, outside: 1 | -1, minRadius: number): Path2D {
  const { point: corner, childNext, parentEdge, parentSide, parentIndex } = crossing;
  const c1 = at(childEdge, childNext - 1);
  const c2 = at(childEdge, childNext);
  const q1 = at(parentEdge, parentIndex);
  const q2 = at(parentEdge, parentIndex + 1);
  const childDir = unit(c2.x - c1.x, c2.y - c1.y);
  const parentUp = unit(q2.x - q1.x, q2.y - q1.y);
  // The open corner is on the outside of the offshoot's edge, along whichever way the parent's
  // edge heads to that side.
  const up = (childDir.x * parentUp.y - childDir.y * parentUp.x) * outside > 0;
  const toward = up ? parentUp : { x: -parentUp.x, y: -parentUp.y };
  const acute = childDir.x * toward.x + childDir.y * toward.y > 0;
  const radius = Math.max(minRadius, child.radiusAt(c1.s));
  const size = (acute ? CROTCH_FILLET : COLLAR_FILLET) * radius;

  const childLeg = walk({ ...corner, tx: childDir.x, ty: childDir.y }, childEdge, childNext, 1, size);
  const parentLeg = up
    ? walk({ ...corner, tx: parentUp.x, ty: parentUp.y }, parentEdge, parentIndex + 1, 1, size)
    : walk({ ...corner, tx: parentUp.x, ty: parentUp.y }, parentEdge, parentIndex, -1, size);
  const a = at(childLeg, childLeg.length - 1);
  const b = at(parentLeg, parentLeg.length - 1);
  const towardA = { x: a.x + (corner.x - a.x) * FILLET_ROUNDNESS, y: a.y + (corner.y - a.y) * FILLET_ROUNDNESS };
  const towardB = { x: b.x + (corner.x - b.x) * FILLET_ROUNDNESS, y: b.y + (corner.y - b.y) * FILLET_ROUNDNESS };

  // The patch's straight sides run just inside both limbs, so it overlaps the wood rather than
  // meeting it edge to edge, which can leave a hairline of paper showing through.
  const depth = Math.max(0.35 * radius, 1.5 * minRadius);
  const childInside = childLeg.map((p) => inset(p, outside * depth));
  const parentInside = parentLeg.map((p) => inset(p, parentSide * depth));

  // Wind the patch clockwise like every outline, so it adds to the silhouette instead of cutting
  // a hole where it overlaps.
  const clockwise = (a.x - corner.x) * (b.y - corner.y) - (a.y - corner.y) * (b.x - corner.x) < 0;
  const [firstInside, secondInside, firstOut, secondOut, firstHandle, secondHandle] = clockwise
    ? [childInside, parentInside, a, b, towardA, towardB]
    : [parentInside, childInside, b, a, towardB, towardA];
  const path = new Path2D();
  const start = at(firstInside, 0);
  path.moveTo(start.x, start.y);
  for (const p of firstInside.slice(1)) {
    path.lineTo(p.x, p.y);
  }
  path.lineTo(firstOut.x, firstOut.y);
  path.bezierCurveTo(firstHandle.x, firstHandle.y, secondHandle.x, secondHandle.y, secondOut.x, secondOut.y);
  for (const p of [...secondInside].reverse()) {
    path.lineTo(p.x, p.y);
  }
  path.closePath();
  return path;
}

/**
 * Moves an edge point sideways by `depth`, to the right of the way its limb grows. A left edge
 * moves inward for a positive depth and a right edge for a negative one.
 */
function inset(p: EdgeStep, depth: number): Vec {
  return { x: p.x + p.ty * depth, y: p.y - p.tx * depth };
}

/**
 * Follows `edge` from `from`, starting at index `start` and stepping by `step`, for `distance`
 * or half of what is left of the edge if that is shorter. Returns the points passed through.
 */
function walk(from: EdgeStep, edge: readonly EdgePoint[], start: number, step: 1 | -1, distance: number): EdgeStep[] {
  let available = 0;
  let previous: Vec = from;
  for (let i = start; i >= 0 && i < edge.length && available < distance * 2; i += step) {
    const p = at(edge, i);
    available += Math.hypot(p.x - previous.x, p.y - previous.y);
    previous = p;
  }
  let remaining = Math.min(distance, available * 0.5);
  const points: EdgeStep[] = [from];
  previous = from;
  for (let i = start; i >= 0 && i < edge.length; i += step) {
    const p = at(edge, i);
    const length = Math.hypot(p.x - previous.x, p.y - previous.y);
    if (length >= remaining) {
      const t = remaining / Math.max(length, 1e-12);
      points.push({ x: previous.x + (p.x - previous.x) * t, y: previous.y + (p.y - previous.y) * t, tx: p.tx, ty: p.ty });
      return points;
    }
    points.push(p);
    remaining -= length;
    previous = p;
  }
  return points;
}

function intersect(p1: Vec, p2: Vec, q1: Vec, q2: Vec): Vec | undefined {
  const rx = p2.x - p1.x;
  const ry = p2.y - p1.y;
  const sx = q2.x - q1.x;
  const sy = q2.y - q1.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-12) {
    return undefined;
  }
  const qx = q1.x - p1.x;
  const qy = q1.y - p1.y;
  const t = (qx * sy - qy * sx) / denominator;
  const u = (qx * ry - qy * rx) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) {
    return undefined;
  }
  return { x: p1.x + rx * t, y: p1.y + ry * t };
}

function unit(x: number, y: number): Vec {
  const length = Math.hypot(x, y);
  invariant(length > 0, 'Cannot take the direction of a zero-length edge segment.');
  return { x: x / length, y: y / length };
}

/** Index of the first point at or past distance `s` along the limb, or the last index. */
function firstAtOrAfter(points: readonly EdgePoint[], s: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at(points, mid).s < s) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** Offsets a limb's centerline to one side: 1 for the left edge, -1 for the right. */
function edge(limb: Limb, minRadius: number, side: 1 | -1): EdgePoint[] {
  const points: EdgePoint[] = [];
  for (const p of limb.points) {
    const tx = Math.cos(p.heading);
    const ty = Math.sin(p.heading);
    const r = Math.max(minRadius, limb.radiusAt(p.s)) * side;
    const candidate = { x: p.x - ty * r, y: p.y + tx * r, tx, ty, s: p.s };
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
function smoothThrough(path: Path2D, points: readonly Vec[]): void {
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = at(points, i);
    const next = at(points, i + 1);
    path.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
  }
  const last = at(points, points.length - 1);
  path.lineTo(last.x, last.y);
}
