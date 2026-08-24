import { describe, expect, it, vi } from 'vitest';

import {
  BEST_SCORE_STORAGE_KEY,
  loadBestScore,
  saveBestScore,
  type BestScoreStorage,
} from '../../src/storage/best-score';

const canonicalPayload = JSON.stringify({ version: 1, bestScore: 17 });

describe('best-score storage contract', () => {
  it('uses the single explicit versioned key and loads missing storage as zero', () => {
    const getItem = vi.fn(() => null);

    expect(BEST_SCORE_STORAGE_KEY).toBe('snakish.best-score.v1');
    expect(loadBestScore({ getItem, setItem: vi.fn() })).toBe(0);
    expect(getItem).toHaveBeenCalledOnce();
    expect(getItem).toHaveBeenCalledWith('snakish.best-score.v1');
  });

  it.each([
    ['zero', 0],
    ['non-multiple of ten', 17],
    ['largest safe integer', Number.MAX_SAFE_INTEGER],
  ])('loads a valid %s score', (_label, bestScore) => {
    const storage: BestScoreStorage = {
      getItem: () => JSON.stringify({ version: 1, bestScore }),
      setItem: vi.fn(),
    };

    expect(loadBestScore(storage)).toBe(bestScore);
  });

  it.each([
    ['version first', '{"version":1,"bestScore":17}'],
    [
      'bestScore first with legal JSON whitespace',
      '{\r\n\t "bestScore" \t:\r17,\n "version" : 1 \r\n}',
    ],
    [
      'escaped required member names',
      '{"ver\\u0073ion":1,"best\\u0053core":17}',
    ],
  ])('loads a valid payload with %s', (_label, storedValue) => {
    expect(
      loadBestScore({
        getItem: () => storedValue,
        setItem: vi.fn(),
      }),
    ).toBe(17);
  });

  it.each([
    [
      'duplicate version with a valid last value',
      '{"version":2,"version":1,"bestScore":17}',
    ],
    [
      'duplicate version with an invalid last value',
      '{"version":1,"version":2,"bestScore":17}',
    ],
    [
      'duplicate bestScore with a valid last value',
      '{"version":1,"bestScore":-1,"bestScore":17}',
    ],
    [
      'duplicate bestScore with an invalid last value',
      '{"version":1,"bestScore":17,"bestScore":-1}',
    ],
    [
      'both version and bestScore duplicated',
      '{"version":2,"bestScore":-1,"version":1,"bestScore":17}',
    ],
    [
      'escaped-equivalent duplicate member names',
      '{"version":2,"ver\\u0073ion":1,"bestScore":3,"best\\u0053core":17}',
    ],
  ])('loads zero for %s', (_label, storedValue) => {
    expect(
      loadBestScore({
        getItem: () => storedValue,
        setItem: vi.fn(),
      }),
    ).toBe(0);
  });

  it.each([
    ['malformed JSON', '{'],
    ['array', '[]'],
    ['null', 'null'],
    ['wrong version', JSON.stringify({ version: 2, bestScore: 10 })],
    ['missing version', JSON.stringify({ bestScore: 10 })],
    ['missing bestScore', JSON.stringify({ version: 1 })],
    [
      'extra field',
      JSON.stringify({ version: 1, bestScore: 10, foreign: true }),
    ],
    ['negative', JSON.stringify({ version: 1, bestScore: -1 })],
    ['fractional', JSON.stringify({ version: 1, bestScore: 1.5 })],
    [
      'unsafe integer',
      JSON.stringify({ version: 1, bestScore: Number.MAX_SAFE_INTEGER + 1 }),
    ],
    ['NaN-like string', JSON.stringify({ version: 1, bestScore: 'NaN' })],
    ['numeric string', JSON.stringify({ version: 1, bestScore: '10' })],
    ['boolean', JSON.stringify({ version: 1, bestScore: true })],
    ['object', JSON.stringify({ version: 1, bestScore: {} })],
    ['null score', JSON.stringify({ version: 1, bestScore: null })],
    ['wrong version type', JSON.stringify({ version: '1', bestScore: 10 })],
    [
      'own __proto__ field',
      '{"version":1,"bestScore":10,"__proto__":{"polluted":true}}',
    ],
  ])('loads %s as zero', (_label, storedValue) => {
    expect(
      loadBestScore({
        getItem: () => storedValue,
        setItem: vi.fn(),
      }),
    ).toBe(0);
  });

  it('saves the exact complete canonical payload without reading or merging', () => {
    const getItem = vi.fn(() => '{"foreign":true}');
    const setItem = vi.fn();
    const storage = Object.freeze({ getItem, setItem });

    expect(saveBestScore(storage, 17)).toBeUndefined();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).toHaveBeenCalledOnce();
    expect(setItem).toHaveBeenCalledWith(
      'snakish.best-score.v1',
      canonicalPayload,
    );
  });

  it.each([
    ['absent storage', undefined],
    [
      'throwing getItem method',
      {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: vi.fn(),
      },
    ],
    [
      'throwing getItem property access',
      Object.defineProperty({ setItem: vi.fn() }, 'getItem', {
        get: () => {
          throw new Error('blocked');
        },
      }),
    ],
  ])('loads zero for %s', (_label, storage) => {
    expect(() =>
      loadBestScore(storage as BestScoreStorage | undefined),
    ).not.toThrow();
    expect(loadBestScore(storage as BestScoreStorage | undefined)).toBe(0);
  });

  it.each([
    ['absent storage', undefined],
    [
      'throwing setItem method',
      {
        getItem: vi.fn(),
        setItem: () => {
          throw new Error('blocked');
        },
      },
    ],
    [
      'throwing setItem property access',
      Object.defineProperty({ getItem: vi.fn() }, 'setItem', {
        get: () => {
          throw new Error('blocked');
        },
      }),
    ],
  ])('silently ignores %s while saving', (_label, storage) => {
    expect(() =>
      saveBestScore(storage as BestScoreStorage | undefined, 17),
    ).not.toThrow();
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Infinity])(
    'does not write an invalid score (%s)',
    (bestScore) => {
      const setItem = vi.fn();

      saveBestScore({ getItem: vi.fn(), setItem }, bestScore);

      expect(setItem).not.toHaveBeenCalled();
    },
  );
});
