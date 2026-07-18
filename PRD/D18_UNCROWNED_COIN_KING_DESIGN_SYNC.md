# Directive 18 — Uncrowned Coin King Aurel Design Sync

Status: implemented and independently accepted on 2026-07-18. Numeric balance remains playtest-tunable.

## Scope

M-20 `uncrowned-coin-king-aurel` has 180 HP and replaces the composite Act 2
visit-10 boss encounter. The retired composite encounter remains available only
as a fixture fallback when Aurel is absent from a compact test database. Boss
rewards remain unchanged.

## Approved combat contract

- **Phase 1 — King's Levy:** Aurel opens a one-turn tax demand for one payable
  element and denomination 2, then uses a 10-damage strike. A paid demand makes
  the next ordinary strike deal 8 damage. A missed demand adds exactly one
  counterfeit, grants no shield, and arms a one-turn foreclosure against one
  exactly nominated hand coin. The degraded 8-damage result is used only when
  no payable tax element can be opened.
- **Royal Vault:** The vault holds at most six coins. Using a matching elemental
  coin recovers the oldest matching vault coin once per skill and removes 4
  block from Aurel. Source UID, element, global seizure order, and grants remain
  intact; source death returns all stored coins in global order.
- **Phase 2 — Lead Mint:** Entering below 70% HP removes one counterfeit and
  returns the oldest vault coin. `lead-decree` is a one-turn windup that marks
  the next three generated temporary elemental coins as Lead. During the active
  windup, two authored element UIDs and 16 unblocked skill HP damage each weaken
  it once, to a minimum of one remaining transformation. Aurel uses a 10-damage
  strike and a deterministic three-intent cycle whose barrier grants 3 block per
  vaulted coin, capped at 18.
- **Phase 3 — Royal Seizure:** Entering below 35% HP clears or converts pending
  Lead coins and returns the oldest vault coin. Aurel alternates a 12-damage
  strike with one-turn exact nominated seizure. When the vault reaches six,
  `crown-confiscation` arms: 22 damage plus two counterfeits. Recovering two
  vault coins or dealing 10 skill HP damage cancels it. Cancellation and normal
  resolution both return the oldest vault coin before ordinary rotation resumes.
- Both phase transitions use `transitionBeforeAction: true`, preventing an armed
  prior-phase windup from resolving across the threshold.

## UI, telemetry, and safety contract

- Exact ordered vault entries, frozen nominations, Lead remaining/weakening/
  active state, Crown recovery count, both cancel predicates, and cancelled
  intent IDs are visible or recorded as structured before/after facts.
- Colour is never the sole signal.
- D18 browser fixtures require localhost, `testMode=d18`, and a non-production
  Vite build. Production output removes the fixture sentinel strings entirely.
- M-18 Marcel's authored tax object is pinned by byte-equivalent deep equality,
  preventing D18's generalized tax engine from changing the existing elite.

## Balance note

The values above are the accepted implementation target. Encounter win rate,
tax pressure, and vault recovery cadence remain candidates for later tuning;
the state machine and cleanup rules are release-locked by regression tests.
