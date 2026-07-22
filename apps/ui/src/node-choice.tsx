// 분기 노드 선택 화면 — 순수 프레젠테이션 (D9 이동 규칙: 다음 레이어의 노드만,
// 스킵 없음). 합법 선택지는 코어가 소유하고 props로만 받는다.
// 아이콘은 픽셀 폰트 안전 SVG 컴포넌트만 (emoji 금지 — P4.3 tofu 감사).
import type { ReactNode } from "react";

export interface NodeOption {
  index: number;
  kind: "combat" | "elite" | "shop" | "event" | "boss" | "rest" | "treasure";
  title: string;
  detail: string;
}

interface NodeChoiceProps {
  currentLayer: number;
  layerLabel: string;
  options: NodeOption[];
  totalLayers: number;
  visitedKinds: readonly NodeOption["kind"][];
  iconFor: (kind: NodeOption["kind"]) => ReactNode;
  onChoose: (index: number) => void;
}

export const NodeChoice = ({
  currentLayer,
  layerLabel,
  options,
  totalLayers,
  visitedKinds,
  iconFor,
  onChoose,
}: NodeChoiceProps) => (
  <section
    aria-label="다음 노드 선택"
    className="node-choice"
    data-testid="node-choice"
  >
    <h2>갈림길</h2>
    <p className="node-choice-sub">{layerLabel} — 다음 목적지를 고릅니다.</p>
    <ol aria-label="런 경로 지도" className="run-map" data-testid="run-map">
      {Array.from({ length: totalLayers }, (_unused, layer) => {
        const visited = layer < currentLayer;
        const current = layer === currentLayer;
        const kind = visited ? visitedKinds[layer] : undefined;
        return <li aria-current={current ? "step" : undefined} className={`${visited ? "visited" : ""} ${current ? "current" : ""}`} key={layer}>
          <span>{visited && kind !== undefined ? iconFor(kind) : current ? "?" : "·"}</span>
          <small>{layer + 1}</small>
        </li>;
      })}
    </ol>
    <div className="node-choice-options">
      {options.map((option) => (
        <button
          className={`node-card node-${option.kind}`}
          data-testid={`node-option-${option.index}`}
          key={option.index}
          onClick={() => onChoose(option.index)}
          type="button"
        >
          <span aria-hidden="true" className="node-icon">
            {iconFor(option.kind)}
          </span>
          <strong>{option.title}</strong>
          <small>{option.detail}</small>
        </button>
      ))}
    </div>
  </section>
);
