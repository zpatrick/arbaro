import type { Debris } from "./debris";
import type { GrassKind, Level } from "./level";
import { approach, at, clamp, hash, invariant, lerp, smoothstep } from "./util";
import type { SnowCover } from "./weather";
import type { Wind } from "./wind";

/** How one kind of grass grows and moves. */
export interface Kind {
  /** How tall its blades stand at midsummer, from the shortest to the tallest, in meters. */
  height: { from: number; to: number };
  /** How wide its blades are where they leave the ground, in meters. */
  width: number;
  /** How many blades grow in each strip of ground, where it grows thickest. */
  blades: number;
  /** How far it leans in the wind, in radians per square of the wind's speed in meters per second. */
  bend: number;
  /** How quickly it sways back upright, in swings a second. */
  sway: number;
  /** How far its blades droop over of their own weight at their tips, in radians, at midsummer. */
  droop: number;
}

/**
 * The three kinds of grass, each after its reference photo: meadow grass, fine and bright in dense
 * tufts that flop over in waves; the grass of a wildflower meadow, a little taller and coarser, with
 * flowers standing among it; and beach or wheat grass, tall and golden, its stems carrying slender
 * heads of seed.
 */
export const KINDS: Record<GrassKind, Kind> = {
  meadow: {
    height: { from: 0.25, to: 0.48 },
    width: 0.018,
    blades: 16,
    bend: 0.004,
    sway: 1.1,
    droop: 0.9,
  },
  wildflower: {
    height: { from: 0.3, to: 0.6 },
    width: 0.02,
    blades: 12,
    bend: 0.0035,
    sway: 0.9,
    droop: 0.6,
  },
  wheat: {
    height: { from: 0.65, to: 1.1 },
    width: 0.014,
    blades: 12,
    bend: 0.003,
    sway: 0.7,
    droop: 0.25,
  },
};

/** Width of each strip of ground the grass is kept in, in meters. */
export const STRIP = 0.25;

/**
 * Grass thins out over this many meters toward either end of its patch, so one kind gives way to
 * the next.
 */
const EDGE = 1.2;

/**
 * Dune grass grows in clumps: one every `spacing` meters or so, each `width` meters across at most,
 * with bare sand between, and `crowd` times as many blades in a clump as where grass grows evenly.
 */
export const CLUMPS = { spacing: 2.2, width: 1.1, crowd: 1.8 } as const;

/**
 * Grass grows to its full height by midsummer and dies back to `winter` of it by midwinter, wilting
 * over as it goes.
 */
const GROWTH = { winter: 0.35 } as const;

/** How hard it leans at most, in radians from upright: lying along the ground. */
const FLAT = 1.45;

/**
 * Damping of its sway, as a fraction of critical; how fast a weight or a fall of snow lays it down,
 * in seconds; how long it takes to spring back upright once the weight is gone, however long it lay
 * flat, in seconds; and the depth of snow, in meters, that lays it down flat.
 */
const SPRING = { damping: 0.35, lay: 0.15, recover: 14, buried: 0.12 } as const;

/** Wood or a hive within this far of a strip, in meters beyond its own thickness, presses it down. */
const UNDER = 0.35;

/** One strip of ground grass grows in, and how its grass stands now. */
export interface Strip {
  /** Where its middle is along the land, and the height of the ground there. */
  x: number;
  ground: number;
  kind: GrassKind;
  /** How thickly grass grows here, from 0 at the edge of its patch to 1. */
  thick: number;
  /** Whether it grows in clumps, as dune grass does, its blades fanning out from each. */
  clumped: boolean;
  /** How far it leans, in radians from upright, toward the right if positive, and how fast. */
  lean: number;
  rate: number;
  /** How flat it is pressed, by a weight on it or by snow, from 0 standing to 1 lying flat. */
  press: number;
  /** How deep the snow lies over it, in meters. */
  snow: number;
}

/**
 * The grass and meadow flowers growing on a level's ground. No one plants or cuts them: they lie in
 * patches along the land, and move with the wind, the snow and the weight of what falls on them.
 */
export class Grass {
  private strips: Strip[] = [];

  constructor(level: Level) {
    this.setLevel(level);
  }

  /** Lays the grass out along `level`'s ground, in its patches, standing upright. */
  setLevel(level: Level): void {
    this.strips = [];
    for (const patch of level.grass) {
      for (let x = patch.from + STRIP / 2; x < patch.to; x += STRIP) {
        const edges = Math.min(
          smoothstep(patch.from, patch.from + EDGE, x),
          smoothstep(patch.to, patch.to - EDGE, x),
        );
        const thick = edges * (patch.clumped === true ? clumpAt(x) : 1);
        if (thick <= 0.02) {
          continue;
        }
        this.strips.push({
          x,
          ground: level.groundAt(x),
          kind: patch.kind,
          thick,
          clumped: patch.clumped === true,
          lean: 0,
          rate: 0,
          press: 0,
          snow: 0,
        });
      }
    }
    for (let i = 1; i < this.strips.length; i += 1) {
      invariant(
        at(this.strips, i).x > at(this.strips, i - 1).x,
        `The grass patches of ${level.id} overlap or are out of order along the land.`,
      );
    }
  }

  /** Every strip of grass, from left to right along the land. */
  get all(): readonly Strip[] {
    return this.strips;
  }

  /**
   * Moves the grass on by `dt` seconds at `season`, growing `height` times as tall as usual: each
   * strip leans with the air moving across it and sways back, and lies down under the snow over it
   * and under `pieces` resting on it, springing back slowly once they are gone.
   */
  update(
    dt: number,
    wind: Wind,
    cover: SnowCover,
    pieces: readonly Debris[],
    season: number,
    height: number,
  ): void {
    const tall = growthAt(season) * height;
    const weighed = this.weighed(pieces, tall);
    for (const [i, strip] of this.strips.entries()) {
      const kind = KINDS[strip.kind];
      const air = wind.at(
        strip.x,
        strip.ground + (kind.height.to * tall) / 2,
        i,
      );
      const target = clamp(kind.bend * air.x * Math.abs(air.x), -FLAT, FLAT);
      const omega = 2 * Math.PI * kind.sway;
      strip.rate +=
        (-omega * omega * (strip.lean - target) -
          2 * SPRING.damping * omega * strip.rate) *
        dt;
      strip.lean = clamp(strip.lean + strip.rate * dt, -FLAT, FLAT);

      strip.snow = Math.max(
        0,
        cover.surfaceAt(strip.x) - cover.baseAt(strip.x),
      );
      const pressed = Math.max(
        at(weighed, i),
        smoothstep(0, SPRING.buried, strip.snow),
      );
      strip.press =
        pressed > strip.press
          ? approach(strip.press, pressed, SPRING.lay, dt)
          : Math.max(pressed, strip.press - dt / SPRING.recover);
    }
  }

  /**
   * How hard `pieces` press on each strip, from 0 to 1: any part of one lying within the grass,
   * which stands `tall` of its full height, lays the strips under it flat.
   */
  private weighed(pieces: readonly Debris[], tall: number): number[] {
    const weighed = this.strips.map(() => 0);
    const first = this.strips[0];
    if (first === undefined) {
      return weighed;
    }
    for (const piece of pieces) {
      if (piece.done) {
        continue;
      }
      for (const point of piece.points()) {
        const reach = point.r + UNDER;
        const from = this.indexAt(point.x - reach);
        const to = this.indexAt(point.x + reach);
        for (
          let i = Math.max(0, from);
          i <= Math.min(to, this.strips.length - 1);
          i += 1
        ) {
          const strip = at(this.strips, i);
          if (Math.abs(strip.x - point.x) > reach) {
            continue;
          }
          const top = strip.ground + KINDS[strip.kind].height.to * tall;
          if (point.y - point.r <= top) {
            weighed[i] = 1;
          }
        }
      }
    }
    return weighed;
  }

  /** Which strip is the first at or past `x` along the land, or the last if none is. */
  private indexAt(x: number): number {
    let low = 0;
    let high = this.strips.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (at(this.strips, middle).x < x) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  }
}

/** How tall grass stands at `season`, as a share of its midsummer height. */
export function growthAt(season: number): number {
  return lerp(1, GROWTH.winter, smoothstep(0.15, 0.95, season));
}

/** How far grass has wilted at `season`, from 0 at midsummer to 1 at midwinter. */
export function wiltAt(season: number): number {
  return smoothstep(0.3, 1, season);
}

/** How thickly dune grass grows at `x`, from 0 between its clumps to 1 at their middles. */
function clumpAt(x: number): number {
  const n = Math.round(x / CLUMPS.spacing);
  let thick = 0;
  for (let k = n - 1; k <= n + 1; k += 1) {
    const middle = CLUMPS.spacing * (k + 0.6 * (hash(k, 81) - 0.5));
    const half = (CLUMPS.width / 2) * (0.6 + 0.4 * hash(k, 82));
    thick = Math.max(
      thick,
      1 - smoothstep(half * 0.5, half, Math.abs(x - middle)),
    );
  }
  return thick;
}
