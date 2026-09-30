/**
 * mythras-imperative/module/utils/range-band.js
 *
 * `maxRangeBandHooks` (v1.4.365) — how far a ranged weapon can reach.
 *
 * The attack dialog's range band (Close / Effective / Long) is chosen by the
 * player; a weapon's rangeClose/Effective/Long numbers are display only. A
 * module whose rules cap a weapon's reach needs a way to say so. First
 * consumer: Destined's Short Range limit on Blast ("The hero's Blasts only go
 * out to the Short-Range value of the power, and are ineffective past that
 * range").
 *
 * Each hook: `(weapon, attacker) => 'close' | 'effective' | 'long' | undefined`.
 * The most restrictive answer wins; undefined (or anything else) means no cap.
 * A throwing hook is logged and ignored. The dialog disables the bands past
 * the cap, and the chosen band is clamped again when the attack is read, so a
 * macro or stale dialog cannot get past it.
 *
 * Pure apart from reading the hook list — tested directly.
 */

export const RANGE_BANDS = ['close', 'effective', 'long'];

/**
 * The furthest band this weapon may be used at, or null for no cap.
 * @param {Function[]} hooks
 * @param {Item} weapon
 * @param {Actor} attacker
 * @returns {'close'|'effective'|'long'|null}
 */
export function maxRangeBand(hooks, weapon, attacker) {
  let cap = null;
  for (const hook of hooks ?? []) {
    let band;
    try { band = hook(weapon, attacker); }
    catch (err) { console.error('Mythras | maxRangeBandHook error:', err); continue; }
    const i = RANGE_BANDS.indexOf(band);
    if (i < 0) continue;
    if (cap === null || i < RANGE_BANDS.indexOf(cap)) cap = band;
  }
  return cap;
}

/**
 * A band no further than the cap.
 * @param {string} band
 * @param {string|null} cap
 * @returns {string}
 */
export function clampRangeBand(band, cap) {
  if (!cap) return band;
  const i = RANGE_BANDS.indexOf(band), c = RANGE_BANDS.indexOf(cap);
  if (i < 0 || c < 0) return band;
  return i > c ? cap : band;
}
