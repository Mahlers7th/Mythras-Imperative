/**
 * module/combat/effects/bash.js
 *
 * SE resolver for Bash.
 * Rules p.43: Shield or bludgeoning weapons knock the defender back.
 * Knockback distance uses raw (pre-parry, pre-armour) damage.
 * SIZ restriction: only targets up to twice the attacker's SIZ.
 * Obstacle check in Semi-Auto GM Mode: defender rolls Hard Athletics or
 * Acrobatics; failure → Prone.
 *
 * Dependencies:
 *   helpers.js — runSEDialog, applyFatigueToSkill, applyStatusToActor
 */

import {
  runSEDialog,
  applyFatigueToSkill,
  applyStatusToActor,
} from './helpers.js';

const NS = 'mythras-imperative';

// -------------------------------------------------------------------------
// resolveBash — SE: Bash
// -------------------------------------------------------------------------
export async function resolveBash(ctx) {
  const { attacker, defender, weapon } = ctx;
  if (!attacker || !defender || !weapon) return;

  const isSemi   = game.settings.get(NS, 'automationLevel') === 'semi';
  const isGMMode = game.settings.get(NS, 'gmMode') ?? false;

  // ── Weapon type: shield or bludgeoning ──────────────────────────────────
  const traits    = weapon.system?.traits ?? [];
  const isShield  = traits.includes('shield');
  const divisor   = isShield ? 2 : 3;
  const typeLabel = isShield ? 'Shield' : 'Bludgeoning';

  // ── Raw damage (pre-parry, pre-armour) ───────────────────────────────────
  const rawDamage = (ctx.rawDamage > 0 ? ctx.rawDamage : null)
                 ?? (ctx.damageAfterParry > 0 ? ctx.damageAfterParry : null)
                 ?? 0;
  if (rawDamage <= 0) {
    console.warn('Mythras Imperative | Bash: rawDamage is 0 — cannot calculate knockback.');
    return;
  }

  const knockbackMetres = Math.ceil(rawDamage / divisor);

  // ── SIZ check ────────────────────────────────────────────────────────────
  const attackerSIZ = attacker.system?.characteristics?.siz?.value ?? 0;
  const defenderSIZ = defender.system?.characteristics?.siz?.value ?? 0;
  const sizLimit    = attackerSIZ * 2;
  const tooBig      = defenderSIZ > sizLimit;

  if (tooBig) {
    await ChatMessage.create({
      content: `
        <div class="mi-chat-card">
          <div class="mi-card-header mi-card-header--stacked">
            <span class="mi-card-actor">${attacker.name} → ${defender.name}</span>
            <span class="mi-card-skill">Bash — ${typeLabel}</span>
          </div>
          <div class="mi-card-body">
            <div class="mi-outcome-row">
              <span class="mi-outcome mi-wound-minor">
                <i class="fas fa-shield-alt"></i>
                ${defender.name} is too large to knock back
                (SIZ ${defenderSIZ} vs limit ${sizLimit})
              </span>
            </div>
          </div>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor: attacker })
    });
    return;
  }

  // ── Post knockback card ───────────────────────────────────────────────────
  await ChatMessage.create({
    content: `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker.name} → ${defender.name}</span>
          <span class="mi-card-skill">Bash — ${typeLabel}</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-se-roll-row">
            <span class="mi-se-roll-label">Raw damage</span>
            <span class="mi-se-roll-val">${rawDamage}</span>
          </div>
          <div class="mi-se-roll-row">
            <span class="mi-se-roll-label">Knockback (÷${divisor})</span>
            <span class="mi-se-roll-val">${knockbackMetres} metre${knockbackMetres !== 1 ? 's' : ''}</span>
          </div>
          <p class="mi-se-roll-note">
            ${defender.name} is knocked back ${knockbackMetres} metre${knockbackMetres !== 1 ? 's' : ''}.
            ${isSemi && isGMMode
              ? 'Declare obstacle status to resolve collision.'
              : 'GM resolves any obstacle collision narratively.'}
          </p>
        </div>
      </div>`,
    speaker: ChatMessage.getSpeaker({ actor: attacker })
  });

  // ── Obstacle check (Semi-Auto GM Mode only) ──────────────────────────────
  if (!isSemi || !isGMMode) return;

  const hitObstacle = await runSEDialog({
    seType:       'bashObstacle',
    lastCardId:   ctx.chatMessageId,
    attackerName: attacker.name,
    defenderName: defender.name,
    knockback:    knockbackMetres,
    typeLabel
  });

  if (!hitObstacle) return;

  // Obstacle hit — defender rolls Hard Athletics or Acrobatics
  const athleticsSkill  = Array.from(defender.items).find(i => i.type === 'skill' && i.name === 'Athletics');
  const acrobaticsSkill = Array.from(defender.items).find(i => i.type === 'skill' && i.name === 'Acrobatics');

  const _adj = (raw) => {
    const afterFatigue = applyFatigueToSkill(raw, defender);
    return Math.ceil(afterFatigue * CONFIG.MYTHRAS.difficultyGrades.hard.multiplier);
  };

  const skillOptions = [
    athleticsSkill  && { name: 'Athletics',  rawTotal: athleticsSkill.system.total  ?? 0, total: _adj(athleticsSkill.system.total  ?? 0) },
    acrobaticsSkill && { name: 'Acrobatics', rawTotal: acrobaticsSkill.system.total ?? 0, total: _adj(acrobaticsSkill.system.total ?? 0) }
  ].filter(Boolean);

  if (skillOptions.length === 0) skillOptions.push({ name: 'Athletics', rawTotal: 0, total: 0 });

  const response = await runSEDialog({
    seType:       'bashObstacleRoll',
    lastCardId:   ctx.chatMessageId,
    attackerName: attacker.name,
    defenderName: defender.name,
    knockback:    knockbackMetres,
    skillOptions
  });

  const roll          = response?.roll     ?? null;
  const defenderSaved = response?.succeeds ?? false;

  if (!defenderSaved) {
    await applyStatusToActor(defender, 'prone');
  }

  const chosenSkill = response?.chosenSkill ?? skillOptions[0];
  await ChatMessage.create({
    content: `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${defender.name}</span>
          <span class="mi-card-skill">Bash — Obstacle Collision</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-se-roll-row">
            <span class="mi-se-roll-label">${defender.name} — ${chosenSkill.name} (Hard: ${chosenSkill.total}%)</span>
            <span class="mi-se-roll-val">${roll ?? '—'}</span>
          </div>
          <div class="mi-outcome-row">
            <span class="mi-outcome ${defenderSaved ? 'success' : 'mi-wound-serious'}">
              <i class="fas fa-${defenderSaved ? 'check-circle' : 'times-circle'}"></i>
              ${defenderSaved
                ? `${defender.name} keeps their footing`
                : `${defender.name} trips — Prone`}
            </span>
          </div>
        </div>
      </div>`,
    speaker: ChatMessage.getSpeaker({ actor: attacker })
  });
}
