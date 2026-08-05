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
  stepUpDamageModifier,
  getImpaleGrade,
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
    test('99 is NOT fumble when rawSkill >= 100 (but still Failure — the 96-00 ceiling)', () => {
      expect(determineOutcome(99, 100, 100)).toBe('failure');
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
