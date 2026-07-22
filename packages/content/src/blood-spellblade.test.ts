import { describe, expect, it } from "vitest";

import type { CoinUid, SkillDef, SlotId } from "@game/core";
import { consumeRequirementFor, createCombat, step } from "@game/core";

import { characters, contentDb, passives, skills } from "./index";

const slot = (value: number): SlotId => value as SlotId;

const bloodCombat = (seed: string, equippedSkills?: string[], investment = 0) =>
  createCombat(
    {
      character: "blood-spellblade" as never,
      enemies: ["raider" as never],
      equippedSkills: equippedSkills?.map((id) => id as never),
      bloodSwordInvestment: investment,
    },
    contentDb,
    seed,
  );

const asBlood = (state: ReturnType<typeof bloodCombat>, count: number) => {
  const hand = state.zones.hand.slice(0, count);
  return {
    state: {
      ...state,
      coins: Object.fromEntries(
        Object.entries(state.coins).map(([key, coin]) => [
          key,
          hand.includes(coin.uid) ? { ...coin, defId: "blood" as never } : coin,
        ]),
      ),
    },
    hand,
  };
};

const consume = (
  state: ReturnType<typeof bloodCombat>,
  coins: readonly CoinUid[],
  target = 0,
) => {
  const result = step(
    state,
    { type: "useConsumeSkill", slot: slot(0), coins: [...coins], target },
    contentDb,
  );
  if (!result.ok) throw new Error(result.error);
  return result;
};

const place = (
  state: ReturnType<typeof bloodCombat>,
  coin: CoinUid,
  targetSlot = slot(0),
) => {
  const result = step(
    state,
    { type: "placeCoin", coin, slot: targetSlot },
    contentDb,
  );
  if (!result.ok) throw new Error(result.error);
  return result.state;
};

describe("Blood Spellblade design integration", () => {
  it("ships the character, twelve skills, three blood passives, and valid content", () => {
    expect(contentDb.validate()).toEqual([]);
    expect(characters["blood-spellblade"]).toMatchObject({
      name: "혈액 마검사",
      maxHp: 68,
      trait: { name: "혈마검", mechanic: "bloodSword" },
    });
    expect(characters["blood-spellblade"].startingSkills.map(String)).toEqual([
      "slash",
      "guard",
      "blood-offering-skill",
      "sacrifice",
    ]);
    expect(
      Object.values(skills).filter(
        (entry) =>
          "exclusiveTo" in entry &&
          String(entry.exclusiveTo) === "blood-spellblade",
      ),
    ).toHaveLength(12);
    expect(
      Object.values(passives).filter(
        (entry) => String(entry.exclusiveTo) === "blood-spellblade",
      ),
    ).toHaveLength(3);
  });

  it("keeps the Blood coin purely offensive and confines lifesteal atoms to Blood Spellblade skills", () => {
    const bloodAtoms = [
      ...(contentDb.coins.blood?.procs?.heads ?? []),
      ...(contentDb.coins.blood?.procs?.tails ?? []),
    ];
    expect(bloodAtoms.map((atom) => atom.kind)).toEqual([
      "loseHp",
      "coinDamage",
      "applyStatus",
    ]);
    expect(
      bloodAtoms.some((atom) =>
        ["heal", "block", "lifesteal", "lifestealByConsumed"].includes(
          atom.kind,
        ),
      ),
    ).toBe(false);

    const atomsFor = (definition: SkillDef) =>
      definition.type === "consume"
        ? [...definition.effects, ...(definition.overheatBonus ?? [])]
        : [
            ...(definition.base ?? []),
            ...(definition.heads?.effects ?? []),
            ...(definition.tails?.effects ?? []),
            ...(definition.mixed?.effects ?? []),
            ...(definition.successLadder ?? []).flat(),
            ...(definition.elementFaces ?? []).flatMap((bonus) =>
              bonus.effects,
            ),
            ...(definition.overheatBonus ?? []),
            ...(definition.preservedBonus ?? []),
            ...(definition.resonance?.effects ?? []),
          ];
    const lifestealOwners = Object.values(skills).filter((definition) =>
      atomsFor(definition).some(
        (atom) =>
          atom.kind === "lifesteal" || atom.kind === "lifestealByConsumed",
      ),
    );
    expect(lifestealOwners.length).toBeGreaterThan(0);
    expect(
      lifestealOwners.every(
        (definition) =>
          "exclusiveTo" in definition &&
          String(definition.exclusiveTo) === "blood-spellblade",
      ),
    ).toBe(true);
  });

  it("automatically pays one HP and advances the run investment at combat start", () => {
    const state = bloodCombat("blood-start", undefined, 4);
    expect(state.player.hp).toBe(67);
    expect(state.player.bloodSwordInvestment).toBe(5);
    expect(state.player.bloodSwordPower).toBe(1);
  });

  it("turns Blood Offering into Blood Release at stage five", () => {
    const prepared = asBlood(
      bloodCombat("blood-release", ["blood-offering-skill"], 30),
      2,
    );
    const definition = skills["blood-offering-skill"];
    if (definition?.type !== "consume")
      throw new Error("missing Blood Offering");
    expect(consumeRequirementFor(prepared.state, definition)).toEqual({
      mode: "upTo",
      min: 1,
      max: 3,
    });
    const result = consume(prepared.state, prepared.hand, 0);
    expect(result.state.player.bloodSwordInvestment).toBe(30);
    expect(result.state.player.bloodSwordReleaseBonus).toBe(4);
  });

  it("discounts the first consuming Blood Sword technique at stage four and invests what was spent", () => {
    const prepared = asBlood(
      bloodCombat("blood-discount", ["blood-sword-combo"], 24),
      1,
    );
    const definition = skills["blood-sword-combo"];
    if (definition?.type !== "consume")
      throw new Error("missing Blood Sword Combo");
    expect(prepared.state.player.bloodSwordPower).toBe(4);
    expect(consumeRequirementFor(prepared.state, definition)).toEqual({
      mode: "exact",
      min: 1,
      max: 1,
    });
    const result = consume(prepared.state, prepared.hand, 0);
    expect(result.state.player.bloodSwordInvestment).toBe(26);
    expect(result.state.player.bloodSwordDiscountUsedThisTurn).toBe(true);
    expect(result.state.player.block).toBe(2);
    expect(result.state.enemies[0]?.hp).toBe(59);
  });

  it("rejects Sacrifice when the HP payment would reduce the player to zero", () => {
    const state = bloodCombat("blood-sacrifice", ["sacrifice"]);
    const result = step(
      { ...state, player: { ...state.player, hp: 3 } },
      { type: "useFlipSkill", slot: slot(0) },
      contentDb,
    );
    expect(result).toMatchObject({ ok: false });
  });

  it("returns one Blood coin only when Bloodflow Reversal used two Blood coins", () => {
    const prepared = asBlood(
      bloodCombat("blood-reversal", ["bloodflow-reversal"]),
      2,
    );
    const withFirst = place(prepared.state, prepared.hand[0]!);
    const withBoth = place(withFirst, prepared.hand[1]!);
    const result = step(
      withBoth,
      { type: "useFlipSkill", slot: slot(0), target: 0 },
      contentDb,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.state.zones.draw[0]).toBe(prepared.hand[0]);
    expect(result.state.zones.discard).toContain(prepared.hand[1]);
  });

  it("does not return a Blood coin when Bloodflow Reversal mixes coin elements", () => {
    const base = bloodCombat("blood-reversal-mixed", ["bloodflow-reversal"]);
    const bloodUid = base.zones.hand[0]!;
    const basicUid = base.zones.hand[1]!;
    const state = {
      ...base,
      coins: {
        ...base.coins,
        [Number(bloodUid)]: {
          ...base.coins[Number(bloodUid)]!,
          defId: "blood" as never,
        },
      },
    };
    const withFirst = place(state, bloodUid);
    const withBoth = place(withFirst, basicUid);
    const result = step(
      withBoth,
      { type: "useFlipSkill", slot: slot(0), target: 0 },
      contentDb,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.state.zones.draw).not.toContain(bloodUid);
    expect(result.state.zones.discard).toEqual(
      expect.arrayContaining([bloodUid, basicUid]),
    );
  });
});
