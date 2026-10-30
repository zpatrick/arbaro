import { clamp, Rng, smoothstep, valueNoise } from './util';

export const DAY_LENGTH = 120;
const DAYLIGHT_FRACTION = 0.62;

/** Time of day, weather and wind. Advances with game time. */
export class Environment {
  time: number;
  cloudCover = 0.25;
  rain = 0;
  wind = 0;
  private raining = false;
  private rainLeft = 0;
  private nextRainIn: number;
  private readonly windBase: number;
  private readonly rainEvery: number;
  private readonly rng: Rng;
  private readonly noiseSeed: number;

  constructor(windBase: number, rainEvery: number, seed: number) {
    this.windBase = windBase;
    this.rainEvery = rainEvery;
    this.rng = new Rng(seed);
    this.noiseSeed = seed;
    this.time = DAY_LENGTH * 0.04;
    this.nextRainIn = 20;
  }

  /** Progress through the current day from 0 to 1. */
  get phase(): number {
    return (this.time / DAY_LENGTH) % 1;
  }

  get dayNumber(): number {
    return Math.floor(this.time / DAY_LENGTH) + 1;
  }

  get isDay(): boolean {
    return this.phase < DAYLIGHT_FRACTION;
  }

  /** Arc angle of the sun or moon: 0 at the left horizon, PI at the right horizon. */
  get bodyAngle(): number {
    const p = this.phase;
    return this.isDay ? Math.PI * (p / DAYLIGHT_FRACTION) : Math.PI * ((p - DAYLIGHT_FRACTION) / (1 - DAYLIGHT_FRACTION));
  }

  /** Height of the sun above the horizon from 0 to 1. Zero at night. */
  get sunHeight(): number {
    return this.isDay ? Math.sin(this.bodyAngle) : 0;
  }

  /** Strength of sunlight reaching the ground after clouds. */
  get sunStrength(): number {
    return Math.pow(this.sunHeight, 0.5) * (1 - 0.65 * this.cloudCover);
  }

  /** Overall brightness of the sky from 0 (night) to 1 (noon). */
  get daylight(): number {
    return this.isDay ? smoothstep(0, 0.22, this.sunHeight) : 0;
  }

  update(dt: number): void {
    this.time += dt;

    this.nextRainIn -= dt;
    if (!this.raining && this.nextRainIn <= 0) {
      this.raining = true;
      this.rainLeft = this.rng.range(14, 26);
    }
    if (this.raining) {
      this.rainLeft -= dt;
      if (this.rainLeft <= 0) {
        this.raining = false;
        this.nextRainIn = this.rainEvery * this.rng.range(0.6, 1.4);
      }
    }
    const rainTarget = this.raining ? 1 : 0;
    this.rain += (rainTarget - this.rain) * (1 - Math.exp(-dt * 0.6));

    const cloudTarget = this.raining ? 0.9 : 0.15 + 0.35 * valueNoise(this.time * 0.02, this.noiseSeed);
    this.cloudCover += (cloudTarget - this.cloudCover) * (1 - Math.exp(-dt * 0.3));

    const direction = Math.tanh(3 * Math.cos(this.time * 0.017 + 1));
    const amplitude = this.windBase * (0.4 + 0.8 * valueNoise(this.time * 0.05, this.noiseSeed + 1));
    const gust = this.windBase * 1.6 * Math.max(0, valueNoise(this.time * 0.35, this.noiseSeed + 2) - 0.6);
    // Winds start gentle so a young tree has time to root before the weather turns.
    const ramp = clamp(0.4 + (this.time / DAY_LENGTH) * 0.3, 0.4, 1);
    this.wind = direction * (amplitude + gust) * (1 + 0.3 * this.rain) * ramp;
  }

  /** Sun direction of travel for rays. */
  get rayDirection(): { x: number; y: number } {
    const a = this.bodyAngle;
    return { x: Math.cos(a), y: -Math.sin(a) };
  }

  skyBrightness(): number {
    return clamp(this.daylight, 0, 1);
  }
}
