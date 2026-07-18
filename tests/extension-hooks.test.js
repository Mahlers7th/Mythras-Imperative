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
