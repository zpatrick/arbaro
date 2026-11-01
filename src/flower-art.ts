import type { FlowerKind } from "./flowers";
import type { Rgb } from "./sky";
import { clamp, lerp, smoothstep } from "./util";

/**
 * Outline around every petal, as a fraction of the flower's size, and its limits in CSS pixels.
 * A small flower gets a fine outline so its color still reads.
 */
const OUTLINE = { width: 0.04, min: 0.45, max: 1.1 } as const;
/** Ink of the sepals and outlines: the wood's ink, with the outlines a little softer. */
const INK: Rgb = [42, 33, 26];
const OUTLINE_ALPHA = 0.85;
/** Fine lines inside the petals, in CSS pixels. */
const VEIN_PX = 0.7;
/** The fine lines fade in as a flower is drawn between these sizes, in CSS pixels. */
const DETAIL_PX = { from: 14, to: 30 } as const;

/** Petal colors of a living flower of each kind: where each petal starts, and at its tip. */
const LIVING: Record<FlowerKind, { base: Rgb; tip: Rgb }> = {
  lotus: { base: [248, 238, 230], tip: [220, 140, 148] },
  cloud: { base: [234, 176, 184], tip: [251, 241, 237] },
  star: { base: [236, 180, 76], tip: [251, 245, 233] },
};

/**
 * Colors every flower turns as the year ends, in order: yellow, orange, brown and dead. Each
 * blends in over its span of the year, from midsummer at 0 to winter at 1.
 */
const AUTUMN: readonly { from: number; to: number; base: Rgb; tip: Rgb }[] = [
  { from: 0.26, to: 0.44, base: [222, 170, 62], tip: [240, 206, 110] },
  { from: 0.44, to: 0.6, base: [200, 106, 44], tip: [228, 146, 70] },
  { from: 0.6, to: 0.76, base: [126, 78, 44], tip: [156, 104, 62] },
  { from: 0.76, to: 0.9, base: [76, 52, 34], tip: [98, 70, 48] },
];

/** Late in the year petals go limp: they droop, narrow and curl over this span of the year. */
const WILT = { from: 0.55, to: 0.9 } as const;

interface LotusPetal {
  /** Angle from the flower's axis when fully open, in radians. Mirrored to both sides unless 0. */
  angle: number;
  /** Length closed in the bud, where the front petals are the longest, and fully open. */
  bud: number;
  length: number;
  width: number;
  /** How dark the petal is, for depth: petals further back are darker. */
  shade: number;
  /** How far the tip turns up toward upright when fully open, as a fraction of its length. */
  lift: number;
}

/**
 * A lotus seen from the side, after the sand drawings, its petals listed from the back to the
 * front: an outer row spread nearly flat, long and narrow with their tips turned up, a middle
 * row, and a cup of upright petals in the middle.
 */
const LOTUS: readonly LotusPetal[] = [
  { angle: 1.5, bud: 0.43, length: 0.9, width: 0.27, shade: 0.8, lift: 0.22 },
  { angle: 1.08, bud: 0.6, length: 0.86, width: 0.31, shade: 0.86, lift: 0.16 },
  { angle: 0.7, bud: 0.74, length: 0.82, width: 0.32, shade: 0.9, lift: 0.1 },
  { angle: 0, bud: 0.84, length: 0.78, width: 0.33, shade: 0.84, lift: 0 },
  { angle: 0.36, bud: 0.72, length: 0.72, width: 0.35, shade: 0.95, lift: 0.04 },
  { angle: 0, bud: 0.69, length: 0.62, width: 0.37, shade: 1, lift: 0 },
];
/** Petals from this index on stand in front of the stamens. */
const LOTUS_FRONT = 4;
/** Stamens rising from the heart of an open lotus: their lean from upright and their length. */
const STAMENS: readonly { lean: number; length: number }[] = [
  { lean: -0.42, length: 0.6 },
  { lean: -0.18, length: 0.72 },
  { lean: 0.05, length: 0.76 },
  { lean: 0.26, length: 0.7 },
  { lean: 0.46, length: 0.58 },
];
/** Color of the stamens' tips. */
const POLLEN: Rgb = [226, 178, 82];

/** A cloud blossom's lobes when open, around the middle of the cluster at height 0.52. */
const CLOUD: readonly { x: number; y: number; r: number }[] = [
  { x: 0, y: 0.36, r: 0.2 },
  { x: -0.27, y: 0.34, r: 0.17 },
  { x: 0.27, y: 0.34, r: 0.17 },
  { x: -0.44, y: 0.5, r: 0.15 },
  { x: 0.44, y: 0.5, r: 0.15 },
  { x: -0.26, y: 0.64, r: 0.2 },
  { x: 0.26, y: 0.64, r: 0.2 },
  { x: 0, y: 0.76, r: 0.22 },
];
/** The cloud blossom's lobes from this index on sit over others, and show a scallop where they overlap. */
const CLOUD_OVERLAPPING = 3;

/** A star flower's five petals, seen from the front around a center this high above its base. */
const STAR = { center: 0.5, length: 0.5, width: 0.42, petals: 5 } as const;

/** The fine lines inside petals: their width in the flower's own units, and how strongly they show. */
interface Vein {
  width: number;
  alpha: number;
}

/** The colors a flower is drawn in, already lit: its petals at their base and tip, and its inks. */
interface Paint {
  base: Rgb;
  tip: Rgb;
  ink: string;
  outline: string;
}

/** How to draw one flower. Positions and sizes are in CSS pixels. */
export interface FlowerLook {
  kind: FlowerKind;
  /** Where the flower's base is, at the end of its stalk. */
  x: number;
  y: number;
  /** The way the flower faces, in radians counterclockwise from the right, with y up. */
  angle: number;
  size: number;
  /** From 0, closed into a bud, to 1, fully open. */
  openness: number;
  /** The time of year it shows, from midsummer at 0 to winter at 1. */
  age: number;
  alpha: number;
  /** Fixed for each flower, from 0 to 1, for the small differences between flowers of a kind. */
  variant: number;
  /** Multipliers on every color, for the light at this time of day. */
  light: Rgb;
}

/** Draws a flower. Sets the transform itself, so the caller's is lost. */
export function drawFlower(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  look: FlowerLook,
): void {
  const { size } = look;
  const sin = Math.sin(look.angle);
  const cos = Math.cos(look.angle);
  // Local units are the flower's size, with y along the way it faces and x to its right.
  ctx.setTransform(
    size * sin * dpr,
    size * cos * dpr,
    size * cos * dpr,
    -size * sin * dpr,
    look.x * dpr,
    look.y * dpr,
  );
  const line = clamp(size * OUTLINE.width, OUTLINE.min, OUTLINE.max) / size;
  const vein: Vein = {
    width: VEIN_PX / size,
    alpha: smoothstep(DETAIL_PX.from, DETAIL_PX.to, size),
  };
  const colors = petalColors(look.kind, look.age);
  const ink = lit(INK, look.light);
  const paint: Paint = {
    base: lit(colors.base, look.light),
    tip: lit(colors.tip, look.light),
    ink: css(ink),
    outline: `rgba(${Math.round(ink[0])}, ${Math.round(ink[1])}, ${Math.round(ink[2])}, ${OUTLINE_ALPHA})`,
  };
  const wilt = smoothstep(WILT.from, WILT.to, look.age);
  const open = easeInOut(look.openness);
  ctx.globalAlpha = look.alpha;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  switch (look.kind) {
    case "lotus":
      drawLotus(ctx, open, wilt, paint, line, vein);
      break;
    case "cloud":
      drawCloud(ctx, open, wilt, paint, line, vein);
      break;
    case "star":
      drawStar(ctx, open, wilt, paint, line, vein, look.variant);
      break;
    default: {
      const unknown: never = look.kind;
      throw new Error(`Unknown flower kind ${String(unknown)}.`);
    }
  }
  ctx.globalAlpha = 1;
}

/** Petal colors at a time of year: the living colors, turned by however much of autumn has passed. */
function petalColors(kind: FlowerKind, age: number): { base: Rgb; tip: Rgb } {
  let { base, tip } = LIVING[kind];
  for (const stage of AUTUMN) {
    const t = smoothstep(stage.from, stage.to, age);
    if (t <= 0) {
      break;
    }
    base = mix(base, stage.base, t);
    tip = mix(tip, stage.tip, t);
  }
  return { base, tip };
}

function drawLotus(
  ctx: CanvasRenderingContext2D,
  open: number,
  wilt: number,
  paint: Paint,
  line: number,
  vein: Vein,
): void {
  // Two sepals and a cup at the base, in the same ink as the wood.
  ctx.fillStyle = paint.ink;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(0, 0.05);
    ctx.scale(side, 1);
    ctx.rotate(-(1.9 + 0.35 * open + 0.3 * wilt));
    leaf(ctx, 0.2, 0.13);
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.ellipse(0, 0.05, 0.085, 0.07, 0, 0, Math.PI * 2);
  ctx.fill();

  LOTUS.forEach((petal, index) => {
    if (index === LOTUS_FRONT) {
      drawStamens(ctx, open * (1 - wilt), paint, vein);
    }
    const outer = petal.angle / 1.5;
    const spread = petal.angle * lerp(0.07, 1, open) + 0.3 * wilt * outer;
    const length = lerp(petal.bud, petal.length, open) * (1 - 0.12 * wilt);
    const width = petal.width * (1 - 0.3 * wilt);
    // Open, the tips turn up toward upright; wilting, they droop.
    const lift = (petal.lift * open - 0.25 * wilt * outer) * length;
    for (const side of petal.angle === 0 ? [1] : [-1, 1]) {
      ctx.save();
      ctx.translate(side * 0.05 * Math.sin(spread), 0.06);
      ctx.scale(side, 1);
      ctx.rotate(-spread);
      lotusPetal(ctx, length, width, lift);
      const fill = ctx.createLinearGradient(0, 0, 0, length);
      fill.addColorStop(0, css(paint.base, petal.shade));
      fill.addColorStop(1, css(paint.tip, petal.shade));
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = paint.outline;
      ctx.lineWidth = line;
      ctx.stroke();
      // Carved inside it, a second outline following the first, and a midrib.
      ctx.lineWidth = vein.width;
      ctx.globalAlpha *= 0.4 * vein.alpha;
      ctx.save();
      ctx.translate(0, length * 0.1);
      lotusPetal(ctx, length * 0.82, width * 0.58, lift * 0.82);
      ctx.restore();
      ctx.moveTo(0, length * 0.16);
      ctx.quadraticCurveTo(
        -lift * 0.2,
        length * 0.5,
        -lift * 0.75,
        length * 0.8,
      );
      ctx.stroke();
      ctx.restore();
    }
  });
}

/**
 * A lotus petal along +y from its base at the origin, as the current path: swelling out from the
 * base and narrowing to a sharp tip, which turns `lift` to the petal's left, toward upright once
 * the petal is spread out to the right.
 */
function lotusPetal(
  ctx: CanvasRenderingContext2D,
  length: number,
  width: number,
  lift: number,
): void {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(
    -width * 0.62,
    length * 0.28,
    -width * 0.4 - lift * 0.9,
    length * 0.78,
    -lift,
    length,
  );
  ctx.bezierCurveTo(
    width * 0.42 - lift * 0.4,
    length * 0.74,
    width * 0.66,
    length * 0.26,
    0,
    0,
  );
  ctx.closePath();
}

/** Stamens rising from the heart of the flower, fading in as it opens by `amount`. */
function drawStamens(
  ctx: CanvasRenderingContext2D,
  amount: number,
  paint: Paint,
  vein: Vein,
): void {
  const strength = amount * vein.alpha;
  if (strength <= 0.01) {
    return;
  }
  ctx.save();
  ctx.globalAlpha *= strength;
  ctx.strokeStyle = paint.outline;
  ctx.lineWidth = vein.width * 1.3;
  ctx.fillStyle = css(POLLEN, Math.min(1, paint.base[0] / 248));
  for (const stamen of STAMENS) {
    const length = stamen.length * lerp(0.5, 1, amount);
    const tipX = Math.sin(stamen.lean) * length;
    const tipY = 0.08 + Math.cos(stamen.lean) * length;
    ctx.beginPath();
    ctx.moveTo(0, 0.1);
    ctx.quadraticCurveTo(tipX * 0.2, 0.08 + length * 0.6, tipX, tipY);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(tipX, tipY, 0.022, 0.036, -stamen.lean, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCloud(
  ctx: CanvasRenderingContext2D,
  open: number,
  wilt: number,
  paint: Paint,
  line: number,
  vein: Vein,
): void {
  const middle = lerp(0.3, 0.52, open);
  const gather = lerp(0.32, 1, open);
  const lobes = CLOUD.map((lobe) => ({
    x: lobe.x * gather,
    y: middle + (lobe.y - 0.52) * gather * (1 - 0.15 * wilt) - 0.05 * wilt,
    r: lobe.r * lerp(0.6, 1, open) * (1 - 0.2 * wilt),
  }));
  const lowest = Math.min(...lobes.map((lobe) => lobe.y - lobe.r));

  // A small cup of ink where the cluster sits on its stalk.
  ctx.fillStyle = paint.ink;
  ctx.beginPath();
  ctx.moveTo(-0.03, 0);
  ctx.quadraticCurveTo(-0.11, lowest + 0.02, -0.06, lowest + 0.08);
  ctx.lineTo(0.06, lowest + 0.08);
  ctx.quadraticCurveTo(0.11, lowest + 0.02, 0.03, 0);
  ctx.closePath();
  ctx.fill();

  // The outline is stroked twice as wide as it shows; filling the lobes over it leaves only
  // their shared outer edge.
  ctx.strokeStyle = paint.outline;
  ctx.lineWidth = line * 2;
  for (const lobe of lobes) {
    ctx.beginPath();
    ctx.arc(lobe.x, lobe.y, lobe.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  const fill = ctx.createRadialGradient(
    0,
    middle - 0.06,
    0,
    0,
    middle,
    0.62 * gather,
  );
  fill.addColorStop(0, css(paint.base));
  fill.addColorStop(1, css(paint.tip));
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (const lobe of lobes) {
    ctx.moveTo(lobe.x + lobe.r, lobe.y);
    ctx.arc(lobe.x, lobe.y, lobe.r, 0, Math.PI * 2);
  }
  // Fills the gaps the lobes leave between them, where their outlines would show through.
  const core = 0.28 * gather;
  ctx.moveTo(core, middle);
  ctx.arc(0, middle, core, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = vein.width;
  ctx.globalAlpha *= 0.4 * vein.alpha;
  ctx.beginPath();
  for (const lobe of lobes.slice(CLOUD_OVERLAPPING)) {
    const r = lobe.r * 0.62;
    const y = lobe.y + 0.1 * lobe.r;
    ctx.moveTo(
      lobe.x + r * Math.cos(1.2 * Math.PI),
      y + r * Math.sin(1.2 * Math.PI),
    );
    ctx.arc(lobe.x, y, r, 1.2 * Math.PI, 1.8 * Math.PI);
  }
  ctx.stroke();
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  open: number,
  wilt: number,
  paint: Paint,
  line: number,
  vein: Vein,
  variant: number,
): void {
  const center = lerp(0.06, STAR.center, open);
  const length = STAR.length * lerp(0.82, 1, open) * (1 - 0.12 * wilt);
  const width = STAR.width * lerp(0.4, 1, open) * (1 - 0.35 * wilt);
  const turn = (variant - 0.5) * 0.5;
  for (let i = 0; i < STAR.petals; i += 1) {
    // Closed, the petals furl into a slender upright spindle; opening, they fan out into a star.
    const middle = i - (STAR.petals - 1) / 2;
    const furled = middle * 0.07;
    const fanned = turn + (middle * Math.PI * 2) / STAR.petals;
    ctx.save();
    ctx.translate(0, center);
    ctx.rotate(lerp(furled, fanned, open) + 0.3 * wilt * Math.sign(middle));
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(
      -width * 0.16,
      length * 0.3,
      -width * 0.6,
      length * 0.58,
      -width * 0.42,
      length * 0.9,
    );
    ctx.bezierCurveTo(
      -width * 0.26,
      length * 1.08,
      width * 0.34,
      length * 1.08,
      width * 0.5,
      length * 0.8,
    );
    ctx.bezierCurveTo(
      width * 0.6,
      length * 0.52,
      width * 0.22,
      length * 0.2,
      0,
      0,
    );
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, 0, 0, length);
    fill.addColorStop(0, css(paint.base));
    fill.addColorStop(0.7, css(paint.tip));
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = paint.outline;
    ctx.lineWidth = line;
    ctx.stroke();
    ctx.lineWidth = vein.width;
    ctx.globalAlpha *= 0.28 * vein.alpha;
    ctx.beginPath();
    ctx.moveTo(0, length * 0.16);
    ctx.quadraticCurveTo(
      width * 0.02,
      length * 0.5,
      width * 0.08,
      length * 0.76,
    );
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = paint.ink;
  ctx.globalAlpha *= 0.6;
  ctx.beginPath();
  ctx.arc(0, center, 0.03, 0, Math.PI * 2);
  ctx.fill();
}

/** A pointed leaf along +y from the origin, as the current path. */
function leaf(
  ctx: CanvasRenderingContext2D,
  length: number,
  width: number,
): void {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-width, length * 0.45, 0, length);
  ctx.quadraticCurveTo(width, length * 0.45, 0, 0);
  ctx.closePath();
}

function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

/** A color under a light, as multipliers on each channel. */
function lit(color: Rgb, light: Rgb): Rgb {
  return [color[0] * light[0], color[1] * light[1], color[2] * light[2]];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function css(color: Rgb, shade = 1): string {
  return `rgb(${Math.round(color[0] * shade)}, ${Math.round(color[1] * shade)}, ${Math.round(color[2] * shade)})`;
}
