import { CONTENT_VERSION, contentDb } from "@game/content";
import type {
  CoinDefId,
  CoinUid,
  CharacterId,
  EffectAtom,
  EnemyDefId,
  Face,
  RunState,
  SkillId,
  SlotId,
} from "@game/core";
import {
  RUN_ENCOUNTER_COUNT,
  RUN_ENCOUNTERS,
  chooseCoinReward,
  chooseSkillReward,
  createCombat,
  createRun,
  legalCommands,
  previewFlip,
  resolveCoinRemoval,
  resumeAbandonedCombat,
  settleRunCombat,
  skipSkillReward,
  startRunCombat,
  statusStacks,
  statusTurns,
  step,
} from "@game/core";
import type { CombatEvent, CombatState, Command } from "@game/core";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

import "./App.css";
import "./vfx.css";
import { AtlasSprite } from "./AtlasSprite";
import { REJECTION_TEXT, rejectionReason } from "./action-feedback";
import { CardEffectRows } from "./card-effects";
import { CharacterSelect } from "./character-select";
import {
  autoSuggestCoinChoice,
  coinChoiceCandidates,
  coinChoiceCommand,
  requiresCoinChoiceSelection,
  toggleCoinChoice,
} from "./coin-choice";
import type { CoinChoiceSelection } from "./coin-choice";
import {
  autoSuggestFuel,
  fuelCommand,
  requiresFuelSelection,
  toggleFuel,
} from "./fuel-selection";
import type { FuelSelection } from "./fuel-selection";
import {
  EmberIcon,
  FlameIcon,
  HeartIcon,
  ShieldIcon,
  SkullIcon,
  SwordIcon,
} from "./icons";
import { coinNameFor, coinRewardDetailFor } from "./coin-info";
import { Keyword } from "./keywords";
import { buildResolutionSummary, statusKo } from "./resolution-summary";
import { ResolutionTicket } from "./resolution-ticket";
import type { ResolutionSummary } from "./resolution-summary";
import {
  cycleTarget,
  defaultTarget,
  legalTargetsForCommand,
  livingEnemyTargets,
} from "./targeting";
import type { TargetingCommand } from "./targeting";
import bgForest from "./assets/bg-forest.webp";
import cardSlash from "./assets/card-slash.webp";
import cardGuard from "./assets/card-guard.webp";
import cardBurningStrike from "./assets/card-burning-strike.webp";
import cardIgnite from "./assets/card-ignite.webp";
import cardIgniteSword from "./assets/card-ignite-sword.webp";
import cardFlameRampage from "./assets/card-flame-rampage.webp";
import cardWardingStrike from "./assets/card-warding-strike.webp";
import cardManaBulwark from "./assets/card-mana-bulwark.webp";
import cardShieldReprisal from "./assets/card-shield-reprisal.webp";
import cardManaWell from "./assets/card-mana-well.webp";
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
import cardWintersGrasp from "./assets/card-winters-grasp.webp";
import cardAegisSurge from "./assets/card-aegis-surge.webp";
import goblinAtlas from "./assets/generated/sprites/goblin/sprite-sheet-alpha.png";
import goblinManifestJson from "./assets/generated/sprites/goblin/manifest.json";
import gatekeeperAtlas from "./assets/generated/sprites/gatekeeper/sprite-sheet-alpha.png";
import gatekeeperManifestJson from "./assets/generated/sprites/gatekeeper/manifest.json";
import shamanAtlas from "./assets/generated/sprites/shaman/sprite-sheet-alpha.png";
import shamanManifestJson from "./assets/generated/sprites/shaman/manifest.json";
import warriorAtlas from "./assets/generated/sprites/warrior/sprite-sheet-alpha.png";
import warriorManifestJson from "./assets/generated/sprites/warrior/manifest.json";
import guardianAtlas from "./assets/generated/sprites/guardian/sprite-sheet-alpha.png";
import guardianManifestJson from "./assets/generated/sprites/guardian/manifest.json";
import sorcererAtlas from "./assets/generated/sprites/sorcerer/sprite-sheet-alpha.png";
import sorcererManifestJson from "./assets/generated/sprites/sorcerer/manifest.json";
import frostKnightAtlas from "./assets/generated/sprites/frost-knight/sprite-sheet-alpha.png";
import frostKnightManifestJson from "./assets/generated/sprites/frost-knight/manifest.json";
import { spriteMotionForEvent } from "./sprite-motion";
import type { SpriteManifest } from "./AtlasSprite";
import {
  coinFacesAfterEvent,
  dragTargetSlots,
  dropCommands,
  pileComposition,
  rewardViewStage,
  sameCommand,
  stepSequence,
} from "./interaction";
import type {
  CoinFaces,
  CoinPileGroup,
  CoinPileZone,
  DragSource,
} from "./interaction";
import { clearRun, loadRun, saveRun } from "./run-storage";
import {
  beginHumanCombat,
  createHumanRunTrace,
  downloadHumanRunTrace,
  finishHumanCombat,
  finishHumanRun,
  recordHumanDecision,
  recordHumanReward,
} from "./telemetry";
import type { HumanRunTrace, RecordHumanRewardInput } from "./telemetry";
import { TurnBuffBar } from "./turn-buff";

// 생성 에셋 (docs/ui/combat-ui-v2.png 앵커 스타일 — image_gen 산출, 후처리: 크로마 키·리사이즈)
const CARD_ART: Record<string, string> = {
  slash: cardSlash,
  guard: cardGuard,
  "burning-strike": cardBurningStrike,
  ignite: cardIgnite,
  "ignite-sword": cardIgniteSword,
  "flame-rampage": cardFlameRampage,
  "warding-strike": cardWardingStrike,
  "mana-bulwark": cardManaBulwark,
  "shield-reprisal": cardShieldReprisal,
  "mana-well": cardManaWell,
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
  "frost-slash": cardFrostSlash,
  "glacial-wall": cardGlacialWall,
  "chilling-field": cardChillingField,
  "glacier-strike": cardGlacierStrike,
  "winters-grasp": cardWintersGrasp,
  "aegis-surge": cardAegisSurge,
};

const WORDS = [
  "BRAVE",
  "EMBER",
  "IRON",
  "MOSS",
  "RIVER",
  "DUSK",
  "SPARK",
  "VALE",
];

interface SpriteAsset {
  atlasUrl: string;
  fallbackFor?: CharacterId;
  manifest: SpriteManifest;
}

const SPRITES: Record<
  "player" | "guardian" | "sorcerer" | "frost-knight" | "raider" | "shaman" | "gatekeeper",
  SpriteAsset
> = {
  player: {
    atlasUrl: warriorAtlas,
    manifest: warriorManifestJson as SpriteManifest,
  },
  guardian: {
    atlasUrl: guardianAtlas,
    manifest: guardianManifestJson as SpriteManifest,
  },
  sorcerer: {
    atlasUrl: sorcererAtlas,
    manifest: sorcererManifestJson as SpriteManifest,
  },
  "frost-knight": {
    atlasUrl: frostKnightAtlas,
    manifest: frostKnightManifestJson as SpriteManifest,
  },
  raider: {
    atlasUrl: goblinAtlas,
    manifest: goblinManifestJson as SpriteManifest,
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
  return SPRITES.raider;
};

const playerSprite = (character: CharacterId): SpriteAsset => {
  if (String(character) === "guardian") return SPRITES.guardian;
  if (String(character) === "sorcerer") return SPRITES.sorcerer;
  if (String(character) === "frost-knight") return SPRITES["frost-knight"];
  return SPRITES.player;
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
type DragState = {
  coin: CoinUid;
  source: DragSource;
  started: boolean;
  x: number;
  y: number;
  targets: Set<number>;
  over: number | null; // 합법 목적지 위일 때만
  overCard: number | null; // 합법 여부와 무관하게 포인터 아래의 카드
  overTray: boolean;
};

const slot = (value: number): SlotId => value as SlotId;

const randomSeed = (): string =>
  Array.from(
    { length: 3 },
    () => WORDS[Math.floor(Math.random() * WORDS.length)] ?? "EMBER",
  ).join("-") + `-${Math.floor(Math.random() * 90 + 10)}`;

const seedFromUrl = (): string => {
  const url = new URL(window.location.href);
  const existing = url.searchParams.get("seed");
  if (existing !== null && existing.trim().length > 0) return existing;
  const seed = randomSeed();
  url.searchParams.set("seed", seed);
  window.history.replaceState(null, "", url);
  return seed;
};

const combatReducer = (
  _state: CombatState,
  action: CombatAction,
): CombatState => {
  return action.state;
};

const IntentBadge = ({ enemy }: { enemy: CombatState["enemies"][number] }) => (
  <div aria-label="다음 행동 의도" className="intent">
    {enemy.intent.actions.map((action, index) =>
      action.kind === "attack" ? (
        <span key={index}>
          <SwordIcon scale={1.6} />
          {action.hits !== undefined && action.hits > 1
            ? `${action.damage}×${action.hits}`
            : action.damage}
        </span>
      ) : action.kind === "block" ? (
        <span key={index}>
          <ShieldIcon scale={1.6} tone="steel" />
          {action.amount}
        </span>
      ) : action.kind === "applyStatus" ? (
        <span key={index} aria-label={`${statusKo(action.status)} ${action.stacks} 부여`}>
          <Keyword term={action.status}>
            {statusKo(action.status)} {action.stacks}
          </Keyword>
        </span>
      ) : action.kind === "heal" ? (
        <span key={index} aria-label={`자가 회복 ${action.amount}`}>
          회복 {action.amount}
        </span>
      ) : action.kind === "buffNextAttack" ? (
        // 충전 타입 없음(사용자 확정) — 버프 의도로 표시, 강공 예고는 패턴 순서가 담당
        <span key={index} aria-label={`버프: 다음 공격 +${action.amount}`}>
          ↑ 공격 +{action.amount}
        </span>
      ) : (
        <span key={index} aria-label={`다음 드로우 ${action.amount} 감소`}>
          <Keyword term="wither">위축 -{action.amount}</Keyword>
        </span>
      ),
    )}
  </div>
);

const effectText = (skillId: string): string => {
  const skill = contentDb.skills[skillId];
  const atomText = (atom: EffectAtom): string => {
    if (atom.kind === "damage") return `피해 ${atom.amount}`;
    if (atom.kind === "block") return `방어 ${atom.amount}`;
    if (atom.kind === "applyStatus" && atom.status === "burn")
      return `화상 ${atom.stacks}`;
    if (atom.kind === "addCoin")
      return `임시 ${elementKo(String(atom.coin))} +${atom.count}`;
    if (atom.kind === "selfDamage") return `자신 피해 ${atom.amount}`;
    if (atom.kind === "grantElement")
      return `기본 코인 ${elementKo(atom.element)} 취급`;
    return "특수";
  };
  if (skill?.type === "consume") return skill.effects.map(atomText).join(" / ");
  if (skill?.type !== "flip") return "";
  const parts = skill.base.map(atomText);
  if (skill.heads !== undefined) {
    parts.push(
      ...skill.heads.effects.map((atom) =>
        atom.kind === "damage"
          ? `앞면 +${atom.amount}`
          : `앞면 ${atomText(atom)}`,
      ),
    );
  }
  if (skill.tails !== undefined) {
    parts.push(
      ...skill.tails.effects.map((atom) =>
        atom.kind === "block"
          ? `뒷면 +${atom.amount}`
          : `뒷면 ${atomText(atom)}`,
      ),
    );
  }
  return parts.join(" / ");
};

const ELEMENT_KO: Record<string, string> = {
  fire: "화염",
  mana: "마나",
  frost: "냉기",
  lightning: "전기",
  blood: "혈액",
};
const elementKo = (value: string): string => ELEMENT_KO[value] ?? value;

const coinLabel = (state: CombatState, coin: CoinUid): string => {
  const instance = state.coins[Number(coin)];
  const def =
    instance === undefined
      ? undefined
      : contentDb.coins[String(instance.defId)];
  const granted =
    instance?.grants.includes("fire") === true && def?.element !== "fire";
  return granted
    ? "기본+화염"
    : def?.element !== null && def?.element !== undefined
      ? elementKo(def.element)
      : "기본";
};

const coinVisualClasses = (state: CombatState, coin: CoinUid): string => {
  const instance = state.coins[Number(coin)];
  const def =
    instance === undefined
      ? undefined
      : contentDb.coins[String(instance.defId)];
  return [
    def?.element === "fire" ? "fire" : "",
    def?.element === "mana" ? "mana" : "",
    def?.element === "frost" ? "frost" : "",
    def?.element === "lightning" ? "lightning" : "",
    instance?.grants.includes("fire") === true && def?.element !== "fire"
      ? "granted-fire"
      : "",
    instance?.permanent === false ? "temporary" : "",
  ]
    .filter(Boolean)
    .join(" ");
};

const PILE_COPY: Record<
  CoinPileZone,
  { label: string; title: string; rule: string; empty: string }
> = {
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
  zone,
  groups,
}: {
  zone: CoinPileZone;
  groups: CoinPileGroup[];
}) => {
  const copy = PILE_COPY[zone];
  return (
    <div
      aria-label={`${copy.label} 구성`}
      className={`pile-pop ${zone === "draw" ? "pouch-pop" : ""} ${zone}`}
      id={`${zone}-pile-pop`}
      role="dialog"
    >
      <strong>{copy.title}</strong>
      <p className="pile-rule">{copy.rule}</p>
      {groups.length === 0 ? (
        <p className="pop-empty">{copy.empty}</p>
      ) : (
        <ul>
          {groups.map((group) => {
            const granted = group.grants.filter(
              (element) => element !== group.element,
            );
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
              <li
                key={`${group.defId}-${String(group.temporary)}-${group.grants.join("-")}`}
              >
                <span
                  aria-hidden="true"
                  className={`pop-coin ${group.element ?? ""} ${granted.includes("fire") ? "granted-fire" : ""} ${group.temporary ? "temporary" : ""}`}
                />
                <span className="pile-item-copy">
                  {group.element === null ? "기본" : elementKo(group.element)}
                  {granted.length > 0
                    ? ` · ${granted.map(elementKo).join("+")} 취급`
                    : ""}
                  {group.temporary ? " (임시)" : ""} ×{group.count}
                  <small>{lifecycle}</small>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
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
}) => (
  <span
    className={`socket-coin ${coinVisualClasses(state, coin)} ${flipping === true ? "flipping" : ""} ${
      face !== undefined ? `face-${face}` : ""
    } ${vfx ? "vfx-reveal" : ""}`}
  >
    {face !== undefined ? (
      <span className={`coin-face-mark ${face}`}>
        {face === "heads" ? "앞" : "뒤"}
      </span>
    ) : null}
  </span>
);

interface RunSession {
  run: RunState;
  combat: CombatState | null;
}

type BootState =
  | { mode: "select"; seed: string | null }
  | { mode: "run"; session: RunSession };

const replaceUrlSeed = (seed: string, character?: CharacterId): void => {
  const url = new URL(window.location.href);
  url.searchParams.set("seed", seed);
  if (character !== undefined && String(character) !== "warrior") {
    url.searchParams.set("character", String(character));
  } else {
    url.searchParams.delete("character");
  }
  window.history.replaceState(null, "", url);
};

const characterFromUrl = (): CharacterId | null => {
  const character = new URL(window.location.href).searchParams.get("character");
  if (character === null) return null;
  return contentDb.characters[character] === undefined
    ? null
    : (character as CharacterId);
};

const testEncounterFromUrl = (): readonly EnemyDefId[] | null => {
  const encounter = new URL(window.location.href).searchParams.get("encounter");
  // 테스트 전용 전투 표면: 정식 런 encounter 테이블을 건드리지 않고 UI에서만 적 배열을 바꾼다.
  return encounter === "duo-raiders"
    ? (["raider" as EnemyDefId, "raider" as EnemyDefId] as const)
    : null;
};

const testSkillsFromUrl = (
  fallback: RunState["equippedSkills"],
): RunState["equippedSkills"] | null => {
  const skills = new URL(window.location.href).searchParams.get("skills");
  if (skills === null) return null;
  // 테스트 전용 스킬 표면: 정식 콘텐츠·런 보상 로직을 건드리지 않고 UI 시작 장착만 바꾼다.
  const valid = skills
    .split(",")
    .map((skill) => skill.trim())
    .filter((skill) => contentDb.skills[skill] !== undefined)
    .slice(0, 6)
    .map((skill) => skill as SkillId);
  if (valid.length === 0) return null;
  return fallback.map((skill, index) => valid[index] ?? skill) as RunState["equippedSkills"];
};

const persistRun = (run: RunState): void => {
  try {
    saveRun(window.localStorage, run, contentDb);
  } catch {
    // 저장소가 차단된 브라우저에서도 현재 탭의 런은 계속 플레이할 수 있다.
  }
};

const freshSession = (
  seed: string,
  character: CharacterId = "warrior" as CharacterId,
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
  const ready =
    skillOverride === null
      ? created
      : { ...created, equippedSkills: skillOverride };
  const testEnemies = testEncounterFromUrl();
  if (testEnemies !== null) {
    const run = { ...ready, phase: "combat" as const };
    return {
      run,
      combat: createCombat(
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
      ),
    };
  }
  const started = startRunCombat(ready, contentDb);
  return { run: started.run, combat: started.combat };
};

const bootState = (): BootState => {
  const url = new URL(window.location.href);
  const urlSeed = url.searchParams.get("seed");
  const testCharacter = characterFromUrl();
  const hasSeed = urlSeed !== null && urlSeed.trim().length > 0;
  const hasTestBoot =
    testEncounterFromUrl() !== null ||
    url.searchParams.has("skills") ||
    testCharacter !== null;
  if (hasTestBoot)
    return {
      mode: "run",
      session: freshSession(seedFromUrl(), testCharacter ?? ("warrior" as CharacterId)),
    };
  const saved = loadRun(window.localStorage, CONTENT_VERSION, contentDb);
  if (saved === null) {
    // URL contract: existing playtests boot with ?seed= and must keep the legacy
    // warrior fast path. Character selection appears only on pure new entry or
    // explicit ?select=1 so seed reproducibility and harness URLs stay stable.
    if (!hasSeed || url.searchParams.get("select") === "1") {
      return { mode: "select", seed: hasSeed ? urlSeed : null };
    }
    return { mode: "run", session: freshSession(urlSeed, "warrior" as CharacterId) };
  }
  replaceUrlSeed(saved.runSeed, saved.character);
  if (saved.phase !== "combat")
    return { mode: "run", session: { run: saved, combat: null } };
  const resumed = resumeAbandonedCombat(saved);
  const started = startRunCombat(resumed, contentDb);
  return { mode: "run", session: { run: started.run, combat: started.combat } };
};

const coinName = (coin: CoinDefId): string =>
  coinNameFor(contentDb, String(coin));

const coinRewardDetail = (coin: CoinDefId): string =>
  coinRewardDetailFor(contentDb, String(coin));

const skillRarityName = (skill: SkillId): string => {
  const rarity = contentDb.skills[String(skill)]?.rarity;
  return rarity === "rare" ? "희귀" : rarity === "advanced" ? "고급" : "일반";
};

const SkillRewardMark = ({
  skill,
  scale = 3.2,
}: {
  skill: SkillId;
  scale?: number;
}) => {
  const tags = contentDb.skills[String(skill)]?.tags ?? [];
  if (tags.includes("defense")) return <ShieldIcon scale={scale} />;
  if (tags.includes("attack")) return <SwordIcon scale={scale} />;
  return <EmberIcon scale={scale} />;
};

const enemyNameFor = (run: RunState): string => {
  const id = RUN_ENCOUNTERS[run.combatIndex]?.[0];
  return id === undefined
    ? "적"
    : (contentDb.enemies[String(id)]?.name ?? "적");
};

const RunMeta = ({ run }: { run: RunState }) => {
  const progress =
    run.phase === "rewards"
      ? `전투 ${run.combatIndex}/${RUN_ENCOUNTER_COUNT} 완료`
      : run.phase === "ready"
        ? `다음 전투 ${run.combatIndex + 1}/${RUN_ENCOUNTER_COUNT}`
        : run.phase === "victory" || run.phase === "defeat"
          ? "런 결과"
          : `전투 ${run.combatIndex + 1}/${RUN_ENCOUNTER_COUNT}`;
  const context =
    run.phase === "rewards"
      ? "보상 선택"
      : run.phase === "victory"
        ? "승리"
        : run.phase === "defeat"
          ? "패배"
          : enemyNameFor(run);
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
      <span>시도 {run.attempt + 1}</span>
      <small>SEED {run.runSeed}</small>
    </header>
  );
};

const RunGame = ({ initialSession }: { initialSession: RunSession }) => {
  const [session, setSession] = useState<RunSession>(initialSession);
  const [removalIndex, setRemovalIndex] = useState<number | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillId | null>(null);
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
  const rewardStage = rewardViewStage(run);
  const isCoinStage = rewardStage === "coin" || rewardStage === "fallback-coin";

  useEffect(() => persistRun(run), [run]);

  useEffect(() => {
    setRemovalIndex(null);
    setSelectedSkill(null);
  }, [run.combatIndex, run.phase, rewardStage]);

  useEffect(() => {
    if (combat === null) primaryRef.current?.focus();
  }, [combat, rewardStage, run.phase, selectedSkill]);

  const commitRun = (next: RunState) => {
    persistRun(next);
    setSession({ run: next, combat: null });
  };

  const commitReward = (next: RunState, reward: RecordHumanRewardInput) => {
    telemetryRef.current = recordHumanReward(currentTelemetry(), reward);
    commitRun(next);
  };

  const startNextCombat = () => {
    const started = startRunCombat(run, contentDb);
    persistRun(started.run);
    setSession({ run: started.run, combat: started.combat });
  };

  const completeCombat = (completed: CombatState) => {
    if (run.phase !== "combat") return;
    telemetryRef.current = finishHumanCombat(
      currentTelemetry(),
      run.combatIndex,
      run.attempt,
      completed,
    );
    const settled = settleRunCombat(run, completed, contentDb);
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
  ) => {
    telemetryRef.current = recordHumanDecision(currentTelemetry(), {
      combatIndex: run.combatIndex,
      attempt: run.attempt,
      before,
      commands,
      after,
      events,
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

  if (run.phase === "combat" && combat !== null) {
    return (
      <CombatBoard
        combat={combat}
        key={`${run.runSeed}-${run.combatIndex}-${run.attempt}`}
        onTelemetryCombatStart={beginTelemetryCombat}
        onTelemetryDecision={recordTelemetryDecision}
        onComplete={completeCombat}
        run={run}
      />
    );
  }

  const pending = run.pendingRewards;
  return (
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
      <RunMeta run={run} />
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
        <section
          className={`result-panel run-panel phase-${run.phase} stage-${rewardStage ?? "none"}`}
        >
          {run.phase === "rewards" && pending !== undefined ? (
            <>
              <p className="run-kicker">
                전투 {run.combatIndex}/{RUN_ENCOUNTER_COUNT} 완료
              </p>
              <h1>전투 보상</h1>
              <p
                className="reward-step"
                data-reward-stage={rewardStage ?? undefined}
                data-testid="reward-stage"
              >
                {rewardStage === "coin"
                  ? "1/3 · 코인 추가"
                  : rewardStage === "removal"
                    ? "2/3 · 코인 제거"
                    : rewardStage === "fallback-coin"
                      ? "대체 보상 · 추가 코인"
                      : "3/3 · 스킬 선택"}
              </p>

              {isCoinStage ? (
                <div
                  className={`reward-body ${rewardStage === "fallback-coin" ? "fallback-reward" : ""}`}
                >
                  <p>
                    {rewardStage === "fallback-coin"
                      ? "새 스킬 후보가 부족해 추가 영구 코인 보상으로 대체되었습니다."
                      : "주머니에 영구 코인 하나를 추가합니다."}
                  </p>
                  <div className="reward-grid coin-rewards">
                    {pending.coinOptions.map((coin, index) => (
                      <button
                        className={`reward-choice coin-${String(contentDb.coins[String(coin)]?.element ?? "basic")}`}
                        data-testid={`coin-reward-${String(coin)}`}
                        key={String(coin)}
                        ref={index === 0 ? primaryRef : undefined}
                        type="button"
                        onClick={() =>
                          commitReward(chooseCoinReward(run, coin), {
                            combatIndex: run.combatIndex - 1,
                            stage:
                              rewardStage === "fallback-coin"
                                ? "fallback-coin"
                                : "coin",
                            options: pending.coinOptions.map(String),
                            choice: String(coin),
                            resolution: "selected",
                          })
                        }
                      >
                        <span className="reward-coin" aria-hidden="true" />
                        <strong>{coinName(coin)}</strong>
                        <small>{coinRewardDetail(coin)}</small>
                        <em>주머니 +1</em>
                      </button>
                    ))}
                  </div>
                  <button
                    className="secondary-action"
                    data-testid="coin-reward-skip"
                    type="button"
                    onClick={() =>
                      commitReward(chooseCoinReward(run, null), {
                        combatIndex: run.combatIndex - 1,
                        stage:
                          rewardStage === "fallback-coin"
                            ? "fallback-coin"
                            : "coin",
                        options: pending.coinOptions.map(String),
                        choice: null,
                        resolution: "skipped",
                      })
                    }
                  >
                    {rewardStage === "fallback-coin"
                      ? "대체 코인 건너뛰기"
                      : "코인 보상 건너뛰기"}
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
                        {pending.skillOptions.map((skill, index) => (
                          <button
                            className="reward-choice skill-choice"
                            data-testid={`skill-reward-${String(skill)}`}
                            key={String(skill)}
                            ref={index === 0 ? primaryRef : undefined}
                            type="button"
                            onClick={() => setSelectedSkill(skill)}
                          >
                            <span
                              className="skill-reward-mark"
                              aria-hidden="true"
                            >
                              <SkillRewardMark skill={skill} />
                            </span>
                            <em
                              className={`rarity rarity-${contentDb.skills[String(skill)]?.rarity ?? "common"}`}
                            >
                              {skillRarityName(skill)}
                            </em>
                            <strong>
                              {contentDb.skills[String(skill)]?.name ??
                                String(skill)}
                            </strong>
                            <small>{effectText(String(skill))}</small>
                          </button>
                        ))}
                      </div>
                      <button
                        className="secondary-action"
                        data-testid="skill-reward-skip"
                        type="button"
                        onClick={() =>
                          commitReward(skipSkillReward(run), {
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
                        <strong>
                          {contentDb.skills[String(selectedSkill)]?.name ??
                            String(selectedSkill)}
                        </strong>{" "}
                        — 교체할 슬롯을 고르세요.
                      </p>
                      <div
                        aria-label="교체할 스킬 슬롯"
                        className="replacement-list"
                      >
                        {run.equippedSkills.map((skill, index) => (
                          <button
                            aria-label={`슬롯 ${index + 1} ${contentDb.skills[String(skill)]?.name ?? String(skill)} 교체`}
                            data-testid={`replace-slot-${index}`}
                            key={`${String(skill)}-${index}`}
                            ref={index === 0 ? primaryRef : undefined}
                            type="button"
                            onClick={() =>
                              commitReward(
                                chooseSkillReward(run, selectedSkill, index),
                                {
                                  combatIndex: run.combatIndex - 1,
                                  stage: "skill",
                                  options: pending.skillOptions.map(String),
                                  choice: String(selectedSkill),
                                  resolution: "selected",
                                  replacedSlot: index,
                                },
                              )
                            }
                          >
                            <span
                              aria-hidden="true"
                              className="replacement-mark"
                            >
                              <SkillRewardMark scale={2.6} skill={skill} />
                            </span>
                            <span className="replacement-copy">
                              <small>
                                슬롯 {index + 1} · {skillRarityName(skill)}
                              </small>
                              <strong>
                                {contentDb.skills[String(skill)]?.name ??
                                  String(skill)}
                              </strong>
                            </span>
                          </button>
                        ))}
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
                            commitReward(skipSkillReward(run), {
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
            </>
          ) : run.phase === "ready" ? (
            <>
              <p className="run-kicker">보상 선택 완료</p>
              <h1>다음 전투</h1>
              <p>
                {enemyNameFor(run)} · HP {run.currentHp}/{run.maxHp}
              </p>
              <p>체력은 회복되지 않고 그대로 이어집니다.</p>
              <button
                data-testid="next-combat"
                ref={primaryRef}
                type="button"
                onClick={startNextCombat}
              >
                전투 {run.combatIndex + 1}/{RUN_ENCOUNTER_COUNT} 시작
              </button>
            </>
          ) : (
            <>
              <p className="run-kicker">
                전투 {run.combatIndex + 1}/{RUN_ENCOUNTER_COUNT}
              </p>
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
  );
};

export const App = () => {
  const [boot, setBoot] = useState<BootState>(bootState);
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
          characters={Object.values(contentDb.characters)}
          contentDb={contentDb}
          seed={boot.seed}
          onSelect={(character) => {
            const seed = boot.seed ?? randomSeed();
            replaceUrlSeed(seed, character);
            const session = freshSession(seed, character);
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
      key={`${boot.session.run.runSeed}-${String(boot.session.run.character)}`}
    />
  );
};

interface CombatBoardProps {
  combat: CombatState;
  run: RunState;
  onComplete: (combat: CombatState) => void;
  onTelemetryCombatStart: (combat: CombatState) => void;
  onTelemetryDecision: (
    before: CombatState,
    commands: readonly Command[],
    after: CombatState,
    events: readonly CombatEvent[],
  ) => void;
}

const CombatBoard = ({
  combat,
  run,
  onComplete,
  onTelemetryCombatStart,
  onTelemetryDecision,
}: CombatBoardProps) => {
  const [state, dispatchState] = useReducer(combatReducer, combat);
  const [selectedCoin, setSelectedCoin] = useState<CoinUid | null>(null);
  const [fuelSelection, setFuelSelection] = useState<FuelSelection | null>(
    null,
  );
  const [coinChoice, setCoinChoice] = useState<CoinChoiceSelection | null>(
    null,
  );
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
  const [lastAttackTarget, setLastAttackTarget] = useState<number | null>(null);
  const [shakeCoin, setShakeCoin] = useState<CoinUid | null>(null);
  const [hintStage, setHintStage] = useState<0 | 1 | 2>(0);
  const [openPile, setOpenPile] = useState<CoinPileZone | null>(null);
  const [resolutionTicket, setResolutionTicket] =
    useState<ResolutionSummary | null>(null);
  const [vfx, setVfx] = useState<Set<string>>(() => new Set());
  const pouchRef = useRef<HTMLDivElement | null>(null);
  const pileCountsRef = useRef<HTMLDivElement | null>(null);
  const pendingResolution = useRef<PendingResolution | null>(null);
  const resolutionTimer = useRef<number | null>(null);
  const nextFloatId = useRef(1);
  const nextRejectionId = useRef(1);
  const rejectionTimer = useRef<number | null>(null);
  const initialEventsQueued = useRef(false);
  const completionSent = useRef(false);
  const suppressClick = useRef(false);
  const legal = useMemo(() => legalCommands(state, contentDb), [state]);

  const selectCoin = (coin: CoinUid | null) => setSelectedCoin(coin);

  const clearResolutionTicket = () => {
    if (resolutionTimer.current !== null) {
      window.clearTimeout(resolutionTimer.current);
      resolutionTimer.current = null;
    }
    setResolutionTicket(null);
  };

  const showResolutionTicket = (pending: PendingResolution) => {
    const skill = contentDb.skills[String(pending.skillId)];
    if (skill === undefined) return;
    clearResolutionTicket();
    setResolutionTicket(buildResolutionSummary(skill, pending.events));
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
      const insidePileCounts =
        pileCountsRef.current?.contains(event.target) === true;
      if (!insidePouch && !insidePileCounts) setOpenPile(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [openPile]);

  const togglePile = (zone: CoinPileZone) =>
    setOpenPile((open) => (open === zone ? null : zone));

  const findLegal = (cmd: Command): Command | undefined =>
    legal.find((candidate) => sameCommand(candidate, cmd));

  const withTarget = (
    command: TargetingCommand,
    target: number,
  ): TargetingCommand => ({ ...command, target });

  const targetingCommandFor = (
    command: TargetingCommand,
  ): TargetingCommand | undefined =>
    legal.find(
      (candidate): candidate is TargetingCommand =>
        (candidate.type === "useFlipSkill" ||
          candidate.type === "useConsumeSkill") &&
        candidate.type === command.type &&
        candidate.slot === command.slot &&
        (candidate.type !== "useConsumeSkill" ||
          command.type !== "useConsumeSkill" ||
          (candidate.coins.length === command.coins.length &&
            candidate.coins.every(
              (coin, index) => coin === command.coins[index],
            ))),
    );

  const showRejection = (text: string) => {
    if (showResult) return;
    if (rejectionTimer.current !== null)
      window.clearTimeout(rejectionTimer.current);
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
      if (rejectionTimer.current !== null)
        window.clearTimeout(rejectionTimer.current);
      if (resolutionTimer.current !== null)
        window.clearTimeout(resolutionTimer.current);
    },
    [],
  );

  const commit = (nextState: CombatState, events: CombatEvent[]) => {
    dispatchState({ type: "set", state: nextState });
    selectCoin(null);
    setFuelSelection(null);
    setCoinChoice(null);
    setTargeting(null);
    // 장전/회수는 상태 반영이 곧 피드백 — 큐·잠금 없이 즉답해 연속 장전이 끊기지 않는다
    const animated = events.filter(
      (event) => event.type !== "coinPlaced" && event.type !== "coinUnplaced",
    );
    if (animated.length > 0) {
      setLocked(true);
      setQueue((pending) => [...pending, ...animated]);
    }
    if (events.some((event) => event.type === "coinPlaced"))
      setHintStage((stage) => (stage === 0 ? 1 : stage));
    const skillUsed = events.find((event) => event.type === "skillUsed");
    if (skillUsed !== undefined) {
      setHintStage(2);
      pendingResolution.current = { skillId: skillUsed.skill, events };
    }
  };

  const runCommand = (cmd: Command, showFeedback = false): boolean => {
    if (locked) {
      if (showFeedback) showRejection(REJECTION_TEXT.notPlayerPhase);
      return false;
    }
    const reason = rejectionReason(state, cmd, contentDb);
    if (reason !== null) {
      if (showFeedback) showRejection(reason);
      return false;
    }
    const legalCommand = findLegal(cmd);
    if (legalCommand === undefined) {
      if (showFeedback) showRejection(REJECTION_TEXT.generic);
      return false;
    }
    const result = step(state, legalCommand, contentDb);
    if (!result.ok) {
      if (showFeedback) showRejection(REJECTION_TEXT.generic);
      return false;
    }
    clearResolutionTicket();
    onTelemetryDecision(state, [legalCommand], result.state, result.events);
    if (
      (legalCommand.type === "useFlipSkill" ||
        legalCommand.type === "useConsumeSkill") &&
      legalCommand.target !== undefined
    )
      setLastAttackTarget(legalCommand.target);
    commit(result.state, result.events);
    return true;
  };

  const runSelectedFuel = (cmd: Command, showFeedback = false): boolean => {
    if (locked) {
      if (showFeedback) showRejection(REJECTION_TEXT.notPlayerPhase);
      return false;
    }
    const result = step(state, cmd, contentDb);
    if (!result.ok) {
      if (showFeedback) showRejection(REJECTION_TEXT.generic);
      return false;
    }
    clearResolutionTicket();
    onTelemetryDecision(state, [cmd], result.state, result.events);
    if (
      (cmd.type === "useFlipSkill" || cmd.type === "useConsumeSkill") &&
      cmd.target !== undefined
    )
      setLastAttackTarget(cmd.target);
    commit(result.state, result.events);
    return true;
  };

  const runSequence = (
    commands: readonly Command[],
    showFeedback = false,
  ): boolean => {
    if (locked || commands.length === 0) {
      if (showFeedback && locked) showRejection(REJECTION_TEXT.notPlayerPhase);
      else if (showFeedback) showRejection(REJECTION_TEXT.generic);
      return false;
    }
    const result = stepSequence(state, commands, contentDb);
    if (result === null) {
      if (showFeedback) {
        const reason =
          commands
            .map((command) => rejectionReason(state, command, contentDb))
            .find((candidate): candidate is string => candidate !== null) ??
          REJECTION_TEXT.generic;
        showRejection(reason);
      }
      return false;
    }
    clearResolutionTicket();
    onTelemetryDecision(state, commands, result.state, result.events);
    commit(result.state, result.events);
    return true;
  };

  // 사용 선언 — 플립 스킬은 해결 직전의 장전 코인을 고스트로 붙잡아 연출 대상이 되게 한다
  const useSkill = (cmd: Command, showFeedback = true) => {
    setFuelSelection(null);
    setCoinChoice(null);
    setTargeting(null);
    if (cmd.type === "useFlipSkill") {
      const ghosts = [...(state.zones.placed[cmd.slot] ?? [])];
      const committed =
        cmd.chosen === undefined
          ? runCommand(cmd, showFeedback)
          : runSelectedFuel(cmd, showFeedback);
      if (committed && ghosts.length > 0)
        setResolving({ slot: Number(cmd.slot), coins: ghosts });
      return;
    }
    runCommand(cmd, showFeedback);
  };

  const beginTargeting = (
    command: TargetingCommand,
    showFeedback = true,
  ): boolean => {
    const legalTargets = legalTargetsForCommand(legal, command).filter(
      (target, index, targets) => targets.indexOf(target) === index,
    );
    if (legalTargets.length === 0) {
      if (showFeedback) showRejection(REJECTION_TEXT.generic);
      return false;
    }
    if (
      livingEnemyTargets(state.enemies).length < 2 ||
      legalTargets.length === 1
    ) {
      const target = legalTargets[0];
      if (target === undefined) return false;
      useSkill(withTarget(command, target), showFeedback);
      return true;
    }
    const selected = defaultTarget(legalTargets, lastAttackTarget);
    if (selected === null) {
      if (showFeedback) showRejection(REJECTION_TEXT.generic);
      return false;
    }
    selectCoin(null);
    setFuelSelection(null);
    setCoinChoice(null);
    setTargeting({ command, legalTargets, selected });
    return true;
  };

  const confirmTargeting = (target = targeting?.selected): boolean => {
    if (targeting === null || target === undefined) return false;
    if (!targeting.legalTargets.includes(target)) {
      showRejection(REJECTION_TEXT.generic);
      return true;
    }
    useSkill(withTarget(targeting.command, target), true);
    return true;
  };

  const activateConsumeSkill = (
    slotId: SlotId,
    skill: NonNullable<(typeof contentDb.skills)[string]>,
    autoCommand: Extract<Command, { type: "useConsumeSkill" }> | undefined,
    showFeedback = true,
  ) => {
    if (skill.type !== "consume") return;
    // count==1 deliberately keeps the existing App path: use the single
    // legalCommands auto suggestion immediately, without fuel-selection state.
    if (!requiresFuelSelection(state, slotId, contentDb)) {
      if (autoCommand !== undefined) {
        if (skill.targetType === "single-enemy")
          beginTargeting(autoCommand, showFeedback);
        else useSkill(autoCommand, showFeedback);
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
      const coins = autoSuggestFuel(state, slotId, contentDb);
      if (coins.length < skill.consume.count) {
        const reason = rejectionReason(
          state,
          {
            type: "useConsumeSkill",
            slot: slotId,
            coins: [],
            target: skill.targetType === "single-enemy" ? 0 : undefined,
          },
          contentDb,
        );
        if (showFeedback) showRejection(reason ?? REJECTION_TEXT.coinCost);
        return;
      }
      selectCoin(null);
      setCoinChoice(null);
      setTargeting(null);
      setFuelSelection({ slot: slotId, coins });
      return;
    }
    const command = fuelCommand(fuelSelection, state, contentDb);
    if (command === null) {
      if (showFeedback) showRejection(REJECTION_TEXT.coinCost);
      return;
    }
    if (
      command.type === "useConsumeSkill" &&
      skill.targetType === "single-enemy"
    )
      beginTargeting(command, showFeedback);
    else runSelectedFuel(command, showFeedback);
  };

  const activateFlipSkill = (
    slotId: SlotId,
    skill: NonNullable<(typeof contentDb.skills)[string]>,
    autoCommand: Extract<Command, { type: "useFlipSkill" }> | undefined,
    showFeedback = true,
  ) => {
    if (skill.type !== "flip") return;
    if (!requiresCoinChoiceSelection(state, slotId, contentDb)) {
      if (autoCommand !== undefined) {
        if (skill.targetType === "single-enemy")
          beginTargeting(autoCommand, showFeedback);
        else useSkill(autoCommand, showFeedback);
      } else {
        const coins = autoSuggestCoinChoice(state, slotId, contentDb);
        const command = coinChoiceCommand(
          { slot: slotId, coins },
          state,
          contentDb,
        );
        if (command !== null) {
          if (skill.targetType === "single-enemy")
            beginTargeting(command, showFeedback);
          else useSkill(command, showFeedback);
        } else
          runCommand(
            {
              type: "useFlipSkill",
              slot: slotId,
              target: skill.targetType === "single-enemy" ? 0 : undefined,
            },
            showFeedback,
          );
      }
      return;
    }
    if (coinChoice?.slot !== slotId) {
      selectCoin(null);
      setFuelSelection(null);
      setTargeting(null);
      setCoinChoice({
        slot: slotId,
        coins: autoSuggestCoinChoice(state, slotId, contentDb),
      });
      return;
    }
    const command = coinChoiceCommand(coinChoice, state, contentDb);
    if (command === null) {
      if (showFeedback) showRejection(REJECTION_TEXT.coinCost);
      return;
    }
    if (skill.targetType === "single-enemy") beginTargeting(command, showFeedback);
    else useSkill(command, showFeedback);
  };

  const onFuelCoinClick = (coin: CoinUid): boolean => {
    if (fuelSelection === null) return false;
    const next = toggleFuel(fuelSelection, coin, state, contentDb);
    if (next === fuelSelection) {
      const slotState = state.slots[Number(fuelSelection.slot)];
      const skill =
        slotState === undefined
          ? undefined
          : contentDb.skills[String(slotState.skillId)];
      const reason = rejectionReason(
        state,
        {
          type: "useConsumeSkill",
          slot: fuelSelection.slot,
          coins: [...fuelSelection.coins, coin],
          target: skill?.targetType === "single-enemy" ? 0 : undefined,
        },
        contentDb,
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
    const next = toggleCoinChoice(coinChoice, coin, state, contentDb);
    if (next === coinChoice) {
      showRejection(REJECTION_TEXT.generic);
      return true;
    }
    selectCoin(null);
    setCoinChoice(next);
    return true;
  };

  useEffect(() => {
    if (!locked) return undefined;
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
        }, 650);
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
    const showFloat = (
      text: string,
      target: "player" | "enemy",
      kind: FloatText["kind"],
      enemy?: number,
    ) => {
      const id = nextFloatId.current;
      nextFloatId.current += 1;
      setFloats((items) => [...items, { id, text, target, enemy, kind }]);
      window.setTimeout(
        () => setFloats((items) => items.filter((item) => item.id !== id)),
        900,
      );
    };

    let delay = 180;
    if (event?.type === "coinFlipped") {
      setFlipping((items) => ({ ...items, [Number(event.coin)]: true }));
      delay = 750;
      window.setTimeout(() => {
        setCoinFaces((faces) => coinFacesAfterEvent(faces, event));
        setFlipping((items) => ({ ...items, [Number(event.coin)]: false }));
        triggerVfx(`coin-${Number(event.coin)}`, 330);
      }, 600);
    } else if (event?.type === "coinsDrawn") {
      setCoinFaces((faces) => coinFacesAfterEvent(faces, event));
      delay = 220;
    } else if (event?.type === "damageDealt") {
      triggerVfx(
        event.target.type === "player"
          ? "unit-player"
          : `unit-enemy-${event.target.index}`,
      );
      showFloat(
        `-${event.amount}`,
        event.target.type === "player" ? "player" : "enemy",
        "damage",
        event.target.type === "enemy" ? event.target.index : undefined,
      );
      delay = event.source === "enemy" ? 520 : 420;
    } else if (event?.type === "blockGained") {
      triggerVfx(
        event.target.type === "player"
          ? "block-player"
          : `block-enemy-${event.target.index}`,
      );
      showFloat(
        `+${event.amount}`,
        event.target.type === "player" ? "player" : "enemy",
        "block",
        event.target.type === "enemy" ? event.target.index : undefined,
      );
      delay = 360;
    } else if (event?.type === "statusApplied") {
      if (event.status === "burn")
        triggerVfx(
          event.target.type === "player"
            ? "burn-player"
            : `burn-enemy-${event.target.index}`,
        );
      showFloat(
        `화상 +${event.stacks}`,
        event.target.type === "player" ? "player" : "enemy",
        "status",
        event.target.type === "enemy" ? event.target.index : undefined,
      );
      delay = 380;
    } else if (event?.type === "statusTicked") {
      if (event.status === "burn")
        triggerVfx(
          event.target.type === "player"
            ? "burn-player"
            : `burn-enemy-${event.target.index}`,
        );
      showFloat(
        `화상 -${event.amount}`,
        event.target.type === "player" ? "player" : "enemy",
        "status",
        event.target.type === "enemy" ? event.target.index : undefined,
      );
      delay = 460;
    } else if (event?.type === "witherApplied") {
      triggerVfx("wither-player");
      showFloat(`다음 드로우 -${event.amount}`, "player", "status");
      delay = 460;
    } else if (event?.type === "coinCreated") {
      showFloat("임시 코인", "player", "coin");
      delay = 320;
    } else if (event?.type === "turnTriggerAdded") {
      for (const trigger of state.turnTriggers) {
        if (trigger.trigger.id === event.trigger)
          triggerVfx(`turn-trigger-${trigger.uid}`, 320);
      }
      delay = 260;
    } else if (event?.type === "turnTriggerFired") {
      for (const trigger of state.turnTriggers) {
        if (trigger.trigger.id === event.trigger)
          triggerVfx(`turn-trigger-${trigger.uid}`, 360);
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

    const timer = window.setTimeout(() => setQueue(rest), delay + 150);
    return () => window.clearTimeout(timer);
  }, [locked, queue, resolving, state.turnTriggers]);

  // ---- 드래그 장전 (포인터 공통 — 마우스/터치, 6px 이하 이동은 클릭으로 취급) ----
  const beginDrag = (
    event: ReactPointerEvent<HTMLElement>,
    coin: CoinUid,
    source: DragSource,
  ) => {
    if (locked || drag !== null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      coin,
      source,
      started: false,
      x: event.clientX,
      y: event.clientY,
      targets: dragTargetSlots(state, coin, source, contentDb),
      over: null,
      overCard: null,
      overTray: false,
    });
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (drag === null) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.started && Math.hypot(dx, dy) < 6) return;
    const under = document.elementFromPoint(event.clientX, event.clientY);
    const card = under?.closest("[data-slot]") ?? null;
    const overSlot =
      card === null ? null : Number(card.getAttribute("data-slot"));
    setDrag({
      ...drag,
      started: true,
      x: event.clientX,
      y: event.clientY,
      over: overSlot !== null && drag.targets.has(overSlot) ? overSlot : null,
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
    // 자기 카드 위에 놓기 = 취소 (장전 유지) — 밖으로 끌어내야 회수
    if (
      drag.source.kind === "socket" &&
      drag.overCard === Number(drag.source.slot) &&
      drag.over === null
    ) {
      setDrag(null);
      return;
    }
    const target =
      drag.over !== null
        ? ({ kind: "slot", slot: slot(drag.over) } as const)
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
        event.preventDefault();
        const slotState = state.slots[Number(fuelSelection.slot)];
        const skill =
          slotState === undefined
            ? undefined
            : contentDb.skills[String(slotState.skillId)];
        if (skill !== undefined)
          activateConsumeSkill(fuelSelection.slot, skill, undefined, true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fuelSelection]);

  useEffect(() => {
    if (coinChoice === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCoinChoice(null);
        return;
      }
      if (event.key !== "Enter") return;
      event.preventDefault();
      const slotState = state.slots[Number(coinChoice.slot)];
      const skill =
        slotState === undefined
          ? undefined
          : contentDb.skills[String(slotState.skillId)];
      if (skill !== undefined)
        activateFlipSkill(coinChoice.slot, skill, undefined, true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [coinChoice]);

  useEffect(() => {
    if (targeting === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTargeting(null);
        return;
      }
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
  }, [targeting]);

  const clickGuard = (): boolean => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return true;
    }
    return false;
  };

  const ended = state.phase === "victory" || state.phase === "defeat";
  const showResult =
    ended &&
    !locked &&
    queue.length === 0 &&
    resolving === null &&
    floats.length === 0;
  const activeEvent = queue[0];
  const discardReceiving =
    activeEvent?.type === "coinsDiscarded" ||
    (activeEvent?.type === "coinCreated" && activeEvent.zone === "discard");
  const exhaustReceiving = activeEvent?.type === "coinsConsumed";
  const pouchReceiving = activeEvent?.type === "pileShuffled";
  const pileFlowText =
    activeEvent?.type === "coinsDiscarded"
      ? `버림 +${activeEvent.coins.length}`
      : activeEvent?.type === "coinsConsumed"
        ? `소모 +${activeEvent.coins.length}`
        : activeEvent?.type === "pileShuffled"
          ? `버림 ${activeEvent.count} → 주머니`
          : activeEvent?.type === "coinCreated" &&
              activeEvent.zone === "discard"
            ? "임시 동전 → 버림"
            : null;
  const spritePlayKey = activeEvent?.type === "damageDealt" ? queue.length : 0;
  const playerMotion = spriteMotionForEvent("player", activeEvent);
  const dragging = drag !== null && drag.started;
  const isTestEncounter = testEncounterFromUrl() !== null;

  useEffect(() => {
    if (!showResult || completionSent.current) return;
    completionSent.current = true;
    onComplete(state);
  }, [onComplete, showResult, state]);

  useEffect(() => {
    if (ended) setOpenPile(null);
    if (ended) setFuelSelection(null);
    if (ended) setCoinChoice(null);
    if (ended) setTargeting(null);
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
      data-test-encounter={isTestEncounter ? "duo-raiders" : undefined}
      data-run-phase={run.phase}
    >
      <div className="backdrop" aria-hidden="true">
        <img alt="" className="backdrop-img" src={bgForest} />
      </div>
      <RunMeta run={run} />
      {isTestEncounter ? (
        <span className="test-encounter-badge" aria-label="테스트 전용 전투 진입로">
          TEST duo-raiders
        </span>
      ) : null}
      <TurnBuffBar triggers={state.turnTriggers} vfx={vfx} />
      <section className="battlefield">
        <UnitPanel
          side="player"
          unitKey="player"
          sprite={playerSprite(run.character)}
          name={contentDb.characters[String(run.character)]?.name ?? "영웅"}
          hp={state.player.hp}
          maxHp={state.player.maxHp}
          block={state.player.block}
          statuses={state.player.statuses}
          floats={floats}
          motion={playerMotion}
          playKey={playerMotion === "idle" ? 0 : spritePlayKey}
          vfx={vfx}
        />
        <div className="enemy-line" aria-label="적 목록">
          {state.enemies.map((enemy, index) => {
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
                side="enemy"
                unitKey={`enemy-${index}`}
                sprite={enemySprite(String(enemy.defId))}
                name={contentDb.enemies[String(enemy.defId)]?.name ?? "적"}
                hp={enemy.hp}
                maxHp={enemy.maxHp}
                block={enemy.block}
                statuses={enemy.statuses}
                intent={<IntentBadge enemy={enemy} />}
                floats={floats}
                motion={enemyMotion}
                playKey={enemyMotion === "idle" ? 0 : spritePlayKey}
                vfx={vfx}
                enemyIndex={index}
                targeting={targeting !== null && targetLegal}
                targetSelected={targetSelected}
                onTarget={
                  targetLegal ? () => confirmTargeting(index) : undefined
                }
                attackBuff={enemy.nextAttackBonus}
              />
            );
          })}
        </div>
      </section>

      <section
        className={`skill-row ${locked ? "dimmed" : ""}`}
        aria-label="스킬 카드"
      >
        <div className="resolution-ticket-anchor" aria-live="polite">
          {resolutionTicket !== null ? (
            <ResolutionTicket summary={resolutionTicket} />
          ) : null}
        </div>
        {state.slots.slice(0, 6).map((slotState, index) => {
          const skill = contentDb.skills[String(slotState.skillId)];
          const placed = state.zones.placed[slot(index)] ?? [];
          const consumeUse = legal.find(
            (
              command,
            ): command is Extract<Command, { type: "useConsumeSkill" }> =>
              command.type === "useConsumeSkill" &&
              command.slot === slot(index),
          );
          const flipAttempt =
            skill?.type === "flip"
              ? ({
                  type: "useFlipSkill",
                  slot: slot(index),
                  target: skill.targetType === "single-enemy" ? 0 : undefined,
                } as const)
              : null;
          const use =
            skill?.type === "consume"
              ? consumeUse
              : flipAttempt !== null &&
                  skill?.targetType === "single-enemy"
                ? targetingCommandFor(flipAttempt)
                : flipAttempt !== null
                  ? findLegal(flipAttempt)
                  : undefined;
          const canPlaceSelected =
            selectedCoin !== null &&
            findLegal({
              type: "placeCoin",
              coin: selectedCoin,
              slot: slot(index),
            }) !== undefined;
          const dropTarget = dragging && drag.targets.has(index);
          const canPlace = canPlaceSelected || dropTarget;
          // 프리뷰는 사용 커맨드가 합법일 때만 (§3.5 preview → Preview | null) — 부분 장전·
          // 턴 3회 캡·재사용·전투 종료 등 코어가 해결을 거부하는 모든 상태를 legalCommands가 거른다
          const preview =
            skill?.type === "flip" &&
            placed.length === skill.cost &&
            use !== undefined
              ? previewFlip(state, slot(index), contentDb)
              : null;
          const consumeReady =
            skill?.type === "consume" &&
            (skill.consume.count === 1
              ? consumeUse !== undefined
              : fuelSelection?.slot === slot(index) &&
                fuelCommand(fuelSelection, state, contentDb) !== null);
          const selectingFuel =
            skill?.type === "consume" && fuelSelection?.slot === slot(index);
          const useAttempt =
            skill?.type === "consume"
              ? ({
                  type: "useConsumeSkill",
                  slot: slot(index),
                  coins: consumeUse?.coins ?? [],
                  target: skill.targetType === "single-enemy" ? 0 : undefined,
                } as const)
              : flipAttempt;
          const lockedOnce =
            skill?.oncePerCombat === true && slotState.usedThisCombat;
          const isResolving = resolving !== null && resolving.slot === index;
          const socketCoins = isResolving ? resolving.coins : placed;
          const placeSelectedFromCardArt = (
            event: ReactPointerEvent<HTMLElement>,
          ) => {
            if (selectedCoin === null) return;
            event.preventDefault();
            event.stopPropagation();
            runCommand(
              {
                type: "placeCoin",
                coin: selectedCoin,
                slot: slot(index),
              },
              true,
            );
          };
          return (
            <article
              className={`skill-card ${use !== undefined ? "ready" : ""} ${slotState.usedThisTurn ? "spent" : ""} ${lockedOnce ? "combat-locked" : ""} ${placed.length > 0 || isResolving ? "lifted" : ""} ${isResolving ? "resolving" : ""} ${dropTarget && drag?.over === index ? "drop-target" : ""}`}
              data-slot={index}
              key={String(slotState.skillId)}
              onClick={() => {
                if (clickGuard()) return;
                // 동전을 고른 동안 카드 클릭은 장전 전용 — 장전 불가면 아무 것도 하지 않는다
                // (연속 장전 중 오클릭이 스킬을 발동시키는 오발 방지). 사용은 선택 해제 후 클릭 또는 제목 버튼
                if (selectedCoin !== null) {
                  if (canPlaceSelected)
                    runCommand(
                      {
                        type: "placeCoin",
                        coin: selectedCoin,
                        slot: slot(index),
                      },
                      true,
                    );
                  else
                    runCommand(
                      {
                        type: "placeCoin",
                        coin: selectedCoin,
                        slot: slot(index),
                      },
                      true,
                    );
                  return;
                }
                if (skill?.type === "consume")
                  activateConsumeSkill(slot(index), skill, consumeUse, true);
                else if (skill?.type === "flip")
                  activateFlipSkill(
                    slot(index),
                    skill,
                    use?.type === "useFlipSkill" ? use : undefined,
                    true,
                  );
                else if (useAttempt !== null) runCommand(useAttempt, true);
              }}
            >
              {/* 접근성: 카드의 키보드 진입점은 이 실제 버튼 하나 — 소켓 버튼과 형제 관계라
                  중첩 인터랙티브가 없고, 소켓의 Enter/Space가 카드 사용으로 번지지 않는다.
                  사용 불가여도 포커스 가능(aria-disabled)해 카드 열람(상승)은 항상 키보드로 가능 */}
              <button
                aria-disabled={use === undefined}
                aria-label={`${skill?.name ?? "빈 슬롯"}${use !== undefined ? " 사용" : ""}`}
                className="card-title"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  if (clickGuard()) return;
                  if (skill?.type === "consume")
                    activateConsumeSkill(slot(index), skill, consumeUse, true);
                  else if (skill?.type === "flip")
                    activateFlipSkill(
                      slot(index),
                      skill,
                      use?.type === "useFlipSkill" ? use : undefined,
                      true,
                    );
                  else if (useAttempt !== null) runCommand(useAttempt, true);
                }}
              >
                {skill?.name ?? "빈 슬롯"}
              </button>
              {skill?.oncePerCombat === true ? (
                <span className="once-badge">전투당 1회</span>
              ) : null}
              <div
                className="sockets"
                aria-label={`${skill?.name ?? "스킬"} 코스트 소켓`}
              >
                {Array.from(
                  { length: skill?.type === "flip" ? skill.cost : 0 },
                  (_unused, socketIndex) => {
                    const coin = socketCoins[socketIndex];
                    return (
                      <button
                        aria-label={
                          coin === undefined
                            ? selectedCoin !== null
                              ? "선택한 동전 장전"
                              : "동전 장전"
                            : "장전된 동전 회수"
                        }
                        className={`socket ${coin !== undefined ? "loaded" : ""} ${coin === undefined && canPlace ? "accept" : ""}`}
                        key={socketIndex}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (clickGuard()) return;
                          if (isResolving) return;
                          if (coin !== undefined)
                            runCommand({ type: "unplaceCoin", coin }, true);
                          else if (selectedCoin !== null)
                            runCommand(
                              {
                                type: "placeCoin",
                                coin: selectedCoin,
                                slot: slot(index),
                              },
                              true,
                            );
                          else showRejection(REJECTION_TEXT.generic);
                        }}
                        onPointerDown={(event) => {
                          if (coin !== undefined && !isResolving)
                            beginDrag(event, coin, {
                              kind: "socket",
                              slot: slot(index),
                            });
                        }}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onPointerCancel={cancelDrag}
                      >
                        {coin !== undefined ? (
                          <CoinDisc
                            coin={coin}
                            face={
                              isResolving ? coinFaces[Number(coin)] : undefined
                            }
                            flipping={
                              isResolving && flipping[Number(coin)] === true
                            }
                            state={state}
                            vfx={
                              coin !== undefined &&
                              vfx.has(`coin-${Number(coin)}`)
                            }
                          />
                        ) : null}
                      </button>
                    );
                  },
                )}
              </div>
              {skill?.type === "consume" ? (
                <div
                  aria-label={`화염 코인 ${skill.consume.count}개 소비`}
                  className={`consume-condition ${consumeReady ? "met" : ""} ${selectingFuel ? "selecting" : ""}`}
                >
                  <FlameIcon scale={1.6} />
                  <span>
                    ×
                    {selectingFuel
                      ? `${fuelSelection.coins.length}/${skill.consume.count}`
                      : skill.consume.count}{" "}
                    <Keyword term="consume">소비</Keyword>
                  </span>
                </div>
              ) : null}
              <div
                className="card-art"
                aria-hidden="true"
                onPointerDown={placeSelectedFromCardArt}
              >
                {skill !== undefined &&
                CARD_ART[String(skill.id)] !== undefined ? (
                  <img
                    alt=""
                    className="card-art-img"
                    src={CARD_ART[String(skill.id)]}
                  />
                ) : (
                  <span>
                    <SwordIcon scale={4.2} />
                  </span>
                )}
              </div>
              {skill !== undefined ? <CardEffectRows skill={skill} /> : null}
              {slotState.usedThisTurn ? (
                <span className="spent-label">사용됨</span>
              ) : null}
              {lockedOnce ? <span className="locked-label">잠금</span> : null}
              {preview !== null ? (
                <div className="preview-tip" role="tooltip">
                  피해 {preview.byAxis.damage.min}~{preview.byAxis.damage.max}{" "}
                  (기대 {preview.expected.damage})
                  <br />
                  방어 {preview.byAxis.block.min}~{preview.byAxis.block.max}{" "}
                  (기대 {preview.expected.block})
                  <br />
                  <Keyword term="burn">화상</Keyword>{" "}
                  {preview.byAxis.burn.min}~{preview.byAxis.burn.max} (기대{" "}
                  {preview.expected.burn})
                  {preview.byAxis.selfDamage.max > 0 ? (
                    <>
                      <br />
                      자해 {preview.byAxis.selfDamage.min}~
                      {preview.byAxis.selfDamage.max} (기대{" "}
                      {preview.expected.selfDamage})
                    </>
                  ) : null}
                  {preview.byAxis.coinsCreated.max > 0 ? (
                    <>
                      <br />
                      코인 생성 {preview.byAxis.coinsCreated.min}~
                      {preview.byAxis.coinsCreated.max} (기대{" "}
                      {preview.expected.coinsCreated})
                    </>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
        {hintStage < 2 && !ended ? (
          <div aria-live="polite" className="hint-strip">
            {hintStage === 0
              ? "동전을 클릭해 고르고 카드를 눌러 장전 — 드래그로도 됩니다"
              : "카드 제목을 누르면 사용 · 장전된 동전을 누르면 회수"}
          </div>
        ) : null}
      </section>

      <section className="bottom-hud">
        <div className="pouch" ref={pouchRef}>
          <button
            aria-controls="draw-pile-pop"
            aria-expanded={openPile === "draw"}
            aria-label={`코인 주머니 — 남은 동전 ${state.zones.draw.length}닢, 구성 보기`}
            className={`pouch-circle ${pouchReceiving ? "receiving" : ""}`}
            type="button"
            onClick={() => togglePile("draw")}
          >
            {state.zones.draw.length}
          </button>
          <span>주머니</span>
          {openPile === "draw" ? (
            <PilePopover
              groups={pileComposition(state, "draw", contentDb)}
              zone="draw"
            />
          ) : null}
        </div>
        <div className="hand-tray" aria-label="손패 동전 트레이">
          {state.zones.hand.map((coin) => {
            const fuelSelected =
              fuelSelection?.coins.includes(coin) === true;
            const choiceSelected =
              coinChoice?.coins.includes(coin) === true;
            const emptyFuelSelection =
              fuelSelection === null
                ? null
                : { slot: fuelSelection.slot, coins: [] };
            const fuelValid =
              fuelSelection !== null &&
              (fuelSelected ||
                toggleFuel(emptyFuelSelection!, coin, state, contentDb) !==
                  emptyFuelSelection);
            const choiceValid =
              coinChoice !== null &&
              coinChoiceCandidates(state, coinChoice.slot, contentDb).includes(
                coin,
              );
            const selectingCoin = fuelSelection !== null || coinChoice !== null;
            const selectedForMode = fuelSelected || choiceSelected;
            const validForMode = fuelValid || choiceValid;
            return (
              <button
                aria-label={`${coinLabel(state, coin)} 동전 선택`}
                aria-pressed={
                  selectingCoin ? selectedForMode : selectedCoin === coin
                }
                className={`coin ${coinVisualClasses(state, coin)} ${selectedCoin === coin ? "selected" : ""} ${
                  selectedForMode ? "fuel-selected" : ""
                } ${validForMode ? "fuel-valid" : ""} ${
                  selectingCoin && !validForMode ? "fuel-invalid" : ""
                } ${
                  drag !== null && drag.started && drag.coin === coin
                    ? "drag-origin"
                    : ""
                } ${shakeCoin === coin ? "drag-cancel" : ""}`}
                disabled={locked}
                key={coin}
                type="button"
                onClick={() => {
                  if (clickGuard()) return;
                  if (onFuelCoinClick(coin)) return;
                  if (onCoinChoiceClick(coin)) return;
                  selectCoin(selectedCoin === coin ? null : coin);
                }}
                onPointerDown={(event) => {
                  if (fuelSelection === null && coinChoice === null)
                    beginDrag(event, coin, { kind: "hand" });
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
        <div className="pile-counts" ref={pileCountsRef}>
          <button
            aria-controls="discard-pile-pop"
            aria-expanded={openPile === "discard"}
            aria-label={`버림 더미 ${state.zones.discard.length}개, 구성 보기`}
            className={`pile-button discard ${discardReceiving ? "receiving" : ""}`}
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
            type="button"
            onClick={() => togglePile("exhausted")}
          >
            <EmberIcon scale={1.6} /> 소모 {state.zones.exhausted.length}
          </button>
          {openPile === "discard" ? (
            <PilePopover
              groups={pileComposition(state, "discard", contentDb)}
              zone="discard"
            />
          ) : null}
          {openPile === "exhausted" ? (
            <PilePopover
              groups={pileComposition(state, "exhausted", contentDb)}
              zone="exhausted"
            />
          ) : null}
          {pileFlowText !== null ? (
            <div aria-live="polite" className="pile-flow">
              {pileFlowText}
            </div>
          ) : null}
        </div>
        <button
          aria-label="턴 종료"
          className="end-turn"
          disabled={locked || findLegal({ type: "endTurn" }) === undefined}
          type="button"
          onClick={() => runCommand({ type: "endTurn" }, true)}
        >
          턴 종료
        </button>
      </section>

      {rejection !== null ? (
        <div aria-live="polite" className="rejection-chip" key={rejection.id}>
          {rejection.text}
        </div>
      ) : null}

      {dragging ? (
        <div
          aria-hidden="true"
          className="drag-proxy"
          style={{ left: drag.x, top: drag.y }}
        >
          <CoinDisc coin={drag.coin} state={state} />
        </div>
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
}

const UnitPanel = ({
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
}: UnitPanelProps) => (
  <div
    className={`unit ${side} ${vfx.has(`unit-${unitKey}`) ? "vfx-hit" : ""} ${targeting ? "targetable" : ""} ${targetSelected ? "target-selected" : ""}`}
    onClick={targeting ? onTarget : undefined}
  >
    <div
      className={`unit-plate ${vfx.has(`wither-${side}`) ? "vfx-wither" : ""}`}
    >
      <div className="plate-row">
        <span className="unit-name">{name}</span>
        {block > 0 ? (
          <Keyword term="block" className="chip-keyword">
            <em
              aria-label={`방어 ${block}`}
              className={`block-chip ${vfx.has(`block-${unitKey}`) ? "vfx-pop" : ""}`}
            >
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
        {statusTurns(statuses, "frostbite") > 0 ? (
          <Keyword term="frostbite" className="chip-keyword">
            <em
              aria-label={`동상 ${statusTurns(statuses, "frostbite")}턴`}
              className="frost-chip"
            >
              동상 {statusTurns(statuses, "frostbite")}
            </em>
          </Keyword>
        ) : null}
        {statusTurns(statuses, "shock") > 0 ? (
          <Keyword term="shock" className="chip-keyword">
            <em
              aria-label={`감전 ${statusTurns(statuses, "shock")}턴`}
              className="shock-chip"
            >
              감전 {statusTurns(statuses, "shock")}
            </em>
          </Keyword>
        ) : null}
        {attackBuff > 0 ? (
          <em
            aria-label={`버프: 다음 공격 +${attackBuff}`}
            className="attack-buff-chip"
          >
            ↑ 공격 +{attackBuff}
          </em>
        ) : null}
      </div>
      <div aria-label={`체력 ${hp}/${maxHp}`} className="hp-bar">
        <HeartIcon scale={1.4} />
        <div className="hp-track">
          <div
            className="hp-fill"
            style={{ width: `${Math.max(0, (hp / maxHp) * 100)}%` }}
          />
        </div>
        <strong className="hp-num">
          {hp}/{maxHp}
        </strong>
      </div>
    </div>
    {intent !== undefined ? intent : null}
    <button
      aria-label={
        targeting
          ? `${name} 대상 ${targetSelected ? "선택됨" : "선택"}`
          : `${name} 스프라이트`
      }
      aria-pressed={targeting ? targetSelected : undefined}
      className="sprite"
      disabled={!targeting}
      type="button"
      data-sprite-fallback={
        sprite.fallbackFor === undefined ? undefined : String(sprite.fallbackFor)
      }
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
      .filter(
        (item) =>
          item.target === side &&
          (side === "player" || item.enemy === enemyIndex),
      )
      .map((item) => (
        <b className={`float-text kind-${item.kind}`} key={item.id}>
          {item.text}
        </b>
      ))}
  </div>
);
