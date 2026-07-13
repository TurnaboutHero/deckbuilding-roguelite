import type {
  CoinUid,
  CombatEvent,
  CombatState,
  Command,
  ContentDb,
  Element,
  Face,
  RunState,
  SlotId,
} from "@game/core";
import { legalCommands, step } from "@game/core";

// 코인 면 기록 — 진실 소스는 코어의 coinFlipped 이벤트(상태에는 면이 없다, P9 소멸).
// UI는 연출을 위해 마지막 플립 결과를 기억하되, 코인이 더미에서 다시 뽑히면
// "아직 안 굴린 동전"이므로 반드시 지운다. 이 리듀서가 그 수명주기의 단일 창구다.
export type CoinFaces = Record<number, Face>;

export type RewardViewStage = "coin" | "removal" | "skill" | "fallback-coin" | "passive";

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

export type DragSource = { kind: "hand" } | { kind: "socket"; slot: SlotId };

// 뽑을 더미 구성 — 종류·매수만 공개한다. 순서는 시드 파생 비밀이라 절대 노출하지 않는다
// (PRD §15.1은 잔여 매수 표시만 확정 — 구성 공개는 StS 관례를 따르되 순서 은닉이 긴장감의 전제).
export type CoinPileZone = "draw" | "discard" | "exhausted";

export interface CoinPileGroup {
  defId: string;
  element: string | null;
  grants: Element[];
  temporary: boolean;
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
    const grants = [...instance.grants].sort();
    const key = `${defId}|${temporary ? "t" : "p"}|${grants.join(",")}`;
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
    return left.grants.join(",").localeCompare(right.grants.join(","));
  });
};

export const drawPileComposition = (
  state: CombatState,
  db: ContentDb,
): CoinPileGroup[] => pileComposition(state, "draw", db);

// 드래그 중 하이라이트할 합법 목적지 — 규칙 판정은 전부 코어(legalCommands/step)에 위임.
// 소켓 출발이면 "회수 후 장전"이 둘 다 합법일 때만 목적지로 인정한다.
export const dragTargetSlots = (
  state: CombatState,
  coin: CoinUid,
  source: DragSource,
  db: ContentDb,
): Set<number> => {
  let base = state;
  if (source.kind === "socket") {
    const unplaced = step(state, { type: "unplaceCoin", coin }, db);
    if (!unplaced.ok) return new Set();
    base = unplaced.state;
  }
  const targets = new Set<number>();
  for (const command of legalCommands(base, db)) {
    if (command.type === "placeCoin" && command.coin === coin)
      targets.add(Number(command.slot));
  }
  if (source.kind === "socket") targets.delete(Number(source.slot));
  return targets;
};

// 드롭 결과를 커맨드 열로 변환 — 합법성 판정은 stepSequence가 legalCommands로 수행한다.
// 반환 null = 무효 드롭(아무 것도 디스패치하지 않음).
export const dropCommands = (
  coin: CoinUid,
  source: DragSource,
  target: { kind: "slot"; slot: SlotId } | { kind: "tray" } | { kind: "none" },
): Command[] | null => {
  if (source.kind === "hand") {
    if (target.kind !== "slot") return null;
    return [{ type: "placeCoin", coin, slot: target.slot }];
  }
  // 소켓 출발: 트레이/빈 곳 = 회수, 다른 카드의 합법 소켓 = 이동(회수 후 장전)
  if (target.kind === "slot" && Number(target.slot) !== Number(source.slot)) {
    return [
      { type: "unplaceCoin", coin },
      { type: "placeCoin", coin, slot: target.slot },
    ];
  }
  if (target.kind === "tray" || target.kind === "none") {
    return [{ type: "unplaceCoin", coin }];
  }
  return null;
};

export const sameCommand = (left: Command, right: Command): boolean => {
  if (left.type !== right.type) return false;
  if (left.type === "placeCoin" && right.type === "placeCoin")
    return left.coin === right.coin && left.slot === right.slot;
  if (left.type === "unplaceCoin" && right.type === "unplaceCoin")
    return left.coin === right.coin;
  if (left.type === "useFlipSkill" && right.type === "useFlipSkill")
    return (
      left.slot === right.slot &&
      left.target === right.target &&
      left.chosenSummon === right.chosenSummon &&
      left.chosenEquipment === right.chosenEquipment &&
      left.desiredCoin === right.desiredCoin &&
      JSON.stringify(left.chosen ?? []) === JSON.stringify(right.chosen ?? [])
    );
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

// 커맨드 열을 순차 검증·실행 — 각 단계가 legalCommands에 있어야 하고(코어가 step에서
// 안 막는 무의미 배치까지 걸러진다), 하나라도 불법이면 전체 취소.
export const stepSequence = (
  state: CombatState,
  commands: readonly Command[],
  db: ContentDb,
): { state: CombatState; events: CombatEvent[] } | null => {
  let current = state;
  const events: CombatEvent[] = [];
  for (const command of commands) {
    const legal = legalCommands(current, db).some((candidate) =>
      sameCommand(candidate, command),
    );
    if (!legal) return null;
    const result = step(current, command, db);
    if (!result.ok) return null;
    current = result.state;
    events.push(...result.events);
  }
  return { state: current, events };
};
