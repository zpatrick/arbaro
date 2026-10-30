import type { Environment } from './environment';
import type { Tree } from './tree';
import { Rng } from './util';
import type { World } from './world';

export interface Ray {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

const SPEED = 36;
const DENSITY = 1.0;
const LIGHT_PER_RAY = 0.9;
const FLOWER_RADIUS = 0.5;
export const RAY_LENGTH = 1.3;

/** Sun rays travel across the scene and are absorbed by flowers, the ground and obstacles. */
export class RayField {
  readonly rays: Ray[] = [];
  private carry = 0;
  private readonly rng = new Rng(99);

  /** Moves rays and returns the light collected by flowers this step. */
  update(dt: number, env: Environment, world: World, tree: Tree | undefined): number {
    this.spawn(dt, env, world);
    let light = 0;
    const flowers = tree
      ? [...tree.flowers.values()].filter(
          (flower) => flower.bloomDelay <= 0 && flower.health > 0,
        )
      : [];

    for (let i = this.rays.length - 1; i >= 0; i -= 1) {
      const ray = this.rays[i];
      if (ray === undefined) {
        throw new Error(`Ray ${i} is missing.`);
      }
      const nx = ray.x + ray.vx * dt;
      const ny = ray.y + ray.vy * dt;
      ray.age += dt;
      let remove = ray.age > 8 || Math.abs(nx) > world.level.halfWidth + 60 || ny < -world.level.depth || ny > 150;

      if (!remove) {
        const mx = (ray.x + nx) / 2;
        const my = (ray.y + ny) / 2;
        if (
          ny < world.surfaceY(nx) ||
          world.obstacleBlocks(nx, ny, 0) ||
          world.obstacleBlocks(mx, my, 0) ||
          my < world.surfaceY(mx)
        ) {
          remove = true;
        }
      }

      if (!remove) {
        for (const flower of flowers) {
          const radius =
            FLOWER_RADIUS * (0.55 + flower.scale * 0.65);
          const dx = nx - ray.x;
          const dy = ny - ray.y;
          const lenSq = dx * dx + dy * dy;
          const t = lenSq > 0 ? Math.max(0, Math.min(1, ((flower.x - ray.x) * dx + (flower.y - ray.y) * dy) / lenSq)) : 0;
          const cx = ray.x + dx * t;
          const cy = ray.y + dy * t;
          if (Math.hypot(flower.x - cx, flower.y - cy) < radius) {
            if (!tree) {
              throw new Error('A sun ray hit a flower without a tree.');
            }
            light += tree.absorbLight(flower.id, LIGHT_PER_RAY);
            remove = true;
            break;
          }
        }
      }

      if (remove) {
        const last = this.rays.pop();
        if (last !== undefined && i < this.rays.length) {
          this.rays[i] = last;
        }
      } else {
        ray.x = nx;
        ray.y = ny;
      }
    }
    return light;
  }

  private spawn(dt: number, env: Environment, world: World): void {
    const strength = env.sunStrength;
    if (strength <= 0.01) {
      return;
    }
    const d = env.rayDirection;
    const perpX = -d.y;
    const perpY = d.x;
    const cx = 0;
    const cy = 8;
    // Project the level rectangle onto the line the rays start from so none are wasted.
    let uMin = Infinity;
    let uMax = -Infinity;
    const halfW = world.level.halfWidth;
    for (const corner of [
      { x: -halfW, y: -world.level.depth },
      { x: halfW, y: -world.level.depth },
      { x: -halfW, y: 45 },
      { x: halfW, y: 45 },
    ]) {
      const u = (corner.x - cx) * perpX + (corner.y - cy) * perpY;
      uMin = Math.min(uMin, u);
      uMax = Math.max(uMax, u);
    }
    this.carry += DENSITY * (uMax - uMin) * strength * dt;
    const startX = cx - d.x * 80;
    const startY = cy - d.y * 80;
    while (this.carry >= 1) {
      this.carry -= 1;
      const u = this.rng.range(uMin, uMax);
      this.rays.push({
        x: startX + perpX * u,
        y: startY + perpY * u,
        vx: d.x * SPEED,
        vy: d.y * SPEED,
        age: 0,
      });
    }
  }
}
