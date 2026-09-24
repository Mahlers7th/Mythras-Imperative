/**
 * mythras-imperative/module/combat/reach-state.js
 *
 * The live half of the optional Weapon Reach rule (Mythras Core p.106-107,
 * v1.4.353): which weapons count, where a pair's range is stored, and what
 * that means for the weapon in hand. The rules themselves are pure, in
 * module/utils/reach.js.
 *
 * STATE — the range a pair is fighting at is stored on the active Combat,
 * `flags.mythras-imperative.reach[<pair>] = R`, only once someone has changed
 * it (closed in). With no entry, the pair is at the longer weapon's reach.
 * It lives and dies with the combat. Only the GM writes it.
 */

import { reachIndex, engagementReach, reachVerdict, pairKey, REACH_LABELS, reachCode, HAFT_DAMAGE } from '../utils/reach.js';

export { HAFT_DAMAGE };

/** The world setting — off unless a table opts in. */
export function reachRuleOn() {
  try { return !!game.settings.get('mythras-imperative', 'weaponReach'); } catch { return false; }
}

export function isMeleeWeapon(weapon) {
  return !!weapon && (weapon.system?.category ?? 'melee') !== 'ranged';
}

export function weaponReach(weapon) {
  return reachIndex(weapon?.system?.reach);
}

/**
 * The reach an actor can hold a foe at: its longest melee weapon in any combat
 * style (falling back to any melee weapon it carries). With none, it fights
 * unarmed — Touch.
 */
export function longestMeleeReach(actor) {
  const items = Array.from(actor?.items ?? []);
  const inStyles = new Set();
  for (const style of items.filter(i => i.type === 'combat-style')) {
    for (const ref of style.system?.weapons ?? []) {
      const w = actor.items.get(ref.id) ?? items.find(i => i.type === 'weapon' && i.name === ref.name);
      if (w) inStyles.add(w);
    }
  }
  const pool = [...inStyles].filter(isMeleeWeapon);
  const melee = pool.length ? pool : items.filter(i => i.type === 'weapon' && isMeleeWeapon(i));
  return melee.length ? Math.max(...melee.map(weaponReach)) : reachIndex('T');
}

function activeCombat() {
  return game.combats?.active ?? game.combat ?? null;
}

/** Flag keys cannot contain dots (Foundry expands them), and uuids do. */
function flagKey(a, b) {
  return pairKey(a?.uuid, b?.uuid).replace(/\./g, '_');
}

/** The pair's stored range, or null when nobody has changed it. */
export function storedReach(a, b) {
  const v = activeCombat()?.getFlag?.('mythras-imperative', 'reach')?.[flagKey(a, b)];
  return Number.isFinite(v) ? v : null;
}

/** GM only. `R` null clears it — back to the longer weapon's reach. */
export async function setStoredReach(a, b, R) {
  const combat = activeCombat();
  if (!combat || !game.user.isGM) return false;
  const key = flagKey(a, b);
  if (R === null || R === undefined) {
    await combat.update({ [`flags.mythras-imperative.reach.-=${key}`]: null });
  } else {
    await combat.update({ [`flags.mythras-imperative.reach.${key}`]: Number(R) });
  }
  return true;
}

/**
 * Where an attack with `weapon` stands. Null when the rule is off or does not
 * apply (a ranged attack, no defender).
 * @param {object} [opts]
 * @param {'auto'|'long'|'closed'} [opts.choice]  a GM's override from the attack dialog
 */
export function reachFor(attacker, weapon, defender, { choice = 'auto' } = {}) {
  if (!reachRuleOn() || !attacker || !defender || !isMeleeWeapon(weapon)) return null;
  const w = weaponReach(weapon);
  const d = longestMeleeReach(defender);
  const stored = choice === 'long' ? null
    : choice === 'closed' ? Math.min(w, d)
    : storedReach(attacker, defender);
  const R = engagementReach(w, d, stored);
  const verdict = reachVerdict(R, w);
  return { R, w, d, stored: stored !== null, verdict,
    rangeLabel: REACH_LABELS[reachCode(R)], weaponLabel: REACH_LABELS[reachCode(w)] };
}

/** Can this weapon parry at range R? (No rule, or no range → yes.) */
export function canParryAt(R, weapon) {
  if (!Number.isFinite(R) || !isMeleeWeapon(weapon)) return true;
  return reachVerdict(R, weaponReach(weapon)).canParry;
}

/** One line for the attack dialog. */
export function reachBannerText(info, defenderName) {
  if (!info) return '';
  if (!info.verdict.canAttack) {
    return `Held at bay — fighting at ${info.rangeLabel} reach, your ${info.weaponLabel} weapon cannot reach ${defenderName}. Close the range first.`;
  }
  if (info.verdict.haftSteps > 0) {
    return `Closed in at ${info.rangeLabel} reach — a haft strike: Size −${info.verdict.haftSteps}, ${HAFT_DAMAGE} damage (plus Damage Modifier), and this weapon cannot parry.`;
  }
  return '';
}
