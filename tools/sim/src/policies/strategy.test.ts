import { contentDb } from "@game/content";
import {
  createCombat,
  legalCommands,
  step,
  type CoinDefId,
  type CombatState,
  type ContentDb,
  type EnemyDefId,
  type FlipSkillDef,
  type SkillDef,
  type SkillId,
  type SlotId,
} from "@game/core";
import { describe, expect, it } from "vitest";

import {
  GREEDY_EV_WEIGHTS,
  commandKey,
  createAggroPolicy,
  createGreedyEvPolicy,
  createPolicy,
  createTurtlePolicy,
  type CombatPolicy,
  type PolicyId,
} from "./index";

const skill = (value: string): SkillId => value as SkillId;
const coin = (value: string): CoinDefId => value as CoinDefId;
const enemy = (value: string): EnemyDefId => value as EnemyDefId;

const flipSkill = (
  id: string,
  definition: Omit<FlipSkillDef, "id">,
): FlipSkillDef => ({ ...definition, id: skill(id) });

const strategySkills = {
  "policy-all-out": flipSkill("policy-all-out", {
    name: "All Out",
    type: "flip",
    rarity: "common",
    tags: ["attack"],
    targetType: "single-enemy",
    cost: 1,
    base: [
      { kind: "damage", amount: 16 },
      { kind: "selfDamage", amount: 10 },
    ],
  }),
  "policy-wall": flipSkill("policy-wall", {
    name: "Wall",
    type: "flip",
    rarity: "common",
    tags: ["defense"],
    targetType: "self",
    cost: 1,
    base: [{ kind: "block", amount: 9 }],
  }),
  "policy-balanced": flipSkill("policy-balanced", {
    name: "Balanced",
    type: "flip",
    rarity: "common",
    tags: ["attack", "defense"],
    targetType: "single-enemy",
    cost: 1,
    base: [
      { kind: "damage", amount: 7 },
      { kind: "block", amount: 2 },
    ],
  }),
  "policy-idle": flipSkill("policy-idle", {
    name: "Idle",
    type: "flip",
    rarity: "common",
    tags: ["utility"],
    targetType: "self",
    cost: 1,
    base: [],
  }),
  "policy-v12-zero-guard": flipSkill("policy-v12-zero-guard", {
    name: "v1.2 Zero-floor Guard",
    type: "flip",
    rarity: "common",
    tags: ["defense"],
    targetType: "self",
    cost: 1,
    successFace: "tails",
    successLadder: [[], [{ kind: "block", amount: 4 }]],
  }),
  "policy-v12-balanced": flipSkill("policy-v12-balanced", {
    name: "v1.2 Balanced Two-cost",
    type: "flip",
    rarity: "common",
    tags: ["attack", "defense"],
    targetType: "single-enemy",
    cost: 2,
    successFace: "heads",
    successLadder: [
      [
        { kind: "damage", amount: 3 },
        { kind: "block", amount: 1 },
      ],
      [
        { kind: "damage", amount: 3 },
        { kind: "block", amount: 1 },
      ],
      [
        { kind: "damage", amount: 3 },
        { kind: "block", amount: 1 },
      ],
    ],
  }),
  "policy-v12-engine": flipSkill("policy-v12-engine", {
    name: "v1.2 Resource Engine",
    type: "flip",
    rarity: "common",
    tags: ["attack"],
    targetType: "single-enemy",
    cost: 2,
    successFace: "heads",
    successLadder: [
      [{ kind: "damage", amount: 3 }],
      [
        { kind: "damage", amount: 3 },
        { kind: "addCoin", coin: coin("fire"), zone: "draw", count: 1 },
      ],
      [
        { kind: "damage", amount: 3 },
        { kind: "addCoin", coin: coin("fire"), zone: "draw", count: 1 },
      ],
    ],
  }),
  "policy-v12-burst": flipSkill("policy-v12-burst", {
    name: "v1.2 Immediate Burst",
    type: "flip",
    rarity: "common",
    tags: ["attack"],
    targetType: "single-enemy",
    cost: 2,
    base: [{ kind: "damage", amount: 4 }],
  }),
} satisfies Record<string, SkillDef>;

const withSkills = (skills: Record<string, SkillDef>): ContentDb => ({
  ...contentDb,
  skills: { ...contentDb.skills, ...skills },
});

const stateWithSkills = (
  db: ContentDb,
  equippedSkills: readonly SkillId[],
  bag: readonly CoinDefId[] = [coin("basic")],
): CombatState =>
  createCombat(
    {
      character: "warrior" as never,
      enemies: [enemy("raider")],
      bag,
      equippedSkills,
    },
    db,
    "M6-STRATEGY-TEST",
  );

const policySlot = (
  policy: CombatPolicy,
  state: CombatState,
  db: ContentDb,
): SlotId => {
  const command = policy.choose(state, db);
  expect(legalCommands(state, db).map(commandKey)).toContain(
    commandKey(command),
  );
  if (
    command.type !== "placeCoin" &&
    command.type !== "useImmediateFlipSkill" &&
    command.type !== "useFlipSkill" &&
    command.type !== "useConsumeSkill"
  ) {
    throw new Error(`expected a slot command, received ${command.type}`);
  }
  return command.slot;
};

interface TraceResult {
  readonly phase: CombatState["phase"];
  readonly commands: readonly string[];
  readonly turns: number;
  readonly playerHp: number;
}

const playTrace = (policyId: Exclude<PolicyId, "random">): TraceResult => {
  let state = createCombat(
    { character: "warrior" as never, enemies: [enemy("raider")] },
    contentDb,
    `M6-${policyId}-REPLAY`,
  );
  const policy = createPolicy(policyId, { runSeed: `M6-${policyId}-REPLAY` });
  const commands: string[] = [];

  for (let index = 0; index < 500 && state.phase === "player"; index += 1) {
    const before = structuredClone(state);
    const legal = new Set(legalCommands(state, contentDb).map(commandKey));
    const command = policy.choose(state, contentDb);
    const key = commandKey(command);
    expect(legal.has(key)).toBe(true);
    expect(state).toEqual(before);

    const result = step(state, command, contentDb);
    if (!result.ok)
      throw new Error(`strategy command rejected: ${result.error}`);
    state = result.state;
    commands.push(key);
  }

  if (state.phase !== "victory" && state.phase !== "defeat") {
    throw new Error(`${policyId} did not terminate within 500 commands`);
  }
  return {
    phase: state.phase,
    commands,
    turns: state.turn,
    playerHp: state.player.hp,
  };
};

describe("M6 strategy policies", () => {
  it("locks and freezes the GreedyEV weight vector", () => {
    expect(GREEDY_EV_WEIGHTS).toEqual({
      expectedDamage: 1,
      preventedIncomingDamage: 0.9,
      selfDamage: -1.5,
      burnMarginalValue: 0.75,
      resourceMarginalValue: 2,
      unusedResourcePenalty: -0.1,
    });
    expect(Object.isFrozen(GREEDY_EV_WEIGHTS)).toBe(true);
  });

  it("uses distinct Aggro, Turtle, and GreedyEV preferences from legal immediate actions", () => {
    const db = withSkills(strategySkills);
    const state = stateWithSkills(db, [
      skill("policy-all-out"),
      skill("policy-wall"),
      skill("policy-balanced"),
      skill("policy-idle"),
      skill("policy-idle"),
      skill("policy-idle"),
    ]);
    const options = { runSeed: "M6-DISTINCT-PREFERENCES" };

    expect(Number(policySlot(createAggroPolicy(options), state, db))).toBe(0);
    expect(Number(policySlot(createTurtlePolicy(options), state, db))).toBe(1);
    expect(Number(policySlot(createGreedyEvPolicy(options), state, db))).toBe(
      2,
    );
  });

  it("evaluates and executes an immediate flip through its exact legal command", () => {
    const db = withSkills(strategySkills);
    const state = stateWithSkills(db, [skill("policy-balanced")]);
    const command = createAggroPolicy({ runSeed: "M6-RESERVATION" }).choose(
      state,
      db,
    );
    expect(command).toMatchObject({
      type: "useImmediateFlipSkill",
      slot: 0,
    });
    expect(legalCommands(state, db).map(commandKey)).toContain(commandKey(command));
    expect(step(state, command, db).ok).toBe(true);
  });

  it("lets a repeat skill resolve immediately and remain available while coins remain", () => {
    const policy = createTurtlePolicy({ runSeed: "M6-REPEAT-IMMEDIATE" });
    const state = createCombat(
      {
        character: "warrior" as never,
        enemies: [enemy("gatekeeper")],
        bag: [
          coin("basic"), coin("basic"), coin("basic"), coin("basic"),
          coin("basic"), coin("basic"), coin("basic"), coin("basic"),
          coin("fire"), coin("fire"),
        ],
        equippedSkills: [skill("jab"), skill("fist-guard"), skill("fire-fist"), skill("direct-hit")],
      },
      contentDb,
      "M6-REPEAT-IMMEDIATE",
    );
    const first = policy.choose(state, contentDb);
    expect(first).toMatchObject({ type: "useImmediateFlipSkill" });
    const resolved = step(state, first, contentDb);
    if (!resolved.ok) throw new Error(resolved.error);
    expect(legalCommands(resolved.state, contentDb).some((command) => command.type === "useImmediateFlipSkill")).toBe(true);
  });

  it("scores guaranteed consume effects and resolves equal values by canonical command key", () => {
    const consume = (id: string): SkillDef => ({
      id: skill(id),
      name: id,
      type: "consume",
      rarity: "advanced",
      tags: ["attack"],
      targetType: "single-enemy",
      consume: { element: "fire", count: 1 },
      effects: [{ kind: "damage", amount: 10 }],
    });
    const db = withSkills({
      ...strategySkills,
      "policy-consume-a": consume("policy-consume-a"),
      "policy-consume-b": consume("policy-consume-b"),
    });
    const state = stateWithSkills(
      db,
      [
        skill("policy-consume-a"),
        skill("policy-consume-b"),
        skill("policy-idle"),
        skill("policy-idle"),
        skill("policy-idle"),
        skill("policy-idle"),
      ],
      [coin("fire")],
    );
    const snapshot = structuredClone(state.rng);

    for (const policy of [
      createAggroPolicy({ runSeed: "M6-CONSUME-TIE" }),
      createTurtlePolicy({ runSeed: "M6-CONSUME-TIE" }),
      createGreedyEvPolicy({ runSeed: "M6-CONSUME-TIE" }),
    ]) {
      const command = policy.choose(state, db);
      expect(command).toMatchObject({ type: "useConsumeSkill", slot: 0 });
      expect(state.rng).toEqual(snapshot);
    }
  });

  it("values a v1.2 two-cost resource engine over a slightly larger one-shot hit", () => {
    const db = withSkills(strategySkills);
    const initial = stateWithSkills(
      db,
      [
        skill("policy-v12-burst"),
        skill("policy-v12-engine"),
        skill("policy-idle"),
      ],
      [coin("basic"), coin("basic"), coin("basic")],
    );
    const basicHand = initial.zones.hand.filter(
      (uid) => String(initial.coins[Number(uid)]?.defId) === "basic",
    );
    const state: CombatState = {
      ...initial,
      zones: {
        ...initial.zones,
        hand: basicHand,
        draw: initial.zones.draw.filter((uid) => !basicHand.includes(uid)),
      },
    };

    expect(
      Number(
        policySlot(
          createGreedyEvPolicy({ runSeed: "V12-ENGINE" }),
          state,
          db,
        ),
      ),
    ).toBe(1);
  });

  it("makes Turtle prefer immediate prevention over a two-cost RNG counterattack", () => {
    const db = withSkills(strategySkills);
    const state = stateWithSkills(
      db,
      [
        skill("policy-v12-zero-guard"),
        skill("policy-v12-balanced"),
        skill("policy-idle"),
      ],
      [coin("basic"), coin("basic"), coin("basic")],
    );

    expect(
      Number(
        policySlot(
          createTurtlePolicy({ runSeed: "V12-TURTLE" }),
          state,
          db,
        ),
      ),
    ).toBe(0);
  });

  it.each(["aggro", "turtle", "greedy"] as const)(
    "%s returns only legal commands, does not mutate observations, and replays exactly",
    (policyId) => {
      const first = playTrace(policyId);
      const replay = playTrace(policyId);
      expect(replay).toEqual(first);
      expect(first.commands.length).toBeGreaterThan(0);
      console.info(
        `M6_STRATEGY_REPLAY ${JSON.stringify({
          policyId,
          phase: first.phase,
          commandCount: first.commands.length,
          turns: first.turns,
          playerHp: first.playerHp,
        })}`,
      );
    },
  );
});
