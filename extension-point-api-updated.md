# Extension-point / boundary contract — Mythras Imperative

**Last updated: v1.4.261.**

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

Every hook below is **read-time** except one, and every hook **sums** except two:

- **Read-time hooks** are consumed inside `CharacterData#prepareDerivedData`
  (or, for `armourBonusHooks`, inside `CombatEngine`'s armour chokepoints).
  They derive a value fresh from the actor's current powers on every
  derivation cycle. Nothing is stored or reverted — call a hook twice and you
  get the same answer, because the base it adds to is recomputed each time.
- **`hitPointBonusHooks` is write-time** — the one exception to *when* hooks
  run. It is consumed by `syncHitLocationHP(actor)` in `mythras.mjs`, the sole
  writer of hit-location item `system.hp` (max). hit-location **items** are
  the HP-max authority, not `CharacterData.hitLocations` (that derived object
  is not read for HP-max by anything). Do not reintroduce a read-time
  consumption of this hook in derived data — that produced a derived/persisted
  drift, which is why the HP-max lock moved consumption to the writer.
- **`weaponDamageHooks` / `weaponForceHooks` are OVERRIDE (first-wins), not
  sum** — the exception to *how* hooks combine. Every other array on this
  object sums or mutates; these two instead consult hooks in order and stop
  at the first non-`undefined` result. They also fire at **roll time**, inside
  `CombatEngine`, not during `prepareDerivedData` — see the dedicated section
  below.

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
| `armourBonusHooks` | `(actor, locationId) => number` | Read-time | `CombatEngine._getArmourAt` (raw AP composition — natural + worn + this hook's sum, minus sunder), `CombatEngine._applySunder` (non-sunderable extra layer), `CharacterSheet._buildHitLocations` (sheet AP column) | Non-negative AP added at a location, on top of natural + worn AP. Never mutates stored AP; regenerates each resolution and cannot be permanently sundered. **Since v1.4.261**, every damage-resolution path (Full Auto, Burst Fire, semi-auto Roll Damage) reads this indirectly through `CombatEngine._getEffectiveArmourAt` — the sole chokepoint for *effective* armour, which wraps `_getArmourAt` and layers Bodkin/Armour Piercing ammo-trait reduction on top. This hook's own contract is unchanged; only the piercing layer above it was unified. |
| `movementHooks` | `(actor) => number` | Read-time, before Walk/Run/Sprint derive | `CharacterData#prepareDerivedData` | Signed integer added to the stored `movementRate` base (not mutated) before the Walk/Run/Sprint trio derives from it. Floored at 0. |
| `initiativeOffsetHooks` | `(actor) => number` | Read-time, after base Initiative Bonus | `CharacterData#prepareDerivedData` | Signed integer added to `attributes.initiativeBonus`. |
| `healingRateHooks` | `(actor) => number` | Read-time, after CON-table base, BEFORE the Hero Level ×2 | `CharacterData#prepareDerivedData` | Signed integer added to `attributes.healingRate` before the `healingRate` advantage doubling, so the delta stacks additively then doubles. |
| `luckPointsHooks` | `(actor) => number` | Read-time, after POW-table base AND after Hero Level luckyPoint/luckyPoint2 | `CharacterData#prepareDerivedData` | Signed integer added to `attributes.luckPoints.max`. A `value > max` clamp runs immediately after. |
| **`powerPointsHooks`** | `(actor) => number` | Read-time — but the system contributes **no base** | `CharacterData#prepareDerivedData`, same stage as the other `.max` hooks (after `characteristicBonusHooks`; ordering isn't load-bearing here — no power modifies POW) | The hook sum **is** `attributes.powerPoints.max`, not an addition to a system-computed base like every other `.max` hook above. Empty array → 0, the field's stored initial value — a true no-op. See the dedicated section below. |
| `damageModOffsetHooks` | `(actor) => number` | Read-time, summed with the manual `dmOffset` before the DM table lookup | `CharacterData#prepareDerivedData` | Signed step shift along the 15-step Damage Modifier table. STR itself is never touched — only the derived Damage Modifier shifts. |
| **`damageHooks`** | `(ctx, damage) => number \| false \| undefined` | Interception, at damage-write time, **composing** (not first-wins) | `CombatEngine._applyDamage` — see dedicated section below | Return `false` to suppress damage entirely (absolute, short-circuits the loop). Return a finite number to replace damage with that value; later hooks see the already-reduced value, so independent reductions compose. Any other return (including `undefined`) declines. |
| **`hitPointBonusHooks`** | `(actor, locationId) => number` | **Write-time** — the one exception | `syncHitLocationHP(actor)` in `mythras.mjs` | Flat integer added to a location's max HP, beside the Hero Level HP bonus, before persisting to the hit-location item's `system.hp`. `locationId` is the full 7-key camelCase vocabulary (see above), letting a per-location power vary by side even though the base CON+SIZ table computes one value per limb pair. Used for Enhanced Body HP, Durability HP, flat Power-Level HP — none of which reduce to a CON bump (that would wrongly cascade into healing rate, Inherent Armour AP, and CON-keyed skills). |
| **`weaponDamageHooks`** | `(weapon, actor) => string \| undefined` | Roll-time, **override (first-wins)**, not `prepareDerivedData` | `CombatEngine._getWeaponDamage` — every damage-formula build in the engine, plus `CharacterSheet._onRollDamage` | Return a damage formula string to override `weapon.system.damage`, or `undefined` to decline. First non-`undefined` result wins; no summing. See dedicated section below. |
| **`weaponForceHooks`** | `(weapon, actor) => string \| undefined` | Roll-time, **override (first-wins)**, not `prepareDerivedData` | `CombatEngine._getWeaponForce` — `resolveParryReduction` (both sides) and `_buildWardList` (passive blocking) | Return a Force/Size code (`S`/`M`/`L`/`H`/`E`) to override `weapon.system.parrySize`, or `undefined` to decline. First non-`undefined` result wins; no summing. See dedicated section below. |

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

### `MYTHRAS.weaponDamageHooks[]` / `MYTHRAS.weaponForceHooks[]`

- **Type**: `Function[]`, each `(weapon, actor) => string | undefined`.
- **Called from**: `CombatEngine._getWeaponDamage(weapon, actor)` and `CombatEngine._getWeaponForce(weapon, actor)` — the single chokepoint every damage-formula build and every parry-size lookup in the combat engine goes through (`module/combat/CombatEngine.js`). Not consumed in `prepareDerivedData` — these fire at **roll time**, potentially several times per attack (once per formula build / parry-size lookup, on both the attack and defence side of an exchange).
- **Contract — override, not sum:**
  - Return `undefined` to decline. This is the overwhelmingly common case — almost every weapon rolls its own stored `damage` / `parrySize` unmodified.
  - The **first** hook to return a non-`undefined` value wins. Remaining hooks are **not consulted** — there is no sensible way to "add" two damage-formula strings, so this array does not follow the additive pattern every other hook array in this file does.
  - Hooks must be **pure and side-effect free** — no actor/item writes, no PP spend, no chat output. A throwing hook is caught, logged, and treated as a decline (the loop continues to the next hook).
- **`actor` is the actual wielder, never `weapon.actor`.** For a normal attack this is the same thing, but for a vehicle-mounted weapon fired by a crew member (`CombatEngine.initiateVehicleWeaponAttack` → `initiateAttack(crewMemberActor, vehicleWeaponItem)`), `weapon.actor` resolves to the **vehicle**, while the wielder whose characteristics actually matter is the **crew member**. Every call site threads through `ctx.attacker` / `ctx.defender` (the crew member in the vehicle case) rather than reading `weapon.actor`, specifically to keep this correct.
- **`actor.system.characteristics.*.value` already reflects `characteristicBonusHooks`** — hooks here fire after that array has already mutated the actor's prepared characteristics for the current cycle, so a hook reading `actor.system.characteristics.pow.value` sees Growth/Shrink/Morph/Enhanced-STR adjustments applied, not the raw stored score.
- **`resolveParryReduction` signature change**: `resolveParryReduction(attackWeapon, defenceWeapon, defenderStyle, ctx = null, attackerActor = null, defenderActor = null)`. The two new trailing params are optional — when `ctx` is supplied (as two of its three call sites in `CombatEngine.js` already do), the wielder actors are read from `ctx.attacker` / `ctx.defender` automatically. The third call site (`mythras.mjs`'s semi-auto Roll Damage handler) has no `ctx` object at that point, so it passes `attacker`/`defender` explicitly as the trailing args instead.
- **Zero behavior change today.** With no hooks registered (every actor, as of this release), both methods fall straight through to exactly what every call site read before: `weapon.system.damage` and `weapon.system.parrySize` respectively — bit-for-bit identical, verified against the full 274-test pre-change baseline plus the 17 new tests covering the chokepoint itself.
- **Deliberately not routed**: `opposed.js` `resolveDisarmOpponent` reads `weapon.system.size` directly (a physical-mass grapple contest, not the Force mechanic — reading `parrySize` would silently change ranged-weapon disarm behavior) and the GM/dev-only `macro-test-special-effects.js` (not part of the shipped attack path, not test-covered). Both confirmed intentionally left alone.
- **Deliberately no range hook.** Blast's range derivation is a separate, later question — how ranged bands are stored/consumed hasn't been audited, and adding a hook nobody calls yet is worse than adding nothing.
- **Motivating use case** (Destined Blast, module-side, later task): Core Blast damage/Force derive from POW; Mega Blast from POW+½STR (physical) or POW+½INT (energy) — all live characteristics that Morph, Growth, Shrink, and Enhanced Strength can move mid-session via `characteristicBonusHooks`. A stored formula string would go stale the instant one of those fires. Deriving the value inside a `WeaponData` getter was considered and rejected: an embedded item can prepare *before* its owning actor's `characteristicBonusHooks` have run, so the getter could read unhooked (stale) characteristics — reintroducing the exact snapshot-vs-live bug this chokepoint exists to prevent, one layer down. The resolver must be a function called at roll time with the already-prepared actor, never a getter on the item's own data model — `ItemData.js` has zero uses of `this.parent` anywhere, and this doesn't change that.

### `MYTHRAS.damageHooks[]`

- **Type**: `Function[]`, each `(ctx, damage) => number | false | undefined`.
- **Called from**: `CombatEngine._applyDamage(ctx, damage)`, once per hook, immediately before damage is written to the defending hit location's `system.current`/`system.wound`. `ctx` carries `ctx.defender`, `ctx.weapon`, `ctx.hitLocationId`, and the rest of the attack context.
- **Contract — composing, not first-wins** (the opposite convention from `weaponDamageHooks`/`weaponForceHooks` above — the two mechanisms sit right next to each other in `config.js` and are easy to conflate, so this is worth stating plainly):
  - Return `false` to suppress damage entirely (full immunity). This is **absolute** and short-circuits the loop — no later hook runs after a `false`, even one that would otherwise raise damage.
  - Return a finite number to **replace** damage with that value. Unlike `weaponDamageHooks`, numeric results **compose**: each hook receives damage as already reduced by every earlier hook in the array, so two independent reductions (e.g. a resistance power and a shield) both apply rather than only the first one taking effect. The result is floored to a non-negative integer (`Math.max(0, Math.floor(result))`) before the next hook sees it.
  - Any other return — `undefined`, `null`, `true`, a string, `NaN` — is ignored; the hook declines and damage is unchanged for the next hook. `NaN` is explicitly excluded even though `typeof NaN === 'number'`, since an unfiltered `NaN` would propagate into `system.current` and corrupt a hit location.
- **This loop has no try/catch of its own.** A throwing hook propagates uncaught out of `_applyDamage` — hooks must not throw. (Destined's `registerHook` wrapper catches at the registration site and must return `undefined`, not `0`, on error — see that module's `module-CLAUDE.md` for the reasoning; a caught error returning `0` here would read as "suppress all damage," not "this hook declined.")
- **Read the DEFENDER's flag/state, not the attacker's** — `_applyDamage` is called with the target as `ctx.defender`; a damage-reduction hook that reads the attacker's state instead would silently grant immunity to the wrong side of the exchange.
- **Chokepoint history — this array had exactly one path to it until v1.4.258/259.** Full-Auto and several internal `CombatEngine` call sites (Sunder carry-over, Stun Round, the Full-Auto immediate-resolve path) always routed through `_applyDamage` and always consumed this array. The **semi-auto "Apply Damage" button** (`mythras.mjs`, `.mi-btn-apply-dmg`) did not — it hand-built a duplicate of `_applyDamage`'s write/SE-resolution/wound-consequence logic and wrote `system.current`/`system.wound` directly, bypassing `damageHooks` entirely for what is the GM's primary damage-application workflow. Fixed in two batches: **v1.4.258** added `CombatEngine._ctxFromCardFlags` (rehydrates a full `ctx` from an outcome chat card's stamped flags) and swapped it into the button's hand-built `ctx`, waking previously-inert Knockout Blow and fumble-gated Special Effects in semi-auto as a side effect; **v1.4.259** replaced the button's duplicated body with a direct `CombatEngine._applyDamage(ctx, damage)` call, which is what makes `damageHooks` reachable from that path at all. Before v1.4.259, any module `damageHooks` consumer (e.g. Destined's Vaporous Form) was silently unreachable from the button a GM actually clicks in semi-auto — full damage was the correct, if surprising, observed behavior on any build before that version.
- **Numeric-return support is v1.4.255+.** Before that release the loop only recognized `false`; a hook returning a finite number was ignored (treated as a decline) and the reduction silently did not apply. A consumer targeting partial damage reduction (not full immunity) must declare this version as a minimum and confirm it at registration time — declaring the hook array present is not sufficient, since an older engine has the array but not the numeric-return behavior.
- **Known remaining bypasses of this chokepoint**, not yet closed: `CombatEngine._resolveFullAutoDamage` (~L1350) and `_resolveBurstDamage` (~L1505) both call `_applyDamage` directly at their own damage-write points and so *do* consume `damageHooks` — not a bypass, included here only to record that this was verified against the actual call sites, not assumed (an earlier draft of this line cited a stale `~L2871`, which is dead space between two unrelated helper methods — corrected after re-checking); `impale.js`'s `resolveImpaleYank` writes `system.current` directly (L334) with no `_applyDamage` call at all — a genuine, confirmed bypass, and may be intentional per rules p.44 (armour does not reduce Yank damage) — pending a rules decision, not a code fix; `CombatEngine._applyVehicleDamage` (~L2430) writes the hit-location item directly too, also a genuine bypass — a different actor type (vehicle system components, not PC hit locations), out of scope for this hook.

### `MYTHRAS.weaponTraits` (registry, not a hook array)

Not a `Function[]` like every other entry in this file — a plain object registry of trait definitions, extended by modules during their own `setup` hook (`module/config/config.js` documents this pattern for `weaponTraits`/`creatureTraits`/`vehicleTraits` alike). Included here because a module (Destined) now depends on it as part of a `damageHooks` consumer's contract.

- **Shape**: `CONFIG.MYTHRAS.weaponTraits[key] = { key, label, description, engineEffect }`. `key` is the canonical string the engine/module matches against via `weapon.system.traits.includes(key)`; `engineEffect: true` marks a trait the combat engine (or a consuming module) reads mechanically, as opposed to a narrative-only trait.
- **Extension pattern**: `CONFIG.MYTHRAS.weaponTraits.<newKey> = { ... }`, added during the module's `setup` hook, same convention as `creatureTraits`/`vehicleTraits`. No system code needs to change — `traits.includes(key)` continues to work for any key, registered by the system or a module.
- **Destined usage** (v1.9.49): registers `CONFIG.MYTHRAS.weaponTraits.energy` (`label: 'Energy'`), making "Energy" a selectable checkbox on the weapon sheet. Consumed by the module's own `isEnergyWeapon(weapon)` helper (checks `traits.includes('energy')` OR a `destined-module.energyWeapon` item flag, for a boost that may tag a weapon at effect-layer level rather than editing its traits), which in turn feeds a `damageHooks` consumer (Vaporous Form: energy attacks take half damage rounded up; physical attacks are fully immune).

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

- **v1.4.261** — Effective-armour resolution (raw AP + Bodkin/Armour Piercing ammo-trait reduction) unified into `CombatEngine._getEffectiveArmourAt`, the sole chokepoint every damage path now calls. Three independent copies existed before this (Full Auto, Burst Fire, semi-auto Roll Damage) and had drifted: Burst Fire's copy had no piercing branch at all — firing burst with Bodkin/Armour Piercing ammo silently ignored the AP reduction on every round, a genuine player-facing bug, now fixed. Ammo-trait lookup itself is likewise unified into `CombatEngine._resolveAmmoTraits` (with its `type === 'ammo'` type guard) — `_buildContext` already had the correct version; the semi-auto handler had two separate, divergent re-implementations of its own. `armourBonusHooks`' own contract, and `_getArmourAt`'s raw-AP arithmetic, are unchanged — this only unifies the piercing layer sitting on top of them. See `CHANGELOG.md`'s v1.4.261 entry for the full account, including two corrections this batch made to its own originating prompt: `CombatEngine._ctxFromCardFlags` (referenced in the `damageHooks` section below) is **not** dead code — it is called live by the semi-auto Apply Damage button handler, a different function from the one (`_onSemiAutoRollDamage`) that still regex-scrapes the outcome card for `data-location-id`; and the vehicle damage path (`_applyVehicleDamage`) was checked and confirmed to use an entirely separate Shields-then-Hull mechanic, not this chokepoint.
- **v1.4.258/v1.4.259** — Damage chokepoint fix: the semi-auto "Apply Damage" button now routes through `CombatEngine._applyDamage`, making it the last remaining primary damage-application path to actually consume `damageHooks`. See the dedicated `damageHooks` section above for the full history — this is a behavior-waking fix (Knockout Blow, fumble-gated SEs, and any module `damageHooks` consumer all become reachable from this path for the first time), not a new hook.
- **v1.4.255** — `damageHooks` consumers may return a finite number for partial damage reduction, composing across hooks; previously only `false` (full suppression) was recognized and a numeric return was silently ignored. (`CombatEngine._ctxFromCardFlags` is a separate change and was **not** part of this release — it was added, and immediately wired into the semi-auto button's ctx, entirely within the v1.4.258 commit below; verified against `git show` for both commits before writing this, after an earlier draft of this line wrongly attributed it here.)
- **v1.4.254** — `weaponDamageHooks` / `weaponForceHooks` added: a roll-time, override (first-wins) pair — the only hooks on this object that don't sum, and the only ones consumed outside `prepareDerivedData`. Every damage-formula build and parry-size lookup in `CombatEngine` now routes through `_getWeaponDamage`/`_getWeaponForce`. Empty arrays by default — no behavior change for any existing weapon until a module (Destined Blast, later task) registers into them.
- **v1.4.253** — `powerPointsHooks` added (Batch 4A, system-side only): a read-time hook where the system contributes no base, so the hook sum is `attributes.powerPoints.max` outright. Empty array by default — no behavior change for any existing actor until a module (Destined, Batch 4B) registers into it.
- **v1.4.250** — `hitPointBonusHooks` reclassified write-time; consumption moved from `CharacterData#_calcHitLocationHP` to `syncHitLocationHP`. Location-key vocabulary for `hitPointBonusHooks` expanded from the old 5-key set (`head`/`chest`/`abdomen`/`arm`/`leg`) to the full 7-key camelCase vocabulary shared with `armourBonusHooks`.
