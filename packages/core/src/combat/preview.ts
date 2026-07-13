import type { ContentDb, FlipSkillDef } from "../content-types";
import type { CoinUid, Face, SlotId } from "../ids";
import type { Rng, RngSnapshot } from "../rng";
import type { CombatEvent } from "./events";
import { resolveFlip } from "./resolve/flip";
import { cloneState } from "./state";
import type { CombatState } from "./state";

export interface PreviewBranch {
  faces: Face[];
  probability: number;
  damage: number;
  block: number;
  selfDamage: number;
  heal: number;
  burn: number;
  coinsCreated: number;
}

export interface PreviewFlipResult {
  branches: PreviewBranch[];
  byAxis: {
    damage: { min: number; max: number };
    block: { min: number; max: number };
    selfDamage: { min: number; max: number };
    heal: { min: number; max: number };
    burn: { min: number; max: number };
    coinsCreated: { min: number; max: number };
  };
  expected: {
    damage: number;
    block: number;
    selfDamage: number;
    heal: number;
    burn: number;
    coinsCreated: number;
  };
}

const scriptedFlips = (faces: readonly Face[]): Rng => {
  let index = 0;
  return {
    float: () => 0,
    int: () => 0,
    flip: () => {
      const face = faces[index];
      if (face === undefined) throw new Error("scripted flip exhausted");
      index += 1;
      return face;
    },
    shuffle: <T>(xs: readonly T[]) => [...xs],
    snapshot: (): RngSnapshot => ({ s: [index, 0, 0, 0] }),
  };
};

const enumerateFaces = (count: number): Face[][] => {
  if (count > 15) throw new Error("preview supports up to 15 flip outcomes");
  const branchCount = 2 ** count;
  return Array.from({ length: branchCount }, (_, branch) =>
    Array.from({ length: count }, (_unused, bit) =>
      (branch & (1 << bit)) === 0 ? "heads" : "tails",
    ),
  );
};

const sumBranch = (
  events: readonly CombatEvent[],
): Omit<PreviewBranch, "faces" | "probability"> =>
  events.reduce(
    (total, event) => {
      if (event.type === "damageDealt" && event.source === "skill") {
        return { ...total, damage: total.damage + event.amount };
      }
      if (event.type === "damageDealt" && event.source === "self") {
        return { ...total, selfDamage: total.selfDamage + event.amount };
      }
      if (event.type === "blockGained" && event.target.type === "player") {
        return { ...total, block: total.block + event.amount };
      }
      if (event.type === "statusApplied" && event.status === "burn") {
        return { ...total, burn: total.burn + event.stacks };
      }
      if (event.type === "healed" && event.target.type === "player") {
        return { ...total, heal: total.heal + event.amount };
      }
      if (event.type === "coinCreated") {
        return { ...total, coinsCreated: total.coinsCreated + 1 };
      }
      return total;
    },
    { damage: 0, block: 0, selfDamage: 0, heal: 0, burn: 0, coinsCreated: 0 },
  );

const minMax = (values: readonly number[]): { min: number; max: number } => ({
  min: Math.min(...values),
  max: Math.max(...values),
});

const isBasicCoinInHand = (
  state: CombatState,
  coin: CoinUid,
  db: ContentDb,
): boolean => {
  const instance = state.coins[Number(coin)];
  const def = instance === undefined ? undefined : db.coins[String(instance.defId)];
  return instance !== undefined && def?.element === null && instance.grants.length === 0;
};

const hasChooseBasicInHand = (skill: FlipSkillDef): boolean =>
  [...skill.base, ...(skill.heads?.effects ?? []), ...(skill.tails?.effects ?? [])].some(
    (effect) => effect.kind === "grantElement" && effect.scope === "chooseBasicInHand",
  );

const suggestedChosen = (
  state: CombatState,
  db: ContentDb,
): CoinUid[] | undefined => {
  const coin = state.zones.hand.find((candidate) =>
    isBasicCoinInHand(state, candidate, db),
  );
  return coin === undefined ? undefined : [coin];
};

export const previewFlip = (
  state: CombatState,
  slot: SlotId,
  db: ContentDb,
): PreviewFlipResult => {
  const slotState = state.slots[Number(slot)];
  if (slotState === undefined) throw new Error("slot does not exist");
  const skill = db.skills[String(slotState.skillId)];
  if (skill === undefined || skill.type !== "flip")
    throw new Error("slot is not a flip skill");

  const placed = state.zones.placed[slot] ?? [];
  const character = db.characters[String(state.characterId)];
  const remiseFlipBudget =
    character?.trait.mechanic === "remise" && state.player.remiseCharges > 0
      ? 1 + placed.length
      : 0;
  // Remise can add one check reflip and then a full free reuse. Enumerating the
  // complete flip budget keeps previews and simulator policies deterministic
  // without under-supplying the resolver's scripted RNG.
  const faceBranches = enumerateFaces(placed.length + remiseFlipBudget);
  const probability = 1 / faceBranches.length;
  const chosen = hasChooseBasicInHand(skill) ? suggestedChosen(state, db) : undefined;
  const firstLivingTarget = state.enemies.findIndex((enemy) => enemy.hp > 0);

  const branches = faceBranches.map((faces): PreviewBranch => {
    const branchState = cloneState(state);
    const result = resolveFlip(
      {
        ...branchState,
        rngImpl: { ...branchState.rngImpl, flip: scriptedFlips(faces) },
      },
      slot,
      skill,
      firstLivingTarget >= 0 ? firstLivingTarget : undefined,
      db,
      chosen,
    );
    return { faces, probability, ...sumBranch(result.events) };
  });

  return {
    branches,
    byAxis: {
      damage: minMax(branches.map((branch) => branch.damage)),
      block: minMax(branches.map((branch) => branch.block)),
      selfDamage: minMax(branches.map((branch) => branch.selfDamage)),
      heal: minMax(branches.map((branch) => branch.heal)),
      burn: minMax(branches.map((branch) => branch.burn)),
      coinsCreated: minMax(branches.map((branch) => branch.coinsCreated)),
    },
    expected: {
      damage: branches.reduce(
        (sum, branch) => sum + branch.damage * branch.probability,
        0,
      ),
      block: branches.reduce(
        (sum, branch) => sum + branch.block * branch.probability,
        0,
      ),
      selfDamage: branches.reduce(
        (sum, branch) => sum + branch.selfDamage * branch.probability,
        0,
      ),
      heal: branches.reduce(
        (sum, branch) => sum + branch.heal * branch.probability,
        0,
      ),
      burn: branches.reduce(
        (sum, branch) => sum + branch.burn * branch.probability,
        0,
      ),
      coinsCreated: branches.reduce(
        (sum, branch) => sum + branch.coinsCreated * branch.probability,
        0,
      ),
    },
  };
};
