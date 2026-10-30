import type { LevelDef } from './levels';
import { taperedPath, type TaperPoint } from './render/svgPath';

export interface ScreenHandle {
  destroy(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
  parent: SVGElement,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  parent.appendChild(node);
  return node;
}

/** Path data for a spiral that winds inward, the flourish the drawing ends every line with. */
function spiralPath(cx: number, cy: number, radius: number, direction: number, phase: number, turns: number): string {
  const steps = Math.ceil(turns * 14);
  let d = '';
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const angle = phase + direction * t * turns * Math.PI * 2;
    const r = radius * (1 - t * 0.93);
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d.trim();
}

function blossomPath(x: number, y: number, r: number): string {
  return [
    `M ${x - r} ${y + r * 0.2}`,
    `C ${x - r * 1.25} ${y - r * 0.35}, ${x - r * 0.75} ${y - r * 0.8}, ${x - r * 0.35} ${y - r * 0.6}`,
    `C ${x - r * 0.28} ${y - r * 1.15}, ${x + r * 0.35} ${y - r * 1.15}, ${x + r * 0.35} ${y - r * 0.62}`,
    `C ${x + r * 0.85} ${y - r * 0.82}, ${x + r * 1.2} ${y - r * 0.28}, ${x + r * 0.82} ${y + r * 0.15}`,
    `C ${x + r * 1.15} ${y + r * 0.62}, ${x + r * 0.42} ${y + r * 0.92}, ${x + r * 0.12} ${y + r * 0.58}`,
    `C ${x - r * 0.3} ${y + r}, ${x - r * 0.98} ${y + r * 0.7}, ${x - r} ${y + r * 0.2}`,
    'Z',
  ].join(' ');
}

/** A deliberately composed tree mark; no procedural branching is used here. */
function treeOfLife(): SVGElement {
  const root = document.createElementNS(SVG_NS, 'svg');
  root.setAttribute('viewBox', '0 0 400 400');
  root.setAttribute('class', 'tree-art');
  const line = {
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.35',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  };
  const silhouette = { ...line, fill: 'currentColor' };

  svg(
    'path',
    {
      ...line,
      d: 'M212 26 C324 34 376 126 374 212 C372 318 300 378 200 378 C100 378 28 316 26 212 C24 124 76 34 188 26',
    },
    root,
  );
  svg('path', { ...line, d: spiralPath(216, 30, 16, -1, -1.4, 1.1) }, root);
  svg('path', { ...line, d: spiralPath(184, 30, 14, 1, 4.5, 1.05) }, root);

  const roots: TaperPoint[][] = [
    [
      { x: 194, y: 343, w: 13 },
      { x: 170, y: 353, w: 8 },
      { x: 140, y: 356, w: 4.5 },
      { x: 108, y: 350, w: 1.4 },
    ],
    [
      { x: 206, y: 343, w: 13 },
      { x: 230, y: 353, w: 8 },
      { x: 260, y: 356, w: 4.5 },
      { x: 292, y: 350, w: 1.4 },
    ],
  ];
  for (const points of roots) {
    svg('path', { ...silhouette, d: taperedPath(points, 8) }, root);
  }

  const branches: TaperPoint[][] = [
    [
      { x: 198, y: 273, w: 10 },
      { x: 177, y: 260, w: 8 },
      { x: 150, y: 250, w: 5.2 },
      { x: 116, y: 242, w: 2.8 },
      { x: 80, y: 224, w: 0.8 },
    ],
    [
      { x: 202, y: 270, w: 10 },
      { x: 226, y: 258, w: 7.5 },
      { x: 257, y: 246, w: 4.8 },
      { x: 290, y: 231, w: 2.5 },
      { x: 325, y: 210, w: 0.8 },
    ],
    [
      { x: 199, y: 238, w: 8 },
      { x: 181, y: 220, w: 6 },
      { x: 163, y: 196, w: 3.8 },
      { x: 150, y: 166, w: 2.1 },
      { x: 142, y: 134, w: 0.7 },
    ],
    [
      { x: 201, y: 234, w: 8 },
      { x: 222, y: 216, w: 5.8 },
      { x: 244, y: 193, w: 3.7 },
      { x: 261, y: 164, w: 2 },
      { x: 270, y: 130, w: 0.7 },
    ],
    [
      { x: 200, y: 207, w: 6.5 },
      { x: 188, y: 185, w: 4.6 },
      { x: 182, y: 157, w: 2.8 },
      { x: 182, y: 126, w: 1.5 },
      { x: 174, y: 96, w: 0.6 },
    ],
    [
      { x: 201, y: 201, w: 6.5 },
      { x: 215, y: 180, w: 4.5 },
      { x: 224, y: 153, w: 2.8 },
      { x: 229, y: 121, w: 1.4 },
      { x: 238, y: 92, w: 0.6 },
    ],
  ];
  for (const points of branches) {
    svg('path', { ...silhouette, d: taperedPath(points, 8) }, root);
  }

  const trunk: TaperPoint[] = [
    { x: 200, y: 350, w: 18 },
    { x: 198, y: 316, w: 15 },
    { x: 202, y: 279, w: 12 },
    { x: 199, y: 242, w: 9.5 },
    { x: 202, y: 207, w: 7 },
    { x: 200, y: 174, w: 5 },
    { x: 202, y: 142, w: 3.2 },
    { x: 200, y: 110, w: 1.4 },
  ];
  svg('path', { ...silhouette, d: taperedPath(trunk, 8) }, root);

  const twigs = [
    'M80 224 C67 215 65 198 75 188',
    'M112 241 C96 252 91 267 99 280',
    'M142 134 C128 121 125 103 136 91',
    'M174 96 C160 82 160 67 171 57',
    'M238 92 C251 79 253 64 243 54',
    'M270 130 C287 117 291 100 281 88',
    'M325 210 C339 197 340 180 330 170',
    'M290 231 C308 236 318 249 314 264',
  ];
  for (const d of twigs) {
    svg('path', { ...line, d, 'stroke-width': '1.05' }, root);
  }
  for (const [x, y, r, direction] of [
    [72, 181, 10, -1],
    [99, 284, 9, 1],
    [133, 86, 10, -1],
    [170, 52, 9, 1],
    [244, 50, 9, -1],
    [284, 83, 10, 1],
    [333, 165, 10, -1],
    [315, 269, 9, 1],
  ] as [number, number, number, number][]) {
    svg(
      'path',
      {
        ...line,
        d: spiralPath(x, y, r, direction, direction > 0 ? 3 : 0.1, 1.05),
        'stroke-width': '1.05',
      },
      root,
    );
  }

  const blossoms: [number, number, number][] = [
    [84, 225, 7],
    [119, 242, 6],
    [151, 204, 7],
    [143, 145, 8],
    [174, 102, 7],
    [183, 160, 6],
    [202, 113, 8],
    [225, 153, 7],
    [270, 139, 8],
    [259, 195, 6],
    [292, 230, 7],
    [323, 209, 8],
    [112, 222, 5],
    [241, 219, 5],
  ];
  for (const [x, y, r] of blossoms) {
    svg(
      'path',
      {
        ...line,
        d: blossomPath(x, y, r),
        fill: 'var(--paper)',
        'stroke-width': '1.1',
      },
      root,
    );
  }

  for (const dir of [-1, 1]) {
    svg(
      'path',
      {
        ...line,
        d: spiralPath(
          200 + dir * 108,
          350,
          14,
          dir,
          dir > 0 ? 3 : 0.1,
          1.15,
        ),
      },
      root,
    );
    svg(
      'path',
      {
        ...line,
        d: spiralPath(
          200 + dir * 62,
          374,
          10,
          dir,
          dir > 0 ? 3 : 0.1,
          1.05,
        ),
      },
      root,
    );
  }
  svg('path', { ...line, d: 'M56 350 C120 370 280 370 344 350' }, root);
  return root;
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text: string | undefined,
  parent: HTMLElement,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) {
    element.textContent = text;
  }
  parent.appendChild(element);
  return element;
}

export function mountMainMenu(host: HTMLElement, onNewGame: () => void): ScreenHandle {
  const screen = node('div', 'screen menu', undefined, host);
  const art = node('div', 'menu-art', undefined, screen);
  art.appendChild(treeOfLife());
  const column = node('div', 'menu-column', undefined, screen);
  node('h1', 'logo', 'Arbaro', column);
  node('p', 'tagline', 'Grow a tree that can stand on its own', column);
  const newGame = node('button', 'btn primary', 'New game', column);
  newGame.type = 'button';
  newGame.addEventListener('click', onNewGame);
  const options = node('button', 'btn', 'Options', column);
  options.type = 'button';
  return { destroy: () => screen.remove() };
}

export function mountLevelSelect(
  host: HTMLElement,
  levels: readonly LevelDef[],
  onPick: (level: LevelDef) => void,
  onBack: () => void,
): ScreenHandle {
  const screen = node('div', 'screen levels', undefined, host);
  const header = node('div', 'levels-header', undefined, screen);
  const back = node('button', 'btn ghost tiny', 'Back', header);
  back.type = 'button';
  back.addEventListener('click', onBack);
  node('h1', 'levels-title', 'Choose a level', header);
  const grid = node('div', 'level-grid', undefined, screen);
  for (const level of levels) {
    const card = node('button', 'level-card', undefined, grid);
    card.type = 'button';
    node('div', 'level-number', `Level ${level.id}`, card);
    node('div', 'level-name', level.name, card);
    node('div', 'level-blurb', level.blurb, card);
    const goals = node('div', 'level-goals', undefined, card);
    node('span', '', `Height ${level.goal.height}`, goals);
    node('span', '', `${level.goal.flowers} flowers`, goals);
    card.addEventListener('click', () => onPick(level));
  }
  return { destroy: () => screen.remove() };
}
