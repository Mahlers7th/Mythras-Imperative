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
  hard:       { multiplier: 2 / 3 }, // rulebook p.17: "reduce skill value by one-third"
  formidable: { multiplier: 0.5  },
  herculean:  { multiplier: 1 / 5 }, // rulebook p.17: "reduce the skill value to one-fifth"
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
 * Rules p.18: any roll of 01-05 is always a Success (floor); any roll of
 * 96-00 is always a Failure regardless of skill (ceiling), unless it's
 * already a Fumble under the rule above.
 *
 * @param {number} result      d100 result
 * @param {number} target      Effective skill after difficulty. Drives success.
 * @param {number} [rawSkill]  Skill value for the fumble threshold. Defaults to `target`.
 * @param {number} [critBasis] Value the CRITICAL band derives from. Defaults to
 *   `target`, so every caller that does not pass it is unaffected.
 *
 *   Added v1.4.313 for Skill Augmentation. Core p18 says the critical band
 *   comes from the modified skill — *"this includes skills that receive a
 *   modifier"* — so `target` is the right default. But core p51 carves out one
 *   exception: *"the chances for Critical and Fumble are the same as if the
 *   primary skill was unaugmented"*, with a worked example (Ride 38% augmented
 *   to 45% still criticals on 04, not 05).
 *
 *   That cannot be expressed with `target` alone, because `target` must carry
 *   the augment or the success band is wrong. Three concepts, so three inputs:
 *   `target` for success, `critBasis` for the critical band, `rawSkill` for the
 *   fumble threshold. `MythrasRoll.execute` is the only caller that passes a
 *   `critBasis` differing from `target`; see outcome-band-sweep.md §3.
 * @returns {'critical'|'success'|'failure'|'fumble'}
 */
export function determineOutcome(result, target, rawSkill = target, critBasis = target) {
  // Rules p.18: "A Fumble is roll of 99 or 00. Skills with a value of MORE
  // THAN 100% fumble only on a roll of 00." A skill of exactly 100 is not
  // more than 100, so it still fumbles on 99 — hence `<= 100`, not `< 100`.
  // This read `< 100` until v1.4.313, making a character with exactly 100%
  // one point of skill too fumble-proof. Boundary confirmed against the book
  // (outcome-band-sweep.md §5), not inferred from surrounding code.
  if (result >= 100 || (result >= 99 && rawSkill <= 100)) return 'fumble';
  const critThreshold = Math.ceil(critBasis / 10);
  if (result <= critThreshold) return 'critical';
  if (result >= 96) return 'failure';
  if (result <= target) return 'success';
  if (result <= 5) return 'success';
  return 'failure';
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
