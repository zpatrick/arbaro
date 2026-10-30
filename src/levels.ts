import { smoothstep, type Vec2 } from './util';

export interface RockDef {
  x: number;
  y: number;
  r: number;
}

export interface ObstaclePart {
  /** Convex polygon in world coordinates. */
  points: Vec2[];
  fill: string;
  outline: string;
  /** Solid parts block branches and sun rays. Decorative parts do not. */
  solid: boolean;
}

export interface WaterPocket {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

export interface LevelDef {
  id: number;
  name: string;
  blurb: string;
  halfWidth: number;
  depth: number;
  surface: (x: number) => number;
  rocks: RockDef[];
  obstacles: ObstaclePart[];
  pockets: WaterPocket[];
  /** Soil deeper than this below the lowest surface point stays saturated to the given level. */
  waterTable: { depth: number; moisture: number };
  windBase: number;
  /** Seconds of game time between rain showers, on average. */
  rainEvery: number;
  goal: { height: number; flowers: number };
  startWater: number;
  startLight: number;
  seed: number;
}

function level1Surface(x: number): number {
  const hill = 4.2 * Math.exp(-Math.pow((x + 8) / 18, 2));
  const rightSlope = -2.1 * smoothstep(4, 34, x);
  const leftRise = 0.8 * smoothstep(-36, -24, x);
  const handDrawn = 0.18 * Math.sin(x * 0.16 + 0.5) + 0.08 * Math.sin(x * 0.41);
  return -1.5 + hill + rightSlope + leftRise + handDrawn;
}

function buildLevel1(): LevelDef {
  const surface = level1Surface;

  return {
    id: 1,
    name: 'The Meadow',
    blurb: 'An open hillside with deep water beneath the stone. Grow a tree 18 tall with 18 flowers.',
    halfWidth: 36,
    depth: 17,
    surface,
    rocks: [
      { x: -6, y: -5.2, r: 1.7 },
      { x: 5, y: -7.4, r: 2.1 },
      { x: 11, y: -4.2, r: 1.3 },
      { x: -17, y: -9, r: 2.3 },
      { x: -1.5, y: -12, r: 1.6 },
      { x: 17, y: -9.6, r: 2.3 },
      { x: 25, y: -6.5, r: 1.5 },
      { x: -26, y: -6, r: 1.4 },
    ],
    obstacles: [],
    pockets: [
      { x: -9.5, y: -9, rx: 3.2, ry: 1.8 },
      { x: 10, y: -13, rx: 3.8, ry: 1.7 },
    ],
    waterTable: { depth: 13.5, moisture: 0.55 },
    windBase: 1.2,
    rainEvery: 55,
    goal: { height: 18, flowers: 18 },
    startWater: 40,
    startLight: 40,
    seed: 7,
  };
}

export const LEVELS: readonly LevelDef[] = [buildLevel1()];
