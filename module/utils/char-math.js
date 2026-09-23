/**
 * mythras-imperative/module/utils/char-math.js
 *
 * Pure character derivation functions extracted from CharacterData.
 * Zero Foundry dependencies — safe to import in Node/Jest without mocks.
 */

// ---------------------------------------------------------------------------
// Damage Modifier
// ---------------------------------------------------------------------------

export const DM_TABLE = [
  '-1d8', '-1d6', '-1d4', '-1d2', '+0',
  '+1d2', '+1d4', '+1d6', '+1d8', '+1d10',
  '+1d12', '+2d6', '+2d8', '+2d10', '+2d12'
];

/**
 * Map a STR+SIZ sum to its base index in DM_TABLE.
 * @param {number} strSiz
 * @returns {number}
 */
export function dmBaseIndex(strSiz) {
  if (strSiz <= 5)  return 0;
  if (strSiz <= 10) return 1;
  if (strSiz <= 15) return 2;
  if (strSiz <= 20) return 3;
  if (strSiz <= 25) return 4;
  if (strSiz <= 30) return 5;
  if (strSiz <= 35) return 6;
  if (strSiz <= 40) return 7;
  if (strSiz <= 45) return 8;
  if (strSiz <= 50) return 9;
  if (strSiz <= 60) return 10;
  if (strSiz <= 70) return 11;
  if (strSiz <= 80) return 12;
  if (strSiz <= 90) return 13;
  return 14;
}

/**
 * Derive the base damage modifier string from STR+SIZ.
 * @param {number} strSiz
 * @returns {string}
 */
export function calcDamageModifier(strSiz) {
  return DM_TABLE[dmBaseIndex(strSiz)];
}

/**
 * Derive the damage modifier with an offset step applied.
 * @param {number} strSiz
 * @param {number} [offset=0]  Number of table steps to shift (positive = stronger)
 * @returns {string}
 */
export function calcDamageModifierWithOffset(strSiz, offset = 0) {
  const base = dmBaseIndex(strSiz);
  const idx  = Math.max(0, Math.min(DM_TABLE.length - 1, base + offset));
  return DM_TABLE[idx];
}

// ---------------------------------------------------------------------------
// Experience Modifier  (rules p.8)
// ---------------------------------------------------------------------------

/**
 * @param {number} cha
 * @returns {-1|0|1}
 */
export function calcExperienceModifier(cha) {
  if (cha <= 4)  return -1;
  if (cha <= 12) return 0;
  return 1;
}

// ---------------------------------------------------------------------------
// Healing Rate  (rules p.8)
// ---------------------------------------------------------------------------

/**
 * @param {number} con
 * @returns {1|2|3|4}
 */
export function calcHealingRate(con) {
  if (con <= 6)  return 1;
  if (con <= 12) return 2;
  if (con <= 18) return 3;
  return 4;
}

// ---------------------------------------------------------------------------
// Luck Points  (rules p.8)
// ---------------------------------------------------------------------------

/**
 * @param {number} pow
 * @returns {1|2|3|4}
 */
export function calcLuckPoints(pow) {
  if (pow <= 6)  return 1;
  if (pow <= 12) return 2;
  if (pow <= 18) return 3;
  return 4;
}

// ---------------------------------------------------------------------------
// Action Points  (rules p.8)
// ---------------------------------------------------------------------------

/**
 * Derive action point maximum from INT+DEX.
 * @param {number} intVal
 * @param {number} dex
 * @returns {number}
 */
export function calcActionPoints(intVal, dex) {
  const sum = intVal + dex;
  if (sum <= 12) return 1;
  return 1 + Math.floor((sum - 1) / 12);
}

// ---------------------------------------------------------------------------
// Initiative Bonus  (rules p.8)
// ---------------------------------------------------------------------------

/**
 * @param {number} dex
 * @param {number} intVal
 * @returns {number}
 */
export function calcInitiativeBonus(dex, intVal) {
  // The average of DEX and INT, ROUNDED UP — Mythras always rounds up. Destined's
  // own worked example says so outright ("Taking the average of his DEX and INT
  // and rounding up, his Initiative Bonus is 15"). Until v1.4.348 this and three
  // inline copies (character, NPC, creature) rounded down, so every odd DEX+INT
  // was one point short.
  return Math.ceil(((Number(dex) || 0) + (Number(intVal) || 0)) / 2);
}

// ---------------------------------------------------------------------------
// Hit Location HP  (Imperative p.8, "Hit Points per Location Table")
// ---------------------------------------------------------------------------

/**
 * Derive base HP values for each hit location from CON+SIZ.
 *
 * THE hit-point table — `syncHitLocationHP` (the writer) and
 * `CharacterData#_calcHitLocationHP` (the derived copy) both call this. Until
 * v1.4.347 each of the three carried its own copy of a table that was wrong in
 * the same way: the Chest was one point short in every band (so it always
 * equalled the Abdomen), the Arms were one point high at CON+SIZ 6-15, and
 * nothing grew past 45.
 *
 * The book, in 5-point bands of CON+SIZ (band n covers 5n-4 to 5n):
 *
 *            1-5  6-10  11-15  16-20  21-25  26-30  31-35  36-40  +5
 *   Head      1    2     3      4      5      6      7      8     +1
 *   Chest     3    4     5      6      7      8      9     10     +1
 *   Abdomen   2    3     4      5      6      7      8      9     +1
 *   Each Arm  1    1     2      3      4      5      6      7     +1
 *   Each Leg  1    2     3      4      5      6      7      8     +1
 *
 * i.e. Head = Leg = n, Chest = n+2, Abdomen = n+1, Arm = n-1 (never below 1),
 * with "+1 per further 5 points" meaning the bands simply keep counting. Mythras
 * Core and Destined (p.19) print the same table — Destined's has a misprint,
 * Chest 9 in the 16-20 column, where its own sequence and both other books give 6.
 * Destined's worked example (Shadowstalker, CON+SIZ 26, Epic +1) gives Legs 7,
 * Abdomen 8, Chest 9, Arms 6, Head 7, which this reproduces.
 *
 * Destined's Durability and Enhanced Body re-look the table up with a larger
 * sum (STR+CON+SIZ, CON+SIZ+½POW) and add the difference through
 * `hitPointBonusHooks` as `ceil(new/5) - ceil(old/5)` — exact, because every
 * row rises by one per band from 11 upward, and a hero's CON+SIZ is at least 11.
 *
 * @param {number} con
 * @param {number} siz
 * @param {number} [hpBonus=0]  Hero level bonus HP per location
 * @returns {{ head: number, chest: number, abdomen: number, arm: number, leg: number }}
 */
export function calcHitLocationHP(con, siz, hpBonus = 0) {
  const n = Math.max(1, Math.ceil(((Number(con) || 0) + (Number(siz) || 0)) / 5));
  const head    = n;
  const chest   = n + 2;
  const abdomen = n + 1;
  const arm     = Math.max(1, n - 1);
  const leg     = n;

  return {
    head:    head    + hpBonus,
    chest:   chest   + hpBonus,
    abdomen: abdomen + hpBonus,
    arm:     arm     + hpBonus,
    leg:     leg     + hpBonus
  };
}

/**
 * The WRONG table this system shipped until v1.4.347, frozen.
 *
 * Kept only so the one-time migration can recognise a maximum the old writer
 * produced — see `migratedLocationMax`. Never compute hit points with it.
 *
 * @param {number} con
 * @param {number} siz
 * @param {number} [hpBonus=0]
 * @returns {{ head: number, chest: number, abdomen: number, arm: number, leg: number }}
 */
export function legacyHitLocationHP(con, siz, hpBonus = 0) {
  const conSiz = (Number(con) || 0) + (Number(siz) || 0);
  let head, chest, abdomen, arm, leg;

  if      (conSiz <= 5)  { head=1; chest=2;  abdomen=2;  arm=1; leg=1; }
  else if (conSiz <= 10) { head=2; chest=3;  abdomen=3;  arm=2; leg=2; }
  else if (conSiz <= 15) { head=3; chest=4;  abdomen=4;  arm=3; leg=3; }
  else if (conSiz <= 20) { head=4; chest=5;  abdomen=5;  arm=3; leg=4; }
  else if (conSiz <= 25) { head=5; chest=6;  abdomen=6;  arm=4; leg=5; }
  else if (conSiz <= 30) { head=6; chest=7;  abdomen=7;  arm=5; leg=6; }
  else if (conSiz <= 35) { head=7; chest=8;  abdomen=8;  arm=6; leg=7; }
  else if (conSiz <= 40) { head=8; chest=9;  abdomen=9;  arm=7; leg=8; }
  else                   { head=9; chest=10; abdomen=10; arm=8; leg=9; }

  return {
    head: head + hpBonus, chest: chest + hpBonus, abdomen: abdomen + hpBonus,
    arm: arm + hpBonus, leg: leg + hpBonus,
  };
}

/**
 * Decide whether one hit location's stored maximum should move to the
 * corrected table (v1.4.347 migration).
 *
 * Only a maximum that still reads EXACTLY what the old table (plus the same
 * bonuses) produced is moved. Anything else was set some other way — a GM
 * typing a book stat block onto an NPC, a boss given extra HP by hand — and is
 * left alone. The current value follows `poolAfterMaxChange`: an unhurt
 * location stays full, a wounded one keeps its wound.
 *
 * @param {object} p
 * @param {number} p.storedMax      the location's `system.hp` as stored
 * @param {number} p.storedCurrent  the location's `system.current` as stored
 * @param {number} p.oldMax         what the old table + bonuses gives
 * @param {number} p.newMax         what the corrected table + bonuses gives
 * @returns {{hp: number, current?: number}|null}  the update, or null to leave it
 */
export function migratedLocationMax({ storedMax, storedCurrent, oldMax, newMax } = {}) {
  if (![storedMax, oldMax, newMax].every(Number.isFinite)) return null;
  if (storedMax !== oldMax || oldMax === newMax) return null;
  const update = { hp: newMax };
  const current = poolAfterMaxChange({ storedValue: storedCurrent ?? 0, oldMax, newMax });
  if (current !== null) update.current = current;
  return update;
}

// ---------------------------------------------------------------------------
// Pools that track a moving maximum
//
// Action Points, Luck, Magic and Power Points all store a spendable `value`
// while their `max` is DERIVED — from characteristics, hero advantages and
// module hooks. Hit-location `current` works the same way against a derived
// `hp`. So whenever a characteristic moves, every one of those maxima moves
// with it while the stored values sit still.
//
// That is invisible in play and brutal at character creation: an actor is
// created with the schema-default 10s, the pools seed against THOSE maxima,
// and the moment real characteristics are typed in, every pool is stale. The
// sheet then shows 2/3 Action Points and 10/20 Power Points on a hero who has
// never spent anything — and it stays that way until somebody notices.
// ---------------------------------------------------------------------------

/**
 * Decide a pool's stored value after its maximum has moved.
 *
 * The rule is deliberately narrow: **a pool that was full stays full.**
 * Anything partially spent is left exactly where it is, so this can never
 * refill a hero mid-fight — which is why it is safe to run on every update
 * rather than only at creation.
 *
 * @param {object} opts
 * @param {number} opts.storedValue - the pool's persisted `value`
 * @param {number} opts.oldMax      - its maximum BEFORE the update
 * @param {number} opts.newMax      - its maximum AFTER the update
 * @returns {number|null} the value to write, or null to leave it alone
 */
export function poolAfterMaxChange({ storedValue, oldMax, newMax } = {}) {
  if (![storedValue, oldMax, newMax].every(n => Number.isFinite(n))) return null;

  // Was at (or somehow above) its old ceiling — follow the ceiling.
  if (storedValue >= oldMax) return storedValue === newMax ? null : newMax;

  // Partially spent. Only intervene if the new ceiling is now BELOW it, which
  // would otherwise leave an impossible value on the sheet.
  if (storedValue > newMax) return newMax;

  return null;
}

// ---------------------------------------------------------------------------
// Hero advantages that make a skill easier (Larger-Than-Life Heroics)
// ---------------------------------------------------------------------------

/**
 * The grade shift a hero advantage gives a roll of `skillName`: −1 (one grade
 * easier) or 0. Imperative's Larger-Than-Life Heroics: "Endurance rolls are
 * one Grade easier", and the same for Stealth and Willpower.
 *
 * One definition (v1.4.352). It used to live inline on the character sheet and
 * only moved the roll dialog's STARTING difficulty, so a Hard Endurance roll
 * stayed Hard — and a requested check (the Endurance and Willpower resists
 * powers ask for, where it matters most) never applied it at all. It is now a
 * shift on the final grade, composed exactly like a module's
 * (composeRollGrade): a Hard Endurance roll is Standard.
 *
 * @param {string[]} advantages  actor.system.heroAdvantages
 * @param {string} skillName
 * @returns {number} −1 or 0
 */
export function heroAdvantageShift(advantages, skillName) {
  const has = new Set(advantages ?? []);
  const name = String(skillName ?? '').trim().toLowerCase();
  if (has.has('enduranceEasier') && name === 'endurance') return -1;
  if (has.has('stealthEasier')   && name === 'stealth')   return -1;
  if (has.has('willpowerEasier') && name === 'willpower') return -1;
  return 0;
}
