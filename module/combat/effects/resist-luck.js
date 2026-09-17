/**
 * mythras-imperative/module/combat/effects/resist-luck.js
 *
 * Cheat Fate on a Special Effect resistance roll (v1.4.335).
 *
 * WHERE THE SEAM IS — and why this is not the damage-pipeline split again
 * ----------------------------------------------------------------------
 * Every resistance roll is made inside `runSEDialog`'s own dialog callback,
 * which is what made this look like eighteen separate refactors: each branch
 * rolls, grades and resolves in one breath. But the dialog hands its result
 * back to the RESOLVER, and the resolver is where the consequence lives — the
 * status write, the flag, the result card all come after. That gap is the
 * seam, and it is the same shape as the defence roll's (v1.4.331): the number
 * exists, nothing derived from it has been committed.
 *
 * So the offer belongs in the resolver, once, after the roll and before the
 * apply — not inside eighteen dialog callbacks. One call per effect, placed
 * after the whole semi/socket/auto branch, which is why it also covers the
 * non-dialog automatic path for free.
 *
 * ONE POINT PER EXCHANGE, AND WHEN IT DOES NOT APPLY
 * --------------------------------------------------
 * Chris's ruling (2026-09-17): the defender gets one Luck Point per exchange,
 * so Cheat Fate, Desperate Effort, Mitigate Damage and a resistance roll made
 * *during that exchange* all draw on the same point — `defenderLuckSpent` /
 * `attackerLuckSpent` on the outcome card, the same flags the rest of the
 * system reads.
 *
 * A resistance roll made LATER, as its own Action — yanking an impaled weapon
 * on your turn, breaking free of a grip or an entangle, a wound Endurance roll
 * at a turn boundary — is a different Action and gets its own point. Those
 * callers pass `ownAction: true` and the exchange flags are neither read nor
 * written, because there is no exchange to speak of.
 *
 * GRADING
 * -------
 * The contest is `resolveOpposedRoll`, which applies the Opposed Skills Over
 * 100% reduction to BOTH totals internally — so it is given the raw totals,
 * exactly as the first roll was. The dialog preview is graded against the
 * ADJUSTED resisting total, because that is the number this roll is really
 * being judged by (v1.4.331's rule: never grade a card from unadjusted totals
 * while resolving from adjusted ones).
 *
 * **Not every resistance roll is opposed.** Stun Location's torso follow-up is
 * a flat Hard Endurance roll against a fixed target, and the over-100 rule —
 * which is about a contest between two participants — does not apply to it.
 * Those callers pass no `opposingRoll` and supply `regrade`, so each site keeps
 * its own pass/fail rule rather than having one imposed here: the torso roll's
 * is `roll <= hardTotal`, which is not the same as `determineOutcome` at the
 * 96-100 band, and a re-roll must not quietly change what "prone" means.
 */

import { canSpendLuck, offerLuckPointRouted, wantsLuckPrompt } from '../../rolls/luck-point.js';
import { resolveOpposedRoll } from '../../utils/combat-math.js';
import { applyOverHundredPenalty, determineOutcome } from '../../utils/roll-math.js';

/** Which side's exchange flag a roller's point comes out of. */
const FLAG_FOR_SIDE = { attacker: 'attackerLuckSpent', defender: 'defenderLuckSpent' };

/**
 * Whether there is anything to offer at all, before the player's prompt
 * setting is consulted. Pure, so the gating rules are testable without
 * Foundry: no roll to change, no points, or the one point for this exchange
 * already spent.
 *
 * @param {object} p
 * @param {number|null} p.roll          the d100 rolled, or null when the
 *   resisting player declined to roll at all (Accept Bleed, closed dialog)
 * @param {boolean} p.canSpend          the actor has a point left
 * @param {boolean} [p.alreadySpent]    this exchange's point is gone
 * @param {boolean} [p.ownAction]       this roll is its own Action
 * @returns {boolean}
 */
export function canOfferResistLuck({ roll, canSpend, alreadySpent = false, ownAction = false }) {
  if (roll == null) return false;
  if (!canSpend) return false;
  if (!ownAction && alreadySpent) return false;
  return true;
}

/** Read the exchange's spent flag off the outcome card, if there is one. */
function _spentOnExchange(chatMessageId, side) {
  const key = FLAG_FOR_SIDE[side];
  if (!chatMessageId || !key) return false;
  return game.messages.get(chatMessageId)?.getFlag('mythras-imperative', key) === true;
}

/**
 * Offer Cheat Fate on a resistance roll, and return what the contest is after
 * the player has decided.
 *
 * Returns the roll and result unchanged whenever nothing was spent, so a
 * caller can assign the result straight back over its own two variables.
 *
 * @param {object} p
 * @param {Actor}  p.actor           the resisting actor (a token actor in play)
 * @param {number|null} p.roll       the d100 already rolled
 * @param {boolean} p.succeeds       the contest as first resolved
 * @param {number|null} [p.opposingRoll]   the SE winner's roll; null for a flat
 *   roll against a fixed target, which then requires `regrade`
 * @param {number} [p.opposingTotal]  the SE winner's total, unadjusted
 * @param {number} p.resistTotal     the resisting total, unadjusted
 * @param {(roll:number) => boolean} [p.regrade]  how a new roll is judged;
 *   defaults to the opposed contest
 * @param {string} p.label           what is being resisted, for the dialog
 * @param {'attacker'|'defender'} p.side  whose point this is
 * @param {string|null} [p.chatMessageId]  the exchange's outcome card
 * @param {boolean} [p.ownAction]    true when this roll is its own Action
 * @returns {Promise<{roll:number|null, succeeds:boolean, spent:boolean}>}
 */
export async function offerResistLuck({
  actor, roll, succeeds, opposingRoll = null, opposingTotal = 0, resistTotal,
  regrade = null, label, side = 'defender', chatMessageId = null, ownAction = false,
}) {
  const unchanged = { roll, succeeds, spent: false };

  const alreadySpent = ownAction ? false : _spentOnExchange(chatMessageId, side);
  if (!canOfferResistLuck({ roll, canSpend: canSpendLuck(actor), alreadySpent, ownAction })) {
    return unchanged;
  }

  // The over-100 reduction belongs to contests; a flat roll keeps its target.
  const resistAdjusted = opposingRoll == null
    ? resistTotal
    : applyOverHundredPenalty([opposingTotal, resistTotal]).adjusted[1];

  // A critical that LOST the contest is still worth re-rolling — the opposing
  // roll beat it, so the contest is live in exactly the way `otherRollAtStake`
  // describes for the defence roll's forced re-roll.
  const wanted = await wantsLuckPrompt(actor, {
    outcome: determineOutcome(roll, resistAdjusted),
    otherRollAtStake: !succeeds,
  });
  if (!wanted) return unchanged;

  const spend = await offerLuckPointRouted(actor, {
    result: roll,
    target: resistAdjusted,
    label,
  });
  if (!spend) return unchanged;

  // Raw totals again: resolveOpposedRoll applies the over-100 reduction
  // itself, and handing it the adjusted numbers would apply it twice.
  const newSucceeds = regrade
    ? !!regrade(spend.result)
    : resolveOpposedRoll(opposingRoll, opposingTotal, spend.result, resistTotal);

  if (!ownAction && chatMessageId) {
    const key = FLAG_FOR_SIDE[side];
    if (key) await game.messages.get(chatMessageId)?.setFlag('mythras-imperative', key, true);
  }

  return { roll: spend.result, succeeds: newSucceeds, spent: true };
}
