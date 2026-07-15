# Combat UX Automation Completion Plan

> Date: 2026-07-15
> Branch: `codex/ux-followup-complete`
> Goal: Complete every remaining in-scope item from the playtest usability/visibility document, including ordered turn-end skill execution.
> Status: 구현 및 집중 회귀 완료 · 전체 릴리스 재검증 진행 중

## Product decision

Manual use remains the default. A fully loaded flip skill keeps the existing card action bar and exposes `스킬 사용`; the card title and art remain informational. If the player presses turn end while fully loaded skills are still unused, a contextual warning offers `실행 후 턴 종료`, `사용하지 않고 턴 종료`, and `돌아가기`.

Checking `앞으로 장전 스킬 자동 실행` while confirming persists an opt-in. The same option is reversible in combat settings. In automatic mode, the UI submits existing `useFlipSkill` commands one at a time in the visible order, pauses for required choices, waits for the real animation queue, and finally enters the existing preserve/end-turn flow.

The core `endTurn` command remains unchanged. This preserves simulator/replay semantics and keeps direct `endTurn` from implicitly firing loaded skills.
## Global constraints

- Preserve all existing balance, skill costs, damage, enemy behavior, and run progression.
- Preserve the direct-core contract: `endTurn` itself never activates a loaded skill.
- Execute ordinary legal skill commands sequentially; never batch them with `stepSequence`.
- Recompute legality and targets after every resolved skill.
- Never silently skip a newly illegal loaded skill and end the turn. Pause visibly with recovery actions.
- Freeze execution-order editing while an automatic sequence is active.
- Pause and resume the sequence for coin, equipment, summon, enemy-target, and preserve choices.
- Stop the sequence immediately on victory or defeat.
- Use animation/event-queue completion, not fixed delays, so normal/fast/instant modes behave consistently.
- Preserve physical slot identity. Store a separate list of slot IDs for execution order.
- Every pointer interaction must have a keyboard/touch alternative and a minimum 44px touch target where practical.
- Do not add dependencies.
- Do not implement character balance changes, retreat, or full idle/autobattle.

## Task 1 — Pure execution-order and queue model

**Files**

- Create `apps/ui/src/auto-turn-end.ts`
- Create `apps/ui/src/auto-turn-end.test.ts`
- Update `apps/ui/src/interaction.ts` only if a shared legal-command helper is required
- Update `apps/ui/src/interaction.test.ts` for that helper

**Work**

- [x] Define a turn-local `ExecutionOrder` as slot IDs without mutating combat slot arrays.
- [x] Reconcile the order when slots/load state change: retain known loaded slots, append newly loaded slots, remove missing/empty slots.
- [x] Expose pure helpers for loaded/partial/not-queued classification, order moves/swaps, queue snapshots, and queue transitions.
- [x] Model idle, running, choosing, preserving, blocked, cancelled, and finished states.
- [x] Cover duplicate effect calls/idempotence with a workflow ID + active-slot token design.
- [x] Test default load order, reorder, unload/reload, partial loads, duplicate slots, blocked state, cancellation after partial completion, and finish.

**Verification**

- `pnpm vitest run apps/ui/src/auto-turn-end.test.ts apps/ui/src/interaction.test.ts`

## Task 2 — Explicit choice completion and telemetry fidelity

**Files**

- Create `apps/ui/src/equipment-choice.ts`
- Create `apps/ui/src/equipment-choice.test.ts`
- Update `apps/ui/src/App.tsx`
- Update `apps/ui/src/telemetry.ts`
- Update `apps/ui/src/telemetry.test.ts`
- Update simulator replay types/readers under `tools/sim/src/human/`
- Update the relevant simulator tests

**Work**

- [x] Generalize the explicit command runner so UI-selected coins, equipment, summon, target, and preservation are reducer-validated without replacing them with policy defaults.
- [x] Add a distinct equipment-type chooser for skills that require `chosenEquipment`.
- [x] Keep the existing summoned-instance chooser but rename its copy to avoid confusing it with equipment type.
- [x] Upgrade recorded decisions without breaking older telemetry: preserve flip/consume choices, desired coin, explicit preservation, and optional `manual | auto-turn-end` source.
- [x] Ensure simulator replay reconstructs these optional fields while remaining backward-compatible.

**Verification**

- `pnpm vitest run apps/ui/src/equipment-choice.test.ts apps/ui/src/telemetry.test.ts tools/sim`

## Task 3 — Visible execution rail and accessible ordering

**Files**

- Update `apps/ui/src/App.tsx`
- Update `apps/ui/src/App.css`
- Update `apps/ui/src/auto-turn-end.test.ts`
- Update `apps/ui/scripts/feedback-check.mjs`

**Work**

- [x] Show a compact execution rail only when at least one skill is fully loaded.
- [x] Display `1`, `2`, `3` sequence badges on loaded cards and the rail.
- [x] Show skill name plus pending/current/completed/blocked state in the rail.
- [x] Support desktop drag reorder without interfering with coin drag/swap.
- [x] Support keyboard/mobile reorder with explicit earlier/later controls and useful accessible labels.
- [x] Keep order controls disabled and visually frozen during execution.
- [x] Keep `턴 종료` in manual mode, show the contextual warning only for unused loaded skills, and use `스킬 N개 자동 실행 후 턴 종료` after opt-in.
- [x] Mark partial loads as `미완료 · 실행 안 됨` rather than assigning them an order number.

**Verification**

- Focused Vitest plus a browser scenario that reorders two loaded skills and verifies the visible order.

## Task 4 — Sequential turn-end execution workflow

**Files**

- Update `apps/ui/src/App.tsx`
- Update `apps/ui/src/auto-turn-end.ts`
- Update corresponding tests
- Add/update browser checks under `apps/ui/scripts/`

**Work**

- [x] Snapshot the current loaded-skill order when the primary turn-end button is pressed.
- [x] Run one ordinary `useFlipSkill` command at a time and wait for unlock/event completion before advancing.
- [x] Pause for coin, equipment, summon, and enemy-target choices, then resume the same queue exactly once.
- [x] Disable unrelated card actions, unloading, reorder, and turn end while the workflow is active.
- [x] Provide a visible cancel action; completed effects remain and remaining skills stay loaded.
- [x] On an illegal queued skill, show the reason and offer `순서·장전 수정`, `다시 시도`, and `남은 스킬 건너뛰고 종료` rather than silently skipping.
- [x] After the queue completes, enter the existing Cold Rogue preserve selection using the post-skill state, then submit ordinary `endTurn`.
- [x] Stop without enemy phase on victory/defeat.
- [x] Preserve the existing core regression asserting direct `endTurn` does not auto-fire skills.

**Verification**

- Browser scenarios: ordered two-skill run; target chooser; coin chooser; equipment chooser; summon chooser; Cold Rogue preserve; partial load; blocked skill; cancellation; victory short-circuit; normal/fast/instant modes.

## Task 5 — Remaining combat information and convenience UI

**Files**

- Update `apps/ui/src/App.tsx`
- Update `apps/ui/src/App.css`
- Add small pure/test files when logic would otherwise remain embedded in `App.tsx`

**Work**

- [x] Add a compact current-turn summary near the primary button: usable, loaded, queued, and discarded-on-end coin counts.
- [x] Add a persistent scrollable combat log/history; keep the existing short-lived resolution ticket as immediate feedback.
- [x] Add `추천 장전` as a non-firing convenience: preview the proposed left-to-right legal placement, require confirmation, and never choose strategic optional effects invisibly.
- [x] Improve the mobile coin rail with clear left/right affordances, end-state disabling, next-item peek, and current position/count text.
- [x] Keep all existing unload and loaded-coin swap behavior.
- [x] Add a persistent `?` combat help entry covering loading, execution order, automatic turn end, targets, discard/preserve, cooldowns, and statuses.

**Verification**

- Unit tests for summary/recommendation helpers and focused mobile browser checks at 390×844 and landscape.

## Task 6 — Complete visibility and motion settings

**Files**

- Create `apps/ui/src/combat-preferences.ts`
- Create `apps/ui/src/combat-preferences.test.ts`
- Update `apps/ui/src/App.tsx`
- Update `apps/ui/src/App.css`
- Update `apps/ui/src/vfx.css`
- Update `apps/ui/scripts/a11y-contrast.mjs`

**Work**

- [x] Consolidate persistent combat preferences with backward-compatible reading of current flip-speed/mute values.
- [x] Provide flip speed, screen shake, damage-number size, tooltip size, high-contrast mode, background-effect reduction, reduced motion, and sound controls.
- [x] Apply high contrast and size choices with root data attributes/CSS variables rather than duplicated component branches.
- [x] Ensure `prefers-reduced-motion` still overrides unsafe animation even when the local setting is permissive.
- [x] Keep defaults visually consistent with the current art direction.

**Verification**

- Preference unit tests, contrast script, and browser screenshots for default/high-contrast/reduced-effects states.

## Task 7 — Documentation and release verification

**Files**

- Update `.omx/plans/2026-07-15-playtest-usability-visibility-hotfix.md`
- Update `docs/PRD.md`
- Update `docs/current-implementation.md`
- Update `PRD/PROGRESS.md`
- Update regression scripts/screenshots/manifests only where the verified UI changed

**Work**

- [x] Replace the old explicit exclusions for auto execution/order/recommendation/visibility with the implemented behavior and rationale.
- [x] Document the manual escape hatches: unload/reorder before execution, cancel during execution, blocked recovery, preserve selection.
- [x] Record the UX-001..024 completion matrix and retain explicit exclusions for balance, retreat, and full idle/autobattle.
- [ ] Run and repair the complete relevant verification suite.
- [x] Manually inspect desktop, portrait mobile, and landscape mobile against the original feedback problems.

**Verification**

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm ci:sim`
- `pnpm build`
- `pnpm check:feedback-regression`
- `pnpm check:content`
- `pnpm check:assets`
- `pnpm check:perf`
- `pnpm check:a11y`
- Focused mobile/browser suite; run the full mobile playtest when its runtime is stable enough to complete.

Current evidence: typecheck, lint, Vitest 58 files / 572 tests, production build, focused ordered/choice/blocked/cancel/victory/preserve/three-speed browser regression, feedback regression, desktop and 390×844 / 844×390 inspection, and accessibility contrast have passed. The unchecked full-suite item below is reserved for the final combined release run, not an implementation gap.

## Completion criteria

- [x] A first-time player can load coins without needing to discover a manual skill-use click.
- [x] The exact skill execution order is visible and changeable before turn end.
- [x] Automatic execution pauses safely for every choice and never double-runs a command.
- [x] Partial or newly illegal skills are never silently consumed.
- [x] The player can see what will execute and what resources will be lost before committing.
- [x] All 24 documented usability/visibility items are complete or explicitly demonstrated by existing code and regression evidence.
- [x] Desktop and mobile remain playable in default, fast, and instant flip modes.
- [ ] Full verification passes with no known regressions.
