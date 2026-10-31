import type { Strength } from './physics';
import type { Growth, GrowthMode } from './tree';
import { draggable, element, shape, Slider } from './ui';
import { invariant } from './util';
import { MAX_WIND_SPEED, WIND_MODELS, type WindModel, type WindSettings } from './wind';

const STORAGE_KEY = 'arbaro.debug.v3';
/** Strength sliders run from a quarter to four times normal, evenly in ratio. */
const STRENGTH_RANGE = 4;
/** Fastest flow the slider allows, as a multiple of the speed a held key grows a limb. */
const MAX_FLOW_RATE = 3;

const GROWTH_MODES: readonly { id: GrowthMode; name: string; description: string }[] = [
  {
    id: 'steer',
    name: 'Steer and grow',
    description: 'Hold up to grow the selected limb and steer it with left and right. Nothing else grows.',
  },
  {
    id: 'flow',
    name: 'Flow',
    description:
      'Nutrients rise from the roots and grow every tip at once. Each fork is a spout that splits the flow between the branch and the limb it grows from; click a spout to set its share. Left and right still steer the selected limb.',
  },
];

/** Beaufort scale: the wind speed in m/s where each named wind begins. */
const BEAUFORT: readonly (readonly [number, string])[] = [
  [0, 'Calm'],
  [0.5, 'Light air'],
  [1.6, 'Light breeze'],
  [3.4, 'Gentle breeze'],
  [5.5, 'Moderate breeze'],
  [8, 'Fresh breeze'],
  [10.8, 'Strong breeze'],
  [13.9, 'Near gale'],
  [17.2, 'Gale'],
  [20.8, 'Strong gale'],
  [24.5, 'Storm'],
  [28.5, 'Violent storm'],
  [32.7, 'Hurricane'],
];

/** Where the wind blows toward, in eighths of a turn counterclockwise from the right. */
const HEADINGS = ['right', 'up and right', 'up', 'up and left', 'left', 'down and left', 'down', 'down and right'];

interface Saved {
  open: boolean;
  growth: Growth;
  wind: WindSettings;
  strength: Strength;
  showStrain: boolean;
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
  const isNumber = (value: unknown): value is number => typeof value === 'number';
  invariant(
    typeof saved === 'object' &&
      saved !== null &&
      'open' in saved &&
      typeof saved.open === 'boolean' &&
      'showStrain' in saved &&
      typeof saved.showStrain === 'boolean' &&
      'growth' in saved &&
      typeof saved.growth === 'object' &&
      saved.growth !== null &&
      'mode' in saved.growth &&
      GROWTH_MODES.some((m) => m.id === (saved.growth as { mode: unknown }).mode) &&
      'flowRate' in saved.growth &&
      isNumber(saved.growth.flowRate) &&
      'wind' in saved &&
      typeof saved.wind === 'object' &&
      saved.wind !== null &&
      'direction' in saved.wind &&
      isNumber(saved.wind.direction) &&
      'strength' in saved.wind &&
      isNumber(saved.wind.strength) &&
      'model' in saved.wind &&
      WIND_MODELS.some((m) => m.id === (saved.wind as { model: unknown }).model) &&
      'strength' in saved &&
      typeof saved.strength === 'object' &&
      saved.strength !== null &&
      'wood' in saved.strength &&
      isNumber(saved.strength.wood) &&
      'roots' in saved.strength &&
      isNumber(saved.strength.roots),
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
  private readonly strainToggle: HTMLElement;

  constructor(host: HTMLElement) {
    const saved = load();
    this.growth = saved === undefined ? { mode: 'steer', flowRate: 1 } : { ...saved.growth };
    this.wind = saved === undefined ? { direction: 0, strength: 0, model: 'steady' } : { ...saved.wind };
    this.strength = saved === undefined ? { wood: 1, roots: 1 } : { ...saved.strength };
    this.showStrain = saved?.showStrain ?? false;
    this.open = saved?.open ?? false;

    this.root = element('aside', 'debug', host);
    const tab = element('div', 'debug-tab', this.root, 'Debug');
    tab.addEventListener('click', () => this.toggle());
    const card = element('div', 'debug-card', this.root);

    const growth = element('section', 'debug-section', card);
    element('h2', 'debug-title', growth, 'Growth');
    const modeList = element('div', 'models', growth);
    for (const mode of GROWTH_MODES) {
      const row = element('div', 'model', modeList);
      element('span', 'model-mark', row);
      element('span', '', row, mode.name);
      row.addEventListener('click', () => this.setGrowth({ mode: mode.id }));
      this.modes.set(mode.id, row);
    }
    this.modeDescription = element('p', 'model-description', growth);
    this.flowRateRow = element('div', '', growth);
    this.flowRate = new Slider(this.flowRateRow, 'Flow rate', (value) =>
      this.setGrowth({ flowRate: value * MAX_FLOW_RATE }),
    );

    const wind = element('section', 'debug-section', card);
    element('h2', 'debug-title', wind, 'Wind');

    const compass = shape('svg', { viewBox: '-70 -70 140 140', class: 'compass' }, wind);
    shape('circle', { r: 62, class: 'compass-ring' }, compass);
    shape('circle', { r: 49, class: 'compass-ring faint' }, compass);
    for (let i = 0; i < 24; i += 1) {
      const angle = (i * Math.PI) / 12;
      const major = i % 6 === 0;
      const inner = major ? 43 : 52;
      shape(
        'line',
        {
          x1: Math.cos(angle) * inner,
          y1: Math.sin(angle) * inner,
          x2: Math.cos(angle) * 57,
          y2: Math.sin(angle) * 57,
          class: major ? 'compass-tick major' : 'compass-tick',
        },
        compass,
      );
    }
    // A tapered stroke from a fine tail to a swept head, pointing along +x before rotation.
    this.arrow = shape(
      'path',
      {
        d: 'M -44 0 C -18 -0.8 6 -2.8 20 -3.2 L 17 -9 L 46 0 L 17 9 L 20 3.2 C 6 2.8 -18 0.8 -44 0 Z',
        class: 'compass-arrow',
      },
      compass,
    );
    shape('circle', { r: 3.2, class: 'compass-hub' }, compass);
    draggable(compass, (event) => {
      const box = compass.getBoundingClientRect();
      const dx = event.clientX - (box.left + box.width / 2);
      const dy = event.clientY - (box.top + box.height / 2);
      if (Math.hypot(dx, dy) > 3) {
        this.set({ direction: Math.atan2(-dy, dx) });
      }
    });
    this.heading = element('div', 'compass-readout', wind);
    this.speed = new Slider(wind, 'Strength', (value) => this.set({ strength: value }));

    element('div', 'debug-label', wind, 'Model');
    const list = element('div', 'models', wind);
    for (const model of WIND_MODELS) {
      const row = element('div', 'model', list);
      element('span', 'model-mark', row);
      element('span', '', row, model.name);
      row.addEventListener('click', () => this.set({ model: model.id }));
      this.models.set(model.id, row);
    }
    this.description = element('p', 'model-description', wind);

    const strength = element('section', 'debug-section', card);
    element('h2', 'debug-title', strength, 'Strength');
    this.wood = new Slider(strength, 'Wood', (value) => this.setStrength({ wood: sliderToStrength(value) }));
    this.roots = new Slider(strength, 'Roots', (value) => this.setStrength({ roots: sliderToStrength(value) }));
    this.strainToggle = element('div', 'model debug-toggle', strength);
    element('span', 'model-mark', this.strainToggle);
    element('span', '', this.strainToggle, 'Show strain');
    this.strainToggle.addEventListener('click', () => {
      this.showStrain = !this.showStrain;
      this.render();
      this.save();
    });

    window.addEventListener('keydown', (event) => {
      if (event.code === 'Backquote' && !event.repeat) {
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

  private render(): void {
    this.root.classList.toggle('open', this.open);

    for (const [id, row] of this.modes) {
      row.classList.toggle('selected', id === this.growth.mode);
    }
    const mode = GROWTH_MODES.find((m) => m.id === this.growth.mode);
    invariant(mode !== undefined, `Unknown growth mode ${this.growth.mode}.`);
    this.modeDescription.textContent = mode.description;
    this.flowRateRow.hidden = this.growth.mode !== 'flow';
    this.flowRate.show(this.growth.flowRate / MAX_FLOW_RATE, `×${this.growth.flowRate.toFixed(2)}`);

    const { direction, strength, model } = this.wind;
    this.arrow.setAttribute('transform', `rotate(${(-direction * 180) / Math.PI})`);
    const eighth = Math.round(direction / (Math.PI / 4));
    const heading = HEADINGS[((eighth % 8) + 8) % 8];
    invariant(heading !== undefined, `No heading for direction ${direction}.`);
    this.heading.textContent = `Blowing ${heading}`;

    const speed = strength * MAX_WIND_SPEED;
    const named = [...BEAUFORT].reverse().find(([from]) => speed >= from);
    invariant(named !== undefined, `No Beaufort name for ${speed} m/s.`);
    this.speed.show(strength, `${Math.round(speed)} m/s · ${named[1]}`);

    for (const [id, row] of this.models) {
      row.classList.toggle('selected', id === model);
    }
    const chosen = WIND_MODELS.find((m) => m.id === model);
    invariant(chosen !== undefined, `Unknown wind model ${model}.`);
    this.description.textContent = chosen.description;

    this.wood.show(strengthToSlider(this.strength.wood), `×${this.strength.wood.toFixed(2)}`);
    this.roots.show(strengthToSlider(this.strength.roots), `×${this.strength.roots.toFixed(2)}`);
    this.strainToggle.classList.toggle('selected', this.showStrain);
  }

  private save(): void {
    const saved: Saved = {
      open: this.open,
      growth: this.growth,
      wind: this.wind,
      strength: this.strength,
      showStrain: this.showStrain,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }
}
