/**
 * Helpers for drawing ink silhouettes out of overlapping parts. Every part winds counterclockwise
 * in world space, as the tree's ink does, so parts that overlap fill solid rather than cancel.
 */

export interface Point {
  x: number;
  y: number;
}

/** Adds the polygon through `points` to `path`, wound counterclockwise. */
export function addPolygon(path: Path2D, points: readonly Point[]): void {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) {
      throw new Error("A polygon's points ran out.");
    }
    area += a.x * b.y - b.x * a.y;
  }
  const ordered = area >= 0 ? points : [...points].reverse();
  ordered.forEach((p, i) => {
    if (i === 0) {
      path.moveTo(p.x, p.y);
    } else {
      path.lineTo(p.x, p.y);
    }
  });
  path.closePath();
}

/** Adds a circle about `center`, `radius` across, to `path`. */
export function addCircle(path: Path2D, center: Point, radius: number): void {
  path.moveTo(center.x + radius, center.y);
  path.arc(center.x, center.y, radius, 0, Math.PI * 2);
}

/** Adds an ellipse about `center`, turned `angle` radians, to `path`. */
export function addEllipse(
  path: Path2D,
  center: Point,
  rx: number,
  ry: number,
  angle: number,
): void {
  path.moveTo(center.x + rx * Math.cos(angle), center.y + rx * Math.sin(angle));
  path.ellipse(center.x, center.y, rx, ry, angle, 0, Math.PI * 2);
}

/**
 * Adds a limb-like capsule from `a` to `b` to `path`, `ra` thick at `a` and `rb` at `b`, rounded
 * at both ends.
 */
export function addCapsule(
  path: Path2D,
  a: Point,
  b: Point,
  ra: number,
  rb: number,
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  addPolygon(path, [
    { x: a.x + nx * ra, y: a.y + ny * ra },
    { x: b.x + nx * rb, y: b.y + ny * rb },
    { x: b.x - nx * rb, y: b.y - ny * rb },
    { x: a.x - nx * ra, y: a.y - ny * ra },
  ]);
  addCircle(path, a, ra);
  addCircle(path, b, rb);
}

/** Points along the quadratic curve from `from` through control `via` to `to`. */
export function curve(from: Point, via: Point, to: Point, steps = 8): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    points.push({
      x: a * from.x + b * via.x + c * to.x,
      y: a * from.y + b * via.y + c * to.y,
    });
  }
  return points;
}
