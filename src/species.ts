/** The kinds of tree there are to plant. */
export type Species = "cherry" | "willow";

/** What the debug panel calls each species, and what it says about how each grows. */
export const SPECIES: readonly {
  id: Species;
  name: string;
  description: string;
}[] = [
  {
    id: "cherry",
    name: "Cherry",
    description:
      "Left to themselves its limbs drift back upright. It carries mounds of cherry blossom along its thin wood, which turn, wilt and drop through autumn.",
  },
  {
    id: "willow",
    name: "Weeping willow",
    description:
      "A crooked trunk whose branches arch out and over as they lengthen, then weep. Long strands of narrow leaves and golden catkins hang from its thin wood in curtains that swing and stream in the wind, yellow and shed through autumn, and hang bare through winter.",
  },
];

/** How a species' limbs grow when left to themselves, and how far they can be steered. */
export interface Habit {
  /** Gentle meander, in radians per world unit before scaling, while a tip grows unsteered. */
  wander: number;
  /** Turn rate per radian of lean, before scaling, that rights a tip while it is not steered. */
  uprightPull: number;
  /**
   * Steering turns a tip freely until it leans this far from vertical, easing off before it. Past
   * it a tip still turns, more slowly, out to `maxLean`.
   */
  freeLean: number;
  /** Furthest a tip may be steered from vertical. */
  maxLean: number;
  /**
   * For a species whose branches weep: left to itself, an offshoot turns ever further from
   * upright as it grows, `arch` radians for every world unit before scaling, until it leans `most`
   * from vertical. The trunk rights itself all the same.
   */
  weep: { arch: number; most: number } | undefined;
}

export const HABITS: Readonly<Record<Species, Habit>> = {
  cherry: {
    wander: 0.07,
    uprightPull: 0.12,
    freeLean: 1.0,
    // A little past level, so a limb can droop.
    maxLean: 1.75,
    weep: undefined,
  },
  willow: {
    wander: 0.12,
    uprightPull: 0.07,
    freeLean: 1.3,
    // Far enough past level that a branch can be steered down to weep.
    maxLean: 2.7,
    weep: { arch: 0.3, most: 2.5 },
  },
};
