import type { Camera } from "./camera";
import { BODY_SIZE, css, mix, type Rgb, skyBodyAt, type SkyLight } from "./sky";
import { approach, lerp, Rng, smoothstep } from "./util";
import type { WeatherSettings } from "./weather";
import type { Wind } from "./wind";

/**
 * How the clouds are laid out and drift. Each is a bank of long layers tapering to a point at
 * either end, after the banded mist of old Japanese prints rather than puffs, and the banks drift
 * around a strip of sky wider than the view.
 */
const CLOUDS = {
  /** Banks in the strip of sky they drift around. */
  count: 26,
  /** Length of that strip, in view widths: banks drifting out of one side come in at the other. */
  loop: 2.5,
  /** Width of a bank, as a fraction of the view's width, from the smallest to the largest. */
  width: { from: 0.16, to: 0.4 },
  /** Thickness of a bank's main layer, as a fraction of its width. */
  thickness: { from: 0.09, to: 0.15 },
  /** Lowest and highest a bank's middle hangs, as fractions of the sky's height above the horizon. */
  low: 0.14,
  high: 0.84,
  /** How far above and below their height banks spread, as a fraction of the sky's height. */
  spread: 0.1,
  /** Banks grow from this to this times their size as the sky fills. */
  growth: { from: 0.75, to: 1.35 },
  /** A bank comes in over this much cover once the sky's cover reaches its own. */
  fadeIn: 0.08,
  /**
   * How fast banks drift, in view widths per second: for each meter per second of wind, and
   * always, even in still air. Far banks drift `far` as fast, and are that much smaller.
   */
  drift: 0.0024,
  still: 0.004,
  far: 0.6,
  /** Seconds the light takes to follow a bank across the sun. */
  passing: 0.6,
  /** Width of the outlines, in CSS pixels at the base horizon height, and how strongly they show. */
  line: 1.3,
  lineAlpha: { day: 0.6, night: 0.4 },
} as const;

/** Horizon height the line widths are given for, in CSS pixels; lines scale with the view. */
const BASE_HORIZON = 666;

/** How the clouds change the light. */
const OVERCAST = {
  /** The sky turns this far toward grey under full cover. */
  grey: 0.7,
  /** Grey of an overcast sky by day and by night. */
  day: [216, 212, 204] as Rgb,
  night: [42, 46, 58] as Rgb,
  /** Full cover takes away this much of the direct light, and a bank over the sun this much. */
  diffuse: 0.7,
  shade: 0.85,
  /** Full cover dulls sunrise and sunset by this much. */
  twilight: 0.65,
  /** Flowers are lit this much less with no direct light at all. */
  dim: 0.22,
  /** Cover past `from` starts to hide the sun, moon and stars, and by `to` hides them. */
  hide: { from: 0.55, to: 0.95 },
} as const;

/** Clouds hanging below `from` of the way up the sky are all fog, and above `to` none. */
const FOG = { from: 0.06, to: 0.32 } as const;

/** Banks this pale lighten toward, at their tops, by day and by night. */
const CLOUD_LIGHT: Rgb = [255, 252, 245];
const LIGHTEN = { day: 0.8, night: 0.2 } as const;
/** A layer's underside is this much darker than its top. */
const UNDERSIDE = 0.84;
/** Far banks are tinted this far toward the sky behind them. */
const FAR_TINT = 0.35;

/**
 * Shadows the banks cast on the mountains while the sun shines: this dark at most, falling this
 * far down the view below the horizon line, and cast away from the sun by this fraction of a
 * bank's distance from it.
 */
const SHADOW = { alpha: 0.16, low: 0.06, height: 0.035, cast: 0.35 } as const;

/**
 * A layer of a bank: a lens tapering to a point at each end, its top arching `height` above its
 * tips and its underside sagging a third as far below. In units of the bank's width, from the
 * bank's left end and its middle.
 */
interface Layer {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Bank {
  /** Where along the strip it starts, in view widths. */
  along: number;
  /** Where it hangs, from -1 below the clouds' height to 1 above it. */
  rise: number;
  width: number;
  /** From 0 far to 1 near. */
  depth: number;
  /** Cover the sky must reach for this bank to show. */
  shows: number;
  /** Back to front. */
  layers: Layer[];
}

/** A cloud's shadow on the mountains: a soft oval, in CSS pixels, this dark at its middle. */
export interface CloudShadow {
  x: number;
  y: number;
  rx: number;
  ry: number;
  alpha: number;
}

/** A bank where it shows in the view, in CSS pixels. */
export interface PlacedBank {
  /** Its layers, back to front, each from its left tip, along the line through its tips. */
  layers: Layer[];
  /** How strongly it shows, from 0 to 1. */
  alpha: number;
  depth: number;
  /** Its middle. */
  x: number;
  y: number;
  width: number;
}

/** The clouds drifting across the sky, and the fog low cloud lays over the scene. */
export class Clouds {
  readonly settings: WeatherSettings;
  /** How far the banks have drifted, in view widths. */
  private drift = 0;
  /** How much of the sun or the moon the banks hide, eased as they pass. */
  private covered = 0;
  private readonly banks: Bank[];

  constructor(settings: WeatherSettings) {
    this.settings = settings;
    const rng = new Rng(80321);
    this.banks = Array.from({ length: CLOUDS.count }, (_, i) =>
      makeBank(rng, i),
    ).sort((a, b) => a.depth - b.depth);
  }

  /** How thick the fog lying over the scene is, from 0 to 1: a full sky of low cloud. */
  get fog(): number {
    return (
      this.settings.clouds *
      (1 - smoothstep(FOG.from, FOG.to, this.settings.cloudHeight))
    );
  }

  /** Drifts the banks with `wind`, and follows how much of the sun or moon they hide. */
  update(dt: number, wind: Wind, camera: Camera, light: SkyLight): void {
    const air = wind.at(0, 30, 0);
    this.drift += dt * (CLOUDS.still + CLOUDS.drift * air.x);
    const body = light.daylight > 0.5 ? light.sun : light.moon;
    const at = skyBodyAt(camera, body);
    const hidden = this.hiding(
      this.placed(camera),
      at.x,
      at.y,
      BODY_SIZE * camera.height,
    );
    this.covered = approach(this.covered, hidden, CLOUDS.passing, dt);
  }

  /**
   * `light` under these clouds: the sky greyed by their cover, the direct light cut by it and by
   * any bank across the sun or moon, and sunrise, sunset and the flowers dulled to match.
   */
  shine(light: SkyLight): SkyLight {
    const cover = this.settings.clouds;
    const grey = mix(OVERCAST.night, OVERCAST.day, light.daylight);
    const toward = (color: Rgb): Rgb => mix(color, grey, OVERCAST.grey * cover);
    const direct =
      (1 - OVERCAST.diffuse * cover) * (1 - OVERCAST.shade * this.covered);
    const dim = 1 - OVERCAST.dim * (1 - direct);
    return {
      ...light,
      sky: {
        glow: toward(light.sky.glow),
        middle: toward(light.sky.middle),
        edge: toward(light.sky.edge),
      },
      twilight: light.twilight * (1 - OVERCAST.twilight * cover),
      flowerLight: [
        light.flowerLight[0] * dim,
        light.flowerLight[1] * dim,
        light.flowerLight[2] * dim,
      ],
      direct,
      veiled: smoothstep(OVERCAST.hide.from, OVERCAST.hide.to, cover),
    };
  }

  /** The banks showing in the view, far ones first. */
  placed(camera: Camera): PlacedBank[] {
    const cover = this.settings.clouds;
    const view = camera.width;
    const sky = camera.groundY;
    const middle = lerp(CLOUDS.low, CLOUDS.high, this.settings.cloudHeight);
    const grow = lerp(CLOUDS.growth.from, CLOUDS.growth.to, cover);
    const placed: PlacedBank[] = [];
    for (const bank of this.banks) {
      const alpha = smoothstep(bank.shows, bank.shows + CLOUDS.fadeIn, cover);
      if (alpha <= 0) {
        continue;
      }
      const far = lerp(CLOUDS.far, 1, bank.depth);
      const width = bank.width * grow * far * view;
      const along = wrap(bank.along + this.drift * far, CLOUDS.loop);
      const x = (along - 1) * view;
      if (x + width / 2 < 0 || x - width / 2 > view) {
        continue;
      }
      const y = camera.groundRow - (middle + bank.rise * CLOUDS.spread) * sky;
      placed.push({
        x,
        y,
        width,
        alpha,
        depth: bank.depth,
        layers: bank.layers.map((layer) => ({
          x: x + (layer.x - 0.5) * width,
          y: y + layer.y * width,
          width: layer.width * width,
          height: layer.height * width,
        })),
      });
    }
    return placed;
  }

  /** Draws `banks` in `light`, far ones first, each layer back to front. */
  draw(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    light: SkyLight,
    banks: readonly PlacedBank[],
  ): void {
    ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
    const top = cloudColor(light);
    const underside = mix([0, 0, 0], top, UNDERSIDE);
    const outlined = this.settings.cloudOutline;
    ctx.lineJoin = "round";
    ctx.lineWidth = (CLOUDS.line * camera.groundY) / BASE_HORIZON;
    ctx.strokeStyle = css(
      light.guide,
      lerp(CLOUDS.lineAlpha.night, CLOUDS.lineAlpha.day, light.daylight),
    );
    for (const bank of banks) {
      const tint = FAR_TINT * (1 - bank.depth);
      const upper = mix(top, light.sky.middle, tint);
      const lower = mix(underside, light.sky.middle, tint);
      ctx.globalAlpha = bank.alpha;
      for (const layer of bank.layers) {
        const lens = new Path2D();
        addLens(lens, layer);
        const shade = ctx.createLinearGradient(
          0,
          layer.y - layer.height,
          0,
          layer.y + layer.height / 3,
        );
        shade.addColorStop(0, css(upper));
        shade.addColorStop(1, css(lower));
        ctx.fillStyle = shade;
        ctx.fill(lens);
        if (outlined) {
          ctx.stroke(lens);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * The shadows the near banks cast on the mountains while the sun shines through a broken sky:
   * soft ovals, in CSS pixels, each this dark at its middle.
   */
  shadows(
    camera: Camera,
    light: SkyLight,
    banks: readonly PlacedBank[],
  ): CloudShadow[] {
    const sunUp = smoothstep(0, 0.15, light.sun.height);
    const alpha =
      SHADOW.alpha *
      sunUp *
      light.daylight *
      (1 - smoothstep(0.5, 0.9, this.settings.clouds));
    if (alpha < 0.005) {
      return [];
    }
    const sun = skyBodyAt(camera, light.sun);
    return banks
      .filter((bank) => bank.depth >= 0.4)
      .map((bank) => ({
        x: bank.x + (bank.x - sun.x) * SHADOW.cast,
        y: camera.groundRow - SHADOW.low * camera.groundY,
        rx: 0.45 * bank.width,
        ry: SHADOW.height * camera.groundY,
        alpha: alpha * bank.alpha,
      }));
  }

  /**
   * Lays the fog over everything drawn so far, `share` as thick as it is: thickest along the
   * ground, thinning upward.
   */
  drawFog(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    light: SkyLight,
    share: number,
  ): void {
    const thickness = this.fog * share;
    if (thickness < 0.005) {
      return;
    }
    ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
    const color = cloudColor(light);
    const veil = ctx.createLinearGradient(0, 0, 0, camera.height);
    const ground = camera.groundRow / camera.height;
    veil.addColorStop(0, css(color, 0.7 * thickness));
    veil.addColorStop(Math.min(1, Math.max(0, ground)), css(color, thickness));
    veil.addColorStop(1, css(color, 0.85 * thickness));
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, camera.width, camera.height);
  }

  /**
   * How much of the disc at (x, y), `radius` across, `banks` hide, from 0 to 1, with the sky's
   * own cover hiding it as well.
   */
  private hiding(
    banks: readonly PlacedBank[],
    x: number,
    y: number,
    radius: number,
  ): number {
    const samples = [
      [0, 0],
      [0.7, 0],
      [-0.7, 0],
      [0, 0.7],
      [0, -0.7],
    ] as const;
    let hidden = 0;
    for (const [dx, dy] of samples) {
      let most = 0;
      for (const bank of banks) {
        for (const layer of bank.layers) {
          if (inLens(layer, x + dx * radius, y + dy * radius)) {
            most = Math.max(most, bank.alpha);
          }
        }
      }
      hidden += most;
    }
    return Math.max(
      hidden / samples.length,
      smoothstep(OVERCAST.hide.from, OVERCAST.hide.to, this.settings.clouds),
    );
  }
}

/**
 * A bank of two to four layers: a long main layer in front, and shorter ones rising behind it to
 * one side or both, sometimes crowned by a small one on top. The `index`th of the banks shows
 * once the cover reaches about its share.
 */
function makeBank(rng: Rng, index: number): Bank {
  const thickness = lerp(
    CLOUDS.thickness.from,
    CLOUDS.thickness.to,
    rng.next(),
  );
  const side = rng.next() < 0.5 ? -1 : 1;
  const layers: Layer[] = [];
  // A small crown, furthest back.
  if (rng.next() < 0.5) {
    const crown = lerp(0.24, 0.34, rng.next());
    layers.push({
      x: 0.5 + side * lerp(0.0, 0.15, rng.next()) - crown / 2,
      y: -thickness * lerp(1.1, 1.35, rng.next()),
      width: crown,
      height: thickness * lerp(0.8, 1, rng.next()),
    });
  }
  // Behind, rising to one side.
  const upper = lerp(0.45, 0.65, rng.next());
  layers.push({
    x: 0.5 + side * lerp(0.08, 0.22, rng.next()) - upper / 2,
    y: -thickness * lerp(0.55, 0.8, rng.next()),
    width: upper,
    height: thickness * lerp(0.85, 1.05, rng.next()),
  });
  // Sometimes another, lower and to the other side.
  if (rng.next() < 0.7) {
    const lower = lerp(0.34, 0.5, rng.next());
    layers.push({
      x: 0.5 - side * lerp(0.16, 0.3, rng.next()) - lower / 2,
      y: -thickness * lerp(0.2, 0.4, rng.next()),
      width: lower,
      height: thickness * lerp(0.7, 0.9, rng.next()),
    });
  }
  // The main layer, in front.
  layers.push({ x: 0, y: 0, width: 1, height: thickness });
  return {
    along: rng.next() * CLOUDS.loop,
    rise: rng.next() * 2 - 1,
    width: lerp(CLOUDS.width.from, CLOUDS.width.to, rng.next()),
    depth: rng.next(),
    shows: (index + 0.6 * rng.next()) / CLOUDS.count,
    layers,
  };
}

/**
 * Adds a lens to `path`: from its left tip, a top arching `height` above the line through its
 * tips to its right tip, and back along an underside sagging a third as far.
 */
function addLens(path: Path2D, { x, y, width, height }: Layer): void {
  path.moveTo(x, y);
  path.bezierCurveTo(
    x + 0.25 * width,
    y - (4 / 3) * height,
    x + 0.75 * width,
    y - (4 / 3) * height,
    x + width,
    y,
  );
  path.bezierCurveTo(
    x + 0.75 * width,
    y + (4 / 9) * height,
    x + 0.25 * width,
    y + (4 / 9) * height,
    x,
    y,
  );
  path.closePath();
}

/** Whether (px, py) lies inside the lens `layer`, near enough. */
function inLens(layer: Layer, px: number, py: number): boolean {
  const u = (px - layer.x) / layer.width;
  if (u <= 0 || u >= 1) {
    return false;
  }
  const arch = 4 * u * (1 - u);
  return (
    py >= layer.y - layer.height * arch &&
    py <= layer.y + (layer.height / 3) * arch
  );
}

/** Color of the clouds' tops in `light`: the sky, lightened, more by day than by night. */
function cloudColor(light: SkyLight): Rgb {
  return mix(
    light.sky.middle,
    CLOUD_LIGHT,
    lerp(LIGHTEN.night, LIGHTEN.day, light.daylight),
  );
}

/** `value` wrapped into [0, `length`). */
function wrap(value: number, length: number): number {
  return ((value % length) + length) % length;
}
