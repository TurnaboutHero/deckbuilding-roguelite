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
import { createCombat, legalCommands, step } from "@game/core";
import { describe, expect, it } from "vitest";

import {
  autoSuggestFuel,
  fuelCommand,
  requiresFuelSelection,
  toggleFuel,
} from "./fuel-selection";
import { sameCommand } from "./interaction";
import { legalTargetsForCommand } from "./targeting";

const id = <T extends string>(value: string): T => value as T;
const coin = (value: number): CoinUid => value as CoinUid;
const slot = (value: number): SlotId => value as SlotId;

const testDb = (): ContentDb => ({
  coins: {
    basic: { id: id<CoinDefId>("basic"), element: null },
    fire: { id: id<CoinDefId>("fire"), element: "fire" },
    mana: { id: id<CoinDefId>("mana"), element: "mana" },
    frost: { id: id<CoinDefId>("frost"), element: "frost" },
  },
  skills: {
    strike: {
      id: id<SkillId>("strike"),
      name: "타격",
      type: "flip",
      rarity: "common",
      tags: ["attack"],
      targetType: "single-enemy",
      cost: 1,
      base: [{ kind: "damage", amount: 1 }],
    },
    "consume-one": {
      id: id<SkillId>("consume-one"),
      name: "작은 불씨",
      type: "consume",
      rarity: "common",
      tags: ["attack"],
      targetType: "single-enemy",
      consume: { element: "fire", count: 1 },
      effects: [{ kind: "damage", amount: 3 }],
    },
    "consume-two": {
      id: id<SkillId>("consume-two"),
      name: "큰 불씨",
      type: "consume",
      rarity: "advanced",
      tags: ["attack"],
      targetType: "single-enemy",
      consume: { element: "fire", count: 2 },
      effects: [{ kind: "damage", amount: 9 }],
    },
    "frost-up-to": {
      id: id<SkillId>("frost-up-to"),
      name: "빙점 절개",
      type: "consume",
      rarity: "advanced",
      tags: ["attack"],
      targetType: "single-enemy",
      consume: { element: "frost", count: 3, mode: "upTo" },
      effects: [{ kind: "damageByConsumed", base: 5, perCoin: 5 }],
    },
    "frost-all": {
      id: id<SkillId>("frost-all"),
      name: "동결 건조",
      type: "consume",
      rarity: "rare",
      tags: ["attack"],
      targetType: "single-enemy",
      consume: { element: "frost", count: 3, mode: "all" },
      effects: [{ kind: "damageByConsumed", base: 0, perCoin: 8 }],
    },
    "frost-draw": {
      id: id<SkillId>("frost-draw"),
      name: "냉기 장물",
      type: "consume",
      rarity: "advanced",
      tags: ["utility"],
      targetType: "self",
      consume: { element: "frost", count: 2 },
      effects: [{ kind: "drawSpecific", coins: [id<CoinDefId>("basic"), id<CoinDefId>("frost")], count: 1 }],
    },
    "frost-preserved": {
      id: id<SkillId>("frost-preserved"),
      name: "보존 냉기 교환",
      type: "consume",
      rarity: "advanced",
      tags: ["defense"],
      targetType: "self",
      consume: { element: "frost", count: 1 },
      effects: [{ kind: "block", amount: 1 }],
      preservedBonus: [{ kind: "block", amount: 2 }],
    },
    "frost-preserved-strike": {
      id: id<SkillId>("frost-preserved-strike"),
      name: "보존 냉기 습격",
      type: "consume",
      rarity: "advanced",
      tags: ["attack"],
      targetType: "single-enemy",
      consume: { element: "frost", count: 1 },
      effects: [{ kind: "damage", amount: 2 }],
      preservedBonus: [{ kind: "damage", amount: 3 }],
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
        id<SkillId>("strike"),
        id<SkillId>("consume-one"),
        id<SkillId>("consume-two"),
        id<SkillId>("frost-up-to"),
        id<SkillId>("frost-all"),
        id<SkillId>("frost-draw"),
        id<SkillId>("frost-preserved"),
        id<SkillId>("frost-preserved-strike"),
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
    "fuel-selection",
  );

const withHand = (state: CombatState): CombatState => ({
  ...state,
  coins: {
    ...state.coins,
    1: { uid: coin(1), defId: id<CoinDefId>("basic"), permanent: true, grants: [] },
    2: {
      uid: coin(2),
      defId: id<CoinDefId>("basic"),
      permanent: true,
      grants: ["fire"],
    },
    3: { uid: coin(3), defId: id<CoinDefId>("fire"), permanent: true, grants: [] },
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

const withFrostHand = (state: CombatState): CombatState => ({
  ...state,
  coins: {
    ...state.coins,
    1: { uid: coin(1), defId: id<CoinDefId>("frost"), permanent: true, grants: [] },
    2: { uid: coin(2), defId: id<CoinDefId>("frost"), permanent: true, grants: [] },
    3: { uid: coin(3), defId: id<CoinDefId>("frost"), permanent: true, grants: [] },
    4: { uid: coin(4), defId: id<CoinDefId>("frost"), permanent: true, grants: [] },
    5: { uid: coin(5), defId: id<CoinDefId>("basic"), permanent: true, grants: ["frost"] },
    6: { uid: coin(6), defId: id<CoinDefId>("frost"), permanent: true, grants: [] },
  },
  zones: {
    ...state.zones,
    hand: [coin(1), coin(2), coin(3), coin(4), coin(5)],
    draw: [coin(6)],
    discard: [],
    exhausted: [],
  },
});

describe("fuel selection", () => {
  it("autoSuggest picks granted-fire first then hand order deterministically", () => {
    const db = testDb();
    const state = withHand(boot());

    expect(autoSuggestFuel(state, slot(2), db)).toEqual([coin(2), coin(4)]);
    expect(autoSuggestFuel(state, slot(2), db)).toEqual([coin(2), coin(4)]);
  });

  it("toggle adds, removes, caps at count, rejects invalid coins, and keeps hand order", () => {
    const db = testDb();
    const state = withHand(boot());
    const empty = { slot: slot(2), coins: [] };
    const first = toggleFuel(empty, coin(4), state, db);
    const ordered = toggleFuel(first, coin(2), state, db);

    expect(ordered.coins).toEqual([coin(2), coin(4)]);
    expect(toggleFuel(ordered, coin(3), state, db)).toBe(ordered);
    expect(toggleFuel(ordered, coin(5), state, db)).toBe(ordered);
    expect(toggleFuel(ordered, coin(2), state, db).coins).toEqual([coin(4)]);
  });

  it("fuelCommand is null below count and exact auto count is a legal command", () => {
    const db = testDb();
    const state = withHand(boot());
    const partial = { slot: slot(2), coins: [coin(2)] };
    const exact = { slot: slot(2), coins: autoSuggestFuel(state, slot(2), db) };
    const command = fuelCommand(exact, state, db);

    expect(fuelCommand(partial, state, db)).toBeNull();
    expect(command).not.toBeNull();
    expect(
      command !== null &&
        legalCommands(state, db).some((candidate) =>
          sameCommand(candidate, command),
        ),
    ).toBe(true);
  });

  it("count==1 without choice-dependent bonuses bypasses selection mode", () => {
    const db = testDb();
    const state = withHand(boot());

    // App calls requiresFuelSelection before touching autoSuggestFuel/fuelCommand.
    expect(requiresFuelSelection(state, slot(1), db)).toBe(false);
    expect(requiresFuelSelection(state, slot(2), db)).toBe(true);
  });

  it("opens exact-one selection when the chosen preserved fuel changes the effect", () => {
    const db = testDb();
    const base = withFrostHand(boot());
    const state = {
      ...base,
      coins: {
        ...base.coins,
        2: { ...base.coins[2]!, preserved: true },
      },
    };
    expect(requiresFuelSelection(state, slot(6), db)).toBe(true);
    const suggested = { slot: slot(6), coins: autoSuggestFuel(state, slot(6), db) };
    const cleared = toggleFuel(suggested, coin(1), state, db);
    const chosen = toggleFuel(cleared, coin(2), state, db);
    expect(chosen.coins).toEqual([coin(2)]);
    const command = fuelCommand(chosen, state, db);
    expect(command?.coins).toEqual([coin(2)]);
    if (command === null) throw new Error("expected preserved-fuel command");
    const result = step(state, command, db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.player.block).toBe(3);
  });

  it("built consume command resolves like a direct useConsumeSkill dispatch", () => {
    const db = testDb();
    const state = withHand(boot());
    const selection = { slot: slot(2), coins: [coin(3), coin(4)] };
    const command = fuelCommand(selection, state, db);
    if (command === null) throw new Error("expected fuel command");

    const selected = step(state, command, db);
    const direct = step(
      state,
      { type: "useConsumeSkill", slot: slot(2), coins: [coin(3), coin(4)], target: 0 },
      db,
    );
    expect(selected.ok).toBe(true);
    expect(direct.ok).toBe(true);
    if (!selected.ok || !direct.ok) return;
    expect(selected.state.enemies[0]?.hp).toBe(direct.state.enemies[0]?.hp);
    expect(selected.state.zones.exhausted).toEqual(direct.state.zones.exhausted);
  });

  it("allows upTo frost selection from one to three and excludes granted basics", () => {
    const db = testDb();
    const state = withFrostHand(boot());
    expect(autoSuggestFuel(state, slot(3), db)).toEqual([coin(1), coin(2), coin(3)]);

    const one = { slot: slot(3), coins: [coin(1)] };
    expect(fuelCommand(one, state, db)?.coins).toEqual([coin(1)]);
    const two = toggleFuel(one, coin(2), state, db);
    expect(fuelCommand(two, state, db)?.coins).toEqual([coin(1), coin(2)]);
    const three = toggleFuel(two, coin(3), state, db);
    expect(fuelCommand(three, state, db)?.coins).toEqual([coin(1), coin(2), coin(3)]);
    expect(toggleFuel(three, coin(5), state, db)).toBe(three);
  });

  it("selects and consumes every actual frost coin for all mode", () => {
    const db = testDb();
    const state = withFrostHand(boot());
    const coins = autoSuggestFuel(state, slot(4), db);
    expect(coins).toEqual([coin(1), coin(2), coin(3), coin(4)]);
    const command = fuelCommand({ slot: slot(4), coins }, state, db);
    expect(command?.coins).toEqual(coins);
    if (command === null) throw new Error("expected all-frost command");
    const result = step(state, command, db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.zones.exhausted).toEqual(expect.arrayContaining(coins));
    expect(result.state.zones.hand).toContain(coin(5));
  });

  it("copies the legal desired draw coin onto an explicit fuel command", () => {
    const db = testDb();
    const state = withFrostHand(boot());
    const command = fuelCommand(
      { slot: slot(5), coins: [coin(1), coin(2)] },
      state,
      db,
    );
    expect(command).toMatchObject({ desiredCoin: id<CoinDefId>("frost") });
  });

  it("keeps multi-enemy targeting for a manual upTo subset and exact preserved fuel", () => {
    const db = testDb();
    const duo = createCombat(
      {
        character: id<CharacterId>("warrior"),
        enemies: [id<EnemyDefId>("raider"), id<EnemyDefId>("raider")],
      },
      db,
      "manual-fuel-targeting",
    );
    const base = withFrostHand(duo);
    const state: CombatState = {
      ...base,
      coins: {
        ...base.coins,
        2: { ...base.coins[2]!, preserved: true },
      },
    };

    const upTo = fuelCommand(
      { slot: slot(3), coins: [coin(1)] },
      state,
      db,
    );
    expect(upTo).not.toBeNull();
    if (upTo === null) throw new Error("expected up-to command");
    expect(legalTargetsForCommand(legalCommands(state, db), upTo)).toEqual([
      0,
      1,
    ]);
    const upToResult = step(state, { ...upTo, target: 1 }, db);
    expect(upToResult.ok).toBe(true);
    if (!upToResult.ok) return;
    expect(upToResult.state.enemies.map((enemy) => enemy.hp)).toEqual([30, 20]);

    const exact = fuelCommand(
      { slot: slot(7), coins: [coin(2)] },
      state,
      db,
    );
    expect(exact?.coins).toEqual([coin(2)]);
    if (exact === null) throw new Error("expected preserved exact command");
    expect(legalTargetsForCommand(legalCommands(state, db), exact)).toEqual([
      0,
      1,
    ]);
    const exactResult = step(state, { ...exact, target: 1 }, db);
    expect(exactResult.ok).toBe(true);
    if (!exactResult.ok) return;
    expect(exactResult.state.enemies.map((enemy) => enemy.hp)).toEqual([30, 25]);
  });

  it("seeds manual consume commands from the first living target", () => {
    const db = testDb();
    const duo = createCombat(
      {
        character: id<CharacterId>("warrior"),
        enemies: [id<EnemyDefId>("raider"), id<EnemyDefId>("raider")],
      },
      db,
      "manual-fuel-dead-first-target",
    );
    const frosted = withFrostHand(duo);
    const state: CombatState = {
      ...frosted,
      enemies: frosted.enemies.map((enemy, index) =>
        index === 0 ? { ...enemy, hp: 0 } : enemy,
      ),
      coins: {
        ...frosted.coins,
        2: { ...frosted.coins[2]!, preserved: true },
      },
    };

    for (const selection of [
      { slot: slot(3), coins: [coin(1)] },
      { slot: slot(7), coins: [coin(2)] },
    ]) {
      const command = fuelCommand(selection, state, db);
      expect(command?.target).toBe(1);
      expect(command !== null && step(state, command, db).ok).toBe(true);
    }
  });
});
