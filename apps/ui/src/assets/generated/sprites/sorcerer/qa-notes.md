# 번개 결투사 (sorcerer 시각 교체) — P13 sprite-gen 런 QA 노트

- 판타지: 금발 포니테일 귀족 여성 결투가 — 작은 키 5등신 아담 체형(비율로만 표현), 사나운 눈매, 감청 결투복+흰 크라바트, 레이피어+검신 밀착 정전기. 노출 절제. 구 런(회색 머리 치비 지팡이 마법사)은 P13 컨셉 불일치로 전면 재생성.
- Base Lock 게이트: 후보 1 반려(장신 비율 — 아담 체형 요건 불충족) → 후보 2 **PASS** (전신·단일 idle·우향·5등신 아담 비율·그린 크로마 클린·분리 이펙트 없음).
- 프롬프트 킷: base 컴파일 프롬프트 ok=true·0E (prompt-kit-validation/base.refined.result.json, 공냥 킷 v2.0). 행 프롬프트는 prepare_sprite_run.py 생성본 사용.
- 크로마: **그린 #00FF00 명시 핀** — 금발/금장 웜톤 소재라 warrior 런과 동일 분기. prepare auto가 cyan을 제안했으나 옅은 청백 정전기 소재와의 충돌 위험으로 수동 핀.
- 추출: pixel_perfect(kCentroid·logical_height 86·palette 32·scale 2x), 상태당 4컴포넌트, frames-manifest ok=true.
  - **스케일 결정 기록**: 최초 logical_height 80은 3x 스케일(240px)로 스냅되어 warrior(86·2x=172px)보다 40% 크게 렌더 — 픽셀 밀도·상대 신장 모두 불일치. 파이프라인 기하상 2x 밀도에서 172px 미만 신장은 불가(1x는 밀도 계약 위반)하여 **86·2x로 통일**하고, 아담 체형은 5등신 비율·좁은 실루엣으로 표현. 절대 신장 차이는 파이프라인 제약으로 미구현 — 정직 기록.
- 행 재생성 이력: attack 1차(스파크 분리 컴포넌트 오염) → 2차(스케일 불일치) → 3차 PASS(슬롯 경계·밀착 강조). hurt 1차(스케일 불일치) → 2차 PASS(idle 행 스케일 레퍼런스 첨부).
- 아틀라스: 1024×768·256셀·idle/attack/hurt 각 4프레임, sprite-sheet-alpha.report.json ok=true, manifest frame_layout 런타임 계약 일치.
- 모션 QA (컨택트 시트+GIF 검수): idle=앙가르드 호흡 루프 PASS / attack=앙가르드→윈드업→런지 찌르기→회수 PASS(검 슬롯 내) / hurt=젖힘→움츠림→회복 PASS. 정체성 드리프트 없음.
- 생성 세션 SID (image_gen provenance):
  - base 후보1(반려): 019f6b26-3b42-7a10-b596-d89842785e29
  - base 후보2(채택): 019f6b28-cda0-7342-be63-e9665af958ec
  - idle: 019f6b2f-40fb-7a30-b782-7ece1e9d2b12
  - attack(채택 3차): 019f6b3d-2321-73b3-b5b9-8ecc48045a48 (반려 1·2차: 019f6b33-93de…, 019f6b37-6356…)
  - hurt(채택 2차): 019f6b37-6367-7113-9f69-6e9b474b325e (반려 1차: 019f6b2f-40fc-7ef0…)
