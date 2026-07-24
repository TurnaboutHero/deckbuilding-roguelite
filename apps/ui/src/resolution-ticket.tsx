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

export function ResolutionTicket(props: { fading?: boolean; summary: ResolutionSummary }): JSX.Element {
  const { fading = false, summary } = props;
  return (
    <article
      className={`resolution-ticket ${fading ? 'is-fading' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={`${summary.skillName} 해결, ${summary.totalLine}`}
    >
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
      <Section label="스킬" lines={[...summary.baseLines, ...summary.bonusLines]} />
      <Section label="코인" lines={summary.coinLines} />
      <Section label="트리거" lines={summary.triggerLines} />
      <Section label="상태" lines={summary.statusLines} />
      <div className="resolution-ticket__total">
        <strong>합계</strong> {summary.totalLine}
      </div>
    </article>
  );
}
