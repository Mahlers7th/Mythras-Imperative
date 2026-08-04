/**
 * module/combat/effects/spellcasting.js
 *
 * Mythras Imperative's own Magic system (rules p.63): casting a spell costs
 * one Action Point and a Magic skill roll. Result grade determines whether
 * the spell works and how many Magic Points it costs:
 *
 *   Critical — works, 0 MP cost
 *   Success  — works, 1 MP cost
 *   Failure  — fails, 1 MP cost
 *   Fumble   — fails, 1d3 MP cost
 *
 * A spell with the Resist trait (Endurance/Evade/Willpower) is opposed by
 * the target's chosen skill against the caster's Magic result — 'special'
 * (a handful of spells whose resistance doesn't map to one of the three)
 * is deliberately not automated, left to the GM per the trait's own
 * description. Evade resistance costs the target an Action Point per the
 * rulebook; a target with none is "powerless against the spell's effect."
 *
 * Concentration is tracked as a simple flag — ending it on distraction is
 * GM-adjudicated, there is no automated interruption detection here.
 *
 * Does NOT model Classic Fantasy Imperative's separate, more complex magic
 * system (two casting skills, variable Intensity/Magnitude, a different
 * MP-cost-by-outcome table) — see ItemData.js's SpellData doc comment.
 */

import { resolveOpposedRoll } from '../../utils/combat-math.js';
import { determineOutcome } from '../../utils/roll-math.js';
import { applyFatigueToSkill } from '../../utils/fatigue.js';

const NS = 'mythras-imperative';

const RESIST_SKILL_NAMES = { endurance: 'Endurance', evade: 'Evade', willpower: 'Willpower' };

const OUTCOME_LABEL = {
  critical: 'Critical', success: 'Success', failure: 'Failure', fumble: 'Fumble'
};

/**
 * Cast a spell. Spends the caster's Action Point and Magic Points, rolls
 * the Magic skill, and — if the spell has the Resist trait — resolves the
 * target's opposed resistance roll. `target` is optional; Resist is simply
 * skipped (and the spell always "hits") if none is supplied.
 *
 * @param {Actor} caster
 * @param {Item}  spellItem
 * @param {Actor|null} target
 * @returns {Promise<object|null>} cast result, or null if casting was refused
 *   before any cost was paid (no AP, no MP, no Magic skill).
 */
export async function castSpell(caster, spellItem, target = null) {
  const ap = caster.system.attributes?.actionPoints;
  if (ap && typeof ap.value === 'number' && ap.value <= 0) {
    ui.notifications.warn(`${caster.name} has no Action Points remaining.`);
    return null;
  }

  const magicSkill = Array.from(caster.items).find(i => i.type === 'skill' && i.name === 'Magic');
  if (!magicSkill) {
    ui.notifications.warn(`${caster.name} has no Magic skill.`);
    return null;
  }

  const mp = caster.system.attributes?.magicPoints;
  if (!mp || mp.value <= 0) {
    ui.notifications.warn(`${caster.name} has no Magic Points remaining.`);
    return null;
  }

  const skillTotal = applyFatigueToSkill(magicSkill.system.total ?? 0, caster);

  // Preparing and casting a spell requires one Action Point (rules p.63) —
  // spent regardless of outcome, same as any other proactive Combat Action.
  await caster.update({ 'system.attributes.actionPoints.value': Math.max(0, ap.value - 1) });

  const roll = new Roll('1d100');
  await roll.evaluate();
  const outcome = determineOutcome(roll.total, skillTotal, skillTotal);

  let mpCost = 0;
  let works  = false;
  if (outcome === 'critical') { mpCost = 0; works = true; }
  else if (outcome === 'success') { mpCost = 1; works = true; }
  else if (outcome === 'failure') { mpCost = 1; works = false; }
  else { // fumble
    const fumbleRoll = new Roll('1d3');
    await fumbleRoll.evaluate();
    mpCost = fumbleRoll.total;
    works  = false;
  }

  const currentMP = caster.system.attributes.magicPoints.value;
  await caster.update({ 'system.attributes.magicPoints.value': Math.max(0, currentMP - mpCost) });

  let resistResult = null;
  if (works && target && (spellItem.system.traits ?? []).includes('resist')) {
    resistResult = await _resolveSpellResist(spellItem, target, roll.total, skillTotal);
    if (resistResult?.resisted) works = false;
  }

  if (works && (spellItem.system.traits ?? []).includes('concentration')) {
    await caster.setFlag(NS, `concentrating.${spellItem.id}`, {
      spellName: spellItem.name, startedAt: Date.now()
    });
  }

  await _postCastCard(caster, spellItem, target, { outcome, roll: roll.total, skillTotal, mpCost, works, resistResult });

  return { outcome, roll: roll.total, mpCost, works, resistResult };
}

/**
 * Resolve a spell's Resist trait against a target. Endurance/Willpower are
 * passive (no AP cost, per rules p.63); Evade costs the target an Action
 * Point, and a target with none is "powerless against the spell's effect."
 * Returns null (not automated) for 'special' or an unset resistSkill.
 */
async function _resolveSpellResist(spellItem, target, casterRollTotal, casterSkillTotal) {
  const resistKey = spellItem.system.resistSkill;
  if (!resistKey || resistKey === 'special') return null;

  const skillName = RESIST_SKILL_NAMES[resistKey];
  const targetSkill = Array.from(target.items).find(i => i.type === 'skill' && i.name === skillName);
  const targetSkillTotal = targetSkill?.system.total ?? 0;

  if (resistKey === 'evade') {
    const targetAP = target.system.attributes?.actionPoints;
    if (!targetAP || targetAP.value <= 0) {
      return { resisted: false, reason: 'no-ap', skillName, roll: null, skillTotal: targetSkillTotal };
    }
    await target.update({ 'system.attributes.actionPoints.value': Math.max(0, targetAP.value - 1) });
  }

  const targetRoll = new Roll('1d100');
  await targetRoll.evaluate();
  // resolveOpposedRoll's "defender" is the resisting target here.
  const resisted = resolveOpposedRoll(casterRollTotal, casterSkillTotal, targetRoll.total, targetSkillTotal);

  return { resisted, skillName, roll: targetRoll.total, skillTotal: targetSkillTotal };
}

async function _postCastCard(caster, spellItem, target, result) {
  const { outcome, roll, skillTotal, mpCost, works, resistResult } = result;

  const resistLine = resistResult
    ? (resistResult.reason === 'no-ap'
        ? `<div class="mi-se-roll-row"><span class="mi-se-roll-label">${target.name} — ${resistResult.skillName}</span><span class="mi-se-roll-val">no Action Points — powerless to resist</span></div>`
        : `<div class="mi-se-roll-row"><span class="mi-se-roll-label">${target.name} — ${resistResult.skillName}</span><span class="mi-se-roll-val">${resistResult.roll} vs ${resistResult.skillTotal}% — ${resistResult.resisted ? 'resisted' : 'failed to resist'}</span></div>`)
    : '';

  const content = `
    <div class="mi-chat-card">
      <div class="mi-card-header mi-card-header--stacked">
        <span class="mi-card-actor">${caster.name}${target ? ` → ${target.name}` : ''}</span>
        <span class="mi-card-skill">${spellItem.name}</span>
      </div>
      <div class="mi-card-body">
        <div class="mi-se-roll-row">
          <span class="mi-se-roll-label">Magic</span>
          <span class="mi-se-roll-val">${roll} vs ${skillTotal}% — ${OUTCOME_LABEL[outcome]}</span>
        </div>
        <div class="mi-outcome-row">
          <span class="mi-outcome ${works ? 'success' : 'failure'}">
            <i class="fas ${works ? 'fa-magic' : 'fa-times-circle'}"></i>
            ${works ? `${spellItem.name} takes effect` : `${spellItem.name} fails`} — ${mpCost} Magic Point${mpCost === 1 ? '' : 's'} spent
          </span>
        </div>
        ${resistLine}
      </div>
    </div>`;

  await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ actor: caster }) });
}
