import type { FlowerKind } from "./flowers";
import type { Rgb } from "./sky";
import { at, clamp, lerp, smoothstep } from "./util";

/**
 * Outline around every petal, as a fraction of the flower's size, and its limits in CSS pixels.
 * A small flower gets a fine outline so its color still reads.
 */
const OUTLINE = { width: 0.04, min: 0.45, max: 1.1 } as const;
/** Ink of the sepals and outlines: the wood's ink, with the outlines a little softer. */
const INK: Rgb = [42, 33, 26];
const OUTLINE_ALPHA = 0.85;
/** Fine lines inside the petals, in CSS pixels. */
const VEIN_PX = 0.7;
/** The fine lines fade in as a flower is drawn between these sizes, in CSS pixels. */
const DETAIL_PX = { from: 14, to: 30 } as const;

/**
 * Colors of a living flower of each kind: where each petal or leaf starts, and at its tip. A
 * cherry blossom is deep pink at its heart and pales to its rim; a maple leaf is crimson at its
 * heart and scarlet at its tips.
 */
const LIVING: Record<FlowerKind, { base: Rgb; tip: Rgb }> = {
  lotus: { base: [248, 238, 230], tip: [220, 140, 148] },
  cherry: { base: [230, 122, 152], tip: [253, 230, 234] },
  maple: { base: [160, 36, 40], tip: [220, 76, 52] },
};

/** A color a flower turns late in the year, blending in over its span of the year. */
interface Stage {
  from: number;
  to: number;
  base: Rgb;
  tip: Rgb;
}

/** Yellow, the first color a lotus or a cherry blossom turns. */
const YELLOWING: Stage = {
  from: 0.26,
  to: 0.44,
  base: [222, 170, 62],
  tip: [240, 206, 110],
};
/** Every flower ends the year orange, then brown, then dead. */
const FADING: readonly Stage[] = [
  { from: 0.44, to: 0.6, base: [200, 106, 44], tip: [228, 146, 70] },
  { from: 0.6, to: 0.76, base: [126, 78, 44], tip: [156, 104, 62] },
  { from: 0.76, to: 0.9, base: [76, 52, 34], tip: [98, 70, 48] },
];
/**
 * Colors each kind turns as the year ends, in order, from midsummer at 0 to winter at 1. A maple
 * blazes scarlet before it browns.
 */
const AUTUMN: Record<FlowerKind, readonly Stage[]> = {
  lotus: [YELLOWING, ...FADING],
  cherry: [YELLOWING, ...FADING],
  maple: [
    { from: 0.2, to: 0.42, base: [176, 34, 24], tip: [240, 104, 38] },
    ...FADING,
  ],
};

/** Late in the year petals go limp: they droop, narrow and curl over this span of the year. */
const WILT = { from: 0.55, to: 0.9 } as const;

/** A ring of lotus petals around the flower's heart. */
interface LotusRing {
  count: number;
  /** Turn of the ring's first petal from straight ahead, as a fraction of the gap between them. */
  offset: number;
  /** How far the petals rise from flat when fully open, in radians. */
  rise: number;
  length: number;
  /** Width of each petal, as a fraction of its length. */
  width: number;
  /** How far each petal's tip curls up when fully open, as a fraction of its length. */
  curl: number;
}

/**
 * A lotus, after the sand drawings: an outer ring of broad pointed petals spread nearly flat, a
 * middle ring rising between them, and an inner ring standing up in a cup around the seed head.
 */
const LOTUS: readonly LotusRing[] = [
  { count: 8, offset: 0, rise: 0.22, length: 0.95, width: 0.52, curl: 0.12 },
  { count: 8, offset: 0.5, rise: 0.68, length: 0.8, width: 0.5, curl: 0.08 },
  { count: 6, offset: 0.25, rise: 1.18, length: 0.58, width: 0.46, curl: 0.04 },
];
/**
 * The lotus is seen from this far above the plane of its petals, in radians, so its whole face
 * shows: the petals at the back rise behind the cup and the ones at the front lie over it.
 */
const LOTUS_VIEW = 0.72;
/** Where the petals spring from: this far out from the axis closed and open, at this height. */
const LOTUS_HEART = { closed: 0.02, open: 0.07, height: 0.1 } as const;
/** How far a petal's tip hooks to one side, as a fraction of its length. */
const LOTUS_HOOK = 0.05;
/** The seed head in the middle of an open lotus: its radius, how high it sits, and its color. */
const SEED_HEAD = {
  radius: 0.12,
  height: 0.24,
  color: [210, 194, 102] as Rgb,
  holes: 7,
} as const;

/**
 * A cherry cluster or maple spray drawn smaller than somewhere between these sizes, in CSS
 * pixels, shows as a puff in its colors, or as one lobe of its mound's mass; larger, it shows
 * blossom by blossom or leaf by leaf. A whole canopy of them seen from afar is a mass of puffs.
 */
const CLUSTER_DETAIL_PX = { from: 48, to: 72 } as const;
/**
 * Size of one of a cluster's blossoms or leaves, as a fraction of the cluster's. Its outline and
 * fine lines are drawn as a flower's of that size would be, so a cluster never clots with ink.
 */
const CLUSTER_PART = 0.25;

/**
 * How a mound packs its clusters: as many as `fill` times the square of how many clusters across
 * it is, in a dome around `middle` reaching `top` above it and `underside` below, as fractions of
 * the mound's height. Seen from afar, each cluster is a lobe of the mound's mass `lobe` times the
 * cluster's size in radius, and a line is carved along the top of every lobe from `carvedFrom`
 * on, at `carving` strength, where it lies over the ones behind. The lines fade in as the lobes
 * grow between `carvedPx` in radius, in CSS pixels.
 */
const MOUND = {
  fill: 1.1,
  middle: 0.48,
  top: 0.44,
  underside: 0.26,
  lobe: 0.42,
  carvedFrom: 2,
  carving: 0.4,
  carvedPx: { from: 3, to: 6 },
  /**
   * Below this radius in CSS pixels a lobe's edge does not show, so every other cluster is left
   * out and the rest grow this much to cover for them.
   */
  coarsePx: 3,
  coarseGrowth: 1.35,
  /**
   * The deep hearts flecking a cherry's mass: so many to each cluster of a mound, in the blossoms'
   * color darkened to `shade`, fading in as the lobes grow between `fleckPx` in radius.
   */
  fleck: { perCluster: 3, shade: 0.74, alpha: 0.55 },
  fleckPx: { from: 4, to: 9 },
} as const;
/**
 * A lobe of a maple's mass is a ring of leaf points: so many points, reaching `tip` times the
 * lobe's radius out, with notches `notch` times its radius in between.
 */
const MASS_LEAF = { points: 7, tip: 1.12, notch: 0.74 } as const;
/** Turn between one cluster of a mound and the next, so they spread evenly. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Lobes of a cluster shown as a puff, around its middle at height 0.6. */
const PUFF: readonly { x: number; y: number; r: number }[] = [
  { x: -0.31, y: 0.5, r: 0.22 },
  { x: 0.32, y: 0.52, r: 0.21 },
  { x: -0.15, y: 0.74, r: 0.23 },
  { x: 0.17, y: 0.76, r: 0.22 },
  { x: 0.01, y: 0.55, r: 0.26 },
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

/**
 * A spray of Japanese maple leaves fanned out from the end of one twig, drawn back to front. Each
 * leaf's stalk leans `turn` to the left of the twig and is `reach` long, and the leaf carries on
 * the same way: `size` from its base to its longest tip, showing `squash` of its width as it
 * turns on its midrib.
 */
const MAPLE: readonly {
  turn: number;
  reach: number;
  size: number;
  squash: number;
}[] = [
  { turn: 1.1, reach: 0.16, size: 0.4, squash: 0.72 },
  { turn: -1.1, reach: 0.16, size: 0.4, squash: 0.7 },
  { turn: 0.04, reach: 0.2, size: 0.42, squash: 0.8 },
  { turn: 1.95, reach: 0.12, size: 0.34, squash: 0.85 },
  { turn: 0.56, reach: 0.12, size: 0.4, squash: 0.95 },
  { turn: -0.6, reach: 0.12, size: 0.4, squash: 0.92 },
];
/** The leaves before this index in `MAPLE` sit behind the rest, in their shade. */
const MAPLE_BACK = 3;
/** Length of a maple spray's twig, where its leaf stalks leave it. */
const MAPLE_TWIG = 0.2;
/** A maple leaf's seven lobes: each one's lean to the left of the midrib, and its length. */
const MAPLE_LOBES: readonly { turn: number; length: number }[] = [
  { turn: 1.62, length: 0.42 },
  { turn: 1.08, length: 0.7 },
  { turn: 0.54, length: 0.9 },
  { turn: 0, length: 1 },
  { turn: -0.54, length: 0.9 },
  { turn: -1.08, length: 0.7 },
  { turn: -1.62, length: 0.42 },
];
/**
 * A maple lobe from the leaf's base out along +y: broad where it joins the others in the leaf's
 * palm, then tapering to a long point.
 */
const MAPLE_LOBE: Curve = [
  [0, 0],
  [0.3, 0.16],
  [0.2, 0.6],
  [0, 1],
  [-0.2, 0.6],
  [-0.3, 0.16],
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
  kind: FlowerKind;
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
  /** Fixed for each flower, from 0 to 1, for the small differences between flowers of a kind. */
  variant: number;
  /** How many times the size of one cluster a mound of clusters spans; 1 for a lone flower. */
  clusters: number;
  /** Multipliers on every color, for the light at this time of day. */
  light: Rgb;
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
  // The size of the smallest whole thing drawn, in CSS pixels: a lotus, or one of a mound's
  // clusters' blossoms or leaves.
  const part =
    look.kind === "lotus" ? size : (CLUSTER_PART * size) / look.clusters;
  const line = clamp(part * OUTLINE.width, OUTLINE.min, OUTLINE.max) / size;
  const vein: Vein = {
    width: VEIN_PX / size,
    alpha: smoothstep(DETAIL_PX.from, DETAIL_PX.to, part),
  };
  const colors = petalColors(look.kind, look.age);
  const ink = lit(INK, look.light);
  const paint: Paint = {
    base: lit(colors.base, look.light),
    tip: lit(colors.tip, look.light),
    ink: css(ink),
    outline: `rgba(${Math.round(ink[0])}, ${Math.round(ink[1])}, ${Math.round(ink[2])}, ${OUTLINE_ALPHA})`,
  };
  const wilt = smoothstep(WILT.from, WILT.to, look.age);
  const open = easeInOut(look.openness);
  ctx.globalAlpha = look.alpha;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  switch (look.kind) {
    case "lotus":
      drawLotus(ctx, open, wilt, paint, line, vein, look.variant);
      break;
    case "cherry":
    case "maple": {
      // Each mound shows its clusters one by one at a size of its own between the limits, so
      // a canopy comes into detail a few clusters at a time as the view closes in.
      const threshold = lerp(
        CLUSTER_DETAIL_PX.from,
        CLUSTER_DETAIL_PX.to,
        look.variant,
      );
      if (size / look.clusters < threshold) {
        drawMass(
          ctx,
          look.kind,
          look.clusters,
          look.variant,
          open,
          wilt,
          paint,
          line,
          vein,
        );
      } else {
        const members = moundLayout(look.clusters, look.variant);
        drawMound(ctx, look.kind, members, open, wilt, paint, line, vein);
      }
      break;
    }
    default: {
      const unknown: never = look.kind;
      throw new Error(`Unknown flower kind ${String(unknown)}.`);
    }
  }
  ctx.globalAlpha = 1;
}

/** Petal colors at a time of year: the living colors, turned by however much of autumn has passed. */
function petalColors(kind: FlowerKind, age: number): { base: Rgb; tip: Rgb } {
  let { base, tip } = LIVING[kind];
  for (const stage of AUTUMN[kind]) {
    const t = smoothstep(stage.from, stage.to, age);
    if (t <= 0) {
      break;
    }
    base = mix(base, stage.base, t);
    tip = mix(tip, stage.tip, t);
  }
  return { base, tip };
}

function drawLotus(
  ctx: CanvasRenderingContext2D,
  open: number,
  wilt: number,
  paint: Paint,
  line: number,
  vein: Vein,
  variant: number,
): void {
  // A cup of ink where the flower sits on its stalk.
  ctx.fillStyle = paint.ink;
  ctx.beginPath();
  ctx.ellipse(0, 0.05, 0.08, 0.06, 0, 0, Math.PI * 2);
  ctx.fill();

  // Every petal and the seed head, drawn from the back of the flower to the front.
  const parts: { depth: number; draw: () => void }[] = [];
  const heart = lerp(LOTUS_HEART.closed, LOTUS_HEART.open, open);
  const turn = (variant - 0.5) * 0.5;
  LOTUS.forEach((ring, r) => {
    const outer = 1 - r / (LOTUS.length - 1);
    const length = ring.length * (1 - 0.12 * wilt);
    // Closed, each petal leans in until its tip meets the others' over the heart.
    const closed = Math.acos(-heart / length);
    const rise = lerp(closed, ring.rise, open) - 0.55 * wilt * outer * open;
    const width = ring.width * lerp(0.7, 1, open) * (1 - 0.3 * wilt);
    // Open, the tips curl up; wilting, they droop.
    const curl = (ring.curl * open - 0.15 * wilt) * length;
    for (let i = 0; i < ring.count; i += 1) {
      const petal: Petal = {
        around: turn + ((i + ring.offset) / ring.count) * Math.PI * 2,
        rise,
        heart,
        length,
        curl,
      };
      const hook = (i % 2 === 0 ? 1 : -1) * LOTUS_HOOK * open;
      parts.push({
        depth: onPetal(petal, 0.5, 0).depth,
        draw: () =>
          drawLotusPetal(ctx, petal, width, hook, paint, line, vein),
      });
    }
  });
  const seeds = open * (1 - wilt);
  if (seeds > 0.02) {
    parts.push({
      depth: project({ x: 0, y: SEED_HEAD.height, z: 0 }).depth,
      draw: () => drawSeedHead(ctx, seeds, paint, line, vein),
    });
  }
  parts.sort((a, b) => a.depth - b.depth);
  for (const part of parts) {
    part.draw();
  }
}

/** Where one lotus petal lies: around the heart, how far it rises from flat, and its curl. */
interface Petal {
  around: number;
  rise: number;
  /** How far out from the axis it springs from. */
  heart: number;
  length: number;
  /** How far its tip curls up toward the axis, in the flower's units. */
  curl: number;
}

/** A point in the flower's space: x to its right, y up its axis, z toward the viewer. */
interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Where a point in the flower's space shows, seen from above, and how near the viewer it is. */
function project(p: Point3): { x: number; y: number; depth: number } {
  const cos = Math.cos(LOTUS_VIEW);
  const sin = Math.sin(LOTUS_VIEW);
  return { x: p.x, y: p.y * cos - p.z * sin, depth: p.y * sin + p.z * cos };
}

/**
 * Where a point on a petal shows, `u` of the way from its base to its tip and `v` of its length
 * across it.
 */
function onPetal(
  petal: Petal,
  u: number,
  v: number,
): { x: number; y: number; depth: number } {
  const out = { x: Math.cos(petal.around), z: Math.sin(petal.around) };
  const up = Math.sin(petal.rise);
  const flat = Math.cos(petal.rise);
  const lift = petal.curl * u * u * u;
  return project({
    x:
      out.x * (petal.heart + flat * u * petal.length - up * lift) -
      out.z * v * petal.length,
    y: LOTUS_HEART.height + up * u * petal.length + flat * lift,
    z:
      out.z * (petal.heart + flat * u * petal.length - up * lift) +
      out.x * v * petal.length,
  });
}

/**
 * A lotus petal's outline as points along and across it, as fractions of its length: swelling
 * from the base, narrowing to a sharp tip that hooks `hook` to one side.
 */
function petalOutline(width: number, hook: number): [number, number][] {
  type Along = readonly [number, number];
  const edges: readonly (readonly [Along, Along, Along, Along])[] = [
    [
      [0, 0],
      [0.28, -0.62 * width],
      [0.78, -0.4 * width - 0.9 * hook],
      [1, -hook],
    ],
    [
      [1, -hook],
      [0.74, 0.42 * width - 0.4 * hook],
      [0.26, 0.66 * width],
      [0, 0],
    ],
  ];
  const points: [number, number][] = [];
  const steps = 10;
  for (const [a, b, c, d] of edges) {
    for (let i = points.length === 0 ? 0 : 1; i <= steps; i += 1) {
      const t = i / steps;
      const m = 1 - t;
      const w = [m * m * m, 3 * m * m * t, 3 * m * t * t, t * t * t] as const;
      points.push([
        w[0] * a[0] + w[1] * b[0] + w[2] * c[0] + w[3] * d[0],
        w[0] * a[1] + w[1] * b[1] + w[2] * c[1] + w[3] * d[1],
      ]);
    }
  }
  return points;
}

/** One lotus petal, shaded darker the further back it lies, with its carved lines. */
function drawLotusPetal(
  ctx: CanvasRenderingContext2D,
  petal: Petal,
  width: number,
  hook: number,
  paint: Paint,
  line: number,
  vein: Vein,
): void {
  const outline = petalOutline(width, hook);
  const trace = (points: readonly [number, number][]): void => {
    points.forEach(([u, v], i) => {
      const p = onPetal(petal, u, v);
      if (i === 0) {
        ctx.moveTo(p.x, p.y);
      } else {
        ctx.lineTo(p.x, p.y);
      }
    });
  };
  const base = onPetal(petal, 0, 0);
  const tip = onPetal(petal, 1, -hook);
  const shade = clamp(0.9 + 0.2 * onPetal(petal, 0.5, 0).depth, 0.74, 1);
  const fill = ctx.createLinearGradient(base.x, base.y, tip.x, tip.y);
  fill.addColorStop(0, css(paint.base, shade));
  fill.addColorStop(1, css(paint.tip, shade));
  ctx.beginPath();
  trace(outline);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = paint.outline;
  ctx.lineWidth = line;
  ctx.stroke();
  if (vein.alpha <= 0.01) {
    return;
  }
  // Carved inside it, a second outline following the first, and a midrib.
  ctx.save();
  ctx.globalAlpha *= 0.4 * vein.alpha;
  ctx.lineWidth = vein.width;
  ctx.beginPath();
  trace(outline.map(([u, v]) => [0.1 + 0.8 * u, 0.58 * v]));
  ctx.closePath();
  trace(
    [0.16, 0.4, 0.62, 0.8].map((u) => [u, -hook * u * u] as [number, number]),
  );
  ctx.stroke();
  ctx.restore();
}

/**
 * The seed head in the middle of an open lotus, pocked with holes, showing as it opens by
 * `amount`.
 */
function drawSeedHead(
  ctx: CanvasRenderingContext2D,
  amount: number,
  paint: Paint,
  line: number,
  vein: Vein,
): void {
  const radius = SEED_HEAD.radius * lerp(0.5, 1, amount);
  const middle = project({ x: 0, y: SEED_HEAD.height, z: 0 });
  const squash = Math.sin(LOTUS_VIEW);
  ctx.save();
  ctx.globalAlpha *= Math.min(1, amount * 1.5);
  ctx.fillStyle = css(SEED_HEAD.color, Math.min(1, paint.base[0] / 248));
  ctx.strokeStyle = paint.outline;
  ctx.lineWidth = line;
  ctx.beginPath();
  ctx.ellipse(middle.x, middle.y, radius, radius * squash, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha *= vein.alpha;
  ctx.fillStyle = paint.outline;
  for (let i = 0; i <= SEED_HEAD.holes; i += 1) {
    const ring = i === SEED_HEAD.holes ? 0 : 0.58 * radius;
    const angle = (i / SEED_HEAD.holes) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(
      middle.x + Math.cos(angle) * ring,
      middle.y + Math.sin(angle) * ring * squash,
      0.018,
      0.018 * squash,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
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
 * with a flattened underside over the mound's base, each turned its own way. A mound of one is a
 * single cluster.
 */
function moundLayout(clusters: number, variant: number): Member[] {
  if (clusters <= 1) {
    return [{ x: 0, y: 0, scale: 1, variant }];
  }
  const count = Math.max(2, Math.round(MOUND.fill * clusters * clusters));
  const scale = 1 / clusters;
  const members: Member[] = [];
  for (let i = 0; i < count; i += 1) {
    const r = Math.sqrt((i + 0.5) / count);
    const a = i * GOLDEN_ANGLE + variant * Math.PI * 2;
    const up = Math.sin(a);
    const depth = up > 0 ? MOUND.top : MOUND.underside;
    members.push({
      x: r * Math.cos(a) * (0.5 - 0.55 * scale),
      // Its base, below the middle of its cluster.
      y: MOUND.middle + r * up * depth * (1 - scale) - 0.55 * scale,
      scale: scale * (0.88 + 0.24 * hash(i, variant)),
      variant: hash(i + 101, variant),
    });
  }
  return members.sort((a, b) => b.y - a.y);
}

/**
 * A mound of cherry clusters or maple sprays too small to show their blossoms or leaves: the puffs
 * of every cluster run together into one mass on a spur of ink, pale where the light falls on its
 * top and deeper beneath. A cherry's puffs are round, flecked with the deep hearts of their
 * blossoms; a maple's are jagged with the points of their leaves. A line is carved along the top
 * of each cluster that lies over others.
 */
function drawMass(
  ctx: CanvasRenderingContext2D,
  kind: "cherry" | "maple",
  clusters: number,
  variant: number,
  open: number,
  wilt: number,
  paint: Paint,
  line: number,
  vein: Vein,
): void {
  // A fine line is `VEIN_PX` pixels wide, which gives the mound's pixels per unit.
  const pixels = VEIN_PX / vein.width;
  // Lobes too small for their edges to show are drawn half as many and larger.
  const coarse =
    clusters > 1 && (MOUND.lobe * pixels) / clusters < MOUND.coarsePx;
  const mass = massShapes(kind, clusters, variant, open, wilt, line, coarse);
  const lobePx = mass.lobe * pixels;

  ctx.strokeStyle = paint.ink;
  ctx.lineWidth = line * 1.6;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, lerp(mass.bottom, mass.top, 0.4));
  ctx.stroke();

  ctx.fillStyle = paint.outline;
  ctx.fill(mass.outline);
  const fill = ctx.createLinearGradient(0, mass.top, 0, mass.bottom);
  fill.addColorStop(0, css(paint.tip));
  fill.addColorStop(1, css(paint.base));
  ctx.fillStyle = fill;
  ctx.fill(mass.body);

  const flecks =
    mass.flecks === undefined
      ? 0
      : smoothstep(MOUND.fleckPx.from, MOUND.fleckPx.to, lobePx);
  if (mass.flecks !== undefined && flecks > 0) {
    ctx.save();
    ctx.globalAlpha *= flecks * MOUND.fleck.alpha;
    ctx.fillStyle = css(paint.base, MOUND.fleck.shade);
    ctx.fill(mass.flecks);
    ctx.restore();
  }

  // The carved lines show once each cluster's lobe is a few pixels across.
  const carving =
    mass.carving === undefined
      ? 0
      : smoothstep(MOUND.carvedPx.from, MOUND.carvedPx.to, lobePx);
  if (mass.carving !== undefined && carving > 0) {
    ctx.save();
    ctx.globalAlpha *= MOUND.carving * carving;
    ctx.lineWidth = Math.max(vein.width, line);
    ctx.stroke(mass.carving);
    ctx.restore();
  }
}

/** The shapes of a mound's mass, in the mound's units. */
interface MassShapes {
  /** Every lobe grown by a line, filled in ink so its outer edge shows around the body. */
  outline: Path2D;
  body: Path2D;
  /** The deep hearts flecking a cherry's mass. */
  flecks: Path2D | undefined;
  /** The lines carved along the tops of a mound's clusters. */
  carving: Path2D | undefined;
  top: number;
  bottom: number;
  /** Radius of its first lobe. */
  lobe: number;
}

/**
 * Masses built so far, so a mound that keeps its shape from one frame to the next is not built
 * again. Cleared once it holds this many.
 */
const massCache = new Map<string, MassShapes>();
const MASS_CACHE_LIMIT = 4000;

/**
 * The shapes of a mound's mass, built once for each shape it takes. Openness, wilting and the
 * width of its outline change in small steps, so a mound growing in or zoomed past is rebuilt
 * only now and then.
 */
function massShapes(
  kind: "cherry" | "maple",
  clusters: number,
  variant: number,
  open: number,
  wilt: number,
  line: number,
  coarse: boolean,
): MassShapes {
  const step = {
    open: Math.round(open * 40) / 40,
    wilt: Math.round(wilt * 40) / 40,
    line: Math.exp(Math.round(Math.log(line) * 20) / 20),
  };
  const key = `${kind} ${clusters} ${variant} ${step.open} ${step.wilt} ${step.line} ${coarse}`;
  const cached = massCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  if (massCache.size >= MASS_CACHE_LIMIT) {
    massCache.clear();
  }
  const built = buildMass(
    kind,
    clusters,
    variant,
    step.open,
    step.wilt,
    step.line,
    coarse,
  );
  massCache.set(key, built);
  return built;
}

function buildMass(
  kind: "cherry" | "maple",
  clusters: number,
  variant: number,
  open: number,
  wilt: number,
  line: number,
  coarse: boolean,
): MassShapes {
  const members = coarse
    ? moundLayout(clusters, variant)
        .filter((_, i) => i % 2 === 0)
        .map((m) => ({ ...m, scale: m.scale * MOUND.coarseGrowth }))
    : moundLayout(clusters, variant);
  const gather = lerp(0.4, 1, open);
  const middle = lerp(0.3, 0.6, open) - 0.08 * wilt;
  const swell = lerp(0.55, 1, open) * (1 - 0.15 * wilt);
  // A lone cluster shows the lobes of its puff; in a mound each cluster is one lobe of the mass.
  const lone = members.length === 1;
  const lobes = lone
    ? [
        ...PUFF.map((lobe, i) => ({
          x: (variant < 0.5 ? -1 : 1) * lobe.x * gather,
          y: middle + (lobe.y - 0.6) * gather,
          r: lobe.r * swell,
          turn: i * 1.3,
        })),
        // Fills the gaps the lobes leave between them, where their outlines would show through.
        { x: 0, y: middle, r: 0.3 * gather, turn: 0 },
      ]
    : members.map((m) => ({
        x: m.x,
        y: m.y + middle * m.scale,
        r: MOUND.lobe * swell * m.scale,
        turn: m.variant * Math.PI * 2,
      }));

  // Filling is much quicker than stroking so many circles, so the outline is the lobes grown by
  // a line and filled in ink; the body filled over it leaves only their shared outer edge.
  const shapes = (grow: number): Path2D => {
    const path = new Path2D();
    for (const lobe of lobes) {
      if (kind === "maple") {
        leafPoints(path, lobe.x, lobe.y, lobe.r + grow, lobe.turn);
      } else {
        path.moveTo(lobe.x + lobe.r + grow, lobe.y);
        path.arc(lobe.x, lobe.y, lobe.r + grow, 0, Math.PI * 2);
      }
    }
    return path;
  };

  let flecks: Path2D | undefined;
  if (kind === "cherry") {
    flecks = new Path2D();
    // A lone cluster's lobes are a blossom each; a mound's are a cluster each.
    const each = lone ? 1 : MOUND.fleck.perCluster;
    for (const [i, lobe] of lobes.entries()) {
      for (let k = 0; k < each; k += 1) {
        const a = hash(i * each + k, 0.37) * Math.PI * 2;
        const d = (lone ? 0.2 : 0.62) * hash(i * each + k, 0.71) * lobe.r;
        const x = lobe.x + Math.cos(a) * d;
        const y = lobe.y + Math.sin(a) * d;
        const r = (lone ? 0.18 : 0.09) * lobe.r;
        flecks.moveTo(x + r, y);
        flecks.arc(x, y, r, 0, Math.PI * 2);
      }
    }
  }

  let carving: Path2D | undefined;
  if (!lone) {
    carving = new Path2D();
    // The first clusters lie at the back, under the rest.
    for (const lobe of lobes.slice(MOUND.carvedFrom)) {
      const r = 0.9 * lobe.r;
      const y = lobe.y - 0.08 * lobe.r;
      carving.moveTo(
        lobe.x + r * Math.cos(0.22 * Math.PI),
        y + r * Math.sin(0.22 * Math.PI),
      );
      carving.arc(lobe.x, y, r, 0.22 * Math.PI, 0.78 * Math.PI);
    }
  }

  return {
    outline: shapes(line),
    body: shapes(0),
    flecks,
    carving,
    top: Math.max(...lobes.map((l) => l.y + l.r)),
    bottom: Math.min(...lobes.map((l) => l.y - l.r)),
    lobe: at(lobes, 0).r,
  };
}

/**
 * A mound of cherry clusters or maple sprays near enough to show their blossoms or leaves: a twig
 * from the mound's base out to each cluster, then the clusters back to front.
 */
function drawMound(
  ctx: CanvasRenderingContext2D,
  kind: "cherry" | "maple",
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
    if (kind === "cherry") {
      drawCherry(ctx, open, wilt, paint, line / m.scale, own, m.variant);
    } else {
      drawMaple(ctx, open, wilt, paint, line / m.scale, own, m.variant);
    }
    ctx.restore();
  }
}

/** Adds a lobe of a maple's mass to the path: a ring of leaf points `r` out around (x, y). */
function leafPoints(
  ctx: CanvasPath,
  x: number,
  y: number,
  r: number,
  turn: number,
): void {
  const { points, tip, notch } = MASS_LEAF;
  for (let k = 0; k < 2 * points; k += 1) {
    const a = turn + (k * Math.PI) / points;
    const reach = r * (k % 2 === 0 ? tip : notch);
    const px = x + Math.cos(a) * reach;
    const py = y + Math.sin(a) * reach;
    if (k === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
}

/** A number from 0 to 1 that looks random, fixed for each `i` and `seed`. */
function hash(i: number, seed: number): number {
  const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
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
            shade: i < CHERRY_BACK ? 0.86 : 1,
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
  const petal = lerp(0.6, 1, open) * (1 - 0.12 * wilt);

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
    ctx.beginPath();
    for (let k = 0; k < 5; k += 1) {
      trace(ctx, CHERRY_PETAL, f, b.spin + (k / 5) * Math.PI * 2, petal);
    }
    const fill = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * petal);
    fill.addColorStop(0.15, css(paint.base, b.shade));
    fill.addColorStop(1, css(paint.tip, b.shade));
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = paint.outline;
    ctx.lineWidth = line;
    ctx.stroke();

    // Its heart, a deeper eye.
    ctx.fillStyle = css(paint.base, 0.62 * b.shade);
    ctx.beginPath();
    ctx.ellipse(
      b.x,
      b.y,
      0.2 * b.r * petal,
      0.2 * b.r * petal * b.squash,
      b.turn,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    if (vein.alpha > 0.01) {
      drawCherryDetail(ctx, f, b.spin, petal, paint, vein);
    }
  }
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
 * A spray of Japanese maple leaves fanned out from one twig: each leaf seven slender pointed lobes
 * on a stalk, crimson at its heart and scarlet at its tips, with a vein carved down each lobe.
 */
function drawMaple(
  ctx: CanvasRenderingContext2D,
  open: number,
  wilt: number,
  paint: Paint,
  line: number,
  vein: Vein,
  variant: number,
): void {
  const flip = variant < 0.5 ? -1 : 1;
  // A third of the sprays carry one leaf fewer.
  const missing = Math.floor(variant * 12) % 3 === 0 ? 2 : -1;
  const gather = lerp(0.4, 1, open);
  const twig = MAPLE_TWIG * lerp(0.6, 1, open);
  const leaves = MAPLE.flatMap((leaf, i) => {
    if (i === missing) {
      return [];
    }
    // Wilting, the leaves droop away from the twig.
    const turn = flip * leaf.turn * (1 + 0.3 * wilt);
    const reach = leaf.reach * gather;
    return [
      {
        x: -Math.sin(turn) * reach,
        y: twig + Math.cos(turn) * reach,
        turn,
        size: leaf.size * lerp(0.35, 1, open) * (1 - 0.1 * wilt),
        // A leaf unfolds as it grows in, and curls as it wilts.
        squash: leaf.squash * lerp(0.35, 1, open) * (1 - 0.35 * wilt),
        shade: i < MAPLE_BACK ? 0.8 : 1,
      },
    ];
  });

  // The twig, and a stalk from its end to each leaf.
  ctx.strokeStyle = paint.ink;
  ctx.lineWidth = line * 1.8;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, twig);
  ctx.stroke();
  ctx.lineWidth = line * 1.1;
  ctx.beginPath();
  for (const leaf of leaves) {
    ctx.moveTo(0, twig);
    ctx.lineTo(leaf.x, leaf.y);
  }
  ctx.stroke();

  for (const leaf of leaves) {
    const f = frame(
      leaf.x,
      leaf.y,
      leaf.turn,
      leaf.size * leaf.squash,
      leaf.size,
    );
    ctx.beginPath();
    for (const lobe of MAPLE_LOBES) {
      trace(ctx, MAPLE_LOBE, f, lobe.turn, lobe.length);
    }
    // The outline is stroked twice as wide as it shows; filling the lobes over it leaves only
    // their shared outer edge.
    ctx.strokeStyle = paint.outline;
    ctx.lineWidth = line * 2;
    ctx.stroke();
    const fill = ctx.createRadialGradient(
      leaf.x,
      leaf.y,
      0,
      leaf.x,
      leaf.y,
      leaf.size,
    );
    fill.addColorStop(0, css(paint.base, leaf.shade));
    fill.addColorStop(1, css(paint.tip, leaf.shade));
    ctx.fillStyle = fill;
    ctx.fill();
    if (vein.alpha <= 0.01) {
      continue;
    }
    ctx.save();
    ctx.globalAlpha *= 0.45 * vein.alpha;
    ctx.lineWidth = vein.width;
    ctx.beginPath();
    for (const lobe of MAPLE_LOBES) {
      const sin = Math.sin(lobe.turn);
      const cos = Math.cos(lobe.turn);
      const reach = 0.84 * lobe.length;
      const [x0, y0] = place(f, -0.06 * sin, 0.06 * cos);
      const [x1, y1] = place(f, -reach * sin, reach * cos);
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
    ctx.stroke();
    ctx.restore();
  }
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
  ctx: CanvasRenderingContext2D,
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

/** A color under a light, as multipliers on each channel. */
function lit(color: Rgb, light: Rgb): Rgb {
  return [color[0] * light[0], color[1] * light[1], color[2] * light[2]];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function css(color: Rgb, shade = 1): string {
  return `rgb(${Math.round(color[0] * shade)}, ${Math.round(color[1] * shade)}, ${Math.round(color[2] * shade)})`;
}
