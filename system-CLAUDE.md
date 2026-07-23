# CLAUDE.md — Mythras Imperative (Foundry VTT v14 system)

System `id: mythras-imperative`. Solo project, AI-assisted (disclosed in README). Public repo, source-available licence. Foundry **v14** (ApplicationV2, HandlebarsApplicationMixin, TypeDataModel, LevelDB packs). Serves as the clean v14 foundation for the **Destined** module (superpowers, primary integration target) and a lower-priority Classic Fantasy module.

Chris directs all architecture/design and is the sole live tester. Claude reads, writes, tests, and packages.

## Golden rules

- **Read before touching.** Full read of any file before editing it. On large files, `grep -n` to anchor, then `sed -n 'start,endp'` for a targeted range — never broad reads.
- **Design is locked before code**, especially anything crossing the system↔module boundary. If a change touches the boundary and the design isn't locked, stop and ask.
- **One stable, tested release before the next.** Tighter batches over big ones. Always flag an untested build as untested.
- **Never modify `system.*` proxies directly.** `item.system` / `actor.system` are sealed TypeDataModel proxies. Use `item.system.toObject()` for templates, `item.update({...})` / `actor.update({...})` for persistence.

## Verify → package sequence (do not skip steps)

1. `node --check <file>` on every touched `.js`/`.mjs`. **Insufficient alone** — passes on syntactically valid JS with undefined objects.
2. Runtime import smoke test with mocked Foundry globals (`Hooks`, `CONFIG.MYTHRAS`, `game`, `foundry`, `Dialog`, `Actor`, `Item`). Top-level DataModel schema defs fail under minimal mocks — extract the function and `node -e` test its logic instead.
3. `npm test` (Jest). Suite is currently **365 tests** (`combat-math.js`, `char-math.js`, `roll-math.js`, and `tests/extension-hooks.test.js`'s mirror-style coverage of Foundry-coupled `CombatEngine`/`CharacterData` call sites — see that file's header for the mirroring convention). `jest.fn`/mock helpers are **not available** in this project's ESM Jest setup (`--experimental-vm-modules`, no global injection) — hand-roll a spy (record calls in a closure array) instead of reaching for `jest.fn()`. Keep the suite green; add tests for new pure logic.
4. Package **only after** the above pass.

When a regression is silent (no Foundry error, no `node --check` failure): **diff against the last known-good build immediately.** Dropped declarations leave valid JS that fails only at runtime. Prefer iterative rollback over forward-patching. Exported item JSON from the running game is more diagnostic than static analysis.

## v14 architectural invariants (do not relearn these the hard way)

- `renderActorSheet` is **dead** on ApplicationV2 sheets → use `renderCharacterSheet`.
- `.mythras` CSS scope is absent from the v14 sheet root → use `.mythras-sheet` selector twins.
- `getFlag`/`setFlag` keys that look like type refs are **flag-scope keys** — never rename them during type-string migrations.
- Status effects apply to the **synthetic token actor**, not the base actor (prevents cross-token persistence).
- `DEFAULT_OPTIONS.actions` must not reference class methods in static field initializers — wire handlers in `_onRender`.
- Form inputs with a `name` attr are collected by ApplicationV2 `submitOnChange` on every change → render/submit race. Drop `name`, use explicit `change` listeners for manually-managed fields.
- `game.i18n.localize()` cannot run during `init` (i18n not ready in v14).
- `Dialog` callbacks are **not awaited** — use a synchronously-set `resolved` flag in every button callback to guard async races.
- All condition writes go through `_applyStatusToActor`; all opposed-roll results post a chat card via `_postOpposedSEResult` regardless of automation mode.
- **Effective armour AP (raw AP + Bodkin/Armour Piercing ammo reduction, plus any `apReductionHooks`) is `CombatEngine._getEffectiveArmourAt` — never call `_getArmourAt` directly when piercing could apply, and never re-derive ammo traits inline.** (v1.4.261, extended v1.4.262.) Three independent copies of this arithmetic existed before v1.4.261 and had drifted from each other — Burst Fire's copy had no piercing branch at all, a real player-facing bug. Ammo-trait lookup is likewise `CombatEngine._resolveAmmoTraits` — the semi-auto Roll Damage handler alone had two separate re-implementations of its own. See `extension-point-api-updated.md`'s `armourBonusHooks`/`apReductionHooks` entries and this repo's `CHANGELOG.md` v1.4.261/v1.4.262 entries for the full account.
- **`weapon.system.loadedAmmoId` being set does NOT mean "bow/sling, single nocked round."** A firearm with `ammoType` configured also sets `loadedAmmoId` on Reload (`WeaponSheet.js`) — purely so the engine can read the loaded ammo item's traits (Bodkin, Broadhead, Stun Round); its `system.ammo` is a real multi-round magazine count, decremented by exactly 1 per shot elsewhere (`CombatEngine._runDialog`), not a single nock. The only reliable discriminator between the two ammo models is `weapon.system.traits.includes('firearm')` (the same check `WeaponSheet.js`'s own Reload logic uses) — **never** branch on `loadedAmmoId` presence alone to decide whether firing should zero out `system.ammo`. Got this wrong once already (v1.4.262 CHANGELOG: a firearm lost its whole magazine on one semi-auto shot) — confirmed live, fixed by adding the trait check. If you touch ammo-decrement logic anywhere, check for this exact footgun.
- **Two new extension points, v1.4.262: `apReductionHooks` and `attackResolvedHooks`.** See `extension-point-api-updated.md`'s dedicated sections. Built specifically so a future Destined Blast Armor Piercing boost has exactly one place to register each — the built-in ammo-trait piercing is deliberately *not* itself a registered hook (the system has never registered a hook into its own `CONFIG.MYTHRAS.*` arrays; converting core rulebook math into one would make an empty array ambiguous between "no modules loaded" and "piercing silently broken").

## Extension-point / boundary contract

Modules extend the system via `CONFIG.MYTHRAS.*` arrays (see `extension-point-api-updated.md`). Live hooks: `characteristicBonusHooks`, `apBonusHooks`, `armourBonusHooks`, `apReductionHooks`, `movementHooks`, `initiativeOffsetHooks`, `healingRateHooks`, `luckPointsHooks`, `damageModOffsetHooks`, `damageHooks`, `hitPointBonusHooks`, `weaponDamageHooks`/`weaponForceHooks`, `attackResolvedHooks`.

- Most are **read-time** (consumed in `CharacterData.prepareDerivedData`) — idempotent, derive-from-source, nothing to revert.
- **`hitPointBonusHooks` is write-time** (consumed by the HP-max writer that persists to `hit-location` item `system.hp`). It is the one exception; keep it clearly documented as such so nobody reintroduces the derived/persisted drift.
- **`weaponDamageHooks`/`weaponForceHooks` are roll-time, override/first-wins** (not summed); **`attackResolvedHooks` is a roll-time lifecycle event** (`(ctx) => void`, fires once per resolved attack roll, hit or miss) — neither fits the `prepareDerivedData` read-time/additive shape the rest of this list follows.
- Hooks receive the **canonical camelCase location key**: `head`, `chest`, `abdomen`, `rightArm`, `leftArm`, `rightLeg`, `leftLeg`. `armourBonusHooks`, `hitPointBonusHooks`, and `apReductionHooks` all use this vocabulary.
- **Frozen API** (`frozen-api-updated.md`): CombatEngine method signatures the future node editor calls directly. Do not change a frozen signature without updating the doc and the runtime.

### HP data model (recently locked — important)
`hit-location` **items** are canonical for HP: `system.hp` (max), `system.current`, `system.wound`. The whole combat engine reads max from the item. The derived `CharacterData.hitLocations` object is **not** an HP-max authority. A single writer recomputes `system.hp` (CON+SIZ table → hero-level bonus → `hitPointBonusHooks` sum) and must fire on CON/SIZ/heroAdvantages changes **and** any `flags.destined-module` change.

## Repo layout

- `mythras.mjs` — top-level orchestration/manifest ESM entry; imports the `module/` tree.
- `module/data/` — `CharacterData.js`, `ActorData.js`, `ItemData.js` (TypeDataModels; `prepareDerivedData` lives here).
- `module/combat/` — `CombatEngine.js` + `effects/` (SE resolvers; `SE_RESOLVERS` in `effects/index.js` is the node editor's SE entry point).
- `module/sheets/`, `module/config/config.js` (`MYTHRAS` object), `module/utils/` (pure, Jest-tested), `module/rolls/`.
- `tests/` — Jest, pure modules only.
- Compendium: **edit `_source/` YAML**, not `packs/`. `packs/` is git-ignored (LevelDB). Build with `npm run pack` / `npm run unpack` (`@foundryvtt/foundryvtt-cli v3`). Before installing a build that changes compendium content, delete the relevant `packs/<name>/` folder first.

## Git

`git add .` → `git commit -m "v1.4.xxx - description"` → `git push` after each stable, tested batch. **Plain hyphens in commit messages** — em dashes cause terminal hangs. Bump the version in `system.json` (and `package.json`) every build.

## Live testing

Local dev instance at `C:/Users/Mahlers7th/AppData/Local/FoundryVTT/Data/` — **separate** from the Sunday game (Molten hosting, still v13). GM Mode on, semi-auto automation. Errors from the running instance (console + exported item JSON) are ground truth over static analysis.
