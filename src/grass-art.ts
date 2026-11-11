import type { Camera } from "./camera";
import {
  CLUMPS,
  type Grass,
  growthAt,
  KINDS,
  STRIP,
  type Strip,
  wiltAt,
} from "./grass";
import type { GrassKind, Level } from "./level";
import { css, lit, mix, type Rgb, type SkyLight } from "./sky";
import { at, clamp, hash, lerp, smoothstep, valueNoise } from "./util";
import { SNOW_COLOR } from "./weather";
import type { Vec } from "./wind";

/** Colors of each kind of grass by day at midsummer, from its shadowed blades to its lit ones. */
const GREENS: Record<GrassKind, readonly Rgb[]> = {
  meadow: [
    [96, 136, 60],
    [122, 164, 74],
    [150, 186, 92],
  ],
  wildflower: [
    [78, 112, 54],
    [100, 136, 64],
    [126, 156, 80],
  ],
  wheat: [
    [176, 150, 92],
    [206, 180, 120],
    [226, 204, 150],
  ],
};

/**
 * Through the fall grass turns toward straw, and through the winter toward bare earth, as the
 * fields do, by up to these shares.
 */
const STRAW: Rgb = [190, 168, 112];
const BARE: Rgb = [122, 108, 90];
const TURN = { fall: 0.7, winter: 0.6 } as const;

/**
 * Meadow flowers, after the wildflower meadow's photo: spikes of lupine in purple, rose or white,
 * and daisies, white about a golden middle. They stand among the grass, the wildflower meadow's most
 * of all: in a strip of it, a flower stands one time in `wildflower`; in meadow grass, one time in
 * `meadow`. A lupine is one time in `lupine` of them.
 */
const FLOWERS = {
  wildflower: 0.85,
  meadow: 0.08,
  lupine: 0.65,
  lupines: [
    [118, 106, 196],
    [100, 92, 176],
    [204, 128, 172],
    [236, 232, 222],
  ] as readonly Rgb[],
  petals: [242, 238, 228] as Rgb,
  middle: [232, 192, 70] as Rgb,
} as const;

/**
 * A lupine's stem stands from `stem.from` to `stem.to` meters tall at midsummer, its spike of
 * florets filling the top `spike` of it, each floret up to `floret` meters across. A daisy's stem
 * stands from `daisy.from` to `daisy.to` meters, its head `head` across.
 */
const SHAPES = {
  stem: { from: 0.55, to: 0.95 },
  spike: 0.5,
  floret: 0.04,
  florets: 12,
  daisy: { from: 0.28, to: 0.45 },
  head: 0.08,
  /** A head of seed on beach or wheat grass is this long and this wide, in meters. */
  seed: { length: 0.11, width: 0.022 },
} as const;

/**
 * How grass moves of its own as the wind stirs it: each blade flutters by up to `flutter` radians
 * once the wind leans its strip `full` radians over, less in a lighter wind, and not at all in still
 * air; meadow grass flops over in waves, by up to `flop` radians, over
 * stretches of about `waves` meters; dune grass fans out of its clumps by up to `fan` radians. A
 * blade droops over the way it leans, the change easing over `soft` radians either side of upright,
 * so a blade the wind sways back and forth through upright never flips from side to side.
 */
const MOTION = {
  flutter: 0.1,
  full: 0.5,
  flop: 0.45,
  waves: 3.5,
  fan: 0.55,
  soft: 0.25,
} as const;

/**
 * Every blade and stem starts this far under the ground, in meters, or `px` CSS pixels if that is
 * more, and is drawn only above it, so each grows out of the ground with no gap however it leans.
 */
const ROOTED = { meters: 0.04, px: 3 } as const;

/** Fewest CSS pixels a blade is drawn long; grass shorter than this on screen is left out. */
const SHORTEST_PX = 1.5;

/** Fills gathered for one color, all painted at once. */
type Batches = Map<string, { color: Rgb; path: Path2D }>;

/**
 * Draws the grass and meadow flowers on `level`'s ground, `look.height` times as tall as usual,
 * within `above`, everything above the ground in device pixels: the blades behind everything
 * standing on the ground, or if `front`, those in front of it. Each blade is a fine stroke tapering to its tip,
 * in the ground's own ink, unless `colors`, when it is green at midsummer, turning to straw and
 * bare earth through the fall and winter. Meadow flowers
 * are always in their colors, as the tree's are.
 */
export function drawGrass(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  level: Level,
  grass: Grass,
  above: Path2D,
  look: {
    light: SkyLight;
    season: number;
    time: number;
    colors: boolean;
    height: number;
  },
  front: boolean,
): void {
  const { season, time } = look;
  const left = camera.toWorld(0, 0).x - 1.5;
  const right = camera.toWorld(camera.width, 0).x + 1.5;
  const tall = growthAt(season) * look.height;
  const wilt = wiltAt(season);
  const bloom = 1 - smoothstep(0.35, 0.7, season);
  const blades: Batches = new Map();
  const flowers: Batches = new Map();
  for (const [i, strip] of grass.all.entries()) {
    if (strip.x < left || strip.x > right) {
      continue;
    }
    const kind = KINDS[strip.kind];
    const lengthPx = kind.height.to * tall * camera.scale;
    if (lengthPx < SHORTEST_PX) {
      continue;
    }
    const crowd = strip.clumped ? CLUMPS.crowd : 1;
    const count = Math.max(
      1,
      Math.round(
        kind.blades * crowd * strip.thick * clamp(lengthPx / 14, 0.25, 1),
      ),
    );
    const snowy = smoothstep(0, 0.05, strip.snow);
    const tones = tonesOf(strip, look, snowy);
    for (let k = 0; k < count; k += 1) {
      const n = i * 17 + k;
      if (hash(n, 1) < 0.35 !== front) {
        continue;
      }
      const length =
        lerp(kind.height.from, kind.height.to, hash(n, 2)) * tall - strip.snow;
      if (length <= 0) {
        continue;
      }
      const bias = biasOf(strip, n);
      const blade = poseOf(strip, kind.droop, bias, wilt, time, n);
      const color = at(tones, Math.floor(hash(n, 3) * tones.length));
      const path = batchFor(blades, color);
      const base = baseOf(camera, level, strip, (hash(n, 4) - 0.5) * STRIP);
      const tip = addBlade(
        path,
        camera,
        base,
        length * camera.scale,
        Math.max(0.8, kind.width * camera.scale),
        blade,
      );
      if (strip.kind === "wheat" && hash(n, 5) < 0.45) {
        addSeed(path, camera, tip, blade.tip);
      }
    }
    // A flower stands in some strips, among the grass.
    const chance =
      strip.kind === "wildflower"
        ? FLOWERS.wildflower
        : strip.kind === "meadow"
          ? FLOWERS.meadow
          : 0;
    if (hash(i, 6) >= chance * strip.thick || hash(i, 7) < 0.4 !== front) {
      continue;
    }
    const lupine = hash(i, 8) < FLOWERS.lupine;
    const height =
      (lupine
        ? lerp(SHAPES.stem.from, SHAPES.stem.to, hash(i, 9))
        : lerp(SHAPES.daisy.from, SHAPES.daisy.to, hash(i, 9))) *
        tall -
      strip.snow;
    if (height <= 0) {
      continue;
    }
    const pose = poseOf(strip, 0.15, biasOf(strip, i * 31), wilt, time, i * 31);
    const stemColor = at(tones, 0);
    const base = baseOf(camera, level, strip, (hash(i, 10) - 0.5) * STRIP);
    const top = addBlade(
      batchFor(blades, stemColor),
      camera,
      base,
      height * camera.scale,
      Math.max(0.7, 0.008 * camera.scale),
      pose,
    );
    if (bloom > 0.05) {
      if (lupine) {
        addLupine(
          flowers,
          camera,
          base,
          top,
          at(FLOWERS.lupines, Math.floor(hash(i, 11) * FLOWERS.lupines.length)),
          bloom,
          look.light,
          snowy,
        );
      } else {
        addDaisy(flowers, camera, top, bloom, look.light, snowy);
      }
    }
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clip(above);
  for (const { color, path } of [...blades.values(), ...flowers.values()]) {
    ctx.fillStyle = css(color);
    ctx.fill(path);
  }
  ctx.restore();
}

/**
 * The colors a strip's blades are drawn in: its kind's greens for the season and light if the grass
 * is in its colors, or else the color of the ground it stands on; whitened by the snow on it.
 */
function tonesOf(
  strip: Strip,
  look: {
    light: SkyLight;
    season: number;
    colors: boolean;
  },
  snowy: number,
): Rgb[] {
  const { light, season } = look;
  const snow = lit(SNOW_COLOR, light.flowerLight);
  if (look.colors) {
    return GREENS[strip.kind].map((green) =>
      mix(lit(seasoned(green, season), light.flowerLight), snow, 0.6 * snowy),
    );
  }
  return [mix(light.ink, snow, 0.6 * snowy)];
}

/** How a blade of `strip` leans of its own: the meadow's waves, a dune clump's fan, and its own tilt. */
function biasOf(strip: Strip, n: number): number {
  const own = (hash(n, 12) - 0.5) * 0.5;
  if (strip.kind === "meadow") {
    return own + MOTION.flop * valueNoise(strip.x / MOTION.waves, 91);
  }
  if (strip.clumped) {
    return own + MOTION.fan * (2 * hash(n, 13) - 1);
  }
  return own;
}

/**
 * How a blade stands, in radians from upright toward the right: where it leaves the ground, and at
 * its tip, which droops further over the way it leans, the more as it wilts; and both laid toward
 * the ground as far as the strip is pressed flat.
 */
function poseOf(
  strip: Strip,
  droop: number,
  bias: number,
  wilt: number,
  time: number,
  n: number,
): { lean: number; tip: number } {
  const flutter =
    MOTION.flutter *
    Math.min(1, Math.abs(strip.lean) / MOTION.full) *
    Math.sin(time * (2.5 + 2 * hash(n, 14)) + hash(n, 15) * Math.PI * 2);
  // Which way it droops comes from how it leans of its own and in the wind, not its flutter.
  const own = strip.lean + bias;
  const side = Math.tanh(own / MOTION.soft);
  const lean = own + flutter;
  const tip = lean + side * droop * (1 + wilt) + 0.6 * lean;
  const flat = own >= 0 ? 1.45 : -1.45;
  return {
    lean: lerp(lean, flat, strip.press),
    tip: lerp(tip, flat * 1.07, strip.press),
  };
}

/**
 * Where a blade `offset` meters along `strip` starts, in CSS pixels: rooted a little under the
 * ground where it stands, or under the snow over it.
 */
function baseOf(
  camera: Camera,
  level: Level,
  strip: Strip,
  offset: number,
): Vec {
  const x = strip.x + offset;
  const rooted = Math.max(ROOTED.meters, ROOTED.px / camera.scale);
  return camera.toScreen(x, level.groundAt(x) + strip.snow - rooted);
}

/**
 * Adds a blade to `path`: from `base`, `length` CSS pixels long and `width` across where it leaves
 * the ground, leaning and drooping as `pose` says, tapering to its tip. Every blade is wound the same
 * way, up one side and down the other, so where they cross they fill as one. Returns its tip.
 */
function addBlade(
  path: Path2D,
  camera: Camera,
  base: Vec,
  length: number,
  width: number,
  pose: { lean: number; tip: number },
): Vec {
  const dpr = camera.dpr;
  const along = { x: Math.sin(pose.lean), y: -Math.cos(pose.lean) };
  const ahead = { x: Math.sin(pose.tip), y: -Math.cos(pose.tip) };
  const bend = {
    x: base.x + along.x * length * 0.55,
    y: base.y + along.y * length * 0.55,
  };
  const tip = {
    x: bend.x + ahead.x * length * 0.5,
    y: bend.y + ahead.y * length * 0.5,
  };
  const across = { x: -along.y, y: along.x };
  const half = width / 2;
  path.moveTo(
    (base.x - across.x * half) * dpr,
    (base.y - across.y * half) * dpr,
  );
  path.quadraticCurveTo(
    (bend.x - across.x * half * 0.5) * dpr,
    (bend.y - across.y * half * 0.5) * dpr,
    tip.x * dpr,
    tip.y * dpr,
  );
  path.quadraticCurveTo(
    (bend.x + across.x * half * 0.5) * dpr,
    (bend.y + across.y * half * 0.5) * dpr,
    (base.x + across.x * half) * dpr,
    (base.y + across.y * half) * dpr,
  );
  path.closePath();
  return tip;
}

/** Adds a slender head of seed to `path` at a stem's `tip`, heading on the way the tip points. */
function addSeed(
  path: Path2D,
  camera: Camera,
  tip: Vec,
  heading: number,
): void {
  const dpr = camera.dpr;
  const length = SHAPES.seed.length * camera.scale;
  const half = Math.max(0.6, (SHAPES.seed.width * camera.scale) / 2);
  const ahead = { x: Math.sin(heading), y: -Math.cos(heading) };
  const across = { x: -ahead.y, y: ahead.x };
  const end = { x: tip.x + ahead.x * length, y: tip.y + ahead.y * length };
  const middle = { x: (tip.x + end.x) / 2, y: (tip.y + end.y) / 2 };
  path.moveTo(tip.x * dpr, tip.y * dpr);
  path.quadraticCurveTo(
    (middle.x - across.x * half * 2) * dpr,
    (middle.y - across.y * half * 2) * dpr,
    end.x * dpr,
    end.y * dpr,
  );
  path.quadraticCurveTo(
    (middle.x + across.x * half * 2) * dpr,
    (middle.y + across.y * half * 2) * dpr,
    tip.x * dpr,
    tip.y * dpr,
  );
  path.closePath();
}

/**
 * Adds a lupine's spike to `flowers`: florets up the top of its stem from `base` to `top`, largest
 * at the foot of the spike and smallest at its tip, in `color`, lit and whitened by snow, and fewer
 * and smaller as it dies back through the fall, by `bloom`.
 */
function addLupine(
  flowers: Batches,
  camera: Camera,
  base: Vec,
  top: Vec,
  color: Rgb,
  bloom: number,
  light: SkyLight,
  snowy: number,
): void {
  const dpr = camera.dpr;
  const shade = mix(
    lit(color, light.flowerLight),
    lit(SNOW_COLOR, light.flowerLight),
    0.6 * snowy,
  );
  const path = batchFor(flowers, shade);
  const florets = SHAPES.florets;
  for (let j = 0; j < florets; j += 1) {
    const t = 1 - SHAPES.spike * (1 - j / (florets - 1));
    const x = lerp(base.x, top.x, t);
    const y = lerp(base.y, top.y, t);
    const radius =
      Math.max(
        0.6,
        ((SHAPES.floret * camera.scale) / 2) * (1 - 0.6 * (j / florets)),
      ) * bloom;
    const side = (j % 2 === 0 ? 1 : -1) * radius * 0.6;
    path.moveTo((x + side + radius) * dpr, y * dpr);
    path.arc((x + side) * dpr, y * dpr, radius * dpr, 0, Math.PI * 2);
  }
}

/** Adds a daisy's head to `flowers` at the top of its stem, `top`: white petals about a golden middle. */
function addDaisy(
  flowers: Batches,
  camera: Camera,
  top: Vec,
  bloom: number,
  light: SkyLight,
  snowy: number,
): void {
  const dpr = camera.dpr;
  const snow = lit(SNOW_COLOR, light.flowerLight);
  const radius = Math.max(0.8, (SHAPES.head * camera.scale) / 2) * bloom;
  const petals = batchFor(
    flowers,
    mix(lit(FLOWERS.petals, light.flowerLight), snow, 0.6 * snowy),
  );
  petals.moveTo((top.x + radius) * dpr, top.y * dpr);
  petals.arc(top.x * dpr, top.y * dpr, radius * dpr, 0, Math.PI * 2);
  const middle = batchFor(
    flowers,
    mix(lit(FLOWERS.middle, light.flowerLight), snow, 0.6 * snowy),
  );
  middle.moveTo((top.x + radius * 0.38) * dpr, top.y * dpr);
  middle.arc(top.x * dpr, top.y * dpr, radius * 0.38 * dpr, 0, Math.PI * 2);
}

/** The path for `color` in `batches`, made the first time it is asked for. */
function batchFor(batches: Batches, color: Rgb): Path2D {
  const key = color.map((c) => Math.round(c)).join(",");
  let batch = batches.get(key);
  if (batch === undefined) {
    batch = { color, path: new Path2D() };
    batches.set(key, batch);
  }
  return batch.path;
}

/** `color` turned with the year: toward straw through the fall, and bare earth through the winter. */
function seasoned(color: Rgb, season: number): Rgb {
  const fall = TURN.fall * smoothstep(0.3, 0.7, season);
  const winter = TURN.winter * smoothstep(0.7, 1, season);
  return mix(mix(color, STRAW, fall), BARE, winter);
}
