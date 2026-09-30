/**
 * tests/effects-reach-pin.test.js — Pin Down, and the optional Weapon Reach
 * effects (Close Range, Open Range, Withdraw) that store a pair's range on the
 * active combat. Against tests/helpers/fake-foundry.js, full automation.
 */
import { installFoundry, makeActor, makeSwarmTokens } from './helpers/fake-foundry.js';
import { resolvePinDown } from '../module/combat/effects/opposed.js';
import { resolveCloseRange, resolveOpenRange, resolveWithdraw } from '../module/combat/effects/simple.js';
import { storedReach } from '../module/combat/reach-state.js';

const NS = 'mythras-imperative';
const skill = (name, total) => ({ name, type: 'skill', system: { total } });

describe('Pin Down', () => {
  let hero, swarm;
  const setup = (rolls = []) => {
    hero = makeActor({ name: 'Hargrim' });
    swarm = makeSwarmTokens(3, { items: [skill('Willpower', 50)] });
    installFoundry({ actors: [hero, ...swarm], settings: { automationLevel: 'full' }, rolls });
  };
  test('an unresisted pin lands on the struck token only', async () => {
    setup();
    await resolvePinDown({ attacker: hero, defender: swarm[1], attackResult: 20, attackerSkillTotal: 70 }, true);
    expect(swarm[1].getFlag(NS, 'pinnedDown')).toBeTruthy();
    expect(swarm[0].getFlag(NS, 'pinnedDown')).toBeUndefined();
    expect(swarm[2].getFlag(NS, 'pinnedDown')).toBeUndefined();
  });
  test('a defender who wins the Willpower contest is not pinned', async () => {
    setup([5]);   // Willpower 5 vs 50: a success, against a failed attack roll
    await resolvePinDown({ attacker: hero, defender: swarm[1], attackResult: 95, attackerSkillTotal: 40 }, false);
    expect(swarm[1].getFlag(NS, 'pinnedDown')).toBeFalsy();
  });
});

describe('Weapon Reach effects', () => {
  let hero, foe, combat;
  const spear = { id: 'spear', name: 'Spear', type: 'weapon', system: { category: 'melee', reach: 'L' } };
  const knife = { id: 'knife', name: 'Knife', type: 'weapon', system: { category: 'melee', reach: 'S' } };
  beforeEach(() => {
    hero = makeActor({ name: 'Spearman', items: [spear] });
    foe = makeActor({ name: 'Knifer', items: [knife] });
    combat = makeActor({ name: 'Combat' });   // any doc with flags + update will do
    installFoundry({ actors: [hero, foe], settings: { weaponReach: true } });
    game.combats.active = combat;
  });
  const ctx = (R) => ({ attacker: foe, defender: hero, weapon: foe.items.get('knife'), defenceWeapon: hero.items.get('spear'), reachR: R, isRanged: false });

  test('Close Range moves the pair in to the shorter weapon', async () => {
    await resolveCloseRange(ctx(3));
    expect(storedReach(foe, hero)).toBe(1);   // Short
    expect(storedReach(hero, foe)).toBe(1);   // either way round
  });
  test('Open Range puts them back at the longer weapon', async () => {
    await resolveCloseRange(ctx(3));
    await resolveOpenRange(ctx(1));
    expect(storedReach(foe, hero)).toBeNull();
  });
  test('Withdraw breaks the engagement: a closed-in range does not survive it', async () => {
    await resolveCloseRange(ctx(3));
    await resolveWithdraw({ attacker: foe, defender: hero });
    expect(storedReach(foe, hero)).toBeNull();
  });
  test('with the rule off, Close Range changes nothing', async () => {
    game.settings.get = () => false;
    await resolveCloseRange(ctx(3));
    expect(storedReach(foe, hero)).toBeNull();
  });
});
