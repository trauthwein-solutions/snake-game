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
  version: 3,
  music: false,
  musicStyle: 'pixelDrift',
  soundEffects: true,
  reducedMotion: true,
  highContrast: false,
  wallMode: 'wrapAround',
});
const canonicalMixedPayload =
  '{"version":3,"music":false,"musicStyle":"pixelDrift","soundEffects":true,"reducedMotion":true,"highContrast":false,"wallMode":"wrapAround"}';
const exactV2Payload =
  '{"version":2,"music":false,"musicStyle":"pixelDrift","soundEffects":true,"reducedMotion":true,"highContrast":false}';
const exactV1Payload =
  '{"version":1,"music":false,"soundEffects":true,"reducedMotion":true,"highContrast":false}';

describe('preferences storage contract', () => {
  it('keeps the v1 key while defaulting to frozen canonical v3 preferences', () => {
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
      version: 3,
      music: true,
      musicStyle: 'neonPulse',
      soundEffects: true,
      reducedMotion: false,
      highContrast: false,
      wallMode: 'solid',
    });
    expect(Object.isFrozen(DEFAULT_PREFERENCES)).toBe(true);
    expect(loaded).toEqual(DEFAULT_PREFERENCES);
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(getItem).toHaveBeenCalledWith(PREFERENCES_STORAGE_KEY);
  });

  it.each([
    [
      'v1',
      exactV1Payload,
      { ...mixedPreferences, musicStyle: 'neonPulse', wallMode: 'solid' },
    ],
    ['v2', exactV2Payload, { ...mixedPreferences, wallMode: 'solid' }],
  ] as const)(
    'migrates exact %s preferences in memory without writing',
    (_version, serialized, expected) => {
      const setItem = vi.fn();
      const loaded = loadPreferences({ getItem: () => serialized, setItem });

      expect(loaded).toEqual(expected);
      expect(Object.isFrozen(loaded)).toBe(true);
      expect(setItem).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'v1',
      '{"music":false,"version":1,"soundEffects":true,"reducedMotion":true,"highContrast":false}',
      { ...mixedPreferences, musicStyle: 'neonPulse', wallMode: 'solid' },
    ],
    [
      'v2',
      '{"highContrast":false,"musicStyle":"pixelDrift","reducedMotion":true,"soundEffects":true,"music":false,"version":2}',
      { ...mixedPreferences, wallMode: 'solid' },
    ],
    [
      'v3',
      '{\r\n "wallMode":"wrapAround","highContrast":false,"musicStyle":"pixelDrift", "reducedMotion":true,\n"soundEffects":true,"music":false,"version":3}',
      mixedPreferences,
    ],
  ] as const)(
    'accepts exact %s members in alternate order',
    (_version, serialized, expected) => {
      expect(
        loadPreferences({ getItem: () => serialized, setItem: vi.fn() }),
      ).toEqual(expected);
    },
  );

  it.each(MUSIC_STYLES)('roundtrips canonical v3 style %s', (musicStyle) => {
    const preferences = { ...mixedPreferences, musicStyle };
    const storageValue = JSON.stringify(preferences);
    const setItem = vi.fn();

    expect(loadPreferences({ getItem: () => storageValue, setItem })).toEqual(
      preferences,
    );
    savePreferences({ getItem: vi.fn(), setItem }, preferences);
    expect(setItem).toHaveBeenCalledWith(PREFERENCES_STORAGE_KEY, storageValue);
  });

  it.each(['solid', 'wrapAround'] as const)(
    'roundtrips canonical v3 wall mode %s',
    (wallMode) => {
      const preferences = { ...mixedPreferences, wallMode };
      const serialized = JSON.stringify(preferences);
      const setItem = vi.fn();

      expect(loadPreferences({ getItem: () => serialized, setItem })).toEqual(
        preferences,
      );
      savePreferences({ getItem: vi.fn(), setItem }, preferences);
      expect(setItem).toHaveBeenCalledWith(PREFERENCES_STORAGE_KEY, serialized);
    },
  );

  it.each([
    ['malformed JSON', '{'],
    ['array', '[]'],
    ['null', 'null'],
    ['primitive', 'true'],
    [
      'v1 partial',
      '{"version":1,"music":false,"soundEffects":true,"reducedMotion":true}',
    ],
    [
      'v1 extra',
      '{"version":1,"music":false,"soundEffects":true,"reducedMotion":true,"highContrast":false,"extra":true}',
    ],
    [
      'v2 partial',
      '{"version":2,"music":false,"musicStyle":"pixelDrift","soundEffects":true,"reducedMotion":true}',
    ],
    [
      'v2 extra',
      '{"version":2,"music":false,"musicStyle":"pixelDrift","soundEffects":true,"reducedMotion":true,"highContrast":false,"wallMode":"solid"}',
    ],
    [
      'v3 partial',
      '{"version":3,"music":false,"musicStyle":"pixelDrift","soundEffects":true,"reducedMotion":true,"highContrast":false}',
    ],
    [
      'v3 extra',
      '{"version":3,"music":false,"musicStyle":"pixelDrift","soundEffects":true,"reducedMotion":true,"highContrast":false,"wallMode":"solid","extra":true}',
    ],
    [
      'invalid version',
      '{"version":4,"music":false,"musicStyle":"pixelDrift","soundEffects":true,"reducedMotion":true,"highContrast":false,"wallMode":"solid"}',
    ],
    [
      'unknown style',
      '{"version":3,"music":false,"musicStyle":"ambient","soundEffects":true,"reducedMotion":true,"highContrast":false,"wallMode":"solid"}',
    ],
    [
      'unknown wall mode',
      '{"version":3,"music":false,"musicStyle":"pixelDrift","soundEffects":true,"reducedMotion":true,"highContrast":false,"wallMode":"portal"}',
    ],
    [
      'wrong boolean type',
      '{"version":3,"music":0,"musicStyle":"pixelDrift","soundEffects":true,"reducedMotion":true,"highContrast":false,"wallMode":"solid"}',
    ],
  ])('falls back atomically for %s', (_label, serialized) => {
    expect(
      loadPreferences({ getItem: () => serialized, setItem: vi.fn() }),
    ).toEqual(DEFAULT_PREFERENCES);
  });

  it.each([
    [
      'v3 version',
      '{"version":2,"version":3,"music":false,"musicStyle":"pixelDrift","soundEffects":true,"reducedMotion":true,"highContrast":false,"wallMode":"solid"}',
    ],
    [
      'v3 wallMode',
      '{"version":3,"music":false,"musicStyle":"pixelDrift","soundEffects":true,"reducedMotion":true,"highContrast":false,"wallMode":"solid","wallMode":"wrapAround"}',
    ],
    [
      'v3 escaped wallMode',
      '{"version":3,"music":false,"musicStyle":"pixelDrift","soundEffects":true,"reducedMotion":true,"highContrast":false,"wallMode":"solid","wall\\u004dode":"wrapAround"}',
    ],
    [
      'v2 escaped musicStyle',
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
  ])('returns usable defaults for %s', (_label, storage) => {
    expect(() =>
      loadPreferences(storage as PreferencesStorage | undefined),
    ).not.toThrow();
    expect(loadPreferences(storage as PreferencesStorage | undefined)).toEqual(
      DEFAULT_PREFERENCES,
    );
  });

  it('writes one exact canonical v3 payload without reading or mutation', () => {
    const getItem = vi.fn(() => exactV2Payload);
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

  it.each([
    ['v1', exactV1Payload],
    ['v2', exactV2Payload],
  ] as const)(
    'repairs migrated %s data with canonical v3 on the next actual change',
    (_version, serialized) => {
      const setItem = vi.fn();
      const storage = { getItem: () => serialized, setItem };
      const migrated = loadPreferences(storage);

      savePreferences(storage, { ...migrated, wallMode: 'wrapAround' });

      expect(setItem).toHaveBeenCalledOnce();
      expect(setItem).toHaveBeenCalledWith(
        PREFERENCES_STORAGE_KEY,
        expect.stringMatching(/^\{"version":3,.*"wallMode":"wrapAround"\}$/),
      );
    },
  );

  it.each([
    ['wrong version', { ...mixedPreferences, version: 2 }],
    ['unknown style', { ...mixedPreferences, musicStyle: 'ambient' }],
    ['unknown wall mode', { ...mixedPreferences, wallMode: 'portal' }],
    ['missing member', { version: 3, music: false }],
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
