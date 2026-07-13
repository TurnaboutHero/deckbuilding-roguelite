import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';

if (document.getElementById('overlay-root') === null) {
  const overlayRoot = document.createElement('div');
  overlayRoot.id = 'overlay-root';
  document.body.append(overlayRoot);
}

// P5.4 복구: 런타임 오류가 전체 백지로 끝나지 않도록 최소 재시도 UI를 제공한다.
// 저장은 매 상태 변화마다 이미 영속되므로 새로고침 = 이어하기다.
class RecoveryBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="boot-recovery" role="alert">
          <h1>문제가 발생했습니다</h1>
          <p>진행 상황은 저장되어 있습니다. 다시 불러오면 이어집니다.</p>
          <button type="button" onClick={() => window.location.reload()}>
            다시 불러오기
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RecoveryBoundary>
      <App />
    </RecoveryBoundary>
  </React.StrictMode>
);
