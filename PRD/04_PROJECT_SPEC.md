# 코인 컴뱃 — 프로젝트 스펙 (AI 작업 규율)

> 마지막 동기화: 2026-07-13 · 기준: P7 / PRD v1.3
>
> AI에게 코드나 콘텐츠 작업을 맡길 때 이 문서를 공유한다. 단, 이 문서 하나만 정본으로 사용하지 않고 아래 필수 문서를 함께 읽는다.

## 1. 작업 전 필수 문서

```text
@docs/README.md
@docs/PRD.md
@PRD/P7_NEW_DESIGN_DECISIONS.md
@docs/current-implementation.md
@PRD/04_PROJECT_SPEC.md
@docs/content-design-guide.md   # 콘텐츠 작업일 때
```

`PRD/01_PRD.md`, `02_DATA_MODEL.md`, `03_PHASES.md`, `docs/implementation-plan.md`는 역사 자료다. 결정 근거를 찾는 데는 사용할 수 있지만 현재 규칙을 덮어쓸 수 없다.

## 2. 정본 우선순위

1. 제품 의도·게임 규칙: `docs/PRD.md` 최신 변경 이력 + `PRD/P7_NEW_DESIGN_DECISIONS.md`
2. 실제 구현 계약: `packages/core`, `packages/content`, 회귀 테스트
3. 구현 읽기 안내: `docs/current-implementation.md`
4. 콘텐츠 작성 규칙: `docs/content-design-guide.md`
5. 역사적 계획·증거: 이전 Phase 문서와 보고서

문서와 코드가 다르면 조용히 하나를 선택하지 않는다. 의도한 변경이면 제품 문서·구현·테스트·현재 구현 문서를 같은 PR에서 동기화하고, 의도하지 않은 차이면 회귀 결함으로 다룬다.

## 3. 기술 스택과 구조

| 영역 | 현재 선택 |
|---|---|
| 언어 | TypeScript strict |
| 코어 | 순수 TypeScript `@game/core` |
| 콘텐츠 | TypeScript 리터럴 `@game/content` |
| UI | Vite + React `@game/ui` |
| 테스트 | Vitest + fast-check, Playwright |
| 시뮬레이터 | `@game/sim` CLI·대량 시뮬 |
| 패키지 | pnpm workspace, Node.js 22+ |
| 저장 | localStorage, 런 저장 v7 |
| 배포 | GitHub Pages |

```text
packages/core       헤드리스 전투·런 엔진
packages/content    콘텐츠와 검증
apps/ui             상태 표현·입력·연출·저장
 tools/sim          동일 코어 기반 시뮬레이터
```

의존 방향은 `content → core`, `ui → core + content`, `sim → core + content`다. `core`는 React, DOM, localStorage, Node 전용 API에 의존하지 않는다.

## 4. 현재 비가역 계약

다음은 P7 기준의 현재 계약이다.

- 전역 턴당 스킬 사용 횟수 캡이 없다.
- `usedThisTurn`을 사용하지 않고 슬롯별 `cooldownRemaining`을 사용한다.
- `cooldown: 0`은 같은 턴 반복, 미지정 기본값은 1이다.
- 장착 슬롯은 8칸, 빈 슬롯은 `null`, 시작 스킬은 4개다.
- 모든 속성 코인은 앞·뒷면 양쪽에 고유 효과를 가진다.
- 소비형 스킬은 플립하지 않으며 면 효과·코인 proc을 발동하지 않는다.
- 과열은 비중첩 불리언이고 과열 강화 스킬 해결 후 소비된다.
- 손 상한은 10, 턴 시작 총 드로우는 0~8이다.
- 런은 3막 × 막당 10방문이고 저장 버전은 v7이다.

이 계약을 되돌리는 변경은 단순 리팩터링으로 처리하지 않는다. 새 제품 결정, 마이그레이션, 회귀 테스트가 필요하다.

## 5. 절대 하지 말 것

### 코어·결정론

- `core`에서 `Math.random()`, `Date.now()`, 비결정론 전역 상태를 사용하지 않는다.
- flip·shuffle·ai·reward 등 분리된 RNG 스트림을 하나로 합치지 않는다.
- `CombatState`나 `RunState`를 리듀서·공개 런 API 밖에서 직접 변경하지 않는다.
- 실패한 명령이 입력 상태를 일부 변경하게 만들지 않는다.

### 규칙 경계

- UI에 별도 장전·대상·쿨다운·보상 합법성 규칙을 복제하지 않는다.
- UI와 봇은 `legalCommands()`와 코어 공개 헬퍼를 사용하고 최종 판정은 `step()`에 맡긴다.
- 새 스킬마다 임의 함수를 만들어 효과를 숨기지 않는다. 가능한 한 `EffectAtom` 데이터로 표현한다.
- 현재 구현에 없는 전역 스킬 사용 카운터, 6슬롯, `usedThisTurn`, 단면 `proc`을 되살리지 않는다.
- 소비형 스킬에 앞·뒷면 판정을 추가하지 않는다.
- 공격 태그를 자기·무대상 스킬에 붙여 트리거 대상을 모호하게 만들지 않는다.

### 콘텐츠·저장

- 피해량, HP, 가격, 비용을 UI나 코어 분기에 하드코딩하지 않는다.
- 임시 코인을 런 주머니에 영구 반영하지 않는다.
- 소모 영역 코인을 전투 중 리셔플하지 않는다.
- 저장 필드를 바꾸면서 `RUN_SAVE_VERSION`, 마이그레이션, 검증, 라운드트립 테스트를 생략하지 않는다.
- 알 수 없는 미래 저장과 손상 저장을 같은 오류로 처리하지 않는다.

### 검증·문서

- 시뮬레이터 결과만으로 재미·손맛·최종 밸런스를 검증했다고 주장하지 않는다.
- 사람 증거 없이 `experience-unverified`를 제거하지 않는다.
- 역사적 보고서의 당시 수치와 결론을 현재 결과처럼 덮어쓰지 않는다.
- 테스트와 문서를 갱신하지 않고 규칙 변경을 완료로 표시하지 않는다.
- 테스트 개수·번들 실제 바이트처럼 자주 변하는 값을 README에 고정 복사하지 않는다.

## 6. 항상 할 것

### 변경 전

- 관련 제품 결정, 현재 코드, 기존 테스트를 먼저 찾는다.
- 변경이 규칙, 콘텐츠, UI 표현, 저장, 밸런스 중 무엇인지 구분한다.
- 영향받는 정본 파일과 회귀 게이트를 작업 계획에 포함한다.

### 구현

- 새 규칙은 실패·경계·승패 중단 케이스를 포함한 테스트부터 작성한다.
- 모든 사용자에게 보이는 상태 변화는 필요한 `CombatEvent`를 방출한다.
- UI 애니메이션과 시뮬 지표가 같은 이벤트를 소비하게 유지한다.
- 새 `EffectAtom`을 추가하면 타입, 인터프리터, 이벤트, 프리뷰, 설명, 검증, 테스트를 함께 수정한다.
- 새 콘텐츠는 `validateContentDb()`를 통과하게 하고 `satisfies` 타입 검증을 유지한다.
- 코인 총량, HP·방어 범위, 슬롯·쿨다운 범위, 종료 가능성 불변식을 유지한다.
- 전체 대상 효과와 공격형 속성 proc이 모든 살아 있는 적에게 적용되는지 검증한다.
- 자기·무대상 플립 스킬의 공격형 코인 proc 대상 선택을 검증한다.

### 저장·런

- 런 그래프와 보상·상점·이벤트 RNG를 이름이 분리된 결정론 스트림으로 유지한다.
- 저장은 주·백업 이중 쓰기와 손상 원문 격리 정책을 보존한다.
- 세이브 마이그레이션은 모든 지원 구버전에서 현재 버전까지 테스트한다.
- 빈 스킬 슬롯은 강화하거나 콘텐츠 ID처럼 직렬화하지 않는다.

### 문서

- 제품 규칙 변경: `docs/PRD.md`와 해당 결정 로그
- 전투·런·저장 구현 변경: `docs/current-implementation.md`
- 콘텐츠 제약·템플릿 변경: `docs/content-design-guide.md`
- 사용자 진입점 변경: 루트 `README.md`
- 사람 검증 결과: `PLAYTEST_KIT`이 지시하는 증거 문서

## 7. 권장 작업 순서

1. 관련 정본과 코드 경로 식별
2. 재현 테스트 또는 골든 트레이스 추가
3. 최소 코어 변경
4. 콘텐츠 데이터와 검증 갱신
5. UI는 코어 결과를 표현하도록 연결
6. 저장·리플레이·시뮬레이션 회귀 확인
7. 문서 동기화
8. 관련 소규모 검증 후 `pnpm release:verify`
9. 사람 체감이 필요한 결론은 명시적으로 유보

## 8. 검증 명령

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm ci:sim
pnpm build
pnpm check:content
pnpm check:assets
pnpm check:perf
pnpm check:a11y
pnpm check:mobile
pnpm release:verify
```

개별 시뮬레이션 예:

```bash
pnpm sim play --seed 42 --auto
pnpm sim fuzz --games 100 --seed 42
pnpm sim run --seed 42 --auto
```

실제 CLI 옵션은 `tools/sim/src/cli.ts`의 usage가 정본이다.

## 9. 배포와 환경

GitHub Pages 정적 SPA로 배포한다. Vite base path와 Pages 워크플로를 보존한다. 서버·계정·외부 API·비밀 환경변수는 현재 없다. 새 외부 의존이나 비밀값이 필요해지면 코드보다 먼저 제품·보안·배포 결정을 문서화한다.

## 10. 완료 판정

다음을 모두 만족해야 작업 완료다.

- 요구한 동작과 실패 경로가 테스트됨
- 결정론과 불변식 유지
- UI와 시뮬레이터가 동일 코어 계약 사용
- 콘텐츠·저장 검증 통과
- 관련 문서 동기화
- 릴리스 게이트 통과 또는 실행하지 못한 항목과 이유 명시
- 사람 데이터가 없는 체감 결론은 미검증으로 유지
