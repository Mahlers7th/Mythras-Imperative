/**
 * mythras-imperative/module/utils/condition-grade.js
 *
 * Seam 2, Step 1 (seam-design-outcomes.md §2, §6): the role-aware
 * condition-grade chokepoint. Before this file existed, "what's the
 * worst active condition penalty" was answered by three independently
 * drifted composers, plus a fourth ad-hoc hybrid at one call site:
 *
 *   - fatigue.js's applyFatigueToSkill        — fatigue only
 *   - helpers.js's applyFatigueToSkill        — fatigue + impale + entangle
 *   - CombatEngine._getConditionFloorGrade    — fatigue + prone + impale + entangle + blind
 *   - CombatEngine._resolveDefenceSkill (own) — helpers.js's three floors,
 *     PLUS a separately bolted-on prone check computed as a second full
 *     skill total and Math.min'd against the first, not composed in grade
 *     space the way the other four floors are.
 *
 * Three roles exist because three roles genuinely need different
 * condition sets, not because of drift: fatigue/impale/entangle are
 * physical impairments that should affect everything; blind should not
 * make an Endurance check against poison harder; prone should not
 * either. The role parameter makes that implicit distinction explicit,
 * mirroring the weaponForceHooks(weapon, actor, role) convention already
 * established elsewhere in this codebase.
 *
 * STEP 1 SCOPE — faithful reproduction, not a redesign. Each role below
 * is built to numerically match an EXISTING composer's current output,
 * verified line-by-line against source before writing this file:
 *
 *   'resist'   — matches helpers.js's applyFatigueToSkill exactly
 *                (fatigue + impale + entangle). Used for SE resistance
 *                rolls (Endurance, Brawn, Evade for Trip).
 *   'defence'  — matches _resolveDefenceSkill's current composition
 *                (fatigue + impale + entangle + prone, NO blind). This
 *                is the "fold prone into grade space" target: prone's
 *                Math.min-of-two-full-totals is replaced with a grade-
 *                space worst-of comparison, which produces an IDENTICAL
 *                number today — min(raw*a, raw*b) === raw*min(a,b), and
 *                worst grade means lowest multiplier, so number-space
 *                min and grade-space max agree as long as nothing else
 *                is shifting the grade. They stop agreeing the moment a
 *                signed hook shift is added (Step 4), which is exactly
 *                why the fold has to happen first, before any hook does.
 *   'attack'   — matches _getConditionFloorGrade's current composition
 *                (fatigue + impale + entangle + prone + blind — all
 *                five). That function's own doc comment names its
 *                consumer as AttackerDialog/MythrasRoll.rollDialog, the
 *                attack-side floor.
 *
 * 'attack' and 'defence' differ by exactly one floor here: blind. That
 * is not an oversight in this file — it is the shipped bug this seam's
 * Step 3 exists to fix ("a blinded defender parries at full skill while
 * a blinded attacker takes the penalty"), reproduced faithfully rather
 * than silently corrected in what is supposed to be a zero-behaviour-
 * change extraction. Once Step 3 lands, 'attack' and 'defence' become
 * identical in composition.
 *
 * NOT reconciled here, left for Step 2's migration to decide per call
 * site: CombatEngine._resolveAttackSkill's OWN numeric skill-total
 * reduction currently uses helpers.js's three-floor composition directly
 * (not _getConditionFloorGrade's five), separate from the dialog's own
 * floor-selection use of _getConditionFloorGrade. Whether that site
 * should route through role 'attack' (gaining prone/blind it doesn't
 * currently apply to the raw total) or needs its own narrower shape is
 * exactly the kind of judgement call Step 2 exists to make deliberately,
 * one call site at a time — not something to resolve by assumption here.
 *
 * NOT YET WIRED to any call site, NOT YET exposed as a module hook family
 * (conditionGradeHooks is Step 4). This file is a dormant, standalone,
 * fully-tested building block — nothing in the engine calls it yet.
 *
 * RULING RECORDED HERE FOR STEP 4, settled before Step 1 shipped so it
 * doesn't get relitigated later: a conditionGradeHooks consumer WILL be
 * allowed to shift a composed grade below the floor getConditionGrade
 * would otherwise return — signed integers, summed across hooks, clamped
 * only to CONDITION_GRADE_ORDER's array bounds. Forbidding negative
 * shifts would make "you don't suffer the prone penalty" unimplementable
 * and send it straight back to GM fiat — the exact outcome this arc
 * exists to eliminate.
 *
 * THE CAVEAT THAT MATTERS: a negative shift is a composite-OUTPUT offset,
 * not per-condition suppression, and the difference is not cosmetic. This
 * composer takes worst-of across floors (fatigue, prone, impale, entangle,
 * blind). A hook returning -3 meant to represent "ignore prone" shifts
 * whatever grade getConditionGrade already composed — if fatigue happens
 * to be the worse floor that turn, the shift erases fatigue's contribution
 * instead of prone's, silently, with no error. Suppressing a NAMED input
 * and offsetting the composed OUTPUT are different operations; conflating
 * them produces wrong results exactly whenever two conditions are live
 * simultaneously, which is precisely when getting this right matters most.
 * A conditionGradeHooks consumer that wants "ignore condition X
 * specifically" is asking for the wrong primitive if it reaches for a
 * signed shift — document this explicitly wherever conditionGradeHooks
 * itself gets documented (extension-point-api-updated.md), not just here.
 *
 * Checked destined-demand-inventory.md's eleven named Difficulty Grade
 * consumers (rows 6/7/16) before ruling: none of them ask for suppression
 * of a specific condition — every one describes a generic "N grades
 * easier/harder" shift, which signed-shift-on-the-composite-output serves
 * correctly. If true suppression is ever needed, it wants its own,
 * different mechanism — a hook that VETOES a specific named floor BEFORE
 * composition runs, not an offset applied after. No current consumer
 * needs that; recorded as a future possibility, not built speculatively.
 */

import { getFatigueSkillGrade } from './fatigue.js';
import { getActiveImpaleGrade, getActiveEntangleGrade, getActiveBlindGrade } from '../combat/effects/helpers.js';

/** @type {string[]} Canonical grade order, worst (rightmost) to best (leftmost). */
export const CONDITION_GRADE_ORDER = ['veryEasy', 'easy', 'standard', 'hard', 'formidable', 'herculean', 'hopeless'];

/**
 * Compose the worst active condition floor for a given role. Never
 * returns anything easier than 'standard' — a floor only ever makes a
 * check harder, never easier, matching every existing composer this
 * consolidates.
 *
 * @param {Actor} actor
 * @param {'attack'|'defence'|'resist'} role
 * @returns {string} a CONDITION_GRADE_ORDER grade id
 */
export function getConditionGrade(actor, role) {
  if (!actor) return 'standard';

  let worstIdx = CONDITION_GRADE_ORDER.indexOf('standard');
  const floorTo = (gradeId) => {
    if (!gradeId) return;
    const idx = CONDITION_GRADE_ORDER.indexOf(gradeId);
    if (idx > worstIdx) worstIdx = idx;
  };

  // Physical impairments — every role consults these three.
  floorTo(getFatigueSkillGrade(actor));
  const impaleGrade = getActiveImpaleGrade(actor);
  if (impaleGrade && impaleGrade !== 'none' && impaleGrade !== 'incapacitated') floorTo(impaleGrade);
  floorTo(getActiveEntangleGrade(actor));

  // Prone — 'attack' and 'defence' only, fixed Formidable floor, no table
  // lookup (matches _getConditionFloorGrade and _resolveDefenceSkill's
  // own hardcoded 'formidable' constant, not a per-condition table entry).
  if ((role === 'attack' || role === 'defence') && (actor.statuses?.has?.('prone') ?? false)) {
    floorTo('formidable');
  }

  // Blind — 'attack' only today, faithfully reproducing the current gap
  // rather than silently closing it. See this file's own header comment.
  if (role === 'attack') {
    floorTo(getActiveBlindGrade(actor));
  }

  return CONDITION_GRADE_ORDER[worstIdx];
}

/**
 * Apply one difficulty grade's multiplier to a raw skill total, once.
 * Separated from grade *composition* (getConditionGrade above)
 * deliberately: a shift has no meaning against a number that has
 * already been multiplied, so anything that will eventually shift a
 * grade (Step 4's conditionGradeHooks) needs the grade itself as a
 * distinct value to shift, before this function ever runs.
 *
 * @param {number} raw
 * @param {string} grade  A CONDITION_GRADE_ORDER id, or any key present
 *   in CONFIG.MYTHRAS.difficultyGrades.
 * @returns {number} the effective skill total, floored at 0
 */
export function applyGradeToSkill(raw, grade) {
  const gradeDef = CONFIG.MYTHRAS?.difficultyGrades?.[grade];
  if (!gradeDef) return raw;
  if (gradeDef.multiplier === null) return 0; // hopeless
  return Math.max(0, Math.ceil(raw * gradeDef.multiplier));
}
