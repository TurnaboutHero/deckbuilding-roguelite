import type {
  CombatEvent,
  CombatState,
  Command,
  ContentDb,
  Element,
  Face,
  RunState,
} from "@game/core";

// 코인 면 기록 — 진실 소스는 코어의 coinFlipped 이벤트(상태에는 면이 없다, P9 소멸).
// UI는 연출을 위해 마지막 플립 결과를 기억하되, 코인이 더미에서 다시 뽑히면
// "아직 안 굴린 동전"이므로 반드시 지운다. 이 리듀서가 그 수명주기의 단일 창구다.
export type CoinFaces = Record<number, Face>;

export type RewardViewStage =
  "coin" | "removal" | "skill" | "fallback-coin" | "passive";

export type CardActionTone = "idle" | "ready" | "busy" | "targeting";

export interface CardActionViewInput {
  cooldownRemaining: number;
  kind: "consume";
  loaded: number;
  ready: boolean;
  resolving: boolean;
  selecting?: boolean;
  targeting: boolean;
  total: number;
  usedThisCombat: boolean;
}

export interface CardActionView {
  actionable: boolean;
  label: string;
  tone: CardActionTone;
}

// 카드의 시각 상태와 실행 가능 여부를 한 줄 행동 바로 압축한다. 합법성 판정은
// legalCommands가 정본이며, 이 함수는 이미 계산된 UI 상태를 문구로만 투영한다.
export const cardActionView = (input: CardActionViewInput): CardActionView => {
  if (input.resolving)
    return { actionable: false, label: "발동 중…", tone: "busy" };
  if (input.usedThisCombat)
    return { actionable: false, label: "이번 전투 사용 완료", tone: "idle" };
  if (input.cooldownRemaining > 0)
    return {
      actionable: false,
      label: `재사용까지 ${input.cooldownRemaining}턴`,
      tone: "idle",
    };
  if (input.targeting)
    return {
      actionable: true,
      label: "대상 선택 중 · 취소",
      tone: "targeting",
    };
  if (input.selecting) {
    return {
      actionable: input.ready,
      label: `${input.loaded}/${input.total} 소비${input.ready ? " · 확정" : ""}`,
      tone: input.ready ? "ready" : "idle",
    };
  }
  if (input.ready)
    return { actionable: true, label: "스킬 사용", tone: "ready" };
  return {
    actionable: false,
    label: `속성 동전 ${input.total}개 필요`,
    tone: "idle",
  };
};

// 보상 순서 자체는 코어가 PendingRewards 플래그로 결정한다. UI는 그 상태를
// 어느 패널로 보여줄지만 투영하며, 보상 적용이나 완료 판정은 코어 API에 맡긴다.
export const rewardViewStage = (run: RunState): RewardViewStage | null => {
  const pending = run.phase === "rewards" ? run.pendingRewards : undefined;
  if (pending === undefined) return null;
  if (!pending.coinChoiceResolved) {
    // v5 소진 풀 '대체 코인'은 레거시(acts 부재) 그래프에서만 존재한다 — P6 일반
    // 보상(코인 단독, removal 상시 true)이 같은 플래그 형상이라 그래프로 구분
    // (하네스 감사 결함: 오분류 시 대체 보상 오문구 노출).
    return run.graph.acts === undefined &&
      pending.coinRemovalResolved &&
      pending.skillChoiceResolved &&
      pending.skillOptions.length === 0
      ? "fallback-coin"
      : "coin";
  }
  if (!pending.coinRemovalResolved) return "removal";
  if (!pending.skillChoiceResolved) return "skill";
  // P6 — 보스 보상 패시브 3중1택
  if (pending.passiveChoiceResolved === false) return "passive";
  return null;
};

export const coinFacesAfterEvent = (
  faces: CoinFaces,
  event: CombatEvent,
): CoinFaces => {
  if (event.type === "coinFlipped") {
    return { ...faces, [Number(event.coin)]: event.face };
  }
  if (event.type === "coinsDrawn") {
    let changed = false;
    const next = { ...faces };
    for (const coin of event.coins) {
      if (next[Number(coin)] !== undefined) {
        delete next[Number(coin)];
        changed = true;
      }
    }
    return changed ? next : faces;
  }
  return faces;
};

// 뽑을 더미 구성 — 종류·매수만 공개한다. 순서는 시드 파생 비밀이라 절대 노출하지 않는다
// (PRD §15.1은 잔여 매수 표시만 확정 — 구성 공개는 StS 관례를 따르되 순서 은닉이 긴장감의 전제).
export type CoinPileZone = "draw" | "discard" | "exhausted";

export interface CoinPileGroup {
  defId: string;
  element: string | null;
  grants: Element[];
  temporary: boolean;
  enchant: string | null;
  count: number;
}

export const pileComposition = (
  state: CombatState,
  zone: CoinPileZone,
  db: ContentDb,
): CoinPileGroup[] => {
  const groups = new Map<string, CoinPileGroup>();
  for (const coin of state.zones[zone]) {
    const instance = state.coins[Number(coin)];
    if (instance === undefined) continue;
    const defId = String(instance.defId);
    const temporary = !instance.permanent;
    const enchant = instance.permanent ? (instance.enchant ?? null) : null;
    const grants = [...instance.grants].sort();
    const key = `${defId}|${temporary ? "t" : "p"}|${enchant ?? "none"}|${grants.join(",")}`;
    const existing = groups.get(key);
    if (existing !== undefined) {
      existing.count += 1;
      continue;
    }
    groups.set(key, {
      defId,
      element: db.coins[defId]?.element ?? null,
      grants,
      temporary,
      enchant,
      count: 1,
    });
  }
  // 결정론 정렬: 기본 코인 먼저, 그다음 defId 사전순, 영구가 임시보다 앞
  return [...groups.values()].sort((left, right) => {
    if ((left.element === null) !== (right.element === null))
      return left.element === null ? -1 : 1;
    if (left.defId !== right.defId)
      return left.defId.localeCompare(right.defId);
    if (left.temporary !== right.temporary) return left.temporary ? 1 : -1;
    if (left.enchant !== right.enchant)
      return (left.enchant ?? "").localeCompare(right.enchant ?? "");
    return left.grants.join(",").localeCompare(right.grants.join(","));
  });
};

export const sameCommand = (left: Command, right: Command): boolean => {
  if (left.type !== right.type) return false;
  if (left.type === "useImmediateFlipSkill" && right.type === "useImmediateFlipSkill") {
    return (
      left.slot === right.slot &&
      left.target === right.target &&
      left.chosenSummon === right.chosenSummon &&
      left.chosenEquipment === right.chosenEquipment &&
      left.desiredCoin === right.desiredCoin &&
      JSON.stringify(left.chosen ?? []) === JSON.stringify(right.chosen ?? []) &&
      left.coins.length === right.coins.length &&
      left.coins.every((coin, index) => coin === right.coins[index])
    );
  }
  if (left.type === "endTurn" && right.type === "endTurn") return true;
  if (left.type === "useConsumeSkill" && right.type === "useConsumeSkill") {
    return (
      left.slot === right.slot &&
      left.target === right.target &&
      left.chosenSummon === right.chosenSummon &&
      left.desiredCoin === right.desiredCoin &&
      left.coins.length === right.coins.length &&
      left.coins.every((coin, index) => coin === right.coins[index])
    );
  }
  return false;
};
