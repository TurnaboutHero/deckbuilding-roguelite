# deckbuilding-roguelite

동전 기반 로그라이크 덱빌딩 — 카드가 아닌 **동전**으로 덱을 짜는 턴제 전투 게임.

고정된 스킬 셋(상수)에 매 턴 무작위로 뽑히는 동전(변수)을 장전해 최적 효율을 찾는 퍼즐형 전투. 스킬은 실패하지 않는다 — 기본 효과는 항상 발동하고, 동전의 앞/뒷면이 추가 효과를 결정한다.

## 상태 — 1.0.0-rc.1 (engineering-complete / experience-unverified)

- **플레이**: https://turnabouthero.github.io/deckbuilding-roguelite/ (데스크톱+모바일, GitHub Pages 자동 배포)
- 콘텐츠: 캐릭터 4종(전사/수호자/마도사/냉기 기사) · 몬스터 9종+보스 · 10-레이어 런 그래프(전투/엘리트/상점/이벤트/보스) · 골드 경제
- 제품화: 반응형 모바일·런타임 합성 SFX(기본 음소거)·WCAG AA 대비·키보드 완주·저장 이중화+복구·번들 예산 게이트
- 릴리스 게이트(CI 차단): typecheck/lint/test(406)/sim smoke/playtest(458)/provenance/budget(총 2.6MiB·JS 320KiB·CSS 70KiB·단일 700KiB)/contrast AA/perf(LCP·CLS·롱태스크)
- **사람 미검증 유보**: 재미·손맛(M2/M4)·밸런스 확정(수치 전부 balance-provisional)·난이도 곡선·음색 취향 — `PRD/PLAYTEST_KIT.md`로 사람 게이트 실행

## 문서

| 문서 | 내용 |
|---|---|
| [docs/PRD.md](docs/PRD.md) | 제품 요구사항 (v0.4) — 코인/스킬/캐릭터 시스템, 행동 제한 규칙, MVP 범위, UX 요구사항 |
| [docs/implementation-plan.md](docs/implementation-plan.md) | 구현 계획 (v1.2, 확정) — 아키텍처, 규칙 확정, 전투 파이프라인 명세, 마일스톤 M0~M6, 테스트·밸런스 전략 |
| [docs/content-design-guide.md](docs/content-design-guide.md) | 콘텐츠 기획 가이드 — 캐릭터/스킬/몬스터 양식, 코스트·기대값 기준, 상점·이벤트 스펙 |
| [PRD/](PRD/README.md) | 바이브코딩용 문서 세트 (요약 PRD, 데이터 모델, Phase 계획, AI 행동 규칙) |

## 핵심 루프

```
드로우 5 → 스킬에 동전 장전/소비 → 플립 판정 → 효과 적용 → 턴 종료(미사용 동전 폐기)
```

## 기술 방향 (계획)

TypeScript 모노레포 — 헤드리스 코어(순수 리듀서, 결정론 RNG) / 콘텐츠(TS 리터럴) / Vite+React UI / 밸런스 시뮬레이터 CLI. 상세는 구현 계획 §2~3 참조.
