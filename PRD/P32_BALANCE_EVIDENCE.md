# P3.2 밸런스 증거 (2026-07-11, report-only)

> 재현: `npx tsx tools/sim/src/balance-report.ts` (schema `p3-balance-report-v1`, 27,872 bytes).
> 전부 `balance-provisional` — 수치 변경 근거가 아니라 기계적 사실 기록이다. 재미·체감은 `experience-unverified`.

## 빌드/보상 정책 축 (감시자 기각 → 재작업 → 회귀 수정 후 확정)

- 정책 분리: 전투 정책(Random/Aggro/Turtle/GreedyEV) × 보상 빌드 정책(fire-build/mana-build).
- 해석 정본 `resolveBuildPolicy`: 명시 지정 > 캐릭터 기본(guardian=mana-build) > **레거시 variant 코인 우선순위**
  (M6 baseline/basic-first 의미 보존 — 회귀 테스트 2건 고정).
- 회귀 증명: 재작업 중간 산출물은 basic-first CRN이 fire-first와 동일(delta 0, 20/20)로 오염됐었다.
  수정 후 리포트가 M6 정본 값을 재현: **basic-first 19/20 same, 평균 HP Δ −2.45** ✓.

## 핵심 수치 (500 warrior + 500 guardian 정책 런)

| 축 | 값 |
|----|-----|
| guardian 안전 게이트(report-only) | 500/500 terminal · crash 0 · invariant 0 |
| guardian(mana-build) 코인 보상 선택 | mana 1525/1525 · fire 0 · basic 0 |
| warrior(fire-build) 코인 보상 선택 | fire 1554/1554 · mana 0 · basic 0 |
| 캐릭터 CRN (GreedyEV 20쌍, warrior 대 guardian) | 20/20 terminal 동일 결과 · guardian 평균 이월 HP **+45.55** |
| A=A | identical (fingerprint 재현) |
| 소표본 결정론 | `--games-per-policy 5` 2회 byte-identical |

## 지배/사장 옵션 판정 (캐릭터×빌드 분해)

- 코인 선택 1.0/0.0 분포는 **결정론 우선순위 봇의 산물**이며 사람 선호 증거가 아니다 (§16.2는 사람 데이터로만 판정).
- `mana-well` 사장 플래그(구 0/15)는 재작업 감사에서 **not-offered**로 정정 — 수호자 시작 킷에 이미 포함되어
  보상 풀에 등장하지 않는 것이 원인 (전용 풀·시작 구성의 구조적 귀결, 결함 아님).
- guardian +45.55 HP CRN은 "수호자가 강하다"의 증거가 아니라 방어형 킷+마나 빌드 봇 경로의 관측값 —
  방향을 특정하는 증거가 나오기 전까지 수치 무변경 원칙 유지.

## 한계

- 봇 빌드 정책은 고정 우선순위(탐욕적 단일 선호)로, 혼합 전략·상황 선택을 표현하지 않는다.
- 이 문서는 M6_BALANCE_REPORT.md(동결)를 대체하지 않고 P3.2 시점의 추가 증거로 병존한다.
