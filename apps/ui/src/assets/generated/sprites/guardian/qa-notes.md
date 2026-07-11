# guardian QA notes (2026-07-11)

- base: 은갑주+파란 망토+마나 문양 원형 방패+철퇴, 전사 앵커와 동일 16비트 스타일/프로포션 — Base Lock Gate y
- rows: idle/attack/hurt 각 4프레임, component-row 파이프라인 (green #00FF00 → pixel_perfect logical_height 86, palette 32)
- Motion Continuity: idle 루프 심 OK(f4≈f1, 방패·철퇴 좌표 고정), attack 와인드업→스윙→신전→회수 판독 가능(방패 좌완 유지),
  hurt 플린치→스태거→복귀 판독 가능. 세 행 모두 정체성 일관 — PASS
- provenance: sprite-request.json + prompts/ + raw/ 보존, AI 개입은 raw 생성 1곳뿐

## gongnyang-prompt-kit 검증 기록 (사후 실행 — 정직 기록)

- 사실: 이 런의 프롬프트는 생성 **전에** 킷으로 컴파일되지 않았다. 감시자 지적 후
  `check_prompt.mjs`를 실행해 결과를 `prompt-kit-validation/*.result.json`에 보존했다.
- 결과: base ok:false (E-AR-END·E-CAT-LANG·E-TEX-LANG), idle/attack/hurt ok:false (각 6 errors).
- 판정: 스프라이트 행 프롬프트는 sprite-gen 프롬프트 계약이 SSoT다 — 킷 규칙 중
  조명/질감/카메라 절 요구는 sprite-gen의 "scenery·조명 언어 금지" 게이트와 직접 충돌하고,
  AR·스타일 진실은 첨부 앵커 이미지/레이아웃 가이드가 소유한다. **장르 불일치로 비적용(regenerate 안 함).**
- 프로세스 수정: P3.3+ 카드 아트·일러스트류(킷 장르)는 생성 전 킷 컴파일을 선행한다.

## 킷 정련(refined) 프롬프트 — 게이트 통과 기록 (2차)

- `prompt-kit-validation/`에 원문(*.txt)·정련본(*.refined.txt)·검증 결과(*.result.json / *.refined.result.json) 보존.
- 정련본 4종(base/idle/attack/hurt) 전부 **ok=true, errors 0, warnings 0**.
- 중대성 판정: 정련이 추가한 것은 AR 토큰·카테고리 선두 절·플랫 조명/픽셀 질감 절·팔레트 HEX 축약 —
  전부 첨부 앵커 이미지와 레이아웃 가이드가 이미 강제하던 제약의 문서화이며, 정체성·모션·크로마·구도 등
  생성 핵심은 불변. **비중대(not material) → 수용된 자산 유지, 재생성 불필요.**
  정련본이 이후 재생성·후속 상태 행의 표준 프롬프트 서식이 된다.
