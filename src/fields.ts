import type { Camera } from "./camera";
import type { Level } from "./level";
import { css, lit, mix, type Rgb, type SkyLight } from "./sky";
import { at, hash, smoothstep } from "./util";
import type { Vec } from "./wind";

/** How a field's ground is patterned, after the sand drawings. */
type Pattern = "pebbles" | "rows" | "plain";

/**
 * One of the bands a farm's ground is laid out in, under its surface: `thick` meters through on
 * average, swelling and thinning by up to `swell` of that over `length` meters along the land, so
 * its edges roll as hills do of their own, and where it thins away the band below rises to meet the
 * one above. It is split into fields about `field` meters along, each in one of its colors.
 */
interface Band {
  pattern: Pattern;
  thick: number;
  swell: number;
  length: number;
  field: number;
  colors: readonly Rgb[];
}

/** Colors of the fields by day at midsummer. */
const HEDGE: Rgb = [92, 108, 64];
const WHEAT: Rgb = [206, 172, 98];
const PLOWED: Rgb = [154, 106, 72];
const BARLEY: Rgb = [186, 170, 108];
const PASTURE: Rgb = [128, 148, 96];
const LEY: Rgb = [154, 156, 92];
const EARTH: Rgb = [110, 84, 60];

/**
 * The bands, from the surface down, after reference 14: hedgerows of pebbles along the top, fields
 * plowed in rows, and pasture. Under them the land runs on down in furrows, in `UNDER`'s color.
 */
const BANDS: readonly Band[] = [
  {
    pattern: "pebbles",
    thick: 0.42,
    swell: 1.1,
    length: 14,
    field: 9,
    colors: [HEDGE],
  },
  {
    pattern: "rows",
    thick: 1.1,
    swell: 0.6,
    length: 21,
    field: 7.5,
    colors: [WHEAT, PLOWED, BARLEY, PLOWED],
  },
  {
    pattern: "plain",
    thick: 0.85,
    swell: 0.75,
    length: 27,
    field: 11,
    colors: [PASTURE, LEY],
  },
];
const UNDER: Rgb = EARTH;

/**
 * The patterns' measures, in meters: the gap between plowed rows and how steeply they run, in
 * radians from level; the cell each pebble lies in, and its radius as a share of the cell, from
 * smallest to largest; and the gap between furrows. Where they would come closer than `nearestPx`
 * CSS pixels, they are drawn twice as far apart, and again, until they do not.
 */
const PATTERN = {
  rowGap: 0.2,
  rowSlope: 0.95,
  pebbleCell: 0.26,
  pebble: { from: 0.3, to: 0.5 },
  furrowGap: 0.17,
  nearestPx: 4,
} as const;

/**
 * How far a divider between fields may lean, in meters along the land per meter down, and how far
 * from evenly spaced it may stand, as a share of its band's field length.
 */
const DIVIDER = { lean: 0.9, jitter: 0.35 } as const;
/** How deep the fields are drawn, in meters: deeper than any band reaches. */
const FIELD_DEPTH = 6;

/** A thin rim of ink along the surface, above the fields, in CSS pixels. */
const RIM_PX = 2;

/**
 * Through the fall the fields turn toward straw, and through the winter toward bare earth, by up to
 * these shares.
 */
const STRAW: Rgb = [190, 168, 112];
const BARE: Rgb = [122, 108, 90];
const TURN = { fall: 0.4, winter: 0.55 } as const;

/**
 * Lines: the width of the patterns' and of the edges between bands and fields, in CSS pixels; how
 * far toward the ink they are drawn on colored fields; and how strongly they show carved into the
 * ink, as the barn's lines are, without colors.
 */
const LINES = {
  pattern: 1,
  edge: 1.3,
  patternInk: 0.4,
  edgeInk: 0.7,
  carved: { pattern: 0.3, edge: 0.5 },
} as const;

/** One band as drawn: its pattern and colors, and how deep its top and foot lie at each column. */
interface Layer {
  index: number;
  band: Band | undefined;
  top: readonly number[];
  foot: readonly number[];
}

/**
 * Draws a farm's fields over its ground, which is already filled with ink: bands one under another
 * from just below the surface, each split into fields and patterned after the sand drawings, in the
 * fields' colors for `season` under `light` if `colors`, or else carved into the ink. `surface` is
 * the ground line across the view, in device pixels.
 */
export function drawFields(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  level: Level,
  surface: readonly Vec[],
  light: SkyLight,
  season: number,
  colors: boolean,
): void {
  const dpr = camera.dpr;
  const xs = surface.map((p) => camera.toWorld(p.x / dpr, 0).x);
  const layers = layersAt(xs, RIM_PX / camera.scale);
  // Device pixels down the view per meter of depth.
  const down = camera.scale * dpr;
  const bottom = camera.height * dpr;
  const rowOf = (i: number, depth: number): number =>
    Math.min(bottom + 1, at(surface, i).y + depth * down);
  const ink = light.ink;
  const carved = (alpha: number): string => css(light.sky.middle, alpha);
  const shade = (color: Rgb): Rgb =>
    lit(seasoned(color, season), light.flowerLight);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const edges = new Path2D();
  for (const layer of layers) {
    const tops = surface.map((_, i) => rowOf(i, at(layer.top, i)));
    if (Math.min(...tops) >= bottom) {
      break;
    }
    const foots = surface.map((_, i) => rowOf(i, at(layer.foot, i)));
    const region = new Path2D();
    for (const [i, p] of surface.entries()) {
      if (i === 0) {
        region.moveTo(p.x, at(tops, i));
      } else {
        region.lineTo(p.x, at(tops, i));
      }
    }
    for (let i = surface.length - 1; i >= 0; i -= 1) {
      region.lineTo(at(surface, i).x, at(foots, i));
    }
    region.closePath();
    ctx.save();
    ctx.clip(region);
    const { band } = layer;
    if (band === undefined) {
      const color = shade(UNDER);
      if (colors) {
        ctx.fillStyle = css(color);
        ctx.fill(region);
      }
      ctx.strokeStyle = colors
        ? css(mix(color, ink, LINES.patternInk))
        : carved(LINES.carved.pattern);
      ctx.lineWidth = LINES.pattern * dpr;
      ctx.stroke(furrows(camera, xs, surface, layer.top, rowOf));
    } else {
      const dividers = new Path2D();
      for (const field of fieldsIn(xs, layer.index, band)) {
        const outline = fieldOutline(camera, level, field);
        const color = shade(field.color);
        ctx.save();
        ctx.clip(outline.region);
        if (colors) {
          ctx.fillStyle = css(color);
          ctx.fill(region);
        }
        const lines = mix(color, ink, LINES.patternInk);
        ctx.strokeStyle = colors ? css(lines) : carved(LINES.carved.pattern);
        ctx.lineWidth = LINES.pattern * dpr;
        if (band.pattern === "rows") {
          ctx.stroke(rows(camera, level, field));
        } else if (band.pattern === "pebbles") {
          const stones = pebbles(camera, level, field, layer.index);
          if (colors) {
            ctx.fillStyle = css(mix(color, light.land.middle, 0.25));
            ctx.fill(stones);
          }
          ctx.stroke(stones);
        }
        ctx.restore();
        dividers.addPath(outline.left);
      }
      ctx.strokeStyle = colors
        ? css(mix(shade(at(band.colors, 0)), ink, LINES.edgeInk))
        : carved(LINES.carved.edge);
      ctx.lineWidth = LINES.edge * dpr;
      ctx.stroke(dividers);
    }
    ctx.restore();
    if (band !== undefined) {
      for (const [i, p] of surface.entries()) {
        if (i === 0) {
          edges.moveTo(p.x, at(foots, i));
        } else {
          edges.lineTo(p.x, at(foots, i));
        }
      }
    }
  }
  ctx.strokeStyle = colors
    ? css(mix(shade(EARTH), ink, LINES.edgeInk))
    : carved(LINES.carved.edge);
  ctx.lineWidth = LINES.edge * dpr;
  ctx.stroke(edges);
  ctx.restore();
}

/**
 * The bands at the world positions `xs`, and the land under them: how deep each one's top and foot
 * lie below the surface there, in meters, starting `rim` meters down.
 */
function layersAt(xs: readonly number[], rim: number): Layer[] {
  const layers: Layer[] = [];
  let top = xs.map(() => rim);
  for (const [index, band] of BANDS.entries()) {
    const above = top;
    const foot = xs.map((x, i) => at(above, i) + thickness(band, index, x));
    layers.push({ index, band, top: above, foot });
    top = foot;
  }
  layers.push({
    index: BANDS.length,
    band: undefined,
    top,
    foot: xs.map(() => Infinity),
  });
  return layers;
}

/** How thick band `index`, `band`, is at `x`, in meters: never less than nothing. */
function thickness(band: Band, index: number, x: number): number {
  const phase = index * 2.3;
  const wave =
    0.65 * Math.sin((2 * Math.PI * x) / band.length + phase) +
    0.35 * Math.sin((2 * Math.PI * x) / (0.41 * band.length) + 2 * phase + 1);
  return band.thick * Math.max(0, 1 + band.swell * wave);
}

/** How deep the top of band `index` lies below the surface at `x`, in meters, below `rim`. */
function depthOf(index: number, x: number, rim: number): number {
  let depth = rim;
  for (let k = 0; k < index; k += 1) {
    depth += thickness(at(BANDS, k), k, x);
  }
  return depth;
}

/**
 * A field: band `band` from the divider at `from` to the one at `to`, in meters along the land at
 * the surface, each leaning so far along per meter down; its color, and which way its rows run.
 */
interface Field {
  from: number;
  to: number;
  leanFrom: number;
  leanTo: number;
  color: Rgb;
  way: 1 | -1;
  /** How large its pebbles are, as a share of their usual size. */
  stones: number;
}

/** The fields of band `index`, `band`, across the world positions `xs`. */
function fieldsIn(xs: readonly number[], index: number, band: Band): Field[] {
  const left = at(xs, 0) - FIELD_DEPTH * DIVIDER.lean;
  const right = at(xs, xs.length - 1) + FIELD_DEPTH * DIVIDER.lean;
  const divider = (n: number): { x: number; lean: number } => ({
    x: band.field * (n + DIVIDER.jitter * (hash(n, 11 + index) - 0.5)),
    lean: DIVIDER.lean * (hash(n, 23 + index) - 0.5),
  });
  const fields: Field[] = [];
  for (
    let n = Math.floor(left / band.field) - 1;
    n <= Math.ceil(right / band.field);
    n += 1
  ) {
    const from = divider(n);
    const to = divider(n + 1);
    fields.push({
      from: from.x,
      to: to.x,
      leanFrom: from.lean,
      leanTo: to.lean,
      color: at(
        band.colors,
        Math.floor(hash(n, 37 + index) * band.colors.length),
      ),
      way: n % 2 === 0 ? 1 : -1,
      stones: 0.8 + 0.4 * hash(n, 41 + index),
    });
  }
  return fields;
}

/**
 * Where `field` lies on screen, in device pixels: all of its band between its dividers, from above
 * the surface down past the band's foot; and its left divider, as a line to draw.
 */
function fieldOutline(
  camera: Camera,
  level: Level,
  field: Field,
): { region: Path2D; left: Path2D } {
  const dpr = camera.dpr;
  const point = (x: number, lean: number, depth: number): Vec => {
    const p = camera.toScreen(x + lean * depth, level.groundAt(x) - depth);
    return { x: p.x * dpr, y: p.y * dpr };
  };
  const corners = [
    point(field.from, field.leanFrom, -3),
    point(field.from, field.leanFrom, FIELD_DEPTH),
    point(field.to, field.leanTo, FIELD_DEPTH),
    point(field.to, field.leanTo, -3),
  ];
  const region = new Path2D();
  for (const [i, c] of corners.entries()) {
    if (i === 0) {
      region.moveTo(c.x, c.y);
    } else {
      region.lineTo(c.x, c.y);
    }
  }
  region.closePath();
  const top = point(field.from, field.leanFrom, 0);
  const foot = point(field.from, field.leanFrom, FIELD_DEPTH);
  const left = new Path2D();
  left.moveTo(top.x, top.y);
  left.lineTo(foot.x, foot.y);
  return { region, left };
}

/** `gap` meters, doubled as often as it takes to be no nearer than the patterns' nearest on screen. */
function spaced(camera: Camera, gap: number): number {
  const px = gap * camera.scale;
  return px >= PATTERN.nearestPx
    ? gap
    : gap * 2 ** Math.ceil(Math.log2(PATTERN.nearestPx / px));
}

/**
 * A field's rows, in device pixels: parallel lines across all of it, rising the way it is plowed,
 * set where they are in the world so they keep their place as the view moves.
 */
function rows(camera: Camera, level: Level, field: Field): Path2D {
  const dpr = camera.dpr;
  const gap = spaced(camera, PATTERN.rowGap);
  const slope = Math.tan(PATTERN.rowSlope) * field.way;
  // Each row crosses the height of the field's surface where it starts, `across` apart along it.
  const across = gap / Math.sin(PATTERN.rowSlope);
  const high =
    Math.max(level.groundAt(field.from), level.groundAt(field.to)) + 1;
  const low =
    Math.min(level.groundAt(field.from), level.groundAt(field.to)) -
    FIELD_DEPTH;
  const reach = (high - low) / Math.abs(slope);
  const left =
    Math.min(field.from, field.from + field.leanFrom * FIELD_DEPTH) - reach;
  const right =
    Math.max(field.to, field.to + field.leanTo * FIELD_DEPTH) + reach;
  const path = new Path2D();
  for (
    let k = Math.floor(left / across);
    k <= Math.ceil(right / across);
    k += 1
  ) {
    const x = k * across;
    const a = camera.toScreen(x + low / slope, low);
    const b = camera.toScreen(x + high / slope, high);
    path.moveTo(a.x * dpr, a.y * dpr);
    path.lineTo(b.x * dpr, b.y * dpr);
  }
  return path;
}

/**
 * A field's pebbles, in device pixels: round stones of a few sizes laid close in a loose grid
 * through the depth of its band, which hold their place in the world as the view moves.
 */
function pebbles(
  camera: Camera,
  level: Level,
  field: Field,
  index: number,
): Path2D {
  const dpr = camera.dpr;
  const cell = spaced(camera, PATTERN.pebbleCell);
  const rim = RIM_PX / camera.scale;
  const band = at(BANDS, index);
  const left = Math.min(field.from, field.from + field.leanFrom * FIELD_DEPTH);
  const right = Math.max(field.to, field.to + field.leanTo * FIELD_DEPTH);
  const path = new Path2D();
  for (let i = Math.floor(left / cell); i <= Math.ceil(right / cell); i += 1) {
    const top = depthOf(index, i * cell, rim);
    const foot = top + thickness(band, index, i * cell);
    for (let j = 0; (j + 0.2) * cell < foot - top; j += 1) {
      // Every other course of stones sits half a cell along, so they pack close.
      const x =
        (i + 0.5 * (1 + (j % 2)) + 0.5 * (hash(i * 3 + j, 51) - 0.5)) * cell;
      const radius =
        cell *
        field.stones *
        (PATTERN.pebble.from +
          (PATTERN.pebble.to - PATTERN.pebble.from) * hash(i * 7 + j, 53));
      const depth = top + (j + 0.5 + 0.4 * (hash(j * 13 + i, 57) - 0.5)) * cell;
      const p = camera.toScreen(x, level.groundAt(x) - depth);
      const r = radius * camera.scale * dpr;
      path.moveTo(p.x * dpr + r, p.y * dpr);
      path.arc(p.x * dpr, p.y * dpr, r, 0, Math.PI * 2);
    }
  }
  return path;
}

/**
 * The furrows of the land under the bands, in device pixels: lines that follow the foot of the
 * bands above them down the view, drifting a little closer and further apart as they go.
 */
function furrows(
  camera: Camera,
  xs: readonly number[],
  surface: readonly Vec[],
  top: readonly number[],
  rowOf: (i: number, depth: number) => number,
): Path2D {
  const gap = spaced(camera, PATTERN.furrowGap);
  const bottom = camera.height * camera.dpr;
  const path = new Path2D();
  for (let j = 1; ; j += 1) {
    const ys = xs.map((x, i) =>
      rowOf(
        i,
        at(top, i) +
          j * gap +
          0.25 * gap * Math.sin((2 * Math.PI * x) / 17 + j * 0.7),
      ),
    );
    if (Math.min(...ys) >= bottom) {
      break;
    }
    for (const [i, p] of surface.entries()) {
      if (i === 0) {
        path.moveTo(p.x, at(ys, i));
      } else {
        path.lineTo(p.x, at(ys, i));
      }
    }
  }
  return path;
}

/** `color` turned with the year: toward straw through the fall, and bare earth through the winter. */
function seasoned(color: Rgb, season: number): Rgb {
  const fall = TURN.fall * smoothstep(0.3, 0.7, season);
  const winter = TURN.winter * smoothstep(0.7, 1, season);
  return mix(mix(color, STRAW, fall), BARE, winter);
}
