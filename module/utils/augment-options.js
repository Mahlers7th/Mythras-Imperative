/**
 * mythras-imperative/module/utils/augment-options.js
 *
 * What a roll can be augmented by: the roller's own passions, the roller's
 * own skills, or an ally's aid. Pure, so the roll dialog, the roll and the
 * chat card all read one list and the tests can build it from plain objects.
 *
 * Rules (Destined pp.48, 53-54, the same in Core p51):
 *   - A Passion augments by 1/5 of its value, a skill by 20% of its value.
 *     Critical and fumble ranges stay those of the unaugmented skill.
 *   - "The active skill can only be Augmented by a single other skill", and
 *     aid "is treated as Augmenting as normal", so all three kinds share ONE
 *     choice per roll. Aid does not stack with the roller's own passion
 *     (Chris, 2026-10-07).
 *   - Aid uses 20% of the ALLY's rating in the skill being rolled. The ally
 *     must have the skill; whether they are close enough to help is the GM's
 *     call. In combat, aid costs the ally 1 Action Point.
 */

import { SKILL_ITEM_TYPES } from './skill-math.js';
import { roundUp } from './rounding.js';

/** 20% of a rating, rounded up (Core p51: a Locale of 33% augments by 7%). */
export function augmentBonus(total) {
  return roundUp((Number(total) || 0) * 0.2);
}

/**
 * The name a skill, combat style or passion is shown under.
 *
 * A passion is labelled by its item name. Its `verb`/`target` fields default
 * to "Love" and "", and players name passions in the item name ("Follow my
 * Guild"), so building the label from verb + target made every passion read
 * "Love" (until v1.4.366). verb + target is kept only as a fallback for an
 * unnamed item.
 */
export function itemLabel(item) {
  if (item?.name) return item.name;
  const sys = item?.system ?? {};
  if (!sys.verb) return '';
  return sys.target ? `${sys.verb} (${sys.target})` : sys.verb;
}

const byLabel = (a, b) => a.label.localeCompare(b.label);

/**
 * Build the augment choices for one roll.
 *
 * @param {object}   opts
 * @param {object}   opts.item       the skill/combat style/passion being rolled
 * @param {object[]} opts.ownItems   the roller's items
 * @param {object[]} [opts.allies]   other player characters who might aid
 * @param {(actor: object) => number|null} [opts.allyActionPoints]
 *        an ally's current Action Points if they are in the active combat,
 *        otherwise null (no AP cost outside combat)
 * @returns {{passions: object[], skills: object[], aid: object[]}}
 *        Each option: { id, kind, label, bonus, disabled, helper?, apCost }
 */
export function buildAugmentOptions({ item, ownItems = [], allies = [], allyActionPoints = () => null }) {
  const others = ownItems.filter(i => i !== item && i.id !== item?.id);

  const passions = others
    .filter(i => i.type === 'passion')
    .map(i => ({
      id: `passion:${i.id}`, kind: 'passion', label: itemLabel(i),
      bonus: augmentBonus(i.system?.total), disabled: false, apCost: false,
    }))
    .sort(byLabel);

  const skills = others
    .filter(i => SKILL_ITEM_TYPES.includes(i.type) && i.type !== 'passion')
    .map(i => ({
      id: `skill:${i.id}`, kind: 'skill', label: itemLabel(i),
      bonus: augmentBonus(i.system?.total), disabled: false, apCost: false,
    }))
    .sort(byLabel);

  // Aid is help with the same task, so it needs the same skill. A passion
  // is the hero's own conviction and cannot be lent.
  const aid = [];
  if (item && item.type !== 'passion') {
    for (const ally of allies) {
      const theirs = Array.from(ally.items ?? [])
        .find(i => i.type === item.type && i.name === item.name);
      if (!theirs) continue;
      const ap = allyActionPoints(ally);
      const inCombat = ap !== null && ap !== undefined;
      aid.push({
        id: `aid:${ally.uuid ?? ally.id}`, kind: 'aid',
        label: `${ally.name}: ${itemLabel(theirs)}`,
        helper: ally.name, helperUuid: ally.uuid ?? null,
        bonus: augmentBonus(theirs.system?.total),
        apCost: inCombat,
        // In combat the aid costs an Action Point, so an ally with none left
        // cannot give it.
        disabled: inCombat && ap <= 0,
      });
    }
    aid.sort(byLabel);
  }

  return { passions, skills, aid };
}

/** Every option from buildAugmentOptions, flattened, for lookup by id. */
export function flattenAugmentOptions(groups) {
  return [...groups.passions, ...groups.skills, ...groups.aid];
}

/** The chat card pill for a chosen augment. */
export function augmentPill(augment) {
  if (!augment) return '';
  if (augment.kind === 'aid') {
    return `Aided by ${augment.label} +${augment.bonus}%${augment.apSpent ? ' (1 AP)' : ''}`;
  }
  return `${augment.label} +${augment.bonus}%`;
}
