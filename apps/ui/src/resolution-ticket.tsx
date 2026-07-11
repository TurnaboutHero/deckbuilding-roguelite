import type { Face } from '@game/core';

import type { ResolutionSummary } from './resolution-summary';
import './resolution-ticket.css';

const faceLabel = (face: Face): string => (face === 'heads' ? '앞' : '뒤');
const faceClass = (face: Face): string => (face === 'heads' ? 'heads' : 'tails');

const Section = ({ label, lines }: { label: string; lines: readonly string[] }): JSX.Element | null =>
  lines.length === 0 ? null : (
    <div className="resolution-ticket__section">
      <strong className="resolution-ticket__label">{label}</strong>
      {lines.map((line, index) => (
        <span className="resolution-ticket__line" key={`${label}-${index}`}>
          {line}
        </span>
      ))}
    </div>
  );

export function ResolutionTicket(props: { summary: ResolutionSummary }): JSX.Element {
  const { summary } = props;
  return (
    <article className="resolution-ticket" role="status" aria-live="polite" aria-label="스킬 해결 결산">
      <header className="resolution-ticket__header">
        <strong>{summary.skillName}</strong>
      </header>
      {summary.kind === 'consume' ? (
        <div className="resolution-ticket__cost">{summary.costNote}</div>
      ) : (
        <div className="resolution-ticket__faces" aria-label="플립 결과">
          {summary.faces.map((face, index) => (
            <span className="resolution-ticket__face" aria-label={face === 'heads' ? '앞면' : '뒷면'} key={index}>
              <span className={`coin-face-mark ${faceClass(face)}`}>{faceLabel(face)}</span>
            </span>
          ))}
        </div>
      )}
      <Section label="기본" lines={summary.baseLines} />
      <Section label="보너스" lines={summary.bonusLines} />
      <Section label="트리거" lines={summary.triggerLines} />
      <Section label="상태" lines={summary.statusLines} />
      <div className="resolution-ticket__total">
        <strong>합계</strong> {summary.totalLine}
      </div>
    </article>
  );
}
