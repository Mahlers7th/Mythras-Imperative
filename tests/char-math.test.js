/**
 * tests/char-math.test.js
 *
 * Jest tests for module/utils/char-math.js
 */

import {
  calcDamageModifier,
  calcDamageModifierWithOffset,
  calcExperienceModifier,
  calcHealingRate,
  calcLuckPoints,
  calcActionPoints,
  calcInitiativeBonus,
  calcHitLocationHP,
  dmBaseIndex,
  DM_TABLE
} from '../module/utils/char-math.js';

// =============================================================================
// calcDamageModifier
// =============================================================================

describe('calcDamageModifier', () => {
  const cases = [
    [3,   '-1d8'],
    [5,   '-1d8'],
    [6,   '-1d6'],
    [10,  '-1d6'],
    [11,  '-1d4'],
    [15,  '-1d4'],
    [16,  '-1d2'],
    [20,  '-1d2'],
    [21,   '+0' ],
    [25,   '+0' ],
    [26,  '+1d2'],
    [30,  '+1d2'],
    [31,  '+1d4'],
    [35,  '+1d4'],
    [36,  '+1d6'],
    [40,  '+1d6'],
    [41,  '+1d8'],
    [45,  '+1d8'],
    [46, '+1d10'],
    [50, '+1d10'],
    [51, '+1d12'],
    [60, '+1d12'],
    [61,  '+2d6'],
    [70,  '+2d6'],
    [71,  '+2d8'],
    [80,  '+2d8'],
    [81, '+2d10'],
    [90, '+2d10'],
    [91, '+2d12'],
    [99, '+2d12'],
  ];
  test.each(cases)('STR+SIZ %d → %s', (sum, expected) => {
    expect(calcDamageModifier(sum)).toBe(expected);
  });

  test('average human STR10 SIZ13 → +0', () => {
    expect(calcDamageModifier(10 + 13)).toBe('+0');
  });
});

// =============================================================================
// calcDamageModifierWithOffset
// =============================================================================

describe('calcDamageModifierWithOffset', () => {
  test('zero offset returns base', () => {
    expect(calcDamageModifierWithOffset(25, 0)).toBe('+0');
  });
  test('+1 offset steps up one', () => {
    expect(calcDamageModifierWithOffset(25, 1)).toBe('+1d2');
  });
  test('-1 offset steps down one', () => {
    expect(calcDamageModifierWithOffset(25, -1)).toBe('-1d2');
  });
  test('clamps at max (+2d12)', () => {
    expect(calcDamageModifierWithOffset(91, 10)).toBe('+2d12');
  });
  test('clamps at min (-1d8)', () => {
    expect(calcDamageModifierWithOffset(3, -10)).toBe('-1d8');
  });
  test('+2 steps from STR+SIZ 50 (+1d10 → +2d6)', () => {
    expect(calcDamageModifierWithOffset(50, 2)).toBe('+2d6');
  });
});

// =============================================================================
// calcExperienceModifier
// =============================================================================

describe('calcExperienceModifier', () => {
  test('CHA 1 → -1', () => expect(calcExperienceModifier(1)).toBe(-1));
  test('CHA 4 → -1', () => expect(calcExperienceModifier(4)).toBe(-1));
  test('CHA 5 → 0',  () => expect(calcExperienceModifier(5)).toBe(0));
  test('CHA 12 → 0', () => expect(calcExperienceModifier(12)).toBe(0));
  test('CHA 13 → 1', () => expect(calcExperienceModifier(13)).toBe(1));
  test('CHA 20 → 1', () => expect(calcExperienceModifier(20)).toBe(1));
});

// =============================================================================
// calcHealingRate
// =============================================================================

describe('calcHealingRate', () => {
  test('CON 1 → 1',  () => expect(calcHealingRate(1)).toBe(1));
  test('CON 6 → 1',  () => expect(calcHealingRate(6)).toBe(1));
  test('CON 7 → 2',  () => expect(calcHealingRate(7)).toBe(2));
  test('CON 12 → 2', () => expect(calcHealingRate(12)).toBe(2));
  test('CON 13 → 3', () => expect(calcHealingRate(13)).toBe(3));
  test('CON 18 → 3', () => expect(calcHealingRate(18)).toBe(3));
  test('CON 19 → 4', () => expect(calcHealingRate(19)).toBe(4));
  test('CON 25 → 4', () => expect(calcHealingRate(25)).toBe(4));
});

// =============================================================================
// calcLuckPoints
// =============================================================================

describe('calcLuckPoints', () => {
  test('POW 1 → 1',  () => expect(calcLuckPoints(1)).toBe(1));
  test('POW 6 → 1',  () => expect(calcLuckPoints(6)).toBe(1));
  test('POW 7 → 2',  () => expect(calcLuckPoints(7)).toBe(2));
  test('POW 12 → 2', () => expect(calcLuckPoints(12)).toBe(2));
  test('POW 13 → 3', () => expect(calcLuckPoints(13)).toBe(3));
  test('POW 18 → 3', () => expect(calcLuckPoints(18)).toBe(3));
  test('POW 19 → 4', () => expect(calcLuckPoints(19)).toBe(4));
});

// =============================================================================
// calcActionPoints
// =============================================================================

describe('calcActionPoints', () => {
  test('INT+DEX ≤ 12 → 1 AP', () => {
    expect(calcActionPoints(6, 6)).toBe(1);
    expect(calcActionPoints(7, 5)).toBe(1);
  });
  test('INT+DEX 13 → 2 AP', () => {
    expect(calcActionPoints(7, 6)).toBe(2);
  });
  test('INT+DEX 24 → 2 AP', () => {
    expect(calcActionPoints(12, 12)).toBe(2);
  });
  test('INT+DEX 25 → 3 AP', () => {
    expect(calcActionPoints(13, 12)).toBe(3);
  });
  test('average human INT11 DEX11 = 22 → 2 AP', () => {
    expect(calcActionPoints(11, 11)).toBe(2);
  });
  test('high DEX+INT 30+30 = 60 → 5 AP', () => {
    expect(calcActionPoints(30, 30)).toBe(5);
  });
});

// =============================================================================
// calcInitiativeBonus
// =============================================================================

describe('calcInitiativeBonus', () => {
  test('DEX10 INT10 → +10', () => {
    expect(calcInitiativeBonus(10, 10)).toBe(10);
  });
  test('DEX13 INT11 → +12', () => {
    expect(calcInitiativeBonus(13, 11)).toBe(12);
  });
  test('odd total floors correctly: DEX11 INT10 → +10', () => {
    expect(calcInitiativeBonus(11, 10)).toBe(10);
  });
});

// =============================================================================
// calcHitLocationHP
// =============================================================================

describe('calcHitLocationHP', () => {
  test('CON+SIZ=10 → head2 chest3 abdomen3 arm2 leg2', () => {
    const hp = calcHitLocationHP(5, 5);
    expect(hp).toEqual({ head: 2, chest: 3, abdomen: 3, arm: 2, leg: 2 });
  });

  test('CON+SIZ=20 (average human CON10 SIZ10) → head4 chest5 abdomen5 arm3 leg4', () => {
    const hp = calcHitLocationHP(10, 10);
    expect(hp).toEqual({ head: 4, chest: 5, abdomen: 5, arm: 3, leg: 4 });
  });

  test('CON+SIZ=25 → head5 chest6 abdomen6 arm4 leg5', () => {
    const hp = calcHitLocationHP(13, 12);
    expect(hp).toEqual({ head: 5, chest: 6, abdomen: 6, arm: 4, leg: 5 });
  });

  test('CON+SIZ > 40 → head9 chest10 abdomen10 arm8 leg9', () => {
    const hp = calcHitLocationHP(25, 20);
    expect(hp).toEqual({ head: 9, chest: 10, abdomen: 10, arm: 8, leg: 9 });
  });

  test('hero advantage +1 HP adds to every location', () => {
    const base = calcHitLocationHP(10, 10, 0);
    const hero = calcHitLocationHP(10, 10, 1);
    expect(hero.head).toBe(base.head + 1);
    expect(hero.chest).toBe(base.chest + 1);
    expect(hero.abdomen).toBe(base.abdomen + 1);
    expect(hero.arm).toBe(base.arm + 1);
    expect(hero.leg).toBe(base.leg + 1);
  });

  test('paragon advantage +2 HP adds to every location', () => {
    const base = calcHitLocationHP(10, 10, 0);
    const para = calcHitLocationHP(10, 10, 2);
    expect(para.chest).toBe(base.chest + 2);
  });

  test('boundary: CON+SIZ exactly 5 → head1', () => {
    const hp = calcHitLocationHP(3, 2);
    expect(hp.head).toBe(1);
  });

  test('boundary: CON+SIZ exactly 40 → head8', () => {
    const hp = calcHitLocationHP(20, 20);
    expect(hp.head).toBe(8);
  });
});

// =============================================================================
// DM_TABLE integrity
// =============================================================================

describe('DM_TABLE', () => {
  test('has exactly 15 entries', () => {
    expect(DM_TABLE).toHaveLength(15);
  });
  test('index 4 is +0 (the neutral point)', () => {
    expect(DM_TABLE[4]).toBe('+0');
  });
  test('first entry is -1d8 (minimum)', () => {
    expect(DM_TABLE[0]).toBe('-1d8');
  });
  test('last entry is +2d12 (maximum)', () => {
    expect(DM_TABLE[14]).toBe('+2d12');
  });
});
