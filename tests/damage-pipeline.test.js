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
  bestCandidate,
  applyMaximiseDamage,
  applyReduction,
  damageAfterArmour,
  computeDamage,
  PARRY_NOTES,
  WARD_NOTES,
} from '../module/combat/damage-pipeline.js';

describe('bestCandidate', () => {
  const c = (total, dice = []) => ({ total, dice });

  test('takes the higher roll either way round', () => {
    expect(bestCandidate([c(4), c(9)]).index).toBe(1);
    expect(bestCandidate([c(9), c(4)]).index).toBe(0);
  });

  test('a tie keeps the earlier candidate, matching the card winner styling', () => {
    const first = c(6, [{ faces: 6, result: 6 }]);
    expect(bestCandidate([first, c(6)]).candidate).toBe(first);
  });

  // The whole reason candidates exist: the winner's DICE travel with its total,
  // so Maximise and the card's dice breakdown cannot read the discarded roll.
  test('returns the winning candidate own dice, not the first roll dice', () => {
    const loser  = c(3, [{ faces: 10, result: 3 }]);
    const winner = c(9, [{ faces: 10, result: 9 }]);
    expect(bestCandidate([loser, winner]).candidate.dice).toEqual(winner.dice);
  });

  test('a single candidate wins by default', () => {
    expect(bestCandidate([c(5)]).index).toBe(0);
  });

  test('tolerates an empty or junk list', () => {
    expect(bestCandidate([]).index).toBe(-1);
    expect(bestCandidate(null).candidate).toEqual({ total: 0, dice: [] });
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
  /** One rolled candidate: a total travelling with its own dice. */
  const c = (total, dice = []) => ({ total, dice });

  test('a plain unreduced hit passes the roll straight through', () => {
    expect(computeDamage({ candidates: [c(7)] })).toEqual({
      rawDamage: 7, damageAfterParry: 7, finalDamage: 7,
      parryNote: '', wardNote: '', winnerIndex: 0,
    });
  });

  test('armour alone', () => {
    const r = computeDamage({ candidates: [c(9)], armourAP: 4 });
    expect(r.finalDamage).toBe(5);
    expect(r.rawDamage).toBe(9);
  });

  test('the full order: pick the roll, maximise, parry, ward, armour', () => {
    const r = computeDamage({
      candidates: [c(4, [{ faces: 8, result: 4 }]),
                   c(6, [{ faces: 8, result: 6 }])],   // 6 wins
      maximiseCount: 1,                                 // -> 6 + 2 = 8
      parry:         { multiplier: 0.5, label: 'half' },// -> ceil(4) = 4
      armourAP:      2,                                 // -> 2
    });
    expect(r.winnerIndex).toBe(1);
    expect(r.rawDamage).toBe(8);
    expect(r.damageAfterParry).toBe(4);
    expect(r.finalDamage).toBe(2);
    expect(r.parryNote).toBe('half damage');
  });

  // ── Chris's ruling (2026-09-12): Impale's two rolls are ONE roll and the
  //    player takes the highest. So the discarded roll's dice are not in play.
  test('Maximise reads the WINNING roll\'s dice, not the first roll\'s', () => {
    const r = computeDamage({
      candidates: [
        c(2,  [{ faces: 10, result: 2 }]),   // loser: an 8-point shortfall
        c(9,  [{ faces: 10, result: 9 }]),   // winner: a 1-point shortfall
      ],
      maximiseCount: 1,
    });
    // The winner stands at 9 and its own die maximises to 10.
    // Reading the loser's dice would have given 9 + 8 = 17.
    expect(r.winnerIndex).toBe(1);
    expect(r.rawDamage).toBe(10);
  });

  test('winnerIndex lets the caller render the dice that actually stand', () => {
    const r = computeDamage({ candidates: [c(3), c(11), c(7)] });
    expect(r.winnerIndex).toBe(1);
    expect(r.rawDamage).toBe(11);
  });

  test('parry and ward compound when both are supplied', () => {
    // The engine makes these mutually exclusive (resolveWardReduction returns a
    // no-op for a parry defence), but the arithmetic must still be defined.
    const r = computeDamage({
      candidates: [c(10)],
      parry: { multiplier: 0.5, label: 'half' },   // -> 5
      ward:  { multiplier: 0.5, label: 'half' },   // -> 3 (ceil 2.5)
    });
    expect(r.damageAfterParry).toBe(3);
    expect(r.parryNote).toBe('half damage');
    expect(r.wardNote).toBe('half damage (warded)');
  });

  test('Enhance Parry arrives as a full-block reduction, not a flag', () => {
    const r = computeDamage({
      candidates: [c(14)],
      parry: { multiplier: 0, label: 'full' },
      armourAP: 3,
    });
    expect(r.damageAfterParry).toBe(0);
    expect(r.finalDamage).toBe(0);
    expect(r.parryNote).toBe('fully blocked');
  });

  test('a fully warded location takes nothing through armour', () => {
    const r = computeDamage({
      candidates: [c(12)],
      ward: { multiplier: 0, label: 'full' },
      armourAP: 1,
    });
    expect(r.finalDamage).toBe(0);
    expect(r.wardNote).toBe('fully warded');
  });

  test('rawDamage reports the post-pick, post-maximise figure the card shows', () => {
    // The card prints "Roll <rawDamage>", so this is the number a player reads
    // and the one a Luck Point re-roll is judged against.
    const r = computeDamage({
      candidates: [c(3, [{ faces: 10, result: 3 }]),
                   c(8, [{ faces: 10, result: 8 }])],
      maximiseCount: 1,
    });
    expect(r.rawDamage).toBe(10);
  });

  test('is pure — the same input twice gives the same answer', () => {
    const input = {
      candidates: [c(9, [{ faces: 6, result: 2 }]), c(5, [{ faces: 6, result: 5 }])],
      maximiseCount: 1,
      parry: { multiplier: 0.5, label: 'half' }, armourAP: 2,
    };
    expect(computeDamage(input)).toEqual(computeDamage(input));
  });

  test('tolerates being called with nothing', () => {
    expect(computeDamage()).toEqual({
      rawDamage: 0, damageAfterParry: 0, finalDamage: 0,
      parryNote: '', wardNote: '', winnerIndex: -1,
    });
  });

  test('a single candidate is the no-Impale case', () => {
    expect(computeDamage({ candidates: [c(7)] }).rawDamage).toBe(7);
    expect(computeDamage({ candidates: [c(7)] }).winnerIndex).toBe(0);
  });

  test('a second roll of 0 still counts as a candidate, it is not skipped', () => {
    const r = computeDamage({ candidates: [c(7), c(0)] });
    expect(r.rawDamage).toBe(7);
    expect(r.winnerIndex).toBe(0);
  });
});
