/**
 * tests/range-band.test.js — maxRangeBandHooks (v1.4.365).
 */
import { jest } from '@jest/globals';
import { maxRangeBand, clampRangeBand } from '../module/utils/range-band.js';

const w = { name: 'Poison Dart' }, a = { name: 'Blank' };

test('no hooks, or hooks with no opinion: no cap', () => {
  expect(maxRangeBand([], w, a)).toBeNull();
  expect(maxRangeBand([() => undefined, () => 'far'], w, a)).toBeNull();
});
test('a hook caps the weapon; the most restrictive of several wins', () => {
  expect(maxRangeBand([() => 'effective'], w, a)).toBe('effective');
  expect(maxRangeBand([() => 'effective', () => 'close', () => 'long'], w, a)).toBe('close');
});
test('hooks see the weapon and attacker', () => {
  const hook = jest.fn(() => 'close');
  maxRangeBand([hook], w, a);
  expect(hook).toHaveBeenCalledWith(w, a);
});
test('a throwing hook is ignored, not fatal', () => {
  const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
  expect(maxRangeBand([() => { throw new Error('boom'); }, () => 'effective'], w, a)).toBe('effective');
  quiet.mockRestore();
});
test('clamping a chosen band to the cap', () => {
  expect(clampRangeBand('long', 'close')).toBe('close');
  expect(clampRangeBand('effective', 'close')).toBe('close');
  expect(clampRangeBand('close', 'close')).toBe('close');
  expect(clampRangeBand('long', null)).toBe('long');
  expect(clampRangeBand('effective', 'long')).toBe('effective');
});
