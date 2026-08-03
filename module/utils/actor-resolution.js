/**
 * mythras-imperative/module/utils/actor-resolution.js
 *
 * Canonical token-first actor resolution. ctx.attacker / ctx.defender are
 * always token actors (synthetic) — an unlinked token's synthetic actor
 * shares its base actor's id, so game.actors.get(id) alone returns the
 * wrong (base) actor. Resolving via the canvas token first gets the same
 * synthetic actor and its items; falling back to game.actors.get() handles
 * the case where the token is no longer on canvas.
 */

/**
 * Resolve an actor by id, preferring the canvas token's synthetic actor.
 * @param {string} actorId
 * @returns {Actor|null}
 */
export function resolveTokenActor(actorId) {
  if (!actorId) return null;
  const token = canvas?.tokens?.placeables?.find(t =>
    t.actor?.id === actorId || t.document?.actorId === actorId
  ) ?? null;
  return token?.actor ?? game.actors.get(actorId) ?? null;
}
