# Directive 14 검증 증거 — M09/M10

검증일: 2026-07-18

## 구현 범위

- M09 검은주머니 동전도둑: 공개 속성 고정 예고, 후보 UID 고정, 전투 한정 압수 보관, 동일 순서 반환.
- M10 회색탑 봉인술사: 최근 2개 플레이어 턴 기록, 2턴 봉인, 단일 사용 가능 스킬의 75% 효과 감소 대체, 다중 소유자 안전성.
- UI: 압수 예고·보관 더미·봉인/효과 감소 상태·원인 중심 전투 로그·모바일/강제 색상 대응.
- 조우: 2막·3막 그래프에 M09/M10을 추가하고 기존 동시 적 수 제한을 유지.

## 자동 검증

| 검증 | 결과 | 증거 |
|---|---|---|
| D14 core | PASS | 16/16 |
| D14 content | PASS | 3/3 |
| D14 UI | PASS | 3/3 |
| D12 관련 회귀 | PASS | 22/22 |
| 갑주 반향 회귀 | PASS | 8/8 |
| 전체 단위·통합 테스트 | PASS | 81 files, 776/776 |
| typecheck | PASS | core/content/ui/sim 오류 0 |
| lint | PASS | ESLint exit 0 |
| build | PASS | Vite production build exit 0 |
| feedback/content/assets | PASS | 각 게이트 exit 0 |
| 성능·번들 | PASS | JS 577,194 B / 589,824 B, 여유 12,630 B |
| 접근성 | PASS | a11y/contrast gate exit 0 |
| 모바일·브라우저 플레이테스트 | PASS | S1~S37, P13 multi-enemy, D9 enchants 전 항목 통과 |

## 리뷰

- Core 독립 리뷰: APPROVE, 지적 0.
- UI 독립 리뷰: APPROVE, 지적 0.
- 기존 React SSR `useLayoutEffect` 경고는 테스트 실패가 아니며 D14에서 새로 발생한 회귀가 아니다.

## 남은 수동 검증

M09/M10의 수치와 체감은 `balance-provisional`, `experience-unverified`로 유지한다. 실제 플레이 피드백 전까지 예고·취소·복구 규칙은 확정하되 HP와 피해량은 조정 가능하다.
