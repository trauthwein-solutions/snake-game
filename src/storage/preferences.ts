import { parseStrictJsonObject } from './strict-json-object';

export const PREFERENCES_STORAGE_KEY = 'snakish.preferences.v1';

export const MUSIC_STYLES = [
  'neonPulse',
  'pixelDrift',
  'minimalBeat',
  'chillGrid',
] as const;
export type MusicStyle = (typeof MUSIC_STYLES)[number];

export interface Preferences {
  readonly version: 2;
  readonly music: boolean;
  readonly musicStyle: MusicStyle;
  readonly soundEffects: boolean;
  readonly reducedMotion: boolean;
  readonly highContrast: boolean;
}

export interface PreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_PREFERENCES: Preferences = Object.freeze({
  version: 2,
  music: true,
  musicStyle: 'neonPulse',
  soundEffects: true,
  reducedMotion: false,
  highContrast: false,
});

const PREFERENCE_MEMBER_NAMES = [
  'version',
  'music',
  'musicStyle',
  'soundEffects',
  'reducedMotion',
  'highContrast',
] as const;

const V1_PREFERENCE_MEMBER_NAMES = [
  'version',
  'music',
  'soundEffects',
  'reducedMotion',
  'highContrast',
] as const;

const hasBooleanPreferences = (payload: Record<string, unknown>): boolean =>
  typeof payload.music === 'boolean' &&
  typeof payload.soundEffects === 'boolean' &&
  typeof payload.reducedMotion === 'boolean' &&
  typeof payload.highContrast === 'boolean';

export const isMusicStyle = (value: unknown): value is MusicStyle =>
  typeof value === 'string' &&
  (MUSIC_STYLES as readonly string[]).includes(value);

const isPreferences = (value: unknown): value is Preferences => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (
    keys.length !== PREFERENCE_MEMBER_NAMES.length ||
    PREFERENCE_MEMBER_NAMES.some((name) => !Object.hasOwn(value, name))
  ) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    payload.version === 2 &&
    isMusicStyle(payload.musicStyle) &&
    hasBooleanPreferences(payload)
  );
};

const migrateV1Preferences = (serialized: string): Preferences | undefined => {
  const payload = parseStrictJsonObject(serialized, V1_PREFERENCE_MEMBER_NAMES);
  if (
    payload === null ||
    payload.version !== 1 ||
    !hasBooleanPreferences(payload)
  ) {
    return undefined;
  }

  return Object.freeze({
    version: 2,
    music: payload.music as boolean,
    musicStyle: 'neonPulse',
    soundEffects: payload.soundEffects as boolean,
    reducedMotion: payload.reducedMotion as boolean,
    highContrast: payload.highContrast as boolean,
  });
};

export function loadPreferences(
  storage: PreferencesStorage | null | undefined,
): Preferences {
  try {
    const storedValue = storage?.getItem(PREFERENCES_STORAGE_KEY);
    if (storedValue === null || storedValue === undefined) {
      return DEFAULT_PREFERENCES;
    }

    const payload = parseStrictJsonObject(storedValue, PREFERENCE_MEMBER_NAMES);
    if (payload === null || !isPreferences(payload)) {
      return migrateV1Preferences(storedValue) ?? DEFAULT_PREFERENCES;
    }

    return Object.freeze({
      version: 2,
      music: payload.music,
      musicStyle: payload.musicStyle,
      soundEffects: payload.soundEffects,
      reducedMotion: payload.reducedMotion,
      highContrast: payload.highContrast,
    });
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(
  storage: PreferencesStorage | null | undefined,
  preferences: Preferences,
): void {
  try {
    if (!isPreferences(preferences)) {
      return;
    }
    storage?.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        music: preferences.music,
        musicStyle: preferences.musicStyle,
        soundEffects: preferences.soundEffects,
        reducedMotion: preferences.reducedMotion,
        highContrast: preferences.highContrast,
      }),
    );
  } catch {
    // Persistence is best-effort; the caller retains its in-memory settings.
  }
}
