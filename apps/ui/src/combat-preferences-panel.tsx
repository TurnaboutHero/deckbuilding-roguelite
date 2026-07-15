import { useEffect } from "react";

import type { CombatPreferences } from "./combat-preferences";

interface CombatPreferencesPanelProps {
  value: CombatPreferences;
  onChange: (next: CombatPreferences) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CombatPreferencesPanel({ value, onChange, open, onOpenChange }: CombatPreferencesPanelProps): JSX.Element {
  const patch = <Key extends keyof CombatPreferences>(key: Key, next: CombatPreferences[Key]) =>
    onChange({ ...value, [key]: next });

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onOpenChange, open]);

  return (
    <div className="combat-preferences-host">
      <button
        aria-controls="combat-preferences-panel"
        aria-expanded={open}
        className="combat-utility-button"
        data-testid="combat-preferences-open"
        type="button"
        onClick={() => onOpenChange(!open)}
      >
        설정
      </button>
      {open ? (
        <section aria-label="전투 표시 및 연출 설정" className="combat-preferences-panel" data-testid="combat-preferences-panel" id="combat-preferences-panel" role="region">
          <header>
            <strong>전투 설정</strong>
            <button aria-label="전투 설정 닫기" type="button" onClick={() => onOpenChange(false)}>×</button>
          </header>
          <label>
            동전 던지기
            <select data-testid="flip-speed" value={value.flipSpeed} onChange={(event) => patch("flipSpeed", event.currentTarget.value as CombatPreferences["flipSpeed"])}>
              <option value="normal">기본</option>
              <option value="fast">빠르게</option>
              <option value="instant">즉시</option>
            </select>
          </label>
          <label><input checked={value.screenShake} data-testid="preference-screen-shake" type="checkbox" onChange={(event) => patch("screenShake", event.currentTarget.checked)} /> 화면 흔들림</label>
          <label>
            <input
              checked={value.autoExecuteLoadedSkills}
              data-testid="preference-auto-execute"
              type="checkbox"
              onChange={(event) =>
                patch("autoExecuteLoadedSkills", event.currentTarget.checked)
              }
            />
            {"\uD134 \uC885\uB8CC \uC2DC \uC7A5\uC804 \uC2A4\uD0AC \uC790\uB3D9 \uC2E4\uD589"}
          </label>
          <label>
            피해 숫자
            <select data-testid="preference-damage-size" value={value.damageNumberSize} onChange={(event) => patch("damageNumberSize", event.currentTarget.value as CombatPreferences["damageNumberSize"])}>
              <option value="normal">기본</option><option value="large">크게</option>
            </select>
          </label>
          <label>
            도움말 크기
            <select data-testid="preference-tooltip-size" value={value.tooltipSize} onChange={(event) => patch("tooltipSize", event.currentTarget.value as CombatPreferences["tooltipSize"])}>
              <option value="normal">기본</option><option value="large">크게</option>
            </select>
          </label>
          <label><input checked={value.highContrast} data-testid="preference-high-contrast" type="checkbox" onChange={(event) => patch("highContrast", event.currentTarget.checked)} /> 고대비</label>
          <label>
            배경 효과
            <select data-testid="preference-background-effects" value={value.backgroundEffects} onChange={(event) => patch("backgroundEffects", event.currentTarget.value as CombatPreferences["backgroundEffects"])}>
              <option value="full">기본</option><option value="reduced">줄이기</option>
            </select>
          </label>
          <label><input checked={value.reducedMotion} data-testid="preference-reduced-motion" type="checkbox" onChange={(event) => patch("reducedMotion", event.currentTarget.checked)} /> 모션 줄이기</label>
          <label><input checked={value.sound} data-testid="preference-sound" type="checkbox" onChange={(event) => patch("sound", event.currentTarget.checked)} /> 소리</label>
        </section>
      ) : null}
    </div>
  );
}
