import type { Camera } from "./camera";
import { BODY_SIZE, css, type Rgb, type SkyLight, skyBodyAt } from "./sky";
import { invariant, smoothstep, valueNoise } from "./util";

/** How finely the rays are worked out, as a share of the canvas's size: coarsely, being soft. */
const SCALE = 0.25;

/**
 * The light the rays stream from: how far the glow about the sun or the moon reaches, in multiples
 * of its radius; how many streaks it breaks into round about, how much each may dim, and how fast
 * they turn, in radians a second; and how the moon's light compares with the sun's, and its color.
 */
const SOURCE = {
  glow: 9,
  streaks: 30,
  dims: 0.7,
  turn: 0.015,
  moon: 0.5,
  moonlight: [214, 222, 240] as Rgb,
} as const;

/**
 * How the light is smeared out from where it shines into rays: in two passes of `copies` copies
 * each, every copy `step` farther out than the last as a share of its distance from the light, the
 * second pass's steps as long as all of the first's.
 */
const SMEAR = { copies: 8, step: 0.05 } as const;

/** How strongly the rays lie over the scene at their strongest setting. */
const STRONGEST = 1.4;

/**
 * Rays of light streaming from the sun by day and the moon by night, as shafts through the air,
 * broken where the mountains, the wood and the ground stand against the light. They are worked out
 * as light seen through haze is: a glow about the sun or the moon, broken into streaks, with what
 * stands against it cut away, smeared out from it, and laid over the scene.
 */
export class Rays {
  private readonly source = document.createElement("canvas");
  private readonly once = document.createElement("canvas");
  private readonly twice = document.createElement("canvas");

  /**
   * Lays the rays over the scene in `ctx`, `strength` of the way from none at 0 to their strongest
   * at 1, `clock` seconds in, with `blocking` standing against the light, in device pixels.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    light: SkyLight,
    strength: number,
    clock: number,
    blocking: readonly Path2D[],
  ): void {
    if (strength <= 0) {
      return;
    }
    const clear = 1 - light.veiled;
    const bySun = smoothstep(-0.04, 0.08, light.sun.height) * clear * light.direct;
    const byMoon =
      smoothstep(-0.04, 0.08, light.moon.height) *
      clear *
      (1 - light.daylight) *
      SOURCE.moon;
    const shine = Math.max(bySun, byMoon);
    if (shine < 0.01) {
      return;
    }
    const sun = bySun >= byMoon;
    const color = sun ? light.sunColor : SOURCE.moonlight;
    const width = Math.ceil(ctx.canvas.width * SCALE);
    const height = Math.ceil(ctx.canvas.height * SCALE);
    for (const canvas of [this.source, this.once, this.twice]) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }
    const where = skyBodyAt(camera, sun ? light.sun : light.moon);
    const cx = where.x * camera.dpr * SCALE;
    const cy = where.y * camera.dpr * SCALE;
    const radius = BODY_SIZE * camera.height * camera.dpr * SCALE;

    // The glow about the sun or the moon, broken into streaks turning slowly about it.
    const glow = context(this.source);
    glow.setTransform(1, 0, 0, 1, 0, 0);
    glow.globalCompositeOperation = "source-over";
    glow.globalAlpha = 1;
    glow.clearRect(0, 0, width, height);
    const halo = glow.createRadialGradient(
      cx,
      cy,
      0,
      cx,
      cy,
      radius * SOURCE.glow,
    );
    halo.addColorStop(0, css(color, 1));
    halo.addColorStop(0.12, css(color, 0.85));
    halo.addColorStop(0.4, css(color, 0.3));
    halo.addColorStop(1, css(color, 0));
    glow.fillStyle = halo;
    glow.fillRect(0, 0, width, height);
    glow.globalCompositeOperation = "destination-out";
    const reach = Math.hypot(width, height);
    const turn = clock * SOURCE.turn;
    for (let i = 0; i < SOURCE.streaks; i += 1) {
      const a0 = turn + (i / SOURCE.streaks) * Math.PI * 2;
      const a1 = turn + ((i + 1) / SOURCE.streaks) * Math.PI * 2;
      const dim = SOURCE.dims * (0.5 + 0.5 * valueNoise(i * 1.7, 811));
      glow.fillStyle = `rgba(0, 0, 0, ${dim})`;
      glow.beginPath();
      glow.moveTo(cx, cy);
      glow.lineTo(cx + Math.cos(a0) * reach, cy + Math.sin(a0) * reach);
      glow.lineTo(cx + Math.cos(a1) * reach, cy + Math.sin(a1) * reach);
      glow.closePath();
      glow.fill();
    }
    // What stands against the light blocks it.
    glow.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    glow.fillStyle = "#000";
    for (const shape of blocking) {
      glow.fill(shape);
    }

    smear(this.source, this.once, cx, cy, SMEAR.step);
    smear(this.once, this.twice, cx, cy, SMEAR.step * SMEAR.copies);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "screen";
    ctx.imageSmoothingEnabled = true;
    let left = strength * STRONGEST * shine;
    while (left > 0.01) {
      ctx.globalAlpha = Math.min(1, left);
      ctx.drawImage(this.twice, 0, 0, ctx.canvas.width, ctx.canvas.height);
      left -= 1;
    }
    ctx.restore();
  }
}

/**
 * Smears `from` out from (`cx`, `cy`) into `to`: copies of it laid one over another, each `step`
 * farther out than the last as a share of its distance from there, and fainter the farther out.
 */
function smear(
  from: HTMLCanvasElement,
  to: HTMLCanvasElement,
  cx: number,
  cy: number,
  step: number,
): void {
  const ctx = context(to);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, to.width, to.height);
  ctx.globalCompositeOperation = "lighter";
  const n = SMEAR.copies;
  for (let i = 0; i < n; i += 1) {
    const scale = 1 + step * i;
    ctx.globalAlpha = (2 * (n - i)) / (n * (n + 1));
    ctx.setTransform(scale, 0, 0, scale, cx * (1 - scale), cy * (1 - scale));
    ctx.drawImage(from, 0, 0);
  }
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  invariant(ctx, "The rays need a 2D canvas to work on.");
  return ctx;
}
