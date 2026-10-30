import * as THREE from 'three';
import type { RibbonPoint } from '../treeTypes';
import { invariant } from '../util';
import type { Rgb } from './colors';

const SUBDIVISIONS = 3;
const CAP_SIDES = 8;

export type ColorOf = (p: RibbonPoint) => Rgb;

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export function smoothPoints(points: readonly RibbonPoint[]): RibbonPoint[] {
  const m = points.length;
  const out: RibbonPoint[] = [];
  for (let i = 0; i < m - 1; i += 1) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, m - 1)];
    invariant(p0 !== undefined && p1 !== undefined && p2 !== undefined && p3 !== undefined, 'Ribbon point missing.');
    for (let s = 0; s < SUBDIVISIONS; s += 1) {
      const t = s / SUBDIVISIONS;
      out.push({
        x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
        y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
        r: p1.r + (p2.r - p1.r) * t,
        heat: p1.heat + (p2.heat - p1.heat) * t,
        glow: p1.glow + (p2.glow - p1.glow) * t,
      });
    }
  }
  const last = points[m - 1];
  if (last !== undefined) {
    out.push(last);
  }
  return out;
}

/** A dynamic triangle mesh that holds many tapered ribbons drawn with vertex colors. */
export class RibbonMesh {
  readonly mesh: THREE.Mesh;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly indices: Uint32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly slots: Int8Array;
  private currentSlot = -1;
  private vertexCount = 0;
  private indexCount = 0;

  constructor(maxVertices: number, renderOrder: number) {
    this.positions = new Float32Array(maxVertices * 3);
    this.colors = new Float32Array(maxVertices * 4);
    this.indices = new Uint32Array(maxVertices * 3);
    this.slots = new Int8Array(maxVertices).fill(-1);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  begin(): void {
    this.vertexCount = 0;
    this.indexCount = 0;
    this.currentSlot = -1;
  }

  /**
   * Tags following shapes with a palette slot so they can be recoloured later
   * without rebuilding their geometry. Pass -1 to go back to literal colours.
   */
  useSlot(slot: number): void {
    this.currentSlot = slot;
  }

  /** Rewrites the colours of every slotted vertex. Alpha is left untouched. */
  recolor(colors: readonly Rgb[]): void {
    for (let v = 0; v < this.vertexCount; v += 1) {
      const slot = this.slots[v] ?? -1;
      if (slot < 0) {
        continue;
      }
      const color = colors[slot];
      invariant(color !== undefined, `No colour for slot ${slot}.`);
      this.colors[v * 4] = color[0];
      this.colors[v * 4 + 1] = color[1];
      this.colors[v * 4 + 2] = color[2];
    }
    (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  end(): void {
    this.geometry.setDrawRange(0, this.indexCount);
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getIndex() as THREE.BufferAttribute).needsUpdate = true;
  }

  private vertex(x: number, y: number, color: Rgb, alpha: number): number {
    const v = this.vertexCount;
    invariant((v + 1) * 4 <= this.colors.length, 'Ribbon mesh is out of vertices.');
    this.positions[v * 3] = x;
    this.positions[v * 3 + 1] = y;
    this.positions[v * 3 + 2] = 0;
    this.colors[v * 4] = color[0];
    this.colors[v * 4 + 1] = color[1];
    this.colors[v * 4 + 2] = color[2];
    this.colors[v * 4 + 3] = alpha;
    this.slots[v] = this.currentSlot;
    this.vertexCount += 1;
    return v;
  }

  private triangle(a: number, b: number, c: number): void {
    this.indices[this.indexCount] = a;
    this.indices[this.indexCount + 1] = b;
    this.indices[this.indexCount + 2] = c;
    this.indexCount += 3;
  }

  private cap(p: RibbonPoint, width: number, color: Rgb, alpha: number): void {
    const center = this.vertex(p.x, p.y, color, alpha);
    const ring: number[] = [];
    for (let i = 0; i < CAP_SIDES; i += 1) {
      const a = (i / CAP_SIDES) * Math.PI * 2;
      ring.push(this.vertex(p.x + Math.cos(a) * width, p.y + Math.sin(a) * width, color, alpha));
    }
    for (let i = 0; i < CAP_SIDES; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % CAP_SIDES];
      invariant(a !== undefined && b !== undefined, 'Cap vertex missing.');
      this.triangle(center, a, b);
    }
  }

  /** Adds one ribbon. `extra` widens it on both sides, used for outlines. */
  addRibbon(points: readonly RibbonPoint[], extra: number, colorOf: ColorOf, alpha = 1, smooth = true): void {
    if (points.length < 2) {
      return;
    }
    const samples = smooth ? smoothPoints(points) : [...points];
    const n = samples.length;
    let prevTx = 0;
    let prevTy = 1;
    let previousLeft = -1;
    let previousRight = -1;
    for (let i = 0; i < n; i += 1) {
      const s = samples[i];
      const before = samples[Math.max(i - 1, 0)];
      const after = samples[Math.min(i + 1, n - 1)];
      invariant(s !== undefined && before !== undefined && after !== undefined, 'Sample missing.');
      let tx = after.x - before.x;
      let ty = after.y - before.y;
      const len = Math.hypot(tx, ty);
      if (len < 1e-6) {
        tx = prevTx;
        ty = prevTy;
      } else {
        tx /= len;
        ty /= len;
      }
      prevTx = tx;
      prevTy = ty;
      const w = Math.max(0.012, s.r + extra);
      const color = colorOf(s);
      const left = this.vertex(s.x - ty * w, s.y + tx * w, color, alpha);
      const right = this.vertex(s.x + ty * w, s.y - tx * w, color, alpha);
      if (previousLeft >= 0) {
        this.triangle(previousLeft, previousRight, left);
        this.triangle(previousRight, right, left);
      }
      previousLeft = left;
      previousRight = right;
    }
    const first = samples[0];
    const last = samples[n - 1];
    invariant(first !== undefined && last !== undefined, 'Sample missing.');
    this.cap(first, Math.max(0.012, first.r + extra), colorOf(first), alpha);
    this.cap(last, Math.max(0.012, last.r + extra), colorOf(last), alpha);
  }

  /** Adds a filled convex or star-shaped polygon fan around its centroid. */
  addPolygon(points: readonly { x: number; y: number }[], color: Rgb, alpha = 1): void {
    let cx = 0;
    let cy = 0;
    for (const p of points) {
      cx += p.x;
      cy += p.y;
    }
    cx /= points.length;
    cy /= points.length;
    const center = this.vertex(cx, cy, color, alpha);
    const ring = points.map((p) => this.vertex(p.x, p.y, color, alpha));
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      invariant(a !== undefined && b !== undefined, 'Polygon vertex missing.');
      this.triangle(center, a, b);
    }
  }

  /** Adds a closed outline of constant width around a polygon. */
  addLoop(points: readonly { x: number; y: number }[], width: number, color: Rgb, smooth: boolean): void {
    const loop: RibbonPoint[] = [...points, points[0]].map((p) => {
      invariant(p !== undefined, 'Loop point missing.');
      return { x: p.x, y: p.y, r: width / 2, heat: 0, glow: 0 };
    });
    this.addRibbon(loop, 0, () => color, 1, smooth);
  }

  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
