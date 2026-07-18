# Directive 19 — Character Data Authority and Alignment

> Date: 2026-07-18 · status: implementation-aligned / engineering-verified / balance-provisional / experience-unverified

## 1. Authority chain

1. `docs/PRD.md` is the product-rule SSoT.
2. Google Doc v1.2 (`1GZPbh3TPfJcbC_DYOUGZsZZwZoEsbYPZkm5QXQIMCQI`, revision 3, modified 2026-07-17T10:11:30.545Z) is the current Drive system context.
3. Google Doc v1.1 (`1Ali-Bl_z9gySz2sdlbpbvqW8ZYVLlZYTbz-Or7fIIvo`, revision 2035, modified 2026-07-17T09:46:34.219Z) is context-only.
4. `캐릭터 데이터 테이블` (`1D_7wrcMi5dTmzgn19WvphJLz0QjIWMbHwH5D4OzcH4s`, revision 148, modified 2026-07-17T18:56:04.736Z) supersedes a deferred value only when the row's `DesignState` is exactly `확정`.
5. `1차 테스트`, `최종 수정`, and `기획` rows are present but non-authoritative. They are not silently promoted to implementation requirements.

The immediately sampled prior Sheet revision was 27, modified 2026-07-17T16:26:16.238Z. Revision 148 reorganized the data into operational, character, system, all-skill, dictionary, dropdown, common, and character-specific tabs.

## 2. Current row classification

| Scope | Total | `확정` | Present but unconfirmed | Empty |
|---|---:|---:|---:|---:|
| Common | 2 | 2 | 0 | 0 |
| Flame Fighter | 16 | 0 | 16 | 0 |
| Mage Knight | 20 | 2 | 18 | 0 |
| Electric Duelist | 20 | 0 | 20 | 0 |
| Frost Rogue | 20 | 0 | 20 | 0 |
| Blood Spellblade | 21 | 2 | 19 | 0 |

The six character-definition rows in `02_캐릭터` are also `확정`; they confirm roster identity, starting sets, unique passives, and high-level mechanics. They do not promote the unconfirmed character-tab skill values.

## 3. Confirmed-row audit

| Confirmed row | Runtime mapping | Evidence | Regression evidence | D19 action |
|---|---|---|---|---|
| `COMMON_ATTACK` | `slash`; Flame Fighter equivalent `jab` | `packages/content/src/index.ts` definitions: cost 1, heads success, damage 4, repeat | `packages/content/src/content.test.ts`, “ships the confirmed neutral basics…” and “ships every v1.2 one-coin basic…” | Upgrade 4→5 corrected to confirmed 4→6 |
| `COMMON_DEFENSE` | `guard`; Flame Fighter equivalent `fist-guard` | same file: cost 1, tails success, block 4, repeat | same two regression tests | Upgrade 4→5 corrected to confirmed 4→6 |
| `MK_MANA_CHARGE` | `arcane-charge` | chosen equipment duration 2, +1 per tails, temporary mana to hand 1 | `packages/content/src/content.test.ts` Mage Knight content assertions | No delta |
| `MK_COMMAND` | `arcane-command` | chosen summon action, +1 per tails, summon -1 in resolver, mana to discard 1 | content and summon-command regressions | No delta |
| `BS_BLOOD_OFFERING` | `blood-offering-skill`, stages 0–4 | variable Blood consumption, investment equals actual consumption, once per combat | `packages/content/src/blood-spellblade.test.ts` | No delta |
| `BS_BLOOD_LIBERATION` | same stable ID at stage 5 | Blood 1–3; +2 Blood Sword damage per consumed coin for the combat | blood-spellblade test “changes Blood Offering to Blood Release…”; UI card-effect regression | No delta |

`02_캐릭터` explicitly says the Flame Fighter starts with **common Attack/Defense**, Fire Fist, and Direct Hit. Its character-specific tab contains Fire Fist and Direct Hit but no separate one-coin Attack/Defense rows. Therefore the shipped `jab`/`fist-guard` compatibility IDs instantiate the confirmed common rows and receive the same 4→6 upgrade.

## 4. Blood contract

Directive 6 remains active because no confirmed row supersedes it:

- heads: designated enemy takes coin damage 1;
- tails: owner loses HP 1 ignoring block, then the designated enemy takes coin damage 2;
- at 1 HP the tail proc fizzles as one unit;
- consumed Blood coins do not flip;
- the Blood coin has no intrinsic healing, block, or lifesteal;
- lifesteal belongs only to Blood Spellblade skill atoms.

The confirmed Blood Offering/Liberation rows are compatible with this contract. P12's detailed non-confirmed kit values remain balance-provisional.

## 5. Documentation and sprite disposition

- P12 now records combat-start automatic nonlethal investment, the offensive Blood flip loop, and P13's all-element coin rewards.
- Warrior and Frost Knight sprite lanes are closed.
- The generated Blood Spellblade sprite candidate remains untracked and awaits user creative sign-off. D19 does not touch, stage, or delete it.
- Existing user edits in `apps/ui/src/combat-support.tsx` and generated sprite QA paths remain outside D19.

## 6. Depth ledger

The historical D7 31.44% combat-completion value remains a transition baseline, not the current result. The current D19 `ci:sim` row is filled from the post-alignment gate run before commit:

| Gate | Terminal runs | Crash | Invariant | Completion / depth signal | 50% criterion |
|---|---:|---:|---:|---|---|
| D19 post-alignment | 500/500 | 0 | 0 | 786/2500 combats, 31.44%; mean 10.174 turns | MISS, unchanged transition baseline |

The 50% value is an attribution gate while character data remains provisional: a miss is not hidden, and any movement caused by the confirmed basic upgrades must be identified before release. D19 produced no movement: the result is byte-for-byte equal to the D7 transition baseline and seed 42 remains unchanged. The smoke policies did not select these rest-site upgrades, so the confirmed 4→6 correction has no attributed simulation effect in this lane. Terminal, crash, invariant, and seed-golden gates all pass; the 50% miss remains a known report-only balance signal rather than a new regression.

## 7. Scope boundary

D19 applies only the two confirmed upgrade deltas and documentation synchronization. It does not apply any `1차 테스트`, `최종 수정`, or `기획` skill value, change the D6 Blood contract, alter sprite assets, or open the push gate. D20 performs the integrated release verification and requests the final Fable ship ruling.
