# [역사 문서] 구현 계획 v1.2 — 동전 기반 로그라이크 덱빌딩

> 최초 작성: 2026-07-09 · 마지막 v1.2 갱신: 2026-07-10
>
> ⚠️ 이 문서는 현재 게임 규칙의 정본이 아니다. 기존 링크 호환을 위해 이 경로를 유지하며, 당시 M0~M6 계획과 전체 원문은 [`history/implementation-plan-v1.2.md`](./history/implementation-plan-v1.2.md)에 보존한다.

## 현재 작업에서 읽을 문서

1. [`README.md`](./README.md) — 문서 우선순위와 현재/역사 문서 구분
2. [`PRD.md`](./PRD.md) — 제품·게임 규칙 정본; v1.3 변경 이력이 본문 충돌보다 우선
3. [`../PRD/P9_NEW_DESIGN_DECISIONS.md`](../PRD/P9_NEW_DESIGN_DECISIONS.md) — 최신 P9 오버라이드
4. [`../PRD/P7_NEW_DESIGN_DECISIONS.md`](../PRD/P7_NEW_DESIGN_DECISIONS.md) — 활성 기반 전투 규칙
5. [`current-implementation.md`](./current-implementation.md) — 현재 코드의 전투·런·저장·CI 구현 계약
6. [`content-design-guide.md`](./content-design-guide.md) — 신규 콘텐츠 작성 규칙

## v1.2 원문과 현재의 대표 차이

| v1.2 원문 | 현재 P7 |
|---|---|
| 턴당 스킬 최대 3회 | 전역 사용 횟수 캡 없음 |
| 스킬별 턴당 1회, `usedThisTurn` | 슬롯별 `cooldownRemaining`; 반복 스킬은 같은 턴 재사용 |
| 장착 슬롯 6개 | 장착 슬롯 8개, 시작 스킬 4개, 빈 슬롯 `null` |
| 속성 코인의 단면 `proc` | 모든 속성 코인의 앞·뒷면 `procs` |
| 선형 MVP 런 중심 | 3막 × 막당 10방문 그래프 |
| 저장 정책 예약 | 런 저장 v7, 구버전 마이그레이션, 이중 저장·복구·격리 |

원문은 아키텍처 선택, 순수 리듀서, 이벤트 로그, 결정론 RNG, 효과 원자 설계의 역사적 근거를 찾을 때 사용한다. 원문의 구체 규칙과 수치는 신규 구현 명세로 사용하지 않는다.
