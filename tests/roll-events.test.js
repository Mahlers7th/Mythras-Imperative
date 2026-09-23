/**
 * tests/roll-events.test.js
 *
 * rollResolvedHooks (v1.4.350) — the real fireRollResolved, imported rather
 * than mirrored. Its only Foundry dependency is CONFIG.MYTHRAS, stubbed here.
 */
import { fireRollResolved } from '../module/utils/roll-events.js';

const withHooks = (hooks) => { global.CONFIG = { MYTHRAS: { rollResolvedHooks: hooks } }; };
const actor = { name: 'Nex' };

afterEach(() => { delete global.CONFIG; });

describe('fireRollResolved', () => {
  test('calls every hook once, with the context it was given', () => {
    const seen = [];
    withHooks([c => seen.push(['a', c]), c => seen.push(['b', c])]);
    const ctx = { actor, item: { name: 'Perception' }, kind: 'sheet', result: 42, target: 70, grade: 'success' };
    fireRollResolved(ctx);
    expect(seen.map(s => s[0])).toEqual(['a', 'b']);
    expect(seen[0][1]).toBe(ctx);
  });

  test('a hook that throws is stepped over, and the rest still run', () => {
    const seen = [];
    const spy = jest_spyOnConsoleError();
    withHooks([() => { throw new Error('bad module'); }, () => seen.push('ran')]);
    expect(() => fireRollResolved({ actor, kind: 'sheet' })).not.toThrow();
    expect(seen).toEqual(['ran']);
    expect(spy.calls.length).toBe(1);
    spy.restore();
  });

  test('return values are ignored — this is not a contribution hook', () => {
    withHooks([() => 5, () => false]);
    expect(fireRollResolved({ actor, kind: 'attack' })).toBeUndefined();
  });

  test('no hooks, no actor, or no CONFIG does nothing and never throws', () => {
    withHooks([]);
    expect(() => fireRollResolved({ actor, kind: 'sheet' })).not.toThrow();
    const seen = [];
    withHooks([() => seen.push('ran')]);
    fireRollResolved({ kind: 'sheet' });      // no actor
    fireRollResolved(null);
    expect(seen).toEqual([]);
    delete global.CONFIG;
    expect(() => fireRollResolved({ actor, kind: 'sheet' })).not.toThrow();
  });
});

/** This project's ESM Jest setup has no jest.fn — hand-roll the spy. */
function jest_spyOnConsoleError() {
  const original = console.error;
  const calls = [];
  console.error = (...args) => calls.push(args);
  return { calls, restore() { console.error = original; } };
}
