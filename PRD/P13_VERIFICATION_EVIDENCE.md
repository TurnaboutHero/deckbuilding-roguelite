# P13 검증 증거 — 2026-07-16 설계 개정 캠페인 최종 게이트

> 설계 정본: [`P13_REVISION_DESIGN_SYNC.md`](./P13_REVISION_DESIGN_SYNC.md) · 계획: [`P13_IMPLEMENTATION_PLAN.md`](./P13_IMPLEMENTATION_PLAN.md)
> 실행 체계: Fable(설계·경계·리뷰·게이트) → Pumasi → Codex 워커 15회(라운드 8개, 재위임 5건 포함). 로컬 전용 — 커밋/푸시/PR 없음.

## 1. 자동 게이트 결과 (전부 실측)

| 게이트 | 결과 | 증거 |
|---|---|---|
| typecheck ×4 (core/content/ui/sim) | PASS | tsc --noEmit 4패키지 0오류 |
| lint (전체) | PASS | eslint exit 0 |
| 단위·통합 테스트 | PASS | vitest 613/613 (최종 트리) |
| check:content | PASS | 87 테스트, validateContentDb 0오류 |
| check:assets (provenance) | PASS | 스프라이트 13캐릭터(수호자 삭제 후 12) + prompt-kit ok=true·0E |
| ci:sim | PASS | allRunsTerminal·noCrashes·noInvariantViolations·**seed42GoldenUnchanged** 전부 true, 500/500 터미널 (신규 몬스터 6종 포함 스윕) |
| build (vite) | PASS | Windows Node 인터롭 |
| check:budget | PASS | JS 520,801B ≤ 532,480B — P13 UI 증가로 한도 상향(사유 주석 포함, 실측 기반) |
| navigation | PASS | 1280×720 스모크, page error 0 |
| feedback-regression (P8) | PASS | overlay/VFX/SFX 계약 |
| feedback-check | PASS | 수동/자동 실행·복구·프리뷰 계약 (하네스 표시명 동기화 후) |
| a11y-contrast | PASS | AA 게이트 |
| perf-check | PASS | LCP/CLS/long-task 게이트 |
| playtest 전체 | PASS | 전 시나리오 + **p13-multi-enemy 15케이스**(5해상도×3/4/5적) + 상점 설명 + S21 수호자 부재 |
| 저장 마이그레이션 | PASS | v1~v9 왕복 + guardian v8 → retired-character(격리 보존·안내) 테스트 |
| 스프라이트 QA | PASS | Base Lock·추출 ok·아틀라스 ok·모션 QA·manifest=frames 정합·알파 감사(셀당 불투명 픽셀 검증) |

레이아웃 스크린샷 15장 + 상점 설명 1장: `.omx/reports/p13-layout/`. 최종 플레이테스트 산출물: `.omx/reports/p13-final-playtest/`.

## 2. 골든 재앵커 이력 (사유 명기)

| 시점 | 대상 | 사유 |
|---|---|---|
| Wave 1 | `SEED_42_GOLDEN`(ci-smoke), run-sim.test, balance-report.test | 보상 풀 전속성 가중 개방 — 의도된 결정론 궤적 변화 |
| Wave 3~5 | 재앵커 불필요 | 르미즈/과열/반향/몬스터 풀/수호자 삭제 후에도 seed-42 골든 실측 불변(검증 완료) |

## 3. 변경/유지/이유/위험 최종표

설계 시점 표는 P13 설계 정본 §1. 구현 후 갱신 사항만 기록:

| 항목 | 최종 상태 | 잔여 위험 |
|---|---|---|
| 스택형 르미즈 | 구현·수용 수학 열거 테스트 고정(E[반복]=1.5, P0=P3=12.5%, max36) | 수치 balance-provisional — 사람 플레이테스트 필요 |
| 과열 예약 | pendingOverheat + residualHeat(전투당 1회) 구현 | 동일 |
| 갑주 반향 | min(흡수,6)+예열+정밀, 상한 12, 증폭 턴당 1회, 방어 직접 변환 금지 불변식 테스트 | 동일 |
| 전속성 보상 가중 | 대표4/기본3/보유2/미보유1, 난수 소비 고정 | 시뮬 승률 0.252→0.214 관측(report-only) — 밸런스 재관찰 필요 |
| 몬스터 배치 A | 6종 라이브(2·3막), 원자 6종, 배치 B~F 미구현(진입 조건 §6.4) | 신규 적 턴 지표는 시뮬 관측만 — 사람 검증 전 |
| 수호자 삭제 | 저장 v9 retired-character, 콘텐츠 1.7.0-revision | 없음(격리 보존) |
| 스프라이트 | warrior 유지, sorcerer/arcanist 재생성(전 파이프라인 QA) | 소서러 절대 신장 축소는 2x 픽셀 밀도 계약상 불가 — 비율로만 아담함 표현(qa-notes 기록). 큐레이션 뷰 인간 검수 대기 |
| 보상 은퇴 3종 | `bloodOffering` 제외 관례 재사용 | 플래그 의미 변경 시 전용 `retired` 필드 필요(PRD §14 등재) |
| JS 번들 예산 | 497,664 → 532,480B 상향 | 다음 기능 추가 전 코드 스플리팅 검토 여지 |

## 4. 측정하지 않은 것 (정직성 계약)

- 재미·난이도·빌드 선택률: 측정 없음. 모든 신규 수치는 `balance-provisional`, 경험은 `experience-unverified`.
- 몬스터 배치 B~F: 카탈로그 정본만 존재, 코드 없음.
- 시뮬 승률 변화(0.252→0.214)는 봇 정책 기준 관측치이며 사람 밸런스 판단이 아니다.
