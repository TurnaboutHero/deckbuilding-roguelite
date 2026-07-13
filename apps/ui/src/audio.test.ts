// P5.2 사운드 — 음소거 영속·무음 폴백 (AudioContext 부재 환경에서 무예외)
import { beforeEach, describe, expect, it } from "vitest";

import { isMuted, playSfx, setMuted, sfxKinds } from "./audio";

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
  };
});

describe("audio (합성 SFX)", () => {
  it("기본은 음소거이고 토글이 저장된다", () => {
    expect(isMuted()).toBe(true);
    setMuted(false);
    expect(isMuted()).toBe(false);
    expect(storage.get("deckbuilding-roguelite.muted")).toBe("false");
    setMuted(true);
    expect(isMuted()).toBe(true);
    expect(storage.get("deckbuilding-roguelite.muted")).toBe("true");
  });

  it("음소거 상태에서는 AudioContext를 생성하지 않는다", () => {
    let constructed = 0;
    class FakeCtx {
      state = "running";
      currentTime = 0;
      constructor() { constructed += 1; }
      resume() { return Promise.resolve(); }
      createOscillator() { throw new Error("unused"); }
      createGain() { throw new Error("unused"); }
      destination = {};
    }
    (globalThis as { window?: { AudioContext?: unknown; localStorage: unknown } }).window = {
      AudioContext: FakeCtx,
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    };
    setMuted(true);
    playSfx("hit");
    playSfx("victory");
    expect(constructed).toBe(0);
  });

  it("AudioContext 부재 환경에서 playSfx가 무음 폴백한다 (무예외)", () => {
    setMuted(false);
    expect(sfxKinds.length).toBeGreaterThan(20);
    for (const kind of sfxKinds) expect(() => playSfx(kind)).not.toThrow();
    setMuted(true);
    expect(() => playSfx("flip-heads")).not.toThrow();
  });
});
