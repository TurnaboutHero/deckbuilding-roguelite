# blood-spellblade sprite-gen QA notes

- Pipeline: `component-row` with an accepted full-body base lock, green chroma key (`#00FF00`), deterministic pixel-perfect extraction (`logical_height=86`, `palette_size=32`, foot-centroid/bottom alignment), and manifest-driven 256x256 atlas cells.
- Base Lock Gate: **PASS**. The anchor is a complete screen-right Korean/Joseon-inspired female swordswoman, with closed eyes, shaman robes, full curved crimson blood hwandо, and the required toothy maw near the hilt. The full body and weapon fit in the green chroma field.
- Automated QA: **PASS**. `frames-manifest.json.ok=true`, every idle/attack/hurt state has four connected-component frames, zero edge pixels, zero chroma-adjacent pixels, and `sprite-sheet-alpha.report.json.ok=true`.
- Motion continuity: **PASS after attack regeneration**. Idle keeps its planted silhouette and reads as a very small breath loop; attack reads windup → compact connected slash → follow-through → recovery, with the sword and maw attached; hurt reads recoil → stagger → settling recovery. Per-frame human anatomy has one head, two arms, and two legs, with no cropped body parts or disconnected attack effect.
- Chroma check: green was chosen because crimson blood and robe trim are magenta-adjacent; the post-extraction report records no chroma-adjacent pixels, preserving the blood blade material.
