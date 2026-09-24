/**
 * mythras-imperative/module/combat/change-range.js
 *
 * The Change Range combat action (Mythras Core p.91 and p.107), for the
 * optional Weapon Reach rule (v1.4.354).
 *
 *   "Change Range Combat Action – costs an Action Point, and is used on a
 *    character's Turn. ... the character's opponent has two options ... In
 *    both cases if the opponent has no Action Points left – or chooses not to
 *    spend an Action Point – then the attempt to close is automatically
 *    successful.
 *     - The combatants match Evade skills in an opposed test. If the character
 *       initiating the Change Range action wins then he can close the range to
 *       a desired distance. If the opponent wins then the existing range is
 *       maintained.
 *     - However, if the opponent decides to attack the closing character
 *       instead, then he must make an opposed roll of his combat skill versus
 *       the closing character's Evade skill. If the opponent wins, he strikes
 *       the character, and any difference in Level of Success results in
 *       Special Effects as per normal combat. Whether or not the blow lands,
 *       the closing character bridges the distance."
 *   "Opening Range works in the same way as Closing Range – but obviously in
 *    reverse. The character can use Change Range to completely withdraw from
 *    engagement."
 *   Cautious Fighter (style trait, Core p.88): "Can use the Change Range action
 *    to automatically withdraw from engagement with no need to roll".
 *
 * WHERE THINGS RUN
 *   - The mover's player chooses (their client) — from the combat tracker's
 *     context menu, like Delay, because it is taken INSTEAD of an attack.
 *   - The GM's client resolves: it spends the Action Points and stores the
 *     range, both writes a player may not be allowed to make.
 *   - The opponent's owner answers (their client). If they attack, the attack
 *     is an ordinary exchange from their client — the real Attack dialog, with
 *     the mover defending by Evade as part of the move they already paid for
 *     (no second Action Point, and not left prone).
 */

import { CombatSocket, activeGMUserId, _findDefenderUserId } from './CombatSocket.js';
import { reachRuleOn, isMeleeWeapon, weaponReach, longestMeleeReach, storedReach, setStoredReach } from './reach-state.js';
import { REACH_LABELS, reachCode, closedReach, changeRangeWins } from '../utils/reach.js';
import { spendActionPoint } from './effects/helpers.js';

const DIRECTIONS = {
  close:    'close in',
  open:     'open the range',
  withdraw: 'withdraw from the fight',
};

const apOf = (actor) => Number(actor?.system?.attributes?.actionPoints?.value) || 0;

function meleeWeaponsOf(actor) {
  return Array.from(actor?.items ?? []).filter(i => i.type === 'weapon' && isMeleeWeapon(i))
    .sort((a, b) => weaponReach(a) - weaponReach(b));
}

function hasCautiousFighter(actor) {
  return Array.from(actor?.items ?? []).some(i => i.type === 'combat-style'
    && (i.system?.traits ?? []).includes('cautiousFighter'));
}

/** The range the two are fighting at right now. */
function currentReach(a, b) {
  return storedReach(a, b) ?? Math.max(longestMeleeReach(a), longestMeleeReach(b));
}

// ── 1. The mover's choice ─────────────────────────────────────────────────────

/** Entry point: the combat tracker's "Change Range" (mover's client). */
export async function startChangeRange(mover) {
  if (!reachRuleOn()) return;
  const opponent = [...(game.user.targets ?? [])][0]?.actor ?? null;
  if (!opponent || opponent === mover) {
    ui.notifications.warn('Target the opponent you are changing range with first.');
    return;
  }
  if (apOf(mover) <= 0) {
    ui.notifications.warn(`${mover.name} has no Action Points left.`);
    return;
  }
  const choice = await moverDialog(mover, opponent);
  if (!choice) return;

  const data = { moverUuid: mover.uuid, opponentUuid: opponent.uuid, ...choice };
  if (game.user.isGM) return resolveChangeRange(data);
  const gmId = activeGMUserId();
  if (!gmId) { ui.notifications.warn('Change Range needs the GM online.'); return; }
  const result = await CombatSocket.request('changeRange', data, gmId, { timeoutMs: 30 * 60 * 1000 });
  if (!result?.ok) ui.notifications.warn('Change Range was not resolved.');
}

function moverDialog(mover, opponent) {
  const R = currentReach(mover, opponent);
  const weapons = meleeWeaponsOf(mover);
  const cautious = hasCautiousFighter(mover);
  const weaponOptions = weapons.map(w =>
    `<option value="${w.id}">${w.name} (${REACH_LABELS[reachCode(weaponReach(w))]})</option>`).join('')
    || '<option value="">Unarmed (Touch)</option>';
  const content = `
    <div class="mi-dialog">
      <p><strong>${mover.name}</strong> and <strong>${opponent.name}</strong> are fighting at <strong>${REACH_LABELS[reachCode(R)]}</strong> reach.
      Changing range costs <strong>1 Action Point</strong>; ${opponent.name} may let you, oppose with Evade, or attack as you move.</p>
      <div class="mi-form-row"><label><input type="radio" name="mi-cr-dir" value="close" checked> Close in with</label>
        <select id="mi-cr-weapon">${weaponOptions}</select></div>
      <div class="mi-form-row"><label><input type="radio" name="mi-cr-dir" value="open"> Open to the longer weapon's reach</label></div>
      <div class="mi-form-row"><label><input type="radio" name="mi-cr-dir" value="withdraw"> Withdraw from the fight${cautious ? ' <em>(Cautious Fighter — no roll)</em>' : ''}</label></div>
    </div>`;
  return new Promise(resolve => {
    new Dialog({
      title: 'Change Range',
      content,
      buttons: {
        go: { icon: '<i class="fas fa-arrows-left-right"></i>', label: 'Change Range (1 AP)',
          callback: html => resolve({
            direction: html.find('input[name="mi-cr-dir"]:checked')[0]?.value ?? 'close',
            weaponId: html.find('#mi-cr-weapon')[0]?.value || null,
          }) },
        cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel', callback: () => resolve(null) },
      },
      default: 'go',
      close: () => resolve(null),
    }).render(true);
  });
}

// ── 2. The GM resolves ────────────────────────────────────────────────────────

export async function resolveChangeRange({ moverUuid, opponentUuid, direction = 'close', weaponId = null } = {}) {
  if (!game.user.isGM) return { ok: false };
  const mover = fromUuidSync(moverUuid);
  const opponent = fromUuidSync(opponentUuid);
  if (!mover || !opponent) return { ok: false };
  if (apOf(mover) <= 0) {
    ui.notifications.warn(`${mover.name} has no Action Points left.`);
    return { ok: false };
  }
  await spendActionPoint(mover);

  const lines = [];
  let through;
  if (direction === 'withdraw' && hasCautiousFighter(mover)) {
    through = true;
    lines.push('Cautious Fighter — no roll needed.');
  } else if (apOf(opponent) <= 0) {
    through = true;
    lines.push(`${opponent.name} has no Action Points left to stop it.`);
  } else {
    const ownerId = _findDefenderUserId(opponent);
    const reply = await CombatSocket.request('changeRangeResponse',
      { moverUuid, opponentUuid, direction }, ownerId, { timeoutMs: 10 * 60 * 1000 });
    const response = reply?.response ?? 'let';
    if (response === 'evade') {
      await spendActionPoint(opponent);
      const api = game.system.api;
      const prompt = `${mover.name} tries to ${DIRECTIONS[direction]}. Opposed Evade.`;
      const [m, o] = await Promise.all([
        api.requestSkillCheck(mover, { skillNames: ['Evade'], title: 'Evade (Change Range)', prompt }),
        api.requestSkillCheck(opponent, { skillNames: ['Evade'], title: 'Evade (Change Range)', prompt }),
      ]);
      through = changeRangeWins(m, o);
      lines.push(`Evade: ${mover.name} ${m?.roll ?? '—'} (${m?.grade ?? 'no roll'}) vs ${opponent.name} ${o?.roll ?? '—'} (${o?.grade ?? 'no roll'}).`);
    } else if (response === 'attack') {
      // The attack was made from the opponent's client; it has already resolved.
      through = true;
      lines.push(`${opponent.name} attacked as ${mover.name} moved. Whether or not the blow landed, the move goes through.`);
    } else {
      through = true;
      lines.push(`${opponent.name} let it happen.`);
    }
  }

  let outcome;
  if (!through) {
    outcome = `${mover.name} could not ${DIRECTIONS[direction]} — the range is unchanged.`;
  } else if (direction === 'close') {
    const weapon = weaponId ? mover.items.get(weaponId) : null;
    const w = weapon ? weaponReach(weapon) : 0;   // no weapon: Unarmed, Touch
    const R = closedReach(w, longestMeleeReach(opponent));
    await setStoredReach(mover, opponent, R);
    outcome = `${mover.name} closes in — they now fight at ${REACH_LABELS[reachCode(R)]} reach.`;
  } else if (direction === 'open') {
    await setStoredReach(mover, opponent, null);
    outcome = `${mover.name} opens the range — back to the longer weapon's reach.`;
  } else {
    await setStoredReach(mover, opponent, null);
    outcome = `${mover.name} withdraws from ${opponent.name}. On their next Turn (1 AP) they may re-roll Initiative, flee, engage someone new, or act otherwise.`;
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: mover }),
    content: `<div class="mi-chat-card"><strong>Change Range</strong><br>${lines.join('<br>')}<br><strong>${outcome}</strong></div>`,
    flags: { 'mythras-imperative': { changeRange: { moverUuid, opponentUuid, direction, through } } },
  });
  return { ok: true, through };
}

// ── 3. The opponent answers ───────────────────────────────────────────────────

async function respond({ moverUuid, opponentUuid, direction }) {
  const mover = fromUuidSync(moverUuid);
  const opponent = fromUuidSync(opponentUuid);
  if (!mover || !opponent) return { response: 'let' };
  const response = await new Promise(resolve => {
    new Dialog({
      title: `Change Range — ${opponent.name}`,
      content: `<div class="mi-dialog"><p><strong>${mover.name}</strong> tries to <strong>${DIRECTIONS[direction] ?? direction}</strong> with ${opponent.name}.</p>
        <p>Let them (no Action Point), oppose with <strong>Evade</strong>, or <strong>attack</strong> as they move — your combat skill against their Evade. If you attack, they get through whatever happens.</p></div>`,
      buttons: {
        let:    { icon: '<i class="fas fa-hand"></i>', label: 'Let them', callback: () => resolve('let') },
        evade:  { icon: '<i class="fas fa-person-running"></i>', label: 'Oppose with Evade (1 AP)', callback: () => resolve('evade') },
        attack: { icon: '<i class="fas fa-khanda"></i>', label: 'Attack (1 AP)', callback: () => resolve('attack') },
      },
      default: 'let',
      close: () => resolve('let'),
    }).render(true);
  });
  if (response === 'attack') await attackAsTheyMove(opponent, mover);
  return { response };
}

/** An ordinary attack, the mover defending with Evade as part of their move. */
async function attackAsTheyMove(attacker, mover) {
  const { CombatEngine } = await import('./CombatEngine.js');
  const weapons = meleeWeaponsOf(attacker);
  const weapon = weapons[weapons.length - 1] ?? null;   // the longest: the one the mover is running at
  if (!weapon) { ui.notifications.warn(`${attacker.name} has no melee weapon to attack with.`); return; }
  const ctx = CombatEngine._buildContext(attacker, mover, weapon);
  ctx._targetActors = [mover];
  ctx.changeRangeEvade = true;
  await CombatEngine._runDialog(ctx);
}

// ── Wiring ────────────────────────────────────────────────────────────────────

export function registerChangeRange() {
  CombatSocket.registerRequestHandler('changeRange', (data) => resolveChangeRange(data));
  CombatSocket.registerRequestHandler('changeRangeResponse', (data) => respond(data));

  Hooks.on('getCombatTrackerContextOptions', (_app, entries) => {
    if (!Array.isArray(entries)) return;
    entries.push({
      label: 'Change Range',
      icon: 'fa-solid fa-arrows-left-right',
      visible: li => {
        if (!reachRuleOn()) return false;
        const c = game.combat?.combatants?.get(li?.dataset?.combatantId);
        const actor = c?.token?.actor ?? c?.actor ?? null;
        return !!actor && actor.isOwner;
      },
      onClick: async (_event, li) => {
        const c = game.combat?.combatants?.get(li?.dataset?.combatantId);
        const actor = c?.token?.actor ?? c?.actor ?? null;
        if (actor) await startChangeRange(actor);
      },
    });
  });
}
