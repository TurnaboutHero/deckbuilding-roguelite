import { useEffect, useRef } from "react";

import type { CombatPreferences } from "./combat-preferences";

interface TitleSettingsProps {
  value: CombatPreferences;
  onBack: () => void;
  onChange: (next: CombatPreferences) => void;
}

export function TitleSettings({ value, onBack, onChange }: TitleSettingsProps): JSX.Element {
  const backRef = useRef<HTMLButtonElement | null>(null);
  const onBackRef = useRef(onBack);
  const patch = <Key extends keyof CombatPreferences>(key: Key, next: CombatPreferences[Key]) => onChange({ ...value, [key]: next });

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    backRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onBackRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <section aria-label="설정" aria-modal="true" className="result-overlay title-overlay title-settings" data-testid="title-settings" role="dialog">
      <div className="result-panel title-panel">
        <p className="run-kicker">SETTINGS</p>
        <h1>설정</h1>
        <div className="title-settings-list">
          <label className="title-setting-field">
            <span className="title-setting-copy"><strong>동전 던지기</strong><small>동전 결과 연출 속도</small></span>
            <select value={value.flipSpeed} onChange={(event) => patch("flipSpeed", event.currentTarget.value as CombatPreferences["flipSpeed"])}>
              <option value="normal">기본</option>
              <option value="fast">빠르게</option>
              <option value="instant">즉시</option>
            </select>
          </label>
          <label className="title-setting-field title-setting-toggle">
            <input checked={value.sound} type="checkbox" onChange={(event) => patch("sound", event.currentTarget.checked)} />
            <span className="title-setting-copy"><strong>소리</strong><small>효과음과 전투 알림음 재생</small></span>
          </label>
          <label className="title-setting-field title-setting-toggle">
            <input checked={value.reducedMotion} type="checkbox" onChange={(event) => patch("reducedMotion", event.currentTarget.checked)} />
            <span className="title-setting-copy"><strong>모션 줄이기</strong><small>화면 흔들림과 연출 생략</small></span>
          </label>
          <label className="title-setting-field title-setting-toggle">
            <input checked={value.highContrast} type="checkbox" onChange={(event) => patch("highContrast", event.currentTarget.checked)} />
            <span className="title-setting-copy"><strong>고대비</strong><small>프레임과 상태 정보 대비 강화</small></span>
          </label>
        </div>
        <div className="title-actions"><button ref={backRef} type="button" onClick={onBack}>돌아가기</button></div>
      </div>
    </section>
  );
}
