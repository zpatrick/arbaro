import type { Level, Shore } from "./level";
import { PHYSICS } from "./physics";
import { approach, at, clamp, invariant, lerp, Rng, smoothstep } from "./util";
import type { Wind } from "./wind";

/** How the inside of the water is drawn. */
export type SeaLines = "contours" | "hatching";

/** What the debug panel sets about the sea. */
export interface SeaSettings {
  /** Height of the swell rolling in from far out at sea, from none at 0 to huge at 1. */
  swell: number;
  /** How long the swell is, from short at 0 to long at 1. */
  swellLength: number;
  /** How strongly the wind raises waves of its own, as a multiple of the usual. */
  windWaves: number;
  /** Seconds the sea takes to build up or calm down after the wind or the swell changes. */
  momentum: number;
  /** The tide, from low water at 0 to high water at 1. */
  tide: number;
  /** Whether the tide rises and falls with the day, twice a day. */
  tideRunning: boolean;
  /** How the inside of the water is drawn. */
  lines: SeaLines;
}

/** Where a wave comes from: the swell from far off, the wind's own waves, or its ripples. */
type Kind = "swell" | "wind" | "chop";

/**
 * Periods of the waves the sea is made of, in seconds. Each kind is a fixed bank of waves, and the
 * sea changes by moving height among them, so no wave ever jumps. The sea is drawn the way the old
 * prints draw it, its waves shorter and steeper than any real sea's for their height, so that
 * several crests roll in across the view at once.
 */
const PERIODS: Record<Kind, readonly number[]> = {
  swell: [2.5, 2.9, 3.35, 3.9, 4.5, 5.2, 6],
  wind: [1.1, 1.3, 1.55, 1.85, 2.2, 2.6, 3.1, 3.7],
  chop: [0.55, 0.75],
};
/**
 * The swell: its significant height with the slider full, in meters; its period with the slider
 * at short and at long, in seconds; and how narrowly its height gathers about that period, in
 * natural log of the period.
 */
const SWELL = { most: 1.8, short: 2.7, long: 5.8, spread: 0.11 } as const;
/**
 * Waves the wind raises: significant height for each meter per second of wind blowing along the
 * sea, in meters; the peak period in still air and how it lengthens with each meter per second of
 * wind, in seconds; and how widely the height spreads about that period, in natural log of the
 * period.
 */
const WIND_SEA = {
  height: 0.045,
  period: 1,
  lengthens: 0.065,
  spread: 0.22,
} as const;
/**
 * Ripples the wind raises at once: significant height for each meter per second of wind, in
 * meters, and the seconds they take to follow it.
 */
const CHOP = { height: 0.004, follows: 0.6 } as const;
/**
 * Wind blowing out to sea raises waves only over open water: they reach their full height this
 * far out from the water's edge, in meters.
 */
const FETCH = 70;
/** How sharp each kind of wave's crests are, as a fraction of the sharpest a wave can be. */
const SHARPNESS: Record<Kind, number> = { swell: 0.6, wind: 0.45, chop: 0.1 };
/**
 * Breaking in shallow water. The sea's significant height can be at most `sea` of the depth before
 * its waves are cut down; a crest breaks once it would stand `wave` of the depth had breaking not
 * cut it, which a crest of the usual height reaches just as the sea starts to be cut down; and a
 * crest smaller than `curls`, in meters, spills foam rather than curling over.
 */
const BREAK = { sea: 0.55, wave: 0.39, curls: 0.22 } as const;
/** Shallowest water the waves are worked out for, in meters, so none grows without end at the edge. */
const MIN_DEPTH = 0.3;
/** Fraction of an unbroken wave's height the cliff throws back out to sea. */
const REFLECT = 0.45;
/**
 * The stretch of sea the waves are worked out along: how far out from the water's edge at high
 * tide, and how finely, in meters.
 */
const SPAN = { out: 160, step: 0.2 } as const;
/** How far out from the water's edge crests are followed, in meters. */
const CRESTS_OUT = 90;
/** Smallest crest followed, from crest to trough, in meters. */
const LEAST_CREST = 0.05;
/** The tide is worked into the waves again each time it moves this far, in meters. */
const TIDE_STEP = 0.02;
/**
 * How far out along the grid, in meters, the waves are held in place as the tide is worked into
 * them: about the middle of the sea in view.
 */
const ANCHOR = 14;
/**
 * A breaking wave: seconds from when its crest first pitches forward until it is spent, for a
 * wave a meter high, and when, as a fraction of its breaking, its lip lands.
 */
const BREAKING = { seconds: 1.5, lands: 0.45 } as const;
/**
 * Whitecaps: the steepness, crest to trough over wavelength, past which the wind tears a crest in
 * light air and in a gale, and the seconds a cap takes to come and go.
 */
const WHITECAP = { calm: 0.15, gale: 0.07, seconds: 0.4 } as const;
/**
 * A wave reaching the land: how close to the water's edge it must come, in meters, the height it
 * climbs a cliff, as a multiple of its own, how much faster than that its spray is thrown at
 * most, and the slope of land past which it climbs as a sheet rather than washing up as foam.
 */
const RUNUP = { reach: 1.6, height: 3.6, spray: 2.2, steep: 0.55 } as const;
/** Seconds a breaker spent against the land takes to sink away. */
const SPENT = 0.15;
/** A broken wave rolls on as a front of foam at most this fraction of the depth of water under it. */
const BORE = 0.6;
/** Foam: seconds it lasts, and the most that gathers in one place. */
const FOAM = { seconds: 7, most: 1.6 } as const;
/** Foam drifts with the water and before the wind, at this fraction of the wind's speed. */
const FOAM_DRIFT = 0.025;
/** Most spray in the air at once. */
const MOST_DROPLETS = 1400;
/**
 * Ripples spreading from where something fell in: their wavelength in meters, speed in meters per
 * second, and seconds they last.
 */
const RIPPLE = { length: 1.1, speed: 1.4, seconds: 2.2 } as const;
/** Seconds the wind along the sea is averaged over before it raises waves. */
const WIND_AVERAGE = 2;
/** Significant height from the root of the summed squares of the waves' amplitudes. */
const SIGNIFICANT = 2 * Math.SQRT2;

/** A wave the sea is made of, running toward the land or out to sea. */
interface Wave {
  kind: Kind;
  period: number;
  /** Angular frequency, in radians per second. */
  omega: number;
  /** -1 running in toward the land, 1 out to sea. */
  heading: -1 | 1;
  /** Its height far out, as an amplitude in meters, and the height it builds or calms toward. */
  amplitude: number;
  target: number;
  /** Where in its cycle it starts. */
  phase: number;
  /** Wavenumber in deep water, in radians per meter, which sets how quickly it fades with depth. */
  deep: number;
  /** Wavenumber at the far end of the grid, which carries on beyond it. */
  far: number;
  /**
   * At each point along the grid: the phase it gathers on its way from the far end, how much
   * taller it stands there than far out, and how much wider than its rise and fall the water
   * there swings to and fro, which shallow water makes larger.
   */
  gathered: Float64Array;
  shoaling: Float64Array;
  sway: Float64Array;
}

/** A crest of a wave, followed from one step to the next. */
export interface Crest {
  id: number;
  /** Where its top is, in world meters, before the water's sideways swing is added. */
  x: number;
  y: number;
  /** From crest to the troughs either side, and from trough to trough, in meters. */
  height: number;
  length: number;
  /** Which way it runs: -1 in toward the land, 1 out to sea. */
  heading: -1 | 1;
  /** Depth of water under it, in meters. */
  depth: number;
  /** How near a wave running in is to breaking, from 0 to 1 as its face steepens toward it. */
  poise: number;
  /** Foam spilling down its face, from 0 to 1, as a small wave too tall for its water spills. */
  cap: number;
  /** Whether it has broken and run on as a breaker, and whether it has reached the land. */
  broken: boolean;
  struck: boolean;
}

/**
 * A wave that has broken, running on in to the land at the speed shallow water carries it: its
 * crest pitching forward and curling over, its lip landing, and then rolling on as a front of foam
 * until it strikes the land.
 */
export interface Breaker {
  id: number;
  /** Where its crest is, in world meters. */
  x: number;
  /** Which way it runs: -1 in toward the land, 1 out to sea. */
  heading: -1 | 1;
  /** The height it broke at, and its height now, in meters. */
  broke: number;
  height: number;
  /** How far through breaking it is, from 0 as its crest first pitches forward to 1 once spent. */
  breaking: number;
  /** Whether its lip has landed, and whether it has struck the land. */
  landed: boolean;
  struck: boolean;
  /** How fast it runs, in meters per second. */
  speed: number;
}

/** A small crest whose top the wind tears into foam, found afresh each step. */
export interface Whitecap {
  /** Where its top is, in world meters, before the water's sideways swing is added. */
  x: number;
  /** From crest to trough, in meters. */
  height: number;
  /** How much foam the wind tears from it, from 0 to 1. */
  strength: number;
}

/** A drop of spray flying through the air. */
export interface Droplet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Radius, in meters. */
  size: number;
  /** Seconds it has flown, and the most it flies before it is gone as mist. */
  age: number;
  life: number;
}

/**
 * Water thrown up the land by a wave: how high above the sea it has climbed, how fast it climbs,
 * and how much foam it carries.
 */
export interface Surge {
  height: number;
  speed: number;
  foam: number;
}

/** Rings spreading from where something fell in. */
interface Ripple {
  x: number;
  age: number;
  /** Height of its first ring, in meters. */
  strength: number;
}

/** The water at points along the sea, at several depths below its surface, as `profile` works it out. */
export interface Profile {
  /**
   * For each depth asked for: how far the water there stands above or below where it rests, and
   * how far sideways it has swung, at each point.
   */
  heights: Float64Array[];
  shifts: Float64Array[];
}

/** Significant height of the swell, in meters, with its slider at `swell`. */
export function swellHeightFor(swell: number): number {
  return SWELL.most * Math.pow(swell, 1.5);
}

/** Period of the swell, in seconds, with its length slider at `length`. */
export function swellPeriodFor(length: number): number {
  return SWELL.short * Math.pow(SWELL.long / SWELL.short, length);
}

/** Wavenumber of a wave of angular frequency `omega` in water `depth` meters deep. */
function wavenumber(omega: number, depth: number): number {
  const g = PHYSICS.gravity;
  const deep = (omega * omega) / g;
  // Eckart's approximation, then Newton's method on the dispersion relation.
  let k = deep / Math.sqrt(Math.tanh(deep * depth));
  for (let i = 0; i < 3; i += 1) {
    const t = Math.tanh(k * depth);
    const f = g * k * t - omega * omega;
    const df = g * t + g * k * depth * (1 - t * t);
    k -= f / df;
  }
  return k;
}

/** Speed at which a wave's energy travels in water `depth` deep, in meters per second. */
function groupSpeed(omega: number, k: number, depth: number): number {
  const kd = k * depth;
  const n = kd > 20 ? 0.5 : 0.5 * (1 + (2 * kd) / Math.sinh(2 * kd));
  return (omega / k) * n;
}

/**
 * Weights of a spectrum gathered about `peak` seconds, `spread` wide in natural log of the period,
 * across `periods`, scaled so their squares sum to one.
 */
function spectrum(
  periods: readonly number[],
  peak: number,
  spread: number,
): number[] {
  const raw = periods.map((period) =>
    Math.exp(-0.5 * Math.pow(Math.log(period / peak) / spread, 2)),
  );
  const total = Math.sqrt(raw.reduce((sum, w) => sum + w * w, 0));
  invariant(total > 0, `No wave in the bank is near ${peak} s.`);
  return raw.map((w) => w / total);
}

/**
 * The crests along `ys` between indices `from` and `to`: each one's index, where its top lies
 * between points, how high it stands over the troughs either side, and how far apart those
 * troughs are, in points. Crests lower than the least followed are left out.
 */
function tops(
  ys: Float64Array,
  from: number,
  to: number,
): { i: number; at: number; height: number; length: number }[] {
  const found: { i: number; at: number; height: number; length: number }[] = [];
  for (let i = Math.max(1, from); i < to; i += 1) {
    const y = ys[i] ?? 0;
    if (!(y > (ys[i - 1] ?? 0) && y >= (ys[i + 1] ?? 0))) {
      continue;
    }
    let left = i;
    while (left > from && (ys[left - 1] ?? 0) < (ys[left] ?? 0)) {
      left -= 1;
    }
    let right = i;
    while (right < to - 1 && (ys[right + 1] ?? 0) < (ys[right] ?? 0)) {
      right += 1;
    }
    const height = y - 0.5 * ((ys[left] ?? 0) + (ys[right] ?? 0));
    if (height < LEAST_CREST) {
      continue;
    }
    // The top lies between the points either side, on a parabola through the three.
    const before = ys[i - 1] ?? 0;
    const after = ys[i + 1] ?? 0;
    const bend = before - 2 * y + after;
    const offset = bend < 0 ? (0.5 * (before - after)) / bend : 0;
    found.push({
      i,
      at: i + clamp(offset, -0.5, 0.5),
      height,
      length: right - left,
    });
  }
  return found;
}

/** Linear interpolation into `values` at fractional index `f`, held at either end. */
function sample(values: Float64Array, f: number): number {
  const last = values.length - 1;
  invariant(last >= 1, "Cannot sample fewer than two values.");
  const g = clamp(f, 0, last);
  const i = Math.min(Math.floor(g), last - 1);
  return lerp(values[i] ?? 0, values[i + 1] ?? 0, g - i);
}

/**
 * The sea along a level's shore: waves of the swell and of the wind running in from far out, or out
 * from the land with the wind, standing taller as the water shoals, breaking over the shelf, and
 * crashing against the cliff; the foam they leave, and the spray they throw.
 */
export class Sea {
  readonly settings: SeaSettings;
  private shore: Shore | undefined;
  private level: Level;
  private readonly waves: Wave[] = [];
  private readonly rng = new Rng(4127);
  /** Seconds since the sea began. */
  private time = 0;
  /** The grid along the sea: where its first point is, in world meters, and how many points. */
  private start = 0;
  private count = 0;
  /** Depth of water at each point, negative on land. */
  private depth = new Float64Array(0);
  /** Height of the sea the grid was last worked out for. */
  private builtFor = Number.NaN;
  /** Fraction of their height breaking leaves the waves running in at each point. */
  private spared = new Float64Array(0);
  /**
   * The surface at each point of the grid near the land: how far above or below the sea's level
   * it stands, and how fast the water there moves across and up.
   */
  private surfaceY = new Float64Array(0);
  private surfaceU = new Float64Array(0);
  private surfaceW = new Float64Array(0);
  /**
   * The surface as the long waves alone would leave it, which the great crests that break are
   * found on, so that the small waves riding them do not break them up.
   */
  private longY = new Float64Array(0);
  /** Foam on the water at each point of the grid, and its next value as it drifts. */
  private foam = new Float64Array(0);
  private drifted = new Float64Array(0);
  /** Wind blowing along the sea, averaged over a moment, in meters per second; positive out to sea. */
  private windAlong = 0;
  /** The same wind as it blows now. */
  private gust = 0;
  private nextId = 1;
  private ripples: Ripple[] = [];
  /** Height of the sea now, with the tide, in meters. */
  private standing = 0;
  /** How much of a wave's height the cliff throws back now. */
  private reflect = 0;
  /** Where the water meets the land now. */
  coast = 0;
  /** Steepness of the land where the water meets it, as rise over run. */
  coastSlope = 0;
  crests: Crest[] = [];
  breakers: Breaker[] = [];
  whitecaps: Whitecap[] = [];
  droplets: Droplet[] = [];
  readonly surge: Surge = { height: 0, speed: 0, foam: 0 };

  constructor(settings: SeaSettings, level: Level) {
    this.settings = settings;
    this.level = level;
    this.shore = level.shore;
    const banks: { kind: Kind; heading: -1 | 1 }[] = [
      { kind: "swell", heading: -1 },
      { kind: "wind", heading: -1 },
      { kind: "wind", heading: 1 },
      { kind: "chop", heading: -1 },
      { kind: "chop", heading: 1 },
    ];
    for (const { kind, heading } of banks) {
      for (const period of PERIODS[kind]) {
        const omega = (2 * Math.PI) / period;
        this.waves.push({
          kind,
          period,
          omega,
          heading,
          amplitude: 0,
          target: 0,
          phase: this.rng.next() * Math.PI * 2,
          deep: (omega * omega) / PHYSICS.gravity,
          far: (omega * omega) / PHYSICS.gravity,
          gathered: new Float64Array(0),
          shoaling: new Float64Array(0),
          sway: new Float64Array(0),
        });
      }
    }
    this.layOut();
  }

  /** Whether the level has a sea. */
  get present(): boolean {
    return this.shore !== undefined;
  }

  /** Height of the sea now, with the tide, in meters. */
  get waterLevel(): number {
    return this.standing;
  }

  /**
   * Significant height of the waves rolling in, far out, in meters: about the height of the
   * highest third of them.
   */
  get significantHeight(): number {
    let sum = 0;
    for (const wave of this.waves) {
      if (wave.kind !== "chop") {
        sum += wave.amplitude * wave.amplitude;
      }
    }
    return SIGNIFICANT * Math.sqrt(sum);
  }

  /** Wind blowing along the sea now, in meters per second; positive out to sea. */
  get wind(): number {
    return this.gust;
  }

  /** Seconds since the sea began, which set its waves running. */
  get clock(): number {
    return this.time;
  }

  /** Moves the sea to `level`, clearing its foam and spray; the waves carry on as they were. */
  setLevel(level: Level): void {
    this.level = level;
    this.shore = level.shore;
    this.builtFor = Number.NaN;
    this.crests = [];
    this.breakers = [];
    this.droplets = [];
    this.ripples = [];
    this.surge.height = 0;
    this.surge.speed = 0;
    this.surge.foam = 0;
    this.layOut();
  }

  /**
   * Moves the sea on by `dt` seconds under `wind`, at `timeOfDay`, which carries the tide while it
   * follows the day.
   */
  update(dt: number, wind: Wind, timeOfDay: number): void {
    if (this.shore === undefined) {
      return;
    }
    this.time += dt;
    this.tide(timeOfDay);
    this.gust = wind.at(this.coast + 20, this.standing + 10, 0).x;
    this.windAlong = approach(this.windAlong, this.gust, WIND_AVERAGE, dt);
    this.aim();
    for (const wave of this.waves) {
      const settle =
        wave.kind === "chop"
          ? CHOP.follows
          : this.settings.momentum * Math.sqrt(wave.period / 4);
      wave.amplitude = approach(wave.amplitude, wave.target, settle, dt);
    }
    this.spare();
    this.trace();
    this.follow(dt);
    this.roll(dt);
    this.drift(dt);
    this.fly(dt, wind);
    this.climb(dt);
    for (const ripple of this.ripples) {
      ripple.age += dt;
    }
    this.ripples = this.ripples.filter((r) => r.age < RIPPLE.seconds);
  }

  /**
   * Sets every wave at once to the height the settings and `wind` would build it to, as a sea long
   * settled, with the tide where it stands at `timeOfDay`.
   */
  settle(wind: Wind, timeOfDay: number): void {
    if (this.shore === undefined) {
      return;
    }
    this.tide(timeOfDay);
    this.gust = wind.at(this.coast + 20, this.standing + 10, 0).x;
    this.windAlong = this.gust;
    this.aim();
    for (const wave of this.waves) {
      wave.amplitude = wave.target;
    }
    this.spare();
    this.trace();
  }

  /** Height of the sea's surface at `x`, or undefined where the land stands above the water. */
  surfaceAt(x: number): number | undefined {
    if (this.shore === undefined || x < this.coast) {
      return undefined;
    }
    const f = (x - this.start) / SPAN.step;
    const waves = f >= this.count - 1 ? 0 : sample(this.surfaceY, f);
    return this.standing + this.ripplesAt(x) + waves;
  }

  /**
   * How fast the water moves at (x, y), in meters per second: its swing under the waves, fading
   * with depth, and its drift before the wind.
   */
  flowAt(x: number, y: number): { x: number; y: number } {
    const f = (x - this.start) / SPAN.step;
    if (this.shore === undefined || f < 0 || f >= this.count - 1) {
      return { x: 0, y: 0 };
    }
    const top = this.standing + sample(this.surfaceY, f);
    const fade = Math.exp(-Math.max(0, top - y) * 0.6);
    return {
      x: sample(this.surfaceU, f) * fade + FOAM_DRIFT * this.windAlong,
      y: sample(this.surfaceW, f) * fade,
    };
  }

  /** Foam on the water at `x`, from 0 up. */
  foamAt(x: number): number {
    const f = (x - this.start) / SPAN.step;
    if (this.shore === undefined || f < 0 || f >= this.count - 1) {
      return 0;
    }
    return sample(this.foam, f);
  }

  /** Where the land stands `height` high on its way down into the sea, in world meters. */
  faceAt(height: number): number {
    const shore = this.shore;
    invariant(shore !== undefined, "Only a level with a sea has a shore.");
    const from = this.level.groundAt(shore.from) > height ? shore.from : 0;
    if (this.level.groundAt(from) <= height) {
      return from;
    }
    return coastAt(this.level, from, height);
  }

  /** Fraction of their height breaking leaves the waves running in at `x`. */
  sparedAt(x: number): number {
    const f = (x - this.start) / SPAN.step;
    if (this.shore === undefined || f >= this.count - 1) {
      return 1;
    }
    return sample(this.spared, Math.max(f, 0));
  }

  /**
   * Something falling into the sea at `x` at `speed` meters per second, `size` meters across:
   * throws up spray and foam, and sets rings spreading.
   */
  splash(x: number, speed: number, size: number): void {
    const surface = this.surfaceAt(x);
    if (surface === undefined || speed < 0.6) {
      return;
    }
    const strength = clamp(speed * Math.sqrt(size) * 0.025, 0, 0.25);
    this.ripples.push({ x, age: 0, strength });
    this.addFoam(x, strength * 3, size + 0.4);
    const count = Math.round(clamp(speed * size * 14, 3, 60));
    for (let i = 0; i < count; i += 1) {
      const spread = this.rng.range(-0.9, 0.9);
      const lift = speed * this.rng.range(0.25, 0.7);
      this.throwDrop(
        x + this.rng.range(-size, size) / 2,
        surface + 0.02,
        Math.sin(spread) * lift,
        Math.cos(spread) * lift,
        this.rng.range(0.012, 0.035),
      );
    }
  }

  /**
   * Works out the water at each of `xs`, in world meters from left to right, at each of `depths`
   * below its surface, the surface itself being depth 0. Points on the land carry on the water's
   * edge.
   */
  profile(xs: Float64Array, depths: readonly number[]): Profile {
    const n = xs.length;
    const heights = depths.map(() => new Float64Array(n));
    const shifts = depths.map(() => new Float64Array(n));
    if (this.shore === undefined) {
      return { heights, shifts };
    }
    const active = this.waves.filter((wave) => wave.amplitude > 1e-4);
    const coastF = (this.coast - this.start) / SPAN.step;
    const last = this.count - 1;
    const end = this.start + last * SPAN.step;
    // Each wave's rise and swing at the surface at each point, before fading with depth.
    const rise = new Float64Array(n);
    const swing = new Float64Array(n);
    for (const wave of active) {
      const sharp = SHARPNESS[wave.kind];
      const backGathered =
        2 * sample(wave.gathered, clamp(coastF, 0, last)) - wave.phase;
      const turn = wave.omega * this.time;
      for (let i = 0; i < n; i += 1) {
        const x = xs[i] ?? 0;
        const f = clamp((x - this.start) / SPAN.step, coastF, last);
        const gathered =
          x > end
            ? (wave.gathered[last] ?? 0) + wave.far * (x - end)
            : sample(wave.gathered, f);
        const tall = wave.amplitude * sample(wave.shoaling, f);
        const theta = wave.heading * gathered - turn + wave.phase;
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        if (wave.heading < 0) {
          // In toward the land, cut down by breaking, and thrown back by the cliff.
          const amp = tall * sample(this.spared, f);
          const back = tall * this.reflect;
          const thetaBack = gathered - backGathered - turn;
          const cb = Math.cos(thetaBack);
          const sb = Math.sin(thetaBack);
          rise[i] = amp * c + back * cb;
          swing[i] = sharp * (amp * s - back * sb);
        } else {
          const fetch = Math.sqrt(
            Math.min(1, Math.max(0, x - this.coast) / FETCH),
          );
          rise[i] = tall * fetch * c;
          swing[i] = -sharp * tall * fetch * s;
        }
      }
      for (const [d, depth] of depths.entries()) {
        const reach = Math.exp(-wave.deep * depth);
        if (reach < 0.01) {
          continue;
        }
        const h = at(heights, d);
        const sh = at(shifts, d);
        for (let i = 0; i < n; i += 1) {
          h[i] = (h[i] ?? 0) + reach * (rise[i] ?? 0);
          sh[i] = (sh[i] ?? 0) + reach * (swing[i] ?? 0);
        }
      }
    }
    const top = at(heights, 0);
    for (let i = 0; i < n; i += 1) {
      top[i] = (top[i] ?? 0) + this.ripplesAt(xs[i] ?? 0);
    }
    return { heights, shifts };
  }

  /** Lays the grid out along the level's shore, from the water's edge at high tide out to sea. */
  private layOut(): void {
    const shore = this.shore;
    if (shore === undefined) {
      this.count = 0;
      return;
    }
    this.start =
      coastAt(this.level, shore.from, shore.midTide + shore.tide) -
      2 * SPAN.step;
    this.count = Math.ceil((SPAN.out + 2) / SPAN.step);
    this.depth = new Float64Array(this.count);
    this.spared = new Float64Array(this.count).fill(1);
    this.surfaceY = new Float64Array(this.count);
    this.surfaceU = new Float64Array(this.count);
    this.surfaceW = new Float64Array(this.count);
    this.longY = new Float64Array(this.count);
    this.foam = new Float64Array(this.count);
    this.drifted = new Float64Array(this.count);
    for (const wave of this.waves) {
      wave.gathered = new Float64Array(this.count);
      wave.shoaling = new Float64Array(this.count);
      wave.sway = new Float64Array(this.count);
    }
    this.tide(undefined);
  }

  /**
   * Moves the sea to where the tide has it, following the day to `timeOfDay` if it does, and works
   * the waves out again if it has moved far.
   */
  private tide(timeOfDay: number | undefined): void {
    const shore = this.shore;
    invariant(shore !== undefined, "Only a level with a sea has a tide.");
    if (this.settings.tideRunning && timeOfDay !== undefined) {
      // High water twice a day: early in the morning, and again in the evening.
      this.settings.tide =
        0.5 - 0.5 * Math.cos(4 * Math.PI * (timeOfDay - 0.05));
    }
    this.standing = shore.midTide + shore.tide * (2 * this.settings.tide - 1);
    if (!(Math.abs(this.standing - this.builtFor) < TIDE_STEP)) {
      this.build(this.standing);
    }
  }

  /**
   * Works the waves out for the sea standing at `height`: the depth along the grid, and how each
   * wave shortens, slows and stands taller as the water shoals toward the land.
   */
  private build(height: number): void {
    const shore = this.shore;
    invariant(shore !== undefined, "Only a level with a sea has waves.");
    const rebuilding = !Number.isNaN(this.builtFor);
    this.builtFor = height;
    this.coast = coastAt(this.level, shore.from, height);
    const h = 0.05;
    this.coastSlope = Math.abs(
      (this.level.groundAt(this.coast + h) -
        this.level.groundAt(this.coast - h)) /
        (2 * h),
    );
    const n = this.count;
    for (let i = 0; i < n; i += 1) {
      this.depth[i] = height - this.level.groundAt(this.start + i * SPAN.step);
    }
    const last = n - 1;
    const ks = new Float64Array(n);
    // The waves keep their place where they are watched as the tide moves the water under them.
    const anchor = clamp(ANCHOR / SPAN.step, 0, last);
    for (const wave of this.waves) {
      const before = rebuilding ? sample(wave.gathered, anchor) : 0;
      for (let i = 0; i < n; i += 1) {
        ks[i] = wavenumber(wave.omega, Math.max(this.depth[i] ?? 0, MIN_DEPTH));
      }
      wave.far = ks[last] ?? wave.deep;
      const farSpeed = groupSpeed(
        wave.omega,
        wave.far,
        Math.max(this.depth[last] ?? 0, MIN_DEPTH),
      );
      wave.gathered[last] = 0;
      for (let i = last - 1; i >= 0; i -= 1) {
        wave.gathered[i] =
          (wave.gathered[i + 1] ?? 0) -
          0.5 * ((ks[i] ?? 0) + (ks[i + 1] ?? 0)) * SPAN.step;
      }
      if (rebuilding) {
        wave.phase += wave.heading * (before - sample(wave.gathered, anchor));
      }
      for (let i = 0; i < n; i += 1) {
        const depth = Math.max(this.depth[i] ?? 0, MIN_DEPTH);
        const k = ks[i] ?? 0;
        wave.shoaling[i] = Math.min(
          3,
          Math.sqrt(farSpeed / groupSpeed(wave.omega, k, depth)),
        );
        wave.sway[i] = Math.min(3, 1 / Math.tanh(k * depth));
      }
    }
  }

  /** Sets the height each wave builds or calms toward, from the swell and the wind. */
  private aim(): void {
    const { swell, swellLength, windWaves } = this.settings;
    const swellHeight = swellHeightFor(swell);
    const swellWeights = spectrum(
      PERIODS.swell,
      swellPeriodFor(swellLength),
      SWELL.spread,
    );
    const raised = (speed: number): number[] =>
      spectrum(
        PERIODS.wind,
        WIND_SEA.period + WIND_SEA.lengthens * speed,
        WIND_SEA.spread,
      ).map((w) => (w * WIND_SEA.height * windWaves * speed) / SIGNIFICANT);
    const inward = raised(Math.max(0, -this.windAlong));
    const outward = raised(Math.max(0, this.windAlong));
    // The ripples share their height between the two waves of their bank.
    const chop = (speed: number): number =>
      (CHOP.height * windWaves * speed) / (SIGNIFICANT * Math.SQRT2);
    let swellIndex = 0;
    let inIndex = 0;
    let outIndex = 0;
    for (const wave of this.waves) {
      switch (wave.kind) {
        case "swell":
          wave.target =
            (at(swellWeights, swellIndex) * swellHeight) / SIGNIFICANT;
          swellIndex += 1;
          break;
        case "wind":
          if (wave.heading < 0) {
            wave.target = at(inward, inIndex);
            inIndex += 1;
          } else {
            wave.target = at(outward, outIndex);
            outIndex += 1;
          }
          break;
        case "chop":
          wave.target = chop(Math.max(0, wave.heading * this.gust));
          break;
        default: {
          const unknown: never = wave.kind;
          throw new Error(`Unknown kind of wave ${String(unknown)}.`);
        }
      }
    }
  }

  /**
   * Cuts the waves running in down wherever the water is too shallow to hold them, from where they
   * first break all the way in to the land, and sets how much of them the cliff throws back.
   */
  private spare(): void {
    const incoming = this.waves.filter(
      (wave) => wave.heading < 0 && wave.kind !== "chop",
    );
    let least = 1;
    for (let i = this.count - 1; i >= 0; i -= 1) {
      let sum = 0;
      for (const wave of incoming) {
        const tall = wave.amplitude * (wave.shoaling[i] ?? 1);
        sum += tall * tall;
      }
      const significant = SIGNIFICANT * Math.sqrt(sum);
      const depth = Math.max(this.depth[i] ?? 0, MIN_DEPTH);
      if (significant > 1e-6) {
        least = Math.min(least, (BREAK.sea * depth) / significant);
      }
      this.spared[i] = least;
    }
    // A wave that arrives unbroken against a steep shore is thrown back; a broken one hardly is.
    const steep = smoothstep(0.3, 1.2, this.coastSlope);
    this.reflect = REFLECT * steep * Math.pow(this.sparedAt(this.coast + 1), 2);
  }

  /** Works out the surface at every point of the grid out to where crests are followed. */
  private trace(): void {
    const coastF = (this.coast - this.start) / SPAN.step;
    const last = this.count - 1;
    const from = Math.max(0, Math.floor(coastF));
    const to = Math.min(this.count, Math.ceil(coastF + CRESTS_OUT / SPAN.step));
    this.surfaceY.fill(0);
    this.surfaceU.fill(0);
    this.surfaceW.fill(0);
    this.longY.fill(0);
    // The long waves are those near or above the mean period of the waves running in.
    let energy = 0;
    let weighted = 0;
    for (const wave of this.waves) {
      if (wave.heading < 0 && wave.kind !== "chop") {
        energy += wave.amplitude * wave.amplitude;
        weighted += wave.amplitude * wave.amplitude * wave.period;
      }
    }
    const mean = energy > 1e-8 ? weighted / energy : 1;
    for (const wave of this.waves) {
      if (wave.amplitude <= 1e-4 || wave.kind === "chop") {
        continue;
      }
      const long = smoothstep(0.45 * mean, 0.75 * mean, wave.period);
      const backGathered =
        2 * sample(wave.gathered, clamp(coastF, 0, last)) - wave.phase;
      const turn = wave.omega * this.time;
      for (let i = from; i < to; i += 1) {
        const gathered = wave.gathered[i] ?? 0;
        const tall = wave.amplitude * (wave.shoaling[i] ?? 1);
        const sway = wave.sway[i] ?? 1;
        const theta = wave.heading * gathered - turn + wave.phase;
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        let y: number;
        let u: number;
        let w: number;
        if (wave.heading < 0) {
          const amp = tall * (this.spared[i] ?? 1);
          const back = tall * this.reflect;
          const thetaBack = gathered - backGathered - turn;
          const cb = Math.cos(thetaBack);
          const sb = Math.sin(thetaBack);
          y = amp * c + back * cb;
          u = wave.omega * sway * (back * cb - amp * c);
          w = wave.omega * (amp * s + back * sb);
        } else {
          const x = this.start + i * SPAN.step;
          const amp =
            tall * Math.sqrt(Math.min(1, Math.max(0, x - this.coast) / FETCH));
          y = amp * c;
          u = wave.omega * sway * amp * c;
          w = wave.omega * amp * s;
        }
        this.surfaceY[i] = (this.surfaceY[i] ?? 0) + y;
        this.surfaceU[i] = (this.surfaceU[i] ?? 0) + u;
        this.surfaceW[i] = (this.surfaceW[i] ?? 0) + w;
        if (long > 0) {
          this.longY[i] = (this.longY[i] ?? 0) + long * y;
        }
      }
    }
  }

  /**
   * Finds the crests along the sea and follows each from the last step: whether it breaks, curls
   * over and lands, has its top torn into a whitecap by the wind, or reaches the land.
   */
  private follow(dt: number): void {
    const coastF = (this.coast - this.start) / SPAN.step;
    const from = Math.max(1, Math.ceil(coastF));
    const to = Math.min(
      this.count - 1,
      Math.floor(coastF + CRESTS_OUT / SPAN.step),
    );
    const found: Crest[] = [];
    for (const top of tops(this.longY, from, to)) {
      const { i } = top;
      found.push({
        id: 0,
        x: this.start + top.at * SPAN.step,
        y: this.standing + (this.surfaceY[i] ?? 0),
        height: top.height,
        length: top.length * SPAN.step,
        heading: (this.surfaceU[i] ?? 0) > 0 ? 1 : -1,
        depth: this.depth[i] ?? 0,
        poise: 0,
        cap: 0,
        broken: false,
        struck: false,
      });
    }
    this.tear(from, to, dt);
    // Each crest found is the nearest one followed last step, if one was near enough.
    const pairs: { a: number; b: number; distance: number }[] = [];
    for (const [a, crest] of found.entries()) {
      for (const [b, last] of this.crests.entries()) {
        const distance = Math.abs(crest.x - last.x);
        if (distance < 0.7) {
          pairs.push({ a, b, distance });
        }
      }
    }
    pairs.sort((p, q) => p.distance - q.distance);
    const taken = new Set<number>();
    const matched = new Map<number, Crest>();
    for (const { a, b } of pairs) {
      if (!matched.has(a) && !taken.has(b)) {
        matched.set(a, at(this.crests, b));
        taken.add(b);
      }
    }
    for (const [a, crest] of found.entries()) {
      const last = matched.get(a);
      if (last === undefined) {
        crest.id = this.nextId;
        this.nextId += 1;
      } else {
        crest.id = last.id;
        crest.cap = last.cap;
        crest.broken = last.broken;
        crest.struck = last.struck;
      }
      this.breakCrest(crest, dt);
    }
    this.crests = found;
  }

  /**
   * Finds the small crests steep enough for the wind to tear their tops into whitecaps, and lets
   * each shed foam, and spray in a strong wind.
   */
  private tear(from: number, to: number, dt: number): void {
    const wind = Math.abs(this.gust);
    const steepest = lerp(
      WHITECAP.calm,
      WHITECAP.gale,
      smoothstep(4, 22, wind),
    );
    const blowing = smoothstep(3, 8, wind);
    this.whitecaps = [];
    if (blowing <= 0) {
      return;
    }
    for (const top of tops(this.surfaceY, from, to)) {
      const steepness = top.height / Math.max(top.length * SPAN.step, 0.3);
      const strength =
        blowing * smoothstep(steepest, steepest * 1.45, steepness);
      if (strength < 0.02) {
        continue;
      }
      const x = this.start + top.at * SPAN.step;
      this.whitecaps.push({ x, height: top.height, strength });
      this.addFoam(x, dt * 0.9 * strength * top.height, 0.6);
      this.spindrift(
        x,
        this.standing + (this.surfaceY[top.i] ?? 0),
        strength * top.height,
        dt,
      );
    }
  }

  /**
   * Tells how near `crest` is to breaking: a wave too tall for the water under it breaks and runs on
   * as a breaker, or spills foam if it is small; and one that reaches the land unbroken strikes it.
   */
  private breakCrest(crest: Crest, dt: number): void {
    const depth = Math.max(crest.depth, MIN_DEPTH);
    const unbroken = crest.height / Math.max(this.sparedAt(crest.x), 0.05);
    const toward = unbroken / (BREAK.wave * depth);
    const shoaling = crest.heading < 0 && crest.depth < 6;
    crest.poise = shoaling && !crest.broken ? smoothstep(0.55, 1, toward) : 0;
    const tooTall = shoaling && toward > 1;
    if (!crest.broken && tooTall && crest.height >= BREAK.curls) {
      crest.broken = true;
      crest.poise = 0;
      this.breakers.push({
        id: crest.id,
        x: crest.x,
        heading: crest.heading,
        broke: crest.height,
        height: crest.height,
        breaking: 0,
        landed: false,
        struck: false,
        speed: Math.sqrt(PHYSICS.gravity * depth),
      });
    }
    const spilling = tooTall && !crest.broken;
    crest.cap = approach(crest.cap, spilling ? 1 : 0, WHITECAP.seconds, dt);
    if (crest.cap > 0.3) {
      this.addFoam(crest.x, dt * 0.8 * crest.cap * crest.height, 0.6);
    }
    if (
      !crest.struck &&
      !crest.broken &&
      crest.heading < 0 &&
      crest.x - this.coast < RUNUP.reach
    ) {
      crest.struck = true;
      this.strike(crest.height, crest.cap);
    }
    this.spindrift(crest.x, crest.y, crest.cap * crest.height, dt);
  }

  /**
   * Runs each breaker on toward the land at the speed of a wave in water as shallow as that under
   * it: curling over, landing in a burst of spray, rolling on as foam that shrinks with the water,
   * and striking the land.
   */
  private roll(dt: number): void {
    const kept: Breaker[] = [];
    for (const breaker of this.breakers) {
      const f = clamp((breaker.x - this.start) / SPAN.step, 0, this.count - 1);
      const depth = Math.max(sample(this.depth, f), MIN_DEPTH);
      // It rides the crest it broke from while that lasts, then runs on as fast as it was going,
      // or as a wave in water that shallow does if faster.
      const crest = this.crests.find((c) => c.id === breaker.id);
      if (crest !== undefined) {
        breaker.speed = approach(
          breaker.speed,
          Math.abs(crest.x - breaker.x) / Math.max(dt, 1e-6),
          0.2,
          dt,
        );
        breaker.x = crest.x;
      } else {
        const bore = Math.sqrt(PHYSICS.gravity * depth);
        breaker.speed = approach(breaker.speed, bore, 0.6, dt);
        breaker.x += breaker.heading * breaker.speed * dt;
      }
      breaker.breaking = Math.min(
        1,
        breaker.breaking +
          dt / (BREAKING.seconds * Math.sqrt(Math.max(breaker.broke, 0.25))),
      );
      if (!breaker.landed && breaker.breaking >= BREAKING.lands) {
        breaker.landed = true;
        this.plunge(breaker);
      }
      if (breaker.struck) {
        // Spent against the land, it sinks away into the water it threw up.
        breaker.height = approach(breaker.height, 0, SPENT, dt);
      } else if (breaker.landed) {
        // The broken wave rolls on as a front of foam no taller than its water lets it be.
        breaker.height = approach(
          breaker.height,
          Math.min(breaker.broke, BORE * depth),
          0.5,
          dt,
        );
        this.addFoam(
          breaker.x - breaker.heading * breaker.height * 0.5,
          dt * 2.4 * breaker.height,
          breaker.height + 0.4,
        );
      }
      this.spindrift(
        breaker.x,
        this.standing + breaker.height * 0.7,
        (1 - breaker.breaking) * breaker.height,
        dt,
      );
      if (
        !breaker.struck &&
        breaker.heading < 0 &&
        breaker.x - this.coast < RUNUP.reach
      ) {
        breaker.struck = true;
        this.strike(breaker.height, breaker.breaking);
      }
      if (breaker.height < LEAST_CREST) {
        continue;
      }
      kept.push(breaker);
    }
    this.breakers = kept;
  }

  /** A curling lip landing ahead of its wave: a burst of spray and foam where it lands. */
  private plunge(breaker: Breaker): void {
    const x = breaker.x + breaker.heading * breaker.broke * 1.05;
    const surface = this.surfaceAt(x) ?? this.standing;
    const strength = Math.sqrt(PHYSICS.gravity * breaker.broke);
    this.addFoam(x, 0.9 * breaker.broke + 0.2, breaker.broke * 1.6 + 0.4);
    this.ripples.push({ x, age: 0, strength: 0.04 * breaker.broke });
    const count = Math.round(clamp(breaker.broke * 40, 6, 90));
    for (let i = 0; i < count; i += 1) {
      // Thrown up and on, the way the wave runs, and a little back.
      const angle = lerp(-0.35, 1.25, this.rng.next()) * Math.PI * 0.5;
      const speed = strength * this.rng.range(0.25, 0.95);
      this.throwDrop(
        x + this.rng.range(-0.3, 0.3) * breaker.broke,
        surface + 0.02,
        breaker.heading * Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        this.rng.range(0.014, 0.05),
      );
    }
  }

  /**
   * A wave `height` meters high reaching the land, `broken` from 0 for a wave arriving whole to 1
   * for one long since broken: a steep shore throws it up the cliff in a sheet and a burst of
   * spray; a gentle one lets it wash up as foam.
   */
  private strike(height: number, broken: number): void {
    const steep = smoothstep(
      RUNUP.steep * 0.5,
      RUNUP.steep * 2,
      this.coastSlope,
    );
    // Water already broken arrives as a lower, foaming rush.
    const rush = height * lerp(1, 0.65, broken);
    const speed = Math.sqrt(2 * PHYSICS.gravity * RUNUP.height * rush);
    if (this.surge.height <= 0.05 || speed > this.surge.speed) {
      this.surge.speed = speed;
    }
    this.surge.foam = Math.min(1.5, this.surge.foam + 0.5 + rush);
    this.addFoam(this.coast + 0.6, 0.6 + rush, 1.6 + rush);
    const count = Math.round(clamp(rush * rush * 160 * steep, 0, 260));
    for (let i = 0; i < count; i += 1) {
      // Up along the cliff's face, fanning out to sea.
      const angle = (Math.PI / 2) * this.rng.range(0.5, 1);
      const launch = speed * this.rng.range(0.4, RUNUP.spray);
      this.throwDrop(
        this.coast + this.rng.range(0.05, 0.6),
        this.standing + this.rng.range(0, 0.5) * rush,
        Math.cos(angle) * launch * 0.7,
        Math.sin(angle) * launch,
        this.rng.range(0.012, 0.055),
      );
    }
  }

  /**
   * In a strong wind the top of a crest at (x, y) breaking or torn into foam blows off as spray, the
   * more the more `torn` meters of it there are.
   */
  private spindrift(x: number, y: number, torn: number, dt: number): void {
    const rate = torn * smoothstep(9, 24, Math.abs(this.gust)) * 26;
    let owed = rate * dt;
    while (owed > 0) {
      if (this.rng.next() < owed) {
        this.throwDrop(
          x + this.rng.range(-0.25, 0.25) * torn,
          y + 0.02,
          this.gust * this.rng.range(0.2, 0.5),
          this.rng.range(0.6, 2.2),
          this.rng.range(0.006, 0.018),
        );
      }
      owed -= 1;
    }
  }

  /** Lets foam drift with the water and before the wind, and fade. */
  private drift(dt: number): void {
    const fade = Math.exp(-dt / FOAM.seconds);
    const from = Math.max(0, Math.floor((this.coast - this.start) / SPAN.step));
    const last = this.count - 1;
    for (let i = 0; i < this.count; i += 1) {
      if (i < from) {
        this.drifted[i] = 0;
        continue;
      }
      const u = 0.5 * (this.surfaceU[i] ?? 0) + FOAM_DRIFT * this.windAlong;
      const back = clamp(i - (u * dt) / SPAN.step, from, last);
      this.drifted[i] = Math.min(FOAM.most, sample(this.foam, back) * fade);
    }
    [this.foam, this.drifted] = [this.drifted, this.foam];
  }

  /** Adds `amount` of foam about `x`, spread over `width` meters. */
  private addFoam(x: number, amount: number, width: number): void {
    const center = (x - this.start) / SPAN.step;
    const half = Math.max(1, width / 2 / SPAN.step);
    const from = Math.max(0, Math.floor(center - half));
    const to = Math.min(this.count - 1, Math.ceil(center + half));
    for (let i = from; i <= to; i += 1) {
      const t = (i - center) / half;
      const share = Math.max(0, 1 - t * t);
      this.foam[i] = Math.min(FOAM.most, (this.foam[i] ?? 0) + amount * share);
    }
  }

  /** Throws a drop of spray from (x, y) at (vx, vy), `size` meters in radius. */
  private throwDrop(
    x: number,
    y: number,
    vx: number,
    vy: number,
    size: number,
  ): void {
    if (this.droplets.length >= MOST_DROPLETS) {
      return;
    }
    this.droplets.push({
      x,
      y,
      vx,
      vy,
      size,
      age: 0,
      life: this.rng.range(1.2, 3.2),
    });
  }

  /**
   * Flies the spray on: pulled down, slowed by the air and carried with the wind, the finest most.
   * A drop is gone once it falls back into the sea or onto the land, or turns to mist.
   */
  private fly(dt: number, wind: Wind): void {
    const kept: Droplet[] = [];
    for (const drop of this.droplets) {
      drop.age += dt;
      const air = wind.at(drop.x, drop.y, 0);
      // Small drops follow the air within a fraction of a second; large ones carry on.
      const follows = 0.08 + drop.size * 14;
      drop.vx += ((air.x - drop.vx) / follows) * dt;
      drop.vy += ((air.y - drop.vy) / follows - PHYSICS.gravity) * dt;
      drop.x += drop.vx * dt;
      drop.y += drop.vy * dt;
      if (drop.age > drop.life || drop.y < this.level.groundAt(drop.x)) {
        continue;
      }
      const surface = this.surfaceAt(drop.x);
      if (surface !== undefined && drop.y < surface && drop.vy < 0) {
        if (drop.size > 0.03) {
          this.addFoam(drop.x, 0.05, 0.3);
        }
        continue;
      }
      kept.push(drop);
    }
    this.droplets = kept;
  }

  /** Lets the water thrown up the land climb, slow, and slide back down. */
  private climb(dt: number): void {
    const surge = this.surge;
    if (surge.speed !== 0 || surge.height > 0) {
      surge.height += surge.speed * dt;
      surge.speed -= PHYSICS.gravity * dt;
      if (surge.height <= 0) {
        surge.height = 0;
        surge.speed = 0;
      }
    }
    surge.foam *= Math.exp(-dt / 2.5);
  }

  /** Height the rings spreading from things fallen in add to the surface at `x`. */
  private ripplesAt(x: number): number {
    let y = 0;
    const k = (2 * Math.PI) / RIPPLE.length;
    for (const ripple of this.ripples) {
      const from = Math.abs(x - ripple.x) - RIPPLE.speed * ripple.age;
      const envelope = Math.exp(-from * from * 1.4);
      const fade = 1 - ripple.age / RIPPLE.seconds;
      y += ripple.strength * fade * fade * envelope * Math.cos(k * from);
    }
    return y;
  }
}

/**
 * Where `level`'s land first runs down below `height` on its way out to sea from `from`: the
 * water's edge for a sea standing that high.
 */
function coastAt(level: Level, from: number, height: number): number {
  const step = 0.25;
  let x = from;
  invariant(
    level.groundAt(x) > height,
    `The land at ${x} m is already below ${height} m.`,
  );
  while (level.groundAt(x + step) > height) {
    x += step;
    invariant(x < from + 500, `The land never runs down below ${height} m.`);
  }
  let below = x;
  let above = x + step;
  for (let i = 0; i < 30; i += 1) {
    const middle = (below + above) / 2;
    if (level.groundAt(middle) > height) {
      below = middle;
    } else {
      above = middle;
    }
  }
  return (below + above) / 2;
}
