import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";

import "./keywords.css";

export type KeywordTerm =
  | "burn"
  | "wither"
  | "block"
  | "flip"
  | "consume"
  | "temporary"
  | "elementCoin";

export const KEYWORD_GLOSSARY: Record<
  KeywordTerm,
  { label: string; description: string }
> = {
  burn: {
    label: "화상",
    description:
      "대상의 턴이 끝날 때 스택만큼 피해를 준다 (방어 무시). 그 뒤 스택이 1 줄어든다.",
  },
  wither: {
    label: "위축",
    description: "다음 턴에 뽑는 동전이 그만큼 줄어든다.",
  },
  block: {
    label: "방어",
    description:
      "받는 피해를 먼저 막는다. 자기 턴이 시작되면 0으로 돌아간다.",
  },
  flip: {
    label: "플립",
    description:
      "장전한 동전을 던져 앞·뒤를 정한다. 기본 효과는 항상 발동하고, 면 결과는 보너스만 더한다.",
  },
  consume: {
    label: "소비",
    description:
      "동전을 던지지 않고 그대로 지불한다. 앞·뒤 효과는 발동하지 않는다.",
  },
  temporary: {
    label: "임시 코인",
    description: "이번 전투에서만 쓰는 동전. 전투가 끝나면 사라진다.",
  },
  elementCoin: {
    label: "속성 코인",
    description:
      "면 결과에 따라 속성 효과가 추가로 발동하는 동전 (예: 화염 앞면 = 화상 +1).",
  },
};

export function Keyword(props: {
  term: KeywordTerm;
  children?: ReactNode;
  className?: string;
}): JSX.Element {
  const id = useId();
  const host = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  // hover/:focus-visible 표시도 Escape로 즉시 해제돼야 한다 (WCAG 1.4.13 — 포커스
  // 이동 없이 닫기). 억제는 hover 이탈·blur에서 풀려 다음 표시를 막지 않는다.
  const [suppressed, setSuppressed] = useState(false);
  const entry = KEYWORD_GLOSSARY[props.term];

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
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
      onMouseLeave={() => setSuppressed(false)}
    >
      <button
        aria-describedby={id}
        className="kw"
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setSuppressed(false);
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          setOpen(false);
          setSuppressed(true);
        }}
        onBlur={() => setSuppressed(false)}
      >
        {props.children ?? entry.label}
      </button>
      <span className="kw-tip" id={id} role="tooltip">
        <strong>{entry.label}</strong>
        {entry.description}
      </span>
    </span>
  );
}
