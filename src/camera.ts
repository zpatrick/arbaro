import type { Bounds } from "./tree";
import { approach, clamp } from "./util";

/** Where the ground line sits, as a fraction of the view height from the top. */
const GROUND_LINE = 0.74;
/** Fraction of the sky kept clear above the top of the tree. */
const HEADROOM = 0.18;
/**
 * Fraction of the sky kept clear above the top of the tree however fast it grows, while the
 * camera eases back toward `HEADROOM`.
 */
const LEAST_HEADROOM = 0.06;
/** The camera never moves in closer than this much visible sky, in world units. */
const MIN_SKY = 2;
/** Widest the tree may get, as a fraction of the view width. */
const MAX_WIDTH = 0.84;
/** Seconds for the camera to settle after the tree changes shape. */
const SETTLE = 0.7;
/** Where the lowest height kept in view sits, as a fraction of the view height from the top. */
const FOOT = 0.93;
/** Furthest out and closest in the player can zoom, in CSS pixels per world unit. */
const ZOOM = { min: 1.5, max: 800 } as const;

/**
 * Maps world units (y up, ground at y = 0) to CSS pixels and frames the tree as it grows, until
 * the player pans or zooms, after which it stays where they put it until released.
 */
export class Camera {
  width = 1;
  height = 1;
  dpr = 1;
  /** CSS pixel row of the ground line, aligned to a device pixel so the ground edge stays crisp. */
  groundY = 0;
  /** World x at the horizontal center of the view. */
  centerX = 0;
  /**
   * World height shown on the ground line's row. Zero while the camera frames the tree on level
   * ground; lower where it keeps ground below the tree in view.
   */
  floor = 0;
  /** CSS pixels per world unit. */
  scale = 1;
  /** World height of the horizon, where the land or the sea far off meets the sky. */
  horizon = 0;
  /**
   * While framing the tree, the lowest world height kept in view, if below the ground the tree
   * stands on, and how far right of the tree's roots the view reaches at least.
   */
  depth = 0;
  reach = 0;
  /** Whether the player has moved the camera, so it stays put instead of following the tree. */
  held = false;
  /** Whether the player has dragged the view since the camera last framed the tree. */
  panned = false;

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.groundY = Math.round(height * GROUND_LINE * dpr) / dpr;
  }

  /**
   * CSS pixel row of the ground the tree is planted on, at height zero, which moves off the
   * ground line as the view pans.
   */
  get groundRow(): number {
    return this.groundY + this.floor * this.scale;
  }

  /** CSS pixel row of the horizon. */
  get horizonRow(): number {
    return this.groundY - (this.horizon - this.floor) * this.scale;
  }

  follow(bounds: Bounds, dt: number): void {
    if (this.held) {
      return;
    }
    const target = this.targetFor(bounds);
    // Zoom eases in log space so pulling back feels even at every size, but never so slowly that
    // a young tree shooting up runs out of the top of the view.
    this.scale = Math.min(
      Math.exp(
        approach(Math.log(this.scale), Math.log(target.scale), SETTLE, dt),
      ),
      (this.groundY * (1 - LEAST_HEADROOM)) /
        Math.max(bounds.maxY - this.floor, 1e-6),
    );
    this.centerX = approach(this.centerX, target.centerX, SETTLE, dt);
    this.floor = approach(this.floor, target.floor, SETTLE, dt);
  }

  snap(bounds: Bounds): void {
    const target = this.targetFor(bounds);
    this.held = false;
    this.panned = false;
    this.scale = target.scale;
    this.centerX = target.centerX;
    this.floor = target.floor;
  }

  /** Moves the view by (dx, dy) CSS pixels, as when dragged, and stops following the tree. */
  pan(dx: number, dy: number): void {
    this.held = true;
    this.panned = true;
    this.centerX -= dx / this.scale;
    this.floor += dy / this.scale;
  }

  /**
   * Zooms in by `factor` around (x, y) in CSS pixels, keeping whatever is under that point in
   * place, and stops following the tree.
   */
  zoom(factor: number, x: number, y: number): void {
    this.held = true;
    const anchor = this.toWorld(x, y);
    this.scale = clamp(this.scale * factor, ZOOM.min, ZOOM.max);
    this.centerX = anchor.x - (x - this.width / 2) / this.scale;
    this.floor = anchor.y - (this.groundY - y) / this.scale;
  }

  /** Goes back to framing the tree, easing over from wherever the player left the view. */
  release(): void {
    this.held = false;
    this.panned = false;
  }

  toScreen(x: number, y: number): { x: number; y: number } {
    return {
      x: this.width / 2 + (x - this.centerX) * this.scale,
      y: this.groundY - (y - this.floor) * this.scale,
    };
  }

  toWorld(x: number, y: number): { x: number; y: number } {
    return {
      x: this.centerX + (x - this.width / 2) / this.scale,
      y: this.floor + (this.groundY - y) / this.scale,
    };
  }

  /** Canvas transform that draws world coordinates directly, in device pixels. */
  worldTransform(): DOMMatrix {
    const s = this.scale * this.dpr;
    return new DOMMatrix([
      s,
      0,
      0,
      -s,
      (this.width / 2 - this.centerX * this.scale) * this.dpr,
      this.groundRow * this.dpr,
    ]);
  }

  /**
   * How to frame `bounds`: on level ground, with the ground on the ground line and the tree in the
   * sky above it; with ground falling away below the tree, the lowest of it near the foot of the
   * view and the tree above, reaching right as far as asked.
   */
  private targetFor(bounds: Bounds): {
    scale: number;
    centerX: number;
    floor: number;
  } {
    const maxX = Math.max(bounds.maxX, this.reach);
    const byWidth =
      (this.width * MAX_WIDTH) / Math.max(maxX - bounds.minX, 1e-6);
    const centerX = (bounds.minX + maxX) / 2;
    if (this.depth >= 0) {
      const sky = this.groundY * (1 - HEADROOM);
      const byHeight = sky / Math.max(MIN_SKY, bounds.maxY);
      return { scale: Math.min(byHeight, byWidth), centerX, floor: 0 };
    }
    const rows = this.height * FOOT - this.groundY * HEADROOM;
    const byHeight = rows / (Math.max(MIN_SKY, bounds.maxY) - this.depth);
    const scale = Math.min(byHeight, byWidth);
    return {
      scale,
      centerX,
      floor: this.depth + (this.height * FOOT - this.groundY) / scale,
    };
  }
}
