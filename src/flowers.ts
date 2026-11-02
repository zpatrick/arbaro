import { type Limb, UPRIGHT } from "./limb";
import { PHYSICS } from "./physics";
import type { Pick, Tree } from "./tree";
import {
  approach,
  at,
  clamp,
  invariant,
  lerp,
  Rng,
  smoothstep,
  valueNoise,
  wrapAngle,
} from "./util";
import type { Vec, Wind } from "./wind";

/** Who decides where flowers grow: the player, by hand, or the tree itself. */
export type FlowerPlacement = "hand" | "tree";

export interface FlowerSettings {
  placement: FlowerPlacement;
  /** Multiplier on the size of every flower. */
  size: number;
}

/** What the flowers live through. */
export interface Conditions {
  /** Time of year, from midsummer at 0 to winter at 1. Flowers turn, wilt and drop as it passes. */
  season: number;
  wind: Wind;
  /** Multiplier on how hard flower stems hold. */
  hold: number;
  /** Whether the tree grows in flow mode, where better-fed limbs grow stronger stems. */
  flowing: boolean;
}

/**
 * Every flower is a cluster of cherry blossoms. Clusters grow close together and back along the
 * wood, so a grown tree fills out into a canopy.
 */
export const FLOWERS = {
  /**
   * Size of a cluster at a size multiplier of one, in world units: true to life, so a cluster is
   * about 17 cm across, of blossoms 4 cm across.
   */
  size: 0.14,
  /** A flower placed this close to its limb's tip, in world units, crowns the tip instead. */
  tipReach: 0.2,
  /** A limb flowers once it is this long, in world units, when the tree places the flowers. */
  firstBloom: 1.2,
  /**
   * The tree grows each flower on the side of a limb up to this fraction of their spacing nearer
   * the tip than its place in the row, so they never line up exactly.
   */
  jitter: 0.4,
  /**
   * A flower that rides up its limb to nearer than this many times its spacing behind the next
   * flower along the same side shrinks away, so flowers riding up never bunch. The tree grows its
   * own about twice their spacing apart along each side.
   */
  crowded: 1.5,
  /**
   * Length of a mound's twig beyond the wood, as a multiple of the mound's size, from the shortest
   * to the longest: the twig's end, the mound's middle, lies within about the mound's own reach of
   * its limb for most mounds, so they wrap it.
   */
  moundTwig: { from: 0.14, to: 0.72 },
  /** The tree keeps its flowers this far from where a limb starts, in world units. */
  clearOfBase: 0.5,
  /** Seconds the tree takes to grow back a flower it lost to the wind. */
  regrow: 20,
  /** Seconds for a flower to grow in, or to shrink away. */
  growIn: 0.9,
  /** Seconds a flower takes to unfold as it grows in, before each flower's own variation. */
  opening: 1.8,
  /** Area a fully open flower shows the wind, as a fraction of its size squared. */
  area: 0.6,
  /** Area a closed bud shows the wind, as a fraction of what it shows open. */
  budArea: 0.35,
  /** Drag coefficient of a flower. */
  drag: 1.2,
  /**
   * Pull the stem of a flower of the usual size holds against, in newtons. At normal strength a
   * typical open flower starts to tear loose in a storm, at about 24 m/s.
   */
  hold: 4.9,
  /**
   * A larger flower grows a stouter stem, so its hold grows with its size to this power: a little
   * slower than the pull of the wind, which grows with its area. A flower twice the size holds
   * 2.8 times as hard against 4 times the pull and starts to go at about 20 m/s; one half the size
   * holds out until about 28 m/s.
   */
  holdGrowth: 1.5,
  /**
   * How much stems differ: each flower's hold is the usual times e to this many standard normal
   * deviations, so most are within a third of it either way and a few are much weaker or stronger.
   */
  holdSpread: 0.35,
  /**
   * In flow mode a stem holds harder the better its limb is fed: as the square root of the share
   * of the flow its limb gets against an even share, between these limits.
   */
  fed: { min: 0.6, max: 1.5 },
  /** Damage per second while a stem is pulled exactly at its limit. It lets go at 1. */
  damageAtLimit: 0.3,
  /** Extra damage per second for each multiple of its limit a stem is pulled past it. */
  damagePerOverload: 2,
  /** Damage healed per second while a stem is under its limit. */
  healing: 0.3,
  /** In autumn a stem's hold weakens to this fraction by the time its flower drops on its own. */
  autumnHold: 0.3,
  /** A flower drops on its own somewhere in this span of the year. */
  drops: { from: 0.86, to: 0.97 },
  /** Most a flower leans downwind before it tears loose, in radians. */
  windLean: 0.35,
  /** How far flowers flutter in a strong wind, in radians. */
  flutter: 0.18,
} as const;

/**
 * How open to the sky a flower is: the flowers above it, up to `depth` times its size higher and
 * within `width` times its size to either side, shade it, those straight above the most. Shaded
 * by `cover` of them its exposure falls to 1/e, and it follows the canopy over `settle` seconds.
 */
const EXPOSURE = { width: 1.5, depth: 6, cover: 5, settle: 1 } as const;

/**
 * How a flower's stalk grows from the side of a limb. It leaves the wood leaning `lean` of the way
 * from square toward the limb's tip, as a side shoot does, and bends evenly from there to the way
 * the flower faces, by at most `bend` radians, so it never hooks. It starts `inset` of the way
 * out from the middle of the wood, so it grows out of the wood however it leans.
 */
const STALK = { lean: 0.3, bend: 1.1, inset: 0.4 } as const;

/**
 * How the clusters grow. They crowd each other and grow on wood up to 7 cm across, so a grown tree
 * carries pads of them back along each limb, not just at its tips. As the size multiplier rises
 * past one, each grows into a mound of clusters of their true size, rather than growing larger
 * itself.
 */
const HABIT = {
  /** Length of a cluster's stalk beyond the wood, as a fraction of its size. */
  stalk: 0.08,
  /**
   * Most extra length the stalk of one on the side of a limb grows, as a fraction of its size:
   * a cluster rides out on a twig of its own, most of them short and a few long, so a limb
   * carries a sleeve of them around it rather than a single row.
   */
  twig: 0.5,
  /**
   * Width of its stalk where it leaves the wood and where it meets the cluster, as fractions of
   * the size of one cluster, so a larger one grows a stouter stalk. Where a cluster meets its
   * stalk, the stalk is as wide as the cluster's own spur. A mound's twig carries all its
   * clusters, so it leaves the wood stouter by the square root of how many clusters across the
   * mound is, and thins to one cluster's in the mound's middle, where the twigs to its clusters
   * fork from it.
   */
  girth: { root: 0.034, tip: 0.02 },
  /** How far one on the side of a limb turns from square off the wood toward the sky, 0 to 1. */
  skyward: 0.4,
  /** Multiplier on how far each one leans off its usual angle. */
  splay: 6,
  /**
   * Spacing of the ones the tree places along a limb, back from its tip, as a multiple of their
   * size at a size multiplier of one. Mounds keep this spacing, so larger ones run together into
   * a canopy. Neighbors take turns on either side, so those on the same side are twice this
   * apart.
   */
  spacing: 0.75,
  /** Thickest wood a cluster grows on, as a radius in world units. */
  maxGirth: 0.035,
} as const;

/** How a flower moves once it comes off the tree. */
const FALLING = {
  /** How quickly a falling flower takes up the speed of the air around it, per second. */
  airGrip: 4,
  /** Fraction of the wind's speed a flower torn loose by it sets off with. */
  windKick: 0.4,
  /** Side-to-side sway as it falls, in meters per second squared. */
  sway: 2.2,
  /** Seconds it lies on the ground before it starts to fade. */
  linger: 6,
  /** Seconds it takes to fade away. */
  fade: 3,
} as const;

/** What makes each flower a little different from the next. */
interface Traits {
  /** Multiplier on its size. */
  size: number;
  /** How far it leans off its usual angle, in radians. */
  tilt: number;
  /** How much of the most extra stalk a cluster can grow it grows, from 0 to 1. */
  reach: number;
  /** Seconds it takes to unfold. */
  opening: number;
  /** Its stem's hold, as a fraction of the usual for its size. */
  hold: number;
  /** How much earlier in the year than the rest it turns. */
  early: number;
  /** Time of year it drops on its own. */
  dropsAt: number;
  /** For the small differences in how it is drawn, from 0 to 1. */
  variant: number;
}

/** Traits of a flower that has not grown yet, previewed where it would go. */
const TYPICAL: Traits = {
  size: 1,
  tilt: 0,
  reach: 0,
  opening: FLOWERS.opening,
  hold: 1,
  early: 0,
  dropsAt: FLOWERS.drops.to,
  variant: 0.5,
};

/** A flower on the tree. */
interface Flower {
  readonly placement: FlowerPlacement;
  readonly limb: Limb;
  /** 1 grows from the limb's left side, -1 from its right, and 0 crowns its tip. */
  readonly side: 1 | 0 | -1;
  /**
   * For a flower on the side of a limb, the radius of the wood it grows from. It keeps to wood
   * this thin, so it moves out toward the tip as its limb grows and thickens.
   */
  readonly girth: number;
  readonly traits: Traits;
  /** Where along its limb it sat at the last update. */
  s: number;
  /** How far it has grown in, from 0 to 1. */
  grown: number;
  /** How far it has opened, from 0 closed to 1 open, before easing. */
  opened: number;
  /** How far the wind has turned it from where it would face in still air, in radians. */
  sway: number;
  /** Wind damage to its stem. It tears loose at 1. */
  damage: number;
  /** Why it is off the tree for now, if it is. */
  dropped: "season" | "wind" | undefined;
  /** Seconds until the tree grows back a flower it lost to the wind. */
  regrowIn: number;
  /** How open to the sky it is, from 0 deep in the canopy to 1 on top of it. */
  exposure: number;
  /**
   * Whether it rode up its limb into the next flower along its side. It shrinks away, and is gone
   * once it has.
   */
  crowded: boolean;
}

/** A flower that came off the tree, falling or lying on the ground. */
interface Falling {
  readonly traits: Traits;
  readonly size: number;
  readonly clusters: number;
  readonly openness: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  /** Progress through its side-to-side sway, in radians. */
  phase: number;
  /** Seconds it has lain on the ground. */
  resting: number;
  alpha: number;
}

/**
 * The stalk a flower grows on, in world units: a curve from `from`, inside the wood, to the
 * flower's base, leaving toward the first of `controls` and arriving from the second, `root` wide
 * where it leaves the wood and tapering to `tip` wide at the base.
 */
export interface Stalk {
  from: Vec;
  controls: readonly [Vec, Vec];
  root: number;
  tip: number;
}

/** Where a flower is, in world units, and the stalk it grows on. */
interface Pose {
  x: number;
  y: number;
  /** The way it faces, in radians counterclockwise from +x. */
  angle: number;
  size: number;
  /** How many times the size of one cluster a mound of clusters spans; 1 for a lone flower. */
  clusters: number;
  stalk: Stalk;
}

/** Everything needed to draw one flower, in world units. */
export interface FlowerView {
  /** The flower's base, where its stalk ends. */
  x: number;
  y: number;
  /** The way it faces, in radians counterclockwise from +x. */
  angle: number;
  size: number;
  /** How many times the size of one cluster a mound of clusters spans; 1 for a lone flower. */
  clusters: number;
  /** From 0, closed into a bud, to 1, fully open. */
  openness: number;
  /** The time of year it shows, from midsummer at 0 to winter at 1. */
  age: number;
  alpha: number;
  /** For the small differences in how it is drawn, from 0 to 1. */
  variant: number;
  /** How open to the sky it is, from 0 deep in the canopy to 1 on top of it. */
  exposure: number;
  /** The stalk it grows on while it is on the tree. */
  stalk: Stalk | undefined;
}

/** What shift-clicking the tree would do to its flowers. */
export interface FlowerHover {
  /** The flower that would grow, drawn faintly where it would go. */
  ghost: FlowerView | undefined;
  /** The flower that would be knocked off. */
  target: FlowerView | undefined;
}

/**
 * Every flower: those on the tree, placed by hand or grown by the tree itself, and those that
 * came off and are falling or lying on the ground.
 */
export class Flowers {
  private flowers: Flower[] = [];
  private falling: Falling[] = [];
  private time = 0;
  private readonly rng = new Rng(4099);
  /** Side of each limb the tree starts its flowers on. */
  private readonly limbSides = new WeakMap<Limb, 1 | -1>();

  /** Removes every flower at once, as when a new tree is planted. */
  clear(): void {
    this.flowers = [];
    this.falling = [];
  }

  /** How many flowers are showing on the tree, and how many have come off and not yet faded. */
  count(): { onTree: number; falling: number } {
    return {
      onTree: this.flowers.filter((f) => f.dropped === undefined && f.grown > 0)
        .length,
      falling: this.falling.length,
    };
  }

  /**
   * Grows, opens, ages and drops the flowers, tears loose any the wind pulls too hard, and moves
   * those that came off. With no standing tree, every flower still on it falls.
   */
  update(
    dt: number,
    tree: Tree | undefined,
    settings: FlowerSettings,
    conditions: Conditions,
  ): void {
    this.time += dt;
    if (tree === undefined) {
      for (const flower of this.flowers) {
        this.drop(flower, undefined, settings, { x: 0, y: 0 });
      }
      this.flowers = [];
    } else {
      if (settings.placement === "tree") {
        this.growOwn(tree, settings);
      }
      this.tend(dt, tree, settings, conditions);
      this.expose(dt, settings);
    }
    for (const flower of this.falling) {
      fall(flower, dt, conditions.wind);
    }
    this.falling = this.falling.filter((flower) => flower.alpha > 0);
  }

  /**
   * Grows a flower by hand where `pick` lands: crowning the limb if that is near its tip,
   * otherwise on the side clicked, moved out along the limb to where the wood is thin enough.
   * Returns false if no wood on the limb is thin enough.
   */
  place(pick: Pick): boolean {
    const spot = this.spot(pick);
    if (spot === undefined) {
      return false;
    }
    this.flowers.push(this.flower("hand", pick.limb, spot));
    return true;
  }

  /** Knocks off the hand-placed flower drawn over (x, y), if any. Returns whether there was one. */
  knockOff(
    tree: Tree,
    x: number,
    y: number,
    reach: number,
    settings: FlowerSettings,
  ): boolean {
    const flower = this.flowerAt(tree, x, y, reach, settings);
    if (flower === undefined) {
      return false;
    }
    this.drop(flower, tree, settings, { x: 0, y: 0 });
    this.flowers.splice(this.flowers.indexOf(flower), 1);
    return true;
  }

  /**
   * What shift-clicking at (x, y), over `pick`, would do, with the flowers drawn as they look at
   * this `season`.
   */
  hover(
    tree: Tree,
    x: number,
    y: number,
    reach: number,
    pick: Pick | undefined,
    settings: FlowerSettings,
    season: number,
  ): FlowerHover {
    const target = this.flowerAt(tree, x, y, reach, settings);
    if (target !== undefined) {
      return { ghost: undefined, target: this.view(target, settings, season) };
    }
    const spot = pick === undefined ? undefined : this.spot(pick);
    if (pick === undefined || spot === undefined) {
      return { ghost: undefined, target: undefined };
    }
    const pose = flowerPose(
      pick.limb,
      spot.s,
      spot.side,
      TYPICAL,
      1,
      settings.size,
      0,
    );
    return {
      ghost: {
        ...pose,
        openness: 1,
        age: season,
        alpha: 0.45,
        variant: TYPICAL.variant,
        exposure: 1,
      },
      target: undefined,
    };
  }

  /** Every flower to draw, as it looks at this `season`: those on the tree, then those that came off. */
  views(settings: FlowerSettings, season: number): FlowerView[] {
    const views: FlowerView[] = [];
    for (const flower of this.flowers) {
      if (flower.dropped === undefined && flower.grown > 0) {
        views.push(this.view(flower, settings, season));
      }
    }
    for (const flower of this.falling) {
      views.push({
        x: flower.x,
        y: flower.y,
        angle: flower.angle,
        size: flower.size,
        clusters: flower.clusters,
        openness: flower.openness,
        age: ageOf(flower.traits, season),
        alpha: flower.alpha,
        variant: flower.traits.variant,
        exposure: 1,
        stalk: undefined,
      });
    }
    return views;
  }

  private flower(placement: FlowerPlacement, limb: Limb, spot: Spot): Flower {
    return {
      placement,
      limb,
      side: spot.side,
      girth: spot.side === 0 ? 0 : limb.radiusAt(spot.s),
      traits: {
        size: 0.88 + 0.24 * this.rng.next(),
        tilt: (this.rng.next() - 0.5) * 0.3,
        reach: this.rng.next() ** 2,
        opening: FLOWERS.opening * (0.8 + 0.45 * this.rng.next()),
        hold: Math.exp(FLOWERS.holdSpread * this.normal()),
        early: (this.rng.next() - 0.5) * 0.08,
        dropsAt:
          FLOWERS.drops.from +
          (FLOWERS.drops.to - FLOWERS.drops.from) * this.rng.next(),
        variant: this.rng.next(),
      },
      s: spot.s,
      grown: 0,
      opened: 0,
      sway: 0,
      damage: 0,
      dropped: undefined,
      regrowIn: 0,
      exposure: 1,
      crowded: false,
    };
  }

  /**
   * Where a flower placed by hand at `pick` would grow, or nothing if the wood is too thick for
   * it.
   */
  private spot(pick: Pick): Spot | undefined {
    const { limb } = pick;
    const thin = thinFrom(limb, HABIT.maxGirth);
    if (thin === undefined) {
      return undefined;
    }
    const s = Math.max(pick.s, thin);
    if (limb.length - s < FLOWERS.tipReach) {
      return { s: limb.length, side: 0 };
    }
    return { s, side: pick.side };
  }

  /**
   * The tree's own flowers: one crowning each limb long enough to flower, and more spaced back
   * along the thin wood behind it, alternating sides, as far as the wood stays thin enough for
   * them. A long twiggy limb carries many, a short one a few.
   */
  private growOwn(tree: Tree, settings: FlowerSettings): void {
    for (const limb of tree.limbs) {
      if (limb.length < FLOWERS.firstBloom) {
        continue;
      }
      const own = this.flowers.filter(
        (f) => f.placement === "tree" && f.limb === limb,
      );
      const spacing = spacingOf(settings.size);
      invariant(spacing > 0, `Flowers ${settings.size} in size have no room.`);
      let side = this.firstSide(limb);
      for (let slot = 0; ; slot += 1) {
        const s = limb.length - slot * spacing;
        if (s < FLOWERS.clearOfBase || limb.radiusAt(s) > HABIT.maxGirth) {
          break;
        }
        const spot: Spot = { s, side: slot === 0 ? 0 : side };
        if (slot > 0) {
          side = side === 1 ? -1 : 1;
        }
        const taken = own.some((f) =>
          spot.side === 0
            ? f.side === 0
            : f.side !== 0 && Math.abs(f.s - s) < 0.75 * spacing,
        );
        if (!taken) {
          const placed: Spot =
            spot.side === 0
              ? spot
              : {
                  s: Math.min(
                    limb.length,
                    s + this.rng.next() * FLOWERS.jitter * spacing,
                  ),
                  side: spot.side,
                };
          const flower = this.flower("tree", limb, placed);
          this.flowers.push(flower);
          own.push(flower);
        }
      }
    }
  }

  /**
   * Follows how open to the sky each flower on the tree is: the more of the others lie above it,
   * overhanging it, the less. It follows slowly, so a flower does not flicker between light and
   * shade as the canopy sways.
   */
  private expose(dt: number, settings: FlowerSettings): void {
    const showing = this.flowers.filter(
      (f) => f.dropped === undefined && f.grown > 0,
    );
    const poses = showing.map((f) => this.poseOf(f, settings));
    const order = poses
      .map((_, i) => i)
      .sort((a, b) => at(poses, a).x - at(poses, b).x);
    const widest = EXPOSURE.width * Math.max(0, ...poses.map((p) => p.size));
    let first = 0;
    for (const i of order) {
      const a = at(poses, i);
      while (at(poses, at(order, first)).x < a.x - widest) {
        first += 1;
      }
      const reach = EXPOSURE.width * a.size;
      let cover = 0;
      for (let k = first; k < order.length; k += 1) {
        const b = at(poses, at(order, k));
        if (b.x > a.x + widest) {
          break;
        }
        const across = Math.abs(b.x - a.x);
        const above = b.y - a.y;
        if (above > 0 && above < EXPOSURE.depth * a.size && across < reach) {
          cover += 1 - across / reach;
        }
      }
      const flower = at(showing, i);
      flower.exposure = approach(
        flower.exposure,
        Math.exp(-cover / EXPOSURE.cover),
        EXPOSURE.settle,
        dt,
      );
    }
  }

  /** Grows, opens, ages and drops the flowers on the tree, and lets the wind tear them loose. */
  private tend(
    dt: number,
    tree: Tree,
    settings: FlowerSettings,
    conditions: Conditions,
  ): void {
    const shares = conditions.flowing ? tree.flowShares() : undefined;
    const fed = (limb: Limb): number => {
      if (shares === undefined) {
        return 1;
      }
      const share = shares.get(limb);
      invariant(share !== undefined, "Every limb gets a share of the flow.");
      return clamp(
        Math.sqrt(share * tree.limbs.length),
        FLOWERS.fed.min,
        FLOWERS.fed.max,
      );
    };
    const kept: Flower[] = [];
    const before = new Map<Flower, number>();
    for (const flower of this.flowers) {
      const s = position(flower, tree);
      // Its wood is gone, cut or broken off, or has grown too thick for it.
      if (s === undefined) {
        this.drop(flower, tree, settings, { x: 0, y: 0 });
        continue;
      }
      // It was crowded off its wood and has shrunk away, or came off the tree as it did.
      if (
        flower.crowded &&
        (flower.grown <= 0 || flower.dropped !== undefined)
      ) {
        continue;
      }
      before.set(flower, flower.s);
      flower.s = s;
      const age = ageOf(flower.traits, conditions.season);
      if (flower.dropped === "season" && age < flower.traits.dropsAt) {
        regrow(flower);
      }
      if (flower.dropped === "wind") {
        flower.regrowIn -= dt;
        if (flower.regrowIn <= 0) {
          regrow(flower);
        }
      }
      if (flower.dropped === undefined && age >= flower.traits.dropsAt) {
        this.drop(flower, tree, settings, { x: 0, y: 0 });
        flower.dropped = "season";
      }
      if (flower.dropped !== undefined) {
        kept.push(flower);
        continue;
      }

      const shown = flower.placement === settings.placement && !flower.crowded;
      flower.grown = clamp(
        flower.grown + (shown ? dt : -dt) / FLOWERS.growIn,
        0,
        1,
      );
      flower.opened = clamp(flower.opened + dt / flower.traits.opening, 0, 1);
      const torn =
        flower.grown > 0
          ? this.weather(
              flower,
              dt,
              settings,
              conditions.wind,
              conditions.hold * fed(flower.limb),
              age,
            )
          : undefined;
      if (torn !== undefined) {
        this.drop(flower, tree, settings, torn);
        if (flower.placement === "hand") {
          continue;
        }
        flower.dropped = "wind";
        flower.regrowIn = FLOWERS.regrow;
      }
      kept.push(flower);
    }
    this.flowers = kept;
    this.uncrowd(before, settings);
  }

  /**
   * Marks as crowded every flower that rode up its limb since `before` to nearer than it may grow
   * behind the next flower along the same side, so it shrinks away. Each flower keeps to wood as
   * thin as it grew on, so when an offshoot thickens the wood below its fork, every flower there
   * rides up into the thin wood just past the fork; without this they would bunch there. The tree
   * grows its own back where there is room for them.
   */
  private uncrowd(
    before: ReadonlyMap<Flower, number>,
    settings: FlowerSettings,
  ): void {
    // The flowers along each side of each limb, those placed by hand apart from the tree's own.
    // One crowning a tip has no side to crowd, and one already crowded is on its way out.
    const rows = new Map<Limb, Map<string, Flower[]>>();
    for (const flower of this.flowers) {
      if (flower.side === 0 || flower.crowded) {
        continue;
      }
      let sides = rows.get(flower.limb);
      if (sides === undefined) {
        sides = new Map();
        rows.set(flower.limb, sides);
      }
      const key = `${flower.side} ${flower.placement}`;
      const row = sides.get(key);
      if (row === undefined) {
        sides.set(key, [flower]);
      } else {
        row.push(flower);
      }
    }
    const was = (flower: Flower): number => {
      const s = before.get(flower);
      invariant(s !== undefined, "Every flower kept had a place before.");
      return s;
    };
    for (const sides of rows.values()) {
      for (const row of sides.values()) {
        // From the tip back, so a flower riding up goes rather than the one it rode into.
        row.sort((a, b) => b.s - a.s);
        let ahead: Flower | undefined;
        for (const flower of row) {
          if (ahead !== undefined) {
            const gap = ahead.s - flower.s;
            const closing = gap < was(ahead) - was(flower) - 1e-6;
            if (closing && gap < FLOWERS.crowded * spacingOf(settings.size)) {
              flower.crowded = true;
              continue;
            }
          }
          ahead = flower;
        }
      }
    }
  }

  /**
   * Lets the wind pull on a flower: it leans downwind and flutters, and its stem tears loose under
   * a pull past what it holds for long enough. `hold` multiplies how hard it holds. Returns the
   * push the wind gives a flower it tears loose.
   */
  private weather(
    flower: Flower,
    dt: number,
    settings: FlowerSettings,
    wind: Wind,
    hold: number,
    age: number,
  ): Vec | undefined {
    const pose = this.poseOf(flower, settings);
    const middle = along(pose, pose.angle, 0.5 * pose.size);
    const air = wind.at(middle.x, middle.y, 1000 + flower.traits.variant * 100);
    const speed = Math.hypot(air.x, air.y);
    const area =
      FLOWERS.area *
      pose.size *
      pose.size *
      (FLOWERS.budArea + (1 - FLOWERS.budArea) * flower.opened);
    const pull = 0.5 * PHYSICS.airDensity * FLOWERS.drag * area * speed * speed;
    const autumn =
      1 -
      (1 - FLOWERS.autumnHold) * smoothstep(0.5, flower.traits.dropsAt, age);
    const limit =
      FLOWERS.hold *
      Math.pow(pose.size / FLOWERS.size, FLOWERS.holdGrowth) *
      flower.traits.hold *
      hold *
      autumn;

    const lean =
      speed > 0
        ? clamp(wrapAngle(Math.atan2(air.y, air.x) - pose.angle), -1, 1) *
          FLOWERS.windLean *
          Math.min(1, pull / limit)
        : 0;
    const flutter =
      FLOWERS.flutter *
      Math.min(1, speed / 20) *
      valueNoise(this.time * 2.3 + flower.traits.variant * 50, 77);
    flower.sway = approach(flower.sway, lean + flutter, 0.12, dt);

    if (pull > limit) {
      flower.damage +=
        dt *
        (FLOWERS.damageAtLimit +
          FLOWERS.damagePerOverload * (pull / limit - 1));
    } else {
      flower.damage = Math.max(0, flower.damage - dt * FLOWERS.healing);
    }
    return flower.damage < 1
      ? undefined
      : { x: air.x * FALLING.windKick, y: air.y * FALLING.windKick };
  }

  /**
   * Takes a flower off the tree. One that was showing falls, carrying the motion of the wood it
   * grew on plus `push`.
   */
  private drop(
    flower: Flower,
    tree: Tree | undefined,
    settings: FlowerSettings,
    push: Vec,
  ): void {
    if (flower.dropped !== undefined || flower.grown <= 0.05) {
      flower.grown = 0;
      return;
    }
    const pose = this.poseOf(flower, settings);
    const motion =
      tree !== undefined && tree.has(flower.limb)
        ? tree.physics.velocityAt(flower.limb, flower.s, pose.x, pose.y)
        : { x: 0, y: 0, spin: 0 };
    this.falling.push({
      traits: flower.traits,
      size: pose.size,
      clusters: pose.clusters,
      openness: flower.opened,
      x: pose.x,
      y: pose.y,
      vx: motion.x + push.x,
      vy: motion.y + push.y,
      angle: pose.angle,
      spin: (this.rng.next() - 0.5) * 2.4,
      phase: this.rng.next() * Math.PI * 2,
      resting: 0,
      alpha: 1,
    });
    flower.grown = 0;
  }

  private poseOf(flower: Flower, settings: FlowerSettings): Pose {
    return flowerPose(
      flower.limb,
      Math.min(flower.s, flower.limb.length),
      flower.side,
      flower.traits,
      flower.grown,
      settings.size,
      flower.sway,
    );
  }

  private view(
    flower: Flower,
    settings: FlowerSettings,
    season: number,
  ): FlowerView {
    return {
      ...this.poseOf(flower, settings),
      openness: flower.opened,
      age: ageOf(flower.traits, season),
      alpha: 1,
      variant: flower.traits.variant,
      exposure: flower.exposure,
    };
  }

  /**
   * The hand-placed flower drawn over (x, y), or within `reach` of its middle, nearest first, so
   * a flower too small to aim at can still be hit.
   */
  private flowerAt(
    tree: Tree,
    x: number,
    y: number,
    reach: number,
    settings: FlowerSettings,
  ): Flower | undefined {
    let nearest: { flower: Flower; distance: number } | undefined;
    for (const flower of this.flowers) {
      if (
        flower.placement !== "hand" ||
        flower.dropped !== undefined ||
        flower.grown <= 0 ||
        !tree.has(flower.limb)
      ) {
        continue;
      }
      const pose = this.poseOf(flower, settings);
      const middle = along(
        pose,
        pose.angle,
        middleReach(pose.clusters) * pose.size,
      );
      const distance = Math.hypot(x - middle.x, y - middle.y);
      if (
        distance <= Math.max(0.6 * pose.size, reach) &&
        (nearest === undefined || distance < nearest.distance)
      ) {
        nearest = { flower, distance };
      }
    }
    return nearest?.flower;
  }

  private firstSide(limb: Limb): 1 | -1 {
    let side = this.limbSides.get(limb);
    if (side === undefined) {
      side = this.rng.next() < 0.5 ? 1 : -1;
      this.limbSides.set(limb, side);
    }
    return side;
  }

  /** A random number with a standard normal distribution, near enough: a sum of three uniforms. */
  private normal(): number {
    return (this.rng.next() + this.rng.next() + this.rng.next() - 1.5) * 2;
  }
}

/** Where along a limb a flower grows, and from which side: 1 left, -1 right, 0 crowning the tip. */
interface Spot {
  s: number;
  side: 1 | 0 | -1;
}

/**
 * Where along its limb a flower sits now, or nothing if the wood it grew on is gone or no longer
 * thin enough for it.
 */
function position(flower: Flower, tree: Tree): number | undefined {
  const { limb } = flower;
  if (!tree.has(limb) || limb.length < flower.s - 1e-9) {
    return undefined;
  }
  if (flower.side === 0) {
    return limb.radiusAt(limb.length) <= HABIT.maxGirth
      ? limb.length
      : undefined;
  }
  return thinFrom(limb, flower.girth);
}

/**
 * How far a flower's middle lies beyond the end of its stalk, the way it faces, as a fraction of
 * its size. A lone flower or cluster sits beyond its stalk, but a mound two or more clusters
 * across sits around the end of its twig, which runs into it like a branch into its blossoms.
 */
export function middleReach(clusters: number): number {
  return 0.5 * (1 - moundness(clusters));
}

/**
 * How far a flower `clusters` clusters across has grown from a lone cluster, at 0, into a mound
 * that sits around the end of its twig, at 1, as it goes from one cluster across to two.
 */
function moundness(clusters: number): number {
  return smoothstep(1, 2, clusters);
}

/**
 * How far apart the tree grows flowers along a limb, taking turns on either side, at the size
 * multiplier `size`, in world units. Mounds keep the spacing of the clusters they grow from, so
 * larger ones run together into a canopy.
 */
function spacingOf(size: number): number {
  return HABIT.spacing * FLOWERS.size * Math.min(1, size);
}

/** Brings back a flower that dropped, as a bud that grows in. */
function regrow(flower: Flower): void {
  flower.dropped = undefined;
  flower.grown = 0;
  flower.opened = 0;
  flower.sway = 0;
  flower.damage = 0;
}

/**
 * Where a flower at `s` along `limb` is drawn, and its stalk, turned `sway` by the wind. `grown`
 * scales it as it grows in, and `size` is the size multiplier from the debug panel.
 */
function flowerPose(
  limb: Limb,
  s: number,
  side: 1 | 0 | -1,
  traits: Traits,
  grown: number,
  size: number,
  sway: number,
): Pose {
  const p = limb.pointAt(s);
  const radius = limb.radiusAt(s);
  const span = FLOWERS.size * size * traits.size * smoothstep(0, 1, grown);
  const clusters = Math.max(1, size);
  const cluster = span / clusters;
  // A stalk from the side of a limb is never more than half as stout as the wood, and one
  // crowning a tip no stouter than the tip it carries on from.
  const root = Math.min(
    HABIT.girth.root * cluster * Math.sqrt(clusters),
    side === 0 ? 2 * radius : radius,
  );
  const tip = Math.min(HABIT.girth.tip * cluster, root);
  if (side === 0) {
    // Crowning a tip, it carries on the way the limb grows, bending a little toward the sky.
    const angle = turnToward(p.heading, UPRIGHT, 0.35) + traits.tilt + sway;
    const { base, controls } = bend(p, p.heading, angle, HABIT.stalk * span);
    return {
      ...base,
      angle,
      size: span,
      clusters,
      stalk: { from: { x: p.x, y: p.y }, controls, root, tip },
    };
  }
  // A mound sits around the end of a shorter twig, so most mounds wrap their limb and only the
  // furthest stand out from it on a twig of their own.
  const lone = HABIT.stalk + HABIT.twig * traits.reach;
  const mound = lerp(
    FLOWERS.moundTwig.from,
    FLOWERS.moundTwig.to,
    traits.reach,
  );
  const length = lerp(lone, mound, moundness(clusters)) * span;
  const normal = p.heading + (side * Math.PI) / 2;
  const leave = turnToward(normal, p.heading, STALK.lean);
  const facing =
    turnToward(normal, UPRIGHT, HABIT.skyward) + traits.tilt * HABIT.splay;
  const angle =
    leave + clamp(wrapAngle(facing - leave), -STALK.bend, STALK.bend) + sway;
  const from = along(p, normal, STALK.inset * radius);
  const { base, controls } = bend(
    from,
    leave,
    angle,
    (1 - STALK.inset) * radius + length,
  );
  return {
    ...base,
    angle,
    size: span,
    clusters,
    stalk: { from, controls, root, tip },
  };
}

/**
 * A stalk `length` long from `from` that leaves heading `leave` and bends evenly, along an arc,
 * to arrive heading `arrive`: where it ends, and the controls of the curve that follows it.
 */
function bend(
  from: Vec,
  leave: number,
  arrive: number,
  length: number,
): { base: Vec; controls: readonly [Vec, Vec] } {
  const turn = wrapAngle(arrive - leave);
  const straight = Math.abs(turn) < 1e-6;
  const chord = straight ? length : (length * Math.sin(turn / 2)) / (turn / 2);
  const handle = straight
    ? length / 3
    : (4 * length * Math.tan(turn / 4)) / (3 * turn);
  const base = along(from, leave + turn / 2, chord);
  return {
    base,
    controls: [along(from, leave, handle), along(base, arrive, -handle)],
  };
}

/**
 * The innermost point along `limb` where its wood is no thicker than `girth`, or nothing if none
 * is. A limb thins steadily toward its tip, so everything beyond that point is thinner still.
 */
function thinFrom(limb: Limb, girth: number): number | undefined {
  if (limb.radiusAt(limb.length) > girth) {
    return undefined;
  }
  if (limb.radiusAt(0) <= girth) {
    return 0;
  }
  let lo = 0;
  let hi = limb.length;
  for (let i = 0; i < 30; i += 1) {
    const mid = (lo + hi) / 2;
    if (limb.radiusAt(mid) <= girth) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return hi;
}

/** Moves a flower that came off the tree through the air, and lets it settle and fade. */
function fall(flower: Falling, dt: number, wind: Wind): void {
  const ground = 0.22 * flower.size;
  if (flower.resting > 0 || flower.y <= ground) {
    flower.resting += dt;
    flower.y = ground;
    // It settles on its side.
    const flat = Math.round(flower.angle / Math.PI) * Math.PI;
    flower.angle = approach(flower.angle, flat, 0.25, dt);
    if (flower.resting > FALLING.linger) {
      flower.alpha = Math.max(0, flower.alpha - dt / FALLING.fade);
    }
    return;
  }
  const air = wind.at(flower.x, flower.y, 2000 + flower.traits.variant * 100);
  // A smaller flower is carried more readily by the air.
  const grip =
    FALLING.airGrip * Math.min(2, FLOWERS.size / Math.max(flower.size, 1e-3));
  flower.phase += dt * (2.6 + flower.traits.variant);
  flower.vx +=
    dt * ((air.x - flower.vx) * grip + FALLING.sway * Math.sin(flower.phase));
  flower.vy += dt * ((air.y - flower.vy) * grip - PHYSICS.gravity);
  flower.spin = approach(flower.spin, 1.6 * Math.cos(flower.phase), 0.4, dt);
  flower.x += dt * flower.vx;
  flower.y += dt * flower.vy;
  flower.angle += dt * flower.spin;
}

/** The time of year a flower shows: the season, a little early or late for each flower. */
function ageOf(traits: Traits, season: number): number {
  return clamp(season + traits.early, 0, 1);
}

/** Turns `from` a fraction `t` of the way toward `to`, the short way around. */
function turnToward(from: number, to: number, t: number): number {
  return from + wrapAngle(to - from) * t;
}

function along(p: Vec, angle: number, distance: number): Vec {
  return {
    x: p.x + Math.cos(angle) * distance,
    y: p.y + Math.sin(angle) * distance,
  };
}
