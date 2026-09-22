/**
 * tests/hit-location.test.js
 *
 * Jest tests for module/utils/hit-location.js
 *
 * `hitLocationForRoll` was extracted in v1.4.321 when the Luck Point re-roll
 * would otherwise have made a second inline copy of the same filter/sort/find.
 * These pin the behaviour the two call sites now share — in particular the
 * fall-through, which is easy to mistake for a bug and is deliberate.
 */

import { hitLocationForRoll, locationNameToKey, resolveLocationChoice } from '../module/utils/hit-location.js';

/** The standard humanoid table (Mythras p.75). */
const HUMANOID = [
  { id: 'rl', name: 'Right Leg', system: { rangeMin: 1,  rangeMax: 3  } },
  { id: 'll', name: 'Left Leg',  system: { rangeMin: 4,  rangeMax: 6  } },
  { id: 'ab', name: 'Abdomen',   system: { rangeMin: 7,  rangeMax: 9  } },
  { id: 'ch', name: 'Chest',     system: { rangeMin: 10, rangeMax: 12 } },
  { id: 'ra', name: 'Right Arm', system: { rangeMin: 13, rangeMax: 15 } },
  { id: 'la', name: 'Left Arm',  system: { rangeMin: 16, rangeMax: 18 } },
  { id: 'hd', name: 'Head',      system: { rangeMin: 19, rangeMax: 20 } },
];

describe('hitLocationForRoll', () => {
  test('maps every face of the d20 to the standard humanoid table', () => {
    const expected = {
      1: 'Right Leg', 2: 'Right Leg', 3: 'Right Leg',
      4: 'Left Leg', 5: 'Left Leg', 6: 'Left Leg',
      7: 'Abdomen', 8: 'Abdomen', 9: 'Abdomen',
      10: 'Chest', 11: 'Chest', 12: 'Chest',
      13: 'Right Arm', 14: 'Right Arm', 15: 'Right Arm',
      16: 'Left Arm', 17: 'Left Arm', 18: 'Left Arm',
      19: 'Head', 20: 'Head',
    };
    for (let d20 = 1; d20 <= 20; d20++) {
      expect({ d20, loc: hitLocationForRoll(HUMANOID, d20)?.name })
        .toEqual({ d20, loc: expected[d20] });
    }
  });

  test('band boundaries are inclusive at both ends', () => {
    expect(hitLocationForRoll(HUMANOID, 9).name).toBe('Abdomen');
    expect(hitLocationForRoll(HUMANOID, 10).name).toBe('Chest');
    expect(hitLocationForRoll(HUMANOID, 12).name).toBe('Chest');
    expect(hitLocationForRoll(HUMANOID, 13).name).toBe('Right Arm');
  });

  test('input order does not matter — it sorts by rangeMin itself', () => {
    const shuffled = [HUMANOID[6], HUMANOID[0], HUMANOID[3], HUMANOID[1], HUMANOID[5], HUMANOID[2], HUMANOID[4]];
    for (let d20 = 1; d20 <= 20; d20++) {
      expect(hitLocationForRoll(shuffled, d20).name).toBe(hitLocationForRoll(HUMANOID, d20).name);
    }
  });

  test('does not mutate the array it is given', () => {
    const order = HUMANOID.map(l => l.name);
    hitLocationForRoll(HUMANOID, 11);
    expect(HUMANOID.map(l => l.name)).toEqual(order);
  });

  test('a roll outside every band falls through to the highest location', () => {
    // Deliberate, not a bug: a creature with an incomplete table still
    // resolves somewhere rather than throwing mid-attack.
    const partial = [
      { name: 'Body', system: { rangeMin: 1, rangeMax: 10 } },
      { name: 'Head', system: { rangeMin: 11, rangeMax: 15 } },
    ];
    expect(hitLocationForRoll(partial, 18).name).toBe('Head');
  });

  test('non-standard tables work — a Kaiju tail, an 8-location creature', () => {
    const kaiju = [
      { name: 'Tail',      system: { rangeMin: 1, rangeMax: 4 } },
      { name: 'Hind Legs', system: { rangeMin: 5, rangeMax: 9 } },
      { name: 'Body',      system: { rangeMin: 10, rangeMax: 20 } },
    ];
    expect(hitLocationForRoll(kaiju, 2).name).toBe('Tail');
    expect(hitLocationForRoll(kaiju, 7).name).toBe('Hind Legs');
    expect(hitLocationForRoll(kaiju, 20).name).toBe('Body');
  });

  test('returns null when the actor has no hit locations at all', () => {
    expect(hitLocationForRoll([], 10)).toBeNull();
    expect(hitLocationForRoll(null, 10)).toBeNull();
    expect(hitLocationForRoll(undefined, 10)).toBeNull();
  });

  test('tolerates malformed entries without throwing', () => {
    const messy = [null, undefined, { name: 'Chest', system: { rangeMin: 10, rangeMax: 12 } }];
    expect(hitLocationForRoll(messy, 11).name).toBe('Chest');
  });

  test('an entry with no range object still resolves rather than throwing', () => {
    const noRange = [{ name: 'Blob' }];
    expect(hitLocationForRoll(noRange, 5).name).toBe('Blob');
  });
});

describe('locationNameToKey (regression guard)', () => {
  test('still produces the canonical camelCase keys the hooks use', () => {
    expect(locationNameToKey('Right Leg')).toBe('rightLeg');
    expect(locationNameToKey('Head')).toBe('head');
    expect(locationNameToKey('Abdomen')).toBe('abdomen');
  });
});

describe('resolveLocationChoice', () => {
  const OFFERED = [
    { id: 'ch', name: 'Chest' },
    { id: 'hd', name: 'Head' },
  ];

  test('accepts an option that was offered, by id and name', () => {
    expect(resolveLocationChoice(OFFERED, { id: 'hd', label: 'Head' }))
      .toEqual({ id: 'hd', label: 'Head' });
  });

  test('no reply means no choice — closed, kept, or timed out', () => {
    expect(resolveLocationChoice(OFFERED, null)).toBeNull();
    expect(resolveLocationChoice(OFFERED, undefined)).toBeNull();
  });

  test('refuses a location that was not offered', () => {
    expect(resolveLocationChoice(OFFERED, { id: 'rl', label: 'Right Leg' })).toBeNull();
  });

  test('refuses an id paired with the wrong name', () => {
    expect(resolveLocationChoice(OFFERED, { id: 'hd', label: 'Chest' })).toBeNull();
  });

  test('a creature with no hit-location items offers name-only options', () => {
    const nameOnly = [{ id: null, name: 'Chest' }, { id: null, name: 'Head' }];
    expect(resolveLocationChoice(nameOnly, { id: null, label: 'Head' }))
      .toEqual({ id: null, label: 'Head' });
    // A reply with no id at all is the same as id: null.
    expect(resolveLocationChoice(nameOnly, { label: 'Chest' }))
      .toEqual({ id: null, label: 'Chest' });
  });

  test('tolerates missing or malformed options', () => {
    expect(resolveLocationChoice(null, { id: 'hd', label: 'Head' })).toBeNull();
    expect(resolveLocationChoice([null, { id: 'hd', name: 'Head' }], { id: 'hd', label: 'Head' }))
      .toEqual({ id: 'hd', label: 'Head' });
  });
});
