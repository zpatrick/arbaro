import { at, invariant } from '../util';

export interface TaperPoint {
  x: number;
  y: number;
  /** Half-width of the shape at this point. */
  w: number;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function resample(points: readonly TaperPoint[], per: number): TaperPoint[] {
  const n = points.length;
  const out: TaperPoint[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = at(points, Math.max(i - 1, 0));
    const p1 = at(points, i);
    const p2 = at(points, i + 1);
    const p3 = at(points, Math.min(i + 2, n - 1));
    for (let s = 0; s < per; s += 1) {
      const t = s / per;
      out.push({
        x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
        y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
        w: p1.w + (p2.w - p1.w) * t,
      });
    }
  }
  out.push(at(points, n - 1));
  return out;
}

/**
 * Outlines a tapering limb as a closed SVG path, so a drawn branch reads as two
 * converging lines rather than a stroke of even weight.
 */
export function taperedPath(points: readonly TaperPoint[], per = 6): string {
  invariant(points.length >= 2, 'A tapered path needs at least two points.');
  const samples = resample(points, per);
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    const s = at(samples, i);
    const before = at(samples, Math.max(i - 1, 0));
    const after = at(samples, Math.min(i + 1, samples.length - 1));
    let tx = after.x - before.x;
    let ty = after.y - before.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    left.push(`${(s.x - ty * s.w).toFixed(1)} ${(s.y + tx * s.w).toFixed(1)}`);
    right.push(`${(s.x + ty * s.w).toFixed(1)} ${(s.y - tx * s.w).toFixed(1)}`);
  }
  right.reverse();
  return `M${left.join(' L')} L${right.join(' L')} Z`;
}
