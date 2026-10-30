import { Game, resourceFor, type Speed, type Tool } from './game';
import type { LevelDef } from './levels';
import { SceneRenderer, type ViewState } from './render/sceneRenderer';
import { COSTS, MAX_GIRTH } from './tree';
import type { Limb, LimbKind } from './treeTypes';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  parent?.appendChild(node);
  return node;
}

function button(label: string, className: string, onClick: () => void, parent: HTMLElement): HTMLButtonElement {
  const b = el('button', `btn ${className}`, label, parent);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

interface Gauge {
  root: HTMLElement;
  label: HTMLElement;
  value: HTMLElement;
  fill: HTMLElement;
}

function gauge(parent: HTMLElement, label: string): Gauge {
  const root = el('div', 'gauge', undefined, parent);
  const row = el('div', 'gauge-row', undefined, root);
  const labelNode = el('span', 'gauge-label', label, row);
  const value = el('span', 'gauge-value', '', row);
  const track = el('div', 'gauge-track', undefined, root);
  const fill = el('div', 'gauge-fill', undefined, track);
  return { root, label: labelNode, value, fill };
}

function setGauge(g: Gauge, fraction: number, text: string, alert: boolean): void {
  g.fill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  g.value.textContent = text;
  g.root.classList.toggle('alert', alert);
}

interface Readout {
  root: HTMLElement;
  value: HTMLElement;
  fill: HTMLElement;
}

function readout(parent: HTMLElement, label: string, className: string): Readout {
  const root = el('div', `res ${className}`, undefined, parent);
  const row = el('div', 'res-row', undefined, root);
  el('span', 'res-name', label, row);
  const value = el('span', 'res-value', '0', row);
  const track = el('div', 'res-track', undefined, root);
  const fill = el('div', 'res-fill', undefined, track);
  return { root, value, fill };
}

interface Fact {
  root: HTMLElement;
  label: HTMLElement;
  value: HTMLElement;
}

function fact(parent: HTMLElement, label: string): Fact {
  const row = el('div', 'fact', undefined, parent);
  return {
    root: row,
    label: el('span', '', label, row),
    value: el('span', '', '', row),
  };
}

const LIMB_NAMES: Record<LimbKind, string> = {
  trunk: 'Trunk',
  root: 'Root',
  branch: 'Branch',
  twig: 'Twig',
  tendril: 'Root hair',
};

function timeOfDayLabel(phase: number): string {
  if (phase < 0.08) return 'Dawn';
  if (phase < 0.3) return 'Morning';
  if (phase < 0.4) return 'Midday';
  if (phase < 0.55) return 'Afternoon';
  if (phase < 0.65) return 'Dusk';
  return 'Night';
}

export interface GameViewHandle {
  destroy(): void;
}

export function mountGameView(
  host: HTMLElement,
  level: LevelDef,
  callbacks: { onExit: () => void; onRestart: () => void },
): GameViewHandle {
  const root = el('div', 'game-root', undefined, host);
  const stage = el('div', 'game-stage', undefined, root);
  const game = new Game(level);
  const renderer = new SceneRenderer(stage, game);
  if (import.meta.env.DEV) {
    (window as unknown as { __game: Game; __renderer: SceneRenderer }).__game = game;
    (window as unknown as { __renderer: SceneRenderer }).__renderer = renderer;
  }

  const top = el('div', 'hud-top', undefined, root);
  const topLeft = el('div', 'hud-group', undefined, top);
  button('Levels', 'ghost tiny', callbacks.onExit, topLeft);
  el('div', 'hud-sep', undefined, topLeft);
  el('div', 'hud-title', level.name, topLeft);
  el('div', 'hud-sep', undefined, topLeft);
  const dayLabel = el('div', 'hud-note', '', topLeft);

  const resources = el('div', 'resources', undefined, top);
  const waterRes = readout(resources, 'Water', 'water');
  const lightRes = readout(resources, 'Light', 'light');

  const topRight = el('div', 'hud-group', undefined, top);
  const weatherLabel = el('div', 'hud-note', '', topRight);
  const speedBox = el('div', 'speed', undefined, topRight);
  const speedButtons = new Map<Speed, HTMLButtonElement>();
  for (const [value, label] of [
    [0, 'II'],
    [1, '1x'],
    [2, '2x'],
    [4, '4x'],
  ] as [Speed, string][]) {
    speedButtons.set(
      value,
      button(label, '', () => {
        game.speed = value;
      }, speedBox),
    );
  }

  const panel = el('div', 'panel', undefined, root);

  const goalSection = el('div', 'section', undefined, panel);
  el('h2', 'section-title', 'Goal', goalSection);
  const goalFacts = el('div', 'facts', undefined, goalSection);
  const goalHeight = fact(goalFacts, 'Height');
  const goalFlowers = fact(goalFacts, 'Flowers');

  const toolSection = el('div', 'section', undefined, panel);
  el('h2', 'section-title', 'Tools', toolSection);
  const toolRow = el('div', 'row', undefined, toolSection);
  const toolButtons = new Map<Tool, HTMLButtonElement>();
  toolButtons.set('select', button('Select', '', () => game.setTool('select'), toolRow));
  toolButtons.set('branch', button('Branch', '', () => game.setTool('branch'), toolRow));
  toolButtons.set('prune', button('Prune', 'danger', () => game.setTool('prune'), toolRow));
  const hint = el('p', 'hint', '', toolSection);

  const limbSection = el('div', 'section', undefined, panel);
  el('h2', 'section-title', 'Limbs', limbSection);
  const limbList = el('div', 'limb-list', undefined, limbSection);
  let limbListSignature = '';

  const selectedSection = el('div', 'section', undefined, panel);
  const selectedName = el('h3', 'selected-name', '', selectedSection);
  const selectedNote = el('div', 'selected-note', '', selectedSection);
  const selectedFacts = el('div', 'facts', undefined, selectedSection);
  const factLength = fact(selectedFacts, 'Length');
  const factThickness = fact(selectedFacts, 'Thickness');
  const factExtra = fact(selectedFacts, 'Carries');
  const factFlowers = fact(selectedFacts, 'Blossoms');
  const strainGauge = gauge(selectedSection, 'Strain');
  const storedGauge = gauge(selectedSection, 'Stored');
  const investButton = button('', 'primary wide', () => game.invest(), selectedSection);
  const steerRow = el('div', 'row', undefined, selectedSection);
  const steerLeft = button('← Steer', '', () => game.steer(-1), steerRow);
  const steerRight = button('Steer →', '', () => game.steer(1), steerRow);
  const splitButton = button('', 'wide', () => game.split(), selectedSection);
  const pruneButton = button('', 'wide danger', () => {
    if (game.selectedLimbId !== undefined) {
      game.prune(game.selectedLimbId);
    }
  }, selectedSection);
  const emptySelection = el('p', 'hint', 'Select the trunk, a branch or a root to grow it.', panel);

  const toast = el('div', 'toast', '', root);
  const overlay = el('div', 'overlay hidden', undefined, root);
  const overlayCard = el('div', 'overlay-card', undefined, overlay);
  const overlayTitle = el('h2', '', '', overlayCard);
  const overlayText = el('p', '', '', overlayCard);
  const overlayButtons = el('div', 'row', undefined, overlayCard);
  let overlayDismissed = false;
  const keepPlaying = button('Keep playing', 'primary', () => {
    overlayDismissed = true;
    overlay.classList.add('hidden');
  }, overlayButtons);
  button('Play again', '', callbacks.onRestart, overlayButtons);
  button('Levels', '', callbacks.onExit, overlayButtons);

  const view: ViewState = { seedGhost: undefined, branchRing: undefined, hoverX: 0, hoverY: 0 };
  let hovering = false;
  let panning = false;
  let lastPointer = { x: 0, y: 0 };

  const kindsToPick: readonly LimbKind[] = ['trunk', 'branch', 'root'];

  function refreshHover(): void {
    view.seedGhost = undefined;
    view.branchRing = undefined;
    if (!hovering) {
      return;
    }
    const { tree } = game;
    if (!tree) {
      view.seedGhost = { x: view.hoverX, valid: game.world.canPlantSeed(view.hoverX) };
      return;
    }
    if (game.tool === 'branch' && !tree.fallen) {
      const hit = tree.pick(view.hoverX, view.hoverY, 1.2, ['trunk', 'branch']);
      if (hit && tree.canBranchFrom(hit.segId)) {
        const seg = tree.seg(hit.segId);
        view.branchRing = { x: seg.x1, y: seg.y1 };
      }
    }
  }

  const onPointerMove = (e: PointerEvent): void => {
    const world = renderer.screenToWorld(e.clientX, e.clientY);
    view.hoverX = world.x;
    view.hoverY = world.y;
    hovering = true;
    if (panning) {
      renderer.panByPixels(e.clientX - lastPointer.x, e.clientY - lastPointer.y);
    }
    lastPointer = { x: e.clientX, y: e.clientY };
    refreshHover();
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey)) {
      panning = true;
      lastPointer = { x: e.clientX, y: e.clientY };
      renderer.canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) {
      return;
    }
    const world = renderer.screenToWorld(e.clientX, e.clientY);
    const { tree } = game;
    if (!tree) {
      game.plantSeed(world.x);
      return;
    }
    if (tree.fallen) {
      return;
    }
    const tolerance = Math.max(0.5, renderer.worldPerPixel * 10);
    switch (game.tool) {
      case 'branch': {
        const hit = tree.pick(world.x, world.y, 1.2, ['trunk', 'branch']);
        if (hit && tree.canBranchFrom(hit.segId)) {
          const seg = tree.seg(hit.segId);
          game.addBranch(hit.segId, world.x >= (seg.x0 + seg.x1) / 2 ? 1 : -1);
        } else {
          game.notify('Pick a spot on the trunk or a branch that has room.');
        }
        break;
      }
      case 'prune': {
        const hit = tree.pick(world.x, world.y, tolerance, ['trunk', 'branch', 'root', 'twig', 'tendril']);
        if (hit) {
          game.prune(hit.limbId);
        }
        break;
      }
      case 'select': {
        const hit = tree.pick(world.x, world.y, tolerance, kindsToPick);
        game.select(hit ? hit.limbId : undefined);
        break;
      }
      default: {
        const exhaustive: never = game.tool;
        throw new Error(`Unhandled tool ${String(exhaustive)}`);
      }
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (panning) {
      panning = false;
      renderer.canvas.releasePointerCapture(e.pointerId);
    }
  };

  const onPointerLeave = (): void => {
    hovering = false;
    refreshHover();
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    renderer.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0012));
  };

  const onContextMenu = (e: Event): void => e.preventDefault();

  const onKeyDown = (e: KeyboardEvent): void => {
    switch (e.key) {
      case ' ':
        e.preventDefault();
        game.speed = game.speed === 0 ? 1 : 0;
        break;
      case 'Escape':
        game.setTool('select');
        game.select(undefined);
        break;
      case 'g':
      case 'G':
      case 'Enter':
        game.invest();
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        e.preventDefault();
        game.steer(-1);
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        e.preventDefault();
        game.steer(1);
        break;
      case 'b':
      case 'B':
        game.setTool(game.tool === 'branch' ? 'select' : 'branch');
        break;
      case 'x':
      case 'X':
        game.setTool(game.tool === 'prune' ? 'select' : 'prune');
        break;
      default:
        break;
    }
  };

  const onResize = (): void => renderer.resize(stage.clientWidth, stage.clientHeight);

  renderer.canvas.addEventListener('pointermove', onPointerMove);
  renderer.canvas.addEventListener('pointerdown', onPointerDown);
  renderer.canvas.addEventListener('pointerup', onPointerUp);
  renderer.canvas.addEventListener('pointerleave', onPointerLeave);
  renderer.canvas.addEventListener('wheel', onWheel, { passive: false });
  renderer.canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);
  onResize();

  function rebuildLimbList(): void {
    const { tree } = game;
    const entries: { id: number; label: string }[] = [];
    if (tree) {
      const counts: Record<string, number> = {};
      for (const limb of tree.limbs.values()) {
        if (
          limb.kind === 'twig' ||
          limb.kind === 'tendril' ||
          ((limb.kind === 'branch' || limb.kind === 'root') &&
            limb.order > 1)
        ) {
          continue;
        }
        counts[limb.kind] = (counts[limb.kind] ?? 0) + 1;
        entries.push({
          id: limb.id,
          label: limb.kind === 'trunk' ? 'Trunk' : `${LIMB_NAMES[limb.kind]} ${counts[limb.kind]}`,
        });
      }
    }
    const signature = `${entries.map((e) => e.id).join(',')}|${game.selectedLimbId ?? ''}`;
    if (signature === limbListSignature) {
      return;
    }
    limbListSignature = signature;
    limbList.replaceChildren();
    for (const entry of entries) {
      const item = button(entry.label, 'tiny', () => game.select(entry.id), limbList);
      item.classList.toggle('active', entry.id === game.selectedLimbId);
    }
    limbSection.classList.toggle('hidden', entries.length === 0);
  }

  function describeStatus(limb: Limb): string {
    if (limb.blocked) return 'Blocked — steer another way';
    if (limb.closed) return 'Forked';
    if (limb.energy > 0.05) return 'Growing';
    return 'Idle';
  }

  function updateSelection(): void {
    const { tree } = game;
    const limb = game.selectedLimb;
    selectedSection.classList.toggle('hidden', !limb || !tree);
    emptySelection.classList.toggle('hidden', !!limb || !tree);
    if (!limb || !tree) {
      return;
    }
    const resource = resourceFor(limb.kind);
    const have = resource === 'water' ? game.water : game.light;
    selectedName.textContent = LIMB_NAMES[limb.kind];
    selectedNote.textContent = describeStatus(limb);
    selectedNote.classList.toggle('warn', limb.blocked);
    factLength.value.textContent = tree.limbLength(limb).toFixed(1);
    factThickness.value.textContent = `${Math.round((limb.girth / MAX_GIRTH[limb.kind]) * 100)}%`;

    if (limb.kind === 'root') {
      factExtra.label.textContent = 'Anchoring';
      factExtra.value.textContent = `${Math.round(tree.anchorShare(limb) * 100)}% of grip`;
      factFlowers.root.classList.add('hidden');
    } else {
      factExtra.label.textContent = 'Carries';
      factExtra.value.textContent = `${Math.round(tree.limbLoad(limb) * 100)}% of canopy`;
      const flowers = tree.flowerStats(limb);
      factFlowers.root.classList.remove('hidden');
      factFlowers.value.textContent =
        flowers.count === 0
          ? 'None'
          : `${flowers.count} · ${Math.round(flowers.averageHealth * 100)}% health`;
    }

    // Strain is this limb's own worst joint. Roots report the grip holding the whole tree.
    if (limb.kind === 'root') {
      const hold = Math.max(0, 1 - tree.anchorRatio);
      strainGauge.label.textContent = 'Root hold';
      setGauge(
        strainGauge,
        hold,
        `${Math.round(hold * 100)}%`,
        tree.anchorRatio > 0.7,
      );
    } else {
      const strain = tree.limbStrain(limb);
      strainGauge.label.textContent = 'Strain';
      setGauge(strainGauge, strain, `${Math.round(strain * 100)}%`, strain > 0.7);
    }
    setGauge(storedGauge, Math.min(1, limb.energy / 30), limb.energy.toFixed(0), false);

    investButton.textContent = `Grow · ${COSTS.invest} ${resource}`;
    investButton.disabled = have < COSTS.invest;
    const steerable = !limb.closed;
    steerLeft.disabled = !steerable;
    steerRight.disabled = !steerable;

    const splitCost = game.splitCost(limb);
    splitButton.classList.toggle('hidden', limb.kind === 'trunk');
    splitButton.textContent = `Fork · ${splitCost} ${resource}`;
    splitButton.disabled = !game.canSplitSelected() || have < splitCost;

    const prunable = game.canPruneSelected();
    pruneButton.classList.toggle('hidden', !prunable);
    if (prunable) {
      pruneButton.textContent = `Cut away · +${game.pruneRefund(limb)} ${resource}`;
    }
  }

  function updateHud(): void {
    const { env, tree } = game;
    root.classList.toggle('night', !env.isDay);
    rebuildLimbList();
    dayLabel.textContent = `Day ${env.dayNumber} · ${timeOfDayLabel(env.phase)}`;
    const windSpeed = Math.abs(env.wind);
    const windWord = windSpeed < 0.8 ? 'Calm' : windSpeed < 2 ? 'Breeze' : windSpeed < 3.4 ? 'Wind' : 'Gale';
    const arrow = env.wind < -0.05 ? '←' : env.wind > 0.05 ? '→' : '';
    const sky = env.rain > 0.3 ? 'Rain' : env.cloudCover > 0.55 ? 'Cloud' : 'Clear';
    weatherLabel.textContent = `${sky} · ${windWord} ${arrow}`;
    for (const [value, b] of speedButtons) {
      b.classList.toggle('active', game.speed === value);
    }

    waterRes.value.textContent = String(Math.floor(game.water));
    waterRes.fill.style.width = `${Math.min(1, game.water / game.waterCap) * 100}%`;
    lightRes.value.textContent = String(Math.floor(game.light));
    lightRes.fill.style.width = `${Math.min(1, game.light / game.lightCap) * 100}%`;

    const height = tree ? tree.height() : 0;
    const flowers = tree ? tree.bloomedFlowers() : 0;
    goalHeight.value.textContent = `${height.toFixed(1)} / ${level.goal.height}`;
    goalFlowers.value.textContent = `${flowers} / ${level.goal.flowers}`;

    for (const [tool, b] of toolButtons) {
      b.classList.toggle('active', game.tool === tool);
      b.disabled = !tree || tree.fallen;
    }
    renderer.canvas.style.cursor = !tree
      ? 'crosshair'
      : game.tool === 'branch'
        ? 'copy'
        : game.tool === 'prune'
          ? 'not-allowed'
          : 'default';

    if (!tree) {
      hint.textContent = 'Click the ground to plant your seed.';
    } else if (tree.fallen) {
      hint.textContent = 'Your tree has fallen.';
    } else if (game.tool === 'branch') {
      hint.textContent = 'Click the trunk or a branch, on the side you want the new branch to lean.';
    } else if (game.tool === 'prune') {
      hint.textContent = 'Click a limb to cut it and its offshoots away. Some of what you spent comes back.';
    } else {
      hint.textContent = 'Water grows roots and trunk. Light grows branches. Arrow keys steer.';
    }

    updateSelection();

    if (game.toast) {
      toast.textContent = game.toast.text;
      toast.classList.add('show');
    } else {
      toast.classList.remove('show');
    }

    if (game.status === 'won' && game.result) {
      overlayTitle.textContent = 'Your tree is complete';
      overlayText.textContent = `It reached ${game.result.height.toFixed(0)} tall with ${game.result.flowers} flowers by day ${game.result.day}.`;
      keepPlaying.classList.remove('hidden');
      overlay.classList.toggle('hidden', overlayDismissed);
    } else if (game.status === 'lost') {
      overlayTitle.textContent = 'Your tree fell';
      overlayText.textContent = 'Stronger roots, a thicker trunk or lighter branches would have kept it standing.';
      keepPlaying.classList.add('hidden');
      overlay.classList.remove('hidden');
    }
  }

  let frame = 0;
  let last = performance.now();
  let hudClock = 0;
  let destroyed = false;
  const loop = (now: number): void => {
    if (destroyed) {
      return;
    }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    game.update(dt);
    refreshHover();
    renderer.render(now / 1000, view);
    hudClock += dt;
    if (hudClock > 0.1) {
      hudClock = 0;
      updateHud();
    }
    frame = requestAnimationFrame(loop);
  };
  updateHud();
  frame = requestAnimationFrame(loop);

  return {
    destroy(): void {
      destroyed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      root.remove();
    },
  };
}
