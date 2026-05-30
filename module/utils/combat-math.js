/**
 * mythras-imperative/module/utils/combat-math.js
 *
 * Pure combat math functions extracted from CombatEngine for testability.
 * Zero Foundry dependencies — safe to import in Node/Jest without mocks.
 *
 * CombatEngine delegates all table lookups to these functions.
 */

// ---------------------------------------------------------------------------
// Outcome determination
// ---------------------------------------------------------------------------

/**
 * Determine the success level of a single d100 roll.
 *
 * Rules p.21:
 *   - Fumble:   result >= 100, OR result >= 99 when skill < 100
 *   - Critical: result <= ceil(skill / 10)
 *   - Success:  result <= skill
 *   - Failure:  result > skill
 *
 * @param {number} result  The d100 roll result (1–100)
 * @param {number} target  Effective skill after difficulty applied
 * @param {number} [rawSkill]  Pre-difficulty skill (for fumble threshold).
 *   When omitted, falls back to `target` — safe for CombatEngine's internal
 *   use where target already equals the adjusted skill.
 * @returns {'critical'|'success'|'failure'|'fumble'}
 */
export function determineOutcome(result, target, rawSkill = target) {
  // Fumble: 99–100 always, or 99 when raw skill < 100
  if (result >= 100 || (result >= 99 && rawSkill < 100)) return 'fumble';

  // Critical: within 1/10 of target (round up)
  const critThreshold = Math.ceil(target / 10);
  if (result <= critThreshold) return 'critical';

  return result <= target ? 'success' : 'failure';
}

// ---------------------------------------------------------------------------
// Opposed roll resolution
// ---------------------------------------------------------------------------

/**
 * Resolve an opposed roll. Returns true if the DEFENDER wins (resists).
 *
 * Rules p.24:
 * - Higher level of success wins.
 * - On equal levels, the higher roll wins (within success range).
 * - Two failures: attacker's effect applies (defender didn't overcome SE).
 *
 * @param {number} attackerRoll
 * @param {number} attackerTotal
 * @param {number} defenderRoll
 * @param {number} defenderTotal
 * @returns {boolean}  true = defender wins
 */
export function resolveOpposedRoll(attackerRoll, attackerTotal, defenderRoll, defenderTotal) {
  const levelOrder = { critical: 3, success: 2, failure: 1, fumble: 0 };

  const atkLevel = levelOrder[determineOutcome(attackerRoll, attackerTotal)];
  const defLevel = levelOrder[determineOutcome(defenderRoll, defenderTotal)];

  if (defLevel > atkLevel) return true;   // defender wins — resists
  if (atkLevel > defLevel) return false;  // attacker wins — effect applies

  // Equal levels: both failed/fumbled → attacker wins
  if (atkLevel <= 1) return false;

  // Both succeeded at the same level: higher roll wins
  return defenderRoll > attackerRoll;
}

// ---------------------------------------------------------------------------
// Differential / Special Effect table
// ---------------------------------------------------------------------------

/**
 * Resolve the differential special effect count from an exchange.
 * Implements the exact p.25 table.
 *
 * @param {'critical'|'success'|'failure'|'fumble'} attackOutcome
 * @param {'critical'|'success'|'failure'|'fumble'|'none'} defenceOutcome
 * @returns {{ seWinner: 'attacker'|'defender'|'none', seCount: number }}
 */
export function resolveDifferential(attackOutcome, defenceOutcome) {
  const TABLE = {
    critical: { critical: 0, success:  1, failure:  2, fumble:  3, none:  2 },
    success:  { critical:-1, success:  0, failure:  1, fumble:  2, none:  1 },
    failure:  { critical:-2, success: -1, failure:  0, fumble:  0, none:  0 },
    fumble:   { critical:-3, success: -2, failure:  0, fumble:  0, none:  0 }
  };

  const result = TABLE[attackOutcome]?.[defenceOutcome] ?? 0;
  if (result > 0) return { seWinner: 'attacker', seCount: result };
  if (result < 0) return { seWinner: 'defender', seCount: Math.abs(result) };
  return { seWinner: 'none', seCount: 0 };
}

// ---------------------------------------------------------------------------
// Parry damage reduction  (rules p.40)
// ---------------------------------------------------------------------------

const SIZE_ORDER = { S: 0, M: 1, L: 2, H: 3, E: 4 };

/**
 * Determine the damage multiplier after parry.
 *
 * @param {string} atkSize   Attack weapon size key ('S'|'M'|'L'|'H'|'E')
 * @param {string} defSize   Defence weapon size key
 * @param {object} [opts]
 * @param {boolean} [opts.defensiveMinded]  True if defender has the trait
 * @param {boolean} [opts.unarmedProwess]   True if defender has the trait
 * @param {boolean} [opts.defIsUnarmed]     True if defence weapon is unarmed
 * @param {boolean} [opts.isRanged]         True if attack is ranged
 * @param {boolean} [opts.rangeBandLong]    True if range band is long
 * @returns {{ multiplier: 0|0.5|1, label: 'full'|'half'|'none' }}
 */
export function resolveParryReduction(atkSize, defSize, opts = {}) {
  let defIdx = SIZE_ORDER[defSize] ?? 1;
  let atkIdx = SIZE_ORDER[atkSize] ?? 1;

  if (opts.defensiveMinded)                          defIdx = Math.min(defIdx + 1, 4);
  if (opts.unarmedProwess && opts.defIsUnarmed)      defIdx = Math.max(defIdx, 1);
  if (opts.isRanged && opts.rangeBandLong)           atkIdx = Math.max(0, atkIdx - 1);

  const diff = atkIdx - defIdx;

  if (diff <= 0) return { multiplier: 0,   label: 'full' };
  if (diff === 1) return { multiplier: 0.5, label: 'half' };
  return               { multiplier: 1,   label: 'none' };
}

// ---------------------------------------------------------------------------
// Wound level  (rules p.31–32)
// ---------------------------------------------------------------------------

/**
 * Classify a wound as minor, serious, or major based on damage and HP.
 *
 * @param {number} damage      Damage applied to the location
 * @param {number} maxHp       Location's maximum HP
 * @param {number} newCurrent  HP after damage (may be negative)
 * @returns {'none'|'minor'|'serious'|'major'}
 */
export function woundLevel(damage, maxHp, newCurrent) {
  if (damage <= 0)          return 'none';
  if (newCurrent <= -maxHp) return 'major';
  if (newCurrent <= 0)      return 'serious';
  return 'minor';
}

// ---------------------------------------------------------------------------
// Damage modifier step  (15-step table)
// ---------------------------------------------------------------------------

export const DM_TABLE = [
  '-1d8', '-1d6', '-1d4', '-1d2', '+0',
  '+1d2', '+1d4', '+1d6', '+1d8', '+1d10',
  '+1d12', '+2d6', '+2d8', '+2d10', '+2d12'
];

/**
 * Step a damage modifier string one position higher on the 15-step table.
 *
 * @param {string} currentDM  e.g. '+1d6'
 * @returns {string}
 */
export function stepUpDamageModifier(currentDM) {
  const dm  = (currentDM === '' || currentDM === '0') ? '+0' : currentDM;
  const idx = DM_TABLE.indexOf(dm);
  if (idx === -1) return currentDM;
  return DM_TABLE[Math.min(idx + 1, DM_TABLE.length - 1)];
}

// ---------------------------------------------------------------------------
// Impale grade table  (rules p.44)
// ---------------------------------------------------------------------------

/**
 * Determine the Endurance roll difficulty grade when a weapon is impaled.
 *
 * @param {'S'|'M'|'L'|'H'|'E'} weaponSize
 * @param {number} defenderSIZ
 * @returns {string}  grade id or 'none'
 */
export function getImpaleGrade(weaponSize, defenderSIZ) {
  const table = [
    { min: 1,  max: 10,  S: 'formidable', M: 'herculean',  L: 'incapacitated', H: 'incapacitated', E: 'incapacitated' },
    { min: 11, max: 20,  S: 'hard',       M: 'formidable', L: 'herculean',     H: 'incapacitated', E: 'incapacitated' },
    { min: 21, max: 30,  S: 'none',       M: 'hard',       L: 'formidable',    H: 'herculean',     E: 'incapacitated' },
    { min: 31, max: 40,  S: 'none',       M: 'none',       L: 'hard',          H: 'formidable',    E: 'herculean'     },
    { min: 41, max: 50,  S: 'none',       M: 'none',       L: 'none',          H: 'hard',          E: 'formidable'    },
  ];
  const siz  = Math.max(1, defenderSIZ ?? 13);
  const size = weaponSize ?? 'M';

  if (siz <= 50) {
    const row = table.find(r => siz >= r.min && siz <= r.max);
    return row?.[size] ?? 'none';
  }
  // SIZ > 50: each +10 beyond 50 shifts column easier
  const sizeOrder  = ['S', 'M', 'L', 'H', 'E'];
  const extraBands = Math.floor((siz - 50) / 10);
  const baseIdx    = sizeOrder.indexOf(size);
  const shifted    = sizeOrder[Math.max(0, baseIdx - extraBands)];
  return table[4][shifted] ?? 'none';
}
