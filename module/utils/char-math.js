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
  return Math.floor((dex + intVal) / 2);
}

// ---------------------------------------------------------------------------
// Hit Location HP  (rules p.32)
// ---------------------------------------------------------------------------

/**
 * Derive base HP values for each hit location from CON+SIZ.
 *
 * @param {number} con
 * @param {number} siz
 * @param {number} [hpBonus=0]  Hero level bonus HP per location
 * @returns {{ head: number, chest: number, abdomen: number, arm: number, leg: number }}
 */
export function calcHitLocationHP(con, siz, hpBonus = 0) {
  const conSiz = con + siz;
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
    head:    head    + hpBonus,
    chest:   chest   + hpBonus,
    abdomen: abdomen + hpBonus,
    arm:     arm     + hpBonus,
    leg:     leg     + hpBonus
  };
}
