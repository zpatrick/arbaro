import { type Level, slopeAt } from "./level";
import { PHYSICS } from "./physics";
import { clamp } from "./util";
import type { Wind } from "./wind";

/** Seconds a piece lies on the ground, counted from when it first lands, before it starts to fade. */
const LINGER = 6;
/** Seconds a piece takes to fade away. */
const FADE = 4;
/**
 * Seconds after it came off that a piece starts to fade even if it never reached the ground, such
 * as one left balancing on its stump. One that has fallen in the water fades after `inWater`
 * instead: riding the waves never counts as settling, so the usual timer would not reach it.
 */
const LONGEST = { ground: 30, inWater: 15 } as const;
/** Simulation steps per second while a piece is moving. */
const STEPS_PER_SECOND = 240;
/** Passes over the contacts each step; more makes resting contact firmer. */
const CONTACT_PASSES = 6;
/** Friction between wood and ground. */
const FRICTION = 0.7;
/** Fraction of the speed it hit the ground with that a piece bounces back up with. */
const BOUNCE = 0.15;
/** Fraction of any sinking into the ground corrected each step, and how much is let be. */
const SETTLE = { rate: 0.25, slop: 0.005 } as const;
/** How quickly a tumbling piece's spin dies away in the air, per second. */
const SPIN_DRAG = 0.4;
/**
 * Drag coefficient of a falling piece: a bare cylinder's. The tree's own drag stands in for
 * leaves, which a falling piece shakes loose.
 */
const DRAG = 1.2;
/** A piece pivoting on the stump it sat on slides off once it has tipped this far, in radians. */
const HINGE_RELEASE = 0.5;
/** Spin, in radians per second, a piece starts tipping off its stump with, toward its heavy side. */
const HINGE_NUDGE = 0.08;
/** Density of sea water, in kilograms per cubic meter. */
const WATER_DENSITY = 1025;
/**
 * How hard water drags on wood moving through it, per second, as a multiple of the weight of the
 * water the wood pushes aside.
 */
const WATER_DRAG = 2.5;
/** Seconds a piece floats on the sea, from when it first falls in, before it starts to fade. */
const FLOAT_LINGER = 16;
/** A piece hitting the water faster than this, in meters per second, throws up a splash. */
const SPLASH_SPEED = 1;

/** Water a piece can fall into: where its surface is, how it moves, and how it takes a splash. */
export interface Water {
  surfaceAt(x: number): number | undefined;
  flowAt(x: number, y: number): { x: number; y: number };
  splash(x: number, speed: number, size: number): void;
}

/** A point a piece can land on, with the radius of wood around it. */
export interface Contact {
  x: number;
  y: number;
  r: number;
}

/** What a falling piece needs to know about itself, measured where it broke off. */
export interface Piece {
  mass: number;
  center: { x: number; y: number };
  /** Rotational inertia about the center. */
  inertia: number;
  /** Area it shows to the wind, in square meters. */
  area: number;
  /** Points along its limbs that touch the ground. */
  contacts: Contact[];
  /** Bounding box when it broke off. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /**
   * Where it sat on the stump it came off, for a piece that rested on top of its cut. It tips
   * over on this point before it falls free.
   */
  hinge: { x: number; y: number } | undefined;
}

/**
 * A piece of the tree that broke or was cut off, falling as one rigid body until it lands, lies
 * on the ground a while, and fades away. It keeps the exact shape it had when it came off.
 */
export class Debris {
  /** Outlines in world coordinates as they were when the piece came off. */
  readonly shapes: readonly Path2D[];
  alpha = 1;
  private readonly piece: Piece;
  private readonly linger: number;
  private x: number;
  private y: number;
  private angle = 0;
  private vx: number;
  private vy: number;
  private spin: number;
  /** Seconds since the piece came off. */
  private age = 0;
  /** Seconds since the piece first touched the ground, once it has. */
  private landed: number | undefined;
  /** Whether the piece is still tipping over on the stump it sat on. */
  private hinged: boolean;
  /** Whether it was told to fade now, as a hive does once a bear has eaten it. */
  private fading = false;
  /** Whether any of it is in the water, and whether it has ever fallen in. */
  private wet = false;
  private floated = false;

  constructor(
    shapes: readonly Path2D[],
    piece: Piece,
    motion: { x: number; y: number; spin: number },
    linger = LINGER,
  ) {
    this.shapes = shapes;
    this.piece = piece;
    this.linger = linger;
    this.x = piece.center.x;
    this.y = piece.center.y;
    this.vx = motion.x;
    this.vy = motion.y;
    this.spin = motion.spin;
    this.hinged = piece.hinge !== undefined;
    if (piece.hinge !== undefined) {
      // Counterclockwise is positive, so a piece heavier on the right tips clockwise.
      this.spin -= Math.sign(piece.center.x - piece.hinge.x) * HINGE_NUDGE;
    }
  }

  get done(): boolean {
    return this.alpha <= 0;
  }

  /** The piece's mass, in kilograms. */
  get mass(): number {
    return this.piece.mass;
  }

  /** Where the piece's middle is now. */
  get center(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  /** Whether the piece has come to rest on the ground. */
  get resting(): boolean {
    return this.landed !== undefined && Math.hypot(this.vx, this.vy) < 0.3;
  }

  /**
   * The points the piece can land on something with, where they are now, how thick the wood is
   * about each, and how fast each moves.
   */
  points(): { x: number; y: number; r: number; vx: number; vy: number }[] {
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    return this.piece.contacts.map((contact) => {
      const ox = contact.x - this.piece.center.x;
      const oy = contact.y - this.piece.center.y;
      const armX = cos * ox - sin * oy;
      const armY = sin * ox + cos * oy;
      return {
        x: this.x + armX,
        y: this.y + armY,
        r: contact.r,
        vx: this.vx - this.spin * armY,
        vy: this.vy + this.spin * armX,
      };
    });
  }

  /** Knocks the piece with `impulse`, in newton seconds, at the point (x, y). */
  strike(x: number, y: number, impulse: { x: number; y: number }): void {
    const { mass, inertia } = this.piece;
    this.hinged = false;
    this.vx += impulse.x / mass;
    this.vy += impulse.y / mass;
    this.spin +=
      ((x - this.x) * impulse.y - (y - this.y) * impulse.x) / inertia;
  }

  /** Starts the piece fading away now. */
  fade(): void {
    this.fading = true;
  }

  /** Where the piece's bounding box is now. */
  bounds(): { minX: number; maxX: number; maxY: number } {
    const { minX, minY, maxX, maxY } = this.piece.bounds;
    const transform = this.transform;
    const corners = [
      transform.transformPoint({ x: minX, y: minY }),
      transform.transformPoint({ x: maxX, y: minY }),
      transform.transformPoint({ x: minX, y: maxY }),
      transform.transformPoint({ x: maxX, y: maxY }),
    ];
    return {
      minX: Math.min(...corners.map((c) => c.x)),
      maxX: Math.max(...corners.map((c) => c.x)),
      maxY: Math.max(...corners.map((c) => c.y)),
    };
  }

  /** Maps where the piece was when it came off to where it is now. */
  get transform(): DOMMatrix {
    const { center } = this.piece;
    return new DOMMatrix()
      .translate(this.x, this.y)
      .rotate((this.angle * 180) / Math.PI)
      .translate(-center.x, -center.y);
  }

  /**
   * Moves the piece over `level`'s ground, or floats it on `water`, and fades it once it has lain
   * or floated there long enough, however much the wind or the waves still rock it, or once it has
   * been off the tree too long without landing.
   */
  update(dt: number, wind: Wind, level: Level, water: Water): void {
    this.age += dt;
    const steps = Math.max(1, Math.ceil(dt * STEPS_PER_SECOND));
    let touched = false;
    for (let i = 0; i < steps; i += 1) {
      touched = this.advance(dt / steps, wind, level, water) || touched;
    }
    if (this.landed !== undefined) {
      this.landed += dt;
    } else if (touched) {
      this.landed = 0;
    }
    const linger = this.floated
      ? Math.max(this.linger, FLOAT_LINGER)
      : this.linger;
    if (
      this.fading ||
      (this.landed ?? 0) >= linger ||
      this.age >= (this.floated ? LONGEST.inWater : LONGEST.ground)
    ) {
      this.alpha = Math.max(0, this.alpha - dt / FADE);
    }
  }

  /**
   * Buoys up every point of the piece that is under `water` with the weight of the water it
   * pushes aside, and drags it along with the water's swing. Returns whether any of it is wet.
   */
  private float(h: number, water: Water): boolean {
    const { mass, inertia, contacts } = this.piece;
    // Each point stands for an even share of the wood.
    const volume = mass / (PHYSICS.woodDensity * contacts.length);
    let wet = false;
    let plunge = 0;
    for (const p of this.points()) {
      const surface = water.surfaceAt(p.x);
      if (surface === undefined || p.y - p.r >= surface) {
        continue;
      }
      wet = true;
      const under = clamp((surface - (p.y - p.r)) / (2 * p.r), 0, 1);
      const displaced = WATER_DENSITY * volume * under;
      const flow = water.flowAt(p.x, p.y);
      const fx = WATER_DRAG * displaced * (flow.x - p.vx);
      const fy =
        displaced * PHYSICS.gravity + WATER_DRAG * displaced * (flow.y - p.vy);
      this.vx += (h * fx) / mass;
      this.vy += (h * fy) / mass;
      const armX = p.x - this.x;
      const armY = p.y - this.y;
      this.spin += (h * (armX * fy - armY * fx)) / inertia;
      plunge = Math.max(plunge, -p.vy);
    }
    if (wet && !this.wet && plunge > SPLASH_SPEED) {
      const { minX, maxX } = this.bounds();
      water.splash(this.x, plunge, clamp(maxX - minX, 0.2, 3));
    }
    if (wet) {
      this.floated = true;
      this.hinged = false;
    }
    this.wet = wet;
    return wet;
  }

  /** Moves the piece by `h` seconds. Returns whether it is touching `level`'s ground or `water`. */
  private advance(h: number, wind: Wind, level: Level, water: Water): boolean {
    const wet = this.float(h, water);
    const { mass, inertia, area, hinge } = this.piece;
    const air = wind.at(this.x, this.y, 0);
    const rx = air.x - this.vx;
    const ry = air.y - this.vy;
    const drag = 0.5 * PHYSICS.airDensity * DRAG * area * Math.hypot(rx, ry);
    if (this.hinged && hinge !== undefined) {
      // Tipping over on the stump: turn about the hinge under gravity and the wind.
      const armX = this.x - hinge.x;
      const armY = this.y - hinge.y;
      const torque =
        armX * (drag * ry - mass * PHYSICS.gravity) - armY * drag * rx;
      this.spin +=
        (h * torque) / (inertia + mass * (armX * armX + armY * armY));
      const turn = h * this.spin;
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      this.x = hinge.x + cos * armX - sin * armY;
      this.y = hinge.y + sin * armX + cos * armY;
      this.angle += turn;
      this.vx = -this.spin * (this.y - hinge.y);
      this.vy = this.spin * (this.x - hinge.x);
      if (Math.abs(this.angle) >= HINGE_RELEASE) {
        this.hinged = false;
      }
      return false;
    }
    this.vx += (h * drag * rx) / mass;
    this.vy += h * ((drag * ry) / mass - PHYSICS.gravity);
    this.spin *= Math.exp(-SPIN_DRAG * h);

    // Every contact point below the ground, pushed out along the ground's normal there, with the
    // impulse it has pushed with so far this step.
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    const touching: {
      rx: number;
      ry: number;
      /** The ground's normal there, pointing out of it. */
      nx: number;
      ny: number;
      target: number;
      normal: number;
      friction: number;
    }[] = [];
    for (const contact of this.piece.contacts) {
      const ox = contact.x - this.piece.center.x;
      const oy = contact.y - this.piece.center.y;
      const armX = cos * ox - sin * oy;
      const armY = sin * ox + cos * oy;
      const x = this.x + armX;
      const slope = slopeAt(level, x);
      const rise = Math.hypot(1, slope);
      const nx = -slope / rise;
      const ny = 1 / rise;
      const depth = contact.r - (this.y + armY - level.groundAt(x)) / rise;
      if (depth <= 0) {
        continue;
      }
      const approach =
        (this.vx - this.spin * armY) * nx + (this.vy + this.spin * armX) * ny;
      // Bounce off hard landings; otherwise ease out of the ground.
      const target = Math.max(
        -BOUNCE * approach,
        (SETTLE.rate * Math.max(0, depth - SETTLE.slop)) / h,
      );
      touching.push({
        rx: armX,
        ry: armY,
        nx,
        ny,
        target,
        normal: 0,
        friction: 0,
      });
    }
    for (let pass = 0; pass < CONTACT_PASSES; pass += 1) {
      for (const c of touching) {
        // The tangent runs along the ground, to the right on level ground.
        const tx = c.ny;
        const ty = -c.nx;
        const turnN = c.rx * c.ny - c.ry * c.nx;
        const normalSpeed =
          (this.vx - this.spin * c.ry) * c.nx +
          (this.vy + this.spin * c.rx) * c.ny;
        const normalMass = 1 / (1 / mass + (turnN * turnN) / inertia);
        const total = Math.max(
          0,
          c.normal + normalMass * (c.target - normalSpeed),
        );
        const push = total - c.normal;
        c.normal = total;
        this.vx += (push * c.nx) / mass;
        this.vy += (push * c.ny) / mass;
        this.spin += (push * turnN) / inertia;

        const turnT = c.rx * ty - c.ry * tx;
        const slide =
          (this.vx - this.spin * c.ry) * tx + (this.vy + this.spin * c.rx) * ty;
        const slideMass = 1 / (1 / mass + (turnT * turnT) / inertia);
        const grip = clamp(
          c.friction - slideMass * slide,
          -FRICTION * c.normal,
          FRICTION * c.normal,
        );
        const drag = grip - c.friction;
        c.friction = grip;
        this.vx += (drag * tx) / mass;
        this.vy += (drag * ty) / mass;
        this.spin += (drag * turnT) / inertia;
      }
    }
    this.x += h * this.vx;
    this.y += h * this.vy;
    this.angle += h * this.spin;
    return touching.length > 0 || wet;
  }
}
