/**
 * mythras-imperative/module/utils/rounding.js
 *
 * Mythras always rounds up. Pure, zero Foundry dependencies.
 *
 * Imperative p.3 (Core p.5 says the same): "Whenever a division result creates
 * a fraction, always round up to the whole number. So, for instance, 1/10th of
 * 63% is 6.3; this is rounded up to 7." Destined p.6: "When rounding fractions,
 * round up to the next whole number." None of the three books has a general
 * exception; the only round-downs anywhere are two Destined vehicle rules that
 * say so in their own text (carrier capacity, Weaponized hard points).
 *
 * Until v1.4.348 Initiative, Fatigue-halved movement and several other derived
 * numbers rounded DOWN (`Math.floor`), including one comment that said "round
 * down" outright.
 */

/**
 * The next whole number at or above `x` — Mythras rounding.
 *
 * Use this rather than a bare `Math.ceil` whenever `x` came out of a
 * NON-integer multiplier, because floating point makes exact products
 * overshoot: `100 * 1.1` is `110.00000000000001`, which `Math.ceil` turns into
 * 111. The value is snapped to 9 decimal places first, far below any real
 * fraction a rule can produce. A plain integer division (`x / 2`, `x / 5`) is
 * exact enough for `Math.ceil` either way.
 *
 * @param {number} x
 * @returns {number}  0 for anything that is not a finite number
 */
export function roundUp(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.ceil(Math.round(n * 1e9) / 1e9);
}
