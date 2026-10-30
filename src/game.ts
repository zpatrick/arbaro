import { Debris } from './debris';
import { Environment } from './environment';
import type { LevelDef } from './levels';
import { RayField } from './rays';
import { Scenery } from './scenery';
import { COSTS, MAX_GIRTH, Tree } from './tree';
import type { Limb, LimbKind } from './treeTypes';
import { invariant } from './util';
import { World } from './world';

export type Tool = 'select' | 'branch' | 'prune';
export type Speed = 0 | 1 | 2 | 4;
export type Status = 'playing' | 'won' | 'lost';
export type Resource = 'water' | 'light';

const STEP = 1 / 60;

export function resourceFor(kind: LimbKind): Resource {
  switch (kind) {
    case 'trunk':
    case 'root':
    case 'tendril':
      return 'water';
    case 'branch':
    case 'twig':
      return 'light';
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unhandled limb kind ${String(exhaustive)}`);
    }
  }
}

export class Game {
  readonly level: LevelDef;
  readonly world: World;
  readonly env: Environment;
  readonly rays = new RayField();
  readonly scenery: Scenery;
  readonly debris: Debris[] = [];
  tree: Tree | undefined;
  water: number;
  light: number;
  tool: Tool = 'select';
  speed: Speed = 1;
  status: Status = 'playing';
  selectedLimbId: number | undefined;
  /** What the tree looked like when the goal was reached. */
  result: { height: number; flowers: number; day: number } | undefined;
  toast: { text: string; age: number } | undefined;
  private accumulator = 0;
  private lostTimer = 0;
  private warningCooldown = 0;

  constructor(level: LevelDef) {
    this.level = level;
    this.world = new World(level);
    this.env = new Environment(level.windBase, level.rainEvery, level.seed);
    this.scenery = new Scenery(level.halfWidth, level.seed);
    this.water = level.startWater;
    this.light = level.startLight;
  }

  get waterCap(): number {
    return this.resourceCap();
  }

  get lightCap(): number {
    return this.resourceCap();
  }

  private resourceCap(): number {
    if (!this.tree) {
      return 120;
    }
    const trunk = this.tree.limbs.get(this.tree.trunkLimbId);
    const base = trunk ? this.tree.segments.get(trunk.segIds[0] ?? -1) : undefined;
    return 120 + 110 * (base?.radius ?? 0.1);
  }

  get selectedLimb(): Limb | undefined {
    if (!this.tree || this.selectedLimbId === undefined) {
      return undefined;
    }
    return this.tree.limbs.get(this.selectedLimbId);
  }

  notify(text: string): void {
    this.toast = { text, age: 0 };
  }

  plantSeed(x: number): boolean {
    if (this.tree) {
      return false;
    }
    if (!this.world.canPlantSeed(x)) {
      this.notify('The seed cannot be planted there.');
      return false;
    }
    this.tree = new Tree(this.world, x, this.level.seed * 7 + 1);
    this.selectedLimbId = this.tree.trunkLimbId;
    this.notify('Your seed is planted. Roots grow down while the trunk grows up.');
    return true;
  }

  select(limbId: number | undefined): void {
    this.selectedLimbId = limbId;
  }

  setTool(tool: Tool): void {
    this.tool = tool;
  }

  private spend(resource: Resource, amount: number): boolean {
    const have = resource === 'water' ? this.water : this.light;
    if (have < amount) {
      this.notify(`Not enough ${resource}.`);
      return false;
    }
    if (resource === 'water') {
      this.water -= amount;
    } else {
      this.light -= amount;
    }
    return true;
  }

  invest(): void {
    const limb = this.selectedLimb;
    if (!this.tree || !limb) {
      return;
    }
    const resource = resourceFor(limb.kind);
    if ((limb.closed || limb.blocked) && limb.girth >= 0.99 * MAX_GIRTH[limb.kind]) {
      this.notify('This limb is as thick as it can get.');
      return;
    }
    if (this.spend(resource, COSTS.invest)) {
      this.tree.invest(limb.id, COSTS.invest);
    }
  }

  steer(direction: number): void {
    const limb = this.selectedLimb;
    if (!this.tree || !limb) {
      return;
    }
    this.tree.steerLimb(limb.id, direction);
  }

  canSplitSelected(): boolean {
    const limb = this.selectedLimb;
    return this.tree !== undefined && limb !== undefined && this.tree.canSplit(limb);
  }

  splitCost(limb: Limb): number {
    return limb.kind === 'root' ? COSTS.splitRoot : COSTS.splitBranch;
  }

  split(): void {
    const limb = this.selectedLimb;
    if (!this.tree || !limb) {
      return;
    }
    if (!this.tree.canSplit(limb)) {
      this.notify('This limb must be longer before it can split.');
      return;
    }
    if (this.spend(resourceFor(limb.kind), this.splitCost(limb))) {
      this.tree.splitLimb(limb.id);
      this.selectedLimbId = undefined;
    }
  }

  canPruneSelected(): boolean {
    const limb = this.selectedLimb;
    return this.tree !== undefined && limb !== undefined && this.tree.canPrune(limb);
  }

  pruneRefund(limb: Limb): number {
    invariant(this.tree !== undefined, 'Cannot price a prune without a tree.');
    return Math.round(this.tree.limbValue(limb) * 0.4);
  }

  prune(limbId: number): void {
    invariant(this.tree !== undefined, 'Cannot prune without a tree.');
    const limb = this.tree.limb(limbId);
    if (!this.tree.canPrune(limb)) {
      this.notify('The first trunk and taproot cannot be cut.');
      return;
    }
    const resource = resourceFor(limb.kind);
    const { refund, debris } = this.tree.prune(limbId);
    if (resource === 'water') {
      this.water = Math.min(this.waterCap, this.water + refund);
    } else {
      this.light = Math.min(this.lightCap, this.light + refund);
    }
    if (limb.kind !== 'root') {
      this.debris.push(new Debris(debris, false));
    }
    this.selectedLimbId = undefined;
    this.tool = 'select';
    this.notify(`Cut away. ${Math.round(refund)} ${resource} recovered.`);
  }

  addBranch(segId: number, sideX: number): void {
    invariant(this.tree !== undefined, 'Cannot branch without a tree.');
    if (!this.tree.canBranchFrom(segId)) {
      return;
    }
    if (this.spend('light', COSTS.newBranch)) {
      const limbId = this.tree.addBranch(segId, sideX);
      this.selectedLimbId = limbId;
      this.tool = 'select';
    }
  }

  update(frameDt: number): void {
    if (this.toast) {
      this.toast.age += frameDt;
      if (this.toast.age > 4) {
        this.toast = undefined;
      }
    }
    this.accumulator += Math.min(frameDt, 0.1) * this.speed;
    let steps = 0;
    while (this.accumulator >= STEP && steps < 12) {
      this.accumulator -= STEP;
      steps += 1;
      this.step();
    }
    if (steps === 12) {
      this.accumulator = 0;
    }
  }

  private warnAboutStrain(tree: Tree): void {
    this.warningCooldown = Math.max(0, this.warningCooldown - STEP);
    if (this.warningCooldown > 0) {
      return;
    }
    if (tree.anchorRatio > 0.7) {
      this.notify('The roots are struggling to hold the tree. Grow thicker, wider roots.');
      this.warningCooldown = 12;
      return;
    }
    for (const seg of tree.order) {
      if ((seg.kind === 'trunk' || seg.kind === 'branch') && seg.stress > 0.85) {
        this.notify('A limb is close to snapping. Thicken it or lighten the load.');
        this.warningCooldown = 12;
        return;
      }
    }
  }

  private step(): void {
    this.env.update(STEP);
    this.world.step(STEP, this.env.rain, this.env.sunStrength);
    this.scenery.update(STEP, this.env.wind);

    const gained = this.rays.update(STEP, this.env, this.world, this.tree);
    this.light = Math.min(this.lightCap, this.light + gained);

    const tree = this.tree;
    if (tree && !tree.fallen) {
      const result = tree.update(STEP, this.env.wind);
      this.water = Math.min(this.waterCap, this.water + result.water);
      for (const event of result.events) {
        switch (event.type) {
          case 'break':
            this.debris.push(new Debris(event.debris, false));
            this.notify('A branch snapped under the strain.');
            break;
          case 'flower_fell':
            this.debris.push(new Debris(event.debris, false));
            break;
          case 'fell':
            this.debris.push(new Debris(event.debris, true));
            this.selectedLimbId = undefined;
            this.notify(event.reason === 'roots' ? 'The roots could not hold the tree.' : 'The trunk snapped.');
            break;
          default: {
            const exhaustive: never = event;
            throw new Error(`Unhandled tree event ${JSON.stringify(exhaustive)}`);
          }
        }
      }
      this.warnAboutStrain(tree);
      if (this.selectedLimbId !== undefined && !tree.limbs.has(this.selectedLimbId)) {
        this.selectedLimbId = undefined;
      }
      if (
        this.status === 'playing' &&
        tree.height() >= this.level.goal.height &&
        tree.bloomedFlowers() >= this.level.goal.flowers
      ) {
        this.status = 'won';
        this.result = { height: tree.height(), flowers: tree.bloomedFlowers(), day: this.env.dayNumber };
      }
    }
    if (tree?.fallen && this.status === 'playing') {
      this.lostTimer += STEP;
      if (this.lostTimer > 2.5) {
        this.status = 'lost';
      }
    }

    for (let i = this.debris.length - 1; i >= 0; i -= 1) {
      const piece = this.debris[i];
      invariant(piece !== undefined, `Debris ${i} is missing.`);
      piece.update(STEP, this.world);
      if (piece.done) {
        this.debris.splice(i, 1);
      }
    }
  }
}
