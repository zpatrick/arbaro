import { barnTopAt } from "./barn";
import { type Contact, Debris, type Piece } from "./debris";
import type { Limb } from "./limb";
import type { Load } from "./physics";
import type { Tree } from "./tree";
import { approach, at, clamp, lerp, Rng, smoothstep } from "./util";
import type { Catcher } from "./weather";
import type { Wind } from "./wind";

/** The hives, as the debug panel sets them. */
export interface HiveSettings {
  /** Size of every hive, from 1 as it is first built to 4 fully grown. */
  size: number;
  /** Whether bees come to a tree in flower on their own. */
  swarms: boolean;
}

/**
 * Hives the bees build, hanging under a limb like a bell. All sizes are in meters and kilograms, at
 * a hive size of one.
 */
export const HIVE = {
  /** Height and widest width of a hive. */
  height: 0.42,
  width: 0.32,
  /** Mass of a hive, comb and honey and bees, which grows with the cube of its size. */
  mass: 2.5,
  /** Seconds the bees take to build a hive: half a day. */
  build: 90,
  /** A tree draws a swarm for every this many open flowers it carries. */
  flowersPerHive: 40,
  /** Seconds on average before a swarm comes to a tree that can draw one. */
  arrival: 30,
  /** No hive is built within this many meters of another. */
  spacing: 8,
  /** Thinnest wood bees hang a hive from, as a radius. */
  minRadius: 0.03,
  /** Steepest wood bees hang a hive from, in radians from level. */
  steepest: 0.9,
  /** A hive grown to full size still hangs this far clear of the ground. */
  clearance: 0.5,
  /** Bees build no nearer than this to where a limb starts or to its tip, in meters. */
  clearOfEnds: 0.6,
  /** A hive grown to full size hangs at least this far clear of any other wood. */
  clearOfWood: 0.12,
  /** Bees settle where at least this many flowers grow within `forage` meters. */
  nearFlowers: 6,
  forage: 4,
  /**
   * Pull the comb holds against where it hangs from the wood, in newtons, and the power of the
   * hive's size it grows with: slower than its weight, which grows with the cube, so a hive as
   * first built holds three times its weight and gives way only in a hurricane, and one grown to
   * full size holds barely half again its weight and comes down when the wood is shaken hard.
   */
  hold: 70,
  holdGrowth: 2.55,
  /** Damage per second while the comb is pulled at its limit, and more for each multiple over it. */
  damageAtLimit: 0.6,
  damagePerOverload: 3,
  /** Damage healed per second while it is pulled under its limit. It tears loose at 1. */
  healing: 0.2,
  /** Drag coefficient, and the area it shows the wind as a fraction of its height times width. */
  drag: 1.1,
  area: 0.75,
  /** How quickly its swing dies away, per second. */
  damping: 1.2,
  /** Most snow its shoulders hold, in kilograms per square meter of its width squared. */
  snowHold: 8,
  /** Bees flying about a finished hive, and about one being built. */
  bees: 8,
  builders: 5,
} as const;

/** Where bees settle are tried along each limb this far apart, in meters. */
const SITE_STEP = 0.2;
/** Density of air, in kilograms per cubic meter. */
const AIR_DENSITY = 1.2;
const GRAVITY = 9.8;

/** How bees fly, in meters and seconds. */
const BEE = {
  /** Speed of a bee on its way somewhere, and of one dancing about a flower or the hive. */
  speed: 2.4,
  dance: 0.7,
  /** Seconds a bee takes to turn toward where it is going. */
  turn: 0.25,
  /** How far it wanders from its way, and how quickly, in meters per second and radians per second. */
  wobble: 1.6,
  wobbleRate: 9,
  /** Seconds a bee spends at a flower, and inside the hive between trips, from least to most. */
  visit: { from: 1, to: 3 },
  inside: { from: 2, to: 7 },
  /** A bee is there once it is this close. */
  arrive: 0.12,
  /** How far about the hive builders fly. */
  building: 0.45,
  /** Bees are out between dawn and dusk: while daylight is above this. */
  daylight: 0.3,
  /** Seconds bees scatter from a fallen hive before they are gone. */
  scatter: 6,
} as const;

type Doing = "inside" | "out" | "visiting" | "home" | "building";

interface Bee {
  x: number;
  y: number;
  vx: number;
  vy: number;
  doing: Doing;
  /** Where it is headed, in meters. */
  target: { x: number; y: number };
  /** Seconds left at what it is doing, while visiting, inside or scattering. */
  timer: number;
  /** Progress through its wobble, in radians. */
  phase: number;
}

interface Hive {
  limb: Limb;
  /** Distance along the limb it hangs from. */
  s: number;
  /** Where it hangs from, under the wood, as of the last step. */
  anchor: { x: number; y: number };
  /** How far it is built, from 0 just begun to 1 done. */
  built: number;
  /** Damage to where the comb holds the wood. It tears loose at 1. */
  damage: number;
  /** Snow lying on its shoulders, in kilograms. */
  snow: number;
  /** How far it swings from hanging straight down, counterclockwise, in radians, and how fast. */
  swing: number;
  swingRate: number;
  /** Velocity of the point it hangs from at the last step, to tell how hard the wood shakes it. */
  last: { x: number; y: number } | undefined;
  bees: Bee[];
}

/** A hive where it hangs, for drawing, in meters. */
export interface HiveView {
  /** Where it hangs from the wood. */
  x: number;
  y: number;
  /** How far it swings from hanging straight down, counterclockwise, in radians. */
  swing: number;
  /** Its height and widest width as built so far. */
  height: number;
  width: number;
  /** How much snow lies on it, from 0 to 1, the most it holds. */
  snow: number;
}

/** What the hives live through. */
export interface HiveConditions {
  wind: Wind;
  /** How much daylight there is, from 0 at night to 1 by day. */
  daylight: number;
  /** Where the open flowers on the tree are, which draw bees and which they fly out to. */
  blooms: readonly { x: number; y: number }[];
  /** Multiplier on how hard combs hold. */
  hold: number;
  /** Fraction of the snow lying on a hive that melts each second. */
  melt: number;
}

/** The hives hanging on the tree, and the bees flying about them. */
export class Hives {
  private hives: Hive[] = [];
  /** Bees scattering from hives that fell. */
  private strays: Bee[] = [];
  private readonly rng = new Rng(9091);
  /** Seconds until the next swarm comes, while the tree can draw one. */
  private swarmIn: number | undefined;

  /** Clears every hive and bee away, for a new tree. */
  clear(): void {
    this.hives = [];
    this.strays = [];
    this.swarmIn = undefined;
  }

  /** Starts a hive on `limb`, hanging from it `s` along. */
  place(limb: Limb, s: number): void {
    this.hives.push({
      limb,
      s,
      anchor: anchorOn(limb, s),
      built: 0,
      damage: 0,
      snow: 0,
      swing: 0,
      swingRate: 0,
      last: undefined,
      bees: [],
    });
  }

  /** Finishes building every hive at once. */
  finish(): void {
    for (const hive of this.hives) {
      hive.built = 1;
    }
  }

  get count(): number {
    return this.hives.length;
  }

  /** The weight of the hives still hanging on the tree, which their limbs carry. */
  loads(tree: Tree, settings: HiveSettings): Load[] {
    return this.hives
      .filter((hive) => attached(tree, hive))
      .map((hive) => ({
        limb: hive.limb,
        s: hive.s,
        mass: massOf(hive, settings.size),
      }));
  }

  /** The hives still hanging on the tree, as catchers of falling snow, on their shoulders. */
  catchers(tree: Tree, settings: HiveSettings): Catcher[] {
    return this.hives
      .filter((hive) => attached(tree, hive))
      .map((hive) => {
        const view = this.viewOf(hive, settings);
        const shoulders = along(view, 0.45);
        const width = view.width;
        return {
          key: hive,
          x: shoulders.x,
          y: shoulders.y,
          radius: width / 2,
          exposure: 1,
          area: width * width,
          take: (mass: number): number => {
            const taken = clamp(snowHeld(width) - hive.snow, 0, mass);
            hive.snow += taken;
            return taken;
          },
        };
      });
  }

  /**
   * Moves the hives and bees on by `dt` seconds: brings a swarm to a tree in flower, builds the
   * hives, swings them with the wood and the wind, and lets them tear loose. Returns the hives that
   * came off the tree, falling, with their limbs or on their own.
   */
  update(
    dt: number,
    tree: Tree | undefined,
    settings: HiveSettings,
    conditions: HiveConditions,
  ): Debris[] {
    const fallen: Debris[] = [];
    const kept: Hive[] = [];
    for (const hive of this.hives) {
      if (tree === undefined || !attached(tree, hive)) {
        fallen.push(this.fall(hive, settings));
        continue;
      }
      if (this.hang(dt, tree, hive, settings, conditions)) {
        fallen.push(this.fall(hive, settings));
        continue;
      }
      this.fly(dt, hive, settings, conditions);
      kept.push(hive);
    }
    this.hives = kept;
    for (const bee of this.strays) {
      bee.timer -= dt;
      bee.x += bee.vx * dt;
      bee.y += bee.vy * dt;
    }
    this.strays = this.strays.filter((bee) => bee.timer > 0);
    if (tree !== undefined && settings.swarms) {
      this.swarm(dt, tree, settings, conditions.blooms);
    } else {
      this.swarmIn = undefined;
    }
    return fallen;
  }

  /** The hives where they hang, for drawing. */
  views(settings: HiveSettings): HiveView[] {
    return this.hives.map((hive) => this.viewOf(hive, settings));
  }

  /** Where the bees out of their hives are, in meters, and how strongly each shows. */
  bees(): { x: number; y: number; alpha: number }[] {
    const out: { x: number; y: number; alpha: number }[] = [];
    for (const hive of this.hives) {
      for (const bee of hive.bees) {
        if (bee.doing !== "inside") {
          out.push({ x: bee.x, y: bee.y, alpha: 1 });
        }
      }
    }
    for (const bee of this.strays) {
      out.push({
        x: bee.x,
        y: bee.y,
        alpha: smoothstep(0, BEE.scatter / 3, bee.timer),
      });
    }
    return out;
  }

  /**
   * Brings a swarm to the tree once it carries enough open flowers for another hive, after a
   * while, to the best place to build: low on sturdy, level wood among the flowers, and far from
   * any other hive. A swarm that finds nowhere to build moves on, and another comes later.
   */
  private swarm(
    dt: number,
    tree: Tree,
    settings: HiveSettings,
    blooms: readonly { x: number; y: number }[],
  ): void {
    const drawn = Math.floor(blooms.length / HIVE.flowersPerHive);
    if (this.hives.length >= drawn) {
      this.swarmIn = undefined;
      return;
    }
    this.swarmIn ??= -HIVE.arrival * Math.log(1 - this.rng.next());
    this.swarmIn -= dt;
    if (this.swarmIn > 0) {
      return;
    }
    this.swarmIn = undefined;
    const site = this.site(tree, settings, blooms);
    if (site !== undefined) {
      this.place(site.limb, site.s);
    }
  }

  /** The best place on `tree` to build a hive, if there is one. */
  private site(
    tree: Tree,
    settings: HiveSettings,
    blooms: readonly { x: number; y: number }[],
  ): { limb: Limb; s: number } | undefined {
    const anchors = this.hives.map((hive) => hive.anchor);
    const tallest = HIVE.height * settings.size;
    let best: { limb: Limb; s: number; score: number } | undefined;
    for (const limb of tree.limbs) {
      for (
        let s = HIVE.clearOfEnds;
        s <= limb.length - HIVE.clearOfEnds;
        s += SITE_STEP
      ) {
        const p = limb.pointAt(s);
        const sturdy = limb.radiusAt(s) >= HIVE.minRadius;
        const level = Math.abs(Math.cos(p.heading)) >= Math.cos(HIVE.steepest);
        const clear = p.y - limb.radiusAt(s) - tallest >= HIVE.clearance;
        const apart = anchors.every(
          (a) => Math.hypot(a.x - p.x, a.y - p.y) >= HIVE.spacing,
        );
        const near = blooms.filter(
          (b) => Math.hypot(b.x - p.x, b.y - p.y) <= HIVE.forage,
        ).length;
        if (
          !sturdy ||
          !level ||
          !clear ||
          !apart ||
          near < HIVE.nearFlowers ||
          !this.open(tree, limb, s, settings)
        ) {
          continue;
        }
        // Bees take to low wood, so a bear can reach their hive.
        const score = -p.y + 0.3 * this.rng.next();
        if (best === undefined || score > best.score) {
          best = { limb, s, score };
        }
      }
    }
    return best;
  }

  /**
   * Whether a hive grown to full size, hanging `s` along `limb`, would hang in open air: clear of
   * any other wood and of the barn.
   */
  private open(
    tree: Tree,
    limb: Limb,
    s: number,
    settings: HiveSettings,
  ): boolean {
    const anchor = anchorOn(limb, s);
    const view: HiveView = {
      x: anchor.x,
      y: anchor.y,
      swing: 0,
      height: HIVE.height * settings.size,
      width: HIVE.width * settings.size,
      snow: 0,
    };
    for (const t of [0.25, 0.5, 0.75, 1]) {
      for (const side of [-1, 0, 1]) {
        const p = across(view, t, side * widthAt(t));
        const wood = tree.pick(p.x, p.y, HIVE.clearOfWood);
        if (wood !== undefined && (wood.limb !== limb || t > 0.25)) {
          return false;
        }
        if (p.y < barnTopAt(p.x)) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Builds `hive` on, and swings it from the wood like a pendulum, pushed by the wind and by the
   * wood shaking it. Returns whether it tore loose: its comb holds against the pull of its weight,
   * its snow, the wind and the shaking, up to a limit, and gives way if pulled past it too long.
   */
  private hang(
    dt: number,
    tree: Tree,
    hive: Hive,
    settings: HiveSettings,
    conditions: HiveConditions,
  ): boolean {
    hive.built = Math.min(1, hive.built + dt / HIVE.build);
    hive.anchor = anchorOn(hive.limb, hive.s);
    const melted = Math.min(
      snowHeld(this.viewOf(hive, settings).width),
      hive.snow * Math.exp(-conditions.melt * dt),
    );
    hive.snow = melted < hive.snow && melted < SNOW_TRACE ? 0 : melted;

    const view = this.viewOf(hive, settings);
    const { anchor } = hive;
    const moving = tree.physics.velocityAt(
      hive.limb,
      hive.s,
      anchor.x,
      anchor.y,
    );
    const shake =
      hive.last === undefined
        ? { x: 0, y: 0 }
        : {
            x: (moving.x - hive.last.x) / dt,
            y: (moving.y - hive.last.y) / dt,
          };
    hive.last = { x: moving.x, y: moving.y };

    const mass = massOf(hive, settings.size);
    const middle = along(view, 0.5);
    const air = conditions.wind.at(middle.x, middle.y, 0);
    const rx = air.x - moving.x;
    const ry = air.y - moving.y;
    const push =
      (0.5 *
        AIR_DENSITY *
        HIVE.drag *
        HIVE.area *
        view.height *
        view.width *
        Math.hypot(rx, ry)) /
      mass;
    // What pulls on it, per kilogram, in the frame of the shaking wood.
    const gx = -shake.x + push * rx;
    const gy = -GRAVITY - shake.y + push * ry;
    const reach = view.height / 2;
    const { swing } = hive;
    const spin =
      (gx * Math.cos(swing) + gy * Math.sin(swing)) / reach -
      HIVE.damping * hive.swingRate;
    hive.swingRate += spin * dt;
    hive.swing = clamp(hive.swing + hive.swingRate * dt, -1.4, 1.4);

    const pull =
      mass *
      Math.max(
        0,
        gx * Math.sin(swing) -
          gy * Math.cos(swing) +
          reach * hive.swingRate ** 2,
      );
    const hold = HIVE.hold * settings.size ** HIVE.holdGrowth * conditions.hold;
    if (pull > hold) {
      hive.damage +=
        dt * (HIVE.damageAtLimit + HIVE.damagePerOverload * (pull / hold - 1));
    } else {
      hive.damage = Math.max(0, hive.damage - dt * HIVE.healing);
    }
    return hive.damage >= 1;
  }

  /**
   * Flies the bees of `hive`: while it is built, they fly about it; once built, by day they fly out
   * to the flowers nearby, dance about them a while and come home, and by night they stay in.
   */
  private fly(
    dt: number,
    hive: Hive,
    settings: HiveSettings,
    conditions: HiveConditions,
  ): void {
    const view = this.viewOf(hive, settings);
    const door = along(view, 0.82);
    const finished = hive.built >= 1;
    const wanted = finished
      ? Math.round(HIVE.bees * settings.size)
      : Math.round(HIVE.builders * smoothstep(0, 0.1, hive.built));
    while (hive.bees.length < wanted) {
      hive.bees.push({
        x: door.x,
        y: door.y,
        vx: 0,
        vy: 0,
        doing: finished ? "inside" : "building",
        target: { x: door.x, y: door.y },
        timer: lerp(0, BEE.inside.to, this.rng.next()),
        phase: this.rng.next() * Math.PI * 2,
      });
    }
    hive.bees.length = wanted;
    const day = conditions.daylight > BEE.daylight;
    for (const bee of hive.bees) {
      if (finished && bee.doing === "building") {
        bee.doing = "home";
      }
      if (!day && (bee.doing === "out" || bee.doing === "visiting")) {
        bee.doing = "home";
      }
      switch (bee.doing) {
        case "inside":
          bee.x = door.x;
          bee.y = door.y;
          bee.timer -= dt;
          if (bee.timer <= 0 && day) {
            bee.doing = "out";
            bee.target = this.forage(door, conditions.blooms);
          }
          break;
        case "out":
          if (this.steer(dt, bee, BEE.speed)) {
            bee.doing = "visiting";
            bee.timer = lerp(BEE.visit.from, BEE.visit.to, this.rng.next());
          }
          break;
        case "visiting":
          this.dance(dt, bee, bee.target);
          bee.timer -= dt;
          if (bee.timer <= 0) {
            bee.doing = "home";
          }
          break;
        case "home":
          bee.target = door;
          if (this.steer(dt, bee, BEE.speed)) {
            bee.doing = "inside";
            bee.timer = lerp(BEE.inside.from, BEE.inside.to, this.rng.next());
          }
          break;
        case "building":
          this.dance(dt, bee, along(view, 0.5), BEE.building);
          break;
        default: {
          const unknown: never = bee.doing;
          throw new Error(`Unknown thing for a bee to do: ${String(unknown)}.`);
        }
      }
    }
  }

  /** A flower near `door` for a bee to fly out to, or somewhere near the hive if none is. */
  private forage(
    door: { x: number; y: number },
    blooms: readonly { x: number; y: number }[],
  ): { x: number; y: number } {
    const near = blooms.filter(
      (b) => Math.hypot(b.x - door.x, b.y - door.y) <= HIVE.forage * 2,
    );
    const pick = near[Math.floor(this.rng.next() * near.length)];
    if (pick !== undefined) {
      return { x: pick.x, y: pick.y };
    }
    const angle = this.rng.next() * Math.PI * 2;
    return {
      x: door.x + Math.cos(angle) * HIVE.forage,
      y: Math.max(0.3, door.y + Math.sin(angle) * HIVE.forage * 0.5),
    };
  }

  /**
   * Flies `bee` toward its target at `speed`, wobbling as it goes. Returns whether it has
   * arrived.
   */
  private steer(dt: number, bee: Bee, speed: number): boolean {
    const dx = bee.target.x - bee.x;
    const dy = bee.target.y - bee.y;
    const distance = Math.hypot(dx, dy);
    if (distance < BEE.arrive) {
      return true;
    }
    bee.phase += dt * BEE.wobbleRate;
    // It slows, and wobbles less, as it closes in.
    const slow = Math.min(1, distance / 0.6);
    const wobble = BEE.wobble * slow * Math.sin(bee.phase);
    const wantX = (dx / distance) * speed * slow - (dy / distance) * wobble;
    const wantY = (dy / distance) * speed * slow + (dx / distance) * wobble;
    bee.vx = approach(bee.vx, wantX, BEE.turn, dt);
    bee.vy = approach(bee.vy, wantY, BEE.turn, dt);
    bee.x += bee.vx * dt;
    bee.y += bee.vy * dt;
    return false;
  }

  /** Flies `bee` in quick loops about `around`, up to `reach` meters from it. */
  private dance(
    dt: number,
    bee: Bee,
    around: { x: number; y: number },
    reach = 0.2,
  ): void {
    bee.phase += dt * BEE.wobbleRate * 0.6;
    const wantX =
      (around.x + reach * Math.cos(bee.phase * 0.7) - bee.x) * 4 +
      BEE.dance * Math.cos(bee.phase * 1.9);
    const wantY =
      (around.y + reach * 0.6 * Math.sin(bee.phase) - bee.y) * 4 +
      BEE.dance * Math.sin(bee.phase * 2.3);
    bee.vx = approach(bee.vx, wantX, BEE.turn, dt);
    bee.vy = approach(bee.vy, wantY, BEE.turn, dt);
    bee.x += bee.vx * dt;
    bee.y += bee.vy * dt;
  }

  /** `hive` torn or cut loose, falling as a piece of its own, its bees scattering. */
  private fall(hive: Hive, settings: HiveSettings): Debris {
    const view = this.viewOf(hive, settings);
    for (const bee of hive.bees) {
      const angle = this.rng.next() * Math.PI * 2;
      this.strays.push({
        ...bee,
        x: bee.doing === "inside" ? along(view, 0.82).x : bee.x,
        y: bee.doing === "inside" ? along(view, 0.82).y : bee.y,
        vx: Math.cos(angle) * BEE.speed,
        vy: Math.abs(Math.sin(angle)) * BEE.speed,
        timer: BEE.scatter * (0.5 + 0.5 * this.rng.next()),
      });
    }
    const mass = massOf(hive, settings.size);
    const outline = hiveOutline(view);
    const points = outlinePoints(view);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const middle = along(view, 0.5);
    const contacts: Contact[] = [0, 0.3, 0.6, 1].flatMap((t) => {
      const p = along(view, t);
      return [
        { x: p.x, y: p.y, r: Math.max(0.02, (view.width / 2) * widthAt(t)) },
      ];
    });
    const piece: Piece = {
      mass,
      center: middle,
      inertia: (mass * (view.height ** 2 + view.width ** 2)) / 12,
      area: HIVE.area * view.height * view.width,
      contacts,
      bounds: {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
      },
      hinge: undefined,
    };
    const moving = hive.last ?? { x: 0, y: 0 };
    return new Debris([outline], piece, {
      x: moving.x,
      y: moving.y,
      spin: hive.swingRate,
    });
  }

  private viewOf(hive: Hive, settings: HiveSettings): HiveView {
    const { anchor } = hive;
    const grown = smoothstep(0, 1, hive.built);
    const width = HIVE.width * settings.size * lerp(0.25, 1, grown);
    return {
      x: anchor.x,
      y: anchor.y,
      swing: hive.swing,
      height: HIVE.height * settings.size * lerp(0.15, 1, grown),
      width,
      snow: hive.snow > 0 ? Math.min(1, hive.snow / snowHeld(width)) : 0,
    };
  }
}

/** Snow on a hive lighter than this, in kilograms, while it melts, has melted away. */
const SNOW_TRACE = 0.002;

/** Whether `hive` still hangs on `tree`: its limb is still there, and still reaches it. */
function attached(tree: Tree, hive: Hive): boolean {
  return tree.has(hive.limb) && hive.s <= hive.limb.length;
}

/**
 * Mass of `hive` at size `size`, as far as it is built, from the first comb at `begun` of its mass,
 * with the snow on it.
 */
function massOf(hive: Hive, size: number): number {
  return (
    HIVE.mass * size ** 3 * lerp(BEGUN, 1, smoothstep(0, 1, hive.built)) +
    hive.snow
  );
}

/** A hive just begun already weighs this fraction of what it will. */
const BEGUN = 0.05;

/** Most snow a hive `width` across holds on its shoulders, in kilograms. */
function snowHeld(width: number): number {
  return HIVE.snowHold * width * width;
}

/** Where a hive `s` along `limb` hangs from: the underside of the wood. */
function anchorOn(limb: Limb, s: number): { x: number; y: number } {
  const p = limb.pointAt(s);
  const radius = limb.radiusAt(s);
  // Of the two sides of the wood, the one facing down.
  const side = Math.cos(p.heading) >= 0 ? -1 : 1;
  return {
    x: p.x - side * Math.sin(p.heading) * 0.8 * radius,
    y: p.y + side * Math.cos(p.heading) * 0.8 * radius,
  };
}

/**
 * Width of a hive `t` of the way down from where it hangs to its bottom, as a fraction of its
 * widest: narrow at the neck, swelling to its widest below the middle, and rounding off at the
 * bottom.
 */
export function widthAt(t: number): number {
  const widest = 0.62;
  if (t <= widest) {
    return 0.34 + 0.66 * Math.sin((Math.PI / 2) * (t / widest));
  }
  const below = (t - widest) / (1 - widest);
  return Math.sqrt(Math.max(0, 1 - below * below));
}

/** The point on the axis of `view`, `t` of the way down from where it hangs to its bottom. */
export function along(view: HiveView, t: number): { x: number; y: number } {
  return {
    x: view.x + Math.sin(view.swing) * view.height * t,
    y: view.y - Math.cos(view.swing) * view.height * t,
  };
}

/** The point `t` of the way down `view`, `side` of its half-width across, left -1 to right 1. */
export function across(
  view: HiveView,
  t: number,
  side: number,
): { x: number; y: number } {
  const middle = along(view, t);
  const half = (view.width / 2) * side;
  return {
    x: middle.x + Math.cos(view.swing) * half,
    y: middle.y + Math.sin(view.swing) * half,
  };
}

/** Points around the outline of `view`, down its left side and up its right, in meters. */
function outlinePoints(view: HiveView): { x: number; y: number }[] {
  const steps = 20;
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const w = widthAt(t);
    left.push(across(view, t, -w));
    right.push(across(view, t, w));
  }
  return [...left, ...right.reverse()];
}

/** The outline of the hive in `view`, in meters. */
export function hiveOutline(view: HiveView): Path2D {
  const path = new Path2D();
  const points = outlinePoints(view);
  const first = at(points, 0);
  path.moveTo(first.x, first.y);
  for (const p of points.slice(1)) {
    path.lineTo(p.x, p.y);
  }
  path.closePath();
  return path;
}

/**
 * Lines carved across the hive in `view`, in meters: the bands of comb it is built in, each bowed
 * a little, and its door near the bottom.
 */
export function hiveCarving(view: HiveView): Path2D {
  const path = new Path2D();
  for (const t of [0.24, 0.41, 0.58, 0.74]) {
    const w = widthAt(t) * 0.92;
    const from = across(view, t, -w);
    const to = across(view, t, w);
    const sag = along(view, t + 0.05);
    // Bowed to pass through `sag` midway, a little lower than the middle of the band.
    path.moveTo(from.x, from.y);
    path.quadraticCurveTo(
      2 * sag.x - (from.x + to.x) / 2,
      2 * sag.y - (from.y + to.y) / 2,
      to.x,
      to.y,
    );
  }
  const door = along(view, 0.86);
  path.moveTo(door.x + view.width * 0.08, door.y);
  path.ellipse(
    door.x,
    door.y,
    view.width * 0.08,
    view.height * 0.025,
    -view.swing,
    0,
    Math.PI * 2,
  );
  return path;
}

/**
 * The snow lying on the shoulders of the hive in `view`, in meters: a crescent down each side from
 * its neck to its widest, as thick as there is snow on it, the wood above sheltering the rest.
 */
export function hiveSnow(view: HiveView): Path2D | undefined {
  if (view.snow <= 0) {
    return undefined;
  }
  const steps = 12;
  const path = new Path2D();
  for (const side of [-1, 1]) {
    const outer: { x: number; y: number }[] = [];
    const inner: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = lerp(SNOW_CAP.from, SNOW_CAP.to, i / steps);
      const w = widthAt(t);
      // Thickest on the shoulder, tapering to nothing at either end.
      const thick =
        SNOW_CAP.thickest * view.snow * Math.sin((Math.PI * i) / steps);
      outer.push(across(view, t, side * w * 1.02));
      inner.push(across(view, t, side * Math.max(0, w - thick)));
    }
    const first = at(outer, 0);
    path.moveTo(first.x, first.y);
    for (const p of [...outer.slice(1), ...inner.reverse()]) {
      path.lineTo(p.x, p.y);
    }
    path.closePath();
  }
  return path;
}

/**
 * Snow lies on a hive's shoulders from `from` to `to` of the way down it, at most `thickest` of
 * its half-width deep.
 */
const SNOW_CAP = { from: 0.06, to: 0.62, thickest: 0.35 } as const;
