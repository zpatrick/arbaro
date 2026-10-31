import type { Limb } from "./limb";
import { element, Slider } from "./ui";
import { invariant } from "./util";

/** Settings a spout can be snapped to in one click. */
const PRESETS: readonly (readonly [string, number])[] = [
  ["Off", 0],
  ["Half", 0.5],
  ["All", 1],
];
/** Gap between a spout and its popover, in CSS pixels. */
const GAP = 16;

/** A popover beside one spout, for setting how much of the flow it sends into its offshoot. */
export class SpoutControl {
  /** The offshoot whose spout is open, if any. */
  limb: Limb | undefined;
  private readonly root: HTMLElement;
  private readonly slider: Slider;
  private readonly presets: [HTMLElement, number][] = [];

  constructor(host: HTMLElement) {
    this.root = element("div", "spout", host);
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
    this.root.hidden = true;
  }

  open(limb: Limb): void {
    this.limb = limb;
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    this.limb = undefined;
    this.root.hidden = true;
  }

  /** Keeps the popover beside its spout, which is at (x, y) in CSS pixels. */
  place(x: number, y: number): void {
    const width = this.root.offsetWidth;
    const fitsRight = x + GAP + width < window.innerWidth - GAP;
    this.root.style.left = `${fitsRight ? x + GAP : x - GAP - width}px`;
    this.root.style.top = `${y - this.root.offsetHeight / 2}px`;
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
