import type { Limb } from "./limb";
import { element, Slider } from "./ui";
import { clamp, invariant } from "./util";

/** Settings a spout can be snapped to in one click. */
const PRESETS: readonly (readonly [string, number])[] = [
  ["Off", 0],
  ["Half", 0.5],
  ["All", 1],
];
/** Gap between a spout and its popover, in CSS pixels. */
const GAP = 16;
/** The parts of the popover a press works rather than drags it by. */
const CONTROLS = ".slider, .chip, .spout-prune";

/** A popover beside one spout, for setting how much of the flow it sends into its offshoot. */
export class SpoutControl {
  /** The offshoot whose spout is open, if any. */
  limb: Limb | undefined;
  /**
   * Cuts off the open spout's branch. Set by the scene, which owns how a cut falls.
   */
  onPrune: (limb: Limb) => void = () => {
    invariant(false, "Nothing handles pruning a branch from its spout.");
  };
  /** What the popover sits over, which it keeps inside. */
  private readonly host: HTMLElement;
  private readonly root: HTMLElement;
  private readonly slider: Slider;
  private readonly presets: [HTMLElement, number][] = [];
  /** Whether the player has dragged the popover away from its spout, where it then stays. */
  private moved = false;
  /** A press dragging the popover, and where in the popover it took hold, in CSS pixels. */
  private grip: { pointerId: number; x: number; y: number } | undefined;

  constructor(host: HTMLElement) {
    this.host = host;
    this.root = element("div", "spout", host);
    this.root.addEventListener("pointerdown", (event) => this.grab(event));
    this.root.addEventListener("pointermove", (event) => this.drag(event));
    for (const type of ["pointerup", "pointercancel"] as const) {
      this.root.addEventListener(type, (event) => {
        if (event.pointerId === this.grip?.pointerId) {
          this.grip = undefined;
          this.root.classList.remove("dragging");
        }
      });
    }
    // A press anywhere off the popover closes it. Presses on the scene close it there, where a
    // press on another spout opens that one instead.
    document.addEventListener("pointerdown", (event) => {
      if (
        this.limb !== undefined &&
        event.target instanceof Node &&
        !this.host.contains(event.target)
      ) {
        this.close();
      }
    });
    element("div", "spout-title", this.root, "Spout");
    this.slider = new Slider(this.root, "Into this branch", (share) =>
      this.set(share),
    );
    const row = element("div", "chips", this.root);
    for (const [label, share] of PRESETS) {
      const chip = element("div", "chip", row, label);
      chip.addEventListener("click", () => this.set(share));
      this.presets.push([chip, share]);
    }
    const prune = element("div", "spout-prune", this.root, "Prune branch");
    prune.addEventListener("click", () => {
      invariant(this.limb !== undefined, "No spout is open.");
      this.onPrune(this.limb);
    });
    this.root.hidden = true;
  }

  open(limb: Limb): void {
    this.limb = limb;
    this.moved = false;
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    this.limb = undefined;
    this.grip = undefined;
    this.root.classList.remove("dragging");
    this.root.hidden = true;
  }

  /**
   * Keeps the popover beside its spout, which is at (x, y) in the host's CSS pixels, until the
   * player drags it elsewhere.
   */
  place(x: number, y: number): void {
    if (this.moved) {
      return;
    }
    const width = this.root.offsetWidth;
    const fitsRight = x + GAP + width < this.host.clientWidth - GAP;
    this.root.style.left = `${fitsRight ? x + GAP : x - GAP - width}px`;
    this.root.style.top = `${y - this.root.offsetHeight / 2}px`;
  }

  /** Takes hold of the popover to drag it, unless the press is on one of its controls. */
  private grab(event: PointerEvent): void {
    if (
      event.target instanceof Element &&
      event.target.closest(CONTROLS) !== null
    ) {
      return;
    }
    const box = this.root.getBoundingClientRect();
    this.grip = {
      pointerId: event.pointerId,
      x: event.clientX - box.left,
      y: event.clientY - box.top,
    };
    this.root.setPointerCapture(event.pointerId);
    this.root.classList.add("dragging");
  }

  /** Moves a held popover with the pointer, keeping it inside the host. */
  private drag(event: PointerEvent): void {
    if (event.pointerId !== this.grip?.pointerId) {
      return;
    }
    const host = this.host.getBoundingClientRect();
    const left = clamp(
      event.clientX - host.left - this.grip.x,
      0,
      this.host.clientWidth - this.root.offsetWidth,
    );
    const top = clamp(
      event.clientY - host.top - this.grip.y,
      0,
      this.host.clientHeight - this.root.offsetHeight,
    );
    this.root.style.left = `${left}px`;
    this.root.style.top = `${top}px`;
    this.moved = true;
  }

  private set(share: number): void {
    invariant(this.limb !== undefined, "No spout is open.");
    this.limb.spout = share;
    this.render();
  }

  private render(): void {
    invariant(this.limb !== undefined, "No spout is open.");
    const share = this.limb.spout;
    this.slider.show(share, `${Math.round(share * 100)}%`);
    for (const [chip, preset] of this.presets) {
      chip.classList.toggle("selected", preset === share);
    }
  }
}
