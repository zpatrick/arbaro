import type { FlowerPlacement, FlowerSettings } from "./flowers";
import {
  BEAR_POSE_NAMES,
  BEAR_POSES,
  type BearPose,
  type BearSettings,
} from "./bears";
import type { BirdSettings } from "./birds";
import type { HiveSettings } from "./hives";
import { LEVELS, levelById, type LevelId } from "./level";
import type { Strength } from "./physics";
import { type SeaSettings, swellHeightFor, swellPeriodFor } from "./sea";
import { clockTime, seasonName, type TimeSettings } from "./sky";
import { SPECIES, type Species } from "./species";
import type { Growth, GrowthMode } from "./tree";
import { draggable, element, shape, Slider } from "./ui";
import { invariant } from "./util";
import type { WeatherSettings } from "./weather";
import {
  MAX_WIND_SPEED,
  WIND_MODELS,
  type WindModel,
  type WindSettings,
} from "./wind";

const STORAGE_KEY = "arbaro.debug.v7";
/** Strength sliders run from a quarter to four times normal, evenly in ratio. */
const STRENGTH_RANGE = 4;
/** The flower size slider runs from a fifth to five times the usual size, evenly in ratio. */
const FLOWER_SIZE_RANGE = 5;
/** Fastest flow the slider allows, as a multiple of the usual flow. */
const MAX_FLOW_RATE = 3;

/** The panel's pages, each opened by its own tab down the panel's left edge. */
type Tab = "level" | "weather" | "sea" | "tree" | "flowers" | "wildlife";

const TABS: readonly { id: Tab; name: string }[] = [
  { id: "level", name: "Level" },
  { id: "weather", name: "Weather" },
  { id: "sea", name: "Sea" },
  { id: "tree", name: "Tree" },
  { id: "flowers", name: "Flowers" },
  { id: "wildlife", name: "Wildlife" },
];

/** Most birds the slider brings by each minute. */
const MOST_BIRDS = 20;

const FLOWER_PLACEMENTS: readonly {
  id: FlowerPlacement;
  name: string;
  /** What each choice does, for each species: a willow's flowers are its hanging strands. */
  description: Readonly<Record<Species, string>>;
}[] = [
  {
    id: "hand",
    name: "By hand",
    description: {
      cherry:
        "Shift-click thin wood to grow a flower there, or shift-click a flower to knock it off. Flowers only grow on thin wood, and keep to it as their limb grows.",
      willow:
        "Shift-click thin wood to hang a strand there, or shift-click a strand to knock it off. Strands only hang from thin wood, and keep to it as their limb grows.",
    },
  },
  {
    id: "tree",
    name: "By the tree",
    description: {
      cherry:
        "The tree grows its own flowers: one crowning every limb long enough to flower, and more along the thin wood behind it. A flower the wind takes grows back after a while.",
      willow:
        "The tree hangs its own strands: one weeping from the tip of every limb long enough, and more along the thin wood behind it, on either side. A strand the wind takes grows back after a while.",
    },
  },
];

/** What the flowers page calls a species' flowers, and what it says about them. */
const FLOWER_KINDS: Readonly<
  Record<Species, { title: string; description: string }>
> = {
  cherry: {
    title: "Flowers",
    description:
      "Every flower is a cluster of cherry blossoms. Size grows each into a mound of clusters, so the mounds run together into a canopy.",
  },
  willow: {
    title: "Strands",
    description:
      "A weeping willow's flowers are its strands: fine twigs hanging from its thin wood, dressed in narrow leaves, with golden catkins among them. Size sets how long and full they hang.",
  },
};

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

/** Names for how hard it rains, and for how hard it snows, from where each begins. */
const RAINS: readonly (readonly [number, string])[] = [
  [0, "Dry"],
  [0.01, "Drizzle"],
  [0.3, "Rain"],
  [0.7, "Downpour"],
];
const SNOWS: readonly (readonly [number, string])[] = [
  [0, "None"],
  [0.01, "Flurries"],
  [0.3, "Snow"],
  [0.7, "Blizzard"],
];
/** The melt slider runs from a quarter to four times the usual rate, evenly in ratio. */
const MELT_RANGE = 4;
/** Names for how much of the sky the clouds cover, and for how high they hang. */
const COVERS: readonly (readonly [number, string])[] = [
  [0, "Clear"],
  [0.02, "Few"],
  [0.3, "Scattered"],
  [0.6, "Broken"],
  [0.88, "Overcast"],
];
const HEIGHTS: readonly (readonly [number, string])[] = [
  [0, "Fog"],
  [0.2, "Low"],
  [0.45, "Middle"],
  [0.72, "High"],
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

/** Names for the swell's height in meters, and for its length by period in seconds, from where each begins. */
const SWELLS: readonly (readonly [number, string])[] = [
  [0, "None"],
  [0.02, "Low"],
  [0.4, "Moderate"],
  [1, "Heavy"],
  [1.5, "Huge"],
];
const SWELL_LENGTHS: readonly (readonly [number, string])[] = [
  [0, "Short"],
  [3.5, "Average"],
  [4.6, "Long"],
];
/** Douglas sea scale: names for the sea by its waves' significant height, in meters. */
const SEA_STATES: readonly (readonly [number, string])[] = [
  [0, "Calm, glassy"],
  [0.02, "Calm, rippled"],
  [0.1, "Smooth"],
  [0.5, "Slight"],
  [1.25, "Moderate"],
  [2.5, "Rough"],
  [4, "Very rough"],
];
/** The wind waves slider runs from none to this many times the usual. */
const MOST_WIND_WAVES = 2;
/** The momentum slider runs, evenly in ratio, from a second up to this many. */
const MOST_MOMENTUM = 60;
/** Names for the tide, from where each begins. */
const TIDES: readonly (readonly [number, string])[] = [
  [0, "Low water"],
  [0.12, "Low"],
  [0.38, "Mid tide"],
  [0.62, "High"],
  [0.88, "High water"],
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

/** Where the tree grows: the level, and whether mountains line its horizon. */
export interface WorldSettings {
  level: LevelId;
  mountains: boolean;
}

/** What is planted: the species of every tree grown afresh. */
export interface PlantingSettings {
  species: Species;
}

/** Every setting the panel controls. */
interface Settings {
  world: WorldSettings;
  planting: PlantingSettings;
  growth: Growth;
  wind: WindSettings;
  weather: WeatherSettings;
  sea: SeaSettings;
  strength: Strength;
  showStrain: boolean;
  flowers: FlowerSettings;
  time: TimeSettings;
  wildlife: HiveSettings;
  birds: BirdSettings;
  bears: BearSettings;
}

interface Saved extends Omit<
  Settings,
  "world" | "planting" | "weather" | "sea" | "wildlife" | "birds" | "bears"
> {
  open: boolean;
  tab: Tab;
  /**
   * Settings saved by an older build have no weather or wildlife, or only some of them; whatever
   * is missing starts as it does by default.
   */
  world?: Partial<WorldSettings>;
  planting?: Partial<PlantingSettings>;
  weather?: Partial<WeatherSettings>;
  sea?: Partial<SeaSettings>;
  wildlife?: Partial<HiveSettings>;
  birds?: Partial<BirdSettings>;
  bears?: Partial<BearSettings>;
}

/** Every setting as it starts, and as the reset button puts it back. */
function defaults(): Settings {
  return {
    world: { level: "meadow", mountains: levelById("meadow").mountains },
    planting: { species: "cherry" },
    growth: { mode: "steer", flowRate: 1 },
    wind: { direction: 0, strength: 0, model: "steady" },
    weather: {
      rain: 0,
      snow: 0,
      melt: 1,
      clouds: 0,
      cloudHeight: 0.6,
    },
    sea: {
      swell: 0.6,
      swellLength: 0.35,
      windWaves: 1,
      momentum: 8,
      tide: 0.5,
      tideRunning: true,
    },
    strength: { wood: 1, roots: 1, flowers: 1 },
    showStrain: false,
    flowers: { placement: "tree", size: 1 },
    time: { timeOfDay: 0.375, dayRunning: true, season: 0 },
    wildlife: { swarms: true },
    birds: { perMinute: 4, landing: 0.4 },
    bears: { comes: true },
  };
}

/**
 * Maps a multiplier onto the position of a slider running from 1/`range` to `range` times, evenly
 * in ratio, and back.
 */
function ratioToSlider(multiplier: number, range: number): number {
  return 0.5 + Math.log(multiplier) / (2 * Math.log(range));
}

function sliderToRatio(value: number, range: number): number {
  return Math.pow(range, 2 * value - 1);
}

/** The name in `names` for `value`: the last whose start it has reached. */
function nameFor(
  names: readonly (readonly [number, string])[],
  value: number,
): string {
  const found = [...names].reverse().find(([from]) => value >= from);
  invariant(found !== undefined, `No name for ${value}.`);
  return found[1];
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
  const {
    world,
    planting,
    growth,
    wind,
    weather,
    sea,
    strength,
    flowers,
    time,
    wildlife,
    birds,
    bears,
  } = saved;
  return (
    (world === undefined ||
      (isRecord(world) &&
        (world.level === undefined ||
          LEVELS.some((level) => level.id === world.level)) &&
        (world.mountains === undefined ||
          typeof world.mountains === "boolean"))) &&
    (planting === undefined ||
      (isRecord(planting) &&
        (planting.species === undefined ||
          SPECIES.some((species) => species.id === planting.species)))) &&
    (bears === undefined ||
      (isRecord(bears) &&
        (bears.comes === undefined || typeof bears.comes === "boolean"))) &&
    (birds === undefined ||
      (isRecord(birds) &&
        ["perMinute", "landing"].every(
          (key) => birds[key] === undefined || isNumber(birds[key]),
        ))) &&
    (wildlife === undefined ||
      (isRecord(wildlife) &&
        (wildlife.swarms === undefined ||
          typeof wildlife.swarms === "boolean"))) &&
    (weather === undefined ||
      (isRecord(weather) &&
        ["rain", "snow", "melt", "clouds", "cloudHeight"].every(
          (key) => weather[key] === undefined || isNumber(weather[key]),
        ))) &&
    (sea === undefined ||
      (isRecord(sea) &&
        ["swell", "swellLength", "windWaves", "momentum", "tide"].every(
          (key) => sea[key] === undefined || isNumber(sea[key]),
        ) &&
        (sea.tideRunning === undefined ||
          typeof sea.tideRunning === "boolean"))) &&
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
  /** Where the tree grows, read every frame. */
  readonly world: WorldSettings;
  /** What is planted, read whenever a tree is planted. */
  readonly planting: PlantingSettings;
  /** Live growth settings, read every frame. */
  readonly growth: Growth;
  /** Live wind settings. The wind reads these directly, so changes apply on the next frame. */
  readonly wind: WindSettings;
  /** Live rain and snow, read every frame. */
  readonly weather: WeatherSettings;
  /** Live settings for the sea, read every frame. The sea moves the tide while it follows the day. */
  readonly sea: SeaSettings;
  /** Live multipliers on how much the tree can take before it breaks. */
  readonly strength: Strength;
  /** Whether to mark how close each joint is to breaking. */
  showStrain: boolean;
  /** Live flower settings, read every frame. */
  readonly flowers: FlowerSettings;
  /** Live time of day and of year. The day moves the time of day on while it runs. */
  readonly time: TimeSettings;
  /** Live settings for the bees and their hives, read every frame. */
  readonly wildlife: HiveSettings;
  /** Live settings for how often birds come and land, read every frame. */
  readonly birds: BirdSettings;
  /** Live settings for whether hives draw bears, read every frame. */
  readonly bears: BearSettings;
  /**
   * How fast the simulation runs, as a multiple of real time; 0 pauses it. Not saved, so the game
   * never loads paused.
   */
  simulationSpeed = 1;
  /** Called whenever the level changes, to grow a tree there afresh. */
  onLevel: (level: LevelId) => void = () => {};
  /** Called whenever the species changes, to plant one of it afresh. */
  onSpecies: (species: Species) => void = () => {};
  /** Called whenever the growth mode changes. */
  onGrowthMode: (mode: GrowthMode) => void = () => {};
  /** Called to finish building every hive at once. */
  onFinishHives: () => void = () => {};
  /** Called to make the next click on a limb hang a hive there. */
  onPlaceHive: () => void = () => {};
  /** Called to send a bear in, to show a bear playing an animation, and to clear the bears away. */
  onSendBear: () => void = () => {};
  onShowBear: (pose: BearPose) => void = () => {};
  onClearBears: () => void = () => {};
  private open: boolean;
  private tab: Tab;
  private readonly root: HTMLElement;
  private readonly tabs = new Map<Tab, HTMLElement>();
  private readonly pages = new Map<Tab, HTMLElement>();
  private readonly speeds = new Map<number, HTMLElement>();
  private readonly levels = new Map<LevelId, HTMLElement>();
  private readonly levelDescription: HTMLElement;
  private readonly mountainsToggle: HTMLElement;
  private readonly timeOfDay: Slider;
  private readonly dayToggle: HTMLElement;
  private readonly season: Slider;
  private readonly arrow: SVGPathElement;
  private readonly heading: HTMLElement;
  private readonly windSpeed: Slider;
  private readonly rain: Slider;
  private readonly snow: Slider;
  private readonly melt: Slider;
  private readonly cloudCover: Slider;
  private readonly cloudHeight: Slider;
  private readonly swell: Slider;
  private readonly swellLength: Slider;
  private readonly windWaves: Slider;
  private readonly momentum: Slider;
  private readonly tide: Slider;
  private readonly tideToggle: HTMLElement;
  /** How the sea stands now, as it builds and calms. */
  private readonly seaNow: HTMLElement;
  private readonly models = new Map<WindModel, HTMLElement>();
  private readonly description: HTMLElement;
  private readonly species = new Map<Species, HTMLElement>();
  private readonly speciesDescription: HTMLElement;
  private readonly modes = new Map<GrowthMode, HTMLElement>();
  private readonly modeDescription: HTMLElement;
  private readonly flowRate: Slider;
  private readonly flowRateRow: HTMLElement;
  private readonly wood: Slider;
  private readonly roots: Slider;
  private readonly strainToggle: HTMLElement;
  private readonly flowerTitle: HTMLElement;
  private readonly flowerDescription: HTMLElement;
  private readonly placements = new Map<FlowerPlacement, HTMLElement>();
  private readonly placementDescription: HTMLElement;
  private readonly flowerSize: Slider;
  private readonly flowerHold: Slider;
  private readonly swarmsToggle: HTMLElement;
  private readonly birdRate: Slider;
  private readonly birdLanding: Slider;
  private readonly bearsToggle: HTMLElement;
  private readonly bearPoses = new Map<BearPose, HTMLElement>();
  /** The animation last shown, marked in the list. */
  private shownPose: BearPose | undefined;

  constructor(host: HTMLElement) {
    const saved = load();
    const settings = saved ?? defaults();
    this.world = { ...defaults().world, ...settings.world };
    this.planting = { ...defaults().planting, ...settings.planting };
    this.growth = { ...settings.growth };
    this.wind = { ...settings.wind };
    this.weather = { ...defaults().weather, ...settings.weather };
    this.sea = { ...defaults().sea, ...settings.sea };
    this.strength = { ...settings.strength };
    this.showStrain = settings.showStrain;
    // Saved settings may carry fields the flowers no longer have; only these carry over.
    this.flowers = {
      placement: settings.flowers.placement,
      size: settings.flowers.size,
    };
    this.time = { ...settings.time };
    this.wildlife = { ...defaults().wildlife, ...settings.wildlife };
    this.birds = { ...defaults().birds, ...settings.birds };
    this.bears = { ...defaults().bears, ...settings.bears };
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

    const levelPage = this.page("level", card);
    const where = element("section", "debug-section", levelPage);
    element("h2", "debug-title", where, "Level");
    const levels = element("div", "models", where);
    for (const level of LEVELS) {
      this.levels.set(
        level.id,
        this.radioRow(levels, level.name, () =>
          this.setWorld({ level: level.id }),
        ),
      );
    }
    this.levelDescription = element("p", "model-description", where);
    this.mountainsToggle = this.toggleRow(
      where,
      "Mountains on the horizon",
      () => this.setWorld({ mountains: !this.world.mountains }),
    );

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
    const fall = element("section", "debug-section", weather);
    element("h2", "debug-title", fall, "Rain and snow");
    this.rain = new Slider(fall, "Rain", (value) =>
      this.setWeather({ rain: value }),
    );
    this.snow = new Slider(fall, "Snow", (value) =>
      this.setWeather({ snow: value }),
    );
    this.melt = new Slider(fall, "Melting", (value) =>
      this.setWeather({ melt: sliderToRatio(value, MELT_RANGE) }),
    );
    const sky = element("section", "debug-section", weather);
    element("h2", "debug-title", sky, "Clouds");
    this.cloudCover = new Slider(sky, "Cover", (value) =>
      this.setWeather({ clouds: value }),
    );
    this.cloudHeight = new Slider(sky, "Height", (value) =>
      this.setWeather({ cloudHeight: value }),
    );

    const seaPage = this.page("sea", card);
    const waves = element("section", "debug-section", seaPage);
    element("h2", "debug-title", waves, "Sea");
    element(
      "p",
      "model-description",
      waves,
      "Swell rolls in from far out, and the wind raises waves of its own that run the way it blows. Both build and calm with the sea's momentum, stand taller as the water shoals, curl over and break on the shelf, and crash against the cliff. Only the cliff has a sea.",
    );
    this.seaNow = element("p", "model-description", waves);
    const swell = element("section", "debug-section", seaPage);
    element("h2", "debug-title", swell, "Swell");
    this.swell = new Slider(swell, "Height", (value) =>
      this.setSea({ swell: value }),
    );
    this.swellLength = new Slider(swell, "Length", (value) =>
      this.setSea({ swellLength: value }),
    );
    const raised = element("section", "debug-section", seaPage);
    element("h2", "debug-title", raised, "Wind and momentum");
    this.windWaves = new Slider(raised, "Wind waves", (value) =>
      this.setSea({ windWaves: value * MOST_WIND_WAVES }),
    );
    this.momentum = new Slider(raised, "Momentum", (value) =>
      this.setSea({ momentum: Math.pow(MOST_MOMENTUM, value) }),
    );
    const tide = element("section", "debug-section", seaPage);
    element("h2", "debug-title", tide, "Tide");
    this.tide = new Slider(tide, "Level", (value) =>
      this.setSea({ tide: value, tideRunning: false }),
    );
    this.tideToggle = this.toggleRow(tide, "Rises and falls with the day", () =>
      this.setSea({ tideRunning: !this.sea.tideRunning }),
    );

    const tree = this.page("tree", card);
    const kind = element("section", "debug-section", tree);
    element("h2", "debug-title", kind, "Species");
    const species = element("div", "models", kind);
    for (const { id, name } of SPECIES) {
      this.species.set(
        id,
        this.radioRow(species, name, () => this.setPlanting({ species: id })),
      );
    }
    this.speciesDescription = element("p", "model-description", kind);
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
      this.setStrength({ wood: sliderToRatio(value, STRENGTH_RANGE) }),
    );
    this.roots = new Slider(strength, "Roots", (value) =>
      this.setStrength({ roots: sliderToRatio(value, STRENGTH_RANGE) }),
    );
    this.strainToggle = this.toggleRow(strength, "Show strain", () => {
      this.showStrain = !this.showStrain;
      this.render();
      this.save();
    });

    const flowerPage = this.page("flowers", card);
    const flowers = element("section", "debug-section", flowerPage);
    this.flowerTitle = element("h2", "debug-title", flowers);
    this.flowerDescription = element("p", "model-description", flowers);
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
    this.flowerSize = new Slider(flowers, "Size", (value) =>
      this.setFlowers({ size: sliderToRatio(value, FLOWER_SIZE_RANGE) }),
    );
    this.flowerHold = new Slider(flowers, "Stem strength", (value) =>
      this.setStrength({ flowers: sliderToRatio(value, STRENGTH_RANGE) }),
    );

    const wildlife = this.page("wildlife", card);
    const bees = element("section", "debug-section", wildlife);
    element("h2", "debug-title", bees, "Bees");
    element(
      "p",
      "model-description",
      bees,
      "A tree in flower draws a swarm of bees for every 40 open flowers. They build a hive under low, sturdy wood among the flowers, far from any other hive, over half a day. To hang one yourself, press Place a hive and click a limb, or hold H and click one.",
    );
    this.swarmsToggle = this.toggleRow(bees, "Swarms come on their own", () =>
      this.setWildlife({ swarms: !this.wildlife.swarms }),
    );
    const place = element("div", "debug-reset", bees, "Place a hive");
    place.addEventListener("click", () => this.onPlaceHive());
    const finish = element("div", "debug-reset", bees, "Finish building");
    finish.addEventListener("click", () => this.onFinishHives());
    const flock = element("section", "debug-section", wildlife);
    element("h2", "debug-title", flock, "Birds");
    element(
      "p",
      "model-description",
      flock,
      "Birds fly across the scene. Some land on sturdy, level wood in view and sit a while, their weight bending thin limbs, and fly off if their limb is cut or breaks.",
    );
    this.birdRate = new Slider(flock, "How often", (value) =>
      this.setBirds({ perMinute: value * MOST_BIRDS }),
    );
    this.birdLanding = new Slider(flock, "Landing", (value) =>
      this.setBirds({ landing: value }),
    );
    const sleuth = element("section", "debug-section", wildlife);
    element("h2", "debug-title", sleuth, "Bears");
    element(
      "p",
      "model-description",
      sleuth,
      "A hive draws a bear after a while. It swipes the hive down on all fours if it hangs low enough, else reared up if it can reach it, else shoves the trunk to shake it down. Its swipes and shoves rouse the bees, which sting it until it runs; it eats a hive it brings down, and gives up after a while. Wood falling on it angers it, drives it off, or kills it.",
    );
    this.bearsToggle = this.toggleRow(sleuth, "Hives draw bears", () =>
      this.setBears({ comes: !this.bears.comes }),
    );
    const send = element("div", "debug-reset", sleuth, "Send in a bear");
    send.addEventListener("click", () => this.onSendBear());
    element("div", "debug-label", sleuth, "Show an animation");
    const poses = element("div", "models", sleuth);
    for (const pose of BEAR_POSES) {
      this.bearPoses.set(
        pose,
        this.radioRow(poses, BEAR_POSE_NAMES[pose], () => {
          this.shownPose = pose;
          this.onShowBear(pose);
          this.render();
        }),
      );
    }
    const clear = element("div", "debug-reset", sleuth, "Clear the bears");
    clear.addEventListener("click", () => {
      this.shownPose = undefined;
      this.onClearBears();
      this.render();
    });

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

  /**
   * Changes where the tree grows. A new level brings its own mountains, or none, and a tree grown
   * there afresh.
   */
  setWorld(settings: Partial<WorldSettings>): void {
    const before = this.world.level;
    Object.assign(this.world, settings);
    if (this.world.level !== before && settings.mountains === undefined) {
      this.world.mountains = levelById(this.world.level).mountains;
    }
    this.render();
    this.save();
    if (this.world.level !== before) {
      this.onLevel(this.world.level);
    }
  }

  /** Changes what is planted. A new species is planted afresh where the tree stands. */
  setPlanting(settings: Partial<PlantingSettings>): void {
    const before = this.planting.species;
    Object.assign(this.planting, settings);
    this.render();
    this.save();
    if (this.planting.species !== before) {
      this.onSpecies(this.planting.species);
    }
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

  setWildlife(settings: Partial<HiveSettings>): void {
    Object.assign(this.wildlife, settings);
    this.render();
    this.save();
  }

  setBirds(settings: Partial<BirdSettings>): void {
    Object.assign(this.birds, settings);
    this.render();
    this.save();
  }

  setBears(settings: Partial<BearSettings>): void {
    Object.assign(this.bears, settings);
    this.render();
    this.save();
  }

  setTime(settings: Partial<TimeSettings>): void {
    Object.assign(this.time, settings);
    this.render();
    this.save();
  }

  setWeather(settings: Partial<WeatherSettings>): void {
    Object.assign(this.weather, settings);
    this.render();
    this.save();
  }

  setSea(settings: Partial<SeaSettings>): void {
    Object.assign(this.sea, settings);
    this.render();
    this.save();
  }

  /**
   * Shows how the sea stands now, its waves `height` meters high, and keeps the tide's slider with
   * the tide while it follows the day.
   */
  showSea(height: number): void {
    const text = `Waves now ${height.toFixed(1)} m · ${nameFor(SEA_STATES, height)}`;
    if (this.seaNow.textContent !== text) {
      this.seaNow.textContent = text;
    }
    if (this.sea.tideRunning) {
      this.showTide();
    }
  }

  private showTide(): void {
    const { tide } = this.sea;
    this.tide.show(tide, nameFor(TIDES, tide));
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
    const level = this.world.level;
    const species = this.planting.species;
    const fresh = defaults();
    Object.assign(this.world, fresh.world);
    Object.assign(this.planting, fresh.planting);
    Object.assign(this.growth, fresh.growth);
    Object.assign(this.wind, fresh.wind);
    Object.assign(this.weather, fresh.weather);
    Object.assign(this.sea, fresh.sea);
    Object.assign(this.strength, fresh.strength);
    Object.assign(this.flowers, fresh.flowers);
    Object.assign(this.wildlife, fresh.wildlife);
    Object.assign(this.birds, fresh.birds);
    Object.assign(this.bears, fresh.bears);
    Object.assign(this.time, fresh.time);
    this.showStrain = fresh.showStrain;
    this.simulationSpeed = 1;
    this.render();
    this.save();
    if (this.growth.mode !== before) {
      this.onGrowthMode(this.growth.mode);
    }
    if (this.world.level !== level) {
      this.onLevel(this.world.level);
    } else if (this.planting.species !== species) {
      this.onSpecies(this.planting.species);
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

    for (const [id, row] of this.levels) {
      row.classList.toggle("selected", id === this.world.level);
    }
    this.levelDescription.textContent = levelById(this.world.level).description;
    this.mountainsToggle.classList.toggle("selected", this.world.mountains);

    this.showTimeOfDay();
    this.dayToggle.classList.toggle("selected", this.time.dayRunning);
    const { season } = this.time;
    this.season.show(season, seasonName(season));

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
    const { rain, snow, melt, clouds, cloudHeight } = this.weather;
    this.rain.show(rain, nameFor(RAINS, rain));
    this.snow.show(snow, nameFor(SNOWS, snow));
    this.melt.show(ratioToSlider(melt, MELT_RANGE), `×${melt.toFixed(2)}`);
    this.cloudCover.show(clouds, nameFor(COVERS, clouds));
    this.cloudHeight.show(cloudHeight, nameFor(HEIGHTS, cloudHeight));

    const { swell, swellLength, windWaves, momentum, tideRunning } = this.sea;
    const swellHeight = swellHeightFor(swell);
    this.swell.show(
      swell,
      `${swellHeight.toFixed(1)} m · ${nameFor(SWELLS, swellHeight)}`,
    );
    const period = swellPeriodFor(swellLength);
    this.swellLength.show(
      swellLength,
      `${period.toFixed(1)} s · ${nameFor(SWELL_LENGTHS, period)}`,
    );
    this.windWaves.show(
      windWaves / MOST_WIND_WAVES,
      `×${windWaves.toFixed(2)}`,
    );
    this.momentum.show(
      Math.log(momentum) / Math.log(MOST_MOMENTUM),
      `Builds over ${Math.round(momentum)} s`,
    );
    this.showTide();
    this.tideToggle.classList.toggle("selected", tideRunning);

    for (const [id, row] of this.species) {
      row.classList.toggle("selected", id === this.planting.species);
    }
    const planted = SPECIES.find((s) => s.id === this.planting.species);
    invariant(
      planted !== undefined,
      `Unknown species ${this.planting.species}.`,
    );
    this.speciesDescription.textContent = planted.description;
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
      ratioToSlider(this.strength.wood, STRENGTH_RANGE),
      `×${this.strength.wood.toFixed(2)}`,
    );
    this.roots.show(
      ratioToSlider(this.strength.roots, STRENGTH_RANGE),
      `×${this.strength.roots.toFixed(2)}`,
    );
    this.strainToggle.classList.toggle("selected", this.showStrain);

    const { placement, size } = this.flowers;
    for (const [id, row] of this.placements) {
      row.classList.toggle("selected", id === placement);
    }
    const placed = FLOWER_PLACEMENTS.find((p) => p.id === placement);
    invariant(placed !== undefined, `Unknown flower placement ${placement}.`);
    this.placementDescription.textContent =
      placed.description[this.planting.species];
    const flowerKind = FLOWER_KINDS[this.planting.species];
    this.flowerTitle.textContent = flowerKind.title;
    this.flowerDescription.textContent = flowerKind.description;
    this.flowerSize.show(
      ratioToSlider(size, FLOWER_SIZE_RANGE),
      `×${size.toFixed(2)}`,
    );
    this.flowerHold.show(
      ratioToSlider(this.strength.flowers, STRENGTH_RANGE),
      `×${this.strength.flowers.toFixed(2)}`,
    );

    this.swarmsToggle.classList.toggle("selected", this.wildlife.swarms);
    const { perMinute, landing } = this.birds;
    this.birdRate.show(
      perMinute / MOST_BIRDS,
      `${perMinute.toFixed(perMinute < 10 ? 1 : 0)} a minute`,
    );
    this.birdLanding.show(landing, `${Math.round(landing * 100)}%`);
    this.bearsToggle.classList.toggle("selected", this.bears.comes);
    for (const [pose, row] of this.bearPoses) {
      row.classList.toggle("selected", pose === this.shownPose);
    }
  }

  private save(): void {
    const saved: Saved = {
      open: this.open,
      tab: this.tab,
      world: this.world,
      planting: this.planting,
      growth: this.growth,
      wind: this.wind,
      weather: this.weather,
      sea: this.sea,
      strength: this.strength,
      showStrain: this.showStrain,
      flowers: this.flowers,
      time: this.time,
      wildlife: this.wildlife,
      birds: this.birds,
      bears: this.bears,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }
}
