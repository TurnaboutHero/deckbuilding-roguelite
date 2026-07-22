import { useEffect } from "react";

export function CombatHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): JSX.Element {
  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onOpenChange, open]);

  return (
    <div className="combat-help-host">
      <button aria-controls="combat-help-panel" aria-expanded={open} aria-label="전투 도움말 열기" className="combat-help-open" data-testid="combat-help-open" type="button" onClick={() => onOpenChange(!open)}>?</button>
      {open ? (
        <section aria-label="전투 도움말" className="combat-help-panel" data-testid="combat-help" id="combat-help-panel" role="region">
          <header><strong>전투 도움말</strong><button aria-label="전투 도움말 닫기" data-testid="combat-help-close" type="button" onClick={() => onOpenChange(false)}>×</button></header>
          <dl>
            <div><dt>동전 걸기</dt><dd>손패 동전을 고른 뒤 사용할 스킬을 선택합니다. 사용 전에는 동전 선택을 자유롭게 바꿀 수 있습니다.</dd></div>
            <div><dt>즉시 사용</dt><dd>필요한 동전을 고르고 사용 버튼을 누르면 각 동전을 플립하고 스킬을 바로 해결합니다.</dd></div>
            <div><dt>연속 행동</dt><dd>반복 스킬은 손패와 코스트가 남는 한 같은 턴에 다시 사용할 수 있습니다. 행동을 미리 저장하거나 전체 계획을 확정할 필요는 없습니다.</dd></div>
            <div><dt>대상</dt><dd>대상이 필요한 스킬은 사용 전에 적이나 장비를 고릅니다.</dd></div>
            <div><dt>버림·보존</dt><dd>사용하지 않은 동전은 턴 종료 때 버립니다. 보존 능력이 있으면 선택한 동전을 다음 턴까지 남깁니다.</dd></div>
            <div><dt>쿨타임</dt><dd>사용한 스킬은 표시된 턴 동안 다시 사용할 수 없습니다.</dd></div>
            <div><dt>상태</dt><dd>화상·동상·감전·출혈 아이콘의 숫자가 현재 중첩입니다. 아이콘을 가리키거나 눌러 설명을 확인하세요.</dd></div>
          </dl>
        </section>
      ) : null}
    </div>
  );
}
