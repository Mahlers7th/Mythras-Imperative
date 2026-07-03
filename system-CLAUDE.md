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
3. `npm test` (Jest). Suite is currently **259 tests** on pure utility modules (`combat-math.js`, `char-math.js`, `roll-math.js`). Keep it green; add tests for new pure logic.
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

## Extension-point / boundary contract

Modules extend the system via `CONFIG.MYTHRAS.*` arrays (see `extension-point-api-updated.md`). Live hooks: `characteristicBonusHooks`, `apBonusHooks`, `armourBonusHooks`, `movementHooks`, `initiativeOffsetHooks`, `healingRateHooks`, `luckPointsHooks`, `damageModOffsetHooks`, `damageHooks`, `hitPointBonusHooks`.

- Most are **read-time** (consumed in `CharacterData.prepareDerivedData`) — idempotent, derive-from-source, nothing to revert.
- **`hitPointBonusHooks` is write-time** (consumed by the HP-max writer that persists to `hit-location` item `system.hp`). It is the one exception; keep it clearly documented as such so nobody reintroduces the derived/persisted drift.
- Hooks receive the **canonical camelCase location key**: `head`, `chest`, `abdomen`, `rightArm`, `leftArm`, `rightLeg`, `leftLeg`. Both `armourBonusHooks` and `hitPointBonusHooks` use this vocabulary.
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
