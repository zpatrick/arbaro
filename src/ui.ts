import { clamp, invariant } from "./util";

const SVG_NS = "http://www.w3.org/2000/svg";

export function element<K extends keyof HTMLElementTagNameMap>(
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

export function shape<K extends keyof SVGElementTagNameMap>(
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
export function draggable(
  target: Element,
  onMove: (event: PointerEvent) => void,
): void {
  target.addEventListener("pointerdown", (event) => {
    invariant(event instanceof PointerEvent, "Expected a pointer event.");
    target.setPointerCapture(event.pointerId);
    onMove(event);
  });
  target.addEventListener("pointermove", (event) => {
    invariant(event instanceof PointerEvent, "Expected a pointer event.");
    if (target.hasPointerCapture(event.pointerId)) {
      onMove(event);
    }
  });
}

/** A labeled slider over 0 to 1, with a readout beside the label. */
export class Slider {
  private readonly fill: HTMLElement;
  private readonly thumb: HTMLElement;
  private readonly readout: HTMLElement;

  constructor(
    parent: Element,
    label: string,
    onChange: (value: number) => void,
  ) {
    const row = element("div", "debug-label", parent);
    element("span", "", row, label);
    this.readout = element("span", "debug-value", row);
    const track = element("div", "slider", parent);
    element("div", "slider-track", track);
    this.fill = element("div", "slider-fill", track);
    this.thumb = element("div", "slider-thumb", track);
    draggable(track, (event) => {
      const box = track.getBoundingClientRect();
      onChange(clamp((event.clientX - box.left - 6) / (box.width - 12), 0, 1));
    });
  }

  show(value: number, readout: string): void {
    const percent = `${value * 100}%`;
    this.fill.style.width = `calc(${percent} - ${value * 12}px)`;
    this.thumb.style.left = `calc(6px + ${percent} - ${value * 12}px)`;
    this.readout.textContent = readout;
  }
}
