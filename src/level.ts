import { smoothstep } from "./util";

/** The levels a tree can be grown in. */
export type LevelId = "meadow" | "cliff";

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
  /** The sides bears come in from: -1 the left, 1 the right. */
  bearsFrom: readonly (1 | -1)[];
  /** Height of the horizon, where the land or the sea far off meets the sky. */
  horizon: number;
  /** Lowest height the camera keeps in view while it frames the tree, and how far right of it. */
  depth: number;
  reach: number;
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
  bearsFrom: [-1, 1],
  horizon: 0,
  depth: 0,
  reach: 0,
};

/**
 * The cliff: a hill rolling gently down to the left, crowned near the tree, that rolls off over a
 * rounded brink a few meters to its right and falls away steeply to the shore far below, where the
 * land ends. All in meters, from the tree.
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
  /** How far the shore beyond the cliff's foot keeps falling, per meter out, and at most. */
  shelf: { slope: 0.04, most: 2.5 },
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
  const shelf = Math.min(
    CLIFF.shelf.most,
    CLIFF.shelf.slope * Math.max(0, x - foot),
  );
  return climb + swell - fall - shelf;
}

const CLIFF_LEVEL: Level = {
  id: "cliff",
  name: "Cliff",
  description:
    "A hill that rolls off steeply to the shore. The land ends at the cliff, so bears come only from the left.",
  groundAt: (x) => cliffRaw(x) - cliffRaw(0),
  barn: false,
  mountains: false,
  bearsFrom: [-1],
  horizon: -CLIFF.drop,
  depth: -CLIFF.drop - 0.6,
  reach: CLIFF.brink + 6 * CLIFF.face,
};

export const LEVELS: readonly Level[] = [MEADOW, CLIFF_LEVEL];

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
