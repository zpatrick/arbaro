import type { Camera } from "./camera";
import type { Debris } from "./debris";
import type { HiveTarget } from "./hives";
import type { Limb } from "./limb";
import type { Push } from "./physics";
import { addCapsule, addPolygon, type Point } from "./silhouette";
import type { Tree } from "./tree";
import { approach, at, clamp, lerp, Rng, smoothstep } from "./util";

/** The bears, as the debug panel sets them. */
export interface BearSettings {
  /** Whether a hive draws a bear on its own. */
  comes: boolean;
}

/** Animations a bear can be shown playing in place, from the debug panel. */
export const BEAR_POSES = [
  "walk",
  "stroll",
  "run",
  "rear",
  "swipe",
  "shove",
  "eat",
  "die",
] as const;
export type BearPose = (typeof BEAR_POSES)[number];

/** A bear's body, in meters and kilograms: a black bear's. */
const BODY = {
  /** From the hip joint to the shoulder joint. */
  spine: 0.8,
  /** Height of the hip joint standing on all fours, and reared up. */
  hip: 0.7,
  rearedHip: 0.76,
  /** The bones of the hind leg and the length of the hind foot, which it walks flat on. */
  thigh: 0.42,
  shin: 0.38,
  foot: 0.22,
  /** The bones of the front leg and the length of the front paw. */
  arm: 0.37,
  forearm: 0.34,
  paw: 0.08,
  /** From the shoulders to the middle of the head, and the head's size. */
  neck: 0.4,
  head: 0.18,
  mass: 180,
} as const;

/** Highest a bear reared up on its hind legs reaches with a forepaw. */
const REACH = 2.2;

/**
 * How a bear walks and runs: how far each foot travels in a step, the share of each step it
 * spends on the ground, how high it lifts, when in the step each foot goes (near hind, far hind,
 * near front, far front), and how much the body rises and falls.
 */
const GAITS = {
  walk: {
    stride: 0.72,
    stance: 0.65,
    lift: 0.1,
    offsets: [0, 0.5, 0.25, 0.75],
    bob: 0.02,
  },
  run: {
    stride: 1.1,
    stance: 0.38,
    lift: 0.22,
    offsets: [0, 0.08, 0.5, 0.58],
    bob: 0.06,
  },
} as const;

/** Speeds a bear goes at, in meters per second. */
const SPEED = { stroll: 0.9, walk: 1.4, run: 6 } as const;

/** How a bear goes after a hive, and gives up. */
const HUNT = {
  /** Seconds a bear takes to rear up or drop back down. */
  rear: 0.7,
  /** Seconds a swipe takes, and rests between swipes. */
  swipe: 0.9,
  swipeRest: 0.6,
  /** A swipe connects with a hive this close to its middle, beyond its half-width. */
  swipeReach: 0.15,
  /** Force a swipe at a branch strikes it with, forward and down, in newtons. */
  swipeForce: { forward: 900, down: 1400 },
  /** How fast a swipe sends a hive flying, forward and up, in meters per second. */
  knock: { forward: 2.5, up: 1.5 },
  /** Seconds each shove takes, the share of it pushing, and the force of the push, in newtons. */
  shove: 1.4,
  pushing: 0.4,
  shoveForce: 700,
  /** Each time a bear is angered, it shoves this much harder and keeps at it this much longer. */
  angerForce: 0.4,
  angerPatience: 0.5,
  /** Seconds a bear keeps at a hive before it gives up. */
  patience: 30,
  /** Seconds a bear eats a hive it brought down. */
  eating: 8,
  /** Seconds an angered bear rears and roars before it goes back at the hive. */
  angry: 1.4,
} as const;

/**
 * What a blow from falling wood does to a bear, by its momentum in kilogram meters per second: a
 * light one only angers it, a heavier one drives it off, and one past `deadly` kills it.
 */
const BLOWS = { annoying: 50, deadly: 700 } as const;

/** Seconds a dead bear takes to collapse, lies before it fades, and takes to fade. */
const DEATH = { collapse: 0.35, lies: 6, fade: 3 } as const;

/** Seconds on average a finished hive waits before it draws a bear. */
const DRAW = 60;

type Doing =
  | "arriving"
  | "reaching"
  | "shoving"
  | "toHive"
  | "eating"
  | "leaving"
  | "fleeing"
  | "angry"
  | "dead"
  | "posing";

/** What a bear means to do at the tree, and where it stands to do it. */
type Plan =
  | { kind: "hive"; standAt: number; limb: Limb; s: number }
  | {
      kind: "branch";
      standAt: number;
      limb: Limb;
      s: number;
      hive: { limb: Limb; s: number };
    }
  | { kind: "trunk"; standAt: number };

interface Leg {
  root: Point;
  knee: Point;
  ankle: Point;
  toe: Point;
}

/** Where every part of a bear is, in meters. */
interface Pose {
  hip: Point;
  shoulder: Point;
  head: Point;
  /** The way the head faces, in radians from level, toward the way the bear faces. */
  headAngle: number;
  /** Near and far hind legs, then near and far front legs. */
  legs: [Leg, Leg, Leg, Leg];
}

interface Bear {
  /** Where its hips are along the ground, and which way it faces: 1 right, -1 left. */
  x: number;
  facing: 1 | -1;
  doing: Doing;
  /** How fast it goes along the ground, and its progress through its gait, from 0 to 1. */
  speed: number;
  gait: number;
  /** How far it has reared up, lowered its head, and collapsed, each from 0 to 1. */
  rear: number;
  headDown: number;
  collapse: number;
  /** Seconds into its current swipe, and shove. */
  swipe: number;
  shove: number;
  /** Seconds it keeps at the hive before it gives up, and how angry it is. */
  patience: number;
  anger: number;
  /** Seconds into what it is doing, for doings that last a while. */
  timer: number;
  plan: Plan | undefined;
  /** The hive it means to eat, once one is down. */
  meal: Debris | undefined;
  alpha: number;
  /** Pieces of wood that have already struck it. */
  felt: Set<Debris>;
  /** The animation it shows, while posing. */
  showing: BearPose | undefined;
}

/** What the bears live among. */
export interface BearWorld {
  tree: Tree | undefined;
  hives: readonly HiveTarget[];
  fallenHives: readonly Debris[];
  debris: readonly Debris[];
  camera: Camera;
}

/** A bear where it is, for drawing. */
export interface BearView {
  shape: Path2D;
  alpha: number;
}

/** The bears about the scene. */
export class Bears {
  private bears: Bear[] = [];
  private readonly rng = new Rng(7331);
  /** Seconds until a hive draws a bear, while one could. */
  private drawIn: number | undefined;

  clear(): void {
    this.bears = [];
    this.drawIn = undefined;
  }

  get count(): number {
    return this.bears.length;
  }

  /** Sends a bear in from the edge of the view, to go after the tree. */
  spawn(camera: Camera): void {
    const view = viewOf(camera);
    const facing = this.rng.next() < 0.5 ? 1 : -1;
    this.bears.push(
      makeBear(facing > 0 ? view.left - 2 : view.right + 2, facing, "arriving"),
    );
  }

  /**
   * Shows a bear playing `showing` in place, a little to one side of the middle of the view, or
   * at the trunk to shove it. It replaces any other bear shown so.
   */
  show(showing: BearPose, camera: Camera, tree: Tree | undefined): void {
    this.bears = this.bears.filter((bear) => bear.doing !== "posing");
    const view = viewOf(camera);
    const trunk = tree === undefined ? undefined : trunkAt(tree);
    const x =
      showing === "shove" && trunk !== undefined
        ? trunk.x - (trunk.radius + SHOVE_STAND)
        : lerp(view.left, view.right, 0.3);
    const bear = makeBear(x, 1, "posing");
    bear.showing = showing;
    this.bears.push(bear);
  }

  /**
   * Moves the bears on by `dt` seconds: brings one to a tree whose hive could draw it, and walks,
   * rears, swipes, shoves, eats, flees and dies. Returns the pushes they make on the tree.
   */
  update(dt: number, world: BearWorld, settings: BearSettings): Push[] {
    const pushes: Push[] = [];
    this.attract(dt, world, settings);
    for (const bear of this.bears) {
      this.feel(bear, world);
      this.act(dt, bear, world, pushes);
    }
    const view = viewOf(world.camera);
    this.bears = this.bears.filter(
      (bear) =>
        bear.alpha > 0 &&
        !(
          (bear.doing === "leaving" || bear.doing === "fleeing") &&
          (bear.x < view.left - 3 || bear.x > view.right + 3)
        ),
    );
    return pushes;
  }

  views(): BearView[] {
    return this.bears.map((bear) => ({
      shape: bearShape(poseOf(bear), bear.facing),
      alpha: bear.alpha,
    }));
  }

  /** Brings a bear to the tree, a while after it carries a hive, while none is about. */
  private attract(dt: number, world: BearWorld, settings: BearSettings): void {
    const drawing =
      settings.comes &&
      world.tree !== undefined &&
      world.hives.length > 0 &&
      this.bears.every((bear) => bear.doing === "posing");
    if (!drawing) {
      this.drawIn = undefined;
      return;
    }
    this.drawIn ??= -DRAW * Math.log(1 - this.rng.next());
    this.drawIn -= dt;
    if (this.drawIn <= 0) {
      this.drawIn = undefined;
      this.spawn(world.camera);
    }
  }

  /**
   * Feels any wood falling on `bear`: a light blow angers it, a heavier one drives it off, and one
   * heavy and fast enough kills it. The wood glances off it.
   */
  private feel(bear: Bear, world: BearWorld): void {
    if (bear.doing === "dead") {
      return;
    }
    const body = bodyOf(poseOf(bear));
    for (const piece of world.debris) {
      if (bear.felt.has(piece) || world.fallenHives.includes(piece)) {
        continue;
      }
      for (const point of piece.points()) {
        const struck = body.some(
          (part) =>
            Math.hypot(point.x - part.x, point.y - part.y) < part.r + point.r,
        );
        const speed = Math.hypot(point.vx, point.vy);
        if (!struck || speed < STRUCK_SPEED) {
          continue;
        }
        bear.felt.add(piece);
        const blow = piece.mass * speed;
        piece.strike(point.x, point.y, {
          x: -GLANCE * piece.mass * point.vx + bear.facing * 0.2 * blow,
          y: -GLANCE * piece.mass * point.vy,
        });
        if (blow >= BLOWS.deadly) {
          bear.doing = "dead";
          bear.timer = 0;
        } else if (blow >= BLOWS.annoying) {
          this.flee(bear, world);
        } else {
          bear.anger += 1;
          bear.patience += HUNT.patience * HUNT.angerPatience;
          if (bear.doing !== "posing") {
            bear.doing = "angry";
            bear.timer = 0;
          }
        }
        break;
      }
      if (bear.doing === "dead") {
        return;
      }
    }
  }

  /** Moves `bear` on by `dt` seconds at what it is doing. */
  private act(dt: number, bear: Bear, world: BearWorld, pushes: Push[]): void {
    bear.timer += dt;
    switch (bear.doing) {
      case "arriving": {
        bear.plan ??= planFor(bear, world);
        if (bear.plan === undefined) {
          this.leave(bear, world);
          break;
        }
        if (this.walkTo(dt, bear, bear.plan.standAt, SPEED.walk)) {
          bear.patience = HUNT.patience * (1 + HUNT.angerPatience * bear.anger);
          bear.doing = bear.plan.kind === "trunk" ? "shoving" : "reaching";
          bear.swipe = 0;
          bear.shove = 0;
        }
        break;
      }
      case "reaching":
        this.reach(dt, bear, world, pushes);
        break;
      case "shoving":
        this.shoveTrunk(dt, bear, world, pushes);
        break;
      case "toHive": {
        const meal = bear.meal;
        if (meal === undefined || meal.done) {
          this.leave(bear, world);
          break;
        }
        const over = meal.center.x - bear.facing * EAT_REACH;
        if (this.walkTo(dt, bear, over, SPEED.walk) && meal.resting) {
          bear.doing = "eating";
          bear.timer = 0;
        }
        break;
      }
      case "eating": {
        bear.speed = approach(bear.speed, 0, 0.2, dt);
        bear.rear = Math.max(0, bear.rear - dt / HUNT.rear);
        bear.headDown = Math.min(1, bear.headDown + dt / 0.6);
        if (bear.timer >= HUNT.eating) {
          bear.meal?.fade();
          bear.meal = undefined;
          this.leave(bear, world);
        }
        break;
      }
      case "leaving":
      case "fleeing": {
        this.settle(dt, bear);
        const speed = bear.doing === "fleeing" ? SPEED.run : SPEED.stroll;
        bear.speed = approach(bear.speed, speed, 0.4, dt);
        this.stride(dt, bear, bear.doing === "fleeing" ? "run" : "walk");
        bear.x += bear.facing * bear.speed * dt;
        break;
      }
      case "angry": {
        bear.speed = approach(bear.speed, 0, 0.2, dt);
        bear.headDown = Math.max(0, bear.headDown - dt / 0.4);
        bear.rear = Math.min(0.75, bear.rear + dt / HUNT.rear);
        if (bear.timer >= HUNT.angry) {
          bear.plan = undefined;
          bear.doing = "arriving";
        }
        break;
      }
      case "dead": {
        bear.speed = 0;
        bear.collapse = Math.min(1, bear.collapse + dt / DEATH.collapse);
        if (bear.timer > DEATH.lies) {
          bear.alpha = Math.max(0, bear.alpha - dt / DEATH.fade);
        }
        break;
      }
      case "posing":
        this.pose(dt, bear, world, pushes);
        break;
      default: {
        const unknown: never = bear.doing;
        throw new Error(`Unknown thing for a bear to do: ${String(unknown)}.`);
      }
    }
  }

  /**
   * Reared up under the hive or the wood it hangs from, `bear` swipes at it now and again until
   * it brings the hive down or loses patience.
   */
  private reach(
    dt: number,
    bear: Bear,
    world: BearWorld,
    pushes: Push[],
  ): void {
    const plan = bear.plan;
    if (plan === undefined || plan.kind === "trunk") {
      throw new Error("A bear is reaching with nothing to reach for.");
    }
    if (this.mealDown(bear, world)) {
      return;
    }
    const hive = world.hives.find((h) =>
      plan.kind === "hive"
        ? h.limb === plan.limb && h.s === plan.s
        : h.limb === plan.hive.limb && h.s === plan.hive.s,
    );
    if (hive === undefined || bear.patience <= 0) {
      this.leave(bear, world);
      return;
    }
    bear.patience -= dt;
    bear.speed = approach(bear.speed, 0, 0.2, dt);
    bear.headDown = Math.max(0, bear.headDown - dt / 0.4);
    bear.rear = Math.min(1, bear.rear + dt / HUNT.rear);
    if (bear.rear < 1) {
      return;
    }
    bear.swipe += dt;
    if (bear.swipe >= HUNT.swipe + HUNT.swipeRest) {
      bear.swipe = 0;
    }
    const striking =
      bear.swipe >= SWIPE.strike.from * HUNT.swipe &&
      bear.swipe <= SWIPE.strike.to * HUNT.swipe;
    if (!striking) {
      return;
    }
    const paw = poseOf(bear).legs[2].toe;
    if (plan.kind === "hive") {
      const middle = alongHive(hive, 0.6);
      if (
        Math.hypot(paw.x - middle.x, paw.y - middle.y) <
        hive.view.width / 2 + HUNT.swipeReach
      ) {
        hive.knock({
          x: bear.facing * HUNT.knock.forward,
          y: HUNT.knock.up,
        });
      }
      return;
    }
    const wood = plan.limb.pointAt(plan.s);
    if (
      world.tree !== undefined &&
      world.tree.has(plan.limb) &&
      plan.s <= plan.limb.length &&
      Math.hypot(paw.x - wood.x, paw.y - wood.y) < BRANCH_REACH
    ) {
      pushes.push({
        limb: plan.limb,
        s: plan.s,
        x: wood.x,
        y: wood.y,
        force: {
          x: bear.facing * HUNT.swipeForce.forward,
          y: -HUNT.swipeForce.down,
        },
      });
    }
  }

  /**
   * Reared up with its forepaws on the trunk, `bear` shoves it over and over, harder the angrier
   * it is, to shake the hive down, until it does or loses patience.
   */
  private shoveTrunk(
    dt: number,
    bear: Bear,
    world: BearWorld,
    pushes: Push[],
  ): void {
    if (this.mealDown(bear, world)) {
      return;
    }
    if (world.tree === undefined || bear.patience <= 0) {
      this.leave(bear, world);
      return;
    }
    bear.patience -= dt;
    bear.speed = approach(bear.speed, 0, 0.2, dt);
    bear.headDown = Math.max(0, bear.headDown - dt / 0.4);
    bear.rear = Math.min(1, bear.rear + dt / HUNT.rear);
    if (bear.rear < 1) {
      return;
    }
    this.push(dt, bear, world.tree, pushes);
  }

  /** Shoves `tree`'s trunk at the height of `bear`'s forepaws, in time with its shoving. */
  private push(dt: number, bear: Bear, tree: Tree, pushes: Push[]): void {
    bear.shove = (bear.shove + dt) % HUNT.shove;
    if (bear.shove > HUNT.pushing * HUNT.shove) {
      return;
    }
    const trunk = tree.root;
    const s = Math.min(trunk.length, SHOVE_HEIGHT);
    const at = trunk.pointAt(s);
    pushes.push({
      limb: trunk,
      s,
      x: at.x,
      y: at.y,
      force: {
        x:
          bear.facing *
          HUNT.shoveForce *
          (1 + HUNT.angerForce * bear.anger) *
          Math.sin((Math.PI * bear.shove) / (HUNT.pushing * HUNT.shove)),
        y: 0,
      },
    });
  }

  /** Plays the animation `bear` shows, in place. */
  private pose(dt: number, bear: Bear, world: BearWorld, pushes: Push[]): void {
    const showing = bear.showing;
    if (showing === undefined) {
      throw new Error("A bear is posing with nothing to show.");
    }
    switch (showing) {
      case "walk":
      case "stroll":
      case "run": {
        const speed = SPEED[showing];
        bear.speed = approach(bear.speed, speed, 0.3, dt);
        this.stride(dt, bear, showing === "run" ? "run" : "walk");
        break;
      }
      case "rear":
        bear.rear = 0.5 - 0.5 * Math.cos((bear.timer * Math.PI) / 2);
        break;
      case "swipe":
        bear.rear = Math.min(1, bear.rear + dt / HUNT.rear);
        if (bear.rear >= 1) {
          bear.swipe = (bear.swipe + dt) % (HUNT.swipe + HUNT.swipeRest);
        }
        break;
      case "shove":
        bear.rear = Math.min(1, bear.rear + dt / HUNT.rear);
        if (bear.rear >= 1 && world.tree !== undefined) {
          this.push(dt, bear, world.tree, pushes);
        }
        break;
      case "eat":
        bear.headDown = Math.min(1, bear.headDown + dt / 0.6);
        break;
      case "die": {
        const cycle = bear.timer % (DEATH.collapse + 2.5);
        bear.collapse = clamp(cycle / DEATH.collapse, 0, 1);
        break;
      }
      default: {
        const unknown: never = showing;
        throw new Error(`Unknown bear animation ${String(unknown)}.`);
      }
    }
  }

  /** Whether a hive is down for `bear` to eat; if so, it goes after it. */
  private mealDown(bear: Bear, world: BearWorld): boolean {
    const meal = world.fallenHives.find((piece) => !piece.done);
    if (meal === undefined) {
      return false;
    }
    bear.meal = meal;
    bear.doing = "toHive";
    bear.facing = meal.center.x >= bear.x ? 1 : -1;
    return true;
  }

  /** Sends `bear` off, away from the tree, at a stroll. */
  private leave(bear: Bear, world: BearWorld): void {
    bear.doing = "leaving";
    bear.facing = awayFrom(bear, world);
    bear.plan = undefined;
  }

  /** Sends `bear` running off, away from the tree. */
  private flee(bear: Bear, world: BearWorld): void {
    bear.doing = "fleeing";
    bear.facing = awayFrom(bear, world);
    bear.plan = undefined;
  }

  /** Drops `bear` back onto all fours, head up. */
  private settle(dt: number, bear: Bear): void {
    bear.rear = Math.max(0, bear.rear - dt / HUNT.rear);
    bear.headDown = Math.max(0, bear.headDown - dt / 0.4);
  }

  /**
   * Walks `bear` toward `x` at up to `speed`, slowing as it gets there. Returns whether it has
   * arrived.
   */
  private walkTo(dt: number, bear: Bear, x: number, speed: number): boolean {
    this.settle(dt, bear);
    const gap = x - bear.x;
    if (Math.abs(gap) < ARRIVED) {
      bear.speed = approach(bear.speed, 0, 0.25, dt);
      this.stride(dt, bear, "walk");
      return bear.speed < 0.15;
    }
    bear.facing = gap > 0 ? 1 : -1;
    const want = Math.min(speed, Math.abs(gap) * 1.5);
    bear.speed = approach(bear.speed, want, 0.4, dt);
    this.stride(dt, bear, "walk");
    bear.x += bear.facing * Math.min(bear.speed * dt, Math.abs(gap));
    return false;
  }

  /** Moves `bear` on through its gait, as fast as it goes. */
  private stride(dt: number, bear: Bear, gait: keyof typeof GAITS): void {
    const { stride, stance } = GAITS[gait];
    bear.gait = (bear.gait + (dt * bear.speed * stance) / stride) % 1;
  }
}

/** The swipe of a forepaw: wound up, struck through, and drawn back, as shares of a swipe. */
const SWIPE = {
  windUp: 0.3,
  strike: { from: 0.3, to: 0.5 },
  /** The paw's angle from level ahead, raised back over the head, and struck through low. */
  raised: 1.9,
  low: -0.6,
  rest: 0.4,
} as const;
/** A swipe strikes the wood it aims at when the paw passes this close. */
const BRANCH_REACH = 0.3;
/** A bear shoves the trunk this high, and stands this far back from it, hips to bark. */
const SHOVE_HEIGHT = 1.35;
const SHOVE_STAND = 0.78;
/** A bear eats a hive standing this far behind it, so its head is over it. */
const EAT_REACH = 0.95;
/** A bear has arrived where it was going once this close, in meters. */
const ARRIVED = 0.08;
/** Wood falling slower than this is resting on a bear, not striking it, in meters per second. */
const STRUCK_SPEED = 1;
/** Wood striking a bear glances off with this much of the speed it struck with. */
const GLANCE = 0.5;

function makeBear(x: number, facing: 1 | -1, doing: Doing): Bear {
  return {
    x,
    facing,
    doing,
    speed: 0,
    gait: 0,
    rear: 0,
    headDown: 0,
    collapse: 0,
    swipe: 0,
    shove: 0,
    patience: HUNT.patience,
    anger: 0,
    timer: 0,
    plan: undefined,
    meal: undefined,
    alpha: 1,
    felt: new Set(),
    showing: undefined,
  };
}

/** The part of the world in view, in meters. */
function viewOf(camera: Camera): { left: number; right: number } {
  return {
    left: camera.toWorld(0, 0).x,
    right: camera.toWorld(camera.width, 0).x,
  };
}

/** The way away from the tree for `bear`: 1 right, -1 left. */
function awayFrom(bear: Bear, world: BearWorld): 1 | -1 {
  const trunk = world.tree === undefined ? undefined : trunkAt(world.tree);
  if (trunk === undefined) {
    return bear.facing;
  }
  return bear.x >= trunk.x ? 1 : -1;
}

/** Height of the ground at `x`, in meters. The world is level ground for now. */
function groundAt(_x: number): number {
  return 0;
}

/** Where the trunk of `tree` stands at the height a bear shoves it, and how thick it is there. */
function trunkAt(tree: Tree): { x: number; radius: number } {
  const s = Math.min(tree.root.length, SHOVE_HEIGHT);
  return { x: tree.root.pointAt(s).x, radius: tree.root.radiusAt(s) };
}

/**
 * What `bear` means to do at the tree: swipe the nearest hive down if it can reach it reared up;
 * else swipe at the wood it hangs from, where that is in reach nearest the hive; else shove the
 * trunk to shake it down. With no hive it shoves the trunk all the same. Undefined with no tree.
 */
function planFor(bear: Bear, world: BearWorld): Plan | undefined {
  const tree = world.tree;
  if (tree === undefined) {
    return undefined;
  }
  const trunk = trunkAt(tree);
  const hive = [...world.hives].sort(
    (a, b) => Math.abs(a.view.x - bear.x) - Math.abs(b.view.x - bear.x),
  )[0];
  // Bears come at the tree from the side they arrive on.
  const side = bear.x <= trunk.x ? 1 : -1;
  const trunkPlan: Plan = {
    kind: "trunk",
    standAt: trunk.x - side * (trunk.radius + SHOVE_STAND),
  };
  if (hive === undefined) {
    return trunkPlan;
  }
  const bottom = alongHive(hive, 1);
  if (bottom.y <= REACH) {
    const facing = bottom.x >= bear.x ? 1 : -1;
    return {
      kind: "hive",
      standAt: bottom.x - facing * HIVE_STAND,
      limb: hive.limb,
      s: hive.s,
    };
  }
  for (let s = hive.s; s >= 0; s -= 0.1) {
    const wood = hive.limb.pointAt(s);
    if (wood.y <= REACH - 0.1) {
      const facing = wood.x >= bear.x ? 1 : -1;
      return {
        kind: "branch",
        standAt: wood.x - facing * BRANCH_STAND,
        limb: hive.limb,
        s,
        hive: { limb: hive.limb, s: hive.s },
      };
    }
  }
  return trunkPlan;
}

/** A bear swipes at a hive standing this far short of it, hips to hive, and at wood this far. */
const HIVE_STAND = 0.5;
const BRANCH_STAND = 0.45;

/** The point `t` of the way down the axis of the hive `hive`. */
function alongHive(hive: HiveTarget, t: number): Point {
  const { view } = hive;
  return {
    x: view.x + Math.sin(view.swing) * view.height * t,
    y: view.y - Math.cos(view.swing) * view.height * t,
  };
}

/**
 * Where the leg from `root` reaching for `target` bends, with bones `a` and `b` long, bending
 * toward `bend` (1 counterclockwise from the line to the target, -1 clockwise), and where its end
 * gets to: as far as it reaches toward the target.
 */
function bendLeg(
  root: Point,
  target: Point,
  a: number,
  b: number,
  bend: 1 | -1,
): { knee: Point; end: Point } {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const d = clamp(Math.hypot(dx, dy), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const toward = Math.atan2(dy, dx);
  const open = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
  const kneeAngle = toward + bend * open;
  const knee = {
    x: root.x + a * Math.cos(kneeAngle),
    y: root.y + a * Math.sin(kneeAngle),
  };
  const endAngle = Math.atan2(
    root.y + d * Math.sin(toward) - knee.y,
    root.x + d * Math.cos(toward) - knee.x,
  );
  return {
    knee,
    end: {
      x: knee.x + b * Math.cos(endAngle),
      y: knee.y + b * Math.sin(endAngle),
    },
  };
}

/** Where every part of `bear` is, from what it is doing and how far into it. */
function poseOf(bear: Bear): Pose {
  const f = bear.facing;
  const reared = smoothstep(0, 1, bear.rear);
  const down = smoothstep(0, 1, bear.collapse);
  const running = smoothstep(SPEED.walk, SPEED.run, bear.speed);
  const gait = running > 0.5 ? GAITS.run : GAITS.walk;
  const moving = smoothstep(0, 0.3, bear.speed) * (1 - reared) * (1 - down);
  const bob = gait.bob * moving * Math.sin(bear.gait * Math.PI * 4);
  // Leaning in and out against the trunk as it shoves.
  const lean =
    (bear.doing === "shoving" || bear.showing === "shove") && reared > 0.9
      ? 0.08 * Math.sin((Math.PI * bear.shove) / (HUNT.pushing * HUNT.shove))
      : 0;
  const hipX = bear.x + f * lean;
  const ground = groundAt(hipX);
  const pitch = lerp(lerp(0.06, 1.3, reared), -0.04, down);
  const hipHeight =
    lerp(lerp(BODY.hip, BODY.rearedHip, reared), 0.34, down) + bob;
  const hip = { x: hipX, y: ground + hipHeight };
  const shoulder = {
    x: hip.x + f * BODY.spine * Math.cos(pitch),
    y: hip.y + BODY.spine * Math.sin(pitch),
  };
  const roar = bear.doing === "angry" ? 0.5 : 0;
  // On all fours it carries its head low, below its hump; reared up, it holds it up.
  const headAngle = lerp(
    lerp(-0.18, 0.35 + roar, reared) - 0.85 * smoothstep(0, 1, bear.headDown),
    -0.15,
    down,
  );
  const head = {
    x: shoulder.x + f * BODY.neck * Math.cos(headAngle),
    y: shoulder.y + BODY.neck * Math.sin(headAngle),
  };

  // Where each foot goes in its step, ahead of or behind where it stands, and how high.
  const step = (offset: number): { ahead: number; lift: number } => {
    const phase = (bear.gait + offset) % 1;
    if (phase < gait.stance) {
      return { ahead: gait.stride * (0.5 - phase / gait.stance), lift: 0 };
    }
    const swing = (phase - gait.stance) / (1 - gait.stance);
    return {
      ahead: gait.stride * (swing - 0.5),
      lift: gait.lift * Math.sin(Math.PI * swing),
    };
  };
  const hindRoots = [
    { x: hip.x - f * 0.04, y: hip.y - 0.08 },
    { x: hip.x + f * 0.03, y: hip.y - 0.08 },
  ];
  const frontRoots = [
    { x: shoulder.x - f * 0.02, y: shoulder.y - 0.12 },
    { x: shoulder.x + f * 0.05, y: shoulder.y - 0.12 },
  ];
  const legs = [0, 1, 2, 3].map((i) => {
    const hind = i < 2;
    const root = hind ? at(hindRoots, i) : at(frontRoots, i - 2);
    const near = i % 2 === 0;
    const { ahead, lift } = step(at(gait.offsets, i));
    // Standing on all fours, stepping as it goes.
    const standX = root.x + f * (hind ? 0.06 : 0.04) + f * ahead * moving;
    let target: Point = {
      x: standX,
      y: groundAt(standX) + (hind ? 0.07 : 0.06) + lift * moving,
    };
    if (hind) {
      // Reared up, it stands on its hind feet under its hips.
      const planted = {
        x: hip.x + f * (near ? 0.08 : 0.02),
        y: groundAt(hip.x) + 0.07,
      };
      target = mix(target, planted, reared);
    } else {
      target = mix(target, forepaw(bear, shoulder, near), reared);
    }
    // Collapsed, its legs splay out along the ground.
    const splayed = {
      x: root.x + f * (hind ? -0.55 : 0.5) + (near ? 0 : f * 0.12),
      y: groundAt(root.x) + 0.08,
    };
    target = mix(target, splayed, down);
    const { knee, end } = hind
      ? bendLeg(root, target, BODY.thigh, BODY.shin, f > 0 ? 1 : -1)
      : bendLeg(root, target, BODY.arm, BODY.forearm, f > 0 ? -1 : 1);
    const footLength = hind ? BODY.foot : BODY.paw;
    // A hind foot lies flat along the ground; a forepaw points the way its forearm does once
    // reared up.
    const along = hind
      ? 0
      : reared * Math.atan2(end.y - knee.y, f * (end.x - knee.x));
    const toe = {
      x: end.x + f * footLength * Math.cos(along),
      y: end.y + footLength * Math.sin(along) - (hind ? 0.04 : 0.02),
    };
    return { root, knee, ankle: end, toe };
  });
  return {
    hip,
    shoulder,
    head,
    headAngle,
    legs: [at(legs, 0), at(legs, 1), at(legs, 2), at(legs, 3)],
  };
}

/** Where a forepaw of `bear`, reared up, reaches for: swiping, on the trunk, or held up. */
function forepaw(bear: Bear, shoulder: Point, near: boolean): Point {
  const f = bear.facing;
  const length = (BODY.arm + BODY.forearm) * 0.95;
  const shoving =
    bear.doing === "shoving" ||
    (bear.doing === "posing" && bear.showing === "shove");
  if (shoving) {
    return {
      x: shoulder.x + f * 0.55,
      y: shoulder.y - (near ? 0.05 : 0.2),
    };
  }
  const swiping =
    bear.doing === "reaching" ||
    (bear.doing === "posing" && bear.showing === "swipe");
  if (swiping && near) {
    const t = bear.swipe / HUNT.swipe;
    const angle =
      t < SWIPE.windUp
        ? lerp(SWIPE.rest, SWIPE.raised, smoothstep(0, SWIPE.windUp, t))
        : t < SWIPE.strike.to
          ? lerp(
              SWIPE.raised,
              SWIPE.low,
              smoothstep(SWIPE.strike.from, SWIPE.strike.to, t),
            )
          : lerp(SWIPE.low, SWIPE.rest, smoothstep(SWIPE.strike.to, 1, t));
    return {
      x: shoulder.x + f * length * Math.cos(angle),
      y: shoulder.y + length * Math.sin(angle),
    };
  }
  // Held up before it, the far paw a little lower.
  return {
    x: shoulder.x + f * (near ? 0.42 : 0.36),
    y: shoulder.y - (near ? 0.12 : 0.24),
  };
}

/**
 * Circles about `pose` that falling wood strikes the bear within: its body, its rump and its
 * head, in meters.
 */
function bodyOf(pose: Pose): { x: number; y: number; r: number }[] {
  return [
    {
      x: (pose.hip.x + pose.shoulder.x) / 2,
      y: (pose.hip.y + pose.shoulder.y) / 2,
      r: 0.42,
    },
    { x: pose.hip.x, y: pose.hip.y, r: 0.34 },
    { x: pose.shoulder.x, y: pose.shoulder.y, r: 0.34 },
    { x: pose.head.x, y: pose.head.y, r: 0.2 },
  ];
}

/**
 * A bear's body and head without its legs, standing on all fours facing right, in meters, its hip
 * joint at (0, 0.7) and its shoulder joint at (0.8, 0.75): around from its tail over its back, its
 * modest shoulder rise, its neck, a small ear, its brow and long muzzle, under its jaw and down its
 * chest, along its belly and back up under its rump. Each point follows the bones by its third
 * number: 0 the hips, 1 the shoulders, 2 the head, and between them as a blend of the two.
 */
const OUTLINE: readonly (readonly [number, number, number])[] = [
  [-0.37, 0.79, 0],
  [-0.34, 0.86, 0],
  [-0.25, 0.93, 0],
  [-0.1, 0.98, 0],
  [0.12, 1.0, 0.15],
  [0.38, 0.99, 0.5],
  [0.62, 1.02, 0.85],
  [0.8, 1.05, 1],
  [0.96, 1.01, 1.3],
  [1.07, 0.95, 1.8],
  [1.1, 0.98, 2],
  [1.12, 1.03, 2],
  [1.16, 1.05, 2],
  [1.2, 1.01, 2],
  [1.27, 0.94, 2],
  [1.35, 0.87, 2],
  [1.46, 0.81, 2],
  [1.54, 0.77, 2],
  [1.57, 0.735, 2],
  [1.545, 0.7, 2],
  [1.47, 0.675, 2],
  [1.37, 0.64, 2],
  [1.25, 0.6, 1.8],
  [1.1, 0.575, 1.4],
  [0.96, 0.54, 1],
  [0.86, 0.45, 1],
  [0.7, 0.41, 0.85],
  [0.45, 0.39, 0.55],
  [0.2, 0.42, 0.25],
  [0.05, 0.49, 0.05],
  [-0.12, 0.49, 0],
  [-0.28, 0.57, 0],
  [-0.36, 0.69, 0],
];

/** Where the bones the outline follows lie in it: the hips, the shoulders, and the head on its neck. */
const REST = {
  hip: { x: 0, y: 0.7 },
  shoulder: { x: 0.8, y: 0.75 },
  /** The body's slope from hips to shoulders, and the neck's, in radians from level. */
  pitch: 0.06,
  head: -0.18,
} as const;

/**
 * Widths of a bear's legs, in meters: the hind leg at the hip, knee and heel, and its foot's height;
 * the front leg at the shoulder, elbow and wrist, and its paw's.
 */
const LEGS = {
  hind: { hip: 0.32, knee: 0.19, heel: 0.13, foot: 0.11 },
  front: { shoulder: 0.28, elbow: 0.18, wrist: 0.145, paw: 0.13 },
} as const;

/**
 * The silhouette of a bear in `pose`, facing `facing`, in meters: its body and head from a drawn
 * outline bent with its bones, and its four legs, the far ones behind the near.
 */
function bearShape(pose: Pose, facing: 1 | -1): Path2D {
  const path = new Path2D();
  const f = facing;
  addPolygon(path, smooth(skin(pose, f)));
  for (const [i, leg] of pose.legs.entries()) {
    if (i < 2) {
      const { hip, knee, heel, foot } = LEGS.hind;
      addCapsule(path, leg.root, leg.knee, hip / 2, knee / 2);
      addCapsule(path, leg.knee, leg.ankle, knee / 2, heel / 2);
      // Flat along the ground from its heel to its toes.
      addCapsule(
        path,
        { x: leg.ankle.x - f * 0.02, y: leg.toe.y + foot / 2 - 0.005 },
        { x: leg.toe.x, y: leg.toe.y + foot * 0.4 },
        foot / 2,
        foot * 0.4,
      );
    } else {
      const { shoulder, elbow, wrist, paw } = LEGS.front;
      addCapsule(path, leg.root, leg.knee, shoulder / 2, elbow / 2);
      addCapsule(path, leg.knee, leg.ankle, elbow / 2, wrist / 2);
      addCapsule(path, leg.ankle, leg.toe, paw / 2, paw * 0.42);
    }
  }
  return path;
}

/**
 * The outline of `pose`'s body and head, each point carried by the bones it follows from where it
 * lies at rest to where those bones are now.
 */
function skin(pose: Pose, f: 1 | -1): Point[] {
  const pitch = Math.atan2(
    pose.shoulder.y - pose.hip.y,
    f * (pose.shoulder.x - pose.hip.x),
  );
  const bones: { rest: Bone; now: Bone }[] = [
    {
      rest: { ...REST.hip, angle: REST.pitch },
      now: { ...pose.hip, angle: pitch },
    },
    {
      rest: { ...REST.shoulder, angle: REST.pitch },
      now: { ...pose.shoulder, angle: pitch },
    },
    {
      rest: { ...REST.shoulder, angle: REST.head },
      now: { ...pose.shoulder, angle: pose.headAngle },
    },
  ];
  return OUTLINE.map(([x, y, follows]) => {
    const i = Math.min(1, Math.floor(follows));
    const blend = follows - i;
    return mix(
      carry(at(bones, i), { x, y }, f),
      carry(at(bones, i + 1), { x, y }, f),
      blend,
    );
  });
}

/** A bone: where it starts, and its angle from level toward the way the bear faces. */
interface Bone {
  x: number;
  y: number;
  angle: number;
}

/** Carries `p`, given at rest, along with `bone` from where it lies at rest to where it is now. */
function carry(bone: { rest: Bone; now: Bone }, p: Point, f: 1 | -1): Point {
  const dx = p.x - bone.rest.x;
  const dy = p.y - bone.rest.y;
  const back = -bone.rest.angle;
  const lx = dx * Math.cos(back) - dy * Math.sin(back);
  const ly = dx * Math.sin(back) + dy * Math.cos(back);
  const turn = bone.now.angle;
  return {
    x: bone.now.x + f * (lx * Math.cos(turn) - ly * Math.sin(turn)),
    y: bone.now.y + lx * Math.sin(turn) + ly * Math.cos(turn),
  };
}

/** Points along a smooth closed curve through `points`, four to each span between them. */
function smooth(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const p0 = at(points, (i - 1 + n) % n);
    const p1 = at(points, i);
    const p2 = at(points, (i + 1) % n);
    const p3 = at(points, (i + 2) % n);
    for (let k = 0; k < 4; k += 1) {
      const t = k / 4;
      const t2 = t * t;
      const t3 = t2 * t;
      // A Catmull-Rom curve, which passes through every point.
      out.push({
        x:
          0.5 *
          (2 * p1.x +
            (p2.x - p0.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (3 * p1.x - p0.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          (2 * p1.y +
            (p2.y - p0.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (3 * p1.y - p0.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
}

function mix(a: Point, b: Point, t: number): Point {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}
