import type { Camera } from "./camera";
import { BODY_SIZE, css, mix, type Rgb, skyBodyAt, type SkyLight } from "./sky";
import { approach, at, lerp, Rng, smoothstep } from "./util";
import type { WeatherSettings } from "./weather";
import type { Wind } from "./wind";

/**
 * How the clouds are laid out and drift. Each is a bank of layers like brushstrokes, after the
 * banded clouds of old Japanese prints rather than puffs: each has a round head and a long tail
 * tapering to a point, and the layers stack with their heads together. The banks drift around a
 * strip of sky wider than the view.
 */
const CLOUDS = {
  /** Banks in the strip of sky they drift around. */
  count: 26,
  /** Length of that strip, in view widths: banks drifting out of one side come in at the other. */
  loop: 2.5,
  /** Width of a bank, as a fraction of the view's width, from the smallest to the largest. */
  width: { from: 0.16, to: 0.4 },
  /** Thickness of a bank's main layer, as a fraction of its width. */
  thickness: { from: 0.08, to: 0.12 },
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

/** Banks are the sky lightened this far toward this pale, by day and by night. */
const CLOUD_LIGHT: Rgb = [255, 252, 245];
const LIGHTEN = { day: 0.7, night: 0.2 } as const;
/** Far banks are tinted this far toward the sky behind them. */
const FAR_TINT = 0.35;
/**
 * Shading, far lighter than the mountains': each layer is hatched along its underside, in lines
 * this far apart and this wide, in CSS pixels at the base horizon height, leaning this far from
 * upright, in radians, up to `reach` of the way into the layer; and a fine line is carved along
 * its top, so the layers stacked in a bank read apart. Both are ink, this strong by day and by
 * night.
 */
const SHADING = {
  gap: 4.2,
  width: 0.7,
  tilt: 0.55,
  reach: 0.5,
  hatch: { day: 0.14, night: 0.12 },
  carve: { day: 0.22, night: 0.16 },
  carveWidth: 0.9,
} as const;

/**
 * Shadows the banks cast on the mountains while the sun shines: this dark at most, falling this
 * far down the view below the horizon line, and cast away from the sun by this fraction of a
 * bank's distance from it.
 */
const SHADOW = { alpha: 0.16, low: 0.06, height: 0.035, cast: 0.35 } as const;

/**
 * A layer of a bank, like a brushstroke: from the point of its long tail, its top rises to a crest
 * `height` above it two thirds of the way along, rounds over its head, and its underside runs back
 * to the point, sagging a third as far below. In units of the bank's width, from the bank's left
 * end and its middle; `tail` is the side its tail is on.
 */
interface Layer {
  x: number;
  y: number;
  width: number;
  height: number;
  tail: -1 | 1;
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
          tail: layer.tail,
        })),
      });
    }
    return placed;
  }

  /**
   * Draws `banks` in `light`, far ones first, each layer back to front: filled flat, hatched lightly
   * along its underside, and carved along its top, or outlined in ink when chosen.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    light: SkyLight,
    banks: readonly PlacedBank[],
  ): void {
    ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
    const scale = camera.groundY / BASE_HORIZON;
    const color = cloudColor(light);
    const hatch = css(
      light.ink,
      lerp(SHADING.hatch.night, SHADING.hatch.day, light.daylight),
    );
    const carve = css(
      light.ink,
      lerp(SHADING.carve.night, SHADING.carve.day, light.daylight),
    );
    const outline = css(
      light.guide,
      lerp(CLOUDS.lineAlpha.night, CLOUDS.lineAlpha.day, light.daylight),
    );
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const bank of banks) {
      ctx.globalAlpha = bank.alpha;
      const fill = css(
        mix(color, light.sky.middle, FAR_TINT * (1 - bank.depth)),
      );
      for (const layer of bank.layers) {
        const shape = new Path2D();
        addLayer(shape, layer);
        ctx.fillStyle = fill;
        ctx.fill(shape);

        // The hatching lies in a crescent along the underside: inside the layer, and outside
        // the same layer lifted part of the way up.
        ctx.save();
        ctx.clip(shape);
        const below = new Path2D();
        below.rect(
          layer.x - layer.height,
          layer.y - 2 * layer.height,
          layer.width + 2 * layer.height,
          4 * layer.height,
        );
        addLayer(below, {
          ...layer,
          y: layer.y - SHADING.reach * layer.height,
        });
        ctx.clip(below, "evenodd");
        ctx.strokeStyle = hatch;
        ctx.lineWidth = SHADING.width * scale;
        ctx.stroke(hatching(layer, SHADING.gap * scale));
        ctx.restore();

        if (this.settings.cloudOutline) {
          ctx.strokeStyle = outline;
          ctx.lineWidth = CLOUDS.line * scale;
          ctx.stroke(shape);
        } else {
          const top = new Path2D();
          addTop(top, layer);
          ctx.strokeStyle = carve;
          ctx.lineWidth = SHADING.carveWidth * scale;
          ctx.stroke(top);
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
          if (inLayer(layer, x + dx * radius, y + dy * radius)) {
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
 * A bank of two to four layers with their heads together: a long main layer in front, a shorter
 * one rising behind it, sometimes a short crown on top, and sometimes a thin wisp trailing low
 * behind its tail. The `index`th of the banks shows once the cover reaches about its share.
 */
function makeBank(rng: Rng, index: number): Bank {
  const thickness = lerp(
    CLOUDS.thickness.from,
    CLOUDS.thickness.to,
    rng.next(),
  );
  const tail = rng.next() < 0.5 ? -1 : 1;
  // Laid out with the tails to the left, then turned around if they point right.
  const layers: Omit<Layer, "tail">[] = [];
  if (rng.next() < 0.55) {
    const crown = lerp(0.28, 0.38, rng.next());
    layers.push({
      x: 1 - crown - lerp(0.12, 0.24, rng.next()),
      y: -thickness * lerp(1.05, 1.3, rng.next()),
      width: crown,
      height: thickness * lerp(0.75, 0.9, rng.next()),
    });
  }
  const upper = lerp(0.5, 0.66, rng.next());
  layers.push({
    x: 1 - upper - lerp(0.04, 0.14, rng.next()),
    y: -thickness * lerp(0.55, 0.75, rng.next()),
    width: upper,
    height: thickness * lerp(0.85, 1, rng.next()),
  });
  if (rng.next() < 0.4) {
    layers.push({
      x: -lerp(0.08, 0.16, rng.next()),
      y: thickness * lerp(0.1, 0.25, rng.next()),
      width: lerp(0.4, 0.55, rng.next()),
      height: thickness * lerp(0.35, 0.5, rng.next()),
    });
  }
  layers.push({ x: 0, y: 0, width: 1, height: thickness });
  return {
    along: rng.next() * CLOUDS.loop,
    rise: rng.next() * 2 - 1,
    width: lerp(CLOUDS.width.from, CLOUDS.width.to, rng.next()),
    depth: rng.next(),
    shows: (index + 0.6 * rng.next()) / CLOUDS.count,
    layers: layers.map((layer) => ({
      ...layer,
      x: tail < 0 ? layer.x : 1 - layer.x - layer.width,
      tail,
    })),
  };
}

/**
 * The points a layer is drawn through, as fractions of its length from the point of its tail and
 * of its height below the line through that point: the top over the crest to the front of the
 * head, then round under the head and back along the underside, each a cubic curve's two control
 * points and its end.
 */
const TOP: readonly (readonly [number, number])[] = [
  [0.3, -0.12],
  [0.48, -1],
  [0.7, -1],
  [0.86, -1],
  [1, -0.68],
  [1, -0.32],
];
const UNDER: readonly (readonly [number, number])[] = [
  [1, 0.02],
  [0.93, 0.27],
  [0.8, 0.3],
  [0.6, 0.33],
  [0.26, 0.13],
  [0, 0],
];

/** Where the point `u` along `layer` from its tail and `v` of its height down lies, in pixels. */
function layerPoint(
  layer: Layer,
  [u, v]: readonly [number, number],
): { x: number; y: number } {
  return {
    x: layer.x + (layer.tail < 0 ? u : 1 - u) * layer.width,
    y: layer.y + v * layer.height,
  };
}

/** Adds the curves through `points`, three to a curve, to `path`. */
function addCurves(
  path: Path2D,
  layer: Layer,
  points: readonly (readonly [number, number])[],
): void {
  for (let i = 0; i + 2 < points.length; i += 3) {
    const a = layerPoint(layer, at(points, i));
    const b = layerPoint(layer, at(points, i + 1));
    const c = layerPoint(layer, at(points, i + 2));
    path.bezierCurveTo(a.x, a.y, b.x, b.y, c.x, c.y);
  }
}

/** Adds the outline of `layer` to `path`. */
function addLayer(path: Path2D, layer: Layer): void {
  const start = layerPoint(layer, [0, 0]);
  path.moveTo(start.x, start.y);
  addCurves(path, layer, TOP);
  addCurves(path, layer, UNDER);
  path.closePath();
}

/** Adds the top of `layer`, from the point of its tail over its crest to its head, to `path`. */
function addTop(path: Path2D, layer: Layer): void {
  const start = layerPoint(layer, [0, 0]);
  path.moveTo(start.x, start.y);
  addCurves(path, layer, TOP);
}

/** Hatching lines `gap` pixels apart, leaning from upright, across the whole of `layer`. */
function hatching(layer: Layer, gap: number): Path2D {
  const path = new Path2D();
  const dx = Math.sin(SHADING.tilt);
  const dy = Math.cos(SHADING.tilt);
  const top = layer.y - layer.height * 1.1;
  const bottom = layer.y + layer.height * 0.4;
  const rise = (bottom - top) * (dx / dy);
  for (let x = layer.x - rise; x <= layer.x + layer.width; x += gap) {
    path.moveTo(x, top);
    path.lineTo(x + rise, bottom);
  }
  return path;
}

/** Whether (px, py) lies inside `layer`, near enough. */
function inLayer(layer: Layer, px: number, py: number): boolean {
  const along = (px - layer.x) / layer.width;
  const u = layer.tail < 0 ? along : 1 - along;
  if (u <= 0 || u >= 1) {
    return false;
  }
  const arch = Math.sin(Math.PI * Math.pow(u, 1.94));
  return (
    py >= layer.y - layer.height * arch &&
    py <= layer.y + 0.3 * layer.height * arch
  );
}

/** Color of the clouds in `light`: the sky, lightened, more by day than by night. */
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
