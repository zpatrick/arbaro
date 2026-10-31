import { PHYSICS } from "./physics";
import { clamp } from "./util";
import type { Wind } from "./wind";

/** Seconds a piece lies on the ground, counted from when it first lands, before it starts to fade. */
const LINGER = 6;
/** Seconds a piece takes to fade away. */
const FADE = 4;
/**
 * Seconds after it came off that a piece starts to fade even if it never reached the ground, such
 * as one left balancing on its stump.
 */
const LONGEST = 30;
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
   * Moves the piece, and fades it once it has lain on the ground long enough, however much the
   * wind still rocks it, or once it has been off the tree too long without landing.
   */
  update(dt: number, wind: Wind): void {
    this.age += dt;
    const steps = Math.max(1, Math.ceil(dt * STEPS_PER_SECOND));
    let touched = false;
    for (let i = 0; i < steps; i += 1) {
      touched = this.advance(dt / steps, wind) || touched;
    }
    if (this.landed !== undefined) {
      this.landed += dt;
    } else if (touched) {
      this.landed = 0;
    }
    if ((this.landed ?? 0) >= this.linger || this.age >= LONGEST) {
      this.alpha = Math.max(0, this.alpha - dt / FADE);
    }
  }

  /** Moves the piece by `h` seconds. Returns whether it is touching the ground. */
  private advance(h: number, wind: Wind): boolean {
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

    // Every contact point below the ground, with the impulse it has pushed with so far this step.
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    const touching: {
      rx: number;
      ry: number;
      target: number;
      normal: number;
      friction: number;
    }[] = [];
    for (const contact of this.piece.contacts) {
      const ox = contact.x - this.piece.center.x;
      const oy = contact.y - this.piece.center.y;
      const armX = cos * ox - sin * oy;
      const armY = sin * ox + cos * oy;
      const depth = contact.r - (this.y + armY);
      if (depth <= 0) {
        continue;
      }
      const approach = this.vy + this.spin * armX;
      // Bounce off hard landings; otherwise ease out of the ground.
      const target = Math.max(
        -BOUNCE * approach,
        (SETTLE.rate * Math.max(0, depth - SETTLE.slop)) / h,
      );
      touching.push({ rx: armX, ry: armY, target, normal: 0, friction: 0 });
    }
    for (let pass = 0; pass < CONTACT_PASSES; pass += 1) {
      for (const c of touching) {
        const normalSpeed = this.vy + this.spin * c.rx;
        const normalMass = 1 / (1 / mass + (c.rx * c.rx) / inertia);
        const total = Math.max(
          0,
          c.normal + normalMass * (c.target - normalSpeed),
        );
        const push = total - c.normal;
        c.normal = total;
        this.vy += push / mass;
        this.spin += (push * c.rx) / inertia;

        const slide = this.vx - this.spin * c.ry;
        const slideMass = 1 / (1 / mass + (c.ry * c.ry) / inertia);
        const grip = clamp(
          c.friction - slideMass * slide,
          -FRICTION * c.normal,
          FRICTION * c.normal,
        );
        const drag = grip - c.friction;
        c.friction = grip;
        this.vx += drag / mass;
        this.spin -= (drag * c.ry) / inertia;
      }
    }
    this.x += h * this.vx;
    this.y += h * this.vy;
    this.angle += h * this.spin;
    return touching.length > 0;
  }
}
