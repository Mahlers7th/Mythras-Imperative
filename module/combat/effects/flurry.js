/**
 * module/combat/effects/flurry.js
 *
 * SE resolver for Flurry — Destined rulebook (p.161), listed among the
 * Special Effects "available for all combatants" (no `gated` catalog
 * entry, unlike Pin Object): "The hero spends an Action Point to make an
 * immediate follow-up unarmed attack with a different body part from the
 * one used to make the initial attack... This attack occurs on the same
 * Turn as the initial attack that triggered the effect." The triggering
 * attack can use ANY weapon (the rulebook's own example uses a baton) —
 * only the follow-up strike itself is unarmed.
 *
 * Unlike every other resolver in this directory, Flurry's "effect" IS a
 * second, genuine attack rather than a flag write or a damage delta. This
 * resolver finds the attacker's own Unarmed weapon item (every character
 * has one — the same item Destined's Combat Expert Unarmed Expertise
 * already keys off via the system's 'unarmed' weapon trait, see
 * mythras-imperative's config.js weaponTraits registry) and re-enters the
 * SAME pipeline a player uses for any normal attack
 * (CombatEngine._buildContext + CombatEngine._runDialog) against the same
 * defender. This is a real second attack, not a simulation — AP spend,
 * dialog, roll, defence, damage, and any further Special Effects
 * (including a second Flurry, naturally self-limiting on the attacker's
 * remaining Action Points — matches the rulebook's own "successive
 * attacks" framing, not a bug needing a cap) all run through the real
 * pipeline for free.
 *
 * AP-availability is checked here BEFORE opening a dialog (rather than
 * relying on CombatEngine._spendActionPoint's own internal guard) purely
 * for UX — no point popping a full Attacker Dialog only to have the AP
 * spend silently fail deep inside it.
 *
 * CombatEngine is imported dynamically (not at module load time) to avoid
 * a circular import: CombatEngine.js imports SE_RESOLVERS from this
 * directory's index.js, which imports this file. AttackerDialog.js uses
 * the identical dynamic-import pattern for the same reason (see its own
 * Step 5 / _runDialog call).
 */

// -------------------------------------------------------------------------
// resolveFlurry — SE: Flurry
// -------------------------------------------------------------------------
export async function resolveFlurry(ctx) {
  const { attacker, defender } = ctx;
  if (!attacker || !defender) return;

  const unarmedWeapon = attacker.items.find(
    i => i.type === 'weapon' && (i.system?.traits ?? []).includes('unarmed')
  );
  if (!unarmedWeapon) {
    ui.notifications.warn(`${attacker.name} has no Unarmed weapon item — Flurry needs one to deliver the follow-up strike.`);
    return;
  }

  const apValue = attacker.system.attributes?.actionPoints?.value ?? 0;
  if (apValue <= 0) {
    await ChatMessage.create({
      content: `
        <div class="mi-chat-card">
          <div class="mi-card-header mi-card-header--stacked">
            <span class="mi-card-actor">${attacker.name}</span>
            <span class="mi-card-skill">Flurry</span>
          </div>
          <div class="mi-card-body">
            <div class="mi-outcome-row">
              <span class="mi-outcome failure">
                <i class="fas fa-times-circle"></i>
                No Action Points remaining — the follow-up attack cannot be made.
              </span>
            </div>
          </div>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor: attacker })
    });
    return;
  }

  await ChatMessage.create({
    content: `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker.name} → ${defender.name}</span>
          <span class="mi-card-skill">Flurry — immediate follow-up</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-outcome-row">
            <span class="mi-outcome success">
              <i class="fas fa-bolt"></i>
              ${attacker.name} spends an Action Point for an unarmed follow-up strike
            </span>
          </div>
        </div>
      </div>`,
    speaker: ChatMessage.getSpeaker({ actor: attacker })
  });

  const { CombatEngine } = await import('../CombatEngine.js');
  const followUpCtx = CombatEngine._buildContext(attacker, defender, unarmedWeapon);
  await CombatEngine._runDialog(followUpCtx);
}
