# Changelog

All notable changes to this project are documented here.

Versions follow the `1.4.x` scheme. Each entry covers what was built and tested in that build.

---

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
