/**
 * tests/roll-math.test.js
 *
 * Jest tests for module/utils/roll-math.js
 */

import {
  applyDifficulty,
  determineOutcome,
  shiftGrade,
  DIFFICULTY_GRADES,
  GRADE_ORDER
} from '../module/utils/roll-math.js';

// =============================================================================
// applyDifficulty
// =============================================================================

describe('applyDifficulty', () => {
  test('standard (×1.0) — no change', () => {
    expect(applyDifficulty(60, 'standard')).toBe(60);
  });
  test('easy (×1.5) — rounds up', () => {
    expect(applyDifficulty(60, 'easy')).toBe(90);
    expect(applyDifficulty(41, 'easy')).toBe(62); // ceil(61.5)
  });
  test('veryEasy (×2.0)', () => {
    expect(applyDifficulty(40, 'veryEasy')).toBe(80);
  });
  test('hard (×2/3, "reduce skill value by one-third", rules p.17) — rounds up', () => {
    expect(applyDifficulty(60, 'hard')).toBe(40);
    expect(applyDifficulty(50, 'hard')).toBe(34); // ceil(33.33...)
  });
  test('formidable (×0.5)', () => {
    expect(applyDifficulty(60, 'formidable')).toBe(30);
    expect(applyDifficulty(51, 'formidable')).toBe(26); // ceil(25.5)
  });
  test('herculean (×1/5, "reduce the skill value to one-fifth", rules p.17)', () => {
    expect(applyDifficulty(60, 'herculean')).toBe(12);
    expect(applyDifficulty(50, 'herculean')).toBe(10);
  });
  test('hopeless — multiplier null, returns skill unchanged', () => {
    expect(applyDifficulty(60, 'hopeless')).toBe(60);
  });
  test('unknown grade returns skill unchanged', () => {
    expect(applyDifficulty(60, 'legendary')).toBe(60);
  });
  test('skill 0 → always 0', () => {
    expect(applyDifficulty(0, 'easy')).toBe(0);
  });
  test('skill 1 with veryEasy → 2', () => {
    expect(applyDifficulty(1, 'veryEasy')).toBe(2);
  });
});

// =============================================================================
// determineOutcome
// =============================================================================

describe('determineOutcome', () => {
  test('roll 1 on skill 50 → critical', () => {
    expect(determineOutcome(1, 50, 50)).toBe('critical');
  });
  test('roll 5 on skill 50 → critical (threshold = ceil(50/10) = 5)', () => {
    expect(determineOutcome(5, 50, 50)).toBe('critical');
  });
  test('roll 6 on skill 50 → success', () => {
    expect(determineOutcome(6, 50, 50)).toBe('success');
  });
  test('roll 50 on skill 50 → success', () => {
    expect(determineOutcome(50, 50, 50)).toBe('success');
  });
  test('roll 51 on skill 50 → failure', () => {
    expect(determineOutcome(51, 50, 50)).toBe('failure');
  });
  test('roll 99 on skill 60 → fumble (rawSkill <= 100)', () => {
    expect(determineOutcome(99, 60, 60)).toBe('fumble');
  });
  test('roll 99 on skill EXACTLY 100 → fumble (rules p.18: only skills MORE THAN 100% are exempt)', () => {
    // Corrected v1.4.313. This asserted 'failure' until then, restating the
    // implementation's `rawSkill < 100` rather than the book. Rules p.18:
    // "A Fumble is roll of 99 or 00. Skills with a value of MORE THAN 100%
    // fumble only on a roll of 00." 100 is not more than 100.
    // Corroborated by p.51's "Opposed Skills Over 100%", which says "in excess
    // of 100%" and subtracts "the difference between 100 and his skill value"
    // — a no-op at exactly 100. The book uses a strict boundary throughout.
    expect(determineOutcome(99, 100, 100)).toBe('fumble');
  });
  test('roll 99 on skill 101 → failure, not fumble — the exemption starts above 100', () => {
    expect(determineOutcome(99, 101, 101)).toBe('failure');
  });
  test('roll 100 → always fumble', () => {
    expect(determineOutcome(100, 100, 100)).toBe('fumble');
  });
  test('critical threshold rounds up: skill 51 → crit ≤ 6', () => {
    expect(determineOutcome(6, 51, 51)).toBe('critical');
    expect(determineOutcome(7, 51, 51)).toBe('success');
  });

  describe('01-05 auto-success floor / 96-00 auto-failure ceiling (rules p.18)', () => {
    test('roll 05 always succeeds, even against a target of 0', () => {
      expect(determineOutcome(5, 0, 0)).toBe('success');
    });
    test('roll 06 is not covered by the floor — an ordinary failure against a low target', () => {
      expect(determineOutcome(6, 0, 0)).toBe('failure');
    });
    test('roll 96 always fails, even against a target of 200 (and isn\'t a Fumble at rawSkill 200)', () => {
      expect(determineOutcome(96, 200, 200)).toBe('failure');
    });
    test('roll 95 is not covered by the ceiling — an ordinary success against a matching target', () => {
      expect(determineOutcome(95, 95, 95)).toBe('success');
    });
  });
});

// =============================================================================
// shiftGrade
// =============================================================================

describe('shiftGrade', () => {
  test('shift standard by 0 → standard', () => {
    expect(shiftGrade('standard', 0)).toBe('standard');
  });
  test('shift standard by -1 (easier) → easy', () => {
    expect(shiftGrade('standard', -1)).toBe('easy');
  });
  test('shift standard by +1 (harder) → hard', () => {
    expect(shiftGrade('standard', 1)).toBe('hard');
  });
  test('shift hard by -1 → standard', () => {
    expect(shiftGrade('hard', -1)).toBe('standard');
  });
  test('shift easy by -2 → veryEasy', () => {
    expect(shiftGrade('easy', -2)).toBe('veryEasy');
  });
  test('clamps at veryEasy (minimum)', () => {
    expect(shiftGrade('veryEasy', -5)).toBe('veryEasy');
  });
  test('clamps at hopeless (maximum)', () => {
    expect(shiftGrade('hopeless', 5)).toBe('hopeless');
  });
  test('hero grade-easier advantage: standard → easy', () => {
    expect(shiftGrade('standard', -1)).toBe('easy');
  });
  test('grade-easier with fatigue floor (hard): hard - 1 → standard', () => {
    // Even with fatigue at hard, a grade-easier advantage brings it to standard
    expect(shiftGrade('hard', -1)).toBe('standard');
  });
});

// =============================================================================
// DIFFICULTY_GRADES integrity
// =============================================================================

describe('DIFFICULTY_GRADES', () => {
  test('has all 7 grade keys', () => {
    expect(Object.keys(DIFFICULTY_GRADES)).toHaveLength(7);
  });
  test('standard multiplier is 1.0', () => {
    expect(DIFFICULTY_GRADES.standard.multiplier).toBe(1.0);
  });
  test('hopeless multiplier is null', () => {
    expect(DIFFICULTY_GRADES.hopeless.multiplier).toBeNull();
  });
  test('grades progress monotonically from veryEasy (×2) to herculean (×1/5)', () => {
    expect(DIFFICULTY_GRADES.veryEasy.multiplier).toBeGreaterThan(DIFFICULTY_GRADES.easy.multiplier);
    expect(DIFFICULTY_GRADES.easy.multiplier).toBeGreaterThan(DIFFICULTY_GRADES.standard.multiplier);
    expect(DIFFICULTY_GRADES.standard.multiplier).toBeGreaterThan(DIFFICULTY_GRADES.hard.multiplier);
    expect(DIFFICULTY_GRADES.hard.multiplier).toBeGreaterThan(DIFFICULTY_GRADES.formidable.multiplier);
    expect(DIFFICULTY_GRADES.formidable.multiplier).toBeGreaterThan(DIFFICULTY_GRADES.herculean.multiplier);
  });
});

describe('GRADE_ORDER', () => {
  test('has 7 entries in the right order', () => {
    expect(GRADE_ORDER).toEqual([
      'veryEasy', 'easy', 'standard', 'hard', 'formidable', 'herculean', 'hopeless'
    ]);
  });
});

// ---------------------------------------------------------------------------
// critBasis — the fourth argument  (v1.4.313)
//
// Core p18 makes the critical band derive from the MODIFIED skill ("this
// includes skills that receive a modifier"), which is why critBasis defaults
// to target. Core p51 carves out exactly one exception: "the chances for
// Critical and Fumble are the same as if the primary skill was unaugmented."
//
// That cannot be expressed with target alone, because target must carry the
// augment or the success band is wrong — three concepts, three inputs.
// See outcome-band-sweep.md section 3.
// ---------------------------------------------------------------------------

describe('determineOutcome critBasis (rules p.51 augmentation)', () => {
  test('defaults to target — every pre-v1.4.313 caller is unaffected', () => {
    expect(determineOutcome(5, 50, 50)).toBe(determineOutcome(5, 50, 50, 50));
    expect(determineOutcome(6, 50)).toBe(determineOutcome(6, 50, 50, 50));
  });

  test("the rulebook's own worked example: Ride 38 augmented to 45", () => {
    // p51: "using Locale 33% she would increase her Ride by 7%, giving her a
    // Ride of 45%. However, the chances for Critical and Fumble are the same
    // as if the primary skill was unaugmented; so Anathaym would still only
    // score a Critical success on a roll of 4% or less."
    const base = 38, augmented = 45;
    expect(determineOutcome(4, augmented, base, base)).toBe('critical');
    expect(determineOutcome(5, augmented, base, base)).toBe('success');
  });

  test('the augment still raises the SUCCESS band — it only excludes the crit band', () => {
    // 39-45 succeed only because of the augment. That half must keep working.
    const base = 38, augmented = 45;
    expect(determineOutcome(39, augmented, base, base)).toBe('success');
    expect(determineOutcome(45, augmented, base, base)).toBe('success');
    expect(determineOutcome(46, augmented, base, base)).toBe('failure');
  });

  test('without critBasis the same roll would wrongly crit — the bug this fixes', () => {
    // Guards the regression directly: passing the augmented value as the basis
    // is what widened the band from 4 to 5.
    expect(determineOutcome(5, 45, 45, 45)).toBe('critical');
    expect(determineOutcome(5, 45, 38, 38)).toBe('success');
  });

  test('critBasis is independent of the fumble basis', () => {
    // The two happen to be equal in the augmentation case, but they are
    // separate inputs and must not be conflated.
    expect(determineOutcome(99, 45, 101, 38)).toBe('failure');  // exempt from 99-fumble
    expect(determineOutcome(99, 45, 38, 38)).toBe('fumble');    // not exempt
    expect(determineOutcome(4, 45, 101, 38)).toBe('critical');  // crit band still from 38
  });

  test('a difficulty-reduced critBasis narrows the band correctly', () => {
    // Hard on an unaugmented 60 is 40, so criticals are 1-4 even though the
    // augmented target is higher.
    expect(determineOutcome(4, 47, 60, 40)).toBe('critical');
    expect(determineOutcome(5, 47, 60, 40)).toBe('success');
  });

  test('the 01-05 floor and 96-00 ceiling still apply over a narrow crit band', () => {
    // A tiny critBasis must not let the floor/ceiling rules break.
    expect(determineOutcome(3, 45, 38, 5)).toBe('success');   // 01-05 floor, not critical
    expect(determineOutcome(1, 45, 38, 10)).toBe('critical'); // ceil(10/10) = 1
    expect(determineOutcome(96, 45, 38, 38)).toBe('failure');
  });
});
