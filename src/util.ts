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

/**
 * Eases `current` toward `target` with time constant `tau` seconds. Frame-rate independent,
 * so the motion feels the same at 30 and 120 fps.
 */
export function approach(current: number, target: number, tau: number, dt: number): number {
  return target + (current - target) * Math.exp(-dt / tau);
}

/** Smooth 1D value noise in the range [-1, 1]. */
export function valueNoise(x: number, seed: number): number {
  const hash = (n: number): number => {
    const h = Math.sin((n + seed * 131.7) * 127.1) * 43758.5453;
    return h - Math.floor(h);
  };
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i), hash(i + 1), u) * 2 - 1;
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
}
