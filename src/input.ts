import type { Controls } from './trunk';

const GROW = ['ArrowUp', 'KeyW', 'Space'];
const LEFT = ['ArrowLeft', 'KeyA'];
const RIGHT = ['ArrowRight', 'KeyD'];
const TRACKED = new Set([...GROW, ...LEFT, ...RIGHT]);

/** Tracks which control keys are held down. */
export class Keyboard {
  private readonly held = new Set<string>();

  constructor(target: Window) {
    target.addEventListener('keydown', (event) => {
      if (TRACKED.has(event.code)) {
        event.preventDefault();
        this.held.add(event.code);
      }
    });
    target.addEventListener('keyup', (event) => {
      this.held.delete(event.code);
    });
    target.addEventListener('blur', () => {
      this.held.clear();
    });
  }

  controls(): Controls {
    const holding = (codes: readonly string[]): boolean => codes.some((code) => this.held.has(code));
    return {
      grow: holding(GROW),
      steer: (holding(RIGHT) ? 1 : 0) - (holding(LEFT) ? 1 : 0),
    };
  }
}
