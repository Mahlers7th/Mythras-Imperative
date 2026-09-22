/**
 * tests/rounding.test.js
 *
 * Jest tests for module/utils/rounding.js — Mythras always rounds up.
 */

import { roundUp } from '../module/utils/rounding.js';

describe('roundUp', () => {
  test('the book\'s own example: 1/10th of 63% is 6.3, rounded up to 7', () => {
    expect(roundUp(63 / 10)).toBe(7);
  });

  test('whole numbers are left alone', () => {
    expect(roundUp(0)).toBe(0);
    expect(roundUp(7)).toBe(7);
  });

  test('any fraction goes up, however small', () => {
    expect(roundUp(7.5)).toBe(8);
    expect(roundUp(7.01)).toBe(8);
  });

  test('floating-point noise from a non-integer multiplier does not add a point', () => {
    // 100 * 1.1 is 110.00000000000001 in JavaScript; a bare Math.ceil gives 111.
    expect(100 * 1.1).not.toBe(110);
    expect(roundUp(100 * 1.1)).toBe(110);
    expect(roundUp(3 * 0.1 * 10)).toBe(3);
    expect(roundUp(0.1 + 0.2)).toBe(1);   // 0.30000000000000004 is still a real fraction of 1
  });

  test('negative values round toward zero (up)', () => {
    expect(roundUp(-2.5)).toBe(-2);
  });

  test('not a number gives 0', () => {
    expect(roundUp(NaN)).toBe(0);
    expect(roundUp(undefined)).toBe(0);
    expect(roundUp('x')).toBe(0);
  });
});
