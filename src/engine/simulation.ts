import { GRID_HEIGHT, GRID_WIDTH, SPEED_TIER_INTERVAL_MS } from './constants';
import { applyCommand } from './game-engine';
import type { GameState, WallMode } from './model';
import { selectFreeCell, type RandomSource } from './random';

export const tickIntervalForSpeedTier = (speedTier: number): number => {
  if (
    !Number.isInteger(speedTier) ||
    speedTier < 0 ||
    speedTier >= SPEED_TIER_INTERVAL_MS.length
  ) {
    throw new RangeError('speedTier must identify an available speed tier');
  }

  return SPEED_TIER_INTERVAL_MS[speedTier] as number;
};

export const advanceSimulation = (
  state: GameState,
  randomSource: RandomSource,
  wallMode: WallMode = 'solid',
): GameState => {
  const probe = applyCommand(state, { type: 'tick', nextFood: null }, wallMode);

  if (probe.score <= state.score) {
    return probe;
  }

  const nextFood = selectFreeCell(
    GRID_WIDTH,
    GRID_HEIGHT,
    probe.snake,
    randomSource,
  );

  return applyCommand(state, { type: 'tick', nextFood }, wallMode);
};
