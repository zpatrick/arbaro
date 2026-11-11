import type { Camera } from "./camera";
import type { Shore } from "./level";
import type { Sea } from "./sea";
import { css, lit, mix, type Rgb, type SkyBody, type SkyLight } from "./sky";
import {
  at,
  clamp,
  invariant,
  lerp,
  Rng,
  smoothstep,
  valueNoise,
  valueNoise2,
} from "./util";
import { SNOW_COLOR } from "./weather";

/** A point on the page, in a layer's own meters with y up. */
export interface Point {
  x: number;
  y: number;
}

/**
 * A point in the world, in a layer's own meters: `x` along the shore, `y` up, as the level's
 * heights are, and `z` back from the water's edge.
 */
interface Place {
  x: number;
  y: number;
  z: number;
}

/** A point on the ground plan: along the shore, and back from the water's edge. */
interface Spot {
  x: number;
  z: number;
}

/** A direction, with x to the right, y up and z toward the viewer. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * The village is drawn as an engraver draws a town, seen from in front, a little to its left and
 * a little above: for every meter a thing stands back from the water it lies `left` meters to the
 * left on the page and `up` meters higher. Every house shows its front, its left end and the near
 * slope of its roof at the one angle, and the quay, the streets and the rows of land between them
 * show as bands along the shore.
 */
const VIEW = { left: 0.28, up: 0.24 } as const;

/** Where a place in the world lies on the page. */
function onPage(p: Place): Point {
  return { x: p.x - VIEW.left * p.z, y: p.y + VIEW.up * p.z };
}

/** Whether a face turned `normal` shows from where the village is seen. */
function shows(normal: Vec3): boolean {
  return normal.z + VIEW.up * normal.y - VIEW.left * normal.x > 1e-3;
}

/** How far a roof reaches past the walls at the eaves and past the gable ends, in meters. */
const OVERHANG = { eaves: 0.35, verge: 0.3 } as const;

/**
 * What a house is painted: its walls, its roof, and the trim at its corners and windows, if any.
 */
interface Paint {
  walls: Rgb;
  roof: Rgb;
  trim: Rgb | undefined;
}

const TRIM: Rgb = [238, 234, 224];

/**
 * The paints of a fishing village: barn red with grey or red roofs and white trim, white with
 * slate, red or grey roofs, and here and there cream or ochre.
 */
const PAINTS = {
  redGrey: { walls: [156, 58, 44], roof: [132, 130, 126], trim: TRIM },
  redRed: { walls: [156, 58, 44], roof: [124, 44, 36], trim: TRIM },
  oxblood: { walls: [116, 44, 38], roof: [72, 62, 60], trim: TRIM },
  whiteSlate: { walls: [238, 233, 222], roof: [54, 52, 56], trim: undefined },
  whiteRed: { walls: [238, 233, 222], roof: [152, 56, 44], trim: undefined },
  whiteGrey: { walls: [238, 233, 222], roof: [120, 120, 118], trim: undefined },
  cream: { walls: [228, 212, 174], roof: [96, 50, 44], trim: TRIM },
  ochre: { walls: [206, 156, 76], roof: [72, 66, 64], trim: TRIM },
} as const satisfies Record<string, Paint>;

type PaintName = keyof typeof PAINTS;

/** How far one house's paint differs from another's of the same color, as weather and age do. */
const WEATHERED = 0.05;

/** What a building is for, which sets how its windows and doors are laid out. */
type Use = "house" | "shed" | "works";

/**
 * A kind of building: its length along the ridge, its width across it and the height of its walls
 * to the eaves, in meters, the pitch of its roof, in degrees, and what it is for.
 */
interface Building {
  length: number;
  width: number;
  walls: number;
  pitch: number;
  use: Use;
}

/**
 * The buildings of a fishing village: cabins and boathouses at the water, cottages and houses of
 * one and two stories, a few large ones, long sheds and warehouses, a works by the quay, and a
 * narrow tower of a house.
 */
const BUILDINGS = {
  cabin: { length: 5.4, width: 4.5, walls: 2.8, pitch: 40, use: "house" },
  cottage: { length: 6.6, width: 5.2, walls: 3.9, pitch: 44, use: "house" },
  house: { length: 8.8, width: 7, walls: 5.2, pitch: 44, use: "house" },
  villa: { length: 10.8, width: 8.4, walls: 6.1, pitch: 45, use: "house" },
  tower: { length: 4.6, width: 4.6, walls: 5.6, pitch: 50, use: "house" },
  longhouse: { length: 13.6, width: 8.4, walls: 5.6, pitch: 30, use: "house" },
  warehouse: { length: 13, width: 8, walls: 4.3, pitch: 26, use: "shed" },
  boathouse: { length: 7.6, width: 5.5, walls: 3.2, pitch: 30, use: "shed" },
  works: { length: 7, width: 8, walls: 6.6, pitch: 12, use: "works" },
} as const satisfies Record<string, Building>;

type Kind = keyof typeof BUILDINGS;

/** How much one building differs in size from another of its kind, either way. */
const VARIES = 0.08;

/**
 * A building as it stands: its kind; where the middle of its footprint stands along the shore and
 * back from the water, in meters; whether its gable end faces the water rather than its long
 * side; how far it is turned from square to the shore, in degrees; and its paint.
 */
interface HouseSpec {
  kind: Kind;
  x: number;
  z: number;
  gable?: boolean;
  skew?: number;
  paint: PaintName;
}

/**
 * The village, in meters along the shore and back from the water: cabins, boathouses and
 * warehouses fronting the walk along the harbor wall; the main street behind them; a row of
 * houses facing it; a bank up to an upper lane and a second row of houses above that; and a few
 * on the slope behind, thinning out along the shore to a few houses alone.
 */
const VILLAGE_HOUSES: readonly HouseSpec[] = [
  { kind: "boathouse", x: 55, z: 6.4, gable: true, paint: "redRed" },
  { kind: "warehouse", x: 67, z: 6.5, skew: -1, paint: "redGrey" },
  { kind: "cabin", x: 77.6, z: 5.4, gable: true, paint: "redRed" },
  { kind: "works", x: 85.6, z: 6.5, paint: "whiteRed" },
  { kind: "warehouse", x: 98.6, z: 6.5, skew: 1, paint: "ochre" },
  { kind: "cabin", x: 109.2, z: 5.4, gable: true, skew: 3, paint: "redRed" },
  { kind: "boathouse", x: 115.8, z: 6.4, gable: true, paint: "redGrey" },
  { kind: "warehouse", x: 130.4, z: 6.5, paint: "redRed" },
  { kind: "cabin", x: 141.4, z: 5.4, gable: true, paint: "redGrey" },
  {
    kind: "boathouse",
    x: 152,
    z: 6.4,
    gable: true,
    skew: -2,
    paint: "whiteGrey",
  },
  { kind: "cabin", x: 170, z: 5.4, gable: true, paint: "redRed" },
  { kind: "warehouse", x: 194, z: 6.5, paint: "redGrey" },
  { kind: "cabin", x: 232, z: 5.4, gable: true, paint: "redRed" },
  { kind: "cottage", x: 60.4, z: 20.8, gable: true, paint: "whiteRed" },
  { kind: "longhouse", x: 72.8, z: 20.8, paint: "redGrey" },
  { kind: "villa", x: 88.2, z: 20.8, paint: "whiteSlate" },
  { kind: "house", x: 103.2, z: 20.8, gable: true, paint: "whiteSlate" },
  { kind: "house", x: 113.6, z: 20.8, skew: 3, paint: "oxblood" },
  { kind: "house", x: 124, z: 20.8, paint: "whiteGrey" },
  { kind: "villa", x: 138.8, z: 20.8, skew: -2, paint: "whiteSlate" },
  { kind: "house", x: 150.4, z: 20.8, gable: true, paint: "cream" },
  { kind: "house", x: 161.6, z: 20.8, paint: "whiteSlate" },
  { kind: "house", x: 175.2, z: 20.8, skew: 4, paint: "redGrey" },
  { kind: "cottage", x: 195, z: 20.8, gable: true, paint: "whiteRed" },
  { kind: "house", x: 222, z: 20.8, paint: "oxblood" },
  { kind: "house", x: 258, z: 20.8, skew: -3, paint: "whiteSlate" },
  { kind: "house", x: 72.6, z: 39.5, paint: "whiteSlate" },
  { kind: "house", x: 84.6, z: 39.5, gable: true, paint: "whiteRed" },
  { kind: "house", x: 96.2, z: 39.5, skew: -3, paint: "redGrey" },
  { kind: "cottage", x: 112.2, z: 39.5, gable: true, paint: "redRed" },
  { kind: "house", x: 123.6, z: 39.5, skew: 2, paint: "whiteSlate" },
  { kind: "house", x: 135.2, z: 39.5, gable: true, paint: "whiteGrey" },
  { kind: "house", x: 147.2, z: 39.5, paint: "whiteSlate" },
  { kind: "cottage", x: 161.2, z: 39.5, gable: true, paint: "redRed" },
  { kind: "house", x: 179.2, z: 39.5, skew: -4, paint: "whiteSlate" },
  { kind: "house", x: 207.2, z: 39.5, paint: "redGrey" },
  { kind: "cottage", x: 93, z: 51, paint: "whiteSlate" },
  { kind: "cottage", x: 132.6, z: 51, gable: true, paint: "redGrey" },
];

/** The few houses alone up the green hillside above the village, in the hills' own meters. */
const HILL_HOUSES: readonly HouseSpec[] = [
  { kind: "cottage", x: 72, z: 20, paint: "whiteSlate" },
  { kind: "cottage", x: 118, z: 32, gable: true, paint: "cream" },
  { kind: "house", x: 129, z: 36, skew: 3, paint: "whiteSlate" },
  { kind: "cottage", x: 150, z: 46, paint: "redRed" },
  { kind: "cottage", x: 186, z: 52, gable: true, paint: "whiteSlate" },
  { kind: "cottage", x: 232, z: 56, paint: "redGrey" },
  { kind: "house", x: 290, z: 50, skew: -3, paint: "whiteSlate" },
];

/**
 * A few houses scattered along the low far shore to the left, in its own meters: a row facing the
 * footpath along the shore, and two behind them up the lane.
 */
const FAR_HOUSES: readonly HouseSpec[] = [
  { kind: "cottage", x: 22.6, z: 5.8, paint: "whiteSlate" },
  { kind: "boathouse", x: 29.2, z: 7.1, gable: true, paint: "whiteGrey" },
  { kind: "cabin", x: 35.2, z: 5.9, gable: true, paint: "redRed" },
  { kind: "cottage", x: 41.6, z: 6.1, skew: 4, paint: "whiteSlate" },
  { kind: "cottage", x: 37, z: 15.5, gable: true, paint: "whiteRed" },
  { kind: "tower", x: 48, z: 14, paint: "whiteSlate" },
];

/** What covers a row of ground: grass, the gravel of a street, or scrub on a slope. */
type Cover = "grass" | "street" | "scrub";

/**
 * An edge between two rows of a layer's ground: how far back from the water it runs, how high above
 * the quay it stands along the shore, through these points, and how far knolls and stands of trees
 * roughen it, in meters.
 */
interface EdgeSpec {
  z: number;
  height: readonly (readonly [number, number])[];
  rough?: number;
}

/**
 * A lane or footpath between the houses, climbing from one street to another or running along the
 * shore, through these points along the shore and back from the water, and how wide it is, in
 * meters.
 */
interface LaneSpec {
  points: readonly (readonly [number, number])[];
  width: number;
}

/**
 * A layer's ground, seen as the houses are: rows of land running along the shore, from the water's
 * edge back up the slope, each between two edges and covered in grass, the gravel of a street, or
 * scrub; lanes climbing between them; the coast its left side runs back along from the tip of its
 * point, nearest the view, as depths back from the water and the distances along the shore the
 * land begins there; and how far in from the coast the land falls away to the shore. How far the ground rises and falls between its edges, as
 * knolls and hollows, and how long a facet of it is along
 * the shore, each taking the light its own way; how far apart tufts of grass, stands of trees and
 * bushes lie over it; how far along the shore its rock is carved; the stretch of its shore built
 * up as a harbor wall, if any; and how far along the shore it reaches. All in meters.
 */
interface GroundSpec {
  edges: readonly EdgeSpec[];
  covers: readonly Cover[];
  lanes: readonly LaneSpec[];
  coast: readonly (readonly [number, number])[];
  fall: number;
  rough: number;
  facet: number;
  tufts: number;
  groves: number;
  shrubs: number;
  rocks: number;
  harbor: HarborSpec | undefined;
  reach: number;
  seed: number;
}

/**
 * A stretch of shore built up as a harbor wall, from `from` to `to` along it, with a cobbled walk
 * `walk` meters deep along its top, in meters.
 */
interface HarborSpec {
  from: number;
  to: number;
  walk: number;
}

/**
 * The ground the village stands on: the quay along the water, the main street behind it, a row of
 * houses, a bank up to the upper lane, a second row of houses, and the slope behind, rising along
 * the shore to the right.
 */
const VILLAGE_GROUND: GroundSpec = {
  edges: [
    { z: 0, height: [[0, 0]] },
    { z: 11, height: [[0, 0.1]] },
    { z: 15.6, height: [[0, 0.3]] },
    {
      z: 26,
      height: [
        [40, 1.2],
        [100, 1.8],
        [200, 2.4],
        [400, 3],
      ],
    },
    {
      z: 29.5,
      height: [
        [40, 3.6],
        [100, 4.4],
        [200, 5.2],
        [400, 6],
      ],
    },
    {
      z: 33,
      height: [
        [40, 3.8],
        [100, 4.6],
        [200, 5.4],
        [400, 6.2],
      ],
    },
    {
      z: 46,
      height: [
        [40, 5.6],
        [100, 7],
        [200, 8.6],
        [400, 10],
      ],
    },
    {
      z: 56,
      height: [
        [40, 7],
        [100, 9.5],
        [200, 12],
        [400, 14],
      ],
      rough: 0.8,
    },
  ],
  covers: ["grass", "street", "grass", "grass", "street", "grass", "scrub"],
  lanes: [
    {
      points: [
        [97.5, 15.6],
        [97.5, 26],
        [97, 29.5],
      ],
      width: 2.4,
    },
    {
      points: [
        [131, 15.6],
        [131, 26],
        [130.5, 29.5],
      ],
      width: 2.4,
    },
    {
      points: [
        [104.6, 33],
        [104.2, 46],
        [106.6, 56],
      ],
      width: 2,
    },
    {
      points: [
        [90, 33],
        [90, 44.5],
        [91.2, 47.4],
      ],
      width: 1.6,
    },
    {
      points: [
        [130, 33],
        [130, 45.2],
        [131, 46.8],
      ],
      width: 1.6,
    },
  ],
  coast: [
    [0, 41.5],
    [6, 44],
    [14, 47.8],
    [24, 53.2],
    [36, 60.5],
    [50, 68.5],
    [60, 74],
  ],
  fall: 7,
  rough: 0.25,
  facet: 9,
  tufts: 1.9,
  groves: 9,
  shrubs: 5,
  rocks: 340,
  harbor: { from: 49, to: 203, walk: 1.9 },
  reach: 800,
  seed: 31,
};

/**
 * The heights the hills rise to along the shore, at their crest, in meters above the quay: low
 * behind the point, then rolling gently up to the right over a shoulder and a saddle.
 */
const HILL_CREST: readonly (readonly [number, number])[] = [
  [30, 2],
  [60, 6],
  [90, 12],
  [120, 19],
  [150, 25.5],
  [180, 30],
  [210, 31.5],
  [240, 30.5],
  [280, 34],
  [340, 37],
  [420, 38],
  [900, 38],
];

/** The crest's heights, `share` of the way up the hills. */
function hillsAt(share: number): [number, number][] {
  return HILL_CREST.map(([x, y]) => [x, y * share]);
}

/** The green hills behind the village, rising gently from a strip of shore. */
const HILL_GROUND: GroundSpec = {
  edges: [
    { z: 0, height: [[0, 0.2]] },
    { z: 6, height: [[0, 1]] },
    { z: 16, height: hillsAt(0.2) },
    { z: 30, height: hillsAt(0.45) },
    { z: 44, height: hillsAt(0.68) },
    { z: 58, height: hillsAt(0.87) },
    { z: 70, height: hillsAt(1), rough: 1.2 },
  ],
  covers: ["grass", "scrub", "scrub", "scrub", "scrub", "scrub"],
  lanes: [],
  coast: [
    [0, 36],
    [10, 42.5],
    [30, 57.5],
    [60, 80.5],
    [90, 103.5],
  ],
  fall: 60,
  rough: 1.4,
  facet: 14,
  tufts: 2.6,
  groves: 8,
  shrubs: 0,
  rocks: 160,
  harbor: undefined,
  reach: 900,
  seed: 57,
};

/**
 * The low shore far off to the left of the village, under a slope that climbs away behind it, with
 * a footpath along the shore past its houses and up to the two behind.
 */
const FAR_GROUND: GroundSpec = {
  edges: [
    { z: 0, height: [[0, 0.2]] },
    { z: 11, height: [[0, 0.8]] },
    {
      z: 20,
      height: [
        [0, 2],
        [40, 3],
        [80, 4.5],
      ],
    },
    {
      z: 34,
      height: [
        [0, 4],
        [40, 6.5],
        [80, 9.5],
        [140, 12],
      ],
    },
    {
      z: 50,
      height: [
        [0, 6],
        [40, 9.5],
        [80, 14],
        [140, 17],
        [300, 19],
        [900, 19],
      ],
      rough: 1,
    },
  ],
  covers: ["grass", "grass", "scrub", "scrub"],
  lanes: [
    {
      points: [
        [17.5, 2],
        [24, 1.95],
        [31, 2],
        [38.5, 2.05],
        [45.5, 2.05],
        [46.6, 2.3],
        [47.6, 3.6],
        [47.8, 7.2],
        [46.8, 10.3],
        [42, 10.7],
        [37.5, 10.8],
      ],
      width: 1,
    },
  ],
  coast: [
    [0, 13.5],
    [8, 17.5],
    [20, 25],
    [40, 40],
    [60, 56],
  ],
  fall: 40,
  rough: 0.6,
  facet: 14,
  tufts: 3.4,
  groves: 14,
  shrubs: 0,
  rocks: 110,
  harbor: undefined,
  reach: 900,
  seed: 83,
};

/** A lamp on a post along a street, where it stands along the shore and back from the water. */
interface LampSpec {
  x: number;
  z: number;
}

/**
 * Lamps along the main street, between the houses and clear of the lanes, and along the water's
 * edge of the walk on the harbor wall, clear of the piers.
 */
const LAMPS: readonly LampSpec[] = [
  { x: 62, z: 15 },
  { x: 75, z: 15 },
  { x: 90, z: 15 },
  { x: 105, z: 15 },
  { x: 118, z: 15 },
  { x: 141, z: 15 },
  { x: 156, z: 15 },
  { x: 170, z: 15 },
  { x: 51, z: 0.5 },
  { x: 65, z: 0.5 },
  { x: 79, z: 0.5 },
  { x: 93, z: 0.5 },
  { x: 107, z: 0.5 },
  { x: 118.5, z: 0.5 },
  { x: 132, z: 0.5 },
  { x: 146, z: 0.5 },
  { x: 160, z: 0.5 },
  { x: 174, z: 0.5 },
  { x: 188, z: 0.5 },
  { x: 201, z: 0.5 },
];

/** A bench, where the middle of it stands along the shore and back from the water. */
interface BenchSpec {
  x: number;
  z: number;
}

/** Benches along the back of the walk on the harbor wall, every so often, facing the water. */
const BENCHES: readonly BenchSpec[] = [
  { x: 57.5, z: 1.4 },
  { x: 86, z: 1.4 },
  { x: 112.5, z: 1.4 },
  { x: 139, z: 1.4 },
  { x: 167, z: 1.4 },
  { x: 194.5, z: 1.4 },
];

/** A lamp's post: its height and thickness, the lantern on it, and its iron, in meters. */
const POST = {
  height: 3.3,
  width: 0.12,
  lantern: 0.32,
  iron: [46, 44, 44] as Rgb,
} as const;

/** A wooden pier from the quay out over the water: where it leaves the quay, how far out it runs and how wide it is, in meters. */
interface PierSpec {
  x: number;
  length: number;
  width: number;
}

/** Piers out from the village's quay. */
const PIERS: readonly PierSpec[] = [
  { x: 61.4, length: 9, width: 2.2 },
  { x: 121.6, length: 11, width: 2.2 },
];

/** A pier's deck above the quay, how far apart its posts stand, and its weathered wood. */
const PIER = { deck: 0.2, posts: 2.6, wood: [118, 96, 72] as Rgb } as const;

/** A boat lying in the water by the quay. */
interface MooredSpec {
  x: number;
  z: number;
  length: number;
  hull: Rgb;
  /** The wheelhouse on its deck, if any. */
  cabin: Rgb | undefined;
}

/** Boats lying off the village's quay and along its piers. */
const MOORED: readonly MooredSpec[] = [
  { x: 40.5, z: -3, length: 6.4, hull: [164, 56, 44], cabin: [236, 232, 222] },
  { x: 65.1, z: -5.5, length: 4, hull: [232, 228, 218], cabin: undefined },
  { x: 125.5, z: -7, length: 5.4, hull: [60, 74, 92], cabin: [236, 232, 222] },
];

/**
 * A layer of the village: how far off it stands, as the share of the near scale it is drawn at;
 * how far its colors are washed toward the sky for the distance; its ground; and the houses,
 * lamps, benches, piers and boats on it.
 */
interface LayerSpec {
  depth: number;
  haze: number;
  ground: GroundSpec;
  houses: readonly HouseSpec[];
  lamps: readonly LampSpec[];
  benches: readonly BenchSpec[];
  piers: readonly PierSpec[];
  moored: readonly MooredSpec[];
}

/**
 * The village's layers, farthest first: the low far shore off to the left, the green hills rising
 * behind the village, and the village along its shore. Farther things stand smaller and nearer
 * the horizon, and slide more slowly across the view as it pans, as the far sea's lines do.
 */
const LAYERS: readonly LayerSpec[] = [
  {
    depth: 0.068,
    haze: 0.34,
    ground: FAR_GROUND,
    houses: FAR_HOUSES,
    lamps: [],
    benches: [],
    piers: [],
    moored: [],
  },
  {
    depth: 0.105,
    haze: 0.22,
    ground: HILL_GROUND,
    houses: HILL_HOUSES,
    lamps: [],
    benches: [],
    piers: [],
    moored: [],
  },
  {
    depth: 0.14,
    haze: 0.12,
    ground: VILLAGE_GROUND,
    houses: VILLAGE_HOUSES,
    lamps: LAMPS,
    benches: BENCHES,
    piers: PIERS,
    moored: MOORED,
  },
];

/** How far a house's footprint keeps from the water and the coast, from a lane, and from a walk, in meters. */
const CLEAR = { shore: 0.4, lane: 0.3, walk: 0.1 } as const;

/**
 * A house's floor is level, raised this far above the ground under its middle, or its front where
 * that is higher, and stands on a plinth of stone down to the ground where it falls away below.
 * The back of a house on a slope is dug into it.
 */
const PLINTH = { least: 0.2, stone: [112, 108, 100] as Rgb } as const;

/**
 * The rock of the shore below the land, carved as the mountains are: joints running down its face
 * from the brink of the land, `apart` meters apart at their nearest and farthest, leaning up to
 * `lean` of the way they fall and wandering up to `wander` meters either side; an arête down the
 * middle of `arete` of the buttresses between them, turning their halves `turn` further to either
 * side; a narrow band along `band` of the joints and arêtes, up to `bandWide` meters across, turned
 * hard into the cleft; a fork off `fork` of the joints, reaching `forkReach` of the way down; a
 * ledge across `ledge` of the faces, `ledgeAt` of the way down them; and up to `creases` creases in
 * each face, wandering down from the brink and fading out `crease` of the way down.
 */
const CRAG = {
  apart: [2.4, 6],
  lean: 0.14,
  wander: 0.22,
  arete: 0.75,
  turn: 0.6,
  band: 0.7,
  bandWide: [0.25, 0.65],
  fork: 0.55,
  forkReach: [0.2, 0.4],
  ledge: 0.4,
  ledgeAt: [0.28, 0.6],
  creases: 3,
  crease: [0.15, 0.4],
} as const;

/** How hard a face of rock turned fully to one side is turned, against facing straight out. */
const CRAG_TURN = 1.3;

/**
 * Near the tip of a point, the rock's joints fan out to follow its fall into the water: over how
 * many meters along the shore from the tip they straighten up, how far apart they stand there, and
 * how much of the tip's slope the nearest keeps.
 */
const FAN = { reach: 9, apart: [1.6, 3.2], keep: 0.85 } as const;

/**
 * The bare top of the rock along the brink of the land, the grass standing back from its edge
 * rather than hanging over it: how far back the grass begins, at least and at most, in meters; and
 * how much paler than the rock's face the top is, lit from above.
 */
const BARE_TOP = { back: [0.45, 1.5], pale: 0.25 } as const;

/**
 * Tufts of grass along the edge of the grass behind the bare top of the rock: how far apart, and
 * how long their blades, in meters.
 */
const FRINGE = { apart: [0.3, 0.75], long: [0.12, 0.3] } as const;

/**
 * The rock's color down its face, by how far below the quay, in meters: pale and dry above the
 * tide, weathered below it, then olive and brown with weed where the tide covers it longest.
 */
const ROCK_BANDS = [
  { below: 0, color: [154, 150, 140] },
  { below: 1.1, color: [138, 133, 120] },
  { below: 2.4, color: [116, 108, 88] },
  { below: 4, color: [96, 88, 62] },
  { below: 8, color: [80, 72, 50] },
] as const satisfies readonly { below: number; color: Rgb }[];

/**
 * Rock takes the light harder than the grown-over land: its faces turned from it darken by up to
 * `tone` of ink and are hatched up to `strength`, and those turned to it catch it up to `lit` of
 * the way paler, toward `pale`.
 */
const ROCK_SHADE = {
  tone: 0.32,
  strength: 0.8,
  lit: 0.26,
  pale: [236, 232, 220] as Rgb,
} as const;

/**
 * How much of the rock shows as the view closes in, by how many CSS pixels a meter of it spans:
 * its hatching comes in through `hatch`, and the lines carved on it through `cuts`.
 */
const ROCK_DETAIL = {
  hatch: [4, 10],
  cuts: [1.2, 4],
} as const;

/**
 * How wide each kind of line carved on the rock is along its length, from its top at 0 to its end
 * at 1, as a share of the widest, as the mountains' spurs, forks, bands and creases are.
 */
const CUTS = {
  joint: (t: number) => lerp(1, 0.35, t),
  arete: (t: number) => lerp(0.85, 0.3, t),
  fork: (t: number) => lerp(0.75, 0.25, t),
  band: (t: number) => 0.55 * (0.35 + 0.65 * Math.sin(Math.PI * t)),
  ledge: (t: number) => 0.55 * (0.35 + 0.65 * Math.sin(Math.PI * t)),
  crease: (t: number) => lerp(0.7, 0.12, t),
} as const;

/** The widths the carved lines are drawn in, as shares of the widest; each piece of a line takes the nearest. */
const CUT_WIDTHS = [1, 0.7, 0.45, 0.25] as const;

/**
 * The widest carved line: so many meters wide, but never narrower or wider than these CSS pixels;
 * and how strongly the lines show, as the mountains' do.
 */
const CUT_WIDTH = { meters: 0.09, px: [1.1, 3.2], alpha: 0.68 } as const;

/**
 * The harbor wall along the front of the village: dressed stone laid in courses `course` meters
 * high, each stone `long` meters long at its shortest and longest, under a coping of larger, paler
 * stones `coping.high` meters high. Below high water the stone darkens: dry down to `wet[0]`
 * meters below the quay, damp by `wet[1]`, and green with weed by `wet[2]`.
 */
const HARBOR = {
  stone: [160, 154, 142] as Rgb,
  coping: { high: 0.34, long: [1.2, 1.8], stone: [184, 178, 166] as Rgb },
  course: 0.42,
  long: [0.6, 1.4],
  damp: [130, 124, 110] as Rgb,
  weed: [88, 84, 62] as Rgb,
  wet: [0.4, 1, 2.6],
} as const;

/**
 * The cobbled walk along the top of the harbor wall: its stone, the coping stones along its edge
 * `kerb` meters deep, and how far apart its rows of cobbles lie and how long each cobble is, in
 * meters.
 */
const WALK = {
  stone: [176, 168, 150] as Rgb,
  kerb: 0.34,
  rows: 0.32,
  cobble: [0.2, 0.34],
} as const;

/** What a walk's cobbles need across before they are drawn, in CSS pixels. */
const LEAST_COBBLE_PX = 3;

/** How far behind and beside a walk the knolls of the ground ease out, so it lies level, in meters. */
const WALK_EASE = 2;

/**
 * A bench along the walk: how long it is, the height and depth of its seat, the height of its back
 * and how thick its boards are, in meters, and its wood and iron.
 */
const BENCH = {
  length: 1.7,
  seat: 0.45,
  deep: 0.42,
  back: 0.92,
  board: 0.07,
  wood: [134, 100, 68] as Rgb,
  iron: [46, 44, 44] as Rgb,
} as const;

/**
 * How many sets of a stretch's rock faces, each turned one way, and how many facets of the land,
 * in a layer may have their hatching laid afresh in one frame as the view zooms; the rest keep
 * their old hatching a few frames longer.
 */
const ROCK_HATCHES = 3;
const FACET_HATCHES = 12;

/**
 * The closest the hatching on rocks and on crowns lies, in meters, however near the view comes, as
 * an engraver cuts a few strong lines across a boulder rather than many fine ones. Spread wider
 * than the land's, its lines thicken with the square root of how much wider, so its tone holds.
 */
const HATCH_LEAST = { rock: 0.07, crown: 0.09 } as const;

/** How far a coast wanders in and out of its line, in coves and points, in meters. */
const COVES = 1.8;

/** How finely the land's outline follows its coast back from the water, in meters. */
const COAST_STEP = 1;

/** How finely the coast is worked out back from the water, in meters. */
const COAST_TABLE = 0.25;

/**
 * How far the land may dip behind a nearer rise along a line of sight before a facet of it is
 * drawn as folding over itself, and how deep the strips are it is then cut into, back from the
 * water, in meters.
 */
const FOLD = 0.1;
const FOLDED_STRIP = 1;

/**
 * The rock at the tip of a point, falling into the water like a mountain's ridge to its foot: how
 * far it slopes out for every meter it falls; the shoulder partway down, as a share of how far out
 * it reaches; and its jags, as a share of how far it falls.
 */
const TIP = { out: 1.2, shoulder: [0.06, 0.14], jag: 0.025 } as const;

/**
 * Trees on the land, birches and rowans: how many stand together, and how far from the middle of
 * their stand, in meters; how big a crown is across, in meters, and how much taller than wide; how
 * many clusters of leaves make it up, each so much of the crown's width across; how much of the
 * crown's height its bare trunk shows below it; and how many of them are rowans.
 */
const TREES = {
  stand: [3, 9],
  apart: 1.5,
  size: [2, 3.6],
  tall: [1.1, 1.4],
  clusters: [8, 12],
  cluster: 0.42,
  trunk: [0.08, 0.22],
  rowans: 0.3,
} as const;

/**
 * Bushes along the top of the shore: how many in a clump, how big one is across, in meters, how
 * much flatter than wide, and the clusters of leaves making it up.
 */
const BUSHES = {
  clump: [2, 4],
  size: [0.9, 1.7],
  tall: [0.62, 0.8],
  clusters: [5, 8],
  cluster: 0.5,
} as const;

/**
 * Trees stand thickest in woods over the slopes, thinning out into open grass between: how big
 * the woods are along the shore and back from the water, in meters, and below what measure of
 * them the slope lies open, from -1 to 1.
 */
const WOODS = { along: 45, back: 30, open: -0.3 } as const;

/** The kinds of leaves on the land, and so of the trees and bushes that bear them. */
type Leaves = "birch" | "rowan" | "bush";

/**
 * Each kind of leaves, as a share of the way from the land's grass to its scrub: birches the
 * palest, rowans the darkest.
 */
const LEAVES: Record<Leaves, number> = { birch: 0.35, rowan: 0.85, bush: 0.6 };

/**
 * The leaves through the year: each kind's color in the fall, birches turning gold and rowans red,
 * and the bare twigs of winter, which the crowns turn toward by these shares as the fall and the
 * winter come on.
 */
const AUTUMN: Record<Leaves, Rgb> = {
  birch: [206, 162, 62],
  rowan: [178, 76, 44],
  bush: [150, 112, 62],
};
const BARE: Rgb = [116, 104, 98];
const TURNING = { fall: 0.8, winter: 0.85 } as const;

/**
 * A crown catches the light paler at its top, toward `sunlit` by `top`, and lies darker beneath,
 * toward ink by `under`.
 */
const CROWN = {
  sunlit: [204, 210, 138] as Rgb,
  top: 0.22,
  under: 0.34,
} as const;

/** The bark of a tree's trunk: a birch's pale, a rowan's grey-brown. */
const BARK = {
  birch: [226, 220, 208] as Rgb,
  rowan: [104, 94, 84] as Rgb,
} as const;

/** How thick a trunk is at its foot, and at the crown, in meters. */
const TRUNK = { foot: 0.3, crown: 0.18 } as const;

/** How many rays a crown's outline is traced along, round its middle. */
const CROWN_RAYS = 40;

/** Turn between one cluster of leaves and the next, so they spread evenly through a crown. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * The arc drawn along the shaded edge of each cluster of leaves, either side of the way from the
 * light, in radians.
 */
const CLUSTER_ARC = 1;

/**
 * How a crown takes the light, as a ball of leaves: its side turned from the light darkens by up to
 * `tone` of ink and is hatched up to `strength`; the arcs along its clusters of leaves show at
 * `clusters` and its outline at `outline`. A stand whose crowns show less than `detailPx` CSS
 * pixels across is drawn as one, and a crown's hatching and clusters come in up to `fullPx`.
 */
const FOLIAGE = {
  tone: 0.36,
  strength: 0.55,
  clusters: 0.28,
  outline: 0.5,
  detailPx: 13,
  fullPx: 28,
} as const;

/**
 * How many crowns in a layer may have their hatching laid afresh in one frame as the view zooms;
 * the rest keep their old hatching a frame or two longer.
 */
const CROWN_HATCHES = 80;

/**
 * A stand drawn as one shades each crown's side turned from the light, past `side` of its
 * half-width from its middle, and its underside, below `under` of its half-height.
 */
const SMALL_CROWN = { side: 0.12, under: 0.3 } as const;

/**
 * Tufts of grass: how tall, in meters; how many blades; how far they fan out, in radians; and how
 * tall a tuft shows on the page as it comes into view, in CSS pixels.
 */
const TUFTS = {
  tall: [0.3, 0.55],
  blades: [3, 5],
  fan: 0.6,
  shows: [3, 8],
} as const;

/** The land is drawn in stretches this many meters across the page, so only those in view are drawn. */
const STRETCH = 40;

/**
 * Colors of the land: its grass and the darker scrub and trees on it, through the year; the
 * gravel of its streets; and its weed.
 */
const LAND = {
  green: [70, 98, 58],
  scrub: [40, 62, 40],
  autumn: [146, 118, 70],
  winter: [122, 114, 100],
  gravel: [176, 166, 142],
  weed: [52, 46, 34],
} as const;

/**
 * How a house and the land take the light, as the hives and mountains do: how far light wraps past
 * a face's edge into its shade, how far toward the viewer it falls, how strongly the moon shades
 * next to the sun, and how shaded everything is with no direct light, under thick cloud.
 */
const LIGHTING = { wrap: 0.5, depth: 0.8, moon: 0.6, overcast: 0.36 } as const;

/**
 * Shading on a face turned from the light: a tone of ink up to `tone`, and hatching in the
 * mountains' manner, every other line coming in as the shade deepens through `sparse` and the
 * lines between through `dense`, up to `strength`. Lines lean `tilt` radians off upright, toward
 * the way the face is turned, `gapPx` CSS pixels apart and `widthPx` wide. A face turned toward a
 * low sun glows with up to `glow` of its color. By night the hatching fades to `night` of itself,
 * the scene being dark enough.
 */
export const SHADE = {
  tone: 0.2,
  sparse: [0.3, 0.62],
  dense: [0.6, 0.92],
  strength: 0.6,
  tilt: 0.6,
  gapPx: 2.6,
  widthPx: 0.75,
  glow: 0.22,
  night: 0.35,
} as const;

/** The land's faces take light more evenly than a house's walls, being rounded and grown over. */
const LAND_SHADE = { tone: 0.12, strength: 0.42 } as const;

/**
 * Shadows: the band an overhanging roof throws down a lit wall, most of it `deepest` of the wall's
 * height, and how dark it is; the soft darkening at the foot of a wall, in two steps `low` and
 * `high` meters up, each this dark; and the shadow a house throws on the ground, how dark it is,
 * how many times its height it reaches at most, with the sun low, and how much of the light's lean
 * toward the viewer it keeps, so it falls across the ground beside the house rather than hidden
 * behind it; and how many corners the oval of a crown's shadow is drawn with.
 */
const SHADOW = {
  eaves: { deepest: 0.45, alpha: 0.22 },
  foot: { low: 0.4, high: 0.95, alpha: 0.07 },
  cast: { alpha: 0.28, reach: 5, toward: 0.35 },
  oval: 14,
} as const;

/** The lines of slate or board along a roof, how far apart, and how strongly they show. */
const COURSES = { apart: 0.55, alpha: 0.14, leastPx: 2.6 } as const;

/** Lines drawn on the village in ink: how strongly they show, and their width, in CSS pixels. */
export const LINES = {
  outline: 0.55,
  ridge: 0.42,
  edge: 0.3,
  tuft: 0.34,
  rock: 0.44,
  widthPx: 0.75,
} as const;

/** Strength of the sand's grain over the village, as over the far sea. */
const GRAIN = 0.06;

/**
 * How a building's windows are laid out, in meters: their size, their spacing, and the height of
 * a story.
 */
const WINDOWS = {
  house: { width: 0.72, height: 1.1, apart: 1.9, story: 2.6, sill: 0.9 },
  works: { width: 0.55, height: 0.75, apart: 1.25, story: 2, sill: 0.8 },
  shed: { width: 0.6, height: 0.6, apart: 3.6, story: 3.2, sill: 2 },
} as const;

/** A door: its width and height, in meters. */
const DOOR = { width: 0.95, height: 2 } as const;

/**
 * A chimney through the near slope of a house's roof, close under the ridge: how often a house has
 * one, how thick it is and how far it stands above the ridge, in meters, and its brick.
 */
const CHIMNEY = {
  odds: 0.6,
  size: 0.6,
  above: 0.75,
  brick: [112, 66, 54] as Rgb,
} as const;

/**
 * Smoke from the chimneys as the cold comes on: from how far into the year the first fires are
 * lit, from midsummer at 0 to midwinter at 1, and by when every fire is; the share of chimneys
 * with a fire in them; how many puffs rise from a chimney at once, and how many seconds each takes
 * to rise; how high it rises and how wide it grows, in meters; the wind, in meters a second, that
 * lays the smoke over flat, and how far it drifts as it rises even in still air; how far it
 * wavers either way, in meters; its grey, the paler crown each puff catches the light on, and how
 * thick it is at the chimney.
 */
const SMOKE = {
  lit: [0.66, 0.82],
  fires: 0.85,
  puffs: 14,
  rise: 8,
  high: 6.5,
  wide: [0.45, 2.2],
  flat: 9,
  drift: 0.25,
  waver: 0.45,
  color: [178, 178, 176] as Rgb,
  crown: [238, 238, 234] as Rgb,
  alpha: 0.42,
} as const;

/** How far white trim frames a window, in meters. */
const FRAME = 0.12;

/** A window pane by day and by night, before the sky's light on it. */
export const PANE = { day: [62, 70, 80] as Rgb, night: [24, 26, 36] as Rgb } as const;

/**
 * A lamp behind a window: how dark it grows before each is lit, from full day at 0 to deep night
 * at 1, and over how much of that it comes up; the share of windows that stay dark all night, and
 * of lamps put out late in the night, when they go out and when some come on again before dawn, as
 * fractions of the night from sunset to sunrise.
 */
const LAMP = {
  wakes: [0.12, 0.6],
  fade: 0.06,
  dark: 0.28,
  sleepy: 0.45,
  sleeps: [0.32, 0.62],
  early: 0.4,
  rises: [0.8, 0.94],
} as const;

/** How dark it grows before the street lamps are lit. */
const STREET_LAMPS = 0.3;

/**
 * The warm light of a lamp: the amber a lit pane glows, and the paler, hotter light at its heart.
 */
export const LAMPLIGHT = {
  pane: [246, 178, 92] as Rgb,
  heart: [255, 236, 196] as Rgb,
} as const;

/**
 * The soft glow around a lit window, as wide as so many of its heights and this strong; the pool
 * its light throws on the ground before it, so many meters across and this strong; and the same
 * for a street lamp.
 */
const GLOW = {
  window: { reach: 1.7, alpha: 0.55 },
  pool: { across: 3.4, alpha: 0.34 },
  lamp: { reach: 1.4, alpha: 0.85, pool: 7, poolAlpha: 0.5 },
} as const;

/** A lamp's light comes up in this many steps, so the windows are filled in a few batches. */
const LAMP_STEPS = 6;

/**
 * A lit window's light on the water below it: how many dashes it breaks into, how far down they
 * reach for every meter the window stands above the water, how wide a dash is beside the window,
 * how far the swell sways them, in meters, how strongly they show, and how far back from the
 * water a window stands, in meters, as its light on the water fades away.
 */
const REFLECTION = {
  dashes: 4,
  reach: [0.3, 1.25],
  wide: [0.8, 2.2],
  sway: 0.35,
  alpha: 0.55,
  back: [10, 30],
} as const;

/** What a window needs across before it is drawn at all, and before its glazing bars show, in CSS pixels. */
const LEAST_WINDOW_PX = { pane: 1.1, bars: 4.5 } as const;

/**
 * How deep snow lies, in meters, as it first whitens the roofs and the land and as it hides them.
 */
const SNOWY = [0.004, 0.05] as const;

/** How much of a roof, the grass and the scrub and trees the snow covers when it lies deep. */
export const SNOW_COVERS = { roof: 0.9, green: 0.75, scrub: 0.4 } as const;

/** How far a layer's land runs below its lowest water, in meters, so no edge ever shows. */
const FOOT = 2;

/**
 * A sailboat working back and forth across the water in front of the village: how far off it
 * sails, as the layers stand; the stretch it sails along, in its own meters; how fast, in meters a
 * second; where along its round it is when the sea begins; and its length and the height of its
 * mast, in meters.
 */
interface SailSpec {
  depth: number;
  from: number;
  to: number;
  speed: number;
  start: number;
  length: number;
  mast: number;
}

const SAILS: readonly SailSpec[] = [
  {
    depth: 0.18,
    from: 16,
    to: 72,
    speed: 1.3,
    start: 0.12,
    length: 3.4,
    mast: 4.5,
  },
  {
    depth: 0.24,
    from: -6,
    to: 34,
    speed: 1,
    start: 0.64,
    length: 3.8,
    mast: 5,
  },
];

/** Seconds a sailboat takes to come about at either end of its stretch. */
const COME_ABOUT = 5;

/** Sailcloth and a sailboat's hull, before the light on them. */
const SAILCLOTH: Rgb = [242, 238, 226];
const HULL: Rgb = [236, 232, 222];
/** A light at a sailboat's masthead by night, and how big it shows, in CSS pixels. */
const MASTHEAD = { color: [255, 236, 200] as Rgb, px: 1.4 } as const;

/** How the village and the boats about it are lit in one frame. */
export interface Look {
  light: SkyLight;
  sun: Vec3;
  moon: Vec3;
  sunUp: number;
  moonUp: number;
  /**
   * The light that casts shadows now, the sun's or by night the moon's, and how strongly it does,
   * from 0 to 1.
   */
  key: Vec3;
  keyStrength: number;
  /** How dark it has grown, from 0 in full day to 1 in deep night. */
  darkness: number;
  /** How far through the night it is, from 0 at sunset to 1 at sunrise; 0 by day. */
  night: number;
  ink: Rgb;
  /** The land's grass, and the scrub and trees on it, for the time of year. */
  green: Rgb;
  scrub: Rgb;
  /** How far the fall and the winter have come on, each from 0 to 1. */
  fall: number;
  winter: number;
  /** How white the snow lying on the roofs and the land leaves them, from 0 to 1, and its color. */
  snowy: number;
  snow: Rgb;
  /**
   * How many of the fires are lit, from 0 to 1, the seconds the sea has run, which the smoke rises
   * by, and the wind that bends it, in meters a second.
   */
  fires: number;
  clock: number;
  wind: number;
}

/** How many more things may have their hatching laid afresh this frame. */
interface Budget {
  left: number;
}

/** Hatching laid over a face, for the gap it was laid at, in its layer's meters. */
interface Hatch {
  gap: number;
  sparse: Path2D;
  dense: Path2D;
}

/** Something drawn with its own shading: its outline, which way it is turned, and its hatching. */
export interface Shaded {
  points: Point[];
  path: Path2D;
  normal: Vec3;
  hatch: Hatch | undefined;
}

/** A wall's top, under its eaves or verges, for the shadow they throw down it. */
interface Eaves {
  top: Point[];
  overhang: number;
  height: number;
}

/**
 * A face of a house as it shows, on the page in its layer's meters: what part of the house it is,
 * and for a wall, its foot and its top under the roof.
 */
interface Face extends Shaded {
  part: "walls" | "roof" | "chimney" | "plinth";
  foot: [Point, Point] | undefined;
  eaves: Eaves | undefined;
  /** The lines of slate or board along a roof. */
  courses: Path2D | undefined;
}

/**
 * A window or door in a wall: on the page in its layer's meters, its glass and the middle of it;
 * in the world, where it is; and when its lamp is lit. A window on the ground floor also throws a
 * pool of light on the ground before it, where `pool` says.
 */
interface Pane {
  points: Point[];
  middle: Point;
  bars: Path2D;
  height: number;
  place: Place;
  pool: Point | undefined;
  /** How dark it grows before the lamp is lit, or more than 1 for a window never lit. */
  wakes: number;
  /** When in the night the lamp is put out and lit again; past 1 for never. */
  sleeps: number;
  rises: number;
}

/** A house as it is built, ready to draw. */
interface House {
  paint: Paint;
  faces: Face[];
  panes: Pane[];
  /** Its panes and doors, and the trim framing them, each as one shape. */
  glass: Path2D;
  frames: Path2D | undefined;
  /** Lines down its corners, in its trim. */
  corners: Path2D | undefined;
  outline: Path2D;
  /** The ground its floor stands at, and the corners of its walls and roof, for its shadow. */
  floor: number;
  solid: Place[];
  footprint: Footprint;
  /** The top of its chimney, if it has one with a fire in it, and when its smoke rises, from 0 to 1. */
  flue: { top: Point; phase: number } | undefined;
}

/** A building's footprint on the plan: its middle, which way its ridge runs, and its half sizes. */
interface Footprint {
  x: number;
  z: number;
  ax: number;
  az: number;
  halfA: number;
  halfC: number;
}

/** Faces turned one way, drawn as one: their outlines, which way they are turned, and their hatching. */
interface Strewn {
  shapes: Point[][];
  path: Path2D;
  normal: Vec3;
  hatch: Hatch | undefined;
}

/** The carved rock of a stretch of shore, ready to draw. */
interface Crag {
  /** Its faces, in sets each turned one way, keyed by how they are turned. */
  faces: Map<string, Strewn>;
  /** The lines carved on it, in the widths of `CUT_WIDTHS`. */
  cuts: Path2D[];
  /**
   * Its bare top between its brink and the grass standing back from it, the brink along the top
   * of its face, the cracks running back across its top from the joints below, and the tufts
   * along the edge of the grass.
   */
  top: Path2D;
  brink: Path2D;
  cracks: Path2D;
  fringe: Path2D;
}

/** A harbor wall along the front of a layer's land, and the walk along its top, built. */
interface Harbor {
  /** The wall's face, from the coping down past low water, and the coping along its top. */
  face: Shaded;
  coping: Path2D;
  /** The lines between its stones, and its two ends and the shadow under its coping. */
  joints: Path2D;
  edges: Path2D;
  /** The walk, the coping stones along its edge, its back edge, and the cobbles over it. */
  walk: Path2D;
  kerb: Path2D;
  back: Path2D;
  cobbles: Path2D;
}

/**
 * A tree or bush, built. Its shapes are in its own frame, about the middle of its crown with its
 * half-width as the unit and y up.
 */
interface Tree {
  leaves: Leaves;
  /** The middle of its crown and its foot, on the page in its layer's meters, and its half-width. */
  middle: Point;
  foot: Point;
  radius: number;
  /** How high the middle of its crown stands above its foot, in half-widths. */
  height: number;
  /** How far back in the view it stands. */
  back: number;
  crown: Path2D;
  /** The outline of its crown, to hatch it and shade it by. */
  points: Point[];
  trunk: { path: Path2D; bark: keyof typeof BARK } | undefined;
  /** Arcs along the shaded edges of its clusters of leaves, with the light from the left and from the right. */
  clusters: [Path2D, Path2D];
  /** Its hatching, leaning either way, at the gap it was last drawn at. */
  hatch: [Hatch | undefined, Hatch | undefined];
}

/** A stand of trees, or a clump of bushes. */
interface Grove {
  /** From the back of the view to the front. */
  trees: Tree[];
  /** Across its largest crown, in meters, and how far across the page it reaches. */
  size: number;
  left: number;
  right: number;
  /**
   * Its crowns drawn small, as one: each kind of leaves as one shape, the sides of them turned from
   * the light from the left and from the right, and their undersides.
   */
  bodies: Map<Leaves, Path2D>;
  shade: [Path2D, Path2D];
  under: Path2D;
}

/**
 * How the crowns of trees and bushes are drawn in one frame, in a crown's own frame where the
 * gradients lie: each kind of leaves, paler at the top and darker beneath, and flat for drawing
 * them small; their bark; the tone and hatching deepening across a crown away from the light;
 * which way the light comes across, 0 from the left and 1 from the right; how dark a small crown's
 * shaded side and underside are; and the ink of the clusters of leaves and the outlines.
 */
interface Foliage {
  leaves: Record<Leaves, CanvasGradient>;
  flat: Record<Leaves, string>;
  bark: Record<keyof typeof BARK, string>;
  tone: CanvasGradient;
  sparse: CanvasGradient;
  dense: CanvasGradient;
  side: 0 | 1;
  shade: string;
  under: string;
  clusters: string;
  outline: string;
  /** How many more crowns may have their hatching laid afresh this frame. */
  hatches: number;
}

/** A street lamp, built: its post and lantern, and where its light shines from and falls. */
interface Lamp {
  post: Path2D;
  lantern: Path2D;
  light: Point;
  pool: Point;
}

/**
 * A bench, built: its iron legs behind and before its seat, its back, its seat and the seat's
 * front edge, and its outline.
 */
interface Bench {
  hind: Path2D;
  fore: Path2D;
  back: Shaded;
  seat: Shaded;
  edge: Path2D;
  outline: Path2D;
}

/** Something standing on the ground, drawn in order from the back of the view to the front. */
type Item =
  | { kind: "house"; house: House }
  | { kind: "grove"; grove: Grove }
  | { kind: "lamp"; lamp: Lamp }
  | { kind: "bench"; bench: Bench };

/** An item, where it stands back in the view, and how far across the page it reaches. */
interface Standing {
  item: Item;
  back: number;
  left: number;
  right: number;
}

/** A row of a layer's ground, between two edges, as it shows on the page. */
interface Band {
  cover: Cover;
  path: Path2D;
  facets: Facet[];
  /** Its front and back edges on the page, left to right. */
  front: Point[];
  back: Point[];
}

/**
 * A facet of a row of ground, which takes the light its own way: how far it reaches across the
 * page, how far back its back edge stands, and whether it is one of the shallow strips the row is
 * cut into where the ground folds over itself, painted afresh over those behind it.
 */
interface Facet extends Shaded {
  left: number;
  right: number;
  back: number;
  folded: boolean;
}

/** A stretch of a layer's ground across the page, drawn only while it is in view. */
interface Stretch {
  from: number;
  to: number;
  tufts: Path2D;
  crag: Crag;
}

/**
 * A layer's ground, built: its rows, its lanes, the face of its shore down into the water, its
 * harbor wall if it has one, and its stretches.
 */
interface Ground {
  bands: Band[];
  lanes: Path2D;
  /** Everything of it above the water, as one shape. */
  whole: Path2D;
  /** The face of its shore, from the brink of the land down past low water, out round the tip of its point. */
  shore: Path2D;
  harbor: Harbor | undefined;
  stretches: Stretch[];
}

/** A layer of the village, built. */
interface Layer {
  spec: LayerSpec;
  quay: number;
  ground: Ground;
  houses: House[];
  lamps: Lamp[];
  /** Every tree and bush on it, for their shadows. */
  trees: Tree[];
  standing: Standing[];
  /** Everything in it as one shape, for laying the grain over. */
  whole: Path2D;
}

/**
 * A fishing village on the far shore across the water, to the right of the cliff: a dense cluster
 * of red and white houses around a point of land, cabins and warehouses along its quay, a main
 * street behind them with lamps along it, rows of houses up the slope with lanes between, green
 * hills rising behind with a few houses alone on them, and a low shore far off to the left with a
 * few more. The village is seen from in front, a little to its left and above, all at the one
 * angle, its houses standing level on the ground. Each is lit by the sun or the moon as the hives
 * are, its shaded walls and roofs toned and hatched, its eaves shading its walls and its body
 * throwing a shadow on the ground, and its windows light one by one as the evening comes on, warm
 * and glowing, their light pooling on the street and shimmering on the water. The village, its
 * hills and the far shore stand at their own distances, so they slide past one another and the
 * near land as the view pans. Sailboats work back and forth on the water in front of it.
 */
export class Village {
  private readonly layers: Layer[];

  constructor(shore: Shore) {
    // The quay stands just clear of high water, and the land runs down past low water.
    const quay = shore.midTide + shore.tide + 0.4;
    const lowest = shore.midTide - shore.tide - FOOT;
    const rng = new Rng(0x5ea);
    this.layers = LAYERS.map((spec) => buildLayer(spec, quay, lowest, rng));
  }

  /**
   * Draws the village and the boats in front of it over the far sea, down to the water's edge
   * where the tide stands now, with snow lying `snow` meters deep. `grain` is the sand's grain,
   * laid over it as over the ink.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    light: SkyLight,
    sea: Sea,
    season: number,
    snow: number,
    grain: CanvasPattern,
  ): void {
    const look = lookOf(light, season, snow, sea.clock, sea.wind);
    for (const layer of this.layers) {
      drawLayer(ctx, camera, layer, look, sea, grain);
    }
    for (const spec of SAILS) {
      drawSailboat(ctx, camera, spec, look, sea);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

/** Builds a layer: its ground, the houses and lamps on it, and the trees and bushes about them. */
function buildLayer(
  spec: LayerSpec,
  quay: number,
  lowest: number,
  rng: Rng,
): Layer {
  const ground = buildGround(spec.ground, quay, lowest, rng);
  const houses = spec.houses.map((house) =>
    buildHouse(house, spec.ground, quay, rng),
  );
  for (let i = 0; i < houses.length; i += 1) {
    for (let j = i + 1; j < houses.length; j += 1) {
      const a = at(houses, i).footprint;
      const b = at(houses, j).footprint;
      invariant(
        !overlapping(a, b),
        `The houses at ${a.x} m and ${b.x} m along the shore stand on one another.`,
      );
    }
  }
  const footprints = houses.map((house) => house.footprint);
  const lamps = spec.lamps.map((lamp) => buildLamp(lamp, spec.ground, quay));
  const standing: Standing[] = [];
  for (const house of houses) {
    let left = Infinity;
    let right = -Infinity;
    for (const face of house.faces) {
      for (const p of face.points) {
        left = Math.min(left, p.x);
        right = Math.max(right, p.x);
      }
    }
    standing.push({
      item: { kind: "house", house },
      back: depthOf(house.footprint.x, house.footprint.z),
      left,
      right,
    });
  }
  for (const [i, lamp] of lamps.entries()) {
    const spot = at(spec.lamps, i);
    standing.push({
      item: { kind: "lamp", lamp },
      back: depthOf(spot.x, spot.z),
      left: lamp.light.x - 1,
      right: lamp.light.x + 1,
    });
  }
  for (const spot of spec.benches) {
    invariant(
      onWalk(spec.ground, spot.x, spot.z + BENCH.deep / 2, 0),
      `The bench at ${spot.x} m along the shore stands off the walk.`,
    );
    const bench = buildBench(spot, spec.ground, quay);
    const foot = onPage({ x: spot.x, y: quay, z: spot.z });
    standing.push({
      item: { kind: "bench", bench },
      back: depthOf(spot.x, spot.z),
      left: foot.x - BENCH.length,
      right: foot.x + BENCH.length,
    });
  }
  const groves = plant(spec.ground, quay, footprints, rng);
  const trees: Tree[] = [];
  for (const grove of groves) {
    trees.push(...grove.trees);
    standing.push({
      item: { kind: "grove", grove },
      back:
        grove.trees.reduce((sum, tree) => sum + tree.back, 0) /
        grove.trees.length,
      left: grove.left,
      right: grove.right,
    });
  }
  // The farthest back first, so what stands in front covers it.
  standing.sort((a, b) => b.back - a.back);

  const whole = new Path2D(ground.whole);
  for (const house of houses) {
    for (const face of house.faces) {
      whole.addPath(face.path);
    }
  }
  return { spec, quay, ground, houses, lamps, trees, standing, whole };
}

/**
 * How far back in the view a thing standing at `x` along the shore and `z` back from the water
 * is, along the line of sight, so things can be drawn from the back to the front.
 */
function depthOf(x: number, z: number): number {
  return z + VIEW.left * x;
}

/** Height of `ground` above the quay at `x` along the shore and `z` back from the water. */
function heightAt(ground: GroundSpec, x: number, z: number): number {
  const edges = ground.edges;
  let i = 0;
  while (i + 2 < edges.length && at(edges, i + 1).z <= z) {
    i += 1;
  }
  const a = at(edges, i);
  const b = at(edges, i + 1);
  const t = clamp((z - a.z) / (b.z - a.z), 0, 1);
  const edge = (e: EdgeSpec, n: number): number =>
    through(e.height, x) + (e.rough ?? 0) * valueNoise(x / 9, ground.seed + n);
  const base = lerp(edge(a, i), edge(b, i + 1), t);
  // Knolls and hollows between the edges, which stay where they were laid; none on a street, nor
  // on the walk along a harbor wall, the ground easing level toward it.
  const knolls =
    at(ground.covers, i) === "street"
      ? 0
      : ground.rough *
        Math.sin(Math.PI * t) *
        valueNoise2(x / 11, z / 9, ground.seed) *
        (1 - walkAt(ground, x, z, WALK_EASE));
  // The land falls away toward its coast, down to the shore.
  const fall = smoothstep(0, ground.fall, x - coastAt(ground, z));
  return (base + knolls) * fall;
}

/**
 * Whether `ground` from `from(z)` to `x1` along the shore, between `za` and `zb` back from the
 * water, folds over itself as it is seen: whether, going back along some line of sight, the land
 * dips more than `FOLD` behind a nearer rise, as where it rises from a coast running back faster
 * than the view looks along it.
 */
function folds(
  ground: GroundSpec,
  from: (z: number) => number,
  x1: number,
  za: number,
  zb: number,
): boolean {
  const step = 1;
  const low = Math.min(from(za) - VIEW.left * za, from(zb) - VIEW.left * zb);
  for (let page = low; page <= x1 - VIEW.left * za; page += step) {
    let highest = -Infinity;
    for (let z = za; z <= zb; z += step) {
      const x = page + VIEW.left * z;
      if (x < from(z) || x > x1) {
        continue;
      }
      const y = heightAt(ground, x, z) + VIEW.up * z;
      if (highest - y > FOLD) {
        return true;
      }
      highest = Math.max(highest, y);
    }
  }
  return false;
}

/**
 * How far the spot (`x`, `z`) lies on the walk along `ground`'s harbor wall: 1 on it, easing to 0
 * `ease` meters off it.
 */
function walkAt(ground: GroundSpec, x: number, z: number, ease: number): number {
  const harbor = ground.harbor;
  if (harbor === undefined) {
    return 0;
  }
  const off = Math.max(harbor.from - x, x - harbor.to, z - harbor.walk, 0);
  return 1 - smoothstep(0, ease, off);
}

/** Whether the spot (`x`, `z`) is on the walk along `ground`'s harbor wall, or within `margin` of it. */
function onWalk(
  ground: GroundSpec,
  x: number,
  z: number,
  margin: number,
): boolean {
  const harbor = ground.harbor;
  return (
    harbor !== undefined &&
    x > harbor.from - margin &&
    x < harbor.to + margin &&
    z < harbor.walk + margin
  );
}

/**
 * Where `ground`'s land begins along the shore, `z` back from the water, in little coves and
 * points. The coast never runs back more slowly than the view looks along it, so no land farther
 * back stands out on the page past the land in front of it, over nothing.
 */
function coastAt(ground: GroundSpec, z: number): number {
  const table = coastOf(ground);
  const i = clamp(z / COAST_TABLE, 0, table.length - 1);
  const below = Math.floor(i);
  const above = Math.min(table.length - 1, below + 1);
  return lerp(at(table, below), at(table, above), i - below);
}

const coasts = new WeakMap<GroundSpec, number[]>();

/** `ground`'s coast every `COAST_TABLE` meters back from the water, worked out once. */
function coastOf(ground: GroundSpec): number[] {
  const known = coasts.get(ground);
  if (known !== undefined) {
    return known;
  }
  const deepest =
    Math.max(
      at(ground.edges, ground.edges.length - 1).z,
      at(ground.coast, ground.coast.length - 1)[0],
    ) + 20;
  const table: number[] = [];
  let farthest = -Infinity;
  for (let i = 0; i * COAST_TABLE <= deepest; i += 1) {
    const z = i * COAST_TABLE;
    const wandering =
      through(ground.coast, z) +
      COVES * smoothstep(0, 4, z) * valueNoise(z / 6, ground.seed + 11);
    // Where its land begins on the page, kept from falling back left of any nearer land's.
    farthest = Math.max(farthest, wandering - VIEW.left * z);
    table.push(farthest + VIEW.left * z);
  }
  coasts.set(ground, table);
  return table;
}

/** Whether the spot (`x`, `z`) is on a lane of `ground`, or within `margin` of one. */
function onLane(
  ground: GroundSpec,
  x: number,
  z: number,
  margin: number,
): boolean {
  for (const lane of ground.lanes) {
    for (let i = 0; i + 1 < lane.points.length; i += 1) {
      const [x0, z0] = at(lane.points, i);
      const [x1, z1] = at(lane.points, i + 1);
      const dx = x1 - x0;
      const dz = z1 - z0;
      const t = clamp(
        ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz),
        0,
        1,
      );
      if (
        Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t)) <
        lane.width / 2 + margin
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Which cover lies on `ground` at `z` back from the water. */
function coverAt(ground: GroundSpec, z: number): Cover {
  for (let i = 0; i + 1 < ground.edges.length; i += 1) {
    if (z < at(ground.edges, i + 1).z) {
      return at(ground.covers, i);
    }
  }
  return at(ground.covers, ground.covers.length - 1);
}

/**
 * Builds a layer's ground: its rows as bands on the page, each parted into facets that take the
 * light their own way; its lanes; the grass along the top of its shore and the rocks below it;
 * and tufts of grass over it.
 */
function buildGround(
  spec: GroundSpec,
  quay: number,
  lowest: number,
  rng: Rng,
): Ground {
  invariant(
    spec.covers.length === spec.edges.length - 1,
    "A layer's ground needs one cover for each row between its edges.",
  );
  const step = 1.5;
  const place = (x: number, z: number): Point =>
    onPage({ x, y: quay + heightAt(spec, x, z), z });
  const edgeLine = (z: number, from: number, to: number): Point[] => {
    const points: Point[] = [];
    for (let x = from; x < to; x += step) {
      points.push(place(x, z));
    }
    points.push(place(to, z));
    return points;
  };

  const bands: Band[] = [];
  const whole = new Path2D();
  for (let i = 0; i + 1 < spec.edges.length; i += 1) {
    const za = at(spec.edges, i).z;
    const zb = at(spec.edges, i + 1).z;
    // The coast between the row's edges, from its back down to its front, in its coves and points.
    const depths: number[] = [];
    for (let z = zb; z > za; z -= COAST_STEP) {
      depths.push(z);
    }
    depths.push(za);
    const front = edgeLine(za, coastAt(spec, za), spec.reach);
    const back = edgeLine(zb, coastAt(spec, zb), spec.reach);
    const coast = depths.map((z) => place(coastAt(spec, z), z));
    const path = shapeOf([...front, ...[...back].reverse(), ...coast]);
    whole.addPath(path);
    // Facets are strips of the row along the shore, each cut off on the left by the coast. Where
    // the land rising from a coast that runs back folds over itself as it is seen, a facet is cut
    // into shallow strips back from the water instead, each painted over those behind it, so the
    // rise hides the land behind it as it should.
    const facets: Facet[] = [];
    const first = Math.min(...depths.map((z) => coastAt(spec, z)));
    const rising =
      Math.max(...depths.map((z) => coastAt(spec, z))) + spec.fall * 1.5;
    for (let x0 = first; x0 < spec.reach; x0 += spec.facet) {
      const x1 = Math.min(x0 + spec.facet, spec.reach);
      const from = (z: number): number =>
        Math.min(x1, Math.max(x0, coastAt(spec, z)));
      if (depths.every((z) => from(z) >= x1)) {
        continue;
      }
      const folded = x0 < rising && folds(spec, from, x1, za, zb);
      if (folded) {
        invariant(
          spec.lanes.every((lane) =>
            lane.points.every(([lx, lz]) => lx > x1 || lz < za || lz > zb),
          ),
          `A lane runs where the ground folds over itself, ${x0} m along the shore.`,
        );
      }
      const strips = folded ? Math.ceil((zb - za) / FOLDED_STRIP) : 1;
      for (let s = strips - 1; s >= 0; s -= 1) {
        const z0 = lerp(za, zb, s / strips);
        const z1 = lerp(za, zb, (s + 1) / strips);
        const between = depths.filter((z) => z < z1 && z > z0);
        if ([z1, ...between, z0].every((z) => from(z) >= x1)) {
          continue;
        }
        const points = [
          ...edgeLine(z0, from(z0), x1),
          ...edgeLine(z1, from(z1), x1).reverse(),
          ...between.map((z) => place(from(z), z)),
        ];
        const zm = (z0 + z1) / 2;
        const xm = (from(zm) + x1) / 2;
        const slopeX =
          (heightAt(spec, xm + 1, zm) - heightAt(spec, xm - 1, zm)) / 2;
        const slopeZ =
          (heightAt(spec, xm, Math.min(z1, zm + 0.5)) -
            heightAt(spec, xm, Math.max(z0, zm - 0.5))) /
          (Math.min(z1, zm + 0.5) - Math.max(z0, zm - 0.5));
        let left = Infinity;
        let right = -Infinity;
        for (const p of points) {
          left = Math.min(left, p.x);
          right = Math.max(right, p.x);
        }
        const facet = {
          points,
          path: shapeOf(points),
          normal: unit(-slopeX, 1, slopeZ),
          hatch: undefined,
          left,
          right,
          back: z1,
          folded,
        };
        if (folded) {
          whole.addPath(facet.path);
        }
        facets.push(facet);
      }
    }
    // From the back of the view to the front.
    facets.sort((a, b) => b.back - a.back);
    bands.push({ cover: at(spec.covers, i), path, facets, front, back });
  }

  // The lanes, each a strip along its course laid on the ground, as wide either side of its
  // middle, square to the way it runs.
  const lanes = new Path2D();
  for (const lane of spec.lanes) {
    const course: Spot[] = [];
    for (let i = 0; i + 1 < lane.points.length; i += 1) {
      const [x0, z0] = at(lane.points, i);
      const [x1, z1] = at(lane.points, i + 1);
      const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0)));
      for (let s = i === 0 ? 0 : 1; s <= steps; s += 1) {
        const t = s / steps;
        course.push({ x: lerp(x0, x1, t), z: lerp(z0, z1, t) });
      }
    }
    const left: Point[] = [];
    const right: Point[] = [];
    for (const [i, spot] of course.entries()) {
      const before = at(course, Math.max(0, i - 1));
      const after = at(course, Math.min(course.length - 1, i + 1));
      const length = Math.hypot(after.x - before.x, after.z - before.z);
      const sx = ((before.z - after.z) / length) * (lane.width / 2);
      const sz = ((after.x - before.x) / length) * (lane.width / 2);
      left.push(place(spot.x + sx, spot.z + sz));
      right.push(place(spot.x - sx, spot.z - sz));
    }
    lanes.addPath(shapeOf([...left, ...right.reverse()]));
  }

  // The face of the shore below the brink of the land, from the tip of its point, where it steps
  // out into the water, along to the right.
  const start = coastAt(spec, 0);
  const lip = edgeLine(0, start, spec.reach);
  const brink = (x: number): number => place(x, 0).y;
  const tip = tipOf(start, brink(start), lowest, rng);
  const face = shapeOf([
    ...tip,
    { x: spec.reach, y: lowest },
    ...[...lip].reverse(),
  ]);
  whole.addPath(face);
  const shore = new Path2D(face);

  const stretches: Stretch[] = [];
  const firstPage = start - VIEW.left * at(spec.edges, spec.edges.length - 1).z;
  for (let from = firstPage - STRETCH; from < spec.reach; from += STRETCH) {
    stretches.push({
      from,
      to: from + STRETCH,
      tufts: new Path2D(),
      crag: {
        faces: new Map(),
        cuts: CUT_WIDTHS.map(() => new Path2D()),
        top: new Path2D(),
        brink: new Path2D(),
        cracks: new Path2D(),
        fringe: new Path2D(),
      },
    });
  }
  const stretchAt = (pageX: number): Stretch =>
    at(
      stretches,
      clamp(
        Math.floor((pageX - (firstPage - STRETCH)) / STRETCH),
        0,
        stretches.length - 1,
      ),
    );

  // Tufts of grass strewn over the rows that are not streets, each a few blades fanning up from
  // the ground and bending outward.
  const lastZ = at(spec.edges, spec.edges.length - 1).z;
  for (let z = 0.6; z < lastZ; z += spec.tufts * rng.range(0.5, 1)) {
    if (coverAt(spec, z) === "street") {
      continue;
    }
    for (
      let x = coastAt(spec, z) + rng.range(0, spec.tufts);
      x < Math.min(spec.reach, 520);
      x += spec.tufts * rng.range(0.8, 1.6)
    ) {
      if (onLane(spec, x, z, 0) || onWalk(spec, x, z, 0.1)) {
        continue;
      }
      const p = place(x, z);
      const tufts = stretchAt(p.x).tufts;
      const blades = Math.round(rng.range(...TUFTS.blades));
      const tall = rng.range(...TUFTS.tall);
      const lean = rng.range(-0.2, 0.2);
      for (let b = 0; b < blades; b += 1) {
        const out = TUFTS.fan * ((2 * (b + 0.5)) / blades - 1);
        const tip = Math.PI / 2 + lean + out + rng.range(-0.12, 0.12);
        const bend = Math.PI / 2 + lean + out * 0.3;
        const length = tall * rng.range(0.6, 1);
        const root = p.x + rng.range(-0.04, 0.04);
        tufts.moveTo(root, p.y);
        tufts.lineTo(
          root + Math.cos(bend) * length * 0.5,
          p.y + Math.sin(bend) * length * 0.5,
        );
        tufts.lineTo(
          root + Math.cos(tip) * length,
          p.y + Math.sin(tip) * length,
        );
      }
    }
  }

  // The rock is carved wherever it shows: out round the tip of the point and along to the harbor
  // wall, and on past it, or along the whole shore if there is none.
  const end = Math.min(spec.rocks, spec.reach);
  const harbor = spec.harbor;
  const plumb = (x: number): Point[] => [
    { x, y: brink(x) },
    { x, y: lowest },
  ];
  const stretchesOfRock: {
    from: number;
    to: number;
    first: Point[];
    last: Point[];
    tip: boolean;
    cutLast: boolean;
  }[] =
    harbor === undefined
      ? [
          {
            from: start,
            to: end,
            first: tip,
            last: plumb(end),
            tip: true,
            cutLast: true,
          },
        ]
      : [
          {
            from: start,
            to: harbor.from,
            first: tip,
            last: plumb(harbor.from),
            tip: true,
            cutLast: false,
          },
          {
            from: harbor.to,
            to: end,
            first: plumb(harbor.to),
            last: plumb(end),
            tip: false,
            cutLast: true,
          },
        ];
  const cragAt = (x: number): Crag => stretchAt(x).crag;
  for (const rock of stretchesOfRock) {
    invariant(
      rock.to > rock.from,
      `The shore's rock would end at ${rock.to} m, before it begins at ${rock.from} m.`,
    );
    const joints = carveShore(rock, brink, lowest, cragAt, rng);
    bareTop(spec, rock.from, rock.to, joints, place, cragAt, rng);
  }

  return {
    bands,
    lanes,
    whole,
    shore,
    harbor:
      harbor === undefined
        ? undefined
        : buildHarbor(harbor, brink, lowest, place, rng),
    stretches,
  };
}

/** A set of faces all turned `normal`, with none in it yet. */
function strewnOf(normal: Vec3): Strewn {
  return { shapes: [], path: new Path2D(), normal, hatch: undefined };
}

/**
 * The tip of a point's rock, from the brink of its land at (`x`, `top`) down past low water at
 * `lowest`, falling out into the water as a mountain's ridge falls to its foot: steep under the
 * brink and spreading out toward the water, over a shoulder partway down, with small jags along
 * the way. Runs from the top down.
 */
function tipOf(x: number, top: number, lowest: number, rng: Rng): Point[] {
  const drop = top - lowest;
  const reach = TIP.out * drop;
  const bench = rng.range(0.3, 0.55);
  const shoulder = rng.range(...TIP.shoulder) * reach;
  const line: Point[] = [{ x, y: top }];
  const steps = 14;
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const out =
      reach * Math.pow(t, 1.35) +
      shoulder * Math.exp(-(((t - bench) / 0.1) ** 2));
    line.push({
      x: x - out + rng.range(-1, 1) * TIP.jag * drop,
      y: top - drop * t + rng.range(-1, 1) * TIP.jag * drop,
    });
  }
  line.push({ x: x - reach, y: lowest });
  return line;
}

/** The point where `line`, running down from its top, reaches the height `y`. */
function downTo(line: readonly Point[], y: number): Point {
  for (let i = 0; i + 1 < line.length; i += 1) {
    const p = at(line, i);
    const q = at(line, i + 1);
    if (y <= p.y && y >= q.y) {
      const t = p.y === q.y ? 0 : (p.y - y) / (p.y - q.y);
      return { x: lerp(p.x, q.x, t), y };
    }
  }
  throw new Error(
    `A line running down from ${at(line, 0).y} m never reaches ${y} m.`,
  );
}

/** The part of `line`, running down from its top, between the heights `high` and `low`, from the top down. */
function between(line: readonly Point[], high: number, low: number): Point[] {
  return [
    downTo(line, high),
    ...line.filter((p) => p.y < high && p.y > low),
    downTo(line, low),
  ];
}

/**
 * A line running down from (`x0`, `y0`) to (`x1`, `y1`), wandering up to `wander` meters either
 * side along the way, the more so the farther it has come from its top.
 */
function lineDown(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  wander: number,
  seed: number,
): Point[] {
  const points: Point[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const side =
      i === 0 || i === steps
        ? 0
        : wander * valueNoise(t * 2.6, seed) * Math.min(1, t * 4);
    points.push({ x: lerp(x0, x1, t) + side, y: lerp(y0, y1, t) });
  }
  return points;
}

/** Where a joint or arête parts two faces of rock: the line itself, and the edges of the faces on its left and right, which a band along it sets back from it. */
interface Parting {
  line: Point[];
  left: Point[];
  right: Point[];
}

/**
 * Carves the rock of a stretch of shore from `rock.from` to `rock.to` along it, below the brink of
 * the land, `brink(x)` high, down past low water at `lowest`, as the mountains are carved. Joints
 * run down the face from the brink, between `rock.first` and `rock.last`, parting it into
 * buttresses, and an arête down many of them turns their halves to either side; a narrow band
 * along many of these lines turns hard into the cleft; forks branch off them, a ledge crosses some
 * faces, and creases wander down from the brink and fade out. Out at the tip of a point the rock
 * is turned toward the open water on the left. Files each face, by the way it is turned, and each
 * line, as wide as it is along its length, in the crag of the stretch of the page it lies in.
 * Returns where along the shore each joint meets the brink.
 */
function carveShore(
  rock: {
    from: number;
    to: number;
    first: Point[];
    last: Point[];
    tip: boolean;
    cutLast: boolean;
  },
  brink: (x: number) => number,
  lowest: number,
  cragAt: (x: number) => Crag,
  rng: Rng,
): number[] {
  const seed = rng.next() * 1000;
  const cut = (points: readonly Point[], weight: (t: number) => number): void => {
    for (let i = 0; i + 1 < points.length; i += 1) {
      const t = (i + 0.5) / (points.length - 1);
      const width = weight(t);
      let nearest = 0;
      for (let w = 1; w < CUT_WIDTHS.length; w += 1) {
        if (
          Math.abs(at(CUT_WIDTHS, w) - width) <
          Math.abs(at(CUT_WIDTHS, nearest) - width)
        ) {
          nearest = w;
        }
      }
      const p = at(points, i);
      const q = at(points, i + 1);
      const path = at(cragAt(p.x).cuts, nearest);
      path.moveTo(p.x, p.y);
      path.lineTo(q.x, q.y);
    }
  };
  // Along the brink, every so often, so a run of it follows the land's edge.
  const run = (x0: number, x1: number): Point[] => {
    const points: Point[] = [];
    const steps = Math.max(1, Math.ceil(Math.abs(x1 - x0) / 0.75));
    for (let i = 0; i <= steps; i += 1) {
      const x = lerp(x0, x1, i / steps);
      points.push({ x, y: brink(x) });
    }
    return points;
  };
  // A face turned `turn` to the side, from -1 to the left to 1 to the right, and tipped `tilt` up
  // or down, filed with the others turned its way.
  const piece = (points: Point[], turn: number, tilt: -1 | 0 | 1): void => {
    const side = Math.round(clamp(turn, -1, 1) * 3) / 3;
    const key = `${side},${tilt}`;
    let x = 0;
    for (const p of points) {
      x += p.x;
    }
    const crag = cragAt(x / points.length);
    let faces = crag.faces.get(key);
    if (faces === undefined) {
      faces = strewnOf(unit(CRAG_TURN * side, 0.14 * tilt, 1));
      crag.faces.set(key, faces);
    }
    faces.shapes.push(points);
    quadInto(faces.path, points);
  };
  // `line` as it parts two faces, with a band along one side of it most of the time, no wider
  // than a share of the room on that side, turned hard into the cleft: on the line's right it
  // faces left, and on its left, right.
  const parting = (
    line: Point[],
    roomLeft: number,
    roomRight: number,
  ): Parting => {
    const bare = { line, left: line, right: line };
    if (rng.next() >= CRAG.band) {
      return bare;
    }
    const side = rng.next() < 0.5 ? -1 : 1;
    const wide = Math.min(
      rng.range(...CRAG.bandWide),
      0.22 * (side > 0 ? roomRight : roomLeft),
    );
    if (wide < 0.12) {
      return bare;
    }
    const last = line.length - 1;
    const edge = line.map((p, i) => {
      if (i === 0 || i === last) {
        return p;
      }
      const t = i / last;
      return {
        x: p.x + side * wide * Math.sin(Math.PI * t) * (1 - 0.35 * t),
        y: p.y,
      };
    });
    cut(edge, CUTS.band);
    piece([...line, ...[...edge].reverse().slice(1, -1)], -side, 0);
    return side > 0
      ? { line, left: line, right: edge }
      : { line, left: edge, right: line };
  };
  // A face between the lines `left` and `right`, each running down from the brink: maybe crossed
  // by a ledge, with a fork off one side and creases wandering down into it from the brink, all
  // ending above the ledge or the water.
  const face = (left: Point[], right: Point[], turn: number): void => {
    const top = run(at(left, 0).x, at(right, 0).x);
    const high = Math.min(at(left, 0).y, at(right, 0).y);
    const wide = at(right, 0).x - at(left, 0).x;
    let floor = lowest;
    if (wide > 1.2 && rng.next() < CRAG.ledge) {
      const yl = lerp(at(left, 0).y, lowest, rng.range(...CRAG.ledgeAt));
      const yr = clamp(
        yl + rng.range(-0.25, 0.25),
        lowest + 0.5,
        at(right, 0).y - 0.5,
      );
      const a = downTo(left, yl);
      const b = downTo(right, yr);
      const ledge: Point[] = [];
      for (let i = 0; i <= 8; i += 1) {
        const t = i / 8;
        ledge.push({
          x: lerp(a.x, b.x, t),
          y:
            lerp(a.y, b.y, t) +
            (i === 0 || i === 8
              ? 0
              : 0.12 * Math.sin(Math.PI * t) +
                0.06 * valueNoise(t * 3, seed + a.x)),
        });
      }
      cut(ledge, CUTS.ledge);
      piece(
        [
          ...top,
          ...between(right, at(right, 0).y, b.y).slice(1),
          ...[...ledge].reverse().slice(1),
          ...between(left, at(left, 0).y, a.y).reverse().slice(1, -1),
        ],
        turn,
        1,
      );
      piece(
        [
          ...ledge,
          ...between(right, b.y, lowest).slice(1),
          ...between(left, a.y, lowest).reverse().slice(0, -1),
        ],
        turn + rng.range(-0.25, 0.25),
        -1,
      );
      floor = Math.max(a.y, b.y);
    } else {
      piece(
        [
          ...top,
          ...between(right, at(right, 0).y, lowest).slice(1),
          ...between(left, at(left, 0).y, lowest).reverse().slice(0, -1),
        ],
        turn,
        0,
      );
    }
    const fits = (x: number, y: number): boolean =>
      x > downTo(left, y).x + 0.2 && x < downTo(right, y).x - 0.2;
    // A fork off one side, heading down and in.
    if (wide > 1 && rng.next() < CRAG.fork) {
      const fromRight = rng.next() < 0.5;
      const along = fromRight ? right : left;
      const y0 = lerp(high, floor, rng.range(0.12, 0.4));
      const reach = Math.min(
        (high - lowest) * rng.range(...CRAG.forkReach),
        y0 - floor - 0.3,
      );
      if (reach > 0.4) {
        const start = downTo(along, y0);
        const y1 = y0 - reach;
        const x1 = start.x + (fromRight ? -1 : 1) * reach * rng.range(0.3, 0.65);
        if (fits(x1, y1)) {
          cut(lineDown(start.x, y0, x1, y1, 0.06, seed + y0 * 5.3), CUTS.fork);
        }
      }
    }
    // Creases down from the brink.
    const creases = Math.floor(rng.range(0, CRAG.creases + 1));
    for (let c = 0; c < creases; c += 1) {
      const x0 = lerp(at(left, 0).x, at(right, 0).x, rng.range(0.15, 0.85));
      const y0 = brink(x0);
      const reach = Math.min(
        (high - lowest) * rng.range(...CRAG.crease),
        y0 - floor - 0.3,
      );
      if (reach < 0.4) {
        continue;
      }
      const y1 = y0 - reach;
      const x1 = x0 + rng.range(-0.15, 0.15) * reach;
      if (fits(x1, y1)) {
        cut(lineDown(x0, y0, x1, y1, 0.06, seed + x0 * 3.1), CUTS.crease);
      }
    }
  };

  // The joints, each running down from the brink, between the first line and the last. Near the
  // tip of a point they stand closer and fan out, leaning with its fall into the water.
  const fanOf = (x: number): number =>
    rock.tip ? FAN.keep * (1 - smoothstep(0, FAN.reach, x - rock.from)) : 0;
  const lines: Point[][] = [rock.first];
  const apart = (x: number): number =>
    fanOf(x) > 0.1 ? rng.range(...FAN.apart) : rng.range(...CRAG.apart);
  for (
    let x = rock.from + apart(rock.from);
    x < rock.to - CRAG.apart[0] * 0.6;
    x += apart(x)
  ) {
    const top = brink(x);
    const drop = top - lowest;
    const lean =
      rng.range(-CRAG.lean, CRAG.lean) * drop * (1 - fanOf(x)) -
      TIP.out * drop * fanOf(x);
    const joint = lineDown(x, top, x + lean, lowest, CRAG.wander, seed + x);
    lines.push(joint);
    cut(joint, CUTS.joint);
  }
  lines.push(rock.last);
  if (rock.cutLast) {
    cut(rock.last, CUTS.joint);
  }
  if (rock.tip) {
    cut(rock.first, CUTS.arete);
  }
  const roomOf = (j: number): number =>
    j < 0 || j + 1 >= lines.length
      ? 0
      : at(at(lines, j + 1), 0).x - at(at(lines, j), 0).x;
  const partings = lines.map((line, j) =>
    j === 0 || j === lines.length - 1
      ? { line, left: line, right: line }
      : parting(line, roomOf(j - 1), roomOf(j)),
  );

  // From each joint to the next a buttress, split down an arête into halves turned either way;
  // near the tip of a point, turned out over the open water.
  for (let j = 0; j + 1 < partings.length; j += 1) {
    const left = at(partings, j).right;
    const right = at(partings, j + 1).left;
    const atTip = rock.tip && j === 0;
    const fan = fanOf((at(left, 0).x + at(right, 0).x) / 2) / FAN.keep;
    const turn = lerp(rng.range(-0.45, 0.45), -0.85, atTip ? 1 : fan);
    const wide = at(right, 0).x - at(left, 0).x;
    if (!atTip && wide > 2.2 && rng.next() < CRAG.arete) {
      const share = rng.range(0.3, 0.7);
      const x0 = lerp(at(left, 0).x, at(right, 0).x, share);
      const x1 = lerp(
        at(left, left.length - 1).x,
        at(right, right.length - 1).x,
        clamp(share + rng.range(-0.2, 0.2), 0.25, 0.75),
      );
      const arete = lineDown(
        x0,
        brink(x0),
        x1,
        lowest,
        CRAG.wander * 0.6,
        seed + x0 * 1.7,
      );
      cut(arete, CUTS.arete);
      const split = parting(arete, x0 - at(left, 0).x, at(right, 0).x - x0);
      face(left, split.left, turn - CRAG.turn);
      face(split.right, right, turn + CRAG.turn);
    } else {
      face(left, right, turn);
    }
  }
  return lines.slice(1, -1).map((line) => at(line, 0).x);
}

/**
 * Lays the bare top of the rock along the brink of `spec`'s land from `from` to `to` along the
 * shore, the grass standing back from the brink by a ragged margin, and keeping inside the coast
 * at the tip of a point: the bare top itself, placed on the page by `place`; the brink along the
 * top of the rock's face; a crack running back across the top from each of `joints`; and tufts
 * along the edge of the grass. Files each in the crag of the stretch of the page it lies in.
 */
function bareTop(
  spec: GroundSpec,
  from: number,
  to: number,
  joints: readonly number[],
  place: (x: number, z: number) => Point,
  cragAt: (x: number) => Crag,
  rng: Rng,
): void {
  const seed = rng.next() * 1000;
  const back = (x: number): number =>
    lerp(
      BARE_TOP.back[0],
      BARE_TOP.back[1],
      0.5 +
        0.4 * valueNoise(x / 2.2, seed) +
        0.1 * valueNoise(x / 0.5, seed + 1),
    );
  // Where the grass begins behind the brink at `x`, kept on the land where the coast runs back.
  const edge = (x: number): Point => {
    const z = back(x);
    return place(Math.max(x, coastAt(spec, z) + 0.05), z);
  };
  // In pieces no longer than a stretch of the page, each filed where it lies.
  const step = 0.25;
  const piece = 6;
  for (let x0 = from; x0 < to; x0 += piece) {
    const x1 = Math.min(to, x0 + piece);
    const front: Point[] = [];
    const behind: Point[] = [];
    for (let x = x0; x <= x1 + 1e-6; x += step) {
      const cx = Math.min(x, x1);
      front.push(place(cx, 0));
      behind.push(edge(cx));
    }
    const crag = cragAt((x0 + x1) / 2);
    quadInto(crag.top, [...front, ...[...behind].reverse()]);
    front.forEach((p, i) =>
      i === 0 ? crag.brink.moveTo(p.x, p.y) : crag.brink.lineTo(p.x, p.y),
    );
  }
  for (const x of joints) {
    if (x < from || x > to) {
      continue;
    }
    const a = place(x, 0);
    const b = place(x + rng.range(-0.15, 0.15), back(x) * rng.range(0.6, 0.95));
    const cracks = cragAt(x).cracks;
    cracks.moveTo(a.x, a.y);
    cracks.lineTo(b.x, b.y);
  }
  for (let x = from + 0.2; x < to; x += rng.range(...FRINGE.apart)) {
    const root = edge(x);
    const fringe = cragAt(x).fringe;
    const blades = Math.round(rng.range(3, 5));
    for (let b = 0; b < blades; b += 1) {
      const long = rng.range(...FRINGE.long);
      const tip = Math.PI / 2 + rng.range(-0.7, 0.7);
      const bend = Math.PI / 2 + (tip - Math.PI / 2) * 0.4;
      const rx = root.x + rng.range(-0.08, 0.08);
      fringe.moveTo(rx, root.y);
      fringe.lineTo(
        rx + Math.cos(bend) * long * 0.5,
        root.y + Math.sin(bend) * long * 0.5,
      );
      fringe.lineTo(rx + Math.cos(tip) * long, root.y + Math.sin(tip) * long);
    }
  }
}

/**
 * Builds the harbor wall along the front of a layer's land, from the brink of the land, `brink(x)`
 * high, down past low water at `lowest`: its face of dressed stone laid in courses, each stone's
 * joints falling between those of the course above, under a coping of larger stones; and the walk
 * along its top, `spec.walk` meters deep, its coping stones along the water's edge and cobbles
 * laid in rows behind, placed on the ground by `place`.
 */
function buildHarbor(
  spec: HarborSpec,
  brink: (x: number) => number,
  lowest: number,
  place: (x: number, z: number) => Point,
  rng: Rng,
): Harbor {
  const { from, to } = spec;
  const top = brink(from);
  invariant(
    Math.abs(brink(to) - top) < 1e-6,
    `The harbor wall from ${from} m to ${to} m along the shore stands on uneven ground.`,
  );
  const points = [
    { x: from, y: top },
    { x: to, y: top },
    { x: to, y: lowest },
    { x: from, y: lowest },
  ];
  const under = top - HARBOR.coping.high;
  const coping = shapeOf([
    { x: from, y: top },
    { x: to, y: top },
    { x: to, y: under },
    { x: from, y: under },
  ]);
  const joints = new Path2D();
  const kerbJoints: number[] = [];
  for (
    let x = from + rng.range(...HARBOR.coping.long);
    x < to - 0.4;
    x += rng.range(...HARBOR.coping.long)
  ) {
    joints.moveTo(x, top);
    joints.lineTo(x, under);
    kerbJoints.push(x);
  }
  for (let y = under; y > lowest; y -= HARBOR.course) {
    const below = Math.max(lowest, y - HARBOR.course);
    if (y < under) {
      joints.moveTo(from, y);
      joints.lineTo(to, y);
    }
    for (
      let x = from + rng.range(0.2, HARBOR.long[1]);
      x < to - 0.2;
      x += rng.range(...HARBOR.long)
    ) {
      joints.moveTo(x, y);
      joints.lineTo(x, below);
    }
  }
  const edges = new Path2D();
  for (const x of [from, to]) {
    edges.moveTo(x, top);
    edges.lineTo(x, lowest);
  }
  edges.moveTo(from, under);
  edges.lineTo(to, under);

  const along = (z: number): Point[] => {
    const line: Point[] = [];
    const steps = Math.ceil((to - from) / 1.5);
    for (let i = 0; i <= steps; i += 1) {
      line.push(place(lerp(from, to, i / steps), z));
    }
    return line;
  };
  const front = along(0);
  const walkBack = along(spec.walk);
  const kerbBack = along(WALK.kerb);
  const walk = shapeOf([...front, ...[...walkBack].reverse()]);
  const kerb = shapeOf([...front, ...[...kerbBack].reverse()]);
  const back = new Path2D();
  walkBack.forEach((p, i) =>
    i === 0 ? back.moveTo(p.x, p.y) : back.lineTo(p.x, p.y),
  );
  for (const x of [from, to]) {
    const a = place(x, 0);
    const b = place(x, spec.walk);
    back.moveTo(a.x, a.y);
    back.lineTo(b.x, b.y);
  }
  const cobbles = new Path2D();
  for (const x of kerbJoints) {
    const a = place(x, 0);
    const b = place(x, WALK.kerb);
    cobbles.moveTo(a.x, a.y);
    cobbles.lineTo(b.x, b.y);
  }
  kerbBack.forEach((p, i) =>
    i === 0 ? cobbles.moveTo(p.x, p.y) : cobbles.lineTo(p.x, p.y),
  );
  for (
    let z = WALK.kerb + WALK.rows, row = 0;
    z < spec.walk - 0.05;
    z += WALK.rows, row += 1
  ) {
    along(z).forEach((p, i) =>
      i === 0 ? cobbles.moveTo(p.x, p.y) : cobbles.lineTo(p.x, p.y),
    );
    for (
      let x = from + (row % 2 === 0 ? 0.1 : 0.25);
      x < to;
      x += rng.range(...WALK.cobble)
    ) {
      const a = place(x, z - WALK.rows);
      const b = place(x, z);
      cobbles.moveTo(a.x, a.y);
      cobbles.lineTo(b.x, b.y);
    }
  }
  return {
    face: {
      points,
      path: shapeOf(points),
      normal: unit(0, 0, 1),
      hatch: undefined,
    },
    coping,
    joints,
    edges,
    walk,
    kerb,
    back,
    cobbles,
  };
}

/** The part of the outline `points` where `a x + b y + c` is at least zero. */
function clipBy(
  points: readonly Point[],
  a: number,
  b: number,
  c: number,
): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = at(points, i);
    const q = at(points, (i + 1) % points.length);
    const fp = a * p.x + b * p.y + c;
    const fq = a * q.x + b * q.y + c;
    if (fp >= 0) {
      out.push(p);
    }
    if (fp >= 0 !== fq >= 0) {
      const t = fp / (fp - fq);
      out.push({ x: lerp(p.x, q.x, t), y: lerp(p.y, q.y, t) });
    }
  }
  return out;
}

/**
 * Stands of trees and clumps of bushes, set about a layer's ground clear of its houses, its
 * streets and its lanes: trees in woods over the slopes with open grass between, a few here and
 * there between the houses, and bushes along the top of the shore.
 */
function plant(
  spec: GroundSpec,
  quay: number,
  footprints: readonly Footprint[],
  rng: Rng,
): Grove[] {
  const groves: Grove[] = [];
  const clear = (x: number, z: number, margin: number): boolean =>
    x > coastAt(spec, z) + margin &&
    coverAt(spec, z) !== "street" &&
    !onLane(spec, x, z, margin) &&
    !onWalk(spec, x, z, margin) &&
    !footprints.some((f) => within(f, x, z, margin));
  const place = (x: number, z: number): Point =>
    onPage({ x, y: quay + heightAt(spec, x, z), z });
  const lastZ = at(spec.edges, spec.edges.length - 1).z;

  /** A stand of up to `count` trees or bushes about (`x`, `z`), as many as find room. */
  const stand = (
    x: number,
    z: number,
    count: number,
    apart: number,
    leaves: () => Leaves,
  ): void => {
    const trees: Tree[] = [];
    const pick = ([low, high]: readonly [number, number]): number =>
      rng.range(low, high);
    for (let i = 0; i < count; i += 1) {
      const tx = x + rng.range(-1, 1) * apart;
      const tz = z + rng.range(-1, 1) * apart * 0.6;
      const kind = leaves();
      const shape = kind === "bush" ? BUSHES : TREES;
      const size = pick(shape.size);
      if (!clear(tx, tz, size * 0.4)) {
        continue;
      }
      trees.push(
        buildTree(
          place(tx, tz),
          depthOf(tx, tz),
          kind,
          size,
          pick(shape.tall),
          Math.round(pick(shape.clusters)),
          shape.cluster,
          kind === "bush" ? undefined : pick(TREES.trunk),
          rng,
        ),
      );
    }
    if (trees.length > 0) {
      groves.push(buildGrove(trees));
    }
  };
  const tree = (): Leaves => (rng.next() < TREES.rowans ? "rowan" : "birch");

  // Stands of trees, in woods over the scrub of the slopes and one or two among the houses.
  for (let z = 1.5; z < lastZ - 1; z += spec.groves * rng.range(0.5, 0.9)) {
    const scrub = coverAt(spec, z) === "scrub";
    for (
      let x = coastAt(spec, z) + rng.range(0, spec.groves);
      x < Math.min(spec.reach, 520);
      x += spec.groves * rng.range(scrub ? 0.6 : 1.4, scrub ? 1.4 : 3)
    ) {
      if (!scrub) {
        stand(x, z, Math.round(rng.range(1, 2.6)), TREES.apart, tree);
        continue;
      }
      const woods = valueNoise2(x / WOODS.along, z / WOODS.back, spec.seed + 3);
      if (woods < WOODS.open) {
        continue;
      }
      const thick = smoothstep(WOODS.open, 0.6, woods);
      stand(
        x,
        z,
        Math.round(lerp(TREES.stand[0], TREES.stand[1], thick)),
        TREES.apart * lerp(1, 1.8, thick),
        tree,
      );
    }
  }
  // Bushes along the top of the shore, behind the bare rock along its brink.
  if (spec.shrubs > 0) {
    for (
      let x = coastAt(spec, 0.8) + rng.range(0, spec.shrubs);
      x < Math.min(spec.reach, 520);
      x += spec.shrubs * rng.range(0.5, 1.6)
    ) {
      stand(
        x,
        rng.range(BARE_TOP.back[1] + 0.3, BARE_TOP.back[1] + 1.1),
        Math.round(rng.range(...BUSHES.clump)),
        0.9,
        () => "bush",
      );
    }
  }
  return groves;
}

/**
 * Builds a tree or bush standing at `foot` on the page, `back` deep in the view: a crown `size`
 * meters across and `tall` times as tall, of `clusters` clusters of leaves each `cluster` of its
 * width across, on a trunk showing `trunk` of the crown's height below it, or sitting on the
 * ground if it has none.
 */
function buildTree(
  foot: Point,
  back: number,
  leaves: Leaves,
  size: number,
  tall: number,
  clusters: number,
  cluster: number,
  trunk: number | undefined,
  rng: Rng,
): Tree {
  const radius = size / 2;
  // The clusters spiral out from the middle through the crown's oval, each kept inside it.
  const lobes: { x: number; y: number; r: number }[] = [];
  const turn = rng.next() * Math.PI * 2;
  for (let i = 0; i < clusters; i += 1) {
    const out = Math.sqrt((i + 0.5) / clusters);
    const a = turn + i * GOLDEN;
    const r = cluster * rng.range(0.82, 1.18);
    lobes.push({
      x: out * Math.cos(a) * (1 - r),
      y: out * Math.sin(a) * (tall - r),
      r,
    });
  }
  // The crown's outline, as far out along each ray from its middle as any cluster reaches.
  const points: Point[] = [];
  for (let i = 0; i < CROWN_RAYS; i += 1) {
    const a = (i / CROWN_RAYS) * Math.PI * 2;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    let far = 0;
    for (const lobe of lobes) {
      const along = lobe.x * ux + lobe.y * uy;
      const off = lobe.x * uy - lobe.y * ux;
      if (Math.abs(off) < lobe.r) {
        far = Math.max(far, along + Math.sqrt(lobe.r * lobe.r - off * off));
      }
    }
    invariant(far > 0, "A crown's clusters of leaves leave its middle bare.");
    points.push({ x: ux * far, y: uy * far });
  }
  const arcs = (away: number): Path2D => {
    const path = new Path2D();
    for (const lobe of lobes) {
      const from = away - CLUSTER_ARC;
      path.moveTo(
        lobe.x + lobe.r * Math.cos(from),
        lobe.y + lobe.r * Math.sin(from),
      );
      path.arc(lobe.x, lobe.y, lobe.r, from, away + CLUSTER_ARC);
    }
    return path;
  };

  const bark = leaves === "bush" ? undefined : leaves;
  let height = tall * 0.75;
  let stem: Tree["trunk"];
  if (bark !== undefined) {
    invariant(trunk !== undefined, "A tree needs a trunk.");
    height = tall * (1 + 2 * trunk);
    const lean = rng.range(-0.08, 0.08);
    const footHalf = TRUNK.foot / 2 / radius;
    const crownHalf = TRUNK.crown / 2 / radius;
    const path = new Path2D();
    path.moveTo(-footHalf, -height);
    path.lineTo(footHalf, -height);
    path.lineTo(lean + crownHalf, -tall * 0.35);
    path.lineTo(lean - crownHalf, -tall * 0.35);
    path.closePath();
    stem = { path, bark };
  }
  return {
    leaves,
    middle: { x: foot.x, y: foot.y + height * radius },
    foot,
    radius,
    height,
    back,
    crown: shapeOf(points),
    points,
    trunk: stem,
    clusters: [arcs(-Math.PI / 4), arcs((-3 * Math.PI) / 4)],
    hatch: [undefined, undefined],
  };
}

/**
 * Gathers `trees` into a stand, from the back of the view to the front, with their crowns as one
 * for drawing the stand small: each kind of leaves, the sides turned from the light either way,
 * and the undersides.
 */
function buildGrove(trees: Tree[]): Grove {
  trees.sort((a, b) => b.back - a.back);
  const bodies = new Map<Leaves, Path2D>();
  const shade: [Path2D, Path2D] = [new Path2D(), new Path2D()];
  const under = new Path2D();
  let size = 0;
  let left = Infinity;
  let right = -Infinity;
  for (const tree of trees) {
    const frame = {
      a: tree.radius,
      d: tree.radius,
      e: tree.middle.x,
      f: tree.middle.y,
    };
    const body = bodies.get(tree.leaves) ?? new Path2D();
    body.addPath(tree.crown, frame);
    bodies.set(tree.leaves, body);
    const side = SMALL_CROWN.side;
    shade[0].addPath(shapeOf(clipBy(tree.points, 1, 0, -side)), frame);
    shade[1].addPath(shapeOf(clipBy(tree.points, -1, 0, -side)), frame);
    const low = Math.min(...tree.points.map((p) => p.y));
    under.addPath(
      shapeOf(clipBy(tree.points, 0, -1, low * SMALL_CROWN.under)),
      frame,
    );
    size = Math.max(size, tree.radius * 2);
    left = Math.min(left, tree.middle.x - tree.radius * 1.2);
    right = Math.max(right, tree.middle.x + tree.radius * 1.2);
  }
  return { trees, size, left, right, bodies, shade, under };
}

/** Builds a street lamp standing at its spot on `ground`. */
function buildLamp(spec: LampSpec, ground: GroundSpec, quay: number): Lamp {
  const y = quay + heightAt(ground, spec.x, spec.z);
  const foot = onPage({ x: spec.x, y, z: spec.z });
  const post = new Path2D();
  post.rect(foot.x - POST.width / 2, foot.y, POST.width, POST.height);
  const lantern = new Path2D();
  const top = foot.y + POST.height;
  lantern.moveTo(foot.x - POST.lantern / 2, top);
  lantern.lineTo(foot.x + POST.lantern / 2, top);
  lantern.lineTo(foot.x + POST.lantern * 0.35, top + POST.lantern);
  lantern.lineTo(foot.x - POST.lantern * 0.35, top + POST.lantern);
  lantern.closePath();
  return {
    post,
    lantern,
    light: { x: foot.x, y: top + POST.lantern * 0.5 },
    pool: foot,
  };
}

/**
 * Builds a bench standing at its spot on `ground`, facing the water: a seat of boards on iron legs,
 * and a back of two boards on the hind legs, which run on up to carry it.
 */
function buildBench(spec: BenchSpec, ground: GroundSpec, quay: number): Bench {
  const y = quay + heightAt(ground, spec.x, spec.z);
  const half = BENCH.length / 2;
  const front = spec.z - BENCH.deep / 2;
  const rear = spec.z + BENCH.deep / 2;
  const point = (x: number, up: number, z: number): Point =>
    onPage({ x: spec.x + x, y: y + up, z });
  const legs = (z: number, height: number): Path2D => {
    const path = new Path2D();
    for (const x of [-half + 0.16, half - 0.16]) {
      const foot = point(x, 0, z);
      path.rect(foot.x - 0.035, foot.y, 0.07, height);
    }
    return path;
  };
  const low = BENCH.seat + 0.12;
  const backPoints = [
    point(-half, low, rear),
    point(half, low, rear),
    point(half, BENCH.back, rear),
    point(-half, BENCH.back, rear),
  ];
  const seatPoints = [
    point(-half, BENCH.seat, front),
    point(half, BENCH.seat, front),
    point(half, BENCH.seat, rear),
    point(-half, BENCH.seat, rear),
  ];
  const edgePoints = [
    point(-half, BENCH.seat, front),
    point(half, BENCH.seat, front),
    point(half, BENCH.seat - BENCH.board, front),
    point(-half, BENCH.seat - BENCH.board, front),
  ];
  const back: Shaded = {
    points: backPoints,
    path: shapeOf(backPoints),
    normal: unit(0, 0, 1),
    hatch: undefined,
  };
  const seat: Shaded = {
    points: seatPoints,
    path: shapeOf(seatPoints),
    normal: unit(0, 1, 0),
    hatch: undefined,
  };
  const edge = shapeOf(edgePoints);
  const outline = new Path2D();
  outline.addPath(back.path);
  outline.addPath(seat.path);
  outline.addPath(edge);
  // The gap between the back's two boards.
  const gap = point(-half, (low + BENCH.back) / 2, rear);
  outline.moveTo(gap.x, gap.y);
  outline.lineTo(gap.x + BENCH.length, gap.y);
  return {
    hind: legs(rear, BENCH.back),
    fore: legs(front, BENCH.seat),
    back,
    seat,
    edge,
    outline,
  };
}

/** Whether the footprints `a` and `b` overlap, as two turned rectangles on the plan. */
function overlapping(a: Footprint, b: Footprint): boolean {
  const axes = [
    { x: a.ax, z: a.az },
    { x: -a.az, z: a.ax },
    { x: b.ax, z: b.az },
    { x: -b.az, z: b.ax },
  ];
  const reach = (f: Footprint, axis: Spot): number =>
    f.halfA * Math.abs(f.ax * axis.x + f.az * axis.z) +
    f.halfC * Math.abs(-f.az * axis.x + f.ax * axis.z);
  for (const axis of axes) {
    const apart = Math.abs((b.x - a.x) * axis.x + (b.z - a.z) * axis.z);
    if (apart >= reach(a, axis) + reach(b, axis)) {
      return false;
    }
  }
  return true;
}

/** Whether the spot (`x`, `z`) lies on the footprint `f`, or within `margin` of it. */
function within(f: Footprint, x: number, z: number, margin: number): boolean {
  const dx = x - f.x;
  const dz = z - f.z;
  return (
    Math.abs(dx * f.ax + dz * f.az) < f.halfA + margin &&
    Math.abs(-dx * f.az + dz * f.ax) < f.halfC + margin
  );
}

/**
 * Draws one layer of the village, in its own meters placed at its distance: the bank of its coast
 * down to the water as the tide stands now; then, above the water's edge, its rocks, its ground,
 * the light and shadow on that, and the houses, lamps, trees and bushes standing on it from the
 * back to the front; the lamps' light on the water; and the piers and boats off its quay.
 */
function drawLayer(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  layer: Layer,
  look: Look,
  sea: Sea,
  grain: CanvasPattern,
): void {
  const { spec, quay } = layer;
  const k = camera.scale * spec.depth;
  // What of the layer is in view across the page, in its own meters, with room either side.
  const left = camera.centerX - camera.width / 2 / k - 14;
  const right = camera.centerX + camera.width / 2 / k + 14;
  const level = sea.waterLevel;
  const water = camera.horizonRow + (camera.horizon - level) * k;
  if (
    water <= 0 ||
    right < onPage({ x: coastAt(spec.ground, 60), y: 0, z: 60 }).x - 30
  ) {
    return;
  }
  const place = layerTransform(camera, spec.depth);
  const px = 1 / k;
  const gap = hatchGap(k);
  const paint = (color: Rgb): Rgb =>
    mix(lit(color, look.light.flowerLight), look.light.sky.middle, spec.haze);
  const shown = layer.ground.stretches.filter(
    (s) => s.to >= left && s.from <= right,
  );

  ctx.save();
  ctx.lineJoin = "round";
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  ctx.rect(0, 0, ctx.canvas.width, water * camera.dpr);
  ctx.clip();
  ctx.setTransform(place);

  drawShore(ctx, layer.ground, shown, look, paint, quay, gap, px);
  drawGround(ctx, layer.ground, shown, look, paint, left, right, gap, px);
  drawBrink(ctx, shown, look, paint, px);
  // The light and shadow lying on the ground, under what stands on it.
  ctx.save();
  ctx.clip(layer.ground.whole);
  drawShadows(ctx, layer.houses, layer.trees, look, left, right);
  drawPools(ctx, layer, look, place, camera.dpr, k);
  ctx.restore();

  const foliage = foliageOf(ctx, look, paint);
  for (const standing of layer.standing) {
    if (standing.right < left || standing.left > right) {
      continue;
    }
    drawStanding(
      ctx,
      standing.item,
      look,
      paint,
      foliage,
      place,
      camera.dpr,
      k,
      gap,
    );
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const whole = new Path2D();
  whole.addPath(layer.whole, place);
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = GRAIN;
  ctx.fillStyle = grain;
  ctx.fill(whole);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.restore();

  if (look.darkness > at(LAMP.wakes, 0)) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(0, water * camera.dpr, ctx.canvas.width, ctx.canvas.height);
    ctx.clip();
    ctx.setTransform(place);
    drawReflections(ctx, layer.houses, look, sea, left, right, px);
    ctx.restore();
  }

  // A thin line of wash where the water meets the front of the land.
  const from = Math.max(
    0,
    camera.width / 2 + (coastAt(spec.ground, 0) - camera.centerX) * k,
  );
  if (from < camera.width) {
    ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
    ctx.strokeStyle = css(
      lit(TRIM, look.light.flowerLight),
      0.4 * (1 - 0.5 * look.darkness),
    );
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(from, water - 0.4);
    ctx.lineTo(camera.width, water - 0.4);
    ctx.stroke();
  }

  ctx.setTransform(place);
  for (const pier of spec.piers) {
    drawPier(ctx, pier, quay, level, look, paint, px);
  }
  for (const boat of spec.moored) {
    drawMoored(ctx, boat, sea, look, paint, px);
  }
}

/** Maps a layer `depth` of the near scale from its own meters, y up, to device pixels. */
function layerTransform(camera: Camera, depth: number): DOMMatrix {
  const k = camera.scale * depth;
  return new DOMMatrix([
    k * camera.dpr,
    0,
    0,
    -k * camera.dpr,
    (camera.width / 2 - camera.centerX * k) * camera.dpr,
    (camera.horizonRow + camera.horizon * k) * camera.dpr,
  ]);
}

/**
 * How the village is lit under `light` in `season`, from midsummer at 0 to midwinter at 1, with
 * snow lying `snow` meters deep and the wind blowing `wind` meters a second, `clock` seconds into
 * the sea's running.
 */
export function lookOf(
  light: SkyLight,
  season: number,
  snow: number,
  clock: number,
  wind: number,
): Look {
  const along = light.sun.along;
  const fall = smoothstep(0.3, 0.7, season);
  const winter = smoothstep(0.7, 1, season);
  const sun = toward(light.sun);
  const moon = toward(light.moon);
  const sunUp = smoothstep(-0.04, 0.1, light.sun.height);
  const moonUp = smoothstep(-0.04, 0.1, light.moon.height);
  const bySun = sunUp >= LIGHTING.moon * moonUp;
  return {
    light,
    sun,
    moon,
    sunUp,
    moonUp,
    key: bySun ? sun : moon,
    keyStrength: light.direct * (bySun ? sunUp : LIGHTING.moon * moonUp),
    darkness: 1 - light.daylight,
    night: along > 1 ? along - 1 : 0,
    ink: light.ink,
    green: mix(
      mix(LAND.green, LAND.autumn, 0.55 * fall),
      LAND.winter,
      0.6 * winter,
    ),
    scrub: mix(
      mix(LAND.scrub, LAND.autumn, 0.35 * fall),
      LAND.winter,
      0.4 * winter,
    ),
    fall,
    winter,
    snowy: smoothstep(SNOWY[0], SNOWY[1], snow),
    snow: lit(SNOW_COLOR, light.flowerLight),
    fires: smoothstep(SMOKE.lit[0], SMOKE.lit[1], season),
    clock,
    wind,
  };
}

/** The direction toward `body` in the sky, falling a little toward the viewer. */
function toward(body: SkyBody): Vec3 {
  const angle = Math.PI * (1 - clamp(body.along, 0, 1));
  return unit(Math.cos(angle), Math.sin(angle), LIGHTING.depth);
}

export function unit(x: number, y: number, z: number): Vec3 {
  const length = Math.hypot(x, y, z);
  invariant(length > 0, "A direction needs a length.");
  return { x: x / length, y: y / length, z: z / length };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** How much light a face turned `normal` takes from the direction `light`, from 0 to 1. */
function litBy(normal: Vec3, light: Vec3): number {
  return Math.max(
    0,
    (dot(normal, light) + LIGHTING.wrap) / (1 + LIGHTING.wrap),
  );
}

/** How shaded a face turned `normal` is, from 0 in full light to 1 in full shade. */
function shadeOf(normal: Vec3, look: Look): number {
  const bySun = 1 - litBy(normal, look.sun);
  const byMoon = lerp(0.5, 1 - litBy(normal, look.moon), look.moonUp);
  return lerp(
    LIGHTING.overcast,
    lerp(lerp(0.5, byMoon, LIGHTING.moon), bySun, look.sunUp),
    look.light.direct,
  );
}

/** How warmly a face turned `normal` glows toward a low sun, as a share of the sun's color. */
function glowOf(normal: Vec3, look: Look): number {
  const { light } = look;
  return (
    SHADE.glow *
    light.twilight *
    look.sunUp *
    light.direct *
    Math.max(0, dot(normal, look.sun))
  );
}

/**
 * A closed shape through `points`, wound the same way as every other, so overlapping shapes fill
 * as one.
 */
export function shapeOf(points: readonly Point[]): Path2D {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = at(points, i);
    const b = at(points, (i + 1) % points.length);
    twice += a.x * b.y - b.x * a.y;
  }
  const path = new Path2D();
  const ordered = twice >= 0 ? points : [...points].reverse();
  ordered.forEach((p, i) =>
    i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y),
  );
  path.closePath();
  return path;
}

/** A wall of a house: which way it is turned, how wide it is, its gable, and where it runs on the plan. */
interface Wall {
  normal: Vec3;
  span: number;
  gable: number;
  long: boolean;
  /** Where on the plan the foot of the wall is, `u` across it from its middle. */
  plan: (u: number) => Spot;
}

/**
 * Builds a house standing on `ground` with its quay at `quay`: level on a plinth over the ground
 * under it, its walls and roof as they show from where the village is seen, which way each is
 * turned, and its windows and doors.
 */
function buildHouse(
  spec: HouseSpec,
  ground: GroundSpec,
  quay: number,
  rng: Rng,
): House {
  const building = BUILDINGS[spec.kind];
  const length = building.length * rng.range(1 - VARIES, 1 + VARIES);
  const width = building.width * rng.range(1 - VARIES, 1 + VARIES);
  const walls = building.walls * rng.range(1 - VARIES, 1 + VARIES);
  const use = building.use;
  const pitch = (building.pitch * Math.PI) / 180;
  const turn =
    (((spec.gable === true ? -90 : 0) + (spec.skew ?? 0)) * Math.PI) / 180;
  const ridge = (width / 2) * Math.tan(pitch);
  // The ridge runs along `a`, and `c` runs across it toward the back.
  const ax = Math.cos(turn);
  const az = Math.sin(turn);
  const cx = -az;
  const cz = ax;
  const plan = (a: number, c: number): Spot => ({
    x: spec.x + a * ax + c * cx,
    z: spec.z + a * az + c * cz,
  });
  const corners = [
    plan(-length / 2, -width / 2),
    plan(length / 2, -width / 2),
    plan(length / 2, width / 2),
    plan(-length / 2, width / 2),
  ];
  for (const corner of corners) {
    invariant(
      corner.z >= CLEAR.shore &&
        corner.x >= coastAt(ground, corner.z) + CLEAR.shore,
      `The ${spec.kind} at ${spec.x} m along the shore hangs off the land.`,
    );
    invariant(
      coverAt(ground, corner.z) !== "street" &&
        !onLane(ground, corner.x, corner.z, CLEAR.lane) &&
        !onWalk(ground, corner.x, corner.z, CLEAR.walk),
      `The ${spec.kind} at ${spec.x} m along the shore stands in a street.`,
    );
  }
  const groundAt = (s: Spot): number => quay + heightAt(ground, s.x, s.z);
  const front = corners.filter((corner) => corner.z <= spec.z);
  const floor =
    Math.max(groundAt({ x: spec.x, z: spec.z }), ...front.map(groundAt)) +
    PLINTH.least;
  const place = (a: number, b: number, c: number): Point => {
    const s = plan(a, c);
    return onPage({ x: s.x, y: floor + b, z: s.z });
  };
  const paint = weathered(PAINTS[spec.paint], rng);
  const faces: Face[] = [];
  const panes: Pane[] = [];
  const glass = new Path2D();
  const frames = paint.trim === undefined ? undefined : new Path2D();
  const trimLines = paint.trim === undefined ? undefined : new Path2D();
  const outline = new Path2D();

  const addFace = (
    points: Point[],
    normal: Vec3,
    part: Face["part"],
    extra: Partial<Pick<Face, "foot" | "eaves" | "courses">> = {},
  ): void => {
    const path = shapeOf(points);
    faces.push({
      points,
      path,
      normal,
      part,
      hatch: undefined,
      foot: extra.foot,
      eaves: extra.eaves,
      courses: extra.courses,
    });
    if (part !== "plinth") {
      outline.addPath(path);
    }
  };

  const wallsOf: Wall[] = [
    {
      normal: unit(-cx, 0, cz),
      span: length,
      gable: 0,
      long: true,
      plan: (u) => plan(u, -width / 2),
    },
    {
      normal: unit(cx, 0, -cz),
      span: length,
      gable: 0,
      long: true,
      plan: (u) => plan(-u, width / 2),
    },
    {
      normal: unit(ax, 0, -az),
      span: width,
      gable: ridge,
      long: false,
      plan: (u) => plan(length / 2, u),
    },
    {
      normal: unit(-ax, 0, az),
      span: width,
      gable: ridge,
      long: false,
      plan: (u) => plan(-length / 2, -u),
    },
  ];
  const visible = wallsOf.filter((wall) => shows(wall.normal));

  // The plinth under each wall that shows, from the ground under it up to the floor.
  for (const wall of visible) {
    const a = wall.plan(-wall.span / 2);
    const b = wall.plan(wall.span / 2);
    const ga = Math.min(groundAt(a), floor);
    const gb = Math.min(groundAt(b), floor);
    if (Math.min(ga, gb) < floor - 0.02) {
      addFace(
        [
          onPage({ x: a.x, y: ga, z: a.z }),
          onPage({ x: b.x, y: gb, z: b.z }),
          onPage({ x: b.x, y: floor, z: b.z }),
          onPage({ x: a.x, y: floor, z: a.z }),
        ],
        wall.normal,
        "plinth",
      );
    }
  }

  for (const wall of visible) {
    const on = (u: number, v: number): Point => {
      const s = wall.plan(u);
      return onPage({ x: s.x, y: floor + v, z: s.z });
    };
    const points = [
      on(-wall.span / 2, 0),
      on(wall.span / 2, 0),
      on(wall.span / 2, walls),
    ];
    if (wall.gable > 0) {
      points.push(on(0, walls + wall.gable));
    }
    points.push(on(-wall.span / 2, walls));
    const top =
      wall.gable > 0
        ? [
            on(-wall.span / 2, walls),
            on(0, walls + wall.gable),
            on(wall.span / 2, walls),
          ]
        : [on(-wall.span / 2, walls), on(wall.span / 2, walls)];
    addFace(points, wall.normal, "walls", {
      foot: [on(-wall.span / 2, 0), on(wall.span / 2, 0)],
      eaves: {
        top,
        overhang: wall.gable > 0 ? OVERHANG.verge : OVERHANG.eaves,
        height: walls,
      },
    });
    if (trimLines !== undefined) {
      for (const u of [-wall.span / 2, wall.span / 2]) {
        const from = on(u, 0);
        const to = on(u, walls);
        trimLines.moveTo(from.x, from.y);
        trimLines.lineTo(to.x, to.y);
      }
    }
    // Which way the wall looks out over the ground, on the plan, for the light thrown before it.
    const facingX = wall.normal.x;
    const facingZ = -wall.normal.z;
    for (const opening of openings(
      use,
      wall.span,
      walls,
      wall.gable,
      wall.long,
      rng,
    )) {
      const { u, v, width: w, height: h } = opening;
      const quad = [on(u, v), on(u + w, v), on(u + w, v + h), on(u, v + h)];
      quadInto(glass, quad);
      if (frames !== undefined) {
        quadInto(frames, [
          on(u - FRAME, v - FRAME),
          on(u + w + FRAME, v - FRAME),
          on(u + w + FRAME, v + h + FRAME),
          on(u - FRAME, v + h + FRAME),
        ]);
      }
      const bars = new Path2D();
      if (!opening.door) {
        const mid = on(u + w / 2, v);
        const midTop = on(u + w / 2, v + h);
        bars.moveTo(mid.x, mid.y);
        bars.lineTo(midTop.x, midTop.y);
        const side = on(u, v + h * 0.55);
        const sideEnd = on(u + w, v + h * 0.55);
        bars.moveTo(side.x, side.y);
        bars.lineTo(sideEnd.x, sideEnd.y);
      }
      const foot = wall.plan(u + w / 2);
      const never = opening.door || rng.next() < LAMP.dark;
      // Light from the ground floor falls on the ground before the wall, where it faces the view.
      const pool =
        v < 2.5 && facingZ <= 0.3
          ? onPage({
              x: foot.x + facingX * GLOW.pool.across * 0.4,
              y: groundAt(foot),
              z: foot.z - Math.max(0, -facingZ) * GLOW.pool.across * 0.4,
            })
          : undefined;
      panes.push({
        points: quad,
        middle: on(u + w / 2, v + h / 2),
        bars,
        height: h,
        place: { x: foot.x, y: floor + v + h / 2, z: foot.z },
        pool,
        wakes: never ? 2 : rng.range(...LAMP.wakes),
        sleeps: rng.next() < LAMP.sleepy ? rng.range(...LAMP.sleeps) : 2,
        rises: rng.next() < LAMP.early ? rng.range(...LAMP.rises) : 2,
      });
    }
  }

  // The roof's two slopes, the far one first so the near one covers it at the ridge.
  const drop = OVERHANG.eaves * Math.tan(pitch);
  const a0 = -length / 2 - OVERHANG.verge;
  const a1 = length / 2 + OVERHANG.verge;
  const eaves = width / 2 + OVERHANG.eaves;
  const slopes = [
    {
      normal: unit(
        cx * Math.sin(pitch),
        Math.cos(pitch),
        -cz * Math.sin(pitch),
      ),
      side: 1,
    },
    {
      normal: unit(
        -cx * Math.sin(pitch),
        Math.cos(pitch),
        cz * Math.sin(pitch),
      ),
      side: -1,
    },
  ];
  for (const slope of slopes) {
    if (!shows(slope.normal)) {
      continue;
    }
    const c = slope.side * eaves;
    const points = [
      place(a0, walls + ridge, 0),
      place(a1, walls + ridge, 0),
      place(a1, walls - drop, c),
      place(a0, walls - drop, c),
    ];
    const courses = new Path2D();
    const across = Math.hypot(eaves, ridge + drop);
    for (let d = COURSES.apart; d < across - 0.1; d += COURSES.apart) {
      const t = d / across;
      const from = place(a0, walls + ridge - t * (ridge + drop), c * t);
      const to = place(a1, walls + ridge - t * (ridge + drop), c * t);
      courses.moveTo(from.x, from.y);
      courses.lineTo(to.x, to.y);
    }
    addFace(points, slope.normal, "roof", { courses });
  }
  invariant(faces.length > 0, `The house at ${spec.x} m shows no face.`);

  // A chimney through the near slope of the roof, close under the ridge, most with a fire in them.
  let flue: House["flue"];
  if (use === "house" && rng.next() < CHIMNEY.odds) {
    const s = CHIMNEY.size;
    const a = (rng.next() < 0.5 ? -1 : 1) * rng.range(0.12, 0.3) * length;
    const near = -0.15 - s;
    const far = -0.15;
    const hearth = valueNoise(spec.x * 0.37 + spec.z * 1.9, 4441) * 0.5 + 0.5;
    if (hearth < SMOKE.fires) {
      flue = {
        top: place(a, walls + ridge + CHIMNEY.above, (near + far) / 2),
        phase: (hearth * 7.31) % 1,
      };
    }
    const roofAt = (c: number): number =>
      walls + ridge * (1 - Math.abs(c) / (width / 2));
    const top = walls + ridge + CHIMNEY.above;
    const box = [
      {
        normal: unit(-cx, 0, cz),
        points: [
          place(a - s / 2, roofAt(near), near),
          place(a + s / 2, roofAt(near), near),
          place(a + s / 2, top, near),
          place(a - s / 2, top, near),
        ],
      },
      {
        normal: unit(-ax, 0, az),
        points: [
          place(a - s / 2, roofAt(near), near),
          place(a - s / 2, roofAt(far), far),
          place(a - s / 2, top, far),
          place(a - s / 2, top, near),
        ],
      },
      {
        normal: unit(ax, 0, -az),
        points: [
          place(a + s / 2, roofAt(near), near),
          place(a + s / 2, roofAt(far), far),
          place(a + s / 2, top, far),
          place(a + s / 2, top, near),
        ],
      },
      {
        normal: { x: 0, y: 1, z: 0 },
        points: [
          place(a - s / 2, top, near),
          place(a + s / 2, top, near),
          place(a + s / 2, top, far),
          place(a - s / 2, top, far),
        ],
      },
    ];
    for (const side of box) {
      if (shows(side.normal)) {
        addFace(side.points, side.normal, "chimney");
      }
    }
  }

  // The corners of the house, for the shadow it throws.
  const solid: Place[] = [];
  for (const sa of [-1, 1]) {
    for (const sc of [-1, 1]) {
      const s = plan((sa * length) / 2, (sc * width) / 2);
      solid.push({ x: s.x, y: floor, z: s.z });
      solid.push({ x: s.x, y: floor + walls, z: s.z });
    }
    const r = plan((sa * length) / 2, 0);
    solid.push({ x: r.x, y: floor + walls + ridge, z: r.z });
  }

  return {
    paint,
    faces,
    panes,
    glass,
    frames,
    corners: trimLines,
    outline,
    floor,
    solid,
    footprint: {
      x: spec.x,
      z: spec.z,
      ax,
      az,
      halfA: length / 2,
      halfC: width / 2,
    },
    flue,
  };
}

/** `paint` a little lighter or darker, as weather and age leave one house beside another. */
function weathered(paint: Paint, rng: Rng): Paint {
  const by = 1 + rng.range(-WEATHERED, WEATHERED);
  const shift = (color: Rgb): Rgb => [
    clamp(color[0] * by, 0, 255),
    clamp(color[1] * by, 0, 255),
    clamp(color[2] * by, 0, 255),
  ];
  return {
    walls: shift(paint.walls),
    roof: shift(paint.roof),
    trim: paint.trim,
  };
}

/** A window or door in a wall, in meters across it from its middle and up from its foot. */
interface Opening {
  u: number;
  v: number;
  width: number;
  height: number;
  door: boolean;
}

/**
 * The windows and doors in a wall `span` across with walls `walls` high and a gable `gable` high
 * above them: rows of windows a story apart and evenly along it, a door in the middle of a house's
 * long side, a wide door in a shed's gable end, and a window up in a tall gable.
 */
function openings(
  use: Use,
  span: number,
  walls: number,
  gable: number,
  long: boolean,
  rng: Rng,
): Opening[] {
  const size = WINDOWS[use];
  const result: Opening[] = [];
  const stories = Math.max(
    1,
    Math.floor((walls - size.sill) / size.story + 0.35),
  );
  const across = Math.max(1, Math.floor((span - 0.6) / size.apart));
  const step = span / across;
  const door =
    use === "house" && long && span > 4 ? Math.floor(across / 2) : -1;
  for (let story = 0; story < stories; story += 1) {
    const v = size.sill + story * size.story;
    if (v + size.height > walls - 0.25) {
      break;
    }
    for (let i = 0; i < across; i += 1) {
      const middle = -span / 2 + step * (i + 0.5);
      if (story === 0 && i === door) {
        const height = Math.min(DOOR.height, walls - 0.3);
        result.push({
          u: middle - DOOR.width / 2,
          v: 0,
          width: DOOR.width,
          height,
          door: true,
        });
        continue;
      }
      // Now and then a window is left out, as a wall has one boarded up or a blank stretch.
      if (use !== "works" && rng.next() < 0.08) {
        continue;
      }
      result.push({
        u: middle - size.width / 2,
        v,
        width: size.width,
        height: size.height,
        door: false,
      });
    }
  }
  if (use === "shed" && !long) {
    const wide = Math.min(span * 0.42, 3.4);
    result.push({
      u: -wide / 2,
      v: 0,
      width: wide,
      height: Math.min(walls * 0.66, 3),
      door: true,
    });
  }
  if (gable > 1.7 && use !== "works") {
    const height = Math.min(0.9, gable * 0.36);
    result.push({ u: -0.32, v: walls + 0.3, width: 0.64, height, door: false });
  }
  return result;
}

function quadInto(path: Path2D, quad: readonly Point[]): void {
  quad.forEach((p, i) =>
    i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y),
  );
  path.closePath();
}

/** A smooth curve through `points`, in order along x, read at `x`; level past either end. */
function through(
  points: readonly (readonly [number, number])[],
  x: number,
): number {
  const first = at(points, 0);
  const last = at(points, points.length - 1);
  if (x <= first[0]) {
    return first[1];
  }
  if (x >= last[0]) {
    return last[1];
  }
  let i = 0;
  while (at(points, i + 1)[0] < x) {
    i += 1;
  }
  const p0 = at(points, Math.max(0, i - 1));
  const p1 = at(points, i);
  const p2 = at(points, i + 1);
  const p3 = at(points, Math.min(points.length - 1, i + 2));
  const span = p2[0] - p1[0];
  const t = (x - p1[0]) / span;
  const m1 = ((p2[1] - p0[1]) / (p2[0] - p0[0])) * span;
  const m2 = ((p3[1] - p1[1]) / (p3[0] - p1[0])) * span;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * p1[1] +
    (t3 - 2 * t2 + t) * m1 +
    (-2 * t3 + 3 * t2) * p2[1] +
    (t3 - t2) * m2
  );
}

/**
 * The hatching gap for a layer drawn `k` CSS pixels to its meter, rounded so it changes in steps.
 */
export function hatchGap(k: number): number {
  return Math.pow(2, Math.round(Math.log2(SHADE.gapPx / k) * 3) / 3);
}

/**
 * Parallel lines across `points` at `angle` from the x axis, `gap` apart on a grid fixed in the
 * layer so neighboring faces' lines meet, cut to its outline, every other line laid in `sparse`
 * and the lines between in `dense`.
 */
function hatchLines(
  points: readonly Point[],
  angle: number,
  gap: number,
  sparse: Path2D,
  dense: Path2D,
): void {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const nx = -uy;
  const ny = ux;
  const offsets = points.map((p) => p.x * nx + p.y * ny);
  const low = Math.min(...offsets);
  const high = Math.max(...offsets);
  for (let line = Math.ceil(low / gap); line * gap < high; line += 1) {
    const offset = line * gap;
    const hits: number[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const a = at(points, i);
      const b = at(points, (i + 1) % points.length);
      const da = at(offsets, i) - offset;
      const db = at(offsets, (i + 1) % points.length) - offset;
      if (da > 0 !== db > 0) {
        const f = da / (da - db);
        hits.push(lerp(a.x, b.x, f) * ux + lerp(a.y, b.y, f) * uy);
      }
    }
    hits.sort((p, q) => p - q);
    const path = ((line % 2) + 2) % 2 === 0 ? sparse : dense;
    for (let i = 0; i + 1 < hits.length; i += 2) {
      const from = at(hits, i);
      const to = at(hits, i + 1);
      path.moveTo(nx * offset + ux * from, ny * offset + uy * from);
      path.lineTo(nx * offset + ux * to, ny * offset + uy * to);
    }
  }
}

/**
 * Hatching for `shaded` at `gap`, laid afresh only when the gap has changed, and then, if a
 * `budget` is given, only while it allows any more this frame; until then `shaded` keeps its old
 * hatching, or none if it has never had any.
 */
function hatchOf(
  shaded: Shaded | Strewn,
  gap: number,
  budget: Budget | undefined,
): Hatch | undefined {
  if (shaded.hatch !== undefined && shaded.hatch.gap === gap) {
    return shaded.hatch;
  }
  if (budget !== undefined) {
    if (budget.left <= 0) {
      return shaded.hatch;
    }
    budget.left -= 1;
  }
  // The lines lean off upright toward the way the face is turned.
  const angle = Math.PI / 2 - (shaded.normal.x >= 0 ? 1 : -1) * SHADE.tilt;
  const hatch = { gap, sparse: new Path2D(), dense: new Path2D() };
  const shapes = "shapes" in shaded ? shaded.shapes : [shaded.points];
  for (const shape of shapes) {
    hatchLines(shape, angle, gap, hatch.sparse, hatch.dense);
  }
  shaded.hatch = hatch;
  return hatch;
}

/**
 * Hatching over `tree`'s crown in its own frame, `gap` apart there, leaning away from the light on
 * `foliage`'s side, laid afresh when the gap has changed while `foliage` allows any more this
 * frame. Until then the crown keeps its old hatching, or none if it has never had any.
 */
function crownHatch(
  tree: Tree,
  gap: number,
  foliage: Foliage,
): Hatch | undefined {
  const laid = tree.hatch[foliage.side];
  if (laid !== undefined && laid.gap === gap) {
    return laid;
  }
  if (foliage.hatches <= 0) {
    return laid;
  }
  foliage.hatches -= 1;
  const hatch = { gap, sparse: new Path2D(), dense: new Path2D() };
  const angle = Math.PI / 2 + (foliage.side === 0 ? -1 : 1) * SHADE.tilt;
  hatchLines(tree.points, angle, gap, hatch.sparse, hatch.dense);
  tree.hatch[foliage.side] = hatch;
  return hatch;
}

/**
 * Shades `shaded` as far as it is turned from the light: a tone of ink and the hatching over it,
 * laid afresh as `budget` allows, and warmth where it turns toward a low sun.
 */
export function shadeFace(
  ctx: CanvasRenderingContext2D,
  shaded: Shaded | Strewn,
  look: Look,
  gap: number,
  tone: number,
  strength: number,
  budget: Budget | undefined,
): void {
  const amount = shadeOf(shaded.normal, look);
  if (amount > 0.01) {
    ctx.fillStyle = css(look.ink, tone * amount);
    ctx.fill(shaded.path);
  }
  const glow = glowOf(shaded.normal, look);
  if (glow > 0.005) {
    ctx.fillStyle = css(look.light.sunColor, glow);
    ctx.fill(shaded.path);
  }
  const hatching = strength * lerp(SHADE.night, 1, look.light.daylight);
  const sparse =
    hatching * smoothstep(SHADE.sparse[0], SHADE.sparse[1], amount);
  if (sparse < 0.01) {
    return;
  }
  const lines = hatchOf(shaded, gap, budget);
  if (lines === undefined) {
    return;
  }
  ctx.strokeStyle = css(look.ink, sparse);
  ctx.stroke(lines.sparse);
  const dense = hatching * smoothstep(SHADE.dense[0], SHADE.dense[1], amount);
  if (dense >= 0.01) {
    ctx.strokeStyle = css(look.ink, dense);
    ctx.stroke(lines.dense);
  }
}

/**
 * The face of the shore down into the water: its rock, darkening down toward the weed, carved and
 * shaded stretch by stretch, and the harbor wall along the front of the village.
 */
function drawShore(
  ctx: CanvasRenderingContext2D,
  ground: Ground,
  shown: readonly Stretch[],
  look: Look,
  paint: (color: Rgb) => Rgb,
  quay: number,
  gap: number,
  px: number,
): void {
  const deepest = at(ROCK_BANDS, ROCK_BANDS.length - 1).below;
  const rock = ctx.createLinearGradient(0, quay, 0, quay - deepest);
  for (const band of ROCK_BANDS) {
    rock.addColorStop(band.below / deepest, css(paint(band.color)));
  }
  ctx.fillStyle = rock;
  ctx.fill(ground.shore);
  const hatches = { left: ROCK_HATCHES };
  for (const stretch of shown) {
    drawCrag(ctx, stretch.crag, look, paint, gap, px, hatches);
  }
  if (ground.harbor !== undefined) {
    drawHarbor(ctx, ground.harbor, look, paint, quay, gap, px);
  }
}

/**
 * Draws the carved rock of a stretch of shore over its color: each face toned and hatched as far as
 * it turns from the light, or catching it paler, then the lines carved on it, tapering as the
 * mountains' do, and the brink of the land along its top. Its hatching is laid afresh as `hatches`
 * allows, and comes in, as its lines strengthen, as the view closes in.
 */
function drawCrag(
  ctx: CanvasRenderingContext2D,
  crag: Crag,
  look: Look,
  paint: (color: Rgb) => Rgb,
  gap: number,
  px: number,
  hatches: Budget,
): void {
  const meter = 1 / px;
  const hatching = smoothstep(...ROCK_DETAIL.hatch, meter);
  shadeRock(ctx, crag.faces.values(), look, paint, gap, px, hatching, hatches);
  const cuts = smoothstep(...ROCK_DETAIL.cuts, meter);
  const widest =
    clamp(CUT_WIDTH.meters * meter, CUT_WIDTH.px[0], CUT_WIDTH.px[1]) * px;
  ctx.lineCap = "round";
  ctx.strokeStyle = css(look.ink, CUT_WIDTH.alpha * lerp(0.45, 1, cuts));
  for (const [i, path] of crag.cuts.entries()) {
    ctx.lineWidth = widest * at(CUT_WIDTHS, i);
    ctx.stroke(path);
  }
}

/**
 * Shades sets of rock faces, each turned its own way: those turned to the light catch it paler,
 * and those turned from it are toned and hatched, as strongly as `hatching` lets the hatching show.
 */
function shadeRock(
  ctx: CanvasRenderingContext2D,
  sets: Iterable<Strewn>,
  look: Look,
  paint: (color: Rgb) => Rgb,
  gap: number,
  px: number,
  hatching: number,
  hatches: Budget | undefined,
): void {
  const pale = css(paint(ROCK_SHADE.pale));
  const spread = Math.max(gap, HATCH_LEAST.rock);
  ctx.lineWidth = SHADE.widthPx * px * Math.sqrt(spread / gap);
  ctx.lineCap = "butt";
  for (const faces of sets) {
    if (faces.shapes.length === 0) {
      continue;
    }
    const lit =
      ROCK_SHADE.lit * (1 - smoothstep(0.15, 0.6, shadeOf(faces.normal, look)));
    if (lit > 0.01) {
      ctx.globalAlpha = lit;
      ctx.fillStyle = pale;
      ctx.fill(faces.path);
      ctx.globalAlpha = 1;
    }
    shadeFace(
      ctx,
      faces,
      look,
      spread,
      ROCK_SHADE.tone,
      ROCK_SHADE.strength * hatching,
      hatches,
    );
  }
}

/**
 * Draws the harbor wall: its stone, damp and then green with weed below high water, under its
 * paler coping; the light on its face; the joints between its stones as the view closes in; and its
 * ends and the shadow under its coping.
 */
function drawHarbor(
  ctx: CanvasRenderingContext2D,
  harbor: Harbor,
  look: Look,
  paint: (color: Rgb) => Rgb,
  quay: number,
  gap: number,
  px: number,
): void {
  const [dry, damp, weed] = HARBOR.wet;
  const deepest = at(ROCK_BANDS, ROCK_BANDS.length - 1).below;
  const stone = ctx.createLinearGradient(0, quay, 0, quay - deepest);
  stone.addColorStop(0, css(paint(HARBOR.stone)));
  stone.addColorStop(dry / deepest, css(paint(HARBOR.stone)));
  stone.addColorStop(damp / deepest, css(paint(HARBOR.damp)));
  stone.addColorStop(weed / deepest, css(paint(HARBOR.weed)));
  stone.addColorStop(1, css(paint(mix(HARBOR.weed, look.ink, 0.3))));
  ctx.fillStyle = stone;
  ctx.fill(harbor.face.path);
  ctx.fillStyle = css(
    paint(mix(HARBOR.coping.stone, look.snow, SNOW_COVERS.green * look.snowy)),
  );
  ctx.fill(harbor.coping);
  ctx.lineWidth = SHADE.widthPx * px;
  ctx.lineCap = "butt";
  shadeFace(ctx, harbor.face, look, gap, SHADE.tone, SHADE.strength, undefined);
  const joints = smoothstep(3, 9, HARBOR.course / px);
  ctx.lineCap = "round";
  if (joints > 0.01) {
    ctx.lineWidth = LINES.widthPx * px * 0.8;
    ctx.strokeStyle = css(look.ink, 0.24 * joints);
    ctx.stroke(harbor.joints);
  }
  ctx.lineWidth = LINES.widthPx * px;
  ctx.strokeStyle = css(look.ink, LINES.outline);
  ctx.stroke(harbor.edges);
}

/**
 * Draws the bare top of the rock along the brink of the land, over the ground, the grass standing
 * back from the edge: the top in the rock's dry color, paler for being lit from above, or under
 * snow; the brink along the top of the rock's face and the cracks running back across the top; and
 * the tufts along the edge of the grass.
 */
function drawBrink(
  ctx: CanvasRenderingContext2D,
  shown: readonly Stretch[],
  look: Look,
  paint: (color: Rgb) => Rgb,
  px: number,
): void {
  const meter = 1 / px;
  const top = css(
    paint(
      mix(
        mix(at(ROCK_BANDS, 0).color, ROCK_SHADE.pale, BARE_TOP.pale),
        look.snow,
        SNOW_COVERS.scrub * look.snowy,
      ),
    ),
  );
  const green = paint(mix(look.green, look.snow, SNOW_COVERS.green * look.snowy));
  const blades = css(
    mix(paint(mix(look.scrub, look.snow, SNOW_COVERS.scrub * look.snowy)), green, 0.35),
    smoothstep(...TUFTS.shows, FRINGE.long[1] * meter),
  );
  const widest =
    clamp(CUT_WIDTH.meters * meter, CUT_WIDTH.px[0], CUT_WIDTH.px[1]) * px;
  const cuts = CUT_WIDTH.alpha * lerp(0.45, 1, smoothstep(...ROCK_DETAIL.cuts, meter));
  ctx.lineCap = "round";
  for (const stretch of shown) {
    const crag = stretch.crag;
    ctx.fillStyle = top;
    ctx.fill(crag.top);
    ctx.strokeStyle = css(look.ink, cuts);
    ctx.lineWidth = widest * at(CUT_WIDTHS, 1);
    ctx.stroke(crag.brink);
    ctx.lineWidth = widest * at(CUT_WIDTHS, 3);
    ctx.stroke(crag.cracks);
    ctx.lineWidth = Math.max(LINES.widthPx * px, 0.025);
    ctx.strokeStyle = blades;
    ctx.stroke(crag.fringe);
  }
}

/**
 * Draws a layer's ground in its own meters: each row in its cover, each facet toned and hatched as
 * far as it turns from the light, the lanes, tufts of grass, and fine lines along the edges of the
 * streets and the top of the land.
 */
function drawGround(
  ctx: CanvasRenderingContext2D,
  ground: Ground,
  shown: readonly Stretch[],
  look: Look,
  paint: (color: Rgb) => Rgb,
  left: number,
  right: number,
  gap: number,
  px: number,
): void {
  const green = paint(
    mix(look.green, look.snow, SNOW_COVERS.green * look.snowy),
  );
  const scrub = paint(
    mix(look.scrub, look.snow, SNOW_COVERS.scrub * look.snowy),
  );
  const gravel = paint(
    mix(LAND.gravel, look.snow, SNOW_COVERS.green * look.snowy),
  );
  const colors: Record<Cover, Rgb> = {
    grass: green,
    street: gravel,
    scrub: mix(green, scrub, 0.35),
  };
  for (const band of ground.bands) {
    ctx.fillStyle = css(colors[band.cover]);
    ctx.fill(band.path);
  }
  ctx.fillStyle = css(gravel);
  ctx.fill(ground.lanes);
  ctx.lineWidth = SHADE.widthPx * px;
  ctx.lineCap = "butt";
  // From the back to the front, so where the ground folds over itself a rise is painted over what
  // lies behind it, shading and all.
  const hatches = { left: FACET_HATCHES };
  for (let i = ground.bands.length - 1; i >= 0; i -= 1) {
    const band = at(ground.bands, i);
    for (const facet of band.facets) {
      if (facet.right < left || facet.left > right) {
        continue;
      }
      if (facet.folded) {
        ctx.fillStyle = css(colors[band.cover]);
        ctx.fill(facet.path);
      }
      shadeFace(
        ctx,
        facet,
        look,
        gap,
        LAND_SHADE.tone,
        LAND_SHADE.strength,
        hatches,
      );
    }
  }
  ctx.lineCap = "round";
  ctx.lineWidth = LINES.widthPx * px;
  // The walk along the harbor wall: its cobbles behind the coping stones along the water's edge.
  const harbor = ground.harbor;
  if (harbor !== undefined) {
    const snowy = SNOW_COVERS.green * look.snowy;
    ctx.fillStyle = css(paint(mix(WALK.stone, look.snow, snowy)));
    ctx.fill(harbor.walk);
    ctx.fillStyle = css(paint(mix(HARBOR.coping.stone, look.snow, snowy)));
    ctx.fill(harbor.kerb);
    const cobbles = smoothstep(
      LEAST_COBBLE_PX,
      LEAST_COBBLE_PX * 2,
      (WALK.rows * VIEW.up) / px,
    );
    if (cobbles > 0.01) {
      ctx.strokeStyle = css(look.ink, 0.2 * cobbles);
      ctx.stroke(harbor.cobbles);
    }
    ctx.strokeStyle = css(look.ink, LINES.edge);
    ctx.stroke(harbor.back);
  }
  const tufts = smoothstep(...TUFTS.shows, TUFTS.tall[1] / px);
  if (tufts > 0.01) {
    ctx.strokeStyle = css(mix(scrub, look.ink, 0.25), LINES.tuft * tufts);
    for (const stretch of shown) {
      ctx.stroke(stretch.tufts);
    }
  }
  // Fine lines along the edges of the streets and lanes, and along the top of the land.
  const edges = new Path2D();
  for (const band of ground.bands) {
    if (band.cover !== "street") {
      continue;
    }
    for (const line of [band.front, band.back]) {
      line.forEach((p, i) =>
        i === 0 ? edges.moveTo(p.x, p.y) : edges.lineTo(p.x, p.y),
      );
    }
  }
  ctx.strokeStyle = css(look.ink, LINES.edge);
  ctx.stroke(edges);
  ctx.stroke(ground.lanes);
  const top = at(ground.bands, ground.bands.length - 1).back;
  const skyline = new Path2D();
  top.forEach((p, i) =>
    i === 0 ? skyline.moveTo(p.x, p.y) : skyline.lineTo(p.x, p.y),
  );
  ctx.strokeStyle = css(look.ink, LINES.ridge);
  ctx.stroke(skyline);
}

/**
 * The shadows the houses, trees and bushes throw on the ground away from the sun, or by night the
 * moon: each house's the shape of it laid along the light onto the ground its floor stands at, and
 * each crown's an oval stretched away from the light, longer as the light is lower, and fainter as
 * it is weaker.
 */
function drawShadows(
  ctx: CanvasRenderingContext2D,
  houses: readonly House[],
  trees: readonly Tree[],
  look: Look,
  left: number,
  right: number,
): void {
  const strength = look.keyStrength;
  if (strength < 0.02) {
    return;
  }
  const light = { ...look.key, z: look.key.z * SHADOW.cast.toward };
  const up = Math.max(light.y, 1 / SHADOW.cast.reach);
  const shadows = new Path2D();
  for (const house of houses) {
    const points: Point[] = [];
    for (const corner of house.solid) {
      const height = corner.y - house.floor;
      points.push(
        onPage({
          x: corner.x - (height * light.x) / up,
          y: house.floor,
          z: corner.z + (height * light.z) / up,
        }),
      );
    }
    const hull = convexHull(points);
    const first = at(hull, 0);
    if (first.x > right + 20 || first.x < left - 40) {
      continue;
    }
    quadInto(shadows, hull);
  }

  // A crown's shadow, as a ball's, for a crown of half-width 1 standing 1 above the ground: how far
  // it falls from the tree's foot, and the oval about there, stretched along the way it falls.
  const across = Math.hypot(light.x, light.z);
  const ax = across > 1e-3 ? -light.x / across : 0;
  const az = across > 1e-3 ? light.z / across : 1;
  const stretch = Math.min(
    Math.hypot(light.x, light.y, light.z) / up,
    SHADOW.cast.reach,
  );
  const fall = onPage({ x: -light.x / up, y: 0, z: light.z / up });
  const oval: Point[] = [];
  for (let i = 0; i < SHADOW.oval; i += 1) {
    const t = (i / SHADOW.oval) * Math.PI * 2;
    oval.push(
      onPage({
        x: ax * Math.cos(t) * stretch - az * Math.sin(t),
        y: 0,
        z: az * Math.cos(t) * stretch + ax * Math.sin(t),
      }),
    );
  }
  const shadow = new Path2D();
  quadInto(shadow, oval);
  for (const tree of trees) {
    if (tree.middle.x > right + 20 || tree.middle.x < left - 20) {
      continue;
    }
    const r = tree.radius;
    shadows.addPath(shadow, {
      a: r,
      d: r,
      e: tree.foot.x + fall.x * tree.height * r,
      f: tree.foot.y + fall.y * tree.height * r,
    });
  }
  ctx.fillStyle = css(look.ink, SHADOW.cast.alpha * strength);
  ctx.fill(shadows);
}

/** The smallest convex outline around `points`, counterclockwise. */
function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of sorted) {
    while (
      lower.length >= 2 &&
      cross(at(lower, lower.length - 2), at(lower, lower.length - 1), p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (const p of [...sorted].reverse()) {
    while (
      upper.length >= 2 &&
      cross(at(upper, upper.length - 2), at(upper, upper.length - 1), p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** The soft glow of a lamp, warm at its heart and fading to nothing, drawn once and laid wherever one burns. */
let glowSprite: HTMLCanvasElement | undefined;

function glowOfLamp(): HTMLCanvasElement {
  if (glowSprite === undefined) {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    invariant(ctx !== null, "The lamps' glow needs a 2D canvas.");
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    const [r, g, b] = LAMPLIGHT.pane;
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
    gradient.addColorStop(0.25, `rgba(${r}, ${g}, ${b}, 0.55)`);
    gradient.addColorStop(0.6, `rgba(${r}, ${g}, ${b}, 0.14)`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    glowSprite = canvas;
  }
  return glowSprite;
}

/**
 * Lays the glow at `at`, in a layer's meters placed by `place`, `rx` and `ry` meters across each
 * way, as strong as `alpha`. `k` is CSS pixels to the meter.
 */
export function layGlow(
  ctx: CanvasRenderingContext2D,
  place: DOMMatrix,
  dpr: number,
  k: number,
  where: Point,
  rx: number,
  ry: number,
  alpha: number,
): void {
  if (alpha < 0.01) {
    return;
  }
  const x = place.a * where.x + place.e;
  const y = place.d * where.y + place.f;
  const w = rx * k * dpr;
  const h = ry * k * dpr;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(glowOfLamp(), x - w, y - h, w * 2, h * 2);
}

/**
 * The light pooling on the ground by night: before the lit windows on the ground floor, and under
 * the street lamps.
 */
function drawPools(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  look: Look,
  place: DOMMatrix,
  dpr: number,
  k: number,
): void {
  if (look.darkness < at(LAMP.wakes, 0)) {
    return;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "lighter";
  const across = GLOW.pool.across;
  for (const house of layer.houses) {
    for (const pane of house.panes) {
      if (pane.pool === undefined) {
        continue;
      }
      const burn = burning(pane, look);
      if (burn > 0) {
        layGlow(
          ctx,
          place,
          dpr,
          k,
          pane.pool,
          across / 2,
          (across / 2) * VIEW.up * 1.6,
          GLOW.pool.alpha * burn * look.darkness,
        );
      }
    }
  }
  const street = smoothstep(STREET_LAMPS, STREET_LAMPS + 0.1, look.darkness);
  if (street > 0) {
    const pool = GLOW.lamp.pool;
    for (const lamp of layer.lamps) {
      layGlow(
        ctx,
        place,
        dpr,
        k,
        lamp.pool,
        pool / 2,
        (pool / 2) * VIEW.up * 1.6,
        GLOW.lamp.poolAlpha * street,
      );
    }
  }
  ctx.restore();
}

/** Draws something standing on a layer's ground. */
function drawStanding(
  ctx: CanvasRenderingContext2D,
  item: Item,
  look: Look,
  paint: (color: Rgb) => Rgb,
  foliage: Foliage,
  place: DOMMatrix,
  dpr: number,
  k: number,
  gap: number,
): void {
  switch (item.kind) {
    case "house":
      drawHouse(ctx, item.house, look, paint, place, dpr, k, gap);
      return;
    case "grove":
      drawGrove(ctx, item.grove, foliage, place, k, gap);
      return;
    case "lamp":
      drawLamp(ctx, item.lamp, look, paint, place, dpr, k);
      return;
    case "bench":
      drawBench(ctx, item.bench, look, paint, gap, 1 / k);
      return;
    default: {
      const unknown: never = item;
      throw new Error(`Nothing draws ${JSON.stringify(unknown)}.`);
    }
  }
}

/**
 * How the crowns of trees and bushes are drawn in this frame's light, in `paint`'s colors. Each
 * crown is shaded as a ball of leaves: paler at its top and darker beneath, and toned and hatched
 * across it as far as each part of it turns from the sun, or by night the moon.
 */
function foliageOf(
  ctx: CanvasRenderingContext2D,
  look: Look,
  paint: (color: Rgb) => Rgb,
): Foliage {
  const leafOf = (kind: Leaves): Rgb =>
    mix(
      mix(
        mix(
          mix(LAND.green, LAND.scrub, LEAVES[kind]),
          AUTUMN[kind],
          TURNING.fall * look.fall,
        ),
        BARE,
        TURNING.winter * look.winter,
      ),
      look.snow,
      SNOW_COVERS.scrub * look.snowy,
    );
  const rounded = (kind: Leaves): CanvasGradient => {
    const leaf = leafOf(kind);
    const gradient = ctx.createLinearGradient(0, 1.3, 0, -1.3);
    gradient.addColorStop(0, css(paint(mix(leaf, CROWN.sunlit, CROWN.top))));
    gradient.addColorStop(0.45, css(paint(leaf)));
    gradient.addColorStop(1, css(paint(mix(leaf, look.ink, CROWN.under))));
    return gradient;
  };
  // Across a crown along the way the light falls on the page, from the side it lights to the far
  // side, how far each part of the ball turns from the light.
  const flat = Math.hypot(look.key.x, look.key.y);
  const ux = flat > 1e-3 ? look.key.x / flat : 0;
  const uy = flat > 1e-3 ? look.key.y / flat : 1;
  const reach = 1.25;
  const across = (): CanvasGradient =>
    ctx.createLinearGradient(ux * reach, uy * reach, -ux * reach, -uy * reach);
  const tone = across();
  const sparse = across();
  const dense = across();
  const hatching = FOLIAGE.strength * lerp(SHADE.night, 1, look.light.daylight);
  const stops = 8;
  for (let i = 0; i <= stops; i += 1) {
    const t = i / stops;
    const s = clamp((1 - 2 * t) * reach, -1, 1);
    const amount = shadeOf(unit(s * ux, s * uy, Math.sqrt(1 - s * s)), look);
    tone.addColorStop(t, css(look.ink, FOLIAGE.tone * amount));
    sparse.addColorStop(
      t,
      css(look.ink, hatching * smoothstep(...SHADE.sparse, amount)),
    );
    dense.addColorStop(
      t,
      css(look.ink, hatching * smoothstep(...SHADE.dense, amount)),
    );
  }
  return {
    leaves: {
      birch: rounded("birch"),
      rowan: rounded("rowan"),
      bush: rounded("bush"),
    },
    flat: {
      birch: css(paint(leafOf("birch"))),
      rowan: css(paint(leafOf("rowan"))),
      bush: css(paint(leafOf("bush"))),
    },
    bark: { birch: css(paint(BARK.birch)), rowan: css(paint(BARK.rowan)) },
    tone,
    sparse,
    dense,
    side: look.key.x > 0 ? 1 : 0,
    shade: css(look.ink, FOLIAGE.tone * shadeOf(unit(-ux, -uy, 0.8), look)),
    under: css(look.ink, FOLIAGE.tone * 0.6 * shadeOf(unit(0, -1, 0.8), look)),
    clusters: css(look.ink, FOLIAGE.clusters),
    outline: css(look.ink, FOLIAGE.outline),
    hatches: CROWN_HATCHES,
  };
}

/**
 * Draws a stand of trees or a clump of bushes: crown by crown from the back to the front, or, when
 * its crowns show too small for that, all as one with their shaded sides and undersides darkened.
 */
function drawGrove(
  ctx: CanvasRenderingContext2D,
  grove: Grove,
  foliage: Foliage,
  place: DOMMatrix,
  k: number,
  gap: number,
): void {
  const across = grove.size * k;
  if (across >= FOLIAGE.detailPx) {
    const detail = smoothstep(FOLIAGE.detailPx, FOLIAGE.fullPx, across);
    for (const tree of grove.trees) {
      drawTree(ctx, tree, foliage, place, k, gap, detail);
    }
    ctx.setTransform(place);
    return;
  }
  // Outlined by stroking twice as wide before filling, so only the outside of the stand shows it.
  ctx.lineWidth = (2 * LINES.widthPx) / k;
  ctx.strokeStyle = foliage.outline;
  for (const body of grove.bodies.values()) {
    ctx.stroke(body);
  }
  for (const [kind, body] of grove.bodies) {
    ctx.fillStyle = foliage.flat[kind];
    ctx.fill(body);
  }
  ctx.fillStyle = foliage.shade;
  ctx.fill(grove.shade[foliage.side]);
  ctx.fillStyle = foliage.under;
  ctx.fill(grove.under);
}

/**
 * Draws a tree or bush in its own frame: its trunk, its crown outlined, paler above and darker
 * beneath, toned across away from the light, and, as far as `detail` says, hatched on its shaded
 * side with arcs along its clusters of leaves.
 */
function drawTree(
  ctx: CanvasRenderingContext2D,
  tree: Tree,
  foliage: Foliage,
  place: DOMMatrix,
  k: number,
  gap: number,
  detail: number,
): void {
  const r = tree.radius;
  ctx.setTransform(
    place.a * r,
    0,
    0,
    place.d * r,
    place.a * tree.middle.x + place.e,
    place.d * tree.middle.y + place.f,
  );
  const px = 1 / (k * r);
  const fine = detail >= 0.1;
  if (tree.trunk !== undefined) {
    ctx.fillStyle = foliage.bark[tree.trunk.bark];
    ctx.fill(tree.trunk.path);
    if (fine) {
      ctx.lineWidth = LINES.widthPx * px;
      ctx.strokeStyle = foliage.outline;
      ctx.stroke(tree.trunk.path);
    }
  }
  // Outlined by stroking twice as wide before filling, so only the outside of the crown shows it.
  ctx.lineWidth = 2 * LINES.widthPx * px;
  ctx.strokeStyle = foliage.outline;
  ctx.stroke(tree.crown);
  ctx.fillStyle = foliage.leaves[tree.leaves];
  ctx.fill(tree.crown);
  ctx.fillStyle = foliage.tone;
  ctx.fill(tree.crown);
  if (!fine) {
    return;
  }
  ctx.globalAlpha = detail;
  const spread = Math.max(gap, HATCH_LEAST.crown);
  const hatch = crownHatch(tree, spread / r, foliage);
  if (hatch !== undefined) {
    ctx.lineWidth = SHADE.widthPx * px * Math.sqrt(spread / gap);
    ctx.lineCap = "butt";
    ctx.strokeStyle = foliage.sparse;
    ctx.stroke(hatch.sparse);
    ctx.strokeStyle = foliage.dense;
    ctx.stroke(hatch.dense);
  }
  ctx.lineCap = "round";
  ctx.lineWidth = LINES.widthPx * px;
  ctx.strokeStyle = foliage.clusters;
  ctx.stroke(tree.clusters[foliage.side]);
  ctx.globalAlpha = 1;
}

/**
 * A bench: its hind legs, its back and seat of boards toned as far as each is turned from the
 * light, the seat's front edge in its shade, its fore legs, and its outline.
 */
function drawBench(
  ctx: CanvasRenderingContext2D,
  bench: Bench,
  look: Look,
  paint: (color: Rgb) => Rgb,
  gap: number,
  px: number,
): void {
  const wood = paint(BENCH.wood);
  const iron = css(paint(BENCH.iron));
  ctx.fillStyle = iron;
  ctx.fill(bench.hind);
  ctx.lineWidth = SHADE.widthPx * px;
  ctx.lineCap = "butt";
  for (const board of [bench.back, bench.seat]) {
    ctx.fillStyle = css(wood);
    ctx.fill(board.path);
    shadeFace(ctx, board, look, gap, SHADE.tone, SHADE.strength, undefined);
  }
  ctx.fillStyle = css(mix(wood, look.ink, 0.35));
  ctx.fill(bench.edge);
  ctx.fillStyle = iron;
  ctx.fill(bench.fore);
  ctx.lineWidth = LINES.widthPx * px;
  ctx.lineCap = "round";
  ctx.strokeStyle = css(look.ink, LINES.outline);
  ctx.stroke(bench.outline);
}

/** A street lamp: its iron post and lantern, and by night its light, warm and glowing. */
function drawLamp(
  ctx: CanvasRenderingContext2D,
  lamp: Lamp,
  look: Look,
  paint: (color: Rgb) => Rgb,
  place: DOMMatrix,
  dpr: number,
  k: number,
): void {
  ctx.fillStyle = css(paint(POST.iron));
  ctx.fill(lamp.post);
  ctx.fill(lamp.lantern);
  const on = smoothstep(STREET_LAMPS, STREET_LAMPS + 0.1, look.darkness);
  if (on <= 0) {
    return;
  }
  ctx.fillStyle = css(mix(PANE.night, LAMPLIGHT.heart, on));
  ctx.fill(lamp.lantern);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "lighter";
  const reach = GLOW.lamp.reach;
  layGlow(ctx, place, dpr, k, lamp.light, reach, reach, GLOW.lamp.alpha * on);
  ctx.restore();
}

/**
 * Draws a house in its layer's meters: its plinth, then each face it shows in its paint, toned and
 * hatched as far as it is turned from the light, its walls darkening toward their foot and
 * shaded under the eaves, its roof lined with courses; then its windows, dark by day and lit as
 * the night comes on, its trim and its outline.
 */
function drawHouse(
  ctx: CanvasRenderingContext2D,
  house: House,
  look: Look,
  paint: (color: Rgb) => Rgb,
  place: DOMMatrix,
  dpr: number,
  k: number,
  gap: number,
): void {
  const px = 1 / k;
  const colors: Record<Face["part"], string> = {
    walls: css(paint(house.paint.walls)),
    roof: css(
      paint(mix(house.paint.roof, look.snow, SNOW_COVERS.roof * look.snowy)),
    ),
    chimney: css(paint(CHIMNEY.brick)),
    plinth: css(paint(PLINTH.stone)),
  };
  const courses = COURSES.apart * k >= COURSES.leastPx;
  for (const face of house.faces) {
    ctx.fillStyle = colors[face.part];
    ctx.fill(face.path);
    ctx.lineWidth = SHADE.widthPx * px;
    ctx.lineCap = "butt";
    shadeFace(ctx, face, look, gap, SHADE.tone, SHADE.strength, undefined);
    if (face.foot !== undefined) {
      drawFoot(ctx, face.foot, look);
    }
    if (face.eaves !== undefined) {
      drawEaves(ctx, face, face.eaves, look);
    }
    if (courses && face.courses !== undefined) {
      ctx.lineWidth = SHADE.widthPx * px;
      ctx.strokeStyle = css(look.ink, COURSES.alpha);
      ctx.stroke(face.courses);
    }
  }

  const trim = house.paint.trim;
  if (trim !== undefined && house.corners !== undefined) {
    ctx.strokeStyle = css(paint(trim), 0.85);
    ctx.lineWidth = Math.max(0.12, 0.7 * px);
    ctx.stroke(house.corners);
  }
  if (WINDOWS.house.width * k >= LEAST_WINDOW_PX.pane) {
    if (trim !== undefined && house.frames !== undefined) {
      ctx.fillStyle = css(paint(trim));
      ctx.fill(house.frames);
    }
    ctx.fillStyle = css(paint(mix(PANE.day, PANE.night, look.darkness)));
    ctx.fill(house.glass);
    drawLamps(ctx, house.panes, look, place, dpr, k);
  }

  ctx.lineWidth = LINES.widthPx * px;
  ctx.lineCap = "round";
  ctx.strokeStyle = css(look.ink, LINES.outline);
  ctx.stroke(house.outline);
  if (house.flue !== undefined && look.fires > 0) {
    drawSmoke(ctx, house.flue, look, paint);
  }
}

/**
 * Smoke rising from a chimney once its fire is lit, the fires coming on one by one as the cold
 * comes on: puffs rising one after another, growing and thinning as they go, wavering, and bent
 * over by the wind.
 */
function drawSmoke(
  ctx: CanvasRenderingContext2D,
  flue: { top: Point; phase: number },
  look: Look,
  paint: (color: Rgb) => Rgb,
): void {
  const lit = flue.phase * 0.9;
  const strength = smoothstep(lit, lit + 0.1, look.fires);
  if (strength < 0.01) {
    return;
  }
  const blown = look.wind / SMOKE.flat;
  const lean = clamp(
    Math.abs(blown) < SMOKE.drift ? SMOKE.drift * (blown >= 0 ? 1 : -1) : blown,
    -1,
    1,
  );
  const grey = paint(SMOKE.color);
  const crown = paint(SMOKE.crown);
  // The crown sits toward the light, up and to its side.
  const toward = look.key.x >= 0 ? 1 : -1;
  for (let i = 0; i < SMOKE.puffs; i += 1) {
    const p = (look.clock / SMOKE.rise + flue.phase + i / SMOKE.puffs) % 1;
    const up = SMOKE.high * p * (1 - 0.5 * Math.abs(lean) * p);
    const along = SMOKE.high * lean * Math.pow(p, 1.3);
    const waver =
      SMOKE.waver *
      p *
      Math.sin(look.clock * 0.9 + flue.phase * 20 + p * 7 + i * 1.3);
    const r = lerp(SMOKE.wide[0], SMOKE.wide[1], p) / 2;
    const alpha =
      SMOKE.alpha * strength * (1 - p) * smoothstep(0, 0.08, p);
    if (alpha < 0.01) {
      continue;
    }
    const x = flue.top.x + along + waver;
    const y = flue.top.y + up;
    ctx.fillStyle = css(grey, alpha);
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css(crown, alpha * 0.5);
    ctx.beginPath();
    ctx.ellipse(
      x + toward * r * 0.18,
      y + r * 0.22,
      r * 0.68,
      r * 0.56,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

/** The soft darkening at the foot of a wall, where it meets the ground. */
function drawFoot(
  ctx: CanvasRenderingContext2D,
  foot: [Point, Point],
  look: Look,
): void {
  const [a, b] = foot;
  ctx.fillStyle = css(look.ink, SHADOW.foot.alpha);
  for (const up of [SHADOW.foot.low, SHADOW.foot.high]) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(b.x, b.y + up);
    ctx.lineTo(a.x, a.y + up);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * The shadow an overhanging roof throws down a wall the light falls on: deeper the higher the
 * light and the more it skims the wall.
 */
function drawEaves(
  ctx: CanvasRenderingContext2D,
  face: Face,
  eaves: Eaves,
  look: Look,
): void {
  const strength = look.keyStrength;
  const across = dot(face.normal, look.key);
  if (strength < 0.02 || across < 0.02 || look.key.y <= 0) {
    return;
  }
  const depth = Math.min(
    (eaves.overhang * look.key.y) / across,
    eaves.height * SHADOW.eaves.deepest,
  );
  ctx.save();
  ctx.clip(face.path);
  ctx.beginPath();
  eaves.top.forEach((p, i) =>
    i === 0 ? ctx.moveTo(p.x, p.y + 0.2) : ctx.lineTo(p.x, p.y + 0.2),
  );
  for (const p of [...eaves.top].reverse()) {
    ctx.lineTo(p.x, p.y - depth);
  }
  ctx.closePath();
  ctx.fillStyle = css(look.ink, SHADOW.eaves.alpha * strength);
  ctx.fill();
  ctx.restore();
}

/** How brightly the lamp behind `pane` burns, from 0 to 1. */
function burning(pane: Pane, look: Look): number {
  const on = smoothstep(pane.wakes, pane.wakes + LAMP.fade, look.darkness);
  if (on <= 0) {
    return 0;
  }
  const out =
    smoothstep(pane.sleeps, pane.sleeps + 0.02, look.night) *
    (1 - smoothstep(pane.rises, pane.rises + 0.02, look.night));
  return on * (1 - out);
}

/**
 * Lights the windows whose lamps are burning: each pane amber, paler and hotter at its heart, its
 * glazing bars dark across it, and a soft glow about it.
 */
function drawLamps(
  ctx: CanvasRenderingContext2D,
  panes: readonly Pane[],
  look: Look,
  place: DOMMatrix,
  dpr: number,
  k: number,
): void {
  if (look.darkness < at(LAMP.wakes, 0)) {
    return;
  }
  const steps = Array.from({ length: LAMP_STEPS }, () => ({
    panes: new Path2D(),
    hearts: new Path2D(),
    any: false,
  }));
  const bars = new Path2D();
  const glows: { middle: Point; reach: number; burn: number }[] = [];
  for (const pane of panes) {
    const burn = burning(pane, look);
    const level = Math.round(burn * LAMP_STEPS);
    if (level <= 0) {
      continue;
    }
    const step = at(steps, level - 1);
    quadInto(step.panes, pane.points);
    // The heart of the light, low in the pane, where the lamp stands inside.
    const { middle } = pane;
    quadInto(
      step.hearts,
      pane.points.map((p) => ({
        x: middle.x + (p.x - middle.x) * 0.55,
        y: middle.y - pane.height * 0.12 + (p.y - middle.y) * 0.5,
      })),
    );
    if (pane.height * k >= LEAST_WINDOW_PX.bars) {
      bars.addPath(pane.bars);
    }
    glows.push({ middle, reach: pane.height * GLOW.window.reach, burn });
    step.any = true;
  }
  for (const [i, step] of steps.entries()) {
    if (!step.any) {
      continue;
    }
    const strength = (i + 1) / LAMP_STEPS;
    ctx.fillStyle = css(mix(PANE.night, LAMPLIGHT.pane, strength));
    ctx.fill(step.panes);
    ctx.fillStyle = css(LAMPLIGHT.heart, 0.75 * strength);
    ctx.fill(step.hearts);
  }
  ctx.lineWidth = Math.max(0.06, 0.6 / k);
  ctx.strokeStyle = css(PANE.night, 0.75);
  ctx.stroke(bars);
  if (glows.length === 0) {
    return;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "lighter";
  for (const glow of glows) {
    layGlow(
      ctx,
      place,
      dpr,
      k,
      glow.middle,
      glow.reach,
      glow.reach,
      GLOW.window.alpha * glow.burn * look.darkness,
    );
  }
  ctx.restore();
}

/**
 * The lamps' light on the water below the village, in its layer's meters: each lit window breaks
 * into a few short dashes of its warmth, as far below the water as it stands above it, swaying on
 * the swell, fainter the farther back from the water it stands. `px` is a CSS pixel in meters.
 */
function drawReflections(
  ctx: CanvasRenderingContext2D,
  houses: readonly House[],
  look: Look,
  sea: Sea,
  left: number,
  right: number,
  px: number,
): void {
  const level = sea.waterLevel;
  const steps = Array.from({ length: LAMP_STEPS }, () => new Path2D());
  for (const house of houses) {
    for (const pane of house.panes) {
      const burn = burning(pane, look);
      if (burn <= 0) {
        continue;
      }
      const { place } = pane;
      const x = place.x - VIEW.left * place.z;
      if (x < left || x > right) {
        continue;
      }
      const above = place.y - level;
      const seen =
        1 - smoothstep(REFLECTION.back[0], REFLECTION.back[1], place.z);
      const width = Math.max(pane.height * 0.7, 0.3);
      for (let i = 0; i < REFLECTION.dashes; i += 1) {
        const t = (i + 0.5) / REFLECTION.dashes;
        const fade = seen * (1 - 0.6 * t);
        const step = Math.round(burn * fade * LAMP_STEPS);
        if (step <= 0) {
          continue;
        }
        const seed = x * 1.37 + i * 5.1;
        const y =
          level - above * lerp(REFLECTION.reach[0], REFLECTION.reach[1], t);
        const sway =
          REFLECTION.sway * Math.sin(sea.clock * (1.1 + 0.3 * i) + seed);
        const half =
          (width *
            lerp(
              REFLECTION.wide[0],
              REFLECTION.wide[1],
              0.5 + 0.5 * valueNoise(seed, 7),
            )) /
          2;
        const path = at(steps, step - 1);
        path.moveTo(x + sway - half, y);
        path.lineTo(x + sway + half, y);
      }
    }
  }
  ctx.lineWidth = 1.1 * px;
  ctx.lineCap = "round";
  ctx.globalCompositeOperation = "lighter";
  for (const [i, path] of steps.entries()) {
    ctx.strokeStyle = css(
      LAMPLIGHT.pane,
      (REFLECTION.alpha * (i + 1)) / LAMP_STEPS,
    );
    ctx.stroke(path);
  }
  ctx.globalCompositeOperation = "source-over";
}

/** A wooden pier out from the quay over the water: its deck on posts standing down into the water. */
function drawPier(
  ctx: CanvasRenderingContext2D,
  pier: PierSpec,
  quay: number,
  level: number,
  look: Look,
  paint: (color: Rgb) => Rgb,
  px: number,
): void {
  const deck = quay + PIER.deck;
  const half = pier.width / 2;
  const wood = paint(PIER.wood);
  const posts = new Path2D();
  for (let z = -PIER.posts * 0.5; z > -pier.length; z -= PIER.posts) {
    for (const side of [-half + 0.15, half - 0.15]) {
      const top = onPage({ x: pier.x + side, y: deck, z });
      const foot = onPage({ x: pier.x + side, y: level, z });
      if (foot.y < top.y) {
        posts.rect(top.x - 0.1, foot.y, 0.2, top.y - foot.y);
      }
    }
  }
  ctx.fillStyle = css(mix(wood, look.ink, 0.5));
  ctx.fill(posts);
  const points = [
    onPage({ x: pier.x - half, y: deck, z: 0 }),
    onPage({ x: pier.x + half, y: deck, z: 0 }),
    onPage({ x: pier.x + half, y: deck, z: -pier.length }),
    onPage({ x: pier.x - half, y: deck, z: -pier.length }),
  ];
  const top = shapeOf(points);
  ctx.fillStyle = css(wood);
  ctx.fill(top);
  // The deck's edge toward the view, a plank's thickness.
  const edge = shapeOf([
    at(points, 3),
    at(points, 2),
    { x: at(points, 2).x, y: at(points, 2).y - 0.25 },
    { x: at(points, 3).x, y: at(points, 3).y - 0.25 },
  ]);
  ctx.fillStyle = css(mix(wood, look.ink, 0.35));
  ctx.fill(edge);
  ctx.lineWidth = LINES.widthPx * px;
  ctx.strokeStyle = css(look.ink, LINES.outline);
  ctx.stroke(top);
  ctx.stroke(edge);
}

/** Draws a boat lying in the water off the quay, in its layer's meters, afloat on the water as it stands now. */
function drawMoored(
  ctx: CanvasRenderingContext2D,
  boat: MooredSpec,
  sea: Sea,
  look: Look,
  paint: (color: Rgb) => Rgb,
  px: number,
): void {
  const at0 = onPage({
    x: boat.x,
    y: sea.waterLevel + 0.05 * Math.sin(sea.clock * 1.1 + boat.x),
    z: boat.z,
  });
  const { x, y } = at0;
  const half = boat.length / 2;
  const hull = new Path2D();
  hull.moveTo(x - half, y + 0.55);
  hull.quadraticCurveTo(x, y + 0.42, x + half, y + 0.78);
  hull.lineTo(x + half - 0.5, y - 0.1);
  hull.lineTo(x - half + 0.25, y - 0.1);
  hull.closePath();
  ctx.fillStyle = css(paint(boat.hull));
  ctx.fill(hull);
  ctx.lineWidth = LINES.widthPx * px;
  ctx.lineCap = "round";
  ctx.strokeStyle = css(look.ink, LINES.outline);
  ctx.stroke(hull);
  if (boat.cabin !== undefined) {
    const cabin = new Path2D();
    cabin.rect(x - half * 0.35, y + 0.5, boat.length * 0.24, 1.15);
    ctx.fillStyle = css(paint(boat.cabin));
    ctx.fill(cabin);
    ctx.stroke(cabin);
    ctx.beginPath();
    ctx.moveTo(x + half * 0.25, y + 0.6);
    ctx.lineTo(x + half * 0.25, y + 3.2);
    ctx.stroke();
  }
}

/**
 * Where a sailboat is `time` seconds after the sea began: how far along its stretch, and which way
 * it faces, from 1 sailing right through 0 end on as it comes about to -1 sailing left.
 */
function sailingAt(
  spec: SailSpec,
  time: number,
): { x: number; facing: number } {
  const leg = (spec.to - spec.from) / spec.speed;
  const round = 2 * (leg + COME_ABOUT);
  const t = ((((time / round + spec.start) % 1) + 1) % 1) * round;
  if (t < leg) {
    return { x: spec.from + spec.speed * t, facing: 1 };
  }
  if (t < leg + COME_ABOUT) {
    return { x: spec.to, facing: Math.cos((Math.PI * (t - leg)) / COME_ABOUT) };
  }
  if (t < 2 * leg + COME_ABOUT) {
    return { x: spec.to - spec.speed * (t - leg - COME_ABOUT), facing: -1 };
  }
  return {
    x: spec.from,
    facing: -Math.cos((Math.PI * (t - 2 * leg - COME_ABOUT)) / COME_ABOUT),
  };
}

/**
 * Draws a sailboat on the water at its distance: a white hull, a mast, and a mainsail and jib, the
 * whole boat pitching and heaving on the swell and heeling in the wind, with a light at its
 * masthead by night.
 */
function drawSailboat(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  spec: SailSpec,
  look: Look,
  sea: Sea,
): void {
  const k = camera.scale * spec.depth;
  const { x, facing } = sailingAt(spec, sea.clock);
  const sx = camera.width / 2 + (x - camera.centerX) * k;
  const reach = (spec.length + spec.mast) * k;
  if (sx < -reach || sx > camera.width + reach) {
    return;
  }
  const swell = clamp(sea.significantHeight / 2, 0, 1);
  const heave =
    (0.04 + 0.12 * swell) * Math.sin(sea.clock * 1.3 + spec.start * 20);
  const pitch =
    (0.02 + 0.05 * swell) * Math.sin(sea.clock * 1.05 + spec.start * 13);
  const heel = 0.5 * smoothstep(2, 16, Math.abs(sea.wind));
  const water =
    camera.horizonRow + (camera.horizon - sea.waterLevel - heave) * k;
  // Seen end on as it comes about, a boat is still as wide as its beam.
  const squeeze = (facing >= 0 ? 1 : -1) * Math.max(Math.abs(facing), 0.28);
  const placeBoat = (): void => {
    ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
    ctx.translate(sx, water);
    ctx.rotate(-pitch * squeeze);
  };
  placeBoat();
  ctx.scale(k * squeeze, -k);

  const half = spec.length / 2;
  const lean = Math.cos(heel);
  const mastX = half * 0.18;
  const deck = 0.5;
  const head = deck + spec.mast * lean;
  const paint = (color: Rgb): Rgb =>
    mix(lit(color, look.light.flowerLight), look.light.sky.middle, 0.1);

  // The mainsail on its boom, its leech bellied out, and the jib from the masthead to the bow.
  const clew = { x: mastX - half * 0.9, y: deck + 0.32 };
  const sails = new Path2D();
  sails.moveTo(mastX - 0.03, deck + 0.28);
  sails.lineTo(mastX - 0.03, head);
  sails.quadraticCurveTo(
    mastX - half * 0.42,
    deck + spec.mast * 0.5 * lean,
    clew.x,
    clew.y,
  );
  sails.closePath();
  sails.moveTo(mastX + 0.04, head - spec.mast * 0.1 * lean);
  sails.lineTo(half - 0.12, deck + 0.14);
  sails.quadraticCurveTo(
    mastX + half * 0.2,
    deck + 0.3,
    mastX - 0.12,
    deck + 0.42,
  );
  sails.quadraticCurveTo(
    mastX + half * 0.18,
    deck + spec.mast * 0.42 * lean,
    mastX + 0.04,
    head - spec.mast * 0.1 * lean,
  );
  sails.closePath();
  ctx.fillStyle = css(paint(SAILCLOTH));
  ctx.fill(sails);
  const shade = shadeOf(unit(-0.3 * squeeze, 0.15, 1), look);
  if (shade > 0.01) {
    ctx.fillStyle = css(look.ink, SHADE.tone * shade);
    ctx.fill(sails);
  }

  // A sloop's hull: its sheer rising to the bow, a raked stem, a transom, and a dark stripe along
  // the water.
  const hull = new Path2D();
  hull.moveTo(-half, deck - 0.02);
  hull.quadraticCurveTo(-half * 0.1, deck - 0.12, half, deck + 0.1);
  hull.quadraticCurveTo(half - 0.12, deck * 0.45, half - 0.5, 0);
  hull.lineTo(-half + 0.18, 0);
  hull.closePath();
  ctx.fillStyle = css(paint(HULL));
  ctx.fill(hull);
  ctx.save();
  ctx.clip(hull);
  ctx.fillStyle = css(look.ink, 0.85);
  ctx.fillRect(-half, -0.1, spec.length, 0.2);
  ctx.restore();

  ctx.lineWidth = LINES.widthPx / k;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = css(look.ink, LINES.outline + 0.15);
  ctx.stroke(sails);
  ctx.stroke(hull);
  ctx.beginPath();
  ctx.moveTo(mastX, deck - 0.1);
  ctx.lineTo(mastX, head + 0.1);
  ctx.moveTo(mastX, deck + 0.28);
  ctx.lineTo(clew.x, clew.y);
  ctx.stroke();

  if (look.darkness > 0.45) {
    placeBoat();
    ctx.fillStyle = css(MASTHEAD.color, smoothstep(0.45, 0.7, look.darkness));
    ctx.beginPath();
    ctx.arc(
      mastX * k * squeeze,
      -(head + 0.15) * k,
      MASTHEAD.px,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}
