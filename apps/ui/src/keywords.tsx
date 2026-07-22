import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { AnchoredOverlay } from "./overlay";

import "./keywords.css";

export type KeywordTerm =
  | "burn"
  | "poison"
  | "bleed"
  | "wither"
  | "block"
  | "flip"
  | "consume"
  | "frostbite"
  | "frost"
  | "shock"
  | "healLock"
  | "trigger"
  | "attack-buff"
  | "passive"
  | "temporary"
  | "elementCoin"
  | "cooldown"
  | "oncePerCombat"
  | "overheat"
  | "pendingOverheat"
  | "armorEcho"
  | "echoPreheat"
  | "precisionDefense"
  | "echoAmplification"
  | "windup"
  | "vulnerable"
  | "frenzy"
  | "growth"
  | "unusedElementalThreshold"
  | "ringGrowth";

export const KEYWORD_GLOSSARY: Record<KeywordTerm, { label: string; description: string }> = {
  burn: {
    label: "화상",
    description: "대상의 턴이 끝날 때 스택만큼 피해를 준다 (방어 무시). 그 뒤 스택이 1 줄어든다.",
  },
  poison: {
    label: "중독",
    description: "대상의 턴이 끝날 때 스택만큼 피해를 준다 (방어 무시). 화상과 달리 스택은 줄지 않는다.",
  },
  bleed: {
    label: "출혈",
    description: "중첩된 출혈은 턴 종료에 피해를 주며, 방어로 막을 수 없습니다.",
  },
  wither: {
    label: "위축",
    description: "다음 턴에 뽑는 동전이 그만큼 줄어든다.",
  },
  block: {
    label: "방어",
    description: "받는 피해를 먼저 막는다. 자기 턴이 시작되면 0으로 돌아간다.",
  },
  flip: {
    label: "플립",
    description: "스킬에 건 동전을 던져 앞·뒤를 무작위로 정한다. 기본 효과는 항상 발동하고, 면 결과는 보너스만 더한다.",
  },
  consume: {
    label: "소비",
    description: "동전을 던지지 않고 그대로 지불한다. 앞·뒤 효과는 발동하지 않는다.",
  },
  frostbite: {
    label: "동상",
    description: "남은 턴 동안 대상이 가하는 공격 피해가 25% 줄어든다. 자기 턴이 끝날 때 1턴씩 줄어든다.",
  },
  frost: {
    label: "동상",
    description: "동상은 다음 행동의 효율을 낮추는 지속 상태입니다.",
  },
  shock: {
    label: "감전",
    description: "남은 턴 동안 대상이 받는 피해가 50% 늘어난다. 자기 턴이 끝날 때 1턴씩 줄어든다.",
  },
  healLock: {
    label: "회복 봉인",
    description: "남은 턴 동안 플레이어가 받는 회복을 막는다. 자신의 턴이 끝날 때 1턴씩 줄어든다.",
  },
  trigger: {
    label: "턴 버프",
    description: "이번 턴 동안만 유지되는 발동 효과. 턴이 끝나면 사라진다.",
  },
  "attack-buff": {
    label: "공격 버프",
    description:
      "다음 공격 행동 1회의 피해가 표시만큼 늘어난다. 사용하면 사라지고, 사용 전에는 유지되며 중첩 시 더해진다.",
  },
  passive: {
    label: "패시브",
    description: "이 적의 고유 특성. 조건이 되면 자동으로 발동한다 — 의도(다음 행동)와 별개.",
  },
  temporary: {
    label: "임시 코인",
    description: "이번 전투에서만 쓰는 동전. 전투가 끝나면 사라진다.",
  },
  elementCoin: {
    label: "속성 코인",
    description: "앞면과 뒷면에 서로 다른 속성 효과가 있는 동전. 플립할 때만 발동하고, 소비하면 발동하지 않는다.",
  },
  // P7 D1/D5 — 쿨다운·전투당 1회·과열 (공식 용어 정본)
  cooldown: {
    label: "쿨다운",
    description:
      "사용 후 표시된 턴 수만큼 다시 쓸 수 없다. 내 턴이 시작될 때 1씩 줄어든다. 쿨다운 0(반복) 스킬은 코인이 남는 한 같은 턴에 계속 쓸 수 있다.",
  },
  oncePerCombat: {
    label: "전투당 1회",
    description: "이번 전투에서 한 번만 쓸 수 있다. 다음 전투에서 다시 쓸 수 있다.",
  },
  overheat: {
    label: "과열",
    description:
      "일부 화염 스킬로 진입한다. 하나만 유지되고 턴이 지나도 남는다. 과열 강화 스킬을 성공시키면 강화 효과가 적용된 뒤 과열이 사라진다.",
  },
  pendingOverheat: {
    label: "과열 예약",
    description:
      "이번 턴에 조건을 만족해 다음 플레이어 턴 시작에 과열이 켜질 예정인 상태. 이미 과열 중이면 새로 쌓이지 않는다.",
  },
  armorEcho: {
    label: "갑주 반향",
    description:
      "적 턴에 방어로 실제 흡수한 피해를 바탕으로 다음 플레이어 턴 동안 유지되는 마도기사 자원. 기본 반향은 최대 6, 보너스 포함 최종 최대 12.",
  },
  echoPreheat: {
    label: "반향 예열",
    description:
      "다음 반향 계산에 더해지는 준비 보너스. 적 턴에 피해를 1 이상 흡수했을 때만 적용되고 반향 계산 후 사라진다.",
  },
  precisionDefense: {
    label: "정밀 방어",
    description:
      "다음 적 턴에 피해를 1 이상 흡수하고 남은 방어가 2 이하이면 다음 갑주 반향에 +4를 더하는 조건.",
  },
  echoAmplification: {
    label: "반향 증폭",
    description:
      "플레이어 턴당 1회, 피해 스킬에 현재 갑주 반향을 더한다. 반향 수치는 줄지 않지만 증폭 가능 여부는 소모된다.",
  },
  windup: {
    label: "준비(예고)",
    description: "적의 주요 행동이 해결되기 전 카운트다운이다. 남은 턴, 대상, 수치, 취소 조건을 미리 확인할 수 있다.",
  },
  vulnerable: {
    label: "취약",
    description: "준비 중인 적이 받는 피해 배수. 표시된 배수만큼 최종 피해가 늘어난다.",
  },
  frenzy: {
    label: "광란(페이즈)",
    description: "체력이 일정 기준 아래로 내려가 전환된 적 페이즈. 전환 뒤에는 다른 의도 표를 사용한다.",
  },
  growth: {
    label: "성장",
    description: "적의 성장 스택. 공격 피해에 더해지며, 조건을 놓치거나 막아내면 줄어들 수 있다.",
  },
  unusedElementalThreshold: {
    label: "미사용 속성 코인 경고",
    description: "내 턴 종료 시 손에 남은 속성 코인이 기준 이상이면 표시된 상태 이상을 받는다. 부여·임시·보존 코인도 속성이 있으면 각각 1개로 센다.",
  },
  ringGrowth: {
    label: "나이테",
    description: "현재 나이테마다 받는 피해가 줄고 적 행동 시작에 최대 체력 비례로 회복한다. 이번 라운드 실제 체력 피해가 기준에 도달하면 나이테가 깨진 뒤 라운드 종료에 다시 1개 자란다.",
  },
};

export function Keyword(props: {
  term: KeywordTerm;
  children?: ReactNode;
  className?: string;
  // 콘텐츠 정의 용어(몬스터 패시브 등) — 용어 사전 대신 개별 항목으로 툴팁 구성
  entry?: { label: string; description: string };
}): JSX.Element {
  const id = useId();
  const host = useRef<HTMLSpanElement>(null);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  // hover/:focus-visible 표시도 Escape로 즉시 해제돼야 한다 (WCAG 1.4.13 — 포커스
  // 이동 없이 닫기). 억제는 hover 이탈·blur에서 풀려 다음 표시를 막지 않는다.
  const [suppressed, setSuppressed] = useState(false);
  const entry = props.entry ?? KEYWORD_GLOSSARY[props.term];
  const open = !suppressed && (focused || hovered || pinned);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (host.current?.contains(event.target as Node)) return;
      setPinned(false);
      setSuppressed(true);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPinned(false);
      setSuppressed(true);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <span
      className={`kw-host ${props.className ?? ""}`}
      data-open={open ? "true" : undefined}
      data-suppressed={suppressed ? "true" : undefined}
      ref={host}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setSuppressed(false);
      }}
    >
      <button
        aria-describedby={id}
        className="kw"
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (pinned) {
            setPinned(false);
            setSuppressed(true);
          } else {
            setSuppressed(false);
            setPinned(true);
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          setPinned(false);
          setSuppressed(true);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setSuppressed(false);
        }}
      >
        {props.children ?? entry.label}
      </button>
      <AnchoredOverlay anchorRef={host} className="kw-tip" id={id} open={open} role="tooltip">
        <strong>{entry.label}</strong>
        {entry.description}
      </AnchoredOverlay>
    </span>
  );
}
