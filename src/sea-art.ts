import type { Camera } from "./camera";
import type { Profile, Sea } from "./sea";
import { css, lit, mix, type Rgb, skyBodyAt, type SkyLight } from "./sky";
import {
  at,
  clamp,
  invariant,
  lerp,
  Rng,
  smoothstep,
  valueNoise,
} from "./util";
import { SNOW_COLOR } from "./weather";

/**
 * The water's own color by day and by night before it takes on the sky's: near its surface, and
 * deep down.
 */
const WATER = {
  surface: { day: [86, 112, 118], night: [20, 28, 44] },
  deep: { day: [44, 62, 70], night: [10, 14, 26] },
} as const;
/** How much of the sky's color the water takes on near its surface, deep down, and far off. */
const SHEEN = { surface: 0.4, deep: 0.1, far: 0.3, horizon: 0.62 } as const;
/** Lines are raked dark into the water by day, and catch the moonlight pale by night. */
const LINE_COLOR = { day: [36, 34, 32], night: [214, 216, 210] } as const;
/** How strongly the lines show by day and by night. */
const LINE_ALPHA = { day: 0.5, night: 0.34 } as const;
/** Strength of the pale sand grain over the water, as over the ink. */
const GRAIN = 0.06;
/** CSS pixels between the points the water is worked out at. */
const STEP_PX = 2.5;
/**
 * Lines under the surface, following the water's swing as it fades with depth: the first one's
 * depth and how much deeper each next one lies, in meters, and the least CSS pixels between two.
 */
const CONTOURS = { first: 0.13, deeper: 1.42, count: 13, apart: 5 } as const;
/** Widths of the lines, in CSS pixels: the surface, and a contour near the surface and deep down. */
const WIDTH = { surface: 1.5, near: 1.25, deep: 0.8 } as const;
/**
 * Foam lies on the water as pale lines just under the surface: their depths, in meters, and how
 * much foam each needs to show.
 */
const FOAM_LINES = [
  { depth: 0.035, needs: 0.04 },
  { depth: 0.09, needs: 0.22 },
  { depth: 0.16, needs: 0.45 },
  { depth: 0.25, needs: 0.75 },
] as const;
/**
 * How a breaking wave is shaped, in multiples of its height: how far back its back reaches; how
 * far ahead its face reaches while gentle and once steep; how far on its crest runs and how much
 * higher it rises as it steepens; how steep a wave about to break stands at most, and a broken one
 * rolling on as foam.
 */
/**
 * Rain on the water: how many crowns of spray flick up at once along each CSS pixel of surface in
 * a downpour, how many seconds each lasts, and how big one is, in CSS pixels.
 */
const RAIN_ON = { perPx: 0.05, seconds: 0.16, size: 2.6 } as const;
/** How deep, in meters, the rise of a shaped wave reaches into the water under it before it has mostly faded. */
const LIFT_DEPTH = 0.9;
/** How far, in meters, the rise of a shaped wave is eased across in the water under it, beyond its depth. */
const LIFT_SOFT = 0.25;
/**
 * Hatching the water's shaded faces: the gap between lines in CSS pixels; how far each reaches into
 * the water at most, in meters, and at least, in CSS pixels; how wide each is, in CSS pixels; how
 * far it leans off square, in radians; how far light
 * wraps past a face's edge; the shade over which every other line comes in and then the lines
 * between; how shaded every face is under thick cloud; how strongly it shows, and how deep the
 * still lines below the hatching start, in meters.
 */
const HATCHING = {
  gap: 3,
  depth: 0.4,
  least: 9,
  width: 0.9,
  lean: 0.5,
  wrap: 0.35,
  sparse: [0.3, 0.6],
  dense: [0.58, 0.9],
  overcast: 0.36,
  strength: 1.1,
  still: 1.2,
} as const;
/**
 * A breaker's life, in fractions of the way through breaking: as its crest pitches over, as its lip
 * is thrown out, as the lip falls onto the water ahead, as its tube fills with foam, and as it
 * rolls into a front of foam; and how deep into its curl its foam lies before the tube fills, as a
 * fraction of the foam's full depth.
 */
const BREAKER = {
  pitch: [0, 0.22],
  throw: [0.02, 0.42],
  land: [0.28, 0.46],
  close: [0.44, 0.56],
  roll: [0.56, 0.86],
  foam: 0.45,
} as const;
/**
 * A breaker rolled into a front of foam, in multiples of its height: how far on its crest has
 * rolled and how high it stands, as a fraction of the crest it broke from; how broad its back is
 * over the crest; and how deep the foam on its front lies, and how far back over the crest it
 * starts.
 */
const BORE = {
  on: 0.35,
  rise: 0.92,
  round: 1,
  foam: 0.42,
  foamBack: 0.5,
} as const;
/**
 * Claws of foam reaching from a lip: how many at least, where along the lip the first and last
 * reach from, how far they lean on the way the wave runs, in radians, and how long they grow, in
 * multiples of the wave's height.
 */
const CLAWS = {
  least: 3,
  from: 0.5,
  to: 0.95,
  lean: 0.55,
  length: 0.26,
} as const;
/**
 * How many points a curl's dome and its hook, a breaker's outline as it rolls, and its foam are
 * worked out at.
 */
const SAMPLES = { dome: 14, hook: 10, outline: 48, foam: 40 } as const;
/**
 * A breaker's curl, in multiples of its height, fully grown: how far on its nose comes over and how
 * far it drops, and how much further on and down it goes as the curl plunges; how far back under
 * the nose its tip hooks and how far below the nose, and how far on of the nose it lands; how far
 * back under the nose the top of the tube under it reaches, and how far above the nose; how far
 * back of the crest the face meets the curl, and how far below the crest; and how deep the foam
 * along it lies.
 */
const CURL = {
  nose: { on: 0.45, drops: 0.42, plunges: 0.1, sinks: 0.15 },
  tip: { under: 0.12, drops: 0.3, lands: 0.3 },
  tube: { under: 0.28, up: 0.04 },
  root: { under: 0.06, drops: 0.72 },
  foam: 0.18,
} as const;
/**
 * Foam bursting up where a lip lands: when it starts, as a fraction of the way through breaking,
 * and for how much of the breaking it lasts; how many fingers; and how long they grow, in
 * multiples of the wave's height.
 */
const SPLASH = { from: 0.38, lasts: 0.4, fingers: 5, length: 0.5 } as const;
/**
 * Claws of foam tumbling over the front of a rolling breaker: how many, where along the front the
 * first and last are, from its crest to the water, how quickly they turn over, in radians a second,
 * and how long they grow, in multiples of the wave's height.
 */
const TUMBLE = {
  claws: 3,
  from: 0.45,
  to: 0.85,
  rate: 2.2,
  length: 0.17,
} as const;
const WAVE = {
  back: 4.5,
  face: { gentle: 1.9, steep: 0.8 },
  run: 0.25,
  rise: 0.2,
  poised: 0.55,
  bore: 0.7,
} as const;
/** Horizontal lines over the sea far off: how many, and how tightly they crowd toward the horizon. */
const FAR_LINES = { count: 22, crowd: 1.9 } as const;
/** The horizon's line: its width in CSS pixels, and how strongly it shows. */
const HORIZON_LINE = { width: 1, alpha: 0.32 } as const;
/** The moon's light on the water, and the white every glint on the water leans toward. */
const MOONLIGHT: Rgb = [238, 233, 214];
const GLINT: Rgb = [255, 252, 240];

/** The colors of the sea in one light. */
interface Waters {
  horizon: Rgb;
  far: Rgb;
  surface: Rgb;
  deep: Rgb;
  line: Rgb;
  lineAlpha: number;
  foam: Rgb;
}

interface Point {
  x: number;
  y: number;
}

/** The sea's colors in `light`, which it takes on a share of, as it does the sky's. */
export function watersIn(light: SkyLight): Waters {
  const day = light.daylight;
  const surface = mix(
    mix(WATER.surface.night, WATER.surface.day, day),
    light.sky.middle,
    SHEEN.surface,
  );
  const deep = mix(
    mix(WATER.deep.night, WATER.deep.day, day),
    light.sky.edge,
    SHEEN.deep,
  );
  // Lines stay darker than the water until it is truly dark, then catch the light pale, so they
  // never pass through the water's own shade on the way.
  const raked = smoothstep(0.08, 0.3, day);
  return {
    horizon: mix(surface, light.sky.glow, SHEEN.horizon),
    far: mix(surface, light.sky.middle, SHEEN.far),
    surface,
    deep,
    line: mix(
      mix(surface, LINE_COLOR.night, 0.75),
      mix(surface, LINE_COLOR.day, 0.85),
      raked,
    ),
    lineAlpha: lerp(LINE_ALPHA.night, LINE_ALPHA.day, raked),
    foam: lit(SNOW_COLOR, light.flowerLight),
  };
}

/**
 * The sea far off, behind everything near: from the horizon down, lightening toward the sky, with
 * fine lines crowding toward the horizon the way an engraver draws open water, the sun's glitter
 * on it below the sun, and whitecaps when the wind is up.
 */
export function drawFarSea(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  sea: Sea,
  light: SkyLight,
): void {
  const top = camera.horizonRow;
  const near = camera.toScreen(0, sea.waterLevel).y;
  if (near <= top + 1 || top >= camera.height) {
    return;
  }
  const waters = watersIn(light);
  const width = camera.width;
  ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
  const fill = ctx.createLinearGradient(0, top, 0, near);
  fill.addColorStop(0, css(waters.horizon));
  fill.addColorStop(1, css(waters.far));
  ctx.fillStyle = fill;
  ctx.fillRect(0, top, width, camera.height - top);

  const time = sea.clock;
  const swell = clamp(sea.significantHeight, 0, 4);
  const wind = Math.abs(sea.wind);
  // The sun's or the moon's light glittering on the water below it.
  const sunUp = smoothstep(-0.02, 0.12, light.sun.height);
  const moonUp =
    smoothstep(-0.02, 0.12, light.moon.height) * (1 - light.daylight);
  const body = sunUp >= moonUp ? light.sun : light.moon;
  const shine =
    Math.max(sunUp * (0.55 + 0.45 * light.twilight), 0.5 * moonUp) *
    light.direct;
  const under = skyBodyAt(camera, body);
  const glint = mix(sunUp >= moonUp ? light.sunColor : MOONLIGHT, GLINT, 0.45);
  // A low sun lays a long, wide path; a high one a short, narrow one.
  const spread = lerp(1.6, 0.7, clamp(body.height, 0, 1));

  ctx.lineCap = "round";
  for (let n = 1; n <= FAR_LINES.count; n += 1) {
    const depth = Math.pow(n / (FAR_LINES.count + 0.5), FAR_LINES.crowd);
    const row = top + (near - top) * depth;
    // Things farther off are smaller and move more slowly across the view.
    const scale = depth * camera.scale;
    // The lines swell with the sea, but never so far as to cross the lines either side.
    const apart =
      (near - top) *
      (depth - Math.pow((n - 1) / (FAR_LINES.count + 0.5), FAR_LINES.crowd));
    const wiggle = Math.min((0.06 + 0.12 * swell) * scale, 0.4 * apart);
    const drift = time * (0.6 + 0.25 * swell) * scale * 0.35;
    const path = new Path2D();
    let drawing = false;
    const step = 5;
    const halfPath = (12 + 90 * depth) * spread;
    for (let x = -step; x <= width + step; x += step) {
      const along = (x + drift) / Math.max(scale * 3.2, 6);
      const pen = valueNoise(along, n * 7.3);
      const inGlitter = shine > 0.02 && Math.abs(x - under.x) < halfPath;
      const on = pen > -0.35 && !(inGlitter && pen < 0.5);
      const y = row + wiggle * Math.sin(along * 2.1 + n) * (0.4 + 0.6 * depth);
      if (on) {
        if (drawing) {
          path.lineTo(x, y);
        } else {
          path.moveTo(x, y);
          drawing = true;
        }
      } else {
        drawing = false;
      }
    }
    ctx.lineWidth = lerp(0.55, 1.15, depth);
    ctx.strokeStyle = css(
      waters.line,
      waters.lineAlpha * lerp(0.28, 0.8, depth),
    );
    ctx.stroke(path);

    if (shine > 0.02) {
      drawGlitter(ctx, under.x, row, halfPath, depth, n, time, glint, shine);
    }
    if (wind > 7) {
      drawFarCaps(ctx, row, depth, n, time, width, waters.foam, wind);
    }
  }
  // The horizon itself, a fine line where the sea meets the sky.
  ctx.lineWidth = HORIZON_LINE.width;
  ctx.strokeStyle = css(waters.line, HORIZON_LINE.alpha * waters.lineAlpha * 2);
  ctx.beginPath();
  ctx.moveTo(0, top);
  ctx.lineTo(width, top);
  ctx.stroke();
}

/** Short bright dashes flickering on the line at `row`, within `half` CSS pixels of `x`. */
function drawGlitter(
  ctx: CanvasRenderingContext2D,
  x: number,
  row: number,
  half: number,
  depth: number,
  line: number,
  time: number,
  color: Rgb,
  shine: number,
): void {
  const count = Math.round(3 + 9 * depth);
  for (let i = 0; i < count; i += 1) {
    // Each glint lives for a moment, then another takes its place somewhere else.
    const rate = 1.6 + (i % 3) * 0.7;
    const age = time * rate + i * 0.37 + line * 0.11;
    const slot = Math.floor(age);
    const rng = new Rng(line * 9973 + i * 131 + slot * 7919);
    const u = rng.range(-1, 1);
    const at = x + u * half * (0.4 + 0.6 * rng.next());
    const life = Math.sin(Math.PI * (age - slot));
    const near = 1 - Math.abs(u);
    const alpha = shine * life * (0.35 + 0.65 * near);
    if (alpha < 0.03) {
      continue;
    }
    const length = (2 + 9 * depth) * (0.5 + rng.next());
    ctx.strokeStyle = css(color, Math.min(1, alpha));
    ctx.lineWidth = lerp(0.7, 1.6, depth);
    ctx.beginPath();
    ctx.moveTo(at - length / 2, row);
    ctx.lineTo(at + length / 2, row);
    ctx.stroke();
  }
}

/** Little whitecaps coming and going along the line at `row` far off, more the stronger the wind. */
function drawFarCaps(
  ctx: CanvasRenderingContext2D,
  row: number,
  depth: number,
  line: number,
  time: number,
  width: number,
  color: Rgb,
  wind: number,
): void {
  const count = Math.round(smoothstep(7, 24, wind) * (2 + 10 * depth));
  for (let i = 0; i < count; i += 1) {
    const age = time * 0.7 + i * 0.29 + line * 0.53;
    const slot = Math.floor(age);
    const rng = new Rng(line * 7121 + i * 389 + slot * 4513);
    const x = rng.next() * width;
    const life = Math.sin(Math.PI * (age - slot));
    const length = (1.5 + 6 * depth) * (0.6 + rng.next());
    ctx.strokeStyle = css(color, 0.75 * life);
    ctx.lineWidth = lerp(0.8, 1.8, depth);
    ctx.beginPath();
    ctx.moveTo(x - length / 2, row - 0.3);
    ctx.lineTo(x + length / 2, row - 0.3);
    ctx.stroke();
  }
}

/** The water near, worked out across the view, in device pixels. */
interface Near {
  /** World x of each point at rest. */
  xs: Float64Array;
  profile: Profile;
  /** Depths of the lines under the surface drawn, in meters, and which of the profile's depths each is. */
  lines: { depth: number; index: number }[];
  /** The surface, in device pixels, left to right. */
  surface: Point[];
  /** How far the shaped waves raise the surface at each point, in device pixels, up being negative. */
  lift: Float64Array;
}

/**
 * The sea near, in front of the land and in the same light: its water, the lines raked through
 * it, the foam on it, its breaking waves, and the water thrown up the cliff. `above` is everything
 * above the land, in device pixels, which the water is kept within; `grain` is the sand's grain.
 */
export function drawSea(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  sea: Sea,
  light: SkyLight,
  rain: number,
  above: Path2D,
  grain: CanvasPattern,
): void {
  const left = Math.max(camera.toWorld(0, 0).x, sea.coast - 1.5);
  const right = camera.toWorld(camera.width, 0).x + 1;
  if (right <= left) {
    return;
  }
  const waters = watersIn(light);
  const near = workOut(camera, sea, left, right);
  const dpr = camera.dpr;
  const bottom = camera.height * dpr + 2;
  const shaped = shapeWaves(camera, sea, near);

  // The surface, with every shaped wave set into it.
  const outline = setInto(near.surface, shaped, near.lift);
  const water = new Path2D();
  const first = at(outline, 0);
  water.moveTo(first.x - 4 * dpr, first.y);
  for (const p of outline) {
    water.lineTo(p.x, p.y);
  }
  const lastPoint = at(outline, outline.length - 1);
  water.lineTo(lastPoint.x + 4 * dpr, lastPoint.y);
  water.lineTo(lastPoint.x + 4 * dpr, bottom);
  water.lineTo(first.x - 4 * dpr, bottom);
  water.closePath();

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const level = camera.toScreen(0, sea.waterLevel).y * dpr;
  const fill = ctx.createLinearGradient(
    0,
    level - 2 * camera.scale * dpr,
    0,
    Math.max(bottom, level + 8 * camera.scale * dpr),
  );
  fill.addColorStop(0, css(mix(waters.surface, waters.far, 0.35)));
  fill.addColorStop(0.2, css(waters.surface));
  fill.addColorStop(1, css(waters.deep));
  ctx.clip(above);
  ctx.fillStyle = fill;
  ctx.fill(water);
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = GRAIN;
  ctx.fillStyle = grain;
  ctx.fill(water);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;

  ctx.clip(water);
  const lines = sea.settings.lines;
  switch (lines) {
    case "contours":
      drawContours(ctx, camera, sea, near, waters, 0);
      break;
    case "hatching":
      drawContours(ctx, camera, sea, near, waters, HATCHING.still);
      drawHatching(ctx, camera, outline, light, waters);
      break;
    default: {
      const unknown: never = lines;
      throw new Error(`Unknown way to draw the sea ${String(unknown)}.`);
    }
  }
  drawFoam(ctx, camera, sea, near, waters, shaped);
  for (const cap of whitecapsOf(camera, sea, near, shaped)) {
    drawCap(ctx, cap, waters, dpr);
  }
  ctx.restore();

  // The surface's own line, and the lips' foam, over the water's edge.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clip(above);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = WIDTH.surface * dpr;
  strokeSurface(ctx, outline, waters);
  for (const wave of shaped) {
    drawWaveFoam(ctx, wave, waters, dpr);
  }
  if (rain > 0) {
    drawRainOn(ctx, camera, sea, near, rain, waters);
  }
  ctx.restore();

  drawSurge(ctx, camera, sea, waters);
}

/**
 * Rain striking the water: little crowns of spray flicking up from the surface here and there, as
 * many as the rain is heavy, each gone in a blink.
 */
function drawRainOn(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  sea: Sea,
  near: Near,
  rain: number,
  waters: Waters,
): void {
  const dpr = camera.dpr;
  const surface = near.surface;
  const left = at(surface, 0).x;
  const right = at(surface, surface.length - 1).x;
  const count = Math.round(((rain * (right - left)) / dpr) * RAIN_ON.perPx);
  const crowns = new Path2D();
  for (let i = 0; i < count; i += 1) {
    const age = sea.clock / RAIN_ON.seconds + i * 0.618;
    const slot = Math.floor(age);
    const rng = new Rng(i * 7349 + slot * 1597);
    const x = lerp(left, right, rng.next());
    const index = indexNear(surface, x);
    const p = at(surface, index);
    const y = p.y + (near.lift[index] ?? 0);
    const life = Math.sin(Math.PI * (age - slot));
    const size = RAIN_ON.size * dpr * (0.6 + 0.6 * rng.next()) * life;
    if (size < 0.4 * dpr) {
      continue;
    }
    crowns.moveTo(x - size, y - 0.2 * size);
    crowns.lineTo(x - 0.35 * size, y - size);
    crowns.moveTo(x + size, y - 0.2 * size);
    crowns.lineTo(x + 0.35 * size, y - size);
  }
  ctx.lineCap = "round";
  ctx.lineWidth = 0.9 * dpr;
  ctx.strokeStyle = css(waters.foam, 0.8);
  ctx.stroke(crowns);
}

/** Works the water out at points across the view, `left` to `right` in world meters. */
function workOut(camera: Camera, sea: Sea, left: number, right: number): Near {
  const step = STEP_PX / camera.scale;
  const count = Math.max(2, Math.ceil((right - left) / step) + 1);
  const xs = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    xs[i] = left + i * step;
  }
  const lines: { depth: number; index: number }[] = [];
  const depths = [0, ...FOAM_LINES.map((foam) => foam.depth)];
  let lastPx = -Infinity;
  for (let k = 0; k < CONTOURS.count; k += 1) {
    const depth = CONTOURS.first * Math.pow(CONTOURS.deeper, k);
    const px = depth * camera.scale;
    const row = camera.toScreen(0, sea.waterLevel - depth).y;
    if (row > camera.height + 40) {
      break;
    }
    if (px - lastPx >= CONTOURS.apart) {
      lines.push({ depth, index: depths.length });
      depths.push(depth);
      lastPx = px;
    }
  }
  const profile = sea.profile(xs, depths);
  const heights = at(profile.heights, 0);
  const shifts = at(profile.shifts, 0);
  const surface: Point[] = [];
  let lastX = -Infinity;
  for (let i = 0; i < count; i += 1) {
    const p = camera.toScreen(
      (xs[i] ?? 0) + (shifts[i] ?? 0),
      sea.waterLevel + (heights[i] ?? 0),
    );
    // The swing never carries water past the water ahead of it.
    const x = Math.max(p.x * camera.dpr, lastX + 0.05);
    surface.push({ x, y: p.y * camera.dpr });
    lastX = x;
  }
  return { xs, profile, lines, surface, lift: new Float64Array(count) };
}

/** Index of the point of `surface`, which runs left to right, nearest `x`. */
function indexNear(surface: readonly Point[], x: number): number {
  let low = 0;
  let high = surface.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (at(surface, middle).x < x) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return Math.abs(at(surface, low).x - x) <= Math.abs(at(surface, high).x - x)
    ? low
    : high;
}

/**
 * A wave drawn to its own shape over the surface: one steepening as it nears breaking, or a
 * breaker pitching its lip over, its tube filling with foam as the lip lands, and rolling on as a
 * front of foam.
 */
interface Shaped {
  id: number;
  /** Which way it runs across the view: -1 to the left, 1 to the right. */
  heading: -1 | 1;
  /** Its height, in device pixels. */
  height: number;
  /** How much of its shape is set over the surface, from 0 to 1, as a wave nears breaking. */
  blend: number;
  /** The surface it stands in place of points `from` to `to`, in the order it runs. */
  run: Edge[];
  from: number;
  to: number;
  /** Its body, without lip or tube, which the water under it rises and falls with. */
  body: Point[];
  /** The points of the surface its face stands over, from its crest to the trough ahead. */
  face: { from: number; to: number };
  /** Foam over it: along its lip, filling its tube, or rolling down its face. */
  foam: Foam[];
  /** Claws of foam reaching on from its lip. */
  claws: Path2D[];
}

/**
 * A shape of foam: its outer edge, along the surface, and its inner edge, back through the water;
 * how strongly it shows, and how strongly its inner edge is inked, each from 0 to 1.
 */
interface Foam {
  outer: Point[];
  inner: Point[];
  alpha: number;
  inked: number;
  /** Whether its outer edge is the surface, lined as the surface is. */
  edged: boolean;
}

/** What a wave to be shaped is: where its crest stands and how far it is through breaking. */
interface Subject {
  id: number;
  heading: -1 | 1;
  /** Where its crest stands across the view, and its height, in device pixels. */
  x: number;
  height: number;
  /** How steep it stands as it nears breaking, from 0 to 1. */
  steep: number;
  /** How far through breaking it is, if it has broken. */
  breaking: number | undefined;
  blend: number;
  /** Foam spilling down its face, from 0 to 1. */
  spill: number;
}

/**
 * Shapes every wave nearing breaking, and every breaker, in device pixels over `near`'s surface,
 * from the furthest left to the furthest right, leaving out any that would overlap one that shows
 * more.
 */
function shapeWaves(camera: Camera, sea: Sea, near: Near): Shaped[] {
  const px = camera.scale * camera.dpr;
  const across = (x: number): number => camera.toScreen(x, 0).x * camera.dpr;
  const subjects: Subject[] = [];
  for (const crest of sea.crests) {
    if (crest.poise > 0.02 && !crest.broken) {
      subjects.push({
        id: crest.id,
        heading: crest.heading,
        x: across(crest.x),
        height: crest.height * px,
        steep: WAVE.poised * crest.poise,
        breaking: undefined,
        blend: smoothstep(0.02, 0.45, crest.poise),
        spill: crest.cap,
      });
    }
  }
  for (const breaker of sea.breakers) {
    subjects.push({
      id: breaker.id,
      heading: breaker.heading,
      x: across(breaker.x),
      height: breaker.height * px,
      steep: WAVE.poised,
      breaking: breaker.breaking,
      blend: 1,
      spill: 0,
    });
  }
  const shaped: Shaped[] = [];
  for (const subject of subjects) {
    const wave = shape(near.surface, subject, sea.clock, camera.dpr);
    if (wave !== undefined) {
      shaped.push(wave);
    }
  }
  // Where two would overlap, the one that shows more is drawn.
  shaped.sort((a, b) => b.height * b.blend - a.height * a.blend);
  const kept: Shaped[] = [];
  for (const wave of shaped) {
    if (
      wave.blend > 0.01 &&
      kept.every((other) => wave.to < other.from || wave.from > other.to)
    ) {
      kept.push(wave);
    }
  }
  kept.sort((a, b) => a.from - b.from);
  for (const wave of kept) {
    raise(near, wave);
  }
  return kept;
}

/**
 * Notes how far `wave`'s body raises or lowers the surface at each point it covers, by as much of
 * its shape as is set over the surface, so the water under it can rise and fall with it.
 */
function raise(near: Near, wave: Shaped): void {
  const body = wave.body;
  for (let i = wave.from; i <= wave.to; i += 1) {
    const p = at(near.surface, i);
    // The highest point of the body over this point.
    let top = Infinity;
    for (let j = 0; j + 1 < body.length; j += 1) {
      const a = at(body, j);
      const b = at(body, j + 1);
      if ((a.x - p.x) * (b.x - p.x) <= 0 && a.x !== b.x) {
        top = Math.min(top, lerp(a.y, b.y, (p.x - a.x) / (b.x - a.x)));
      }
    }
    if (top < Infinity) {
      near.lift[i] = wave.blend * (top - p.y);
    }
  }
}

/**
 * Shapes `subject` over `surface`, in device pixels. Every part of the shape grows smoothly from
 * nothing and passes smoothly into the next, so a wave never jumps from one frame to the next:
 *
 * - Nearing breaking, its back draws out long and its crest runs on and rises as its face steepens
 *   and hollows, sweeping out level into the trough ahead.
 * - Breaking, its crest pitches over and throws a lip out ahead, which grows from nothing out of
 *   the crest itself, arcs on and down, and lands on the water ahead, foam spreading back along it
 *   from its tip and claws of foam reaching from it.
 * - As the lip lands, the tube under it fills with foam, and the whole wave then rolls on as a
 *   rounded front of foam, its shape passing point for point from the curl into the roll.
 */
function shape(
  surface: readonly Point[],
  subject: Subject,
  clock: number,
  dpr: number,
): Shaped | undefined {
  const { heading: h, height: H } = subject;
  if (H < 3) {
    return undefined;
  }
  const b = subject.breaking ?? 0;
  const broken = subject.breaking !== undefined;
  const pitch = broken ? smoothstep(...BREAKER.pitch, b) : 0;
  const throwing = broken ? smoothstep(...BREAKER.throw, b) : 0;
  const landing = broken ? smoothstep(...BREAKER.land, b) : 0;
  const closing = broken ? smoothstep(...BREAKER.close, b) : 0;
  const rolling = broken ? smoothstep(...BREAKER.roll, b) : 0;
  const steep = broken ? lerp(WAVE.poised, 1, pitch) : subject.steep;

  // Its back and face reach from the surface and back to it, held within the surface worked out.
  const inside = (i: number): number => clamp(i, 1, surface.length - 2);
  const x = subject.x;
  const iBack = inside(indexNear(surface, x - h * WAVE.back * H));
  const toe = lerp(WAVE.face.gentle, WAVE.face.steep, steep);
  const iAhead = inside(indexNear(surface, x + h * toe * H));
  const iCrest = indexNear(surface, x);
  if (
    iBack === iAhead ||
    iCrest <= 1 ||
    iCrest >= surface.length - 2 ||
    (iCrest - iBack) * h <= 0 ||
    (iAhead - iCrest) * h <= 0
  ) {
    return undefined;
  }
  const back = at(surface, iBack);
  const ahead = at(surface, iAhead);
  const level = ahead.y;
  // In multiples of its height: on the way it runs, and up from the water ahead.
  const local = (u: number, v: number): Point => ({
    x: x + h * u * H,
    y: level - v * H,
  });
  const crestU = WAVE.run * steep;
  const crest = local(crestU, 1 + WAVE.rise * steep);
  crest.y = Math.min(crest.y, back.y - 0.3 * H);
  const crestV = (level - crest.y) / H;

  const backCurve = bezier(
    back,
    { x: back.x + h * 0.55 * Math.abs(crest.x - back.x), y: back.y },
    { x: crest.x - h * H * lerp(1.5, 0.55, steep), y: crest.y },
    crest,
    24,
  );

  // The curl: the top of the face rolling over on itself, then plunging onto the water ahead.
  const lip =
    throwing * H > 0.5 * dpr
      ? curlOf(local, crestU, crestV, throwing, landing, H, h)
      : undefined;
  const tip = lip === undefined ? crest : at(lip.outer, lip.outer.length - 1);
  const root = lip === undefined ? crest : at(lip.inner, 0);

  // The face: falling from the crest, or from under the lip, hollowing as it stands upright until
  // it drops straight from the crest, a little under it as the crest pitches over, and sweeps out
  // level into the trough ahead.
  const faceCurve = bezier(
    root,
    {
      x: root.x + h * H * (lerp(0.9, 0, steep) - 0.08 * pitch),
      y: root.y + H * lerp(0.15, 0.5, steep),
    },
    {
      x: ahead.x - h * H * lerp(0.6, 0.55, steep),
      y: ahead.y - H * lerp(0.15, 0, steep),
    },
    ahead,
    18,
  );

  const edge = (points: readonly Point[], hollow = 0, ink = 1): Edge[] =>
    points.map((p) => ({ x: p.x, y: p.y, hollow, ink }));
  const shaped = {
    id: subject.id,
    heading: h,
    height: H,
    blend: subject.blend,
  };

  const splash = splashOf(tip, subject.id, b, H, h, clock, dpr);
  if (lip === undefined || closing < 1) {
    // Standing or curling: the water runs out along the lip and back into its tube. As the lip
    // lands the tube closes, the hollow under it shrinking away into the water as the lip meets
    // the water ahead.
    const foam: Foam[] = [];
    const claws: Path2D[] = [...splash];
    if (lip !== undefined) {
      foam.push(lipFoam(lip, throwing, closing, b));
      claws.push(
        ...clawsOf(lip, subject.id, throwing, closing, H, h, clock, dpr),
      );
    }
    if (subject.spill > 0.04) {
      foam.push(spillOf(backCurve, faceCurve, subject.spill, H, clock));
    }
    const hollow =
      lip === undefined
        ? edge(faceCurve.slice(1))
        : edge(
            blendPaths(
              [
                tip,
                ...[...lip.inner].reverse().slice(1),
                ...faceCurve.slice(1),
              ],
              [tip, ...beneath(surface, iAhead, tip, h).reverse(), ahead],
              closing,
              SAMPLES.outline,
            ).slice(1),
            throwing * (1 - closing),
            1 - closing,
          );
    const run: Edge[] = [
      ...edge(backCurve),
      ...(lip === undefined ? [] : edge(lip.outer.slice(1))),
      ...hollow,
    ];
    return {
      ...shaped,
      run: h > 0 ? run : run.reverse(),
      from: Math.min(iBack, iAhead),
      to: Math.max(iBack, iAhead),
      body: [...backCurve, ...faceCurve],
      face: {
        from: Math.min(iCrest, iAhead),
        to: Math.max(iCrest, iAhead),
      },
      foam,
      claws,
    };
  }

  // Closed: the curl, its tube gone, rolls into a rounded front of foam.
  const curled = [...backCurve, ...lip.outer.slice(1)];
  const crestRoll = local(crestU + BORE.on, crestV * BORE.rise);
  const backRoll = bezier(
    back,
    { x: back.x + h * 0.55 * Math.abs(crestRoll.x - back.x), y: back.y },
    { x: crestRoll.x - h * H * BORE.round, y: crestRoll.y },
    crestRoll,
    24,
  );
  const frontRoll = bezier(
    crestRoll,
    { x: crestRoll.x + h * H * 0.3, y: crestRoll.y },
    { x: tip.x - h * H * 0.1, y: tip.y - H * 0.55 },
    tip,
    18,
  );
  const rolled = [...backRoll, ...frontRoll.slice(1)];
  const outline = blendPaths(curled, rolled, rolling, SAMPLES.outline);
  // The foam: the lip, foam all through, passing into a roll of foam over the crest and down the
  // front.
  const startRoll = arcFrom(rolled, BORE.foamBack * H, crestRoll);
  const rollOuter = rolled.slice(startRoll);
  const rollInner = scallops(rollOuter, BORE.foam * H, clock, subject.id);
  const landed = lipFoam(lip, 1, 1, b);
  const foam: Foam = {
    outer: blendPaths(landed.outer, rollOuter, rolling, SAMPLES.foam),
    inner: blendPaths(landed.inner, rollInner, rolling, SAMPLES.foam),
    alpha: 1,
    inked: lerp(0, 0.9, rolling),
    edged: true,
  };
  const end = indexNear(surface, at(outline, outline.length - 1).x);
  return {
    ...shaped,
    run: edge(h > 0 ? outline : [...outline].reverse()),
    from: Math.min(iBack, end),
    to: Math.max(iBack, end),
    body: outline,
    face: { from: Math.min(iCrest, end), to: Math.max(iCrest, end) },
    foam: [foam],
    claws: [
      ...splash,
      ...tumbling(rollOuter, subject.id, rolling, H, h, clock, dpr),
    ],
  };
}

/**
 * Little claws of foam tumbling over the front of a breaker `rolling` of the way into a roll, along
 * `front` from its crest down to the water: each curling on over the way it runs and turning over
 * as the foam rolls.
 */
function tumbling(
  front: readonly Point[],
  id: number,
  rolling: number,
  height: number,
  h: -1 | 1,
  clock: number,
  dpr: number,
): Path2D[] {
  if (rolling <= 0.01 || front.length < 4) {
    return [];
  }
  const rng = new Rng(id * 4243);
  const claws: Path2D[] = [];
  for (let k = 0; k < TUMBLE.claws; k += 1) {
    const s = lerp(TUMBLE.from, TUMBLE.to, k / (TUMBLE.claws - 1));
    const i = Math.min(front.length - 2, Math.round(s * (front.length - 1)));
    const p = at(front, i);
    const q = at(front, i + 1);
    const along = Math.atan2(q.y - p.y, q.x - p.x);
    // Out from the front, turning over and back as the foam tumbles.
    const turn = Math.sin(clock * TUMBLE.rate + k * 2.1 + id) * 0.35;
    const out = along - h * (Math.PI / 2) + h * 0.4 + turn;
    const length =
      height * TUMBLE.length * rolling * lerp(0.7, 1.2, rng.next());
    const width = Math.max(1.2 * dpr, length * 0.3);
    claws.push(clawPath(p, out, length, width, h, rng.next()));
  }
  return claws;
}

/**
 * Foam bursting up where a lip lands, `b` through breaking: a crown of fingers flung up from the
 * lip's tip on the water, rising and curling on the way the wave runs, then falling back into the
 * foam.
 */
function splashOf(
  tip: Point,
  id: number,
  b: number,
  height: number,
  h: -1 | 1,
  clock: number,
  dpr: number,
): Path2D[] {
  const burst = Math.sin(
    Math.PI * clamp((b - SPLASH.from) / SPLASH.lasts, 0, 1),
  );
  if (burst <= 0.01) {
    return [];
  }
  const rng = new Rng(id * 7919);
  const fingers: Path2D[] = [];
  for (let k = 0; k < SPLASH.fingers; k += 1) {
    const t = k / (SPLASH.fingers - 1);
    // From leaning back a little to leaning well on, the way the wave runs.
    const angle =
      -Math.PI / 2 + h * lerp(-0.35, 1.05, t) + 0.1 * Math.sin(clock * 4 + k);
    const length =
      height *
      SPLASH.length *
      burst *
      lerp(0.6, 1.15, rng.next()) *
      (1 - 0.35 * Math.abs(t - 0.4));
    const width = Math.max(1.2 * dpr, length * 0.24);
    fingers.push(clawPath(tip, angle, length, width, h, rng.next()));
  }
  return fingers;
}

/**
 * The points of `surface` from just past `from` on to below `tip`, the way the wave runs `h`: the
 * water ahead of its face, under its lip.
 */
function beneath(
  surface: readonly Point[],
  from: number,
  tip: Point,
  h: -1 | 1,
): Point[] {
  const points: Point[] = [];
  for (
    let i = from + h;
    i > 0 && i < surface.length - 1 && (tip.x - at(surface, i).x) * h > 0;
    i += h
  ) {
    points.push(at(surface, i));
  }
  return points;
}

/** Points along the cubic Bézier curve from `a` to `d`, `count` steps. */
function bezier(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  count: number,
): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const s = 1 - t;
    points.push({
      x:
        s * s * s * a.x +
        3 * s * s * t * b.x +
        3 * s * t * t * c.x +
        t * t * t * d.x,
      y:
        s * s * s * a.y +
        3 * s * s * t * b.y +
        3 * s * t * t * c.y +
        t * t * t * d.y,
    });
  }
  return points;
}

/**
 * The curl of a wave cresting `crestV` heights above the water ahead, `crestU` heights on, grown
 * `g` of the way and plunged `landing` of the way onto the water ahead, in device pixels: the top
 * of its face rolling forward as a round dome whose nose drops as it comes over and whose tip
 * hooks back under it, then reaching on and down onto the water as it plunges. Every point starts
 * at the crest, so the curl grows from nothing out of the crest itself.
 *
 * Its outer edge runs from the crest over the dome and around the hook to the tip; its inner edge
 * from its root, where the face below meets it, up into the tube under the dome and out to the tip;
 * and its underside, point for point with its outer edge, bounds the foam along it.
 */
function curlOf(
  local: (u: number, v: number) => Point,
  crestU: number,
  crestV: number,
  g: number,
  landing: number,
  height: number,
  h: -1 | 1,
): Lip {
  const nose = {
    u: crestU + CURL.nose.on * g + CURL.nose.plunges * landing,
    v: crestV - CURL.nose.drops * g - CURL.nose.sinks * landing,
  };
  const tip = {
    u: lerp(nose.u - CURL.tip.under * g, nose.u + CURL.tip.lands, landing),
    v: lerp(nose.v - CURL.tip.drops * g, 0, landing),
  };
  const tube = {
    u: nose.u - CURL.tube.under * g,
    v: nose.v + CURL.tube.up * g,
  };
  const root = {
    u: crestU - CURL.root.under * g,
    v: crestV - CURL.root.drops * g,
  };
  // Cubic curves given in heights, on and up, drawn in device pixels.
  const curve = (
    a: { u: number; v: number },
    b: { u: number; v: number },
    c: { u: number; v: number },
    d: { u: number; v: number },
    count: number,
  ): Point[] =>
    bezier(
      local(a.u, a.v),
      local(b.u, b.v),
      local(c.u, c.v),
      local(d.u, d.v),
      count,
    );
  const crest = { u: crestU, v: crestV };
  // Over the dome, leaving the crest level and arriving at the nose heading straight down.
  const dome = curve(
    crest,
    { u: crestU + 0.6 * (nose.u - crestU), v: crestV },
    { u: nose.u, v: nose.v + 0.6 * (crestV - nose.v) },
    nose,
    SAMPLES.dome,
  );
  // Around the hook, falling from the nose and curling back under to the tip, or, as it plunges,
  // reaching on down to the water.
  const fall = Math.max(nose.v - tip.v, 0.05 * g);
  const hook = curve(
    nose,
    { u: nose.u, v: nose.v - 0.5 * fall },
    {
      u: tip.u + lerp(0.1 * g, -0.05, landing),
      v: tip.v + lerp(0, 0.3, landing),
    },
    tip,
    SAMPLES.hook,
  );
  const outer = [...dome, ...hook.slice(1)];
  // Up from the root into the tube under the dome, then on out to the tip.
  const inner = [
    ...curve(
      root,
      { u: root.u, v: root.v + 0.25 * g },
      { u: tube.u - 0.15 * g, v: tube.v },
      tube,
      SAMPLES.dome,
    ),
    ...curve(
      tube,
      { u: tube.u + 0.12 * g, v: tube.v },
      {
        u: tip.u + lerp(-0.02 * g, -0.15, landing),
        v: tip.v + lerp(0.12 * g, 0.2, landing),
      },
      tip,
      SAMPLES.hook,
    ).slice(1),
  ];
  // The foam's underside: in from the outer edge, thickest over the nose, thin at either end.
  const offset = outer.map((p, i) => {
    const s = i / (outer.length - 1);
    const before = at(outer, Math.max(0, i - 1));
    const after = at(outer, Math.min(outer.length - 1, i + 1));
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const span = Math.hypot(dx, dy) || 1;
    const thick =
      CURL.foam *
      height *
      g *
      smoothstep(0, 0.3, s) *
      (1 - 0.6 * smoothstep(0.75, 1, s));
    return {
      x: p.x - (h * dy * thick) / span,
      y: p.y + (h * dx * thick) / span,
    };
  });
  return { outer, inner, offset };
}

/**
 * Foam along a lip `throwing` of the way thrown and `closing` of the way to filling its tube,
 * `b` through breaking: spreading back from the tip as it curls, and thickening until the whole
 * lip is foam as the tube fills.
 */
function lipFoam(lip: Lip, throwing: number, closing: number, b: number): Foam {
  const spread = lerp(0.3, 1, smoothstep(0.05, 0.45, b));
  const count = lip.outer.length;
  const outer: Point[] = [];
  const inner: Point[] = [];
  for (let i = 0; i < count; i += 1) {
    const s = i / (count - 1);
    // Thin where the foam is just reaching, full along the rest.
    const reach = smoothstep(1 - spread, 1 - spread + 0.25, s);
    const depth =
      reach * lerp(BREAKER.foam, 1, closing) * smoothstep(0, 0.3, s);
    const o = at(lip.outer, i);
    const n = at(lip.offset, i);
    outer.push(o);
    inner.push({ x: lerp(o.x, n.x, depth), y: lerp(o.y, n.y, depth) });
  }
  return {
    outer,
    inner: inner.reverse(),
    alpha: smoothstep(0, 0.15, throwing),
    inked: 0.7 * (1 - closing),
    edged: true,
  };
}

/**
 * Claws of foam reaching on from a lip `throwing` of the way thrown, for a wave `height` device
 * pixels high: as many as the wave's own, each growing from nothing as the lip curls, swaying, and
 * shrinking back into the foam as its tube fills.
 */
function clawsOf(
  lip: Lip,
  id: number,
  throwing: number,
  closing: number,
  height: number,
  h: -1 | 1,
  clock: number,
  dpr: number,
): Path2D[] {
  const grown = smoothstep(0.15, 0.85, throwing) * (1 - closing);
  if (grown <= 0.01) {
    return [];
  }
  const count = CLAWS.least + (id % 2);
  const rng = new Rng(id * 977);
  const claws: Path2D[] = [];
  const outer = lip.outer;
  for (let k = 0; k < count; k += 1) {
    const s = lerp(CLAWS.from, CLAWS.to, count === 1 ? 1 : k / (count - 1));
    const i = Math.min(outer.length - 2, Math.round(s * (outer.length - 1)));
    const p = at(outer, i);
    const q = at(outer, i + 1);
    // Out from the lip, leaning on the way it runs, and swaying a little.
    const along = Math.atan2(q.y - p.y, q.x - p.x);
    const out = along - h * (Math.PI / 2) + h * CLAWS.lean;
    const sway = 0.12 * Math.sin(clock * 3.1 + id + k * 1.7);
    const length = height * CLAWS.length * grown * lerp(0.7, 1.2, rng.next());
    const width = Math.max(1.2 * dpr, length * 0.3);
    claws.push(clawPath(p, out + sway, length, width, h, rng.next()));
  }
  return claws;
}

/**
 * Foam spilling down the face of a wave too small to curl, `amount` of it, over its crest from a
 * little way down its back to partway down its face.
 */
function spillOf(
  back: readonly Point[],
  face: readonly Point[],
  amount: number,
  height: number,
  clock: number,
): Foam {
  const outer = [
    ...back.slice(Math.floor(back.length * 0.8)),
    ...face.slice(1, Math.ceil(face.length * 0.45)),
  ];
  return {
    outer,
    inner: scallops(outer, height * 0.22 * amount, clock, 0),
    alpha: amount,
    inked: amount,
    edged: true,
  };
}

/**
 * The inner edge of foam lying `thick` device pixels deep along `outer`: thickest a little ahead
 * of its middle, thinning to nothing at either end, its underside scalloped, the scallops rolling
 * on as the foam tumbles. Runs back from the end of `outer` to its start.
 */
function scallops(
  outer: readonly Point[],
  thick: number,
  clock: number,
  seed: number,
): Point[] {
  const count = outer.length;
  const bumps = 4 + (seed % 2);
  const inner: Point[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const t = i / Math.max(1, count - 1);
    const p = at(outer, i);
    const before = at(outer, Math.max(0, i - 1));
    const after = at(outer, Math.min(count - 1, i + 1));
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const span = Math.hypot(dx, dy) || 1;
    const swell = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.8);
    const scallop =
      0.55 + 0.45 * Math.abs(Math.cos(Math.PI * (bumps * t - clock * 0.6)));
    const depth = thick * swell * scallop;
    // Into the water, square to the surface there.
    const sign = dx >= 0 ? 1 : -1;
    inner.push({
      x: p.x - (sign * dy * depth) / span,
      y: p.y + (sign * dx * depth) / span,
    });
  }
  return inner;
}

/** The index of the point of `path` whose distance from its start first passes that of `mark`, less `before` device pixels. */
function arcFrom(path: readonly Point[], before: number, mark: Point): number {
  let markAt = 0;
  let best = Infinity;
  let travelled = 0;
  const along: number[] = [0];
  for (let i = 1; i < path.length; i += 1) {
    travelled += distance(at(path, i - 1), at(path, i));
    along.push(travelled);
  }
  for (const [i, p] of path.entries()) {
    const d = distance(p, mark);
    if (d < best) {
      best = d;
      markAt = at(along, i);
    }
  }
  const target = markAt - before;
  return Math.max(
    0,
    along.findIndex((a) => a >= target),
  );
}

/** `count` points spaced evenly along the path through `points`. */
function resample(points: readonly Point[], count: number): Point[] {
  invariant(points.length > 0, "Cannot space points along an empty path.");
  const along: number[] = [0];
  for (let i = 1; i < points.length; i += 1) {
    along.push(at(along, i - 1) + distance(at(points, i - 1), at(points, i)));
  }
  const total = at(along, along.length - 1);
  const out: Point[] = [];
  let j = 0;
  for (let k = 0; k < count; k += 1) {
    const target = (total * k) / Math.max(1, count - 1);
    while (j < along.length - 2 && at(along, j + 1) < target) {
      j += 1;
    }
    const a = at(points, j);
    const b = at(points, Math.min(points.length - 1, j + 1));
    const span = at(along, Math.min(along.length - 1, j + 1)) - at(along, j);
    const f = span > 1e-9 ? clamp((target - at(along, j)) / span, 0, 1) : 0;
    out.push({ x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) });
  }
  return out;
}

/** The path a fraction `t` of the way from `from` to `to`, each spaced evenly over `count` points. */
function blendPaths(
  from: readonly Point[],
  to: readonly Point[],
  t: number,
  count: number,
): Point[] {
  const a = resample(from, count);
  const b = resample(to, count);
  return a.map((p, i) => {
    const q = at(b, i);
    return { x: lerp(p.x, q.x, t), y: lerp(p.y, q.y, t) };
  });
}

/**
 * A curling lip: its outer edge from the crest out to its tip, its inner edge from its root out to
 * its tip, and its underside point for point with its outer edge.
 */
interface Lip {
  outer: Point[];
  inner: Point[];
  offset: Point[];
}

/**
 * A point of the surface as drawn: how deep in the hollow under a curling lip it lies, and how
 * strongly the surface's line is drawn through it, each from 0 to 1.
 */
interface Edge extends Point {
  hollow: number;
  ink: number;
}

/** The surface with every shaped wave set into it in place of the points it covers. */
function setInto(
  surface: readonly Point[],
  shaped: readonly Shaped[],
  lift: Float64Array,
): Edge[] {
  const open = (points: readonly Point[]): Edge[] =>
    points.map((p) => ({ x: p.x, y: p.y, hollow: 0, ink: 1 }));
  const out: Edge[] = [];
  let i = 0;
  for (const wave of shaped) {
    out.push(...open(surface.slice(i, wave.from)));
    if (wave.blend < 1) {
      // Not yet breaking: the surface rises toward the wave's shape, point for point.
      for (let j = wave.from; j <= wave.to; j += 1) {
        const p = at(surface, j);
        out.push({ x: p.x, y: p.y + (lift[j] ?? 0), hollow: 0, ink: 1 });
      }
    } else {
      out.push(...wave.run);
    }
    i = wave.to + 1;
  }
  out.push(...open(surface.slice(i)));
  return out;
}

/** Foam over the shaped waves: white, its inner edge inked, and the claws reaching from the lips. */
function drawWaveFoam(
  ctx: CanvasRenderingContext2D,
  wave: Shaped,
  waters: Waters,
  dpr: number,
): void {
  for (const foam of wave.foam) {
    if (foam.alpha <= 0.01 || foam.outer.length < 2) {
      continue;
    }
    const shape = new Path2D();
    const all = [...foam.outer, ...foam.inner];
    shape.moveTo(at(all, 0).x, at(all, 0).y);
    for (const p of all) {
      shape.lineTo(p.x, p.y);
    }
    shape.closePath();
    ctx.fillStyle = css(waters.foam, foam.alpha);
    ctx.fill(shape);
    if (foam.inked > 0.01 && foam.inner.length > 1) {
      ctx.lineWidth = 0.85 * dpr;
      ctx.strokeStyle = css(
        waters.line,
        waters.lineAlpha * foam.inked * foam.alpha,
      );
      ctx.stroke(polyline(foam.inner));
    }
    if (foam.edged) {
      ctx.lineWidth = WIDTH.surface * dpr;
      ctx.strokeStyle = css(waters.line, waters.lineAlpha * 1.1 * foam.alpha);
      ctx.stroke(polyline(foam.outer));
    }
  }
  for (const claw of wave.claws) {
    ctx.fillStyle = css(waters.foam, 0.97);
    ctx.fill(claw);
    ctx.lineWidth = 0.7 * dpr;
    ctx.strokeStyle = css(waters.line, waters.lineAlpha * 0.9);
    ctx.stroke(claw);
  }
}

/**
 * Hatching just under the surface wherever it is turned from the light, like the mountains' shaded
 * faces: every other line as it falls into half shade, the lines between in full shade, and the
 * hollow under a curling lip shaded deepest. A few faint lines lie still far down.
 */
function drawHatching(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  outline: readonly Edge[],
  light: SkyLight,
  waters: Waters,
): void {
  const dpr = camera.dpr;
  const sunUp = smoothstep(-0.04, 0.1, light.sun.height);
  const moonUp = smoothstep(-0.04, 0.1, light.moon.height);
  const gap = HATCHING.gap * dpr;
  const sparse = new Path2D();
  const dense = new Path2D();
  let travelled = 0;
  let line = 0;
  for (let i = 0; i + 1 < outline.length; i += 1) {
    const a = at(outline, i);
    const b = at(outline, i + 1);
    const length = distance(a, b);
    if (length < 1e-6) {
      continue;
    }
    // Out of the water, square to the surface.
    const nx = (b.y - a.y) / length;
    const ny = -(b.x - a.x) / length;
    const facing = (body: { along: number; height: number }): number => {
      const angle = Math.PI * (1 - clamp(body.along, 0, 1));
      const lit = nx * Math.cos(angle) - ny * Math.sin(angle);
      return 1 - clamp((lit + HATCHING.wrap) / (1 + HATCHING.wrap), 0, 1);
    };
    const byLight = lerp(
      lerp(0.5, facing(light.moon), moonUp),
      facing(light.sun),
      sunUp,
    );
    const shade = Math.max(
      lerp(HATCHING.overcast, byLight, light.direct),
      a.hollow * 0.95,
    );
    travelled += length;
    while (travelled >= gap) {
      travelled -= gap;
      line += 1;
      const thin = smoothstep(...HATCHING.sparse, shade);
      if (thin <= 0.02) {
        continue;
      }
      const full = smoothstep(...HATCHING.dense, shade);
      const path = line % 2 === 0 ? sparse : dense;
      if (path === dense && full <= 0.02) {
        continue;
      }
      const t = 1 - travelled / length;
      const x = lerp(a.x, b.x, t);
      const y = lerp(a.y, b.y, t);
      // Into the water, leaning off square toward where the surface runs.
      const into = Math.atan2(-ny, -nx) + HATCHING.lean;
      const reach =
        Math.max(HATCHING.least, HATCHING.depth * camera.scale) *
        dpr *
        (0.55 + 0.45 * shade);
      path.moveTo(x - nx * 1.5 * dpr, y - ny * 1.5 * dpr);
      path.lineTo(x + Math.cos(into) * reach, y + Math.sin(into) * reach);
    }
  }
  ctx.lineCap = "butt";
  ctx.lineWidth = HATCHING.width * dpr;
  ctx.strokeStyle = css(waters.line, waters.lineAlpha * HATCHING.strength);
  ctx.stroke(sparse);
  ctx.stroke(dense);
}

/** The surface's line along `outline`, drawn as strongly through each point as it asks. */
function strokeSurface(
  ctx: CanvasRenderingContext2D,
  outline: readonly Edge[],
  waters: Waters,
): void {
  let from = 0;
  for (let i = 1; i <= outline.length; i += 1) {
    const ink = at(outline, from).ink;
    if (i < outline.length && Math.abs(at(outline, i).ink - ink) < 0.01) {
      continue;
    }
    if (ink > 0.01) {
      ctx.strokeStyle = css(waters.line, waters.lineAlpha * 1.1 * ink);
      ctx.stroke(
        polyline(outline.slice(from, Math.min(outline.length, i + 1))),
      );
    }
    from = i;
  }
}

/** A path through `points`. */
function polyline(points: readonly Point[]): Path2D {
  const path = new Path2D();
  for (const [i, p] of points.entries()) {
    if (i === 0) {
      path.moveTo(p.x, p.y);
    } else {
      path.lineTo(p.x, p.y);
    }
  }
  return path;
}

/**
 * Lines raked through the water under the surface, each swinging with the water at its depth, so
 * the waves' motion fades into stillness the deeper they lie. Only those deeper than `from` meters,
 * and fainter, when hatching shades the water above them.
 */
function drawContours(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  sea: Sea,
  near: Near,
  waters: Waters,
  from: number,
): void {
  const dpr = camera.dpr;
  const drift = sea.clock * 0.04 * sea.wind;
  const faint = from > 0 ? 0.5 : 1;
  for (const [k, { depth, index }] of near.lines.entries()) {
    if (depth < from) {
      continue;
    }
    const heights = at(near.profile.heights, index);
    const shifts = at(near.profile.shifts, index);
    const fade = 1 - 0.7 * smoothstep(0.2, 5, depth);
    const width = lerp(WIDTH.near, WIDTH.deep, smoothstep(0.2, 4, depth)) * dpr;
    const follow = Math.exp(-depth / LIFT_DEPTH);
    const lift = softened(
      near.lift,
      Math.max(2, Math.round(((LIFT_SOFT + depth) * camera.scale) / STEP_PX)),
    );
    const points: Point[] = [];
    const pens: number[] = [];
    for (let i = 0; i < near.xs.length; i += 1) {
      const x = near.xs[i] ?? 0;
      const p = camera.toScreen(
        x + (shifts[i] ?? 0),
        sea.waterLevel - depth + (heights[i] ?? 0),
      );
      points.push({
        x: p.x * dpr,
        y: p.y * dpr + (lift[i] ?? 0) * follow,
      });
      // Long strokes with short gaps, which keep their place in the water as it swings.
      const along = (x - drift) / (2.6 + 0.9 * (k % 3));
      const pen = valueNoise(along, 17 + k * 3.1);
      pens.push(smoothstep(-0.55, -0.2, pen));
    }
    ctx.fillStyle = css(waters.line, waters.lineAlpha * fade * faint);
    ctx.fill(ribbons(points, pens, width));
  }
}

/**
 * Foam lying on the water: pale lines just under the surface, more of them where more foam lies,
 * except down the steep faces of the `shaped` waves, which carry foam of their own.
 */
function drawFoam(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  sea: Sea,
  near: Near,
  waters: Waters,
  shaped: readonly Shaped[],
): void {
  const dpr = camera.dpr;
  const foam = near.xs.map((x, i) =>
    shaped.some((w) => i >= w.face.from && i <= w.face.to) ? 0 : sea.foamAt(x),
  );
  const lift = softened(
    near.lift,
    Math.max(1, Math.round((0.1 * camera.scale) / STEP_PX)),
  );
  if (!foam.some((f) => f > 0.03)) {
    return;
  }
  for (const [k, { depth, needs }] of FOAM_LINES.entries()) {
    const heights = at(near.profile.heights, k + 1);
    const shifts = at(near.profile.shifts, k + 1);
    const points: Point[] = [];
    const pens: number[] = [];
    for (let i = 0; i < near.xs.length; i += 1) {
      const x = near.xs[i] ?? 0;
      const p = camera.toScreen(
        x + (shifts[i] ?? 0),
        sea.waterLevel - depth + (heights[i] ?? 0),
      );
      points.push({ x: p.x * dpr, y: p.y * dpr + (lift[i] ?? 0) });
      const lace = valueNoise(x * 1.7 - sea.clock * 0.1, 61 + k * 5.7);
      pens.push(
        smoothstep(needs, needs + 0.2, foam[i] ?? 0) *
          smoothstep(-0.6, -0.1, lace),
      );
    }
    const width = lerp(2.2, 1.1, k / FOAM_LINES.length) * dpr;
    ctx.fillStyle = css(waters.foam, 0.92);
    ctx.fill(ribbons(points, pens, width));
  }
}

/** `values` averaged over `reach` points either side of each, so steps in them are eased. */
function softened(values: Float64Array, reach: number): Float64Array {
  const n = values.length;
  const sums = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) {
    sums[i + 1] = (sums[i] ?? 0) + (values[i] ?? 0);
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const from = Math.max(0, i - reach);
    const to = Math.min(n, i + reach + 1);
    out[i] = ((sums[to] ?? 0) - (sums[from] ?? 0)) / (to - from);
  }
  return out;
}

/**
 * A filled stroke along `points`, `width` across where its pen is down fully, tapering wherever
 * the pen lifts, and broken where it is up.
 */
function ribbons(
  points: readonly Point[],
  pens: readonly number[],
  width: number,
): Path2D {
  const path = new Path2D();
  let run: { left: Point[]; right: Point[] } | undefined;
  const close = (): void => {
    if (run !== undefined && run.left.length > 1) {
      const [head, ...rest] = run.left;
      if (head !== undefined) {
        path.moveTo(head.x, head.y);
        for (const p of rest) {
          path.lineTo(p.x, p.y);
        }
        for (const p of [...run.right].reverse()) {
          path.lineTo(p.x, p.y);
        }
        path.closePath();
      }
    }
    run = undefined;
  };
  for (let i = 0; i < points.length; i += 1) {
    const pen = pens[i] ?? 0;
    if (pen < 0.02) {
      close();
      continue;
    }
    const p = at(points, i);
    const before = at(points, Math.max(0, i - 1));
    const after = at(points, Math.min(points.length - 1, i + 1));
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.hypot(dx, dy) || 1;
    const half = (width * pen) / 2;
    const nx = (-dy / length) * half;
    const ny = (dx / length) * half;
    run ??= { left: [], right: [] };
    run.left.push({ x: p.x + nx, y: p.y + ny });
    run.right.push({ x: p.x - nx, y: p.y - ny });
  }
  close();
  return path;
}

/** Foam over a crest: the points it lies along, in the order the crest runs, how thick it lies at most in device pixels, and how much foam, from 0 to 1. */
interface Cap {
  points: Point[];
  thick: number;
  amount: number;
}

/** Whitecaps the wind tears on small crests, along the surface as drawn, but for any on the `shaped` waves. */
function whitecapsOf(
  camera: Camera,
  sea: Sea,
  near: Near,
  shaped: readonly Shaped[],
): Cap[] {
  const caps: Cap[] = [];
  const surface = near.surface;
  const first = near.xs[0] ?? 0;
  const step = (near.xs[1] ?? first + 1) - first;
  const px = camera.scale * camera.dpr;
  const heading = sea.wind > 0 ? 1 : -1;
  const crests = [
    ...sea.whitecaps.map((w) => ({
      x: w.x,
      height: w.height,
      amount: w.strength,
    })),
    ...sea.crests
      .filter((c) => c.cap > 0.04 && c.poise <= 0.02)
      .map((c) => ({ x: c.x, height: c.height, amount: c.cap })),
  ];
  for (const crest of crests) {
    const guess = Math.round((crest.x - first) / step);
    if (guess < 1 || guess >= surface.length - 1) {
      continue;
    }
    // The highest point of the surface near where the crest was found.
    const reach = Math.max(2, Math.round((0.25 * crest.height) / step));
    let index = guess;
    for (
      let i = Math.max(1, guess - reach);
      i <= Math.min(surface.length - 2, guess + reach);
      i += 1
    ) {
      if (at(surface, i).y < at(surface, index).y) {
        index = i;
      }
    }
    const height = crest.height * px;
    if (height < 2 || shaped.some((w) => index >= w.from && index <= w.to)) {
      continue;
    }
    // From a little behind the crest to well down its face.
    const behind = height * 0.35 + 3 * camera.dpr;
    const ahead = height * (0.6 + 0.5 * crest.amount) + 4 * camera.dpr;
    let from = index;
    let travelled = 0;
    while (travelled < behind) {
      const next = from - heading;
      if (next < 0 || next >= surface.length) {
        break;
      }
      travelled += distance(at(surface, from), at(surface, next));
      from = next;
    }
    const points: Point[] = [at(surface, from)];
    travelled = 0;
    for (let j = from + heading; j >= 0 && j < surface.length; j += heading) {
      travelled += distance(at(surface, j - heading), at(surface, j));
      points.push(at(surface, j));
      if (travelled > behind + ahead) {
        break;
      }
    }
    caps.push({
      points,
      thick: (height * 0.16 + 1.5 * camera.dpr) * (0.5 + 0.5 * crest.amount),
      amount: crest.amount,
    });
  }
  return caps;
}

/**
 * Foam lying over a crest along `cap.points`: a pale crescent, thickest a little ahead of the
 * crest, with a scalloped underside lined in ink.
 */
function drawCap(
  ctx: CanvasRenderingContext2D,
  cap: Cap,
  waters: Waters,
  dpr: number,
): void {
  const { points, thick, amount } = cap;
  if (points.length < 3 || amount < 0.04) {
    return;
  }
  const bumps = 2 + Math.round(thick / (5 * dpr));
  const under: Point[] = points.map((p, j) => {
    const t = j / (points.length - 1);
    const swell = Math.sin(Math.PI * Math.pow(t, 0.8));
    const scallop = 0.7 + 0.3 * Math.abs(Math.cos(Math.PI * bumps * t));
    const before = at(points, Math.max(0, j - 1));
    const after = at(points, Math.min(points.length - 1, j + 1));
    // Down into the water, square to the surface there.
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.hypot(dx, dy) || 1;
    const sign = dx >= 0 ? 1 : -1;
    const depth = thick * swell * scallop;
    return {
      x: p.x - ((sign * dy) / length) * depth,
      y: p.y + ((sign * dx) / length) * depth,
    };
  });
  const shape = new Path2D();
  shape.moveTo(at(points, 0).x, at(points, 0).y - 0.5 * dpr);
  for (const p of points) {
    shape.lineTo(p.x, p.y - 0.5 * dpr);
  }
  for (const p of [...under].reverse()) {
    shape.lineTo(p.x, p.y);
  }
  shape.closePath();
  ctx.fillStyle = css(waters.foam, 0.95 * Math.min(1, amount * 1.3));
  ctx.fill(shape);
  ctx.lineWidth = 0.8 * dpr;
  ctx.strokeStyle = css(waters.line, waters.lineAlpha * 0.8 * amount);
  ctx.stroke(polyline(under));
}

/**
 * A claw of foam from `from`, setting out at `angle`, `length` long and `width` wide at its root,
 * curling the way a wave running `heading` curls and tightening as it thins to a point.
 */
function clawPath(
  from: Point,
  angle: number,
  length: number,
  width: number,
  heading: -1 | 1,
  wobble: number,
): Path2D {
  const steps = 12;
  const left: Point[] = [];
  const right: Point[] = [];
  let x = from.x;
  let y = from.y;
  const sweep = (2.4 + 1.2 * wobble) * heading;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const a = angle + sweep * Math.pow(t, 1.6);
    const half = (width / 2) * Math.pow(1 - t, 0.9);
    const nx = -Math.sin(a) * half;
    const ny = Math.cos(a) * half;
    left.push({ x: x + nx, y: y + ny });
    right.push({ x: x - nx, y: y - ny });
    x += (Math.cos(a) * length) / steps;
    y += (Math.sin(a) * length) / steps;
  }
  const path = new Path2D();
  path.moveTo(at(left, 0).x, at(left, 0).y);
  for (const p of left) {
    path.lineTo(p.x, p.y);
  }
  for (const p of right.reverse()) {
    path.lineTo(p.x, p.y);
  }
  path.closePath();
  return path;
}

/**
 * Water a wave threw up the land: a sheet of foam climbing the cliff's face to the height the
 * surge has reached, thinning to a scalloped edge at its top.
 */
function drawSurge(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  sea: Sea,
  waters: Waters,
): void {
  const { height, foam } = sea.surge;
  if (height < 0.04) {
    return;
  }
  const dpr = camera.dpr;
  const steps = 16;
  const outer: Point[] = [];
  const inner: Point[] = [];
  const thick = 0.12 + 0.05 * height;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const y = sea.waterLevel + height * t;
    const x = sea.faceAt(y);
    const out =
      thick *
      Math.pow(1 - t, 0.6) *
      (0.8 + 0.2 * Math.sin(t * 9 + sea.clock * 3));
    const a = camera.toScreen(x - 0.05, y);
    const b = camera.toScreen(x + out, y);
    inner.push({ x: a.x * dpr, y: a.y * dpr });
    outer.push({ x: b.x * dpr, y: b.y * dpr });
  }
  const sheet = new Path2D();
  sheet.moveTo(at(inner, 0).x, at(inner, 0).y);
  for (const p of inner) {
    sheet.lineTo(p.x, p.y);
  }
  for (const p of [...outer].reverse()) {
    sheet.lineTo(p.x, p.y);
  }
  sheet.closePath();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = css(waters.foam, clamp(0.55 + 0.4 * foam, 0, 0.95));
  ctx.fill(sheet);
  ctx.lineWidth = 0.8 * dpr;
  ctx.strokeStyle = css(waters.line, waters.lineAlpha * 0.8);
  ctx.stroke(polyline(outer));
}

/**
 * Spray flying from the sea: white drops ringed faintly with the sky, like the snow, the fastest
 * drawn out along their flight.
 */
export function drawSpray(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  sea: Sea,
  light: SkyLight,
): void {
  if (sea.droplets.length === 0) {
    return;
  }
  const waters = watersIn(light);
  const dpr = camera.dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const drops = new Path2D();
  const streaks = new Path2D();
  for (const drop of sea.droplets) {
    const p = camera.toScreen(drop.x, drop.y);
    if (
      p.x < -10 ||
      p.x > camera.width + 10 ||
      p.y < -10 ||
      p.y > camera.height + 10
    ) {
      continue;
    }
    const radius = clamp(drop.size * camera.scale, 0.7, 4);
    const speed = Math.hypot(drop.vx, drop.vy);
    const smear = speed * camera.scale * 0.018;
    if (smear > radius * 2.5) {
      const ux = drop.vx / speed;
      const uy = -drop.vy / speed;
      streaks.moveTo(p.x - ux * smear, p.y - uy * smear);
      streaks.lineTo(p.x, p.y);
    } else {
      drops.moveTo(p.x + radius, p.y);
      drops.arc(p.x, p.y, radius, 0, Math.PI * 2);
    }
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = css(light.sky.middle, 0.45);
  ctx.stroke(drops);
  ctx.fillStyle = css(waters.foam, 0.95);
  ctx.fill(drops);
  ctx.lineCap = "round";
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = css(waters.foam, 0.85);
  ctx.stroke(streaks);
}

/** Distance between two points. */
function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
