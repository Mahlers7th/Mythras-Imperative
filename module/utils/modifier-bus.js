/**
 * module/utils/modifier-bus.js
 *
 * Shared implementation behind every "read-time additive numeric" hook
 * family on CONFIG.MYTHRAS (apBonusHooks, movementHooks, initiativeOffsetHooks,
 * damageModOffsetHooks, healingRateHooks, luckPointsHooks, powerPointsHooks,
 * hitPointBonusHooks, armourBonusHooks, apReductionHooks — the ten families
 * scoped for consolidation in roadmap-verified-v2.md Part 2/Phase 2b). Each
 * family previously carried its own near-identical inline `.reduce()`/`for`
 * loop at its call site; this is the one implementation all ten now call.
 *
 * Deliberately NOT a bus for every hook on CONFIG.MYTHRAS — override
 * (first-wins) families (weaponDamageHooks/weaponForceHooks), the composing
 * interception family (damageHooks), lifecycle events (attackResolvedHooks/
 * evasionHooks), boolean gates (rangedParryEligibleHooks/seEligibilityHooks),
 * and the last-valid-wins family (bashKnockbackMultiplierHooks) all have
 * genuinely different combination contracts and are left as their own
 * hand-written call sites — see extension-point-api-updated.md.
 *
 * Pure and Foundry-free, matching char-math.js/combat-math.js/roll-math.js.
 */

/**
 * Sum a module-registered hook array against a fixed argument list, isolating
 * each hook's own errors so one broken/removed module can't take down
 * another's contribution or the actor's own derivation.
 *
 * Each family's OWN surrounding math (flooring the result at 0/1, doubling
 * for a Hero Level advantage, seeding from a system base vs. contributing the
 * whole value, iterating once per hit location, etc.) stays at the call
 * site — this function only performs the sum itself.
 *
 * @param {Function[]} hooks - e.g. CONFIG.MYTHRAS?.apBonusHooks ?? []
 * @param {any[]} args - passed to every hook as fn(...args)
 * @param {object} [options]
 * @param {string} [options.errorLabel='hook'] - name used in the console.error
 *   prefix on a caught throw (e.g. 'apBonusHook', 'armourBonusHook').
 * @param {boolean} [options.clampNonNegative=false] - floor each hook's OWN
 *   contribution at 0 before summing (apReductionHooks' shape — a hook
 *   cannot use a reduction array to add armour back).
 * @returns {{ total: number, breakdown: { name: string, value: number }[] }}
 *   `breakdown` omits zero-value contributions (including swallowed throws),
 *   so it only ever lists hooks that actually moved the total — the
 *   provenance list for "why is this number 14?".
 */
export function sumHookContributions(hooks, args, { errorLabel = 'hook', clampNonNegative = false } = {}) {
  let total = 0;
  const breakdown = [];
  for (const fn of (hooks ?? [])) {
    let value;
    try {
      value = Number(fn(...args)) || 0;
    } catch (err) {
      console.error(`Mythras | ${errorLabel} error (${fn.destinedHookName || fn.name || 'anonymous'}):`, err);
      continue;
    }
    if (clampNonNegative) value = Math.max(0, value);
    if (value !== 0) {
      breakdown.push({ name: fn.destinedHookName || fn.name || 'anonymous', value });
    }
    total += value;
  }
  return { total, breakdown };
}
