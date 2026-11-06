import type { Water } from "./debris";
import {
  along,
  type Conditions,
  FLOWERS,
  type FlowerPlacement,
  type FlowerSettings,
  thinFrom,
  turnToward,
} from "./flowers";
import { type Level, slopeAt } from "./level";
import { type Limb, UPRIGHT } from "./limb";
import { type Load, PHYSICS } from "./physics";
import type { Pick, Tree } from "./tree";
import { type Catcher, SNOW } from "./weather";
import {
  approach,
  at,
  clamp,
  hash,
  invariant,
  lerp,
  Rng,
  smoothstep,
  valueNoise,
  wrapAngle,
} from "./util";
import type { Vec, Wind } from "./wind";

/**
 * A weeping willow's flowers are its strands: fine twigs that leave its thin wood, arch over and
 * hang straight down, dressed in narrow leaves with golden catkins among them. Hung close along
 * every thin limb, they make the curtains a willow is known by.
 */
export const STRANDS = {
  /**
   * Length of the longest strands at a size multiplier of one, in meters: true to life, a willow's
   * hanging shoots grow one to three meters long. From high wood the longest hang further, on
   * shoots of years gone by, as much as `drape` of the way down to the ground.
   */
  length: 1.9,
  drape: 0.75,
  /** Strands lengthen with the size multiplier to this power, so a larger size hangs longer curtains. */
  lengthGrowth: 0.8,
  /** Each strand grows this share of the full length, from the shortest to the longest, so the hem is ragged. */
  share: { from: 0.4, to: 1 },
  /** A strand hangs no lower than this above the ground under where it leaves the wood, in meters. */
  clearance: 0.15,
  /** Shortest a strand grows, in meters, however little room it has. */
  shortest: 0.2,
  /** Spacing of the strands the tree hangs along a limb, in meters, taking turns on either side. */
  spacing: 0.11,
  /** Thickest wood a strand hangs from, as a radius in meters: back along branches 9 cm across. */
  maxGirth: 0.045,
  /** A limb carries strands once it is this long, in meters, when the tree hangs them. */
  firstBloom: 0.5,
  /** The tree keeps its strands this far from where a limb starts, in meters. */
  clearOfBase: 0.3,
  /** A strand placed this close to its limb's tip, in meters, weeps from the tip instead. */
  tipReach: 0.2,
  /**
   * The tree hangs each strand on the side of a limb up to this fraction of their spacing nearer
   * the tip than its place in the row, so they never line up exactly.
   */
  jitter: 0.6,
  /**
   * A strand that rides up its limb to nearer than this many spacings behind the next along the
   * same side withers away, so strands riding up never bunch.
   */
  crowded: 1.2,
  /** Seconds a strand takes to grow to its full length, and to wither away once crowded. */
  growIn: 4,
  shrink: 0.9,
  /** Seconds a strand takes to lengthen or shorten to the room it has as its wood grows. */
  settle: 1.5,
  /** Seconds its catkins take to open from silver buds, before each strand's own variation. */
  opening: 3,
  /** Seconds the tree takes to grow back a strand the wind took. */
  regrow: 20,
  /** Radius of a strand's twig where it leaves the wood and at its tip, in meters. */
  twig: { root: 0.003, tip: 0.0008 },
  /**
   * Wind, in meters per second, a typical strand in full leaf holds against before its twig starts
   * to tear: a storm. Bare, it catches less of the wind and holds out longer.
   */
  holdSpeed: 26,
  /** Across a strand's arch, where it catches the light and the snow, in meters. */
  reach: 0.4,
} as const;

/**
 * How a strand leaves its wood: out from the side it grows on, leaning `lean` of the way toward its
 * limb's tip, then turned toward the sky by up to `skyward` of the way, the most from the top of a
 * limb and not at all from beneath it. It starts `inset` of the way out from the middle of the
 * wood. From there it arches over, within `reach` meters for a half turn, to hang straight down;
 * the arch is laid out in steps of `step` meters.
 */
const ARCH = {
  lean: 0.3,
  skyward: 0.4,
  inset: 0.4,
  reach: 0.36,
  step: 0.02,
} as const;

/**
 * How a strand swings: as a chain of `segments` links, shorter toward its base where it arches,
 * each node pulled down by its weight, dragged by the air moving past it and damped, and kept its
 * link's length from the node before it. The arch holds its shape with `stiffness`, firmly at the
 * wood and not at all where the strand hangs. Steps are no longer than `step` seconds.
 */
const SWING = {
  segments: 12,
  crowding: 1.6,
  step: 1 / 120,
  /**
   * Drag on a strand, as an acceleration per square of the speed of the air past it: in full leaf
   * a strand leans about 13 degrees from hanging in a gentle breeze of 5 m/s, 43 in 10 m/s, and
   * streams out nearly level in a gale. Bare, it catches about a third of that.
   */
  drag: 0.09,
  bareDrag: 0.032,
  /** Damping of its swing, per second. */
  damping: 0.9,
  /** How firmly the arch holds its shape where it leaves the wood, per second squared. */
  stiffness: 1400,
  /** Damping of the arch, as a fraction of critical. */
  stiffDamping: 0.5,
  /** How much of each node's correction carries back into the speed of the node before it. */
  follow: 0.9,
  /**
   * The air along a strand gusts and eddies as it streams past: its speed swings by up to `gust`
   * of the wind's, and it turns across by up to `eddy` of it, in waves that run down the strand.
   */
  gust: 0.35,
  eddy: 0.25,
  /**
   * No strand hangs dead straight: each is pushed a little to one side and the other along its
   * length, by up to this much, in meters per second squared, so it hangs in a gentle curve of its
   * own, the curve changing every `bend` meters down it.
   */
  lean: 0.9,
  bend: 1.1,
} as const;

/**
 * A strand's leaves, true to life: narrow and pointed, 12 cm long and 1.8 cm across, set every 2.6 cm
 * in a spiral around the twig from a short bare stretch where the strand leaves the wood, so seen
 * from the side they fall to either side of it at random, some lying along it. Each leaves the twig
 * at an angle toward its tip. They are smaller further down a strand, down to `tapered` of full
 * size at its tip, so each strand tapers like a tress; and those within `young` of a growing tip
 * are smaller still, down to `youngest` of full size at the very tip, where they are unfolding.
 */
export const LEAVES = {
  length: 0.12,
  /** Widest across, as a fraction of its length. */
  width: 0.15,
  spacing: 0.026,
  bare: 0.02,
  angle: { from: 0.08, to: 0.48 },
  tapered: 0.6,
  young: 0.3,
  youngest: 0.35,
  /** Each leaf turns up to this much of the year earlier or later than its strand. */
  turns: 0.06,
  /** Each leaf drops somewhere in this span of the year, so a strand thins through autumn. */
  drops: { from: 0.6, to: 0.95 },
} as const;

/**
 * Catkins: true to life, 3.5 cm long and a quarter as wide, in the axils of `share` of the leaves
 * from `from` meters along a strand to `to` of the way along it. Through early autumn they wither,
 * and by `drop` they are gone.
 */
export const CATKINS = {
  length: 0.035,
  width: 0.32,
  share: 0.13,
  from: 0.12,
  to: 0.6,
  wither: { from: 0.16, to: 0.32 },
  drop: 0.38,
} as const;

/** How leaves fall from a strand: the most falling at once, and the most let go each step. */
const SHED = {
  most: 700,
  perStep: 24,
  /**
   * In a gale leaves blow off the strands, each strand losing this many a second for every
   * square of the meters per second past `from`.
   */
  from: 13,
  gale: 0.012,
} as const;

/** How a leaf moves once it comes off its strand. */
const DRIFT = {
  /** How quickly a falling leaf takes up the speed of the air around it, per second. */
  airGrip: 7,
  /** Side-to-side sway as it falls, in meters per second squared. */
  sway: 3,
  /** Seconds it lies on the ground or floats before it starts to fade, and takes to fade. */
  linger: 7,
  floating: 12,
  fade: 3,
  /** How fast it slides off ground too steep to rest on, in meters per second. */
  tumble: 0.6,
} as const;

/**
 * How a strand moves once it comes off the tree: the seconds it lies on the ground or floats before
 * it starts to fade, and how fast, in meters per second, it must strike the water to splash.
 */
const FALLEN = { linger: 6, floating: 14, fade: 3, splash: 1.6 } as const;

/** Ground steeper than this, as its rise over its run, is too steep for a fallen leaf to rest on. */
const STEEP = 1;

/** A strand's catkins this far open are in bloom. */
const BLOOMING = 0.8;

/** What makes each strand a little different from the next. */
interface Traits {
  /** Its share of the full length. */
  share: number;
  /** How far it turns off its usual angle as it leaves the wood, in radians. */
  tilt: number;
  /** Seconds its catkins take to open. */
  opening: number;
  /** Its twig's hold, as a fraction of the usual. */
  hold: number;
  /** How much earlier in the year than the rest it turns. */
  early: number;
  /** Whether it hangs in front of the wood or behind it. */
  front: boolean;
  /** For the small differences in how it is drawn, from 0 to 1. */
  variant: number;
}

/** Traits of a strand that has not grown yet, previewed where it would go. */
const TYPICAL: Traits = {
  share: 0.8,
  tilt: 0,
  opening: STRANDS.opening,
  hold: 1,
  early: 0,
  front: true,
  variant: 0.5,
};

/** One node of a strand's chain, in meters. */
interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Where it is headed this step, before its link's length is kept. */
  px: number;
  py: number;
  /** How far keeping its link's length moved it this step. */
  cx: number;
  cy: number;
  /** The air moving past it, in meters per second. */
  ax: number;
  ay: number;
  /** Where the arch holds it, and how firmly, per second squared. */
  rx: number;
  ry: number;
  k: number;
  /** How hard it is pushed to one side, so its strand hangs in a curve of its own, in meters per second squared. */
  lean: number;
  /** Its distance along the strand from the wood, and from the node before it, in meters. */
  s: number;
  link: number;
}

/** A strand on the tree. */
interface Strand {
  readonly placement: FlowerPlacement;
  readonly limb: Limb;
  /** 1 hangs from the limb's left side, -1 from its right, and 0 weeps from its tip. */
  readonly side: 1 | 0 | -1;
  /**
   * For a strand on the side of a limb, the radius of the wood it grows from. It keeps to wood this
   * thin, so it moves out toward the tip as its limb grows and thickens.
   */
  readonly girth: number;
  readonly traits: Traits;
  /** Where along its limb it hung at the last update. */
  s: number;
  /** How long it grows, in meters, following the room it has. */
  full: number;
  /** How far it has grown in, from 0 to 1. */
  grown: number;
  /** How far its catkins have opened, from 0 in silver buds to 1 open, before easing. */
  opened: number;
  /** Wind damage to its twig. It tears loose at 1. */
  damage: number;
  /** Whether the wind took it, to grow back. */
  dropped: boolean;
  /** Seconds until the tree grows back a strand the wind took. */
  regrowIn: number;
  /** How open to the sky it is, from 0 deep in the curtain to 1 on top of it. */
  exposure: number;
  /** Whether it rode up its limb into the next strand along its side, so withers away. */
  crowded: boolean;
  /** Snow lying on it, in kilograms, and the weight of it its limb carries, which follows it. */
  snow: number;
  weight: number;
  /** The time of year it showed at the last update, so the leaves dropping since are let go. */
  age: number;
  /** Its chain, from where it leaves the wood to its tip; empty until it first swings. */
  nodes: Node[];
  /** The air moving past its middle at the last update, in meters per second. */
  air: Vec;
}

/** A strand that came off the tree, falling or lying on the ground or the sea. */
interface Fallen {
  readonly traits: Traits;
  readonly full: number;
  /** The time of year it fell, whose leaves it keeps. */
  readonly age: number;
  readonly openness: number;
  readonly root: number;
  readonly nodes: Node[];
  /** Seconds it has lain on the ground or floated. */
  resting: number;
  floating: boolean;
  alpha: number;
}

/** A leaf that came off its strand. */
interface Drifting {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  /** Progress through its side-to-side sway, in radians. */
  phase: number;
  /** Its length, in meters. */
  readonly size: number;
  /** The time of year it fell, which sets its color. */
  readonly age: number;
  readonly variant: number;
  resting: number;
  floating: boolean;
  alpha: number;
}

/** One leaf along a strand, and the catkin in its axil if it has one. */
export interface Leaf {
  /** Distance along the strand from where it leaves the wood, in meters. */
  s: number;
  /** 1 on the strand's left, looking along it from the wood, and -1 on its right. */
  side: 1 | -1;
  /** Its length, as a fraction of a full leaf's. */
  size: number;
  /** How far it leans off the strand toward the strand's tip, in radians. */
  angle: number;
  /** How far it curls along its length, as a fraction of its width, to its left. */
  curl: number;
  /** How much earlier in the year than its strand it turns, or later if negative. */
  turn: number;
  /** Time of year it drops. */
  drops: number;
  /** Whether a catkin grows in its axil. */
  catkin: boolean;
  /** For the small differences in how it is drawn and flutters, from 0 to 1. */
  variant: number;
}

/** Everything needed to draw one strand, in world units. */
export interface StrandView {
  /** Its nodes, from where it leaves the wood to its tip. */
  points: readonly Vec[];
  /** How far along the strand each node is, in meters. */
  along: readonly number[];
  /** How long it has grown so far, and how long it grows: leaves near a growing tip are young. */
  length: number;
  full: number;
  /** Radius of its twig where it leaves the wood. */
  root: number;
  /** The time of year it shows, from midsummer at 0 to winter at 1. */
  age: number;
  /** From 0, its catkins closed in silver buds, to 1, open. */
  openness: number;
  alpha: number;
  /** For the small differences in how it is drawn, from 0 to 1. */
  variant: number;
  /** How open to the sky it is, from 0 deep in the curtain to 1 on top of it. */
  exposure: number;
  /** How much snow lies on it, from 0 to 1, the most it holds. */
  snow: number;
  /** Whether it hangs in front of the wood or behind it. */
  front: boolean;
  /** The air moving past it, in meters per second, which streams and flutters its leaves. */
  air: Vec;
}

/** A leaf that came off its strand, in world units. */
export interface LeafView {
  x: number;
  y: number;
  /** The way it points from its stalk to its tip, in radians counterclockwise from +x. */
  angle: number;
  /** Its length. */
  size: number;
  /** The time of year it fell, which sets its color. */
  age: number;
  alpha: number;
  variant: number;
}

/** Every strand to draw and every leaf falling. */
export interface WillowView {
  /** Strands on the tree, then those that came off it. */
  strands: readonly StrandView[];
  leaves: readonly LeafView[];
  /** Seconds of simulated time, which set the leaves fluttering. */
  time: number;
}

/** What shift-clicking the tree would do to its strands. */
export interface StrandHover {
  /** The strand that would grow, drawn faintly where it would hang. */
  ghost: StrandView | undefined;
  /** The strand that would be knocked off. */
  target: StrandView | undefined;
}

/** Where along a limb a strand hangs, and from which side: 1 left, -1 right, 0 weeping from its tip. */
interface Spot {
  s: number;
  side: 1 | 0 | -1;
}

/** Where a strand leaves its wood, in meters, and the way it heads as it does. */
interface Base {
  x: number;
  y: number;
  heading: number;
}

/** How a strand arches over: how far it turns to hang straight down, and within what length. */
interface Arch {
  turn: number;
  reach: number;
}

/**
 * Leaves laid out so far for each strand's variant. Each strand's are laid out once, as far as it
 * has grown, and kept; cleared once this many strands' are.
 */
const layouts = new Map<number, Leaf[]>();
const LAYOUTS_LIMIT = 4000;

/**
 * The leaves along a strand of `variant`, laid out at least as far as `length` meters along it,
 * nearest the wood first. Each leaf's place along the strand never changes, so a strand growing
 * or shortening only gains or loses leaves at its tip.
 */
export function leavesOf(variant: number, length: number): readonly Leaf[] {
  let leaves = layouts.get(variant);
  if (leaves === undefined) {
    if (layouts.size >= LAYOUTS_LIMIT) {
      layouts.clear();
    }
    leaves = [];
    layouts.set(variant, leaves);
  }
  while (
    leaves.length === 0 ||
    at(leaves, leaves.length - 1).s < length + LEAVES.spacing
  ) {
    const k = leaves.length;
    const h = (n: number): number => hash(k * 11 + n, variant * 977);
    leaves.push({
      s: LEAVES.bare + LEAVES.spacing * (k + 0.7 * (h(0) - 0.5)),
      side: h(8) < 0.5 ? 1 : -1,
      size: 0.82 + 0.3 * h(1),
      angle: lerp(LEAVES.angle.from, LEAVES.angle.to, h(2)),
      curl: (h(3) - 0.5) * 0.9,
      turn: (h(4) - 0.5) * 2 * LEAVES.turns,
      drops: lerp(LEAVES.drops.from, LEAVES.drops.to, h(5)),
      catkin: h(6) < CATKINS.share,
      variant: h(7),
    });
  }
  return leaves;
}

/**
 * How much of its full size a leaf is along a strand grown `length` long of the `full` length it
 * grows to: smaller further down, and smaller still near a growing tip.
 */
export function leafSize(leaf: Leaf, length: number, full: number): number {
  const fromTip = length - leaf.s;
  return (
    leaf.size *
    lerp(1, LEAVES.tapered, clamp(leaf.s / Math.max(full, 1e-3), 0, 1)) *
    lerp(LEAVES.youngest, 1, smoothstep(0, LEAVES.young, fromTip))
  );
}

/** Whether `leaf` along a strand `length` long carries a catkin there. */
export function hasCatkin(leaf: Leaf, length: number): boolean {
  return leaf.catkin && leaf.s >= CATKINS.from && leaf.s <= CATKINS.to * length;
}

/** How many of a strand's leaves are still on it at the time of year `age`, from 0 bare to 1. */
export function leafiness(age: number): number {
  return clamp(
    (LEAVES.drops.to - age) / (LEAVES.drops.to - LEAVES.drops.from),
    0,
    1,
  );
}

/**
 * Every strand: those on the tree, hung by hand or by the tree itself, and those that came off and
 * are falling or lying on the ground; and the leaves that came off them.
 */
export class Willows {
  private strands: Strand[] = [];
  private fallen: Fallen[] = [];
  private drifting: Drifting[] = [];
  private time = 0;
  private readonly rng = new Rng(7919);
  /** Side of each limb the tree starts its strands on. */
  private readonly limbSides = new WeakMap<Limb, 1 | -1>();

  /** Removes every strand and leaf at once, as when a new tree is planted. */
  clear(): void {
    this.strands = [];
    this.fallen = [];
    this.drifting = [];
  }

  /** The strands on the tree, as catchers of falling snow, each as wide as its arch. */
  catchers(): Catcher[] {
    return this.strands
      .filter((strand) => showing(strand) && strand.nodes.length > 0)
      .map((strand) => {
        const size = catchSize(strand);
        const top = apexOf(strand);
        return {
          key: strand,
          x: top.x,
          y: top.y,
          radius: size / 2,
          exposure: strand.exposure,
          area: FLOWERS.area * size * size,
          take: (mass: number): number => {
            const taken = clamp(snowHeld(size) - strand.snow, 0, mass);
            strand.snow += taken;
            return taken;
          },
        };
      });
  }

  /** Where the strands in bloom are, in world units: among their catkins. */
  blooms(): Vec[] {
    return this.strands
      .filter(
        (strand) =>
          showing(strand) &&
          strand.grown >= 1 &&
          strand.opened >= BLOOMING &&
          strand.age < CATKINS.wither.to,
      )
      .map((strand) => pointAlong(strand.nodes, 0.35 * lengthOf(strand)));
  }

  /** The snow lying on the strands still on `tree`, which their limbs carry. */
  loads(tree: Tree): Load[] {
    return this.strands
      .filter(
        (strand) =>
          !strand.dropped &&
          strand.weight > 0 &&
          tree.has(strand.limb) &&
          strand.s <= strand.limb.length,
      )
      .map((strand) => ({
        limb: strand.limb,
        s: Math.min(strand.s, strand.limb.length),
        mass: strand.weight,
      }));
  }

  /** How many strands are showing on the tree, and how many have come off and not yet faded. */
  count(): { onTree: number; falling: number } {
    return {
      onTree: this.strands.filter(showing).length,
      falling: this.fallen.length,
    };
  }

  /**
   * Grows, opens, ages and swings the strands, sheds their leaves through autumn, tears loose any
   * the wind pulls too hard, and moves those that came off and the leaves that fell. With no
   * standing tree, every strand still on it falls.
   */
  update(
    dt: number,
    tree: Tree | undefined,
    settings: FlowerSettings,
    conditions: Conditions,
  ): void {
    this.time += dt;
    if (tree === undefined) {
      for (const strand of this.strands) {
        this.drop(strand, undefined, { x: 0, y: 0 });
      }
      this.strands = [];
    } else {
      if (settings.placement === "tree") {
        this.growOwn(tree);
      }
      this.tend(dt, tree, settings, conditions);
      this.swing(dt, tree, settings, conditions);
      this.expose(dt);
    }
    for (const strand of this.fallen) {
      settleFallen(
        strand,
        dt,
        conditions.wind,
        conditions.level,
        conditions.water,
      );
    }
    this.fallen = this.fallen.filter((strand) => strand.alpha > 0);
    for (const leaf of this.drifting) {
      drift(leaf, dt, conditions.wind, conditions.level, conditions.water);
    }
    this.drifting = this.drifting.filter((leaf) => leaf.alpha > 0);
  }

  /**
   * Hangs a strand by hand where `pick` lands: weeping from the limb's tip if that is near,
   * otherwise from the side clicked, moved out along the limb to where the wood is thin enough.
   * Returns false if no wood on the limb is thin enough.
   */
  place(pick: Pick): boolean {
    const spot = this.spot(pick);
    if (spot === undefined) {
      return false;
    }
    this.strands.push(this.strand("hand", pick.limb, spot));
    return true;
  }

  /**
   * Takes off every strand on what `tree` is about to lose when `limb` is cut at `s`: the limb
   * beyond the cut, and every offshoot forked from it past there. Each falls from where it hung,
   * carrying the motion of its wood, before the cut takes that wood away.
   */
  cut(tree: Tree, limb: Limb, s: number): void {
    const gone = new Set<Limb>();
    const collect = (part: Limb): void => {
      gone.add(part);
      part.children.forEach(collect);
    };
    if (s === 0) {
      collect(limb);
    } else {
      for (const child of limb.children) {
        if ((child.attachment?.s ?? 0) >= s) {
          collect(child);
        }
      }
    }
    const lost = this.strands.filter(
      (strand) =>
        gone.has(strand.limb) || (strand.limb === limb && strand.s > s),
    );
    for (const strand of lost) {
      this.drop(strand, tree, { x: 0, y: 0 });
    }
    this.strands = this.strands.filter((strand) => !lost.includes(strand));
  }

  /** Knocks off the hand-hung strand drawn under (x, y), if any. Returns whether there was one. */
  knockOff(tree: Tree, x: number, y: number, reach: number): boolean {
    const strand = this.strandAt(tree, x, y, reach);
    if (strand === undefined) {
      return false;
    }
    this.drop(strand, tree, { x: 0, y: 0 });
    this.strands.splice(this.strands.indexOf(strand), 1);
    return true;
  }

  /**
   * What shift-clicking at (x, y), over `pick`, would do, with the strands drawn as they look at
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
    water: Water,
  ): StrandHover {
    const target = this.strandAt(tree, x, y, reach);
    if (target !== undefined) {
      return {
        ghost: undefined,
        target: strandView(target, ageOf(target.traits, season)),
      };
    }
    const spot = pick === undefined ? undefined : this.spot(pick);
    if (pick === undefined || spot === undefined) {
      return { ghost: undefined, target: undefined };
    }
    const base = baseOf(pick.limb, spot.s, spot.side, TYPICAL.tilt, false);
    const length = fullLength(
      TYPICAL,
      settings,
      roomBelow(base, tree.level, water),
    );
    const nodes = chain(length);
    layRest(base, archOf(base.heading, length), nodes, length);
    return {
      ghost: {
        points: nodes.map((node) => ({ x: node.rx, y: node.ry })),
        along: nodes.map((node) => node.s),
        length,
        full: length,
        root: rootOf(pick.limb, spot),
        age: season,
        openness: 1,
        alpha: 0.45,
        variant: TYPICAL.variant,
        exposure: 1,
        snow: 0,
        front: true,
        air: { x: 0, y: 0 },
      },
      target: undefined,
    };
  }

  /** Every strand to draw, as it looks at this `season`, and every leaf falling. */
  views(season: number): WillowView {
    const strands: StrandView[] = this.strands
      .filter((strand) => showing(strand) && strand.nodes.length > 0)
      .map((strand) => strandView(strand, ageOf(strand.traits, season)));
    for (const strand of this.fallen) {
      strands.push({
        points: strand.nodes.map((node) => ({ x: node.x, y: node.y })),
        along: strand.nodes.map((node) => node.s),
        length: lastOf(strand.nodes).s,
        full: strand.full,
        root: strand.root,
        age: strand.age,
        openness: strand.openness,
        alpha: strand.alpha,
        variant: strand.traits.variant,
        exposure: 1,
        snow: 0,
        front: true,
        air: { x: 0, y: 0 },
      });
    }
    return {
      strands,
      leaves: this.drifting.map((leaf) => ({
        x: leaf.x,
        y: leaf.y,
        angle: leaf.angle,
        size: leaf.size,
        age: leaf.age,
        alpha: leaf.alpha,
        variant: leaf.variant,
      })),
      time: this.time,
    };
  }

  private strand(placement: FlowerPlacement, limb: Limb, spot: Spot): Strand {
    return {
      placement,
      limb,
      side: spot.side,
      girth: spot.side === 0 ? 0 : limb.radiusAt(spot.s),
      traits: {
        share: lerp(
          STRANDS.share.from,
          STRANDS.share.to,
          this.rng.next() ** 0.7,
        ),
        tilt: (this.rng.next() - 0.5) * 0.5,
        opening: STRANDS.opening * (0.8 + 0.45 * this.rng.next()),
        hold: Math.exp(FLOWERS.holdSpread * this.normal()),
        early: (this.rng.next() - 0.5) * 0.08,
        front: this.rng.next() < 0.5,
        variant: this.rng.next(),
      },
      s: spot.s,
      full: 0,
      grown: 0,
      opened: 0,
      damage: 0,
      dropped: false,
      regrowIn: 0,
      exposure: 1,
      crowded: false,
      snow: 0,
      weight: 0,
      age: 0,
      nodes: [],
      air: { x: 0, y: 0 },
    };
  }

  /** Where a strand hung by hand at `pick` would hang, or nothing if the wood is too thick for it. */
  private spot(pick: Pick): Spot | undefined {
    const { limb } = pick;
    const thin = thinFrom(limb, STRANDS.maxGirth);
    if (thin === undefined) {
      return undefined;
    }
    const s = Math.max(pick.s, thin);
    if (limb.length - s < STRANDS.tipReach) {
      return { s: limb.length, side: 0 };
    }
    return { s, side: pick.side };
  }

  /**
   * The tree's own strands: one weeping from the tip of each limb long enough, and more spaced back
   * along the thin wood behind it, alternating sides, as far as the wood stays thin enough.
   */
  private growOwn(tree: Tree): void {
    for (const limb of tree.limbs) {
      if (limb.length < STRANDS.firstBloom) {
        continue;
      }
      const own = this.strands.filter(
        (strand) => strand.placement === "tree" && strand.limb === limb,
      );
      let side = this.firstSide(limb);
      for (let slot = 0; ; slot += 1) {
        const s = limb.length - slot * STRANDS.spacing;
        if (s < STRANDS.clearOfBase || limb.radiusAt(s) > STRANDS.maxGirth) {
          break;
        }
        const spot: Spot = { s, side: slot === 0 ? 0 : side };
        if (slot > 0) {
          side = side === 1 ? -1 : 1;
        }
        const taken = own.some((strand) =>
          spot.side === 0
            ? strand.side === 0
            : strand.side !== 0 &&
              Math.abs(strand.s - s) < 0.75 * STRANDS.spacing,
        );
        if (!taken) {
          const placed: Spot =
            spot.side === 0
              ? spot
              : {
                  s: Math.min(
                    limb.length,
                    s + this.rng.next() * STRANDS.jitter * STRANDS.spacing,
                  ),
                  side: spot.side,
                };
          const strand = this.strand("tree", limb, placed);
          this.strands.push(strand);
          own.push(strand);
        }
      }
    }
  }

  /**
   * Grows and opens the strands on the tree, lets go of the leaves the year takes, settles their
   * snow, and lets the wind tear them loose.
   */
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
    let shedding = SHED.perStep;
    const kept: Strand[] = [];
    const before = new Map<Strand, number>();
    for (const strand of this.strands) {
      const s = position(strand, tree);
      // Its wood is gone, cut or broken off, or has grown too thick for it.
      if (s === undefined) {
        this.drop(strand, tree, { x: 0, y: 0 });
        continue;
      }
      // It was crowded off its wood and has withered away, or came off the tree as it did.
      if (strand.crowded && (strand.grown <= 0 || strand.dropped)) {
        continue;
      }
      before.set(strand, strand.s);
      strand.s = s;
      if (strand.dropped) {
        strand.regrowIn -= dt;
        if (strand.regrowIn <= 0) {
          regrow(strand);
        }
        kept.push(strand);
        continue;
      }
      const shown = strand.placement === settings.placement && !strand.crowded;
      strand.grown = clamp(
        strand.grown + dt / (shown ? STRANDS.growIn : -STRANDS.shrink),
        0,
        1,
      );
      // Withered away, it grows back from where it would hang then, not where it last hung.
      if (strand.grown <= 0) {
        strand.nodes = [];
      }
      strand.opened = clamp(strand.opened + dt / strand.traits.opening, 0, 1);
      const age = ageOf(strand.traits, conditions.season);
      if (strand.nodes.length > 0) {
        shedding -= this.shed(strand, strand.age, age, shedding);
      }
      strand.age = age;
      // The snow it caught melts, and any more than it holds as it withers or sheds falls away.
      const snow = Math.min(
        snowHeld(catchSize(strand)),
        strand.snow * Math.exp(-conditions.melt * dt),
      );
      strand.snow = snow < strand.snow && snow < SNOW.trace ? 0 : snow;
      const weight = approach(strand.weight, strand.snow, SNOW.settling, dt);
      strand.weight = strand.snow === 0 && weight < SNOW.trace ? 0 : weight;
      const torn =
        strand.grown > 0
          ? this.weather(strand, dt, conditions.hold * fed(strand.limb))
          : undefined;
      if (torn !== undefined) {
        this.drop(strand, tree, torn);
        if (strand.placement === "hand") {
          continue;
        }
        strand.dropped = true;
        strand.regrowIn = STRANDS.regrow;
      }
      kept.push(strand);
    }
    this.strands = kept;
    this.uncrowd(before);
    if (shedding > 0) {
      this.blowOff(dt, shedding);
    }
  }

  /**
   * Lets go of the leaves of `strand` that drop between the times of year `from` and `to`, as many
   * as `room` allows, falling from where they hang. The rest simply go. Returns how many fell.
   */
  private shed(strand: Strand, from: number, to: number, room: number): number {
    if (to <= from) {
      return 0;
    }
    const length = lengthOf(strand);
    let fell = 0;
    for (const leaf of leavesOf(strand.traits.variant, length)) {
      if (leaf.s > length) {
        break;
      }
      const drops = leaf.drops;
      if (drops <= from || drops > to) {
        continue;
      }
      if (fell >= room || this.drifting.length >= SHED.most) {
        break;
      }
      this.let(strand, leaf, length, drops);
      fell += 1;
    }
    return fell;
  }

  /**
   * In a gale, leaves blow off the strands in full leaf, up to `room` of them this step. They are
   * spares: a strand keeps the leaves it is drawn with.
   */
  private blowOff(dt: number, room: number): void {
    let left = room;
    for (const strand of this.strands) {
      if (left <= 0 || this.drifting.length >= SHED.most) {
        return;
      }
      if (!showing(strand) || strand.grown < 1) {
        continue;
      }
      const speed = Math.hypot(strand.air.x, strand.air.y);
      const past = speed - SHED.from;
      const rate =
        past > 0 ? SHED.gale * past * past * leafiness(strand.age) : 0;
      if (rate <= 0 || this.rng.next() > rate * dt) {
        continue;
      }
      const length = lengthOf(strand);
      const leaves = leavesOf(strand.traits.variant, length).filter(
        (leaf) => leaf.s <= length && leaf.drops > strand.age,
      );
      if (leaves.length === 0) {
        continue;
      }
      const leaf = at(leaves, Math.floor(this.rng.next() * leaves.length));
      this.let(strand, leaf, length, strand.age);
      left -= 1;
    }
  }

  /** Lets `leaf` of `strand` go at the time of year `age`, from where it hangs, with the air around it. */
  private let(strand: Strand, leaf: Leaf, length: number, age: number): void {
    const at = pointAlong(strand.nodes, leaf.s);
    const ahead = pointAlong(strand.nodes, Math.min(length, leaf.s + 0.02));
    const heading = Math.atan2(ahead.y - at.y, ahead.x - at.x);
    this.drifting.push({
      x: at.x,
      y: at.y,
      vx: 0.5 * strand.air.x,
      vy: 0.5 * strand.air.y,
      angle: heading - leaf.side * leaf.angle,
      spin: (this.rng.next() - 0.5) * 3,
      phase: this.rng.next() * Math.PI * 2,
      size: LEAVES.length * leafSize(leaf, length, strand.full),
      age,
      variant: leaf.variant,
      resting: 0,
      floating: false,
      alpha: 1,
    });
  }

  /**
   * Marks as crowded every strand that rode up its limb since `before` to nearer than it may hang
   * behind the next strand along the same side, so it withers away. Each keeps to wood as thin as
   * it grew on, so when an offshoot thickens the wood below its fork, every strand there rides up
   * into the thin wood past it; without this they would bunch there.
   */
  private uncrowd(before: ReadonlyMap<Strand, number>): void {
    const rows = new Map<Limb, Map<string, Strand[]>>();
    for (const strand of this.strands) {
      if (strand.side === 0 || strand.crowded) {
        continue;
      }
      let sides = rows.get(strand.limb);
      if (sides === undefined) {
        sides = new Map();
        rows.set(strand.limb, sides);
      }
      const key = `${strand.side} ${strand.placement}`;
      const row = sides.get(key);
      if (row === undefined) {
        sides.set(key, [strand]);
      } else {
        row.push(strand);
      }
    }
    const was = (strand: Strand): number => {
      const s = before.get(strand);
      invariant(s !== undefined, "Every strand kept had a place before.");
      return s;
    };
    for (const sides of rows.values()) {
      for (const row of sides.values()) {
        // From the tip back, so a strand riding up goes rather than the one it rode into.
        row.sort((a, b) => b.s - a.s);
        let ahead: Strand | undefined;
        for (const strand of row) {
          if (ahead !== undefined) {
            const gap = ahead.s - strand.s;
            const closing = gap < was(ahead) - was(strand) - 1e-6;
            if (closing && gap < STRANDS.crowded * STRANDS.spacing) {
              strand.crowded = true;
              continue;
            }
          }
          ahead = strand;
        }
      }
    }
  }

  /**
   * Lets the wind pull on a strand: its twig tears loose under a pull past what it holds for long
   * enough. `hold` multiplies how hard it holds. Returns the push the wind gives a strand it tears
   * loose.
   */
  private weather(strand: Strand, dt: number, hold: number): Vec | undefined {
    const speed = Math.hypot(strand.air.x, strand.air.y);
    // Drag grows with the square of the wind's speed, and with how much leaf the strand carries.
    const drag = lerp(SWING.bareDrag, SWING.drag, leafiness(strand.age));
    const holds =
      STRANDS.holdSpeed *
      Math.sqrt((strand.traits.hold * hold * SWING.drag) / drag);
    const pull = (speed / holds) ** 2;
    if (pull > 1) {
      strand.damage +=
        dt * (FLOWERS.damageAtLimit + FLOWERS.damagePerOverload * (pull - 1));
    } else {
      strand.damage = Math.max(0, strand.damage - dt * FLOWERS.healing);
    }
    return strand.damage < 1
      ? undefined
      : { x: 0.3 * strand.air.x, y: 0.3 * strand.air.y };
  }

  /**
   * Swings every strand on the tree: each hangs from where it leaves its wood as the wood moves,
   * lengthens to the room it has, and is pulled by its weight and the air moving past it.
   */
  private swing(
    dt: number,
    tree: Tree,
    settings: FlowerSettings,
    conditions: Conditions,
  ): void {
    const steps = Math.max(1, Math.ceil(dt / SWING.step));
    const h = dt / steps;
    for (const strand of this.strands) {
      if (!showing(strand)) {
        continue;
      }
      const rest = baseOf(
        strand.limb,
        strand.s,
        strand.side,
        strand.traits.tilt,
        true,
      );
      const room = Math.max(
        STRANDS.shortest,
        roomBelow(rest, tree.level, conditions.water),
      );
      const full = fullLength(strand.traits, settings, room);
      strand.full =
        strand.full === 0
          ? full
          : approach(strand.full, full, STRANDS.settle, dt);
      const length = lengthOf(strand);
      const base = baseOf(
        strand.limb,
        strand.s,
        strand.side,
        strand.traits.tilt,
        false,
      );
      const arch = archOf(base.heading, length);
      if (strand.nodes.length === 0) {
        strand.nodes = chain(length);
        layRest(base, arch, strand.nodes, length);
        for (const node of strand.nodes) {
          node.x = node.rx;
          node.y = node.ry;
        }
      }
      stretch(strand.nodes, length);
      const root = at(strand.nodes, 0);
      const from = { x: root.x, y: root.y };
      const stiff = arch.reach * 1.25;
      layRest(base, arch, strand.nodes, stiff);
      for (const node of strand.nodes) {
        node.k =
          node.s < stiff
            ? SWING.stiffness * (1 - smoothstep(0, stiff, node.s)) ** 2
            : 0;
      }
      const middle = pointAlong(strand.nodes, 0.5 * length);
      strand.air = conditions.wind.at(
        middle.x,
        middle.y,
        3000 + strand.traits.variant * 100,
      );
      blow(strand.nodes, strand.air, this.time, strand.traits.variant);
      const drag = lerp(SWING.bareDrag, SWING.drag, leafiness(strand.age));
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        const x = lerp(from.x, base.x, t);
        const y = lerp(from.y, base.y, t);
        step(
          strand.nodes,
          h,
          x,
          y,
          (base.x - from.x) / dt,
          (base.y - from.y) / dt,
          drag,
        );
      }
      ground(strand.nodes, tree.level);
    }
  }

  /**
   * Follows how open to the sky each strand on the tree is: the more of the others hang above it,
   * over its arch, the less. It follows slowly, so a strand does not flicker as the curtain sways.
   */
  private expose(dt: number): void {
    const shown = this.strands.filter(
      (strand) => showing(strand) && strand.nodes.length > 0,
    );
    const tops = shown.map(apexOf);
    const order = tops
      .map((_, i) => i)
      .sort((a, b) => at(tops, a).x - at(tops, b).x);
    const reach = STRANDS.reach;
    let first = 0;
    for (const i of order) {
      const a = at(tops, i);
      while (at(tops, at(order, first)).x < a.x - reach) {
        first += 1;
      }
      let cover = 0;
      for (let k = first; k < order.length; k += 1) {
        const b = at(tops, at(order, k));
        if (b.x > a.x + reach) {
          break;
        }
        const across = Math.abs(b.x - a.x);
        const above = b.y - a.y;
        if (above > 0 && above < 6 * reach && across < reach) {
          cover += 1 - across / reach;
        }
      }
      const strand = at(shown, i);
      strand.exposure = approach(strand.exposure, Math.exp(-cover / 5), 1, dt);
    }
  }

  /**
   * Takes a strand off the tree. One that was showing falls, carrying the motion of the wood it hung
   * from plus `push`, its chain as it hung.
   */
  private drop(strand: Strand, tree: Tree | undefined, push: Vec): void {
    strand.snow = 0;
    strand.weight = 0;
    if (strand.dropped || strand.grown <= 0.05 || strand.nodes.length === 0) {
      strand.grown = 0;
      strand.nodes = [];
      return;
    }
    const root = at(strand.nodes, 0);
    const motion =
      tree !== undefined && tree.has(strand.limb)
        ? tree.physics.velocityAt(strand.limb, strand.s, root.x, root.y)
        : { x: 0, y: 0, spin: 0 };
    const nodes = strand.nodes.map((node) => ({
      ...node,
      vx: node.vx + motion.x + push.x,
      vy: node.vy + motion.y + push.y,
      k: 0,
    }));
    this.fallen.push({
      traits: strand.traits,
      full: strand.full,
      age: strand.age,
      openness: strand.opened,
      root: rootOf(strand.limb, strand),
      nodes,
      resting: 0,
      floating: false,
      alpha: 1,
    });
    strand.grown = 0;
    strand.nodes = [];
  }

  /** The hand-hung strand drawn under (x, y), within `reach` of its twig, nearest first. */
  private strandAt(
    tree: Tree,
    x: number,
    y: number,
    reach: number,
  ): Strand | undefined {
    let nearest: { strand: Strand; distance: number } | undefined;
    for (const strand of this.strands) {
      if (
        strand.placement !== "hand" ||
        !showing(strand) ||
        strand.nodes.length === 0 ||
        !tree.has(strand.limb)
      ) {
        continue;
      }
      const distance = distanceTo(strand.nodes, x, y);
      if (
        distance <= Math.max(LEAVES.length, reach) &&
        (nearest === undefined || distance < nearest.distance)
      ) {
        nearest = { strand, distance };
      }
    }
    return nearest?.strand;
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

/** Whether a strand is on the tree and showing. */
function showing(strand: Strand): boolean {
  return !strand.dropped && strand.grown > 0;
}

/** How a strand on the tree is drawn, at the time of year `age`. */
function strandView(strand: Strand, age: number): StrandView {
  return {
    points: strand.nodes.map((node) => ({ x: node.x, y: node.y })),
    along: strand.nodes.map((node) => node.s),
    length: lengthOf(strand),
    full: strand.full,
    root: rootOf(strand.limb, strand),
    age,
    openness: strand.opened,
    alpha: 1,
    variant: strand.traits.variant,
    exposure: strand.exposure,
    snow:
      strand.snow > 0
        ? Math.min(1, strand.snow / snowHeld(catchSize(strand)))
        : 0,
    front: strand.traits.front,
    air: strand.air,
  };
}

/** How long a strand is now, in meters, as far as it has grown in. */
function lengthOf(strand: Strand): number {
  return Math.max(0.03, strand.full * smoothstep(0, 1, strand.grown));
}

/**
 * How long a strand with `traits` grows at the size multiplier in `settings`, hanging from wood with
 * `room` meters below it: the higher it hangs, the further it drapes, and never into the ground.
 */
function fullLength(
  traits: Traits,
  settings: FlowerSettings,
  room: number,
): number {
  const longest = Math.max(STRANDS.length, STRANDS.drape * room);
  return clamp(
    longest * settings.size ** STRANDS.lengthGrowth * traits.share,
    STRANDS.shortest,
    Math.max(STRANDS.shortest, room),
  );
}

/** Radius of a strand's twig where it leaves its wood: no more than half as stout as the wood. */
function rootOf(limb: Limb, spot: { s: number; side: 1 | 0 | -1 }): number {
  return spot.side === 0
    ? Math.min(STRANDS.twig.root * 1.4, limb.radiusAt(limb.length))
    : Math.min(
        STRANDS.twig.root,
        0.5 * limb.radiusAt(Math.min(spot.s, limb.length)),
      );
}

/**
 * Across a strand where it catches snow, in meters: its arch, and its leaves while it has them,
 * though hanging leaves shed most of what lands on them.
 */
function catchSize(strand: Strand): number {
  return (
    STRANDS.reach *
    (0.4 + 0.3 * leafiness(strand.age)) *
    smoothstep(0, 1, strand.grown)
  );
}

/** Most snow a strand `size` across holds, in kilograms. */
function snowHeld(size: number): number {
  return SNOW.flowerHold * size * size;
}

/** Brings back a strand the wind took, as a shoot that grows in. */
function regrow(strand: Strand): void {
  strand.dropped = false;
  strand.snow = 0;
  strand.weight = 0;
  strand.grown = 0;
  strand.opened = 0;
  strand.damage = 0;
  strand.nodes = [];
}

/** The time of year a strand shows: the season, a little early or late for each strand. */
function ageOf(traits: Traits, season: number): number {
  return clamp(season + traits.early, 0, 1);
}

/**
 * Where along its limb a strand hangs now, or nothing if the wood it grew on is gone or no longer
 * thin enough for it.
 */
function position(strand: Strand, tree: Tree): number | undefined {
  const { limb } = strand;
  if (!tree.has(limb) || limb.length < strand.s - 1e-9) {
    return undefined;
  }
  if (strand.side === 0) {
    return limb.radiusAt(limb.length) <= STRANDS.maxGirth
      ? limb.length
      : undefined;
  }
  return thinFrom(limb, strand.girth);
}

/**
 * Where a strand at `s` along `limb` leaves its wood, turned `tilt` off its usual angle, and the
 * way it heads: posed as the limb is drawn, or as it grew if `rest`.
 */
function baseOf(
  limb: Limb,
  s: number,
  side: 1 | 0 | -1,
  tilt: number,
  rest: boolean,
): Base {
  const p = rest ? limb.restPointAt(s) : limb.pointAt(s);
  if (side === 0) {
    return { x: p.x, y: p.y, heading: p.heading + tilt };
  }
  const normal = p.heading + (side * Math.PI) / 2;
  const leave = turnToward(normal, p.heading, ARCH.lean);
  // From the top of a limb it heads up before it arches over; from beneath, it simply hangs.
  const up = 0.5 + 0.5 * Math.sin(normal);
  const heading = turnToward(leave, UPRIGHT, ARCH.skyward * up) + tilt;
  const from = along(p, normal, ARCH.inset * limb.radiusAt(s));
  return { x: from.x, y: from.y, heading };
}

/**
 * How far a strand hanging from `base` can reach down before it nears `level`'s ground, or the
 * surface of `water` where there is water below it, in meters.
 */
function roomBelow(base: Vec, level: Level, water: Water): number {
  const sea = water.surfaceAt(base.x);
  const floor = Math.max(level.groundAt(base.x), sea ?? -Infinity);
  return base.y - floor - STRANDS.clearance;
}

/**
 * How a strand leaving the wood heading `heading` arches over to hang straight down: turning over
 * the way it heads out, and more slowly the further it turns, but within the first part of a strand
 * `length` long, so a short one sticks out before it has grown enough to weep.
 */
function archOf(heading: number, length: number): Arch {
  const h = wrapAngle(heading);
  const turn = h > Math.PI / 2 ? 1.5 * Math.PI - h : -Math.PI / 2 - h;
  return {
    turn,
    reach: Math.max(
      1e-3,
      Math.min((ARCH.reach * Math.abs(turn)) / Math.PI, 0.6 * length),
    ),
  };
}

/** A strand's chain for `length`, its nodes laid at the base until they swing. */
function chain(length: number): Node[] {
  const nodes: Node[] = [];
  for (let i = 0; i <= SWING.segments; i += 1) {
    nodes.push({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      px: 0,
      py: 0,
      cx: 0,
      cy: 0,
      ax: 0,
      ay: 0,
      rx: 0,
      ry: 0,
      k: 0,
      lean: 0,
      s: 0,
      link: 0,
    });
  }
  stretch(nodes, length);
  return nodes;
}

/** Spaces a strand's nodes along `length`, crowded toward the wood where it arches. */
function stretch(nodes: Node[], length: number): void {
  let before = 0;
  for (const [i, node] of nodes.entries()) {
    node.s = length * (i / SWING.segments) ** SWING.crowding;
    node.link = node.s - before;
    before = node.s;
  }
}

/**
 * Lays where the arch from `base` holds each node of `nodes`, as far as `upTo` meters along the
 * strand: heading out, turning over within the arch, and on straight down past it.
 */
function layRest(base: Base, arch: Arch, nodes: Node[], upTo: number): void {
  let x = base.x;
  let y = base.y;
  let s = 0;
  const down = base.heading + arch.turn;
  for (const node of nodes) {
    if (node.s > upTo + 1e-9) {
      return;
    }
    while (s < node.s - 1e-9) {
      if (s >= arch.reach) {
        x += Math.cos(down) * (node.s - s);
        y += Math.sin(down) * (node.s - s);
        s = node.s;
        break;
      }
      const run = Math.min(ARCH.step, node.s - s);
      const heading =
        base.heading + arch.turn * smoothstep(0, arch.reach, s + run / 2);
      x += Math.cos(heading) * run;
      y += Math.sin(heading) * run;
      s += run;
    }
    node.rx = x;
    node.ry = y;
  }
}

/**
 * Sets the air moving past each node of a strand: the wind at its middle, `air`, gusting and turning
 * across in waves that run down the strand, so it ripples rather than swinging stiffly; and the
 * push that gives the strand a gentle curve of its own.
 */
function blow(nodes: Node[], air: Vec, time: number, variant: number): void {
  const speed = Math.hypot(air.x, air.y);
  if (speed === 0) {
    for (const node of nodes) {
      node.ax = 0;
      node.ay = 0;
      node.lean =
        SWING.lean * valueNoise(node.s / SWING.bend + variant * 53, 9);
    }
    return;
  }
  const along = { x: air.x / speed, y: air.y / speed };
  const rate = 0.6 + 0.08 * speed;
  for (const node of nodes) {
    node.lean = SWING.lean * valueNoise(node.s / SWING.bend + variant * 53, 9);
    const phase = time * rate * 2 - node.s * 1.4 + variant * 37;
    const gust = 1 + SWING.gust * valueNoise(phase, 5);
    const eddy = SWING.eddy * valueNoise(phase * 1.7 + 11, 6);
    node.ax = speed * (along.x * gust - along.y * eddy);
    node.ay = speed * (along.y * gust + along.x * eddy);
  }
}

/**
 * Steps a strand's chain on by `h` seconds, its first node held at (x, y) moving at (vx, vy), with
 * `drag` per square of the speed of the air past it. Each node is pulled by its weight, the air and
 * the arch, then put back its link's length from the node before it, following the leader down the
 * chain; the distance each was put back by carries into the speed of the node before it, which
 * keeps the chain from stretching without stiffening it.
 */
function step(
  nodes: Node[],
  h: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
  drag: number,
): void {
  for (const [i, node] of nodes.entries()) {
    if (i === 0) {
      node.x = x;
      node.y = y;
      node.px = x;
      node.py = y;
      node.vx = vx;
      node.vy = vy;
      continue;
    }
    const wx = node.ax - node.vx;
    const wy = node.ay - node.vy;
    const past = Math.hypot(wx, wy);
    let ax = drag * past * wx - SWING.damping * node.vx + node.lean;
    let ay = drag * past * wy - SWING.damping * node.vy - PHYSICS.gravity;
    if (node.k > 0) {
      const damping = 2 * SWING.stiffDamping * Math.sqrt(node.k);
      ax += node.k * (node.rx - node.x) - damping * (node.vx - vx);
      ay += node.k * (node.ry - node.y) - damping * (node.vy - vy);
    }
    node.vx += h * ax;
    node.vy += h * ay;
    node.px = node.x + h * node.vx;
    node.py = node.y + h * node.vy;
  }
  let parent: Node | undefined;
  for (const node of nodes) {
    if (parent !== undefined) {
      const dx = node.px - parent.px;
      const dy = node.py - parent.py;
      const d = Math.hypot(dx, dy);
      // A node pushed onto the one before it keeps the way its link last pointed.
      const ux =
        d > 1e-9 ? dx / d : (node.x - parent.x) / Math.max(node.link, 1e-9);
      const uy =
        d > 1e-9 ? dy / d : (node.y - parent.y) / Math.max(node.link, 1e-9);
      const tx = parent.px + ux * node.link;
      const ty = parent.py + uy * node.link;
      node.cx = tx - node.px;
      node.cy = ty - node.py;
      node.px = tx;
      node.py = ty;
    }
    parent = node;
  }
  parent = undefined;
  for (const [i, node] of nodes.entries()) {
    if (i > 0) {
      node.vx = (node.px - node.x) / h;
      node.vy = (node.py - node.y) / h;
      node.x = node.px;
      node.y = node.py;
      if (parent !== undefined && i > 1) {
        parent.vx -= (SWING.follow * node.cx) / h;
        parent.vy -= (SWING.follow * node.cy) / h;
      }
    }
    parent = node;
  }
}

/** Keeps every node of a strand above `level`'s ground, dragging along it any that touch it. */
function ground(nodes: Node[], level: Level): void {
  for (const node of nodes) {
    const floor = level.groundAt(node.x) + 0.02;
    if (node.y < floor) {
      node.y = floor;
      node.vx *= 0.6;
      node.vy = Math.max(0, node.vy);
    }
  }
}

/** The last node of a chain. */
function lastOf(nodes: readonly Node[]): Node {
  return at(nodes, nodes.length - 1);
}

/** The point `s` meters along a strand's chain, from where it leaves the wood. */
function pointAlong(nodes: readonly Node[], s: number): Vec {
  let parent: Node | undefined;
  for (const node of nodes) {
    if (parent !== undefined && node.s >= s) {
      const t = node.link > 1e-9 ? (s - parent.s) / node.link : 1;
      return { x: lerp(parent.x, node.x, t), y: lerp(parent.y, node.y, t) };
    }
    parent = node;
  }
  const last = lastOf(nodes);
  return { x: last.x, y: last.y };
}

/** The highest point of a strand's chain, where its arch catches the light and the snow. */
function apexOf(strand: Strand): Vec {
  let top = at(strand.nodes, 0);
  for (const node of strand.nodes) {
    if (node.y > top.y) {
      top = node;
    }
  }
  return { x: top.x, y: top.y };
}

/** How far (x, y) is from the nearest point of a strand's chain. */
function distanceTo(nodes: readonly Node[], x: number, y: number): number {
  let nearest = Infinity;
  let parent: Node | undefined;
  for (const node of nodes) {
    if (parent !== undefined) {
      const dx = node.x - parent.x;
      const dy = node.y - parent.y;
      const lengthSq = dx * dx + dy * dy;
      const t =
        lengthSq > 0
          ? clamp(((x - parent.x) * dx + (y - parent.y) * dy) / lengthSq, 0, 1)
          : 0;
      nearest = Math.min(
        nearest,
        Math.hypot(x - (parent.x + dx * t), y - (parent.y + dy * t)),
      );
    }
    parent = node;
  }
  return nearest;
}

/**
 * Moves a strand that came off the tree: its chain falls, dragged by the air so it flutters down,
 * lands and lies along `level`'s ground and fades, or floats on `water` along its surface.
 */
function settleFallen(
  strand: Fallen,
  dt: number,
  wind: Wind,
  level: Level,
  water: Water,
): void {
  const steps = Math.max(1, Math.ceil(dt / SWING.step));
  const h = dt / steps;
  const head = at(strand.nodes, 0);
  const middle = pointAlong(strand.nodes, 0.5 * lastOf(strand.nodes).s);
  const air = wind.at(middle.x, middle.y, 4000 + strand.traits.variant * 100);
  for (const node of strand.nodes) {
    node.ax = air.x;
    node.ay = air.y;
  }
  const drag = lerp(SWING.bareDrag, SWING.drag, leafiness(strand.age));
  for (let i = 0; i < steps; i += 1) {
    // Loose, its first node moves as freely as the rest, and the chain follows it.
    const wx = head.ax - head.vx;
    const wy = head.ay - head.vy;
    const past = Math.hypot(wx, wy);
    head.vx += h * (drag * past * wx - SWING.damping * head.vx);
    head.vy +=
      h * (drag * past * wy - SWING.damping * head.vy - PHYSICS.gravity);
    step(
      strand.nodes,
      h,
      head.x + h * head.vx,
      head.y + h * head.vy,
      head.vx,
      head.vy,
      drag,
    );
  }
  let wet = 0;
  let down = 0;
  for (const node of strand.nodes) {
    const sea = water.surfaceAt(node.x);
    const floor = level.groundAt(node.x) + 0.02;
    if (sea !== undefined && sea > floor && node.y <= sea) {
      if (!strand.floating) {
        const speed = Math.hypot(node.vx, node.vy);
        if (speed > FALLEN.splash) {
          water.splash(node.x, speed, 0.3);
        }
        strand.floating = true;
      }
      const flow = water.flowAt(node.x, sea);
      node.y = sea;
      node.vx = flow.x + 0.03 * air.x;
      node.vy = 0;
      wet += 1;
    } else if (node.y < floor) {
      node.y = floor;
      node.vx *= 0.5;
      node.vy = Math.max(0, node.vy);
      down += 1;
    }
  }
  const count = strand.nodes.length;
  if (wet + down >= count / 2) {
    strand.resting += dt;
  }
  const linger = wet > down ? FALLEN.floating : FALLEN.linger;
  if (strand.resting > linger) {
    strand.alpha = Math.max(0, strand.alpha - dt / FALLEN.fade);
  }
}

/**
 * Moves a leaf that came off its strand through the air, rocking side to side and spinning as it
 * falls, and lets it settle on `level`'s ground and fade, or float on `water`. Ground too steep to
 * rest on it slides down instead.
 */
function drift(
  leaf: Drifting,
  dt: number,
  wind: Wind,
  level: Level,
  water: Water,
): void {
  const sea = water.surfaceAt(leaf.x);
  if (sea !== undefined && (leaf.floating || leaf.y <= sea)) {
    leaf.floating = true;
    const flow = water.flowAt(leaf.x, sea);
    const air = wind.at(leaf.x, sea, 5000 + leaf.variant * 100);
    leaf.x += dt * (flow.x + 0.04 * air.x);
    leaf.y = sea;
    const flat = Math.round(leaf.angle / Math.PI) * Math.PI;
    leaf.angle = approach(leaf.angle, flat, 0.4, dt);
    leaf.resting += dt;
    if (leaf.resting > DRIFT.floating) {
      leaf.alpha = Math.max(0, leaf.alpha - dt / DRIFT.fade);
    }
    return;
  }
  leaf.floating = false;
  const floor = level.groundAt(leaf.x) + 0.004;
  const slope = slopeAt(level, leaf.x);
  if (leaf.resting === 0 && leaf.y <= floor && Math.abs(slope) > STEEP) {
    leaf.y = floor;
    leaf.vx = -Math.sign(slope) * DRIFT.tumble;
    leaf.vy = Math.max(0, leaf.vy);
  } else if (leaf.resting > 0 || leaf.y <= floor) {
    leaf.resting += dt;
    leaf.y = floor;
    const flat = Math.round(leaf.angle / Math.PI) * Math.PI;
    leaf.angle = approach(leaf.angle, flat, 0.3, dt);
    if (leaf.resting > DRIFT.linger) {
      leaf.alpha = Math.max(0, leaf.alpha - dt / DRIFT.fade);
    }
    return;
  }
  const air = wind.at(leaf.x, leaf.y, 5000 + leaf.variant * 100);
  leaf.phase += dt * (3 + 2 * leaf.variant);
  leaf.vx +=
    dt *
    ((air.x - leaf.vx) * DRIFT.airGrip + DRIFT.sway * Math.sin(leaf.phase));
  // A leaf falls slowly, gliding back and forth on the air.
  leaf.vy += dt * ((air.y - leaf.vy) * DRIFT.airGrip - 0.55 * PHYSICS.gravity);
  leaf.spin = approach(leaf.spin, 2.4 * Math.cos(leaf.phase), 0.3, dt);
  leaf.x += dt * leaf.vx;
  leaf.y += dt * leaf.vy;
  leaf.angle += dt * leaf.spin;
}
