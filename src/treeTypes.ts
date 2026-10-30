export type LimbKind = 'trunk' | 'root' | 'branch' | 'twig' | 'tendril';

export const SEG_LEN = 0.6;

export interface Segment {
  id: number;
  limbId: number;
  kind: LimbKind;
  /** Position of this segment within its limb. */
  index: number;
  /** Segment this one grows out of, or -1 when it is anchored at the seed. */
  parentId: number;
  childIds: number[];
  length: number;
  /** Rest angle relative to the parent's rest angle. Absolute for anchored segments. */
  rel: number;
  restAngle: number;
  /** Extra bend at the base joint caused by weight and wind. */
  bend: number;
  bendVel: number;
  /** Effective radius at the base of the segment. */
  radius: number;
  age: number;
  /** Strain relative to the breaking point. 1 means the segment is about to snap. */
  stress: number;
  damage: number;
  mass: number;
  /** Number of tendrils or twigs this segment has already spawned. */
  offshoots: number;
  /** Current deformed geometry. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  angle: number;
  /** Geometry with wind and weight taken out, which is what growth is planned against. */
  rx1: number;
  ry1: number;
}

export interface Limb {
  id: number;
  kind: LimbKind;
  parentSegId: number;
  order: number;
  segIds: number[];
  /** Radius added on top of the thin base radius through investment. */
  girth: number;
  energy: number;
  /** Player resources committed to this limb, used to price a prune refund. */
  invested: number;
  steer: number;
  closed: boolean;
  blocked: boolean;
  maxLength: number;
  phase: number;
  side: number;
  glow: number;
  /** Seconds this limb has been absorbing, used to avoid flicker. */
  absorbing: number;
}

export interface Flower {
  id: number;
  limbId: number;
  segId: number;
  slot: 'tip' | 'mid';
  side: number;
  /** Bloom progress from 0 to 1. */
  scale: number;
  maxScale: number;
  bloomDelay: number;
  /** Stored sunlight that pays the flower's size-dependent upkeep. */
  lightReserve: number;
  /** 1 is vigorous; 0 means the flower detaches. */
  health: number;
  glow: number;
  x: number;
  y: number;
}

export interface RibbonPoint {
  x: number;
  y: number;
  r: number;
  heat: number;
  glow: number;
}

export interface Ribbon {
  kind: LimbKind;
  points: RibbonPoint[];
}

export interface FlowerShape {
  x: number;
  y: number;
  scale: number;
  health: number;
  glow: number;
  opacity: number;
}
