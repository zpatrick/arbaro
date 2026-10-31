import type { FlowerChoice, FlowerPlacement, FlowerSettings } from "./flowers";
import type { Strength } from "./physics";
import type { Growth, GrowthMode } from "./tree";
import { draggable, element, shape, Slider } from "./ui";
import { invariant } from "./util";
import {
  MAX_WIND_SPEED,
  WIND_MODELS,
  type WindModel,
  type WindSettings,
} from "./wind";

const STORAGE_KEY = "arbaro.debug.v4";
/** Strength and flower size sliders run from a quarter to four times normal, evenly in ratio. */
const STRENGTH_RANGE = 4;
/** Fastest flow the slider allows, as a multiple of the usual flow. */
const MAX_FLOW_RATE = 3;

const FLOWER_PLACEMENTS: readonly {
  id: FlowerPlacement;
  name: string;
  description: string;
}[] = [
  {
    id: "hand",
    name: "By hand",
    description:
      "Shift-click thin wood to grow a flower there, or shift-click a flower to knock it off. Flowers only grow on thin wood, and keep to it as their limb grows.",
  },
  {
    id: "tree",
    name: "By the tree",
    description:
      "The tree grows its own flowers: one crowning every limb long enough to flower, and more along the thin wood behind it. A flower the wind takes grows back after a while.",
  },
];

const FLOWER_CHOICES: readonly { id: FlowerChoice; name: string }[] = [
  { id: "lotus", name: "Lotus" },
  { id: "cloud", name: "Cloud blossom" },
  { id: "star", name: "Star flower" },
  { id: "mixed", name: "Mixed" },
];

/** Names for the time of year, from where each begins on the season slider. */
const SEASONS: readonly (readonly [number, string])[] = [
  [0, "Summer"],
  [0.26, "Early fall"],
  [0.44, "Fall"],
  [0.62, "Late fall"],
  [0.88, "Winter"],
];

const GROWTH_MODES: readonly {
  id: GrowthMode;
  name: string;
  description: string;
}[] = [
  {
    id: "steer",
    name: "Steer and grow",
    description:
      "Hold up to grow the selected limb and steer it with left and right. Nothing else grows.",
  },
  {
    id: "flow",
    name: "Flow",
    description:
      "Nutrients rise from the roots and grow every tip at once. Each fork is a spout that splits the flow between the branch and the limb it grows from; click a spout to set its share. Left and right still steer the selected limb.",
  },
];

/** Beaufort scale: the wind speed in m/s where each named wind begins. */
const BEAUFORT: readonly (readonly [number, string])[] = [
  [0, "Calm"],
  [0.5, "Light air"],
  [1.6, "Light breeze"],
  [3.4, "Gentle breeze"],
  [5.5, "Moderate breeze"],
  [8, "Fresh breeze"],
  [10.8, "Strong breeze"],
  [13.9, "Near gale"],
  [17.2, "Gale"],
  [20.8, "Strong gale"],
  [24.5, "Storm"],
  [28.5, "Violent storm"],
  [32.7, "Hurricane"],
];

/** Where the wind blows toward, in eighths of a turn counterclockwise from the right. */
const HEADINGS = [
  "right",
  "up and right",
  "up",
  "up and left",
  "left",
  "down and left",
  "down",
  "down and right",
];

interface Saved {
  open: boolean;
  growth: Growth;
  wind: WindSettings;
  strength: Strength;
  showStrain: boolean;
  flowers: FlowerSettings;
}

/** Maps a strength multiplier onto a slider position and back. */
function strengthToSlider(multiplier: number): number {
  return 0.5 + Math.log(multiplier) / (2 * Math.log(STRENGTH_RANGE));
}

function sliderToStrength(value: number): number {
  return Math.pow(STRENGTH_RANGE, 2 * value - 1);
}

function load(): Saved | undefined {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    return undefined;
  }
  const saved: unknown = JSON.parse(raw);
  const isNumber = (value: unknown): value is number =>
    typeof value === "number";
  invariant(
    typeof saved === "object" &&
      saved !== null &&
      "open" in saved &&
      typeof saved.open === "boolean" &&
      "showStrain" in saved &&
      typeof saved.showStrain === "boolean" &&
      "growth" in saved &&
      typeof saved.growth === "object" &&
      saved.growth !== null &&
      "mode" in saved.growth &&
      GROWTH_MODES.some(
        (m) => m.id === (saved.growth as { mode: unknown }).mode,
      ) &&
      "flowRate" in saved.growth &&
      isNumber(saved.growth.flowRate) &&
      "wind" in saved &&
      typeof saved.wind === "object" &&
      saved.wind !== null &&
      "direction" in saved.wind &&
      isNumber(saved.wind.direction) &&
      "strength" in saved.wind &&
      isNumber(saved.wind.strength) &&
      "model" in saved.wind &&
      WIND_MODELS.some(
        (m) => m.id === (saved.wind as { model: unknown }).model,
      ) &&
      "strength" in saved &&
      typeof saved.strength === "object" &&
      saved.strength !== null &&
      "wood" in saved.strength &&
      isNumber(saved.strength.wood) &&
      "roots" in saved.strength &&
      isNumber(saved.strength.roots) &&
      "flowers" in saved.strength &&
      isNumber(saved.strength.flowers) &&
      "flowers" in saved &&
      typeof saved.flowers === "object" &&
      saved.flowers !== null &&
      "placement" in saved.flowers &&
      FLOWER_PLACEMENTS.some(
        (p) => p.id === (saved.flowers as { placement: unknown }).placement,
      ) &&
      "kind" in saved.flowers &&
      FLOWER_CHOICES.some(
        (c) => c.id === (saved.flowers as { kind: unknown }).kind,
      ) &&
      "open" in saved.flowers &&
      typeof saved.flowers.open === "boolean" &&
      "size" in saved.flowers &&
      isNumber(saved.flowers.size) &&
      "season" in saved.flowers &&
      isNumber(saved.flowers.season),
    `Saved debug settings under ${STORAGE_KEY} are malformed: ${raw}`,
  );
  return saved as Saved;
}

/** Collapsible panel on the right edge for poking at the simulation. */
export class DebugPanel {
  /** Live growth settings, read every frame. */
  readonly growth: Growth;
  /** Live wind settings. The wind reads these directly, so changes apply on the next frame. */
  readonly wind: WindSettings;
  /** Live multipliers on how much the tree can take before it breaks. */
  readonly strength: Strength;
  /** Whether to mark how close each joint is to breaking. */
  showStrain: boolean;
  /** Live flower settings, read every frame. */
  readonly flowers: FlowerSettings;
  /** Called whenever the growth mode changes. */
  onGrowthMode: (mode: GrowthMode) => void = () => {};
  private open: boolean;
  private readonly root: HTMLElement;
  private readonly modes = new Map<GrowthMode, HTMLElement>();
  private readonly modeDescription: HTMLElement;
  private readonly flowRate: Slider;
  private readonly flowRateRow: HTMLElement;
  private readonly arrow: SVGPathElement;
  private readonly heading: HTMLElement;
  private readonly speed: Slider;
  private readonly models = new Map<WindModel, HTMLElement>();
  private readonly description: HTMLElement;
  private readonly wood: Slider;
  private readonly roots: Slider;
  private readonly flowerHold: Slider;
  private readonly strainToggle: HTMLElement;
  private readonly placements = new Map<FlowerPlacement, HTMLElement>();
  private readonly placementDescription: HTMLElement;
  private readonly kinds = new Map<FlowerChoice, HTMLElement>();
  private readonly openToggle: HTMLElement;
  private readonly flowerSize: Slider;
  private readonly season: Slider;

  constructor(host: HTMLElement) {
    const saved = load();
    this.growth =
      saved === undefined
        ? { mode: "steer", flowRate: 1 }
        : { ...saved.growth };
    this.wind =
      saved === undefined
        ? { direction: 0, strength: 0, model: "steady" }
        : { ...saved.wind };
    this.strength =
      saved === undefined
        ? { wood: 1, roots: 1, flowers: 1 }
        : { ...saved.strength };
    this.flowers =
      saved === undefined
        ? { placement: "hand", kind: "lotus", open: true, size: 1, season: 0 }
        : { ...saved.flowers };
    this.showStrain = saved?.showStrain ?? false;
    this.open = saved?.open ?? false;

    this.root = element("aside", "debug", host);
    const tab = element("div", "debug-tab", this.root, "Debug");
    tab.addEventListener("click", () => this.toggle());
    const card = element("div", "debug-card", this.root);

    const growth = element("section", "debug-section", card);
    element("h2", "debug-title", growth, "Growth");
    const modeList = element("div", "models", growth);
    for (const mode of GROWTH_MODES) {
      const row = element("div", "model", modeList);
      element("span", "model-mark", row);
      element("span", "", row, mode.name);
      row.addEventListener("click", () => this.setGrowth({ mode: mode.id }));
      this.modes.set(mode.id, row);
    }
    this.modeDescription = element("p", "model-description", growth);
    this.flowRateRow = element("div", "", growth);
    this.flowRate = new Slider(this.flowRateRow, "Flow rate", (value) =>
      this.setGrowth({ flowRate: value * MAX_FLOW_RATE }),
    );

    const wind = element("section", "debug-section", card);
    element("h2", "debug-title", wind, "Wind");

    const compass = shape(
      "svg",
      { viewBox: "-70 -70 140 140", class: "compass" },
      wind,
    );
    shape("circle", { r: 62, class: "compass-ring" }, compass);
    shape("circle", { r: 49, class: "compass-ring faint" }, compass);
    for (let i = 0; i < 24; i += 1) {
      const angle = (i * Math.PI) / 12;
      const major = i % 6 === 0;
      const inner = major ? 43 : 52;
      shape(
        "line",
        {
          x1: Math.cos(angle) * inner,
          y1: Math.sin(angle) * inner,
          x2: Math.cos(angle) * 57,
          y2: Math.sin(angle) * 57,
          class: major ? "compass-tick major" : "compass-tick",
        },
        compass,
      );
    }
    // A tapered stroke from a fine tail to a swept head, pointing along +x before rotation.
    this.arrow = shape(
      "path",
      {
        d: "M -44 0 C -18 -0.8 6 -2.8 20 -3.2 L 17 -9 L 46 0 L 17 9 L 20 3.2 C 6 2.8 -18 0.8 -44 0 Z",
        class: "compass-arrow",
      },
      compass,
    );
    shape("circle", { r: 3.2, class: "compass-hub" }, compass);
    draggable(compass, (event) => {
      const box = compass.getBoundingClientRect();
      const dx = event.clientX - (box.left + box.width / 2);
      const dy = event.clientY - (box.top + box.height / 2);
      if (Math.hypot(dx, dy) > 3) {
        this.set({ direction: Math.atan2(-dy, dx) });
      }
    });
    this.heading = element("div", "compass-readout", wind);
    this.speed = new Slider(wind, "Strength", (value) =>
      this.set({ strength: value }),
    );

    element("div", "debug-label", wind, "Model");
    const list = element("div", "models", wind);
    for (const model of WIND_MODELS) {
      const row = element("div", "model", list);
      element("span", "model-mark", row);
      element("span", "", row, model.name);
      row.addEventListener("click", () => this.set({ model: model.id }));
      this.models.set(model.id, row);
    }
    this.description = element("p", "model-description", wind);

    const strength = element("section", "debug-section", card);
    element("h2", "debug-title", strength, "Strength");
    this.wood = new Slider(strength, "Wood", (value) =>
      this.setStrength({ wood: sliderToStrength(value) }),
    );
    this.roots = new Slider(strength, "Roots", (value) =>
      this.setStrength({ roots: sliderToStrength(value) }),
    );
    this.flowerHold = new Slider(strength, "Flowers", (value) =>
      this.setStrength({ flowers: sliderToStrength(value) }),
    );
    this.strainToggle = element("div", "model debug-toggle", strength);
    element("span", "model-mark", this.strainToggle);
    element("span", "", this.strainToggle, "Show strain");
    this.strainToggle.addEventListener("click", () => {
      this.showStrain = !this.showStrain;
      this.render();
      this.save();
    });

    const flowers = element("section", "debug-section", card);
    element("h2", "debug-title", flowers, "Flowers");
    const placementList = element("div", "models", flowers);
    for (const placement of FLOWER_PLACEMENTS) {
      const row = element("div", "model", placementList);
      element("span", "model-mark", row);
      element("span", "", row, placement.name);
      row.addEventListener("click", () =>
        this.setFlowers({ placement: placement.id }),
      );
      this.placements.set(placement.id, row);
    }
    this.placementDescription = element("p", "model-description", flowers);
    element("div", "debug-label", flowers, "Kind");
    const kindList = element("div", "models", flowers);
    for (const kind of FLOWER_CHOICES) {
      const row = element("div", "model", kindList);
      element("span", "model-mark", row);
      element("span", "", row, kind.name);
      row.addEventListener("click", () => this.setFlowers({ kind: kind.id }));
      this.kinds.set(kind.id, row);
    }
    this.openToggle = element("div", "model debug-toggle", flowers);
    element("span", "model-mark", this.openToggle);
    element("span", "", this.openToggle, "Open");
    this.openToggle.addEventListener("click", () =>
      this.setFlowers({ open: !this.flowers.open }),
    );
    this.flowerSize = new Slider(flowers, "Size", (value) =>
      this.setFlowers({ size: sliderToStrength(value) }),
    );
    this.season = new Slider(flowers, "Season", (value) =>
      this.setFlowers({ season: value }),
    );

    window.addEventListener("keydown", (event) => {
      if (event.code === "Backquote" && !event.repeat) {
        this.toggle();
      }
    });
    this.render();
  }

  toggle(): void {
    this.open = !this.open;
    this.render();
    this.save();
  }

  setGrowth(settings: Partial<Growth>): void {
    const before = this.growth.mode;
    Object.assign(this.growth, settings);
    this.render();
    this.save();
    if (this.growth.mode !== before) {
      this.onGrowthMode(this.growth.mode);
    }
  }

  set(settings: Partial<WindSettings>): void {
    Object.assign(this.wind, settings);
    this.render();
    this.save();
  }

  setStrength(settings: Partial<Strength>): void {
    Object.assign(this.strength, settings);
    this.render();
    this.save();
  }

  setFlowers(settings: Partial<FlowerSettings>): void {
    Object.assign(this.flowers, settings);
    this.render();
    this.save();
  }

  private render(): void {
    this.root.classList.toggle("open", this.open);

    for (const [id, row] of this.modes) {
      row.classList.toggle("selected", id === this.growth.mode);
    }
    const mode = GROWTH_MODES.find((m) => m.id === this.growth.mode);
    invariant(mode !== undefined, `Unknown growth mode ${this.growth.mode}.`);
    this.modeDescription.textContent = mode.description;
    this.flowRateRow.hidden = this.growth.mode !== "flow";
    this.flowRate.show(
      this.growth.flowRate / MAX_FLOW_RATE,
      `×${this.growth.flowRate.toFixed(2)}`,
    );

    const { direction, strength, model } = this.wind;
    this.arrow.setAttribute(
      "transform",
      `rotate(${(-direction * 180) / Math.PI})`,
    );
    const eighth = Math.round(direction / (Math.PI / 4));
    const heading = HEADINGS[((eighth % 8) + 8) % 8];
    invariant(heading !== undefined, `No heading for direction ${direction}.`);
    this.heading.textContent = `Blowing ${heading}`;

    const speed = strength * MAX_WIND_SPEED;
    const named = [...BEAUFORT].reverse().find(([from]) => speed >= from);
    invariant(named !== undefined, `No Beaufort name for ${speed} m/s.`);
    this.speed.show(strength, `${Math.round(speed)} m/s · ${named[1]}`);

    for (const [id, row] of this.models) {
      row.classList.toggle("selected", id === model);
    }
    const chosen = WIND_MODELS.find((m) => m.id === model);
    invariant(chosen !== undefined, `Unknown wind model ${model}.`);
    this.description.textContent = chosen.description;

    this.wood.show(
      strengthToSlider(this.strength.wood),
      `×${this.strength.wood.toFixed(2)}`,
    );
    this.roots.show(
      strengthToSlider(this.strength.roots),
      `×${this.strength.roots.toFixed(2)}`,
    );
    this.flowerHold.show(
      strengthToSlider(this.strength.flowers),
      `×${this.strength.flowers.toFixed(2)}`,
    );
    this.strainToggle.classList.toggle("selected", this.showStrain);

    const { placement, kind, open, size, season } = this.flowers;
    for (const [id, row] of this.placements) {
      row.classList.toggle("selected", id === placement);
    }
    const placed = FLOWER_PLACEMENTS.find((p) => p.id === placement);
    invariant(placed !== undefined, `Unknown flower placement ${placement}.`);
    this.placementDescription.textContent = placed.description;
    for (const [id, row] of this.kinds) {
      row.classList.toggle("selected", id === kind);
    }
    this.openToggle.classList.toggle("selected", open);
    this.flowerSize.show(strengthToSlider(size), `×${size.toFixed(2)}`);
    const time = [...SEASONS].reverse().find(([from]) => season >= from);
    invariant(time !== undefined, `No name for the season at ${season}.`);
    this.season.show(season, time[1]);
  }

  private save(): void {
    const saved: Saved = {
      open: this.open,
      growth: this.growth,
      wind: this.wind,
      strength: this.strength,
      showStrain: this.showStrain,
      flowers: this.flowers,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }
}
