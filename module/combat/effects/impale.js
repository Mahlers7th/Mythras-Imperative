/**
 * module/combat/effects/impale.js
 *
 * SE resolver for Impale, plus the follow-up turn logic:
 *   - resolveImpale           — SE resolver (called via SE_RESOLVERS dispatch)
 *   - postImpaleDecisionCard  — called from updateCombat at start of attacker's turn
 *   - applyImpaleLodge        — called from mythras.mjs "Leave In" button handler
 *   - resolveImpaleYank       — called from mythras.mjs "Yank Free" button handler
 *
 * Timing (rules p.44): "the attacker has the option of leaving the weapon in
 * the wound or yanking it free on their next turn." Only yanking is bound to
 * "next turn" — that's the Ready Weapon + Brawn action the attacker can't
 * spend mid-attack. Leaving it in has no such action cost; it's simply the
 * default state from the instant the wound is caused. The Difficulty Grade
 * penalty (`impaledBy` flag, read by `getActiveImpaleGrade`) is therefore
 * applied immediately in `resolveImpale`, not deferred to a next-turn button
 * click — a defender hit by Impale is already penalised on their own turn in
 * between, and on any reactive rolls before the attacker acts again.
 * `postImpaleDecisionCard` only offers the next-turn Yank Free attempt now;
 * "Leave In" is just an acknowledgement, not the thing that applies the flag.
 *
 * Dependencies:
 *   helpers.js     — applyStatusToActor, applyFatigueToSkill, getItem
 *   combat-math.js — getImpaleGrade, resolveOpposedRoll
 *   ../CombatSocket.js — dynamic import for non-GM semi-auto socket routing
 */

import {
  applyStatusToActor,
  applyFatigueToSkill,
  getItem,
} from './helpers.js';
import { getImpaleGrade, resolveOpposedRoll } from '../../utils/combat-math.js';

const NS = 'mythras-imperative';

const GRADE_LABELS = {
  none:          'No additional penalty',
  hard:          'Hard (all skills)',
  formidable:    'Formidable (all skills)',
  herculean:     'Herculean (all skills)',
  incapacitated: 'Incapacitated (status effect)'
};

// -------------------------------------------------------------------------
// resolveImpale — SE: Impale (requires damage > 0)
// Rules p.44: weapon lodges in the wound immediately — the Difficulty Grade
// penalty is applied to the defender right here, not deferred. Also posts a
// notification card and queues the Yank Free offer for the start of the
// attacker's next turn (the only part of this SE actually bound to "next
// turn" — see the timing note at the top of this file).
// -------------------------------------------------------------------------
export async function resolveImpale(ctx, damage) {
  const { attacker, defender, weapon } = ctx;
  if (!attacker || !defender || !weapon) return;

  // Resolve base attacker for persistent flag writes
  const baseAttacker = game.actors.get(attacker.id) ?? attacker;

  const defenderSIZ   = defender.system?.characteristics?.siz?.value ?? 13;
  const weaponSize    = weapon.system?.size ?? 'M';
  const gradeId       = getImpaleGrade(weaponSize, defenderSIZ);
  const gradeDisplay  = GRADE_LABELS[gradeId] ?? gradeId;
  const halfDmgFormula = weapon.system?.damage ?? '1d4';
  const impaleEntryId  = foundry.utils.randomID(8);

  await ChatMessage.create({
    content: `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker.name} → ${defender.name}</span>
          <span class="mi-card-skill">Impale — ${weapon.name} lodges!</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-outcome-row">
            <span class="mi-outcome mi-wound-serious">
              <i class="fas fa-khanda"></i> ${weapon.name} is embedded in ${defender.name}'s ${ctx.hitLocationLabel ?? 'wound'}
            </span>
          </div>
          <div class="mi-se-roll-row">
            <span class="mi-se-roll-label">Penalty now in effect</span>
            <span class="mi-se-roll-val">${gradeDisplay}</span>
          </div>
          <p class="mi-se-roll-note">${weapon.name} stays lodged by default. ${attacker.name} may attempt to yank it free (Ready Weapon + Brawn roll) starting their next turn.</p>
        </div>
      </div>`,
    speaker: ChatMessage.getSpeaker({ actor: attacker })
  });

  // Weapon is left in by default the instant the wound is caused — yanking it
  // free is the only part of this SE actually bound to "next turn" (it costs
  // a Ready Weapon action the attacker can't spend mid-attack). Write the
  // defender's penalty flag now, not when a next-turn button gets clicked.
  const hitLocationId    = ctx.hitLocationId    ?? '';
  const hitLocationLabel = ctx.hitLocationLabel ?? '';
  const existingImpaledBy = defender.getFlag(NS, 'impaledBy') ?? {};
  existingImpaledBy[impaleEntryId] = {
    attackerId:  baseAttacker.id,
    weaponId:    weapon.id,
    weaponName:  weapon.name,
    weaponSize:  weapon.system?.size ?? 'M',
    halfDmgFormula,
    gradeId,
    hitLocationId,
    hitLocationLabel
  };
  await defender.setFlag(NS, 'impaledBy', existingImpaledBy);
  if (gradeId === 'incapacitated') {
    await applyStatusToActor(defender, 'incapacitated');
  }

  const pendingImpales = baseAttacker.getFlag(NS, 'pendingImpales') ?? {};
  pendingImpales[impaleEntryId] = {
    defenderId:         defender.id,
    weaponId:           weapon.id,
    impaleEntryId,
    gradeId,
    gradeDisplay,
    hitLocationId,
    hitLocationLabel,
    halfDmgFormula,
    attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
    lastCardId:         ctx.chatMessageId,
    defenderName:       defender.name,
    weaponName:         weapon.name
  };
  await baseAttacker.setFlag(NS, 'pendingImpales', pendingImpales);
}

// -------------------------------------------------------------------------
// postImpaleDecisionCard — called from updateCombat at the start of the
// attacker's next turn. The penalty is already active (applied immediately
// in resolveImpale) — this card only offers the Yank Free attempt, which is
// the one part of this SE actually bound to "next turn". "Leave It In" is
// just an acknowledgement that dismisses the card without changing anything.
// entry: one entry from flags['mythras-imperative'].pendingImpales
// -------------------------------------------------------------------------
export async function postImpaleDecisionCard(attacker, entry) {
  const {
    defenderId, weaponId, impaleEntryId, gradeId, gradeDisplay,
    hitLocationId, hitLocationLabel, halfDmgFormula,
    attackerSkillTotal, defenderName, weaponName
  } = entry;

  await ChatMessage.create({
    content: `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker.name} → ${defenderName}</span>
          <span class="mi-card-skill">Impale — Leave It In or Yank Free?</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-outcome-row">
            <span class="mi-outcome mi-wound-serious">
              <i class="fas fa-khanda"></i> ${weaponName} remains embedded in ${defenderName}'s ${hitLocationLabel || 'wound'}
            </span>
          </div>
          <div class="mi-se-roll-row">
            <span class="mi-se-roll-label">Penalty (already in effect)</span>
            <span class="mi-se-roll-val">${gradeDisplay}</span>
          </div>
          <div class="mi-se-roll-row">
            <span class="mi-se-roll-label">Yank damage</span>
            <span class="mi-se-roll-val">½ ${halfDmgFormula} (no DM, ignores armour)</span>
          </div>
          <p class="mi-se-roll-note">Yanking costs a Ready Weapon action and a Brawn roll — failure means it stays (retry next turn). Leaving it in needs no action; the penalty already applies.</p>
          <div class="mi-manual-actions">
            <button class="mi-btn mi-btn-impale-leave"
              data-attacker-id="${attacker.id}"
              data-defender-id="${defenderId}"
              data-weapon-id="${weaponId}"
              data-impale-entry-id="${impaleEntryId}"
              data-grade-id="${gradeId}"
              data-hit-location-id="${hitLocationId}"
              data-hit-location-label="${hitLocationLabel}"
              data-half-dmg-formula="${halfDmgFormula}">
              <i class="fas fa-hand-paper"></i> Leave It In
            </button>
            <button class="mi-btn mi-btn-impale-yank"
              data-attacker-id="${attacker.id}"
              data-defender-id="${defenderId}"
              data-weapon-id="${weaponId}"
              data-impale-entry-id="${impaleEntryId}"
              data-grade-id="${gradeId}"
              data-hit-location-id="${hitLocationId}"
              data-hit-location-label="${hitLocationLabel}"
              data-half-dmg-formula="${halfDmgFormula}"
              data-attacker-skill-total="${attackerSkillTotal}">
              <i class="fas fa-hand-rock"></i> Yank Free
            </button>
          </div>
        </div>
      </div>`,
    speaker: ChatMessage.getSpeaker({ actor: attacker }),
    flags: {
      [NS]: {
        stage:             'impale-decision',
        attackerId:        attacker.id,
        defenderId,
        weaponId,
        impaleEntryId,
        gradeId,
        hitLocationId,
        hitLocationLabel,
        halfDmgFormula,
        attackerSkillTotal
      }
    }
  });
}

// -------------------------------------------------------------------------
// applyImpaleLodge — called when attacker clicks "Leave It In".
// The impaledBy flag and any Incapacitated status were already applied
// immediately in resolveImpale (see the timing note at the top of this
// file) — this handler just acknowledges the choice: clears the pending
// entry so no further decision card is queued, and stamps this card
// resolved. No action cost, nothing further to write.
// -------------------------------------------------------------------------
export async function applyImpaleLodge(btn) {
  const attackerId    = btn.dataset.attackerId;
  const defenderId    = btn.dataset.defenderId;
  const weaponId      = btn.dataset.weaponId;
  const impaleEntryId = btn.dataset.impaleEntryId;
  const gradeId       = btn.dataset.gradeId;

  const attacker = game.actors.get(attackerId);
  const defender = game.actors.get(defenderId);
  const weapon   = getItem(attacker, weaponId);
  if (!defender || !weapon) return;

  // Clear the pending impale — decision made
  const pending = attacker?.getFlag(NS, 'pendingImpales') ?? {};
  delete pending[impaleEntryId];
  if (attacker) await attacker.setFlag(NS, 'pendingImpales', pending);

  // Stamp the decision card resolved
  const decisionMsg = game.messages.contents.find(
    m => m.flags?.[NS]?.impaleEntryId === impaleEntryId
      && m.flags?.[NS]?.stage === 'impale-decision'
  );
  if (decisionMsg) await decisionMsg.setFlag(NS, 'impaleResolved', true);

  const gradeShortLabels = {
    none: 'no additional penalty', hard: 'Hard', formidable: 'Formidable',
    herculean: 'Herculean', incapacitated: 'Incapacitated'
  };
  const msg = gradeId === 'none'
    ? `${weapon.name} stays in ${defender.name} — no skill penalty for this creature's size.`
    : gradeId === 'incapacitated'
      ? `${weapon.name} stays in ${defender.name} — Incapacitated (too large for this creature).`
      : `${weapon.name} stays in ${defender.name} — all skill rolls remain at ${gradeShortLabels[gradeId]} while it remains.`;

  await ChatMessage.create({
    content: `<div class="mi-chat-card"><div class="mi-card-body"><div class="mi-outcome-row"><span class="mi-outcome mi-wound-serious"><i class="fas fa-khanda"></i> ${msg}</span></div></div></div>`,
    speaker: ChatMessage.getSpeaker({ actor: attacker })
  });
}

// -------------------------------------------------------------------------
// resolveImpaleYank — called when attacker clicks "Yank Free".
// Defender resists with Brawn. On success: rolls half weapon damage (no DM,
// ignores armour) and applies to hit location. On failure: weapon stays,
// re-queued for attacker's next turn.
// Barbed weapons deal full normal damage on yank (rules p.44).
// -------------------------------------------------------------------------
export async function resolveImpaleYank(btn) {
  const attackerId       = btn.dataset.attackerId;
  const defenderId       = btn.dataset.defenderId;
  const weaponId         = btn.dataset.weaponId;
  const impaleEntryId    = btn.dataset.impaleEntryId;
  const gradeId          = btn.dataset.gradeId;
  const hitLocationId    = btn.dataset.hitLocationId;
  const hitLocationLabel = btn.dataset.hitLocationLabel;
  const halfDmgFormula   = btn.dataset.halfDmgFormula;
  const attackerSkillTotal = parseInt(btn.dataset.attackerSkillTotal ?? '0', 10);

  const attacker = game.actors.get(attackerId);
  const defender = game.actors.get(defenderId);
  const weapon   = getItem(attacker, weaponId);
  if (!attacker || !defender || !weapon) return;

  const isSemi   = game.settings.get(NS, 'automationLevel') === 'semi';
  const isGMMode = game.settings.get(NS, 'gmMode') ?? false;
  const isBarbed = (weapon.system?.traits ?? []).includes('barbed');

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
      seType:             'impaleYank',
      attackerName:       attacker.name,
      defenderName:       defender.name,
      attackRoll:         attackerSkillTotal,
      attackerSkillTotal,
      defenderSkill:      'Brawn',
      defenderRaw:        brawnRaw,
      defenderTotal:      brawnTotal
    }, targetUserId);
    defenderRoll     = response?.roll     ?? null;
    defenderSucceeds = response?.succeeds ?? false;
  } else {
    const roll = new Roll('1d100');
    await roll.evaluate();
    defenderRoll     = roll.total;
    defenderSucceeds = resolveOpposedRoll(
      attackerSkillTotal, attackerSkillTotal,
      defenderRoll, brawnTotal
    );
  }

  const yankSucceeds = !defenderSucceeds;

  // Stamp the decision card resolved regardless of outcome
  const decisionMsg = game.messages.contents.find(
    m => m.flags?.[NS]?.impaleEntryId === impaleEntryId
      && m.flags?.[NS]?.stage === 'impale-decision'
  );
  if (decisionMsg) await decisionMsg.setFlag(NS, 'impaleResolved', true);

  if (yankSucceeds) {
    // Clear impaledBy entry
    const existing = defender.getFlag(NS, 'impaledBy') ?? {};
    delete existing[impaleEntryId];
    await defender.setFlag(NS, 'impaledBy', existing);

    // Clear pending impale
    const pending = attacker.getFlag(NS, 'pendingImpales') ?? {};
    delete pending[impaleEntryId];
    await attacker.setFlag(NS, 'pendingImpales', pending);

    // Clear Incapacitated if this was the only source
    if (gradeId === 'incapacitated') {
      const remaining  = Object.values(existing);
      const stillIncap = remaining.some(e => e.gradeId === 'incapacitated');
      if (!stillIncap) await applyStatusToActor(defender, 'incapacitated'); // toggles off
    }

    // Roll yank damage — half weapon formula, no DM, ignores armour
    const yankFormula = isBarbed ? (weapon.system?.damage ?? halfDmgFormula) : halfDmgFormula;
    const yankRoll    = new Roll(yankFormula);
    await yankRoll.evaluate();
    let yankDamage = yankRoll.total;
    if (!isBarbed) yankDamage = Math.ceil(yankDamage / 2);

    // Apply to hit location — armour does NOT reduce (rules p.44)
    if (hitLocationId && yankDamage > 0) {
      const locItem = getItem(defender, hitLocationId);
      if (locItem) {
        const newCurrent = (locItem.system.current ?? locItem.system.hp) - yankDamage;
        await locItem.update({ 'system.current': newCurrent });
      }
    }

    await ChatMessage.create({
      content: `<div class="mi-chat-card"><div class="mi-card-body">
        <div class="mi-outcome-row"><span class="mi-outcome success"><i class="fas fa-check-circle"></i>
          ${attacker.name} wrenches ${weapon.name} free — ${yankDamage} additional damage to ${hitLocationLabel} (armour ignored${isBarbed ? ', barbed weapon: full damage' : ''}).
        </span></div>
        <div class="mi-se-roll-row"><span class="mi-se-roll-label">Brawn roll</span><span class="mi-se-roll-val">${defenderRoll ?? 'auto'} vs ${brawnTotal}%</span></div>
      </div></div>`,
      speaker: ChatMessage.getSpeaker({ actor: attacker })
    });
  } else {
    // Yank failed — weapon stays; re-queue for next turn
    const pending = attacker.getFlag(NS, 'pendingImpales') ?? {};
    pending[impaleEntryId] = {
      defenderId,
      weaponId,
      impaleEntryId,
      gradeId,
      gradeDisplay:       GRADE_LABELS[gradeId] ?? gradeId,
      hitLocationId,
      hitLocationLabel,
      halfDmgFormula,
      attackerSkillTotal,
      defenderName:       defender.name,
      weaponName:         weapon.name
    };
    await attacker.setFlag(NS, 'pendingImpales', pending);

    // impaledBy is already set (resolveImpale writes it immediately on the
    // original hit) and untouched here — the penalty simply continues.

    await ChatMessage.create({
      content: `<div class="mi-chat-card"><div class="mi-card-body">
        <div class="mi-outcome-row"><span class="mi-outcome mi-wound-minor"><i class="fas fa-times-circle"></i>
          ${attacker.name} fails to yank ${weapon.name} free — it remains lodged. May try again next turn.
        </span></div>
        <div class="mi-se-roll-row"><span class="mi-se-roll-label">Brawn roll</span><span class="mi-se-roll-val">${defenderRoll ?? 'auto'} vs ${brawnTotal}%</span></div>
      </div></div>`,
      speaker: ChatMessage.getSpeaker({ actor: attacker })
    });
  }
}
