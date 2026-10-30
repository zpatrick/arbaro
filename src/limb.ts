import { approach, at, clamp, invariant, lerp, smoothstep, valueNoise } from './util';

/** Heading of a vertical stem, in radians counterclockwise from +x with y pointing up. */
export const UPRIGHT = Math.PI / 2;

/** Arc length of each centerline segment. Short enough that the outline needs no extra smoothing. */
const SEGMENT_LENGTH = 0.08;

export const LIMB = {
  /** Height of the sprout when the seed is planted. */
  sproutLength: 0.6,
  /** Growth speed in world units per second while the tree is young. */
  growSpeed: 1.5,
  /**
   * Once a tip is further than this from the ground, measured along the wood, it works at a
   * larger scale: it grows faster and turns more broadly in proportion. The camera pulls back
   * at the same rate, so growing and steering feel the same on screen at every size.
   */
  steadyLength: 7,
  /** Furthest any tip can get from the ground, measured along the wood. */
  maxReach: 64,
  /** Sharpest turn a growing tip can make, in radians per world unit, before scaling. */
  maxCurvature: 0.8,
  /** Steering while a limb is not growing only leans its soft tip this fraction of the way. */
  idleBend: 0.6,
  /** Young wood behind the tip that still bends, before scaling. Everything older is set. */
  softLength: 1.4,
  /** How quickly the soft tip bends toward the steering target. */
  bendRate: 4,
  /** Turn rate per radian of lean, before scaling, that rights the tip while it is not steered. */
  uprightPull: 0.12,
  /** Furthest a tip may be steered from vertical. */
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
  /** Gentle meander, in radians per world unit before scaling, while a tip grows unsteered. */
  wander: 0.07,
  /** Length of one meander, in world units before scaling. */
  wanderLength: 3,
  tipRadius: 0.01,
  taper: 0.046,
  taperExponent: 0.85,
  /** Angle between a new offshoot and the limb it forks from. */
  forkAngle: 0.6,
  /** Above a fork, the parent sheds the offshoot's share of its cross-section over this many offshoot radii. */
  forkBlend: 4,
} as const;

export interface Controls {
  grow: boolean;
  /** -1 steers left, 1 steers right, 0 lets the tip drift back upright. */
  steer: number;
}

export interface LimbPoint {
  x: number;
  y: number;
  /** Direction of growth in radians, counterclockwise from +x. */
  heading: number;
  /** Distance from the limb's base along its centerline. */
  s: number;
}

export interface Attachment {
  parent: Limb;
  /** Distance along the parent where this limb forks off. */
  s: number;
  /** Heading relative to the parent's heading at the fork. Positive turns left. */
  angle: number;
}

interface Segment {
  length: number;
  /** Turn rate along the segment in radians per world unit. Positive turns left. */
  curvature: number;
}

/** Radius of an unforked limb at `fromTip` world units back from its tip. */
function ownRadius(fromTip: number): number {
  return LIMB.tipRadius + LIMB.taper * Math.pow(fromTip, LIMB.taperExponent);
}

/**
 * One stretch of wood from its base to a growing tip. The trunk and every offshoot are the same
 * kind of limb; the trunk just starts at the ground instead of on another limb.
 */
export class Limb {
  readonly attachment: Attachment | undefined;
  readonly children: Limb[] = [];
  /** Length at the base that never bends, so the limb leaves the ground or its parent cleanly. */
  readonly straightBase: number;
  /** Cross-section at the base, including everything forked off it. The tree refreshes this on every rebuild. */
  baseArea = 0;
  points: LimbPoint[] = [];
  private readonly segments: Segment[] = [{ length: 0, curvature: 0 }];
  private readonly seed: number;
  private grown = 0;
  private speed = 0;
  private steering = 0;
  /** Progress through the meander, advanced in meanders grown rather than raw length. */
  private wanderPhase = 0;

  constructor(attachment: Attachment | undefined, straightBase: number, seed: number) {
    this.attachment = attachment;
    this.straightBase = straightBase;
    this.seed = seed;
  }

  get length(): number {
    return this.grown;
  }

  get tip(): LimbPoint {
    return at(this.points, this.points.length - 1);
  }

  /** Lengthens the limb straight away, without easing. Used for the first sprout of a new limb. */
  sprout(length: number): void {
    this.extend(length);
  }

  /** Stops growing and steering at once, with no coasting. */
  halt(): void {
    this.speed = 0;
    this.steering = 0;
  }

  /** Radius at distance `s` along the limb. */
  radiusAt(s: number): number {
    return Math.sqrt(this.areaAt(s));
  }

  /**
   * Cross-section at distance `s` along the limb. Below a fork, the wood's cross-section is the
   * sum of the two limbs above it, as in a real tree.
   */
  areaAt(s: number): number {
    let area = ownRadius(Math.max(0, this.grown - s)) ** 2;
    for (const child of this.children) {
      area += child.baseArea * child.carriedAt(s);
    }
    return area;
  }

  /** Point on the centerline at distance `s`, interpolated between samples. */
  pointAt(s: number): LimbPoint {
    const points = this.points;
    let lo = 0;
    let hi = points.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (at(points, mid).s <= s) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    const a = at(points, lo);
    const b = at(points, hi);
    const t = clamp((s - a.s) / Math.max(b.s - a.s, 1e-9), 0, 1);
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), heading: lerp(a.heading, b.heading, t), s };
  }

  /**
   * Advances growth and steering. `size` scales speed and turning to the tree's current scale,
   * and `room` is how much further the tip may grow. Returns true if the shape changed.
   */
  update(dt: number, controls: Controls, size: number, room: number): boolean {
    const canGrow = controls.grow && room > 0;
    this.speed = approach(this.speed, canGrow ? LIMB.growSpeed * size : 0, 0.2, dt);
    if (!canGrow && this.speed < 0.005) {
      this.speed = 0;
    }
    this.steering = approach(this.steering, controls.steer, 0.1, dt);
    if (controls.steer === 0 && Math.abs(this.steering) < 0.01) {
      this.steering = 0;
    }

    const grown = Math.min(this.speed * dt, Math.max(0, room));
    if (grown > 0) {
      this.extend(grown);
      this.wanderPhase += grown / (LIMB.wanderLength * size);
    }
    if (grown > 0 || this.steering !== 0) {
      this.bendTip(dt, grown > 0, size);
      return true;
    }
    return false;
  }

  /** Recomputes the centerline from the limb's base point and starting heading. */
  rebuild(base: { x: number; y: number; heading: number }): void {
    const count = this.segments.length;
    // Running totals of turn and length, so any window's average curvature is two subtractions.
    const turns = [0];
    const lengths = [0];
    for (let i = 0; i < count; i += 1) {
      const segment = at(this.segments, i);
      turns.push(at(turns, i) + segment.curvature * segment.length);
      lengths.push(at(lengths, i) + segment.length);
    }
    const firstBendable = Math.ceil(this.straightBase / SEGMENT_LENGTH);

    let { x, y, heading } = base;
    let s = 0;
    const points: LimbPoint[] = [{ x, y, heading, s }];
    for (let i = 0; i < count; i += 1) {
      const segment = at(this.segments, i);
      if (segment.length <= 0) {
        continue;
      }
      let curvature = 0;
      if (i >= firstBendable) {
        const radius = this.radiusAt(s + segment.length / 2);
        const reach = Math.floor((LIMB.bendSmoothing * radius) / SEGMENT_LENGTH);
        const lo = Math.max(firstBendable, i - reach);
        const hi = Math.min(count, i + reach + 1);
        const averaged = (at(turns, hi) - at(turns, lo)) / (at(lengths, hi) - at(lengths, lo));
        curvature = averaged / Math.max(1, (radius * Math.abs(averaged)) / LIMB.maxBendRatio);
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

  /**
   * How much of this offshoot's cross-section its parent still carries at `parentS` along the
   * parent. The parent sheds it within the length it has left, so a fork near a tip leaves a
   * tapered point rather than a blunt stub.
   */
  private carriedAt(parentS: number): number {
    invariant(this.attachment !== undefined, 'Only an offshoot thickens a parent.');
    const { parent, s: fork } = this.attachment;
    if (parentS <= fork) {
      return 1;
    }
    const blend = Math.min(LIMB.forkBlend * Math.sqrt(this.baseArea), 0.6 * (parent.length - fork));
    return 1 - smoothstep(fork, fork + Math.max(blend, 1e-6), parentS);
  }

  /** Bends the young wood near the tip toward the steering target, most strongly at the very tip. */
  private bendTip(dt: number, growing: boolean, size: number): void {
    const lean = this.tip.heading - UPRIGHT;
    let target: number;
    if (this.steering !== 0) {
      target = (-this.steering * LIMB.maxCurvature * (growing ? 1 : LIMB.idleBend)) / size;
      if (target * lean > 0) {
        target *= clamp((LIMB.maxLean - Math.abs(lean)) / LIMB.leanEase, 0, 1);
      }
    } else {
      const meander = LIMB.wander * valueNoise(this.wanderPhase, this.seed);
      target = (meander - lean * LIMB.uprightPull) / size;
    }

    const softLength = LIMB.softLength * size;
    let fromTip = 0;
    for (let i = this.segments.length - 1; i >= 0; i -= 1) {
      const segment = at(this.segments, i);
      const softness = 1 - fromTip / softLength;
      const start = this.grown - fromTip - segment.length;
      if (softness <= 0 || start < this.straightBase) {
        break;
      }
      segment.curvature += (target - segment.curvature) * (1 - Math.exp(-LIMB.bendRate * softness * dt));
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
    this.grown += amount;
  }
}
