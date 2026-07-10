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
        id<SkillId>("strike"),
        id<SkillId>("strike"),
        id<SkillId>("strike"),
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

  it("count==1 bypasses selection mode through the App gate helper", () => {
    const db = testDb();
    const state = withHand(boot());

    // App calls requiresFuelSelection before touching autoSuggestFuel/fuelCommand.
    expect(requiresFuelSelection(state, slot(1), db)).toBe(false);
    expect(requiresFuelSelection(state, slot(2), db)).toBe(true);
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
});
