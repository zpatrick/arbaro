export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Invariant failed: ${message}`);
  }
}

/** Indexed read that throws instead of returning undefined. */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  invariant(item !== undefined, `Index ${index} out of range (length ${items.length}).`);
  return item;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Wraps an angle into the range [-PI, PI]. */
export function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export interface Vec2 {
  x: number;
  y: number;
}

/** Distance from a point to a line segment. */
export function distPointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  let t = 0;
  if (lenSq > 1e-12) {
    t = clamp(((px - ax) * abx + (py - ay) * aby) / lenSq, 0, 1);
  }
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
}

/** Small deterministic random number generator (mulberry32). */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}

/** Smooth 1D value noise in the range [0, 1]. */
export function valueNoise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const hash = (n: number): number => {
    const s = Math.sin((n + seed * 131.7) * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i), hash(i + 1), u);
}
