import { barnTopAt, barnWalls } from "./barn";
import type { Camera } from "./camera";
import type { Rgb } from "./sky";
import { at, clamp, lerp, Rng } from "./util";
import type { Wind } from "./wind";

/** Lying snow by day, before the light falls on it. */
export const SNOW_COLOR: Rgb = [250, 248, 243];

/** The weather, as the debug panel sets it. */
export interface WeatherSettings {
  /** How hard it rains, from 0 dry to 1 a downpour. */
  rain: number;
  /** How hard it snows, from 0 to 1 a blizzard. */
  snow: number;
  /** How quickly lying snow melts, as a multiple of the usual. */
  melt: number;
  /** How much of the sky the clouds cover, from 0 clear to 1 overcast. */
  clouds: number;
  /** How high the clouds hang, from 0 down on the ground as fog to 1 high in the sky. */
  cloudHeight: number;
}

/**
 * How snow falls, lies and melts. Every chunk of snow falling through the air is carried by it,
 * and settles on whatever it meets first: a flower, the barn or the ground. Wood lets it by.
 */
export const SNOW = {
  /** Density of lying snow, in kilograms per cubic meter. */
  density: 150,
  /** Snow falling on level ground in a blizzard, in kilograms per square meter each second. */
  fall: 0.8,
  /** Speed snow falls through still air, in meters per second, and chunks falling off a roof. */
  speed: 1,
  chunkSpeed: 3.2,
  /** Seconds a falling flake takes to follow a change in the air around it; chunks take longer. */
  response: 0.35,
  chunkResponse: 1.2,
  /** How fast a flake flutters from side to side, at most, in meters per second. */
  flutter: 0.35,
  /** Most snow a flower holds, in kilograms per square meter of its size squared. */
  flowerHold: 1.5,
  /** Seconds the weight of the snow a flower catches takes to settle onto its limb. */
  settling: 1,
  /** Deepest snow lies anywhere, in meters. */
  deepest: 1.2,
  /** Steepest lying snow stands, as its rise over its run: it slides down anything steeper. */
  repose: 0.7,
  /**
   * A drop of this many meters is a ledge: snow sliding over it falls off, gathering into chunks
   * of this many kilograms before each one drops.
   */
  ledge: 0.3,
  chunk: 0.15,
  /** Fraction of lying snow that melts each second at the usual rate. */
  melt: 0.03,
  /**
   * Melting snow on a flower lighter than this, in kilograms, or lying shallower than
   * `traceDepth`, in meters, has melted away.
   */
  trace: 0.002,
  traceDepth: 0.001,
  /** A downpour melts snow this many times faster again. */
  rainMelt: 4,
} as const;

/**
 * Snow falls as flakes through the air around the view, reaching this far past each edge, as a
 * fraction of the view's size, and up to well above any roof below. The flakes belong to the
 * world rather than the view: a blizzard puts `density` of them in each square meter of air, so a
 * view zoomed out shows more of them, until the air would hold more than `most` and they thin
 * out. Beyond that air, snow lands evenly without falling as flakes.
 */
const AIR = { density: 3, most: 4000, margin: 0.1, aboveRoofs: 1 } as const;
/**
 * The scene is a slice of the world this many meters deep: each flake is snow falling across all
 * of it, and lying snow is as deep as the snow landing on that much ground would lie. Something
 * narrower in the slice, such as a flower, catches only its share of a flake.
 */
const SLICE = 1;

/** Lying snow is kept for strips of ground this wide, in meters, from `from` to `to`. */
const COVER = { from: -150, to: 150, step: 0.1 } as const;

/** How the rain falls across the view, in CSS pixels. */
const RAIN = {
  /** Most raindrops in view, per million square pixels, in a downpour. */
  drops: 260,
  /** Speed raindrops fall, in pixels per second. */
  speed: 1100,
  /** Pixels per second each meter per second of wind carries them sideways. */
  drift: 22,
  /** Length of a raindrop's streak, in seconds of its fall. */
  streak: 0.022,
} as const;

/** A raindrop falling across the view, in CSS pixels. */
export interface Drop {
  x: number;
  y: number;
  /** Speed it falls at, as a fraction of the usual, so nearer ones fall faster. */
  speed: number;
}

/** A chunk of snow falling through the air, in meters and meters per second. */
export interface Flake {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Kilograms of snow in it. */
  mass: number;
  /** Speed it falls through still air. */
  speed: number;
  /** From 0 to 1, for drawing. */
  size: number;
  /** A clump of snow that slid off a ledge, rather than a flake from the sky. */
  chunk: boolean;
  /** Progress through its flutter, in radians. */
  phase: number;
  /** The air it moves in, sampled every few steps. */
  air: { x: number; y: number };
  /** The last thing it fell through that caught some of it, so it is caught once in passing. */
  caughtBy: object | undefined;
  /**
   * Seconds it still rolls or tumbles clear of a roof: sheltered from the wind in the still air
   * along the roof, it moves under gravity alone.
   */
  rolling: number;
}

/** Something on the tree that catches falling snow: a flower. */
export interface Catcher {
  /** What it is, the same from step to step. */
  key: object;
  /** Its middle, in meters, and how far around that it catches snow, across the scene and into it. */
  x: number;
  y: number;
  radius: number;
  /** How open it is to the sky, from 0 to 1, and the area it holds up to it, in square meters. */
  exposure: number;
  area: number;
  /** Takes up to `mass` kilograms of snow, as much as it has room for, and returns how much. */
  take(mass: number): number;
}

/** The stretch of air where snow falls as flakes, in meters. Empty when `bottom` is not below `top`. */
interface Zone {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/** Rain falling across the view, snow falling through the air, and snow lying where it landed. */
export class Weather {
  readonly settings: WeatherSettings;
  /** Snow lying on the ground and on the barn. */
  readonly cover = new SnowCover();
  /** Snow falling through the air around the view. */
  flakes: Flake[] = [];
  /** Rain falling across the view. */
  drops: Drop[] = [];
  /** Sideways speed of the rain, in pixels per second. */
  drift = 0;
  private readonly rng = new Rng(52711);
  /** Flakes owed into the air through its top, and through its sides, carried between steps. */
  private owedTop = 0;
  private owedSide = 0;
  private steps = 0;
  /** The air the flakes fell through last step, to tell what has newly come into view. */
  private zone: Zone | undefined;

  constructor(settings: WeatherSettings) {
    this.settings = settings;
  }

  /** Snow falling on level ground, in kilograms per square meter each second. */
  get snowfall(): number {
    return this.settings.snow * SNOW.fall;
  }

  /** Fraction of lying snow that melts each second. */
  get melt(): number {
    return (
      SNOW.melt * this.settings.melt * (1 + SNOW.rainMelt * this.settings.rain)
    );
  }

  /**
   * Moves the rain and snow on by `dt` seconds, letting the snow settle on the flowers in
   * `catchers`, on the barn and on the ground, and the snow lying there settle and melt.
   */
  update(
    dt: number,
    wind: Wind,
    camera: Camera,
    catchers: readonly Catcher[],
  ): void {
    this.steps += 1;
    const zone = this.zoneFor(camera);
    this.fall(dt, wind, zone, catchers);
    this.cover.update(dt, this.snowfall, this.melt, zone, (chunk) =>
      this.flakes.push(chunk),
    );
    this.rain(dt, wind, camera);
  }

  /** Length of a raindrop's streak at its speed, in pixels across and down. */
  streak(drop: Drop): { x: number; y: number } {
    return {
      x: this.drift * drop.speed * RAIN.streak,
      y: RAIN.speed * drop.speed * RAIN.streak,
    };
  }

  /**
   * The air snow falls through as flakes: the view and a little around it, down to the ground
   * and up to well above any roof below.
   */
  private zoneFor(camera: Camera): Zone {
    const corner = camera.toWorld(0, camera.height);
    const opposite = camera.toWorld(camera.width, 0);
    const marginX = (opposite.x - corner.x) * AIR.margin;
    const marginY = (opposite.y - corner.y) * AIR.margin;
    const left = corner.x - marginX;
    const right = opposite.x + marginX;
    return {
      left,
      right,
      bottom: Math.max(0, corner.y - marginY),
      top: Math.max(
        opposite.y + marginY,
        this.cover.highest(left, right) + AIR.aboveRoofs,
      ),
    };
  }

  /**
   * Lets new flakes into the air through its edges, as many as the snowfall carries in, then
   * moves each flake with the air, settling it on the first flower or surface it meets.
   */
  private fall(
    dt: number,
    wind: Wind,
    zone: Zone,
    catchers: readonly Catcher[],
  ): void {
    const width = zone.right - zone.left;
    const height = zone.top - zone.bottom;
    const area = width * height;
    const fall = this.snowfall;
    // Flakes per square meter of air, and the snow each carries so that together they bring the
    // snowfall down.
    const density =
      area > 0
        ? Math.min(AIR.density * this.settings.snow, AIR.most / area)
        : 0;
    const mass = density > 0 ? fall / (density * SNOW.speed) : 0;

    // Flowers beyond the air catch the snowfall evenly, as far as they lie open to the sky.
    const grid = new Map<number, Catcher[]>();
    for (const catcher of catchers) {
      if (!inZone(zone, catcher.x, catcher.y)) {
        catcher.take(fall * catcher.exposure * catcher.area * dt);
        continue;
      }
      const x0 = Math.floor((catcher.x - catcher.radius) / CATCH_CELL);
      const x1 = Math.floor((catcher.x + catcher.radius) / CATCH_CELL);
      const y0 = Math.floor((catcher.y - catcher.radius) / CATCH_CELL);
      const y1 = Math.floor((catcher.y + catcher.radius) / CATCH_CELL);
      for (let cx = x0; cx <= x1; cx += 1) {
        for (let cy = y0; cy <= y1; cy += 1) {
          const key = cellKey(cx, cy);
          const list = grid.get(key);
          if (list === undefined) {
            grid.set(key, [catcher]);
          } else {
            list.push(catcher);
          }
        }
      }
    }

    if (density > 0) {
      const air = wind.at(
        (zone.left + zone.right) / 2,
        (zone.bottom + zone.top) / 2,
        0,
      );
      this.owedTop += density * Math.max(0, SNOW.speed - air.y) * width * dt;
      this.owedSide += density * Math.abs(air.x) * height * dt;
      while (this.owedTop >= 1) {
        this.owedTop -= 1;
        this.spawn(zone.left + this.rng.next() * width, zone.top, mass, wind);
      }
      while (this.owedSide >= 1) {
        this.owedSide -= 1;
        this.spawn(
          air.x > 0 ? zone.left : zone.right,
          zone.bottom + this.rng.next() * height,
          mass,
          wind,
        );
      }
      // Air newly in view is already full of snow, as if it had always been falling there.
      for (const part of uncovered(zone, this.zone)) {
        this.fill(part, density, mass, wind);
      }
    } else {
      this.owedTop = 0;
      this.owedSide = 0;
    }
    this.zone = zone;

    const kept: Flake[] = [];
    for (const [i, flake] of this.flakes.entries()) {
      if ((i + this.steps) % AIR_SAMPLING === 0) {
        flake.air = wind.at(flake.x, Math.max(flake.y, 0), 0);
      }
      flake.phase += dt * (1 + flake.size);
      if (flake.rolling > 0) {
        flake.rolling -= dt;
        flake.vy = Math.max(flake.vy - GRAVITY * dt, -flake.speed);
      } else {
        const flutter = flake.chunk
          ? 0
          : SNOW.flutter * flake.size * Math.sin(flake.phase);
        const follow =
          1 -
          Math.exp(-dt / (flake.chunk ? SNOW.chunkResponse : SNOW.response));
        flake.vx += (flake.air.x + flutter - flake.vx) * follow;
        flake.vy += (flake.air.y - flake.speed - flake.vy) * follow;
      }
      const fromX = flake.x;
      flake.x += flake.vx * dt;
      flake.y += flake.vy * dt;
      // A flake blown against a wall slides down it rather than into it.
      const footing = this.cover.baseAt(flake.x);
      if (flake.y < footing && this.cover.baseAt(fromX) < footing) {
        flake.x = fromX;
        flake.vx = 0;
      }

      const caught = grid.get(
        cellKey(
          Math.floor(flake.x / CATCH_CELL),
          Math.floor(flake.y / CATCH_CELL),
        ),
      );
      if (caught !== undefined) {
        for (const catcher of caught) {
          const dx = flake.x - catcher.x;
          const dy = flake.y - catcher.y;
          if (
            catcher.key !== flake.caughtBy &&
            dx * dx + dy * dy < catcher.radius * catcher.radius
          ) {
            const share = Math.min(1, (2 * catcher.radius) / SLICE);
            flake.mass -= catcher.take(flake.mass * share);
            flake.caughtBy = catcher.key;
            break;
          }
        }
        if (flake.mass <= 0) {
          continue;
        }
      }

      if (flake.y <= this.cover.surfaceAt(flake.x)) {
        // Snow cannot lie on a roof steeper than it stands, so a flake landing on one rolls
        // down it, to fall from its edge.
        const downhill = this.cover.downhill(flake.x);
        if (downhill === 0) {
          this.cover.deposit(flake.x, flake.mass);
          continue;
        }
        flake.y = this.cover.surfaceAt(flake.x) + ROLL.lift;
        flake.vx = downhill * ROLL.speed;
        flake.vy = 0;
        flake.rolling = ROLL.sheltered;
      }
      if (
        flake.x < zone.left ||
        flake.x > zone.right ||
        flake.y < zone.bottom ||
        flake.y > zone.top + AIR.aboveRoofs
      ) {
        // A chunk that fell from a roof is snow that was lying there, so it lands below rather
        // than leave with the air.
        if (flake.chunk) {
          this.cover.deposit(flake.x, flake.mass);
        }
        continue;
      }
      kept.push(flake);
    }
    this.flakes = kept;
  }

  /**
   * Fills `part` of the air with flakes, `density` to the square meter, each carrying `mass`
   * kilograms, wherever it is air rather than roof or lying snow.
   */
  private fill(part: Zone, density: number, mass: number, wind: Wind): void {
    const expected =
      density * (part.right - part.left) * (part.top - part.bottom);
    const count =
      Math.floor(expected) +
      (this.rng.next() < expected - Math.floor(expected) ? 1 : 0);
    for (let i = 0; i < count; i += 1) {
      const x = lerp(part.left, part.right, this.rng.next());
      const y = lerp(part.bottom, part.top, this.rng.next());
      if (y > this.cover.surfaceAt(x)) {
        this.spawn(x, y, mass, wind);
      }
    }
  }

  /** Lets a flake carrying `mass` kilograms into the air at (x, y), already moving with it. */
  private spawn(x: number, y: number, mass: number, wind: Wind): void {
    const air = wind.at(x, Math.max(y, 0), 0);
    const speed = SNOW.speed * (0.8 + 0.4 * this.rng.next());
    this.flakes.push({
      x,
      y,
      vx: air.x,
      vy: air.y - speed,
      mass,
      speed,
      size: this.rng.next(),
      chunk: false,
      phase: this.rng.next() * Math.PI * 2,
      air,
      caughtBy: undefined,
      rolling: 0,
    });
  }

  /**
   * Moves the raindrops down the view and sideways with the wind, wrapping those that reach the
   * ground back in at the top, and adds or removes some so there are as many as the rain brings.
   */
  private rain(dt: number, wind: Wind, camera: Camera): void {
    this.drift = wind.at(0, 10, 0).x * RAIN.drift;
    const width = camera.width;
    const ground = clamp(camera.groundRow, 0, camera.height);
    const count = Math.round(
      ((RAIN.drops * width * ground) / 1e6) * this.settings.rain,
    );
    this.drops = this.drops.slice(0, count);
    while (this.drops.length < count) {
      this.drops.push({
        x: this.rng.next() * width,
        y: this.rng.next() * ground,
        speed: 0.7 + 0.6 * this.rng.next(),
      });
    }
    for (const drop of this.drops) {
      drop.y += dt * RAIN.speed * drop.speed;
      drop.x += dt * this.drift * drop.speed;
      if (drop.y + this.streak(drop).y > ground) {
        drop.y -= ground + 20;
        drop.x = this.rng.next() * width;
      }
      drop.x = ((drop.x % width) + width) % width;
    }
  }
}

/**
 * A flake landing where snow cannot lie rolls on down from this far above the surface, in meters,
 * at this speed, in meters per second, sheltered from the wind for this many seconds after each
 * bump, long enough to tumble clear of the edge. A chunk falling off a ledge tumbles clear for
 * `chunk` seconds.
 */
const ROLL = { lift: 0.01, speed: 1.2, sheltered: 0.25, chunk: 0.25 } as const;
/** Pull of gravity on snow tumbling off a roof, in meters per second squared. */
const GRAVITY = 9.8;
/** How far past and below a ledge's edge a chunk falling off it starts, in meters. */
const LEDGE_CLEAR = 0.05;
/** How fast a chunk leaves a ledge, out from it and down, in meters per second. */
const CHUNK_THROW = { across: 0.4, down: 0.8 } as const;
/** Flakes take a fresh reading of the air every this many steps. */
const AIR_SAMPLING = 3;
/** Size of the cells flowers are sorted into for catching snow, in meters. */
const CATCH_CELL = 0.5;

function cellKey(x: number, y: number): number {
  return (x + 32768) * 65536 + (y + 32768);
}

/** The parts of the air `now` that were not in the air `before`, if there was any. */
function uncovered(now: Zone, before: Zone | undefined): Zone[] {
  if (
    before === undefined ||
    before.bottom >= before.top ||
    before.left >= now.right ||
    before.right <= now.left ||
    before.bottom >= now.top ||
    before.top <= now.bottom
  ) {
    return [now];
  }
  const parts: Zone[] = [];
  if (now.left < before.left) {
    parts.push({ ...now, right: before.left });
  }
  if (now.right > before.right) {
    parts.push({ ...now, left: before.right });
  }
  const left = Math.max(now.left, before.left);
  const right = Math.min(now.right, before.right);
  if (now.top > before.top) {
    parts.push({ left, right, bottom: before.top, top: now.top });
  }
  if (now.bottom < before.bottom) {
    parts.push({ left, right, bottom: now.bottom, top: before.bottom });
  }
  return parts;
}

function inZone(zone: Zone, x: number, y: number): boolean {
  return x >= zone.left && x <= zone.right && y >= zone.bottom && y <= zone.top;
}

/**
 * Snow lying on the ground and on the barn, as its depth over each narrow strip. It settles no
 * steeper than it can stand, sliding down roofs and falling off their edges in chunks.
 */
export class SnowCover {
  readonly from = COVER.from;
  readonly step = COVER.step;
  readonly count = Math.round((COVER.to - COVER.from) / COVER.step);
  /** Height of what the snow lies on over each strip: the ground, or the top of the barn. */
  readonly base: readonly number[];
  /** Depth of the snow lying on each strip, in meters. */
  readonly depth: number[];
  /** Snow gathering at the edge of each ledge before it drops off in a chunk, in meters deep. */
  private readonly overhang: number[];

  constructor() {
    // Snow lies on the roof between the barn's walls. Beyond them it lies on the ground, under
    // the eaves too, since none would stay on their steep pitch.
    const walls = barnWalls();
    this.base = Array.from({ length: this.count }, (_, i) => {
      const x = this.middle(i);
      return x > walls.left && x < walls.right ? barnTopAt(x) : 0;
    });
    this.depth = new Array<number>(this.count).fill(0);
    this.overhang = new Array<number>(this.count).fill(0);
  }

  /** Middle of strip `i`, in meters along the ground. */
  middle(i: number): number {
    return this.from + (i + 0.5) * this.step;
  }

  /** The strip over `x`, or -1 beyond the strips kept. */
  index(x: number): number {
    const i = Math.floor((x - this.from) / this.step);
    return i >= 0 && i < this.count ? i : -1;
  }

  /** Height of what the snow lies on at `x`, in meters. */
  baseAt(x: number): number {
    const i = this.index(x);
    return i < 0 ? 0 : at(this.base, i);
  }

  /** Height of the top of the lying snow at `x`, or of the ground or roof under none. */
  surfaceAt(x: number): number {
    const i = this.index(x);
    return i < 0 ? 0 : at(this.base, i) + at(this.depth, i);
  }

  /**
   * Which way the footing at `x` falls away more steeply than snow can lie on it: -1 to the left,
   * 1 to the right, or 0 where snow can lie.
   */
  downhill(x: number): -1 | 0 | 1 {
    const i = this.index(x);
    if (i <= 0 || i >= this.count - 1) {
      return 0;
    }
    const limit = SNOW.repose * this.step;
    const base = at(this.base, i);
    const left = base - at(this.base, i - 1);
    const right = base - at(this.base, i + 1);
    if (right > limit && right >= left) {
      return 1;
    }
    if (left > limit) {
      return -1;
    }
    return 0;
  }

  /** Height of the highest roof or snow between `left` and `right`. */
  highest(left: number, right: number): number {
    const from = Math.max(0, this.index(left));
    const to = this.index(right) < 0 ? this.count - 1 : this.index(right);
    let highest = 0;
    for (let i = from; i <= to; i += 1) {
      highest = Math.max(highest, at(this.base, i) + at(this.depth, i));
    }
    return highest;
  }

  /**
   * Lays `mass` kilograms of snow at `x`, spread a little either side on the same footing. Snow
   * landing beyond the strips kept is not kept.
   */
  deposit(x: number, mass: number): void {
    const i = this.index(x);
    if (i < 0) {
      return;
    }
    const depth = mass / (SNOW.density * this.step * SLICE);
    const footing = at(this.base, i);
    const spread = [
      [i - 1, 0.25],
      [i, 0.5],
      [i + 1, 0.25],
    ] as const;
    let kept = 0;
    for (const [j, share] of spread) {
      if (
        j >= 0 &&
        j < this.count &&
        Math.abs(at(this.base, j) - footing) < SNOW.ledge
      ) {
        this.depth[j] = at(this.depth, j) + depth * share;
        kept += share;
      }
    }
    this.depth[i] = at(this.depth, i) + depth * (1 - kept);
  }

  /**
   * Moves the lying snow on by `dt` seconds: `fall` kilograms per square meter each second land
   * evenly on whatever lies beyond the air `zone`, where no flakes are falling; the snow slides
   * until it stands no steeper than it can, dropping chunks off ledges into `spill`; and `melt` of
   * it melts each second.
   */
  update(
    dt: number,
    fall: number,
    melt: number,
    zone: Zone,
    spill: (chunk: Flake) => void,
  ): void {
    const even = (fall / SNOW.density) * dt;
    const melting = Math.exp(-melt * dt);
    const open = zone.bottom < zone.top;
    for (let i = 0; i < this.count; i += 1) {
      const x = this.middle(i);
      const surface = at(this.base, i) + at(this.depth, i);
      const outside =
        !open || x < zone.left || x > zone.right || surface < zone.bottom;
      const before = at(this.depth, i);
      const after = Math.min(
        SNOW.deepest,
        before * melting + (outside ? even : 0),
      );
      this.depth[i] = after < before && after < SNOW.traceDepth ? 0 : after;
    }
    for (let i = 0; i < this.count - 1; i += 1) {
      this.slide(i, i + 1, zone, spill);
    }
    for (let i = this.count - 2; i >= 0; i -= 1) {
      this.slide(i, i + 1, zone, spill);
    }
  }

  /** Lets snow slide between neighboring strips `i` and `j` until it stands no steeper than it can. */
  private slide(
    i: number,
    j: number,
    zone: Zone,
    spill: (chunk: Flake) => void,
  ): void {
    const hi = at(this.base, i) + at(this.depth, i);
    const hj = at(this.base, j) + at(this.depth, j);
    const limit = SNOW.repose * this.step;
    if (hi - hj > limit) {
      this.move(i, j, (hi - hj - limit) / 2, zone, spill);
    } else if (hj - hi > limit) {
      this.move(j, i, (hj - hi - limit) / 2, zone, spill);
    }
  }

  /**
   * Moves up to `excess` meters of snow from strip `from` toward strip `to`. Snow sliding over a
   * ledge in the air `zone` gathers at its edge, and drops off as a chunk once there is enough of
   * it; over a ledge beyond the air, it lands below at once.
   */
  private move(
    from: number,
    to: number,
    excess: number,
    zone: Zone,
    spill: (chunk: Flake) => void,
  ): void {
    const amount = Math.min(at(this.depth, from), excess);
    if (amount <= 0) {
      return;
    }
    this.depth[from] = at(this.depth, from) - amount;
    const away = Math.sign(to - from);
    const edge = this.middle(from) + away * (this.step / 2 + LEDGE_CLEAR);
    if (
      at(this.base, from) - at(this.base, to) < SNOW.ledge ||
      !inZone(zone, edge, at(this.base, from))
    ) {
      this.depth[to] = at(this.depth, to) + amount;
      return;
    }
    this.overhang[from] = at(this.overhang, from) + amount;
    const mass = at(this.overhang, from) * SNOW.density * this.step * SLICE;
    if (mass < SNOW.chunk) {
      return;
    }
    this.overhang[from] = 0;
    // It drops from just past and below the ledge's edge, already falling, so a wind blowing it
    // back meets the wall below the ledge rather than carrying it back up onto it.
    spill({
      x: edge,
      y: at(this.base, from) - LEDGE_CLEAR,
      vx: away * CHUNK_THROW.across,
      vy: -CHUNK_THROW.down,
      mass,
      speed: SNOW.chunkSpeed,
      size: 1,
      chunk: true,
      phase: 0,
      air: { x: 0, y: 0 },
      caughtBy: undefined,
      rolling: ROLL.chunk,
    });
  }
}
