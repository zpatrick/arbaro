import type { DebrisSpec } from './tree';
import type { FlowerShape, Ribbon } from './treeTypes';
import type { World } from './world';

const GRAVITY = 24;

/** A broken limb or a toppled tree falling to the ground as one rigid piece. */
export class Debris {
  readonly spec: DebrisSpec;
  readonly toppling: boolean;
  alpha = 1;
  done = false;
  private angle = 0;
  private angVel: number;
  private offsetX = 0;
  private offsetY = 0;
  private velX: number;
  private velY: number;
  private resting = 0;
  private settled = false;

  constructor(spec: DebrisSpec, toppling: boolean) {
    this.spec = spec;
    this.toppling = toppling;
    this.angVel = toppling ? spec.direction * 0.15 : spec.direction * 0.9;
    this.velX = toppling ? 0 : spec.direction * 1.2;
    this.velY = toppling ? 0 : 1;
  }

  get hasLanded(): boolean {
    return this.settled;
  }

  private transform(x: number, y: number): { x: number; y: number } {
    const dx = x - this.spec.pivotX;
    const dy = y - this.spec.pivotY;
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return {
      x: this.spec.pivotX + dx * c - dy * s + this.offsetX,
      y: this.spec.pivotY + dx * s + dy * c + this.offsetY,
    };
  }

  update(dt: number, world: World): void {
    if (this.done) {
      return;
    }
    if (this.toppling) {
      if (!this.settled) {
        this.angVel += this.spec.direction * 1.6 * dt;
        this.angle += this.angVel * dt;
        const limit = Math.PI / 2 - 0.05;
        if (Math.abs(this.angle) >= limit) {
          this.angle = Math.sign(this.angle) * limit;
          this.settled = true;
        }
      }
      return;
    }

    if (this.settled) {
      this.resting += dt;
      if (this.resting > 6) {
        this.alpha = Math.max(0, 1 - (this.resting - 6) / 3);
      }
      if (this.resting > 9) {
        this.done = true;
      }
      return;
    }

    this.velY -= GRAVITY * dt;
    this.offsetX += this.velX * dt;
    this.offsetY += this.velY * dt;
    this.angle += this.angVel * dt;

    let penetration = 0;
    for (const ribbon of this.spec.ribbons) {
      for (const p of ribbon.points) {
        const t = this.transform(p.x, p.y);
        const depth = world.surfaceY(t.x) - (t.y - p.r);
        penetration = Math.max(penetration, depth);
      }
    }
    for (const flower of this.spec.flowers) {
      const t = this.transform(flower.x, flower.y);
      const depth =
        world.surfaceY(t.x) - (t.y - flower.scale * 0.24);
      penetration = Math.max(penetration, depth);
    }
    if (penetration > 0) {
      this.offsetY += penetration;
      this.velX *= 0.5;
      this.angVel *= 0.4;
      if (this.velY < -3) {
        this.velY = -this.velY * 0.2;
      } else {
        this.velY = 0;
        if (Math.abs(this.angVel) < 0.3) {
          this.settled = true;
        }
      }
    }
  }

  ribbons(): Ribbon[] {
    return this.spec.ribbons.map((ribbon) => ({
      kind: ribbon.kind,
      points: ribbon.points.map((p) => {
        const t = this.transform(p.x, p.y);
        return { ...p, x: t.x, y: t.y };
      }),
    }));
  }

  flowers(): FlowerShape[] {
    return this.spec.flowers.map((f) => {
      const t = this.transform(f.x, f.y);
      return { ...f, x: t.x, y: t.y };
    });
  }
}
