# Warrior sprite QA

- `idle` — PASS. Four readable combat-idle poses, stable feet/sword/identity, one blink, and a close first-to-last loop seam. No chroma-adjacent pixels.
- `attack` — PASS. Windup, forward strike, follow-through, and recovery are distinct; anatomy, armor, cape, scarf, and sword remain coherent. No chroma-adjacent pixels.
- `hurt` — PASS. Backward flinch, stagger, recovery, and settled combat stance read clearly without becoming an attack. Identity and held sword remain stable. No chroma-adjacent pixels.

Pipeline checks:

- `frames/frames-manifest.json`: `ok: true`, component extraction, 4 declared and extracted frames for every state.
- `sprite-sheet-alpha.report.json`: `ok: true`, 1024 x 768 RGBA atlas, 12 populated cells.
- Regenerated the idle row for an exact frame 4-to-1 return, then re-extracted at pixel-perfect logical height 86 with bbox-center alignment after independent QA found edge contact at 128. The final manifest has zero edge-contact and chroma-adjacent pixels in every frame.
- Motion QA reviewed in `qa/idle.gif`, `qa/attack.gif`, `qa/hurt.gif`, and the contact sheets.
