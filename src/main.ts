import './style.css';
import { Camera } from './camera';
import { Keyboard } from './input';
import { Renderer } from './render';
import { type Controls, Trunk } from './trunk';
import { invariant } from './util';

/** Longest frame step the simulation will take, so a stalled tab does not lurch forward. */
const MAX_STEP = 1 / 20;

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
let trunk = new Trunk(0, seed);

function resize(): void {
  camera.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
  renderer.resize(camera);
  hint.style.top = `${camera.groundY + (camera.height - camera.groundY) * 0.42}px`;
}

function replant(): void {
  seed += 1;
  trunk = new Trunk(0, seed);
}

resize();
camera.snap(trunk.bounds());
window.addEventListener('resize', resize);
window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyR' && !event.repeat) {
    replant();
  }
});

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(MAX_STEP, (now - last) / 1000);
  last = now;
  const controls = keyboard.controls();
  trunk.update(dt, controls);
  camera.follow(trunk.bounds(), dt);
  renderer.draw(camera, trunk);
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
  trunk(): Trunk;
  camera(): Camera;
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
        trunk.update(1 / 60, controls);
      }
      camera.snap(trunk.bounds());
    },
    replant() {
      replant();
      camera.snap(trunk.bounds());
    },
    trunk: () => trunk,
    camera: () => camera,
  };
}
