import { isWallMode, type WallMode } from '../engine/model';
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
  readonly version: 3;
  readonly music: boolean;
  readonly musicStyle: MusicStyle;
  readonly soundEffects: boolean;
  readonly reducedMotion: boolean;
  readonly highContrast: boolean;
  readonly wallMode: WallMode;
}

export interface PreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_PREFERENCES: Preferences = Object.freeze({
  version: 3,
  music: true,
  musicStyle: 'neonPulse',
  soundEffects: true,
  reducedMotion: false,
  highContrast: false,
  wallMode: 'solid',
});

const V3_PREFERENCE_MEMBER_NAMES = [
  'version',
  'music',
  'musicStyle',
  'soundEffects',
  'reducedMotion',
  'highContrast',
  'wallMode',
] as const;

const V2_PREFERENCE_MEMBER_NAMES = [
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

const hasBooleanPreferences = (
  payload: Record<string, unknown>,
): payload is Record<string, unknown> &
  Pick<
    Preferences,
    'music' | 'soundEffects' | 'reducedMotion' | 'highContrast'
  > =>
  typeof payload.music === 'boolean' &&
  typeof payload.soundEffects === 'boolean' &&
  typeof payload.reducedMotion === 'boolean' &&
  typeof payload.highContrast === 'boolean';

export const isMusicStyle = (value: unknown): value is MusicStyle =>
  typeof value === 'string' &&
  (MUSIC_STYLES as readonly string[]).includes(value);

const hasExactMembers = (
  value: Record<string, unknown>,
  memberNames: readonly string[],
): boolean => {
  const keys = Object.keys(value);
  return (
    keys.length === memberNames.length &&
    memberNames.every((name) => Object.hasOwn(value, name))
  );
};

const isPreferences = (value: unknown): value is Preferences => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    hasExactMembers(payload, V3_PREFERENCE_MEMBER_NAMES) &&
    payload.version === 3 &&
    isMusicStyle(payload.musicStyle) &&
    isWallMode(payload.wallMode) &&
    hasBooleanPreferences(payload)
  );
};

const freezePreferences = (
  payload: Omit<Preferences, 'version'>,
): Preferences =>
  Object.freeze({
    version: 3,
    music: payload.music,
    musicStyle: payload.musicStyle,
    soundEffects: payload.soundEffects,
    reducedMotion: payload.reducedMotion,
    highContrast: payload.highContrast,
    wallMode: payload.wallMode,
  });

const loadV3Preferences = (serialized: string): Preferences | undefined => {
  const payload = parseStrictJsonObject(serialized, V3_PREFERENCE_MEMBER_NAMES);
  if (payload === null || !isPreferences(payload)) {
    return undefined;
  }

  return freezePreferences(payload);
};

const migrateV2Preferences = (serialized: string): Preferences | undefined => {
  const payload = parseStrictJsonObject(serialized, V2_PREFERENCE_MEMBER_NAMES);
  if (
    payload === null ||
    payload.version !== 2 ||
    !isMusicStyle(payload.musicStyle) ||
    !hasBooleanPreferences(payload)
  ) {
    return undefined;
  }

  return freezePreferences({
    music: payload.music,
    musicStyle: payload.musicStyle,
    soundEffects: payload.soundEffects,
    reducedMotion: payload.reducedMotion,
    highContrast: payload.highContrast,
    wallMode: 'solid',
  });
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

  return freezePreferences({
    music: payload.music,
    musicStyle: 'neonPulse',
    soundEffects: payload.soundEffects,
    reducedMotion: payload.reducedMotion,
    highContrast: payload.highContrast,
    wallMode: 'solid',
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

    return (
      loadV3Preferences(storedValue) ??
      migrateV2Preferences(storedValue) ??
      migrateV1Preferences(storedValue) ??
      DEFAULT_PREFERENCES
    );
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
        version: 3,
        music: preferences.music,
        musicStyle: preferences.musicStyle,
        soundEffects: preferences.soundEffects,
        reducedMotion: preferences.reducedMotion,
        highContrast: preferences.highContrast,
        wallMode: preferences.wallMode,
      }),
    );
  } catch {
    // Persistence is best-effort; the caller retains its in-memory settings.
  }
}
