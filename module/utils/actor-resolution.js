/**
 * mythras-imperative/module/utils/actor-resolution.js
 *
 * Canonical token-first actor resolution. ctx.attacker / ctx.defender are
 * always token actors (synthetic) — an unlinked token's synthetic actor
 * shares its base actor's id, so game.actors.get(id) alone returns the
 * wrong (base) actor. Resolving via the canvas token first gets the same
 * synthetic actor and its items; falling back to game.actors.get() handles
 * the case where the token is no longer on canvas.
 *
 * v1.4.362: an id cannot tell apart several unlinked tokens of ONE actor —
 * Destined's swarms place five "Howler Swarm (5)" tokens from a single actor,
 * and every lookup by id found the first one on the map, so damage and Prone
 * landed on the wrong swarm. Combat now passes `combatRef(actor)`, the actor's
 * uuid, which for an unlinked token names the token itself
 * (Scene.x.Token.y.Actor.z). A plain id is still accepted, for older cards
 * and for callers that only ever deal with linked actors.
 */

/**
 * The reference combat stores for an actor: its uuid, which is unique per
 * token for unlinked tokens. Falls back to the id if there is no uuid.
 * @param {Actor|null} actor
 * @returns {string|null}
 */
export function combatRef(actor) {
  return actor?.uuid ?? actor?.id ?? null;
}

/**
 * Resolve an actor from a combat reference: a uuid (preferred, exact) or an
 * id (the canvas token's synthetic actor first, then the world actor).
 * @param {string} ref
 * @returns {Actor|null}
 */
export function resolveTokenActor(ref) {
  if (!ref) return null;
  if (String(ref).includes('.')) {
    try {
      const doc = fromUuidSync(ref);
      if (doc?.documentName === 'Actor') return doc;
      if (doc?.documentName === 'Token') return doc.actor ?? null;
    } catch { /* fall through to the id path */ }
    const id = String(ref).split('.').pop();
    return resolveTokenActor(id);
  }
  const token = canvas?.tokens?.placeables?.find(t =>
    t.actor?.id === ref || t.document?.actorId === ref
  ) ?? null;
  return token?.actor ?? game.actors.get(ref) ?? null;
}

/**
 * The canvas token for an actor. A synthetic (unlinked-token) actor knows its
 * own token, so it is used directly — searching the canvas by actor id would
 * find the FIRST token of that actor, which is a sibling swarm token as often
 * as not (v1.4.362). A linked/world actor falls back to that search.
 * @param {Actor|null} actor
 * @returns {Token|null}  the placeable, or null if not on the canvas
 */
export function tokenFor(actor) {
  if (!actor) return null;
  if (actor.isToken) {
    return actor.token?.object ?? canvas?.tokens?.get?.(actor.token?.id) ?? null;
  }
  return canvas?.tokens?.placeables?.find(t =>
    t.actor?.id === actor.id || t.document?.actorId === actor.id
  ) ?? null;
}

/**
 * The actor whose state a roll or status should touch: itself when it is
 * already a token's synthetic actor, else its canvas token's, else itself.
 * @param {Actor|null} actor
 * @returns {Actor|null}
 */
export function liveActor(actor) {
  if (!actor) return null;
  if (actor.isToken) return actor;
  return tokenFor(actor)?.actor ?? actor;
}

/**
 * Does a stored reference point at this actor? New entries hold a combatRef
 * (uuid) and match only the exact token; older entries hold a bare id and
 * match by id, as they always did (v1.4.363).
 * @param {string|null} ref
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function sameActor(ref, actor) {
  if (!ref || !actor) return false;
  if (ref === actor.uuid) return true;
  return !String(ref).includes('.') && ref === actor.id;
}

/**
 * Every actor that can hold combat state: the world actors plus the synthetic
 * actor of every unlinked token. Since v1.4.363 effect state (Entangle, Impale,
 * Grip, Pin, Press Advantage…) lives on the token's own actor, so a sweep over
 * game.actors alone would miss every unlinked creature — swarms included.
 * @returns {Actor[]}
 */
export function allStateHolders() {
  const out = [...(game.actors?.contents ?? [])];
  for (const scene of game.scenes?.contents ?? []) {
    for (const td of scene.tokens?.contents ?? []) {
      if (!td.actorLink && td.actor) out.push(td.actor);
    }
  }
  return out;
}
