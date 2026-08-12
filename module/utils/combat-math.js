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

// Re-exported from roll-math.js — this used to be a separate, byte-identical
// copy of the same function (both independently missing the rules p.18
// 01-05-Success/96-00-Failure floor-ceiling until it was found and fixed).
// resolveOpposedRoll below is the entire opposed-SE-roll system's (Bleed,
// Trip, Entangle, Grip, Impale, etc.) only path to outcome determination, so
// a second hand-maintained copy here was a real drift risk, not just noise.
export { determineOutcome } from './roll-math.js';
import { determineOutcome } from './roll-math.js';

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

/**
 * Classify a hit location's wound STATE from its current HP alone — "what
 * wound is this location at right now," as distinct from woundLevel above,
 * which answers "what wound did this hit cause" (an event classifier that
 * returns 'none' for any non-positive damage, regardless of current HP).
 *
 * Needed because system.wound was, until this function existed, only ever
 * written at damage time — nothing recomputed it when HP changed by any
 * other route (healing, natural regeneration, a GM editing the value
 * directly). A location healed from -2 to +2 stayed flagged 'serious'
 * indefinitely. Rules p.31-32: recovery is framed in terms of the wound
 * category changing as current HP crosses back over these same thresholds
 * ("heal 3 HP per week [Serious-Wound rate] until his wound goes above
 * zero, and then heal 3 HP per day [ordinary rate]") — the state and the
 * thresholds are the same as the event classifier's, not a separate scale.
 *
 * @param {number} current  Location's current HP (may be negative)
 * @param {number} maxHp    Location's maximum HP
 * @returns {'none'|'minor'|'serious'|'major'}
 */
export function woundState(current, maxHp) {
  if (current >= maxHp)  return 'none';
  if (current <= -maxHp) return 'major';
  if (current <= 0)      return 'serious';
  return 'minor';
}

/**
 * Decision core for the hit-location wound-state sync hook (mythras.mjs,
 * `Hooks.on('preUpdateItem', ...)`). Extracted as a pure function — no
 * Foundry globals, no `foundry.utils.getProperty`/`setProperty` — so this
 * can be imported and unit-tested for real, not just mirrored or only
 * live-verified. The hook itself is a thin wrapper: pull `system.current`/
 * `system.wound` out of an update's `changed` data with
 * `foundry.utils.getProperty` (handles both the dotted-string-key and
 * nested-object forms a caller might use), call this, and — if it returns
 * anything other than `undefined` — write it back with
 * `foundry.utils.setProperty`.
 *
 * Deliberate design choice, not in the seam-design session's own text: the
 * session's design called for patching the specific known non-damage
 * write sites (heal routes, sheet edits) individually. This function is
 * instead consulted for EVERY hit-location update, from any writer —
 * matching the single-chokepoint shape the rest of that session's seams
 * converged on, and the only shape that can also catch a raw GM sheet
 * edit (`CharacterSheet.js`'s generic `_onItemFieldChange`, which has no
 * idea it's touching a wound-relevant field and can't be individually
 * patched). The consequence: any future writer of `system.current` —
 * including a module or a macro that has never heard of this hook —
 * now gets `system.wound` reclassified automatically unless it also sets
 * `system.wound` explicitly in the same update. That's the intended
 * contract, not an accident of the implementation.
 *
 * @param {string} itemType        The item's `type` (only 'hit-location' acts)
 * @param {number} maxHp           The location's current `system.hp` (max)
 * @param {number|undefined} newCurrent    `system.current` from the update's
 *   changed data, or `undefined` if this update doesn't touch it
 * @param {string|undefined} explicitWound `system.wound` from the update's
 *   changed data, or `undefined` if the caller didn't set it
 * @returns {'none'|'minor'|'serious'|'major'|undefined} The wound value to
 *   write, or `undefined` to mean "don't touch system.wound for this update"
 */
export function resolveWoundSync(itemType, maxHp, newCurrent, explicitWound) {
  if (itemType !== 'hit-location') return undefined;
  if (newCurrent === undefined) return undefined;
  if (explicitWound !== undefined) return undefined;
  return woundState(newCurrent, maxHp);
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
 * Shift a damage modifier string by N steps along the 15-step table
 * (negative = weaker, positive = stronger, 0 = unchanged). Clamps at
 * the table's own ends rather than overflowing. An unrecognized DM
 * string passes through unchanged, same fallback as shiftGrade
 * (roll-math.js) for the parallel Difficulty Grade table.
 *
 * @param {string} currentDM  e.g. '+1d6'
 * @param {number} steps
 * @returns {string}
 */
export function shiftDamageModifier(currentDM, steps) {
  const dm  = (currentDM === '' || currentDM === '0') ? '+0' : currentDM;
  const idx = DM_TABLE.indexOf(dm);
  if (idx === -1) return currentDM;
  return DM_TABLE[Math.max(0, Math.min(DM_TABLE.length - 1, idx + steps))];
}

/**
 * Step a damage modifier string one position higher on the 15-step table.
 * Thin wrapper over shiftDamageModifier(currentDM, 1) — kept as its own
 * named export since "step up one" (Charge, rules p.XX) is a distinct,
 * frequently-used case worth naming, not just an inline `shiftDamageModifier(dm, 1)`.
 *
 * @param {string} currentDM  e.g. '+1d6'
 * @returns {string}
 */
export function stepUpDamageModifier(currentDM) {
  return shiftDamageModifier(currentDM, 1);
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


// ---------------------------------------------------------------------------
// Weapon base max damage  (used by Bodkin ammo trait)
// ---------------------------------------------------------------------------

/**
 * Return the maximum value of a weapon's base damage formula, excluding the
 * actor's damage modifier (which is a separate ctx field appended at roll time).
 *
 * Parses a dice expression string such as '1d6', '1d8+1', '2d4+2'.
 * For Bodkin AP reduction: Math.ceil(weaponBaseMax(formula) / 2).
 *
 * Only NdX+K notation is supported (N dice of X faces, optional flat bonus K).
 * If the formula cannot be parsed, returns 0.
 *
 * @param {string} formula  e.g. '1d6', '1d8+1', '2d4+2'
 * @returns {number}
 */
export function weaponBaseMax(formula) {
  if (!formula || typeof formula !== 'string') return 0;
  // Strip spaces, lowercase
  const f = formula.replace(/\s/g, '').toLowerCase();
  // Match NdX, NdX+K, NdX-K
  const match = f.match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (!match) return 0;
  const numDice = parseInt(match[1], 10);
  const faces   = parseInt(match[2], 10);
  const flat    = match[3] ? parseInt(match[3], 10) : 0;
  return numDice * faces + flat;
}

// ---------------------------------------------------------------------------
// Location classification  (used by wound consequence logic)
// ---------------------------------------------------------------------------

/**
 * Classify a hit location name as 'limb', 'head', or 'torso'.
 *
 * @param {string} locationName  The location item's name or label
 * @returns {'limb'|'head'|'torso'}
 */
export function classifyLocation(locationName) {
  const n = (locationName ?? '').toLowerCase();
  if (/arm|hand|leg|foot|claw|tentacle|wing/.test(n)) return 'limb';
  if (/head|skull/.test(n))                            return 'head';
  return 'torso'; // abdomen, chest, thorax, and unknown default
}

// ---------------------------------------------------------------------------
// Initiative tie-break  (rules p.35)
// ---------------------------------------------------------------------------

/**
 * Deterministic FNV-1a-style hash, used only as the final Initiative
 * tie-break step (rules p.35: "...have each roll a die with high roll going
 * before the other"). Stable per seed string so re-sorting the combat
 * tracker doesn't reshuffle already-tied combatants on every render.
 *
 * @param {string} seed  Typically `${combatId}:${combatantId}`.
 * @returns {number}  Unsigned 32-bit integer.
 */
export function initiativeTieBreakSeed(seed) {
  let hash = 0x811c9dc5;
  const str = seed ?? '';
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Compare two combatants for turn-order sorting per rules p.35:
 * 1. Higher Initiative acts first.
 * 2. Tied Initiative: higher DEX acts first.
 * 3. Still tied: "roll a die" — a stable per-combatant hash stands in for
 *    the literal die roll so the order doesn't flicker on re-sort.
 * 4. Still tied (identical seed inputs): fall back to id comparison, same
 *    as Foundry core's own default tie-break, so sorting stays a strict
 *    total order.
 *
 * @param {{initiative: number, dex: number, seed: string, id: string}} a
 * @param {{initiative: number, dex: number, seed: string, id: string}} b
 * @returns {number}
 */
export function compareInitiative(a, b) {
  const ia = Number.isFinite(a.initiative) ? a.initiative : -Infinity;
  const ib = Number.isFinite(b.initiative) ? b.initiative : -Infinity;
  if (ib !== ia) return ib - ia;

  const dexA = Number.isFinite(a.dex) ? a.dex : -Infinity;
  const dexB = Number.isFinite(b.dex) ? b.dex : -Infinity;
  if (dexB !== dexA) return dexB - dexA;

  const seedA = initiativeTieBreakSeed(a.seed);
  const seedB = initiativeTieBreakSeed(b.seed);
  if (seedB !== seedA) return seedB - seedA;

  return a.id > b.id ? 1 : -1;
}

// ---------------------------------------------------------------------------
// Vehicle Handling & Manoeuvres — Loss of Control table (rules p.58)
// ---------------------------------------------------------------------------

// Exact 1d100 → result mapping, cross-checked against a second, non--layout
// PDF extraction (pdftotext without -layout) after the first -layout pass
// interleaved the range column and the result-text column into a garbled
// order — see the 2026-08-04 Vehicles audit. Nine ranges, nine named
// results, matched 1:1 in increasing severity as the roll climbs, the same
// pattern this rulebook uses for its other d100 tables (Impale, fumbles).
//
// occupantDamage.locations is informational only — automated resolution
// (see CombatEngine.initiateVehicleManoeuvre) always applies to one rolled
// hit location per crew member; multi-location text is preserved here for
// the chat card's rules citation.
export const LOSS_OF_CONTROL_TABLE = [
  {
    min: 1, max: 25, key: 'swerve', label: 'Swerve',
    description: 'The loss of control is temporary. Vehicle drops its speed by 1 step for 5 seconds.',
    speedStepPenalty: 1, standstill: false, speedPenaltyDuration: '5 seconds',
    structureFormula: null, writeOff: false, occupantDamage: null,
    explodes: false, catastrophicCrash: false
  },
  {
    min: 26, max: 40, key: 'skid', label: 'Skid',
    description: 'Driver must fight to keep the vehicle under control. Vehicle drops its speed by 2 steps for 10 seconds.',
    speedStepPenalty: 2, standstill: false, speedPenaltyDuration: '10 seconds',
    structureFormula: null, writeOff: false, occupantDamage: null,
    explodes: false, catastrophicCrash: false
  },
  {
    min: 41, max: 50, key: 'severeSkid', label: 'Severe Skid',
    description: 'Vehicle ends up facing in the wrong direction and at a standstill for 15 seconds.',
    speedStepPenalty: null, standstill: true, speedPenaltyDuration: '15 seconds',
    structureFormula: null, writeOff: false, occupantDamage: null,
    explodes: false, catastrophicCrash: false
  },
  {
    min: 51, max: 60, key: 'roll', label: 'Roll',
    description: 'Vehicle skids and rolls, sustaining 3d10 damage to its Structure. Occupants must succeed at Endurance or sustain 1d10 damage to 1d3 Hit Locations.',
    speedStepPenalty: null, standstill: false, speedPenaltyDuration: null,
    structureFormula: '3d10', writeOff: false,
    occupantDamage: { onFailFormula: '1d10', onSuccessFormula: null, locations: '1d3', instantDeathOnFail: false },
    explodes: false, catastrophicCrash: false
  },
  {
    min: 61, max: 70, key: 'severeRoll', label: 'Severe Roll',
    description: 'As Roll, but the vehicle sustains 3d10+10 damage and occupants take 1d10 damage even on a successful Endurance roll, or 2d10 on a failure.',
    speedStepPenalty: null, standstill: false, speedPenaltyDuration: null,
    structureFormula: '3d10+10', writeOff: false,
    occupantDamage: { onFailFormula: '2d10', onSuccessFormula: '1d10', locations: 1, instantDeathOnFail: false },
    explodes: false, catastrophicCrash: false
  },
  {
    min: 71, max: 80, key: 'writeOff', label: 'Write-Off',
    description: 'As Severe Roll, but the vehicle is reduced to 0 Structure.',
    speedStepPenalty: null, standstill: false, speedPenaltyDuration: null,
    structureFormula: null, writeOff: true,
    occupantDamage: { onFailFormula: '2d10', onSuccessFormula: '1d10', locations: 1, instantDeathOnFail: false },
    explodes: false, catastrophicCrash: false
  },
  {
    min: 81, max: 90, key: 'explosion', label: 'Explosion',
    description: "As Write-Off, but the vehicle's fuel system ignites and explodes within 1d20+10 seconds. Occupants unable to get clear suffer a further 1d6 burn damage to 1d6 locations.",
    speedStepPenalty: null, standstill: false, speedPenaltyDuration: null,
    structureFormula: null, writeOff: true,
    occupantDamage: { onFailFormula: '2d10', onSuccessFormula: '1d10', locations: 1, instantDeathOnFail: false },
    explodes: true, explosionDelayFormula: '1d20+10', burnFormula: '1d6', burnLocations: '1d6', burnAutomatic: false,
    catastrophicCrash: false
  },
  {
    min: 91, max: 98, key: 'immediateExplosion', label: 'Immediate Explosion',
    description: 'As Explosion, but the explosion is immediate — occupants have no chance to get clear.',
    speedStepPenalty: null, standstill: false, speedPenaltyDuration: null,
    structureFormula: null, writeOff: true,
    occupantDamage: { onFailFormula: '2d10', onSuccessFormula: '1d10', locations: 1, instantDeathOnFail: false },
    explodes: true, explosionDelayFormula: null, burnFormula: '1d6', burnLocations: '1d6', burnAutomatic: true,
    catastrophicCrash: false
  },
  {
    min: 99, max: 100, key: 'catastrophicCrash', label: 'Catastrophic Crash',
    description: 'Occupants must succeed at an Endurance roll or be killed instantly. Damage as for Write-Off is sustained regardless.',
    speedStepPenalty: null, standstill: false, speedPenaltyDuration: null,
    structureFormula: null, writeOff: true,
    occupantDamage: { onFailFormula: '2d10', onSuccessFormula: '1d10', locations: 1, instantDeathOnFail: true },
    explodes: false, catastrophicCrash: true
  }
];

/**
 * Look up the Loss of Control table entry for a 1d100 result.
 * Clamped to [1,100] — a raw 100 represents the table's "00" row.
 *
 * @param {number} d100
 * @returns {object}  One row of LOSS_OF_CONTROL_TABLE.
 */
export function resolveLossOfControl(d100) {
  const roll = Math.min(100, Math.max(1, Math.round(d100)));
  return LOSS_OF_CONTROL_TABLE.find(e => roll >= e.min && roll <= e.max)
    ?? LOSS_OF_CONTROL_TABLE[LOSS_OF_CONTROL_TABLE.length - 1];
}

// The rulebook's own 9 Speed steps (p.54). VehicleData's schema additionally
// allows a 10th 'supersonic' value not in this list — Chris's call
// (2026-08-04 Vehicles audit finding F6) was to keep it as a deliberate
// homebrew extension for sci-fi settings, so shiftSpeedStep/getMaxSpeedForSize
// leave it untouched rather than guessing where it'd sit; it always reads as
// "over cap" against every Size, which is the correct behaviour for a step
// beyond anything the rulebook's own table defines.
export const SPEED_STEPS = [
  'ponderous', 'sluggish', 'slow', 'mediocre', 'gentle',
  'moderate', 'rapid', 'fast', 'fleet'
];

/**
 * Shift a Speed rating by N steps (positive = faster, negative = slower),
 * clamped to the table's ends. Unrecognised speed ids (e.g. a homebrew
 * value outside the rulebook's 9 steps) are returned unchanged.
 *
 * @param {string} speedId
 * @param {number} steps
 * @returns {string}
 */
export function shiftSpeedStep(speedId, steps) {
  const idx = SPEED_STEPS.indexOf(speedId);
  if (idx === -1) return speedId;
  const next = Math.min(SPEED_STEPS.length - 1, Math.max(0, idx + steps));
  return SPEED_STEPS[next];
}

// Max normal Speed by Size (rules p.55, Vehicle Speed Table). Cross-checked
// against two independent extractions (-layout and raw reading order) after
// the PDF's 2-column layout interleaved this table with the neighbouring
// Trait Allocation table on the first pass. The rulebook's table only labels
// Small through Enormous; Colossal has no printed entry, so it's treated as
// no more permissive than Enormous (same cap, Ponderous) rather than left
// unbounded — a conservative inference, not a printed rule.
export const MAX_SPEED_FOR_SIZE = {
  small: 'fast', medium: 'rapid', large: 'gentle',
  huge: 'slow', enormous: 'ponderous', colossal: 'ponderous'
};

/**
 * The highest normal Speed rating a vehicle of this Size can hold, before
 * accounting for traits that explicitly raise it (Enhanced Performance: +1
 * step; Rails: +3 steps, rail-bound only). Unrecognised sizes fall back to
 * 'fleet' (no cap) rather than silently under- or over-restricting.
 *
 * @param {string} size
 * @param {{enhancedPerformance?: boolean, rails?: boolean}} [traits]
 * @returns {string}
 */
export function getMaxSpeedForSize(size, traits = {}) {
  let max = MAX_SPEED_FOR_SIZE[size] ?? 'fleet';
  if (traits.rails) max = shiftSpeedStep(max, 3);
  else if (traits.enhancedPerformance) max = shiftSpeedStep(max, 1);
  return max;
}

/**
 * Compute a vehicle's effective (current) Speed from its nominal/base rating
 * plus live modifiers — rules p.56: "a Land Ironclad with a Speed of Slow
 * would be reduced to Ponderous" after 2 hits to Drive on an Enormous
 * vehicle. Each hit to Drive costs exactly 1 Speed step regardless of Size —
 * a hit is already defined (System Hits table, p.53) as 1/(max hits for that
 * Size) of the system's total capacity, so 1 hit = 1 step is consistent
 * across all six sizes, not just the Enormous example given.
 *
 * Engine/Fuel damage "halves Max Speed" (p.59) — applied here as halving the
 * step *index* (the only numeric handle Speed has, since it's a named
 * ordinal scale with no other cardinal value anywhere in this system).
 *
 * Does NOT mutate `system.speed` — that field stays the vehicle's nominal
 * rating; this returns the live effective value for display, the same
 * base-vs-effective split this codebase already uses for Armour
 * (getArmourAt vs the engine's internal effective-armour resolution).
 *
 * @param {object} params
 * @param {string}  params.baseSpeed
 * @param {number}  [params.driveHitsTaken]
 * @param {boolean} [params.engineFuelDamaged]
 * @param {boolean} [params.enhancedPerformance]
 * @param {boolean} [params.rails]
 * @returns {string}
 */
export function computeEffectiveSpeed({
  baseSpeed, driveHitsTaken = 0, engineFuelDamaged = false,
  enhancedPerformance = false, rails = false
}) {
  let idx = SPEED_STEPS.indexOf(baseSpeed);
  if (idx === -1) return baseSpeed; // unrecognised (e.g. 'supersonic') — no step math to apply

  if (rails) idx += 3;
  else if (enhancedPerformance) idx += 1;

  idx = Math.max(0, idx - driveHitsTaken);
  if (engineFuelDamaged) idx = Math.floor(idx / 2);

  idx = Math.min(SPEED_STEPS.length - 1, Math.max(0, idx));
  return SPEED_STEPS[idx];
}

