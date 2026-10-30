import { Rng } from './util';

export interface Cloud {
  x: number;
  y: number;
  width: number;
  speed: number;
  variant: number;
}

export interface Bird {
  x: number;
  y: number;
  vx: number;
  phase: number;
  size: number;
  bobPhase: number;
  baseY: number;
}

/** Clouds and birds that drift across the sky. They are decoration only. */
export class Scenery {
  readonly clouds: Cloud[] = [];
  readonly birds: Bird[] = [];
  private nextFlock: number;
  private readonly rng: Rng;
  private readonly halfWidth: number;

  constructor(halfWidth: number, seed: number) {
    this.halfWidth = halfWidth;
    this.rng = new Rng(seed * 31 + 5);
    this.nextFlock = this.rng.range(8, 20);
    for (let i = 0; i < 9; i += 1) {
      this.clouds.push({
        x: this.rng.range(-halfWidth - 20, halfWidth + 20),
        y: this.rng.range(15, 30),
        width: this.rng.range(8, 15),
        speed: this.rng.range(0.4, 1.1),
        variant: i,
      });
    }
  }

  update(dt: number, wind: number): void {
    const wrap = this.halfWidth + 25;
    for (const cloud of this.clouds) {
      cloud.x += (cloud.speed + wind * 0.5) * dt;
      if (cloud.x > wrap) {
        cloud.x = -wrap;
      } else if (cloud.x < -wrap) {
        cloud.x = wrap;
      }
    }

    this.nextFlock -= dt;
    if (this.nextFlock <= 0) {
      this.nextFlock = this.rng.range(25, 50);
      const direction = this.rng.chance(0.5) ? 1 : -1;
      const count = 1 + Math.floor(this.rng.range(0, 3));
      const baseY = this.rng.range(14, 26);
      const speed = this.rng.range(5, 8);
      for (let i = 0; i < count; i += 1) {
        this.birds.push({
          x: direction * -(this.halfWidth + 6) - direction * i * 2.2,
          y: baseY + i * 0.8,
          baseY: baseY + i * 0.8,
          vx: direction * speed,
          phase: this.rng.range(0, 6),
          bobPhase: this.rng.range(0, 6),
          size: this.rng.range(1.1, 1.6),
        });
      }
    }

    for (let i = this.birds.length - 1; i >= 0; i -= 1) {
      const bird = this.birds[i];
      if (bird === undefined) {
        throw new Error(`Bird ${i} is missing.`);
      }
      bird.x += bird.vx * dt;
      bird.phase += dt * 9;
      bird.bobPhase += dt * 1.5;
      bird.y = bird.baseY + Math.sin(bird.bobPhase) * 0.6;
      if (Math.abs(bird.x) > this.halfWidth + 12) {
        this.birds.splice(i, 1);
      }
    }
  }
}
