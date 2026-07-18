# 문서 안내

> 마지막 동기화: 2026-07-18 · 기준: PRD v2.1 / P13 + D19 확정 데이터 동기화

문서의 역할을 제품 정본, 구현 스냅샷, 콘텐츠 작성 가이드, 결정 기록으로 분리한다. 같은 규칙을 여러 문서에서 독립적으로 수정하지 않는다.

## 문서 우선순위

1. **제품과 게임 규칙**: [`PRD.md`](./PRD.md)
2. **실제 동작**: `packages/core`, `packages/content`, `apps/ui`의 코드와 회귀 테스트
3. **구현 안내**: [`current-implementation.md`](./current-implementation.md)
4. **신규 콘텐츠 작성 계약**: [`content-design-guide.md`](./content-design-guide.md)
5. **결정 근거와 이력**: `../PRD/P7_*.md`~`../PRD/P13_*.md`, 역사 문서

제품 문서와 코드가 다르면 한쪽을 조용히 정답으로 간주하지 않는다. 의도한 변경이면 같은 작업에서 제품 정본·구현 스냅샷·테스트를 함께 갱신하고, 의도하지 않은 차이면 회귀 결함으로 처리한다.

## 현재 문서

| 문서 | 역할 | 상태 |
|---|---|---|
| [`project-direction.md`](./project-direction.md) | 공개 전략·타깃·그래픽·에셋·검증에 대한 내부 의사결정 | **방향 합의안** |
| [`PRD.md`](./PRD.md) | 브랜드 코어, 전투·런·보상·캐릭터·UX 규칙 | **제품 단일 정본** |
| [`current-implementation.md`](./current-implementation.md) | 현재 코드의 상태·명령·해결 순서·저장·검증 안내 | **기술 스냅샷** |
| [`content-design-guide.md`](./content-design-guide.md) | 코인·스킬·패시브·캐릭터·몬스터 작성 규칙 | **작성 계약** |
| [`../PRD/D19_CHARACTER_DATA_DESIGN_SYNC.md`](../PRD/D19_CHARACTER_DATA_DESIGN_SYNC.md) | Drive v1.2와 캐릭터 데이터 테이블 확정 행의 권한·구현 대조 | **최신 결정 기록** |
| [`../PRD/P13_REVISION_DESIGN_SYNC.md`](../PRD/P13_REVISION_DESIGN_SYNC.md) | 스택 르미즈·과열 예약·갑주 반향·전속성 보상·몬스터 20종·수호자 삭제 | 결정 기록 |
| [`../PRD/P12_BLOOD_SPELLBLADE_DESIGN_SYNC.md`](../PRD/P12_BLOOD_SPELLBLADE_DESIGN_SYNC.md) | 혈액 마검사와 혈마검 런 성장의 구현 근거 | 결정 기록 |
| [`../PRD/P11_COLD_ROGUE_DESIGN_SYNC.md`](../PRD/P11_COLD_ROGUE_DESIGN_SYNC.md) | 냉기 도적·보존·지정 드로우 구현 근거 | 결정 기록 |
| [`../PRD/P10_CHARACTER_DESIGN_SYNC.md`](../PRD/P10_CHARACTER_DESIGN_SYNC.md) | 화염 격투가·마도기사 구현 근거 | 결정 기록 |
| [`../PRD/P9_NEW_DESIGN_DECISIONS.md`](../PRD/P9_NEW_DESIGN_DECISIONS.md) | 번개 결투사·르미즈 구현 근거 | 결정 기록 |
| [`../PRD/P7_NEW_DESIGN_DECISIONS.md`](../PRD/P7_NEW_DESIGN_DECISIONS.md) | 쿨다운·8슬롯·양면 코인 기반 규칙의 전환 근거 | 결정 기록 |
| [`../PRD/PLAYTEST_KIT.md`](../PRD/PLAYTEST_KIT.md) | 사람 플레이테스트 절차와 기록 양식 | 경험 검증 |

## 역사 문서

다음 문서는 당시 계획과 근거를 보존하지만 현재 규칙을 구현하는 데 사용하지 않는다.

| 문서 | 대표 구규칙 |
|---|---|
| [`implementation-plan.md`](./implementation-plan.md) | 턴당 3회, 스킬별 턴당 1회, 6슬롯, 단면 속성 proc |
| [`history/implementation-plan-v1.2.md`](./history/implementation-plan-v1.2.md) | 초기 구현 계획 원문 |
| [`../PRD/01_PRD.md`](../PRD/01_PRD.md) | 5전투 런, 전사 중심 초기 MVP |
| [`../PRD/02_DATA_MODEL.md`](../PRD/02_DATA_MODEL.md) | `usedThisTurn`, 6슬롯, 단일 `proc` |
| [`../PRD/03_PHASES.md`](../PRD/03_PHASES.md) | 초기 M0~M6 진행 계획 |
| [`../PRD/04_PROJECT_SPEC.md`](../PRD/04_PROJECT_SPEC.md) | 초기 작업 규율과 경로 일부 |

## 문서 소유권

| 정보 | 원본 |
|---|---|
| 타깃·공개·그래픽·에셋 제작 방향 | `project-direction.md` |
| 왜 필요한가, 플레이어가 무엇을 경험하는가 | `docs/PRD.md` |
| 현재 코드가 어떤 순서로 처리하는가 | 코드·테스트, `current-implementation.md` |
| 콘텐츠 필드와 작성 제한 | 타입·검증기, `content-design-guide.md` |
| 실제 수치와 ID | `packages/content/src/index.ts` |
| 수치 기준·확률·제작 상태 | 데이터/시뮬레이션 출력 |
| 결정 이유와 폐기 대안 | `PRD/P*.md` |

## 갱신 규칙

- 규칙 변경: `PRD.md`와 관련 테스트를 함께 수정한다.
- 전투 상태·효과 원자·턴 순서 변경: `current-implementation.md`를 함께 수정한다.
- 콘텐츠 필드·검증 제한 변경: `content-design-guide.md`를 함께 수정한다.
- 저장 스키마 변경: 버전·마이그레이션·검증·왕복 테스트와 구현 문서를 함께 수정한다.
- 자주 바뀌는 테스트 개수, 번들 바이트, 실행 시간은 문서에 복사하지 않고 스크립트와 CI를 정본으로 둔다.
- `최종`, `진짜최종`, `최종2` 같은 파일명 대신 Git 이력과 문서 상태를 사용한다.
