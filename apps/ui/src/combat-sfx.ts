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
    case "healPrevented":
      return event.amount > 0 ? ["flip-tails"] : [];
    case "statusApplied":
      return event.status === "burn"
        ? ["fire"]
        : event.status === "frostbite"
          ? ["frost"]
          : event.status === "poison"
            ? ["blood"]
            : event.status === "healLock"
              ? ["flip-tails"]
              : ["shock"];
    case "cooldownReduced":
      return event.slots.length > 0 ? ["cooldown"] : [];
    case "overheatEntered":
    case "overheatActivated":
    case "overheatScheduled":
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
    case "remiseGained":
      return event.amount > 0 ? ["mana"] : [];
    case "remiseSpent":
      return [event.repeat ? "skill" : "flip-tails"];
    case "remiseRepeatResolved":
      return ["hit"];
    case "weaponOutputChanged":
    case "echoComputed":
    case "echoSpent":
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
    case "enemyWindupStarted":
    case "enemyWindupTicked":
      return ["cooldown"];
    case "enemyWindupCancelled":
      return ["skill"];
    case "enemySummonTelegraphed":
    case "enemyHatchDelayed":
    case "enemyHatchAccelerated":
      return ["cooldown"];
    case "enemySummoned":
      return ["summon-add"];
    case "enemySummonFailed":
      return ["flip-tails"];
    case "enemyHatched":
      return ["summon-replace"];
    case "enemyRemoved":
      return ["summon-expire"];
    case "enemyPhaseChanged":
      return ["overheat-enter"];
    case "enemyGrew":
      return ["mana"];
    case "enemyGrowthReduced":
      return event.removed > 0 ? ["hit"] : [];
    case "playerTurnEndPunished":
      return event.stacks > 0
        ? event.status === "frostbite"
          ? ["frost"]
          : event.status === "poison"
            ? ["blood"]
            : event.status === "healLock"
              ? ["flip-tails"]
              : ["shock"]
        : [];
    case "enemyCleansed":
      return ["blood"];
    case "enemyHealFailed":
      return ["flip-tails"];
    case "damageRedirected":
      return ["block"];
    case "protectionLinkBroken":
      return ["skill"];
    case "petrifyProgressed":
      return ["block"];
    case "petrifyShattered":
      return ["hit"];
    case "enemyAuraApplied":
      return ["mana"];
    case "protectionLinkRemoved":
    case "enemyAuraRemoved":
    case "enemyMarchRemoved":
      return [];
    case "repeatSkillZealChanged":
      return event.zeal > 0 ? ["mana"] : [];
    case "repeatSkillZealReset":
      return ["skill"];
    case "royalTaxOpened":
      return ["coin-place"];
    case "royalTaxPaymentProgressed":
    case "royalTaxPaid":
      return ["coin-consume"];
    case "royalTaxDefaulted":
      return ["flip-tails", "block"];
    case "royalTaxSeizureScheduled":
      return ["cooldown"];
    case "counterfeitExhausted":
    case "counterfeitsRemoved":
      return ["coin-consume"];
    case "coinSeizureTelegraphed":
    case "coinsSeized":
    case "coinsReturned":
    case "skillSealed":
    case "skillSealFallbackReduced":
    case "placedCoinsReturned":
    case "skillSealRepeatStruck":
    case "coinsDrawn":
    case "bloodCoinFizzle":
    case "coinsDiscarded":
    case "coinsPreserved":
    case "blockCleared":
    case "statusTicked":
    case "resonanceTriggered":
    case "enchantTriggered":
    case "traitTriggered":
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
