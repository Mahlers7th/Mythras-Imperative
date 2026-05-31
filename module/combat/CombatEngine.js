/**
 * mythras-imperative/module/combat/CombatEngine.js
 *
 * The Mythras Imperative combat engine. Handles the full exchange resolution:
 *   initiateAttack → attacker dialog → defender dialog → rolls → differential
 *   → special effects → damage → hit location → parry reduction → armour
 *   → wound threshold → actor updates → chat card
 *
 * The combatContext object is the single source of truth for every exchange.
 * It is built before any dialog opens and mutated as each stage completes.
 *
 * Differential Roll table — from Mythras Imperative p.25:
 *
 *   Attacker \ Defender  | Critical | Success  | Failure  | Fumble
 *   ---------------------|----------|----------|----------|--------
 *   Critical             | 0 SE     | A wins 1 | A wins 2 | A wins 3
 *   Success              | D wins 1 | 0 SE     | A wins 1 | A wins 2
 *   Failure              | D wins 2 | D wins 1 | 0 SE     | 0 SE
 *   Fumble               | D wins 3 | D wins 2 | 0 SE     | 0 SE
 *
 * "No Benefit" rows — both fail, or fumble vs fumble — end the exchange
 * with no special effects and no damage.
 *
 * Unable/Unwilling to Parry: defender treated as automatic Failure.
 * Parrying a missed attack: defender may spend AP; attacker is still Failure.
 */

import { getFatigueSkillGrade } from '../utils/fatigue.js';
import { classifyLocation } from '../utils/combat-math.js';
import {
  waitForCard,
  runSEDialog,
  runWoundEnduranceDialog,
  postOpposedSEResult,
  applyStatusToActor,
  removeStatusFromActor,
  applyProneToDefender,
  applyFatigueToSkill,
  getActiveImpaleGrade,
  getActiveEntangleGrade,
} from './effects/helpers.js';
import {
  resolveWithdraw,
  resolveDuckBack,
  resolveRapidReload,
  resolveOverpenetrate,
  resolveCircumventCover,
  resolveSelectTarget,
  resolveWeaponMalfunction,
} from './effects/simple.js';
import {
  resolveBleed,
  resolveTripOpponent,
  resolveStunLocation,
  resolveDisarmOpponent,
  resolveBlindOpponent,
  resolveDropFoe,
  resolvePinDown,
} from './effects/opposed.js';

export class CombatEngine {

  /** Current automation level setting */
  static get automationLevel() {
    return game.settings.get('mythras-imperative', 'automationLevel') ?? 'manual';
  }

  // Safe item getter — returns null instead of throwing when id is missing from collection.
  static _getItem(actor, itemId) {
    if (!actor || !itemId) return null;
    try { return actor.items.get(itemId) ?? null; }
    catch (_) { return null; }
  }

  /** Whether GM Mode is active (inline defender panel, no socket) */
  static get gmMode() {
    if (CombatEngine.automationLevel === 'manual') return false;
    return game.settings.get('mythras-imperative', 'gmMode') ?? false;
  }


  // -------------------------------------------------------------------------
  // Entry point — crew member fires a vehicle weapon
  //
  // Flow:
  //   1. Validate: vehicle token on canvas, at least one target selected.
  //   2. Crew picker dialog (skipped if only one crew member).
  //   3. Style picker dialog — all ranged combat styles on the chosen crew member.
  //   4. Call initiateAttack(crewMemberActor, vehicleWeaponItem) — normal engine
  //      from that point, including Flow B if the target is a vehicle.
  // -------------------------------------------------------------------------

  /**
   * Called when a weapon row is clicked on the vehicle sheet Combat tab.
   *
   * @param {Actor} vehicle      The vehicle actor
   * @param {Item}  weaponItem   The weapon item embedded on the vehicle
   */
  static async initiateVehicleWeaponAttack(vehicle, weaponItem) {
    // ── 1. Target check ────────────────────────────────────────────────────
    const targetTokens = Array.from(game.user.targets ?? []);
    if (targetTokens.length === 0) {
      ui.notifications.warn('Target one or more tokens before firing a vehicle weapon.');
      return;
    }

    // ── 2. Resolve crew actors ─────────────────────────────────────────────
    // Crew roster entries: { uuid, cachedName, role }
    // Remove any whose actor can no longer be resolved.
    const roster = vehicle.system.crew ?? [];
    const crewActors = [];
    const staleCrew  = [];
    for (const entry of roster) {
      const actor = await fromUuid(entry.uuid).catch(() => null);
      if (actor) {
        crewActors.push({ actor, role: entry.role, uuid: entry.uuid });
      } else {
        staleCrew.push(entry.uuid);
      }
    }

    // Prune stale entries from the vehicle roster
    if (staleCrew.length > 0) {
      const updatedCrew = roster.filter(e => !staleCrew.includes(e.uuid));
      await vehicle.update({ 'system.crew': updatedCrew });
    }

    if (crewActors.length === 0) {
      ui.notifications.warn('No crew members assigned to this vehicle. Drag actors onto the Crew list first.');
      return;
    }

    // ── 3. Crew picker (skip if only one crew member) ──────────────────────
    let chosenCrew = null;
    if (crewActors.length === 1) {
      chosenCrew = crewActors[0].actor;
    } else {
      chosenCrew = await CombatEngine._pickCrewMember(crewActors, weaponItem.name);
      if (!chosenCrew) return; // cancelled
    }

    // ── 4. Style picker — all ranged combat styles on the crew member ──────
    const rangedStyles = Array.from(chosenCrew.items)
      .filter(i => i.type === 'combat-style')
      .sort((a, b) => (b.system.total ?? 0) - (a.system.total ?? 0));

    if (rangedStyles.length === 0) {
      ui.notifications.warn(`${chosenCrew.name} has no combat styles. Add a ranged combat style to fire vehicle weapons.`);
      return;
    }

    let chosenStyle = null;
    if (rangedStyles.length === 1) {
      chosenStyle = rangedStyles[0];
    } else {
      chosenStyle = await CombatEngine._pickVehicleStyle(rangedStyles, chosenCrew.name, weaponItem.name);
      if (!chosenStyle) return; // cancelled
    }

    // ── 5. Build context and launch normal attack flow ─────────────────────
    // Override _stylesForWeapon result by injecting style directly into context.
    const defender = targetTokens[0].actor ?? null;
    if (!defender) return;

    const ctx = CombatEngine._buildContext(chosenCrew, defender, weaponItem);
    // Override the style — vehicle weapon won't match _stylesForWeapon
    ctx.attackerStyle      = chosenStyle;
    ctx.attackerStyles     = rangedStyles;
    ctx.attackerSkillTotal = CombatEngine._resolveAttackSkill(chosenCrew, weaponItem, chosenStyle);
    ctx.attackerTraits     = Array.from(chosenStyle.system.traits ?? []);
    // Flag this as a vehicle weapon attack for chat card display
    ctx.vehicleWeaponAttack = true;
    ctx.vehicleName         = vehicle.name;

    ctx._targetActors = targetTokens.map(t => t.actor).filter(Boolean);

    for (const hook of (CONFIG.MYTHRAS?.rollHooks?.preRoll ?? [])) {
      const result = hook(ctx);
      if (result === false) return;
    }

    if (CombatEngine.automationLevel === 'manual') {
      await CombatEngine._runManual(ctx);
      return;
    }
    await CombatEngine._runDialog(ctx);
  }

  // -------------------------------------------------------------------------
  // Crew member picker dialog
  // -------------------------------------------------------------------------

  /**
   * Shows a small dialog listing crew members. Returns the chosen Actor or null.
   *
   * @param {Array<{actor, role, uuid}>} crewActors
   * @param {string} weaponName
   * @returns {Promise<Actor|null>}
   */
  static _pickCrewMember(crewActors, weaponName) {
    return new Promise(resolve => {
      const rows = crewActors.map((c, i) => {
        const role = c.role ? ` <span class="mi-muted mi-crew-role-label">(${c.role})</span>` : '';
        return `<label class="mi-crew-pick-row">
          <input type="radio" name="crewPick" value="${i}"${i === 0 ? ' checked' : ''}>
          <img class="mi-crew-pick-img" src="${c.actor.img}" title="${c.actor.name}"/>
          <span class="mi-crew-pick-name">${c.actor.name}</span>${role}
        </label>`;
      }).join('');

      const content = `
        <div class="mi-crew-picker">
          <p class="mi-crew-pick-prompt">Who is firing <strong>${weaponName}</strong>?</p>
          <div class="mi-crew-pick-list">${rows}</div>
        </div>`;

      new Dialog({
        title: 'Select Crew Member',
        content,
        buttons: {
          ok: {
            label: 'Fire',
            icon: '<i class="fas fa-crosshairs"></i>',
            callback: html => {
              const val = html[0].querySelector('input[name="crewPick"]:checked')?.value;
              resolve(val !== undefined ? crewActors[parseInt(val)].actor : null);
            }
          },
          cancel: { label: 'Cancel', callback: () => resolve(null) }
        },
        default: 'ok',
        close: () => resolve(null)
      }, { classes: ['mi-dialog', 'mi-crew-picker-dialog'], width: 320 }).render(true);
    });
  }

  // -------------------------------------------------------------------------
  // Style picker dialog for vehicle weapon attacks
  // -------------------------------------------------------------------------

  /**
   * Shows a combat style picker for the crew member.
   * Returns the chosen combat-style Item or null.
   *
   * @param {Item[]}  styles
   * @param {string}  crewName
   * @param {string}  weaponName
   * @returns {Promise<Item|null>}
   */
  static _pickVehicleStyle(styles, crewName, weaponName) {
    return new Promise(resolve => {
      const rows = styles.map((s, i) => {
        return `<label class="mi-crew-pick-row">
          <input type="radio" name="stylePick" value="${i}"${i === 0 ? ' checked' : ''}>
          <span class="mi-crew-pick-name">${s.name}</span>
          <span class="mi-muted mi-crew-style-pct">${s.system.total ?? 0}%</span>
        </label>`;
      }).join('');

      const content = `
        <div class="mi-crew-picker">
          <p class="mi-crew-pick-prompt"><strong>${crewName}</strong> — choose combat style for <strong>${weaponName}</strong>:</p>
          <div class="mi-crew-pick-list">${rows}</div>
        </div>`;

      new Dialog({
        title: 'Select Combat Style',
        content,
        buttons: {
          ok: {
            label: 'Confirm',
            icon: '<i class="fas fa-check"></i>',
            callback: html => {
              const val = html[0].querySelector('input[name="stylePick"]:checked')?.value;
              resolve(val !== undefined ? styles[parseInt(val)] : null);
            }
          },
          cancel: { label: 'Cancel', callback: () => resolve(null) }
        },
        default: 'ok',
        close: () => resolve(null)
      }, { classes: ['mi-dialog', 'mi-crew-picker-dialog'], width: 300 }).render(true);
    });
  }

  /**
   * Entry point when the player clicks a combat style % on the character sheet.
   * Resolves which weapon to use, then hands off to initiateAttack.
   *
   * If the style has exactly one weapon, use it automatically.
   * If it has multiple, use the first (weapon selection will move into the
   * attacker dialog once that is built in step 5).
   * If it has no weapons, notify and abort.
   *
   * @param {Actor} attacker
   * @param {Item}  style     The combat-style item whose % was clicked
   */
  static async initiateAttackFromStyle(attacker, style) {
    const weapons = style.system.weapons ?? [];

    if (weapons.length === 0) {
      ui.notifications.warn(`${style.name} has no weapons assigned. Add weapons via the combat style sheet.`);
      return;
    }

    // Resolve the weapon item from the actor — weapons are stored as { id, name }
    // Find the first one that exists on the actor; fall back to name match
    let weapon = null;
    for (const w of weapons) {
      weapon = attacker.items.get(w.id)
            ?? Array.from(attacker.items).find(i => i.type === 'weapon' && i.name === w.name)
            ?? null;
      if (weapon) break;
    }

    if (!weapon) {
      ui.notifications.warn(`No matching weapon found on ${attacker.name} for style "${style.name}".`);
      return;
    }

    await CombatEngine.initiateAttack(attacker, weapon);
  }

  // -------------------------------------------------------------------------
  // Entry point — called when a weapon row is clicked on the Combat tab
  // -------------------------------------------------------------------------

  /**
   * @param {Actor} attacker   The attacking actor
   * @param {Item}  weapon     The weapon item being used
   */
  static async initiateAttack(attacker, weapon) {
    // Collect targeted tokens. Multiple targets are allowed — the attacker
    // dialog decides whether full-auto is available for this weapon. If the
    // player has multiple targets selected but doesn't choose Full Auto, the
    // engine will use only the first target and note this in chat.
    const targetTokens = Array.from(game.user.targets ?? []);

    if (targetTokens.length === 0) {
      ui.notifications.warn('Target one or more tokens before attacking.');
      return;
    }

    // For the initial context, use the first target as defender.
    // _targetActors carries the full list so the dialog can show all targets
    // and the full-auto path can loop over them.
    const defender = targetTokens[0].actor ?? null;
    if (!defender) return;

    // Build the context object — single source of truth for this exchange
    const ctx = CombatEngine._buildContext(attacker, defender, weapon);
    // Stash all targets so _runDialog can use them if full-auto is chosen
    ctx._targetActors = targetTokens.map(t => t.actor).filter(Boolean);

    // Fire the preRoll hook — modules (e.g. Destined) may write to the context
    for (const hook of (CONFIG.MYTHRAS?.rollHooks?.preRoll ?? [])) {
      const result = hook(ctx);
      if (result === false) return;
    }

    // Branch on automation level
    if (CombatEngine.automationLevel === 'manual') {
      await CombatEngine._runManual(ctx);
      return;
    }

    // Semi / Automated / GM Only — full dialog flow
    await CombatEngine._runDialog(ctx);
  }

  // -------------------------------------------------------------------------
  // DIALOG FLOW — steps 5 + 6
  //
  // With GM Mode OFF (default multiplayer flow):
  //   1. Attacker dialog → player confirms weapon/style/difficulty/charge
  //   2. Socket emits combatChallenge to defender's client
  //   3. Defender dialog opens on defender's client → response returns
  //   4. Engine continues with merged ctx
  //
  // With GM Mode ON (prep/testing/NPC flow):
  //   1. Attacker dialog with INLINE defender panel → GM confirms both sides
  //   2. No socket. Engine continues immediately.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Full Auto multi-target loop
  //
  // Rules p.50: The attacker declares rounds and targets before rolling.
  // Rounds are distributed evenly across all targets in the arc; spare rounds
  // are lost traversing aim. A separate attack roll is made for each target
  // at Formidable difficulty. Each target that is hit then suffers a random
  // number of rounds striking home (as per Burst — 1d3). Special Effects only
  // apply to the first hit of the first target.
  //
  // Implementation: one independent exchange per target, sharing a single AP
  // cost. Ammo is decremented up-front (3 rounds per target, rounded down to
  // available ammo). SEs are suppressed on targets 2+.
  // -------------------------------------------------------------------------

  static async _runFullAutoExchanges(confirmedCtx, targets) {
    const { attacker, weapon } = confirmedCtx;
    const targetCount    = targets.length;
    const atkWeapon      = weapon;
    const currentAmmo    = atkWeapon?.system?.ammo ?? null;
    const cyclicRate     = atkWeapon?.system?.cyclicRate ?? 0;
    const declaredRounds = confirmedCtx.declaredRounds ?? 0;

    // ── Validate rounds vs cyclic rate and target count ──────────────────────
    if (declaredRounds < 1) {
      ui.notifications.warn('Full Auto: no rounds declared. Adjust the rounds slider.');
      return;
    }
    if (cyclicRate > 0 && declaredRounds > cyclicRate) {
      ui.notifications.warn(
        `${atkWeapon.name} cyclic rate is ${cyclicRate} rounds — cannot fire ${declaredRounds}.`
      );
      return;
    }
    const roundsPerTarget = Math.floor(declaredRounds / targetCount);
    const spareRounds     = declaredRounds % targetCount;
    if (roundsPerTarget < 1) {
      ui.notifications.warn(
        `${atkWeapon.name}: only ${declaredRounds} round${declaredRounds === 1 ? '' : 's'} for ` +
        `${targetCount} targets — need at least 1 per target. Reduce targets or increase rounds.`
      );
      return;
    }

    // ── Ammo check and decrement ─────────────────────────────────────────────
    if (currentAmmo !== null) {
      if (currentAmmo <= 0) {
        ui.notifications.warn(`${atkWeapon.name} is out of ammunition.`);
        return;
      }
      if (currentAmmo < declaredRounds) {
        ui.notifications.warn(
          `${atkWeapon.name} only has ${currentAmmo} rounds — not enough for ${declaredRounds}. Reduce rounds on the slider.`
        );
        return;
      }
      await atkWeapon.update({ 'system.ammo': currentAmmo - declaredRounds });
    }

    // ── AP: attacker pays 1 AP for the whole spray ───────────────────────────
    await CombatEngine._spendActionPoint(attacker);

    // ── Post placeholder consolidated card ───────────────────────────────────
    const targetNames = targets.map(a => a.name).join(', ');
    const placeholderContent = CombatEngine._buildFullAutoPlaceholderCard({
      attacker, weapon: atkWeapon,
      targetNames, targetCount,
      declaredRounds, roundsPerTarget, spareRounds
    });
    const chatMsg = await ChatMessage.create({
      user:    game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      content: placeholderContent,
      flags:   { 'mythras-imperative': { stage: 'full-auto-pending' } }
    });

    // ── Loop: one exchange per target, accumulate results ────────────────────
    const exchangeResults = [];
    let isFirstTarget = true;

    for (const targetActor of targets) {
      const targetCtx = {
        ...confirmedCtx,
        defender:             targetActor,
        defenceType:          null,
        defenceStyle:         null,
        defenceWeapon:        null,
        defenderSkillTotal:   null,
        defenderSurprised: (() => {
          const token = canvas?.tokens?.placeables?.find(t => t.actor?.id === targetActor.id);
          return (token?.actor ?? targetActor).statuses?.has('surprised') ?? false;
        })(),
        wardedLocations:      CombatEngine._buildWardList(targetActor),
        attackRoll:           null,
        defenceRoll:          null,
        attackResult:         null,
        defenceResult:        null,
        attackOutcome:        null,
        defenceOutcome:       null,
        seAdvantage:          null,
        seWinner:             null,
        seCount:              null,
        chosenSpecialEffects: [],
        hitLocationId:        null,
        hitLocationLabel:     null,
        damageRoll:           null,
        rawDamage:            null,
        damageAfterParry:     null,
        damageAfterArmour:    null,
        parryReduction:       null,
        woundLevel:           null,
        enduranceRequired:    false,
        chatMessageId:        null,
        stage:                'init',
        _fullAutoSuppressSEs: !isFirstTarget,
        // Drive _resolveBurstDamage with per-target round count
        isBurstFire:          true,
        isFullAuto:           true,
        roundsPerTarget,          // used by _resolveBurstDamage instead of hardcoded 3
        _consolidatedChatMsg:  chatMsg, // so sub-exchanges don't post their own cards
        _fullAutoResults:      exchangeResults, // accumulate into shared array
        _targetActors:         null
      };

      await CombatEngine._runFullAutoSingleTarget(targetCtx);
      isFirstTarget = false;
    }

    // ── Render final consolidated card ───────────────────────────────────────
    await CombatEngine._updateFullAutoConsolidatedCard(chatMsg, confirmedCtx, {
      targets, declaredRounds, roundsPerTarget, spareRounds, exchangeResults
    });
  }

  // -------------------------------------------------------------------------
  // Single target exchange within a full-auto spray.
  // Handles defender dialog / socket, rolls, and damage — same as _runDialog
  // but skips the attacker dialog (already confirmed) and AP spend (done once).
  // -------------------------------------------------------------------------

  static async _runFullAutoSingleTarget(ctx) {
    const { attacker, defender } = ctx;

    // ── Surprised / zero-AP shortcuts ────────────────────────────────────────
    if (ctx.defenderSurprised) {
      ctx.defenceType        = 'none';
      ctx.defenderSkillTotal = 0;
      ctx.defenceOutcome     = 'none';
      if (!ctx.bonusSpecialEffects.includes('surpriseBonus')) {
        ctx.bonusSpecialEffects.push('surpriseBonus');
      }
      await CombatEngine._afterDefenceResolved(ctx);
      CombatEngine._accumulateFullAutoResult(ctx);
      return;
    }

    const defAP = defender.system.attributes?.actionPoints;
    if (defAP && typeof defAP.value === 'number' && defAP.value <= 0) {
      ctx.defenceType        = 'none';
      ctx.defenderSkillTotal = 0;
      ctx.defenceOutcome     = 'none';
      await CombatEngine._afterDefenceResolved(ctx);
      CombatEngine._accumulateFullAutoResult(ctx);
      return;
    }

    // ── GM Mode — show a compact per-target defence dialog ───────────────────
    if (CombatEngine.gmMode) {
      const defenceData = await CombatEngine._showFullAutoGMDefenceDialog(ctx);
      if (defenceData) {
        CombatEngine._applyDefenceData(ctx, defenceData);
      } else {
        ctx.defenceType        = 'none';
        ctx.defenderSkillTotal = 0;
      }
      await CombatEngine._afterDefenceResolved(ctx);
      CombatEngine._accumulateFullAutoResult(ctx);
      return;
    }

    // ── Socket — challenge defender ───────────────────────────────────────────
    const exchangeId = foundry.utils.randomID(16);
    const { CombatSocket } = await import('./CombatSocket.js');

    ui.notifications.info(
      `${attacker.name} (Full Auto) attacks ${defender.name} — waiting for defence…`
    );

    const defenceData = await CombatSocket.challenge(ctx, exchangeId);
    if (!defenceData) {
      ctx.defenceType        = 'none';
      ctx.defenderSkillTotal = 0;
    } else {
      CombatEngine._applyDefenceData(ctx, defenceData);
    }

    await CombatEngine._afterDefenceResolved(ctx);
    CombatEngine._accumulateFullAutoResult(ctx);
  }

  // Collect per-target exchange data into the shared results array.
  static _accumulateFullAutoResult(ctx) {
    const results = ctx._fullAutoResults;
    if (!Array.isArray(results)) return;
    results.push({
      defenderName:    ctx.defender?.name ?? '?',
      attackRoll:      ctx.attackResult ?? null,
      defenceRoll:     ctx.defenceResult ?? null,
      attackOutcome:   ctx.attackOutcome ?? 'failure',
      defenceType:     ctx.defenceType ?? 'none',
      defenceOutcome:  ctx.defenceOutcome ?? 'none',
      defenceWeapon:   ctx.defenceWeapon?.name ?? null,
      roundsAllocated: ctx.roundsPerTarget ?? 3,
      roundsHit:       ctx.roundsHit ?? 0,
      roundsRollVal:   ctx.roundsRoll?.total ?? null,
      burstResults:    ctx.burstResults ?? [],
      chosenSEs:       ctx.chosenSpecialEffects ?? [],
      seWinner:        ctx.seWinner ?? 'none',
    });
  }

  // -------------------------------------------------------------------------
  // GM Mode per-target defence dialog for full-auto exchanges.
  // Shows a compact inline-style dialog for each target in the spray, letting
  // the GM set the defence type, weapon, and style before the exchange resolves.
  // Returns defenceData (same shape as _applyDefenceData expects) or null.
  // -------------------------------------------------------------------------

  static async _showFullAutoGMDefenceDialog(ctx) {
    const { attacker, defender } = ctx;

    // Build defender weapon/style data (same helpers as AttackerDialog uses)
    const stylesByWeaponId = {};
    const defWeapons = Array.from(defender.items).filter(i =>
      i.type === 'weapon' || i.type === 'shield'
    );
    const defStyles = Array.from(defender.items).filter(i => i.type === 'combat-style');
    for (const style of defStyles) {
      for (const wEntry of (style.system.weapons ?? [])) {
        const wItem = defender.items.get(wEntry.id) ?? defender.items.getName(wEntry.name);
        if (wItem) {
          if (!stylesByWeaponId[wItem.id]) stylesByWeaponId[wItem.id] = [];
          stylesByWeaponId[wItem.id].push(style);
        }
      }
    }

    // Sort: shields first
    const sortedWeapons = defWeapons.slice().sort((a, b) => {
      const aS = (a.system.traits ?? []).includes('shield') ? 0 : 1;
      const bS = (b.system.traits ?? []).includes('shield') ? 0 : 1;
      return aS !== bS ? aS - bS : a.name.localeCompare(b.name);
    });

    const weaponOptions = sortedWeapons.length
      ? sortedWeapons.map(w => `<option value="${w.id}">${w.name}</option>`).join('')
      : '<option value="">— No weapons —</option>';

    const firstWeapon  = sortedWeapons[0] ?? null;
    const firstStyles  = firstWeapon ? (stylesByWeaponId[firstWeapon.id] ?? []) : [];
    const styleOptions = firstStyles.map(s =>
      `<option value="${s.id}">${s.name} (${s.system.total ?? 0}%)</option>`
    ).join('') || '<option value="">— No styles —</option>';

    const evadeSkill = Array.from(defender.items).find(
      i => i.type === 'skill' && i.name === 'Evade'
    );
    const evadeTotal = evadeSkill?.system.total ?? 0;
    const hasParry   = sortedWeapons.length > 0;

    const content = `
      <div class="mi-attacker-dialog">
        <div class="mi-dialog-skill-header">
          <span class="mi-dialog-skill-name">${attacker.name} (Full Auto) → ${defender.name}</span>
        </div>
        <div class="mi-defence-options mi-defence-options--inline" style="padding: 8px 0;">
          <label class="mi-defence-option">
            <input type="radio" name="mi-fa-def-type" value="parry" id="mi-fa-parry"
              ${hasParry ? 'checked' : 'disabled'}>
            <span class="mi-defence-label">
              <span class="mi-defence-name">Parry</span>
              <span class="mi-defence-skill" id="mi-fa-parry-skill">${firstStyles[0]?.system.total ?? 0}%</span>
            </span>
          </label>
          <div class="mi-parry-selectors" style="padding-left: 16px;">
            <div class="mi-form-row">
              <label>Weapon</label>
              <select id="mi-fa-def-weapon">${weaponOptions}</select>
            </div>
            <div class="mi-form-row">
              <label>Style</label>
              <select id="mi-fa-def-style">${styleOptions}</select>
            </div>
          </div>
          <label class="mi-defence-option">
            <input type="radio" name="mi-fa-def-type" value="evade">
            <span class="mi-defence-label">
              <span class="mi-defence-name">Evade</span>
              <span class="mi-defence-skill">${evadeTotal}%</span>
            </span>
          </label>
          <label class="mi-defence-option">
            <input type="radio" name="mi-fa-def-type" value="none" ${hasParry ? '' : 'checked'}>
            <span class="mi-defence-label">
              <span class="mi-defence-name">Don't Defend</span>
              <span class="mi-defence-skill">—</span>
            </span>
          </label>
        </div>
      </div>`;

    return new Promise(resolve => {
      const dialog = new Dialog({
        title: `Full Auto — ${defender.name} Defence`,
        content,
        buttons: {
          confirm: {
            label: 'Confirm',
            callback: (html) => {
              const defType     = html.find('input[name="mi-fa-def-type"]:checked').val() ?? 'none';
              const defWeaponId = html.find('#mi-fa-def-weapon').val() ?? null;
              const defStyleId  = html.find('#mi-fa-def-style').val() ?? null;
              const defWeapon   = defWeaponId ? defender.items.get(defWeaponId) : null;
              const defStyle    = defStyleId  ? defender.items.get(defStyleId)  : null;
              const skillTotal  = defType === 'parry'
                ? (defStyle?.system.total ?? 0)
                : defType === 'evade' ? evadeTotal : 0;
              resolve({ type: defType, weaponId: defWeaponId, styleId: defStyleId,
                        weapon: defWeapon, style: defStyle, skillTotal });
            }
          },
          skip: {
            label: "Don't Defend",
            callback: () => resolve(null)
          }
        },
        default: 'confirm',
        render: (html) => {
          // Update style list and parry skill when weapon changes
          html.find('#mi-fa-def-weapon').on('change', ev => {
            const wId     = ev.target.value;
            const styles  = stylesByWeaponId[wId] ?? [];
            const selOpts = styles.map(s =>
              `<option value="${s.id}">${s.name} (${s.system.total ?? 0}%)</option>`
            ).join('') || '<option value="">— No styles —</option>';
            html.find('#mi-fa-def-style').html(selOpts);
            html.find('#mi-fa-parry-skill').text(`${styles[0]?.system.total ?? 0}%`);
          });
        }
      }, { width: 360, classes: ['mi-dialog', 'dialog'] });
      dialog.render(true);
    });
  }

  static async _runDialog(ctx) {
    const { attacker, defender } = ctx;

    // ── Step 5: Attacker dialog ─────────────────────────────────────────────
    const { AttackerDialog } = await import('./AttackerDialog.js');
    const confirmedCtx = await AttackerDialog.show(ctx);

    if (!confirmedCtx) return; // player cancelled

    // ── Full Auto — hand off to multi-target loop ─────────────────────────────
    // Full-auto is resolved as N independent exchanges (one per target), sharing
    // the same AP cost. Ammo is decremented up-front in _runFullAutoExchanges.
    if (confirmedCtx.isFullAuto) {
      const targets = confirmedCtx._targetActors ?? [defender];
      await CombatEngine._runFullAutoExchanges(confirmedCtx, targets);
      return;
    }

    // ── Ammo decrement (ranged weapons only) ─────────────────────────────────
    // Burst fire costs burstSize rounds (always 3). Single shot costs 1.
    // The dialog blocks 0-ammo attacks but we guard here for macro/GM use.
    if (confirmedCtx.isRanged) {
      const atkWeapon   = confirmedCtx.weapon;
      const currentAmmo = atkWeapon?.system?.ammo ?? null;
      if (currentAmmo !== null) {
        const ammoCost = confirmedCtx.isBurstFire ? 3 : 1;
        if (currentAmmo <= 0) {
          ui.notifications.warn(`${atkWeapon.name} is out of ammunition.`);
          return;
        }
        if (confirmedCtx.isBurstFire && currentAmmo < ammoCost) {
          ui.notifications.warn(`${atkWeapon.name} has only ${currentAmmo} round${currentAmmo === 1 ? '' : 's'} — not enough for a burst (need 3). Switch to single fire.`);
          return;
        }
        await atkWeapon.update({ 'system.ammo': Math.max(0, currentAmmo - ammoCost) });
      }
    }

    // Attacker spends 1 AP — proactive action
    await CombatEngine._spendActionPoint(attacker);

    // ── Step 5a: Vehicle defender — skip all defender dialog / socket logic ──
    // Vehicles cannot parry, evade, or respond. Defence is always 'none'.
    // Damage resolution uses hull/structure rather than hit locations.
    if (confirmedCtx.defender?.type === 'vehicle') {
      confirmedCtx.defenceType        = 'none';
      confirmedCtx.defenderSkillTotal = 0;
      confirmedCtx.defenceOutcome     = 'none';
      await CombatEngine._resolveVehicleAttack(confirmedCtx);
      return;
    }

    // ── Step 5b: Surprised path — skip defender dialog entirely ─────────────
    if (confirmedCtx.defenderSurprised) {
      confirmedCtx.defenceType        = 'none';
      confirmedCtx.defenderSkillTotal = 0;
      confirmedCtx.defenceOutcome     = 'none'; // treated as failure in differential
      if (!confirmedCtx.bonusSpecialEffects.includes('surpriseBonus')) {
        confirmedCtx.bonusSpecialEffects.push('surpriseBonus');
      }
      ui.notifications.info(
        `${defender.name} is Surprised — automatic Defence Failure. Bonus Special Effect granted to ${attacker.name}.`
      );
      await CombatEngine._afterDefenceResolved(confirmedCtx);
      return;
    }

    // ── Step 5c: Zero AP — defender cannot react ─────────────────────────────
    // A combatant with 0 Action Points remaining cannot make any defensive
    // action. Their defence is treated as an automatic Failure (equivalent to
    // choosing Don't Defend), which grants the attacker 1 SE on a Success and
    // 2 SEs on a Critical — exactly the same as the 'none' path in the
    // differential table. We skip the defender dialog and note the reason.
    {
      const defAP = defender.system.attributes?.actionPoints;
      if (defAP && typeof defAP.value === 'number' && defAP.value <= 0) {
        confirmedCtx.defenceType        = 'none';
        confirmedCtx.defenderSkillTotal = 0;
        confirmedCtx.defenceOutcome     = 'none';
        ui.notifications.info(
          `${defender.name} has 0 Action Points — cannot defend. Defence treated as automatic Failure.`
        );
        await CombatEngine._afterDefenceResolved(confirmedCtx);
        return;
      }
    }

    // ── Step 5c: GM Mode — defence data came inline from the attacker dialog ─
    if (CombatEngine.gmMode) {
      // AttackerDialog.show() populates ctx.inlineDefenceData when GM Mode is on
      const defenceData = confirmedCtx.inlineDefenceData ?? null;
      if (defenceData) {
        CombatEngine._applyDefenceData(confirmedCtx, defenceData);
      } else {
        // GM chose "Don't Defend" or cancelled the inline panel
        confirmedCtx.defenceType        = 'none';
        confirmedCtx.defenderSkillTotal = 0;
      }
      await CombatEngine._afterDefenceResolved(confirmedCtx);
      return;
    }

    // ── Step 6: Socket — challenge the defender ──────────────────────────────
    const exchangeId = foundry.utils.randomID(16);
    const { CombatSocket } = await import('./CombatSocket.js');

    ui.notifications.info(
      `${attacker.name} attacks ${defender.name} — waiting for defender response…`
    );

    const defenceData = await CombatSocket.challenge(confirmedCtx, exchangeId);

    if (!defenceData) {
      // Timed out — treat as unable to defend
      confirmedCtx.defenceType        = 'none';
      confirmedCtx.defenderSkillTotal = 0;
    } else {
      CombatEngine._applyDefenceData(confirmedCtx, defenceData);
    }

    await CombatEngine._afterDefenceResolved(confirmedCtx);
  }

  /**
   * Apply the defender's response data onto the context.
   * defenceData: { defenceType, weaponId, styleId, skillTotal, actorId, willBeProne }
   */
  static _applyDefenceData(ctx, defenceData) {
    ctx.defenceType  = defenceData.defenceType ?? 'none';
    ctx.willBeProne  = defenceData.willBeProne ?? false;

    if (ctx.defenceType === 'parry') {
      ctx.defenceWeapon = defenceData.weaponId
        ? ctx.defender.items.get(defenceData.weaponId) ?? null
        : null;
      ctx.defenceStyle  = defenceData.styleId
        ? ctx.defender.items.get(defenceData.styleId) ?? null
        : null;
    } else {
      // Evade, acrobatics, or none — no weapon/style
      ctx.defenceWeapon = null;
      ctx.defenceStyle  = null;
    }

    ctx.defenderSkillTotal = CombatEngine._resolveDefenceSkill(ctx);
  }

  /**
   * Compute the effective defence skill total from the current ctx.
   * Parry:      combat style total
   * Evade:      Evade standard skill total
   * Acrobatics: Acrobatics professional skill total
   * None:       0
   */
  static _resolveDefenceSkill(ctx) {
    if (ctx.defenceType === 'none') return 0;

    let raw = 0;
    if (ctx.defenceType === 'evade') {
      const skill = Array.from(ctx.defender.items).find(
        i => i.type === 'skill' && i.name === 'Evade'
      );
      raw = skill?.system.total ?? 0;
    } else if (ctx.defenceType === 'acrobatics') {
      const skill = Array.from(ctx.defender.items).find(
        i => i.type === 'skill' && i.name === 'Acrobatics'
      );
      raw = skill?.system.total ?? 0;
    } else {
      // Parry — use style total, fall back to weapon total
      raw = ctx.defenceStyle?.system.total ?? ctx.defenceWeapon?.system.total ?? 0;
    }

    // Apply fatigue first, then prone — both apply to combat skill rolls (p.47).
    const afterFatigue = CombatEngine._applyFatigueToSkill(raw, ctx.defender);
    const isProne = ctx.defender.statuses?.has('prone') ?? false;
    if (!isProne) return afterFatigue;
    const grades     = CONFIG.MYTHRAS?.difficultyGrades ?? {};
    const gradeOrder = ['veryEasy','easy','standard','hard','formidable','herculean','hopeless'];
    // Prone floor is Formidable (index 4). Take worst of fatigue result and prone result.
    const formidableDef = grades['formidable'];
    if (!formidableDef || formidableDef.multiplier === null) return afterFatigue;
    const proneResult = Math.max(0, Math.ceil(raw * formidableDef.multiplier));
    return Math.min(afterFatigue, proneResult);
  }

  // -------------------------------------------------------------------------
  // STEP 8-13 — Full exchange resolution
  //
  //  8.  Roll attacker d100 and defender d100 (or use 'none' for no defence)
  //  9.  Determine outcomes (critical/success/failure/fumble)
  // 10.  Apply differential table → seWinner, seCount (+ surpriseBonus)
  // 11.  Open SE selection dialog for the winner (player/GM always chooses)
  // 12.  Roll damage, apply parry reduction, apply armour, compute wound level
  // 13.  Update actor HP, apply conditions, post resolution chat card
  // -------------------------------------------------------------------------

  static async _afterDefenceResolved(ctx) {
    const { attacker, defender } = ctx;

    // Defender spends 1 AP for a reactive action (parry/evade/acrobatics).
    // Don't Defend ('none') costs nothing. Surprised cannot react — no AP spent.
    if (ctx.defenceType !== 'none' && !ctx.defenderSurprised) {
      await CombatEngine._spendActionPoint(defender);
    }

    // ── Step 8: Apply prone from evasion ────────────────────────────────────
    if (ctx.defenceType === 'evade' || ctx.defenceType === 'acrobatics') {
      let applyProne = ctx.willBeProne ?? false;
      for (const hook of (CONFIG.MYTHRAS?.evasionHooks ?? [])) {
        const result = hook(ctx, applyProne);
        if (result === false) { applyProne = false; break; }
      }
      if (applyProne) await CombatEngine._applyProneToDefender(defender);
    }

    // ── Step 9: Roll attacker d100 ───────────────────────────────────────────
    const attackRoll = new Roll('1d100');
    await attackRoll.evaluate();
    ctx.attackRoll    = attackRoll;
    ctx.attackResult  = attackRoll.total;
    ctx.attackOutcome = CombatEngine._determineOutcome(ctx.attackResult, ctx.attackerSkillTotal);

    if (ctx.attackOutcome === 'fumble' && ctx.attackerStyle && !ctx.attackerStyle.system.fumbledLastSession) {
      await ctx.attackerStyle.update({ 'system.fumbledLastSession': true });
    }

    // ── Step 9b: Roll defender d100 ─────────────────────────────────────────
    if (ctx.defenceType === 'none') {
      ctx.defenceRoll    = null;
      ctx.defenceResult  = null;
      ctx.defenceOutcome = 'none';
    } else {
      const defenceRoll = new Roll('1d100');
      await defenceRoll.evaluate();
      ctx.defenceRoll    = defenceRoll;
      ctx.defenceResult  = defenceRoll.total;
      ctx.defenceOutcome = CombatEngine._determineOutcome(ctx.defenceResult, ctx.defenderSkillTotal);
    }

    // ── Step 10: Differential table ──────────────────────────────────────────
    const differential = CombatEngine.resolveDifferential(ctx.attackOutcome, ctx.defenceOutcome);
    ctx.seWinner = differential.seWinner;
    ctx.seCount  = differential.seCount;

    // Surprise bonus
    if (ctx.defenderSurprised && ctx.bonusSpecialEffects.includes('surpriseBonus')) {
      if (ctx.seWinner === 'attacker') {
        ctx.seCount += 1;
      } else if (ctx.seWinner === 'none' &&
                 (ctx.attackOutcome === 'critical' || ctx.attackOutcome === 'success')) {
        ctx.seWinner = 'attacker';
        ctx.seCount  = 1;
      }
    }

    // ── Step 11a: Post outcome card FIRST (before SE dialog) ─────────────────
    // Full-auto consolidated mode: suppress per-target cards; the consolidated
    // card (_consolidatedChatMsg) is updated after all exchanges complete.
    const isFullAutoConsolidated = !!(ctx._consolidatedChatMsg);
    const chatMsg = isFullAutoConsolidated ? null : await CombatEngine._postOutcomeCard(ctx);
    ctx.chatMessageId = chatMsg?.id ?? null;

    // ── Step 11b: Special Effect selection ───────────────────────────────────
    // Full-auto: SEs are suppressed on targets 2+ (rules p.50 — only the first
    // hit of the first target in a burst or full-auto spray can benefit from SEs).
    if (ctx.seCount > 0 && ctx.seWinner !== 'none' && !ctx._fullAutoSuppressSEs) {
      const { SpecialEffectDialog } = await import('./SpecialEffectDialog.js');
      const chosen = await SpecialEffectDialog.show(ctx);
      ctx.chosenSpecialEffects = chosen ?? [];
      if (chatMsg) await CombatEngine._updateCardWithSEs(chatMsg, ctx);
    }

    // ── Step 11c: Prepare Counter intercept ──────────────────────────────────
    // If the defender has an active Prepare Counter flag watching for one of
    // the attacker's chosen SEs, strip that SE and fire the counter instead.
    // Any remaining SEs the attacker won still resolve normally below.
    if (ctx.chosenSpecialEffects.length > 0) {
      const NS      = 'mythras-imperative';
      const pcFlag  = defender?.getFlag(NS, 'prepareCounter') ?? null;
      if (pcFlag && pcFlag.watchedSE && pcFlag.attackerActorId === attacker?.id) {
        const matchIdx = ctx.chosenSpecialEffects.indexOf(pcFlag.watchedSE);
        if (matchIdx !== -1) {
          // Strip the matched SE so the dispatcher never sees it
          ctx.chosenSpecialEffects = [
            ...ctx.chosenSpecialEffects.slice(0, matchIdx),
            ...ctx.chosenSpecialEffects.slice(matchIdx + 1)
          ];
          // Fire Phase 2 — posts counter card, shows substitute picker, clears flag
          await CombatEngine._triggerPrepareCounter(ctx, pcFlag.watchedSE);
        }
      }
    }

    // ── Step 12: Damage ──────────────────────────────────────────────────────
    const attackerScored = ctx.attackOutcome === 'critical' || ctx.attackOutcome === 'success';
    // Full-auto consolidated exchanges always resolve damage automatically —
    // there are no per-target buttons on the consolidated card to click.
    const isFullAutoConsolidatedDamage = attackerScored && ctx._consolidatedChatMsg;
    if (isFullAutoConsolidatedDamage) {
      // Always burst-type damage for full-auto (isBurstFire is set true per target)
      await CombatEngine._resolveBurstDamage(ctx, null);  // null: no per-target card
    } else if (attackerScored && CombatEngine.automationLevel === 'full') {
      if (ctx.isBurstFire) {
        await CombatEngine._resolveBurstDamage(ctx, chatMsg);
      } else {
        await CombatEngine._resolveFullAutoDamage(ctx, chatMsg);
      }
    }
    // ── attackerScored immediate SEs ─────────────────────────────────────────
    // 'attackerScored'-phase SEs don't depend on damage and must not wait for
    // the Roll Damage button in semi-auto mode. Fire regardless of automation
    // level. Registry-driven: adding a new SE with phase:'attackerScored' is
    // automatically picked up here.
    if (attackerScored && ctx.chosenSpecialEffects.length > 0) {
      const registry = CONFIG.MYTHRAS.specialEffects;
      const seen     = new Set();
      for (const id of ctx.chosenSpecialEffects) {
        if (seen.has(id)) continue;
        seen.add(id);
        const def = registry.find(e => e.id === id);
        if (!def || def.phase !== 'attackerScored' || !def.resolver) continue;
        await CombatEngine[def.resolver](ctx);
      }
    }
    // ── No-damage path: fire 'opposed'-phase SEs immediately ─────────────────
    // When the attacker did NOT score, the Roll Damage button never appears, so
    // any 'opposed'-phase SEs (defender-won or fumble SEs) must fire right here.
    // hasOpposedSE is derived from the registry — it can never drift out of sync.
    if (!attackerScored && ctx.chosenSpecialEffects.length > 0) {
      const registry    = CONFIG.MYTHRAS.specialEffects;
      const hasOpposedSE = ctx.chosenSpecialEffects.some(
        id => registry.find(e => e.id === id)?.phase === 'opposed'
      );
      if (hasOpposedSE) {
        await CombatEngine._resolveOpposedSEs(ctx, 0);
      }
    }
  }

  // -------------------------------------------------------------------------
  // _postOutcomeCard — posts the initial roll result card
  // -------------------------------------------------------------------------

  static async _postOutcomeCard(ctx) {
    const { attacker, defender, weapon } = ctx;

    const outcomeLabel = {
      critical: game.i18n.localize('MYTHRAS.OutcomeCritical'),
      success:  game.i18n.localize('MYTHRAS.OutcomeSuccess'),
      failure:  game.i18n.localize('MYTHRAS.OutcomeFailure'),
      fumble:   game.i18n.localize('MYTHRAS.OutcomeFumble'),
      none:     game.i18n.localize('MYTHRAS.OutcomeFailure')
    };

    const defenceTypeLabel = {
      parry:      `Parry \u2014 ${ctx.defenceWeapon?.name ?? 'weapon'}`,
      evade:      'Evade',
      acrobatics: 'Acrobatics',
      none:       "Don't Defend"
    };

    const pills = [
      ctx.isCharge          ? '<span class="mi-card-pill">Charge</span>'                        : '',
      ctx.isFullAuto        ? '<span class="mi-card-pill">Full Auto</span>'                     : (ctx.isBurstFire ? '<span class="mi-card-pill">Burst Fire</span>' : ''),
      ctx.defenderSurprised ? '<span class="mi-card-pill mi-card-pill--alert">Surprised</span>' : '',
      ctx.difficulty !== 'standard' ? `<span class="mi-card-pill">${ctx.difficulty}</span>`     : '',
      ctx.willBeProne       ? '<span class="mi-card-pill mi-card-pill--alert">Prone</span>'     : ''
    ].filter(Boolean).join('');

    const dmMod      = attacker.system.attributes?.damageModifier ?? '';
    const applyMod   = weapon.system.damageModApplies ?? true;
    // Charge steps DM up one category; the button carries the already-stepped formula
    const effectiveDM1 = (ctx.isCharge && applyMod)
      ? CombatEngine._stepUpDamageModifier(dmMod) : dmMod;
    const dmgFormula = (applyMod && effectiveDM1 && effectiveDM1 !== '+0' && effectiveDM1 !== '0')
      ? `${weapon.system.damage}${effectiveDM1}` : weapon.system.damage;

    const attackerScored = ctx.attackOutcome === 'critical' || ctx.attackOutcome === 'success';
    const isSemi = CombatEngine.automationLevel === 'semi';

    // Semi-Auto: show roll buttons. Full-Auto: engine handles it after this returns.
    // Burst fire: single "Roll Burst Damage" button replaces the normal loc+dmg pair.
    const damageButtons = (attackerScored && isSemi) ? (ctx.isBurstFire ? `
      <div class="mi-manual-actions">
        <button class="mi-btn mi-btn-burst"
          data-attacker-id="${attacker.id}"
          data-defender-id="${defender.id}"
          data-weapon-id="${weapon.id}"
          data-message-id="PENDING">
          <i class="fas fa-burst"></i> Roll Burst Damage (1d3 rounds)
        </button>
      </div>` : `
      <div class="mi-manual-actions">
        <button class="mi-btn mi-btn-loc"
          data-defender-id="${defender.id}"
          data-message-id="PENDING"
          data-choose-location="${ctx.chosenSpecialEffects.includes('chooseLocation')}">
          <i class="fas ${ctx.chosenSpecialEffects.includes('chooseLocation') ? 'fa-bullseye' : ctx.chosenSpecialEffects.includes('marksman') ? 'fa-location-arrow' : 'fa-crosshairs'}"></i> ${ctx.chosenSpecialEffects.includes('chooseLocation') ? 'Choose Location' : ctx.chosenSpecialEffects.includes('marksman') ? 'Roll + Marksman' : 'Roll Hit Location'}
        </button>
        <button class="mi-btn mi-btn-dmg"
          data-formula="${dmgFormula}"
          data-defender-id="${defender.id}"
          data-is-charge="${ctx.isCharge}"
          data-bypass-armour="${ctx.chosenSpecialEffects.includes('bypassArmour')}"
          data-parry-weapon-id="${ctx.defenceWeapon?.id ?? ''}"
          data-parry-style-id="${ctx.defenceStyle?.id ?? ''}"
          data-attacker-id="${attacker.id}"
          data-weapon-id="${weapon.id}"
          data-defence-type="${ctx.defenceType ?? 'none'}"
          data-defence-weapon-name="${ctx.defenceWeapon?.name ?? ''}"
          data-message-id="PENDING">
          <i class="fas fa-dice"></i> Roll Damage
        </button>
      </div>`) : '';

    const content = CombatEngine._buildOutcomeCardContent({
      ctx, pills, outcomeLabel, defenceTypeLabel, damageButtons, seHtml: ''
    });

    const rolls = [ctx.attackRoll, ctx.defenceRoll].filter(Boolean);

    const msg = await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      rolls,
      flags: {
        'mythras-imperative': {
          actorId:          attacker.id,
          defenderId:       defender.id,
          attackerId:       attacker.id,
          weaponId:         weapon.id,
          stage:            'outcome',
          dmgFormula,
          isCharge:           ctx.isCharge,
          isBurstFire:        ctx.isBurstFire ?? false,
          isFullAuto:         ctx.isFullAuto ?? false,
          rangeBand:          ctx.rangeBand ?? null,
          difficulty:         ctx.difficulty ?? 'standard',
          defenceType:        ctx.defenceType,
          defenceWeaponId:    ctx.defenceWeapon?.id ?? null,
          defenceStyleId:     ctx.defenceStyle?.id ?? null,
          chosenSEs:          ctx.chosenSpecialEffects,
          seWinner:           ctx.seWinner,
          attackerStyleId:    ctx.attackerStyle?.id ?? null,
          isRanged:           ctx.isRanged ?? false,
          attackOutcome:      ctx.attackOutcome,
          defenceOutcome:     ctx.defenceOutcome,
          attackResult:       ctx.attackResult,
          attackerSkillTotal: ctx.attackerSkillTotal,
          defenceResult:      ctx.defenceResult,
          defenderSkillTotal: ctx.defenderSkillTotal,
        }
      }
    });

    // Update button data-message-id now that we have the message id
    if (msg && isSemi && attackerScored) {
      const updatedContent = content.replace(/data-message-id="PENDING"/g, `data-message-id="${msg.id}"`);
      await msg.update({ content: updatedContent });
    }

    return msg;
  }

  // -------------------------------------------------------------------------
  // Update card to show chosen SEs
  // -------------------------------------------------------------------------

  static async _updateCardWithSEs(chatMsg, ctx) {
    if (!chatMsg || ctx.chosenSpecialEffects.length === 0) return;
    const winner = ctx.seWinner === 'attacker' ? ctx.attacker.name : ctx.defender.name;
    const seHtml = `
      <div class="mi-card-se-list">
        <span class="mi-card-se-label">${winner} gains:</span>
        ${ctx.chosenSpecialEffects.map(id => {
          const def = (CONFIG.MYTHRAS?.specialEffects ?? []).find(s => s.id === id);
          return `<span class="mi-card-pill mi-card-pill--se">${game.i18n.localize(def?.label ?? id)}</span>`;
        }).join('')}
      </div>`;

    const outcomeLabel = {
      critical: game.i18n.localize('MYTHRAS.OutcomeCritical'),
      success:  game.i18n.localize('MYTHRAS.OutcomeSuccess'),
      failure:  game.i18n.localize('MYTHRAS.OutcomeFailure'),
      fumble:   game.i18n.localize('MYTHRAS.OutcomeFumble'),
      none:     game.i18n.localize('MYTHRAS.OutcomeFailure')
    };
    const defenceTypeLabel = {
      parry: `Parry \u2014 ${ctx.defenceWeapon?.name ?? 'weapon'}`,
      evade: 'Evade', acrobatics: 'Acrobatics', none: "Don't Defend"
    };
    const pills = [
      ctx.isCharge          ? '<span class="mi-card-pill">Charge</span>'                        : '',
      ctx.isFullAuto        ? '<span class="mi-card-pill">Full Auto</span>'                     : (ctx.isBurstFire ? '<span class="mi-card-pill">Burst Fire</span>' : ''),
      ctx.defenderSurprised ? '<span class="mi-card-pill mi-card-pill--alert">Surprised</span>' : '',
      ctx.difficulty !== 'standard' ? `<span class="mi-card-pill">${ctx.difficulty}</span>`     : '',
      ctx.willBeProne       ? '<span class="mi-card-pill mi-card-pill--alert">Prone</span>'     : ''
    ].filter(Boolean).join('');

    const dmMod      = ctx.attacker.system.attributes?.damageModifier ?? '';
    const applyMod   = ctx.weapon.system.damageModApplies ?? true;
    const effectiveDM2 = (ctx.isCharge && applyMod)
      ? CombatEngine._stepUpDamageModifier(dmMod) : dmMod;
    const dmgFormula = (applyMod && effectiveDM2 && effectiveDM2 !== '+0' && effectiveDM2 !== '0')
      ? `${ctx.weapon.system.damage}${effectiveDM2}` : ctx.weapon.system.damage;

    const attackerScored = ctx.attackOutcome === 'critical' || ctx.attackOutcome === 'success';
    const isSemi = CombatEngine.automationLevel === 'semi';

    // Damage Weapon SE: the "location" is the target weapon, not a body part.
    // Attacker wins → defender's parrying weapon. Defender wins → attacker's weapon.
    const hasDamageWeapon = ctx.chosenSpecialEffects.includes('damageWeapon');
    const damageWeaponTarget = hasDamageWeapon
      ? (ctx.seWinner === 'attacker' ? ctx.defenceWeapon : ctx.weapon)
      : null;

    // For Damage Weapon: bypass the normal Roll Hit Location → Roll Damage → Apply Damage
    // flow entirely. A single button rolls the weapon damage formula and fires
    // _resolveDamageWeapon directly via a dedicated class the renderChatMessageHTML
    // hook picks up. The rawDamage is stamped on the button for the handler to read.
    const locButton = hasDamageWeapon
      ? '' // no location button — replaced by the weapon damage button below
      : `<button class="mi-btn mi-btn-loc"
          data-defender-id="${ctx.defender.id}"
          data-message-id="${chatMsg.id}"
          data-choose-location="${ctx.chosenSpecialEffects.includes('chooseLocation')}">
          <i class="fas ${ctx.chosenSpecialEffects.includes('chooseLocation') ? 'fa-bullseye' : ctx.chosenSpecialEffects.includes('marksman') ? 'fa-location-arrow' : 'fa-crosshairs'}"></i> ${ctx.chosenSpecialEffects.includes('chooseLocation') ? 'Choose Location' : ctx.chosenSpecialEffects.includes('marksman') ? 'Roll + Marksman' : 'Roll Hit Location'}
        </button>`;

    const dmgButton = hasDamageWeapon
      ? `<button class="mi-btn mi-btn-dmg-weapon"
          data-formula="${dmgFormula}"
          data-attacker-id="${ctx.attacker.id}"
          data-defender-id="${ctx.defender.id}"
          data-weapon-id="${ctx.weapon.id}"
          data-defence-weapon-id="${ctx.defenceWeapon?.id ?? ''}"
          data-se-winner="${ctx.seWinner}"
          data-message-id="${chatMsg.id}">
          <i class="fas fa-hammer"></i> Roll Weapon Damage — ${damageWeaponTarget?.name ?? 'Weapon'}
        </button>`
      : `<button class="mi-btn mi-btn-dmg"
          data-formula="${dmgFormula}"
          data-defender-id="${ctx.defender.id}"
          data-is-charge="${ctx.isCharge}"
          data-bypass-armour="${ctx.chosenSpecialEffects.includes('bypassArmour')}"
          data-parry-weapon-id="${ctx.defenceWeapon?.id ?? ''}"
          data-parry-style-id="${ctx.defenceStyle?.id ?? ''}"
          data-attacker-id="${ctx.attacker.id}"
          data-weapon-id="${ctx.weapon.id}"
          data-defence-type="${ctx.defenceType ?? 'none'}"
          data-defence-weapon-name="${ctx.defenceWeapon?.name ?? ''}"
          data-message-id="${chatMsg.id}">
          <i class="fas fa-dice"></i> Roll Damage
        </button>`;

    // Burst fire overrides the loc+dmg pair with a single burst button
    const damageButtons = (attackerScored && isSemi) ? (ctx.isBurstFire ? `
      <div class="mi-manual-actions">
        <button class="mi-btn mi-btn-burst"
          data-attacker-id="${ctx.attacker.id}"
          data-defender-id="${ctx.defender.id}"
          data-weapon-id="${ctx.weapon.id}"
          data-message-id="${chatMsg.id}">
          <i class="fas fa-burst"></i> Roll Burst Damage (1d3 rounds)
        </button>
      </div>` : `
      <div class="mi-manual-actions">
        ${locButton}
        ${dmgButton}
      </div>`) : '';

    const newContent = CombatEngine._buildOutcomeCardContent({
      ctx, pills, outcomeLabel, defenceTypeLabel, damageButtons, seHtml
    });
    // Update content AND flags together — flags.chosenSEs must reflect the
    // final SE selection so the Apply Damage handler can trigger Bleed/Trip.
    await chatMsg.update({
      content: newContent,
      'flags.mythras-imperative.chosenSEs': ctx.chosenSpecialEffects
    });
  }

  // -------------------------------------------------------------------------
  // Shared card HTML builder
  // -------------------------------------------------------------------------

  static _buildOutcomeCardContent({ ctx, pills, outcomeLabel, defenceTypeLabel, damageButtons, seHtml }) {
    const { attacker, defender, weapon } = ctx;
    return `
      <div class="mi-chat-card mi-chat-card--resolution">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker.name} <span class="mi-card-vs">vs</span> ${defender.name}</span>
          <span class="mi-card-skill">${ctx.attackerStyle?.name ? `${ctx.attackerStyle.name} \u2014 ${weapon.name}` : weapon.name}</span>
        </div>
        <div class="mi-card-body">
          ${pills ? `<div class="mi-card-details">${pills}</div>` : ''}
          <div class="mi-card-rolls">
            <div class="mi-card-roll-row">
              <div class="mi-card-roll-row-top">${attacker.name}</div>
              <div class="mi-card-roll-row-bottom">
                <span class="mi-card-roll-target">${ctx.attackerSkillTotal}%</span>
                <span class="mi-card-roll-result">${ctx.attackResult}</span>
                <span class="mi-outcome ${ctx.attackOutcome}">${outcomeLabel[ctx.attackOutcome]}</span>
              </div>
            </div>
            <div class="mi-card-roll-row mi-card-roll-row--defender">
              <div class="mi-card-roll-row-top">${defender.name} \u2014 ${defenceTypeLabel[ctx.defenceType] ?? 'None'}</div>
              <div class="mi-card-roll-row-bottom">
                <span class="mi-card-roll-target">${ctx.defenderSkillTotal > 0 ? ctx.defenderSkillTotal + '%' : '\u2014'}</span>
                <span class="mi-card-roll-result">${ctx.defenceResult ?? '\u2014'}</span>
                <span class="mi-outcome ${ctx.defenceOutcome ?? 'failure'}">${outcomeLabel[ctx.defenceOutcome ?? 'none']}</span>
              </div>
            </div>
          </div>
          ${seHtml}
          ${damageButtons}
        </div>
      </div>`;
  }

  // -------------------------------------------------------------------------
  // Full Auto — roll hit location and damage, apply to actor, update card
  // -------------------------------------------------------------------------

  static async _resolveFullAutoDamage(ctx, chatMsg) {
    const { attacker, defender, weapon } = ctx;

    // Hit location — Choose Location SE replaces the roll with a picker
    if (ctx.chosenSpecialEffects.includes('chooseLocation')) {
      const picked = await CombatEngine._showLocationPicker(defender, attacker.name, ctx.chatMessageId);
      ctx.hitLocationId    = picked.id;
      ctx.hitLocationLabel = picked.label;
    } else {
      const locResult      = CombatEngine._rollHitLocation(defender);
      ctx.hitLocationId    = locResult.id;
      ctx.hitLocationLabel = locResult.label;
      ctx.hitLocationRoll  = locResult.roll ?? null;
      // Marksman SE — shift the rolled location one step to an adjoining area
      if (ctx.chosenSpecialEffects.includes('marksman')) {
        const shifted = await CombatEngine._resolveMarksman(defender, ctx.hitLocationId, ctx.hitLocationLabel, attacker.name);
        ctx.hitLocationId    = shifted.id;
        ctx.hitLocationLabel = shifted.label;
      }
      // Ranged Marksman style trait — same effect as the SE, triggers automatically
      // Rules p.34: "shift a random Hit Location roll to an adjoining body location"
      // Does not stack with the Marksman SE — only fires if SE was not already chosen.
      else if (ctx.isRanged && ctx.attackerTraits?.includes('rangedMarksman')) {
        const shifted = await CombatEngine._resolveMarksman(defender, ctx.hitLocationId, ctx.hitLocationLabel, attacker.name);
        ctx.hitLocationId    = shifted.id;
        ctx.hitLocationLabel = shifted.label;
      }
    }

    // Damage formula
    const dmMod      = attacker.system.attributes?.damageModifier ?? '';
    const applyMod   = weapon.system.damageModApplies ?? true;
    // Charge: step DM up one category before building the formula
    const effectiveDM = (ctx.isCharge && applyMod)
      ? CombatEngine._stepUpDamageModifier(dmMod)
      : dmMod;
    let dmgFormula = (applyMod && effectiveDM && effectiveDM !== '+0' && effectiveDM !== '0')
      ? `${weapon.system.damage}${effectiveDM}` : weapon.system.damage;

    // Impale SE — roll damage twice, attacker picks best (rules p.44)
    const impaleChosen = ctx.chosenSpecialEffects.includes('impale');
    const damageRoll   = new Roll(dmgFormula);
    await damageRoll.evaluate();
    let rawDamage = damageRoll.total;

    if (impaleChosen) {
      const damageRoll2 = new Roll(dmgFormula);
      await damageRoll2.evaluate();
      if (damageRoll2.total > rawDamage) {
        rawDamage = damageRoll2.total;
        ctx.damageRoll  = damageRoll2;
        ctx.damageRoll2 = damageRoll;
      } else {
        ctx.damageRoll  = damageRoll;
        ctx.damageRoll2 = damageRoll2;
      }
      ctx.impaleRolls = [damageRoll.total, damageRoll2.total];
    } else {
      ctx.damageRoll = damageRoll;
    }

    // Maximise Damage
    const maximiseCount = ctx.chosenSpecialEffects.filter(s => s === 'maximiseDamage').length;
    if (maximiseCount > 0 && ctx.attackOutcome === 'critical') {
      const dieTerms = damageRoll.terms.filter(t => t.faces);
      for (let i = 0; i < Math.min(maximiseCount, dieTerms.length); i++) {
        rawDamage += (dieTerms[i].faces - dieTerms[i].total);
      }
    }
    // Long range halving (rules p.49): at Long range, damage is halved (round up).
    // Applied after Maximise Damage but before parry and armour reduction.
    if (ctx.isRanged && ctx.rangeBand === 'long') {
      rawDamage = Math.ceil(rawDamage / 2);
    }
    ctx.rawDamage = rawDamage;

    // Parry reduction (p.40): only applies when the defender succeeded or critically succeeded.
    // A failed or fumbled parry does not reduce damage — the blow lands in full.
    const defenderParrySucceeded = ctx.defenceType === 'parry' &&
      (ctx.defenceOutcome === 'success' || ctx.defenceOutcome === 'critical');
    const circumventParry = ctx.chosenSpecialEffects.includes('circumventParry');
    let damageAfterParry  = rawDamage;
    if (defenderParrySucceeded && ctx.defenceWeapon && !circumventParry) {
      if (ctx.chosenSpecialEffects.includes('enhanceParry')) {
        ctx.parryReduction = 'full'; damageAfterParry = 0;
      } else {
        const pr = CombatEngine.resolveParryReduction(weapon, ctx.defenceWeapon, ctx.defenceStyle, ctx);
        ctx.parryReduction = pr.label;
        damageAfterParry   = Math.ceil(rawDamage * pr.multiplier);
      }
    } else {
      ctx.parryReduction = 'none';
    }
    ctx.damageAfterParry = damageAfterParry;

    // Armour
    const bypassArmour    = ctx.chosenSpecialEffects.includes('bypassArmour');
    const sunderChosen    = ctx.chosenSpecialEffects.includes('sunder');
    const armourPoints    = bypassArmour ? 0 : CombatEngine._getArmourAt(defender, ctx.hitLocationId);

    if (sunderChosen && !bypassArmour && armourPoints > 0) {
      // ── Sunder (rules p.46) ──────────────────────────────────────────────
      // Damage after parry hits the armour AP first.
      // Surplus beyond armour AP reduces the armour's AP permanently.
      // Remaining damage after armour is zeroed carries over to hit HP.
      ctx.sunderResult = await CombatEngine._applySunder(
        defender, ctx.hitLocationId, damageAfterParry, weapon
      );
      ctx.damageAfterArmour = ctx.sunderResult.carryOver;
      await CombatEngine._applyDamage(ctx, ctx.sunderResult.carryOver);
    } else {
      const finalDamage     = Math.max(0, damageAfterParry - armourPoints);
      ctx.damageAfterArmour = finalDamage;
      await CombatEngine._applyDamage(ctx, finalDamage);
    }

    if (chatMsg) await CombatEngine._updateCardWithDamage(chatMsg, ctx);
  }

  // -------------------------------------------------------------------------
  // Burst fire damage resolution (Full Auto path)
  // Rules p.50: single attack roll at Hard difficulty. On hit, roll 1d3 to
  // determine how many of the burst rounds struck. Roll separate hit location
  // and damage for each round that hits. SEs only apply to the first round.
  // -------------------------------------------------------------------------

  static async _resolveBurstDamage(ctx, chatMsg) {
    const { attacker, defender, weapon } = ctx;

    // Roll to determine how many rounds struck.
    // Burst fire: always 1d3 (burstSize is fixed at 3).
    // Full-auto: 1d[roundsPerTarget] where roundsPerTarget comes from declared
    //            rounds ÷ target count (set in _runFullAutoExchanges).
    const burstDie  = ctx.roundsPerTarget ?? 3;
    const roundsRoll = new Roll(`1d${burstDie}`);
    await roundsRoll.evaluate();
    const roundsHit = roundsRoll.total;

    // Damage formula (no DM for firearms — damageModApplies is false)
    const dmMod    = attacker.system.attributes?.damageModifier ?? '';
    const applyMod = weapon.system.damageModApplies ?? true;
    const dmgFormula = (applyMod && dmMod && dmMod !== '+0' && dmMod !== '0')
      ? `${weapon.system.damage}${dmMod}` : weapon.system.damage;

    const burstResults = [];
    let firstRound = true;

    for (let i = 0; i < roundsHit; i++) {
      // Hit location
      const locResult = CombatEngine._rollHitLocation(defender);
      const hitLocationId    = locResult.id;
      const hitLocationLabel = locResult.label;
      const hitLocationRoll  = locResult.roll ?? null;

      // Damage roll
      let damageRoll = new Roll(dmgFormula);
      await damageRoll.evaluate();
      let rawDamage = damageRoll.total;

      // Long range halving — applies to all burst rounds
      if (ctx.isRanged && ctx.rangeBand === 'long') {
        rawDamage = Math.ceil(rawDamage / 2);
      }

      // Maximise Damage and other SEs — only on first round
      if (firstRound) {
        const maximiseCount = ctx.chosenSpecialEffects.filter(s => s === 'maximiseDamage').length;
        if (maximiseCount > 0 && ctx.attackOutcome === 'critical') {
          const dieTerms = damageRoll.terms.filter(t => t.faces);
          for (let j = 0; j < Math.min(maximiseCount, dieTerms.length); j++) {
            rawDamage += (dieTerms[j].faces - dieTerms[j].total);
          }
        }
      }

      // Parry reduction — only on first round (subsequent rounds bypass parry)
      let damageAfterParry = rawDamage;
      let parryReduction   = 'none';
      if (firstRound) {
        const defenderParrySucceeded = ctx.defenceType === 'parry' &&
          (ctx.defenceOutcome === 'success' || ctx.defenceOutcome === 'critical');
        const circumventParry = ctx.chosenSpecialEffects.includes('circumventParry');
        if (defenderParrySucceeded && ctx.defenceWeapon && !circumventParry) {
          if (ctx.chosenSpecialEffects.includes('enhanceParry')) {
            parryReduction   = 'full';
            damageAfterParry = 0;
          } else {
            const pr = CombatEngine.resolveParryReduction(weapon, ctx.defenceWeapon, ctx.defenceStyle, ctx);
            parryReduction   = pr.label;
            damageAfterParry = Math.ceil(rawDamage * pr.multiplier);
          }
        }
      }

      // Armour — applies to every round
      const bypassArmour = firstRound && ctx.chosenSpecialEffects.includes('bypassArmour');
      const armourPoints = bypassArmour ? 0 : CombatEngine._getArmourAt(defender, hitLocationId);
      const finalDamage  = Math.max(0, damageAfterParry - armourPoints);

      // Apply damage and record wound level
      // Build a minimal per-round ctx for _applyDamage
      const roundCtx = {
        ...ctx,
        hitLocationId,
        hitLocationLabel,
        hitLocationRoll,
        rawDamage,
        damageAfterParry,
        damageAfterArmour: finalDamage,
        parryReduction,
        woundLevel: null,
        damageRoll,
        // Only first round uses SEs
        chosenSpecialEffects: firstRound ? ctx.chosenSpecialEffects : []
      };
      await CombatEngine._applyDamage(roundCtx, finalDamage);

      burstResults.push({
        round:          i + 1,
        hitLocationRoll,
        hitLocationLabel,
        rawDamage,
        parryReduction,
        armourPoints,
        finalDamage,
        woundLevel:     roundCtx.woundLevel,
        damageRoll,
        isFirstRound:   firstRound
      });

      // After first round, SEs (including opposed rolls) only apply once —
      // fire them now before continuing the loop.
      if (firstRound && ctx.chosenSpecialEffects.length > 0 && finalDamage > 0) {
        ctx.rawDamage         = rawDamage;
        ctx.hitLocationId     = hitLocationId;
        ctx.hitLocationLabel  = hitLocationLabel;
        await CombatEngine._resolveOpposedSEs(roundCtx, finalDamage);
      }

      firstRound = false;
    }

    // Store burst results on ctx for card rendering
    ctx.burstResults  = burstResults;
    ctx.roundsHit     = roundsHit;
    ctx.roundsRoll    = roundsRoll;

    if (chatMsg) await CombatEngine._updateCardWithBurstDamage(chatMsg, ctx);
  }

  // -------------------------------------------------------------------------
  // Full Auto — placeholder card (posted immediately when the exchange starts)
  // -------------------------------------------------------------------------

  static _buildFullAutoPlaceholderCard({ attacker, weapon, targetNames, targetCount,
    declaredRounds, roundsPerTarget, spareRounds }) {
    return `
      <div class="mi-chat-card mi-chat-card--resolution">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker.name}</span>
          <span class="mi-card-skill">${weapon.name} — Full Auto</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-card-details">
            <span class="mi-card-pill">Full Auto</span>
          </div>
          <div class="mi-full-auto-spray-line">
            <i class="fas fa-crosshairs"></i>
            <span>${declaredRounds} rounds at ${targetCount} target${targetCount === 1 ? '' : 's'}
              — ${roundsPerTarget} per target${spareRounds > 0 ? `, ${spareRounds} lost` : ''}</span>
          </div>
          <div class="mi-full-auto-targets">${targetNames}</div>
          <div class="mi-full-auto-pending">
            <i class="fas fa-spinner fa-spin"></i> Awaiting defender responses…
          </div>
        </div>
      </div>`;
  }

  // -------------------------------------------------------------------------
  // Full Auto — consolidated card (replaces placeholder after all exchanges)
  // -------------------------------------------------------------------------

  static async _updateFullAutoConsolidatedCard(chatMsg, confirmedCtx, {
    targets, declaredRounds, roundsPerTarget, spareRounds, exchangeResults
  }) {
    const { attacker, weapon } = confirmedCtx;
    const targetCount = targets.length;

    const outcomeLabel = {
      critical: game.i18n.localize('MYTHRAS.OutcomeCritical'),
      success:  game.i18n.localize('MYTHRAS.OutcomeSuccess'),
      failure:  game.i18n.localize('MYTHRAS.OutcomeFailure'),
      fumble:   game.i18n.localize('MYTHRAS.OutcomeFumble'),
      none:     game.i18n.localize('MYTHRAS.OutcomeFailure')
    };

    // SE row — only for first target if any SEs were chosen
    const firstResult = exchangeResults[0] ?? null;
    const seHtml = (firstResult?.chosenSEs?.length > 0) ? `
      <div class="mi-card-se-list">
        <span class="mi-card-se-label">${firstResult.seWinner === 'attacker' ? attacker.name : firstResult.defenderName} gains (first target only):</span>
        ${firstResult.chosenSEs.map(id => {
          const def = (CONFIG.MYTHRAS?.specialEffects ?? []).find(s => s.id === id);
          return `<span class="mi-card-pill mi-card-pill--se">${game.i18n.localize(def?.label ?? id)}</span>`;
        }).join('')}
      </div>` : '';

    // One section per target — uses the standard roll-row classes
    const targetSections = exchangeResults.map((r, idx) => {
      const attackHit = r.attackOutcome === 'critical' || r.attackOutcome === 'success';

      const defenceTypeLabel = r.defenceType === 'none' ? "Don’t Defend"
        : r.defenceType === 'parry' ? `Parry — ${r.defenceWeapon ?? 'weapon'}`
        : r.defenceType === 'evade' ? 'Evade'
        : r.defenceType ?? '—';

      // Roll rows — attacker and defender
      const rollRows = `
        <div class="mi-card-rolls">
          <div class="mi-card-roll-row">
            <div class="mi-card-roll-row-top">${attacker.name}</div>
            <div class="mi-card-roll-row-bottom">
              <span class="mi-card-roll-result">${r.attackRoll ?? '—'}</span>
              <span class="mi-outcome ${r.attackOutcome}">${outcomeLabel[r.attackOutcome] ?? r.attackOutcome}</span>
            </div>
          </div>
          <div class="mi-card-roll-row mi-card-roll-row--defender">
            <div class="mi-card-roll-row-top">${r.defenderName} — ${defenceTypeLabel}</div>
            <div class="mi-card-roll-row-bottom">
              <span class="mi-card-roll-result">${r.defenceRoll ?? '—'}</span>
              <span class="mi-outcome ${r.defenceOutcome ?? 'none'}">${outcomeLabel[r.defenceOutcome ?? 'none'] ?? '—'}</span>
            </div>
          </div>
        </div>`;

      // Rounds hit detail
      let roundsDetail = '';
      if (attackHit) {
        if (r.roundsHit > 0) {
          const roundRows = (r.burstResults ?? []).map(br => {
            const woundClass = br.woundLevel === 'major'   ? 'mi-wound-major'
              : br.woundLevel === 'serious' ? 'mi-wound-serious'
              : br.woundLevel === 'minor'   ? 'mi-wound-minor' : '';
            return `
              <div class="mi-card-burst-round">
                <div class="mi-card-location-row">
                  ${br.hitLocationRoll != null ? `<span class="mi-card-location-die">1d20: <strong>${br.hitLocationRoll}</strong></span>` : ''}
                  <span class="mi-card-location-label">${br.hitLocationLabel}</span>
                  <span class="mi-card-damage-num">${br.rawDamage} dmg</span>
                  ${br.finalDamage > 0
                    ? `<span class="mi-card-damage-final">→ ${br.finalDamage}</span>`
                    : '<span class="mi-card-note">Blocked</span>'}
                </div>
                ${br.woundLevel && br.woundLevel !== 'none' ? `
                <div class="mi-outcome-row">
                  <span class="mi-outcome ${woundClass}">${br.woundLevel.charAt(0).toUpperCase() + br.woundLevel.slice(1)} Wound — ${br.hitLocationLabel}</span>
                </div>` : ''}
              </div>`;
          }).join('');

          roundsDetail = `
            <div class="mi-card-burst-header">
              <span class="mi-card-damage-num">${r.roundsHit} of ${r.roundsAllocated} rounds hit</span>
              <span class="mi-card-note">(1d${r.roundsAllocated}: ${r.roundsRollVal})</span>
            </div>
            ${roundRows}`;
        } else {
          roundsDetail = `<div class="mi-card-note" style="margin-top:4px">All rounds missed.</div>`;
        }
      }

      return `
        <div class="mi-full-auto-target-section${idx === 0 ? ' mi-full-auto-target-section--first' : ''}">
          <div class="mi-full-auto-target-header">
            <span class="mi-full-auto-target-name">${r.defenderName}</span>
          </div>
          ${rollRows}
          ${attackHit ? roundsDetail : ''}
        </div>`;
    }).join('');

    const content = `
      <div class="mi-chat-card mi-chat-card--resolution">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker.name}</span>
          <span class="mi-card-skill">${weapon.name} — Full Auto</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-card-details">
            <span class="mi-card-pill">Full Auto</span>
            <span class="mi-card-pill">${declaredRounds} rounds — ${roundsPerTarget} per target${spareRounds > 0 ? `, ${spareRounds} lost` : ''}</span>
          </div>
          ${seHtml}
          <div class="mi-full-auto-targets-list">
            ${targetSections}
          </div>
        </div>
      </div>`;

    await chatMsg.update({ content });
  }

  // -------------------------------------------------------------------------
  // Update card with burst damage result
  // -------------------------------------------------------------------------

  static async _updateCardWithBurstDamage(chatMsg, ctx) {
    const { attacker, defender, weapon } = ctx;

    const seHtml = ctx.chosenSpecialEffects.length > 0 ? `
      <div class="mi-card-se-list">
        <span class="mi-card-se-label">${ctx.seWinner === 'attacker' ? attacker.name : defender.name} gains (${ctx.isFullAuto ? 'first target only' : 'first round only'}):</span>
        ${ctx.chosenSpecialEffects.map(id => {
          const def = (CONFIG.MYTHRAS?.specialEffects ?? []).find(s => s.id === id);
          return `<span class="mi-card-pill mi-card-pill--se">${game.i18n.localize(def?.label ?? id)}</span>`;
        }).join('')}
      </div>` : '';

    const outcomeLabel = {
      critical: game.i18n.localize('MYTHRAS.OutcomeCritical'),
      success:  game.i18n.localize('MYTHRAS.OutcomeSuccess'),
      failure:  game.i18n.localize('MYTHRAS.OutcomeFailure'),
      fumble:   game.i18n.localize('MYTHRAS.OutcomeFumble'),
      none:     game.i18n.localize('MYTHRAS.OutcomeFailure')
    };
    const defenceTypeLabel = {
      parry: `Parry — ${ctx.defenceWeapon?.name ?? 'weapon'}`,
      evade: 'Evade', acrobatics: 'Acrobatics', none: "Don't Defend"
    };
    const pills = [
      ctx.isFullAuto        ? '<span class="mi-card-pill">Full Auto</span>'                     : (ctx.isBurstFire ? '<span class="mi-card-pill">Burst Fire</span>' : ''),
      ctx.defenderSurprised ? '<span class="mi-card-pill mi-card-pill--alert">Surprised</span>' : '',
      ctx.difficulty !== 'standard' ? `<span class="mi-card-pill">${ctx.difficulty}</span>`     : '',
      ctx.willBeProne       ? '<span class="mi-card-pill mi-card-pill--alert">Prone</span>'     : ''
    ].filter(Boolean).join('');

    const longRangeNote = (ctx.isRanged && ctx.rangeBand === 'long')
      ? '<span class="mi-card-pill mi-card-pill--range">Long Range — damage halved</span>' : '';

    // Burst summary header
    const burstHeader = `
      <div class="mi-card-burst-header">
        <span class="mi-card-damage-num">${ctx.isFullAuto ? 'Full Auto' : 'Burst'}: ${ctx.roundsHit} of 3 rounds hit</span>
        <span class="mi-card-note">(1d3: ${ctx.roundsRoll.total})</span>
        ${longRangeNote}
      </div>`;

    // One row per round that hit
    const roundRows = (ctx.burstResults ?? []).map(r => {
      const woundClass = r.woundLevel === 'major'   ? 'mi-wound-major'
        : r.woundLevel === 'serious' ? 'mi-wound-serious'
        : r.woundLevel === 'minor'   ? 'mi-wound-minor' : '';
      const parryNote = r.isFirstRound && r.parryReduction === 'full'   ? ' (fully blocked)'
        : r.isFirstRound && r.parryReduction === 'half' ? ' (half damage)'
        : '';
      return `
        <div class="mi-card-burst-round">
          <div class="mi-card-location-row">
            ${r.hitLocationRoll != null ? `<span class="mi-card-location-die">1d20: <strong>${r.hitLocationRoll}</strong></span>` : ''}
            <span class="mi-card-location-label">${r.hitLocationLabel}</span>
            <span class="mi-card-damage-num">${r.rawDamage} dmg${parryNote}</span>
            ${r.finalDamage > 0
              ? `<span class="mi-card-damage-final">→ ${r.finalDamage} to ${r.hitLocationLabel}</span>`
              : '<span class="mi-card-note">Blocked</span>'}
          </div>
          ${r.woundLevel && r.woundLevel !== 'none' ? `
          <div class="mi-outcome-row">
            <span class="mi-outcome ${woundClass}">${r.woundLevel.charAt(0).toUpperCase() + r.woundLevel.slice(1)} Wound — ${r.hitLocationLabel}</span>
          </div>` : ''}
        </div>`;
    }).join('');

    const damageSection = burstHeader + roundRows;

    const newContent = CombatEngine._buildOutcomeCardContent({
      ctx, pills, outcomeLabel, defenceTypeLabel,
      damageButtons: damageSection,
      seHtml
    });
    await chatMsg.update({ content: newContent });
  }

  // -------------------------------------------------------------------------
  // Update card with damage result (Full Auto)
  // -------------------------------------------------------------------------

  static async _updateCardWithDamage(chatMsg, ctx) {
    const { attacker, defender, weapon } = ctx;

    const seHtml = ctx.chosenSpecialEffects.length > 0 ? `
      <div class="mi-card-se-list">
        <span class="mi-card-se-label">${ctx.seWinner === 'attacker' ? attacker.name : defender.name} gains:</span>
        ${ctx.chosenSpecialEffects.map(id => {
          const def = (CONFIG.MYTHRAS?.specialEffects ?? []).find(s => s.id === id);
          return `<span class="mi-card-pill mi-card-pill--se">${game.i18n.localize(def?.label ?? id)}</span>`;
        }).join('')}
      </div>` : '';

    const parryNote = ctx.parryReduction === 'full' ? 'fully blocked'
      : ctx.parryReduction === 'half' ? 'half damage'
      : '';
    const woundClass = ctx.woundLevel === 'major'   ? 'mi-wound-major'
      : ctx.woundLevel === 'serious' ? 'mi-wound-serious'
      : ctx.woundLevel === 'minor'   ? 'mi-wound-minor' : '';

    // Hit location row — shows d20 roll and location name.
    // hitLocationRoll is null when Choose Location SE was used (no roll).
    const locationSection = ctx.hitLocationLabel ? `
      <div class="mi-card-location-row">
        ${ctx.hitLocationRoll != null ? `<span class="mi-card-location-die">1d20: <strong>${ctx.hitLocationRoll}</strong></span>` : `<span class="mi-card-location-die">Choose Location</span>`}
        <span class="mi-card-location-label">${ctx.hitLocationLabel}</span>
      </div>` : '';

    const impaleSection = ctx.impaleRolls ? (() => {
      const [r1, r2] = ctx.impaleRolls;
      const winner   = ctx.rawDamage; // rawDamage is already the best
      return `
        <div class="mi-card-impale-rolls">
          <span class="mi-card-note">Impale — two rolls, best used:</span>
          <span class="mi-card-impale-die ${r1 >= r2 ? 'mi-impale-winner' : 'mi-impale-loser'}">${r1}</span>
          <span class="mi-card-note">vs</span>
          <span class="mi-card-impale-die ${r2 > r1 ? 'mi-impale-winner' : 'mi-impale-loser'}">${r2}</span>
        </div>`;
    })() : '';
    const longRangeNote = (ctx.isRanged && ctx.rangeBand === 'long')
      ? '<span class="mi-card-pill mi-card-pill--range">Long Range — damage halved</span>' : '';
    const damageSection = ctx.rawDamage > 0 ? `
      <div class="mi-card-damage-row">
        <div class="mi-card-damage-header">
          <span class="mi-card-damage-num">${ctx.rawDamage} damage</span>
          ${CombatEngine._diceBreakdown(ctx.damageRoll)}
          ${longRangeNote}
          ${parryNote ? `<span class="mi-card-note">(${parryNote})</span>` : ''}
          ${ctx.damageAfterArmour > 0 ? `<span class="mi-card-damage-final">\u2192 ${ctx.damageAfterArmour} to ${ctx.hitLocationLabel}</span>` : '<span class="mi-card-note">Blocked</span>'}
        </div>
        ${impaleSection}
        ${ctx.sunderResult ? `
        <div class="mi-outcome-row">
          <span class="mi-outcome mi-wound-${ctx.sunderResult.carryOver > 0 ? 'serious' : 'minor'}">
            <i class="fas fa-shield-alt"></i>
            Sunder — ${ctx.sunderResult.affectedNames.join(', ')}
            ${ctx.sunderResult.carryOver > 0
              ? ` · ${ctx.sunderResult.carryOver} damage carries over to ${ctx.hitLocationLabel}`
              : ' · Armour absorbed all damage'}
          </span>
        </div>` : ''}
        ${ctx.woundLevel && ctx.woundLevel !== 'none' ? `
        <div class="mi-outcome-row">
          <span class="mi-outcome ${woundClass}">${ctx.woundLevel.charAt(0).toUpperCase() + ctx.woundLevel.slice(1)} Wound — ${ctx.hitLocationLabel}</span>

        </div>` : ''}
      </div>` : '';

    const outcomeLabel = {
      critical: game.i18n.localize('MYTHRAS.OutcomeCritical'),
      success:  game.i18n.localize('MYTHRAS.OutcomeSuccess'),
      failure:  game.i18n.localize('MYTHRAS.OutcomeFailure'),
      fumble:   game.i18n.localize('MYTHRAS.OutcomeFumble'),
      none:     game.i18n.localize('MYTHRAS.OutcomeFailure')
    };
    const defenceTypeLabel = {
      parry: `Parry \u2014 ${ctx.defenceWeapon?.name ?? 'weapon'}`,
      evade: 'Evade', acrobatics: 'Acrobatics', none: "Don't Defend"
    };
    const pills = [
      ctx.isCharge          ? '<span class="mi-card-pill">Charge</span>'                        : '',
      ctx.isFullAuto        ? '<span class="mi-card-pill">Full Auto</span>'                     : (ctx.isBurstFire ? '<span class="mi-card-pill">Burst Fire</span>' : ''),
      ctx.defenderSurprised ? '<span class="mi-card-pill mi-card-pill--alert">Surprised</span>' : '',
      ctx.difficulty !== 'standard' ? `<span class="mi-card-pill">${ctx.difficulty}</span>`     : '',
      ctx.willBeProne       ? '<span class="mi-card-pill mi-card-pill--alert">Prone</span>'     : ''
    ].filter(Boolean).join('');

    const newContent = CombatEngine._buildOutcomeCardContent({
      ctx, pills, outcomeLabel, defenceTypeLabel,
      damageButtons: locationSection + damageSection,
      seHtml
    });
    await chatMsg.update({ content: newContent });
  }

    // -------------------------------------------------------------------------
  // _rollHitLocation — rolls d20 and maps to a hit location item
  // -------------------------------------------------------------------------

  static _rollHitLocation(defender) {
    const locations = Array.from(defender.items)
      .filter(i => i.type === 'hit-location')
      .sort((a, b) => (a.system.rangeMin ?? 0) - (b.system.rangeMin ?? 0));

    const roll = Math.ceil(Math.random() * 20);

    if (locations.length > 0) {
      const loc = locations.find(l =>
        roll >= (l.system.rangeMin ?? 1) && roll <= (l.system.rangeMax ?? 20)
      ) ?? locations[locations.length - 1];
      return { id: loc.id, label: loc.name, roll };
    }

    const table = CONFIG.MYTHRAS?.hitLocations?.humanoid ?? [];
    const entry = table.find(l => roll >= l.range[0] && roll <= l.range[1]) ?? table[table.length - 1];
    return { id: null, label: game.i18n.localize(entry?.label ?? 'Unknown'), roll };
  }

  // -------------------------------------------------------------------------
  // _showLocationPicker — Choose Location SE dialog
  //
  // Presents all of the defender's hit-location items as a radio list.
  // Resolves with { id, label } matching _rollHitLocation's return shape
  // so all downstream code (damage, wound consequences) is unaffected.
  // Called by Full Auto when chooseLocation is in chosenSpecialEffects,
  // and by the Semi-Auto Roll Hit Location handler.
  // -------------------------------------------------------------------------

  static async _showLocationPicker(defender, attackerName = '', lastCardId = null) {
    await CombatEngine._waitForCard(lastCardId);
    return new Promise(resolve => {
      const locations = Array.from(defender.items)
        .filter(i => i.type === 'hit-location')
        .sort((a, b) => (a.system.rangeMin ?? 0) - (b.system.rangeMin ?? 0));

      if (locations.length === 0) {
        // No hit-location items — fall back to rolled result
        resolve(CombatEngine._rollHitLocation(defender));
        return;
      }

      const radios = locations.map((loc, idx) => `
        <label class="mi-loc-picker-option">
          <input type="radio" name="mi-loc" value="${loc.id}" data-label="${loc.name}"
            ${idx === 0 ? 'checked' : ''}>
          <span class="mi-loc-picker-name">${loc.name}</span>
          <span class="mi-loc-picker-range">${loc.system.rangeMin ?? ''}–${loc.system.rangeMax ?? ''}</span>
        </label>`).join('');

      const content = `
        <div class="mi-se-roll-dialog">
          <div class="mi-se-roll-header">
            <span class="mi-se-roll-title">Choose Location</span>
            <span class="mi-se-roll-subtitle">${attackerName || 'Attacker'} → ${defender.name}</span>
          </div>
          <div class="mi-se-roll-body">
            <p class="mi-loc-picker-header">Select the location to strike:</p>
            <div class="mi-loc-picker">${radios}</div>
          </div>
        </div>`;

      new Dialog({
        title: 'Choose Location',
        content,
        buttons: {
          confirm: {
            label: 'Confirm',
            callback: html => {
              const checked = html[0].querySelector('input[name="mi-loc"]:checked');
              if (checked) {
                resolve({ id: checked.value, label: checked.dataset.label });
              } else {
                resolve(CombatEngine._rollHitLocation(defender));
              }
            }
          }
        },
        default: 'confirm',
        classes: ['dialog', 'mi-dialog'],
        close: () => resolve(CombatEngine._rollHitLocation(defender))
      }).render(true);
    });
  }

  // -------------------------------------------------------------------------
  // _resolveMarksman — SE: Marksman (attacker, ranged weapons)
  //
  // Rules p.45: Permits the shooter to move the Hit Location struck by one
  // step, to an immediately adjoining body area.
  //
  // Implementation: sorts the defender's hit-location items by rangeMin
  // (same order as Choose Location), finds the rolled item by ID, then
  // offers the items immediately adjacent by index (±1) as choices.
  // This avoids fragile name-string matching entirely — works regardless
  // of what the GM named the locations.
  //
  // Falls back to CONFIG.MYTHRAS.hitLocationAdjacency name-lookup if the
  // actor has no hit-location items (rare — most placed actors have them).
  //
  // Called AFTER the hit location is rolled but BEFORE damage is applied.
  // Returns { id, label } — same shape as _rollHitLocation so downstream
  // code is unaffected. Original location returned unchanged on any failure.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // _resolveMarksman — SE: Marksman (attacker, ranged weapons)
  //
  // Rules p.45: Permits the shooter to move the Hit Location struck by one
  // step, to an immediately adjoining body area.
  //
  // Adjacency is defined in CONFIG.MYTHRAS.hitLocationAdjacency, keyed by
  // lowercase location name. The rolled item is found by ID (or name fallback),
  // its name used as the map key, and adjacent names resolved back to items
  // on the defender. This correctly models the body topology (head → chest,
  // arms → chest, legs → abdomen) rather than simple range-table index order.
  //
  // Falls back to index-based adjacency (±1 in rangeMin sort order) only if
  // the actor has no hit-location items or the map has no entry for the location.
  //
  // Called AFTER the hit location is rolled but BEFORE damage is applied.
  // Returns { id, label } — same shape as _rollHitLocation so downstream
  // code is unaffected. Original location returned unchanged on any failure.
  // -------------------------------------------------------------------------

  static async _resolveMarksman(defender, rolledId, rolledLabel, attackerName = '') {
    const locations = Array.from(defender.items)
      .filter(i => i.type === 'hit-location')
      .sort((a, b) => (a.system.rangeMin ?? 0) - (b.system.rangeMin ?? 0));

    const adjacencyMap = CONFIG.MYTHRAS?.hitLocationAdjacency ?? {};

    // ── Path A: actor has hit-location items (normal case) ─────────────────
    if (locations.length > 0) {
      // Find the rolled item — prefer by ID, fall back to name match
      const rolledItem = rolledId
        ? locations.find(l => l.id === rolledId)
        : locations.find(l => l.name.toLowerCase().trim() === rolledLabel.toLowerCase().trim());

      if (!rolledItem) {
        ui.notifications.warn('Marksman: could not find rolled location in actor items — location unchanged.');
        return { id: rolledId, label: rolledLabel };
      }

      // Look up adjacency by the item's actual name (lowercase)
      const itemKey       = rolledItem.name.toLowerCase().trim();
      const adjacentNames = adjacencyMap[itemKey] ?? [];

      let adjacent = [];

      if (adjacentNames.length > 0) {
        // Resolve adjacent names to items on this defender (case-insensitive)
        adjacent = adjacentNames
          .map(name => locations.find(l => l.name.toLowerCase().trim() === name.toLowerCase().trim()))
          .filter(Boolean)
          .map(l => ({ id: l.id, name: l.name }));
      }

      // Fallback: if map has no entry or names don't match items, use index ±1
      // This handles custom location names that differ from the map keys.
      if (adjacent.length === 0) {
        const rolledIdx = locations.indexOf(rolledItem);
        if (rolledIdx > 0)                   adjacent.push({ id: locations[rolledIdx - 1].id, name: locations[rolledIdx - 1].name });
        if (rolledIdx < locations.length - 1) adjacent.push({ id: locations[rolledIdx + 1].id, name: locations[rolledIdx + 1].name });
      }

      if (adjacent.length === 0) {
        ui.notifications.warn('Marksman: no adjacent locations available — location unchanged.');
        return { id: rolledId, label: rolledLabel };
      }

      return CombatEngine._showMarksmanPicker(defender, rolledItem.name, adjacent, attackerName);
    }

    // ── Path B: no hit-location items — name map only ──────────────────────
    const rolledKey     = rolledLabel.toLowerCase().trim();
    const adjacentNames = adjacencyMap[rolledKey] ?? [];

    if (adjacentNames.length === 0) {
      ui.notifications.warn('Marksman: no adjacency data for "' + rolledLabel + '" — location unchanged.');
      return { id: rolledId, label: rolledLabel };
    }

    const humanoid = CONFIG.MYTHRAS?.hitLocations?.humanoid ?? [];
    const adjacent = adjacentNames
      .map(function(name) {
        const entry = humanoid.find(function(e) {
          return game.i18n.localize(e.label).toLowerCase().trim() === name.toLowerCase().trim();
        });
        return entry ? { id: null, name: game.i18n.localize(entry.label) } : null;
      })
      .filter(Boolean);

    if (adjacent.length === 0) {
      ui.notifications.warn('Marksman: adjacent locations not found — location unchanged.');
      return { id: rolledId, label: rolledLabel };
    }

    return CombatEngine._showMarksmanPicker(defender, rolledLabel, adjacent, attackerName);
  }

  static _showMarksmanPicker(defender, rolledLabel, adjacentLocs, attackerName = '') {
    return new Promise(resolve => {
      const buttons = adjacentLocs.map((loc, idx) => `
        <label class="mi-loc-picker-option">
          <input type="radio" name="mi-loc" value="${loc.id}" data-label="${loc.name}"
            ${idx === 0 ? 'checked' : ''}>
          <span class="mi-loc-picker-name">${loc.name}</span>
        </label>`).join('');

      const content = `
        <div class="mi-se-roll-dialog">
          <div class="mi-se-roll-header">
            <span class="mi-se-roll-title">Marksman</span>
            <span class="mi-se-roll-subtitle">${attackerName || 'Attacker'} → ${defender.name}</span>
          </div>
          <div class="mi-se-roll-body">
            <p class="mi-loc-picker-header">Rolled: <strong>${rolledLabel}</strong> — shift to an adjoining location:</p>
            <div class="mi-loc-picker">${buttons}</div>
          </div>
        </div>`;

      new Dialog({
        title: 'Marksman — Shift Location',
        content,
        buttons: {
          confirm: {
            label: 'Confirm',
            callback: html => {
              const checked = html[0].querySelector('input[name="mi-loc"]:checked');
              if (checked) {
                resolve({ id: checked.value, label: checked.dataset.label });
              } else {
                resolve({ id: adjacentLocs[0].id, label: adjacentLocs[0].name });
              }
            }
          },
          keep: {
            label: `Keep ${rolledLabel}`,
            callback: () => resolve({ id: null, label: rolledLabel })
          }
        },
        default: 'confirm',
        classes: ['dialog', 'mi-dialog'],
        close: () => resolve({ id: null, label: rolledLabel })
      }).render(true);
    });
  }


  //   1. Natural AP: system.ap on the hit-location item itself (creatures,
  //      natural armour, GM-set values)
  //   2. Worn armour AP: equipped armour items whose locations map includes
  //      this location. Armour location keys are camelCase (rightLeg, etc.);
  //      we derive the key from the hit-location item's label.
  // -------------------------------------------------------------------------

  static _getArmourAt(defender, locationId) {
    let naturalAP = 0;
    let locKey    = null;

    if (locationId) {
      const locItem = CombatEngine._getItem(defender, locationId);
      if (locItem) {
        naturalAP = locItem.system.ap ?? 0;
        // Derive the armour location key from the location label
        // e.g. "Right Leg" → "rightLeg", "Head" → "head", "Chest" → "chest"
        const label = (locItem.system.label ?? locItem.name ?? '');
        locKey = label.trim()
          .replace(/\s+(\w)/g, (_, c) => c.toUpperCase())
          .replace(/^(\w)/, c => c.toLowerCase());
      }
    }

    // Sum AP from all equipped armour items that cover this location
    let wornAP = 0;
    if (locKey) {
      for (const item of defender.items) {
        if (item.type !== 'armour') continue;
        if (!item.system.equipped) continue;
        if (item.system.locations?.[locKey]) {
          wornAP += item.system.ap ?? 0;
        }
      }
    }

    // Subtract any AP that has been permanently sundered at this specific location.
    // sunderedAP is a flag on the actor keyed by locKey — it records cumulative
    // AP reduction from Sunder SEs without mutating the armour item itself.
    const sunderedAP    = defender.getFlag('mythras-imperative', 'sunderedAP') ?? {};
    const sunderAtLoc   = locKey ? (sunderedAP[locKey] ?? 0) : 0;
    // Sunder reduces worn AP first, then natural AP
    const wornReduction    = Math.min(sunderAtLoc, wornAP);
    const naturalReduction = Math.min(Math.max(0, sunderAtLoc - wornReduction), naturalAP);

    return Math.max(0, naturalAP - naturalReduction) + Math.max(0, wornAP - wornReduction);
  }

  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // _resolveVehicleAttack
  //
  // Full resolution path when the defender is a vehicle actor.
  //
  // Rules (Mythras Imperative pp.53-63):
  //   • Vehicles cannot parry or evade — defence is always 'none'.
  //   • Attack roll resolves normally against the attacker's skill.
  //   • On a hit: roll weapon damage. Compare to vehicle's Hull (AP).
  //     - damage ≤ hull  → stopped; no further effect.
  //     - damage > hull  → penetrating damage = damage − hull applied to Structure.
  //                        Roll 1d10 → System Component Damage table.
  //                        Decrement that system slot's hits; mark destroyed if max reached.
  //   • Shields (if fitted, max > 0): intercept incoming damage before hull.
  //     - damage ≤ shields → fully absorbed; shield strength reduced by full damage.
  //     - damage > shields → excess = damage − shields; carry excess through hull/structure.
  //       Shield strength drops to zero (collapses) and the excess hits the hull.
  //   • Maximise Damage and Bypass Armour SEs apply normally.
  //     Bypass Armour treats hull as 0 (and ignores shields).
  //   • Full-Auto / Burst Fire: each round is resolved independently via
  //     _runFullAutoSingleTarget, which calls _runDialog per target. The vehicle
  //     branch fires each time, so multi-round attacks work automatically.
  //
  // System Component Damage table (1d10):
  //   1 → cargo   2 → comms   3 → controls   4 → drive   5 → crew
  //   6 → engine  7 → sensors  8 → weapons   9-10 → none
  //
  // The slot is found by matching its `id` field against the table id.
  // If the slot id is not found (e.g. a custom slot with an unexpected id),
  // the hit still applies to Structure but no slot is decremented — the chat
  // card notes "no matching system" so the GM can apply it manually.
  // -------------------------------------------------------------------------

  static async _resolveVehicleAttack(ctx) {
    const { attacker, defender, weapon } = ctx;

    const isSemi = CombatEngine.automationLevel === 'semi';

    // ── Roll attacker d100 ────────────────────────────────────────────────
    const attackRoll = new Roll('1d100');
    await attackRoll.evaluate();
    ctx.attackRoll    = attackRoll;
    ctx.attackResult  = attackRoll.total;
    ctx.attackOutcome = CombatEngine._determineOutcome(ctx.attackResult, ctx.attackerSkillTotal);

    ctx.defenceRoll    = null;
    ctx.defenceResult  = null;
    ctx.defenceOutcome = 'none';

    // ── Differential — defence is always 'none' ───────────────────────────
    const differential = CombatEngine.resolveDifferential(ctx.attackOutcome, 'none');
    ctx.seWinner = differential.seWinner;
    ctx.seCount  = differential.seCount;

    // ── Post outcome card ─────────────────────────────────────────────────
    const attackerScored = ctx.attackOutcome === 'critical' || ctx.attackOutcome === 'success';

    // Vehicles do not use the SE dialog — no parry, no hit-location SEs apply.
    ctx.chosenSpecialEffects = [];

    // Always show the Roll Vehicle Damage button when attacker scored —
    // vehicles skip the hit-location step so there is no separate Roll Hit
    // Location button, and the single damage button works the same regardless
    // of automation level. In full-auto mode we also fire damage immediately
    // after posting the card so the result appears without a click.
    const chatMsg = await CombatEngine._postVehicleOutcomeCard(ctx, attackerScored);
    ctx.chatMessageId = chatMsg?.id ?? null;

    // Full automation: also resolve damage immediately (button still shown for reference)
    if (attackerScored && CombatEngine.automationLevel === 'full') {
      await CombatEngine._applyVehicleDamage(ctx, chatMsg);
    }
  }

  // -------------------------------------------------------------------------
  // _applyVehicleDamage
  //
  // Rolls weapon damage, compares to shields then hull, applies penetrating
  // damage to Structure, rolls 1d10 for system component, updates the vehicle.
  // Called directly by _resolveVehicleAttack (full-auto) and by the
  // semi-auto "Roll Vehicle Damage" button handler in mythras.mjs.
  // -------------------------------------------------------------------------

  static async _applyVehicleDamage(ctx, chatMsg) {
    const { attacker, defender, weapon } = ctx;

    try {
    const dmMod    = attacker.system.attributes?.damageModifier ?? '';
    const applyMod = weapon.system.damageModApplies ?? true;
    const effectiveDM = (ctx.isCharge && applyMod)
      ? CombatEngine._stepUpDamageModifier(dmMod) : dmMod;
    const dmgFormula = (applyMod && effectiveDM && effectiveDM !== '+0' && effectiveDM !== '0')
      ? `${weapon.system.damage}${effectiveDM}` : weapon.system.damage;

    const damageRoll = new Roll(dmgFormula);
    await damageRoll.evaluate();
    let rawDamage = damageRoll.total;
    ctx.damageRoll = damageRoll;

    // Maximise Damage SE
    const maximiseCount = (ctx.chosenSpecialEffects ?? []).filter(s => s === 'maximiseDamage').length;
    if (maximiseCount > 0 && ctx.attackOutcome === 'critical') {
      const dieTerms = damageRoll.terms.filter(t => t.faces);
      for (let i = 0; i < Math.min(maximiseCount, dieTerms.length); i++) {
        rawDamage += dieTerms[i].faces - dieTerms[i].total;
      }
    }
    ctx.rawDamage = rawDamage;

    const bypassArmour = (ctx.chosenSpecialEffects ?? []).includes('bypassArmour');

    // ── Read vehicle stats via toObject() to avoid TypeDataModel proxy issue
    // Nested SchemaField values (structure, shields) return undefined when
    // accessed directly through the proxy — always use toObject() first.
    const vObj    = defender.system.toObject ? defender.system.toObject() : { ...defender.system };
    const shields = vObj.shields ?? { value: 0, max: 0 };
    let shieldAbsorb = 0;
    let damageAfterShields = rawDamage;

    if (!bypassArmour && shields.max > 0 && shields.value > 0) {
      if (rawDamage <= shields.value) {
        shieldAbsorb       = rawDamage;
        damageAfterShields = 0;
      } else {
        shieldAbsorb       = shields.value;
        damageAfterShields = rawDamage - shields.value;
      }
      const newShieldVal = Math.max(0, shields.value - shieldAbsorb);
      const baseActor    = game.actors.get(defender.id) ?? defender;
      await baseActor.update({ 'system.shields.value': newShieldVal });
    }

    ctx.shieldAbsorb       = shieldAbsorb;
    ctx.damageAfterShields = damageAfterShields;

    // ── Hull comparison ───────────────────────────────────────────────────
    const hull = bypassArmour ? 0 : (vObj.hull ?? 0);
    const penetrating = Math.max(0, damageAfterShields - hull);
    ctx.penetrating = penetrating;

    if (penetrating <= 0) {
      ctx.structureDamage  = 0;
      ctx.systemHit        = null;
      ctx.systemResult     = null;
      if (chatMsg) await CombatEngine._updateVehicleCardWithDamage(chatMsg, ctx);
      return;
    }

    // ── Structure damage ──────────────────────────────────────────────────
    const structureCurrent = vObj.structure?.value ?? 0;
    const structureNew     = Math.max(0, structureCurrent - penetrating);
    ctx.structureDamage    = penetrating;

    // ── 1d10 System Component roll ────────────────────────────────────────
    // System components are hit-location items — look up by range.
    const sysRoll = new Roll('1d10');
    await sysRoll.evaluate();
    ctx.systemRoll = sysRoll.total;

    const baseActor = game.actors.get(defender.id) ?? defender;
    const sysItems  = Array.from(baseActor.items)
      .filter(i => i.type === 'hit-location')
      .sort((a, b) => (a.system.sort ?? 0) - (b.system.sort ?? 0));
    const hitItem   = sysItems.find(i =>
      ctx.systemRoll >= (i.system.rangeMin ?? 1) && ctx.systemRoll <= (i.system.rangeMax ?? 1)
    ) ?? null;

    let systemResult = null;
    if (hitItem) {
      const hp      = hitItem.system.hp ?? 1;
      const current = Math.max(0, (hitItem.system.current ?? hp) - 1);
      const wound   = current <= 0  ? 'major'
                    : current / hp <= 0.5 ? 'serious'
                    : 'minor';
      await hitItem.update({ 'system.current': current, 'system.wound': wound });
      systemResult     = { label: hitItem.system.label, current, hp, destroyed: current <= 0 };
      ctx.systemResult = systemResult;
    } else {
      ctx.systemResult = null;
    }
    await baseActor.update({ 'system.structure.value': structureNew });

    if (chatMsg) await CombatEngine._updateVehicleCardWithDamage(chatMsg, ctx);

    } catch (err) {
      console.error('MI | _applyVehicleDamage error:', err);
      throw err; // re-throw so the button handler can catch and show a notification
    }
  }

  // -------------------------------------------------------------------------
  // _postVehicleOutcomeCard — chat card for vehicle attacks
  // Uses the same mi-chat-card--resolution structure as normal combat cards.
  // -------------------------------------------------------------------------

  static async _postVehicleOutcomeCard(ctx, _unused) {
    const { attacker, defender, weapon } = ctx;

    const outcomeLabel = {
      critical: game.i18n.localize('MYTHRAS.OutcomeCritical'),
      success:  game.i18n.localize('MYTHRAS.OutcomeSuccess'),
      failure:  game.i18n.localize('MYTHRAS.OutcomeFailure'),
      fumble:   game.i18n.localize('MYTHRAS.OutcomeFumble'),
      none:     game.i18n.localize('MYTHRAS.OutcomeFailure')
    };

    const attackerScored = ctx.attackOutcome === 'critical' || ctx.attackOutcome === 'success';

    const dmMod    = attacker.system.attributes?.damageModifier ?? '';
    const applyMod = weapon.system.damageModApplies ?? true;
    const effectiveDM = (ctx.isCharge && applyMod)
      ? CombatEngine._stepUpDamageModifier(dmMod) : dmMod;
    const dmgFormula = (applyMod && effectiveDM && effectiveDM !== '+0' && effectiveDM !== '0')
      ? `${weapon.system.damage}${effectiveDM}` : weapon.system.damage;

    const sizeLabel = {
      small:'Small', medium:'Medium', large:'Large',
      huge:'Huge', enormous:'Enormous', colossal:'Colossal'
    }[defender.system.size] ?? defender.system.size;

    const damageBtn = attackerScored ? `
      <div class="mi-manual-actions">
        <button class="mi-btn mi-btn-veh-dmg"
          data-formula="${dmgFormula}"
          data-vehicle-id="${defender.id}"
          data-attacker-id="${attacker.id}"
          data-weapon-id="${weapon.id}"
          data-is-charge="${ctx.isCharge}"
          data-message-id="PENDING">
          <i class="fas fa-dice"></i> Roll Vehicle Damage
        </button>
      </div>` : '';

    const content = `
      <div class="mi-chat-card mi-chat-card--resolution">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker.name} <span class="mi-card-vs">vs</span> ${defender.name}</span>
          <span class="mi-card-skill">${weapon.name}</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-card-details">
            <span class="mi-card-pill">${sizeLabel} Vehicle</span>
            <span class="mi-card-pill">Hull ${defender.system.hull ?? 0}</span>
          </div>
          <div class="mi-card-rolls">
            <div class="mi-card-roll-row">
              <div class="mi-card-roll-row-top">${attacker.name}</div>
              <div class="mi-card-roll-row-bottom">
                <span class="mi-card-roll-target">${ctx.attackerSkillTotal}%</span>
                <span class="mi-card-roll-result">${ctx.attackResult}</span>
                <span class="mi-outcome ${ctx.attackOutcome}">${outcomeLabel[ctx.attackOutcome]}</span>
              </div>
            </div>
            <div class="mi-card-roll-row mi-card-roll-row--defender">
              <div class="mi-card-roll-row-top">${defender.name} — No Defence</div>
              <div class="mi-card-roll-row-bottom">
                <span class="mi-card-roll-target">—</span>
                <span class="mi-card-roll-result">—</span>
                <span class="mi-outcome failure">${outcomeLabel.failure}</span>
              </div>
            </div>
          </div>
          ${damageBtn}
          <div class="mi-veh-combat-result" id="mi-veh-result-PENDING"></div>
        </div>
      </div>`;

    const chatMsg = await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      rolls:   [ctx.attackRoll].filter(Boolean),
      flags: {
        'mythras-imperative': {
          vehicleAttack:  true,
          attackOutcome:  ctx.attackOutcome,
          defenceOutcome: 'none',
          chosenSEs:      []
        }
      }
    });

    // Stamp real message id into button and result placeholder
    if (chatMsg) {
      const stamped = chatMsg.content
        .replace(/data-message-id="PENDING"/, `data-message-id="${chatMsg.id}"`)
        .replace(/id="mi-veh-result-PENDING"/, `id="mi-veh-result-${chatMsg.id}"`);
      await chatMsg.update({ content: stamped });
    }

    return chatMsg;
  }

  // -------------------------------------------------------------------------
  // _updateVehicleCardWithDamage — appends the damage result block to the card
  // -------------------------------------------------------------------------

  static async _updateVehicleCardWithDamage(chatMsg, ctx) {
    if (!chatMsg) return;

    const { defender } = ctx;
    const penetrating  = ctx.penetrating ?? 0;
    const raw          = ctx.rawDamage   ?? 0;
    const shieldAbsorb = ctx.shieldAbsorb ?? 0;
    const structDmg    = ctx.structureDamage ?? 0;
    const sysRoll      = ctx.systemRoll ?? null;
    const sysResult    = ctx.systemResult;

    // Use toObject() to avoid TypeDataModel proxy issues on nested SchemaFields
    const vObj = defender.system.toObject ? defender.system.toObject() : { ...defender.system };
    const hull = vObj.hull ?? 0;

    // Shield line
    const shieldLine = shieldAbsorb > 0
      ? `<div class="mi-veh-dmg-row"><span class="mi-veh-dmg-label">Shields</span><span class="mi-veh-dmg-val mi-muted">absorbed ${shieldAbsorb}</span></div>`
      : '';

    // Penetration vs stop
    const hullLine = penetrating > 0
      ? `<div class="mi-veh-dmg-row mi-veh-dmg-penetrate">
           <span class="mi-veh-dmg-label">Hull (${hull})</span>
           <span class="mi-veh-dmg-val"><strong>Penetrated!</strong> ${ctx.damageAfterShields} − ${hull} = ${penetrating} damage to Structure</span>
         </div>`
      : `<div class="mi-veh-dmg-row mi-veh-dmg-stopped">
           <span class="mi-veh-dmg-label">Hull (${hull})</span>
           <span class="mi-veh-dmg-val mi-muted">Stopped — damage (${ctx.damageAfterShields}) did not exceed Hull</span>
         </div>`;

    // System component
    let sysLine = '';
    if (structDmg > 0) {
      // Re-read structure via toObject() after the update has been written
      const vObjFresh = defender.system.toObject ? defender.system.toObject() : { ...defender.system };
      const structNow = vObjFresh.structure?.value ?? '?';
      const structMax = vObjFresh.structure?.max   ?? '?';
      const structLine = `<div class="mi-veh-dmg-row"><span class="mi-veh-dmg-label">Structure</span><span class="mi-veh-dmg-val">${structNow} / ${structMax} <span class="mi-muted">(−${structDmg})</span></span></div>`;

      if (sysResult) {
        const stateClass = sysResult.destroyed ? 'mi-veh-sys-state-destroyed' : 'mi-veh-sys-state-damaged';
        const stateLabel = sysResult.destroyed ? 'Destroyed' : `${sysResult.current}/${sysResult.hp} remaining`;
        sysLine = `${structLine}
          <div class="mi-veh-dmg-row mi-veh-dmg-system">
            <span class="mi-veh-dmg-label">System (1d10: ${sysRoll})</span>
            <span class="mi-veh-dmg-val"><strong>${sysResult.label}</strong> — <span class="${stateClass}">${stateLabel}</span></span>
          </div>`;
      } else if (sysRoll !== null) {
        sysLine = `${structLine}
          <div class="mi-veh-dmg-row mi-veh-dmg-system">
            <span class="mi-veh-dmg-label">System (1d10: ${sysRoll})</span>
            <span class="mi-veh-dmg-val mi-muted">No system affected</span>
          </div>`;
      } else {
        sysLine = structLine;
      }
    }

    const resultBlock = `
      <div class="mi-veh-combat-result">
        <div class="mi-veh-dmg-row mi-veh-dmg-raw">
          <span class="mi-veh-dmg-label">Damage Roll</span>
          <span class="mi-veh-dmg-val">${raw}</span>
        </div>
        ${shieldLine}
        ${hullLine}
        ${sysLine}
      </div>`;

    // Replace the empty result div placeholder or append
    let newContent = chatMsg.content;
    const placeholder = `<div class="mi-veh-combat-result" id="mi-veh-result-${chatMsg.id}"></div>`;
    if (newContent.includes(placeholder)) {
      newContent = newContent.replace(placeholder, resultBlock);
    } else {
      // Strip old result block and append fresh
      newContent = newContent.replace(/<div class="mi-veh-combat-result">[\s\S]*?<\/div>\s*<\/div>/, '') + resultBlock + '</div>';
    }
    await chatMsg.update({ content: newContent });
  }

  // _applyDamage — writes system.current and system.wound on the location item
  //
  // Schema (HitLocationData):
  //   system.hp      = max HP  (NumberField, plain number)
  //   system.current = current HP (NumberField, plain number)
  //   system.wound   = wound state ('none'|'minor'|'serious'|'major')
  // -------------------------------------------------------------------------

  static async _applyDamage(ctx, damage) {
    // Opposed SEs fire unconditionally — some (e.g. Trip Opponent) have no damage
    // requirement and must resolve even when damage is fully blocked. Each resolver
    // gates itself via requiresDamage in the registry.
    const { defender } = ctx;

    if (damage > 0) {
      for (const hook of (CONFIG.MYTHRAS?.damageHooks ?? [])) {
        const result = hook(ctx, damage);
        if (result === false) {
          // A hook suppressed damage — still let opposed SEs fire below.
          damage = 0;
          break;
        }
      }
    }

    if (damage > 0) {
      const locItem = ctx.hitLocationId ? defender.items.get(ctx.hitLocationId) : null;
      if (locItem) {
        const maxHp      = locItem.system.hp ?? 4;
        const currentHp  = locItem.system.current ?? maxHp;
        const newCurrent = currentHp - damage;
        const woundLevel = CombatEngine._woundLevel(damage, maxHp, newCurrent);

        ctx.woundLevel        = woundLevel;
        ctx.newCurrent        = newCurrent;
        ctx.maxHp             = maxHp;
        ctx.locationType      = CombatEngine._classifyLocation(locItem.name);
        // Serious: location at 0 or below. Major: location at -maxHp or below.
        ctx.enduranceRequired = newCurrent <= 0;

        await locItem.update({
          'system.current': newCurrent,
          'system.wound':   woundLevel
        });
      }
    }

    // Resolve opposed SEs. Always fires — requiresDamage gates are enforced inside the dispatcher.
    await CombatEngine._resolveOpposedSEs(ctx, damage);

    // Resolve wound consequences (Serious/Major Endurance roll) after SEs.
    // This fires for Serious and Major wounds. Cards always post regardless of mode.
    if (ctx.enduranceRequired) {
      await CombatEngine._resolveWoundConsequences(ctx);
    }
  }

  // -------------------------------------------------------------------------
  // _resolveOpposedSEs — registry-driven dispatch for 'opposed'-phase SEs
  //
  // Called from three sites:
  //   1. _afterDefenceResolved (no-damage path) — attacker failed/fumbled
  //   2. Apply Damage button handler (mythras.mjs) — semi-auto, damage > 0
  //   3. _onSemiAutoRollDamage zero-damage path — semi-auto, damage fully blocked
  //
  // Iterates ctx.chosenSpecialEffects, looks up each id in the registry, and
  // calls the resolver for every 'opposed'-phase SE that passes its gate
  // conditions (requiresDamage, requiresFumble). Each id is dispatched at most
  // once regardless of how many times it appears (stackable SEs read their own
  // stack count from ctx.chosenSpecialEffects internally).
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // _resolveAccidentalInjury
  //
  // Rules p.42: Defender deflects the attacker's fumbled blow so it strikes
  // the attacker themselves. The attacker rolls their own weapon damage against
  // a random hit location on themselves. If the attacker is unarmed, damage
  // ignores their armour (they tear or break something internal).
  // No opposed roll — the effect is automatic.
  // -------------------------------------------------------------------------

  static async _resolveAccidentalInjury(ctx) {
    const { attacker, weapon } = ctx;
    if (!attacker || !weapon) return;

    const isSemi    = CombatEngine.automationLevel === 'semi';
    const isUnarmed = (weapon.system.traits ?? []).includes('unarmed');

    // Build damage formula — attacker rolls their own weapon against themselves
    const applyMod   = weapon.system.damageModApplies ?? true;
    const attackerDM = attacker.system.attributes?.damageModifier ?? '';
    const dmgFormula = (applyMod && attackerDM && attackerDM !== '+0' && attackerDM !== '0')
      ? `${weapon.system.damage}${attackerDM}` : weapon.system.damage;

    // ── Semi-Auto: post a card with Roll Hit Location + Roll Damage buttons ──
    // The buttons target the attacker as the wounded actor (defender slot),
    // so the existing Semi-Auto button handlers apply damage to the attacker.
    // bypassArmour is set true when unarmed (internal injury — ignore armour).
    if (isSemi) {
      const content = `
        <div class="mi-chat-card">
          <div class="mi-card-header mi-card-header--stacked">
            <span class="mi-card-actor">${attacker.name}</span>
            <span class="mi-card-skill">Accidental Injury</span>
          </div>
          <div class="mi-card-body">
            <div class="mi-outcome-row">
              <span class="mi-outcome mi-wound-serious">
                <i class="fas fa-dizzy"></i> ${attacker.name} fumbles and strikes themselves!
              </span>
            </div>
            <div class="mi-manual-actions">
              <button class="mi-btn mi-btn-loc"
                data-defender-id="${attacker.id}"
                data-message-id="PENDING"
                data-choose-location="false">
                <i class="fas fa-crosshairs"></i> Roll Hit Location
              </button>
              <button class="mi-btn mi-btn-dmg"
                data-formula="${dmgFormula}"
                data-defender-id="${attacker.id}"
                data-is-charge="false"
                data-bypass-armour="${isUnarmed}"
                data-parry-weapon-id=""
                data-parry-style-id=""
                data-attacker-id="${attacker.id}"
                data-weapon-id="${weapon.id}"
                data-defence-type="none"
                data-defence-weapon-name=""
                data-message-id="PENDING">
                <i class="fas fa-dice"></i> Roll Damage
              </button>
            </div>
          </div>
        </div>`;

      const msg = await ChatMessage.create({
        content,
        speaker: ChatMessage.getSpeaker({ actor: attacker }),
        flags: {
          'mythras-imperative': {
            actorId:          attacker.id,
            defenderId:       attacker.id,
            attackerId:       attacker.id,
            weaponId:         weapon.id,
            stage:            'outcome',
            dmgFormula,
            isCharge:         false,
            defenceType:      'none',
            defenceWeaponId:  null,
            defenceStyleId:   null,
            chosenSEs:        [],
            seWinner:         'none',
            attackOutcome:    ctx.attackOutcome,
            defenceOutcome:   'none',
            attackResult:     ctx.attackResult ?? 99,
            attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
          lastCardId:         ctx.chatMessageId,
            defenceResult:    null,
            defenderSkillTotal: 0,
          }
        }
      });

      // Stamp real message ID onto the PENDING buttons
      if (msg) {
        const updatedContent = content.replace(/data-message-id="PENDING"/g, `data-message-id="${msg.id}"`);
        await msg.update({ content: updatedContent });
      }

      ui.notifications.warn(`Accidental Injury! ${attacker.name} fumbles — roll hit location and damage above.`);
      return;
    }

    // ── Full Auto: resolve everything immediately ──────────────────────────
    const dmgRoll = new Roll(dmgFormula);
    await dmgRoll.evaluate();
    const rawDamage = Math.max(0, dmgRoll.total);

    const locResult    = CombatEngine._rollHitLocation(attacker);
    const locId        = locResult.id;
    const locLabel     = locResult.label;
    const locRoll      = locResult.roll;
    const armourPoints = isUnarmed ? 0 : CombatEngine._getArmourAt(attacker, locId);
    const finalDamage  = Math.max(0, rawDamage - armourPoints);

    let woundLevel   = 'none';
    let newCurrent   = null;
    let maxHp        = null;
    let locationType = null;
    if (finalDamage > 0 && locId) {
      const locItem = attacker.items.get(locId);
      if (locItem) {
        maxHp        = locItem.system.hp ?? 4;
        const currentHp = locItem.system.current ?? maxHp;
        newCurrent   = currentHp - finalDamage;
        woundLevel   = CombatEngine._woundLevel(finalDamage, maxHp, newCurrent);
        locationType = CombatEngine._classifyLocation(locLabel);
        await locItem.update({ 'system.current': newCurrent, 'system.wound': woundLevel });
      }
    }

    const woundClass = woundLevel === 'major'   ? 'mi-wound-major'
                     : woundLevel === 'serious' ? 'mi-wound-serious'
                     : woundLevel === 'minor'   ? 'mi-wound-minor' : '';
    const woundText  = woundLevel !== 'none'
      ? `${woundLevel.charAt(0).toUpperCase() + woundLevel.slice(1)} Wound — ${locLabel}` : '';
    const armourNote = isUnarmed ? 'Internal injury — armour ignored'
                     : armourPoints > 0 ? `${armourPoints} AP` : 'No armour';
    const diceHtml   = CombatEngine._diceBreakdown(dmgRoll);

    await ChatMessage.create({
      content: `
        <div class="mi-chat-card">
          <div class="mi-card-header mi-card-header--stacked">
            <span class="mi-card-actor">${attacker.name}</span>
            <span class="mi-card-skill">Accidental Injury</span>
          </div>
          <div class="mi-card-body">
            <div class="mi-card-location-row">
              <span class="mi-card-location-die">1d20: <strong>${locRoll}</strong></span>
              <span class="mi-card-location-label">${locLabel}</span>
            </div>
            <div class="mi-card-damage-row">
              <div class="mi-card-damage-header">
                <span class="mi-card-damage-num">${rawDamage} damage</span>
                ${diceHtml}
                <span class="mi-card-note">(${armourNote})</span>
                ${finalDamage > 0
                  ? `<span class="mi-card-damage-final">\u2192 ${finalDamage} to ${locLabel}</span>`
                  : '<span class="mi-card-note">Absorbed by armour</span>'}
              </div>
              ${woundText ? `
              <div class="mi-outcome-row">
                <span class="mi-outcome ${woundClass}">${woundText}</span>
              </div>` : ''}
            </div>
          </div>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor: attacker })
    });

    ui.notifications.warn(`Accidental Injury! ${attacker.name} strikes themselves — ${finalDamage} damage to ${locLabel}.`);

    const enduranceRequired = woundLevel === 'serious' || woundLevel === 'major';
    if (enduranceRequired) {
      await CombatEngine._resolveWoundConsequences({
        ...ctx,
        defender:          attacker,
        attacker:          attacker,
        woundLevel,
        locationType:      locationType ?? CombatEngine._classifyLocation(locLabel),
        hitLocationLabel:  locLabel,
        newCurrent,
        maxHp,
        damageAfterArmour: finalDamage,
        enduranceRequired: true,
        attackResult:      ctx.attackResult ?? 99,
        attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
          lastCardId:         ctx.chatMessageId,
      });
    }
  }

  static async _resolveOpposedSEs(ctx, damage) {
    const ses        = ctx.chosenSpecialEffects;
    const forcesFail = ses.includes('forceFailure');

    // Data-driven dispatch: iterate the SE registry and call the resolver for
    // every 'opposed'-phase SE that was chosen and passes its gate conditions.
    // Adding a new SE only requires a registry entry + a resolver method —
    // no manual edits here, and hasOpposedSE can never drift out of sync.
    //
    // Deduplication: chosenSpecialEffects may contain the same id multiple times
    // for stackable SEs (e.g. rapidReload, pinDown). Each resolver is called
    // exactly once — resolvers that need the stack count read it themselves
    // from ctx.chosenSpecialEffects (e.g. _resolveRapidReload reads stackCount).
    const registry = CONFIG.MYTHRAS.specialEffects;
    const seen     = new Set();
    for (const id of ses) {
      if (seen.has(id)) continue;
      seen.add(id);
      const def = registry.find(e => e.id === id);
      if (!def || def.phase !== 'opposed') continue;
      if (def.requiresDamage && damage <= 0)                    continue;
      if (def.requiresFumble && ctx.attackOutcome !== 'fumble') continue;
      if (!def.resolver) continue;
      // impale has a different signature: no forcesFail parameter
      if (id === 'impale') {
        await CombatEngine._resolveImpale(ctx, damage);
      // pinDown signature is (ctx, forcesFail) — no damage parameter
      } else if (id === 'pinDown') {
        await CombatEngine._resolvePinDown(ctx, forcesFail);
      } else {
        await CombatEngine[def.resolver](ctx, damage, forcesFail);
      }
    }
  }

  // -------------------------------------------------------------------------
  // _resolveBleed — SE: Bleed
  // Rules p.43: requires damage > 0. Defender rolls Endurance vs attacker's
  // original roll. On fail: Bleeding condition applied.
  // -------------------------------------------------------------------------
  static async _resolveBleed(ctx, damage, forcesFail) { return resolveBleed(ctx, damage, forcesFail); }

  // -------------------------------------------------------------------------
  // _resolveTripOpponent — SE: Trip Opponent
  // Rules p.47: no damage requirement. Offensive or defensive — the resisting
  // actor rolls Brawn/Evade/Acrobatics vs the SE winner's original roll.
  // -------------------------------------------------------------------------
  static async _resolveTripOpponent(ctx, damage, forcesFail) { return resolveTripOpponent(ctx, damage, forcesFail); }

  // -------------------------------------------------------------------------
  // _resolveStunLocation — SE: Stun Location
  // Rules p.45: bludgeoning, damage > 0. Endurance vs attack roll.
  // On fail: location Incapacitated for damage-many Turns.
  // Torso: additional Hard Endurance or fall Prone.
  // -------------------------------------------------------------------------
  static async _resolveStunLocation(ctx, damage, forcesFail) { return resolveStunLocation(ctx, damage, forcesFail); }

  // -------------------------------------------------------------------------
  // _resolveDisarmOpponent — SE: Disarm Opponent
  // Rules p.44: resists with Combat Style. Weapon size affects difficulty.
  // Offensive or defensive — roles swap when defender wins the SE.
  // -------------------------------------------------------------------------
  static async _resolveDisarmOpponent(ctx, damage, forcesFail) { return resolveDisarmOpponent(ctx, damage, forcesFail); }

  // -------------------------------------------------------------------------
  // _resolveEntangle — SE: Entangle
  // Rules p.44: Offensive, Entangling weapons only. No opposed roll — the
  // location is immediately entangled. Effects depend on location type.
  // -------------------------------------------------------------------------
  static async _resolveEntangle(ctx, damage, forcesFail) {
    const { attacker, defender } = ctx;
    const attackRoll = ctx.attackResult ?? 0;

    const _rawLabel  = ctx.hitLocationLabel
      || (ctx.hitLocationId ? (defender.items.get(ctx.hitLocationId)?.name ?? '') : '')
      || 'the struck location';
    const locType   = ctx.locationType ?? CombatEngine._classifyLocation(_rawLabel);
    const locLabel  = _rawLabel;
    const isLimb    = locType === 'limb';
    const isHead    = locType === 'head';
    const isTorso   = locType === 'torso';
    const gradeHard = isHead || isTorso;

    const armWords  = /arm|hand/i.test(locLabel);
    const legWords  = /leg|foot/i.test(locLabel);
    const limbNote  = armWords
      ? `${defender.name}'s ${locLabel} is snared — cannot use whatever it is holding`
      : legWords
        ? `${defender.name}'s ${locLabel} is snared — cannot move`
        : `${defender.name}'s ${locLabel} is entangled`;
    const effectNote = gradeHard
      ? `${defender.name}'s ${locLabel} is enmeshed — all skill rolls Hard`
      : limbNote;

    const entangleId = foundry.utils.randomID(8);

    const entangledBy = defender.getFlag('mythras-imperative', 'entangledBy') ?? {};
    entangledBy[entangleId] = {
      attackerActorId:   attacker.id,
      attackerName:      attacker.name,
      attackerRoll:      attackRoll,
      attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
          lastCardId:         ctx.chatMessageId,
      weaponName:        ctx.weapon?.name ?? 'weapon',
      locationType:      locType,
      locationLabel:     locLabel,
      gradeHard,
      entangleId
    };
    await defender.setFlag('mythras-imperative', 'entangledBy', entangledBy);
    await CombatEngine._applyStatusToActor(defender, 'entangled');

    const pendingEntangleTrip = attacker.getFlag('mythras-imperative', 'pendingEntangleTrip') ?? {};
    pendingEntangleTrip[entangleId] = {
      defenderId:        defender.id,
      defenderName:      defender.name,
      attackerRoll:      attackRoll,
      attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
          lastCardId:         ctx.chatMessageId,
      locationLabel:     locLabel,
      entangleId
    };
    await attacker.setFlag('mythras-imperative', 'pendingEntangleTrip', pendingEntangleTrip);

    const pendingEntangleBreakFree = defender.getFlag('mythras-imperative', 'pendingEntangleBreakFree') ?? {};
    pendingEntangleBreakFree[entangleId] = {
      attackerActorId:   attacker.id,
      attackerName:      attacker.name,
      attackerRoll:      attackRoll,
      attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
          lastCardId:         ctx.chatMessageId,
      weaponName:        ctx.weapon?.name ?? 'weapon',
      locationLabel:     locLabel,
      gradeHard,
      entangleId
    };
    await defender.setFlag('mythras-imperative', 'pendingEntangleBreakFree', pendingEntangleBreakFree);

    await ChatMessage.create({
      content: `
        <div class="mi-chat-card">
          <div class="mi-card-header mi-card-header--stacked">
            <span class="mi-card-actor">${attacker.name} → ${defender.name}</span>
            <span class="mi-card-skill">Entangle — ${locLabel}</span>
          </div>
          <div class="mi-card-body">
            <div class="mi-outcome-row">
              <span class="mi-outcome mi-wound-serious">
                <i class="fas fa-spider"></i> ${effectNote}
              </span>
            </div>
            ${gradeHard ? `<div class="mi-se-roll-row">
              <span class="mi-se-roll-label">Skill penalty</span>
              <span class="mi-se-roll-val">Hard (all skills while enmeshed)</span>
            </div>` : ''}
            <p class="mi-se-roll-note">
              ${attacker.name} may spend 1 AP at the start of their next turn to attempt an automatic Trip.<br>
              ${defender.name} may attempt to break free (Brawn) at the start of their next turn.
            </p>
          </div>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor: attacker })
    });
  }

  // -------------------------------------------------------------------------
  // _resolveGrip — SE: Grip
  // Rules p.44: Offensive, Unarmed only. No opposed roll at grip time.
  // Gripper chooses holding skill (Brawn or Unarmed). Gripped actor may
  // break free on their own turn.
  // -------------------------------------------------------------------------
  static async _resolveGrip(ctx, damage, forcesFail) {
    const { attacker, defender } = ctx;
    const isSemi   = CombatEngine.automationLevel === 'semi';
    const isGMMode = CombatEngine.gmMode;
    const attackRoll = ctx.attackResult ?? 0;

    const gripperBrawn   = Array.from(attacker.items).find(i => i.type === 'skill' && i.name === 'Brawn');
    const gripperUnarmed = Array.from(attacker.items).find(i => i.type === 'skill' && i.name === 'Unarmed');

    const _adjG = raw => CombatEngine._applyFatigueToSkill(raw, attacker);
    const gripperSkillOptions = [
      gripperBrawn   && { name: 'Brawn',   rawTotal: gripperBrawn.system.total   ?? 0, total: _adjG(gripperBrawn.system.total   ?? 0) },
      gripperUnarmed && { name: 'Unarmed', rawTotal: gripperUnarmed.system.total ?? 0, total: _adjG(gripperUnarmed.system.total ?? 0) }
    ].filter(Boolean);
    if (gripperSkillOptions.length === 0) gripperSkillOptions.push({ name: 'Brawn', rawTotal: 0, total: 0 });

    let gripperSkill = gripperSkillOptions[0];

    if (!forcesFail && isSemi) {
      let response;
      if (isGMMode) {
        response = await CombatEngine._runSEDialog({
          seType:             'gripChooseSkill',
          attackerName:       attacker.name,
          defenderName:       defender.name,
          attackRoll,
          attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
          lastCardId:         ctx.chatMessageId,
          skillOptions:       gripperSkillOptions
        });
      } else {
        const { CombatSocket, _findUserIdForActor } = await import('./CombatSocket.js');
        const targetUserId = _findUserIdForActor(attacker);
        const exchangeId   = foundry.utils.randomID(16);
        response = await CombatSocket.seChallenge(exchangeId, {
          seType:             'gripChooseSkill',
          attackerName:       attacker.name,
          defenderName:       defender.name,
          attackRoll,
          attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
          lastCardId:         ctx.chatMessageId,
          skillOptions:       gripperSkillOptions
        }, targetUserId);
      }
      if (response) {
        gripperSkill = { name: response.chosenSkillName, total: response.chosenSkillTotal, rawTotal: response.chosenSkillRaw ?? response.chosenSkillTotal };
      }
    } else if (!forcesFail) {
      if (gripperSkillOptions.length > 1) {
        gripperSkill = gripperSkillOptions.reduce((best, sk) => sk.total > best.total ? sk : best);
      }
    }

    const gripEntryId = foundry.utils.randomID(8);
    const grippedBy   = defender.getFlag('mythras-imperative', 'grippedBy') ?? {};
    grippedBy[gripEntryId] = {
      gripperActorId:  attacker.id,
      gripperName:     attacker.name,
      gripperSkillName:  gripperSkill.name,
      gripperSkillTotal: gripperSkill.total,
      gripperSkillRaw:   gripperSkill.rawTotal ?? gripperSkill.total
    };
    await defender.setFlag('mythras-imperative', 'grippedBy', grippedBy);

    const pendingGrip = defender.getFlag('mythras-imperative', 'pendingGripCheck') ?? {};
    pendingGrip[gripEntryId] = grippedBy[gripEntryId];
    await defender.setFlag('mythras-imperative', 'pendingGripCheck', pendingGrip);

    await ChatMessage.create({
      content: `
        <div class="mi-chat-card">
          <div class="mi-card-header mi-card-header--stacked">
            <span class="mi-card-actor">${attacker.name} → ${defender.name}</span>
            <span class="mi-card-skill">Grip</span>
          </div>
          <div class="mi-card-body">
            <div class="mi-outcome-row">
              <span class="mi-outcome mi-wound-serious">
                <i class="fas fa-hands"></i> ${attacker.name} has ${defender.name} in a grip — cannot disengage
              </span>
            </div>
            <div class="mi-se-roll-row">
              <span class="mi-se-roll-label">Gripper's holding skill</span>
              <span class="mi-se-roll-val">${gripperSkill.name} ${gripperSkill.total}%</span>
            </div>
            <p class="mi-se-roll-note">${defender.name} may attempt to break free at the start of their next turn.</p>
          </div>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor: attacker })
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
  // _resolveBlindOpponent — Blind Opponent SE
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

  static async _resolveBlindOpponent(ctx) { return resolveBlindOpponent(ctx); }

  // -------------------------------------------------------------------------
  // _getActiveBlindGrade — returns the active blind grade ('hard'|'formidable')
  // for an actor, or null if not currently blinded.
  // -------------------------------------------------------------------------

  static _getActiveBlindGrade(actor) {
    const blindedBy = actor?.getFlag?.('mythras-imperative', 'blindedBy');
    if (!blindedBy || !blindedBy.turnsRemaining || blindedBy.turnsRemaining <= 0) return null;
    return blindedBy.grade ?? 'hard';
  }

  static async _resolveSlipFree(ctx) {
    const { attacker, defender } = ctx;
    if (!defender) return;

    const NS = 'mythras-imperative';

    // Count what we are about to clear (for the card display)
    const grippedBy        = defender.getFlag(NS, 'grippedBy')   ?? {};
    const entangledBy      = defender.getFlag(NS, 'entangledBy') ?? {};
    const gripIds          = Object.keys(grippedBy);
    const entangleEntries  = Object.entries(entangledBy);
    const clearedGrips     = gripIds.length;
    const clearedEntangles = entangleEntries.length;

    // Post card FIRST so it always appears even if cleanup throws
    const hadHolds = clearedGrips + clearedEntangles > 0;
    const effectNote = hadHolds
      ? `${defender.name} slips free — all grips and entanglements broken`
      : `${defender.name} uses Slip Free — no active holds to escape`;

    await ChatMessage.create({
      content: `
        <div class="mi-chat-card">
          <div class="mi-card-header mi-card-header--stacked">
            <span class="mi-card-actor">${attacker?.name ?? '?'} → ${defender.name}</span>
            <span class="mi-card-skill">Slip Free</span>
          </div>
          <div class="mi-card-body">
            <div class="mi-outcome-row">
              <span class="mi-outcome success">
                <i class="fas fa-check-circle"></i> ${effectNote}
              </span>
            </div>
            ${clearedGrips > 0 ? `
            <div class="mi-se-roll-row">
              <span class="mi-se-roll-label">Grips cleared</span>
              <span class="mi-se-roll-val">${clearedGrips}</span>
            </div>` : ''}
            ${clearedEntangles > 0 ? `
            <div class="mi-se-roll-row">
              <span class="mi-se-roll-label">Entangles cleared</span>
              <span class="mi-se-roll-val">${clearedEntangles}</span>
            </div>` : ''}
          </div>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor: defender })
    });

    // Flag and status cleanup — try/catch so a flag error never suppresses the card
    try {
      // Clear grippedBy and matching pendingGripCheck entries on the defender
      if (gripIds.length > 0) {
        await defender.unsetFlag(NS, 'grippedBy');
        const pendingGripCheck = defender.getFlag(NS, 'pendingGripCheck') ?? {};
        const filteredGrip = Object.fromEntries(
          Object.entries(pendingGripCheck).filter(([k]) => !gripIds.includes(k))
        );
        await defender.setFlag(NS, 'pendingGripCheck', filteredGrip);
      }

      // Clear entangledBy, token status, and attacker-side pending flags
      if (entangleEntries.length > 0) {
        await defender.unsetFlag(NS, 'entangledBy');

        try {
          await CombatEngine._removeStatusFromActor(defender, 'entangled');
        } catch (e) {
          console.warn('Mythras | Slip Free: could not remove entangled status:', e);
        }

        const entangleIds = entangleEntries.map(([k]) => k);
        const pendingBF   = defender.getFlag(NS, 'pendingEntangleBreakFree') ?? {};
        const filteredBF  = Object.fromEntries(
          Object.entries(pendingBF).filter(([k]) => !entangleIds.includes(k))
        );
        await defender.setFlag(NS, 'pendingEntangleBreakFree', filteredBF);

        for (const [entangleId, entry] of entangleEntries) {
          const aId = entry.attackerActorId;
          if (!aId) continue;
          const aActor = game.actors.get(aId);
          if (!aActor) continue;
          const pendingTrip = aActor.getFlag(NS, 'pendingEntangleTrip') ?? {};
          if (pendingTrip[entangleId]) {
            delete pendingTrip[entangleId];
            await aActor.setFlag(NS, 'pendingEntangleTrip', pendingTrip);
          }
        }
      }
    } catch (err) {
      console.error('Mythras | Slip Free flag cleanup error:', err);
    }
  }

  static async _resolveWithdraw(ctx) { return resolveWithdraw(ctx); }

  // -------------------------------------------------------------------------
  // _resolveDuckBack — SE: Duck Back (attacker, firearms only)
  //
  // Rules p.44: The shooter immediately ducks back into nearby cover without
  // spending an Action Point or waiting for their next turn. The character
  // must already be standing or crouching adjacent to cover — the GM
  // adjudicates whether cover is available.
  //
  // Narrative only — no flags, no rolls, no cross-turn state.
  // The GM should narrate the cover move at the table.
  // -------------------------------------------------------------------------

  static async _resolveDuckBack(ctx) { return resolveDuckBack(ctx); }

  // -------------------------------------------------------------------------
  // _resolveRapidReload — SE: Rapid Reload (attacker, ranged, stackable)
  //
  // Rules p.45: Reduces the reload time of the attacker's ranged weapon by 1
  // per instance selected, floored at 0. Applies to the NEXT reload — not any
  // reload already in progress. Stack count is derived from the number of times
  // 'rapidReload' appears in chosenSpecialEffects.
  //
  // Mechanically: decrements weapon.system.load directly. This is a persistent
  // item update — the reduced load stays until another SE (or manual edit)
  // changes it. This matches the rules intent: the attacker has learned a
  // quicker technique and applies it going forward.
  // -------------------------------------------------------------------------

  static async _resolveRapidReload(ctx) { return resolveRapidReload(ctx); }

  // -------------------------------------------------------------------------
  // _resolveDropFoe — SE: Drop Foe (attacker, firearms only)
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

  static async _resolveDropFoe(ctx, damage, forcesFail) { return resolveDropFoe(ctx, damage, forcesFail); }

  // -------------------------------------------------------------------------
  // _resolvePinDown — SE: Pin Down (attacker, firearms only, stackable)
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

  static async _resolvePinDown(ctx, forcesFail) { return resolvePinDown(ctx, forcesFail); }

  // -------------------------------------------------------------------------
  // _resolveOverpenetrate — SE: Over-penetration (attacker, firearms, Critical)
  //
  // Rules p.45: The shot travels completely through the first victim (assuming
  // it overcomes their body armour) and strikes a second target behind them.
  // The second victim suffers half damage. Special Effects from the first
  // attack are NOT applied to the second.
  //
  // Narrative only — the GM must identify and resolve the second target.
  // No cross-turn flags or opposed rolls needed.
  // -------------------------------------------------------------------------

  static async _resolveOverpenetrate(ctx) { return resolveOverpenetrate(ctx); }

  // -------------------------------------------------------------------------
  // _resolveCircumventCover — SE: Circumvent Cover (attacker, high-tech firearms)
  //
  // Rules p.43: Allows the shot to bypass cover protection — the target's
  // cover provides no armour or protection for this shot (e.g. target-seeking
  // rounds, phase-shifted projectiles, or similar high-tech ammunition).
  //
  // Narrative only — the GM confirms the weapon qualifies as high-tech.
  // Mechanically this SE simply signals that cover AP should not be applied
  // for this exchange. Damage calculation itself is unchanged by the system.
  // -------------------------------------------------------------------------

  static async _resolveCircumventCover(ctx) { return resolveCircumventCover(ctx); }


  // -------------------------------------------------------------------------
  // _resolveSelectTarget — SE: Select Target (defender, attacker fumbles)
  //
  // Rules p.45: When the attacker fumbles, the defender may manoeuvre or
  // deflect the blow so it strikes an adjacent bystander instead. The new
  // victim is taken by surprise, automatically hit, and suffers no SEs.
  //
  // Narrative only — no mechanical automation (requires canvas targeting and
  // GM adjudication). Posts a chat card describing the outcome.
  // No flags written, no status effects, no cross-turn state.
  // -------------------------------------------------------------------------

  static async _resolveSelectTarget(ctx) { return resolveSelectTarget(ctx); }

  // -------------------------------------------------------------------------
  // _resolveWeaponMalfunction — SE: Weapon Malfunction (defender, attacker fumbles, firearm only)
  //
  // Rules p.46: When the attacker fumbles with a firearm, the defender may
  // select Weapon Malfunction. The firearm jams and cannot be fired until the
  // attacker spends an Action Point to field-strip it (clear the jam).
  //
  // Implementation:
  //   - Flag: 'jammedWeapons' on the base actor — a set of weapon IDs.
  //     { [weaponId]: { weaponName: string } }
  //   - Character sheet combat tab shows a jammed badge + clear-jam button.
  //   - Clear-jam spends 1 AP if in combat; instant if out.
  //   - AttackerDialog blocks Attack if weapon is jammed.
  //   - Flag cleared on deleteToken (via own-flags list) and deleteItem (weapon).
  // -------------------------------------------------------------------------

  static async _resolveWeaponMalfunction(ctx) { return resolveWeaponMalfunction(ctx); }

  // -------------------------------------------------------------------------
  // _resolvePrepareCounter — Phase 1: Declaration
  //
  // Fires when the defender wins the Prepare Counter SE. Shows a radio-list
  // picker of attacker-eligible SEs. The chosen SE is written to the
  // defender's prepareCounter flag and persists until:
  //   - It triggers (Phase 2)
  //   - The attacker token is deleted (deleteToken cross-ref cleanup)
  //   - The defender token is deleted (deleteToken own-flag cleanup)
  //   - Combat ends (deleteCombat hook)
  //
  // Flag shape: { watchedSE: 'bleed', attackerActorId: '...', combatId: '...' }
  // -------------------------------------------------------------------------

  static async _resolvePrepareCounter(ctx) {
    const { attacker, defender } = ctx;
    if (!attacker || !defender) return;

    const isSemi   = CombatEngine.automationLevel === 'semi';
    const isGMMode = CombatEngine.gmMode;

    // Build list of attacker-eligible SEs the defender can watch for.
    const watchableSEs = (CONFIG.MYTHRAS?.specialEffects ?? []).filter(se => {
      if (se.who === 'defender') return false;
      if (se.id  === 'prepareCounter') return false;
      if (se.id  === 'forceFailure') return false;
      if (se.id  === 'accidentalInjury') return false;
      if (se.id  === 'weaponMalfunction') return false;
      return true;
    });

    const dialogData = {
      seType:       'prepareCounterWatch',
      defenderName: defender.name,
      lastCardId:   ctx.chatMessageId,
      watchableSEs
    };

    let watchedSE = null;
    if (isGMMode || !isSemi) {
      // GM mode or Full Auto: run locally on GM client
      watchedSE = await CombatEngine._runSEDialog(dialogData);
    } else {
      // Semi-Auto, non-GM mode: route to defender's player
      const { CombatSocket, _findDefenderUserId } = await import('./CombatSocket.js');
      const targetUserId = _findDefenderUserId(defender);
      const exchangeId   = foundry.utils.randomID(16);
      watchedSE = await CombatSocket.seChallenge(exchangeId, dialogData, targetUserId);
    }

    if (!watchedSE) return;

    const NS       = 'mythras-imperative';
    const combatId = game.combat?.id ?? null;

    await defender.setFlag(NS, 'prepareCounter', {
      watchedSE,
      attackerActorId: attacker.id,
      combatId
    });

    const seLabel = game.i18n.localize(
      watchableSEs.find(s => s.id === watchedSE)?.label ?? watchedSE
    );

    await ChatMessage.create({
      content: `
        <div class="mi-chat-card">
          <div class="mi-card-header mi-card-header--stacked">
            <span class="mi-card-actor">${defender.name}</span>
            <span class="mi-card-skill">Prepare Counter</span>
          </div>
          <div class="mi-card-body">
            <div class="mi-outcome-row">
              <span class="mi-outcome success">
                <i class="fas fa-shield-alt"></i> ${defender.name} reads their opponent's patterns and prepares a counter
              </span>
            </div>
            <p class="mi-card-note">Watching for: <strong>${seLabel}</strong></p>
          </div>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor: defender })
    });
  }

  // -------------------------------------------------------------------------
  // _triggerPrepareCounter — Phase 2: Trigger
  //
  // Called from _afterDefenceResolved when the attacker wins an SE that
  // matches the defender's watched SE. The matched SE is stripped from
  // ctx.chosenSpecialEffects before this fires so it never reaches the
  // dispatcher.
  //
  // Flow:
  //   1. Post "You've been countered!" card to chat
  //   2. Show SE picker for the defender (substitute SE)
  //   3. Resolve the substitute SE with forcesFail = true (auto-win)
  //   4. Clear the prepareCounter flag
  // -------------------------------------------------------------------------

  static async _triggerPrepareCounter(ctx, watchedSE) {
    const { attacker, defender } = ctx;
    if (!attacker || !defender) return;

    const isSemi   = CombatEngine.automationLevel === 'semi';
    const isGMMode = CombatEngine.gmMode;
    const NS = 'mythras-imperative';

    // ── 1. "You've been countered!" card ─────────────────────────────────────
    const watchedLabel = game.i18n.localize(
      (CONFIG.MYTHRAS?.specialEffects ?? []).find(s => s.id === watchedSE)?.label ?? watchedSE
    );

    const counterChatMsg = await ChatMessage.create({
      content: `
        <div class="mi-chat-card">
          <div class="mi-card-header mi-card-header--stacked">
            <span class="mi-card-actor">${attacker.name} → ${defender.name}</span>
            <span class="mi-card-skill">Prepare Counter — Triggered!</span>
          </div>
          <div class="mi-card-body">
            <div class="mi-outcome-row">
              <span class="mi-outcome fumble">
                <i class="fas fa-times-circle"></i> ${attacker.name}'s <strong>${watchedLabel}</strong> is countered!
              </span>
            </div>
            <p class="mi-card-note">${defender.name} has been waiting for this — the attempt is cancelled. ${defender.name} now selects a substitute Special Effect which succeeds automatically.</p>
          </div>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor: attacker })
    });

    // ── 2. Substitute SE picker ───────────────────────────────────────────────
    const substituteSEs = (CONFIG.MYTHRAS?.specialEffects ?? []).filter(se => {
      if (se.who === 'attacker') return false;
      if (se.id === 'prepareCounter') return false;
      if (se.id === 'forceFailure') return false;
      if (se.id === 'accidentalInjury') return false;
      return true;
    });

    const counterCardId = counterChatMsg?.id ?? null;
    const dialogData = {
      seType:       'prepareCounterSubstitute',
      lastCardId:   counterCardId,
      defenderName: defender.name,
      substituteSEs
    };

    let substituteSEId = null;
    if (isGMMode || !isSemi) {
      substituteSEId = await CombatEngine._runSEDialog(dialogData);
    } else {
      const { CombatSocket, _findDefenderUserId } = await import('./CombatSocket.js');
      const targetUserId = _findDefenderUserId(defender);
      const exchangeId   = foundry.utils.randomID(16);
      substituteSEId = await CombatSocket.seChallenge(exchangeId, dialogData, targetUserId);
    }

    // ── 3. Clear the flag ─────────────────────────────────────────────────────
    try { await defender.unsetFlag(NS, 'prepareCounter'); } catch (_) {}

    if (!substituteSEId) return;

    // ── 4. Fire the substitute SE — inject forceFailure so opposed rolls auto-win
    const substituteCtx = {
      ...ctx,
      seWinner:             'defender',
      chosenSpecialEffects: [substituteSEId, 'forceFailure']
    };

    await CombatEngine._resolveOpposedSEs(substituteCtx, 0);
  }

  // -------------------------------------------------------------------------
  // _resolveBash — SE: Bash (attacker, shield or bludgeoning weapons).
  //
  // Rules p.43:
  //   Knockback distance uses RAW damage (pre-parry, pre-armour):
  //     Shield:      ceil(rawDamage / 2) metres
  //     Bludgeoning: ceil(rawDamage / 3) metres
  //
  //   Size restriction: only targets up to twice the attacker's SIZ.
  //     If the defender's SIZ exceeds this, the bash still hits but has
  //     no knockback (too massive to shift).
  //
  //   Obstacle check (optional): if the GM declares the target was forced
  //   into an obstacle, they must roll Hard Athletics or Acrobatics.
  //   Failure → Prone.
  //
  //   Full Auto: posts distance and a note that the GM resolves any
  //   obstacle collision narratively (no dialog).
  //
  //   Semi-Auto (GM Mode): after the distance card, a dialog asks whether
  //   an obstacle was hit. If yes, the defender rolls Athletics or
  //   Acrobatics at Hard difficulty. Failure → Prone applied.
  //
  // No flags written — Bash is fully resolved within this exchange.
  // No cross-turn state. rawDamage must be on ctx before this fires.
  // -------------------------------------------------------------------------

  static async _resolveBash(ctx) {
    const { attacker, defender, weapon } = ctx;
    if (!attacker || !defender || !weapon) return;

    const isSemi   = CombatEngine.automationLevel === 'semi';
    const isGMMode = CombatEngine.gmMode;

    // ── Weapon type: shield or bludgeoning ──────────────────────────────────
    const traits    = weapon.system?.traits ?? [];
    const isShield  = traits.includes('shield');
    const divisor   = isShield ? 2 : 3;
    const typeLabel = isShield ? 'Shield' : 'Bludgeoning';

    // ── Raw damage (pre-parry, pre-armour) ───────────────────────────────────
    // ctx.rawDamage is set by _resolveFullAutoDamage (Full Auto) and by the
    // Apply Damage handler via data-raw-damage on the button (Semi-Auto).
    // Fall back through damageAfterParry, then the damage arg from _applyDamage.
    const rawDamage = (ctx.rawDamage > 0 ? ctx.rawDamage : null)
                   ?? (ctx.damageAfterParry > 0 ? ctx.damageAfterParry : null)
                   ?? 0;
    if (rawDamage <= 0) {
      console.warn('Mythras Imperative | Bash: rawDamage is 0 — cannot calculate knockback. ctx.rawDamage:', ctx.rawDamage, 'ctx.damageAfterParry:', ctx.damageAfterParry);
      return;
    }

    const knockbackMetres = Math.ceil(rawDamage / divisor);

    // ── SIZ check ────────────────────────────────────────────────────────────
    const attackerSIZ  = attacker.system?.characteristics?.siz?.value ?? 0;
    const defenderSIZ  = defender.system?.characteristics?.siz?.value ?? 0;
    const sizLimit     = attackerSIZ * 2;
    const tooBig       = defenderSIZ > sizLimit;

    if (tooBig) {
      // Too large to knock back — narrative card only
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
    // Full Auto: GM narrates. Semi-Auto non-GM: the card prompts the GM to act.
    if (!isSemi || !isGMMode) return;

    // Show the obstacle dialog on the GM client
    const hitObstacle = await CombatEngine._runSEDialog({
      seType:       'bashObstacle',
      lastCardId:   ctx.chatMessageId,
      attackerName: attacker.name,
      defenderName: defender.name,
      knockback:    knockbackMetres,
      typeLabel
    });

    if (!hitObstacle) return; // GM declared no obstacle

    // Obstacle hit — defender rolls Hard Athletics or Acrobatics
    const athleticsSkill  = Array.from(defender.items).find(i => i.type === 'skill' && i.name === 'Athletics');
    const acrobaticsSkill = Array.from(defender.items).find(i => i.type === 'skill' && i.name === 'Acrobatics');

    const _adj = (raw) => {
      const afterFatigue = CombatEngine._applyFatigueToSkill(raw, defender);
      // Hard: × 0.667
      return Math.ceil(afterFatigue * CONFIG.MYTHRAS.difficultyGrades.hard.multiplier);
    };

    const skillOptions = [
      athleticsSkill  && { name: 'Athletics',   rawTotal: athleticsSkill.system.total  ?? 0, total: _adj(athleticsSkill.system.total  ?? 0) },
      acrobaticsSkill && { name: 'Acrobatics',  rawTotal: acrobaticsSkill.system.total ?? 0, total: _adj(acrobaticsSkill.system.total ?? 0) }
    ].filter(Boolean);

    if (skillOptions.length === 0) skillOptions.push({ name: 'Athletics', rawTotal: 0, total: 0 });

    const response = await CombatEngine._runSEDialog({
      seType:       'bashObstacleRoll',
      lastCardId:   ctx.chatMessageId,
      attackerName: attacker.name,
      defenderName: defender.name,
      knockback:    knockbackMetres,
      skillOptions
    });

    const roll          = response?.roll    ?? null;
    const defenderSaved = response?.succeeds ?? false;

    if (!defenderSaved) {
      await CombatEngine._applyStatusToActor(defender, 'prone');
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

  // -------------------------------------------------------------------------
  // _resolveDamageWeapon — SE: Damage Weapon (attacker or defender).
  //
  // Rules p.43:
  //   Attacker wins SE → damage roll applied to defender's parrying weapon
  //   Defender wins SE → damage roll applied to attacker's striking weapon
  //
  //   The target weapon's own AP absorbs first. Surplus reduces currentHP.
  //   If currentHP reaches 0 or below the weapon breaks.
  //
  //   Damage value: ctx.rawDamage (pre-parry, pre-armour). Falls back to
  //   ctx.damageAfterParry if rawDamage absent (Semi-Auto edge case).
  //
  //   No opposed roll. No dialog. Automatic in all automation modes.
  // -------------------------------------------------------------------------

  static async _resolveDamageWeapon(ctx) {
    const { attacker, defender } = ctx;
    if (!attacker || !defender) return;

    const damageIsOffensive = ctx.seWinner === 'attacker';

    // Which weapon is being damaged, and who owns it?
    const targetWeapon = damageIsOffensive ? ctx.defenceWeapon : ctx.weapon;
    const targetActor  = damageIsOffensive ? defender          : attacker;
    const damagerActor = damageIsOffensive ? attacker          : defender;

    if (!targetWeapon) {
      // No weapon to damage (unarmed attacker won SE, or attacker won SE
      // but defender didn't parry) — post a brief narrative card and return.
      await ChatMessage.create({
        content: `
          <div class="mi-chat-card">
            <div class="mi-card-header mi-card-header--stacked">
              <span class="mi-card-actor">${damagerActor.name} → ${targetActor.name}</span>
              <span class="mi-card-skill">Damage Weapon</span>
            </div>
            <div class="mi-card-body">
              <div class="mi-outcome-row">
                <span class="mi-outcome mi-wound-minor">
                  <i class="fas fa-hammer"></i> No weapon to damage
                </span>
              </div>
            </div>
          </div>`,
        speaker: ChatMessage.getSpeaker({ actor: damagerActor })
      });
      return;
    }

    // ── Damage value ────────────────────────────────────────────────────────
    // The weapon takes the full unmodified attack roll — before parry and
    // before armour. rawDamage is set by the Full Auto pipeline and by the
    // Semi-Auto Apply Damage handler (via data-raw-damage on the button).
    const rawDamage = (ctx.rawDamage > 0 ? ctx.rawDamage : null)
                   ?? (ctx.damageAfterParry > 0 ? ctx.damageAfterParry : null)
                   ?? 0;

    // ── Apply to weapon ─────────────────────────────────────────────────────
    const weaponAP      = targetWeapon.system.ap        ?? 0;
    const weaponMaxHP   = targetWeapon.system.hp         ?? 0;
    const weaponCurrent = targetWeapon.system.currentHP  ?? weaponMaxHP;

    // Weapon AP absorbs first; surplus chips away at HP
    const surplus    = Math.max(0, rawDamage - weaponAP);
    const newCurrent = weaponCurrent - surplus;
    const broken     = newCurrent <= 0;

    if (surplus > 0) {
      await targetWeapon.update({ 'system.currentHP': newCurrent });
    }

    // ── Post card ───────────────────────────────────────────────────────────
    const outcomeClass = broken        ? 'mi-wound-major'
                       : surplus > 0   ? 'mi-wound-serious'
                       :                 'success';
    const outcomeIcon  = broken        ? 'fa-times-circle'
                       : surplus > 0   ? 'fa-exclamation-circle'
                       :                 'fa-check-circle';
    const outcomeText  = broken
      ? `${targetWeapon.name} is BROKEN`
      : surplus > 0
        ? `${targetWeapon.name} takes ${surplus} damage (${newCurrent}/${weaponMaxHP} HP)`
        : `${targetWeapon.name} absorbs the blow — no HP damage (${weaponAP} AP)`;

    await ChatMessage.create({
      content: `
        <div class="mi-chat-card">
          <div class="mi-card-header mi-card-header--stacked">
            <span class="mi-card-actor">${damagerActor.name} → ${targetActor.name}</span>
            <span class="mi-card-skill">Damage Weapon — ${targetWeapon.name}</span>
          </div>
          <div class="mi-card-body">
            <div class="mi-se-roll-row">
              <span class="mi-se-roll-label">Damage roll</span>
              <span class="mi-se-roll-val">${rawDamage}</span>
            </div>
            <div class="mi-se-roll-row">
              <span class="mi-se-roll-label">Weapon AP / HP</span>
              <span class="mi-se-roll-val">${weaponAP} AP · ${weaponCurrent}/${weaponMaxHP} HP</span>
            </div>
            ${surplus > 0 ? `
            <div class="mi-se-roll-row">
              <span class="mi-se-roll-label">Surplus (over AP)</span>
              <span class="mi-se-roll-val">${surplus}</span>
            </div>` : ''}
            <div class="mi-outcome-row">
              <span class="mi-outcome ${outcomeClass}">
                <i class="fas ${outcomeIcon}"></i> ${outcomeText}
              </span>
            </div>
            ${broken ? `
            <div class="mi-outcome-row">
              <span class="mi-outcome mi-wound-major">
                <i class="fas fa-ban"></i>
                ${targetActor.name} can no longer use ${targetWeapon.name} until repaired
              </span>
            </div>` : ''}
          </div>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor: damagerActor })
    });
  }

  // -------------------------------------------------------------------------
  // _resolvePinWeapon — SE: Pin Weapon (defender only).
  //
  // Rules p.45: The defender traps the attacker's striking weapon between
  // their own weapon or body, preventing it from being used to parry until
  // the attacker frees it. Pin lasts until end of the current Mythras round.
  //
  // State: 'pinnedWeapons' flag on the attacker:
  //   { [pinId]: { weaponId, weaponName, pinnedByActorId, pinnedByName } }
  //
  // Enforcement: _buildParryWeaponList in DefenderDialog filters out any
  // weapon whose id appears in the owner's pinnedWeapons flag.
  //
  // Cleared: in the allSpent block (end of Mythras round) and deleteToken.
  //
  // No opposed roll. No dialog. Automatic.
  // -------------------------------------------------------------------------

  static async _resolvePinWeapon(ctx) {
    const { attacker, defender, weapon } = ctx;
    if (!attacker || !defender || !weapon) return;

    const NS            = 'mythras-imperative';
    const pinId         = foundry.utils.randomID(8);
    const pinnedWeapons = attacker.getFlag(NS, 'pinnedWeapons') ?? {};

    pinnedWeapons[pinId] = {
      weaponId:        weapon.id,
      weaponName:      weapon.name,
      pinnedByActorId: defender.id,
      pinnedByName:    defender.name
    };

    await attacker.setFlag(NS, 'pinnedWeapons', pinnedWeapons);

    await ChatMessage.create({
      content: `
        <div class="mi-chat-card">
          <div class="mi-card-header mi-card-header--stacked">
            <span class="mi-card-actor">${defender.name} → ${attacker.name}</span>
            <span class="mi-card-skill">Pin Weapon</span>
          </div>
          <div class="mi-card-body">
            <div class="mi-outcome-row">
              <span class="mi-outcome mi-wound-serious">
                <i class="fas fa-lock"></i>
                ${attacker.name}'s ${weapon.name} is pinned — cannot parry this round
              </span>
            </div>
          </div>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor: defender })
    });
  }

  // -------------------------------------------------------------------------
  // _applySunder — core Sunder arithmetic and armour AP write.
  // Rules p.46:
  //   1. All incoming damage (after parry) is absorbed by the armour — it does
  //      NOT pass through to HP on its own.
  //   2. The surplus over the armour's AP is used to reduce the AP permanently.
  //      surplus = damage − armourAP  (if positive)
  //   3. Only if that surplus is large enough to drive AP to zero does any
  //      excess carry over to the location's HP.
  //      carryOver = max(0, surplus − currentAP)
  //
  //   Example: 7 damage, 5 AP armour
  //     absorbed = 5, surplus = 2, AP reduced by 2 → 3 AP, carryOver = 0
  //   Example: 12 damage, 5 AP armour
  //     absorbed = 5, surplus = 7, AP reduced by 5 → 0 AP, carryOver = 2
  //
  // Worn armour is reduced before natural AP.
  // AP reduction is stored in the actor flag 'sunderedAP' keyed by locKey —
  // the armour item's system.ap is never mutated.
  // -------------------------------------------------------------------------

  static async _applySunder(defender, locationId, damageAfterParry, weapon) {
    // ── Identify location and locKey ──────────────────────────────────────
    const locItem = CombatEngine._getItem(defender, locationId);
    let locKey    = null;
    if (locItem) {
      const label = locItem.system.label ?? locItem.name ?? '';
      locKey = label.trim()
        .replace(/\s+(\w)/g, (_, c) => c.toUpperCase())
        .replace(/^(\w)/, c => c.toLowerCase());
    }

    const NS         = 'mythras-imperative';
    const sunderedAP = foundry.utils.deepClone(
      defender.getFlag(NS, 'sunderedAP') ?? {}
    );
    const existingSunderAtLoc = locKey ? (sunderedAP[locKey] ?? 0) : 0;

    // Worn armour items at this location
    const wornItems = locKey
      ? Array.from(defender.items).filter(i =>
          i.type === 'armour' && i.system.equipped && i.system.locations?.[locKey])
      : [];

    // Effective AP at this location after any prior sunder reductions
    const naturalApBase = locItem?.system.ap ?? 0;
    const wornApBase    = wornItems.reduce((s, i) => s + (i.system.ap ?? 0), 0);
    const priorWornRed  = Math.min(existingSunderAtLoc, wornApBase);
    const priorNatRed   = Math.min(Math.max(0, existingSunderAtLoc - priorWornRed), naturalApBase);
    const effectiveWornAP    = Math.max(0, wornApBase    - priorWornRed);
    const effectiveNaturalAP = Math.max(0, naturalApBase - priorNatRed);
    const totalApBefore      = effectiveWornAP + effectiveNaturalAP;

    const damage    = damageAfterParry;
    const affectedNames = [];
    let wornApReduction    = 0;
    let naturalApReduction = 0;
    let carryOver          = 0;

    // ── Step 1: Apply against worn AP ────────────────────────────────────
    // Rules p.46: all damage is absorbed by the armour. surplus = damage − AP.
    // surplus reduces AP by that amount (capped at full AP). Only if surplus
    // exceeds the full AP value does the excess carry over to the next layer.
    if (effectiveWornAP > 0) {
      const surplus = damage - effectiveWornAP;
      if (surplus <= 0) {
        // damage ≤ worn AP — armour absorbs everything intact, no AP reduction
        wornApReduction = 0;
        carryOver       = 0;
      } else {
        // damage > worn AP — AP reduced by surplus, capped at full worn AP
        wornApReduction = Math.min(surplus, effectiveWornAP);
        carryOver       = surplus - wornApReduction; // > 0 only if worn fully wiped
        if (wornItems.length > 0) {
          affectedNames.push(
            `${wornItems.map(i => i.name).join(', ')} (${effectiveWornAP} → ${effectiveWornAP - wornApReduction} AP at this location)`
          );
        }
      }
    } else {
      // No worn AP — damage passes through to natural AP
      carryOver = damage;
    }

    // ── Step 2: Apply carry-over against natural AP ───────────────────────
    if (carryOver > 0 && effectiveNaturalAP > 0) {
      const surplus = carryOver - effectiveNaturalAP;
      if (surplus <= 0) {
        // carry-over ≤ natural AP — no AP reduction, no HP damage
        naturalApReduction = 0;
        carryOver = 0;
      } else {
        // carry-over > natural AP — AP reduced by surplus, capped at full natural AP
        naturalApReduction = Math.min(surplus, effectiveNaturalAP);
        carryOver = surplus - naturalApReduction;
      }
      if (naturalApReduction > 0) {
        affectedNames.push(
          `Natural armour (${effectiveNaturalAP} → ${effectiveNaturalAP - naturalApReduction} AP)`
        );
      }
    } else if (effectiveNaturalAP === 0) {
      // No natural AP — carryOver passes straight to HP
    } else {
      carryOver = 0;
    }

    // ── Write sunderedAP flag ─────────────────────────────────────────────
    const totalReduction = wornApReduction + naturalApReduction;
    if (totalReduction > 0 && locKey) {
      sunderedAP[locKey] = existingSunderAtLoc + totalReduction;
      await defender.setFlag(NS, 'sunderedAP', sunderedAP);
    }

    const wornApAfter    = effectiveWornAP    - wornApReduction;
    const naturalApAfter = effectiveNaturalAP - naturalApReduction;

    return {
      wornApBefore:    effectiveWornAP,
      naturalApBefore: effectiveNaturalAP,
      wornApAfter,
      naturalApAfter,
      totalApBefore,
      totalApAfter:    wornApAfter + naturalApAfter,
      apReduced:       totalReduction,
      carryOver,
      affectedNames
    };
  }

  // -------------------------------------------------------------------------
  // _resolveImpale — posts the lodge/yank decision card.
  // Called from _resolveOpposedSEs when impale is chosen and damage > 0.
  // Both Semi-Auto and Full Auto reach this path — the decision card is always
  // presented because the attacker must choose (rules p.44).
  // -------------------------------------------------------------------------

  static async _resolveImpale(ctx, damage) {
    const { attacker, defender, weapon } = ctx;
    if (!attacker || !defender || !weapon) return;

    // Grade from Impale Effects Table
    const defenderSIZ = defender.system?.characteristics?.siz?.value ?? 13;
    const weaponSize  = weapon.system?.size ?? 'M';
    const gradeId     = CombatEngine._getImpaleGrade(weaponSize, defenderSIZ);

    // Grade label for display
    const gradeLabels = {
      none:          'No additional penalty',
      hard:          'Hard (all skills)',
      formidable:    'Formidable (all skills)',
      herculean:     'Herculean (all skills)',
      incapacitated: 'Incapacitated (status effect)'
    };
    const gradeDisplay = gradeLabels[gradeId] ?? gradeId;

    // Half-damage formula — weapon base dice only, no DM (rules p.44)
    // We store the base formula so the yank handler can roll it later.
    const halfDmgFormula = weapon.system?.damage ?? '1d4';

    // Unique entry key for the impaledBy flag
    const impaleEntryId = foundry.utils.randomID(8);

    // Post an immediate notification card so the table knows the weapon lodged,
    // then write a pending flag to the attacker — the lodge/yank decision card
    // will appear at the START of the attacker's next turn via updateCombat.
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
              <span class="mi-se-roll-label">Penalty while lodged</span>
              <span class="mi-se-roll-val">${gradeDisplay}</span>
            </div>
            <p class="mi-se-roll-note">Leave In / Yank Free decision will appear at the start of ${attacker.name}'s next turn.</p>
          </div>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor: attacker })
    });

    // Store the pending decision on the attacker so updateCombat can post it next turn.
    const pendingImpales = attacker.getFlag('mythras-imperative', 'pendingImpales') ?? {};
    pendingImpales[impaleEntryId] = {
      defenderId:       defender.id,
      weaponId:         weapon.id,
      impaleEntryId,
      gradeId,
      gradeDisplay,
      hitLocationId:    ctx.hitLocationId   ?? '',
      hitLocationLabel: ctx.hitLocationLabel ?? '',
      halfDmgFormula,
      attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
          lastCardId:         ctx.chatMessageId,
      defenderName:     defender.name,
      weaponName:       weapon.name
    };
    await attacker.setFlag('mythras-imperative', 'pendingImpales', pendingImpales);
  }

  // -------------------------------------------------------------------------
  // _resolveEntangleTrip — called from updateCombat at the start of the
  // attacker's (wielder's) turn. Posts a card offering to spend 1 AP for
  // an automatic Trip attempt. The entangled victim gets an opposed Brawn roll.
  // If declined, the attacker acts normally (no mechanical effect).
  // entry: one entry from flags['mythras-imperative'].pendingEntangleTrip
  // -------------------------------------------------------------------------

  static async _postEntangleTripCard(attackerActor, entry) {
    const { defenderId, defenderName, attackerRoll, attackerSkillTotal, locationLabel, entangleId } = entry;

    await ChatMessage.create({
      content: `
        <div class="mi-chat-card">
          <div class="mi-card-header mi-card-header--stacked">
            <span class="mi-card-actor">${attackerActor.name} → ${defenderName}</span>
            <span class="mi-card-skill">Entangle — Trip Attempt?</span>
          </div>
          <div class="mi-card-body">
            <div class="mi-outcome-row">
              <span class="mi-outcome mi-wound-serious">
                <i class="fas fa-spider"></i> ${defenderName} is still entangled at ${locationLabel}
              </span>
            </div>
            <p class="mi-se-roll-note">
              ${attackerActor.name} may spend 1 AP to attempt an automatic Trip against ${defenderName}.<br>
              ${defenderName} will resist with Brawn if the trip is attempted.
            </p>
            <div class="mi-manual-actions">
              <button class="mi-btn mi-btn-entangle-trip-yes"
                data-attacker-id="${attackerActor.id}"
                data-defender-id="${defenderId}"
                data-attacker-roll="${attackerRoll}"
                data-attacker-skill-total="${attackerSkillTotal}"
                data-entangle-id="${entangleId}">
                <i class="fas fa-hiking"></i> Spend 1 AP — Trip ${defenderName}
              </button>
              <button class="mi-btn mi-btn-entangle-trip-no"
                data-attacker-id="${attackerActor.id}"
                data-entangle-id="${entangleId}">
                <i class="fas fa-times"></i> Skip — Act normally
              </button>
            </div>
          </div>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
      flags: {
        'mythras-imperative': {
          stage:       'entangle-trip',
          attackerId:  attackerActor.id,
          defenderId,
          entangleId
        }
      }
    });
  }

  // Called when attacker clicks "Spend 1 AP — Trip"
  static async _resolveEntangleTripYes(btn) {
    const attackerId       = btn.dataset.attackerId;
    const defenderId       = btn.dataset.defenderId;
    const attackerRoll     = parseInt(btn.dataset.attackerRoll ?? '0', 10);
    const attackerSkillTotal = parseInt(btn.dataset.attackerSkillTotal ?? '0', 10);
    const entangleId       = btn.dataset.entangleId;

    const attacker = game.actors.get(attackerId);
    const defender = game.actors.get(defenderId);
    if (!attacker || !defender) return;

    // Spend the AP
    const remaining = await CombatEngine._spendActionPoint(attacker);
    if (remaining === 0 && remaining !== null) {
      // Already warned by _spendActionPoint — bail
    }

    const isSemi   = CombatEngine.automationLevel === 'semi';
    const isGMMode = CombatEngine.gmMode;

    // Defender resists with Brawn — same opposed pattern as Trip
    const brawnSkill = Array.from(defender.items).find(i => i.type === 'skill' && i.name === 'Brawn');
    const brawnRaw   = brawnSkill?.system.total ?? 0;
    const brawnTotal = CombatEngine._applyFatigueToSkill(brawnRaw, defender);

    let defenderRoll     = null;
    let defenderSucceeds = false;

    if (isSemi && !isGMMode) {
      const { CombatSocket, _findDefenderUserId } = await import('./CombatSocket.js');
      const targetUserId = _findDefenderUserId(defender);
      const exchangeId   = foundry.utils.randomID(16);
      const response = await CombatSocket.seChallenge(exchangeId, {
        seType:             'entangleTrip',
        attackerName:       attacker.name,
        defenderName:       defender.name,
        attackRoll:         attackerRoll,
        attackerSkillTotal,
        defenderSkill:      'Brawn',
        defenderRaw:        brawnRaw,
        defenderTotal:      brawnTotal
      }, targetUserId);
      defenderRoll     = response?.roll     ?? null;
      defenderSucceeds = response?.succeeds ?? false;
    } else if (isSemi && isGMMode) {
      const response = await CombatEngine._runSEDialog({
        seType:             'entangleTrip',
        attackerName:       attacker.name,
        defenderName:       defender.name,
        attackRoll:         attackerRoll,
        attackerSkillTotal,
        lastCardId:         null,
        defenderSkill:      'Brawn',
        defenderRaw:        brawnRaw,
        defenderTotal:      brawnTotal
      });
      defenderRoll     = response?.roll     ?? null;
      defenderSucceeds = response?.succeeds ?? false;
    } else {
      const roll = new Roll('1d100');
      await roll.evaluate();
      defenderRoll     = roll.total;
      defenderSucceeds = CombatEngine._resolveOpposedRoll(
        attackerRoll, attackerSkillTotal,
        defenderRoll, brawnTotal
      );
    }

    const tripApplied = !defenderSucceeds;
    if (tripApplied) await CombatEngine._applyProneToDefender(defender);

    await ChatMessage.create({
      content: `
        <div class="mi-chat-card">
          <div class="mi-card-header mi-card-header--stacked">
            <span class="mi-card-actor">${attacker.name} → ${defender.name}</span>
            <span class="mi-card-skill">Entangle Trip — ${tripApplied ? 'Success' : 'Resisted'}</span>
          </div>
          <div class="mi-card-body">
            <div class="mi-outcome-row">
              <span class="mi-outcome ${tripApplied ? 'success' : 'mi-wound-minor'}">
                <i class="fas fa-${tripApplied ? 'check-circle' : 'times-circle'}"></i>
                ${tripApplied ? `${defender.name} is knocked prone` : `${defender.name} maintains balance`}
              </span>
            </div>
            <div class="mi-se-roll-row">
              <span class="mi-se-roll-label">${defender.name} — Brawn</span>
              <span class="mi-se-roll-val">${defenderRoll ?? 'auto'} vs ${brawnTotal}%</span>
            </div>
          </div>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor: attacker })
    });
  }

  // -------------------------------------------------------------------------
  // _resolveEntangleBreakFree — called from updateCombat at the start of the
  // entangled victim's turn. Posts a Brawn roll dialog.
  // entry: one entry from flags['mythras-imperative'].pendingEntangleBreakFree
  // -------------------------------------------------------------------------

  static async _resolveEntangleBreakFree(entangledActor, entry, entangleId) {
    const { attackerActorId, attackerName, attackerRoll, attackerSkillTotal, weaponName, locationLabel, gradeHard } = entry;

    const isSemi   = CombatEngine.automationLevel === 'semi';
    const isGMMode = CombatEngine.gmMode;

    const brawnSkill = Array.from(entangledActor.items).find(i => i.type === 'skill' && i.name === 'Brawn');
    const brawnRaw   = brawnSkill?.system.total ?? 0;
    const brawnTotal = CombatEngine._applyFatigueToSkill(brawnRaw, entangledActor);

    let defenderRoll = null;
    let freeSucceeds = false;

    if (isSemi && !isGMMode) {
      const { CombatSocket, _findDefenderUserId } = await import('./CombatSocket.js');
      const targetUserId = _findDefenderUserId(entangledActor);
      const exchangeId   = foundry.utils.randomID(16);
      const response = await CombatSocket.seChallenge(exchangeId, {
        seType:             'entangleBreakFree',
        attackerName,
        defenderName:       entangledActor.name,
        attackRoll:         attackerRoll,
        attackerSkillTotal,
        defenderSkill:      'Brawn',
        defenderRaw:        brawnRaw,
        defenderTotal:      brawnTotal,
        weaponName,
        locationLabel
      }, targetUserId);
      defenderRoll = response?.roll     ?? null;
      freeSucceeds = response?.succeeds ?? false;
    } else if (isSemi && isGMMode) {
      const response = await CombatEngine._runSEDialog({
        seType:             'entangleBreakFree',
        attackerName,
        defenderName:       entangledActor.name,
        attackRoll:         attackerRoll,
        attackerSkillTotal,
        lastCardId:         null,
        defenderSkill:      'Brawn',
        defenderRaw:        brawnRaw,
        defenderTotal:      brawnTotal,
        weaponName,
        locationLabel
      });
      defenderRoll = response?.roll     ?? null;
      freeSucceeds = response?.succeeds ?? false;
    } else {
      const roll = new Roll('1d100');
      await roll.evaluate();
      defenderRoll = roll.total;
      freeSucceeds = CombatEngine._resolveOpposedRoll(
        attackerRoll, attackerSkillTotal,
        defenderRoll, brawnTotal
      );
    }

    if (freeSucceeds) {
      // Clear entangle state
      const entangledBy = entangledActor.getFlag('mythras-imperative', 'entangledBy') ?? {};
      delete entangledBy[entangleId];
      await entangledActor.setFlag('mythras-imperative', 'entangledBy', entangledBy);

      // Remove the entangled token status if no other entangle entries remain
      if (Object.keys(entangledBy).length === 0) {
        await CombatEngine._removeStatusFromActor(entangledActor, 'entangled');
      }

      // Also clear the attacker's pending trip for this entangle if still present
      const attackerActor = game.actors.get(attackerActorId);
      if (attackerActor) {
        const pending = attackerActor.getFlag('mythras-imperative', 'pendingEntangleTrip') ?? {};
        if (pending[entangleId]) {
          delete pending[entangleId];
          await attackerActor.setFlag('mythras-imperative', 'pendingEntangleTrip', pending);
        }
      }

      await ChatMessage.create({
        content: `
          <div class="mi-chat-card">
            <div class="mi-card-header mi-card-header--stacked">
              <span class="mi-card-actor">${entangledActor.name} vs ${attackerName}</span>
              <span class="mi-card-skill">Break Free from Entangle — Success</span>
            </div>
            <div class="mi-card-body">
              <div class="mi-outcome-row">
                <span class="mi-outcome success">
                  <i class="fas fa-check-circle"></i> ${entangledActor.name} yanks free of ${weaponName}
                </span>
              </div>
              <div class="mi-se-roll-row">
                <span class="mi-se-roll-label">${entangledActor.name} — Brawn</span>
                <span class="mi-se-roll-val">${defenderRoll ?? 'auto'} vs ${brawnTotal}%</span>
              </div>
            </div>
          </div>`,
        speaker: ChatMessage.getSpeaker({ actor: entangledActor })
      });
    } else {
      // Still entangled — re-queue for next turn
      const pendingBreakFree = entangledActor.getFlag('mythras-imperative', 'pendingEntangleBreakFree') ?? {};
      pendingBreakFree[entangleId] = entry;
      await entangledActor.setFlag('mythras-imperative', 'pendingEntangleBreakFree', pendingBreakFree);

      await ChatMessage.create({
        content: `
          <div class="mi-chat-card">
            <div class="mi-card-header mi-card-header--stacked">
              <span class="mi-card-actor">${entangledActor.name} vs ${attackerName}</span>
              <span class="mi-card-skill">Break Free from Entangle — Failed</span>
            </div>
            <div class="mi-card-body">
              <div class="mi-outcome-row">
                <span class="mi-outcome mi-wound-minor">
                  <i class="fas fa-times-circle"></i> ${entangledActor.name} cannot break free — still entangled. May try again next turn.
                </span>
              </div>
              <div class="mi-se-roll-row">
                <span class="mi-se-roll-label">${entangledActor.name} — Brawn</span>
                <span class="mi-se-roll-val">${defenderRoll ?? 'auto'} vs ${brawnTotal}%</span>
              </div>
            </div>
          </div>`,
        speaker: ChatMessage.getSpeaker({ actor: entangledActor })
      });
    }
  }

  // -------------------------------------------------------------------------
  // _resolveGripBreakFree — called from updateCombat at the start of the
  // gripped actor's turn. Posts the break-free dialog (Semi-Auto) or rolls
  // silently (Full Auto). Clears flags on success; re-queues on failure.
  // grippedActor: the actor who is currently gripped.
  // entry: one entry from flags['mythras-imperative'].pendingGripCheck
  // -------------------------------------------------------------------------

  static async _resolveGripBreakFree(grippedActor, entry, gripEntryId) {
    const { gripperActorId, gripperName, gripperSkillName, gripperSkillTotal } = entry;

    const gripper = game.actors.get(gripperActorId);
    const isSemi  = CombatEngine.automationLevel === 'semi';
    const isGMMode = CombatEngine.gmMode;

    // Skills available to the gripped actor
    const brawnSkill   = Array.from(grippedActor.items).find(i => i.type === 'skill' && i.name === 'Brawn');
    const unarmedSkill = Array.from(grippedActor.items).find(i => i.type === 'skill' && i.name === 'Unarmed');

    const _adj = raw => CombatEngine._applyFatigueToSkill(raw, grippedActor);
    const skillOptions = [
      brawnSkill   && { name: 'Brawn',   rawTotal: brawnSkill.system.total   ?? 0, total: _adj(brawnSkill.system.total   ?? 0) },
      unarmedSkill && { name: 'Unarmed', rawTotal: unarmedSkill.system.total ?? 0, total: _adj(unarmedSkill.system.total ?? 0) }
    ].filter(Boolean);
    if (skillOptions.length === 0) skillOptions.push({ name: 'Brawn', rawTotal: 0, total: 0 });

    let chosenSkill  = skillOptions.reduce((best, sk) => sk.total > best.total ? sk : best);
    let defenderRoll = null;
    let freeSucceeds = false;

    if (isSemi && !isGMMode) {
      const { CombatSocket, _findDefenderUserId } = await import('./CombatSocket.js');
      const targetUserId = _findDefenderUserId(grippedActor);
      const exchangeId   = foundry.utils.randomID(16);
      const response = await CombatSocket.seChallenge(exchangeId, {
        seType:             'gripBreakFree',
        attackerName:       gripperName,
        defenderName:       grippedActor.name,
        attackRoll:         gripperSkillTotal,
        attackerSkillTotal: gripperSkillTotal,
        lastCardId:         null,
        defenderSkill:      chosenSkill.name,
        defenderRaw:        chosenSkill.rawTotal,
        defenderTotal:      chosenSkill.total,
        skillOptions,
        gripperName,
        gripperSkillName,
        gripperSkillTotal,
        gripperSkillRaw:    entry.gripperSkillRaw ?? gripperSkillTotal
      }, targetUserId);
      if (response) {
        chosenSkill  = { name: response.chosenSkillName, total: response.chosenSkillTotal, rawTotal: response.chosenSkillRaw ?? response.chosenSkillTotal };
        defenderRoll = response.roll;
        freeSucceeds = response.succeeds;
      }
    } else if (isSemi && isGMMode) {
      const response = await CombatEngine._runSEDialog({
        seType:             'gripBreakFree',
        attackerName:       gripperName,
        defenderName:       grippedActor.name,
        attackRoll:         gripperSkillTotal,
        attackerSkillTotal: gripperSkillTotal,
        lastCardId:         null,
        defenderSkill:      chosenSkill.name,
        defenderRaw:        chosenSkill.rawTotal,
        defenderTotal:      chosenSkill.total,
        skillOptions,
        gripperName,
        gripperSkillName,
        gripperSkillTotal,
        gripperSkillRaw:    entry.gripperSkillRaw ?? gripperSkillTotal
      });
      if (response) {
        chosenSkill  = { name: response.chosenSkillName, total: response.chosenSkillTotal, rawTotal: response.chosenSkillRaw ?? response.chosenSkillTotal };
        defenderRoll = response.roll;
        freeSucceeds = response.succeeds;
      }
    } else {
      // Full Auto — pick best, roll silently
      const roll = new Roll('1d100');
      await roll.evaluate();
      defenderRoll = roll.total;
      freeSucceeds = CombatEngine._resolveOpposedRoll(
        gripperSkillTotal, gripperSkillTotal,
        defenderRoll, chosenSkill.total
      );
    }

    if (freeSucceeds) {
      // Clear grip state from the gripped actor
      const grippedBy = grippedActor.getFlag('mythras-imperative', 'grippedBy') ?? {};
      delete grippedBy[gripEntryId];
      await grippedActor.setFlag('mythras-imperative', 'grippedBy', grippedBy);

      await ChatMessage.create({
        content: `
          <div class="mi-chat-card">
            <div class="mi-card-header mi-card-header--stacked">
              <span class="mi-card-actor">${grippedActor.name} vs ${gripperName}</span>
              <span class="mi-card-skill">Break Free — Success</span>
            </div>
            <div class="mi-card-body">
              <div class="mi-outcome-row">
                <span class="mi-outcome success">
                  <i class="fas fa-check-circle"></i> ${grippedActor.name} breaks free from ${gripperName}'s grip
                </span>
              </div>
              <div class="mi-se-roll-row">
                <span class="mi-se-roll-label">${grippedActor.name} — ${chosenSkill.name}</span>
                <span class="mi-se-roll-val">${defenderRoll ?? 'auto'} vs ${chosenSkill.total}%</span>
              </div>
              <div class="mi-se-roll-row">
                <span class="mi-se-roll-label">${gripperName} — ${gripperSkillName}</span>
                <span class="mi-se-roll-val">${gripperSkillTotal}%</span>
              </div>
            </div>
          </div>`,
        speaker: ChatMessage.getSpeaker({ actor: grippedActor })
      });
    } else {
      // Still gripped — re-queue for next turn
      const pendingGrip = grippedActor.getFlag('mythras-imperative', 'pendingGripCheck') ?? {};
      pendingGrip[gripEntryId] = entry;
      await grippedActor.setFlag('mythras-imperative', 'pendingGripCheck', pendingGrip);

      await ChatMessage.create({
        content: `
          <div class="mi-chat-card">
            <div class="mi-card-header mi-card-header--stacked">
              <span class="mi-card-actor">${grippedActor.name} vs ${gripperName}</span>
              <span class="mi-card-skill">Break Free — Failed</span>
            </div>
            <div class="mi-card-body">
              <div class="mi-outcome-row">
                <span class="mi-outcome mi-wound-minor">
                  <i class="fas fa-times-circle"></i> ${grippedActor.name} cannot break free — still gripped. May try again next turn.
                </span>
              </div>
              <div class="mi-se-roll-row">
                <span class="mi-se-roll-label">${grippedActor.name} — ${chosenSkill.name}</span>
                <span class="mi-se-roll-val">${defenderRoll ?? 'auto'} vs ${chosenSkill.total}%</span>
              </div>
              <div class="mi-se-roll-row">
                <span class="mi-se-roll-label">${gripperName} — ${gripperSkillName}</span>
                <span class="mi-se-roll-val">${gripperSkillTotal}%</span>
              </div>
            </div>
          </div>`,
        speaker: ChatMessage.getSpeaker({ actor: grippedActor })
      });
    }
  }

  // -------------------------------------------------------------------------
  // _postImpaleDecisionCard — builds and posts the lodge/yank card.
  // Called from updateCombat at the start of the attacker's next turn.
  // entry: a pending impale entry from flags['mythras-imperative'].pendingImpales
  // -------------------------------------------------------------------------

  static async _postImpaleDecisionCard(attacker, entry) {
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
            <span class="mi-card-skill">Impale — Leave In or Yank Free?</span>
          </div>
          <div class="mi-card-body">
            <div class="mi-outcome-row">
              <span class="mi-outcome mi-wound-serious">
                <i class="fas fa-khanda"></i> ${weaponName} remains embedded in ${defenderName}'s ${hitLocationLabel || 'wound'}
              </span>
            </div>
            <div class="mi-se-roll-row">
              <span class="mi-se-roll-label">Penalty while lodged</span>
              <span class="mi-se-roll-val">${gradeDisplay}</span>
            </div>
            <div class="mi-se-roll-row">
              <span class="mi-se-roll-label">Yank damage</span>
              <span class="mi-se-roll-val">½ ${halfDmgFormula} (no DM, ignores armour)</span>
            </div>
            <p class="mi-se-roll-note">Costs Ready Weapon action. Yanking requires a Brawn roll — failure means it stays (retry next turn).</p>
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
                <i class="fas fa-hand-paper"></i> Leave In
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
        'mythras-imperative': {
          stage:            'impale-decision',
          attackerId:       attacker.id,
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
  // _applyImpaleLodge — called when attacker clicks "Leave In".
  // Writes the impaledBy flag to the defender, applies the condition.
  // -------------------------------------------------------------------------

  static async _applyImpaleLodge(btn) {
    const attackerId      = btn.dataset.attackerId;
    const defenderId      = btn.dataset.defenderId;
    const weaponId        = btn.dataset.weaponId;
    const impaleEntryId   = btn.dataset.impaleEntryId;
    const gradeId         = btn.dataset.gradeId;
    const hitLocationId   = btn.dataset.hitLocationId;
    const hitLocationLabel = btn.dataset.hitLocationLabel;
    const halfDmgFormula  = btn.dataset.halfDmgFormula;

    const attacker = game.actors.get(attackerId);
    const defender = game.actors.get(defenderId);
    const weapon   = CombatEngine._getItem(attacker, weaponId);
    if (!defender || !weapon) return;

    // Write the flag entry
    const existing = defender.getFlag('mythras-imperative', 'impaledBy') ?? {};
    existing[impaleEntryId] = {
      attackerId, weaponId,
      weaponName:    weapon.name,
      weaponSize:    weapon.system?.size ?? 'M',
      halfDmgFormula,
      gradeId,
      hitLocationId,
      hitLocationLabel
    };
    await defender.setFlag('mythras-imperative', 'impaledBy', existing);

    // Clear the pending impale — the decision has been made
    const pending = attacker?.getFlag('mythras-imperative', 'pendingImpales') ?? {};
    delete pending[impaleEntryId];
    if (attacker) await attacker.setFlag('mythras-imperative', 'pendingImpales', pending);

    // Stamp the decision card as resolved so buttons re-disable on re-render
    const decisionMsg = game.messages.contents.find(
      m => m.flags?.['mythras-imperative']?.impaleEntryId === impaleEntryId
        && m.flags?.['mythras-imperative']?.stage === 'impale-decision'
    );
    if (decisionMsg) {
      await decisionMsg.setFlag('mythras-imperative', 'impaleResolved', true);
    }

    // Apply status effect if incapacitated
    if (gradeId === 'incapacitated') {
      await CombatEngine._applyStatusToActor(defender, 'incapacitated');
    }

    // Notification
    const gradeLabels = {
      none: 'no additional penalty', hard: 'Hard', formidable: 'Formidable',
      herculean: 'Herculean', incapacitated: 'Incapacitated'
    };
    const msg = gradeId === 'none'
      ? `${weapon.name} lodges in ${defender.name} — no skill penalty for this creature's size.`
      : gradeId === 'incapacitated'
        ? `${weapon.name} lodges in ${defender.name} — Incapacitated (too large for this creature).`
        : `${weapon.name} lodges in ${defender.name} — all skill rolls at ${gradeLabels[gradeId]} while it remains.`;

    await ChatMessage.create({
      content: `<div class="mi-chat-card"><div class="mi-card-body"><div class="mi-outcome-row"><span class="mi-outcome mi-wound-serious"><i class="fas fa-khanda"></i> ${msg}</span></div></div></div>`,
      speaker: ChatMessage.getSpeaker({ actor: attacker })
    });
  }

  // -------------------------------------------------------------------------
  // _resolveImpaleYank — called when attacker clicks "Yank Free".
  // Semi-Auto: posts a Brawn dialog on the defender's client via socket.
  // Full Auto: rolls silently.
  // On success: rolls half weapon damage (no DM, ignores armour), applies to location.
  // On failure: card says weapon stays, attacker may retry next turn.
  // Barbed weapons (trait: 'barbed'): deal full normal damage on yank.
  // -------------------------------------------------------------------------

  static async _resolveImpaleYank(btn) {
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
    const weapon   = CombatEngine._getItem(attacker, weaponId);
    if (!attacker || !defender || !weapon) return;

    const isSemi   = CombatEngine.automationLevel === 'semi';
    const isGMMode = CombatEngine.gmMode;
    const isBarbed = (weapon.system?.traits ?? []).includes('barbed');

    // Brawn skill on the defender — resists the yank (opposed if they resist, unopposed if not)
    // Rules p.44: "unopposed Brawn roll (or win an Opposed Brawn roll if the opponent resists)"
    // We treat it as always opposed using the attacker's original attack roll total as the target.
    const brawnSkill = Array.from(defender.items).find(i => i.type === 'skill' && i.name === 'Brawn');
    const brawnRaw   = brawnSkill?.system.total ?? 0;
    const brawnTotal = CombatEngine._applyFatigueToSkill(brawnRaw, defender);

    let defenderRoll     = null;
    let defenderSucceeds = false; // defender succeeds = yank FAILS (defender holds weapon)

    if (isSemi && !isGMMode) {
      // Socket to defender's controlling user
      const { CombatSocket, _findDefenderUserId } = await import('./CombatSocket.js');
      const targetUserId = _findDefenderUserId(defender);
      const exchangeId   = foundry.utils.randomID(16);
      const response = await CombatSocket.seChallenge(exchangeId, {
        seType:             'impaleYank',
        attackerName:       attacker.name,
        defenderName:       defender.name,
        attackRoll:         attackerSkillTotal, // attacker's skill total is the fixed opposing target
        attackerSkillTotal,
        defenderSkill:      'Brawn',
        defenderRaw:        brawnRaw,
        defenderTotal:      brawnTotal
      }, targetUserId);
      defenderRoll     = response?.roll     ?? null;
      defenderSucceeds = response?.succeeds ?? false;
    } else {
      // GM Mode semi or Full Auto — roll silently
      const roll = new Roll('1d100');
      await roll.evaluate();
      defenderRoll     = roll.total;
      // Defender wins (holds weapon) if better level of success, or tie with higher roll
      defenderSucceeds = CombatEngine._resolveOpposedRoll(
        attackerSkillTotal, attackerSkillTotal,
        defenderRoll, brawnTotal
      );
    }

    const yankSucceeds = !defenderSucceeds;

    // Stamp the decision card as resolved regardless of yank outcome
    const decisionMsg = game.messages.contents.find(
      m => m.flags?.['mythras-imperative']?.impaleEntryId === impaleEntryId
        && m.flags?.['mythras-imperative']?.stage === 'impale-decision'
    );
    if (decisionMsg) {
      await decisionMsg.setFlag('mythras-imperative', 'impaleResolved', true);
    }

    if (yankSucceeds) {
      // Clear the impaledBy flag entry
      const existing = defender.getFlag('mythras-imperative', 'impaledBy') ?? {};
      delete existing[impaleEntryId];
      await defender.setFlag('mythras-imperative', 'impaledBy', existing);

      // Clear the pending impale — the weapon has been freed
      const pending = attacker.getFlag('mythras-imperative', 'pendingImpales') ?? {};
      delete pending[impaleEntryId];
      await attacker.setFlag('mythras-imperative', 'pendingImpales', pending);

      // Clear Incapacitated if it came from this impale and no other source
      if (gradeId === 'incapacitated') {
        const remaining = Object.values(existing);
        const stillIncap = remaining.some(e => e.gradeId === 'incapacitated');
        if (!stillIncap) {
          await CombatEngine._applyStatusToActor(defender, 'incapacitated'); // toggles off
        }
      }

      // Roll yank damage — half weapon formula, no DM, ignores armour
      // Barbed: full normal damage formula instead
      const yankFormula = isBarbed ? weapon.system?.damage ?? halfDmgFormula : halfDmgFormula;
      const yankRoll    = new Roll(yankFormula);
      await yankRoll.evaluate();
      let yankDamage = yankRoll.total;

      // Half for non-barbed (rules: "half the normal damage roll")
      if (!isBarbed) yankDamage = Math.ceil(yankDamage / 2);

      // Apply to the same location — armour does NOT reduce (rules p.44)
      if (hitLocationId && yankDamage > 0) {
        const locItem = CombatEngine._getItem(defender, hitLocationId);
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
      // Yank fails — weapon stays. Re-queue the decision card for attacker's next turn.
      const pending = attacker.getFlag('mythras-imperative', 'pendingImpales') ?? {};
      const defenderSIZ  = defender.system?.characteristics?.siz?.value ?? 13;
      const weaponSize   = weapon.system?.size ?? 'M';
      const gradeLabels  = {
        none: 'No additional penalty', hard: 'Hard (all skills)',
        formidable: 'Formidable (all skills)', herculean: 'Herculean (all skills)',
        incapacitated: 'Incapacitated (status effect)'
      };
      pending[impaleEntryId] = {
        defenderId,
        weaponId,
        impaleEntryId,
        gradeId,
        gradeDisplay:      gradeLabels[gradeId] ?? gradeId,
        hitLocationId,
        hitLocationLabel,
        halfDmgFormula,
        attackerSkillTotal,
        defenderName:      defender.name,
        weaponName:        weapon.name
      };
      await attacker.setFlag('mythras-imperative', 'pendingImpales', pending);

      // Ensure impaledBy is still written on the defender
      const existing = defender.getFlag('mythras-imperative', 'impaledBy') ?? {};
      if (!existing[impaleEntryId]) {
        existing[impaleEntryId] = {
          attackerId, weaponId,
          weaponName:    weapon.name,
          weaponSize:    weapon.system?.size ?? 'M',
          halfDmgFormula,
          gradeId,
          hitLocationId,
          hitLocationLabel
        };
        await defender.setFlag('mythras-imperative', 'impaledBy', existing);
        if (gradeId === 'incapacitated') {
          await CombatEngine._applyStatusToActor(defender, 'incapacitated');
        }
      }

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

  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // _waitForCard — wait for a specific chat message to finish rendering before
  // opening any dialog. This ensures the player reads the dice outcome card
  // before a resistance roll dialog appears on top of it.
  //
  // Uses Hooks.once('renderChatMessage') targeted at the specific message ID.
  // Falls back to a plain timeout if the hook never fires (e.g. GM-hidden rolls,
  // test macros, or cases where the card rendered before this code ran).
  // -------------------------------------------------------------------------
  static _waitForCard(msgId, ms = 800) { return waitForCard(msgId, ms); }

  // _runSEDialog — called on the receiving client (via socket) to show the
  // local dialog and return the result as a plain serialisable object.
  //
  // seType 'bleed':
  //   Shows a card with defender's Endurance % and a Roll button.
  //   Returns { roll, succeeds }.
  //
  // seType 'trip':
  //   Shows the skill picker (Brawn / Evade / Acrobatics) then rolls.
  //   Returns { chosenSkillName, chosenSkillTotal, roll, succeeds }.
  //
  // seType 'disarm':
  //   Shows defender's Combat Style % (adjusted for weapon size) and a Roll button.
  //   Returns { roll, succeeds }.
  // -------------------------------------------------------------------------

  static async _runSEDialog(data) { return runSEDialog(data); }
  //
  // Called from _applyDamage when ctx.enduranceRequired is true (location
  // is at 0 HP or below after this blow). Implements rules pp.31-32 fully:
  //
  // SERIOUS WOUND (newCurrent <= 0, but > -maxHp):
  //   Limb: Endurance vs attack roll → failure: limb useless (leg also Prone)
  //   Torso/Head: Endurance vs attack roll → failure: unconscious N minutes
  //
  // MAJOR WOUND (newCurrent <= -maxHp):
  //   Fix 4 — Immediate automatic consequences (no roll needed):
  //     All locations: Prone + Incapacitated applied immediately
  //     Torso/Head: additionally Unconscious applied before dialog opens
  //   Fix 3 — Then Endurance roll:
  //     Limb: failure → unconscious from agony
  //     Torso/Head: failure → instant death
  //
  // Fix 5: Always post a chat card via _postOpposedSEResult regardless of mode.
  // Fix 3: Dialog follows same pattern as Bleed/Trip — resolved flag prevents race.
  // -------------------------------------------------------------------------

  static async _resolveWoundConsequences(ctx) {
    const { attacker, defender } = ctx;
    const woundLevel   = ctx.woundLevel;    // 'serious' | 'major'
    const locationType = ctx.locationType;  // 'limb' | 'torso' | 'head'
    const newCurrent   = ctx.newCurrent;
    const maxHp        = ctx.maxHp;
    const attackRoll   = ctx.attackResult ?? 0;
    const isMajor      = woundLevel === 'major';

    // Apply fatigue penalty to Endurance — SE resistance rolls use fatigue only.
    const enduranceSkill = Array.from(defender.items)
      .find(i => i.type === 'skill' && i.name === 'Endurance');
    const enduranceRaw   = enduranceSkill?.system.total ?? 0;
    const enduranceTotal = CombatEngine._applyFatigueToSkill(enduranceRaw, defender);

    // ── Fix 4: Automatic consequences for Major wounds (no roll required) ──
    // Any Major wound: immediately Prone + Incapacitated
    // Torso/Head Major: also Unconscious before dialog opens
    if (isMajor) {
      await CombatEngine._applyStatusToActor(defender, 'prone');
      await CombatEngine._applyStatusToActor(defender, 'incapacitated');
      ui.notifications.warn(
        `${defender.name} suffers a Major Wound to the ${ctx.hitLocationLabel} — Prone and Incapacitated!`
      );

      if (locationType === 'torso' || locationType === 'head') {
        await CombatEngine._applyStatusToActor(defender, 'unconscious');
        ui.notifications.warn(`${defender.name} is immediately Unconscious from the Major Wound.`);
      }
    }

    // ── Serious wound stun: cannot attack or cast for 1d3 Turns ──────────
    // Rules p.31: "the victim cannot attack or start to cast spells (but can
    // still Parry or Evade) for the next 1d3 Turns due to being stunned or
    // distracted by the pain of the wound."
    // Fires unconditionally on every Serious wound. Not applicable to Major
    // wounds — the character is already Incapacitated.
    let stunTurns = 0;
    if (!isMajor) {
      // Foundry has no native d3; ceil(1d6 / 2) gives 1, 2, or 3 evenly.
      const stunRoll = new Roll('ceil(1d6 / 2)');
      await stunRoll.evaluate();
      stunTurns = stunRoll.total;
      await CombatEngine._applyStatusToActor(defender, 'stunned');
      await defender.setFlag('mythras-imperative', 'stunTurns', stunTurns);
      ui.notifications.warn(
        `${defender.name} is Stunned — cannot attack or cast for ${stunTurns} Turn${stunTurns > 1 ? 's' : ''}.`
      );
    }

    // ── Endurance roll dialog ──────────────────────────────────────────────
    const isSemi   = CombatEngine.automationLevel === 'semi';
    const isGMMode = CombatEngine.gmMode;

    // Build the consequence description for the dialog prompt
    let rollNote = '';
    if (isMajor) {
      rollNote = locationType === 'limb'
        ? `Roll Endurance or fall Unconscious from agony.`
        : `Roll Endurance or suffer INSTANT DEATH.`;
    } else {
      // Serious wound
      if (locationType === 'limb') {
        const locationLower = (ctx.hitLocationLabel ?? '').toLowerCase();
        const legSuffix = /leg|foot/.test(locationLower) ? ' — and fall Prone' : '';
        const armSuffix = /arm|hand/.test(locationLower) ? ' — held items drop' : '';
        rollNote = `Roll Endurance or the ${ctx.hitLocationLabel} is useless until healed to positive HP${legSuffix}${armSuffix}.`;
      } else {
        rollNote = `Roll Endurance or fall Unconscious for ${Math.max(1, ctx.damageAfterArmour ?? 1)} minutes.`;
      }
    }

    let defenderRoll     = null;
    let defenderSucceeds = false;

    if (isSemi) {
      // Semi-Auto: show a dialog. Run locally when GM Mode is on OR when the
      // defender's controlling user is the current user (single-player / GM
      // running all tokens). Socket only when a distinct non-GM player controls
      // the defender — self-socket is unreliable in Foundry.
      let response;
      const { CombatSocket, _findDefenderUserId } = await import('./CombatSocket.js');
      const targetUserId  = _findDefenderUserId(defender);
      const runLocally    = isGMMode || !targetUserId || targetUserId === game.user.id;

      if (runLocally) {
        response = await CombatEngine._runWoundEnduranceDialog({
          woundLevel,
          locationType,
          locationLabel: ctx.hitLocationLabel ?? 'location',
          attackerName:  attacker?.name ?? 'Attacker',
          defenderName:  defender.name,
          attackRoll,
          attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
          lastCardId:         ctx.chatMessageId,
          defenderRaw:        enduranceRaw,
          defenderTotal:      enduranceTotal,
          rollNote
        });
      } else {
        const exchangeId = foundry.utils.randomID(16);
        response = await CombatSocket.seChallenge(exchangeId, {
          seType:             'woundEndurance',
          woundLevel,
          locationType,
          locationLabel:      ctx.hitLocationLabel ?? 'location',
          attackerName:       attacker?.name ?? 'Attacker',
          defenderName:       defender.name,
          attackRoll,
          attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
          lastCardId:         ctx.chatMessageId,
          defenderSkill:      'Endurance',
          defenderRaw:        enduranceRaw,
          defenderTotal:      enduranceTotal,
          rollNote
        }, targetUserId);
      }

      defenderRoll     = response?.roll     ?? null;
      defenderSucceeds = response?.succeeds ?? false;

    } else {
      // Full Auto: roll silently
      const roll = new Roll('1d100');
      await roll.evaluate();
      defenderRoll     = roll.total;
      // Opposed roll: defender wins only if better level of success, or same
      // level with higher roll (rules p.24).
      defenderSucceeds = CombatEngine._resolveOpposedRoll(
        attackRoll, ctx.attackerSkillTotal ?? 0,
        defenderRoll, enduranceTotal
      );
    }

    // ── Apply consequences on failure ─────────────────────────────────────
    let effectLabel = '';
    if (defenderSucceeds) {
      effectLabel = `${defender.name} endures the wound.`;
    } else {
      // Failed the Endurance roll
      if (isMajor) {
        if (locationType === 'limb') {
          await CombatEngine._applyStatusToActor(defender, 'unconscious');
          effectLabel = `${defender.name} falls Unconscious from the agony of the Major Wound.`;
        } else {
          // Torso or head Major + failed Endurance = instant death
          await CombatEngine._applyStatusToActor(defender, 'dead');
          effectLabel = `${defender.name} is DEAD — Major Wound to the ${ctx.hitLocationLabel}.`;
          ui.notifications.error(`${defender.name} has died from the Major Wound!`);
        }
      } else {
        // Serious wound failure
        if (locationType === 'limb') {
          const locationLower = (ctx.hitLocationLabel ?? '').toLowerCase();
          const isLeg  = /leg|foot/.test(locationLower);
          const isArm  = /arm|hand/.test(locationLower);
          effectLabel = `${defender.name}'s ${ctx.hitLocationLabel} is useless until healed.`;
          if (isLeg) {
            await CombatEngine._applyStatusToActor(defender, 'prone');
            effectLabel += ' Falls Prone.';
          } else if (isArm) {
            // Rules p.31: whatever is held in that arm drops (unless strapped on).
            // The GM must handle the item drop — the system has no single "held item" slot.
            effectLabel += ' Anything held in that arm drops (unless strapped on) — GM to remove from hand.';
          }
        } else {
          // Torso/head serious → unconscious for minutes equal to damage
          await CombatEngine._applyStatusToActor(defender, 'unconscious');
          const duration = ctx.damageAfterArmour ?? 1;
          effectLabel = `${defender.name} falls Unconscious for ${duration} minutes.`;
        }
      }
    }

    // ── Post chat card (always, regardless of automation mode) ────────────
    const woundLabel = isMajor ? 'Major Wound' : 'Serious Wound';
    await CombatEngine._postOpposedSEResult({
      label:         `${woundLabel} — ${ctx.hitLocationLabel ?? 'location'}`,
      attackerName:  attacker?.name ?? 'Attacker',
      defenderName:  defender.name,
      attackerRoll:  attackRoll,
      attackerTotal: ctx.attackerSkillTotal ?? 0,
      defenderRoll,
      defenderTotal: enduranceTotal,
      defenderRaw:   enduranceRaw,
      defenderSkill: 'Endurance',
      forcesFail:    false,
      effectApplied: !defenderSucceeds,
      effectLabel,
      stunTurns,
      attackerActor: attacker ?? null,
      defenderActor: defender
    });
  }

  // -------------------------------------------------------------------------
  // _runWoundEnduranceDialog — local dialog for wound Endurance rolls (GM Mode)
  //
  // Same resolved-flag pattern as Bleed/Trip dialogs to prevent close-handler
  // racing the async Roll.evaluate().
  // -------------------------------------------------------------------------

  static async _runWoundEnduranceDialog(args) { return runWoundEnduranceDialog(args); }

  // -------------------------------------------------------------------------
  // _postOpposedSEResult — post a compact opposed roll result card to chat
  // -------------------------------------------------------------------------

  static async _postOpposedSEResult(args) { return postOpposedSEResult(args); }

  // -------------------------------------------------------------------------
  // _woundLevel — severity based on cumulative location HP per rules pp.31–32
  //
  // Rules p.31:
  //   Minor Wound:   Hit Location still has positive Hit Points   (newCurrent > 0)
  //   Serious Wound: Hit Location reduced to zero or below        (newCurrent <= 0)
  //   Major Wound:   Hit Location reduced to −maxHp or below      (newCurrent <= −maxHp)
  //
  // We compare newCurrent (cumulative HP after this blow) against the
  // thresholds — not the single-blow damage. A location at 1 HP taking 1
  // damage goes Serious (newCurrent = 0). That same location taking another
  // 5 goes Major (newCurrent = −5, maxHp = 5 → −5 ≤ −5).
  // -------------------------------------------------------------------------

  static _woundLevel(damage, maxHp, newCurrent) {
    if (damage <= 0)          return 'none';
    if (newCurrent <= -maxHp) return 'major';
    if (newCurrent <= 0)      return 'serious';
    return 'minor';
  }

  // -------------------------------------------------------------------------
  // _classifyLocation — returns 'limb' | 'torso' | 'head' from a location name
  //
  // Used by wound consequence logic to know which Endurance roll table to use.
  // Matching is case-insensitive against the location item's name/label.
  //   limb:  arm, hand, leg, foot, claw, tentacle, wing
  //   head:  head, skull
  //   torso: abdomen, chest, thorax, gut, torso, body (fallback)
  // -------------------------------------------------------------------------

  static _classifyLocation(locationName) { return classifyLocation(locationName); }

  /**
   * Apply the prone status effect to the defender's token.
   * Finds the first canvas token for the actor and toggles the condition on.
   * Only called on the client that ran the engine (GM or attacker's client).
   */
  static async _applyProneToDefender(defender) { return applyProneToDefender(defender); }

  /**
   * Apply a status effect to the specific token on the canvas, not the base actor.
   *
   * In Foundry v14, status effects (conditions) must be applied via the
   * TokenDocument — not the Actor — to keep them per-token. For linked actors,
   * calling actor.toggleStatusEffect() writes to the base Actor document, which
   * persists across every token placed from that actor. Calling it on the
   * TokenDocument writes to the token's own embedded effect overlay instead,
   * which is discarded when the token is removed from the canvas.
   *
   * We find the first placed token for this actor on the current scene and
   * call toggleStatusEffect on its TokenDocument. If no canvas token exists
   * (e.g. in a GM-only flow with no placed token) we fall back to the actor —
   * this is the edge case where persistence is acceptable because the actor
   * is not placed anywhere.
   */
  static async _applyStatusToActor(actor, statusId) { return applyStatusToActor(actor, statusId); }

  static async _removeStatusFromActor(actor, statusId) { return removeStatusFromActor(actor, statusId); }

  // -------------------------------------------------------------------------
  // combatContext factory
  // This is the complete shape of the object. Every field is defined here.
  // Stages downstream populate null fields; they never add new ones.
  // -------------------------------------------------------------------------

  static _buildContext(attacker, defender, weapon) {
    // Collect attacker's combat styles that cover this weapon
    const attackerStyles = CombatEngine._stylesForWeapon(attacker, weapon);
    // Collect the active ward state from the defender
    const wardedLocations = CombatEngine._buildWardList(defender);

    return {
      // ── Participants ────────────────────────────────────────────────────
      attacker,                   // Actor
      defender,                   // Actor
      weapon,                     // Item (weapon)

      // ── Attacker setup ──────────────────────────────────────────────────
      attackerStyle:   attackerStyles[0] ?? null,  // Item (combat-style) — chosen in dialog
      attackerStyles,             // Item[] — all eligible styles for this weapon
      attackerSkillTotal: CombatEngine._resolveAttackSkill(attacker, weapon, attackerStyles[0]),

      // Active combat style traits on the attacker (keys from MYTHRAS.combatStyleTraits)
      attackerTraits: attackerStyles[0]
        ? Array.from(attackerStyles[0].system.traits ?? [])
        : [],

      // ── Difficulty & modifiers ──────────────────────────────────────────
      // Standard by default. Charge sets 'hard'. Modules may override.
      difficulty: 'standard',
      modifiers:  0,              // net situational bonus/penalty in %

      // ── Bonus special effects from combat actions ───────────────────────
      // Charge adds 'bash'. Modules may push additional effects here.
      bonusSpecialEffects: [],    // string[] — SE ids granted before roll

      // ── Defender setup ──────────────────────────────────────────────────
      // Populated when defender dialog resolves
      defenceType:      null,     // 'parry' | 'evade' | 'none'
      defenceStyle:     null,     // Item (combat-style) used to parry, or null
      defenceWeapon:    null,     // Item (weapon) used to parry, or null
      defenderSkillTotal: null,   // number — computed when defence type is chosen

      // Passive blocking — locations warded by the defender
      wardedLocations,            // Array<{ locKey, weaponId, weaponSize }>

      // ── Roll results — populated after both sides confirm ───────────────
      attackRoll:           null, // Roll instance
      defenceRoll:          null, // Roll instance or null (if 'none')
      attackResult:         null, // number — d100 result
      defenceResult:        null, // number — d100 result or null
      attackOutcome:        null, // 'critical'|'success'|'failure'|'fumble'
      defenceOutcome:       null, // 'critical'|'success'|'failure'|'fumble'|'none'

      // ── Differential resolution ─────────────────────────────────────────
      // Derived from the differential table after both rolls are known.
      // Positive = attacker wins that many SEs. Negative = defender wins.
      seAdvantage:          null, // number  e.g. 2 = attacker wins 2 SEs
      seWinner:             null, // 'attacker'|'defender'|'none'
      seCount:              null, // number — absolute value of seAdvantage

      // ── Special effects ─────────────────────────────────────────────────
      chosenSpecialEffects: [],   // string[] — SE ids chosen by winner

      // ── Hit location & damage ───────────────────────────────────────────
      hitLocationId:        null, // string — item id of struck location
      hitLocationLabel:     null, // string — display name
      damageRoll:           null, // Roll instance
      rawDamage:            null, // number — before parry/armour reduction
      damageAfterParry:     null, // number — after parry reduction
      damageAfterArmour:    null, // number — final damage applied
      parryReduction:       null, // 'full'|'half'|'none' — for chat card display

      // ── Wound result ────────────────────────────────────────────────────
      woundLevel:           null, // 'none'|'minor'|'serious'|'major'
      enduranceRequired:    false,// whether an Endurance roll is needed

      // ── Flags ───────────────────────────────────────────────────────────
      // Set by the Charge combat action before initiateAttack is called
      isCharge:    false,
      // Set if the attacker has the Brace stance active
      isBraced:    false,
      // Ranged combat fields — set by AttackerDialog when a ranged weapon is used
      isRanged:    false,           // true when weapon.system.category === 'ranged'
      rangeBand:   null,            // 'close'|'effective'|'long' — selected in AttackerDialog
      isAiming:    false,           // true if attacker spent a round aiming
      isBurstFire: false,           // true when firing mode is 'burst'
      isFullAuto:    false,         // true when firing mode is 'full-auto' (Formidable)
      declaredRounds: 0,           // rounds declared for full-auto (from slider)
      roundsPerTarget: 0,          // floor(declaredRounds / targetCount), set per exchange
      // Set if the defender is surprised — read from the token's active status effects.
      // The GM toggles the 'surprised' condition on the token before the attack is made.
      // We check the token first (most reliable in v14); fall back to actor.statuses.
      defenderSurprised: (() => {
        const token = canvas?.tokens?.placeables?.find(t => t.actor?.id === defender.id);
        if (token) return token.actor?.statuses?.has('surprised') ?? false;
        return defender.statuses?.has('surprised') ?? false;
      })(),

      // ── Chat card state ─────────────────────────────────────────────────
      // Used by Semi-Automated mode to resume the engine from a button click
      stage: 'init',              // 'init'|'rolled'|'effects'|'damage'|'complete'
      chatMessageId: null         // string — id of the stateful chat message
    };
  }

  // -------------------------------------------------------------------------
  // MANUAL MODE
  // Rolls the combat style skill, posts to chat with outcome.
  // The chat card has Roll Hit Location and Roll Damage buttons that the
  // GM clicks manually to continue resolution.
  // -------------------------------------------------------------------------

  static async _runManual(ctx) {
    const { attacker, weapon } = ctx;

    // Attacker spends 1 AP — proactive action costs 1 AP in all modes
    await CombatEngine._spendActionPoint(attacker);

    // Determine the skill to roll — first matching combat style, else Unarmed
    const style = ctx.attackerStyle;
    const skillName  = style ? style.name : weapon.name;
    const skillTotal = ctx.attackerSkillTotal;

    // Roll 1d100
    const roll = new Roll('1d100');
    await roll.evaluate();
    const result  = roll.total;
    const outcome = CombatEngine._determineOutcome(result, skillTotal);

    // Mark fumble on the style for experience tracking
    if (outcome === 'fumble' && style && !style.system.fumbledLastSession) {
      await style.update({ 'system.fumbledLastSession': true });
    }

    await CombatEngine._postManualCard({ ctx, roll, result, skillTotal, skillName, outcome });
  }

  static async _postManualCard({ ctx, roll, result, skillTotal, skillName, outcome }) {
    const { attacker, defender, weapon } = ctx;

    const outcomeLabels = {
      critical: game.i18n.localize('MYTHRAS.OutcomeCritical'),
      success:  game.i18n.localize('MYTHRAS.OutcomeSuccess'),
      failure:  game.i18n.localize('MYTHRAS.OutcomeFailure'),
      fumble:   game.i18n.localize('MYTHRAS.OutcomeFumble')
    };

    // Damage modifier string e.g. "+1d4", "-1d2", "+0"
    const dmMod     = attacker.system.attributes?.damageModifier ?? '';
    const applyMod  = weapon.system.damageModApplies ?? true;
    // Charge steps DM up one category
    const effectiveDM = (ctx.isCharge && applyMod)
      ? CombatEngine._stepUpDamageModifier(dmMod) : dmMod;
    const dmgFormula = (applyMod && effectiveDM && effectiveDM !== '+0' && effectiveDM !== '0')
      ? `${weapon.system.damage}${effectiveDM}`
      : weapon.system.damage;

    // Only show action buttons on a success or critical
    const canAct = outcome === 'critical' || outcome === 'success';
    const actionsHtml = canAct ? `
      <div class="mi-manual-actions">
        <button class="mi-btn mi-btn-loc" data-defender-name="${defender.name}">
          <i class="fas fa-crosshairs"></i> Roll Hit Location
        </button>
        <button class="mi-btn mi-btn-dmg" data-formula="${dmgFormula}" data-defender-name="${defender.name}">
          <i class="fas fa-dice"></i> Roll Damage
        </button>
      </div>` : '';

    const content = `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker.name} <span class="mi-card-vs">vs</span> ${defender.name}</span>
          <span class="mi-card-skill">${skillName} — ${weapon.name}</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-card-target">Target <strong>${skillTotal}%</strong></div>
          <div class="mi-roll-result">${result}</div>
          <div class="mi-outcome-row">
            <span class="mi-outcome ${outcome}">${outcomeLabels[outcome]}</span>
          </div>
          ${actionsHtml}
        </div>
      </div>`;

    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      rolls: [roll],
      flags: {
        'mythras-imperative': {
          actorId:     attacker.id,
          manualCombat: true,
          outcome,
          weapon: { id: weapon.id, name: weapon.name, damage: weapon.system.damage }
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Outcome determination (shared with MythrasRoll logic)
  // -------------------------------------------------------------------------

  static _determineOutcome(result, target) {
    if (result >= 100 || (result >= 99 && target < 100)) return 'fumble';
    const critThreshold = Math.ceil(target / 10);
    if (result <= critThreshold) return 'critical';
    return result <= target ? 'success' : 'failure';
  }

  // -------------------------------------------------------------------------
  // _resolveOpposedRoll — determine winner of an opposed roll (rules p.24)
  //
  // Rules: the winner is whoever achieves the better Level of Success.
  // On equal Levels of Success, the winner is whoever rolled higher —
  // provided that roll still falls within the success range of their skill.
  // A tie between two failures: no winner (both failed).
  //
  // In SE opposed rolls (Bleed, Trip, Wound Endurance) the attacker's side
  // is always the original attack roll (a fixed value). The defender rolls
  // fresh against their resistance skill.
  //
  // Returns true if the DEFENDER wins the opposed roll (i.e. resists).
  //
  // @param {number} attackerRoll   The attacker's original d100 result
  // @param {number} attackerTotal  The attacker's skill total (for level calc)
  // @param {number} defenderRoll   The defender's fresh d100 result
  // @param {number} defenderTotal  The defender's resistance skill total
  // -------------------------------------------------------------------------

  static _resolveOpposedRoll(attackerRoll, attackerTotal, defenderRoll, defenderTotal) {
    const levelOrder = { critical: 3, success: 2, failure: 1, fumble: 0 };

    const atkLevel = levelOrder[CombatEngine._determineOutcome(attackerRoll, attackerTotal)];
    const defLevel = levelOrder[CombatEngine._determineOutcome(defenderRoll, defenderTotal)];

    // Higher level of success wins outright
    if (defLevel > atkLevel) return true;   // defender wins — resists
    if (atkLevel > defLevel) return false;  // attacker wins — effect applies

    // Equal levels of success: higher roll wins (within success range)
    // If both failed or fumbled: neither succeeded, attacker's effect applies
    // (treat as attacker wins — the defender didn't overcome the SE)
    if (atkLevel <= 1) return false; // both failed/fumbled — attacker wins

    // Both succeeded at the same level: higher roll wins
    // Higher roll = closer to the skill ceiling = harder to achieve = better
    return defenderRoll > attackerRoll;
  }
  //
  // Called after both rolls are evaluated. Returns:
  //   { seWinner: 'attacker'|'defender'|'none', seCount: number }
  //
  // Implements the exact p.25 table. No tiebreaker — Critical/Critical and
  // Success/Success are both "No Benefit" in Mythras Imperative.
  // -------------------------------------------------------------------------

  static resolveDifferential(attackOutcome, defenceOutcome) {
    // Level map: higher = better
    const level = { critical: 3, success: 2, failure: 1, fumble: 0, none: 0 };

    const atk = level[attackOutcome] ?? 0;
    const def = level[defenceOutcome] ?? 0;

    // Lookup table keyed [attackOutcome][defenceOutcome]
    // Value: positive = attacker wins N SE, negative = defender wins N SE, 0 = no benefit
    const TABLE = {
      critical: { critical: 0, success:  1, failure:  2, fumble:  3, none:  2 },
      success:  { critical:-1, success:  0, failure:  1, fumble:  2, none:  1 },
      failure:  { critical:-2, success: -1, failure:  0, fumble:  0, none:  0 },
      fumble:   { critical:-3, success: -2, failure:  0, fumble:  0, none:  0 }
    };

    const result = TABLE[attackOutcome]?.[defenceOutcome] ?? 0;

    if (result > 0) return { seWinner: 'attacker', seCount: result };
    if (result < 0) return { seWinner: 'defender', seCount: Math.abs(result) };
    return { seWinner: 'none', seCount: 0 };
  }

  // -------------------------------------------------------------------------
  // _diceBreakdown — render dice terms of a Roll as a compact breakdown string
  //
  // Returns HTML like: "<span class=mi-dice-breakdown>2d6: [4,3] = 7 +1d4: [2] = 2</span>"
  // Used under damage totals so players can see individual die results.
  // Only renders Die terms (NumericTerms are shown implicitly in the total).
  // -------------------------------------------------------------------------

  static _diceBreakdown(roll) {
    if (!roll) return '';
    const terms = [];
    for (const term of roll.terms) {
      if (!term.faces) continue;                         // skip operators/numerics
      const results = (term.results ?? []).map(r => r.result ?? r);
      const dice = results.map(v => `<span class="mi-dice-breakdown-die">${v}</span>`).join('');
      terms.push(`<span class="mi-dice-breakdown-term">` +
        `<span class="mi-dice-breakdown-label">${term.number}d${term.faces}</span>` +
        dice +
        `</span>`);
    }
    if (terms.length === 0) return '';
    return `<span class="mi-dice-breakdown">${terms.join('')}</span>`;
  }

  // -------------------------------------------------------------------------
  // _stepUpDamageModifier — Charge combat action (rules p.XX)
  //
  // Charge steps the attacker's Damage Modifier up one category on the table.
  // The DM table in order: -1d8,-1d6,-1d4,-1d2,+0,+1d2,+1d4,+1d6,+1d8,
  //                         +1d10,+1d12,+2d6,+2d8,+2d10,+2d12
  //
  // If the actor has no DM ('' or '+0' or '0') it is treated as '+0'.
  // If already at the top of the table, stays there.
  // Returns the new DM string (e.g. "+1d6" → "+1d8").
  // -------------------------------------------------------------------------

  static _stepUpDamageModifier(currentDM) {
    const TABLE = [
      '-1d8', '-1d6', '-1d4', '-1d2',
      '+0',
      '+1d2', '+1d4', '+1d6', '+1d8', '+1d10', '+1d12',
      '+2d6', '+2d8', '+2d10', '+2d12'
    ];
    const dm = (currentDM === '' || currentDM === '0') ? '+0' : currentDM;
    const idx = TABLE.indexOf(dm);
    if (idx === -1) return dm;               // unknown format — leave unchanged
    return TABLE[Math.min(idx + 1, TABLE.length - 1)];
  }

  // -------------------------------------------------------------------------
  // Parry damage reduction — p.40
  //
  // Size categories: S=0 M=1 L=2 H=3 E=4
  // Equal or greater: all damage blocked
  // One step less: half damage gets through
  // Two or more steps less: no reduction
  // -------------------------------------------------------------------------

  static resolveParryReduction(attackWeapon, defenceWeapon, defenderStyle, ctx = null) {
    if (!defenceWeapon) return { multiplier: 1, label: 'none' };

    const sizeOrder = { S: 0, M: 1, L: 2, H: 3, E: 4 };

    let defSize = sizeOrder[defenceWeapon.system.parrySize ?? defenceWeapon.system.size] ?? 1;

    // Defensive Minded trait steps parry size up one when not attacking
    if (defenderStyle?.system.traits?.includes('defensiveMinded')) {
      defSize = Math.min(defSize + 1, 4);
    }

    // Unarmed Prowess trait — unarmed blocks and parries treated as Medium (index 1)
    // Rules p.34: "permits the user to treat Unarmed blocks and parries as Medium sized"
    const defIsUnarmed = (defenceWeapon.system.traits ?? []).includes('unarmed');
    if (defIsUnarmed && defenderStyle?.system.traits?.includes('unarmedProwess')) {
      defSize = Math.max(defSize, 1); // floor at M (index 1)
    }

    // Enhance Parry SE: full block regardless of size — handled upstream by SE logic

    // For ranged weapons, parrySize reads system.force (set by the WeaponData getter).
    // At Long range, force is reduced by one step (rules p.49).
    let atkSize = sizeOrder[attackWeapon.system.parrySize ?? attackWeapon.system.size] ?? 1;
    if (ctx?.isRanged && ctx?.rangeBand === 'long') {
      atkSize = Math.max(0, atkSize - 1);
    }

    const diff = atkSize - defSize; // positive = attack weapon is larger / more forceful

    if (diff <= 0) return { multiplier: 0,   label: 'full' };  // all blocked
    if (diff === 1) return { multiplier: 0.5, label: 'half' };  // half through
    return           { multiplier: 1,   label: 'none' };        // no reduction
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Action Point management
  // Rules p.36-37: proactive actions cost 1 AP; reactive actions cost 1 AP;
  // Don't Defend costs 0 AP; Surprised = 0 AP (cannot react).
  // -------------------------------------------------------------------------

  static async _spendActionPoint(actor) {
    const ap = actor.system.attributes?.actionPoints;
    if (!ap) return null;
    if (ap.value <= 0) {
      ui.notifications.warn(`${actor.name} has no Action Points remaining.`);
      return 0;
    }
    const newValue = ap.value - 1;
    await actor.update({ 'system.attributes.actionPoints.value': newValue });
    return newValue;
  }

  /**
   * Resolve the defender from Foundry's targeting system.
   * If exactly one target is set, use it.
   * If zero or more than one, notify and return null.
   */
  static _resolveDefender(attacker) {
    const targets = Array.from(game.user.targets ?? []);
    if (targets.length === 1) {
      const token = targets[0];
      return token.actor ?? null;
    }
    if (targets.length === 0) {
      ui.notifications.warn('Target a token before attacking.');
    } else {
      ui.notifications.warn('Target exactly one token to attack.');
    }
    return null;
  }

  /**
   * Find all combat styles on the attacker that include this weapon.
   * Returns them sorted by total skill descending (highest first).
   */
  static _stylesForWeapon(actor, weapon) {
    return Array.from(actor.items)
      .filter(i =>
        i.type === 'combat-style' &&
        (i.system.weapons ?? []).some(w => w.id === weapon.id || w.name === weapon.name)
      )
      .sort((a, b) => (b.system.total ?? 0) - (a.system.total ?? 0));
  }

  /**
   * Compute the effective attack skill total for this weapon/style combination.
   * Applies the actor's fatigue difficulty grade (worst-of with any other grade).
   */
  static _resolveAttackSkill(actor, weapon, style) {
    const raw = style?.system.total
      ?? Array.from(actor.items).find(i => i.type === 'skill' && i.name === 'Unarmed')?.system.total
      ?? 0;
    return CombatEngine._applyFatigueToSkill(raw, actor);
  }

  // -------------------------------------------------------------------------
  // _applyFatigueToSkill — apply all active condition penalties to a skill
  //
  // Returns the effective skill total after applying the WORST of:
  //   1. Fatigue grade (from actor.system.fatigue)
  //   2. Prone condition (Formidable on all combat skill rolls, p.47)
  //
  // Both sources are compared by position in gradeOrder; the hardest
  // (highest index) wins. Standard (index 2) is the minimum — never easier.
  //
  // NOTE: Wound penalties (p.31) are GM discretion only — "at the Games
  // Master's discretion" — and are not applied automatically by the system.
  //
  // This is the single source of truth for condition-adjusted skill totals.
  // AttackerDialog and MythrasRoll.rollDialog both read the floor grade from
  // this same logic to pre-select and disable dropdown options.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // _applyFatigueToSkill — apply fatigue penalty to a raw skill total
  //
  // Returns the effective skill total after applying the fatigue grade.
  // Standard (index 2) is the minimum floor — never easier than unmodified.
  //
  // NOTE: Prone is a combat skill penalty only (p.47 — "Fighting while
  // prone"). It is NOT applied here — callers that are combat skill rolls
  // (AttackerDialog, _resolveDefenceSkill) handle prone separately via
  // _getConditionFloorGrade. SE resistance rolls (Endurance, Brawn, Evade
  // for Trip) use this function and receive fatigue only, not prone.
  // -------------------------------------------------------------------------

  static _applyFatigueToSkill(skillTotal, actor) { return applyFatigueToSkill(skillTotal, actor); }

  // -------------------------------------------------------------------------
  // _getActiveImpaleGrade — returns the worst difficulty grade id from all
  // active impalements on an actor, or null if none.
  // Returns null, 'none', 'hard', 'formidable', 'herculean', or 'incapacitated'.
  // -------------------------------------------------------------------------
  static _getActiveImpaleGrade(actor) { return getActiveImpaleGrade(actor); }

  // -------------------------------------------------------------------------
  // _getActiveEntangleGrade — returns 'hard' if any active entanglement on a
  // head/chest/abdomen location is present; null otherwise.
  // -------------------------------------------------------------------------
  static _getActiveEntangleGrade(actor) { return getActiveEntangleGrade(actor); }

  // -------------------------------------------------------------------------
  // _getImpaleGrade — Impale Effects Table lookup (rules p.44)
  // Returns 'none' | 'hard' | 'formidable' | 'herculean' | 'incapacitated'
  // weaponSize: 'S' | 'M' | 'L' | 'H' | 'E'
  // defenderSIZ: the defender's SIZ characteristic value
  // -------------------------------------------------------------------------
  static _getImpaleGrade(weaponSize, defenderSIZ) {
    const table = [
      { min: 1,  max: 10,  S: 'formidable', M: 'herculean',  L: 'incapacitated', H: 'incapacitated', E: 'incapacitated' },
      { min: 11, max: 20,  S: 'hard',       M: 'formidable', L: 'herculean',     H: 'incapacitated', E: 'incapacitated' },
      { min: 21, max: 30,  S: 'none',       M: 'hard',       L: 'formidable',    H: 'herculean',     E: 'incapacitated' },
      { min: 31, max: 40,  S: 'none',       M: 'none',       L: 'hard',          H: 'formidable',    E: 'herculean'     },
      { min: 41, max: 50,  S: 'none',       M: 'none',       L: 'none',          H: 'hard',          E: 'formidable'    },
    ];
    const siz  = Math.max(1, defenderSIZ ?? 13);
    const size = weaponSize ?? 'M';

    if (siz <= 50) {
      const row = table.find(r => siz >= r.min && siz <= r.max);
      return row?.[size] ?? 'none';
    }
    // SIZ > 50: each +10 beyond 50 shifts one column easier
    const sizeOrder   = ['S', 'M', 'L', 'H', 'E'];
    const extraBands  = Math.floor((siz - 50) / 10);
    const baseIdx     = sizeOrder.indexOf(size);
    const shiftedSize = sizeOrder[Math.max(0, baseIdx - extraBands)];
    return table[4][shiftedSize] ?? 'none';
  }

  // -------------------------------------------------------------------------
  // _getConditionFloorGrade — returns the worst active condition grade id
  //
  // Used by AttackerDialog and MythrasRoll.rollDialog to pre-select the
  // floor difficulty and disable easier options in the dropdown.
  //
  // Consolidates fatigue + prone into a single grade id.
  // Never returns anything easier than 'standard'.
  // -------------------------------------------------------------------------

  static _getConditionFloorGrade(actor) {
    if (!actor) return 'standard';

    const gradeOrder = ['veryEasy','easy','standard','hard','formidable','herculean','hopeless'];
    let worstIdx = 2; // standard

    const fatigueId  = actor.system?.fatigue ?? 'fresh';
    const fatigueDef = (CONFIG.MYTHRAS?.fatigueLevels ?? []).find(f => f.id === fatigueId);
    const fatGrade   = fatigueDef?.skillGrade ?? null;
    if (fatGrade) {
      const idx = gradeOrder.indexOf(fatGrade);
      if (idx > worstIdx) worstIdx = idx;
    }

    if (actor.statuses?.has('prone') ?? false) {
      const idx = gradeOrder.indexOf('formidable');
      if (idx > worstIdx) worstIdx = idx;
    }

    // Impale grade floor
    const impaleGrade = CombatEngine._getActiveImpaleGrade(actor);
    if (impaleGrade && impaleGrade !== 'none' && impaleGrade !== 'incapacitated') {
      const idx = gradeOrder.indexOf(impaleGrade);
      if (idx > worstIdx) worstIdx = idx;
    }

    // Entangle grade floor
    const entangleGrade2 = CombatEngine._getActiveEntangleGrade(actor);
    if (entangleGrade2) {
      const idx = gradeOrder.indexOf(entangleGrade2);
      if (idx > worstIdx) worstIdx = idx;
    }

    // Blind grade floor (combat rolls only — attacker is blinded)
    const blindGrade = CombatEngine._getActiveBlindGrade(actor);
    if (blindGrade) {
      const idx = gradeOrder.indexOf(blindGrade);
      if (idx > worstIdx) worstIdx = idx;
    }

    return gradeOrder[worstIdx];
  }

  // -------------------------------------------------------------------------
  // _buildConditionNotes — human-readable list of active condition penalties
  //
  // Returns a string like "Tired — Hard · Prone — Formidable"
  // Used in AttackerDialog and MythrasRoll banners — combat roll contexts
  // where both fatigue and prone apply.
  // Used in dialog condition banners.
  // -------------------------------------------------------------------------

  static _buildConditionNotes(actor) {
    if (!actor) return '';
    const notes = [];

    const fatigueId  = actor.system?.fatigue ?? 'fresh';
    const fatigueDef = (CONFIG.MYTHRAS?.fatigueLevels ?? []).find(f => f.id === fatigueId);
    const fatGrade   = fatigueDef?.skillGrade ?? null;
    if (fatGrade) {
      const cap = fatigueId.charAt(0).toUpperCase() + fatigueId.slice(1);
      const gradeLabel = game.i18n.localize(CONFIG.MYTHRAS?.difficultyGrades?.[fatGrade]?.label ?? fatGrade);
      notes.push(`${cap} — ${gradeLabel}`);
    }

    if (actor.statuses?.has('prone') ?? false) {
      notes.push('Prone — Formidable');
    }

    const impaleGrade = CombatEngine._getActiveImpaleGrade(actor);
    if (impaleGrade && impaleGrade !== 'none' && impaleGrade !== 'incapacitated') {
      const gradeLabel = game.i18n.localize(CONFIG.MYTHRAS?.difficultyGrades?.[impaleGrade]?.label ?? impaleGrade);
      notes.push(`Impaled — ${gradeLabel}`);
    }

    const entangleGrade3 = CombatEngine._getActiveEntangleGrade(actor);
    if (entangleGrade3) {
      notes.push('Entangled — Hard');
    }

    const blindGrade2 = CombatEngine._getActiveBlindGrade(actor);
    if (blindGrade2) {
      notes.push(`Blinded — ${blindGrade2 === 'formidable' ? 'Formidable' : 'Hard'}`);
    }

    return notes.join(' · ');
  }

  /**
   * Build the warded locations list from the defender's actor data.
   * Returns an array of objects for quick lookup during passive blocking.
   */
  static _buildWardList(defender) {
    const wardedLocs = defender.system.wardedLocations ?? {};
    const result = [];
    for (const [locKey, ward] of Object.entries(wardedLocs)) {
      if (!ward.warded) continue;
      const wardWeapon = ward.weaponId
        ? defender.items.get(ward.weaponId) ?? null
        : null;
      result.push({
        locKey,
        weaponId:   ward.weaponId,
        weaponSize: wardWeapon?.system.parrySize ?? wardWeapon?.system.size ?? 'M'
      });
    }
    return result;
  }
}
