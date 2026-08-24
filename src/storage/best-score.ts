import { parseStrictJsonObject } from './strict-json-object';

export const BEST_SCORE_STORAGE_KEY = 'snakish.best-score.v1';

export interface BestScoreStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const isValidScore = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  Number.isSafeInteger(value) &&
  value >= 0;

const isBestScorePayload = (
  value: unknown,
): value is { version: 1; bestScore: number } => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !Object.hasOwn(value, 'version') ||
    !Object.hasOwn(value, 'bestScore')
  ) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return payload.version === 1 && isValidScore(payload.bestScore);
};

export function loadBestScore(
  storage: BestScoreStorage | null | undefined,
): number {
  try {
    const storedValue = storage?.getItem(BEST_SCORE_STORAGE_KEY);
    if (storedValue === null || storedValue === undefined) {
      return 0;
    }

    const payload = parseStrictJsonObject(storedValue, [
      'version',
      'bestScore',
    ]);
    return isBestScorePayload(payload) ? payload.bestScore : 0;
  } catch {
    return 0;
  }
}

export function saveBestScore(
  storage: BestScoreStorage | null | undefined,
  bestScore: number,
): void {
  if (!isValidScore(bestScore)) {
    return;
  }

  try {
    storage?.setItem(
      BEST_SCORE_STORAGE_KEY,
      JSON.stringify({ version: 1, bestScore }),
    );
  } catch {
    // Persistence is best-effort; the caller retains its in-memory best score.
  }
}
