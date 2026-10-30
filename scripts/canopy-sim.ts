import { LEVELS } from '../src/levels';
import { Tree } from '../src/tree';
import { PHYSICS } from '../src/treePhysics';
import { at } from '../src/util';
import { World } from '../src/world';

const level = at(LEVELS, 0);
const world = new World(level);
const tree = new Tree(world, -5, level.seed);
const dt = 1 / 60;

// This script isolates branch architecture from anchoring and weather.
PHYSICS.soilGrip = 1e6;

tree.invest(tree.rootLimbId, 300);
tree.invest(tree.trunkLimbId, 180);
for (let i = 0; i < 60 * 50; i += 1) {
  tree.update(dt, 0);
}

const trunk = tree.limb(tree.trunkLimbId);
for (const fraction of [0.18, 0.38, 0.58, 0.78]) {
  const candidates = trunk.segIds.filter((id) => tree.canBranchFrom(id));
  const segId = candidates[Math.floor(candidates.length * fraction)];
  if (segId !== undefined && tree.canBranchFrom(segId)) {
    const side = fraction === 0.38 || fraction === 0.78 ? -1 : 1;
    tree.addBranch(segId, side);
  }
}

let breaks = 0;
for (let i = 0; i < 60 * 120; i += 1) {
  tree.invest(tree.trunkLimbId, 0.03);
  for (const limb of tree.limbs.values()) {
    if (limb.kind === 'branch' && !limb.closed) {
      tree.invest(limb.id, 0.01);
    }
  }
  let stressed = tree.order[0];
  for (const segment of tree.order) {
    if (!stressed || segment.stress > stressed.stress) {
      stressed = segment;
    }
  }
  const update = tree.update(dt, 0);
  const newBreaks = update.events.filter((event) => event.type === 'break');
  if (newBreaks.length > 0 && stressed) {
    console.log('break', {
      second: (i / 60).toFixed(1),
      kind: stressed.kind,
      index: stressed.index,
      radius: stressed.radius.toFixed(2),
      stress: stressed.stress.toFixed(2),
    });
  }
  breaks += newBreaks.length;
}

let maxStress = 0;
for (const segment of tree.order) {
  maxStress = Math.max(maxStress, segment.stress);
}
console.log({
  height: tree.height().toFixed(1),
  branches: [...tree.limbs.values()].filter((limb) => limb.kind === 'branch')
    .length,
  flowers: tree.bloomedFlowers(),
  breaks,
  maxStress: maxStress.toFixed(2),
  fallen: tree.fallen,
});
