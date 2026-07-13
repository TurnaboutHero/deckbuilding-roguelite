# deckbuilding-roguelite

동전 기반 로그라이크 덱빌딩 — 카드가 아닌 **동전 주머니**를 성장시키는 턴제 전투 게임.

고정된 스킬 셋에 매 턴 무작위로 뽑은 동전을 장전하거나 소비해 최적 효율을 찾는다. 스킬의 기본 효과는 항상 발동하며, 동전의 앞면·뒷면과 속성 효과가 결과를 흔든다.

## 현재 기준

> P11 · PRD v1.3 · 콘텐츠 `1.5.0-p11` · 런 저장 v7
> 공학 상태: engineering-safe · 밸런스: balance-provisional · 경험: experience-unverified

- **플레이**: https://turnabouthero.github.io/deckbuilding-roguelite/
- **캐릭터**: 화염 격투가, 수호자, 번개 결투사, 냉기 도적, 마도기사
- **코인**: 기본 + 화염·마나·냉기·전기·혈액. 모든 속성 코인은 앞·뒷면 양쪽에 고유 효과
- **전투**: 장착 8슬롯, 시작 4스킬, 전역 사용 횟수 캡 없이 스킬별 쿨다운, 소비형 스킬, 과열, 패시브, 소환 장비
- **런**: 3막 × 막당 10방문. 전투·엘리트·상점·이벤트·보물·휴식·보스와 골드 경제
- **제품화**: 데스크톱·모바일, 런타임 합성 SFX, 키보드 완주, WCAG AA 대비, 저장 이중화·복구, 성능·번들 예산 게이트
- **사람 검증 유보**: 재미·손맛, 최종 밸런스, 난이도 곡선, 음색 취향은 [`PRD/PLAYTEST_KIT.md`](PRD/PLAYTEST_KIT.md)의 사람 게이트 대상

## 문서

문서 세대가 섞여 있으므로 먼저 [`docs/README.md`](docs/README.md)의 우선순위를 확인한다.

| 문서 | 역할 |
|---|---|
| [`docs/README.md`](docs/README.md) | 문서 우선순위, 현재 문서와 역사 문서 구분 |
| [`docs/PRD.md`](docs/PRD.md) | 제품 요구사항과 게임 규칙 정본. v1.3 변경 이력이 본문 충돌보다 우선 |
| [`PRD/P10_CHARACTER_DESIGN_SYNC.md`](PRD/P10_CHARACTER_DESIGN_SYNC.md) | 화염 전사·마도기사 최신 통합 기획과 구현 결정 |
| [`PRD/P11_COLD_ROGUE_DESIGN_SYNC.md`](PRD/P11_COLD_ROGUE_DESIGN_SYNC.md) | 냉기 도적 최신 기획과 혈액 캐릭터 보류 사항 |
| [`PRD/P7_NEW_DESIGN_DECISIONS.md`](PRD/P7_NEW_DESIGN_DECISIONS.md) | 쿨다운·8슬롯·양면 속성 코인·과열 등 최신 오버라이드 |
| [`docs/current-implementation.md`](docs/current-implementation.md) | 현재 코드를 기준으로 한 아키텍처·전투·런·저장·CI 안내 |
| [`docs/content-design-guide.md`](docs/content-design-guide.md) | 신규 코인·스킬·캐릭터·몬스터 작성 기준 |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | M0~M6 당시의 역사적 구현 계획과 결정 근거. 현재 규칙 정본이 아님 |

## 핵심 루프

```text
턴 시작 드로우
→ 동전을 장전형 스킬에 배치하거나 소비형 스킬의 연료로 선택
→ 플립형: 기본 효과 + 면 효과 + 속성 코인 효과
→ 소비형: 플립 없이 확정 효과
→ 코인과 가용 스킬이 남으면 반복
→ 턴 종료: 미사용 코인 폐기 → 소환 행동 → 적 행동 → 다음 턴
```

## 기술 구조

TypeScript 모노레포다.

```text
packages/core       순수 리듀서 기반 헤드리스 전투·런 엔진
packages/content    TypeScript 리터럴 콘텐츠와 검증
apps/ui             Vite + React UI
 tools/sim          동일 코어를 사용하는 결정론 시뮬레이터
```

`초기 시드 + Command[]`가 전투를 재현하며, UI 연출과 시뮬레이터 지표는 같은 `CombatEvent[]`를 소비한다. 플립·셔플·적 행동 RNG 스트림을 분리해 행동 순서가 다른 난수 영역을 오염시키지 않게 한다.

## 개발과 검증

Node.js 22 이상과 pnpm 9를 사용한다.

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm sim play --seed 42 --auto
pnpm release:verify
```

현재 릴리스 게이트의 실행 순서와 임계값은 루트 `package.json`, `.github/workflows/ci.yml`, `scripts/check-budget.mjs`, `apps/ui/scripts/`가 정본이다. 테스트 개수와 번들 실제 바이트처럼 자주 변하는 값은 README에 복사하지 않는다.
