import type { Direction, GridPosition } from './model';

export const GRID_WIDTH = 20;
export const GRID_HEIGHT = 20;

export const INITIAL_DIRECTION: Direction = 'right';

export const INITIAL_SNAKE: readonly GridPosition[] = [
  { x: 10, y: 10 },
  { x: 9, y: 10 },
  { x: 8, y: 10 },
];

export const INITIAL_FOOD: GridPosition = { x: 14, y: 10 };

export const SCORE_PER_FOOD = 10;

/** Score required to enter each zero-based speed tier. */
export const SPEED_TIER_THRESHOLDS = [0, 50, 100, 200] as const;

export const MAX_SPEED_TIER = SPEED_TIER_THRESHOLDS.length - 1;
