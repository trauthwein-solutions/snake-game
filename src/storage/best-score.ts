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

const hasExactBestScoreMemberNames = (serialized: string): boolean => {
  const memberNames: string[] = [];
  let depth = 0;
  let expectsMemberName = false;

  // JSON.parse has already established valid syntax and a top-level object.
  // Scan only its top-level string keys so duplicate or escaped-equivalent
  // names cannot be hidden by JSON.parse's last-member-wins behavior.
  for (let index = 0; index < serialized.length; index += 1) {
    const character = serialized[index];

    if (character === '"') {
      const tokenStart = index;
      index += 1;

      while (index < serialized.length) {
        if (serialized[index] === '\\') {
          index += 2;
          continue;
        }
        if (serialized[index] === '"') {
          break;
        }
        index += 1;
      }

      if (depth === 1 && expectsMemberName) {
        memberNames.push(JSON.parse(serialized.slice(tokenStart, index + 1)));
        expectsMemberName = false;
      }
      continue;
    }

    if (character === '{' || character === '[') {
      depth += 1;
      if (depth === 1) {
        expectsMemberName = true;
      }
    } else if (character === '}' || character === ']') {
      depth -= 1;
    } else if (character === ',' && depth === 1) {
      expectsMemberName = true;
    }
  }

  return (
    memberNames.length === 2 &&
    memberNames.includes('version') &&
    memberNames.includes('bestScore')
  );
};

export function loadBestScore(
  storage: BestScoreStorage | null | undefined,
): number {
  try {
    const storedValue = storage?.getItem(BEST_SCORE_STORAGE_KEY);
    if (storedValue === null || storedValue === undefined) {
      return 0;
    }

    const payload: unknown = JSON.parse(storedValue);
    return isBestScorePayload(payload) &&
      hasExactBestScoreMemberNames(storedValue)
      ? payload.bestScore
      : 0;
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
