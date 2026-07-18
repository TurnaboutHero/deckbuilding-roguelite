# frost-knight QA notes (2026-07-12)

- 도구 병용 provenance: **gongnyang-prompt-kit 선검증**(베이스 정련·행 프롬프트 6종 전부 ok=true·0E·0W —
  prompt-kit-validation/) + **sprite-gen component-row 파이프라인** (sprite-request.json·layout guides·
  결정론 추출·pixel_perfect·아틀라스). 생성 투입 프롬프트 = 킷 통과본 + 레이아웃 가이드 첨부.
- Base Lock Gate: y (전신·프로포션·정체성·실루엣·크로마 충족)
- Motion Continuity: idle 루프 심 OK(f4≈f1), attack 와인드업→전방 동작→유지/팔로스루→회수 판독 가능,
  hurt 플린치→스태거→복귀 판독 가능, 세 행 정체성 일관 — PASS

## Revalidation — 2026-07-18

- `gongnyang-prompt-kit` check: idle, attack, hurt refined prompts all returned `ok=true` with `0 errors` and `0 warnings`.
- `sprite-gen` deterministic extract → compose → preview was rerun from the existing raw component rows. `frames/frames-manifest.json.ok=true` and `sprite-sheet-alpha.report.json.ok=true`; each state has four declared frames.
- Runtime contract rechecked: `game_input=sprite-sheet-alpha.png`, `degraded_static_fallback=false`, and every manifest frame layout cell is `256×256`.
- Chroma/anatomy review: no visible-pixel green chroma remains in any canonical frame. The contact sheet and per-frame review preserve the full humanoid body, white hair, ice-blue plate, spear, and shield across idle, attack, and hurt.
- Known warning retained deliberately: attack frame 1 has 28 edge-pixel counts (14 unique edge pixels in direct inspection). This is the spear-tip contact at the thrust extreme, not cropped core anatomy or a chroma leak; the accepted full-thrust pose is otherwise within the safe body silhouette.
