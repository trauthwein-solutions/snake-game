import {
  GRID_HEIGHT,
  GRID_WIDTH,
  MAX_SPEED_TIER,
  SPEED_TIER_THRESHOLDS,
} from './constants';
import type { Direction, GridPosition, WallMode } from './model';

const DIRECTION_OFFSETS: Readonly<Record<Direction, GridPosition>> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

const OPPOSITE_DIRECTIONS: Readonly<Record<Direction, Direction>> = {
  up: 'down',
  right: 'left',
  down: 'up',
  left: 'right',
};

export const positionsAreEqual = (
  first: GridPosition,
  second: GridPosition,
): boolean => first.x === second.x && first.y === second.y;

export const isOppositeDirection = (
  direction: Direction,
  lastAcceptedDirection: Direction,
): boolean => OPPOSITE_DIRECTIONS[lastAcceptedDirection] === direction;

export const nextHeadPosition = (
  head: GridPosition,
  direction: Direction,
): GridPosition => {
  const offset = DIRECTION_OFFSETS[direction];

  return {
    x: head.x + offset.x,
    y: head.y + offset.y,
  };
};

export const resolveNextHeadPosition = (
  head: GridPosition,
  direction: Direction,
  wallMode: WallMode = 'solid',
): GridPosition => {
  const nextHead = nextHeadPosition(head, direction);

  if (wallMode === 'solid') {
    return nextHead;
  }

  return {
    x:
      nextHead.x < 0
        ? GRID_WIDTH - 1
        : nextHead.x >= GRID_WIDTH
          ? 0
          : nextHead.x,
    y:
      nextHead.y < 0
        ? GRID_HEIGHT - 1
        : nextHead.y >= GRID_HEIGHT
          ? 0
          : nextHead.y,
  };
};

export const isInsideGrid = (position: GridPosition): boolean =>
  position.x >= 0 &&
  position.x < GRID_WIDTH &&
  position.y >= 0 &&
  position.y < GRID_HEIGHT;

export const collidesWithSnake = (
  head: GridPosition,
  snake: readonly GridPosition[],
  grows: boolean,
): boolean => {
  const occupiedSegments = grows ? snake : snake.slice(0, -1);

  return occupiedSegments.some((segment) => positionsAreEqual(head, segment));
};

export const speedTierForScore = (score: number): number => {
  let tier = 0;

  for (let index = 1; index <= MAX_SPEED_TIER; index += 1) {
    if (score < SPEED_TIER_THRESHOLDS[index]) {
      break;
    }

    tier = index;
  }

  return tier;
};
