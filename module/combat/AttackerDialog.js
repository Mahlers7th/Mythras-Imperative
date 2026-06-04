/**
 * mythras-imperative/module/combat/AttackerDialog.js
 *
 * Attacker Dialog — step 5 of the combat flow.
 *
 * Presents the attacker with:
 *   • Weapon selector    — which weapon from this style to use
 *   • Style selector     — which combat style (if weapon covered by more than one)
 *   • Charge toggle      — declares the Charge combat action
 *   • Difficulty grade   — set by the GM, communicated verbally to the player
 *   • Surprised banner   — read from the defender's token status; not editable
 *                          by the player (GM toggles it on the token beforehand)
 *   • Live target display — updates as weapon / difficulty changes
 *
 * Resolves with a mutated combatContext or null on cancel.
 *
 * Uses the legacy Dialog API (same pattern as MythrasRoll) for consistency
 * with the rest of the codebase. ApplicationV2 migration can happen globally
 * when the rest of the sheets move across.
 */

export class AttackerDialog {

  /**
   * Open the attacker dialog and wait for the player to confirm or cancel.
   *
   * @param {object} ctx  The combatContext built by CombatEngine._buildContext
   * @returns {Promise<object|null>}  Mutated ctx, or null if cancelled
   */
  static async show(ctx) {
    const { attacker, defender, weapon } = ctx;

    // ── Resolve surprised state from defender token ──────────────────────────
    // The GM has already toggled the condition on the token before the attack.
    // We read it here; it is displayed as a read-only banner, not a player toggle.
    const defenderToken = _findTokenForActor(defender);
    const isSurprised   = defenderToken
      ? defenderToken.actor?.statuses?.has('surprised') ?? false
      : defender.statuses?.has('surprised') ?? false;

    // Reflect in context immediately — downstream stages read ctx.defenderSurprised
    ctx.defenderSurprised = isSurprised;

    // ── Collect all weapons available through any style on this attacker ─────
    // We present every weapon that appears in at least one combat style.
    // When the player changes weapon, we also update the style list.
    const stylesByWeaponId = _buildStylesByWeaponMap(attacker);
    const allStyleWeapons  = _buildWeaponList(attacker, stylesByWeaponId);

    // ── Vehicle weapon override ───────────────────────────────────────────────
    // When firing a vehicle weapon the weapon item lives on the vehicle, not on
    // the crew member. Inject it as the sole entry so the dropdown shows it and
    // ctx.weapon is not overwritten with a character weapon at confirm time.
    if (ctx.vehicleWeaponAttack && weapon) {
      // Ensure vehicle weapon is first (and only required) option
      if (!allStyleWeapons.find(w => w.id === weapon.id)) {
        allStyleWeapons.unshift(weapon);
      }
      // Map the vehicle weapon id → the pre-chosen style so the style dropdown
      // stays consistent and chosenStyle resolves correctly at confirm time.
      if (!stylesByWeaponId[weapon.id]) {
        stylesByWeaponId[weapon.id] = ctx.attackerStyle ? [ctx.attackerStyle] : [];
      }
    }

    if (allStyleWeapons.length === 0) {
      ui.notifications.warn(`${attacker.name} has no weapons assigned to any combat style.`);
      return null;
    }

    // Default selection — prefer the weapon that was passed in
    const defaultWeaponId = weapon?.id ?? allStyleWeapons[0].id;

    // ── Difficulty options ───────────────────────────────────────────────────
    // The difficulty floor is the worst of: fatigue grade and prone
    // penalties (Serious → Hard, Major → Formidable). Delegated to the
    // shared CombatEngine helper so all paths stay consistent.
    const { CombatEngine } = await import('./CombatEngine.js');
    const floorGrade        = CombatEngine._getConditionFloorGrade(attacker);
    const defaultDifficulty = floorGrade;
    const conditionNotesStr = CombatEngine._buildConditionNotes(attacker);
    const gradeOrder = ['veryEasy','easy','standard','hard','formidable','herculean','hopeless'];
    const floorIdx   = gradeOrder.indexOf(floorGrade);

    const difficultyOptions = Object.entries(CONFIG.MYTHRAS.difficultyGrades)
      .map(([key, grade]) => {
        const selected  = key === defaultDifficulty ? ' selected' : '';
        const thisIdx   = gradeOrder.indexOf(key);
        const disabled  = thisIdx < floorIdx ? ' disabled' : '';
        return `<option value="${key}"${selected}${disabled}>${game.i18n.localize(grade.label)}</option>`;
      }).join('');

    // ── Build initial weapon options ─────────────────────────────────────────
    const weaponOptions = allStyleWeapons
      .map(w => {
        const selected = w.id === defaultWeaponId ? ' selected' : '';
        return `<option value="${w.id}"${selected}>${w.name}</option>`;
      }).join('');

    // ── Build initial style options for the default weapon ───────────────────
    const initStyles = stylesByWeaponId[defaultWeaponId] ?? [];
    const styleOptionsHtml = _buildStyleOptions(initStyles, ctx.attackerStyle?.id ?? null);

    // ── Compute initial skill total ───────────────────────────────────────────
    const initStyle      = initStyles[0] ?? null;
    const initSkillTotal = initStyle ? (initStyle.system.total ?? 0) : 0;
    const initTarget     = _applyDifficulty(initSkillTotal, 'standard');

    // ── Surprised banner ─────────────────────────────────────────────────────
    const surprisedBanner = isSurprised ? `
      <div class="mi-attacker-surprised-banner">
        <i class="fas fa-eye-slash"></i>
        ${defender.name} is Surprised — defender cannot react; bonus Special Effect granted
      </div>` : '';

    // ── Weapon category ──────────────────────────────────────────────────────
    const isRangedWeapon = (weapon?.system?.category ?? 'melee') === 'ranged';

    // ── Ammo display (ranged weapons only) ───────────────────────────────────
    // system.ammo is the source of truth for both models:
    //   Firearms  — rounds loaded in magazine (0..ammoMax)
    //   Bow/Sling — nocked state: 0 = not nocked (must Reload first), 1 = ready to fire
    const initAmmo      = isRangedWeapon ? (weapon?.system?.ammo    ?? null) : null;
    const initAmmoMax   = isRangedWeapon ? (weapon?.system?.ammoMax ?? null) : null;
    const initOutOfAmmo = isRangedWeapon && initAmmo !== null && initAmmo <= 0;

    // ── Burst fire (firearm only) ─────────────────────────────────────────────
    // Burst fire is only available when the weapon has the 'burst-fire' trait.
    // The weapon's firingMode field defaults to 'single'; the attacker can
    // switch to 'burst' if the weapon supports it.
    const initIsBurstCapable   = isRangedWeapon && (weapon?.system?.traits ?? []).includes('burst-fire');
    const initFiringMode       = initIsBurstCapable ? (weapon?.system?.firingMode ?? 'single') : 'single';
    const initIsFullAutoCapable = isRangedWeapon && (weapon?.system?.traits ?? []).includes('full-auto');

    // ── Full Auto target list and rounds slider ───────────────────────────────
    // Collect the current target actors from the context (set in initiateAttack).
    // The slider max is min(cyclicRate, currentAmmo); default is max.
    const initTargetActors    = ctx._targetActors ?? [defender];
    const initTargetCount     = initTargetActors.length;
    const initCyclicRate      = initIsFullAutoCapable ? (weapon?.system?.cyclicRate ?? 0) : 0;
    const initAmmoForSlider   = initAmmo ?? 0;
    const initSliderMax       = initIsFullAutoCapable
      ? Math.min(initCyclicRate > 0 ? initCyclicRate : 999, initAmmoForSlider)
      : 0;
    const initSliderMin       = initTargetCount; // at least 1 round per target
    const initDeclaredRounds  = initSliderMax >= initSliderMin ? initSliderMax : initSliderMin;
    const initRoundsPerTarget = initTargetCount > 0 ? Math.floor(initDeclaredRounds / initTargetCount) : 0;
    const initSpareRounds     = initTargetCount > 0 ? (initDeclaredRounds % initTargetCount) : 0;
    // Build target name list for display
    const initTargetNameList  = initTargetActors.map(a => a.name).join(', ');

    // ── Charge note ──────────────────────────────────────────────────────────
    // Charge is a declared combat action — if this attack is a charge the player
    // should toggle this. It applies Hard difficulty and steps up weapon size.
    // Charge is only available for melee weapons.
    const chargeChecked = ctx.isCharge ? ' checked' : '';

    // ── Range band (ranged weapons only) ─────────────────────────────────────
    // The attacker selects which range band the target is at. This drives the
    // difficulty modifier applied to the attack roll:
    //   Close     — no modifier (Choose Location available if target stationary/unaware)
    //   Effective — no modifier
    //   Long      — Hard difficulty; damage halved; Force reduced one step (engine handles damage/force)
    //
    // Aiming (spend a full round) reduces one difficulty grade from range or
    // situational modifiers — represented as a checkbox here.
    const rangeBandOptions = [
      { value: 'close',     label: 'Close',     note: 'Choose Location available' },
      { value: 'effective', label: 'Effective', note: 'No modifier' },
      { value: 'long',      label: 'Long',      note: 'Hard — damage halved, Force –1 step' },
    ].map(({ value, label, note }) => {
      const sel = value === 'effective' ? ' selected' : '';
      return `<option value="${value}"${sel}>${label} — ${note}</option>`;
    }).join('');

    // ── GM Mode — build inline defender panel ────────────────────────────────
    // Suppressed for vehicle defenders — vehicles cannot parry or evade.
    const gmMode = (game.settings.get('mythras-imperative', 'gmMode') ?? false)
                   && defender.type !== 'vehicle';
    const defStylesByWeaponId = gmMode ? _buildStylesByWeaponMap(defender) : {};
    // Build the full weapon list here — filtering for shields (ranged) and
    // shield-first sorting are applied reactively in the render callback when
    // the attacker changes their weapon selection.
    const defParryWeaponsAll  = gmMode ? _buildWeaponList(defender, defStylesByWeaponId) : [];
    // Initial sort: shields first. Reactive filtering happens in _updateRangedMode.
    const defParryWeapons     = defParryWeaponsAll.slice().sort((a, b) => {
      const aS = (a.system.traits ?? []).includes('shield') ? 0 : 1;
      const bS = (b.system.traits ?? []).includes('shield') ? 0 : 1;
      if (aS !== bS) return aS - bS;
      return a.name.localeCompare(b.name);
    });
    const evadeSkill          = gmMode ? _findDefenderSkill(defender, 'Evade') : null;
    const acrobaticsSkill     = gmMode ? _findDefenderSkill(defender, 'Acrobatics') : null;
    const hasDaredevil        = gmMode && Array.from(defender.items).some(
      i => i.type === 'combat-style' && (i.system.traits ?? []).includes('daredevil')
    );

    const defWeaponOptions = defParryWeapons
      .map(w => `<option value="${w.id}">${w.name}</option>`).join('')
      || '<option value="">— No weapons —</option>';
    const initDefStyles    = defParryWeapons[0]
      ? (defStylesByWeaponId[defParryWeapons[0].id] ?? []) : [];
    const defStyleOptions  = _buildStyleOptions(initDefStyles, null);

    const evadeTotal       = evadeSkill?.system.total ?? 0;
    const acrobaticsTotal  = acrobaticsSkill?.system.total ?? 0;
    const proneWarning     = hasDaredevil ? '(Daredevil — no prone)' : '(will be prone)';

    const gmDefenderPanel = gmMode ? `
      <hr class="mi-dialog-divider">
      <div class="mi-dialog-section-title">
        <i class="fas fa-shield-alt"></i> ${defender.name} — Defence (GM Mode)
      </div>
      <div class="mi-defence-options mi-defence-options--inline">

        <label class="mi-defence-option">
          <input type="radio" name="mi-gm-def-type" value="parry" ${defParryWeapons.length ? 'checked' : 'disabled'}>
          <span class="mi-defence-label">
            <span class="mi-defence-name">Parry</span>
            <span class="mi-defence-skill" id="mi-gm-parry-skill">${initDefStyles[0]?.system.total ?? 0}%</span>
          </span>
        </label>

        <div class="mi-parry-selectors" id="mi-gm-parry-selectors">
          <div class="mi-form-row">
            <label>Weapon</label>
            <select id="mi-gm-def-weapon">${defWeaponOptions}</select>
          </div>
          <div class="mi-form-row">
            <label>Style</label>
            <select id="mi-gm-def-style">${defStyleOptions}</select>
          </div>
        </div>

        <label class="mi-defence-option">
          <input type="radio" name="mi-gm-def-type" value="evade">
          <span class="mi-defence-label">
            <span class="mi-defence-name">Evade</span>
            <span class="mi-defence-skill">${evadeTotal}%</span>
            <span class="mi-defence-note">${proneWarning}</span>
          </span>
        </label>

        ${acrobaticsSkill ? `
        <label class="mi-defence-option">
          <input type="radio" name="mi-gm-def-type" value="acrobatics">
          <span class="mi-defence-label">
            <span class="mi-defence-name">Acrobatics</span>
            <span class="mi-defence-skill">${acrobaticsTotal}%</span>
            <span class="mi-defence-note">(no prone)</span>
          </span>
        </label>` : ''}

        <label class="mi-defence-option">
          <input type="radio" name="mi-gm-def-type" value="none" ${defParryWeapons.length ? '' : 'checked'}>
          <span class="mi-defence-label">
            <span class="mi-defence-name">Don't Defend</span>
            <span class="mi-defence-skill">—</span>
            <span class="mi-defence-note">(automatic Failure)</span>
          </span>
        </label>

      </div>` : '';

    const content = `
      <div class="mi-attacker-dialog">
        ${surprisedBanner}

        <div class="mi-dialog-skill-header">
          <span class="mi-dialog-skill-name" id="mi-atk-header-name">${attacker.name} attacks ${initTargetCount > 1 ? `${initTargetCount} targets` : defender.name}</span>
          <span class="mi-dialog-skill-base" id="mi-atk-target-display">${initTarget}%</span>
        </div>
        ${initTargetCount > 1 ? `
        <div class="mi-full-auto-target-list">
          <i class="fas fa-crosshairs"></i> ${initTargetNameList}
        </div>` : ''}

        ${conditionNotesStr ? `
        <div class="mi-attacker-condition-banner">
          <i class="fas fa-exclamation-triangle"></i> ${conditionNotesStr}
        </div>` : ''}

        <div class="mi-dialog-fields">

          <div class="mi-form-row">
            <label>Weapon</label>
            <select id="mi-atk-weapon">${weaponOptions}</select>
          </div>

          <div class="mi-form-row">
            <label>Style</label>
            <select id="mi-atk-style">${styleOptionsHtml}</select>
          </div>

          <div class="mi-form-row">
            <label>Difficulty</label>
            <select id="mi-atk-difficulty">${difficultyOptions}</select>
          </div>

          <div class="mi-form-row" id="mi-atk-range-band-row">
            <label>Range Band</label>
            <select id="mi-atk-range-band">${rangeBandOptions}</select>
          </div>

          <div class="mi-form-row mi-form-row--toggle" id="mi-atk-aiming-row">
            <label>Aiming</label>
            <label class="mi-toggle">
              <input type="checkbox" id="mi-atk-aiming">
              <span class="mi-toggle-track"></span>
              <span class="mi-toggle-hint">Spend full round aiming — reduces one difficulty grade</span>
            </label>
          </div>

          <div class="mi-form-row" id="mi-atk-ammo-row" style="${isRangedWeapon ? '' : 'display:none'}">
            <label>Ammo</label>
            <span id="mi-atk-ammo-display" class="${initOutOfAmmo ? 'mi-ammo-empty' : ''}">${initAmmo !== null ? `${initAmmo} / ${initAmmoMax}` : '—'}</span>
          </div>

          <div class="mi-form-row mi-form-row--toggle" id="mi-atk-burst-row" style="${initIsBurstCapable ? '' : 'display:none'}">
            <label>Burst Fire</label>
            <label class="mi-toggle">
              <input type="checkbox" id="mi-atk-burst"${initFiringMode === 'burst' ? ' checked' : ''}>
              <span class="mi-toggle-track"></span>
              <span class="mi-toggle-hint">Hard difficulty — on hit, rolls 1d3 rounds struck</span>
            </label>
          </div>

          <div class="mi-form-row mi-form-row--toggle" id="mi-atk-full-auto-row" style="${initIsFullAutoCapable ? '' : 'display:none'}">
            <label>Full Auto</label>
            <label class="mi-toggle">
              <input type="checkbox" id="mi-atk-full-auto">
              <span class="mi-toggle-track"></span>
              <span class="mi-toggle-hint">Formidable difficulty — random rounds hit per target</span>
            </label>
          </div>

          <div class="mi-form-row mi-full-auto-rounds-row" id="mi-atk-rounds-row" style="display:none">
            <label>Rounds</label>
            <div class="mi-rounds-slider-group">
              <input type="range" id="mi-atk-rounds-slider"
                min="${initSliderMin}" max="${initSliderMax}" value="${initDeclaredRounds}" step="1"
                class="mi-rounds-slider">
              <span class="mi-rounds-value" id="mi-atk-rounds-val">${initDeclaredRounds}</span>
            </div>
          </div>

          <div class="mi-form-row mi-full-auto-info-row" id="mi-atk-rounds-info-row" style="display:none">
            <label></label>
            <span class="mi-rounds-info" id="mi-atk-rounds-info">${initRoundsPerTarget} per target${initSpareRounds > 0 ? `, ${initSpareRounds} lost` : ''}</span>
          </div>

          <div class="mi-form-row mi-form-row--toggle" id="mi-atk-charge-row">
            <label>Charge</label>
            <label class="mi-toggle">
              <input type="checkbox" id="mi-atk-charge"${chargeChecked}>
              <span class="mi-toggle-track"></span>
              <span class="mi-toggle-hint">Weapon size +1, Damage Modifier +1, Hard difficulty</span>
            </label>
          </div>

        </div>

        <div class="mi-dialog-target-row">
          <span class="mi-dialog-target-label">Effective Target</span>
          <span class="mi-dialog-target-val" id="mi-atk-target-val">${initTarget}%</span>
        </div>

        ${gmDefenderPanel}

      </div>
    `;

    return new Promise(resolve => {
      const dialog = new Dialog({
        title: 'Attack',
        content,
        buttons: {
          attack: {
            icon:  '<i class="fas fa-sword"></i>',
            label: 'Attack',
            callback: html => {
              const result = _readDialog(html, attacker, defender, ctx, stylesByWeaponId, allStyleWeapons);
              resolve(result);
            }
          },
          cancel: {
            icon:  '<i class="fas fa-times"></i>',
            label: 'Cancel',
            callback: () => resolve(null)
          }
        },
        default: 'attack',
        classes: ['dialog', 'mi-dialog'],
        render: html => {
          // Wire live updates ─────────────────────────────────────────────────
          const weaponSel     = html.find('#mi-atk-weapon')[0];
          const styleSel      = html.find('#mi-atk-style')[0];
          const difficultySel = html.find('#mi-atk-difficulty')[0];
          const chargeChk      = html.find('#mi-atk-charge')[0];
          const chargeRow      = html.find('#mi-atk-charge-row')[0];
          const rangeBandSel   = html.find('#mi-atk-range-band')[0];
          const rangeBandRow   = html.find('#mi-atk-range-band-row')[0];
          const aimingChk      = html.find('#mi-atk-aiming')[0];
          const aimingRow      = html.find('#mi-atk-aiming-row')[0];
          const targetDisplay  = html.find('#mi-atk-target-display')[0];
          const targetVal      = html.find('#mi-atk-target-val')[0];

          // Show/hide melee vs ranged rows based on the currently selected weapon.
          // Also rebuilds the GM Mode defender weapon list with shield filtering
          // and shield-first sorting applied to match the current attack type.
          const _updateRangedMode = () => {
            const wId = weaponSel.value;
            const resolvedWeapon = allStyleWeapons.find(w => w.id === wId) ?? null;
            const isRanged = (resolvedWeapon?.system?.category ?? 'melee') === 'ranged';

            // Toggle attacker rows
            if (rangeBandRow) rangeBandRow.style.display = isRanged ? '' : 'none';
            if (aimingRow)    aimingRow.style.display    = isRanged ? '' : 'none';
            if (chargeRow)    chargeRow.style.display    = isRanged ? 'none' : '';

            // Ammo row — show for ranged, update display and disable Attack if empty
            const ammoRow     = html.find('#mi-atk-ammo-row')[0];
            const ammoDisplay = html.find('#mi-atk-ammo-display')[0];
            const attackBtn   = html.closest('.dialog').find('button[data-button="attack"]')[0]
                             ?? html.find('.dialog-button[data-button="attack"]')[0];
            if (ammoRow) ammoRow.style.display = isRanged ? '' : 'none';
            if (isRanged && ammoDisplay) {
              const ammo    = resolvedWeapon?.system?.ammo    ?? null;
              const ammoMax = resolvedWeapon?.system?.ammoMax ?? null;
              const empty   = ammo !== null && ammo <= 0;
              const jammed  = !!(attacker.getFlag?.('mythras-imperative', 'jammedWeapons') ?? {})[wId];
              ammoDisplay.textContent = ammo !== null ? `${ammo} / ${ammoMax}` : '—';
              ammoDisplay.classList.toggle('mi-ammo-empty', empty);
              if (attackBtn) {
                attackBtn.disabled = empty || jammed;
                attackBtn.title    = jammed ? 'Weapon is jammed — field-strip to clear' : '';
              }
            } else {
              if (attackBtn) { attackBtn.disabled = false; attackBtn.title = ''; }
            }

            // Burst fire row — only for firearms with the 'burst-fire' trait
            const burstRow = html.find('#mi-atk-burst-row')[0];
            if (burstRow) {
              const isBurstCapable = isRanged && (resolvedWeapon?.system?.traits ?? []).includes('burst-fire');
              burstRow.style.display = isBurstCapable ? '' : 'none';
            }

            // Full-auto row — only for firearms with the 'full-auto' trait
            const fullAutoRow = html.find('#mi-atk-full-auto-row')[0];
            const roundsRow   = html.find('#mi-atk-rounds-row')[0];
            const roundsInfoRow = html.find('#mi-atk-rounds-info-row')[0];
            if (fullAutoRow) {
              const isFullAutoCapable = isRanged && (resolvedWeapon?.system?.traits ?? []).includes('full-auto');
              fullAutoRow.style.display = isFullAutoCapable ? '' : 'none';
              // If weapon changed to non-full-auto, hide rounds rows and uncheck
              if (!isFullAutoCapable) {
                if (roundsRow) roundsRow.style.display = 'none';
                if (roundsInfoRow) roundsInfoRow.style.display = 'none';
                const faChk = html.find('#mi-atk-full-auto')[0];
                if (faChk) faChk.checked = false;
              }
            }
            // Update rounds slider bounds when weapon changes
            const faChkCurrent = html.find('#mi-atk-full-auto')[0];
            if (faChkCurrent?.checked && roundsRow) {
              const slider = html.find('#mi-atk-rounds-slider')[0];
              if (slider) {
                const cyclic  = resolvedWeapon?.system?.cyclicRate ?? 0;
                const ammo    = resolvedWeapon?.system?.ammo ?? 0;
                const newMax  = Math.min(cyclic > 0 ? cyclic : 999, ammo);
                const targets = initTargetCount;
                slider.min   = targets;
                slider.max   = newMax >= targets ? newMax : targets;
                if (parseInt(slider.value) > newMax) slider.value = newMax;
                if (parseInt(slider.value) < targets) slider.value = targets;
                _updateRoundsDisplay(slider.value);
              }
            }

            // Rebuild GM Mode defender weapon list
            if (gmMode) {
              const gmWeaponSel  = html.find('#mi-gm-def-weapon')[0];
              const gmStyleSel   = html.find('#mi-gm-def-style')[0];
              if (!gmWeaponSel) return;

              // Filter and sort: ranged = shields only (fall back to all if none);
              // melee = shields first, then alphabetical
              let eligible = defParryWeaponsAll.slice();
              if (isRanged) {
                const shieldOnly = eligible.filter(w => (w.system.traits ?? []).includes('shield'));
                if (shieldOnly.length > 0) eligible = shieldOnly;
              }
              eligible.sort((a, b) => {
                const aS = (a.system.traits ?? []).includes('shield') ? 0 : 1;
                const bS = (b.system.traits ?? []).includes('shield') ? 0 : 1;
                if (aS !== bS) return aS - bS;
                return a.name.localeCompare(b.name);
              });

              // Rebuild weapon options
              gmWeaponSel.innerHTML = eligible.length
                ? eligible.map(w => `<option value="${w.id}">${w.name}</option>`).join('')
                : '<option value="">— No weapons —</option>';

              // Rebuild style options for new first weapon
              const firstWeaponId = eligible[0]?.id ?? null;
              const newStyles = firstWeaponId ? (defStylesByWeaponId[firstWeaponId] ?? []) : [];
              if (gmStyleSel) gmStyleSel.innerHTML = _buildStyleOptions(newStyles, null);

              // Update parry skill display
              const gmParrySkill = html.find('#mi-gm-parry-skill')[0];
              if (gmParrySkill) gmParrySkill.textContent = `${newStyles[0]?.system.total ?? 0}%`;

              // Enable/disable parry radio based on whether any weapons are available
              const parryRadio = html.find('input[name="mi-gm-def-type"][value="parry"]')[0];
              if (parryRadio) parryRadio.disabled = eligible.length === 0;
            }
          };

          // When weapon changes, rebuild the style list and update ranged/melee mode
          weaponSel.addEventListener('change', () => {
            const wId    = weaponSel.value;
            const styles = stylesByWeaponId[wId] ?? [];
            styleSel.innerHTML = _buildStyleOptions(styles, null);
            _updateRangedMode();
            _updateTarget();
          });

          // Recompute target whenever anything changes
          const _updateTarget = () => {
            const wId        = weaponSel.value;
            const resolvedW  = allStyleWeapons.find(w => w.id === wId) ?? null;
            const isRanged   = (resolvedW?.system?.category ?? 'melee') === 'ranged';
            const styleId    = styleSel.value;
            const allStyles  = stylesByWeaponId[wId] ?? [];
            const style      = allStyles.find(s => s.id === styleId) ?? allStyles[0] ?? null;
            const skillTotal = style ? (style.system.total ?? 0) : 0;

            let chosenDiff = difficultySel.value;

            if (isRanged) {
              // Long range imposes Hard difficulty
              const band = rangeBandSel?.value ?? 'effective';
              if (band === 'long') chosenDiff = _harderDifficulty(chosenDiff);
              // Burst fire imposes Hard difficulty
              const burstChk = html.find('#mi-atk-burst')[0];
              if (burstChk?.checked) chosenDiff = _harderDifficulty(chosenDiff);
              // Full-auto imposes Formidable difficulty (two grades harder)
              const fullAutoChk = html.find('#mi-atk-full-auto')[0];
              if (fullAutoChk?.checked) {
                chosenDiff = _harderDifficulty(chosenDiff);
                chosenDiff = _harderDifficulty(chosenDiff);
              }
              // Aiming reduces one difficulty grade (cancels one step of penalty)
              if (aimingChk?.checked) chosenDiff = _easierDifficulty(chosenDiff);
            } else {
              // Charge imposes Hard difficulty for melee
              // Beast-back Lancer trait: mounted charge does not incur the Hard penalty
              const hasBeastBackLancer = (styleSel?.value
                ? (attacker.items.get(styleSel.value)?.system?.traits ?? []).includes('beastBackLancer')
                : false);
              if (chargeChk?.checked && !hasBeastBackLancer) chosenDiff = _harderDifficulty(chosenDiff);
            }

            // Apply combined floor (fatigue + prone) — take worst
            const chosenIdx  = gradeOrder.indexOf(chosenDiff);
            const worstIdx   = Math.max(chosenIdx, floorIdx);
            const worstGrade = gradeOrder[worstIdx] ?? chosenDiff;
            const target = _applyDifficulty(skillTotal, worstGrade);
            const display = worstGrade === 'hopeless' ? '—' : `${target}%`;
            targetDisplay.textContent = display;
            targetVal.textContent     = display;
          };

          // ── Rounds slider helper ─────────────────────────────────────────
          const _updateRoundsDisplay = (rawVal) => {
            const val         = parseInt(rawVal) || 1;
            const targets     = initTargetCount;
            const perTarget   = Math.floor(val / targets);
            const spare       = val % targets;
            const roundsVal   = html.find('#mi-atk-rounds-val')[0];
            const roundsInfo  = html.find('#mi-atk-rounds-info')[0];
            if (roundsVal)  roundsVal.textContent  = val;
            if (roundsInfo) roundsInfo.textContent =
              `${perTarget} per target${spare > 0 ? `, ${spare} lost in traverse` : ''}`;
          };

          // ── Full-auto toggle: show/hide rounds rows ────────────────────────
          const _onFullAutoToggle = () => {
            const checked     = html.find('#mi-atk-full-auto')[0]?.checked ?? false;
            const roundsRow   = html.find('#mi-atk-rounds-row')[0];
            const roundsInfoRow = html.find('#mi-atk-rounds-info-row')[0];
            if (roundsRow)     roundsRow.style.display     = checked ? '' : 'none';
            if (roundsInfoRow) roundsInfoRow.style.display = checked ? '' : 'none';
            if (checked) {
              // Recompute slider bounds for current weapon
              const wId    = weaponSel.value;
              const weapon = allStyleWeapons.find(w => w.id === wId) ?? null;
              const cyclic = weapon?.system?.cyclicRate ?? 0;
              const ammo   = weapon?.system?.ammo ?? 0;
              const slider = html.find('#mi-atk-rounds-slider')[0];
              if (slider) {
                const newMax = Math.min(cyclic > 0 ? cyclic : 999, ammo);
                const targets = initTargetCount;
                slider.min = targets;
                slider.max = newMax >= targets ? newMax : targets;
                // Default to max (full cyclic rate)
                if (parseInt(slider.value) < targets || parseInt(slider.value) > newMax) {
                  slider.value = newMax >= targets ? newMax : targets;
                }
                _updateRoundsDisplay(slider.value);
              }
            }
            _updateTarget();
          };

          styleSel.addEventListener('change', _updateTarget);
          difficultySel.addEventListener('change', _updateTarget);
          chargeChk?.addEventListener('change', _updateTarget);
          rangeBandSel?.addEventListener('change', _updateTarget);
          aimingChk?.addEventListener('change', _updateTarget);
          html.find('#mi-atk-burst')[0]?.addEventListener('change', _updateTarget);
          html.find('#mi-atk-full-auto')[0]?.addEventListener('change', _onFullAutoToggle);
          html.find('#mi-atk-rounds-slider')[0]?.addEventListener('input', ev => {
            _updateRoundsDisplay(ev.target.value);
          });

          // Set initial visibility and target
          _updateRangedMode();

          _updateTarget();

          // ── GM Mode inline defender panel wiring ──────────────────────────
          if (gmMode) {
            const gmDefRadios   = html.find('input[name="mi-gm-def-type"]');
            const gmWeaponSel   = html.find('#mi-gm-def-weapon')[0];
            const gmStyleSel    = html.find('#mi-gm-def-style')[0];
            const gmParryBlock  = html.find('#mi-gm-parry-selectors')[0];
            const gmParrySkill  = html.find('#mi-gm-parry-skill')[0];

            const _updateGmDefence = () => {
              const type = html.find('input[name="mi-gm-def-type"]:checked').val();
              if (gmParryBlock) {
                gmParryBlock.style.display = type === 'parry' ? '' : 'none';
              }
              if (type === 'parry' && gmWeaponSel && gmStyleSel) {
                const styles = defStylesByWeaponId[gmWeaponSel.value] ?? [];
                const style  = styles.find(s => s.id === gmStyleSel.value) ?? styles[0] ?? null;
                if (gmParrySkill) gmParrySkill.textContent = `${style?.system.total ?? 0}%`;
              }
            };

            if (gmWeaponSel) {
              gmWeaponSel.addEventListener('change', () => {
                const styles = defStylesByWeaponId[gmWeaponSel.value] ?? [];
                if (gmStyleSel) gmStyleSel.innerHTML = _buildStyleOptions(styles, null);
                _updateGmDefence();
              });
            }
            if (gmStyleSel) gmStyleSel.addEventListener('change', _updateGmDefence);
            gmDefRadios.on('change', _updateGmDefence);
            _updateGmDefence();
          }
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
 * Find the first canvas token whose actor matches the given actor.
 * Returns null when running headless (no canvas) or no match found.
 */
function _findTokenForActor(actor) {
  if (!canvas?.tokens?.placeables) return null;
  return canvas.tokens.placeables.find(t => t.actor?.id === actor.id) ?? null;
}

/**
 * Build a map: weaponId → combat-style[] (styles that include that weapon).
 * Styles are sorted descending by skill total so the best appears first.
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
  // Sort each entry by skill total descending
  for (const id of Object.keys(map)) {
    map[id].sort((a, b) => (b.system.total ?? 0) - (a.system.total ?? 0));
  }
  return map;
}

/**
 * Collect all unique weapons referenced by any combat style on this actor.
 * Resolves each weapon reference { id, name } to the actual Item on the actor.
 * Returns array of weapon Items, deduplicated, sorted by name.
 */
function _buildWeaponList(actor, stylesByWeaponId) {
  const seen    = new Set();
  const weapons = [];

  for (const weaponId of Object.keys(stylesByWeaponId)) {
    if (seen.has(weaponId)) continue;
    seen.add(weaponId);

    // Attempt to resolve by id; fall back to name match via style reference
    let item = actor.items.get(weaponId);

    if (!item) {
      // Style stores { id, name } — try name match as fallback
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

  return weapons.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build <option> elements for a list of combat styles.
 * @param {Item[]}      styles        Combat-style items
 * @param {string|null} selectedId    Pre-selected style id, or null for first
 */
function _buildStyleOptions(styles, selectedId) {
  if (styles.length === 0) return '<option value="">— No style —</option>';
  return styles.map(s => {
    const total    = s.system.total ?? 0;
    const selected = (selectedId ? s.id === selectedId : false) ? ' selected' : '';
    return `<option value="${s.id}"${selected}>${s.name} (${total}%)</option>`;
  }).join('');
}

/**
 * Find a skill item by exact name on the given actor (for GM Mode defender panel).
 */
function _findDefenderSkill(actor, name) {
  return Array.from(actor.items).find(
    i => i.type === 'skill' && i.name === name
  ) ?? null;
}

/**
 * Apply difficulty multiplier to a skill total. Returns integer (Math.ceil).
 * Returns 0 for 'hopeless'.
 */
function _applyDifficulty(skill, difficulty) {
  const grade = CONFIG.MYTHRAS.difficultyGrades[difficulty];
  if (!grade || grade.multiplier === null) return 0;
  return Math.ceil(skill * grade.multiplier);
}

/**
 * When Charge is declared, the attack is already at Hard difficulty.
 * If the GM has set an even harder grade, we respect that and don't
 * accidentally make it easier. We step the difficulty down by one level
 * from the GM's chosen grade, taking whichever is harder.
 *
 * Difficulty order (easiest → hardest):
 *   veryEasy → easy → standard → hard → formidable → herculean → hopeless
 *
 * Charge imposes Hard. So the effective difficulty is:
 *   max(chosen, hard)   where max = harder of the two.
 */
function _harderDifficulty(chosen) {
  const ORDER = ['veryEasy', 'easy', 'standard', 'hard', 'formidable', 'herculean', 'hopeless'];
  const iChosen = ORDER.indexOf(chosen);
  const iHard   = ORDER.indexOf('hard');
  // Higher index = harder. Charge enforces at least Hard.
  return ORDER[Math.max(iChosen, iHard)];
}

/**
 * Aiming reduces difficulty by one grade. Cannot go below veryEasy, and
 * cannot reduce a Hopeless grade (which means the action is impossible).
 *
 * Used for ranged aiming; may be used for other effects in future.
 */
function _easierDifficulty(chosen) {
  const ORDER = ['veryEasy', 'easy', 'standard', 'hard', 'formidable', 'herculean', 'hopeless'];
  const i = ORDER.indexOf(chosen);
  if (i <= 0 || chosen === 'hopeless') return chosen; // cannot reduce impossible or already minimum
  return ORDER[i - 1];
}

/**
 * Read confirmed dialog values and mutate the combatContext.
 * Returns the mutated ctx.
 */
function _readDialog(html, attacker, defender, ctx, stylesByWeaponId, allStyleWeapons) {
  const weaponId   = html.find('#mi-atk-weapon').val();
  const styleId    = html.find('#mi-atk-style').val();
  const difficulty = html.find('#mi-atk-difficulty').val();

  // Resolve weapon Item first — we need it to determine melee vs ranged
  const chosenWeapon = allStyleWeapons.find(w => w.id === weaponId)
    ?? attacker.items.get(weaponId)
    ?? ctx.weapon;

  const isRangedWeapon = (chosenWeapon?.system?.category ?? 'melee') === 'ranged';

  // Melee-only: Charge toggle
  const isCharge   = isRangedWeapon ? false : (html.find('#mi-atk-charge')[0]?.checked ?? false);

  // Ranged-only: Range band and aiming
  const rangeBand    = isRangedWeapon ? (html.find('#mi-atk-range-band').val() ?? 'effective') : null;
  const isAiming     = isRangedWeapon && (html.find('#mi-atk-aiming')[0]?.checked ?? false);
  const isBurstFire     = isRangedWeapon && (html.find('#mi-atk-burst')[0]?.checked ?? false);
  const isFullAuto      = isRangedWeapon && (html.find('#mi-atk-full-auto')[0]?.checked ?? false);
  const declaredRounds  = isFullAuto
    ? (parseInt(html.find('#mi-atk-rounds-slider')[0]?.value) || 0) : 0;

  // Resolve style Item
  const candidateStyles = stylesByWeaponId[weaponId] ?? [];
  const chosenStyle     = candidateStyles.find(s => s.id === styleId)
    ?? candidateStyles[0]
    ?? ctx.attackerStyle;

  // Effective difficulty
  // Melee: Charge imposes at least Hard.
  // Ranged: Long band imposes Hard; Aiming reduces one grade.
  let effectiveDifficulty = difficulty;
  // Beast-back Lancer style trait: mounted charge does not incur Hard difficulty
  const hasBeastBackLancer = chosenStyle
    ? (chosenStyle.system.traits ?? []).includes('beastBackLancer')
    : false;
  if (!isRangedWeapon && isCharge && !hasBeastBackLancer) {
    effectiveDifficulty = _harderDifficulty(effectiveDifficulty);
  }
  if (isRangedWeapon && rangeBand === 'long') {
    effectiveDifficulty = _harderDifficulty(effectiveDifficulty);
  }
  if (isRangedWeapon && isBurstFire) {
    effectiveDifficulty = _harderDifficulty(effectiveDifficulty);
  }
  if (isRangedWeapon && isFullAuto) {
    effectiveDifficulty = _harderDifficulty(effectiveDifficulty);
    effectiveDifficulty = _harderDifficulty(effectiveDifficulty);
  }
  if (isRangedWeapon && isAiming) {
    effectiveDifficulty = _easierDifficulty(effectiveDifficulty);
  }
  const rawSkillTotal       = chosenStyle ? (chosenStyle.system.total ?? 0) : 0;

  // Take worst of: GM-chosen difficulty, charge floor, condition floor (fatigue + prone)
  // CombatEngine is registered on CONFIG.MYTHRAS.CombatEngine during init — safe to call sync here.
  const CE = CONFIG.MYTHRAS?.CombatEngine;
  const conditionFloor = CE ? CE._getConditionFloorGrade(attacker) : 'standard';
  const gradeOrder = ['veryEasy','easy','standard','hard','formidable','herculean','hopeless'];
  const diffIdx    = gradeOrder.indexOf(effectiveDifficulty);
  const condIdx    = gradeOrder.indexOf(conditionFloor);
  const worstGrade = gradeOrder[Math.max(diffIdx, condIdx)];

  const effectiveSkill = _applyDifficulty(rawSkillTotal, worstGrade);

  // Mutate context
  ctx.weapon              = chosenWeapon;
  ctx.attackerStyle       = chosenStyle;
  // For vehicle weapon attacks preserve the full ranged style list set by
  // initiateVehicleWeaponAttack; candidateStyles only contains the mapped entry.
  ctx.attackerStyles      = ctx.vehicleWeaponAttack ? ctx.attackerStyles : candidateStyles;
  ctx.attackerTraits      = chosenStyle
    ? Array.from(chosenStyle.system.traits ?? [])
    : [];
  ctx.attackerSkillTotal  = effectiveSkill;
  ctx.difficulty          = effectiveDifficulty;
  ctx.isCharge            = isCharge;
  ctx.isRanged            = isRangedWeapon;
  ctx.rangeBand           = rangeBand;   // 'close'|'effective'|'long'|null (melee)
  ctx.isAiming            = isAiming;
  ctx.isBurstFire         = isBurstFire;
  ctx.isFullAuto          = isFullAuto;
  ctx.declaredRounds      = declaredRounds;

  // Charge bonus effects
  if (isCharge && !ctx.bonusSpecialEffects.includes('chargeBonus')) {
    ctx.bonusSpecialEffects.push('chargeBonus');
  }

  // ── GM Mode: read inline defender choices ─────────────────────────────────
  const gmMode = game.settings.get('mythras-imperative', 'gmMode') ?? false;
  if (gmMode) {
    const defType      = html.find('input[name="mi-gm-def-type"]:checked').val() ?? 'none';
    const defWeaponId  = html.find('#mi-gm-def-weapon').val() ?? null;
    const defStyleId   = html.find('#mi-gm-def-style').val() ?? null;

    // Resolve skill total for GM choice
    let defSkillTotal = 0;
    const defender    = ctx.defender;
    if (defType === 'parry' && defWeaponId) {
      const styles = _buildStylesByWeaponMap(defender);
      const candidates = styles[defWeaponId] ?? [];
      const chosenDefStyle = candidates.find(s => s.id === defStyleId) ?? candidates[0] ?? null;
      defSkillTotal = chosenDefStyle?.system.total ?? 0;
    } else if (defType === 'evade') {
      defSkillTotal = _findDefenderSkill(defender, 'Evade')?.system.total ?? 0;
    } else if (defType === 'acrobatics') {
      defSkillTotal = _findDefenderSkill(defender, 'Acrobatics')?.system.total ?? 0;
    }

    // Prone determination
    const hasDaredevil = Array.from(defender.items).some(
      i => i.type === 'combat-style' && (i.system.traits ?? []).includes('daredevil')
    );
    const willBeProne = defType === 'evade' && !hasDaredevil;

    ctx.inlineDefenceData = {
      defenceType: defType,
      weaponId:    defWeaponId,
      styleId:     defStyleId,
      skillTotal:  defSkillTotal,
      actorId:     defender.id,
      willBeProne
    };
  }

  return ctx;
}
