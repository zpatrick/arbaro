import { barnAhead } from "./barn";
import type { Contact, Piece } from "./debris";
import type { Level } from "./level";
import { type Controls, LIMB, Limb, UPRIGHT } from "./limb";
import {
  type Failure,
  type Load,
  PHYSICS,
  type Strength,
  TreePhysics,
} from "./physics";
import { at, clamp, invariant, lerp, Rng, smoothstep } from "./util";
import type { Wind } from "./wind";

/**
 * The root flare where the trunk meets the ground. A sapling's, and a thick trunk's, is a small
 * fillet; a tall, slender trunk fans out, a little wider along the ground and higher up the trunk.
 */
const FLARE = {
  /** How far the flare reaches along the ground past the trunk, in base radii: fillet, then fan. */
  spread: { fillet: 1.5, fan: 2.2 },
  /** How high up the trunk the flare blends in, in base radii: fillet, then fan. */
  rise: { fillet: 2.6, fan: 5 },
  /** Heights of the tree, in meters, over which its flare turns from a fillet to a fan. */
  tall: { from: 5, to: 9 },
  /**
   * Slenderness of the trunk, its height over its radius at the ground, over which its flare turns
   * from a fillet to a fan. A trunk already thick for its height needs no more bulk at its foot.
   */
  slender: { from: 22, to: 32 },
  /** Highest up the trunk the flare reaches, as a fraction of the trunk's height. */
  highest: 0.3,
} as const;

/** One side of the root flare, in meters. */
export interface FlareSide {
  /** How far it reaches along the ground past the trunk. */
  spread: number;
  /** How high up the trunk it blends in. */
  rise: number;
}

/**
 * A new offshoot may start leaning this much past the free lean, or past its parent's own lean if
 * that leans further, so it always parts visibly from its parent.
 */
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
/**
 * Length the whole flow grows per second at a flow rate of one, in world units, shared out among
 * the tips. Unlike a held key it does not speed up as the tree grows, so a big tree grows slowly.
 */
const FLOW_GROWTH = 0.08;
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

/** A growing tip stops this far short of the ground or the barn, in world units. */
const CLEARANCE = 0.03;

/** Steer mode grows the selected limb while a key is held; flow mode grows every tip from the roots. */
export type GrowthMode = "steer" | "flow";

/** What a growing tip can run into. */
export type Obstacle = "ground" | "barn";

export interface Growth {
  mode: GrowthMode;
  /** Nutrients rising from the roots in flow mode, as a multiple of the usual flow. */
  flowRate: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  maxY: number;
}

/**
 * How far the tip of `limb` may grow on the way it heads before it comes within `CLEARANCE` of
 * `level`'s ground or its barn, and which of them it would meet first.
 */
function roomAhead(
  limb: Limb,
  level: Level,
): { room: number; obstacle: Obstacle } {
  const tip = limb.restTip;
  const ground = groundAhead(level, tip.x, tip.y, tip.heading);
  const barn = level.barn ? barnAhead(tip.x, tip.y, tip.heading) : Infinity;
  return {
    room: Math.max(0, Math.min(ground, barn) - CLEARANCE),
    obstacle: ground <= barn ? "ground" : "barn",
  };
}

/** How far ahead a growing tip looks for the ground, and in what steps, in meters. */
const LOOK_AHEAD = { most: 2, step: 0.05 } as const;

/**
 * How far a line from (x, y), heading `heading` radians counterclockwise from +x, runs before it
 * meets `level`'s ground: 0 from under it, and Infinity if it meets none within `LOOK_AHEAD`.
 */
function groundAhead(
  level: Level,
  x: number,
  y: number,
  heading: number,
): number {
  const dx = Math.cos(heading);
  const dy = Math.sin(heading);
  const above = (t: number): number => y + dy * t - level.groundAt(x + dx * t);
  if (above(0) <= 0) {
    return 0;
  }
  for (
    let t: number = LOOK_AHEAD.step;
    t <= LOOK_AHEAD.most;
    t += LOOK_AHEAD.step
  ) {
    if (above(t) <= 0) {
      let clear = t - LOOK_AHEAD.step;
      let under = t;
      for (let i = 0; i < 12; i += 1) {
        const mid = (clear + under) / 2;
        if (above(mid) > 0) {
          clear = mid;
        } else {
          under = mid;
        }
      }
      return clear;
    }
  }
  return Infinity;
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
  /** Where the tree grows, whose ground and barn its tips stop short of. */
  readonly level: Level;
  /** Per-side scale on the root flare, so no two trees meet the ground identically. */
  private readonly flareScale: { left: number; right: number };
  readonly root: Limb;
  /** Parents always come before their offshoots. */
  readonly limbs: Limb[];
  readonly physics = new TreePhysics();
  active: Limb;
  /** What the selected limb ran into as the player grew it, at the last update, if anything. */
  blocked: Obstacle | undefined;
  private readonly seed: number;

  constructor(baseX: number, seed: number, level: Level) {
    this.baseX = baseX;
    this.seed = seed;
    this.level = level;
    const rng = new Rng(seed);
    this.flareScale = {
      left: rng.range(0.85, 1.2),
      right: rng.range(0.85, 1.2),
    };
    this.root = new Limb(undefined, 0.3, seed);
    this.root.sprout(LIMB.sproutLength);
    this.limbs = [this.root];
    this.active = this.root;
    this.rebuild();
  }

  /**
   * Grows the tree, then lets the wind and gravity move it, with `loads` hung on it. Returns the
   * joints that gave way, outermost last.
   *
   * Steering a limb always steers the active one. In steer mode only the active limb grows, while
   * the up key is held. In flow mode nutrients rise from the roots, split at every spout, and grow
   * each tip as fast as its share of the flow allows.
   */
  update(
    dt: number,
    controls: Controls,
    wind: Wind,
    strength: Strength,
    growth: Growth,
    loads: readonly Load[],
  ): Failure[] {
    let changed = false;
    if (growth.mode === "steer") {
      for (const limb of this.limbs) {
        if (limb !== this.active) {
          limb.halt();
        }
      }
      const reach = this.reach(this.active);
      const size = Math.max(1, reach / LIMB.steadyLength);
      const speed = controls.grow ? LIMB.growSpeed * size : 0;
      const ahead = roomAhead(this.active, this.level);
      this.blocked = ahead.room < speed * dt ? ahead.obstacle : undefined;
      changed = this.active.update(
        dt,
        controls.steer,
        speed,
        size,
        Math.min(LIMB.maxReach - reach, ahead.room),
      );
    } else {
      this.blocked = undefined;
      const shares = this.flowShares();
      for (const limb of this.limbs) {
        const share = shares.get(limb);
        invariant(share !== undefined, "Every limb gets a share of the flow.");
        const reach = this.reach(limb);
        const size = Math.max(1, reach / LIMB.steadyLength);
        const speed = growth.flowRate * share * FLOW_GROWTH;
        const steer = limb === this.active ? controls.steer : 0;
        const moved = limb.update(
          dt,
          steer,
          speed,
          size,
          Math.min(LIMB.maxReach - reach, roomAhead(limb, this.level).room),
        );
        changed = changed || moved;
      }
    }
    if (changed) {
      this.rebuild();
    }
    wind.advance(dt, this.physics.motion);
    const failures = this.physics.step(dt, this.limbs, wind, strength, loads);
    this.pose();
    return failures;
  }

  /**
   * Share of the nutrient flow that reaches each limb's tip. The whole flow enters the trunk; at
   * every fork, the spout sends its share of what arrives into the offshoot and the rest carries
   * on up.
   */
  flowShares(): Map<Limb, number> {
    const shares = new Map<Limb, number>();
    const pass = (limb: Limb, arriving: number): void => {
      let remaining = arriving;
      const forks = [...limb.children].sort(
        (a, b) => forkedAt(a) - forkedAt(b),
      );
      for (const child of forks) {
        pass(child, remaining * child.spout);
        remaining *= 1 - child.spout;
      }
      shares.set(limb, remaining);
    };
    pass(this.root, 1);
    return shares;
  }

  /**
   * Where pruning or a break asked for at `s` along `limb` actually falls: at the base of an
   * offshoot when asked for inside its parent, no lower than a stump on the trunk, or nowhere if
   * almost nothing lies beyond it.
   */
  prunePoint(limb: Limb, s: number): number | undefined {
    let at = s;
    if (limb.attachment === undefined) {
      at = Math.max(s, STUMP);
    } else if (s <= limb.attachment.parent.radiusAt(limb.attachment.s)) {
      at = 0;
    }
    return at < limb.length - SMALLEST_CUT ? at : undefined;
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
      const flare = this.rootFlare();
      from = Math.max(flare.left.rise, flare.right.rise);
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

  /** Makes `limb` the one that steers, and in steer mode the one that grows. */
  select(limb: Limb): void {
    this.active = limb;
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
    const heading = limb.restPointAt(s).heading;
    const lean = Math.min(
      LIMB.maxLean,
      Math.max(LIMB.freeLean, Math.abs(heading - UPRIGHT)),
    );
    const limit = lean + FORK_LEAN_ALLOWANCE;
    return clamp(
      heading + side * LIMB.forkAngle,
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

  /**
   * The root flare on each side of the trunk, for a trunk `baseRadius` thick at the ground: a small
   * fillet, fanning out as a slender trunk grows tall.
   */
  rootFlare(baseRadius = this.root.radiusAt(0)): {
    left: FlareSide;
    right: FlareSide;
  } {
    const trunk = this.root;
    const height = trunk.restTip.y;
    const fan =
      smoothstep(FLARE.tall.from, FLARE.tall.to, height) *
      smoothstep(
        FLARE.slender.from,
        FLARE.slender.to,
        height / Math.max(baseRadius, 1e-6),
      );
    const spread =
      baseRadius * lerp(FLARE.spread.fillet, FLARE.spread.fan, fan);
    const rise = baseRadius * lerp(FLARE.rise.fillet, FLARE.rise.fan, fan);
    const highest = FLARE.highest * height;
    const side = (scale: number): FlareSide => ({
      spread: spread * scale,
      rise: Math.min(rise * scale, highest),
    });
    return {
      left: side(this.flareScale.left),
      right: side(this.flareScale.right),
    };
  }

  /** Extent of the tree as grown, so the camera holds still while it sways. */
  bounds(): Bounds {
    const baseRadius = this.root.radiusAt(0);
    const flare = this.rootFlare(baseRadius);
    let minX = this.baseX - baseRadius - flare.left.spread;
    let maxX = this.baseX + baseRadius + flare.right.spread;
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
