import { CONTENT_VERSION, contentDb } from "@game/content";
import {
  RUN_SAVE_VERSION,
  createRun,
  settleRunCombat,
  startRunCombat,
  type RunSave,
} from "@game/core";
import { describe, expect, it } from "vitest";

import { parseRunSave, serializeRunSave } from "./run-storage";

const eventLayerChoice = (save: RunSave): { layer: number; choice: number } => {
  for (let layer = 0; layer < save.graph.layers.length; layer += 1) {
    const choice = (save.graph.layers[layer] ?? []).findIndex(
      (node) => node.kind === "event",
    );
    if (choice >= 0) return { layer, choice };
  }
  throw new Error("run graph must contain an event node");
};

const baseSave = (seed: string): RunSave =>
  createRun(
    { contentVersion: CONTENT_VERSION, runSeed: seed, character: "warrior" as never },
    contentDb,
  );

const saveAtFirstEvent = (seed: string): RunSave => {
  const save = baseSave(seed);
  const { layer, choice } = eventLayerChoice(save);
  return {
    ...save,
    currentHp: save.maxHp,
    gold: 70,
    combatIndex: layer,
    nodeChoices: save.nodeChoices.map((nodeChoice, index) =>
      index === layer ? choice : nodeChoice,
    ),
  };
};

const parse = (save: unknown) =>
  parseRunSave(JSON.stringify(save), CONTENT_VERSION, contentDb);

describe("P4.4 verification worker - run storage v5", () => {
  it("round-trips an ambush pendingEventCombat save and resumes into the elite reward contract", () => {
    const save = {
      ...saveAtFirstEvent("P44-WORKER-2"),
      phase: "ready" as const,
      pendingEventCombat: { eventId: "ambush-bounty" as never },
    };

    const parsed = parseRunSave(
      serializeRunSave(save, contentDb),
      CONTENT_VERSION,
      contentDb,
    );
    expect(parsed?.pendingEventCombat?.eventId).toBe("ambush-bounty");

    const started = startRunCombat(parsed!, contentDb);
    const settled = settleRunCombat(
      started.run,
      {
        ...started.combat,
        phase: "victory",
        enemies: started.combat.enemies.map((enemy) => ({ ...enemy, hp: 0 })),
      },
      contentDb,
    );

    expect(settled.gold).toBe(save.gold + 70);
    expect(settled.eventCombats).toBe(1);
    expect(settled.pendingRewards?.skillOptions.length).toBeGreaterThan(0);
    for (const skill of settled.pendingRewards?.skillOptions ?? []) {
      expect(contentDb.skills[String(skill)]?.rarity).toBe("rare");
    }
  });

  it("rejects a forged first-event transmute that keeps the gold cost unpaid", () => {
    const save = saveAtFirstEvent("P44-WORKER-0");
    const firstBasic = save.bag.findIndex((coin) => String(coin) === "basic");
    const bag = [...save.bag];
    bag[firstBasic] = "fire" as never;
    const forged = {
      ...save,
      version: RUN_SAVE_VERSION,
      phase: "ready" as const,
      combatIndex: save.combatIndex + 1,
      bag,
      gold: 70,
      eventCoinGains: 1,
      eventCoinLosses: 1,
    };

    expect(parse(forged)).toBeNull();
  });
});
