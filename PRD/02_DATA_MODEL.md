# [역사 문서] 코인플립 로그라이크 — 초기 데이터 모델

> 생성 시점: 2026-07-10
>
> ⚠️ 이 문서는 초기 MVP의 데이터 모델을 기록한 역사 스냅샷이다. 현재 TypeScript 계약은 `packages/core/src/content-types.ts`, `packages/core/src/combat/state.ts`, `packages/core/src/run/types.ts`가 정본이며, 읽기용 요약은 [`../docs/current-implementation.md`](../docs/current-implementation.md)를 사용한다.

## 1. 유지된 핵심 구조

초기 설계의 다음 3층 분리는 현재도 유지된다.

```text
[콘텐츠 정의 — packages/content, 불변 리터럴]
  CoinDef / SkillDef / EnemyDef / CharacterDef / ...
                         │ ContentDb 주입
                         ▼
[런타임 상태 — packages/core]
  RunState ── 전투 시작 ──> CombatState
                         │
                         └─ CoinInstance / EnemyState / SlotState / ...

[저장 — apps/ui localStorage]
  RunSave만 전투 경계에서 직렬화
```

- 콘텐츠 수치와 규칙 데이터는 TypeScript 리터럴이다.
- 전투 변화는 `step(state, command, db) -> { state, events }`를 통한다.
- 코인은 UID로 추적하며 다섯 영역 중 정확히 하나에 속한다.
- 런 문자열 시드와 명령 열로 전투를 재현한다.
- UI와 시뮬레이터가 같은 코어와 이벤트를 사용한다.

## 2. 초기 모델에서 바뀐 핵심

| 항목 | 초기 스냅샷 | 현재 P7 |
|---|---|---|
| 속성 코인 | 특정 한 면의 단수 `proc` | 앞·뒷면 `procs.heads` / `procs.tails` 모두 필수 |
| 속성 종류 | 기본·화염·마나 중심 | 화염·마나·냉기·전기·혈액 |
| 스킬 사용 상태 | `usedThisTurn` + 전역 3회 카운터 | `cooldownRemaining` + `usedThisCombat`, 전역 캡 없음 |
| 슬롯 | 6칸 | 8칸, 빈 슬롯 `null`, 시작 스킬 4개 |
| 플레이어 상태 | HP·방어·상태·드로우 페널티 | 다음 턴 드로우 보너스와 `overheat` 추가 |
| 효과 원자 | 피해·방어·상태·코인·속성 취급 | 회복·드로우·쿨다운·과열·트리거·소환 등 확장 |
| 런 | 선형 5전투 중심 | 3막 × 10방문 그래프, 상점·이벤트·휴식·보물·보스 |
| 성장 | 코인·스킬 보상 | 패시브·강화·소환 장비·골드 경제 포함 |
| 저장 | 버전 필드 예약 | v7, v1~v6 마이그레이션, 주·백업·격리 |

## 3. 현재 핵심 타입 요약

### CoinDef / CoinInstance

```ts
interface CoinDef {
  id: CoinDefId;
  element: Element | null;
  procs?: {
    heads?: EffectAtom[];
    tails?: EffectAtom[];
  };
}

interface CoinInstance {
  uid: CoinUid;
  defId: CoinDefId;
  permanent: boolean;
  grants: Element[];
}
```

`effectiveElements(coin, db)`는 기본 속성과 임시 부여 속성의 합집합을 반환한다. 모든 속성 판정은 이 함수를 경유한다.

### SkillDef

```ts
type SkillDef = FlipSkillDef | ConsumeSkillDef;

interface SkillDefBase {
  id: SkillId;
  name: string;
  rarity: 'common' | 'advanced' | 'rare';
  tags: readonly ('attack' | 'defense' | 'utility' | 'ultimate')[];
  targetType: 'single-enemy' | 'all-enemies' | 'self' | 'none';
  cooldown?: 0 | 1 | 2 | 3;
  oncePerCombat?: boolean;
  overheatBonus?: EffectAtom[];
  exclusiveTo?: CharacterId;
  upgrade?: SkillUpgradeDef;
}
```

- `flip`: 비용만큼 장전한 코인을 플립한다.
- `consume`: 손의 지정 속성 코인을 플립 없이 소모 영역으로 보낸다.
- `cooldown` 미지정 기본값은 1이고, 0은 같은 턴 반복이다.
- `oncePerCombat`은 별도 전투당 1회 잠금이다.

### CombatState

현재 상태에는 다음이 포함된다.

```text
turn / phase
player(HP, block, statuses, draw modifiers, overheat)
enemies[]
coins{}
zones(draw, hand, placed, discard, exhausted)
slots[8](skillId|null, cooldownRemaining, usedThisCombat)
turnTriggers[]
rng(flip, shuffle, ai)
characterId / passives[] / enemyScale
summons[]
events[]
```

코인 영역 합계와 `coins` 원장의 개수는 항상 일치해야 한다.

### RunState / RunSave

현재 저장은 다음 장기 상태를 가진다.

```text
version=7 / contentVersion / runSeed
character / currentHp / maxHp / bag
equippedSkills[8] / upgradedSlots[8]
acquiredPassives / gold
graph / nodeChoices / combatIndex / attempt / phase
pendingRewards / pendingShop / pendingEvent / pendingTreasure
경제·이벤트·휴식 통계 카운터
```

전투 중 임시 코인, 쿨다운, 화상, 소환 상태는 저장하지 않는다. 전투 도중 이탈하면 `attempt + 1`로 전투를 결정론적으로 다시 만든다.

## 4. 현재 저장 안전성

- v1~v6 저장을 v7로 마이그레이션한다.
- 6슬롯 배열은 8칸으로 `null` / `false` 패딩한다.
- 주 저장과 백업에 같은 데이터를 쓴다.
- 주 저장이 손상되면 백업으로 복구하고 손상 원문을 격리한다.
- 파싱 불가 데이터는 `corrupt`, 미래 스키마·미지 콘텐츠는 `unsupported`로 구분한다.
- 그래프, 획득 수량, 슬롯, pending 상태를 콘텐츠와 진행도에 맞춰 검증한다.

## 5. 왜 이 구조를 유지하는가

- **결정론**: 시드 + 명령 로그로 재현, 회귀 테스트와 시뮬레이션 공유
- **규칙 단일화**: UI, 봇, 프리뷰가 코어 실행 결과를 사용
- **콘텐츠 확장성**: 새 스킬 대부분을 효과 원자 조합으로 작성
- **저장 안정성**: 런 경계 데이터만 버전 관리하고 전투는 재구성
- **이식성**: 코어가 DOM·React·localStorage에 의존하지 않음

세부 타입과 현재 해결 순서는 [`../docs/current-implementation.md`](../docs/current-implementation.md), 신규 콘텐츠 작성법은 [`../docs/content-design-guide.md`](../docs/content-design-guide.md)를 본다.
