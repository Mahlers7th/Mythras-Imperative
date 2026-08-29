/**
 * tests/skill-math.test.js
 *
 * Tests for module/utils/skill-math.js — the single definition of "what is
 * this skill's percentage?", introduced in v1.4.311 to replace three
 * byte-identical `_evalFormula` copies and two inline base+bonusPoints
 * recomputations.
 *
 * These import the real functions (they are pure and Foundry-free), so this
 * file tests the actual arithmetic rather than a mirror of it. The hook
 * CONSUMPTION contract — deriveSkillTotals' loop — is mirrored separately in
 * extension-hooks.test.js, per that file's convention.
 */

import { evalSkillFormula, computeSkillTotal, charsFrom, SKILL_ITEM_TYPES } from '../module/utils/skill-math.js';

const CHARS = { STR: 12, CON: 11, SIZ: 13, DEX: 14, INT: 15, POW: 10, CHA: 9 };

describe('evalSkillFormula — behaviour preserved from the three copies it replaces', () => {
  test('sums two characteristics', () => {
    expect(evalSkillFormula('STR+DEX', CHARS)).toBe(26);
  });

  test('handles the unicode multiplication sign', () => {
    expect(evalSkillFormula('INT×2', CHARS)).toBe(30);
  });

  test('does NOT treat the letter x as multiplication — DEX must survive', () => {
    // The specific trap CharacterSheet's copy carried a comment about: a
    // naive /x/i -> '*' replacement turns DEX into DE*, which evaluates to 0.
    expect(evalSkillFormula('DEX', CHARS)).toBe(14);
    expect(evalSkillFormula('DEX+DEX', CHARS)).toBe(28);
  });

  test('is case-insensitive and word-boundary anchored', () => {
    expect(evalSkillFormula('str+dex', CHARS)).toBe(26);
    expect(evalSkillFormula('Str+Dex', CHARS)).toBe(26);
  });

  test('floors a fractional result', () => {
    expect(evalSkillFormula('INT/2', CHARS)).toBe(7);   // 15/2 = 7.5 -> 7
  });

  test('supports parentheses and mixed arithmetic', () => {
    expect(evalSkillFormula('(STR+SIZ)*2', CHARS)).toBe(50);
  });

  test('empty or missing formula is 0', () => {
    expect(evalSkillFormula('', CHARS)).toBe(0);
    expect(evalSkillFormula(undefined, CHARS)).toBe(0);
    expect(evalSkillFormula(null, CHARS)).toBe(0);
  });

  test('an unrecognised token leaves non-arithmetic behind and yields 0, never throws', () => {
    // The regex guard is what stops anything but arithmetic reaching Function.
    expect(evalSkillFormula('WIS+DEX', CHARS)).toBe(0);
    expect(() => evalSkillFormula('alert(1)', CHARS)).not.toThrow();
    expect(evalSkillFormula('alert(1)', CHARS)).toBe(0);
  });

  test('missing characteristics map does not throw', () => {
    expect(() => evalSkillFormula('STR+DEX', undefined)).not.toThrow();
    expect(evalSkillFormula('STR+DEX', undefined)).toBe(0);
  });
});

describe('charsFrom', () => {
  test('reads .value, so characteristicBonusHooks and Drain cascade into skills', () => {
    const characteristics = {
      str: { value: 18, base: 12 }, con: { value: 11 }, siz: { value: 13 },
      dex: { value: 14 }, int: { value: 15 }, pow: { value: 10 }, cha: { value: 9 }
    };
    // .value (18), NOT .base (12) — a Growth/Enhanced STR power must move Brawn.
    expect(charsFrom(characteristics).STR).toBe(18);
  });

  test('missing or partial characteristics default to 0 rather than undefined', () => {
    expect(charsFrom(undefined).STR).toBe(0);
    expect(charsFrom({ str: { value: 5 } }).CHA).toBe(0);
  });
});

describe('computeSkillTotal', () => {
  test('base formula + bonusPoints', () => {
    expect(computeSkillTotal({ baseFormula: 'STR+DEX', bonusPoints: 20, chars: CHARS }))
      .toEqual({ baseValue: 26, total: 46 });
  });

  test('a hook contribution is added on top', () => {
    expect(computeSkillTotal({ baseFormula: 'STR+DEX', bonusPoints: 20, chars: CHARS, hookSum: 5 }))
      .toEqual({ baseValue: 26, total: 51 });
  });

  test('statblock path: no baseFormula means the stored total is authoritative', () => {
    // MEG-imported creatures and NPCs. Recomputing from an empty formula
    // would yield 0 and silently wipe every skill on the actor.
    expect(computeSkillTotal({ baseFormula: '', storedTotal: 80, bonusPoints: 99, chars: CHARS }))
      .toEqual({ baseValue: 80, total: 80 });
  });

  test('statblock path still receives hook contributions', () => {
    expect(computeSkillTotal({ baseFormula: '', storedTotal: 80, chars: CHARS, hookSum: 5 }))
      .toEqual({ baseValue: 80, total: 85 });
  });

  test('negative contributions are allowed (cursed items, encumbrance)', () => {
    expect(computeSkillTotal({ baseFormula: 'STR+DEX', bonusPoints: 20, chars: CHARS, hookSum: -10 }).total)
      .toBe(36);
  });

  test('the composed total floors at 0 — a big penalty cannot go negative', () => {
    expect(computeSkillTotal({ baseFormula: 'STR+DEX', chars: CHARS, hookSum: -999 }).total).toBe(0);
    expect(computeSkillTotal({ baseFormula: '', storedTotal: 30, hookSum: -999 }).total).toBe(0);
  });

  test('is idempotent — the same inputs always give the same answer', () => {
    const args = { baseFormula: 'STR+DEX', bonusPoints: 20, chars: CHARS, hookSum: 5 };
    const a = computeSkillTotal(args);
    const b = computeSkillTotal(args);
    const c = computeSkillTotal(args);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  test('called with nothing at all, degrades to zeroes rather than throwing', () => {
    expect(() => computeSkillTotal()).not.toThrow();
    expect(computeSkillTotal()).toEqual({ baseValue: 0, total: 0 });
  });
});

describe('SKILL_ITEM_TYPES', () => {
  test('covers the three item types the character sheet has always derived together', () => {
    expect(SKILL_ITEM_TYPES).toEqual(['skill', 'combat-style', 'passion']);
  });
});
