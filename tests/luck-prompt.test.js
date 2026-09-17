/**
 * tests/luck-prompt.test.js
 *
 * Jest tests for the "Luck Point prompts" decision in module/rolls/luck-point.js
 * (v1.4.334): `diceRange`, `shouldOfferLuck` and `luckPromptModeFor`.
 *
 * Chris's ruling (2026-09-17): a player chooses between being asked on every
 * roll, or only after a failure or fumble, or a damage roll lower than the
 * average of the dice rolled. A suppressed prompt is a Luck Point the player
 * could not spend, so the boundaries are pinned here rather than trusted to a
 * live look.
 */

import {
  diceRange, shouldOfferLuck, luckPromptModeFor,
  LUCK_PROMPT_ALWAYS, LUCK_PROMPT_SETBACKS,
} from '../module/rolls/luck-point.js';

const die = (number, faces) => ({ kind: 'die', number, faces });
const num = (number) => ({ kind: 'num', number });
const op  = (operator) => ({ kind: 'op', operator });

describe('diceRange', () => {
  test('a single die', () => {
    expect(diceRange([die(1, 8)])).toEqual({ min: 1, max: 8, mean: 4.5 });
  });

  test('weapon plus damage modifier', () => {
    expect(diceRange([die(1, 8), op('+'), die(1, 4)])).toEqual({ min: 2, max: 12, mean: 7 });
  });

  test('a negative damage modifier swaps that die\'s ends', () => {
    // 1d8-1d2 runs from 1-2 = -1 to 8-1 = 7. Minimising every die would give
    // 0..6 instead, which is the trap this function exists to avoid.
    expect(diceRange([die(1, 8), op('-'), die(1, 2)])).toEqual({ min: -1, max: 7, mean: 3 });
  });

  test('constants and several dice', () => {
    expect(diceRange([die(2, 6), op('+'), num(1)])).toEqual({ min: 3, max: 13, mean: 8 });
    expect(diceRange([die(1, 6), op('-'), num(1)])).toEqual({ min: 0, max: 5, mean: 2.5 });
  });

  test('a leading minus applies to the first operand only', () => {
    expect(diceRange([op('-'), num(2), op('+'), die(1, 6)])).toEqual({ min: -1, max: 4, mean: 1.5 });
  });

  test('a double minus is a plus', () => {
    expect(diceRange([die(1, 6), op('-'), op('-'), num(1)])).toEqual({ min: 2, max: 7, mean: 4.5 });
  });

  test('refuses what it cannot model rather than guessing', () => {
    expect(diceRange([die(1, 8), op('*'), num(2)])).toBeNull();
    expect(diceRange([{ kind: 'unsupported' }])).toBeNull();
    expect(diceRange([die(1.5, 6)])).toBeNull();
    expect(diceRange([die(1, 0)])).toBeNull();
    expect(diceRange([])).toBeNull();
    expect(diceRange([op('+')])).toBeNull();
    expect(diceRange(null)).toBeNull();
  });
});

describe('shouldOfferLuck — graded d100 rolls', () => {
  test('"every roll" asks on success, failure and fumble', () => {
    for (const outcome of ['success', 'failure', 'fumble']) {
      expect(shouldOfferLuck({ mode: LUCK_PROMPT_ALWAYS, outcome })).toBe(true);
    }
  });

  test('"setbacks" asks only on failure and fumble', () => {
    expect(shouldOfferLuck({ mode: LUCK_PROMPT_SETBACKS, outcome: 'failure' })).toBe(true);
    expect(shouldOfferLuck({ mode: LUCK_PROMPT_SETBACKS, outcome: 'fumble' })).toBe(true);
    expect(shouldOfferLuck({ mode: LUCK_PROMPT_SETBACKS, outcome: 'success' })).toBe(false);
  });

  test('a critical is never offered in either mode — nothing beats it', () => {
    expect(shouldOfferLuck({ mode: LUCK_PROMPT_ALWAYS,   outcome: 'critical' })).toBe(false);
    expect(shouldOfferLuck({ mode: LUCK_PROMPT_SETBACKS, outcome: 'critical' })).toBe(false);
  });

  test('a critical defence is still offered when the point could force a landed attack to be re-rolled', () => {
    expect(shouldOfferLuck({ mode: LUCK_PROMPT_ALWAYS, outcome: 'critical', otherRollAtStake: true })).toBe(true);
  });

  test('"setbacks" follows the player\'s own roll, not the opponent\'s', () => {
    // Chris's wording is "only on failure/fumble". A successful defence
    // against a successful attack is not a setback on the defender's roll.
    expect(shouldOfferLuck({ mode: LUCK_PROMPT_SETBACKS, outcome: 'success', otherRollAtStake: true })).toBe(false);
    expect(shouldOfferLuck({ mode: LUCK_PROMPT_SETBACKS, outcome: 'critical', otherRollAtStake: true })).toBe(false);
  });
});

describe('shouldOfferLuck — damage rolls', () => {
  const d8 = { min: 1, max: 8, mean: 4.5 };
  const d6 = { min: 1, max: 6, mean: 3.5 };
  const twoD6 = { min: 2, max: 12, mean: 7 };

  test('"setbacks" asks only below the average', () => {
    expect(shouldOfferLuck({ mode: LUCK_PROMPT_SETBACKS, total: 4, range: d8 })).toBe(true);
    expect(shouldOfferLuck({ mode: LUCK_PROMPT_SETBACKS, total: 5, range: d8 })).toBe(false);
    expect(shouldOfferLuck({ mode: LUCK_PROMPT_SETBACKS, total: 3, range: d6 })).toBe(true);
    expect(shouldOfferLuck({ mode: LUCK_PROMPT_SETBACKS, total: 4, range: d6 })).toBe(false);
  });

  test('a roll exactly on a whole-number average is not below it', () => {
    expect(shouldOfferLuck({ mode: LUCK_PROMPT_SETBACKS, total: 7, range: twoD6 })).toBe(false);
    expect(shouldOfferLuck({ mode: LUCK_PROMPT_SETBACKS, total: 6, range: twoD6 })).toBe(true);
  });

  test('"every roll" asks on anything short of the maximum', () => {
    expect(shouldOfferLuck({ mode: LUCK_PROMPT_ALWAYS, total: 7, range: d8 })).toBe(true);
    expect(shouldOfferLuck({ mode: LUCK_PROMPT_ALWAYS, total: 8, range: d8 })).toBe(false);
  });

  test('a total above the formula\'s maximum is not offered', () => {
    // Maximise Damage and Impale feed the same total; neither can exceed the
    // formula, but a stale range must still not produce a pointless offer.
    expect(shouldOfferLuck({ mode: LUCK_PROMPT_ALWAYS, total: 9, range: d8 })).toBe(false);
  });

  test('an unreadable formula is offered rather than silently suppressed', () => {
    expect(shouldOfferLuck({ mode: LUCK_PROMPT_SETBACKS, total: 10, range: null })).toBe(true);
  });
});

describe('shouldOfferLuck — defaults', () => {
  test('an unknown mode behaves as "every roll"', () => {
    expect(shouldOfferLuck({ mode: 'bogus', outcome: 'success' })).toBe(true);
  });

  test('no roll information at all is offered', () => {
    expect(shouldOfferLuck({ mode: LUCK_PROMPT_SETBACKS })).toBe(true);
    expect(shouldOfferLuck()).toBe(true);
  });
});

describe('luckPromptModeFor', () => {
  const KEY = 'mythras-imperative.luckPromptMode';

  /** Settings stand-in: the current user's value, plus stored docs by user. */
  function installGame({ mine, stored = {}, throws = false }) {
    globalThis.game = {
      user: { id: 'gm' },
      settings: {
        get: (ns, key) => {
          if (throws) throw new Error('not registered');
          expect(`${ns}.${key}`).toBe(KEY);
          return mine;
        },
        settings: new Map([[KEY, { default: LUCK_PROMPT_ALWAYS }]]),
        storage: new Map([['world', {
          getSetting: (key, user) => (key === KEY && user in stored) ? { value: stored[user] } : undefined,
        }]]),
      },
    };
  }

  afterEach(() => { delete globalThis.game; });

  test('the current user reads their own setting', () => {
    installGame({ mine: LUCK_PROMPT_SETBACKS });
    expect(luckPromptModeFor(null)).toBe(LUCK_PROMPT_SETBACKS);
    expect(luckPromptModeFor('gm')).toBe(LUCK_PROMPT_SETBACKS);
  });

  test('another user\'s choice is read from world storage, not from my own', () => {
    installGame({ mine: LUCK_PROMPT_ALWAYS, stored: { player2: LUCK_PROMPT_SETBACKS } });
    expect(luckPromptModeFor('player2')).toBe(LUCK_PROMPT_SETBACKS);
  });

  test('a user who never changed it gets the registered default', () => {
    installGame({ mine: LUCK_PROMPT_SETBACKS, stored: {} });
    expect(luckPromptModeFor('player3')).toBe(LUCK_PROMPT_ALWAYS);
  });

  test('a failure to read falls back to asking on every roll', () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      installGame({ throws: true });
      expect(luckPromptModeFor(null)).toBe(LUCK_PROMPT_ALWAYS);
    } finally {
      console.warn = warn;
    }
  });
});
