# P13 구현 계획 — 2026-07-16 설계 개정 캠페인

> 설계 정본: [`P13_REVISION_DESIGN_SYNC.md`](./P13_REVISION_DESIGN_SYNC.md)
> 실행 체계: Fable(요구사항·인터페이스·경계·리뷰·게이트) → Pumasi → Codex 워커(프로덕션 코드·테스트)
> 로컬 구현·검증 전용. push / deploy / PR 없음. `.superpowers/` 접근 금지.

## 0. 사전 상태 기록

- 작업 트리에 ~101개 파일의 순수 CRLF/LF 정규화 변경(+34014/-34014)이 캠페인 시작 전부터 존재한다. 본 캠페인 변경과 구분해 취급하고, 커밋 요청이 없는 한 스테이징하지 않는다.
- 언트래킹: `.claude/`, `.omc/`, `.omx/`, `.superpowers/`(사용자 소유, 불가침).

## 1. 웨이브 시퀀싱과 파일 소유권

원칙: 같은 파일을 같은 웨이브의 두 워커가 만지지 않는다. `packages/content/src/index.ts`, `apps/ui/src/App.tsx`, `packages/core/src/combat/resolve/flip.ts`는 충돌 다발 파일이므로 웨이브당 단일 소유자.

### Wave 0 — 회귀 잠금 (W0)

리스크 리팩터 전 기존 행동 고정. 커버리지가 없는 곳만 추가.

- **W0a** (소유: `packages/core/src/combat/*.test.ts` 신규 파일만): 현행 르미즈 재플립 시퀀스, 과열 진입/소비, arcanist 방어 참조 3원자(`damagePerBlock`/`blockFromCurrent`/`damagePlusBlock`)의 현행 수치 계약을 잠그는 특성 테스트. 이 테스트들은 웨이브 3~5에서 새 계약 테스트로 **의도적으로 교체**된다(교체 시 사유 명기).
- 게이트 G0: `pnpm test` 통과 + 신규 테스트가 현행 동작을 실제로 고정함을 리뷰로 확인.

### Wave 1 — 독립 표면 4건 병렬 (P1·P2·P3 + 시뮬)

| 워커 | 소유 파일 | 작업 |
|---|---|---|
| **W1a 보상 코어** | `packages/core/src/run/run.ts`, `packages/core/src/run/run.test.ts`, `packages/core/src/run/p43-verification.test.ts`, `packages/core/src/run/p44-verification.test.ts`, `packages/core/src/run/weighted-rewards.test.ts` | 가중 후보 `weightedCoinOptions` 재작성(대표4/기본3/보유2/미보유1, 가중 비복원 3개 추출, 기존 RNG 스트림). `isCoinEligibleForCharacter`는 **삭제하지 않고** 신정책 시맨틱(정의된 모든 동전 적격)으로 유지 — `apps/ui/src/run-storage.ts`가 임포트하므로 시그니처 불변(W1d가 후속 적응). 결정론·경계·가중 분포 테스트. |
| **W1b 콘텐츠 표기** | `packages/content/src/index.ts`, `packages/content/src/content.test.ts`, + 표시명 문자열 기대값 갱신 한정: `packages/core/src/combat/combat.test.ts`, `packages/core/src/combat/preview.test.ts`, `apps/ui/src/coin-choice.test.ts`, `apps/ui/src/action-feedback.test.ts`, `apps/ui/src/interaction.test.ts`, `apps/ui/src/resolution-summary.test.ts`, `apps/ui/src/telemetry.test.ts`, `tools/sim/src/bulk/bulk.test.ts`, `tools/sim/src/human/human.test.ts`, `tools/sim/src/human/cli.test.ts` | P1 표시명(베기→공격, 정권→공격, 가드→방어) + 강화명(단련된 베기→단련된 공격, 묵직한 정권→묵직한 공격, 철벽 가드→철벽 방어) + `fire-flurry`→홍련 선풍각, `burnout-blow`→업화폭권 이름 선반영(수치 불변). ID·수치 불변 확인 테스트. `packages/core/src/run/run.test.ts`의 표시명 문자열은 W1a 소유(동일 파일 이중 소유 금지). |
| **W1c 상점 UI** | `apps/ui/src/shop-screen.tsx`, `apps/ui/src/App.tsx`, `apps/ui/src/shop-*.test.ts`(신규), `apps/ui/src/overlay-position.ts`(필요 시) | 상점·엘리트 보상·슬롯 교체 카드에 `CardEffectRows`+`Keyword` 툴팁 재사용. hover/focus/터치 3경로. 단위/컴포넌트 테스트까지만 — 브라우저 어서션은 W2a(G2). |
| **W1d 저장 호환** | `apps/ui/src/run-storage.ts`, `apps/ui/src/run-storage.test.ts`, `apps/ui/src/run-storage.p43-verification.test.ts`, `apps/ui/src/run-storage.p44-verification.test.ts`, `apps/ui/src/run-storage.p44-verify-worker.test.ts`, `apps/ui/src/run-storage.p54-recovery.test.ts` | 확정 전 pending 보상/상점 offer의 stored-offer 수용 경로(재도출 불일치 시 legacy로 표시하고 수용) + `isCoinEligibleForCharacter` 의존을 신정책에 맞게 적응. **하드 순서 W1a→W1d.** v9는 Wave 5에서. |
| **W1e 시뮬 정책** | `tools/sim/src/run-sim.ts`, `tools/sim/src/*.test.ts` | `M6_BUILD_POLICIES` 동전 우선순위를 전속성 개방에 맞게 재검토·갱신. |

- 순서 제약: W1c는 W1b의 표시명 변경과 독립(효과 행은 데이터 생성). W1d는 W1a 완료 후 시작(하드 순서).
- 게이트 G1: typecheck/lint/test/check:content + `ci:sim` 골든 재앵커 1차(사유: 보상 풀 개방).

### Wave 2 — 전투 레이아웃 (P4)

| 워커 | 소유 파일 | 작업 |
|---|---|---|
| **W2a 레이아웃** | `apps/ui/src/App.css`, `apps/ui/src/App.tsx`(단독 소유권 이번 웨이브로 이동), `apps/ui/scripts/playtest.mjs` | `.enemy-line` 유동 폭+압축 플레이트/랩 재작업. `encounter=` 파라미터에 `quad-*`/`quint-*` 테스트 조우 추가(라이브 풀 불변). playtest에 5해상도×3/4/5적 스크린샷+비겹침 DOM 어서션 시나리오 추가. |

- 게이트 G2: 15개 매트릭스 전부 통과 스크린샷 증거 + 상점 스킬 설명 브라우저 DOM 어서션(W1c 산출물 대상) + `check:a11y`/`check:perf` 유지.

### Wave 3 — 르미즈 스택형 (P5-1)

| 워커 | 소유 파일 | 작업 |
|---|---|---|
| **W3a 코어 르미즈** | `packages/core/src/combat/resolve/flip.ts`, `packages/core/src/combat/state.ts`, `packages/core/src/combat/events.ts`, `packages/core/src/combat/reducer.ts`, `packages/core/src/combat/preview.ts`, `packages/core/src/combat/p9-remise-routing.test.ts`(교체), 신규 `packages/core/src/combat/remise-stack.test.ts` | 첫 코인 재플립 모델 제거 → 스택형(최대3, 턴시작+1, 턴종료 소멸, 공격 태그 원본만 소비, 플립 전 확정 소비, 앞면 시 가상 사본 전체 반복, 반복 재반복 금지, 드로우/생성/회수/덱 이동·스택 생성/반환 원본 전용, 반복 트리거 라벨 예외). `remiseChecked/remiseReflipped/remiseReused` 이벤트 → 스택 모델 이벤트로 개정. 수용 수학(E[반복]=1.5, P0=P3=12.5%, max36) 확률 열거 테스트. `flip` 스트림만 소비(스트림 격리 회귀 유지). |
| **W3b 콘텐츠 소서러** | `packages/content/src/index.ts`, `packages/content/src/content.test.ts` | 팡트/레두블망/플레슈/아타크 콩포제 개정 + 패시브 3종(`retrieval-habit`/`continuous-motion`/`overcurrent`) 반복 트리거 재작성(P13 §7 표·패시브 처분표), remise config 스키마 갱신 반영. |
| **W3c UI 르미즈** | `apps/ui/src/App.tsx`, `apps/ui/src/turn-resource-summary.ts`, 관련 테스트 | 스택 카운터, 소비 예정 스킬 하이라이트, 성공/실패 로그·VFX. |

- 순서: W3a → (W3b, W3c 병렬). 콘텐츠·UI는 코어 계약 확정 후.
- 게이트 G3: 수용 수학 테스트 + 리플레이 결정론 + 골든 재앵커(사유: 르미즈 모델 교체).

### Wave 4 — 화염 격투가 + 마도기사 (P5-2·P5-3)

| 워커 | 소유 파일 | 작업 |
|---|---|---|
| **W4a 코어 과열·반향** | `packages/core/src/combat/resolve/flip.ts`, `packages/core/src/combat/resolve/consume.ts`, `packages/core/src/combat/state.ts`, `packages/core/src/combat/events.ts`, `packages/core/src/combat/reducer.ts`, `packages/core/src/combat/enemy.ts`(흡수 추적), 신규 테스트 | `pendingOverheat`(턴 시작 전환, 중첩 없음, 전투 한정) + `잔열 축적` 기믹 훅. 갑주 반향: 적 턴 흡수 추적 → 턴 종료 계산(min(흡수,6)+예열+정밀, 최대12) → 다음 플레이어 턴 유지 → 증폭 턴당 1회. 신규 원자: `echoPreheat`, `precisionDefense`, `damagePlusEcho`, `aoeDamagePlusEcho`. "방어 직접 소모 금지" 불변식 테스트. |
| **W4b 콘텐츠 워리어·아케이니스트** | `packages/content/src/index.ts`, `packages/content/src/content.test.ts` | P13 §8·§9 표 반영: 화격권 예약, 잔열 축적(ID `flame-opening` 유지), 잿불 갑주, 방패 숙련, 빈틈없는 대비, 갑주 축압/마력 증폭막/갑주 강타/마도 갑주 해방, **보상 은퇴 3종 `aegis-pulse`·`mirror-plate`·`bulwark-charge`**. arcanist 전 스킬·패시브 block→damage 감사(반향 외 다리 금지). |
| **W4c UI 상태 표시** | `apps/ui/src/App.tsx`, `turn-buff.tsx`, `keywords.tsx`(용어 추가), 관련 테스트 | 과열 예약 배지, 반향 수치·증폭 가용·정밀 조건 프리뷰(적 의도 피해 대비 예상 잔여 방어 포함). |

- 순서: W4a → (W4b, W4c). 게이트 G4: 계약 테스트 + 골든 재앵커(사유: 두 캐릭터 개정).

### Wave 5 — 몬스터 배치 A + 수호자 삭제 (P5-4·P6)

| 워커 | 소유 파일 | 작업 |
|---|---|---|
| **W5a 코어 적 원자** | `packages/core/src/combat/enemy.ts`, `packages/core/src/content-types.ts`, `packages/core/src/combat/state.ts`, `packages/core/src/combat/events.ts`, 신규 테스트 | 예고(카운트다운·공개 시 대상 바인딩·취소/약화 조건), 준비 중 취약(피해 배수), 플레이어 HP 조건 분기, HP 분기점 페이즈(의도 테이블 전환), 성장 스택(실피해 시 +, 완전 방어 시 −), 아군 대상 치유 의도(표시 대상 사망 시 실패). 전부 의도 수준 — `enemyTurnStart` 패시브 자기 대상 벽 유지. |
| **W5b 콘텐츠 몬스터** | `packages/content/src/index.ts`, `packages/content/src/content.test.ts`, `packages/core/src/run/graph.ts` | M-01~04·07·13 정의 + 2·3막 풀 편입(라이브 최대 3적 유지). 검증기에 신규 원자 규칙 추가는 W5a와 협의된 계약으로. |
| **W5c 수호자 삭제** | `packages/content/src/index.ts`(W5b 완료 후 순차), `apps/ui/src/App.tsx`, `character-select.tsx`, `run-storage.ts`(+v9), `run-menu.tsx`, `tools/sim/src/*`, 관련 테스트, `apps/ui/src/assets/generated/sprites/guardian/` 삭제 | 캐릭터+전용 스킬 5종+스프라이트 레지스트리/에셋+시뮬 정책 제거. RUN_SAVE_VERSION 9: 비수호자 무손실, 수호자 → `retired-character` 안내+격리 보존, 크래시 금지. contentVersion `1.7.0-revision`. |
| **W5d 적 UI** | `apps/ui/src/App.tsx`(W5c 후 순차), 관련 테스트 | 카운트다운·취소 조건·페이즈·성장 스택 의도 배지 확장. |

이번 캠페인에 구현하는 몬스터 슬라이스는 **배치 A(M-01·02·03·04·07·13)뿐**이다. 배치 B(M-11·12·14 — 중독·치유 차단·턴 종료 응징 원자), C(M-05·06·08 — 보호 재지정·감쇄 임계·오라·사망 정리), D(M-09·10·17·18 — 압수·봉인·위조·속성세), E(M-15·16 — 적측 소환), F(M-19·20 — 보스 페이즈 복합)는 착수하지 않으며, 각 배치의 진입 조건은 P13 설계 정본 §6.4 표를 따른다(배치 A 골든 안정 / 다중 적 UX 플레이테스트 / 동전 UI 계약 승인 / 사망 정리 훅 완성 / 배치 D 완료 순).

- 순서: W5a → W5b → (W5c, W5d 순차 — 둘 다 App.tsx/index.ts 접촉). 게이트 G5: check:content(수호자 잔재 0, 신규 원자 검증) + 저장 v1~v9 마이그레이션 왕복 테스트 + 골든 재앵커(사유: 로스터·조우 변경).

### Wave 6 — 스프라이트 (P5b, 코드 웨이브와 병행 가능)

Fable 직접 수행(스킬 페어 플로우, Codex 위임 아님):

1. `warrior`: 기존 런 QA 계약 재검증(`check:assets` + qa-notes 확인)만. 통과 시 유지 판정 기록.
2. `sorcerer`, `arcanist`: `/image-prompt` 컴파일 + `check_prompt.mjs` 검증 → `/sprite-gen` component-row 전체(Base Lock Gate → idle/attack/hurt 행 → 크로마 추출 → 아틀라스 → manifest → QA 프리뷰 → 모션 리뷰 → qa-notes → 큐레이션 뷰 보고). 셀 256px·시트 1024×768·기존 런타임 계약 유지(코드 변경 불필요, 에셋 교체만).
3. 게이트 G6: `check:assets` + QA 프리뷰·모션 리뷰 증거 + 큐레이션 핸드오프. 정적 이미지/원시 행은 완료 아님.

### Wave 7 — 문서 동기화 + 최종 검증

- Fable 직접: P13 §13 문서 목록 갱신(docs/PRD.md v2.1 포함), PROGRESS/README 색인.
- 최종 게이트 GF: `pnpm release:verify` 전체 + 브라우저 증거(5해상도×3/4/5적, 상점 설명, 수호자 부재·구저장 안내) + 변경/유지/이유/위험 표 최신화 + 잔여 위험 보고. push/PR 없음.

## 2. 워커 브리프 공통 계약

- 구현 본문을 브리프에 붙여넣지 않는다. P13 설계 정본 절 번호+파일 경계+수용 테스트 계약만 전달한다.
- 소유 파일 밖 수정 금지. 공유 타입 변경이 필요하면 중단하고 보고.
- 신규 의존성 금지. 기존 `EffectAtom`·콘텐츠 패턴 우선(content-design-guide §1).
- 각 워커 완료 조건: 소유 범위의 typecheck+lint+관련 테스트 통과 로그 제출. 골든 재앵커는 워커가 하지 않고 Fable 승인 후 별도 커밋 단위로.
- 결함 발견 시 Fable이 직접 수정하지 않고 해당 워커(또는 후속 워커)에 재위임한다.

## 3. 저장·마이그레이션 전략

| 항목 | 내용 |
|---|---|
| RUN_SAVE_VERSION | 8 → 9 (Wave 5 단일 상향) |
| v9 마이그레이션 | 비수호자: 무손실 통과(패딩·필드 불변). 수호자: `retired-character` 분류, 원문 격리 키 보존, UI 안내+새 런 유도, 크래시 금지 |
| contentVersion | `1.6.0-blood` → `1.7.0-revision`, 저장 게이트 허용 목록 갱신 |
| pending offers | 구정책 offer는 stored-offer 수용(legacy 표시). 재도출 검증은 신정책 저장에만 적용 |
| 왕복 테스트 | v1~v9 순차 마이그레이션 왕복 + 손상/미래 버전 격리 회귀 유지 |

## 4. 테스트 계획 요약

- Wave 0 특성 테스트로 현행 잠금 → 각 웨이브에서 새 계약 테스트로 교체(사유 명기).
- 신규 고정 대상: 르미즈 수용 수학(확률 열거), 반향 상한·증폭 배타성·과방어 무보상, 과열 예약 타이밍·비중첩, 보상 가중 분포(결정론+가중 비율 속성 테스트), 몬스터 예고·페이즈·성장 계약, v9 마이그레이션, RNG 스트림 격리 회귀.
- 브라우저(Playwright): 레이아웃 매트릭스 15케이스, 상점 설명 3경로, 수호자 부재, 구저장 안내. 스크린샷+DOM 어서션 병행(단위 테스트만으로 대체 금지).

## 5. 게이트 정의

| 게이트 | 통과 조건 |
|---|---|
| G-DOC (문서 게이트) | P13 설계·계획 상호 모순 0건 — 통과 전 구현 착수 금지 |
| G0~G5 | 각 웨이브 절 참조. 공통: typecheck+lint+test+check:content, 골든 재앵커는 사유 명기 승인제 |
| G6 | 스프라이트 QA 계약(§1 Wave 6) |
| GF | `release:verify` 전체 + 브라우저 증거 + 문서 무모순 + 잔여 위험 보고 |

## 6. 리스크와 롤백

| 위험 | 완화 |
|---|---|
| 르미즈 모델 교체가 기존 소서러 저장·리플레이 시뮬과 충돌 | 전투는 시드 재구성이라 저장 영향 없음. human replay 트레이스는 콘텐츠 버전 게이트로 구분. 골든 재앵커 사유 기록 |
| App.tsx 대형 파일 순차 소유로 웨이브 지연 | 웨이브 내 순차 배치(W5c→W5d)로 충돌 제거. 지연 시 웨이브 분할 |
| 보상 개방으로 밸런스 스윕 악화 | balance-provisional 유지, `sim:balance` 리포트 전후 비교를 증거로 첨부(측정으로만 서술) |
| 반향 시스템 복잡도(흡수 추적) | 코어 계약 테스트 선행(W4a 단독 웨이브 반), UI는 계약 확정 후 |
| 스프라이트 재생성 실패/품질 미달 | Base Lock Gate 불통과 시 반복, 최종 미달 시 기존 에셋 유지+임시 상태 명시(조용한 대체 금지 원칙) |
| 골든 잦은 재앵커로 회귀 신호 소실 | 웨이브당 1회, 사유 없는 diff 금지, 재앵커 전 비의도 변화 검토 |
