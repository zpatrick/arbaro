import type { LevelDef, ObstaclePart } from './levels';
import { clamp, distPointSegment, invariant } from './util';

export const CELL = 0.5;

function pointInPolygon(px: number, py: number, pts: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const a = pts[i];
    const b = pts[j];
    invariant(a !== undefined && b !== undefined, 'Polygon point missing.');
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function distToPolygon(px: number, py: number, pts: readonly { x: number; y: number }[]): number {
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const a = pts[i];
    const b = pts[j];
    invariant(a !== undefined && b !== undefined, 'Polygon point missing.');
    best = Math.min(best, distPointSegment(px, py, a.x, a.y, b.x, b.y));
  }
  return best;
}

/** Terrain, soil moisture and static obstacles for a level. */
export class World {
  readonly level: LevelDef;
  readonly cols: number;
  readonly rows: number;
  readonly originX: number;
  readonly topY: number;
  /** Branches stop growing here, which caps how tall any tree in the level can get. */
  readonly skyCeiling: number;
  readonly bottomY: number;
  readonly soil: Uint8Array;
  readonly moisture: Float32Array;
  private readonly source: Float32Array;
  private readonly topRow: Int16Array;
  private readonly solidParts: ObstaclePart[];
  private moistureClock = 0;
  version = 0;

  constructor(level: LevelDef) {
    this.level = level;
    this.originX = -level.halfWidth;
    this.cols = Math.round((level.halfWidth * 2) / CELL);

    let maxSurface = -Infinity;
    for (let x = -level.halfWidth; x <= level.halfWidth; x += 0.25) {
      maxSurface = Math.max(maxSurface, level.surface(x));
    }
    this.topY = Math.ceil(maxSurface) + 1;
    this.bottomY = -level.depth;
    this.skyCeiling = this.topY + 55;
    this.rows = Math.round((this.topY - this.bottomY) / CELL);
    this.soil = new Uint8Array(this.cols * this.rows);
    this.moisture = new Float32Array(this.cols * this.rows);
    this.source = new Float32Array(this.cols * this.rows).fill(-1);
    this.topRow = new Int16Array(this.cols).fill(-1);
    this.solidParts = level.obstacles.filter((part) => part.solid);

    this.buildSoil();
  }

  private index(col: number, row: number): number {
    return row * this.cols + col;
  }

  cellCenterX(col: number): number {
    return this.originX + (col + 0.5) * CELL;
  }

  cellCenterY(row: number): number {
    return this.topY - (row + 0.5) * CELL;
  }

  private buildSoil(): void {
    const { level } = this;
    let lowestSurface = Infinity;
    for (let x = -level.halfWidth; x <= level.halfWidth; x += 0.25) {
      lowestSurface = Math.min(lowestSurface, level.surface(x));
    }
    const tableY = lowestSurface - level.waterTable.depth;

    for (let col = 0; col < this.cols; col += 1) {
      const x = this.cellCenterX(col);
      const surfaceY = level.surface(x);
      for (let row = 0; row < this.rows; row += 1) {
        const y = this.cellCenterY(row);
        const idx = this.index(col, row);
        if (y > surfaceY - CELL / 2) {
          continue;
        }
        if (this.topRow[col] === -1) {
          this.topRow[col] = row;
        }
        if (this.rockAt(x, y, 0) !== undefined) {
          continue;
        }
        this.soil[idx] = 1;
        const depth = surfaceY - y;
        this.moisture[idx] = clamp(0.3 - depth * 0.015, 0.08, 0.3);
        if (y < tableY) {
          this.source[idx] = level.waterTable.moisture;
          this.moisture[idx] = level.waterTable.moisture;
        }
        for (const pocket of level.pockets) {
          const nx = (x - pocket.x) / pocket.rx;
          const ny = (y - pocket.y) / pocket.ry;
          if (nx * nx + ny * ny <= 1) {
            this.source[idx] = 1;
            this.moisture[idx] = 1;
          }
        }
      }
    }
  }

  surfaceY(x: number): number {
    return this.level.surface(x);
  }

  /** Returns the rock that contains a circle of the given radius at this point, if any. */
  rockAt(x: number, y: number, radius: number): { x: number; y: number; r: number } | undefined {
    for (const rock of this.level.rocks) {
      if (Math.hypot(x - rock.x, y - rock.y) < rock.r + radius) {
        return rock;
      }
    }
    return undefined;
  }

  /** True when a circle at this point overlaps a solid obstacle above ground. */
  obstacleBlocks(x: number, y: number, radius: number): boolean {
    for (const part of this.solidParts) {
      if (pointInPolygon(x, y, part.points)) {
        return true;
      }
      if (radius > 0 && distToPolygon(x, y, part.points) < radius) {
        return true;
      }
    }
    return false;
  }

  /** Ground blocks any circle whose lowest point is under the surface. Used by branches. */
  branchBlocked(x: number, y: number, radius: number): boolean {
    if (Math.abs(x) > this.level.halfWidth - 1) {
      return true;
    }
    if (y - radius < this.surfaceY(x) + 0.08) {
      return true;
    }
    if (y > this.skyCeiling) {
      return true;
    }
    return this.obstacleBlocks(x, y, radius);
  }

  /** Static blockers for roots (air, rocks, edges). Other roots are checked by the tree. */
  rootBlocked(x: number, y: number, radius: number): boolean {
    if (Math.abs(x) > this.level.halfWidth - 1) {
      return true;
    }
    if (y + radius > this.surfaceY(x) - 0.1) {
      return true;
    }
    if (y - radius < this.bottomY + 0.3) {
      return true;
    }
    return this.rockAt(x, y, radius + 0.04) !== undefined;
  }

  canPlantSeed(x: number): boolean {
    if (Math.abs(x) > this.level.halfWidth - 3) {
      return false;
    }
    const y = this.surfaceY(x);
    return !this.obstacleBlocks(x, y + 0.5, 1.2);
  }

  private cellAt(x: number, y: number): number {
    const col = Math.floor((x - this.originX) / CELL);
    const row = Math.floor((this.topY - y) / CELL);
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) {
      return -1;
    }
    return this.index(col, row);
  }

  moistureAt(x: number, y: number): number {
    const idx = this.cellAt(x, y);
    if (idx < 0 || this.soil[idx] === 0) {
      return 0;
    }
    return this.moisture[idx] ?? 0;
  }

  /** Draws water from the soil cell at this point in proportion to how wet it is. Returns the amount taken. */
  absorb(x: number, y: number, rate: number, dt: number): number {
    const idx = this.cellAt(x, y);
    if (idx < 0 || this.soil[idx] === 0) {
      return 0;
    }
    const current = this.moisture[idx] ?? 0;
    const taken = rate * current * dt;
    this.moisture[idx] = current - taken * 0.5;
    return taken;
  }

  /** Advances soil moisture. Rain wets the top layer, water drains down and spreads sideways. */
  step(dt: number, rain: number, sunlight: number): void {
    this.moistureClock += dt;
    const tick = 0.25;
    while (this.moistureClock >= tick) {
      this.moistureClock -= tick;
      this.stepOnce(tick, rain, sunlight);
    }
  }

  private stepOnce(dt: number, rain: number, sunlight: number): void {
    const { cols, rows, soil, moisture, source } = this;
    const diffuse = 0.7 * dt;
    const drain = 0.5 * dt;
    const fieldCapacity = 0.3;
    const dry = 0.04;
    const dryRate = 0.012 * dt;

    for (let col = 0; col < cols; col += 1) {
      const top = this.topRow[col] ?? -1;
      if (top >= 0 && rain > 0) {
        const idx = this.index(col, top);
        moisture[idx] = Math.min(1, (moisture[idx] ?? 0) + rain * 0.9 * dt);
      }
    }

    const delta = new Float32Array(moisture.length);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const idx = this.index(col, row);
        if (soil[idx] === 0) {
          continue;
        }
        const m = moisture[idx] ?? 0;
        if (col + 1 < cols && soil[idx + 1] === 1) {
          const flow = diffuse * (m - (moisture[idx + 1] ?? 0)) * 0.5;
          delta[idx] = (delta[idx] ?? 0) - flow;
          delta[idx + 1] = (delta[idx + 1] ?? 0) + flow;
        }
        if (row + 1 < rows) {
          const below = idx + cols;
          if (soil[below] === 1) {
            const mb = moisture[below] ?? 0;
            let flow = diffuse * (m - mb) * 0.5;
            flow += drain * Math.max(0, m - fieldCapacity) * (1 - mb);
            delta[idx] = (delta[idx] ?? 0) - flow;
            delta[below] = (delta[below] ?? 0) + flow;
          }
        }
      }
    }

    const evaporation = 0.02 * sunlight * dt;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const idx = this.index(col, row);
        if (soil[idx] === 0) {
          continue;
        }
        let m = (moisture[idx] ?? 0) + (delta[idx] ?? 0);
        const pinned = source[idx] ?? -1;
        if (pinned >= 0) {
          m = pinned;
        } else {
          m += (dry - m) * dryRate;
          const top = this.topRow[col] ?? -1;
          if (top >= 0 && row - top < 3) {
            m -= evaporation * (1 - (row - top) / 3);
          }
        }
        moisture[idx] = clamp(m, 0, 1);
      }
    }
    this.version += 1;
  }
}
