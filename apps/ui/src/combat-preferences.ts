import {
  FLIP_SPEED_STORAGE_KEY,
  isFlipSpeed,
  loadFlipSpeed,
  saveFlipSpeed,
  type FlipSpeed,
} from "./flip-speed";

export type CombatSizePreference = "normal" | "large";
export type BackgroundEffectsPreference = "full" | "reduced";

export interface CombatPreferences {
  flipSpeed: FlipSpeed;
  autoExecuteLoadedSkills: boolean;
  screenShake: boolean;
  damageNumberSize: CombatSizePreference;
  tooltipSize: CombatSizePreference;
  highContrast: boolean;
  backgroundEffects: BackgroundEffectsPreference;
  reducedMotion: boolean;
  /** `true` means combat sound is enabled. */
  sound: boolean;
}

interface StoredCombatPreferences extends CombatPreferences {
  version: 1;
}

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export const COMBAT_PREFERENCES_STORAGE_KEY =
  "deckbuilding-roguelite.combat-preferences";
export const LEGACY_MUTE_STORAGE_KEY = "deckbuilding-roguelite.muted";

export const DEFAULT_COMBAT_PREFERENCES: CombatPreferences = {
  flipSpeed: "normal",
  // Manual activation stays the default. Players can opt in from the
  // contextual turn-end warning or the combat settings panel.
  autoExecuteLoadedSkills: false,
  screenShake: true,
  damageNumberSize: "normal",
  tooltipSize: "normal",
  highContrast: false,
  backgroundEffects: "full",
  reducedMotion: false,
  // Preserve the existing opt-in audio behavior.
  sound: false,
};

const sourceStorage = (
  storage?: PreferenceStorage,
): PreferenceStorage | undefined =>
  storage ??
  (typeof window === "undefined" ? undefined : window.localStorage);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sizePreference = (
  value: unknown,
  fallback: CombatSizePreference,
): CombatSizePreference =>
  value === "normal" || value === "large" ? value : fallback;

const backgroundEffectsPreference = (
  value: unknown,
  fallback: BackgroundEffectsPreference,
): BackgroundEffectsPreference =>
  value === "full" || value === "reduced" ? value : fallback;

const booleanPreference = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const legacySound = (storage?: PreferenceStorage): boolean => {
  try {
    const value = sourceStorage(storage)?.getItem(LEGACY_MUTE_STORAGE_KEY);
    if (value === "false") return true;
    if (value === "true") return false;
  } catch {
    // Fall through to the established sound-off default.
  }
  return DEFAULT_COMBAT_PREFERENCES.sound;
};

export const loadCombatPreferences = (
  storage?: PreferenceStorage,
): CombatPreferences => {
  const fallback: CombatPreferences = {
    ...DEFAULT_COMBAT_PREFERENCES,
    flipSpeed: loadFlipSpeed(storage),
    sound: legacySound(storage),
  };

  try {
    const raw = sourceStorage(storage)?.getItem(
      COMBAT_PREFERENCES_STORAGE_KEY,
    );
    if (raw === null || raw === undefined) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1) return fallback;

    return {
      flipSpeed: isFlipSpeed(parsed.flipSpeed)
        ? parsed.flipSpeed
        : fallback.flipSpeed,
      autoExecuteLoadedSkills: booleanPreference(
        parsed.autoExecuteLoadedSkills,
        fallback.autoExecuteLoadedSkills,
      ),
      screenShake: booleanPreference(
        parsed.screenShake,
        fallback.screenShake,
      ),
      damageNumberSize: sizePreference(
        parsed.damageNumberSize,
        fallback.damageNumberSize,
      ),
      tooltipSize: sizePreference(parsed.tooltipSize, fallback.tooltipSize),
      highContrast: booleanPreference(
        parsed.highContrast,
        fallback.highContrast,
      ),
      backgroundEffects: backgroundEffectsPreference(
        parsed.backgroundEffects,
        fallback.backgroundEffects,
      ),
      reducedMotion: booleanPreference(
        parsed.reducedMotion,
        fallback.reducedMotion,
      ),
      sound: booleanPreference(parsed.sound, fallback.sound),
    };
  } catch {
    return fallback;
  }
};

export const saveCombatPreferences = (
  preferences: CombatPreferences,
  storage?: PreferenceStorage,
): void => {
  const target = sourceStorage(storage);
  const payload: StoredCombatPreferences = { version: 1, ...preferences };
  try {
    target?.setItem(COMBAT_PREFERENCES_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // A storage failure must not prevent in-memory preference changes.
  }

  saveFlipSpeed(preferences.flipSpeed, storage);
  try {
    target?.setItem(LEGACY_MUTE_STORAGE_KEY, String(!preferences.sound));
  } catch {
    // Preserve the same failure-safe behavior as the legacy audio setting.
  }
};

// Exported for migration diagnostics and compatibility tests.
export { FLIP_SPEED_STORAGE_KEY };
