/**
 * mythras-imperative/module/utils/reach.js
 *
 * Weapon Reach — Closing and Opening Range (Mythras Core p.94, p.106-107).
 * An OPTIONAL rule (world setting 'weaponReach', off by default, v1.4.353).
 *
 *   "The following rules assume a Reach difference of two or more steps
 *    between the longer and shorter weapon."
 *   At the longer reach: "the user of the shorter weapon cannot directly
 *    attack the wielder of the longer."
 *   At the shorter reach: "the user of the longer weapon will find he cannot
 *    parry the attacks of the shorter ... the weapon's Size is reduced as many
 *    steps as the difference between the two weapons' Reach, and only inflicts
 *    1d3+1 damage".
 *
 * One number models every case: R, the reach the pair is fighting at. It is
 * the longer weapon's reach until someone closes, then the reach of the
 * weapon that closed. Any weapon is then judged against R alone, which also
 * covers a fighter switching weapons mid-fight ("draw a shorter backup
 * weapon") without any extra state:
 *   - a weapon two or more steps SHORTER than R cannot reach its foe;
 *   - a weapon two or more steps LONGER than R is encroached: it cannot
 *     parry, and it strikes with the haft — Size down by (w − R), 1d3+1
 *     damage (plus Damage Modifier: Chris's ruling, 2026-09-23).
 *
 * Pure — no Foundry — so it is tested directly.
 */

/** Reach categories, shortest first (Core p.94). */
export const REACH_ORDER = ['T', 'S', 'M', 'L', 'VL'];
export const REACH_LABELS = { T: 'Touch', S: 'Short', M: 'Medium', L: 'Long', VL: 'Very Long' };

/** The haft/pommel strike of an encroached weapon (Core p.107). */
export const HAFT_DAMAGE = '1d3+1';

/** A reach code as a step index (Touch 0 … Very Long 4); unknown → Medium. */
export function reachIndex(code) {
  const i = REACH_ORDER.indexOf(String(code ?? '').toUpperCase());
  return i < 0 ? REACH_ORDER.indexOf('M') : i;
}

export function reachCode(index) {
  return REACH_ORDER[Math.max(0, Math.min(REACH_ORDER.length - 1, Math.round(Number(index) || 0)))];
}

/**
 * The reach a pair is fighting at.
 * @param {number} attackerReach   index of the weapon the attacker is using
 * @param {number} defenderReach   index of the defender's longest melee weapon
 * @param {number|null} stored     the pair's stored range, if anyone has changed it
 * @returns {number}
 */
export function engagementReach(attackerReach, defenderReach, stored = null) {
  if (Number.isFinite(stored)) return stored;
  // Default: engagement starts at the longer weapon's reach (Chris, 2026-09-23 —
  // "a character that is being held at range by a longer weapon must close").
  return Math.max(attackerReach, defenderReach);
}

/**
 * What a weapon of reach `w` can do at range `R`.
 * @returns {{canAttack: boolean, canParry: boolean, haftSteps: number}}
 */
export function reachVerdict(R, w) {
  const tooShort = R - w >= 2;
  const encroached = w - R >= 2;
  return { canAttack: !tooShort, canParry: !encroached, haftSteps: encroached ? w - R : 0 };
}

/** The range after the closer gets inside: the closer's weapon's reach. */
export function closedReach(closerReach, otherReach) {
  return Math.min(closerReach, otherReach);
}

/** A stable key for a pair of fighters, whichever way round they are. */
export function pairKey(uuidA, uuidB) {
  return [String(uuidA), String(uuidB)].sort().join('|');
}
