import { describe, expect, it, vi } from 'vitest';

import {
  GRID_HEIGHT,
  GRID_WIDTH,
  SCORE_PER_FOOD,
  SPEED_TIER_INTERVAL_MS,
} from '../../src/engine/constants';
import { applyCommand, createInitialState } from '../../src/engine/game-engine';
import type { GameState, GridPosition } from '../../src/engine/model';
import {
  advanceSimulation,
  tickIntervalForSpeedTier,
} from '../../src/engine/simulation';

const position = (x: number, y: number): GridPosition => ({ x, y });

const runningState = (overrides: Partial<GameState> = {}): GameState => ({
  ...createInitialState(),
  status: 'running',
  ...overrides,
});

const snakeFillingBoardExceptOrigin = (): readonly GridPosition[] =>
  Array.from({ length: GRID_HEIGHT }, (_, y) => {
    const row = Array.from({ length: GRID_WIDTH }, (_, x) => position(x, y));

    if (y === 0) {
      return row.slice(1);
    }

    return y % 2 === 0 ? row : row.reverse();
  }).flat();

const scoreForSnake = (snake: readonly GridPosition[]): number =>
  (snake.length - createInitialState().snake.length) * SCORE_PER_FOOD;

const stateBeforeFinalFood = (): GameState => {
  const snake = snakeFillingBoardExceptOrigin();

  return runningState({
    snake,
    food: position(0, 0),
    score: scoreForSnake(snake),
    speedTier: 3,
    lastAcceptedDirection: 'left',
  });
};

const stateWithStatus = (status: GameState['status']): GameState => {
  switch (status) {
    case 'ready':
      return createInitialState();
    case 'running':
      return runningState();
    case 'paused': {
      const queued = applyCommand(runningState(), {
        type: 'turn',
        direction: 'up',
      });

      return applyCommand(queued, { type: 'pause' });
    }
    case 'gameOver':
      return applyCommand(
        runningState({
          snake: [
            position(GRID_WIDTH - 1, 4),
            position(GRID_WIDTH - 2, 4),
            position(GRID_WIDTH - 3, 4),
          ],
          lastAcceptedDirection: 'right',
        }),
        { type: 'tick', nextFood: null },
      );
    case 'completed':
      return applyCommand(stateBeforeFinalFood(), {
        type: 'tick',
        nextFood: null,
      });
  }
};

describe('simulation speed policy', () => {
  it('maps every speed tier to its exact fixed-step interval', () => {
    expect(SPEED_TIER_INTERVAL_MS).toEqual([180, 155, 130, 110]);

    SPEED_TIER_INTERVAL_MS.forEach((intervalMs, speedTier) => {
      expect(tickIntervalForSpeedTier(speedTier)).toBe(intervalMs);
    });
  });

  it.each([
    -1,
    -0.5,
    0.5,
    3.5,
    4,
    Number.NaN,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ])('rejects invalid speed tier %s instead of clamping it', (speedTier) => {
    expect(() => tickIntervalForSpeedTier(speedTier)).toThrow(RangeError);
  });
});

describe('advanceSimulation', () => {
  it('delegates ordinary movement to the engine without consuming randomness', () => {
    const before = runningState({
      snake: [position(5, 5), position(4, 5), position(3, 5)],
      food: position(9, 9),
      lastAcceptedDirection: 'right',
    });
    const randomSource = vi.fn(() => 0.5);
    const expected = applyCommand(before, { type: 'tick', nextFood: null });

    const after = advanceSimulation(before, randomSource);

    expect(after).toEqual(expected);
    expect(randomSource).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'wall',
      state: runningState({
        snake: [
          position(GRID_WIDTH - 1, 4),
          position(GRID_WIDTH - 2, 4),
          position(GRID_WIDTH - 3, 4),
        ],
        lastAcceptedDirection: 'right',
      }),
    },
    {
      name: 'self',
      state: runningState({
        snake: [
          position(2, 2),
          position(1, 2),
          position(1, 1),
          position(2, 1),
          position(3, 1),
          position(3, 2),
          position(3, 3),
        ],
        lastAcceptedDirection: 'right',
      }),
    },
  ])(
    'delegates a $name collision to the engine without consuming randomness',
    ({ state }) => {
      const randomSource = vi.fn(() => 0.5);
      const expected = applyCommand(state, { type: 'tick', nextFood: null });

      const after = advanceSimulation(state, randomSource);

      expect(after).toEqual(expected);
      expect(after.status).toBe('gameOver');
      expect(randomSource).not.toHaveBeenCalled();
    },
  );

  it.each(['ready', 'paused', 'gameOver', 'completed'] as const)(
    'leaves a %s state under engine control without consuming randomness',
    (status) => {
      const before = stateWithStatus(status);
      const randomSource = vi.fn(() => 0.5);
      const expected = applyCommand(before, { type: 'tick', nextFood: null });

      const after = advanceSimulation(before, randomSource);

      expect(after).toBe(expected);
      expect(randomSource).not.toHaveBeenCalled();
    },
  );

  it('eats, grows, scores, changes tier, and selects food from the post-growth free cells', () => {
    const before = runningState({
      snake: [position(2, 1), position(1, 1), position(0, 1)],
      food: position(3, 1),
      score: 40,
      speedTier: 0,
      lastAcceptedDirection: 'right',
    });
    const randomSource = vi.fn(() => 0);

    const after = advanceSimulation(before, randomSource);

    expect(after).toEqual({
      ...before,
      snake: [position(3, 1), position(2, 1), position(1, 1), position(0, 1)],
      food: position(0, 0),
      score: 50,
      speedTier: 1,
      pendingDirection: null,
    });
    expect(after.food).not.toEqual(after.snake[0]);
    expect(after.snake).not.toContainEqual(after.food);
    expect(randomSource).toHaveBeenCalledTimes(1);
  });

  it('uses the only post-growth free cell and still calls randomness exactly once', () => {
    const almostFullSnake = snakeFillingBoardExceptOrigin().slice(0, -1);
    const before = runningState({
      snake: almostFullSnake,
      food: position(0, 0),
      score: scoreForSnake(almostFullSnake),
      speedTier: 3,
      lastAcceptedDirection: 'left',
    });
    const randomSource = vi.fn(() => 0);

    const after = advanceSimulation(before, randomSource);

    expect(after.status).toBe('running');
    expect(after.snake).toHaveLength(GRID_WIDTH * GRID_HEIGHT - 1);
    expect(after.snake[0]).toEqual(before.food);
    expect(after.food).toEqual(position(0, GRID_HEIGHT - 1));
    after.snake.forEach((segment) => {
      expect(after.food).not.toEqual(segment);
    });
    expect(randomSource).toHaveBeenCalledTimes(1);
  });

  it('completes after eating the final free cell without consulting randomness', () => {
    const before = stateBeforeFinalFood();
    const randomSource = vi.fn(() => 0.5);

    const after = advanceSimulation(before, randomSource);

    expect(after.status).toBe('completed');
    expect(after.food).toBeNull();
    expect(after.score).toBe(before.score + SCORE_PER_FOOD);
    expect(after.speedTier).toBe(3);
    expect(after.snake).toHaveLength(GRID_WIDTH * GRID_HEIGHT);
    expect(after.snake[0]).toEqual(position(0, 0));
    expect(randomSource).not.toHaveBeenCalled();
  });

  it('honors a queued legal turn when probing and completing an eating tick', () => {
    const before = runningState({
      snake: [position(2, 2), position(1, 2), position(0, 2)],
      food: position(2, 1),
      lastAcceptedDirection: 'right',
      pendingDirection: 'up',
    });
    const randomSource = vi.fn(() => 0);

    const after = advanceSimulation(before, randomSource);

    expect(after.snake[0]).toEqual(position(2, 1));
    expect(after.snake).toHaveLength(before.snake.length + 1);
    expect(after.score).toBe(SCORE_PER_FOOD);
    expect(after.lastAcceptedDirection).toBe('up');
    expect(after.pendingDirection).toBeNull();
    expect(after.food).toEqual(position(0, 0));
    expect(randomSource).toHaveBeenCalledTimes(1);
  });

  it('honors a queued legal turn into the body without consuming randomness', () => {
    const before = runningState({
      snake: [
        position(2, 2),
        position(1, 2),
        position(1, 1),
        position(2, 1),
        position(3, 1),
        position(3, 2),
        position(3, 3),
      ],
      food: position(9, 9),
      lastAcceptedDirection: 'right',
      pendingDirection: 'up',
    });
    const randomSource = vi.fn(() => 0.5);

    const after = advanceSimulation(before, randomSource);

    expect(after.status).toBe('gameOver');
    expect(after.lastAcceptedDirection).toBe('up');
    expect(after.pendingDirection).toBeNull();
    expect(randomSource).not.toHaveBeenCalled();
  });

  it('does not mutate caller-owned properties on the random source', () => {
    const marker = Object.freeze({ owner: 'caller' });
    const randomSource = Object.freeze(Object.assign(() => 0.5, { marker }));
    const before = runningState({
      snake: [position(2, 1), position(1, 1), position(0, 1)],
      food: position(3, 1),
    });

    advanceSimulation(before, randomSource);

    expect(randomSource.marker).toBe(marker);
  });

  it.each([
    {
      name: 'ordinary movement',
      state: runningState({
        snake: [position(5, 5), position(4, 5), position(3, 5)],
        food: position(9, 9),
      }),
    },
    {
      name: 'collision',
      state: runningState({
        snake: [position(0, 5), position(1, 5), position(2, 5)],
        lastAcceptedDirection: 'left',
      }),
    },
    {
      name: 'eating',
      state: runningState({
        snake: [position(2, 1), position(1, 1), position(0, 1)],
        food: position(3, 1),
      }),
    },
    {
      name: 'completion',
      state: stateBeforeFinalFood(),
    },
    {
      name: 'paused passthrough',
      state: runningState({
        status: 'paused',
        pendingDirection: 'up',
      }),
    },
  ])('does not mutate caller input during $name', ({ state }) => {
    const snapshot = structuredClone(state);
    const originalSnake = state.snake;
    const originalSegments = [...state.snake];
    const originalFood = state.food;
    const randomSource = () => 0.5;

    advanceSimulation(state, randomSource);

    expect(state).toEqual(snapshot);
    expect(state.snake).toBe(originalSnake);
    state.snake.forEach((segment, index) => {
      expect(segment).toBe(originalSegments[index]);
    });
    expect(state.food).toBe(originalFood);
  });
});
