import { middleReach } from "./flowers";
import { lit, mix, type Rgb } from "./sky";
import { at, clamp, lerp, smoothstep } from "./util";
import { SNOW_COLOR } from "./weather";

/** Snow lying on a flower as deep as it holds hides this much of its color. */
const SNOW_COVER = 0.8;

/**
 * Outline around every petal, as a fraction of the flower's size, and its limits in CSS pixels.
 * A small flower gets a fine outline so its color still reads.
 */
const OUTLINE = { width: 0.04, min: 0.45, max: 1.1 } as const;
/** Ink of the sepals and outlines: the wood's ink, with the outlines a little softer. */
const INK: Rgb = [42, 33, 26];
const OUTLINE_ALPHA = 0.85;
/**
 * A cluster's outlines come in from `faint` as strong, as its blossoms grow from `from`
 * to `to` CSS pixels across, so one just come into detail is near the flat marks around it.
 */
const OUTLINE_FADE = { faint: 0.3, from: 10, to: 24 } as const;
/** Fine lines inside the petals, in CSS pixels. */
const VEIN_PX = 0.7;
/** The fine lines fade in as a flower is drawn between these sizes, in CSS pixels. */
const DETAIL_PX = { from: 14, to: 30 } as const;

/**
 * Colors of a living blossom's petals: deep pink where each starts, at the blossom's heart,
 * paling to its rim.
 */
const LIVING: { base: Rgb; tip: Rgb } = {
  base: [230, 122, 152],
  tip: [253, 230, 234],
};

/** A color a flower turns late in the year, blending in over its span of the year. */
interface Stage {
  from: number;
  to: number;
  base: Rgb;
  tip: Rgb;
}

/**
 * Colors a blossom turns as the year ends, in order, from midsummer at 0 to winter at 1: yellow,
 * then orange, then brown, then dead.
 */
const AUTUMN: readonly Stage[] = [
  { from: 0.26, to: 0.44, base: [222, 170, 62], tip: [240, 206, 110] },
  { from: 0.44, to: 0.6, base: [200, 106, 44], tip: [228, 146, 70] },
  { from: 0.6, to: 0.76, base: [126, 78, 44], tip: [156, 104, 62] },
  { from: 0.76, to: 0.9, base: [76, 52, 34], tip: [98, 70, 48] },
];

/** Late in the year petals go limp: they droop, narrow and curl over this span of the year. */
const WILT = { from: 0.55, to: 0.9 } as const;

/**
 * Size of one of a cluster's blossoms, as a fraction of the cluster's. Its outline and
 * fine lines are drawn as a flower's of that size would be, so a cluster never clots with ink.
 */
const CLUSTER_PART = 0.25;

/**
 * How a mound packs its clusters: as many as `fill` times the square of how many clusters across
 * it is, in a dome reaching `top` above its middle and `underside` below, as fractions of the
 * mound's height.
 */
const MOUND = {
  fill: 1.1,
  top: 0.44,
  underside: 0.26,
} as const;
/** Turn between one cluster of a mound and the next, so they spread evenly. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * How clusters look from afar, after the populated trees in the references: every blossom a flat
 * mark with no outline.
 */
const MARKS = {
  /** Radius of one blossom, as a fraction of its cluster's size. */
  radius: 0.155,
  /**
   * A cluster whose blossoms show smaller in radius than somewhere between these, in
   * CSS pixels, is painted as marks; larger, in full detail.
   */
  detailPx: { from: 7, to: 10 },
  /** Marks at least this large in radius, in CSS pixels, take their blossom's shape. */
  shapedPx: 2.5,
  /** A blossom's mark at least this large in radius shows its heart, this much darker. */
  heartPx: 5,
  heartShade: 0.78,
  /** No mark is smaller than this in radius; a far mound is painted with fewer, larger ones. */
  minPx: 1.8,
  /** Most marks painted in a frame; past it, every flower is painted with fewer, larger ones. */
  budget: 16000,
  /** Most blossoms drawn in detail in a frame. */
  detailBudget: 1500,
  /**
   * How a mark's tone is chosen: from how high its cluster sits in its mound, how open its mound
   * is to the sky, whether it sits at the front of its cluster, and a little at random. Below
   * `shadow` it takes the shadow tone, from `light` up the light one, and the middle tone between.
   */
  tone: {
    lit: 0.35,
    exposure: 0.5,
    front: 0.25,
    jitter: 0.45,
    shadow: 0.28,
    light: 0.6,
  },
  /** A mound's exposure is taken in this many steps, so its marks are rebuilt only now and then. */
  exposureSteps: 6,
} as const;

/**
 * A blossom's mark: the notches between its petals this far out, as a fraction of their reach,
 * and the pull of each petal's curve, enough to bring its tip out to the full reach.
 */
const BLOSSOM_MARK = { notch: 0.5, pull: 1.6 } as const;

/**
 * The shadow, middle and light tones marks are painted in: so far from a petal's color
 * at its base toward the color at its tip, then darkened to `shade`.
 */
const TONES: readonly { toTip: number; shade: number }[] = [
  { toTip: 0.2, shade: 0.86 },
  { toTip: 0.6, shade: 1 },
  { toTip: 0.95, shade: 1 },
];

/** A curve in a part's own frame, as a start point and then three points per cubic bezier. */
type Curve = readonly (readonly [number, number])[];

/**
 * A cherry cluster: blossoms on long thin stalks from one spur, drawn back to front. Each sits at
 * (x, y) with radius `r`, and shows `squash` of its height as it tips away from the viewer about
 * an axis turned `turn` from level.
 */
const CHERRY: readonly {
  x: number;
  y: number;
  r: number;
  turn: number;
  squash: number;
}[] = [
  { x: -0.3, y: 0.62, r: 0.15, turn: 0.6, squash: 0.62 },
  { x: 0.29, y: 0.66, r: 0.15, turn: -0.7, squash: 0.66 },
  { x: 0, y: 0.74, r: 0.14, turn: -0.15, squash: 0.55 },
  { x: -0.45, y: 0.38, r: 0.15, turn: 1.2, squash: 0.78 },
  { x: 0.44, y: 0.42, r: 0.15, turn: -1.1, squash: 0.84 },
  { x: -0.16, y: 0.47, r: 0.17, turn: 0.3, squash: 0.95 },
  { x: 0.17, y: 0.45, r: 0.17, turn: -0.4, squash: 1 },
  { x: 0, y: 0.28, r: 0.15, turn: 0.1, squash: 0.85 },
];
/** The blossoms before this index in `CHERRY` sit behind the rest, in their shade. */
const CHERRY_BACK = 3;
/** Buds among a cherry cluster's blossoms: where each sits, its length, and its lean leftward. */
const CHERRY_BUDS: readonly {
  x: number;
  y: number;
  length: number;
  turn: number;
}[] = [
  { x: 0.12, y: 0.86, length: 0.11, turn: -0.25 },
  { x: -0.6, y: 0.56, length: 0.1, turn: 0.95 },
];
/** Height of the spur a cherry cluster's blossom stalks spring from. */
const CHERRY_SPUR = 0.1;
/** Stamens ringing a cherry blossom's heart. */
const CHERRY_STAMENS = 9;
/** Radius of a cherry blossom's deep heart, as a fraction of its petals' reach. */
const CHERRY_HEART = 0.2;
/** Shade of the blossoms at the back of a cherry cluster, and of a blossom's heart. */
const CHERRY_BACK_SHADE = 0.86;
const HEART_SHADE = 0.62;
/** A cherry bud from its stalk out along +y: a plump teardrop. */
const CHERRY_BUD: Curve = [
  [0, 0],
  [0.55, 0.1],
  [0.42, 0.75],
  [0, 1],
  [-0.42, 0.75],
  [-0.55, 0.1],
  [0, 0],
];
/** A cherry petal from the blossom's heart out along +y, with a notch in its rim. */
const CHERRY_PETAL: Curve = [
  [0, 0],
  [0.3, 0.24],
  [0.54, 0.6],
  [0.38, 0.9],
  [0.3, 1.03],
  [0.1, 1.03],
  [0, 0.9],
  [-0.1, 1.03],
  [-0.3, 1.03],
  [-0.38, 0.9],
  [-0.54, 0.6],
  [-0.3, 0.24],
  [0, 0],
];

/** The fine lines inside petals: their width in the flower's own units, and how strongly they show. */
interface Vein {
  width: number;
  alpha: number;
}

/** The colors a flower is drawn in, already lit: its petals at their base and tip, and its inks. */
interface Paint {
  base: Rgb;
  tip: Rgb;
  ink: string;
  outline: string;
}

/** How to draw one flower. Positions and sizes are in CSS pixels. */
export interface FlowerLook {
  /** Where the flower's base is, at the end of its stalk. */
  x: number;
  y: number;
  /** The way the flower faces, in radians counterclockwise from the right, with y up. */
  angle: number;
  size: number;
  /** From 0, closed into a bud, to 1, fully open. */
  openness: number;
  /** The time of year it shows, from midsummer at 0 to winter at 1. */
  age: number;
  alpha: number;
  /** Fixed for each flower, from 0 to 1, for the small differences between flowers. */
  variant: number;
  /** How many times the size of one cluster a mound of clusters spans; 1 for a lone flower. */
  clusters: number;
  /** How open to the sky it is, from 0 deep in the canopy to 1 on top of it. */
  exposure: number;
  /** How much snow lies on it, from 0 to 1, the most it holds. */
  snow: number;
  /** Multipliers on every color, for the light at this time of day. */
  light: Rgb;
}

/**
 * How much of its true width to draw the stalk of a flower `size` CSS pixels across at, so that
 * where it meets a cluster drawn in detail it is no wider than the spur the cluster's own drawing
 * starts from, whose ink stops thickening once the cluster shows large.
 */
export function stalkFit(size: number, clusters: number): number {
  const part = (CLUSTER_PART * size) / clusters;
  return Math.min(1, OUTLINE.max / (part * OUTLINE.width));
}

/** Draws a flower. Sets the transform itself, so the caller's is lost. */
export function drawFlower(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  look: FlowerLook,
): void {
  const { size } = look;
  const sin = Math.sin(look.angle);
  const cos = Math.cos(look.angle);
  // Local units are the flower's size, with y along the way it faces and x to its right.
  ctx.setTransform(
    size * sin * dpr,
    size * cos * dpr,
    size * cos * dpr,
    -size * sin * dpr,
    look.x * dpr,
    look.y * dpr,
  );
  // The size of the smallest whole thing drawn, in CSS pixels: one of a mound's blossoms.
  const part = (CLUSTER_PART * size) / look.clusters;
  const line = clamp(part * OUTLINE.width, OUTLINE.min, OUTLINE.max) / size;
  const vein: Vein = {
    width: VEIN_PX / size,
    alpha: smoothstep(DETAIL_PX.from, DETAIL_PX.to, part),
  };
  const colors = petalColors(look.age, look.snow);
  const ink = lit(INK, look.light);
  const outline =
    OUTLINE_ALPHA *
    lerp(
      OUTLINE_FADE.faint,
      1,
      smoothstep(OUTLINE_FADE.from, OUTLINE_FADE.to, part),
    );
  const paint: Paint = {
    base: lit(colors.base, look.light),
    tip: lit(colors.tip, look.light),
    ink: css(ink),
    outline: `rgba(${Math.round(ink[0])}, ${Math.round(ink[1])}, ${Math.round(ink[2])}, ${outline})`,
  };
  const wilt = smoothstep(WILT.from, WILT.to, look.age);
  const open = easeInOut(look.openness);
  ctx.globalAlpha = look.alpha;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const members = moundLayout(look.clusters, look.variant);
  drawMound(ctx, members, open, wilt, paint, line, vein);
  ctx.globalAlpha = 1;
}

/**
 * Petal colors at a time of year: the living colors, turned by however much of autumn has passed,
 * and whitened by `snow` lying on them, from 0 to 1, the most they hold.
 */
function petalColors(age: number, snow: number): { base: Rgb; tip: Rgb } {
  let { base, tip } = LIVING;
  for (const stage of AUTUMN) {
    const t = smoothstep(stage.from, stage.to, age);
    if (t <= 0) {
      break;
    }
    base = mix(base, stage.base, t);
    tip = mix(tip, stage.tip, t);
  }
  const cover = SNOW_COVER * snow;
  return {
    base: mix(base, SNOW_COLOR, cover),
    tip: mix(tip, SNOW_COLOR, cover),
  };
}

/** How many clusters a mound `clusters` times the size of one is packed with. */
function memberCount(clusters: number): number {
  return clusters <= 1
    ? 1
    : Math.max(2, Math.round(MOUND.fill * clusters * clusters));
}

/** One cluster of a mound: its base and size in the mound's units, and its own variant. */
interface Member {
  x: number;
  y: number;
  scale: number;
  variant: number;
}

/**
 * The clusters of a mound `clusters` times the size of one, back to front: packed into a dome
 * with a flattened underside, each turned its own way, its middle as far beyond the mound's base
 * as `middleReach` says. A mound of one is a single cluster.
 */
function moundLayout(clusters: number, variant: number): Member[] {
  if (clusters <= 1) {
    return [{ x: 0, y: 0, scale: 1, variant }];
  }
  const count = memberCount(clusters);
  const scale = 1 / clusters;
  const middle = middleReach(clusters);
  const members: Member[] = [];
  for (let i = 0; i < count; i += 1) {
    const r = Math.sqrt((i + 0.5) / count);
    const a = i * GOLDEN_ANGLE + variant * Math.PI * 2;
    const up = Math.sin(a);
    const depth = up > 0 ? MOUND.top : MOUND.underside;
    members.push({
      x: r * Math.cos(a) * (0.5 - 0.55 * scale),
      // Its base, below the middle of its cluster.
      y: middle + r * up * depth * (1 - scale) - 0.55 * scale,
      scale: scale * (0.88 + 0.24 * hash(i, variant)),
      variant: hash(i + 101, variant),
    });
  }
  return members.sort((a, b) => b.y - a.y);
}

/**
 * A mound of clusters near enough to show their blossoms: a twig from the mound's base out to
 * each cluster, then the clusters back to front.
 */
function drawMound(
  ctx: CanvasRenderingContext2D,
  members: readonly Member[],
  open: number,
  wilt: number,
  paint: Paint,
  line: number,
  vein: Vein,
): void {
  if (members.length > 1) {
    // A few branches fork from the base, each carrying the twigs of the clusters on its side.
    const byX = [...members].sort((a, b) => a.x - b.x);
    const forks = Math.min(3, Math.ceil(members.length / 4));
    ctx.strokeStyle = paint.ink;
    for (let f = 0; f < forks; f += 1) {
      const own = byX.slice(
        Math.floor((f * byX.length) / forks),
        Math.floor(((f + 1) * byX.length) / forks),
      );
      const x = own.reduce((sum, m) => sum + m.x, 0) / own.length;
      const y = own.reduce((sum, m) => sum + m.y, 0) / own.length;
      const node = { x: 0.5 * x, y: 0.45 * y };
      ctx.lineWidth = line * 1.8;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(0.1 * node.x, 0.6 * node.y, node.x, node.y);
      ctx.stroke();
      ctx.lineWidth = line * 1.1;
      ctx.beginPath();
      for (const m of own) {
        ctx.moveTo(node.x, node.y);
        ctx.quadraticCurveTo(
          lerp(node.x, m.x, 0.3),
          lerp(node.y, m.y, 0.7),
          m.x,
          m.y,
        );
      }
      ctx.stroke();
    }
  }
  for (const m of members) {
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.scale(m.scale, m.scale);
    // Widths given in the mound's units, so lines keep their width in pixels.
    const own: Vein = { width: vein.width / m.scale, alpha: vein.alpha };
    drawCherry(ctx, open, wilt, paint, line / m.scale, own, m.variant);
    ctx.restore();
  }
}

/**
 * Which of the flowers in view are drawn in detail; the rest are painted as marks by `drawMarks`.
 * A cluster comes into detail once its blossoms show large enough, each at a size of its own
 * within `MARKS.detailPx`, so a canopy comes into detail a few clusters at a time as the view
 * closes in. Only so many blossoms are drawn in detail at once, those nearest `focus` first, so a
 * full canopy filling the view stays quick to draw: the detail spreads out from the middle of the
 * view as it closes in.
 */
export function inDetail(
  looks: readonly FlowerLook[],
  focus: { x: number; y: number },
): boolean[] {
  const detailed = looks.map(() => false);
  const ready = looks.flatMap((look, i) => {
    const size = lerp(MARKS.detailPx.from, MARKS.detailPx.to, look.variant);
    return markRadius(look) < size
      ? []
      : [
          {
            i,
            parts: partsOf(look.clusters),
            distance: Math.hypot(look.x - focus.x, look.y - focus.y),
          },
        ];
  });
  ready.sort((a, b) => a.distance - b.distance);
  let left = MARKS.detailBudget;
  for (const { i, parts } of ready) {
    if (parts > left) {
      break;
    }
    left -= parts;
    detailed[i] = true;
  }
  return detailed;
}

/**
 * Paints clusters too small to show in detail, after the populated trees of the references: every
 * blossom a flat mark with no outline, in a shadow, a middle or a light tone. They are all painted
 * together, a tone at a time, the shadow first, so light lies over the top of a canopy and shade
 * gathers inside it. Sets the transform itself, so the caller's is lost.
 */
export function drawMarks(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  looks: readonly FlowerLook[],
): void {
  // Flowers within a step of each other in age, snow and fading share their colors, and are
  // painted as one.
  const groups = new Map<
    string,
    {
      age: number;
      snow: number;
      alpha: number;
      light: Rgb;
      tones: Path2D[];
      hearts: Path2D[];
    }
  >();
  // Each flower's marks are as many as keeps each of them a few pixels across; if all of them
  // together would be more than a frame can afford, every flower is painted with fewer, larger
  // ones.
  const sized = looks.map((look) => {
    const radius = markRadius(look);
    return { look, radius, every: everyFor(radius) };
  });
  const total = sized.reduce(
    (sum, s) => sum + partsOf(s.look.clusters) / s.every,
    0,
  );
  const thinning =
    total > MARKS.budget ? 2 ** Math.ceil(Math.log2(total / MARKS.budget)) : 1;

  for (const { look, radius, every } of sized) {
    const age = Math.round(look.age * 50) / 50;
    const snow = Math.round(look.snow * 10) / 10;
    const alpha = Math.round(look.alpha * 10) / 10;
    const key = `${age} ${snow} ${alpha} ${look.light.join(" ")}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        age,
        snow,
        alpha,
        light: look.light,
        tones: TONES.map(() => new Path2D()),
        hearts: TONES.map(() => new Path2D()),
      };
      groups.set(key, group);
    }
    const marks = marksOf(look, markLevel(radius, every * thinning));
    const sin = Math.sin(look.angle);
    const cos = Math.cos(look.angle);
    // The same frame `drawFlower` draws in.
    const placed = new DOMMatrix([
      look.size * sin * dpr,
      look.size * cos * dpr,
      look.size * cos * dpr,
      -look.size * sin * dpr,
      look.x * dpr,
      look.y * dpr,
    ]);
    for (const [i, path] of marks.tones.entries()) {
      at(group.tones, i).addPath(path, placed);
    }
    for (const [i, path] of (marks.hearts ?? []).entries()) {
      at(group.hearts, i).addPath(path, placed);
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const group of groups.values()) {
    const { base, tip } = petalColors(group.age, group.snow);
    ctx.globalAlpha = group.alpha;
    for (const [i, tone] of TONES.entries()) {
      ctx.fillStyle = css(
        lit(mix(base, tip, tone.toTip), group.light),
        tone.shade,
      );
      ctx.fill(at(group.tones, i));
      ctx.fillStyle = css(lit(base, group.light), MARKS.heartShade);
      ctx.fill(at(group.hearts, i));
    }
  }
  ctx.globalAlpha = 1;
}

/** Radius of one of a cluster's blossoms as it shows, in CSS pixels. */
function markRadius(look: { size: number; clusters: number }): number {
  return (MARKS.radius * look.size) / look.clusters;
}

/** How many blossoms a mound `clusters` times the size of one cluster carries. */
function partsOf(clusters: number): number {
  return CHERRY.length * memberCount(clusters);
}

/**
 * How few of a flower's blossoms `radius` pixels across get a mark, one in so many,
 * so that grown to cover for the rest, none is smaller than the smallest mark.
 */
function everyFor(radius: number): number {
  return radius >= MARKS.minPx
    ? 1
    : 2 ** Math.ceil(Math.log2((MARKS.minPx / radius) ** 2));
}

/** How a far flower's marks are drawn at the size it shows. */
interface MarkLevel {
  /** Whether each mark takes its blossom's shape, or is a plain oval. */
  shaped: boolean;
  /** Whether a blossom's mark shows its deep heart. */
  hearts: boolean;
  /** Only one in this many blossoms gets a mark, grown to cover for the rest. */
  every: number;
}

/** How the marks of blossoms `radius` pixels across are drawn, one in `every`. */
function markLevel(radius: number, every: number): MarkLevel {
  const drawn = radius * Math.sqrt(every);
  return {
    shaped: drawn >= MARKS.shapedPx,
    hearts: drawn >= MARKS.heartPx,
    every,
  };
}

/** A far flower's marks in its own units: a path for each tone, and the hearts on each. */
interface Marks {
  tones: readonly Path2D[];
  hearts: readonly Path2D[] | undefined;
}

/**
 * Marks built so far, so a flower that keeps its shape and its size on screen from one frame to
 * the next is not built again. Cleared once it holds this many.
 */
const marksCache = new Map<string, Marks>();
const MARKS_CACHE_LIMIT = 4000;

/**
 * A far flower's marks, built once for each shape it takes. Openness and wilting change in small
 * steps, so a flower growing in or wilting is rebuilt only now and then.
 */
function marksOf(look: FlowerLook, level: MarkLevel): Marks {
  const open = Math.round(easeInOut(look.openness) * 40) / 40;
  const wilt = Math.round(smoothstep(WILT.from, WILT.to, look.age) * 40) / 40;
  const steps = MARKS.exposureSteps - 1;
  const exposure = Math.round(look.exposure * steps) / steps;
  const key = `${look.clusters} ${look.variant} ${open} ${wilt} ${exposure} ${level.shaped} ${level.hearts} ${level.every}`;
  const cached = marksCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  if (marksCache.size >= MARKS_CACHE_LIMIT) {
    marksCache.clear();
  }
  const built = buildMarks(
    look.clusters,
    look.variant,
    open,
    wilt,
    exposure,
    level,
  );
  marksCache.set(key, built);
  return built;
}

/**
 * The marks of a mound `clusters` times the size of one cluster, laid where its blossoms lie when
 * drawn in detail, so each mark becomes its blossom as the view closes in. A mound open to the
 * sky, a cluster near the top of its mound and a blossom at the front of its cluster are each the
 * likelier to take the light tone.
 */
function buildMarks(
  clusters: number,
  variant: number,
  open: number,
  wilt: number,
  exposure: number,
  level: MarkLevel,
): Marks {
  const members = moundLayout(clusters, variant);
  const heights = members.map((m) => m.y);
  const low = Math.min(...heights);
  const high = Math.max(...heights);
  const tones = TONES.map(() => new Path2D());
  const hearts = level.hearts ? TONES.map(() => new Path2D()) : undefined;
  const grow = Math.sqrt(level.every);
  let count = 0;
  // The tone the next blossom takes, or nothing if it is one of those left out.
  const toneOf = (lit: number, back: boolean): number | undefined => {
    count += 1;
    if (count % level.every !== 0) {
      return undefined;
    }
    const { tone } = MARKS;
    const t =
      tone.lit * lit +
      tone.exposure * (exposure - 0.5) +
      (back ? 0 : tone.front) +
      tone.jitter * (hash(count, variant) - 0.5);
    return t < tone.shadow ? 0 : t < tone.light ? 1 : 2;
  };

  for (const m of members) {
    const lit = high > low ? (m.y - low) / (high - low) : 0.5;
    const { blossoms, buds, petal } = cherryLayout(open, wilt, m.variant);
    for (const b of blossoms) {
      const t = toneOf(lit, b.back);
      if (t === undefined) {
        continue;
      }
      const placed: Blossom = {
        ...b,
        x: m.x + b.x * m.scale,
        y: m.y + b.y * m.scale,
        r: b.r * m.scale * grow,
      };
      const path = at(tones, t);
      if (level.shaped) {
        const reach = placed.r * petal;
        const f = frame(
          placed.x,
          placed.y,
          placed.turn,
          reach,
          reach * placed.squash,
        );
        blossomMark(path, f, placed.spin);
      } else {
        const r = placed.r * petal;
        oval(path, placed.x, placed.y, r, r * placed.squash, placed.turn);
      }
      if (hearts !== undefined) {
        blossomHeart(at(hearts, t), placed, petal);
      }
    }
    // Buds show only while every blossom has its own mark, in the shadow tone.
    if (level.every === 1) {
      for (const bud of buds) {
        const length = bud.length * m.scale;
        const reach = 0.5 * length;
        oval(
          at(tones, 0),
          m.x + bud.x * m.scale - Math.sin(bud.turn) * reach,
          m.y + bud.y * m.scale + Math.cos(bud.turn) * reach,
          0.42 * length,
          0.5 * length,
          bud.turn,
        );
      }
    }
  }
  return { tones, hearts };
}

/**
 * Adds a blossom's mark to the path: five rounded petals reaching the edge of its frame `f`,
 * the first turned `spin`, as in the blossom drawn in detail.
 */
function blossomMark(path: CanvasPath, f: Frame, spin: number): void {
  // Each petal is one curve from the notch before it to the notch after it, pulled out far
  // enough that it reaches the frame's edge.
  const point = (a: number, reach: number): [number, number] =>
    place(f, -Math.sin(a) * reach, Math.cos(a) * reach);
  const step = (Math.PI * 2) / 5;
  const [x0, y0] = point(spin - step / 2, BLOSSOM_MARK.notch);
  path.moveTo(x0, y0);
  for (let k = 0; k < 5; k += 1) {
    const a = spin + k * step;
    const [cx, cy] = point(a, BLOSSOM_MARK.pull);
    const [x, y] = point(a + step / 2, BLOSSOM_MARK.notch);
    path.quadraticCurveTo(cx, cy, x, y);
  }
  path.closePath();
}

/** Adds an oval to the path, `rx` across and `ry` along, its axes turned `turn` to the left. */
function oval(
  path: CanvasPath,
  x: number,
  y: number,
  rx: number,
  ry: number,
  turn: number,
): void {
  path.moveTo(x + rx * Math.cos(turn), y + rx * Math.sin(turn));
  path.ellipse(x, y, rx, ry, turn, 0, Math.PI * 2);
}

/** A number from 0 to 1 that looks random, fixed for each `i` and `seed`. */
function hash(i: number, seed: number): number {
  const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** A cherry blossom of a cluster, in the cluster's units. */
interface Blossom {
  x: number;
  y: number;
  r: number;
  /** Turn of the axis it tips away from the viewer about, and how much of its height shows. */
  turn: number;
  squash: number;
  /** Whether it sits behind the others, in their shade. */
  back: boolean;
  /** Turn of its first petal. */
  spin: number;
}

/** A cherry bud, from its stalk out along a lean to the left of `turn`, in the cluster's units. */
interface Bud {
  x: number;
  y: number;
  length: number;
  turn: number;
}

/**
 * Where a cherry cluster's blossoms and buds lie as it opens and wilts, back to front, and the
 * length of their petals as a fraction of each blossom's radius.
 */
function cherryLayout(
  open: number,
  wilt: number,
  variant: number,
): { blossoms: Blossom[]; buds: Bud[]; petal: number } {
  const flip = variant < 0.5 ? -1 : 1;
  // A third of the clusters carry one blossom fewer.
  const missing = Math.floor(variant * 12) % 3 === 0 ? 2 : -1;
  const gather = lerp(0.45, 1, open);
  const rise = (y: number): number =>
    lerp(CHERRY_SPUR + 0.1, y, gather) - 0.14 * wilt * (y - CHERRY_SPUR);
  const blossoms = CHERRY.flatMap((b, i) =>
    i === missing
      ? []
      : [
          {
            x: flip * b.x * gather,
            y: rise(b.y),
            r: b.r * lerp(0.4, 1, open),
            turn: flip * b.turn,
            squash: b.squash * (1 - 0.3 * wilt),
            back: i < CHERRY_BACK,
            spin: variant * 7 + i * 1.3 + 0.3 * wilt,
          },
        ],
  );
  const buds = CHERRY_BUDS.map((bud) => ({
    x: flip * bud.x * gather,
    y: rise(bud.y),
    length: bud.length * lerp(0.6, 1, open),
    turn: flip * bud.turn,
  }));
  return {
    blossoms,
    buds,
    petal: lerp(0.6, 1, open) * (1 - 0.12 * wilt),
  };
}

/**
 * A cherry cluster: blossoms on long thin stalks from one spur, each of five notched petals, deep
 * pink at its heart and pale at its rim, ringed with stamens; and a bud or two among them.
 */
function drawCherry(
  ctx: CanvasRenderingContext2D,
  open: number,
  wilt: number,
  paint: Paint,
  line: number,
  vein: Vein,
  variant: number,
): void {
  const { blossoms, buds, petal } = cherryLayout(open, wilt, variant);

  // The spur, and a stalk from it to each blossom and bud.
  ctx.strokeStyle = paint.ink;
  ctx.lineWidth = line * 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, CHERRY_SPUR);
  ctx.stroke();
  ctx.lineWidth = line * 1.1;
  ctx.beginPath();
  for (const end of [...blossoms, ...buds]) {
    ctx.moveTo(0, CHERRY_SPUR);
    ctx.quadraticCurveTo(
      0.2 * end.x,
      lerp(CHERRY_SPUR, end.y, 0.8),
      end.x,
      end.y,
    );
  }
  ctx.stroke();

  ctx.strokeStyle = paint.outline;
  ctx.lineWidth = line;
  ctx.fillStyle = css(paint.base, 0.9);
  for (const bud of buds) {
    ctx.beginPath();
    trace(
      ctx,
      CHERRY_BUD,
      frame(bud.x, bud.y, bud.turn, bud.length, bud.length),
      0,
      1,
    );
    ctx.fill();
    ctx.stroke();
  }

  for (const b of blossoms) {
    const f = frame(b.x, b.y, b.turn, b.r, b.r * b.squash);
    const shade = b.back ? CHERRY_BACK_SHADE : 1;
    ctx.beginPath();
    blossomPetals(ctx, f, b.spin, petal);
    const fill = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * petal);
    fill.addColorStop(0.15, css(paint.base, shade));
    fill.addColorStop(1, css(paint.tip, shade));
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = paint.outline;
    ctx.lineWidth = line;
    ctx.stroke();

    // Its heart, a deeper eye.
    ctx.fillStyle = css(paint.base, HEART_SHADE * shade);
    ctx.beginPath();
    blossomHeart(ctx, b, petal);
    ctx.fill();
    if (vein.alpha > 0.01) {
      drawCherryDetail(ctx, f, b.spin, petal, paint, vein);
    }
  }
}

/** Adds a cherry blossom's five petals to the path, in the blossom's frame `f`. */
function blossomPetals(
  path: CanvasPath,
  f: Frame,
  spin: number,
  petal: number,
): void {
  for (let k = 0; k < 5; k += 1) {
    trace(path, CHERRY_PETAL, f, spin + (k / 5) * Math.PI * 2, petal);
  }
}

/** Adds a cherry blossom's heart to the path, `CHERRY_HEART` of its petals' reach across. */
function blossomHeart(path: CanvasPath, b: Blossom, petal: number): void {
  const rx = CHERRY_HEART * b.r * petal;
  path.moveTo(b.x + rx * Math.cos(b.turn), b.y + rx * Math.sin(b.turn));
  path.ellipse(b.x, b.y, rx, rx * b.squash, b.turn, 0, Math.PI * 2);
}

/** The stamens ringing a cherry blossom's heart, and a line carved down each petal. */
function drawCherryDetail(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  spin: number,
  petal: number,
  paint: Paint,
  vein: Vein,
): void {
  ctx.save();
  ctx.globalAlpha *= vein.alpha;
  ctx.lineWidth = vein.width;
  ctx.beginPath();
  const anthers: [number, number][] = [];
  for (let k = 0; k < CHERRY_STAMENS; k += 1) {
    const a = spin + 0.35 + (k / CHERRY_STAMENS) * Math.PI * 2;
    const reach = (k % 2 === 0 ? 0.44 : 0.36) * petal;
    const heart = 0.14 * petal;
    const [x0, y0] = place(f, heart * Math.cos(a), heart * Math.sin(a));
    const [x1, y1] = place(f, reach * Math.cos(a), reach * Math.sin(a));
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    anthers.push([x1, y1]);
  }
  ctx.stroke();
  const dot = 1.3 * vein.width;
  ctx.fillStyle = paint.ink;
  ctx.beginPath();
  for (const [x, y] of anthers) {
    ctx.moveTo(x + dot, y);
    ctx.arc(x, y, dot, 0, Math.PI * 2);
  }
  ctx.fill();

  ctx.globalAlpha *= 0.4;
  ctx.beginPath();
  for (let k = 0; k < 5; k += 1) {
    const a = spin + (k / 5) * Math.PI * 2;
    const from = 0.5 * petal;
    const to = 0.78 * petal;
    const [x0, y0] = place(f, -from * Math.sin(a), from * Math.cos(a));
    const [x1, y1] = place(f, -to * Math.sin(a), to * Math.cos(a));
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Where a part of a cluster lies: its own frame, stretched `across` and `along` itself, turned
 * and moved into the cluster's.
 */
interface Frame {
  x: number;
  y: number;
  cos: number;
  sin: number;
  across: number;
  along: number;
}

/** A part's frame, leaning `turn` to the left, with its base at (x, y). */
function frame(
  x: number,
  y: number,
  turn: number,
  across: number,
  along: number,
): Frame {
  return { x, y, cos: Math.cos(turn), sin: Math.sin(turn), across, along };
}

/** Where (u, v) in a part's frame lies in the cluster, with u across the part and v along it. */
function place(f: Frame, u: number, v: number): [number, number] {
  const a = u * f.across;
  const b = v * f.along;
  return [f.x + a * f.cos - b * f.sin, f.y + a * f.sin + b * f.cos];
}

/** Adds `curve` to the path, scaled to `length` and leaning `turn` to the left within the part. */
function trace(
  ctx: CanvasPath,
  curve: Curve,
  f: Frame,
  turn: number,
  length: number,
): void {
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const point = (i: number): [number, number] => {
    const [u, v] = at(curve, i);
    return place(f, (u * cos - v * sin) * length, (u * sin + v * cos) * length);
  };
  const [x, y] = point(0);
  ctx.moveTo(x, y);
  for (let i = 1; i + 2 < curve.length; i += 3) {
    const [x1, y1] = point(i);
    const [x2, y2] = point(i + 1);
    const [x3, y3] = point(i + 2);
    ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3);
  }
}

function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

function css(color: Rgb, shade = 1): string {
  return `rgb(${Math.round(color[0] * shade)}, ${Math.round(color[1] * shade)}, ${Math.round(color[2] * shade)})`;
}
