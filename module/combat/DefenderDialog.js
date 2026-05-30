/**
 * mythras-imperative/module/combat/DefenderDialog.js
 *
 * Defender Dialog — step 7 of the combat flow.
 *
 * Opened on the defender's client after a combatChallenge socket message
 * arrives. Presents the defender with their reactive options:
 *
 *   Parry   — choose weapon and style; live skill total shown
 *   Evade   — uses the Evade standard skill; defender will be prone
 *   Acrobatics — available if the defender has the Acrobatics professional
 *                skill; defender does NOT end up prone (Daredevil trait also
 *                prevents prone — handled here too)
 *   Don't Defend — automatic Failure; attacker gets SEs from Failure column
 *
 * Returns defenceData: { defenceType, weaponId, styleId, skillTotal, actorId, willBeProne }
 * or null if the dialog is dismissed without a choice (treated as Don't Defend
 * by the engine, so the result is the same either way).
 *
 * Prone logic:
 *   - Evade selected                    → willBeProne = true
 *   - Acrobatics selected               → willBeProne = false
 *   - Daredevil trait on active style   → willBeProne = false (overrides Evade)
 *   - All other choices                 → willBeProne = false
 *
 * The prone status effect is applied to the defender's token by CombatEngine
 * after defenceData is received — not here, to keep the dialog stateless.
 */

export class DefenderDialog {

  /**
   * Open the defender dialog on this client and wait for the player's choice.
   *
   * @param {object} ctx          The deserialised combatContext
   * @param {string} exchangeId   The exchange id (for logging only)
   * @returns {Promise<object|null>}
   */
  static async show(ctx, exchangeId) {
    const { attacker, defender, weapon, attackerStyle } = ctx;

    // ── 0 AP guard — defender cannot react at all ─────────────────────────────
    // This should normally be caught in CombatEngine._runDialog before the dialog
    // opens. This guard is a safety net for the socket path where the defender's
    // client receives the challenge after AP have been spent locally.
    {
      const defAP = defender.system.attributes?.actionPoints;
      if (defAP && typeof defAP.value === 'number' && defAP.value <= 0) {
        ui.notifications.warn(
          `${defender.name} has 0 Action Points and cannot defend — automatic Failure.`
        );
        return { defenceType: 'none', weaponId: null, styleId: null,
                 skillTotal: 0, actorId: defender.id, willBeProne: false };
      }
    }

    // ── Collect defender's weapons and styles for the Parry option ────────────
    // For ranged attacks only shields may be used to parry (rules p.49).
    const isRangedAttack   = ctx.isRanged ?? false;
    const stylesByWeaponId = _buildStylesByWeaponMap(defender);
    const parryWeapons     = _buildParryWeaponList(defender, stylesByWeaponId, isRangedAttack);

    // ── Look up evade and acrobatics skill totals ────────────────────────────
    const evadeSkill       = _findSkill(defender, 'Evade');
    const acrobaticsSkill  = _findSkill(defender, 'Acrobatics');

    // ── Check Daredevil trait on any active style — prevents prone on Evade ──
    const hasDaredevil = Array.from(defender.items).some(
      i => i.type === 'combat-style' && (i.system.traits ?? []).includes('daredevil')
    );

    // ── Build the parry weapon options for the initial weapon ────────────────
    const defaultWeaponId    = parryWeapons[0]?.id ?? null;
    const initStyles         = defaultWeaponId ? (stylesByWeaponId[defaultWeaponId] ?? []) : [];
    const parryWeaponOptions = parryWeapons
      .map(w => `<option value="${w.id}">${w.name}</option>`)
      .join('') || '<option value="">— No weapons —</option>';
    const initStyleOptions   = _buildStyleOptions(initStyles);
    const initParrySkill     = initStyles[0]?.system.total ?? 0;

    // ── Defence type radio options ────────────────────────────────────────────
    // Parry is always available (even with no weapons — defender may have none).
    // Evade is always available (standard skill).
    // Acrobatics only shown if the defender has the skill.
    // Don't Defend is always available.

    const evadeTotal       = evadeSkill?.system.total ?? 0;
    const acrobaticsTotal  = acrobaticsSkill?.system.total ?? 0;
    const hasAcrobatics    = !!acrobaticsSkill;

    const proneWarning = hasDaredevil
      ? '(Daredevil — no prone)'
      : '(will be prone)';

    const acrobaticsRow = hasAcrobatics ? `
      <label class="mi-defence-option">
        <input type="radio" name="mi-def-type" value="acrobatics">
        <span class="mi-defence-label">
          <span class="mi-defence-name">Acrobatics</span>
          <span class="mi-defence-skill">${acrobaticsTotal}%</span>
          <span class="mi-defence-note">(no prone)</span>
        </span>
      </label>` : '';

    const content = `
      <div class="mi-defender-dialog">

        <div class="mi-dialog-skill-header">
          <span class="mi-dialog-skill-name">${attacker.name} attacks with ${weapon?.name ?? 'weapon'}</span>
          <span class="mi-dialog-skill-base" id="mi-def-skill-display">—</span>
        </div>

        ${isRangedAttack ? `
        <div class="mi-attacker-condition-banner">
          <i class="fas fa-bullseye"></i>
          Ranged attack — only shields may parry
          ${ctx.rangeBand === 'long' ? '· Long range: attacker Force reduced one step' : ''}
        </div>` : ''}

        <div class="mi-dialog-fields">

          <div class="mi-defence-options">

            <label class="mi-defence-option">
              <input type="radio" name="mi-def-type" value="parry" ${parryWeapons.length ? 'checked' : 'disabled'}>
              <span class="mi-defence-label">
                <span class="mi-defence-name">Parry</span>
                <span class="mi-defence-skill" id="mi-def-parry-skill">${initParrySkill}%</span>
              </span>
            </label>

            <div class="mi-parry-selectors" id="mi-parry-selectors">
              <div class="mi-form-row">
                <label>Weapon</label>
                <select id="mi-def-weapon">${parryWeaponOptions}</select>
              </div>
              <div class="mi-form-row">
                <label>Style</label>
                <select id="mi-def-style">${initStyleOptions}</select>
              </div>
            </div>

            <label class="mi-defence-option">
              <input type="radio" name="mi-def-type" value="evade">
              <span class="mi-defence-label">
                <span class="mi-defence-name">Evade</span>
                <span class="mi-defence-skill">${evadeTotal}%</span>
                <span class="mi-defence-note">${proneWarning}</span>
              </span>
            </label>

            ${acrobaticsRow}

            <label class="mi-defence-option">
              <input type="radio" name="mi-def-type" value="none" ${parryWeapons.length ? '' : 'checked'}>
              <span class="mi-defence-label">
                <span class="mi-defence-name">Don't Defend</span>
                <span class="mi-defence-skill">—</span>
                <span class="mi-defence-note">(automatic Failure)</span>
              </span>
            </label>

          </div>
        </div>

        <div class="mi-dialog-target-row">
          <span class="mi-dialog-target-label">Defence Skill</span>
          <span class="mi-dialog-target-val" id="mi-def-target-val">
            ${parryWeapons.length ? `${initParrySkill}%` : '—'}
          </span>
        </div>

      </div>
    `;

    return new Promise(resolve => {
      const dialog = new Dialog({
        title: `Defend — ${defender.name}`,
        content,
        buttons: {
          defend: {
            icon:  '<i class="fas fa-shield-alt"></i>',
            label: 'Confirm',
            callback: html => {
              const result = _readDialog(
                html, defender, ctx,
                stylesByWeaponId, parryWeapons,
                evadeSkill, acrobaticsSkill, hasDaredevil
              );
              resolve(result);
            }
          },
          cancel: {
            icon:  '<i class="fas fa-times"></i>',
            label: 'Cancel',
            callback: () => resolve(null)
          }
        },
        default: 'defend',
        classes: ['dialog', 'mi-dialog'],
        render: html => {
          const typeRadios    = html.find('input[name="mi-def-type"]');
          const weaponSel     = html.find('#mi-def-weapon')[0];
          const styleSel      = html.find('#mi-def-style')[0];
          const parryBlock    = html.find('#mi-parry-selectors')[0];
          const parrySkillEl  = html.find('#mi-def-parry-skill')[0];
          const displayEl     = html.find('#mi-def-skill-display')[0];
          const targetValEl   = html.find('#mi-def-target-val')[0];

          const _updateDisplay = () => {
            const type = html.find('input[name="mi-def-type"]:checked').val();

            // Show/hide parry weapon selectors
            if (parryBlock) {
              parryBlock.style.display = type === 'parry' ? '' : 'none';
            }

            let skill = '—';
            if (type === 'parry') {
              const styleId  = styleSel?.value;
              const styles   = stylesByWeaponId[weaponSel?.value] ?? [];
              const style    = styles.find(s => s.id === styleId) ?? styles[0] ?? null;
              const total    = style?.system.total ?? 0;
              skill = `${total}%`;
              if (parrySkillEl) parrySkillEl.textContent = skill;
            } else if (type === 'evade') {
              skill = `${evadeTotal}%`;
            } else if (type === 'acrobatics') {
              skill = `${acrobaticsTotal}%`;
            }

            if (displayEl)  displayEl.textContent  = skill;
            if (targetValEl) targetValEl.textContent = skill;
          };

          // When weapon changes, rebuild style list
          if (weaponSel) {
            weaponSel.addEventListener('change', () => {
              const wId    = weaponSel.value;
              const styles = stylesByWeaponId[wId] ?? [];
              if (styleSel) styleSel.innerHTML = _buildStyleOptions(styles);
              _updateDisplay();
            });
          }

          typeRadios.on('change', _updateDisplay);
          if (styleSel) styleSel.addEventListener('change', _updateDisplay);

          _updateDisplay();
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
 * Find a skill item by exact name on the given actor.
 * Checks both standard and professional categories.
 */
function _findSkill(actor, name) {
  return Array.from(actor.items).find(
    i => i.type === 'skill' && i.name === name
  ) ?? null;
}

/**
 * Build a map: weaponId → combat-style[] for the defender's weapons.
 * Mirrors the attacker-side helper in AttackerDialog.
 */
function _buildStylesByWeaponMap(actor) {
  const map = {};
  for (const style of actor.items) {
    if (style.type !== 'combat-style') continue;
    for (const w of (style.system.weapons ?? [])) {
      if (!map[w.id]) map[w.id] = [];
      map[w.id].push(style);
    }
  }
  for (const id of Object.keys(map)) {
    map[id].sort((a, b) => (b.system.total ?? 0) - (a.system.total ?? 0));
  }
  return map;
}

/**
 * Collect weapon Items on the defender that appear in at least one combat style.
 * These are the weapons eligible for parrying.
 * For ranged attacks, only shields may parry (rules p.49); other weapons are excluded.
 */
function _buildParryWeaponList(actor, stylesByWeaponId, isRangedAttack = false) {
  const seen    = new Set();
  const weapons = [];

  for (const weaponId of Object.keys(stylesByWeaponId)) {
    if (seen.has(weaponId)) continue;
    seen.add(weaponId);

    let item = actor.items.get(weaponId);
    if (!item) {
      for (const style of stylesByWeaponId[weaponId]) {
        const ref = (style.system.weapons ?? []).find(w => w.id === weaponId);
        if (ref?.name) {
          item = Array.from(actor.items).find(
            i => i.type === 'weapon' && i.name === ref.name
          ) ?? null;
          if (item) break;
        }
      }
    }
    if (item) weapons.push(item);
  }

  // Impale restriction: while a weapon is lodged in a wound, the attacker
  // cannot use it for parrying (rules p.44). Check impaledBy flags on the actor
  // (attacker here is the defender in combat terms — they are parrying).
  // We filter out any weapon that is currently lodged in another actor.
  // Note: impaledBy is on the *victim*, not the wielder. We check from the
  // wielder's side by scanning the flag on all other scene actors.
  const impaledWeaponIds = new Set();
  for (const sceneActor of (game.actors?.contents ?? [])) {
    const impaledBy = sceneActor.getFlag?.('mythras-imperative', 'impaledBy') ?? {};
    for (const entry of Object.values(impaledBy)) {
      if (entry.attackerId === actor.id) impaledWeaponIds.add(entry.weaponId);
    }
  }

  // Pin Weapon restriction: a pinned weapon cannot be used to parry until the
  // end of the current Mythras round (rules p.45).
  const pinnedWeapons = actor.getFlag?.('mythras-imperative', 'pinnedWeapons') ?? {};
  const pinnedWeaponIds = new Set(
    Object.values(pinnedWeapons).map(entry => entry.weaponId)
  );

  const restrictedIds = new Set([...impaledWeaponIds, ...pinnedWeaponIds]);
  let eligible = restrictedIds.size > 0
    ? weapons.filter(w => !restrictedIds.has(w.id))
    : weapons;

  // Ranged attacks: only shields may parry (rules p.49).
  // Shields are identified by the 'shield' trait on the weapon item.
  if (isRangedAttack) {
    const shieldOnly = eligible.filter(w => (w.system.traits ?? []).includes('shield'));
    // If no shields available fall back to all weapons so defender isn't locked out
    eligible = shieldOnly.length > 0 ? shieldOnly : eligible;
  }

  // Sort shields to the top for both melee and ranged — they are the natural
  // parrying tool and should be the default selection.
  return eligible.sort((a, b) => {
    const aShield = (a.system.traits ?? []).includes('shield') ? 0 : 1;
    const bShield = (b.system.traits ?? []).includes('shield') ? 0 : 1;
    if (aShield !== bShield) return aShield - bShield;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Build <option> elements for a style list.
 */
function _buildStyleOptions(styles) {
  if (styles.length === 0) return '<option value="">— No style —</option>';
  return styles
    .map(s => `<option value="${s.id}">${s.name} (${s.system.total ?? 0}%)</option>`)
    .join('');
}

/**
 * Read the confirmed dialog state and return defenceData.
 */
function _readDialog(
  html, defender, ctx,
  stylesByWeaponId, parryWeapons,
  evadeSkill, acrobaticsSkill, hasDaredevil
) {
  const type = html.find('input[name="mi-def-type"]:checked').val() ?? 'none';

  // Resolve weapon and style for parry
  let weaponId  = null;
  let styleId   = null;
  let skillTotal = 0;

  if (type === 'parry') {
    weaponId            = html.find('#mi-def-weapon').val() ?? null;
    styleId             = html.find('#mi-def-style').val() ?? null;
    const styles        = stylesByWeaponId[weaponId] ?? [];
    const chosenStyle   = styles.find(s => s.id === styleId) ?? styles[0] ?? null;
    skillTotal          = chosenStyle?.system.total ?? 0;
    styleId             = chosenStyle?.id ?? null;
  } else if (type === 'evade') {
    skillTotal = evadeSkill?.system.total ?? 0;
  } else if (type === 'acrobatics') {
    skillTotal = acrobaticsSkill?.system.total ?? 0;
  }

  // Prone determination:
  //   - Evade → prone, UNLESS Daredevil trait is present on any style
  //   - Acrobatics → never prone
  //   - Everything else → not prone
  let willBeProne = false;
  if (type === 'evade' && !hasDaredevil) {
    willBeProne = true;
  }

  return {
    defenceType: type,
    weaponId,
    styleId,
    skillTotal,
    actorId:     defender.id,
    willBeProne
  };
}
