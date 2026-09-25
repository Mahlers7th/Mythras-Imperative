/**
 * tests/damage-sink.test.js
 *
 * Jest tests for module/utils/damage-sink.js — the pure half of
 * damageLocationHooks and seExclusionHooks (v1.4.358).
 */

import { jest } from '@jest/globals';
import { isDamageSink, findDamageSink, isSEExcluded } from '../module/utils/damage-sink.js';

const sink = (over = {}) => ({ label: 'Swarm', current: 26, max: 26, write: () => {}, ...over });

describe('isDamageSink', () => {
  test('a complete sink is valid', () => {
    expect(isDamageSink(sink())).toBe(true);
  });

  test('numeric strings are accepted', () => {
    expect(isDamageSink(sink({ current: '12', max: '26' }))).toBe(true);
  });

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 5],
    ['no write', { current: 1, max: 2 }],
    ['write not a function', sink({ write: 'x' })],
    ['NaN current', sink({ current: NaN })],
    ['missing max', sink({ max: undefined })],
  ])('rejects %s', (_label, value) => {
    expect(isDamageSink(value)).toBe(false);
  });
});

describe('findDamageSink', () => {
  test('no hooks: null', () => {
    expect(findDamageSink({}, null, {}, [])).toBeNull();
    expect(findDamageSink({}, null, {}, undefined)).toBeNull();
  });

  test('every hook declining: null', () => {
    expect(findDamageSink({}, null, {}, [() => undefined, () => null, () => 3])).toBeNull();
  });

  test('the first valid sink wins', () => {
    const a = sink({ label: 'A' });
    const b = sink({ label: 'B' });
    expect(findDamageSink({}, null, {}, [() => undefined, () => a, () => b]).label).toBe('A');
  });

  test('passes defender, location and ctx to each hook', () => {
    const seen = [];
    const defender = { id: 'd' }, loc = { id: 'l' }, ctx = { k: 1 };
    findDamageSink(defender, loc, ctx, [(...args) => { seen.push(args); }]);
    expect(seen).toEqual([[defender, loc, ctx]]);
  });

  test('normalises numbers and the label', () => {
    const got = findDamageSink({}, null, {}, [() => sink({ current: '7', max: '26', label: undefined })]);
    expect(got.current).toBe(7);
    expect(got.max).toBe(26);
    expect(got.label).toBe('Pool');
  });

  test('keeps the write function', () => {
    const write = jest.fn();
    findDamageSink({}, null, {}, [() => sink({ write })]).write(3, 4);
    expect(write).toHaveBeenCalledWith(3, 4);
  });

  test('a throwing hook is reported and skipped', () => {
    const onError = jest.fn();
    const got = findDamageSink({}, null, {}, [() => { throw new Error('boom'); }, () => sink({ label: 'B' })], onError);
    expect(got.label).toBe('B');
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('isSEExcluded', () => {
  test('no hooks: allowed', () => {
    expect(isSEExcluded('bleed', {}, true, [])).toBe(false);
    expect(isSEExcluded('bleed', {}, true, undefined)).toBe(false);
  });

  test('only exactly true excludes', () => {
    expect(isSEExcluded('bleed', {}, true, [() => 1, () => 'yes', () => false, () => undefined])).toBe(false);
    expect(isSEExcluded('bleed', {}, true, [() => undefined, () => true])).toBe(true);
  });

  test('passes the SE id, ctx and winner side', () => {
    const seen = [];
    const ctx = { a: 1 };
    isSEExcluded('impale', ctx, false, [(...args) => { seen.push(args); }]);
    expect(seen).toEqual([['impale', ctx, false]]);
  });

  test('a throwing hook is reported and treated as declining', () => {
    const onError = jest.fn();
    expect(isSEExcluded('bleed', {}, true, [() => { throw new Error('boom'); }], onError)).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
