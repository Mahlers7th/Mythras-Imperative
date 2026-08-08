/**
 * module/combat/effects/arise.js
 *
 * SE resolver for Arise.
 * Rules p.41: "Allows the defender to use a momentary opening to roll back
 * up to their feet." Automatic — no opposed roll, no dialog. Only meaningful
 * while prone, so the catalog entry carries restriction: 'defenderProne'
 * (SpecialEffectDialog.js) — a non-prone defender never sees this SE offered.
 * This resolver still handles the degenerate "not actually prone" case
 * gracefully rather than assuming the restriction always held (same defensive
 * shape as resolveSlipFree's "no active holds" case).
 *
 * Dependencies:
 *   helpers.js — removeStatusFromActor
 */

import { removeStatusFromActor } from './helpers.js';

// -------------------------------------------------------------------------
// resolveArise — SE: Arise (defender only, no restriction beyond being prone)
// -------------------------------------------------------------------------
export async function resolveArise(ctx) {
  const { attacker, defender } = ctx;
  if (!defender) return;

  // Status effects are per-token (canvas token's synthetic actor, not
  // necessarily the same object as `defender` when the token is unlinked —
  // see removeStatusFromActor's own doc). Resolve the same way it does
  // internally so "was actually prone" is checked against the actor object
  // that will really be modified, not whichever one `ctx.defender` happens
  // to be.
  const canvasToken = canvas?.tokens?.placeables?.find(t => t.actor?.id === defender.id) ?? null;
  const wasProne = canvasToken?.actor?.statuses?.has('prone') ?? false;
  if (wasProne) {
    await removeStatusFromActor(defender, 'prone');
  }

  const effectNote = wasProne
    ? `${defender.name} seizes a momentary opening and rolls back to their feet`
    : `${defender.name} uses Arise — already standing, no effect`;

  await ChatMessage.create({
    content: `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${attacker?.name ?? '?'} → ${defender.name}</span>
          <span class="mi-card-skill">Arise</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-outcome-row">
            <span class="mi-outcome success">
              <i class="fas fa-person-walking"></i> ${effectNote}
            </span>
          </div>
        </div>
      </div>`,
    speaker: ChatMessage.getSpeaker({ actor: defender })
  });
}
