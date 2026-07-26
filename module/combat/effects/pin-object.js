/**
 * module/combat/effects/pin-object.js
 *
 * SE resolver for Pin Object — Destined's Combat Expert "Pinning Attack"
 * Expertise. Gated behind seEligibilityHooks (see config.js) — the
 * catalog entry carries `gated: true`, so only an actor a module hook
 * vouches for ever sees this in the SE picker.
 *
 * Rules text (Destined, Pinning Attack): a hit with a piercing or
 * entangling weapon that earns a Special Effect may be used to pin the
 * target's clothing or a held item to a nearby surface instead of dealing
 * damage. No opposed roll — this is the SE winner's own choice, same as
 * Grip (grip.js) and unlike Bleed/Impale's resistance rolls.
 *
 * Escaping is a Ready Item Action (spend an Action Point + unopposed Brawn
 * check) or simply dropping/removing the pinned item — this engine has no
 * "actor cannot move" enforcement mechanism anywhere (no Ward Location has
 * one either), so that restriction is GM-adjudicated, matching Toxic's own
 * documented "one-step difficulty penalty, not enforced" precedent in the
 * Destined module. The `pinnedBy` flag exists so a GM/module can query
 * "is this actor pinned" — it does not by itself block anything.
 *
 * No damage dealt: this resolver must not touch the hit location's HP even
 * though `damage` may be nonzero on the triggering hit (requiresDamage is
 * explicitly false in the catalog — Pinning Attack applies to a hit that
 * scored the SE, not one that dealt damage).
 *
 * Dependencies: none beyond Foundry globals — mirrors damage-weapon.js's
 * "no dialog, automatic in all modes" shape.
 */

const NS = 'mythras-imperative';

// -------------------------------------------------------------------------
// resolvePinObject — SE: Pin Object
// -------------------------------------------------------------------------
export async function resolvePinObject(ctx) {
  const { attacker, defender, weapon } = ctx;
  if (!attacker || !defender || !weapon) return;

  const baseDefender = game.actors.get(defender.id) ?? defender;
  const pinEntryId    = foundry.utils.randomID(8);

  const existing = baseDefender.getFlag(NS, 'pinnedBy') ?? {};
  existing[pinEntryId] = {
    attackerId:       attacker.id,
    weaponId:          weapon.id,
    weaponName:        weapon.name,
    hitLocationId:     ctx.hitLocationId    ?? '',
    hitLocationLabel:  ctx.hitLocationLabel ?? '',
  };
  await baseDefender.setFlag(NS, 'pinnedBy', existing);

  await ChatMessage.create({
    content: `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker.name} → ${defender.name}</span>
          <span class="mi-card-skill">Pin Object — ${weapon.name}</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-outcome-row">
            <span class="mi-outcome mi-wound-serious">
              <i class="fas fa-thumbtack"></i>
              ${defender.name}'s ${ctx.hitLocationLabel ?? 'clothing/item'} is pinned to a nearby surface — no damage dealt
            </span>
          </div>
          <p class="mi-se-roll-note">
            Free: spend an Action Point + unopposed Brawn check, or drop/remove the pinned item
            (Ready Item Action). Movement restriction while pinned is GM-adjudicated — not
            mechanically enforced.
          </p>
        </div>
      </div>`,
    speaker: ChatMessage.getSpeaker({ actor: attacker })
  });
}
