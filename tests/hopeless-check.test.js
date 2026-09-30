/**
 * tests/hopeless-check.test.js — v1.4.364. A Hopeless requested check used to
 * be rolled against the FULL skill (applyDifficulty leaves 'hopeless' alone).
 */
import { splitHopeless, hopelessResult } from '../module/utils/hopeless-check.js';
import { applyDifficulty, determineOutcome } from '../module/utils/roll-math.js';

const opt = (name, grade, total = 60) => ({ name, grade, total, rawTotal: total });

test('why a target of 0 would not do: 01-05 still succeed', () => {
  expect(applyDifficulty(60, 'hopeless')).toBe(60);             // the old path: full skill
  expect(determineOutcome(3, 0)).toBe('success');               // and 0 still lets 01-05 through
});

test('Hopeless skills are not offered; the rest are', () => {
  const { playable, allHopeless } = splitHopeless([opt('Brawn', 'hopeless'), opt('Athletics', 'hard')]);
  expect(playable.map(o => o.name)).toEqual(['Athletics']);
  expect(allHopeless).toBe(false);
});

test('every skill Hopeless: the check cannot be attempted', () => {
  expect(splitHopeless([opt('Brawn', 'hopeless'), opt('Endurance', 'hopeless')]).allHopeless).toBe(true);
});

test('no options is "no skill", not Hopeless', () => {
  expect(splitHopeless([]).allHopeless).toBe(false);
});

test('the result is a failure with no roll, in the usual shape', () => {
  expect(hopelessResult(opt('Brawn', 'hopeless', 40))).toEqual({
    chosenSkillName: 'Brawn', chosenSkillTotal: 40, chosenSkillRaw: 40,
    roll: null, grade: 'failure', succeeds: false, cancelled: false, gmOverride: false, reason: 'hopeless',
  });
});
