import { clamp, invariant } from './util';
import { MAX_WIND_SPEED, WIND_MODELS, type WindModel, type WindSettings } from './wind';

const STORAGE_KEY = 'arbaro.debug.v1';
const SVG_NS = 'http://www.w3.org/2000/svg';

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
  wind: WindSettings;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent: Element,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  parent.appendChild(node);
  return node;
}

function shape<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
  parent: Element,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, String(value));
  }
  parent.appendChild(node);
  return node;
}

/** Follows a press-and-drag on `target`, calling `onMove` with each pointer position. */
function draggable(target: Element, onMove: (event: PointerEvent) => void): void {
  target.addEventListener('pointerdown', (event) => {
    invariant(event instanceof PointerEvent, 'Expected a pointer event.');
    target.setPointerCapture(event.pointerId);
    onMove(event);
  });
  target.addEventListener('pointermove', (event) => {
    invariant(event instanceof PointerEvent, 'Expected a pointer event.');
    if (target.hasPointerCapture(event.pointerId)) {
      onMove(event);
    }
  });
}

function load(): Saved | undefined {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    return undefined;
  }
  const saved: unknown = JSON.parse(raw);
  invariant(
    typeof saved === 'object' &&
      saved !== null &&
      'open' in saved &&
      typeof saved.open === 'boolean' &&
      'wind' in saved &&
      typeof saved.wind === 'object' &&
      saved.wind !== null &&
      'direction' in saved.wind &&
      typeof saved.wind.direction === 'number' &&
      'strength' in saved.wind &&
      typeof saved.wind.strength === 'number' &&
      'model' in saved.wind &&
      WIND_MODELS.some((m) => m.id === (saved.wind as { model: unknown }).model),
    `Saved debug settings under ${STORAGE_KEY} are malformed: ${raw}`,
  );
  return saved as Saved;
}

/** Collapsible panel on the right edge for poking at the simulation. */
export class DebugPanel {
  /** Live wind settings. The wind reads these directly, so changes apply on the next frame. */
  readonly wind: WindSettings;
  private open: boolean;
  private readonly root: HTMLElement;
  private readonly arrow: SVGPathElement;
  private readonly heading: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly thumb: HTMLElement;
  private readonly speed: HTMLElement;
  private readonly models = new Map<WindModel, HTMLElement>();
  private readonly description: HTMLElement;

  constructor(host: HTMLElement) {
    const saved = load();
    this.wind = saved === undefined ? { direction: 0, strength: 0, model: 'steady' } : { ...saved.wind };
    this.open = saved?.open ?? false;

    this.root = element('aside', 'debug', host);
    const tab = element('div', 'debug-tab', this.root, 'Debug');
    tab.addEventListener('click', () => this.toggle());
    const card = element('div', 'debug-card', this.root);

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

    const strengthRow = element('div', 'debug-label', wind);
    element('span', '', strengthRow, 'Strength');
    this.speed = element('span', 'debug-value', strengthRow);
    const slider = element('div', 'slider', wind);
    element('div', 'slider-track', slider);
    this.fill = element('div', 'slider-fill', slider);
    this.thumb = element('div', 'slider-thumb', slider);
    draggable(slider, (event) => {
      const box = slider.getBoundingClientRect();
      this.set({ strength: clamp((event.clientX - box.left - 6) / (box.width - 12), 0, 1) });
    });

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

  set(settings: Partial<WindSettings>): void {
    Object.assign(this.wind, settings);
    this.render();
    this.save();
  }

  private render(): void {
    this.root.classList.toggle('open', this.open);
    const { direction, strength, model } = this.wind;
    this.arrow.setAttribute('transform', `rotate(${(-direction * 180) / Math.PI})`);
    const eighth = Math.round(direction / (Math.PI / 4));
    const heading = HEADINGS[((eighth % 8) + 8) % 8];
    invariant(heading !== undefined, `No heading for direction ${direction}.`);
    this.heading.textContent = `Blowing ${heading}`;

    const percent = `${strength * 100}%`;
    this.fill.style.width = `calc(${percent} - ${strength * 12}px)`;
    this.thumb.style.left = `calc(6px + ${percent} - ${strength * 12}px)`;
    const speed = strength * MAX_WIND_SPEED;
    const named = [...BEAUFORT].reverse().find(([from]) => speed >= from);
    invariant(named !== undefined, `No Beaufort name for ${speed} m/s.`);
    this.speed.textContent = `${Math.round(speed)} m/s · ${named[1]}`;

    for (const [id, row] of this.models) {
      row.classList.toggle('selected', id === model);
    }
    const chosen = WIND_MODELS.find((m) => m.id === model);
    invariant(chosen !== undefined, `Unknown wind model ${model}.`);
    this.description.textContent = chosen.description;
  }

  private save(): void {
    const saved: Saved = { open: this.open, wind: this.wind };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }
}
