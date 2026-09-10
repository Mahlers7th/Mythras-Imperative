/**
 * mythras-imperative/module/utils/hit-location.js
 *
 * Pure hit-location label/key helpers. Zero Foundry dependencies — safe to
 * import in Node/Jest without mocks.
 */

/**
 * Convert a hit-location label to the canonical camelCase key used across
 * the armourBonusHooks / hitPointBonusHooks contract and ArmourData.locations
 * / wardedLocations ('head', 'chest', 'abdomen', 'rightArm', 'leftArm',
 * 'rightLeg', 'leftLeg'). Handles the standard 7 humanoid labels via an
 * explicit lookup (case-insensitive); unknown labels fall back to a simple
 * whitespace-strip camelCase conversion so non-humanoid items (vehicle
 * system components, custom locations) still get a stable, collision-free key.
 *
 * This is the single canonical implementation — CharacterSheet's AP display
 * and mythras.mjs's syncHitLocationHP (the HP-max writer) both import it, so
 * the two can never drift into different key vocabularies for the same item.
 */
export function locationNameToKey(label) {
  const map = {
    'head':      'head',
    'chest':     'chest',
    'abdomen':   'abdomen',
    'right arm': 'rightArm',
    'left arm':  'leftArm',
    'right leg': 'rightLeg',
    'left leg':  'leftLeg',
  };
  return map[label?.toLowerCase()]
    ?? label?.replace(/\s+(.)/g, (_, c) => c.toUpperCase()).replace(/^\w/, c => c.toLowerCase())
    ?? label;
}

/**
 * Resolve which hit location a d20 lands on.
 *
 * Extracted v1.4.321. The identical filter/sort/find existed inline in
 * `_onSemiAutoRollLocation`, and adding the Luck Point re-roll would have made
 * a second copy — the drift this repo has paid for repeatedly (three copies of
 * the armour arithmetic, two of `determineOutcome`). Pure over a plain array
 * so it is testable without Foundry.
 *
 * Locations are sorted by `rangeMin` and matched inclusively against
 * `rangeMin..rangeMax`. A roll that falls in no band returns the highest
 * location rather than nothing — the original behaviour, and the safe one: a
 * creature with an incomplete table still resolves somewhere instead of
 * throwing mid-attack.
 *
 * @param {Array<{id?: string, name?: string, system?: {rangeMin?: number, rangeMax?: number}}>} locations
 *   the actor's `hit-location` items, in any order
 * @param {number} d20
 * @returns {object|null} the matching location item, or null if there are none
 */
export function hitLocationForRoll(locations, d20) {
  const sorted = [...(locations ?? [])]
    .filter(Boolean)
    .sort((a, b) => (a.system?.rangeMin ?? 0) - (b.system?.rangeMin ?? 0));
  if (!sorted.length) return null;
  return sorted.find(l => d20 >= (l.system?.rangeMin ?? 1) && d20 <= (l.system?.rangeMax ?? 20))
    ?? sorted[sorted.length - 1];
}
