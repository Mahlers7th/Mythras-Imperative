/**
 * mythras-imperative/module/combat/SpecialEffectDialog.js
 *
 * Special Effect Selection Dialog — step 11 of the combat flow.
 *
 * Opens for the winner of the differential roll (attacker or defender).
 * The player/GM ALWAYS makes this choice — never automated.
 *
 * Filtering rules (from Mythras Imperative p.42-46 and Special Effects table):
 *
 *   who:          'attacker' | 'defender' | 'both'
 *   restriction:  null       — always available to the winner
 *                 'attackerCritical'  — only when attacker rolled Critical
 *                 'defenderCritical'  — only when defender rolled Critical
 *                 'rangedNotClose'    — free for melee and Close-range ranged;
 *                                      Critical only at Effective/Long range
 *                                      (Choose Location, rules p.42)
 *                 'attackerFumbles'         — only when attacker rolled Fumble
 *                 'attackerFumblesFirearm'  — attacker fumbled AND weapon has 'firearm' trait
 *                 'opponentFumbles'         — only when the opponent (loser) fumbled
 *                 'shieldOrBludgeon'  — weapon must have 'bludgeoning' trait or be a shield
 *                 'cuttingWeapon'     — weapon must have 'bleeding' trait
 *                 'entanglingWeapon'  — weapon must have 'entangling' trait
 *                 'impalingWeapon'    — weapon must have 'impaling' trait
 *                 'unarmed'           — weapon must have 'unarmed' trait
 *                 'sunderWeapon'      — weapon must have 'sundering' trait or be two-handed
 *                 'rangedWeapon'      — weapon category must be 'ranged'
 *                 'firearmsOnly'      — weapon must have 'firearm' trait
 *
 * Stackable SEs: Maximise Damage and Bypass Armour may be selected multiple
 * times (up to seCount), as noted in the rules. All others are single-select.
 *
 * Resolves with string[] of chosen SE ids, or [] if cancelled.
 */

export class SpecialEffectDialog {

  /**
   * Open the SE selection dialog for the winner.
   *
   * @param {object} ctx  The live combatContext after rolls are resolved
   * @returns {Promise<string[]>}  Array of chosen SE ids (length = ctx.seCount)
   */
  static async show(ctx) {
    const { seWinner, seCount, attackOutcome, defenceOutcome } = ctx;

    const isAttackerWinner = seWinner === 'attacker';
    const winnerName = isAttackerWinner ? ctx.attacker.name : ctx.defender.name;

    // ── Filter available SEs ─────────────────────────────────────────────────
    const available = _filterSEs(ctx, isAttackerWinner);

    if (available.length === 0) {
      // Shouldn't happen, but handle gracefully
      ui.notifications.info(`${winnerName} wins ${seCount} Special Effect(s) but no eligible effects available.`);
      return [];
    }

    // ── Build the dialog HTML ────────────────────────────────────────────────
    // Player must choose exactly seCount effects.
    // Stackable effects can appear more than once in the selection.
    const isForceFailure = ctx.seWinner !== 'none' &&
      (isAttackerWinner ? ctx.defenceOutcome : ctx.attackOutcome) === 'fumble';

    const seRows = available.map(se => {
      const label     = game.i18n.localize(se.label);
      const stackNote = se.stackable
        ? `<span class="mi-se-stackable">stackable</span>` : '';
      const isFF = se.id === 'forceFailure';
      return `
        <label class="mi-se-option${isFF ? ' mi-se-option--ff' : ''}" data-id="${se.id}" data-stackable="${se.stackable ?? false}" data-count="0">
          <input type="checkbox" name="mi-se-choice" value="${se.id}">
          <span class="mi-se-label">${label}${isFF ? ' <span class="mi-se-ff-note">(auto-fails opponent\'s next opposed roll)</span>' : ''}</span>
          <span class="mi-se-stack-count" style="display:none">×<span class="mi-se-stack-num">1</span></span>
          ${stackNote}
        </label>`;
    }).join('');

    const remainingHint = seCount === 1
      ? 'Choose 1 Special Effect'
      : `Choose up to ${seCount} Special Effects`;

    const content = `
      <div class="mi-se-dialog">
        <div class="mi-se-dialog-header">
          <span class="mi-se-dialog-winner">${winnerName}</span>
          <span class="mi-se-dialog-vs">${isAttackerWinner ? 'Attacker' : 'Defender'} wins ${seCount} SE${seCount > 1 ? 's' : ''}</span>
        </div>
        <div class="mi-se-hint">${remainingHint}</div>
        <div class="mi-se-options" id="mi-se-options">
          ${seRows}
        </div>
        <div class="mi-se-selected-count">
          Selected: <span id="mi-se-selected-num">0</span> / ${seCount}
        </div>
      </div>`;

    return new Promise(resolve => {
      const dialog = new Dialog({
        title: `Special Effects — ${winnerName}`,
        content,
        buttons: {
          confirm: {
            icon:  '<i class="fas fa-check"></i>',
            label: 'Confirm',
            callback: html => {
              const chosen = _readSelection(html, seCount);
              resolve(chosen);
            }
          },
          skip: {
            icon:  '<i class="fas fa-forward"></i>',
            label: 'Skip',
            callback: () => resolve([])
          }
        },
        default: 'confirm',
        classes: ['dialog', 'mi-dialog', 'mi-se-dialog-window'],
        render: html => {
          const checkboxes    = html.find('input[name="mi-se-choice"]');
          const countDisplay  = html.find('#mi-se-selected-num')[0];
          const confirmBtn    = html.closest('.dialog').find('.dialog-button.confirm button')[0]
                              ?? html.find('button[data-button="confirm"]')[0];

          const _updateCount = () => {
            const selected = _readSelection(html, seCount);
            if (countDisplay) countDisplay.textContent = selected.length;

            // Disable non-stackable unchecked boxes once limit reached
            const total = _countWithStacking(html);
            checkboxes.each(function() {
              const label      = this.closest('.mi-se-option');
              const isStackable = label?.dataset.stackable === 'true';
              const isChecked  = this.checked;
              if (total >= seCount && !isChecked && !isStackable) {
                this.disabled = true;
                label?.classList.add('mi-se-disabled');
              } else if (!isStackable) {
                this.disabled = false;
                label?.classList.remove('mi-se-disabled');
              }
            });
          };

          // Non-stackable: normal checkbox change
          checkboxes.each(function() {
            const label = this.closest('.mi-se-option');
            if (label?.dataset.stackable === 'true') {
              // Prevent direct checkbox interaction on stackable items —
              // stacking is driven by label clicks only, so the checkbox
              // is purely a visual indicator (checked = count > 0).
              $(this).on('click', e => e.preventDefault());
            } else {
              $(this).on('change', _updateCount);
            }
          });

          // Stackable: each label click increments count by 1 up to seCount,
          // then resets on the next click.
          html.find('.mi-se-option[data-stackable="true"]').on('click', function(e) {
            e.preventDefault();
            const cb      = this.querySelector('input[type="checkbox"]');
            const countEl = this.querySelector('.mi-se-stack-num');
            const display = this.querySelector('.mi-se-stack-count');
            const current = parseInt(this.dataset.count ?? '0', 10);
            const total   = _countWithStacking(html);

            if (total < seCount) {
              // Room to add another stack — increment
              const newVal = current + 1;
              this.dataset.count = newVal;
              if (cb) cb.checked = true;
              if (countEl) countEl.textContent = newVal;
              if (display) display.style.display = '';
            } else if (current > 0) {
              // At limit — reset this item entirely
              this.dataset.count = 0;
              if (cb) cb.checked = false;
              if (display) display.style.display = 'none';
            }
            _updateCount();
          });

          _updateCount();
        }
      });

      dialog.render(true);
    });
  }
}

// =============================================================================
// Private helpers
// =============================================================================

/**
 * Filter the full SE list down to what's eligible for the winner in this ctx.
 */
function _filterSEs(ctx, isAttackerWinner) {
  const allSEs = CONFIG.MYTHRAS?.specialEffects ?? [];
  const weapon = isAttackerWinner ? ctx.weapon : ctx.defenceWeapon;
  const traits = weapon?.system.traits ?? [];

  const attackOutcome  = ctx.attackOutcome;
  const defenceOutcome = ctx.defenceOutcome ?? 'none';
  const loserOutcome   = isAttackerWinner ? defenceOutcome : attackOutcome;

  return allSEs.filter(se => {
    // Role filter — must be eligible for this winner
    if (se.who === 'attacker' && !isAttackerWinner) return false;
    if (se.who === 'defender' &&  isAttackerWinner) return false;

    // Restriction filters
    switch (se.restriction) {
      case null:
      case undefined:
        return true;

      case 'attackerCritical':
        return attackOutcome === 'critical';

      case 'rangedNotClose':
        // Choose Location: free for melee; free at Close range for ranged;
        // Critical only at Effective or Long range (rules p.42).
        if (!ctx.isRanged) return true;
        if (ctx.rangeBand === 'close') return true;
        return attackOutcome === 'critical';

      case 'defenderCritical':
        return defenceOutcome === 'critical';

      case 'attackerFumbles':
        // Defender wins this when attacker fumbles — only available to defender
        return !isAttackerWinner && attackOutcome === 'fumble';

      case 'attackerFumblesFirearm':
        // Weapon Malfunction: attacker fumbles with a firearm specifically.
        // Defender wins this; attacker's weapon must have the 'firearm' trait.
        return !isAttackerWinner && attackOutcome === 'fumble' && traits.includes('firearm');

      case 'opponentFumbles':
        // Winner uses this when their opponent fumbled
        return loserOutcome === 'fumble';

      case 'bludgeoning':
        return traits.includes('bludgeoning');

      case 'shieldOrBludgeon': {
        const isShield     = traits.includes('shield');
        const isBludgeon   = traits.includes('bludgeoning');
        return isShield || isBludgeon;
      }

      case 'cuttingWeapon':
        return traits.includes('bleeding');

      case 'cuttingOrFirearmCritical':
        // Bleed: available to cutting weapons normally; for firearms it requires
        // an Attacker Critical (rules p.42 — most firearms produce narrow wound
        // channels, not the slashing cuts that cause major blood-loss).
        if (traits.includes('firearm')) return attackOutcome === 'critical';
        return traits.includes('bleeding');

      case 'entanglingWeapon':
        return traits.includes('entangling');

      case 'impalingWeapon':
        return traits.includes('impaling');

      case 'unarmed':
        return traits.includes('unarmed');

      case 'sunderWeapon':
        return traits.includes('sundering') || traits.includes('two-handed');

      case 'rangedWeapon':
        return weapon?.system.category === 'ranged';

      case 'firearmsOnly':
        return traits.includes('firearm');

      case 'firearmsOnlyCritical':
        // Over-penetration: firearms only AND attacker must have rolled a Critical.
        return traits.includes('firearm') && attackOutcome === 'critical';

      case 'highTechFirearm':
        // Circumvent Cover: high-tech firearms only — weapon must have 'hightech' trait.
        // Falls back gracefully: any firearm is eligible so the SE at least appears;
        // the GM decides at the table whether the weapon qualifies.
        return traits.includes('firearm') && (traits.includes('hightech') || traits.includes('highTech'));

      default:
        return true;
    }
  }).map(se => ({
    ...se,
    stackable: se.id === 'maximiseDamage'
            || se.id === 'bypassArmour'
            || se.id === 'rapidReload'
            || se.id === 'scarFoe'
            || se.id === 'pinDown'
  }));
}

/**
 * Count total selections including stackable multiples.
 * Stackable items store their count in data-count on the label.
 */
function _countWithStacking(html) {
  let total = 0;
  html.find('.mi-se-option').each(function() {
    const cb          = this.querySelector('input[type="checkbox"]');
    const isStackable = this.dataset.stackable === 'true';
    if (!cb?.checked) return;
    if (isStackable) {
      total += parseInt(this.dataset.count ?? '1', 10);
    } else {
      total += 1;
    }
  });
  return total;
}

/**
 * Read the current selection as an array of SE ids (with repeats for stacked).
 */
function _readSelection(html, seCount) {
  const chosen = [];
  html.find('.mi-se-option').each(function() {
    const cb          = this.querySelector('input[type="checkbox"]');
    const id          = this.dataset.id;
    const isStackable = this.dataset.stackable === 'true';
    if (!cb?.checked) return;
    if (isStackable) {
      const count = parseInt(this.dataset.count ?? '1', 10);
      for (let i = 0; i < count; i++) chosen.push(id);
    } else {
      chosen.push(id);
    }
  });
  // Trim to seCount in case somehow over-selected
  return chosen.slice(0, seCount);
}
