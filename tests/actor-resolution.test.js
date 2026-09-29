/**
 * tests/actor-resolution.test.js — v1.4.362: several unlinked tokens of ONE
 * actor (Destined's swarms) must each resolve to themselves. Before, every
 * lookup by actor id found the first token on the map, so damage and Prone
 * landed on a sibling swarm.
 */
import { jest } from '@jest/globals';
import { combatRef, resolveTokenActor, tokenFor, liveActor } from '../module/utils/actor-resolution.js';

const BASE_ID = 'howlerSwarm5';
const makeToken = (tokenId) => {
  const token = { id: tokenId, actorId: BASE_ID };
  const actor = {
    id: BASE_ID, isToken: true, documentName: 'Actor',
    uuid: `Scene.s1.Token.${tokenId}.Actor.${BASE_ID}`, token,
  };
  const placeable = { id: tokenId, actor, document: token };
  token.object = placeable;
  return { token, actor, placeable };
};
const s1 = makeToken('t1');
const s2 = makeToken('t2');
const s3 = makeToken('t3');
const baseActor = { id: BASE_ID, isToken: false, documentName: 'Actor', uuid: `Actor.${BASE_ID}` };

beforeEach(() => {
  globalThis.canvas = { tokens: {
    placeables: [s1.placeable, s2.placeable, s3.placeable],
    get: (id) => [s1, s2, s3].find(s => s.placeable.id === id)?.placeable,
  } };
  globalThis.game = { actors: { get: (id) => (id === BASE_ID ? baseActor : undefined) } };
  globalThis.fromUuidSync = jest.fn((uuid) => [s1, s2, s3].find(s => s.actor.uuid === uuid)?.actor ?? (uuid === baseActor.uuid ? baseActor : null));
});

describe('combatRef + resolveTokenActor', () => {
  test('each sibling swarm token round-trips to itself, not the first on the map', () => {
    expect(resolveTokenActor(combatRef(s2.actor))).toBe(s2.actor);
    expect(resolveTokenActor(combatRef(s3.actor))).toBe(s3.actor);
  });
  test('a plain id still works (older cards, linked actors) — first token, as before', () => {
    expect(resolveTokenActor(BASE_ID)).toBe(s1.actor);
  });
  test('a world actor uuid resolves to the world actor', () => {
    expect(resolveTokenActor('Actor.' + BASE_ID)).toBe(baseActor);
  });
  test('an unresolvable uuid falls back to the id path', () => {
    globalThis.fromUuidSync = () => null;
    expect(resolveTokenActor(`Scene.gone.Token.x.Actor.${BASE_ID}`)).toBe(s1.actor);
  });
  test('empty refs', () => {
    expect(resolveTokenActor(null)).toBeNull();
    expect(combatRef(null)).toBeNull();
  });
});

describe('tokenFor / liveActor', () => {
  test('a synthetic actor gets its OWN token (where Prone is applied)', () => {
    expect(tokenFor(s3.actor)).toBe(s3.placeable);
    expect(liveActor(s2.actor)).toBe(s2.actor);
  });
  test('a world actor falls back to its first canvas token', () => {
    expect(tokenFor(baseActor)).toBe(s1.placeable);
    expect(liveActor(baseActor)).toBe(s1.actor);
  });
});

describe('sameActor / allStateHolders (v1.4.363)', () => {
  test('a stored token ref matches only that swarm token', async () => {
    const { sameActor } = await import('../module/utils/actor-resolution.js');
    expect(sameActor(combatRef(s2.actor), s2.actor)).toBe(true);
    expect(sameActor(combatRef(s2.actor), s3.actor)).toBe(false);
  });
  test('an older bare-id entry still matches by id, as before', async () => {
    const { sameActor } = await import('../module/utils/actor-resolution.js');
    expect(sameActor(BASE_ID, s3.actor)).toBe(true);
    expect(sameActor(null, s3.actor)).toBe(false);
  });
  test('the state sweep includes every unlinked token actor, not just world actors', async () => {
    const { allStateHolders } = await import('../module/utils/actor-resolution.js');
    globalThis.game.actors.contents = [baseActor];
    globalThis.game.scenes = { contents: [{ tokens: { contents: [
      { actorLink: false, actor: s1.actor }, { actorLink: false, actor: s2.actor }, { actorLink: true, actor: baseActor },
    ] } }] };
    expect(allStateHolders()).toEqual([baseActor, s1.actor, s2.actor]);
  });
});
