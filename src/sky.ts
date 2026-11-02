import { clamp, lerp, smoothstep } from "./util";

export type Rgb = readonly [number, number, number];

/** When it is in the world: the time of day, whether the day moves on its own, and the time of year. */
export interface TimeSettings {
  /** From midnight at 0, through sunrise at 0.25, noon at 0.5 and sunset at 0.75. */
  timeOfDay: number;
  /** Whether the day moves on by itself, at the speed of the simulation. */
  dayRunning: boolean;
  /** From midsummer at 0 to winter at 1. Flowers turn, wilt and drop as it passes. */
  season: number;
}

/** Seconds a whole day and night takes at normal speed. */
export const DAY_SECONDS = 180;

/** Moves the time of day on by `dt` seconds, if the day is running. */
export function advanceDay(time: TimeSettings, dt: number): void {
  if (time.dayRunning) {
    time.timeOfDay = (time.timeOfDay + dt / DAY_SECONDS) % 1;
  }
}

/** The sky's colors at full day and in deep night: near the horizon, overhead, and at the edges. */
const SKY = {
  day: {
    glow: [243, 236, 223],
    middle: [237, 228, 210],
    edge: [220, 205, 177],
  },
  night: {
    glow: [70, 80, 108],
    middle: [48, 56, 80],
    edge: [30, 35, 52],
  },
} as const;
/** The sky at sunrise and sunset, which the whole sky leans toward: rose low down, lavender above. */
const DUSK = {
  glow: [224, 164, 140],
  middle: [178, 144, 154],
  edge: [118, 112, 142],
} as const;
/** Warm light along the horizon around sunrise and sunset, on the side the sun is on. */
const TWILIGHT: Rgb = [236, 150, 104];
/** Ink of the wood and ground at full day and in deep night. */
const INK = { day: [42, 33, 26], night: [14, 14, 20] } as const;
/** How the flowers' colors are lit in deep night and at sunrise or sunset, as multipliers. */
const FLOWER_LIGHT = {
  night: [0.36, 0.42, 0.6],
  twilight: [1, 0.86, 0.74],
} as const;
/** Ink of the guides drawn over the scene, which turns pale at night so it still shows. */
const GUIDE = { day: [42, 33, 26], night: [226, 222, 210] } as const;
/** Color of the sun high in the sky and as it meets the horizon. */
const SUN = { high: [234, 204, 150], low: [226, 146, 100] } as const;

/** A body in the sky: how far along its arc from the left horizon to the right, and whether it is up. */
export interface SkyBody {
  /** From 0 at the left horizon to 1 at the right; outside that range it has set. */
  along: number;
  /** How high it is, from 0 on the horizon to 1 overhead; negative below the horizon. */
  height: number;
}

/** How the sky and everything under it looks at one time of day. */
export interface SkyLight {
  /** From 0 in the dark of night to 1 in full day. */
  daylight: number;
  /** How strongly sunrise or sunset colors the sky, from 0 to 1. */
  twilight: number;
  sun: SkyBody;
  moon: SkyBody;
  sky: { glow: Rgb; middle: Rgb; edge: Rgb };
  /** Color of the twilight glow. */
  twilightColor: Rgb;
  sunColor: Rgb;
  ink: Rgb;
  guide: Rgb;
  /** Multipliers on the flowers' colors. */
  flowerLight: Rgb;
}

/** The light at a time of day, from midnight at 0 through noon at 0.5. */
export function skyAt(timeOfDay: number): SkyLight {
  // The sun's height runs from -1 at midnight through 0 at sunrise to 1 at noon.
  const sunHeight = Math.sin(Math.PI * 2 * (timeOfDay - 0.25));
  const daylight = smoothstep(-0.15, 0.25, sunHeight);
  const twilight = clamp(1 - Math.abs(sunHeight + 0.03) / 0.32, 0, 1);
  const sun: SkyBody = {
    along: wrapDay(timeOfDay - 0.25) * 2,
    height: sunHeight,
  };
  const moon: SkyBody = {
    along: wrapDay(timeOfDay - 0.75) * 2,
    height: -sunHeight,
  };
  const flowerNight = mix([1, 1, 1], FLOWER_LIGHT.night, 1 - daylight);
  const flowerTwilight = mix([1, 1, 1], FLOWER_LIGHT.twilight, twilight);
  return {
    daylight,
    twilight,
    sun,
    moon,
    sky: {
      glow: mix(
        mix(SKY.night.glow, SKY.day.glow, daylight),
        DUSK.glow,
        0.85 * twilight,
      ),
      middle: mix(
        mix(SKY.night.middle, SKY.day.middle, daylight),
        DUSK.middle,
        0.85 * twilight,
      ),
      edge: mix(
        mix(SKY.night.edge, SKY.day.edge, daylight),
        DUSK.edge,
        0.85 * twilight,
      ),
    },
    twilightColor: TWILIGHT,
    sunColor: mix(SUN.high, SUN.low, smoothstep(0.45, 0, sunHeight)),
    ink: mix(INK.night, INK.day, daylight),
    guide: mix(GUIDE.night, GUIDE.day, daylight),
    flowerLight: [
      flowerNight[0] * flowerTwilight[0],
      flowerNight[1] * flowerTwilight[1],
      flowerNight[2] * flowerTwilight[2],
    ],
  };
}

/** Wraps a fraction of a day into [0, 1). */
function wrapDay(t: number): number {
  return t - Math.floor(t);
}

/** A color under a light, as multipliers on each channel. */
export function lit(color: Rgb, light: Rgb): Rgb {
  return [color[0] * light[0], color[1] * light[1], color[2] * light[2]];
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function css(color: Rgb, alpha = 1): string {
  const [r, g, b] = color.map((c) => Math.round(c));
  return alpha === 1
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
