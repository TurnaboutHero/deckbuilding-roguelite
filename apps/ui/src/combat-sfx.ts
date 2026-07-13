import type { CombatEvent } from "@game/core";
import type { SfxKind } from "./audio";

/** UI-only sound projection. Core state, replay data, and event timing stay untouched. */
export const sfxCuesFor = (event: CombatEvent): SfxKind[] => {
  switch (event.type) {
    case "coinFlipped":
      return [event.face === "heads" ? "flip-heads" : "flip-tails"];
    case "coinPlaced":
      return ["coin-place"];
    case "coinUnplaced":
      return ["coin-return"];
    case "coinCreated":
      return ["coin-create"];
    case "coinsConsumed":
      return event.coins.length > 0 ? ["coin-consume"] : [];
    case "pileShuffled":
      return event.count > 0 ? ["coin-shuffle"] : [];
    case "skillUsed":
      return ["skill"];
    case "damageDealt":
      return event.amount > 0 ? ["hit"] : [];
    case "blockGained":
      return event.amount > 0 ? ["block"] : [];
    case "healed":
    case "enemyHealed":
      return event.amount > 0 ? ["blood"] : [];
    case "statusApplied":
      return event.status === "burn"
        ? ["fire"]
        : event.status === "frostbite"
          ? ["frost"]
          : ["shock"];
    case "cooldownReduced":
      return event.slots.length > 0 ? ["cooldown"] : [];
    case "overheatEntered":
      return ["overheat-enter"];
    case "overheatConsumed":
      return ["overheat-consume"];
    case "summonAdded":
    case "summonCloned":
      return ["summon-add"];
    case "summonReplaced":
      return ["summon-replace"];
    case "summonActed":
      return ["summon-act"];
    case "remiseReflipped":
      return [event.face === "heads" ? "flip-heads" : "flip-tails"];
    case "remiseReused":
      return ["skill"];
    case "weaponOutputChanged":
    case "summonAoeGranted":
      return ["mana"];
    case "summonExpired":
      return ["summon-expire"];
    case "elementGranted":
      return event.element === "fire"
        ? ["fire"]
        : event.element === "mana"
          ? ["mana"]
          : event.element === "frost"
            ? ["frost"]
            : event.element === "lightning"
              ? ["shock"]
              : ["blood"];
    case "coinsDrawn":
    case "coinsDiscarded":
    case "blockCleared":
    case "statusTicked":
    case "traitTriggered":
    case "remiseChecked":
    case "passiveTriggered":
    case "turnTriggerAdded":
    case "turnTriggerFired":
    case "turnTriggersExpired":
    case "witherApplied":
    case "enemyPassiveTriggered":
    case "enemyAttackBuffed":
    case "intentRevealed":
    case "turnStarted":
    case "combatEnded":
      return [];
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
};
