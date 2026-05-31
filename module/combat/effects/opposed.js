/**
 * module/combat/effects/opposed.js
 *
 * SE resolvers that involve an opposed resistance roll.
 *
 * Each follows the same pattern:
 *   1. Find the resisting skill on the relevant actor
 *   2. Apply fatigue penalty (applyFatigueToSkill)
 *   3. In semi mode: show dialog via runSEDialog / CombatSocket
 *   4. In full-auto: roll 1d100 and call resolveOpposedRoll
 *   5. Apply effect on failure (status, flag)
 *   6. Post result card via postOpposedSEResult
 *
 * Dependencies: helpers.js (runSEDialog, postOpposedSEResult, applyStatusToActor,
 *               applyProneToDefender, applyFatigueToSkill, resolveOpposedRoll),
 *               combat-math.js (classifyLocation via helpers re-export)
 */

import {
  runSEDialog,
  postOpposedSEResult,
  applyStatusToActor,
  applyProneToDefender,
  applyFatigueToSkill,
  resolveOpposedRoll,
} from './helpers.js';
import { classifyLocation } from '../../utils/combat-math.js';


// -------------------------------------------------------------------------
// resolveBleed — SE: Bleed
// Rules p.43: requires damage > 0. Defender rolls Endurance vs attacker's
// original roll. On fail: Bleeding condition applied.
// -------------------------------------------------------------------------
export async function resolveBleed(ctx, damage, forcesFail) {
  const { attacker, defender } = ctx;
  const isSemi   = game.settings.get('mythras-imperative', 'automationLevel') === 'semi';
  const isGMMode = game.settings.get('mythras-imperative', 'gmMode') ?? false;
  const attackRoll = ctx.attackResult ?? 0;

  const enduranceSkill = Array.from(defender.items)
    .find(i => i.type === 'skill' && i.name === 'Endurance');
  const enduranceRaw   = enduranceSkill?.system.total ?? 0;
  const enduranceTotal = applyFatigueToSkill(enduranceRaw, defender);

  let defenderRoll     = null;
  let defenderSucceeds = false;

  if (forcesFail) {
    defenderSucceeds = false;

  } else if (isSemi) {
    let response;
    if (isGMMode) {
      response = await runSEDialog({
        seType:             'bleed',
        attackerName:       attacker.name,
        defenderName:       defender.name,
        attackRoll,
        attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
        lastCardId:         ctx.chatMessageId,
        defenderSkill:      'Endurance',
        defenderRaw:        enduranceRaw,
        defenderTotal:      enduranceTotal
      });
    } else {
      const { CombatSocket, _findDefenderUserId } = await import('./CombatSocket.js');
      const targetUserId = _findDefenderUserId(defender);
      const exchangeId   = foundry.utils.randomID(16);
      response = await CombatSocket.seChallenge(exchangeId, {
        seType:             'bleed',
        attackerName:       attacker.name,
        defenderName:       defender.name,
        attackRoll,
        attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
        lastCardId:         ctx.chatMessageId,
        defenderSkill:      'Endurance',
        defenderRaw:        enduranceRaw,
        defenderTotal:      enduranceTotal
      }, targetUserId);
    }

    defenderRoll     = response?.roll     ?? null;
    defenderSucceeds = response?.succeeds ?? false;

  } else {
    const roll = new Roll('1d100');
    await roll.evaluate();
    defenderRoll     = roll.total;
    defenderSucceeds = resolveOpposedRoll(
      attackRoll, ctx.attackerSkillTotal ?? 0,
      defenderRoll, enduranceTotal
    );
  }

  const bleedApplied = !defenderSucceeds;
  if (bleedApplied) {
    await applyStatusToActor(defender, 'bleeding');
  }

  await postOpposedSEResult({
    label:           'Bleed',
    attackerName:    attacker.name,
    defenderName:    defender.name,
    attackerRoll:    attackRoll,
    attackerTotal:   ctx.attackerSkillTotal ?? 0,
    defenderRoll,
    defenderTotal:   enduranceTotal,
    defenderRaw:     enduranceRaw,
    defenderSkill:   'Endurance',
    forcesFail,
    effectApplied:   bleedApplied,
    effectLabel:     bleedApplied
      ? `${defender.name} is Bleeding — loses 1 Fatigue per Round`
      : `${defender.name} resists the Bleed`,
    attackerActor:   attacker,
    defenderActor:   defender
  });
}


// -------------------------------------------------------------------------
// resolveTripOpponent — SE: Trip Opponent
// Rules p.47: no damage requirement. Offensive or defensive — the resisting
// actor rolls Brawn/Evade/Acrobatics vs the SE winner's original roll.
// -------------------------------------------------------------------------
export async function resolveTripOpponent(ctx, damage, forcesFail) {
  const { attacker, defender } = ctx;
  const isSemi   = game.settings.get('mythras-imperative', 'automationLevel') === 'semi';
  const isGMMode = game.settings.get('mythras-imperative', 'gmMode') ?? false;
  const attackRoll = ctx.attackResult ?? 0;

  const tripIsOffensive = ctx.seWinner === 'attacker';
  const resistingActor  = tripIsOffensive ? defender : attacker;
  const seWinnerRoll    = tripIsOffensive ? attackRoll            : (ctx.defenceResult ?? 0);
  const seWinnerTotal   = tripIsOffensive ? (ctx.attackerSkillTotal ?? 0) : (ctx.defenderSkillTotal ?? 0);

  const brawnSkill = Array.from(resistingActor.items).find(i => i.type === 'skill' && i.name === 'Brawn');
  const evadeSkill = Array.from(resistingActor.items).find(i => i.type === 'skill' && i.name === 'Evade');
  const acroSkill  = Array.from(resistingActor.items).find(i => i.type === 'skill' && i.name === 'Acrobatics');

  const _adj = raw => applyFatigueToSkill(raw, resistingActor);
  const skillOptions = [
    brawnSkill && { name: 'Brawn',       rawTotal: brawnSkill.system.total ?? 0, total: _adj(brawnSkill.system.total ?? 0) },
    evadeSkill && { name: 'Evade',        rawTotal: evadeSkill.system.total ?? 0, total: _adj(evadeSkill.system.total ?? 0) },
    acroSkill  && { name: 'Acrobatics',   rawTotal: acroSkill.system.total  ?? 0, total: _adj(acroSkill.system.total  ?? 0) }
  ].filter(Boolean);

  if (skillOptions.length === 0) skillOptions.push({ name: 'Brawn', rawTotal: 0, total: 0 });

  let chosenSkill      = skillOptions[0];
  let defenderRoll     = null;
  let defenderSucceeds = false;

  if (forcesFail) {
    defenderSucceeds = false;

  } else if (isSemi) {
    let response;
    if (isGMMode) {
      response = await runSEDialog({
        seType:             'trip',
        attackerName:       attacker.name,
        defenderName:       defender.name,
        attackRoll:         seWinnerRoll,
        attackerSkillTotal: seWinnerTotal,
        lastCardId:         ctx.chatMessageId,
        skillOptions,
        tripIsOffensive
      });
    } else {
      const { CombatSocket, _findDefenderUserId, _findUserIdForActor } = await import('./CombatSocket.js');
      const targetUserId = tripIsOffensive
        ? _findDefenderUserId(defender)
        : _findUserIdForActor(attacker);
      const exchangeId = foundry.utils.randomID(16);
      response = await CombatSocket.seChallenge(exchangeId, {
        seType:             'trip',
        attackerName:       attacker.name,
        defenderName:       defender.name,
        attackRoll:         seWinnerRoll,
        attackerSkillTotal: seWinnerTotal,
        lastCardId:         ctx.chatMessageId,
        skillOptions,
        tripIsOffensive
      }, targetUserId);
    }

    if (response) {
      chosenSkill      = { name: response.chosenSkillName, total: response.chosenSkillTotal, rawTotal: response.chosenSkillRaw ?? response.chosenSkillTotal };
      defenderRoll     = response.roll;
      defenderSucceeds = response.succeeds;
    }

  } else {
    if (skillOptions.length > 1) {
      chosenSkill = skillOptions.reduce((best, sk) => sk.total > best.total ? sk : best);
    }
    const roll = new Roll('1d100');
    await roll.evaluate();
    defenderRoll     = roll.total;
    defenderSucceeds = resolveOpposedRoll(
      seWinnerRoll, seWinnerTotal,
      defenderRoll, chosenSkill.total
    );
  }

  const tripApplied = !defenderSucceeds;
  if (tripApplied) {
    await applyProneToDefender(resistingActor);
  }

  const tripWinnerName  = tripIsOffensive ? attacker.name : defender.name;
  const tripResistName  = tripIsOffensive ? defender.name : attacker.name;
  const tripTargetActor = tripIsOffensive ? defender       : attacker;
  await postOpposedSEResult({
    label:         'Trip Opponent',
    attackerName:  tripWinnerName,
    defenderName:  tripResistName,
    attackerRoll:  seWinnerRoll,
    attackerTotal: seWinnerTotal,
    defenderRoll,
    defenderTotal: chosenSkill.total,
    defenderRaw:   chosenSkill.rawTotal ?? chosenSkill.total,
    defenderSkill: chosenSkill.name,
    forcesFail,
    effectApplied: tripApplied,
    effectLabel:   tripApplied
      ? `${tripResistName} falls Prone`
      : `${tripResistName} keeps their footing`,
    attackerActor: tripIsOffensive ? attacker : defender,
    defenderActor: tripTargetActor
  });
}


// -------------------------------------------------------------------------
// resolveStunLocation — SE: Stun Location
// Rules p.45: bludgeoning, damage > 0. Endurance vs attack roll.
// On fail: location Incapacitated for damage-many Turns.
// Torso: additional Hard Endurance or fall Prone.
// -------------------------------------------------------------------------
export async function resolveStunLocation(ctx, damage, forcesFail) {
  const { attacker, defender } = ctx;
  const isSemi   = game.settings.get('mythras-imperative', 'automationLevel') === 'semi';
  const isGMMode = game.settings.get('mythras-imperative', 'gmMode') ?? false;
  const attackRoll = ctx.attackResult ?? 0;

  const enduranceSkill  = Array.from(defender.items)
    .find(i => i.type === 'skill' && i.name === 'Endurance');
  const enduranceRaw    = enduranceSkill?.system.total ?? 0;
  const enduranceTotal  = applyFatigueToSkill(enduranceRaw, defender);

  let defenderRoll     = null;
  let defenderSucceeds = false;

  if (forcesFail) {
    defenderSucceeds = false;
  } else if (isSemi) {
    let response;
    if (isGMMode) {
      response = await runSEDialog({
        seType:             'stunLocation',
        attackerName:       attacker.name,
        defenderName:       defender.name,
        attackRoll,
        attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
        lastCardId:         ctx.chatMessageId,
        defenderSkill:      'Endurance',
        defenderRaw:        enduranceRaw,
        defenderTotal:      enduranceTotal,
        locationLabel:      ctx.hitLocationLabel ?? 'location',
        damage
      });
    } else {
      const { CombatSocket, _findDefenderUserId } = await import('./CombatSocket.js');
      const targetUserId = _findDefenderUserId(defender);
      const exchangeId   = foundry.utils.randomID(16);
      response = await CombatSocket.seChallenge(exchangeId, {
        seType:             'stunLocation',
        attackerName:       attacker.name,
        defenderName:       defender.name,
        attackRoll,
        attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
        lastCardId:         ctx.chatMessageId,
        defenderSkill:      'Endurance',
        defenderRaw:        enduranceRaw,
        defenderTotal:      enduranceTotal,
        locationLabel:      ctx.hitLocationLabel ?? 'location',
        damage
      }, targetUserId);
    }
    defenderRoll     = response?.roll     ?? null;
    defenderSucceeds = response?.succeeds  ?? false;
  } else {
    const roll = new Roll('1d100');
    await roll.evaluate();
    defenderRoll     = roll.total;
    defenderSucceeds = resolveOpposedRoll(
      attackRoll, ctx.attackerSkillTotal ?? 0,
      defenderRoll, enduranceTotal
    );
  }

  const stunApplied = !defenderSucceeds;
  if (stunApplied) {
    const hasKnockoutBlow = ctx.attackerStyle?.system?.traits?.includes('knockoutBlow') ?? false;
    const stunDuration    = damage;
    const durationLabel   = hasKnockoutBlow ? 'minute' : 'Turn';

    const hitLocId = ctx.hitLocationId ?? null;
    if (hitLocId) {
      const existing = defender.getFlag('mythras-imperative', 'stunLocations') ?? {};
      existing[hitLocId] = Math.max(existing[hitLocId] ?? 0, stunDuration);
      await defender.setFlag('mythras-imperative', 'stunLocations', existing);
    }

    const locationType = ctx.locationType ?? classifyLocation(ctx.hitLocationLabel ?? '');
    if (locationType === 'torso') {
      const hardTotal  = Math.ceil(enduranceTotal / 2);
      const torsoRoll  = new Roll('1d100');
      await torsoRoll.evaluate();
      const fallsProne = torsoRoll.total > hardTotal;
      if (fallsProne) {
        await applyProneToDefender(defender);
      }
      const torsoOutcome = torsoRoll.total <= Math.ceil(enduranceTotal / 10) ? 'critical'
        : torsoRoll.total <= hardTotal ? 'success' : 'failure';
      await ChatMessage.create({
        content: `
          <div class="mi-chat-card">
            <div class="mi-card-header mi-card-header--stacked">
              <span class="mi-card-actor">${defender.name}</span>
              <span class="mi-card-skill">Stun Location — Torso (Hard Endurance)</span>
            </div>
            <div class="mi-card-body">
              <div class="mi-card-rolls">
                <div class="mi-card-roll-row mi-card-roll-row--defender">
                  <div class="mi-card-roll-row-top">${defender.name} — Endurance (Hard: ${hardTotal}%)</div>
                  <div class="mi-card-roll-row-bottom">
                    <span class="mi-card-roll-target">${hardTotal}%</span>
                    <span class="mi-card-roll-result">${torsoRoll.total}</span>
                    <span class="mi-outcome ${torsoOutcome}">${torsoOutcome.charAt(0).toUpperCase() + torsoOutcome.slice(1)}</span>
                  </div>
                </div>
              </div>
              <div class="mi-outcome-row">
                <span class="mi-outcome ${fallsProne ? 'mi-wound-serious' : 'success'}">
                  <i class="fas ${fallsProne ? 'fa-times-circle' : 'fa-check-circle'}"></i>
                  ${fallsProne ? `${defender.name} staggers and falls Prone` : `${defender.name} keeps their footing`}
                </span>
              </div>
            </div>
          </div>`,
        speaker: ChatMessage.getSpeaker({ actor: attacker })
      });
    }
  }

  await postOpposedSEResult({
    label:           'Stun Location',
    attackerName:    attacker.name,
    defenderName:    defender.name,
    attackerRoll:    attackRoll,
    attackerTotal:   ctx.attackerSkillTotal ?? 0,
    defenderRoll,
    defenderTotal:   enduranceTotal,
    defenderRaw:     enduranceRaw,
    defenderSkill:   'Endurance',
    forcesFail,
    effectApplied:   stunApplied,
    effectLabel:     stunApplied
      ? `${ctx.hitLocationLabel ?? 'Location'} Incapacitated — ${damage} Turn${damage !== 1 ? 's' : ''}`
      : `${defender.name} resists the stun`,
    attackerActor:   attacker,
    defenderActor:   defender
  });
}


// -------------------------------------------------------------------------
// resolveDisarmOpponent — SE: Disarm Opponent
// Rules p.44: resists with Combat Style. Weapon size affects difficulty.
// Offensive or defensive — roles swap when defender wins the SE.
// -------------------------------------------------------------------------
export async function resolveDisarmOpponent(ctx, damage, forcesFail) {
  const { attacker, defender } = ctx;
  const isSemi   = game.settings.get('mythras-imperative', 'automationLevel') === 'semi';
  const isGMMode = game.settings.get('mythras-imperative', 'gmMode') ?? false;
  const attackRoll = ctx.attackResult ?? 0;

  const disarmIsOffensive = ctx.seWinner === 'attacker';
  const resistingActor = disarmIsOffensive ? defender : attacker;
  const disarmerActor  = disarmIsOffensive ? attacker : defender;
  const seWinnerRoll  = disarmIsOffensive ? attackRoll : (ctx.defenceResult ?? 0);
  const seWinnerTotal = disarmIsOffensive
    ? (ctx.attackerSkillTotal ?? 0)
    : (ctx.defenderSkillTotal ?? 0);

  const allCombatStyles = Array.from(resistingActor.items)
    .filter(i => i.type === 'combat-style');
  const resistingStyle  = allCombatStyles.length > 0
    ? allCombatStyles.reduce((best, cs) =>
        (cs.system.total ?? 0) > (best.system.total ?? 0) ? cs : best)
    : null;

  const resistSkillRaw   = resistingStyle?.system.total ?? 0;
  let   resistSkillTotal = applyFatigueToSkill(resistSkillRaw, resistingActor);

  // Weapon size adjustment
  const sizeOrder   = { S: 0, M: 1, L: 2, H: 3, E: 4 };
  const disarmerWeapon  = disarmIsOffensive ? ctx.weapon : ctx.defenceWeapon;
  const resistingWeapon = disarmIsOffensive ? ctx.defenceWeapon : ctx.weapon;
  let sizeNote = '';

  if (disarmerWeapon && resistingWeapon) {
    const disarmerSize  = sizeOrder[disarmerWeapon.system.size  ?? 'M'] ?? 1;
    const resistingSize = sizeOrder[resistingWeapon.system.size ?? 'M'] ?? 1;
    const sizeDiff      = disarmerSize - resistingSize;

    if (sizeDiff !== 0) {
      const gradeOrder    = ['veryEasy','easy','standard','hard','formidable','herculean','hopeless'];
      const grades        = CONFIG.MYTHRAS?.difficultyGrades ?? {};
      const baseIdx       = 2;
      const adjustedIdx   = Math.max(0, Math.min(gradeOrder.length - 1, baseIdx + sizeDiff));
      const adjustedGrade = gradeOrder[adjustedIdx];
      const multiplier    = grades[adjustedGrade]?.multiplier ?? 1;
      if (multiplier === null) {
        resistSkillTotal = 0;
      } else {
        resistSkillTotal = Math.max(0, Math.ceil(resistSkillTotal * multiplier));
      }

      if (sizeDiff > 0) {
        sizeNote = `Disarmer's weapon is ${sizeDiff} size step${sizeDiff > 1 ? 's' : ''} larger — roll is ${adjustedGrade}`;
      } else {
        sizeNote = `Disarmer's weapon is ${Math.abs(sizeDiff)} size step${Math.abs(sizeDiff) > 1 ? 's' : ''} smaller — roll is ${adjustedGrade}`;
      }
    }
  }

  // Flung distance
  const disarmerDM  = disarmerActor.system.attributes?.damageModifier ?? '+0';
  const hasDM       = disarmerDM && disarmerDM !== '+0' && disarmerDM !== '0';
  const flungNote   = hasDM
    ? `Weapon flung ${disarmerDM} metres (GM to determine direction and placement)`
    : `Weapon drops at ${resistingActor.name}'s feet`;

  let defenderRoll     = null;
  let defenderSucceeds = false;

  if (forcesFail) {
    defenderSucceeds = false;

  } else if (isSemi) {
    let response;
    if (isGMMode) {
      response = await runSEDialog({
        seType:             'disarm',
        attackerName:       disarmerActor.name,
        defenderName:       resistingActor.name,
        attackRoll:         seWinnerRoll,
        attackerSkillTotal: seWinnerTotal,
        lastCardId:         ctx.chatMessageId,
        defenderSkill:      resistingStyle?.name ?? 'Combat Style',
        defenderRaw:        resistSkillRaw,
        defenderTotal:      resistSkillTotal,
        sizeNote,
        disarmIsOffensive
      });
    } else {
      const { CombatSocket, _findDefenderUserId, _findUserIdForActor } = await import('./CombatSocket.js');
      const targetUserId = disarmIsOffensive
        ? _findDefenderUserId(defender)
        : _findUserIdForActor(attacker);
      const exchangeId = foundry.utils.randomID(16);
      response = await CombatSocket.seChallenge(exchangeId, {
        seType:             'disarm',
        attackerName:       disarmerActor.name,
        defenderName:       resistingActor.name,
        attackRoll:         seWinnerRoll,
        attackerSkillTotal: seWinnerTotal,
        lastCardId:         ctx.chatMessageId,
        defenderSkill:      resistingStyle?.name ?? 'Combat Style',
        defenderRaw:        resistSkillRaw,
        defenderTotal:      resistSkillTotal,
        sizeNote,
        disarmIsOffensive
      }, targetUserId);
    }

    defenderRoll     = response?.roll     ?? null;
    defenderSucceeds = response?.succeeds ?? false;

  } else {
    const roll = new Roll('1d100');
    await roll.evaluate();
    defenderRoll     = roll.total;
    defenderSucceeds = resolveOpposedRoll(
      seWinnerRoll, seWinnerTotal,
      defenderRoll, resistSkillTotal
    );
  }

  const disarmApplied = !defenderSucceeds;

  let effectLabel;
  if (disarmApplied) {
    effectLabel = `${resistingActor.name} is disarmed! ${flungNote}`;
    if (sizeNote) effectLabel += ` (${sizeNote})`;
  } else {
    effectLabel = `${resistingActor.name} maintains their grip`;
  }

  await postOpposedSEResult({
    label:           'Disarm Opponent',
    attackerName:    disarmerActor.name,
    defenderName:    resistingActor.name,
    attackerRoll:    seWinnerRoll,
    attackerTotal:   seWinnerTotal,
    defenderRoll,
    defenderTotal:   resistSkillTotal,
    defenderRaw:     resistSkillRaw,
    defenderSkill:   resistingStyle?.name ?? 'Combat Style',
    forcesFail,
    effectApplied:   disarmApplied,
    effectLabel,
    attackerActor:   disarmerActor,
    defenderActor:   resistingActor
  });
}


// -------------------------------------------------------------------------
// _resolveSlipFree — SE: Slip Free (defender, Defender Critical only).
// Rules p.45: "On a Critical the defender can automatically escape being
// Entangled, Gripped, or Pinned."
//
// Automatic — no opposed roll, no dialog.
//
// What we clear on the defender:
//   - All entries in 'grippedBy'
//   - All entries in 'entangledBy'
//   - All entries in 'pendingGripCheck'      (defender's own break-free queue)
//   - All entries in 'pendingEntangleBreakFree' (defender's own break-free queue)
//
// Cross-reference cleanup on attacker-side actors (for each cleared entry):
//   grippedBy entries: no attacker-side pending flag to clean (the attacker
//     does not hold a 'pendingGrip' queue — only the gripped actor does).
//   entangledBy entries: attacker holds 'pendingEntangleTrip' keyed by the
//     same entangleId — we must remove that entry so the trip prompt never
//     fires on a weapon that is no longer entangled.
//
// Posts a single narrative card. If the defender had no active holds at all,
// the card still posts (degenerate case — player chose SE when nothing was
// active; engine should not throw).
// -------------------------------------------------------------------------

// -------------------------------------------------------------------------
// resolveBlindOpponent — Blind Opponent SE
//
// Rules p.43: Defender Critical only. The defender blinds the attacker by
// throwing sand, reflecting sunlight off a shield, or similar tactic.
//
// Opposed roll:
//   - Attacker resists with Evade (or their weapon skill if using a shield)
//   - vs defender's original Parry roll
//
// On failure: attacker suffers Hard or Formidable difficulty on all combat
// rolls for 1d3 Turns (Hard = 2, Formidable = 3 — grades escalate with
// severity; the rules leave the grade to the GM but we let the defender
// choose at dialog time in Semi-Auto or pick Hard by default in Full Auto).
//
// State stored as 'blindedBy' flag on the attacker:
//   { blindedByActorId, grade: 'hard'|'formidable', turnsRemaining }
// The grade floor flows into _getConditionFloorGrade and _buildConditionNotes.
// The countdown is handled in the updateCombat hook (same pattern as stunTurns).
// -------------------------------------------------------------------------

export async function resolveBlindOpponent(ctx) {
  const { attacker, defender } = ctx;
  if (!attacker || !defender) return;

  const forcesFail = (ctx.chosenSpecialEffects ?? []).includes('forceFailure');
  const isSemi     = game.settings.get('mythras-imperative', 'automationLevel') === 'semi';
  const isGMMode   = game.settings.get('mythras-imperative', 'gmMode') ?? false;

  // ── Determine attacker's resistance skill ────────────────────────────────
  // Rules: Evade, or weapon skill if using a shield.
  // Practical simplification: check if the attacker's defence weapon (if any)
  // has the 'shield' trait. If so, use Combat Style; otherwise use Evade.
  const defWeapon      = ctx.defenceWeapon;
  const shieldTraits   = defWeapon?.system?.traits ?? [];
  const useShieldSkill = shieldTraits.includes('shield');

  let resistSkillName, resistSkillRaw;
  if (useShieldSkill) {
    // Use the combat style associated with the shield
    const styleItem = ctx.attackerStyle ?? Array.from(attacker.items)
      .filter(i => i.type === 'combat-style').sort((a, b) => (b.system.total ?? 0) - (a.system.total ?? 0))[0];
    resistSkillName = styleItem?.name ?? 'Combat Style';
    resistSkillRaw  = styleItem?.system?.total ?? 0;
  } else {
    const evadeItem = Array.from(attacker.items).find(i => i.type === 'skill' && i.name === 'Evade');
    resistSkillName = 'Evade';
    resistSkillRaw  = evadeItem?.system?.total ?? 0;
  }
  const resistSkillTotal = applyFatigueToSkill(resistSkillRaw, attacker);

  // ── The opposing target is the defender's original Parry roll ────────────
  const defenceRoll  = ctx.defenceResult ?? 0;
  const defenceTotal = ctx.defenderSkillTotal ?? 0;

  let attackerRoll     = null;
  let attackerSucceeds = false;
  let grade            = 'hard'; // default — GM can escalate to formidable

  if (forcesFail) {
    attackerSucceeds = false;

  } else if (isSemi) {
    let response;
    if (isGMMode) {
      response = await runSEDialog({
        seType:             'blindOpponent',
        attackerName:       attacker.name,
        defenderName:       defender.name,
        attackRoll:         defenceRoll,
        attackerSkillTotal: defenceTotal,
        lastCardId:         ctx.chatMessageId,
        defenderSkill:      resistSkillName,
        defenderRaw:        resistSkillRaw,
        defenderTotal:      resistSkillTotal
      });
    } else {
      const { CombatSocket, _findDefenderUserId } = await import('./CombatSocket.js');
      const targetUserId = _findDefenderUserId(attacker); // the attacker's player resists
      const exchangeId   = foundry.utils.randomID(16);
      response = await CombatSocket.seChallenge(exchangeId, {
        seType:             'blindOpponent',
        attackerName:       attacker.name,
        defenderName:       defender.name,
        attackRoll:         defenceRoll,
        attackerSkillTotal: defenceTotal,
        lastCardId:         ctx.chatMessageId,
        defenderSkill:      resistSkillName,
        defenderRaw:        resistSkillRaw,
        defenderTotal:      resistSkillTotal
      }, targetUserId);
    }
    attackerRoll     = response?.roll     ?? null;
    attackerSucceeds = response?.succeeds ?? false;
    grade            = response?.grade    ?? 'hard';

  } else {
    // Full Auto: roll silently, grade = hard
    const roll = new Roll('1d100');
    await roll.evaluate();
    attackerRoll     = roll.total;
    attackerSucceeds = resolveOpposedRoll(
      defenceRoll, defenceTotal,
      attackerRoll, resistSkillTotal
    );
    grade = 'hard';
  }

  // ── Roll 1d3 duration ────────────────────────────────────────────────────
  const durationRoll = new Roll('1d3');
  await durationRoll.evaluate();
  const turns = durationRoll.total;

  const blindApplied = !attackerSucceeds;
  if (blindApplied) {
    // Apply token status
    await applyStatusToActor(attacker, 'blinded');

    // Write state flag for grade floor and countdown
    await attacker.setFlag('mythras-imperative', 'blindedBy', {
      blindedByActorId: defender.id,
      grade,
      turnsRemaining: turns
    });
  }

  // ── Post result card ──────────────────────────────────────────────────────
  const gradeLabel = grade === 'formidable' ? 'Formidable' : 'Hard';
  await postOpposedSEResult({
    label:          'Blind Opponent',
    attackerName:   defender.name,    // defender is the SE winner
    defenderName:   attacker.name,    // attacker is resisting
    attackerRoll:   defenceRoll,      // defender's parry roll is the opposing target
    attackerTotal:  defenceTotal,
    defenderRoll:   attackerRoll,
    defenderTotal:  resistSkillTotal,
    defenderRaw:    resistSkillRaw,
    defenderSkill:  resistSkillName,
    forcesFail,
    effectApplied:  blindApplied,
    effectLabel:    blindApplied
      ? `${attacker.name} is Blinded — ${gradeLabel} difficulty for ${turns} Turn${turns > 1 ? 's' : ''}`
      : `${attacker.name} avoids the blind`,
    attackerActor:  defender,
    defenderActor:  attacker
  });
}


// -------------------------------------------------------------------------
// resolveDropFoe — SE: Drop Foe (attacker, firearms only)
//
// Rules p.44: If the target suffers at least a minor wound, they must make
// an Opposed Test of Endurance vs the attacker's hit roll. On failure the
// target succumbs to shock and pain — they become Incapacitated and cannot
// continue fighting.
//
// Recovery: successful First Aid (narrative — not automated), or
// technological/narcotic booster. Without recovery, incapacitation lasts
// 1 hour ÷ target Healing Rate.
//
// Mechanically: applies the 'incapacitated' token status on failure.
// Full-Auto: if the target receives no damage (e.g. evaded), the SE cannot
// fire (requires minor wound). The resolver checks damage > 0 and bails
// gracefully with a narrative card if the precondition is not met.
// -------------------------------------------------------------------------

export async function resolveDropFoe(ctx, damage, forcesFail) {
  const { attacker, defender } = ctx;
  const isSemi   = game.settings.get('mythras-imperative', 'automationLevel') === 'semi';
  const isGMMode = game.settings.get('mythras-imperative', 'gmMode') ?? false;
  const attackRoll = ctx.attackResult ?? 0;

  if (damage <= 0) {
    // Drop Foe requires at least a minor wound — no damage means no effect.
    await ChatMessage.create({
      content: `
        <div class="mi-chat-card">
          <div class="mi-card-header mi-card-header--stacked">
            <span class="mi-card-actor">${attacker?.name ?? '?'} → ${defender?.name ?? '?'}</span>
            <span class="mi-card-skill">SE: Drop Foe</span>
          </div>
          <div class="mi-card-body">
            <div class="mi-outcome-row">
              <span class="mi-outcome success">
                <i class="fas fa-shield-alt"></i> No wound inflicted — Drop Foe has no effect
              </span>
            </div>
            <p class="mi-card-note">Drop Foe requires at least a minor wound to trigger.</p>
          </div>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor: attacker })
    });
    return;
  }

  const enduranceSkill = Array.from(defender.items)
    .find(i => i.type === 'skill' && i.name === 'Endurance');
  const enduranceRaw   = enduranceSkill?.system.total ?? 0;
  const enduranceTotal = applyFatigueToSkill(enduranceRaw, defender);

  let defenderRoll     = null;
  let defenderSucceeds = false;

  if (forcesFail) {
    defenderSucceeds = false;

  } else if (isSemi) {
    let response;
    if (isGMMode) {
      response = await runSEDialog({
        seType:             'dropFoe',
        attackerName:       attacker.name,
        defenderName:       defender.name,
        attackRoll,
        attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
        lastCardId:         ctx.chatMessageId,
        defenderSkill:      'Endurance',
        defenderRaw:        enduranceRaw,
        defenderTotal:      enduranceTotal
      });
    } else {
      const { CombatSocket, _findDefenderUserId } = await import('./CombatSocket.js');
      const targetUserId = _findDefenderUserId(defender);
      const exchangeId   = foundry.utils.randomID(16);
      response = await CombatSocket.seChallenge(exchangeId, {
        seType:             'dropFoe',
        attackerName:       attacker.name,
        defenderName:       defender.name,
        attackRoll,
        attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
        lastCardId:         ctx.chatMessageId,
        defenderSkill:      'Endurance',
        defenderRaw:        enduranceRaw,
        defenderTotal:      enduranceTotal
      }, targetUserId);
    }

    defenderRoll     = response?.roll     ?? null;
    defenderSucceeds = response?.succeeds ?? false;

  } else {
    const roll = new Roll('1d100');
    await roll.evaluate();
    defenderRoll     = roll.total;
    defenderSucceeds = resolveOpposedRoll(
      attackRoll, ctx.attackerSkillTotal ?? 0,
      defenderRoll, enduranceTotal
    );
  }

  const dropApplied = !defenderSucceeds;
  if (dropApplied) {
    await applyStatusToActor(defender, 'incapacitated');
  }

  // Estimate recovery duration for the card note
  const healingRate   = defender.system.attributes?.healingRate ?? 1;
  const durationMins  = Math.ceil(60 / healingRate);
  const recoveryNote  = dropApplied
    ? `Without First Aid, incapacitation lasts ~${durationMins} min (1 hr ÷ Healing Rate ${healingRate}).`
    : '';

  await postOpposedSEResult({
    label:           'Drop Foe',
    attackerName:    attacker.name,
    defenderName:    defender.name,
    attackerRoll:    attackRoll,
    attackerTotal:   ctx.attackerSkillTotal ?? 0,
    defenderRoll,
    defenderTotal:   enduranceTotal,
    defenderRaw:     enduranceRaw,
    defenderSkill:   'Endurance',
    forcesFail,
    effectApplied:   dropApplied,
    effectLabel:     dropApplied
      ? `${defender.name} is Incapacitated — ${recoveryNote}`
      : `${defender.name} resists shock and pain`,
    attackerActor:   attacker,
    defenderActor:   defender
  });
}


// -------------------------------------------------------------------------
// resolvePinDown — SE: Pin Down (attacker, firearms only, stackable)
//
// Rules p.45: Forces the target to make an Opposed Test of Willpower vs the
// attacker's hit roll. On failure the target cannot return fire on their
// next Turn (other actions that don't expose them to fire are still allowed).
//
// Note: Pin Down fires even if no damage is inflicted (intimidation from
// nearby gunfire — explicitly stated in the rules).
//
// Mechanically: on failure writes a 'pinnedDown' actor flag. The updateCombat
// hook clears it at the start of the affected actor's next turn. The attack
// button in the dialog disables when the attacker is pinned (existing AP-gate
// already handles this via the hasFlag check before _runAttackerDialog).
// -------------------------------------------------------------------------

export async function resolvePinDown(ctx, forcesFail) {
  const { attacker, defender } = ctx;
  const isSemi   = game.settings.get('mythras-imperative', 'automationLevel') === 'semi';
  const isGMMode = game.settings.get('mythras-imperative', 'gmMode') ?? false;
  const attackRoll = ctx.attackResult ?? 0;

  // Locate Willpower skill on defender (sometimes stored as 'Willpower')
  const wpSkill = Array.from(defender.items)
    .find(i => i.type === 'skill' && (i.name === 'Willpower' || i.name === 'Will'));
  const wpRaw   = wpSkill?.system.total ?? 0;
  const wpTotal = applyFatigueToSkill(wpRaw, defender);

  let defenderRoll     = null;
  let defenderSucceeds = false;

  if (forcesFail) {
    defenderSucceeds = false;

  } else if (isSemi) {
    let response;
    if (isGMMode) {
      response = await runSEDialog({
        seType:             'pinDown',
        attackerName:       attacker.name,
        defenderName:       defender.name,
        attackRoll,
        attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
        lastCardId:         ctx.chatMessageId,
        defenderSkill:      'Willpower',
        defenderRaw:        wpRaw,
        defenderTotal:      wpTotal
      });
    } else {
      const { CombatSocket, _findDefenderUserId } = await import('./CombatSocket.js');
      const targetUserId = _findDefenderUserId(defender);
      const exchangeId   = foundry.utils.randomID(16);
      response = await CombatSocket.seChallenge(exchangeId, {
        seType:             'pinDown',
        attackerName:       attacker.name,
        defenderName:       defender.name,
        attackRoll,
        attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
        lastCardId:         ctx.chatMessageId,
        defenderSkill:      'Willpower',
        defenderRaw:        wpRaw,
        defenderTotal:      wpTotal
      }, targetUserId);
    }

    defenderRoll     = response?.roll     ?? null;
    defenderSucceeds = response?.succeeds ?? false;

  } else {
    const roll = new Roll('1d100');
    await roll.evaluate();
    defenderRoll     = roll.total;
    defenderSucceeds = resolveOpposedRoll(
      attackRoll, ctx.attackerSkillTotal ?? 0,
      defenderRoll, wpTotal
    );
  }

  const pinApplied = !defenderSucceeds;
  if (pinApplied) {
    // Write pinnedDown flag — cleared at the start of defender's next turn
    const baseDefender = game.actors.get(defender.id) ?? defender;
    await baseDefender.setFlag('mythras-imperative', 'pinnedDown', {
      attackerName: attacker.name,
      round:        game.combat?.round ?? 0
    });
  }

  await postOpposedSEResult({
    label:           'Pin Down',
    attackerName:    attacker.name,
    defenderName:    defender.name,
    attackerRoll:    attackRoll,
    attackerTotal:   ctx.attackerSkillTotal ?? 0,
    defenderRoll,
    defenderTotal:   wpTotal,
    defenderRaw:     wpRaw,
    defenderSkill:   'Willpower',
    forcesFail,
    effectApplied:   pinApplied,
    effectLabel:     pinApplied
      ? `${defender.name} is Pinned Down — cannot return fire next Turn`
      : `${defender.name} holds their nerve`,
    attackerActor:   attacker,
    defenderActor:   defender
  });
}

