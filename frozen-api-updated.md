# Frozen API — Mythras Imperative

Signatures on this page are called directly by external consumers (the
planned node editor, modules, macros). **Do not change a frozen signature
without updating this doc and the runtime in the same change.** A signature
change here is a breaking change for every caller listed.

This file did not exist before v1.4.250 — it is being initialized with the
entries verified as part of the HP-max lock work. It is not yet a complete
audit of every frozen surface in the codebase; expand it as other
already-frozen entry points are confirmed.

| Symbol | Signature | Caller(s) | Notes |
|---|---|---|---|
| `SE_RESOLVERS` | `{ [seId: string]: (ctx) => Promise }` | Node editor (planned), `CombatEngine._resolveOpposedSEs`, `_afterDefenceResolved` | Exported from `module/combat/effects/index.js`. Keys match `id` in `CONFIG.MYTHRAS.specialEffects`. |
| `game.system.api.syncHitLocationHP` | `(actor: Actor) => Promise<void>` | Destined module, macros, GM console | Sole writer of hit-location item `system.hp` (max). Attached in the `ready` hook via `Object.freeze({ syncHitLocationHP })`. Also exported from `mythras.mjs` for internal use by the `updateActor` hook. See `extension-point-api-updated.md` for the `hitPointBonusHooks` contract it consumes. Idempotent — safe to call repeatedly; only writes locations whose computed max differs from the stored value. |

## Change log

- **v1.4.250** — `game.system.api.syncHitLocationHP` added as the first frozen `game.system.api` entry.
