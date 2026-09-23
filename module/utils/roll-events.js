/**
 * mythras-imperative/module/utils/roll-events.js
 *
 * `rollResolvedHooks` — "this actor's roll has happened" (v1.4.350).
 *
 * The counterpart to `conditionGradeHooks`. That family is asked, BEFORE a
 * roll, how much easier or harder it should be; this one says, AFTER it, that
 * the roll took place and how it went. A module needs both to express a
 * one-shot effect on someone's *next* roll — Destined's Bolster ("the affected
 * character's next Skill Roll using the specified characteristic is one
 * difficulty grade easier") grants the shift through the first and uses it up
 * through this one.
 *
 * Fired exactly ONCE per roll:
 *   'sheet'          a skill, combat style or passion rolled from the sheet
 *   'attack'         the attacker's roll, from the outcome card (after any
 *                    Luck re-roll has settled, so it fires once per exchange)
 *   'defence'        the defender's roll, same point, only when they rolled
 *   'requestedCheck' game.system.api.requestSkillCheck, both of its routes
 *
 * NOT fired by a Special Effect's own resistance roll — Bleed, Trip, Grip and
 * the rest resolve through their own branches of `runSEDialog` — nor by a
 * spell roll, the same gap `conditionGradeHooks` has there.
 *
 * Fire-and-forget and void-returning, like `attackResolvedHooks`: a listener's
 * return value is ignored and a listener that throws is logged and stepped
 * over, so one bad module cannot stop a roll from resolving. Not awaited —
 * do not do slow work in one.
 */

/**
 * @param {object} context
 * @param {Actor}  context.actor   whose roll it was
 * @param {Item|null} [context.item]    the skill/style/passion rolled, where the site has it
 * @param {string} context.kind    'sheet'|'attack'|'defence'|'requestedCheck'
 * @param {number} [context.result] the d100 rolled
 * @param {number} [context.target] what it was rolled against, after every modifier
 * @param {string} [context.grade]  'critical'|'success'|'failure'|'fumble'
 * @returns {void}
 */
export function fireRollResolved(context) {
  // globalThis.CONFIG, not a bare CONFIG: an undeclared global throws a
  // ReferenceError rather than reading as undefined, and this must never be
  // the thing that breaks a roll.
  const hooks = globalThis.CONFIG?.MYTHRAS?.rollResolvedHooks ?? [];
  if (!hooks.length || !context?.actor) return;
  for (const hook of hooks) {
    try {
      hook(context);
    } catch (err) {
      console.error('Mythras Imperative | rollResolvedHook threw (ignored):', err);
    }
  }
}
