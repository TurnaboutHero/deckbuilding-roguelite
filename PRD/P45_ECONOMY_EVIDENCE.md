# P4.5 경제 Monte Carlo 증거 (2026-07-12) — report-only

스키마 `p4-economy-report-v1` (`tools/sim/src/economy-report.ts`, `pnpm sim:economy`).
**수치 변경 없음** — `tuningDecision.numericContentChange: "none"`. 전 관측은
engineering-safe / balance-provisional / experience-unverified.

## 설계 의미 (감사 반영 사항)

- **전투 정책 baseline (D7)**: `configuration.combatPolicy`는 모든 캐릭터에 동일하게
  고정한 **비교용 baseline**이며 캐릭터별 최적 전략이 아니다. 셀 결과만으로 적/콘텐츠
  수치를 조정하지 않는다 (`combatPolicyMeaning: "fixed-comparison-baseline"`).
- **시드 규칙**: `p45-<node-policy>-<character>-<index>` — 전투 정책은 시드에 포함하지
  않는다. 같은 (노드 정책, 캐릭터, 인덱스)는 전투 정책이 달라도 동일 시드 →
  **정책 간 짝지은 비교**(paired comparison, CRN과 동일한 분산 감소)가 성립한다.
- **파산률 정의 이력 (2·3차 감사 — Fable 최종 판정)**: 문자적 D7 정의("구매 의도+골드
  부족으로 종료")는 정책 구조상 **전 방문 100% 포화(동어반복)** — 잔여 진열은 항상 남은
  골드보다 비싸므로 지표로 무가치하다(최종 스윕 8셀 전부 100.0%로 실증). 최종 결정:
  **지표 분리** — `bankruptcyRate`(운영) = 무구매 파산 방문, `unmetDemandRate`(문자적) =
  잔여 의도 불가 종료 방문(포화 자체가 "상점 수요가 골드를 항상 초과한다"는 관측).
  집중 테스트 3건(부분 구매=파산 아님·수요 참 / 완전 소화=둘 다 거짓 / 무구매=둘 다 참).
- **매복 outcome 귀속**: EventTrace의 '수락 후 결과'는 이벤트 전투 정산까지 포함한다
  (수락 직후 0델타 오귀속 방지 — 정산 후 trace 갱신).

## 교차 진단 — 정책 미스매치 vs 실제 지배 분리 (캐릭터 4 × 전투 정책 4 × 노드 정책 2 × 50런)

감사 지적: aggro 고정 표에서 guardian 외 전원 승률 0%는 "적 수치"와 "정책 부적합"이
교락. 교차 진단 결과 **aggro 부적합이 지배 원인**으로 판명:

| 전투 정책 | warrior 승/보스 | guardian 승/보스 | sorcerer 승/보스 | frost-knight 승/보스 |
|---|---|---|---|---|
| aggro (fight-first) | 0% / 2% | 14% / 82% | 0% / 2% | 0% / 0% |
| greedy (fight-first) | 10% / 64% | **100% / 100%** | 2% / 28% | 62% / 100% |
| turtle (fight-first) | **28% / 98%** | **100% / 100%** | 8% / 72% | **74% / 100%** |
| turtle (economy-first) | 28% / 98% | 100% / 100% | **34% / 86%** | 66% / 100% |
| random | 0% / 0% | 0% / 0% | 0% / 0% | 0% / 0% |

- **최소 공학 기준 판정: 충족** — 4캐릭터 전부 합리 정책(비-random) 하나 이상에서
  보스 도달·승리 비영. warrior turtle 28%/98%, guardian greedy·turtle 100%/100%,
  sorcerer turtle+economy-first 34%/86%, frost-knight turtle 74%/100%.
- **단일 정책 독점 보고**: turtle이 전 셀에서 최선 또는 준최선 — 방어 우선 전략의
  전반 우세. aggro는 guardian 외 전멸, random은 전멸(대조군 정상).
- **지배 후보 플래그 (관측만)**: guardian은 greedy/turtle에서 100% 승률 — 캐릭터 간
  격차가 크다. 수치 조정은 사람 데이터·후속 진단 전 금지 (이 표는 50런 소표본).

## 본 스윕 — 고정 baseline aggro, 캐릭터 4 × 노드 정책 2 × 500런 (총 4,000런)

전체 스윕 2회 완료 — 1차(무구매 파산 정의)·최종(문자적 정의, seedRule 라벨 정정 후).
**짝지은 동일-시드 증거**: 두 스윕의 승률·보스 도달이 8셀 전부 비트 단위 일치
(시드에 전투 정책 미포함 + 파산 정의는 집계에만 관여) — 3차 스윕 불요의 근거.
최종 스윕: 4000/4000 terminal · crash 0 · invariant 0, exit 0.
**이 표만으로 수치 변경 금지** — 위 교차 진단(aggro 부적합 교락)이 근거.

| 캐릭터 | 노드 정책 | 승률 | 보스 도달 | 파산률(운영=무구매, 1차 스윕) | 잔여수요율(문자적, 최종 스윕) | 이벤트 수락률 |
|---|---|---:|---:|---:|---:|---:|
| warrior | fight-first | 0.0% | 8.6% | 0.0% | 100.0% | 23.2% |
| warrior | economy-first | 0.0% | 19.8% | 2.9% | 100.0% | 40.4% |
| guardian | fight-first | 8.8% | 83.4% | 0.0% | 100.0% | 26.2% |
| guardian | economy-first | 12.0% | 93.6% | 9.2% | 100.0% | 48.7% |
| sorcerer | fight-first | 0.0% | 3.6% | 0.0% | 100.0% | 24.1% |
| sorcerer | economy-first | 0.0% | 10.0% | 1.6% | 100.0% | 34.0% |
| frost-knight | fight-first | 0.0% | 0.2% | 0.0% | 100.0% | 23.9% |
| frost-knight | economy-first | 0.0% | 3.6% | 1.3% | 100.0% | 33.3% |

- economy-first는 전 캐릭터에서 보스 도달을 올리지만 평균 최종 골드가 낮아지고
  운영 파산이 발생(최대 guardian 9.2%). 잔여수요율 100% 포화는 "현 가격표에서 상점
  수요가 골드 공급을 항상 초과"한다는 구조 관측 — P5 전 가격/수급 재검토 후보(관측만).

## 안전 게이트 (계약 유지)

- terminal 100% · crash 0 · invariant 0 (전체 스윕 2회 모두 4000/4000)
- 결정론: `--games 5` 2회 바이트 동일 (수용 수정 후 재확인 완료)
- ci:sim·seed42 골든 무변경, no-progress 가드·cap 500 불변

## 후속 (P4.6+/P5)

- 커밋 코드(이중 지표) 기준 전체 스윕 재생성은 다음 주기에 통합 — 승률·보스 도달은
  짝지은 증거로 이미 확정, 파산/수요 두 컬럼만 신규 집계 (report-only).
- guardian 지배·turtle 우세 관측은 사람 플레이 데이터(N≥5)와 교차 후 provisional
  조정 후보로만 승격.
