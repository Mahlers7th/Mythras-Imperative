# Extension-point / boundary contract — Mythras Imperative

**Last updated: v1.4.253.**

Modules (primarily Destined) extend the system via arrays and objects on
`CONFIG.MYTHRAS.*`. This file did not exist before v1.4.250 — it is being
initialized here, sourced from the authoritative JSDoc comments in
`module/config/config.js` and the call sites that consume each hook. Keep it
in sync with `module/config/config.js` whenever a hook's contract changes.
The Phase 3a hooks (`luckPointsHooks`, `healingRateHooks`,
`initiativeOffsetHooks`, `movementHooks`, `hitPointBonusHooks`,
`damageModOffsetHooks`) landed in the codebase in v1.4.247–249, ahead of this
doc's v1.4.250 creation — they're captured in the table below as of that
entry rather than as separate historical change-log lines. `powerPointsHooks`
landed in v1.4.253 and is documented in full below.

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
| **`powerPointsHooks`** | `(actor) => number` | Read-time — but the system contributes **no base** | `CharacterData#prepareDerivedData`, same stage as the other `.max` hooks (after `characteristicBonusHooks`; ordering isn't load-bearing here — no power modifies POW) | The hook sum **is** `attributes.powerPoints.max`, not an addition to a system-computed base like every other `.max` hook above. Empty array → 0, the field's stored initial value — a true no-op. See the dedicated section below. |
| `damageModOffsetHooks` | `(actor) => number` | Read-time, summed with the manual `dmOffset` before the DM table lookup | `CharacterData#prepareDerivedData` | Signed step shift along the 15-step Damage Modifier table. STR itself is never touched — only the derived Damage Modifier shifts. |
| `damageHooks` | `({ actor, location, damage, source }) => void` | Read-time / interception | Damage application path | Intercept for damage-reduction powers, shields, etc. |
| **`hitPointBonusHooks`** | `(actor, locationId) => number` | **Write-time** — the one exception | `syncHitLocationHP(actor)` in `mythras.mjs` | Flat integer added to a location's max HP, beside the Hero Level HP bonus, before persisting to the hit-location item's `system.hp`. `locationId` is the full 7-key camelCase vocabulary (see above), letting a per-location power vary by side even though the base CON+SIZ table computes one value per limb pair. Used for Enhanced Body HP, Durability HP, flat Power-Level HP — none of which reduce to a CON bump (that would wrongly cascade into healing rate, Inherent Armour AP, and CON-keyed skills). |

### `MYTHRAS.powerPointsHooks[]`

- **Type**: `PowerPointsHook[]` — `Function[]`, each `(actor) => number`.
- **Called from**: `CharacterData#prepareDerivedData`, at the same stage as the other `.max` resource hooks (after `characteristicBonusHooks` for consistency with the established pattern — ordering isn't load-bearing here, since no power modifies POW).
- **Signature**:
  ```js
  /**
   * @callback PowerPointsHook
   * @param {Actor} actor
   * @returns {number} PP max contribution. Summed across hooks. Read-only; must
   *   not mutate the actor. Synchronous. Idempotent (runs every derivation pass).
   */
  ```
- **The distinguishing detail — the system contributes no base.** Every other `.max` hook in this table adds to a value the system already computed (a CON/POW/INT+DEX table lookup). `powerPointsHooks` doesn't: `attributes.powerPoints` is a module-owned resource pool the system never populates a base for (see the schema comment in `CharacterData.js` next to the `powerPoints` field). Consumption is `0 + Σ hooks`, not `base + Σ hooks` — **the hook sum is the max**. An empty array therefore resolves to `0`, the field's stored initial value, so registering no hooks is a true no-op: zero behavior change for every existing actor. The consuming code accumulates into a local variable and assigns once (`attr.powerPoints.max = ppMax`) rather than `+=` directly on the field — there is no prior `=` assignment in this derivation pass to reset against, so `+=` would accumulate across every render instead of recomputing fresh.
- **Destined usage** (landing in Batch 4B): `powerPointsForActor(actor)` returns `actor.system.characteristics.pow.value + POWER_LEVEL_STATS[level].ppMod`, registered into `CONFIG.MYTHRAS.powerPointsHooks` from the module's `setup` hook. Destined registers exactly one hook, so its return value owns the entire max — this array isn't designed for several modules to compose sums the way `luckPointsHooks` et al. are, though nothing structurally prevents it.

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

- **v1.4.253** — `powerPointsHooks` added (Batch 4A, system-side only): a read-time hook where the system contributes no base, so the hook sum is `attributes.powerPoints.max` outright. Empty array by default — no behavior change for any existing actor until a module (Destined, Batch 4B) registers into it.
- **v1.4.250** — `hitPointBonusHooks` reclassified write-time; consumption moved from `CharacterData#_calcHitLocationHP` to `syncHitLocationHP`. Location-key vocabulary for `hitPointBonusHooks` expanded from the old 5-key set (`head`/`chest`/`abdomen`/`arm`/`leg`) to the full 7-key camelCase vocabulary shared with `armourBonusHooks`.
