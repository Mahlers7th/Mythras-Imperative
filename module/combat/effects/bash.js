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
import { resolveBashSizGate } from '../../utils/combat-math.js';

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

  // Multiplier hooks (e.g. Destined's Improvised Weapon Expertise doubles
  // knockback for a Large-or-larger improvised weapon) — non-finite/
  // non-positive results are ignored, default multiplier is 1.
  //
  // STRONGEST WINS (v1.4.307, was last-registered-wins). Contributions combine
  // by Math.max, not by plain assignment and not by a product. Three consumers
  // are registered simultaneously by one module today (an Enhanced Strength
  // charge at x3, a Large improvised weapon at x2, a Growth charge at x2) and
  // they are independent powers with no exclusivity between them — under the
  // old assignment the last-registered hook silently overwrote the others, so
  // a hero who spent a x3 charge could receive x2 with no error and a chat
  // card that reported it as correct. Max was chosen over a product (Chris's
  // ruling): nobody loses an effect they paid for, and nothing becomes
  // unexpectedly stronger than any single source claims.
  let knockbackMultiplier = 1;
  for (const hook of (CONFIG.MYTHRAS?.bashKnockbackMultiplierHooks ?? [])) {
    try {
      const result = hook(attacker, weapon);
      if (Number.isFinite(result) && result > 0) {
        knockbackMultiplier = Math.max(knockbackMultiplier, result);
      }
    } catch (err) {
      console.error('Mythras Imperative | bashKnockbackMultiplierHooks: hook threw', err);
    }
  }

  const knockbackMetres = Math.ceil((rawDamage * knockbackMultiplier) / divisor);

  // ── SIZ check ────────────────────────────────────────────────────────────
  // Brace (CFI Combat Action): "Against the Bash Special Effect, SIZ is
  // doubled." A braced defender therefore compares 2 x SIZ against the
  // attacker's limit, making them harder to knock back — this is the ONE live
  // consumer of the Brace stance in the engine (knockback distance takes no
  // SIZ term, and Leaping Attacks do not exist here). See
  // combat-actions-design.md §1a. ctx.isBraced is set by
  // CombatEngine._applyDefenceData from the defender's own dialog.
  const attackerSIZ = attacker.system?.characteristics?.siz?.value ?? 0;
  const baseSIZ     = defender.system?.characteristics?.siz?.value ?? 0;
  const isBraced    = ctx.isBraced === true;
  const { effectiveSIZ: defenderSIZ, sizLimit, tooBig } =
    resolveBashSizGate(attackerSIZ, baseSIZ, isBraced);

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
                (SIZ ${defenderSIZ}${isBraced ? ` — ${baseSIZ} braced, doubled` : ''} vs limit ${sizLimit})
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
