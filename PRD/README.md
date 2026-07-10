# 코인플립 로그라이크 — 디자인 문서

> Show Me The PRD로 생성됨 (2026-07-10)
> **원본 심층 명세**: [docs/PRD.md](../docs/PRD.md) (v0.3) · [docs/implementation-plan.md](../docs/implementation-plan.md) (v1.1) — 규칙 충돌 시 원본이 이긴다.

## 문서 구성

| 문서 | 내용 | 언제 읽나 |
|------|------|----------|
| [01_PRD.md](./01_PRD.md) | 뭘 만드는지, 성공 기준, 디자인 방향, 가정 원장 | 프로젝트 시작 전 |
| [02_DATA_MODEL.md](./02_DATA_MODEL.md) | 콘텐츠/런타임/저장 3층 데이터 구조 | 코어 설계할 때 |
| [03_PHASES.md](./03_PHASES.md) | 3-Phase 계획 + 게이트 + 시작 프롬프트 | 개발 순서 정할 때 |
| [04_PROJECT_SPEC.md](./04_PROJECT_SPEC.md) | AI 행동 규칙 (절대 하지 마 / 항상 해) | AI에게 코드 시킬 때마다 |
| [PHASE1_HOLDS.md](./PHASE1_HOLDS.md) | Phase 1 사람 게이트·폴리시·증거 보류 원장 | Phase 2 진행 중 미완 항목 추적 |
| [references/](./references/) | 픽셀 아트 무드보드 4장 + sources.json | 아트 방향 잡을 때 |

## 다음 단계

Phase 1 자동 구현·검증·배포는 완료됐다. 사람 검증과 후속 폴리시는 [PHASE1_HOLDS.md](./PHASE1_HOLDS.md)에 보류 상태로 유지하고, Phase 2(M5~M6)는 Pumasi 작업으로 단계별 진행한다.

## 미결 사항 (가정 원장 요약 — 상세는 01_PRD.md)

- 확정: 픽셀 32px+Neo둥근모, 배포 GitHub Pages, 로컬 저장, 데스크톱 웹 우선
- 잔여 가정: 사운드 MVP 제외 / 한국어 단일 / 브라우저 지원 범위(최신 데스크톱) / UI 상세 레퍼런스 미수집(커버아트로 대체)
