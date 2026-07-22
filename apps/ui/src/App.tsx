import { CONTENT_VERSION, contentDb } from "@game/content";
import type { CoinDefId, CoinUid, CharacterId, EnemyDefId, EquipmentDefId, Face, RunState, SkillId, SlotId, StatusId } from "@game/core";
import {
  acceptEvent,
  buyShopCoin,
  buyShopRemoval,
  buyShopSkill,
  declineEvent,
  chooseCoinReward,
  chooseRunNode,
  choosePassiveReward,
  skillCooldown,
  skillRequiresSummonChoice,
  claimTreasure,
  restHeal,
  restUpgrade,
  buyShopPassive,
  actOfLayer,
  chooseSkillReward,
  completedCombatCount,
  createCombat,
  createRun,
  effectiveElements,
  leaveShop,
  legalCommands,
  isLockedSkill,
  MAX_PRESERVED_COINS,
  previewFlip,
  resolveCoinRemoval,
  resumeAbandonedCombat,
  settleRunCombat,
  skipSkillReward,
  startRunCombat,
  statusStacks,
  statusTurns,
  step,
  upgradedContentDb,
} from "@game/core";
import type { CombatEvent, CombatState, Command, EnemyAction, SkillDef } from "@game/core";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

declare const __VITE_PRODUCTION_BUILD__: boolean;
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";

import "./App.css";
import "./vfx.css";
import { AtlasSprite } from "./AtlasSprite";
import { REJECTION_TEXT, rejectionReason } from "./action-feedback";
import { TutorialStrip } from "./tutorial";
import { playSfx, setMuted } from "./audio";
import { flipTiming } from "./flip-speed";
import {
  loadCombatPreferences,
  saveCombatPreferences,
} from "./combat-preferences";
import type { CombatPreferences } from "./combat-preferences";
import { CombatPreferencesPanel } from "./combat-preferences-panel";
import { CombatHelp } from "./combat-support";
import {
  activateNextExecution,
  blockActiveExecution,
  cancelAutoTurnEnd,
  completeActiveExecution,
  createIdleAutoTurnEnd,
  finishAutoTurnEnd,
  pauseForExecutionChoice,
  resumeExecutionChoice,
} from "./auto-turn-end";
import type { AutoTurnEndState, ExecutionChoice } from "./auto-turn-end";
import { CardEffectRows, skillDisplayName } from "./card-effects";
import { CharacterSelect } from "./character-select";
import type { CharacterArt } from "./character-select";
import { RunMenu } from "./run-menu";
import { TitleScreen } from "./title-screen";
import type { TitleSaveSummary } from "./title-screen";
import { TutorialScreen } from "./tutorial-screen";
import { PassiveInventory } from "./passive-inventory";
import { TitleSettings } from "./title-settings";
import {
  autoSuggestCoinChoice,
  coinChoiceCandidates,
  coinChoiceCommand,
  requiresCoinChoiceSelection,
  toggleCoinChoice,
} from "./coin-choice";
import type { CoinChoiceSelection } from "./coin-choice";
import {
  equipmentChoiceCommand,
  equipmentChoiceOptions,
  requiresEquipmentChoice,
} from "./equipment-choice";
import { autoSuggestFuel, fuelCommand, fuelRequirement, requiresFuelSelection, toggleFuel } from "./fuel-selection";
import type { FuelSelection } from "./fuel-selection";
import {
  PRESERVE_SELECTION_INSTRUCTIONS,
  beginPreserveSelection,
  preserveSelectionCommand,
  togglePreservedCoin,
} from "./preserve-selection";
import type { PreserveSelection } from "./preserve-selection";
import { EmberIcon, HeartIcon, ShieldIcon, SkullIcon, SwordIcon } from "./icons";
import { coinNameFor, coinRewardDetailFor } from "./coin-info";
import { EventScreen } from "./event-screen";
import { NodeChoice } from "./node-choice";
import { ShopScreen } from "./shop-screen";
import { Keyword } from "./keywords";
import type { KeywordTerm } from "./keywords";
import { AnchoredOverlay, OverlayPortal } from "./overlay";
import { buildResolutionSummary, statusKo } from "./resolution-summary";
import { ResolutionTicket } from "./resolution-ticket";
import type { ResolutionSummary } from "./resolution-summary";
import { feedbackCuesFor } from "./feedback-cues";
import { sfxCuesFor } from "./combat-sfx";
import { cycleTarget, defaultTarget, legalTargetsForCommand, livingEnemyTargets } from "./targeting";
import type { TargetingCommand } from "./targeting";
import bgForest from "./assets/bg-forest.webp";
import frostKnightStanding from "./assets/characters/frost-knight.webp";
import arcanistStanding from "./assets/characters/arcanist.webp";
import sorcererStanding from "./assets/characters/sorcerer.webp";
import bloodSpellbladeStanding from "./assets/characters/blood-spellblade.webp";
import warriorStanding from "./assets/characters/warrior.webp";
import cardSlash from "./assets/card-slash.webp";
import cardJab from "./assets/card-jab.webp";
import cardFistGuard from "./assets/card-fist-guard.webp";
import cardBurningFist from "./assets/card-burning-fist.webp";
import cardFlameHook from "./assets/card-flame-hook.webp";
import cardEmberWeave from "./assets/card-ember-weave.webp";
import cardSecondWind from "./assets/card-second-wind.webp";
import cardFireFlurry from "./assets/card-fire-flurry.webp";
import cardBurnoutBlow from "./assets/card-burnout-blow.webp";
import cardOverheatStrike from "./assets/card-overheat-strike.webp";
import cardOverheatVent from "./assets/card-overheat-vent.webp";
import cardArcaneCharge from "./assets/card-arcane-charge.webp";
import cardArcaneCommand from "./assets/card-arcane-command.webp";
import cardAegisPulse from "./assets/card-aegis-pulse.webp";
import cardShieldSummon from "./assets/card-shield-summon.webp";
import cardMirrorPlate from "./assets/card-mirror-plate.webp";
import cardBulwarkCharge from "./assets/card-bulwark-charge.webp";
import cardWeaponTuning from "./assets/card-weapon-tuning.webp";
import cardTwinArmory from "./assets/card-twin-armory.webp";
// P7 신규 스킬 6종 — 프롬프트 킷 검증 + SID provenance (docs/ui/card-art-prompt-validation)
import cardInnerPassion from "./assets/card-inner-passion.webp";
import cardFireFist from "./assets/card-fire-fist.webp";
import cardCometBlow from "./assets/card-comet-blow.webp";
import cardBattleFocus from "./assets/card-battle-focus.webp";
import cardRegroup from "./assets/card-regroup.webp";
import cardArsenalBarrage from "./assets/card-arsenal-barrage.webp";
import cardGuard from "./assets/card-guard.webp";
import cardBurningStrike from "./assets/card-burning-strike.webp";
import cardIgnite from "./assets/card-ignite.webp";
import cardIgniteSword from "./assets/card-ignite-sword.webp";
import cardFlameRampage from "./assets/card-flame-rampage.webp";
import cardSmash from "./assets/card-smash.webp";
import cardFireInfusion from "./assets/card-fire-infusion.webp";
import cardFurnace from "./assets/card-furnace.webp";
import cardFlameSword from "./assets/card-flame-sword.webp";
import cardHeartOfFlame from "./assets/card-heart-of-flame.webp";
import cardConflagration from "./assets/card-conflagration.webp";
import cardSparkStrike from "./assets/card-spark-strike.webp";
import cardChainSurge from "./assets/card-chain-surge.webp";
import cardStaticField from "./assets/card-static-field.webp";
import cardVoltLash from "./assets/card-volt-lash.webp";
import cardOverload from "./assets/card-overload.webp";
import cardFrostSlash from "./assets/card-frost-slash.webp";
import cardGlacialWall from "./assets/card-glacial-wall.webp";
import cardChillingField from "./assets/card-chilling-field.webp";
import cardGlacierStrike from "./assets/card-glacier-strike.webp";
import goblinAtlas from "./assets/generated/sprites/goblin/sprite-sheet-alpha.png";
import goblinManifestJson from "./assets/generated/sprites/goblin/manifest.json";
import thiefAtlas from "./assets/generated/sprites/thief/sprite-sheet-alpha.png";
import thiefManifestJson from "./assets/generated/sprites/thief/manifest.json";
import ghoulAtlas from "./assets/generated/sprites/ghoul/sprite-sheet-alpha.png";
import ghoulManifestJson from "./assets/generated/sprites/ghoul/manifest.json";
import mageAtlas from "./assets/generated/sprites/mage/sprite-sheet-alpha.png";
import mageManifestJson from "./assets/generated/sprites/mage/manifest.json";
import slimeAtlas from "./assets/generated/sprites/slime/sprite-sheet-alpha.png";
import slimeManifestJson from "./assets/generated/sprites/slime/manifest.json";
import emberArchmageAtlas from "./assets/generated/sprites/ember-archmage/sprite-sheet-alpha.png";
import emberArchmageManifestJson from "./assets/generated/sprites/ember-archmage/manifest.json";
import gatekeeperAtlas from "./assets/generated/sprites/gatekeeper/sprite-sheet-alpha.png";
import gatekeeperManifestJson from "./assets/generated/sprites/gatekeeper/manifest.json";
import shamanAtlas from "./assets/generated/sprites/shaman/sprite-sheet-alpha.png";
import shamanManifestJson from "./assets/generated/sprites/shaman/manifest.json";
import warriorAtlas from "./assets/generated/sprites/warrior/sprite-sheet-alpha.png";
import warriorManifestJson from "./assets/generated/sprites/warrior/manifest.json";
import arcanistAtlas from "./assets/generated/sprites/arcanist/sprite-sheet-alpha.png";
import arcanistManifestJson from "./assets/generated/sprites/arcanist/manifest.json";
import sorcererAtlas from "./assets/generated/sprites/sorcerer/sprite-sheet-alpha.png";
import sorcererManifestJson from "./assets/generated/sprites/sorcerer/manifest.json";
import frostKnightAtlas from "./assets/generated/sprites/frost-knight/sprite-sheet-alpha.png";
import frostKnightManifestJson from "./assets/generated/sprites/frost-knight/manifest.json";
import bloodSpellbladeAtlas from "./assets/generated/sprites/blood-spellblade/sprite-sheet-alpha.png";
import bloodSpellbladeManifestJson from "./assets/generated/sprites/blood-spellblade/manifest.json";
import { spriteMotionForEvent } from "./sprite-motion";
import type { SpriteManifest } from "./AtlasSprite";
import {
  cardActionView,
  coinFacesAfterEvent,
  dropCommands,
  pileComposition,
  rewardViewStage,
  sameCommand,
  stepSequence,
} from "./interaction";
import type { CoinFaces, CoinPileGroup, CoinPileZone, DragSource } from "./interaction";
import { clearRun, loadRunDetailed, saveRun } from "./run-storage";
import {
  beginHumanCombat,
  createHumanRunTrace,
  downloadHumanRunTrace,
  finishHumanCombat,
  finishHumanRun,
  recordHumanDecision,
  recordHumanEventAction,
  recordHumanNodeChoice,
  recordHumanPassiveReward,
  recordHumanRestChoice,
  recordHumanTreasure,
  recordHumanReward,
  recordHumanShopAction,
} from "./telemetry";
import type { HumanRunTrace, HumanShopAction, RecordHumanRewardInput } from "./telemetry";
import { TurnBuffBar } from "./turn-buff";

const isInteractiveKeyTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest("button, [role='button'], input, select, textarea, a[href]") !== null;

// 생성 에셋 (docs/ui/combat-ui-v2.png 앵커 스타일 — image_gen 산출, 후처리: 크로마 키·리사이즈)
const CARD_ART: Record<string, string> = {
  jab: cardJab,
  "fist-guard": cardFistGuard,
  "burning-fist": cardBurningFist,
  "flame-hook": cardFlameHook,
  "ember-weave": cardEmberWeave,
  "second-wind": cardSecondWind,
  "fire-flurry": cardFireFlurry,
  "burnout-blow": cardBurnoutBlow,
  "overheat-strike": cardOverheatStrike,
  "overheat-vent": cardOverheatVent,
  "arcane-charge": cardArcaneCharge,
  "arcane-command": cardArcaneCommand,
  "aegis-pulse": cardAegisPulse,
  "shield-summon": cardShieldSummon,
  "mirror-plate": cardMirrorPlate,
  "bulwark-charge": cardBulwarkCharge,
  "weapon-tuning": cardWeaponTuning,
  "twin-armory": cardTwinArmory,
  "inner-passion": cardInnerPassion,
  "fire-fist": cardFireFist,
  "comet-blow": cardCometBlow,
  "battle-focus": cardBattleFocus,
  regroup: cardRegroup,
  "arsenal-barrage": cardArsenalBarrage,
  slash: cardSlash,
  guard: cardGuard,
  "burning-strike": cardBurningStrike,
  ignite: cardIgnite,
  "ignite-sword": cardIgniteSword,
  "flame-rampage": cardFlameRampage,
  smash: cardSmash,
  "fire-infusion": cardFireInfusion,
  furnace: cardFurnace,
  "flame-sword": cardFlameSword,
  "heart-of-flame": cardHeartOfFlame,
  conflagration: cardConflagration,
  "spark-strike": cardSparkStrike,
  "chain-surge": cardChainSurge,
  "static-field": cardStaticField,
  "volt-lash": cardVoltLash,
  overload: cardOverload,
  "ice-claw": cardFrostSlash,
  "ice-sleight": cardChillingField,
  "frost-mark": cardChillingField,
  "frost-fur-cloak": cardGlacialWall,
  "freezing-incision": cardGlacierStrike,
  "emergency-ice-pouch": cardGlacialWall,
  "freeze-dry": cardGlacierStrike,
  "preserved-pickpocket": cardFrostSlash,
  "hidden-inner-pocket": cardGlacialWall,
  "trackless-raid": cardFrostSlash,
  "loot-swap": cardChillingField,
  "subzero-perfect-crime": cardGlacierStrike,
};

const WORDS = ["BRAVE", "EMBER", "IRON", "MOSS", "RIVER", "DUSK", "SPARK", "VALE"];

interface SpriteAsset {
  atlasUrl: string;
  fallbackFor?: CharacterId;
  manifest: SpriteManifest;
}

const SPRITES: Record<
  | "player"
  | "sorcerer"
  | "frost-knight"
  | "blood-spellblade"
  | "arcanist"
  | "raider"
  | "shaman"
  | "gatekeeper"
  | "thief"
  | "ghoul"
  | "mage"
  | "slime"
  | "ember-archmage",
  SpriteAsset
> = {
  player: {
    atlasUrl: warriorAtlas,
    manifest: warriorManifestJson as SpriteManifest,
  },
  arcanist: {
    atlasUrl: arcanistAtlas,
    manifest: arcanistManifestJson as SpriteManifest,
  },
  sorcerer: {
    atlasUrl: sorcererAtlas,
    manifest: sorcererManifestJson as SpriteManifest,
  },
  "frost-knight": {
    atlasUrl: frostKnightAtlas,
    manifest: frostKnightManifestJson as SpriteManifest,
  },
  "blood-spellblade": {
    atlasUrl: bloodSpellbladeAtlas,
    manifest: bloodSpellbladeManifestJson as SpriteManifest,
  },
  raider: {
    atlasUrl: goblinAtlas,
    manifest: goblinManifestJson as SpriteManifest,
  },
  thief: {
    atlasUrl: thiefAtlas,
    manifest: thiefManifestJson as SpriteManifest,
  },
  ghoul: {
    atlasUrl: ghoulAtlas,
    manifest: ghoulManifestJson as SpriteManifest,
  },
  mage: {
    atlasUrl: mageAtlas,
    manifest: mageManifestJson as SpriteManifest,
  },
  slime: {
    atlasUrl: slimeAtlas,
    manifest: slimeManifestJson as SpriteManifest,
  },
  "ember-archmage": {
    atlasUrl: emberArchmageAtlas,
    manifest: emberArchmageManifestJson as SpriteManifest,
  },
  shaman: {
    atlasUrl: shamanAtlas,
    manifest: shamanManifestJson as SpriteManifest,
  },
  gatekeeper: {
    atlasUrl: gatekeeperAtlas,
    manifest: gatekeeperManifestJson as SpriteManifest,
  },
};

const enemySprite = (enemyId: string): SpriteAsset => {
  if (enemyId.startsWith("shaman")) return SPRITES.shaman;
  if (enemyId.startsWith("gatekeeper")) return SPRITES.gatekeeper;
  if (enemyId === "goblin") return SPRITES.raider; // goblin 아트 = 기존 raider 시각 정본
  if (enemyId === "thief") return SPRITES.thief;
  if (enemyId === "ghoul") return SPRITES.ghoul;
  if (enemyId === "mage") return SPRITES.mage;
  if (enemyId === "slime") return SPRITES.slime;
  if (enemyId === "ember-archmage") return SPRITES["ember-archmage"];
  return SPRITES.raider;
};

const playerSprite = (character: CharacterId): SpriteAsset => {
  if (String(character) === "arcanist") return SPRITES.arcanist;
  if (String(character) === "sorcerer") return SPRITES.sorcerer;
  if (String(character) === "frost-knight") return SPRITES["frost-knight"];
  if (String(character) === "blood-spellblade") return SPRITES["blood-spellblade"];
  return SPRITES.player;
};

const CHARACTER_STANDING_ART: Readonly<Record<string, string>> = {
  "frost-knight": frostKnightStanding,
  arcanist: arcanistStanding,
  sorcerer: sorcererStanding,
  "blood-spellblade": bloodSpellbladeStanding,
  warrior: warriorStanding,
};

const characterSelectArt = (character: CharacterId): CharacterArt => {
  const standing = CHARACTER_STANDING_ART[String(character)];
  if (standing !== undefined) return { kind: "standing", src: standing };
  return { kind: "sprite", ...playerSprite(character) };
};

type FloatText = {
  id: number;
  text: string;
  target: "player" | "enemy";
  enemy?: number;
  kind: "damage" | "block" | "status" | "coin";
};
type RejectionChip = { id: number; text: string };
type PendingResolution = {
  skillId: SkillId;
  events: CombatEvent[];
};
type CombatAction = { type: "set"; state: CombatState };
type TargetingSelection = {
  command: TargetingCommand;
  legalTargets: number[];
  selected: number;
};
type DecisionSource = "manual" | "auto-turn-end";
type ChoiceExecutionContext = {
  kind: ExecutionChoice;
  source: DecisionSource;
  token: string | null;
};
type DragState = {
  coin: CoinUid;
  source: DragSource;
  started: boolean;
  x: number;
  y: number;
  targets: Set<number>;
  swapTargets: Set<number>;
  over: number | null; // 합법 목적지 위일 때만
  overCoin: CoinUid | null;
  overCard: number | null; // 합법 여부와 무관하게 포인터 아래의 카드
  overTray: boolean;
};

const slot = (value: number): SlotId => value as SlotId;

const randomSeed = (): string =>
  Array.from({ length: 3 }, () => WORDS[Math.floor(Math.random() * WORDS.length)] ?? "EMBER").join("-") +
  `-${Math.floor(Math.random() * 90 + 10)}`;

const seedFromUrl = (): string => {
  const url = new URL(window.location.href);
  const existing = url.searchParams.get("seed");
  if (existing !== null && existing.trim().length > 0) return existing;
  const seed = randomSeed();
  url.searchParams.set("seed", seed);
  window.history.replaceState(null, "", url);
  return seed;
};

const combatReducer = (_state: CombatState, action: CombatAction): CombatState => {
  return action.state;
};

const enemyAttackDamage = (action: Extract<EnemyAction, { kind: "attack" }>, growthStacks = 0): number =>
  action.damagePerGrowthPercent === undefined
    ? action.damage + growthStacks
    : Math.round(action.damage * (1 + growthStacks * action.damagePerGrowthPercent));

export const enemyIntentDamageTotal = (enemies: readonly CombatState["enemies"][number][]): number =>
  enemies.reduce(
    (sum, enemy) =>
      sum +
      enemy.intent.actions.reduce(
        (intentSum, action) =>
          action.kind === "attack"
            ? intentSum + enemyAttackDamage(action, enemy.growthStacks) * (action.hits ?? 1)
            : action.kind === "conditionalAttack"
              ? intentSum + action.damage + action.bonusDamage + (enemy.growthStacks ?? 0)
              : intentSum,
        0,
      ),
    0,
  );

export const armorEchoPreview = (
  player: CombatState["player"],
  intentDamage: number,
): { absorbed: number; remainingBlock: number; precision: boolean; total: number } => {
  const absorbed = Math.min(player.block, intentDamage);
  const remainingBlock = Math.max(0, player.block - intentDamage);
  const precision =
    player.precisionDefenseSatisfied ||
    (player.precisionDefenseArmed && absorbed > 0 && remainingBlock <= 2);
  return {
    absorbed,
    remainingBlock,
    precision,
    total: Math.min(12, Math.min(absorbed, 6) + (absorbed > 0 ? player.echoPreheat : 0) + (precision ? 4 : 0)),
  };
};

/** Mirrors the post-return end-turn M12 check before placed coins are discarded. */
export const unusedElementalCoinCount = (state: CombatState): number => {
  const coinUids = new Set([...state.zones.hand, ...Object.values(state.zones.placed).flat()]);
  return [...coinUids].reduce((count, coinUid) => {
    const coin = state.coins[Number(coinUid)];
    return count + (coin !== undefined && effectiveElements(coin, contentDb).length > 0 ? 1 : 0);
  }, 0);
};

export const shouldShowArmorEchoHud = (character: CharacterId): boolean => String(character) === "arcanist";

export const shouldShowOverheatBadges = (character: CharacterId): boolean => String(character) === "warrior";

const enemyDisplayName = (enemy: CombatState["enemies"][number] | undefined): string =>
  enemy === undefined ? "아군" : (contentDb.enemies[String(enemy.defId)]?.name ?? "아군");

const enemyNameByDefId = (defId: string): string => contentDb.enemies[defId]?.name ?? defId;

export const IntentBadge = ({
  enemy,
  enemies = [],
  custody = [],
  coins = {},
}: {
  enemy: CombatState["enemies"][number];
  enemies?: readonly CombatState["enemies"][number][];
  custody?: CombatState["custody"];
  coins?: CombatState["coins"];
}) => {
  const windup = enemy.windup;
  const intent = windup?.intent ?? enemy.intent;
  const boundHealAlly = windup?.boundHealAlly ?? enemy.boundHealAlly;
  const boundHealAllyName = boundHealAlly === undefined ? undefined : enemyDisplayName(enemies[boundHealAlly]);
  const enemyDef = contentDb.enemies[String(enemy.defId)];
  const coinSeizure = enemy.coinSeizure;
  const repeatPressure = enemy.repeatSkillPressure;
  const royalTax = enemy.royalTaxPending;
  const royalVaultLabels = custody
    .filter((entry) => entry.kind === "royalVault" && entry.sourceEnemyUid === enemy.enemyUid)
    .sort((left, right) => left.seizureOrder - right.seizureOrder)
    .flatMap((entry) => entry.coins.map((coinUid) => {
      const coin = coins[Number(coinUid)];
      const element = entry.element ?? (coin === undefined ? "unknown" : String(contentDb.coins[String(coin.defId)]?.element ?? "basic"));
      return `${Number(coinUid)}:${elementKo(element)}`;
    }));
  const leadDecree = enemy.leadDecree;
  const hatch = enemy.hatch;
  const furnaceTemperature = enemy.furnaceTemperature;
  const furnaceMaxTemperature = enemy.furnaceMaxTemperature ?? 6;
  const windupCancelPredicates = intent.cancelOn === undefined
    ? []
    : Array.isArray(intent.cancelOn)
      ? intent.cancelOn
      : [intent.cancelOn];
  const furnaceCancelAt = windupCancelPredicates.find(
    (predicate) =>
      predicate.kind === "enemyResourceAtMost" &&
      predicate.resource === "furnaceTemperature",
  )?.value;
  const vaultRecoveryCancelAt = windupCancelPredicates.find(
    (predicate) => predicate.kind === "vaultCoinsRecovered",
  )?.count;
  const skillDamageCancelAt = windupCancelPredicates.find(
    (predicate) => predicate.kind === "skillDamage",
  )?.threshold;
  const repeatConfig = enemyDef?.repeatSkillPressure;
  const taxConfig = enemyDef?.royalTax;
  const repeatedSlot = repeatPressure?.triggeringSlot ?? -1;
  const executionIsImminent = repeatPressure !== undefined && repeatConfig !== undefined && repeatPressure.zeal >= repeatConfig.threshold;
  const executionDamage = repeatConfig?.executionIntent.actions.reduce(
    (total, action) => action.kind === "attack" ? total + enemyAttackDamage(action, enemy.growthStacks) * (action.hits ?? 1) : total,
    0,
  ) ?? 0;
  const executionCancelPredicates = repeatConfig?.executionIntent.cancelOn === undefined
    ? []
    : Array.isArray(repeatConfig.executionIntent.cancelOn)
      ? repeatConfig.executionIntent.cancelOn
      : [repeatConfig.executionIntent.cancelOn];
  const executionCancelThreshold = executionCancelPredicates.find(
    (predicate) => predicate.kind === "skillDamage",
  )?.threshold;
  const executionSealTurns = repeatConfig?.executionIntent.actions.find(
    (action): action is Extract<EnemyAction, { kind: "sealTriggeredSkill" }> => action.kind === "sealTriggeredSkill",
  )?.turns;
  const taxDenomination = taxConfig?.denomination ?? royalTax?.paid ?? 0;
  const taxStatus = royalTax === undefined ? null : royalTax.paid === 0 ? "납부 대기" : royalTax.paid < taxDenomination ? "납부 진행 중" : "납부 완료";
  const growthLabel = enemyDef?.growthLabel ?? "성장";
  return (
    <div aria-label="다음 행동 의도" className="intent">
      {windup !== undefined ? (
        <>
          <Keyword term="windup">
            <span aria-label={`준비 ${windup.turnsLeft}턴 남음`}>준비 {windup.turnsLeft}턴</span>
          </Keyword>
          {windup.cancelThreshold !== undefined ? (
            <Keyword term="windup">
              <span aria-label={`${windup.cancelThreshold} 피해로 취소`}>
                {windup.cancelThreshold} 피해로 취소
              </span>
            </Keyword>
          ) : null}
          {furnaceCancelAt !== undefined ? (
            <Keyword term="windup">
              <span
                aria-label={`용광로 ${furnaceCancelAt} 이하 시 취소`}
                data-testid="enemy-furnace-cancel-condition"
              >
                용광로 {furnaceCancelAt} 이하 시 취소
              </span>
            </Keyword>
          ) : null}
          {vaultRecoveryCancelAt !== undefined ? (
            <Keyword term="windup">
              <span
                aria-label={`금고 동전 ${vaultRecoveryCancelAt}개 회수 시 취소`}
                data-testid="royal-vault-cancel-recovery-condition"
              >
                금고 동전 {vaultRecoveryCancelAt}개 회수 시 취소
              </span>
            </Keyword>
          ) : null}
          {skillDamageCancelAt !== undefined ? (
            <Keyword term="windup">
              <span
                aria-label={`스킬 실제 피해 ${skillDamageCancelAt} 시 취소`}
                data-testid="royal-vault-cancel-damage-condition"
              >
                스킬 실제 피해 {skillDamageCancelAt} 시 취소
              </span>
            </Keyword>
          ) : null}
          {intent.vulnerableWhileWindup !== undefined ? (
            <Keyword term="vulnerable">
              <span aria-label={`준비 중 취약 배수 ${intent.vulnerableWhileWindup}배`}>
                취약 ×{intent.vulnerableWhileWindup}
              </span>
            </Keyword>
          ) : null}
        </>
      ) : null}
      {hatch !== undefined ? (
        <span
          aria-label={`부화 ${hatch.turnsRemaining}턴 남음${hatch.delayed ? ", 지연됨" : ""}`}
          data-testid="enemy-hatch-status"
        >
          부화 {hatch.turnsRemaining}턴{hatch.delayed ? " · 지연" : ""}
        </span>
      ) : null}
      {furnaceTemperature !== undefined ? (
        <span
          aria-label={`용광로 온도 ${furnaceTemperature}/${furnaceMaxTemperature}`}
          data-testid="enemy-furnace-status"
        >
          용광로 {furnaceTemperature}/{furnaceMaxTemperature}
        </span>
      ) : null}
      {enemy.summonSick === true ? (
        <span aria-label="소환 직후: 이번 적 턴에는 행동하지 않음" data-testid="enemy-summon-sick-status">
          소환 직후 · 행동 대기
        </span>
      ) : null}
      {coinSeizure !== undefined ? (
        <span
          aria-label={`동전 압수 예고: ${elementKo(coinSeizure.element)} 속성 ${Math.min(2, coinSeizure.cap, coinSeizure.nominated.length)}개, 예고 시 손패 ${coinSeizure.handCountAtTelegraph}개 기준으로 지정`}
          data-testid="coin-seizure-telegraph"
        >
          압수 예고 · {elementKo(coinSeizure.element)} {Math.min(2, coinSeizure.cap, coinSeizure.nominated.length)}개
        </span>
      ) : null}
      {repeatPressure !== undefined ? (
        <span aria-label={`열의 Zeal ${repeatPressure.zeal}/${repeatConfig?.threshold ?? repeatPressure.zeal}, 반복 사용 시 누적`} data-testid="repeat-skill-zeal">
          열의 {repeatPressure.zeal}/{repeatConfig?.threshold ?? repeatPressure.zeal}
        </span>
      ) : null}
      {executionIsImminent ? (
        <span
          aria-label={`집행 예고: 열의 ${repeatPressure.zeal}/${repeatConfig.threshold}, 피해 ${executionDamage}, ${executionCancelThreshold === undefined ? "취소 조건 없음" : `실제 체력 피해 ${executionCancelThreshold}로 취소`}${executionSealTurns === undefined ? "" : `, ${repeatedSlot >= 0 ? `스킬 ${repeatedSlot + 1}` : "반복 사용 스킬"} ${executionSealTurns}턴 봉인`}`}
          data-testid="repeat-skill-execution-preconfirm"
        >
          집행 예고 · 피해 {executionDamage}{executionCancelThreshold === undefined ? "" : ` · 실제 체력 피해 ${executionCancelThreshold}로 취소`}{executionSealTurns === undefined ? "" : ` · ${repeatedSlot >= 0 ? `스킬 ${repeatedSlot + 1}` : "반복 사용 스킬"} ${executionSealTurns}턴 봉인`}
        </span>
      ) : null}
      {royalTax !== undefined ? (
        <span aria-label={`왕실 세금: ${elementKo(royalTax.element)} ${royalTax.paid}/${taxDenomination}, ${royalTax.deadlineTurn}턴 마감, ${taxStatus}`} data-testid="royal-tax-demand">
          왕실 세금 · {elementKo(royalTax.element)} {royalTax.paid}/{taxDenomination} · {royalTax.deadlineTurn}턴 마감 · {taxStatus}
        </span>
      ) : null}
      {enemyDef?.royalVault !== undefined ? (
        <span
          aria-label={`왕실 금고 ${royalVaultLabels.length}/${enemyDef.royalVault.capacity}: ${royalVaultLabels.join(", ") || "비어 있음"}`}
          data-testid="royal-vault-status"
        >
          왕실 금고 {royalVaultLabels.length}/{enemyDef.royalVault.capacity} · {royalVaultLabels.join(", ") || "비어 있음"}
        </span>
      ) : null}
      {enemy.royalVaultSeizure !== undefined ? (
        <span
          aria-label={`왕실 금고 압류 대상: ${enemy.royalVaultSeizure.nominated.map(Number).join(", ")}`}
          data-testid="royal-vault-seizure-nominations"
        >
          압류 대상 · {enemy.royalVaultSeizure.nominated.map(Number).join(", ")}
        </span>
      ) : null}
      {leadDecree !== undefined ? (
        <span
          aria-label={`납화폐 칙령: ${leadDecree.remaining}/${leadDecree.initial}, 약화 ${leadDecree.weakenedTotal}`}
          data-testid="lead-decree-status"
        >
          납화폐 칙령 · {leadDecree.remaining}/{leadDecree.initial} · 약화 {leadDecree.weakenedTotal}
        </span>
      ) : null}
      {intent.entersPetrify === true && enemyDef?.petrify !== undefined ? (
        <span
          aria-label={`석화 진입: 피해 감소 ${Math.round(enemyDef.petrify.damageReduction * 100)}%, 감소 전 피해 ${Math.round(enemyDef.petrify.shatterRawDamageFraction * 100)}% 누적 시 낙하 강습 취소`}
          data-testid="petrify-intent"
        >
          석화 {Math.round(enemyDef.petrify.damageReduction * 100)}% · 원피해 {Math.round(enemyDef.petrify.shatterRawDamageFraction * 100)}%로 파쇄
        </span>
      ) : null}
      {intent.groupMarch === true && enemyDef?.warBanner !== undefined ? (
        <span
          aria-label={`왕가의 진군: 모든 적 공격력 ${Math.round(enemyDef.warBanner.march.attackPercent * 100)}% 증가 ${enemyDef.warBanner.march.turns}턴, 최대 체력 ${Math.round(enemyDef.warBanner.march.shieldMaxHpFraction * 100)}% 보호막`}
          data-testid="royal-march-intent"
        >
          진군 · 전체 +{Math.round(enemyDef.warBanner.march.attackPercent * 100)}% {enemyDef.warBanner.march.turns}턴 · 방패 {Math.round(enemyDef.warBanner.march.shieldMaxHpFraction * 100)}%
        </span>
      ) : null}
      {intent.actions.map((action, index) =>
        action.kind === "attack" ? (
          <span key={index}>
            <SwordIcon scale={1.6} />
            {action.hits !== undefined && action.hits > 1
              ? `${enemyAttackDamage(action, enemy.growthStacks)}×${action.hits}`
              : enemyAttackDamage(action, enemy.growthStacks)}
          </span>
        ) : action.kind === "block" ? (
          <span key={index}>
            <ShieldIcon scale={1.6} tone="steel" />
            {action.amount}
          </span>
        ) : action.kind === "applyStatus" ? (
          <span
            key={index}
            aria-label={`${statusKo(action.status)} ${action.stacks} 부여${action.requiresLastAttackHpDamage || action.requiresPlayerStatus !== undefined ? `, ${[
              action.requiresLastAttackHpDamage ? "실제 체력 피해 시" : null,
              action.requiresPlayerStatus === undefined
                ? null
                : `${statusKo(action.requiresPlayerStatus.status)} ${action.requiresPlayerStatus.atLeast} 이상 시`,
            ].filter((condition): condition is string => condition !== null).join(", ")}` : ""}`}
          >
            <Keyword term={action.status as KeywordTerm}>
              {statusKo(action.status)} {action.stacks}
              {action.requiresLastAttackHpDamage || action.requiresPlayerStatus !== undefined
                ? ` (${[
                    action.requiresLastAttackHpDamage ? "실제 체력 피해 시" : null,
                    action.requiresPlayerStatus === undefined
                      ? null
                      : `${statusKo(action.requiresPlayerStatus.status)} ${action.requiresPlayerStatus.atLeast} 이상 시`,
                  ].filter((condition): condition is string => condition !== null).join(", ")})`
                : ""}
            </Keyword>
          </span>
        ) : action.kind === "heal" ? (
          <span key={index} aria-label={`자가 회복 ${action.amount}`}>
            회복 {action.amount}
          </span>
        ) : action.kind === "buffNextAttack" ? (
          // 충전 타입 없음(사용자 확정) — 버프 의도로 표시, 강공 예고는 패턴 순서가 담당
          <span key={index} aria-label={`버프: 다음 공격 +${action.amount}`}>
            <Keyword term="attack-buff">↑ 공격 +{action.amount}</Keyword>
          </span>
        ) : action.kind === "nextDrawPenalty" ? (
          <span key={index} aria-label={`다음 드로우 ${action.amount} 감소`}>
            <Keyword term="wither">위축 -{action.amount}</Keyword>
          </span>
        ) : action.kind === "conditionalAttack" ? (
          <span key={index} aria-label={`조건부 공격 ${action.damage}+${action.bonusDamage}`}>
            <SwordIcon scale={1.6} />
            {action.damage}+{action.bonusDamage}
          </span>
        ) : action.kind === "seizeCustody" ? (
          <span key={index} aria-label="예고한 동전을 압수하고 전투 중 보관합니다" data-testid="coin-seizure-intent">
            동전 압수
          </span>
        ) : action.kind === "sealRecentSkill" ? (
          <span key={index} aria-label="최근 반복 사용한 스킬을 봉인합니다" data-testid="skill-seal-intent">
            최근 스킬 봉인
          </span>
        ) : action.kind === "sealTriggeredSkill" ? (
          <span key={index} aria-label={`반복 사용한 정확한 스킬 슬롯을 ${action.turns}턴 봉인합니다`} data-testid="repeat-skill-seal-intent">
            반복 스킬 봉인 · {action.turns}턴
          </span>
        ) : action.kind === "resetRepeatSkillPressure" ? (
          <span key={index} aria-label="열의 누적을 초기화합니다" data-testid="repeat-skill-zeal-reset-intent">
            열의 초기화
          </span>
        ) : action.kind === "royalTax" ? (
          <span key={index} aria-label={`왕실 세금: 가능한 속성 동전 ${taxConfig?.denomination ?? 0}개를 다음 플레이어 턴 종료 전까지 납부, 불가하면 피해 ${action.degradedDamage}`} data-testid="royal-tax-intent">
            왕실 세금 · 동전 {taxConfig?.denomination ?? 0}개 납부 · 불가 시 피해 {action.degradedDamage}
          </span>
        ) : action.kind === "resetRoyalTaxDefaults" ? (
          <span key={index} aria-label="왕실 세금 체납 누적을 초기화합니다" data-testid="royal-tax-reset-intent">
            체납 누적 초기화
          </span>
        ) : action.kind === "royalVaultForeclose" ? (
          <span key={index} aria-label="왕실 금고 압류: 공개된 손패 동전 1개를 금고에 보관합니다" data-testid="royal-vault-foreclose-intent">
            왕실 금고 압류 · 손패 1개
          </span>
        ) : action.kind === "royalVaultExactSeizure" ? (
          <span key={index} aria-label={`왕실 금고 정확 압류: 지정된 손패 동전 최대 ${action.maxCoins}개`} data-testid="royal-vault-exact-seizure-intent">
            정확 압류 · 최대 {action.maxCoins}개
          </span>
        ) : action.kind === "royalVaultBarrier" ? (
          <span key={index} aria-label={`왕실 금고 방벽: 보관 동전 1개당 방어 ${action.blockPerStoredCoin}, 최대 18`} data-testid="royal-vault-barrier-intent">
            금고 방벽 · 동전당 방어 {action.blockPerStoredCoin} · 최대 18
          </span>
        ) : action.kind === "leadDecree" ? (
          <span key={index} aria-label="납화폐 칙령: 다음 생성 속성 동전 3개를 납화폐로 바꿉니다" data-testid="lead-decree-intent">
            납화폐 칙령 · 다음 속성 동전 3개
          </span>
        ) : action.kind === "returnOldestRoyalVaultCoin" ? (
          <span key={index} aria-label="왕실 금고에서 가장 오래된 동전 1개를 반환합니다" data-testid="royal-vault-return-intent">
            금고 동전 반환
          </span>
        ) : action.kind === "clearLeadCoins" ? (
          <span key={index} aria-label="남은 납화폐를 해제합니다" data-testid="lead-decree-clear-intent">
            납화폐 해제
          </span>
        ) : action.kind === "createCounterfeit" ? (
          <span key={index} aria-label={`위조 동전 ${action.count}개를 추가합니다`} data-testid="royal-vault-counterfeit-intent">
            위조 동전 {action.count}개
          </span>
        ) : action.kind === "removeCounterfeits" ? (
          <span key={index} aria-label={`위조 동전 ${action.count}개를 제거합니다`} data-testid="royal-vault-counterfeit-remove-intent">
            위조 동전 {action.count}개 제거
          </span>
        ) : action.kind === "growOnUnblockedDamage" ? (
          <span
            key={index}
            aria-label={`${growthLabel} ${action.amount}${action.minHpDamageFraction === undefined ? "" : `, 실제 피해 비율 ${action.minHpDamageFraction * 100}% 초과 시`}`}
          >
            {growthLabel} +{action.amount}
            {action.maxStacks === undefined ? "" : `/${action.maxStacks}`}
          </span>
        ) : action.kind === "healAlly" ? (
          <span
            key={index}
            aria-label={
              boundHealAllyName === undefined
                ? `아군 회복 ${action.amount}`
                : `아군 회복 ${action.amount}, 대상 ${boundHealAllyName}`
            }
          >
            회복 {action.amount}
            {boundHealAllyName === undefined ? "" : ` → ${boundHealAllyName}`}
            {action.cleanse === undefined ? "" : ` · 정화 ${action.cleanse}`}
          </span>
        ) : action.kind === "summonEnemies" ? (
          <span
            key={index}
            aria-label={`${enemyNameByDefId(String(action.enemy))}을 최대 ${action.maxCount}마리 소환`}
            data-testid="enemy-summon-intent"
          >
            소환 · {enemyNameByDefId(String(action.enemy))} 최대 {action.maxCount}마리
          </span>
        ) : action.kind === "tickHatch" ? (
          <span key={index} aria-label={`부화 진행, ${hatch?.turnsRemaining ?? "?"}턴 남음`} data-testid="enemy-hatch-intent">
            부화 진행 · {hatch?.turnsRemaining ?? "?"}턴
          </span>
        ) : action.kind === "accelerateHatching" ? (
          <span key={index} aria-label={`아군 알 부화 ${action.amount}턴 가속`} data-testid="enemy-hatch-accelerate-intent">
            부화 가속 · {action.amount}턴
          </span>
        ) : action.kind === "setEnemyResource" ? (
          <span
            key={index}
            aria-label={`용광로 온도를 ${action.value}로 설정`}
            data-testid="enemy-furnace-intent"
          >
            용광로 {action.value}
          </span>
        ) : action.kind === "adjustEnemyResource" ? (
          <span
            key={index}
            aria-label={`용광로 온도 ${action.amount >= 0 ? "+" : ""}${action.amount}`}
            data-testid="enemy-furnace-intent"
          >
            용광로 {action.amount >= 0 ? "+" : ""}{action.amount}
          </span>
        ) : action.kind === "removePlayerStatus" ? (
          <span key={index}>
            {statusKo(action.status)} 제거 {action.stacks}
          </span>
        ) : action.kind === "reduceGrowthStacks" ? (
          <span key={index}>성장 감소 {action.amount}</span>
        ) : (
          (() => {
            const exhaustive: never = action;
            return exhaustive;
          })()
        ),
      )}
    </div>
  );
};

const ELEMENT_KO: Record<string, string> = {
  fire: "화염",
  mana: "마나",
  frost: "냉기",
  lightning: "전기",
  blood: "혈액",
};
const elementKo = (value: string): string => ELEMENT_KO[value] ?? value;

const REMISE_MAX_STACKS = 3;

const faceKo = (face: Face): string => (face === "heads" ? "앞" : "뒤");

const clampRemiseCharges = (charges: number): number => Math.min(Math.max(charges, 0), REMISE_MAX_STACKS);

export const shouldShowRemiseSpendBadge = (
  skill: SkillDef | undefined,
  loaded: number,
  remiseCharges: number,
  isSorcerer: boolean,
): boolean =>
  isSorcerer &&
  remiseCharges > 0 &&
  skill?.type === "flip" &&
  skill.tags.includes("attack") &&
  loaded >= skill.cost;

export const RemiseStackChip = ({ charges }: { charges: number }): JSX.Element => {
  const safeCharges = clampRemiseCharges(charges);
  return (
    <em aria-label={`르미즈 스택 ${safeCharges}/${REMISE_MAX_STACKS}`} className="passive-chip">
      르미즈 {safeCharges}/{REMISE_MAX_STACKS}
    </em>
  );
};

export const SkillSealBadges = ({
  seals,
}: {
  seals: readonly { slot: number; name: string; turns: number; effectMultiplier?: number }[];
}): JSX.Element | null => {
  if (seals.length === 0) return null;
  return (
    <span aria-label="스킬 봉인 및 효과 감소 상태" className="skill-seal-badges">
      {seals.map((seal) => {
        const multiplier = seal.effectMultiplier;
        const reduced = multiplier !== undefined;
        const label = reduced ? `효과 ${Math.round(multiplier * 100)}%` : "봉인";
        return (
          <em
            aria-label={`${seal.name} ${label}, 남은 플레이어 턴 ${seal.turns}`}
            className={`skill-seal-chip ${reduced ? "reduced" : "sealed"}`}
            data-testid={`skill-seal-status-${seal.slot}`}
            key={seal.slot}
          >
            {label} · {seal.name} · {seal.turns}턴
          </em>
        );
      })}
    </span>
  );
};

export const RemiseSpendBadge = ({
  displaySkillName,
  isSorcerer,
  loaded,
  remiseCharges,
  shifted = false,
  skill,
  testId,
}: {
  displaySkillName: string;
  isSorcerer: boolean;
  loaded: number;
  remiseCharges: number;
  shifted?: boolean;
  skill: SkillDef | undefined;
  testId?: string;
}): JSX.Element | null =>
  shouldShowRemiseSpendBadge(skill, loaded, remiseCharges, isSorcerer) ? (
    <span
      aria-label={`${displaySkillName} 르미즈 1 소비 예정, 현재 ${clampRemiseCharges(remiseCharges)}/${REMISE_MAX_STACKS}`}
      className="once-badge"
      data-testid={testId}
      style={shifted ? { top: 43 } : undefined}
      title="르미즈 — 첫 면이 앞이면 이 공격 스킬을 한 번 반복"
    >
      르미즈 1 소비 예정
    </span>
  ) : null;

const remiseResolutionLines = (events: readonly CombatEvent[]): string[] =>
  events.flatMap((event) => {
    if (event.type === "remiseGained" && event.amount > 0)
      return [`르미즈 +${event.amount} — 스택 ${clampRemiseCharges(event.total)}/${REMISE_MAX_STACKS}`];
    if (event.type === "remiseSpent")
      return [
        `르미즈 ${event.repeat ? "성공" : "불발"} — 첫 면 ${faceKo(event.firstFace)}, 잔여 ${clampRemiseCharges(event.remaining)}/${REMISE_MAX_STACKS}`,
      ];
    if (event.type === "remiseRepeatResolved") return ["르미즈 반복 해결"];
    return [];
  });

const furnaceReasonKo = (
  reason: Extract<CombatEvent, { type: "enemyFurnaceChanged" }>["reason"],
): string => {
  switch (reason) {
    case "enemyActionResolved":
      return "적 행동";
    case "playerBurnDamaged":
      return "화상 피해";
    case "playerBurnCleared":
      return "화상 제거";
    case "playerDamageThreshold":
      return "피해 임계치";
    case "phaseEntered":
      return "페이즈 진입";
    case "coronationCancelled":
      return "대관식 취소";
    case "coronationResolved":
      return "대관식 해결";
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
};

const combatEventResolutionLines = (events: readonly CombatEvent[]): string[] =>
  events.flatMap((event) => {
    if (event.type === "enemySummonTelegraphed")
      return [`적 ${event.sourceEnemyUid} 소환 예고 · ${enemyNameByDefId(event.enemy)} 최대 ${event.maxCount}마리`];
    if (event.type === "enemySummoned")
      return [`적 ${event.sourceEnemyUid} 소환 완료 · ${enemyNameByDefId(event.enemy)} ${event.slot + 1}번 자리 (UID ${event.enemyUid})`];
    if (event.type === "enemySummonFailed")
      return [`적 ${event.sourceEnemyUid} 소환 실패 · ${enemyNameByDefId(event.enemy)} 최대 ${event.maxCount}마리`];
    if (event.type === "enemyRemoved") return [`적 UID ${event.enemyUid} 제거 · 처치`];
    if (event.type === "enemyHatchDelayed") return [`적 ${event.sourceEnemyUid} 부화 지연 · 1턴 연기`];
    if (event.type === "enemyHatchAccelerated")
      return [`적 ${event.sourceEnemyUid} 부화 가속 · 대상 UID ${event.targetEnemyUid}, ${event.amount}턴 단축`];
    if (event.type === "enemyHatched") return [`적 ${event.sourceEnemyUid} 부화 완료 · ${enemyNameByDefId(event.into)}`];
    if (event.type === "repeatSkillZealChanged")
      return [`적 ${event.sourceEnemy + 1} 열의 · 반복 스킬 ${String(event.skill)} ${event.zeal}/${event.maxZeal}`];
    if (event.type === "repeatSkillZealReset") return [`적 ${event.sourceEnemy + 1} 열의 초기화`];
    if (event.type === "royalTaxOpened")
      return [`적 ${event.sourceEnemy + 1} 왕실 세금 시작 · ${elementKo(event.element)} 0/${event.denomination}, ${event.deadlineTurn}턴 마감`];
    if (event.type === "royalTaxPaymentProgressed")
      return [`적 ${event.sourceEnemy + 1} 왕실 세금 납부 · ${elementKo(event.element)} ${event.paid}/${event.denomination}`];
    if (event.type === "royalTaxPaid")
      return [`적 ${event.sourceEnemy + 1} 왕실 세금 납부 완료 · ${elementKo(event.element)} ${event.paid}/${event.denomination}`];
    if (event.type === "royalTaxDefaulted")
      return [`적 ${event.sourceEnemy + 1} 왕실 세금 체납 · ${elementKo(event.element)} ${event.paid}/${event.denomination}, 위조 동전 ${event.counterfeits.length}개, 방어도 +${event.shield}, 체납 ${event.defaultStreak}회`];
    if (event.type === "royalTaxSeizureScheduled")
      return [`적 ${event.sourceEnemy + 1} 체납 압수 예고 · ${event.intent.windup?.turns ?? 0}턴 후 압수 실행`];
    if (event.type === "royalVaultForeclosed")
      return [`적 ${event.sourceEnemy + 1} 왕실 금고 압류 예고 · ${elementKo(event.element)} ${event.nominated.map(Number).join(", ")} · 금고 ${event.capacity}칸`];
    if (event.type === "royalVaultSeized")
      return [`적 ${event.sourceEnemy + 1} 왕실 금고 압류 · ${event.elements.map(({ coin, element }) => `${Number(coin)}:${elementKo(element)}`).join(", ")} · ${event.before}→${event.after}`];
    if (event.type === "royalVaultReturned")
      return [`적 ${event.sourceEnemy + 1} 왕실 금고 반환 · ${Number(event.coin)} · ${event.before}→${event.after} · ${event.reason}`];
    if (event.type === "royalVaultRecoveryProgressed")
      return [`적 ${event.sourceEnemy + 1} 왕실 금고 회수 · ${event.recovered}${event.required === undefined ? "" : `/${event.required}`}`];
    if (event.type === "leadDecreeStarted")
      return [`적 ${event.sourceEnemy + 1} 납화폐 칙령 · ${event.initial}개 · 남음 ${event.remaining}`];
    if (event.type === "leadDecreeWeakened")
      return [`적 ${event.sourceEnemy + 1} 납화폐 칙령 약화 · ${event.before}→${event.after} · ${event.reason}`];
    if (event.type === "leadCoinTransformed")
      return [`납화폐 변질 · ${Number(event.coin)} · ${event.before}→${event.after}`];
    if (event.type === "leadCoinsCleared")
      return [`납화폐 해제 · ${event.coins.map(Number).join(", ") || "없음"}`];
    if (event.type === "counterfeitExhausted") return [`위조 동전 ${Number(event.coin)} 소진 · 손패에 들어오지 않고 제거`];
    if (event.type === "counterfeitsRemoved") return [`위조 동전 ${event.coins.length}개 전투 종료로 제거`];
    if (event.type === "coinSeizureTelegraphed")
      return [
        `적 ${event.sourceEnemy + 1} 압수 예고 · ${elementKo(event.element)} ${Math.min(2, event.cap, event.nominated.length)}개 (예고 시 손패 ${event.handCountAtTelegraph}개)`,
      ];
    if (event.type === "coinsSeized")
      return [
        `적 ${event.sourceEnemy + 1} 동전 ${event.coins.length}개 압수 · 처치 또는 전투 종료 시 버린 더미로 반환`,
      ];
    if (event.type === "coinsReturned")
      return [`적 ${event.sourceEnemy + 1} 압수 동전 ${event.coins.length}개를 버린 더미로 반환`];
    if (event.type === "skillSealed")
      return [`스킬 ${Number(event.slot) + 1} 봉인 · 남은 플레이어 턴 ${event.turns}`];
    if (event.type === "skillSealFallbackReduced")
      return [
        `스킬 ${Number(event.slot) + 1} 효과 ${Math.round(event.multiplier * 100)}%로 감소 · 남은 플레이어 턴 ${event.turns}`,
      ];
    if (event.type === "placedCoinsReturned")
      return [`스킬 ${Number(event.slot) + 1} 장착 동전 ${event.coins.length}개 반환 · 봉인으로 사용 취소`];
    if (event.type === "skillSealRepeatStruck") return [`적 ${event.sourceEnemy + 1} 봉인 반복 시전 · 피해 ${event.damage}`];
    if (event.type === "overheatScheduled") return ["과열 예약 — 다음 플레이어 턴 과열 예정"];
    if (event.type === "overheatActivated") return ["과열 활성 — 예약된 과열 시작"];
    if (event.type === "echoComputed")
      return [
        `갑주 반향 계산 — 기본 ${event.base}, 예열 ${event.preheat}, 정밀 ${event.precision}, 총 ${event.total}`,
      ];
    if (event.type === "echoSpent") return [`반향 증폭 — +${event.amount}`];
    if (event.type === "bloodCoinFizzle") return ["혈액 코인 불발 — 체력이 부족합니다"];
    if (event.type === "healPrevented") return [`회복 봉인 — 회복 ${event.amount} 무효`];
    if (event.type === "enemyWindupStarted" && event.intent.actions.some((action) => action.kind === "resetRepeatSkillPressure"))
      return [`적 ${event.enemy + 1} 반복 집행 예고 · ${event.turnsLeft}턴 후 실행${event.cancelThreshold === undefined ? "" : `, 실제 체력 피해 ${event.cancelThreshold}로 취소`}`];
    if (event.type === "enemyWindupTicked" && event.intent.actions.some((action) => action.kind === "resetRepeatSkillPressure"))
      return [event.turnsLeft > 0 ? `적 ${event.enemy + 1} 반복 집행 준비 · ${event.turnsLeft}턴 남음` : `적 ${event.enemy + 1} 반복 집행 해결`];
    if (event.type === "enemyWindupCancelled" && event.intent.actions.some((action) => action.kind === "resetRepeatSkillPressure"))
      return [`적 ${event.enemy + 1} 반복 집행 취소`];
    if (event.type === "enemyWindupStarted")
      return [
        `적 ${event.enemy + 1} 준비 시작 — ${event.turnsLeft}턴 남음${event.cancelThreshold === undefined ? "" : `, ${event.cancelThreshold} 피해로 취소`}`,
      ];
    if (event.type === "enemyWindupTicked") return [`적 ${event.enemy + 1} 준비 카운트 — ${event.turnsLeft}턴 남음`];
    if (event.type === "enemyWindupCancelled") return [`적 ${event.enemy + 1} 준비 취소`];
    if (event.type === "enemyFurnaceChanged") {
      return [`적 ${event.enemy + 1} 용광로 온도 ${event.before}→${event.after} — ${furnaceReasonKo(event.reason)}`];
    }
    if (event.type === "enemyPhaseChanged") return [`적 ${event.enemy + 1} 페이즈 전환`];
    if (event.type === "enemyGrew") return [`적 ${event.enemy + 1} 성장 — 스택 ${event.stacks}`];
    if (event.type === "enemyGrowthReduced")
      return [`적 ${event.enemy + 1} 나이테 ${event.removed}개 파괴 — 실제 피해 ${event.damage}/${event.threshold}`];
    if (event.type === "playerTurnEndPunished")
      return [
        `적 ${event.enemy + 1} 미사용 속성 코인 경고 — ${event.coinCount}/${event.threshold}, ${statusKo(event.status)} +${event.stacks}`,
      ];
    if (event.type === "enemyCleansed")
      return [`적 ${event.enemy + 1} 정화 — ${event.statuses.map(statusKo).join("·")} 제거`];
    if (event.type === "enemyHealFailed") return [`적 ${event.enemy + 1} 치유 실패 — 대상 ${event.target + 1}`];
    return [];
  });

const withCombatEventResolutionLines = (
  summary: ResolutionSummary,
  events: readonly CombatEvent[],
): ResolutionSummary => {
  const lines = [...remiseResolutionLines(events), ...combatEventResolutionLines(events)];
  if (lines.length === 0) return summary;
  const spent = events.reduce<Extract<CombatEvent, { type: "remiseSpent" }> | undefined>(
    (latest, event) => (event.type === "remiseSpent" ? event : latest),
    undefined,
  );
  return {
    ...summary,
    triggerLines: [...summary.triggerLines, ...lines],
    totalLine:
      spent === undefined
        ? `${summary.totalLine} · ${lines.join(" · ")}`
        : `${summary.totalLine} · 르미즈 ${spent.repeat ? "성공" : "불발"}(잔여 ${clampRemiseCharges(spent.remaining)}) · ${lines.join(" · ")}`,
  };
};

const coinLabel = (state: CombatState, coin: CoinUid): string => {
  const instance = state.coins[Number(coin)];
  const def = instance === undefined ? undefined : contentDb.coins[String(instance.defId)];
  const enchant = instance?.permanent ? contentDb.enchants?.[String(instance.enchant)] : undefined;
  const granted = instance?.grants.includes("fire") === true && def?.element !== "fire";
  const base = granted
    ? "기본+화염"
    : def?.element !== null && def?.element !== undefined
      ? elementKo(def.element)
      : "기본";
  const label = instance?.preserved === true ? `${base}·보존` : base;
  return enchant === undefined ? label : `${label} · ${enchant.name}`;
};

const coinVisualClasses = (state: CombatState, coin: CoinUid): string => {
  const instance = state.coins[Number(coin)];
  const def = instance === undefined ? undefined : contentDb.coins[String(instance.defId)];
  return [
    def?.element === "fire" ? "fire" : "",
    def?.element === "mana" ? "mana" : "",
    def?.element === "frost" ? "frost" : "",
    def?.element === "lightning" ? "lightning" : "",
    instance?.grants.includes("fire") === true && def?.element !== "fire" ? "granted-fire" : "",
    instance?.permanent === false ? "temporary" : "",
    instance?.preserved === true ? "preserved" : "",
  ]
    .filter(Boolean)
    .join(" ");
};

const PILE_COPY: Record<CoinPileZone, { label: string; title: string; rule: string; empty: string }> = {
  draw: {
    label: "뽑을 더미",
    title: "주머니 속 — 순서는 비밀",
    rule: "종류와 매수만 공개 · 위에서부터의 순서는 비공개",
    empty: "비었음 · 드로우할 때 버림 더미를 무작위로 섞는다",
  },
  discard: {
    label: "버림 더미",
    title: "버림 더미 — 다시 쓰는 동전",
    rule: "주머니가 비면 전부 무작위로 섞여 뽑을 더미로 돌아간다",
    empty: "아직 버린 동전이 없다",
  },
  exhausted: {
    label: "소모 영역",
    title: "소모 영역 — 이번 전투에서 제외",
    rule: "영구 동전은 전투 후 복귀 · 임시 동전은 전투 후 소멸",
    empty: "이번 전투에서 소모된 동전이 없다",
  },
};

const PilePopover = ({
  anchorRef,
  zone,
  groups,
}: {
  anchorRef: RefObject<HTMLElement>;
  zone: CoinPileZone;
  groups: CoinPileGroup[];
}) => {
  const copy = PILE_COPY[zone];
  return (
    <AnchoredOverlay
      anchorRef={anchorRef}
      ariaLabel={`${copy.label} 구성`}
      className={`pile-pop ${zone === "draw" ? "pouch-pop" : ""} ${zone}`}
      id={`${zone}-pile-pop`}
      interactive
      open
      role="dialog"
    >
      <strong>{copy.title}</strong>
      <p className="pile-rule">{copy.rule}</p>
      {groups.length === 0 ? (
        <p className="pop-empty">{copy.empty}</p>
      ) : (
        <ul>
          {groups.map((group) => {
            const granted = group.grants.filter((element) => element !== group.element);
            const enchant = group.enchant === null ? undefined : contentDb.enchants?.[group.enchant];
            const lifecycle =
              zone === "exhausted"
                ? group.temporary
                  ? "전투 후 소멸"
                  : "전투 후 복귀"
                : zone === "discard"
                  ? "리셔플 대상"
                  : group.temporary
                    ? "전투 후 소멸"
                    : "영구 동전";
            return (
              <li key={`${group.defId}-${String(group.temporary)}-${group.enchant ?? "none"}-${group.grants.join("-")}`}>
                <span
                  aria-hidden="true"
                  className={`pop-coin ${group.element ?? ""} ${granted.includes("fire") ? "granted-fire" : ""} ${group.temporary ? "temporary" : ""}`}
                />
                <span className="pile-item-copy">
                  {group.element === null ? "기본" : elementKo(group.element)}
                  {granted.length > 0 ? ` · ${granted.map(elementKo).join("+")} 취급` : ""}
                  {group.temporary ? " (임시)" : ""} ×{group.count}
                  <small>{lifecycle}</small>
                  {enchant !== undefined ? (
                    <small className="coin-enchant-copy">
                      {enchant.name} · {enchant.description}
                      {" · 인챈트 변경·교체 불가"}
                    </small>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </AnchoredOverlay>
  );
};

// 소켓·고스트·드래그 프록시가 공유하는 동전 원판 — 면(face)은 플립 결과가 있을 때만 노출
const CoinDisc = ({
  state,
  coin,
  face,
  flipping,
  vfx = false,
}: {
  state: CombatState;
  coin: CoinUid;
  face?: Face;
  flipping?: boolean;
  vfx?: boolean;
}) => {
  const instance = state.coins[Number(coin)];
  const enchant = instance?.permanent ? contentDb.enchants?.[String(instance.enchant)] : undefined;
  return (
    <span
      className={`socket-coin ${coinVisualClasses(state, coin)} ${flipping === true ? "flipping" : ""} ${
        face !== undefined ? `face-${face}` : ""
      } ${vfx ? "vfx-reveal" : ""}`}
      style={vfx && face === undefined ? { animation: "vfx-coin-heads-reveal 300ms steps(3) 1" } : undefined}
    >
      {face !== undefined ? <span className={`coin-face-mark ${face}`}>{face === "heads" ? "앞" : "뒤"}</span> : null}
      {enchant !== undefined ? <span data-enchant={enchant.name} /> : null}
    </span>
  );
};

interface RunSession {
  run: RunState;
  combat: CombatState | null;
}

type BootState =
  | { mode: "title"; save: TitleSaveSummary | null }
  | { mode: "tutorial"; save: TitleSaveSummary | null }
  | { mode: "select"; practice: boolean; seed: string | null }
  | { mode: "corrupt-save"; reason: "invalid" | "retired-character" }
  | { mode: "run"; session: RunSession };

const replaceUrlSeed = (seed: string, character?: CharacterId): void => {
  const url = new URL(window.location.href);
  url.searchParams.set("seed", seed);
  url.searchParams.delete("select");
  url.searchParams.delete("practice");
  if (character !== undefined && String(character) !== "warrior") {
    url.searchParams.set("character", String(character));
  } else {
    url.searchParams.delete("character");
  }
  window.history.replaceState(null, "", url);
};

const replaceUrlWithTitle = (): void => {
  window.history.replaceState(null, "", window.location.pathname);
};

const replaceUrlWithSelection = (seed: string, practice = false): void => {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("seed", seed);
  url.searchParams.set("select", "1");
  if (practice) url.searchParams.set("practice", "1");
  window.history.replaceState(null, "", url);
};

const characterFromUrl = (): CharacterId | null => {
  const character = new URL(window.location.href).searchParams.get("character");
  if (character === null) return null;
  return contentDb.characters[character] === undefined ? null : (character as CharacterId);
};

const testEncounterFromUrl = (): readonly EnemyDefId[] | null => {
  const encounter = new URL(window.location.href).searchParams.get("encounter");
  // 테스트 전용 전투 표면: 정식 런 encounter 테이블을 건드리지 않고 UI에서만 적 배열을 바꾼다.
  // 'raider' 단일은 S10 패배 산술(고정 패턴 11·4×2·11)의 결정론 앵커 — 그래프 세대에서
  // 1전투 적이 시드 롤이 되면서 필요해졌다.
  if (encounter === "duo-raiders") return ["raider" as EnemyDefId, "raider" as EnemyDefId] as const;
  if (encounter === "trio-ghoul-goblin-slime")
    return ["ghoul" as EnemyDefId, "goblin" as EnemyDefId, "slime" as EnemyDefId] as const;
  if (encounter === "raider") return ["raider" as EnemyDefId] as const;
  if (encounter === "slime") return ["slime" as EnemyDefId] as const; // 자동 실행 승리 단축 회귀용 저체력 단일 적
  if (encounter === "ghoul") return ["ghoul" as EnemyDefId] as const; // S32 몬스터 패시브 앵커
  if (encounter === "ash-duke-valdemar") return ["ash-duke-valdemar" as EnemyDefId] as const;
  if (
    !__VITE_PRODUCTION_BUILD__ &&
    encounter === "uncrowned-coin-king-aurel" &&
    new URL(window.location.href).searchParams.get("testMode") === "d18" &&
    ["127.0.0.1", "localhost"].includes(window.location.hostname)
  )
    return ["uncrowned-coin-king-aurel" as EnemyDefId] as const;
  return null;
};

const testD18CombatStateFromUrl = (combat: CombatState): CombatState => {
  if (__VITE_PRODUCTION_BUILD__) return combat;
  const url = new URL(window.location.href);
  if (
    url.searchParams.get("testMode") !== "d18" ||
    !["127.0.0.1", "localhost"].includes(window.location.hostname)
  )
    return combat;
  const scenario = url.searchParams.get("d18");
  if (scenario === null) return combat;
  const enemyDef = contentDb.enemies["uncrowned-coin-king-aurel"];
  const enemy = combat.enemies[0];
  if (enemyDef === undefined || enemy === undefined) return combat;
  const phaseTwo = enemyDef.phases?.[0];
  const phaseThree = enemyDef.phases?.[1];
  const intent = (id: string) =>
    [
      ...enemyDef.intents,
      ...(phaseTwo?.intents ?? []),
      ...(phaseThree?.intents ?? []),
      ...(enemyDef.royalVault?.atCapacityIntent === undefined
        ? []
        : [enemyDef.royalVault.atCapacityIntent]),
      ...(enemyDef.royalTax?.foreclosureIntent === undefined
        ? []
        : [enemyDef.royalTax.foreclosureIntent]),
    ].find((candidate) => candidate.id === id);
  const coin = (uid: number, defId: CoinDefId) => ({
    uid: uid as CoinUid,
    defId,
    grants: [],
    permanent: false as const,
  });
  const coins = (...defs: CoinDefId[]) =>
    Object.fromEntries(defs.map((defId, index) => [index + 1, coin(index + 1, defId)]));
  const withState = (
    defs: CoinDefId[],
    hand: number[],
    enemyState: Partial<CombatState["enemies"][number]>,
    custody: CombatState["custody"] = [],
  ): CombatState => ({
    ...combat,
    turn: 1,
    nextUid: defs.length + 1,
    coins: coins(...defs),
    custody,
    zones: {
      ...combat.zones,
      draw: [],
      hand: hand.map((uid) => uid as CoinUid),
      discard: [],
      exhausted: [],
    },
    player: { ...combat.player, hp: 500, maxHp: 500 },
    enemies: [{ ...enemy, ...enemyState }],
  });
  const vault = (uids: number[]) =>
    uids.map((uid, index) => ({
      sourceEnemy: 0,
      sourceEnemyUid: enemy.enemyUid,
      kind: "royalVault" as const,
      coins: [uid as CoinUid],
      element: index % 2 === 0 ? ("fire" as const) : ("frost" as const),
      seizureOrder: index,
    }));
  const ordinary = intent("royal-strike");
  const foreclose = intent("royal-vault-foreclose");
  const seizure = intent("royal-seizure");
  const crown = intent("crown-confiscation");
  if (ordinary === undefined || foreclose === undefined || seizure === undefined || crown === undefined)
    return combat;
  if (scenario === "tax-paid")
    return withState(
      ["fire" as CoinDefId, "fire" as CoinDefId],
      [1, 2],
      { intent: ordinary, royalTaxPending: { element: "fire", paid: 0, deadlineTurn: 2 } },
    );
  if (scenario === "tax-default")
    return withState(
      ["fire" as CoinDefId],
      [1],
      { intent: ordinary, royalTaxPending: { element: "fire", paid: 0, deadlineTurn: 1 } },
    );
  if (scenario === "foreclose")
    return withState(
      ["fire" as CoinDefId, "fire" as CoinDefId],
      [1, 2],
      {
        intent: foreclose,
        windup: { intent: foreclose, turnsLeft: 1, startHp: enemy.hp },
        royalTaxForeclosureElement: "fire",
        royalVaultSeizure: { nominated: [1 as CoinUid], capacity: 6 },
      },
    );
  if (scenario === "lead")
    return withState(
      ["fire" as CoinDefId, "frost" as CoinDefId, "fire" as CoinDefId, "fire" as CoinDefId, "fire" as CoinDefId, "fire" as CoinDefId, "fire" as CoinDefId, "fire" as CoinDefId],
      [1, 2, 3, 4, 5, 6, 7, 8],
      {
        intent: intent("lead-decree") ?? ordinary,
        phaseIndex: 0,
        windup: {
          intent: intent("lead-decree") ?? ordinary,
          turnsLeft: 1,
          startHp: enemy.hp,
        },
        leadDecree: { initial: 3, remaining: 3, active: true, weakenedThisTurn: 0, weakenedTotal: 0 },
      },
    );
  if (scenario === "seizure")
    return withState(
      ["fire" as CoinDefId, "frost" as CoinDefId, "fire" as CoinDefId, "frost" as CoinDefId],
      [1, 2, 3, 4],
      {
        intent: seizure,
        phaseIndex: 1,
        windup: { intent: seizure, turnsLeft: 1, startHp: enemy.hp },
        royalVaultSeizure: { nominated: [1 as CoinUid, 2 as CoinUid], capacity: 6 },
      },
    );
  if (scenario === "crown-recovery")
    return withState(
      ["fire" as CoinDefId, "frost" as CoinDefId],
      [],
      {
        intent: crown,
        windup: { intent: crown, turnsLeft: 1, startHp: enemy.hp },
        royalVaultRecoveredThisWindup: 2,
      },
      vault([1, 2]),
    );
  if (scenario === "crown-damage")
    return withState(
      ["fire" as CoinDefId, "fire" as CoinDefId, "fire" as CoinDefId, "fire" as CoinDefId, "frost" as CoinDefId, "frost" as CoinDefId],
      [1, 2, 3, 4],
      {
        intent: crown,
        windup: { intent: crown, turnsLeft: 1, startHp: enemy.hp },
      },
      vault([5, 6]),
    );
  if (scenario === "crown-resolve")
    return withState(
      ["fire", "frost", "fire", "frost", "fire", "frost"].map((defId) => defId as CoinDefId),
      [],
      { intent: crown, windup: { intent: crown, turnsLeft: 1, startHp: enemy.hp } },
      vault([1, 2, 3, 4, 5, 6]),
    );
  if (scenario === "victory")
    return {
      ...withState(
      ["fire" as CoinDefId, "fire" as CoinDefId],
      [1, 2],
      { hp: 1, intent: ordinary },
      ),
      player: combat.player,
    };
  return combat;
};

const testCombatHpFromUrl = (): number | null => {
  const raw = new URL(window.location.href).searchParams.get("testCombatHp");
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 999 ? value : null;
};

const testEnemyStateFromUrl = (
  combat: CombatState,
): CombatState => {
  const params = new URL(window.location.href).searchParams;
  const hpRaw = params.get("testEnemyHp");
  const furnaceRaw = params.get("testEnemyFurnace");
  const hp = hpRaw === null ? null : Number(hpRaw);
  const furnace = furnaceRaw === null ? null : Number(furnaceRaw);
  if (
    (hp === null || !Number.isInteger(hp) || hp < 1) &&
    (furnace === null || !Number.isInteger(furnace) || furnace < 0 || furnace > 6)
  )
    return combat;
  return {
    ...combat,
    enemies: combat.enemies.map((enemy, index) =>
      index !== 0
        ? enemy
        : {
            ...enemy,
            ...(hp !== null && Number.isInteger(hp) && hp >= 1
              ? { hp: Math.min(hp, enemy.maxHp) }
              : {}),
            ...(furnace !== null &&
            Number.isInteger(furnace) &&
            furnace >= 0 &&
            furnace <= 6 &&
            enemy.furnaceTemperature !== undefined
              ? { furnaceTemperature: furnace }
              : {}),
          },
    ),
  };
};

// Kept as a pure projection for telemetry/regression consumers. The combat-log
// widget itself was intentionally removed from the play surface.
export const combatEventLogSummary = (events: readonly CombatEvent[]): ResolutionSummary | null => {
  const lines = combatEventResolutionLines(events);
  return lines.length === 0
    ? null
    : {
        skillName: "전투 알림",
        kind: "consume",
        faces: [],
        costNote: null,
        baseLines: [],
        bonusLines: [],
        triggerLines: lines,
        statusLines: [],
        totalLine: lines.join(" · "),
      };
};

const testSkillsFromUrl = (fallback: RunState["equippedSkills"]): RunState["equippedSkills"] | null => {
  const skills = new URL(window.location.href).searchParams.get("skills");
  if (skills === null) return null;
  // 테스트 전용 스킬 표면: 정식 콘텐츠·런 보상 로직을 건드리지 않고 UI 시작 장착만 바꾼다.
  const valid = skills
    .split(",")
    .map((skill) => skill.trim())
    .filter((skill) => contentDb.skills[skill] !== undefined)
    .slice(0, 8)
    .map((skill) => skill as SkillId);
  if (valid.length === 0) return null;
  return fallback.map((skill, index) => valid[index] ?? skill) as RunState["equippedSkills"];
};

const persistRun = (run: RunState): void => {
  let ok = false;
  try {
    ok = saveRun(window.localStorage, run, contentDb);
  } catch {
    ok = false;
  }
  // 저장 실패는 조용히 넘기지 않는다 — RunMeta 경고 배지가 구독 (P5.4)
  window.dispatchEvent(new CustomEvent("run-save-status", { detail: { ok } }));
};

const freshSession = (
  seed: string,
  character: CharacterId = "warrior" as CharacterId,
  startInCombat = false,
): RunSession => {
  const created = createRun(
    {
      contentVersion: CONTENT_VERSION,
      runSeed: seed,
      character,
    },
    contentDb,
  );
  const skillOverride = testSkillsFromUrl(created.equippedSkills);
  const ready = skillOverride === null ? created : { ...created, equippedSkills: skillOverride };
  const testEnemies = testEncounterFromUrl();
  if (testEnemies !== null) {
    const run = { ...ready, phase: "combat" as const };
    const combat = createCombat(
      {
        character: ready.character,
        enemies: [...testEnemies],
        bag: ready.bag,
        equippedSkills: ready.equippedSkills,
        currentHp: ready.currentHp,
        maxHp: ready.maxHp,
        combatIndex: ready.combatIndex,
        attempt: ready.attempt,
      },
      contentDb,
      seed,
    );
    const testCombatHp = testCombatHpFromUrl();
    const testEnemyState = testD18CombatStateFromUrl(testEnemyStateFromUrl(combat));
    return {
      run,
      combat:
        testCombatHp === null
          ? testEnemyState
          : {
              ...testEnemyState,
              player: { ...testEnemyState.player, hp: testCombatHp, maxHp: testCombatHp },
            },
    };
  }
  if (!startInCombat) return { run: { ...ready, phase: "choose-node" }, combat: null };
  const started = startRunCombat(ready, contentDb);
  return { run: started.run, combat: started.combat };
};

const savedSession = (saved: RunState): RunSession => {
  replaceUrlSeed(saved.runSeed, saved.character);
  if (saved.phase !== "combat") return { run: saved, combat: null };
  const resumed = resumeAbandonedCombat(saved);
  const started = startRunCombat(resumed, contentDb);
  return { run: started.run, combat: started.combat };
};

const testShopSessionFromUrl = (): RunSession | null => {
  if (new URL(window.location.href).searchParams.get("testShop") !== "p13") return null;
  const created = createRun(
    {
      contentVersion: CONTENT_VERSION,
      runSeed: "P13-SHOP",
      character: "warrior" as CharacterId,
    },
    contentDb,
  );
  return {
    run: {
      ...created,
      phase: "shop",
      combatIndex: 3,
      gold: 999,
      nodeChoices: [0, 0, 0, 0, 0],
      pendingShop: {
        coinOptions: ["basic" as CoinDefId, "fire" as CoinDefId, "mana" as CoinDefId],
        coinPrices: [25, 50, 70],
        skillOptions: [
          "smash" as SkillId,
          "fire-infusion" as SkillId,
          "furnace" as SkillId,
          "conflagration" as SkillId,
          "ignite" as SkillId,
        ],
        skillPrices: [50, 80, 80, 120, 50],
        passiveOptions: [],
        passivePrices: [],
      },
    },
    combat: null,
  };
};

const titleSaveSummary = (run: RunState): TitleSaveSummary => {
  const acts = run.graph.acts;
  const act = actOfLayer(run.graph, run.combatIndex);
  const actStart = acts?.[act]?.start ?? 0;
  const actEnd = acts?.[act + 1]?.start ?? run.graph.layers.length;
  const progress =
    acts === undefined
      ? `노드 ${Math.min(run.combatIndex + 1, run.graph.layers.length)}/${run.graph.layers.length}`
      : `${act + 1}막 ${Math.min(run.combatIndex - actStart + 1, actEnd - actStart)}/${actEnd - actStart}`;
  return {
    characterName: contentDb.characters[String(run.character)]?.name ?? String(run.character),
    currentHp: run.currentHp,
    maxHp: run.maxHp,
    progress,
  };
};

const bootState = (): BootState => {
  const url = new URL(window.location.href);
  const urlSeed = url.searchParams.get("seed");
  const testCharacter = characterFromUrl();
  const hasSeed = urlSeed !== null && urlSeed.trim().length > 0;
  const hasTestBoot = testEncounterFromUrl() !== null || url.searchParams.has("skills") || testCharacter !== null;
  const testShopSession = testShopSessionFromUrl();
  if (testShopSession !== null) return { mode: "run", session: testShopSession };
  if (url.searchParams.get("select") === "1") {
    return { mode: "select", practice: url.searchParams.get("practice") === "1", seed: hasSeed ? urlSeed : null };
  }
  if (hasTestBoot)
    return {
      mode: "run",
      session: freshSession(seedFromUrl(), testCharacter ?? ("warrior" as CharacterId), true),
    };
  // P5.4 복구 계약: 상태 판별(missing/loaded/recovered/corrupt/unsupported/
  // unavailable) — 주 손상 시 백업 복구, 둘 다 무효면 원문 격리 후 명시 화면.
  const detailed = loadRunDetailed(window.localStorage, CONTENT_VERSION, contentDb);
  if (detailed.status === "unavailable") {
    // 저장소 접근 불가 — 진행은 가능하되 경고 배지를 세운다 (마운트 후 1회)
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("run-save-status", { detail: { ok: false } }));
    }, 0);
  }
  if (detailed.status === "corrupt" || detailed.status === "unsupported")
    return { mode: "corrupt-save", reason: "invalid" };
  if (detailed.status === "retired-character") return { mode: "corrupt-save", reason: "retired-character" };
  const saved = detailed.save;
  if (saved === null && hasSeed) {
    return {
      mode: "run",
      session: freshSession(seedFromUrl(), testCharacter ?? ("warrior" as CharacterId)),
    };
  }
  return {
    mode: "title",
    save: saved === null ? null : titleSaveSummary(saved),
  };
};

const coinName = (coin: CoinDefId): string => coinNameFor(contentDb, String(coin));

const coinRewardDetail = (coin: CoinDefId): string => coinRewardDetailFor(contentDb, String(coin));

const skillRarityName = (skill: SkillId): string => {
  const rarity = contentDb.skills[String(skill)]?.rarity;
  return rarity === "rare" ? "희귀" : rarity === "advanced" ? "고급" : "일반";
};

const bloodSwordPowerForInvestment = (investment: number): number =>
  investment >= 30 ? 5 : investment >= 25 ? 4 : investment >= 15 ? 3 : investment >= 10 ? 2 : investment >= 5 ? 1 : 0;

const SkillRewardMark = ({ skill, scale = 3.2 }: { skill: SkillId; scale?: number }) => {
  const tags = contentDb.skills[String(skill)]?.tags ?? [];
  if (tags.includes("defense")) return <ShieldIcon scale={scale} />;
  if (tags.includes("attack")) return <SwordIcon scale={scale} />;
  return <EmberIcon scale={scale} />;
};

const SaveWarningBadge = () => {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const onStatus = (event: Event) => {
      const ok = (event as CustomEvent<{ ok: boolean }>).detail.ok;
      setFailed(!ok);
    };
    window.addEventListener("run-save-status", onStatus);
    return () => window.removeEventListener("run-save-status", onStatus);
  }, []);
  if (!failed) return null;
  return (
    <span className="save-warning" data-testid="save-warning" role="status">
      저장 실패 — 진행이 보존되지 않을 수 있음
    </span>
  );
};

const currentNodeFor = (run: RunState) => run.graph.layers[run.combatIndex]?.[run.nodeChoices[run.combatIndex] ?? 0];

const NODE_KIND_KO: Record<string, string> = {
  combat: "전투",
  elite: "엘리트",
  shop: "상점",
  event: "이벤트",
  boss: "보스",
  rest: "휴식",
  treasure: "보물",
};

const enemyNameFor = (run: RunState): string => {
  const node = currentNodeFor(run);
  const names = (node?.encounter ?? []).map((id) => contentDb.enemies[String(id)]?.name ?? "적");
  return names.length === 0 ? "적" : names.join("·");
};

const RunMeta = ({
  run,
  preferences,
  onPreferencesChange,
  preferencesOpen,
  onPreferencesOpenChange,
  passivesOpen,
  onPassivesOpenChange,
}: {
  run: RunState;
  preferences: CombatPreferences;
  onPreferencesChange: (next: CombatPreferences) => void;
  preferencesOpen: boolean;
  onPreferencesOpenChange: (open: boolean) => void;
  passivesOpen: boolean;
  onPassivesOpenChange: (open: boolean) => void;
}) => {
  const layerCount = run.graph.layers.length;
  const acts = run.graph.acts;
  // P6 D1 — 3막 그래프면 "N막 방문 M/10", 레거시면 기존 노드 표기
  const act = actOfLayer(run.graph, run.combatIndex);
  const actStart = acts?.[act]?.start ?? 0;
  const visitLabel =
    acts !== undefined
      ? `${act + 1}막 ${run.combatIndex - actStart + 1}/${(acts[act + 1]?.start ?? layerCount) - actStart}`
      : `노드 ${run.combatIndex + 1}/${layerCount}`;
  const progress =
    run.phase === "rewards"
      ? `전투 ${completedCombatCount(run)} 완료`
      : run.phase === "victory" || run.phase === "defeat"
        ? "런 결과"
        : visitLabel;
  const context =
    run.phase === "rewards"
      ? "보상 선택"
      : run.phase === "victory"
        ? "승리"
        : run.phase === "defeat"
          ? "패배"
          : run.phase === "shop"
            ? "상점"
            : run.phase === "event"
              ? "이벤트"
              : run.phase === "rest"
                ? "휴식"
                : run.phase === "treasure"
                  ? "보물"
                  : run.phase === "choose-node"
                    ? "갈림길"
                    : enemyNameFor(run);
  const passiveNames = run.acquiredPassives
    .map((id) => (contentDb.passives ?? {})[String(id)]?.name ?? String(id))
    .join(" · ");
  return (
    <header
      aria-label="런 진행 정보"
      className="run-meta"
      data-attempt={run.attempt}
      data-bag={run.bag.map(String).join(",")}
      data-combat-index={run.combatIndex}
      data-current-hp={run.currentHp}
      data-equipped-skills={run.equippedSkills.map(String).join(",")}
      data-run-phase={run.phase}
      data-testid="run-progress"
    >
      <strong>{progress}</strong>
      <span className="run-context">{context}</span>
      <span>
        HP {run.currentHp}/{run.maxHp}
      </span>
      <span aria-label={`보유 골드 ${run.gold}`} data-testid="run-gold">
        골드 {run.gold}
      </span>
      <span>시도 {run.attempt + 1}</span>
      <span className="passive-count" data-testid="run-passives" title={passiveNames || "보유 패시브 없음"}>
        ★ 패시브 {run.acquiredPassives.length}
      </span>
      <SaveWarningBadge />
      <CombatPreferencesPanel
        value={preferences}
        onChange={onPreferencesChange}
        open={preferencesOpen}
        onOpenChange={onPreferencesOpenChange}
      />
      <PassiveInventory
        contentDb={contentDb}
        open={passivesOpen}
        passives={run.acquiredPassives}
        onOpenChange={onPassivesOpenChange}
      />
      <small>SEED {run.runSeed}</small>
    </header>
  );
};

// 코어 거부 메시지 → 사용자 문구 (규칙 재판정 없이 메시지 매핑만)
const shopRejectionKo = (message: string): string =>
  message.includes("not enough gold")
    ? "골드가 부족합니다."
    : message.includes("cannot remove the last coin")
      ? "마지막 동전은 제거할 수 없습니다."
      : message.includes("already owned")
        ? "이미 장착한 스킬입니다."
        : "구매할 수 없습니다.";

const eventRejectionKo = (message: string): string =>
  message.includes("not enough HP")
    ? "체력이 부족합니다."
    : message.includes("not enough gold")
      ? "골드가 부족합니다."
      : message.includes("requires a basic coin")
        ? "기본 코인을 골라야 합니다."
        : message.includes("bagIndex is required")
          ? "대상 코인을 먼저 고릅니다."
          : message.includes("cannot sacrifice")
            ? "마지막 동전은 희생할 수 없습니다."
            : "지금은 수락할 수 없습니다.";

interface RunGameProps {
  initialSession: RunSession;
  onExitToTitle: (run: RunState) => void;
  onLoadSaved: () => void;
  onStartNewRun: () => void;
}

type CombatUtilityPanel = "help" | "preferences" | "passives" | null;

const motionIsReduced = (localPreference: boolean): boolean =>
  localPreference ||
  (typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches);

const coinRailMetrics = (rail: HTMLElement): { current: number; max: number } => {
  const coins = [...rail.querySelectorAll<HTMLElement>(".coin")];
  if (coins.length === 0) return { current: 0, max: 0 };
  const nearest = (visibleStart: number) =>
    coins.reduce(
      (best, coin, index) =>
        Math.abs(coin.offsetLeft - visibleStart) < best.distance
          ? { index, distance: Math.abs(coin.offsetLeft - visibleStart) }
          : best,
      { index: 0, distance: Number.POSITIVE_INFINITY },
    ).index;
  const inset = 44;
  return {
    current: nearest(rail.scrollLeft + inset),
    max: nearest(Math.max(0, rail.scrollWidth - rail.clientWidth) + inset),
  };
};

const RunGame = ({ initialSession, onExitToTitle, onLoadSaved, onStartNewRun }: RunGameProps) => {
  const [session, setSession] = useState<RunSession>(initialSession);
  const [combatPreferences, setCombatPreferences] = useState<CombatPreferences>(loadCombatPreferences);
  const [combatUtilityPanel, setCombatUtilityPanel] = useState<CombatUtilityPanel>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [removalIndex, setRemovalIndex] = useState<number | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillId | null>(null);
  const [shopRejection, setShopRejection] = useState<string | null>(null);
  const [shopSkillPick, setShopSkillPick] = useState<number | null>(null);
  const [eventPick, setEventPick] = useState<number | null>(null);
  const [eventRejection, setEventRejection] = useState<string | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const { run, combat } = session;
  const telemetryRef = useRef<HumanRunTrace | null>(null);
  if (telemetryRef.current === null) {
    telemetryRef.current = createHumanRunTrace({
      runSeed: run.runSeed,
      contentVersion: CONTENT_VERSION,
      maxHp: run.maxHp,
    });
  }
  const currentTelemetry = (): HumanRunTrace => {
    if (telemetryRef.current === null) {
      throw new Error("human telemetry was not initialized");
    }
    return telemetryRef.current;
  };

  const changeCombatPreferences = (next: CombatPreferences) => {
    saveCombatPreferences(next);
    setMuted(!next.sound);
    setCombatPreferences(next);
  };
  const rewardStage = rewardViewStage(run);
  const isCoinStage = rewardStage === "coin" || rewardStage === "fallback-coin";
  const runBloodSwordPower =
    run.character === "blood-spellblade" ? bloodSwordPowerForInvestment(run.bloodSwordInvestment ?? 0) : 0;

  useEffect(() => persistRun(run), [run]);

  useEffect(() => {
    setMuted(!combatPreferences.sound);
  }, [combatPreferences.sound]);

  useEffect(() => {
    setRemovalIndex(null);
    setSelectedSkill(null);
    setShopSkillPick(null);
    setShopRejection(null);
    setEventPick(null);
    setEventRejection(null);
  }, [run.combatIndex, run.phase, rewardStage]);

  useEffect(() => setCombatUtilityPanel(null), [run.combatIndex, run.phase]);

  useEffect(() => {
    if (combat === null) primaryRef.current?.focus();
  }, [combat, rewardStage, run.phase, selectedSkill]);

  const commitRun = (next: RunState) => {
    persistRun(next);
    setSession({ run: next, combat: null });
  };

  // 상점 액션 공통 경로: 코어가 던지는 거부 사유를 사용자 문구로 노출 (기존 거부 피드백 패턴).
  // 성공 시에만 경로 사실을 기록한다 — 리플레이 스키마 v2 (거부된 시도는 상태 무변).
  const runShopAction = (action: () => RunState, fact: HumanShopAction) => {
    try {
      const next = action();
      telemetryRef.current = recordHumanShopAction(currentTelemetry(), {
        layer: run.combatIndex,
        action: fact,
      });
      if (fact.kind !== "leave") playSfx("purchase");
      setShopRejection(null);
      commitRun(next);
    } catch (error) {
      setShopRejection(error instanceof Error ? shopRejectionKo(error.message) : "구매할 수 없습니다.");
    }
  };

  const commitReward = (next: RunState, reward: RecordHumanRewardInput) => {
    telemetryRef.current = recordHumanReward(currentTelemetry(), reward);
    commitRun(next);
  };

  // 이벤트 액션 공통 경로 — 성공 시에만 경로 사실 기록 (schema v2 additive)
  const runEventAction = (action: () => RunState, fact: { action: "accept" | "decline"; choice?: number }) => {
    try {
      const next = action();
      telemetryRef.current = recordHumanEventAction(currentTelemetry(), {
        layer: run.combatIndex,
        ...fact,
      });
      setEventRejection(null);
      commitRun(next);
    } catch (error) {
      setEventRejection(error instanceof Error ? eventRejectionKo(error.message) : "지금은 수락할 수 없습니다.");
    }
  };

  const startNextCombat = () => {
    const started = startRunCombat(run, contentDb);
    persistRun(started.run);
    setSession({ run: started.run, combat: started.combat });
  };

  const completeCombat = (completed: CombatState) => {
    if (run.phase !== "combat") return;
    telemetryRef.current = finishHumanCombat(currentTelemetry(), run.combatIndex, run.attempt, completed);
    const settled = settleRunCombat(run, completed, contentDb);
    playSfx(completed.phase === "victory" ? "victory" : "defeat");
    if (settled.phase === "victory" || settled.phase === "defeat") {
      telemetryRef.current = finishHumanRun(currentTelemetry(), {
        result: settled.phase,
        finalHp: settled.currentHp,
        maxHp: settled.maxHp,
      });
    }
    persistRun(settled);
    setSession({ run: settled, combat: null });
  };

  const beginTelemetryCombat = (started: CombatState) => {
    telemetryRef.current = beginHumanCombat(currentTelemetry(), {
      combatIndex: run.combatIndex,
      attempt: run.attempt,
      combat: started,
    });
  };

  const recordTelemetryDecision = (
    before: CombatState,
    commands: readonly Command[],
    after: CombatState,
    events: readonly CombatEvent[],
    source?: "manual" | "auto-turn-end",
  ) => {
    telemetryRef.current = recordHumanDecision(currentTelemetry(), {
      combatIndex: run.combatIndex,
      attempt: run.attempt,
      before,
      commands,
      after,
      events,
      source,
    });
  };

  const exportPlayLog = () => {
    if (run.phase !== "victory" && run.phase !== "defeat") return;
    telemetryRef.current = finishHumanRun(currentTelemetry(), {
      result: run.phase,
      finalHp: run.currentHp,
      maxHp: run.maxHp,
    });
    downloadHumanRunTrace(currentTelemetry());
  };

  const restartRun = (seed: string) => {
    try {
      clearRun(window.localStorage);
    } catch {
      // 메모리 세션 재시작은 저장소 가용성과 무관하다.
    }
    replaceUrlSeed(seed, run.character);
    setRemovalIndex(null);
    setSelectedSkill(null);
    const fresh = freshSession(seed, run.character);
    telemetryRef.current = createHumanRunTrace({
      runSeed: fresh.run.runSeed,
      contentVersion: CONTENT_VERSION,
      maxHp: fresh.run.maxHp,
    });
    persistRun(fresh.run);
    setSession(fresh);
  };

  const runMenuControls = (
    <>
      <button
        aria-label="런 메뉴 열기"
        className="run-menu-open"
        data-testid="run-menu-open"
        type="button"
        onClick={() => setMenuOpen(true)}
      >
        메뉴
      </button>
      <RunMenu
        hasSave={true}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onExitToTitle={() => {
          setMenuOpen(false);
          onExitToTitle(run);
        }}
        onLoad={() => {
          setMenuOpen(false);
          onLoadSaved();
        }}
        onNewRun={() => {
          setMenuOpen(false);
          onStartNewRun();
        }}
      />
    </>
  );

  if (run.phase === "combat" && combat !== null) {
    return (
      <>
        <CombatBoard
          combat={combat}
          preferences={combatPreferences}
          utilityPanel={combatUtilityPanel}
          key={`${run.runSeed}-${run.combatIndex}-${run.attempt}`}
          onPreferencesChange={changeCombatPreferences}
          onUtilityPanelChange={setCombatUtilityPanel}
          onTelemetryCombatStart={beginTelemetryCombat}
          onTelemetryDecision={recordTelemetryDecision}
          onComplete={completeCombat}
          run={run}
        />
        {runMenuControls}
      </>
    );
  }

  const pending = run.pendingRewards;
  return (
    <>
      <main
        aria-label="런 진행 화면"
        className="run-stage-shell"
        data-attempt={run.attempt}
        data-bag={run.bag.map(String).join(",")}
        data-combat-index={run.combatIndex}
        data-current-hp={run.currentHp}
        data-equipped-skills={run.equippedSkills.map(String).join(",")}
        data-run-phase={run.phase}
        data-testid="run-phase"
      >
        <div className="backdrop" aria-hidden="true">
          <img alt="" className="backdrop-img" src={bgForest} />
        </div>
        <RunMeta
          run={run}
          preferences={combatPreferences}
          onPreferencesChange={changeCombatPreferences}
          preferencesOpen={combatUtilityPanel === "preferences"}
          onPreferencesOpenChange={(open) => setCombatUtilityPanel(open ? "preferences" : null)}
          passivesOpen={combatUtilityPanel === "passives"}
          onPassivesOpenChange={(open) => setCombatUtilityPanel(open ? "passives" : null)}
        />
        <div
          aria-label={
            run.phase === "rewards"
              ? "전투 보상"
              : run.phase === "victory"
                ? "런 승리 결과"
                : run.phase === "defeat"
                  ? "런 패배 결과"
                  : "다음 전투"
          }
          aria-modal="true"
          className={`result-overlay run-overlay ${run.phase === "rewards" ? "reward-overlay" : ""}`}
          data-testid={
            run.phase === "rewards"
              ? "reward-overlay"
              : run.phase === "victory" || run.phase === "defeat"
                ? "run-result"
                : "ready-overlay"
          }
          role="dialog"
        >
          <section className={`result-panel run-panel phase-${run.phase} stage-${rewardStage ?? "none"}`}>
            {run.phase === "rewards" && pending !== undefined ? (
              <>
                <p className="run-kicker">전투 {completedCombatCount(run)} 완료</p>
                <h1>전투 보상</h1>
                <p className="reward-step" data-reward-stage={rewardStage ?? undefined} data-testid="reward-stage">
                  {rewardStage === "coin"
                    ? "코인 추가"
                    : rewardStage === "removal"
                      ? "코인 제거"
                      : rewardStage === "fallback-coin"
                        ? "대체 보상 · 추가 코인"
                        : rewardStage === "passive"
                          ? "보스 전리품 · 패시브 선택"
                          : "스킬 선택"}
                </p>

                {isCoinStage ? (
                  <div className={`reward-body ${rewardStage === "fallback-coin" ? "fallback-reward" : ""}`}>
                    <p>
                      {rewardStage === "fallback-coin"
                        ? "새 스킬 후보가 부족해 추가 영구 코인 보상으로 대체되었습니다."
                        : "주머니에 영구 코인 하나를 추가합니다."}
                    </p>
                    <div className="reward-grid coin-rewards">
                      {pending.coinOptions.map((coin, index) => {
                        const enchant = contentDb.enchants?.[String(pending.coinEnchantOptions?.[index])];
                        return (
                          <button
                            className={`reward-choice coin-${String(contentDb.coins[String(coin)]?.element ?? "basic")}`}
                            data-testid={`coin-reward-${String(coin)}`}
                            key={String(coin)}
                            ref={index === 0 ? primaryRef : undefined}
                            type="button"
                            onClick={() =>
                              commitReward(chooseCoinReward(run, coin, contentDb), {
                                combatIndex: run.combatIndex - 1,
                                stage: rewardStage === "fallback-coin" ? "fallback-coin" : "coin",
                                options: pending.coinOptions.map(String),
                                choice: String(coin),
                                resolution: "selected",
                              })
                            }
                          >
                            <span className="reward-coin" aria-hidden="true" />
                            <strong>{coinName(coin)}</strong>
                            <small>{coinRewardDetail(coin)}</small>
                            {enchant !== undefined ? (
                              <span className="reward-enchant">
                                <b>{enchant.name}</b>
                                <small>{enchant.description}</small>
                                <small>인챈트 불변 · 코인 제거 가능</small>
                              </span>
                            ) : null}
                            <em>주머니 +1</em>
                          </button>
                        );
                      })}
                    </div>
                    <button
                      className="secondary-action"
                      data-testid="coin-reward-skip"
                      type="button"
                      onClick={() =>
                        commitReward(chooseCoinReward(run, null, contentDb), {
                          combatIndex: run.combatIndex - 1,
                          stage: rewardStage === "fallback-coin" ? "fallback-coin" : "coin",
                          options: pending.coinOptions.map(String),
                          choice: null,
                          resolution: "skipped",
                        })
                      }
                    >
                      {rewardStage === "fallback-coin" ? "대체 코인 건너뛰기" : "코인 보상 거절"}
                    </button>
                  </div>
                ) : null}

                {rewardStage === "removal" ? (
                  <div className="reward-body">
                    <p>현재 주머니에서 영구 코인 하나를 고르거나 건너뜁니다.</p>
                    <div aria-label="현재 영구 코인 주머니" className="bag-list">
                      {run.bag.map((coin, index) => (
                        <button
                          aria-pressed={removalIndex === index}
                          className={`bag-choice ${removalIndex === index ? "selected" : ""}`}
                          data-testid={`bag-remove-${index}`}
                          key={`${String(coin)}-${index}`}
                          ref={index === 0 ? primaryRef : undefined}
                          type="button"
                          onClick={() => setRemovalIndex(index)}
                        >
                          <span
                            aria-hidden="true"
                            className={`bag-choice-coin coin-${String(contentDb.coins[String(coin)]?.element ?? "basic")}`}
                          />
                          <span className="bag-choice-copy">
                            {coinName(coin)} <small>#{index + 1}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="reward-actions">
                      <button
                        className="destructive-action"
                        data-testid="removal-confirm"
                        disabled={removalIndex === null}
                        type="button"
                        onClick={() => {
                          if (removalIndex === null) return;
                          commitReward(resolveCoinRemoval(run, removalIndex, contentDb), {
                            combatIndex: run.combatIndex - 1,
                            stage: "removal",
                            options: run.bag.map(String),
                            choice: String(run.bag[removalIndex]),
                            resolution: "selected",
                            bagIndex: removalIndex,
                          });
                        }}
                      >
                        선택한 코인 제거
                      </button>
                      <button
                        className="secondary-action"
                        data-testid="removal-cancel"
                        disabled={removalIndex === null}
                        type="button"
                        onClick={() => setRemovalIndex(null)}
                      >
                        선택 취소
                      </button>
                      <button
                        className="secondary-action"
                        data-testid="removal-skip"
                        type="button"
                        onClick={() =>
                          commitReward(resolveCoinRemoval(run, null, contentDb), {
                            combatIndex: run.combatIndex - 1,
                            stage: "removal",
                            options: run.bag.map(String),
                            choice: null,
                            resolution: "skipped",
                          })
                        }
                      >
                        제거 건너뛰기
                      </button>
                    </div>
                  </div>
                ) : null}

                {rewardStage === "skill" ? (
                  <div className="reward-body">
                    {selectedSkill === null ? (
                      <>
                        <p>새 스킬을 고르면 교체할 슬롯을 선택합니다.</p>
                        <div className="reward-grid skill-rewards">
                          {pending.skillOptions.map((skill, index) => {
                            const skillDef = contentDb.skills[String(skill)];
                            return (
                              <div
                                className="reward-choice skill-choice"
                                data-testid={`skill-reward-${String(skill)}`}
                                key={String(skill)}
                                style={{ alignItems: "stretch", justifyContent: "flex-start", textAlign: "center" }}
                              >
                                <span className="skill-reward-mark" aria-hidden="true">
                                  <SkillRewardMark skill={skill} />
                                </span>
                                <em className={`rarity rarity-${skillDef?.rarity ?? "common"}`}>
                                  {skillRarityName(skill)}
                                </em>
                                <strong>{skillDef?.name ?? String(skill)}</strong>
                                {skillDef === undefined ? null : (
                                  <CardEffectRows
                                    bloodSwordPower={runBloodSwordPower}
                                    displayName={skillDisplayName(skillDef, runBloodSwordPower)}
                                    skill={skillDef}
                                  />
                                )}
                                <button
                                  className="secondary-action"
                                  ref={index === 0 ? primaryRef : undefined}
                                  type="button"
                                  onClick={() => setSelectedSkill(skill)}
                                >
                                  선택
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        <button
                          className="secondary-action"
                          data-testid="skill-reward-skip"
                          type="button"
                          onClick={() =>
                            commitReward(skipSkillReward(run, contentDb), {
                              combatIndex: run.combatIndex - 1,
                              stage: "skill",
                              options: pending.skillOptions.map(String),
                              choice: null,
                              resolution: "skipped",
                            })
                          }
                        >
                          스킬 보상 건너뛰기
                        </button>
                      </>
                    ) : (
                      <>
                        <p>
                          <strong>{contentDb.skills[String(selectedSkill)]?.name ?? String(selectedSkill)}</strong> —
                          교체할 슬롯을 고르세요.
                        </p>
                        <div aria-label="교체할 스킬 슬롯" className="replacement-list">
                          {run.equippedSkills.map((skill, index) => {
                            const skillDef = skill === null ? undefined : contentDb.skills[String(skill)];
                            return (
                              <div
                                key={`${String(skill)}-${index}`}
                                style={{ display: "flex", minWidth: 0, flexDirection: "column", gap: 6 }}
                              >
                                <button
                                  aria-label={`슬롯 ${index + 1} ${skill !== null ? `${skillDef?.name ?? String(skill)} ${isLockedSkill(contentDb, skill) ? "고유 스킬, 교체 불가" : "교체"}` : "빈 슬롯 장착"}`}
                                  data-testid={`replace-slot-${index}`}
                                  disabled={isLockedSkill(contentDb, skill)}
                                  ref={index === 0 ? primaryRef : undefined}
                                  type="button"
                                  onClick={() =>
                                    commitReward(chooseSkillReward(run, selectedSkill, index, contentDb), {
                                      combatIndex: run.combatIndex - 1,
                                      stage: "skill",
                                      options: pending.skillOptions.map(String),
                                      choice: String(selectedSkill),
                                      resolution: "selected",
                                      replacedSlot: index,
                                    })
                                  }
                                >
                                  <span aria-hidden="true" className="replacement-mark">
                                    {skill !== null ? <SkillRewardMark scale={2.6} skill={skill} /> : null}
                                  </span>
                                  <span className="replacement-copy">
                                    <small>
                                      슬롯 {index + 1} · {skill !== null ? skillRarityName(skill) : "빈 슬롯"}
                                      {isLockedSkill(contentDb, skill) ? " · 고유 스킬 · 교체 불가" : ""}
                                    </small>
                                    <strong>{skillDef?.name ?? (skill !== null ? String(skill) : "장착")}</strong>
                                  </span>
                                </button>
                                {skillDef === undefined ? null : (
                                  <CardEffectRows
                                    bloodSwordPower={runBloodSwordPower}
                                    displayName={skillDisplayName(skillDef, runBloodSwordPower)}
                                    skill={skillDef}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <div className="reward-actions">
                          <button
                            className="secondary-action"
                            data-testid="replace-cancel"
                            type="button"
                            onClick={() => setSelectedSkill(null)}
                          >
                            스킬 선택 취소
                          </button>
                          <button
                            className="secondary-action decline-action"
                            data-testid="replace-decline"
                            type="button"
                            onClick={() =>
                              commitReward(skipSkillReward(run, contentDb), {
                                combatIndex: run.combatIndex - 1,
                                stage: "skill",
                                options: pending.skillOptions.map(String),
                                choice: null,
                                resolution: "declined",
                              })
                            }
                          >
                            교체하지 않고 거절
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : null}

                {rewardStage === "passive" ? (
                  <div className="reward-body">
                    <p>보스의 전리품 — 획득할 패시브를 하나 고릅니다.</p>
                    <div className="reward-grid passive-rewards">
                      {(pending.passiveOptions ?? []).map((passiveId, index) => {
                        const def = (contentDb.passives ?? {})[String(passiveId)];
                        return (
                          <button
                            className="reward-choice passive-choice"
                            data-testid={`passive-reward-${String(passiveId)}`}
                            key={String(passiveId)}
                            ref={index === 0 ? primaryRef : undefined}
                            type="button"
                            onClick={() => {
                              telemetryRef.current = recordHumanPassiveReward(currentTelemetry(), {
                                layer: run.combatIndex,
                                passiveId: String(passiveId),
                              });
                              commitRun(choosePassiveReward(run, passiveId, contentDb));
                            }}
                          >
                            <span aria-hidden="true" className="passive-mark">
                              ★
                            </span>
                            <strong>{def?.name ?? String(passiveId)}</strong>
                            <small>{def?.description ?? ""}</small>
                          </button>
                        );
                      })}
                    </div>
                    <button
                      className="secondary-action"
                      data-testid="passive-reward-skip"
                      type="button"
                      onClick={() => {
                        telemetryRef.current = recordHumanPassiveReward(currentTelemetry(), {
                          layer: run.combatIndex,
                          passiveId: null,
                        });
                        commitRun(choosePassiveReward(run, null, contentDb));
                      }}
                    >
                      패시브 보상 건너뛰기
                    </button>
                  </div>
                ) : null}
              </>
            ) : run.phase === "ready" ? (
              <>
                <p className="run-kicker">{NODE_KIND_KO[currentNodeFor(run)?.kind ?? "combat"]} 노드</p>
                <h1>
                  {currentNodeFor(run)?.kind === "boss"
                    ? "보스전"
                    : currentNodeFor(run)?.kind === "elite"
                      ? "엘리트 전투"
                      : "다음 전투"}
                </h1>
                <p>
                  {enemyNameFor(run)} · HP {run.currentHp}/{run.maxHp}
                </p>
                <p>체력은 회복되지 않고 그대로 이어집니다.</p>
                <button data-testid="next-combat" ref={primaryRef} type="button" onClick={startNextCombat}>
                  노드 {run.combatIndex + 1}/{run.graph.layers.length} 전투 시작
                </button>
              </>
            ) : run.phase === "event" && run.pendingEvent !== undefined ? (
              (() => {
                const def = (contentDb.events ?? {})[String(run.pendingEvent.eventId)];
                if (def === undefined) return null;
                const needsPick = def.risk === "gold" || def.risk === "coin";
                const riskLine =
                  def.risk === "combat"
                    ? "엘리트 전투 — 패배하면 런이 끝난다"
                    : def.risk === "hp"
                      ? `체력 ${def.hpCost} 감소`
                      : def.risk === "gold"
                        ? `골드 ${def.goldCost} 지불 + 기본 코인 1개 영구 변환`
                        : "기본 코인 1개 제거";
                const rewardLine =
                  def.risk === "combat"
                    ? `승리 시 골드 70 + 희귀 스킬 ${def.rareSkillOptions}종 진열`
                    : "대표 속성 코인 1개";
                const acceptDisabled =
                  (def.risk === "hp" && run.currentHp <= def.requireCurrentHpAbove) ||
                  (def.risk === "gold" && run.gold < def.goldCost) ||
                  (needsPick && eventPick === null);
                const disabledReason =
                  def.risk === "hp" && run.currentHp <= def.requireCurrentHpAbove
                    ? "체력이 부족합니다."
                    : def.risk === "gold" && run.gold < def.goldCost
                      ? "골드가 부족합니다."
                      : needsPick && eventPick === null
                        ? "대상 기본 코인을 먼저 고릅니다."
                        : null;
                return (
                  <EventScreen
                    acceptDisabled={acceptDisabled}
                    acceptLabel={def.risk === "combat" ? "맞서 싸운다" : "수락한다"}
                    coinPicks={
                      needsPick
                        ? run.bag.map((coin, bagIndex) => ({
                            bagIndex,
                            name: coinName(coin),
                            visualClass: String(contentDb.coins[String(coin)]?.element ?? ""),
                            pickable: String(coin) === "basic",
                          }))
                        : null
                    }
                    disabledReason={disabledReason}
                    name={def.name}
                    prompt={def.prompt}
                    rejection={eventRejection}
                    rewardLine={rewardLine}
                    riskLine={riskLine}
                    selectedPick={eventPick}
                    onAccept={() =>
                      runEventAction(
                        () => acceptEvent(run, contentDb, needsPick ? (eventPick ?? undefined) : undefined),
                        {
                          action: "accept",
                          ...(needsPick && eventPick !== null ? { choice: eventPick } : {}),
                        },
                      )
                    }
                    onDecline={() =>
                      runEventAction(() => declineEvent(run, contentDb), {
                        action: "decline",
                      })
                    }
                    onPick={(bagIndex) => {
                      setEventRejection(null);
                      setEventPick(bagIndex);
                    }}
                  />
                );
              })()
            ) : run.phase === "choose-node" ? (
              <NodeChoice
                iconFor={(kind) =>
                  kind === "shop" ? (
                    <EmberIcon scale={2.4} />
                  ) : kind === "elite" || kind === "boss" ? (
                    <SkullIcon scale={2.4} />
                  ) : kind === "rest" ? (
                    <HeartIcon scale={2.4} />
                  ) : kind === "treasure" ? (
                    <EmberIcon scale={2.4} />
                  ) : kind === "event" ? (
                    <HeartIcon scale={2.4} />
                  ) : (
                    <SwordIcon scale={2.4} />
                  )
                }
                currentLayer={run.combatIndex}
                layerLabel={`노드 ${run.combatIndex + 1}/${run.graph.layers.length}`}
                options={(run.graph.layers[run.combatIndex] ?? []).map((node, index) => ({
                  index,
                  kind: node.kind,
                  title: NODE_KIND_KO[node.kind] ?? node.kind,
                  detail:
                    node.kind === "shop"
                      ? "골드로 동전·스킬·패시브 구매, 동전 제거"
                      : node.kind === "event"
                        ? "위험과 보상 — 무엇이 기다리는지 모른다"
                        : node.kind === "rest"
                          ? "최대 체력 30% 회복 또는 스킬 강화"
                          : node.kind === "treasure"
                            ? "금화 100과 패시브가 잠들어 있다"
                            : (node.encounter ?? [])
                                .map((enemy) => contentDb.enemies[String(enemy)]?.name ?? "적")
                                .join("·"),
                }))}
                totalLayers={run.graph.layers.length}
                visitedKinds={run.graph.layers.slice(0, run.combatIndex).map((layer, index) => layer[run.nodeChoices[index] ?? 0]?.kind ?? "combat")}
                onChoose={(index) => {
                  telemetryRef.current = recordHumanNodeChoice(currentTelemetry(), {
                    layer: run.combatIndex,
                    choice: index,
                  });
                  commitRun(chooseRunNode(run, index, contentDb));
                }}
              />
            ) : run.phase === "rest" ? (
              <section aria-label="휴식" className="rest-screen" data-testid="rest-screen">
                <p className="run-kicker">휴식 노드</p>
                <h1>모닥불</h1>
                <p>
                  회복하거나, 장착 스킬 하나를 강화합니다. HP {run.currentHp}/{run.maxHp}
                </p>
                <button
                  data-testid="rest-heal"
                  ref={primaryRef}
                  type="button"
                  onClick={() => {
                    telemetryRef.current = recordHumanRestChoice(currentTelemetry(), {
                      layer: run.combatIndex,
                      choice: "heal",
                    });
                    commitRun(restHeal(run, contentDb));
                  }}
                >
                  최대 체력 30% 회복 (+{Math.floor(run.maxHp * 0.3)})
                </button>
                <div aria-label="강화할 스킬 선택" className="rest-upgrade-list">
                  {run.equippedSkills.map((skill, index) => {
                    if (skill === null) return null;
                    const def = contentDb.skills[String(skill)];
                    const upgradable = def?.upgrade !== undefined && !run.upgradedSlots[index];
                    const reason =
                      def?.upgrade === undefined
                        ? "강화가 정의되지 않은 스킬"
                        : run.upgradedSlots[index]
                          ? "이미 강화됨"
                          : (def.upgrade.description ?? "");
                    return (
                      <button
                        className={`rest-upgrade ${upgradable ? "" : "locked"}`}
                        data-testid={`rest-upgrade-${index}`}
                        disabled={!upgradable}
                        key={`${String(skill)}-${index}`}
                        title={reason}
                        type="button"
                        onClick={() => {
                          telemetryRef.current = recordHumanRestChoice(currentTelemetry(), {
                            layer: run.combatIndex,
                            choice: "upgrade",
                            slot: index,
                          });
                          commitRun(restUpgrade(run, index, contentDb));
                        }}
                      >
                        <strong>
                          {def?.name ?? String(skill)}
                          {run.upgradedSlots[index] ? " ＋" : ""}
                        </strong>
                        <small>
                          {def?.upgrade !== undefined
                            ? `강화: ${def.upgrade.name} — ${def.upgrade.description}`
                            : "강화 불가"}
                        </small>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : run.phase === "treasure" && run.pendingTreasure !== undefined ? (
              <section aria-label="보물" className="treasure-screen" data-testid="treasure-screen">
                <p className="run-kicker">보물 노드</p>
                <h1>봉인된 상자</h1>
                <p>금화 100이 들어 있습니다.</p>
                {run.pendingTreasure.passiveOption !== null ? (
                  <p className="treasure-passive">
                    ★{" "}
                    {(contentDb.passives ?? {})[String(run.pendingTreasure.passiveOption)]?.name ??
                      String(run.pendingTreasure.passiveOption)}
                    {" — "}
                    {(contentDb.passives ?? {})[String(run.pendingTreasure.passiveOption)]?.description ?? ""}
                  </p>
                ) : (
                  <p className="treasure-passive">패시브 풀이 비어 금화만 남았습니다.</p>
                )}
                <button
                  data-testid="treasure-claim"
                  ref={primaryRef}
                  type="button"
                  onClick={() => {
                    telemetryRef.current = recordHumanTreasure(currentTelemetry(), {
                      layer: run.combatIndex,
                      passiveId:
                        run.pendingTreasure?.passiveOption === null || run.pendingTreasure === undefined
                          ? null
                          : String(run.pendingTreasure.passiveOption),
                    });
                    commitRun(claimTreasure(run, contentDb));
                  }}
                >
                  상자를 연다
                </button>
              </section>
            ) : run.phase === "shop" && run.pendingShop !== undefined ? (
              <ShopScreen
                gold={run.gold}
                removalPrice={75 + 25 * run.shopRemovals}
                coinOffers={run.pendingShop.coinOptions.map((coin, index) => ({
                  id: String(coin),
                  name: coinName(coin),
                  price: run.pendingShop?.coinPrices[index] ?? 0,
                  visualClass: String(contentDb.coins[String(coin)]?.element ?? ""),
                }))}
                skillOffers={run.pendingShop.skillOptions.map((skill, index) => {
                  const skillDef = contentDb.skills[String(skill)];
                  return {
                    id: String(skill),
                    name: skillDef?.name ?? String(skill),
                    price: run.pendingShop?.skillPrices[index] ?? 0,
                    rarityName: skillRarityName(skill),
                    card: <SkillRewardMark scale={2.6} skill={skill} />,
                    effects:
                      skillDef === undefined ? null : (
                        <CardEffectRows
                          bloodSwordPower={runBloodSwordPower}
                          displayName={skillDisplayName(skillDef, runBloodSwordPower)}
                          skill={skillDef}
                        />
                      ),
                  };
                })}
                passiveOffers={(run.pendingShop.passiveOptions ?? []).map((passiveId, index) => ({
                  id: String(passiveId),
                  name: (contentDb.passives ?? {})[String(passiveId)]?.name ?? String(passiveId),
                  description: (contentDb.passives ?? {})[String(passiveId)]?.description ?? "",
                  price: run.pendingShop?.passivePrices?.[index] ?? 0,
                }))}
                bagCoins={run.bag.map((coin, bagIndex) => ({
                  bagIndex,
                  name: coinName(coin),
                  visualClass: String(contentDb.coins[String(coin)]?.element ?? ""),
                }))}
                rejection={shopRejection}
                skillPick={shopSkillPick}
                slotLabels={run.equippedSkills.map((skill) =>
                  skill === null ? "빈 슬롯" : (contentDb.skills[String(skill)]?.name ?? String(skill)),
                )}
                lockedSlots={run.equippedSkills.map((skill) => isLockedSkill(contentDb, skill))}
                onBuyCoin={(index) =>
                  runShopAction(() => buyShopCoin(run, index, contentDb), {
                    kind: "buy-coin",
                    option: index,
                  })
                }
                onBuyPassive={(index) =>
                  runShopAction(() => buyShopPassive(run, index, contentDb), {
                    kind: "buy-passive",
                    option: index,
                  })
                }
                onPickSkill={(index) => {
                  setShopRejection(null);
                  setShopSkillPick(index);
                }}
                onConfirmSkill={(slot) =>
                  runShopAction(
                    () => {
                      const next = buyShopSkill(run, shopSkillPick ?? -1, contentDb, slot);
                      setShopSkillPick(null);
                      return next;
                    },
                    { kind: "buy-skill", option: shopSkillPick ?? -1, slot },
                  )
                }
                onCancelSkill={() => setShopSkillPick(null)}
                onRemoveCoin={(bagIndex) =>
                  runShopAction(() => buyShopRemoval(run, bagIndex, contentDb), { kind: "remove-coin", bagIndex })
                }
                onLeave={() =>
                  runShopAction(() => leaveShop(run, contentDb), {
                    kind: "leave",
                  })
                }
              />
            ) : (
              <>
                <p className="run-kicker">전투 {completedCombatCount(run)} 완료</p>
                <h1>{run.phase === "victory" ? "런 승리" : "런 패배"}</h1>
                <p>
                  최종 HP {run.currentHp}/{run.maxHp}
                </p>
                <p>시드 {run.runSeed}</p>
                <button
                  aria-label="같은 시드로 재시작"
                  data-testid="restart-same-seed"
                  ref={primaryRef}
                  type="button"
                  onClick={() => restartRun(run.runSeed)}
                >
                  같은 시드로 새 런
                </button>
                <button
                  className="secondary-action"
                  data-testid="play-log-download"
                  type="button"
                  onClick={exportPlayLog}
                >
                  플레이 로그 저장
                </button>
                <button
                  className="secondary-action"
                  data-testid="new-seed"
                  type="button"
                  onClick={() => restartRun(randomSeed())}
                >
                  새 시드
                </button>
              </>
            )}
          </section>
        </div>
      </main>
      {runMenuControls}
    </>
  );
};

export const App = () => {
  const [boot, setBoot] = useState<BootState>(bootState);
  const [titleSettingsOpen, setTitleSettingsOpen] = useState(false);
  const [titlePreferences, setTitlePreferences] = useState<CombatPreferences>(loadCombatPreferences);

  const changeTitlePreferences = (next: CombatPreferences) => {
    saveCombatPreferences(next);
    setMuted(!next.sound);
    setTitlePreferences(next);
  };

  const openCharacterSelect = (practice: boolean) => {
    try {
      clearRun(window.localStorage);
    } catch {
      // 저장소가 막혀도 메모리 세션으로 새 런을 시작할 수 있다.
    }
    const seed = randomSeed();
    replaceUrlWithSelection(seed, practice);
    setBoot({ mode: "select", practice, seed });
  };

  const startNewRun = () => openCharacterSelect(false);
  const startTutorialPractice = () => openCharacterSelect(true);

  const loadSavedRun = () => {
    const detailed = loadRunDetailed(window.localStorage, CONTENT_VERSION, contentDb);
    if (detailed.status === "corrupt" || detailed.status === "unsupported") {
      setBoot({ mode: "corrupt-save", reason: "invalid" });
      return;
    }
    if (detailed.status === "retired-character") {
      setBoot({ mode: "corrupt-save", reason: "retired-character" });
      return;
    }
    if (detailed.save === null) {
      replaceUrlWithTitle();
      setBoot({ mode: "title", save: null });
      return;
    }
    setBoot({ mode: "run", session: savedSession(detailed.save) });
  };

  const exitToTitle = (run: RunState) => {
    persistRun(run);
    replaceUrlWithTitle();
    setBoot({ mode: "title", save: titleSaveSummary(run) });
  };

  if (boot.mode === "title") {
    return (
      <main aria-label="타이틀 화면" className="run-stage-shell" data-run-phase="title" data-testid="run-phase">
        <div className="backdrop" aria-hidden="true">
          <img alt="" className="backdrop-img" src={bgForest} />
        </div>
        {titleSettingsOpen ? (
          <TitleSettings value={titlePreferences} onBack={() => setTitleSettingsOpen(false)} onChange={changeTitlePreferences} />
        ) : (
          <TitleScreen
            save={boot.save}
            onContinue={loadSavedRun}
            onNewRun={startNewRun}
            onSettings={() => setTitleSettingsOpen(true)}
            onTutorial={() => setBoot({ mode: "tutorial", save: boot.save })}
          />
        )}
      </main>
    );
  }

  if (boot.mode === "tutorial") {
    return (
      <main aria-label="튜토리얼 화면" className="run-stage-shell" data-run-phase="tutorial" data-testid="run-phase">
        <div className="backdrop" aria-hidden="true"><img alt="" className="backdrop-img" src={bgForest} /></div>
        <TutorialScreen
          onBack={() => setBoot({ mode: "title", save: boot.save })}
          onStartPractice={startTutorialPractice}
        />
      </main>
    );
  }

  if (boot.mode === "corrupt-save") {
    return (
      <main
        aria-label="저장 복구 화면"
        className="run-stage-shell"
        data-run-phase="corrupt-save"
        data-testid="run-phase"
      >
        <div className="backdrop" aria-hidden="true">
          <img alt="" className="backdrop-img" src={bgForest} />
        </div>
        <section className="boot-recovery" role="alert">
          <h1>{boot.reason === "retired-character" ? "이어할 수 없는 런입니다" : "저장 데이터를 읽을 수 없습니다"}</h1>
          <p>
            {boot.reason === "retired-character"
              ? "수호자는 로스터에서 제외되어 이 런을 이어갈 수 없습니다. 새 런을 시작하면 기존 저장은 삭제됩니다."
              : "저장이 손상되었거나 알 수 없는 형식입니다. 기존 저장은 이어할 수 없으며, 새 런을 시작하면 삭제됩니다."}
          </p>
          <button
            data-testid="corrupt-save-restart"
            type="button"
            onClick={() => {
              try {
                clearRun(window.localStorage);
              } catch {
                // 저장소 접근 불가 시에도 새 런 진입은 가능해야 한다
              }
              window.location.replace(`${window.location.pathname}?select=1`);
            }}
          >
            새 런 시작
          </button>
        </section>
      </main>
    );
  }

  if (boot.mode === "select") {
    return (
      <main
        aria-label="런 시작 화면"
        className="run-stage-shell"
        data-run-phase="character-select"
        data-testid="run-phase"
      >
        <div className="backdrop" aria-hidden="true">
          <img alt="" className="backdrop-img" src={bgForest} />
        </div>
        <CharacterSelect
          artByCharacter={Object.fromEntries(
            Object.values(contentDb.characters).map((character) => [
              String(character.id),
              characterSelectArt(character.id),
            ]),
          )}
          characters={Object.values(contentDb.characters)}
          contentDb={contentDb}
          seed={boot.seed}
          onSelect={(character) => {
            const seed = boot.seed ?? randomSeed();
            replaceUrlSeed(seed, character);
            const session = freshSession(seed, character, boot.practice);
            persistRun(session.run);
            setBoot({ mode: "run", session });
          }}
        />
      </main>
    );
  }
  return (
    <RunGame
      initialSession={boot.session}
      key={`${boot.session.run.runSeed}-${String(boot.session.run.character)}-${boot.session.run.combatIndex}-${boot.session.run.attempt}-${boot.session.run.phase}`}
      onExitToTitle={exitToTitle}
      onLoadSaved={loadSavedRun}
      onStartNewRun={startNewRun}
    />
  );
};

interface CombatBoardProps {
  combat: CombatState;
  preferences: CombatPreferences;
  utilityPanel: CombatUtilityPanel;
  run: RunState;
  onComplete: (combat: CombatState) => void;
  onPreferencesChange: (next: CombatPreferences) => void;
  onUtilityPanelChange: (panel: CombatUtilityPanel) => void;
  onTelemetryCombatStart: (combat: CombatState) => void;
  onTelemetryDecision: (
    before: CombatState,
    commands: readonly Command[],
    after: CombatState,
    events: readonly CombatEvent[],
    source?: "manual" | "auto-turn-end",
  ) => void;
}

const CombatBoard = ({
  combat,
  preferences,
  utilityPanel,
  run,
  onComplete,
  onPreferencesChange,
  onUtilityPanelChange,
  onTelemetryCombatStart,
  onTelemetryDecision,
}: CombatBoardProps) => {
  const flipSpeed = preferences.flipSpeed;
  const combatDb = useMemo(() => upgradedContentDb(run, contentDb), [run]);
  const [state, dispatchState] = useReducer(combatReducer, combat);
  const [selectedCoin, setSelectedCoin] = useState<CoinUid | null>(null);
  const [fuelSelection, setFuelSelection] = useState<FuelSelection | null>(null);
  const [coinChoice, setCoinChoice] = useState<CoinChoiceSelection | null>(null);
  const [immediateSelection, setImmediateSelection] = useState<{
    slot: SlotId;
    coins: CoinUid[];
  } | null>(null);
  const [preserveSelection, setPreserveSelection] = useState<PreserveSelection | null>(null);
  const [queue, setQueue] = useState<CombatEvent[]>([]);
  const [locked, setLocked] = useState(false);
  const [coinFaces, setCoinFaces] = useState<CoinFaces>({});
  const [flipping, setFlipping] = useState<Record<number, boolean>>({});
  const [resolving, setResolving] = useState<{
    slot: number;
    coins: CoinUid[];
  } | null>(null);
  const [floats, setFloats] = useState<FloatText[]>([]);
  const [rejection, setRejection] = useState<RejectionChip | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [targeting, setTargeting] = useState<TargetingSelection | null>(null);
  const [summonTargeting, setSummonTargeting] = useState<TargetingCommand | null>(null);
  const [equipmentChoice, setEquipmentChoice] = useState<TargetingCommand | null>(null);
  const [choiceExecution, setChoiceExecution] = useState<ChoiceExecutionContext | null>(null);
  const [autoTurnEnd, setAutoTurnEnd] = useState<AutoTurnEndState>(() => createIdleAutoTurnEnd());
  const [lastAttackTarget, setLastAttackTarget] = useState<number | null>(null);
  const [shakeCoin, setShakeCoin] = useState<CoinUid | null>(null);
  const [openPile, setOpenPile] = useState<CoinPileZone | null>(null);
  const [resolutionTicket, setResolutionTicket] = useState<ResolutionSummary | null>(null);
  const [coinRailPosition, setCoinRailPosition] = useState(0);
  const [coinRailMaxPosition, setCoinRailMaxPosition] = useState(0);
  const [previewSlot, setPreviewSlot] = useState<number | null>(null);
  const [vfx, setVfx] = useState<Set<string>>(() => new Set());
  const skillCardRefs = useRef<Array<{ current: HTMLElement | null }>>(state.slots.map(() => ({ current: null })));
  const pouchRef = useRef<HTMLDivElement | null>(null);
  const pileCountsRef = useRef<HTMLDivElement | null>(null);
  const drawPileButtonRef = useRef<HTMLButtonElement | null>(null);
  const discardPileButtonRef = useRef<HTMLButtonElement | null>(null);
  const exhaustedPileButtonRef = useRef<HTMLButtonElement | null>(null);
  const endTurnButtonRef = useRef<HTMLButtonElement | null>(null);
  const handTrayRef = useRef<HTMLDivElement | null>(null);
  const pendingResolution = useRef<PendingResolution | null>(null);
  const resolutionTimer = useRef<number | null>(null);
  const nextFloatId = useRef(1);
  const nextRejectionId = useRef(1);
  const rejectionTimer = useRef<number | null>(null);
  const initialEventsQueued = useRef(false);
  const completionSent = useRef(false);
  const suppressClick = useRef(false);
  const launchedExecutionTokens = useRef<Set<string>>(new Set());
  const preserveWorkflowRequested = useRef<string | null>(null);
  const legal = useMemo(() => legalCommands(state, combatDb), [combatDb, state]);
  const executionBusy =
    autoTurnEnd.phase === "running" ||
    autoTurnEnd.phase === "choosing" ||
    autoTurnEnd.phase === "preserving" ||
    autoTurnEnd.phase === "blocked";
  const unusedElementalCoins = useMemo(() => unusedElementalCoinCount(state), [state]);
  const custodyCoinCount = state.custody.reduce((count, entry) => count + entry.coins.length, 0);
  const custodyOwners = [...new Set(state.custody.map((entry) => enemyDisplayName(state.enemies[entry.sourceEnemy])))];

  const selectCoin = (coin: CoinUid | null) => setSelectedCoin(coin);

  const clearResolutionTicket = () => {
    if (resolutionTimer.current !== null) {
      window.clearTimeout(resolutionTimer.current);
      resolutionTimer.current = null;
    }
    setResolutionTicket(null);
  };

  const showResolutionTicket = (pending: PendingResolution) => {
    const skill = combatDb.skills[String(pending.skillId)];
    if (skill === undefined) return;
    const summary = withCombatEventResolutionLines(buildResolutionSummary(skill, pending.events), pending.events);
    clearResolutionTicket();
    setResolutionTicket(summary);
    resolutionTimer.current = window.setTimeout(() => {
      setResolutionTicket(null);
      resolutionTimer.current = null;
    }, 7000);
  };

  const triggerVfx = (key: string, duration = 360) => {
    setVfx((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    window.setTimeout(() => {
      setVfx((current) => new Set(current).add(key));
      window.setTimeout(() => {
        setVfx((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }, duration);
    }, 0);
  };

  useEffect(() => {
    onTelemetryCombatStart(combat);
  }, [combat, onTelemetryCombatStart]);


  useEffect(() => {
    const sync = () => {
      const rail = handTrayRef.current;
      if (rail === null) return;
      const metrics = coinRailMetrics(rail);
      setCoinRailPosition(metrics.current);
      setCoinRailMaxPosition(metrics.max);
    };
    const frame = window.requestAnimationFrame(sync);
    window.addEventListener("resize", sync);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", sync);
    };
  }, [state.zones.hand.length]);


  useEffect(() => {
    if (!initialEventsQueued.current && state.events.length > 0) {
      initialEventsQueued.current = true;
      setLocked(true);
      setQueue(state.events);
    }
  }, [state.events]);

  // 더미 인스펙터 — 한 번에 하나만 열고 Escape·바깥 클릭으로 닫는다
  useEffect(() => {
    if (openPile === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPile(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      const insidePouch = pouchRef.current?.contains(event.target) === true;
      const insidePileCounts = pileCountsRef.current?.contains(event.target) === true;
      const insidePortalPopover =
        event.target instanceof Element && event.target.closest('[data-overlay-layer="popover"]') !== null;
      if (!insidePouch && !insidePileCounts && !insidePortalPopover) setOpenPile(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [openPile]);

  useEffect(() => {
    if (previewSlot === null) return undefined;
    const closePreview = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(`[data-slot="${previewSlot}"]`) === null) setPreviewSlot(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewSlot(null);
    };
    document.addEventListener("pointerdown", closePreview);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", closePreview);
      document.removeEventListener("keydown", onKey);
    };
  }, [previewSlot]);

  const togglePile = (zone: CoinPileZone) => setOpenPile((open) => (open === zone ? null : zone));

  const findLegal = (cmd: Command): Command | undefined => legal.find((candidate) => sameCommand(candidate, cmd));

  const withTarget = (command: TargetingCommand, target: number): TargetingCommand => ({ ...command, target });

  const targetingCommandFor = (command: TargetingCommand): TargetingCommand | undefined =>
    legal.find(
      (candidate): candidate is TargetingCommand =>
        (candidate.type === "useFlipSkill" || candidate.type === "useConsumeSkill") &&
        candidate.type === command.type &&
        candidate.slot === command.slot &&
        (candidate.type !== "useFlipSkill" ||
          command.type !== "useFlipSkill" ||
          candidate.reservationId === command.reservationId) &&
        (candidate.type !== "useConsumeSkill" ||
          command.type !== "useConsumeSkill" ||
          (candidate.coins.length === command.coins.length &&
            candidate.coins.every((coin, index) => coin === command.coins[index]))),
    );

  const commandRequiresTargeting = (command: TargetingCommand): boolean =>
    legalTargetsForCommand(legal, command).length > 0;

  const showRejection = (text: string) => {
    if (showResult) return;
    if (rejectionTimer.current !== null) window.clearTimeout(rejectionTimer.current);
    const id = nextRejectionId.current;
    nextRejectionId.current += 1;
    setRejection({ id, text });
    rejectionTimer.current = window.setTimeout(() => {
      setRejection((chip) => (chip?.id === id ? null : chip));
      rejectionTimer.current = null;
    }, 1500);
  };

  useEffect(
    () => () => {
      if (rejectionTimer.current !== null) window.clearTimeout(rejectionTimer.current);
      if (resolutionTimer.current !== null) window.clearTimeout(resolutionTimer.current);
    },
    [],
  );

  const commit = (nextState: CombatState, events: CombatEvent[]) => {
    dispatchState({ type: "set", state: nextState });
    selectCoin(null);
    setFuelSelection(null);
    setCoinChoice(null);
    setTargeting(null);
    setSummonTargeting(null);
    setEquipmentChoice(null);
    setChoiceExecution(null);
    setPreviewSlot(null);
    // 코인 걸기/취소는 상태 반영이 곧 피드백이다. 큐·잠금 없이 연속 사용이 이어진다.
    const immediate = events.filter((event) => event.type === "coinPlaced" || event.type === "coinUnplaced");
    const reducedMotion = motionIsReduced(preferences.reducedMotion);
    for (const event of immediate) {
      if (!reducedMotion) for (const cue of feedbackCuesFor(event)) triggerVfx(cue.key, cue.duration);
      for (const cue of sfxCuesFor(event)) playSfx(cue);
    }
    const animated = events.filter((event) => event.type !== "coinPlaced" && event.type !== "coinUnplaced");
    if (animated.length > 0) {
      setLocked(true);
      setQueue((pending) => [...pending, ...animated]);
    }
    const skillUsed = events.find((event) => event.type === "skillUsed");
    if (skillUsed !== undefined) {
      pendingResolution.current = { skillId: skillUsed.skill, events };
    }
  };

  const runCommand = (
    cmd: Command,
    showFeedback = false,
    source: "manual" | "auto-turn-end" = "manual",
  ): boolean => {
    if (locked) {
      if (showFeedback) showRejection(REJECTION_TEXT.notPlayerPhase);
      return false;
    }
    const reason = rejectionReason(state, cmd, combatDb);
    if (reason !== null) {
      if (showFeedback) showRejection(reason);
      return false;
    }
    const legalCommand = findLegal(cmd);
    if (legalCommand === undefined) {
      if (showFeedback) showRejection(REJECTION_TEXT.generic);
      return false;
    }
    const result = step(state, legalCommand, combatDb);
    if (!result.ok) {
      if (showFeedback) showRejection(REJECTION_TEXT.generic);
      return false;
    }
    if (!(source === "auto-turn-end" && legalCommand.type === "endTurn"))
      clearResolutionTicket();
    onTelemetryDecision(state, [legalCommand], result.state, result.events, source);
    if (
      (legalCommand.type === "useFlipSkill" || legalCommand.type === "useConsumeSkill") &&
      legalCommand.target !== undefined
    )
      setLastAttackTarget(legalCommand.target);
    commit(result.state, result.events);
    return true;
  };

  const runExplicitCommand = (
    cmd: Command,
    showFeedback = false,
    source: "manual" | "auto-turn-end" = "manual",
  ): boolean => {
    if (locked) {
      if (showFeedback) showRejection(REJECTION_TEXT.notPlayerPhase);
      return false;
    }
    const result = step(state, cmd, combatDb);
    if (!result.ok) {
      if (showFeedback) showRejection(REJECTION_TEXT.generic);
      return false;
    }
    if (!(source === "auto-turn-end" && cmd.type === "endTurn"))
      clearResolutionTicket();
    onTelemetryDecision(state, [cmd], result.state, result.events, source);
    if ((cmd.type === "useFlipSkill" || cmd.type === "useConsumeSkill") && cmd.target !== undefined)
      setLastAttackTarget(cmd.target);
    commit(result.state, result.events);
    return true;
  };

  const beginOrConfirmPreserve = (source: DecisionSource = "manual"): boolean => {
    if (preserveSelection === null) {
      const selection = beginPreserveSelection(state, combatDb);
      if (selection === null) return runCommand({ type: "endTurn" }, true, source);
      selectCoin(null);
      setFuelSelection(null);
      setCoinChoice(null);
      setTargeting(null);
      setSummonTargeting(null);
      setEquipmentChoice(null);
      setChoiceExecution(null);
      setOpenPile(null);
      setPreserveSelection(selection);
      return true;
    }
    const committed = runExplicitCommand(preserveSelectionCommand(preserveSelection), true, source);
    if (committed) setPreserveSelection(null);
    return committed;
  };

  const runSequence = (commands: readonly Command[], showFeedback = false): boolean => {
    if (locked || commands.length === 0) {
      if (showFeedback && locked) showRejection(REJECTION_TEXT.notPlayerPhase);
      else if (showFeedback) showRejection(REJECTION_TEXT.generic);
      return false;
    }
    const result = stepSequence(state, commands, combatDb);
    if (result === null) {
      if (showFeedback) {
        const reason =
          commands
            .map((command) => rejectionReason(state, command, combatDb))
            .find((candidate): candidate is string => candidate !== null) ?? REJECTION_TEXT.generic;
        showRejection(reason);
      }
      return false;
    }
    clearResolutionTicket();
    onTelemetryDecision(state, commands, result.state, result.events, "manual");
    commit(result.state, result.events);
    return true;
  };

  const updateCoinRailPosition = () => {
    const rail = handTrayRef.current;
    if (rail === null) return;
    const metrics = coinRailMetrics(rail);
    setCoinRailPosition(metrics.current);
    setCoinRailMaxPosition(metrics.max);
  };

  const scrollCoinRail = (direction: -1 | 1) => {
    const rail = handTrayRef.current;
    if (rail === null) return;
    const coins = [...rail.querySelectorAll<HTMLElement>(".coin")];
    if (coins.length === 0) return;
    const next = Math.max(0, Math.min(coins.length - 1, coinRailPosition + direction));
    const target = coins[next];
    if (target === undefined) return;
    rail.scrollTo({
      left: Math.max(0, target.offsetLeft - 44),
      behavior: motionIsReduced(preferences.reducedMotion) ? "auto" : "smooth",
    });
  };

  // 즉시 사용 시 플립 스킬의 코인을 고스트로 붙잡아 해결 연출 대상이 되게 한다.
  const openExecutionChoice = (
    kind: ExecutionChoice,
    source: DecisionSource,
    token: string | null,
  ) => {
    setChoiceExecution({ kind, source, token });
    if (source === "auto-turn-end" && token !== null)
      setAutoTurnEnd((current) => pauseForExecutionChoice(current, token, kind));
  };

  const resumeExecutionAfterChoice = (source: DecisionSource, token: string | null) => {
    setChoiceExecution(null);
    if (source === "auto-turn-end" && token !== null)
      setAutoTurnEnd((current) => resumeExecutionChoice(current, token));
  };

  const useSkill = (
    cmd: Command,
    showFeedback = true,
    source: DecisionSource = "manual",
    executionToken: string | null = null,
  ): boolean => {
    setFuelSelection(null);
    setCoinChoice(null);
    setPreserveSelection(null);
    setTargeting(null);
    setSummonTargeting(null);
    setEquipmentChoice(null);
    resumeExecutionAfterChoice(source, executionToken);
    if (cmd.type === "useFlipSkill") {
      const reservation =
        cmd.reservationId === undefined
          ? undefined
          : state.flipReservations.find((candidate) => candidate.id === cmd.reservationId);
      const ghosts = [...(reservation?.coinUids ?? state.zones.placed[cmd.slot] ?? [])];
      const committed = runExplicitCommand(cmd, showFeedback, source);
      if (committed && ghosts.length > 0) setResolving({ slot: Number(cmd.slot), coins: ghosts });
      return committed;
    }
    if (cmd.type === "useConsumeSkill") return runExplicitCommand(cmd, showFeedback, source);
    return runCommand(cmd, showFeedback, source);
  };

  const beginSummonTargeting = (
    command: TargetingCommand,
    showFeedback = true,
    source: DecisionSource = "manual",
    executionToken: string | null = null,
  ): boolean => {
    if (state.summons.length === 0) {
      if (showFeedback) showRejection("선택할 소환 장비가 없다");
      return false;
    }
    selectCoin(null);
    setFuelSelection(null);
    setCoinChoice(null);
    setPreserveSelection(null);
    setTargeting(null);
    setEquipmentChoice(null);
    setSummonTargeting({ ...command, chosenSummon: undefined });
    openExecutionChoice("summon", source, executionToken);
    return true;
  };

  const beginEquipmentChoice = (
    command: TargetingCommand,
    source: DecisionSource = "manual",
    executionToken: string | null = null,
  ): boolean => {
    selectCoin(null);
    setFuelSelection(null);
    setCoinChoice(null);
    setPreserveSelection(null);
    setTargeting(null);
    setSummonTargeting(null);
    setEquipmentChoice(command);
    openExecutionChoice("equipment", source, executionToken);
    return true;
  };

  const confirmSummonTargeting = (chosenSummon: number): boolean => {
    if (summonTargeting === null) return false;
    const context = choiceExecution ?? { kind: "summon" as const, source: "manual" as const, token: null };
    const command = { ...summonTargeting, chosenSummon };
    setSummonTargeting(null);
    if (commandRequiresTargeting(command))
      return beginTargeting(command, true, context.source, context.token);
    return useSkill(command, true, context.source, context.token);
  };

  const beginTargeting = (
    command: TargetingCommand,
    showFeedback = true,
    source: DecisionSource = "manual",
    executionToken: string | null = null,
  ): boolean => {
    const legalTargets = legalTargetsForCommand(legal, command).filter(
      (target, index, targets) => targets.indexOf(target) === index,
    );
    if (legalTargets.length === 0) {
      if (showFeedback) showRejection(REJECTION_TEXT.generic);
      return false;
    }
    if (livingEnemyTargets(state.enemies).length < 2 || legalTargets.length === 1) {
      const target = legalTargets[0];
      if (target === undefined) return false;
      return useSkill(withTarget(command, target), showFeedback, source, executionToken);
    }
    const selected = defaultTarget(legalTargets, lastAttackTarget);
    if (selected === null) {
      if (showFeedback) showRejection(REJECTION_TEXT.generic);
      return false;
    }
    selectCoin(null);
    setFuelSelection(null);
    setCoinChoice(null);
    setPreserveSelection(null);
    setEquipmentChoice(null);
    setTargeting({ command, legalTargets, selected });
    openExecutionChoice("enemy-target", source, executionToken);
    return true;
  };

  const confirmTargeting = (target = targeting?.selected): boolean => {
    if (targeting === null || target === undefined) return false;
    if (!targeting.legalTargets.includes(target)) {
      showRejection(REJECTION_TEXT.generic);
      return true;
    }
    const context = choiceExecution ?? { kind: "enemy-target" as const, source: "manual" as const, token: null };
    return useSkill(withTarget(targeting.command, target), true, context.source, context.token);
  };

  const routeSkill = (
    skill: NonNullable<(typeof combatDb.skills)[string]>,
    command: TargetingCommand,
    showFeedback: boolean,
    selectedFuel = false,
    equipmentConfirmed = false,
    source: DecisionSource = "manual",
    executionToken: string | null = null,
  ): boolean => {
    if (
      command.type === "useFlipSkill" &&
      requiresEquipmentChoice(state, command, combatDb) &&
      !equipmentConfirmed
    )
      return beginEquipmentChoice(command, source, executionToken);
    else if (skillRequiresSummonChoice(skill))
      return beginSummonTargeting(command, showFeedback, source, executionToken);
    else if (commandRequiresTargeting(command))
      return beginTargeting(command, showFeedback, source, executionToken);
    else if (selectedFuel) return runExplicitCommand(command, showFeedback, source);
    return useSkill(command, showFeedback, source, executionToken);
  };

  const confirmEquipmentChoice = (equipmentId: string): boolean => {
    if (equipmentChoice === null) return false;
    const context = choiceExecution ?? { kind: "equipment" as const, source: "manual" as const, token: null };
    const command = equipmentChoiceCommand(
      state,
      equipmentChoice,
      equipmentId as EquipmentDefId,
      combatDb,
    );
    if (command === null) {
      showRejection(REJECTION_TEXT.generic);
      return false;
    }
    setEquipmentChoice(null);
    const slotState = state.slots[Number(command.slot)];
    const skill = slotState === undefined ? undefined : combatDb.skills[String(slotState.skillId)];
    if (skill === undefined) return false;
    return routeSkill(skill, command, true, false, true, context.source, context.token);
  };

  const activateConsumeSkill = (
    slotId: SlotId,
    skill: NonNullable<(typeof combatDb.skills)[string]>,
    autoCommand: Extract<Command, { type: "useConsumeSkill" }> | undefined,
    showFeedback = true,
  ) => {
    if (skill.type !== "consume") return;
    // count==1 deliberately keeps the existing App path: use the single
    // legalCommands auto suggestion immediately, without fuel-selection state.
    if (!requiresFuelSelection(state, slotId, combatDb)) {
      if (autoCommand !== undefined) {
        routeSkill(skill, autoCommand, showFeedback);
      } else
        runCommand(
          {
            type: "useConsumeSkill",
            slot: slotId,
            coins: [],
            target: skill.targetType === "single-enemy" ? 0 : undefined,
          },
          showFeedback,
        );
      return;
    }
    if (fuelSelection?.slot !== slotId) {
      const coins = autoSuggestFuel(state, slotId, combatDb);
      const requirement = fuelRequirement(state, slotId, combatDb);
      if (requirement === null || requirement.available < requirement.min) {
        const reason = rejectionReason(
          state,
          {
            type: "useConsumeSkill",
            slot: slotId,
            coins: [],
            target: skill.targetType === "single-enemy" ? 0 : undefined,
          },
          combatDb,
        );
        if (showFeedback) showRejection(reason ?? REJECTION_TEXT.coinCost);
        return;
      }
      selectCoin(null);
      setCoinChoice(null);
      setTargeting(null);
      setPreserveSelection(null);
      setFuelSelection({ slot: slotId, coins });
      return;
    }
    const command = fuelCommand(fuelSelection, state, combatDb);
    if (command === null) {
      if (showFeedback) showRejection(REJECTION_TEXT.coinCost);
      return;
    }
    routeSkill(skill, command, showFeedback, true);
  };

  const activateFlipSkill = (
    slotId: SlotId,
    skill: NonNullable<(typeof combatDb.skills)[string]>,
    autoCommand: Extract<Command, { type: "useFlipSkill" }> | undefined,
    showFeedback = true,
    source: DecisionSource = "manual",
    executionToken: string | null = null,
  ): boolean => {
    if (skill.type !== "flip") return false;
    if (!requiresCoinChoiceSelection(state, slotId, combatDb)) {
      if (autoCommand !== undefined) {
        return routeSkill(skill, autoCommand, showFeedback, false, false, source, executionToken);
      } else {
        const coins = autoSuggestCoinChoice(state, slotId, combatDb);
        const command = coinChoiceCommand({ slot: slotId, coins }, state, combatDb);
        if (command !== null) {
          return routeSkill(skill, command, showFeedback, false, false, source, executionToken);
        } else
          return runCommand(
            {
              type: "useFlipSkill",
              slot: slotId,
              target: skill.targetType === "single-enemy" ? 0 : undefined,
            },
            showFeedback,
            source,
          );
      }
    }
    if (coinChoice?.slot !== slotId) {
      selectCoin(null);
      setFuelSelection(null);
      setTargeting(null);
      setPreserveSelection(null);
      setCoinChoice({
        slot: slotId,
        coins: autoSuggestCoinChoice(state, slotId, combatDb),
      });
      openExecutionChoice("coin", source, executionToken);
      return true;
    }
    const command = coinChoiceCommand(coinChoice, state, combatDb);
    if (command === null) {
      if (showFeedback) showRejection(REJECTION_TEXT.coinCost);
      return false;
    }
    const context = choiceExecution ?? { kind: "coin" as const, source, token: executionToken };
    return routeSkill(skill, command, showFeedback, false, false, context.source, context.token);
  };

  const toggleImmediateCoin = (slotId: SlotId, coin: CoinUid, cost: number): boolean => {
    if (!state.zones.hand.includes(coin)) return false;
    setImmediateSelection((current) => {
      const currentSelection = current?.slot === slotId ? current : { slot: slotId, coins: [] };
      const base = currentSelection.coins;
      const index = base.indexOf(coin);
      if (index >= 0) {
        return {
          slot: slotId,
          coins: base.filter((candidate) => candidate !== coin),
        };
      }
      if (base.length >= cost) return currentSelection;
      return { slot: slotId, coins: [...base, coin] };
    });
    selectCoin(null);
    setCoinChoice(null);
    return true;
  };

  const useImmediateFlipSkill = (
    slotId: SlotId,
    skill: Extract<SkillDef, { type: "flip" }>,
    coins: readonly CoinUid[],
  ): boolean => {
    if (coins.length !== skill.cost) {
      showRejection(REJECTION_TEXT.coinCost);
      return false;
    }
    const target = skill.targetType === "single-enemy" ? (lastAttackTarget ?? livingEnemyTargets(state.enemies)[0]) : undefined;
    const command: Extract<Command, { type: "useImmediateFlipSkill" }> = {
      type: "useImmediateFlipSkill",
      slot: slotId,
      coins: [...coins],
      ...(target === undefined ? {} : { target }),
    };
    const committed = runExplicitCommand(command, true);
    if (committed) {
      setResolving({ slot: Number(slotId), coins: [...coins] });
      setImmediateSelection(null);
    }
    return committed;
  };

  const onFuelCoinClick = (coin: CoinUid): boolean => {
    if (fuelSelection === null) return false;
    const next = toggleFuel(fuelSelection, coin, state, combatDb);
    if (next === fuelSelection) {
      const slotState = state.slots[Number(fuelSelection.slot)];
      const skill = slotState === undefined ? undefined : combatDb.skills[String(slotState.skillId)];
      const reason = rejectionReason(
        state,
        {
          type: "useConsumeSkill",
          slot: fuelSelection.slot,
          coins: [...fuelSelection.coins, coin],
          target: skill?.targetType === "single-enemy" ? 0 : undefined,
        },
        combatDb,
      );
      showRejection(reason ?? REJECTION_TEXT.generic);
      return true;
    }
    selectCoin(null);
    setFuelSelection(next);
    return true;
  };

  const onCoinChoiceClick = (coin: CoinUid): boolean => {
    if (coinChoice === null) return false;
    const next = toggleCoinChoice(coinChoice, coin, state, combatDb);
    if (next === coinChoice) {
      showRejection(REJECTION_TEXT.generic);
      return true;
    }
    selectCoin(null);
    setCoinChoice(next);
    return true;
  };

  const onPreserveCoinClick = (coin: CoinUid): boolean => {
    if (preserveSelection === null) return false;
    const next = togglePreservedCoin(preserveSelection, coin);
    if (next === preserveSelection && !preserveSelection.locked.includes(coin)) {
      showRejection("더 이상 보존할 수 없다");
    }
    selectCoin(null);
    setPreserveSelection(next);
    return true;
  };

  const cancelAutomaticExecution = () => {
    setAutoTurnEnd((current) => cancelAutoTurnEnd(current));
    setChoiceExecution(null);
    setPreserveSelection(null);
    selectCoin(null);
    setFuelSelection(null);
    setCoinChoice(null);
    setTargeting(null);
    setSummonTargeting(null);
    setEquipmentChoice(null);
    preserveWorkflowRequested.current = null;
  };

  const cancelActiveChoice = () => {
    if (choiceExecution?.source === "auto-turn-end") {
      cancelAutomaticExecution();
      return;
    }
    setChoiceExecution(null);
    setCoinChoice(null);
    setTargeting(null);
    setSummonTargeting(null);
    setEquipmentChoice(null);
  };

  useEffect(() => {
    const combatEnded = state.phase === "victory" || state.phase === "defeat";
    if (combatEnded) {
      if (executionBusy) setAutoTurnEnd((current) => cancelAutoTurnEnd(current));
      return;
    }
    if (autoTurnEnd.phase === "preserving") {
      if (locked || queue.length > 0 || resolving !== null || preserveSelection !== null) return;
      const workflowId = autoTurnEnd.workflowId;
      if (workflowId === null || preserveWorkflowRequested.current === workflowId) return;
      preserveWorkflowRequested.current = workflowId;
      const needsChoice = beginPreserveSelection(state, combatDb) !== null;
      const accepted = beginOrConfirmPreserve("auto-turn-end");
      if (!accepted) {
        preserveWorkflowRequested.current = null;
        return;
      }
      if (!needsChoice) setAutoTurnEnd((current) => finishAutoTurnEnd(current));
      return;
    }
    if (autoTurnEnd.phase !== "running") return;
    if (
      locked ||
      queue.length > 0 ||
      resolving !== null ||
      coinChoice !== null ||
      targeting !== null ||
      summonTargeting !== null ||
      equipmentChoice !== null
    )
      return;
    if (autoTurnEnd.active === null) {
      setAutoTurnEnd((current) => activateNextExecution(current));
      return;
    }

    const { reservationId, slot: activeSlot, token } = autoTurnEnd.active;
    const slotState = state.slots[Number(activeSlot)];
    const skill = slotState === undefined ? undefined : combatDb.skills[String(slotState.skillId)];
    const reservation = state.flipReservations.find((candidate) => candidate.id === reservationId);
    if (skill?.type !== "flip") {
      setAutoTurnEnd((current) =>
        blockActiveExecution(current, token, "실행할 플립 스킬을 찾을 수 없습니다."),
      );
      return;
    }
    if (reservation === undefined) {
      if (launchedExecutionTokens.current.has(token))
        setAutoTurnEnd((current) => completeActiveExecution(current, token));
      else
        setAutoTurnEnd((current) =>
          blockActiveExecution(current, token, "코인 걸기 상태가 바뀌었습니다. 선택한 코인을 확인하세요."),
        );
      return;
    }
    if (launchedExecutionTokens.current.has(token)) return;

    const attempt = {
      type: "useFlipSkill" as const,
      slot: activeSlot,
      reservationId,
      target: skill.targetType === "single-enemy" ? 0 : undefined,
    };
    const command = targetingCommandFor(attempt);
    if (command === undefined || command.type !== "useFlipSkill") {
      const reason = rejectionReason(state, attempt, combatDb) ?? "현재 이 스킬을 실행할 수 없습니다.";
      setAutoTurnEnd((current) => blockActiveExecution(current, token, reason));
      return;
    }
    launchedExecutionTokens.current.add(token);
    const accepted = activateFlipSkill(activeSlot, skill, command, true, "auto-turn-end", token);
    if (!accepted) {
      launchedExecutionTokens.current.delete(token);
      setAutoTurnEnd((current) =>
        blockActiveExecution(current, token, "선택을 시작할 수 없습니다. 코인과 대상을 확인하세요."),
      );
    }
  }, [
    autoTurnEnd,
    choiceExecution,
    coinChoice,
    equipmentChoice,
    executionBusy,
    locked,
    preserveSelection,
    queue.length,
    resolving,
    state,
    summonTargeting,
    targeting,
  ]);

  useEffect(() => {
    if (!locked) return undefined;
    const reducedMotion = motionIsReduced(preferences.reducedMotion);
    const timing = flipTiming(flipSpeed, reducedMotion);
    if (queue.length === 0) {
      // 플립 결과 면을 잠시 붙잡아 읽을 시간을 준 뒤 고스트 해제와 함께 잠금을 푼다
      if (resolving !== null) {
        const hold = window.setTimeout(() => {
          setResolving(null);
          if (pendingResolution.current !== null) {
            showResolutionTicket(pendingResolution.current);
            pendingResolution.current = null;
          }
          setLocked(false);
        }, timing.resolveHoldMs);
        return () => window.clearTimeout(hold);
      }
      if (pendingResolution.current !== null) {
        showResolutionTicket(pendingResolution.current);
        pendingResolution.current = null;
      }
      setLocked(false);
      return undefined;
    }

    const [event, ...rest] = queue;
    const showFloat = (text: string, target: "player" | "enemy", kind: FloatText["kind"], enemy?: number) => {
      const id = nextFloatId.current;
      nextFloatId.current += 1;
      setFloats((items) => [...items, { id, text, target, enemy, kind }]);
      window.setTimeout(() => setFloats((items) => items.filter((item) => item.id !== id)), 900);
    };

    let delay = 180;
    if (
      event !== undefined &&
      !reducedMotion &&
      !(event.type === "coinFlipped" && !timing.animate)
    ) {
      for (const cue of feedbackCuesFor(event)) triggerVfx(cue.key, cue.duration);
    }
    if (event !== undefined) for (const cue of sfxCuesFor(event)) playSfx(cue);
    if (event?.type === "coinFlipped") {
      if (timing.animate) {
        setFlipping((items) => ({ ...items, [Number(event.coin)]: true }));
        window.setTimeout(() => {
          setCoinFaces((faces) => coinFacesAfterEvent(faces, event));
          setFlipping((items) => ({ ...items, [Number(event.coin)]: false }));
          triggerVfx(`coin-${Number(event.coin)}`, timing.revealVfxMs);
        }, timing.animationMs);
      } else {
        setCoinFaces((faces) => coinFacesAfterEvent(faces, event));
        setFlipping((items) => ({ ...items, [Number(event.coin)]: false }));
      }
    } else if (event?.type === "coinsDrawn") {
      setCoinFaces((faces) => coinFacesAfterEvent(faces, event));
      delay = 220;
    } else if (event?.type === "damageDealt") {
      showFloat(
        `-${event.amount}`,
        event.target.type === "player" ? "player" : "enemy",
        "damage",
        event.target.type === "enemy" ? event.target.index : undefined,
      );
      delay = event.source === "enemy" ? 520 : 420;
    } else if (event?.type === "blockGained") {
      showFloat(
        `+${event.amount}`,
        event.target.type === "player" ? "player" : "enemy",
        "block",
        event.target.type === "enemy" ? event.target.index : undefined,
      );
      delay = 360;
    } else if (event?.type === "statusApplied") {
      showFloat(
        `${statusKo(event.status)} +${event.stacks}`,
        event.target.type === "player" ? "player" : "enemy",
        "status",
        event.target.type === "enemy" ? event.target.index : undefined,
      );
      delay = 380;
    } else if (event?.type === "statusTicked") {
      showFloat(
        event.status === "poison"
          ? `중독 피해 ${event.amount} · 유지 ${event.remaining}`
          : `${statusKo(event.status)} -${event.amount}`,
        event.target.type === "player" ? "player" : "enemy",
        "status",
        event.target.type === "enemy" ? event.target.index : undefined,
      );
      delay = 460;
    } else if (event?.type === "witherApplied") {
      showFloat(`다음 드로우 -${event.amount}`, "player", "status");
      delay = 460;
    } else if (event?.type === "enemyPassiveTriggered") {
      const owner = state.enemies[event.enemy];
      const passiveDef = owner === undefined ? undefined : combatDb.enemies[String(owner.defId)]?.passive;
      if (passiveDef !== undefined) {
        showFloat(`★ ${passiveDef.name}`, "enemy", "status", event.enemy);
        delay = 320;
      }
    } else if (event?.type === "enemyHealed") {
      if (event.amount > 0) {
        showFloat(`회복 +${event.amount}`, "enemy", "status", event.enemy);
        delay = 380;
      }
    } else if (event?.type === "coinCreated") {
      showFloat("임시 코인", "player", "coin");
      delay = 320;
    } else if (event?.type === "overheatScheduled") {
      showFloat("과열 예약", "player", "status");
      delay = 360;
    } else if (event?.type === "overheatActivated") {
      showFloat("과열", "player", "status");
      delay = 420;
    } else if (event?.type === "echoComputed") {
      if (event.total > 0) showFloat(`반향 ${event.total}`, "player", "block");
      delay = 380;
    } else if (event?.type === "echoSpent") {
      showFloat(`증폭 +${event.amount}`, "player", "damage");
      delay = 420;
    } else if (event?.type === "enemyWindupStarted") {
      showFloat(`준비 ${event.turnsLeft}턴`, "enemy", "status", event.enemy);
      delay = 360;
    } else if (event?.type === "enemyWindupTicked") {
      showFloat(`준비 ${event.turnsLeft}턴`, "enemy", "status", event.enemy);
      delay = 360;
    } else if (event?.type === "enemyWindupCancelled") {
      showFloat("준비 취소", "enemy", "status", event.enemy);
      delay = 420;
    } else if (event?.type === "enemyFurnaceChanged") {
      showFloat(`용광로 ${event.before}→${event.after}`, "enemy", "status", event.enemy);
      delay = 380;
    } else if (event?.type === "enemyPhaseChanged") {
      showFloat("페이즈 전환", "enemy", "status", event.enemy);
      delay = 460;
    } else if (event?.type === "enemyGrew") {
      showFloat(`성장 ${event.stacks}`, "enemy", "status", event.enemy);
      delay = 380;
    } else if (event?.type === "enemyCleansed") {
      showFloat(`정화 ${event.statuses.map(statusKo).join("·")}`, "enemy", "status", event.enemy);
      delay = 400;
    } else if (event?.type === "enemyHealFailed") {
      showFloat("치유 실패", "enemy", "status", event.enemy);
      delay = 380;
    } else if (event?.type === "turnTriggerAdded") {
      for (const trigger of state.turnTriggers) {
        if (trigger.trigger.id === event.trigger) triggerVfx(`turn-trigger-${trigger.uid}`, 320);
      }
      delay = 260;
    } else if (event?.type === "turnTriggerFired") {
      for (const trigger of state.turnTriggers) {
        if (trigger.trigger.id === event.trigger) triggerVfx(`turn-trigger-${trigger.uid}`, 360);
      }
      delay = 320;
    } else if (event?.type === "turnTriggersExpired") {
      delay = 260;
    } else if (event?.type === "coinsDiscarded") {
      delay = 320;
    } else if (event?.type === "coinsConsumed") {
      delay = 380;
    } else if (event?.type === "pileShuffled") {
      delay = 520;
    } else if (event?.type === "intentRevealed") {
      delay = 260;
    }

    const queueDelay =
      event?.type === "coinFlipped"
        ? timing.queueDelayMs
        : !timing.animate && rest[0]?.type === "coinFlipped"
          ? 0
          : reducedMotion
            ? 0
            : delay + 150;
    const timer = window.setTimeout(() => setQueue(rest), queueDelay);
    return () => window.clearTimeout(timer);
  }, [flipSpeed, locked, queue, resolving, state.turnTriggers]);

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (drag === null) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    // 터치는 손떨림 오검출을 막기 위해 임계 상향 (P5.1 감사: 6 → 12)
    const threshold = event.pointerType === "touch" ? 12 : 6;
    if (!drag.started && Math.hypot(dx, dy) < threshold) return;
    const under = document.elementFromPoint(event.clientX, event.clientY);
    const card = under?.closest("[data-slot]") ?? null;
    const overSlot = card === null ? null : Number(card.getAttribute("data-slot"));
    const socketElement = under?.closest(".socket[data-coin]") ?? null;
    const socketCoinValue = socketElement?.getAttribute("data-coin") ?? null;
    const overCoin = socketCoinValue === null ? null : (Number(socketCoinValue) as CoinUid);
    const canSwap = overCoin !== null && drag.swapTargets.has(Number(overCoin));
    const requiresSwap =
      drag.source.kind === "socket" && overCoin !== null && overCoin !== drag.coin;
    setDrag({
      ...drag,
      started: true,
      x: event.clientX,
      y: event.clientY,
      over:
        overSlot !== null && (requiresSwap ? canSwap : drag.targets.has(overSlot))
          ? overSlot
          : null,
      overCoin: canSwap ? overCoin : null,
      overCard: overSlot,
      overTray: (under?.closest(".hand-tray") ?? null) !== null,
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (drag === null) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag.started) {
      // 이동 없는 눌림 = 클릭 — click 핸들러가 선택/회수를 처리한다
      setDrag(null);
      return;
    }
    suppressClick.current = true;
    // 자기 카드 위에 놓기 = 취소 (현재 선택 유지) — 밖으로 끌어내야 회수
    if (drag.source.kind === "socket" && drag.overCard === Number(drag.source.slot) && drag.over === null) {
      setDrag(null);
      return;
    }
    const target =
      drag.over !== null
        ? ({
            kind: "slot",
            slot: slot(drag.over),
            ...(drag.overCoin === null ? {} : { coin: drag.overCoin }),
          } as const)
        : drag.overTray
          ? ({ kind: "tray" } as const)
          : ({ kind: "none" } as const);
    const commands = dropCommands(drag.coin, drag.source, target);
    const committed = commands !== null && runSequence(commands, true);
    // 무효 드롭 피드백 — 손패 코인을 트레이에 되돌린 경우는 자연스러운 취소라 흔들지 않는다
    if (!committed && !(drag.source.kind === "hand" && drag.overTray)) {
      if (commands === null) showRejection(REJECTION_TEXT.generic);
      setShakeCoin(drag.coin);
      window.setTimeout(() => setShakeCoin(null), 320);
    }
    setDrag(null);
  };

  const cancelDrag = () => {
    setDrag(null);
  };

  useEffect(() => {
    if (fuelSelection === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFuelSelection(null);
      if (event.key === "Enter") {
        if (isInteractiveKeyTarget(event.target)) return;
        event.preventDefault();
        const slotState = state.slots[Number(fuelSelection.slot)];
        const skill = slotState === undefined ? undefined : combatDb.skills[String(slotState.skillId)];
        if (skill !== undefined) activateConsumeSkill(fuelSelection.slot, skill, undefined, true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fuelSelection]);

  useEffect(() => {
    if (coinChoice === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancelActiveChoice();
        return;
      }
      if (event.key !== "Enter") return;
      if (isInteractiveKeyTarget(event.target)) return;
      event.preventDefault();
      const slotState = state.slots[Number(coinChoice.slot)];
      const skill = slotState === undefined ? undefined : combatDb.skills[String(slotState.skillId)];
      if (skill !== undefined) activateFlipSkill(coinChoice.slot, skill, undefined, true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [coinChoice]);

  useEffect(() => {
    if (preserveSelection === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (autoTurnEnd.phase === "preserving") cancelAutomaticExecution();
        else setPreserveSelection(null);
        return;
      }
      if (event.key !== "Enter") return;
      if (isInteractiveKeyTarget(event.target)) return;
      event.preventDefault();
      const source = autoTurnEnd.phase === "preserving" ? "auto-turn-end" : "manual";
      const committed = beginOrConfirmPreserve(source);
      if (committed && source === "auto-turn-end")
        setAutoTurnEnd((current) => finishAutoTurnEnd(current));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [autoTurnEnd.phase, preserveSelection]);

  useEffect(() => {
    if (targeting === null && summonTargeting === null && equipmentChoice === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancelActiveChoice();
        return;
      }
      if (targeting === null) return;
      if (event.key === "Enter") {
        event.preventDefault();
        confirmTargeting();
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const selected = cycleTarget(
        targeting.legalTargets,
        targeting.selected,
        event.key === "ArrowLeft" ? "left" : "right",
      );
      if (selected !== null) setTargeting({ ...targeting, selected });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [equipmentChoice, summonTargeting, targeting]);

  const clickGuard = (): boolean => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return true;
    }
    return false;
  };

  const ended = state.phase === "victory" || state.phase === "defeat";
  const showResult = ended && !locked && queue.length === 0 && resolving === null && floats.length === 0;
  const activeEvent = queue[0];
  const totalIntentDamage = enemyIntentDamageTotal(state.enemies);
  const discardReceiving =
    activeEvent?.type === "coinsDiscarded" || (activeEvent?.type === "coinCreated" && activeEvent.zone === "discard");
  const exhaustReceiving = activeEvent?.type === "coinsConsumed";
  const pouchReceiving = activeEvent?.type === "pileShuffled";
  const pileFlowText =
    activeEvent?.type === "coinsDiscarded"
      ? `버림 +${activeEvent.coins.length}`
      : activeEvent?.type === "coinsConsumed"
        ? `소모 +${activeEvent.coins.length}`
        : activeEvent?.type === "pileShuffled"
          ? `버림 ${activeEvent.count} → 주머니`
          : activeEvent?.type === "coinCreated" && activeEvent.zone === "discard"
            ? "임시 동전 → 버림"
            : null;
  const spritePlayKey = activeEvent?.type === "damageDealt" ? queue.length : 0;
  const playerMotion = spriteMotionForEvent("player", activeEvent);
  const dragging = drag !== null && drag.started;
  const isTestEncounter = testEncounterFromUrl() !== null;
  const targetingSkill =
    targeting === null ? undefined : combatDb.skills[String(state.slots[Number(targeting.command.slot)]?.skillId)];
  useEffect(() => {
    if (!showResult || completionSent.current) return;
    completionSent.current = true;
    onComplete(state);
  }, [onComplete, showResult, state]);

  useEffect(() => {
    if (ended) {
      setOpenPile(null);
      setFuelSelection(null);
      setCoinChoice(null);
      setTargeting(null);
      setSummonTargeting(null);
      setEquipmentChoice(null);
      setChoiceExecution(null);
      setPreviewSlot(null);
    }
  }, [ended]);

  return (
    <main
      className="combat-shell"
      aria-label="전투 화면"
      data-attempt={run.attempt}
      data-bag={run.bag.map(String).join(",")}
      data-combat-index={run.combatIndex}
      data-current-hp={run.currentHp}
      data-equipped-skills={run.equippedSkills.map(String).join(",")}
      data-flip-speed={flipSpeed}
      data-screen-shake={preferences.screenShake ? "on" : "off"}
      data-damage-number-size={preferences.damageNumberSize}
      data-tooltip-size={preferences.tooltipSize}
      data-high-contrast={String(preferences.highContrast)}
      data-background-effects={preferences.backgroundEffects}
      data-reduced-motion={String(preferences.reducedMotion)}
      data-sound={preferences.sound ? "on" : "off"}
      data-auto-turn-end-phase={autoTurnEnd.phase}
      data-test-encounter={isTestEncounter ? "duo-raiders" : undefined}
      data-run-phase={run.phase}
      style={{
        "--damage-number-scale": preferences.damageNumberSize === "large" ? 1.35 : 1,
        "--tooltip-font-scale": preferences.tooltipSize === "large" ? 1.2 : 1,
      } as CSSProperties}
    >
      <div className="backdrop" aria-hidden="true">
        <img alt="" className="backdrop-img" src={bgForest} onError={(event) => event.currentTarget.remove()} />
      </div>
      <RunMeta
        run={run}
        preferences={preferences}
        onPreferencesChange={onPreferencesChange}
        preferencesOpen={utilityPanel === "preferences"}
        onPreferencesOpenChange={(open) => onUtilityPanelChange(open ? "preferences" : null)}
        passivesOpen={utilityPanel === "passives"}
        onPassivesOpenChange={(open) => onUtilityPanelChange(open ? "passives" : null)}
      />
      <CombatHelp
        open={utilityPanel === "help"}
        onOpenChange={(open) => onUtilityPanelChange(open ? "help" : null)}
      />
      {isTestEncounter ? (
        <span className="test-encounter-badge" aria-label="테스트 전용 전투 진입로">
          TEST duo-raiders
        </span>
      ) : null}
      <TurnBuffBar triggers={state.turnTriggers} vfx={vfx} />
      <section
        className={`battlefield ${targeting !== null || equipmentChoice !== null ? "choice-open" : ""}`}
      >
        {targeting !== null ? (
          <div aria-live="polite" className="preserve-picker targeting-prompt">
            <strong>{targetingSkill?.name ?? "스킬"}</strong>의 대상을 선택하세요
            <button
              aria-label="대상 선택 취소"
              className="preserve-placed-coin"
              type="button"
              onClick={cancelActiveChoice}
            >
              선택 취소
            </button>
          </div>
        ) : null}
        {equipmentChoice !== null ? (
          <div
            aria-live="polite"
            className="preserve-picker targeting-prompt"
            data-testid="equipment-choice"
          >
            <strong>소환할 장비 종류를 선택하세요</strong>
            {equipmentChoiceOptions(combatDb).map((equipment) => (
              <button
                aria-label={`${equipment.name}: ${equipment.description}`}
                className="preserve-placed-coin"
                data-testid={`equipment-choice-${String(equipment.id)}`}
                key={String(equipment.id)}
                type="button"
                onClick={() => confirmEquipmentChoice(String(equipment.id))}
              >
                {equipment.name}
              </button>
            ))}
            <button
              aria-label="장비 종류 선택 취소"
              className="preserve-placed-coin"
              type="button"
              onClick={cancelActiveChoice}
            >
              선택 취소
            </button>
          </div>
        ) : null}
        <UnitPanel
          side="player"
          unitKey="player"
          sprite={playerSprite(run.character)}
          name={combatDb.characters[String(run.character)]?.name ?? "영웅"}
          hp={state.player.hp}
          maxHp={state.player.maxHp}
          block={state.player.block}
          statuses={state.player.statuses}
          skillSeals={Object.entries(state.player.skillSeals).flatMap(([slotIndex, seal]) => {
            if (seal === undefined || seal.turns <= 0) return [];
            const slotState = state.slots[Number(slotIndex)];
            const skill = combatDb.skills[String(slotState?.skillId)];
            return [
              {
                effectMultiplier: seal.effectMultiplier,
                name: skill === undefined ? `스킬 ${Number(slotIndex) + 1}` : skillDisplayName(skill, state.player.bloodSwordPower),
                slot: Number(slotIndex),
                turns: seal.turns,
              },
            ];
          })}
          pendingOverheat={shouldShowOverheatBadges(run.character) ? state.player.pendingOverheat : false}
          overheat={shouldShowOverheatBadges(run.character) ? state.player.overheat : false}
          armorEchoHud={
            shouldShowArmorEchoHud(run.character)
              ? {
                  current: state.player.armorEcho,
                  available: state.player.armorEchoAvailable,
                  armed: state.player.precisionDefenseArmed,
                  preview: armorEchoPreview(state.player, totalIntentDamage),
                  preheat: state.player.echoPreheat,
                  totalIntentDamage,
                }
              : undefined
          }
          weaponOutput={run.character === "arcanist" ? state.player.weaponOutput : undefined}
          remiseCharges={run.character === "sorcerer" ? state.player.remiseCharges : undefined}
          bloodSwordPower={run.character === "blood-spellblade" ? state.player.bloodSwordPower : undefined}
          bloodSwordInvestment={run.character === "blood-spellblade" ? state.player.bloodSwordInvestment : undefined}
          floats={floats}
          motion={playerMotion}
          playKey={playerMotion === "idle" ? 0 : spritePlayKey}
          vfx={vfx}
        />
        {state.summons.length > 0 ||
        (combatDb.characters[String(run.character)]?.trait.effects ?? []).some(
          (effect) => effect.kind === "summonEquipment",
        ) ? (
          <div aria-label="소환 장비 슬롯" className="summon-rail" data-testid="summon-rail">
            {summonTargeting !== null ? <span aria-live="polite">효과를 적용할 기존 소환 선택</span> : null}
            {Array.from({ length: 3 }, (_, slotIndex) => {
              const summon = state.summons[slotIndex];
              if (summon === undefined) {
                return <span aria-hidden="true" className="summon-slot empty" key={`empty-${slotIndex}`} />;
              }
              const def = (combatDb.equipment ?? {})[String(summon.defId)];
              const isWard = def?.action.kind === "ward";
              return (
                <Keyword
                  className="summon-slot-host"
                  entry={{
                    label: def?.name ?? String(summon.defId),
                    description: `${def?.description ?? ""} · 남은 지속 ${summon.duration}${summon.enhance > 0 ? ` · 강화 +${summon.enhance}` : ""}${summon.aoeUses > 0 ? ` · 광역 ${summon.aoeUses}회` : ""}`,
                  }}
                  key={summon.uid}
                  term="passive"
                >
                  <button
                    aria-label={`${def?.name ?? "장비"} 지속 ${summon.duration}${summon.enhance > 0 ? ` 강화 +${summon.enhance}` : ""}${summon.aoeUses > 0 ? ` 광역 ${summon.aoeUses}회` : ""}${summonTargeting !== null ? " 선택" : ""}`}
                    aria-disabled={summonTargeting === null || locked}
                    className={`summon-slot ${isWard ? "ward" : "strike"}`}
                    data-testid={`summon-slot-${slotIndex}`}
                    data-selectable={summonTargeting !== null || undefined}
                    onClick={() => {
                      if (summonTargeting !== null && !locked) confirmSummonTargeting(summon.uid);
                    }}
                    style={vfx.has(`summon-${summon.uid}`) ? feedbackPulse : undefined}
                    type="button"
                  >
                    {isWard ? <ShieldIcon scale={1.6} /> : <SwordIcon scale={1.6} />}
                    <em className="summon-duration">{summon.duration}</em>
                    {summon.enhance > 0 ? <em className="summon-enhance">+{summon.enhance}</em> : null}
                    {summon.aoeUses > 0 ? <em className="summon-enhance">전체 {summon.aoeUses}</em> : null}
                  </button>
                </Keyword>
              );
            })}
          </div>
        ) : null}
        <div className="enemy-line" aria-label="적 목록" data-enemy-count={state.enemies.length}>
          {state.enemies.map((enemy, index) => {
            const enemyDef = combatDb.enemies[String(enemy.defId)];
            const targetLegal = targeting?.legalTargets.includes(index) === true;
            const targetSelected = targeting?.selected === index;
            const enemyMotion =
              activeEvent?.type === "damageDealt" &&
              activeEvent.target.type === "enemy" &&
              activeEvent.target.index === index
                ? spriteMotionForEvent("enemy", activeEvent)
                : "idle";
            return (
              <UnitPanel
                key={`enemy-${enemy.enemyUid}`}
                side="enemy"
                unitKey={`enemy-${index}`}
                sprite={enemySprite(String(enemy.defId))}
                name={enemyDef?.name ?? "적"}
                hp={enemy.hp}
                maxHp={enemy.maxHp}
                block={enemy.block}
                statuses={enemy.statuses}
                intent={<IntentBadge enemies={state.enemies} enemy={enemy} custody={state.custody} coins={state.coins} />}
                floats={floats}
                motion={enemyMotion}
                playKey={enemyMotion === "idle" ? 0 : spritePlayKey}
                vfx={vfx}
                enemyIndex={index}
                targeting={targeting !== null && targetLegal}
                targetSelected={targetSelected}
                onTarget={targetLegal ? () => confirmTargeting(index) : undefined}
                attackBuff={enemy.nextAttackBonus}
                passive={enemyDef?.passive}
                phaseIndex={enemy.phaseIndex}
                damageTakenMultiplier={enemy.damageTakenMultiplier}
                growthStacks={enemy.growthStacks}
                growthLabel={enemyDef?.growthLabel}
                playerTurnEndPunishment={enemyDef?.playerTurnEndPunishment}
                unusedElementalCoins={unusedElementalCoins}
                roundGrowth={enemy.roundGrowth}
                damageTakenThisRound={enemy.damageTakenThisRound}
                protectionLink={enemy.protectionLink}
                protectionTargetName={
                  enemy.protectionLink === undefined ? undefined : enemyDisplayName(state.enemies[enemy.protectionLink.target])
                }
                protectedBy={(() => {
                  const protector = state.enemies.find(
                    (candidate) => candidate.hp > 0 && candidate.protectionLink?.active === true && candidate.protectionLink.target === index,
                  );
                  if (protector === undefined) return undefined;
                  return {
                    name: enemyDisplayName(protector),
                    redirectPercent: Math.round((protector.protectionLink?.redirectFraction ?? 0) * 100),
                  };
                })()}
                petrify={{
                  active: enemy.petrifyActive === true,
                  rawDamage: enemy.petrifyRawDamage ?? 0,
                  reductionPercent: Math.round((enemy.petrifyDamageReduction ?? 0) * 100),
                  threshold: Math.ceil(enemy.maxHp * (enemy.petrifyShatterRawDamageFraction ?? 0)),
                  crackedTurns: enemy.crackedTurns ?? 0,
                  crackedPercent: Math.round(((enemy.petrifyCrackedDamageTakenMultiplier ?? 1) - 1) * 100),
                  divePrepared: enemy.windup?.intent.id === "falling-assault",
                  diveCancelled: enemy.cancelledWindupIntentId === "falling-assault",
                }}
                march={
                  enemy.marchTurns !== undefined && enemy.marchTurns > 0
                    ? {
                        attackPercent: Math.round((enemy.marchAttackPercent ?? 0) * 100),
                        shield: enemy.marchShield ?? 0,
                        sourceName: enemyDisplayName(state.enemies[enemy.marchSource ?? -1]),
                        turns: enemy.marchTurns,
                      }
                    : undefined
                }
                warBannerAuraPercent={
                  enemyDef?.warBanner === undefined ? undefined : Math.round(enemyDef.warBanner.attackAuraPercent * 100)
                }
                auraSourceName={(() => {
                  const source = state.enemies.find(
                    (candidate, candidateIndex) =>
                      candidateIndex !== index &&
                      candidate.hp > 0 &&
                      combatDb.enemies[String(candidate.defId)]?.warBanner !== undefined,
                  );
                  return source === undefined ? undefined : enemyDisplayName(source);
                })()}
                auraSourcePercent={(() => {
                  const source = state.enemies.find(
                    (candidate, candidateIndex) =>
                      candidateIndex !== index &&
                      candidate.hp > 0 &&
                      combatDb.enemies[String(candidate.defId)]?.warBanner !== undefined,
                  );
                  const aura = source === undefined ? undefined : combatDb.enemies[String(source.defId)]?.warBanner;
                  return aura === undefined ? undefined : Math.round(aura.attackAuraPercent * 100);
                })()}
              />
            );
          })}
        </div>
      </section>

      <section
        className={`skill-row ${locked ? "dimmed" : ""}`}
        aria-label="스킬 카드"
        onScroll={() => setPreviewSlot(null)}
      >
        <div className="resolution-ticket-anchor" aria-live="polite">
          {resolutionTicket !== null ? <ResolutionTicket summary={resolutionTicket} /> : null}
        </div>
        {state.slots.map((slotState, index) => {
          const baseSkill = combatDb.skills[String(slotState.skillId)];
          // P6 D3 — 강화 슬롯은 코어와 같은 파생 정본으로 표시 (수치 이중 표기 방지)
          const upgraded = run.upgradedSlots[index] === true;
          const skill = baseSkill;
          const displaySkillName =
            skill === undefined ? "빈 슬롯" : skillDisplayName(skill, state.player.bloodSwordPower);
          const immediate = immediateSelection?.slot === slot(index) ? immediateSelection : null;
          const immediateCoins = immediate?.coins ?? [];
          // Legacy reservations are intentionally ignored by the v4.5 surface.
          // Keep inert placeholders until the compatibility reducer is removed.
          const slotReservations: never[] = [];
          const queuedPosition = -1;
          const partialQueued = false;
          const consumeUse = legal.find(
            (command): command is Extract<Command, { type: "useConsumeSkill" }> =>
              command.type === "useConsumeSkill" && command.slot === slot(index),
          );
          const canPlace =
            skill?.type === "flip" &&
            selectedCoin !== null &&
            immediateCoins.length < skill.cost &&
            state.zones.hand.includes(selectedCoin);
          const dropTarget = false;
          // 프리뷰는 사용 커맨드가 합법일 때만 (§3.5 preview → Preview | null) — 부분 선택·
          // 쿨다운·전투당 1회·전투 종료 등 코어가 해결을 거부하는 모든 상태를 legalCommands가 거른다
          const preview = null as unknown as ReturnType<typeof previewFlip> | null;
          const consumeRequirement = skill?.type === "consume" ? fuelRequirement(state, slot(index), combatDb) : null;
          const consumeReady =
            skill?.type === "consume" &&
            (!requiresFuelSelection(state, slot(index), combatDb)
              ? consumeUse !== undefined
              : fuelSelection?.slot === slot(index) && fuelCommand(fuelSelection, state, combatDb) !== null);
          const selectingFuel = skill?.type === "consume" && fuelSelection?.slot === slot(index);
          const activeSkillSeal = state.player.skillSeals[index];
          const hardSealed = activeSkillSeal !== undefined && activeSkillSeal.turns > 0 && activeSkillSeal.effectMultiplier === undefined;
          const skillSealLabel =
            activeSkillSeal === undefined || activeSkillSeal.turns <= 0
              ? null
              : activeSkillSeal.effectMultiplier === undefined
                ? `봉인 · ${activeSkillSeal.turns}턴`
                : `효과 ${Math.round(activeSkillSeal.effectMultiplier * 100)}% · ${activeSkillSeal.turns}턴`;
          const lockedOnce = skill?.oncePerCombat === true && slotState.usedThisCombat;
          const isResolving = resolving !== null && resolving.slot === index;
          const socketCoins = isResolving ? [...resolving.coins] : immediateCoins;
          const socketCount = skill?.type === "flip" ? skill.cost : 0;
          const targetingThis =
            targeting?.command.slot === slot(index) ||
            summonTargeting?.slot === slot(index) ||
            equipmentChoice?.slot === slot(index);
          const choosingCoin = coinChoice?.slot === slot(index);
          const selectedFuelCommand = selectingFuel ? fuelCommand(fuelSelection, state, combatDb) : null;
          const actionTotal =
            skill?.type === "flip"
              ? skill.cost
              : selectingFuel
                ? (consumeRequirement?.max ?? skill?.consume.count ?? 0)
                : (consumeRequirement?.min ?? skill?.consume.count ?? 0);
          const baseAction =
            skill === undefined || skill.type === "flip"
              ? null
              : cardActionView({
                  cooldownRemaining: slotState.cooldownRemaining,
                  kind: skill.type,
                  loaded: selectingFuel ? fuelSelection.coins.length : 0,
                  ready: selectingFuel ? selectedFuelCommand !== null : consumeUse !== undefined,
                  resolving: isResolving,
                  selecting: selectingFuel,
                  targeting: targetingThis,
                  total: actionTotal,
                  usedThisCombat: lockedOnce,
                });
          const action =
            skill === undefined
              ? null
              : hardSealed
                ? {
                    actionable: false,
                    label: skillSealLabel ?? "봉인",
                    tone: "idle" as const,
                  }
                : skill.type === "flip"
                  ? {
                      actionable:
                        immediateCoins.length === skill.cost &&
                        !lockedOnce &&
                        slotState.cooldownRemaining === 0 &&
                        !isResolving,
                      label:
                        immediateCoins.length === skill.cost
                          ? "즉시 사용"
                          : `코인 ${immediateCoins.length}/${skill.cost} 걸기`,
                      tone: immediateCoins.length === skill.cost ? ("ready" as const) : ("idle" as const),
                    }
                : choosingCoin
                ? {
                    actionable: coinChoiceCommand(coinChoice, state, combatDb) !== null,
                    label: coinChoice.coins.length > 0 ? "선택 확정" : "발동 코인 선택",
                    tone: coinChoice.coins.length > 0 ? ("ready" as const) : ("idle" as const),
                  }
                : summonTargeting?.slot === slot(index)
                  ? {
                      actionable: true,
                      label: "소환 장비 선택 중 · 취소",
                      tone: "targeting" as const,
                    }
                  : equipmentChoice?.slot === slot(index)
                    ? {
                        actionable: true,
                      label: "장비 종류 선택 중 · 취소",
                      tone: "targeting" as const,
                    }
                  : baseAction;
          const cardActionAllowed = !locked;
          const placeSelectedFromCardArt = (event: ReactPointerEvent<HTMLElement>) => {
            if (selectedCoin === null || skill?.type !== "flip") return;
            event.preventDefault();
            event.stopPropagation();
            toggleImmediateCoin(slot(index), selectedCoin, skill.cost);
          };
          const activateCardAction = () => {
            if (targetingThis) {
              cancelActiveChoice();
              return;
            }
            if (!cardActionAllowed) return;
            if (action?.actionable !== true || skill === undefined) return;
            setPreviewSlot(null);
            if (skill.type === "consume") activateConsumeSkill(slot(index), skill, consumeUse, true);
            else if (skill.type === "flip") useImmediateFlipSkill(slot(index), skill, immediateCoins);
          };
          return (
            <article
              className={`skill-card ${action?.tone === "ready" ? "ready" : ""} ${slotState.cooldownRemaining > 0 ? "spent" : ""} ${slotState.skillId === null ? "empty-slot" : ""} ${lockedOnce ? "combat-locked" : ""} ${hardSealed ? "skill-sealed" : ""} ${socketCoins.length > 0 || isResolving ? "lifted" : ""} ${isResolving ? "resolving" : ""} ${dropTarget && drag?.over === index ? "drop-target" : ""}`}
              data-slot={index}
              key={`${index}-${String(slotState.skillId)}`}
              style={vfx.has(`skill-slot-${index}`) || vfx.has(`cooldown-slot-${index}`) ? feedbackPulse : undefined}
              ref={(element) => {
                const anchor = skillCardRefs.current[index];
                if (anchor !== undefined) anchor.current = element;
              }}
              onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setPreviewSlot(null);
              }}
              onClick={() => {
                if (clickGuard()) return;
                if (locked || skill?.type !== "flip") return;
                // 코인을 고른 동안 카드 클릭은 코인 걸기 전용이다.
                // (연속 선택 중 오클릭이 스킬을 발동시키는 오발 방지). 사용은 하단 행동 바만 담당한다.
                if (selectedCoin !== null) {
                  toggleImmediateCoin(slot(index), selectedCoin, skill.cost);
                  return;
                }
                setImmediateSelection((current) =>
                  current?.slot === slot(index) ? current : { slot: slot(index), coins: [] },
                );
              }}
              onFocusCapture={() => {
                if (preview !== null) setPreviewSlot(index);
              }}
              onMouseEnter={() => {
                if (preview !== null) setPreviewSlot(index);
              }}
              onMouseLeave={(event) => {
                if (!event.currentTarget.contains(document.activeElement)) setPreviewSlot(null);
              }}
            >
              <div className="card-title">
                {displaySkillName}
                {slotReservations.length > 0 ? (
                  <em
                    aria-label={`예약 ${slotReservations.length}회 · 첫 실행 순서 ${queuedPosition + 1}`}
                    className="execution-card-badge"
                  >
                    예약 {slotReservations.length}회
                  </em>
                ) : partialQueued ? (
                  <em className="execution-partial-badge">미완료 · 실행 안 됨</em>
                ) : null}
                {upgraded ? (
                  <em aria-label="강화됨" className="upgrade-badge">
                    ＋
                  </em>
                ) : null}
              </div>
              {skill?.oncePerCombat === true ? <span className="once-badge">전투당 1회</span> : null}
              <div className="sockets" aria-label={`${displaySkillName} 코스트 소켓`}>
                {Array.from({ length: socketCount }, (_unused, socketIndex) => {
                  const coin = socketCoins[socketIndex];
                  const swapAccept =
                    coin !== undefined && dragging && drag.swapTargets.has(Number(coin));
                  const swapOver =
                    coin !== undefined && dragging && drag.overCoin === coin;
                  return (
                    <button
                      aria-label={
                        swapAccept
                          ? "걸어 둔 동전과 교환"
                          : coin === undefined
                          ? selectedCoin !== null
                            ? "선택한 코인 걸기"
                            : "이 스킬에 코인 걸기"
                          : `${coinLabel(state, coin)} 걸기 취소`
                      }
                      className={`socket ${coin !== undefined ? "loaded" : ""} ${coin === undefined && canPlace ? "accept" : ""} ${swapAccept ? "swap-accept" : ""} ${swapOver ? "swap-over" : ""}`}
                      data-coin={coin === undefined ? undefined : Number(coin)}
                      disabled={locked || hardSealed}
                      key={socketIndex}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        // 포인터 캡처가 브라우저 밖/무효 영역에서 끝난 뒤 남을 수 있는
                        // 비활성 drag 상태를 다음 명시적 클릭에서 확실히 정리한다.
                        if (drag !== null) setDrag(null);
                        if (clickGuard()) return;
                        if (isResolving) return;
                        if (coin !== undefined) toggleImmediateCoin(slot(index), coin, skill?.type === "flip" ? skill.cost : 0);
                        else if (selectedCoin !== null)
                          skill?.type === "flip" && toggleImmediateCoin(slot(index), selectedCoin, skill.cost);
                        else if (skill?.type === "flip")
                          setImmediateSelection((current) =>
                            current?.slot === slot(index) ? current : { slot: slot(index), coins: [] },
                          );
                      }}
                      onPointerDown={(event) => {
                        event.preventDefault();
                      }}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={cancelDrag}
                    >
                      {coin !== undefined ? (
                        <CoinDisc
                          coin={coin}
                          face={isResolving ? coinFaces[Number(coin)] : undefined}
                          flipping={isResolving && flipping[Number(coin)] === true}
                          state={state}
                          vfx={coin !== undefined && vfx.has(`coin-${Number(coin)}`)}
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {skill?.type === "consume" ? (
                <div
                  aria-label={`${elementKo(skill.consume.element)} 코인 ${
                    skill.consume.mode === "upTo"
                      ? `1개 이상 최대 ${skill.consume.count}개 소비`
                      : skill.consume.mode === "all"
                        ? `최소 ${skill.consume.count}개가 있으면 손의 ${elementKo(skill.consume.element)} 동전 전부 소비`
                        : `${skill.consume.count}개 소비`
                  }`}
                  className={`consume-condition ${consumeReady ? "met" : ""} ${selectingFuel ? "selecting" : ""}`}
                >
                  <strong aria-hidden="true">{elementKo(skill.consume.element)}</strong>
                  <span>
                    ×
                    {selectingFuel
                      ? skill.consume.mode === "upTo"
                        ? `${fuelSelection.coins.length}/최대 ${skill.consume.count}`
                        : skill.consume.mode === "all"
                          ? `${fuelSelection.coins.length}/${consumeRequirement?.available ?? 0} 전부`
                          : `${fuelSelection.coins.length}/${skill.consume.count}`
                      : skill.consume.mode === "upTo"
                        ? `1~${skill.consume.count}`
                        : skill.consume.mode === "all"
                          ? `최소 ${skill.consume.count}·전부`
                          : skill.consume.count}{" "}
                    <Keyword term="consume">소비</Keyword>
                  </span>
                </div>
              ) : null}
              <div className="card-art" aria-hidden="true" onPointerDown={placeSelectedFromCardArt}>
                {skill !== undefined && CARD_ART[String(skill.id)] !== undefined ? (
                  <img
                    onError={(event) => event.currentTarget.remove()}
                    alt=""
                    className="card-art-img"
                    src={CARD_ART[String(skill.id)]}
                  />
                ) : (
                  <span>
                    <EmberIcon scale={4.2} />
                  </span>
                )}
              </div>
              {skill !== undefined ? (
                <CardEffectRows
                  bloodSwordPower={state.player.bloodSwordPower}
                  displayName={displaySkillName}
                  skill={skill}
                />
              ) : null}
              {slotState.cooldownRemaining > 0 ? (
                <span className="spent-label">쿨 {slotState.cooldownRemaining}</span>
              ) : null}
              <RemiseSpendBadge
                displaySkillName={displaySkillName}
                isSorcerer={run.character === "sorcerer"}
                loaded={socketCoins.length}
                remiseCharges={state.player.remiseCharges}
                shifted={skill?.oncePerCombat === true}
                skill={skill}
                testId={`remise-spend-badge-${index}`}
              />
              {skill !== undefined && skillCooldown(skill) === 0 ? (
                <span className="repeat-label" title="반복 — 같은 턴에 코인이 남는 한 계속 사용">
                  반복
                </span>
              ) : null}
              {lockedOnce ? <span className="locked-label">잠금</span> : null}
              {skillSealLabel !== null ? (
                <span
                  aria-label={`${displaySkillName} ${skillSealLabel}, 남은 플레이어 턴 동안 적용`}
                  className={`sealed-skill-label ${hardSealed ? "sealed" : "reduced"}`}
                  data-testid={`skill-seal-card-${index}`}
                >
                  {skillSealLabel}
                </span>
              ) : null}
              {action !== null ? (
                <button
                  aria-disabled={!action.actionable || !cardActionAllowed}
                  aria-label={`${displaySkillName} ${action.label}`}
                  className={`card-action ${action.tone}`}
                  data-testid={`skill-action-${index}`}
                  disabled={!action.actionable || !cardActionAllowed}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (clickGuard()) return;
                    activateCardAction();
                  }}
                >
                  {action.label}
                </button>
              ) : null}
              {preview !== null && previewSlot === index ? (
                <AnchoredOverlay
                  anchorRef={skillCardRefs.current[index]!}
                  className="preview-tip"
                  id={`skill-preview-${index}`}
                  interactive
                  open
                  role="tooltip"
                >
                  피해 {preview.byAxis.damage.min}~{preview.byAxis.damage.max} (기대 {preview.expected.damage})
                  <br />
                  방어 {preview.byAxis.block.min}~{preview.byAxis.block.max} (기대 {preview.expected.block})
                  <br />
                  <Keyword term="burn">화상</Keyword> {preview.byAxis.burn.min}~{preview.byAxis.burn.max} (기대{" "}
                  {preview.expected.burn})
                  {preview.byAxis.selfDamage.max > 0 ? (
                    <>
                      <br />
                      자해 {preview.byAxis.selfDamage.min}~{preview.byAxis.selfDamage.max} (기대{" "}
                      {preview.expected.selfDamage})
                    </>
                  ) : null}
                  {preview.byAxis.coinsCreated.max > 0 ? (
                    <>
                      <br />
                      코인 생성 {preview.byAxis.coinsCreated.min}~{preview.byAxis.coinsCreated.max} (기대{" "}
                      {preview.expected.coinsCreated})
                    </>
                  ) : null}
                </AnchoredOverlay>
              ) : null}
            </article>
          );
        })}
        {!ended ? <TutorialStrip db={combatDb} fuelSelectionOpen={fuelSelection !== null} state={state} /> : null}
      </section>

      <section className="bottom-hud">
        {preserveSelection !== null ? (
          <div aria-label="턴 종료 동전 보존 선택" className="preserve-picker" role="group">
            <strong>
              보존 선택 {preserveSelection.coins.length - preserveSelection.locked.length}/
              {Math.min(preserveSelection.newCapacity, MAX_PRESERVED_COINS - preserveSelection.locked.length)}
            </strong>
            <span>{PRESERVE_SELECTION_INSTRUCTIONS}</span>
            {preserveSelection.candidates.some((coin) => !state.zones.hand.includes(coin)) ? (
              <div aria-label="걸어 둔 코인 보존 후보" className="preserve-placed">
                {preserveSelection.candidates
                  .filter((coin) => !state.zones.hand.includes(coin))
                  .map((coin) => {
                    const preserveLocked = preserveSelection.locked.includes(coin);
                    return (
                      <button
                        aria-disabled={preserveLocked}
                        aria-label={`${coinLabel(state, coin)} 걸어 둔 코인 ${preserveLocked ? "보존됨 잠금" : "보존 선택"}`}
                        aria-pressed={preserveSelection.coins.includes(coin)}
                        className={`preserve-placed-coin ${preserveSelection.coins.includes(coin) ? "selected" : ""}`}
                        key={coin}
                        type="button"
                        onClick={() => onPreserveCoinClick(coin)}
                      >
                        {coinLabel(state, coin)}
                        {preserveLocked ? " · 잠금" : ""}
                      </button>
                    );
                  })}
              </div>
            ) : null}
            {autoTurnEnd.phase === "preserving" ? (
              <button className="preserve-placed-coin" type="button" onClick={cancelAutomaticExecution}>
                확정 흐름 취소
              </button>
            ) : null}
          </div>
        ) : null}
        {state.custody.length > 0 ? (
          <section
            aria-label={`압수 동전 ${custodyCoinCount}개, 소유 적 ${custodyOwners.join(", ")}`}
            className="custody-pile"
            data-testid="custody-pile"
          >
            <strong>압수 동전 {custodyCoinCount}개</strong>
            <span>소유 적: {custodyOwners.join(", ")}</span>
            <small>압수자를 처치하거나 전투가 끝나면 버린 더미로 돌아갑니다.</small>
          </section>
        ) : null}
        <div className="pouch" ref={pouchRef}>
          <button
            aria-controls="draw-pile-pop"
            aria-expanded={openPile === "draw"}
            aria-label={`코인 주머니 — 남은 동전 ${state.zones.draw.length}닢, 구성 보기`}
            className={`pouch-circle ${pouchReceiving ? "receiving" : ""}`}
            ref={drawPileButtonRef}
            type="button"
            onClick={() => togglePile("draw")}
          >
            {state.zones.draw.length}
          </button>
          <span>주머니</span>
          {openPile === "draw" ? (
            <PilePopover anchorRef={drawPileButtonRef} groups={pileComposition(state, "draw", combatDb)} zone="draw" />
          ) : null}
        </div>
        <div className="coin-rail" data-testid="mobile-coin-rail">
          <button
            aria-label="이전 동전"
            className="coin-rail-nav previous"
            data-testid="coin-rail-prev"
            disabled={coinRailPosition === 0}
            type="button"
            onClick={() => scrollCoinRail(-1)}
          >
            ‹
          </button>
          <div
            className="hand-tray"
            aria-label="손패 동전 트레이"
            ref={handTrayRef}
            onScroll={updateCoinRailPosition}
          >
          {state.zones.hand.map((coin) => {
            const fuelSelected = fuelSelection?.coins.includes(coin) === true;
            const choiceSelected = coinChoice?.coins.includes(coin) === true;
            const preserveSelected = preserveSelection?.coins.includes(coin) === true;
            const immediateSelected = immediateSelection?.coins.includes(coin) === true;
            const preserveLocked = preserveSelection?.locked.includes(coin) === true;
            const emptyFuelSelection = fuelSelection === null ? null : { slot: fuelSelection.slot, coins: [] };
            const fuelValid =
              fuelSelection !== null &&
              (fuelSelected || toggleFuel(emptyFuelSelection!, coin, state, combatDb) !== emptyFuelSelection);
            const choiceValid =
              coinChoice !== null && coinChoiceCandidates(state, coinChoice.slot, combatDb).includes(coin);
            const preserveValid = preserveSelection?.candidates.includes(coin) === true;
            const immediateSlotState = immediateSelection === null ? undefined : state.slots[Number(immediateSelection.slot)];
            const immediateSkill = immediateSlotState === undefined ? undefined : combatDb.skills[String(immediateSlotState.skillId)];
            const immediateValid =
              immediateSelection !== null &&
              immediateSkill?.type === "flip" &&
              (immediateSelected || immediateSelection.coins.length < immediateSkill.cost);
            const selectingCoin = fuelSelection !== null || coinChoice !== null || preserveSelection !== null || immediateSelection !== null;
            const selectedForMode = fuelSelected || choiceSelected || preserveSelected || immediateSelected;
            const validForMode = fuelValid || choiceValid || preserveValid || immediateValid;
            const handDisabled = locked || preserveLocked;
            return (
              <button
                aria-disabled={handDisabled || undefined}
                aria-label={`${coinLabel(state, coin)} 동전 ${preserveLocked ? "보존됨 잠금" : "선택"}`}
                aria-pressed={selectingCoin ? selectedForMode : selectedCoin === coin}
                className={`coin ${coinVisualClasses(state, coin)} ${selectedCoin === coin ? "selected" : ""} ${
                  selectedForMode ? "fuel-selected" : ""
                } ${validForMode ? "fuel-valid" : ""} ${selectingCoin && !validForMode ? "fuel-invalid" : ""} ${
                  drag !== null && drag.started && drag.coin === coin ? "drag-origin" : ""
                } ${shakeCoin === coin && preferences.screenShake ? "drag-cancel" : ""} ${vfx.has(`coin-${Number(coin)}`) ? "vfx-reveal" : ""}`}
                disabled={handDisabled}
                key={coin}
                style={
                  vfx.has(`coin-${Number(coin)}`) && !preferences.reducedMotion
                    ? { animation: "vfx-coin-heads-reveal 300ms steps(3) 1" }
                    : undefined
                }
                type="button"
                onClick={() => {
                  if (handDisabled) return;
                  if (drag !== null) setDrag(null);
                  if (clickGuard()) return;
                  if (onPreserveCoinClick(coin)) return;
                  if (onFuelCoinClick(coin)) return;
                  if (onCoinChoiceClick(coin)) return;
                  if (immediateSelection !== null && immediateSkill?.type === "flip") {
                    toggleImmediateCoin(immediateSelection.slot, coin, immediateSkill.cost);
                    return;
                  }
                  selectCoin(selectedCoin === coin ? null : coin);
                }}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={cancelDrag}
              >
                <small>{coinLabel(state, coin)}</small>
              </button>
            );
          })}
          </div>
          <button
            aria-label="다음 동전"
            className="coin-rail-nav next"
            data-testid="coin-rail-next"
            disabled={state.zones.hand.length === 0 || coinRailPosition >= coinRailMaxPosition}
            type="button"
            onClick={() => scrollCoinRail(1)}
          >
            ›
          </button>
          <span className="coin-rail-position" data-testid="coin-rail-position">
            {state.zones.hand.length === 0 ? 0 : coinRailPosition + 1} / {state.zones.hand.length}
          </span>
        </div>
        <div className="pile-counts" ref={pileCountsRef}>
          <button
            aria-controls="discard-pile-pop"
            aria-expanded={openPile === "discard"}
            aria-label={`버림 더미 ${state.zones.discard.length}개, 구성 보기`}
            className={`pile-button discard ${discardReceiving ? "receiving" : ""}`}
            ref={discardPileButtonRef}
            type="button"
            onClick={() => togglePile("discard")}
          >
            <SkullIcon scale={1.6} /> 버림 {state.zones.discard.length}
          </button>
          <button
            aria-controls="exhausted-pile-pop"
            aria-expanded={openPile === "exhausted"}
            aria-label={`소모 영역 ${state.zones.exhausted.length}개, 구성 보기`}
            className={`pile-button exhausted ${exhaustReceiving ? "receiving" : ""}`}
            ref={exhaustedPileButtonRef}
            type="button"
            onClick={() => togglePile("exhausted")}
          >
            <EmberIcon scale={1.6} /> 소모 {state.zones.exhausted.length}
          </button>
          {openPile === "discard" ? (
            <PilePopover
              anchorRef={discardPileButtonRef}
              groups={pileComposition(state, "discard", combatDb)}
              zone="discard"
            />
          ) : null}
          {openPile === "exhausted" ? (
            <PilePopover
              anchorRef={exhaustedPileButtonRef}
              groups={pileComposition(state, "exhausted", combatDb)}
              zone="exhausted"
            />
          ) : null}
          {pileFlowText !== null ? (
            <div aria-live="polite" className="pile-flow">
              {pileFlowText}
            </div>
          ) : null}
        </div>
        <div className="turn-primary-controls">
        <button
          aria-label={preserveSelection !== null ? "보존 확정" : "턴 종료"}
          className="end-turn"
          disabled={
            locked ||
            findLegal({ type: "endTurn" }) === undefined
          }
          ref={endTurnButtonRef}
          type="button"
          onClick={() => {
            setImmediateSelection(null);
            beginOrConfirmPreserve();
          }}
        >
          {preserveSelection !== null ? "보존 확정" : "턴 종료"}
        </button>
        </div>
      </section>

      {rejection !== null ? (
        <div aria-live="polite" className="rejection-chip" key={rejection.id}>
          {rejection.text}
        </div>
      ) : null}

      {dragging ? (
        <OverlayPortal layer="drag">
          <div aria-hidden="true" className="drag-proxy" style={{ left: drag.x, top: drag.y }}>
            <CoinDisc coin={drag.coin} state={state} />
          </div>
        </OverlayPortal>
      ) : null}
    </main>
  );
};

interface UnitPanelProps {
  side: "player" | "enemy";
  unitKey: string;
  sprite: SpriteAsset;
  name: string;
  hp: number;
  maxHp: number;
  block: number;
  statuses: CombatState["player"]["statuses"];
  intent?: ReactNode;
  floats: FloatText[];
  motion: "idle" | "attack" | "hurt";
  playKey: number;
  vfx: Set<string>;
  enemyIndex?: number;
  targeting?: boolean;
  targetSelected?: boolean;
  onTarget?: () => void;
  attackBuff?: number;
  passive?: { name: string; description: string };
  overheat?: boolean;
  pendingOverheat?: boolean;
  armorEchoHud?: {
    current: number;
    available: boolean;
    armed: boolean;
    preheat: number;
    totalIntentDamage: number;
    preview: ReturnType<typeof armorEchoPreview>;
  };
  weaponOutput?: number;
  remiseCharges?: number;
  bloodSwordPower?: number;
  bloodSwordInvestment?: number;
  phaseIndex?: number;
  damageTakenMultiplier?: number;
  growthStacks?: number;
  growthLabel?: string;
  playerTurnEndPunishment?: {
    threshold: number;
    status: StatusId;
    stacks: number;
  };
  unusedElementalCoins?: number;
  roundGrowth?: CombatState["enemies"][number]["roundGrowth"];
  damageTakenThisRound?: number;
  protectionLink?: CombatState["enemies"][number]["protectionLink"];
  protectionTargetName?: string;
  protectedBy?: { name: string; redirectPercent: number };
  petrify?: {
    active: boolean;
    rawDamage: number;
    reductionPercent: number;
    threshold: number;
    crackedTurns: number;
    crackedPercent: number;
    divePrepared: boolean;
    diveCancelled: boolean;
  };
  march?: { attackPercent: number; shield: number; sourceName: string; turns: number };
  warBannerAuraPercent?: number;
  auraSourceName?: string;
  auraSourcePercent?: number;
  skillSeals?: readonly { slot: number; name: string; turns: number; effectMultiplier?: number }[];
}

export const ArmorEchoHud = ({
  hud,
}: {
  hud: {
    current: number;
    available: boolean;
    armed: boolean;
    preheat: number;
    totalIntentDamage: number;
    preview: ReturnType<typeof armorEchoPreview>;
  };
}): JSX.Element => (
  <span
    aria-label={`갑주 반향 ${hud.current}, 반향 증폭 ${hud.available ? "가능" : "불가"}, 적 의도 피해 ${hud.totalIntentDamage}, 예상 잔여 방어 ${hud.preview.remainingBlock}, 반향 미리보기 ${hud.preview.total}, 정밀 방어 ${hud.preview.precision ? "성립" : "미성립"}`}
    className="chip-keyword"
    data-testid="armor-echo-hud"
  >
    <Keyword term="armorEcho">
      <em className="passive-chip">반향 {hud.current}</em>
    </Keyword>
    <Keyword term="echoAmplification">
      <em className="passive-chip">증폭 {hud.available ? "가능" : "불가"}</em>
    </Keyword>
    <Keyword term="precisionDefense">
      <em className="passive-chip">정밀 {hud.preview.precision ? "성립" : hud.armed ? "대기" : "미성립"}</em>
    </Keyword>
    {hud.preheat > 0 ? (
      <Keyword term="echoPreheat">
        <em className="passive-chip">예열 +{hud.preheat}</em>
      </Keyword>
    ) : null}
    <em className="passive-chip">
      의도 {hud.totalIntentDamage} · 잔여 {hud.preview.remainingBlock} · 예상 반향 {hud.preview.total}
    </em>
  </span>
);

export const UnitPanel = ({
  side,
  unitKey,
  sprite,
  name,
  hp,
  maxHp,
  block,
  statuses,
  intent,
  floats,
  motion,
  playKey,
  vfx,
  enemyIndex,
  targeting = false,
  targetSelected = false,
  onTarget,
  attackBuff = 0,
  passive,
  overheat = false,
  pendingOverheat = false,
  armorEchoHud,
  weaponOutput,
  remiseCharges,
  bloodSwordPower,
  bloodSwordInvestment,
  phaseIndex,
  damageTakenMultiplier,
  growthStacks,
  growthLabel = "성장",
  playerTurnEndPunishment,
  unusedElementalCoins,
  roundGrowth,
  damageTakenThisRound = 0,
  protectionLink,
  protectionTargetName,
  protectedBy,
  petrify,
  march,
  warBannerAuraPercent,
  auraSourceName,
  auraSourcePercent,
  skillSeals,
}: UnitPanelProps) => (
  <div
    className={`unit ${side} ${vfx.has(`unit-${unitKey}`) ? "vfx-hit" : ""} ${targeting ? "targetable" : ""} ${targetSelected ? "target-selected" : ""}`}
    onClick={targeting ? onTarget : undefined}
    style={vfx.has(`heal-${unitKey}`) || vfx.has(`heal-lock-${unitKey}`) || vfx.has(`overheat-${unitKey}`) ? feedbackPulse : undefined}
  >
    <div
      className={`unit-plate ${vfx.has(`wither-${side}`) ? "vfx-wither" : ""}`}
      style={
        vfx.has(`frostbite-${unitKey}`) ||
        vfx.has(`shock-${unitKey}`) ||
        vfx.has(`poison-${unitKey}`) ||
        vfx.has(`healLock-${unitKey}`)
          ? feedbackPulse
          : undefined
      }
    >
      <div className="plate-row">
        <span className="unit-name">{name}</span>
        {passive !== undefined ? (
          <Keyword
            className="chip-keyword"
            entry={{
              label: passive.name,
              description: `패시브 — ${passive.description} (자동 발동, 의도와 별개)`,
            }}
            term="passive"
          >
            <em aria-label={`패시브: ${passive.name} — ${passive.description}`} className="passive-chip">
              ★ {passive.name}
            </em>
          </Keyword>
        ) : null}
        {side === "enemy" && phaseIndex !== undefined ? (
          <Keyword className="chip-keyword" term="frenzy">
            <em
              aria-label={`페이즈 ${phaseIndex + 1}${damageTakenMultiplier === undefined ? "" : `, 받는 피해 ${damageTakenMultiplier}배`}`}
              className="passive-chip"
            >
              페이즈 {phaseIndex + 1}
              {damageTakenMultiplier === undefined ? "" : ` · 취약 ×${damageTakenMultiplier}`}
            </em>
          </Keyword>
        ) : null}
        {side === "enemy" && playerTurnEndPunishment !== undefined && unusedElementalCoins !== undefined ? (
          <Keyword className="chip-keyword" term="unusedElementalThreshold">
            <em
              aria-label={`미사용 속성 코인 ${unusedElementalCoins}/${playerTurnEndPunishment.threshold}, ${unusedElementalCoins >= playerTurnEndPunishment.threshold ? "턴 종료 시 발동" : "안전"}, ${statusKo(playerTurnEndPunishment.status)} ${playerTurnEndPunishment.stacks} 부여`}
              className="attack-buff-chip"
              data-testid="unused-elemental-warning"
            >
              속성 코인 {unusedElementalCoins}/{playerTurnEndPunishment.threshold} · {unusedElementalCoins >= playerTurnEndPunishment.threshold ? "발동" : "안전"}
            </em>
          </Keyword>
        ) : null}
        {side === "enemy" && roundGrowth !== undefined ? (
          <Keyword className="chip-keyword" term="ringGrowth">
            <em
              aria-label={`나이테 ${growthStacks ?? 0}/${roundGrowth.maxStacks}, 피해 감소 ${Math.round((growthStacks ?? 0) * roundGrowth.damageReductionPerStack * 100)}%, 적 행동 시작 재생 ${Math.round(maxHp * roundGrowth.healMaxHpFractionPerStack * (growthStacks ?? 0))}, 이번 라운드 실제 피해 ${damageTakenThisRound}/${Math.ceil(maxHp * roundGrowth.removeOneAtHpFraction)}, 두 개 파괴 ${Math.ceil(maxHp * roundGrowth.removeTwoAtHpFraction)}`}
              className="passive-chip"
              data-testid="ring-growth-hud"
            >
              나이테 {growthStacks ?? 0}/{roundGrowth.maxStacks} · 감소 {Math.round((growthStacks ?? 0) * roundGrowth.damageReductionPerStack * 100)}% · 재생 +{Math.round(maxHp * roundGrowth.healMaxHpFractionPerStack * (growthStacks ?? 0))} · 피해 {damageTakenThisRound}/{Math.ceil(maxHp * roundGrowth.removeOneAtHpFraction)}·{Math.ceil(maxHp * roundGrowth.removeTwoAtHpFraction)}
            </em>
          </Keyword>
        ) : null}
        {side === "enemy" && roundGrowth === undefined && growthStacks !== undefined && growthStacks > 0 ? (
          <Keyword
            className="chip-keyword"
            entry={{ label: growthLabel, description: `${growthLabel} 스택. 공격을 강화하며 표시된 대응 조건으로 획득하거나 잃습니다.` }}
            term="growth"
          >
            <em aria-label={`${growthLabel} 스택 ${growthStacks}`} className="passive-chip">
              {growthLabel} {growthStacks}
            </em>
          </Keyword>
        ) : null}
        {side === "enemy" && protectionLink !== undefined ? (
          <Keyword
            className="chip-keyword"
            entry={{
              label: "보호 연결",
              description: "연결된 아군이 받는 피해의 일부를 대신 받습니다. 수호병을 직접 공격하면 내구도가 감소하며, 파괴된 연결은 정해진 턴 뒤 복구됩니다.",
            }}
            term="passive"
          >
            <em
              aria-label={
                protectionLink.active
                  ? `보호 연결: ${name}이 ${protectionTargetName ?? "지정 아군"} 피해 ${Math.round(protectionLink.redirectFraction * 100)}%를 대신 받음, 내구도 ${protectionLink.durability}`
                  : `보호 연결 파괴: ${protectionLink.turnsUntilRestore}턴 뒤 복구, 받는 피해 ${Math.round((protectionLink.brokenDamageTakenMultiplier - 1) * 100)}% 증가`
              }
              className="passive-chip"
              data-testid={`protection-link-${enemyIndex ?? "enemy"}`}
            >
              {protectionLink.active
                ? `보호 → ${protectionTargetName ?? "아군"} ${Math.round(protectionLink.redirectFraction * 100)}% · 내구 ${protectionLink.durability}`
                : `보호 파괴 · 복구 ${protectionLink.turnsUntilRestore}턴 · 취약 +${Math.round((protectionLink.brokenDamageTakenMultiplier - 1) * 100)}%`}
            </em>
          </Keyword>
        ) : null}
        {side === "enemy" && protectedBy !== undefined ? (
          <Keyword
            className="chip-keyword"
            entry={{ label: "보호 중", description: "수호병이 이 적이 받는 피해의 일부를 대신 받습니다." }}
            term="passive"
          >
            <em
              aria-label={`보호 중: ${protectedBy.name}이 피해 ${protectedBy.redirectPercent}%를 대신 받음`}
              className="passive-chip"
              data-testid={`protected-by-${enemyIndex ?? "enemy"}`}
            >
              보호 중 · {protectedBy.name} {protectedBy.redirectPercent}%
            </em>
          </Keyword>
        ) : null}
        {side === "enemy" && petrify !== undefined && (petrify.active || petrify.crackedTurns > 0 || petrify.diveCancelled) ? (
          <Keyword
            className="chip-keyword"
            entry={{
              label: "석화",
              description: "석화 중에는 받는 피해가 감소하지만, 감소 전 피해를 임계치까지 누적하면 낙하 강습을 취소하고 균열 상태가 됩니다.",
            }}
            term="passive"
          >
            <em
              aria-label={
                petrify.active
                  ? `석화: 피해 감소 ${petrify.reductionPercent}%, 원래 피해 ${petrify.rawDamage}/${petrify.threshold}, ${petrify.divePrepared ? "낙하 강습 준비: 임계치 달성 시 취소" : "임계치 달성 시 낙하 강습 취소"}`
                  : petrify.crackedTurns > 0
                    ? `균열: ${petrify.crackedTurns}턴, 받는 피해 ${petrify.crackedPercent}% 증가${petrify.diveCancelled ? ", 낙하 강습 취소됨" : ""}`
                    : "낙하 강습 취소됨"
              }
              className="passive-chip"
              data-testid={`petrify-status-${enemyIndex ?? "enemy"}`}
            >
              {petrify.active
                ? `석화 ${petrify.reductionPercent}% · 원피해 ${petrify.rawDamage}/${petrify.threshold}${petrify.divePrepared ? " · 낙하 취소 가능" : ""}`
                : petrify.crackedTurns > 0
                  ? `균열 ${petrify.crackedTurns}턴 · 취약 +${petrify.crackedPercent}%${petrify.diveCancelled ? " · 낙하 취소" : ""}`
                  : "낙하 강습 취소"}
            </em>
          </Keyword>
        ) : null}
        {side === "enemy" && warBannerAuraPercent !== undefined ? (
          <Keyword
            className="chip-keyword"
            entry={{ label: "왕가의 군기", description: "살아 있는 동안 다른 모든 적의 공격 피해를 증가시킵니다. 처치하면 즉시 사라집니다." }}
            term="passive"
          >
            <em
              aria-label={`왕가의 군기: 다른 적 공격력 ${warBannerAuraPercent}% 증가, 처치 시 즉시 해제`}
              className="attack-buff-chip"
              data-testid={`war-banner-aura-${enemyIndex ?? "enemy"}`}
            >
              군기 오라 · 다른 적 +{warBannerAuraPercent}%
            </em>
          </Keyword>
        ) : null}
        {side === "enemy" && auraSourceName !== undefined && auraSourcePercent !== undefined ? (
          <em
            aria-label={`왕가의 군기 적용: ${auraSourceName}의 공격력 ${auraSourcePercent}% 증가 오라`}
            className="attack-buff-chip"
            data-testid={`war-banner-aura-source-${enemyIndex ?? "enemy"}`}
          >
            군기 · {auraSourceName} +{auraSourcePercent}%
          </em>
        ) : null}
        {side === "enemy" && march !== undefined ? (
          <Keyword
            className="chip-keyword"
            entry={{ label: "왕가의 진군", description: "군기수가 부여한 일시 강화입니다. 공격력이 증가하고, 출처가 명시된 보호막을 얻습니다. 군기수 처치 시 즉시 해제됩니다." }}
            term="passive"
          >
            <em
              aria-label={`왕가의 진군: ${march.sourceName}, 공격력 ${march.attackPercent}% 증가, ${march.turns}턴, 출처 보호막 ${march.shield}`}
              className="attack-buff-chip"
              data-testid={`royal-march-${enemyIndex ?? "enemy"}`}
            >
              진군 · +{march.attackPercent}% · {march.turns}턴 · 방패 {march.shield} ({march.sourceName})
            </em>
          </Keyword>
        ) : null}
        {block > 0 ? (
          <Keyword term="block" className="chip-keyword">
            <em aria-label={`방어 ${block}`} className={`block-chip ${vfx.has(`block-${unitKey}`) ? "vfx-pop" : ""}`}>
              <ShieldIcon scale={1.4} />
              {block}
            </em>
          </Keyword>
        ) : null}
        {statusStacks(statuses, "burn") > 0 ? (
          <Keyword term="burn" className="chip-keyword">
            <em
              aria-label={`화상 ${statusStacks(statuses, "burn")}`}
              className={`burn-chip ${vfx.has(`burn-${unitKey}`) ? "vfx-pulse" : ""}`}
            >
              <EmberIcon scale={1.4} />
              {statusStacks(statuses, "burn")}
            </em>
          </Keyword>
        ) : null}
        {statusStacks(statuses, "poison") > 0 ? (
          <Keyword term="poison" className="chip-keyword">
            <em
              aria-label={`중독 ${statusStacks(statuses, "poison")}`}
              className={`poison-chip ${vfx.has(`poison-${unitKey}`) ? "vfx-pulse" : ""}`}
            >
              중독 {statusStacks(statuses, "poison")}
            </em>
          </Keyword>
        ) : null}
        {statusTurns(statuses, "frostbite") > 0 ? (
          <Keyword term="frostbite" className="chip-keyword">
            <em aria-label={`동상 ${statusTurns(statuses, "frostbite")}턴`} className="frost-chip">
              동상 {statusTurns(statuses, "frostbite")}
            </em>
          </Keyword>
        ) : null}
        {statusTurns(statuses, "shock") > 0 ? (
          <Keyword term="shock" className="chip-keyword">
            <em aria-label={`감전 ${statusTurns(statuses, "shock")}턴`} className="shock-chip">
              감전 {statusTurns(statuses, "shock")}
            </em>
          </Keyword>
        ) : null}
        {statusTurns(statuses, "healLock") > 0 ? (
          <Keyword term="healLock" className="chip-keyword">
            <em aria-label={`회복 봉인 ${statusTurns(statuses, "healLock")}턴`} className="heal-lock-chip">
              회복 봉인 {statusTurns(statuses, "healLock")}
            </em>
          </Keyword>
        ) : null}
        {overheat ? (
          <Keyword className="chip-keyword" term="overheat">
            <em aria-label="과열" className="overheat-chip">
              과열
            </em>
          </Keyword>
        ) : null}
        {!overheat && pendingOverheat ? (
          <Keyword className="chip-keyword" term="pendingOverheat">
            <em aria-label="과열 예약: 다음 턴 과열 예정" className="overheat-chip">
              과열 예약
            </em>
          </Keyword>
        ) : null}
        {skillSeals !== undefined ? <SkillSealBadges seals={skillSeals} /> : null}
        {armorEchoHud !== undefined ? <ArmorEchoHud hud={armorEchoHud} /> : null}
        {weaponOutput !== undefined ? (
          <em aria-label={`병기 출력 ${weaponOutput}/5`} className="passive-chip">
            병기 출력 {weaponOutput}/5
          </em>
        ) : null}
        {remiseCharges !== undefined ? <RemiseStackChip charges={remiseCharges} /> : null}
        {bloodSwordPower !== undefined && bloodSwordInvestment !== undefined ? (
          <em aria-label={`혈마검 ${bloodSwordPower}단계, 투자 ${bloodSwordInvestment}/30`} className="passive-chip">
            혈마검 {bloodSwordPower}단계 · {bloodSwordInvestment}/30
          </em>
        ) : null}
        {attackBuff > 0 ? (
          <Keyword className="chip-keyword" term="attack-buff">
            <em aria-label={`버프: 다음 공격 +${attackBuff}`} className="attack-buff-chip">
              ↑ 공격 +{attackBuff}
            </em>
          </Keyword>
        ) : null}
      </div>
      <div
        aria-label={`체력 ${hp}/${maxHp}`}
        aria-valuemax={maxHp}
        aria-valuemin={0}
        aria-valuenow={hp}
        className="hp-bar"
        role="progressbar"
      >
        <HeartIcon scale={1.4} />
        <div className="hp-track">
          <div className="hp-fill" style={{ width: `${Math.max(0, (hp / maxHp) * 100)}%` }} />
        </div>
        <strong className="hp-num">
          {hp}/{maxHp}
        </strong>
      </div>
    </div>
    {intent !== undefined ? intent : null}
    <button
      aria-label={targeting ? `${name} 대상 ${targetSelected ? "선택됨" : "선택"}` : `${name} 스프라이트`}
      aria-pressed={targeting ? targetSelected : undefined}
      className="sprite"
      disabled={!targeting}
      type="button"
      data-sprite-fallback={sprite.fallbackFor === undefined ? undefined : String(sprite.fallbackFor)}
      onClick={(event) => {
        event.stopPropagation();
        onTarget?.();
      }}
    >
      <AtlasSprite
        atlasUrl={sprite.atlasUrl}
        key={`${unitKey}-${motion}-${playKey}`}
        manifest={sprite.manifest}
        motion={motion}
        playKey={playKey}
        side={side}
      />
    </button>
    {floats
      .filter((item) => item.target === side && (side === "player" || item.enemy === enemyIndex))
      .map((item) => (
        <b className={`float-text kind-${item.kind}`} key={item.id}>
          {item.text}
        </b>
      ))}
  </div>
);
const feedbackPulse = { animation: "vfx-block-pop 300ms steps(3) 1" };
