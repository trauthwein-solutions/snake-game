import { parseStrictJsonObject } from './strict-json-object';

export const PREFERENCES_STORAGE_KEY = 'snakish.preferences.v1';

export interface Preferences {
  readonly version: 1;
  readonly music: boolean;
  readonly soundEffects: boolean;
  readonly reducedMotion: boolean;
  readonly highContrast: boolean;
}

export interface PreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_PREFERENCES: Preferences = Object.freeze({
  version: 1,
  music: true,
  soundEffects: true,
  reducedMotion: false,
  highContrast: false,
});

const PREFERENCE_MEMBER_NAMES = [
  'version',
  'music',
  'soundEffects',
  'reducedMotion',
  'highContrast',
] as const;

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
    payload.version === 1 &&
    typeof payload.music === 'boolean' &&
    typeof payload.soundEffects === 'boolean' &&
    typeof payload.reducedMotion === 'boolean' &&
    typeof payload.highContrast === 'boolean'
  );
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
      return DEFAULT_PREFERENCES;
    }

    return Object.freeze({
      version: 1,
      music: payload.music,
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
        version: 1,
        music: preferences.music,
        soundEffects: preferences.soundEffects,
        reducedMotion: preferences.reducedMotion,
        highContrast: preferences.highContrast,
      }),
    );
  } catch {
    // Persistence is best-effort; the caller retains its in-memory settings.
  }
}
