/**
 * module/combat/effects/simple.js
 *
 * SE resolvers with no opposed roll and no cross-turn state.
 * Each posts a narrative chat card and/or writes a single flag.
 *
 * Exported functions match the registry resolver field in config.js.
 * Signature: (ctx) — no damage or forcesFail parameter needed.
 */

const NS = 'mythras-imperative';


export async function resolveWithdraw(ctx) {
  const { attacker, defender } = ctx;
  if (!defender) return;

  await ChatMessage.create({
    content: `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker?.name ?? '?'} → ${defender.name}</span>
          <span class="mi-card-skill">Withdraw</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-outcome-row">
            <span class="mi-outcome success">
              <i class="fas fa-running"></i> ${defender.name} withdraws out of reach of ${attacker?.name ?? 'their opponent'}
            </span>
          </div>
        </div>
      </div>`,
    speaker: ChatMessage.getSpeaker({ actor: defender })
  });
}


// -------------------------------------------------------------------------
// resolveDuckBack — SE: Duck Back (attacker, firearms only)
//
// Rules p.44: The shooter immediately ducks back into nearby cover without
// spending an Action Point or waiting for their next turn. The character
// must already be standing or crouching adjacent to cover — the GM
// adjudicates whether cover is available.
//
// Narrative only — no flags, no rolls, no cross-turn state.
// The GM should narrate the cover move at the table.
// -------------------------------------------------------------------------

export async function resolveDuckBack(ctx) {
  const { attacker, defender } = ctx;
  if (!attacker) return;

  await ChatMessage.create({
    content: `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker.name}</span>
          <span class="mi-card-skill">Duck Back</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-outcome-row">
            <span class="mi-outcome mi-outcome--success">
              <i class="fas fa-shield-alt"></i> ${attacker.name} ducks back into cover
            </span>
          </div>
          <p class="mi-card-note">No Action Point required. ${attacker.name} must be adjacent to cover — GM adjudicates availability.</p>
        </div>
      </div>`,
    speaker: ChatMessage.getSpeaker({ actor: attacker })
  });
}


// -------------------------------------------------------------------------
// resolveRapidReload — SE: Rapid Reload (attacker, ranged, stackable)
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

export async function resolveRapidReload(ctx) {
  const { attacker, weapon } = ctx;
  if (!attacker || !weapon) return;

  // Count stack instances
  const stackCount = ctx.chosenSpecialEffects.filter(se => se === 'rapidReload').length;
  if (stackCount === 0) return;

  const currentLoad = weapon.system.load ?? 0;
  const newLoad     = Math.max(0, currentLoad - stackCount);
  const reduction   = currentLoad - newLoad;

  if (reduction > 0) {
    await weapon.update({ 'system.load': newLoad });
  }

  const stackNote  = stackCount > 1 ? ` (×${stackCount} — stacked)` : '';
  const loadNote   = reduction > 0
    ? `Reload time: ${currentLoad}T → ${newLoad}T${stackNote}`
    : `Reload time already 0 — no further reduction possible`;

  await ChatMessage.create({
    content: `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker.name}</span>
          <span class="mi-card-skill">Rapid Reload — ${weapon.name}</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-outcome-row">
            <span class="mi-outcome mi-outcome--success">
              <i class="fas fa-redo"></i> ${loadNote}
            </span>
          </div>
          <p class="mi-card-note">Applies to the next reload. Reload time has been updated on the weapon.</p>
        </div>
      </div>`,
    speaker: ChatMessage.getSpeaker({ actor: attacker })
  });
}


// -------------------------------------------------------------------------
// resolveOverpenetrate — SE: Over-penetration (attacker, firearms, Critical)
//
// Rules p.45: The shot travels completely through the first victim (assuming
// it overcomes their body armour) and strikes a second target behind them.
// The second victim suffers half damage. Special Effects from the first
// attack are NOT applied to the second.
//
// Narrative only — the GM must identify and resolve the second target.
// No cross-turn flags or opposed rolls needed.
// -------------------------------------------------------------------------

export async function resolveOverpenetrate(ctx) {
  const { attacker, defender } = ctx;
  if (!attacker) return;

  await ChatMessage.create({
    content: `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker.name} → ${defender?.name ?? '?'}</span>
          <span class="mi-card-skill">SE: Over-penetration</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-outcome-row">
            <span class="mi-outcome mi-outcome--success">
              <i class="fas fa-bullseye"></i> Shot penetrates through ${defender?.name ?? 'target'}
            </span>
          </div>
          <p class="mi-card-note">
            The round passes through the first victim and strikes a second target behind them.
            GM: if the shot overcame ${defender?.name ?? 'the target'}'s armour, identify the second victim.
            The second victim suffers <strong>half damage</strong> (attenuated shot). No Special Effects are applied to the second target.
          </p>
        </div>
      </div>`,
    speaker: ChatMessage.getSpeaker({ actor: attacker })
  });
}


// -------------------------------------------------------------------------
// resolveCircumventCover — SE: Circumvent Cover (attacker, high-tech firearms)
//
// Rules p.43: Allows the shot to bypass cover protection — the target's
// cover provides no armour or protection for this shot (e.g. target-seeking
// rounds, phase-shifted projectiles, or similar high-tech ammunition).
//
// Narrative only — the GM confirms the weapon qualifies as high-tech.
// Mechanically this SE simply signals that cover AP should not be applied
// for this exchange. Damage calculation itself is unchanged by the system.
// -------------------------------------------------------------------------

export async function resolveCircumventCover(ctx) {
  const { attacker, defender } = ctx;
  if (!attacker) return;

  await ChatMessage.create({
    content: `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker.name} → ${defender?.name ?? '?'}</span>
          <span class="mi-card-skill">SE: Circumvent Cover</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-outcome-row">
            <span class="mi-outcome mi-outcome--success">
              <i class="fas fa-crosshairs"></i> Shot bypasses ${defender?.name ?? 'target'}'s cover
            </span>
          </div>
          <p class="mi-card-note">
            High-tech ammunition circumvents the protection of any cover the target is sheltering behind.
            GM: do not apply cover Armour Points to this shot. Normal worn and natural armour still applies.
          </p>
        </div>
      </div>`,
    speaker: ChatMessage.getSpeaker({ actor: attacker })
  });
}



// -------------------------------------------------------------------------
// resolvePressAdvantage — SE: Press Advantage (attacker, universal)
//
// Destined rules (p.162): "The hero keeps their foe on the defensive or
// causes them to overextend themselves, preventing the opponent from using
// an Attack Action on their next Turn... opponents are free to take other
// Actions aside from attacking." No opposed roll in the rules text —
// unlike Pin Down (Opposed Willpower), this applies automatically to
// whichever winner selects it, same shape as Pin Object (no roll).
//
// Mechanically: writes a 'pressAdvantaged' flag to the BASE defender actor.
// Two consumers, matching Pin Down's own two-part shape:
//   - AttackerDialog.js disables the Attack button for the flagged actor
//     (any weapon, melee or ranged) — a real enforced block, not just an
//     informational note. Extends the same button-disable seam Weapon
//     Malfunction's jammed-weapon check already uses, generalized to an
//     actor-level restriction instead of a weapon-level one.
//   - The updateCombat hook clears the flag at the start of the affected
//     actor's next Turn (mirrors Pin Down/Stun/Blind Opponent's identical
//     "write on apply, clear+notify on next-turn" pattern).
// -------------------------------------------------------------------------

export async function resolvePressAdvantage(ctx) {
  const { attacker, defender } = ctx;
  if (!attacker || !defender) return;

  const baseDefender = game.actors.get(defender.id) ?? defender;
  await baseDefender.setFlag(NS, 'pressAdvantaged', {
    attackerName: attacker.name,
    round:        game.combat?.round ?? 0
  });

  await ChatMessage.create({
    content: `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker.name} → ${defender.name}</span>
          <span class="mi-card-skill">Press Advantage</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-outcome-row">
            <span class="mi-outcome mi-wound-serious">
              <i class="fas fa-shield-halved"></i>
              ${defender.name} is kept on the defensive — no Attack Action on their next Turn
            </span>
          </div>
          <p class="mi-card-note">${defender.name} may still take other Actions (Move, Reload, cast a non-attack power, and so on) — only attacking is blocked.</p>
        </div>
      </div>`,
    speaker: ChatMessage.getSpeaker({ actor: attacker })
  });
}


// -------------------------------------------------------------------------
// resolveSelectTarget — SE: Select Target (defender, attacker fumbles)
//
// Rules p.45: When the attacker fumbles, the defender may manoeuvre or
// deflect the blow so it strikes an adjacent bystander instead. The new
// victim is taken by surprise, automatically hit, and suffers no SEs.
//
// Narrative only — no mechanical automation (requires canvas targeting and
// GM adjudication). Posts a chat card describing the outcome.
// No flags written, no status effects, no cross-turn state.
// -------------------------------------------------------------------------

export async function resolveSelectTarget(ctx) {
  const { attacker, defender, weapon } = ctx;
  if (!defender) return;

  const weaponName = weapon?.name ?? 'weapon';
  await ChatMessage.create({
    content: `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker?.name ?? '?'} → ${defender.name}</span>
          <span class="mi-card-skill">Select Target</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-outcome-row">
            <span class="mi-outcome success">
              <i class="fas fa-crosshairs"></i> ${defender.name} deflects ${attacker?.name ?? "their opponent"}'s fumbled ${weaponName} strike toward an adjacent bystander
            </span>
          </div>
          <p class="mi-card-note">The new victim is automatically hit with no chance to defend and suffers no Special Effects. GM determines the target and resolves any damage.</p>
        </div>
      </div>`,
    speaker: ChatMessage.getSpeaker({ actor: defender })
  });
}


// -------------------------------------------------------------------------
// resolveWeaponMalfunction — SE: Weapon Malfunction (defender, attacker fumbles, firearm only)
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

export async function resolveWeaponMalfunction(ctx) {
  const { attacker, defender, weapon } = ctx;
  if (!attacker || !weapon) return;

  const weaponId = weapon.id;
  const weaponName = weapon.name ?? 'firearm';

  // Always write to the BASE actor, not the synthetic token actor.
  // ctx.attacker may be a synthetic actor (canvas token) when called from
  // the macro or full-auto paths. Flags written to the synthetic actor live
  // in the token's actorDelta and are invisible to CharacterSheet._prepareContext,
  // which reads from this.document (the base actor).
  const baseActor = game.actors.get(attacker.id) ?? attacker;

  // Write the jammed flag on the attacker's base actor
  const existing = baseActor.getFlag(NS, 'jammedWeapons') ?? {};
  await baseActor.setFlag(NS, 'jammedWeapons', {
    ...existing,
    [weaponId]: { weaponName }
  });

  await ChatMessage.create({
    content: `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker.name}</span>
          <span class="mi-card-skill">Weapon Malfunction</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-outcome-row">
            <span class="mi-outcome mi-wound-major">
              <i class="fas fa-exclamation-triangle"></i> ${attacker.name}'s ${weaponName} jams and cannot fire!
            </span>
          </div>
          <p class="mi-card-note">Field-strip the weapon to clear the jam (costs 1 Action Point). The weapon cannot be used until cleared.</p>
        </div>
      </div>`,
    speaker: ChatMessage.getSpeaker({ actor: defender ?? attacker })
  });

  ui.notifications.warn(`${attacker.name}'s ${weaponName} has jammed — field-strip required to clear.`);
}

