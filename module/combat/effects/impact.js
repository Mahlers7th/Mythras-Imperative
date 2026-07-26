/**
 * module/combat/effects/impact.js
 *
 * SE resolver for Impact — the "light" twin of Impale (see impale.js).
 * Core Mythras rule: an impaling hit may be rerolled and the higher of the
 * two results kept, with no obligation to leave the weapon lodged. This
 * engine's `impale` resolver only ever implements the lodge/yank half of
 * that rule (see impale.js's own header) — Impact exists so a hero with an
 * impaling weapon but WITHOUT Destined's Impaling Attack Expertise (which
 * gates `impale` itself, see seEligibilityHooks in config.js) still gets
 * the baseline reroll benefit every impaling weapon is entitled to.
 *
 * No opposed roll, no dialog — automatic in all automation modes, same
 * shape as damage-weapon.js. Applies the reroll's DELTA directly to the
 * hit location, bypassing armour for that delta only (the original hit
 * already ran the full armour/parry pipeline before this SE resolver is
 * ever reached — the SE dispatch only fires once damage has already been
 * dealt, see the catalog's `requiresDamage: true`).
 *
 * Dependencies: helpers.js — getItem
 */

import { getItem } from './helpers.js';

// -------------------------------------------------------------------------
// resolveImpact — SE: Impact (requires damage > 0)
// -------------------------------------------------------------------------
export async function resolveImpact(ctx, damage) {
  const { attacker, defender, weapon } = ctx;
  if (!attacker || !defender || !weapon) return;
  if (!(damage > 0)) return;

  const formula = weapon.system?.damage ?? '1d4';
  const reroll  = new Roll(formula);
  await reroll.evaluate();
  const rerollTotal = reroll.total;

  const kept  = Math.max(damage, rerollTotal);
  const delta = kept - damage;

  if (delta > 0 && ctx.hitLocationId) {
    const locItem = getItem(defender, ctx.hitLocationId);
    if (locItem) {
      const newCurrent = (locItem.system.current ?? locItem.system.hp) - delta;
      await locItem.update({ 'system.current': newCurrent });
    }
  }

  await ChatMessage.create({
    content: `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker.name} → ${defender.name}</span>
          <span class="mi-card-skill">Impact — ${weapon.name}</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-se-roll-row">
            <span class="mi-se-roll-label">Original damage</span>
            <span class="mi-se-roll-val">${damage}</span>
          </div>
          <div class="mi-se-roll-row">
            <span class="mi-se-roll-label">Reroll (${formula})</span>
            <span class="mi-se-roll-val">${rerollTotal}</span>
          </div>
          <div class="mi-outcome-row">
            <span class="mi-outcome ${delta > 0 ? 'mi-wound-serious' : 'success'}">
              <i class="fas ${delta > 0 ? 'fa-arrow-up' : 'fa-check-circle'}"></i>
              ${delta > 0
                ? `Reroll is higher — ${delta} additional damage to ${ctx.hitLocationLabel ?? 'the location'} (armour bypassed for the delta)`
                : 'Original result stands — no additional damage'}
            </span>
          </div>
        </div>
      </div>`,
    speaker: ChatMessage.getSpeaker({ actor: attacker })
  });
}
