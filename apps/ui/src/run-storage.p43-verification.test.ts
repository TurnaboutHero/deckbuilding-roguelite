import { CONTENT_VERSION, contentDb } from "@game/content";
import { RUN_SAVE_VERSION, completedCombatCount, type RunSave } from "@game/core";
import { describe, expect, it } from "vitest";

import { parseRunSave } from "./run-storage";

const combatNode = (id: string, encounter: string[]) => ({
  id,
  kind: "combat" as const,
  encounter: encounter as never,
});

const shopNode = (id: string) => ({ id, kind: "shop" as const });

const victoryViaShopsSave = (): RunSave => ({
  version: RUN_SAVE_VERSION,
  contentVersion: CONTENT_VERSION,
  runSeed: "P43-STORAGE-VERIFY",
  character: "warrior" as never,
  currentHp: 1,
  maxHp: 70,
  bag: [...contentDb.characters.warrior!.startingBag] as never,
  equippedSkills: [
    "flame-sword",
    "heart-of-flame",
    "conflagration",
    "smash",
    "fire-infusion",
    "furnace",
  ] as never,
  gold: 0,
  graph: {
    layers: [
      [combatNode("combat-1", ["raider"])],
      [combatNode("combat-2", ["goblin", "ghoul"])],
      [shopNode("shop-3")],
      [combatNode("combat-4", ["goblin", "ghoul"])],
      [{ id: "elite-5", kind: "elite", encounter: ["raider-plus"] as never }],
      [shopNode("shop-6")],
      [combatNode("combat-7", ["ghoul", "goblin", "slime"])],
      [combatNode("combat-8", ["thief", "goblin"])],
      [shopNode("shop-9")],
      [{ id: "boss-10", kind: "boss", encounter: ["ember-archmage"] as never }],
    ],
  },
  nodeChoices: Array.from({ length: 10 }, () => 0),
  shopRemovals: 0,
  shopPurchasedCoins: 0,
  shopPurchasedSkills: 0,
  combatIndex: 9,
  attempt: 0,
  phase: "victory",
});

describe("P4.3 run save verification", () => {
  it("rejects a boss-victory save whose skill replacements count the final combat as a reward source", () => {
    const save = victoryViaShopsSave();

    expect(completedCombatCount(save)).toBe(7);
    expect(save.shopPurchasedSkills).toBe(0);
    expect(
      save.equippedSkills.filter(
        (skill, index) =>
          skill !== contentDb.characters.warrior!.startingSkills[index],
      ),
    ).toHaveLength(6);
    expect(parseRunSave(JSON.stringify(save), CONTENT_VERSION, contentDb)).toBeNull();
  });
});
