import type { TurnTriggerInstance } from "@game/core";
import { useEffect, useId, useRef, useState } from "react";

import { Keyword } from "./keywords";

const triggerName = (id: string): string =>
  ({
    "flame-sword": "화염검",
    "heart-of-flame": "불의 심장",
  })[id] ?? id;

const hookText = (hook: string): string =>
  hook === "onDamageDealt"
    ? "피해를 줄 때"
    : hook === "onAttackSkillResolved"
      ? "공격 스킬 해결 후"
      : hook;

const triggerEffectText = (
  trigger: TurnTriggerInstance["trigger"],
): string =>
  trigger.effects
    .map((effect) => {
      if (effect.kind === "applyStatus" && effect.status === "burn")
        return `화상 +${effect.stacks}`;
      if (effect.kind === "damage") return `피해 ${effect.amount}`;
      if (effect.kind === "block") return `방어 ${effect.amount}`;
      return "특수 효과";
    })
    .join(" / ");

function TurnBuffChip(props: {
  trigger: TurnTriggerInstance;
  pulsing: boolean;
}): JSX.Element {
  const id = useId();
  const host = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [suppressed, setSuppressed] = useState(false);
  const name = triggerName(props.trigger.trigger.id);
  const effect = triggerEffectText(props.trigger.trigger);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
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
      className="turn-buff-host"
      data-open={open ? "true" : undefined}
      data-suppressed={suppressed ? "true" : undefined}
      ref={host}
      onMouseLeave={() => setSuppressed(false)}
    >
      <button
        aria-describedby={id}
        aria-label={`${name} 턴 버프: ${effect}`}
        className={`turn-buff-chip ${props.pulsing ? "vfx-pulse" : ""}`}
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setSuppressed(false);
          setOpen((current) => !current);
        }}
        onBlur={() => setSuppressed(false)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          setOpen(false);
          setSuppressed(true);
        }}
      >
        <span className="turn-buff-chip__name">{name}</span>
        <span className="turn-buff-chip__effect">{effect}</span>
      </button>
      <span className="turn-buff-tip" id={id} role="tooltip">
        <strong>{name}</strong>
        <span>
          <Keyword term="trigger">턴 버프</Keyword> ·{" "}
          {hookText(props.trigger.trigger.hook)} {effect}
        </span>
      </span>
    </span>
  );
}

export function TurnBuffBar(props: {
  triggers: readonly TurnTriggerInstance[];
  vfx: Set<string>;
}): JSX.Element | null {
  if (props.triggers.length === 0) return null;
  return (
    <section aria-label="턴 버프" className="turn-buff-bar">
      {props.triggers.map((trigger) => (
        <TurnBuffChip
          key={trigger.uid}
          pulsing={props.vfx.has(`turn-trigger-${trigger.uid}`)}
          trigger={trigger}
        />
      ))}
    </section>
  );
}

export const turnBuffTestHooks = { triggerEffectText, triggerName };
