# Changelog

All notable changes to this project are documented here.

Versions follow the `1.4.x` scheme. Each entry covers what was built and tested in that build.

---

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
