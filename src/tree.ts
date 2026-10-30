import {
  SEG_LEN,
  type Flower,
  type FlowerShape,
  type Limb,
  type LimbKind,
  type Ribbon,
  type RibbonPoint,
  type Segment,
} from './treeTypes';
import { at, clamp, distPointSegment, invariant, lerp, Rng, smoothstep, wrapAngle } from './util';
import type { World } from './world';
import { segmentAnchor, stepPhysics, type PhysicsReport } from './treePhysics';

export const GROW_RATE = 4;
export const COSTS = {
  invest: 10,
  splitRoot: 14,
  splitBranch: 12,
  newBranch: 14,
};

const BASE_RADIUS: Record<LimbKind, number> = {
  trunk: 0.11,
  root: 0.11,
  branch: 0.1,
  twig: 0.1,
  tendril: 0.05,
};

export const MAX_GIRTH: Record<LimbKind, number> = {
  trunk: 1.55,
  root: 1.0,
  branch: 0.62,
  twig: 0,
  tendril: 0,
};

const MAX_TURN: Record<LimbKind, number> = {
  trunk: 0.09,
  root: 0.3,
  branch: 0.22,
  twig: 0.42,
  tendril: 0.5,
};

/** How much each kind of limb meanders from its steered heading, for a hand-drawn look. */
const WOBBLE: Record<LimbKind, { amplitude: number; frequency: number }> = {
  trunk: { amplitude: 0.075, frequency: 0.17 },
  root: { amplitude: 0.16, frequency: 0.3 },
  branch: { amplitude: 0.22, frequency: 0.35 },
  twig: { amplitude: 0.2, frequency: 0.72 },
  tendril: { amplitude: 0.26, frequency: 0.75 },
};

/** Twigs and root hairs curl into a spiral as they reach full length. */
const CURL: Record<LimbKind, number> = {
  trunk: 0,
  root: 0,
  branch: 0,
  twig: 0.22,
  tendril: 0.3,
};

/** Taper of thickness along a limb: [fraction of length that thins out, exponent]. */
const TAPER: Record<LimbKind, { span: number; power: number }> = {
  trunk: { span: 0.9, power: 1.5 },
  root: { span: 0.95, power: 1.9 },
  branch: { span: 0.9, power: 1.5 },
  twig: { span: 0.5, power: 1 },
  tendril: { span: 0.4, power: 1 },
};

const LOOKAHEAD = 3;
const GIRTH_COST = 5;
const MAX_TENDRILS = 160;
const MAX_TWIGS = 60;
/** Share of a pruned limb's build cost that comes back to the player. */
const PRUNE_REFUND = 0.4;
const FLOWER_MIN_SCALE = 0.16;

export interface DebrisSpec {
  ribbons: Ribbon[];
  flowers: FlowerShape[];
  pivotX: number;
  pivotY: number;
  /** Direction the debris tips toward: -1 for left, 1 for right. */
  direction: number;
}

export type TreeEvent =
  | { type: 'break'; debris: DebrisSpec }
  | { type: 'flower_fell'; debris: DebrisSpec }
  | { type: 'fell'; debris: DebrisSpec; reason: 'trunk' | 'roots' | 'none' };

export interface TreeUpdate {
  water: number;
  events: TreeEvent[];
}

export interface PickResult {
  segId: number;
  limbId: number;
  distance: number;
}

function isAboveGround(kind: LimbKind): boolean {
  return kind === 'trunk' || kind === 'branch' || kind === 'twig';
}

function segmentMaxLength(kind: LimbKind): number {
  switch (kind) {
    case 'tendril':
      return 0.45;
    case 'twig':
      return 0.5;
    case 'trunk':
    case 'root':
    case 'branch':
      return SEG_LEN;
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unhandled limb kind ${String(exhaustive)}`);
    }
  }
}

export class Tree {
  readonly world: World;
  readonly baseX: number;
  readonly baseY: number;
  readonly segments = new Map<number, Segment>();
  readonly limbs = new Map<number, Limb>();
  readonly flowers = new Map<number, Flower>();
  readonly rootLimbId: number;
  readonly trunkLimbId: number;
  /** Segments in creation order, so parents always come before children. */
  order: Segment[] = [];
  parentIndex: number[] = [];
  indexOf = new Map<number, number>();
  fallen = false;
  anchorRatio = 0;
  anchorDamage = 0;
  private orderDirty = true;
  private nextId = 1;
  private readonly rng: Rng;
  private tendrilCount = 0;
  private twigCount = 0;

  constructor(world: World, baseX: number, seed: number) {
    this.world = world;
    this.baseX = baseX;
    this.baseY = world.surfaceY(baseX);
    this.rng = new Rng(seed);

    const rootLimb = this.createLimb('root', -1, 0, -Math.PI / 2);
    const trunkLimb = this.createLimb('trunk', -1, 0, Math.PI / 2);
    this.rootLimbId = rootLimb.id;
    this.trunkLimbId = trunkLimb.id;
    rootLimb.energy = 12;
    trunkLimb.energy = 6;
    this.addSegment(rootLimb, -Math.PI / 2, 0.05);
    this.addSegment(trunkLimb, Math.PI / 2, 0.05);
    this.addFlower(trunkLimb, 'tip', FLOWER_MIN_SCALE, 0);
    this.rebuildOrder();
    this.layout();
  }

  seg(id: number): Segment {
    const found = this.segments.get(id);
    invariant(found !== undefined, `Segment ${id} does not exist.`);
    return found;
  }

  limb(id: number): Limb {
    const found = this.limbs.get(id);
    invariant(found !== undefined, `Limb ${id} does not exist.`);
    return found;
  }

  tipSegment(limb: Limb): Segment {
    return this.seg(at(limb.segIds, limb.segIds.length - 1));
  }

  limbLength(limb: Limb): number {
    let total = 0;
    for (const id of limb.segIds) {
      total += this.seg(id).length;
    }
    return total;
  }

  private rebuildOrder(): void {
    this.order = [...this.segments.values()];
    const indexOf = new Map<number, number>();
    this.order.forEach((seg, i) => indexOf.set(seg.id, i));
    this.indexOf = indexOf;
    this.parentIndex = this.order.map((seg) => {
      if (seg.parentId < 0) {
        return -1;
      }
      const idx = indexOf.get(seg.parentId);
      invariant(
        idx !== undefined && idx < (indexOf.get(seg.id) ?? -1),
        `Segment ${seg.id} has an out-of-order parent.`,
      );
      return idx;
    });
    this.orderDirty = false;
  }

  private createLimb(
    kind: LimbKind,
    parentSegId: number,
    order: number,
    steer: number,
  ): Limb {
    let maxLength = 0;
    if (kind === 'branch') {
      maxLength =
        this.rng.range(7.5, 10.5) *
        Math.pow(0.78, Math.max(0, order - 1));
    }
    const limb: Limb = {
      id: this.nextId,
      kind,
      parentSegId,
      order,
      segIds: [],
      girth: 0,
      energy: 0,
      invested: 0,
      steer,
      closed: false,
      blocked: false,
      maxLength,
      phase: this.rng.range(0, 100),
      side: this.rng.chance(0.5) ? 1 : -1,
      glow: 0,
      absorbing: 0,
    };
    this.nextId += 1;
    this.limbs.set(limb.id, limb);
    return limb;
  }

  private addSegment(limb: Limb, restAngle: number, length: number): Segment {
    const parentId =
      limb.segIds.length > 0
        ? at(limb.segIds, limb.segIds.length - 1)
        : limb.parentSegId;
    const parent = parentId >= 0 ? this.seg(parentId) : undefined;
    const x0 = parent ? parent.x1 : this.baseX;
    const y0 = parent
      ? parent.y1
      : limb.kind === 'root'
        ? this.baseY - 0.12
        : this.baseY;
    const seg: Segment = {
      id: this.nextId,
      limbId: limb.id,
      kind: limb.kind,
      index: limb.segIds.length,
      parentId,
      childIds: [],
      length,
      rel: parent ? restAngle - parent.restAngle : restAngle,
      restAngle,
      bend: 0,
      bendVel: 0,
      radius: BASE_RADIUS[limb.kind],
      age: 0,
      stress: 0,
      damage: 0,
      mass: 0,
      offshoots: 0,
      x0,
      y0,
      x1: x0 + Math.cos(restAngle) * length,
      y1: y0 + Math.sin(restAngle) * length,
      angle: restAngle,
      rx1: x0 + Math.cos(restAngle) * length,
      ry1: y0 + Math.sin(restAngle) * length,
    };
    this.nextId += 1;
    this.segments.set(seg.id, seg);
    limb.segIds.push(seg.id);
    if (parent) {
      parent.childIds.push(seg.id);
    }
    this.orderDirty = true;
    return seg;
  }

  private addFlower(
    limb: Limb,
    slot: 'tip' | 'mid',
    scale: number,
    bloomDelay: number,
    onSegId?: number,
  ): Flower {
    const segId = onSegId ?? at(limb.segIds, limb.segIds.length - 1);
    const flower: Flower = {
      id: this.nextId,
      limbId: limb.id,
      segId,
      slot,
      side: this.rng.chance(0.5) ? 1 : -1,
      scale: Math.max(scale, FLOWER_MIN_SCALE),
      maxScale: this.rng.range(0.9, 1.15),
      bloomDelay,
      lightReserve: 2,
      health: 1,
      glow: 0,
      x: 0,
      y: 0,
    };
    this.nextId += 1;
    this.flowers.set(flower.id, flower);
    return flower;
  }

  invest(limbId: number, amount: number): void {
    const limb = this.limb(limbId);
    if (!limb.closed) {
      limb.energy += amount;
      limb.invested += amount;
      return;
    }

    const descendants = [...this.limbs.values()].filter(
      (candidate) =>
        candidate.kind === limb.kind &&
        !candidate.closed &&
        this.limbDescendsFrom(candidate, limb),
    );
    if (descendants.length === 0) {
      limb.energy += amount;
      limb.invested += amount;
      return;
    }

    const selfShare =
      limb.girth < MAX_GIRTH[limb.kind] ? amount * 0.25 : 0;
    limb.energy += selfShare;
    limb.invested += selfShare;
    const each = (amount - selfShare) / descendants.length;
    for (const descendant of descendants) {
      descendant.energy += each;
      descendant.invested += each;
    }
  }

  private limbDescendsFrom(candidate: Limb, ancestor: Limb): boolean {
    let parentId = candidate.parentSegId;
    while (parentId >= 0) {
      const parent = this.seg(parentId);
      if (parent.limbId === ancestor.id) {
        return true;
      }
      parentId = parent.parentId;
    }
    return false;
  }

  /** Gives a flower sunlight and returns the light resource produced by the hit. */
  absorbLight(flowerId: number, amount: number): number {
    const flower = this.flowers.get(flowerId);
    invariant(flower !== undefined, `Flower ${flowerId} does not exist.`);
    const capacity = this.flowerLightCapacity(flower);
    flower.lightReserve = Math.min(capacity, flower.lightReserve + amount);
    flower.glow = 1;
    return amount * (0.35 + flower.scale * 0.65) * (0.4 + flower.health * 0.6);
  }

  private flowerLightCapacity(flower: Flower): number {
    return 4 + 12 * flower.scale;
  }

  steerLimb(limbId: number, direction: number): void {
    const limb = this.limb(limbId);
    if (limb.kind === 'twig' || limb.kind === 'tendril') {
      return;
    }
    const vertical = Math.sin(limb.steer) < 0 ? 1 : -1;
    let next = limb.steer + direction * vertical * 0.2;
    switch (limb.kind) {
      case 'trunk':
        next = clamp(next, Math.PI / 2 - 0.6, Math.PI / 2 + 0.6);
        break;
      case 'root':
        next = clamp(wrapAngle(next), -Math.PI + 0.15, -0.15);
        break;
      case 'branch':
        next = clamp(next, -0.3, Math.PI + 0.3);
        break;
      default: {
        const exhaustive: never = limb.kind;
        throw new Error(`Unhandled limb kind ${String(exhaustive)}`);
      }
    }
    limb.steer = next;
    limb.blocked = false;
  }

  canSplit(limb: Limb): boolean {
    if (limb.kind !== 'root' && limb.kind !== 'branch') {
      return false;
    }
    return !limb.closed && limb.segIds.length >= 5 && limb.order < 3;
  }

  splitLimb(limbId: number): void {
    const limb = this.limb(limbId);
    invariant(this.canSplit(limb), `Limb ${limbId} cannot be split.`);
    const tip = this.tipSegment(limb);
    const carry = limb.energy;
    limb.energy = 0;
    limb.closed = true;
    for (const flower of [...this.flowers.values()]) {
      if (flower.limbId === limb.id && flower.slot === 'tip') {
        this.flowers.delete(flower.id);
      }
    }
    const spread = this.rng.range(0.48, 0.72);
    const positive = tip.restAngle + spread;
    const negative = tip.restAngle - spread;
    const lateralSide =
      limb.kind === 'branch'
        ? Math.sin(positive) >= Math.sin(negative)
          ? 1
          : -1
        : Math.sin(positive) <= Math.sin(negative)
          ? 1
          : -1;
    const headings = [
      tip.restAngle + this.rng.range(-0.1, 0.1),
      tip.restAngle + lateralSide * spread,
    ];
    headings.forEach((targetHeading, index) => {
      const startHeading =
        tip.restAngle +
        wrapAngle(targetHeading - tip.restAngle) *
          (index === 0 ? 0.22 : 0.14);
      const child = this.createLimb(
        limb.kind,
        tip.id,
        limb.order + 1,
        targetHeading,
      );
      const weight = index === 0 ? 0.62 : 0.38;
      child.energy = 3 + carry * weight;
      child.girth = Math.min(
        MAX_GIRTH[child.kind],
        limb.girth * (index === 0 ? 0.48 : 0.32),
      );
      this.addSegment(child, startHeading, 0.05);
      if (child.kind === 'branch') {
        this.addFlower(child, 'tip', FLOWER_MIN_SCALE, 0);
      }
    });
  }

  canBranchFrom(segId: number): boolean {
    const seg = this.seg(segId);
    if (seg.kind !== 'trunk' && seg.kind !== 'branch') {
      return false;
    }
    if (seg.length < SEG_LEN * 0.9) {
      return false;
    }
    if (seg.y1 - this.baseY < 1.2) {
      return false;
    }
    const limb = this.limb(seg.limbId);
    if (seg.index >= limb.segIds.length - 1) {
      return false;
    }
    for (
      let i = Math.max(0, seg.index - 1);
      i <= Math.min(limb.segIds.length - 1, seg.index + 1);
      i += 1
    ) {
      const neighbour = this.seg(at(limb.segIds, i));
      if (neighbour.offshoots > 0) {
        return false;
      }
    }
    return true;
  }

  /** Resources sunk into a limb and everything growing out of it. */
  limbValue(limb: Limb): number {
    const segmentIds = this.subtreeIds(at(limb.segIds, 0));
    let total = 0;
    for (const candidate of this.limbs.values()) {
      const first = candidate.segIds[0];
      if (first !== undefined && segmentIds.has(first)) {
        total += candidate.invested;
      }
    }
    return total;
  }

  canPrune(limb: Limb): boolean {
    return limb.id !== this.trunkLimbId && limb.id !== this.rootLimbId;
  }

  /** Cuts a limb and its offshoots away. Returns the refund and the falling piece. */
  prune(limbId: number): { refund: number; debris: DebrisSpec } {
    const limb = this.limb(limbId);
    invariant(this.canPrune(limb), `Limb ${limbId} cannot be pruned.`);
    const first = this.seg(at(limb.segIds, 0));
    const refund = this.limbValue(limb) * PRUNE_REFUND;
    const debris = this.detach(first.id, first.x1 >= first.x0 ? 1 : -1);
    this.rebuildOrder();
    this.layout();
    return { refund, debris };
  }

  addBranch(segId: number, sideX: number): number {
    invariant(
      this.canBranchFrom(segId),
      `Cannot branch from segment ${segId}.`,
    );
    const seg = this.seg(segId);
    seg.offshoots += 1;
    const parentLimb = this.limb(seg.limbId);
    const targetHeading =
      seg.restAngle - sideX * this.rng.range(0.82, 1.05);
    const startHeading =
      seg.restAngle + wrapAngle(targetHeading - seg.restAngle) * 0.12;
    const limb = this.createLimb(
      'branch',
      seg.id,
      parentLimb.order + 1,
      targetHeading,
    );
    limb.energy = 3;
    this.addSegment(limb, startHeading, 0.05);
    this.addFlower(limb, 'tip', FLOWER_MIN_SCALE, 0);
    return limb.id;
  }

  private lengthCost(kind: LimbKind, radius: number): number {
    const base = kind === 'root' ? 4 : 5;
    return base * (1 + 1.3 * radius * radius);
  }

  private desiredHeading(limb: Limb, tip: Segment, index: number): number {
    const { amplitude, frequency } = WOBBLE[limb.kind];
    const wave =
      Math.sin(limb.phase + index * frequency) +
      0.4 * Math.sin(limb.phase * 1.7 + index * frequency * 2.3);
    const meander = limb.steer + (amplitude * wave) / 1.4;
    const curl = CURL[limb.kind];
    if (curl === 0) {
      return meander;
    }
    const progress = clamp(this.limbLength(limb) / Math.max(limb.maxLength, 0.1), 0, 1);
    const spiral = tip.restAngle - limb.side * curl;
    return lerp(meander, spiral, smoothstep(0.35, 0.95, progress));
  }

  private rootCollides(
    x: number,
    y: number,
    radius: number,
    near: Set<number>,
  ): boolean {
    for (const seg of this.order) {
      if (seg.kind !== 'root' || near.has(seg.id)) {
        continue;
      }
      const ax = seg.parentId >= 0 ? this.seg(seg.parentId).rx1 : seg.x0;
      const ay = seg.parentId >= 0 ? this.seg(seg.parentId).ry1 : seg.y0;
      if (distPointSegment(x, y, ax, ay, seg.rx1, seg.ry1) < radius + seg.radius + 0.06) {
        return true;
      }
    }
    return false;
  }

  private nearSet(tip: Segment, hops: number): Set<number> {
    const near = new Set<number>([tip.id]);
    let frontier = [tip.id];
    for (let h = 0; h < hops; h += 1) {
      const next: number[] = [];
      for (const id of frontier) {
        const seg = this.seg(id);
        const neighbours =
          seg.parentId >= 0
            ? [seg.parentId, ...seg.childIds]
            : [...seg.childIds];
        for (const n of neighbours) {
          if (!near.has(n)) {
            near.add(n);
            next.push(n);
          }
        }
      }
      frontier = next;
    }
    return near;
  }

  /** Distance a limb could grow along this heading before hitting something, capped at LOOKAHEAD. */
  private clearance(
    limb: Limb,
    tip: Segment,
    angle: number,
    radius: number,
    near: Set<number>,
  ): number {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    for (let d = 0.3; d <= LOOKAHEAD; d += 0.3) {
      const x = tip.rx1 + dx * d;
      const y = tip.ry1 + dy * d;
      const blocked = isAboveGround(limb.kind)
        ? this.world.branchBlocked(x, y, radius)
        : this.world.rootBlocked(x, y, radius) ||
          (limb.kind === 'root' && this.rootCollides(x, y, radius, near));
      if (blocked) {
        return d - 0.3;
      }
    }
    return LOOKAHEAD;
  }

  /** Picks the heading for the next segment, or undefined when nothing is free. */
  private chooseHeading(
    limb: Limb,
    tip: Segment,
    desired: number,
  ): number | undefined {
    const radius =
      Math.max(0.03, tip.radius * 0.8) + (limb.kind === 'root' ? 0.15 : 0);
    const near =
      limb.kind === 'root' ? this.nearSet(tip, 4) : new Set<number>();
    const normal = this.bestHeading(
      limb,
      tip,
      desired,
      radius,
      near,
      MAX_TURN[limb.kind],
    );
    if (
      normal !== undefined ||
      limb.kind === 'trunk' ||
      limb.kind === 'twig' ||
      limb.kind === 'tendril'
    ) {
      return normal;
    }
    // Roots and branches may swerve harder to slide around an obstacle they have run into.
    return this.bestHeading(
      limb,
      tip,
      desired,
      radius,
      near,
      MAX_TURN[limb.kind] * 2.6,
    );
  }

  private bestHeading(
    limb: Limb,
    tip: Segment,
    desired: number,
    radius: number,
    near: Set<number>,
    maxTurn: number,
  ): number | undefined {
    let best: number | undefined;
    let bestScore = -Infinity;
    const steps = 10;
    for (let i = -steps; i <= steps; i += 1) {
      const angle = tip.restAngle + (i / steps) * maxTurn;
      const free = this.clearance(limb, tip, angle, radius, near);
      if (free < SEG_LEN * 0.9) {
        continue;
      }
      const score = free * 0.35 - 4 * Math.abs(wrapAngle(angle - desired));
      if (score > bestScore) {
        bestScore = score;
        best = angle;
      }
    }
    return best;
  }

  /** Starts a new segment at the end of the tip. Returns false when blocked. */
  private extendLimb(limb: Limb): boolean {
    const tip = this.tipSegment(limb);
    const heading = this.chooseHeading(
      limb,
      tip,
      this.desiredHeading(limb, tip, limb.segIds.length),
    );
    if (heading === undefined) {
      return false;
    }
    const next = this.addSegment(limb, heading, 0.02);
    for (const flower of this.flowers.values()) {
      if (flower.limbId === limb.id && flower.slot === 'tip') {
        flower.segId = next.id;
      }
    }
    if (limb.kind === 'twig' && limb.segIds.length >= 4) {
      const hasMidFlower = [...this.flowers.values()].some(
        (flower) => flower.limbId === limb.id && flower.slot === 'mid',
      );
      if (!hasMidFlower && this.rng.chance(0.28)) {
        this.addFlower(limb, 'mid', 0, this.rng.range(0.5, 2.5), tip.id);
      }
    }
    return true;
  }

  private growLimb(limb: Limb, dt: number): void {
    if (limb.kind === 'twig' || limb.kind === 'tendril') {
      this.growAutomatic(limb, dt);
      return;
    }
    if (limb.energy <= 0) {
      return;
    }
    const budget = Math.min(limb.energy, GROW_RATE * dt);
    const canExtend = !limb.closed && !limb.blocked;
    const lengthShare = canExtend ? 0.55 : 0;
    let consumed = 0;

    if (lengthShare > 0) {
      let tip = this.tipSegment(limb);
      const cost = this.lengthCost(limb.kind, tip.radius);
      let dl = (budget * lengthShare) / cost;
      while (dl > 0) {
        const room = SEG_LEN - tip.length;
        if (dl < room) {
          tip.length += dl;
          consumed += dl * cost;
          break;
        }
        tip.length = SEG_LEN;
        consumed += room * cost;
        dl -= room;
        if (!this.extendLimb(limb)) {
          limb.blocked = true;
          break;
        }
        tip = this.tipSegment(limb);
      }
    }

    const maxGirth = MAX_GIRTH[limb.kind];
    if (limb.girth < maxGirth) {
      const girthBudget = budget - consumed;
      const length = Math.max(0.5, this.limbLength(limb));
      const rAvg = BASE_RADIUS[limb.kind] + limb.girth * 0.6;
      const perGirth = GIRTH_COST * Math.PI * 2 * rAvg * length;
      const dG = Math.min(girthBudget / perGirth, maxGirth - limb.girth);
      limb.girth += dG;
      consumed += dG * perGirth;
    }

    limb.energy = Math.max(0, limb.energy - consumed);
    if (
      !limb.closed &&
      limb.maxLength > 0 &&
      this.limbLength(limb) >= limb.maxLength
    ) {
      if (this.canSplit(limb)) {
        this.splitLimb(limb.id);
      } else {
        limb.closed = true;
      }
    }
  }

  private growAutomatic(limb: Limb, dt: number): void {
    if (limb.closed) {
      return;
    }
    const total = this.limbLength(limb);
    if (total >= limb.maxLength) {
      return;
    }
    const rate = limb.kind === 'tendril' ? 0.3 : 0.22;
    const tip = this.tipSegment(limb);
    const max = segmentMaxLength(limb.kind);
    tip.length = Math.min(max, tip.length + rate * dt);
    if (
      tip.length >= max &&
      this.limbLength(limb) < limb.maxLength - 0.05 &&
      !this.extendLimb(limb)
    ) {
      limb.closed = true;
    }
  }

  private spawnOffshoots(dt: number): void {
    for (const seg of [...this.order]) {
      if (seg.offshoots > 0 || seg.age < 2.5) {
        continue;
      }
      const limb = this.limb(seg.limbId);
      if (seg.index >= limb.segIds.length - 1) {
        continue;
      }
      if (
        limb.kind === 'root' &&
        seg.index >= 1 &&
        seg.index % 2 === 1 &&
        this.tendrilCount < MAX_TENDRILS &&
        this.rng.chance(0.6 * dt)
      ) {
        this.spawnTendril(seg);
      } else if (
        limb.kind === 'branch' &&
        seg.index >= 2 &&
        seg.index % 4 === 0 &&
        this.twigCount < MAX_TWIGS &&
        this.rng.chance(0.4 * dt)
      ) {
        this.spawnTwig(seg, limb);
      }
    }
  }

  private spawnTendril(seg: Segment): void {
    seg.offshoots += 1;
    let side = this.rng.chance(0.5) ? 1 : -1;
    const spread = this.rng.range(0.8, 1.3);
    let heading = seg.restAngle + side * spread;
    if (Math.sin(heading) > 0.3) {
      side = -side;
      heading = seg.restAngle + side * spread;
    }
    const tendril = this.createLimb('tendril', seg.id, 3, heading);
    tendril.side = side;
    tendril.maxLength = this.rng.range(1.8, 3.2);
    this.tendrilCount += 1;
    this.addSegment(tendril, heading, 0.05);
  }

  private spawnTwig(seg: Segment, parent: Limb): void {
    seg.offshoots += 1;
    const spread = this.rng.range(0.55, 1.15);
    const upwardSide =
      Math.sin(seg.restAngle + spread) >= Math.sin(seg.restAngle - spread)
        ? 1
        : -1;
    const side = this.rng.chance(0.78) ? upwardSide : -upwardSide;
    const heading = seg.restAngle + side * spread;
    const twig = this.createLimb('twig', seg.id, parent.order + 1, heading);
    twig.maxLength = this.rng.range(2.8, 5.6);
    twig.side = this.rng.chance(0.5) ? 1 : -1;
    this.twigCount += 1;
    this.addSegment(twig, heading, 0.05);
    this.addFlower(twig, 'tip', 0, this.rng.range(3, 7));
  }

  private updateFlowers(dt: number): TreeEvent[] {
    const events: TreeEvent[] = [];
    for (const flower of this.flowers.values()) {
      if (flower.bloomDelay > 0) {
        flower.bloomDelay -= dt;
        flower.glow = Math.max(0, flower.glow - dt * 2.5);
        continue;
      }

      const capacity = this.flowerLightCapacity(flower);
      const upkeep = (0.025 + 0.22 * flower.scale * flower.scale) * dt;
      flower.lightReserve = Math.max(0, flower.lightReserve - upkeep);
      const reserveRatio = flower.lightReserve / capacity;

      if (reserveRatio >= 0.4) {
        const excess = (reserveRatio - 0.4) / 0.6;
        flower.health = Math.min(1, flower.health + dt * 0.08);
        flower.scale = Math.min(
          flower.maxScale,
          flower.scale +
            dt *
              (0.018 + 0.07 * excess) *
              (1 - flower.scale / flower.maxScale),
        );
      } else if (reserveRatio >= 0.06) {
        flower.health = Math.min(1, flower.health + dt * 0.035);
      } else {
        const deficit = 1 - reserveRatio / 0.06;
        const sizeBurden = 0.55 + 0.8 * Math.pow(flower.scale, 1.4);
        flower.health = Math.max(
          0,
          flower.health -
            dt * (0.008 + 0.035 * deficit) * sizeBurden,
        );
      }
      flower.glow = Math.max(0, flower.glow - dt * 2.5);

      if (flower.health <= 0) {
        const shape: FlowerShape = {
          x: flower.x,
          y: flower.y,
          scale: flower.scale,
          health: 0,
          glow: 0,
          opacity: 1,
        };
        events.push({
          type: 'flower_fell',
          debris: {
            ribbons: [],
            flowers: [shape],
            pivotX: flower.x,
            pivotY: flower.y,
            direction: flower.side,
          },
        });
        this.flowers.delete(flower.id);
      }
    }
    return events;
  }

  private updateRadii(): void {
    const childSq = new Float64Array(this.order.length);
    const maturity = new Map<number, number>();
    for (const limb of this.limbs.values()) {
      maturity.set(
        limb.id,
        smoothstep(0.35, 3.5, this.limbLength(limb)),
      );
    }
    for (let i = this.order.length - 1; i >= 0; i -= 1) {
      const seg = at(this.order, i);
      const limb = this.limb(seg.limbId);
      const s = (seg.index + 0.5) / limb.segIds.length;
      let own: number;
      switch (limb.kind) {
        case 'tendril':
          own = 0.055 * (1 - 0.4 * s);
          break;
        case 'twig':
          own = 0.12 * (1 - 0.55 * s);
          break;
        case 'trunk':
        case 'root':
        case 'branch': {
          const { span, power } = TAPER[limb.kind];
          own =
            BASE_RADIUS[limb.kind] +
            limb.girth *
              (maturity.get(limb.id) ?? 0) *
              Math.pow(Math.max(0.03, 1 - span * s), power);
          break;
        }
        default: {
          const exhaustive: never = limb.kind;
          throw new Error(`Unhandled limb kind ${String(exhaustive)}`);
        }
      }
      seg.radius = Math.max(own, Math.sqrt(childSq[i] ?? 0) * 1.03);
      seg.mass = Math.PI * seg.radius * seg.radius * seg.length * 2;
      const parentIdx = this.parentIndex[i] ?? -1;
      const parent = parentIdx >= 0 ? at(this.order, parentIdx) : undefined;
      if (parent && parent.kind === seg.kind) {
        childSq[parentIdx] =
          (childSq[parentIdx] ?? 0) + seg.radius * seg.radius;
      }
    }
  }

  layout(): void {
    for (const seg of this.order) {
      const parent = seg.parentId >= 0 ? this.seg(seg.parentId) : undefined;
      let rx0: number;
      let ry0: number;
      if (parent) {
        seg.x0 = parent.x1;
        seg.y0 = parent.y1;
        seg.angle = parent.angle + seg.rel + seg.bend;
        rx0 = parent.rx1;
        ry0 = parent.ry1;
      } else {
        seg.x0 = this.baseX;
        seg.y0 = seg.kind === 'root' ? this.baseY - 0.12 : this.baseY;
        seg.angle = seg.rel + seg.bend;
        rx0 = seg.x0;
        ry0 = seg.y0;
      }
      seg.x1 = seg.x0 + Math.cos(seg.angle) * seg.length;
      seg.y1 = seg.y0 + Math.sin(seg.angle) * seg.length;
      seg.rx1 = rx0 + Math.cos(seg.restAngle) * seg.length;
      seg.ry1 = ry0 + Math.sin(seg.restAngle) * seg.length;
    }
    for (const flower of this.flowers.values()) {
      const seg = this.seg(flower.segId);
      if (flower.slot === 'tip') {
        flower.x = seg.x1 + Math.cos(seg.angle) * 0.14 * flower.scale;
        flower.y = seg.y1 + Math.sin(seg.angle) * 0.14 * flower.scale;
      } else {
        flower.x = seg.x1 - Math.sin(seg.angle) * 0.26 * flower.side;
        flower.y = seg.y1 + Math.cos(seg.angle) * 0.26 * flower.side;
      }
    }
  }

  private absorbWater(dt: number): number {
    let gained = 0;
    for (const limb of this.limbs.values()) {
      limb.glow = Math.max(0, limb.glow - dt * 1.6);
      if (limb.kind !== 'tendril' && limb.kind !== 'root') {
        continue;
      }
      const tip = this.tipSegment(limb);
      const lengthFrac =
        limb.kind === 'tendril' ? Math.min(1, this.limbLength(limb) / 0.8) : 1;
      const rate = limb.kind === 'tendril' ? 0.5 : 0.35;
      const taken = this.world.absorb(tip.x1, tip.y1, rate * lengthFrac, dt);
      gained += taken;
      if (taken > rate * lengthFrac * dt * 0.15) {
        limb.glow = 1;
      }
    }
    return gained;
  }

  update(dt: number, wind: number): TreeUpdate {
    const update: TreeUpdate = { water: 0, events: [] };
    if (this.fallen) {
      return update;
    }
    for (const seg of this.segments.values()) {
      seg.age += dt;
    }
    for (const limb of [...this.limbs.values()]) {
      this.growLimb(limb, dt);
    }
    this.spawnOffshoots(dt);
    update.events.push(...this.updateFlowers(dt));
    if (this.orderDirty) {
      this.rebuildOrder();
    }
    this.updateRadii();

    const report: PhysicsReport = stepPhysics(this, dt, wind);
    this.anchorRatio = report.anchorRatio;
    if (report.fell) {
      this.fall(report.torqueSign);
      update.events.push({
        type: 'fell',
        debris: this.lastDebris(),
        reason: report.fellReason,
      });
      return update;
    }
    for (const breakAt of report.breaks) {
      if (!this.segments.has(breakAt.segId)) {
        continue;
      }
      const debris = this.detach(breakAt.segId, breakAt.torqueSign);
      update.events.push({ type: 'break', debris });
      if (this.orderDirty) {
        this.rebuildOrder();
      }
    }
    this.layout();
    update.water = this.absorbWater(dt);
    return update;
  }

  private debris: DebrisSpec | undefined;

  private lastDebris(): DebrisSpec {
    invariant(this.debris !== undefined, 'No debris recorded.');
    return this.debris;
  }

  private subtreeIds(rootId: number): Set<number> {
    const ids = new Set<number>();
    const stack = [rootId];
    while (stack.length > 0) {
      const id = stack.pop();
      invariant(id !== undefined, 'Stack underflow.');
      ids.add(id);
      stack.push(...this.seg(id).childIds);
    }
    return ids;
  }

  private detach(segId: number, torqueSign: number): DebrisSpec {
    const seg = this.seg(segId);
    const ids = this.subtreeIds(segId);
    const debris: DebrisSpec = {
      ribbons: this.buildRibbons(ids),
      flowers: this.collectFlowers(ids),
      pivotX: seg.x0,
      pivotY: seg.y0,
      direction: torqueSign,
    };
    this.removeSegments(ids);
    return debris;
  }

  private removeSegments(ids: Set<number>): void {
    for (const id of ids) {
      const seg = this.seg(id);
      if (seg.parentId >= 0 && !ids.has(seg.parentId)) {
        const parent = this.seg(seg.parentId);
        parent.childIds = parent.childIds.filter((c) => c !== id);
      }
      this.segments.delete(id);
    }
    for (const flower of [...this.flowers.values()]) {
      if (ids.has(flower.segId)) {
        this.flowers.delete(flower.id);
      }
    }
    for (const limb of [...this.limbs.values()]) {
      limb.segIds = limb.segIds.filter((id) => !ids.has(id));
      if (limb.segIds.length === 0) {
        this.limbs.delete(limb.id);
        if (limb.kind === 'twig') {
          this.twigCount -= 1;
        }
      } else if (limb.kind === 'trunk' || limb.kind === 'branch') {
        limb.closed = false;
        limb.blocked = false;
        const tip = this.tipSegment(limb);
        tip.length = Math.min(SEG_LEN, tip.length);
        const hasTipFlower = [...this.flowers.values()].some(
          (f) => f.limbId === limb.id && f.slot === 'tip',
        );
        if (!hasTipFlower) {
          this.addFlower(limb, 'tip', FLOWER_MIN_SCALE, 0);
        }
      }
    }
    this.orderDirty = true;
  }

  private fall(torqueSign: number): void {
    const aboveGround = new Set<number>();
    for (const seg of this.segments.values()) {
      if (isAboveGround(seg.kind)) {
        aboveGround.add(seg.id);
      }
    }
    this.debris = {
      ribbons: this.buildRibbons(aboveGround),
      flowers: this.collectFlowers(aboveGround),
      pivotX: this.baseX,
      pivotY: this.baseY,
      direction: torqueSign,
    };
    this.removeSegments(aboveGround);
    this.rebuildOrder();
    this.fallen = true;
  }

  buildRibbons(only?: Set<number>): Ribbon[] {
    const ribbons: Ribbon[] = [];
    const kindOrder: LimbKind[] = [
      'root',
      'tendril',
      'trunk',
      'branch',
      'twig',
    ];
    for (const kind of kindOrder) {
      for (const limb of this.limbs.values()) {
        if (limb.kind !== kind) {
          continue;
        }
        const ids = only
          ? limb.segIds.filter((id) => only.has(id))
          : limb.segIds;
        if (ids.length === 0) {
          continue;
        }
        const points: RibbonPoint[] = [];
        const first = this.seg(at(ids, 0));
        const glowAt = (i: number): number =>
          kind === 'root' ? (i >= ids.length - 2 ? limb.glow : 0) : limb.glow;
        if (
          (kind === 'branch' || kind === 'root') &&
          first.id === limb.segIds[0] &&
          first.parentId >= 0
        ) {
          const parent = this.seg(first.parentId);
          const blendRadius = Math.min(
            parent.radius * 0.72,
            first.radius * 1.05,
          );
          const blendDistance = Math.min(
            parent.length * 0.8,
            Math.max(0.22, blendRadius * 1.5),
          );
          points.push({
            x: parent.x1 - Math.cos(parent.angle) * blendDistance,
            y: parent.y1 - Math.sin(parent.angle) * blendDistance,
            r: blendRadius,
            heat: parent.stress,
            glow: 0,
          });
        }
        points.push({
          x: first.x0,
          y: first.y0,
          r: first.radius,
          heat: first.stress,
          glow: kind === 'root' ? 0 : limb.glow,
        });
        ids.forEach((id, i) => {
          const seg = this.seg(id);
          const next =
            i + 1 < ids.length ? this.seg(at(ids, i + 1)) : undefined;
          points.push({
            x: seg.x1,
            y: seg.y1,
            r: next
              ? next.radius
              : seg.radius * (ids.length < 3 ? 0.58 : 0.15),
            heat: seg.stress,
            glow: glowAt(i),
          });
        });
        ribbons.push({ kind, points });
      }
    }
    return ribbons;
  }

  collectFlowers(only?: Set<number>): FlowerShape[] {
    const shapes: FlowerShape[] = [];
    for (const flower of this.flowers.values()) {
      if (flower.scale <= 0.02 || (only && !only.has(flower.segId))) {
        continue;
      }
      shapes.push({
        x: flower.x,
        y: flower.y,
        scale: flower.scale,
        health: flower.health,
        glow: flower.glow,
        opacity: 1,
      });
    }
    return shapes;
  }

  /** Finds the closest trunk, branch or root to a world point. */
  pick(
    x: number,
    y: number,
    maxDistance: number,
    kinds: readonly LimbKind[],
  ): PickResult | undefined {
    let best: PickResult | undefined;
    for (const seg of this.order) {
      if (!kinds.includes(seg.kind)) {
        continue;
      }
      const d =
        distPointSegment(x, y, seg.x0, seg.y0, seg.x1, seg.y1) - seg.radius;
      if (d < maxDistance && (best === undefined || d < best.distance)) {
        best = { segId: seg.id, limbId: seg.limbId, distance: d };
      }
    }
    return best;
  }

  /** How close the worst joint in this limb is to snapping, from 0 to 1. */
  limbStrain(limb: Limb): number {
    let worst = 0;
    for (const id of limb.segIds) {
      worst = Math.max(worst, this.seg(id).stress);
    }
    return worst;
  }

  /** How much of the tree's grip on the soil comes from this limb and its offshoots. */
  anchorShare(limb: Limb): number {
    let total = 0;
    for (const seg of this.order) {
      total += segmentAnchor(seg, this.baseX, this.baseY);
    }
    if (total <= 0) {
      return 0;
    }
    let mine = 0;
    for (const id of this.subtreeIds(at(limb.segIds, 0))) {
      mine += segmentAnchor(this.seg(id), this.baseX, this.baseY);
    }
    return mine / total;
  }

  /** Weight hanging off the far end of this limb, as a share of everything above ground. */
  limbLoad(limb: Limb): number {
    let total = 0;
    for (const seg of this.order) {
      if (seg.kind !== 'root' && seg.kind !== 'tendril') {
        total += seg.mass;
      }
    }
    if (total <= 0) {
      return 0;
    }
    let mine = 0;
    for (const id of this.subtreeIds(at(limb.segIds, 0))) {
      mine += this.seg(id).mass;
    }
    return mine / total;
  }

  flowerStats(limb: Limb): { count: number; averageHealth: number } {
    const segmentIds = this.subtreeIds(at(limb.segIds, 0));
    let count = 0;
    let health = 0;
    for (const flower of this.flowers.values()) {
      if (segmentIds.has(flower.segId) && flower.bloomDelay <= 0) {
        count += 1;
        health += flower.health;
      }
    }
    return {
      count,
      averageHealth: count > 0 ? health / count : 0,
    };
  }

  height(): number {
    let top = 0;
    for (const seg of this.order) {
      if (seg.kind === 'trunk' || seg.kind === 'branch') {
        top = Math.max(top, seg.y1 - this.baseY);
      }
    }
    return top;
  }

  bloomedFlowers(): number {
    let count = 0;
    for (const flower of this.flowers.values()) {
      if (
        flower.bloomDelay <= 0 &&
        flower.scale >= FLOWER_MIN_SCALE &&
        flower.health > 0.25
      ) {
        count += 1;
      }
    }
    return count;
  }
}
