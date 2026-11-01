import {
  approach,
  at,
  clamp,
  invariant,
  lerp,
  smoothstep,
  valueNoise,
} from "./util";

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
  /**
   * Steering turns a tip freely until it leans this far from vertical, easing off over `leanEase`
   * before it. Past it a tip still turns, at `slowSteer` of the usual rate, out to `maxLean`.
   */
  freeLean: 1.0,
  /** Past the free lean, steering turns a tip at this fraction of the usual rate. */
  slowSteer: 0.25,
  /** Furthest a tip may be steered from vertical: a little past level, so a limb can droop. */
  maxLean: 1.75,
  /** Steering eases off over this many radians before each lean limit. */
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
  /**
   * An unforked limb is `tipRadius` thick at its tip and thickens by `taper` times its distance
   * from the tip to the power `taperExponent`: as real trees do, a twig a meter from its tip is a
   * couple of centimeters across, and the wood thickens ever faster toward the trunk.
   */
  tipRadius: 0.004,
  taper: 0.007,
  taperExponent: 1.5,
  /** Angle between a new offshoot and the limb it forks from. */
  forkAngle: 0.6,
  /**
   * New growth out of a cut end narrows from the old wood's girth to its own over this many of
   * the old wood's radii.
   */
  regrowthNeck: 2.5,
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

/** Where a centerline starts and the direction it sets off in. */
export interface Base {
  x: number;
  y: number;
  heading: number;
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

/** Point at distance `s` along a centerline, interpolated between samples. */
function interpolate(points: readonly LimbPoint[], s: number): LimbPoint {
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
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    heading: lerp(a.heading, b.heading, t),
    s,
  };
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
  /**
   * For an offshoot, the share of the nutrient flow reaching its fork that the spout there sends
   * into it, from 0 to 1. The rest carries on along the limb it grows from.
   */
  spout = 0.5;
  /** Centerline as grown, before wind or weight moves it. Growth and the camera work from this. */
  restPoints: LimbPoint[] = [];
  /** Centerline as drawn. The same array as `restPoints` whenever the limb is at rest. */
  points: LimbPoint[] = [];
  private readonly segments: Segment[] = [{ length: 0, curvature: 0 }];
  /** Turn across each segment of the grown curve, after smoothing and relaxation. */
  private restTurns: number[] = [];
  /**
   * Cross-section the wood had at each multiple of the segment length when the limb last lost
   * wood. Wood never shrinks when the load on it drops, so a cut or broken limb keeps its girth.
   * Empty for a limb that has only ever grown.
   */
  private readonly girth: number[] = [];
  private readonly seed: number;
  private grown = 0;
  private speed = 0;
  private steering = 0;
  /** Progress through the meander, advanced in meanders grown rather than raw length. */
  private wanderPhase = 0;

  constructor(
    attachment: Attachment | undefined,
    straightBase: number,
    seed: number,
  ) {
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

  get restTip(): LimbPoint {
    return at(this.restPoints, this.restPoints.length - 1);
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
   * Cross-section at distance `s` along the limb: as thick as what the wood carries, or as thick
   * as it has ever grown there, whichever is more.
   */
  areaAt(s: number): number {
    return Math.max(this.loadAt(s), this.grownAt(s));
  }

  /**
   * Remembers how thick the wood is everywhere along the limb, so it keeps that girth when it is
   * about to lose some of what it carries.
   */
  holdGirth(): void {
    for (let i = 0; i * SEGMENT_LENGTH <= this.grown; i += 1) {
      const area = this.areaAt(i * SEGMENT_LENGTH);
      if (i < this.girth.length) {
        this.girth[i] = Math.max(at(this.girth, i), area);
      } else {
        this.girth.push(area);
      }
    }
  }

  /**
   * Cuts the limb back to `s`. The wood that stays keeps its girth, so the cut end is as thick as
   * the wood was there. Offshoots past the cut must already have been removed, after the limb
   * held its girth.
   */
  truncate(s: number): void {
    invariant(
      s > 0 && s < this.grown,
      `Cannot cut a limb of length ${this.grown} at ${s}.`,
    );
    invariant(
      this.children.every(
        (child) => child.attachment !== undefined && child.attachment.s < s,
      ),
      "Offshoots past a cut must be removed before the cut.",
    );
    this.holdGirth();
    const atCut = this.areaAt(s);
    let remaining = s;
    let kept = 0;
    for (const segment of this.segments) {
      if (remaining <= 1e-12) {
        break;
      }
      segment.length = Math.min(segment.length, remaining);
      remaining -= segment.length;
      kept += 1;
    }
    this.segments.length = kept;
    // Hold the girth at the cut out to the next sample, so the cut end keeps its full thickness.
    const last = Math.floor(s / SEGMENT_LENGTH) + 1;
    this.girth.length = Math.min(this.girth.length, last);
    this.girth[last] = atCut;
    this.grown = s;
    this.halt();
  }

  /** Detaches an offshoot from this limb. */
  removeChild(child: Limb): void {
    const index = this.children.indexOf(child);
    invariant(
      index >= 0,
      "Cannot remove an offshoot that does not grow from this limb.",
    );
    this.children.splice(index, 1);
  }

  /** Point on the drawn centerline at distance `s`, interpolated between samples. */
  pointAt(s: number): LimbPoint {
    return interpolate(this.points, s);
  }

  /** Point on the grown centerline at distance `s`, interpolated between samples. */
  restPointAt(s: number): LimbPoint {
    return interpolate(this.restPoints, s);
  }

  /**
   * Advances growth and steering. `steer` is -1 for left, 1 for right and 0 to let the tip drift
   * back upright. The tip eases toward growing at `speed`. `size` scales turning to the tree's
   * current scale, and `room` is how much further the tip may grow. Returns true if the shape
   * changed.
   */
  update(
    dt: number,
    steer: number,
    speed: number,
    size: number,
    room: number,
  ): boolean {
    const canGrow = speed > 0 && room > 0;
    this.speed = approach(this.speed, canGrow ? speed : 0, 0.2, dt);
    if (!canGrow && this.speed < 0.005) {
      this.speed = 0;
    }
    this.steering = approach(this.steering, steer, 0.1, dt);
    if (steer === 0 && Math.abs(this.steering) < 0.01) {
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

  /**
   * Recomputes the grown centerline from the limb's base point and starting heading, and resets
   * the drawn centerline to match it.
   */
  rebuild(base: Base): void {
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

    const restTurns: number[] = [];
    let s = 0;
    for (let i = 0; i < count; i += 1) {
      const segment = at(this.segments, i);
      let curvature = 0;
      if (segment.length > 0 && i >= firstBendable) {
        const radius = this.radiusAt(s + segment.length / 2);
        const reach = Math.floor(
          (LIMB.bendSmoothing * radius) / SEGMENT_LENGTH,
        );
        const lo = Math.max(firstBendable, i - reach);
        const hi = Math.min(count, i + reach + 1);
        const averaged =
          (at(turns, hi) - at(turns, lo)) / (at(lengths, hi) - at(lengths, lo));
        curvature =
          averaged /
          Math.max(1, (radius * Math.abs(averaged)) / LIMB.maxBendRatio);
      }
      restTurns.push(curvature * segment.length);
      s += segment.length;
    }
    this.restTurns = restTurns;
    this.restPoints = this.trace(base, restTurns);
    this.points = this.restPoints;
  }

  /**
   * Recomputes the drawn centerline from `base`, adding `bends[k]` radians of turn around the
   * joint `k * spacing` along the limb. Each bend is spread smoothly over a joint spacing either
   * side of its joint, so a swaying limb stays one smooth curve.
   */
  pose(
    base: Base,
    bends: readonly number[] | undefined,
    spacing: number,
  ): void {
    const rest = at(this.restPoints, 0);
    if (
      bends === undefined &&
      base.x === rest.x &&
      base.y === rest.y &&
      base.heading === rest.heading
    ) {
      this.points = this.restPoints;
      return;
    }
    const turns = [...this.restTurns];
    if (bends !== undefined) {
      // Cumulative weight of a joint's bend from `spacing` before it up to `offset` past it, out
      // of a total of `spacing`. The weights of neighboring joints add up to an even spread.
      const spread = (offset: number): number => {
        const x = clamp(offset, -spacing, spacing);
        return (
          (x + spacing) / 2 +
          (spacing * Math.sin((Math.PI * x) / spacing)) / (2 * Math.PI)
        );
      };
      for (let k = 0; k < bends.length; k += 1) {
        const bend = at(bends, k);
        const joint = k * spacing;
        if (bend === 0 || joint > this.grown) {
          continue;
        }
        const share = bend / (spread(this.grown - joint) - spread(-joint));
        const first = Math.max(
          0,
          Math.floor((joint - spacing) / SEGMENT_LENGTH),
        );
        const last = Math.min(
          this.segments.length - 1,
          Math.floor((joint + spacing) / SEGMENT_LENGTH),
        );
        for (let i = first; i <= last; i += 1) {
          const start = i * SEGMENT_LENGTH;
          const end = start + at(this.segments, i).length;
          turns[i] =
            at(turns, i) +
            share * (spread(end - joint) - spread(start - joint));
        }
      }
    }
    this.points = this.trace(base, turns);
  }

  /**
   * How much of this offshoot's cross-section its parent still carries at `parentS` along the
   * parent. The parent sheds it within the length it has left, so a fork near a tip leaves a
   * tapered point rather than a blunt stub.
   */
  private carriedAt(parentS: number): number {
    invariant(
      this.attachment !== undefined,
      "Only an offshoot thickens a parent.",
    );
    const { parent, s: fork } = this.attachment;
    if (parentS <= fork) {
      return 1;
    }
    const blend = Math.min(
      LIMB.forkBlend * Math.sqrt(this.baseArea),
      0.6 * (parent.length - fork),
    );
    return 1 - smoothstep(fork, fork + Math.max(blend, 1e-6), parentS);
  }

  /**
   * Cross-section the load on the wood calls for: the rest of this limb plus every offshoot
   * forked off above `s`. Below a fork, it is the sum of the two limbs above it, as in a real tree.
   */
  private loadAt(s: number): number {
    let area = ownRadius(Math.max(0, this.grown - s)) ** 2;
    for (const child of this.children) {
      area += child.baseArea * child.carriedAt(s);
    }
    return area;
  }

  /** Cross-section the wood has grown to at `s`, which it keeps even if its load drops. */
  private grownAt(s: number): number {
    const samples = this.girth.length;
    if (samples === 0) {
      return 0;
    }
    const position = s / SEGMENT_LENGTH;
    const i = Math.floor(position);
    if (i + 1 < samples) {
      return lerp(at(this.girth, i), at(this.girth, i + 1), position - i);
    }
    // New wood past the old growth narrows smoothly from the old girth to its own.
    const end = (samples - 1) * SEGMENT_LENGTH;
    const area = at(this.girth, samples - 1);
    return (
      area * (1 - smoothstep(end, end + LIMB.regrowthNeck * Math.sqrt(area), s))
    );
  }

  /** Lays out a centerline from `base` by turning `turns[i]` across each segment. */
  private trace(base: Base, turns: readonly number[]): LimbPoint[] {
    let { x, y, heading } = base;
    let s = 0;
    const points: LimbPoint[] = [{ x, y, heading, s }];
    for (let i = 0; i < this.segments.length; i += 1) {
      const segment = at(this.segments, i);
      if (segment.length <= 0) {
        continue;
      }
      const turn = at(turns, i);
      const mid = heading + turn / 2;
      x += Math.cos(mid) * segment.length;
      y += Math.sin(mid) * segment.length;
      heading += turn;
      s += segment.length;
      points.push({ x, y, heading, s });
    }
    return points;
  }

  /** Bends the young wood near the tip toward the steering target, most strongly at the very tip. */
  private bendTip(dt: number, growing: boolean, size: number): void {
    const lean = this.restTip.heading - UPRIGHT;
    let target: number;
    if (this.steering !== 0) {
      target =
        (-this.steering * LIMB.maxCurvature * (growing ? 1 : LIMB.idleBend)) /
        size;
      if (target * lean > 0) {
        const free = clamp(
          (LIMB.freeLean - Math.abs(lean)) / LIMB.leanEase,
          0,
          1,
        );
        const slow =
          LIMB.slowSteer *
          clamp((LIMB.maxLean - Math.abs(lean)) / LIMB.leanEase, 0, 1);
        target *= Math.max(free, slow);
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
      segment.curvature +=
        (target - segment.curvature) *
        (1 - Math.exp(-LIMB.bendRate * softness * dt));
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
