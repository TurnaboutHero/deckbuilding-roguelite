// P5.4 저장 복구 계약 — 이중 쓰기·상태 판별·백업 복구·격리 (조용한 삭제 금지)
import { CONTENT_VERSION, contentDb } from "@game/content";
import { RUN_SAVE_VERSION, createRun } from "@game/core";
import { describe, expect, it } from "vitest";

import {
  RUN_SAVE_BACKUP_KEY,
  RUN_SAVE_KEY,
  RUN_SAVE_QUARANTINE_KEY,
  clearRun,
  loadRunDetailed,
  saveRun,
  serializeRunSave,
  type StorageLike,
} from "./run-storage";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  failWrites = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("quota");
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const freshSave = () =>
  createRun(
    { contentVersion: CONTENT_VERSION, runSeed: "P54-RECOVERY", character: "warrior" as never },
    contentDb,
  );

describe("P5.4 저장 복구 계약", () => {
  it("saveRun은 주+백업 이중 쓰기하고 성공 여부를 반환한다", () => {
    const storage = new MemoryStorage();
    expect(saveRun(storage, freshSave(), contentDb)).toBe(true);
    expect(storage.values.get(RUN_SAVE_KEY)).toBeDefined();
    expect(storage.values.get(RUN_SAVE_BACKUP_KEY)).toBe(
      storage.values.get(RUN_SAVE_KEY),
    );
    storage.failWrites = true;
    expect(saveRun(storage, freshSave(), contentDb)).toBe(false);
  });

  it("상태 판별: missing / loaded / unavailable", () => {
    const storage = new MemoryStorage();
    expect(loadRunDetailed(storage, CONTENT_VERSION, contentDb).status).toBe(
      "missing",
    );
    saveRun(storage, freshSave(), contentDb);
    expect(loadRunDetailed(storage, CONTENT_VERSION, contentDb).status).toBe(
      "loaded",
    );
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(loadRunDetailed(broken, CONTENT_VERSION, contentDb).status).toBe(
      "unavailable",
    );
  });

  it("주 손상 → 백업 복구(recovered), 손상 원문은 격리된다", () => {
    const storage = new MemoryStorage();
    saveRun(storage, freshSave(), contentDb);
    storage.values.set(RUN_SAVE_KEY, "{corrupted");
    const result = loadRunDetailed(storage, CONTENT_VERSION, contentDb);
    expect(result.status).toBe("recovered");
    expect(result.save).not.toBeNull();
    expect(storage.values.get(RUN_SAVE_QUARANTINE_KEY)).toBe("{corrupted");
    // 주 키가 백업 값으로 복원됨
    expect(storage.values.get(RUN_SAVE_KEY)).toBe(
      storage.values.get(RUN_SAVE_BACKUP_KEY),
    );
  });

  it("주·백업 모두 무효 → corrupt + 격리, 주 키는 지우지 않는다", () => {
    const storage = new MemoryStorage();
    storage.values.set(RUN_SAVE_KEY, "{corrupted");
    storage.values.set(RUN_SAVE_BACKUP_KEY, "also-broken");
    const result = loadRunDetailed(storage, CONTENT_VERSION, contentDb);
    expect(result.status).toBe("corrupt");
    expect(result.save).toBeNull();
    expect(storage.values.get(RUN_SAVE_QUARANTINE_KEY)).toBe("{corrupted");
    expect(storage.values.get(RUN_SAVE_KEY)).toBe("{corrupted");
  });

  it("미지 콘텐츠 버전은 unsupported로 판별한다 (미래 스키마와 별개)", () => {
    const storage = new MemoryStorage();
    const alien = JSON.stringify({
      ...JSON.parse(serializeRunSave(freshSave(), contentDb)),
      contentVersion: "9.9.9-unknown-era",
    });
    storage.values.set(RUN_SAVE_KEY, alien);
    expect(loadRunDetailed(storage, CONTENT_VERSION, contentDb).status).toBe(
      "unsupported",
    );
  });

  it("미래 버전은 unsupported로 판별한다", () => {
    const storage = new MemoryStorage();
    const future = JSON.stringify({
      ...JSON.parse(serializeRunSave(freshSave(), contentDb)),
      version: RUN_SAVE_VERSION + 1,
    });
    storage.values.set(RUN_SAVE_KEY, future);
    expect(loadRunDetailed(storage, CONTENT_VERSION, contentDb).status).toBe(
      "unsupported",
    );
    expect(storage.values.get(RUN_SAVE_QUARANTINE_KEY)).toBe(future);
  });

  it("retired guardian 저장은 retired-character로 판별하고 원문을 격리한다", () => {
    const storage = new MemoryStorage();
    const retired = JSON.stringify({
      ...JSON.parse(serializeRunSave(freshSave(), contentDb)),
      version: 8,
      contentVersion: "1.6.0-blood",
      character: "guardian",
      maxHp: 70,
      currentHp: 70,
      bag: ["basic", "basic", "basic", "basic", "basic", "basic", "basic", "basic", "mana", "mana"],
      equippedSkills: ["slash", "guard", "warding-strike", "mana-bulwark", null, null, null, null],
    });
    storage.values.set(RUN_SAVE_KEY, retired);
    const result = loadRunDetailed(storage, CONTENT_VERSION, contentDb);
    expect(result.status).toBe("retired-character");
    expect(result.save).toBeNull();
    expect(storage.values.get(RUN_SAVE_QUARANTINE_KEY)).toBe(retired);
  });

  it("clearRun은 주+백업을 정리하되 격리 원문은 보존한다", () => {
    const storage = new MemoryStorage();
    saveRun(storage, freshSave(), contentDb);
    storage.values.set(RUN_SAVE_QUARANTINE_KEY, "evidence");
    clearRun(storage);
    expect(storage.values.get(RUN_SAVE_KEY)).toBeUndefined();
    expect(storage.values.get(RUN_SAVE_BACKUP_KEY)).toBeUndefined();
    expect(storage.values.get(RUN_SAVE_QUARANTINE_KEY)).toBe("evidence");
  });
});
