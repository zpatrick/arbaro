import type { Camera } from "./camera";
import { at, clamp, lerp, smoothstep } from "./util";

/** Radius of the sun and of the moon, as a fraction of the view's height. */
export const BODY_SIZE = 0.04;
/** Highest the sun and moon climb, as a fraction of the view's height below its top. */
const SKY_TOP = 0.075;
/** How far apart the sun rises and sets, as a fraction of the view's width. */
export const SKY_SPAN = 0.88;
/**
 * How far right of center the sun and moon are at their highest, as a fraction of the view's
 * width, so they pass beside the top of the tree rather than behind it.
 */
const SKY_LEAN = 0.13;

/** Where `body` shows in the view, in CSS pixels. */
export function skyBodyAt(
  camera: Camera,
  body: SkyBody,
): { x: number; y: number } {
  const angle = Math.PI * (1 - body.along);
  // From the horizon to near the top of the view, however far below the ground line it lies.
  const rise =
    camera.groundY +
    (camera.horizonRow - camera.groundRow) -
    SKY_TOP * camera.height;
  return {
    x:
      camera.width *
      (0.5 + 0.5 * SKY_SPAN * Math.cos(angle) + SKY_LEAN * Math.sin(angle)),
    y: camera.horizonRow - rise * Math.sin(angle),
  };
}

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

/**
 * How much of the whole day and night the sun is up, in midsummer and in midwinter, as far north
 * as the village lies.
 */
const DAY_LENGTH = { summer: 0.68, winter: 0.32 } as const;

/** Moves the time of day on by `dt` seconds, if the day is running. */
export function advanceDay(time: TimeSettings, dt: number): void {
  if (time.dayRunning) {
    time.timeOfDay = (time.timeOfDay + dt / DAY_SECONDS) % 1;
  }
}

/**
 * The sky's colors at full day and in deep night: near the horizon, overhead, and at the edges. By
 * day the sky is cooler than the paper the mountains are cut from, so they stand out against it.
 */
const SKY = {
  day: {
    glow: [241, 237, 229],
    middle: [228, 229, 224],
    edge: [206, 213, 215],
  },
  night: {
    glow: [70, 80, 108],
    middle: [48, 56, 80],
    edge: [30, 35, 52],
  },
} as const;
/** The warm paper the distant land is cut from by day, where the sky would be. */
const PAPER = {
  glow: [243, 236, 223],
  middle: [237, 228, 210],
  edge: [220, 205, 177],
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
  /**
   * The same for the distant land, the mountains, which by day are the warm paper rather than the
   * sky, and by night and at sunrise and sunset take the sky's colors as it does.
   */
  land: { glow: Rgb; middle: Rgb; edge: Rgb };
  /** Color of the twilight glow. */
  twilightColor: Rgb;
  sunColor: Rgb;
  ink: Rgb;
  guide: Rgb;
  /** Multipliers on the flowers' colors. */
  flowerLight: Rgb;
  /**
   * How much of the sun's or the moon's light falls straight on the scene, from 0 under thick
   * cloud, where nothing casts a shadow, to 1 under a clear sky.
   */
  direct: number;
  /** How much of the sun, the moon and the stars the clouds hide, from 0 to 1. */
  veiled: number;
}

/**
 * The light at a time of day, from midnight at 0 through noon at 0.5, in `season`, from midsummer
 * at 0 to midwinter at 1: the sun rises earlier and sets later in summer, and keeps short hours
 * in winter.
 */
export function skyAt(timeOfDay: number, season: number): SkyLight {
  const day = lerp(DAY_LENGTH.summer, DAY_LENGTH.winter, clamp(season, 0, 1));
  const sunrise = 0.5 - day / 2;
  const sunset = 0.5 + day / 2;
  // The sun's height runs from its lowest at midnight through 0 at sunrise to its highest at noon:
  // in high summer it barely sets, and in deep winter it barely rises.
  const lean = -Math.cos(Math.PI * day);
  const sunHeight =
    (lean + Math.cos(Math.PI * 2 * (timeOfDay - 0.5))) / (1 + Math.abs(lean));
  const daylight = smoothstep(-0.15, 0.25, sunHeight);
  const twilight = clamp(1 - Math.abs(sunHeight + 0.03) / 0.32, 0, 1);
  // Along its arc while it is up, and through the night after it sets; the moon the other way.
  const up = timeOfDay >= sunrise && timeOfDay < sunset;
  const intoDay = (timeOfDay - sunrise) / day;
  const intoNight = wrapDay(timeOfDay - sunset) / (1 - day);
  const sun: SkyBody = {
    along: up ? intoDay : 1 + intoNight,
    height: sunHeight,
  };
  const moon: SkyBody = {
    along: up ? 1 + intoDay : intoNight,
    height: -sunHeight,
  };
  const flowerNight = mix([1, 1, 1], FLOWER_LIGHT.night, 1 - daylight);
  const flowerTwilight = mix([1, 1, 1], FLOWER_LIGHT.twilight, twilight);
  // From deep night up to the colors given for full day, leaning toward sunrise and sunset's.
  const lit = (day: { glow: Rgb; middle: Rgb; edge: Rgb }) => ({
    glow: mix(
      mix(SKY.night.glow, day.glow, daylight),
      DUSK.glow,
      0.85 * twilight,
    ),
    middle: mix(
      mix(SKY.night.middle, day.middle, daylight),
      DUSK.middle,
      0.85 * twilight,
    ),
    edge: mix(
      mix(SKY.night.edge, day.edge, daylight),
      DUSK.edge,
      0.85 * twilight,
    ),
  });
  return {
    daylight,
    twilight,
    sun,
    moon,
    sky: lit(SKY.day),
    land: lit(PAPER),
    twilightColor: TWILIGHT,
    sunColor: mix(SUN.high, SUN.low, smoothstep(0.45, 0, sunHeight)),
    ink: mix(INK.night, INK.day, daylight),
    guide: mix(GUIDE.night, GUIDE.day, daylight),
    flowerLight: [
      flowerNight[0] * flowerTwilight[0],
      flowerNight[1] * flowerTwilight[1],
      flowerNight[2] * flowerTwilight[2],
    ],
    direct: 1,
    veiled: 0,
  };
}

/** The year's seasons, each early, at its height, then late, from the start of spring. */
const SEASON_NAMES = [
  "Early spring",
  "Spring",
  "Late spring",
  "Early summer",
  "Summer",
  "Late summer",
  "Early fall",
  "Fall",
  "Late fall",
  "Early winter",
  "Winter",
  "Late winter",
] as const;

/**
 * The name of the season at `season`, which runs from midsummer at 0 to midwinter at 1: half the
 * year, from the height of summer to the height of winter.
 */
export function seasonName(season: number): string {
  const twelfths = 4.5 + 6 * clamp(season, 0, 1);
  return at(SEASON_NAMES, Math.floor(twelfths) % SEASON_NAMES.length);
}

/**
 * A time of day as a 12-hour clock reading, such as "6:30 am", rounded down to a whole number of
 * `step` minutes.
 */
export function clockTime(timeOfDay: number, step = 1): string {
  const minutes = (Math.floor((timeOfDay * 24 * 60) / step) * step) % (24 * 60);
  const hours = Math.floor(minutes / 60);
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  const minute = String(minutes % 60).padStart(2, "0");
  return `${hour}:${minute} ${hours < 12 ? "am" : "pm"}`;
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
