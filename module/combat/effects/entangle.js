/**
 * module/combat/effects/entangle.js
 *
 * SE resolver for Entangle, plus the follow-up turn logic:
 *   - resolveEntangle           — SE resolver (called via SE_RESOLVERS dispatch)
 *   - postEntangleTripCard      — called from updateCombat at start of attacker's turn
 *   - resolveEntangleTripYes    — called from mythras.mjs button handler
 *   - resolveEntangleBreakFree  — called from updateCombat at start of defender's turn
 *
 * Dependencies:
 *   helpers.js  — applyStatusToActor, removeStatusFromActor, applyFatigueToSkill,
 *                 runSEDialog, applyProneToDefender, spendActionPoint
 *   combat-math.js — resolveOpposedRoll, classifyLocation
 *   ../CombatSocket.js — dynamic import for non-GM semi-auto socket routing
 */

import {
  applyStatusToActor,
  removeStatusFromActor,
  applyFatigueToSkill,
  runSEDialog,
  applyProneToDefender,
  spendActionPoint,
} from './helpers.js';
import { resolveOpposedRoll, classifyLocation } from '../../utils/combat-math.js';

const NS = 'mythras-imperative';

// -------------------------------------------------------------------------
// resolveEntangle — SE: Entangle
// Rules p.44: Offensive, Entangling weapons only. No opposed roll — the
// location is immediately entangled. Effects depend on location type.
// -------------------------------------------------------------------------
export async function resolveEntangle(ctx, damage, forcesFail) {
  const { attacker, defender } = ctx;
  const attackRoll = ctx.attackResult ?? 0;

  // Resolve base actor for persistent flag writes (ctx actors may be synthetic)
  const baseAttacker = game.actors.get(attacker.id) ?? attacker;
  const baseDefender = game.actors.get(defender.id) ?? defender;

  const _rawLabel = ctx.hitLocationLabel
    || (ctx.hitLocationId ? (defender.items.get(ctx.hitLocationId)?.name ?? '') : '')
    || 'the struck location';
  const locType  = ctx.locationType ?? classifyLocation(_rawLabel);
  const locLabel = _rawLabel;
  const gradeHard = locType === 'head' || locType === 'torso';

  const armWords = /arm|hand/i.test(locLabel);
  const legWords = /leg|foot/i.test(locLabel);
  const limbNote = armWords
    ? `${defender.name}'s ${locLabel} is snared — cannot use whatever it is holding`
    : legWords
      ? `${defender.name}'s ${locLabel} is snared — cannot move`
      : `${defender.name}'s ${locLabel} is entangled`;
  const effectNote = gradeHard
    ? `${defender.name}'s ${locLabel} is enmeshed — all skill rolls Hard`
    : limbNote;

  const entangleId = foundry.utils.randomID(8);

  // Write entangled state to defender
  const entangledBy = baseDefender.getFlag(NS, 'entangledBy') ?? {};
  entangledBy[entangleId] = {
    attackerActorId:    attacker.id,
    attackerName:       attacker.name,
    attackerRoll:       attackRoll,
    attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
    lastCardId:         ctx.chatMessageId,
    weaponName:         ctx.weapon?.name ?? 'weapon',
    locationType:       locType,
    locationLabel:      locLabel,
    gradeHard,
    entangleId
  };
  await baseDefender.setFlag(NS, 'entangledBy', entangledBy);
  await applyStatusToActor(defender, 'entangled');

  // Queue trip attempt for attacker's next turn
  const pendingEntangleTrip = baseAttacker.getFlag(NS, 'pendingEntangleTrip') ?? {};
  pendingEntangleTrip[entangleId] = {
    defenderId:         defender.id,
    defenderName:       defender.name,
    attackerRoll:       attackRoll,
    attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
    lastCardId:         ctx.chatMessageId,
    locationLabel:      locLabel,
    entangleId
  };
  await baseAttacker.setFlag(NS, 'pendingEntangleTrip', pendingEntangleTrip);

  // Queue break-free attempt for defender's next turn
  const pendingEntangleBreakFree = baseDefender.getFlag(NS, 'pendingEntangleBreakFree') ?? {};
  pendingEntangleBreakFree[entangleId] = {
    attackerActorId:    attacker.id,
    attackerName:       attacker.name,
    attackerRoll:       attackRoll,
    attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
    lastCardId:         ctx.chatMessageId,
    weaponName:         ctx.weapon?.name ?? 'weapon',
    locationLabel:      locLabel,
    gradeHard,
    entangleId
  };
  await baseDefender.setFlag(NS, 'pendingEntangleBreakFree', pendingEntangleBreakFree);

  await ChatMessage.create({
    content: `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker.name} → ${defender.name}</span>
          <span class="mi-card-skill">Entangle — ${locLabel}</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-outcome-row">
            <span class="mi-outcome mi-wound-serious">
              <i class="fas fa-spider"></i> ${effectNote}
            </span>
          </div>
          ${gradeHard ? `<div class="mi-se-roll-row">
            <span class="mi-se-roll-label">Skill penalty</span>
            <span class="mi-se-roll-val">Hard (all skills while enmeshed)</span>
          </div>` : ''}
          <p class="mi-se-roll-note">
            ${attacker.name} may spend 1 AP at the start of their next turn to attempt an automatic Trip.<br>
            ${defender.name} may attempt to break free (Brawn) at the start of their next turn.
          </p>
        </div>
      </div>`,
    speaker: ChatMessage.getSpeaker({ actor: attacker })
  });
}

// -------------------------------------------------------------------------
// postEntangleTripCard — called from updateCombat at the start of the
// attacker's (wielder's) turn. Posts a card offering to spend 1 AP for
// an automatic Trip attempt.
// entry: one entry from flags['mythras-imperative'].pendingEntangleTrip
// -------------------------------------------------------------------------
export async function postEntangleTripCard(attackerActor, entry) {
  const { defenderId, defenderName, attackerRoll, attackerSkillTotal, locationLabel, entangleId } = entry;

  await ChatMessage.create({
    content: `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attackerActor.name} → ${defenderName}</span>
          <span class="mi-card-skill">Entangle — Trip Attempt?</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-outcome-row">
            <span class="mi-outcome mi-wound-serious">
              <i class="fas fa-spider"></i> ${defenderName} is still entangled at ${locationLabel}
            </span>
          </div>
          <p class="mi-se-roll-note">
            ${attackerActor.name} may spend 1 AP to attempt an automatic Trip against ${defenderName}.<br>
            ${defenderName} will resist with Brawn if the trip is attempted.
          </p>
          <div class="mi-manual-actions">
            <button class="mi-btn mi-btn-entangle-trip-yes"
              data-attacker-id="${attackerActor.id}"
              data-defender-id="${defenderId}"
              data-attacker-roll="${attackerRoll}"
              data-attacker-skill-total="${attackerSkillTotal}"
              data-entangle-id="${entangleId}">
              <i class="fas fa-hiking"></i> Spend 1 AP — Trip ${defenderName}
            </button>
            <button class="mi-btn mi-btn-entangle-trip-no"
              data-attacker-id="${attackerActor.id}"
              data-entangle-id="${entangleId}">
              <i class="fas fa-times"></i> Skip — Act normally
            </button>
          </div>
        </div>
      </div>`,
    speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
    flags: {
      [NS]: {
        stage:      'entangle-trip',
        attackerId: attackerActor.id,
        defenderId,
        entangleId
      }
    }
  });
}

// -------------------------------------------------------------------------
// resolveEntangleTripYes — called from mythras.mjs button handler when the
// attacker clicks "Spend 1 AP — Trip". Runs the opposed Brawn resistance.
// -------------------------------------------------------------------------
export async function resolveEntangleTripYes(btn) {
  const attackerId         = btn.dataset.attackerId;
  const defenderId         = btn.dataset.defenderId;
  const attackerRoll       = parseInt(btn.dataset.attackerRoll ?? '0', 10);
  const attackerSkillTotal = parseInt(btn.dataset.attackerSkillTotal ?? '0', 10);
  const entangleId         = btn.dataset.entangleId;

  const attacker = game.actors.get(attackerId);
  const defender = game.actors.get(defenderId);
  if (!attacker || !defender) return;

  await spendActionPoint(attacker);

  const isSemi   = game.settings.get(NS, 'automationLevel') === 'semi';
  const isGMMode = game.settings.get(NS, 'gmMode') ?? false;

  const brawnSkill = Array.from(defender.items).find(i => i.type === 'skill' && i.name === 'Brawn');
  const brawnRaw   = brawnSkill?.system.total ?? 0;
  const brawnTotal = applyFatigueToSkill(brawnRaw, defender);

  let defenderRoll     = null;
  let defenderSucceeds = false;

  if (isSemi && !isGMMode) {
    const { CombatSocket, _findDefenderUserId } = await import('../CombatSocket.js');
    const targetUserId = _findDefenderUserId(defender);
    const exchangeId   = foundry.utils.randomID(16);
    const response = await CombatSocket.seChallenge(exchangeId, {
      seType:             'entangleTrip',
      attackerName:       attacker.name,
      defenderName:       defender.name,
      attackRoll:         attackerRoll,
      attackerSkillTotal,
      defenderSkill:      'Brawn',
      defenderRaw:        brawnRaw,
      defenderTotal:      brawnTotal
    }, targetUserId);
    defenderRoll     = response?.roll     ?? null;
    defenderSucceeds = response?.succeeds ?? false;
  } else if (isSemi && isGMMode) {
    const response = await runSEDialog({
      seType:             'entangleTrip',
      attackerName:       attacker.name,
      defenderName:       defender.name,
      attackRoll:         attackerRoll,
      attackerSkillTotal,
      lastCardId:         null,
      defenderSkill:      'Brawn',
      defenderRaw:        brawnRaw,
      defenderTotal:      brawnTotal
    });
    defenderRoll     = response?.roll     ?? null;
    defenderSucceeds = response?.succeeds ?? false;
  } else {
    const roll = new Roll('1d100');
    await roll.evaluate();
    defenderRoll     = roll.total;
    defenderSucceeds = resolveOpposedRoll(
      attackerRoll, attackerSkillTotal,
      defenderRoll, brawnTotal
    );
  }

  const tripApplied = !defenderSucceeds;
  if (tripApplied) await applyProneToDefender(defender);

  await ChatMessage.create({
    content: `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker.name} → ${defender.name}</span>
          <span class="mi-card-skill">Entangle Trip — ${tripApplied ? 'Success' : 'Resisted'}</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-outcome-row">
            <span class="mi-outcome ${tripApplied ? 'success' : 'mi-wound-minor'}">
              <i class="fas fa-${tripApplied ? 'check-circle' : 'times-circle'}"></i>
              ${tripApplied ? `${defender.name} is knocked prone` : `${defender.name} maintains balance`}
            </span>
          </div>
          <div class="mi-se-roll-row">
            <span class="mi-se-roll-label">${defender.name} — Brawn</span>
            <span class="mi-se-roll-val">${defenderRoll ?? 'auto'} vs ${brawnTotal}%</span>
          </div>
        </div>
      </div>`,
    speaker: ChatMessage.getSpeaker({ actor: attacker })
  });
}

// -------------------------------------------------------------------------
// resolveEntangleBreakFree — called from updateCombat at the start of the
// entangled victim's turn. Runs the opposed Brawn break-free roll.
// Clears flags on success; re-queues on failure.
// entry: one entry from flags['mythras-imperative'].pendingEntangleBreakFree
// -------------------------------------------------------------------------
export async function resolveEntangleBreakFree(entangledActor, entry, entangleId) {
  const { attackerActorId, attackerName, attackerRoll, attackerSkillTotal, weaponName, locationLabel } = entry;

  const isSemi   = game.settings.get(NS, 'automationLevel') === 'semi';
  const isGMMode = game.settings.get(NS, 'gmMode') ?? false;

  const brawnSkill = Array.from(entangledActor.items).find(i => i.type === 'skill' && i.name === 'Brawn');
  const brawnRaw   = brawnSkill?.system.total ?? 0;
  const brawnTotal = applyFatigueToSkill(brawnRaw, entangledActor);

  let defenderRoll = null;
  let freeSucceeds = false;

  if (isSemi && !isGMMode) {
    const { CombatSocket, _findDefenderUserId } = await import('../CombatSocket.js');
    const targetUserId = _findDefenderUserId(entangledActor);
    const exchangeId   = foundry.utils.randomID(16);
    const response = await CombatSocket.seChallenge(exchangeId, {
      seType:             'entangleBreakFree',
      attackerName,
      defenderName:       entangledActor.name,
      attackRoll:         attackerRoll,
      attackerSkillTotal,
      defenderSkill:      'Brawn',
      defenderRaw:        brawnRaw,
      defenderTotal:      brawnTotal,
      weaponName,
      locationLabel
    }, targetUserId);
    defenderRoll = response?.roll     ?? null;
    freeSucceeds = response?.succeeds ?? false;
  } else if (isSemi && isGMMode) {
    const response = await runSEDialog({
      seType:             'entangleBreakFree',
      attackerName,
      defenderName:       entangledActor.name,
      attackRoll:         attackerRoll,
      attackerSkillTotal,
      lastCardId:         null,
      defenderSkill:      'Brawn',
      defenderRaw:        brawnRaw,
      defenderTotal:      brawnTotal,
      weaponName,
      locationLabel
    });
    defenderRoll = response?.roll     ?? null;
    freeSucceeds = response?.succeeds ?? false;
  } else {
    const roll = new Roll('1d100');
    await roll.evaluate();
    defenderRoll = roll.total;
    freeSucceeds = resolveOpposedRoll(
      attackerRoll, attackerSkillTotal,
      defenderRoll, brawnTotal
    );
  }

  // Resolve base actor for persistent flag writes
  const baseEntangled = game.actors.get(entangledActor.id) ?? entangledActor;

  if (freeSucceeds) {
    const entangledBy = baseEntangled.getFlag(NS, 'entangledBy') ?? {};
    delete entangledBy[entangleId];
    await baseEntangled.setFlag(NS, 'entangledBy', entangledBy);

    if (Object.keys(entangledBy).length === 0) {
      await removeStatusFromActor(entangledActor, 'entangled');
    }

    // Clear attacker's pending trip for this entangle
    const attackerActor = game.actors.get(attackerActorId);
    if (attackerActor) {
      const pending = attackerActor.getFlag(NS, 'pendingEntangleTrip') ?? {};
      if (pending[entangleId]) {
        delete pending[entangleId];
        await attackerActor.setFlag(NS, 'pendingEntangleTrip', pending);
      }
    }

    await ChatMessage.create({
      content: `
        <div class="mi-chat-card">
          <div class="mi-card-header mi-card-header--stacked">
            <span class="mi-card-actor">${entangledActor.name} vs ${attackerName}</span>
            <span class="mi-card-skill">Break Free from Entangle — Success</span>
          </div>
          <div class="mi-card-body">
            <div class="mi-outcome-row">
              <span class="mi-outcome success">
                <i class="fas fa-check-circle"></i> ${entangledActor.name} yanks free of ${weaponName}
              </span>
            </div>
            <div class="mi-se-roll-row">
              <span class="mi-se-roll-label">${entangledActor.name} — Brawn</span>
              <span class="mi-se-roll-val">${defenderRoll ?? 'auto'} vs ${brawnTotal}%</span>
            </div>
          </div>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor: entangledActor })
    });
  } else {
    // Still entangled — re-queue for next turn
    const pendingBreakFree = baseEntangled.getFlag(NS, 'pendingEntangleBreakFree') ?? {};
    pendingBreakFree[entangleId] = entry;
    await baseEntangled.setFlag(NS, 'pendingEntangleBreakFree', pendingBreakFree);

    await ChatMessage.create({
      content: `
        <div class="mi-chat-card">
          <div class="mi-card-header mi-card-header--stacked">
            <span class="mi-card-actor">${entangledActor.name} vs ${attackerName}</span>
            <span class="mi-card-skill">Break Free from Entangle — Failed</span>
          </div>
          <div class="mi-card-body">
            <div class="mi-outcome-row">
              <span class="mi-outcome mi-wound-minor">
                <i class="fas fa-times-circle"></i> ${entangledActor.name} cannot break free — still entangled. May try again next turn.
              </span>
            </div>
            <div class="mi-se-roll-row">
              <span class="mi-se-roll-label">${entangledActor.name} — Brawn</span>
              <span class="mi-se-roll-val">${defenderRoll ?? 'auto'} vs ${brawnTotal}%</span>
            </div>
          </div>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor: entangledActor })
    });
  }
}
