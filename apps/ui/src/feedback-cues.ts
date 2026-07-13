import type { CombatEvent, TargetRef } from "@game/core";

export interface FeedbackCue {
  key: string;
  duration: number;
}

const unitKey = (target: TargetRef): string =>
  target.type === "player" ? "player" : `enemy-${target.index}`;

const cue = (key: string, duration = 320): FeedbackCue => ({ key, duration });

/** UI-only projection of core facts. Never mutates combat state or timing. */
export const feedbackCuesFor = (event: CombatEvent): FeedbackCue[] => {
  switch (event.type) {
    case "damageDealt":
      return [cue(`unit-${unitKey(event.target)}`, event.source === "enemy" ? 420 : 320)];
    case "blockGained":
      return [cue(`block-${unitKey(event.target)}`, 260)];
    case "healed":
      return event.amount > 0
        ? [cue(`heal-${unitKey(event.target)}`, 340)]
        : [];
    case "enemyHealed":
      return event.amount > 0
        ? [cue(`heal-enemy-${event.enemy}`, 340)]
        : [];
    case "statusApplied":
    case "statusTicked": {
      const strength = event.type === "statusApplied" ? 340 : 240;
      return [cue(`${event.status}-${unitKey(event.target)}`, strength)];
    }
    case "witherApplied":
      return [cue("wither-player", 330)];
    case "cooldownReduced":
      return event.slots.map((slot) => cue(`cooldown-slot-${slot}`, 300));
    case "overheatEntered":
      return [cue("overheat-player", 420)];
    case "overheatConsumed":
      return [cue("overheat-player", 420)];
    case "summonAdded":
    case "summonCloned":
      return [cue(`summon-${event.uid}`, 400)];
    case "summonReplaced":
      return [cue(`summon-${event.uid}`, 440)];
    case "summonActed":
      return [cue(`summon-${event.uid}`, 320)];
    case "remiseChecked":
    case "remiseReflipped":
      return [cue("unit-player", 380)];
    case "remiseReused":
      return [cue("unit-player", 520)];
    case "weaponOutputChanged":
      return [cue("unit-player", 420)];
    case "summonAoeGranted":
      return [cue(`summon-${event.uid}`, 380)];
    case "coinPlaced":
      return [cue(`coin-${Number(event.coin)}`, 360)];
    case "coinUnplaced":
      return [cue(`coin-${Number(event.coin)}`, 360)];
    case "skillUsed":
      return [cue(`skill-slot-${Number(event.slot)}`, 260)];
    case "coinFlipped":
    case "blockCleared":
    case "traitTriggered":
    case "passiveTriggered":
    case "turnTriggerAdded":
    case "turnTriggerFired":
    case "turnTriggersExpired":
    case "coinCreated":
    case "coinsConsumed":
    case "summonExpired":
    case "coinsDrawn":
    case "coinsDiscarded":
    case "coinsPreserved":
    case "pileShuffled":
    case "elementGranted":
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
