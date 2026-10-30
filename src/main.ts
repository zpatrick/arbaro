import './style.css';
import { Camera } from './camera';
import { Keyboard } from './input';
import type { Controls } from './limb';
import { Renderer } from './render';
import { type Pick, Tree } from './tree';
import { at, invariant } from './util';

/** Longest frame step the simulation will take, so a stalled tab does not lurch forward. */
const MAX_STEP = 1 / 20;
/** How close to a limb, in CSS pixels, the pointer must be to pick it. */
const PICK_TOLERANCE_PX = 10;

function element<T extends HTMLElement>(selector: string, type: new () => T): T {
  const found = document.querySelector(selector);
  invariant(found instanceof type, `Missing ${selector}.`);
  return found;
}

const canvas = element('#scene', HTMLCanvasElement);
const hint = element('#hint', HTMLDivElement);
const camera = new Camera();
const renderer = new Renderer(canvas);
const keyboard = new Keyboard(window);

let seed = 1;
let tree = new Tree(0, seed);
let pointer: { x: number; y: number } | undefined;

function resize(): void {
  camera.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
  renderer.resize(camera);
  hint.style.top = `${camera.groundY + (camera.height - camera.groundY) * 0.42}px`;
}

function replant(): void {
  seed += 1;
  tree = new Tree(0, seed);
}

function pickAt(x: number, y: number): Pick | undefined {
  const world = camera.toWorld(x, y);
  return tree.pick(world.x, world.y, PICK_TOLERANCE_PX / camera.scale);
}

resize();
camera.snap(tree.bounds());
window.addEventListener('resize', resize);
window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyR' && !event.repeat) {
    replant();
  }
});
canvas.addEventListener('pointermove', (event) => {
  pointer = { x: event.clientX, y: event.clientY };
});
canvas.addEventListener('pointerleave', () => {
  pointer = undefined;
});
// Clicking a limb makes it the one that grows and steers. Clicking the limb that already is
// forks a new offshoot from that spot.
canvas.addEventListener('pointerdown', (event) => {
  const pick = pickAt(event.clientX, event.clientY);
  if (pick === undefined) {
    return;
  }
  if (pick.limb === tree.active) {
    tree.fork(pick.limb, pick.s, pick.side);
  } else {
    tree.select(pick.limb);
  }
});

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(MAX_STEP, (now - last) / 1000);
  last = now;
  const controls = keyboard.controls();
  tree.update(dt, controls);
  camera.follow(tree.bounds(), dt);
  const hover = pointer === undefined ? undefined : pickAt(pointer.x, pointer.y);
  canvas.style.cursor = hover === undefined ? '' : 'pointer';
  renderer.draw(camera, tree, hover);
  if (controls.grow) {
    hint.classList.add('quiet');
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

interface DebugHandle {
  /** Steps the simulation at 60 Hz as if `controls` were held for `seconds`, then frames the result. */
  simulate(seconds: number, controls: Controls): void;
  replant(): void;
  tree(): Tree;
  camera(): Camera;
  /** Forks limb `index` at `fraction` of its length toward `side` (1 left, -1 right), like a click. */
  fork(index: number, fraction: number, side: 1 | -1): void;
  /** Makes limb `index` the one that grows and steers, like a click. */
  select(index: number): void;
}

declare global {
  interface Window {
    __arbaro?: DebugHandle;
  }
}

if (import.meta.env.DEV) {
  window.__arbaro = {
    simulate(seconds, controls) {
      for (let i = 0; i < Math.round(seconds * 60); i += 1) {
        tree.update(1 / 60, controls);
      }
      camera.snap(tree.bounds());
    },
    replant() {
      replant();
      camera.snap(tree.bounds());
    },
    tree: () => tree,
    camera: () => camera,
    fork(index, fraction, side) {
      const limb = at(tree.limbs, index);
      tree.fork(limb, limb.length * fraction, side);
      camera.snap(tree.bounds());
    },
    select(index) {
      tree.select(at(tree.limbs, index));
    },
  };
}
