import { useEffect, useRef, useState } from "react";

export interface TitleSaveSummary {
  characterName: string;
  currentHp: number;
  maxHp: number;
  progress: string;
}

interface TitleScreenProps {
  save: TitleSaveSummary | null;
  onContinue: () => void;
  onNewRun: () => void;
  onTutorial: () => void;
  onSettings: () => void;
}

export const TitleScreen = ({
  save,
  onContinue,
  onNewRun,
  onTutorial,
  onSettings,
}: TitleScreenProps) => {
  const [confirming, setConfirming] = useState(false);
  const primaryRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    primaryRef.current?.focus();
  }, [confirming]);

  if (confirming) {
    return (
      <section
        aria-label="새 런 확인"
        aria-modal="true"
        className="result-overlay title-overlay"
        data-testid="title-screen"
        role="dialog"
      >
        <div className="result-panel title-panel title-confirm-panel">
          <p className="run-kicker">현재 저장 삭제</p>
          <h1>새 런을 시작할까요?</h1>
          <p>현재 진행은 삭제되며 되돌릴 수 없습니다.</p>
          <div className="title-actions">
            <button
              className="secondary-action"
              ref={primaryRef}
              type="button"
              onClick={() => setConfirming(false)}
            >
              취소
            </button>
            <button
              data-testid="title-confirm-new-run"
              type="button"
              onClick={onNewRun}
            >
              저장 삭제 후 시작
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="타이틀 화면"
      className="result-overlay title-overlay"
      data-testid="title-screen"
    >
      <div className="result-panel title-panel">
        <p className="run-kicker">COINFLIP ROGUELIKE</p>
        <h1>코인플립 로그라이크</h1>
        {save === null ? (
          <p className="title-empty" data-testid="title-save-summary">
            저장된 런이 없습니다.
          </p>
        ) : (
          <dl className="title-save-summary" data-testid="title-save-summary">
            <div>
              <dt>캐릭터</dt>
              <dd>{save.characterName}</dd>
            </div>
            <div>
              <dt>진행</dt>
              <dd>{save.progress}</dd>
            </div>
            <div>
              <dt>체력</dt>
              <dd>
                {save.currentHp}/{save.maxHp}
              </dd>
            </div>
          </dl>
        )}
        <div className="title-actions">
          <button
            data-testid="title-continue"
            disabled={save === null}
            ref={primaryRef}
            type="button"
            onClick={onContinue}
          >
            이어하기
          </button>
          <button
            className="secondary-action"
            data-testid="title-new-run"
            type="button"
            onClick={() => (save === null ? onNewRun() : setConfirming(true))}
          >
            새 런 시작
          </button>
          <button
            className="secondary-action"
            data-testid="title-tutorial"
            type="button"
            onClick={onTutorial}
          >
            튜토리얼
          </button>
          <button
            className="secondary-action"
            data-testid="title-settings"
            type="button"
            onClick={onSettings}
          >
            설정
          </button>
        </div>
      </div>
    </section>
  );
};
