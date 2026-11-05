import type { Camera } from "./camera";
import type { Limb } from "./limb";
import type { Load } from "./physics";
import type { Tree } from "./tree";
import { approach, lerp, Rng } from "./util";

/** The birds, as the debug panel sets them. */
export interface BirdSettings {
  /** How many birds come by each minute. */
  perMinute: number;
  /** Share of them that land on the tree, if it has wood to land on, from 0 to 1. */
  landing: number;
}

/**
 * Birds flying across the scene, and landing on the tree. All sizes are in meters, kilograms and
 * seconds, for a bird of the usual size: about a crow's.
 */
const BIRD = {
  /** Length of a bird's body, and the reach of its wing. */
  body: 0.24,
  wing: 0.34,
  /** Mass of a bird. */
  mass: 0.45,
  /** How much birds differ in size, either way. */
  sizes: { from: 0.75, to: 1.25 },
  /** Speed a bird flies at, from the slowest to the fastest, and how far it rises and falls. */
  speed: { from: 6, to: 9 },
  bob: 0.6,
  /** Wingbeats per second, and the share of the time a bird glides on still wings. */
  flaps: 4.5,
  glide: 0.35,
  /** Height above the ground birds fly across at, from lowest to highest. */
  heights: { from: 3, to: 22 },
  /** Seconds a bird takes to settle onto its perch once close, and to turn its flight. */
  settle: 0.5,
  turn: 0.6,
  /** A bird coming in to land slows to this speed as it closes in, within this distance. */
  landingSpeed: 1.2,
  landingReach: 3,
  /** It is perched once this close. */
  arrive: 0.06,
  /** Seconds a bird sits on its perch, from the shortest to the longest. */
  sits: { from: 6, to: 22 },
  /** Thinnest wood a bird lands on, as a radius, and steepest, in radians from level. */
  minRadius: 0.01,
  steepest: 0.8,
  /** Birds keep this far apart on the tree. */
  apart: 0.45,
  /** Wood is tried for perches this far apart along each limb. */
  step: 0.3,
} as const;

/** How far a gliding bird holds its wing raised, from -1 down to 1 up. */
const GLIDING_WING = 0.45;

type Doing = "crossing" | "landing" | "perched" | "leaving";

interface Bird {
  x: number;
  y: number;
  vx: number;
  vy: number;
  doing: Doing;
  /** Which way it faces: 1 right, -1 left. */
  facing: 1 | -1;
  /** Where it lands, or sits: a limb and how far along it. */
  perch: { limb: Limb; s: number } | undefined;
  /** Seconds left sitting, while perched. */
  timer: number;
  /** Progress through its wingbeat and its rising and falling, in radians. */
  flap: number;
  bob: number;
  /** Seconds left gliding on still wings, or flapping before it next glides. */
  glide: number;
  flapping: number;
  /** Its size, as a multiple of the usual. */
  size: number;
  /** Height it flies across at, and speed. */
  height: number;
  speed: number;
}

/** A bird where it is, for drawing. */
export interface BirdView {
  x: number;
  y: number;
  /** Which way it faces, and the way it flies, in radians, while it flies. */
  facing: 1 | -1;
  heading: number;
  /** Whether it sits on its perch, and if not, how far its wing is raised, from -1 down to 1 up. */
  perched: boolean;
  wing: number;
  size: number;
}

/** The birds about the scene. */
export class Birds {
  private birds: Bird[] = [];
  private readonly rng = new Rng(5150);
  /** Birds owed to the scene, a fraction of one carried from step to step. */
  private owed = 0;

  clear(): void {
    this.birds = [];
    this.owed = 0;
  }

  /** The weight of the birds sitting on `tree`, which their limbs carry. */
  loads(tree: Tree): Load[] {
    const loads: Load[] = [];
    for (const bird of this.birds) {
      if (
        bird.doing === "perched" &&
        bird.perch !== undefined &&
        sits(tree, bird.perch)
      ) {
        loads.push({
          limb: bird.perch.limb,
          s: bird.perch.s,
          mass: BIRD.mass * bird.size ** 3,
        });
      }
    }
    return loads;
  }

  /**
   * Moves the birds on by `dt` seconds: brings new ones in at the edges of the view as often as
   * `settings` asks, flies them across, lands some on `tree`, and sends them off again.
   */
  update(
    dt: number,
    tree: Tree | undefined,
    camera: Camera,
    settings: BirdSettings,
  ): void {
    const view = viewOf(camera);
    this.owed += (dt * settings.perMinute) / 60;
    while (this.owed >= 1) {
      this.owed -= 1;
      this.arrive(tree, view, settings);
    }
    for (const bird of this.birds) {
      this.move(dt, bird, tree);
    }
    // Birds that have flown well clear of the view are gone.
    const margin = (view.right - view.left) * 0.25;
    this.birds = this.birds.filter(
      (bird) =>
        bird.doing === "perched" ||
        bird.doing === "landing" ||
        (bird.x > view.left - margin - 1 &&
          bird.x < view.right + margin + 1 &&
          bird.y < view.top + margin + 30),
    );
  }

  views(): BirdView[] {
    return this.birds.map((bird) => ({
      x: bird.x,
      y: bird.y,
      facing: bird.facing,
      heading: Math.atan2(bird.vy, Math.abs(bird.vx) + 1e-6),
      perched: bird.doing === "perched",
      wing: bird.glide > 0 ? GLIDING_WING : Math.sin(bird.flap),
      size: bird.size,
    }));
  }

  /** Brings a bird in from one side of the view, to cross it or to land on the tree. */
  private arrive(
    tree: Tree | undefined,
    view: View,
    settings: BirdSettings,
  ): void {
    const facing = this.rng.next() < 0.5 ? 1 : -1;
    const size = lerp(BIRD.sizes.from, BIRD.sizes.to, this.rng.next());
    const height = lerp(
      Math.max(view.bottom, BIRD.heights.from),
      Math.max(
        Math.max(view.bottom, BIRD.heights.from) + 1,
        Math.min(view.top, BIRD.heights.to),
      ),
      this.rng.next(),
    );
    const speed = lerp(BIRD.speed.from, BIRD.speed.to, this.rng.next());
    const perch =
      tree !== undefined && this.rng.next() < settings.landing
        ? this.perchOn(tree, view)
        : undefined;
    const x =
      facing > 0 ? view.left - BIRD.wing * 2 : view.right + BIRD.wing * 2;
    this.birds.push({
      x,
      y: perch === undefined ? height : Math.max(height, perch.at.y + 2),
      vx: facing * speed,
      vy: 0,
      doing: perch === undefined ? "crossing" : "landing",
      facing,
      perch: perch === undefined ? undefined : { limb: perch.limb, s: perch.s },
      timer: 0,
      flap: this.rng.next() * Math.PI * 2,
      bob: this.rng.next() * Math.PI * 2,
      glide: 0,
      flapping: this.rng.next() * 2,
      size,
      height,
      speed,
    });
  }

  /**
   * Somewhere on `tree` in `view` for a bird to land: on top of wood thick enough to take it and
   * level enough to stand on, clear of the other birds there. Undefined if there is none.
   */
  private perchOn(
    tree: Tree,
    view: View,
  ): { limb: Limb; s: number; at: { x: number; y: number } } | undefined {
    const taken: { x: number; y: number }[] = [];
    for (const bird of this.birds) {
      if (bird.perch !== undefined) {
        taken.push(perchPoint(bird.perch));
      }
    }
    const spots: { limb: Limb; s: number; at: { x: number; y: number } }[] = [];
    for (const limb of tree.limbs) {
      for (let s = BIRD.step / 2; s < limb.length; s += BIRD.step) {
        const p = limb.pointAt(s);
        if (
          limb.radiusAt(s) < BIRD.minRadius ||
          Math.abs(Math.cos(p.heading)) < Math.cos(BIRD.steepest)
        ) {
          continue;
        }
        const at = perchPoint({ limb, s });
        const seen = at.x > view.left && at.x < view.right && at.y < view.top;
        const clear = taken.every(
          (other) => Math.hypot(other.x - at.x, other.y - at.y) >= BIRD.apart,
        );
        if (seen && clear) {
          spots.push({ limb, s, at });
        }
      }
    }
    return spots[Math.floor(this.rng.next() * spots.length)];
  }

  /** Flies, lands, sits or sends off `bird` for `dt` seconds. */
  private move(dt: number, bird: Bird, tree: Tree | undefined): void {
    // A bird whose perch is cut or breaks away flies off at once.
    if (
      bird.perch !== undefined &&
      (bird.doing === "landing" || bird.doing === "perched") &&
      (tree === undefined || !sits(tree, bird.perch))
    ) {
      this.leave(bird);
    }
    bird.flap += dt * BIRD.flaps * Math.PI * 2;
    bird.bob += dt * 1.3;
    if (bird.glide > 0) {
      bird.glide -= dt;
    } else {
      bird.flapping -= dt;
      if (bird.flapping <= 0) {
        bird.glide = this.rng.next() < BIRD.glide ? 0.8 + this.rng.next() : 0;
        bird.flapping = 1 + 2 * this.rng.next();
      }
    }
    switch (bird.doing) {
      case "crossing":
      case "leaving": {
        const climb = bird.doing === "leaving" ? 1.2 : 0;
        const wantX = bird.facing * bird.speed;
        const wantY =
          climb + (bird.height - bird.y) * 0.3 + BIRD.bob * Math.cos(bird.bob);
        bird.vx = approach(bird.vx, wantX, BIRD.turn, dt);
        bird.vy = approach(bird.vy, wantY, BIRD.turn, dt);
        break;
      }
      case "landing": {
        if (bird.perch === undefined) {
          throw new Error("A bird is landing with nowhere to land.");
        }
        const at = perchPoint(bird.perch);
        const dx = at.x - bird.x;
        const dy = at.y - bird.y;
        const distance = Math.hypot(dx, dy);
        if (distance < BIRD.arrive) {
          bird.doing = "perched";
          bird.timer = lerp(BIRD.sits.from, BIRD.sits.to, this.rng.next());
          bird.vx = 0;
          bird.vy = 0;
          bird.facing = this.rng.next() < 0.5 ? 1 : -1;
          break;
        }
        const speed = lerp(
          BIRD.landingSpeed,
          bird.speed,
          Math.min(1, distance / BIRD.landingReach),
        );
        bird.vx = approach(bird.vx, (dx / distance) * speed, BIRD.settle, dt);
        bird.vy = approach(bird.vy, (dy / distance) * speed, BIRD.settle, dt);
        if (Math.abs(bird.vx) > 0.2) {
          bird.facing = bird.vx > 0 ? 1 : -1;
        }
        bird.glide = 0;
        break;
      }
      case "perched": {
        if (bird.perch === undefined) {
          throw new Error("A bird is perched with nowhere to sit.");
        }
        const at = perchPoint(bird.perch);
        bird.x = at.x;
        bird.y = at.y;
        bird.timer -= dt;
        if (bird.timer <= 0) {
          this.leave(bird);
        }
        return;
      }
      default: {
        const unknown: never = bird.doing;
        throw new Error(`Unknown thing for a bird to do: ${String(unknown)}.`);
      }
    }
    bird.x += bird.vx * dt;
    bird.y += bird.vy * dt;
  }

  /** Sends `bird` off its perch, up and away the way it faces. */
  private leave(bird: Bird): void {
    bird.doing = "leaving";
    bird.perch = undefined;
    bird.vx = bird.facing * 2;
    bird.vy = 2.5;
    bird.height = bird.y + 4 + 4 * this.rng.next();
    bird.glide = 0;
  }
}

/** The part of the world in view, in meters. */
interface View {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

function viewOf(camera: Camera): View {
  const corner = camera.toWorld(0, camera.height);
  const opposite = camera.toWorld(camera.width, 0);
  return {
    left: corner.x,
    right: opposite.x,
    bottom: Math.max(0, corner.y),
    top: opposite.y,
  };
}

/** Whether a bird can still sit on `perch` on `tree`: its limb is there, and still reaches it. */
function sits(tree: Tree, perch: { limb: Limb; s: number }): boolean {
  return tree.has(perch.limb) && perch.s <= perch.limb.length;
}

/** Where a bird sitting on `perch` stands: on top of the wood. */
function perchPoint(perch: { limb: Limb; s: number }): {
  x: number;
  y: number;
} {
  const p = perch.limb.pointAt(perch.s);
  const radius = perch.limb.radiusAt(perch.s);
  // Of the two sides of the wood, the one facing up.
  const side = Math.cos(p.heading) >= 0 ? 1 : -1;
  return {
    x: p.x - side * Math.sin(p.heading) * radius,
    y: p.y + side * Math.cos(p.heading) * radius,
  };
}

/**
 * The silhouette of a bird, in meters: a flying bird's body, head and tail along its flight with
 * its near wing raised or lowered in its beat; a perched one sitting up on its feet, its wings
 * folded. Every part winds counterclockwise, as the tree's ink does, so parts that overlap fill
 * solid rather than cancel.
 */
export function birdShape(bird: BirdView): Path2D {
  const path = new Path2D();
  const length = BIRD.body * bird.size;
  const f = bird.facing;
  if (bird.perched) {
    // Sitting up on its feet, its body leaning forward of upright, tail down behind.
    const lean = 0.55;
    const feet = { x: bird.x, y: bird.y };
    const hip = { x: feet.x - f * 0.01, y: feet.y + 0.05 * bird.size };
    const middle = {
      x: hip.x + f * Math.sin(lean) * length * 0.35,
      y: hip.y + Math.cos(lean) * length * 0.35,
    };
    path.ellipse(
      middle.x,
      middle.y,
      length * 0.42,
      length * 0.2,
      Math.PI / 2 - f * lean,
      0,
      Math.PI * 2,
    );
    const head = {
      x: middle.x + f * Math.sin(lean) * length * 0.42,
      y: middle.y + Math.cos(lean) * length * 0.42,
    };
    path.moveTo(head.x + length * 0.13, head.y);
    path.arc(head.x, head.y, length * 0.13, 0, Math.PI * 2);
    addPolygon(path, [
      { x: head.x + f * length * 0.1, y: head.y + length * 0.04 },
      { x: head.x + f * length * 0.25, y: head.y - length * 0.01 },
      { x: head.x + f * length * 0.1, y: head.y - length * 0.05 },
    ]);
    addPolygon(path, [
      { x: hip.x + f * length * 0.05, y: hip.y + length * 0.05 },
      { x: hip.x - f * length * 0.32, y: hip.y - length * 0.32 },
      { x: hip.x - f * length * 0.2, y: hip.y - length * 0.36 },
      { x: hip.x - f * length * 0.02, y: hip.y - length * 0.02 },
    ]);
    addPolygon(path, [
      { x: hip.x - 0.008, y: hip.y },
      { x: feet.x - 0.012, y: feet.y },
      { x: feet.x - 0.004, y: feet.y },
      { x: hip.x + 0.008, y: hip.y },
    ]);
    return path;
  }
  const angle = bird.heading;
  const ax = Math.cos(angle) * f;
  const ay = Math.sin(angle);
  // Points along the bird, forward of its middle by `along` and above it by `up`.
  const at = (along: number, up: number): Point => ({
    x: bird.x + ax * along - ay * f * up,
    y: bird.y + ay * along + Math.abs(ax) * up,
  });
  path.ellipse(
    bird.x,
    bird.y,
    length * 0.5,
    length * 0.14,
    f > 0 ? angle : Math.PI - angle,
    0,
    Math.PI * 2,
  );
  const head = at(length * 0.5, length * 0.03);
  path.moveTo(head.x + length * 0.1, head.y);
  path.arc(head.x, head.y, length * 0.1, 0, Math.PI * 2);
  addPolygon(path, [
    at(length * 0.58, length * 0.05),
    at(length * 0.72, 0),
    at(length * 0.58, -length * 0.03),
  ]);
  // A fanned tail behind.
  addPolygon(path, [
    at(-length * 0.4, length * 0.04),
    at(-length * 0.72, length * 0.09),
    at(-length * 0.72, -length * 0.07),
    at(-length * 0.4, -length * 0.04),
  ]);
  // The near wing, from the shoulder, swept back, raised or lowered with its beat: its leading
  // edge arches out to the tip, and its trailing edge sweeps back in, broad at the shoulder.
  const reach = BIRD.wing * bird.size;
  const lift = Math.sin(bird.wing * 1.1);
  const shoulderFront = at(length * 0.16, length * 0.06);
  const shoulderBack = at(-length * 0.2, length * 0.03);
  const tip = at(-reach * 0.38, reach * lift);
  const leading = at(reach * 0.12, reach * lift * 0.75 + length * 0.08);
  const trailing = at(-reach * 0.32, reach * lift * 0.3);
  addPolygon(path, [
    ...curve(shoulderFront, leading, tip),
    ...curve(tip, trailing, shoulderBack).slice(1),
  ]);
  return path;
}

interface Point {
  x: number;
  y: number;
}

/** Points along the quadratic curve from `from` through control `via` to `to`. */
function curve(from: Point, via: Point, to: Point): Point[] {
  const steps = 8;
  const points: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    points.push({
      x: a * from.x + b * via.x + c * to.x,
      y: a * from.y + b * via.y + c * to.y,
    });
  }
  return points;
}

/** Adds the polygon through `points` to `path`, wound counterclockwise. */
function addPolygon(path: Path2D, points: readonly Point[]): void {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) {
      throw new Error("A polygon's points ran out.");
    }
    area += a.x * b.y - b.x * a.y;
  }
  const ordered = area >= 0 ? points : [...points].reverse();
  ordered.forEach((p, i) => {
    if (i === 0) {
      path.moveTo(p.x, p.y);
    } else {
      path.lineTo(p.x, p.y);
    }
  });
  path.closePath();
}
