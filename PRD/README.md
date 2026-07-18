# PRD 작업 문서 안내

> 마지막 동기화: 2026-07-18 · 현재 기준: P13 + D19 / PRD v2.1

이 디렉터리에는 초기 바이브코딩용 문서, 단계별 결정 로그, 검증 증거, 사람 플레이테스트 자료가 함께 있다. 생성 시점이 다르므로 `01_PRD.md`~`04_PROJECT_SPEC.md`를 현재 규칙 정본으로 단독 사용하지 않는다.

전체 문서 우선순위는 [`../docs/README.md`](../docs/README.md)를 먼저 본다.

## 현재 정본과 활성 안내

| 문서 | 역할 |
|---|---|
| [`../docs/PRD.md`](../docs/PRD.md) | 브랜드 코어, 제품 요구사항, 게임 규칙의 단일 정본. 결정 로그는 본문을 조용히 덮어쓰지 않음 |
| [`D19_CHARACTER_DATA_DESIGN_SYNC.md`](./D19_CHARACTER_DATA_DESIGN_SYNC.md) | Drive v1.2·캐릭터 데이터 테이블 revision 148의 권한과 확정 행 구현 대조 |
| [`P13_REVISION_DESIGN_SYNC.md`](./P13_REVISION_DESIGN_SYNC.md) | 전속성 보상·캐릭터 개정·몬스터 20종·수호자 삭제 결정 기록 |
| [`../docs/current-implementation.md`](../docs/current-implementation.md) | 현재 코드의 전투·런·저장·UI·CI 구현 스냅샷 |
| [`../docs/content-design-guide.md`](../docs/content-design-guide.md) | 신규 콘텐츠 작성 규칙과 템플릿 |
| [`PLAYTEST_KIT.md`](./PLAYTEST_KIT.md) | 사람 플레이테스트 실행 절차 |

## 역사적 바이브코딩 문서

다음 문서는 2026-07-10 당시 MVP를 시작하기 위해 생성된 스냅샷이다. 결정 배경과 개발 이력 보존에는 유효하지만 현재 작업 프롬프트의 규칙 정본으로 사용하지 않는다.

| 문서 | 당시 역할 | 현재와 충돌하는 대표 항목 |
|---|---|---|
| [`01_PRD.md`](./01_PRD.md) | 초기 제품 요약 | 5전투 런, 전사 중심 범위, 상점·보스·모바일 미구현 전제 |
| [`02_DATA_MODEL.md`](./02_DATA_MODEL.md) | 초기 데이터 모델 | 단면 `proc`, `usedThisTurn`, 6슬롯, 저장 마이그레이션 부재 |
| [`03_PHASES.md`](./03_PHASES.md) | M0~M6 3-Phase 계획 | 이미 완료된 항목이 체크리스트·미래 범위로 남아 있음 |
| [`04_PROJECT_SPEC.md`](./04_PROJECT_SPEC.md) | 초기 AI 작업 규율 | 오래된 SSoT 경로, 명령, MVP 전용 제한 |

역사 문서를 참고해 구현할 때는 반드시 현재 제품 정본과 구현 문서를 함께 읽는다.

## 결정·검증 자료

| 문서 | 용도 |
|---|---|
| [`PHASE1_HOLDS.md`](./PHASE1_HOLDS.md) | 사람 게이트 보류와 공학 트랙 오버라이드 기록 |
| [`M5_PLAYTEST_NOTES.md`](./M5_PLAYTEST_NOTES.md) | 초기 체감 리뷰와 사람 질문 |
| [`M6_BALANCE_REPORT.md`](./M6_BALANCE_REPORT.md) | 정책별 시뮬레이션 결과와 밸런스 유보 근거 |
| [`P7_NEW_DESIGN_DECISIONS.md`](./P7_NEW_DESIGN_DECISIONS.md) | P7 요구·채택 결정·감사 보정 |
| [`P10_CHARACTER_DESIGN_SYNC.md`](./P10_CHARACTER_DESIGN_SYNC.md) | 화염 격투가·마도기사 결정 근거와 당시 시뮬레이션 기준선 |
| [`P11_COLD_ROGUE_DESIGN_SYNC.md`](./P11_COLD_ROGUE_DESIGN_SYNC.md) | 냉기 도적 결정 근거 |
| [`P12_BLOOD_SPELLBLADE_DESIGN_SYNC.md`](./P12_BLOOD_SPELLBLADE_DESIGN_SYNC.md) | 혈액 마검사 결정 근거 |
| [`P13_REVISION_DESIGN_SYNC.md`](./P13_REVISION_DESIGN_SYNC.md) | 현재 개정 캠페인 결정 근거 |

단계별 보고서는 당시 증거 스냅샷이다. 이후 코드가 바뀌어도 과거 결과를 현재 수치처럼 덮어쓰지 않고, 새 보고서를 추가하거나 명확한 후속 절을 기록한다.

## AI 작업 프롬프트에 넣을 최소 문서

현재 규칙을 구현하거나 수정할 때는 최소한 다음을 함께 제공한다.

```text
@docs/README.md
@docs/PRD.md
@PRD/P13_REVISION_DESIGN_SYNC.md
@PRD/D19_CHARACTER_DATA_DESIGN_SYNC.md
@docs/current-implementation.md
@docs/content-design-guide.md   # 콘텐츠 작업일 때
```

`01_PRD.md`~`04_PROJECT_SPEC.md`만 제공하는 프롬프트는 금지한다.

## 문서 갱신 원칙

- 새 게임 규칙: `docs/PRD.md`와 해당 결정 로그를 갱신한다.
- 코드 구현 계약: `docs/current-implementation.md`를 갱신한다.
- 콘텐츠 제한·템플릿: `docs/content-design-guide.md`를 갱신한다.
- 사람 검증 결과: 기존 공학 상태와 섞지 말고 플레이테스트 문서에 증거를 추가한다.
- 오래된 보고서의 날짜·결론은 보존하고, 현재 정본처럼 보이는 링크와 문구만 교정한다.
