import { invariant, smoothstep } from "./util";

/** The levels a tree can be grown in. */
export type LevelId = "meadow" | "farm" | "cliff";

/**
 * The sea a level's land runs down into, off to its right: how high it stands at mid tide, how far
 * the tide carries it above and below that, and where along the land to look for the water's edge
 * from, out toward the sea. All in meters.
 */
export interface Shore {
  midTide: number;
  tide: number;
  from: number;
}

/**
 * A level's edges, in meters from the tree's roots: to either side, up in the sky and down in the
 * ground. The view never shows past them, and the tree grows no further.
 */
export interface Edges {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The kinds of grass that grow on a level's ground, each after its reference photo. */
export type GrassKind = "meadow" | "wildflower" | "wheat";

/**
 * A stretch of a level's ground where one kind of grass grows, from `from` to `to` meters along the
 * land; dune grass grows in clumps, with bare sand between.
 */
export interface GrassPatch {
  kind: GrassKind;
  from: number;
  to: number;
  clumped?: boolean;
}

/**
 * A rail fence standing along a level's ground, as though it kept to a path: where each of its posts
 * stands along the land, from one end to the other, and which bay is the gate the path runs through.
 * All in meters.
 */
export interface Fence {
  posts: readonly number[];
  /** Index of the post the gate hangs from. The next post is the latch. */
  gate: number;
}

/**
 * A place to grow a tree: the lie of its ground, what stands about it, how far it reaches, and what
 * the camera keeps in view. All heights are in meters, from the ground the tree is planted in, at
 * x = 0.
 */
export interface Level {
  id: LevelId;
  name: string;
  description: string;
  /** Height of the ground at `x`: 0 where the tree is planted. */
  groundAt(x: number): number;
  /**
   * Whether the barn stands beside the tree to its right, the farmhouse to its left, and mountains
   * line the horizon.
   */
  barn: boolean;
  farmhouse: boolean;
  mountains: boolean;
  /** Whether a fishing village stands on the far shore across the sea. */
  village: boolean;
  /**
   * How tall the mountains are compared with the usual range, and how far their bases sit below the
   * horizon, as a fraction of the sky, so they meet the ground.
   */
  mountainScale: number;
  mountainDrop: number;
  /** A rail fence along its ground, if one stands there. */
  fence: Fence | undefined;
  /** Where grass grows along its ground, and of what kind, from left to right. */
  grass: readonly GrassPatch[];
  edges: Edges;
  /** The sides bears come in from: -1 the left, 1 the right. */
  bearsFrom: readonly (1 | -1)[];
  /** Height of the horizon, where the land or the sea far off meets the sky. */
  horizon: number;
  /**
   * Lowest height the camera keeps in view while it frames the tree, and how far left and right of
   * it.
   */
  depth: number;
  lead: number;
  reach: number;
  /** The sea beyond the land, if the land runs down into one. */
  shore: Shore | undefined;
}

/**
 * The meadow: a few long, gentle swells of land across it, so the tree stands in a shallow dip with
 * a rise to either side. Each swell has its height, its length and where it starts along the land.
 * All in meters, from the tree's roots.
 */
const MEADOW_SWELLS = [
  { height: 0.9, length: 46, phase: -1.16 },
  { height: 0.5, length: 120, phase: 0.52 },
] as const;

/** The lie of the meadow's land, before it is set so the tree stands at height 0. */
function meadowRaw(x: number): number {
  let height = 0;
  for (const { height: swell, length, phase } of MEADOW_SWELLS) {
    height += swell * Math.sin((2 * Math.PI * x) / length + phase);
  }
  return height;
}

const MEADOW: Level = {
  id: "meadow",
  name: "Meadow",
  description:
    "Long, gentle swells of meadow, a long rail fence along the rise to the right of the tree where a path runs through, and mountains along the horizon. Bears come from either side.",
  groundAt: (x) => meadowRaw(x) - meadowRaw(0),
  barn: false,
  farmhouse: false,
  mountains: true,
  village: false,
  mountainScale: 1,
  mountainDrop: 0,
  fence: {
    posts: [
      4.2, 6.9, 9.4, 12.2, 14.8, 17.5, 20.1, 22.7, 24.5, 26.2, 28.8, 31.5, 34.2,
      37, 39.7,
    ],
    gate: 8,
  },
  grass: [
    { kind: "meadow", from: -50, to: -22 },
    { kind: "wildflower", from: -22, to: -7 },
    { kind: "meadow", from: -7, to: 9 },
    { kind: "wildflower", from: 9, to: 33 },
    { kind: "meadow", from: 33, to: 50 },
  ],
  edges: { left: -50, right: 50, top: 55, bottom: -6 },
  bearsFrom: [-1, 1],
  horizon: 0,
  depth: 0,
  lead: 12,
  reach: 14,
  shore: undefined,
};

/**
 * The farm's land: level where the tree and the barn stand, up to `yard`, and beyond it a few long,
 * gentle swells, as the meadow's, each with its height, its length and where it starts along the
 * land, easing in over `ease` meters; and to the left the rise the farmhouse stands on, level and
 * `rise.height` high from the land's end to `rise.top`, sloping gently down to the yard at
 * `rise.foot`. All in meters.
 */
const FARM_LAND = {
  swells: [
    { height: 0.7, length: 48, phase: -2.094 },
    { height: 0.35, length: 105, phase: 0 },
  ],
  yard: 13,
  ease: 7,
  rise: { height: 2, top: -19, foot: -6 },
} as const;

/** Height of the farm's land at `x`. */
function farmLand(x: number): number {
  const { rise } = FARM_LAND;
  let height = 0;
  for (const { height: swell, length, phase } of FARM_LAND.swells) {
    height += swell * Math.sin((2 * Math.PI * x) / length + phase);
  }
  return (
    height * smoothstep(0, FARM_LAND.ease, x - FARM_LAND.yard) +
    rise.height * (1 - smoothstep(rise.top, rise.foot, x))
  );
}

const FARM_LEVEL: Level = {
  id: "farm",
  name: "Farm",
  description:
    "Long, gentle swells of farmland, the farmhouse on a rise to the left of the tree and the barn to its right, and a rail fence along the rise beyond the barn. Bears come from either side.",
  groundAt: farmLand,
  barn: true,
  farmhouse: true,
  mountains: true,
  village: false,
  mountainScale: 1,
  mountainDrop: 0,
  fence: {
    posts: [17, 19.7, 22.3, 25, 27.6, 30.3, 32.9, 35.6, 38.2],
    gate: 4,
  },
  grass: [
    { kind: "wildflower", from: -75, to: -28 },
    { kind: "meadow", from: -28, to: 11.5 },
    { kind: "wheat", from: 11.5, to: 38 },
    { kind: "wildflower", from: 38, to: 76 },
  ],
  edges: { left: -75, right: 76, top: 55, bottom: -8 },
  bearsFrom: [-1, 1],
  horizon: 0,
  depth: 0,
  lead: 36,
  reach: 14,
  shore: undefined,
};

/**
 * The cliff: a hill rolling gently down to the left that rolls off over a rounded brink and falls
 * away steeply into the sea far below, where the land ends. The tree is planted on the brink. All
 * in meters, along the land from the hilltop.
 */
const CLIFF = {
  /** Where the hill rolls off, and how far and how steeply it falls to the shore. */
  brink: 4.2,
  drop: 7,
  face: 0.62,
  /** How far the land to the left lies below the hilltop, and over what stretch it climbs. */
  low: 1.8,
  climb: { from: -30, to: -3 },
  /**
   * Swells along the land to the left: two of them, out of step, each with its height, its length
   * and where it starts along the land; and where they fade by the tree.
   */
  swells: [
    { height: 0.3, length: 9, phase: 0 },
    { height: 0.45, length: 23, phase: 1.3 },
  ],
  fade: -6,
  /**
   * The seabed beyond the cliff's foot: a ledge of rock that bares at low water, then a bed that
   * shelves away into deep water, steeply at first and ever more gently. How wide the ledge is, how
   * deep the bed falls in all, and over what distance it falls most of the way, in meters.
   */
  seabed: { ledge: 1.2, deep: 8, falls: 13 },
  /**
   * The sea: how far below the hilltop it stands at low water, baring the ledge at the cliff's
   * foot; how far below the top of the cliff, where the tree stands, it rises to at high water,
   * all but reaching it; and how far above high water the horizon lies, as seen from the hill,
   * so the sea far off always shows between them.
   */
  sea: { low: 6.95, high: 1, horizon: 1.5 },
  /** The tree is planted on the brink where the land falls away this steeply, as rise over run. */
  plant: 1,
  /**
   * How far below the sea at low water the camera keeps in view, how far back over the land behind
   * the tree, and how far out to sea.
   */
  view: { below: 2.85, lead: 6, reach: 18 },
} as const;

/** The raw lie of the cliff level's ground, before it is set so the tree stands at height 0. */
function cliffRaw(x: number): number {
  const climb =
    -CLIFF.low * (1 - smoothstep(CLIFF.climb.from, CLIFF.climb.to, x));
  let swell = 0;
  for (const { height, length, phase } of CLIFF.swells) {
    swell += height * Math.sin((2 * Math.PI * x) / length + phase);
  }
  swell *= 1 - smoothstep(CLIFF.fade, 0, x);
  // The fall to the shore: a rounded brink, a steep face, and a hollow at its foot.
  const fall = CLIFF.drop / (1 + Math.exp(-(x - CLIFF.brink) / CLIFF.face));
  const foot = CLIFF.brink + 4 * CLIFF.face;
  // The seabed shelving away beyond the ledge at its foot.
  const out = Math.max(0, x - foot - CLIFF.seabed.ledge);
  const seabed =
    CLIFF.seabed.deep *
    (1 - Math.exp(-out / CLIFF.seabed.falls)) *
    smoothstep(0, 1.5, out);
  return climb + swell - fall - seabed;
}

/** Where along the land the tree is planted: on the brink, where it falls away as steeply as asked. */
function plantedAt(): number {
  const fall = (x: number): number =>
    (cliffRaw(x - 0.01) - cliffRaw(x + 0.01)) / 0.02;
  let gentle = 0;
  let steep: number = CLIFF.brink;
  invariant(
    fall(gentle) < CLIFF.plant && fall(steep) > CLIFF.plant,
    `The brink never falls away at ${CLIFF.plant} to plant a tree on.`,
  );
  for (let i = 0; i < 40; i += 1) {
    const middle = (gentle + steep) / 2;
    if (fall(middle) < CLIFF.plant) {
      gentle = middle;
    } else {
      steep = middle;
    }
  }
  return (gentle + steep) / 2;
}

const PLANTED = plantedAt();
/** Height of the hilltop above the tree. */
const HILLTOP = cliffRaw(0) - cliffRaw(PLANTED);
/** Heights of the sea at low and high water, from the ground the tree stands on. */
const LOW_WATER = HILLTOP - CLIFF.sea.low;
const HIGH_WATER = -CLIFF.sea.high;

const CLIFF_LEVEL: Level = {
  id: "cliff",
  name: "Sea",
  description:
    "A hill that rolls off steeply into the sea, with the tree on the brink of its cliff, an old rail fence along the land behind it, and a fishing village on the far shore to the right. The land ends at the cliff, so bears come only from the left. The sea's waves, swell and tide are on the Sea page.",
  groundAt: (x) => cliffRaw(x + PLANTED) - cliffRaw(PLANTED),
  barn: false,
  farmhouse: false,
  mountains: false,
  village: true,
  mountainScale: 1,
  mountainDrop: 0,
  fence: {
    posts: [-25.3, -22.6, -20, -17.3, -14.7, -12, -9.4, -6.8, -4.2],
    gate: 4,
  },
  grass: [{ kind: "wheat", from: -50, to: -0.6, clumped: true }],
  edges: { left: -50, right: 40, top: 55, bottom: -12 },
  bearsFrom: [-1],
  horizon: HIGH_WATER + CLIFF.sea.horizon,
  depth: LOW_WATER - CLIFF.view.below,
  lead: CLIFF.view.lead,
  reach: CLIFF.view.reach,
  shore: {
    midTide: (LOW_WATER + HIGH_WATER) / 2,
    tide: (HIGH_WATER - LOW_WATER) / 2,
    // From the tree, which stands above even high water.
    from: 0,
  },
};

export const LEVELS: readonly Level[] = [MEADOW, FARM_LEVEL, CLIFF_LEVEL];

export function levelById(id: LevelId): Level {
  const level = LEVELS.find((candidate) => candidate.id === id);
  if (level === undefined) {
    throw new Error(`No level ${id}.`);
  }
  return level;
}

/** Slope of `level`'s ground at `x`, as its rise over its run. */
export function slopeAt(level: Level, x: number): number {
  const h = 0.02;
  return (level.groundAt(x + h) - level.groundAt(x - h)) / (2 * h);
}

/** Lowest ground of `level` between `left` and `right`, sampled every `step` meters. */
export function lowestBetween(
  level: Level,
  left: number,
  right: number,
  step = 0.5,
): number {
  let lowest = level.groundAt(left);
  for (let x = left; x <= right; x += step) {
    lowest = Math.min(lowest, level.groundAt(x));
  }
  return Math.min(lowest, level.groundAt(right));
}
