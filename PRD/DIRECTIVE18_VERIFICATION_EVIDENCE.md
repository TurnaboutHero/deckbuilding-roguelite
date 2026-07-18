# Directive 18 Verification Evidence — M20 Uncrowned Coin King Aurel

Status: accepted and release-verified on 2026-07-18.

## Acceptance evidence

1. Content and graph select Aurel for production Act 2 visit 10, retain the old
   composite only for compact-database fixtures, and preserve rewards.
2. Core/content tests cover paid and defaulted tax, one-default foreclosure,
   exact capacity/order, matching recovery, block loss, enchanted coin return,
   and source-death cleanup.
3. Lead tests cover two authored UID route reading, both once-only weakening
   routes, minimum-one floor, active-window enforcement, post-windup generated
   coins, and phase-entry cleanup.
4. Phase-3 tests cover exact frozen nomination, spend-to-escape, full-vault Crown
   arming, both cancellation predicates, cancelled intent telemetry, resolution
   return, vault-five continuation, and ordinary rotation resumption.
5. UI and telemetry expose ordered entries, nominations, recovery/cancel state,
   and full Lead active-to-inactive lifecycle. Production build removes D18 test
   fixture sentinels.
6. Browser coverage passes tax paid/default, foreclosure escape, both Lead
   weaken routes, post-windup generation, exact seizure, both Crown cancels,
   Crown resolution, and victory with zero browser errors.
7. M-18 Marcel's `royalTax` authored data is pinned by exact deep equality.

## Final four-dimension gate

| Dimension | Evidence | Result |
|---|---|---|
| Functional correctness | Full Vitest suite plus focused D18 core/content/UI/telemetry suite; Crown resolution returns the oldest coin and resumes at vault five | PASS |
| Data and compatibility | Content validation, Act 2 route-selection test, compact-fixture fallback, unchanged rewards, exact M-18 data pin | PASS |
| Runtime and UX | Full browser/mobile playtest and focused D18 browser lane; structured UI state; zero scenario errors | PASS |
| Performance and release | Typecheck, lint, build, deterministic 500-run simulation, provenance, feedback, contrast, budget and perf gates | PASS |

## Recorded measurements

- Deterministic simulation: 500/500 terminal, 0 crashes, 0 invariant failures;
  policies end before Act 2 in this smoke lane, so no new D18-attributed failure.
- Production bundle budget: total 3,160,324 B; JavaScript 612,329 B; CSS
  86,689 B; maximum file 651,044 B.
- Performance rerun: median TTI 347 ms, median LCP 440 ms, worst CLS
  0.000482, and no long task above the 200 ms gate.
- Accessibility contrast: every named combat and shop surface passed.
- Independent D18 review: ACCEPT after production guard, browser, telemetry,
  vault aggregation, and Lead lifecycle revalidation.

The first integrated performance attempt recorded one 203 ms long task. The
immediate clean rerun recorded no over-budget long task, so it is retained here
as timing variance rather than hidden as a passing-only sample.
