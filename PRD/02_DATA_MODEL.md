# 코인플립 로그라이크 — 데이터 모델

> 서버/DB가 없는 로컬 게임이므로 "테이블"이 아니라 **콘텐츠 정의(불변) / 런타임 상태(가변) / 저장(localStorage)** 세 층으로 나뉜다.
> 정확한 TypeScript 시그니처는 [docs/implementation-plan.md §6](../docs/implementation-plan.md)이 원본.

---

## 전체 구조

```
[콘텐츠 정의 — packages/content, 불변 리터럴]
  CoinDef ─┐
  SkillDef ─┼── ContentDb ──(주입)──> 코어 엔진
  EnemyDef ─┤
  CharacterDef ─┘

[런타임 상태 — 메모리, 코어가 소유]
  RunState 1 ──1:1── CombatState (전투 중일 때만)
  CombatState 1 ──1:N── CoinInstance (uid로 추적, 5개 영역 중 하나에 소속)
  CombatState 1 ──1:N── EnemyState

[저장 — localStorage, 전투 경계에서만]
  RunSave (RunState의 직렬화 스냅샷)
```

## 엔티티 상세

### CoinDef (동전 종류)
어떤 동전인지 정의. MVP는 3종: `basic`, `fire`, `mana`(선택).

| 필드 | 설명 | 예시 | 필수 |
|------|------|------|------|
| id | 동전 종류 식별자 | `fire` | O |
| element | 속성 (기본 동전은 없음) | `fire` / null | O |
| proc | 특정 면에서 발동하는 속성 효과 | 앞면 → 화상 +1 | X |

### CoinInstance (전투 중의 동전 한 닢)
| 필드 | 설명 | 예시 | 필수 |
|------|------|------|------|
| uid | 전투 내 고유 번호 (총량 검증용) | 17 | O |
| defId | 어떤 종류인지 | `basic` | O |
| permanent | 영구(주머니 소속) / 임시(전투 후 소멸) | true | O |
| grants | "이번 턴 화염 취급" 태그 목록 | `['fire']` | O(빈 배열) |

- 항상 5개 영역(뽑을 더미/손패/스킬 슬롯/버림/소모) 중 정확히 한 곳에 소속
- **불변식**: 전 영역 합계 = 시작 10개 + 생성된 임시 코인 수

### SkillDef (스킬 카드)
| 필드 | 설명 | 예시 | 필수 |
|------|------|------|------|
| id, name, rarity | 식별/표시/등급 | `warrior.slash`, 베기, common | O |
| type | `flip`(장전형) / `consume`(소비형) | flip | O |
| cost 또는 consume | 장전 동전 수 / 소비 조건(속성+개수) | 1 / 화염×1 | O |
| base / heads / tails | 기본 효과 / 면 추가 효과(any·per 모드) | 피해 6 / +4(any) | O/X |
| oncePerCombat | 일회성 (전투당 1회) | false | X |
| targetType, tags | 대상 유형 / attack 등 태그 | single-enemy | O |

효과는 코드 함수가 아닌 **효과 원자(EffectAtom) 배열** — damage / block / selfDamage / applyStatus / addCoin / grantElement.

### EnemyDef · EnemyState (적)
정의: HP, 고정 행동 사이클(의도 리스트). 상태: 현재 HP, 방어, 상태이상, 공개된 의도. MVP 3종: 약탈자(공격형 75), 수문장(방어형 70), 주술사(디버프형 60 — 위축: 드로우 −1).

### CombatState (전투 상태 — 순수 데이터)
turn, phase, player(HP/방어/상태이상), enemies[], coins{}, zones{}, slots[](usedThisTurn/usedThisCombat), rng(flip/shuffle/ai 스냅샷). **모든 변화는 `step(state, command) → {state, events}` 리듀서로만.**

### RunState / RunSave (런 진행 + 저장)
| 필드 | 설명 | 예시 |
|------|------|------|
| runSeed | 런 전체 재현 시드 | "BRAVE-EMBER-42" |
| character | 캐릭터 | warrior |
| hp | 현재/최대 (전투 간 이월) | 58/70 |
| bag | 영구 코인 목록 (defId만) | basic×8, fire×3 |
| skills | 장착 스킬 (슬롯 6) | [...] |
| progress.combatIndex | 몇 번째 전투인지 | 2 |

- RunSave는 **전투 경계에서만** localStorage에 기록. 전투 중 이탈 → 해당 전투는 attempt 소금을 바꿔 재시작
- 파생 가능한 것(더미 순서, 적 의도)은 저장하지 않는다 — 시드에서 재파생

## 왜 이 구조인가

- **결정론**: 시드+커맨드 로그 = 완전한 재현 → 버그 리포트·골든 테스트·밸런스 시뮬이 전부 공짜
- **확장성**: 새 스킬 = 리터럴 1개, 새 속성 = union 1항 + proc 1개. grants가 배열이라 다속성도 무비용 (Phase 3)
- **단순성**: 서버 스키마·마이그레이션 없음. RunSave에 version 필드만 예약

## [NEEDS CLARIFICATION]

- [ ] 없음 — 구조 결정은 docs/implementation-plan.md §6에서 완료. 수정 의견은 Turn 4 카드에서.
