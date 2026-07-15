import { describe, expect, it } from "vitest";

import {
  COMBAT_PREFERENCES_STORAGE_KEY,
  DEFAULT_COMBAT_PREFERENCES,
  loadCombatPreferences,
  saveCombatPreferences,
} from "./combat-preferences";
import { FLIP_SPEED_STORAGE_KEY } from "./flip-speed";

const LEGACY_MUTE_KEY = "deckbuilding-roguelite.muted";

const memoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
};

describe("combat preferences", () => {
  it("uses art-direction-compatible defaults when nothing has been saved", () => {
    expect(loadCombatPreferences(memoryStorage())).toEqual(DEFAULT_COMBAT_PREFERENCES);
  });

  it("migrates the legacy flip-speed and mute keys", () => {
    expect(
      loadCombatPreferences(
        memoryStorage({
          [FLIP_SPEED_STORAGE_KEY]: "fast",
          [LEGACY_MUTE_KEY]: "false",
        }),
      ),
    ).toEqual({
      ...DEFAULT_COMBAT_PREFERENCES,
      flipSpeed: "fast",
      sound: true,
    });
  });

  it("repairs malformed or partial unified data one property at a time", () => {
    const storage = memoryStorage({
      [COMBAT_PREFERENCES_STORAGE_KEY]: JSON.stringify({
        version: 1,
        flipSpeed: "warp",
        autoExecuteLoadedSkills: true,
        screenShake: false,
        damageNumberSize: "large",
        tooltipSize: 8,
        highContrast: true,
        backgroundEffects: "reduced",
        reducedMotion: true,
        sound: "yes",
      }),
      [FLIP_SPEED_STORAGE_KEY]: "instant",
      [LEGACY_MUTE_KEY]: "true",
    });

    expect(loadCombatPreferences(storage)).toEqual({
      flipSpeed: "instant",
      autoExecuteLoadedSkills: true,
      screenShake: false,
      damageNumberSize: "large",
      tooltipSize: "normal",
      highContrast: true,
      backgroundEffects: "reduced",
      reducedMotion: true,
      sound: false,
    });
  });

  it("persists the unified schema and keeps legacy readers synchronized", () => {
    const storage = memoryStorage();
    const preferences = {
      ...DEFAULT_COMBAT_PREFERENCES,
      flipSpeed: "fast" as const,
      sound: true,
      highContrast: true,
    };

    saveCombatPreferences(preferences, storage);

    expect(JSON.parse(storage.values.get(COMBAT_PREFERENCES_STORAGE_KEY) ?? "null")).toEqual({
      version: 1,
      ...preferences,
    });
    expect(storage.values.get(FLIP_SPEED_STORAGE_KEY)).toBe("fast");
    expect(storage.values.get(LEGACY_MUTE_KEY)).toBe("false");
    expect(loadCombatPreferences(storage)).toEqual(preferences);
  });

  it("fails closed to defaults when storage access throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };

    expect(loadCombatPreferences(broken)).toEqual(DEFAULT_COMBAT_PREFERENCES);
    expect(() => saveCombatPreferences(DEFAULT_COMBAT_PREFERENCES, broken)).not.toThrow();
  });
});
