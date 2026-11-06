import type { Camera } from "./camera";
import type { Profile, Sea } from "./sea";
import { css, lit, mix, type Rgb, skyBodyAt, type SkyLight } from "./sky";
import { at, clamp, lerp, Rng, smoothstep, valueNoise } from "./util";
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
 * A wave drawn to its own shape over the surface: one steepening as it nears breaking, or a
 * breaker, its crest pitching over, its lip curling, then rolling on as a front of foam.
 */
interface Shaped {
  id: number;
  /** Which way it runs across the view: -1 to the left, 1 to the right. */
  heading: -1 | 1;
  /** Its height, and the height it broke at, in device pixels. */
  height: number;
  broke: number;
  /** How steep its face stands, from 0 to 1 upright and hollow. */
  steep: number;
  /** How far its lip has curled over, from 0 to 1. */
  curl: number;
  /** Foam on its crest and face, from 0 to 1. */
  foam: number;
  /** How far through breaking it is, for the spray of its claws. */
  breaking: number;
  /** How much of its shape is set over the surface, from 0 to 1, as a wave nears breaking. */
  blend: number;
  crest: Point;
  /** Its back, from where it leaves the surface up to the crest, and its face down to where it meets the surface again, in the order it runs. */
  back: Point[];
  face: Point[];
  lip: Lip | undefined;
  /** The points of the surface it stands in place of. */
  from: number;
  to: number;
}

/** A curling lip: its outer edge from the crest out to its tip, and its inner edge back from the tip to its root. */
interface Lip {
  outer: Point[];
  inner: Point[];
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
  drawFoam(ctx, camera, sea, near, waters);
  for (const cap of whitecapsOf(camera, sea, near, shaped)) {
    drawCap(ctx, cap, waters, dpr);
  }
  for (const wave of shaped) {
    drawFront(ctx, wave, waters, dpr);
  }
  ctx.restore();

  // The surface's own line, and the lips' foam, over the water's edge.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clip(above);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = WIDTH.surface * dpr;
  ctx.strokeStyle = css(waters.line, waters.lineAlpha * 1.1);
  ctx.stroke(polyline(outline));
  for (const wave of shaped) {
    drawLipFoam(ctx, wave, waters, dpr);
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
 * Shapes every wave nearing breaking, and every breaker, in device pixels over `near`'s surface,
 * from the furthest left to the furthest right, leaving out any that would overlap one that shows
 * more.
 */
function shapeWaves(camera: Camera, sea: Sea, near: Near): Shaped[] {
  const px = camera.scale * camera.dpr;
  const subjects: Omit<
    Shaped,
    "crest" | "back" | "face" | "lip" | "from" | "to"
  >[] = [];
  const at0 = (x: number): number => camera.toScreen(x, 0).x * camera.dpr;
  const xs: number[] = [];
  for (const crest of sea.crests) {
    if (crest.poise > 0.02 && !crest.broken) {
      subjects.push({
        id: crest.id,
        heading: crest.heading,
        height: crest.height * px,
        broke: crest.height * px,
        steep: WAVE.poised * crest.poise,
        curl: 0,
        foam: crest.cap,
        breaking: 0,
        blend: smoothstep(0.02, 0.45, crest.poise),
      });
      xs.push(at0(crest.x));
    }
  }
  for (const breaker of sea.breakers) {
    const b = breaker.breaking;
    const landed = smoothstep(0.42, 0.62, b);
    subjects.push({
      id: breaker.id,
      heading: breaker.heading,
      height: breaker.height * px,
      broke: breaker.broke * px,
      steep: lerp(
        lerp(WAVE.poised, 1, smoothstep(0, 0.3, b)),
        WAVE.bore,
        landed,
      ),
      curl: smoothstep(0.03, 0.42, b) * (1 - landed),
      foam: lerp(0, 1, landed) * (1 - 0.4 * smoothstep(0.7, 1, b)),
      breaking: b,
      blend: 1,
    });
    xs.push(at0(breaker.x));
  }
  const shaped: Shaped[] = [];
  for (const [i, subject] of subjects.entries()) {
    const wave = shape(near.surface, subject, at(xs, i));
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
 * Notes how far `wave`'s shape raises or lowers the surface at each point it covers, by as much
 * of its shape as is set over the surface, so the water under it can rise and fall with it.
 */
function raise(near: Near, wave: Shaped): void {
  const outline = [...wave.back, ...wave.face];
  for (let i = wave.from; i <= wave.to; i += 1) {
    const p = at(near.surface, i);
    // The highest point of the shape over this point.
    let top = Infinity;
    for (let j = 0; j + 1 < outline.length; j += 1) {
      const a = at(outline, j);
      const b = at(outline, j + 1);
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
 * Shapes a wave whose crest stands over `x`, in device pixels: a long back rising from the surface
 * to a crest that runs on ahead as the wave steepens, a face falling from it to the water ahead,
 * hollowing and standing upright, and a lip curling over from the crest.
 */
function shape(
  surface: readonly Point[],
  wave: Omit<Shaped, "crest" | "back" | "face" | "lip" | "from" | "to">,
  x: number,
): Shaped | undefined {
  const { heading, height, steep } = wave;
  if (height < 3) {
    return undefined;
  }
  // Its back and face, held within the surface worked out, which reaches a little past the view.
  const inside = (i: number): number => clamp(i, 1, surface.length - 2);
  const iBack = inside(indexNear(surface, x - heading * WAVE.back * height));
  const iAhead = inside(
    indexNear(
      surface,
      x + heading * lerp(WAVE.face.gentle, WAVE.face.steep, steep) * height,
    ),
  );
  const iCrest = indexNear(surface, x);
  if (
    iBack === iAhead ||
    iCrest <= 1 ||
    iCrest >= surface.length - 2 ||
    (iCrest - iBack) * heading <= 0 ||
    (iAhead - iCrest) * heading <= 0
  ) {
    return undefined;
  }
  const back = at(surface, iBack);
  const ahead = at(surface, iAhead);
  const crest = {
    x: x + heading * WAVE.run * steep * height,
    y: Math.min(
      ahead.y - height * (1 + WAVE.rise * steep),
      back.y - 0.3 * height,
    ),
  };
  const lip = lipOf(crest, heading, wave.broke, wave.curl);
  // Back: rising long and smooth to a crest that sharpens as the wave steepens.
  const backCurve = bezier(
    back,
    { x: back.x + heading * 0.55 * Math.abs(crest.x - back.x), y: back.y },
    {
      x: crest.x - heading * height * lerp(1.5, 0.55, steep),
      y: crest.y,
    },
    crest,
    24,
  );
  // Face: falling from the crest, or from under the lip, and hollowing as it stands upright until
  // it drops straight from the crest and sweeps out level into the trough ahead.
  const top = lip === undefined ? crest : at(lip.inner, lip.inner.length - 1);
  const faceCurve = bezier(
    top,
    {
      x: top.x + heading * height * lerp(0.9, 0, steep),
      y: top.y + height * lerp(0.15, 0.55, steep),
    },
    {
      x: ahead.x - heading * height * lerp(0.6, 0.45, steep),
      y: ahead.y - height * lerp(0.15, 0, steep),
    },
    ahead,
    18,
  );
  return {
    ...wave,
    crest,
    back: backCurve,
    face: faceCurve,
    lip,
    from: Math.min(iBack, iAhead),
    to: Math.max(iBack, iAhead),
  };
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
 * The lip of a wave cresting at `crest`, `size` device pixels high when it broke, curled `curl` of
 * the way over: thrown on the way it runs, curving down and over as it goes, and thinning to its
 * tip.
 */
function lipOf(
  crest: Point,
  heading: -1 | 1,
  size: number,
  curl: number,
): Lip | undefined {
  if (curl <= 0.02 || size < 6) {
    return undefined;
  }
  const length = size * lerp(0.25, 1.05, curl);
  const sweep = curl * 2.8;
  const thick = size * lerp(0.14, 0.22, curl);
  const steps = 16;
  const outer: Point[] = [];
  const inner: Point[] = [];
  let u = 0;
  let v = 0;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const angle = 0.1 - sweep * Math.pow(t, 1.4);
    const half = thick * Math.pow(1 - t, 0.7);
    const map = (pu: number, pv: number): Point => ({
      x: crest.x + heading * pu,
      y: crest.y - pv,
    });
    outer.push(map(u, v));
    inner.push(map(u + Math.sin(angle) * half, v - Math.cos(angle) * half));
    u += (Math.cos(angle) * length) / steps;
    v += (Math.sin(angle) * length) / steps;
  }
  return { outer, inner: inner.reverse() };
}

/** A point of the surface as drawn, and how deep in the hollow under a curling lip it lies, from 0 to 1. */
interface Edge extends Point {
  hollow: number;
}

/**
 * The surface with every shaped wave set into it in place of the points it covers: its back up to
 * the crest, out along its lip to the tip and back under it, and down its face.
 */
function setInto(
  surface: readonly Point[],
  shaped: readonly Shaped[],
  lift: Float64Array,
): Edge[] {
  const open = (points: readonly Point[], hollow = 0): Edge[] =>
    points.map((p) => ({ x: p.x, y: p.y, hollow }));
  const out: Edge[] = [];
  let i = 0;
  for (const wave of shaped) {
    out.push(...open(surface.slice(i, wave.from)));
    if (wave.blend < 1) {
      // Not yet breaking: the surface rises toward the wave's shape, point for point.
      for (let j = wave.from; j <= wave.to; j += 1) {
        const p = at(surface, j);
        out.push({ x: p.x, y: p.y + (lift[j] ?? 0), hollow: 0 });
      }
      i = wave.to + 1;
      continue;
    }
    const run = [
      ...open(wave.back),
      ...(wave.lip === undefined
        ? []
        : open([...wave.lip.outer, ...wave.lip.inner])),
      ...open(wave.face, wave.curl),
    ];
    out.push(...(wave.heading > 0 ? run : run.reverse()));
    i = wave.to + 1;
  }
  out.push(...open(surface.slice(i)));
  return out;
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
        y: p.y * dpr + (near.lift[i] ?? 0) * follow,
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

/** Foam lying on the water: pale lines just under the surface, more of them where more foam lies. */
function drawFoam(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  sea: Sea,
  near: Near,
  waters: Waters,
): void {
  const dpr = camera.dpr;
  const foam = near.xs.map((x) => sea.foamAt(x));
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
      points.push({ x: p.x * dpr, y: p.y * dpr + (near.lift[i] ?? 0) });
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
 * The foam of a breaker rolling on after its lip has landed: over its crest and down its face, the
 * thicker the more foam it carries.
 */
function drawFront(
  ctx: CanvasRenderingContext2D,
  wave: Shaped,
  waters: Waters,
  dpr: number,
): void {
  if (wave.foam < 0.04) {
    return;
  }
  // The last of its back, over the crest, and down most of its face.
  const back = wave.back.slice(Math.floor(wave.back.length * 0.6));
  const face = wave.face.slice(0, Math.ceil(wave.face.length * 0.75));
  drawCap(
    ctx,
    {
      points: [...back, ...face],
      thick: wave.height * 0.4 + 2 * dpr,
      amount: wave.foam,
    },
    waters,
    dpr,
  );
}

/**
 * Foam on a curling lip: pale along its top, and breaking into claws of foam at its tip, the way
 * the old prints draw a great wave.
 */
function drawLipFoam(
  ctx: CanvasRenderingContext2D,
  wave: Shaped,
  waters: Waters,
  dpr: number,
): void {
  const lip = wave.lip;
  if (lip === undefined) {
    return;
  }
  const outer = lip.outer;
  const inner = [...lip.inner].reverse();
  // A band of foam along the top of the lip, and down the back a little way.
  const band = new Path2D();
  const backTop = wave.back.slice(Math.floor(wave.back.length * 0.8));
  const top = [...backTop, ...outer];
  for (const [i, p] of top.entries()) {
    if (i === 0) {
      band.moveTo(p.x, p.y);
    } else {
      band.lineTo(p.x, p.y);
    }
  }
  for (let i = outer.length - 1; i >= 0; i -= 1) {
    const o = at(outer, i);
    const n = at(inner, i);
    band.lineTo(lerp(o.x, n.x, 0.5), lerp(o.y, n.y, 0.5));
  }
  const reach = wave.height * 0.12;
  for (let i = backTop.length - 1; i >= 0; i -= 1) {
    const p = at(backTop, i);
    band.lineTo(p.x, p.y + reach * (i / Math.max(1, backTop.length - 1)));
  }
  band.closePath();
  ctx.fillStyle = css(waters.foam, 0.96);
  ctx.fill(band);

  // Claws of foam reaching on from the tip, curling back on themselves.
  const claws = 2 + Math.round(3 * wave.curl);
  const rng = new Rng(wave.id * 977);
  const sway = Math.sin(wave.id + wave.breaking * 9);
  for (let c = 0; c < claws; c += 1) {
    const t = lerp(0.4, 0.97, (c + 0.5) / claws);
    const index = Math.min(
      outer.length - 2,
      Math.floor(t * (outer.length - 1)),
    );
    const p = at(outer, index);
    const q = at(outer, index + 1);
    const along = Math.atan2(q.y - p.y, q.x - p.x);
    // Out from the lip, leaning on the way it runs.
    const out = along - (Math.PI / 2) * wave.heading * 0.75 + 0.2 * sway;
    const length = wave.broke * lerp(0.18, 0.32, rng.next()) * wave.curl;
    const width = Math.max(1.6 * dpr, wave.broke * 0.07);
    const claw = clawPath(p, out, length, width, wave.heading, rng.next());
    ctx.fillStyle = css(waters.foam, 0.97);
    ctx.fill(claw);
    ctx.lineWidth = 0.7 * dpr;
    ctx.strokeStyle = css(waters.line, waters.lineAlpha * 0.9);
    ctx.stroke(claw);
  }
  ctx.lineWidth = 0.9 * dpr;
  ctx.strokeStyle = css(waters.line, waters.lineAlpha);
  ctx.stroke(polyline(inner));
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
