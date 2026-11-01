import type { FlowerChoice, FlowerPlacement, FlowerSettings } from "./flowers";
import type { Strength } from "./physics";
import type { TimeSettings } from "./sky";
import type { Growth, GrowthMode } from "./tree";
import { draggable, element, shape, Slider } from "./ui";
import { invariant } from "./util";
import {
  MAX_WIND_SPEED,
  WIND_MODELS,
  type WindModel,
  type WindSettings,
} from "./wind";

const STORAGE_KEY = "arbaro.debug.v7";
/** Strength and flower size sliders run from a quarter to four times normal, evenly in ratio. */
const STRENGTH_RANGE = 4;
/** Fastest flow the slider allows, as a multiple of the usual flow. */
const MAX_FLOW_RATE = 3;

/** The panel's pages, each opened by its own tab down the panel's left edge. */
type Tab = "weather" | "tree" | "flowers";

const TABS: readonly { id: Tab; name: string }[] = [
  { id: "weather", name: "Weather" },
  { id: "tree", name: "Tree" },
  { id: "flowers", name: "Flowers" },
];

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
  { id: "cherry", name: "Cherry blossom" },
  { id: "maple", name: "Maple leaves" },
  { id: "mixed", name: "Mixed" },
];

/**
 * Speeds the simulation can run at, as multiples of real time, each shown as an icon: pause, play,
 * and one more fast-forward arrow for each doubling.
 */
const SPEEDS: readonly {
  speed: number;
  name: string;
  icon: { viewBox: string; path: string };
}[] = [
  {
    speed: 0,
    name: "Pause",
    icon: { viewBox: "0 0 8 10", path: "M1 1h2v8H1z M5 1h2v8H5z" },
  },
  {
    speed: 1,
    name: "Play",
    icon: { viewBox: "0 0 8 10", path: "M1.2 1 7 5 1.2 9z" },
  },
  {
    speed: 2,
    name: "Fast forward, 2×",
    icon: { viewBox: "0 0 13 10", path: "M1 1 6.5 5 1 9z M6.5 1 12 5 6.5 9z" },
  },
  {
    speed: 4,
    name: "Fast forward, 4×",
    icon: {
      viewBox: "0 0 18.5 10",
      path: "M1 1 6.5 5 1 9z M6.5 1 12 5 6.5 9z M12 1 17.5 5 12 9z",
    },
  },
];

/** Names for the time of day, from where each begins, in fractions of a day from midnight. */
const TIMES_OF_DAY: readonly (readonly [number, string])[] = [
  [0, "Night"],
  [0.2, "Dawn"],
  [0.29, "Morning"],
  [0.46, "Noon"],
  [0.54, "Afternoon"],
  [0.71, "Dusk"],
  [0.8, "Night"],
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

/** Every setting the panel controls. */
interface Settings {
  growth: Growth;
  wind: WindSettings;
  strength: Strength;
  showStrain: boolean;
  flowers: FlowerSettings;
  time: TimeSettings;
}

interface Saved extends Settings {
  open: boolean;
  tab: Tab;
}

/** Every setting as it starts, and as the reset button puts it back. */
function defaults(): Settings {
  return {
    growth: { mode: "steer", flowRate: 1 },
    wind: { direction: 0, strength: 0, model: "steady" },
    strength: { wood: 1, roots: 1, flowers: 1 },
    showStrain: false,
    flowers: { placement: "hand", kind: "lotus", size: 1 },
    time: { timeOfDay: 0.375, dayRunning: true, season: 0 },
  };
}

/** Maps a strength multiplier onto a slider position and back. */
function strengthToSlider(multiplier: number): number {
  return 0.5 + Math.log(multiplier) / (2 * Math.log(STRENGTH_RANGE));
}

function sliderToStrength(value: number): number {
  return Math.pow(STRENGTH_RANGE, 2 * value - 1);
}

/** A time of day as a 12-hour clock reading, such as "6:30 am". */
function clockTime(timeOfDay: number): string {
  const minutes = Math.floor(timeOfDay * 24 * 60) % (24 * 60);
  const hours = Math.floor(minutes / 60);
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  const minute = String(minutes % 60).padStart(2, "0");
  return `${hour}:${minute} ${hours < 12 ? "am" : "pm"}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

function isSaved(saved: unknown): saved is Saved {
  if (!isRecord(saved)) {
    return false;
  }
  const { growth, wind, strength, flowers, time } = saved;
  return (
    typeof saved.open === "boolean" &&
    TABS.some((t) => t.id === saved.tab) &&
    typeof saved.showStrain === "boolean" &&
    isRecord(growth) &&
    GROWTH_MODES.some((m) => m.id === growth.mode) &&
    isNumber(growth.flowRate) &&
    isRecord(wind) &&
    isNumber(wind.direction) &&
    isNumber(wind.strength) &&
    WIND_MODELS.some((m) => m.id === wind.model) &&
    isRecord(strength) &&
    isNumber(strength.wood) &&
    isNumber(strength.roots) &&
    isNumber(strength.flowers) &&
    isRecord(flowers) &&
    FLOWER_PLACEMENTS.some((p) => p.id === flowers.placement) &&
    FLOWER_CHOICES.some((c) => c.id === flowers.kind) &&
    isNumber(flowers.size) &&
    isRecord(time) &&
    isNumber(time.timeOfDay) &&
    typeof time.dayRunning === "boolean" &&
    isNumber(time.season)
  );
}

function load(): Saved | undefined {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    return undefined;
  }
  const saved: unknown = JSON.parse(raw);
  invariant(
    isSaved(saved),
    `Saved debug settings under ${STORAGE_KEY} are malformed: ${raw}`,
  );
  return saved;
}

/**
 * Collapsible panel on the right edge for poking at the simulation, with a page each for the
 * weather, the tree and its flowers, opened by tabs down its left edge.
 */
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
  /** Live time of day and of year. The day moves the time of day on while it runs. */
  readonly time: TimeSettings;
  /**
   * How fast the simulation runs, as a multiple of real time; 0 pauses it. Not saved, so the game
   * never loads paused.
   */
  simulationSpeed = 1;
  /** Called whenever the growth mode changes. */
  onGrowthMode: (mode: GrowthMode) => void = () => {};
  private open: boolean;
  private tab: Tab;
  private readonly root: HTMLElement;
  private readonly tabs = new Map<Tab, HTMLElement>();
  private readonly pages = new Map<Tab, HTMLElement>();
  private readonly speeds = new Map<number, HTMLElement>();
  private readonly timeOfDay: Slider;
  private readonly dayToggle: HTMLElement;
  private readonly season: Slider;
  private readonly arrow: SVGPathElement;
  private readonly heading: HTMLElement;
  private readonly windSpeed: Slider;
  private readonly models = new Map<WindModel, HTMLElement>();
  private readonly description: HTMLElement;
  private readonly modes = new Map<GrowthMode, HTMLElement>();
  private readonly modeDescription: HTMLElement;
  private readonly flowRate: Slider;
  private readonly flowRateRow: HTMLElement;
  private readonly wood: Slider;
  private readonly roots: Slider;
  private readonly strainToggle: HTMLElement;
  private readonly placements = new Map<FlowerPlacement, HTMLElement>();
  private readonly placementDescription: HTMLElement;
  private readonly kinds = new Map<FlowerChoice, HTMLElement>();
  private readonly flowerSize: Slider;
  private readonly flowerHold: Slider;

  constructor(host: HTMLElement) {
    const saved = load();
    const settings = saved ?? defaults();
    this.growth = { ...settings.growth };
    this.wind = { ...settings.wind };
    this.strength = { ...settings.strength };
    this.showStrain = settings.showStrain;
    this.flowers = { ...settings.flowers };
    this.time = { ...settings.time };
    this.open = saved?.open ?? false;
    this.tab = saved?.tab ?? "weather";

    this.root = element("aside", "debug", host);
    const tabs = element("div", "debug-tabs", this.root);
    for (const { id, name } of TABS) {
      const tab = element("div", "debug-tab", tabs, name);
      tab.addEventListener("click", () => this.choose(id));
      this.tabs.set(id, tab);
    }
    const card = element("div", "debug-card", this.root);

    const time = element("section", "debug-section", card);
    element("h2", "debug-title", time, "Time");
    const speedRow = element("div", "chips", time);
    for (const { speed, name, icon } of SPEEDS) {
      const chip = element("div", "chip", speedRow);
      chip.title = name;
      chip.setAttribute("aria-label", name);
      const svg = shape(
        "svg",
        { viewBox: icon.viewBox, class: "chip-icon", "aria-hidden": "true" },
        chip,
      );
      shape("path", { d: icon.path }, svg);
      chip.addEventListener("click", () => this.setSimulationSpeed(speed));
      this.speeds.set(speed, chip);
    }

    const weather = this.page("weather", card);
    const day = element("section", "debug-section", weather);
    element("h2", "debug-title", day, "Day");
    this.timeOfDay = new Slider(day, "Time of day", (value) =>
      this.setTime({ timeOfDay: Math.min(value, 0.9999) }),
    );
    this.dayToggle = this.toggleRow(day, "Play the day", () =>
      this.setTime({ dayRunning: !this.time.dayRunning }),
    );
    const year = element("section", "debug-section", weather);
    element("h2", "debug-title", year, "Season");
    this.season = new Slider(year, "Time of year", (value) =>
      this.setTime({ season: value }),
    );
    const wind = element("section", "debug-section", weather);
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
    this.windSpeed = new Slider(wind, "Strength", (value) =>
      this.set({ strength: value }),
    );
    element("div", "debug-label", wind, "Model");
    const windModels = element("div", "models", wind);
    for (const model of WIND_MODELS) {
      this.models.set(
        model.id,
        this.radioRow(windModels, model.name, () =>
          this.set({ model: model.id }),
        ),
      );
    }
    this.description = element("p", "model-description", wind);

    const tree = this.page("tree", card);
    const growth = element("section", "debug-section", tree);
    element("h2", "debug-title", growth, "Growth");
    const growthModes = element("div", "models", growth);
    for (const mode of GROWTH_MODES) {
      this.modes.set(
        mode.id,
        this.radioRow(growthModes, mode.name, () =>
          this.setGrowth({ mode: mode.id }),
        ),
      );
    }
    this.modeDescription = element("p", "model-description", growth);
    this.flowRateRow = element("div", "", growth);
    this.flowRate = new Slider(this.flowRateRow, "Flow rate", (value) =>
      this.setGrowth({ flowRate: value * MAX_FLOW_RATE }),
    );
    const strength = element("section", "debug-section", tree);
    element("h2", "debug-title", strength, "Strength");
    this.wood = new Slider(strength, "Wood", (value) =>
      this.setStrength({ wood: sliderToStrength(value) }),
    );
    this.roots = new Slider(strength, "Roots", (value) =>
      this.setStrength({ roots: sliderToStrength(value) }),
    );
    this.strainToggle = this.toggleRow(strength, "Show strain", () => {
      this.showStrain = !this.showStrain;
      this.render();
      this.save();
    });

    const flowerPage = this.page("flowers", card);
    const flowers = element("section", "debug-section", flowerPage);
    element("h2", "debug-title", flowers, "Flowers");
    const placements = element("div", "models", flowers);
    for (const placement of FLOWER_PLACEMENTS) {
      this.placements.set(
        placement.id,
        this.radioRow(placements, placement.name, () =>
          this.setFlowers({ placement: placement.id }),
        ),
      );
    }
    this.placementDescription = element("p", "model-description", flowers);
    element("div", "debug-label", flowers, "Kind");
    const kinds = element("div", "models", flowers);
    for (const kind of FLOWER_CHOICES) {
      this.kinds.set(
        kind.id,
        this.radioRow(kinds, kind.name, () =>
          this.setFlowers({ kind: kind.id }),
        ),
      );
    }
    this.flowerSize = new Slider(flowers, "Size", (value) =>
      this.setFlowers({ size: sliderToStrength(value) }),
    );
    this.flowerHold = new Slider(flowers, "Stem strength", (value) =>
      this.setStrength({ flowers: sliderToStrength(value) }),
    );

    const reset = element("div", "debug-reset", card, "Reset to defaults");
    reset.addEventListener("click", () => this.reset());

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

  setTime(settings: Partial<TimeSettings>): void {
    Object.assign(this.time, settings);
    this.render();
    this.save();
  }

  setSimulationSpeed(speed: number): void {
    invariant(
      SPEEDS.some((s) => s.speed === speed),
      `The simulation cannot run at ${speed} times real time.`,
    );
    this.simulationSpeed = speed;
    this.render();
  }

  /** Keeps the time of day's slider with the day as it runs. */
  showTimeOfDay(): void {
    const { timeOfDay } = this.time;
    const named = [...TIMES_OF_DAY]
      .reverse()
      .find(([from]) => timeOfDay >= from);
    invariant(named !== undefined, `No name for the time of day ${timeOfDay}.`);
    this.timeOfDay.show(timeOfDay, `${clockTime(timeOfDay)} · ${named[1]}`);
  }

  /** Opens the panel on `tab`, or closes it if that page is already showing. */
  private choose(tab: Tab): void {
    this.open = !(this.open && this.tab === tab);
    this.tab = tab;
    this.render();
    this.save();
  }

  /** Puts every setting back as it started, the speed of time included. */
  private reset(): void {
    const before = this.growth.mode;
    const fresh = defaults();
    Object.assign(this.growth, fresh.growth);
    Object.assign(this.wind, fresh.wind);
    Object.assign(this.strength, fresh.strength);
    Object.assign(this.flowers, fresh.flowers);
    Object.assign(this.time, fresh.time);
    this.showStrain = fresh.showStrain;
    this.simulationSpeed = 1;
    this.render();
    this.save();
    if (this.growth.mode !== before) {
      this.onGrowthMode(this.growth.mode);
    }
  }

  private page(tab: Tab, card: HTMLElement): HTMLElement {
    const page = element("div", "debug-page", card);
    this.pages.set(tab, page);
    return page;
  }

  /** One choice among several, marked when chosen. */
  private radioRow(
    list: HTMLElement,
    name: string,
    onClick: () => void,
  ): HTMLElement {
    const row = element("div", "model", list);
    element("span", "model-mark", row);
    element("span", "", row, name);
    row.addEventListener("click", onClick);
    return row;
  }

  /** A setting that is on or off, marked when on. */
  private toggleRow(
    parent: HTMLElement,
    name: string,
    onClick: () => void,
  ): HTMLElement {
    const row = element("div", "model debug-toggle", parent);
    element("span", "model-mark", row);
    element("span", "", row, name);
    row.addEventListener("click", onClick);
    return row;
  }

  private render(): void {
    this.root.classList.toggle("open", this.open);
    for (const [id, tab] of this.tabs) {
      tab.classList.toggle("selected", id === this.tab);
    }
    for (const [id, page] of this.pages) {
      page.hidden = id !== this.tab;
    }
    for (const [speed, chip] of this.speeds) {
      chip.classList.toggle("selected", speed === this.simulationSpeed);
    }

    this.showTimeOfDay();
    this.dayToggle.classList.toggle("selected", this.time.dayRunning);
    const { season } = this.time;
    const year = [...SEASONS].reverse().find(([from]) => season >= from);
    invariant(year !== undefined, `No name for the season at ${season}.`);
    this.season.show(season, year[1]);

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
    this.windSpeed.show(strength, `${Math.round(speed)} m/s · ${named[1]}`);
    for (const [id, row] of this.models) {
      row.classList.toggle("selected", id === model);
    }
    const chosen = WIND_MODELS.find((m) => m.id === model);
    invariant(chosen !== undefined, `Unknown wind model ${model}.`);
    this.description.textContent = chosen.description;

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
    this.wood.show(
      strengthToSlider(this.strength.wood),
      `×${this.strength.wood.toFixed(2)}`,
    );
    this.roots.show(
      strengthToSlider(this.strength.roots),
      `×${this.strength.roots.toFixed(2)}`,
    );
    this.strainToggle.classList.toggle("selected", this.showStrain);

    const { placement, kind, size } = this.flowers;
    for (const [id, row] of this.placements) {
      row.classList.toggle("selected", id === placement);
    }
    const placed = FLOWER_PLACEMENTS.find((p) => p.id === placement);
    invariant(placed !== undefined, `Unknown flower placement ${placement}.`);
    this.placementDescription.textContent = placed.description;
    for (const [id, row] of this.kinds) {
      row.classList.toggle("selected", id === kind);
    }
    this.flowerSize.show(strengthToSlider(size), `×${size.toFixed(2)}`);
    this.flowerHold.show(
      strengthToSlider(this.strength.flowers),
      `×${this.strength.flowers.toFixed(2)}`,
    );
  }

  private save(): void {
    const saved: Saved = {
      open: this.open,
      tab: this.tab,
      growth: this.growth,
      wind: this.wind,
      strength: this.strength,
      showStrain: this.showStrain,
      flowers: this.flowers,
      time: this.time,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }
}
