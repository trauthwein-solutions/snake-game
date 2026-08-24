import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_PREFERENCES,
  PREFERENCES_STORAGE_KEY,
  loadPreferences,
  savePreferences,
  type Preferences,
  type PreferencesStorage,
} from '../../src/storage/preferences';

const mixedPreferences: Preferences = Object.freeze({
  version: 1,
  music: false,
  soundEffects: true,
  reducedMotion: true,
  highContrast: false,
});

const canonicalMixedPayload =
  '{"version":1,"music":false,"soundEffects":true,"reducedMotion":true,"highContrast":false}';

describe('preferences storage contract', () => {
  it('uses the frozen defaults and exact versioned key for missing storage', () => {
    const getItem = vi.fn(() => null);

    const loaded = loadPreferences({ getItem, setItem: vi.fn() });

    expect(PREFERENCES_STORAGE_KEY).toBe('snakish.preferences.v1');
    expect(DEFAULT_PREFERENCES).toEqual({
      version: 1,
      music: true,
      soundEffects: true,
      reducedMotion: false,
      highContrast: false,
    });
    expect(Object.isFrozen(DEFAULT_PREFERENCES)).toBe(true);
    expect(loaded).toEqual(DEFAULT_PREFERENCES);
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(getItem).toHaveBeenCalledOnce();
    expect(getItem).toHaveBeenCalledWith('snakish.preferences.v1');
  });

  it.each([
    ['canonical order', canonicalMixedPayload],
    [
      'alternate order and legal whitespace',
      '{\r\n "highContrast" : false, "reducedMotion": true,\n"soundEffects" :true,"music":false, "version" : 1 }',
    ],
    [
      'escaped spellings of every required key',
      '{"ver\\u0073ion":1,"mu\\u0073ic":false,"sound\\u0045ffects":true,"reduced\\u004dotion":true,"high\\u0043ontrast":false}',
    ],
  ])('loads and freezes a valid payload in %s', (_label, serialized) => {
    const loaded = loadPreferences({
      getItem: () => serialized,
      setItem: vi.fn(),
    });

    expect(loaded).toEqual(mixedPreferences);
    expect(Object.isFrozen(loaded)).toBe(true);
  });

  it.each([
    ['malformed JSON', '{'],
    ['array', '[]'],
    ['null', 'null'],
    ['primitive', 'true'],
    [
      'wrong version',
      '{"version":2,"music":false,"soundEffects":true,"reducedMotion":true,"highContrast":false}',
    ],
    [
      'wrong version type',
      '{"version":"1","music":false,"soundEffects":true,"reducedMotion":true,"highContrast":false}',
    ],
    [
      'missing member',
      '{"version":1,"music":false,"soundEffects":true,"reducedMotion":true}',
    ],
    [
      'extra member',
      '{"version":1,"music":false,"soundEffects":true,"reducedMotion":true,"highContrast":false,"extra":true}',
    ],
    [
      'non-boolean music',
      '{"version":1,"music":0,"soundEffects":true,"reducedMotion":true,"highContrast":false}',
    ],
    [
      'non-boolean soundEffects',
      '{"version":1,"music":false,"soundEffects":null,"reducedMotion":true,"highContrast":false}',
    ],
    [
      'non-boolean reducedMotion',
      '{"version":1,"music":false,"soundEffects":true,"reducedMotion":"true","highContrast":false}',
    ],
    [
      'non-boolean highContrast',
      '{"version":1,"music":false,"soundEffects":true,"reducedMotion":true,"highContrast":{}}',
    ],
    [
      'own __proto__ member',
      '{"version":1,"music":false,"soundEffects":true,"reducedMotion":true,"highContrast":false,"__proto__":true}',
    ],
  ])('falls back atomically for %s', (_label, serialized) => {
    const loaded = loadPreferences({
      getItem: () => serialized,
      setItem: vi.fn(),
    });

    expect(loaded).toEqual(DEFAULT_PREFERENCES);
    expect(loaded).not.toMatchObject(mixedPreferences);
  });

  it.each([
    [
      'version',
      '{"version":2,"version":1,"music":false,"soundEffects":true,"reducedMotion":true,"highContrast":false}',
    ],
    [
      'music',
      '{"version":1,"music":true,"music":false,"soundEffects":true,"reducedMotion":true,"highContrast":false}',
    ],
    [
      'soundEffects',
      '{"version":1,"music":false,"soundEffects":false,"soundEffects":true,"reducedMotion":true,"highContrast":false}',
    ],
    [
      'reducedMotion',
      '{"version":1,"music":false,"soundEffects":true,"reducedMotion":false,"reducedMotion":true,"highContrast":false}',
    ],
    [
      'highContrast',
      '{"version":1,"music":false,"soundEffects":true,"reducedMotion":true,"highContrast":true,"highContrast":false}',
    ],
    [
      'escaped-equivalent names',
      '{"version":2,"ver\\u0073ion":1,"music":true,"mu\\u0073ic":false,"soundEffects":false,"sound\\u0045ffects":true,"reducedMotion":false,"reduced\\u004dotion":true,"highContrast":true,"high\\u0043ontrast":false}',
    ],
  ])(
    'rejects duplicate %s members before last-member-wins parsing',
    (_label, serialized) => {
      expect(
        loadPreferences({ getItem: () => serialized, setItem: vi.fn() }),
      ).toEqual(DEFAULT_PREFERENCES);
    },
  );

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
  ])('returns immutable defaults for %s', (_label, storage) => {
    expect(() =>
      loadPreferences(storage as PreferencesStorage | undefined),
    ).not.toThrow();
    expect(loadPreferences(storage as PreferencesStorage | undefined)).toEqual(
      DEFAULT_PREFERENCES,
    );
  });

  it('writes one complete canonical payload without reading or mutating input', () => {
    const getItem = vi.fn(() => '{"foreign":true}');
    const setItem = vi.fn();
    const before = { ...mixedPreferences };

    savePreferences(Object.freeze({ getItem, setItem }), mixedPreferences);

    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).toHaveBeenCalledOnce();
    expect(setItem).toHaveBeenCalledWith(
      PREFERENCES_STORAGE_KEY,
      canonicalMixedPayload,
    );
    expect(mixedPreferences).toEqual(before);
  });

  it.each([
    ['wrong version', { ...mixedPreferences, version: 2 }],
    ['missing member', { version: 1, music: false }],
    ['extra member', { ...mixedPreferences, extra: true }],
    ['wrong boolean type', { ...mixedPreferences, music: 'false' }],
    ['array', []],
    ['null', null],
  ])('does not partially write invalid %s input', (_label, preferences) => {
    const setItem = vi.fn();

    savePreferences(
      { getItem: vi.fn(), setItem },
      preferences as unknown as Preferences,
    );

    expect(setItem).not.toHaveBeenCalled();
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
  ])(
    'silently keeps the caller state for %s while saving',
    (_label, storage) => {
      const before = { ...mixedPreferences };

      expect(() =>
        savePreferences(
          storage as PreferencesStorage | undefined,
          mixedPreferences,
        ),
      ).not.toThrow();
      expect(mixedPreferences).toEqual(before);
    },
  );
});
