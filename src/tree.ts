import { type Controls, LIMB, Limb, UPRIGHT } from "./limb";
import { PHYSICS, TreePhysics } from "./physics";
import { at, clamp, Rng } from "./util";
import type { Wind } from "./wind";

export const FLARE = {
  /** How far the root flare reaches along the ground past the trunk, in base radii. */
  spread: 1.5,
  /** How high up the trunk the root flare blends in, in base radii. */
  rise: 2.6,
} as const;

/** A new offshoot may start leaning past the steering limit, so it always parts visibly from its parent. */
const FORK_LEAN_ALLOWANCE = 0.35;
/**
 * Forks this close to a tip, before scaling, move to the tip itself. There the parent's rounded
 * tip matches the offshoot's width and reads as a smooth elbow, where a fork just short of the
 * tip would leave a thorn.
 */
const TIP_SNAP = 0.6;
/** A new offshoot grows straight for this many of its parent's radii, so it clears the parent before it bends. */
const FORK_STRAIGHT = 1.2;
/** A new offshoot starts out this many parent radii long, plus a short stem before scaling, so it shows at once. */
const FORK_SPROUT = { radii: 1.6, stem: 0.15 } as const;

export interface Bounds {
  minX: number;
  maxX: number;
  maxY: number;
}

/** Where a pointer lands on the tree. */
export interface Pick {
  limb: Limb;
  /** Distance along the limb to the nearest centerline point. */
  s: number;
  /** The side of the limb the pointer is on: 1 for left, -1 for right. */
  side: 1 | -1;
}

/** Every limb grown from one seed, and which of them is currently being grown and steered. */
export class Tree {
  readonly baseX: number;
  /** Per-side scale on the root flare, so no two trees meet the ground identically. */
  readonly flare: { left: number; right: number };
  readonly root: Limb;
  /** Parents always come before their offshoots. */
  readonly limbs: Limb[];
  readonly physics = new TreePhysics();
  active: Limb;
  private readonly seed: number;

  constructor(baseX: number, seed: number) {
    this.baseX = baseX;
    this.seed = seed;
    const rng = new Rng(seed);
    this.flare = { left: rng.range(0.85, 1.2), right: rng.range(0.85, 1.2) };
    this.root = new Limb(undefined, 0.3, seed);
    this.root.sprout(LIMB.sproutLength);
    this.limbs = [this.root];
    this.active = this.root;
    this.rebuild();
  }

  /**
   * Grows and steers the active limb while every other limb holds its grown shape, then lets the
   * wind and gravity move the whole tree.
   */
  update(dt: number, controls: Controls, wind: Wind): void {
    const reach = this.reach(this.active);
    const size = Math.max(1, reach / LIMB.steadyLength);
    if (this.active.update(dt, controls, size, LIMB.maxReach - reach)) {
      this.rebuild();
    }
    wind.advance(dt, this.physics.motion);
    this.physics.step(dt, this.limbs, wind);
    this.pose();
  }

  /** Makes `limb` the one that grows and steers. The previous one stops where it is. */
  select(limb: Limb): void {
    if (limb !== this.active) {
      this.active.halt();
      this.active = limb;
    }
  }

  /** Starts a new offshoot at distance `s` along `parent` and makes it the active limb. */
  fork(parent: Limb, s: number, side: 1 | -1): Limb {
    const forkS = this.forkPoint(parent, s);
    const parentHeading = parent.restPointAt(forkS).heading;
    const heading = this.forkHeading(parent, forkS, side);
    const parentRadius = parent.radiusAt(forkS);
    const size = Math.max(
      1,
      (this.reach(parent) - parent.length + forkS) / LIMB.steadyLength,
    );
    const child = new Limb(
      { parent, s: forkS, angle: heading - parentHeading },
      parentRadius * FORK_STRAIGHT,
      this.seed * 31 + this.limbs.length,
    );
    child.sprout(parentRadius * FORK_SPROUT.radii + FORK_SPROUT.stem * size);
    parent.children.push(child);
    this.limbs.push(child);
    this.select(child);
    this.rebuild();
    return child;
  }

  /** Where along `limb` a fork requested at `s` actually starts. */
  forkPoint(limb: Limb, s: number): number {
    const size = Math.max(1, this.reach(limb) / LIMB.steadyLength);
    if (limb.length - s < TIP_SNAP * size) {
      return limb.length;
    }
    return Math.max(s, limb.straightBase);
  }

  /** Starting heading, in the grown shape, of an offshoot forked from `limb` at `s` toward `side`. */
  forkHeading(limb: Limb, s: number, side: 1 | -1): number {
    const limit = LIMB.maxLean + FORK_LEAN_ALLOWANCE;
    return clamp(
      limb.restPointAt(s).heading + side * LIMB.forkAngle,
      UPRIGHT - limit,
      UPRIGHT + limit,
    );
  }

  /** Distance from the ground to the limb's tip, measured along the wood. */
  reach(limb: Limb): number {
    let distance = limb.length;
    for (
      let attachment = limb.attachment;
      attachment !== undefined;
      attachment = attachment.parent.attachment
    ) {
      distance += attachment.s;
    }
    return distance;
  }

  /** Extent of the tree as grown, so the camera holds still while it sways. */
  bounds(): Bounds {
    const baseRadius = this.root.radiusAt(0);
    let minX = this.baseX - baseRadius * (1 + FLARE.spread * this.flare.left);
    let maxX = this.baseX + baseRadius * (1 + FLARE.spread * this.flare.right);
    let maxY = 0;
    for (const limb of this.limbs) {
      for (const p of limb.restPoints) {
        const r = limb.radiusAt(p.s);
        minX = Math.min(minX, p.x - r);
        maxX = Math.max(maxX, p.x + r);
        maxY = Math.max(maxY, p.y + r);
      }
    }
    return { minX, maxX, maxY };
  }

  /**
   * Finds the limb whose centerline passes closest to (x, y), if the point is on that limb or
   * within `tolerance` of its edge.
   */
  pick(x: number, y: number, tolerance: number): Pick | undefined {
    let best: (Pick & { distance: number }) | undefined;
    for (const limb of this.limbs) {
      const points = limb.points;
      for (let i = 0; i + 1 < points.length; i += 1) {
        const a = at(points, i);
        const b = at(points, i + 1);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSq = dx * dx + dy * dy;
        const t =
          lengthSq > 0
            ? clamp(((x - a.x) * dx + (y - a.y) * dy) / lengthSq, 0, 1)
            : 0;
        const px = a.x + dx * t;
        const py = a.y + dy * t;
        const distance = Math.hypot(x - px, y - py);
        if (best !== undefined && distance >= best.distance) {
          continue;
        }
        const s = a.s + (b.s - a.s) * t;
        if (distance > limb.radiusAt(s) + tolerance) {
          continue;
        }
        best = {
          limb,
          s,
          side: dx * (y - py) - dy * (x - px) >= 0 ? 1 : -1,
          distance,
        };
      }
    }
    return best === undefined
      ? undefined
      : { limb: best.limb, s: best.s, side: best.side };
  }

  private rebuild(): void {
    // Offshoots come after their parents, so a reverse pass sizes every offshoot before the
    // limb it thickens.
    for (let i = this.limbs.length - 1; i >= 0; i -= 1) {
      const limb = at(this.limbs, i);
      limb.baseArea = limb.areaAt(0);
    }
    for (const limb of this.limbs) {
      if (limb.attachment === undefined) {
        limb.rebuild({ x: this.baseX, y: 0, heading: UPRIGHT });
      } else {
        const fork = limb.attachment.parent.restPointAt(limb.attachment.s);
        limb.rebuild({
          x: fork.x,
          y: fork.y,
          heading: fork.heading + limb.attachment.angle,
        });
      }
    }
    this.physics.invalidate();
  }

  /** Lays out every drawn centerline from the grown shape plus however far the physics bent it. */
  private pose(): void {
    for (const limb of this.limbs) {
      const bends = this.physics.bends(limb);
      if (limb.attachment === undefined) {
        limb.pose({ x: this.baseX, y: 0, heading: UPRIGHT }, bends, PHYSICS.jointSpacing);
      } else {
        const fork = limb.attachment.parent.pointAt(limb.attachment.s);
        limb.pose(
          { x: fork.x, y: fork.y, heading: fork.heading + limb.attachment.angle },
          bends,
          PHYSICS.jointSpacing,
        );
      }
    }
  }
}
