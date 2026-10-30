import { Environment, DAY_LENGTH } from '../src/environment';
import { LEVELS } from '../src/levels';
import { RayField } from '../src/rays';
import { COSTS, Tree } from '../src/tree';
import { World } from '../src/world';
import { at } from '../src/util';

const level = at(LEVELS, 0);
const world = new World(level);
const env = new Environment(level.windBase, level.rainEvery, level.seed);
const rays = new RayField();
const tree = new Tree(world, 0, 1);
let water = level.startWater;
let light = level.startLight;
const dt = 1 / 30;
const days = Number(process.argv[2] ?? 6);
let breaks = 0;
let earnedWater = 0;
let earnedLight = 0;
let nextBranchSide = 1;

function rootLimbs() {
  return [...tree.limbs.values()].filter((l) => l.kind === 'root' && !l.closed);
}

function tryActions(): void {
  // Water: keep roots strong relative to the load on the trunk, otherwise grow the trunk.
  const splitCandidate = rootLimbs().find((root) => tree.canSplit(root));
  let reserveWater = false;
  if (splitCandidate && rootLimbs().length < 10) {
    if (water < COSTS.splitRoot) {
      reserveWater = true;
    } else {
      tree.splitLimb(splitCandidate.id);
      water -= COSTS.splitRoot;
    }
  }
  while (!reserveWater && water >= COSTS.invest) {
    const trunk = tree.limb(tree.trunkLimbId);
    const roots = rootLimbs();
    const height = tree.height();
    const rootLen = roots.reduce((a, l) => a + tree.limbLength(l), 0);
    if (roots.length > 0 && (tree.anchorRatio > 0.35 || rootLen < height * 1.2 + 4)) {
      const r = at(roots, Math.floor(Math.random() * roots.length));
      tree.invest(r.id, COSTS.invest);
    } else {
      tree.invest(trunk.id, COSTS.invest);
    }
    water -= COSTS.invest;
  }
  // Light: new branches, then grow them.
  const branches = [...tree.limbs.values()].filter((l) => l.kind === 'branch' && !l.closed);
  if (light >= COSTS.newBranch + 10 && branches.length < 4 + tree.height() / 5) {
    const trunk = tree.limb(tree.trunkLimbId);
    for (const id of trunk.segIds) {
      if (tree.canBranchFrom(id) && tree.seg(id).y1 - tree.baseY > 2 + branches.length * 1.6) {
        tree.addBranch(id, nextBranchSide);
        nextBranchSide = -nextBranchSide;
        light -= COSTS.newBranch;
        break;
      }
    }
  }
  while (light >= COSTS.invest && branches.length > 0) {
    // Feed the branch that is thinnest for its length.
    let pick = at(branches, 0);
    let worst = Infinity;
    for (const b of branches) {
      const ratio = (b.girth + 0.03) / Math.max(1, tree.limbLength(b));
      if (ratio < worst) { worst = ratio; pick = b; }
    }
    tree.invest(pick.id, COSTS.invest);
    light -= COSTS.invest;
  }
}

let nextReport = 0;
const total = days * DAY_LENGTH;
for (let t = 0; t < total; t += dt) {
  env.update(dt);
  world.step(dt, env.rain, env.sunStrength);
  const l = rays.update(dt, env, world, tree);
  light += l;
  earnedLight += l;
  const result = tree.update(dt, env.wind);
  water += result.water;
  earnedWater += result.water;
  for (const ev of result.events) {
    if (ev.type === 'break') breaks += 1;
    if (ev.type === 'fell') {
      console.log(`TREE FELL (${ev.reason}) at t=${t.toFixed(0)} anchor=${tree.anchorRatio.toFixed(2)}`);
      process.exit(0);
    }
  }
  tryActions();
  if (t >= nextReport) {
    nextReport += 20;
    let maxStress = 0;
    for (const s of tree.order) maxStress = Math.max(maxStress, s.stress);
    console.log(
      `t=${t.toFixed(0).padStart(4)} day=${env.dayNumber} water=${water.toFixed(0).padStart(4)} light=${light.toFixed(0).padStart(4)} ` +
        `h=${tree.height().toFixed(1).padStart(5)} flowers=${String(tree.bloomedFlowers()).padStart(3)} segs=${tree.order.length} ` +
        `anchor=${tree.anchorRatio.toFixed(2)} maxStress=${maxStress.toFixed(2)} wind=${env.wind.toFixed(1)} rain=${env.rain.toFixed(1)} breaks=${breaks} earnedW=${earnedWater.toFixed(0)} earnedL=${earnedLight.toFixed(0)}`,
    );
  }
}
