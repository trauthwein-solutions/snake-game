import type { GridPosition } from './model';

export type RandomSource = () => number;

const assertValidDimension = (name: string, value: number): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
};

const positionKey = ({ x, y }: GridPosition): string => `${x},${y}`;

const normalizeRandomValue = (value: number): number => {
  if (Number.isNaN(value) || value <= 0) {
    return 0;
  }

  if (value >= 1) {
    return 1;
  }

  return value;
};

export const selectFreeCell = (
  width: number,
  height: number,
  occupied: readonly GridPosition[],
  randomSource: RandomSource,
): GridPosition | null => {
  assertValidDimension('width', width);
  assertValidDimension('height', height);

  const occupiedKeys = new Set(occupied.map(positionKey));
  const freeCells: GridPosition[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const candidate = { x, y };

      if (!occupiedKeys.has(positionKey(candidate))) {
        freeCells.push(candidate);
      }
    }
  }

  if (freeCells.length === 0) {
    return null;
  }

  const normalized = normalizeRandomValue(randomSource());
  const index = Math.min(
    Math.floor(normalized * freeCells.length),
    freeCells.length - 1,
  );

  return freeCells[index] ?? null;
};
