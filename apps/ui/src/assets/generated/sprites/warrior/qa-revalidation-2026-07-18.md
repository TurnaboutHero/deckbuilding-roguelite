# Warrior sprite-gen revalidation — 2026-07-18

This review confirms the existing warrior run is a complete `component-row` production asset, not a static fallback.

## Locked identity and prompt contract

- **Base Lock Gate: PASS.** `base-source.png` is a full-body, uncropped, right-facing flame fighter in a clear boxing guard, with the same red hair, warm skin palette, wraps, dark cropped top, and loose brown trousers used by every row.
- **Chroma gate: PASS.** The subject contains red hair and warm skin, so the request explicitly pins green `#00FF00`; it avoids a red/magenta conflict and the atlas has zero opaque near-key-green pixels.
- **Prompt-kit: PASS.** `check_prompt.mjs` reports `ok=true`, zero errors, and zero warnings for `base`, `idle`, `attack`, and `hurt` refined prompts.

## Deterministic component-row output

- `sprite-request.json` declares `component-row`, three states (`idle`, `attack`, `hurt`), four frames each, `256x256` cells, and `pixel_perfect=true` with logical height `86` and a shared 32-colour palette.
- `frames/frames-manifest.json`: `ok=true`; every state uses connected-component extraction and has four non-empty frames.
- `sprite-sheet-alpha.report.json`: `ok=true`; the runtime atlas is a `1024x768` 4-by-3 RGBA atlas with `degraded_static_fallback=false`.
- Fresh read-only atlas QA found `transparentRgbLeaks=0` and `opaqueNearKeyGreenPixels=0`.

## Motion and anatomy review

- `qa/all-contact.png` was reviewed at original resolution.
- **Idle:** four readable guard/breathing poses; first and last return to the same stable guard.
- **Attack:** guard → wind-up → full straight punch → recovery, with both feet grounded and the striking arm attached throughout.
- **Hurt:** recoil → guarded compression → recovery; silhouette, hands, and feet remain coherent frame-to-frame.
- No detached effects, guide boxes, chroma background, cropped anatomy, or static-fallback frames were observed.
