/**
 * tests/augment-options.test.js
 *
 * Jest tests for module/utils/augment-options.js (v1.4.366): the roll
 * dialog's single Augment choice -- the roller's passions, the roller's
 * skills, or an ally's aid.
 *
 * Rules (Destined pp.48, 53-54): a Passion adds 1/5 of its value, a skill
 * 20% of its value; only one augment per roll, and aid "is treated as
 * Augmenting as normal", so it shares that one slot (Chris, 2026-10-07: aid
 * does not stack with a passion). Aid uses the ALLY's rating and costs them
 * 1 Action Point in combat.
 */

import {
  augmentBonus, itemLabel, buildAugmentOptions, flattenAugmentOptions, augmentPill,
} from '../module/utils/augment-options.js';

const item = (id, type, name, total, extra = {}) =>
  ({ id, type, name, system: { total, ...extra } });

const actor = (id, name, items) => ({ id, uuid: `Actor.${id}`, name, items });

describe('itemLabel', () => {
  test('a passion is labelled by its item name, not by the default "Love" verb', () => {
    // The bug: verb defaults to "Love" and players never set it, so every
    // passion in the dropdown read "Love".
    const p = item('p1', 'passion', 'Follow my Guild', 40, { verb: 'Love', target: '' });
    expect(itemLabel(p)).toBe('Follow my Guild');
  });

  test('verb + target is the fallback for an unnamed passion', () => {
    expect(itemLabel({ name: '', system: { verb: 'Loyalty', target: 'the Standing Ones' } }))
      .toBe('Loyalty (the Standing Ones)');
    expect(itemLabel({ name: '', system: { verb: 'Hate', target: '' } })).toBe('Hate');
    expect(itemLabel({ name: '', system: {} })).toBe('');
  });
});

describe('augmentBonus', () => {
  test('20%, rounded up (Core p51: 33% augments by 7%)', () => {
    expect(augmentBonus(33)).toBe(7);
    expect(augmentBonus(54)).toBe(11);
    expect(augmentBonus(64)).toBe(13);
    expect(augmentBonus(50)).toBe(10);
  });

  test('missing or non-numeric totals augment by 0', () => {
    expect(augmentBonus(undefined)).toBe(0);
    expect(augmentBonus(null)).toBe(0);
    expect(augmentBonus('x')).toBe(0);
  });
});

describe('buildAugmentOptions', () => {
  const athletics  = item('s1', 'skill', 'Athletics', 60);
  const perception = item('s2', 'skill', 'Perception', 72);
  const style      = item('c1', 'combat-style', 'Combat Style (Fighter)', 80);
  const guild      = item('p1', 'passion', 'Follow my Guild', 40, { verb: 'Love' });
  const wend       = item('p2', 'passion', "Uphold Wend's Dictates", 30, { verb: 'Love' });
  const gear       = item('g1', 'gear', 'Rope', 0);
  const own        = [athletics, perception, style, guild, wend, gear];

  const hargrim  = actor('h', 'Hargrim', [item('hs', 'skill', 'Athletics', 75)]);
  const alystyr  = actor('a', 'Alystyr', [item('as', 'skill', 'Perception', 50)]);
  const sydryl   = actor('r', 'Rector Sydryl', [item('rs', 'skill', 'Athletics', 41)]);

  test('passions and skills are listed by name with their 20% bonus', () => {
    const { passions, skills } = buildAugmentOptions({ item: athletics, ownItems: own });
    expect(passions.map(o => [o.label, o.bonus])).toEqual([
      ['Follow my Guild', 8], ["Uphold Wend's Dictates", 6],
    ]);
    expect(skills.map(o => [o.label, o.bonus])).toEqual([
      ['Combat Style (Fighter)', 16], ['Perception', 15],
    ]);
  });

  test('the skill being rolled cannot augment itself, and non-skill items are ignored', () => {
    const { skills, passions } = buildAugmentOptions({ item: athletics, ownItems: own });
    const ids = [...skills, ...passions].map(o => o.id);
    expect(ids).not.toContain('skill:s1');
    expect(ids).not.toContain('skill:g1');
  });

  test('a rolled passion is not offered as its own augment', () => {
    const { passions } = buildAugmentOptions({ item: guild, ownItems: own });
    expect(passions.map(o => o.label)).toEqual(["Uphold Wend's Dictates"]);
  });

  test('aid lists only allies who have the skill being rolled, at 20% of THEIR rating', () => {
    const { aid } = buildAugmentOptions({ item: athletics, ownItems: own, allies: [hargrim, alystyr, sydryl] });
    expect(aid.map(o => [o.label, o.bonus, o.helperUuid])).toEqual([
      ['Hargrim: Athletics', 15, 'Actor.h'],
      ['Rector Sydryl: Athletics', 9, 'Actor.r'],
    ]);
  });

  test('aid matches on item type too: a combat style is aided by the same combat style', () => {
    const rival = actor('x', 'Rival', [item('xs', 'skill', 'Combat Style (Fighter)', 90)]);
    const ally  = actor('y', 'Ally',  [item('ys', 'combat-style', 'Combat Style (Fighter)', 55)]);
    const { aid } = buildAugmentOptions({ item: style, ownItems: own, allies: [rival, ally] });
    expect(aid.map(o => o.label)).toEqual(['Ally: Combat Style (Fighter)']);
  });

  test('a passion cannot be aided', () => {
    const fan = actor('f', 'Fan', [item('fp', 'passion', 'Follow my Guild', 90)]);
    expect(buildAugmentOptions({ item: guild, ownItems: own, allies: [fan] }).aid).toEqual([]);
  });

  test('outside combat aid is free; in combat it costs 1 AP and needs one to give', () => {
    const outOfCombat = buildAugmentOptions({ item: athletics, ownItems: own, allies: [hargrim] }).aid[0];
    expect(outOfCombat).toMatchObject({ apCost: false, disabled: false });

    const ap = { Hargrim: 2, 'Rector Sydryl': 0 };
    const inCombat = buildAugmentOptions({
      item: athletics, ownItems: own, allies: [hargrim, sydryl],
      allyActionPoints: a => ap[a.name] ?? null,
    }).aid;
    expect(inCombat.map(o => [o.helper, o.apCost, o.disabled])).toEqual([
      ['Hargrim', true, false],
      ['Rector Sydryl', true, true],
    ]);
  });

  test('every option has a unique id, so the dropdown resolves to one choice', () => {
    const groups = buildAugmentOptions({ item: athletics, ownItems: own, allies: [hargrim, sydryl] });
    const ids = flattenAugmentOptions(groups).map(o => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(2 + 2 + 2);
  });
});

describe('augmentPill', () => {
  test('passion and skill augments show their name and bonus', () => {
    expect(augmentPill({ kind: 'passion', label: 'Follow my Guild', bonus: 8 })).toBe('Follow my Guild +8%');
    expect(augmentPill({ kind: 'skill', label: 'Perception', bonus: 15 })).toBe('Perception +15%');
  });

  test('aid names the helper, and notes the AP when it cost one', () => {
    expect(augmentPill({ kind: 'aid', label: 'Hargrim: Athletics', bonus: 15 }))
      .toBe('Aided by Hargrim: Athletics +15%');
    expect(augmentPill({ kind: 'aid', label: 'Hargrim: Athletics', bonus: 15, apSpent: true }))
      .toBe('Aided by Hargrim: Athletics +15% (1 AP)');
  });

  test('no augment, no pill', () => {
    expect(augmentPill(null)).toBe('');
  });
});
