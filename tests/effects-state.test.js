/**
 * tests/effects-state.test.js — combat Special Effects that leave state behind
 * (Entangle, Slip Free, Pin Object, Pin Weapon, Press Advantage, Weapon
 * Malfunction, Arise), run against tests/helpers/fake-foundry.js.
 *
 * Until v1.4.363 none of these files had a test, and two bugs lived here for
 * months: effect state was written to the BASE actor (every token of a swarm
 * shared it), and removing state never worked (setFlag merges). The fake
 * reproduces both conditions, so either bug coming back fails here.
 */
import { installFoundry, makeActor, makeSwarmTokens, chatText } from './helpers/fake-foundry.js';
import { resolveEntangle } from '../module/combat/effects/entangle.js';
import { resolveSlipFree } from '../module/combat/effects/slip-free.js';
import { resolvePinObject } from '../module/combat/effects/pin-object.js';
import { resolvePinWeapon } from '../module/combat/effects/pin-weapon.js';
import { resolvePressAdvantage, resolveWeaponMalfunction } from '../module/combat/effects/simple.js';
import { resolveArise } from '../module/combat/effects/arise.js';

const NS = 'mythras-imperative';
const flag = (a, k) => a.getFlag(NS, k);
const entries = (a, k) => Object.values(flag(a, k) ?? {});

let hero, swarm, rec;
beforeEach(() => {
  hero = makeActor({ name: 'Hargrim', items: [{ id: 'halberd', name: 'Halberd', type: 'weapon', system: { category: 'melee' } }] });
  swarm = makeSwarmTokens(3, { items: [{ id: 'blade', name: 'Crude Blade', type: 'weapon', system: { category: 'melee' } }] });
  rec = installFoundry({ actors: [hero, ...swarm] });
});

const entangle = (attacker, defender, loc = 'Right Leg') =>
  resolveEntangle({ attacker, defender, attackResult: 30, chatMessageId: null, hitLocationLabel: loc, locationType: 'leg' }, 0, false);

describe('Entangle', () => {
  test('the defender is entangled, the attacker may trip them, and a card is posted', async () => {
    await entangle(hero, swarm[1]);
    expect(entries(swarm[1], 'entangledBy')).toHaveLength(1);
    expect(swarm[1].statuses.has('entangled')).toBe(true);
    expect(entries(swarm[1], 'pendingEntangleBreakFree')).toHaveLength(1);
    expect(entries(hero, 'pendingEntangleTrip')).toHaveLength(1);
    expect(rec.chat.length).toBeGreaterThan(0);
  });
  test('only the struck swarm token — its siblings share the actor id but not the state', async () => {
    await entangle(hero, swarm[1]);
    for (const s of [swarm[0], swarm[2]]) {
      expect(flag(s, 'entangledBy')).toBeUndefined();
      expect(s.statuses.has('entangled')).toBe(false);
    }
  });
  test('cross-references name the exact token, not the shared actor id', async () => {
    await entangle(swarm[2], hero);
    expect(entries(hero, 'entangledBy')[0].attackerActorId).toBe(swarm[2].uuid);
    await entangle(hero, swarm[1]);
    expect(entries(hero, 'pendingEntangleTrip')[0].defenderId).toBe(swarm[1].uuid);
  });
});

describe('Slip Free', () => {
  test('clears the Entangle, the status and the pending break-free', async () => {
    await entangle(hero, swarm[0]);
    await resolveSlipFree({ attacker: hero, defender: swarm[0] });
    expect(entries(swarm[0], 'entangledBy')).toHaveLength(0);
    expect(swarm[0].statuses.has('entangled')).toBe(false);
    expect(entries(swarm[0], 'pendingEntangleBreakFree')).toHaveLength(0);
  });
  test("removes the entangler's pending Trip against THIS swarm only (the merge bug)", async () => {
    await entangle(hero, swarm[0], 'Left Leg');
    await entangle(hero, swarm[1], 'Right Leg');
    expect(entries(hero, 'pendingEntangleTrip')).toHaveLength(2);
    await resolveSlipFree({ attacker: hero, defender: swarm[0] });
    const left = entries(hero, 'pendingEntangleTrip');
    expect(left).toHaveLength(1);
    expect(left[0].defenderId).toBe(swarm[1].uuid);
  });
  test('also clears pins held on it', async () => {
    await resolvePinObject({ attacker: hero, defender: swarm[0], weapon: hero.items.get('halberd') });
    await resolveSlipFree({ attacker: hero, defender: swarm[0] });
    expect(entries(swarm[0], 'pinnedBy')).toHaveLength(0);
  });
  test('with nothing holding it: says so, changes nothing', async () => {
    await resolveSlipFree({ attacker: hero, defender: swarm[0] });
    expect(chatText(rec.chat).join(' ')).toMatch(/no active holds/i);
  });
});

describe('Pin Object / Pin Weapon', () => {
  test("Pin Object records the pin on the struck token, naming the attacker's token", async () => {
    await resolvePinObject({ attacker: hero, defender: swarm[2], weapon: hero.items.get('halberd') });
    expect(entries(swarm[2], 'pinnedBy')).toHaveLength(1);
    expect(entries(swarm[2], 'pinnedBy')[0].attackerId).toBe(hero.uuid);
    expect(flag(swarm[0], 'pinnedBy')).toBeUndefined();
  });
  test("Pin Weapon pins the ATTACKER's weapon — that swarm token's only", async () => {
    await resolvePinWeapon({ attacker: swarm[1], defender: hero, weapon: swarm[1].items.get('blade') });
    expect(entries(swarm[1], 'pinnedWeapons')).toHaveLength(1);
    expect(entries(swarm[1], 'pinnedWeapons')[0].pinnedByActorId).toBe(hero.uuid);
    expect(flag(swarm[0], 'pinnedWeapons')).toBeUndefined();
  });
});

describe('Press Advantage / Weapon Malfunction', () => {
  test('Press Advantage marks the struck token only', async () => {
    await resolvePressAdvantage({ attacker: hero, defender: swarm[1] });
    expect(flag(swarm[1], 'pressAdvantaged')).toBeTruthy();
    expect(flag(swarm[0], 'pressAdvantaged')).toBeUndefined();
    expect(flag(swarm[2], 'pressAdvantaged')).toBeUndefined();
  });
  test("a malfunction jams that token's weapon, not its siblings'", async () => {
    await resolveWeaponMalfunction({ attacker: swarm[2], defender: hero, weapon: swarm[2].items.get('blade') });
    expect(flag(swarm[2], 'jammedWeapons')).toHaveProperty('blade');
    expect(flag(swarm[0], 'jammedWeapons')).toBeUndefined();
  });
});

describe('Arise', () => {
  test('a prone defender stands up — only that token', async () => {
    swarm[0].statuses.add('prone');
    swarm[1].statuses.add('prone');
    await resolveArise({ attacker: hero, defender: swarm[1] });
    expect(swarm[1].statuses.has('prone')).toBe(false);
    expect(swarm[0].statuses.has('prone')).toBe(true);
  });
  test('already standing: no change, and the card says so', async () => {
    await resolveArise({ attacker: hero, defender: swarm[1] });
    expect(swarm[1].statuses.has('prone')).toBe(false);
    expect(chatText(rec.chat).join(' ')).toMatch(/already standing/i);
  });
});
