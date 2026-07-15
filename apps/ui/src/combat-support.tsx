import { useEffect, useRef } from "react";

import type { ResolutionSummary } from "./resolution-summary";
import type { RecommendedLoadProposal } from "./recommended-load";
import type { TurnResourceSummary } from "./turn-resource-summary";

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
            <div><dt>장전</dt><dd>손패 동전을 스킬 슬롯에 넣습니다. 장전한 동전은 발동 전까지 다시 빼거나 서로 바꿀 수 있습니다.</dd></div>
            <div><dt>수동 사용</dt><dd>완전히 장전되면 카드 하단의 스킬 사용을 눌러 바로 발동할 수 있습니다.</dd></div>
            <div><dt>실행 순서</dt><dd>아직 사용하지 않은 완전 장전 스킬에 번호가 붙습니다. 실행 레일의 앞·뒤 버튼이나 드래그로 순서를 바꿉니다.</dd></div>
            <div><dt>턴 종료</dt><dd>수동 모드에서는 미사용 장전 스킬이 있을 때만 실행 여부를 묻습니다. 앞으로 자동 실행을 체크하면 이후에는 번호 순서대로 바로 처리합니다.</dd></div>
            <div><dt>대상</dt><dd>선택이 필요한 스킬은 자동 실행을 잠시 멈춥니다. 강조된 적이나 장비를 고르세요.</dd></div>
            <div><dt>버림·보존</dt><dd>실행하지 않은 동전은 턴 종료 때 버립니다. 보존 능력이 있으면 마지막에 남길 동전을 고릅니다.</dd></div>
            <div><dt>쿨타임</dt><dd>사용한 스킬은 표시된 턴 동안 다시 장전할 수 없습니다.</dd></div>
            <div><dt>상태</dt><dd>화상·동상·감전 아이콘의 숫자는 현재 중첩입니다. 아이콘을 가리키거나 눌러 설명을 확인하세요.</dd></div>
          </dl>
        </section>
      ) : null}
    </div>
  );
}

export function TurnResourceStrip({ summary }: { summary: TurnResourceSummary }): JSX.Element {
  return (
    <div aria-label="현재 턴 동전 요약" className="turn-resource-summary" data-testid="turn-resource-summary">
      <span aria-label={`사용 가능한 동전 ${summary.usable}개`}>손패 <strong>{summary.usable}</strong></span>
      <span aria-label={`장전된 동전 ${summary.loaded}개`}>장전 <strong>{summary.loaded}</strong></span>
      <span aria-label={`실행할 동전 ${summary.queued}개`}>실행 <strong>{summary.queued}</strong></span>
      <span aria-label={`턴 종료 때 버릴 동전 ${summary.discardedOnEnd}개`} className={summary.discardedOnEnd > 0 ? "warn" : ""}>버림 <strong>{summary.discardedOnEnd}</strong></span>
    </div>
  );
}

export function RecommendedLoadPreview({ proposal, onConfirm, onCancel }: { proposal: RecommendedLoadProposal; onConfirm: () => void; onCancel: () => void }): JSX.Element {
  const panelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    panelRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onCancel]);
  return (
    <section aria-label="추천 장전 미리보기" className="recommended-load-preview" data-testid="recommended-load-preview" id="recommended-load-preview" ref={panelRef} role="dialog" tabIndex={-1}>
      <strong>추천 장전 미리보기</strong>
      <p>왼쪽 스킬부터 빈 슬롯을 채웁니다. 스킬은 발동하지 않으며 대상·선택 효과도 정하지 않습니다.</p>
      <ol>{proposal.placements.map((placement) => <li key={`${Number(placement.coin)}-${Number(placement.slot)}`}>{placement.order}. 동전 → {Number(placement.slot) + 1}번 스킬</li>)}</ol>
      <div><button data-testid="recommended-load-confirm" type="button" onClick={onConfirm}>이대로 장전</button><button data-testid="recommended-load-cancel" type="button" onClick={onCancel}>취소</button></div>
    </section>
  );
}

export function CombatHistory({ entries }: { entries: readonly ResolutionSummary[] }): JSX.Element {
  return (
    <details className="combat-history" data-testid="combat-history">
      <summary>전투 기록 {entries.length}</summary>
      <ol>{entries.length === 0 ? <li className="empty">아직 해결된 스킬이 없습니다.</li> : entries.map((entry, index) => <li key={`${index}-${entry.skillName}`}><strong>{entry.skillName}</strong><span>{entry.totalLine}</span>{entry.faces.length > 0 ? <small>{entry.faces.map((face) => face === "heads" ? "앞" : "뒤").join(" · ")}</small> : null}</li>)}</ol>
    </details>
  );
}
