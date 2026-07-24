// 분기 노드 선택 화면 — 순수 프레젠테이션 (D9 이동 규칙: 다음 레이어의 노드만,
// 스킵 없음). 합법 선택지는 코어가 소유하고 props로만 받는다.
// 아이콘은 픽셀 폰트 안전 SVG 컴포넌트만 (emoji 금지 — P4.3 tofu 감사).
import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";

export interface NodeOption {
  index: number;
  kind: "combat" | "elite" | "shop" | "event" | "boss" | "rest" | "treasure";
  title: string;
  detail: string;
}

interface NodeChoiceProps {
  currentLayer: number;
  actStarts: readonly number[];
  layerKinds: readonly (readonly NodeOption["kind"][])[];
  layerLabel: string;
  options: NodeOption[];
  totalLayers: number;
  visitedKinds: readonly NodeOption["kind"][];
  iconFor: (kind: NodeOption["kind"]) => ReactNode;
  onChoose: (index: number) => void;
}

export const NodeChoice = ({
  currentLayer,
  actStarts,
  layerKinds,
  layerLabel,
  options,
  totalLayers,
  visitedKinds,
  iconFor,
  onChoose,
}: NodeChoiceProps) => {
  const mapViewport = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const viewport = mapViewport.current;
    const current = viewport?.querySelector<HTMLElement>('[aria-current="step"]');
    if (viewport === null || current === null || current === undefined) return;
    const viewportBox = viewport.getBoundingClientRect();
    const currentBox = current.getBoundingClientRect();
    viewport.scrollLeft = Math.max(
      0,
      viewport.scrollLeft + currentBox.left - viewportBox.left + currentBox.width / 2 - viewport.clientWidth / 2,
    );
  }, [currentLayer]);

  return (
    <section
      aria-label="다음 노드 선택"
      className="node-choice"
      data-testid="node-choice"
    >
      <header className="node-choice-heading">
        <span className="run-kicker">원정 지도</span>
        <h2>갈림길</h2>
        <p className="node-choice-sub">{layerLabel} — 다음 목적지를 고릅니다.</p>
      </header>
      <div className="run-map-viewport" ref={mapViewport}>
        <ol aria-label="런 경로 지도" className="run-map" data-testid="run-map">
          {Array.from({ length: totalLayers }, (_unused, layer) => {
            const visited = layer < currentLayer;
            const current = layer === currentLayer;
            const act = actStarts.reduce((found, start, index) => (start <= layer ? index : found), 0);
            const actStart = actStarts.includes(layer);
            const kinds = visited
              ? visitedKinds[layer] === undefined
                ? []
                : [visitedKinds[layer]]
              : current
                ? options.map((option) => option.kind)
                : layerKinds[layer] ?? [];
            const markers = [...new Set(kinds)].slice(0, 3);
            return (
              <li
                aria-current={current ? "step" : undefined}
                aria-label={`${act + 1}막 ${layer - (actStarts[act] ?? 0) + 1}번째 노드${visited ? ", 완료" : current ? ", 현재 선택 가능" : ", 미확인"}`}
                className={`${visited ? "visited" : ""} ${current ? "current next-candidate" : "future"} act-${act + 1} ${actStart ? "act-start" : ""}`}
                data-act-label={actStart ? `${act + 1}막` : undefined}
                key={layer}
              >
                <span aria-hidden="true" className="run-map-markers">
                  {markers.length === 0 ? <i className="run-map-dot" /> : markers.map((kind) => <i key={kind}>{iconFor(kind)}</i>)}
                </span>
                <small>{layer + 1}</small>
              </li>
            );
          })}
        </ol>
      </div>
      <div aria-label="선택 가능한 목적지" className="node-choice-options">
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
};
