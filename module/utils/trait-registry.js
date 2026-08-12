/**
 * mythras-imperative/module/utils/trait-registry.js
 *
 * Pure helpers for querying CONFIG.MYTHRAS's flat trait registries
 * (weaponTraits today; any future registry sharing the same
 * { key, label, description, engineEffect, category } shape works too).
 * Zero Foundry dependencies — safe to import in Node/Jest without mocks.
 */

/**
 * Return the keys of every entry in a trait registry tagged with the
 * given category.
 *
 * Seam 5 (seam-design-outcomes.md §5): weaponTraits was already an
 * extensible registry with a sheet, but flat — 'fire' and 'impaling'
 * occupied the same namespace with nothing distinguishing "describes what
 * kind of damage this is" from "enables a Special Effect." A consumer
 * that needs only the damage-type ones (Destined's Resistance/Immunity/
 * Adaptive Resistance, a future CFI element/school comparison) previously
 * had no way to ask that question except hand-rolling its own hardcoded,
 * substring-matched type list — which is exactly how a real bug shipped
 * ('explos' matching both "explosive" and "explosion"). This function is
 * that missing query; the `category` field it reads is additive, not a
 * new registry.
 *
 * @param {Object.<string, {category?: string}>} registry  A
 *   CONFIG.MYTHRAS.<x>Traits-shaped object.
 * @param {string} category
 * @returns {string[]} The registry keys (not the entries) whose own
 *   `category` field matches, in registry iteration order.
 */
export function getTraitsByCategory(registry, category) {
  return Object.entries(registry ?? {})
    .filter(([, entry]) => entry?.category === category)
    .map(([key]) => key);
}
