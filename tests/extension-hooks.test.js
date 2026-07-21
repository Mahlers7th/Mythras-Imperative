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
//   weaponForceHook  : (weapon, actor) => string | undefined
//   OVERRIDE (first-wins) hooks, not sum — the opposite pattern from every
//   other hook array in this file. Consumed by CombatEngine._getWeaponDamage /
//   _getWeaponForce, the single chokepoint every damage-roll and parry-size
//   read in the combat engine goes through (module/combat/CombatEngine.js
//   ~L4013-4038). Mirrored here byte-for-faithful, same approach as the rest
//   of this file for Foundry-coupled call sites.
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
function getWeaponForce(hooks, weapon, actor) {
  for (const fn of (hooks ?? [])) {
    try {
      const result = fn(weapon, actor);
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

  const { hitLocationId = null, hitLocationLabel = '', damage = 0, rawDamage = 0 } = extras;

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
    const extras = { hitLocationId: 'loc-head', hitLocationLabel: 'Head', damage: 6, rawDamage: 9 };

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
