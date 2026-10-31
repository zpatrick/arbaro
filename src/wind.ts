import { approach, valueNoise, valueNoise2 } from './util';

/** Wind speed at full strength, in meters per second. One world unit is a meter. */
export const MAX_WIND_SPEED = 40;

export type WindModel = 'steady' | 'gusty' | 'rolling' | 'pulse' | 'buffeting';

export interface WindSettings {
  /** Direction the wind blows toward, in radians counterclockwise from +x with y up. */
  direction: number;
  /** Fraction of MAX_WIND_SPEED, from 0 to 1. */
  strength: number;
  model: WindModel;
}

export const WIND_MODELS: readonly { id: WindModel; name: string; description: string }[] = [
  {
    id: 'steady',
    name: 'Steady',
    description:
      'The same push everywhere, all the time. The tree leans into a single bend and settles there, which shows how stiff each part of it is.',
  },
  {
    id: 'gusty',
    name: 'Gusty',
    description:
      'The whole wind strengthens and eases over a few seconds at a time. The tree surges with each gust and swings back in the lulls.',
  },
  {
    id: 'rolling',
    name: 'Rolling gusts',
    description:
      'Pockets of faster air travel across the scene with the wind, so one side of the tree catches a gust before the other and motion ripples through the branches.',
  },
  {
    id: 'pulse',
    name: 'Resonant pulse',
    description:
      'Pushes while the tree swings downwind and lets go while it swings back, like pumping a swing, so every push lands in time with its natural sway. Even a light wind builds big swings, which makes it the hardest test of the damping.',
  },
  {
    id: 'buffeting',
    name: 'Buffeting',
    description:
      'A steady wind full of small eddies that strike each limb separately. Thin twigs shiver while the trunk hardly notices.',
  },
];

/** Air slows toward the ground. Speeds are quoted at this height, in meters. */
const REFERENCE_HEIGHT = 10;
/** Power-law exponent of how wind speed grows with height over open ground. */
const SHEAR_EXPONENT = 0.14;
/** Slowest the air gets near the ground, as a fraction of the quoted speed. */
const SHEAR_FLOOR = 0.35;
/** How far the gusty model's speed swings either side of its average, as a fraction. */
const GUST_SWING = 0.6;
/** Size of a rolling gust along the wind and across it, in meters. */
const ROLLING_SIZE = { along: 7, across: 10 } as const;
/** How far a rolling gust's speed swings either side of the average, as a fraction. */
const ROLLING_SWING = 0.75;
/** Strength of the buffeting model's eddies, as a fraction of the wind speed. */
const EDDY_STRENGTH = 0.45;
/** How quickly the buffeting model's eddies change, in changes per second. */
const EDDY_RATE = 3;
/** Seconds the resonant pulse takes to switch on or off, so its pushes do not jolt the twigs. */
const PULSE_EASE = 0.08;

export interface Vec {
  x: number;
  y: number;
}

/** The moving air around the tree. */
export class Wind {
  readonly settings: WindSettings;
  private time = 0;
  /** How hard the resonant pulse is pushing, from 0 to 1. */
  private pulse = 0;

  constructor(settings: WindSettings) {
    this.settings = settings;
  }

  get calm(): boolean {
    return this.settings.strength <= 0;
  }

  /** Moves time forward. `motion` is the tree's average velocity, which times the resonant pulse. */
  advance(dt: number, motion: Vec): void {
    this.time += dt;
    const { direction } = this.settings;
    const downwind = motion.x * Math.cos(direction) + motion.y * Math.sin(direction);
    this.pulse = approach(this.pulse, downwind >= 0 ? 1 : 0, PULSE_EASE, dt);
  }

  /**
   * Air velocity at (x, y) in meters per second. `eddy` identifies the piece of wood asking, so
   * the buffeting model can give each one its own eddies.
   */
  at(x: number, y: number, eddy: number): Vec {
    const { direction, strength, model } = this.settings;
    const speed = strength * MAX_WIND_SPEED;
    if (speed === 0) {
      return { x: 0, y: 0 };
    }
    const shear = Math.max(SHEAR_FLOOR, Math.pow(Math.max(y, 0) / REFERENCE_HEIGHT, SHEAR_EXPONENT));
    const along = { x: Math.cos(direction), y: Math.sin(direction) };
    const across = { x: -along.y, y: along.x };
    let alongSpeed = speed;
    let acrossSpeed = 0;
    switch (model) {
      case 'steady':
        break;
      case 'gusty': {
        const t = this.time;
        const swing = 0.62 * valueNoise(t * 0.23, 11) + 0.28 * valueNoise(t * 0.71, 12) + 0.1 * valueNoise(t * 1.9, 13);
        alongSpeed = speed * Math.max(0, 1 + GUST_SWING * swing);
        acrossSpeed = speed * 0.12 * valueNoise(t * 0.17, 14);
        break;
      }
      case 'rolling': {
        // Gusts drift downwind at the wind's own speed.
        const downwind = (x * along.x + y * along.y - speed * this.time) / ROLLING_SIZE.along;
        const crosswind = (x * across.x + y * across.y) / ROLLING_SIZE.across + 0.05 * this.time;
        const swing = 0.7 * valueNoise2(downwind, crosswind, 21) + 0.3 * valueNoise2(downwind * 2.3, crosswind * 2.3, 22);
        alongSpeed = speed * Math.max(0, 1 + ROLLING_SWING * swing);
        break;
      }
      case 'pulse':
        alongSpeed = speed * this.pulse;
        break;
      case 'buffeting': {
        const t = this.time * EDDY_RATE;
        alongSpeed = speed * (1 + EDDY_STRENGTH * valueNoise(t + eddy * 17.3, 31));
        acrossSpeed = speed * EDDY_STRENGTH * valueNoise(t + eddy * 23.9, 32);
        break;
      }
      default: {
        const unknown: never = model;
        throw new Error(`Unknown wind model ${String(unknown)}.`);
      }
    }
    return {
      x: (along.x * alongSpeed + across.x * acrossSpeed) * shear,
      y: (along.y * alongSpeed + across.y * acrossSpeed) * shear,
    };
  }
}
