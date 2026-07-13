# 문서 안내

> 마지막 동기화: 2026-07-13 · 기준: P9 / PRD v1.3 · 콘텐츠 `1.3.0-p9` · 런 저장 v7

이 디렉터리에는 현재 규칙, 구현 스냅샷, 과거 구현 계획이 함께 있다. 문서 세대가 다르므로 아래 우선순위를 먼저 확인한다.

## 문서 우선순위

1. **제품·게임 규칙**: [`PRD.md`](./PRD.md)의 최신 변경 이력과 [`../PRD/P9_NEW_DESIGN_DECISIONS.md`](../PRD/P9_NEW_DESIGN_DECISIONS.md). 기반 전투 규칙은 P7 결정 로그를 함께 참조한다.
2. **현재 구현 동작**: `packages/core`, `packages/content`의 코드와 회귀 테스트
3. **현재 구현 요약**: [`current-implementation.md`](./current-implementation.md)
4. **신규 콘텐츠 작성 기준**: [`content-design-guide.md`](./content-design-guide.md)
5. **역사적 계획·근거**: [`implementation-plan.md`](./implementation-plan.md), `../PRD/01_PRD.md`~`04_PROJECT_SPEC.md`

제품 문서와 코드가 다르면 어느 한쪽을 조용히 정본으로 간주하지 않는다. 의도한 변경이면 같은 PR에서 제품 문서·구현 요약·테스트를 함께 갱신하고, 의도하지 않은 차이면 회귀 결함으로 취급한다.

## 현재 문서

| 문서 | 역할 | 상태 |
|---|---|---|
| [`PRD.md`](./PRD.md) | 브랜드 코어, 전투 규칙, UX, 콘텐츠 방향 | **현재 제품 정본** — v1.3 변경 이력이 본문 충돌보다 우선 |
| [`../PRD/P9_NEW_DESIGN_DECISIONS.md`](../PRD/P9_NEW_DESIGN_DECISIONS.md) | 마도기사·번개 결투사·르미즈·소환 선택 등 P9 결정 로그 | **최신 오버라이드** |
| [`../PRD/P7_NEW_DESIGN_DECISIONS.md`](../PRD/P7_NEW_DESIGN_DECISIONS.md) | 쿨다운·8슬롯·양면 속성 코인·과열 등 기반 전투 규칙 | **활성 기반 규칙** |
| [`current-implementation.md`](./current-implementation.md) | 모노레포, 전투 파이프라인, 런·저장·CI의 현재 구현 스냅샷 | **현재 기술 안내** |
| [`content-design-guide.md`](./content-design-guide.md) | 캐릭터·스킬·코인·몬스터를 추가할 때의 활성 양식 | **현재 작성 가이드** |
| [`../PRD/PLAYTEST_KIT.md`](../PRD/PLAYTEST_KIT.md) | 사람 플레이테스트 실행 절차 | 경험 검증용 |

## 역사 문서

다음 문서는 삭제하지 않는다. 당시 결정 근거와 마일스톤 기록으로는 유효하지만, 신규 구현의 규칙 정본으로 사용하지 않는다.

| 문서 | 보존 이유 | 대표적인 구규칙 |
|---|---|---|
| [`implementation-plan.md`](./implementation-plan.md) | M0~M6 아키텍처와 파이프라인 설계 근거 | 턴당 3회, 스킬별 턴당 1회, 6슬롯, 단면 속성 proc |
| [`../PRD/01_PRD.md`](../PRD/01_PRD.md) | 초기 MVP 범위·가정 원장 | 5전투 런, 전사 중심 MVP, Phase 3 미구현 전제 |
| [`../PRD/02_DATA_MODEL.md`](../PRD/02_DATA_MODEL.md) | 초기 3층 데이터 모델 설명 | `proc` 단수, `usedThisTurn`, 슬롯 6 |
| [`../PRD/03_PHASES.md`](../PRD/03_PHASES.md) | 초기 3-Phase 진행 기록 | M0~M6 체크리스트와 당시 범위 |
| [`../PRD/04_PROJECT_SPEC.md`](../PRD/04_PROJECT_SPEC.md) | 초기 AI 작업 규율 | 오래된 경로·명령·MVP 제한 일부 포함 |

## P7에서 바뀐 핵심

- 전역 **턴당 스킬 3회 제한**과 `usedThisTurn`을 제거하고, 스킬별 `cooldown: 0..3`으로 교체했다.
- 장착 슬롯은 **8칸**, 시작 스킬은 **4개**, 빈 슬롯은 `null`이다.
- 모든 속성 코인은 앞면과 뒷면 양쪽에 고유 효과가 있으며 혈액 코인과 회복 효과가 추가됐다.
- 화염 코인 소비로 진입하고 강화 스킬 해결 뒤 소비되는 **과열** 상태를 도입했다.
- 즉시 드로우·다음 턴 드로우·임시 코인 생성 규칙과 손 상한 10을 표준화했다.
- 런은 **3막 × 막당 10방문**, 저장 형식은 v7이다.

세부 구현은 [`current-implementation.md`](./current-implementation.md)를 본다.

## 문서 갱신 규칙

규칙 변경 PR은 변경 종류에 따라 다음 파일을 함께 갱신한다.

| 변경 | 반드시 확인할 문서 |
|---|---|
| 플레이 규칙·캐릭터 정체성 | `docs/PRD.md`, 해당 결정 로그 |
| 전투 상태·명령·효과 원자·턴 순서 | `docs/current-implementation.md` |
| 콘텐츠 작성 제한·수치 기준 | `docs/content-design-guide.md` |
| 저장 스키마·마이그레이션 | `docs/current-implementation.md`의 저장 절, 저장 버전 주석 |
| 테스트·배포 게이트 | `README.md`, `docs/current-implementation.md` |

테스트 개수, 번들 바이트처럼 자주 바뀌는 수치는 README에 복사하지 않는다. 실행 스크립트와 임계값이 있는 소스 경로를 링크해 드리프트를 줄인다.
