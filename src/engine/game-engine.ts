import {
  INITIAL_DIRECTION,
  INITIAL_FOOD,
  INITIAL_SNAKE,
  SCORE_PER_FOOD,
} from './constants';
import type {
  Direction,
  GameCommand,
  GameState,
  GridPosition,
  WallMode,
} from './model';
import {
  collidesWithSnake,
  isInsideGrid,
  isOppositeDirection,
  positionsAreEqual,
  resolveNextHeadPosition,
  speedTierForScore,
} from './rules';

const clonePosition = (position: GridPosition): GridPosition => ({
  x: position.x,
  y: position.y,
});

export const createInitialState = (): GameState => ({
  status: 'ready',
  snake: INITIAL_SNAKE.map(clonePosition),
  food: clonePosition(INITIAL_FOOD),
  score: 0,
  speedTier: 0,
  lastAcceptedDirection: INITIAL_DIRECTION,
  pendingDirection: null,
});

const queueDirection = (state: GameState, direction: Direction): GameState => {
  if (
    state.status !== 'running' ||
    state.pendingDirection !== null ||
    direction === state.lastAcceptedDirection ||
    isOppositeDirection(direction, state.lastAcceptedDirection)
  ) {
    return state;
  }

  return {
    ...state,
    pendingDirection: direction,
  };
};

const advance = (
  state: GameState,
  command: Extract<GameCommand, { readonly type: 'tick' }>,
  wallMode: WallMode,
): GameState => {
  if (state.status !== 'running') {
    return state;
  }

  const direction = state.pendingDirection ?? state.lastAcceptedDirection;
  const head = state.snake[0];

  if (head === undefined) {
    return state;
  }

  const nextHead = resolveNextHeadPosition(head, direction, wallMode);
  const grows = state.food !== null && positionsAreEqual(nextHead, state.food);

  if (
    !isInsideGrid(nextHead) ||
    collidesWithSnake(nextHead, state.snake, grows)
  ) {
    return {
      ...state,
      status: 'gameOver',
      lastAcceptedDirection: direction,
      pendingDirection: null,
    };
  }

  const snake = grows
    ? [nextHead, ...state.snake]
    : [nextHead, ...state.snake.slice(0, -1)];

  if (!grows) {
    return {
      ...state,
      snake,
      lastAcceptedDirection: direction,
      pendingDirection: null,
    };
  }

  const score = state.score + SCORE_PER_FOOD;
  const completed = command.nextFood === null;

  return {
    ...state,
    status: completed ? 'completed' : 'running',
    snake,
    food: completed ? null : clonePosition(command.nextFood),
    score,
    speedTier: speedTierForScore(score),
    lastAcceptedDirection: direction,
    pendingDirection: null,
  };
};

export const applyCommand = (
  state: GameState,
  command: GameCommand,
  wallMode: WallMode = 'solid',
): GameState => {
  switch (command.type) {
    case 'start':
      return state.status === 'ready' ? { ...state, status: 'running' } : state;
    case 'turn':
      return queueDirection(state, command.direction);
    case 'pause':
      return state.status === 'running'
        ? { ...state, status: 'paused' }
        : state;
    case 'resume':
      return state.status === 'paused'
        ? { ...state, status: 'running' }
        : state;
    case 'tick':
      return advance(state, command, wallMode);
    case 'restart':
      return createInitialState();
  }
};
