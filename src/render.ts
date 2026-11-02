import type { Camera } from "./camera";
import type { Debris } from "./debris";
import type { Dot } from "./flow";
import {
  drawFlower,
  drawMarks,
  type FlowerLook,
  inDetail,
  stalkFit,
} from "./flower-art";
import {
  type FlowerHover,
  type FlowerView,
  middleReach,
  type Stalk,
} from "./flowers";
import type { Limb } from "./limb";
import { BARN_LINE, barnLines, barnOutline } from "./barn";
import { Mountains } from "./mountains";
import { PALETTE } from "./palette";
import { PHYSICS } from "./physics";
import { css, type Rgb, type SkyBody, type SkyLight } from "./sky";
import { FLARE, type Pick, type Tree } from "./tree";
import { at, clamp, invariant, lerp, Rng, smoothstep } from "./util";

/** No limb renders thinner than this many CSS pixels across, so tips survive zooming out. */
const MIN_WIDTH_PX = 1.1;
/** Strength of the pale sand grain over every ink shape. */
const INK_GRAIN = 0.075;
/** Length of the root flare's ground-side handle, as a fraction of how far the flare spreads. */
const FLARE_HUG = 0.6;
/** Length of the root flare's trunk-side handle, as a fraction of the height where it joins the trunk. */
const FLARE_LIFT = 0.5;
/** Fillet in the narrow corner above an offshoot, in offshoot radii along each edge. */
const CROTCH_FILLET = 2.4;
/** Fillet in the wide corner beneath an offshoot, in offshoot radii along each edge. */
const COLLAR_FILLET = 1.6;
/** Shape of a fillet's curve: 0 cuts the corner straight across and 1 leaves it sharp. */
const FILLET_ROUNDNESS = 0.55;
/** Ring around the tip being grown, in CSS pixels. */
const TIP_RING_PX = 9;
/** Length of the line previewing where a fork will grow, in CSS pixels. */
const FORK_PREVIEW_PX = 22;
/** Strain shows once the wood carries this fraction of what it can take. */
const STRAIN_SHOWN = 0.3;
/** Width of the strain vein at the breaking point, as a fraction of the limb's width. */
const VEIN_WIDTH = 0.22;
/** Thinnest the strain vein is drawn, in CSS pixels. */
const VEIN_MIN_PX = 0.7;
/** Length of each stretch of vein drawn, in CSS pixels. Short enough that its width and color change smoothly. */
const VEIN_STEP_PX = 3;
/** Soft glow around the strain vein, in CSS pixels, and how strongly it shows. */
const VEIN_GLOW = { px: 4, strength: 0.6 } as const;
/** The glow is blurred at this fraction of the canvas's resolution; being soft, it loses nothing. */
const GLOW_SCALE = 1 / 4;
/**
 * Colors the strain vein moves through as strain rises: a shade lighter than the wood, pale
 * sand, ember at the breaking point, and hot past it.
 */
const VEIN = {
  wood: [42, 33, 26],
  sand: [214, 200, 174],
  ember: [255, 140, 66],
  hot: [255, 84, 52],
} as const;
/** Radius of the gauge marking each spout, in CSS pixels. */
const SPOUT_PX = 5.5;
/** An energy dot leaving the roots is this fraction of the trunk's radius at the ground. */
const DOT_SIZE = 0.32;
/** An energy dot never fills more of the wood it rides in than this fraction of its radius. */
const DOT_FILL = 0.42;
/** Smallest energy dot drawn, in CSS pixels. */
const DOT_MIN_PX = 0.9;
/**
 * Under a cluster painted as marks, its stalk runs on past the cluster's base this fraction of the
 * way to its middle, so the marks sit on it rather than beyond its end.
 */
const STALK_INTO = 0.6;
/** Stars in the night sky, and how many of them are bright enough to sparkle. */
const STARS = { count: 170, bright: 14 } as const;
/** Radius of the sun and of the moon, as fractions of the view's height. */
const SUN_SIZE = 0.04;
const MOON_SIZE = 0.019;
/** Highest the sun and moon climb, as a fraction of the view's height below its top. */
const SKY_TOP = 0.075;
/** How far apart the sun rises and sets, as a fraction of the view's width. */
const SKY_SPAN = 0.88;
/**
 * How far right of center the sun and moon are at their highest, as a fraction of the view's
 * width, so they pass beside the top of the tree rather than behind it.
 */
const SKY_LEAN = 0.13;
/** How strongly the lines carved into the barn show, and their thinnest, in CSS pixels. */
const BARN_LINE_ALPHA = 0.5;
const BARN_LINE_MIN_PX = 0.7;
const STARLIGHT: Rgb = [240, 236, 222];
const MOONLIGHT: Rgb = [238, 233, 214];
/** The haze around the moon, a touch bluer than the moon itself. */
const MOON_HAZE: Rgb = [214, 222, 242];

/** Everything drawn in one frame. */
export interface Scene {
  /** The light at this time of day. */
  light: SkyLight;
  /** Seconds of simulated time, which set the stars twinkling. */
  clock: number;
  /** The standing tree, if there is one. */
  tree: Tree | undefined;
  /** Pieces that broke or were cut off, falling or lying on the ground. */
  debris: readonly Debris[];
  hover: Pick | undefined;
  /** Whether to mark how close each joint is to breaking. */
  strain: boolean;
  /** Flowers on the tree, then those that came off it. */
  flowers: readonly FlowerView[];
  /** What a shift-click would do to the flowers, while one is being lined up. */
  flowerHover: FlowerHover | undefined;
  /** In flow mode: the energy dots riding up the wood, and the spouts to mark. */
  flow:
    | {
        dots: readonly Dot[];
        /** The offshoot whose spout the pointer is over, if any. */
        hoveredSpout: Limb | undefined;
        /** The offshoot whose spout is open for editing, if any. */
        openSpout: Limb | undefined;
      }
    | undefined;
}

/** Thinnest a limb's radius can be drawn at the camera's zoom, in world units. */
export function minimumRadius(camera: Camera): number {
  return MIN_WIDTH_PX / 2 / camera.scale;
}

interface Vec {
  x: number;
  y: number;
}

/** A star, placed across the sky as fractions of the view's width and of the height of its sky. */
interface Star {
  x: number;
  y: number;
  /** Radius in CSS pixels. */
  size: number;
  brightness: number;
  /** How fast it twinkles, in radians per second, and where in its twinkle it starts. */
  rate: number;
  phase: number;
  /** Whether it is one of the few bright enough to sparkle. */
  sparkles: boolean;
}

interface EdgePoint extends Vec {
  /** Unit tangent of the centerline at this point, pointing toward the tip. */
  tx: number;
  ty: number;
  /** Distance along the limb's centerline. */
  s: number;
}

interface Edges {
  left: EdgePoint[];
  right: EdgePoint[];
}

/** A point along an edge, with the direction the edge runs there. */
interface EdgeStep extends Vec {
  tx: number;
  ty: number;
}

interface Crossing {
  point: Vec;
  /** Index of the first offshoot edge point past the crossing. */
  childNext: number;
  parentEdge: readonly EdgePoint[];
  /** Which of the parent's edges was crossed: 1 for its left, -1 for its right. */
  parentSide: 1 | -1;
  /** The crossing lies between this parent edge point and the next one. */
  parentIndex: number;
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly grain: CanvasPattern;
  private resized = false;
  private readonly stars: Star[];
  private readonly mountains = new Mountains();
  private readonly barn = { outline: barnOutline(), lines: barnLines() };
  /** Ink of the wood and ground in this frame's light. */
  private inkColor: string = PALETTE.ink;
  /** Ink of the guides drawn over the scene in this frame's light. */
  private guideColor: string = PALETTE.ink;
  /** Where the strain veins are drawn before they are laid into the wood with their glow. */
  private readonly veins: HTMLCanvasElement;
  private readonly veinCtx: CanvasRenderingContext2D;
  /** The veins' glow, blurred at low resolution. */
  private readonly glow: HTMLCanvasElement;
  private readonly glowCtx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    invariant(ctx !== null, "Canvas 2D is not available.");
    this.ctx = ctx;
    const grain = ctx.createPattern(grainTile(), "repeat");
    invariant(grain !== null, "Could not create the grain pattern.");
    this.grain = grain;
    this.veins = document.createElement("canvas");
    const veinCtx = this.veins.getContext("2d");
    invariant(
      veinCtx !== null,
      "Canvas 2D is not available for the strain veins.",
    );
    this.veinCtx = veinCtx;
    this.glow = document.createElement("canvas");
    const glowCtx = this.glow.getContext("2d");
    invariant(
      glowCtx !== null,
      "Canvas 2D is not available for the strain glow.",
    );
    this.glowCtx = glowCtx;
    const rng = new Rng(11);
    this.stars = Array.from({ length: STARS.count }, (_, i) => ({
      x: rng.next(),
      y: Math.pow(rng.next(), 1.3),
      size: 0.5 + 0.8 * Math.pow(rng.next(), 3),
      brightness: 0.6 + 0.4 * rng.next(),
      rate: 0.6 + 1.8 * rng.next(),
      phase: rng.next() * Math.PI * 2,
      sparkles: i < STARS.bright,
    }));
  }

  resize(camera: Camera): void {
    this.canvas.width = Math.round(camera.width * camera.dpr);
    this.canvas.height = Math.round(camera.height * camera.dpr);
    this.veins.width = this.canvas.width;
    this.veins.height = this.canvas.height;
    this.glow.width = Math.ceil(this.canvas.width * GLOW_SCALE);
    this.glow.height = Math.ceil(this.canvas.height * GLOW_SCALE);
    this.resized = true;
  }

  /** Draws in device pixels throughout so every ink shape shares one grain. */
  draw(camera: Camera, scene: Scene): void {
    invariant(this.resized, "Renderer.resize must run before draw.");
    const width = this.canvas.width;
    // The ground begins wherever height zero falls, which moves as the view pans.
    const ground = clamp(camera.groundRow * camera.dpr, 0, this.canvas.height);
    this.inkColor = css(scene.light.ink);
    this.guideColor = css(scene.light.guide);

    this.drawSky(camera, scene.light, scene.clock, ground);
    const world = camera.worldTransform();
    this.drawBarn(camera, world, scene.light);

    // Every ink shape is wound the same way and filled in one pass, so overlapping limbs read as
    // one silhouette and the grain lands on each pixel of ink exactly once. Fallen pieces join
    // in, so one lying on the ground merges into it.
    const ink = new Path2D();
    ink.rect(0, ground, width, this.canvas.height - ground);
    if (scene.tree !== undefined) {
      for (const shape of treeShapes(scene.tree, minimumRadius(camera))) {
        ink.addPath(shape, world);
      }
    }
    const fading: Debris[] = [];
    for (const piece of scene.debris) {
      if (piece.alpha < 1) {
        fading.push(piece);
        continue;
      }
      const placed = world.multiply(piece.transform);
      for (const shape of piece.shapes) {
        ink.addPath(shape, placed);
      }
    }
    this.fillInk(ink, 1);
    // A fading piece needs its own fill to be see-through.
    for (const piece of fading) {
      const path = new Path2D();
      const placed = world.multiply(piece.transform);
      for (const shape of piece.shapes) {
        path.addPath(shape, placed);
      }
      this.fillInk(path, piece.alpha);
    }

    if (scene.tree !== undefined) {
      if (scene.strain) {
        this.drawStrain(camera, scene.tree, ink);
      }
      if (scene.flow !== undefined) {
        this.drawDots(camera, scene.tree, scene.flow.dots);
      }
    }
    const shown = scene.flowers.filter((flower) => inView(camera, flower));
    const looks = shown.map((flower) =>
      lookOf(camera, flower, scene.light.flowerLight),
    );
    const detailed = inDetail(looks, {
      x: camera.width / 2,
      y: camera.height / 2,
    });
    // Every stalk first, so the flowers cover the stalks of their neighbors.
    this.drawStalks(camera, shown, (i) => at(detailed, i));
    // Those clusters are painted together, under the flowers drawn in detail.
    drawMarks(
      this.ctx,
      camera.dpr,
      looks.filter((_, i) => !at(detailed, i)),
    );
    for (const [i, look] of looks.entries()) {
      if (at(detailed, i)) {
        drawFlower(this.ctx, camera.dpr, look);
      }
    }
    if (scene.tree !== undefined) {
      if (scene.flow !== undefined) {
        this.drawSpouts(
          camera,
          scene.tree,
          scene.flow.hoveredSpout,
          scene.flow.openSpout,
        );
      }
      this.drawGuides(camera, scene.tree, scene.hover);
    }
    if (scene.flowerHover?.ghost !== undefined) {
      const { ghost } = scene.flowerHover;
      this.drawStalks(camera, [ghost], () => true);
      drawFlower(
        this.ctx,
        camera.dpr,
        lookOf(camera, ghost, scene.light.flowerLight),
      );
    }
    if (scene.flowerHover?.target !== undefined) {
      const { target } = scene.flowerHover;
      const reach = middleReach(target.clusters) * target.size;
      const middle = camera.toScreen(
        target.x + Math.cos(target.angle) * reach,
        target.y + Math.sin(target.angle) * reach,
      );
      this.ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
      this.ctx.lineWidth = 1.25;
      this.ring(middle, 0.55, 0.62 * target.size * camera.scale + 3);
    }
  }

  /**
   * Fills the sky above `ground`, in device pixels, for the time of day: a glow over the middle of
   * the horizon, the stars, moon and sun, the mountains in front of them, and warm light on the
   * sun's side at sunrise and sunset.
   */
  private drawSky(
    camera: Camera,
    light: SkyLight,
    clock: number,
    ground: number,
  ): void {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const cx = width * 0.5;
    const cy = camera.groundRow * camera.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const sky = ctx.createRadialGradient(
      cx,
      cy,
      0,
      cx,
      cy,
      Math.hypot(cx, camera.groundY * camera.dpr) * 1.05,
    );
    sky.addColorStop(0, css(light.sky.glow));
    sky.addColorStop(0.55, css(light.sky.middle));
    sky.addColorStop(1, css(light.sky.edge));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, ground);


    ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
    if (light.daylight < 1) {
      this.drawStars(camera, 1 - light.daylight, clock);
    }
    if (light.moon.height > -0.2) {
      this.drawMoon(
        this.bodyAt(camera, light.moon),
        MOON_SIZE * camera.height,
        light,
      );
    }
    if (light.sun.height > -0.2) {
      const sun = this.bodyAt(camera, light.sun);
      ctx.fillStyle = css(light.sunColor);
      ctx.beginPath();
      ctx.arc(sun.x, sun.y, SUN_SIZE * camera.height, 0, Math.PI * 2);
      ctx.fill();
    }
    this.mountains.draw(ctx, camera, sky, light);

    // The glow of sunrise and sunset lies over everything in the sky, the mountains too.
    if (light.twilight > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const rising = light.sun.along < 0.5 || light.sun.along > 1.5;
      const x = cx + (rising ? -1 : 1) * cx * SKY_SPAN;
      const radius = width * 0.9;
      const glow = ctx.createRadialGradient(x, cy, 0, x, cy, radius);
      glow.addColorStop(0, css(light.twilightColor, 0.75 * light.twilight));
      glow.addColorStop(1, css(light.twilightColor, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, ground);
      const band = ctx.createLinearGradient(
        0,
        cy,
        0,
        cy - this.canvas.height * 0.4,
      );
      band.addColorStop(0, css(light.twilightColor, 0.35 * light.twilight));
      band.addColorStop(1, css(light.twilightColor, 0));
      ctx.fillStyle = band;
      ctx.fillRect(0, 0, width, ground);
    }
  }

  /** Where the sun or moon is on screen, in CSS pixels, on its arc from horizon to horizon. */
  private bodyAt(camera: Camera, body: SkyBody): Vec {
    const angle = Math.PI * (1 - body.along);
    const rise = camera.groundY - SKY_TOP * camera.height;
    return {
      x:
        camera.width *
        (0.5 + 0.5 * SKY_SPAN * Math.cos(angle) + SKY_LEAN * Math.sin(angle)),
      y: camera.groundRow - rise * Math.sin(angle),
    };
  }

  /** Stars fading in as the light goes, dimmer toward the horizon, each twinkling at its own pace. */
  private drawStars(camera: Camera, darkness: number, clock: number): void {
    const ctx = this.ctx;
    for (const star of this.stars) {
      const x = star.x * camera.width;
      const y = star.y * camera.groundY;
      const horizon = smoothstep(
        camera.groundRow,
        camera.groundRow - 0.35 * camera.groundY,
        y,
      );
      const twinkle = 0.7 + 0.3 * Math.sin(clock * star.rate + star.phase);
      const alpha = darkness * horizon * twinkle * star.brightness;
      if (alpha <= 0.01) {
        continue;
      }
      ctx.fillStyle = css(STARLIGHT, alpha);
      ctx.beginPath();
      ctx.arc(x, y, star.size, 0, Math.PI * 2);
      ctx.fill();
      if (star.sparkles) {
        const reach = star.size * 4.5;
        ctx.strokeStyle = css(STARLIGHT, alpha * 0.6);
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(x - reach, y);
        ctx.lineTo(x + reach, y);
        ctx.moveTo(x, y - reach);
        ctx.lineTo(x, y + reach);
        ctx.stroke();
      }
    }
  }

  /** A crescent moon in a soft haze, fading as the day comes. */
  private drawMoon(center: Vec, radius: number, light: SkyLight): void {
    const ctx = this.ctx;
    const fade = 1 - 0.7 * light.daylight;
    const haze = ctx.createRadialGradient(
      center.x,
      center.y,
      radius * 0.6,
      center.x,
      center.y,
      radius * 4,
    );
    haze.addColorStop(0, css(MOON_HAZE, 0.22 * fade));
    haze.addColorStop(1, css(MOON_HAZE, 0));
    ctx.fillStyle = haze;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius * 4, 0, Math.PI * 2);
    ctx.fill();
    // The dark of the moon still shows faintly.
    ctx.fillStyle = css(MOONLIGHT, 0.1 * fade);
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fill();
    // The lit crescent lies between the moon's edge and the edge of the shadow over it.
    const offset = radius * 0.62;
    const half = Math.sqrt(radius * radius - (offset / 2) * (offset / 2));
    const outer = Math.atan2(half, offset / 2);
    const inner = Math.atan2(half, -offset / 2);
    ctx.fillStyle = css(MOONLIGHT, fade);
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, -outer, outer, true);
    ctx.arc(center.x + offset, center.y, radius, inner, -inner, false);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * Draws the stalks the flowers grow on, filling all those equally see-through at once. Under a
   * flower painted as marks, one `detailed` does not pick out, the stalk runs on into it.
   */
  private drawStalks(
    camera: Camera,
    flowers: readonly FlowerView[],
    detailed: (i: number) => boolean,
  ): void {
    const paths = new Map<number, Path2D>();
    for (const [i, flower] of flowers.entries()) {
      if (flower.stalk === undefined) {
        continue;
      }
      let path = paths.get(flower.alpha);
      if (path === undefined) {
        path = new Path2D();
        paths.set(flower.alpha, path);
      }
      const into = detailed(i)
        ? 0
        : STALK_INTO * middleReach(flower.clusters) * flower.size;
      addStalk(path, camera, flower, flower.stalk, into * camera.scale);
    }
    const ctx = this.ctx;
    ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
    ctx.fillStyle = this.inkColor;
    for (const [alpha, path] of paths) {
      ctx.globalAlpha = alpha;
      ctx.fill(path);
    }
    ctx.globalAlpha = 1;
  }

  /** Draws each energy dot as pale light inside the wood it rides in. */
  private drawDots(camera: Camera, tree: Tree, dots: readonly Dot[]): void {
    const ctx = this.ctx;
    ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
    ctx.fillStyle = PALETTE.paperGlow;
    ctx.globalAlpha = 0.72;
    const largest = DOT_SIZE * tree.root.radiusAt(0);
    for (const dot of dots) {
      const r = Math.min(
        DOT_FILL * dot.limb.radiusAt(dot.s),
        largest * Math.sqrt(dot.amount),
      );
      const radius = r * camera.scale;
      if (radius < DOT_MIN_PX) {
        continue;
      }
      const p = dot.limb.pointAt(dot.s);
      const center = camera.toScreen(p.x, p.y);
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Marks every fork with a small gauge: a ring whose dark wedge is the share of the flow its
   * spout sends into the offshoot.
   */
  private drawSpouts(
    camera: Camera,
    tree: Tree,
    hovered: Limb | undefined,
    open: Limb | undefined,
  ): void {
    const ctx = this.ctx;
    ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
    for (const limb of tree.limbs) {
      if (limb.attachment === undefined) {
        continue;
      }
      const p = limb.attachment.parent.pointAt(limb.attachment.s);
      const center = camera.toScreen(p.x, p.y);
      ctx.beginPath();
      ctx.arc(center.x, center.y, SPOUT_PX, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.paper;
      ctx.fill();
      ctx.lineWidth = limb === hovered || limb === open ? 1.8 : 1;
      ctx.strokeStyle = PALETTE.ink;
      ctx.stroke();
      if (limb.spout > 0) {
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        ctx.arc(
          center.x,
          center.y,
          SPOUT_PX - 1.8,
          -Math.PI / 2,
          -Math.PI / 2 + limb.spout * Math.PI * 2,
        );
        ctx.closePath();
        ctx.fillStyle = PALETTE.ink;
        ctx.fill();
      }
    }
  }

  /**
   * The barn beside the tree, in ink like the tree and behind it, with its lines carved through
   * the ink to the sky's color beneath.
   */
  private drawBarn(camera: Camera, world: DOMMatrix, light: SkyLight): void {
    const outline = new Path2D();
    outline.addPath(this.barn.outline, world);
    this.fillInk(outline, 1);
    const ctx = this.ctx;
    ctx.setTransform(world);
    ctx.strokeStyle = css(light.sky.middle, BARN_LINE_ALPHA);
    ctx.lineWidth = Math.max(BARN_LINE, BARN_LINE_MIN_PX / camera.scale);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(this.barn.lines);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Fills `path`, given in device pixels, with ink and its grain. */
  private fillInk(path: Path2D, alpha: number): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.inkColor;
    ctx.fill(path);
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = INK_GRAIN * alpha;
    ctx.fillStyle = this.grain;
    ctx.fill(path);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  /**
   * Shows strain as a vein carved down the middle of each limb, widening and brightening from a
   * hairline as the wood takes more, and warming to ember at its breaking point. A soft glow sits
   * around it, and both stay inside the wood.
   */
  private drawStrain(camera: Camera, tree: Tree, ink: Path2D): void {
    const veins = this.veinCtx;
    veins.setTransform(1, 0, 0, 1, 0, 0);
    veins.clearRect(0, 0, this.veins.width, this.veins.height);
    veins.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
    veins.lineCap = "round";
    // Only the area the veins cover is blurred and laid into the wood, in CSS pixels.
    const covered = {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    };
    for (const limb of tree.limbs) {
      const strains = tree.physics.strains(limb);
      // A limb grown since the last physics step has not been weighed yet.
      if (strains === undefined) {
        continue;
      }
      const points = limb.points;
      let from = at(points, 0);
      let a = camera.toScreen(from.x, from.y);
      for (let i = 1; i < points.length; i += 1) {
        const to = at(points, i);
        const b = camera.toScreen(to.x, to.y);
        if (
          i < points.length - 1 &&
          Math.hypot(b.x - a.x, b.y - a.y) < VEIN_STEP_PX
        ) {
          continue;
        }
        const s = (from.s + to.s) / 2;
        const strain = strainAlong(strains, s, limb.length);
        if (strain > STRAIN_SHOWN) {
          const width = Math.max(
            VEIN_MIN_PX,
            2 * limb.radiusAt(s) * camera.scale * veinWidth(strain),
          );
          veins.strokeStyle = veinColor(strain);
          veins.lineWidth = width;
          veins.beginPath();
          veins.moveTo(a.x, a.y);
          veins.lineTo(b.x, b.y);
          veins.stroke();
          covered.minX = Math.min(covered.minX, a.x - width, b.x - width);
          covered.minY = Math.min(covered.minY, a.y - width, b.y - width);
          covered.maxX = Math.max(covered.maxX, a.x + width, b.x + width);
          covered.maxY = Math.max(covered.maxY, a.y + width, b.y + width);
        }
        from = to;
        a = b;
      }
    }
    if (covered.minX > covered.maxX) {
      return;
    }
    // Room for the glow to spread, in device pixels, clamped to the canvas.
    const margin = 3 * VEIN_GLOW.px;
    const x = Math.max(0, Math.floor((covered.minX - margin) * camera.dpr));
    const y = Math.max(0, Math.floor((covered.minY - margin) * camera.dpr));
    const w =
      Math.min(
        this.veins.width,
        Math.ceil((covered.maxX + margin) * camera.dpr),
      ) - x;
    const h =
      Math.min(
        this.veins.height,
        Math.ceil((covered.maxY + margin) * camera.dpr),
      ) - y;
    if (w <= 0 || h <= 0) {
      return;
    }
    // Shrink the veins into the glow canvas, blurring them on the way.
    const glow = this.glowCtx;
    glow.setTransform(1, 0, 0, 1, 0, 0);
    glow.clearRect(0, 0, this.glow.width, this.glow.height);
    glow.filter = `blur(${VEIN_GLOW.px * camera.dpr * GLOW_SCALE}px)`;
    const [gx, gy, gw, gh] = [
      x * GLOW_SCALE,
      y * GLOW_SCALE,
      w * GLOW_SCALE,
      h * GLOW_SCALE,
    ];
    glow.drawImage(this.veins, x, y, w, h, gx, gy, gw, gh);
    glow.filter = "none";

    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clip(ink);
    ctx.globalAlpha = VEIN_GLOW.strength;
    ctx.drawImage(this.glow, gx, gy, gw, gh, x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.veins, x, y, w, h, x, y, w, h);
    ctx.restore();
  }

  /** Marks the limb being grown, and previews what a click would do. */
  private drawGuides(
    camera: Camera,
    tree: Tree,
    hover: Pick | undefined,
  ): void {
    const ctx = this.ctx;
    ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
    ctx.lineWidth = 1.25;
    ctx.lineCap = "round";
    if (tree.limbs.length > 1) {
      const tip = tree.active.tip;
      this.ring(camera.toScreen(tip.x, tip.y), 0.55);
    }
    if (hover === undefined) {
      return;
    }
    if (hover.limb !== tree.active) {
      const tip = hover.limb.tip;
      this.ring(camera.toScreen(tip.x, tip.y), 0.25);
      return;
    }
    const s = tree.forkPoint(hover.limb, hover.s);
    const from = hover.limb.pointAt(s);
    // The fork heading is worked out on the grown shape; turn it by however far the limb has swayed.
    const heading =
      tree.forkHeading(hover.limb, s, hover.side) +
      from.heading -
      hover.limb.restPointAt(s).heading;
    const start = camera.toScreen(from.x, from.y);
    ctx.strokeStyle = this.guideColor;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(
      start.x + Math.cos(heading) * FORK_PREVIEW_PX,
      start.y - Math.sin(heading) * FORK_PREVIEW_PX,
    );
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(start.x, start.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.paper;
    ctx.fill();
    ctx.stroke();
  }

  private ring(center: Vec, alpha: number, radius = TIP_RING_PX): void {
    const ctx = this.ctx;
    ctx.strokeStyle = this.guideColor;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/** How a flower shows in the view, in the light of `light`. */
function lookOf(camera: Camera, flower: FlowerView, light: Rgb): FlowerLook {
  const base = camera.toScreen(flower.x, flower.y);
  return {
    x: base.x,
    y: base.y,
    angle: flower.angle,
    size: flower.size * camera.scale,
    clusters: flower.clusters,
    openness: flower.openness,
    age: flower.age,
    alpha: flower.alpha,
    variant: flower.variant,
    exposure: flower.exposure,
    light,
  };
}

/** Whether any of a flower or its stalk could show in the view. */
function inView(camera: Camera, flower: FlowerView): boolean {
  const base = camera.toScreen(flower.x, flower.y);
  // A flower reaches no further than its size from its base, whichever way it faces.
  const reach = flower.size * camera.scale;
  let left = base.x - reach;
  let right = base.x + reach;
  let top = base.y - reach;
  let bottom = base.y + reach;
  if (flower.stalk !== undefined) {
    // The stalk's curve lies within the hull of its ends and controls.
    for (const point of [flower.stalk.from, ...flower.stalk.controls]) {
      const p = camera.toScreen(point.x, point.y);
      left = Math.min(left, p.x);
      right = Math.max(right, p.x);
      top = Math.min(top, p.y);
      bottom = Math.max(bottom, p.y);
    }
  }
  return (
    right >= 0 && left <= camera.width && bottom >= 0 && top <= camera.height
  );
}

/**
 * Adds the outline of a flower's stalk to `path`, in CSS pixels: along its curve from inside the
 * wood to the flower's base, tapering from its root to its tip, then on `into` CSS pixels past
 * the base the way the flower faces, ending round.
 */
function addStalk(
  path: Path2D,
  camera: Camera,
  flower: FlowerView,
  stalk: Stalk,
  into: number,
): void {
  const fit = stalkFit(flower.size * camera.scale, flower.clusters);
  const root = 0.5 * stalk.root * camera.scale * fit;
  const tip = 0.5 * stalk.tip * camera.scale * fit;
  const [c1, c2] = stalk.controls;
  const p0 = camera.toScreen(stalk.from.x, stalk.from.y);
  const p1 = camera.toScreen(c1.x, c1.y);
  const p2 = camera.toScreen(c2.x, c2.y);
  const p3 = camera.toScreen(flower.x, flower.y);
  const hull =
    Math.hypot(p1.x - p0.x, p1.y - p0.y) +
    Math.hypot(p2.x - p1.x, p2.y - p1.y) +
    Math.hypot(p3.x - p2.x, p3.y - p2.y);
  // The flower faces along `angle`, counterclockwise with y up, so down the screen is -sin.
  const facing = { x: Math.cos(flower.angle), y: -Math.sin(flower.angle) };
  // Enough steps that the curve stays smooth however large it shows.
  const steps = clamp(Math.ceil(hull / 6), 2, 16);
  const left: Vec[] = [];
  const right: Vec[] = [];
  const offset = (p: Vec, along: Vec, half: number): void => {
    left.push({ x: p.x - along.y * half, y: p.y + along.x * half });
    right.push({ x: p.x + along.y * half, y: p.y - along.x * half });
  };
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    const point = {
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    };
    const dx =
      u * u * (p1.x - p0.x) + 2 * u * t * (p2.x - p1.x) + t * t * (p3.x - p2.x);
    const dy =
      u * u * (p1.y - p0.y) + 2 * u * t * (p2.y - p1.y) + t * t * (p3.y - p2.y);
    // A curve too small to show has no direction of its own; the flower's will do.
    const tangent = Math.hypot(dx, dy) > 1e-9 ? unit(dx, dy) : facing;
    // It thins quickly as it leaves the wood, then runs on fine to the flower.
    offset(point, tangent, tip + (root - tip) * u * u);
  }
  const end = {
    x: p3.x + facing.x * into,
    y: p3.y + facing.y * into,
  };
  const endHalf = into > 0 ? 0.7 * tip : tip;
  if (into > 0) {
    offset(end, facing, endHalf);
  }
  const ahead = Math.atan2(facing.y, facing.x);
  const first = at(left, 0);
  path.moveTo(first.x, first.y);
  for (const p of left.slice(1)) {
    path.lineTo(p.x, p.y);
  }
  path.arc(
    end.x,
    end.y,
    endHalf,
    ahead + Math.PI / 2,
    ahead - Math.PI / 2,
    true,
  );
  // Filling closes it; closing each outline here is slow once the path holds many stalks.
  for (const p of right.reverse()) {
    path.lineTo(p.x, p.y);
  }
}

/**
 * Strain at distance `s` along a limb, blended between the strains at its joints, and falling
 * away to nothing at the tip, which carries no load.
 */
function strainAlong(
  strains: readonly number[],
  s: number,
  length: number,
): number {
  const position = s / PHYSICS.jointSpacing;
  const i = Math.floor(position);
  if (i + 1 < strains.length) {
    return lerp(at(strains, i), at(strains, i + 1), position - i);
  }
  const last = (strains.length - 1) * PHYSICS.jointSpacing;
  const toTip =
    length > last ? clamp(1 - (s - last) / (length - last), 0, 1) : 0;
  return at(strains, strains.length - 1) * toTip;
}

/** Color of the strain vein at a strain, as a CSS color. */
function veinColor(strain: number): string {
  const lift = 0.2 + 0.8 * smoothstep(STRAIN_SHOWN, 0.85, strain);
  const heat = smoothstep(0.8, 1, strain);
  const burn = smoothstep(1, 1.3, strain);
  const channel = (k: 0 | 1 | 2): number => {
    const rising = lerp(VEIN.wood[k], VEIN.sand[k], lift);
    return Math.round(
      lerp(lerp(rising, VEIN.ember[k], heat), VEIN.hot[k], burn),
    );
  };
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

/** Width of the strain vein at a strain, as a fraction of the limb's width. */
function veinWidth(strain: number): number {
  return (
    VEIN_WIDTH * (0.15 + 0.85 * smoothstep(STRAIN_SHOWN, 1, strain)) +
    0.12 * smoothstep(1, 1.3, strain)
  );
}

/** Sparse pale specks on transparency, tiled over the ink. */
function grainTile(): HTMLCanvasElement {
  const size = 256;
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const ctx = tile.getContext("2d");
  invariant(ctx !== null, "Canvas 2D is not available for the grain tile.");
  const image = ctx.createImageData(size, size);
  const rng = new Rng(7);
  for (let i = 0; i < size * size; i += 1) {
    image.data[i * 4] = 244;
    image.data[i * 4 + 1] = 236;
    image.data[i * 4 + 2] = 220;
    image.data[i * 4 + 3] = Math.round(Math.pow(rng.next(), 2.4) * 255);
  }
  ctx.putImageData(image, 0, 0);
  return tile;
}

/**
 * Every shape that makes up the tree, in world coordinates and all wound clockwise: one outline
 * per limb plus the fillets that blend each offshoot into its parent.
 */
export function treeShapes(tree: Tree, minRadius: number): Path2D[] {
  const edges = new Map<Limb, Edges>();
  const shapes: Path2D[] = [];
  for (const limb of tree.limbs) {
    const own = {
      left: edge(limb, minRadius, 1),
      right: edge(limb, minRadius, -1),
    };
    edges.set(limb, own);
    if (limb.attachment === undefined) {
      shapes.push(rootOutline(tree, own, minRadius));
      continue;
    }
    shapes.push(limbOutline(limb, own, minRadius));
    const parent = edges.get(limb.attachment.parent);
    invariant(
      parent !== undefined,
      "A parent limb must be outlined before its offshoots.",
    );
    shapes.push(...forkFillets(limb, own, parent, minRadius));
  }
  return shapes;
}

/**
 * Shapes of everything beyond `s` on `limb`, in world coordinates: the rest of the limb, closed
 * straight across the cut, and every offshoot forked off past the cut, blended into its parent.
 */
export function pieceShapes(
  limb: Limb,
  s: number,
  minRadius: number,
): Path2D[] {
  const cut = {
    left: beyond(edge(limb, minRadius, 1), s),
    right: beyond(edge(limb, minRadius, -1), s),
  };
  const shapes = [limbOutline(limb, cut, minRadius)];
  const edges = new Map<Limb, Edges>([[limb, cut]]);
  const visit = (parent: Limb, parentEdges: Edges): void => {
    for (const child of parent.children) {
      invariant(
        child.attachment !== undefined,
        "An offshoot must fork off its parent.",
      );
      if (parent === limb && child.attachment.s < s) {
        continue;
      }
      const own = {
        left: edge(child, minRadius, 1),
        right: edge(child, minRadius, -1),
      };
      edges.set(child, own);
      shapes.push(
        limbOutline(child, own, minRadius),
        ...forkFillets(child, own, parentEdges, minRadius),
      );
      visit(child, own);
    }
  };
  visit(limb, cut);
  return shapes;
}

/** The part of an edge from distance `s` on, starting with a point exactly at `s`. */
function beyond(points: readonly EdgePoint[], s: number): EdgePoint[] {
  const index = points.findIndex((p) => p.s >= s);
  invariant(index >= 0, `Nothing on this edge lies past ${s}.`);
  if (index === 0) {
    return [...points];
  }
  const a = at(points, index - 1);
  const b = at(points, index);
  const t = (s - a.s) / (b.s - a.s);
  const start = {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    tx: b.tx,
    ty: b.ty,
    s,
  };
  return [start, ...points.slice(index)];
}

/**
 * The trunk's silhouette: the root flare rising out of the ground on the left, up the left edge,
 * around the tip, down the right edge and back down through the right flare. It closes along
 * the ground line, where the ground takes over.
 */
function rootOutline(
  tree: Tree,
  { left, right }: Edges,
  minRadius: number,
): Path2D {
  const trunk = tree.root;
  const baseRadius = Math.max(minRadius, trunk.radiusAt(0));
  const maxRise = 0.3 * trunk.restTip.y;
  const leftSpread = FLARE.spread * baseRadius * tree.flare.left;
  const rightSpread = FLARE.spread * baseRadius * tree.flare.right;
  const leftJoin = firstAbove(
    left,
    Math.min(FLARE.rise * baseRadius * tree.flare.left, maxRise),
  );
  const rightJoin = firstAbove(
    right,
    Math.min(FLARE.rise * baseRadius * tree.flare.right, maxRise),
  );
  const groundLeft = at(left, 0).x - leftSpread;
  const groundRight = at(right, 0).x + rightSpread;

  const path = new Path2D();
  path.moveTo(groundLeft, 0);
  const lj = at(left, leftJoin);
  const leftLift = lj.y * FLARE_LIFT;
  path.bezierCurveTo(
    groundLeft + leftSpread * FLARE_HUG,
    0,
    lj.x - lj.tx * leftLift,
    lj.y - lj.ty * leftLift,
    lj.x,
    lj.y,
  );
  smoothThrough(path, left.slice(leftJoin));
  tipCap(path, trunk, minRadius);
  smoothThrough(path, right.slice(rightJoin).reverse());
  const rj = at(right, rightJoin);
  const rightLift = rj.y * FLARE_LIFT;
  path.bezierCurveTo(
    rj.x - rj.tx * rightLift,
    rj.y - rj.ty * rightLift,
    groundRight - rightSpread * FLARE_HUG,
    0,
    groundRight,
    0,
  );
  path.closePath();
  return path;
}

/** An offshoot's silhouette. Its base sits inside its parent, so it closes straight across. */
function limbOutline(
  limb: Limb,
  { left, right }: Edges,
  minRadius: number,
): Path2D {
  const path = new Path2D();
  const start = at(left, 0);
  path.moveTo(start.x, start.y);
  smoothThrough(path, left);
  tipCap(path, limb, minRadius);
  smoothThrough(path, [...right].reverse());
  path.closePath();
  return path;
}

function tipCap(path: Path2D, limb: Limb, minRadius: number): void {
  const tip = limb.tip;
  path.arc(
    tip.x,
    tip.y,
    Math.max(minRadius, limb.radiusAt(tip.s)),
    tip.heading + Math.PI / 2,
    tip.heading - Math.PI / 2,
    true,
  );
}

/**
 * Patches that round off the two corners where an offshoot's edges leave its parent: a tight
 * crotch on the side the offshoot leans toward, and a broad collar beneath it.
 */
function forkFillets(
  child: Limb,
  own: Edges,
  parent: Edges,
  minRadius: number,
): Path2D[] {
  invariant(
    child.attachment !== undefined,
    "Only an offshoot has a fork to blend.",
  );
  const forkS = child.attachment.s;
  const span =
    6 * (child.attachment.parent.radiusAt(forkS) + child.radiusAt(0));
  const patches: Path2D[] = [];
  for (const [childEdge, outside] of [
    [own.left, 1],
    [own.right, -1],
  ] as const) {
    const crossing = firstCrossing(
      childEdge,
      parent,
      span,
      forkS - span,
      forkS + span,
    );
    // A freshly forked offshoot can still be entirely inside its parent on one side. There is
    // no corner to round until its edge breaks out.
    if (crossing !== undefined) {
      patches.push(fillet(child, childEdge, crossing, outside, minRadius));
    }
  }
  return patches;
}

/** The first place the offshoot's edge, walking out from its base, crosses either parent edge. */
function firstCrossing(
  childEdge: readonly EdgePoint[],
  parent: Edges,
  childSpan: number,
  parentFrom: number,
  parentTo: number,
): Crossing | undefined {
  const windows = (
    [
      [parent.left, 1],
      [parent.right, -1],
    ] as const
  ).map(([parentEdge, parentSide]) => ({
    parentEdge,
    parentSide,
    from: Math.max(0, firstAtOrAfter(parentEdge, parentFrom) - 1),
    to: Math.min(
      parentEdge.length - 1,
      firstAtOrAfter(parentEdge, parentTo) + 1,
    ),
  }));
  for (
    let i = 0;
    i + 1 < childEdge.length && at(childEdge, i).s <= childSpan;
    i += 1
  ) {
    const p1 = at(childEdge, i);
    const p2 = at(childEdge, i + 1);
    for (const { parentEdge, parentSide, from, to } of windows) {
      for (let j = from; j < to; j += 1) {
        const point = intersect(
          p1,
          p2,
          at(parentEdge, j),
          at(parentEdge, j + 1),
        );
        if (point !== undefined) {
          return {
            point,
            childNext: i + 1,
            parentEdge,
            parentSide,
            parentIndex: j,
          };
        }
      }
    }
  }
  return undefined;
}

/**
 * Rounds the corner between the offshoot's edge and its parent's edge at `crossing`. `outside` is
 * the side of the offshoot edge that faces away from the offshoot: 1 for its left edge.
 */
function fillet(
  child: Limb,
  childEdge: readonly EdgePoint[],
  crossing: Crossing,
  outside: 1 | -1,
  minRadius: number,
): Path2D {
  const {
    point: corner,
    childNext,
    parentEdge,
    parentSide,
    parentIndex,
  } = crossing;
  const c1 = at(childEdge, childNext - 1);
  const c2 = at(childEdge, childNext);
  const q1 = at(parentEdge, parentIndex);
  const q2 = at(parentEdge, parentIndex + 1);
  const childDir = unit(c2.x - c1.x, c2.y - c1.y);
  const parentUp = unit(q2.x - q1.x, q2.y - q1.y);
  // The open corner is on the outside of the offshoot's edge, along whichever way the parent's
  // edge heads to that side.
  const up = (childDir.x * parentUp.y - childDir.y * parentUp.x) * outside > 0;
  const toward = up ? parentUp : { x: -parentUp.x, y: -parentUp.y };
  const acute = childDir.x * toward.x + childDir.y * toward.y > 0;
  const radius = Math.max(minRadius, child.radiusAt(c1.s));
  const size = (acute ? CROTCH_FILLET : COLLAR_FILLET) * radius;

  const childLeg = walk(
    { ...corner, tx: childDir.x, ty: childDir.y },
    childEdge,
    childNext,
    1,
    size,
  );
  const parentLeg = up
    ? walk(
        { ...corner, tx: parentUp.x, ty: parentUp.y },
        parentEdge,
        parentIndex + 1,
        1,
        size,
      )
    : walk(
        { ...corner, tx: parentUp.x, ty: parentUp.y },
        parentEdge,
        parentIndex,
        -1,
        size,
      );
  const a = at(childLeg, childLeg.length - 1);
  const b = at(parentLeg, parentLeg.length - 1);
  const towardA = {
    x: a.x + (corner.x - a.x) * FILLET_ROUNDNESS,
    y: a.y + (corner.y - a.y) * FILLET_ROUNDNESS,
  };
  const towardB = {
    x: b.x + (corner.x - b.x) * FILLET_ROUNDNESS,
    y: b.y + (corner.y - b.y) * FILLET_ROUNDNESS,
  };

  // The patch's straight sides run just inside both limbs, so it overlaps the wood rather than
  // meeting it edge to edge, which can leave a hairline of paper showing through.
  const depth = Math.max(0.35 * radius, 1.5 * minRadius);
  const childInside = childLeg.map((p) => inset(p, outside * depth));
  const parentInside = parentLeg.map((p) => inset(p, parentSide * depth));

  // Wind the patch clockwise like every outline, so it adds to the silhouette instead of cutting
  // a hole where it overlaps.
  const clockwise =
    (a.x - corner.x) * (b.y - corner.y) - (a.y - corner.y) * (b.x - corner.x) <
    0;
  const [
    firstInside,
    secondInside,
    firstOut,
    secondOut,
    firstHandle,
    secondHandle,
  ] = clockwise
    ? [childInside, parentInside, a, b, towardA, towardB]
    : [parentInside, childInside, b, a, towardB, towardA];
  const path = new Path2D();
  const start = at(firstInside, 0);
  path.moveTo(start.x, start.y);
  for (const p of firstInside.slice(1)) {
    path.lineTo(p.x, p.y);
  }
  path.lineTo(firstOut.x, firstOut.y);
  path.bezierCurveTo(
    firstHandle.x,
    firstHandle.y,
    secondHandle.x,
    secondHandle.y,
    secondOut.x,
    secondOut.y,
  );
  for (const p of [...secondInside].reverse()) {
    path.lineTo(p.x, p.y);
  }
  path.closePath();
  return path;
}

/**
 * Moves an edge point sideways by `depth`, to the right of the way its limb grows. A left edge
 * moves inward for a positive depth and a right edge for a negative one.
 */
function inset(p: EdgeStep, depth: number): Vec {
  return { x: p.x + p.ty * depth, y: p.y - p.tx * depth };
}

/**
 * Follows `edge` from `from`, starting at index `start` and stepping by `step`, for `distance`
 * or half of what is left of the edge if that is shorter. Returns the points passed through.
 */
function walk(
  from: EdgeStep,
  edge: readonly EdgePoint[],
  start: number,
  step: 1 | -1,
  distance: number,
): EdgeStep[] {
  let available = 0;
  let previous: Vec = from;
  for (
    let i = start;
    i >= 0 && i < edge.length && available < distance * 2;
    i += step
  ) {
    const p = at(edge, i);
    available += Math.hypot(p.x - previous.x, p.y - previous.y);
    previous = p;
  }
  let remaining = Math.min(distance, available * 0.5);
  const points: EdgeStep[] = [from];
  previous = from;
  for (let i = start; i >= 0 && i < edge.length; i += step) {
    const p = at(edge, i);
    const length = Math.hypot(p.x - previous.x, p.y - previous.y);
    if (length >= remaining) {
      const t = remaining / Math.max(length, 1e-12);
      points.push({
        x: previous.x + (p.x - previous.x) * t,
        y: previous.y + (p.y - previous.y) * t,
        tx: p.tx,
        ty: p.ty,
      });
      return points;
    }
    points.push(p);
    remaining -= length;
    previous = p;
  }
  return points;
}

function intersect(p1: Vec, p2: Vec, q1: Vec, q2: Vec): Vec | undefined {
  const rx = p2.x - p1.x;
  const ry = p2.y - p1.y;
  const sx = q2.x - q1.x;
  const sy = q2.y - q1.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-12) {
    return undefined;
  }
  const qx = q1.x - p1.x;
  const qy = q1.y - p1.y;
  const t = (qx * sy - qy * sx) / denominator;
  const u = (qx * ry - qy * rx) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) {
    return undefined;
  }
  return { x: p1.x + rx * t, y: p1.y + ry * t };
}

function unit(x: number, y: number): Vec {
  const length = Math.hypot(x, y);
  invariant(
    length > 0,
    "Cannot take the direction of a zero-length edge segment.",
  );
  return { x: x / length, y: y / length };
}

/** Index of the first point at or past distance `s` along the limb, or the last index. */
function firstAtOrAfter(points: readonly EdgePoint[], s: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at(points, mid).s < s) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** Offsets a limb's centerline to one side: 1 for the left edge, -1 for the right. */
function edge(limb: Limb, minRadius: number, side: 1 | -1): EdgePoint[] {
  const points: EdgePoint[] = [];
  for (const p of limb.points) {
    const tx = Math.cos(p.heading);
    const ty = Math.sin(p.heading);
    const r = Math.max(minRadius, limb.radiusAt(p.s)) * side;
    const candidate = { x: p.x - ty * r, y: p.y + tx * r, tx, ty, s: p.s };
    const previous = points[points.length - 1];
    // Where thick wood curves tightly, the inner edge would fold back on itself. Dropping the
    // points that move backward leaves a clean crease instead of a loop.
    if (
      previous === undefined ||
      (candidate.x - previous.x) * tx + (candidate.y - previous.y) * ty > 0
    ) {
      points.push(candidate);
    }
  }
  return points;
}

function firstAbove(points: readonly EdgePoint[], height: number): number {
  const index = points.findIndex((p) => p.y >= height);
  invariant(index >= 0, `No trunk edge point reaches height ${height}.`);
  return index;
}

/** Continues `path` from points[0] through the rest, rounding each corner with a quadratic curve. */
function smoothThrough(path: Path2D, points: readonly Vec[]): void {
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = at(points, i);
    const next = at(points, i + 1);
    path.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
  }
  const last = at(points, points.length - 1);
  path.lineTo(last.x, last.y);
}
