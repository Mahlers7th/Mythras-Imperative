/**
 * mythras-imperative/module/rolls/luck-point.js
 *
 * The shared Luck Point spend affordance — one button, one options dialog,
 * one spend path, used everywhere a Luck Point can legally be spent.
 *
 * WHY A COMPONENT RATHER THAN A BUTTON PER SITE
 * ---------------------------------------------
 * Cheat Fate applies to *"a skill roll, damage roll, or anything else that has
 * some effect"* (Imperative p.33 / Core p.81), so the affordance belongs in
 * several places that otherwise share no code — a chat card, a combat dialog,
 * a damage step. Building it once means they cannot drift in what they offer,
 * what they charge, or how they grade the result. This repo's own history is
 * the argument: three drifted copies of the armour arithmetic (v1.4.261), two
 * of `determineOutcome` both missing the same rule.
 *
 * WHERE IT MAY BE USED — the constraint that matters
 * --------------------------------------------------
 * **Only where the roll's consequence has not yet been committed.** A Luck
 * Point re-roll changes what the roll *was*, so anything already derived from
 * it must not yet exist. That is a real limit, not a stylistic one: by the
 * time a combat resolution card is posted the engine has already spent Action
 * Points, awarded Special Effects, written HP and wounds onto hit-location
 * items and applied conditions to tokens, and `spellcasting.js` has already
 * deducted Magic Points at the fumble rate and resolved the resist roll. There
 * is no rollback infrastructure anywhere in this system. A button on one of
 * those cards would either lie (showing a re-rolled miss while the target
 * still carries the wound the original hit caused) or need a transaction log
 * that does not exist.
 *
 * Safe seams, in order of how they are reached:
 *   - a sheet skill roll's own chat card — the card IS the consequence
 *     (`MythrasRoll`, the original implementation)
 *   - the attack roll, offered inside the defence dialog: RAW ordering
 *     (p.40) puts that dialog after the roll and before ANY resolution, and
 *     the dialog is already a pause, so the offer costs nothing when ignored
 *   - a damage or spell roll, IF the site is first split into
 *     roll -> offer -> apply (not done; see CHANGELOG v1.4.319)
 *
 * ONE POINT PER ACTION
 * --------------------
 * *"Only one Luck Point can be used in support of a particular Action."* This
 * module charges the point and reports what it did; enforcing the limit is the
 * caller's job, because only the caller knows what its "Action" is. Every
 * caller must retire its own affordance after a successful spend — the chat
 * card does it via `MythrasRoll._retireLuckButtons` plus a `luckSpent` message
 * flag, the attack dialog by disabling its button.
 */

import { determineOutcome } from '../utils/roll-math.js';

/** Class every Luck Point trigger carries, so callers bind one selector. */
export const LUCK_BUTTON_CLASS = 'mi-luck-offer';

/**
 * Swap a d100 result's digits — the book's own example, *"a 75 would become a
 * 57."*
 *
 * A result of 100 is the d100 face "00", whose digits swapped are still "00",
 * so it returns 100 unchanged. **This is a behaviour fix**: the previous
 * inline implementation in `MythrasRoll.swapDigits` computed
 * `Math.floor(100/10)` = 10 tens and 0 units and returned **10**, silently
 * converting the one guaranteed fumble in the game into a near-certain
 * success for one Luck Point. Every other value is unchanged by this
 * correction (5 -> 50, 75 -> 57, 10 -> 1).
 *
 * @param {number} result  d100 result, 1-100
 * @returns {number} the digit-swapped result
 */
export function swapDigits(result) {
  const n = Number(result);
  if (!Number.isFinite(n)) return result;
  if (n === 100) return 100;          // "00" swapped is still "00"
  return (n % 10) * 10 + Math.floor(n / 10);
}

/**
 * Whether this actor can legally spend a point right now.
 * Pure apart from reading the actor's own derived data.
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
export function canSpendLuck(actor) {
  return (actor?.system?.attributes?.luckPoints?.value ?? 0) > 0;
}

/**
 * The uniform trigger markup. Rendered by every caller so the affordance looks
 * and reads identically wherever it appears.
 *
 * @param {object} [opts]
 * @param {string} [opts.id]     optional element id for the caller to bind
 * @param {string} [opts.extra]  extra classes
 * @returns {string} HTML, or '' when there is nothing to offer
 */
export function luckButtonHtml({ id = '', extra = '' } = {}) {
  return `<button type="button" class="${LUCK_BUTTON_CLASS} ${extra}"${id ? ` id="${id}"` : ''}>` +
         `<i class="fas fa-clover"></i> ${game.i18n.localize('MYTHRAS.SpendLuckPoint')}</button>`;
}

/**
 * Offer the Cheat Fate options and, if one is taken, charge the point and
 * return the new result.
 *
 * Charges exactly one point, and only on a choice actually made — closing the
 * dialog, cancelling, or having no points left all cost nothing. The point is
 * deducted BEFORE the caller is told to use the new number, so a caller that
 * throws afterwards cannot leave a free re-roll behind.
 *
 * @param {Actor}  actor
 * @param {object} opts
 * @param {number} opts.result  the original d100 result
 * @param {number} opts.target  the total it was graded against, for previews
 * @param {number} [opts.basis] critical/fumble basis; defaults to target, the
 *   same defaulting `determineOutcome` itself uses
 * @param {string} [opts.label] what is being re-rolled, shown in the dialog
 * @param {boolean} [opts.allowSwap] offer the digit swap. **Defaults to true,
 *   but pass false for anything that is not a d100.** The book's swap is a
 *   percentile concept — its own example is *"a 75 would become a 57"* — and
 *   it is meaningless anywhere else: swapping a d20's 7 gives 70, off the die
 *   entirely, and swapping a damage roll's 6 gives 60. Those callers offer the
 *   re-roll alone, which is the half of Cheat Fate that does apply to "any
 *   dice roll they make".
 * @param {string} [opts.formula] dice formula for a non-d100 re-roll (e.g.
 *   '1d20', '1d8+2'). Defaults to '1d100'.
 * @returns {Promise<{result:number, mode:'reroll'|'swap', outcome:string, roll:Roll|null}|null>}
 *   null when nothing was spent
 */
export async function offerLuckPoint(actor, {
  result, target, basis, label = 'Roll', allowSwap = true, formula = '1d100',
}) {
  if (!canSpendLuck(actor)) {
    ui.notifications.warn(game.i18n.localize('MYTHRAS.NoLuckPoints'));
    return null;
  }

  const gradeBasis = basis ?? target;
  const graded     = target != null;
  const swapped    = swapDigits(result);
  const grade      = (n) => determineOutcome(n, target, gradeBasis, gradeBasis);
  // A damage or hit-location roll has no success band, so `target` is omitted
  // and the dialog states the number alone rather than inventing an outcome.
  const describe   = (n) => graded ? `${n} — ${grade(n)}` : `${n}`;

  // The swap is deterministic, so show exactly what it buys. The re-roll
  // cannot be previewed, which is the trade the player is choosing between.
  const swapPreview = swapped === result ? `${swapped} — no change` : describe(swapped);

  const content = `
    <div class="mi-luck-dialog">
      <p class="mi-luck-dialog-head">${label}: <strong>${result}</strong>${graded ? ` — ${grade(result)} (target ${target}%)` : ''}</p>
      <p class="mi-muted">${game.i18n.localize('MYTHRAS.LuckOnePerAction')}</p>
      <ul class="mi-luck-dialog-options">
        <li><strong>${game.i18n.localize('MYTHRAS.LuckPointReroll')}</strong> — a fresh ${formula}</li>
        ${allowSwap ? `<li><strong>${game.i18n.localize('MYTHRAS.LuckPointSwap')}</strong> — ${swapPreview}</li>` : ''}
      </ul>
      ${allowSwap ? '' : `<p class="mi-muted">${game.i18n.localize('MYTHRAS.LuckSwapPercentileOnly')}</p>`}
    </div>`;

  const choice = await new Promise(resolve => {
    // Dialog callbacks are not awaited (system-CLAUDE.md), so a synchronously
    // set flag is the only reliable guard against close() also resolving.
    let resolved = false;
    const pick = (mode) => { resolved = true; resolve(mode); };
    new Dialog({
      title: game.i18n.localize('MYTHRAS.SpendLuckPoint'),
      content,
      buttons: {
        reroll: { icon: '<i class="fas fa-dice"></i>', label: game.i18n.localize('MYTHRAS.LuckPointReroll'), callback: () => pick('reroll') },
        ...(allowSwap ? {
          swap: { icon: '<i class="fas fa-exchange-alt"></i>', label: game.i18n.localize('MYTHRAS.LuckPointSwap'), callback: () => pick('swap') },
        } : {}),
        cancel: { icon: '<i class="fas fa-times"></i>', label: game.i18n.localize('MYTHRAS.Cancel'), callback: () => pick(null) },
      },
      default: 'reroll',
      close: () => { if (!resolved) resolve(null); },
    }, { classes: ['dialog', 'mi-dialog'] }).render(true);
  });

  if (!choice) return null;

  // Re-check rather than trusting the pre-dialog read: the pool may have moved
  // while the dialog was open (another spend, a GM edit, a power).
  const lp = actor.system.attributes?.luckPoints;
  if (!lp || lp.value <= 0) {
    ui.notifications.warn(game.i18n.localize('MYTHRAS.NoLuckPoints'));
    return null;
  }
  await actor.update({ 'system.attributes.luckPoints.value': lp.value - 1 });

  let newResult = swapped;
  let newRoll   = null;
  if (choice === 'reroll') {
    newRoll = new Roll(formula);
    await newRoll.evaluate();
    newResult = newRoll.total;
  }

  // `roll` is returned so a caller that renders dice (a damage card's
  // breakdown, a chat message's `rolls:` array) can show the real new roll
  // rather than a bare number. Null on a swap, which produces no new dice.
  return { result: newResult, mode: choice, outcome: graded ? grade(newResult) : null, roll: newRoll };
}

/**
 * Charge one Luck Point after a plain confirmation — the spend path for the
 * uses that are NOT Cheat Fate.
 *
 * Cheat Fate offers a choice between two ways of changing a roll, so it gets
 * `offerLuckPoint`. Mitigate Damage and Desperate Effort do not: there is one
 * effect and the only question is whether the player wants it. Giving them a
 * re-roll/swap dialog would be nonsense, and hand-rolling a second confirm at
 * each call site is how the pool check and the charge drift apart. Same
 * contract as `offerLuckPoint`: nothing is charged unless a choice is made,
 * the pool is re-read after the dialog in case it moved while it was open,
 * and enforcing "one point per Action" remains the caller's job.
 *
 * @param {Actor}  actor
 * @param {object} opts
 * @param {string} opts.title           dialog title
 * @param {string} opts.prompt          HTML shown in the body — say exactly
 *   what the point buys, in the numbers of the situation at hand
 * @param {string} [opts.confirmLabel]  defaults to "Spend Luck Point"
 * @returns {Promise<boolean>} true if a point was charged
 */
export async function spendLuckPoint(actor, { title, prompt, confirmLabel }) {
  if (!canSpendLuck(actor)) {
    ui.notifications.warn(game.i18n.localize('MYTHRAS.NoLuckPoints'));
    return false;
  }

  const confirmed = await new Promise(resolve => {
    // Dialog callbacks are not awaited (system-CLAUDE.md), so a synchronously
    // set flag is the only reliable guard against close() resolving too.
    let resolved = false;
    const pick = (v) => { resolved = true; resolve(v); };
    new Dialog({
      title,
      content: `<div class="mi-luck-dialog">${prompt}
        <p class="mi-muted">${game.i18n.localize('MYTHRAS.LuckOnePerAction')}</p></div>`,
      buttons: {
        spend:  { icon: '<i class="fas fa-clover"></i>', label: confirmLabel ?? game.i18n.localize('MYTHRAS.SpendLuckPoint'), callback: () => pick(true) },
        cancel: { icon: '<i class="fas fa-times"></i>',  label: game.i18n.localize('MYTHRAS.Cancel'), callback: () => pick(false) },
      },
      default: 'spend',
      close: () => { if (!resolved) resolve(false); },
    }, { classes: ['dialog', 'mi-dialog'] }).render(true);
  });
  if (!confirmed) return false;

  const lp = actor.system.attributes?.luckPoints;
  if (!lp || lp.value <= 0) {
    ui.notifications.warn(game.i18n.localize('MYTHRAS.NoLuckPoints'));
    return false;
  }
  await actor.update({ 'system.attributes.luckPoints.value': lp.value - 1 });
  return true;
}
