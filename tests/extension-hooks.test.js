/**
 * tests/extension-hooks.test.js
 *
 * Jest tests for the Phase 1 module extension-point hooks added to
 * CONFIG.MYTHRAS:
 *   - characteristicBonusHooks (chars, actor) => void   [early, mutate in place]
 *   - armourBonusHooks         (actor, locationId) => number  [late, read-time]
 *
 * The hook-application code lives inline in CharacterData#prepareDerivedData
 * and CombatEngine (both Foundry-coupled). These tests reproduce the exact
 * application contracts those call sites implement, so a regression in the
 * loop/reduce expressions or the defensive guards is caught here without
 * standing up a full Foundry environment.
 */

// locationNameToKey is a pure, Foundry-free util — imported for real (not
// mirrored) so the item-label -> camelCase-key derivation itself is under
// test, not just the hook-application contract downstream of it.
import { locationNameToKey } from '../module/utils/hit-location.js';
// weaponBaseMax is likewise pure and already fully tested in
// combat-math.test.js — imported for real rather than mirrored, so the
// _getEffectiveArmourAt tests below exercise the actual piercing-reduction
// math, not a second copy of it.
import { weaponBaseMax } from '../module/utils/combat-math.js';
// sumHookContributions is likewise pure and already fully tested in
// modifier-bus.test.js — imported for real so explainHookSum's own tests
// below exercise the real summation behavior, not a second mirror of it.
import { sumHookContributions } from '../module/utils/modifier-bus.js';
// skill-math is pure and fully tested in skill-math.test.js — imported for
// real so the skillBonusHooks mirror below exercises the actual total
// arithmetic, and only the Foundry-coupled LOOP is mirrored.
import { computeSkillTotal, SKILL_ITEM_TYPES } from '../module/utils/skill-math.js';
// fs/path/fileURLToPath — for magicPointOffsetHooks' text-level
// character-only-boundary regression guard, same ESM pattern
// frozen-api.test.js already uses (this project's Jest setup has no
// require/__dirname; it's genuine ESM, not CJS-under-Jest).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Minimal call-recording spy — this project's Jest/ESM setup does not expose
 * a `jest` global (confirmed: no prior test file in either repo uses
 * `jest.fn`), so spies are hand-rolled rather than introducing a new
 * dependency on framework mocking.
 */
function makeSpy(impl = () => undefined) {
  const calls = [];
  const spy = (...args) => { calls.push(args); return impl(...args); };
  spy.calls = calls;
  return spy;
}

// ---------------------------------------------------------------------------
// Re-implementations of the two inline application patterns, kept byte-for-byte
// faithful to the call sites:
//   CharacterData.js  ~L175   (characteristicBonusHooks)
//   CombatEngine.js   _getArmourAt  (armourBonusHooks — primary chokepoint for
//                     all damage paths) and _applySunder (non-sunderable layer)
// If those call sites change, update these to match and the tests still guard
// the intended contract.
// ---------------------------------------------------------------------------

/** Mirror of the prepareDerivedData characteristic-hook loop. */
function applyCharacteristicHooks(hooks, chars, actor) {
  for (const fn of (hooks ?? [])) {
    try { fn(chars, actor); }
    catch (err) { /* swallowed in production via console.error */ }
  }
  return chars;
}

/** Mirror of the CombatEngine armour-hook reduce. */
function applyArmourHooks(hooks, actor, locationId) {
  return (hooks ?? []).reduce((sum, fn) => {
    try { return sum + (Number(fn(actor, locationId)) || 0); }
    catch (err) { return sum; }
  }, 0);
}

/**
 * Mirror of the prepareDerivedData action-points bonus reduce (Step 3).
 * Fires AFTER the fatigue penalty (Step 2) has already been applied to
 * penalizedBaseMax, so a hook-granted bonus is not itself fatigued away.
 * Returns { bonus, max } — bonus is stored separately on
 * attr.actionPoints.bonus for display; max is floored at 1 (the bonus
 * itself is never floored). Faithful to CharacterData.js.
 */
function applyApBonusHooks(hooks, penalizedBaseMax, actor) {
  const bonus = (hooks ?? []).reduce((sum, fn) => {
    try { return sum + (Number(fn(actor)) || 0); }
    catch { return sum; }
  }, 0);
  const max = Math.max(1, penalizedBaseMax + bonus);
  return { bonus, max };
}

/**
 * Mirror of the prepareDerivedData damage-modifier-offset loop.
 * Sums each hook's signed step return on top of the manual dmOffset.
 * Faithful to CharacterData.js (Damage Modifier derivation).
 */
function applyDamageModOffsetHooks(hooks, manualOffset, actor) {
  let dmOffset = manualOffset ?? 0;
  for (const fn of (hooks ?? [])) {
    try { dmOffset += fn(actor) ?? 0; }
    catch (err) { /* swallowed in production via console.error */ }
  }
  return dmOffset;
}

/**
 * Mirror of the prepareDerivedData movement loop.
 * Sums each hook's signed integer onto the stored movementRate base, floors at
 * 0, then derives walk/run/sprint. Faithful to CharacterData.js (Walk/Run/Sprint
 * derivation). moveMode defaults to 'normal'.
 */
function applyMovementHooks(hooks, movementRate, actor, moveMode = 'normal') {
  let baseMove = movementRate ?? 6;
  const moveBonus = (hooks ?? []).reduce((sum, fn) => {
    try { return sum + (Number(fn(actor)) || 0); }
    catch { return sum; }
  }, 0);
  baseMove = Math.max(0, baseMove + moveBonus);
  if (moveMode === 'immobile') return { base: baseMove, walk: 0, run: 0, sprint: 0 };
  if (moveMode === 'halved') {
    return {
      base: baseMove,
      walk: Math.floor(baseMove / 2),
      run: Math.floor((baseMove * 3) / 2),
      sprint: Math.floor((baseMove * 5) / 2),
    };
  }
  return { base: baseMove, walk: baseMove, run: baseMove * 3, sprint: baseMove * 5 };
}

/**
 * Mirror of the prepareDerivedData initiative-offset loop.
 * Signed sum added to the base Initiative Bonus. Faithful to CharacterData.js.
 */
function applyInitiativeOffsetHooks(hooks, baseInit, actor) {
  let init = baseInit;
  for (const fn of (hooks ?? [])) {
    try { init += Number(fn(actor)) || 0; }
    catch { /* swallowed via console.error in production */ }
  }
  return init;
}

/**
 * Mirror of the prepareDerivedData healing-rate loop + Hero Level ×2 ordering.
 * The hook sum is applied to the base BEFORE the ×2, so a delta stacks
 * additively then doubles. Faithful to CharacterData.js.
 */
function applyHealingRateHooks(hooks, baseRate, actor, doubled = false) {
  let rate = baseRate;
  for (const fn of (hooks ?? [])) {
    try { rate += Number(fn(actor)) || 0; }
    catch { /* swallowed */ }
  }
  if (doubled) rate = rate * 2;
  return rate;
}

/**
 * Mirror of the prepareDerivedData luck-points loop.
 * Hero Level luckyPoint adjustments are applied to the base FIRST, then the
 * hook sum. Faithful to CharacterData.js.
 */
function applyLuckPointsHooks(hooks, baseMax, actor, heroAdj = 0) {
  let max = baseMax + heroAdj;
  for (const fn of (hooks ?? [])) {
    try { max += Number(fn(actor)) || 0; }
    catch { /* swallowed */ }
  }
  return max;
}

/**
 * Mirror of the prepareDerivedData magic-points derivation + value clamp
 * (seam 1, seam-design-outcomes.md). magicPointOffsetHooks is an OFFSET
 * family — the system contributes a real POW base, unlike powerPointsHooks
 * below — same shape as applyDamageModOffsetHooks/applyInitiativeOffsetHooks
 * above, except this call site also includes the value-vs-max clamp that
 * immediately follows it in CharacterData.js, since the seam's own traced
 * CFI sequence (spend against value, then hold points out of max) depends
 * on that clamp's exact behavior, not just the sum. Uses the REAL
 * sumHookContributions (imported for real above, not re-mirrored) because
 * that is what CharacterData.js's own line calls directly — hand-rolling
 * a fourth near-identical summing loop here would test a copy, not the
 * real summation behavior. Faithful to CharacterData.js.
 */
function applyMagicPointOffsetHooks(hooks, basePow, currentValue, actor) {
  let max = basePow;
  max += sumHookContributions(hooks, [actor], { errorLabel: 'magicPointOffsetHook' }).total;
  let value = currentValue;
  if (value > max) value = max;
  return { max, value };
}

/**
 * Mirror of the prepareDerivedData power-points loop. Unlike
 * applyLuckPointsHooks, there is no base value to seed with — the system
 * contributes nothing to Power Points max, so the hook sum IS the max.
 * Faithful to CharacterData.js.
 */
function applyPowerPointsHooks(hooks, actor) {
  let max = 0;
  for (const fn of (hooks ?? [])) {
    try { max += Number(fn(actor)) || 0; }
    catch { /* swallowed */ }
  }
  return max;
}

/**
 * Mirror of the per-location hitPointBonus loop inside mythras.mjs
 * syncHitLocationHP — the sole writer of hit-location item system.hp (max).
 * Sums each hook's flat return for a given camelCase location key. Faithful
 * to mythras.mjs. hitPointBonusHooks is write-time (the one exception to the
 * read-time pattern the other hooks in this file follow) — see
 * extension-point-api-updated.md.
 */
function applyHitPointBonusHooks(hooks, baseHP, actor, locationId) {
  let hp = baseHP;
  for (const fn of (hooks ?? [])) {
    try { hp += Number(fn(actor, locationId)) || 0; }
    catch { /* swallowed */ }
  }
  return hp;
}

/**
 * Mirror of mythras.mjs syncHitLocationHP's full pipeline: CON+SIZ table ->
 * Hero Level HP bonus -> per-location hitPointBonusHooks sum. Returns the
 * { head, chest, abdomen, rightArm, leftArm, rightLeg, leftLeg } HP-max map
 * that gets persisted to each hit-location item's system.hp. hit-location
 * items are the sole HP-max authority; this is the write-time computation
 * that feeds them.
 */
function computeHitLocationHP(con, siz, heroAdvantages = [], hooks = [], actor = {}) {
  const conSiz = con + siz;
  let head, chest, abdomen, arm, leg;
  if      (conSiz <= 5)  { head=1; chest=2;  abdomen=2;  arm=1; leg=1; }
  else if (conSiz <= 10) { head=2; chest=3;  abdomen=3;  arm=2; leg=2; }
  else if (conSiz <= 15) { head=3; chest=4;  abdomen=4;  arm=3; leg=3; }
  else if (conSiz <= 20) { head=4; chest=5;  abdomen=5;  arm=3; leg=4; }
  else if (conSiz <= 25) { head=5; chest=6;  abdomen=6;  arm=4; leg=5; }
  else if (conSiz <= 30) { head=6; chest=7;  abdomen=7;  arm=5; leg=6; }
  else if (conSiz <= 35) { head=7; chest=8;  abdomen=8;  arm=6; leg=7; }
  else if (conSiz <= 40) { head=8; chest=9;  abdomen=9;  arm=7; leg=8; }
  else                   { head=9; chest=10; abdomen=10; arm=8; leg=9; }

  const hpBonus = heroAdvantages.includes('hitPoints2') ? 2 : heroAdvantages.includes('hitPoints') ? 1 : 0;
  if (hpBonus) { head += hpBonus; chest += hpBonus; abdomen += hpBonus; arm += hpBonus; leg += hpBonus; }

  const baseByKey = {
    head, chest, abdomen,
    rightArm: arm, leftArm: arm,
    rightLeg: leg, leftLeg: leg
  };

  const hpByKey = {};
  for (const [key, base] of Object.entries(baseByKey)) {
    hpByKey[key] = applyHitPointBonusHooks(hooks, base, actor, key);
  }
  return hpByKey;
}

/**
 * Mirror of syncHitLocationHP's item-processing loop — but using the REAL
 * locationNameToKey import rather than a hand-copied regex, so a regression
 * in the derivation itself (not just the downstream hook-application
 * contract) is caught here. items: array of { id, system: { label, hp } }
 * (or { name, system: { hp } } — label falls back to name, same as the real
 * call site). Returns the update list ({ _id, 'system.hp' }[]) that would be
 * passed to actor.updateEmbeddedDocuments('Item', updates) — omitting any
 * item whose computed max already matches its stored system.hp (idempotent).
 */
function computeHitLocationUpdates(con, siz, heroAdvantages, hooks, items, actor = {}) {
  const hpByKey = computeHitLocationHP(con, siz, heroAdvantages, hooks, actor);
  const updates = [];
  for (const item of items) {
    const key    = locationNameToKey(item.system.label ?? item.name ?? '');
    const newMax = hpByKey[key] ?? null;
    if (newMax === null || item.system.hp === newMax) continue;
    updates.push({ _id: item.id, 'system.hp': newMax });
  }
  return updates;
}

// =============================================================================
// characteristicBonusHooks
// =============================================================================

describe('characteristicBonusHooks', () => {
  const freshChars = () => ({
    str: { value: 10 }, con: { value: 10 }, siz: { value: 10 },
    dex: { value: 10 }, int: { value: 10 }, pow: { value: 10 }, cha: { value: 10 },
  });

  test('empty/undefined hook list leaves characteristics unchanged', () => {
    const chars = freshChars();
    applyCharacteristicHooks([], chars, {});
    expect(chars.str.value).toBe(10);
    applyCharacteristicHooks(undefined, chars, {});
    expect(chars.str.value).toBe(10);
  });

  test('a single hook mutates the characteristics object in place', () => {
    const chars = freshChars();
    applyCharacteristicHooks([(c) => { c.str.value += 10; }], chars, {});
    expect(chars.str.value).toBe(20);
    // untouched stats stay put
    expect(chars.siz.value).toBe(10);
  });

  test('multiple hooks stack additively', () => {
    const chars = freshChars();
    applyCharacteristicHooks([
      (c) => { c.str.value += 10; },   // Enhanced STR
      (c) => { c.siz.value += 5;  },   // Growth
      (c) => { c.str.value += 2;  },   // a second STR source
    ], chars, {});
    expect(chars.str.value).toBe(22);
    expect(chars.siz.value).toBe(15);
  });

  test('a throwing hook does not prevent later hooks from running', () => {
    const chars = freshChars();
    applyCharacteristicHooks([
      (c) => { c.str.value += 10; },
      () => { throw new Error('bad hook'); },
      (c) => { c.con.value += 4; },
    ], chars, {});
    expect(chars.str.value).toBe(20);
    expect(chars.con.value).toBe(14);
  });

  test('hook receives the actor as its second argument', () => {
    const chars = freshChars();
    const actor = { id: 'abc', name: 'Hero' };
    let seen = null;
    applyCharacteristicHooks([(c, a) => { seen = a; }], chars, actor);
    expect(seen).toBe(actor);
  });

  test('negative deltas (Shrink) reduce characteristics', () => {
    const chars = freshChars();
    applyCharacteristicHooks([(c) => { c.siz.value -= 4; }], chars, {});
    expect(chars.siz.value).toBe(6);
  });
});

// =============================================================================
// armourBonusHooks
// =============================================================================

describe('armourBonusHooks', () => {
  test('empty/undefined hook list returns 0', () => {
    expect(applyArmourHooks([], {}, 'chest')).toBe(0);
    expect(applyArmourHooks(undefined, {}, 'chest')).toBe(0);
  });

  test('a single hook returns its AP bonus', () => {
    expect(applyArmourHooks([() => 4], {}, 'chest')).toBe(4);
  });

  test('multiple hooks stack', () => {
    const bonus = applyArmourHooks([() => 4, () => 2], {}, 'chest'); // Inherent + Power Armour
    expect(bonus).toBe(6);
  });

  test('non-numeric / null returns coerce to 0, not NaN', () => {
    expect(applyArmourHooks([() => null, () => undefined, () => 'x', () => 3], {}, 'chest')).toBe(3);
  });

  test('a throwing hook is skipped and does not poison the sum', () => {
    const bonus = applyArmourHooks([
      () => 4,
      () => { throw new Error('bad armour hook'); },
      () => 2,
    ], {}, 'chest');
    expect(bonus).toBe(6);
  });

  test('hook receives actor and locationId', () => {
    const actor = { id: 'def' };
    let seenActor = null, seenLoc = null;
    applyArmourHooks([(a, loc) => { seenActor = a; seenLoc = loc; return 0; }], actor, 'rightArm');
    expect(seenActor).toBe(actor);
    expect(seenLoc).toBe('rightArm');
  });

  test('per-location: a hook can grant AP at one location only', () => {
    const headOnly = (a, loc) => (loc === 'head' ? 3 : 0);
    expect(applyArmourHooks([headOnly], {}, 'head')).toBe(3);
    expect(applyArmourHooks([headOnly], {}, 'chest')).toBe(0);
  });
});

// =============================================================================
// armourBonusHooks — integration contracts (the chokepoint behaviours that
// the Destined Inherent Armour proof depends on)
// =============================================================================

/** Mirror of _getArmourAt's final return: natural + worn (after sunder) + bonus. */
function getArmourAt({ naturalAP = 0, wornAP = 0, sunderAtLoc = 0, bonus = 0 }) {
  const wornReduction    = Math.min(sunderAtLoc, wornAP);
  const naturalReduction = Math.min(Math.max(0, sunderAtLoc - wornReduction), naturalAP);
  return Math.max(0, naturalAP - naturalReduction)
       + Math.max(0, wornAP - wornReduction)
       + bonus;
}

/**
 * Mirror of _applySunder's three-layer absorption. Returns { carryOver,
 * recordedReduction } — recordedReduction is what gets written to sunderedAP.
 * The bonus layer (Step 3) absorbs but is never recorded.
 */
function applySunder({ wornAP = 0, naturalAP = 0, bonus = 0, damage }) {
  let carryOver = 0, wornRed = 0, natRed = 0;
  // Step 1: worn
  if (wornAP > 0) {
    const surplus = damage - wornAP;
    if (surplus <= 0) { carryOver = 0; }
    else { wornRed = Math.min(surplus, wornAP); carryOver = surplus - wornRed; }
  } else { carryOver = damage; }
  // Step 2: natural
  if (carryOver > 0 && naturalAP > 0) {
    const surplus = carryOver - naturalAP;
    if (surplus <= 0) { natRed = 0; carryOver = 0; }
    else { natRed = Math.min(surplus, naturalAP); carryOver = surplus - natRed; }
  } else if (naturalAP === 0) { /* pass through */ }
  else { carryOver = 0; }
  // Step 3: non-sunderable bonus
  if (carryOver > 0 && bonus > 0) carryOver = Math.max(0, carryOver - bonus);
  return { carryOver, recordedReduction: wornRed + natRed };
}

describe('armourBonusHooks — _getArmourAt integration', () => {
  test('bonus adds on top of natural + worn AP', () => {
    expect(getArmourAt({ naturalAP: 2, wornAP: 3, bonus: 4 })).toBe(9);
  });

  test('bonus applies even with no natural or worn AP (Inherent Armour on bare location)', () => {
    expect(getArmourAt({ naturalAP: 0, wornAP: 0, bonus: 5 })).toBe(5);
  });

  test('bonus is not eroded by prior sunder of the sunderable layers', () => {
    // 4 worn AP fully sundered away, but the 5 bonus AP persists.
    expect(getArmourAt({ wornAP: 4, sunderAtLoc: 4, bonus: 5 })).toBe(5);
  });
});

describe('armourBonusHooks — _applySunder non-sunderable layer', () => {
  test('bonus absorbs carry-over that survives natural + worn AP', () => {
    // Sunder mechanic: each layer passes only (damage - AP - reduction). 10 dmg
    // vs 2 worn → 6 carry; vs 2 natural → 2 carry; the 5 bonus soaks it → 0 to HP.
    const { carryOver } = applySunder({ wornAP: 2, naturalAP: 2, bonus: 5, damage: 10 });
    expect(carryOver).toBe(0);
  });

  test('bonus absorbs only its value; surplus beyond it reaches HP', () => {
    // 20 dmg: worn 2 → 16 carry; natural 2 → 12 carry; bonus 3 soaks 3 → 9 to HP.
    const { carryOver } = applySunder({ wornAP: 2, naturalAP: 2, bonus: 3, damage: 20 });
    expect(carryOver).toBe(9);
  });

  test('bonus AP is NEVER recorded in sunderedAP', () => {
    // Only the 2 worn + 2 natural can be sundered (4); the 5 bonus must not count.
    const { recordedReduction } = applySunder({ wornAP: 2, naturalAP: 2, bonus: 5, damage: 10 });
    expect(recordedReduction).toBe(4);
  });

  test('bonus alone (no worn/natural) absorbs without recording any sunder', () => {
    const { carryOver, recordedReduction } = applySunder({ bonus: 6, damage: 4 });
    expect(carryOver).toBe(0);
    expect(recordedReduction).toBe(0);
  });
});

// =============================================================================
// _getEffectiveArmourAt / _resolveAmmoTraits — the armour-unification batch
// (system-batch-armour-unification-prompt.md). The SOLE chokepoint for
// effective armour (raw AP + Bodkin/Armour Piercing reduction), unifying
// three previously-independent copies of this arithmetic. weaponBaseMax is
// imported for real (already tested in combat-math.test.js) rather than
// mirrored, per this file's existing convention for pure Foundry-free utils.
// =============================================================================

/**
 * Mirror of CombatEngine._getEffectiveArmourAt. Takes a stubbed
 * getArmourAtFn(defender, locationId) => number in place of the real
 * _getArmourAt static method, per the batch prompt's own test-design note
 * ("test it directly, with a stubbed _getArmourAt"). Since the
 * ap-reduction-hooks batch: `hooks` (mirrors CONFIG.MYTHRAS.apReductionHooks)
 * and `resolveLocKeyFn` (mirrors the real function's _getItem +
 * locationNameToKey derivation) are likewise injected rather than reaching
 * for real Foundry globals.
 */
function getEffectiveArmourAt(getArmourAtFn, defender, locationId, {
  bypassArmour = false, ammoTraits = [], weapon = null, attacker = null,
  hooks = [], resolveLocKeyFn = () => null,
} = {}) {
  if (bypassArmour) return 0;
  const base = getArmourAtFn(defender, locationId);
  if (base <= 0) return 0;
  const traits = Array.isArray(ammoTraits) ? ammoTraits : [];
  const hasPiercing = traits.includes('bodkin') || traits.includes('armourpiercing');
  const afterPiercing = hasPiercing
    ? Math.max(0, base - Math.ceil(weaponBaseMax(weapon?.system?.damage ?? '') / 2))
    : base;

  let hookReduction = 0;
  if (hooks.length > 0) {
    const locKey = resolveLocKeyFn(defender, locationId);
    hookReduction = hooks.reduce((sum, fn) => {
      try { return sum + Math.max(0, Number(fn(attacker, defender, locKey, weapon)) || 0); }
      catch (err) { return sum; }
    }, 0);
  }

  return Math.max(0, afterPiercing - hookReduction);
}

/** Mirror of CombatEngine._resolveAmmoTraits, with world items injected as `world.items`. */
function resolveAmmoTraits(attacker, weapon, world = {}) {
  const loadedId = weapon?.system?.loadedAmmoId;
  if (!loadedId) return [];
  const worldItems = world.items ?? new Map();
  const ammoItem = attacker?.items?.get(loadedId) ?? worldItems.get(loadedId) ?? null;
  if (!ammoItem || ammoItem.type !== 'ammo') return [];
  return Array.from(ammoItem.system.traits ?? []).map(t => t.key?.toLowerCase?.() ?? t.name?.toLowerCase?.() ?? '');
}

describe('CombatEngine._getEffectiveArmourAt', () => {
  const highBase = () => 10;
  const zeroBase = () => 0;

  test('bypassArmour wins over everything, even high base AP and piercing traits', () => {
    const result = getEffectiveArmourAt(highBase, {}, 'loc1', {
      bypassArmour: true,
      ammoTraits: ['bodkin'],
      weapon: { system: { damage: '2d6' } },
    });
    expect(result).toBe(0);
  });

  test('base AP 0 returns 0, no piercing arithmetic attempted', () => {
    const result = getEffectiveArmourAt(zeroBase, {}, 'loc1', { ammoTraits: ['bodkin'] });
    expect(result).toBe(0);
  });

  test('no piercing traits returns base AP unchanged', () => {
    expect(getEffectiveArmourAt(highBase, {}, 'loc1', { ammoTraits: [] })).toBe(10);
    expect(getEffectiveArmourAt(highBase, {}, 'loc1', {})).toBe(10);
  });

  test('bodkin present reduces by ceil(weaponBaseMax / 2)', () => {
    // 1d10 -> weaponBaseMax 10 -> ceil(10/2) = 5 -> 10 - 5 = 5
    const result = getEffectiveArmourAt(highBase, {}, 'loc1', {
      ammoTraits: ['bodkin'],
      weapon: { system: { damage: '1d10' } },
    });
    expect(result).toBe(5);
  });

  test('armourpiercing present gives an identical result to bodkin', () => {
    const withBodkin = getEffectiveArmourAt(highBase, {}, 'loc1', {
      ammoTraits: ['bodkin'], weapon: { system: { damage: '1d10' } },
    });
    const withAP = getEffectiveArmourAt(highBase, {}, 'loc1', {
      ammoTraits: ['armourpiercing'], weapon: { system: { damage: '1d10' } },
    });
    expect(withAP).toBe(withBodkin);
  });

  test('both bodkin and armourpiercing present: reduction applied once, not twice', () => {
    const result = getEffectiveArmourAt(highBase, {}, 'loc1', {
      ammoTraits: ['bodkin', 'armourpiercing'],
      weapon: { system: { damage: '1d10' } },
    });
    expect(result).toBe(5); // same as either alone, not 10 - 5 - 5
  });

  test('reduction exceeding base AP clamps to 0, never negative', () => {
    // 2d12 -> weaponBaseMax 24 -> ceil(24/2) = 12, base is only 10
    const result = getEffectiveArmourAt(highBase, {}, 'loc1', {
      ammoTraits: ['bodkin'],
      weapon: { system: { damage: '2d12' } },
    });
    expect(result).toBe(0);
  });

  test('missing weapon does not throw, degrades to no reduction attempted safely', () => {
    expect(() => getEffectiveArmourAt(highBase, {}, 'loc1', { ammoTraits: ['bodkin'] })).not.toThrow();
  });

  test('missing weapon.system.damage does not throw', () => {
    const result = getEffectiveArmourAt(highBase, {}, 'loc1', {
      ammoTraits: ['bodkin'], weapon: {},
    });
    expect(() => result).not.toThrow();
    expect(result).toBeGreaterThanOrEqual(0);
  });

  test('ammoTraits undefined or non-array does not throw, treated as no piercing', () => {
    expect(getEffectiveArmourAt(highBase, {}, 'loc1', { ammoTraits: undefined })).toBe(10);
    expect(getEffectiveArmourAt(highBase, {}, 'loc1', { ammoTraits: 'bodkin' })).toBe(10);
  });
});

// =============================================================================
// game.system.api.getArmourAt (system-batch-expose-armour-prompt.md, v1.4.267)
//   A thin wrapper over CombatEngine._getArmourAt, exposed on
//   game.system.api so modules can read BASE armour (natural + worn +
//   armourBonusHooks, minus sunder — NOT effective armour) without reaching
//   into CombatEngine internals. mythras.mjs is Foundry-coupled like
//   CombatEngine.js, so this mirrors the wrapper's own contract with the
//   real _getArmourAt injected, per this file's established convention.
// =============================================================================

/** Mirror of mythras.mjs's exported getArmourAt wrapper. Named getArmourAtApi
 * to avoid colliding with the unrelated _getArmourAt-return mirror above. */
function getArmourAtApi(getArmourAtFn, defender, locationId) {
  try {
    const result = getArmourAtFn(defender, locationId);
    return Number.isFinite(result) ? Math.max(0, result) : 0;
  } catch (err) {
    return 0;
  }
}

describe('game.system.api.getArmourAt', () => {
  test('delegates to _getArmourAt and returns its value', () => {
    const spy = makeSpy(() => 7);
    expect(getArmourAtApi(spy, { id: 'd1' }, 'chest')).toBe(7);
    expect(spy.calls).toEqual([[{ id: 'd1' }, 'chest']]);
  });

  test('does not duplicate _getArmourAt logic — same defender/locationId in, same number out', () => {
    const fn = (defender, locationId) => (defender.id === 'd1' && locationId === 'head' ? 5 : 0);
    expect(getArmourAtApi(fn, { id: 'd1' }, 'head')).toBe(5);
    expect(getArmourAtApi(fn, { id: 'd1' }, 'chest')).toBe(0);
  });

  test('a missing actor causing the underlying call to throw is caught, returns 0, never throws', () => {
    const throwing = () => { throw new TypeError("Cannot read properties of null (reading 'items')"); };
    expect(() => getArmourAtApi(throwing, null, 'head')).not.toThrow();
    expect(getArmourAtApi(throwing, null, 'head')).toBe(0);
  });

  test('a missing/unknown locationId that _getArmourAt resolves to 0 returns 0, not a throw', () => {
    const fn = () => 0;
    expect(getArmourAtApi(fn, {}, 'not-a-real-location')).toBe(0);
    expect(getArmourAtApi(fn, {}, undefined)).toBe(0);
  });

  test('never negative: a negative result is clamped to 0', () => {
    expect(getArmourAtApi(() => -3, {}, 'loc')).toBe(0);
  });

  test('non-finite results (NaN, undefined, Infinity) are treated as 0', () => {
    expect(getArmourAtApi(() => NaN, {}, 'loc')).toBe(0);
    expect(getArmourAtApi(() => undefined, {}, 'loc')).toBe(0);
    expect(getArmourAtApi(() => Infinity, {}, 'loc')).toBe(0);
  });

  test('returns a finite non-negative number for a normal in-range result', () => {
    expect(getArmourAtApi(() => 12, {}, 'chest')).toBe(12);
  });
});

// =============================================================================
// ctx.baseArmourPoints stamp (system-batch-expose-armour-prompt.md, v1.4.267)
//   Stamped at each in-engine damage-resolution site so a damageHooks
//   consumer can read the defender's BASE armour (pre-piercing, pre-hook-
//   reduction) as of attack time, distinct from ctx's existing armourPoints
//   local (effective armour). The critical invariant is ORDERING: the stamp
//   must happen before _applySunder's flag write, or a sundered attack would
//   report post-sunder armour and defeat the field's purpose. CombatEngine.js
//   is Foundry-coupled and mirrored throughout this file, so this exercises
//   the ordering contract and the burst-fire per-round location, not a real
//   CombatEngine import.
// =============================================================================

describe('ctx.baseArmourPoints stamp — ordering relative to _applySunder', () => {
  // A stateful stand-in for the real _getArmourAt: it reads mutable armour
  // state, and a real _applySunder call would mutate that state (the
  // sunderedAP flag write) as a side effect. Calling the "getArmourAt" side
  // BEFORE the "applySunder" side must see the pre-mutation value.
  function makeStatefulArmourSource(initialAP) {
    let currentAP = initialAP;
    return {
      getArmourAt: () => currentAP,
      applySunder(damage) { currentAP = Math.max(0, currentAP - damage); },
    };
  }

  test('full auto: stamping before the sunder branch captures pre-sunder armour', () => {
    const src = makeStatefulArmourSource(5);
    const ctx = {};
    // Mirrors the real call order in _resolveFullAutoDamage: the stamp
    // happens immediately after _getEffectiveArmourAt, BEFORE the
    // `if (sunderChosen ...)` branch that can call _applySunder.
    ctx.baseArmourPoints = src.getArmourAt();
    src.applySunder(10); // Sunder chosen this attack — mutates armour state
    expect(ctx.baseArmourPoints).toBe(5);
  });

  test('full auto: reversing the order (stamp after sunder) would leak the post-sunder value — proves the test can fail', () => {
    const src = makeStatefulArmourSource(5);
    src.applySunder(10); // sunder runs first — wrong order
    const ctx = {};
    ctx.baseArmourPoints = src.getArmourAt();
    expect(ctx.baseArmourPoints).toBe(0); // demonstrates why placement is load-bearing
  });

  test('full auto: stamped on the normal (non-sunder) path too, not only when Sunder is chosen', () => {
    const src = makeStatefulArmourSource(3);
    const ctx = {};
    ctx.baseArmourPoints = src.getArmourAt();
    expect(ctx.baseArmourPoints).toBe(3);
  });
});

describe('ctx.baseArmourPoints stamp — burst fire per-round location', () => {
  test('each round stamps baseArmourPoints from that round\'s own hit location, not a shared/outer one', () => {
    const armourByLocation = { head: 6, chest: 2, leftArm: 0 };
    const getArmourAtFn = (defender, locationId) => armourByLocation[locationId] ?? 0;

    // Mirrors the per-round loop in _resolveBurstDamage: each round rolls
    // its own hitLocationId and the stamp must use THAT round's value.
    const rounds = [{ hitLocationId: 'head' }, { hitLocationId: 'chest' }, { hitLocationId: 'leftArm' }];
    const roundCtxs = rounds.map(r => ({
      ...r,
      baseArmourPoints: getArmourAtFn({}, r.hitLocationId),
    }));

    expect(roundCtxs.map(c => c.baseArmourPoints)).toEqual([6, 2, 0]);
  });

  test('a round striking an unarmoured location stamps 0, not undefined', () => {
    const getArmourAtFn = () => 0;
    const roundCtx = { hitLocationId: 'leftLeg', baseArmourPoints: getArmourAtFn({}, 'leftLeg') };
    expect(roundCtx.baseArmourPoints).toBe(0);
  });
});

describe('CombatEngine._resolveAmmoTraits', () => {
  function makeAmmoItem(type, traits) {
    return { type, system: { traits: traits.map(key => ({ key })) } };
  }

  test('no loaded ammo returns []', () => {
    const weapon = { system: {} };
    expect(resolveAmmoTraits({ items: new Map() }, weapon)).toEqual([]);
  });

  test('a non-ammo item in loadedAmmoId returns [] (the type guard)', () => {
    const weapon = { system: { loadedAmmoId: 'item1' } };
    const attacker = { items: new Map([['item1', makeAmmoItem('weapon', ['bodkin'])]]) };
    expect(resolveAmmoTraits(attacker, weapon)).toEqual([]);
  });

  test('a valid ammo item returns lowercased trait keys', () => {
    const weapon = { system: { loadedAmmoId: 'item1' } };
    const attacker = { items: new Map([['item1', makeAmmoItem('ammo', ['Bodkin', 'Broadhead'])]]) };
    expect(resolveAmmoTraits(attacker, weapon)).toEqual(['bodkin', 'broadhead']);
  });

  test('ammo resolved from world items when not on the attacker', () => {
    const weapon = { system: { loadedAmmoId: 'item1' } };
    const attacker = { items: new Map() };
    const world = { items: new Map([['item1', makeAmmoItem('ammo', ['stunRound'])]]) };
    expect(resolveAmmoTraits(attacker, weapon, world)).toEqual(['stunround']);
  });
});

// =============================================================================
// apReductionHooks — system-batch-ap-reduction-hooks-prompt.md. Additive-
// stacking, mirroring armourBonusHooks, consumed inside _getEffectiveArmourAt
// AFTER the built-in Bodkin/Armour Piercing reduction and BEFORE the final
// clamp. Deliberately no immunity return value (design decision 2) — hooks
// return numbers only, and a negative/NaN/non-numeric contributes 0.
// =============================================================================

describe('CombatEngine._getEffectiveArmourAt — apReductionHooks (additive-stacking)', () => {
  const highBase = () => 10;
  const zeroBase = () => 0;
  const locKeyStub = () => 'chest';

  test('no hooks registered → identical to pre-batch behaviour (regression guard)', () => {
    const result = getEffectiveArmourAt(highBase, {}, 'loc1', {
      ammoTraits: ['bodkin'], weapon: { system: { damage: '1d10' } }, hooks: [],
    });
    expect(result).toBe(5); // same as the plain Bodkin test above
  });

  test('one hook returning 2 reduces effective AP by 2', () => {
    const result = getEffectiveArmourAt(highBase, {}, 'loc1', {
      hooks: [() => 2], resolveLocKeyFn: locKeyStub,
    });
    expect(result).toBe(8);
  });

  test('two hooks returning 2 and 3 stack additively → reduced by 5', () => {
    const result = getEffectiveArmourAt(highBase, {}, 'loc1', {
      hooks: [() => 2, () => 3], resolveLocKeyFn: locKeyStub,
    });
    expect(result).toBe(5);
  });

  test('a hook and Bodkin both present: built-in piercing applies first, then the hook', () => {
    // base 10, Bodkin (1d10 -> ceil(10/2)=5) -> 5, then hook -2 -> 3
    const result = getEffectiveArmourAt(highBase, {}, 'loc1', {
      ammoTraits: ['bodkin'], weapon: { system: { damage: '1d10' } },
      hooks: [() => 2], resolveLocKeyFn: locKeyStub,
    });
    expect(result).toBe(3);
  });

  test('reduction exceeding base AP clamps to 0, never negative', () => {
    const result = getEffectiveArmourAt(highBase, {}, 'loc1', {
      hooks: [() => 50], resolveLocKeyFn: locKeyStub,
    });
    expect(result).toBe(0);
  });

  test('a hook returning a negative contributes 0, cannot add armour', () => {
    const result = getEffectiveArmourAt(highBase, {}, 'loc1', {
      hooks: [() => -5], resolveLocKeyFn: locKeyStub,
    });
    expect(result).toBe(10); // unchanged, not 15
  });

  test.each([
    ['NaN', NaN], ['null', null], ['undefined', undefined], ['a string', 'oops'], ['an object', {}],
  ])('a hook returning %s contributes 0 and does not throw', (_label, badValue) => {
    const result = getEffectiveArmourAt(highBase, {}, 'loc1', {
      hooks: [() => badValue], resolveLocKeyFn: locKeyStub,
    });
    expect(result).toBe(10);
  });

  test('a throwing hook is caught, contributes 0, other hooks still sum correctly', () => {
    const throwing = () => { throw new Error('boom'); };
    const result = getEffectiveArmourAt(highBase, {}, 'loc1', {
      hooks: [() => 2, throwing, () => 3], resolveLocKeyFn: locKeyStub,
    });
    expect(result).toBe(5); // 2 + 3, throwing contributes 0
  });

  test('bypassArmour: true — hooks are not consulted at all, result 0', () => {
    const hookSpy = makeSpy(() => 2);
    const result = getEffectiveArmourAt(highBase, {}, 'loc1', {
      bypassArmour: true, hooks: [hookSpy], resolveLocKeyFn: locKeyStub,
    });
    expect(result).toBe(0);
    expect(hookSpy.calls.length).toBe(0);
  });

  test('base AP 0 — hooks are not consulted at all, result 0', () => {
    const hookSpy = makeSpy(() => 2);
    const result = getEffectiveArmourAt(zeroBase, {}, 'loc1', {
      hooks: [hookSpy], resolveLocKeyFn: locKeyStub,
    });
    expect(result).toBe(0);
    expect(hookSpy.calls.length).toBe(0);
  });

  test('locKey resolution is skipped entirely when no hooks are registered (no wasted work)', () => {
    const locKeySpy = makeSpy(() => 'chest');
    getEffectiveArmourAt(highBase, {}, 'loc1', { hooks: [], resolveLocKeyFn: locKeySpy });
    expect(locKeySpy.calls.length).toBe(0);
  });

  test('attacker is passed through to each hook, alongside defender/locKey/weapon', () => {
    const attacker = { id: 'atk1' };
    const defender = { id: 'def1' };
    const weapon = { system: { damage: '1d6' } };
    const hookSpy = makeSpy(() => 1);
    getEffectiveArmourAt(highBase, defender, 'loc1', {
      attacker, weapon, hooks: [hookSpy], resolveLocKeyFn: locKeyStub,
    });
    expect(hookSpy.calls).toEqual([[attacker, defender, 'chest', weapon]]);
  });
});

// =============================================================================
// attackResolvedHooks — system-batch-ap-reduction-hooks-prompt.md. Fires once
// per resolved combat attack roll (hit or miss), for modules that hold
// per-shot state to consume/clear (e.g. Destined's Blast Armor Piercing).
// The full "fires once per attack activation, including on Full Auto/Burst"
// control-flow claim is a property of _afterDefenceResolved's call graph
// (verified by reading source — see CHANGELOG), not something this pure
// loop-consumption mirror can prove; mocking the full attack-resolution
// control flow for that would be disproportionate to what a unit test can
// usefully assert, so that property is live-verified per the batch's own
// acceptance criteria instead.
// =============================================================================

/** Mirror of the attackResolvedHooks consumption loop in _afterDefenceResolved. */
function fireAttackResolvedHooks(hooks, ctx) {
  for (const hook of hooks) {
    try { hook(ctx); }
    catch (err) { /* swallowed in production via console.error */ }
  }
}

describe('attackResolvedHooks', () => {
  test('fires on a hit', () => {
    const hookSpy = makeSpy();
    fireAttackResolvedHooks([hookSpy], { attackOutcome: 'success' });
    expect(hookSpy.calls).toEqual([[{ attackOutcome: 'success' }]]);
  });

  test('fires on a miss — the load-bearing case', () => {
    const hookSpy = makeSpy();
    fireAttackResolvedHooks([hookSpy], { attackOutcome: 'failure' });
    expect(hookSpy.calls).toEqual([[{ attackOutcome: 'failure' }]]);
  });

  test('fires on a fumble and a critical too — outcome-agnostic', () => {
    const hookSpy = makeSpy();
    fireAttackResolvedHooks([hookSpy], { attackOutcome: 'fumble' });
    fireAttackResolvedHooks([hookSpy], { attackOutcome: 'critical' });
    expect(hookSpy.calls.length).toBe(2);
  });

  test('a throwing hook is caught and does not abort resolution; later hooks still run', () => {
    const throwing = () => { throw new Error('boom'); };
    const laterSpy = makeSpy();
    expect(() => fireAttackResolvedHooks([throwing, laterSpy], { attackOutcome: 'success' })).not.toThrow();
    expect(laterSpy.calls.length).toBe(1);
  });

  test('empty/undefined hook list is a no-op', () => {
    expect(() => fireAttackResolvedHooks([], { attackOutcome: 'success' })).not.toThrow();
  });

  test('each hook in the array fires exactly once per call (the mirror\'s own idempotency)', () => {
    const a = makeSpy();
    const b = makeSpy();
    fireAttackResolvedHooks([a, b], { attackOutcome: 'success' });
    expect(a.calls.length).toBe(1);
    expect(b.calls.length).toBe(1);
  });

  // ---------------------------------------------------------------------
  // Vehicle-defender path — system-batch-vehicle-attack-resolved-prompt.md.
  // _resolveVehicleAttack now fires this same loop (v1.4.264). These tests
  // pin the *ctx contract* on that path (attacker/weapon present, no
  // hitLocationId, defender may be a vehicle actor) using the same pure
  // loop mirror above — they cannot and do not prove "fires exactly once
  // per vehicle attack" or the Full Auto per-target control-flow property;
  // that's a call-graph claim about CombatEngine, live-verified per the
  // batch's acceptance criteria instead.
  //
  // The weapon-filtered consumer shape below mirrors Destined's real
  // attackResolvedHooks consumer (clearArmorPiercingOnAttackResolved):
  // it declines unless ctx.weapon.getFlag('destined-module', 'blast') is set.
  // ---------------------------------------------------------------------

  function makeBlastWeapon(isBlast) {
    return { getFlag: (ns, key) => (ns === 'destined-module' && key === 'blast' && isBlast) ? true : undefined };
  }

  function makeWeaponFilteredConsumer(onRun) {
    return (ctx) => {
      const blastFlag = ctx?.weapon?.getFlag?.('destined-module', 'blast');
      if (!blastFlag) return;
      onRun(ctx);
    };
  }

  test('vehicle ctx carrying attacker + weapon — a weapon-filtered consumer runs', () => {
    const ran = makeSpy();
    const consumer = makeWeaponFilteredConsumer(ran);
    const vehicleDefender = { type: 'vehicle' };
    const ctx = {
      attacker: { id: 'atk1' },
      defender: vehicleDefender,
      weapon: makeBlastWeapon(true),
      attackOutcome: 'success'
    };
    fireAttackResolvedHooks([consumer], ctx);
    expect(ran.calls.length).toBe(1);
  });

  test('vehicle ctx on a miss — still fires (a charge spent at a vehicle clears)', () => {
    const ran = makeSpy();
    const consumer = makeWeaponFilteredConsumer(ran);
    const ctx = {
      attacker: { id: 'atk1' },
      defender: { type: 'vehicle' },
      weapon: makeBlastWeapon(true),
      attackOutcome: 'failure'
    };
    fireAttackResolvedHooks([consumer], ctx);
    expect(ran.calls.length).toBe(1);
  });

  test('vehicle ctx has no hitLocationId — a consumer reading it must not throw', () => {
    const consumer = (ctx) => {
      // Mirrors a consumer that reads hitLocationId defensively rather than
      // assuming it exists — the vehicle path never sets it.
      const loc = ctx.hitLocationId ?? null;
      expect(loc).toBeNull();
    };
    const ctx = {
      attacker: { id: 'atk1' },
      defender: { type: 'vehicle' },
      weapon: makeBlastWeapon(true),
      attackOutcome: 'success'
      // hitLocationId intentionally absent
    };
    expect(() => fireAttackResolvedHooks([consumer], ctx)).not.toThrow();
  });

  test('a non-Blast weapon against a vehicle — weapon-filtered consumer declines', () => {
    const ran = makeSpy();
    const consumer = makeWeaponFilteredConsumer(ran);
    const ctx = {
      attacker: { id: 'atk1' },
      defender: { type: 'vehicle' },
      weapon: makeBlastWeapon(false), // melee swing, no blast flag
      attackOutcome: 'success'
    };
    fireAttackResolvedHooks([consumer], ctx);
    expect(ran.calls.length).toBe(0);
  });

  test('a throwing consumer on the vehicle path is caught and cannot abort vehicle damage resolution; later hooks still run', () => {
    const throwing = () => { throw new Error('boom'); };
    const laterSpy = makeSpy();
    const ctx = {
      attacker: { id: 'atk1' },
      defender: { type: 'vehicle' },
      weapon: makeBlastWeapon(true),
      attackOutcome: 'success'
    };
    expect(() => fireAttackResolvedHooks([throwing, laterSpy], ctx)).not.toThrow();
    expect(laterSpy.calls.length).toBe(1);
  });
});

// =============================================================================
// _runFullAutoSingleTarget vehicle dispatch — system-batch-fullauto-vehicle-
// prompt.md (v1.4.265). Before this batch, _runFullAutoSingleTarget had no
// defender?.type === 'vehicle' check at all, so a vehicle targeted by Full
// Auto silently fell through to generic-actor resolution (CombatSocket
// challenge, humanoid hit-location fallback, then a discarded damage write —
// see the batch prompt's own "traced end to end" section). v1.4.265 adds a
// vehicle branch at the top of the function, mirroring _runDialog's ~L758
// branch, before any of the other four exit paths (surprised/zero-AP/GM
// mode/socket) are reached.
//
// _runFullAutoSingleTarget itself is Foundry-coupled (Roll, CombatSocket,
// Dialog) and not import-safe under Jest, same as the rest of this file's
// convention — these are pure mirrors of its *branch-selection* order, not
// its branch bodies. They cannot and do not prove real control flow (socket
// timing, actual roll resolution); that's covered by the batch's live
// acceptance criteria instead.
// =============================================================================

/**
 * Mirror of _runFullAutoSingleTarget's branch-dispatch order (v1.4.265):
 * vehicle check first, then the four pre-existing exit paths in source order.
 * Each branch is recorded via a callback rather than executed for real.
 */
function dispatchFullAutoSingleTarget(ctx, gmMode, branches) {
  if (ctx.defender?.type === 'vehicle') { branches.vehicle(ctx); return; }
  if (ctx.defenderSurprised) { branches.surprised(ctx); return; }
  const defAP = ctx.defender?.system?.attributes?.actionPoints;
  if (defAP && typeof defAP.value === 'number' && defAP.value <= 0) { branches.zeroAP(ctx); return; }
  if (gmMode) { branches.gmMode(ctx); return; }
  branches.socket(ctx);
}

/** Byte-for-byte mirror of _accumulateFullAutoResult. */
function accumulateFullAutoResult(ctx) {
  const results = ctx._fullAutoResults;
  if (!Array.isArray(results)) return;
  results.push({
    defenderName:    ctx.defender?.name ?? '?',
    attackRoll:      ctx.attackResult ?? null,
    defenceRoll:     ctx.defenceResult ?? null,
    attackOutcome:   ctx.attackOutcome ?? 'failure',
    defenceType:     ctx.defenceType ?? 'none',
    defenceOutcome:  ctx.defenceOutcome ?? 'none',
    defenceWeapon:   ctx.defenceWeapon?.name ?? null,
    roundsAllocated: ctx.roundsPerTarget ?? 3,
    roundsHit:       ctx.roundsHit ?? 0,
    roundsRollVal:   ctx.roundsRoll?.total ?? null,
    burstResults:    ctx.burstResults ?? [],
    chosenSEs:       ctx.chosenSpecialEffects ?? [],
    seWinner:        ctx.seWinner ?? 'none',
  });
}

// =============================================================================
// roundBoundaryHooks / turnStartedHooks — mythras.mjs's _onUpdateCombat
//   Duration-boundary lifecycle families, exposed from an existing dispatcher
//   (cfi-mechanics-survey.md row 17 / duration-boundary-seam-batch.md).
//   mythras.mjs is the top-level entry file — Hooks.on registrations and
//   other module-scope side effects at import time make it unsafe to import
//   directly under Jest, same reasoning as CombatEngine.js. Mirrored here,
//   kept byte-for-byte faithful to the two firing-site loops.
//
//   Unlike attackResolvedHooks (fire-and-forget, `hook(ctx)`), both loops
//   here `await` each hook — a deliberate contract split, see config.js's
//   own doc block for why. The mirrors below are async for the same reason
//   the real firing sites are.
// =============================================================================

/** Mirror of the roundBoundaryHooks loop inside _onUpdateCombat's allSpent block. */
async function fireRoundBoundaryHooks(hooks, active, combat) {
  for (const combatant of active) {
    const actor = combatant.token?.actor ?? combatant.actor;
    if (!actor) continue;
    for (const hook of (hooks ?? [])) {
      try { await hook(actor, combat); }
      catch (err) { /* swallowed in production via console.error */ }
    }
  }
}

/** Mirror of the turnStartedHooks loop at the end of _onUpdateCombat. */
async function fireTurnStartedHooks(hooks, actor, combat) {
  for (const hook of (hooks ?? [])) {
    try { await hook(actor, combat); }
    catch (err) { /* swallowed in production via console.error */ }
  }
}

function makeCombatant(actor) {
  return { actor, token: null };
}

describe('roundBoundaryHooks', () => {
  test('zero hooks registered: no-op, does not throw', async () => {
    const active = [makeCombatant(makeActor())];
    await expect(fireRoundBoundaryHooks([], active, {})).resolves.toBeUndefined();
    await expect(fireRoundBoundaryHooks(undefined, active, {})).resolves.toBeUndefined();
  });

  test('one hook, one active combatant: called once with (actor, combat)', async () => {
    const actor = makeActor();
    const combat = { round: 3 };
    const spy = makeSpy();
    await fireRoundBoundaryHooks([spy], [makeCombatant(actor)], combat);
    expect(spy.calls).toEqual([[actor, combat]]);
  });

  test('fires once per active combatant, not once total', async () => {
    const a = makeActor(); const b = makeActor(); const c = makeActor();
    const spy = makeSpy();
    await fireRoundBoundaryHooks([spy], [makeCombatant(a), makeCombatant(b), makeCombatant(c)], {});
    expect(spy.calls.length).toBe(3);
    expect(spy.calls.map(args => args[0])).toEqual([a, b, c]);
  });

  test('multiple hooks each fire for each combatant (2 hooks x 2 combatants = 4 calls)', async () => {
    const h1 = makeSpy(); const h2 = makeSpy();
    await fireRoundBoundaryHooks([h1, h2], [makeCombatant(makeActor()), makeCombatant(makeActor())], {});
    expect(h1.calls.length).toBe(2);
    expect(h2.calls.length).toBe(2);
  });

  test('a combatant resolving to no actor is skipped, not passed as null/undefined', async () => {
    const spy = makeSpy();
    await fireRoundBoundaryHooks([spy], [makeCombatant(null), makeCombatant(makeActor())], {});
    expect(spy.calls.length).toBe(1);
  });

  test('a throwing hook is isolated — later hooks and later combatants still run', async () => {
    const throwing = () => { throw new Error('boom'); };
    const spy = makeSpy();
    await fireRoundBoundaryHooks([throwing, spy], [makeCombatant(makeActor()), makeCombatant(makeActor())], {});
    expect(spy.calls.length).toBe(2);
  });

  test('an async hook is awaited before the function returns — ordering, not just eventual completion', async () => {
    const order = [];
    const asyncHook = async () => {
      await new Promise(r => setTimeout(r, 5));
      order.push('hook-done');
    };
    await fireRoundBoundaryHooks([asyncHook], [makeCombatant(makeActor())], {});
    order.push('after-return');
    expect(order).toEqual(['hook-done', 'after-return']);
  });

  test('a rejected async hook is caught the same as a synchronous throw', async () => {
    const rejecting = async () => { throw new Error('async boom'); };
    const spy = makeSpy();
    await expect(fireRoundBoundaryHooks([rejecting, spy], [makeCombatant(makeActor())], {})).resolves.toBeUndefined();
    expect(spy.calls.length).toBe(1);
  });
});

describe('turnStartedHooks', () => {
  test('zero hooks registered: no-op, does not throw', async () => {
    await expect(fireTurnStartedHooks([], makeActor(), {})).resolves.toBeUndefined();
  });

  test('one hook: called once with (actor, combat)', async () => {
    const actor = makeActor();
    const combat = { round: 1 };
    const spy = makeSpy();
    await fireTurnStartedHooks([spy], actor, combat);
    expect(spy.calls).toEqual([[actor, combat]]);
  });

  test('fires exactly once, for the single combatant only — not once per anything else', async () => {
    const spy = makeSpy();
    await fireTurnStartedHooks([spy], makeActor(), {});
    expect(spy.calls.length).toBe(1);
  });

  test('multiple hooks each fire exactly once', async () => {
    const h1 = makeSpy(); const h2 = makeSpy();
    await fireTurnStartedHooks([h1, h2], makeActor(), {});
    expect(h1.calls.length).toBe(1);
    expect(h2.calls.length).toBe(1);
  });

  test('a throwing hook is isolated — later hooks still run', async () => {
    const throwing = () => { throw new Error('boom'); };
    const spy = makeSpy();
    await fireTurnStartedHooks([throwing, spy], makeActor(), {});
    expect(spy.calls.length).toBe(1);
  });

  test('an async hook is awaited before the function returns', async () => {
    const order = [];
    const asyncHook = async () => {
      await new Promise(r => setTimeout(r, 5));
      order.push('hook-done');
    };
    await fireTurnStartedHooks([asyncHook], makeActor(), {});
    order.push('after-return');
    expect(order).toEqual(['hook-done', 'after-return']);
  });
});

describe('_runFullAutoSingleTarget vehicle dispatch (v1.4.265)', () => {
  function makeBranchSpies() {
    return {
      vehicle:   makeSpy(),
      surprised: makeSpy(),
      zeroAP:    makeSpy(),
      gmMode:    makeSpy(),
      socket:    makeSpy(),
    };
  }

  test('defender.type === "vehicle" selects the vehicle branch, not generic defender logic', () => {
    const branches = makeBranchSpies();
    const ctx = { defender: { type: 'vehicle' } };
    dispatchFullAutoSingleTarget(ctx, false, branches);
    expect(branches.vehicle.calls.length).toBe(1);
    expect(branches.surprised.calls.length).toBe(0);
    expect(branches.zeroAP.calls.length).toBe(0);
    expect(branches.gmMode.calls.length).toBe(0);
    expect(branches.socket.calls.length).toBe(0);
  });

  test('the vehicle branch is checked before the surprised shortcut — vehicle wins even if defenderSurprised is set', () => {
    const branches = makeBranchSpies();
    const ctx = { defender: { type: 'vehicle' }, defenderSurprised: true };
    dispatchFullAutoSingleTarget(ctx, false, branches);
    expect(branches.vehicle.calls.length).toBe(1);
    expect(branches.surprised.calls.length).toBe(0);
  });

  test('regression — non-vehicle defender: surprised shortcut unchanged', () => {
    const branches = makeBranchSpies();
    const ctx = { defender: { type: 'character' }, defenderSurprised: true };
    dispatchFullAutoSingleTarget(ctx, false, branches);
    expect(branches.surprised.calls.length).toBe(1);
    expect(branches.vehicle.calls.length).toBe(0);
    expect(branches.zeroAP.calls.length).toBe(0);
    expect(branches.gmMode.calls.length).toBe(0);
    expect(branches.socket.calls.length).toBe(0);
  });

  test('regression — non-vehicle defender: zero-AP shortcut unchanged', () => {
    const branches = makeBranchSpies();
    const ctx = {
      defender: { type: 'character', system: { attributes: { actionPoints: { value: 0 } } } }
    };
    dispatchFullAutoSingleTarget(ctx, false, branches);
    expect(branches.zeroAP.calls.length).toBe(1);
    expect(branches.surprised.calls.length).toBe(0);
    expect(branches.gmMode.calls.length).toBe(0);
    expect(branches.socket.calls.length).toBe(0);
  });

  test('regression — non-vehicle defender: GM mode branch unchanged', () => {
    const branches = makeBranchSpies();
    const ctx = { defender: { type: 'character', system: { attributes: {} } } };
    dispatchFullAutoSingleTarget(ctx, true, branches);
    expect(branches.gmMode.calls.length).toBe(1);
    expect(branches.socket.calls.length).toBe(0);
  });

  test('regression — non-vehicle defender: falls through to socket challenge unchanged', () => {
    const branches = makeBranchSpies();
    const ctx = { defender: { type: 'character', system: { attributes: {} } } };
    dispatchFullAutoSingleTarget(ctx, false, branches);
    expect(branches.socket.calls.length).toBe(1);
    expect(branches.gmMode.calls.length).toBe(0);
  });

  test('a vehicle target still receives a row via _accumulateFullAutoResult — the consolidated card is not missing it', () => {
    const results = [];
    const ctx = {
      defender: { type: 'vehicle', name: 'APC' },
      attackOutcome: 'success',
      defenceType: 'none',
      defenceOutcome: 'none',
      roundsPerTarget: 3,
      roundsHit: 1, // stamped by the vehicle branch from the actual outcome
      chosenSpecialEffects: [],
      _fullAutoResults: results
    };
    accumulateFullAutoResult(ctx);
    expect(results.length).toBe(1);
    expect(results[0].defenderName).toBe('APC');
    expect(results[0].attackOutcome).toBe('success');
    // roundsHit reflects the single-application outcome, not the generic
    // default of 0 — a hit must not render as "All rounds missed".
    expect(results[0].roundsHit).toBe(1);
  });

  test('a vehicle miss accumulates roundsHit: 0 — the summary row does not falsely claim a hit', () => {
    const results = [];
    const ctx = {
      defender: { type: 'vehicle', name: 'APC' },
      attackOutcome: 'failure',
      defenceType: 'none',
      defenceOutcome: 'none',
      roundsPerTarget: 3,
      roundsHit: 0,
      chosenSpecialEffects: [],
      _fullAutoResults: results
    };
    accumulateFullAutoResult(ctx);
    expect(results[0].roundsHit).toBe(0);
    expect(results[0].attackOutcome).toBe('failure');
  });
});

// =============================================================================
// Multi-round vehicle damage — fullauto-vehicle-followup-questions.md /
// v1.4.266. Candidate (B): one attack roll, 1dN rounds hit (N = the declared
// burst size), each hitting round independently resolved through
// shields → hull → structure with its own 1d10 System Component roll.
// Rulebook citation: Mythras Imperative p.50 "Full-Automatic" — "Those
// targets who are hit suffer a random number of rounds as per Burst Fire" —
// written about targets generally, no personnel-only qualifier, and the
// Vehicles chapter states no exception. Confirmed identical wording in both
// the project-local and OneDrive rulebook copies (see chat report). Destined
// (main + Companion) does not modify the base Burst/Full-Automatic mechanic
// and has no vehicle-specific override.
//
// _resolveVehicleAttack/_applyVehicleDamage are Foundry-coupled (Roll,
// game.actors, ChatMessage) and not import-safe under Jest, same as the rest
// of this file's convention. These are pure mirrors of the new branch
// selection and per-round loop/snapshot logic only — not the real rolls,
// actor updates, or card HTML. Real control flow (shield depletion actually
// persisting via sequential awaited game.actors updates, the card rendering
// correctly) is live-verified per the batch's acceptance criteria.
// =============================================================================

/**
 * Mirror of _resolveVehicleAttack's post-v1.4.266 damage-resolution branch
 * selection (which path runs, given attackerScored/automationLevel/isBurstFire).
 */
function vehicleDamageBranch(attackerScored, automationLevel, isBurstFire) {
  if (!attackerScored) return 'none';
  if (automationLevel === 'full') {
    return isBurstFire ? 'burst' : 'single';
  }
  return 'semiManualSingle';
}

/**
 * Mirror of the per-round loop in _resolveVehicleAttack's burst branch:
 * calls applyRound(ctx, null) roundsHit times, snapshotting the round-shaped
 * fields it mutates onto ctx into a fresh array entry each time — mirroring
 * ctx.vehicleDamageRounds. chatMsg is always null in the per-round call,
 * exactly as the real loop suppresses _applyVehicleDamage's own per-call
 * card update so it never runs mid-loop.
 */
function runVehicleBurstLoop(roundsHit, ctx, applyRound) {
  const vehicleDamageRounds = [];
  for (let i = 0; i < roundsHit; i++) {
    applyRound(ctx, null);
    vehicleDamageRounds.push({
      round:           i + 1,
      rawDamage:       ctx.rawDamage,
      structureDamage: ctx.structureDamage,
    });
  }
  return vehicleDamageRounds;
}

describe('vehicle multi-round damage branch selection (v1.4.266)', () => {
  test('a miss takes no damage branch, regardless of automation level or burst', () => {
    expect(vehicleDamageBranch(false, 'full', true)).toBe('none');
    expect(vehicleDamageBranch(false, 'semi', false)).toBe('none');
  });

  test('full automation + Burst/Full-Auto declared → multi-round burst branch', () => {
    expect(vehicleDamageBranch(true, 'full', true)).toBe('burst');
  });

  test('full automation + no burst declared → single-application branch (unchanged v1.4.265 behaviour)', () => {
    expect(vehicleDamageBranch(true, 'full', false)).toBe('single');
  });

  test('semi automation, even with Burst/Full-Auto declared, stays single-application — the button click model is unchanged', () => {
    expect(vehicleDamageBranch(true, 'semi', true)).toBe('semiManualSingle');
  });

  test('manual automation, even with Burst/Full-Auto declared, stays single-application', () => {
    expect(vehicleDamageBranch(true, 'manual', true)).toBe('semiManualSingle');
  });
});

describe('vehicle multi-round damage loop (v1.4.266)', () => {
  test('calls the per-round damage application exactly roundsHit times', () => {
    const applyRound = makeSpy();
    const ctx = { rawDamage: 0, structureDamage: 0 };
    runVehicleBurstLoop(3, ctx, applyRound);
    expect(applyRound.calls.length).toBe(3);
  });

  test('every per-round call passes chatMsg=null — the card is never updated mid-loop', () => {
    const applyRound = makeSpy();
    const ctx = { rawDamage: 0, structureDamage: 0 };
    runVehicleBurstLoop(2, ctx, applyRound);
    for (const call of applyRound.calls) {
      expect(call[1]).toBeNull();
    }
  });

  test('roundsHit: 0 (theoretical) is a no-op — no rounds recorded, no calls made', () => {
    const applyRound = makeSpy();
    const ctx = {};
    const rounds = runVehicleBurstLoop(0, ctx, applyRound);
    expect(rounds.length).toBe(0);
    expect(applyRound.calls.length).toBe(0);
  });

  test('each round snapshot is captured before the next call overwrites ctx — no shared-reference corruption', () => {
    // Mirrors the real bug this loop must avoid: _applyVehicleDamage
    // overwrites ctx.rawDamage/ctx.structureDamage in place each call, so a
    // naive "read ctx after the loop" approach would only ever see the last
    // round's numbers for every entry.
    let call = 0;
    const applyRound = (ctx) => {
      call += 1;
      ctx.rawDamage       = call * 10;
      ctx.structureDamage = call;
    };
    const ctx = { rawDamage: 0, structureDamage: 0 };
    const rounds = runVehicleBurstLoop(3, ctx, applyRound);
    expect(rounds).toEqual([
      { round: 1, rawDamage: 10, structureDamage: 1 },
      { round: 2, rawDamage: 20, structureDamage: 2 },
      { round: 3, rawDamage: 30, structureDamage: 3 },
    ]);
    // ctx itself still only reflects the last round, as the real fields do —
    // callers must read the snapshot array, not ctx, for per-round history.
    expect(ctx.rawDamage).toBe(30);
  });
});

// =============================================================================
// apBonusHooks
//   Non-negative-per-hook integers summed onto Action Points max AFTER the
//   fatigue penalty is applied, so a granted bonus isn't itself fatigued
//   away. Used by Destined Combat Expert (+1 AP). Max floors at 1.
// =============================================================================

describe('apBonusHooks', () => {
  test('empty/undefined hook list leaves the penalized base unchanged, bonus 0', () => {
    expect(applyApBonusHooks([], 3, {})).toEqual({ bonus: 0, max: 3 });
    expect(applyApBonusHooks(undefined, 2, {})).toEqual({ bonus: 0, max: 2 });
  });

  test('a single hook adds to max and is reported separately as bonus', () => {
    const res = applyApBonusHooks([() => 1], 3, {});
    expect(res).toEqual({ bonus: 1, max: 4 });
  });

  test('multiple hooks sum (stacking AP bonuses across powers)', () => {
    const res = applyApBonusHooks([() => 1, () => 2], 3, {});
    expect(res).toEqual({ bonus: 3, max: 6 });
  });

  test('a hook returning null/undefined/NaN contributes zero', () => {
    expect(applyApBonusHooks([() => undefined, () => 1], 3, {})).toEqual({ bonus: 1, max: 4 });
    expect(applyApBonusHooks([() => null], 3, {})).toEqual({ bonus: 0, max: 3 });
    expect(applyApBonusHooks([() => NaN, () => 1], 3, {})).toEqual({ bonus: 1, max: 4 });
  });

  test('a throwing hook is swallowed and does not abort the sum', () => {
    const hooks = [() => 1, () => { throw new Error('boom'); }, () => 2];
    expect(applyApBonusHooks(hooks, 3, {})).toEqual({ bonus: 3, max: 6 });
  });

  test('max floors at 1 even against a heavily fatigue-penalized base with no bonus', () => {
    // A penalized base of 0 (e.g. Exhausted) with no hooks registered still
    // must leave the actor able to act at all -- matches Step 2's own floor.
    expect(applyApBonusHooks([], 0, {})).toEqual({ bonus: 0, max: 1 });
  });

  test('idempotent: re-running yields the same result (no accumulation)', () => {
    const hooks = [() => 2];
    const first  = applyApBonusHooks(hooks, 3, {});
    const second = applyApBonusHooks(hooks, 3, {});
    expect(first).toEqual(second);
    expect(second).toEqual({ bonus: 2, max: 5 });
  });

  test('each hook receives the actor document', () => {
    const spy = makeSpy(() => 1);
    const actor = { name: 'Nex' };
    applyApBonusHooks([spy], 3, actor);
    expect(spy.calls).toEqual([[actor]]);
  });
});

// =============================================================================
// damageModOffsetHooks
//   Signed step shifts summed on top of the manual dmOffset. Used by Destined
//   Enhanced Strength / Enhanced Body. The actor's STR is never touched.
// =============================================================================

describe('damageModOffsetHooks', () => {
  test('empty/undefined hook list returns the manual offset unchanged', () => {
    expect(applyDamageModOffsetHooks([], 0, {})).toBe(0);
    expect(applyDamageModOffsetHooks(undefined, 2, {})).toBe(2);
  });

  test('single hook adds its signed step to the manual offset', () => {
    expect(applyDamageModOffsetHooks([() => 3], 0, {})).toBe(3);
    expect(applyDamageModOffsetHooks([() => 3], 1, {})).toBe(4);
  });

  test('negative offsets are supported', () => {
    expect(applyDamageModOffsetHooks([() => -2], 0, {})).toBe(-2);
  });

  test('multiple hooks sum', () => {
    expect(applyDamageModOffsetHooks([() => 2, () => 1], 0, {})).toBe(3);
  });

  test('a hook returning null/undefined contributes zero', () => {
    expect(applyDamageModOffsetHooks([() => undefined, () => 2], 0, {})).toBe(2);
    expect(applyDamageModOffsetHooks([() => null], 1, {})).toBe(1);
  });

  test('a throwing hook is swallowed and does not abort the sum', () => {
    const hooks = [() => 2, () => { throw new Error('boom'); }, () => 1];
    expect(applyDamageModOffsetHooks(hooks, 0, {})).toBe(3);
  });

  test('idempotent: re-running yields the same result (no accumulation)', () => {
    const hooks = [() => 3];
    const first  = applyDamageModOffsetHooks(hooks, 1, {});
    const second = applyDamageModOffsetHooks(hooks, 1, {});
    expect(first).toBe(second);
    expect(second).toBe(4);
  });

  test('max-resolution pattern: one hook owns the larger of two power deltas', () => {
    // Enhanced Strength delta 3, Enhanced Body delta 2 — the single registered
    // hook returns Math.max so they do not stack.
    const esDelta = 3, ebDelta = 2;
    const hook = () => Math.max(esDelta, ebDelta);
    expect(applyDamageModOffsetHooks([hook], 0, {})).toBe(3);
  });
});

// =============================================================================
// movementHooks
//   Signed integer added to the stored movementRate base BEFORE walk/run/sprint
//   derive, so the whole trio inherits the bonus. Base is floored at 0. Used by
//   Destined Enhanced Speed / Enhanced Body / Multi-Limbs. The stored
//   movementRate is never mutated.
// =============================================================================

describe('movementHooks', () => {
  test('empty/undefined hook list leaves the base unchanged', () => {
    expect(applyMovementHooks([], 6, {})).toEqual({ base: 6, walk: 6, run: 18, sprint: 30 });
    expect(applyMovementHooks(undefined, 9, {}).base).toBe(9);
  });

  test('a positive hook raises base and the whole derived trio inherits it', () => {
    // Enhanced Speed doubling a base-9 actor adds +9.
    const res = applyMovementHooks([() => 9], 9, {});
    expect(res).toEqual({ base: 18, walk: 18, run: 54, sprint: 90 });
  });

  test('a flat add (e.g. Enhanced Body +CON/5) stacks additively', () => {
    const res = applyMovementHooks([() => 2], 6, {});
    expect(res.base).toBe(8);
    expect(res.walk).toBe(8);
  });

  test('multiple hooks sum (net movement across several powers)', () => {
    const res = applyMovementHooks([() => 3, () => 1], 6, {});
    expect(res.base).toBe(10);
  });

  test('negative net is supported but base floors at 0', () => {
    expect(applyMovementHooks([() => -4], 6, {}).base).toBe(2);
    expect(applyMovementHooks([() => -20], 6, {}).base).toBe(0);
    const floored = applyMovementHooks([() => -20], 6, {});
    expect(floored).toEqual({ base: 0, walk: 0, run: 0, sprint: 0 });
  });

  test('a hook returning null/undefined/NaN contributes zero', () => {
    expect(applyMovementHooks([() => undefined, () => 2], 6, {}).base).toBe(8);
    expect(applyMovementHooks([() => null], 6, {}).base).toBe(6);
    expect(applyMovementHooks([() => NaN, () => 1], 6, {}).base).toBe(7);
  });

  test('a throwing hook is swallowed and does not abort the sum', () => {
    const hooks = [() => 2, () => { throw new Error('boom'); }, () => 1];
    expect(applyMovementHooks(hooks, 6, {}).base).toBe(9);
  });

  test('idempotent: re-running yields the same result (no accumulation)', () => {
    const hooks = [() => 3];
    const first  = applyMovementHooks(hooks, 6, {});
    const second = applyMovementHooks(hooks, 6, {});
    expect(first).toEqual(second);
    expect(second.base).toBe(9);
  });

  test('fatigue: halved mode halves the post-hook trio', () => {
    // base 6 + 4 = 10; halved → walk 5, run 15, sprint 25.
    const res = applyMovementHooks([() => 4], 6, {}, 'halved');
    expect(res).toEqual({ base: 10, walk: 5, run: 15, sprint: 25 });
  });

  test('fatigue: immobile zeroes the trio regardless of bonus', () => {
    const res = applyMovementHooks([() => 10], 6, {}, 'immobile');
    expect(res).toEqual({ base: 16, walk: 0, run: 0, sprint: 0 });
  });
});

// =============================================================================
// initiativeOffsetHooks
//   Signed sum on top of the base Initiative Bonus. Used by Destined for
//   Enhanced Reactions (+), Bulky (−), Growth (−). One hook owns the net.
// =============================================================================

describe('initiativeOffsetHooks', () => {
  test('empty/undefined list leaves the base unchanged', () => {
    expect(applyInitiativeOffsetHooks([], 5, {})).toBe(5);
    expect(applyInitiativeOffsetHooks(undefined, 3, {})).toBe(3);
  });

  test('positive and negative contributions both apply', () => {
    expect(applyInitiativeOffsetHooks([() => 4], 5, {})).toBe(9);
    expect(applyInitiativeOffsetHooks([() => -2], 5, {})).toBe(3);
  });

  test('multiple hooks sum (net across powers)', () => {
    // Enhanced Reactions +4, Bulky −1, Growth −2 -> net +1
    expect(applyInitiativeOffsetHooks([() => 4, () => -1, () => -2], 5, {})).toBe(6);
  });

  test('null/NaN/throw guards contribute zero and do not abort', () => {
    expect(applyInitiativeOffsetHooks([() => undefined, () => 2], 5, {})).toBe(7);
    expect(applyInitiativeOffsetHooks([() => NaN, () => 1], 5, {})).toBe(6);
    expect(applyInitiativeOffsetHooks([() => 2, () => { throw new Error('x'); }, () => 1], 5, {})).toBe(8);
  });

  test('idempotent: re-running yields the same result', () => {
    const hooks = [() => 3];
    expect(applyInitiativeOffsetHooks(hooks, 5, {})).toBe(applyInitiativeOffsetHooks(hooks, 5, {}));
  });
});

// =============================================================================
// healingRateHooks
//   Signed sum applied BEFORE the Hero Level ×2. Used by Destined for Durability.
// =============================================================================

describe('healingRateHooks', () => {
  test('empty/undefined list leaves the base unchanged', () => {
    expect(applyHealingRateHooks([], 2, {})).toBe(2);
    expect(applyHealingRateHooks(undefined, 3, {})).toBe(3);
  });

  test('a delta stacks additively on the base', () => {
    expect(applyHealingRateHooks([() => 1], 2, {})).toBe(3);
  });

  test('ordering: the delta is added BEFORE the Hero Level ×2', () => {
    // base 2 + 1 = 3, doubled = 6 (NOT 2*2 + 1 = 5)
    expect(applyHealingRateHooks([() => 1], 2, {}, true)).toBe(6);
  });

  test('no advantage: no doubling', () => {
    expect(applyHealingRateHooks([() => 1], 2, {}, false)).toBe(3);
  });

  test('null/NaN/throw guards contribute zero', () => {
    expect(applyHealingRateHooks([() => null, () => 2], 2, {})).toBe(4);
    expect(applyHealingRateHooks([() => 2, () => { throw new Error('x'); }], 2, {})).toBe(4);
  });

  test('idempotent', () => {
    const hooks = [() => 1];
    expect(applyHealingRateHooks(hooks, 2, {}, true)).toBe(applyHealingRateHooks(hooks, 2, {}, true));
  });
});

// =============================================================================
// luckPointsHooks
//   Signed sum applied AFTER the Hero Level luckyPoint adjustments. Used by
//   Destined for Lucky (×2) / Mega Lucky (×4).
// =============================================================================

describe('luckPointsHooks', () => {
  test('empty/undefined list leaves the base+heroAdj unchanged', () => {
    expect(applyLuckPointsHooks([], 3, {})).toBe(3);
    expect(applyLuckPointsHooks([], 3, {}, 1)).toBe(4);
  });

  test('ordering: hero luckyPoint adjustment is applied before the hook sum', () => {
    // base 3, heroAdj +1 = 4, then Lucky doubles the base value (+3) -> 7
    expect(applyLuckPointsHooks([() => 3], 3, {}, 1)).toBe(7);
  });

  test('multiple hooks sum', () => {
    expect(applyLuckPointsHooks([() => 3, () => 9], 3, {})).toBe(15);
  });

  test('null/NaN/throw guards contribute zero', () => {
    expect(applyLuckPointsHooks([() => undefined, () => 2], 3, {})).toBe(5);
    expect(applyLuckPointsHooks([() => 2, () => { throw new Error('x'); }], 3, {})).toBe(5);
  });

  test('idempotent', () => {
    const hooks = [() => 3];
    expect(applyLuckPointsHooks(hooks, 3, {}, 1)).toBe(applyLuckPointsHooks(hooks, 3, {}, 1));
  });
});

// =============================================================================
// magicPointOffsetHooks (seam 1, seam-design-outcomes.md)
//   Signed integer added to the POW-derived base, evaluated BEFORE the
//   value-vs-max clamp — an OFFSET family like damageModOffsetHooks/
//   initiativeOffsetHooks, not a sum-is-the-value family like
//   powerPointsHooks below. Character actors only: NPCData/CreatureData's
//   own bare `magicPoints.max = pow` (module/data/ActorData.js) do not
//   consume this or any other hook family — deliberate, per Chris's
//   ruling, not something a shared helper should paper over.
// =============================================================================

describe('magicPointOffsetHooks', () => {
  test('empty/undefined hook list: max is the bare POW base, value unclamped if already <= it', () => {
    expect(applyMagicPointOffsetHooks([], 15, 10, {})).toEqual({ max: 15, value: 10 });
    expect(applyMagicPointOffsetHooks(undefined, 15, 15, {})).toEqual({ max: 15, value: 15 });
  });

  test('single hook offsets the base, positive or negative', () => {
    expect(applyMagicPointOffsetHooks([() => 3], 15, 10, {})).toEqual({ max: 18, value: 10 });
    expect(applyMagicPointOffsetHooks([() => -4], 15, 10, {})).toEqual({ max: 11, value: 10 });
  });

  test('multiple hooks sum', () => {
    expect(applyMagicPointOffsetHooks([() => 3, () => 2], 15, 10, {})).toEqual({ max: 20, value: 10 });
  });

  test('a throwing hook is swallowed via sumHookContributions, does not abort the sum', () => {
    const hooks = [() => 2, () => { throw new Error('boom'); }, () => 1];
    expect(applyMagicPointOffsetHooks(hooks, 15, 10, {})).toEqual({ max: 18, value: 10 });
  });

  test('idempotent: re-running yields the same result, no accumulation', () => {
    const hooks = [() => 3];
    const first  = applyMagicPointOffsetHooks(hooks, 15, 10, {});
    const second = applyMagicPointOffsetHooks(hooks, 15, 10, {});
    expect(first).toEqual(second);
  });

  test('clamp: a max reduced below the current value pulls value down to match', () => {
    // A hook holding 6 points out of the maximum (e.g. a sustained cost
    // mechanic) on a character whose value is still at the un-reduced max.
    expect(applyMagicPointOffsetHooks([() => -6], 15, 15, {})).toEqual({ max: 9, value: 9 });
  });

  test('clamp: value already below the reduced max is left untouched, not raised', () => {
    expect(applyMagicPointOffsetHooks([() => -6], 15, 5, {})).toEqual({ max: 9, value: 5 });
  });

  test("the seam's own traced CFI sequence: spend against value, then hold against max, composes correctly", () => {
    // POW 15. Spend 4 (an ordinary MP spend touches value only, modelled
    // here as the caller's own pre-derivation state) -> value 11.
    // Next derivation cycle: a sustained-effect hook now holds 4 points
    // out of the max while the effect is active.
    const afterSpend = applyMagicPointOffsetHooks([], 15, 11, {});
    expect(afterSpend).toEqual({ max: 15, value: 11 });
    const whileHeld = applyMagicPointOffsetHooks([() => -4], 15, 11, {});
    expect(whileHeld).toEqual({ max: 11, value: 11 }); // clamp no-ops: value was already there
    // Effect ends, hook stops firing -> max returns to 15, value recovers
    // normally from 11 (recovery itself is out of this seam's scope).
    const afterExpiry = applyMagicPointOffsetHooks([], 15, 11, {});
    expect(afterExpiry).toEqual({ max: 15, value: 11 });
  });

  test('character-only boundary: ActorData.js (NPCData/CreatureData) never references magicPointOffsetHooks', () => {
    // Text-level regression guard for the deliberate ruling in
    // seam-design-outcomes.md — a future edit that "helpfully" shares
    // this derivation with NPCData/CreatureData would silently grant
    // hook consumption to non-character actors for the first time on
    // this object. Mirrors frozen-api.test.js's own text-level-check
    // convention for a decision that isn't otherwise enforceable by a
    // pure-function unit test.
    const actorDataSrc = fs.readFileSync(path.join(__dirname, '..', 'module', 'data', 'ActorData.js'), 'utf8');
    expect(actorDataSrc).not.toMatch(/magicPointOffsetHooks/);
  });
});

// =============================================================================
// powerPointsHooks
//   Unlike every other .max hook above, the system contributes NO base — the
//   hook sum IS attributes.powerPoints.max, not an addition to one. Empty
//   array -> 0, matching the stored initial value (this is the case that
//   proves existing actors see no behavior change). Used by Destined, whose
//   single registered hook returns POW + the Power Level's ppMod.
// =============================================================================

describe('powerPointsHooks', () => {
  test('empty/undefined list resolves to 0 — no behavior change for existing actors', () => {
    expect(applyPowerPointsHooks([], {})).toBe(0);
    expect(applyPowerPointsHooks(undefined, {})).toBe(0);
  });

  test('a single hook IS the max — there is no base to add to', () => {
    // Destined: POW 14, Street level ppMod -2 -> 12
    const powerPointsForActor = () => 14 + (-2);
    expect(applyPowerPointsHooks([powerPointsForActor], {})).toBe(12);
  });

  test('multiple hooks sum additively', () => {
    expect(applyPowerPointsHooks([() => 12, () => 3], {})).toBe(15);
  });

  test('null/NaN/non-number returns coerce to 0', () => {
    expect(applyPowerPointsHooks([() => null, () => undefined, () => NaN, () => 'x', () => 5], {})).toBe(5);
  });

  test('a throwing hook is caught; later hooks still run', () => {
    const hooks = [() => 12, () => { throw new Error('boom'); }, () => 3];
    expect(applyPowerPointsHooks(hooks, {})).toBe(15);
  });

  test('idempotent: re-running the consumption twice yields the same max (no accumulation)', () => {
    const hooks = [() => 12];
    const first  = applyPowerPointsHooks(hooks, {});
    const second = applyPowerPointsHooks(hooks, {});
    expect(first).toBe(second);
    expect(second).toBe(12);
  });
});

// =============================================================================
// hitPointBonusHooks
//   Per-location flat add, beside the Hero Level HP bonus. Used by Destined for
//   Enhanced Body / Durability / flat Power-Level HP. NOT a CON bump.
//   Write-time: consumed by syncHitLocationHP, the sole HP-max writer. The
//   locationId is the full 7-key camelCase vocabulary shared with
//   armourBonusHooks (head/chest/abdomen/rightArm/leftArm/rightLeg/leftLeg).
// =============================================================================

describe('hitPointBonusHooks', () => {
  test('empty/undefined list leaves the base HP unchanged', () => {
    expect(applyHitPointBonusHooks([], 4, {}, 'chest')).toBe(4);
    expect(applyHitPointBonusHooks(undefined, 3, {}, 'head')).toBe(3);
  });

  test('a flat delta adds to the location HP', () => {
    expect(applyHitPointBonusHooks([() => 2], 4, {}, 'chest')).toBe(6);
  });

  test('the hook receives the camelCase location key and may vary by side', () => {
    const perLoc = (actor, locId) => (locId === 'rightArm' ? 3 : 1);
    expect(applyHitPointBonusHooks([perLoc], 4, {}, 'rightArm')).toBe(7);
    expect(applyHitPointBonusHooks([perLoc], 4, {}, 'leftArm')).toBe(5);
  });

  test('multiple hooks sum (Enhanced Body + Durability + flat Power-Level)', () => {
    expect(applyHitPointBonusHooks([() => 1, () => 2, () => 1], 4, {}, 'chest')).toBe(8);
  });

  test('null/NaN/throw guards contribute zero', () => {
    expect(applyHitPointBonusHooks([() => null, () => 2], 4, {}, 'chest')).toBe(6);
    expect(applyHitPointBonusHooks([() => 2, () => { throw new Error('x'); }], 4, {}, 'chest')).toBe(6);
  });

  test('idempotent', () => {
    const hooks = [() => 2];
    expect(applyHitPointBonusHooks(hooks, 4, {}, 'chest')).toBe(applyHitPointBonusHooks(hooks, 4, {}, 'chest'));
  });
});

// =============================================================================
// syncHitLocationHP — full write-time pipeline
//   CON+SIZ table -> Hero Level HP bonus -> per-location hitPointBonusHooks
//   sum. This is what mythras.mjs persists to each hit-location item's
//   system.hp; hit-location items are the sole HP-max authority. Mirrors
//   mythras.mjs syncHitLocationHP(actor) minus the Foundry-coupled item
//   read/write, which requires a mocked-globals runtime smoke test instead.
// =============================================================================

describe('syncHitLocationHP — CON+SIZ table -> hero bonus -> hitPointBonusHooks', () => {
  test('CON+SIZ table with no hero bonus and no hooks', () => {
    // con 10 + siz 10 = 20 -> the <=20 band
    const hp = computeHitLocationHP(10, 10, [], []);
    expect(hp).toEqual({ head: 4, chest: 5, abdomen: 5, rightArm: 3, leftArm: 3, rightLeg: 4, leftLeg: 4 });
  });

  test('hero level hitPoints bonus (+1) applies to every location', () => {
    const hp = computeHitLocationHP(10, 10, ['hitPoints'], []);
    expect(hp).toEqual({ head: 5, chest: 6, abdomen: 6, rightArm: 4, leftArm: 4, rightLeg: 5, leftLeg: 5 });
  });

  test('hero level hitPoints2 bonus (+2) is used instead of hitPoints (+1), not stacked', () => {
    const hp = computeHitLocationHP(10, 10, ['hitPoints', 'hitPoints2'], []);
    expect(hp.head).toBe(6); // 4 + 2, not 4 + 1 + 2
  });

  test('folding a stub hitPointBonusHooks hook adds a flat delta to every location', () => {
    const stubHook = () => 2; // e.g. Destined Enhanced Body flat +2 everywhere
    const hp = computeHitLocationHP(10, 10, [], [stubHook]);
    expect(hp).toEqual({ head: 6, chest: 7, abdomen: 7, rightArm: 5, leftArm: 5, rightLeg: 6, leftLeg: 6 });
  });

  test('a hook can distinguish sides via the camelCase key even though the base table shares one value per pair', () => {
    const rightSideOnly = (actor, locId) => (locId === 'rightArm' || locId === 'rightLeg') ? 3 : 0;
    const hp = computeHitLocationHP(10, 10, [], [rightSideOnly]);
    expect(hp.rightArm).toBe(6); // base 3 + 3
    expect(hp.leftArm).toBe(3);  // untouched
    expect(hp.rightLeg).toBe(7); // base 4 + 3
    expect(hp.leftLeg).toBe(4);  // untouched
  });

  test('multiple hooks sum per location', () => {
    const hp = computeHitLocationHP(10, 10, [], [() => 1, () => 2]);
    expect(hp.head).toBe(4 + 3);
  });

  test('null/NaN/throw guards contribute zero and do not abort the sum', () => {
    const hooks = [() => null, () => undefined, () => NaN, () => { throw new Error('boom'); }, () => 2];
    const hp = computeHitLocationHP(10, 10, [], hooks);
    expect(hp.head).toBe(6);
  });

  test('idempotent: re-running with the same inputs yields the same result', () => {
    const hooks = [() => 2];
    const first  = computeHitLocationHP(10, 10, ['hitPoints'], hooks);
    const second = computeHitLocationHP(10, 10, ['hitPoints'], hooks);
    expect(first).toEqual(second);
  });
});

// =============================================================================
// syncHitLocationHP — item label -> key derivation
//   Regression coverage for a real bug: the contract-level tests above feed
//   the camelCase key directly, so they can't catch a broken item->key
//   derivation. This test builds a stub hit-location item with a
//   system.label (as Foundry items actually carry) and runs it through the
//   REAL locationNameToKey import, matching what syncHitLocationHP does
//   end-to-end. locationNameToKey is shared with CharacterSheet's AP display
//   (module/utils/hit-location.js) so both call sites are covered by one
//   derivation under test.
// =============================================================================

describe('syncHitLocationHP — item label -> key derivation (real locationNameToKey)', () => {
  test('a hit-location item labelled "Right Arm" resolves to the rightArm key and receives its hook bonus', () => {
    // con 10 + siz 10 = 20 -> rightArm base is 3.
    const stubHook = (actor, locId) => (locId === 'rightArm' ? 5 : 0);
    const item = { id: 'loc1', system: { label: 'Right Arm', hp: 3 } }; // stale stored max (no hook applied yet)
    const updates = computeHitLocationUpdates(10, 10, [], [stubHook], [item]);
    expect(updates).toEqual([{ _id: 'loc1', 'system.hp': 8 }]); // 3 + 5
  });
});

// =============================================================================
// weaponDamageHooks / weaponForceHooks
//   weaponDamageHook : (weapon, actor) => string | undefined
//   weaponForceHook  : (weapon, actor, role) => string | undefined
//   OVERRIDE (first-wins) hooks, not sum — the opposite pattern from every
//   other hook array in this file. Consumed by CombatEngine._getWeaponDamage /
//   _getWeaponForce, the single chokepoint every damage-roll and parry-size
//   read in the combat engine goes through (module/combat/CombatEngine.js
//   ~L4481-4503). Mirrored here byte-for-faithful, same approach as the rest
//   of this file for Foundry-coupled call sites.
//
//   `role` is the third argument to weaponForceHooks only ('attack' or
//   'defense') — resolveParryReduction calls _getWeaponForce once per side of
//   an opposed roll, passing 'defense' for the defender's Parry-size lookup
//   and 'attack' for the attacker's Force lookup (also 'defense' for Ward
//   Location's passive-block lookup), so a hook can answer differently for
//   the identical (weapon, actor) pair depending which side asked. Added for
//   Destined's Close Combat Attack Poor Defense limit / Weapon Traits
//   Defensive trait, both of which shift Size only when Parrying, not when
//   attacking.
// =============================================================================

/** Mirror of CombatEngine._getWeaponDamage. */
function getWeaponDamage(hooks, weapon, actor) {
  for (const fn of (hooks ?? [])) {
    try {
      const result = fn(weapon, actor);
      if (result !== undefined) return result;
    } catch (err) { /* swallowed in production via console.error */ }
  }
  return weapon.system.damage;
}

/** Mirror of CombatEngine._getWeaponForce. */
function getWeaponForce(hooks, weapon, actor, role = null) {
  for (const fn of (hooks ?? [])) {
    try {
      const result = fn(weapon, actor, role);
      if (result !== undefined) return result;
    } catch (err) { /* swallowed in production via console.error */ }
  }
  return weapon.system.parrySize;
}

/**
 * Stub weapon matching WeaponData's real shape, including the parrySize
 * getter's exact logic (category === 'ranged' ? force : size) — ItemData.js
 * ~L204.
 */
function makeWeapon({ damage = '1d6', category = 'melee', size = 'M', force = 'M' } = {}) {
  return {
    system: {
      damage,
      category,
      size,
      force,
      parrySize: category === 'ranged' ? force : size,
    },
  };
}

function makeActor(characteristics = {}) {
  return { system: { characteristics } };
}

describe('weaponDamageHooks', () => {
  test('default path: no hooks registered returns weapon.system.damage unchanged', () => {
    const weapon = makeWeapon({ damage: '1d8+2' });
    expect(getWeaponDamage([], weapon, makeActor())).toBe('1d8+2');
    expect(getWeaponDamage(undefined, weapon, makeActor())).toBe('1d8+2');
  });

  test('hook override: a registered hook returning a formula wins', () => {
    const weapon = makeWeapon({ damage: '1d6' });
    const hook = () => '1d8';
    expect(getWeaponDamage([hook], weapon, makeActor())).toBe('1d8');
  });

  test('hook decline: a hook returning undefined falls through to the stored value', () => {
    const weapon = makeWeapon({ damage: '1d6' });
    const hook = () => undefined;
    expect(getWeaponDamage([hook], weapon, makeActor())).toBe('1d6');
  });

  test('first-wins: the first non-undefined result is used, the second hook is not consulted', () => {
    const weapon = makeWeapon({ damage: '1d6' });
    let secondCalled = false;
    const first  = () => '2d6';
    const second = () => { secondCalled = true; return '3d6'; };
    expect(getWeaponDamage([first, second], weapon, makeActor())).toBe('2d6');
    expect(secondCalled).toBe(false);
  });

  test('a declining hook falls through to a later hook that overrides', () => {
    const weapon = makeWeapon({ damage: '1d6' });
    const decline = () => undefined;
    const override = () => '1d10';
    expect(getWeaponDamage([decline, override], weapon, makeActor())).toBe('1d10');
  });

  test('hooks receive the weapon and actor, and can derive a formula from actor characteristics', () => {
    const weapon = makeWeapon({ damage: '1d6' });
    const actor = makeActor({ pow: { value: 16 } });
    // e.g. Destined Blast: POW-derived damage table lookup
    const hook = (w, a) => (a.system.characteristics.pow.value >= 16 ? '2d8' : undefined);
    expect(getWeaponDamage([hook], weapon, actor)).toBe('2d8');
  });

  test('a throwing hook is skipped and does not poison the result; a later hook still wins', () => {
    const weapon = makeWeapon({ damage: '1d6' });
    const hooks = [
      () => { throw new Error('bad weaponDamageHook'); },
      () => '1d12',
    ];
    expect(getWeaponDamage(hooks, weapon, makeActor())).toBe('1d12');
  });

  test('a throwing hook with no other hooks falls through to the stored value', () => {
    const weapon = makeWeapon({ damage: '1d6' });
    const hooks = [() => { throw new Error('bad weaponDamageHook'); }];
    expect(getWeaponDamage(hooks, weapon, makeActor())).toBe('1d6');
  });

  test('idempotent: re-running against the same inputs yields the same result', () => {
    const weapon = makeWeapon({ damage: '1d6' });
    const actor = makeActor({ pow: { value: 16 } });
    const hooks = [(w, a) => `${a.system.characteristics.pow.value}d2`];
    const first  = getWeaponDamage(hooks, weapon, actor);
    const second = getWeaponDamage(hooks, weapon, actor);
    expect(first).toBe(second);
    expect(second).toBe('16d2');
  });
});

describe('weaponForceHooks', () => {
  test('default path: no hooks registered returns weapon.system.parrySize — melee resolves to size', () => {
    const weapon = makeWeapon({ category: 'melee', size: 'L', force: 'S' });
    expect(getWeaponForce([], weapon, makeActor())).toBe('L');
  });

  test('default path: no hooks registered returns weapon.system.parrySize — ranged resolves to force', () => {
    const weapon = makeWeapon({ category: 'ranged', size: 'S', force: 'H' });
    expect(getWeaponForce([], weapon, makeActor())).toBe('H');
    expect(getWeaponForce(undefined, weapon, makeActor())).toBe('H');
  });

  test('hook override: a registered hook returning a Force/Size code wins', () => {
    const weapon = makeWeapon({ category: 'melee', size: 'M' });
    const hook = () => 'E';
    expect(getWeaponForce([hook], weapon, makeActor())).toBe('E');
  });

  test('hook decline: a hook returning undefined falls through to parrySize', () => {
    const weapon = makeWeapon({ category: 'ranged', force: 'M' });
    const hook = () => undefined;
    expect(getWeaponForce([hook], weapon, makeActor())).toBe('M');
  });

  test('first-wins: the first non-undefined result is used, the second hook is not consulted', () => {
    const weapon = makeWeapon({ category: 'melee', size: 'M' });
    let secondCalled = false;
    const first  = () => 'H';
    const second = () => { secondCalled = true; return 'E'; };
    expect(getWeaponForce([first, second], weapon, makeActor())).toBe('H');
    expect(secondCalled).toBe(false);
  });

  test('hooks receive the weapon and actor, and can derive a Force code from actor characteristics', () => {
    const weapon = makeWeapon({ category: 'ranged', force: 'M' });
    const actor = makeActor({ str: { value: 18 } });
    // e.g. Destined Mega Blast: physical damage adds ½STR — reflected in Force too
    const hook = (w, a) => (a.system.characteristics.str.value >= 18 ? 'H' : undefined);
    expect(getWeaponForce([hook], weapon, actor)).toBe('H');
  });

  test('a throwing hook is skipped and does not poison the result; a later hook still wins', () => {
    const weapon = makeWeapon({ category: 'melee', size: 'M' });
    const hooks = [
      () => { throw new Error('bad weaponForceHook'); },
      () => 'L',
    ];
    expect(getWeaponForce(hooks, weapon, makeActor())).toBe('L');
  });

  test('idempotent: re-running against the same inputs yields the same result', () => {
    const weapon = makeWeapon({ category: 'melee', size: 'M' });
    const hooks = [() => 'H'];
    const first  = getWeaponForce(hooks, weapon, makeActor());
    const second = getWeaponForce(hooks, weapon, makeActor());
    expect(first).toBe(second);
    expect(second).toBe('H');
  });

  describe('role param (attack vs defense)', () => {
    test('a hook can answer differently for the identical (weapon, actor) pair depending on role', () => {
      const weapon = makeWeapon({ category: 'melee', size: 'M' });
      const actor = makeActor();
      // e.g. Destined Poor Defense: one Size smaller only when Parrying
      const hook = (w, a, role) => (role === 'defense' ? 'S' : undefined);
      expect(getWeaponForce([hook], weapon, actor, 'defense')).toBe('S');
      expect(getWeaponForce([hook], weapon, actor, 'attack')).toBe('M'); // declines, falls through to parrySize
    });

    test('role defaults to null when the caller omits it — a hook keying on role sees null, not "attack"', () => {
      const weapon = makeWeapon({ category: 'melee', size: 'M' });
      const hook = (w, a, role) => (role === 'defense' ? 'S' : undefined);
      expect(getWeaponForce([hook], weapon, makeActor())).toBe('M');
    });

    test('a hook that ignores the third argument behaves identically regardless of role (backward compatible)', () => {
      const weapon = makeWeapon({ category: 'melee', size: 'M' });
      const hook = () => 'E';
      expect(getWeaponForce([hook], weapon, makeActor(), 'attack')).toBe('E');
      expect(getWeaponForce([hook], weapon, makeActor(), 'defense')).toBe('E');
    });
  });
});

// =============================================================================
// reloadTimeOffsetHooks — CombatEngine._getEffectiveReloadTime
//   Mirrors _getEffectiveDamageModifier's shape: a real stored base
//   (weapon.system.load), offset by a signed, summed hook total, floored
//   at 0 (no table to clamp against — load is a plain non-negative
//   integer, not a fixed-order lookup like the DM/condition-grade
//   families). sumHookContributions is imported for real above (line 28),
//   so these tests exercise the real summation behaviour, not a second
//   mirror of it — only the surrounding base+floor logic is mirrored here.
// =============================================================================

/** Mirror of CombatEngine._getEffectiveReloadTime. */
function getEffectiveReloadTime(hooks, weapon, actor) {
  const base = weapon?.system?.load ?? 0;
  const offset = sumHookContributions(hooks, [weapon, actor], { errorLabel: 'reloadTimeOffsetHook' }).total;
  return Math.max(0, base + offset);
}

function makeReloadWeapon(load = 0) {
  return { system: { load } };
}

describe('reloadTimeOffsetHooks', () => {
  test('no hooks registered: returns the stored base unchanged', () => {
    const weapon = makeReloadWeapon(3);
    expect(getEffectiveReloadTime([], weapon, makeActor())).toBe(3);
    expect(getEffectiveReloadTime(undefined, weapon, makeActor())).toBe(3);
  });

  test('missing weapon or load field: base treated as 0', () => {
    expect(getEffectiveReloadTime([], undefined, makeActor())).toBe(0);
    expect(getEffectiveReloadTime([], { system: {} }, makeActor())).toBe(0);
  });

  test('a single hook offsets the base — negative shortens reload', () => {
    const weapon = makeReloadWeapon(3);
    const hook = () => -1;
    expect(getEffectiveReloadTime([hook], weapon, makeActor())).toBe(2);
  });

  test('a single hook can lengthen reload too — positive is a valid contribution', () => {
    const weapon = makeReloadWeapon(2);
    const hook = () => 1;
    expect(getEffectiveReloadTime([hook], weapon, makeActor())).toBe(3);
  });

  test('multiple hooks are summed, not last-wins or first-wins', () => {
    const weapon = makeReloadWeapon(4);
    // e.g. CFI Ranged Weapon Specialization (-1) + Grand Master ranged (-1)
    const hooks = [() => -1, () => -1];
    expect(getEffectiveReloadTime(hooks, weapon, makeActor())).toBe(2);
  });

  test('a hook driving the result below zero is clamped at 0, never negative', () => {
    const weapon = makeReloadWeapon(1);
    const hooks = [() => -5];
    expect(getEffectiveReloadTime(hooks, weapon, makeActor())).toBe(0);
  });

  test('a throwing hook is isolated — does not break composition or other hooks', () => {
    const weapon = makeReloadWeapon(3);
    const hooks = [
      () => { throw new Error('boom'); },
      () => -1,
    ];
    expect(getEffectiveReloadTime(hooks, weapon, makeActor())).toBe(2);
  });

  test('non-numeric return contributes 0, does not throw', () => {
    const weapon = makeReloadWeapon(3);
    const hooks = [() => 'not-a-number', () => undefined];
    expect(getEffectiveReloadTime(hooks, weapon, makeActor())).toBe(3);
  });

  test('hooks receive (weapon, actor), matching the documented contract', () => {
    const weapon = makeReloadWeapon(2);
    const actor  = makeActor();
    const spy = makeSpy(() => 0);
    getEffectiveReloadTime([spy], weapon, actor);
    expect(spy.calls).toEqual([[weapon, actor]]);
  });

  test('idempotent: re-running against the same inputs yields the same result', () => {
    const weapon = makeReloadWeapon(3);
    const hooks = [() => -1];
    const first  = getEffectiveReloadTime(hooks, weapon, makeActor());
    const second = getEffectiveReloadTime(hooks, weapon, makeActor());
    expect(first).toBe(second);
    expect(second).toBe(2);
  });
});

// =============================================================================
// CombatEngine.resolveWardReduction — Ward Location (core rules p.39)
//   "Any blow which lands on that [warded] location has its damage
//   automatically downgraded as per normal for a parrying weapon of its
//   Size." Same S/M/L/H/E size-diff ladder as resolveParryReduction
//   (_sizeDiffMultiplier, factored out and shared by both), but automatic —
//   no Combat Style, no opposed roll — and only when this attack was NOT
//   already actively Parried (defenceType !== 'parry'), per the judgment
//   call documented on the real method (module/combat/CombatEngine.js).
//   Mirrored here the same way as weaponForceHooks/resolveParryReduction
//   above, since CombatEngine.js is Foundry-coupled.
// =============================================================================

function sizeDiffMultiplier(diff) {
  if (diff <= 0) return { multiplier: 0, label: 'full' };
  if (diff === 1) return { multiplier: 0.5, label: 'half' };
  return { multiplier: 1, label: 'none' };
}

/** Mirror of CombatEngine.resolveWardReduction. */
function resolveWardReduction(attackWeapon, defender, hitLocationId, defenceType, ctx = null, attackerActor = null) {
  if (defenceType === 'parry') return { multiplier: 1, label: 'none' };
  if (!defender || !hitLocationId) return { multiplier: 1, label: 'none' };

  const locItem = defender.items.find(i => i.id === hitLocationId);
  const locKey  = locItem ? locationNameToKey(locItem.system.label ?? locItem.name ?? '') : null;
  const ward    = locKey ? defender.system?.wardedLocations?.[locKey] : null;
  if (!ward?.warded || !ward.weaponId) return { multiplier: 1, label: 'none' };

  const wardWeapon = defender.items.find(i => i.id === ward.weaponId);
  if (!wardWeapon) return { multiplier: 1, label: 'none' };

  const sizeOrder = { S: 0, M: 1, L: 2, H: 3, E: 4 };
  const defSize   = sizeOrder[getWeaponForce([], wardWeapon, defender, 'defense')] ?? 1;
  let   atkSize   = sizeOrder[getWeaponForce([], attackWeapon, attackerActor, 'attack')] ?? 1;
  if (ctx?.isRanged && ctx?.rangeBand === 'long') {
    atkSize = Math.max(0, atkSize - 1);
  }

  return sizeDiffMultiplier(atkSize - defSize);
}

function makeLocItem(id, label) {
  return { id, system: { label } };
}

function makeDefender({ wardedLocations = {}, items = [] } = {}) {
  return { system: { wardedLocations }, items };
}

describe('resolveWardReduction', () => {
  test('active Parry short-circuits — Ward never applies on a Parried attack', () => {
    const defender = makeDefender({
      wardedLocations: { chest: { warded: true, weaponId: 'ward1' } },
      items: [makeLocItem('loc1', 'Chest'), { id: 'ward1', ...makeWeapon({ size: 'S' }) }],
    });
    const atk = makeWeapon({ category: 'melee', size: 'E' });
    expect(resolveWardReduction(atk, defender, 'loc1', 'parry')).toEqual({ multiplier: 1, label: 'none' });
  });

  test('no defender or no hitLocationId — declines', () => {
    const atk = makeWeapon();
    expect(resolveWardReduction(atk, null, 'loc1', 'none')).toEqual({ multiplier: 1, label: 'none' });
    expect(resolveWardReduction(atk, makeDefender(), null, 'none')).toEqual({ multiplier: 1, label: 'none' });
  });

  test('location not warded — declines', () => {
    const defender = makeDefender({
      wardedLocations: { chest: { warded: false, weaponId: '' } },
      items: [makeLocItem('loc1', 'Chest')],
    });
    expect(resolveWardReduction(makeWeapon(), defender, 'loc1', 'none')).toEqual({ multiplier: 1, label: 'none' });
  });

  test('warded but weaponId is empty — declines', () => {
    const defender = makeDefender({
      wardedLocations: { chest: { warded: true, weaponId: '' } },
      items: [makeLocItem('loc1', 'Chest')],
    });
    expect(resolveWardReduction(makeWeapon(), defender, 'loc1', 'none')).toEqual({ multiplier: 1, label: 'none' });
  });

  test('ward weapon id no longer resolves to a real item — declines rather than throwing', () => {
    const defender = makeDefender({
      wardedLocations: { chest: { warded: true, weaponId: 'deleted-item' } },
      items: [makeLocItem('loc1', 'Chest')],
    });
    expect(resolveWardReduction(makeWeapon(), defender, 'loc1', 'none')).toEqual({ multiplier: 1, label: 'none' });
  });

  test('a hit on an unwarded location on the same actor is unaffected', () => {
    const defender = makeDefender({
      wardedLocations: { chest: { warded: true, weaponId: 'ward1' } },
      items: [makeLocItem('loc2', 'Right Arm'), { id: 'ward1', ...makeWeapon({ size: 'S' }) }],
    });
    expect(resolveWardReduction(makeWeapon(), defender, 'loc2', 'none')).toEqual({ multiplier: 1, label: 'none' });
  });

  test('equal size — full block (multiplier 0)', () => {
    const defender = makeDefender({
      wardedLocations: { chest: { warded: true, weaponId: 'ward1' } },
      items: [makeLocItem('loc1', 'Chest'), { id: 'ward1', ...makeWeapon({ category: 'melee', size: 'M' }) }],
    });
    const atk = makeWeapon({ category: 'melee', size: 'M' });
    expect(resolveWardReduction(atk, defender, 'loc1', 'none')).toEqual({ multiplier: 0, label: 'full' });
  });

  test('attacker one size larger — half damage', () => {
    const defender = makeDefender({
      wardedLocations: { chest: { warded: true, weaponId: 'ward1' } },
      items: [makeLocItem('loc1', 'Chest'), { id: 'ward1', ...makeWeapon({ category: 'melee', size: 'M' }) }],
    });
    const atk = makeWeapon({ category: 'melee', size: 'L' });
    expect(resolveWardReduction(atk, defender, 'loc1', 'none')).toEqual({ multiplier: 0.5, label: 'half' });
  });

  test('attacker two or more sizes larger — no reduction', () => {
    const defender = makeDefender({
      wardedLocations: { chest: { warded: true, weaponId: 'ward1' } },
      items: [makeLocItem('loc1', 'Chest'), { id: 'ward1', ...makeWeapon({ category: 'melee', size: 'S' }) }],
    });
    const atk = makeWeapon({ category: 'melee', size: 'E' });
    expect(resolveWardReduction(atk, defender, 'loc1', 'none')).toEqual({ multiplier: 1, label: 'none' });
  });

  test('defenceType other than parry (evade/acrobatics/none) all let Ward apply the same way', () => {
    const defender = makeDefender({
      wardedLocations: { chest: { warded: true, weaponId: 'ward1' } },
      items: [makeLocItem('loc1', 'Chest'), { id: 'ward1', ...makeWeapon({ category: 'melee', size: 'M' }) }],
    });
    const atk = makeWeapon({ category: 'melee', size: 'L' });
    for (const defenceType of ['evade', 'acrobatics', 'none']) {
      expect(resolveWardReduction(atk, defender, 'loc1', defenceType)).toEqual({ multiplier: 0.5, label: 'half' });
    }
  });

  test('ranged Long-range Force step-down still applies to the attacking weapon inside Ward', () => {
    const defender = makeDefender({
      wardedLocations: { chest: { warded: true, weaponId: 'ward1' } },
      items: [makeLocItem('loc1', 'Chest'), { id: 'ward1', ...makeWeapon({ category: 'melee', size: 'M' }) }],
    });
    // Ranged force 'H' at Long range steps down to 'L' -> diff 1 -> half, not 'none'.
    const atk = makeWeapon({ category: 'ranged', force: 'H' });
    const ctx = { isRanged: true, rangeBand: 'long' };
    expect(resolveWardReduction(atk, defender, 'loc1', 'none', ctx)).toEqual({ multiplier: 0.5, label: 'half' });
  });

  test('real hit-location label -> camelCase key derivation (locationNameToKey), not a hand-picked key', () => {
    const defender = makeDefender({
      wardedLocations: { rightArm: { warded: true, weaponId: 'ward1' } },
      items: [makeLocItem('loc1', 'Right Arm'), { id: 'ward1', ...makeWeapon({ category: 'melee', size: 'S' }) }],
    });
    const atk = makeWeapon({ category: 'melee', size: 'E' });
    expect(resolveWardReduction(atk, defender, 'loc1', 'none')).toEqual({ multiplier: 1, label: 'none' });
  });
});

// =============================================================================
// rangedParryEligibleHooks
//   rangedParryEligibleHook : (weapon, actor) => boolean | undefined
//   Mirrors the ranged-attack shield-only filter inside
//   DefenderDialog._buildParryWeaponList (module/combat/DefenderDialog.js):
//   a weapon with the 'shield' trait always passes; otherwise the first
//   hook to return truthy lets that weapon through too; if nothing survives
//   the filter, ALL weapons fall back in (so the defender is never locked
//   out) — that fallback is _buildParryWeaponList's own pre-existing rule,
//   reproduced here so the hook-consultation branch is tested in context.
// =============================================================================

/** Mirror of the ranged-attack branch inside _buildParryWeaponList. */
function filterForRangedParry(weapons, actor, hooks) {
  const shieldOnly = weapons.filter(w => {
    if ((w.system.traits ?? []).includes('shield')) return true;
    for (const fn of (hooks ?? [])) {
      try { if (fn(w, actor)) return true; } catch (err) { /* swallowed in production via console.error */ }
    }
    return false;
  });
  return shieldOnly.length > 0 ? shieldOnly : weapons;
}

function makeParryWeapon(id, { shield = false } = {}) {
  return { id, name: id, system: { traits: shield ? ['shield'] : [] } };
}

describe('rangedParryEligibleHooks', () => {
  test('a shield always passes, with no hooks registered', () => {
    const shield = makeParryWeapon('w1', { shield: true });
    const sword  = makeParryWeapon('w2');
    expect(filterForRangedParry([shield, sword], {}, [])).toEqual([shield]);
  });

  test('no shield, no hooks: falls back to every weapon (pre-existing rule, not this hook)', () => {
    const sword = makeParryWeapon('w1');
    const axe   = makeParryWeapon('w2');
    expect(filterForRangedParry([sword, axe], {}, [])).toEqual([sword, axe]);
  });

  test('a hook returning true lets one non-shield weapon through, excluding the rest', () => {
    const shield = makeParryWeapon('shield', { shield: true });
    const cca    = makeParryWeapon('cca');
    const dagger = makeParryWeapon('dagger');
    const hook = (w) => w.id === 'cca';
    expect(filterForRangedParry([shield, cca, dagger], {}, [hook])).toEqual([shield, cca]);
  });

  test('a hook returning undefined for everything declines — falls back to shield-only (or all, if no shield)', () => {
    const cca    = makeParryWeapon('cca');
    const dagger = makeParryWeapon('dagger');
    const hook = () => undefined;
    expect(filterForRangedParry([cca, dagger], {}, [hook])).toEqual([cca, dagger]); // no shield -> fallback to all
  });

  test('first-wins semantics: a throwing hook does not poison the result; a later hook still grants eligibility', () => {
    const cca = makeParryWeapon('cca');
    const hooks = [
      () => { throw new Error('bad rangedParryEligibleHook'); },
      (w) => w.id === 'cca',
    ];
    expect(filterForRangedParry([cca], {}, hooks)).toEqual([cca]);
  });

  test('hooks receive the weapon and actor', () => {
    const cca = makeParryWeapon('cca');
    const actor = { id: 'actor1' };
    const hook = (w, a) => a.id === 'actor1' && w.id === 'cca';
    expect(filterForRangedParry([cca], actor, [hook])).toEqual([cca]);
  });
});

// =============================================================================
// damageHooks
//   damageHook : (ctx, damage) => number | false | void
//   Called in CombatEngine._applyDamage (~L2649-2662), once per hook,
//   immediately before damage is written to the defending hit location.
//   `false` suppresses damage entirely and short-circuits the loop (full
//   immunity, absolute — nothing later can raise it back up). A finite
//   number COMPOSES: each subsequent hook receives the already-reduced
//   damage, unlike weaponDamageHooks' first-wins override, because two
//   independent reductions (e.g. a resistance power and a shield) should
//   both apply. The composed value is floored to a non-negative integer.
//   Any other return (undefined, null, true, a string, NaN) is ignored.
//   Unlike several other hook consumers in this file, this loop has NO
//   try/catch — a throwing hook is expected to propagate (see below).
// =============================================================================

/** Mirror of CombatEngine._applyDamage's damageHooks reduction loop. Deliberately has NO try/catch, matching the real loop. */
function applyDamageHooks(hooks, ctx, damage) {
  for (const hook of (hooks ?? [])) {
    const result = hook(ctx, damage);
    if (result === false) {
      damage = 0;
      break;
    }
    if (typeof result === 'number' && Number.isFinite(result)) {
      damage = Math.max(0, Math.floor(result));
    }
  }
  return damage;
}

function makeDamageCtx(overrides = {}) {
  return {
    defender: makeActor(),
    weapon: makeWeapon(),
    hitLocationId: 'loc1',
    ...overrides,
  };
}

describe('damageHooks', () => {
  test('no hooks registered, and undefined hooks array: damage passes through unchanged', () => {
    expect(applyDamageHooks([], makeDamageCtx(), 10)).toBe(10);
    expect(applyDamageHooks(undefined, makeDamageCtx(), 10)).toBe(10);
  });

  test('a hook returning false suppresses damage to 0', () => {
    const hook = () => false;
    expect(applyDamageHooks([hook], makeDamageCtx(), 10)).toBe(0);
  });

  test('false short-circuits: a second hook is not consulted', () => {
    let secondCalled = false;
    const hooks = [
      () => false,
      () => { secondCalled = true; return 20; },
    ];
    expect(applyDamageHooks(hooks, makeDamageCtx(), 10)).toBe(0);
    expect(secondCalled).toBe(false);
  });

  test('a hook returning a number sets damage to that value', () => {
    const hook = () => 4;
    expect(applyDamageHooks([hook], makeDamageCtx(), 10)).toBe(4);
  });

  test('two numeric hooks compose: the second receives the first\'s reduced value', () => {
    const hooks = [
      (ctx, dmg) => dmg - 3, // 10 -> 7
      (ctx, dmg) => dmg - 2, // 7 -> 5
    ];
    expect(applyDamageHooks(hooks, makeDamageCtx(), 10)).toBe(5);
  });

  test('a hook returning undefined declines and leaves damage unchanged; a later hook still runs', () => {
    const hooks = [
      () => undefined,
      (ctx, dmg) => dmg - 1,
    ];
    expect(applyDamageHooks(hooks, makeDamageCtx(), 10)).toBe(9);
  });

  test('null, true, a string, and NaN are all ignored — damage unchanged', () => {
    expect(applyDamageHooks([() => null], makeDamageCtx(), 10)).toBe(10);
    expect(applyDamageHooks([() => true], makeDamageCtx(), 10)).toBe(10);
    expect(applyDamageHooks([() => 'blocked'], makeDamageCtx(), 10)).toBe(10);
    // NaN explicitly: typeof NaN === 'number' is true, so Number.isFinite
    // must be doing real filtering work here, not defensive decoration.
    expect(applyDamageHooks([() => NaN], makeDamageCtx(), 10)).toBe(10);
  });

  test('a negative number floors to 0', () => {
    const hook = () => -5;
    expect(applyDamageHooks([hook], makeDamageCtx(), 10)).toBe(0);
  });

  test('a fractional number floors to an integer', () => {
    const hook = () => 4.9;
    expect(applyDamageHooks([hook], makeDamageCtx(), 10)).toBe(4);
  });

  test('hooks receive ctx (defender/weapon/hitLocationId) and the running damage value', () => {
    const ctx = makeDamageCtx({ hitLocationId: 'rightArm' });
    const hook = (c, dmg) => (c.hitLocationId === 'rightArm' ? dmg - 1 : dmg);
    expect(applyDamageHooks([hook], ctx, 10)).toBe(9);
  });

  // Documents current behaviour rather than asserting a design intent: this
  // loop has no try/catch (unlike movementHooks in CharacterData.js, which
  // wraps each call in try { ... } catch { return sum; }). A throwing hook
  // propagates out of _applyDamage uncaught. See the report for the
  // try/catch recommendation — this batch does not add one.
  test('a throwing hook propagates — this loop has no try/catch (documents current behaviour)', () => {
    const hook = () => { throw new Error('bad damageHook'); };
    expect(() => applyDamageHooks([hook], makeDamageCtx(), 10)).toThrow('bad damageHook');
  });

  test('idempotent: re-running against the same inputs yields the same result', () => {
    const hooks = [(ctx, dmg) => dmg - 2];
    const ctx = makeDamageCtx();
    const first  = applyDamageHooks(hooks, ctx, 10);
    const second = applyDamageHooks(hooks, ctx, 10);
    expect(first).toBe(second);
    expect(second).toBe(8);
  });
});

// =============================================================================
// CombatEngine._ctxFromCardFlags / _resolveActorById
//   Damage-chokepoint fix, Batch 1 (damage-chokepoint-prompt.md), amended —
//   added UNUSED in production; nothing calls these yet. Mirrored here the
//   same way as _getWeaponDamage/_getWeaponForce above, since CombatEngine.js
//   cannot be imported directly in plain Node (it imports from files with
//   Foundry-coupled module-level code).
//
//   _resolveActorById mirrors the real version's canvas.tokens.placeables
//   token-preferred lookup, but takes an injected { tokens, actors } world
//   instead of reaching for the real `canvas`/`game` globals — the same
//   adaptation this file already makes for actor/weapon fixtures elsewhere.
//
//   _ctxFromCardFlags mirrors the real version field-for-field: reads every
//   flag stamped on the outcome card (CombatEngine.js's ChatMessage.create,
//   ~L1119-1151 — 24 fields, not the 21 the prompt estimated), resolves
//   actor/item ids to documents, and takes hitLocationId/hitLocationLabel/
//   damage/rawDamage from `extras` (the Apply Damage button's own dataset,
//   stamped later at damage-resolution time, not part of the outcome
//   card's attack-time flags). No `btn`/DOM parameter — amended out, since
//   defenderId is always stamped alongside attackerId at outcome-card
//   creation time; a missing defenderId means a malformed card and returns
//   null, the same convention as every other "can't build a ctx" case here.
// =============================================================================

/** Mirror of CombatEngine._resolveActorById, with canvas/game injected as `world`. */
function resolveActorById(actorId, world = {}) {
  if (!actorId) return null;
  const tokens = world.tokens ?? [];
  const actors = world.actors ?? new Map();
  const token = tokens.find(t => t.actor?.id === actorId || t.document?.actorId === actorId) ?? null;
  return token?.actor ?? actors.get(actorId) ?? null;
}

/** Mirror of the module's getItem (module/combat/effects/helpers.js) — actor.items.get, null-safe. */
function getItemStub(actor, itemId) {
  if (!actor || !itemId) return null;
  try { return actor.items.get(itemId) ?? null; }
  catch (_) { return null; }
}

/** Deterministic stand-in for CombatEngine._classifyLocation — real classification
 * logic is combat-math.js's concern and separately tested; this only needs to prove
 * _ctxFromCardFlags passes hitLocationLabel through to it correctly. */
function classifyLocationStub(label) {
  return (label || '').toLowerCase().includes('head') ? 'head' : 'body';
}

/** Mirror of CombatEngine._ctxFromCardFlags. */
function ctxFromCardFlags(outcomeMsg, extras = {}, world = {}) {
  const flags = outcomeMsg?.flags?.['mythras-imperative'];
  if (!flags) return null;

  const attacker = resolveActorById(flags.attackerId, world);
  const defender  = resolveActorById(flags.defenderId, world);
  if (!attacker || !defender) return null;

  const { hitLocationId = null, hitLocationLabel = '', damage = 0, rawDamage = 0, baseArmourPoints = undefined } = extras;

  return {
    attacker,
    defender,
    weapon:               getItemStub(attacker, flags.weaponId),
    defenceWeapon:        getItemStub(defender, flags.defenceWeaponId),
    attackerStyle:        getItemStub(attacker, flags.attackerStyleId),
    defenceStyle:         getItemStub(defender, flags.defenceStyleId),
    stage:                flags.stage ?? null,
    dmgFormula:           flags.dmgFormula ?? null,
    isCharge:             flags.isCharge ?? false,
    isBurstFire:          flags.isBurstFire ?? false,
    isFullAuto:           flags.isFullAuto ?? false,
    rangeBand:            flags.rangeBand ?? null,
    difficulty:           flags.difficulty ?? 'standard',
    defenceType:          flags.defenceType ?? null,
    chosenSpecialEffects: flags.chosenSEs ?? [],
    seWinner:             flags.seWinner ?? null,
    isRanged:             flags.isRanged ?? false,
    attackOutcome:        flags.attackOutcome ?? null,
    defenceOutcome:       flags.defenceOutcome ?? null,
    attackResult:         flags.attackResult ?? 0,
    attackerSkillTotal:   flags.attackerSkillTotal ?? 0,
    defenceResult:        flags.defenceResult ?? 0,
    defenderSkillTotal:   flags.defenderSkillTotal ?? 0,
    hitLocationId,
    hitLocationLabel,
    locationType:         classifyLocationStub(hitLocationLabel),
    damage,
    rawDamage,
    baseArmourPoints,
    damageRoll:           null,
    chatMessageId:        outcomeMsg?.id ?? null,
  };
}

function makeItemsCollection(items) {
  const map = new Map(items.map(i => [i.id, i]));
  return { get: id => map.get(id) ?? null };
}

function makeCtxActor(id, name, items = []) {
  return { id, name, items: makeItemsCollection(items) };
}

// A full, representative 24-field flag set, as CombatEngine.js's
// ChatMessage.create actually stamps it.
function makeOutcomeFlags(overrides = {}) {
  return {
    actorId:             'attacker1',
    defenderId:           'defender1',
    attackerId:           'attacker1',
    weaponId:             'weapon1',
    stage:                'outcome',
    dmgFormula:           '1d8+1d4',
    isCharge:             false,
    isBurstFire:          false,
    isFullAuto:           false,
    rangeBand:            null,
    difficulty:           'standard',
    defenceType:          'parry',
    defenceWeaponId:      'shield1',
    defenceStyleId:       'style-defence',
    chosenSEs:            ['bleed'],
    seWinner:             'attacker',
    attackerStyleId:      'style-attack',
    isRanged:             false,
    attackOutcome:        'success',
    defenceOutcome:       'fail',
    attackResult:         85,
    attackerSkillTotal:   90,
    defenceResult:        20,
    defenderSkillTotal:   60,
    ...overrides,
  };
}

function makeOutcomeMsg(flagOverrides = {}, id = 'msg1') {
  return { id, flags: { 'mythras-imperative': makeOutcomeFlags(flagOverrides) } };
}

describe('CombatEngine._resolveActorById', () => {
  test('resolves via a placed token actor when one matches, in preference to the base actor', () => {
    const baseActor  = makeCtxActor('a1', 'Base');
    const tokenActor = makeCtxActor('a1', 'Token Copy'); // same id, different (synthetic) instance
    const world = { actors: new Map([['a1', baseActor]]), tokens: [{ actor: tokenActor }] };
    expect(resolveActorById('a1', world)).toBe(tokenActor);
  });

  test('falls back to the base/world actor when no matching token is placed', () => {
    const baseActor = makeCtxActor('a1', 'Base');
    const world = { actors: new Map([['a1', baseActor]]), tokens: [] };
    expect(resolveActorById('a1', world)).toBe(baseActor);
  });

  test('null/undefined id returns null without touching the world', () => {
    expect(resolveActorById(null, { actors: new Map(), tokens: [] })).toBeNull();
    expect(resolveActorById(undefined)).toBeNull();
  });

  test('unresolvable id returns null', () => {
    expect(resolveActorById('ghost', { actors: new Map(), tokens: [] })).toBeNull();
  });
});

describe('CombatEngine._ctxFromCardFlags', () => {
  function standardWorld() {
    const weapon  = { id: 'weapon1', name: 'Longsword' };
    const shield  = { id: 'shield1', name: 'Heater Shield' };
    const atkStyle = { id: 'style-attack', name: 'Sword & Shield', system: { traits: ['knockoutBlow'] } };
    const defStyle = { id: 'style-defence', name: 'Sword & Shield' };
    const attacker = makeCtxActor('attacker1', 'Attacker', [weapon, atkStyle]);
    const defender = makeCtxActor('defender1', 'Defender', [shield, defStyle]);
    return {
      world: { actors: new Map([['attacker1', attacker], ['defender1', defender]]), tokens: [] },
      attacker, defender, weapon, shield, atkStyle, defStyle,
    };
  }

  test('full rehydration from a representative flag set', () => {
    const { world, attacker, defender, weapon, shield, atkStyle, defStyle } = standardWorld();
    const outcomeMsg = makeOutcomeMsg();
    const extras = { hitLocationId: 'loc-head', hitLocationLabel: 'Head', damage: 6, rawDamage: 9, baseArmourPoints: 4 };

    const ctx = ctxFromCardFlags(outcomeMsg, extras, world);

    expect(ctx).toEqual({
      attacker, defender,
      weapon, defenceWeapon: shield,
      attackerStyle: atkStyle, defenceStyle: defStyle,
      stage: 'outcome',
      dmgFormula: '1d8+1d4',
      isCharge: false, isBurstFire: false, isFullAuto: false,
      rangeBand: null, difficulty: 'standard',
      defenceType: 'parry',
      chosenSpecialEffects: ['bleed'],
      seWinner: 'attacker',
      isRanged: false,
      attackOutcome: 'success', defenceOutcome: 'fail',
      attackResult: 85, attackerSkillTotal: 90,
      defenceResult: 20, defenderSkillTotal: 60,
      hitLocationId: 'loc-head', hitLocationLabel: 'Head',
      locationType: 'head',
      damage: 6, rawDamage: 9,
      baseArmourPoints: 4,
      damageRoll: null,
      chatMessageId: 'msg1',
    });
  });

  test('attackerStyle resolves to a real item (the Knockout Blow / fumble-SE wake-up case)', () => {
    const { world, atkStyle } = standardWorld();
    const ctx = ctxFromCardFlags(makeOutcomeMsg(), {}, world);
    expect(ctx.attackerStyle).toBe(atkStyle);
    expect(ctx.attackerStyle.system.traits).toContain('knockoutBlow');
  });

  test('graceful handling of a missing/deleted outcome message: returns null, does not throw', () => {
    expect(() => ctxFromCardFlags(null)).not.toThrow();
    expect(ctxFromCardFlags(null)).toBeNull();
    expect(ctxFromCardFlags(undefined)).toBeNull();
  });

  test('graceful handling of an outcome message with no mythras-imperative flags', () => {
    expect(ctxFromCardFlags({ id: 'msg2', flags: {} })).toBeNull();
  });

  test('returns null if the attacker or defender cannot be resolved', () => {
    const world = { actors: new Map(), tokens: [] }; // empty world — nobody resolves
    expect(ctxFromCardFlags(makeOutcomeMsg(), {}, world)).toBeNull();
  });

  test('returns null (same convention, no DOM fallback) when defenderId is absent from the flags', () => {
    const { world } = standardWorld();
    const outcomeMsg = makeOutcomeMsg({ defenderId: undefined });
    expect(ctxFromCardFlags(outcomeMsg, {}, world)).toBeNull();
  });

  test('chosenSEs flag is renamed to chosenSpecialEffects on ctx', () => {
    const { world } = standardWorld();
    const outcomeMsg = makeOutcomeMsg({ chosenSEs: ['trip', 'stunLocation'] });
    const ctx = ctxFromCardFlags(outcomeMsg, {}, world);
    expect(ctx.chosenSpecialEffects).toEqual(['trip', 'stunLocation']);
    expect(ctx.chosenSEs).toBeUndefined();
  });

  test('damageRoll is always null — never reconstructed from flags', () => {
    const { world } = standardWorld();
    const ctx = ctxFromCardFlags(makeOutcomeMsg(), {}, world);
    expect(ctx.damageRoll).toBeNull();
  });

  test('extras defaults (hitLocationId/Label/damage/rawDamage) apply when extras is omitted', () => {
    const { world } = standardWorld();
    const ctx = ctxFromCardFlags(makeOutcomeMsg(), undefined, world);
    expect(ctx.hitLocationId).toBeNull();
    expect(ctx.hitLocationLabel).toBe('');
    expect(ctx.damage).toBe(0);
    expect(ctx.rawDamage).toBe(0);
  });

  // baseArmourPoints (v1.4.267+): unlike hitLocationId/damage/rawDamage, this
  // has no zero-ish default — a genuinely unstamped path (a semi-auto card
  // built before v1.4.267, or any future extras caller that doesn't have it)
  // must come through as undefined, not 0, so a damageHooks consumer can tell
  // "unknown" apart from "no armour".
  test('baseArmourPoints defaults to undefined when extras omits it', () => {
    const { world } = standardWorld();
    const ctx = ctxFromCardFlags(makeOutcomeMsg(), {}, world);
    expect(ctx.baseArmourPoints).toBeUndefined();
  });

  test('baseArmourPoints passes through from extras, including 0 (fully sundered/no armour)', () => {
    const { world } = standardWorld();
    const ctx = ctxFromCardFlags(makeOutcomeMsg(), { baseArmourPoints: 0 }, world);
    expect(ctx.baseArmourPoints).toBe(0);
  });

  test('idempotent: re-running against the same inputs yields an equal result', () => {
    const { world } = standardWorld();
    const outcomeMsg = makeOutcomeMsg();
    const extras = { hitLocationId: 'loc-head', hitLocationLabel: 'Head', damage: 6, rawDamage: 9 };
    const first  = ctxFromCardFlags(outcomeMsg, extras, world);
    const second = ctxFromCardFlags(outcomeMsg, extras, world);
    expect(first).toEqual(second);
  });
});

// =============================================================================
// mythras.mjs .mi-btn-apply-dmg handler — ctx construction (mirrored)
//   Damage-chokepoint fix, Batch 2 (batch2-prompt.md). The real handler is a
//   DOM click callback with game.messages/ui.notifications dependencies and
//   is not unit-tested directly (same reason CombatEngine.js itself is
//   mirrored throughout this file). This mirrors just the two behaviours
//   Batch 2 changes, still valid under Batch 3: (1) the ammo-trait chosenSEs
//   injection must survive the swap to _ctxFromCardFlags — the helper only
//   knows the raw stamped flags.chosenSEs, never the locally-mutated
//   broadhead/Stun Round copy, so the caller must override
//   chosenSpecialEffects on the built ctx; (2) a null return from
//   _ctxFromCardFlags must be handled without the chokepoint ever being
//   called.
//
//   Batch 3 (batch3 section of damage-chokepoint-prompt.md) additions: the
//   handler no longer builds separate minimalCtx/woundCtx objects — one ctx
//   goes into CombatEngine._applyDamage(ctx, damage), which now does the
//   write, opposed-SE resolution, wound consequences, and the vampiric
//   drain internally. Two things the single call can't replicate on its
//   own, both covered below: (a) Stun Round's stunLocation SE needs a
//   different damage value than the HP write, so it is excluded from the
//   dispatched set and resolved separately (mirrors the Full Auto path's
//   identical bypass); (b) _applyDamage posts no user-facing notification
//   at all (Full Auto instead updates a chat card) — the semi-auto handler
//   now builds its own "Applied N.../No damage applied" notification from
//   ctx.newCurrent after the call, since a damageHooks consumer may have
//   reduced the actual applied amount below what was originally rolled.
// =============================================================================

/** Mirrors the handler's chosenSEs construction (mythras.mjs ~L1124-1139). */
function injectAmmoTraitSEs(flags, damage) {
  const chosenSEs = [...(flags.chosenSEs ?? [])];
  if (flags.broadhead && damage > 0 && !chosenSEs.includes('bleed')) {
    chosenSEs.push('bleed');
  }
  const stunRoundActive = flags.stunRound && !chosenSEs.includes('stunLocation');
  if (stunRoundActive) {
    chosenSEs.push('stunLocation');
  }
  return { chosenSEs, stunRoundActive };
}

describe('mythras.mjs Apply Damage handler — ctx construction', () => {
  function standardWorld() {
    const weapon  = { id: 'weapon1', name: 'Longsword' };
    const attacker = makeCtxActor('attacker1', 'Attacker', [weapon]);
    const defender = makeCtxActor('defender1', 'Defender', []);
    return { world: { actors: new Map([['attacker1', attacker], ['defender1', defender]]), tokens: [] } };
  }

  test('broadhead auto-bleed: chosenSpecialEffects on the merged ctx reflects the injected copy, not the raw flag', () => {
    const { world } = standardWorld();
    const flags = { broadhead: true, chosenSEs: [] };
    const { chosenSEs } = injectAmmoTraitSEs(flags, /* damage */ 5);
    expect(chosenSEs).toEqual(['bleed']);

    const outcomeMsg = makeOutcomeMsg({ chosenSEs: [] }); // raw flag stays empty
    const baseCtx = ctxFromCardFlags(outcomeMsg, {}, world);
    const merged = { ...baseCtx, chosenSpecialEffects: chosenSEs };

    expect(merged.chosenSpecialEffects).toEqual(['bleed']);
    expect(baseCtx.chosenSpecialEffects).toEqual([]); // the helper alone never sees the injection
  });

  test('Stun Round auto-stunLocation: chosenSpecialEffects on the merged ctx reflects the injected copy', () => {
    const { world } = standardWorld();
    const flags = { stunRound: true, chosenSEs: [] };
    const { chosenSEs, stunRoundActive } = injectAmmoTraitSEs(flags, 0); // fires even at 0 damage
    expect(chosenSEs).toEqual(['stunLocation']);
    expect(stunRoundActive).toBe(true);

    const outcomeMsg = makeOutcomeMsg({ chosenSEs: [] });
    const baseCtx = ctxFromCardFlags(outcomeMsg, {}, world);
    const merged = { ...baseCtx, chosenSpecialEffects: chosenSEs };

    expect(merged.chosenSpecialEffects).toEqual(['stunLocation']);
  });

  test('both ammo traits together: injected copy carries both, raw flag carries neither', () => {
    const flags = { broadhead: true, stunRound: true, chosenSEs: ['trip'] };
    const { chosenSEs } = injectAmmoTraitSEs(flags, 5);
    expect(chosenSEs).toEqual(['trip', 'bleed', 'stunLocation']);
  });

  // Mirrors the handler's data-base-armour-points parse (mythras.mjs, Roll
  // Damage -> Apply Damage handoff, v1.4.267): parseInt on a missing/absent
  // dataset attribute yields NaN, which must become undefined (matching
  // _ctxFromCardFlags's own default), not leak NaN into the ctx.
  function parseBaseArmourPoints(datasetValue) {
    const raw = parseInt(datasetValue, 10);
    return Number.isFinite(raw) ? raw : undefined;
  }

  test('data-base-armour-points parses to a number when present, including 0', () => {
    expect(parseBaseArmourPoints('4')).toBe(4);
    expect(parseBaseArmourPoints('0')).toBe(0);
  });

  test('data-base-armour-points absent (older cached card) parses to undefined, not NaN', () => {
    expect(parseBaseArmourPoints(undefined)).toBeUndefined();
    expect(parseBaseArmourPoints('')).toBeUndefined();
  });

  test('the parsed value flows through extras into the rehydrated ctx', () => {
    const { world } = standardWorld();
    const outcomeMsg = makeOutcomeMsg();
    const baseArmourPoints = parseBaseArmourPoints('4');
    const ctx = ctxFromCardFlags(outcomeMsg, { baseArmourPoints }, world);
    expect(ctx.baseArmourPoints).toBe(4);
  });

  test('a null ctx from _ctxFromCardFlags is handled without reaching the opposed-SE resolver', () => {
    const emptyWorld = { actors: new Map(), tokens: [] }; // nobody resolves
    const outcomeMsg = makeOutcomeMsg();
    const baseCtx = ctxFromCardFlags(outcomeMsg, {}, emptyWorld);
    expect(baseCtx).toBeNull();

    let resolverCalled = false;
    if (!baseCtx) {
      // error path — mirrors the handler's console.error + ui.notifications.error
    } else {
      resolverCalled = true; // would call CombatEngine._resolveOpposedSEs
    }
    expect(resolverCalled).toBe(false);
  });

  test('a null ctx from _ctxFromCardFlags is handled without reaching the wound-consequence resolver', () => {
    const emptyWorld = { actors: new Map(), tokens: [] };
    const outcomeMsg = makeOutcomeMsg();
    const baseCtx = ctxFromCardFlags(outcomeMsg, {}, emptyWorld);
    expect(baseCtx).toBeNull();

    let resolverCalled = false;
    if (!baseCtx) {
      // error path
    } else {
      resolverCalled = true; // would call CombatEngine._resolveWoundConsequences
    }
    expect(resolverCalled).toBe(false);
  });

  test('the built ctx carries the fields _resolveWoundConsequences reads, sourced from the helper (Batch 3: no manual semiCtxForWound merge — _applyDamage sets woundLevel/newCurrent/maxHp/locationType/enduranceRequired on ctx itself)', () => {
    const { world } = standardWorld();
    const outcomeMsg = makeOutcomeMsg();
    const baseCtx = ctxFromCardFlags(outcomeMsg, {}, world);
    const ctx = { ...baseCtx, locationType: 'limb', chosenSpecialEffects: [] };

    expect(ctx.locationType).toBe('limb');
    // Fields _resolveWoundConsequences reads that are NOT in the prompt's
    // 8-field list (confirmed by reading the function fully for Batch 3):
    expect(ctx.attackerSkillTotal).toBe(90); // from makeOutcomeFlags' default
    expect(ctx.chatMessageId).toBe('msg1');  // was never set at all pre-Batch-2
    // woundLevel/newCurrent/maxHp/enduranceRequired are NOT present here —
    // _applyDamage mutates them onto this same ctx object at call time, not
    // supplied ahead of time by _ctxFromCardFlags or this construction step.
    expect(ctx.woundLevel).toBeUndefined();
    expect(ctx.newCurrent).toBeUndefined();
  });

  // ── Batch 3: Stun Round SE dispatch exclusion ─────────────────────────────
  // Mirrors the handler's `dispatchedSEs` construction (mythras.mjs, just
  // before the _applyDamage call).
  function excludeStunLocationIfActive(chosenSEs, stunRoundActive) {
    return stunRoundActive ? chosenSEs.filter(id => id !== 'stunLocation') : chosenSEs;
  }

  test('Stun Round active: stunLocation is excluded from the dispatched set (would otherwise be silently gated out at damage=0)', () => {
    const flags = { stunRound: true, chosenSEs: ['trip'] };
    const { chosenSEs, stunRoundActive } = injectAmmoTraitSEs(flags, 0);
    expect(chosenSEs).toEqual(['trip', 'stunLocation']);

    const dispatched = excludeStunLocationIfActive(chosenSEs, stunRoundActive);
    expect(dispatched).toEqual(['trip']);
    expect(dispatched).not.toContain('stunLocation');
  });

  test('Stun Round inactive: chosenSEs pass through the dispatch step unchanged, stunLocation included if separately chosen', () => {
    const flags = { chosenSEs: ['stunLocation', 'bleed'] }; // e.g. genuinely chosen, not ammo-injected
    const { chosenSEs, stunRoundActive } = injectAmmoTraitSEs(flags, 5);
    expect(stunRoundActive).toBeFalsy(); // flags.stunRound absent

    const dispatched = excludeStunLocationIfActive(chosenSEs, stunRoundActive);
    expect(dispatched).toEqual(['stunLocation', 'bleed']); // untouched — the exclusion is Stun-Round-specific
  });

  // ── Batch 3: applied-damage notification decision ─────────────────────────
  // Mirrors the handler's post-_applyDamage notification branch. ctx.newCurrent
  // is only set by the real _applyDamage when damage (post-damageHooks) ended
  // up > 0 AND the hit location resolved — this mirror models exactly that
  // observable contract without re-implementing _applyDamage itself.
  function describeAppliedDamage(ctxAfter, beforeCurrent, defenderName, locLabel) {
    if (typeof ctxAfter.newCurrent === 'number' && beforeCurrent !== null) {
      const appliedDamage = beforeCurrent - ctxAfter.newCurrent;
      return `Applied ${appliedDamage} to ${defenderName}'s ${locLabel}. Current HP: ${ctxAfter.newCurrent}. Wound: ${ctxAfter.woundLevel}.`;
    }
    return `No damage applied to ${defenderName}'s ${locLabel}.`;
  }

  test('normal hit: reports the actual applied delta (beforeCurrent - ctx.newCurrent), not the pre-hook rolled damage', () => {
    const ctxAfter = { newCurrent: 3, woundLevel: 'minor' };
    const msg = describeAppliedDamage(ctxAfter, /* beforeCurrent */ 7, 'Goblin', 'Chest');
    expect(msg).toBe(`Applied 4 to Goblin's Chest. Current HP: 3. Wound: minor.`);
  });

  test('a damageHooks consumer reducing damage below what was rolled is reflected in the applied figure', () => {
    // e.g. a hook halves 10 rolled damage to 5 before the write — the
    // notification must show 5 (what landed), not 10 (what was rolled).
    const ctxAfter = { newCurrent: 5, woundLevel: 'none' };
    const msg = describeAppliedDamage(ctxAfter, /* beforeCurrent */ 10, 'Hero', 'Head');
    expect(msg).toBe(`Applied 5 to Hero's Head. Current HP: 5. Wound: none.`);
  });

  test('damage fully suppressed by a damageHooks consumer: reports "no damage", not a stale or zero-looking write', () => {
    // ctx.newCurrent is never set — _applyDamage's write block only runs
    // when damage (post-hooks) is > 0.
    const ctxAfter = {};
    const msg = describeAppliedDamage(ctxAfter, /* beforeCurrent */ 10, 'Hero', 'Head');
    expect(msg).toBe(`No damage applied to Hero's Head.`);
  });

  test('hit location did not resolve: reports "no damage" rather than throwing on a null beforeCurrent', () => {
    const ctxAfter = {};
    const msg = describeAppliedDamage(ctxAfter, /* beforeCurrent */ null, 'Hero', 'Head');
    expect(msg).toBe(`No damage applied to Hero's Head.`);
  });
});

// =============================================================================
// seEligibilityHooks
//   seEligibilityHook : (seId, ctx, isAttackerWinner) => boolean | undefined
//   Mirrors the `gated` branch added to SpecialEffectDialog._filterSEs
//   (module/combat/SpecialEffectDialog.js): a catalog entry with no `gated`
//   flag is entirely unaffected; a `gated: true` entry additionally requires
//   at least one hook to return exactly `true` for that (seId, ctx,
//   isAttackerWinner) triple — a default-DENY gate, the opposite of every
//   other hook array's "decline is the common case" convention, since a
//   gated SE would otherwise already be shown to everyone by the ordinary
//   restriction switch.
// =============================================================================

/** Mirror of _filterSEs' gated-SE check (restriction switch assumed already passed). */
function passesSEGate(se, ctx, isAttackerWinner, hooks) {
  if (!se.gated) return true;
  for (const fn of (hooks ?? [])) {
    try { if (fn(se.id, ctx, isAttackerWinner) === true) return true; }
    catch (err) { /* swallowed in production via console.error */ }
  }
  return false;
}

describe('seEligibilityHooks', () => {
  test('an ungated SE is unaffected — passes regardless of hooks', () => {
    const se = { id: 'bash' };
    expect(passesSEGate(se, {}, true, [])).toBe(true);
    expect(passesSEGate(se, {}, true, [() => false])).toBe(true);
  });

  test('a gated SE with no hooks registered is denied', () => {
    const se = { id: 'bleed', gated: true };
    expect(passesSEGate(se, {}, true, [])).toBe(false);
    expect(passesSEGate(se, {}, true, undefined)).toBe(false);
  });

  test('a gated SE is granted when a hook returns exactly true for this seId', () => {
    const se = { id: 'impale', gated: true };
    const hook = (seId) => seId === 'impale';
    expect(passesSEGate(se, {}, true, [hook])).toBe(true);
  });

  test('a hook returning true for a DIFFERENT seId does not grant this one', () => {
    const se = { id: 'pinObject', gated: true };
    const hook = (seId) => seId === 'impale';
    expect(passesSEGate(se, {}, true, [hook])).toBe(false);
  });

  test('non-boolean truthy returns (a string, an object) do not grant — only exactly true counts', () => {
    const se = { id: 'bleed', gated: true };
    expect(passesSEGate(se, {}, true, [() => 'yes'])).toBe(false);
    expect(passesSEGate(se, {}, true, [() => ({})])).toBe(false);
  });

  test('all matching hooks are consulted (not first-wins): a later hook can still grant after an earlier one declines', () => {
    const se = { id: 'bleed', gated: true };
    const hooks = [() => undefined, () => false, (seId) => seId === 'bleed'];
    expect(passesSEGate(se, {}, true, hooks)).toBe(true);
  });

  test('a throwing hook does not poison the result — a later hook still grants eligibility', () => {
    const se = { id: 'impale', gated: true };
    const hooks = [
      () => { throw new Error('bad seEligibilityHook'); },
      (seId) => seId === 'impale',
    ];
    expect(passesSEGate(se, {}, true, hooks)).toBe(true);
  });

  test('hooks receive seId, ctx, and isAttackerWinner', () => {
    const se = { id: 'pinObject', gated: true };
    const ctx = { attacker: { id: 'a1' } };
    const hook = (seId, c, isAtk) => seId === 'pinObject' && c.attacker.id === 'a1' && isAtk === true;
    expect(passesSEGate(se, ctx, true, [hook])).toBe(true);
    expect(passesSEGate(se, ctx, false, [hook])).toBe(false);
  });
});

// =============================================================================
// bashKnockbackMultiplierHooks
//   bashKnockbackMultiplierHook : (attacker, weapon) => number
//   Mirrors the multiplier loop in resolveBash (module/combat/effects/
//   bash.js): default multiplier is 1; contributions combine by Math.max —
//   STRONGEST WINS. Hooks are not additive, not a product, and not
//   order-dependent. Non-finite/non-positive results are ignored and a
//   throwing hook is caught and logged.
//
//   Changed in v1.4.307 (was last-registered-wins, by plain assignment).
//   The old behaviour silently discarded a contribution whenever two hooks
//   were simultaneously valid — see the order-independence test below, which
//   is the regression guard for that bug.
// =============================================================================

/** Mirror of resolveBash's knockbackMultiplier loop. */
function resolveKnockbackMultiplier(attacker, weapon, hooks) {
  let multiplier = 1;
  for (const hook of (hooks ?? [])) {
    try {
      const result = hook(attacker, weapon);
      if (Number.isFinite(result) && result > 0) {
        multiplier = Math.max(multiplier, result);
      }
    } catch (err) { /* swallowed in production via console.error */ }
  }
  return multiplier;
}

describe('bashKnockbackMultiplierHooks', () => {
  test('no hooks registered: multiplier defaults to 1', () => {
    expect(resolveKnockbackMultiplier({}, {}, [])).toBe(1);
    expect(resolveKnockbackMultiplier({}, {}, undefined)).toBe(1);
  });

  test('a hook returning 2 doubles the multiplier', () => {
    expect(resolveKnockbackMultiplier({}, {}, [() => 2])).toBe(2);
  });

  test('zero, negative, and non-finite results are ignored', () => {
    expect(resolveKnockbackMultiplier({}, {}, [() => 0])).toBe(1);
    expect(resolveKnockbackMultiplier({}, {}, [() => -2])).toBe(1);
    expect(resolveKnockbackMultiplier({}, {}, [() => NaN])).toBe(1);
    expect(resolveKnockbackMultiplier({}, {}, [() => undefined])).toBe(1);
  });

  test('the strongest valid hook wins (not first-wins, not additive)', () => {
    expect(resolveKnockbackMultiplier({}, {}, [() => 2, () => 3])).toBe(3);
  });

  // Regression guard for the v1.4.307 bug: under the old plain-assignment
  // loop this returned 2, silently discarding the x3 contribution purely
  // because it was registered first. Destined registers three independent,
  // non-exclusive consumers (Enhanced Strength Clobber x3, improvised weapon
  // x2, Growth Swat x2), so overlap is reachable in normal play.
  test('registration order does not affect the result', () => {
    expect(resolveKnockbackMultiplier({}, {}, [() => 3, () => 2])).toBe(3);
    expect(resolveKnockbackMultiplier({}, {}, [() => 2, () => 3])).toBe(3);
  });

  test('three simultaneously active hooks yield the largest, not the last', () => {
    const hooks = [() => 3, () => 2, () => 2];
    expect(resolveKnockbackMultiplier({}, {}, hooks)).toBe(3);
  });

  test('hooks do not compound into a product', () => {
    const hooks = [() => 2, () => 3];
    expect(resolveKnockbackMultiplier({}, {}, hooks)).not.toBe(6);
  });

  test('an invalid later result does not reset a valid earlier one', () => {
    const hooks = [() => 2, () => 0];
    expect(resolveKnockbackMultiplier({}, {}, hooks)).toBe(2);
  });

  test('a throwing hook does not poison the result — a later hook still applies', () => {
    const hooks = [
      () => { throw new Error('bad bashKnockbackMultiplierHook'); },
      () => 2,
    ];
    expect(resolveKnockbackMultiplier({}, {}, hooks)).toBe(2);
  });

  test('hooks receive attacker and weapon', () => {
    const attacker = { id: 'a1' };
    const weapon = { id: 'w1' };
    const hook = (a, w) => (a.id === 'a1' && w.id === 'w1') ? 2 : 1;
    expect(resolveKnockbackMultiplier(attacker, weapon, [hook])).toBe(2);
  });
});

// =============================================================================
// game.system.api.triggerOpposedSE (mythras.mjs, v1.4.271)
//   Thin dispatcher: SE_RESOLVERS[seId](ctx), or a console.warn + no-op if
//   seId isn't registered. mythras.mjs is Foundry-coupled and not import-safe
//   under Jest, so this mirrors the real function against an injectable
//   resolver map instead of the live SE_RESOLVERS catalogue.
// =============================================================================

/** Mirror of mythras.mjs's triggerOpposedSE. */
async function triggerOpposedSE(seId, ctx, resolvers, warnFn) {
  const resolver = resolvers[seId];
  if (!resolver) {
    warnFn(`no resolver registered for "${seId}"`);
    return;
  }
  await resolver(ctx);
}

describe('game.system.api.triggerOpposedSE', () => {
  test('a registered resolver is called once with the given ctx', async () => {
    const calls = [];
    const resolvers = { tripOpponent: async (ctx) => { calls.push(ctx); } };
    const ctx = { attacker: { id: 'a1' }, defender: { id: 'd1' }, seWinner: 'attacker' };
    await triggerOpposedSE('tripOpponent', ctx, resolvers, () => {});
    expect(calls).toEqual([ctx]);
  });

  test('an unregistered seId warns and does not throw', async () => {
    const warnings = [];
    await expect(
      triggerOpposedSE('notARealSE', {}, {}, (msg) => warnings.push(msg))
    ).resolves.toBeUndefined();
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/notARealSE/);
  });

  test('disarmOpponent dispatches independently of tripOpponent', async () => {
    const calls = [];
    const resolvers = {
      tripOpponent:   async () => { calls.push('trip'); },
      disarmOpponent: async () => { calls.push('disarm'); },
    };
    await triggerOpposedSE('disarmOpponent', {}, resolvers, () => {});
    expect(calls).toEqual(['disarm']);
  });

  test('a resolver that throws propagates (not swallowed by the dispatcher)', async () => {
    const resolvers = { tripOpponent: async () => { throw new Error('boom'); } };
    await expect(triggerOpposedSE('tripOpponent', {}, resolvers, () => {})).rejects.toThrow('boom');
  });
});

// =============================================================================
// game.system.api.triggerFollowUpAttack (mythras.mjs, v1.4.272)
//   Thin wrapper: CombatEngine._resolveDefender -> _buildContext -> _runDialog.
//   mythras.mjs is Foundry-coupled and not import-safe under Jest, so this
//   mirrors the real function against an injectable engine-shaped object
//   instead of the live CombatEngine class.
// =============================================================================

/** Mirror of mythras.mjs's triggerFollowUpAttack. */
async function triggerFollowUpAttack(attacker, weapon, engine, warnFn) {
  if (!attacker || !weapon) {
    warnFn('attacker and weapon are required');
    return;
  }
  const defender = engine.resolveDefender(attacker);
  if (!defender) return; // resolveDefender already posted its own warning
  const ctx = engine.buildContext(attacker, defender, weapon);
  await engine.runDialog(ctx);
}

describe('game.system.api.triggerFollowUpAttack', () => {
  test('missing attacker warns and never touches the engine', async () => {
    const warnings = [];
    const engine = {
      resolveDefender: () => { throw new Error('should not be called'); },
      buildContext:    () => { throw new Error('should not be called'); },
      runDialog:       () => { throw new Error('should not be called'); },
    };
    await expect(
      triggerFollowUpAttack(null, { id: 'w1' }, engine, (msg) => warnings.push(msg))
    ).resolves.toBeUndefined();
    expect(warnings.length).toBe(1);
  });

  test('missing weapon warns and never touches the engine', async () => {
    const warnings = [];
    const engine = {
      resolveDefender: () => { throw new Error('should not be called'); },
      buildContext:    () => { throw new Error('should not be called'); },
      runDialog:       () => { throw new Error('should not be called'); },
    };
    await expect(
      triggerFollowUpAttack({ id: 'a1' }, null, engine, (msg) => warnings.push(msg))
    ).resolves.toBeUndefined();
    expect(warnings.length).toBe(1);
  });

  test('no resolvable defender (bad/no target) stops before building context', async () => {
    const calls = [];
    const engine = {
      resolveDefender: () => null, // resolveDefender's own "target a token" warning already fired
      buildContext:    () => { calls.push('buildContext'); return {}; },
      runDialog:       () => { calls.push('runDialog'); },
    };
    await triggerFollowUpAttack({ id: 'a1' }, { id: 'w1' }, engine, () => {});
    expect(calls).toEqual([]);
  });

  test('happy path: resolves defender, builds context, runs the dialog with it', async () => {
    const attacker = { id: 'a1' };
    const weapon    = { id: 'w1' };
    const defender  = { id: 'd1' };
    const builtCtx  = { attacker, defender, weapon, tag: 'built' };
    const calls = [];
    const engine = {
      resolveDefender: (a) => { calls.push(['resolveDefender', a]); return defender; },
      buildContext:    (a, d, w) => { calls.push(['buildContext', a, d, w]); return builtCtx; },
      runDialog:       (ctx) => { calls.push(['runDialog', ctx]); },
    };
    await triggerFollowUpAttack(attacker, weapon, engine, () => {});
    expect(calls).toEqual([
      ['resolveDefender', attacker],
      ['buildContext', attacker, defender, weapon],
      ['runDialog', builtCtx],
    ]);
  });

  test('a runDialog throw propagates (not swallowed)', async () => {
    const engine = {
      resolveDefender: () => ({ id: 'd1' }),
      buildContext:    () => ({}),
      runDialog:       () => { throw new Error('boom'); },
    };
    await expect(
      triggerFollowUpAttack({ id: 'a1' }, { id: 'w1' }, engine, () => {})
    ).rejects.toThrow('boom');
  });
});

// =============================================================================
// game.system.api.explainHookSum (mythras.mjs, v1.4.277)
//   Thin console/macro-facing wrapper: looks up CONFIG.MYTHRAS[hookFamilyName]
//   and sums it via the real, shared sumHookContributions -- the provenance
//   win ("why is this number 14?") for any of the ten read-time additive
//   numeric hook families now sharing that one implementation. mythras.mjs
//   itself is Foundry-coupled and not import-safe under Jest, so CONFIG.MYTHRAS
//   is injected as `mythrasConfig` here instead of read from the real global;
//   the summation itself is the REAL imported sumHookContributions, already
//   fully covered in modifier-bus.test.js, so these tests only guard the
//   lookup-by-name + defaulting + option-forwarding wrapper around it.
// =============================================================================

/** Mirror of mythras.mjs's explainHookSum, with CONFIG.MYTHRAS injected. */
function explainHookSum(hookFamilyName, args = [], options = {}, mythrasConfig = {}) {
  const hooks = mythrasConfig?.[hookFamilyName] ?? [];
  return sumHookContributions(hooks, args, { errorLabel: hookFamilyName, ...options });
}

describe('game.system.api.explainHookSum', () => {
  test('looks up the named hook family and sums it via the real bus', () => {
    const mythrasConfig = { apBonusHooks: [() => 1, () => 2] };
    const res = explainHookSum('apBonusHooks', [{}], {}, mythrasConfig);
    expect(res.total).toBe(3);
    expect(res.breakdown.map(b => b.value)).toEqual([1, 2]);
  });

  test('an unknown/missing hook family name defaults to an empty array, not a throw', () => {
    expect(explainHookSum('notARealHookFamily', [{}], {}, {})).toEqual({ total: 0, breakdown: [] });
    expect(explainHookSum('apBonusHooks', [{}], {}, undefined)).toEqual({ total: 0, breakdown: [] });
  });

  test('args are forwarded to every hook exactly as given, in order', () => {
    const calls = [];
    const mythrasConfig = {
      armourBonusHooks: [(actor, locKey) => { calls.push([actor, locKey]); return 1; }],
    };
    const actor = { name: 'Nex' };
    explainHookSum('armourBonusHooks', [actor, 'chest'], {}, mythrasConfig);
    expect(calls).toEqual([[actor, 'chest']]);
  });

  test('options (e.g. clampNonNegative) are forwarded through to the bus', () => {
    const mythrasConfig = { apReductionHooks: [() => -5, () => 3] };
    const res = explainHookSum('apReductionHooks', [{}, {}, 'chest', null], { clampNonNegative: true }, mythrasConfig);
    // -5 clamped to 0, so total is 0+3, not -2.
    expect(res.total).toBe(3);
  });

  test('errorLabel defaults to the hook family name itself', () => {
    const originalError = console.error;
    const calls = [];
    console.error = (...args) => calls.push(args);
    try {
      const mythrasConfig = { healingRateHooks: [() => { throw new Error('boom'); }] };
      explainHookSum('healingRateHooks', [{}], {}, mythrasConfig);
      expect(calls.length).toBe(1);
      expect(calls[0][0]).toContain('healingRateHooks error');
    } finally {
      console.error = originalError;
    }
  });

  test('a caller-supplied errorLabel overrides the hook-family-name default', () => {
    const originalError = console.error;
    const calls = [];
    console.error = (...args) => calls.push(args);
    try {
      const mythrasConfig = { luckPointsHooks: [() => { throw new Error('boom'); }] };
      explainHookSum('luckPointsHooks', [{}], { errorLabel: 'custom label' }, mythrasConfig);
      expect(calls[0][0]).toContain('custom label error');
    } finally {
      console.error = originalError;
    }
  });
});

// =============================================================================
// PassionData#augmentBonus  (module/data/ItemData.js)
//   Skill Augmentation: the augmenting skill adds 20% of its own value to the
//   primary skill, ROUNDED UP -- the rulebook rounds fractional results up as
//   a general rule, and the augmentation example is explicit (Locale 33%
//   augments Ride by 7%, not 6%).
//
//   Mirrored rather than imported: the getter lives on a TypeDataModel, which
//   will not construct under this suite's minimal Foundry mocks. Added in
//   v1.4.309 alongside the fix that routed MythrasRoll.js's four inline copies
//   through the getter -- three of them floored, so the passion dropdown and
//   the roll disagreed with the chat card by a point. Nothing tested this.
// =============================================================================

/** Mirror of PassionData#augmentBonus. */
function augmentBonus(total) {
  return Math.ceil(total * 0.2);
}

describe('PassionData#augmentBonus', () => {
  test('the rulebook worked example: 33% augments by 7%, not 6%', () => {
    expect(augmentBonus(33)).toBe(7);
  });

  test('rounds up, never down', () => {
    expect(augmentBonus(31)).toBe(7);   // 6.2
    expect(augmentBonus(34)).toBe(7);   // 6.8
    expect(augmentBonus(36)).toBe(8);   // 7.2
    expect(augmentBonus(41)).toBe(9);   // 8.2
  });

  test('exact multiples of five are not rounded up past themselves', () => {
    expect(augmentBonus(30)).toBe(6);
    expect(augmentBonus(50)).toBe(10);
    expect(augmentBonus(65)).toBe(13);
  });

  test('floor would have given a different answer for most values', () => {
    // The regression this guards: three call sites used Math.floor.
    const differ = [31, 32, 33, 34, 36, 37, 38, 39]
      .filter(t => Math.floor(t * 0.2) !== augmentBonus(t));
    expect(differ).toHaveLength(8);
  });

  test('zero and small values stay sane', () => {
    expect(augmentBonus(0)).toBe(0);
    expect(augmentBonus(1)).toBe(1);
    expect(augmentBonus(5)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// skillBonusHooks  (v1.4.311)
//
// Mirror of deriveSkillTotals (module/data/ActorData.js), which is the single
// consumption point and is Foundry-coupled (reads CONFIG, iterates
// actor.items, writes onto the TypeDataModel proxy). computeSkillTotal and
// sumHookContributions are imported for real, so what is mirrored here is the
// LOOP and its two contracts — where storedTotal comes from, and that nothing
// is persisted.
//
// If deriveSkillTotals changes, update this mirror to match.
// ---------------------------------------------------------------------------

/** Mirror of deriveSkillTotals' per-item loop. */
function applySkillBonusHooks(hooks, actor, chars) {
  for (const item of actor.items) {
    if (!SKILL_ITEM_TYPES.includes(item.type)) continue;
    const sys = item.system;
    const { total: hookSum } = sumHookContributions(hooks, [actor, item], { errorLabel: 'skillBonusHook' });
    const { baseValue, total } = computeSkillTotal({
      baseFormula: sys.baseFormula,
      // _source, never sys.total — see the call site's own comment.
      storedTotal: item._source?.system?.total ?? 0,
      bonusPoints: sys.bonusPoints ?? 0,
      chars,
      hookSum
    });
    sys.baseValue = baseValue;
    sys.total     = total;
  }
  return actor;
}

/** Build a fake owned item with a source/derived split, as Foundry has. */
function makeSkillItem({ id = 'i1', type = 'skill', name = 'Brawn', baseFormula = 'STR+SIZ', bonusPoints = 0, storedTotal = 0, category = 'standard' } = {}) {
  return {
    id, type, name,
    _source: { system: { baseFormula, bonusPoints, total: storedTotal } },
    system:  { baseFormula, bonusPoints, total: storedTotal, baseValue: 0, category }
  };
}

const SKILL_CHARS = { STR: 12, CON: 11, SIZ: 13, DEX: 14, INT: 15, POW: 10, CHA: 9 };

describe('skillBonusHooks', () => {
  test('no hooks registered is a true no-op: base formula + bonusPoints, unchanged', () => {
    const actor = { items: [makeSkillItem({ bonusPoints: 20 })] };
    applySkillBonusHooks([], actor, SKILL_CHARS);
    expect(actor.items[0].system.total).toBe(45);      // (12+13) + 20
    expect(actor.items[0].system.baseValue).toBe(25);
  });

  test('a single hook adds its contribution', () => {
    const actor = { items: [makeSkillItem({ bonusPoints: 20 })] };
    applySkillBonusHooks([() => 5], actor, SKILL_CHARS);
    expect(actor.items[0].system.total).toBe(50);
  });

  test('multiple hooks are SUMMED, not first-wins or last-wins', () => {
    const actor = { items: [makeSkillItem({ bonusPoints: 20 })] };
    applySkillBonusHooks([() => 5, () => 10, () => 1], actor, SKILL_CHARS);
    expect(actor.items[0].system.total).toBe(61);      // 45 + 16
  });

  test('registration order does not affect the result', () => {
    // The regression guard v1.4.307 established, after bashKnockbackMultiplier
    // turned out to be last-registered-wins by plain assignment.
    const run = hooks => {
      const actor = { items: [makeSkillItem({ bonusPoints: 20 })] };
      applySkillBonusHooks(hooks, actor, SKILL_CHARS);
      return actor.items[0].system.total;
    };
    const a = () => 5, b = () => 10, c = () => 1;
    expect(run([a, b, c])).toBe(run([c, b, a]));
    expect(run([b, a, c])).toBe(run([a, c, b]));
  });

  test('a throwing hook is isolated — the others still land', () => {
    const actor = { items: [makeSkillItem({ bonusPoints: 20 })] };
    const boom = () => { throw new Error('module bug'); };
    applySkillBonusHooks([() => 5, boom, () => 10], actor, SKILL_CHARS);
    expect(actor.items[0].system.total).toBe(60);      // 45 + 15, boom contributes 0
  });

  test('a non-numeric return contributes 0 rather than NaN', () => {
    const actor = { items: [makeSkillItem({ bonusPoints: 20 })] };
    applySkillBonusHooks([() => 'lots', () => undefined, () => 5], actor, SKILL_CHARS);
    expect(actor.items[0].system.total).toBe(50);
  });

  test('the hook receives the actor and the ITEM, not a skill name', () => {
    // The design choice that lets a consumer tell Combat Style (Fighter) from
    // Combat Style (Thief), and express "all professional skills" itself.
    const seen = [];
    const actor = { items: [makeSkillItem({ name: 'Combat Style (Fighter)', type: 'combat-style' })] };
    applySkillBonusHooks([(a, item) => { seen.push([a, item]); return 0; }], actor, SKILL_CHARS);
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toBe(actor);
    expect(seen[0][1]).toBe(actor.items[0]);
    expect(seen[0][1].name).toBe('Combat Style (Fighter)');
    expect(seen[0][1].type).toBe('combat-style');
  });

  test('a consumer can discriminate by category — predicate scope needs no extra machinery', () => {
    const actor = { items: [
      makeSkillItem({ id: 'a', name: 'Brawn',       category: 'standard'     }),
      makeSkillItem({ id: 'b', name: 'Engineering', category: 'professional' })
    ] };
    applySkillBonusHooks([(a, item) => item.system.category === 'professional' ? 10 : 0], actor, SKILL_CHARS);
    expect(actor.items[0].system.total).toBe(25);      // standard, untouched
    expect(actor.items[1].system.total).toBe(35);      // professional, +10
  });

  test('Classic Fantasy Combat Proficiency: +5% to Combat Style AND Unarmed, nothing else', () => {
    // cf p50 as revised uc p17. The published mechanic this seam was built for.
    const actor = { items: [
      makeSkillItem({ id: 'a', name: 'Combat Style (Fighter)', type: 'combat-style' }),
      makeSkillItem({ id: 'b', name: 'Unarmed' }),
      makeSkillItem({ id: 'c', name: 'Athletics' })
    ] };
    const combatProficiency = (a, item) =>
      (item.type === 'combat-style' || item.name === 'Unarmed') ? 5 : 0;
    applySkillBonusHooks([combatProficiency], actor, SKILL_CHARS);
    expect(actor.items[0].system.total).toBe(30);
    expect(actor.items[1].system.total).toBe(30);
    expect(actor.items[2].system.total).toBe(25);
  });

  test('non-skill items on the actor are skipped entirely', () => {
    const weapon = { id: 'w', type: 'weapon', _source: { system: {} }, system: { total: 999 } };
    const actor = { items: [weapon, makeSkillItem()] };
    applySkillBonusHooks([() => 5], actor, SKILL_CHARS);
    expect(weapon.system.total).toBe(999);             // untouched
  });

  test('statblock item (no baseFormula) keeps its stored total and still takes the hook', () => {
    const actor = { items: [makeSkillItem({ baseFormula: '', storedTotal: 80 })] };
    applySkillBonusHooks([() => 5], actor, SKILL_CHARS);
    expect(actor.items[0].system.total).toBe(85);
  });

  test('DERIVATION IS IDEMPOTENT — repeated passes do not accumulate', () => {
    // The trap this guards: reading storedTotal back off `sys.total` (which
    // the previous pass just overwrote) instead of off `_source` would re-add
    // the hook sum every prepare and the number would climb without bound.
    // Same accumulation trap powerPointsHooks' call site documents for `+=`.
    const actor = { items: [makeSkillItem({ baseFormula: '', storedTotal: 80 })] };
    applySkillBonusHooks([() => 5], actor, SKILL_CHARS);
    applySkillBonusHooks([() => 5], actor, SKILL_CHARS);
    applySkillBonusHooks([() => 5], actor, SKILL_CHARS);
    expect(actor.items[0].system.total).toBe(85);      // not 90, not 95
  });

  test('NOTHING IS PERSISTED — _source is untouched after derivation', () => {
    // The contract that makes this seam safe at all. If a contribution were
    // written to stored data, uninstalling a module would leave every affected
    // skill permanently inflated with no record of why. See
    // skill-bonus-seam-design.md section 1a. Do not delete this test.
    const actor = { items: [makeSkillItem({ bonusPoints: 20, storedTotal: 45 })] };
    applySkillBonusHooks([() => 5], actor, SKILL_CHARS);
    expect(actor.items[0].system.total).toBe(50);          // derived, with hook
    expect(actor.items[0]._source.system.total).toBe(45);  // stored, without
    expect(actor.items[0]._source.system.bonusPoints).toBe(20);
  });

  test('a bonused passion augments harder — the documented knock-on', () => {
    // PassionData#augmentBonus is ceil(total * 0.2) and derives from `total`,
    // so a hook that raises a passion also raises what it augments for.
    const actor = { items: [makeSkillItem({ type: 'passion', baseFormula: '', storedTotal: 33 })] };
    const augment = t => Math.ceil(t * 0.2);
    expect(augment(actor.items[0].system.total)).toBe(7);   // the rulebook's worked example
    applySkillBonusHooks([() => 7], actor, SKILL_CHARS);
    expect(actor.items[0].system.total).toBe(40);
    expect(augment(actor.items[0].system.total)).toBe(8);
  });

  test('an actor with no items does not throw', () => {
    expect(() => applySkillBonusHooks([() => 5], { items: [] }, SKILL_CHARS)).not.toThrow();
  });
});
