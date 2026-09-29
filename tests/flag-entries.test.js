/**
 * tests/flag-entries.test.js — v1.4.363. No deletion form removes a key from a
 * fresh token delta (verified live), so removal writes the flag to null and
 * sets what remains. A tiny in-memory document models setFlag's MERGE, which
 * is what made "delete, then setFlag" a no-op.
 */
import { clearFlag, removeFlagEntries } from '../module/utils/flag-entries.js';

function makeDoc(initial = {}) {
  const store = structuredClone(initial);
  const calls = [];
  const merge = (target, src) => {
    for (const [k, v] of Object.entries(src)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') merge(target[k], v);
      else target[k] = structuredClone(v);
    }
  };
  return {
    calls,
    getFlag: (scope, key) => store[scope]?.[key],
    setFlag: async (scope, key, value) => { calls.push(['setFlag', key]); store[scope] ??= {}; if (store[scope][key] && typeof store[scope][key] === 'object') merge(store[scope][key], value); else store[scope][key] = structuredClone(value); },
    update: async (data) => {
      calls.push(['update', data]);
      for (const [path, value] of Object.entries(data)) {
        const [, scope, key] = path.split('.');
        store[scope] ??= {};
        store[scope][key] = value;
      }
    },
  };
}
const NS = 'mythras-imperative';

test('the old way is a no-op: setFlag merges, the deleted key survives', async () => {
  const doc = makeDoc({ [NS]: { entangledBy: { a: {}, b: {} } } });
  const v = { ...doc.getFlag(NS, 'entangledBy') }; delete v.b;
  await doc.setFlag(NS, 'entangledBy', v);
  expect(Object.keys(doc.getFlag(NS, 'entangledBy'))).toEqual(['a', 'b']);
});

test('removeFlagEntries removes the entry and keeps the rest', async () => {
  const doc = makeDoc({ [NS]: { entangledBy: { a: { x: 1 }, b: { x: 2 } }, keep: { k: 1 } } });
  await removeFlagEntries(doc, NS, 'entangledBy', ['b']);
  expect(doc.getFlag(NS, 'entangledBy')).toEqual({ a: { x: 1 } });
  expect(doc.getFlag(NS, 'keep')).toEqual({ k: 1 });
});

test('removing the last entry leaves the flag null', async () => {
  const doc = makeDoc({ [NS]: { jammedWeapons: { w1: {} } } });
  await removeFlagEntries(doc, NS, 'jammedWeapons', ['w1']);
  expect(doc.getFlag(NS, 'jammedWeapons')).toBeNull();
});

test('the caller already deleted the key from the LIVE object: still written to the server', async () => {
  const doc = makeDoc({ [NS]: { pendingEntangleTrip: { a: {}, b: {} } } });
  const live = doc.getFlag(NS, 'pendingEntangleTrip');
  delete live.b;   // what Slip Free and others do before removing
  await removeFlagEntries(doc, NS, 'pendingEntangleTrip', ['b']);
  expect(doc.calls.some(c => c[0] === 'update')).toBe(true);
  expect(doc.getFlag(NS, 'pendingEntangleTrip')).toEqual({ a: {} });
});

test('no flag or no keys: no write at all', async () => {
  const doc = makeDoc({ [NS]: { e: { a: 1 } } });
  await removeFlagEntries(doc, NS, 'missing', ['a']);
  await removeFlagEntries(doc, NS, 'e', []);
  await removeFlagEntries(null, NS, 'e', ['a']);
  expect(doc.calls).toEqual([]);
});

test('clearFlag writes null, and skips a flag that is not set', async () => {
  const doc = makeDoc({ [NS]: { pressAdvantaged: { round: 2 } } });
  await clearFlag(doc, NS, 'pressAdvantaged');
  expect(doc.getFlag(NS, 'pressAdvantaged')).toBeNull();
  await clearFlag(doc, NS, 'pressAdvantaged');
  await clearFlag(doc, NS, 'neverSet');
  expect(doc.calls.filter(c => c[0] === 'update')).toHaveLength(1);
});
