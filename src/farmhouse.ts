import { aheadOf, box, disc, line, onPage, RECEDE, topOf } from "./building";
import type { Camera } from "./camera";
import { levelById } from "./level";
import { css, lit, mix, type Rgb, type SkyLight } from "./sky";
import { at, invariant, lerp, Rng, smoothstep } from "./util";
import {
  drawSmoke,
  hatchGap,
  LAMPLIGHT,
  layGlow,
  LINES,
  type Look,
  lookOf,
  PANE,
  type Point,
  SHADE,
  type Shaded,
  shadeFace,
  shapeOf,
  SNOW_COVERS,
  unit,
  type Vec3,
} from "./village";

/**
 * A white farmhouse standing on the farm to the left of the tree, true to size, after the modern
 * farmhouses of the references: board and batten under steep roofs; a stone wing gabled toward the
 * view; a deep porch along the front and round the right end, on cedar posts and stone piers, with
 * a gable over its steps; three dormers in its roof and a stone chimney by its ridge; and a
 * three-car garage standing apart to its left. It is drawn as the barn is, seen from the ground: its front
 * toward the view and its right gable end running back to the right, its faces lit and shaded by
 * the sun or the moon.
 *
 * Its main block: where its right end stands along the ground, how deep it runs back, the height
 * of its walls under the eaves, and the pitch all its roofs share, as rise over run; how thick the
 * roofs are, square to their pitch; how far the eaves reach out past the front wall, and the roof
 * past the gable ends; the height of its floor, which the porch's floor is level with; and how far
 * its walls run down into the ground. All in meters, x from the tree's roots, heights up from the
 * ground the house stands on, and z back from the main block's front wall.
 */
const HOUSE = {
  right: -24.5,
  deep: 7,
  eaves: 3.7,
  pitch: 1,
  thick: 0.25,
  overhang: 0.4,
  verge: 0.3,
  floor: 0.5,
  sunk: 0.2,
} as const;

/**
 * The stone wing gabled toward the view: how wide it is along the front, and how far it stands out
 * in front of the main block; how far its eaves reach past its right wall, and its roof out over
 * its gable.
 */
const WING = { width: 4.4, out: 2.2, overhang: 0.35, verge: 0.3 } as const;

/** The boarded stretch of the main block left of the wing, with a shuttered window: how wide it is along the front. */
const LINK = { width: 3.4 } as const;

/**
 * The three-car garage standing apart to the left of the main block, its front in line with the
 * main block's and its roof lower: how far its right end stands from the main block's left end; how
 * wide it is along the front and how deep it runs back, and the height of its walls under the
 * eaves; how far its eaves reach out past its front and back, and its roof past its ends; how high
 * its floor stands; its doors, how many, how wide and how tall; how wide the walls between and
 * beside them are, and how high the stone at their foot; and the gable over its middle door, how
 * far its walls stand either side of the door's middle, and how far its eaves and its roof reach
 * past them.
 */
const GARAGE = {
  apart: 5,
  width: 9,
  deep: 6.6,
  eaves: 3,
  overhang: 0.35,
  verge: 0.3,
  floor: 0.15,
  doors: { count: 3, width: 2.4, height: 2.25 },
  pier: 0.45,
  stone: 0.75,
  gable: { half: 1.75, overhang: 0.25, verge: 0.22 },
} as const;

/**
 * The garage's carriage doors, of stained wood: how far apart the grooves between their boards
 * stand, and how deep the rail across under their windows and the stile down their middle are;
 * their windows across the top, how many, how far down from the top and in from the sides they
 * start, how tall they are and how far apart, and how thick the bars crossing each; the white
 * casing round each door; the black pulls either side of the middle, how tall and wide, how far
 * either side of it and how high; and the strap hinges along the outer edges, how long and deep,
 * and how far from the top and the foot.
 */
const CARRIAGE = {
  boards: 0.15,
  rail: 0.08,
  stile: 0.05,
  windows: {
    count: 4,
    from: 0.16,
    edge: 0.12,
    tall: 0.42,
    gap: 0.08,
    bar: 0.024,
  },
  casing: 0.12,
  pull: { tall: 0.34, wide: 0.026, apart: 0.12, at: 1.1 },
  hinge: { long: 0.5, deep: 0.055, from: 0.35 },
} as const;

/**
 * The porch along the front from the wing and round the house's right end, as deep as the wing
 * stands out: the foot and the top of the cedar beam along its edge; its metal roof, the height of
 * its top at the beam and how much it rises for every meter in to the wall, passing under the
 * eaves; how wide its bays either side of its gable are, from the gable's posts to the wing on the
 * left and to the house's right end; how far back along the right end it runs, and where the posts
 * along there stand, back from the front wall; how thick its cedar posts are, and how far in from
 * the wing the post at that end stands; and the stone piers they stand on, how wide and how high,
 * and the cap stone on each, how thick and how far it reaches past the pier.
 */
const PORCH = {
  beam: { low: 2.6, high: 2.94 },
  roof: { front: 2.98, rise: 0.16 },
  bays: { left: 4.4, right: 3.2 },
  side: { back: 6.4, posts: [6.25, 3.6, 0.9] },
  post: 0.26,
  endPost: 0.3,
  pier: { wide: 0.5, high: 1.15, cap: 0.07, capPast: 0.04 },
} as const;

/**
 * The gable over the porch steps, framed on top of the porch roof: how far its posts' outer faces
 * stand either side of its middle; how far its eaves reach past them, clearing the porch roof
 * under them, and its roof out in front of its face.
 */
const ENTRY = { half: 1.6, overhang: 0.25, verge: 0.2 } as const;

/** The stone steps up to the porch under its gable: how many, how far each tread runs, and how far either side of the gable's middle they reach. */
const STEPS = { count: 3, tread: 0.32, half: 1.2 } as const;

/**
 * The dormers in the roof: how far back from the front wall their faces stand; how far their walls
 * stand either side of their middles, and the height of their eaves; and how far their eaves reach
 * past their walls, and their roofs out in front.
 */
const DORMER = {
  back: 1,
  half: 0.7,
  eaves: 6,
  overhang: 0.15,
  verge: 0.15,
} as const;

/**
 * The stone chimney by the ridge: how far in from the right end it stands, how wide and deep it
 * is, how far back its front stands, and the height of its top; the concrete crown on the stone,
 * how thick and how far past it; and the black cap over the flue, how far it reaches past the
 * crown, how high it is raised on its legs, how thick its plate is and how high the low roof over
 * it rises, and how thick its legs are.
 */
const CHIMNEY = {
  inset: 0.5,
  wide: 0.8,
  deep: 0.8,
  back: 2.3,
  top: 8.25,
  crown: { thick: 0.08, past: 0.04 },
  cap: { past: 0.07, lift: 0.17, thick: 0.06, hip: 0.13, leg: 0.04 },
} as const;

/** The house's colors before the light on them. */
const PAINT = {
  walls: [236, 233, 225] as Rgb,
  trim: [246, 244, 238] as Rgb,
  roof: [66, 66, 70] as Rgb,
  metal: [54, 56, 60] as Rgb,
  cedar: [154, 98, 58] as Rgb,
  stone: [174, 166, 152] as Rgb,
  capstone: [196, 190, 178] as Rgb,
  mortar: [206, 200, 188] as Rgb,
  foundation: [156, 152, 144] as Rgb,
  frames: [34, 34, 36] as Rgb,
  iron: [40, 40, 42] as Rgb,
  door: [150, 98, 60] as Rgb,
  shutters: [92, 90, 88] as Rgb,
} as const;

type PaintName = keyof typeof PAINT;

/**
 * The stone of the wing, the piers, the porch's skirt, the steps and the chimney, laid in courses:
 * how tall the courses are and how long the stones, how wide the mortar between them, the stones'
 * tones, and how many CSS pixels long the shortest stone must be before they are laid one by one.
 */
const STONE = {
  course: [0.13, 0.24],
  long: [0.24, 0.62],
  joint: 0.014,
  tones: [
    [172, 164, 150],
    [186, 178, 162],
    [158, 150, 140],
    [180, 168, 152],
    [150, 144, 136],
    [194, 186, 170],
  ],
  leastPx: 5,
} as const;

/**
 * Lines faintly over the house: how far apart the battens stand on its boarded walls, on the front
 * and, running back, on the gable end; the courses of shingles up its roofs, and the joints between
 * the shingles along each; and the standing seams down its metal roofs. How strongly they show in
 * ink, and on the dark roofs in pale, the joints between shingles fainter; and how many CSS pixels
 * apart they must stand before they do, the joints between shingles later.
 */
const GRAIN = {
  battens: 0.4,
  sideBattens: 0.8,
  courses: 0.26,
  shingles: 0.9,
  seams: 0.45,
  alpha: 0.13,
  sheen: 0.1,
  joints: 0.05,
  leastPx: 3,
  shinglesPx: 7,
} as const;

/**
 * The windows: the white casing round each, how far its sill reaches past the casing either side,
 * how deep the sill is and the shadow under it; and the black frame round its glass, the mullions
 * between its sashes and the bars between its panes. Over a window set in stone a cedar header
 * stands instead of casing, `gap` above it, `tall` tall and reaching `past` beyond it either side,
 * and a stone sill under it, `sill` deep and reaching `sillPast` beyond it.
 */
const CASING = {
  width: 0.1,
  sill: { past: 0.05, deep: 0.06, shadow: 0.05 },
} as const;
const SASH = { frame: 0.05, mullion: 0.07, bar: 0.024 } as const;
const HEADER = {
  gap: 0.04,
  tall: 0.24,
  past: 0.3,
  sill: 0.1,
  sillPast: 0.12,
} as const;

/** The shutters either side of a window: how far out from its casing they hang, and how deep the battens across them are. */
const SHUTTER = { gap: 0.04, batten: 0.07 } as const;

/**
 * The cedar trusses in the gables of the wing and of the porch: how far they stand out from the
 * gable's boards, under the roof's edge; how far below the tie the king post drops to a point, in
 * timbers' thicknesses; how far up toward the peak the struts reach, as a share of the way from the
 * tie; the black steel strap over the joint at the king post's foot, an upside-down T, how wide
 * it is, how far it runs along the tie either side of the king post's middle and up the king post
 * above the tie, how big its bolts are, and how far out along the tie and up the king post they
 * stand, besides the one through the middle of the joint, all in timbers' thicknesses; the light
 * catching the timbers' edges and the shade along
 * the edges turned away, and the deeper shade of their sides; and the lines of their grain, each
 * where it starts across the timber and how far it wanders by the far end, in thicknesses, and how
 * many CSS pixels wide a timber must show before its grain does.
 */
const TRUSS = {
  out: 0.16,
  drop: 1.1,
  reach: 0.55,
  strap: {
    wide: 0.5,
    along: 1.65,
    up: 1.3,
    bolt: 0.075,
    alongTie: [0.95, 1.42],
    upPost: [0.42, 0.98],
  },
  lit: 0.3,
  shade: 0.3,
  side: 0.45,
  grain: [
    [-0.28, 0.06],
    [0.04, -0.05],
    [0.3, 0.04],
  ],
  grainPx: 9,
} as const;

/**
 * The double front doors: how wide and tall they are, up from the porch floor; the black stiles
 * and rails framing their glass, the rail along their foot, and how many panes each leaf's glass is
 * barred into; the white casing round them; and the pulls where they meet, how tall and wide, how
 * far either side of the meeting, and how high their middles are.
 */
const DOOR = {
  width: 1.6,
  height: 2.35,
  stile: 0.08,
  foot: 0.24,
  panes: 4,
  casing: 0.14,
  pull: { tall: 0.42, wide: 0.026, apart: 0.075, at: 1.05 },
} as const;

/**
 * When each lamp in the house is lit and put out: how dark it grows first, from full day at 0 to
 * deep night at 1; and when in the night it is put out and lit again, as fractions of the night
 * from sunset to sunrise, past 1 for never. The rooms downstairs light first and go dark late in the
 * night, the hall last of all; the bedrooms in the dormers light later and go dark sooner, one lit
 * again before dawn.
 */
const LIGHTS = {
  kitchen: { wakes: 0.2, sleeps: 0.52, rises: 0.86 },
  living: { wakes: 0.3, sleeps: 0.42, rises: 2 },
  dining: { wakes: 0.36, sleeps: 0.38, rises: 2 },
  hall: { wakes: 0.4, sleeps: 0.62, rises: 0.88 },
  study: { wakes: 0.46, sleeps: 0.33, rises: 2 },
  back: { wakes: 0.52, sleeps: 0.45, rises: 2 },
  office: { wakes: 0.42, sleeps: 0.28, rises: 2 },
  bedroom: { wakes: 0.55, sleeps: 0.3, rises: 0.9 },
  guest: { wakes: 0.6, sleeps: 0.26, rises: 2 },
  nursery: { wakes: 0.62, sleeps: 0.22, rises: 2 },
  workshop: { wakes: 0.45, sleeps: 0.12, rises: 2 },
  attic: { wakes: 2, sleeps: 2, rises: 2 },
} as const;

/** A lamp's light comes up over this much of the dark, and goes out over this much of the night. */
const LAMP_FADE = { wakes: 0.06, sleeps: 0.02 } as const;

/**
 * The lanterns either side of the door: how far out from the door's casing they hang and how high
 * their middles are, how far out from the wall they stand, and how dark it grows before they are
 * lit; their glow; and the pool of their light on the wall, how far it reaches, how far below the
 * lantern its middle lies, and how strong it is.
 */
const SCONCE = {
  beside: 0.25,
  at: 1.75,
  out: 0.14,
  wakes: 0.3,
  glow: { reach: 0.9, alpha: 0.85 },
  pool: { reach: 1.5, below: 0.25, alpha: 0.3 },
} as const;

/** The glow about a lit window, as wide as so many of its heights, and how strong. */
const WINDOW_GLOW = { reach: 1.3, alpha: 0.5 } as const;

/**
 * The rocking chairs on the porch, two either side of a little table before the living room's
 * window and one before the dining room's: how far back from the porch's front they stand, and how
 * far either side of the window the two stand.
 */
const CHAIRS = { back: 1.15, apart: 0.48 } as const;

/**
 * Shadows: how dark the shadows thrown on the walls are, and at most how far down a wall the shadow
 * of an overhanging roof reaches, as a share of the wall's height; how far, at most, the porch's
 * shadow is cast back across the wall behind it, in meters, however low the light comes in; how dark
 * the shadow under a sill is; and the darkening at the foot of the walls, how far up and how dark.
 */
const SHADOW = {
  alpha: 0.26,
  deepest: 0.45,
  reach: 8,
  sill: 0.16,
  foot: { up: 0.25, alpha: 0.1 },
} as const;

/** How dark the undersides of the roofs are, shaded evenly, lit only by what the ground throws back up. */
const UNDERSIDE = { tone: 0.24 } as const;

/** Width of the lines drawn on the house, at least, in meters. */
const LEAST_LINE = 0.012;

const MR = HOUSE.right;
const MD = HOUSE.deep;
const S = HOUSE.pitch;
const FOOT = -HOUSE.sunk;
/** How thick the roofs are, plumb. */
const PLUMB = HOUSE.thick * Math.hypot(1, S);
/** How far in front of the front wall the porch and the wing's gable stand. */
const OUT = -WING.out;
/** The middle of the porch's gable. */
const DC = MR - PORCH.bays.right - ENTRY.half;
/** The wing's right and left ends, and its middle. */
const WR = DC - ENTRY.half - PORCH.bays.left;
const WL = WR - WING.width;
const WC = (WL + WR) / 2;
/** The main block's left end; the garage's right end, apart from it, and its left end; and how deep the garage runs back. */
const ML = WL - LINK.width;
const GR = ML - GARAGE.apart;
const GL = GR - GARAGE.width;
const GD = GARAGE.deep;
/** The porch's outer edge along the house's right end, and how far back it runs there. */
const PX = MR - OUT;
const PZ = PORCH.side.back;

/** Height of the ground the house stands on, on the rise at the farm's left. */
const GROUND = levelById("farm").groundAt(MR);

/** Height of the main roof's underside `z` back from the front wall, over its front or back pitch. */
function mainUnder(z: number): number {
  return HOUSE.eaves + S * Math.min(z, MD - z);
}

/** Height of the main roof's top `z` back from the front wall. */
function mainTop(z: number): number {
  return mainUnder(z) + PLUMB;
}

const RIDGE_UNDER = mainUnder(MD / 2);
const RIDGE_TOP = RIDGE_UNDER + PLUMB;
/** The main roof's underside and top along its eaves, where they reach out past the walls. */
const EAVE_UNDER = mainUnder(-HOUSE.overhang);
const EAVE_TOP = EAVE_UNDER + PLUMB;

/**
 * How far back a roof running into the main roof's front pitch reaches at height `y`: to the board
 * along the eaves below the main roof's top there, and up the pitch above it.
 */
function intoMainRoof(y: number): number {
  return y < EAVE_TOP ? -HOUSE.overhang : (y - HOUSE.eaves - PLUMB) / S;
}

/** The garage roof's underside and top along its eaves, and its ridge's top. */
const GARAGE_EAVE_UNDER = GARAGE.eaves - S * GARAGE.overhang;
const GARAGE_EAVE_TOP = GARAGE_EAVE_UNDER + PLUMB;
const GARAGE_RIDGE_TOP = GARAGE.eaves + (S * GD) / 2 + PLUMB;

/** Height of the garage roof's underside `z` back from its front, over its front or back pitch. */
function garageUnder(z: number): number {
  return GARAGE.eaves + S * Math.min(z, GD - z);
}

/**
 * How far back a roof running into the garage roof's front pitch reaches at height `y`: to the
 * board along the eaves below the garage roof's top there, and up the pitch above it.
 */
function intoGarageRoof(y: number): number {
  return y < GARAGE_EAVE_TOP
    ? -GARAGE.overhang
    : (y - GARAGE.eaves - PLUMB) / S;
}

/**
 * A gable end running back to the right: where it stands along the ground and how deep it runs
 * back; the height of its floor, and of its walls under the eaves; how far the roof over it reaches
 * past it, and out past the front and back walls; and the height of the roof's underside `z` back.
 */
interface GableEnd {
  x: number;
  deep: number;
  floor: number;
  eaves: number;
  verge: number;
  overhang: number;
  under: (z: number) => number;
}

/** The main block's right end, and the garage's. */
const MAIN_END: GableEnd = {
  x: MR,
  deep: MD,
  floor: HOUSE.floor,
  eaves: HOUSE.eaves,
  verge: HOUSE.verge,
  overhang: HOUSE.overhang,
  under: mainUnder,
};
const GARAGE_END: GableEnd = {
  x: GR,
  deep: GD,
  floor: GARAGE.floor,
  eaves: GARAGE.eaves,
  verge: GARAGE.verge,
  overhang: GARAGE.overhang,
  under: garageUnder,
};

/** Height of the porch roof's top `z` back from the front wall, along the front. */
function porchTop(z: number): number {
  return PORCH.roof.front + PORCH.roof.rise * (z - OUT);
}

/** Height of the porch roof's top `x` along the ground, along the house's right end. */
function sideTop(x: number): number {
  return PORCH.roof.front + PORCH.roof.rise * (PX - x);
}

/** Height of the porch gable's walls either side of its gable, where its eaves just clear the porch roof under the main eaves. */
const ENTRY_EAVES = porchTop(-HOUSE.overhang) + S * ENTRY.overhang + 0.01;

/**
 * How far back the middle of each post and pier along the front stands, and how far along the
 * ground the middle of each along the right end stands.
 */
const POST_Z = OUT + PORCH.post / 2;
const POST_X = PX - PORCH.post / 2;

/**
 * Where the posts stand along the porch's front: by the wing, either side of the gable, halfway
 * from there to the corner, and at the corner.
 */
const POSTS: readonly number[] = [
  WR + PORCH.endPost,
  DC - ENTRY.half + PORCH.post / 2,
  DC + ENTRY.half - PORCH.post / 2,
  (DC + ENTRY.half + PX - PORCH.post) / 2,
  POST_X,
];

/**
 * Something set back in the wall behind the porch shows between the porch posts as though it stood
 * in front of them, moved left by this much on the page; the door and the windows behind the porch
 * stand so far left, so they show framed between the posts.
 */
const BEHIND_POSTS = RECEDE * POST_Z;
const DOOR_X = DC + BEHIND_POSTS;
/**
 * The windows behind the porch, each where it shows halfway between the posts either side of it:
 * the living room's in the left bay and the dining room's in the right.
 */
const PORCH_WINDOWS: readonly number[] = [
  (at(POSTS, 0) + at(POSTS, 1)) / 2 + BEHIND_POSTS,
  (at(POSTS, 2) + at(POSTS, 3)) / 2 + BEHIND_POSTS,
];

/** The window in the boarded stretch left of the wing, in the middle of what shows of it beside the wing. */
const LINK_WINDOW = (ML + WL + RECEDE * OUT) / 2;

/** The dormers' middles along the ground, each over one of the windows below it as it shows on the page. */
const DORMERS: readonly number[] = [LINK_WINDOW, ...PORCH_WINDOWS].map(
  (x) => x - RECEDE * DORMER.back,
);

const CX1 = MR - CHIMNEY.inset;
const CX0 = CX1 - CHIMNEY.wide;
const CZ0 = CHIMNEY.back;
const CZ1 = CZ0 + CHIMNEY.deep;

/** Where the smoke rises from the chimney, under its cap, on the page above the house's ground. */
const SMOKE_FROM: Point = onPage(
  (CX0 + CX1) / 2,
  CHIMNEY.top + CHIMNEY.crown.thick + CHIMNEY.cap.lift / 2,
  (CZ0 + CZ1) / 2,
);

/** Where the smoke rises from the chimney, in the world. */
export const FLUE: Point = { x: SMOKE_FROM.x, y: SMOKE_FROM.y + GROUND };

/** When in the cold of the year the chimney's fire is lit, as the village's are. */
const FIRE_PHASE = 0.15;

/**
 * A face of the house: what it is painted, whether snow lies on it, and the stones laid over it,
 * in each tone, if it is of stone; and whether it is the underside of a roof, which is shaded
 * evenly rather than as the light falls on it.
 */
interface Face extends Shaded {
  paint: PaintName;
  snowy: boolean;
  stones: Path2D[] | undefined;
  under: boolean;
}

/** Makes a face from its outline on the page, the way it faces, what it is painted, and whether snow lies on it. */
type FaceMaker = (
  points: Point[],
  normal: Vec3,
  paint: PaintName,
  snowy?: boolean,
) => Face;

/** A gable end as it shows on the page: its wall, the foundation along its foot, its battens, the boards up its corners, and its windows. */
interface EndParts {
  wall: Face;
  foundation: Face;
  battens: Path2D;
  trim: Path2D;
  openings: Openings;
}

/** A lamp behind a window or a door: its glass and the black frame barring it, the middle and height of its glass, and when it is lit. */
interface Lamp {
  glass: Path2D;
  frames: Path2D;
  middle: Point;
  height: number;
  wakes: number;
  sleeps: number;
  rises: number;
}

/**
 * What is set into a wall: the white casings round its windows and doors, their sills and the
 * shadows under them; cedar headers and stone sills where it is of stone; its shutters and the
 * battens across them; its glass, the black frames and bars over it, and the iron pulls on its
 * doors; and the lamps behind it.
 */
interface Openings {
  trim: Path2D;
  sills: Path2D;
  cedar: Path2D;
  stone: Path2D;
  shutters: Path2D;
  battens: Path2D;
  glass: Path2D;
  frames: Path2D;
  iron: Path2D;
  lamps: Lamp[];
}

/** A gable toward the view and the roof running back from it, as they show on the page. */
interface Gable {
  /** How far back its face stands, and how far out its roof reaches in front of it. */
  z: number;
  verge: number;
  face: Face;
  /** The underside of its roof over the face, from the left eaves over the ridge to the right eaves, in meters along the ground and up. */
  under: Point[];
  /** The pitch right of the ridge, and the courses or seams along it. */
  roof: Face;
  lines: Path2D;
  /** Under the left pitch where it reaches out past the face and the left wall, seen from below. */
  soffit: Face;
  /** The boards along the roof's edge over the face, and along its right eaves. */
  verges: Face;
  fascia: Face;
  /** The battens on the face's boards. */
  battens: Path2D;
}

/**
 * A timber of a truss: its outline in meters along the ground and up, counterclockwise; its middle
 * line from end to end, and how thick it is; and on the page its face standing out from the gable,
 * the sides of the edges turned to the right running back to the gable, and the grain along it.
 */
interface Timber {
  outline: Point[];
  from: Point;
  to: Point;
  width: number;
  face: Shaded;
  sides: Path2D;
  grain: Path2D;
}

/**
 * A cedar truss standing out from a gable, built: how far back its face stands; its timbers, in the
 * order they are drawn, each over the last; and on the page the steel strap over the joint at the
 * king post's foot, and the bolts through it.
 */
interface Truss {
  z: number;
  timbers: Timber[];
  strap: Path2D;
  bolts: Path2D;
}

/** The lantern either side of the door: its iron, its glass, the flame within, and the middle of it. */
interface Sconce {
  iron: Path2D;
  glass: Path2D;
  flame: Path2D;
  middle: Point;
}

/** The garage's carriage doors on the page: their wood, the grooves between its boards, the rails and stiles over it, the glass of their windows and the bars across it, their iron, and the casing round them, each as one shape. */
interface Doors {
  wood: Path2D;
  grooves: Path2D;
  rails: Path2D;
  glass: Path2D;
  bars: Path2D;
  iron: Path2D;
  trim: Path2D;
}

/** The house, built once and drawn every frame, its parts in the order they are drawn. */
interface Built {
  /**
   * The garage: its front wall and battens, its doors, the stone at the foot of its walls, the
   * boards up its corners, its lanterns; its gable end, the underside of its roof's back pitch and
   * the boards along its edges over it; its roof and the courses and joints of its shingles, the
   * board along its eaves either side of the gable over its middle door, and that gable.
   */
  garageWall: Face;
  garageBattens: Path2D;
  garageDoors: Doors;
  garageStone: Face[];
  garageTrim: Path2D;
  garageSconces: Sconce[];
  garageEnd: EndParts;
  garageSoffit: Face;
  garageVerges: Face[];
  garageRoof: Face;
  garageCourses: Path2D;
  garageShingles: Path2D;
  garageFascia: Face[];
  garageGable: Gable;
  /** The right gable end, its foundation, its battens and corner boards, and its windows. */
  gableEnd: Face;
  gableFoundation: Face;
  gableBattens: Path2D;
  gableTrim: Path2D;
  gableOpenings: Openings;
  /**
   * The front wall from end to end, its battens, the foundation under its boarded
   * stretch, the boards up its corners, its door and windows, and the lanterns by the door.
   */
  wall: Face;
  wallBattens: Path2D;
  wallFoundation: Face;
  wallTrim: Path2D;
  wallOpenings: Openings;
  sconces: Sconce[];
  /**
   * The main roof's front pitch and the courses and joints of its shingles, the board along its
   * eaves, over the gable end the boards along its edges and the underside of its back pitch, and
   * the downspout down the gable end's back corner.
   */
  roof: Face;
  courses: Path2D;
  shingles: Path2D;
  fascia: Face;
  verges: Face[];
  soffit: Face;
  downspout: Path2D;
  chimney: Face[];
  chimneyTop: Face[];
  flue: Path2D;
  dormers: { gable: Gable; cheek: Face; openings: Openings }[];
  /** The wing: its right wall, its gable of stone and boards, the trim between, its window and the truss in its gable. */
  wingSide: Face;
  wing: Gable;
  wingStone: Face;
  wingFrieze: Path2D;
  wingOpenings: Openings;
  wingTruss: Truss;
  /** The porch roof along the right end and along the front, the seams down each, and the drips along their edges. */
  porchRoof: Face[];
  seams: Path2D[];
  drip: Face[];
  /**
   * The porch's stone skirts and the nosings along its floor, the chairs on it, and its piers,
   * posts and beams, those along the right end before those along the front.
   */
  skirt: Face[];
  nosing: Face[];
  chairs: { thick: Path2D; thin: Path2D };
  piers: Face[];
  posts: Face[];
  beam: Face[];
  /** The gable over the steps, the truss in it, and the steps. */
  entry: Gable;
  entryTruss: Truss;
  steps: Face[];
}

let built: Built | undefined;

/**
 * Draws the farmhouse on its ground, in world meters placed by `world`, lit by `light` in `season`, from
 * midsummer at 0 to midwinter at 1, with snow lying `snow` meters deep, `clock` seconds in, with the
 * wind blowing `draft` meters a second past its chimney. It is drawn from the back to the front,
 * each part outlined as it is drawn so the nearer parts hide the lines behind them: the garage, the
 * gable end, the front wall, the roof with the chimney and dormers, the wing, the porch and the
 * gable over its steps. Each wall is shaded as far as it turns from
 * the light and in the shadows the roofs and the porch throw on it; its windows light one by one as
 * the evening comes on, and go dark again late in the night; and smoke rises from its chimney once
 * the cold comes on.
 */
export function drawFarmhouse(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  world: DOMMatrix,
  light: SkyLight,
  season: number,
  snow: number,
  clock: number,
  draft: number,
): void {
  built ??= buildHouse();
  const house = built;
  const look = lookOf(light, season, snow, clock, draft);
  const k = camera.scale;
  const px = 1 / k;
  const gap = hatchGap(k);
  const paint = (color: Rgb): Rgb => lit(color, light.flowerLight);
  const thin = Math.max(LEAST_LINE, 0.6 * px);
  const stonesShow = at(STONE.long, 0) * k >= STONE.leastPx;
  const glows: { middle: Point; reach: number; alpha: number }[] = [];
  const onGround = world.translate(0, GROUND);
  ctx.save();
  ctx.setTransform(onGround);
  ctx.lineJoin = "round";

  const fill = (face: Face): void => {
    const color = face.snowy
      ? mix(PAINT[face.paint], look.snow, SNOW_COVERS.roof * look.snowy)
      : PAINT[face.paint];
    if (face.stones !== undefined && stonesShow) {
      ctx.fillStyle = css(paint(PAINT.mortar));
      ctx.fill(face.path);
      ctx.save();
      ctx.clip(face.path);
      face.stones.forEach((stones, i) => {
        ctx.fillStyle = css(paint(at(STONE.tones, i)));
        ctx.fill(stones);
      });
      ctx.restore();
    } else {
      ctx.fillStyle = css(paint(color));
      ctx.fill(face.path);
    }
    if (face.under) {
      ctx.fillStyle = css(look.ink, UNDERSIDE.tone);
      ctx.fill(face.path);
      return;
    }
    ctx.lineWidth = SHADE.widthPx * px;
    ctx.lineCap = "butt";
    shadeFace(ctx, face, look, gap, SHADE.tone, SHADE.strength, undefined);
  };
  const outline = (path: Path2D): void => {
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(LEAST_LINE, LINES.widthPx * px);
    ctx.strokeStyle = css(look.ink, LINES.outline);
    ctx.stroke(path);
  };
  const drawn = (face: Face): void => {
    fill(face);
    outline(face.path);
  };
  const faint = (
    path: Path2D,
    apart: number,
    least: number = GRAIN.leastPx,
  ): void => {
    if (apart * k < least) {
      return;
    }
    ctx.lineCap = "butt";
    ctx.lineWidth = thin;
    ctx.strokeStyle = css(look.ink, GRAIN.alpha);
    ctx.stroke(path);
  };
  // Lines over a dark roof, which ink would not show on: the pale edges of its courses or seams.
  const sheen = (
    path: Path2D,
    apart: number,
    least: number = GRAIN.leastPx,
    alpha: number = GRAIN.sheen,
  ): void => {
    if (apart * k < least) {
      return;
    }
    ctx.lineCap = "butt";
    ctx.lineWidth = thin;
    ctx.strokeStyle = css(paint(PAINT.trim), alpha * (1 - look.snowy));
    ctx.stroke(path);
  };
  const foot = (
    face: Face,
    on: (u: number, v: number) => Point,
    u0: number,
    u1: number,
  ): void => {
    ctx.save();
    ctx.clip(face.path);
    ctx.fillStyle = css(look.ink, SHADOW.foot.alpha);
    ctx.fill(shapeOf(box(on, u0, FOOT, u1, SHADOW.foot.up)));
    ctx.restore();
  };
  // What is set into a wall, as by day: casings, sills, headers, glass and frames.
  const openings = (o: Openings): void => {
    ctx.fillStyle = css(paint(PAINT.trim));
    ctx.fill(o.trim);
    ctx.fillStyle = css(paint(PAINT.cedar));
    ctx.fill(o.cedar);
    ctx.fillStyle = css(paint(PAINT.capstone));
    ctx.fill(o.stone);
    ctx.fillStyle = css(look.ink, SHADOW.sill);
    ctx.fill(o.sills);
    ctx.fillStyle = css(paint(PAINT.shutters));
    ctx.fill(o.shutters);
    ctx.fillStyle = css(paint(mix(PAINT.shutters, look.ink, 0.3)));
    ctx.fill(o.battens);
    ctx.fillStyle = css(paint(mix(PANE.day, PANE.night, look.darkness)));
    ctx.fill(o.glass);
    ctx.fillStyle = css(paint(PAINT.frames));
    ctx.fill(o.frames);
    ctx.fillStyle = css(paint(PAINT.iron));
    ctx.fill(o.iron);
  };
  // The lamps once lit, over any shadow: each pane amber, paler and hotter low in it where the lamp
  // stands inside, its frame dark across it, and a soft glow about it.
  const lamps = (o: Openings): void => {
    for (const lamp of o.lamps) {
      const burn = burning(lamp, look);
      if (burn <= 0) {
        continue;
      }
      ctx.fillStyle = css(mix(PANE.night, LAMPLIGHT.pane, burn));
      ctx.fill(lamp.glass);
      const { middle, height } = lamp;
      const heart = ctx.createRadialGradient(
        middle.x,
        middle.y - height * 0.15,
        0,
        middle.x,
        middle.y - height * 0.15,
        height * 0.6,
      );
      heart.addColorStop(0, css(LAMPLIGHT.heart, 0.75 * burn));
      heart.addColorStop(1, css(LAMPLIGHT.heart, 0));
      ctx.save();
      ctx.clip(lamp.glass);
      ctx.fillStyle = heart;
      ctx.fillRect(
        middle.x - height,
        middle.y - height,
        height * 2,
        height * 2,
      );
      ctx.restore();
      ctx.fillStyle = css(PAINT.frames);
      ctx.fill(lamp.frames);
      glows.push({
        middle,
        reach: height * WINDOW_GLOW.reach,
        alpha: WINDOW_GLOW.alpha * burn,
      });
    }
  };
  const lanterns = smoothstep(SCONCE.wakes, SCONCE.wakes + 0.1, look.darkness);
  // Lanterns on a wall: their iron by day, the pool of their light on the wall once lit, and the
  // lanterns themselves alight over it.
  const lanternIron = (sconces: readonly Sconce[]): void => {
    ctx.fillStyle = css(paint(PAINT.iron));
    for (const sconce of sconces) {
      ctx.fill(sconce.iron);
    }
  };
  const lanternLight = (wall: Face, sconces: readonly Sconce[]): void => {
    if (lanterns > 0) {
      for (const sconce of sconces) {
        drawPool(ctx, wall, sconce, lanterns * look.darkness);
      }
    }
  };
  const lanternsLit = (sconces: readonly Sconce[]): void => {
    for (const sconce of sconces) {
      drawSconce(ctx, sconce, look, paint, lanterns);
      if (lanterns > 0) {
        glows.push({
          middle: sconce.middle,
          reach: SCONCE.glow.reach,
          alpha: SCONCE.glow.alpha * lanterns,
        });
      }
    }
  };
  // Carriage doors: their wood and the grooves between its boards, the rails and stile over it, the
  // glass of their windows and the bars across it, their iron, and the casing round them.
  const carriageDoors = (doors: Doors): void => {
    ctx.fillStyle = css(paint(PAINT.door));
    ctx.fill(doors.wood);
    faint(doors.grooves, CARRIAGE.boards);
    ctx.fillStyle = css(paint(mix(PAINT.door, look.ink, 0.15)));
    ctx.fill(doors.rails);
    ctx.fillStyle = css(paint(mix(PANE.day, PANE.night, look.darkness)));
    ctx.fill(doors.glass);
    ctx.fillStyle = css(paint(mix(PAINT.door, look.ink, 0.3)));
    ctx.fill(doors.bars);
    ctx.fillStyle = css(paint(PAINT.iron));
    ctx.fill(doors.iron);
    ctx.fillStyle = css(paint(PAINT.trim));
    ctx.fill(doors.trim);
    outline(doors.wood);
  };
  const flat = (u: number, v: number): Point => ({ x: u, y: v });

  // The garage: its wall, its doors and the stone at the foot of its walls, and its lanterns, in
  // the shadow of its eaves; its gable end, running back to the right in the shadow of its roof's
  // edge; its roof, the board along its eaves either side of the gable over its middle door, and
  // that gable.
  fill(house.garageWall);
  faint(house.garageBattens, GRAIN.battens);
  carriageDoors(house.garageDoors);
  for (const face of house.garageStone) {
    drawn(face);
  }
  ctx.fillStyle = css(paint(PAINT.trim));
  ctx.fill(house.garageTrim);
  lanternIron(house.garageSconces);
  foot(house.garageWall, flat, GL, GR);
  drawEavesShadow(
    ctx,
    house.garageWall,
    GL - GARAGE.verge,
    GR + GARAGE.verge,
    GARAGE_EAVE_UNDER,
    GARAGE.overhang,
    look,
  );
  lanternLight(house.garageWall, house.garageSconces);
  lanternsLit(house.garageSconces);
  outline(house.garageWall.path);
  outline(house.garageDoors.trim);
  outline(house.garageTrim);
  const garageEnd = house.garageEnd;
  const garageSideOn = (u: number, v: number): Point => onPage(GR, v, u);
  fill(garageEnd.wall);
  faint(garageEnd.battens, GRAIN.sideBattens * RECEDE);
  drawn(garageEnd.foundation);
  openings(garageEnd.openings);
  ctx.fillStyle = css(paint(PAINT.trim));
  ctx.fill(garageEnd.trim);
  foot(garageEnd.wall, garageSideOn, 0, GD);
  drawGableEndShadow(ctx, garageEnd.wall, GARAGE_END, look);
  lamps(garageEnd.openings);
  outline(garageEnd.wall.path);
  outline(garageEnd.trim);
  drawn(house.garageSoffit);
  for (const face of house.garageVerges) {
    drawn(face);
  }
  fill(house.garageRoof);
  sheen(house.garageCourses, GRAIN.courses);
  sheen(house.garageShingles, GRAIN.courses, GRAIN.shinglesPx, GRAIN.joints);
  outline(house.garageRoof.path);
  for (const face of house.garageFascia) {
    drawn(face);
  }
  drawGable(house.garageGable, undefined, () => {
    drawGableShadow(ctx, house.garageGable, undefined, look);
  });

  // The gable end, running back to the right, in the shadow of the roof's edge over it and of the
  // porch along it.
  const sideOn = (u: number, v: number): Point => onPage(MR, v, u);
  fill(house.gableEnd);
  faint(house.gableBattens, GRAIN.sideBattens * RECEDE);
  drawn(house.gableFoundation);
  openings(house.gableOpenings);
  ctx.fillStyle = css(paint(PAINT.trim));
  ctx.fill(house.gableTrim);
  foot(house.gableEnd, sideOn, 0, MD);
  drawGableEndShadow(ctx, house.gableEnd, MAIN_END, look);
  drawSidePorchShadow(ctx, house.gableEnd, look);
  lamps(house.gableOpenings);
  outline(house.gableEnd.path);
  outline(house.gableTrim);

  // The front wall from end to end: the boarded stretch left of the wing, its
  // shuttered window under the shadow of the eaves; and behind the porch, in the porch's shadow, the
  // door with a lantern either side and the windows either side of it.
  fill(house.wall);
  faint(house.wallBattens, GRAIN.battens);
  drawn(house.wallFoundation);
  ctx.fillStyle = css(paint(PAINT.trim));
  ctx.fill(house.wallTrim);
  openings(house.wallOpenings);
  lanternIron(house.sconces);
  drawEavesShadow(
    ctx,
    house.wall,
    ML - HOUSE.verge,
    WL,
    EAVE_UNDER,
    HOUSE.overhang,
    look,
  );
  drawPorchShadow(ctx, house.wall, look);
  lanternLight(house.wall, house.sconces);
  lamps(house.wallOpenings);
  lanternsLit(house.sconces);
  outline(house.wall.path);
  outline(house.wallOpenings.trim);
  outline(house.wallTrim);

  // The main roof, the board along its eaves, and the boards along its edges over the gable end
  // with the underside of its back pitch between them.
  drawn(house.soffit);
  for (const face of house.verges) {
    drawn(face);
  }
  fill(house.roof);
  sheen(house.courses, GRAIN.courses);
  sheen(house.shingles, GRAIN.courses, GRAIN.shinglesPx, GRAIN.joints);
  outline(house.roof.path);
  drawn(house.fascia);
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  ctx.lineWidth = 0.08;
  ctx.strokeStyle = css(paint(PAINT.iron));
  ctx.stroke(house.downspout);

  // The chimney, its crown, the dark of its flue and the cap over it.
  for (const face of house.chimney) {
    drawn(face);
  }
  ctx.fillStyle = css(paint(mix(PAINT.iron, look.ink, 0.6)));
  ctx.fill(house.flue);
  for (const face of house.chimneyTop) {
    drawn(face);
  }

  // The dormers.
  for (const dormer of house.dormers) {
    drawn(dormer.cheek);
    drawGable(dormer.gable, undefined, () => {
      openings(dormer.openings);
      drawGableShadow(ctx, dormer.gable, undefined, look);
      lamps(dormer.openings);
      outline(dormer.openings.trim);
    });
  }

  // The wing: its right wall in the shadow of its eaves and the porch roof, its gable of stone and
  // boards with its great window, and the truss in its gable.
  const wingSideOn = (u: number, v: number): Point => onPage(WR, v, u);
  fill(house.wingSide);
  foot(house.wingSide, wingSideOn, OUT, 0);
  drawWingSideShadow(ctx, house.wingSide, look);
  outline(house.wingSide.path);
  const wingOn = (u: number, v: number): Point => onPage(u, v, OUT);
  fill(house.wing.face);
  faint(house.wing.battens, GRAIN.battens);
  fill(house.wingStone);
  ctx.fillStyle = css(paint(PAINT.trim));
  ctx.fill(house.wingFrieze);
  openings(house.wingOpenings);
  foot(house.wingStone, wingOn, WL, WR);
  drawGableShadow(ctx, house.wing, house.wingTruss, look);
  lamps(house.wingOpenings);
  outline(house.wing.face.path);
  outline(house.wingFrieze);
  outline(house.wingOpenings.cedar);

  // The porch roof, along the right end and along the front, then the wing's roof over it.
  house.porchRoof.forEach((face, i) => {
    fill(face);
    ctx.save();
    ctx.clip(face.path);
    sheen(at(house.seams, i), GRAIN.seams);
    ctx.restore();
    outline(face.path);
  });
  drawRoofOf(house.wing, house.wingTruss);

  // The porch: its stone skirts, the chairs on it, its piers, posts and beams, and the drips along
  // its roof's edges.
  for (const face of house.skirt) {
    drawn(face);
  }
  for (const face of house.nosing) {
    drawn(face);
  }
  ctx.strokeStyle = css(paint(PAINT.iron));
  ctx.lineCap = "round";
  ctx.lineWidth = 0.045;
  ctx.stroke(house.chairs.thick);
  ctx.lineWidth = 0.024;
  ctx.stroke(house.chairs.thin);
  for (const face of house.piers) {
    drawn(face);
  }
  for (const face of house.posts) {
    drawn(face);
  }
  for (const face of house.beam) {
    drawn(face);
  }
  for (const face of house.drip) {
    drawn(face);
  }

  // The gable over the steps, the truss in it, and the steps.
  drawGable(house.entry, house.entryTruss, () => {
    drawGableShadow(ctx, house.entry, house.entryTruss, look);
  });
  for (const face of house.steps) {
    drawn(face);
  }

  if (look.fires > 0) {
    drawSmoke(ctx, { top: SMOKE_FROM, phase: FIRE_PHASE }, look, paint);
  }

  if (glows.length > 0) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    for (const glow of glows) {
      layGlow(
        ctx,
        onGround,
        camera.dpr,
        camera.scale,
        glow.middle,
        glow.reach,
        glow.reach,
        glow.alpha * look.darkness,
      );
    }
  }
  ctx.restore();

  // A gable toward the view: its face, what `inside` lays on it, and the roof over it with the
  // truss under it, if it has one.
  function drawGable(
    gable: Gable,
    truss: Truss | undefined,
    inside: () => void,
  ): void {
    fill(gable.face);
    faint(gable.battens, GRAIN.battens);
    inside();
    outline(gable.face.path);
    drawRoofOf(gable, truss);
  }

  // The roof running back from a gable: under its left pitch, the truss up under the roof, if any,
  // the right pitch with the lines along it, and the boards along its edges.
  function drawRoofOf(gable: Gable, truss: Truss | undefined): void {
    drawn(gable.soffit);
    if (truss !== undefined) {
      drawTruss(gable, truss);
    }
    fill(gable.roof);
    ctx.save();
    ctx.clip(gable.roof.path);
    sheen(
      gable.lines,
      gable.roof.paint === "metal" ? GRAIN.seams : GRAIN.courses,
    );
    ctx.restore();
    outline(gable.roof.path);
    drawn(gable.fascia);
    drawn(gable.verges);
  }

  // A truss standing out from its gable: the sides of its timbers running back to the gable; each
  // timber's face catching the light along one edge and shaded along the other, toned and hatched
  // as the gable is, with its grain; the steel strap over the joint and its bolts; and the shade of
  // the roof's edge reaching out over it all.
  function drawTruss(gable: Gable, truss: Truss): void {
    const cedar = paint(PAINT.cedar);
    const { key, keyStrength } = look;
    const whole = new Path2D();
    ctx.fillStyle = css(mix(cedar, look.ink, TRUSS.side));
    for (const timber of truss.timbers) {
      ctx.fill(timber.sides);
    }
    for (const timber of truss.timbers) {
      whole.addPath(timber.face.path);
      outline(timber.sides);
      const { from, to, width } = timber;
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      const across = {
        x: -(to.y - from.y) / length,
        y: (to.x - from.x) / length,
      };
      // From the edge the light falls on, across to the edge turned away from it.
      const toward = across.x * key.x + across.y * key.y >= 0 ? 1 : -1;
      const middle = onPage((from.x + to.x) / 2, (from.y + to.y) / 2, truss.z);
      const reach = (toward * width) / 2;
      const bevel = ctx.createLinearGradient(
        middle.x + across.x * reach,
        middle.y + across.y * reach,
        middle.x - across.x * reach,
        middle.y - across.y * reach,
      );
      bevel.addColorStop(
        0,
        css(mix(cedar, paint(look.light.sunColor), TRUSS.lit * keyStrength)),
      );
      bevel.addColorStop(0.35, css(cedar));
      bevel.addColorStop(1, css(mix(cedar, look.ink, TRUSS.shade)));
      ctx.fillStyle = bevel;
      ctx.fill(timber.face.path);
      if (width * k >= TRUSS.grainPx) {
        ctx.save();
        ctx.clip(timber.face.path);
        ctx.lineCap = "butt";
        ctx.lineWidth = thin;
        ctx.strokeStyle = css(mix(cedar, look.ink, 0.45), 0.4);
        ctx.stroke(timber.grain);
        ctx.restore();
      }
      ctx.lineWidth = SHADE.widthPx * px;
      shadeFace(
        ctx,
        timber.face,
        look,
        gap,
        SHADE.tone,
        SHADE.strength,
        undefined,
      );
      outline(timber.face.path);
    }
    ctx.fillStyle = css(paint(PAINT.iron));
    ctx.fill(truss.strap);
    outline(truss.strap);
    ctx.fillStyle = css(paint(mix(PAINT.iron, PAINT.trim, 0.35)));
    ctx.fill(truss.bolts);
    whole.addPath(truss.strap);
    if (keyStrength >= 0.02 && key.z > 0.02 && key.y > 0) {
      const verge = gable.z - gable.verge;
      ctx.save();
      ctx.clip(whole);
      ctx.fillStyle = css(look.ink, SHADOW.alpha * keyStrength);
      ctx.fill(rakeShadow(gable, truss.z, (truss.z - verge) / key.z, key));
      ctx.restore();
    }
  }
}

/** How brightly `lamp` burns, from 0 to 1. */
function burning(lamp: Lamp, look: Look): number {
  const on = smoothstep(
    lamp.wakes,
    lamp.wakes + LAMP_FADE.wakes,
    look.darkness,
  );
  if (on <= 0) {
    return 0;
  }
  const out =
    smoothstep(lamp.sleeps, lamp.sleeps + LAMP_FADE.sleeps, look.night) *
    (1 - smoothstep(lamp.rises, lamp.rises + LAMP_FADE.sleeps, look.night));
  return on * (1 - out);
}

/**
 * The shadows on a gable's face while the light falls on it: the roof reaching out over it, the
 * foot of the boards along its edge cast back onto the face along the light with everything above
 * in shade, so the shadow deepens as the sun climbs and swings across the gable through the day;
 * and the timbers of its truss, if it has one, standing out from the face, each cast onto it.
 */
function drawGableShadow(
  ctx: CanvasRenderingContext2D,
  gable: Gable,
  truss: Truss | undefined,
  look: Look,
): void {
  const { key, keyStrength } = look;
  if (keyStrength < 0.02 || key.z <= 0.02 || key.y <= 0) {
    return;
  }
  const shadow = rakeShadow(gable, gable.z, gable.verge / key.z, key);
  if (truss !== undefined) {
    const t = (gable.z - truss.z) / key.z;
    for (const timber of truss.timbers) {
      shadow.addPath(
        shapeOf(
          timber.outline.map((p) =>
            onPage(p.x - t * key.x, p.y - t * key.y, gable.z),
          ),
        ),
      );
    }
  }
  ctx.save();
  ctx.clip(gable.face.path);
  ctx.fillStyle = css(look.ink, SHADOW.alpha * keyStrength);
  ctx.fill(shadow);
  ctx.restore();
}

/**
 * The shade under a gable's roof on the plane `z` back: the foot of the boards along the roof's
 * edge cast `reach` along the light `key`, and everything above.
 */
function rakeShadow(gable: Gable, z: number, reach: number, key: Vec3): Path2D {
  const cast = gable.under.map((p) =>
    onPage(p.x - reach * key.x, p.y - reach * key.y, z),
  );
  const first = at(cast, 0);
  const last = at(cast, cast.length - 1);
  const top = Math.max(...gable.under.map((p) => p.y)) + 1;
  const shadow = new Path2D();
  shadow.addPath(
    shapeOf([
      { x: first.x - 1, y: first.y },
      ...cast,
      { x: last.x + 1, y: last.y },
      { x: last.x + 1, y: top },
      { x: first.x - 1, y: top },
    ]),
  );
  return shadow;
}

/**
 * The shadow a roof's edge throws down the gable end `end` while the light falls on it from the
 * right: the foot of the boards along the edge cast back onto the wall along the light, so a band
 * of shade runs down under both pitches, deeper the higher the light and the more it skims the wall.
 */
function drawGableEndShadow(
  ctx: CanvasRenderingContext2D,
  wall: Face,
  end: GableEnd,
  look: Look,
): void {
  const { key, keyStrength } = look;
  if (keyStrength < 0.02 || key.x <= 0.02 || key.y <= 0) {
    return;
  }
  const t = Math.min(end.verge / key.x, (SHADOW.deepest * end.eaves) / key.y);
  const drop = t * key.y;
  const back = t * key.z;
  const cast = [-end.overhang, end.deep / 2, end.deep + end.overhang].map((z) =>
    onPage(end.x, end.under(z) - drop, z + back),
  );
  const first = at(cast, 0);
  const last = at(cast, cast.length - 1);
  const top = end.under(end.deep / 2) + PLUMB + 1;
  const shadow = shapeOf([
    { x: first.x - 1, y: first.y },
    ...cast,
    { x: last.x + 1, y: last.y },
    { x: last.x + 1, y: top },
    { x: first.x - 1, y: top },
  ]);
  ctx.save();
  ctx.clip(wall.path);
  ctx.fillStyle = css(look.ink, SHADOW.alpha * keyStrength);
  ctx.fill(shadow);
  ctx.restore();
}

/**
 * The shadow on the wing's right wall, which faces along the porch: under the porch roof the light
 * reaches it only from under the beam, so the shade above runs down the wall the farther back it
 * goes, deeper the higher the light; and above the porch roof the wing's own eaves shade it.
 */
function drawWingSideShadow(
  ctx: CanvasRenderingContext2D,
  wall: Face,
  look: Look,
): void {
  const { key, keyStrength } = look;
  if (keyStrength < 0.02 || key.x <= 0.02 || key.y <= 0 || key.z <= 0.02) {
    return;
  }
  const fall = Math.min((-OUT * key.y) / key.z, SHADOW.reach);
  const shadow = shapeOf([
    onPage(WR, PORCH.beam.low, OUT),
    onPage(WR, PORCH.beam.low - fall, 0),
    onPage(WR, HOUSE.eaves + 1, 0),
    onPage(WR, HOUSE.eaves + 1, OUT),
  ]);
  ctx.save();
  ctx.clip(wall.path);
  ctx.fillStyle = css(look.ink, SHADOW.alpha * keyStrength);
  ctx.fill(shadow);
  ctx.restore();
}

/**
 * The shadow the porch throws on the wall behind it: its roof from the foot of the beam along its
 * front and round the corner, the wing standing out at its left end, and its posts and piers, each cast back onto the
 * wall along the light. With the sun high the wall is in shade to the floor; as the sun sinks the
 * light reaches in under the beam, the posts striping the wall, and swings along it through the day.
 */
function drawPorchShadow(
  ctx: CanvasRenderingContext2D,
  wall: Face,
  look: Look,
): void {
  const { key, keyStrength } = look;
  if (keyStrength < 0.02 || key.y <= 0) {
    return;
  }
  const along = Math.min(1 / Math.max(key.z, 1e-3), SHADOW.reach / -OUT);
  // Where a point `forward` meters in front of the wall falls on it, cast back along the light.
  const cast = (x: number, y: number, forward: number): Point => ({
    x: x - forward * along * key.x,
    y: y - forward * along * key.y,
  });
  const out = -OUT;
  const top = porchTop(0);
  const shadow = new Path2D();
  shadow.addPath(
    shapeOf([
      cast(WR, PORCH.beam.low, out),
      cast(PX, PORCH.beam.low, out),
      { x: PX, y: PORCH.beam.low },
      { x: PX, y: top },
      { x: WR, y: top },
    ]),
  );
  shadow.addPath(
    shapeOf([
      { x: WR, y: FOOT },
      cast(WR, FOOT, out),
      cast(WR, HOUSE.eaves, out),
      { x: WR, y: HOUSE.eaves },
    ]),
  );
  // Each post and pier, as the outline of the shadows of its corners.
  const half = PORCH.post / 2;
  const pier = PORCH.pier.wide / 2;
  for (const x of POSTS) {
    for (const [w, low, high, near, far] of [
      [half, PORCH.pier.high, PORCH.beam.low, out, out - PORCH.post],
      [pier, FOOT, PORCH.pier.high, -POST_Z + pier, -POST_Z - pier],
    ] as const) {
      const corners: Point[] = [];
      for (const forward of [near, far]) {
        for (const [u, v] of [
          [x - w, low],
          [x + w, low],
          [x + w, high],
          [x - w, high],
        ] as const) {
          corners.push(cast(u, v, forward));
        }
      }
      shadow.addPath(shapeOf(hull(corners)));
    }
  }
  ctx.save();
  ctx.clip(wall.path);
  ctx.fillStyle = css(look.ink, SHADOW.alpha * keyStrength);
  ctx.fill(shadow);
  ctx.restore();
}

/**
 * The shadow the porch along the right end throws on the gable end while the light falls on it from
 * the right: its roof, from the foot of the beam along its edge to where it ends at the back, and
 * its posts and piers, each cast in onto the wall along the light, so the shade comes down the wall
 * as the sun climbs.
 */
function drawSidePorchShadow(
  ctx: CanvasRenderingContext2D,
  wall: Face,
  look: Look,
): void {
  const { key, keyStrength } = look;
  if (keyStrength < 0.02 || key.x <= 0.02 || key.y <= 0) {
    return;
  }
  const along = Math.min(1 / key.x, SHADOW.reach / (PX - MR));
  // Where a point `x` along the ground, `y` up and `z` back falls on the wall, cast in along the light.
  const cast = (x: number, y: number, z: number): Point => {
    const t = (x - MR) * along;
    return onPage(MR, y - t * key.y, z + t * key.z);
  };
  const low = PORCH.beam.low;
  const top = sideTop(MR);
  const shadow = new Path2D();
  shadow.addPath(
    shapeOf([
      onPage(MR, low, OUT),
      cast(PX, low, OUT),
      cast(PX, low, PZ),
      onPage(MR, top, PZ),
      onPage(MR, top, OUT),
    ]),
  );
  // Each post and pier along the right end, as the outline of the shadows of its corners.
  const half = PORCH.post / 2;
  const pier = PORCH.pier.wide / 2;
  for (const z of [POST_Z, ...PORCH.side.posts]) {
    for (const [w, foot, head] of [
      [half, PORCH.pier.high, PORCH.beam.low],
      [pier, FOOT, PORCH.pier.high],
    ] as const) {
      const corners: Point[] = [];
      for (const x of [POST_X - w, POST_X + w]) {
        for (const [dz, y] of [
          [-w, foot],
          [w, foot],
          [w, head],
          [-w, head],
        ] as const) {
          corners.push(cast(x, y, z + dz));
        }
      }
      shadow.addPath(shapeOf(hull(corners)));
    }
  }
  ctx.save();
  ctx.clip(wall.path);
  ctx.fillStyle = css(look.ink, SHADOW.alpha * keyStrength);
  ctx.fill(shadow);
  ctx.restore();
}

/**
 * The shadow eaves throw down a front wall while the light falls on it: the foot of the board along
 * them, `low` high and `out` in front of the wall, from `x0` to `x1` along the ground, cast back onto
 * the wall along the light, and everything above it in shade.
 */
function drawEavesShadow(
  ctx: CanvasRenderingContext2D,
  wall: Face,
  x0: number,
  x1: number,
  low: number,
  out: number,
  look: Look,
): void {
  const { key, keyStrength } = look;
  if (keyStrength < 0.02 || key.z <= 0.02 || key.y <= 0) {
    return;
  }
  const t = Math.min(out / key.z, (SHADOW.deepest * HOUSE.eaves) / key.y);
  const dx = -t * key.x;
  const dy = -t * key.y;
  const shadow = shapeOf([
    { x: x0 + dx, y: low + dy },
    { x: x1 + dx, y: low + dy },
    { x: x1 + dx, y: low + 2 },
    { x: x0 + dx, y: low + 2 },
  ]);
  ctx.save();
  ctx.clip(wall.path);
  ctx.fillStyle = css(look.ink, SHADOW.alpha * keyStrength);
  ctx.fill(shadow);
  ctx.restore();
}

/** The outline round `points`, as the smallest convex shape holding them all. */
function hull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const turn = (o: Point, a: Point, b: Point): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (from: readonly Point[]): Point[] => {
    const chain: Point[] = [];
    for (const p of from) {
      while (
        chain.length >= 2 &&
        turn(at(chain, chain.length - 2), at(chain, chain.length - 1), p) <= 0
      ) {
        chain.pop();
      }
      chain.push(p);
    }
    chain.pop();
    return chain;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/** A lantern's light pooling warm on the front wall about it, `strength` strong. */
function drawPool(
  ctx: CanvasRenderingContext2D,
  wall: Face,
  sconce: Sconce,
  strength: number,
): void {
  const { reach, below, alpha } = SCONCE.pool;
  const x = sconce.middle.x;
  const y = sconce.middle.y - below;
  const pool = ctx.createRadialGradient(x, y, 0, x, y, reach);
  pool.addColorStop(0, css(LAMPLIGHT.pane, alpha * strength));
  pool.addColorStop(0.5, css(LAMPLIGHT.pane, 0.35 * alpha * strength));
  pool.addColorStop(1, css(LAMPLIGHT.pane, 0));
  ctx.save();
  ctx.clip(wall.path);
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = pool;
  ctx.fillRect(x - reach, y - reach, reach * 2, reach * 2);
  ctx.restore();
}

/** A lantern by the door: its glass dark by day, and by night `alight` bright about its flame. */
function drawSconce(
  ctx: CanvasRenderingContext2D,
  sconce: Sconce,
  look: Look,
  paint: (color: Rgb) => Rgb,
  alight: number,
): void {
  const pane = paint(mix(PANE.day, PANE.night, look.darkness));
  ctx.fillStyle = css(mix(pane, LAMPLIGHT.pane, alight));
  ctx.fill(sconce.glass);
  if (alight > 0) {
    ctx.fillStyle = css(LAMPLIGHT.heart, alight);
    ctx.fill(sconce.flame);
  }
  ctx.fillStyle = css(paint(PAINT.iron));
  ctx.fill(sconce.iron);
}

/** Builds the house's walls, roofs, trim, windows, porch, chimney and garage on the page, once. */
function buildHouse(): Built {
  const farm = levelById("farm");
  for (let x = GL - GARAGE.verge - 1; x <= PX + RECEDE * PZ + 1; x += 0.25) {
    invariant(
      Math.abs(farm.groundAt(x) - GROUND) < 1e-6,
      `The farmhouse needs level ground under it, but at ${x.toFixed(2)} m it lies at ${farm.groundAt(x).toFixed(3)} m rather than ${GROUND.toFixed(3)} m.`,
    );
  }
  const rng = new Rng(0xfa53);
  const face = (
    points: Point[],
    normal: Vec3,
    paint: PaintName,
    snowy = false,
  ): Face => ({
    points,
    path: shapeOf(points),
    normal,
    hatch: undefined,
    paint,
    snowy,
    stones: undefined,
    under: false,
  });
  const stone = (
    points: Point[],
    normal: Vec3,
    on: (u: number, v: number) => Point,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
  ): Face => ({
    ...face(points, normal, "stone"),
    stones: layStones(on, u0, v0, u1, v1, rng),
  });
  const toward = unit(0, 0, 1);
  const right = unit(1, 0, 0);
  const corner = CASING.width + 0.04;
  const flat = (u: number, v: number): Point => ({ x: u, y: v });

  // The garage: its front wall and battens, its carriage doors, the stone at the foot of the walls
  // beside and between them standing a little proud under a cap, the boards up its corners, a
  // lantern over each wall between the doors, its roof, the board along its eaves either side of
  // the gable over its middle door, and that gable.
  const garageWall = face(
    box(flat, GL, FOOT, GR, GARAGE.eaves),
    toward,
    "walls",
  );
  const garageBattens = new Path2D();
  for (let x = GL + GRAIN.battens; x < GR - 0.05; x += GRAIN.battens) {
    line(garageBattens, flat(x, 0), flat(x, GARAGE.eaves));
  }
  const { doors, pier } = GARAGE;
  const doorAt = (i: number): number => GL + pier + i * (doors.width + pier);
  const garageDoors = emptyDoors();
  for (let i = 0; i < doors.count; i += 1) {
    carriageDoorIn(garageDoors, flat, doorAt(i), doors.height);
  }
  const garageStone: Face[] = [];
  const stoneOn = (u: number, v: number): Point => onPage(u, v, -0.03);
  const capped = GARAGE.stone - PORCH.pier.cap;
  for (let i = 0; i <= doors.count; i += 1) {
    const x0 = i === 0 ? GL : doorAt(i - 1) + doors.width;
    const x1 = i === doors.count ? GR : doorAt(i);
    garageStone.push(
      stone(
        box(stoneOn, x0, FOOT, x1, capped),
        toward,
        stoneOn,
        x0,
        FOOT,
        x1,
        capped,
      ),
      face(
        box(
          (u, v) => onPage(u, v, -0.05),
          x0 - 0.02,
          capped,
          x1 + 0.02,
          GARAGE.stone,
        ),
        toward,
        "capstone",
        true,
      ),
    );
  }
  const garageTrim = new Path2D();
  quadInto(garageTrim, box(flat, GL, GARAGE.stone, GL + corner, GARAGE.eaves));
  quadInto(garageTrim, box(flat, GR - corner, GARAGE.stone, GR, GARAGE.eaves));
  const garageSconces = [1, 2].map((i) =>
    buildSconce(doorAt(i) - pier / 2, doors.height + 0.05),
  );
  // Its gable end, with a window to the workshop inside and one up in the gable, and the edge of its
  // roof over it.
  const garageEndOn = (u: number, v: number): Point => onPage(GR, v, u);
  const garageEndOpenings = emptyOpenings();
  for (const [u, sill, width, height, lamp] of [
    [GD * 0.35, 1, 0.8, 1.2, LIGHTS.workshop],
    [GD / 2, GARAGE.eaves + 1.3, 0.55, 0.6, LIGHTS.attic],
  ] as const) {
    windowIn(garageEndOpenings, garageEndOn, {
      u,
      sill,
      width,
      height,
      sashes: 1,
      across: 2,
      up: 2,
      transom: 0,
      stone: false,
      shutters: false,
      lamp,
    });
  }
  const garageEnd = {
    ...buildGableEnd(GARAGE_END, face),
    openings: garageEndOpenings,
  };
  const { verges: garageVerges, soffit: garageSoffit } = buildRoofEdge(
    GARAGE_END,
    face,
  );
  const garageEave = -GARAGE.overhang;
  const garageLeft = GL - GARAGE.verge;
  const garageRight = GR + GARAGE.verge;
  const garageRoof = face(
    [
      onPage(garageLeft, GARAGE_EAVE_TOP, garageEave),
      onPage(garageRight, GARAGE_EAVE_TOP, garageEave),
      onPage(garageRight, GARAGE_RIDGE_TOP, GD / 2),
      onPage(garageLeft, GARAGE_RIDGE_TOP, GD / 2),
    ],
    unit(0, 1, S),
    "roof",
    true,
  );
  const [garageCourses, garageShingles] = shingled(
    garageLeft,
    garageRight,
    GARAGE_EAVE_TOP,
    GARAGE_RIDGE_TOP,
    garageEave,
    rng,
  );
  const middleDoor = doorAt(1) + doors.width / 2;
  const gableReach = GARAGE.gable.half + GARAGE.gable.overhang;
  const garageFascia = (
    [
      [garageLeft, middleDoor - gableReach],
      [middleDoor + gableReach, garageRight],
    ] as const
  ).map(([x0, x1]) =>
    face(
      box(
        (u, v) => onPage(u, v, garageEave),
        x0,
        GARAGE_EAVE_UNDER,
        x1,
        GARAGE_EAVE_TOP,
      ),
      toward,
      "trim",
    ),
  );
  const garageGable = buildGable(
    {
      middle: middleDoor,
      half: GARAGE.gable.half,
      eaves: GARAGE.eaves,
      base: GARAGE.eaves - 0.02,
      z: 0,
      overhang: GARAGE.gable.overhang,
      verge: GARAGE.gable.verge,
      back: intoGarageRoof,
      roof: "roof",
      sidingFrom: GARAGE.eaves - 0.02,
    },
    face,
  );

  // The gable end, `u` meters back from the front corner.
  const sideOn = (u: number, v: number): Point => onPage(MR, v, u);
  const {
    wall: gableEnd,
    foundation: gableFoundation,
    battens: gableBattens,
    trim: gableTrim,
  } = buildGableEnd(MAIN_END, face);
  const gableOpenings = emptyOpenings();
  for (const [u, lamp] of [
    [2, LIGHTS.study],
    [5, LIGHTS.back],
  ] as const) {
    windowIn(gableOpenings, sideOn, {
      u,
      sill: 1.15,
      width: 0.9,
      height: 1.5,
      sashes: 1,
      across: 1,
      up: 2,
      transom: 0,
      stone: false,
      shutters: false,
      lamp,
    });
  }
  windowIn(gableOpenings, sideOn, {
    u: MD / 2,
    sill: 5.3,
    width: 0.7,
    height: 0.75,
    sashes: 1,
    across: 2,
    up: 2,
    transom: 0,
    stone: false,
    shutters: false,
    lamp: LIGHTS.attic,
  });

  // The front wall from end to end: its battens, the foundation under its boarded
  // stretch left of the wing, the boards up its corners, the shuttered window in that stretch, the
  // door and windows behind the porch, and the lanterns by the door.
  const wall = face(box(flat, ML, FOOT, MR, HOUSE.eaves), toward, "walls");
  const wallBattens = new Path2D();
  for (let x = ML + GRAIN.battens; x < MR - 0.05; x += GRAIN.battens) {
    line(wallBattens, flat(x, HOUSE.floor), flat(x, HOUSE.eaves));
  }
  const wallFoundation = face(
    box(flat, ML, FOOT, WL, HOUSE.floor),
    toward,
    "foundation",
  );
  const wallTrim = new Path2D();
  quadInto(wallTrim, box(flat, ML, HOUSE.floor, ML + corner, HOUSE.eaves));
  quadInto(wallTrim, box(flat, MR - corner, HOUSE.floor, MR, HOUSE.eaves));
  const wallOpenings = emptyOpenings();
  const sashed = {
    sill: HOUSE.floor + 0.62,
    width: 0.95,
    height: 1.6,
    sashes: 1,
    across: 2,
    up: 2,
    transom: 0,
    stone: false,
  };
  windowIn(wallOpenings, flat, {
    ...sashed,
    u: LINK_WINDOW,
    shutters: true,
    lamp: LIGHTS.office,
  });
  PORCH_WINDOWS.forEach((u, i) => {
    windowIn(wallOpenings, flat, {
      ...sashed,
      u,
      shutters: i === 0,
      lamp: i === 0 ? LIGHTS.living : LIGHTS.dining,
    });
  });
  doorIn(wallOpenings, flat, DOOR_X, LIGHTS.hall);
  const sconces = [-1, 1].map((side) =>
    buildSconce(
      DOOR_X + side * (DOOR.width / 2 + DOOR.casing + SCONCE.beside),
      HOUSE.floor + SCONCE.at,
    ),
  );

  // The main roof: its front pitch, the shingles' courses and the joints along them, the board
  // along its eaves, and over the gable end the boards along its edges, the underside of its back
  // pitch between them, and a downspout from the gutter along the back eaves down the back corner.
  const left = ML - HOUSE.verge;
  const rightEdge = MR + HOUSE.verge;
  const eaveZ = -HOUSE.overhang;
  const roof = face(
    [
      onPage(left, EAVE_TOP, eaveZ),
      onPage(rightEdge, EAVE_TOP, eaveZ),
      onPage(rightEdge, RIDGE_TOP, MD / 2),
      onPage(left, RIDGE_TOP, MD / 2),
    ],
    unit(0, 1, S),
    "roof",
    true,
  );
  const [courses, shingles] = shingled(
    left,
    rightEdge,
    EAVE_TOP,
    RIDGE_TOP,
    eaveZ,
    rng,
  );
  const fascia = face(
    [
      onPage(left, EAVE_UNDER, eaveZ),
      onPage(rightEdge, EAVE_UNDER, eaveZ),
      onPage(rightEdge, EAVE_TOP, eaveZ),
      onPage(left, EAVE_TOP, eaveZ),
    ],
    toward,
    "trim",
  );
  const { verges, soffit } = buildRoofEdge(MAIN_END, face);
  const downspout = new Path2D();
  const spout = MR - 0.06;
  const spoutPath = [
    onPage(spout, EAVE_TOP - 0.02, MD + HOUSE.overhang - 0.1),
    onPage(spout, EAVE_UNDER - 0.15, MD + 0.05),
    onPage(spout, 0.3, MD + 0.05),
    onPage(spout, 0.05, MD - 0.25),
  ];
  spoutPath.forEach((p, i) =>
    i === 0 ? downspout.moveTo(p.x, p.y) : downspout.lineTo(p.x, p.y),
  );

  // The chimney: its stone front and right side above the roof, its crown, the dark of its flue
  // and the cap raised over it on its legs.
  const chimneyFrontOn = (u: number, v: number): Point => onPage(u, v, CZ0);
  const chimneySideOn = (u: number, v: number): Point => onPage(CX1, v, u);
  const { top } = CHIMNEY;
  const chimney = [
    stone(
      box(chimneyFrontOn, CX0, mainTop(CZ0), CX1, top),
      toward,
      chimneyFrontOn,
      CX0,
      mainTop(CZ0) - 0.3,
      CX1,
      top,
    ),
    stone(
      [
        chimneySideOn(CZ0, mainTop(CZ0)),
        chimneySideOn(CZ1, mainTop(CZ1)),
        chimneySideOn(CZ1, top),
        chimneySideOn(CZ0, top),
      ],
      right,
      chimneySideOn,
      CZ0,
      mainTop(CZ0) - 0.3,
      CZ1,
      top,
    ),
  ];
  const { crown, cap } = CHIMNEY;
  const crownTop = top + crown.thick;
  const capLow = crownTop + cap.lift;
  const capHigh = capLow + cap.thick;
  const reachOf = (past: number): [number, number, number, number] => [
    CX0 - past,
    CX1 + past,
    CZ0 - past,
    CZ1 + past,
  ];
  const slab = (
    past: number,
    low: number,
    high: number,
    paint: PaintName,
  ): Face[] => {
    const [x0, x1, z0, z1] = reachOf(past);
    return [
      face(
        box((u, v) => onPage(u, v, z0), x0, low, x1, high),
        toward,
        paint,
      ),
      face(
        box((u, v) => onPage(x1, v, u), z0, low, z1, high),
        right,
        paint,
      ),
    ];
  };
  const [x0, x1, z0, z1] = reachOf(cap.past);
  const legs: Face[] = [];
  for (const [x, z] of [
    [CX0 - crown.past + cap.leg, CZ0 - crown.past],
    [CX1 + crown.past - cap.leg, CZ0 - crown.past],
    [CX1 + crown.past - cap.leg, CZ1 + crown.past - cap.leg],
  ] as const) {
    legs.push(
      face(
        box(
          (u, v) => onPage(u, v, z),
          x - cap.leg / 2,
          crownTop,
          x + cap.leg / 2,
          capLow,
        ),
        toward,
        "iron",
      ),
    );
  }
  const chimneyTop = [
    ...slab(crown.past, top, crownTop, "foundation"),
    ...legs,
    ...slab(cap.past, capLow, capHigh, "iron"),
    face(
      [
        onPage(x0, capHigh, z0),
        onPage(x1, capHigh, z0),
        onPage((x0 + x1) / 2 + cap.hip, capHigh + cap.hip, z0 + cap.hip),
        onPage((x0 + x1) / 2 - cap.hip, capHigh + cap.hip, z0 + cap.hip),
      ],
      unit(0, 1, 1),
      "iron",
      true,
    ),
    face(
      [
        onPage(x1, capHigh, z0),
        onPage(x1, capHigh, z1),
        onPage((x0 + x1) / 2 + cap.hip, capHigh + cap.hip, z1 - cap.hip),
        onPage((x0 + x1) / 2 + cap.hip, capHigh + cap.hip, z0 + cap.hip),
      ],
      unit(1, 1, 0),
      "iron",
      true,
    ),
  ];
  const flue = new Path2D();
  quadInto(
    flue,
    box(
      (u, v) => onPage(u, v, CZ0 - crown.past),
      CX0,
      crownTop,
      CX1 + 0.3 * crown.past,
      capLow,
    ),
  );

  // The dormers, each with a window in its face and its right cheek running back to the roof.
  const bedrooms = [LIGHTS.nursery, LIGHTS.bedroom, LIGHTS.guest];
  const dormers = DORMERS.map((middle, i) => {
    const base = mainTop(DORMER.back);
    const gable = buildGable(
      {
        middle,
        half: DORMER.half,
        eaves: DORMER.eaves,
        base,
        z: DORMER.back,
        overhang: DORMER.overhang,
        verge: DORMER.verge,
        back: intoMainRoof,
        roof: "roof",
        sidingFrom: base,
      },
      face,
    );
    const xr = middle + DORMER.half;
    const cheek = face(
      [
        onPage(xr, base, DORMER.back),
        onPage(xr, DORMER.eaves, DORMER.back),
        onPage(xr, DORMER.eaves, intoMainRoof(DORMER.eaves)),
      ],
      right,
      "walls",
    );
    const openings = emptyOpenings();
    windowIn(openings, (u, v) => onPage(u, v, DORMER.back), {
      u: middle,
      sill: base + 0.2,
      width: 0.8,
      height: 0.72,
      sashes: 1,
      across: 2,
      up: 2,
      transom: 0,
      stone: false,
      shutters: false,
      lamp: at(bedrooms, i),
    });
    return { gable, cheek, openings };
  });

  // The wing: its right wall along the porch, its gable face of stone below the eaves and boards in
  // the gable, the trim between, its great window under a cedar header, and a cedar truss.
  const wingSideOn = (u: number, v: number): Point => onPage(WR, v, u);
  const wingSide = stone(
    box(wingSideOn, OUT, FOOT, 0, HOUSE.eaves),
    right,
    wingSideOn,
    OUT,
    FOOT,
    0,
    HOUSE.eaves,
  );
  const wing = buildGable(
    {
      middle: WC,
      half: WING.width / 2,
      eaves: HOUSE.eaves,
      base: FOOT,
      z: OUT,
      overhang: WING.overhang,
      verge: WING.verge,
      back: intoMainRoof,
      roof: "roof",
      sidingFrom: HOUSE.eaves,
    },
    face,
  );
  const wingOn = (u: number, v: number): Point => onPage(u, v, OUT);
  const wingStone = stone(
    box(wingOn, WL, FOOT, WR, HOUSE.eaves),
    toward,
    wingOn,
    WL,
    FOOT,
    WR,
    HOUSE.eaves,
  );
  const wingFrieze = new Path2D();
  quadInto(
    wingFrieze,
    box(wingOn, WL, HOUSE.eaves - 0.08, WR, HOUSE.eaves + 0.1),
  );
  const wingOpenings = emptyOpenings();
  windowIn(wingOpenings, wingOn, {
    u: WC,
    sill: 1,
    width: 2.6,
    height: 2,
    sashes: 3,
    across: 1,
    up: 1,
    transom: 0.42,
    stone: true,
    shutters: false,
    lamp: LIGHTS.kitchen,
  });
  const wingTruss = buildTruss(wing, HOUSE.eaves + 0.32, 0.21);

  // The porch roof along the right end and along the front, meeting over the corner in a hip, the
  // seams down each, and the drips along their edges.
  const front = porchTop(OUT);
  const atWall = porchTop(0);
  const porchRoof = [
    face(
      [
        onPage(PX, front, OUT),
        onPage(PX, front, PZ),
        onPage(MR, atWall, PZ),
        onPage(MR, atWall, 0),
      ],
      unit(PORCH.roof.rise, 1, 0),
      "metal",
      true,
    ),
    face(
      [
        onPage(WR, front, OUT),
        onPage(PX, front, OUT),
        onPage(MR, atWall, 0),
        onPage(WR, atWall, 0),
      ],
      unit(0, 1, PORCH.roof.rise),
      "metal",
      true,
    ),
  ];
  const seams = [new Path2D(), new Path2D()];
  for (let z = OUT + GRAIN.seams / 2; z < PZ; z += GRAIN.seams) {
    line(at(seams, 0), onPage(PX, front, z), onPage(MR, atWall, z));
  }
  for (let x = WR + GRAIN.seams / 2; x < PX; x += GRAIN.seams) {
    line(at(seams, 1), onPage(x, front, OUT), onPage(x, atWall, 0));
  }
  const drip = [
    face(
      box(
        (u, v) => onPage(PX + 0.03, v, u),
        OUT - 0.03,
        PORCH.beam.high - 0.02,
        PZ,
        front + 0.01,
      ),
      right,
      "metal",
    ),
    face(
      box(
        (u, v) => onPage(u, v, OUT - 0.03),
        WR,
        PORCH.beam.high - 0.02,
        PX + 0.03,
        front + 0.01,
      ),
      toward,
      "metal",
    ),
  ];

  // The porch's stone skirts and the nosings along its floor, along the right end and along the
  // front; the chairs on it; its piers with their caps and the cedar posts on them, along the right
  // end from the back and then along the front; and the cedar beams along its edges.
  const skirtOn = (u: number, v: number): Point => onPage(u, v, OUT);
  const skirtSideOn = (u: number, v: number): Point => onPage(PX, v, u);
  const skirt = [
    stone(
      box(skirtSideOn, OUT, FOOT, PZ, HOUSE.floor),
      right,
      skirtSideOn,
      OUT,
      FOOT,
      PZ,
      HOUSE.floor,
    ),
    stone(
      box(skirtOn, WR, FOOT, PX, HOUSE.floor),
      toward,
      skirtOn,
      WR,
      FOOT,
      PX,
      HOUSE.floor,
    ),
  ];
  const nosing = [
    face(
      box(
        (u, v) => onPage(PX + 0.04, v, u),
        OUT - 0.04,
        HOUSE.floor - 0.06,
        PZ,
        HOUSE.floor + 0.01,
      ),
      right,
      "capstone",
    ),
    face(
      box(
        (u, v) => onPage(u, v, OUT - 0.04),
        WR,
        HOUSE.floor - 0.06,
        PX + 0.04,
        HOUSE.floor + 0.01,
      ),
      toward,
      "capstone",
    ),
  ];
  const chairs = { thick: new Path2D(), thin: new Path2D() };
  const chairZ = OUT + CHAIRS.back;
  const living = at(PORCH_WINDOWS, 0);
  for (const page of [
    living - CHAIRS.apart,
    living + CHAIRS.apart,
    at(PORCH_WINDOWS, 1),
  ]) {
    rockingChair(chairs, page - RECEDE * chairZ, chairZ);
  }
  sideTable(chairs, living - RECEDE * chairZ, chairZ);
  const piers: Face[] = [];
  const posts: Face[] = [];
  const { pier: footing } = PORCH;
  const postAt = (x: number, z: number): void => {
    const p0 = x - footing.wide / 2;
    const p1 = x + footing.wide / 2;
    const z0 = z - footing.wide / 2;
    const z1 = z + footing.wide / 2;
    const frontOfPier = (u: number, v: number): Point => onPage(u, v, z0);
    const sideOfPier = (u: number, v: number): Point => onPage(p1, v, u);
    const low = footing.high - footing.cap;
    piers.push(
      stone(
        box(frontOfPier, p0, FOOT, p1, low),
        toward,
        frontOfPier,
        p0,
        FOOT,
        p1,
        low,
      ),
      stone(
        box(sideOfPier, z0, FOOT, z1, low),
        right,
        sideOfPier,
        z0,
        FOOT,
        z1,
        low,
      ),
      face(
        box(
          (u, v) => onPage(u, v, z0 - footing.capPast),
          p0 - footing.capPast,
          low,
          p1 + footing.capPast,
          footing.high,
        ),
        toward,
        "capstone",
        true,
      ),
      face(
        box(
          (u, v) => onPage(p1 + footing.capPast, v, u),
          z0 - footing.capPast,
          low,
          z1 + footing.capPast,
          footing.high,
        ),
        right,
        "capstone",
        true,
      ),
    );
    const half = PORCH.post / 2;
    posts.push(
      face(
        box(
          (u, v) => onPage(u, v, z - half),
          x - half,
          footing.high,
          x + half,
          PORCH.beam.low,
        ),
        toward,
        "cedar",
      ),
      face(
        box(
          (u, v) => onPage(x + half, v, u),
          z - half,
          footing.high,
          z + half,
          PORCH.beam.low,
        ),
        right,
        "cedar",
      ),
    );
  };
  for (const z of PORCH.side.posts) {
    postAt(POST_X, z);
  }
  for (const x of POSTS) {
    postAt(x, POST_Z);
  }
  const beam = [
    face(
      box((u, v) => onPage(PX, v, u), OUT, PORCH.beam.low, PZ, PORCH.beam.high),
      right,
      "cedar",
    ),
    face(
      box((u, v) => onPage(u, v, OUT), WR, PORCH.beam.low, PX, PORCH.beam.high),
      toward,
      "cedar",
    ),
  ];

  // The gable over the steps, standing on the beam, its roof of metal; a cedar truss in it.
  const entry = buildGable(
    {
      middle: DC,
      half: ENTRY.half,
      eaves: ENTRY_EAVES,
      base: PORCH.beam.high,
      z: OUT,
      overhang: ENTRY.overhang,
      verge: ENTRY.verge,
      back: intoMainRoof,
      roof: "metal",
      sidingFrom: PORCH.beam.high,
    },
    face,
  );
  const entryTruss = buildTruss(entry, ENTRY_EAVES - 0.05, 0.16);

  // The steps, each riser a stone face, and their right side stepping down toward the view.
  const steps: Face[] = [];
  const rise = HOUSE.floor / STEPS.count;
  const side: Point[] = [];
  for (let i = 0; i < STEPS.count; i += 1) {
    const z = OUT - (STEPS.count - i) * STEPS.tread;
    const low = i === 0 ? FOOT : rise * i;
    const high = rise * (i + 1);
    const on = (u: number, v: number): Point => onPage(u, v, z);
    const [a, b] = [DC - STEPS.half, DC + STEPS.half];
    steps.push(stone(box(on, a, low, b, high), toward, on, a, low, b, high));
    side.push(
      onPage(DC + STEPS.half, low, z),
      onPage(DC + STEPS.half, high, z),
    );
  }
  const sideOfSteps = (u: number, v: number): Point =>
    onPage(DC + STEPS.half, v, u);
  steps.unshift(
    stone(
      [
        ...side,
        onPage(DC + STEPS.half, HOUSE.floor, OUT),
        onPage(DC + STEPS.half, FOOT, OUT),
      ],
      right,
      sideOfSteps,
      OUT - STEPS.count * STEPS.tread,
      FOOT,
      OUT,
      HOUSE.floor,
    ),
  );

  return {
    garageWall,
    garageBattens,
    garageDoors,
    garageStone,
    garageTrim,
    garageSconces,
    garageEnd,
    garageSoffit,
    garageVerges,
    garageRoof,
    garageCourses,
    garageShingles,
    garageFascia,
    garageGable,
    gableEnd,
    gableFoundation,
    gableBattens,
    gableTrim,
    gableOpenings,
    wall,
    wallBattens,
    wallFoundation,
    wallTrim,
    wallOpenings,
    sconces,
    roof,
    courses,
    shingles,
    fascia,
    verges,
    soffit,
    downspout,
    chimney,
    chimneyTop,
    flue,
    dormers,
    wingSide,
    wing,
    wingStone,
    wingFrieze,
    wingOpenings,
    wingTruss,
    porchRoof,
    seams,
    drip,
    skirt,
    nosing,
    chairs,
    piers,
    posts,
    beam,
    entry,
    entryTruss,
    steps,
  };
}

/**
 * A gable end's wall up under the roof, the foundation along its foot up to its floor, its battens,
 * and the boards up its corners.
 */
function buildGableEnd(
  end: GableEnd,
  face: FaceMaker,
): Omit<EndParts, "openings"> {
  const on = (u: number, v: number): Point => onPage(end.x, v, u);
  const right = unit(1, 0, 0);
  const { deep, floor, eaves, under } = end;
  const wall = face(
    [
      on(0, FOOT),
      on(deep, FOOT),
      on(deep, eaves),
      on(deep / 2, under(deep / 2)),
      on(0, eaves),
    ],
    right,
    "walls",
  );
  const foundation = face(box(on, 0, FOOT, deep, floor), right, "foundation");
  const battens = new Path2D();
  for (let u = GRAIN.sideBattens; u < deep - 0.05; u += GRAIN.sideBattens) {
    line(battens, on(u, floor), on(u, under(u)));
  }
  const corner = CASING.width + 0.04;
  const trim = new Path2D();
  quadInto(trim, [
    on(0, floor),
    on(corner, floor),
    on(corner, under(corner)),
    on(0, eaves),
  ]);
  quadInto(trim, [
    on(deep - corner, floor),
    on(deep, floor),
    on(deep, eaves),
    on(deep - corner, under(deep - corner)),
  ]);
  return { wall, foundation, battens, trim };
}

/**
 * The edge of the roof over a gable end: the boards along it up the front pitch and down the back,
 * and the underside of the back pitch between them and the wall.
 */
function buildRoofEdge(
  end: GableEnd,
  face: FaceMaker,
): { verges: Face[]; soffit: Face } {
  const right = unit(1, 0, 0);
  const edge = end.x + end.verge;
  const { deep, overhang, under } = end;
  const underEave = under(-overhang);
  const topEave = underEave + PLUMB;
  const underRidge = under(deep / 2);
  const topRidge = underRidge + PLUMB;
  const verges = [
    face(
      [
        onPage(edge, topEave, -overhang),
        onPage(edge, topRidge, deep / 2),
        onPage(edge, underRidge, deep / 2),
        onPage(edge, underEave, -overhang),
      ],
      right,
      "trim",
    ),
    face(
      [
        onPage(edge, topRidge, deep / 2),
        onPage(edge, topEave, deep + overhang),
        onPage(edge, underEave, deep + overhang),
        onPage(edge, underRidge, deep / 2),
      ],
      right,
      "trim",
    ),
  ];
  const soffit: Face = {
    ...face(
      [
        onPage(end.x, underRidge, deep / 2),
        onPage(edge, underRidge, deep / 2),
        onPage(edge, underEave, deep + overhang),
        onPage(end.x, underEave, deep + overhang),
      ],
      unit(0, -1, S),
      "trim",
    ),
    under: true,
  };
  return { verges, soffit };
}

/**
 * The courses of shingles up a roof's front pitch from its eaves `low` high and `eaveZ` back to
 * its ridge `high` high, from `left` to `right` along the ground; and the joints between the
 * shingles along each course, laid out by `rng`.
 */
function shingled(
  left: number,
  right: number,
  low: number,
  high: number,
  eaveZ: number,
  rng: Rng,
): [Path2D, Path2D] {
  const courses = new Path2D();
  const joints = new Path2D();
  const backOf = (y: number): number => (y - low) / S + eaveZ;
  let below = low;
  for (let y = low + GRAIN.courses; y < high - 0.05; y += GRAIN.courses) {
    line(courses, onPage(left, y, backOf(y)), onPage(right, y, backOf(y)));
    const shift = rng.next() * GRAIN.shingles;
    for (
      let x = left + shift;
      x < right;
      x += GRAIN.shingles * (0.7 + 0.6 * rng.next())
    ) {
      line(joints, onPage(x, below, backOf(below)), onPage(x, y, backOf(y)));
    }
    below = y;
  }
  return [courses, joints];
}

function emptyDoors(): Doors {
  return {
    wood: new Path2D(),
    grooves: new Path2D(),
    rails: new Path2D(),
    glass: new Path2D(),
    bars: new Path2D(),
    iron: new Path2D(),
    trim: new Path2D(),
  };
}

/**
 * A carriage door from `a` along a wall placed by `on`, `height` tall, standing on the ground: its
 * casing; its wood and the grooves between its boards; the rail under its windows and the stile
 * down its middle; the windows across its top, each barred into four panes; the pulls either side
 * of its middle; and the strap hinges along its outer edges.
 */
function carriageDoorIn(
  into: Doors,
  on: (u: number, v: number) => Point,
  a: number,
  height: number,
): void {
  const b = a + GARAGE.doors.width;
  const middle = (a + b) / 2;
  const c = CARRIAGE.casing;
  for (const [u0, v0, u1, v1] of [
    [a - c, height, b + c, height + c],
    [a - c, 0, a, height],
    [b, 0, b + c, height],
  ] as const) {
    quadInto(into.trim, box(on, u0, v0, u1, v1));
  }
  quadInto(into.wood, box(on, a, 0, b, height));
  for (let u = a + CARRIAGE.boards; u < b - 0.05; u += CARRIAGE.boards) {
    line(into.grooves, on(u, 0), on(u, height));
  }
  const { count, from, edge, tall, gap, bar } = CARRIAGE.windows;
  const wide = (b - a - 2 * edge - (count - 1) * gap) / count;
  const top = height - from;
  const bottom = top - tall;
  for (let k = 0; k < count; k += 1) {
    const u0 = a + edge + k * (wide + gap);
    const u1 = u0 + wide;
    const um = (u0 + u1) / 2;
    const vm = (bottom + top) / 2;
    quadInto(into.glass, box(on, u0, bottom, u1, top));
    quadInto(into.bars, box(on, um - bar / 2, bottom, um + bar / 2, top));
    quadInto(into.bars, box(on, u0, vm - bar / 2, u1, vm + bar / 2));
  }
  const railTop = bottom - gap;
  quadInto(into.rails, box(on, a, railTop - CARRIAGE.rail, b, railTop));
  quadInto(
    into.rails,
    box(
      on,
      middle - CARRIAGE.stile / 2,
      0,
      middle + CARRIAGE.stile / 2,
      railTop - CARRIAGE.rail,
    ),
  );
  const { pull, hinge } = CARRIAGE;
  for (const side of [-1, 1]) {
    const u = middle + side * pull.apart;
    quadInto(
      into.iron,
      box(
        on,
        u - pull.wide / 2,
        pull.at - pull.tall / 2,
        u + pull.wide / 2,
        pull.at + pull.tall / 2,
      ),
    );
  }
  for (const [edgeAt, inward] of [
    [a, 1],
    [b, -1],
  ] as const) {
    for (const v of [hinge.from, height - hinge.from]) {
      strapInto(into.iron, on, edgeAt, v, inward, hinge.long, hinge.deep);
    }
  }
}

/**
 * An iron strap hinge on a door whose edge is `u` along a wall placed by `on`, `v` up, reaching
 * `long` in across it toward `inward` and `deep` deep at the edge, tapering to a round end.
 */
function strapInto(
  into: Path2D,
  on: (u: number, v: number) => Point,
  u: number,
  v: number,
  inward: 1 | -1,
  long: number,
  deep: number,
): void {
  const end = u + inward * long;
  quadInto(into, [
    on(u, v - deep / 2),
    on(end, v - deep * 0.3),
    on(end, v + deep * 0.3),
    on(u, v + deep / 2),
  ]);
  quadInto(into, disc(on(end, v), deep * 0.45, 10));
}

/**
 * A little round table on the porch at `x` along the ground and `z` back from the front wall,
 * between two chairs, as the lines of its top, its stem and its foot.
 */
function sideTable(
  into: { thick: Path2D; thin: Path2D },
  x: number,
  z: number,
): void {
  const p = (dx: number, y: number): Point =>
    onPage(x + dx, HOUSE.floor + y, z);
  line(into.thick, p(-0.2, 0.5), p(0.2, 0.5));
  line(into.thick, p(0, 0.48), p(0, 0.05));
  line(into.thick, p(-0.14, 0.03), p(0.14, 0.03));
}

/**
 * A gable toward the view: its walls `half` either side of `middle` and `eaves` high, its face
 * standing `z` back on `base`, under a roof reaching `overhang` past the walls and `verge` out in
 * front of the face; `back` tells how far back the roof's top runs at each height before it meets
 * what stands behind it. Its face is boarded from `sidingFrom` up, and its roof is `roof`.
 */
interface GableSpec {
  middle: number;
  half: number;
  eaves: number;
  base: number;
  z: number;
  overhang: number;
  verge: number;
  back: (y: number) => number;
  roof: PaintName;
  sidingFrom: number;
}

/** How many heights the line where a gable's roof meets the main roof is worked out at. */
const VALLEY_STEPS = 12;

/** Builds a gable toward the view and the roof running back from it, in `HOUSE.pitch`. */
function buildGable(spec: GableSpec, face: FaceMaker): Gable {
  const { middle: m, half, eaves, base, z, overhang, verge, back } = spec;
  const reach = half + overhang;
  const underEave = eaves - S * overhang;
  const underRidge = eaves + S * half;
  const topEave = underEave + PLUMB;
  const topRidge = underRidge + PLUMB;
  const front = z - verge;
  const under: Point[] = [
    { x: m - reach, y: underEave },
    { x: m, y: underRidge },
    { x: m + reach, y: underEave },
  ];
  const roofline: Point[] = under.map((p) => ({ x: p.x, y: p.y + PLUMB }));
  const onFace = (p: Point): Point => onPage(p.x, p.y, z);
  const onFront = (p: Point): Point => onPage(p.x, p.y, front);
  const facePoints: Point[] = [
    { x: m - half, y: base },
    { x: m + half, y: base },
    { x: m + half, y: eaves },
    { x: m, y: underRidge },
    { x: m - half, y: eaves },
  ];
  invariant(base < eaves, "A gable's face must stand below its eaves.");

  // Down the line where the right pitch meets what stands behind it, from the ridge to the eaves.
  const xAt = (y: number): number => m + (topRidge - y) / S;
  const valley: Point[] = [];
  for (let i = 0; i <= VALLEY_STEPS; i += 1) {
    const y = lerp(topRidge, topEave, i / VALLEY_STEPS);
    valley.push(onPage(xAt(y), y, back(y)));
  }
  const roof = face(
    [onPage(m + reach, topEave, front), onPage(m, topRidge, front), ...valley],
    unit(S, 1, 0),
    spec.roof,
    true,
  );
  const lines = new Path2D();
  if (spec.roof === "metal") {
    // Standing seams down the slope, from the ridge to the eaves, cut where the roof meets the wall.
    const deepest = back(topRidge);
    for (let w = front + GRAIN.seams / 2; w < deepest; w += GRAIN.seams) {
      line(lines, onPage(m, topRidge, w), onPage(m + reach, topEave, w));
    }
  } else {
    for (
      let y = topEave + GRAIN.courses;
      y < topRidge - 0.05;
      y += GRAIN.courses
    ) {
      line(lines, onPage(xAt(y), y, front), onPage(xAt(y), y, back(y)));
    }
  }
  const soffit: Face = {
    ...face(
      [
        onFront(at(under, 0)),
        onFront(at(under, 1)),
        onFace(at(under, 1)),
        onPage(m - half, eaves, z),
        onPage(m - half, underEave, z),
      ],
      unit(S, -1, 0),
      "trim",
    ),
    under: true,
  };
  const verges = face(
    [...roofline.map(onFront), ...[...under].reverse().map(onFront)],
    unit(0, 0, 1),
    "trim",
  );
  const fascia = face(
    [
      onPage(m + reach, underEave, front),
      onPage(m + reach, underEave, back(underEave)),
      onPage(m + reach, topEave, back(topEave)),
      onPage(m + reach, topEave, front),
    ],
    unit(1, 0, 0),
    "trim",
  );
  const battens = new Path2D();
  for (
    let x = m - half + GRAIN.battens;
    x < m + half - 0.05;
    x += GRAIN.battens
  ) {
    const high = underRidge - S * Math.abs(x - m);
    if (high > spec.sidingFrom) {
      line(battens, onPage(x, spec.sidingFrom, z), onPage(x, high, z));
    }
  }
  return {
    z,
    verge,
    face: face(facePoints.map(onFace), unit(0, 0, 1), "walls"),
    under,
    roof,
    lines,
    soffit,
    verges,
    fascia,
    battens,
  };
}

/**
 * A cedar truss in `gable`: a tie across it `tie` high, a king post from the peak down through the
 * tie to a pointed drop below it, and two struts from the foot of the king post out to the rafters,
 * each timber `thick` thick and cut where it meets the roof; and a black steel strap bolted over the
 * joint at the king post's foot.
 */
function buildTruss(gable: Gable, tie: number, thick: number): Truss {
  const [eave, peak] = [at(gable.under, 0), at(gable.under, 1)];
  const m = peak.x;
  const pitch = (peak.y - eave.y) / (peak.x - eave.x);
  // How far either side of the middle the underside of the roof is at height `y`.
  const halfAt = (y: number): number => (peak.y - y) / pitch;
  const underRoof = [
    (p: Point): number => peak.y - pitch * (m - p.x) - p.y,
    (p: Point): number => peak.y - pitch * (p.x - m) - p.y,
  ];
  const w = thick;
  const low = tie;
  const high = tie + w;
  const z = gable.z - TRUSS.out;
  const timber = (points: Point[], from: Point, to: Point): Timber => {
    const outline = counterclockwise(points);
    const front = outline.map((p) => onPage(p.x, p.y, z));
    const sides = new Path2D();
    outline.forEach((a, i) => {
      const b = at(outline, (i + 1) % outline.length);
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      // An edge turned to the right, its outward side being to the right of the way a
      // counterclockwise outline runs.
      if (length > 0 && (b.y - a.y) / length > 0.05) {
        quadInto(sides, [
          onPage(a.x, a.y, z),
          onPage(b.x, b.y, z),
          onPage(b.x, b.y, gable.z),
          onPage(a.x, a.y, gable.z),
        ]);
      }
    });
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const across = {
      x: -(to.y - from.y) / length,
      y: (to.x - from.x) / length,
    };
    const grain = new Path2D();
    for (const [offset, wander] of TRUSS.grain) {
      const shift = (o: number): Point => ({
        x: across.x * o * w,
        y: across.y * o * w,
      });
      const a = shift(offset);
      const b = shift(offset + wander);
      line(
        grain,
        onPage(from.x + a.x, from.y + a.y, z),
        onPage(to.x + b.x, to.y + b.y, z),
      );
    }
    return {
      outline,
      from,
      to,
      width: w,
      face: {
        points: front,
        path: shapeOf(front),
        normal: unit(0, 0, 1),
        hatch: undefined,
      },
      sides,
      grain,
    };
  };
  const struts = [-1, 1].map((side) => {
    const top = lerp(high, peak.y, TRUSS.reach);
    const from = { x: m, y: high - w / 2 };
    const to = { x: m + side * halfAt(top), y: top };
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const along = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
    const past = { x: to.x + along.x * w * 2, y: to.y + along.y * w * 2 };
    const band = [
      { x: from.x - along.y * (w / 2), y: from.y + along.x * (w / 2) },
      { x: past.x - along.y * (w / 2), y: past.y + along.x * (w / 2) },
      { x: past.x + along.y * (w / 2), y: past.y - along.x * (w / 2) },
      { x: from.x + along.y * (w / 2), y: from.y - along.x * (w / 2) },
    ];
    return timber(clipToSides(band, underRoof), from, to);
  });
  const tieTimber = timber(
    [
      { x: m - halfAt(low), y: low },
      { x: m + halfAt(low), y: low },
      { x: m + halfAt(high), y: high },
      { x: m - halfAt(high), y: high },
    ],
    { x: m - halfAt(low + w / 2), y: low + w / 2 },
    { x: m + halfAt(low + w / 2), y: low + w / 2 },
  );
  const tip = low - w * TRUSS.drop;
  const shoulder = low - w * TRUSS.drop * 0.45;
  const kingPost = timber(
    [
      { x: m, y: tip },
      { x: m + w / 2, y: shoulder },
      { x: m + w / 2, y: peak.y - (pitch * w) / 2 },
      { x: m, y: peak.y },
      { x: m - w / 2, y: peak.y - (pitch * w) / 2 },
      { x: m - w / 2, y: shoulder },
    ],
    { x: m, y: tip },
    { x: m, y: peak.y },
  );
  // The strap: an upside-down T, along the middle of the tie either side of the king post and up
  // the middle of the king post, bolted through each timber along its middle line.
  const { strap } = TRUSS;
  const mid = low + w / 2;
  const half = (w * strap.wide) / 2;
  const along = w * strap.along;
  const top = high + w * strap.up;
  const on = (u: number, v: number): Point => onPage(u, v, z);
  const bolts = new Path2D();
  const boltAt = (u: number, v: number): void =>
    quadInto(bolts, disc(on(u, v), w * strap.bolt, 10));
  boltAt(m, mid);
  for (const out of strap.alongTie) {
    boltAt(m - w * out, mid);
    boltAt(m + w * out, mid);
  }
  for (const up of strap.upPost) {
    boltAt(m, high + w * up);
  }
  return {
    z,
    timbers: [...struts, tieTimber, kingPost],
    strap: shapeOf(
      [
        [m - along, mid - half],
        [m + along, mid - half],
        [m + along, mid + half],
        [m + half, mid + half],
        [m + half, top],
        [m - half, top],
        [m - half, mid + half],
        [m - along, mid + half],
      ].map(([u, v]) => on(u ?? 0, v ?? 0)),
    ),
    bolts,
  };
}

/** `points` in counterclockwise order. */
function counterclockwise(points: readonly Point[]): Point[] {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = at(points, i);
    const b = at(points, (i + 1) % points.length);
    twice += a.x * b.y - b.x * a.y;
  }
  return twice >= 0 ? [...points] : [...points].reverse();
}

/** The part of the convex shape `points` where every one of `sides` is positive. */
function clipToSides(
  points: readonly Point[],
  sides: readonly ((p: Point) => number)[],
): Point[] {
  let kept = [...points];
  for (const inside of sides) {
    const next: Point[] = [];
    for (let i = 0; i < kept.length; i += 1) {
      const a = at(kept, i);
      const b = at(kept, (i + 1) % kept.length);
      const da = inside(a);
      const db = inside(b);
      if (da >= 0) {
        next.push(a);
      }
      if (da >= 0 !== db >= 0) {
        const f = da / (da - db);
        next.push({ x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) });
      }
    }
    kept = next;
  }
  invariant(kept.length >= 3, "A truss's timber must stand under its roof.");
  return kept;
}

/**
 * Adds the closed shape through `points` to `path`, wound the same way as every other, so
 * overlapping shapes fill as one.
 */
function quadInto(path: Path2D, points: readonly Point[]): void {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = at(points, i);
    const b = at(points, (i + 1) % points.length);
    twice += a.x * b.y - b.x * a.y;
  }
  const ordered = twice >= 0 ? points : [...points].reverse();
  ordered.forEach((p, i) =>
    i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y),
  );
  path.closePath();
}

/**
 * Stones laid in courses over a stretch of wall from (`u0`, `v0`) to (`u1`, `v1`), placed by `on`:
 * each course of its own height, each stone of its own length, set a little in from its neighbors
 * so the mortar shows between, sorted by the tone it is drawn in.
 */
function layStones(
  on: (u: number, v: number) => Point,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  rng: Rng,
): Path2D[] {
  const tones = STONE.tones.map(() => new Path2D());
  const [shortest, longest] = STONE.long;
  const [lowest, tallest] = STONE.course;
  const j = STONE.joint / 2;
  for (let v = v0; v < v1 - 0.02; ) {
    const tall = Math.min(lerp(lowest, tallest, rng.next()), v1 - v);
    for (let u = u0 - rng.next() * shortest; u < u1; ) {
      const long = lerp(shortest, longest, rng.next());
      const a = Math.max(u, u0);
      const b = Math.min(u + long, u1);
      if (b - a > STONE.joint * 2) {
        // Each stone a little out of square, as dressed stone is.
        const lean = (rng.next() - 0.5) * 0.02;
        quadInto(at(tones, Math.floor(rng.next() * tones.length)), [
          on(a + j, v + j + lean),
          on(b - j, v + j - lean),
          on(b - j, v + tall - j),
          on(a + j, v + tall - j),
        ]);
      }
      u += long;
    }
    v += tall;
  }
  return tones;
}

function emptyOpenings(): Openings {
  return {
    trim: new Path2D(),
    sills: new Path2D(),
    cedar: new Path2D(),
    stone: new Path2D(),
    shutters: new Path2D(),
    battens: new Path2D(),
    glass: new Path2D(),
    frames: new Path2D(),
    iron: new Path2D(),
    lamps: [],
  };
}

/**
 * A window: its middle `u` along the wall and the foot of its opening `sill` high, how wide and
 * tall the opening is; how many sashes stand side by side in it, and how many panes across and up
 * each is barred into, under a transom pane `transom` tall, if any; whether it is set in stone,
 * under a cedar header, or cased in white; whether shutters hang either side; and its lamp.
 */
interface WindowSpec {
  u: number;
  sill: number;
  width: number;
  height: number;
  sashes: number;
  across: number;
  up: number;
  transom: number;
  stone: boolean;
  shutters: boolean;
  lamp: { wakes: number; sleeps: number; rises: number };
}

/** Sets a window into a wall placed by `on`, adding its parts to `into`. */
function windowIn(
  into: Openings,
  on: (u: number, v: number) => Point,
  spec: WindowSpec,
): void {
  const a = spec.u - spec.width / 2;
  const b = spec.u + spec.width / 2;
  const low = spec.sill;
  const high = spec.sill + spec.height;
  const f = CASING.width;
  if (spec.stone) {
    quadInto(
      into.cedar,
      box(
        on,
        a - HEADER.past,
        high + HEADER.gap,
        b + HEADER.past,
        high + HEADER.gap + HEADER.tall,
      ),
    );
    quadInto(
      into.stone,
      box(on, a - HEADER.sillPast, low - HEADER.sill, b + HEADER.sillPast, low),
    );
    quadInto(
      into.sills,
      box(
        on,
        a - HEADER.sillPast,
        low - HEADER.sill - CASING.sill.shadow,
        b + HEADER.sillPast,
        low - HEADER.sill,
      ),
    );
  } else {
    for (const [u0, v0, u1, v1] of [
      [a - f, high, b + f, high + f],
      [a - f, low, a, high],
      [b, low, b + f, high],
    ] as const) {
      quadInto(into.trim, box(on, u0, v0, u1, v1));
    }
    const { past, deep, shadow } = CASING.sill;
    quadInto(into.trim, box(on, a - f - past, low - deep, b + f + past, low));
    quadInto(
      into.sills,
      box(on, a - f - past, low - deep - shadow, b + f + past, low - deep),
    );
  }
  if (spec.shutters) {
    const wide = spec.width / 2;
    for (const [u0, u1] of [
      [a - f - SHUTTER.gap - wide, a - f - SHUTTER.gap],
      [b + f + SHUTTER.gap, b + f + SHUTTER.gap + wide],
    ] as const) {
      quadInto(into.shutters, box(on, u0, low, u1, high));
      for (const v of [low + spec.height * 0.16, high - spec.height * 0.16]) {
        quadInto(
          into.battens,
          box(on, u0, v - SHUTTER.batten / 2, u1, v + SHUTTER.batten / 2),
        );
      }
      for (const t of [1 / 3, 2 / 3]) {
        const u = lerp(u0, u1, t);
        quadInto(into.battens, box(on, u - 0.006, low, u + 0.006, high));
      }
    }
  }
  quadInto(into.glass, box(on, a, low, b, high));
  const frames = new Path2D();
  const { frame, mullion, bar } = SASH;
  for (const [u0, v0, u1, v1] of [
    [a, low, b, low + frame],
    [a, high - frame, b, high],
    [a, low, a + frame, high],
    [b - frame, low, b, high],
  ] as const) {
    quadInto(frames, box(on, u0, v0, u1, v1));
  }
  const sash = (b - a) / spec.sashes;
  for (let i = 0; i < spec.sashes; i += 1) {
    const s0 = a + i * sash;
    const s1 = s0 + sash;
    if (i > 0) {
      quadInto(frames, box(on, s0 - mullion / 2, low, s0 + mullion / 2, high));
    }
    const glassTop = spec.transom > 0 ? high - spec.transom : high;
    if (spec.transom > 0) {
      quadInto(
        frames,
        box(on, s0, glassTop - mullion / 2, s1, glassTop + mullion / 2),
      );
    }
    for (let c = 1; c < spec.across; c += 1) {
      const u = lerp(s0, s1, c / spec.across);
      quadInto(frames, box(on, u - bar / 2, low, u + bar / 2, glassTop));
    }
    for (let r = 1; r < spec.up; r += 1) {
      const v = lerp(low, glassTop, r / spec.up);
      // The rail where the upper sash meets the lower is a frame's width, the bars between panes narrower.
      const width = spec.up === 2 ? frame : bar;
      quadInto(frames, box(on, s0, v - width / 2, s1, v + width / 2));
    }
  }
  into.frames.addPath(frames);
  into.lamps.push({
    glass: shapeOf(box(on, a, low, b, high)),
    frames,
    middle: on(spec.u, (low + high) / 2),
    height: high - low,
    ...spec.lamp,
  });
}

/**
 * The double front doors at `x` along a wall placed by `on`, up from the porch floor: their white
 * casing and the shadow under its head, each leaf a black frame round glass barred into panes, the
 * pulls where they meet, and the hall's lamp behind them.
 */
function doorIn(
  into: Openings,
  on: (u: number, v: number) => Point,
  x: number,
  lamp: { wakes: number; sleeps: number; rises: number },
): void {
  const a = x - DOOR.width / 2;
  const b = x + DOOR.width / 2;
  const low = HOUSE.floor;
  const high = low + DOOR.height;
  const c = DOOR.casing;
  for (const [u0, v0, u1, v1] of [
    [a - c, high, b + c, high + c],
    [a - c, low, a, high],
    [b, low, b + c, high],
  ] as const) {
    quadInto(into.trim, box(on, u0, v0, u1, v1));
  }
  quadInto(into.glass, box(on, a, low, b, high));
  const frames = new Path2D();
  const { stile, foot, panes } = DOOR;
  for (const [u0, u1] of [
    [a, x],
    [x, b],
  ] as const) {
    for (const [p0, q0, p1, q1] of [
      [u0, low, u1, low + foot],
      [u0, high - stile, u1, high],
      [u0, low, u0 + stile, high],
      [u1 - stile, low, u1, high],
    ] as const) {
      quadInto(frames, box(on, p0, q0, p1, q1));
    }
    for (let i = 1; i < panes; i += 1) {
      const v = lerp(low + foot, high - stile, i / panes);
      quadInto(frames, box(on, u0, v - SASH.bar / 2, u1, v + SASH.bar / 2));
    }
  }
  into.frames.addPath(frames);
  const { pull } = DOOR;
  for (const side of [-1, 1]) {
    const u = x + side * pull.apart;
    quadInto(
      into.iron,
      box(
        on,
        u - pull.wide / 2,
        low + pull.at - pull.tall / 2,
        u + pull.wide / 2,
        low + pull.at + pull.tall / 2,
      ),
    );
  }
  into.lamps.push({
    glass: shapeOf(box(on, a, low, b, high)),
    frames,
    middle: on(x, (low + high) / 2),
    height: high - low,
    ...lamp,
  });
}

/**
 * A lantern on the front wall with its middle at (`x`, `y`): a plate on the wall and a short arm
 * out to it; under a little hipped roof and a finial, a box of glass framed in iron on a base that
 * tapers to a drip; and a flame within.
 */
function buildSconce(x: number, y: number): Sconce {
  const out = -SCONCE.out;
  const by = (dx: number, dy: number): Point => onPage(x + dx, y + dy, out);
  const iron = new Path2D();
  quadInto(
    iron,
    box((u, v) => ({ x: u, y: v }), x - 0.05, y - 0.18, x + 0.05, y + 0.16),
  );
  quadInto(iron, [
    onPage(x - 0.012, y + 0.02, 0),
    onPage(x + 0.012, y + 0.02, 0),
    by(0.012, 0.05),
    by(-0.012, 0.05),
  ]);
  const band = (
    top: number,
    upper: number,
    bottom: number,
    lower: number,
  ): Point[] => [
    by(-upper, top),
    by(upper, top),
    by(lower, bottom),
    by(-lower, bottom),
  ];
  for (const [top, upper, bottom, lower] of [
    [0.27, 0.025, 0.2, 0.13],
    [0.2, 0.13, 0.18, 0.115],
    [0.18, 0.1, 0.16, 0.1],
    [-0.15, 0.09, -0.18, 0.1],
    [-0.18, 0.1, -0.2, 0.05],
  ] as const) {
    quadInto(iron, band(top, upper, bottom, lower));
  }
  quadInto(iron, disc(by(0, 0.3), 0.025, 10));
  quadInto(iron, [by(-0.03, -0.2), by(0.03, -0.2), by(0, -0.25)]);
  const post = 0.014;
  for (const side of [-1, 1]) {
    quadInto(iron, [
      by(side * 0.1, 0.16),
      by(side * (0.1 - post), 0.16),
      by(side * (0.09 - post), -0.15),
      by(side * 0.09, -0.15),
    ]);
  }
  quadInto(iron, band(0.02, 0.095, 0.005, 0.095));
  const flame = shapeOf(
    Array.from({ length: 14 }, (_, i) => {
      const angle = (i / 14) * Math.PI * 2;
      const sharp = Math.sin(angle) > 0 ? 1 - 0.45 * Math.sin(angle) : 1;
      return by(
        0.018 * Math.cos(angle) * sharp,
        -0.06 + 0.04 * Math.sin(angle),
      );
    }),
  );
  return {
    iron,
    glass: shapeOf(band(0.16, 0.1, -0.15, 0.09)),
    flame,
    middle: by(0, -0.03),
  };
}

/**
 * A rocking chair at `x` along the ground and `z` back from the front wall, facing the view, as the
 * lines of its frame: its rockers, legs and arms and the posts and crest rail of its back thick;
 * the spindles of its back and the rail along the front of its seat thin.
 */
function rockingChair(
  into: { thick: Path2D; thin: Path2D },
  x: number,
  z: number,
): void {
  const floor = HOUSE.floor;
  const p = (dx: number, y: number, dz: number): Point =>
    onPage(x + dx, floor + y, z + dz);
  const { thick, thin } = into;
  for (const side of [-1, 1]) {
    const w = side * 0.25;
    // The rocker, lowest a little ahead of the middle.
    const rocker = Array.from({ length: 9 }, (_, i) => {
      const t = i / 8;
      return p(
        w,
        0.025 + 0.09 * Math.pow((t - 0.45) / 0.55, 2),
        lerp(-0.42, 0.4, t),
      );
    });
    rocker.forEach((q, i) =>
      i === 0 ? thick.moveTo(q.x, q.y) : thick.lineTo(q.x, q.y),
    );
    line(thick, p(w, 0.04, -0.2), p(w, 0.45, -0.2));
    line(thick, p(w, 0.03, 0.2), p(w, 1.12, 0.33));
    line(thick, p(w * 1.16, 0.68, -0.28), p(w * 1.16, 0.7, 0.28));
    line(thin, p(w * 1.12, 0.45, -0.22), p(w * 1.16, 0.68, -0.24));
  }
  line(thin, p(-0.25, 0.45, -0.22), p(0.25, 0.45, -0.22));
  line(thin, p(-0.25, 0.5, 0.22), p(0.25, 0.5, 0.22));
  const crest = [-0.25, -0.12, 0, 0.12, 0.25].map((dx) =>
    p(dx, 1.08 + 0.04 * (1 - (dx / 0.25) * (dx / 0.25)), 0.32),
  );
  crest.forEach((q, i) =>
    i === 0 ? thick.moveTo(q.x, q.y) : thick.lineTo(q.x, q.y),
  );
  for (const dx of [-0.16, -0.08, 0, 0.08, 0.16]) {
    line(
      thin,
      p(dx, 0.5, 0.23),
      p(dx, 1.08 + 0.04 * (1 - (dx / 0.25) * (dx / 0.25)), 0.32),
    );
  }
}

/**
 * The house's outline on the page, as the shapes that stand against the light and that the tree
 * grows short of: the main block under its roof, the wing, the porch along the front and along the
 * right end, the gable over the steps, the chimney and the garage standing apart, each sunk a little
 * into the ground.
 */
const OUTLINES: readonly (readonly Point[])[] = [
  [
    onPage(ML, FOOT, 0),
    onPage(MR, FOOT, MD),
    onPage(MR, EAVE_UNDER, MD),
    onPage(MR + HOUSE.verge, EAVE_UNDER, MD + HOUSE.overhang),
    onPage(MR + HOUSE.verge, EAVE_TOP, MD + HOUSE.overhang),
    onPage(MR + HOUSE.verge, RIDGE_TOP, MD / 2),
    onPage(ML - HOUSE.verge, RIDGE_TOP, MD / 2),
    onPage(ML - HOUSE.verge, EAVE_TOP, -HOUSE.overhang),
    onPage(ML - HOUSE.verge, EAVE_UNDER, -HOUSE.overhang),
    onPage(ML, EAVE_UNDER, 0),
  ],
  [
    onPage(WL, FOOT, OUT),
    onPage(WR, FOOT, OUT),
    onPage(
      WR + WING.overhang,
      HOUSE.eaves - S * WING.overhang,
      OUT - WING.verge,
    ),
    onPage(
      WR + WING.overhang,
      HOUSE.eaves - S * WING.overhang + PLUMB,
      OUT - WING.verge,
    ),
    onPage(WC, HOUSE.eaves + (S * WING.width) / 2 + PLUMB, OUT - WING.verge),
    onPage(
      WL - WING.overhang,
      HOUSE.eaves - S * WING.overhang + PLUMB,
      OUT - WING.verge,
    ),
    onPage(
      WL - WING.overhang,
      HOUSE.eaves - S * WING.overhang,
      OUT - WING.verge,
    ),
  ],
  [
    onPage(WR, FOOT, POST_Z - PORCH.pier.wide / 2),
    onPage(PX, FOOT, POST_Z - PORCH.pier.wide / 2),
    onPage(PX, porchTop(OUT), OUT),
    onPage(MR, porchTop(0), 0),
    onPage(WR, porchTop(0), 0),
  ],
  [
    onPage(PX, FOOT, POST_Z - PORCH.pier.wide / 2),
    onPage(PX, FOOT, PZ),
    onPage(PX, sideTop(PX), PZ),
    onPage(MR, sideTop(MR), PZ),
    onPage(MR, sideTop(MR), 0),
    onPage(PX, sideTop(PX), OUT),
  ],
  [
    onPage(
      DC - ENTRY.half - ENTRY.overhang,
      ENTRY_EAVES - S * ENTRY.overhang,
      OUT - ENTRY.verge,
    ),
    onPage(
      DC + ENTRY.half + ENTRY.overhang,
      ENTRY_EAVES - S * ENTRY.overhang,
      OUT - ENTRY.verge,
    ),
    onPage(
      DC + ENTRY.half + ENTRY.overhang,
      ENTRY_EAVES - S * ENTRY.overhang + PLUMB,
      OUT - ENTRY.verge,
    ),
    onPage(DC, ENTRY_EAVES + S * ENTRY.half + PLUMB, OUT - ENTRY.verge),
    onPage(
      DC - ENTRY.half - ENTRY.overhang,
      ENTRY_EAVES - S * ENTRY.overhang + PLUMB,
      OUT - ENTRY.verge,
    ),
  ],
  [
    onPage(CX0 - CHIMNEY.cap.past, mainTop(CZ0), CZ0),
    onPage(CX1 + CHIMNEY.cap.past, mainTop(CZ0), CZ0),
    onPage(CX1 + CHIMNEY.cap.past, mainTop(CZ1), CZ1),
    onPage(CX1 + CHIMNEY.cap.past, SMOKE_FROM.y + CHIMNEY.cap.lift, CZ1),
    onPage(CX0 - CHIMNEY.cap.past, SMOKE_FROM.y + CHIMNEY.cap.lift, CZ0),
  ],
  [
    onPage(GL, FOOT, 0),
    onPage(GR, FOOT, GD),
    onPage(GR, GARAGE_EAVE_UNDER, GD),
    onPage(GR + GARAGE.verge, GARAGE_EAVE_UNDER, GD + GARAGE.overhang),
    onPage(GR + GARAGE.verge, GARAGE_EAVE_TOP, GD + GARAGE.overhang),
    onPage(GR + GARAGE.verge, GARAGE_RIDGE_TOP, GD / 2),
    onPage(GL - GARAGE.verge, GARAGE_RIDGE_TOP, GD / 2),
    onPage(GL - GARAGE.verge, GARAGE_EAVE_TOP, -GARAGE.overhang),
    onPage(GL - GARAGE.verge, GARAGE_EAVE_UNDER, -GARAGE.overhang),
    onPage(GL, GARAGE_EAVE_UNDER, 0),
  ],
];

/**
 * How far a line from (x, y), heading `heading` radians counterclockwise from +x, runs before it
 * meets the farmhouse, in meters: 0 from inside it, and Infinity if it misses.
 */
export function farmhouseAhead(x: number, y: number, heading: number): number {
  return aheadOf(OUTLINES, x, y - GROUND, heading);
}

/** Where the farmhouse's walls stand on the page, in meters along the ground. */
export function farmhouseWalls(): { left: number; right: number } {
  return { left: GL, right: onPage(PX, 0, PZ).x };
}

/** Height of the top of the farmhouse above `x`, in meters: its roof, or 0 beside it. */
export function farmhouseTopAt(x: number): number {
  const top = topOf(OUTLINES, x);
  return top > 0 ? top + GROUND : 0;
}

let shape: Path2D | undefined;

/** The farmhouse's outline in device pixels, placed by `world`, for what stands against the light. */
export function farmhouseShape(world: DOMMatrix): Path2D {
  if (shape === undefined) {
    shape = new Path2D();
    for (const outline of OUTLINES) {
      shape.addPath(shapeOf(outline));
    }
  }
  const placed = new Path2D();
  placed.addPath(shape, world.translate(0, GROUND));
  return placed;
}
