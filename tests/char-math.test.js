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
  legacyHitLocationHP,
  migratedLocationMax,
  dmBaseIndex,
  poolAfterMaxChange,
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
// damageModOffsetHooks contract — Enhanced Strength / Enhanced Body
//   The system reads attr.dmOffset, then sums each damageModOffsetHook's
//   signed step return on top of it, then clamps. Enhanced Strength's delta
//   is computed as the step difference between the power's STR+CON+SIZ damage
//   total and the normal STR+SIZ. These tests pin that math and its
//   composition with a manual GM offset. STR is never changed.
// =============================================================================

describe('Enhanced Strength damage-step offset', () => {
  // The exact delta the Destined hook returns: step(power total) - step(STR+SIZ).
  const esDelta = (str, con, siz) =>
    dmBaseIndex(str + con + siz) - dmBaseIndex(str + siz);

  test('Enhanced Strength shifts DM by the STR+CON+SIZ step delta', () => {
    // STR 13, SIZ 12 → STR+SIZ 25 (+0, index 4).
    // CON 14 → STR+CON+SIZ 39 (+1d6, index 7). Delta = +3 steps.
    const str = 13, con = 14, siz = 12;
    expect(esDelta(str, con, siz)).toBe(3);
    expect(calcDamageModifierWithOffset(str + siz, esDelta(str, con, siz)))
      .toBe('+1d6');
  });

  test('power offset composes additively with a manual GM offset', () => {
    // Same character, GM has also set a manual +1 dmOffset.
    const str = 13, con = 14, siz = 12;
    const manual = 1;
    const total = manual + esDelta(str, con, siz); // 1 + 3 = 4
    expect(calcDamageModifierWithOffset(str + siz, total)).toBe('+1d8');
  });

  test('zero delta when CON adds no step (boundary)', () => {
    // STR+SIZ 25 (index 4); +CON 0 keeps total in the same band only if
    // CON keeps the sum <= 25. STR 13, SIZ 12, CON 0 → no shift.
    expect(esDelta(13, 0, 12)).toBe(0);
    expect(calcDamageModifierWithOffset(25, 0)).toBe('+0');
  });

  test('result clamps at the top of the table', () => {
    // Very high totals cannot exceed +2d12.
    const str = 40, con = 40, siz = 40; // STR+SIZ 80, +CON 40 → far past top
    expect(calcDamageModifierWithOffset(str + siz, esDelta(str, con, siz)))
      .toBe('+2d12');
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
  // Mythras always rounds up (Imperative p.3). Until v1.4.348 this test
  // asserted the opposite — 'odd total floors correctly' — and so did the code.
  test('an odd total rounds UP: DEX11 INT10 → +11', () => {
    expect(calcInitiativeBonus(11, 10)).toBe(11);
  });
  test('every odd DEX+INT rounds up, every even one is exact', () => {
    for (let dex = 3; dex <= 21; dex++) for (let int = 3; int <= 21; int++) {
      const sum = dex + int;
      expect({ dex, int, bonus: calcInitiativeBonus(dex, int) }).toEqual({ dex, int, bonus: sum % 2 ? (sum + 1) / 2 : sum / 2 });
    }
  });
});

// =============================================================================
// calcHitLocationHP — Imperative p.8, Hit Points per Location Table
// =============================================================================

describe('calcHitLocationHP', () => {
  // The book's table, transcribed column by column: [head, chest, abdomen, arm, leg].
  // v1.4.347: the previous tests asserted the system's own wrong table (Chest
  // equal to Abdomen in every band, Arms one high at 6-15), which is how it
  // survived — they checked the code against itself, not against the book.
  const BOOK = {
    '1-5':   [1, 3, 2, 1, 1],
    '6-10':  [2, 4, 3, 1, 2],
    '11-15': [3, 5, 4, 2, 3],
    '16-20': [4, 6, 5, 3, 4],
    '21-25': [5, 7, 6, 4, 5],
    '26-30': [6, 8, 7, 5, 6],
    '31-35': [7, 9, 8, 6, 7],
    '36-40': [8, 10, 9, 7, 8],
  };
  const asRow = (hp) => [hp.head, hp.chest, hp.abdomen, hp.arm, hp.leg];

  test('every CON+SIZ from 1 to 40 matches the book, at both ends of each band', () => {
    for (const [range, row] of Object.entries(BOOK)) {
      const [lo, hi] = range.split('-').map(Number);
      for (const conSiz of [lo, hi]) {
        expect({ conSiz, hp: asRow(calcHitLocationHP(conSiz, 0)) }).toEqual({ conSiz, hp: row });
      }
    }
  });

  test('the Chest is always one more than the Abdomen — the bug seen at the table', () => {
    for (let conSiz = 1; conSiz <= 60; conSiz++) {
      const hp = calcHitLocationHP(conSiz, 0);
      expect({ conSiz, diff: hp.chest - hp.abdomen }).toEqual({ conSiz, diff: 1 });
    }
  });

  test('"+5: +1" — each further 5 points adds 1 to every location', () => {
    expect(asRow(calcHitLocationHP(41, 0))).toEqual([9, 11, 10, 8, 9]);
    expect(asRow(calcHitLocationHP(45, 0))).toEqual([9, 11, 10, 8, 9]);
    expect(asRow(calcHitLocationHP(46, 0))).toEqual([10, 12, 11, 9, 10]);
    expect(asRow(calcHitLocationHP(50, 0))).toEqual([10, 12, 11, 9, 10]);
    expect(asRow(calcHitLocationHP(51, 0))).toEqual([11, 13, 12, 10, 11]);
  });

  test('Destined p.19 worked example: Shadowstalker, CON 15 SIZ 11, Epic +1', () => {
    // "Hit Points are 7 for his Legs, 8 for his Abdomen, 9 for his Chest,
    //  6 for his Arms, and 7 for his Head."
    expect(calcHitLocationHP(15, 11, 1)).toEqual({ head: 7, chest: 9, abdomen: 8, arm: 6, leg: 7 });
  });

  test('average human CON 10 SIZ 10 → head4 chest6 abdomen5 arm3 leg4', () => {
    expect(calcHitLocationHP(10, 10)).toEqual({ head: 4, chest: 6, abdomen: 5, arm: 3, leg: 4 });
  });

  test('CON and SIZ are summed — the split does not matter', () => {
    expect(calcHitLocationHP(13, 12)).toEqual(calcHitLocationHP(5, 20));
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

  test('a zero or missing characteristic still yields the first band, never 0', () => {
    expect(asRow(calcHitLocationHP(0, 0))).toEqual([1, 3, 2, 1, 1]);
    expect(asRow(calcHitLocationHP(undefined, null))).toEqual([1, 3, 2, 1, 1]);
  });
});

// =============================================================================
// Destined's Durability / Enhanced Body delta, as the module computes it
// =============================================================================

describe('a re-looked-up sum added as a per-location delta', () => {
  // Destined adds `ceil(new/5) - ceil(old/5)` to every location through
  // hitPointBonusHooks. That is only right if it equals looking the table up
  // with the new sum — check it for every hero-possible CON+SIZ (min 3+8 = 11).
  test('delta on top of CON+SIZ equals the table looked up with the larger sum', () => {
    for (let conSiz = 11; conSiz <= 60; conSiz++) {
      for (let extra = 0; extra <= 30; extra++) {
        const delta = Math.ceil((conSiz + extra) / 5) - Math.ceil(conSiz / 5);
        const viaDelta = calcHitLocationHP(conSiz, 0, delta);
        expect({ conSiz, extra, hp: viaDelta }).toEqual({ conSiz, extra, hp: calcHitLocationHP(conSiz + extra, 0) });
      }
    }
  });

  test('Durability (STR+CON+SIZ): STR 12 CON 18 SIZ 13, Paragon +2', () => {
    // 43 → band 9: Head 9, Chest 11, Abdomen 10, Arms 8, Legs 9; +2 Paragon.
    const delta = Math.ceil(43 / 5) - Math.ceil(31 / 5);
    expect(delta).toBe(2);
    expect(calcHitLocationHP(18, 13, delta + 2)).toEqual({ head: 11, chest: 13, abdomen: 12, arm: 10, leg: 11 });
  });
});

// =============================================================================
// v1.4.347 migration
// =============================================================================

describe('legacyHitLocationHP (the pre-v1.4.347 table, frozen for the migration)', () => {
  test('reproduces the old wrong values, so the migration can recognise them', () => {
    expect(legacyHitLocationHP(10, 10)).toEqual({ head: 4, chest: 5, abdomen: 5, arm: 3, leg: 4 });
    expect(legacyHitLocationHP(5, 5)).toEqual({ head: 2, chest: 3, abdomen: 3, arm: 2, leg: 2 });
    expect(legacyHitLocationHP(25, 20)).toEqual({ head: 9, chest: 10, abdomen: 10, arm: 8, leg: 9 });
    expect(legacyHitLocationHP(10, 10, 2).chest).toBe(7);
  });

  test('differs from the book only where the bug was: Chest always, Arms at 6-15, anything past 45', () => {
    for (let conSiz = 1; conSiz <= 45; conSiz++) {
      const oldHp = legacyHitLocationHP(conSiz, 0);
      const newHp = calcHitLocationHP(conSiz, 0);
      expect({ conSiz, head: oldHp.head, abdomen: oldHp.abdomen, leg: oldHp.leg })
        .toEqual({ conSiz, head: newHp.head, abdomen: newHp.abdomen, leg: newHp.leg });
      expect({ conSiz, chest: newHp.chest - oldHp.chest }).toEqual({ conSiz, chest: 1 });
      expect({ conSiz, arm: oldHp.arm - newHp.arm }).toEqual({ conSiz, arm: conSiz >= 6 && conSiz <= 15 ? 1 : 0 });
    }
  });
});

describe('migratedLocationMax', () => {
  test('an unhurt chest the old table wrote moves up and stays full', () => {
    expect(migratedLocationMax({ storedMax: 12, storedCurrent: 12, oldMax: 12, newMax: 13 }))
      .toEqual({ hp: 13, current: 13 });
  });

  test('a wounded chest gets the new maximum and keeps its wound', () => {
    expect(migratedLocationMax({ storedMax: 12, storedCurrent: 5, oldMax: 12, newMax: 13 }))
      .toEqual({ hp: 13 });
  });

  test('an arm the old table set one high comes down, and a full arm stays full', () => {
    expect(migratedLocationMax({ storedMax: 3, storedCurrent: 3, oldMax: 3, newMax: 2 }))
      .toEqual({ hp: 2, current: 2 });
  });

  test('a hand-set maximum (not what the old table gave) is left alone', () => {
    expect(migratedLocationMax({ storedMax: 15, storedCurrent: 15, oldMax: 12, newMax: 13 })).toBeNull();
  });

  test('a location that was already right is left alone', () => {
    expect(migratedLocationMax({ storedMax: 7, storedCurrent: 7, oldMax: 7, newMax: 7 })).toBeNull();
  });

  test('missing numbers — an unrecognised location key — change nothing', () => {
    expect(migratedLocationMax({ storedMax: 7, storedCurrent: 7, oldMax: undefined, newMax: undefined })).toBeNull();
    expect(migratedLocationMax()).toBeNull();
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

// =============================================================================
// poolAfterMaxChange
//
// The rule in one line: a pool that was FULL follows its new maximum; one that
// was partially spent is never refilled. The creation case is the first test —
// an actor made with the schema-default 10s, then given real characteristics.
// =============================================================================

describe('poolAfterMaxChange', () => {
  test('a full pool follows its maximum upward — the character-creation case', () => {
    // Power Points seeded at 10/10 on a default actor, POW then set to 18 at
    // Paragon (POW+2 = 20). Before the fix this stayed 10/20 forever.
    expect(poolAfterMaxChange({ storedValue: 10, oldMax: 10, newMax: 20 })).toBe(20);
  });

  test('a full pool follows its maximum downward', () => {
    expect(poolAfterMaxChange({ storedValue: 3, oldMax: 3, newMax: 2 })).toBe(2);
  });

  test('a partially spent pool is left alone when the max rises', () => {
    // Mid-combat: 1 of 3 Action Points left, a power raises the max to 4.
    // Refilling here would hand back spent points.
    expect(poolAfterMaxChange({ storedValue: 1, oldMax: 3, newMax: 4 })).toBeNull();
  });

  test('a partially spent pool is left alone when the max falls but stays above it', () => {
    expect(poolAfterMaxChange({ storedValue: 1, oldMax: 4, newMax: 3 })).toBeNull();
  });

  test('a partially spent pool is clamped when the max falls below it', () => {
    expect(poolAfterMaxChange({ storedValue: 3, oldMax: 5, newMax: 2 })).toBe(2);
  });

  test('an unchanged maximum writes nothing', () => {
    expect(poolAfterMaxChange({ storedValue: 3, oldMax: 3, newMax: 3 })).toBeNull();
    expect(poolAfterMaxChange({ storedValue: 1, oldMax: 3, newMax: 3 })).toBeNull();
  });

  test('a value above its old maximum is treated as full and follows', () => {
    expect(poolAfterMaxChange({ storedValue: 5, oldMax: 3, newMax: 4 })).toBe(4);
  });

  test('an empty pool is never refilled by a rising maximum', () => {
    // All Action Points spent is a valid in-combat state, not a stale pool.
    expect(poolAfterMaxChange({ storedValue: 0, oldMax: 3, newMax: 4 })).toBeNull();
  });

  test('an empty pool whose max was already zero follows — nothing was spent', () => {
    expect(poolAfterMaxChange({ storedValue: 0, oldMax: 0, newMax: 20 })).toBe(20);
  });

  test('non-numeric input writes nothing rather than throwing', () => {
    expect(poolAfterMaxChange({ storedValue: undefined, oldMax: 3, newMax: 4 })).toBeNull();
    expect(poolAfterMaxChange({ storedValue: 1, oldMax: null, newMax: 4 })).toBeNull();
    expect(poolAfterMaxChange({ storedValue: 1, oldMax: 3, newMax: NaN })).toBeNull();
    expect(poolAfterMaxChange()).toBeNull();
  });

  test('hit locations use the same rule — undamaged follows, wounded keeps its wound', () => {
    // Head 9/9 -> max 11 after Durability + Paragon bonus HP.
    expect(poolAfterMaxChange({ storedValue: 9, oldMax: 9, newMax: 11 })).toBe(11);
    // Left Leg 4/9 (5 points down) stays 4 — the wound is not healed by a
    // characteristic change.
    expect(poolAfterMaxChange({ storedValue: 4, oldMax: 9, newMax: 11 })).toBeNull();
    // A negative current (Serious/Major wound) is likewise untouched.
    expect(poolAfterMaxChange({ storedValue: -5, oldMax: 9, newMax: 11 })).toBeNull();
  });
});
