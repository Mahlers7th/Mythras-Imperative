// ---------------------------------------------------------------------------
// fatigue.js — shared fatigue utility functions
//
// These are the canonical implementations used by MythrasRoll, CombatEngine,
// and any module that needs to apply fatigue to skill rolls. Imported by
// mythras.mjs (re-exported for external consumers) and CombatEngine.
// ---------------------------------------------------------------------------

/**
 * Returns the difficulty grade id imposed by an actor's current fatigue level,
 * or null if there is no penalty.
 *
 * @param {Actor} actor
 * @returns {string|null} grade id (e.g. 'hard', 'formidable') or null
 */
export function getFatigueSkillGrade(actor) {
  if (!actor) return null;
  const fatigueId  = actor.system?.fatigue ?? 'fresh';
  const fatigueDef = (CONFIG.MYTHRAS?.fatigueLevels ?? []).find(f => f.id === fatigueId);
  return fatigueDef?.skillGrade ?? null;
}

/**
 * Takes a raw skill total and an actor, returns the effective target after
 * applying any fatigue difficulty grade.  If the actor is semi-conscious,
 * comatose, or dead the result is 0.
 *
 * @param {number} skillTotal - raw skill value before fatigue
 * @param {Actor}  actor
 * @returns {number} effective skill total
 */
export function applyFatigueToSkill(skillTotal, actor) {
  const grade = getFatigueSkillGrade(actor);
  if (!grade) return skillTotal;
  const grades   = CONFIG.MYTHRAS?.difficultyGrades ?? {};
  const gradeDef = grades[grade];
  if (!gradeDef) return skillTotal;
  if (gradeDef.multiplier === null) return 0; // hopeless
  return Math.max(0, Math.ceil(skillTotal * gradeDef.multiplier));
}
