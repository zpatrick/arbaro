import type { Camera } from "./camera";
import type { Debris } from "./debris";
import { type Level, slopeAt } from "./level";
import { along, type HiveTarget, type HiveView, type Threat } from "./hives";
import type { Limb } from "./limb";
import { FAILURE, type Push } from "./physics";
import { addPolygon, type Point } from "./silhouette";
import type { Tree } from "./tree";
import { approach, at, clamp, invariant, lerp, Rng, smoothstep } from "./util";

/** The bears, as the debug panel sets them. */
export interface BearSettings {
  /** Whether a hive draws a bear on its own. */
  comes: boolean;
}

/** Animations a bear can be shown playing in place, from the debug panel. */
export const BEAR_POSES = [
  "walk",
  "run",
  "rear",
  "paw",
  "swipe",
  "shove",
  "eat",
  "roar",
  "die",
] as const;
export type BearPose = (typeof BEAR_POSES)[number];

/** What the debug panel calls each animation. */
export const BEAR_POSE_NAMES: Readonly<Record<BearPose, string>> = {
  walk: "Walk",
  run: "Run",
  rear: "Rear up",
  paw: "Swipe on all fours",
  swipe: "Swipe reared up",
  shove: "Shove the trunk",
  eat: "Eat",
  roar: "Roar",
  die: "Die",
};

/** A bear's body, in meters: a black bear's. */
const BODY = {
  /** From the hip joint to the shoulder joint. */
  spine: 0.8,
  /** Height of the hip joint standing on all fours, and reared up. */
  hip: 0.7,
  rearedHip: 0.8,
  /** The bones of the hind leg, hip to knee and knee to ankle. */
  thigh: 0.38,
  shin: 0.34,
  /** The bones of the front leg, shoulder to elbow and elbow to wrist. */
  arm: 0.33,
  forearm: 0.3,
  /** From the shoulders to the middle of the head. */
  neck: 0.4,
} as const;

/**
 * A foot or forepaw: its sole's length from heel to toe; how high its ankle or wrist sits above the
 * sole, and how far forward of the heel; and how thick it is at the heel and at the toes.
 */
interface FootShape {
  length: number;
  height: number;
  forward: number;
  heel: number;
  toes: number;
}

/**
 * How wide a leg is, in meters: where it leaves the body, through the middle of its upper bone, at
 * the knee or elbow, through the middle of its lower bone, and at the ankle or wrist; how far the
 * middle of each bone swells out, front then back, as a share of its width; and its foot.
 */
interface LegShape {
  root: number;
  upper: number;
  joint: number;
  lower: number;
  ankle: number;
  swell: {
    upper: readonly [number, number];
    lower: readonly [number, number];
  };
  foot: FootShape;
}

/** A bear's legs: heavy hams and calves over long flat hind feet, and thick forearms. */
const LEGS: { hind: LegShape; front: LegShape } = {
  hind: {
    root: 0.32,
    upper: 0.29,
    joint: 0.18,
    lower: 0.15,
    ankle: 0.105,
    swell: { upper: [0.95, 1.12], lower: [0.85, 1.12] },
    foot: {
      length: 0.2,
      height: 0.075,
      forward: 0.05,
      heel: 0.085,
      toes: 0.058,
    },
  },
  front: {
    root: 0.27,
    upper: 0.235,
    joint: 0.165,
    lower: 0.155,
    ankle: 0.12,
    swell: { upper: [1, 1.06], lower: [1.1, 0.95] },
    foot: {
      length: 0.13,
      height: 0.058,
      forward: 0.035,
      heel: 0.072,
      toes: 0.058,
    },
  },
};

/**
 * A forepaw's claws: how far they reach past its toes, and how thick they are where they start;
 * and how large a hind foot's are beside them.
 */
const CLAWS = { length: 0.045, base: 0.018, hind: 0.7 } as const;

/**
 * Highest a bear reaches with its claws, comfortably, in meters: on all fours, lifting one
 * forepaw, and reared up on its hind legs. Anything higher it shakes down by shoving the trunk.
 */
const REACH = { fours: 1.35, reared: 2.15 } as const;

/**
 * How a bear walks and runs: how far each foot travels in a step, the share of each step it
 * spends on the ground, how high it lifts, how far each hind foot and forepaw tips toes-down as it
 * pushes off and swings through, when in the step each foot goes (near hind, far hind, near front,
 * far front), and how much the body rises and falls.
 */
const GAITS = {
  walk: {
    stride: 0.72,
    stance: 0.65,
    lift: 0.1,
    roll: { hind: 0.5, front: 1.1 },
    offsets: [0, 0.5, 0.25, 0.75],
    bob: 0.02,
  },
  run: {
    stride: 1.1,
    stance: 0.38,
    lift: 0.22,
    roll: { hind: 0.75, front: 1.4 },
    offsets: [0, 0.08, 0.5, 0.58],
    bob: 0.06,
  },
} as const;

/** Speeds a bear goes at, in meters per second. */
const SPEED = { walk: 1.4, run: 6 } as const;

/** How a bear goes after a hive, and gives up. */
const HUNT = {
  /** Seconds a bear takes to rear up or drop back down, and to lift its chest to swipe. */
  rear: 0.7,
  lift: 0.35,
  /** Seconds a swipe takes, and rests between swipes. */
  swipe: 0.85,
  swipeRest: 0.55,
  /** Mass a swipe strikes with, in kilograms: the forearm and paw, and the bear's weight behind them. */
  pawMass: 14,
  /** A swipe lands on what its claws pass this close to, in meters. */
  clawReach: 0.04,
  /**
   * Seconds each shove takes, not counting how long it waits cocked for the trunk to swing back,
   * and the force of its push at its strongest, in newtons. On a slight trunk it pushes no harder
   * than `rootShare` of what the roots hold, so a bear rocks a sapling rather than uproots it.
   */
  shove: 1.6,
  shoveForce: 2500,
  rootShare: 0.3,
  /** Each time a bear is angered, it shoves this much harder. */
  angerForce: 0.4,
  /**
   * Seconds a bear keeps at a hive, all told, before it gives up and walks off; each time it is
   * angered it keeps at it `angerPatience` longer, up to `mostPatience`.
   */
  patience: 18,
  angerPatience: 4,
  mostPatience: 30,
  /** Stings that drive a bear off at a run. */
  stung: 30,
  /** Seconds a bear eats a hive it brought down. */
  eating: 8,
  /** Seconds an angered bear rears and roars before it goes back at the hive. */
  angry: 1.4,
  /** Seconds a flinch from a sting takes to pass. */
  flinch: 0.35,
} as const;

/**
 * The swipe of a forepaw, as shares of a swipe: wound up by `windUp`, struck through by `strike`,
 * then drawn back. It winds up above the line to what it swipes at, `raise` radians reared up and
 * `raiseFours` on all fours, where the paw cocks before its face rather than behind its head;
 * draws the paw in toward its chest by `tuck` of its reach midway; and follows through `follow`
 * radians below.
 */
const SWIPE = {
  windUp: 0.38,
  strike: 0.54,
  raise: 1.25,
  raiseFours: 0.75,
  follow: 0.95,
  tuck: 0.35,
} as const;

/**
 * The shove. A bear stands reared `stand` meters from the bark, hips to bark, its hind feet planted,
 * its forepaws flat on the trunk `height` up. Each shove, until `load`, it pivots back at the hips
 * and draws its paws back off the bark to its chest; until `drive` it pivots forward into the
 * trunk, its paws striking the bark `strike` of the way into the drive and pushing until it ends;
 * then it eases back to ready. Leaning back it sinks its hips; driving it rises onto them and
 * thrusts them in toward the trunk.
 */
const SHOVE = {
  stand: 0.8,
  height: 1.35,
  load: 0.42,
  drive: 0.64,
  strike: 0.3,
  /** Its body's slope ready, leaned back and thrust in, in radians from level. */
  pitch: { ready: 1.3, back: 1.45, in: 1.16 },
  /** How far its hips sink leaning back and rise driving, and thrust in, in meters. */
  sink: 0.035,
  rise: 0.02,
  thrust: 0.05,
  /**
   * Cocked, it waits for the trunk to swing back to it and turn away again before it drives, so each
   * shove adds to the sway; it waits no longer than `wait` seconds. It watches the trunk this share
   * of the way up it.
   */
  wait: 0.6,
  watch: 0.6,
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

/** A hive a bear goes after: the limb it hangs from, and how far along. */
interface HiveAt {
  limb: Limb;
  s: number;
}

/**
 * What a bear means to do at the tree, where it stands to do it, and which way it faces: swipe a
 * hive down on all fours or reared up, or shove the trunk to shake one down.
 */
type Plan =
  | { kind: "paw" | "swipe"; standAt: number; facing: 1 | -1; hive: HiveAt }
  | { kind: "shove"; standAt: number; facing: 1 | -1 };

interface Leg {
  root: Point;
  knee: Point;
  ankle: Point;
  /** The back and front of its sole. */
  heel: Point;
  toe: Point;
}

/** Where every part of a bear is, in meters. */
interface Pose {
  hip: Point;
  shoulder: Point;
  head: Point;
  /** The way the head faces, in radians from level, toward the way the bear faces. */
  headAngle: number;
  /** How far its jaw hangs open, from 0 shut to 1 wide. */
  jaw: number;
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
  /**
   * How far it has reared up, lifted its chest to swipe on all fours, lowered its head, and
   * collapsed, each from 0 to 1.
   */
  rear: number;
  lift: number;
  headDown: number;
  collapse: number;
  /** How far its jaw hangs open, from 0 to 1, and how sharply it flinches from its last sting. */
  jaw: number;
  flinch: number;
  /** Seconds into its current swipe, and shove. */
  swipe: number;
  shove: number;
  /**
   * While it holds a shove cocked: how long it has waited, and how fast the trunk was last moving
   * away from it, toward it if negative.
   */
  cocked: { waited: number; away: number } | undefined;
  /** What its swipes aim at, where its claws were at the last step, and whether this swipe landed. */
  aim: Point | undefined;
  claws: Point | undefined;
  landed: boolean;
  /** Where its hind feet stand while it shoves, and the bark its forepaws push on. */
  feet: [number, number] | undefined;
  bark: Bark | undefined;
  /** Seconds it keeps at the hive before it gives up, and how many times it has been angered. */
  patience: number;
  anger: number;
  /** Times bees have stung it. */
  stings: number;
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
  /** Where it walks, whose ground it stands on. */
  level: Level;
}

/** What the bears live among. */
export interface BearWorld {
  level: Level;
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

  /** Sends a bear in from the edge of the view, from a side `level` lets bears come from. */
  spawn(camera: Camera, level: Level): void {
    const view = viewOf(camera);
    const from = at(
      level.bearsFrom,
      Math.floor(this.rng.next() * level.bearsFrom.length),
    );
    this.bears.push(
      makeBear(
        from < 0 ? view.left - 2 : view.right + 2,
        from < 0 ? 1 : -1,
        "arriving",
        level,
      ),
    );
  }

  /**
   * Shows a bear playing `showing` in place, a little to one side of the middle of the view, or
   * at the trunk to shove it. It replaces any other bear shown so.
   */
  show(
    showing: BearPose,
    camera: Camera,
    level: Level,
    tree: Tree | undefined,
  ): void {
    this.bears = this.bears.filter((bear) => bear.doing !== "posing");
    const view = viewOf(camera);
    const x =
      showing === "shove" && tree !== undefined
        ? shoveFrom(tree, level, 1)
        : lerp(view.left, view.right, 0.3);
    const bear = makeBear(x, 1, "posing", level);
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
      bear.flinch = Math.max(0, bear.flinch - dt / HUNT.flinch);
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

  /** The bears as bees see them: where on each they sting it. A bear shown posing is left be. */
  threats(): Threat[] {
    return this.bears
      .filter((bear) => bear.doing !== "dead" && bear.doing !== "posing")
      .map((bear) => {
        const pose = poseOf(bear);
        return {
          points: [pose.head, pose.shoulder, mix(pose.hip, pose.shoulder, 0.4)],
          sting: () => {
            bear.stings += 1;
            bear.flinch = 1;
          },
        };
      });
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
      this.spawn(world.camera, world.level);
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
          bear.patience = Math.min(
            HUNT.mostPatience,
            bear.patience + HUNT.angerPatience,
          );
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
    const atTheTree =
      bear.doing === "arriving" ||
      bear.doing === "reaching" ||
      bear.doing === "shoving" ||
      bear.doing === "angry";
    // Stung enough, it gives up and runs.
    if (atTheTree && bear.stings >= HUNT.stung) {
      this.flee(bear, world);
    }
    if (bear.doing !== "posing") {
      if (bear.doing !== "reaching") {
        bear.lift = Math.max(0, bear.lift - dt / HUNT.lift);
      }
      if (bear.doing !== "shoving") {
        bear.feet = undefined;
        bear.bark = undefined;
      }
      bear.jaw = approach(
        bear.jaw,
        bear.doing === "angry"
          ? 1
          : bear.doing === "eating"
            ? chewing(bear)
            : 0,
        0.08,
        dt,
      );
    }
    switch (bear.doing) {
      case "arriving": {
        bear.plan ??= planFor(bear, world);
        if (bear.plan === undefined) {
          this.leave(bear, world);
          break;
        }
        if (this.walkTo(dt, bear, bear.plan.standAt, SPEED.walk)) {
          bear.facing = bear.plan.facing;
          bear.doing = bear.plan.kind === "shove" ? "shoving" : "reaching";
          bear.swipe = 0;
          bear.shove = 0;
          bear.cocked = { waited: 0, away: 0 };
          bear.claws = undefined;
          bear.landed = false;
        }
        break;
      }
      case "reaching":
        this.reach(dt, bear, world);
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
        // It comes at the hive from the side it is on, to stand with its head over it.
        const side = bear.x >= meal.center.x ? 1 : -1;
        const over = meal.center.x + side * EAT_REACH;
        if (this.walkTo(dt, bear, over, SPEED.walk) && meal.resting) {
          bear.facing = side > 0 ? -1 : 1;
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
        const speed = bear.doing === "fleeing" ? SPEED.run : SPEED.walk;
        bear.speed = approach(bear.speed, speed, 0.4, dt);
        this.stride(dt, bear, bear.doing === "fleeing" ? "run" : "walk");
        bear.x += bear.facing * bear.speed * dt;
        break;
      }
      case "angry": {
        bear.patience -= dt;
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
   * Under the hive, `bear` swipes at it, on all fours with one forepaw if it can reach it so, else
   * reared up on its hind legs, until it brings the hive down or loses patience. Each swipe rouses
   * the hive's bees.
   */
  private reach(dt: number, bear: Bear, world: BearWorld): void {
    const plan = bear.plan;
    invariant(
      plan !== undefined && plan.kind !== "shove",
      "A bear is reaching with nothing to reach for.",
    );
    if (this.mealDown(bear, world)) {
      return;
    }
    const hive = world.hives.find(
      (h) => h.limb === plan.hive.limb && h.s === plan.hive.s,
    );
    if (hive === undefined || bear.patience <= 0) {
      this.leave(bear, world);
      return;
    }
    bear.patience -= dt;
    bear.speed = approach(bear.speed, 0, 0.2, dt);
    bear.headDown = Math.max(0, bear.headDown - dt / 0.4);
    const reared = plan.kind === "swipe";
    if (reared) {
      bear.rear = Math.min(1, bear.rear + dt / HUNT.rear);
    } else {
      bear.rear = Math.max(0, bear.rear - dt / HUNT.rear);
      bear.lift = Math.min(1, bear.lift + dt / HUNT.lift);
    }
    bear.aim = aimAt(hive.view);
    if ((reared ? bear.rear : bear.lift) < 1) {
      return;
    }
    hive.provoke();
    this.swing(dt, bear, (from, to, velocity) => {
      for (let k = 1; k <= CLAW_SAMPLES; k += 1) {
        if (hive.contains(mix(from, to, k / CLAW_SAMPLES), HUNT.clawReach)) {
          hive.strike(velocity, HUNT.pawMass);
          return true;
        }
      }
      return false;
    });
  }

  /**
   * Moves `bear`'s swipe on by `dt` seconds. While its claws strike through, `hits` tells whether
   * they landed on what it swipes at, passing from `from` to `to` at `velocity`; a swipe lands once.
   */
  private swing(
    dt: number,
    bear: Bear,
    hits: (from: Point, to: Point, velocity: Point) => boolean,
  ): void {
    bear.swipe += dt;
    if (bear.swipe >= HUNT.swipe + HUNT.swipeRest) {
      bear.swipe = 0;
      bear.landed = false;
    }
    const before = bear.claws;
    const now = clawsOf(poseOf(bear), bear.facing);
    bear.claws = now;
    const t = bear.swipe / HUNT.swipe;
    if (
      before === undefined ||
      bear.landed ||
      t < SWIPE.windUp ||
      t > SWIPE.strike
    ) {
      return;
    }
    bear.landed = hits(before, now, {
      x: (now.x - before.x) / dt,
      y: (now.y - before.y) / dt,
    });
  }

  /**
   * Reared up with its forepaws on the bark and its hind feet planted, `bear` shoves the trunk over
   * and over, harder the angrier it is, to shake the hive down, until it does or loses patience.
   * Shoving rouses the bees of every hive on the tree.
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
    const tree = world.tree;
    if (tree === undefined || bear.patience <= 0) {
      this.leave(bear, world);
      return;
    }
    bear.patience -= dt;
    bear.speed = approach(bear.speed, 0, 0.2, dt);
    bear.headDown = Math.max(0, bear.headDown - dt / 0.4);
    bear.rear = Math.min(1, bear.rear + dt / HUNT.rear);
    bear.feet ??= plantedFeet(bear);
    bear.bark = barkOf(tree, world.level, bear.x, bear.facing);
    if (bear.rear < 1) {
      return;
    }
    for (const hive of world.hives) {
      hive.provoke();
    }
    this.push(dt, bear, tree, pushes);
  }

  /**
   * Moves `bear`'s shove on, and shoves `tree`'s trunk where its forepaws are on it, from when they
   * strike the bark until it has driven all the way forward. Cocked, it holds until the trunk swings
   * back to it and turns away again, so it rocks the tree like a swing pushed in time.
   */
  private push(dt: number, bear: Bear, tree: Tree, pushes: Push[]): void {
    const trunk = tree.root;
    if (bear.shove / HUNT.shove >= SHOVE.load && bear.cocked !== undefined) {
      const watched = trunk.pointAt(trunk.length * SHOVE.watch);
      const away =
        bear.facing *
        tree.physics.velocityAt(
          trunk,
          trunk.length * SHOVE.watch,
          watched.x,
          watched.y,
        ).x;
      // A tree at rest it shoves at once.
      const turned =
        (bear.cocked.away < 0 && away >= 0) ||
        (bear.cocked.away === 0 && away === 0);
      bear.cocked.waited += dt;
      if (!turned && bear.cocked.waited < SHOVE.wait) {
        bear.cocked.away = away;
        return;
      }
      bear.cocked = undefined;
    }
    bear.shove += dt;
    if (bear.shove >= HUNT.shove) {
      bear.shove -= HUNT.shove;
      bear.cocked = { waited: 0, away: 0 };
    }
    const into =
      (bear.shove / HUNT.shove - SHOVE.load) / (SHOVE.drive - SHOVE.load);
    const drive = (into - SHOVE.strike) / (1 - SHOVE.strike);
    if (drive <= 0 || drive >= 1) {
      return;
    }
    invariant(
      bear.bark !== undefined,
      "A bear shoves with its paws on no bark.",
    );
    const s = bear.bark.s;
    const at = trunk.pointAt(s);
    const strongest = Math.min(
      HUNT.shoveForce * (1 + HUNT.angerForce * bear.anger),
      (HUNT.rootShare * FAILURE.rootHold * trunk.radiusAt(0) ** 3) /
        Math.max(s, 0.1),
    );
    pushes.push({
      limb: trunk,
      s,
      x: at.x,
      y: at.y,
      force: { x: bear.facing * strongest * Math.sin(Math.PI * drive), y: 0 },
    });
  }

  /** Plays the animation `bear` shows, in place. */
  private pose(dt: number, bear: Bear, world: BearWorld, pushes: Push[]): void {
    const showing = bear.showing;
    invariant(showing !== undefined, "A bear is posing with nothing to show.");
    switch (showing) {
      case "walk":
      case "run": {
        bear.speed = approach(bear.speed, SPEED[showing], 0.3, dt);
        this.stride(dt, bear, showing);
        break;
      }
      case "rear":
        bear.rear = 0.5 - 0.5 * Math.cos((bear.timer * Math.PI) / 2);
        break;
      case "paw":
      case "swipe": {
        const reared = showing === "swipe";
        if (reared) {
          bear.rear = Math.min(1, bear.rear + dt / HUNT.rear);
        } else {
          bear.lift = Math.min(1, bear.lift + dt / HUNT.lift);
        }
        // At a point in the air where a hive would hang.
        const pose = poseOf(bear);
        bear.aim = {
          x: pose.shoulder.x + bear.facing * (reared ? 0.45 : 0.55),
          y:
            bear.level.groundAt(bear.x) +
            (reared ? REACH.reared - 0.15 : REACH.fours - 0.2),
        };
        if ((reared ? bear.rear : bear.lift) >= 1) {
          this.swing(dt, bear, () => false);
        }
        break;
      }
      case "shove": {
        bear.rear = Math.min(1, bear.rear + dt / HUNT.rear);
        bear.feet ??= plantedFeet(bear);
        if (world.tree !== undefined) {
          bear.bark = barkOf(world.tree, world.level, bear.x, bear.facing);
          if (bear.rear >= 1) {
            this.push(dt, bear, world.tree, pushes);
          }
        }
        break;
      }
      case "eat":
        bear.headDown = Math.min(1, bear.headDown + dt / 0.6);
        bear.jaw = chewing(bear);
        break;
      case "roar":
        bear.rear = Math.min(0.75, bear.rear + dt / HUNT.rear);
        bear.jaw = approach(bear.jaw, bear.timer % 3 < 1.8 ? 1 : 0, 0.1, dt);
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
    return true;
  }

  /** Sends `bear` off, away from the tree, at a walk. */
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

/** A bear eats a hive standing this far behind it, so its head is over it. */
const EAT_REACH = 0.95;
/** A bear has arrived where it was going once this close, in meters. */
const ARRIVED = 0.08;
/** Wood falling slower than this is resting on a bear, not striking it, in meters per second. */
const STRUCK_SPEED = 1;
/** Wood striking a bear glances off with this much of the speed it struck with. */
const GLANCE = 0.5;
/** Points along each step's sweep of a swipe's claws tested for landing on what it swipes at. */
const CLAW_SAMPLES = 4;
/** A bear swipes at a hive this far down from where it hangs, as a share of its height. */
const AIM_DOWN = 0.75;
/** A bear stands so what it swipes at is this share of its claws' reach from its shoulder. */
const COMFORT = 0.82;
/** A hive this close to the trunk, in meters, is swiped at from the side away from the trunk. */
const CROWDED = 2;
/**
 * Where a bear can stand: ground no steeper than `steepest`, as its rise over its run, and no
 * further than `drop` meters above or below the ground at the trunk.
 */
const STANDING = { steepest: 0.6, drop: 1.5 } as const;

function makeBear(x: number, facing: 1 | -1, doing: Doing, level: Level): Bear {
  return {
    x,
    facing,
    doing,
    speed: 0,
    gait: 0,
    rear: 0,
    lift: 0,
    headDown: 0,
    collapse: 0,
    jaw: 0,
    flinch: 0,
    swipe: 0,
    shove: 0,
    cocked: { waited: 0, away: 0 },
    aim: undefined,
    claws: undefined,
    landed: false,
    feet: undefined,
    bark: undefined,
    patience: HUNT.patience,
    anger: 0,
    stings: 0,
    timer: 0,
    plan: undefined,
    meal: undefined,
    alpha: 1,
    felt: new Set(),
    showing: undefined,
    level,
  };
}

/** How far `bear`'s jaw hangs open as it chews. */
function chewing(bear: Bear): number {
  return 0.3 * (0.5 + 0.5 * Math.sin(bear.timer * 7));
}

/** The part of the world in view, in meters. */
function viewOf(camera: Camera): { left: number; right: number } {
  return {
    left: camera.toWorld(0, 0).x,
    right: camera.toWorld(camera.width, 0).x,
  };
}

/**
 * The way away from the tree for `bear`, 1 right or -1 left: the side it is on, unless the land
 * ends that way, as it does past a cliff.
 */
function awayFrom(bear: Bear, world: BearWorld): 1 | -1 {
  const trunk = world.tree === undefined ? undefined : trunkAt(world.tree);
  const away = trunk === undefined ? bear.facing : bear.x >= trunk.x ? 1 : -1;
  return world.level.bearsFrom.includes(away) ? away : away > 0 ? -1 : 1;
}

/** Whether a bear can stand at `x` on `level`'s ground: not too steep, nor down off the land. */
function footing(level: Level, x: number, near: number): boolean {
  return (
    Math.abs(slopeAt(level, x)) <= STANDING.steepest &&
    Math.abs(level.groundAt(x) - level.groundAt(near)) <= STANDING.drop
  );
}

/** Where the trunk of `tree` stands at the height a bear shoves it, and how thick it is there. */
function trunkAt(tree: Tree): { x: number; radius: number } {
  const s = Math.min(tree.root.length, SHOVE.height);
  return { x: tree.root.pointAt(s).x, radius: tree.root.radiusAt(s) };
}

/**
 * Where a bear facing `f`, standing at `standX` on `level`, sets its forepaws on the bark of `tree`'s
 * trunk, near paw then far, and how far up the trunk the near paw is: where the trunk stands
 * `SHOVE.height` above the bear's own feet, or at its top if it is not that tall, on the side facing
 * the bear, measured across the trunk level with the paw, so a leaning trunk is met where it is.
 */
function barkOf(tree: Tree, level: Level, standX: number, f: 1 | -1): Bark {
  const trunk = tree.root;
  const feet = level.groundAt(standX);
  const along = (height: number): number => {
    const target = feet + height;
    if (trunk.pointAt(trunk.length).y <= target) {
      return trunk.length;
    }
    let low = 0;
    let high = trunk.length;
    for (let i = 0; i < 30; i += 1) {
      const middle = (low + high) / 2;
      if (trunk.pointAt(middle).y < target) {
        low = middle;
      } else {
        high = middle;
      }
    }
    return (low + high) / 2;
  };
  const bark = (s: number): Point => {
    const p = trunk.pointAt(s);
    const across =
      trunk.radiusAt(s) / Math.max(Math.abs(Math.sin(p.heading)), 0.4);
    return { x: p.x - f * across, y: p.y };
  };
  const s = along(SHOVE.height);
  return { near: bark(s), far: bark(along(SHOVE.height - 0.24)), s };
}

/**
 * Where a bear coming from side `side` of `tree` stands on `level` to shove it: `SHOVE.stand` back
 * from the bark its forepaws meet from there.
 */
function shoveFrom(tree: Tree, level: Level, side: 1 | -1): number {
  const trunk = trunkAt(tree);
  let standAt = trunk.x - side * (trunk.radius + SHOVE.stand);
  // Where it stands sets how high it meets the trunk, and so where the bark it meets is.
  for (let i = 0; i < 4; i += 1) {
    standAt = barkOf(tree, level, standAt, side).near.x - side * SHOVE.stand;
  }
  return standAt;
}

/**
 * The bark a shoving bear's forepaws push on, near paw then far, and how far up the trunk the near
 * paw is.
 */
interface Bark {
  near: Point;
  far: Point;
  s: number;
}

/** Where `bear` plants its hind feet to shove from, near then far. */
function plantedFeet(bear: Bear): [number, number] {
  return [bear.x + bear.facing * 0.1, bear.x + bear.facing * 0.03];
}

/** The point on the hive in `view` a bear swipes at: low on its body, where it is widest. */
function aimAt(view: HiveView): Point {
  return along(view, AIM_DOWN);
}

/**
 * What `bear` means to do at the tree, going after the nearest hive: swipe it down on all fours
 * if it hangs low enough, else reared up if it can reach it so, else shove the trunk to shake it
 * down. It stands so the hive is in comfortable reach of its shoulder, on the side away from the
 * trunk if the hive hangs close to it. With no hive it shoves the trunk all the same. Undefined with
 * no tree.
 */
function planFor(bear: Bear, world: BearWorld): Plan | undefined {
  const tree = world.tree;
  if (tree === undefined) {
    return undefined;
  }
  const trunk = trunkAt(tree);
  // Bears come at the tree from the side they arrive on.
  const side = bear.x <= trunk.x ? 1 : -1;
  const shove: Plan = {
    kind: "shove",
    standAt: shoveFrom(tree, world.level, side),
    facing: side,
  };
  const hive = [...world.hives].sort(
    (a, b) => Math.abs(a.view.x - bear.x) - Math.abs(b.view.x - bear.x),
  )[0];
  if (hive === undefined) {
    return shove;
  }
  const aim = aimAt(hive.view);
  const facings: (1 | -1)[] =
    Math.abs(aim.x - trunk.x) < CROWDED
      ? [aim.x <= trunk.x ? 1 : -1]
      : aim.x >= bear.x
        ? [1, -1]
        : [-1, 1];
  // It swipes on all fours if it can, else reared up, from whichever side it can stand on.
  for (const kind of ["paw", "swipe"] as const) {
    for (const facing of facings) {
      const standAt = standFor(kind, aim, facing, world.level);
      if (standAt !== undefined && footing(world.level, standAt, trunk.x)) {
        return { kind, standAt, facing, hive: { limb: hive.limb, s: hive.s } };
      }
    }
  }
  return shove;
}

/**
 * Where a bear facing `facing` stands, its hips over that spot, to swipe at `aim` in comfortable
 * reach of its shoulder, on all fours or reared up, on `level`'s ground; undefined if it hangs
 * too high to reach so from there.
 */
function standFor(
  kind: "paw" | "swipe",
  aim: Point,
  facing: 1 | -1,
  level: Level,
): number | undefined {
  // Its shoulder, standing as it swipes, ahead of and above its hips.
  const pitch = kind === "paw" ? PAWING.pitch : 1.3;
  const hip = kind === "paw" ? BODY.hip : BODY.rearedHip;
  const shoulder = {
    ahead: BODY.spine * Math.cos(pitch),
    up: hip + BODY.spine * Math.sin(pitch) - ARM_DROP,
  };
  const reach = COMFORT * (BODY.arm + BODY.forearm + LEGS.front.foot.length);
  const most = kind === "paw" ? REACH.fours : REACH.reared;
  // Where it stands depends on how high it reaches, which depends on the ground where it stands.
  let standAt = aim.x - facing * shoulder.ahead;
  for (let i = 0; i < 3; i += 1) {
    const height = aim.y - level.groundAt(standAt);
    if (height > most) {
      return undefined;
    }
    const rise = height - shoulder.up;
    const ahead = Math.sqrt(Math.max(0.01, reach * reach - rise * rise));
    standAt = aim.x - facing * (shoulder.ahead + ahead);
  }
  return aim.y - level.groundAt(standAt) <= most ? standAt : undefined;
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

/** Swiping on all fours, a bear lifts its chest to this slope, in radians from level. */
const PAWING = { pitch: 0.2, look: 0.45 } as const;
/** The front legs hang from this far below the shoulder joint. */
const ARM_DROP = 0.12;

/** Whether `bear` is shoving the trunk, or shown doing so. */
function shoving(bear: Bear): boolean {
  return (
    bear.doing === "shoving" ||
    (bear.doing === "posing" && bear.showing === "shove")
  );
}

/** Whether `bear` is swiping, on all fours or reared up, or shown doing so. */
function swiping(bear: Bear): boolean {
  return (
    bear.doing === "reaching" ||
    (bear.doing === "posing" &&
      (bear.showing === "swipe" || bear.showing === "paw"))
  );
}

/**
 * How a bear shoving is bent `k` of the way through a shove: the slope of its body, how far its
 * hips sink, how far they thrust in toward the trunk, and how far its paws are drawn back off the
 * bark, from 0 on it to 1 at its chest.
 */
function shoveAt(k: number): {
  pitch: number;
  sink: number;
  thrust: number;
  cocked: number;
} {
  const { pitch } = SHOVE;
  if (k < SHOVE.load) {
    const e = smoothstep(0, SHOVE.load, k);
    return {
      pitch: lerp(pitch.ready, pitch.back, e),
      sink: SHOVE.sink * e,
      thrust: -0.4 * SHOVE.thrust * e,
      cocked: e,
    };
  }
  if (k < SHOVE.drive) {
    const into = (k - SHOVE.load) / (SHOVE.drive - SHOVE.load);
    const e = smoothstep(0, 1, into);
    return {
      pitch: lerp(pitch.back, pitch.in, e),
      sink: lerp(SHOVE.sink, -SHOVE.rise, e),
      thrust: lerp(-0.4 * SHOVE.thrust, SHOVE.thrust, e),
      cocked: 1 - smoothstep(0, SHOVE.strike, into),
    };
  }
  const e = smoothstep(SHOVE.drive, 1, k);
  return {
    pitch: lerp(pitch.in, pitch.ready, e),
    sink: lerp(-SHOVE.rise, 0, e),
    thrust: lerp(SHOVE.thrust, 0, e),
    cocked: 0,
  };
}

/** Where a foot is placed: its ankle or wrist, and how far its sole tips toes-down, in radians. */
interface Placing {
  ankle: Point;
  angle: number;
}

function mixPlacing(a: Placing, b: Placing, t: number): Placing {
  return { ankle: mix(a.ankle, b.ankle, t), angle: lerp(a.angle, b.angle, t) };
}

/** The way a sole runs from heel to toe, tipped `angle` toes-down, for a bear facing `f`. */
function soleWay(angle: number, f: 1 | -1): Point {
  return { x: f * Math.cos(angle), y: -Math.sin(angle) };
}

/** The side of a bone running `way` that faces the way the bear faces: forward on a leg, up on a sole. */
function frontOf(way: Point, f: 1 | -1): Point {
  return { x: -f * way.y, y: f * way.x };
}

/** Where the ankle of `foot` is with its toes resting at `toe` and its sole tipped `angle`. */
function ankleOver(
  toe: Point,
  angle: number,
  foot: FootShape,
  f: 1 | -1,
): Point {
  const way = soleWay(angle, f);
  const up = frontOf(way, f);
  return {
    x: toe.x + way.x * (foot.forward - foot.length) + up.x * foot.height,
    y: toe.y + way.y * (foot.forward - foot.length) + up.y * foot.height,
  };
}

/** Where the heel and toe of `foot` are, from its ankle and its sole tipped `angle`. */
function soleUnder(
  ankle: Point,
  angle: number,
  foot: FootShape,
  f: 1 | -1,
): { heel: Point; toe: Point } {
  const way = soleWay(angle, f);
  const up = frontOf(way, f);
  const heel = {
    x: ankle.x - way.x * foot.forward - up.x * foot.height,
    y: ankle.y - way.y * foot.forward - up.y * foot.height,
  };
  return {
    heel,
    toe: { x: heel.x + way.x * foot.length, y: heel.y + way.y * foot.length },
  };
}

/**
 * Where the wrist of a forepaw swiping from `root` at `aim` is, `t` of the way through its swipe,
 * setting out from and coming back to `rest`, and how far into the swipe it is, from 0 at rest to
 * 1 in full swing.
 */
function swipePath(
  t: number,
  root: Point,
  rest: Point,
  aim: Point,
  f: 1 | -1,
  reared: boolean,
  ground: number,
): { wrist: Point; swinging: number } {
  const angleOf = (p: Point): number =>
    Math.atan2(p.y - root.y, f * (p.x - root.x));
  const restAngle = angleOf(rest);
  const restReach = Math.hypot(rest.x - root.x, rest.y - root.y);
  const toward = angleOf(aim);
  // Its claws reach a paw's length past its wrist, along its forearm.
  const reach = clamp(
    Math.hypot(aim.x - root.x, aim.y - root.y) - LEGS.front.foot.length,
    0.3,
    BODY.arm + BODY.forearm - 0.02,
  );
  const raised = toward + (reared ? SWIPE.raise : SWIPE.raiseFours);
  const through = toward - SWIPE.follow;
  let angle: number;
  let r: number;
  if (t >= 1) {
    angle = restAngle;
    r = restReach;
  } else if (t < SWIPE.windUp) {
    const e = smoothstep(0, SWIPE.windUp, t);
    angle = lerp(restAngle, raised, e);
    r = lerp(restReach, reach, e) * (1 - SWIPE.tuck * Math.sin(Math.PI * e));
  } else if (t < SWIPE.strike) {
    angle = lerp(raised, through, smoothstep(SWIPE.windUp, SWIPE.strike, t));
    r = reach;
  } else {
    const e = smoothstep(SWIPE.strike, 1, t);
    angle = lerp(through, restAngle, e);
    r = lerp(reach, restReach, e);
  }
  const wrist = {
    x: root.x + f * r * Math.cos(angle),
    y: Math.max(ground + LEGS.front.foot.length, root.y + r * Math.sin(angle)),
  };
  return {
    wrist,
    swinging:
      t >= 1 ? 0 : smoothstep(0, 0.12, t) * (1 - smoothstep(0.86, 1, t)),
  };
}

/**
 * Where a forepaw of `bear`, rooted at `root`, reaches when it is off the ground, given where it
 * would stand: on the bark while it shoves, swiping, raised as it roars, or held before its chest
 * reared up. Also how strongly that wins over standing, and how far the paw turns to point along
 * its forearm, claws first. Undefined while it stands on the paw.
 */
function forepaw(
  bear: Bear,
  root: Point,
  near: boolean,
  standing: Placing,
  reared: number,
  lift: number,
): { place: Placing; weight: number; along: number } | undefined {
  const f = bear.facing;
  if (shoving(bear) && bear.bark !== undefined) {
    const bark = near ? bear.bark.near : bear.bark.far;
    const onBark: Placing = {
      ankle: { x: bark.x - f * LEGS.front.foot.height, y: bark.y },
      angle: -Math.PI / 2 + 0.2,
    };
    const atChest: Placing = {
      ankle: {
        x: root.x + f * (near ? 0.24 : 0.2),
        y: root.y - (near ? 0.04 : 0.13),
      },
      angle: 0.7,
    };
    return {
      place: mixPlacing(
        onBark,
        atChest,
        shoveAt(bear.shove / HUNT.shove).cocked,
      ),
      weight: reared,
      along: 0,
    };
  }
  const held: Placing = {
    ankle: {
      x: root.x + f * (near ? 0.3 : 0.25),
      y: root.y - (near ? 0.08 : 0.18),
    },
    angle: 1.25,
  };
  if (swiping(bear) && near && bear.aim !== undefined) {
    const rest = reared > 0.5 ? held : standing;
    const swipe = swipePath(
      bear.swipe / HUNT.swipe,
      root,
      rest.ankle,
      bear.aim,
      f,
      reared > 0.5,
      bear.level.groundAt(root.x),
    );
    return {
      place: {
        ankle: mix(rest.ankle, swipe.wrist, swipe.swinging),
        angle: rest.angle,
      },
      weight: Math.max(reared, lift),
      along: swipe.swinging,
    };
  }
  if (reared <= 0) {
    return undefined;
  }
  const roaring =
    bear.doing === "angry" ||
    (bear.doing === "posing" && bear.showing === "roar");
  if (roaring) {
    return {
      place: {
        ankle: {
          x: root.x + f * (near ? 0.36 : 0.3),
          y: root.y + (near ? 0.1 : 0.02),
        },
        angle: 0.5,
      },
      weight: reared,
      along: 0,
    };
  }
  return { place: held, weight: reared, along: 0 };
}

/** Where every part of `bear` is, from what it is doing and how far into it. */
function poseOf(bear: Bear): Pose {
  const f = bear.facing;
  const reared = smoothstep(0, 1, bear.rear);
  const down = smoothstep(0, 1, bear.collapse);
  const lift = smoothstep(0, 1, bear.lift) * (1 - reared);
  const running = smoothstep(SPEED.walk, SPEED.run, bear.speed);
  const gait = running > 0.5 ? GAITS.run : GAITS.walk;
  const moving = smoothstep(0, 0.3, bear.speed) * (1 - reared) * (1 - down);
  const bob = gait.bob * moving * Math.sin(bear.gait * Math.PI * 4);
  // Shoving, it pivots at the hips over its planted feet.
  const shove = shoving(bear)
    ? shoveAt(bear.shove / HUNT.shove)
    : { pitch: 1.3, sink: 0, thrust: 0, cocked: 0 };
  const hipX = bear.x + f * shove.thrust * reared;
  const ground = bear.level.groundAt(hipX);
  // On all fours or lying down, its body follows the slope of the ground under it.
  const slope = Math.atan2(
    bear.level.groundAt(hipX + f * BODY.spine) - ground,
    BODY.spine,
  );
  const pitch = lerp(
    lerp(
      REST.pitch + (PAWING.pitch - REST.pitch) * lift + slope,
      shove.pitch,
      reared,
    ),
    -0.04 + slope,
    down,
  );
  const hipHeight =
    lerp(lerp(BODY.hip, BODY.rearedHip - shove.sink, reared), 0.34, down) + bob;
  const hip = { x: hipX, y: ground + hipHeight };
  const shoulder = {
    x: hip.x + f * BODY.spine * Math.cos(pitch),
    y: hip.y + BODY.spine * Math.sin(pitch),
  };
  const roar =
    bear.doing === "angry" ||
    (bear.doing === "posing" && bear.showing === "roar")
      ? 0.45
      : 0;
  // Driving a shove home, it tucks its head down between its shoulders.
  const tuck = shoving(bear)
    ? (-0.35 * Math.max(0, shove.thrust)) / SHOVE.thrust
    : 0;
  // On all fours it carries its head low, below its hump, lifting it to look up at what it swipes
  // at; reared up, it holds it up. A sting jerks it up and back.
  const headAngle = lerp(
    lerp(REST.head + PAWING.look * lift, 0.35 + roar + tuck, reared) -
      0.85 * smoothstep(0, 1, bear.headDown) +
      0.3 * bear.flinch,
    -0.15,
    down,
  );
  const head = {
    x: shoulder.x + f * BODY.neck * Math.cos(headAngle),
    y: shoulder.y + BODY.neck * Math.sin(headAngle),
  };

  // Where each foot goes in its step, ahead of or behind where it stands, how high, and how far it
  // tips toes-down: late in its stance the heel lifts as it rolls over its toes, and through its
  // swing the toes hang until it reaches for the ground again.
  const step = (
    offset: number,
    hind: boolean,
  ): { ahead: number; lift: number; roll: number; planted: boolean } => {
    const phase = (bear.gait + offset) % 1;
    const roll = hind ? gait.roll.hind : gait.roll.front;
    if (phase < gait.stance) {
      const p = phase / gait.stance;
      return {
        ahead: gait.stride * (0.5 - p),
        lift: 0,
        roll: roll * smoothstep(0.6, 1, p) * (hind ? 1 : 0.5),
        planted: true,
      };
    }
    const swing = (phase - gait.stance) / (1 - gait.stance);
    return {
      ahead: gait.stride * (swing - 0.5),
      lift: gait.lift * Math.sin(Math.PI * swing),
      roll: roll * (1 - smoothstep(0.35, 0.9, swing)),
      planted: false,
    };
  };
  const hindRoots = [
    { x: hip.x - f * 0.04, y: hip.y - 0.08 },
    { x: hip.x + f * 0.03, y: hip.y - 0.08 },
  ];
  const frontRoots = [
    { x: shoulder.x - f * 0.02, y: shoulder.y - ARM_DROP },
    { x: shoulder.x + f * 0.05, y: shoulder.y - ARM_DROP },
  ];
  const legs = [0, 1, 2, 3].map((i): Leg => {
    const hind = i < 2;
    const near = i % 2 === 0;
    const shape = hind ? LEGS.hind : LEGS.front;
    const root = hind ? at(hindRoots, i) : at(frontRoots, i - 2);
    const stepping = step(at(gait.offsets, i), hind);
    // On all fours, stepping as it goes.
    const standX =
      root.x + f * (hind ? 0.06 : 0.04) + f * stepping.ahead * moving;
    const roll = stepping.roll * moving;
    const standing: Placing = stepping.planted
      ? {
          ankle: ankleOver(
            {
              x: standX + f * (shape.foot.length - shape.foot.forward),
              y: bear.level.groundAt(standX),
            },
            roll,
            shape.foot,
            f,
          ),
          angle: roll,
        }
      : {
          ankle: {
            x: standX,
            y:
              bear.level.groundAt(standX) +
              shape.foot.height +
              stepping.lift * moving,
          },
          angle: roll,
        };
    let place = standing;
    let along = 0;
    if (hind) {
      // Reared up, it stands flat on its hind feet under its hips.
      const plantedX =
        bear.feet === undefined
          ? hip.x + f * (near ? 0.1 : 0.03)
          : at(bear.feet, near ? 0 : 1);
      place = mixPlacing(
        place,
        {
          ankle: {
            x: plantedX,
            y: bear.level.groundAt(plantedX) + shape.foot.height,
          },
          angle: 0,
        },
        reared,
      );
    } else {
      const raised = forepaw(bear, root, near, standing, reared, lift);
      if (raised !== undefined) {
        place = mixPlacing(place, raised.place, raised.weight);
        along = raised.along;
      }
    }
    // Collapsed, its legs splay out along the ground.
    place = mixPlacing(
      place,
      {
        ankle: {
          x: root.x + f * (hind ? -0.55 : 0.5) + (near ? 0 : f * 0.12),
          y: bear.level.groundAt(root.x) + 0.09,
        },
        angle: hind ? -0.25 : 0.15,
      },
      down,
    );
    const { knee, end } = hind
      ? bendLeg(root, place.ankle, BODY.thigh, BODY.shin, f > 0 ? 1 : -1)
      : bendLeg(root, place.ankle, BODY.arm, BODY.forearm, f > 0 ? -1 : 1);
    // A swiping paw points along its forearm, claws first.
    const forearm = Math.atan2(-(end.y - knee.y), f * (end.x - knee.x));
    const angle = lerp(place.angle, forearm, along);
    const { heel, toe } = soleUnder(end, angle, shape.foot, f);
    return { root, knee, ankle: end, heel, toe };
  });
  return {
    hip,
    shoulder,
    head,
    headAngle,
    jaw: clamp(bear.jaw + 0.5 * bear.flinch, 0, 1),
    legs: [at(legs, 0), at(legs, 1), at(legs, 2), at(legs, 3)],
  };
}

/** The tip of the claws of the near forepaw in `pose`, for a bear facing `f`. */
function clawsOf(pose: Pose, f: 1 | -1): Point {
  const paw = pose.legs[2];
  const way = unit(paw.heel, paw.toe);
  const up = frontOf(way, f);
  return {
    x: paw.toe.x + way.x * CLAWS.length + up.x * 0.01,
    y: paw.toe.y + way.y * CLAWS.length + up.y * 0.01,
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
 * A point of the drawn outline of a bear standing on all fours facing right, in meters, its hip
 * joint at (0, 0.7) and its shoulder joint at (0.8, 0.75). The third number says which bones it
 * follows: 0 the hips, 1 the shoulders, 2 the head, and between them a blend of the two; or
 * `JAW_BONE`, the lower jaw.
 */
type Spec = readonly [number, number, number];

/** Points of the outline that follow the lower jaw. */
const JAW_BONE = 3;

/**
 * The outline from under the rump, over the back and the modest rise at the shoulders, to the nape
 * of the neck.
 */
const BACK: readonly Spec[] = [
  [-0.37, 0.79, 0],
  [-0.34, 0.86, 0],
  [-0.25, 0.93, 0],
  [-0.1, 0.98, 0],
  [0.12, 1.0, 0.15],
  [0.38, 0.99, 0.5],
  [0.62, 1.02, 0.85],
  [0.8, 1.05, 1],
  [0.96, 1.01, 1.3],
  [1.05, 0.975, 1.75],
];

/**
 * The head, from the nape over a small rounded ear, along the nearly level crown and brow and the
 * long straight bridge of the muzzle to a soft nose pad standing a little proud at its end, and
 * back under it along the upper lip.
 */
const HEAD: readonly Spec[] = [
  [1.085, 0.99, 2],
  [1.1, 1.03, 2],
  [1.118, 1.059, 2],
  [1.145, 1.071, 2],
  [1.171, 1.06, 2],
  [1.186, 1.032, 2],
  [1.198, 1.006, 2],
  [1.232, 0.997, 2],
  [1.28, 0.982, 2],
  [1.335, 0.955, 2],
  [1.395, 0.922, 2],
  [1.448, 0.894, 2],
  [1.478, 0.881, 2],
  [1.498, 0.872, 2],
  [1.508, 0.857, 2],
  [1.509, 0.84, 2],
  [1.498, 0.825, 2],
  [1.475, 0.816, 2],
  [1.45, 0.808, 2],
];

/**
 * The corner of the mouth: where the lips meet when the jaw is shut, just behind the nose, and how
 * far back the mouth opens when it hangs wide.
 */
const MOUTH = { shut: { x: 1.432, y: 0.801 }, wide: { x: 1.34, y: 0.818 } };

/** The lower jaw, from the lower lip around the chin and back under the jaw. */
const JAW: readonly Spec[] = [
  [1.44, 0.79, JAW_BONE],
  [1.436, 0.773, JAW_BONE],
  [1.408, 0.757, JAW_BONE],
  [1.352, 0.742, JAW_BONE],
];

/** The jowl and throat, down the neck and chest, along the belly and back up under the rump. */
const BELLY: readonly Spec[] = [
  [1.28, 0.722, 2],
  [1.19, 0.672, 1.8],
  [1.08, 0.6, 1.4],
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

/**
 * The lower jaw's hinge, behind the corner of the mouth, and how far it swings open at its widest,
 * in radians.
 */
const HINGE = { x: 1.3, y: 0.795, open: 0.42 } as const;

/** Where the bones the outline follows lie in it: the hips, the shoulders, and the head on its neck. */
const REST = {
  hip: { x: 0, y: 0.7 },
  shoulder: { x: 0.8, y: 0.75 },
  /** The body's slope from hips to shoulders, and the neck's, in radians from level. */
  pitch: 0.06,
  head: -0.18,
} as const;

/**
 * The silhouette of a bear in `pose`, facing `facing`, in meters: its body and head from a drawn
 * outline bent with its bones, and its four legs, each one smooth outline down to its foot, with
 * claws on every foot, shorter on the hind feet.
 */
function bearShape(pose: Pose, facing: 1 | -1): Path2D {
  const path = new Path2D();
  const f = facing;
  addPolygon(path, smooth(skin(pose, f)));
  for (const [i, leg] of pose.legs.entries()) {
    const hind = i < 2;
    addPolygon(path, smooth(legOutline(leg, hind ? LEGS.hind : LEGS.front, f)));
    addClaws(path, leg, f, hind ? CLAWS.hind : 1);
  }
  return path;
}

/**
 * The outline of `pose`'s body and head, each point carried by the bones it follows from where it
 * lies at rest to where those bones are now, the lower jaw swung open as far as the pose has it.
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
  const head = at(bones, 2);
  const jaw = {
    rest: { x: HINGE.x, y: HINGE.y, angle: REST.head },
    now: {
      ...carry(head, HINGE, f),
      angle: pose.headAngle - HINGE.open * pose.jaw,
    },
  };
  const place = ([x, y, follows]: Spec): Point => {
    if (follows === JAW_BONE) {
      return carry(jaw, { x, y }, f);
    }
    const i = Math.min(1, Math.floor(follows));
    return mix(
      carry(at(bones, i), { x, y }, f),
      carry(at(bones, i + 1), { x, y }, f),
      follows - i,
    );
  };
  return [
    ...BACK.map(place),
    ...HEAD.map(place),
    carry(head, mix(MOUTH.shut, MOUTH.wide, pose.jaw), f),
    ...JAW.map(place),
    ...BELLY.map(place),
  ];
}

/**
 * The outline of `leg`, shaped by `shape`, for a bear facing `f`: down the front of its upper bone,
 * around the front of its knee or elbow, down the front of its lower bone, over its foot to its
 * toes, back along its sole and around its heel, and up the back of the leg, each part as wide as
 * `shape` says, the knee or elbow fuller on the side it bends out to.
 */
function legOutline(leg: Leg, shape: LegShape, f: 1 | -1): Point[] {
  const { root, knee, ankle, heel, toe } = leg;
  const upper = unit(root, knee);
  const lower = unit(knee, ankle);
  const frontUpper = frontOf(upper, f);
  const frontLower = frontOf(lower, f);
  const bisector = unit(
    { x: 0, y: 0 },
    {
      x: frontUpper.x + frontLower.x,
      y: frontUpper.y + frontLower.y,
    },
  );
  // Which side the joint bends out to: its front for a knee, its back for an elbow.
  const outFront = f * (upper.x * lower.y - upper.y * lower.x) < 0 ? 1 : -1;
  const jointFront = shape.joint / 2 / (outFront > 0 ? 0.85 : 1.1);
  const jointBack = shape.joint / 2 / (outFront > 0 ? 1.1 : 0.85);
  const way = unit(heel, toe);
  const up = frontOf(way, f);
  const { foot } = shape;
  const midUpper = mix(root, knee, 0.5);
  const midLower = mix(knee, ankle, 0.5);
  const offset = (p: Point, side: Point, by: number): Point => ({
    x: p.x + side.x * by,
    y: p.y + side.y * by,
  });
  const into = (p: Point, by: number): Point => offset(p, upper, -by);
  return [
    into(offset(root, frontUpper, shape.root / 2), 0.06),
    offset(midUpper, frontUpper, (shape.upper / 2) * shape.swell.upper[0]),
    offset(knee, bisector, jointFront),
    offset(midLower, frontLower, (shape.lower / 2) * shape.swell.lower[0]),
    offset(ankle, frontLower, shape.ankle / 2),
    offset(offset(toe, way, -0.04), up, foot.toes),
    offset(offset(toe, way, 0.006), up, foot.toes * 0.45),
    offset(toe, way, -0.012),
    offset(heel, way, 0.04),
    offset(offset(heel, way, -0.014), up, foot.heel * 0.5),
    offset(ankle, frontLower, -shape.ankle / 2),
    offset(midLower, frontLower, -(shape.lower / 2) * shape.swell.lower[1]),
    offset(knee, bisector, -jointBack),
    offset(midUpper, frontUpper, -(shape.upper / 2) * shape.swell.upper[1]),
    into(offset(root, frontUpper, -shape.root / 2), 0.06),
  ];
}

/**
 * Adds the claws of the foot on `leg` to `path`, `scale` the size of a forepaw's: two hooked points
 * past its toes.
 */
function addClaws(path: Path2D, leg: Leg, f: 1 | -1, scale: number): void {
  const way = unit(leg.heel, leg.toe);
  const up = frontOf(way, f);
  const point = (along: number, rise: number): Point => ({
    x: leg.toe.x + way.x * along + up.x * rise,
    y: leg.toe.y + way.y * along + up.y * rise,
  });
  const length = CLAWS.length * scale;
  const base = CLAWS.base * scale;
  for (const rise of [0.012, 0.03]) {
    addPolygon(path, [
      point(-0.01, rise * scale + base / 2),
      point(length * 0.55, rise * scale + base * 0.2),
      point(length, rise * scale - base * 0.5),
      point(length * 0.5, rise * scale - base * 0.35),
      point(-0.01, rise * scale - base / 2),
    ]);
  }
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

/** The unit vector from `a` toward `b`. */
function unit(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

function mix(a: Point, b: Point, t: number): Point {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}
