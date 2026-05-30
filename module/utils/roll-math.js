/**
 * mythras-imperative/module/utils/roll-math.js
 *
 * Pure roll math functions extracted from MythrasRoll for testability.
 * Zero Foundry dependencies — safe to import in Node/Jest without mocks.
 */

// ---------------------------------------------------------------------------
// Difficulty grade multipliers
// ---------------------------------------------------------------------------

export const DIFFICULTY_GRADES = {
  veryEasy:   { multiplier: 2.0  },
  easy:       { multiplier: 1.5  },
  standard:   { multiplier: 1.0  },
  hard:       { multiplier: 0.75 },
  formidable: { multiplier: 0.5  },
  herculean:  { multiplier: 0.25 },
  hopeless:   { multiplier: null },
};

export const GRADE_ORDER = [
  'veryEasy', 'easy', 'standard', 'hard', 'formidable', 'herculean', 'hopeless'
];

/**
 * Apply a difficulty grade to a skill total.
 *
 * @param {number} skill
 * @param {string} difficulty  Grade id key
 * @returns {number}
 */
export function applyDifficulty(skill, difficulty) {
  const grade = DIFFICULTY_GRADES[difficulty];
  if (!grade || grade.multiplier === null) return skill;
  return Math.ceil(skill * grade.multiplier);
}

// ---------------------------------------------------------------------------
// Outcome determination  (matches MythrasRoll.determineOutcome)
// ---------------------------------------------------------------------------

/**
 * Determine the outcome of a skill roll.
 *
 * @param {number} result     d100 result
 * @param {number} target     Effective skill after difficulty
 * @param {number} [rawSkill] Pre-difficulty skill (for fumble threshold)
 * @returns {'critical'|'success'|'failure'|'fumble'}
 */
export function determineOutcome(result, target, rawSkill = target) {
  if (result >= 100 || (result >= 99 && rawSkill < 100)) return 'fumble';
  const critThreshold = Math.ceil(target / 10);
  if (result <= critThreshold) return 'critical';
  return result <= target ? 'success' : 'failure';
}

/**
 * Shift a grade by `steps` (negative = easier, positive = harder).
 * Clamps to the ends of GRADE_ORDER.
 *
 * @param {string} gradeId
 * @param {number} steps
 * @returns {string}
 */
export function shiftGrade(gradeId, steps) {
  const idx = GRADE_ORDER.indexOf(gradeId);
  if (idx === -1) return gradeId;
  return GRADE_ORDER[Math.max(0, Math.min(GRADE_ORDER.length - 1, idx + steps))];
}
