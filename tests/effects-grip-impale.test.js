/**
 * tests/effects-grip-impale.test.js — Grip and Impale, including their
 * break-free / lodge / yank follow-ups, against tests/helpers/fake-foundry.js.
 * Run in full automation so no dialog is involved; dice are scripted.
 *
 * The follow-ups are where "removing state never worked" bit (v1.4.363): a
 * successful break-free or yank has to actually take the entry off.
 */
import { installFoundry, makeActor, makeSwarmTokens } from './helpers/fake-foundry.js';
import { resolveGrip, resolveGripBreakFree } from '../module/combat/effects/grip.js';
import { resolveImpale, applyImpaleLodge, resolveImpaleYank } from '../module/combat/effects/impale.js';

const NS = 'mythras-imperative';
const flag = (a, k) => a.getFlag(NS, k);
const entries = (a, k) => Object.entries(flag(a, k) ?? {});
const skill = (name, total) => ({ name, type: 'skill', system: { total } });

let hero, swarm;
function setup(rolls = []) {
  hero = makeActor({ name: 'Hargrim', items: [
    skill('Brawn', 40), skill('Unarmed', 40),
    { id: 'halberd', name: 'Halberd', type: 'weapon', system: { category: 'melee', size: 'L', damage: '1d8+2' } },
  ] });
  swarm = makeSwarmTokens(3, { items: [
    skill('Brawn', 60),
    { id: 'rleg', name: 'Right Leg', type: 'hit-location', system: { hp: 5, current: 5 } },
  ] });
  for (const s of swarm) s.system.characteristics = { siz: { value: 10 } };
  installFoundry({ actors: [hero, ...swarm], settings: { automationLevel: 'full' }, rolls });
}
/** The dataset a card button carries, as the impale decision card builds it. */
const impaleBtn = (entryId, entry, attacker) => ({ dataset: {
  attackerId: attacker.uuid, defenderId: entry.defenderId, weaponId: entry.weaponId, impaleEntryId: entryId,
  gradeId: entry.gradeId, hitLocationId: entry.hitLocationId, hitLocationLabel: entry.hitLocationLabel,
  halfDmgFormula: entry.halfDmgFormula, attackerSkillTotal: String(entry.attackerSkillTotal ?? 0),
} });

describe('Grip', () => {
  beforeEach(() => setup());
  test('grips the struck swarm token only, naming the gripper by token', async () => {
    await resolveGrip({ attacker: hero, defender: swarm[1], attackResult: 20, chatMessageId: null }, 0, false);
    const [[, e]] = entries(swarm[1], 'grippedBy');
    expect(e.gripperActorId).toBe(hero.uuid);
    expect(entries(swarm[1], 'pendingGripCheck')).toHaveLength(1);
    expect(flag(swarm[0], 'grippedBy')).toBeUndefined();
    expect(flag(swarm[2], 'grippedBy')).toBeUndefined();
  });
});

describe('Grip — breaking free', () => {
  async function gripThenBreak(rolls) {
    setup(rolls);
    await resolveGrip({ attacker: hero, defender: swarm[1], attackResult: 20, chatMessageId: null }, 0, false);
    const [[id, e]] = entries(swarm[1], 'grippedBy');
    await swarm[1].update({ [`flags.${NS}.pendingGripCheck`]: null });   // turn start clears, then dispatches
    await resolveGripBreakFree(swarm[1], e, id);
    return id;
  }
  test('a won contest ENDS the grip (it used to stay: setFlag merges)', async () => {
    await gripThenBreak([95, 10]);   // gripper fails, swarm succeeds
    expect(entries(swarm[1], 'grippedBy')).toHaveLength(0);
  });
  test('a lost contest keeps the grip and queues another try', async () => {
    await gripThenBreak([10, 95]);   // gripper succeeds, swarm fails
    expect(entries(swarm[1], 'grippedBy')).toHaveLength(1);
    expect(entries(swarm[1], 'pendingGripCheck')).toHaveLength(1);
  });
});

describe('Impale', () => {
  beforeEach(() => setup());
  const impale = () => resolveImpale({ attacker: hero, defender: swarm[1], weapon: hero.items.get('halberd'),
    hitLocationId: 'rleg', hitLocationLabel: 'Right Leg', attackerSkillTotal: 70, chatMessageId: null }, 6);

  test('the weapon lodges in the struck token; the wielder gets a pending decision', async () => {
    await impale();
    const [[id, lodged]] = entries(swarm[1], 'impaledBy');
    expect(lodged.attackerId).toBe(hero.uuid);
    const [[pid, pending]] = entries(hero, 'pendingImpales');
    expect(pid).toBe(id);
    expect(pending.defenderId).toBe(swarm[1].uuid);
    expect(flag(swarm[0], 'impaledBy')).toBeUndefined();
  });
  test('leaving it lodged clears the pending decision, keeps the weapon in', async () => {
    await impale();
    const [[id, pending]] = entries(hero, 'pendingImpales');
    await applyImpaleLodge(impaleBtn(id, pending, hero));
    expect(entries(hero, 'pendingImpales')).toHaveLength(0);
    expect(entries(swarm[1], 'impaledBy')).toHaveLength(1);
  });
});

describe('Impale — yanking it out', () => {
  async function impaleThenYank(rolls) {
    setup(rolls);
    await resolveImpale({ attacker: hero, defender: swarm[1], weapon: hero.items.get('halberd'),
      hitLocationId: 'rleg', hitLocationLabel: 'Right Leg', attackerSkillTotal: 70, chatMessageId: null }, 6);
    const [[id, pending]] = entries(hero, 'pendingImpales');
    await resolveImpaleYank(impaleBtn(id, pending, hero));
  }
  test('a successful yank frees the target and deals the yank damage', async () => {
    await impaleThenYank([10, 95, 4]);   // wielder succeeds, swarm fails to resist, yank damage 4
    expect(entries(swarm[1], 'impaledBy')).toHaveLength(0);
    expect(entries(hero, 'pendingImpales')).toHaveLength(0);
    expect(swarm[1].items.get('rleg').system.current).toBe(3);   // half of 4, rounded up
    expect(swarm[0].items.get('rleg').system.current).toBe(5);   // sibling untouched
  });
  test('a failed yank leaves it lodged and re-queues the decision', async () => {
    await impaleThenYank([95, 10]);   // wielder fails, swarm resists
    expect(entries(swarm[1], 'impaledBy')).toHaveLength(1);
    expect(entries(hero, 'pendingImpales')).toHaveLength(1);
  });
});
