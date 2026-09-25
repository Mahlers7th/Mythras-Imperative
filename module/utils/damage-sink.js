/**
 * module/utils/damage-sink.js
 *
 * The pure half of two extension points added in v1.4.358 for creatures that
 * keep one pool of Hit Points while still being struck on ordinary hit
 * locations — the Mythras Companion / Destined Companion "Managing Large
 * Groups" units (a swarm of twenty Howlers), first used by Destined.
 *
 *   damageLocationHooks — (defender, locItem, ctx) => DamageSink | undefined
 *     First valid sink wins. The struck location is still rolled, named on the
 *     card and armoured as normal; only the HP write goes to the sink, and no
 *     wound is assessed (no Serious/Major wound, no Endurance roll).
 *
 *   seExclusionHooks — (seId, ctx, isAttackerWinner) => true | undefined
 *     Any `true` hides that Special Effect from the winner's list. The opposite
 *     of seEligibilityHooks (a default-deny gate for `gated` SEs only): this
 *     one is default-allow and applies to every SE.
 *
 * Free of Foundry globals so Jest can test it directly.
 */

/**
 * @typedef {object} DamageSink
 * @property {string} label           what took the damage, for cards and notices
 * @property {number} current         its HP before this damage
 * @property {number} max             its maximum HP
 * @property {(newCurrent:number, damage:number) => Promise<void>|void} write
 *           persists the new value; called once, after damageHooks have run
 */

/** True for an object a damageLocationHook may return. */
export function isDamageSink(sink) {
  return !!sink
    && typeof sink === 'object'
    && typeof sink.write === 'function'
    && Number.isFinite(Number(sink.current))
    && Number.isFinite(Number(sink.max));
}

/**
 * The first valid sink any hook offers for this hit, or null.
 * A hook that throws is logged and treated as declining.
 *
 * @param {object} defender
 * @param {object|null} locItem   the struck hit-location item (may be null)
 * @param {object} ctx
 * @param {Function[]} hooks
 * @param {(err:unknown) => void} [onError]
 * @returns {DamageSink|null}
 */
export function findDamageSink(defender, locItem, ctx, hooks, onError = () => {}) {
  for (const hook of hooks ?? []) {
    let sink;
    try { sink = hook(defender, locItem, ctx); }
    catch (err) { onError(err); continue; }
    if (isDamageSink(sink)) {
      return { ...sink, label: String(sink.label ?? 'Pool'), current: Number(sink.current), max: Number(sink.max) };
    }
  }
  return null;
}

/**
 * True when any hook hides this Special Effect. A hook that throws is logged
 * and treated as declining, so one broken module cannot empty the list.
 *
 * @param {string} seId
 * @param {object} ctx
 * @param {boolean} isAttackerWinner
 * @param {Function[]} hooks
 * @param {(err:unknown) => void} [onError]
 */
export function isSEExcluded(seId, ctx, isAttackerWinner, hooks, onError = () => {}) {
  for (const hook of hooks ?? []) {
    try { if (hook(seId, ctx, isAttackerWinner) === true) return true; }
    catch (err) { onError(err); }
  }
  return false;
}
