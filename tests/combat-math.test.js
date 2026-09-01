/**
 * tests/combat-math.test.js
 *
 * Jest tests for module/utils/combat-math.js
 * All functions are pure — no mocks required.
 */

import {
  determineOutcome,
  resolveOpposedRoll,
  resolveDifferential,
  resolveParryReduction,
  woundLevel,
  woundState,
  resolveWoundSync,
  stepUpDamageModifier,
  shiftDamageModifier,
  getImpaleGrade,
  resolveBashSizGate,
  DM_TABLE,
  weaponBaseMax,
  compareInitiative,
  initiativeTieBreakSeed,
  resolveLossOfControl,
  LOSS_OF_CONTROL_TABLE,
  shiftSpeedStep,
  SPEED_STEPS,
  MAX_SPEED_FOR_SIZE,
  getMaxSpeedForSize,
  computeEffectiveSpeed
} from '../module/utils/combat-math.js';

// =============================================================================
// determineOutcome
// =============================================================================

describe('determineOutcome', () => {
  describe('fumble', () => {
    test('100 is always a fumble', () => {
      expect(determineOutcome(100, 60, 60)).toBe('fumble');
    });
    test('99 is fumble when rawSkill < 100', () => {
      expect(determineOutcome(99, 60, 60)).toBe('fumble');
    });
    test('99 is NOT fumble when rawSkill is ABOVE 100 (but still Failure — the 96-00 ceiling)', () => {
      // v1.4.313: boundary corrected from >= 100 to > 100 against rules p.18
      // ("skills with a value of MORE THAN 100%"). Exactly 100 now fumbles on
      // 99; see roll-math.test.js for the citation and the corroborating
      // "in excess of 100%" phrasing at p.51.
      expect(determineOutcome(99, 101, 101)).toBe('failure');
      expect(determineOutcome(99, 100, 100)).toBe('fumble');
    });
    test('98 is never a fumble', () => {
      expect(determineOutcome(98, 50, 50)).toBe('failure');
    });
  });

  describe('critical', () => {
    test('1 is always critical', () => {
      expect(determineOutcome(1, 50, 50)).toBe('critical');
    });
    test('critical threshold is ceil(target/10)', () => {
      // target 50 → crit ≤ 5
      expect(determineOutcome(5, 50, 50)).toBe('critical');
      expect(determineOutcome(6, 50, 50)).toBe('success');
    });
    test('target 35 → crit threshold 4', () => {
      expect(determineOutcome(4, 35, 35)).toBe('critical');
      expect(determineOutcome(5, 35, 35)).toBe('success');
    });
    test('target 10 → crit threshold 1', () => {
      expect(determineOutcome(1, 10, 10)).toBe('critical');
      expect(determineOutcome(2, 10, 10)).toBe('success');
    });
    test('target 100 → crit threshold 10', () => {
      expect(determineOutcome(10, 100, 100)).toBe('critical');
      expect(determineOutcome(11, 100, 100)).toBe('success');
    });
  });

  describe('success / failure boundary', () => {
    test('rolling exactly target is success', () => {
      expect(determineOutcome(50, 50, 50)).toBe('success');
    });
    test('rolling target+1 is failure', () => {
      expect(determineOutcome(51, 50, 50)).toBe('failure');
    });
    test('skill 01 — 1 is critical, 2-5 are Success via the floor, 6+ fail', () => {
      expect(determineOutcome(1, 1, 1)).toBe('critical');
      expect(determineOutcome(2, 1, 1)).toBe('success'); // rules p.18 floor
      expect(determineOutcome(5, 1, 1)).toBe('success'); // rules p.18 floor
      expect(determineOutcome(6, 1, 1)).toBe('failure');
    });
  });

  describe('01-05 auto-success floor (rules p.18)', () => {
    test('a roll of 01-05 is always Success even against a near-zero skill', () => {
      expect(determineOutcome(3, 0, 0)).toBe('success');
      expect(determineOutcome(5, 2, 2)).toBe('success');
    });
    test('does not override a Critical (critical is already at least as good)', () => {
      expect(determineOutcome(3, 50, 50)).toBe('critical');
    });
    test('does not apply above 05', () => {
      expect(determineOutcome(6, 0, 0)).toBe('failure');
    });
  });

  describe('96-00 auto-failure ceiling (rules p.18)', () => {
    test('a roll of 96-99 is always Failure even against a very high skill', () => {
      expect(determineOutcome(97, 150, 150)).toBe('failure');
      expect(determineOutcome(96, 200, 200)).toBe('failure');
    });
    test('a Fumble in that range still takes priority over the ceiling', () => {
      expect(determineOutcome(99, 60, 60)).toBe('fumble');
    });
    test('does not apply below 96 — a roll of 95 against a target of 95 still succeeds', () => {
      expect(determineOutcome(95, 95, 95)).toBe('success');
    });
  });
});

// =============================================================================
// resolveOpposedRoll
// =============================================================================

describe('resolveOpposedRoll', () => {
  test('defender critical beats attacker success → defender wins', () => {
    // attacker: roll 20, skill 50 → success
    // defender: roll 3,  skill 50 → critical
    expect(resolveOpposedRoll(20, 50, 3, 50)).toBe(true);
  });

  test('attacker critical beats defender success → attacker wins', () => {
    expect(resolveOpposedRoll(3, 50, 20, 50)).toBe(false);
  });

  test('both fail → attacker wins (effect applies)', () => {
    expect(resolveOpposedRoll(80, 50, 90, 50)).toBe(false);
  });

  test('both fumble → attacker wins', () => {
    expect(resolveOpposedRoll(99, 50, 99, 50)).toBe(false);
  });

  test('both succeed at same level: higher roll wins → defender wins if higher', () => {
    // attacker roll 20, defender roll 30 — both successes against skill 50
    expect(resolveOpposedRoll(20, 50, 30, 50)).toBe(true);
  });

  test('both succeed at same level: higher roll wins → attacker wins if higher', () => {
    expect(resolveOpposedRoll(30, 50, 20, 50)).toBe(false);
  });

  test('both critical at same level: higher roll wins', () => {
    // attacker roll 3, defender roll 4 — both crits against skill 50
    expect(resolveOpposedRoll(3, 50, 4, 50)).toBe(true);
    expect(resolveOpposedRoll(4, 50, 3, 50)).toBe(false);
  });
});

// =============================================================================
// resolveDifferential
// =============================================================================

describe('resolveDifferential', () => {
  test('critical vs critical → no benefit', () => {
    expect(resolveDifferential('critical', 'critical')).toEqual({ seWinner: 'none', seCount: 0 });
  });
  test('critical vs success → attacker 1 SE', () => {
    expect(resolveDifferential('critical', 'success')).toEqual({ seWinner: 'attacker', seCount: 1 });
  });
  test('critical vs failure → attacker 2 SE', () => {
    expect(resolveDifferential('critical', 'failure')).toEqual({ seWinner: 'attacker', seCount: 2 });
  });
  test('critical vs fumble → attacker 3 SE', () => {
    expect(resolveDifferential('critical', 'fumble')).toEqual({ seWinner: 'attacker', seCount: 3 });
  });
  test('success vs critical → defender 1 SE', () => {
    expect(resolveDifferential('success', 'critical')).toEqual({ seWinner: 'defender', seCount: 1 });
  });
  test('success vs success → no benefit', () => {
    expect(resolveDifferential('success', 'success')).toEqual({ seWinner: 'none', seCount: 0 });
  });
  test('success vs failure → attacker 1 SE', () => {
    expect(resolveDifferential('success', 'failure')).toEqual({ seWinner: 'attacker', seCount: 1 });
  });
  test('failure vs critical → defender 2 SE', () => {
    expect(resolveDifferential('failure', 'critical')).toEqual({ seWinner: 'defender', seCount: 2 });
  });
  test('fumble vs critical → defender 3 SE', () => {
    expect(resolveDifferential('fumble', 'critical')).toEqual({ seWinner: 'defender', seCount: 3 });
  });
  test('failure vs failure → no benefit', () => {
    expect(resolveDifferential('failure', 'failure')).toEqual({ seWinner: 'none', seCount: 0 });
  });
  test('success vs none (undefended) → attacker 1 SE', () => {
    expect(resolveDifferential('success', 'none')).toEqual({ seWinner: 'attacker', seCount: 1 });
  });
  test('critical vs none (undefended) → attacker 2 SE', () => {
    expect(resolveDifferential('critical', 'none')).toEqual({ seWinner: 'attacker', seCount: 2 });
  });
});

// =============================================================================
// resolveParryReduction
// =============================================================================

describe('resolveParryReduction', () => {
  test('equal size → full block', () => {
    expect(resolveParryReduction('M', 'M')).toEqual({ multiplier: 0, label: 'full' });
  });
  test('defence larger → full block', () => {
    expect(resolveParryReduction('M', 'L')).toEqual({ multiplier: 0, label: 'full' });
  });
  test('attack one step larger → half damage', () => {
    expect(resolveParryReduction('L', 'M')).toEqual({ multiplier: 0.5, label: 'half' });
  });
  test('attack two steps larger → no reduction', () => {
    expect(resolveParryReduction('H', 'M')).toEqual({ multiplier: 1, label: 'none' });
  });
  test('defensiveMinded steps up defence size', () => {
    // S defence + defensiveMinded → M; M attack vs M = full block
    expect(resolveParryReduction('M', 'S', { defensiveMinded: true }))
      .toEqual({ multiplier: 0, label: 'full' });
  });
  test('unarmedProwess floors unarmed to M', () => {
    // S unarmed + unarmedProwess → M; M attack = full block
    expect(resolveParryReduction('M', 'S', { unarmedProwess: true, defIsUnarmed: true }))
      .toEqual({ multiplier: 0, label: 'full' });
  });
  test('ranged long range reduces attack size by 1', () => {
    // H attack at long → H-1 = L; M defence; L vs M = half
    expect(resolveParryReduction('H', 'M', { isRanged: true, rangeBandLong: true }))
      .toEqual({ multiplier: 0.5, label: 'half' });
  });
  test('S attack vs S defence → full block', () => {
    expect(resolveParryReduction('S', 'S')).toEqual({ multiplier: 0, label: 'full' });
  });
  test('E attack vs S defence → no reduction (4 steps)', () => {
    expect(resolveParryReduction('E', 'S')).toEqual({ multiplier: 1, label: 'none' });
  });
});

// =============================================================================
// woundLevel
// =============================================================================

describe('woundLevel', () => {
  test('zero damage → none', () => {
    expect(woundLevel(0, 5, 5)).toBe('none');
  });
  test('negative damage → none', () => {
    expect(woundLevel(-1, 5, 5)).toBe('none');
  });
  test('minor: damage reduces HP but location stays positive', () => {
    // maxHp=5, current after = 2
    expect(woundLevel(3, 5, 2)).toBe('minor');
  });
  test('serious: current HP reaches exactly 0', () => {
    expect(woundLevel(5, 5, 0)).toBe('serious');
  });
  test('serious: current HP goes negative but not below -maxHp', () => {
    // maxHp=5, current=-3 (> -5)
    expect(woundLevel(8, 5, -3)).toBe('serious');
  });
  test('major: current HP reaches exactly -maxHp', () => {
    expect(woundLevel(10, 5, -5)).toBe('major');
  });
  test('major: current HP below -maxHp', () => {
    expect(woundLevel(12, 5, -7)).toBe('major');
  });
  test('major: 1 damage on location with maxHp=1 and current goes to -1', () => {
    // maxHp=1, current after = -1 which equals -maxHp
    expect(woundLevel(2, 1, -1)).toBe('major');
  });
});

// =============================================================================
// woundState
// =============================================================================

describe('woundState', () => {
  test('at max HP → none', () => {
    expect(woundState(5, 5)).toBe('none');
  });
  test('above max HP (overheal) → none, not a crash', () => {
    expect(woundState(7, 5)).toBe('none');
  });
  test('below max but positive → minor', () => {
    expect(woundState(2, 5)).toBe('minor');
  });
  test('one HP below max → minor, not none — a location that hasn\'t healed all the way is still wounded', () => {
    expect(woundState(4, 5)).toBe('minor');
  });
  test('exactly zero → serious', () => {
    expect(woundState(0, 5)).toBe('serious');
  });
  test('negative but above -maxHp → serious', () => {
    expect(woundState(-3, 5)).toBe('serious');
  });
  test('exactly -maxHp → major', () => {
    expect(woundState(-5, 5)).toBe('major');
  });
  test('below -maxHp → major', () => {
    expect(woundState(-7, 5)).toBe('major');
  });
  test('agrees with woundLevel at the moment of injury (same thresholds, different question)', () => {
    // A fresh hit taking a 5-max location to each threshold should classify
    // identically whether asked "what did this hit cause" or "what state is
    // this location in right now" — they're the same thresholds by design.
    for (const newCurrent of [5, 2, 0, -3, -5, -7]) {
      const damage = 5 - newCurrent; // damage needed to reach newCurrent from full
      const eventResult = damage > 0 ? woundLevel(damage, 5, newCurrent) : 'none';
      const stateResult = woundState(newCurrent, 5);
      expect(stateResult).toBe(eventResult);
    }
  });
  test('healing back above zero clears Serious — the bug this function fixes', () => {
    // A location healed from -2 (serious) back to +2 must read as minor, not
    // stay stuck at serious — that staleness is exactly what a preUpdateItem
    // hook now prevents by calling this function on every current-HP change.
    expect(woundState(-2, 5)).toBe('serious');
    expect(woundState(2, 5)).toBe('minor');
  });
  test('maxHp of 0 does not throw or misclassify', () => {
    expect(woundState(0, 0)).toBe('none');
    expect(woundState(-1, 0)).toBe('major');
  });
});

// =============================================================================
// resolveWoundSync — the preUpdateItem hook's decision core (mythras.mjs),
// extracted here so its branching is unit-tested directly rather than only
// live-verified. See its own doc comment in combat-math.js for why this
// fires for every hit-location update rather than only known write sites.
// =============================================================================

describe('resolveWoundSync', () => {
  test('bare current write on a hit-location item: computes wound via woundState', () => {
    // 4 of 10, no explicit wound supplied -> classify from current alone.
    expect(resolveWoundSync('hit-location', 10, 4, undefined)).toBe('minor');
  });

  test('bare current write to exactly max: classifies none', () => {
    expect(resolveWoundSync('hit-location', 10, 10, undefined)).toBe('none');
  });

  test('bare current write at or below zero: classifies serious/major correctly', () => {
    expect(resolveWoundSync('hit-location', 10, 0, undefined)).toBe('serious');
    expect(resolveWoundSync('hit-location', 10, -10, undefined)).toBe('major');
  });

  test('explicit wound supplied alongside current: defers to the caller, returns undefined', () => {
    // current=2 alone would classify 'minor' via woundState, but the caller
    // already claimed 'serious' in the same update -- must not be overridden.
    expect(resolveWoundSync('hit-location', 10, 2, 'serious')).toBeUndefined();
  });

  test('wound-only update (current not part of the changed data): no-op, returns undefined', () => {
    // Simulates a GM directly picking a value in the wound dropdown, with no
    // system.current in the same update -- nothing to classify from.
    expect(resolveWoundSync('hit-location', 10, undefined, undefined)).toBeUndefined();
  });

  test('wound-only update where the caller also supplies a wound value: still undefined either way', () => {
    expect(resolveWoundSync('hit-location', 10, undefined, 'major')).toBeUndefined();
  });

  test('non-hit-location item: never acts, regardless of what current/wound would imply', () => {
    expect(resolveWoundSync('weapon', 10, 4, undefined)).toBeUndefined();
    expect(resolveWoundSync('armour', 10, 0, undefined)).toBeUndefined();
    expect(resolveWoundSync(undefined, 10, 4, undefined)).toBeUndefined();
  });

  test('agrees with woundState for every threshold, since it delegates rather than re-deriving', () => {
    for (const current of [10, 6, 4, 0, -3, -10, -15]) {
      expect(resolveWoundSync('hit-location', 10, current, undefined)).toBe(woundState(current, 10));
    }
  });

  test('the exact healed-past-Serious case this function exists to fix, expressed as a scenario', () => {
    // A location damaged to 'serious' (current=0), then a later, independent
    // update heals it to 6 of 10 with no wound field touched by the healer --
    // resolveWoundSync must reclassify to 'minor', not leave it stale.
    expect(resolveWoundSync('hit-location', 10, 0, undefined)).toBe('serious');
    expect(resolveWoundSync('hit-location', 10, 6, undefined)).toBe('minor');
  });
});

// =============================================================================
// stepUpDamageModifier
// =============================================================================

describe('stepUpDamageModifier', () => {
  test('steps +0 up to +1d2', () => {
    expect(stepUpDamageModifier('+0')).toBe('+1d2');
  });
  test('steps -1d2 up to +0', () => {
    expect(stepUpDamageModifier('-1d2')).toBe('+0');
  });
  test('steps +1d6 up to +1d8', () => {
    expect(stepUpDamageModifier('+1d6')).toBe('+1d8');
  });
  test('max value (+2d12) cannot step further', () => {
    expect(stepUpDamageModifier('+2d12')).toBe('+2d12');
  });
  test('min value (-1d8) steps up to -1d6', () => {
    expect(stepUpDamageModifier('-1d8')).toBe('-1d6');
  });
  test('empty string treated as +0', () => {
    expect(stepUpDamageModifier('')).toBe('+1d2');
  });
  test('unknown value returned unchanged', () => {
    expect(stepUpDamageModifier('+99d99')).toBe('+99d99');
  });
  test('DM_TABLE has 15 entries', () => {
    expect(DM_TABLE).toHaveLength(15);
  });
});

// =============================================================================
// shiftDamageModifier
// =============================================================================

describe('shiftDamageModifier', () => {
  test('stepUpDamageModifier is a thin wrapper over shiftDamageModifier(dm, 1)', () => {
    for (const dm of ['+0', '-1d2', '+1d6', '+2d12', '-1d8', '', '+99d99']) {
      expect(stepUpDamageModifier(dm)).toBe(shiftDamageModifier(dm, 1));
    }
  });

  test('positive multi-step shift', () => {
    expect(shiftDamageModifier('+0', 2)).toBe('+1d4');
  });

  test('negative multi-step shift', () => {
    expect(shiftDamageModifier('+1d6', -2)).toBe('+1d2');
  });

  test('zero-step shift returns the same table entry unchanged', () => {
    expect(shiftDamageModifier('+1d8', 0)).toBe('+1d8');
  });

  test('clamps at the top of the table, does not overflow', () => {
    expect(shiftDamageModifier('+2d10', 5)).toBe('+2d12');
  });

  test('clamps at the bottom of the table, does not underflow', () => {
    expect(shiftDamageModifier('-1d6', -5)).toBe('-1d8');
  });

  test('large positive and negative shifts both clamp correctly from the middle', () => {
    expect(shiftDamageModifier('+0', 99)).toBe('+2d12');
    expect(shiftDamageModifier('+0', -99)).toBe('-1d8');
  });

  test('empty string treated as +0 before shifting', () => {
    expect(shiftDamageModifier('', 1)).toBe('+1d2');
    expect(shiftDamageModifier('0', 1)).toBe('+1d2');
  });

  test('unrecognized DM string passes through unchanged regardless of steps', () => {
    expect(shiftDamageModifier('+99d99', 3)).toBe('+99d99');
    expect(shiftDamageModifier('garbage', -3)).toBe('garbage');
  });
});

// =============================================================================
// resolveBashSizGate — Bash's "twice the attacker's SIZ" limit, and CFI's
// Brace Combat Action ("Against the Bash Special Effect, SIZ is doubled").
// =============================================================================

describe('resolveBashSizGate', () => {
  describe('unbraced — the base rule', () => {
    test('equal SIZ is well within the limit', () => {
      const r = resolveBashSizGate(15, 15);
      expect(r).toEqual({ effectiveSIZ: 15, sizLimit: 30, tooBig: false });
    });

    test('exactly twice the attacker SIZ is NOT too big — the limit is inclusive', () => {
      // tooBig is `>` not `>=`: a SIZ 30 defender vs a SIZ 15 attacker sits
      // exactly on the limit and can still be knocked back.
      expect(resolveBashSizGate(15, 30).tooBig).toBe(false);
    });

    test('one point over the limit is too big', () => {
      expect(resolveBashSizGate(15, 31).tooBig).toBe(true);
    });
  });

  describe('braced — CFI Brace doubles the defender SIZ', () => {
    test('a defender who was bashable becomes too big', () => {
      // SIZ 20 vs a SIZ 15 attacker: 20 <= 30, so normally bashable.
      expect(resolveBashSizGate(15, 20).tooBig).toBe(false);
      // Braced, the same defender compares as SIZ 40 against the same limit.
      const braced = resolveBashSizGate(15, 20, true);
      expect(braced.effectiveSIZ).toBe(40);
      expect(braced.sizLimit).toBe(30);
      expect(braced.tooBig).toBe(true);
    });

    test('bracing does not move the attacker-derived limit', () => {
      // The limit is a property of the attacker only; Brace must not touch it.
      expect(resolveBashSizGate(15, 20, true).sizLimit)
        .toBe(resolveBashSizGate(15, 20, false).sizLimit);
    });

    test('bracing is not always enough against a much larger attacker', () => {
      // SIZ 10 defender braced = 20, vs a SIZ 40 attacker's limit of 80.
      expect(resolveBashSizGate(40, 10, true).tooBig).toBe(false);
    });

    test('only an explicit true braces — a truthy value is not enough', () => {
      // ctx.isBraced is compared strictly at the call site; mirror that here so
      // an undefined/absent flag can never accidentally grant the stance.
      expect(resolveBashSizGate(15, 20, 'yes').effectiveSIZ).toBe(20);
      expect(resolveBashSizGate(15, 20, 1).effectiveSIZ).toBe(20);
      expect(resolveBashSizGate(15, 20, undefined).effectiveSIZ).toBe(20);
    });
  });

  describe('bad input', () => {
    test('non-numeric SIZ values coerce to 0 rather than producing NaN', () => {
      expect(resolveBashSizGate(undefined, undefined))
        .toEqual({ effectiveSIZ: 0, sizLimit: 0, tooBig: false });
      expect(resolveBashSizGate('abc', 'def').tooBig).toBe(false);
    });
  });
});

// =============================================================================
// getImpaleGrade
// =============================================================================

describe('getImpaleGrade', () => {
  test('Small weapon vs SIZ 5 → formidable', () => {
    expect(getImpaleGrade('S', 5)).toBe('formidable');
  });
  test('Medium weapon vs SIZ 5 → herculean', () => {
    expect(getImpaleGrade('M', 5)).toBe('herculean');
  });
  test('Large weapon vs SIZ 5 → incapacitated', () => {
    expect(getImpaleGrade('L', 5)).toBe('incapacitated');
  });
  test('Medium weapon vs SIZ 13 (average human) → formidable', () => {
    expect(getImpaleGrade('M', 13)).toBe('formidable');
  });
  test('Small weapon vs SIZ 15 → none', () => {
    expect(getImpaleGrade('S', 21)).toBe('none');
  });
  test('Large weapon vs SIZ 25 → formidable', () => {
    expect(getImpaleGrade('L', 25)).toBe('formidable');
  });
  test('Enormous weapon vs SIZ 35 → herculean', () => {
    expect(getImpaleGrade('E', 35)).toBe('herculean');
  });
  test('Medium weapon vs SIZ 50 boundary → none', () => {
    expect(getImpaleGrade('M', 41)).toBe('none');
  });
  test('Large weapon vs SIZ 51 (beyond table) shifts easier', () => {
    // SIZ 51 → 1 step beyond 50 → L shifts to M column from row[4]
    // row[4]: M = 'none'
    expect(getImpaleGrade('L', 51)).toBe('none');
  });
  test('Enormous weapon vs SIZ 60 → formidable (shifted 1 step)', () => {
    // row[4]: E='formidable', +10 beyond 50 → 1 step easier → H='hard'
    expect(getImpaleGrade('E', 60)).toBe('hard');
  });
  test('defaults to M size when size omitted', () => {
    expect(getImpaleGrade(null, 13)).toBe('formidable');
  });
});

// ---------------------------------------------------------------------------
// weaponBaseMax
// ---------------------------------------------------------------------------

describe('weaponBaseMax', () => {
  test('1d6 → 6',        () => expect(weaponBaseMax('1d6')).toBe(6));
  test('1d8 → 8',        () => expect(weaponBaseMax('1d8')).toBe(8));
  test('1d6+1 → 7',      () => expect(weaponBaseMax('1d6+1')).toBe(7));
  test('1d8+1 → 9',      () => expect(weaponBaseMax('1d8+1')).toBe(9));
  test('2d4+2 → 10',     () => expect(weaponBaseMax('2d4+2')).toBe(10));
  test('1d10 → 10',      () => expect(weaponBaseMax('1d10')).toBe(10));
  test('1d4-1 → 3',      () => expect(weaponBaseMax('1d4-1')).toBe(3));
  test('spaces trimmed', () => expect(weaponBaseMax('1d6 + 1')).toBe(7));
  test('empty string → 0', () => expect(weaponBaseMax('')).toBe(0));
  test('null → 0',         () => expect(weaponBaseMax(null)).toBe(0));
  test('invalid → 0',      () => expect(weaponBaseMax('big')).toBe(0));

  // Bodkin reduction: Math.ceil(weaponBaseMax / 2)
  test('Bodkin 1d6+1: ceil(7/2) = 4', () => expect(Math.ceil(weaponBaseMax('1d6+1') / 2)).toBe(4));
  test('Bodkin 1d8:   ceil(8/2) = 4', () => expect(Math.ceil(weaponBaseMax('1d8')   / 2)).toBe(4));
  test('Bodkin 1d10:  ceil(10/2) = 5',() => expect(Math.ceil(weaponBaseMax('1d10')  / 2)).toBe(5));
  test('Bodkin 1d6:   ceil(6/2) = 3', () => expect(Math.ceil(weaponBaseMax('1d6')   / 2)).toBe(3));
  test('Bodkin 2d6:   ceil(12/2) = 6',() => expect(Math.ceil(weaponBaseMax('2d6')   / 2)).toBe(6));
});

// ---------------------------------------------------------------------------
// Initiative tie-break (rules p.35)
// ---------------------------------------------------------------------------

describe('compareInitiative', () => {
  test('higher initiative acts first, regardless of DEX/seed', () => {
    const a = { initiative: 15, dex: 5,  seed: 'a', id: 'a' };
    const b = { initiative: 20, dex: 99, seed: 'b', id: 'b' };
    expect(compareInitiative(a, b)).toBeGreaterThan(0); // b sorts first
  });

  test('tied initiative: higher DEX acts first', () => {
    const a = { initiative: 15, dex: 10, seed: 'a', id: 'a' };
    const b = { initiative: 15, dex: 16, seed: 'b', id: 'b' };
    expect(compareInitiative(a, b)).toBeGreaterThan(0); // b (higher DEX) first
  });

  test('tied initiative and DEX: falls back to the deterministic seed hash', () => {
    const a = { initiative: 15, dex: 12, seed: 'combat1:combatantA', id: 'a' };
    const b = { initiative: 15, dex: 12, seed: 'combat1:combatantB', id: 'b' };
    const result = compareInitiative(a, b);
    expect(result).not.toBe(0);
    // Stable: re-running the comparison produces the identical ordering.
    expect(compareInitiative(a, b)).toBe(result);
  });

  test('fully tied (identical seed) falls back to id comparison, never returns 0', () => {
    const a = { initiative: 15, dex: 12, seed: 'same', id: 'a' };
    const b = { initiative: 15, dex: 12, seed: 'same', id: 'b' };
    expect(compareInitiative(a, b)).toBe(-1); // 'a' < 'b'
    expect(compareInitiative(b, a)).toBe(1);
  });

  test('missing/non-finite initiative treated as -Infinity, not crashing', () => {
    const a = { initiative: undefined, dex: 10, seed: 'a', id: 'a' };
    const b = { initiative: 5, dex: 10, seed: 'b', id: 'b' };
    expect(compareInitiative(a, b)).toBeGreaterThan(0); // b sorts first
  });

  test('missing dex treated as lowest priority, not crashing', () => {
    const a = { initiative: 15, dex: undefined, seed: 'a', id: 'a' };
    const b = { initiative: 15, dex: 3, seed: 'b', id: 'b' };
    expect(compareInitiative(a, b)).toBeGreaterThan(0); // b (has DEX) first
  });
});

describe('initiativeTieBreakSeed', () => {
  test('same seed string always produces the same hash', () => {
    expect(initiativeTieBreakSeed('combat1:combatantA')).toBe(initiativeTieBreakSeed('combat1:combatantA'));
  });

  test('different seed strings produce different hashes (no trivial collision)', () => {
    expect(initiativeTieBreakSeed('combat1:combatantA')).not.toBe(initiativeTieBreakSeed('combat1:combatantB'));
  });

  test('always returns a non-negative integer', () => {
    expect(initiativeTieBreakSeed('anything')).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(initiativeTieBreakSeed('anything'))).toBe(true);
  });

  test('handles empty/undefined seed without throwing', () => {
    expect(() => initiativeTieBreakSeed('')).not.toThrow();
    expect(() => initiativeTieBreakSeed(undefined)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Loss of Control table (rules p.58)
// ---------------------------------------------------------------------------

describe('resolveLossOfControl', () => {
  test('exact 1d100 range boundaries map to the correct result, low to high severity', () => {
    expect(resolveLossOfControl(1).key).toBe('swerve');
    expect(resolveLossOfControl(25).key).toBe('swerve');
    expect(resolveLossOfControl(26).key).toBe('skid');
    expect(resolveLossOfControl(40).key).toBe('skid');
    expect(resolveLossOfControl(41).key).toBe('severeSkid');
    expect(resolveLossOfControl(50).key).toBe('severeSkid');
    expect(resolveLossOfControl(51).key).toBe('roll');
    expect(resolveLossOfControl(60).key).toBe('roll');
    expect(resolveLossOfControl(61).key).toBe('severeRoll');
    expect(resolveLossOfControl(70).key).toBe('severeRoll');
    expect(resolveLossOfControl(71).key).toBe('writeOff');
    expect(resolveLossOfControl(80).key).toBe('writeOff');
    expect(resolveLossOfControl(81).key).toBe('explosion');
    expect(resolveLossOfControl(90).key).toBe('explosion');
    expect(resolveLossOfControl(91).key).toBe('immediateExplosion');
    expect(resolveLossOfControl(98).key).toBe('immediateExplosion');
    expect(resolveLossOfControl(99).key).toBe('catastrophicCrash');
    expect(resolveLossOfControl(100).key).toBe('catastrophicCrash');
  });

  test('the 9 ranges are contiguous and exhaustive across 1-100', () => {
    for (let roll = 1; roll <= 100; roll++) {
      expect(resolveLossOfControl(roll)).toBeDefined();
    }
    // No gaps or overlaps: every table entry's own min/max is claimed by
    // exactly that entry when queried at its boundaries.
    for (const entry of LOSS_OF_CONTROL_TABLE) {
      expect(resolveLossOfControl(entry.min).key).toBe(entry.key);
      expect(resolveLossOfControl(entry.max).key).toBe(entry.key);
    }
  });

  test('clamps out-of-range input instead of returning undefined', () => {
    expect(resolveLossOfControl(0).key).toBe('swerve');
    expect(resolveLossOfControl(-5).key).toBe('swerve');
    expect(resolveLossOfControl(150).key).toBe('catastrophicCrash');
  });

  test('only Roll and above deal Structure damage or are a Write-Off', () => {
    for (const entry of LOSS_OF_CONTROL_TABLE) {
      const dealsStructureDamage = entry.structureFormula != null || entry.writeOff === true;
      if (['swerve', 'skid', 'severeSkid'].includes(entry.key)) {
        expect(dealsStructureDamage).toBe(false);
      } else {
        expect(dealsStructureDamage).toBe(true);
      }
    }
  });

  test('Write-Off, Explosion, Immediate Explosion, and Catastrophic Crash all reduce Structure to 0', () => {
    for (const key of ['writeOff', 'explosion', 'immediateExplosion', 'catastrophicCrash']) {
      expect(LOSS_OF_CONTROL_TABLE.find(e => e.key === key).writeOff).toBe(true);
    }
  });

  test('only Catastrophic Crash carries an instant-death check', () => {
    for (const entry of LOSS_OF_CONTROL_TABLE) {
      const instantDeath = entry.occupantDamage?.instantDeathOnFail === true;
      expect(instantDeath).toBe(entry.key === 'catastrophicCrash');
    }
  });

  test('only Immediate Explosion auto-applies burn damage', () => {
    for (const entry of LOSS_OF_CONTROL_TABLE) {
      expect(entry.burnAutomatic === true).toBe(entry.key === 'immediateExplosion');
    }
  });
});

// ---------------------------------------------------------------------------
// Vehicle Speed step shifting (rules p.54)
// ---------------------------------------------------------------------------

describe('shiftSpeedStep', () => {
  test('shifts forward within bounds', () => {
    expect(shiftSpeedStep('ponderous', 1)).toBe('sluggish');
    expect(shiftSpeedStep('moderate', 2)).toBe('fast');
  });

  test('shifts backward within bounds', () => {
    expect(shiftSpeedStep('fleet', -1)).toBe('fast');
    expect(shiftSpeedStep('moderate', -2)).toBe('mediocre');
  });

  test('clamps at the top (fleet) and bottom (ponderous)', () => {
    expect(shiftSpeedStep('fleet', 5)).toBe('fleet');
    expect(shiftSpeedStep('ponderous', -5)).toBe('ponderous');
  });

  test('zero steps is a no-op', () => {
    expect(shiftSpeedStep('gentle', 0)).toBe('gentle');
  });

  test('unrecognised speed values (e.g. a homebrew "supersonic") are returned unchanged', () => {
    expect(shiftSpeedStep('supersonic', 1)).toBe('supersonic');
    expect(shiftSpeedStep('supersonic', -3)).toBe('supersonic');
  });

  test('SPEED_STEPS has exactly the rulebook\'s 9 steps, in order', () => {
    expect(SPEED_STEPS).toEqual([
      'ponderous', 'sluggish', 'slow', 'mediocre', 'gentle',
      'moderate', 'rapid', 'fast', 'fleet'
    ]);
  });
});

// ---------------------------------------------------------------------------
// Max Speed by Size (rules p.55) and effective Speed (rules p.56)
// ---------------------------------------------------------------------------

describe('getMaxSpeedForSize', () => {
  test('matches the rulebook table for every printed size', () => {
    expect(getMaxSpeedForSize('small')).toBe('fast');
    expect(getMaxSpeedForSize('medium')).toBe('rapid');
    expect(getMaxSpeedForSize('large')).toBe('gentle');
    expect(getMaxSpeedForSize('huge')).toBe('slow');
    expect(getMaxSpeedForSize('enormous')).toBe('ponderous');
  });

  test('colossal is inferred no more permissive than enormous', () => {
    expect(getMaxSpeedForSize('colossal')).toBe('ponderous');
  });

  test('Enhanced Performance raises the cap by 1 step', () => {
    expect(getMaxSpeedForSize('small', { enhancedPerformance: true })).toBe('fleet');
    expect(getMaxSpeedForSize('enormous', { enhancedPerformance: true })).toBe('sluggish');
  });

  test('Rails raises the cap by 3 steps and wins over Enhanced Performance if both are set', () => {
    expect(getMaxSpeedForSize('enormous', { rails: true })).toBe('mediocre');
    expect(getMaxSpeedForSize('enormous', { rails: true, enhancedPerformance: true })).toBe('mediocre');
  });

  test('unrecognised size falls back to fleet (no cap) rather than guessing', () => {
    expect(getMaxSpeedForSize('unknown-size')).toBe('fleet');
  });

  test('MAX_SPEED_FOR_SIZE has an entry for all 6 canonical sizes', () => {
    expect(Object.keys(MAX_SPEED_FOR_SIZE).sort()).toEqual(
      ['colossal', 'enormous', 'huge', 'large', 'medium', 'small'].sort()
    );
  });
});

describe('computeEffectiveSpeed', () => {
  test('with no modifiers, effective speed equals base speed', () => {
    expect(computeEffectiveSpeed({ baseSpeed: 'moderate' })).toBe('moderate');
  });

  test('the rulebook\'s own worked example: Enormous vehicle, Speed Slow, 2 Drive hits -> Ponderous', () => {
    expect(computeEffectiveSpeed({ baseSpeed: 'slow', driveHitsTaken: 2 })).toBe('ponderous');
  });

  test('each Drive hit costs exactly 1 step, floored at ponderous', () => {
    expect(computeEffectiveSpeed({ baseSpeed: 'gentle', driveHitsTaken: 1 })).toBe('mediocre');
    expect(computeEffectiveSpeed({ baseSpeed: 'gentle', driveHitsTaken: 10 })).toBe('ponderous');
  });

  test('Engine/Fuel damage halves the step index', () => {
    // fleet = index 8 -> halved (floor) = index 4 = gentle
    expect(computeEffectiveSpeed({ baseSpeed: 'fleet', engineFuelDamaged: true })).toBe('gentle');
  });

  test('Enhanced Performance and Rails raise the base before damage is applied', () => {
    expect(computeEffectiveSpeed({ baseSpeed: 'ponderous', enhancedPerformance: true })).toBe('sluggish');
    expect(computeEffectiveSpeed({ baseSpeed: 'ponderous', rails: true })).toBe('mediocre');
  });

  test('modifiers and damage compose in one call', () => {
    // ponderous(0) + rails(3) = mediocre(3); 1 drive hit -> slow(2)
    expect(computeEffectiveSpeed({ baseSpeed: 'ponderous', rails: true, driveHitsTaken: 1 })).toBe('slow');
  });

  test('unrecognised base speed (e.g. supersonic) is returned unchanged, no step math applied', () => {
    expect(computeEffectiveSpeed({ baseSpeed: 'supersonic', driveHitsTaken: 3 })).toBe('supersonic');
  });

  test('never goes below ponderous or above fleet', () => {
    expect(computeEffectiveSpeed({ baseSpeed: 'ponderous', driveHitsTaken: 99 })).toBe('ponderous');
    expect(computeEffectiveSpeed({ baseSpeed: 'fleet', rails: true })).toBe('fleet');
  });
});

// ---------------------------------------------------------------------------
// Opposed-SE result card grading  (v1.4.314)
//
// postOpposedSEResult (effects/helpers.js) is display only — the actual result
// comes from resolveOpposedRoll. Until v1.4.314 the card hand-rolled its own
// bands and could therefore contradict the resolution the player had just
// been given. It now calls determineOutcome with the SAME two-argument shape
// resolveOpposedRoll uses, so the two agree by construction.
//
// This block pins the four gradings the hand-rolled expression got wrong.
// Each cites the rule rather than restating the implementation — the lesson
// from outcome-band-sweep.md section 5, where three tests locked in an
// off-by-one precisely because they were written from the code.
// ---------------------------------------------------------------------------

describe('opposed-SE card grading (regression, v1.4.314)', () => {
  // The expression the card used before v1.4.314, kept as the thing under
  // guard. If any assertion below starts matching it again, the hand-rolled
  // grading has crept back in.
  const preFix = (roll, total) =>
    roll <= Math.ceil(total / 10) ? 'critical'
      : roll <= total ? 'success'
        : roll >= 100 ? 'fumble' : 'failure';

  test('99 on a 40% skill is a Fumble, not a Failure (rules p.18: "a Fumble is roll of 99 or 00")', () => {
    expect(determineOutcome(99, 40)).toBe('fumble');
    expect(preFix(99, 40)).toBe('failure');          // what the card used to show
  });

  test('99 on a 110% total is a Failure, not a Success (rules p.18: "any roll of 96-00 is always a failure")', () => {
    // The worst of the four: the old expression had no ceiling at all, so
    // 99 <= 110 rendered as "Success" on the card while the engine failed it.
    expect(determineOutcome(99, 110)).toBe('failure');
    expect(preFix(99, 110)).toBe('success');
  });

  test('05 always succeeds, even against a target of 0 (rules p.18 floor)', () => {
    expect(determineOutcome(5, 0)).toBe('success');
    expect(preFix(5, 0)).toBe('failure');
  });

  test('96 always fails, even against a target of 200 (rules p.18 ceiling)', () => {
    expect(determineOutcome(96, 200)).toBe('failure');
    expect(preFix(96, 200)).toBe('success');
  });

  test('the gradings that were already right stay right', () => {
    for (const [roll, total] of [[100, 40], [3, 40], [4, 40], [41, 40]]) {
      expect(determineOutcome(roll, total)).toBe(preFix(roll, total));
    }
  });

  test('card and resolution consult the same grader, so they cannot disagree', () => {
    // resolveOpposedRoll grades both sides with determineOutcome(roll, total);
    // the card now does the same. Both directions of an opposed pair.
    const rank = { critical: 3, success: 2, failure: 1, fumble: 0 };
    for (const [aRoll, aTot, dRoll, dTot] of [[99, 40, 50, 60], [5, 0, 96, 200], [4, 40, 99, 110]]) {
      const defenderWins = resolveOpposedRoll(aRoll, aTot, dRoll, dTot);
      const cardAtk = determineOutcome(aRoll, aTot);
      const cardDef = determineOutcome(dRoll, dTot);
      // The card's two grades must rank the same way the resolution decided.
      if (rank[cardDef] > rank[cardAtk]) expect(defenderWins).toBe(true);
      if (rank[cardAtk] > rank[cardDef]) expect(defenderWins).toBe(false);
    }
  });
});
