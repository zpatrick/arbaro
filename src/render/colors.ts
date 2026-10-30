import { clamp, lerp, smoothstep } from '../util';

export type Rgb = readonly [number, number, number];

export function hex(value: string): Rgb {
  const n = Number.parseInt(value.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp(t, 0, 1);
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
}

export function css(c: Rgb, alpha = 1): string {
  const to = (v: number): number => Math.round(clamp(v, 0, 1) * 255);
  return `rgba(${to(c[0])}, ${to(c[1])}, ${to(c[2])}, ${alpha})`;
}

/**
 * The scene is one ink line on one sheet of paper. Only blossoms, sunlight and
 * water carry colour, so they are the only things that catch the eye.
 */
export interface Palette {
  skyTop: Rgb;
  skyLow: Rgb;
  soilSurface: Rgb;
  soil: Rgb;
  soilDeep: Rgb;
  /** Every drawn line: tree, rocks, buildings, clouds. */
  ink: Rgb;
  /** Interior of a drawn shape, a shade off the paper behind it. */
  paper: Rgb;
  /** Lighter ink for texture that should sit behind the subject. */
  faint: Rgb;
  bloom: Rgb;
  water: Rgb;
  sun: Rgb;
}

const DAY: Palette = {
  skyTop: hex('#e6d9bd'),
  skyLow: hex('#f3ead5'),
  soilSurface: hex('#4f5133'),
  soil: hex('#786746'),
  soilDeep: hex('#57472f'),
  ink: hex('#261e16'),
  paper: hex('#eee3cb'),
  faint: hex('#786b52'),
  bloom: hex('#a83f55'),
  water: hex('#326f83'),
  sun: hex('#d2b66f'),
};

const DUSK: Palette = {
  skyTop: hex('#716b79'),
  skyLow: hex('#d79a72'),
  soilSurface: hex('#3c4330'),
  soil: hex('#685747'),
  soilDeep: hex('#493b34'),
  ink: hex('#241d1b'),
  paper: hex('#bda997'),
  faint: hex('#61544d'),
  bloom: hex('#a94860'),
  water: hex('#315f70'),
  sun: hex('#d09b65'),
};

const NIGHT: Palette = {
  skyTop: hex('#121724'),
  skyLow: hex('#2d3343'),
  soilSurface: hex('#202a28'),
  soil: hex('#2a3033'),
  soilDeep: hex('#1e242a'),
  ink: hex('#b8b4a9'),
  paper: hex('#252b34'),
  faint: hex('#68717a'),
  bloom: hex('#a3677b'),
  water: hex('#457b91'),
  sun: hex('#d4d1c5'),
};

const OVERCAST: Palette = {
  skyTop: hex('#9e9a8d'),
  skyLow: hex('#c9c1ad'),
  soilSurface: hex('#41483a'),
  soil: hex('#746b59'),
  soilDeep: hex('#565044'),
  ink: hex('#2d2b28'),
  paper: hex('#c9c1ae'),
  faint: hex('#716d64'),
  bloom: hex('#985064'),
  water: hex('#3c7284'),
  sun: hex('#c0b79f'),
};

function blend(a: Palette, b: Palette, t: number): Palette {
  return {
    skyTop: mix(a.skyTop, b.skyTop, t),
    skyLow: mix(a.skyLow, b.skyLow, t),
    soilSurface: mix(a.soilSurface, b.soilSurface, t),
    soil: mix(a.soil, b.soil, t),
    soilDeep: mix(a.soilDeep, b.soilDeep, t),
    ink: mix(a.ink, b.ink, t),
    paper: mix(a.paper, b.paper, t),
    faint: mix(a.faint, b.faint, t),
    bloom: mix(a.bloom, b.bloom, t),
    water: mix(a.water, b.water, t),
    sun: mix(a.sun, b.sun, t),
  };
}

/**
 * Picks the palette for the moment. `elevation` is how high the sun stands,
 * from 0 at the horizon to 1 at noon, and goes negative once the moon takes over.
 */
export function paletteFor(elevation: number, cloudCover: number, isDay: boolean): Palette {
  const base =
    elevation >= 0
      ? blend(DUSK, DAY, smoothstep(0.03, 0.4, elevation))
      : blend(DUSK, NIGHT, smoothstep(0, 0.28, -elevation));
  const overcast = clamp(cloudCover - 0.3, 0, 1) * (isDay ? 0.8 : 0.25);
  return blend(base, OVERCAST, overcast);
}
