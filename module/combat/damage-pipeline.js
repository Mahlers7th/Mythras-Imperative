/**
 * mythras-imperative/module/combat/damage-pipeline.js
 *
 * The damage arithmetic, extracted from `_onSemiAutoRollDamage` as pure
 * functions.
 *
 * WHY THIS EXISTS
 * ---------------
 * `_onSemiAutoRollDamage` (mythras.mjs) was ~345 lines in which computation and
 * side effects were fully interleaved: it rolled dice, decremented ammo,
 * reduced for parry, wrote Sunder's armour-point loss, stamped flags on the
 * outcome card, fired opposed Special Effects, and posted a chat card — in one
 * straight line, with no point at which the *result* existed but nothing had
 * yet been committed.
 *
 * That is exactly the seam a Luck Point needs. Cheat Fate re-rolls *"a skill
 * roll, damage roll, or anything else that has some effect"*, but the shared
 * affordance may only be offered **where the roll's consequence has not yet
 * been committed** (see `module/rolls/luck-point.js`) — and this function
 * committed something at nearly every step. Separating the arithmetic out is
 * what makes the damage number re-computable from a different roll without
 * re-running any of the writes.
 *
 * WHAT IS AND IS NOT HERE
 * -----------------------
 * Here: everything from the dice total to the number that lands on the Apply
 * Damage button — Impale's best-of-two, Maximise Damage, parry and ward
 * reduction, armour subtraction, and the Major Wound prediction that gates the
 * Mitigate Damage offer.
 *
 * Not here, deliberately: anything that needs a live document. Parry and ward
 * *multipliers* come from `CombatEngine.resolveParryReduction` /
 * `resolveWardReduction`, which read actors, weapons and warded locations;
 * those are resolved by the caller and handed in as the `{ multiplier, label }`
 * objects they already return. Sunder is not here either — it is a write
 * (`_applySunder` permanently reduces armour points) and only its carry-over
 * result re-enters the arithmetic.
 */

/**
 * Impale (rules p.44): *"roll damage twice and pick the best."*
 *
 * @param {number} first
 * @param {number} second
 * @returns {number} the higher of the two
 */
export function impaleBestOf(first, second) {
  const a = Number(first)  || 0;
  const b = Number(second) || 0;
  return Math.max(a, b);
}

/**
 * Maximise Damage (rules p.45): *"substitute each chosen die with its maximum
 * face value."* One die per stack count; Damage Modifier dice are not affected.
 *
 * Implemented as an addition of the shortfall (`faces - rolled`) rather than a
 * recomputation of the total, because the total may already carry non-die terms
 * (flat bonuses, the Damage Modifier) that must survive untouched.
 *
 * **Takes INDIVIDUAL DICE, not Foundry roll terms — this is the fix for a bug
 * that shipped in the initial commit.** A Foundry `Die` term covers a whole
 * dice group: `2d6` is *one* term with `faces: 6` and `total: 6` (the sum of
 * both dice, not either die's value). The original inline code subtracted
 * `faces - term.total`, which for `2d6` rolled 2 and 4 is `6 - 6 = 0` — so
 * Maximise Damage did **nothing at all** on any multi-die weapon, silently.
 * It appeared to work only because `1dN` is the degenerate case where the
 * term's total *is* the single die's value. Live-confirmed on `2d6`, which is
 * a real weapon formula in the campaign.
 *
 * **Which dice are chosen: the ones with the largest shortfall.** The Special
 * Effect is the attacker's, and *"each chosen die"* means they pick; an
 * attacker picks whichever dice gain the most. The original took the first N
 * in roll order, which is indistinguishable for `1dN` and strictly worse
 * otherwise.
 *
 * @param {number} total  the damage total so far
 * @param {{faces: number, result: number}[]} dice  every individual die rolled,
 *   flattened out of the roll's terms by the caller
 * @param {number} count  how many dice to maximise
 * @returns {number}
 */
export function applyMaximiseDamage(total, dice, count) {
  const damage = Number(total) || 0;
  const list = Array.isArray(dice) ? dice : [];
  const n = Math.min(Number(count) || 0, list.length);
  if (n <= 0) return damage;

  const shortfalls = list
    .map(d => Math.max(0, (Number(d?.faces) || 0) - (Number(d?.result) || 0)))
    .sort((a, b) => b - a);

  let gain = 0;
  for (let i = 0; i < n; i++) gain += shortfalls[i];
  return damage + gain;
}

/** Card wording for a parry reduction. */
export const PARRY_NOTES = { full: 'fully blocked', half: 'half damage' };
/** Card wording for a ward reduction — deliberately different from the parry
 *  wording at the 'full' end ("fully warded", not "fully blocked"), so a reader
 *  of the card can tell a passive ward from an active parry. */
export const WARD_NOTES  = { full: 'fully warded',  half: 'half damage (warded)' };

/**
 * Apply one `{ multiplier, label }` reduction — the shape both
 * `CombatEngine.resolveParryReduction` and `resolveWardReduction` return.
 *
 * Rounds **up**: a half-damage parry against 5 damage lets 3 through, not 2.
 * This matches the `Math.ceil` the inline code used at both sites.
 *
 * A `null` reduction, or one whose multiplier is not a finite number below 1,
 * is a no-op returning an empty note — which is how the caller expresses "the
 * parry gate did not apply" without a second flag.
 *
 * @param {number} damage
 * @param {{multiplier: number, label: string}|null} reduction
 * @param {{full: string, half: string}} [notes]  wording per label
 * @returns {{damage: number, note: string}} note is '' when nothing applied
 */
export function applyReduction(damage, reduction, notes = PARRY_NOTES) {
  const base = Number(damage) || 0;
  const mult = Number(reduction?.multiplier);
  if (!reduction || !Number.isFinite(mult) || mult >= 1) return { damage: base, note: '' };

  return { damage: Math.ceil(base * mult), note: notes[reduction.label] ?? '' };
}

/**
 * Damage that survives armour. Never negative.
 *
 * @param {number} damage
 * @param {number} armourAP
 * @returns {number}
 */
export function damageAfterArmour(damage, armourAP) {
  return Math.max(0, (Number(damage) || 0) - (Number(armourAP) || 0));
}

/**
 * The whole arithmetic, in one call.
 *
 * Pure and re-runnable: given the same inputs it returns the same numbers and
 * writes nothing, so a Luck Point re-roll can call it a second time with a new
 * `rollTotal` and no side effect is repeated.
 *
 * **Order is load-bearing** and matches the inline original exactly: Impale,
 * then Maximise, then parry, then ward, then armour. Parry before ward is not
 * arbitrary — `resolveWardReduction` returns a no-op multiplier when the
 * defence was a parry, so the two are mutually exclusive by construction
 * rather than by ordering, but a later reduction still compounds on an earlier
 * one and reversing them would change the rounding.
 *
 * **A preserved quirk, flagged not fixed:** `dice` are the *first* roll's dice
 * even when Impale's second roll is the one that won, so Maximise adds the
 * shortfall of a die that did not contribute to the total in play. That is the
 * original inline behaviour and is kept, because correcting it needs a ruling
 * on whether Impale's two rolls are one roll or two — unlike the multi-die bug
 * above, which had no defensible reading at all.
 *
 * @param {object} input
 * @param {number} input.rollTotal        the evaluated damage roll
 * @param {{faces: number, result: number}[]} [input.dice]  every individual die of
 *   the first roll, flattened out of its terms
 * @param {number} [input.impaleSecond]   second Impale roll, or null/undefined
 * @param {number} [input.maximiseCount]  how many dice Maximise Damage covers
 * @param {{multiplier: number, label: string}|null} [input.parry]  `null` when
 *   the parry gate did not apply at all (no parry weapon, Circumvent Parry
 *   chosen, or the parry failed). Enhance Parry is expressed by the caller
 *   substituting `{ multiplier: 0, label: 'full' }` rather than by a flag —
 *   p.42's "full block regardless of weapon size" *is* a full-block reduction,
 *   so it needs no separate branch here.
 * @param {{multiplier: number, label: string}|null} [input.ward]
 * @param {number} [input.armourAP]
 * @returns {{rawDamage: number, damageAfterParry: number, finalDamage: number,
 *           parryNote: string, wardNote: string}}
 */
export function computeDamage({
  rollTotal,
  dice          = [],
  impaleSecond  = null,
  maximiseCount = 0,
  parry         = null,
  ward          = null,
  armourAP      = 0,
} = {}) {
  // 1. Impale — best of two rolls.
  let rawDamage = Number(rollTotal) || 0;
  if (impaleSecond !== null && impaleSecond !== undefined) {
    rawDamage = impaleBestOf(rawDamage, impaleSecond);
  }

  // 2. Maximise Damage.
  rawDamage = applyMaximiseDamage(rawDamage, dice, maximiseCount);

  // 3. Parry — including Enhance Parry, which the caller passes as a full-block
  //    reduction rather than as a special case (see the `parry` param doc).
  const parried = applyReduction(rawDamage, parry, PARRY_NOTES);

  // 4. Ward Location (p.39).
  const warded = applyReduction(parried.damage, ward, WARD_NOTES);

  const damageAfterParry = warded.damage;
  const parryNote        = parried.note;
  const wardNote         = warded.note;

  // 5. Armour.
  const finalDamage = damageAfterArmour(damageAfterParry, armourAP);

  return { rawDamage, damageAfterParry, finalDamage, parryNote, wardNote };
}
