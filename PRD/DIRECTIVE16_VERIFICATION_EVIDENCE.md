# Directive 16 Verification Evidence — M15/M16

검증일: 2026-07-18

> 상태: 구현·자동 검증 완료. Fable의 다음 판정 전까지 수치와 체감은 **balance-provisional / experience-unverified**다.

## 구현 범위

- M15 모르트벨 뼈종 사령술사(HP 50): 피해 6, 1턴 예고 해골 소환(최대 2), 해골 시종 HP 15·피해 4.
- M16 펜마르시 알지기 마녀(HP 55): 피해 6, 별도 예고 없는 알 소환(최대 2), 부화 가속 +1.
- 진흙 알 HP 10은 2턴 뒤 늪지 부화체(HP 18·피해 5)로 부화하며, HP 50% 이하 피해는 한 번만 부화를 지연한다.
- 마스터만 2·3막의 선택적 늦은 조우 후보이며, 해골·알·부화체는 일반 조우 시작 적이 아니다.

## 자동 검증

`pnpm release:verify` 최종 실행은 exit 0으로 완료했다.

| 게이트 | 결과 | 증거 |
| --- | --- | --- |
| typecheck | PASS | core/content/ui/sim 4개 워크스페이스 |
| lint | PASS | ESLint 오류 0 |
| test | PASS | `release:verify` 당시 87 files / 815 tests, 최종 슬롯 상한 회귀 추가 후 87 files / 816 tests |
| ci:sim | PASS | 500/500 terminal, crash 0, invariant 0, seed 42 golden 동일 |
| build | PASS | core/content/ui/sim production build |
| feedback regression | PASS | UI feedback regression harness |
| content | PASS | 콘텐츠 전체 테스트와 D16 계약 2/2 |
| assets | PASS | provenance gate |
| perf | PASS | 4차원 번들 예산과 브라우저 성능 gate |
| a11y | PASS | contrast/accessibility gate |
| mobile | PASS | 실제 브라우저 playtest 전체 항목 |

집중 회귀는 `packages/core/src/combat/directive16-summon-lifecycle.test.ts` 12/12, `packages/content/src/directive16-monsters.test.ts` 2/2, `apps/ui/src/directive16-ui.test.ts` 3/3으로 총 17/17을 통과했다. 전체 `release:verify` 통과 뒤 시작 적 4체 이상 거부 계약을 추가했으며, 최종 트리에서 `typecheck`, `lint`, `test`를 다시 실행해 87 files / 816 tests 통과를 확인했다. 독립 코드 리뷰는 최초에 M15 windup의 잘못된 1체 제한과 부화 시 보호 연결 손실을 HIGH로 발견했고, 두 회귀를 보강해 수정한 뒤 최종 `APPROVE`를 받았다.

## 시뮬레이션 귀속

| 지표 | Directive 15 기준 | Directive 16 | 변화 |
| --- | ---: | ---: | ---: |
| terminal runs | 500/500 | 500/500 | 0 |
| completed combats | 786/2500 (31.44%) | 786/2500 (31.44%) | 0 |
| overall mean turns | 10.1743002545 | 10.1743002545 | 0 |
| crash / invariant | 0 / 0 | 0 / 0 | 0 / 0 |
| seed 42 golden | 동일 | 동일 | 0 |

`ci:sim`의 적별 귀속에는 M15/M16이 나타나지 않았다. 현재 정책 표본이 두 마스터가 추가된 2·3막 선택 풀에 도달하지 않았으므로, 위 무변화는 밸런스 승인 근거가 아니라 **비노출 회귀 안정성** 증거다.

## 번들 4차원 예산

| 차원 | Directive 15 | Directive 16 | 변화 | 예산 | 잔여 |
| --- | ---: | ---: | ---: | ---: | ---: |
| total | 3,119,465 B | 3,126,914 B | +7,449 B | 3,213,312 B | 86,398 B |
| JS | 571,470 B | 578,919 B | +7,449 B | 589,824 B | 10,905 B |
| CSS | 86,689 B | 86,689 B | 0 B | 90,112 B | 3,423 B |
| max file | 651,044 B | 651,044 B | 0 B | 716,800 B | 65,756 B |

Fable의 잔여 하한 JS 10 KiB와 CSS 2 KiB를 각각 665 B, 1,375 B 여유로 충족한다.

성능 재측정은 TTI 중앙값 276 ms, LCP 중앙값 348 ms, 최악 CLS 0.000482, 200 ms 초과 long task 0으로 차단 계약을 통과했다. 명령 왕복 중앙값 2,100 ms는 현재 비차단 관측 항목(`withinBudget.commandRoundtrip=false`)으로 별도 기록하며 D16 승인 근거로 숨기지 않는다.

## 모바일 상한 정렬

D16은 라이브 적 상한을 소환자를 포함해 3으로 고정한다. 기존 P13 모바일 회귀의 테스트 전용 4·5적 URL은 이 계약과 충돌해 전투 부팅 타임아웃을 만들었으므로 제거했다. 3적 레이아웃은 1024×720, 1280×720, 1440×900, 1600×900, 1920×1080에서 적판·의도·손패·턴 버튼의 화면 내 배치, 비중첩, 콘솔 오류 0을 확인했다.

## 남은 사람 검증

- 마스터 조우 빈도와 HP·피해 수치는 사람 플레이 데이터 전까지 조정 가능하다.
- Fable Option B는 전투 슬롯 계약을 정한 설계 판정일 뿐, 사람 플레이테스트나 밸런스 확정을 대체하지 않는다.
- 기존 SSR 회귀에서 `useLayoutEffect` 경고가 출력되지만 테스트 실패나 신규 런타임 오류는 아니다.
