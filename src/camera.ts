import type { Bounds } from "./tree";
import { approach, clamp } from "./util";

/** Where the ground line sits, as a fraction of the view height from the top. */
const GROUND_LINE = 0.74;
/** Fraction of the sky kept clear above the top of the tree. */
const HEADROOM = 0.18;
/** The camera never moves in closer than this much visible sky, in world units. */
const MIN_SKY = 9;
/** Widest the tree may get, as a fraction of the view width. */
const MAX_WIDTH = 0.84;
/** Seconds for the camera to settle after the tree changes shape. */
const SETTLE = 0.7;
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
  /** World height shown on the ground line's row. Zero while the camera frames the tree. */
  floor = 0;
  /** CSS pixels per world unit. */
  scale = 1;
  /** Whether the player has moved the camera, so it stays put instead of following the tree. */
  held = false;

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.groundY = Math.round(height * GROUND_LINE * dpr) / dpr;
  }

  /** CSS pixel row where the ground begins, which moves off the ground line as the view pans. */
  get groundRow(): number {
    return this.groundY + this.floor * this.scale;
  }

  follow(bounds: Bounds, dt: number): void {
    if (this.held) {
      return;
    }
    const target = this.targetFor(bounds);
    // Zoom eases in log space so pulling back feels even at every size.
    this.scale = Math.exp(
      approach(Math.log(this.scale), Math.log(target.scale), SETTLE, dt),
    );
    this.centerX = approach(this.centerX, target.centerX, SETTLE, dt);
    this.floor = approach(this.floor, 0, SETTLE, dt);
  }

  snap(bounds: Bounds): void {
    const target = this.targetFor(bounds);
    this.held = false;
    this.scale = target.scale;
    this.centerX = target.centerX;
    this.floor = 0;
  }

  /** Moves the view by (dx, dy) CSS pixels, as when dragged, and stops following the tree. */
  pan(dx: number, dy: number): void {
    this.held = true;
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

  private targetFor(bounds: Bounds): { scale: number; centerX: number } {
    const sky = this.groundY * (1 - HEADROOM);
    const byHeight = sky / Math.max(MIN_SKY, bounds.maxY);
    const byWidth =
      (this.width * MAX_WIDTH) / Math.max(bounds.maxX - bounds.minX, 1e-6);
    return {
      scale: Math.min(byHeight, byWidth),
      centerX: (bounds.minX + bounds.maxX) / 2,
    };
  }
}
