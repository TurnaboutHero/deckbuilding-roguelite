import { describe, expect, it } from "vitest";

import type { ContentDb } from "../content-types";
import type {
  CharacterId,
  CoinDefId,
  EnemyDefId,
  SkillId,
  SlotId,
} from "../ids";
import { legalCommands } from "./commands";
import { createCombat, step } from "./reducer";
import type { CombatState } from "./state";
import { previewFlip } from "./preview";

const id = <T extends string>(value: string) => value as T;
const slot = (value: number) => value as SlotId;

const testDb = (): ContentDb => ({
  coins: {
    basic: { id: id<CoinDefId>("basic"), element: null },
    fire: { id: id<CoinDefId>("fire"), element: "fire" },
  },
  skills: {
    slash: {
      id: id<SkillId>("slash"),
      name: "베기",
      type: "flip",
      rarity: "common",
      tags: ["attack"],
      targetType: "single-enemy",
      cost: 1,
      base: [{ kind: "damage", amount: 6 }],
      heads: { mode: "any", effects: [{ kind: "damage", amount: 4 }] },
    },
    guard: {
      id: id<SkillId>("guard"),
      name: "방어",
      type: "flip",
      rarity: "common",
      tags: ["defense"],
      targetType: "self",
      cost: 1,
      base: [{ kind: "block", amount: 5 }],
      tails: { mode: "any", effects: [{ kind: "block", amount: 3 }] },
    },
    strike: {
      id: id<SkillId>("strike"),
      name: "불타는 일격",
      type: "flip",
      rarity: "common",
      tags: ["attack"],
      targetType: "single-enemy",
      cost: 2,
      base: [{ kind: "damage", amount: 8 }],
      heads: { mode: "per", effects: [{ kind: "damage", amount: 3 }] },
    },
    rampage: {
      id: id<SkillId>("rampage"),
      name: "화염 폭주",
      type: "flip",
      rarity: "rare",
      tags: ["utility"],
      targetType: "self",
      oncePerCombat: true,
      cost: 1,
      base: [
        { kind: "grantElement", element: "fire", scope: "allBasicInHand" },
      ],
      heads: {
        mode: "any",
        effects: [
          {
            kind: "addCoin",
            coin: id<CoinDefId>("fire"),
            zone: "hand",
            count: 1,
          },
        ],
      },
      tails: { mode: "any", effects: [{ kind: "selfDamage", amount: 2 }] },
    },
  },
  enemies: {
    raider: {
      id: id<EnemyDefId>("raider"),
      name: "약탈자",
      maxHp: 75,
      intents: [{ id: "slam", actions: [{ kind: "attack", damage: 11 }] }],
    },
  },
  characters: {
    warrior: {
      id: id<CharacterId>("warrior"),
      name: "전사",
      maxHp: 70,
      startingBag: Array.from({ length: 10 }, () => id<CoinDefId>("basic")),
      startingSkills: [
        id<SkillId>("slash"),
        id<SkillId>("guard"),
        id<SkillId>("strike"),
        id<SkillId>("rampage"),
      ],
      trait: {
        id: "ember-pouch",
        name: "불씨 주머니",
        hook: "combatStart",
        effects: [],
      },
    },
  },
  validate: () => [],
});

const combatWithPlacedCoin = (slotIndex: number): CombatState => {
  const db = testDb();
  const state = createCombat(
    {
      character: id<CharacterId>("warrior"),
      enemies: [id<EnemyDefId>("raider")],
    },
    db,
    "preview",
  );
  const coin = state.zones.hand[0];
  if (coin === undefined) throw new Error("missing hand coin");
  const placed = step(
    state,
    { type: "placeCoin", coin, slot: slot(slotIndex) },
    db,
  );
  if (!placed.ok) throw new Error(placed.error);
  return placed.state;
};

describe("previewFlip", () => {
  it("enumerates slash branches and expected damage", () => {
    const preview = previewFlip(combatWithPlacedCoin(0), slot(0), testDb());

    expect(preview.branches).toHaveLength(2);
    expect(
      preview.branches.map((branch) => ({
        damage: branch.damage,
        probability: branch.probability,
      })),
    ).toEqual([
      { damage: 10, probability: 0.5 },
      { damage: 6, probability: 0.5 },
    ]);
    expect(preview.expected.damage).toBe(8);
  });

  it("reports guard block range by axis", () => {
    const preview = previewFlip(combatWithPlacedCoin(1), slot(1), testDb());

    expect(preview.byAxis.block).toEqual({ min: 5, max: 8 });
  });

  it("reports self-damage and coin creation as separate axes", () => {
    const preview = previewFlip(combatWithPlacedCoin(3), slot(3), testDb());

    expect(preview.byAxis.damage).toEqual({ min: 0, max: 0 });
    expect(preview.byAxis.block).toEqual({ min: 0, max: 0 });
    expect(preview.byAxis.selfDamage).toEqual({ min: 0, max: 2 });
    expect(preview.byAxis.coinsCreated).toEqual({ min: 0, max: 1 });
    expect(preview.expected.selfDamage).toBe(1);
    expect(preview.expected.coinsCreated).toBe(0.5);
  });

  it("does not mutate the original state or rng snapshot", () => {
    const state = combatWithPlacedCoin(0);
    const before = structuredClone(state);

    previewFlip(state, slot(0), testDb());

    expect(state).toEqual(before);
  });

  // 회귀 (불타는 일격 화면 소멸): 코스트 미달 장전 상태의 프리뷰는 코어가 해결을 거부한다.
  // UI는 반드시 placed.length === cost일 때만 previewFlip을 호출해야 한다.
  it("throws on partial placement — cost 2 slot with 1 coin", () => {
    const db = testDb();
    const state = combatWithPlacedCoin(2); // strike (cost 2)에 1개만 장전

    expect(() => previewFlip(state, slot(2), db)).toThrow(
      "placed coin count must equal skill cost",
    );
    // 사용 커맨드도 합법 목록에 없다 — UI 가드와 같은 판정
    expect(
      legalCommands(state, db).some(
        (command) =>
          command.type === "useFlipSkill" && Number(command.slot) === 2,
      ),
    ).toBe(false);
  });

  // 회귀 (다중 스킬 장전 화면 소멸): 완충 장전이어도 턴 3회 캡에 걸리면 코어가 해결을 거부한다.
  // UI는 placed==cost만이 아니라 "useFlipSkill이 legalCommands에 있는가"로 프리뷰를 가드해야 한다.
  it("throws at the 3-per-turn cap even when fully loaded — legality gate contract", () => {
    const db = testDb();
    const state = { ...combatWithPlacedCoin(0), skillUsesThisTurn: 3 };

    expect(() => previewFlip(state, slot(0), db)).toThrow(
      "skill use cap reached",
    );
    expect(
      legalCommands(state, db).some(
        (command) => command.type === "useFlipSkill",
      ),
    ).toBe(false);
  });

  it("enumerates 4 branches once the cost-2 slot is fully loaded", () => {
    const db = testDb();
    const partial = combatWithPlacedCoin(2);
    const coin = partial.zones.hand[0];
    if (coin === undefined) throw new Error("missing hand coin");
    const full = step(partial, { type: "placeCoin", coin, slot: slot(2) }, db);
    if (!full.ok) throw new Error(full.error);

    const preview = previewFlip(full.state, slot(2), db);
    expect(preview.branches).toHaveLength(4);
    // per 모드: HH=14, HT/TH=11, TT=8
    expect(preview.byAxis.damage).toEqual({ min: 8, max: 14 });
    expect(preview.expected.damage).toBe(11);
  });
});
