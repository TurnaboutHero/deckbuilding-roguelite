import { describe, expect, it } from "vitest";

import {
  FLIP_SPEED_STORAGE_KEY,
  flipTiming,
  loadFlipSpeed,
  saveFlipSpeed,
} from "./flip-speed";

const memoryStorage = (initial?: string) => {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(FLIP_SPEED_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
};

describe("flip speed", () => {
  it("기본·빠르게·즉시의 플립 시간을 명확히 구분한다", () => {
    expect(flipTiming("normal")).toMatchObject({
      animate: true,
      animationMs: 600,
      queueDelayMs: 900,
    });
    expect(flipTiming("fast")).toMatchObject({
      animate: true,
      animationMs: 240,
      queueDelayMs: 340,
    });
    expect(flipTiming("instant")).toEqual({
      animate: false,
      animationMs: 0,
      queueDelayMs: 0,
      revealVfxMs: 0,
      resolveHoldMs: 0,
    });
  });

  it("모션 감소 환경은 선택 모드와 관계없이 즉시 처리한다", () => {
    expect(flipTiming("normal", true)).toEqual(flipTiming("instant"));
    expect(flipTiming("fast", true)).toEqual(flipTiming("instant"));
  });

  it("유효한 설정은 저장하고 손상된 값은 기본값으로 복구한다", () => {
    const storage = memoryStorage();
    saveFlipSpeed("fast", storage);
    expect(loadFlipSpeed(storage)).toBe("fast");
    expect(loadFlipSpeed(memoryStorage("unknown"))).toBe("normal");
  });
});
