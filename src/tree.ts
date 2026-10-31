import type { Contact, Piece } from "./debris";
import { type Controls, LIMB, Limb, UPRIGHT } from "./limb";
import { type Failure, PHYSICS, type Strength, TreePhysics } from "./physics";
import { at, clamp, invariant, Rng } from "./util";
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
/** Shortest stump the trunk can be cut or broken down to, in world units. */
const STUMP = 0.3;
/** Shortest piece worth cutting off, in world units. */
const SMALLEST_CUT = 0.05;
/** Spacing of the points a falling piece lands on, in world units. */
const CONTACT_SPACING = 0.3;
/** Most points a falling piece lands on. Bigger pieces space them out. */
const MAX_CONTACTS = 90;
/** A piece rests on its stump if the wood at the cut points within 60 degrees of straight up. */
const HINGE_UPRIGHTNESS = Math.sin(Math.PI / 6);

export interface Bounds {
  minX: number;
  maxX: number;
  maxY: number;
}

/** Distance along its parent where an offshoot forks off. */
function forkedAt(offshoot: Limb): number {
  invariant(
    offshoot.attachment !== undefined,
    "Only an offshoot forks off a parent.",
  );
  return offshoot.attachment.s;
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
   * wind and gravity move the whole tree. Returns the joints that gave way, outermost last.
   */
  update(
    dt: number,
    controls: Controls,
    wind: Wind,
    strength: Strength,
  ): Failure[] {
    const reach = this.reach(this.active);
    const size = Math.max(1, reach / LIMB.steadyLength);
    if (this.active.update(dt, controls, size, LIMB.maxReach - reach)) {
      this.rebuild();
    }
    wind.advance(dt, this.physics.motion);
    const failures = this.physics.step(dt, this.limbs, wind, strength);
    this.pose();
    return failures;
  }

  /**
   * Where a cut asked for at `s` along `limb` actually falls: at the base of an offshoot cut inside
   * its parent, no lower than a stump on the trunk, or nowhere if almost nothing lies beyond it.
   */
  cutPoint(limb: Limb, s: number): number | undefined {
    let cut = s;
    if (limb.attachment === undefined) {
      cut = Math.max(s, STUMP);
    } else if (s <= limb.attachment.parent.radiusAt(limb.attachment.s)) {
      cut = 0;
    }
    return cut < limb.length - SMALLEST_CUT ? cut : undefined;
  }

  /** True if `limb` is still part of the tree. */
  has(limb: Limb): boolean {
    return this.limbs.includes(limb);
  }

  /**
   * Cuts `limb` at `s` and drops everything beyond: the rest of the limb and every offshoot forked
   * off past the cut. At `s` = 0 the whole offshoot goes. The wood left behind keeps its girth.
   */
  sever(limb: Limb, s: number): void {
    for (
      let held: Limb | undefined = limb;
      held !== undefined;
      held = held.attachment?.parent
    ) {
      held.holdGirth();
    }
    const gone: Limb[] = [];
    const collect = (dropped: Limb): void => {
      gone.push(dropped);
      dropped.children.forEach(collect);
    };
    let survivor = limb;
    if (s === 0) {
      invariant(
        limb.attachment !== undefined,
        "The trunk cannot be cut at the ground.",
      );
      survivor = limb.attachment.parent;
      survivor.removeChild(limb);
      collect(limb);
    } else {
      for (const child of limb.children.filter((c) => forkedAt(c) >= s)) {
        limb.removeChild(child);
        collect(child);
      }
      limb.truncate(s);
      this.physics.trim(limb);
    }
    for (const dropped of gone) {
      this.limbs.splice(this.limbs.indexOf(dropped), 1);
    }
    this.physics.forget(gone);
    if (gone.includes(this.active)) {
      this.active = survivor;
    }
    this.rebuild();
    this.pose();
  }

  /**
   * Mass, balance and landing points of everything beyond `s` on `limb`, as drawn right now. For
   * the trunk from the ground, that is the whole tree, which tips over on the base of its trunk.
   */
  piece(limb: Limb, s: number): Piece {
    let mass = 0;
    let mx = 0;
    let my = 0;
    let second = 0;
    let area = 0;
    const bounds = {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    };
    const weigh = (part: Limb, from: number): void => {
      const points = part.points;
      for (let i = 0; i + 1 < points.length; i += 1) {
        const a = at(points, i);
        const b = at(points, i + 1);
        if (b.s <= from) {
          continue;
        }
        const start = Math.max(a.s, from);
        const t = (start - a.s) / (b.s - a.s);
        const ax = a.x + (b.x - a.x) * t;
        const ay = a.y + (b.y - a.y) * t;
        const x = (ax + b.x) / 2;
        const y = (ay + b.y) / 2;
        const length = b.s - start;
        const r = part.radiusAt((start + b.s) / 2);
        const dm = PHYSICS.woodDensity * Math.PI * r * r * length;
        mass += dm;
        mx += dm * x;
        my += dm * y;
        second += dm * (x * x + y * y);
        area += 2 * r * length;
        bounds.minX = Math.min(bounds.minX, b.x - r);
        bounds.minY = Math.min(bounds.minY, b.y - r);
        bounds.maxX = Math.max(bounds.maxX, b.x + r);
        bounds.maxY = Math.max(bounds.maxY, b.y + r);
      }
      for (const child of part.children) {
        if (part !== limb || forkedAt(child) >= from) {
          weigh(child, 0);
        }
      }
    };
    weigh(limb, s);
    invariant(mass > 0, "A piece of the tree must have mass.");
    const center = { x: mx / mass, y: my / mass };
    const inertia = second - mass * (center.x * center.x + center.y * center.y);

    const contacts: Contact[] = [];
    let from = s;
    if (limb.attachment === undefined && s === 0) {
      // With its roots torn loose, the whole tree pivots on the base of its trunk. The root flare
      // tips up with it.
      contacts.push({ x: this.baseX, y: 0, r: 0 });
      from = FLARE.rise * limb.radiusAt(0);
    }
    // Every limb in the piece can land, spaced out so a big piece stays affordable.
    const parts: { part: Limb; start: number }[] = [];
    const gather = (part: Limb, start: number): void => {
      parts.push({ part, start });
      for (const child of part.children) {
        if (part !== limb || forkedAt(child) >= s) {
          gather(child, 0);
        }
      }
    };
    gather(limb, from);
    const wood = parts.reduce(
      (total, { part, start }) => total + Math.max(0, part.length - start),
      0,
    );
    const spacing = Math.max(CONTACT_SPACING, wood / MAX_CONTACTS);
    for (const { part, start } of parts) {
      for (let along = start; along < part.length; along += spacing) {
        const p = part.pointAt(along);
        contacts.push({ x: p.x, y: p.y, r: part.radiusAt(along) });
      }
      const tip = part.tip;
      contacts.push({ x: tip.x, y: tip.y, r: part.radiusAt(tip.s) });
    }
    // Wood pointing up at the cut sits on its stump, so it tips over on it before it falls.
    const cut = limb.pointAt(s);
    const hinge =
      s > 0 && Math.sin(cut.heading) > HINGE_UPRIGHTNESS
        ? { x: cut.x, y: cut.y }
        : undefined;
    return { mass, center, inertia, area, contacts, bounds, hinge };
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
        limb.pose(
          { x: this.baseX, y: 0, heading: UPRIGHT },
          bends,
          PHYSICS.jointSpacing,
        );
      } else {
        const fork = limb.attachment.parent.pointAt(limb.attachment.s);
        limb.pose(
          {
            x: fork.x,
            y: fork.y,
            heading: fork.heading + limb.attachment.angle,
          },
          bends,
          PHYSICS.jointSpacing,
        );
      }
    }
  }
}
