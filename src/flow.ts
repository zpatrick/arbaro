import type { Limb } from "./limb";
import type { Tree } from "./tree";
import { invariant } from "./util";

/** Dots of energy the roots release per second at a flow rate of one. */
const DOTS_PER_SECOND = 1.25;
/** Dots carrying less than this share of what left the roots are too small to follow. */
const SMALLEST = 1 / 64;

/** A dot of energy riding up through the wood. */
export interface Dot {
  limb: Limb;
  /** Distance along the limb. */
  s: number;
  /** Share of what left the roots that it carries. */
  amount: number;
}

/**
 * The nutrient flow, made visible. Dots leave the roots full size, split at every spout by its
 * share, and ride out to the tips, where they are used up. The flow itself grows the tree; the
 * dots only show where it goes.
 */
export class FlowDots {
  dots: Dot[] = [];
  /** Dots owed by the roots, released one whole dot at a time. */
  private owed = 0;

  clear(): void {
    this.dots = [];
    this.owed = 0;
  }

  /**
   * Releases new dots from the roots at `rate` and moves every dot `speed` world units per second
   * along the wood.
   */
  update(dt: number, tree: Tree, rate: number, speed: number): void {
    this.owed += dt * DOTS_PER_SECOND * rate;
    while (this.owed >= 1) {
      this.dots.push({ limb: tree.root, s: 0, amount: 1 });
      this.owed -= 1;
    }
    const moved: Dot[] = [];
    const travel = speed * dt;
    for (const dot of this.dots) {
      this.ride(dot, travel, tree, moved);
    }
    this.dots = moved;
  }

  /** Moves `dot` along its limb, splitting it at each spout it passes, into `moved`. */
  private ride(dot: Dot, travel: number, tree: Tree, moved: Dot[]): void {
    // A dot on wood that has fallen away goes with it.
    if (!tree.has(dot.limb)) {
      return;
    }
    const from = dot.s;
    const to = from + travel;
    const forkAt = (child: Limb): number => {
      invariant(child.attachment !== undefined, "An offshoot must fork off its parent.");
      return child.attachment.s;
    };
    const passed = dot.limb.children
      .filter((child) => forkAt(child) > from && forkAt(child) <= to)
      .sort((a, b) => forkAt(a) - forkAt(b));
    let amount = dot.amount;
    for (const child of passed) {
      const diverted = amount * child.spout;
      amount -= diverted;
      if (diverted >= SMALLEST) {
        this.ride({ limb: child, s: 0, amount: diverted }, to - forkAt(child), tree, moved);
      }
    }
    if (amount >= SMALLEST && to < dot.limb.length) {
      moved.push({ limb: dot.limb, s: to, amount });
    }
  }
}
