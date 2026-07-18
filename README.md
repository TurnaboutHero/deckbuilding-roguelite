<div align="center">

# Coin Combat

**동전을 장전하고, 앞면과 뒷면의 불확실성을 전술로 바꾸는 턴제 로그라이트**

고정 스킬 세트와 성장하는 동전 주머니를 조합하는 무료 웹 프로토타입입니다.

[![Play Demo](https://img.shields.io/badge/%E2%96%B6_Play_Demo-Live-success?style=for-the-badge)](https://team-project-0-1.github.io/deckbuilding-roguelite/)
[![Status](https://img.shields.io/badge/Status-Prototype-orange?style=for-the-badge)](#현재-상태)
[![License](https://img.shields.io/badge/License-Proprietary-lightgrey?style=for-the-badge)](#라이선스)

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-9-F69220?logo=pnpm&logoColor=white)

</div>

## 지금 플레이하기

**▶ [team-project-0-1.github.io/deckbuilding-roguelite](https://team-project-0-1.github.io/deckbuilding-roguelite/)**

설치 없이 브라우저에서 바로 실행할 수 있습니다. 현재 빌드는 판매용 1.0이 아니라 핵심 전투, 캐릭터별 빌드, 사용자 이해도를 검증하기 위한 무료 프로토타입입니다.

## 왜 이 프로젝트인가

Coin Combat는 확률 결과를 기다리는 게임이 아니라, 불확실한 동전을 어느 스킬에 언제 투자할지 결정하는 게임입니다.

- **동전 주머니 덱빌딩** — 카드를 뽑는 대신 속성 동전을 획득하고 주머니의 확률 분포를 성장시킵니다.
- **캐릭터별 전술** — 화상·과열, 소환 장비, 감전·르미즈, 냉기·보존, 혈마검처럼 동전을 다루는 방식이 달라집니다.
- **결정론 전투 코어** — 동일한 시드와 명령으로 전투를 재현하고 시뮬레이터와 UI가 같은 이벤트 계약을 사용합니다.
- **운영 가능한 웹 프로토타입** — 모바일, 접근성, 저장 복구, 성능 예산, 브라우저 플레이테스트를 CI에서 검증합니다.

## 현재 상태

> P13 + D19 · PRD v2.1 · 콘텐츠 `1.7.0-revision` · 런 저장 v10
>
> 공학 상태: `engineering-safe` · 밸런스: `balance-provisional` · 경험: `experience-unverified`

- 캐릭터: 화염 격투가, 번개 결투사, 냉기 도적, 마도기사, 혈액 마검사
- 몬스터: 중세 판타지 역할군 20종 구현. 일반·교란·성장·소환·엘리트·보스 기믹은 모두 예고와 대응 경로를 가진 잠정 밸런스다.
- 코인: 기본 + 화염·마나·냉기·전기·혈액. 속성 코인은 앞면과 뒷면에 서로 다른 효과를 가집니다.
- 전투: 장착 8슬롯, 시작 4스킬, 전역 행동 횟수 제한 없이 스킬별 쿨다운으로 조절합니다.
- 런: 3막 × 막당 10방문. 전투·엘리트·상점·이벤트·보물·휴식·보스 노드와 골드 경제가 있습니다.
- 사람 검증 유보: 재미·손맛, 최종 밸런스, 난이도 곡선, 시각 취향은 [`PRD/PLAYTEST_KIT.md`](PRD/PLAYTEST_KIT.md)의 테스트 대상입니다.

## 핵심 루프

```text
턴 시작 드로우
→ 동전을 장전형 스킬에 배치하거나 소비형 스킬의 연료로 선택
→ 플립형: 기본 효과 + 면 효과 + 속성 동전 효과
→ 소비형: 플립 없이 확정 효과
→ 동전과 가용 스킬이 남으면 반복
→ 턴 종료: 미사용 동전 폐기 → 소환 행동 → 적 행동 → 다음 턴
```

## 캐릭터와 시각 방향

캐릭터 선택 화면은 캐릭터의 속성·무기·성격·플레이스타일을 보여주는 스탠딩 일러스트를, 실제 전투는 가독성 높은 도트/SD 스프라이트를 사용하는 방향으로 분리합니다. 기존 전투 스프라이트는 계속 사용하며 고품질 선택 일러스트는 원본과 캐릭터 매핑이 확정되는 순서대로 교체합니다.

세부 합의와 보류 항목은 [`docs/project-direction.md`](docs/project-direction.md)에 기록합니다.

## 기술 구조

TypeScript 모노레포입니다.

```text
packages/core       순수 리듀서 기반 헤드리스 전투·런 엔진
packages/content    TypeScript 리터럴 콘텐츠와 검증
apps/ui             Vite + React UI
tools/sim           동일 코어를 사용하는 결정론 시뮬레이터
```

`초기 시드 + Command[]`가 전투를 재현하며, UI 연출과 시뮬레이터 지표는 같은 `CombatEvent[]`를 소비합니다. 플립·셔플·적 행동 RNG 스트림을 분리해 서로 다른 난수 영역이 행동 순서에 오염되지 않게 합니다.

## 빠른 시작

Node.js 22 이상과 pnpm 9를 사용합니다.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

주요 검증 명령:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm ci:sim
pnpm build
pnpm release:verify
```

## 검증과 배포

- `.github/workflows/ci.yml`: 타입, lint, 단위 테스트, 시뮬레이션, 빌드, 콘텐츠·자산 예산을 검증합니다.
- `.github/workflows/deploy.yml`: `main`의 CI 성공 SHA만 GitHub Pages에 배포합니다.
- `.github/workflows/release.yml`: `v*` 태그의 전체 릴리스 게이트와 Pages 배포가 성공한 뒤 GitHub Release를 생성합니다.

GitHub Pages 배포 경로는 `/deckbuilding-roguelite/`입니다. 클라이언트 빌드에는 API 키가 필요하지 않습니다.

### 운영·분석 확장 계획

초기 외부 플레이테스트 기간에는 GitHub Pages와 현재 GitHub Actions 배포 흐름을 유지한다. 정적 웹게임을 빠르게 수정·공개하고 반응을 확인하는 것이 우선이므로, Cloudflare Pages로의 즉시 이전은 진행하지 않는다.

다음 조건이 확인되면 Cloudflare 이전 또는 연동을 재검토한다.

- 커스텀 도메인, 배포 미리보기 또는 CDN 운영 요구가 생긴 경우
- 익명 플레이 이벤트·피드백을 수집할 Worker 기반 API가 필요한 경우
- GitHub Pages의 운영 한계가 실제 플레이테스트를 방해하는 경우

방문 수·유입 경로·실사용 성능은 Cloudflare Web Analytics를 후보로 검토한다. 캐릭터 선택, 전투 시작·종료, 런 종료 같은 게임 행동 이벤트는 별도 익명 수집 API가 필요하며, 현재의 플레이 로그는 사용자가 직접 내려받는 로컬 JSON으로만 유지한다. 외부 전송은 수집 항목, 보관 기간, 고지 방식을 합의한 뒤에 도입한다.

## 문서

문서 세대가 섞여 있으므로 먼저 [`docs/README.md`](docs/README.md)의 우선순위를 확인합니다.

| 문서 | 역할 |
|---|---|
| [`docs/project-direction.md`](docs/project-direction.md) | 공개 전략, 타깃, 그래픽, 에셋, 테스트에 대한 내부 의사결정 |
| [`docs/PRD.md`](docs/PRD.md) | 제품 요구사항과 게임 규칙의 단일 정본 |
| [`docs/current-implementation.md`](docs/current-implementation.md) | 현재 코드 기준 아키텍처·전투·런·저장·CI 안내 |
| [`docs/content-design-guide.md`](docs/content-design-guide.md) | 신규 코인·스킬·캐릭터·몬스터 작성 기준 |
| [`PRD/PLAYTEST_KIT.md`](PRD/PLAYTEST_KIT.md) | 사람 플레이테스트 절차와 기록 양식 |

## 라이선스

© 2026 프로젝트 0.1% (기획 WinTi · 개발 TurnaboutHero). **All Rights Reserved**.

이 저장소의 코드·디자인·이미지·사운드·텍스트는 팀에 귀속됩니다. 사전 서면 허가 없이 복제, 재배포, 파생 저작물 제작 또는 상업적 이용을 금합니다. 포트폴리오 검토를 위한 열람은 허용하며, 재사용·인용 요청은 저장소 이슈로 문의해 주세요.

자세한 조건은 [`LICENSE.md`](LICENSE.md)를 확인하세요. 생성 자산의 제작·검증 기록은 `apps/ui/src/assets/generated/`와 [`docs/ui/card-art-provenance-p32.md`](docs/ui/card-art-provenance-p32.md)에 보존합니다.

### 크레딧

- 기획·아이디어 원안 — WinTi
- 개발 — TurnaboutHero
- 밸런스 — WinTi · TurnaboutHero 공동
