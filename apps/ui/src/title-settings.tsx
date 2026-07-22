import type { CombatPreferences } from "./combat-preferences";

interface TitleSettingsProps {
  value: CombatPreferences;
  onBack: () => void;
  onChange: (next: CombatPreferences) => void;
}

export function TitleSettings({ value, onBack, onChange }: TitleSettingsProps): JSX.Element {
  const patch = <Key extends keyof CombatPreferences>(key: Key, next: CombatPreferences[Key]) => onChange({ ...value, [key]: next });
  return (
    <section aria-label="설정" className="result-overlay title-overlay title-settings" data-testid="title-settings">
      <div className="result-panel title-panel">
        <p className="run-kicker">SETTINGS</p>
        <h1>설정</h1>
        <div className="title-settings-list">
          <label>동전 던지기 <select value={value.flipSpeed} onChange={(event) => patch("flipSpeed", event.currentTarget.value as CombatPreferences["flipSpeed"])}><option value="normal">기본</option><option value="fast">빠르게</option><option value="instant">즉시</option></select></label>
          <label><input checked={value.sound} type="checkbox" onChange={(event) => patch("sound", event.currentTarget.checked)} /> 소리</label>
          <label><input checked={value.reducedMotion} type="checkbox" onChange={(event) => patch("reducedMotion", event.currentTarget.checked)} /> 모션 줄이기</label>
          <label><input checked={value.highContrast} type="checkbox" onChange={(event) => patch("highContrast", event.currentTarget.checked)} /> 고대비</label>
        </div>
        <div className="title-actions"><button ref={(button) => button?.focus()} type="button" onClick={onBack}>돌아가기</button></div>
      </div>
    </section>
  );
}
