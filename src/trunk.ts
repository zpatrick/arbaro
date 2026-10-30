import { approach, at, clamp, Rng, valueNoise } from './util';

/** Heading of a vertical stem, in radians counterclockwise from +x with y pointing up. */
export const UPRIGHT = Math.PI / 2;

/** Arc length of each centerline segment. Short enough that the outline needs no extra smoothing. */
const SEGMENT_LENGTH = 0.08;

export const TRUNK = {
  /** Height of the sprout when the seed is planted. */
  sproutLength: 0.6,
  /** Growth speed in world units per second while the trunk is young. */
  growSpeed: 1.5,
  /**
   * Past this length the trunk works at a larger scale: it grows faster and turns more broadly
   * in proportion. The camera pulls back at the same rate, so growing and steering feel the same
   * on screen at every size.
   */
  steadyLength: 7,
  maxLength: 64,
  /** Sharpest turn the growing tip can make, in radians per world unit, before scaling. */
  maxCurvature: 0.8,
  /** Steering while the trunk is not growing only leans the soft tip this fraction of the way. */
  idleBend: 0.6,
  /** Young wood behind the tip that still bends, before scaling. Everything older is set. */
  softLength: 1.4,
  /** How quickly the soft tip bends toward the steering target. */
  bendRate: 4,
  /** Turn rate per radian of lean, before scaling, that rights the tip while it is not steered. */
  uprightPull: 0.12,
  /** Furthest the tip may lean from vertical. */
  maxLean: 1.0,
  /** Steering eases off over this many radians before the lean limit. */
  leanEase: 0.35,
  /**
   * Wood relaxes any bend tighter than this ratio of its radius to its bend radius. Thickening
   * old wood would otherwise fold the inside of a tight curve back on itself.
   */
  maxBendRatio: 0.6,
  /**
   * Curvature is averaged over this many radii on either side, so a bend in thick wood eases in
   * over a length comparable to its width instead of reading as a corner.
   */
  bendSmoothing: 2.5,
  /** Gentle meander, in radians per world unit before scaling, while the trunk grows unsteered. */
  wander: 0.07,
  /** Length of one meander, in world units before scaling. */
  wanderLength: 3,
  /** The first stretch always grows straight up so the trunk meets the ground squarely. */
  straightBase: 0.3,
  tipRadius: 0.01,
  taper: 0.046,
  taperExponent: 0.85,
  /** How far the root flare reaches along the ground past the trunk, in base radii. */
  flareSpread: 1.5,
  /** How high up the trunk the root flare blends in, in base radii. */
  flareRise: 2.6,
} as const;

export interface Controls {
  grow: boolean;
  /** -1 steers left, 1 steers right, 0 lets the tip drift back upright. */
  steer: number;
}

export interface TrunkPoint {
  x: number;
  y: number;
  /** Direction of growth in radians, counterclockwise from +x. */
  heading: number;
  /** Distance from the base along the centerline. */
  s: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  maxY: number;
}

interface Segment {
  length: number;
  /** Turn rate along the segment in radians per world unit. Positive turns left. */
  curvature: number;
}

export class Trunk {
  readonly baseX: number;
  /** Per-side scale on the root flare, so no two trees meet the ground identically. */
  readonly flare: { left: number; right: number };
  points: TrunkPoint[] = [];
  private readonly segments: Segment[] = [{ length: 0, curvature: 0 }];
  private readonly seed: number;
  private totalLength = 0;
  private speed = 0;
  private steering = 0;
  /** Progress through the meander, advanced in meanders grown rather than raw length. */
  private wanderPhase = 0;

  constructor(baseX: number, seed: number) {
    this.baseX = baseX;
    this.seed = seed;
    const rng = new Rng(seed);
    this.flare = { left: rng.range(0.85, 1.2), right: rng.range(0.85, 1.2) };
    this.extend(TRUNK.sproutLength);
    this.rebuild();
  }

  get length(): number {
    return this.totalLength;
  }

  get tip(): TrunkPoint {
    return at(this.points, this.points.length - 1);
  }

  /** Radius at distance `s` along the trunk. Wood further from the tip is older and thicker. */
  radiusAt(s: number): number {
    const fromTip = Math.max(0, this.totalLength - s);
    return TRUNK.tipRadius + TRUNK.taper * Math.pow(fromTip, TRUNK.taperExponent);
  }

  bounds(): Bounds {
    const baseRadius = this.radiusAt(0);
    let minX = this.baseX - baseRadius * (1 + TRUNK.flareSpread * this.flare.left);
    let maxX = this.baseX + baseRadius * (1 + TRUNK.flareSpread * this.flare.right);
    let maxY = 0;
    for (const p of this.points) {
      const r = this.radiusAt(p.s);
      minX = Math.min(minX, p.x - r);
      maxX = Math.max(maxX, p.x + r);
      maxY = Math.max(maxY, p.y + r);
    }
    return { minX, maxX, maxY };
  }

  update(dt: number, controls: Controls): void {
    const size = Math.max(1, this.totalLength / TRUNK.steadyLength);
    const canGrow = controls.grow && this.totalLength < TRUNK.maxLength;
    this.speed = approach(this.speed, canGrow ? TRUNK.growSpeed * size : 0, 0.2, dt);
    if (!canGrow && this.speed < 0.005) {
      this.speed = 0;
    }
    this.steering = approach(this.steering, controls.steer, 0.1, dt);
    if (controls.steer === 0 && Math.abs(this.steering) < 0.01) {
      this.steering = 0;
    }

    const grown = Math.min(this.speed * dt, TRUNK.maxLength - this.totalLength);
    if (grown > 0) {
      this.extend(grown);
      this.wanderPhase += grown / (TRUNK.wanderLength * size);
    }
    if (grown > 0 || this.steering !== 0) {
      this.bendTip(dt, grown > 0, size);
      this.rebuild();
    }
  }

  /** Bends the young wood near the tip toward the steering target, most strongly at the very tip. */
  private bendTip(dt: number, growing: boolean, size: number): void {
    const lean = this.tip.heading - UPRIGHT;
    let target: number;
    if (this.steering !== 0) {
      target = (-this.steering * TRUNK.maxCurvature * (growing ? 1 : TRUNK.idleBend)) / size;
      if (target * lean > 0) {
        target *= clamp((TRUNK.maxLean - Math.abs(lean)) / TRUNK.leanEase, 0, 1);
      }
    } else {
      const meander = TRUNK.wander * valueNoise(this.wanderPhase, this.seed);
      target = (meander - lean * TRUNK.uprightPull) / size;
    }

    const softLength = TRUNK.softLength * size;
    let fromTip = 0;
    for (let i = this.segments.length - 1; i >= 0; i -= 1) {
      const segment = at(this.segments, i);
      const softness = 1 - fromTip / softLength;
      const start = this.totalLength - fromTip - segment.length;
      if (softness <= 0 || start < TRUNK.straightBase) {
        break;
      }
      segment.curvature += (target - segment.curvature) * (1 - Math.exp(-TRUNK.bendRate * softness * dt));
      fromTip += segment.length;
    }
  }

  private extend(amount: number): void {
    let remaining = amount;
    while (remaining > 1e-12) {
      const last = at(this.segments, this.segments.length - 1);
      const room = SEGMENT_LENGTH - last.length;
      if (room <= 1e-12) {
        this.segments.push({ length: 0, curvature: last.curvature });
        continue;
      }
      const added = Math.min(room, remaining);
      last.length += added;
      remaining -= added;
    }
    this.totalLength += amount;
  }

  private rebuild(): void {
    const count = this.segments.length;
    // Running totals of turn and length, so any window's average curvature is two subtractions.
    const turns = [0];
    const lengths = [0];
    for (let i = 0; i < count; i += 1) {
      const segment = at(this.segments, i);
      turns.push(at(turns, i) + segment.curvature * segment.length);
      lengths.push(at(lengths, i) + segment.length);
    }
    const firstBendable = Math.ceil(TRUNK.straightBase / SEGMENT_LENGTH);

    let x = this.baseX;
    let y = 0;
    let heading = UPRIGHT;
    let s = 0;
    const points: TrunkPoint[] = [{ x, y, heading, s }];
    for (let i = 0; i < count; i += 1) {
      const segment = at(this.segments, i);
      if (segment.length <= 0) {
        continue;
      }
      let curvature = 0;
      if (i >= firstBendable) {
        const radius = this.radiusAt(s + segment.length / 2);
        const reach = Math.floor((TRUNK.bendSmoothing * radius) / SEGMENT_LENGTH);
        const lo = Math.max(firstBendable, i - reach);
        const hi = Math.min(count, i + reach + 1);
        const averaged = (at(turns, hi) - at(turns, lo)) / (at(lengths, hi) - at(lengths, lo));
        curvature = averaged / Math.max(1, (radius * Math.abs(averaged)) / TRUNK.maxBendRatio);
      }
      const turn = curvature * segment.length;
      const mid = heading + turn / 2;
      x += Math.cos(mid) * segment.length;
      y += Math.sin(mid) * segment.length;
      heading += turn;
      s += segment.length;
      points.push({ x, y, heading, s });
    }
    this.points = points;
  }
}
