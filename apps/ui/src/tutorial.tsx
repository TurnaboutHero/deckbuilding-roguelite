// P7 D6 — 점진·문맥 튜토리얼: 규칙 일괄 모달 금지, 상황이 처음 등장할 때 한 줄씩.
// 영속은 런 세이브와 분리된 localStorage 키 (세이브 스키마 오염 방지 — 결정 로그 16).
import { useCallback, useSyncExternalStore } from "react";

import type { CombatState, ContentDb } from "@game/core";
import { effectiveElements } from "@game/core";

export const TUTORIAL_STORAGE_KEY = "deckbuilding-roguelite.tutorial.v1";

export type TutorialTipId =
  "basic-loop" | "turn-flow" | "piles" | "cooldown" | "element-coin" | "two-sided" | "preserve" | "consume";

// 순서 = 우선순위 (한 번에 하나만 노출)
export const TUTORIAL_TIP_COPY: Record<TutorialTipId, string> = {
  "basic-loop":
    "턴이 시작되면 동전 5개를 뽑습니다. 코스트만큼 장전하면 스킬 사용 버튼과 미사용 실행 순서 번호가 나타납니다.",
  "turn-flow":
    "장전된 스킬은 스킬 사용으로 바로 쓸 수 있습니다. 남겨 둔 채 턴 종료하면 실행할지 묻고, 원하면 이후 자동 실행으로 바꿀 수 있습니다.",
  piles:
    "사용한 동전과 턴 종료 때 남은 동전은 버림 더미로 갑니다. 뽑을 더미가 부족하면 버림 더미를 섞어 계속 뽑습니다.",
  cooldown:
    "사용한 스킬은 쿨다운 동안 대기합니다 — 배지의 '쿨 N'이 남은 턴 수. '반복' 기본기는 같은 턴에도 계속, '전투당 1회'는 다음 전투에 돌아옵니다.",
  "element-coin":
    "속성 코인은 앞면과 뒷면에 서로 다른 효과가 있습니다. 스킬에 장전해 플립하면 나온 면의 효과가 추가로 발동해요.",
  "two-sided":
    "속성 효과의 대상: 공격형은 선택한 적에게, 전체 공격은 모든 적에게 적용됩니다. 방어·회복은 항상 나에게 적용돼요.",
  preserve:
    "보존된 동전은 턴 종료 때 버리지 않고 다음 턴까지 손패에 남습니다. 사용하면 다른 동전처럼 버림 더미로 이동해요.",
  consume: "소비 스킬은 속성 동전을 플립하지 않고 즉시 소비합니다. 이때 면 보너스와 속성 효과는 발동하지 않아요.",
};

const readSeen = (): ReadonlySet<string> => {
  try {
    const raw = window.localStorage.getItem(TUTORIAL_STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? new Set(parsed.filter((entry): entry is string => typeof entry === "string"))
      : new Set();
  } catch {
    return new Set();
  }
};

let seenCache = new Set<string>();
let cacheLoaded = false;
const listeners = new Set<() => void>();

const loadCache = (): Set<string> => {
  if (!cacheLoaded) {
    seenCache = new Set(readSeen());
    cacheLoaded = true;
  }
  return seenCache;
};

const markSeen = (tip: TutorialTipId): void => {
  const seen = loadCache();
  if (seen.has(tip)) return;
  seen.add(tip);
  try {
    window.localStorage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify([...seen]));
  } catch {
    // 저장 불가 환경(프라이빗 모드 등) — 세션 내 캐시만 유지
  }
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// 스냅샷은 참조 안정성이 필요 — 버전 카운터 문자열로 대신한다
const snapshot = (): string => [...loadCache()].sort().join(",");

// 전투 상태에서 각 팁의 등장 조건을 판정한다 (표시 우선순위 = 선언 순서)
export const activeTutorialTip = (
  state: CombatState,
  db: ContentDb,
  seen: ReadonlySet<string>,
  fuelSelectionOpen: boolean,
): TutorialTipId | null => {
  const candidates: [TutorialTipId, boolean][] = [
    ["basic-loop", true],
    ["turn-flow", true],
    ["piles", true],
    ["cooldown", state.slots.some((slot) => slot.cooldownRemaining > 0 || slot.usedThisCombat)],
    [
      "element-coin",
      state.zones.hand.some((coin) => {
        const instance = state.coins[Number(coin)];
        return instance !== undefined && effectiveElements(instance, db).length > 0;
      }),
    ],
    [
      "two-sided",
      Object.values(state.zones.placed).some((coins) =>
        coins.some((coin) => {
          const instance = state.coins[Number(coin)];
          return instance !== undefined && effectiveElements(instance, db).length > 0;
        }),
      ),
    ],
    ["preserve", state.zones.hand.some((coin) => state.coins[Number(coin)]?.preserved === true)],
    ["consume", fuelSelectionOpen],
  ];
  for (const [tip, active] of candidates) {
    if (!seen.has(tip) && active) return tip;
  }
  return null;
};

export function TutorialStrip(props: { state: CombatState; db: ContentDb; fuelSelectionOpen: boolean }) {
  const seenKey = useSyncExternalStore(subscribe, snapshot, () => "");
  void seenKey;
  const seen = loadCache();
  const tip = activeTutorialTip(props.state, props.db, seen, props.fuelSelectionOpen);
  const dismiss = useCallback(() => {
    if (tip !== null) markSeen(tip);
  }, [tip]);
  if (tip === null) return null;
  return (
    <div aria-live="polite" className="tutorial-strip" data-testid={`tutorial-${tip}`}>
      <span className="tutorial-copy">{TUTORIAL_TIP_COPY[tip]}</span>
      <button aria-label="안내 닫기" className="tutorial-dismiss" type="button" onClick={dismiss}>
        확인
      </button>
    </div>
  );
}
