/**
 * module/combat/effects/grip.js
 *
 * SE resolver for Grip, plus the follow-up turn logic:
 *   - resolveGrip          — SE resolver (called via SE_RESOLVERS dispatch)
 *   - resolveGripBreakFree — called from updateCombat at start of gripped actor's turn
 *
 * Dependencies:
 *   helpers.js  — applyFatigueToSkill, runSEDialog
 *   combat-math.js — resolveOpposedRoll
 *   ../CombatSocket.js — dynamic import for non-GM semi-auto socket routing
 */

import {
  applyFatigueToSkill,
  runSEDialog,
} from './helpers.js';
import { resolveOpposedRoll } from '../../utils/combat-math.js';

const NS = 'mythras-imperative';

// -------------------------------------------------------------------------
// resolveGrip — SE: Grip
// Rules p.44: Offensive, Unarmed only. No opposed roll at grip time.
// Gripper chooses holding skill (Brawn or Unarmed). Gripped actor may
// break free on their own turn.
// -------------------------------------------------------------------------
export async function resolveGrip(ctx, damage, forcesFail) {
  const { attacker, defender } = ctx;
  const isSemi   = game.settings.get(NS, 'automationLevel') === 'semi';
  const isGMMode = game.settings.get(NS, 'gmMode') ?? false;
  const attackRoll = ctx.attackResult ?? 0;

  // Resolve base actors for persistent flag writes (ctx actors may be synthetic)
  const baseDefender = game.actors.get(defender.id) ?? defender;

  const gripperBrawn   = Array.from(attacker.items).find(i => i.type === 'skill' && i.name === 'Brawn');
  const gripperUnarmed = Array.from(attacker.items).find(i => i.type === 'skill' && i.name === 'Unarmed');

  const _adjG = raw => applyFatigueToSkill(raw, attacker);
  const gripperSkillOptions = [
    gripperBrawn   && { name: 'Brawn',   rawTotal: gripperBrawn.system.total   ?? 0, total: _adjG(gripperBrawn.system.total   ?? 0) },
    gripperUnarmed && { name: 'Unarmed', rawTotal: gripperUnarmed.system.total ?? 0, total: _adjG(gripperUnarmed.system.total ?? 0) }
  ].filter(Boolean);
  if (gripperSkillOptions.length === 0) gripperSkillOptions.push({ name: 'Brawn', rawTotal: 0, total: 0 });

  let gripperSkill = gripperSkillOptions[0];

  if (!forcesFail && isSemi) {
    let response;
    if (isGMMode) {
      response = await runSEDialog({
        seType:             'gripChooseSkill',
        attackerName:       attacker.name,
        defenderName:       defender.name,
        attackRoll,
        attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
        lastCardId:         ctx.chatMessageId,
        skillOptions:       gripperSkillOptions
      });
    } else {
      const { CombatSocket, _findUserIdForActor } = await import('../CombatSocket.js');
      const targetUserId = _findUserIdForActor(attacker);
      const exchangeId   = foundry.utils.randomID(16);
      response = await CombatSocket.seChallenge(exchangeId, {
        seType:             'gripChooseSkill',
        attackerName:       attacker.name,
        defenderName:       defender.name,
        attackRoll,
        attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
        lastCardId:         ctx.chatMessageId,
        skillOptions:       gripperSkillOptions
      }, targetUserId);
    }
    if (response) {
      gripperSkill = { name: response.chosenSkillName, total: response.chosenSkillTotal, rawTotal: response.chosenSkillRaw ?? response.chosenSkillTotal };
    }
  } else if (!forcesFail) {
    if (gripperSkillOptions.length > 1) {
      gripperSkill = gripperSkillOptions.reduce((best, sk) => sk.total > best.total ? sk : best);
    }
  }

  const gripEntryId = foundry.utils.randomID(8);
  const grippedBy   = baseDefender.getFlag(NS, 'grippedBy') ?? {};
  grippedBy[gripEntryId] = {
    gripperActorId:    attacker.id,
    gripperName:       attacker.name,
    gripperSkillName:  gripperSkill.name,
    gripperSkillTotal: gripperSkill.total,
    gripperSkillRaw:   gripperSkill.rawTotal ?? gripperSkill.total
  };
  await baseDefender.setFlag(NS, 'grippedBy', grippedBy);

  const pendingGrip = baseDefender.getFlag(NS, 'pendingGripCheck') ?? {};
  pendingGrip[gripEntryId] = grippedBy[gripEntryId];
  await baseDefender.setFlag(NS, 'pendingGripCheck', pendingGrip);

  await ChatMessage.create({
    content: `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker.name} → ${defender.name}</span>
          <span class="mi-card-skill">Grip</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-outcome-row">
            <span class="mi-outcome mi-wound-serious">
              <i class="fas fa-hands"></i> ${attacker.name} has ${defender.name} in a grip — cannot disengage
            </span>
          </div>
          <div class="mi-se-roll-row">
            <span class="mi-se-roll-label">Gripper's holding skill</span>
            <span class="mi-se-roll-val">${gripperSkill.name} ${gripperSkill.total}%</span>
          </div>
          <p class="mi-se-roll-note">${defender.name} may attempt to break free at the start of their next turn.</p>
        </div>
      </div>`,
    speaker: ChatMessage.getSpeaker({ actor: attacker })
  });
}

// -------------------------------------------------------------------------
// resolveGripBreakFree — called from updateCombat at the start of the
// gripped actor's turn. Runs the opposed Brawn/Unarmed break-free roll.
// Clears flags on success; re-queues on failure.
// entry: one entry from flags['mythras-imperative'].pendingGripCheck
// -------------------------------------------------------------------------
export async function resolveGripBreakFree(grippedActor, entry, gripEntryId) {
  const { gripperActorId, gripperName, gripperSkillName, gripperSkillTotal } = entry;

  const isSemi   = game.settings.get(NS, 'automationLevel') === 'semi';
  const isGMMode = game.settings.get(NS, 'gmMode') ?? false;

  const brawnSkill   = Array.from(grippedActor.items).find(i => i.type === 'skill' && i.name === 'Brawn');
  const unarmedSkill = Array.from(grippedActor.items).find(i => i.type === 'skill' && i.name === 'Unarmed');

  const _adj = raw => applyFatigueToSkill(raw, grippedActor);
  const skillOptions = [
    brawnSkill   && { name: 'Brawn',   rawTotal: brawnSkill.system.total   ?? 0, total: _adj(brawnSkill.system.total   ?? 0) },
    unarmedSkill && { name: 'Unarmed', rawTotal: unarmedSkill.system.total ?? 0, total: _adj(unarmedSkill.system.total ?? 0) }
  ].filter(Boolean);
  if (skillOptions.length === 0) skillOptions.push({ name: 'Brawn', rawTotal: 0, total: 0 });

  let chosenSkill  = skillOptions.reduce((best, sk) => sk.total > best.total ? sk : best);
  let defenderRoll = null;
  let freeSucceeds = false;

  if (isSemi && !isGMMode) {
    const { CombatSocket, _findDefenderUserId } = await import('../CombatSocket.js');
    const targetUserId = _findDefenderUserId(grippedActor);
    const exchangeId   = foundry.utils.randomID(16);
    const response = await CombatSocket.seChallenge(exchangeId, {
      seType:             'gripBreakFree',
      attackerName:       gripperName,
      defenderName:       grippedActor.name,
      attackRoll:         gripperSkillTotal,
      attackerSkillTotal: gripperSkillTotal,
      lastCardId:         null,
      defenderSkill:      chosenSkill.name,
      defenderRaw:        chosenSkill.rawTotal,
      defenderTotal:      chosenSkill.total,
      skillOptions,
      gripperName,
      gripperSkillName,
      gripperSkillTotal,
      gripperSkillRaw:    entry.gripperSkillRaw ?? gripperSkillTotal
    }, targetUserId);
    if (response) {
      chosenSkill  = { name: response.chosenSkillName, total: response.chosenSkillTotal, rawTotal: response.chosenSkillRaw ?? response.chosenSkillTotal };
      defenderRoll = response.roll;
      freeSucceeds = response.succeeds;
    }
  } else if (isSemi && isGMMode) {
    const response = await runSEDialog({
      seType:             'gripBreakFree',
      attackerName:       gripperName,
      defenderName:       grippedActor.name,
      attackRoll:         gripperSkillTotal,
      attackerSkillTotal: gripperSkillTotal,
      lastCardId:         null,
      defenderSkill:      chosenSkill.name,
      defenderRaw:        chosenSkill.rawTotal,
      defenderTotal:      chosenSkill.total,
      skillOptions,
      gripperName,
      gripperSkillName,
      gripperSkillTotal,
      gripperSkillRaw:    entry.gripperSkillRaw ?? gripperSkillTotal
    });
    if (response) {
      chosenSkill  = { name: response.chosenSkillName, total: response.chosenSkillTotal, rawTotal: response.chosenSkillRaw ?? response.chosenSkillTotal };
      defenderRoll = response.roll;
      freeSucceeds = response.succeeds;
    }
  } else {
    const roll = new Roll('1d100');
    await roll.evaluate();
    defenderRoll = roll.total;
    freeSucceeds = resolveOpposedRoll(
      gripperSkillTotal, gripperSkillTotal,
      defenderRoll, chosenSkill.total
    );
  }

  // Resolve base actor for persistent flag writes
  const baseGripped = game.actors.get(grippedActor.id) ?? grippedActor;

  if (freeSucceeds) {
    const grippedBy = baseGripped.getFlag(NS, 'grippedBy') ?? {};
    delete grippedBy[gripEntryId];
    await baseGripped.setFlag(NS, 'grippedBy', grippedBy);

    await ChatMessage.create({
      content: `
        <div class="mi-chat-card">
          <div class="mi-card-header mi-card-header--stacked">
            <span class="mi-card-actor">${grippedActor.name} vs ${gripperName}</span>
            <span class="mi-card-skill">Break Free — Success</span>
          </div>
          <div class="mi-card-body">
            <div class="mi-outcome-row">
              <span class="mi-outcome success">
                <i class="fas fa-check-circle"></i> ${grippedActor.name} breaks free from ${gripperName}'s grip
              </span>
            </div>
            <div class="mi-se-roll-row">
              <span class="mi-se-roll-label">${grippedActor.name} — ${chosenSkill.name}</span>
              <span class="mi-se-roll-val">${defenderRoll ?? 'auto'} vs ${chosenSkill.total}%</span>
            </div>
            <div class="mi-se-roll-row">
              <span class="mi-se-roll-label">${gripperName} — ${gripperSkillName}</span>
              <span class="mi-se-roll-val">${gripperSkillTotal}%</span>
            </div>
          </div>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor: grippedActor })
    });
  } else {
    // Still gripped — re-queue for next turn
    const pendingGrip = baseGripped.getFlag(NS, 'pendingGripCheck') ?? {};
    pendingGrip[gripEntryId] = entry;
    await baseGripped.setFlag(NS, 'pendingGripCheck', pendingGrip);

    await ChatMessage.create({
      content: `
        <div class="mi-chat-card">
          <div class="mi-card-header mi-card-header--stacked">
            <span class="mi-card-actor">${grippedActor.name} vs ${gripperName}</span>
            <span class="mi-card-skill">Break Free — Failed</span>
          </div>
          <div class="mi-card-body">
            <div class="mi-outcome-row">
              <span class="mi-outcome mi-wound-minor">
                <i class="fas fa-times-circle"></i> ${grippedActor.name} cannot break free — still gripped. May try again next turn.
              </span>
            </div>
            <div class="mi-se-roll-row">
              <span class="mi-se-roll-label">${grippedActor.name} — ${chosenSkill.name}</span>
              <span class="mi-se-roll-val">${defenderRoll ?? 'auto'} vs ${chosenSkill.total}%</span>
            </div>
            <div class="mi-se-roll-row">
              <span class="mi-se-roll-label">${gripperName} — ${gripperSkillName}</span>
              <span class="mi-se-roll-val">${gripperSkillTotal}%</span>
            </div>
          </div>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor: grippedActor })
    });
  }
}
