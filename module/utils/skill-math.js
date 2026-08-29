/**
 * mythras-imperative/module/utils/skill-math.js
 *
 * THE single source for "what is this skill's percentage?".
 *
 * Until v1.4.311 the answer lived in FIVE places: three byte-identical copies
 * of `_evalFormula` (CharacterSheet, CombatStyleSheet, SkillSheet) plus two
 * inline `base + bonusPoints` recomputations on the character sheet's own roll
 * paths. The authoritative total was computed by a SHEET RENDER and written
 * back to the database (CharacterSheet._calcSkillTotals), while MythrasRoll
 * read the stored value — so the number a player saw and the number the dice
 * rolled against could only agree if the right sheet had been opened recently.
 *
 * That is the same "N copies of one rule, no single owner" shape that produced
 * the v1.4.309 passion-augmentation bug (four inline copies, one unused correct
 * definition, a chat card contradicting its own roll). One definition with
 * several readers cannot drift; five copies will.
 *
 * Pure and Foundry-free, matching char-math.js/combat-math.js/roll-math.js —
 * the hook sum is computed by the caller (which needs CONFIG) and passed in.
 */

/**
 * Item types whose percentage is derived from a characteristic formula.
 *
 * Passions are in this list deliberately: CharacterSheet._calcSkillTotals has
 * always handled them in the same loop as skills and combat styles, and
 * PassionData#augmentBonus derives from `total` — so a hook that bonuses a
 * passion also moves its Skill Augmentation value. That is correct (a bigger
 * passion augments harder) and is documented on skillBonusHooks rather than
 * left to be discovered.
 */
export const SKILL_ITEM_TYPES = ['skill', 'combat-style', 'passion'];

/**
 * Build the characteristic lookup a base formula is evaluated against.
 *
 * Was inline in at least four places, all identical, all reading `.value`
 * (never `.base`) — deliberately, so that characteristicBonusHooks and
 * Characteristic Drain both cascade into skill percentages.
 *
 * @param {object} characteristics - actor `system.characteristics`
 * @returns {Record<string, number>}
 */
export function charsFrom(characteristics) {
  const c = characteristics ?? {};
  return {
    STR: c.str?.value ?? 0,
    CON: c.con?.value ?? 0,
    SIZ: c.siz?.value ?? 0,
    DEX: c.dex?.value ?? 0,
    INT: c.int?.value ?? 0,
    POW: c.pow?.value ?? 0,
    CHA: c.cha?.value ?? 0
  };
}

/**
 * Evaluate a skill base formula (e.g. "STR+DEX", "INT×2") against characteristics.
 *
 * Behaviour is preserved EXACTLY from the three copies this replaces — do not
 * "tidy" the details below, each is load-bearing:
 *
 *  - Only the unicode multiplication sign `×` is replaced with `*`. The ASCII
 *    letter `x`/`X` is NOT, because it appears inside `DEX`.
 *  - Substitution is word-boundary anchored and case-insensitive.
 *  - The result is only evaluated if what remains is arithmetic and nothing
 *    else — the regex is the guard that stops a malformed or malicious formula
 *    reaching `Function`.
 *  - `Math.floor` matches the rulebook: a characteristic-derived base is a
 *    whole percentage.
 *  - Anything unparseable returns 0 rather than throwing, so one bad formula
 *    cannot break derivation for a whole actor.
 *
 * @param {string} formula
 * @param {Record<string, number>} chars
 * @returns {number}
 */
export function evalSkillFormula(formula, chars) {
  if (!formula) return 0;
  let f = String(formula).replace(/×/g, '*');
  for (const [k, v] of Object.entries(chars ?? {})) {
    f = f.replace(new RegExp(`\\b${k}\\b`, 'gi'), v);
  }
  try {
    if (/^[\d\s+\-*/().]+$/.test(f)) {
      return Math.floor(Function('"use strict";return(' + f + ')')());
    }
  } catch (e) { /* unparseable formula → 0, same as the copies this replaces */ }
  return 0;
}

/**
 * Compute a skill/combat-style/passion's derived base and total.
 *
 * @param {object} opts
 * @param {string} [opts.baseFormula]  - the item's base formula; empty for statblock imports
 * @param {number} [opts.storedTotal]  - the item's PERSISTED total (`_source`), see below
 * @param {number} [opts.bonusPoints]  - the item's stored bonus points
 * @param {Record<string, number>} [opts.chars]
 * @param {number} [opts.hookSum]      - summed skillBonusHooks contribution
 * @returns {{ baseValue: number, total: number }}
 */
export function computeSkillTotal({ baseFormula, storedTotal = 0, bonusPoints = 0, chars, hookSum = 0 } = {}) {
  // Statblock path: creatures and NPCs imported from MEG carry no baseFormula
  // and their stored total IS the authoritative book percentage — recomputing
  // from an empty formula would yield 0 and silently wipe every skill. Both
  // CharacterSheet._calcSkillTotals and CombatStyleSheet already special-cased
  // this; it is preserved here rather than reinvented per caller.
  //
  // bonusPoints is deliberately NOT added on this path, matching the previous
  // behaviour exactly: a statblock's number is the whole number.
  if (!baseFormula) {
    return { baseValue: storedTotal, total: Math.max(0, storedTotal + hookSum) };
  }

  const baseValue = evalSkillFormula(baseFormula, chars);
  return { baseValue, total: Math.max(0, baseValue + bonusPoints + hookSum) };
}
