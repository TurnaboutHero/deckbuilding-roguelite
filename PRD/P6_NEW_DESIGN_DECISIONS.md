# P6 신규 기획 GAP AUDIT + 결정 로그

> 출처: 사용자 제공 4개 과거 대화(참고 요구사항 A~F). 기준: HEAD 97e4e78, 1.0.0-rc.1.
> 규약: 질문 없이 합리 결정 + 근거 기록. 추측/설계 보충은 전부 이 문서에 남긴다.
> 상태 어휘: engineering-safe / balance-provisional / experience-unverified.
> 구현 순서: P6.1 런 구조 → P6.2 패시브·강화 → P6.3 화염 격투가 → P6.4 마도기사 → P6.5 UI → P6.6 자산 → P6.7 검증·배포.

## D1. 런 진행 구조 (요구 A)

| 항목 | 내용 |
|---|---|
| 요구 출처 | A — StS식 노드 선택, 최대 3막×방문 10회(1~8 분기 후보, 9 휴식 고정, 10 보스 고정), 후보 분포 전투50/엘리트10/보물2/상점15/휴식3/이벤트20% |
| 현재 상태 | 단일 10-layer `RunGraph{layers}`, 분기 레이어는 정확히 2노드(`chooseRunNode`가 length===2 강제), rest/treasure 없음, 보스 1(잿불 마도왕) |
| 모호성/충돌 | ① 후보 노드 수 미명시 ② 막별 난이도/보스 미명시 ③ 기존 이벤트 노드 의미론(레이어 자체가 event)과 "분기 후보 중 하나" 충돌 없음(후보로 일반화) ④ 기존 단일 런과 완전 충돌 |
| 채택 결정 | **RunGraph를 평탄 layers + `acts: {start:number}[]` 메타로 일반화** (전 코드가 `layers[combatIndex]` 평탄 인덱스 — 최소 변경). 분기 방문은 **후보 2~3개**(그래프 스트림 롤, 2:60%/3:40%). `chooseRunNode` length>=2로 일반화. 방문9=rest 고정, 방문10=boss 고정. 가드레일(설계 보충): **1막 방문1은 combat 강제**(학습·초기 경제), **1막 방문1~2 후보에서 elite 제외**(조기 스파이크 방지), 후보 내 kind 중복 허용(중복 시 각자 독립 롤 결과 유지) |
| 후보 분포 | 생성 분포 50/10/2/15/3/20 — **후보 생성 분포이며 실제 방문 분포와 구분** (문서·economy 텔레메트리에 generatedKindCounts/visitedKindCounts 분리 기록) |
| 막별 스케일링 | 적 재사용 + 결정론 수치 변형: **hp·피해 ×(1 + 0.4×(act-1))** 반올림 (act1 ×1.0 / act2 ×1.4 / act3 ×1.8). `scaleEnemyForAct` 순수 함수, createCombat config로 전달. balance-provisional |
| 막 보스 | act1=**gatekeeper-plus**(단일 승격) / act2=**raider-plus+gatekeeper-plus**(2체) / act3=**ember-archmage**. 전부 보스 보상 의미론(재화100+동전3택+패시브3택). 재사용 결정 근거: 신규 보스 아트/패턴 비용 통제(요구 A "재사용+막별 수치/패턴 변형"). balance-provisional |
| 노드 보상 | 일반=금35+동전3중1택 / 엘리트=금70+동전3택+**스킬 1 제안**(교체/스킵) / 보물=금100+패시브 1 부여 / 보스=금100+동전3택+패시브 3중1택. **기존 보상 흐름(3전투째부터 스킬 2택+제거 단계)은 신규 스펙으로 대체** — 제거는 상점 전용으로 회귀(요구 A 명시 우선). seed42 골든 재고정 필요 |
| 휴식 | 최대HP 30% 회복(내림, 상한 maxHp) **또는** 장착 스킬 강화 1회(D3) 택1 |
| 세이브 | **v6**: acts, acquiredPassives, upgradedSlots, pendingRest/pendingTreasure, 카운터(treasureOpened/restHeals/restUpgrades/passivesPurchased/passivesFromBoss/passivesFromTreasure). **v5→v6 마이그레이션: 기존 graph를 단일 레거시 막(acts=[{start:0}])으로 감싸 진행 중 런 보존**, 신규 필드 기본값. v1→…→v6 체인 유지 |
| 결정론 | 그래프: `derive(runSeed,'graph')` 단일 스트림 유지(막·방문 순서 소비 고정). 상점/이벤트/보상 스트림 기존 규칙(`shop-<layer>`/`event-<layer>`/`reward`) 유지. 보물/보스 패시브: `passive-<layer>` 신규 스트림 |
| 검증 | 그래프 결정론(동일 시드 동일 그래프), 고정 시드 골든, **후보 분포 통계 테스트(N=2000 롤, 허용오차 ±3%p)**, 9/10 고정 검증, act 전환, v5→v6 라운드트립 |
| 상태 | engineering-safe / balance-provisional / experience-unverified |

## D2. 패시브 획득 기반 (요구 B)

- 현재: `CharacterDef.trait` = 시작 고유 특성(innate) 1개(combatStart 훅)뿐. 획득 개념 없음.
- 결정: `ContentDb.passives: Record<string, PassiveDef>` 신설. `PassiveDef { id, name, description(한 줄), exclusiveTo?, element: Element|null, hook: 'combatStart'|'turnStart', effects: EffectAtom[], price }`. **innate(trait)와 획득(passives)은 데이터·표시 모두 구분** (UI: 고유 특성 vs 획득 패시브 목록).
- 중복 규칙: **획득 패시브는 런당 1회(중복 불가)** — 제안 풀에서 보유분 제외(rewardEligibleSkillIds와 동형 술어 `eligiblePassiveIds`).
- 출처: 보물(1개 결정론 부여), 보스(3중1택, 스킵 가능), 상점(1슬롯 진열, price 골드).
- 전투 적용: createCombat에서 trait에 이어 acquiredPassives 순서대로 combatStart 발동; turnStart 훅은 startPlayerTurn에서 매 턴 발동. 이벤트 `passiveTriggered` 추가.
- 텔레메트리/휴먼 트레이스: 경로 사실 추가(treasure-open, boss-passive-choice, shop-passive-buy) — schema v2에 **가산 v3** (기존 v2 필수 사실은 불변, v1 거부 유지).
- 상태: engineering-safe / balance-provisional.

## D3. 스킬 강화 (요구 B)

- 결정 데이터 모델: `SkillDef.upgrade?: SkillUpgradeDef` — **스킬당 정의된 강화 1종, 런당 스킬 1회 강화**. `SkillUpgradeDef { name, description, patch }`; patch는 선언적: `{ kind:'baseAmount', index, delta } | { kind:'addFaceEffect', face:'heads'|'tails', effect } | { kind:'addCoinOnUse', coin, zone, count } | { kind:'costDelta', delta } | { kind:'removeOncePerCombat' }` (요구 5종 그대로).
- 적용: 순수 `deriveUpgradedSkill(def)` — startRunCombat이 **강화 오버레이 db**(같은 ID에 파생 def 치환)를 combat에 전달. 전투 내부/리플레이 무변경(강화 플래그가 세이브에 있으므로 결정론).
- 런 상태: `upgradedSlots: boolean[6]` (장착 슬롯 대응, 교체 시 해당 슬롯 false 리셋). 같은 스킬 재획득/교체 표기는 슬롯 기준이라 자연 해소.
- 휴식 UI: 회복 vs 강화 택1; 강화 불가(이미 강화됨/강화 미정의) 슬롯은 비활성+사유 툴팁.
- 패시브는 강화 대상 제외(요구 B 명시).
- 상태: engineering-safe / balance-provisional.

## D4. 코인/상태 원칙 유지 (요구 B)

기본/속성 2계열, 소비=화염(각 캐릭터 대표 속성) 코인만, 버림/제거 규칙, 화상/동상/감전/방어 의미 불변. **약화/취약·특수 코인 재도입 금지 확인** — P6 신규 콘텐츠 lint: applyStatus는 확정 4어휘만(기존 validateContentDb가 이미 StatusId로 강제).

## D5. 화염 전사 → 화염 격투가 (요구 C)

| 항목 | 결정 |
|---|---|
| ID 전략 | **character id 'warrior' 유지 + 표시명 '화염 격투가'**(이름 여울). 시작 기본기 3종은 **신규 격투 전용 ID 추가**(jab/fist-guard/burning-fist — exclusiveTo warrior) 후 startingSkills 교체. 기존 slash/guard/burning-strike는 **공용 defs로 존치**(타 캐릭터 시작 셋·구 세이브 참조 유효). 근거: ID 마이그레이션은 세이브·리플레이·골든 전방위 위험, 콘텐츠 가산이 최안전. seed42 골든은 시작 셋 변경으로 재고정(버전 승격 결속) |
| 검술 명칭 전환 | ID 불변·표시/설명만: ignite-sword '점화 검술'→'점화권', flame-sword '화염검'→'화염 붕대'(화상 트리거 유지), 여타 검술 문구 감사 후 격투 문구화 |
| 화상 빌드 계산식 | 유지: 임시 화염 코인 생성→화상 누적→**화상 수치 참조 폭발(화상 비소비)**. 신규 원자 `{ kind:'damagePerTargetBurn', amountPerStack }` (대상 화상 스택×N 추가 피해, 스택 불변) |
| 스킬 셋 | 시작3: jab(정권, slash 동수치)/fist-guard(가드, guard 동수치)/burning-fist(불꽃 스트레이트, burning-strike 동수치 — 동수치 시작으로 밸런스 중립) + 일반 플립 공격 flame-hook(불꽃 훅) + 일반 플립 방어 ember-weave(잿불 위빙) + 고급 일회성 지원 second-wind(들숨 고르기: 임시 화염 3 생성+방어) + 고급 광역 플립 fire-flurry(회전 연화각, all-enemies) + 희귀 소비 마무리 burnout-blow(폭렬권: 화염 소비+damagePerTargetBurn). 전 스킬 upgrade 정의 포함 |
| 전용 패시브 8 | 무속성 5(방어/생존: 전투 시작 방어, 턴 시작 방어, 전투 시작 회복, 첫 피격 경감형은 원자 부재로 대체 설계 — 세부는 콘텐츠 커밋에 기록) + 화염 3(화상 보조: 시작 화염 코인, 화염 소비 시 보너스류는 기존 훅 범위 내) — 한 줄 설명·고정 수치·횟수 제한 |
| 보조 아키타입 | **과열(Overheat) 채택**: 손의 화염 코인 수 참조(`damagePerFireInHand` 원자) — 신규 지속 상태 없음·직관 계산식·금지 목록(연속 타격/반격/코인 재사용/방어 활용/체력 희생/타속성) 저촉 없음. 최소 패키지: 스킬 2(고급 플립 overheat-strike, 희귀 overheat-vent) + 패시브 1. **화염 태세/화염 집중은 후속 백로그**(지속 스택 상태 필요 — 소환 엔진과 별개의 신규 상태 계층이라 이번 범위 제외 근거 기록) |
| 상태 | engineering-safe / balance-provisional / experience-unverified(격투 손맛) |

## D6. 마도기사 (요구 D)

| 항목 | 결정 |
|---|---|
| 충돌 감사 | guardian(수호자)=마나+방어 정체성 기보유. **별도 신규 캐릭터 `arcanist`(마도기사) 추가** — guardian 빌드/세이브 무변경(기존 빌드 보존 우선 요구). 마나 속성 공유 첫 사례(대표 속성 유도·가중 보상 로직은 캐릭터별이라 안전) |
| 고유 패시브 | trait '마도 공방': **hook 'turnStart'** — 매 턴 마나 검 1개(지속 1) 소환. trait에 turnStart 훅 신설(획득 패시브 D2와 공유) |
| 소환 엔진 | `CombatState.summons: SummonState[]`(최대 3) `{ uid, defId, duration, enhance }`. **명시 규칙**: 적 공격 대상 제외(타깃 로직 무변경 — 소환은 유닛 아님·슬롯 위젯) / 플레이어 턴 종료 시 **슬롯 순서(선입선출 순)** 자동 행동 → 지속 1 감소 → 0 소멸 / 동일 장비 중첩 허용(독립 슬롯) / **슬롯 초과 시 가장 오래된 소환 교체**(uid 최소) / 행동 대상: 살아있는 최소 인덱스 적, 사망 시 다음 인덱스 재타깃, 전멸 시 무시 / 전투 종료 시 전체 소멸(비영속·세이브 안 함 — 전투는 원래 저장 대상 아님) / 이벤트 summonAdded/summonActed/summonExpired/summonReplaced로 리플레이 결정론 |
| 장비 | `ContentDb.equipment`: mana-sword(턴 종료 단일 적 피해 3), mana-shield(턴 종료 방어 2) |
| 시작 스킬 | slash/guard 공유 + '마력 충전'(flip cost 2, 선택 장비 지속2 소환, 뒷면당 지속+1, 임시 마나 코인 1 생성) + '명령'(flip cost 1, 선택 장비 즉시 행동+지속-1, 뒷면당 장비 효과+1, 버림 더미 임시 마나 1) + 마력 갑주 기초 '완충 방벽'(현재 방어 참조 피해 — `damagePerBlock` 원자, 방어 비소모) + 병기 기초 '방패 소환'(마나 방패 소환). 사용자 텍스트의 코스트 모호 → 현 5코인/3스킬 규칙·시뮬 스모크로 조정, 수치 balance-provisional |
| 두 빌드 | 마력 갑주(방어 참조/복제/피해화 — damagePerBlock·blockAmplify류, **방어 소모 없음**) / 마나 병기(소환 지속·효과 강화, 명령 시너지). 각 빌드 스킬 2~3+패시브 1~2를 보상 풀(exclusiveTo arcanist)에 배치. '반격' 어휘 사용 금지(화염 보조 제약과 혼동 방지 — shield-reprisal(기존 수호자 '응보')와도 구분 서술) |
| 상태 | engineering-safe / balance-provisional / experience-unverified |

## D7. UI/시각 (요구 E)

- 3막 지도: choose-node 화면 확장 — 막 진행 바(방문 1~10)·후보 카드(kind 아이콘+미리보기 한 줄)·현 위치. 390×844 우선, 스크롤 없는 후보 rail, 픽셀 톤(기존 팔레트·경계) 계승, 강한 모션은 보상/위험 변화만+reduced-motion.
- 휴식/보물/보스 패시브 선택/패시브 목록(RunMeta 확장)/강화 배지(+)/소환 3슬롯(플레이어 옆 세로 스택) — 전장 가림 금지.
- 스프라이트: 화염 격투가(성인 여성, 붉은 단발 톰보이, 짙은 태닝, 우측 실루엣, 불꽃 건틀릿/붕대, 노출 절제)·마도기사(성인, 검은 장발, 푸른 계열 아카데미 학생복, 소환 병기, 성적 과장 배제) — 킷 검증→base lock→component-row→모션 QA→provenance. 카드/노드 아이콘은 기존 SVG 아이콘 언어로 코드 구현 우선, 필요 시 생성.
- 상태: engineering-safe / experience-unverified(시각 취향).

## D8. 검증/완료 계약 (요구 F)

- 심 상태 SSoT 유지(렌더러 비저장) — 소환도 CombatState만.
- 신규 규칙별 단위/통합/결정론/세이브 마이그레이션 테스트, 후보 분포 통계+골든, act 전환/고정 노드/보상/패시브/강화/소환 순서 테스트.
- 밸런스 심: 화염(화상/과열)·마나(갑주/병기) 빌드별 접근성/클리어/피해/생존/선택률 비교 리포트(report-only).
- 전 게이트 + 데스크톱·390×844 실플레이 스크린샷 증거 + push/CI/Deploy exact SHA/live smoke.

## D9. 예산·밸런스 조정 이력 (증거 기반, 전부 balance-provisional)

- **JS 예산 320→400KiB**: P6 코어 시스템 2종(3막 런·패시브/강화 + 소환 엔진)로 JS 356KB 도달.
  총량 2.6MiB·LCP·CLS·단일 파일 게이트 불변 — 사용자 체감 계약 유지, 내부 가드만 상향.
- **막 스케일 ×1.4/1.8 → ×1.25/1.5 → ×1.15/1.3**: 강화 봇 500런 스모크 승률 0 반복 →
  진단 결과 1막(×1.0)이 구 런 전체 난이도라 3막 복리로 봇 완주 ~0.
- **막 보스 클리어 시 전체 회복(설계 보충)**: 30방문 누적 소모 산술이 회복 예산을 결정론
  초과(사람도 불가) → 막당 HP 예산을 P4 검증 대역으로 회귀시키는 최소 구조 결정.
- 최종 관측(스모크 500런): turtle 11/125 완주, 그 외 정책 0 — 공학 최소(합리 정책 완주
  비영) 충족. 3막 완주 밸런스·재미는 사람 게이트 대상.
- 봇 정책 확장: 신규 스킬 우선순위 결선·휴식 시 강화 사용(HP<60% 회복) — 수치 아닌 정책.

## 결정된 모호성 요약 (사용자 미명시 → Fable 설계)

1. 분기 후보 수 2~3(60/40) — StS 체감 폭. 2. 1막 방문1 combat 강제·방문1~2 elite 제외 가드레일. 3. 막 스케일 ×1.0/1.4/1.8. 4. 막 보스 3종 재사용 배치. 5. 엘리트 보상 '랜덤 스킬 1'=1개 제안(교체/스킵). 6. 보물 패시브=결정론 자동 부여. 7. 패시브 중복 불가. 8. 강화=스킬당 정의 1종·런당 1회·교체 시 리셋. 9. 격투가 ID 전략=가산(신규 3 ID)+표시명 전환. 10. 보조 아키타입=과열 채택(태세/집중 백로그). 11. 마도기사=신규 캐릭터. 12. 소환 초과=최고령 교체, 행동=선입 순, 재타깃=최소 인덱스. 13. 보상 흐름 신스펙 대체(제거는 상점 전용 회귀). 14. v5 저장=단일 레거시 막 래핑.
