import type { Camera } from "./camera";
import type { CloudShadow } from "./clouds";
import { css, mix, type Rgb, type SkyBody, type SkyLight } from "./sky";
import {
  at,
  clamp,
  invariant,
  lerp,
  Rng,
  smoothstep,
  valueNoise,
} from "./util";

/**
 * A peak of the distant range, in multiples of the horizon's height above the view's top: where
 * it stands from the middle of the view, how high it rises, how far its feet reach either side,
 * and whether it is in the far row of peaks, behind the near one.
 */
interface Peak {
  x: number;
  height: number;
  left: number;
  right: number;
  far: boolean;
}

/**
 * The range, drawn back to front. The tallest peaks stand in the thirds either side of the middle,
 * so the tree grows in front of a low saddle, and the sun rises and sets behind them.
 */
const PEAKS: readonly Peak[] = [
  // The far row: lesser peaks first, so the great ones stand in front of them.
  { x: -1.5, height: 0.3, left: 0.46, right: 0.4, far: true },
  { x: -0.98, height: 0.35, left: 0.42, right: 0.36, far: true },
  { x: -0.22, height: 0.27, left: 0.34, right: 0.36, far: true },
  { x: 0.34, height: 0.3, left: 0.36, right: 0.34, far: true },
  { x: 1.12, height: 0.31, left: 0.36, right: 0.42, far: true },
  { x: 1.58, height: 0.34, left: 0.4, right: 0.5, far: true },
  { x: -0.62, height: 0.45, left: 0.6, right: 0.54, far: true },
  { x: 0.7, height: 0.4, left: 0.5, right: 0.6, far: true },
  // The near row, low, with a saddle behind the tree.
  { x: -1.86, height: 0.18, left: 0.38, right: 0.34, far: false },
  { x: -1.16, height: 0.21, left: 0.4, right: 0.34, far: false },
  { x: -0.44, height: 0.17, left: 0.3, right: 0.28, far: false },
  { x: 0.06, height: 0.12, left: 0.26, right: 0.28, far: false },
  { x: 0.52, height: 0.16, left: 0.28, right: 0.3, far: false },
  { x: 1.02, height: 0.22, left: 0.34, right: 0.4, far: false },
  { x: 1.78, height: 0.19, left: 0.38, right: 0.4, far: false },
];

/** Horizon height the line widths are given for, in CSS pixels; lines scale with the view. */
const BASE_HORIZON = 666;
/** Line widths, in CSS pixels at the base horizon height. */
const LINE = { ridge: 2.5, spur: 2.7, hatch: 1 } as const;
/** How wide each kind of line is along its length, from its start at 0 to its end at 1, as a fraction of a spur's width. */
const WEIGHT = {
  spur: (t: number) => lerp(1, 0.35, t),
  side: (t: number) => lerp(0.85, 0.3, t),
  fork: (t: number) => lerp(0.75, 0.25, t),
  lens: (t: number) => 0.55 * (0.35 + 0.65 * Math.sin(Math.PI * t)),
  crease: (t: number) => lerp(0.7, 0.12, t),
} as const;
/** Gap between hatching lines, in CSS pixels at the base horizon height. */
const HATCH_GAP = 2.8;
/**
 * How far the hatching leans off square to a face's length, in radians, one way on faces turned
 * left and the other on faces turned right.
 */
const HATCH_TILT = 0.6;
/** How strongly the lines show by day and by night, and how much fainter the far peaks are. */
const LINE_ALPHA = { day: 0.68, night: 0.4, far: 0.64 } as const;
/** Lines are raked dark into the sand by day, and catch the moonlight pale by night. */
const LINE_COLOR = { day: [42, 33, 26], night: [220, 216, 204] } as const;
/**
 * How far the mountains darken toward the ink of the wood: not at all by day, so only their lines
 * show, and into silhouettes against the glow at sunrise and sunset and against the night sky.
 */
const SILHOUETTE = { twilight: 0.42, night: 0.12, far: 0.6 } as const;
/**
 * The mountains' colors in full day, as the painters of the northern fjords give them, fading out
 * toward sunrise and sunset so the paper and the glow have those to themselves: faces low on a
 * peak green, below a treeline `treeline` of its height up that wanders `ragged` either way from
 * face to face, and faces above it warm rock; the far peaks hazed blue with the distance, `share`
 * of the way; faces turned from the sun cooled toward deep blue, and faces turned to it warmed.
 * Each lies over the paper as strongly as `alpha` says.
 */
const DAY = {
  green: { color: [94, 128, 84], alpha: 0.55 },
  rock: { color: [194, 152, 144], alpha: 0.4 },
  treeline: 0.3,
  ragged: 0.12,
  haze: { color: [124, 148, 198], share: 0.55 },
  cool: { color: [62, 74, 146], alpha: 0.42 },
  warm: { color: [244, 202, 170], alpha: 0.24 },
} as const;
/**
 * Shading of the faces. A face turned from the light is hatched in two passes: every other line
 * comes in as its shade deepens through `sparse`, and the lines between through `dense`. It is
 * darkened by up to `tone` of ink, and one turned toward a low sun glows with up to `glow` of the
 * sun's color. The moon shades the faces by night, `moon` as strongly as the sun.
 */
const SHADE = {
  sparse: [0.3, 0.62],
  dense: [0.6, 0.92],
  hatch: 0.85,
  tone: 0.08,
  glow: 0.24,
  moon: 0.6,
  /** With no direct light, under thick cloud, every face is this shaded. */
  overcast: 0.36,
} as const;
/**
 * How far a face leans toward the viewer and up, which sets how much light it takes from a sun
 * low beside it and from one high overhead.
 */
const FACE_TILT = { up: 0.55, out: 0.55 } as const;
/** How far toward the viewer the light falls, so the faces looking straight out are not all dark. */
const LIGHT_DEPTH = 0.8;
/**
 * How far light wraps past the edge of a face, so faces turned only a little from the sun fall
 * into half shade rather than full, and only the steepest are hatched dense.
 */
const WRAP = 0.5;
/**
 * How far a face turns for every half-width of its peak it lies from the summit, and how much
 * further a narrow band along a ridge or spur turns away from it, being steeper.
 */
const TURN = { spread: 1.25, band: 0.7, jitter: 0.16 } as const;
/** Tries at fitting a line inside its face, each bowing and wobbling it less than the last. */
const FIT_TRIES = 6;
/** Height of the tallest peak, in multiples of the horizon's height above the view's top. */
const TALLEST = Math.max(...PEAKS.map((peak) => peak.height));
/** Room around the carving for the width of its lines, in CSS pixels. */
const CARVING_MARGIN = 6;
/**
 * How far the mountains are carved on below their feet, in multiples of the horizon's height above
 * the view's top, so wherever the ground dips below the horizon their lower slopes carry on down
 * behind it, faces, spurs and ridges and all, rather than stopping short at a line. Each foot runs
 * on down its ridge, spreading out no more than `spread` for every unit it drops.
 */
const SKIRT = { depth: 0.12, spread: 2.5 } as const;
/**
 * How far the mountains' bodies run on below their carving, in multiples of the horizon's height
 * above the view's top, so however far the ground dips below the horizon it still meets mountain.
 */
const BELOW_FEET = 1;
/**
 * Snow on the peaks. It lies above a snowline that comes down the range as the year turns, from
 * `summer` of the way up the tallest peak at midsummer to `winter` at midwinter; lower on the far
 * row's greater peaks, at `far` of that; ragged along the range by up to `ragged` of the horizon's
 * height either way, over stretches about `along` of it long, and from face to face by up to
 * `byFace`. It reaches `gully` further down the hollow in the middle of each face than at the spurs
 * either side, which the wind scours, and on down in narrow tongues, each up to `tongue.deep` of the
 * horizon's height long and `tongue.wide` of its face across; it thins out over its last `thin` of
 * the horizon's height and lingers in streaks up to `patches` below the line. Ribs of rock run down
 * through it along the fall line, about `ribs.gap` apart at the base horizon height where there are
 * any, up to `ribs.wide` of the horizon's height across, most reaching down out of it from partway
 * up the face and some short outcrops higher up. A face's snow is lit and shaded as its rock is:
 * `lit` where the sun or the moon falls on it and `shade` where it does not, by day and by night,
 * and `ambient` of the way to lit with neither on it, deepening toward `deepens` of the shade down
 * the face; laid `alpha` thick; hazed `haze` of the way to the far row's blue; and warm with the
 * glow of sunrise and sunset, `glow` of the way to the sun's color. Its edge is carved as the
 * peaks' lines are, `line.alpha` as strong and `line.width` as wide as a hatching line; flutes are
 * raked down its fall lines `flutes.gap` apart at the base horizon height, `flutes.alpha` as strong
 * as the peaks' lines; and the ribs are edged with a carved line `edged` as strong.
 */
const SNOW = {
  summer: 0.92,
  winter: 0.45,
  far: 0.9,
  ragged: 0.012,
  along: 0.05,
  byFace: 0.02,
  gully: 0.03,
  tongue: { deep: 0.07, wide: [0.08, 0.2] },
  thin: 0.012,
  patches: 0.07,
  ribs: { gap: 13, wide: 0.012, among: 0.6 },
  lit: { day: [250, 251, 253], night: [138, 148, 176] },
  shade: { day: [172, 188, 222], night: [52, 60, 88] },
  ambient: { day: 0.4, night: 0.12 },
  alpha: { day: 0.95, night: 0.9 },
  deepens: 0.3,
  edged: 0.32,
  haze: 0.2,
  glow: 0.3,
  flutes: { gap: 3.6, alpha: 0.26 },
  line: { alpha: 0.6, width: 1.1 },
} as const satisfies {
  lit: { day: Rgb; night: Rgb };
  shade: { day: Rgb; night: Rgb };
  [key: string]: unknown;
};
/** How far apart the points along a face's snowline are worked out, in CSS pixels. */
const EDGE_STEP = 2;
/** How far the year turns, as a share of it, before the snow is laid afresh. */
const SEASON_STEP = 0.01;
/**
 * How far the light moves on, in where the sun and moon are and how much daylight and twilight
 * there is, before the carving is drawn again: too little to see in the shading.
 */
const LIGHT_STEP = 0.008;

interface Point {
  x: number;
  y: number;
}

/**
 * A line carved on a peak, and how wide it is along its length as a fraction of a spur; and for a
 * spur, where it carries on to below the peak's feet.
 */
interface Line {
  points: Point[];
  weight: (t: number) => number;
  skirt: Point | undefined;
}

/** A face of a peak while it is carved: its outline, and how much further than its place it turns. */
interface Carved {
  points: Point[];
  turn: number;
}

/**
 * A peak's shape, in multiples of the horizon's height from the middle of the horizon with y
 * down: its outline from below the left foot over the summit to below the right foot, its faces
 * and which way each turns, from -1 left to 1 right, and the lines carved on it. Each face is
 * carried on below the feet, and keeps its outline as carved above them.
 */
interface PeakShape {
  far: boolean;
  outline: Point[];
  faces: { points: Point[]; carved: Point[]; facing: number }[];
  lines: Line[];
}

/**
 * One peak, ready to draw: in CSS pixels from the middle of the horizon, with y down, its feet
 * `sunk` below the horizon and every unit of its carving `unit` pixels. Each face knows its
 * corners, how far up the peak it stands, as a share of the peak's height, and where the treeline
 * falls on it.
 */
interface Built {
  far: boolean;
  sunk: number;
  unit: number;
  body: Path2D;
  ridge: Path2D;
  lines: Path2D;
  faces: {
    outline: Path2D;
    points: Point[];
    hatch: { sparse: Path2D; dense: Path2D };
    facing: number;
    rise: number;
    treeline: number;
    snow: FaceSnow;
  }[];
}

/**
 * What a face's snow is laid out from, whatever the season: how far across the face it stands and
 * how high its top; its fall line, from its highest corner to the middle of its lowest; how far below
 * where the snowline stands on this face its edge reaches at each of `edge.length` points evenly
 * across the face, and at the most; the ribs of rock running down through it; the flutes down its
 * fall lines, every third raked more strongly; and the streaks the snow lingers in below the line,
 * each where it lies, how far below the line it lasts, as a share of the most, how far below where
 * the snowline stands the snow's edge reaches there, and its shape.
 */
interface FaceSnow {
  left: number;
  right: number;
  top: number;
  crest: Point;
  base: Point;
  edge: number[];
  lowest: number;
  ribs: Path2D;
  flutes: { strong: Path2D; faint: Path2D };
  streaks: {
    x: number;
    y: number;
    reach: number;
    edge: number;
    shape: Path2D;
  }[];
}

let range: PeakShape[] | undefined;

/** The range's shape, carved once: it is the same at every size of view. */
function rangeShape(): PeakShape[] {
  range ??= PEAKS.map(carvePeak);
  return range;
}

/**
 * A mountain range on the horizon, after the sand drawings: ridgelines up to sharp peaks, and
 * spurs, forks and creases wandering down their fronts that part each peak into faces. Faces
 * turned from the sun are hatched, and faces turned toward a low sun glow, so the shading swings
 * across the range through the day. The mountains are cut from warm paper a shade apart from the
 * cooler sky by day, so their lines and shading stand on them, and the sun and moon set behind
 * them.
 */
export class Mountains {
  private built: Built[] = [];
  /** The horizon height the range was last built for, in CSS pixels. */
  private builtFor = 0;
  /** The peak scale and base drop the range was last built for. */
  private builtScale = 1;
  private builtDrop = 0;
  /**
   * Everything carved on the mountains, drawn over their bodies: redrawn only as the light moves
   * on, since there is a great deal of it and it changes slowly.
   */
  private readonly carving = document.createElement("canvas");
  /** The view and light the carving was last drawn for. */
  private carvedFor = "";

  /**
   * Draws the range on the horizon in `season`, from midsummer at 0 to midwinter at 1, which
   * brings the snow down the peaks. `paper` is the gradient the mountains are filled with, in
   * device pixels, glowing from the horizon as the sky does. `peakScale` shortens the peaks, and
   * `drop` is how far their bases sit below the horizon, as a fraction of the sky, so they meet
   * the ground.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    paper: CanvasGradient,
    light: SkyLight,
    season: number,
    peakScale: number,
    drop: number,
  ): void {
    if (
      this.builtFor !== camera.groundY ||
      this.builtScale !== peakScale ||
      this.builtDrop !== drop
    ) {
      this.built = rangeShape().map((shape, index) =>
        build(shape, camera.groundY, peakScale, drop, index),
      );
      this.builtFor = camera.groundY;
      this.builtScale = peakScale;
      this.builtDrop = drop;
    }
    // The bodies are drawn afresh every frame, filled with the paper in the sky's own space, so
    // they always glow as the sky around them does while hiding whatever is behind them.
    const place = new DOMMatrix([
      camera.dpr,
      0,
      0,
      camera.dpr,
      (camera.width / 2) * camera.dpr,
      camera.horizonRow * camera.dpr,
    ]);
    const silhouette = silhouetteOf(light);
    const day = light.daylight * (1 - light.twilight);
    const carvedTo = drop + SKIRT.depth * peakScale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // A row at a time, far then near, so the near row's colors and darkening cover the far row's.
    for (const far of [true, false]) {
      const bodies = new Path2D();
      for (const mountain of this.built) {
        if (mountain.far === far) {
          bodies.addPath(mountain.body, place);
        }
      }
      ctx.fillStyle = paper;
      ctx.fill(bodies);
      if (day > 0.01) {
        ctx.fillStyle = belowFeet(ctx, camera, far, carvedTo, day);
        ctx.fill(bodies);
      }
      if (silhouette > 0) {
        ctx.fillStyle = css(light.ink, silhouette * (far ? SILHOUETTE.far : 1));
        ctx.fill(bodies);
      }
    }

    // The carving lies over them, kept from the last time the light moved far enough to show. It
    // reaches up to the tallest summit, which stands higher by however far the bases are raised.
    const above = Math.ceil(
      ((TALLEST * peakScale - Math.min(drop, 0)) * camera.groundY +
        CARVING_MARGIN) *
        camera.dpr,
    );
    const key = [
      ctx.canvas.width,
      camera.dpr,
      camera.groundY,
      peakScale,
      drop,
      Math.round(season / SEASON_STEP),
      ...[
        light.sun.along,
        light.sun.height,
        light.moon.along,
        light.moon.height,
        light.daylight,
        light.twilight,
        light.direct,
      ].map((value) => Math.round(value / LIGHT_STEP)),
    ].join();
    if (key !== this.carvedFor) {
      this.carve(camera, light, season, ctx.canvas.width, above, carvedTo);
      this.carvedFor = key;
    }
    ctx.drawImage(
      this.carving,
      0,
      Math.round(camera.horizonRow * camera.dpr) - above,
    );
  }

  /** The mountains' bodies as they were last drawn, as one shape in device pixels. */
  silhouette(camera: Camera): Path2D {
    const place = new DOMMatrix([
      camera.dpr,
      0,
      0,
      camera.dpr,
      (camera.width / 2) * camera.dpr,
      camera.horizonRow * camera.dpr,
    ]);
    const bodies = new Path2D();
    for (const mountain of this.built) {
      bodies.addPath(mountain.body, place);
    }
    return bodies;
  }

  /**
   * Darkens the mountains, and only them, with `shadows` in `ink`: each a soft oval in CSS pixels,
   * darkest at its middle and fading out to its edge.
   */
  shade(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    shadows: readonly CloudShadow[],
    ink: Rgb,
  ): void {
    if (shadows.length === 0) {
      return;
    }
    const place = new DOMMatrix([
      1,
      0,
      0,
      1,
      camera.width / 2,
      camera.horizonRow,
    ]);
    const bodies = new Path2D();
    for (const mountain of this.built) {
      bodies.addPath(mountain.body, place);
    }
    ctx.save();
    ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
    ctx.clip(bodies);
    for (const shadow of shadows) {
      ctx.save();
      ctx.translate(shadow.x, shadow.y);
      ctx.scale(shadow.rx, shadow.ry);
      const soft = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      soft.addColorStop(0, css(ink, shadow.alpha));
      soft.addColorStop(1, css(ink, 0));
      ctx.fillStyle = soft;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * Draws the carving into its own canvas, `width` device pixels wide with the horizon `above`
   * device pixels down, reaching down to `below` of the sky under the horizon, and the snow lying
   * on it in `season`. Each mountain first clears the carving of those behind it from its body.
   */
  private carve(
    camera: Camera,
    light: SkyLight,
    season: number,
    width: number,
    above: number,
    below: number,
  ): void {
    const canvas = this.carving;
    const height =
      above + Math.ceil((below * camera.groundY + CARVING_MARGIN) * camera.dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    invariant(ctx, "The mountains need a 2D canvas to carve on.");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(
      camera.dpr,
      0,
      0,
      camera.dpr,
      (camera.width / 2) * camera.dpr,
      above,
    );
    ctx.lineJoin = "round";
    const scale = camera.groundY / BASE_HORIZON;
    const lines = mix(LINE_COLOR.night, LINE_COLOR.day, light.daylight);
    const alpha = lerp(LINE_ALPHA.night, LINE_ALPHA.day, light.daylight);
    const sunUp = smoothstep(-0.04, 0.1, light.sun.height);
    const moonUp = smoothstep(-0.04, 0.1, light.moon.height);
    // In full day, faces turned from the sun cool toward deep blue and those turned to it warm.
    const day = light.daylight * (1 - light.twilight);
    const colored = day * light.direct;
    // The snowline, in multiples of the horizon's height above the peaks' feet, and the snow's
    // color, dimmed with the mountains as the light goes.
    const snowline =
      TALLEST * lerp(SNOW.summer, SNOW.winter, smoothstep(0, 1, season));
    const silhouette = silhouetteOf(light);
    const snowLit = mix(SNOW.lit.night, SNOW.lit.day, light.daylight);
    const snowShade = mix(SNOW.shade.night, SNOW.shade.day, light.daylight);
    const snowAlpha = lerp(SNOW.alpha.night, SNOW.alpha.day, light.daylight);
    const ambient = lerp(SNOW.ambient.night, SNOW.ambient.day, light.daylight);
    // How much the sun or the moon lights the faces turned to it, rather than the sky lighting all.
    const keyed = light.direct * Math.max(sunUp, SHADE.moon * moonUp);

    for (const [index, mountain] of this.built.entries()) {
      const fade = mountain.far ? LINE_ALPHA.far : 1;
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "#000";
      ctx.fill(mountain.body);
      ctx.globalCompositeOperation = "source-over";
      // The snow's color as it stands far off and darkens into the silhouette.
      const distant = (color: Rgb): Rgb =>
        mix(
          mountain.far ? mix(color, DAY.haze.color, SNOW.haze * day) : color,
          light.ink,
          silhouette * (mountain.far ? SILHOUETTE.far : 1),
        );
      const line =
        mountain.sunk -
        snowline * (mountain.far ? SNOW.far : 1) * mountain.unit;

      for (const [i, face] of mountain.faces.entries()) {
        // By day the sun shades the faces; by night the moon does, more softly, and with neither
        // up the faces are evenly lit.
        const bySun = 1 - litBy(face.facing, light.sun, WRAP);
        const byMoon = lerp(
          0.5,
          1 - litBy(face.facing, light.moon, WRAP),
          moonUp,
        );
        // Clouds take the direct light away, and with it the shading.
        const shade = lerp(
          SHADE.overcast,
          lerp(lerp(0.5, byMoon, SHADE.moon), bySun, sunUp),
          light.direct,
        );
        // In full day, green low on the peak and warm rock above, hazed blue far off, the rock
        // warmer where the sun falls on it.
        if (day > 0.01) {
          const green =
            1 -
            smoothstep(face.treeline - 0.06, face.treeline + 0.06, face.rise);
          const near = mix(DAY.rock.color, DAY.green.color, green);
          ctx.fillStyle = css(
            mountain.far ? mix(near, DAY.haze.color, DAY.haze.share) : near,
            lerp(DAY.rock.alpha, DAY.green.alpha, green) * day,
          );
          ctx.fill(face.outline);
        }
        const warm =
          DAY.warm.alpha * colored * (1 - smoothstep(0.15, 0.55, shade)) * fade;
        if (warm > 0.005) {
          ctx.fillStyle = css(DAY.warm.color, warm);
          ctx.fill(face.outline);
        }
        // Snow above the snowline, lit as far as the sun or the moon falls on the face, under the
        // face's shading so it is cooled and hatched as the rock is.
        const lies =
          line +
          SNOW.byFace * mountain.unit * valueNoise(i * 1.37 + index * 7.1, 313);
        if (face.snow.top <= lies + face.snow.lowest) {
          const lit =
            keyed * (1 - smoothstep(0.25, 0.65, shade)) + (1 - keyed) * ambient;
          const glowing =
            SNOW.glow *
            light.twilight *
            sunUp *
            light.direct *
            litBy(face.facing, light.sun, 0);
          const color = distant(
            mix(mix(snowShade, snowLit, lit), light.sunColor, glowing),
          );
          drawSnow(ctx, face, lies, mountain.unit, {
            color,
            shade: distant(snowShade),
            alpha: snowAlpha,
            flute: css(lines, SNOW.flutes.alpha * alpha * fade),
            edge: css(lines, SNOW.edged * alpha * fade),
            line: css(lines, SNOW.line.alpha * alpha * fade),
            lineScale: scale,
          });
        }
        if (shade > 0) {
          ctx.fillStyle = css(light.ink, SHADE.tone * shade * fade);
          ctx.fill(face.outline);
        }
        const cool =
          DAY.cool.alpha * colored * smoothstep(0.3, 0.85, shade) * fade;
        if (cool > 0.005) {
          ctx.fillStyle = css(DAY.cool.color, cool);
          ctx.fill(face.outline);
        }
        const glow =
          SHADE.glow *
          light.twilight *
          sunUp *
          light.direct *
          litBy(face.facing, light.sun, 0);
        if (glow > 0.005) {
          ctx.fillStyle = css(light.sunColor, glow * fade);
          ctx.fill(face.outline);
        }
        const sparse = SHADE.hatch * smoothstep(...SHADE.sparse, shade) * fade;
        const dense = SHADE.hatch * smoothstep(...SHADE.dense, shade) * fade;
        if (sparse > 0.01) {
          ctx.lineCap = "butt";
          ctx.lineWidth = LINE.hatch * scale;
          ctx.strokeStyle = css(light.ink, sparse);
          ctx.stroke(face.hatch.sparse);
          if (dense > 0.01) {
            ctx.strokeStyle = css(light.ink, dense);
            ctx.stroke(face.hatch.dense);
          }
        }
      }

      const strength = alpha * fade;
      ctx.fillStyle = css(lines, strength);
      ctx.fill(mountain.lines);
      ctx.strokeStyle = css(lines, strength);
      ctx.lineCap = "round";
      ctx.lineWidth = LINE.ridge * scale * (mountain.far ? 0.85 : 1);
      ctx.stroke(mountain.ridge);
    }
  }
}

/**
 * The color a row of the range takes in full day, `day` of the way there, where its body runs on
 * below its carving, `below` of the sky under the horizon for `camera`, in device pixels: the
 * green of its lower slopes, hazed blue for the far row. Above that the faces carry their own
 * colors.
 */
function belowFeet(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  far: boolean,
  below: number,
  day: number,
): CanvasGradient {
  const foot = (camera.horizonRow + below * camera.groundY) * camera.dpr;
  const gradient = ctx.createLinearGradient(0, foot - 1, 0, foot + 1);
  const color = far
    ? mix(DAY.green.color, DAY.haze.color, DAY.haze.share)
    : DAY.green.color;
  gradient.addColorStop(0, css(color, 0));
  gradient.addColorStop(1, css(color, DAY.green.alpha * day));
  return gradient;
}

/** How far the mountains darken toward the ink in `light`: into silhouettes at twilight and by night. */
function silhouetteOf(light: SkyLight): number {
  return (
    SILHOUETTE.twilight * light.twilight +
    SILHOUETTE.night * (1 - light.daylight)
  );
}

/**
 * Lays out a face's snow, whatever the season, for a face with corners `points` as carved from
 * `carved`, on a peak `unit` pixels to the unit of its carving with lines `lineScale` as wide as at
 * the base horizon height, by `rng`, its snowline wandering by `seed`: its edge below where the
 * snowline stands on it, further down the hollow in the middle of the face and further still in its
 * tongues, each narrowing to a point, and ragged along the range at three scales; ribs of rock and
 * flutes down its fall line, from its highest corner toward the middle of its lowest; and streaks
 * scattered over it along the fall line, to show as snow lingering below the line as it falls.
 */
function faceSnow(
  points: readonly Point[],
  carved: readonly Point[],
  unit: number,
  lineScale: number,
  rng: Rng,
  seed: number,
): FaceSnow {
  const left = Math.min(...points.map((p) => p.x));
  const right = Math.max(...points.map((p) => p.x));
  const top = Math.min(...points.map((p) => p.y));
  const width = right - left;
  const tongues: { at: number; wide: number; deep: number }[] = [];
  const count = width > 0.12 * unit ? 1 + Math.floor(rng.next() * 3) : 1;
  for (let k = 0; k < count; k += 1) {
    tongues.push({
      at: lerp(0.18, 0.82, (k + 0.2 + 0.6 * rng.next()) / count),
      wide: lerp(SNOW.tongue.wide[0], SNOW.tongue.wide[1], rng.next()),
      deep: SNOW.tongue.deep * (0.35 + 0.65 * rng.next()),
    });
  }
  const reach = SNOW.ragged * unit;
  const gully = SNOW.gully * unit;
  const along = SNOW.along * unit;
  const middle = (left + right) / 2;
  const span = Math.max(width, 1e-6);
  const below = (x: number): number => {
    const across = (2 * (x - middle)) / span;
    let y =
      gully * (1 - across * across) +
      reach *
        (0.6 * valueNoise(x / along, 401 + seed) +
          0.28 * valueNoise((x * 3.1) / along, 402 + seed) +
          0.12 * valueNoise((x * 9.7) / along, 403 + seed));
    for (const tongue of tongues) {
      const t =
        Math.abs(x - lerp(left, right, tongue.at)) / (tongue.wide * span);
      if (t < 1) {
        y += tongue.deep * unit * (1 - t) * (1 - t);
      }
    }
    return y;
  };
  const samples = Math.max(2, Math.ceil(width / EDGE_STEP));
  const edge = Array.from({ length: samples + 1 }, (_, k) =>
    below(lerp(left, right, k / samples)),
  );

  // The fall line, and across it.
  const crest = carved.reduce((a, b) => (b.y < a.y ? b : a));
  const deepest = Math.max(...carved.map((p) => p.y));
  const floor = carved.filter((p) => p.y === deepest);
  const base = {
    x: floor.reduce((sum, p) => sum + p.x, 0) / floor.length,
    y: deepest,
  };
  const length = Math.hypot(base.x - crest.x, base.y - crest.y);
  const ax = (base.x - crest.x) / length;
  const ay = (base.y - crest.y) / length;
  const nx = -ay;
  const ny = ax;
  const offsets = points.map(
    (p) => (p.x - crest.x) * nx + (p.y - crest.y) * ny,
  );
  const least = Math.min(...offsets);
  const most = Math.max(...offsets);
  // A point `down` along the fall line from the crest and `out` across it.
  const onFall = (down: number, out: number): Point => ({
    x: crest.x + ax * down + nx * out,
    y: crest.y + ay * down + ny * out,
  });

  // Ribs of rock, each a tapering streak along the fall line at its own place across the face, so
  // none crosses another.
  const ribs = new Path2D();
  const ribGap = SNOW.ribs.gap * lineScale;
  const ribWide = SNOW.ribs.wide * unit;
  for (
    let out = least + ribGap * (0.3 + 0.5 * rng.next());
    out < most - 0.3 * ribGap;
    out += ribGap * (0.8 + 0.6 * rng.next())
  ) {
    if (rng.next() < SNOW.ribs.among) {
      const long = rng.next() < 0.65;
      const from =
        length *
        (long ? lerp(0.2, 0.75, rng.next()) : lerp(0.05, 0.55, rng.next()));
      const to = long
        ? length * 1.3
        : from + length * lerp(0.06, 0.16, rng.next());
      const wide = ribWide * lerp(0.45, 1, rng.next()) * (long ? 1 : 0.7);
      const seed = rng.next() * 1000;
      const steps = 12;
      const one: Point[] = [];
      const other: Point[] = [];
      for (let k = 0; k <= steps; k += 1) {
        const t = k / steps;
        const half =
          (wide / 2) *
          (long ? Math.pow(t, 0.55) : Math.sin(Math.PI * t)) *
          (0.75 + 0.5 * (valueNoise(t * 5, seed) * 0.5 + 0.5));
        const wobble = valueNoise(t * 3, seed + 1) * 0.6 * wide;
        const middle = lerp(from, to, t);
        one.push(onFall(middle, out + wobble + half));
        other.push(onFall(middle, out + wobble - half));
      }
      const outline = [...one, ...other.reverse()];
      outline.forEach((p, k) => {
        if (k === 0) {
          ribs.moveTo(p.x, p.y);
        } else {
          ribs.lineTo(p.x, p.y);
        }
      });
      ribs.closePath();
    }
  }

  // Flutes, fine lines down the fall line from above the face to partway down it, every third
  // raked more strongly.
  const gap = SNOW.flutes.gap * lineScale;
  const flutes = { strong: new Path2D(), faint: new Path2D() };
  let raked = 0;
  for (
    let out = least + gap * rng.next();
    out < most;
    out += gap * (0.7 + 0.6 * rng.next())
  ) {
    const reach = length * (0.3 + 0.55 * rng.next());
    const start = onFall(-0.1 * length, out);
    const end = onFall(reach, out);
    const bow = (rng.next() - 0.5) * 0.08 * reach;
    const flute = raked % 3 === 0 ? flutes.strong : flutes.faint;
    raked += 1;
    flute.moveTo(start.x, start.y);
    flute.quadraticCurveTo(
      (start.x + end.x) / 2 + nx * bow,
      (start.y + end.y) / 2 + ny * bow,
      end.x,
      end.y,
    );
  }

  // Streaks of snow along the fall line, each a lens of a few corners.
  const streaks: FaceSnow["streaks"] = [];
  const height = deepest - top;
  const tries = Math.round(
    clamp((width * height) / (0.0009 * unit * unit), 3, 60),
  );
  const fall = Math.atan2(ay, ax);
  for (let k = 0; k < tries; k += 1) {
    const x = lerp(left, right, rng.next());
    const y = lerp(top, deepest, rng.next());
    if (contains(points, { x, y })) {
      const size = (0.004 + 0.008 * rng.next()) * unit;
      const angle = fall + (rng.next() - 0.5) * 0.3;
      const stretch = 1.6 + 1.6 * rng.next();
      const shape = new Path2D();
      const corners = 7;
      for (let c = 0; c < corners; c += 1) {
        const t = (c / corners) * Math.PI * 2;
        const r = 0.75 + 0.5 * rng.next();
        const u = Math.cos(t) * size * stretch * r;
        const v = Math.sin(t) * size * 0.4 * r;
        const px = x + u * Math.cos(angle) - v * Math.sin(angle);
        const py = y + u * Math.sin(angle) + v * Math.cos(angle);
        if (c === 0) {
          shape.moveTo(px, py);
        } else {
          shape.lineTo(px, py);
        }
      }
      shape.closePath();
      streaks.push({
        x,
        y,
        reach: 0.25 + 0.75 * rng.next(),
        edge: below(x),
        shape,
      });
    }
  }
  return {
    left,
    right,
    top,
    crest,
    base,
    edge,
    lowest: Math.max(...edge),
    ribs,
    flutes,
    streaks,
  };
}

/**
 * The snow on `face` above its snowline, which stands at `line` on it, for a peak `unit` pixels to
 * the unit of its carving, in `look`: thin along its lower edge and thick above, the ribs of rock left bare through
 * it so the face shows there as it does below the line; deepening toward the shade down the face;
 * the streaks lingering below the line; its edge carved along the snowline; the flutes raked down
 * its fall lines; and the ribs' edges carved where they run through the snow.
 */
function drawSnow(
  ctx: CanvasRenderingContext2D,
  face: Built["faces"][number],
  line: number,
  unit: number,
  look: {
    color: Rgb;
    shade: Rgb;
    alpha: number;
    flute: string;
    edge: string;
    line: string;
    lineScale: number;
  },
): void {
  const { snow } = face;
  const last = snow.edge.length - 1;
  // Along the snow's edge, `lift` above it.
  const trace = (path: Path2D, lift: number): void => {
    snow.edge.forEach((below, k) => {
      const x = lerp(snow.left, snow.right, k / last);
      const y = line + below - lift;
      if (k === 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    });
  };
  const edge = new Path2D();
  trace(edge, 0);
  const region = (lift: number): Path2D => {
    const path = new Path2D();
    trace(path, lift);
    path.lineTo(snow.right, snow.top - 1);
    path.lineTo(snow.left, snow.top - 1);
    path.closePath();
    return path;
  };
  // The snow above a line `lift` over the snowline, `alpha` thick, with the ribs left bare: within
  // it, each rib is a second shape over the first, which the even-odd rule leaves unfilled.
  const lay = (
    lift: number,
    alpha: number,
    fill: string | CanvasGradient,
  ): Path2D => {
    const within = region(lift);
    const ribbed = new Path2D(within);
    ribbed.addPath(snow.ribs);
    ctx.save();
    ctx.clip(within);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.fill(ribbed, "evenodd");
    ctx.restore();
    return within;
  };
  ctx.save();
  ctx.clip(face.outline);
  const solid = css(look.color);
  const whole = lay(0, look.alpha * 0.55, solid);
  lay(SNOW.thin * unit, look.alpha * 0.9, solid);
  const { crest, base } = snow;
  const deepening = ctx.createLinearGradient(crest.x, crest.y, base.x, base.y);
  deepening.addColorStop(0, css(look.shade, 0));
  deepening.addColorStop(1, css(look.shade, SNOW.deepens));
  lay(0, look.alpha, deepening);
  // Streaks lingering below the line, the fewer the farther below it.
  ctx.fillStyle = css(look.color, look.alpha * 0.7);
  for (const streak of snow.streaks) {
    const below = streak.y - (line + streak.edge);
    if (below > 0 && below < SNOW.patches * unit * streak.reach) {
      ctx.fill(streak.shape);
    }
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = SNOW.line.width * LINE.hatch * look.lineScale;
  ctx.strokeStyle = look.line;
  ctx.stroke(edge);
  ctx.clip(whole);
  ctx.strokeStyle = look.flute;
  ctx.lineWidth = 0.5 * look.lineScale;
  ctx.stroke(snow.flutes.faint);
  ctx.lineWidth = 0.9 * look.lineScale;
  ctx.stroke(snow.flutes.strong);
  ctx.lineWidth = 0.8 * look.lineScale;
  ctx.strokeStyle = look.edge;
  ctx.stroke(snow.ribs);
  ctx.restore();
}

/**
 * How much light a face turned `facing` takes from a body in the sky, from 0 to 1: faces turned
 * toward a low sun are lit full on and faces turned from it fall dark, while a sun overhead lights
 * every face about the same. Light wraps `wrap` past the edge of the face.
 */
function litBy(facing: number, body: SkyBody, wrap: number): number {
  const angle = Math.PI * (1 - clamp(body.along, 0, 1));
  const lx = Math.cos(angle);
  const ly = Math.sin(angle);
  const nx = 0.95 * facing;
  const normal = Math.hypot(nx, FACE_TILT.up, FACE_TILT.out);
  const light = Math.hypot(lx, ly, LIGHT_DEPTH);
  const dot = nx * lx + FACE_TILT.up * ly + FACE_TILT.out * LIGHT_DEPTH;
  return Math.max(0, (dot / (normal * light) + wrap) / (1 + wrap));
}

/**
 * A peak's shape in CSS pixels for a horizon `horizon` pixels below the top of the view. Peaks are
 * `peakScale` as tall as carved, and their bases sit `drop` of the sky below the horizon. `index`
 * sets how its snowline wanders.
 */
function build(
  shape: PeakShape,
  horizon: number,
  peakScale: number,
  drop: number,
  index: number,
): Built {
  const lineScale = horizon / BASE_HORIZON;
  const sunk = drop * horizon;
  const unit = horizon * peakScale;
  const px = (p: Point): Point => ({
    x: p.x * horizon,
    y: p.y * unit + sunk,
  });
  const outline = shape.outline.map(px);
  const first = at(outline, 0);
  const last = at(outline, outline.length - 1);

  const body = new Path2D();
  const below = sunk + SKIRT.depth * unit + BELOW_FEET * horizon;
  body.moveTo(first.x, below);
  for (const p of outline) {
    body.lineTo(p.x, p.y);
  }
  body.lineTo(last.x, below);
  body.closePath();
  const ridgeLine = new Path2D();
  ridgeLine.moveTo(first.x, first.y);
  for (const p of outline.slice(1)) {
    ridgeLine.lineTo(p.x, p.y);
  }

  // A spur carries on below the feet as wide as it reached them.
  const lines = new Path2D();
  for (const line of shape.lines) {
    const points = line.points.map(px);
    const widths = points.map(
      (_, i) => line.weight(i / (points.length - 1)) * LINE.spur * lineScale,
    );
    if (line.skirt !== undefined) {
      points.push(px(line.skirt));
      widths.push(at(widths, widths.length - 1));
    }
    lines.addPath(taper(points, widths));
  }

  // Each face is shaded and colored as it was carved, above the feet, and carries that on below.
  const summit = Math.min(...shape.outline.map((p) => p.y));
  const faces = shape.faces.map((face, i) => {
    const points = face.points.map(px);
    const path = new Path2D();
    points.forEach((p, j) => {
      if (j === 0) {
        path.moveTo(p.x, p.y);
      } else {
        path.lineTo(p.x, p.y);
      }
    });
    path.closePath();
    const middle =
      face.carved.reduce((sum, p) => sum + p.y, 0) / face.carved.length;
    const carved = face.carved.map(px);
    return {
      outline: path,
      points,
      hatch: hatching(points, carved, face.facing < 0 ? -1 : 1, lineScale),
      facing: face.facing,
      rise: middle / summit,
      treeline:
        DAY.treeline + DAY.ragged * valueNoise(i * 1.7 + summit * 13, 31),
      snow: faceSnow(
        points,
        carved,
        unit,
        lineScale,
        new Rng(4201 + i * 31),
        index,
      ),
    };
  });
  return { far: shape.far, sunk, unit, body, ridge: ridgeLine, lines, faces };
}

/**
 * Carves one peak: its ridges, then spurs down its front from the summit and from the ridges,
 * forks off the spurs, narrow bands along the ridges and spurs, and short creases that wander
 * down a face and fade out on it.
 */
function carvePeak(peak: Peak, index: number): PeakShape {
  const rng = new Rng(9001 + index * 97);
  const top: Point = { x: peak.x, y: -peak.height };
  const leftFoot: Point = { x: peak.x - peak.left, y: 0 };
  const rightFoot: Point = { x: peak.x + peak.right, y: 0 };
  const left = ridge(top, leftFoot, rng);
  const right = ridge(top, rightFoot, rng);
  const outline = [...[...left].reverse(), ...right.slice(1)];
  const carving = new Carving(outline, `Peak ${index}`);
  const seed = index * 13.7;
  const tall = peak.height;
  // A point on the base a fraction `f` of the way from the left foot, give or take.
  const base = (f: number): number =>
    lerp(leftFoot.x, rightFoot.x, f + (rng.next() - 0.5) * 0.06);
  const down = (lean: number): number => Math.atan2(1, lean);

  if (tall >= 0.35) {
    const middle = carving.spur(top, base(0.5), 0.05, WEIGHT.spur, seed);
    const leftSpur = carving.spur(
      at(left, 2),
      base(0.24),
      -0.05,
      WEIGHT.side,
      seed + 1,
    );
    const rightSpur = carving.spur(
      at(right, 2),
      base(0.78),
      0.05,
      WEIGHT.side,
      seed + 2,
    );
    carving.spur(at(middle, 8), base(0.64), -0.06, WEIGHT.fork, seed + 3);
    carving.spur(at(leftSpur, 11), base(0.13), 0.05, WEIGHT.fork, seed + 4);
    carving.spur(at(rightSpur, 11), base(0.88), -0.05, WEIGHT.fork, seed + 5);
    carving.band(at(left, 3), at(left, 9), 0.1, -TURN.band, seed + 6);
    carving.band(at(right, 3), at(right, 9), 0.1, TURN.band, seed + 7);
    carving.band(at(middle, 2), at(middle, 7), 0.12, TURN.band, seed + 8);
    // Creases carry on down from where the bands along the ridges end.
    carving.crease(at(left, 9), down(0.35), 0.28 * tall, seed + 9);
    carving.crease(at(right, 9), down(-0.3), 0.26 * tall, seed + 10);
    carving.crease(at(leftSpur, 4), down(0.2), 0.3 * tall, seed + 11);
  } else if (tall >= 0.2) {
    const first = carving.spur(top, base(0.42), 0.05, WEIGHT.spur, seed);
    const second = carving.spur(
      at(right, 3),
      base(0.78),
      0.04,
      WEIGHT.side,
      seed + 1,
    );
    carving.spur(at(first, 8), base(0.16), -0.05, WEIGHT.fork, seed + 2);
    carving.spur(at(second, 7), base(0.62), 0.05, WEIGHT.fork, seed + 3);
    carving.band(at(left, 1), at(left, 6), 0.1, -TURN.band, seed + 4);
    carving.band(at(first, 2), at(first, 8), 0.1, TURN.band, seed + 5);
    carving.crease(at(right, 6), down(-0.3), 0.3 * tall, seed + 6);
    carving.crease(at(left, 7), down(0.3), 0.26 * tall, seed + 7);
  } else {
    const only = carving.spur(top, base(0.5), 0.05, WEIGHT.spur, seed);
    carving.spur(at(only, 8), base(0.8), 0.05, WEIGHT.fork, seed + 1);
    // A band down one ridge or the other, and a crease carrying on from where it ends.
    const onLeft = rng.next() < 0.5;
    const side = onLeft ? left : right;
    const out = onLeft ? -1 : 1;
    carving.band(at(side, 1), at(side, 7), 0.07, out * TURN.band, seed + 2);
    carving.crease(at(side, 7), down(-out * 0.3), 0.32 * tall, seed + 3);
  }

  // Below the feet, each foot runs on down its ridge and every other corner along the base runs on
  // down and out from the summit, its spur with it, so the faces between carry on down as they ran.
  const skirt = new Map<Point, Point>();
  for (const side of [left, right]) {
    const foot = at(side, side.length - 1);
    const higher = at(side, side.length - 4);
    const spread = clamp(
      Math.abs((foot.x - higher.x) / (foot.y - higher.y)),
      Math.abs(foot.x - top.x) / tall,
      SKIRT.spread,
    );
    skirt.set(foot, {
      x: foot.x + Math.sign(foot.x - top.x) * spread * SKIRT.depth,
      y: SKIRT.depth,
    });
  }
  const below = (corner: Point): Point => {
    let end = skirt.get(corner);
    if (end === undefined) {
      end = {
        x: corner.x + ((corner.x - top.x) * SKIRT.depth) / tall,
        y: SKIRT.depth,
      };
      skirt.set(corner, end);
    }
    return end;
  };

  const half = (peak.left + peak.right) / 2;
  return {
    far: peak.far,
    outline: [below(leftFoot), ...outline, below(rightFoot)],
    lines: carving.lines.map((line) => {
      const end = at(line.points, line.points.length - 1);
      return { ...line, skirt: end.y === 0 ? below(end) : undefined };
    }),
    faces: carving.faces.map((face) => {
      const points: Point[] = [];
      face.points.forEach((p, i) => {
        points.push(p);
        const next = at(face.points, (i + 1) % face.points.length);
        if (p.y === 0 && next.y === 0) {
          points.push(below(p), below(next));
        }
      });
      return {
        points,
        carved: face.points,
        facing: clamp(
          (TURN.spread * (centroid(face.points).x - top.x)) / half +
            face.turn +
            (rng.next() - 0.5) * TURN.jitter,
          -1,
          1,
        ),
      };
    }),
  };
}

/**
 * The faces of one peak as it is carved: the whole front to begin with, parted again and again by
 * lines that each run from a corner of a face to another point on its edge, and the lines carved
 * on it. Corners are shared between faces as the very same points, which is how a line finds the
 * face it starts on.
 */
class Carving {
  readonly faces: Carved[];
  readonly lines: Line[] = [];

  /** `name` says which peak this is when a line will not fit. */
  constructor(
    outline: readonly Point[],
    private readonly name: string,
  ) {
    this.faces = [{ points: [...outline], turn: 0 }];
  }

  /**
   * A spur from the corner `from` down to the base at `baseX`, parting the face it crosses in
   * two. Returns its points, whose corners later lines can start from.
   */
  spur(
    from: Point,
    baseX: number,
    bow: number,
    weight: (t: number) => number,
    seed: number,
  ): Point[] {
    const face = this.faces.find(
      (f) => f.points.includes(from) && baseEdge(f.points, baseX) !== undefined,
    );
    invariant(
      face,
      `${this.name}: no face runs from that corner to the base at ${baseX}.`,
    );
    const edge = baseEdge(face.points, baseX);
    invariant(edge !== undefined, `${this.name}: no base edge at ${baseX}.`);
    const foot: Point = { x: baseX, y: 0 };
    face.points.splice(edge + 1, 0, foot);
    for (let i = 0; i < FIT_TRIES; i += 1) {
      const ease = 1 - i / (FIT_TRIES - 1);
      const path = wander(from, foot, bow * ease, seed + i, ease);
      const parts = this.split(face, path);
      if (parts !== undefined) {
        this.lines.push({ points: path, weight, skirt: undefined });
        return path;
      }
    }
    throw new Error(
      `${this.name}: no spur fits from that corner to the base at ${baseX}.`,
    );
  }

  /**
   * A narrow band between the corners `a` and `b` along one edge, bowing `bulge` of the way
   * between them into the face and turned `turn` further than its place, being steeper. A turn
   * along a spur goes toward whichever side the band falls on.
   */
  band(a: Point, b: Point, bulge: number, turn: number, seed: number): void {
    const faces = this.faces.filter(
      (f) => f.points.includes(a) && f.points.includes(b),
    );
    invariant(
      faces.length > 0,
      `${this.name}: no face has both ends of a band.`,
    );
    for (let i = 0; i < FIT_TRIES; i += 1) {
      const ease = 1 - i / FIT_TRIES;
      for (const face of faces) {
        const path = swell(
          edgeRun(face.points, a, b),
          face.points,
          bulge * ease,
          seed + i,
        );
        const parts = this.split(face, path);
        if (parts === undefined) {
          continue;
        }
        const [one, other] = parts;
        const narrow = area(one.points) < area(other.points) ? one : other;
        const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const away = Math.sign(centroid(narrow.points).x - middle.x) || 1;
        // Along a ridge, which only one face reaches, the band turns out with the ridge; along
        // a spur, away from it.
        const onRidge = faces.length === 1;
        narrow.turn += onRidge ? turn : Math.abs(turn) * away;
        this.lines.push({
          points: path,
          weight: WEIGHT.lens,
          skirt: undefined,
        });
        return;
      }
    }
    throw new Error(`${this.name}: no band fits between those corners.`);
  }

  /**
   * A short crease from the corner `from`, heading at `angle` down into a face and fading out on
   * it, up to `length` long but always ending well above the base.
   */
  crease(from: Point, angle: number, length: number, seed: number): void {
    const faces = this.faces.filter((f) => f.points.includes(from));
    invariant(faces.length > 0, `${this.name}: no face has that corner.`);
    for (let i = 0; i < FIT_TRIES; i += 1) {
      const ease = 1 - i / FIT_TRIES;
      // Any heading near the one asked for will do, turning further from it the less room
      // there is.
      for (const turn of [0, 0.3, -0.3, 0.6, -0.6]) {
        const heading = angle + turn;
        const room = (0.7 * -from.y) / Math.max(0.2, Math.sin(heading));
        const reach = Math.min(length, room) * (0.5 + 0.5 * ease);
        const end = {
          x: from.x + Math.cos(heading) * reach,
          y: from.y + Math.sin(heading) * reach,
        };
        const path = wander(from, end, 0.06 * ease, seed + i, ease);
        for (const face of faces) {
          const corner = face.points.indexOf(from);
          if (inside(path.slice(1), face.points, corner, undefined)) {
            this.lines.push({
              points: path,
              weight: WEIGHT.crease,
              skirt: undefined,
            });
            return;
          }
        }
      }
    }
    throw new Error(`${this.name}: no crease fits from that corner.`);
  }

  /**
   * Parts `face` along `path`, which runs between two of its corners, if the path stays inside
   * it. Returns the two new faces, or undefined if the path strays out of the face.
   */
  private split(
    face: Carved,
    path: readonly Point[],
  ): [Carved, Carved] | undefined {
    const start = face.points.indexOf(at(path, 0));
    const end = face.points.indexOf(at(path, path.length - 1));
    invariant(
      start >= 0 && end >= 0,
      `${this.name}: a line must run between corners of its face.`,
    );
    const inner = path.slice(1, -1);
    if (!inside(inner, face.points, start, end)) {
      return undefined;
    }
    const n = face.points.length;
    const one: Point[] = [];
    for (let i = start; ; i = (i + 1) % n) {
      one.push(at(face.points, i));
      if (i === end) {
        break;
      }
    }
    one.push(...[...inner].reverse());
    const other: Point[] = [];
    for (let i = end; ; i = (i + 1) % n) {
      other.push(at(face.points, i));
      if (i === start) {
        break;
      }
    }
    other.push(...inner);
    const parts: [Carved, Carved] = [
      { points: one, turn: face.turn },
      { points: other, turn: face.turn },
    ];
    this.faces.splice(this.faces.indexOf(face), 1, ...parts);
    return parts;
  }
}

/**
 * Whether a line through `points`, starting at corner `start` of `polygon` and ending at corner
 * `end` if it has one, stays inside it: every point within, and no stretch crossing an edge.
 */
function inside(
  points: readonly Point[],
  polygon: readonly Point[],
  start: number,
  end: number | undefined,
): boolean {
  if (!points.every((p) => contains(polygon, p))) {
    return false;
  }
  const n = polygon.length;
  const path = [
    at(polygon, start),
    ...points,
    ...(end === undefined ? [] : [at(polygon, end)]),
  ];
  for (let i = 0; i + 1 < path.length; i += 1) {
    const p = at(path, i);
    const q = at(path, i + 1);
    for (let j = 0; j < n; j += 1) {
      const k = (j + 1) % n;
      const touches =
        (i === 0 && (j === start || k === start)) ||
        (end !== undefined &&
          i + 2 === path.length &&
          (j === end || k === end));
      if (!touches && crosses(p, q, at(polygon, j), at(polygon, k))) {
        return false;
      }
    }
  }
  return true;
}

/** Whether the segments from `a` to `b` and from `c` to `d` cross. */
function crosses(a: Point, b: Point, c: Point, d: Point): boolean {
  const turn = (p: Point, q: Point, r: Point): number =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;
}

/** Whether `p` lies inside `polygon`. */
function contains(polygon: readonly Point[], p: Point): boolean {
  let within = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = at(polygon, i);
    const b = at(polygon, j);
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      within = !within;
    }
  }
  return within;
}

/** The index of the edge of `polygon` along the base that `x` falls on, if any. */
function baseEdge(polygon: readonly Point[], x: number): number | undefined {
  for (let i = 0; i < polygon.length; i += 1) {
    const a = at(polygon, i);
    const b = at(polygon, (i + 1) % polygon.length);
    if (
      a.y === 0 &&
      b.y === 0 &&
      Math.min(a.x, b.x) < x &&
      x < Math.max(a.x, b.x)
    ) {
      return i;
    }
  }
  return undefined;
}

/** The area of `polygon`. */
function area(polygon: readonly Point[]): number {
  let twice = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = at(polygon, i);
    const b = at(polygon, (i + 1) % polygon.length);
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice / 2);
}

/** The middle of `polygon`'s area. */
function centroid(polygon: readonly Point[]): Point {
  let twice = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = at(polygon, i);
    const b = at(polygon, (i + 1) % polygon.length);
    const cross = a.x * b.y - b.x * a.y;
    twice += cross;
    x += (a.x + b.x) * cross;
    y += (a.y + b.y) * cross;
  }
  invariant(twice !== 0, "A face must have an area.");
  return { x: x / (3 * twice), y: y / (3 * twice) };
}

/**
 * A ridge from a summit down to a foot: steep at the top and easing out toward the foot, with a
 * shoulder along the way, sometimes a notch and a lesser summit behind it, and small jags.
 */
function ridge(top: Point, foot: Point, rng: Rng): Point[] {
  const drop = foot.y - top.y;
  // A bench partway down, where the slope eases before it falls away again.
  const bench = 0.3 + 0.28 * rng.next();
  const shoulder = (0.06 + 0.06 * rng.next()) * drop;
  const notch = rng.next() < 0.5 ? 0.04 * drop : 0;
  const points: Point[] = [top];
  const steps = 12;
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const sag = Math.sin(Math.PI * t) * 0.15 * drop;
    const lift =
      shoulder * Math.exp(-(((t - bench) / 0.08) ** 2)) -
      notch * Math.exp(-(((t - bench + 0.09) / 0.04) ** 2));
    points.push({
      x: lerp(top.x, foot.x, t) + (rng.next() - 0.5) * 0.025 * drop,
      y: lerp(top.y, foot.y, t) + sag - lift + (rng.next() - 0.5) * 0.03 * drop,
    });
  }
  points.push(foot);
  return points;
}

/**
 * A line wandering from `start` to `end`, bowed sideways by `bow` of its length and wobbling a
 * little along the way, the more so as it goes, by `wobble` of the usual.
 */
function wander(
  start: Point,
  end: Point,
  bow: number,
  seed: number,
  wobble: number,
): Point[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const nx = -dy / length;
  const ny = dx / length;
  const points: Point[] = [start];
  const steps = 18;
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const side =
      bow * length * 4 * t * (1 - t) +
      wobble *
        (valueNoise(t * 7, seed) * 0.009 +
          valueNoise(t * 19, seed + 1) * 0.003) *
        Math.min(1, t * 3);
    points.push({
      x: start.x + dx * t + nx * side,
      y: start.y + dy * t + ny * side,
    });
  }
  points.push(end);
  return points;
}

/**
 * The corners of `polygon` from `a` to `b` the short way round, which is along the one edge they
 * share rather than around the whole face.
 */
function edgeRun(polygon: readonly Point[], a: Point, b: Point): Point[] {
  const n = polygon.length;
  const from = polygon.indexOf(a);
  const to = polygon.indexOf(b);
  invariant(from >= 0 && to >= 0, "Both ends of a run must be corners.");
  const forward = (to - from + n) % n;
  const run: Point[] = [];
  if (forward <= n - forward) {
    for (let i = 0; i <= forward; i += 1) {
      run.push(at(polygon, (from + i) % n));
    }
  } else {
    for (let i = 0; i <= n - forward; i += 1) {
      run.push(at(polygon, (from - i + n) % n));
    }
  }
  return run;
}

/**
 * The free side of a band along `run`: the run's own line, every jag of it, pushed into `polygon`
 * by a swell that is `bulge` of the run's length at its fullest, fuller toward the start, like a
 * leaf hung from its stem, and nothing at either end.
 */
function swell(
  run: readonly Point[],
  polygon: readonly Point[],
  bulge: number,
  seed: number,
): Point[] {
  // Even out the run, so the band's edge is smooth however the corners fall along it.
  const lengths = [0];
  for (let i = 1; i < run.length; i += 1) {
    const a = at(run, i - 1);
    const b = at(run, i);
    lengths.push(at(lengths, i - 1) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = at(lengths, lengths.length - 1);
  invariant(total > 0, "A band needs room along its edge.");
  const steps = 14;
  const even: Point[] = [];
  let segment = 0;
  for (let i = 0; i <= steps; i += 1) {
    const target = (total * i) / steps;
    while (segment < run.length - 2 && at(lengths, segment + 1) < target) {
      segment += 1;
    }
    const a = at(run, segment);
    const b = at(run, segment + 1);
    const span = at(lengths, segment + 1) - at(lengths, segment);
    const f = span > 0 ? (target - at(lengths, segment)) / span : 0;
    even.push({ x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) });
  }

  // Push in along the run's own normal, toward whichever side the face lies on.
  const normals = even.map((_point, i) => {
    const before = at(even, Math.max(0, i - 1));
    const after = at(even, Math.min(even.length - 1, i + 1));
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.hypot(dx, dy);
    invariant(length > 0, "A band's edge cannot double back on itself.");
    return { x: -dy / length, y: dx / length };
  });
  const middle = at(even, steps / 2);
  const probe = at(normals, steps / 2);
  const reach = 0.02 * bulge * total;
  const side = contains(polygon, {
    x: middle.x + probe.x * reach,
    y: middle.y + probe.y * reach,
  })
    ? 1
    : -1;
  return even.map((p, i) => {
    if (i === 0 || i === steps) {
      return i === 0 ? at(run, 0) : at(run, run.length - 1);
    }
    const t = i / steps;
    const push =
      side *
      (bulge * total * Math.sin(Math.PI * t) * (1 - 0.35 * t) +
        valueNoise(t * 5, seed) * 0.002 * Math.sin(Math.PI * t));
    const normal = at(normals, i);
    return { x: p.x + normal.x * push, y: p.y + normal.y * push };
  });
}

/** A line along `points` as a filled shape, as wide at each point as `widths` says. */
function taper(points: readonly Point[], widths: readonly number[]): Path2D {
  invariant(
    widths.length === points.length,
    "A line needs a width at every point.",
  );
  const sides = points.map((p, i) => {
    const before = at(points, Math.max(0, i - 1));
    const after = at(points, Math.min(points.length - 1, i + 1));
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.hypot(dx, dy);
    invariant(length > 0, "A line cannot double back on itself.");
    const half = at(widths, i) / 2;
    return {
      left: { x: p.x - (dy / length) * half, y: p.y + (dx / length) * half },
      right: { x: p.x + (dy / length) * half, y: p.y - (dx / length) * half },
    };
  });
  const path = new Path2D();
  sides.forEach(({ left }, i) => {
    if (i === 0) {
      path.moveTo(left.x, left.y);
    } else {
      path.lineTo(left.x, left.y);
    }
  });
  for (const { right } of [...sides].reverse()) {
    path.lineTo(right.x, right.y);
  }
  path.closePath();
  return path;
}

/**
 * Parallel lines across a face with corners `points`, running across the length of the face as
 * `carved`, from its highest corner to its lowest, and leaning off square to that toward `lean`,
 * cut to the face's outline, and split into every other line and the lines between.
 */
function hatching(
  points: readonly Point[],
  carved: readonly Point[],
  lean: 1 | -1,
  scale: number,
): { sparse: Path2D; dense: Path2D } {
  const crest = carved.reduce((a, b) => (b.y < a.y ? b : a));
  const deepest = Math.max(...carved.map((p) => p.y));
  const floor = carved.filter((p) => p.y === deepest);
  const base = {
    x: floor.reduce((sum, p) => sum + p.x, 0) / floor.length,
    y: deepest,
  };
  const axis = Math.atan2(base.y - crest.y, base.x - crest.x);
  const across = axis + Math.PI / 2 - lean * HATCH_TILT;
  const ux = Math.cos(across);
  const uy = Math.sin(across);
  // Step along the normal to the lines, from the face's nearest point to its farthest.
  const nx = -uy;
  const ny = ux;
  const offsets = points.map((p) => p.x * nx + p.y * ny);
  const low = Math.min(...offsets);
  const high = Math.max(...offsets);
  const gap = HATCH_GAP * scale;
  const sparse = new Path2D();
  const dense = new Path2D();
  let line = 0;
  for (let offset = low + gap / 2; offset < high; offset += gap) {
    const path = line % 2 === 0 ? sparse : dense;
    line += 1;
    // Where the line crosses the outline, in order along it: inside between each pair.
    const hits: number[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const a = at(points, i);
      const b = at(points, (i + 1) % points.length);
      const da = at(offsets, i) - offset;
      const db = at(offsets, (i + 1) % points.length) - offset;
      if (da > 0 !== db > 0) {
        const f = da / (da - db);
        hits.push(lerp(a.x, b.x, f) * ux + lerp(a.y, b.y, f) * uy);
      }
    }
    hits.sort((a, b) => a - b);
    for (let i = 0; i + 1 < hits.length; i += 2) {
      const from = at(hits, i);
      const to = at(hits, i + 1);
      path.moveTo(nx * offset + ux * from, ny * offset + uy * from);
      path.lineTo(nx * offset + ux * to, ny * offset + uy * to);
    }
  }
  return { sparse, dense };
}
