# Coin Combat 콘텐츠 작성 가이드 v3.0

> 2026-07-13 · PRD v2.0 / P12 기준
> 실제 허용 필드와 상한은 `packages/core/src/content-types.ts`와 `validateContentDb()`가 최종 계약이다.

이 문서는 신규 코인·스킬·패시브·캐릭터·적을 현재 데이터 중심 구조에 추가하는 방법을 정한다. 제품 의도는 [`PRD.md`](./PRD.md), 실제 해결 순서는 [`current-implementation.md`](./current-implementation.md)를 따른다.

## 1. 작성 원칙

1. 기존 `EffectAtom`과 콘텐츠 패턴으로 표현할 수 있는지 먼저 확인한다.
2. 특정 스킬 하나만을 위한 분기보다 재사용 가능한 명시적 원자를 선호한다.
3. 신규 의존성을 추가하지 않는다.
4. ID는 저장 호환 계약이므로 표시명이 바뀌어도 함부로 변경하지 않는다.
5. 같은 수치를 문서와 코드에 중복하지 않는다. 실제 값의 정본은 콘텐츠 데이터다.
6. 공용 콘텐츠는 모든 캐릭터가 실제로 사용할 수 있어야 한다.
7. 캐릭터 고유 메커니즘을 참조하면 속성이 없어도 반드시 전용 풀로 분류한다.

## 2. 보상 풀과 소유권

### 2.1 핵심 계약

```text
현재 캐릭터 스킬·패시브 후보 =
exclusiveTo가 없는 공용 콘텐츠
+
exclusiveTo가 현재 캐릭터 ID인 전용 콘텐츠
```

- `exclusiveTo` 없음: 공용
- `exclusiveTo: characterId`: 해당 캐릭터 전용
- 시작·고유·저장 호환용 레거시는 일반 보상 대상에서 제외하는 명시적 상태를 사용한다.
- 저장 호환 정의를 신규 후보에서만 내릴 때는 `retiredFromRewards: true`를 사용한다. ID와 효과 정의는 유지하므로 구 장착 스킬·획득 패시브는 계속 해결되지만 `rewardEligibleSkillIds`와 `eligiblePassiveIds`에서는 제외된다.

### 2.2 공용으로 허용되는 효과

- 일반 피해와 방어
- 즉시·다음 턴 드로우
- 기본 동전 생성
- 코인 보존과 재굴림
- 일반 쿨다운 조작
- 모든 캐릭터에 유효한 생존 보조

### 2.3 공용으로 두면 안 되는 효과

- 특정 속성 동전 요구·소비
- 화상, 과열, 르미즈, 보존 동전 계수
- 소환 장비, 병기 출력, 방어 참조
- 혈마검 투자·위력·단계
- 특정 캐릭터 특성이나 전용 상태 직접 강화

예를 들어 마나 코인을 요구하지 않아도 소환 장비를 즉시 행동시키는 스킬은 `arcanist` 전용이다. 과열 상태에서 방어를 얻는 스킬도 `warrior` 전용이다.

### 2.4 동전 보상 (P13 전속성 가중 개방)

일반 보상과 상점의 동전 후보는 기본 동전 + 모든 속성 동전에서 가중 비복원 추출로 서로 다른 정의 3개를 제시한다(가중치: 대표 4 / 기본 3 / 보유 비대표 2 / 미보유 1 — 정본은 `packages/core/src/run/run.ts`의 `weightedCoinOptions`). 스킬·패시브의 캐릭터 전용 경계(§2.1)는 그대로다 — 개방된 것은 동전뿐이다.

## 3. ID와 표시명

- ID는 소문자 kebab-case를 사용한다.
- 기존 ID를 삭제하거나 바꾸기 전에 저장 마이그레이션을 설계한다.
- 캐릭터 표시명과 내부 ID가 달라도 된다. 예: 냉기 도적=`frost-knight`, 마도기사=`arcanist`.
- 구 콘텐츠를 보상에서 내리더라도 구저장 복원을 위해 정의 자체를 남길 수 있다.
- 레거시 정의는 공용처럼 노출되지 않도록 소유권과 보상 가능 여부를 명확히 한다.
- 퇴역을 `bloodOffering` 같은 다른 메커니즘 플래그로 표현하지 않는다. 퇴역 여부와 전투 의미는 서로 독립이다.

## 4. 코인 작성

모든 속성 코인은 앞면과 뒷면 양쪽에 하나 이상의 고유 효과를 가진다.

```ts
{
  id,
  name,
  element,
  faces: {
    heads: EffectAtom[],
    tails: EffectAtom[],
  },
}
```

### 대상 규칙

- 피해·화상·동상·감전 등 일반 공격형 효과는 사용한 스킬의 적 대상 규칙을 따른다.
- 모든 적 대상 스킬이면 각 살아 있는 적에게 적용한다.
- `coinDamage`는 혈액 동전 전용 지정 피해다. 스킬이 전체·자기·무대상이어도 기존 적 선택 흐름으로 고른 한 적에게만 적용한다.
- 혈액 뒷면처럼 `loseHp`와 `coinDamage`를 한 면에 함께 두면, 체력이 상실량 이하일 때 그 면의 proc 전체가 불발한다. 체력 상실은 방어를 무시한다.
- 방어·회복은 플레이어에게 적용한다.
- 자기·무대상 플립 스킬에 공격형 속성 코인을 넣을 수 있다면 적 대상을 함께 요구한다.
- 소비형 비용으로 쓴 코인은 플립하지 않으므로 코인 면 효과를 발동하지 않는다.

### 4.1 영구 코인 인챈트 작성

인챈트는 코인 정의가 아니라 `enchants` 레코드에 작성하며, 영구 코인 사본 하나에만 부여된다. 임시 코인, `addCoin`으로 생성한 코인, 런 주머니에 없는 전투 인스턴스에는 작성하거나 부여하지 않는다. 한 사본에는 하나만 붙고 런 중 다른 인챈트로 교체하지 않는다.

현재 기반의 작성 템플릿은 다음과 같다. 이 다섯 ID와 `mechanic`의 짝은 고정이며, 새 메커니즘을 이 표 밖에 추가하려면 데이터만으로는 충분하지 않다.

```ts
sharpness: {
  id: enchant('sharpness'),
  name: '예리함',
  description: '공격 스킬에서 이 코인이 성공하면 피해 +1.',
  mechanic: 'sharpness'
}
```

| ID | `mechanic` | 작성 효과 |
|---|---|---|
| `sharpness` | `sharpness` | 공격 스킬 성공 코인 피해 +1 |
| `heads-polish` | `heads-polish` | 앞면 확률 60% |
| `tails-polish` | `tails-polish` | 뒷면 확률 60% |
| `echo` | `echo` | 전투당 첫 사용 뒤 손패 복귀, 이후 비활성화 |
| `pendulum` | `pendulum` | 전투당 첫 사용에 현재 성공 단계형 스킬의 성공면을 해당 코인에만 강제, 이후 비활성화 |

엘리트·보스 보상은 3개 동전과 3개 인챈트를 인덱스로 짝지어 제시한다. 작성자가 인챈트 우선순위를 보상 표에 섞지 않는다. `reward-enchant` 독립 RNG 스트림이 중복 없는 세 짝을 만든다. `Pureblood`(순혈)은 `Blood`(혈액) 속성이나 혈액 동전이 아니다. 조건부 인챈트 후속 배치로 유보하며, 이 다섯 인챈트 기반에 추가하지 않는다.

### 검수 질문

- 두 면이 모두 다른 상황에서 선택 가치가 있는가?
- 핵심 속성이 아니어도 코인 자체의 면 효과가 이해되는가?
- 광역 스킬에서 효과가 적마다 적용되어도 수치가 안전한가?
- 임시 동전이 전투 종료 후 런 주머니에 남지 않는가?

## 5. 스킬 작성

### 5.1 공통 필드

```text
id, name, rarity, type, cost, cooldown,
oncePerCombat, target, exclusiveTo,
upgrade, 설명 생성에 필요한 효과 데이터
```

### 5.2 플립형

v1.2 신규·이관 스킬은 성공 단계형을 사용한다.

```text
successFace: heads | tails
successLadder: [성공 0개 효과, 성공 1개 효과, ... 성공 cost개 효과]
resonance: { element, effects } (속성 스킬에서 필요할 때만)
```

- `successLadder`는 반드시 `cost + 1`개 단계이며 한 번의 해결에서 정확히 한 단계만 적용한다.
- 코스트 1 기본기는 성공 0개 단계가 비어 있어야 한다.
- 같은 속성 동전이 성공면으로 하나 이상 나오면 공명은 한 번만 적용한다.
- 성공 단계형에는 아래 레거시 필드를 함께 선언하지 않는다.

아직 이관하지 않은 레거시 스킬은 다음 구조를 유지한다.

```text
base
heads: { mode: any | per, effects }
tails: { mode: any | per, effects }
elementFaces / overheatBonus / preservedBonus (필요할 때만)
```

- 비용은 일반 1~4, 예외 5다.
- 비용 5는 희귀·궁극기급이고 강한 쿨다운 또는 일회성을 요구한다.
- 레거시 기본 효과는 항상 발동한다. 성공 단계형은 선택된 단계만 발동한다.
- 연속 피해 원자는 한 피해 패킷으로 합쳐지는지 확인한다.
- 같은 면의 개수에 비례한다면 `per`, 하나 이상만 필요하면 `any`를 쓴다.
- 성공 단계의 기존 원자 수치만 강화할 때는 `ladderAmount { tier, index, delta }`를 사용한다. `damage.amount`처럼 기본 `amount`가 아닌 `applyStatus.stacks`를 바꿀 때는 `field: 'stacks'`를 명시한다. 레거시 `baseAmount` 등과 혼합하지 않는다.

```text
// 화염권 2개 성공 강화: 피해 7 → 9, 화상 2 → 3
patch: {
  kind: 'multi',
  patches: [
    { kind: 'ladderAmount', tier: 2, index: 0, delta: 2 },
    { kind: 'ladderAmount', tier: 2, index: 1, field: 'stacks', delta: 1 }
  ]
}
```

### 5.3 소비형

```text
requiredElement
minCost / maxCost 또는 고정 cost
effects
```

- 실제 손패에 있고 해당 속성으로 인정되는 서로 다른 동전만 선택한다.
- 소비량에 비례하는 효과는 명시적 소비량 기반 원자를 사용한다.
- 플립·면 효과·속성 코인 고유 효과가 발동하지 않는 것을 전제로 밸런스를 잡는다.
- 실제 동전만 비용으로 허용할지 임시 취급 속성도 허용할지 명시한다.
- 투자와 일반 소비처럼 후속 의미가 다르면 동일한 `consume` 이벤트만 추측해 처리하지 말고 데이터에서 구분한다.

### 5.4 지원형과 고유 스킬

- 드로우·생성·보존·장비 조작도 코스트와 쿨다운을 가진다.
- 대상 동전이 없는 지정 드로우는 사용 전 비활성화한다.
- 고유 스킬은 일반 보상·교체·제거 대상에서 제외한다.
- 체력 지불처럼 명령 합법성에 영향을 주는 비용은 효과 적용 뒤 되돌리는 방식이 아니라 사용 전 검증한다.

### 5.5 쿨다운 기준

| 유형 | 권장 |
|---|---|
| 공용 기본 공격·방어 | 0(반복) |
| 일반 공격·방어 | 1 |
| 고효율 공격·방어 | 2 |
| 드로우·생성·강한 지원 | 2~3 |
| 4~5코스트 마무리기 | 2~4 또는 일회성 |

`oncePerCombat`은 쿨다운과 별도다. 강화로 일회성을 제거할 때 돌아갈 쿨다운을 함께 선언한다.

## 6. 효과 원자 선택

자주 쓰는 원자 예시는 다음과 같다.

```ts
{ kind: 'damage', amount: 8 }
{ kind: 'coinDamage', amount: 2 }
{ kind: 'loseHp', amount: 1 }
{ kind: 'block', amount: 5 }
{ kind: 'heal', amount: 2 }
{ kind: 'draw', count: 1 }
{ kind: 'nextTurnDraw', count: 1 }
{ kind: 'drawSpecific', coins: ['basic', 'frost'], count: 1 }
{ kind: 'preserveChosenCoin', count: 1 }
{ kind: 'applyStatus', status: 'burn', stacks: 2, to: 'target' }
{ kind: 'addCoin', coin: 'fire', zone: 'discard', count: 1 }
{ kind: 'reduceCooldown', amount: 1 }
{ kind: 'enterOverheat' }
```

신규 원자가 필요한 경우 다음을 함께 추가한다.

1. 타입과 유효성 검사
2. 전투 해결 순서
3. 이벤트 또는 UI 설명
4. 프리뷰·봇·시뮬레이터 처리
5. 골든·실패·경계 테스트
6. `current-implementation.md` 설명

## 7. 패시브 작성

- 전투 시작, 턴 시작, 스킬 해결 뒤 등 발동 시점을 하나로 명시한다.
- 턴당 첫 1회·전투당 첫 1회는 상태 플래그로 추적한다.
- 패시브가 자신을 다시 발동시키는 재귀를 만들지 않는다.
- 일반 적은 0~1개, 엘리트 1개, 보스 1~2개를 기준으로 한다.
- 플레이어 패시브는 전용 메커니즘을 참조하면 `exclusiveTo`를 반드시 지정한다.
- 사망 방지는 적 피해와 체력 지불을 구분한다.

## 8. 캐릭터 작성

새 캐릭터는 다음을 한 번에 정의한다.

```text
안정적인 내부 ID와 표시명
대표 속성 및 사용 가능 동전
최대 체력
시작 주머니
시작 스킬과 고유 스킬
고유 특성·패시브
전용 메커니즘
최소 2개의 빌드 흐름
전용 스킬·패시브의 exclusiveTo
보상·상점·저장·봇 정책
```

### 신규 캐릭터 체크리스트

- 다른 캐릭터에게 전용 스킬이 나타나지 않는다.
- 공용 스킬을 얻어도 죽은 효과가 없다.
- 일반 동전 보상은 기본+대표 속성의 부분집합이다.
- 시작 스킬 수와 슬롯 수가 저장 계약과 맞는다.
- 고유 자원이 전투 한정인지 런 지속인지 명확하다.
- 런 지속 자원은 저장 버전·마이그레이션·왕복 테스트에 포함된다.
- 자동 플레이가 고유 비용과 선택을 합법적으로 처리한다.
- 캐릭터 선택 UI와 키보드·모바일 플레이 경로가 작동한다.

## 9. 몬스터 작성

```text
id, name, 등급, 역할, 체력,
intents, 패시브, 등장 구간, 보상 가치
```

- 행동은 공격, 연속 공격, 방어, 버프, 디버프, 소환으로 표현한다.
- P13 배치 A 기믹 필드(전부 옵셔널, 계약은 `packages/core/src/combat/enemy-atoms.test.ts`): `windup {turns, cancelOn.damageThreshold}`, `vulnerableWhileWindup`, `conditionalAttack(playerHpBelowHalf)`, `phases {hpBelowFraction, damageTakenMultiplier, intents}`, `attack.damagePerGrowthPercent`, `growOnUnblockedDamage(+healOnGrow/maxStacks/minHpDamageFraction/loseOnFullBlock)`, `growthBranch {atLeast, intent}`, `healAlly(lowestHpAlly, cleanse)`.
- P13 배치 C 필드: `threat`, `protectionLink {target: 'highestThreatAlly', redirectFraction, durability, brokenTurns, damageTakenMultiplierWhileBroken}`, `petrify {damageReduction, shatterRawDamageFraction, crackedTurns, crackedDamageTakenMultiplier, cancelWindupIntentId}`, `warBanner {attackAuraPercent, march {attackPercent, turns, shieldMaxHpFraction}}`. `petrify` 의도에는 `entersPetrify: true`, 집단 행군 의도에는 `groupMarch: true`를 사용한다.
- 보호 링크는 전투 시작 시 가장 높은 `threat`의 살아 있는 다른 적을 하나만 연결한다. 피해 재지정은 공유 피해 해결기를 통해 처리하므로 상태 피해와 방어 상호작용도 같은 규칙을 쓴다. 링크 내구도는 보호자 자신을 대상으로 한 공격 스킬당 한 번만 줄어든다.
- 전쟁기수의 오라는 자신을 제외한 살아 있는 적에게만 적용한다. 반대로 행군은 전쟁기수 자신을 포함한 모든 살아 있는 적에게 적용한다. 행군의 보호막·공격 증가는 원천 적을 기록해야 하며, 원천이 사망하면 같은 해결 안에서 남은 보호막과 공격 증가를 제거한다. 새 몬스터가 원천 소유 효과를 추가하면 사망 정리 이벤트와 회귀 테스트를 함께 추가한다.
- P13 배치 D 기반 필드: `coinSeizure {target: 'mostNumerousPublicElementInHand', maxCoins, capFraction}`와 `skillSeal {recentPlayerTurns, turns, uniqueSkillEffectMultiplier}`. 압수 의도는 `windup`과 같은 의도 안에 `seizeCustody` 뒤 공격을 두어 예고 다음 적 행동에 해결하고, 봉인 의도는 `sealRecentSkill`을 사용한다. 몬스터 ID나 의도 ID로 런타임 분기하지 않는다.
- 압수는 예고 시 대상 속성·동전 ID·상한을 확정하고 해결 때 남은 지정 동전만 옮긴다. 압수 동전은 전투 한정 정확히 한 영역에 있어야 하며 ID·임시 여부·인챈트를 유지한다. 원천 사망 반환, 영구 가방 불변, 홀수 절반 내림, 소비 후 미재지정을 각각 회귀 테스트로 고정한다.
- 봉인 대상은 최근 사용 횟수뿐 아니라 현재 명령 합법성(장착·쿨다운·전투당 1회·소비 코인·대상 가능)을 만족해야 한다. 유일 스킬 보호는 스킬 고유 효과만 감소시키고 코인 고유 효과를 건드리지 않는다. 봉인 중 직접 명령 우회와 `턴 종료` 소프트락을 함께 테스트한다.
- `growthLabel`은 동일 런타임 스택을 몬스터 콘셉트 용어(예: 기세·만찬)로 표시한다. `growthBranch`는 기본 패턴 인덱스를 유지한 채 공개 시점의 스택으로 대체 의도를 확정하므로, 분기 결과와 준비 행동이 플레이어에게 먼저 보인다.
- 강공은 windup 예고를 경유해야 하고, 일반 조우의 핵심 위협은 1~2개다(교란 축 3중첩 금지).
- 의도만 보고 대응 결정을 내릴 수 있어야 한다.
- 숨은 예외보다 보이는 패시브를 사용한다. `enemyTurnStart` 패시브는 자기 대상 한정.
- 고정 순환이든 조건부 선택이든 결정론 시드로 재현 가능해야 한다.

## 10. 카드 문구와 툴팁

- 효과가 적용되는 순서대로 쓴다.
- 공식 용어는 동전, 손패, 뽑을 더미, 버림 더미, 플립, 소비, 보존, 일회성, 쿨다운을 쓴다.
- `전투당 1회`, `사용 후 이번 전투에서 제거`는 플레이어 표기에서 `일회성`으로 통일한다.
- 계산식은 `기본 수치 + 자원×계수`처럼 한 번에 계산 가능하게 쓴다.
- 카드에는 핵심 결과만 쓰고 속성·상태·고유 자원의 공통 규칙은 툴팁으로 보낸다.
- UI 설명은 콘텐츠 데이터에서 생성해 실제 효과와 따로 드리프트하지 않게 한다.

## 11. 강화 작성

강화는 한 가지 축을 우선한다.

- 기본 수치 증가
- 면 추가 효과 증가
- 임시 동전 생성량 또는 위치 변경
- 코스트·쿨다운 조정
- 일회성 제거
- 전용 메커니즘의 상한 또는 계수 조정

강화가 타입·대상·소비 범위·일회성 계약을 바꾸면 기본/강화 양쪽을 별도로 테스트한다. 아직 수치가 확정되지 않은 강화는 빈 추측값을 넣지 않고 결정 로그에 미확정으로 남긴다.

## 12. 필수 검증

콘텐츠 변경 후 최소한 다음을 실행한다.

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm check:content
pnpm ci:sim
pnpm build
```

캐릭터·저장·UI를 함께 바꾼 경우 `pnpm release:verify` 전체 게이트를 실행한다. 실패하면 다음만 먼저 보고 재현을 고정한다.

- 실패한 대상과 명령
- 종료 코드
- 첫 오류·어서션·스택의 핵심 부분
- 관련 시드와 저장 버전

자동 테스트가 통과해도 재미·난이도·음색은 확정하지 않는다. 사람 플레이테스트 전 수치는 `balance-provisional`, 경험은 `experience-unverified`로 유지한다.
