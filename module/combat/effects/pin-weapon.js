/**
 * module/combat/effects/pin-weapon.js
 *
 * SE resolver for Pin Weapon.
 * Rules p.45: The defender traps the attacker's striking weapon, preventing
 * it from being used to parry until the end of the current Mythras round.
 * No opposed roll, no dialog — automatic in all automation modes.
 *
 * State: 'pinnedWeapons' flag on the base attacker actor.
 * Cleared: in the allSpent block (end of Mythras round) and deleteToken.
 *
 * No external dependencies beyond Foundry globals.
 */

const NS = 'mythras-imperative';

// -------------------------------------------------------------------------
// resolvePinWeapon — SE: Pin Weapon (defender only)
// -------------------------------------------------------------------------
export async function resolvePinWeapon(ctx) {
  const { attacker, defender, weapon } = ctx;
  if (!attacker || !defender || !weapon) return;

  // Resolve base attacker for persistent flag writes
  const baseAttacker = game.actors.get(attacker.id) ?? attacker;

  const pinId         = foundry.utils.randomID(8);
  const pinnedWeapons = baseAttacker.getFlag(NS, 'pinnedWeapons') ?? {};

  pinnedWeapons[pinId] = {
    weaponId:        weapon.id,
    weaponName:      weapon.name,
    pinnedByActorId: defender.id,
    pinnedByName:    defender.name
  };

  await baseAttacker.setFlag(NS, 'pinnedWeapons', pinnedWeapons);

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
