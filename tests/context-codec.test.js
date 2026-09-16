/**
 * tests/context-codec.test.js
 *
 * Jest tests for module/combat/context-codec.js
 *
 * The codec carries a whole attack context from a player's client to the GM's
 * (v1.4.333). Its one job is to lose nothing that matters, so the tests are
 * about what survives the round trip — and about the two ways a copy can be
 * *subtly* wrong, which are worse than a copy that fails outright: an unlinked
 * token's actor resolving to the base actor, and a half-copied class instance
 * that looks like the real thing.
 */

import { encodeContext, decodeContext } from '../module/combat/context-codec.js';

// ── Stand-ins for Foundry's classes ──────────────────────────────────────────
class FakeDoc {
  constructor(uuid, name) { this.uuid = uuid; this.name = name; }
}
class FakeRoll {
  constructor(total) { this.total = total; }
  toJSON() { return { class: 'Roll', total: this.total }; }
}
const kinds = {
  isDocument: (v) => v instanceof FakeDoc,
  isRoll:     (v) => v instanceof FakeRoll,
};

/** A tiny world the decoder can look things up in. */
function world(...docs) {
  const byUuid = new Map(docs.map(d => [d.uuid, d]));
  return {
    fromUuid:     (u) => byUuid.get(u) ?? null,
    rollFromData: (d) => new FakeRoll(d.total),
  };
}

const roundTrip = (value, docs = []) =>
  decodeContext(JSON.parse(JSON.stringify(encodeContext(value, kinds))), world(...docs));

describe('encodeContext / decodeContext', () => {
  test('primitives pass straight through', () => {
    expect(roundTrip({ a: 1, b: 'x', c: true, d: null })).toEqual({ a: 1, b: 'x', c: true, d: null });
  });

  test('documents cross as UUIDs and come back as the same object', () => {
    const nex = new FakeDoc('Actor.nex', 'Nex');
    const out = roundTrip({ attacker: nex }, [nex]);
    expect(out.attacker).toBe(nex);
  });

  // The failure the allowlist serialiser has: it keys by id, so an unlinked
  // token actor resolves to its BASE actor, whose Action Points are not the
  // ones in play.
  test('an unlinked token actor resolves to the TOKEN actor, not the base actor', () => {
    const base  = new FakeDoc('Actor.gareth', 'Gareth (base)');
    const token = new FakeDoc('Scene.s.Token.t.Actor.gareth', 'Gareth (token)');
    const out = roundTrip({ defender: token }, [base, token]);
    expect(out.defender).toBe(token);
    expect(out.defender).not.toBe(base);
  });

  test('keeps fields nobody listed — the reason this codec exists', () => {
    const ctx = {
      _targetActors: [new FakeDoc('Actor.a', 'A'), new FakeDoc('Actor.b', 'B')],
      vehicleWeaponAttack: true,
      declaredRounds: 7,
      destinedBoost: { id: 'berserk', tier: 2 },   // a module hook's field
    };
    const out = roundTrip(ctx, ctx._targetActors);
    expect(out._targetActors.map(d => d.name)).toEqual(['A', 'B']);
    expect(out.vehicleWeaponAttack).toBe(true);
    expect(out.declaredRounds).toBe(7);
    expect(out.destinedBoost).toEqual({ id: 'berserk', tier: 2 });
  });

  test('a Roll survives via toJSON', () => {
    const out = roundTrip({ attackRoll: new FakeRoll(42) });
    expect(out.attackRoll).toBeInstanceOf(FakeRoll);
    expect(out.attackRoll.total).toBe(42);
  });

  test('Sets survive as Sets', () => {
    const out = roundTrip({ statuses: new Set(['prone', 'surprised']) });
    expect(out.statuses).toBeInstanceOf(Set);
    expect([...out.statuses].sort()).toEqual(['prone', 'surprised']);
  });

  test('nested plain objects and arrays are walked', () => {
    const w = new FakeDoc('Actor.w.Item.sword', 'Sword');
    const out = roundTrip({ inline: { weapon: w, list: [1, { deep: w }] } }, [w]);
    expect(out.inline.weapon).toBe(w);
    expect(out.inline.list[1].deep).toBe(w);
  });

  test('functions are dropped, not stringified', () => {
    const out = roundTrip({ keep: 1, fn: () => 1 });
    expect(out).toEqual({ keep: 1 });
  });

  // A half-copied instance that LOOKS right is worse than a missing field.
  test('unrecognised class instances are dropped rather than flattened', () => {
    class Mystery { constructor() { this.x = 1; } }
    const out = roundTrip({ keep: 2, odd: new Mystery() });
    expect(out).toEqual({ keep: 2 });
  });

  test('array positions are preserved when an element is dropped', () => {
    const out = roundTrip({ rolls: [1, () => 0, 3] });
    expect(out.rolls).toEqual([1, null, 3]);
  });

  test('a document that cannot be found decodes to null, not undefined', () => {
    const ghost = new FakeDoc('Actor.gone', 'Gone');
    const out = roundTrip({ defender: ghost }, []);     // not in the world
    expect(out.defender).toBeNull();
  });

  test('an unsaved document with no UUID is dropped', () => {
    const temp = new FakeDoc(undefined, 'Temp');
    expect(roundTrip({ t: temp, keep: 1 })).toEqual({ keep: 1 });
  });

  test('a self-referencing object terminates instead of recursing forever', () => {
    const a = { name: 'loop' };
    a.self = a;
    expect(() => roundTrip(a)).not.toThrow();
  });

  test('the encoded form is JSON-safe', () => {
    const ctx = { attacker: new FakeDoc('Actor.x', 'X'), roll: new FakeRoll(5), s: new Set([1]) };
    expect(() => JSON.stringify(encodeContext(ctx, kinds))).not.toThrow();
  });
});
