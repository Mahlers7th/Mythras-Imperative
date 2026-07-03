# Extension-point / boundary contract — Mythras Imperative

Modules (primarily Destined) extend the system via arrays and objects on
`CONFIG.MYTHRAS.*`. This file did not exist before v1.4.250 — it is being
initialized here, sourced from the authoritative JSDoc comments in
`module/config/config.js` and the call sites that consume each hook. Keep it
in sync with `module/config/config.js` whenever a hook's contract changes.

## Timing model

Every hook below is **read-time** except one:

- **Read-time hooks** are consumed inside `CharacterData#prepareDerivedData`
  (or, for `armourBonusHooks`, inside `CombatEngine`'s armour chokepoints).
  They derive a value fresh from the actor's current powers on every
  derivation cycle. Nothing is stored or reverted — call a hook twice and you
  get the same answer, because the base it adds to is recomputed each time.
- **`hitPointBonusHooks` is write-time** — the one exception. It is consumed
  by `syncHitLocationHP(actor)` in `mythras.mjs`, the sole writer of
  hit-location item `system.hp` (max). hit-location **items** are the HP-max
  authority, not `CharacterData.hitLocations` (that derived object is not
  read for HP-max by anything). Do not reintroduce a read-time consumption of
  this hook in derived data — that produced a derived/persisted drift, which
  is why the HP-max lock moved consumption to the writer.

## Location-key vocabulary

`armourBonusHooks` and `hitPointBonusHooks` both receive the canonical
camelCase location key: `head`, `chest`, `abdomen`, `rightArm`, `leftArm`,
`rightLeg`, `leftLeg`. It is derived from the hit-location item's
`system.label` (falling back to `name`) via `locationNameToKey` in
`module/utils/hit-location.js` — the single canonical mapper, as of v1.4.251.
`CharacterSheet`'s AP display and `syncHitLocationHP` both resolve a
location's key through this one import. (`CombatEngine`'s two armour
chokepoints still carry their own inline copy of the same regex — functionally
equivalent for the 7 standard labels today, but a candidate for the same
consolidation.) **Do not reintroduce a second, independent derivation** — two
implementations of the same contract is a drift risk: `syncHitLocationHP` and
`CharacterSheet` briefly had separate copies (v1.4.250) before being
consolidated here specifically to close that risk.

## Hooks

| Hook array | Signature | Timing | Consumed in | Purpose |
|---|---|---|---|---|
| `characteristicBonusHooks` | `(chars, actor) => void` | Read-time, first in `prepareDerivedData` | `CharacterData#prepareDerivedData` | Mutates the live `characteristics` object in place before any characteristic local is read, so deltas cascade into every derived value. E.g. Enhanced STR, Growth/Shrink. |
| `apBonusHooks` | `(actor) => number` | Read-time, after base AP + fatigue | `CharacterData#prepareDerivedData` (and the fatigue-change branch of the `updateActor` hook in `mythras.mjs`) | Positive integer bonus AP, summed, result clamped to a minimum of 1. |
| `armourBonusHooks` | `(actor, locationId) => number` | Read-time | `CombatEngine._getArmourAt` (primary chokepoint for all damage paths), `CombatEngine._applySunder` (non-sunderable extra layer), `CharacterSheet._buildHitLocations` (sheet AP column) | Non-negative AP added at a location, on top of natural + worn AP. Never mutates stored AP; regenerates each resolution and cannot be permanently sundered. |
| `movementHooks` | `(actor) => number` | Read-time, before Walk/Run/Sprint derive | `CharacterData#prepareDerivedData` | Signed integer added to the stored `movementRate` base (not mutated) before the Walk/Run/Sprint trio derives from it. Floored at 0. |
| `initiativeOffsetHooks` | `(actor) => number` | Read-time, after base Initiative Bonus | `CharacterData#prepareDerivedData` | Signed integer added to `attributes.initiativeBonus`. |
| `healingRateHooks` | `(actor) => number` | Read-time, after CON-table base, BEFORE the Hero Level ×2 | `CharacterData#prepareDerivedData` | Signed integer added to `attributes.healingRate` before the `healingRate` advantage doubling, so the delta stacks additively then doubles. |
| `luckPointsHooks` | `(actor) => number` | Read-time, after POW-table base AND after Hero Level luckyPoint/luckyPoint2 | `CharacterData#prepareDerivedData` | Signed integer added to `attributes.luckPoints.max`. A `value > max` clamp runs immediately after. |
| `damageModOffsetHooks` | `(actor) => number` | Read-time, summed with the manual `dmOffset` before the DM table lookup | `CharacterData#prepareDerivedData` | Signed step shift along the 15-step Damage Modifier table. STR itself is never touched — only the derived Damage Modifier shifts. |
| `damageHooks` | `({ actor, location, damage, source }) => void` | Read-time / interception | Damage application path | Intercept for damage-reduction powers, shields, etc. |
| **`hitPointBonusHooks`** | `(actor, locationId) => number` | **Write-time** — the one exception | `syncHitLocationHP(actor)` in `mythras.mjs` | Flat integer added to a location's max HP, beside the Hero Level HP bonus, before persisting to the hit-location item's `system.hp`. `locationId` is the full 7-key camelCase vocabulary (see above), letting a per-location power vary by side even though the base CON+SIZ table computes one value per limb pair. Used for Enhanced Body HP, Durability HP, flat Power-Level HP — none of which reduce to a CON bump (that would wrongly cascade into healing rate, Inherent Armour AP, and CON-keyed skills). |

## `syncHitLocationHP` trigger contract

`syncHitLocationHP(actor)` runs from the `updateActor` hook in `mythras.mjs`
when any of the following change on the `changed` diff:

- `system.characteristics.con.value`
- `system.characteristics.siz.value`
- `system.heroAdvantages`
- `flags.destined-module` (any change under this namespace)

It is also exposed on the frozen `game.system.api.syncHitLocationHP` (see
`frozen-api-updated.md`) so a module can force a resync directly — e.g. after
a batched update the guard above didn't observe as a single change event.

## Change log

- **v1.4.250** — `hitPointBonusHooks` reclassified write-time; consumption moved from `CharacterData#_calcHitLocationHP` to `syncHitLocationHP`. Location-key vocabulary for `hitPointBonusHooks` expanded from the old 5-key set (`head`/`chest`/`abdomen`/`arm`/`leg`) to the full 7-key camelCase vocabulary shared with `armourBonusHooks`.
