import type {
  CharacterId,
  CoinDefId,
  CoinUid,
  CombatState,
  ContentDb,
  EnemyDefId,
  SkillId,
  SlotId,
} from "@game/core";
import { createCombat, step } from "@game/core";
import { describe, expect, it } from "vitest";

import {
  autoSuggestCoinChoice,
  coinChoiceCandidates,
  coinChoiceCommand,
  requiresCoinChoiceSelection,
  toggleCoinChoice,
} from "./coin-choice";

const id = <T extends string>(value: string): T => value as T;
const coin = (value: number): CoinUid => value as CoinUid;
const slot = (value: number): SlotId => value as SlotId;

const testDb = (): ContentDb => ({
  coins: {
    basic: { id: id<CoinDefId>("basic"), element: null },
    fire: { id: id<CoinDefId>("fire"), element: "fire" },
    mana: { id: id<CoinDefId>("mana"), element: "mana" },
  },
  skills: {
    furnace: {
      id: id<SkillId>("furnace"),
      name: "용광로",
      type: "flip",
      rarity: "advanced",
      tags: ["attack", "utility"],
      targetType: "single-enemy",
      cost: 1,
      base: [
        { kind: "grantElement", element: "fire", scope: "chooseBasicInHand" },
      ],
      heads: { mode: "any", effects: [{ kind: "damage", amount: 4 }] },
    },
    slash: {
      id: id<SkillId>("slash"),
      name: "공격",
      type: "flip",
      rarity: "common",
      tags: ["attack"],
      targetType: "single-enemy",
      cost: 1,
      base: [{ kind: "damage", amount: 4 }],
    },
  },
  enemies: {
    raider: {
      id: id<EnemyDefId>("raider"),
      name: "약탈자",
      maxHp: 30,
      intents: [{ id: "wait", actions: [{ kind: "block", amount: 0 }] }],
    },
  },
  characters: {
    warrior: {
      id: id<CharacterId>("warrior"),
      name: "전사",
      maxHp: 40,
      startingBag: Array.from({ length: 10 }, () => id<CoinDefId>("basic")),
      startingSkills: [
        id<SkillId>("furnace"),
        id<SkillId>("slash"),
        id<SkillId>("slash"),
        id<SkillId>("slash"),
        id<SkillId>("slash"),
        id<SkillId>("slash"),
      ],
      trait: {
        id: "none",
        name: "없음",
        hook: "combatStart",
        effects: [],
      },
    },
  },
  validate: () => [],
});

const boot = (): CombatState =>
  createCombat(
    { character: id<CharacterId>("warrior"), enemies: [id<EnemyDefId>("raider")] },
    testDb(),
    "coin-choice",
  );

const withHand = (state: CombatState): CombatState => ({
  ...state,
  coins: {
    ...state.coins,
    1: { uid: coin(1), defId: id<CoinDefId>("basic"), permanent: true, grants: [] },
    2: { uid: coin(2), defId: id<CoinDefId>("fire"), permanent: true, grants: [] },
    3: { uid: coin(3), defId: id<CoinDefId>("basic"), permanent: true, grants: [] },
    4: {
      uid: coin(4),
      defId: id<CoinDefId>("basic"),
      permanent: true,
      grants: ["fire"],
    },
    5: { uid: coin(5), defId: id<CoinDefId>("mana"), permanent: true, grants: [] },
  },
  zones: {
    ...state.zones,
    hand: [coin(1), coin(2), coin(3), coin(4), coin(5)],
    draw: [],
    discard: [],
    exhausted: [],
  },
});

const placeCost = (state: CombatState): CombatState => {
  const result = step(state, { type: "placeCoin", coin: coin(1), slot: slot(0) }, testDb());
  if (!result.ok) throw new Error(result.error);
  return result.state;
};

describe("coin choice", () => {
  it("lists only ungranted basic hand coins and suggests the first one", () => {
    const db = testDb();
    const state = placeCost(withHand(boot()));

    expect(coinChoiceCandidates(state, slot(0), db)).toEqual([coin(3)]);
    expect(autoSuggestCoinChoice(state, slot(0), db)).toEqual([coin(3)]);
    expect(coinChoiceCandidates(state, slot(1), db)).toEqual([]);
  });

  it("requires selection mode only when at least two candidates exist", () => {
    const db = testDb();
    const state = placeCost(withHand(boot()));

    expect(requiresCoinChoiceSelection(state, slot(0), db)).toBe(false);
    expect(
      requiresCoinChoiceSelection(
        { ...state, zones: { ...state.zones, hand: [coin(3), coin(1)] } },
        slot(0),
        db,
      ),
    ).toBe(true);
  });

  it("toggles valid choices and rejects invalid coins by reference", () => {
    const db = testDb();
    const state = {
      ...placeCost(withHand(boot())),
      zones: { ...placeCost(withHand(boot())).zones, hand: [coin(1), coin(3)] },
    };
    const empty = { slot: slot(0), coins: [] };
    const selected = toggleCoinChoice(empty, coin(3), state, db);

    expect(selected.coins).toEqual([coin(3)]);
    expect(toggleCoinChoice(selected, coin(3), state, db).coins).toEqual([]);
    expect(toggleCoinChoice(selected, coin(2), state, db)).toBe(selected);
  });

  it("builds a chosen useFlipSkill command that core step accepts", () => {
    const db = testDb();
    const state = placeCost(withHand(boot()));
    const command = coinChoiceCommand(
      { slot: slot(0), coins: [coin(3)] },
      state,
      db,
    );

    expect(command).toEqual({
      type: "useFlipSkill",
      slot: slot(0),
      target: 0,
      chosen: [coin(3)],
    });
    expect(command !== null && step(state, command, db).ok).toBe(true);
    expect(coinChoiceCommand({ slot: slot(0), coins: [] }, state, db)).toBeNull();
    expect(
      coinChoiceCommand({ slot: slot(0), coins: [coin(2)] }, state, db),
    ).toBeNull();
  });

  // 회귀 (감시자 발견): target 0 고정 검증은 첫 적이 죽은 다중 적 전투에서
  // 확정을 침묵 실패시킨다 — target은 legalCommands의 합법 대상에서 와야 한다.
  it("confirms with a living legal target when enemy 0 is dead", () => {
    const db = testDb();
    const duo = createCombat(
      {
        character: id<CharacterId>("warrior"),
        enemies: [id<EnemyDefId>("raider"), id<EnemyDefId>("raider")],
      },
      db,
      "coin-choice-duo",
    );
    const enemyZeroDead: CombatState = {
      ...duo,
      enemies: duo.enemies.map((enemy, index) =>
        index === 0 ? { ...enemy, hp: 0 } : enemy,
      ),
    };
    const state = placeCost(withHand(enemyZeroDead));
    const command = coinChoiceCommand(
      { slot: slot(0), coins: [coin(3)] },
      state,
      db,
    );

    expect(command).not.toBeNull();
    expect(command?.target).toBe(1);
    expect(command !== null && step(state, command, db).ok).toBe(true);
  });
});
