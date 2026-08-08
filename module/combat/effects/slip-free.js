/**
 * module/combat/effects/slip-free.js
 *
 * SE resolver for Slip Free.
 * Rules p.45: On a Defender Critical, the defender automatically escapes all
 * active Entangle, Grip, and Pin holds. No opposed roll, no dialog.
 *
 * "Pin" covers both this system's pin mechanics: Pin Weapon (pin-weapon.js,
 * flag 'pinnedWeapons' — the defender's own weapon was pinned by someone
 * else's Pin Weapon SE in an earlier exchange where they were the attacker)
 * and Pin Object (pin-object.js, flag 'pinnedBy' — the defender's own
 * clothing/item was pinned). Both are keyed on the pinned actor themselves,
 * same as grippedBy/entangledBy, so they clear the same way.
 *
 * Dependencies:
 *   helpers.js — removeStatusFromActor
 */

import { removeStatusFromActor } from './helpers.js';

const NS = 'mythras-imperative';

// -------------------------------------------------------------------------
// resolveSlipFree — SE: Slip Free (defender, Defender Critical only).
//
// Clears on the defender:
//   - grippedBy, pendingGripCheck
//   - entangledBy, pendingEntangleBreakFree
//   - entangled token status (if entangled entries exist)
//   - pinnedWeapons (Pin Weapon), pinnedBy (Pin Object)
//
// Cross-reference cleanup on attacker-side actors:
//   - pendingEntangleTrip entries keyed by entangleId (so the trip prompt
//     never fires for a weapon that is no longer entangled)
//
// Posts a single narrative card. If the defender had no active holds at all
// the card still posts (degenerate case — player chose SE with nothing active).
// -------------------------------------------------------------------------
export async function resolveSlipFree(ctx) {
  const { attacker, defender } = ctx;
  if (!defender) return;

  // Resolve base actor for flag writes
  const baseDefender = game.actors.get(defender.id) ?? defender;

  // Count what we are about to clear (for the card display)
  const grippedBy       = baseDefender.getFlag(NS, 'grippedBy')      ?? {};
  const entangledBy     = baseDefender.getFlag(NS, 'entangledBy')    ?? {};
  const pinnedWeapons   = baseDefender.getFlag(NS, 'pinnedWeapons')  ?? {};
  const pinnedBy        = baseDefender.getFlag(NS, 'pinnedBy')       ?? {};
  const gripIds         = Object.keys(grippedBy);
  const entangleEntries = Object.entries(entangledBy);
  const pinnedWeaponIds = Object.keys(pinnedWeapons);
  const pinnedByIds     = Object.keys(pinnedBy);
  const clearedGrips     = gripIds.length;
  const clearedEntangles = entangleEntries.length;
  const clearedPins       = pinnedWeaponIds.length + pinnedByIds.length;

  // Post card FIRST so it always appears even if cleanup throws
  const hadHolds   = clearedGrips + clearedEntangles + clearedPins > 0;
  const effectNote = hadHolds
    ? `${defender.name} slips free — all grips, entanglements, and pins broken`
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
          ${clearedPins > 0 ? `
          <div class="mi-se-roll-row">
            <span class="mi-se-roll-label">Pins cleared</span>
            <span class="mi-se-roll-val">${clearedPins}</span>
          </div>` : ''}
        </div>
      </div>`,
    speaker: ChatMessage.getSpeaker({ actor: defender })
  });

  // Flag and status cleanup — try/catch so a flag error never suppresses the card
  try {
    // Clear grippedBy and matching pendingGripCheck entries on the defender
    if (gripIds.length > 0) {
      await baseDefender.unsetFlag(NS, 'grippedBy');
      const pendingGripCheck = baseDefender.getFlag(NS, 'pendingGripCheck') ?? {};
      const filteredGrip = Object.fromEntries(
        Object.entries(pendingGripCheck).filter(([k]) => !gripIds.includes(k))
      );
      await baseDefender.setFlag(NS, 'pendingGripCheck', filteredGrip);
    }

    // Clear entangledBy, token status, and attacker-side pending trip flags
    if (entangleEntries.length > 0) {
      await baseDefender.unsetFlag(NS, 'entangledBy');

      try {
        await removeStatusFromActor(defender, 'entangled');
      } catch (e) {
        console.warn('Mythras | Slip Free: could not remove entangled status:', e);
      }

      const entangleIds = entangleEntries.map(([k]) => k);
      const pendingBF   = baseDefender.getFlag(NS, 'pendingEntangleBreakFree') ?? {};
      const filteredBF  = Object.fromEntries(
        Object.entries(pendingBF).filter(([k]) => !entangleIds.includes(k))
      );
      await baseDefender.setFlag(NS, 'pendingEntangleBreakFree', filteredBF);

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

    // Clear pinnedWeapons (Pin Weapon) and pinnedBy (Pin Object) — both are
    // single flags with no cross-turn pending queue or companion actor-side
    // flag to clean up (see pin-weapon.js/pin-object.js's own headers).
    if (pinnedWeaponIds.length > 0) await baseDefender.unsetFlag(NS, 'pinnedWeapons');
    if (pinnedByIds.length > 0)     await baseDefender.unsetFlag(NS, 'pinnedBy');
  } catch (err) {
    console.error('Mythras | Slip Free flag cleanup error:', err);
  }
}
