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
 * A place to grow a tree: the lie of its ground, what stands about it, and what the camera keeps in
 * view. All heights are in meters, from the ground the tree is planted in, at x = 0.
 */
export interface Level {
  id: LevelId;
  name: string;
  description: string;
  /** Height of the ground at `x`: 0 where the tree is planted. */
  groundAt(x: number): number;
  /** Whether the barn stands beside the tree, and mountains line the horizon. */
  barn: boolean;
  mountains: boolean;
  /** Whether its ground is laid out in fields, after the sand drawings of hills. */
  fields: boolean;
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

/** The meadow: level ground, the barn beside the tree, and mountains along the horizon. */
const MEADOW: Level = {
  id: "meadow",
  name: "Meadow",
  description:
    "Level ground, with the barn beside the tree and mountains along the horizon. Bears come from either side.",
  groundAt: () => 0,
  barn: true,
  mountains: true,
  fields: false,
  bearsFrom: [-1, 1],
  horizon: 0,
  depth: 0,
  lead: 0,
  reach: 0,
  shore: undefined,
};

/**
 * The farm: a level yard where the tree and the barn stand, from `yard.from` to `yard.to`, and
 * rolling farmland beyond it either way, its hills easing in over `rise` meters past the yard. Each
 * swell of the land has its height, its length and where it starts along the land. All in meters,
 * from the tree's roots.
 */
const FARM = {
  yard: { from: -3, to: 12.5 },
  rise: 9,
  swells: [
    { height: 1.3, length: 36, phase: 4.36 },
    { height: 0.7, length: 71, phase: 1 },
    { height: 0.25, length: 11, phase: 2 },
  ],
} as const;

/** Height of the farm's ground at `x`: level in the yard, rolling beyond it. */
function farmGround(x: number): number {
  const away = Math.max(0, FARM.yard.from - x, x - FARM.yard.to);
  if (away === 0) {
    return 0;
  }
  let swell = 0;
  for (const { height, length, phase } of FARM.swells) {
    swell += height * Math.sin((2 * Math.PI * x) / length + phase);
  }
  return swell * smoothstep(0, FARM.rise, away);
}

const FARM_LEVEL: Level = {
  id: "farm",
  name: "Farm",
  description:
    "Rolling farmland, with the tree and the barn in a level yard. Its ground is laid out in fields, after the sand drawings of hills: hedgerows of pebbles, plowed rows, pasture and furrows. Bears come from either side.",
  groundAt: farmGround,
  barn: true,
  mountains: true,
  fields: true,
  bearsFrom: [-1, 1],
  horizon: 0,
  depth: 0,
  lead: 0,
  reach: 0,
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
  name: "Cliff",
  description:
    "A hill that rolls off steeply into the sea, with the tree on its brink. The land ends at the cliff, so bears come only from the left. The sea's waves, swell and tide are on the Sea page.",
  groundAt: (x) => cliffRaw(x + PLANTED) - cliffRaw(PLANTED),
  barn: false,
  mountains: false,
  fields: false,
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
