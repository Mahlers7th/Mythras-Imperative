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
