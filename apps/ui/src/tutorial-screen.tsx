import { useEffect, useRef, useState } from "react";

const STEPS = [
  {
    title: "전투의 흐름",
    copy: "턴마다 손패로 동전 3개를 뽑습니다. 동전을 스킬에 걸고 즉시 결과를 확인한 뒤, 남은 동전으로 다음 행동을 이어갑니다.",
  },
  {
    title: "기본과 속성 동전",
    copy: "기본 동전은 앞면 피해 4, 뒷면 방어 4입니다. 속성 동전은 어떤 스킬에도 사용할 수 있고, 나온 면에 따라 추가 효과를 냅니다.",
  },
  {
    title: "스킬 읽기",
    copy: "1코스트 스킬은 한 면의 성공에 기대고, 2코스트 이상 스킬은 기본 효과에 면·속성 보상을 더합니다. 카드의 코스트만큼 동전을 고르세요.",
  },
  {
    title: "동전 배팅과 즉시 사용",
    copy: "손패에서 코인을 골라 스킬에 건 뒤 즉시 사용하면 바로 플립하고 해결합니다. 행동을 미리 저장하거나 전체 계획을 확정할 필요는 없습니다.",
  },
  {
    title: "세 더미",
    copy: "뽑을 더미는 다음 동전, 손패는 지금 쓸 동전, 버림 더미는 사용한 동전입니다. 뽑을 더미가 비면 버림 더미를 섞어 다시 사용합니다.",
  },
  {
    title: "연습 전투",
    copy: "이제 직접 해볼 차례입니다. 새 런에서 첫 전투를 시작해 기본 동전 하나를 스킬에 걸고 즉시 사용해 보세요. 안내는 전투 중에도 순서대로 표시됩니다.",
  },
] as const;

interface TutorialScreenProps {
  onBack: () => void;
  onStartPractice: () => void;
}

export function TutorialScreen({ onBack, onStartPractice }: TutorialScreenProps): JSX.Element {
  const [step, setStep] = useState(0);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const current = STEPS[step]!;

  useEffect(() => primaryRef.current?.focus(), [step]);

  return (
    <section aria-label="튜토리얼" className="result-overlay title-overlay tutorial-screen" data-testid="tutorial-screen">
      <div className="result-panel title-panel tutorial-panel">
        <p className="run-kicker">TUTORIAL {step + 1}/{STEPS.length}</p>
        <h1>{current.title}</h1>
        <p className="tutorial-screen-copy">{current.copy}</p>
        <div aria-label="튜토리얼 진행" className="tutorial-progress">
          {STEPS.map((item, index) => <i aria-label={`${item.title} ${index + 1}단계`} className={index <= step ? "complete" : ""} key={item.title} />)}
        </div>
        <div className="title-actions tutorial-actions">
          {step > 0 ? (
            <button className="secondary-action" type="button" onClick={() => setStep((value) => Math.max(0, value - 1))}>이전</button>
          ) : (
            <button className="secondary-action" type="button" onClick={onBack}>타이틀로</button>
          )}
          {step === STEPS.length - 1 ? (
            <button data-testid="tutorial-start-practice" ref={primaryRef} type="button" onClick={onStartPractice}>연습 시작</button>
          ) : (
            <button data-testid="tutorial-next" ref={primaryRef} type="button" onClick={() => setStep((value) => Math.min(STEPS.length - 1, value + 1))}>다음</button>
          )}
        </div>
      </div>
    </section>
  );
}
