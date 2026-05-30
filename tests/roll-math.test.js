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
  test('hard (×0.75) — rounds up', () => {
    expect(applyDifficulty(60, 'hard')).toBe(45);
    expect(applyDifficulty(50, 'hard')).toBe(38); // ceil(37.5)
  });
  test('formidable (×0.5)', () => {
    expect(applyDifficulty(60, 'formidable')).toBe(30);
    expect(applyDifficulty(51, 'formidable')).toBe(26); // ceil(25.5)
  });
  test('herculean (×0.25)', () => {
    expect(applyDifficulty(60, 'herculean')).toBe(15);
    expect(applyDifficulty(50, 'herculean')).toBe(13); // ceil(12.5)
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
  test('roll 99 on skill 60 → fumble (rawSkill < 100)', () => {
    expect(determineOutcome(99, 60, 60)).toBe('fumble');
  });
  test('roll 99 on skill 100 → success (rawSkill = 100, no fumble on 99)', () => {
    expect(determineOutcome(99, 100, 100)).toBe('success');
  });
  test('roll 100 → always fumble', () => {
    expect(determineOutcome(100, 100, 100)).toBe('fumble');
  });
  test('critical threshold rounds up: skill 51 → crit ≤ 6', () => {
    expect(determineOutcome(6, 51, 51)).toBe('critical');
    expect(determineOutcome(7, 51, 51)).toBe('success');
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
  test('grades progress from easy (×2) to herculean (×0.25)', () => {
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
