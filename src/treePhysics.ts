import type { Tree } from './tree';
import type { Segment } from './treeTypes';
import { at, clamp, invariant } from './util';

export const PHYSICS = {
  gravity: 4,
  windDrag: 0.16,
  flowerDrag: 0.025,
  flowerMass: 0.05,
  bendStiffness: 2.5e3,
  strength: 18000,
  soilGrip: 75,
};

/**
 * How far a whole limb may lean away from its rest shape, in radians. Without
 * this a heavy trunk keeps folding onto itself instead of settling into a lean.
 */
const MAX_TILT: Record<string, number> = {
  trunk: 0.5,
  branch: 0.85,
  twig: 1.1,
};

export interface PhysicsReport {
  /** Overturning moment at the base divided by what the roots can hold. */
  anchorRatio: number;
  fell: boolean;
  fellReason: 'trunk' | 'roots' | 'none';
  torqueSign: number;
  breaks: { segId: number; torqueSign: number }[];
}

/** How much a single root or root hair resists the tree tipping over. */
export function segmentAnchor(seg: Segment, baseX: number, baseY: number): number {
  if (seg.kind !== 'root' && seg.kind !== 'tendril') {
    return 0;
  }
  const xm = (seg.x0 + seg.x1) / 2;
  const ym = (seg.y0 + seg.y1) / 2;
  const depth = Math.max(0, baseY - ym);
  const lever = Math.abs(xm - baseX) + 0.6;
  const factor = seg.kind === 'tendril' ? 0.2 : 1;
  return PHYSICS.soilGrip * seg.radius * seg.length * (1 + 0.12 * depth) * lever * factor;
}

function windAt(wind: number, height: number): number {
  return wind * (1 + 0.025 * Math.max(0, height));
}

function drag(speed: number, coefficient: number): number {
  return Math.sign(speed) * speed * speed * coefficient;
}

/**
 * Bends the above-ground part of the tree under weight and wind, reports which segments
 * are overloaded, and checks whether the roots can still hold the tree upright.
 */
export function stepPhysics(tree: Tree, dt: number, wind: number): PhysicsReport {
  const order = tree.order;
  const n = order.length;
  const sFx = new Float64Array(n);
  const sFy = new Float64Array(n);
  const sT = new Float64Array(n);
  const sM = new Float64Array(n);
  const sMx = new Float64Array(n);
  const sMy = new Float64Array(n);
  const sMr = new Float64Array(n);

  const flexible = order.map((seg) => seg.kind === 'trunk' || seg.kind === 'branch' || seg.kind === 'twig');

  const addLoad = (i: number, px: number, py: number, fx: number, fy: number, m: number): void => {
    sFx[i] = (sFx[i] ?? 0) + fx;
    sFy[i] = (sFy[i] ?? 0) + fy;
    sT[i] = (sT[i] ?? 0) + px * fy - py * fx;
    sM[i] = (sM[i] ?? 0) + m;
    sMx[i] = (sMx[i] ?? 0) + m * px;
    sMy[i] = (sMy[i] ?? 0) + m * py;
    sMr[i] = (sMr[i] ?? 0) + m * (px * px + py * py);
  };

  for (let i = 0; i < n; i += 1) {
    if (!flexible[i]) {
      continue;
    }
    const seg = at(order, i);
    const mx = (seg.x0 + seg.x1) / 2;
    const my = (seg.y0 + seg.y1) / 2;
    const speed = windAt(wind, my - tree.baseY);
    addLoad(i, mx, my, drag(speed, PHYSICS.windDrag * 2 * seg.radius * seg.length), -PHYSICS.gravity * seg.mass, seg.mass);
  }
  for (const flower of tree.flowers.values()) {
    const i = tree.indexOf.get(flower.segId);
    invariant(i !== undefined, `Flower ${flower.id} sits on a missing segment.`);
    const mass = PHYSICS.flowerMass * flower.scale;
    const speed = windAt(wind, flower.y - tree.baseY);
    addLoad(i, flower.x, flower.y, drag(speed, PHYSICS.flowerDrag * flower.scale), -PHYSICS.gravity * mass, mass);
  }

  for (let i = n - 1; i >= 0; i -= 1) {
    const p = tree.parentIndex[i] ?? -1;
    if (p < 0 || !flexible[i]) {
      continue;
    }
    sFx[p] = (sFx[p] ?? 0) + (sFx[i] ?? 0);
    sFy[p] = (sFy[p] ?? 0) + (sFy[i] ?? 0);
    sT[p] = (sT[p] ?? 0) + (sT[i] ?? 0);
    sM[p] = (sM[p] ?? 0) + (sM[i] ?? 0);
    sMx[p] = (sMx[p] ?? 0) + (sMx[i] ?? 0);
    sMy[p] = (sMy[p] ?? 0) + (sMy[i] ?? 0);
    sMr[p] = (sMr[p] ?? 0) + (sMr[i] ?? 0);
  }

  const report: PhysicsReport = { anchorRatio: 0, fell: false, fellReason: 'none', torqueSign: 1, breaks: [] };
  let baseTorque = 0;
  const smoothing = 1 - Math.exp(-dt * 8);

  for (let i = 0; i < n; i += 1) {
    if (!flexible[i]) {
      continue;
    }
    const seg = at(order, i);
    const jx = seg.x0;
    const jy = seg.y0;
    const torque = (sT[i] ?? 0) - (jx * (sFy[i] ?? 0) - jy * (sFx[i] ?? 0));
    const r = seg.radius;
    const stiffness = (PHYSICS.bendStiffness * r * r * r * r) / Math.max(seg.length, 0.25);
    const target = clamp(torque / stiffness, -0.9, 0.9);
    const inertia = (sMr[i] ?? 0) - 2 * (jx * (sMx[i] ?? 0) + jy * (sMy[i] ?? 0)) + (jx * jx + jy * jy) * (sM[i] ?? 0);
    const omega = clamp(Math.sqrt(stiffness / Math.max(inertia, 1e-3)), 1.5, 9);
    const limit = (MAX_TILT[seg.kind] ?? 1) / Math.max(1, tree.limb(seg.limbId).segIds.length);
    const acceleration = omega * omega * (clamp(target, -limit, limit) - seg.bend) - 2 * 0.22 * omega * seg.bendVel;
    seg.bendVel += acceleration * dt;
    seg.bend = clamp(seg.bend + seg.bendVel * dt, -limit, limit);

    if (seg.kind === 'trunk' && seg.index === 0) {
      baseTorque = torque;
    }

    if (seg.kind === 'twig') {
      seg.stress = 0;
      continue;
    }
    const raw = Math.abs(torque) / (r * r * r * PHYSICS.strength);
    seg.stress += (raw - seg.stress) * smoothing;
    if (seg.stress > 1) {
      seg.damage += dt * ((seg.stress - 1) * 4 + 0.4);
    } else if (seg.stress < 0.9) {
      seg.damage = Math.max(0, seg.damage - dt * 0.3);
    }
    if (seg.damage >= 1) {
      const sign = torque > 0 ? -1 : 1;
      if (seg.kind === 'trunk' && seg.index === 0) {
        report.fell = true;
        report.fellReason = 'trunk';
        report.torqueSign = sign;
      } else {
        report.breaks.push({ segId: seg.id, torqueSign: sign });
      }
    }
  }

  let capacity = 0;
  for (const seg of order) {
    capacity += segmentAnchor(seg, tree.baseX, tree.baseY);
  }
  report.anchorRatio = Math.abs(baseTorque) / Math.max(capacity, 1e-3);
  if (report.anchorRatio > 1) {
    tree.anchorDamage += dt * ((report.anchorRatio - 1) * 4 + 0.4);
  } else if (report.anchorRatio < 0.9) {
    tree.anchorDamage = Math.max(0, tree.anchorDamage - dt * 0.3);
  }
  if (tree.anchorDamage >= 1) {
    report.fell = true;
    report.fellReason = 'roots';
    report.torqueSign = baseTorque > 0 ? -1 : 1;
  }
  return report;
}
