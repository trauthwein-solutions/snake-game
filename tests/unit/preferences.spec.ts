import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_PREFERENCES,
  MUSIC_STYLES,
  PREFERENCES_STORAGE_KEY,
  loadPreferences,
  savePreferences,
  type Preferences,
  type PreferencesStorage,
} from '../../src/storage/preferences';

const mixedPreferences: Preferences = Object.freeze({
  version: 2,
  music: false,
  musicStyle: 'pixelDrift',
  soundEffects: true,
  reducedMotion: true,
  highContrast: false,
});
const canonicalMixedPayload =
  '{"version":2,"music":false,"musicStyle":"pixelDrift","soundEffects":true,"reducedMotion":true,"highContrast":false}';
const exactV1Payload =
  '{"version":1,"music":false,"soundEffects":true,"reducedMotion":true,"highContrast":false}';

describe('preferences storage contract', () => {
  it('keeps the v1 key while defaulting to frozen Neon Pulse v2 preferences', () => {
    const getItem = vi.fn(() => null);
    const loaded = loadPreferences({ getItem, setItem: vi.fn() });

    expect(PREFERENCES_STORAGE_KEY).toBe('snakish.preferences.v1');
    expect(MUSIC_STYLES).toEqual([
      'neonPulse',
      'pixelDrift',
      'minimalBeat',
      'chillGrid',
    ]);
    expect(DEFAULT_PREFERENCES).toEqual({
      version: 2,
      music: true,
      musicStyle: 'neonPulse',
      soundEffects: true,
      reducedMotion: false,
      highContrast: false,
    });
    expect(Object.isFrozen(DEFAULT_PREFERENCES)).toBe(true);
    expect(loaded).toEqual(DEFAULT_PREFERENCES);
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(getItem).toHaveBeenCalledWith(PREFERENCES_STORAGE_KEY);
  });

  it('migrates the exact current v1 payload in memory without writing', () => {
    const setItem = vi.fn();
    const loaded = loadPreferences({ getItem: () => exactV1Payload, setItem });

    expect(loaded).toEqual({ ...mixedPreferences, musicStyle: 'neonPulse' });
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('migrates the exact v1 schema in alternate member order', () => {
    expect(
      loadPreferences({
        getItem: () =>
          '{"music":false,"version":1,"soundEffects":true,"reducedMotion":true,"highContrast":false}',
        setItem: vi.fn(),
      }),
    ).toEqual({ ...mixedPreferences, musicStyle: 'neonPulse' });
  });

  it.each(MUSIC_STYLES)(
    'strictly loads canonical v2 style %s',
    (musicStyle) => {
      const serialized = JSON.stringify({
        version: 2,
        music: false,
        musicStyle,
        soundEffects: true,
        reducedMotion: true,
        highContrast: false,
      });
      expect(
        loadPreferences({ getItem: () => serialized, setItem: vi.fn() }),
      ).toEqual({ ...mixedPreferences, musicStyle });
    },
  );

  it('accepts canonical v2 members in alternate order with legal whitespace', () => {
    const loaded = loadPreferences({
      getItem: () =>
        '{\r\n "highContrast":false,"musicStyle":"pixelDrift", "reducedMotion":true,\n"soundEffects":true,"music":false,"version":2}',
      setItem: vi.fn(),
    });
    expect(loaded).toEqual(mixedPreferences);
  });

  it.each([
    ['malformed JSON', '{'],
    ['array', '[]'],
    ['null', 'null'],
    ['primitive', 'true'],
    [
      'v1 extra member',
      '{"version":1,"music":false,"soundEffects":true,"reducedMotion":true,"highContrast":false,"extra":true}',
    ],
    [
      'unknown style',
      '{"version":2,"music":false,"musicStyle":"ambient","soundEffects":true,"reducedMotion":true,"highContrast":false}',
    ],
    [
      'missing style',
      '{"version":2,"music":false,"soundEffects":true,"reducedMotion":true,"highContrast":false}',
    ],
    [
      'extra v2 member',
      '{"version":2,"music":false,"musicStyle":"pixelDrift","soundEffects":true,"reducedMotion":true,"highContrast":false,"extra":true}',
    ],
    [
      'wrong boolean type',
      '{"version":2,"music":0,"musicStyle":"pixelDrift","soundEffects":true,"reducedMotion":true,"highContrast":false}',
    ],
  ])('falls back atomically for %s', (_label, serialized) => {
    expect(
      loadPreferences({ getItem: () => serialized, setItem: vi.fn() }),
    ).toEqual(DEFAULT_PREFERENCES);
  });

  it.each([
    [
      'version',
      '{"version":1,"version":2,"music":false,"musicStyle":"pixelDrift","soundEffects":true,"reducedMotion":true,"highContrast":false}',
    ],
    [
      'musicStyle',
      '{"version":2,"music":false,"musicStyle":"neonPulse","musicStyle":"pixelDrift","soundEffects":true,"reducedMotion":true,"highContrast":false}',
    ],
    [
      'escaped musicStyle',
      '{"version":2,"music":false,"musicStyle":"neonPulse","music\\u0053tyle":"pixelDrift","soundEffects":true,"reducedMotion":true,"highContrast":false}',
    ],
    [
      'v1 music',
      '{"version":1,"music":true,"music":false,"soundEffects":true,"reducedMotion":true,"highContrast":false}',
    ],
  ])('rejects duplicate %s members', (_label, serialized) => {
    expect(
      loadPreferences({ getItem: () => serialized, setItem: vi.fn() }),
    ).toEqual(DEFAULT_PREFERENCES);
  });

  it.each([
    ['absent storage', undefined],
    [
      'throwing getItem',
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
  ])('returns defaults for %s', (_label, storage) => {
    expect(() =>
      loadPreferences(storage as PreferencesStorage | undefined),
    ).not.toThrow();
    expect(loadPreferences(storage as PreferencesStorage | undefined)).toEqual(
      DEFAULT_PREFERENCES,
    );
  });

  it('writes one exact canonical v2 payload without reading or mutation', () => {
    const getItem = vi.fn(() => exactV1Payload);
    const setItem = vi.fn();
    const before = { ...mixedPreferences };
    savePreferences({ getItem, setItem }, mixedPreferences);

    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).toHaveBeenCalledOnce();
    expect(setItem).toHaveBeenCalledWith(
      PREFERENCES_STORAGE_KEY,
      canonicalMixedPayload,
    );
    expect(mixedPreferences).toEqual(before);
  });

  it('repairs migrated v1 data with one canonical v2 save after the first change', () => {
    const setItem = vi.fn();
    const storage = { getItem: () => exactV1Payload, setItem };
    const migrated = loadPreferences(storage);

    savePreferences(storage, { ...migrated, musicStyle: 'minimalBeat' });

    expect(setItem).toHaveBeenCalledOnce();
    expect(setItem).toHaveBeenCalledWith(
      PREFERENCES_STORAGE_KEY,
      '{"version":2,"music":false,"musicStyle":"minimalBeat","soundEffects":true,"reducedMotion":true,"highContrast":false}',
    );
  });

  it.each([
    ['wrong version', { ...mixedPreferences, version: 1 }],
    ['unknown style', { ...mixedPreferences, musicStyle: 'ambient' }],
    ['missing member', { version: 2, music: false }],
    ['extra member', { ...mixedPreferences, extra: true }],
    ['wrong boolean', { ...mixedPreferences, music: 'false' }],
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
      'throwing setItem',
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
  ])('silently retains caller state while saving to %s', (_label, storage) => {
    expect(() =>
      savePreferences(
        storage as PreferencesStorage | undefined,
        mixedPreferences,
      ),
    ).not.toThrow();
  });
});
