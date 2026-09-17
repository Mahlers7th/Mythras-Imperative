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
 *   - the damage roll, at the `computeDamage` seam (v1.4.328), and the
 *     defence roll, between its roll and the outcome card (v1.4.331)
 *   - a spell or Special Effect resistance roll, IF the site is first split
 *     into roll -> offer -> apply (not done)
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

// ═══════════════════════════════════════════════════════════════════════════
// WHEN TO ASK — the per-player "Luck Point prompts" setting (v1.4.334)
// ═══════════════════════════════════════════════════════════════════════════
//
// Once offers reached the right player (v1.4.332/333), a character with Luck
// Points was stopped by a modal after their attack, defence and damage rolls
// on every exchange, whatever they rolled. Chris's ruling (2026-09-17): each
// player chooses between being asked on every roll, or only after a setback —
// a failed or fumbled d100, or a damage roll below the formula's average.
//
// This governs only the engine's MODAL offers. A Luck button the player clicks
// of their own accord — a skill roll's chat card, the hit-location card, the
// GM Mode panel, Mitigate Damage — is not an interruption and stays available.
// Desperate Effort also stays unconditional: it is only ever offered at 0
// Action Points, which is a setback by definition.

export const LUCK_PROMPT_SETTING = 'luckPromptMode';
export const LUCK_PROMPT_ALWAYS   = 'always';
export const LUCK_PROMPT_SETBACKS = 'setbacks';

/**
 * The range of a plain dice-sum formula such as `1d8+1d4` or `2d6-1d2+1`.
 * Pure: takes already-parsed terms, so it can be tested without Foundry.
 *
 * The mean is the midpoint of min and max, which is exact for any sum or
 * difference of fair dice and constants — each die's mean is the midpoint of
 * its own faces, and means add. A negative die swaps its own ends, which is
 * why subtraction adds `-hi` to the minimum rather than `-lo`.
 *
 * Anything else — multiplication, keep/drop modifiers, nested rolls — returns
 * null rather than a wrong answer; callers treat null as "cannot tell".
 *
 * @param {Array<{kind:'die', number:number, faces:number}
 *              |{kind:'num', number:number}
 *              |{kind:'op', operator:string}>} terms
 * @returns {{min:number, max:number, mean:number}|null}
 */
export function diceRange(terms) {
  let min = 0;
  let max = 0;
  let sign = 1;
  let operands = 0;
  for (const t of terms ?? []) {
    if (t?.kind === 'op') {
      if (t.operator === '-') sign = -sign;
      else if (t.operator !== '+') return null;
      continue;
    }
    let lo;
    let hi;
    if (t?.kind === 'die') {
      if (!Number.isInteger(t.number) || t.number < 0) return null;
      if (!Number.isInteger(t.faces)  || t.faces  < 1) return null;
      lo = t.number;
      hi = t.number * t.faces;
    } else if (t?.kind === 'num') {
      if (!Number.isFinite(t.number)) return null;
      lo = hi = t.number;
    } else {
      return null;
    }
    if (sign > 0) { min += lo; max += hi; }
    else          { min -= hi; max -= lo; }
    sign = 1;
    operands += 1;
  }
  if (!operands) return null;
  return { min, max, mean: (min + max) / 2 };
}

/**
 * Whether the engine should stop and offer a Luck Point on this roll.
 *
 * Two cases are skipped in EVERY mode, because no choice is lost: a critical
 * cannot be improved by re-rolling or swapping it, and a damage roll already
 * at its maximum cannot be beaten. The critical case still asks when the same
 * point could instead be aimed at someone else's roll (`otherRollAtStake`) —
 * the defender forcing an attacker's successful attack to be re-rolled.
 *
 * Graded d100 rolls pass `outcome`; damage rolls pass `total` and `range`.
 * A roll this cannot judge is offered — suppressing a legal choice on a guess
 * is worse than one prompt too many.
 *
 * @param {object} p
 * @param {string} [p.mode]  LUCK_PROMPT_ALWAYS or LUCK_PROMPT_SETBACKS
 * @param {'critical'|'success'|'failure'|'fumble'|null} [p.outcome]
 * @param {number|null} [p.total]  an ungraded roll's total
 * @param {{max:number, mean:number}|null} [p.range]  from `diceRange`
 * @param {boolean} [p.otherRollAtStake]
 * @returns {boolean}
 */
export function shouldOfferLuck({
  mode = LUCK_PROMPT_ALWAYS, outcome = null, total = null, range = null, otherRollAtStake = false,
} = {}) {
  const setbacksOnly = mode === LUCK_PROMPT_SETBACKS;

  if (outcome) {
    if (outcome === 'critical' && !otherRollAtStake) return false;
    if (!setbacksOnly) return true;
    return outcome === 'failure' || outcome === 'fumble';
  }

  if (total != null && range) {
    if (total >= range.max) return false;
    if (!setbacksOnly) return true;
    return total < range.mean;
  }

  return true;
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
 * @param {{id: string, label: string, description?: string, icon?: string}[]} [opts.extraActions]
 *   further things this one point could buy, offered alongside the re-roll.
 *   Added for *"characters can even force an opponent to re-roll an attack or
 *   damage roll made against them"* (v1.4.331), which is a Cheat Fate option
 *   with a different **target** rather than a different use — same point, same
 *   one-per-Action limit, same dialog. Choosing one charges the point and
 *   returns `{ mode: <id> }` with `result` unchanged; the consequence belongs
 *   to the caller, because only the caller knows whose roll it is rewriting.
 *   An `id` of 'reroll' or 'swap' is rejected rather than silently shadowing
 *   the built-ins.
 * @returns {Promise<{result:number, mode:string, outcome:string, roll:Roll|null}|null>}
 *   null when nothing was spent
 */
export async function offerLuckPoint(actor, {
  result, target, basis, label = 'Roll', allowSwap = true, formula = '1d100',
  extraActions = [],
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

  // Reject ids that would shadow the built-in modes — a caller cannot be
  // allowed to make 'reroll' mean something else, because the return value's
  // `mode` is how every caller tells the outcomes apart.
  const extras = (extraActions ?? []).filter(a => a?.id && a.id !== 'reroll' && a.id !== 'swap');

  const content = `
    <div class="mi-luck-dialog">
      <p class="mi-luck-dialog-head">${label}: <strong>${result}</strong>${graded ? ` — ${grade(result)} (target ${target}%)` : ''}</p>
      <p class="mi-muted">${game.i18n.localize('MYTHRAS.LuckOnePerAction')}</p>
      <ul class="mi-luck-dialog-options">
        <li><strong>${game.i18n.localize('MYTHRAS.LuckPointReroll')}</strong> — a fresh ${formula}</li>
        ${allowSwap ? `<li><strong>${game.i18n.localize('MYTHRAS.LuckPointSwap')}</strong> — ${swapPreview}</li>` : ''}
        ${extras.map(a => `<li><strong>${a.label}</strong>${a.description ? ` — ${a.description}` : ''}</li>`).join('')}
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
        ...Object.fromEntries(extras.map(a => [a.id, {
          icon:     a.icon ?? '<i class="fas fa-reply"></i>',
          label:    a.label,
          callback: () => pick(a.id),
        }])),
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

  // An extra action changes something the caller owns, not this roll, so the
  // result comes back untouched and the caller acts on `mode`.
  if (choice !== 'reroll' && choice !== 'swap') {
    return { result, mode: choice, outcome: graded ? grade(result) : null, roll: null };
  }

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

// ═══════════════════════════════════════════════════════════════════════════
// ROUTING — put the offer in front of the person whose point it is
// ═══════════════════════════════════════════════════════════════════════════
//
// Every offer above renders on whatever client calls it. That is correct in GM
// Mode, where the GM plays both sides, and wrong at a real table: the engine
// runs on the ATTACKER's client, so without routing the defender's Luck
// decisions appear on someone else's screen, and the attacker's appear only if
// that someone happens to be the GM running the inline panel.
//
// It is also a permissions fact, not only a courtesy. A player's client cannot
// write to another player's actor, so `actor.update` for the charge has to run
// where the owner is. Routing the DECISION rather than the RESULT settles both
// halves at once: the dialog appears for the owner, and the charge happens on
// their client where it is allowed.
//
// Fallback is deliberate and quiet: no owning user, or the owner is offline, or
// the owner is me — run locally. That is exactly the pre-routing behaviour, so
// a solo GM session and GM Mode are unchanged.

/**
 * The user who should be asked to make an actor's Luck decisions.
 *
 * Reuses `_findDefenderUserId` rather than restating its loop — one definition
 * of "the active player who owns this actor" for the whole system. Its name is
 * defender-shaped because the defence challenge was its first caller; the rule
 * it implements ("first active non-GM user with OWNER permission") is general.
 *
 * @param {Actor} actor
 * @returns {string|null} a user id, or null to decide locally
 */
export async function luckDecisionUserId(actor) {
  if (!actor) return null;
  const { _findDefenderUserId } = await import('../combat/CombatSocket.js');
  const userId = _findDefenderUserId(actor);
  // Same client means no round trip — call the local path directly.
  return (userId && userId !== game.user.id) ? userId : null;
}

/**
 * A user's "Luck Point prompts" choice.
 *
 * The setting is user-scoped, and the server sends every user's Setting
 * documents to every client, so the GM's client — which runs the exchange —
 * can read a player's choice directly and skip an unwanted offer before it is
 * ever sent. Deciding on this side rather than the player's also spares the GM
 * a "waiting for …" notice for an offer that was never going to appear.
 * `game.settings.get` only reads the CURRENT user's value, hence the storage
 * lookup for anyone else.
 *
 * @param {string|null} userId  null means the current user
 * @returns {string} LUCK_PROMPT_ALWAYS or LUCK_PROMPT_SETBACKS
 */
export function luckPromptModeFor(userId) {
  const id = `mythras-imperative.${LUCK_PROMPT_SETTING}`;
  try {
    if (!userId || userId === game.user.id) {
      return game.settings.get('mythras-imperative', LUCK_PROMPT_SETTING) ?? LUCK_PROMPT_ALWAYS;
    }
    const doc = game.settings.storage.get('world')?.getSetting(id, userId);
    return doc?.value ?? game.settings.settings.get(id)?.default ?? LUCK_PROMPT_ALWAYS;
  } catch (err) {
    console.warn('Mythras | could not read a Luck Point prompt setting', err);
    return LUCK_PROMPT_ALWAYS;
  }
}

/**
 * `diceRange` for a Foundry formula string. Null when the formula is not a
 * plain sum of standard dice and numbers (a `Coin` or `FateDie` is not a
 * `Die`, and any modifier such as `kh` changes the distribution).
 *
 * @param {string} formula
 * @returns {{min:number, max:number, mean:number}|null}
 */
export function formulaRange(formula) {
  try {
    const { Die, NumericTerm, OperatorTerm } = foundry.dice.terms;
    const terms = new Roll(formula).terms.map(t => {
      if (t instanceof Die && !t.modifiers?.length) return { kind: 'die', number: t.number, faces: t.faces };
      if (t instanceof NumericTerm)  return { kind: 'num', number: t.number };
      if (t instanceof OperatorTerm) return { kind: 'op', operator: t.operator };
      return { kind: 'unsupported' };
    });
    return diceRange(terms);
  } catch (err) {
    console.warn(`Mythras | could not read the range of "${formula}"`, err);
    return null;
  }
}

/**
 * Whether the player who decides this actor's Luck wants to be asked about
 * this roll. The caller passes what it knows about the roll, as for
 * `shouldOfferLuck`; this adds whose setting applies.
 *
 * @param {Actor}  actor
 * @param {object} roll  `shouldOfferLuck`'s arguments, minus `mode`
 * @returns {Promise<boolean>}
 */
export async function wantsLuckPrompt(actor, roll = {}) {
  const deciderId = await luckDecisionUserId(actor);
  return shouldOfferLuck({ ...roll, mode: luckPromptModeFor(deciderId) });
}

/**
 * Run a Luck request that arrived over the socket. **Receiving side only.**
 *
 * Called by `CombatSocket`'s `mythras.luckChallenge` case on the owner's
 * client. Resolves the actor locally, shows the real dialog, charges the real
 * point, and returns a plain object — no Roll instances, which cannot cross a
 * socket.
 *
 * The rolled dice are sent back in two forms on purpose: `rollJSON` so the
 * asking client can rebuild a live Roll for the chat card's dice breakdown, and
 * a plain `dice` array so it can still do the arithmetic if rehydration fails.
 * A damage card that shows one roll's dice under another roll's total is a bug
 * this system has already had twice (v1.4.329, v1.4.330).
 *
 * @param {object} data  { kind, actorId, tokenId, ...options }
 * @returns {Promise<object|null>}
 */
export async function _runLuckRequest(data) {
  const { resolveTokenActor } = await import('../utils/actor-resolution.js');
  const actor = resolveTokenActor(data.tokenId ?? data.actorId) ?? game.actors.get(data.actorId);
  if (!actor) return null;

  if (data.kind === 'spend') {
    const spent = await spendLuckPoint(actor, {
      title:        data.title,
      prompt:       data.prompt,
      confirmLabel: data.confirmLabel,
    });
    return spent ? { spent: true } : null;
  }

  const spend = await offerLuckPoint(actor, {
    result:       data.result,
    target:       data.target,
    basis:        data.basis,
    label:        data.label,
    allowSwap:    data.allowSwap,
    formula:      data.formula,
    extraActions: data.extraActions,
  });
  if (!spend) return null;

  return {
    result:   spend.result,
    mode:     spend.mode,
    outcome:  spend.outcome,
    rollJSON: spend.roll ? spend.roll.toJSON() : null,
    dice:     spend.roll
      ? spend.roll.terms.filter(t => t.faces)
          .flatMap(t => (t.results ?? []).map(r => ({ faces: t.faces, result: r.result ?? r })))
      : [],
  };
}

/** Rebuild a live Roll from a socketed payload, or null if it cannot be. */
function _rehydrateRoll(rollJSON) {
  if (!rollJSON) return null;
  try {
    return Roll.fromData(rollJSON);
  } catch (err) {
    console.warn('Mythras | could not rehydrate a routed Luck Point roll', err);
    return null;
  }
}

/**
 * `offerLuckPoint`, shown to whoever owns the actor.
 *
 * Same arguments, same return shape — `roll` comes back as a live Roll when the
 * decision was remote and could be rehydrated. Callers that need the dice for
 * arithmetic should prefer the `dice` array, which survives either way.
 *
 * @param {Actor}  actor
 * @param {object} opts  as `offerLuckPoint`
 * @returns {Promise<{result:number, mode:string, outcome:string, roll:Roll|null, dice:object[]}|null>}
 */
export async function offerLuckPointRouted(actor, opts = {}) {
  const targetUserId = await luckDecisionUserId(actor);
  if (!targetUserId) {
    const spend = await offerLuckPoint(actor, opts);
    if (!spend) return null;
    return {
      ...spend,
      dice: spend.roll
        ? spend.roll.terms.filter(t => t.faces)
            .flatMap(t => (t.results ?? []).map(r => ({ faces: t.faces, result: r.result ?? r })))
        : [],
    };
  }

  const { CombatSocket } = await import('../combat/CombatSocket.js');
  ui.notifications.info(game.i18n.format('MYTHRAS.LuckAsking', { name: actor.name }));

  const reply = await CombatSocket.luckChallenge(
    foundry.utils.randomID(),
    {
      kind:    'offer',
      actorId: actor.id,
      tokenId: actor.token?.id ?? null,
      result:  opts.result, target: opts.target, basis: opts.basis,
      label:   opts.label, allowSwap: opts.allowSwap, formula: opts.formula,
      extraActions: opts.extraActions ?? [],
    },
    targetUserId
  );
  if (!reply) return null;

  return {
    result:  reply.result,
    mode:    reply.mode,
    outcome: reply.outcome,
    roll:    _rehydrateRoll(reply.rollJSON),
    dice:    reply.dice ?? [],
  };
}

/**
 * `spendLuckPoint`, shown to whoever owns the actor.
 *
 * @param {Actor}  actor
 * @param {object} opts  as `spendLuckPoint`
 * @returns {Promise<boolean>} true if a point was charged
 */
export async function spendLuckPointRouted(actor, opts = {}) {
  const targetUserId = await luckDecisionUserId(actor);
  if (!targetUserId) return spendLuckPoint(actor, opts);

  const { CombatSocket } = await import('../combat/CombatSocket.js');
  ui.notifications.info(game.i18n.format('MYTHRAS.LuckAsking', { name: actor.name }));

  const reply = await CombatSocket.luckChallenge(
    foundry.utils.randomID(),
    {
      kind:    'spend',
      actorId: actor.id,
      tokenId: actor.token?.id ?? null,
      title:   opts.title, prompt: opts.prompt, confirmLabel: opts.confirmLabel,
    },
    targetUserId
  );
  return reply?.spent === true;
}
