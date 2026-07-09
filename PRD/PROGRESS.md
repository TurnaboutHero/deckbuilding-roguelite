## 골 검토 요약 (Step 8 자동 생성)

- 목표: 동전 장전·플립 전투 MVP(Phase 1: M0~M4)를 헤드리스 코어 우선으로 구현, 배포 URL 포함 플레이 가능 상태 도달
- 마일스톤: M0 셋업 / M1 헤드리스 코어 / M2 UI+연출+배포 / M3 화염·화상·불씨 / M4 소비형·취급·일회성
- 필수 검증: pnpm typecheck · lint · test(골든+퍼즈+콘텐츠 lint) · build · sim play --seed 42
- scope 잠금: Non-goals(계정·상점·이벤트·모바일·사운드·타 속성) 금지, 04_PROJECT_SPEC "절대 하지 마" 준수, 코드 작성은 codex 위임 기본

---

# PROGRESS

## 현재 골

동전 장전·플립 전투 문법의 MVP(Phase 1: M0~M4)를 헤드리스 코어 우선으로 구현하고, 브라우저에서 플레이 가능한 상태(배포 URL 포함)로 만든다.

## 현재 마일스톤

마일스톤 3 (M2 최소 UI + 플립 연출 + 배포) 진행 중 — codex 위임 + Claude 검수 체제

## 완료

- [x] **M1 헤드리스 전투 코어** (2026-07-10) — content-types 스키마 전체(EffectAtom union, M3/M4 원자는 명시적 예약 에러), CombatState/순수 리듀서/이벤트, 플립 해결 P0~P9(3회 캡 P1 마킹, 1히트 패킷 합산, 패배 우선 판정), 턴 상태기계(T0 리셋·D3 자기 페이즈 방어 리셋·D7 폐기), 약탈자 고정 사이클(초기 의도 공개), CLI play --auto/fuzz, 테스트 14종. codex(신모델) 작성 → Claude 검수(수정: lint 3건, StatusId 확정 어휘 정합). 잔여 과제: attempt 소금 결선(M5), pileShuffled 이벤트(M2), 다중 적 타겟 UI(M5+)
- [x] **M0 프로젝트 셋업** (2026-07-10) — pnpm 모노레포(core/content/ui/sim), xoshiro128** 결정론 RNG(계층 derive + attempt 소금), RNG 테스트 7종, ESLint core 순수성 규칙, Vite+React 부트스트랩(base path), sim CLI, GitHub Actions CI. codex 작성 → Claude 검수(수정 2건: CoinUid/SlotId number 브랜드, sim CLI 내로잉) → 검증 통과. 런타임: Node 18(EOL, vitest 구동 불가) → Node 22.14 로컬 설치로 해결

## 마지막 검증 결과

```text
M1 (2026-07-10): typecheck 4/4 ✓ · lint ✓ · test 14/14 ✓ (골든 베기 10/6·방어 5/8,
결정론 리플레이, D0 캡 거부·리셋, 드로우/리셔플/부분, 승패 원자 판정, 퍼즈 100)
· sim play --seed 42 --auto → victory 10턴 ✓ · sim fuzz 1000판 불변식 0위반 ✓
M0 (2026-07-10): typecheck ✓ · lint ✓ · test 7/7 ✓ · build ✓ · sim ✓ · CI green ✓
```

## 실패 시도

| 시도 | 변경 | 결과 | 배운 점 |
| --- | --- | --- | --- |

## 현재 가장 안정적인 상태

M1 완료 커밋 — 헤드리스 전투 코어 전 검증 통과 (CLI로 전투 완주 가능)

## 다음 단계

M2 최소 UI + 플립 연출 + 배포 — UI 컴포넌트는 codex 위임(PRD §15.1 v0.3.1 레이아웃, 픽셀 아트 방향), GitHub Pages 배포 워크플로는 Claude 직접 작성(.github는 codex 수정 금지 영역). 완료 기준: 브라우저 전투 완주, URL 시드 재현, 배포 URL, 스크린샷, §15 표시 항목. 완료 시 "손맛 게이트 사람 대기" 기록

## 리스크 / 블로커

- 사람 게이트 2건은 골이 자동 통과할 수 없음: M2 손맛 플레이테스트, M4 갈등 관찰 — 도달 시 "사람 대기"로 기록
- 잔여 가정(01_PRD 가정 원장): 사운드 MVP 제외 / 한국어 단일 / 최신 데스크톱 브라우저만
- 코드 작성은 codex exec 위임이 기본 — codex 세션/인증 만료 시 직접 작성 폴백 (PLAN.md 운영 노트)

## 인수인계 메모

이 PROGRESS.md는 골잡이가 생성했다. 골 실행 중 매 체크포인트마다 갱신된다.

## 골 시작 기록
- 시작 시각: 2026-07-10T02:35:26+09:00
- 사용 CLI: claude_code
- 컴팩트 후 본문 길이: 975자
