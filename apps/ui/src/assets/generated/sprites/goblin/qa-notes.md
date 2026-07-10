# Goblin Sprite QA

- Base lock: pass. The accepted full-body combat-idle anchor preserves the olive skin, tusks, skull shoulder guard, leather gear, curved sword, left-facing silhouette, and pixel-art density.
- `idle` (4 frames, 4 fps, loop): pass. Planted feet and stable sword; subtle breathing plus a readable blink; frame 4 returns closely to frame 1 with no hard loop seam.
- `attack` (4 frames, 8 fps, non-loop): pass. Compact raised-sword windup, forward horizontal slash, follow-through, and recovery are distinct; anatomy, scale, skull guard, and sword identity stay stable.
- `hurt` (4 frames, 8 fps, non-loop): pass after one regeneration. The first raw row was rejected because frame 4 was cropped at the canvas edge. The replacement reads as backward flinch, low stagger, regained footing, and settled combat idle with every body part in frame.
- Extraction: pass via connected components only; no slot fallback. All three states produced 4/4 non-empty RGBA frames.
- Alpha/chroma: pass. Frame reports and the final 1024x768 atlas contain zero chroma-adjacent/visible-magenta pixels and zero stale RGB values under fully transparent pixels.
- Border review: re-extracted at pixel-perfect logical height 86 after independent QA found edge contact at 128. The final manifest has zero edge-contact pixels, feet share a stable baseline, and every silhouette retains transparent padding.
- Final reports: `frames/frames-manifest.json.ok=true`, `sprite-sheet-alpha.report.json.ok=true`, `degraded_static_fallback=false`.
