import type { Rgb } from "./sky";
import { Rng } from "./util";
import type { Wind } from "./wind";

/** Lying snow by day, before the light falls on it. */
export const SNOW_COLOR: Rgb = [250, 248, 243];

/** The weather, as the debug panel sets it. */
export interface WeatherSettings {
  /** How hard it rains, from 0 dry to 1 a downpour. */
  rain: number;
  /** How hard it snows, from 0 to 1 a blizzard. */
  snow: number;
  /** How quickly lying snow melts, as a multiple of the usual. */
  melt: number;
  /** How much of the sky the clouds cover, from 0 clear to 1 overcast. */
  clouds: number;
  /** How high the clouds hang, from 0 down on the ground as fog to 1 high in the sky. */
  cloudHeight: number;
  /** Whether the clouds are outlined in ink, as the mountains are. */
  cloudOutline: boolean;
}

/**
 * How snow falls, lies and melts. It lands on level wood, the flowers and the ground, and piles
 * up on wood as deep as `heap` times the wood is wide, but no deeper than `deepest`, so a twig
 * holds a little and a thick limb a lot.
 */
export const SNOW = {
  /** Density of lying snow, in kilograms per cubic meter. */
  density: 150,
  /** Snow landing on level ground in a blizzard, in kilograms per square meter each second. */
  fall: 1.5,
  /** How deep snow can pile on wood, as a multiple of the wood's width, and at most, in meters. */
  heap: 3,
  deepest: 0.25,
  /** Most snow a flower holds, in kilograms per square meter of its size squared. */
  flowerHold: 6,
  /** Deepest snow lies on the ground, in meters. */
  groundDeepest: 0.8,
  /** Fraction of lying snow that melts each second at the usual rate. */
  melt: 0.03,
  /**
   * Melting snow on a stretch of wood or a flower lighter than this, in kilograms, or on the
   * ground shallower than `traceDepth`, in meters, has melted away.
   */
  trace: 0.002,
  traceDepth: 0.001,
  /** A downpour melts snow this many times faster again. */
  rainMelt: 4,
} as const;

/** How the rain and snow fall across the view, in CSS pixels. */
const FALL = {
  /** Most raindrops and snowflakes in view, per million square pixels, in a downpour or blizzard. */
  drops: 260,
  flakes: 420,
  /** Speed raindrops and snowflakes fall, in pixels per second. */
  rainSpeed: 1100,
  snowSpeed: 70,
  /** Pixels per second each meter per second of wind carries them sideways. */
  drift: 22,
  /** Length of a raindrop's streak, in seconds of its fall. */
  streak: 0.022,
  /** Furthest a snowflake sways to either side as it falls, in pixels per second. */
  sway: 14,
} as const;

/** A raindrop or snowflake falling across the view, in CSS pixels. */
export interface Particle {
  x: number;
  y: number;
  /** Speed it falls at, as a fraction of the usual, so nearer ones fall faster. */
  speed: number;
  /** Size, from 0 to 1. */
  size: number;
  /** Progress through a snowflake's side-to-side sway, in radians. */
  phase: number;
}

/** Snow and rain falling across the view, and snow lying on the ground. */
export class Weather {
  readonly settings: WeatherSettings;
  /** Depth of snow lying on the ground, in meters. */
  groundSnow = 0;
  drops: Particle[] = [];
  flakes: Particle[] = [];
  /** Sideways speed of the rain and snow, in pixels per second. */
  drift = 0;
  private readonly rng = new Rng(52711);

  constructor(settings: WeatherSettings) {
    this.settings = settings;
  }

  /** Snow landing on level ground, in kilograms per square meter each second. */
  get snowfall(): number {
    return this.settings.snow * SNOW.fall;
  }

  /** Fraction of lying snow that melts each second. */
  get melt(): number {
    return (
      SNOW.melt * this.settings.melt * (1 + SNOW.rainMelt * this.settings.rain)
    );
  }

  /**
   * Lets the snow on the ground pile up and melt, and moves the rain and snow falling across a
   * view `width` by `height` CSS pixels.
   */
  update(dt: number, wind: Wind, width: number, height: number): void {
    const depth = Math.min(
      SNOW.groundDeepest,
      this.groundSnow * Math.exp(-this.melt * dt) +
        (this.snowfall / SNOW.density) * dt,
    );
    this.groundSnow =
      depth < this.groundSnow && depth < SNOW.traceDepth ? 0 : depth;
    // The rain and snow are carried by the wind across the view, but only sideways: they fall
    // whichever way it blows.
    const air = wind.at(0, 10, 0);
    this.drift = air.x * FALL.drift;
    const area = (width * height) / 1e6;
    this.drops = this.fall(
      this.drops,
      Math.round(FALL.drops * area * this.settings.rain),
      dt,
      { speed: FALL.rainSpeed, sway: 0 },
      width,
      height,
    );
    this.flakes = this.fall(
      this.flakes,
      Math.round(FALL.flakes * area * this.settings.snow),
      dt,
      { speed: FALL.snowSpeed, sway: FALL.sway },
      width,
      height,
    );
  }

  /** Length of a raindrop's streak at its speed, in pixels across and down. */
  streak(drop: Particle): { x: number; y: number } {
    return {
      x: this.drift * drop.speed * FALL.streak,
      y: FALL.rainSpeed * drop.speed * FALL.streak,
    };
  }

  /**
   * Moves `particles` down the view at `speed`, swaying by up to `sway`, both in pixels per
   * second, wrapping those that leave it back in at the top, and adds or removes some so there
   * are `count`.
   */
  private fall(
    particles: Particle[],
    count: number,
    dt: number,
    { speed, sway }: { speed: number; sway: number },
    width: number,
    height: number,
  ): Particle[] {
    const kept = particles.slice(0, count);
    while (kept.length < count) {
      kept.push({
        x: this.rng.next() * width,
        y: this.rng.next() * height,
        speed: 0.7 + 0.6 * this.rng.next(),
        size: this.rng.next(),
        phase: this.rng.next() * Math.PI * 2,
      });
    }
    for (const p of kept) {
      p.phase += dt * (1.2 + p.size);
      p.y += dt * speed * p.speed;
      p.x += dt * (this.drift * p.speed + sway * p.size * Math.sin(p.phase));
      if (p.y > height) {
        p.y -= height + 20;
        p.x = this.rng.next() * width;
      }
      p.x = ((p.x % width) + width) % width;
    }
    return kept;
  }
}
