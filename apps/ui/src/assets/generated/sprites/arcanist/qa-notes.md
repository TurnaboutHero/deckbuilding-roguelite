# 마도기사 (arcanist 시각 교체) — P13 sprite-gen 런 QA 노트

- 판타지: 흑발 롱헤어 성인 여성 마법학원 학생 기사 — 청색 교복(남색 더블 재킷·플리츠 스커트·학원 배지), 성숙한 7등신 체형(비율로만 표현, 완전 불투명 복장·노출 없음), 자신감 있는 우향 시선, 손끝 밀착 마나 빛. 구 런(장발 남성+마도서)은 P13 컨셉 불일치로 전면 재생성.
- Base Lock 게이트: 후보 1 반려(체형 실루엣이 소스 대화의 정체성 보정과 불일치 — 워치독 시각 QA 반영) → 후보 2 **PASS** (전신·단일 idle·우향·성숙 실루엣·마젠타 크로마 클린).
- 프롬프트 킷: base 컴파일 프롬프트 ok=true·0E (prompt-kit-validation/base.refined.result.json, 공냥 킷 v2.0). 행 프롬프트는 prepare_sprite_run.py 생성본 사용.
- 크로마: **마젠타 #FF00FF 명시 핀** — 남색/흑발 소재로 핑크·보라 없음, 기존 arcanist 런과 동일 분기. prepare auto의 cyan 제안은 옅은 마나 빛(#7FB4E8)과의 충돌 위험으로 수동 핀.
- 추출: pixel_perfect(kCentroid·logical_height 86·palette 32·scale 2x — warrior와 동일 기하), 상태당 4컴포넌트, frames-manifest ok=true, 1차 통과.
- 아틀라스: 1024×768·256셀·idle/attack/hurt 각 4프레임, sprite-sheet-alpha.report.json ok=true, manifest frame_layout 런타임 계약 일치.
- 모션 QA (컨택트 시트+GIF 검수): idle=호흡 대기 루프(손끝 마나 점 유지) PASS / attack=마나 집속→내딛기→장저 캐스트(밀착 플래시)→회수 PASS / hurt=젖힘→움츠림→회복 PASS. 정체성 드리프트 없음.
- 컨택트 시트의 프레임 뒤 회색 패널은 pixel-perfect plain-twin 큐레이터 비교 패널로, 채택된 warrior 런의 QA 시트에도 동일하게 존재하는 표준 미리보기 표기다. 아틀라스 알파 감사 결과 idle 4셀 불투명 픽셀 5,872~6,332개(인물 실루엣만) — 배경 누출 없음.
- 생성 세션 SID (image_gen provenance):
  - base 후보1(반려): 019f6b26-3b38-7702-8097-6c6c33eedeff
  - base 후보2(채택): 세션 정리 선행으로 SID 미기록 (원본 파일 base-source.png 보존)
  - idle: 019f6b34-1955-7f63-9b24-9b191034e742
  - attack: 019f6b34-1954-7c43-a70d-879e178d6145
  - hurt: 019f6b34-190b-75f1-80af-67de8ec01d2a
