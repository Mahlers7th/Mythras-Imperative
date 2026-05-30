/**
 * mythras-imperative/module/rolls/MythrasRoll.js
 *
 * Core roll resolution for Mythras Imperative.
 * Handles: skill rolls, difficulty grades, success levels,
 * passion augmentation, luck point re-roll/swap.
 */

export class MythrasRoll {

  // -------------------------------------------------------------------------
  // Roll Dialog
  // -------------------------------------------------------------------------

  /**
   * Opens the roll prompt dialog and executes the roll on confirm.
   * @param {object} opts
   * @param {Actor}  opts.actor
   * @param {Item}   opts.item       The skill/combat-style/passion being rolled
   * @param {Item[]} opts.passions   All passion items on the actor (for augment selector)
   */
  static async rollDialog({ actor, item, skillTotal, passions = [], gradeEasier = false }) {
    skillTotal = skillTotal ?? item.system.total ?? 0;
    const skillName  = item.type === 'passion'
      ? `${item.system.verb}${item.system.target ? ` (${item.system.target})` : ''}`
      : item.name;

    // Condition floor: worst of fatigue grade and prone.
    // Delegated to CombatEngine helpers so all paths stay consistent.
    const { CombatEngine } = await import('../combat/CombatEngine.js');
    const floorGrade   = CombatEngine._getConditionFloorGrade(actor);
    const gradeOrder   = ['veryEasy','easy','standard','hard','formidable','herculean','hopeless'];
    const floorIdx     = gradeOrder.indexOf(floorGrade);

    // Hero advantage: grade one step easier — shift floor index down by 1 (but never below 0)
    const effectiveFloorIdx = gradeEasier ? Math.max(0, floorIdx - 1) : floorIdx;
    const defaultDiff  = gradeOrder[effectiveFloorIdx];
    const condNotesStr = CombatEngine._buildConditionNotes(actor);

    // Effective skill after applying the floor grade
    const effectiveSkill = MythrasRoll._applyFatigueGrade(
      skillTotal, floorGrade !== 'standard' ? floorGrade : null
    );

    // Difficulty options — floor pre-selected, easier options disabled
    const difficultyOptions = Object.entries(CONFIG.MYTHRAS.difficultyGrades)
      .map(([key, grade]) => {
        const selected = key === defaultDiff ? ' selected' : '';
        const thisIdx  = gradeOrder.indexOf(key);
        const disabled = thisIdx < effectiveFloorIdx ? ' disabled' : '';
        return `<option value="${key}"${selected}${disabled}>${game.i18n.localize(grade.label)}</option>`;
      }).join('');

    const fatigueNote = condNotesStr
      ? `<div class="mi-dialog-fatigue-note"><i class="fas fa-exclamation-triangle"></i> ${condNotesStr} difficulty applied</div>`
      : '';

    // Passion augment — 20% of passion value, floor
    const eligiblePassions = passions.filter(p => p.id !== item.id);
    const passionOptions = eligiblePassions.map(p => {
      const name    = `${p.system.verb}${p.system.target ? ` (${p.system.target})` : ''}`;
      const augment = Math.floor(p.system.total * 0.20);
      return `<option value="${p.id}" data-augment="${augment}">${name} (+${augment}%)</option>`;
    }).join('');

    const gradeEasierNote = gradeEasier
      ? `<div class="mi-dialog-hero-note"><i class="fas fa-star"></i> Hero advantage — difficulty one grade easier</div>`
      : '';

    const content = `
      <div class="mi-roll-dialog">
        <div class="mi-dialog-skill-header">
          <span class="mi-dialog-skill-name">${skillName}</span>
          <span class="mi-dialog-skill-base">${effectiveSkill}%${floorGrade !== 'standard' ? ` <span class="mi-dialog-skill-raw">(base ${skillTotal}%)</span>` : ''}</span>
        </div>
        ${fatigueNote}
        ${gradeEasierNote}
        <div class="mi-dialog-fields">
          <div class="mi-form-row">
            <label>Difficulty</label>
            <select id="mi-difficulty">${difficultyOptions}</select>
          </div>
          <div class="mi-form-row">
            <label>Augment</label>
            <select id="mi-passion">
              <option value="">— None —</option>
              ${passionOptions}
            </select>
          </div>
        </div>
        <div class="mi-dialog-target-row">
          <span class="mi-dialog-target-label">Target</span>
          <span class="mi-dialog-target-val" id="mi-target-display">${effectiveSkill}</span>
        </div>
      </div>
    `;

    return new Promise(resolve => {
      const dialog = new Dialog({
        title: skillName,
        content,
        buttons: {
          roll: {
            icon: '<i class="fas fa-dice"></i>',
            label: 'Roll',
            callback: async html => {
              const difficulty = html.find('#mi-difficulty').val();
              const passionId  = html.find('#mi-passion').val() || '';
              const passion    = eligiblePassions.find(p => p.id === passionId) ?? null;
              await MythrasRoll.execute({ actor, item, skillName, skillTotal, difficulty, modifier: 0, passion });
              resolve(true);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Cancel',
            callback: () => resolve(false)
          }
        },
        default: 'roll',
        classes: ['dialog', 'mi-dialog'],
        render: html => {
          const update = () => {
            const diff    = html.find('#mi-difficulty').val();
            const pid     = html.find('#mi-passion').val() || '';
            const passion = eligiblePassions.find(p => p.id === pid);
            const augment = passion ? Math.floor(passion.system.total * 0.20) : 0;
            // Worst of chosen difficulty and the active condition floor
            const chosenIdx  = gradeOrder.indexOf(diff);
            const worstIdx   = Math.max(chosenIdx, floorIdx);
            const worstGrade = gradeOrder[worstIdx] ?? diff;
            const target = MythrasRoll.applyDifficulty(skillTotal + augment, worstGrade);
            html.find('#mi-target-display').text(worstGrade === 'hopeless' ? '—' : `${target}`);
          };
          html.find('#mi-difficulty, #mi-passion').on('change input', update);
          update();
        }
      });
      dialog.render(true);
    });
  }

  // ── Static helper: apply a difficulty grade string to a skill total ────────
  static _applyFatigueGrade(skillTotal, gradeId) {
    if (!gradeId) return skillTotal;
    const grades   = CONFIG.MYTHRAS?.difficultyGrades ?? {};
    const gradeDef = grades[gradeId];
    if (!gradeDef) return skillTotal;
    if (gradeDef.multiplier === null) return 0;
    return Math.max(0, Math.ceil(skillTotal * gradeDef.multiplier));
  }

  // -------------------------------------------------------------------------
  // Execute Roll
  // -------------------------------------------------------------------------

  static async execute({ actor, item, skillName, skillTotal, difficulty, modifier = 0, passion = null }) {
    // Hopeless — no dice, automatic failure
    if (difficulty === 'hopeless') {
      return MythrasRoll._postResult({ actor, item, skillName, roll: null, target: 0, outcome: 'failure', difficulty, modifier, passion });
    }

    // Passion augment: 20% of passion value (floor), per rules
    const augment       = passion ? Math.floor(passion.system.total * 0.20) : 0;
    const adjustedSkill = skillTotal + modifier + augment;

    // Apply chosen difficulty grade
    let target = MythrasRoll.applyDifficulty(adjustedSkill, difficulty);

    // All active condition penalties (fatigue, prone) — take worst grade
    if (actor) {
      const { CombatEngine: CE } = await import('../combat/CombatEngine.js');
      const condFloor = CE._getConditionFloorGrade(actor);
      if (condFloor && condFloor !== 'standard') {
        const condTarget = MythrasRoll.applyDifficulty(adjustedSkill, condFloor);
        target = Math.min(target, condTarget);
      }
    }

    // Roll 1d100
    const roll = new Roll('1d100');
    await roll.evaluate();
    const result = roll.total;

    // Determine outcome
    const outcome = MythrasRoll.determineOutcome(result, target, adjustedSkill);

    // Mark fumble on item for experience tracking
    if (outcome === 'fumble' && !item.system.fumbledLastSession) {
      await item.update({ 'system.fumbledLastSession': true });
    }

    await MythrasRoll._postResult({ actor, item, skillName, roll, result, target, outcome, difficulty, modifier, passion });
  }

  // -------------------------------------------------------------------------
  // Apply Difficulty Grade
  // -------------------------------------------------------------------------

  static applyDifficulty(skill, difficulty) {
    const grades = CONFIG.MYTHRAS.difficultyGrades;
    const grade  = grades[difficulty];
    if (!grade || grade.multiplier === null) return skill;
    return Math.ceil(skill * grade.multiplier);
  }

  // -------------------------------------------------------------------------
  // Determine Outcome
  // Result: 'critical' | 'success' | 'failure' | 'fumble'
  // -------------------------------------------------------------------------

  static determineOutcome(result, target, rawSkill) {
    // Fumble: 99-100, or 00 (=100) if skill < 50
    if (result >= 100 || (result >= 99 && rawSkill < 100)) {
      return 'fumble';
    }
    if (result < 100 && rawSkill < 50 && result >= 99) return 'fumble';

    // Critical: ≤ 1/10 of target (round up)
    const critThreshold = Math.ceil(target / 10);
    if (result <= critThreshold) return 'critical';

    // Success / Failure
    return result <= target ? 'success' : 'failure';
  }

  // -------------------------------------------------------------------------
  // Post Chat Result
  // -------------------------------------------------------------------------

  static async _postResult({ actor, item, skillName, roll, result, target, outcome, difficulty, modifier, passion }) {
    const outcomeLabels = {
      critical: game.i18n.localize('MYTHRAS.OutcomeCritical'),
      success:  game.i18n.localize('MYTHRAS.OutcomeSuccess'),
      failure:  game.i18n.localize('MYTHRAS.OutcomeFailure'),
      fumble:   game.i18n.localize('MYTHRAS.OutcomeFumble')
    };

    const diffLabel  = game.i18n.localize(CONFIG.MYTHRAS.difficultyGrades[difficulty]?.label ?? difficulty);
    const canUseLuck = roll && actor.system.attributes?.luckPoints?.value > 0;

    // Build detail pills
    const details = [];
    if (difficulty && difficulty !== 'standard') details.push(diffLabel);
    if (modifier !== 0) details.push(`${modifier > 0 ? '+' : ''}${modifier}%`);
    if (passion) {
      const pName  = `${passion.system.verb}${passion.system.target ? ` (${passion.system.target})` : ''}`;
      const pBonus = Math.ceil(passion.system.total * 0.2);
      details.push(`${pName} +${pBonus}%`);
    }
    const detailHtml = details.length
      ? `<div class="mi-card-details">${details.map(d => `<span class="mi-card-pill">${d}</span>`).join('')}</div>`
      : '';

    const targetHtml = (target !== undefined && difficulty !== 'hopeless')
      ? `<div class="mi-card-target">Target <strong>${target}%</strong></div>`
      : '';

    const rollHtml = roll
      ? `<div class="mi-roll-result">${result}${result !== undefined && outcome ? '' : ''}</div>`
      : '';

    const luckHtml = canUseLuck ? `
      <div class="mi-luck-buttons">
        <button class="mi-luck-reroll"><i class="fas fa-dice"></i> ${game.i18n.localize('MYTHRAS.LuckPointReroll')}</button>
        <button class="mi-luck-swap"><i class="fas fa-exchange-alt"></i> ${game.i18n.localize('MYTHRAS.LuckPointSwap')}</button>
      </div>` : '';

    const content = `
      <div class="mi-chat-card">
        <div class="mi-card-header">
          <span class="mi-card-actor">${actor.name}</span>
          <span class="mi-card-skill">${skillName}</span>
        </div>
        <div class="mi-card-body">
          ${detailHtml}
          ${targetHtml}
          ${rollHtml}
          <div class="mi-outcome-row">
            <span class="mi-outcome ${outcome}">${outcomeLabels[outcome]}</span>
          </div>
          ${luckHtml}
        </div>
      </div>
    `;

    const chatData = {
      content,
      speaker: ChatMessage.getSpeaker({ actor }),
      rolls: roll ? [roll] : [],
      flags: {
        'mythras-imperative': {
          actorId: actor.id,
          itemId: item.id,
          rollData: roll ? { result, target, outcome, difficulty, modifier } : null
        }
      }
    };

    for (const hook of CONFIG.MYTHRAS.rollHooks.postRoll) {
      hook({ actor, item, roll, outcome, chatData });
    }

    await ChatMessage.create(chatData);
  }

  // -------------------------------------------------------------------------
  // Luck Point: Re-roll
  // -------------------------------------------------------------------------

  static async reroll(message, actor) {
    const rollData = message.flags?.['mythras-imperative']?.rollData;
    const itemId   = message.flags?.['mythras-imperative']?.itemId;
    const item     = actor.items.get(itemId);
    if (!rollData || !item) return;

    const newRoll = new Roll('1d100');
    await newRoll.evaluate();
    const result  = newRoll.total;
    const outcome = MythrasRoll.determineOutcome(result, rollData.target, rollData.target);

    await message.update({
      content: message.content.replace(
        /<div class="mi-roll-result">[\d]+<\/div>/,
        `<div class="mi-roll-result">${result} <span class="mi-rerolled">(rerolled)</span></div>`
      ).replace(
        /mi-outcome [a-z]+/,
        `mi-outcome ${outcome}`
      )
    });
  }

  // -------------------------------------------------------------------------
  // Luck Point: Swap Digits (e.g. 75 → 57)
  // -------------------------------------------------------------------------

  static async swapDigits(message, actor) {
    const rollData = message.flags?.['mythras-imperative']?.rollData;
    if (!rollData) return;

    const orig    = rollData.result;
    const tens    = Math.floor(orig / 10);
    const units   = orig % 10;
    const swapped = units * 10 + tens;
    const outcome = MythrasRoll.determineOutcome(swapped, rollData.target, rollData.target);

    await message.update({
      content: message.content.replace(
        /<div class="mi-roll-result">[\d]+<\/div>/,
        `<div class="mi-roll-result">${swapped} <span class="mi-rerolled">(swapped from ${orig})</span></div>`
      ).replace(
        /mi-outcome [a-z]+/,
        `mi-outcome ${outcome}`
      )
    });
  }
}
