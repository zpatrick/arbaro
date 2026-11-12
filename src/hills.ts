import type { Camera } from "./camera";
import type { Edges } from "./level";
import { mix, type Rgb, type SkyLight } from "./sky";
import { at, clamp, invariant, lerp, Rng, smoothstep } from "./util";

/**
 * Rolling downs between the meadow and its mountains, as a wildflower meadow over chalk downs
 * looks: broad rounded hills in rows, each paler and hazier the farther off it lies; their grass
 * in fresh and olive patches, drying toward straw on the exposed tops and lusher in the hollows,
 * lit on the flanks turned toward the sun; wildflowers growing through it in drifts that lie along
 * the slopes, washing the grass with their colors where they grow thick and flecking it with single
 * flowers; and copses in the dips, hedgerows down the slopes and trees standing alone. The meadow
 * greens and flowers in summer, dries to straw and the trees turn in fall, and the trees stand bare
 * in winter, under snow when it lies.
 *
 * Being far off, the hills keep their size as the view zooms, as the mountains do, but each row
 * slides past at its own pace as the view pans, the nearer the faster. Each row's ground is worked
 * out pixel by pixel once, and painted into a strip for the day and one for the night whenever the
 * season, the side the sun lights it from or the snow on it moves on; each frame lays the day's
 * strip down and the night's over it as dark comes on.
 */

/** Horizon height the hills are laid out for, in CSS pixels; they scale with the view's. */
const BASE_HORIZON = 666;

/** How wide a stretch of hills the counts of trees are given for, in pixels at the base horizon height. */
const STRETCH = 1440;

/** How far apart a row's swells stand on average, for each swell its count gives, in pixels at the base horizon height. */
const SWELL_SPAN = 1940;

/**
 * The trees on a row: how big their crowns are and how far they are hazed by the distance; and for
 * every stretch of hills, how many copses fill its deepest dips, how many hedgerows run down its
 * slopes, and how many trees stand alone or in twos and threes.
 */
interface TreeCounts {
  size: number;
  haze: number;
  woods: number;
  hedges: number;
  lone: number;
}

/**
 * A row of the downs, in pixels at the base horizon height: how high above the horizon its land
 * lies under its swells; how many swells it has to every `SWELL_SPAN`, and how high and how wide
 * each rises; what lays it out; how far the distance hazes it; how large its patches of grass and
 * flowers are, as a share of the nearest's; how big its flowers' flecks are and how thickly they
 * fleck it; how strongly the stalks of its grass streak it; how far it slides for every meter the
 * view pans; and its trees.
 */
interface RowSpec {
  base: number;
  count: number;
  height: readonly [number, number];
  width: readonly [number, number];
  seed: number;
  haze: number;
  zoom: number;
  speck: number;
  flowers: number;
  blades: number;
  pan: number;
  trees: TreeCounts;
}

/** The rows, farthest first. */
const ROWS: readonly RowSpec[] = [
  {
    base: 80,
    count: 8,
    height: [8, 26],
    width: [80, 180],
    seed: 211,
    haze: 0.5,
    zoom: 0.55,
    speck: 1,
    flowers: 0.3,
    blades: 0,
    pan: 1.6,
    trees: { size: 2.2, haze: 0.5, woods: 3, hedges: 2, lone: 6 },
  },
  {
    base: 62,
    count: 7,
    height: [10, 28],
    width: [80, 170],
    seed: 222,
    haze: 0.32,
    zoom: 0.7,
    speck: 1,
    flowers: 0.36,
    blades: 0,
    pan: 2.4,
    trees: { size: 3.2, haze: 0.32, woods: 2, hedges: 2, lone: 5 },
  },
  {
    base: 40,
    count: 6,
    height: [10, 26],
    width: [90, 190],
    seed: 233,
    haze: 0.16,
    zoom: 0.9,
    speck: 2,
    flowers: 0.3,
    blades: 0.05,
    pan: 3.4,
    trees: { size: 5, haze: 0.14, woods: 1, hedges: 1, lone: 5 },
  },
  {
    base: 16,
    count: 5,
    height: [8, 22],
    width: [110, 230],
    seed: 244,
    haze: 0.04,
    zoom: 1.15,
    speck: 2,
    flowers: 0.34,
    blades: 0.08,
    pan: 4.8,
    trees: { size: 8, haze: 0.03, woods: 0, hedges: 0, lone: 3 },
  },
];

/** How far the nearest row runs down below the horizon, so it shows wherever the near ground dips, in pixels at the base horizon height. */
const BELOW = 90;

/** How far each row's ground wanders up and down along its crest, in pixels at the base horizon height. */
const WANDER = 1.2;

/**
 * The grass in summer, in fall and in winter: its fresh and olive patches, the straw it dries to,
 * and its lusher green in the hollows.
 */
const GRASS = {
  summer: {
    fresh: [128, 148, 74],
    olive: [120, 128, 72],
    straw: [192, 178, 118],
    lush: [86, 114, 60],
  },
  fall: {
    fresh: [150, 146, 82],
    olive: [146, 128, 76],
    straw: [196, 166, 104],
    lush: [108, 110, 62],
  },
  winter: {
    fresh: [134, 126, 98],
    olive: [124, 114, 90],
    straw: [164, 148, 116],
    lush: [102, 100, 78],
  },
} as const satisfies Record<string, Record<string, Rgb>>;

/** How much more of the grass dries to straw by the end of summer. */
const DRYING = 0.25;

/**
 * The wildflowers, as they grow: buttercups in the damp hollows, daisies on the drier rises, and
 * knapweed and the odd poppy in drifts of their own. Each washes the grass with its color as much as
 * `wash` where it grows thickest, and takes `share` of the flecks there.
 */
const FLOWERS = [
  { color: [228, 198, 70], wash: 0.3, share: 0.5 },
  { color: [243, 241, 229], wash: 0.2, share: 0.5 },
  { color: [150, 104, 140], wash: 0.26, share: 0.35 },
  { color: [200, 70, 48], wash: 0.2, share: 0.22 },
] as const satisfies readonly { color: Rgb; wash: number; share: number }[];

/** The seasons over which the flowers go over, from in full bloom to gone. */
const BLOOM_FADES = [0.1, 0.4] as const;

/**
 * The light on the hills: the warm light a flank turned toward the sun takes, and the shade one
 * turned from it falls into, each as strongly as `share` at most; the haze of the distance by day;
 * and the snow.
 */
const LIGHT = {
  lit: { color: [248, 238, 204], share: 0.2 },
  shade: { color: [64, 82, 80], share: 0.24 },
  haze: [222, 224, 219],
  snow: [236, 238, 240],
} as const satisfies {
  lit: { color: Rgb; share: number };
  shade: { color: Rgb; share: number };
  haze: Rgb;
  snow: Rgb;
};

/** The hills by night: each color darkened toward the moonlight as `shade` says, and hazed toward the night's `haze`. */
const NIGHT = {
  shade: [0.26, 0.3, 0.4],
  haze: [64, 70, 96],
} as const satisfies { shade: Rgb; haze: Rgb };

/**
 * The trees' leaves in summer, and how far toward `lighter` each tree's may lean; the colors they
 * turn in fall; their bare crowns in winter, and how strongly those show; and their bark.
 */
const TREE = {
  leaf: [70, 94, 58],
  lighter: { color: [96, 112, 62], share: 0.4 },
  turning: [
    [184, 126, 52],
    [166, 84, 44],
    [142, 128, 58],
  ],
  bare: { color: [118, 104, 94], alpha: 0.6 },
  bark: [76, 66, 56],
} as const satisfies {
  leaf: Rgb;
  lighter: { color: Rgb; share: number };
  turning: readonly Rgb[];
  bare: { color: Rgb; alpha: number };
  bark: Rgb;
};

/** The seasons over which the trees turn, and over which they lose their leaves. */
const TURNS = [0.32, 0.6] as const;
const SHEDS = [0.72, 0.9] as const;

/**
 * How finely the strips are painted again as things move on: in steps of the season, of the light
 * on the flanks, and of the snow lying on the hills.
 */
const STEPS = { season: 1 / 24, light: 1 / 8, snow: 1 / 8 } as const;

/**
 * How many of a strip's pixels are painted again each frame, at most, once it has first been
 * painted, so painting it again for a change in the light or the season never holds a frame up.
 */
const PAINT_BUDGET = 50000;

/** How far the view's height may change before the hills are worked out again for it rather than stretched. */
const REBUILD_AT = 0.08;

/** How deep snow lies, in meters, as it first whitens the hills and as it hides them. */
const SNOWY = [0.004, 0.05] as const;

/** How finely the night is laid over the day on the strips as the dark comes on and goes. */
const DARK_STEP = 1 / 64;

/** A swell of a row: where its middle stands, how high it rises, and how far it reaches either side. */
interface Swell {
  middle: number;
  height: number;
  left: number;
  right: number;
}

/** A tree on a row: where it stands along it and how high, how big its crown is, and what lays its crown out. */
interface Tree {
  u: number;
  h: number;
  size: number;
  seed: number;
}

/**
 * What a row's ground is made of, a byte for each pixel of its strip: how fully the land covers
 * it; its patch of fresh or olive grass; how dry it is; how lush; how its flank turns to the light;
 * its mottling; how thickly each flower grows there; which flower flecks it, if any, how late in the
 * year that one lasts and how bright it is; and how far below the crest it lies.
 */
interface Ground {
  cover: Uint8Array;
  patch: Uint8Array;
  dry: Uint8Array;
  lush: Uint8Array;
  turn: Uint8Array;
  mottle: Uint8Array;
  blooms: Uint8Array[];
  fleck: Uint8Array;
  lasts: Uint8Array;
  bright: Uint8Array;
  depth: Uint8Array;
}

/**
 * A row as worked out for the view: where its strip's first column stands along the hills and how
 * high its top row stands above the horizon, in pixels at the base horizon height; how many of the
 * strip's pixels go to one of those; the strip's size; the height of the crest over each column;
 * its ground and its trees; its strips by day and by night, and the one shown, the night laid over
 * the day as far as it has come on; what they were last painted and laid together for; and their
 * painting again, while that is under way.
 */
interface Row {
  spec: RowSpec;
  u0: number;
  top: number;
  res: number;
  width: number;
  height: number;
  crest: Float32Array;
  ground: Ground;
  trees: Tree[];
  day: HTMLCanvasElement;
  night: HTMLCanvasElement;
  shown: HTMLCanvasElement;
  painted: string;
  laid: string;
  painting: Painting | undefined;
}

/** A painting of a row's strips under way: what it is for, its pixels by day and by night, and the next of them to work out. */
interface Painting {
  key: string;
  look: Look;
  day: ImageData;
  night: ImageData;
  next: number;
}

/** What the strips are painted for: the season, the light on the flanks, and the snow lying. */
interface Look {
  season: number;
  light: number;
  snow: number;
}

export class Hills {
  private rows: Row[] = [];
  /** The view height and the half width, in pixels at the base horizon height, the rows were worked out for. */
  private builtFor = { res: 0, half: 0 };
  /** The rows' outlines as last drawn, in device pixels. */
  private outline = new Path2D();

  /**
   * Draws the hills under the sky's light in `season`, from midsummer at 0 to midwinter at 1, with
   * snow lying `snow` meters deep, over the stretch of the level from `edges.left` to `edges.right`
   * the view pans along.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    light: SkyLight,
    season: number,
    snow: number,
    edges: Edges,
  ): void {
    const f = camera.groundY / BASE_HORIZON;
    const half = camera.width / 2 / f;
    if (
      this.rows.length === 0 ||
      Math.abs(f / this.builtFor.res - 1) > REBUILD_AT ||
      half > this.builtFor.half
    ) {
      this.rows = buildRows(edges, f, half);
      this.builtFor = { res: f, half };
    }
    const look: Look = {
      season: step(season, STEPS.season),
      light: step(flankLight(light), STEPS.light),
      snow: step(smoothstep(SNOWY[0], SNOWY[1], snow), STEPS.snow),
    };
    const key = `${look.season},${look.light},${look.snow}`;
    const dark = step(1 - light.daylight, DARK_STEP);
    const outline = new Path2D();
    let budget = PAINT_BUDGET;
    for (const row of this.rows) {
      const pixels = row.width * row.height;
      if (row.painted === "" && row.painting === undefined) {
        // Never painted yet: painted whole at once, so it never shows bare.
        const painting = startPainting(row, look, key);
        paintPixels(row, painting, pixels);
        finishPainting(row, painting);
      } else if (row.painting === undefined && row.painted !== key) {
        row.painting = startPainting(row, look, key);
      }
      if (row.painting !== undefined && budget > 0) {
        const from = row.painting.next;
        paintPixels(row, row.painting, budget);
        budget -= row.painting.next - from;
        if (row.painting.next >= pixels) {
          finishPainting(row, row.painting);
        }
      }
      const laid = `${row.painted},${dark}`;
      if (row.laid !== laid) {
        layNight(row, dark);
        row.laid = laid;
      }
      // Where the strip's first column and top row land on the page, in CSS pixels.
      const x = camera.width / 2 + (row.u0 - camera.centerX * row.spec.pan) * f;
      const y = camera.horizonRow - row.top * f;
      const scale = f / row.res;
      const place = new DOMMatrix([
        camera.dpr * scale,
        0,
        0,
        camera.dpr * scale,
        x * camera.dpr,
        y * camera.dpr,
      ]);
      ctx.setTransform(place);
      ctx.drawImage(row.shown, 0, 0);
      outline.addPath(crestShape(row), place);
    }
    ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
    this.outline = outline;
  }

  /** The hills' outline as last drawn, as one shape in device pixels, for what stands against the light. */
  silhouette(): Path2D {
    return this.outline;
  }
}

/** `value` to the nearest whole number of `size`. */
function step(value: number, size: number): number {
  return Math.round(value / size) * size;
}

/**
 * How the sun lights the hills' flanks: toward 1 as it shines low from the left, lighting the
 * flanks turned that way, toward -1 from the right, and 0 overhead, under cloud or by night.
 */
function flankLight(light: SkyLight): number {
  const angle = Math.PI * (1 - clamp(light.sun.along, 0, 1));
  const up = smoothstep(-0.04, 0.1, light.sun.height);
  return -Math.cos(angle) * up * light.direct;
}

/** The byte at `index` of `bytes`. */
function byte(bytes: Uint8Array, index: number): number {
  const value = bytes[index];
  invariant(value !== undefined, "A strip's pixel lies outside it.");
  return value;
}

/** The height at `index` of `heights`. */
function heightOf(heights: Float32Array, index: number): number {
  const value = heights[index];
  invariant(value !== undefined, "A strip's column lies outside it.");
  return value;
}

/** A number from -1 to 1, fixed for each point (`i`, `j`) of a lattice and `seed`. */
function lattice(i: number, j: number, seed: number): number {
  let h =
    (Math.imul(i, 374761393) +
      Math.imul(j, 668265263) +
      Math.imul(seed, 1274126177)) |
    0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

/** Smooth 2D value noise from -1 to 1, laid out by `seed`. */
function noise(x: number, y: number, seed: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = lattice(i, j, seed);
  const b = lattice(i + 1, j, seed);
  const c = lattice(i, j + 1, seed);
  const d = lattice(i + 1, j + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** `octaves` of noise laid out by `seed`, each half as strong and twice as fine as the last, from -1 to 1. */
function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let strength = 0.5;
  let total = 0;
  let fine = 1;
  for (let o = 0; o < octaves; o += 1) {
    sum += strength * noise(x * fine + o * 31.7, y * fine - o * 17.3, seed + o);
    total += strength;
    strength *= 0.5;
    fine *= 2.03;
  }
  return sum / total;
}

/**
 * Works out every row of the hills for a view `res` times the base horizon height, `half` wide
 * either side of its middle in pixels at the base horizon height, panning over `edges`.
 */
function buildRows(edges: Edges, res: number, half: number): Row[] {
  const rows: Row[] = [];
  // From the nearest back, so each row knows how low the one in front of it ever comes, below
  // which it is never seen.
  let floor = -BELOW;
  for (let i = ROWS.length - 1; i >= 0; i -= 1) {
    const spec = at(ROWS, i);
    const from = edges.left * spec.pan - half - 64;
    const to = edges.right * spec.pan + half + 64;
    const row = buildRow(spec, from, to, floor, res);
    rows.unshift(row);
    let lowest = Infinity;
    for (const height of row.crest) {
      lowest = Math.min(lowest, height);
    }
    floor = lowest - 6;
  }
  return rows;
}

/**
 * Works out a row along the hills from `from` to `to`, down to `floor` above the horizon, all in
 * pixels at the base horizon height, at `res` of the strip's pixels to each of those: its crest,
 * the ground under it pixel by pixel, and its trees.
 */
function buildRow(
  spec: RowSpec,
  from: number,
  to: number,
  floor: number,
  res: number,
): Row {
  const rng = new Rng(spec.seed);
  const swells: Swell[] = [];
  const spacing = SWELL_SPAN / spec.count;
  for (let u = from - 400; u < to + 400; u += spacing) {
    const wide = lerp(spec.width[0], spec.width[1], rng.next());
    const lean = (rng.next() - 0.5) * 0.8;
    swells.push({
      middle: u + (0.15 + 0.7 * rng.next()) * spacing,
      height: lerp(spec.height[0], spec.height[1], rng.next()),
      left: wide * (1 + lean),
      right: wide * (1 - lean),
    });
  }
  // The crest: each swell a broad dome, merging softly into the saddles between them, with a
  // little wander.
  const crestAt = (u: number): number => {
    let sum = 0;
    for (const swell of swells) {
      const reach = u < swell.middle ? swell.left : swell.right;
      const t = (u - swell.middle) / reach;
      if (t * t < 12) {
        sum += Math.pow(swell.height * Math.exp(-t * t), 3);
      }
    }
    return (
      spec.base +
      Math.cbrt(sum) +
      WANDER *
        (noise(u / 45, 0.5, spec.seed + 9) +
          0.35 * noise(u / 13 + 70, 0.5, spec.seed + 9))
    );
  };

  const width = Math.ceil((to - from) * res);
  const crest = new Float32Array(width);
  let highest = -Infinity;
  for (let i = 0; i < width; i += 1) {
    const height = crestAt(from + (i + 0.5) / res);
    crest[i] = height;
    highest = Math.max(highest, height);
  }
  const top = highest + spec.trees.size * 2.6 + 2;
  const height = Math.ceil((top - floor) * res);
  const ground = buildGround(spec, crestAt, crest, from, top, res, height);
  const trees = plantTrees(spec, crestAt, from, to, rng);
  const strip = (): HTMLCanvasElement => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  };
  return {
    spec,
    u0: from,
    top,
    res,
    width,
    height,
    crest,
    ground,
    trees,
    day: strip(),
    night: strip(),
    shown: strip(),
    painted: "",
    laid: "",
    painting: undefined,
  };
}

/** Works out a row's ground pixel by pixel, under the crest `crest` of its strip's columns. */
function buildGround(
  spec: RowSpec,
  crestAt: (u: number) => number,
  crest: Float32Array,
  from: number,
  top: number,
  res: number,
  height: number,
): Ground {
  const width = crest.length;
  const size = width * height;
  const bytes = (): Uint8Array => new Uint8Array(size);
  const ground: Ground = {
    cover: bytes(),
    patch: bytes(),
    dry: bytes(),
    lush: bytes(),
    turn: bytes(),
    mottle: bytes(),
    blooms: FLOWERS.map(() => bytes()),
    fleck: bytes(),
    lasts: bytes(),
    bright: bytes(),
    depth: bytes(),
  };
  const seed = 300 + spec.seed;
  const z = spec.zoom;
  const cell = Math.max(1, Math.round((spec.speck / 2) * res));
  const thick = [0, 0, 0, 0];
  for (let i = 0; i < width; i += 1) {
    const u = from + (i + 0.5) / res;
    const c = heightOf(crest, i);
    // How far the crest here lies below those around it, and how it slopes.
    let around = 0;
    for (let k = -6; k <= 6; k += 1) {
      around += crestAt(u + k * 14);
    }
    const valley = clamp((around / 13 - c) / 9, -1, 1);
    const slope = (crestAt(u + 3) - crestAt(u - 3)) / 6;
    for (let j = 0; j < height; j += 1) {
      const h = top - (j + 0.5) / res;
      const d = c - h;
      const cover = clamp(d * res + 0.5, 0, 1);
      if (cover <= 0) {
        continue;
      }
      const o = j * width + i;
      ground.cover[o] = Math.round(cover * 255);
      ground.depth[o] = Math.min(255, Math.round(Math.max(d, 0)));
      const patch = fbm(u / (150 * z), d / (20 * z), seed, 3);
      ground.patch[o] = Math.round(smoothstep(-0.3, 0.4, patch) * 255);
      const dry = clamp(
        0.3 +
          0.42 * fbm(u / (300 * z) + 20, d / (34 * z), seed + 1, 3) -
          0.3 * valley -
          0.005 * d,
        0,
        0.8,
      );
      ground.dry[o] = Math.round(dry * 255);
      ground.lush[o] = Math.round(
        clamp(0.35 * valley + 0.004 * d, 0, 0.4) * 255,
      );
      const turn = clamp(slope * 2.4, -1, 1) * Math.exp(-d / 26);
      ground.turn[o] = Math.round((turn + 1) * 127.5);
      const mottle =
        1 +
        0.07 * fbm(u / (8 * z), d / (2.6 * z), seed + 2, 2) +
        spec.blades * fbm(u / (0.9 * z) + 300, d / (6 * z), seed + 2, 2);
      ground.mottle[o] = Math.round(clamp((mottle - 0.7) / 0.6, 0, 1) * 255);
      thick[0] =
        smoothstep(0.1, 0.55, fbm(u / (170 * z), d / (13 * z), seed + 3, 3)) *
        (0.5 + 0.5 * clamp(valley + 0.5, 0, 1));
      thick[1] =
        smoothstep(0.16, 0.6, fbm(u / (110 * z), d / (9 * z), seed + 4, 3)) *
        (0.5 + 0.5 * clamp(0.6 - valley, 0, 1));
      thick[2] =
        smoothstep(0.3, 0.72, fbm(u / (230 * z), d / (16 * z), seed + 5, 3)) *
        0.75;
      thick[3] =
        smoothstep(0.48, 0.8, fbm(u / (260 * z), d / (15 * z), seed + 6, 3)) *
        0.55;
      // A fleck of one flower or another, as thickly as each grows here.
      const cu = Math.floor((u * res) / cell);
      const cv = Math.floor((h * res) / cell);
      const pick = (lattice(cu, cv, seed + 7) + 1) / 2;
      let edge = 0;
      for (let k = 0; k < FLOWERS.length; k += 1) {
        const grows = at(thick, k);
        at(ground.blooms, k)[o] = Math.round(grows * 255);
        edge += grows * at(FLOWERS, k).share * spec.flowers;
        if (byte(ground.fleck, o) === 0 && pick < edge) {
          ground.fleck[o] = k + 1;
          ground.lasts[o] = Math.round(
            ((lattice(cu, cv, seed + 8) + 1) / 2) * 255,
          );
          ground.bright[o] = Math.round(
            ((lattice(cu, cv, seed + 9) + 1) / 2) * 255,
          );
        }
      }
    }
  }
  return ground;
}

/**
 * Plants a row's trees from `from` to `to` along it, laid out by `rng`: copses filling its deepest
 * dips, broad across the dip and thinning toward its edges; hedgerows across its slopes, following
 * the lie of the hill as they fall gently toward the view, close bushes with a tree standing out of
 * them here and there; and trees alone or in small groups on the slopes.
 */
function plantTrees(
  spec: RowSpec,
  crestAt: (u: number) => number,
  from: number,
  to: number,
  rng: Rng,
): Tree[] {
  const { size } = spec.trees;
  const stretches = (to - from) / STRETCH;
  const trees: Tree[] = [];
  const plant = (u: number, h: number, crown: number): void => {
    trees.push({ u, h, size: crown, seed: Math.floor(rng.next() * 1e9) });
  };
  // The dips, deepest first.
  const dips: { u: number; deep: number }[] = [];
  for (let u = from + 10; u < to - 10; u += 2) {
    const c = crestAt(u);
    if (
      c < crestAt(u - 24) &&
      c < crestAt(u + 24) &&
      c <= crestAt(u - 2) &&
      c <= crestAt(u + 2)
    ) {
      dips.push({ u, deep: Math.max(crestAt(u - 60), crestAt(u + 60)) - c });
    }
  }
  dips.sort((a, b) => b.deep - a.deep);
  for (const dip of dips.slice(0, Math.round(spec.trees.woods * stretches))) {
    const wide = size * (5 + 6 * rng.next());
    for (let k = 0; k < wide / (size * 0.45); k += 1) {
      const t = rng.next() * 2 - 1;
      const u = dip.u + t * wide;
      const deep = size * (1.6 - 1.2 * Math.abs(t)) * rng.next();
      plant(
        u,
        crestAt(u) - size * 0.5 - deep,
        size * (0.8 + 0.4 * rng.next()) * (1 - 0.35 * Math.abs(t)),
      );
    }
  }
  for (let k = 0; k < Math.round(spec.trees.hedges * stretches); k += 1) {
    const start = lerp(from + 80, to - 80, rng.next());
    const way = rng.next() < 0.5 ? -1 : 1;
    const length = size * (16 + 14 * rng.next());
    const below = size * (0.6 + rng.next());
    const fall = size * (1 + 2.5 * rng.next());
    for (let t = 0; t <= 1; t += (0.32 * size) / length) {
      const u = start + way * t * length;
      const tall = rng.next() < 0.1;
      plant(
        u,
        crestAt(u) - below - fall * t - Math.sin(t * 7 + k) * size * 0.25,
        size * (tall ? 0.85 : 0.38 + 0.12 * rng.next()),
      );
    }
  }
  for (let k = 0; k < Math.round(spec.trees.lone * stretches); k += 1) {
    const u = lerp(from + 40, to - 40, rng.next());
    const count = rng.next() < 0.6 ? 1 : 2 + Math.floor(rng.next() * 2);
    const down = size * (0.3 + 1.4 * rng.next());
    for (let j = 0; j < count; j += 1) {
      const tu = u + j * size * (1.1 + 0.4 * rng.next());
      plant(
        tu,
        crestAt(tu) - down - rng.next() * size * 0.3,
        size * (0.85 + 0.35 * rng.next()),
      );
    }
  }
  // Those higher up the hill stand farther back, so they go first.
  trees.sort((a, b) => b.h - a.h);
  return trees;
}

/** The grass's colors at `season`, from summer through fall to winter. */
function grassAt(season: number): {
  fresh: Rgb;
  olive: Rgb;
  straw: Rgb;
  lush: Rgb;
} {
  const { summer, fall, winter } = GRASS;
  const toFall = smoothstep(0.15, 0.55, season);
  const toWinter = smoothstep(0.6, 0.95, season);
  const blend = (name: "fresh" | "olive" | "straw" | "lush"): Rgb =>
    mix(mix(summer[name], fall[name], toFall), winter[name], toWinter);
  return {
    fresh: blend("fresh"),
    olive: blend("olive"),
    straw: blend("straw"),
    lush: blend("lush"),
  };
}

/** `color` as it shows by night `haze` far off. */
function byNight(color: Rgb, haze: number): Rgb {
  const { shade } = NIGHT;
  return mix(
    [color[0] * shade[0], color[1] * shade[1], color[2] * shade[2]],
    NIGHT.haze,
    haze,
  );
}

/** Starts painting a row's strips for `look`, which `key` names. */
function startPainting(row: Row, look: Look, key: string): Painting {
  return {
    key,
    look,
    day: new ImageData(row.width, row.height),
    night: new ImageData(row.width, row.height),
    next: 0,
  };
}

/** Lays a finished painting's pixels into a row's strips by day and by night, and its trees over them. */
function finishPainting(row: Row, painting: Painting): void {
  const dayContext = row.day.getContext("2d");
  const nightContext = row.night.getContext("2d");
  invariant(
    dayContext !== null && nightContext !== null,
    "Canvas 2D is not available for the hills.",
  );
  dayContext.putImageData(painting.day, 0, 0);
  nightContext.putImageData(painting.night, 0, 0);
  for (const tree of row.trees) {
    drawTree(dayContext, row, tree, painting.look, false);
    drawTree(nightContext, row, tree, painting.look, true);
  }
  row.painted = painting.key;
  row.painting = undefined;
}

/**
 * Works out the next `count` pixels of a painting of a row's ground, by day and by night: its grass
 * for the season, lit or shaded as its flank turns to the light and mottled; the flowers washing and
 * flecking it while they bloom; the snow on it; and the haze of the distance.
 */
function paintPixels(row: Row, painting: Painting, count: number): void {
  const { ground, spec } = row;
  const { look, day, night } = painting;
  const grass = grassAt(look.season);
  const drier = DRYING * smoothstep(0.08, 0.5, look.season);
  const bloom = 1 - smoothstep(BLOOM_FADES[0], BLOOM_FADES[1], look.season);
  const end = Math.min(painting.next + count, row.width * row.height);
  // The color being worked out for a pixel, pulled toward one color after another.
  const color = { r: 0, g: 0, b: 0 };
  const toward = (target: Rgb, share: number): void => {
    color.r += (target[0] - color.r) * share;
    color.g += (target[1] - color.g) * share;
    color.b += (target[2] - color.b) * share;
  };
  const { shade } = NIGHT;
  for (let o = painting.next; o < end; o += 1) {
    const cover = byte(ground.cover, o);
    if (cover === 0) {
      continue;
    }
    const patch = byte(ground.patch, o) / 255;
    color.r = grass.fresh[0] + (grass.olive[0] - grass.fresh[0]) * patch;
    color.g = grass.fresh[1] + (grass.olive[1] - grass.fresh[1]) * patch;
    color.b = grass.fresh[2] + (grass.olive[2] - grass.fresh[2]) * patch;
    toward(grass.straw, clamp(byte(ground.dry, o) / 255 + drier, 0, 0.9));
    toward(grass.lush, byte(ground.lush, o) / 255);
    const turn = (byte(ground.turn, o) / 127.5 - 1) * look.light;
    if (turn > 0) {
      toward(LIGHT.lit.color, LIGHT.lit.share * turn);
    } else {
      toward(LIGHT.shade.color, -LIGHT.shade.share * turn);
    }
    const mottled = byte(ground.mottle, o) / 255;
    const mottle = 0.7 + mottled * 0.6;
    color.r *= mottle;
    color.g *= mottle;
    color.b *= mottle;
    if (bloom > 0) {
      for (let k = 0; k < FLOWERS.length; k += 1) {
        const flower = at(FLOWERS, k);
        const grows = byte(at(ground.blooms, k), o) / 255;
        toward(flower.color, flower.wash * grows * bloom);
      }
      const fleck = byte(ground.fleck, o);
      if (fleck > 0 && byte(ground.lasts, o) / 255 < bloom) {
        toward(
          at(FLOWERS, fleck - 1).color,
          0.7 + 0.3 * (byte(ground.bright, o) / 255),
        );
      }
    }
    if (look.snow > 0) {
      toward(LIGHT.snow, look.snow * (0.72 + 0.28 * mottled));
    }
    const haze = clamp(
      spec.haze + 0.12 * Math.exp(-byte(ground.depth, o) / 10),
      0,
      1,
    );
    const p = o * 4;
    night.data[p] = lerp(color.r * shade[0], NIGHT.haze[0], haze);
    night.data[p + 1] = lerp(color.g * shade[1], NIGHT.haze[1], haze);
    night.data[p + 2] = lerp(color.b * shade[2], NIGHT.haze[2], haze);
    // Solid wherever there is land at all, since the day's strip already gives the soft edge
    // along the crest, and the night laid over it must cover it there as fully as anywhere.
    night.data[p + 3] = 255;
    toward(LIGHT.haze, haze);
    day.data[p] = color.r;
    day.data[p + 1] = color.g;
    day.data[p + 2] = color.b;
    day.data[p + 3] = cover;
  }
  painting.next = end;
}

/**
 * A broadleaf tree on a row's strip, by day or by `night`: its shadow on the grass to the side away
 * from the sun, its trunk, and a crown of clustered clumps of leaves, flattened a little underneath,
 * dark through and lit on the side toward the sun, hazed by the distance. Its leaves turn in fall,
 * and in winter it stands bare, with snow on it when snow lies.
 */
function drawTree(
  g: CanvasRenderingContext2D,
  row: Row,
  tree: Tree,
  look: Look,
  night: boolean,
): void {
  const rng = new Rng(tree.seed);
  const hz = row.spec.trees.haze;
  const shown = (color: Rgb): string => {
    const hazed = mix(color, LIGHT.haze, hz);
    const c = night ? byNight(color, hz) : hazed;
    return `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
  };
  const x = (tree.u - row.u0) * row.res;
  const y = (row.top - tree.h) * row.res;
  const r = tree.size * row.res;
  const turned = smoothstep(TURNS[0], TURNS[1], look.season);
  const bare = smoothstep(SHEDS[0], SHEDS[1], look.season);
  const summer = mix(
    TREE.leaf,
    TREE.lighter.color,
    rng.next() * TREE.lighter.share,
  );
  const turning = at(
    TREE.turning,
    Math.floor(rng.next() * TREE.turning.length),
  );
  const leaf = mix(
    mix(summer, turning, turned * (0.6 + 0.4 * rng.next())),
    TREE.bare.color,
    bare,
  );
  const side = look.light >= 0 ? 1 : -1;
  const lit = Math.abs(look.light);

  if (lit > 0 && !night) {
    g.fillStyle = `rgba(${LIGHT.shade.color.join(",")},${0.32 * lit * (1 - hz)})`;
    g.beginPath();
    g.ellipse(
      x + side * r * 0.85,
      y + r * 0.06,
      r * 1.1,
      r * 0.2,
      0,
      0,
      Math.PI * 2,
    );
    g.fill();
  }
  const trunk = r * (0.5 + 0.25 * rng.next());
  g.fillStyle = shown(TREE.bark);
  g.fillRect(x - r * 0.07, y - trunk, r * 0.14, trunk + 0.4);
  const cx = x;
  const cy = y - trunk - r * 0.55;
  const clumps: { x: number; y: number; r: number }[] = [];
  const count = 8 + Math.floor(rng.next() * 6);
  for (let i = 0; i < count; i += 1) {
    const angle = rng.next() * Math.PI * 2;
    const out = Math.sqrt(rng.next()) * 0.6;
    const down = Math.sin(angle) * out * r * 0.7;
    clumps.push({
      x: cx + Math.cos(angle) * out * r,
      y: cy + (down > 0 ? down * 0.6 : down),
      r: r * (0.3 + 0.18 * rng.next()),
    });
  }
  g.globalAlpha = lerp(1, TREE.bare.alpha, bare);
  g.fillStyle = shown(mix(leaf, [42, 33, 26], 0.36));
  g.beginPath();
  for (const clump of clumps) {
    g.moveTo(clump.x + clump.r, clump.y);
    g.arc(clump.x, clump.y, clump.r, 0, Math.PI * 2);
  }
  g.fill();
  const sunlit = mix(
    mix(leaf, LIGHT.lit.color, 0.2),
    LIGHT.snow,
    look.snow * 0.7,
  );
  g.fillStyle = shown(sunlit);
  g.beginPath();
  for (const clump of clumps) {
    if (side * (cx - clump.x) > -r * 0.2 && clump.y - cy < r * 0.1) {
      const lx = clump.x - side * clump.r * 0.22;
      const ly = clump.y - clump.r * 0.25;
      g.moveTo(lx + clump.r * 0.6, ly);
      g.arc(lx, ly, clump.r * 0.6, 0, Math.PI * 2);
    }
  }
  g.fill();
  g.globalAlpha = 1;
}

/**
 * Lays a row's strip by night over its strip by day, `dark` of the way, into the one it shows:
 * only over the land, so its soft edge along the crest takes the two together as the rest does.
 */
function layNight(row: Row, dark: number): void {
  const g = row.shown.getContext("2d");
  invariant(g !== null, "Canvas 2D is not available for the hills.");
  g.globalCompositeOperation = "copy";
  g.drawImage(row.day, 0, 0);
  if (dark > 0) {
    g.globalCompositeOperation = "source-atop";
    g.globalAlpha = dark;
    g.drawImage(row.night, 0, 0);
    g.globalAlpha = 1;
  }
  g.globalCompositeOperation = "source-over";
}

/** A row's crest and the land under it, in its strip's pixels. */
function crestShape(row: Row): Path2D {
  const path = new Path2D();
  const { crest, top, res, width, height } = row;
  path.moveTo(0, height);
  for (let i = 0; i < width; i += 3) {
    path.lineTo(i, (top - heightOf(crest, i)) * res);
  }
  path.lineTo(width, (top - heightOf(crest, width - 1)) * res);
  path.lineTo(width, height);
  path.closePath();
  return path;
}
