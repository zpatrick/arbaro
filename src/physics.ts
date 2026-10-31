import type { Limb } from './limb';
import { at, invariant, wrapAngle } from './util';
import type { Wind } from './wind';

export const PHYSICS = {
  /** Distance between the joints a limb bends at, in meters. One world unit is a meter. */
  jointSpacing: 0.5,
  gravity: 9.81,
  /** Density of green wood, in kilograms per cubic meter. */
  woodDensity: 750,
  /**
   * Young's modulus of the wood, in pascals. Real green wood is closer to 9 GPa; softer wood lets
   * a bare tree sway as visibly as a leafy one would.
   */
  stiffness: 1e8,
  airDensity: 1.2,
  /**
   * Drag coefficient of a limb's cross-section. A bare cylinder's is about 1.2; this stands in for
   * the bark, twigs and leaves the tree does not have yet.
   */
  drag: 3,
  /** Fraction of critical damping at each joint. */
  damping: 0.08,
  /** Longest simulation step, in seconds. */
  step: 1 / 120,
} as const;

/** Joint angles below this, in radians, are too small to see. */
const STILL_ANGLE = 2e-5;
/** Joint speeds below this, in radians per second, are too small to see. */
const STILL_RATE = 2e-4;

/** How far each joint along a limb has been pushed from the grown shape, and how fast it is moving. */
interface Sway {
  angle: number[];
  rate: number[];
}

/**
 * One stretch of a limb between two joints, simulated as a rigid tapered rod that hangs from the
 * joint at its base. Bodies are solved with Featherstone's articulated-body algorithm, with every
 * spatial quantity in world coordinates about the origin.
 */
class Body {
  readonly sway: Sway;
  /** Index of the base joint along its limb. */
  readonly joint: number;
  readonly parent: Body | undefined;
  /** Joint angle when the tree stands as grown: relative to the parent's axis, or absolute on the ground. */
  readonly restAngle: number;
  /** Base joint position in the parent's frame (along its axis, then to its left), or in the world on the ground. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Straight-line length from joint to joint. */
  readonly length: number;
  /** Length of wood along the curve. */
  readonly arc: number;
  /** Distance of the center of mass along the axis from the base joint. */
  readonly com: number;
  readonly mass: number;
  /** Rotational inertia about the center of mass. */
  readonly inertia: number;
  /** Average radius, which sets how much air the body catches. */
  readonly radius: number;
  /** Torque per radian at the base joint. */
  readonly stiffness: number;
  /** Keys the body's own eddies in the buffeting wind, so they stay put when bodies are rebuilt. */
  readonly eddy: number;
  /** Torque per radian per second at the base joint. */
  damping = 0;
  /** Torque the base joint carries when the tree stands as grown, holding up everything above it. */
  preload = 0;

  angle: number;
  rate: number;

  // Per-step working values, named after their symbols in the algorithm.
  theta = 0;
  jx = 0;
  jy = 0;
  w = 0;
  vx = 0;
  vy = 0;
  c2 = 0;
  c3 = 0;
  i11 = 0;
  i12 = 0;
  i13 = 0;
  i22 = 0;
  i23 = 0;
  i33 = 0;
  p1 = 0;
  p2 = 0;
  p3 = 0;
  u1 = 0;
  u2 = 0;
  u3 = 0;
  d = 0;
  u = 0;
  a1 = 0;
  a2 = 0;
  a3 = 0;

  constructor(fields: {
    sway: Sway;
    joint: number;
    parent: Body | undefined;
    restAngle: number;
    offsetX: number;
    offsetY: number;
    length: number;
    arc: number;
    com: number;
    mass: number;
    inertia: number;
    radius: number;
    stiffness: number;
    eddy: number;
  }) {
    this.sway = fields.sway;
    this.joint = fields.joint;
    this.parent = fields.parent;
    this.restAngle = fields.restAngle;
    this.offsetX = fields.offsetX;
    this.offsetY = fields.offsetY;
    this.length = fields.length;
    this.arc = fields.arc;
    this.com = fields.com;
    this.mass = fields.mass;
    this.inertia = fields.inertia;
    this.radius = fields.radius;
    this.stiffness = fields.stiffness;
    this.eddy = fields.eddy;
    this.angle = at(fields.sway.angle, fields.joint);
    this.rate = at(fields.sway.rate, fields.joint);
  }
}

/** Grown pose of a body, used while building the bodies. */
interface RestPose {
  x: number;
  y: number;
  heading: number;
}

/**
 * Bends the tree under gravity and wind. Each limb is a chain of rigid bodies joined by springs as
 * stiff as the wood at that point, so thin twigs flex while the trunk barely moves. The grown
 * shape is the resting shape: the springs are preloaded to hold the tree's own weight, and only
 * wind, or weight the tree did not grow with, moves it.
 */
export class TreePhysics {
  /** Mass-weighted average velocity of the whole tree, in meters per second. Zero at rest. */
  readonly motion = { x: 0, y: 0 };
  private readonly sways = new Map<Limb, Sway>();
  private bodies: Body[] = [];
  private stale = true;
  private still = true;

  /** True while the tree is at rest in calm air, so the grown shape is the drawn shape. */
  get asleep(): boolean {
    return this.still;
  }

  /** Marks the grown shape as changed, so the bodies are rebuilt before the next step. */
  invalidate(): void {
    this.stale = true;
  }

  /** Joint angles at every joint spacing along the limb, or undefined while the tree is at rest. */
  bends(limb: Limb): readonly number[] | undefined {
    return this.still ? undefined : this.sways.get(limb)?.angle;
  }

  /** Largest joint angle anywhere in the tree, in radians. */
  maxBend(): number {
    let largest = 0;
    for (const body of this.bodies) {
      largest = Math.max(largest, Math.abs(body.angle));
    }
    return largest;
  }

  step(dt: number, limbs: readonly Limb[], wind: Wind): void {
    if (this.still && wind.calm) {
      return;
    }
    this.still = false;
    if (this.stale) {
      this.sync(limbs);
      this.stale = false;
    }
    const steps = Math.max(1, Math.ceil(dt / PHYSICS.step - 1e-9));
    for (let i = 0; i < steps; i += 1) {
      this.integrate(dt / steps, wind);
    }
    const settled = wind.calm && this.bodies.every((b) => Math.abs(b.angle) < STILL_ANGLE && Math.abs(b.rate) < STILL_RATE);
    for (const body of this.bodies) {
      if (settled) {
        body.angle = 0;
        body.rate = 0;
      }
      body.sway.angle[body.joint] = body.angle;
      body.sway.rate[body.joint] = body.rate;
    }
    if (settled) {
      this.motion.x = 0;
      this.motion.y = 0;
    }
    this.still = settled;
  }

  /** Rebuilds the bodies from the grown shape, keeping every joint's motion. */
  private sync(limbs: readonly Limb[]): void {
    const spacing = PHYSICS.jointSpacing;
    const bodies: Body[] = [];
    const poses: RestPose[] = [];
    const firstBody = new Map<Limb, { index: number; count: number }>();
    for (const [limbIndex, limb] of limbs.entries()) {
      // Joints sit at whole multiples of the spacing, so growth only ever adds joints at the tip
      // and every existing joint keeps its motion. The last body runs from half to one and a
      // half spacings long.
      const count = Math.max(1, Math.floor(limb.length / spacing + 0.5));
      const sway = this.swayFor(limb, count);
      firstBody.set(limb, { index: bodies.length, count });
      for (let k = 0; k < count; k += 1) {
        const s0 = k * spacing;
        const s1 = k === count - 1 ? limb.length : (k + 1) * spacing;
        const p0 = limb.restPointAt(s0);
        const p1 = limb.restPointAt(s1);
        const heading = Math.atan2(p1.y - p0.y, p1.x - p0.x);
        const length = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const r0 = limb.radiusAt(s0);
        const r1 = limb.radiusAt(s1);
        const arc = s1 - s0;
        const spread = r0 * r0 + r0 * r1 + r1 * r1;
        const mass = (PHYSICS.woodDensity * Math.PI * arc * spread) / 3;
        // A joint's spring stands for the wood half a body either side of it.
        const span = k === 0 ? arc / 2 : (arc + at(bodies, bodies.length - 1).arc) / 2;
        let parent: Body | undefined;
        let parentPose: RestPose | undefined;
        if (k > 0) {
          parent = at(bodies, bodies.length - 1);
          parentPose = at(poses, poses.length - 1);
        } else if (limb.attachment !== undefined) {
          const host = firstBody.get(limb.attachment.parent);
          invariant(host !== undefined, 'A parent limb must be simulated before its offshoots.');
          const index = host.index + Math.min(Math.floor(limb.attachment.s / spacing), host.count - 1);
          parent = at(bodies, index);
          parentPose = at(poses, index);
        }
        let offsetX = p0.x;
        let offsetY = p0.y;
        let restAngle = heading;
        if (parentPose !== undefined) {
          const dx = p0.x - parentPose.x;
          const dy = p0.y - parentPose.y;
          const c = Math.cos(parentPose.heading);
          const s = Math.sin(parentPose.heading);
          offsetX = dx * c + dy * s;
          offsetY = dy * c - dx * s;
          restAngle = wrapAngle(heading - parentPose.heading);
        }
        bodies.push(
          new Body({
            sway,
            joint: k,
            parent,
            restAngle,
            offsetX,
            offsetY,
            length,
            arc,
            com: (length * (r0 * r0 + 2 * r0 * r1 + 3 * r1 * r1)) / (4 * spread),
            mass,
            inertia: mass * ((length * length) / 12 + (r0 * r0 + r1 * r1) / 8),
            radius: (r0 + r1) / 2,
            stiffness: (PHYSICS.stiffness * Math.PI * r0 ** 4) / (4 * span),
            eddy: limbIndex * 1009 + k,
          }),
        );
        poses.push({ x: p0.x, y: p0.y, heading });
      }
    }
    this.weigh(bodies, poses);
    this.bodies = bodies;
  }

  private swayFor(limb: Limb, count: number): Sway {
    let sway = this.sways.get(limb);
    if (sway === undefined) {
      sway = { angle: [], rate: [] };
      this.sways.set(limb, sway);
    }
    while (sway.angle.length < count) {
      sway.angle.push(0);
      sway.rate.push(0);
    }
    return sway;
  }

  /**
   * Works out what each joint holds up in the grown pose: the preload that keeps the tree's own
   * weight from sagging it, and damping in proportion to what the joint swings.
   */
  private weigh(bodies: readonly Body[], poses: readonly RestPose[]): void {
    const index = new Map<Body, number>(bodies.map((body, i) => [body, i]));
    // Mass, first moments and second moment of each body and everything it holds up.
    const mass: number[] = [];
    const mx: number[] = [];
    const my: number[] = [];
    const second: number[] = [];
    for (const [i, body] of bodies.entries()) {
      const pose = at(poses, i);
      const cx = pose.x + body.com * Math.cos(pose.heading);
      const cy = pose.y + body.com * Math.sin(pose.heading);
      mass.push(body.mass);
      mx.push(body.mass * cx);
      my.push(body.mass * cy);
      second.push(body.mass * (cx * cx + cy * cy) + body.inertia);
    }
    for (let i = bodies.length - 1; i >= 0; i -= 1) {
      const body = at(bodies, i);
      const { x, y } = at(poses, i);
      const m = at(mass, i);
      body.preload = PHYSICS.gravity * (at(mx, i) - m * x);
      const inertia = at(second, i) - 2 * (x * at(mx, i) + y * at(my, i)) + m * (x * x + y * y);
      body.damping = 2 * PHYSICS.damping * Math.sqrt(body.stiffness * inertia);
      if (body.parent !== undefined) {
        const p = index.get(body.parent);
        invariant(p !== undefined, 'A body hangs from a body that is not simulated.');
        mass[p] = at(mass, p) + m;
        mx[p] = at(mx, p) + at(mx, i);
        my[p] = at(my, p) + at(my, i);
        second[p] = at(second, p) + at(second, i);
      }
    }
  }

  /**
   * Advances every joint by `h` seconds. The joint springs and dampers are integrated implicitly,
   * folded into each joint's effective inertia, so stiff thick wood stays stable at any step.
   */
  private integrate(h: number, wind: Wind): void {
    const bodies = this.bodies;
    const g = PHYSICS.gravity;
    // Drag per meter of wood is half the air density, times the drag coefficient, times the
    // diameter, times the square of the crossing air speed. Per unit radius that is this.
    const airDrag = PHYSICS.airDensity * PHYSICS.drag;

    let totalMass = 0;
    let momentumX = 0;
    let momentumY = 0;

    // Outward: positions, velocities, and the forces on each body on its own.
    for (const b of bodies) {
      const q = b.restAngle + b.angle;
      const qd = b.rate;
      let theta = q;
      let jx = b.offsetX;
      let jy = b.offsetY;
      let pw = 0;
      let pvx = 0;
      let pvy = 0;
      const parent = b.parent;
      if (parent !== undefined) {
        const c = Math.cos(parent.theta);
        const s = Math.sin(parent.theta);
        theta = parent.theta + q;
        jx = parent.jx + c * b.offsetX - s * b.offsetY;
        jy = parent.jy + s * b.offsetX + c * b.offsetY;
        pw = parent.w;
        pvx = parent.vx;
        pvy = parent.vy;
      }
      const w = pw + qd;
      const vx = pvx + jy * qd;
      const vy = pvy - jx * qd;
      b.theta = theta;
      b.jx = jx;
      b.jy = jy;
      b.w = w;
      b.vx = vx;
      b.vy = vy;
      b.c2 = qd * (vy + w * jx);
      b.c3 = qd * (w * jy - vx);

      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const cx = jx + b.com * cos;
      const cy = jy + b.com * sin;
      const m = b.mass;
      const i11 = b.inertia + m * (cx * cx + cy * cy);
      const i12 = -m * cy;
      const i13 = m * cx;
      b.i11 = i11;
      b.i12 = i12;
      b.i13 = i13;
      b.i22 = m;
      b.i23 = 0;
      b.i33 = m;
      totalMass += m;
      momentumX += m * (vx - w * cy);
      momentumY += m * (vy + w * cx);

      // Velocity-product force from the body's momentum, minus gravity at its center of mass.
      const h2 = i12 * w + m * vx;
      const h3 = i13 * w + m * vy;
      let p1 = vx * h3 - vy * h2 + m * g * cx;
      let p2 = -w * h3;
      let p3 = w * h2 + m * g;

      // Drag from the air moving across the body, at its midpoint.
      const mx = jx + 0.5 * b.length * cos;
      const my = jy + 0.5 * b.length * sin;
      const air = wind.at(mx, my, b.eddy);
      let rx = air.x - (vx - w * my);
      let ry = air.y - (vy + w * mx);
      const along = rx * cos + ry * sin;
      rx -= along * cos;
      ry -= along * sin;
      const k = airDrag * b.radius * b.arc * Math.hypot(rx, ry);
      const fx = k * rx;
      const fy = k * ry;
      p1 -= mx * fy - my * fx;
      p2 -= fx;
      p3 -= fy;
      b.p1 = p1;
      b.p2 = p2;
      b.p3 = p3;
    }
    this.motion.x = momentumX / totalMass;
    this.motion.y = momentumY / totalMass;

    // Inward: fold each body's articulated inertia and bias force into its parent.
    for (let i = bodies.length - 1; i >= 0; i -= 1) {
      const b = at(bodies, i);
      const jx = b.jx;
      const jy = b.jy;
      const u1 = b.i11 + b.i12 * jy - b.i13 * jx;
      const u2 = b.i12 + b.i22 * jy - b.i23 * jx;
      const u3 = b.i13 + b.i23 * jy - b.i33 * jx;
      const d = u1 + jy * u2 - jx * u3 + h * b.damping + h * h * b.stiffness;
      const torque = b.preload - b.stiffness * b.angle - (b.damping + h * b.stiffness) * b.rate;
      const u = torque - (b.p1 + jy * b.p2 - jx * b.p3);
      b.u1 = u1;
      b.u2 = u2;
      b.u3 = u3;
      b.d = d;
      b.u = u;
      const parent = b.parent;
      if (parent === undefined) {
        continue;
      }
      const inv = 1 / d;
      const k11 = b.i11 - u1 * u1 * inv;
      const k12 = b.i12 - u1 * u2 * inv;
      const k13 = b.i13 - u1 * u3 * inv;
      const k22 = b.i22 - u2 * u2 * inv;
      const k23 = b.i23 - u2 * u3 * inv;
      const k33 = b.i33 - u3 * u3 * inv;
      const scale = u * inv;
      parent.i11 += k11;
      parent.i12 += k12;
      parent.i13 += k13;
      parent.i22 += k22;
      parent.i23 += k23;
      parent.i33 += k33;
      parent.p1 += b.p1 + k12 * b.c2 + k13 * b.c3 + u1 * scale;
      parent.p2 += b.p2 + k22 * b.c2 + k23 * b.c3 + u2 * scale;
      parent.p3 += b.p3 + k23 * b.c2 + k33 * b.c3 + u3 * scale;
    }

    // Outward: joint accelerations, then step every joint forward.
    for (const b of bodies) {
      const parent = b.parent;
      const e1 = parent === undefined ? 0 : parent.a1;
      const e2 = (parent === undefined ? 0 : parent.a2) + b.c2;
      const e3 = (parent === undefined ? 0 : parent.a3) + b.c3;
      const accel = (b.u - (b.u1 * e1 + b.u2 * e2 + b.u3 * e3)) / b.d;
      b.a1 = e1 + accel;
      b.a2 = e2 + b.jy * accel;
      b.a3 = e3 - b.jx * accel;
      b.rate += h * accel;
      b.angle += h * b.rate;
    }
  }
}
