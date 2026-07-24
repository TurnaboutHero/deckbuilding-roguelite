import { contentDb } from "@game/content";
import {
  createCombat,
  legalCommands,
  type CoinUid,
  type Command,
  type Rng,
  type SlotId,
} from "@game/core";
import { describe, expect, it } from "vitest";

import {
  POLICY_IDS,
  PolicyDecisionError,
  canonicalFallbackCommand,
  commandKey,
  createPolicyRng,
  createRandomPolicy,
  stableCommandOrder,
} from "./index";

const coin = (value: number): CoinUid => value as CoinUid;
const slot = (value: number): SlotId => value as SlotId;

const scriptedRng = (indexes: readonly number[]): Rng => {
  let cursor = 0;
  return {
    float: () => 0,
    int: (nExclusive) => {
      const value = indexes[cursor] ?? 0;
      cursor += 1;
      if (value < 0 || value >= nExclusive)
        throw new Error("bad scripted index");
      return value;
    },
    flip: () => "heads",
    shuffle: (values) => [...values],
    snapshot: () => ({ s: [1, 2, 3, 4] }),
  };
};

describe("policy contract", () => {
  it("locks the four M6 policy identifiers without implementing strategies", () => {
    expect(POLICY_IDS).toEqual(["random", "aggro", "turtle", "greedy"]);
  });

  it("provides an insertion-order-independent command key and comparator", () => {
    const commands: Command[] = [
      { type: "useImmediateFlipSkill", slot: slot(2), coins: [coin(4)], target: 0 },
      { type: "endTurn" },
      { type: "useImmediateFlipSkill", slot: slot(1), coins: [coin(10)], target: 0 },
      { type: "useImmediateFlipSkill", slot: slot(1), coins: [coin(2)], target: 0 },
      {
        type: "useConsumeSkill",
        slot: slot(4),
        coins: [coin(9), coin(3)],
        target: 0,
      },
    ];
    const forward = stableCommandOrder(commands).map(commandKey);
    const reverse = stableCommandOrder([...commands].reverse()).map(commandKey);

    expect(reverse).toEqual(forward);
    expect(forward[0]).toBe(commandKey({ type: "endTurn" }));
    expect(commandKey(commands[4] as Command)).toBe(
      commandKey({
        type: "useConsumeSkill",
        slot: slot(4),
        coins: [coin(3), coin(9)],
        target: 0,
      }),
    );
  });

  it("uses endTurn as the canonical fallback when it is legal", () => {
    expect(
      canonicalFallbackCommand([
        { type: "useImmediateFlipSkill", slot: slot(0), coins: [coin(1)], target: 0 },
        { type: "endTurn" },
      ]),
    ).toEqual({ type: "endTurn" });
  });

  it("derives policy streams from both run seed and policy identity", () => {
    expect(createPolicyRng("RUN-7", "random").snapshot()).toEqual(
      createPolicyRng("RUN-7", "random").snapshot(),
    );
    expect(createPolicyRng("RUN-7", "random").snapshot()).not.toEqual(
      createPolicyRng("RUN-7", "aggro").snapshot(),
    );
    expect(createPolicyRng("RUN-7", "random", 0).snapshot()).not.toEqual(
      createPolicyRng("RUN-7", "random", 1).snapshot(),
    );
  });

  it("samples exactly one uniform legal-command index without touching combat RNG", () => {
    const state = createCombat(
      { character: "warrior" as never, enemies: ["raider" as never] },
      contentDb,
      "POLICY-RNG-SEPARATION",
    );
    const ordered = stableCommandOrder(legalCommands(state, contentDb));
    const combatRngBefore = structuredClone(state.rng);

    for (let index = 0; index < ordered.length; index += 1) {
      const policy = createRandomPolicy({
        runSeed: "POLICY-RNG-SEPARATION",
        rng: scriptedRng([index]),
      });
      expect(commandKey(policy.choose(state, contentDb))).toBe(
        commandKey(ordered[index] as Command),
      );
    }
    expect(state.rng).toEqual(combatRngBefore);
  });

  it("returns a structured error when no legal command exists", () => {
    const state = createCombat(
      { character: "warrior" as never, enemies: ["raider" as never] },
      contentDb,
      "NO-LEGAL-COMMAND",
    );
    const terminal = { ...state, phase: "defeat" as const };
    const policy = createRandomPolicy({ runSeed: "NO-LEGAL-COMMAND" });

    expect(() => policy.choose(terminal, contentDb)).toThrowError(
      expect.objectContaining({
        name: "PolicyDecisionError",
        code: "NO_LEGAL_COMMANDS",
        policyId: "random",
        phase: "defeat",
      }) as PolicyDecisionError,
    );
  });
});
