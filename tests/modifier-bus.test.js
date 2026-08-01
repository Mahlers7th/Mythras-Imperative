/**
 * tests/modifier-bus.test.js
 *
 * Unit tests for the shared additive-hook summation utility
 * (module/utils/modifier-bus.js) that now backs all ten "read-time additive
 * numeric" CONFIG.MYTHRAS hook families. Imported for real — this is a pure,
 * Foundry-free module, unlike the Foundry-coupled call sites in
 * CharacterData.js/CombatEngine.js/mythras.mjs, which tests/extension-hooks.test.js
 * mirrors instead of importing.
 */
import { sumHookContributions } from '../module/utils/modifier-bus.js';

function makeSpy(impl = () => undefined) {
  const calls = [];
  const spy = (...args) => { calls.push(args); return impl(...args); };
  spy.calls = calls;
  return spy;
}

describe('sumHookContributions', () => {
  test('empty/undefined hook list sums to 0 with an empty breakdown', () => {
    expect(sumHookContributions([], [{}])).toEqual({ total: 0, breakdown: [] });
    expect(sumHookContributions(undefined, [{}])).toEqual({ total: 0, breakdown: [] });
  });

  test('a single hook contributes its value and appears in the breakdown by its declared name', () => {
    function apBonusForActor() { return 3; }
    const res = sumHookContributions([apBonusForActor], [{}]);
    expect(res.total).toBe(3);
    expect(res.breakdown).toEqual([{ name: 'apBonusForActor', value: 3 }]);
  });

  test('multiple hooks sum, each appearing in the breakdown', () => {
    const res = sumHookContributions([() => 2, () => 5], [{}]);
    expect(res.total).toBe(7);
    expect(res.breakdown.map(b => b.value)).toEqual([2, 5]);
  });

  test('a hook returning null/undefined/NaN contributes zero and is omitted from the breakdown', () => {
    const res = sumHookContributions([() => undefined, () => null, () => NaN, () => 4], [{}]);
    expect(res.total).toBe(4);
    expect(res.breakdown).toEqual([{ name: 'anonymous', value: 4 }]);
  });

  test('a throwing hook is swallowed, logged, contributes zero, and does not abort the sum', () => {
    const spyError = makeSpy();
    const originalError = console.error;
    console.error = spyError;
    try {
      const hooks = [() => 2, () => { throw new Error('boom'); }, () => 1];
      const res = sumHookContributions(hooks, [{}], { errorLabel: 'testHook' });
      expect(res.total).toBe(3);
      expect(res.breakdown.map(b => b.value)).toEqual([2, 1]);
      expect(spyError.calls.length).toBe(1);
      expect(spyError.calls[0][0]).toContain('testHook error');
    } finally {
      console.error = originalError;
    }
  });

  test('errorLabel defaults to "hook" when omitted', () => {
    const spyError = makeSpy();
    const originalError = console.error;
    console.error = spyError;
    try {
      sumHookContributions([() => { throw new Error('x'); }], [{}]);
      expect(spyError.calls[0][0]).toContain('hook error');
    } finally {
      console.error = originalError;
    }
  });

  test('clampNonNegative floors each hook\'s own contribution at 0 before summing (apReductionHooks shape)', () => {
    const res = sumHookContributions([() => -5, () => 3, () => -1], [{}], { clampNonNegative: true });
    // -5 -> 0 (omitted), 3 -> 3, -1 -> 0 (omitted); total is 0+3+0 = 3, not -3.
    expect(res.total).toBe(3);
    expect(res.breakdown).toEqual([{ name: 'anonymous', value: 3 }]);
  });

  test('clampNonNegative is false by default — negative contributions are preserved', () => {
    const res = sumHookContributions([() => -5, () => 3], [{}]);
    expect(res.total).toBe(-2);
    expect(res.breakdown.map(b => b.value)).toEqual([-5, 3]);
  });

  test('idempotent: re-running the same hooks against the same args yields the same result', () => {
    const hooks = [() => 3, () => -1];
    const first = sumHookContributions(hooks, [{}]);
    const second = sumHookContributions(hooks, [{}]);
    expect(first).toEqual(second);
  });

  test('every argument is passed through to every hook, in order', () => {
    const spy = makeSpy(() => 1);
    const actor = { name: 'Nex' };
    sumHookContributions([spy], [actor, 'chest']);
    expect(spy.calls).toEqual([[actor, 'chest']]);
  });

  test('a hook stamped with destinedHookName is labelled by that name over fn.name', () => {
    function combatExpertApBonus() { return 1; }
    combatExpertApBonus.destinedHookName = 'Combat Expert (Destined)';
    const res = sumHookContributions([combatExpertApBonus], [{}]);
    expect(res.breakdown).toEqual([{ name: 'Combat Expert (Destined)', value: 1 }]);
  });

  test('an anonymous arrow function with no destinedHookName and no fn.name falls back to "anonymous"', () => {
    const anon = (a) => 1;
    // Force fn.name to be empty, the way a function assigned into an array
    // literal element sometimes is, to exercise the final fallback.
    Object.defineProperty(anon, 'name', { value: '' });
    const res = sumHookContributions([anon], [{}]);
    expect(res.breakdown).toEqual([{ name: 'anonymous', value: 1 }]);
  });
});
