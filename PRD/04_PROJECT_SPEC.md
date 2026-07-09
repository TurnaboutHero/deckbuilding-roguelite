# 코인플립 로그라이크 — 프로젝트 스펙 (AI 행동 규칙)

> AI에게 코드를 시킬 때 **항상 이 문서를 함께 공유**할 것.
> 아키텍처 근거와 상세 설계는 [docs/implementation-plan.md §3](../docs/implementation-plan.md)이 원본.

---

## 기술 스택

| 영역 | 선택 | 이유 |
|------|------|------|
| 언어 | TypeScript (strict) | 코어/콘텐츠/UI/시뮬 단일 언어, `satisfies`로 콘텐츠 타입 검증 |
| 게임 코어 | 순수 TS 패키지 (`@game/core`) | 프레임워크 의존 0 — 결정론 테스트·시뮬레이터·엔진 이식성 |
| UI | Vite + React (`@game/ui`) | 보드/카드형 UI는 DOM이 최속, 플립 연출은 CSS 3D |
| 콘텐츠 | TS 리터럴 (`@game/content`) | 수치 수정이 로직 diff와 안 섞임, JSON 파이프라인 불필요 |
| 테스트 | Vitest + fast-check | 골든 테스트 + property(불변식) 테스트 |
| 시뮬레이터 | 자체 CLI (`@game/sim`) | 봇 수천 판으로 §16.2 지표 측정 |
| 패키지 관리 | pnpm workspace | 4패키지 모노레포 |
| 저장 | localStorage | 계정 없음(확정), 전투 경계에서만 기록 |
| 배포 | **GitHub Pages** (확정) | 서버 없음, 리포에서 바로 호스팅, URL 공유로 플레이테스트 |
| 아트 | 픽셀 아트 32px + Neo둥근모 폰트 (확정) | 동전 플립 프레임 연출과 궁합, 에셋 규격화 |

## 프로젝트 구조

```
deckbuilding-roguelite/
├── docs/                  # PRD v0.3 + 구현 계획 v1.1 (규칙의 SSoT — 수정은 사람만)
├── PRD/                   # 이 문서 세트 + references/ (무드보드)
├── packages/
│   ├── core/              # 헤드리스 게임 로직 (React/DOM import 금지)
│   └── content/           # 코인/스킬/적/캐릭터 리터럴
├── apps/ui/               # Vite + React
└── tools/sim/             # 시뮬레이터 CLI
```

의존 방향(단방향 고정): `content → core`, `ui → core+content`, `sim → core+content`

## 절대 하지 마 (DO NOT)

- [ ] **core에서 `Math.random`/`Date.now` 쓰지 마** — 상태에 내장된 시드 RNG 스트림(flip/shuffle/ai)만. 결정론이 깨지면 리플레이·테스트·시뮬 전부 죽는다
- [ ] **UI에 게임 규칙 분기를 넣지 마** — "장전 가능한가"조차 코어의 `legal()`/dispatch 실패로 판정. UI는 상태를 그리고 커맨드를 던질 뿐
- [ ] **스킬 효과를 코드 함수로 구현하지 마** — 효과 원자(EffectAtom) 데이터로만. MVP에서 `custom` 원자 사용 0개
- [ ] **전투 해결 순서를 임의로 바꾸지 마** — docs/implementation-plan.md §5의 P0~P9/C0~C4/턴 구조가 명세. 애매하면 §4 결정 표를 먼저 읽어라
- [ ] **수치를 코드에 하드코딩하지 마** — 피해량/HP/코스트는 전부 `@game/content` 리터럴
- [ ] 리듀서 밖에서 CombatState를 변경하지 마 (경계에서 순수)
- [ ] 임시/영구 코인 구분, 소모 영역 격리(리셔플 제외)를 건너뛰지 마 — 퍼즈 불변식이 잡는다
- [ ] 테스트(골든+불변식) 통과 없이 마일스톤 완료라고 하지 마
- [ ] package.json 기존 의존성 버전을 멋대로 바꾸지 마

## 항상 해 (ALWAYS DO)

- [ ] 변경 전에 계획을 먼저 보여줘 (마일스톤 단위)
- [ ] 새 스킬/규칙 구현 시 골든 테스트를 **먼저** 추가 (docs 계획 §5.8 표가 정답지)
- [ ] 모든 상태 변화는 CombatEvent로 방출 — UI 연출과 시뮬 지표가 같은 이벤트를 소비
- [ ] 코인 총량 불변식(Σ영역 = 초기 10 + 생성 수)을 퍼즈 테스트에 유지
- [ ] 런/전투 시드를 화면에 표시 (버그 재현용)
- [ ] 에러는 RuleError로 — 사용자에게 왜 안 되는지 표시
- [ ] 한국어 UI 텍스트, 효과 설명은 EffectAtom→문자열 렌더러로 자동 생성

## 테스트 방법

```bash
pnpm test          # 전체 (골든 + property + 유닛)
pnpm -F @game/core test   # 코어만
pnpm sim play --seed 42   # CLI로 전투 1판 (M1부터)
pnpm sim run --games 1000 # 시뮬 지표 (M6부터)
pnpm dev           # UI 로컬 실행
pnpm build && pnpm typecheck
```

## 배포 방법

**GitHub Pages** (확정): GitHub Actions 워크플로에서 `pnpm build` → `apps/ui/dist`를 Pages에 배포.
- Vite `base: '/deckbuilding-roguelite/'` 설정 필수 (하위 경로 호스팅)
- SPA 라우팅은 해시 라우터 또는 404.html 폴백 사용
- 환경변수 없음

## 환경변수

없음 (서버·외부 API·비밀키 없음). 생기는 순간 이 문서에 먼저 등록할 것.

## [NEEDS CLARIFICATION]

- [ ] 없음 — 배포처(GitHub Pages)·픽셀 규격(32px+Neo둥근모) 확정 완료. 잔여 가정은 01_PRD.md 원장 참조
