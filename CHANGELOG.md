# Changelog

All notable changes to this project are documented here.

Versions follow the `1.4.x` scheme. Each entry covers what was built and tested in that build.

---

---

## v1.4.263 — July 2026
- **New public API: `game.system.api.requestSkillCheck(actor, opts)`** — general-purpose "target rolls a skill, tell me the grade" capability, for any module boost that needs an unopposed skill check with a GM-substitutable skill picker (`system-batch-request-skill-check-prompt.md`; built for Destined's upcoming Blast Ongoing Damage boost, but scoped as a general primitive, not an Ongoing-Damage special case — Destined has ~78 `needsRoll` boosts that will draw on this over time). Seventh export on the frozen `game.system.api` surface, alongside `syncHitLocationHP`/`determineOutcome`/`shiftGrade`/`GRADE_ORDER`/`applyDifficulty`/`DIFFICULTY_GRADES` — none of the existing six changed shape.
- **New generic `seType: 'skillCheck'` case in `runSEDialog`** (`module/combat/effects/helpers.js`), fully payload-driven (`title`, `prompt`, `skillOptions`, `difficulty`, `allowGMOverride`) with no knowledge of any specific power/boost — a skill button per option (`Name (total%)`, matching the `gripChooseSkill` idiom), each rolling `1d100` and grading via `determineOutcome` (with `applyDifficulty` applied first when `difficulty` is set) on click. **Deliberately does not short-circuit a single-option list** the way `gripChooseSkill` does — this case rolls, so the chooser must see the target number (and the GM-override button, if offered) even with only one skill available. Reuses the existing generic `se-choose-skill.hbs` template (already used by `stunLocation`/`bashObstacleRoll`'s skill-picker sub-dialogs) rather than adding a new one — its `{title, subtitle, showAttackRow, note}` shape fit without contorting it.
- **Routing matches `resolveGripBreakFree` exactly** (three-way branch on `automationLevel`/`gmMode`): semi-auto + non-GM-mode routes over `CombatSocket.seChallenge` to `_findDefenderUserId(actor)` (the existing player-for-PC/GM-for-NPC rule, unchanged, reused as-is); semi-auto + GM-mode runs `runSEDialog` locally; **manual and full automation are both fully automated, no dialog at all** — confirmed by reading `resolveGripBreakFree`'s own undifferentiated `else` branch, not assumed — `requestSkillCheck` matches it exactly: auto-picks the actor's best-scoring named skill and rolls it unopposed.
- **GM override ("No Check Needed")**: when `allowGMOverride` is true, the dialog case gates the button on `game.user.isGM`, checked live at the point the dialog actually renders — not left to the caller to predict. This dialog can render on genuinely different clients depending on routing (the owning player's own client, in semi+non-GM-mode for a PC), and `game.user.isGM` reads correctly on whichever client it lands on either way; asking the caller to guess in advance which client will render it was rejected as strictly worse. Resolves `{ gmOverride: true, succeeds: true, cancelled: false }`.
- **Socket timeout surfaced as `cancelled: true, reason: 'timeout'`** — confirmed `CombatSocket.seChallenge` resolves `null` after its existing 5-minute timeout; `requestSkillCheck` never leaves a caller awaiting it hanging or misreads a timeout as a pass.
- **No named skill present on the actor** (none of `skillNames` resolve to a skill item) returns `{ cancelled: true, reason: 'no-skill', ... }` rather than throwing or inventing a 0% skill — checked before any dialog or socket call is made.
- **Real drift found and flagged, not silently reconciled**: two different functions named `applyFatigueToSkill(skillTotal, actor)` exist in this codebase with the same signature but different behaviour. `module/utils/fatigue.js`'s version (re-exported near the top of `mythras.mjs` for external consumers) considers fatigue only. `module/combat/effects/helpers.js`'s version — the one every existing SE resolver, including Grip, actually imports and uses — also floors the result against active impale/entangle grades. `requestSkillCheck` uses the `helpers.js` version (imported as `applyFatigueToSkillSE`), matching Grip's own behaviour per the batch prompt's explicit instruction ("skill options must be fatigue-adjusted the same way"). The two functions were not unified this batch — out of scope, flagged for whoever next touches either.
- 20 new tests (`tests/request-skill-check.test.js`) covering `skillNames` → `skillOptions` resolution (present/absent/order-preserved/malformed-actor), fatigue adjustment (`rawTotal` preserved alongside the adjusted `total`), the no-skill result, and grading (`difficulty` applied before `determineOutcome`, `succeeds` derived correctly across the full grade range including critical/fumble) — mirror-style plus real imports of the already-tested pure `determineOutcome`/`applyDifficulty`, matching `tests/extension-hooks.test.js`'s convention (`mythras.mjs` itself is not import-safe under Jest). The Dialog-rendering half of the new `seType` case and the `CombatSocket` routing branches are Foundry-coupled and were not given elaborate test scaffolding, per the batch prompt's own instruction — verified live instead. 365 → 385, all green. `node --check` clean on `mythras.mjs` and `helpers.js`.
- **Live-verified** by Chris (Destined module's Blast Ongoing Damage boost, `blastOngoingDamageEstablish`/`updateCombat` tick, module v1.9.61) — the resist dialog, GM-substitutable skill picker, and grading all confirmed working at the table. Committed and pushed (`4861f97`).

## v1.4.262 — July 2026
- **Two new extension points, both consumed inside the armour-unification batch's chokepoint(s): `CONFIG.MYTHRAS.apReductionHooks` and `CONFIG.MYTHRAS.attackResolvedHooks`.** Purely additive — empty arrays by default, no behaviour change with no modules loaded (confirmed: full 343-test pre-batch baseline still passes unchanged, no existing test's behavior changed). Built specifically so a future Destined Blast **Armor Piercing** boost batch has exactly one place to register each.
- **`apReductionHooks`** — `(attacker, defender, locationId, weapon) => number`, additive-stacking, mirroring `armourBonusHooks` deliberately (bonuses add, reductions subtract, both clamp at zero, both read-time, neither mutates stored AP). Consumed inside `CombatEngine._getEffectiveArmourAt`, **after** the built-in Bodkin/Armour Piercing reduction and **before** the final `Math.max(0, …)` clamp — so it automatically reaches all three ranged damage paths (Full Auto, Burst Fire, semi-auto Roll Damage) with no per-path wiring. `locationId` passed to hooks is the canonical camelCase location key (`'chest'`, `'rightArm'`, …), matching `armourBonusHooks`' vocabulary — **not** the raw hit-location document id `_getEffectiveArmourAt`'s own `locationId` parameter carries internally. Deliberately no `false`/immunity return value (design decision, not an oversight) — "ignore armour entirely" is already Bypass Armour, resolved before hooks run. A negative, `NaN`, or non-numeric hook return contributes `0`, never subtracts from the reduction.
- **`_getEffectiveArmourAt` gained an `attacker` opt**, threaded through from all three call sites (`_resolveFullAutoDamage`, `_resolveBurstDamage`, both `CombatEngine.js`; `_onSemiAutoRollDamage`, `mythras.mjs`) — all three already had the attacker in scope, so no lookup was needed anywhere; not used by the function's own arithmetic, only passed through to `apReductionHooks`. `_getArmourAt` itself is unchanged, per the batch's explicit constraint.
- **locKey resolution for `apReductionHooks` uses the canonical `locationNameToKey` (`module/utils/hit-location.js`)** — newly imported into `CombatEngine.js` — rather than adding a *third* independent inline copy of the location-label regex (the file already carries two, in `_getArmourAt` and `_applySunder`; see `extension-point-api-updated.md`'s Location-key vocabulary section, which flags those two as a "candidate for consolidation" it explicitly did not ask this batch to do). This was a design choice made and flagged, not requested verbatim by the prompt (which named the hook's third parameter `locationId` without specifying its derivation) — chosen for symmetry with `armourBonusHooks`, since a module author reasonably expects the same parameter name to mean the same thing across both "mirrored" hook families. Skipped entirely (no `_getItem` call, no regex) when `apReductionHooks` is empty, so the zero-hook case stays genuinely inert, not just zero-valued.
- **`attackResolvedHooks`** — `(ctx) => void`, fires once per resolved combat attack **roll**, hit or miss, fumble or critical alike. Fired inside `CombatEngine._afterDefenceResolved`, immediately after the outcome-card-posting step — placed there rather than inside `_postOutcomeCard` itself because Full Auto's consolidated-card mode skips calling `_postOutcomeCard` per target entirely (`isFullAutoConsolidated` short-circuits `chatMsg` to `null`); firing after that branch, unconditionally, guarantees exactly one firing per `_afterDefenceResolved` invocation regardless of which branch ran.
- **Firing granularity, verified by reading the call graph, not assumed**: single-target attacks (`_runDialog`) and Burst Fire both call `_afterDefenceResolved` exactly once per activation — Burst's multiple "rounds" are an internal loop inside `_resolveBurstDamage`, called *from* `_afterDefenceResolved`, not a re-entry into it. **Full Auto against N targets calls `_afterDefenceResolved` N times** — once per target, via `_runFullAutoSingleTarget` inside `_runFullAutoExchanges`'s per-target loop — so `attackResolvedHooks` fires once per target, not once for the whole spray. Read as the correct granularity, not a compromise: each target genuinely gets its own attack roll and its own hit/miss outcome, so "once per resolved attack roll" and "once per target" are the same thing here.
- **Does not fire for vehicle-defender attacks** — `_runDialog` branches to `_resolveVehicleAttack`/`_postVehicleOutcomeCard` before reaching `_afterDefenceResolved` at all, a separate resolution path (confirmed last batch: vehicles use Shields-then-Hull, not this armour model). Out of scope per this batch's own exclusions (no vehicle-path changes); flagged as a real, deliberate gap should a future module hook ever expect it there.
- **A real correction to the prompt's own premise, caught by reading source**: the prompt asserted `rollHooks.postRoll` "exists but is fired from `MythrasRoll.js` … `CombatEngine` does not route through `MythrasRoll`, so combat attacks never reach it" as the reason a new hook is needed. Confirmed true by grep: `CombatEngine.js` calls `rollHooks.preRoll` (twice) but never `postRoll`; `postRoll` fires only from `MythrasRoll.js`. This premise held — no drift here, unlike the previous two batches' prompt corrections, but confirmed rather than trusted.
- 22 new tests (`tests/extension-hooks.test.js`, mirror-style; `jest.fn` is not available in this project's ESM Jest setup — confirmed zero prior use anywhere in either repo — so spies are hand-rolled via a small `makeSpy` helper instead of introducing it). 343 → 365, all green. `node --check` clean on `config.js`, `CombatEngine.js`, `mythras.mjs`.
- **Unrelated bug found during this batch's live verification, fixed in the same build: a firearm with a specific ammo type loaded could lose its entire magazine on a single semi-auto shot.** Root cause: `_onSemiAutoRollDamage`'s ammo-decrement block (`mythras.mjs`) assumed `weapon.system.loadedAmmoId` being set always meant a bow/sling's single "nocked" round, and unconditionally zeroed `system.ammo` on fire. That assumption is false — `WeaponSheet.js`'s own Reload logic sets `loadedAmmoId` on a **firearm** too whenever `ammoType` is configured, purely so the engine can read the loaded ammo item's traits (Bodkin, Broadhead, Stun Round) via `_resolveAmmoTraits`; the firearm's real magazine count (`system.ammo`, decremented correctly by exactly 1 per shot in `CombatEngine._runDialog` at initiation time) has nothing to do with that flag. Fixed by gating the zero-out specifically to non-firearms, using the same `weapon.system.traits.includes('firearm')` check `WeaponSheet.js` already uses to distinguish the two ammo models — `isRangedShot` itself (which gates ammo-trait reading and Broadhead/Stun Round stamping) is unchanged, so those still work correctly for firearms. Pre-existing bug, not introduced by this batch or the previous one (confirmed by diffing both against their parent commits — neither touched this block before now). No new unit test added (`_onSemiAutoRollDamage` has no existing mirror-test coverage to extend without disproportionate new scaffolding); live-verified instead.
- **Live-verified, committed and pushed (`13471fd`).** Stale "NOT yet live-verified" note corrected — this shipped and has been building on since (v1.4.263's `requestSkillCheck` depends on `attackResolvedHooks` from this batch).

## v1.4.261 — July 2026
- **Unified effective-armour resolution into a single chokepoint: `CombatEngine._getEffectiveArmourAt(defender, locationId, {bypassArmour, ammoTraits, weapon})`.** Effective AP (raw AP from `_getArmourAt`, with Bodkin/Armour Piercing ammo-trait reduction on top) was previously computed independently in three places — Full Auto, Burst Fire, and semi-auto Roll Damage — and they had drifted from each other. `_getArmourAt`'s own arithmetic (natural + worn − sunder + `armourBonusHooks`) is untouched; this wraps it, it does not reimplement it.
- **THE BUG FIX: Burst Fire (`_resolveBurstDamage`) had no piercing branch at all.** Firing burst with Bodkin or Armour Piercing ammo silently ignored the AP reduction on every round — Full Auto and semi-auto both had the branch, Burst never got it. Now routes through the same chokepoint as the other two paths; `bypassArmour` stays per-round (Special Effects apply to the first round only, unchanged), but ammo traits — a property of the ammunition, not a special effect — now apply on every round, correctly.
- **Ammo-trait resolution also unified: `CombatEngine._resolveAmmoTraits(attacker, weapon)`.** `_buildContext` (Full Auto/Burst) already had the correct version, including a `type === 'ammo'` type guard. The semi-auto Roll Damage handler (`mythras.mjs`, `_onSemiAutoRollDamage`) had **two** independent re-implementations of its own — one for the piercing check, one for Broadhead/Stun Round stamping — and the piercing one had no type guard at all, so a non-`ammo` item loaded into `loadedAmmoId` could yield traits there but not in `_buildContext`. Both are now gone; the handler resolves traits once and reuses the result for both purposes. **Behaviour change on this one narrow case**: a non-`ammo` item in `loadedAmmoId` previously could yield ammo traits on the semi-auto path and now will not — this is a correctness fix (it aligns semi-auto with Full Auto/Burst), not a new restriction, but is called out explicitly per the batch's own instruction not to bury it.
- **`_ctxFromCardFlags` correction to this file's own prior entries: it is not dead code.** Earlier entries here (v1.4.256 "fully inert", v1.4.257 "still fully inert", v1.4.258 "wired into the semi-auto Apply Damage button") already establish that it's live — this entry is a note for anyone reading the batch prompt that originated this work, which incorrectly asserted it was "defined but never called." It is called, by the Apply Damage button handler specifically — a different function from `_onSemiAutoRollDamage` (Roll Damage), which is the one that still regex-scrapes the parent card's `data-location-id`/`data-location-label` for its own purposes. Both the regex-scraping and any `_ctxFromCardFlags` rewiring remain explicitly out of scope for this batch.
- **Checked, not changed: the vehicle damage path (`_applyVehicleDamage`) does not compute effective armour the same way at all.** It uses an entirely separate Shields-then-Hull mechanic (`system.shields.value/max` absorbs first, then `system.hull` is compared directly against remaining damage to find penetration to Structure) — no hit-location AP, no natural/worn split, no ammo-trait piercing, no `armourBonusHooks`. Untouched, correctly.
- **Found, not fixed, not previously documented: a fourth `_getArmourAt` call site with no piercing branch**, in the Full Auto "Accidental Injury" self-fumble path (`~L2985`, the line the batch prompt actually meant to cite for the vehicle path — see below). This is the attacker striking themselves on a fumble; `isUnarmed` already sets `bypassArmour` for internal injury, and the semi-auto variant of this same event routes back through the now-fixed `_onSemiAutoRollDamage`. The full-auto branch's direct, un-pierced `_getArmourAt` call was out of the batch prompt's named scope (it named only Full Auto/Burst/semi-auto attack resolution) and self-inflicted fumble damage has no ranged-ammo dimension in practice, so left alone — flagged for whoever next touches this area.
- **Prompt-anchor correction**: the batch prompt's "vehicle damage path (~2985)" line number actually points at the Accidental Injury block above, not `_applyVehicleDamage` (which lives at `~L2338`, Hull comparison at `~L2392-2394`). Both were checked; findings are the two bullets above.
- **Test count correction**: the batch prompt cited "the existing suite is 291 tests green" — that was the pre-chokepoint-fix baseline from v1.4.255 (see that entry below); the actual baseline for this batch was 329 (v1.4.259/260, unchanged by the intervening API-promotion batch). New tests: 14 (`CombatEngine._getEffectiveArmourAt` ×10, `CombatEngine._resolveAmmoTraits` ×4), added to `tests/extension-hooks.test.js`, importing the real `weaponBaseMax` (already tested in `combat-math.test.js`) rather than mirroring it. `_getEffectiveArmourAt` is tested directly with a stubbed `_getArmourAt`, per the batch's own test-design note. 329 → 343, all green. `node --check` clean on both touched files (`CombatEngine.js`, `mythras.mjs`).
- Removed `mythras.mjs`'s now-unused `weaponBaseMax` import (its only call site in that file was the piercing block just deleted; `CombatEngine.js` still imports and uses it directly inside `_getEffectiveArmourAt`).
- **Live-verified, committed and pushed (`9b7d7b6`).** Stale "NOT yet live-verified" note corrected — this shipped and has been building on since.

## v1.4.259 — July 2026
- **Damage chokepoint fix, Batch 3 of 3 (final): the semi-auto Apply Damage button now routes through `CombatEngine._applyDamage`.** `damageHooks` and the vampiric-trait drain are live in Semi-Auto for the first time. The handler's hand-built HP write, `_resolveOpposedSEs` call, and `_resolveWoundConsequences` call are gone — one `_applyDamage(ctx, damage)` call now does the write (through `damageHooks` first), opposed-SE resolution, wound consequences, and the drain, in that order, confirmed by reading the function in full before deleting anything.
- **Two problems found during the "confirm before deleting" check, both resolved by mirroring the Full Auto path exactly, neither silently absorbed:**
  1. `_applyDamage` posts no user-facing feedback at all — Full Auto instead updates a chat card afterward (`_updateCardWithDamage`), a mechanism Semi-Auto's button doesn't have. Deleting the handler's `ui.notifications.info` with no replacement (as a literal reading of "delete its ui.notifications.info" would do) would have left the GM with zero feedback that damage landed. The handler now posts its own notification *after* the `_applyDamage` call, built from `ctx.newCurrent`/`ctx.woundLevel` (which `_applyDamage` mutates onto `ctx` when it actually writes) rather than the pre-hook rolled damage — so a `damageHooks` consumer that reduces or fully suppresses damage is now correctly reflected ("Applied 5 to..." when a hook halved a 10-point hit; "No damage applied to..." when one blocked it outright), instead of reporting a number that no longer matches what happened.
  2. `_applyDamage`'s internal SE dispatch passes the *same* `damage` argument to every chosen SE's `requiresDamage` gate and its resolver call. Stun Round ammo deals 0 HP damage by design, but `stunLocation` (`requiresDamage: true`) needs the pre-armour `rawDamage` as its stun duration — a single shared argument can't satisfy both, and with `damage=0` the dispatcher would silently skip `stunLocation` via its `requiresDamage` gate. Confirmed this exact problem doesn't exist in Full Auto only because Full Auto never puts `'stunLocation'` in `chosenSpecialEffects` for its own `_applyDamage` call at all — it resolves it via a separate, direct call to the resolver afterward. Semi-Auto now does the same: `stunLocation` is excluded from the dispatched SE set when Stun Round is active, and a new `CombatEngine._resolveStunLocationSE(ctx, duration, forcesFail)` (a one-line wrapper around the same resolver Full Auto calls directly) fires it afterward with `rawDamage`.
- Bash's `rawDamage` knockback is unaffected by either issue — it reads `ctx.rawDamage`, a field already populated via `extras`/`_ctxFromCardFlags`, not a value threaded through `_applyDamage`'s arguments.
- **Found but explicitly not touched, out of scope for this fix**: `_onSemiAutoRollDamage` (the *Roll* Damage handler, a different function from the Apply Damage button this batch touches) has a pre-existing branch that resolves opposed SEs immediately when `finalDamage === 0`, gated only on that condition — not excluding Stun Round attacks, which still get an Apply Damage button per a separate `|| stunRound` condition on whether the button renders at all. This looks like it could double-resolve non-`stunLocation` opposed SEs (Bleed, Trip, etc.) for a zero-damage Stun Round shot: once immediately at Roll Damage time, once again when the GM clicks Apply Damage. This predates and is unrelated to the chokepoint work in all three batches — flagging for the record, not fixing here.
- Extended `tests/extension-hooks.test.js`: updated the Batch 2 "handler ctx construction" describe block's header for the Batch 3 shape, replaced an obsolete test asserting a manual `semiCtxForWound` merge (Batch 3 no longer does this — `_applyDamage` mutates the fields onto `ctx` directly) with one confirming the relevant fields are absent until the call, and added coverage for the `stunLocation` dispatch exclusion (both Stun-Round-active and inactive) and all four branches of the applied-damage notification (normal hit, hook-reduced hit, hook-suppressed hit, unresolved location). Suite now 329 (323 + 6), all green.
- Final tally across the three-batch series: 291 → 329 (38 new tests).

---

## v1.4.258 — July 2026
- **Damage chokepoint fix, Batch 2 of 3: wire `_ctxFromCardFlags` into the semi-auto Apply Damage button.** `mythras.mjs`'s `.mi-btn-apply-dmg` handler now builds its opposed-SE and wound-consequence `ctx` objects from `CombatEngine._ctxFromCardFlags(outcomeMsg, extras)` instead of hand-built `minimalCtx`/`woundCtx` literals that only carried a hand-picked subset of the outcome card's stamped flags. `extras` (`hitLocationId`/`hitLocationLabel`/`damage`/`rawDamage`) is extracted from the button's own dataset at the call site, since the helper is deliberately DOM-independent.
- **This batch changes behaviour at the table, on purpose** — two paths dormant in semi-auto since this handler was written are now live: fumble-gated Special Effects (`_resolveOpposedSEs` gates on `ctx.attackOutcome !== 'fumble'`, which was always `undefined` before) and Knockout Blow (`opposed.js` reads `ctx.attackerStyle?.system?.traits`, which was hardcoded `null` before). Both are latent bugs being cured, not regressions.
- **A third, previously-undocumented wake-up found while implementing**: the wound-consequence `ctx.chatMessageId` was never set at all in the old `woundCtx` (only the opposed-SE `minimalCtx` set it) — `_resolveWoundConsequences` passes it through as `lastCardId` to `waitForCard()`, which resolves immediately when falsy. The wound-Endurance dialog will now correctly wait (capped at 800ms) for the outcome card to render before opening, same as the opposed-SE path already did. Neutral-to-positive, but not in the prompt's "expected wake-ups" list — flagging per instructions.
- **Two fields `_resolveWoundConsequences` reads beyond the prompt's 8-field list**, confirmed by reading the function fully rather than trusting the summary: `attackerSkillTotal` (used in the Endurance dialog and the opposed-roll resolution) and `damageAfterArmour` (used in the "fall Unconscious for N minutes" duration). Both are already covered — `attackerSkillTotal` via `_ctxFromCardFlags`'s normal 24-field passthrough, `damageAfterArmour` via the `semiCtxForWound` merge-on-top the prompt already specifies.
- `chosenSpecialEffects` on both merged ctx objects is explicitly overridden with the locally-mutated `chosenSEs` array (broadhead auto-bleed, Stun Round auto-stunLocation injected) — `_ctxFromCardFlags` only ever sees the raw, unmutated `flags.chosenSEs`. Verified both ammo traits still inject correctly.
- A `null` return from `_ctxFromCardFlags` (actors unresolvable) is handled the same way for both call sites: `console.error` + `ui.notifications.error`, matching the existing catch-block failure style. Neither resolver is reached when this happens.
- No `CombatEngine.js` changes in this batch — confirmed directly (zero edits made to that file this batch); `git diff --numstat` against HEAD still reflects Batch 1 + its amendment too, since nothing in this three-batch series has been committed yet.
- Extended `tests/extension-hooks.test.js` with 6 tests mirroring the handler's ctx-construction: broadhead and Stun Round injection surviving the merge (both individually and together), a `null` ctx not reaching either resolver, and a `semiCtxForWound`-shaped merge carrying the wound-local fields (plus confirming the newly-covered `attackerSkillTotal`/`chatMessageId`). Suite now 323 (317 + 6), all green.

---

## v1.4.257 — July 2026
- **Batch 1 amendment: drop the `btn`/DOM parameter from `CombatEngine._ctxFromCardFlags`.** New signature `_ctxFromCardFlags(outcomeMsg, extras)`. The removed `defenderId` DOM fallback (`btn.dataset.actorId`) was unreachable in any well-formed case — `defenderId` is always stamped alongside `attackerId` at outcome-card creation time — and a load-bearing `btn` parameter would have blocked reusing this helper from a caller with no button at all, such as the full-auto resolve-immediately path (`CombatEngine.js` ~L2871), a later candidate for it. A genuinely missing `defenderId` now returns `null`, the same convention already used for a missing/deleted `outcomeMsg` — one failure convention, not two.
- Corrected two numbers from the original prompt while re-verifying ground truth: the outcome-card flag block stamps 24 fields (confirmed twice by hand, not 21), and the false `attackerStyle` comment removed in Batch 1 was at `mythras.mjs` L1167, not L1168. Neither changes the plan.
- Still fully inert — nothing calls `_ctxFromCardFlags` yet. `mythras.mjs` untouched by this amendment (still only the one comment-line change from Batch 1).
- Updated the `tests/extension-hooks.test.js` mirror to match: dropped the `btn` parameter from every call site, replaced the "falls back to the button dataset" test with one confirming a missing `defenderId` returns `null`. Suite still 317 (one test swapped for another, net unchanged), all green.

---

## v1.4.256 — July 2026
- **Damage chokepoint fix, Batch 1 of 3 (unused/inert this batch): `CombatEngine._ctxFromCardFlags` + `CombatEngine._resolveActorById`.** The semi-auto "Apply Damage" button (`mythras.mjs` ~L1081, `.mi-btn-apply-dmg`) writes `system.current`/`system.wound` directly and never calls `CombatEngine._applyDamage` — the sole consumer of `CONFIG.MYTHRAS.damageHooks` (CombatEngine.js L2650) — so no damage-reducing hook registered by any module can affect the primary GM (semi-auto) workflow. This is drift, not design: the button handler is a stale near-duplicate of `_applyDamage`'s body, hand-building a `minimalCtx`/`woundCtx` from a hand-picked subset of the outcome card's stamped flags instead of reading all of them.
- `_ctxFromCardFlags(btn, outcomeMsg, extras)` rehydrates a full `ctx` object from an outcome chat card's stamped flags (24 fields, not the hand-picked ~14 the existing `minimalCtx`/`woundCtx` use) plus the Apply Damage button's own dataset (`hitLocationId`/`hitLocationLabel`/`damage`/`rawDamage`, stamped later at damage-resolution time, not part of the attack-time flags). Resolves `attackerId`/`defenderId`/`weaponId`/`defenceWeaponId`/`attackerStyleId`/`defenceStyleId` to live documents via the new `_resolveActorById` (token-preferred, mirrors `mythras.mjs`'s private `_resolveActor`, duplicated rather than imported to avoid a circular import — `mythras.mjs` already imports from `CombatEngine.js`) and `_getItem`. `damageRoll` is always `null` — its only consumer system-wide (`_diceBreakdown` inside the full-auto-only `_updateCardWithDamage`) is never reached from the semi-auto path this feeds.
- **Deleted a false comment** in `mythras.mjs`'s `minimalCtx` (`attackerStyle: null, // not available from card flags` — it is; `attackerStyleId` has been stamped since the outcome card was built). `attackerStyle` itself stays hand-built as `null` in this batch; Batch 2 wires it through `_ctxFromCardFlags`.
- **Fully inert**: neither new method is called from anywhere yet. Zero behavior change in play, by design — this batch only adds the plumbing Batch 2 (swap the call sites, wakes Knockout Blow + fumble-gated SEs in semi-auto) and Batch 3 (route through `_applyDamage`, wakes `damageHooks` + vampiric drain in semi-auto) will use.
- Added `CombatEngine._resolveActorById` / `_ctxFromCardFlags` coverage to `tests/extension-hooks.test.js` (14 tests): token-preferred resolution with base-actor fallback, full rehydration from a representative 24-field flag set, `attackerStyle` resolving to a real item, graceful `null` on a missing/deleted outcome message or an unresolvable actor, the button-dataset fallback for `defenderId`, the `chosenSEs` → `chosenSpecialEffects` rename, `damageRoll` always `null`, `extras` defaults, and idempotency. Suite now 317 (303 + 14), all green.
- No module changes in this batch — system-side only. Do not proceed to Batch 2 without live verification and go-ahead.

---

## v1.4.255 — July 2026
- **`damageHooks` gains a numeric return: partial damage reduction, composing.** Previously the loop in `CombatEngine._applyDamage` (~L2649) only honoured a `false` return (full immunity, short-circuits the loop). Now a hook may return a finite number meaning "this is the new damage value" — floored to a non-negative integer (`Math.max(0, Math.floor(result))`) before the next hook runs. Any other return (`undefined`, `null`, `true`, a string, `NaN`) is ignored and the hook declines.
- **Composition, not override — deliberately the opposite of `weaponDamageHooks`.** Each subsequent hook receives the damage as already reduced by every earlier hook, so two independent reductions (e.g. a resistance power and a shield) both apply, rather than the first one winning. Two damage *formulas* can't both be true (hence `weaponDamageHooks`' first-wins), but two damage *reductions* legitimately can — this is why the two hook families use opposite composition rules, and the config doc now says so explicitly to head off a reader assuming they match.
- **`NaN` is explicitly excluded**, not just "any non-number": `typeof NaN === 'number'` is `true`, so `Number.isFinite` is doing real filtering work here, not defensive decoration — an unfiltered `NaN` would propagate into `system.current` and corrupt a hit location.
- `false` still short-circuits exactly as before: full immunity is absolute, nothing later can raise damage back up, and the opposed-Special-Effects resolution below the loop is unchanged (still fires unconditionally; SEs with no damage requirement, e.g. Trip Opponent, still resolve even when damage is fully blocked).
- **Zero behavior change with no hooks registered** — verified by re-running the pre-existing 291-test baseline against the changed engine before adding any new tests; all 291 passed unchanged.
- `module/config/config.js`'s `DAMAGE HOOKS` doc block was corrected (it documented a `({ actor, location, damage, source }) => void` signature that didn't match the real `(ctx, damage)` call site) and expanded to cover the full return contract — false/numeric/ignored, composition, integer flooring — mirroring the `rollHooks`/`evasionHooks` comment style above it. Notes that `ctx` carries `ctx.defender`, `ctx.weapon`, `ctx.hitLocationId`.
- **Judgement call surfaced, not resolved:** this loop has no `try/catch` around the hook call, unlike several other hook consumers in this codebase (e.g. `movementHooks` in `CharacterData.js`). Adding one would be defensible and consistent, but it's a behavior change beyond this batch's scope, and it changes what happens when a module ships a broken hook — currently the throw propagates and the attack visibly fails, arguably better than silently applying full (un-reduced) damage. Left as-is; flagged for Chris to decide as a possible follow-up.
- Added a `damageHooks` section to `tests/extension-hooks.test.js` (12 tests): pass-through with no hooks / `undefined` array, `false` suppression, `false` short-circuiting a second hook, numeric override, two numeric hooks composing, decline-then-later-hook-runs, `null`/`true`/string/`NaN` all ignored (`NaN` asserted explicitly), negative-floors-to-0, fractional-floors-to-integer, `ctx` field access, a throwing hook's current (propagating, uncaught) behavior documented directly, and idempotency. Suite now 303 (291 + 12), all green.
- No module changes in this batch — system-side only, per scope. No registration added to `damageHooks`; that's the module's job, in a later batch. No `packs/` rebuild required.

---

## v1.4.254 — July 2026
- **Weapon derivation chokepoint: new `weaponDamageHooks` / `weaponForceHooks` extension points.** Two OVERRIDE (first-wins) hook arrays, the opposite pattern from every other hook on `CONFIG.MYTHRAS` — there's no sensible way to sum two damage-formula strings. `(weapon, actor) => string | undefined`; the first hook to return non-`undefined` wins and no further hooks are consulted; `undefined` (the overwhelmingly common case) declines and falls through to the stored value.
- Added `CombatEngine._getWeaponDamage(weapon, actor)` and `CombatEngine._getWeaponForce(weapon, actor)`, static methods consulting the two hook arrays before falling back to `weapon.system.damage` / `weapon.system.parrySize` respectively (`parrySize`, not `force` directly — preserves the existing melee-uses-size/ranged-uses-force distinction the engine already depended on). Routed every damage-formula build and every parry-size lookup in `CombatEngine.js` through these two methods (9 damage sites, 3 Force/parrySize sites — the latter required extending `resolveParryReduction`'s signature with two optional trailing actor params, since two of its three call sites already carried `ctx.attacker`/`ctx.defender` but the third, in `mythras.mjs`'s semi-auto Roll Damage handler, had no `ctx` object to read them from). Also routed `CharacterSheet._onRollDamage` (the sheet's own weapon-row Roll Damage button, a separate path from the combat engine entirely) via the file's existing dynamic-import-`CombatEngine` convention.
- **Why:** Destined's Blast power derives its damage/Force from live POW/STR/INT/CON rather than a stored weapon field (rulebook: Core Blast from POW; Mega Blast from POW+½STR or POW+½INT). A stored formula string goes stale the instant Morph, Growth, Shrink, or Enhanced Strength change the wielder's characteristics mid-session — there was previously no interception point anywhere on the attack path for this. `damageHooks` does not solve it (that fires on damage *application to a target*, not on computing what the attacker's weapon rolls).
- **Deliberately not a `WeaponData` getter.** Deriving from the actor inside a `TypeDataModel` getter has a real ordering hazard: an embedded item can prepare before its owning actor's `characteristicBonusHooks` have run, so the getter could read unhooked (stale) characteristics — reintroducing the exact snapshot bug this exists to prevent, one layer down. The resolver is a function called at roll time with the *prepared* actor instead.
- **Zero behavior change with no hooks registered** — verified: with empty hook arrays (today's default for every actor), every routed call site falls straight through to the exact value it read before (`weapon.system.damage` / `weapon.system.parrySize`), bit-for-bit. No module currently registers into either array.
- **Left deliberately unrouted, on record:** `module/combat/effects/opposed.js` `resolveDisarmOpponent` (L416-417) reads `weapon.system.size` directly for a physical-size grapple contest (how hard a weapon is to knock loose), not the ranged Force mechanic — reading `parrySize` there would silently change ranged-weapon disarm behavior. `macros/macro-test-special-effects.js` (2 sites) — GM/dev tooling run manually from the Foundry macro directory, not imported by any module code, not part of the shipped attack path, not covered by the Jest suite. Both confirmed with Chris before leaving them alone.
- **Range hooks intentionally NOT added.** How ranged bands are stored/consumed hasn't been audited; adding an unused hook array is worse than adding nothing. Deferred to whenever Blast's range mechanic is actually built (module-side, later task).
- Added a `weaponDamageHooks` / `weaponForceHooks` section to `tests/extension-hooks.test.js` (17 tests): default-pass-through for both melee and ranged, hook override, hook decline-and-fall-through, first-wins with the second hook unconsulted, a declining hook chained into an overriding one, hooks reading actor characteristics, throwing-hook resilience (both with and without a later hook to fall back to), and idempotency. Suite now 291 (274 + 17), all green.
- `extension-point-api-updated.md` updated: table rows for both hooks plus a dedicated section covering the override/first-wins contract, the vehicle-weapon wielder-actor distinction (`ctx.attacker`, never `weapon.actor`), and the `resolveParryReduction` signature change.
- No module changes in this batch — system-side only, per scope. No `packs/` rebuild required.

---

## v1.4.253 — July 2026
- **Batch 4A (system-side): new `powerPointsHooks` extension point.** Read-time hook, consumed in `CharacterData#prepareDerivedData` right after `luckPointsHooks`, that computes `attributes.powerPoints.max`. Unlike every other `.max` hook, the system contributes no base — `powerPoints` is a module-owned resource pool the system never populates (per the schema comment beside the field) — so the hook sum *is* the max, not an addition to one. Consumption accumulates into a local variable and assigns once, rather than `+=` on the field directly, since there's no prior base assignment in this pass to reset against.
- Empty array (today's default) resolves to `0`, matching the field's stored initial value — **zero behavior change for any existing actor**. Destined (Batch 4B) will register a single hook returning `POW + POWER_LEVEL_STATS[level].ppMod`, owning the entire max.
- No module changes in this batch.
- Added a `powerPointsHooks` describe block to `tests/extension-hooks.test.js` (6 tests): empty array → 0, a single hook is the max outright, multiple hooks sum, null/NaN/non-number guards, a throwing hook doesn't block later hooks, idempotency. Suite now 274 (268 + 6), all green.
- `extension-point-api-updated.md` updated: `powerPointsHooks` row in the hooks table plus a dedicated `### MYTHRAS.powerPointsHooks[]` section (type, call site, signature, the no-base distinction, Destined usage). Also noted, for the record, that the Phase 3a hooks (`luckPointsHooks`, `healingRateHooks`, `initiativeOffsetHooks`, `movementHooks`, `hitPointBonusHooks`, `damageModOffsetHooks`) landed in v1.4.247–249, ahead of this doc's own v1.4.250 creation.
- No combat-math or compendium changes; no `packs/` rebuild required.

---

## v1.4.252 — July 2026
- **Tooling fix: `npm test` now launches correctly on Windows.** The `test` script called `node --experimental-vm-modules node_modules/.bin/jest` directly. On this Windows install `node_modules/.bin/jest` is a POSIX shell shim (for Git-Bash/Cygwin compatibility), not a bare JS file — feeding a shell script straight into `node` threw an immediate syntax error, regardless of which shell (`cmd.exe`, PowerShell, or Git Bash) launched `npm test`.
- Script now points `node --experimental-vm-modules` directly at jest's real entry file, `node_modules/jest/bin/jest.js`, bypassing the `.bin` shim entirely. No new devDependency, no shell-specific env-var syntax (npm's default Windows script-shell is `cmd.exe`, which doesn't support the POSIX `VAR=value command` prefix form, so a `NODE_OPTIONS=...` approach would have needed `cross-env` for no real benefit here). `--experimental-vm-modules` is preserved — required since the test suite is ESM (`"type": "module"`).
- Verified via `npm test` itself (not a direct `jest.js` invocation) in both Git Bash and native PowerShell: launches cleanly, exit code 0, 268/268 green in both.
- No runtime/system code changed — `package.json` only. `system.json` bumped in lockstep per project convention.

---

## v1.4.251 — July 2026
- **Hardening: `syncHitLocationHP` now consolidates on a single canonical location-key mapper, closing a drift risk between it and `CharacterSheet`'s AP display.** Both call sites independently derived a hit-location item's camelCase key from its label; `CharacterSheet.js` had a more robust explicit lookup (`_locationNameToKey`), while `syncHitLocationHP` used a separate regex-only derivation. On inspection the two derivations were functionally equivalent for the 7 standard humanoid labels — the reported symptom (hook sum always 0) could not be reproduced against this derivation on static review — but two independent implementations of the same contract is exactly the kind of thing that silently drifts, so this collapses them into one regardless.
- **New `module/utils/hit-location.js`** exports `locationNameToKey(label)` — the single canonical implementation (explicit lookup for the 7 standard humanoid labels, regex camelCase fallback for anything else, e.g. vehicle system components). `CharacterSheet.js` now imports it instead of keeping a local copy; `syncHitLocationHP` in `mythras.mjs` now imports and uses it instead of its own inline regex.
- **New regression test**: `tests/extension-hooks.test.js` now imports the real `locationNameToKey` (it's Foundry-free, unlike `mythras.mjs`) and drives a stub hit-location item — `{ system: { label: 'Right Arm', hp: 3 } }` — through a mirror of `syncHitLocationHP`'s item-processing loop with a `hitPointBonusHooks` stub keyed on `'rightArm'`, asserting the bonus lands on the computed `system.hp`. The existing 8 `syncHitLocationHP` tests fed the camelCase key directly and so could not have caught a derivation-layer regression; this one exercises the derivation itself.
- No combat-math or compendium changes; no `packs/` rebuild required.

---

## v1.4.250 — July 2026
- **HP-max lock: hit-location items are now the sole authority for `system.hp` (max), and `hitPointBonusHooks` is folded into the single writer.** Previously `hitPointBonusHooks` was consumed twice — once (correctly) in the write-time HP sync inline in the `updateActor` hook (which never actually read the hook), and once in the read-time derived `CharacterData#_calcHitLocationHP`, which fed a derived object nothing reads for HP-max. That second consumption is deleted; `hitPointBonusHooks` is now consumed in exactly one place.
- **New `syncHitLocationHP(actor)`**, extracted from the inline `updateActor` block in `mythras.mjs`. Computes the CON+SIZ table → Hero Level HP bonus → per-location `hitPointBonusHooks` sum, then persists to each hit-location item's `system.hp`. Idempotent — only writes locations whose computed max differs from the stored value.
- **`hitPointBonusHooks` location-key vocabulary expanded** from the old 5-key set (`head`/`chest`/`abdomen`/`arm`/`leg`, shared across sides) to the full 7-key canonical camelCase vocabulary already used by `armourBonusHooks`: `head`, `chest`, `abdomen`, `rightArm`, `leftArm`, `rightLeg`, `leftLeg`. A hook can now grant HP to one side only, even though the base CON+SIZ table still computes one value per limb pair.
- **`updateActor` trigger guard expanded**: the sync now also fires on any `flags.destined-module` change, not just CON/SIZ/heroAdvantages — so a module writing hook-driving state to its own flag namespace (e.g. toggling Enhanced Body) triggers a resync even when no system field moved.
- **`game.system.api = Object.freeze({ syncHitLocationHP })`** attached in the `ready` hook — the first entry in a frozen `game.system.api` surface, letting a module force a resync directly (e.g. after a batched flag write the guard didn't see as one event).
- **New docs**: `frozen-api-updated.md` and `extension-point-api-updated.md`, referenced by `system-CLAUDE.md` but not previously present in the repo — created here with the entries verified as part of this change (`game.system.api.syncHitLocationHP`, the full extension-point hook table, `hitPointBonusHooks` reclassified write-time).
- Added `syncHitLocationHP` unit coverage to `tests/extension-hooks.test.js` (CON+SIZ table, Hero Level bonus stacking, a stub `hitPointBonusHooks` hook folded in, per-side variation via the camelCase key, null/NaN/throw guards, idempotency). Existing `hitPointBonusHooks` tests retargeted to the write-time contract and camelCase keys.
- No combat-math or compendium changes; no `packs/` rebuild required.

---

## v1.4.249 — July 2026
- **Four new extension points completing the Phase 3a hook batch:**
  - **`initiativeOffsetHooks` (`(actor) => number`)** — signed integer added to `attributes.initiativeBonus` after the base `floor((DEX+INT)/2)` derives. For Destined Enhanced Reactions (+), Bulky (−), Growth (−); one hook owns the net.
  - **`healingRateHooks` (`(actor) => number`)** — signed integer added to `attributes.healingRate` after the CON-table base but BEFORE the Hero Level ×2, so a power delta stacks additively then doubles. For Destined Durability.
  - **`luckPointsHooks` (`(actor) => number`)** — signed integer added to `attributes.luckPoints.max` after the POW-table base AND after the Hero Level luckyPoint/luckyPoint2 advantages. For Destined Lucky (×2) / Mega Lucky (×4). A `luckPoints.value > max` clamp was added alongside (mirroring the existing magic/action-point clamps) so a negative hook can't leave current above max.
  - **`hitPointBonusHooks` (`(actor, locationId) => number`)** — flat integer added PER LOCATION inside `_calcHitLocationHP`, beside the Hero Level HP bonus. The `locationId` ('head'|'chest'|'abdomen'|'arm'|'leg') lets a future per-location power vary by location; current callers apply the same delta everywhere. For Destined Enhanced Body HP (CON+SIZ+½POW), Durability HP (STR+CON+SIZ), and flat Power-Level HP — none of which reduce to a CON bump, so they are added as flat HP rather than faked as a CON delta that would wrongly cascade into healing rate, Inherent Armour AP, and CON-keyed skills.
- All four are read-time and idempotent: derived from the actor's powers each cycle, nothing stored or reverted, each consumption loop guards against null/NaN/throwing hooks.
- Added 22 `extension-hooks` tests (application loops, ordering constraints — healing-before-×2 and luck-after-heroAdvantage, per-location HP variation, guards, idempotency). Suite now 259, all passing.
- No combat-math or compendium changes; no `packs/` rebuild required.

---

- **New extension point: `movementHooks` (`(actor) => number`).** Modules return a signed integer added to the actor's stored `attributes.movementRate` base. Consumed in `CharacterData#prepareDerivedData` immediately before Walk/Run/Sprint are derived, so the whole trio inherits the bonus (walk = base, run = base×3, sprint = base×5). The adjusted base is floored at 0. The stored `movementRate` is never mutated — this is a read-time adjustment for the current derivation cycle only: idempotent, derived from the actor's powers each cycle, nothing stored or reverted. Hooks read the stored `movementRate` as their own base (resolved before this point), never the derived `walk`, so there is no self-reference loop. Built for Destined Enhanced Speed / Enhanced Body / Multi-Limbs, whose movement contributions were previously computed against dead v13 fields.
- Multiple hooks are summed; a single module hook owning net resolution across several movement powers is the expected pattern. Fatigue is applied after the hook sum (halved mode halves the post-hook trio; immobile zeroes it).
- Added 10 `extension-hooks` tests covering the application loop (summing, flat vs multiplicative contributions inheriting into the trio, negative-net with the ≥0 floor, null/NaN/throw guards, idempotency, and the halved/immobile fatigue interactions). Suite now 237, all passing.
- No combat-math or compendium changes; no `packs/` rebuild required.

---

- **New extension point: `damageModOffsetHooks` (`(actor) => number`).** Modules return a signed number of steps to shift along the 15-step Damage Modifier table. Consumed in `CharacterData#prepareDerivedData` where the DM is derived: the manual `attributes.dmOffset` and every hook's return are summed, then clamped to the table bounds. The actor's STR characteristic is never modified, so lift, encumbrance, and STR-based skills stay on the true score — only the resulting Damage Modifier shifts. Read-time and idempotent: hooks derive from the actor's powers each cycle, nothing is stored or reverted. Built for Destined Enhanced Strength / Enhanced Body, whose damage bonus derives from STR+CON+SIZ / STR+SIZ+½CON rather than the normal STR+SIZ.
- Manual GM offset and power offsets compose additively; a single hook owning `Math.max` between mutually-exclusive powers (Enhanced Strength vs Enhanced Body do not stack) is the expected pattern.
- Added 4 `char-math` tests pinning the Enhanced Strength step-delta math and its composition with a manual offset, and 8 `extension-hooks` tests covering the application loop (summing, negative offsets, null/throw guards, idempotency, max-resolution). Suite now 227, all passing.
- No combat-math or compendium changes; no `packs/` rebuild required.

## v1.4.246 — June 2026
- **Fix: module armour bonuses (Destined Inherent Armour / Power Armour) now show in the character sheet hit-location AP column.** v1.4.245 wired `armourBonusHooks` into combat (`_getArmourAt`) but the sheet's `_buildHitLocations` summed only natural + worn AP, so Inherent Armour reduced damage in combat yet appeared as 0 AP on the sheet (and created no item, unlike the old approach). `_buildHitLocations` now adds the same `armourBonusHooks` sum per location, so the displayed AP matches what absorbs damage. Recomputed each render from the actor's live powers — nothing stored, updates immediately when a power is added/removed or CON/SIZ changes. Each location object also exposes `armourBonus` for optional template breakout.
- No combat-math or compendium changes; 215 tests still passing.


- **Fix: `armourBonusHooks` now applies on every damage path.** v1.4.244 added the hook but only read it inside `_applySunder`, so a registered module armour bonus (Destined Inherent Armour) only reduced damage during a Sunder special effect, not in normal combat. Folded the hook into `CombatEngine._getArmourAt` — the single armour chokepoint that full-auto, unarmed, and (now) semi-auto all route through.
- **Refactor: semi-auto armour math consolidated.** The inline natural+worn+sunder computation in `mythras.mjs` `_onSemiAutoRollDamage` is replaced by a call to `_getArmourAt`, removing a duplicated copy that had to be kept in sync. The Bodkin/Armour-Piercing AP reduction still layers on top of the result unchanged.
- **Fix: hook bonus is non-sunderable.** In `_applySunder` the hook bonus is now a separate Step-3 absorbing layer applied after the sunderable worn/natural AP, and is never recorded in the `sunderedAP` flag. Regenerating armour (recomputed each derivation cycle) cannot be permanently sundered; the previous code folded it into `effectiveNaturalAP` where a Sunder would have written a reduction that then eroded real natural AP on the next cycle.
- Added 7 integration tests to `tests/extension-hooks.test.js` covering `_getArmourAt` layering and the non-sunderable behaviour. Suite now 215, all passing.
- No compendium content changed; no `packs/` rebuild required.

## v1.4.234 — June 2026
- **Fix: broadhead bleed in semi-auto — root cause found**. The broadhead block in `_onSemiAutoRollDamage` was firing Bleed at *Roll Damage* time via a hand-built `broadCtx` and a direct `resolveBleed` call. But when `finalDamage > 0`, every other opposed SE (including a normally-chosen Bleed) fires later — at *Apply Damage* time — through the `.mi-btn-apply-dmg` handler calling `_resolveOpposedSEs`. The broadhead path was the only opposed effect not using that shared, proven dispatch, which is why it silently produced no dialog and no result card while normal Bleed worked
- **Fix approach (as suggested): reuse the existing Bleed SE end-to-end**. Broadhead now stamps a `broadhead: true` flag on the outcome card at Roll Damage time. The Apply Damage handler reads that flag and, when damage penetrates, injects `'bleed'` into the chosen-SE list it already dispatches through `_resolveOpposedSEs`. Broadhead is now mechanically identical to manually choosing Bleed: same Endurance resistance dialog, same result card, same single code path
- Removed the divergent early-firing broadhead block and the now-unused `resolveBleed` import from `mythras.mjs`. Full-auto broadhead (CombatEngine, live `ctx.ammoTraits`) is unchanged and unaffected
- Guards verified: no Bleed at zero damage (`requiresDamage` plus an explicit `damage > 0` check); no duplicate Bleed if the player also chose it; normal SE flow for non-broadhead ammo untouched

## v1.4.233 — June 2026
- **Fix: broadhead bleed — root cause was dynamic import**. `_onSemiAutoRollDamage` was using `await import('./module/combat/effects/index.js')` at runtime to get `SE_RESOLVERS`, then calling `SE_RESOLVERS['bleed']`. This dynamic import is fragile at call-time inside an async handler. Fixed by importing `resolveBleed` as a named static import at the top of `mythras.mjs` (alongside the other effects callbacks already imported there) and calling it directly. `resolveBleed` added to the re-export block in `effects/index.js`
- **Fix: bow/sling ammo model redesigned — nocked state**. Previous model (fire decrements quiver) was incorrect and caused double-decrement. New model: `system.ammo` is the "nocked/chambered" state for all ranged weapons (bows: 0 = not nocked, 1 = nocked; firearms: rounds in magazine). `Reload` on a bow decrements `ammoItem.quantity` by 1 (drawing from quiver) AND sets `system.ammo = 1 / ammoMax = 1` — the "Ammo (loaded)" field now shows 1 after nocking. Firing clears `system.ammo` back to 0 (semi-auto: `_onSemiAutoRollDamage`; full/manual: existing CE decrement). The quiver (`ammoItem.quantity`) is only ever decremented by the Reload button
- Removed the `_applyDamage` `loadedAmmoId → ammoItem.quantity` decrement block (was double-decrementing the quiver on fire)
- Reverted the `!loadedAmmoId` guard added to the CE single/burst decrement block in v1.4.232 — `system.ammo` decrement now fires for all ranged weapons as before
- Reverted `AttackerDialog` ammo display changes from v1.4.232 — `system.ammo` is the correct value for all ranged weapons and no special-casing is needed

## v1.4.232 — June 2026
- **Fix: bow/sling ammo tracking — three-part fix for the loadedAmmoId model**
- Bow and Sling compendium entries corrected: `ammo: 0` / `ammoMax: 0` (was `1/1`). The internal counter is unused for these weapons; tracking runs through the loaded ammo item's `quantity` field. Thrown weapons (Bolas, Dagger, Javelin, Stone) left at `1/1` — they are self-consuming
- `CombatEngine` single/burst ammo decrement block: now skips the `system.ammo` path when `weapon.system.loadedAmmoId` is set. Prevents the 0-ammo abort that would have blocked bow attacks after the compendium fix, and eliminates the double-decrement that occurred when both fields were non-zero
- `AttackerDialog` ammo display: when the selected weapon has `loadedAmmoId` set, reads `ammoItem.system.quantity` for both the display value and the 0-ammo disable gate, rather than `system.ammo / ammoMax`. Updates correctly when the player switches weapons mid-dialog
- **Diagnostic: broadhead bleed** — added targeted `console.log` checkpoints through the broadhead block in `_onSemiAutoRollDamage` and at the top of `_onReload` in WeaponSheet. Shows exact failure point in browser console (F12). To be removed once root cause is confirmed


## v1.4.219 — June 2026
- **Refactor 2d:** extracted `_buildLocButton(ctx, msgId)` and `_buildDmgButton(ctx, msgId, dmgFormula)` static helpers from `CombatEngine`. The hit-location button icon/label/`data-choose-location` logic (three-way `chooseLocation` / `marksman` / plain branch) and the Roll Damage button's `data-bypass-armour` + data-attribute block were copy-pasted between `_postOutcomeCard` and `_updateCardWithSEs`. Both now call the shared helpers — one place to change if button rendering ever needs updating. No behaviour changes

## v1.4.218 — June 2026
- **Refactor 2c:** deleted all ~25 thin `static async _resolveX(...) { return resolveX(...); }` wrapper stubs from `CombatEngine`. `_resolveOpposedSEs` and the `attackerScored` dispatch in `_afterDefenceResolved` now call `SE_RESOLVERS[id](ctx, ...)` directly (imported from `effects/index.js`). `mythras.mjs` now imports callback functions (`resolveEntangleBreakFree`, `resolveGripBreakFree`, `postImpaleDecisionCard`, `resolveEntangleTripYes`, `applyImpaleLodge`, `resolveImpaleYank`, `resolveDamageWeapon`) directly from `effects/index.js` rather than routing through `CombatEngine` wrappers. `config.js` `resolver` fields updated from `'_resolveX'` method names to SE id keys. `CombatEngine.js` reduced from 4,539 to 4,093 lines. No behaviour changes

## v1.4.211 — May 2026
- Fix: `opposed.js` dynamic `import('./CombatSocket.js')` used a path relative to `effects/` — should be `'../CombatSocket.js'`. Affected all 7 opposed-roll resolvers in semi-auto non-GM mode (Trip, Bleed, Stun, Disarm, Blind, DropFoe, PinDown would silently fail to show their dialog)
- Fix: Creature actor skill rolls showing 0% in the roll dialog. `CharacterSheet._onRoll` and `_onRollResistance` recompute skill total from `baseFormula + bonusPoints` for character/NPC actors, but creature actors (including MEG imports) store skills with a flat `system.total` — no formula. Added `actor.type !== 'creature'` guard to use `system.total` directly for creature actors

## v1.4.210 — May 2026
- Fix: `helpers.js` used `getFatigueSkillGrade` in `applyFatigueToSkill` but never imported it (it was available in `CombatEngine.js` scope but the import wasn't carried across during extraction). At runtime this caused `applyFatigueToSkill` to throw, breaking combat initiation (0% skill totals, combat style clicks doing nothing). Added missing `import { getFatigueSkillGrade } from '../../utils/fatigue.js'` to `helpers.js`

## v1.4.209 — May 2026
- Fix: `opposed.js` imported `resolveOpposedRoll` from `helpers.js`, but `helpers.js` only imports it for internal use and does not re-export it. At runtime this resolved to `undefined`, causing every opposed-roll resolver to throw on call (breaking character sheets). Fixed: `resolveOpposedRoll` and `classifyLocation` now imported directly from `combat-math.js` in `opposed.js`

## v1.4.208 — May 2026
- **Refactor 2b, Batch 3:** extracted 7 opposed-roll SE resolvers into `module/combat/effects/opposed.js`: `resolveBleed`, `resolveTripOpponent`, `resolveStunLocation`, `resolveDisarmOpponent`, `resolveBlindOpponent`, `resolveDropFoe`, `resolvePinDown`
- Extracted `classifyLocation` from `CombatEngine._classifyLocation` into `module/utils/combat-math.js` (pure function, zero Foundry deps, now testable). `CombatEngine._classifyLocation` becomes a delegating wrapper
- `module/combat/effects/index.js` `SE_RESOLVERS` catalogue updated with batch 3 entries
- `CombatEngine.js` reduced from 6,707 to 5,912 lines
- No behaviour changes

## v1.4.207 — May 2026
- **Refactor 2b, Batch 2:** extracted 7 simple SE resolvers into `module/combat/effects/simple.js`: `resolveWithdraw`, `resolveDuckBack`, `resolveRapidReload`, `resolveOverpenetrate`, `resolveCircumventCover`, `resolveSelectTarget`, `resolveWeaponMalfunction`
- Created `module/combat/effects/index.js` — the SE resolver catalogue (`SE_RESOLVERS` map, id → function). This is the node editor's entry point. Grows with each subsequent batch
- `CombatEngine.js` reduced from 6,896 to 6,707 lines. Wrapper stubs retained for backwards compatibility
- No behaviour changes

## v1.4.206 — May 2026
- **Refactor 2b, Batch 1:** extracted 10 shared helper methods from `CombatEngine` into `module/combat/effects/helpers.js`. `CombatEngine` retains thin static wrapper stubs for backwards compatibility — all existing callsites continue to work unchanged. `CombatEngine.js` reduced from 7,875 to 6,896 lines (~980 lines moved)
- Helpers extracted: `waitForCard`, `runSEDialog`, `runWoundEnduranceDialog`, `postOpposedSEResult`, `applyStatusToActor`, `removeStatusFromActor`, `applyProneToDefender`, `applyFatigueToSkill`, `getActiveImpaleGrade`, `getActiveEntangleGrade`
- No behaviour changes

## v1.4.205 — May 2026
- Cleanup: removed redundant double-import of `CombatEngine` (`CE2`) in Apply Damage handler
- Cleanup: replaced stale `_resolveOpposedSEs` block-comment (listed only Bleed/Trip/ForceFailure from the old if-wall era) with accurate description of all three call sites
- Cleanup: replaced stale Trip-specific comments in `_applyDamage` with registry-accurate wording
- No behaviour changes

## v1.4.204 — May 2026
- Fix: opposed SE dialogs (Trip, Disarm, etc.) still firing twice. Root cause: `_updateCardWithSEs` calls `chatMsg.update()` which causes Foundry to replace the card's HTML with a brand new DOM element. A root-element sentinel (`data-mi-listeners-bound`) does not survive this replacement, so `renderChatMessageHTML` re-ran in full on the new element, registering duplicate listeners on Roll Damage and Apply Damage. Fix: replaced root sentinel with a per-button `_bindOnce` helper that stamps `data-mi-bound` on each button element before adding its listener. Every `addEventListener` call in `_onRenderChatMessage` now goes through `_bindOnce`, making double-registration structurally impossible regardless of how many times a card is re-rendered

## v1.4.203 — May 2026
- Fix: opposed SE dialogs (Trip, etc.) firing twice per click. Root cause: `renderChatMessageHTML` fires on every render including re-renders (scroll, chat log update). Without a guard, every `addEventListener` call in `_onRenderChatMessage` accumulates an additional listener on each re-render. Added a `data-mi-listeners-bound` sentinel on the message root element — the function returns immediately on any render after the first, so all buttons receive exactly one listener

## v1.4.202 — May 2026
- Fix: opposed SE dialogs (Trip, Disarm, etc.) firing multiple times in semi-auto mode. Root cause: `mythras.mjs` contained two separate manual `hasOpposedSE` OR-lists — one in the Apply Damage button handler and one in the zero-damage path of `_onSemiAutoRollDamage` — that were not updated by the refactor. Both are now replaced with the same registry-driven `.some()` check used in `_afterDefenceResolved`
- Fix: `_resolvePinDown` has signature `(ctx, forcesFail)` — the dispatch loop was calling it as `(ctx, damage, forcesFail)`, passing damage as forcesFail. Added an explicit branch for `pinDown` alongside the existing `impale` branch

## v1.4.201 — May 2026
- Fix: registry dispatch loop in `_resolveOpposedSEs` and the `attackerScored` loop both lacked deduplication — stackable SEs (e.g. `tripOpponent`, `pinDown`) could appear multiple times in `chosenSpecialEffects` and triggered a dialog for each occurrence. Added a `seen` Set to both loops; each resolver fires exactly once. Resolvers that need the stack count (e.g. `_resolveRapidReload`) already read it themselves from `ctx.chosenSpecialEffects`

## v1.4.200 — May 2026
- **SE registry (refactor 2a):** `CONFIG.MYTHRAS.specialEffects` entries extended with `phase`, `requiresDamage`, `requiresFumble`, and `resolver` fields
- `_resolveOpposedSEs` if-wall (~100 lines, 21 branches) replaced with a 15-line data-driven loop
- `_afterDefenceResolved` attacker-scored block (4 hardcoded SEs) replaced with registry loop over `phase:'attackerScored'` entries
- `hasOpposedSE` OR-list (12 hand-maintained entries) replaced with a derived `.some()` check against the registry — can never drift out of sync
- **Bug fix (latent):** `bash`, `entangle`, and `grip` were missing from the `hasOpposedSE` OR-list, so they silently never fired when the attacker failed/fumbled. Fixed automatically by the registry-driven gate

## v1.4.199 — May 2026
- **Compendium source format migration:** all 9 packs converted from LevelDB binary to YAML `_source/` directory. `packs/` added to `.gitignore` — binary packs are no longer committed to Git
- Removed ghost null-ID entry from macros pack (LevelDB artifact from unclean shutdown)
- Removed stray `packs/professional-skills.db` and `packs/standard-skills.db` files
- Added `scripts/pack-all.mjs` and `scripts/unpack-all.mjs` for building/extracting packs
- Added `npm run pack` and `npm run unpack` scripts to `package.json`; added `@foundryvtt/foundryvtt-cli` as devDependency
- `package.json` version synced to `1.4.199` (was `1.0.0`)
- `system.json` `compatibility.minimum` corrected from `"12"` to `"14"` (system uses v14-only APIs throughout)
- `system.json` `authors` field cleaned up (was `"Christopher Herrell, vibe coded by Claude"`)

## v1.4.197 — May 2026
- CSS fix: movement input on creature/NPC sheet was dark-on-dark (no text colour set). Added `.mi-move-track input[type="text"]` rule with `color: var(--mi-teal-dark)` and `background: transparent`

## v1.4.196 — May 2026
- Fix: `SkillSheet._prepareContext` recalculated `liveBase`/`liveTotal` from `baseFormula` even when empty, overwriting MEG-imported skill values with 0. Now respects stored `total` when formula is absent

## v1.4.195 — May 2026
- Player name field removed from sheet header (not needed for any actor type)
- Weapon name pills removed from combat style rows — traits-only pills retained. Prevents column height bloat on creatures with many weapons

## v1.4.194 — May 2026
- Fix: movement field blank on creature/NPC sheet. Template now branches on actor type — characters show derived walk/run/sprint; creatures/NPCs show editable `movementRate` text input
- MEG importer: combat style weapon linking implemented. `megToFoundryActor()` now returns `{ docData, styleWeaponMap }`. Post-create `_linkStyleWeapons()` resolves weapon names to embedded item IDs and writes them into the combat style's `weapons` array

## v1.4.193 — May 2026
- MEG import button moved to Actors sidebar footer; textarea replaced with file upload (`<input type="file" accept=".json">`)
- Fix: skill totals showing 0% on creature sheet. `_calcSkillTotals` now skips recalculation when `baseFormula` is empty — stored `total` treated as authoritative (MEG-imported values)
- Hero Level, Culture, Career, Exp Mod, Exp Rolls hidden for non-character actor types via `{{#if (eq actor.type "character")}}` guards
- Standard skills collapsed from two columns to one
- Middle blank column between standard skill columns removed
- Weapon rows made draggable to combat style sheet — `draggable="true"` added with `dragstart` handler setting `{ type: 'Item', uuid }` drag data
- Formula column hidden in skill rows when `baseFormula` is empty

## v1.4.192 — May 2026
- Fix: `renderActorDirectory` hook used `html[0]` (jQuery assumption) — Foundry v14 passes plain `HTMLElement`. Fixed with `(html instanceof HTMLElement) ? html : html[0]` guard
- Selector order changed: `.header-actions` tried first, then `.directory-footer`

## v1.4.191 — May 2026
- Fix: `createItem` redistribution hook now guards `creature` type alongside existing `vehicle` guard — prevents `redistributeHitLocationRanges` overwriting MEG hand-set ranges with equal-width distribution
- Fix: `deleteItem` redistribution hook updated with same creature guard
- `createActor` seeding hook extended to include `creature` type. `hasLocations` guard prevents re-seeding when MEG items already exist in the create payload

## v1.4.190 — May 2026
- MEG importer: `module/utils/meg-import.js` — `megToFoundryActor()` transformer and `openMegImportDialog()` dialog
- `movementRate` changed from `NumberField` to `StringField` in both `NPCData` and `CreatureData` — supports compound movement strings (e.g. `15ft, 50ft fly`)
- `CharacterSheet` registered for `creature` and `npc` actor types (previously only `character`)
- MEG import: characteristics, hit locations (with natural AP per location), skills, passions (detected by name heuristic), combat styles, weapons all populated on import
- MEG import: trailing instance number stripped from creature name; rank retained

## v1.4.189 — May 2026
- Fix: `lang/en.json` nested MYTHRAS object broke all localisation — flattened back to top-level keys
- Fix: Roll Vehicle Damage and Apply Vehicle Damage buttons left in spinner state on success — both now show "✓ Rolled" / "✓ Applied" after completing

## v1.4.188 — May 2026
- Fix: AttackerDialog ignored vehicle weapon (not in any combat style). Vehicle weapon injected into `allStyleWeapons` and `stylesByWeaponId` when `ctx.vehicleWeaponAttack` is true

## v1.4.187 — May 2026
- Fix: Dialog callbacks in crew picker and style picker received jQuery object — `html.querySelector` changed to `html[0].querySelector`

## v1.4.186 — May 2026
- Phase 6b: `CombatEngine.initiateVehicleWeaponAttack`, crew picker dialog, style picker dialog
- Vehicle weapons compendium (9 items)
- VehicleSheet weapon click wiring and crew picker CSS

## v1.4.185 — May 2026
- Weapons column nudged down 3px (`padding-top`) to align baseline with System Damage column

## v1.4.184 — May 2026
- Fix: sys-grid column widths exceeded container — grid overflowed into weapons column. Columns tightened; `overflow: hidden` added

## v1.4.183 — May 2026
- Vehicle sheet widened to 780px; combat column gap and widths tuned

## v1.4.182 — May 2026
- Vehicle sheet Combat tab: System Damage and Weapon Systems placed side-by-side in flex row

## v1.4.181 — May 2026
- Vehicle system components refactored from `systems: ArrayField` to embedded `hit-location` items
- Seeding hook, redistribution guards, range-based lookup

## v1.4.180 — May 2026
- Semi-auto vehicle combat refactored into proper two-step flow (Roll Damage → Apply Damage)

## v1.4.179 — May 2026
- Fix: weapon re-lookup fails for synthetic token actors — handler rewritten to use `btn.dataset.formula` directly

## v1.4.177 — May 2026
- Fix: `defender.system.structure` and `defender.system.shields` are nested SchemaFields — all reads updated to use `toObject()`

## v1.4.176 — May 2026
- Fix: GM Mode defender panel suppressed for vehicle defenders in AttackerDialog
- Vehicle card rethemed; damage button always shown

## v1.4.175 — May 2026
- Fix: SE dialog suppressed for vehicles; `_updateCardWithSEs` call removed from vehicle path

## v1.4.174 — May 2026
- Phase 6a combat engine: `_resolveVehicleAttack`, `_applyVehicleDamage`, `_postVehicleOutcomeCard`, `_updateVehicleCardWithDamage`, semi-auto button handler

## v1.4.173 — May 2026
- All vehicle ±buttons and delete icons made permanently visible (removed hover-fade opacity)

## v1.4.172 — May 2026
- Vehicle stats bar: Structure and Shields tracks converted to AP-style vertical ±button stacks

## v1.4.171 — May 2026
- Vehicle sheet Combat tab: crew roster (drag-drop actors, role field), system damage named slots, 1d10 reference table, weapons tab

## v1.4.170 — May 2026
- Phase 6a: Vehicle actor type — VehicleData schema, VehicleSheet (two-tab), vehicle-sheet.hbs
- Vehicle traits compendium (27 items), CSS, lang keys, system.json registration

---

*Earlier versions (v1.4.1 – v1.4.169) covered Phases 1–5c, 5d, A, B, and 6 — core scaffold, data models, character sheet, roll engine, full melee and ranged combat engine, all Special Effects, merchant actor, trait items, Hero Level system, token wound badges, and AP override. These were developed prior to formal changelog tracking.*

---

## Versioning Note

Version numbers follow `1.4.x` where x increments on every tested build. There is no semantic versioning — a minor CSS fix and a major engine feature both increment x by 1. The number reflects build sequence, not feature significance.
