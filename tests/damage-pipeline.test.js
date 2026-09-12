/**
 * tests/damage-pipeline.test.js
 *
 * Jest tests for module/combat/damage-pipeline.js
 *
 * These exist to make the extraction from `_onSemiAutoRollDamage` provably
 * neutral. Every expectation here was derived from the inline code it replaces
 * — the `Math.ceil` at both reduction sites, the `Math.max(0, ...)` at armour,
 * the two different wordings for a full parry and a full ward — so a
 * divergence shows up as a failing test rather than as a wrong number on a
 * chat card three sessions later.
 */

import {
  impaleBestOf,
  applyMaximiseDamage,
  applyReduction,
  damageAfterArmour,
  computeDamage,
  PARRY_NOTES,
  WARD_NOTES,
} from '../module/combat/damage-pipeline.js';

describe('impaleBestOf', () => {
  test('takes the higher roll either way round', () => {
    expect(impaleBestOf(4, 9)).toBe(9);
    expect(impaleBestOf(9, 4)).toBe(9);
  });

  test('a tie keeps the value', () => {
    expect(impaleBestOf(6, 6)).toBe(6);
  });
});

describe('applyMaximiseDamage', () => {
  const d8 = { faces: 8, result: 3 };
  const d6 = { faces: 6, result: 2 };

  test('raises one die to its maximum face', () => {
    // 3 rolled on a d8 -> add the 5-point shortfall.
    expect(applyMaximiseDamage(3, [d8], 1)).toBe(8);
  });

  test('stacks across as many dice as the count allows', () => {
    expect(applyMaximiseDamage(5, [d8, d6], 2)).toBe(5 + 5 + 4);
  });

  test('never maximises more dice than were rolled', () => {
    // Count 3 against a single die must not read past the end of the array.
    expect(applyMaximiseDamage(3, [d8], 3)).toBe(8);
  });

  test('a count of zero leaves the total alone', () => {
    expect(applyMaximiseDamage(7, [d8, d6], 0)).toBe(7);
  });

  test('preserves flat bonuses by adding the shortfall, not recomputing', () => {
    // 1d8+4 rolled 3 -> total 7. Maximising the d8 must give 12, not 8.
    expect(applyMaximiseDamage(7, [d8], 1)).toBe(12);
  });

  // ── The bug this function was rewritten to fix (shipped in v1.4.197, found
  //    by live test in v1.4.327). A Foundry Die term for 2d6 is ONE term whose
  //    `total` is the SUM, so the old `faces - term.total` was 6 - 6 = 0 and
  //    Maximise did nothing on every multi-die weapon.
  test('works on a multi-die group — 2d6 rolled 2 and 4', () => {
    const dice = [{ faces: 6, result: 2 }, { faces: 6, result: 4 }];
    // One Maximise: raise the 2 to a 6 -> 6 + 4 = 10.
    expect(applyMaximiseDamage(6, dice, 1)).toBe(10);
    // Two Maximise: both to 6 -> 12.
    expect(applyMaximiseDamage(6, dice, 2)).toBe(12);
  });

  test('maximising every die of a group reaches exactly the formula maximum', () => {
    const dice = [{ faces: 6, result: 1 }, { faces: 6, result: 1 }];
    expect(applyMaximiseDamage(2, dice, 2)).toBe(12);
  });

  test('chooses the dice with the largest shortfall, not the first in order', () => {
    // The SE is the attacker's: given a d10 that rolled 9 and a d6 that rolled
    // 1, one Maximise must take the d6 (+5), not the d10 (+1).
    const dice = [{ faces: 10, result: 9 }, { faces: 6, result: 1 }];
    expect(applyMaximiseDamage(10, dice, 1)).toBe(15);
  });

  test('a die already at its maximum contributes nothing', () => {
    expect(applyMaximiseDamage(8, [{ faces: 8, result: 8 }], 1)).toBe(8);
  });

  test('tolerates missing dice and a non-array', () => {
    expect(applyMaximiseDamage(5, [], 2)).toBe(5);
    expect(applyMaximiseDamage(5, null, 2)).toBe(5);
  });
});

describe('applyReduction', () => {
  test('half damage rounds UP — 5 becomes 3, not 2', () => {
    expect(applyReduction(5, { multiplier: 0.5, label: 'half' }))
      .toEqual({ damage: 3, note: 'half damage' });
  });

  test('a full block zeroes the damage', () => {
    expect(applyReduction(11, { multiplier: 0, label: 'full' }))
      .toEqual({ damage: 0, note: 'fully blocked' });
  });

  test('ward wording differs from parry wording at the full end', () => {
    expect(applyReduction(11, { multiplier: 0, label: 'full' }, WARD_NOTES).note)
      .toBe('fully warded');
    expect(applyReduction(5, { multiplier: 0.5, label: 'half' }, WARD_NOTES).note)
      .toBe('half damage (warded)');
    // The half wording is the one place they agree in substance but not text.
    expect(PARRY_NOTES.half).not.toBe(WARD_NOTES.half);
  });

  test('a multiplier of 1 or more is a no-op with no note', () => {
    expect(applyReduction(7, { multiplier: 1, label: 'none' }))
      .toEqual({ damage: 7, note: '' });
  });

  test('null means the gate did not apply', () => {
    expect(applyReduction(7, null)).toEqual({ damage: 7, note: '' });
  });

  test('an unknown label reduces the damage but says nothing', () => {
    expect(applyReduction(10, { multiplier: 0.5, label: 'weird' }))
      .toEqual({ damage: 5, note: '' });
  });
});

describe('damageAfterArmour', () => {
  test('subtracts armour points', () => {
    expect(damageAfterArmour(9, 4)).toBe(5);
  });

  test('never goes negative', () => {
    expect(damageAfterArmour(3, 8)).toBe(0);
  });
});

describe('computeDamage', () => {
  test('a plain unreduced hit passes the roll straight through', () => {
    expect(computeDamage({ rollTotal: 7 })).toEqual({
      rawDamage: 7, damageAfterParry: 7, finalDamage: 7,
      parryNote: '', wardNote: '',
    });
  });

  test('armour alone', () => {
    const r = computeDamage({ rollTotal: 9, armourAP: 4 });
    expect(r.finalDamage).toBe(5);
    expect(r.rawDamage).toBe(9);
  });

  test('the full order: impale, maximise, parry, ward, armour', () => {
    const r = computeDamage({
      rollTotal:     4,
      impaleSecond:  6,                               // -> 6
      dice:          [{ faces: 8, result: 3 }],
      maximiseCount: 1,                               // -> 6 + 5 = 11
      parry:         { multiplier: 0.5, label: 'half' },  // -> ceil(5.5) = 6
      armourAP:      2,                               // -> 4
    });
    expect(r.rawDamage).toBe(11);
    expect(r.damageAfterParry).toBe(6);
    expect(r.finalDamage).toBe(4);
    expect(r.parryNote).toBe('half damage');
  });

  test('parry and ward compound when both are supplied', () => {
    // The engine makes these mutually exclusive (resolveWardReduction returns a
    // no-op for a parry defence), but the arithmetic must still be defined.
    const r = computeDamage({
      rollTotal: 10,
      parry: { multiplier: 0.5, label: 'half' },   // -> 5
      ward:  { multiplier: 0.5, label: 'half' },   // -> 3 (ceil 2.5)
    });
    expect(r.damageAfterParry).toBe(3);
    expect(r.parryNote).toBe('half damage');
    expect(r.wardNote).toBe('half damage (warded)');
  });

  test('Enhance Parry arrives as a full-block reduction, not a flag', () => {
    const r = computeDamage({
      rollTotal: 14,
      parry: { multiplier: 0, label: 'full' },
      armourAP: 3,
    });
    expect(r.damageAfterParry).toBe(0);
    expect(r.finalDamage).toBe(0);
    expect(r.parryNote).toBe('fully blocked');
  });

  test('a fully warded location takes nothing through armour', () => {
    const r = computeDamage({
      rollTotal: 12,
      ward: { multiplier: 0, label: 'full' },
      armourAP: 1,
    });
    expect(r.finalDamage).toBe(0);
    expect(r.wardNote).toBe('fully warded');
  });

  test('rawDamage reports the post-impale, post-maximise figure the card shows', () => {
    // The card prints "Roll <rawDamage>", so this is the number a player reads
    // and the one a Luck Point re-roll is judged against.
    const r = computeDamage({
      rollTotal: 3, impaleSecond: 8,
      dice: [{ faces: 10, result: 3 }], maximiseCount: 1,
    });
    expect(r.rawDamage).toBe(15);
  });

  test('is pure — the same input twice gives the same answer', () => {
    const input = {
      rollTotal: 9, impaleSecond: 5,
      dice: [{ faces: 6, result: 2 }], maximiseCount: 1,
      parry: { multiplier: 0.5, label: 'half' }, armourAP: 2,
    };
    expect(computeDamage(input)).toEqual(computeDamage(input));
  });

  test('tolerates being called with nothing', () => {
    expect(computeDamage()).toEqual({
      rawDamage: 0, damageAfterParry: 0, finalDamage: 0,
      parryNote: '', wardNote: '',
    });
  });

  test('impaleSecond of null or undefined means Impale was not chosen', () => {
    expect(computeDamage({ rollTotal: 7, impaleSecond: null }).rawDamage).toBe(7);
    expect(computeDamage({ rollTotal: 7 }).rawDamage).toBe(7);
    // But a legitimate second roll of 0 must still be compared, not skipped.
    expect(computeDamage({ rollTotal: 7, impaleSecond: 0 }).rawDamage).toBe(7);
  });
});
