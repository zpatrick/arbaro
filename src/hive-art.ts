import type { Camera } from "./camera";
import {
  type BeeView,
  type HiveView,
  hiveBands,
  hiveDoor,
  hiveOutline,
  hiveSnow,
  widthAt,
} from "./hives";
import { css, lit, mix, type Rgb, type SkyBody, type SkyLight } from "./sky";
import { at, clamp, lerp, smoothstep } from "./util";

/**
 * What a hive is built of through the year, from midsummer at 0 to midwinter at 1: fresh golden
 * wax in summer, deepening to amber through the fall, and weathered to a pale straw by winter. The
 * lines between its bands of comb are a deeper shade of the same.
 */
const WAX: readonly { at: number; body: Rgb; band: Rgb }[] = [
  { at: 0, body: [222, 168, 76], band: [150, 96, 40] },
  { at: 0.5, body: [206, 136, 58], band: [134, 80, 34] },
  { at: 1, body: [188, 162, 122], band: [124, 104, 80] },
];

/**
 * How a hive takes the light, as the mountains do: how far light wraps past its edge into the
 * shade, how far toward the viewer the light falls, how strongly the moon shades it next to the
 * sun, and how shaded it is all over with no direct light, under thick cloud.
 */
const LIGHTING = { wrap: 0.5, depth: 0.8, moon: 0.6, overcast: 0.36 } as const;

/**
 * The hatching on a hive's shaded side, in the mountains' manner. Lines lean `tilt` radians off its
 * axis, `gapPx` CSS pixels apart and `widthPx` wide. Every other line comes in as its
 * shade deepens through `sparse`, the lines between through `dense`, up to `strength`. Each line is
 * shaded in stretches `stepPx` long, rounded to one of `levels` strengths.
 */
const HATCH = {
  tilt: 0.6,
  gapPx: 3.2,
  widthPx: 0.9,
  sparse: [0.3, 0.62],
  dense: [0.6, 0.92],
  strength: 0.8,
  stepPx: 4,
  levels: 5,
} as const;

/** The soft tone that darkens a hive's shaded side, at its darkest, in ink. */
const TONE = 0.3;
/** A hive smaller than this across, in CSS pixels, is drawn without its hatching and bands. */
const DETAIL_PX = 9;
/** Width of the lines between its bands of comb, in meters, and their thinnest, in CSS pixels. */
const BAND_LINE = { width: 0.008, leastPx: 0.7 } as const;
/** Its outline, in ink: how strongly it shows, and its width, in CSS pixels. */
const OUTLINE = { alpha: 0.85, px: 1 } as const;

/** A direction toward the light, with z toward the viewer. */
interface Toward {
  x: number;
  y: number;
  z: number;
}

/** How the hives look in one frame's light and season. */
export interface HiveLook {
  body: Rgb;
  band: Rgb;
  ink: Rgb;
  snow: string;
  sun: Toward;
  moon: Toward;
  /** How far the sun and the moon are up, each from 0 to 1. */
  sunUp: number;
  moonUp: number;
  /** How much of the light falls straight on the scene, from 0 under thick cloud to 1. */
  direct: number;
}

/** How the hives look under `light` in `season`, from midsummer at 0 to midwinter at 1. */
export function hiveLook(
  light: SkyLight,
  season: number,
  snow: string,
): HiveLook {
  const wax = waxAt(season);
  return {
    body: lit(wax.body, light.flowerLight),
    band: lit(wax.band, light.flowerLight),
    ink: light.ink,
    snow,
    sun: toward(light.sun),
    moon: toward(light.moon),
    sunUp: smoothstep(-0.04, 0.1, light.sun.height),
    moonUp: smoothstep(-0.04, 0.1, light.moon.height),
    direct: light.direct,
  };
}

/** The wax of a hive at `season`, between the colors it turns through the year. */
function waxAt(season: number): { body: Rgb; band: Rgb } {
  const t = clamp(season, 0, 1);
  for (let i = 1; i < WAX.length; i += 1) {
    const from = at(WAX, i - 1);
    const to = at(WAX, i);
    if (t <= to.at) {
      const k = smoothstep(from.at, to.at, t);
      return {
        body: mix(from.body, to.body, k),
        band: mix(from.band, to.band, k),
      };
    }
  }
  return at(WAX, WAX.length - 1);
}

/** The direction toward `body` in the sky, falling a little toward the viewer. */
function toward(body: SkyBody): Toward {
  const angle = Math.PI * (1 - clamp(body.along, 0, 1));
  const x = Math.cos(angle);
  const y = Math.sin(angle);
  const length = Math.hypot(x, y, LIGHTING.depth);
  return { x: x / length, y: y / length, z: LIGHTING.depth / length };
}

/**
 * How shaded the hive in `view` is at a point `t` of the way down it and `side` of its half-width
 * across, from 0 in full light to 1 in full shade. It is a bell turned on its axis, so it faces up
 * where it swells, down where it rounds off below, and away from the light on its far side.
 */
function shadeAt(
  view: HiveView,
  t: number,
  side: number,
  look: HiveLook,
): number {
  const swell = clamp(
    (((widthAt(t + 0.01) - widthAt(t - 0.01)) / 0.02) * view.width) /
      2 /
      view.height,
    -3,
    3,
  );
  const s = clamp(side, -1, 1);
  const nz = Math.sqrt(1 - s * s);
  const cos = Math.cos(view.swing);
  const sin = Math.sin(view.swing);
  const nx = s * cos - swell * sin;
  const ny = s * sin + swell * cos;
  const length = Math.hypot(nx, ny, nz);
  const litBy = (light: Toward): number =>
    Math.max(
      0,
      ((nx * light.x + ny * light.y + nz * light.z) / length + LIGHTING.wrap) /
        (1 + LIGHTING.wrap),
    );
  const bySun = 1 - litBy(look.sun);
  const byMoon = lerp(0.5, 1 - litBy(look.moon), look.moonUp);
  return lerp(
    LIGHTING.overcast,
    lerp(lerp(0.5, byMoon, LIGHTING.moon), bySun, look.sunUp),
    look.direct,
  );
}

/**
 * Draws the hive in `view` in its colors: its golden body, the soft tone and hatching on the side
 * turned from the sun or moon, the lines between its bands of comb, its door, its outline in ink,
 * and any snow on its shoulders. `world` maps meters to device pixels.
 */
export function drawHive(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  world: DOMMatrix,
  view: HiveView,
  look: HiveLook,
): void {
  if (view.alpha <= 0) {
    return;
  }
  const px = 1 / camera.scale;
  const outline = hiveOutline(view);
  const detailed = view.width * camera.scale >= DETAIL_PX;
  ctx.save();
  ctx.setTransform(world);
  ctx.globalAlpha = view.alpha;
  ctx.fillStyle = css(look.body);
  ctx.fill(outline);
  ctx.save();
  ctx.clip(outline);
  if (detailed) {
    ctx.strokeStyle = css(look.band);
    ctx.lineWidth = Math.max(BAND_LINE.width, BAND_LINE.leastPx * px);
    ctx.lineCap = "round";
    ctx.stroke(hiveBands(view));
  }
  shadeTone(ctx, view, look);
  if (detailed) {
    hatch(ctx, view, look, px);
  }
  ctx.restore();
  ctx.fillStyle = css(look.ink);
  ctx.fill(hiveDoor(view));
  ctx.strokeStyle = css(look.ink, OUTLINE.alpha);
  ctx.lineWidth = OUTLINE.px * px;
  ctx.lineJoin = "round";
  ctx.stroke(outline);
  const cap = hiveSnow(view);
  if (cap !== undefined) {
    ctx.fillStyle = look.snow;
    ctx.fill(cap);
  }
  ctx.restore();
}

/** Darkens the side of the hive in `view` turned from the light with a soft tone of ink. */
function shadeTone(
  ctx: CanvasRenderingContext2D,
  view: HiveView,
  look: HiveLook,
): void {
  const key = look.sunUp >= look.moonUp ? look.sun : look.moon;
  const strength =
    look.direct * Math.max(look.sunUp, LIGHTING.moon * look.moonUp);
  const flat = Math.hypot(key.x, key.y);
  if (strength <= 0.01 || flat < 1e-3) {
    return;
  }
  const middle = {
    x: view.x + Math.sin(view.swing) * view.height * 0.5,
    y: view.y - Math.cos(view.swing) * view.height * 0.5,
  };
  const reach = Math.max(view.width, view.height) / 2;
  const ux = key.x / flat;
  const uy = key.y / flat;
  const tone = ctx.createLinearGradient(
    middle.x + ux * reach,
    middle.y + uy * reach,
    middle.x - ux * reach,
    middle.y - uy * reach,
  );
  tone.addColorStop(0, css(look.ink, 0));
  tone.addColorStop(0.45, css(look.ink, 0.04 * strength));
  tone.addColorStop(1, css(look.ink, TONE * strength));
  ctx.fillStyle = tone;
  ctx.fillRect(middle.x - reach, middle.y - reach, reach * 2, reach * 2);
}

/**
 * Hatches the side of the hive in `view` turned from the light with straight lines leaning off its
 * axis, each fading in along its length as the shade under it deepens. `px` is a CSS pixel in
 * meters.
 */
function hatch(
  ctx: CanvasRenderingContext2D,
  view: HiveView,
  look: HiveLook,
  px: number,
): void {
  const half = view.width / 2;
  const gap = HATCH.gapPx * px;
  // The lines lean toward the side the light comes from.
  const key = look.sunUp >= look.moonUp ? look.sun : look.moon;
  const fromRight =
    key.x * Math.cos(view.swing) + key.y * Math.sin(view.swing) >= 0;
  const angle = (fromRight ? 1 : -1) * (Math.PI / 2 - HATCH.tilt);
  // In the hive's own frame: across it to the right, and down it from where it hangs.
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const reach = Math.hypot(half, view.height / 2);
  const cos = Math.cos(view.swing);
  const sin = Math.sin(view.swing);
  const toWorld = (u: number, v: number): { x: number; y: number } => ({
    x: view.x + u * cos + v * sin,
    y: view.y + u * sin - v * cos,
  });
  const levels = Array.from({ length: HATCH.levels + 1 }, () => new Path2D());
  const steps = Math.max(4, Math.ceil((2 * reach) / (HATCH.stepPx * px)));
  let line = 0;
  for (let c = -reach; c <= reach; c += gap, line += 1) {
    const range = line % 2 === 0 ? HATCH.sparse : HATCH.dense;
    for (let i = 0; i < steps; i += 1) {
      const a = lerp(-reach, reach, i / steps);
      const b = lerp(-reach, reach, (i + 1) / steps);
      const m = (a + b) / 2;
      const u = -dy * c + dx * m;
      const v = view.height / 2 + dx * c + dy * m;
      const t = v / view.height;
      if (t < 0 || t > 1) {
        continue;
      }
      const shade = shadeAt(
        view,
        t,
        u / (half * Math.max(widthAt(t), 0.05)),
        look,
      );
      const level = Math.round(
        smoothstep(range[0], range[1], shade) * HATCH.levels,
      );
      if (level === 0) {
        continue;
      }
      const from = toWorld(-dy * c + dx * a, view.height / 2 + dx * c + dy * a);
      const to = toWorld(-dy * c + dx * b, view.height / 2 + dx * c + dy * b);
      const path = at(levels, level);
      path.moveTo(from.x, from.y);
      path.lineTo(to.x, to.y);
    }
  }
  ctx.lineWidth = HATCH.widthPx * px;
  ctx.lineCap = "butt";
  for (let level = 1; level <= HATCH.levels; level += 1) {
    ctx.strokeStyle = css(look.ink, (HATCH.strength * level) / HATCH.levels);
    ctx.stroke(at(levels, level));
  }
}

/**
 * A bee's body length, in meters, and the fewest and most CSS pixels it is drawn at; the gold of
 * its abdomen, and the grey of its wings and how strongly they show.
 */
const BEE = {
  length: 0.016,
  leastPx: 5.5,
  mostPx: 18,
  body: [232, 178, 58],
  wing: [178, 186, 200],
  wingAlpha: 0.6,
} as const;

/**
 * Draws each bee in `bees` side on, flying the way it heads: a dark head and thorax, a gold abdomen
 * banded in ink, and a grey blur of wings above its back.
 */
export function drawBees(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  bees: readonly BeeView[],
  light: SkyLight,
): void {
  if (bees.length === 0) {
    return;
  }
  const length = clamp(BEE.length * camera.scale, BEE.leastPx, BEE.mostPx);
  const gold = css(lit(BEE.body, light.flowerLight));
  const wing = css(lit(BEE.wing, light.flowerLight), BEE.wingAlpha);
  const ink = css(light.ink);
  const abdomen = new Path2D();
  abdomen.ellipse(-0.17, 0.02, 0.34, 0.25, 0, 0, Math.PI * 2);
  const front = new Path2D();
  front.arc(0.13, -0.02, 0.2, 0, Math.PI * 2);
  front.moveTo(0.53, 0);
  front.arc(0.38, 0, 0.15, 0, Math.PI * 2);
  for (const bee of bees) {
    const p = camera.toScreen(bee.x, bee.y);
    const ahead = Math.cos(bee.heading);
    // It faces the way it flies, upright, its body tilted up or down with its course.
    const facing = ahead < 0 ? -1 : 1;
    const tilt = clamp(
      Math.atan2(Math.sin(bee.heading), Math.abs(ahead)),
      -0.9,
      0.9,
    );
    const flutter = 0.35 * Math.sin(bee.beat * 7.3);
    ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
    ctx.translate(p.x, p.y);
    ctx.scale(facing * length, length);
    ctx.rotate(-tilt);
    ctx.globalAlpha = bee.alpha;
    ctx.fillStyle = wing;
    ctx.beginPath();
    ctx.ellipse(-0.04, -0.3, 0.3, 0.13, -0.55 + flutter, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0.08, -0.28, 0.24, 0.1, -1.05 + flutter, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = gold;
    ctx.fill(abdomen);
    ctx.save();
    ctx.clip(abdomen);
    ctx.fillStyle = ink;
    ctx.fillRect(-0.16, -0.4, 0.09, 0.8);
    ctx.fillRect(-0.34, -0.4, 0.09, 0.8);
    ctx.fillRect(-0.6, -0.4, 0.12, 0.8);
    ctx.restore();
    ctx.fillStyle = ink;
    ctx.fill(front);
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
