import { describe, expect, it } from 'vitest';

import { applyCommand, createInitialState } from '../../src/engine/game-engine';
import {
  GRID_HEIGHT,
  GRID_WIDTH,
  INITIAL_DIRECTION,
  INITIAL_FOOD,
  INITIAL_SNAKE,
  MAX_SPEED_TIER,
  SCORE_PER_FOOD,
  SPEED_TIER_THRESHOLDS,
} from '../../src/engine/constants';
import type {
  GameCommand,
  GameState,
  GridPosition,
} from '../../src/engine/model';

const position = (x: number, y: number): GridPosition => ({ x, y });

// @ts-expect-error Tick commands must always make replacement food explicit.
const tickWithoutReplacementFood: GameCommand = { type: 'tick' };
void tickWithoutReplacementFood;

const snakeFillingBoardExceptOrigin = (): readonly GridPosition[] =>
  Array.from({ length: GRID_HEIGHT }, (_, y) => {
    const row = Array.from({ length: GRID_WIDTH }, (_, x) => position(x, y));

    if (y === 0) {
      return row.slice(1);
    }

    return y % 2 === 0 ? row : row.reverse();
  }).flat();

const runningState = (overrides: Partial<GameState> = {}): GameState => ({
  ...createInitialState(),
  status: 'running',
  ...overrides,
});

const tick = (state: GameState, nextFood: GridPosition | null): GameState =>
  applyCommand(state, { type: 'tick', nextFood });

describe('SNAKISH game engine', () => {
  describe('initial state and lifecycle commands', () => {
    it('creates the same safe initial state every time', () => {
      const first = createInitialState();
      const second = createInitialState();

      expect(first).toEqual({
        status: 'ready',
        snake: INITIAL_SNAKE,
        food: INITIAL_FOOD,
        score: 0,
        speedTier: 0,
        lastAcceptedDirection: INITIAL_DIRECTION,
        pendingDirection: null,
      });
      expect(second).toEqual(first);
      expect(second).not.toBe(first);
      expect(second.snake).not.toBe(first.snake);
    });

    it('starts, pauses, and resumes through explicit state transitions', () => {
      const ready = createInitialState();
      const running = applyCommand(ready, { type: 'start' });
      const paused = applyCommand(running, { type: 'pause' });
      const resumed = applyCommand(paused, { type: 'resume' });

      expect(running.status).toBe('running');
      expect(paused.status).toBe('paused');
      expect(resumed.status).toBe('running');
    });

    it.each(['gameOver', 'completed'] as const)(
      'restarts a %s run to the stable initial state',
      (status) => {
        const finished = runningState({
          status,
          snake: [position(9, 9), position(8, 9)],
          food: status === 'completed' ? null : position(1, 1),
          score: 120,
          speedTier: 2,
          lastAcceptedDirection: 'down',
          pendingDirection: 'left',
        });

        expect(applyCommand(finished, { type: 'restart' })).toEqual(
          createInitialState(),
        );
      },
    );
  });

  describe('direction changes', () => {
    it('queues a legal turn and applies it on the next simulation tick', () => {
      const before = runningState({
        snake: [position(5, 5), position(4, 5), position(3, 5)],
        lastAcceptedDirection: 'right',
      });

      const queued = applyCommand(before, { type: 'turn', direction: 'up' });
      const advanced = tick(queued, null);

      expect(queued.pendingDirection).toBe('up');
      expect(queued.lastAcceptedDirection).toBe('right');
      expect(advanced.snake[0]).toEqual(position(5, 4));
      expect(advanced.lastAcceptedDirection).toBe('up');
      expect(advanced.pendingDirection).toBeNull();
    });

    it('rejects a turn opposite to the last accepted direction', () => {
      const before = runningState({ lastAcceptedDirection: 'right' });

      const after = applyCommand(before, { type: 'turn', direction: 'left' });

      expect(after).toEqual(before);
      expect(after.pendingDirection).toBeNull();
    });

    it('accepts at most one turn before a tick', () => {
      const before = runningState({
        snake: [position(5, 5), position(4, 5), position(3, 5)],
        lastAcceptedDirection: 'right',
      });

      const firstTurn = applyCommand(before, {
        type: 'turn',
        direction: 'up',
      });
      const secondTurn = applyCommand(firstTurn, {
        type: 'turn',
        direction: 'left',
      });
      const reversalAttempt = applyCommand(secondTurn, {
        type: 'turn',
        direction: 'down',
      });
      const advanced = tick(reversalAttempt, null);

      expect(reversalAttempt.pendingDirection).toBe('up');
      expect(advanced.snake[0]).toEqual(position(5, 4));
      expect(advanced.lastAcceptedDirection).toBe('up');
    });
  });

  describe('simulation ticks', () => {
    it('moves one grid cell without growing when no food is eaten', () => {
      const before = runningState({
        snake: [position(5, 5), position(4, 5), position(3, 5)],
        food: position(9, 9),
        lastAcceptedDirection: 'right',
      });

      const ignoredCandidate = position(7, 7);
      const after = tick(before, ignoredCandidate);

      expect(after.snake).toEqual([
        position(6, 5),
        position(5, 5),
        position(4, 5),
      ]);
      expect(after.food).toEqual(position(9, 9));
      expect(after.score).toBe(0);
    });

    it('consumes food, grows, scores, and installs the supplied next food', () => {
      const before = runningState({
        snake: [position(2, 1), position(1, 1), position(0, 1)],
        food: position(3, 1),
        lastAcceptedDirection: 'right',
      });
      const nextFood = position(7, 7);

      const after = tick(before, nextFood);

      expect(after.snake).toEqual([
        position(3, 1),
        position(2, 1),
        position(1, 1),
        position(0, 1),
      ]);
      expect(after.food).toEqual(nextFood);
      expect(after.score).toBe(SCORE_PER_FOOD);
      expect(after.status).toBe('running');
    });

    it('ends the run after a lethal wall collision', () => {
      const before = runningState({
        snake: [
          position(GRID_WIDTH - 1, 4),
          position(GRID_WIDTH - 2, 4),
          position(GRID_WIDTH - 3, 4),
        ],
        lastAcceptedDirection: 'right',
      });

      expect(tick(before, null).status).toBe('gameOver');
    });

    it('ends the run after colliding with the snake body', () => {
      const before = runningState({
        snake: [
          position(2, 2),
          position(2, 3),
          position(3, 3),
          position(3, 2),
          position(4, 2),
        ],
        lastAcceptedDirection: 'right',
      });

      expect(tick(before, null).status).toBe('gameOver');
    });

    it('does not advance while paused', () => {
      const paused = runningState({
        status: 'paused',
        snake: [position(5, 5), position(4, 5), position(3, 5)],
        pendingDirection: 'up',
      });

      expect(tick(paused, null)).toEqual(paused);
    });

    it('enters completed when eaten food leaves no free board cell', () => {
      const before = runningState({
        snake: snakeFillingBoardExceptOrigin(),
        food: position(0, 0),
        lastAcceptedDirection: 'left',
      });

      const after = tick(before, null);

      expect(after.status).toBe('completed');
      expect(after.food).toBeNull();
      expect(after.score).toBe(SCORE_PER_FOOD);
      expect(after.snake).toHaveLength(before.snake.length + 1);
    });
  });

  describe('speed tiers', () => {
    it('documents the score threshold for every speed tier', () => {
      expect(SPEED_TIER_THRESHOLDS).toEqual([0, 50, 100, 200]);
      expect(MAX_SPEED_TIER).toBe(3);
    });

    it.each(
      SPEED_TIER_THRESHOLDS.slice(1).map((threshold, tier) => ({
        scoreBeforeEating: threshold - SCORE_PER_FOOD,
        expectedScore: threshold,
        expectedTier: tier + 1,
      })),
    )(
      'raises the speed tier to $expectedTier at $expectedScore points',
      ({ scoreBeforeEating, expectedScore, expectedTier }) => {
        const before = runningState({
          snake: [position(2, 1), position(1, 1), position(0, 1)],
          food: position(3, 1),
          score: scoreBeforeEating,
          speedTier: expectedTier - 1,
          lastAcceptedDirection: 'right',
        });

        const after = tick(before, position(7, 7));

        expect(after.score).toBe(expectedScore);
        expect(after.speedTier).toBe(expectedTier);
      },
    );

    it('caps the speed tier after the final threshold', () => {
      const before = runningState({
        snake: [position(2, 1), position(1, 1), position(0, 1)],
        food: position(3, 1),
        score: SPEED_TIER_THRESHOLDS[MAX_SPEED_TIER] + SCORE_PER_FOOD,
        speedTier: MAX_SPEED_TIER,
        lastAcceptedDirection: 'right',
      });

      expect(tick(before, position(7, 7)).speedTier).toBe(MAX_SPEED_TIER);
    });
  });

  describe('immutability', () => {
    it.each<GameCommand>([
      { type: 'turn', direction: 'up' },
      { type: 'tick', nextFood: null },
      { type: 'pause' },
    ])('does not mutate state or input arrays for $type', (command) => {
      const snake = [position(5, 5), position(4, 5), position(3, 5)];
      const before = runningState({ snake, food: position(9, 9) });
      const snapshot = structuredClone(before);

      applyCommand(before, command);

      expect(before).toEqual(snapshot);
      expect(snake).toEqual(snapshot.snake);
    });
  });

  it('documents a rectangular board with usable wall boundaries', () => {
    expect(GRID_WIDTH).toBeGreaterThan(INITIAL_SNAKE.length);
    expect(GRID_HEIGHT).toBeGreaterThan(1);
  });
});
