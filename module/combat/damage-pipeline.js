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
 * Pick the candidate that stands, from one or more rolls of the same formula.
 *
 * Impale (rules p.44) is *"roll damage twice and pick the best"*, and **Chris
 * ruled on 2026-09-12 that the two rolls are ONE roll: the player takes the
 * highest.** That ruling is load-bearing, not cosmetic — it says the losing
 * roll did not happen, so the winner's **dice** are the dice in play, and
 * everything that inspects dice rather than totals must read them from the
 * winner. Two things did not:
 *
 *   - **Maximise Damage** added the shortfall of the first roll's dice even
 *     when the second roll won, so it maximised a die that contributed nothing.
 *   - **The chat card's dice breakdown** rendered the first roll's dice under
 *     the winning roll's total, showing numbers that did not add up to the
 *     figure printed above them.
 *
 * Modelling the rolls as candidates rather than as a total plus a loose
 * `impaleSecond` is what makes that impossible to get wrong again: a total and
 * its dice travel together and cannot be paired up by accident.
 *
 * **Ties keep the earlier candidate**, matching the card's own winner styling,
 * which marks the first roll as the winner on `first >= second`.
 *
 * @param {{total: number, dice: object[]}[]} candidates
 * @returns {{candidate: {total: number, dice: object[]}, index: number}}
 */
export function bestCandidate(candidates) {
  const list = (Array.isArray(candidates) ? candidates : []).filter(Boolean);
  if (!list.length) return { candidate: { total: 0, dice: [] }, index: -1 };

  let index = 0;
  for (let i = 1; i < list.length; i++) {
    if ((Number(list[i].total) || 0) > (Number(list[index].total) || 0)) index = i;
  }
  return { candidate: list[index], index };
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
 * writes nothing, so a Luck Point re-roll can call it a second time with fresh
 * candidates and no side effect is repeated.
 *
 * **Order is load-bearing** and matches the inline original exactly: pick the
 * roll, then Maximise, then parry, then ward, then armour. Parry before ward is
 * not arbitrary — `resolveWardReduction` returns a no-op multiplier when the
 * defence was a parry, so the two are mutually exclusive by construction rather
 * than by ordering, but a later reduction still compounds on an earlier one and
 * reversing them would change the rounding.
 *
 * @param {object} input
 * @param {{total: number, dice: {faces: number, result: number}[]}[]} input.candidates
 *   the rolls of the damage formula, each with its own dice: one entry
 *   normally, two under Impale. The highest total wins and **its** dice are the
 *   ones Maximise Damage reads — see `bestCandidate` for why that pairing is
 *   modelled rather than passed as two loose values.
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
 *           parryNote: string, wardNote: string, winnerIndex: number}}
 *   `winnerIndex` indexes `candidates`, so the caller can render the dice of
 *   the roll that actually stands rather than assuming the first.
 */
export function computeDamage({
  candidates    = [],
  maximiseCount = 0,
  parry         = null,
  ward          = null,
  armourAP      = 0,
} = {}) {
  // 1. Pick the roll that stands (Impale: highest of two, ruled one roll).
  const { candidate: winner, index: winnerIndex } = bestCandidate(candidates);

  // 2. Maximise Damage — on the WINNER's dice, which is the whole point of
  //    carrying dice alongside their total.
  const rawDamage = applyMaximiseDamage(
    Number(winner.total) || 0, winner.dice, maximiseCount);

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

  return { rawDamage, damageAfterParry, finalDamage, parryNote, wardNote, winnerIndex };
}
