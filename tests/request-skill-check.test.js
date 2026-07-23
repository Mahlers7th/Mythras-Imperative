/**
 * tests/request-skill-check.test.js
 *
 * Jest tests for `requestSkillCheck` (system-batch-request-skill-check-prompt.md),
 * the new game.system.api entry point: "target rolls a skill, tell me the
 * grade." Lives in mythras.mjs, which is not import-safe under Jest (it
 * top-level-imports ApplicationV2 sheet classes that require real Foundry
 * globals at class-definition time) -- so, matching the established
 * convention (see tests/extension-hooks.test.js's header), the pure/testable
 * seams are re-implemented here byte-for-faithful, and the genuinely pure
 * grading primitives (determineOutcome, applyDifficulty) are imported for
 * real rather than mirrored.
 *
 * NOT tested here (matches the prompt's own instruction not to build
 * elaborate scaffolding to fake it): the Dialog-rendering half of the new
 * `seType: 'skillCheck'` case in helpers.js, and the CombatSocket routing
 * branches (semi+non-GM-mode / semi+GM-mode) -- both are Foundry-coupled and
 * verified live instead.
 */

import { determineOutcome, applyDifficulty } from '../module/utils/roll-math.js';

// ---------------------------------------------------------------------------
// Mirror of requestSkillCheck's skillNames -> skillOptions resolution
// (mythras.mjs, ~L577-590 as of this batch). Takes an injectable
// applyFatigueToSkillFn in place of the real applyFatigueToSkillSE (imported
// from effects/helpers.js in the real function) so fatigue adjustment can be
// asserted without a real actor/CONFIG.MYTHRAS.fatigueLevels.
// ---------------------------------------------------------------------------
function buildSkillOptions(actor, skillNames, applyFatigueToSkillFn) {
  const skillOptions = [];
  if (!actor) return skillOptions;
  for (const name of skillNames) {
    const item = Array.from(actor.items ?? []).find(i => i.type === 'skill' && i.name === name);
    if (!item) continue;
    const rawTotal = item.system.total ?? 0;
    skillOptions.push({ name, rawTotal, total: applyFatigueToSkillFn(rawTotal, actor) });
  }
  return skillOptions;
}

const NO_SKILL_RESULT = {
  chosenSkillName: null, chosenSkillTotal: null, chosenSkillRaw: null,
  roll: null, grade: null, succeeds: false,
  cancelled: true, gmOverride: false, reason: 'no-skill'
};

/** Mirror of requestSkillCheck's actor/skill-resolution guard clauses. */
function resolveOrNoSkill(actor, skillNames, applyFatigueToSkillFn) {
  if (!actor) return NO_SKILL_RESULT;
  const skillOptions = buildSkillOptions(actor, skillNames, applyFatigueToSkillFn);
  if (skillOptions.length === 0) return NO_SKILL_RESULT;
  return skillOptions;
}

// ---------------------------------------------------------------------------
// Mirror of the grading step shared by the manual/full auto-roll branch and
// the runSEDialog 'skillCheck' case's per-button callback: apply difficulty,
// grade via the real determineOutcome, derive a plain succeeds boolean.
// ---------------------------------------------------------------------------
function gradeChoice(rollTotal, skillTotal, difficulty) {
  const target   = difficulty ? applyDifficulty(skillTotal, difficulty) : skillTotal;
  const grade    = determineOutcome(rollTotal, target, skillTotal);
  const succeeds = grade === 'critical' || grade === 'success';
  return { target, grade, succeeds };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
function makeSkillItem(name, total) {
  return { type: 'skill', name, system: { total } };
}
function makeActor(items = []) {
  return { items };
}

// =============================================================================
// skillNames -> skillOptions resolution
// =============================================================================

describe('buildSkillOptions', () => {
  test('present skills resolve with rawTotal and (unadjusted) total', () => {
    const actor = makeActor([makeSkillItem('Endurance', 65)]);
    const identity = (raw) => raw; // no fatigue penalty
    expect(buildSkillOptions(actor, ['Endurance'], identity)).toEqual([
      { name: 'Endurance', rawTotal: 65, total: 65 }
    ]);
  });

  test('absent skill names are skipped, not errored', () => {
    const actor = makeActor([makeSkillItem('Endurance', 65)]);
    const identity = (raw) => raw;
    expect(buildSkillOptions(actor, ['Willpower', 'Endurance'], identity)).toEqual([
      { name: 'Endurance', rawTotal: 65, total: 65 }
    ]);
  });

  test('order of skillNames is preserved in the output, not item order', () => {
    const actor = makeActor([makeSkillItem('Endurance', 65), makeSkillItem('Athletics', 40)]);
    const identity = (raw) => raw;
    expect(buildSkillOptions(actor, ['Athletics', 'Endurance'], identity).map(o => o.name))
      .toEqual(['Athletics', 'Endurance']);
  });

  test('fatigue adjustment is applied to total but rawTotal stays the pre-adjustment value', () => {
    const actor = makeActor([makeSkillItem('Endurance', 80)]);
    const halve = (raw) => Math.ceil(raw * 0.5); // stand-in for a 'hard' fatigue grade
    expect(buildSkillOptions(actor, ['Endurance'], halve)).toEqual([
      { name: 'Endurance', rawTotal: 80, total: 40 }
    ]);
  });

  test('missing system.total defaults to 0 rather than throwing', () => {
    const actor = makeActor([{ type: 'skill', name: 'Endurance', system: {} }]);
    const identity = (raw) => raw;
    expect(buildSkillOptions(actor, ['Endurance'], identity)).toEqual([
      { name: 'Endurance', rawTotal: 0, total: 0 }
    ]);
  });

  test('null/undefined actor does not throw, returns []', () => {
    const identity = (raw) => raw;
    expect(() => buildSkillOptions(null, ['Endurance'], identity)).not.toThrow();
    expect(buildSkillOptions(null, ['Endurance'], identity)).toEqual([]);
    expect(buildSkillOptions(undefined, ['Endurance'], identity)).toEqual([]);
  });

  test('actor with no items does not throw, returns []', () => {
    const actor = { items: [] };
    const identity = (raw) => raw;
    expect(() => buildSkillOptions(actor, ['Endurance'], identity)).not.toThrow();
    expect(buildSkillOptions(actor, ['Endurance'], identity)).toEqual([]);
  });

  test('actor with items missing entirely (no .items field) does not throw', () => {
    const actor = {};
    const identity = (raw) => raw;
    expect(() => buildSkillOptions(actor, ['Endurance'], identity)).not.toThrow();
    expect(buildSkillOptions(actor, ['Endurance'], identity)).toEqual([]);
  });
});

// =============================================================================
// The documented no-skill result and the actor guard
// =============================================================================

describe('resolveOrNoSkill', () => {
  test('null actor -> the documented no-skill result, no throw', () => {
    const identity = (raw) => raw;
    expect(() => resolveOrNoSkill(null, ['Endurance'], identity)).not.toThrow();
    expect(resolveOrNoSkill(null, ['Endurance'], identity)).toEqual(NO_SKILL_RESULT);
  });

  test('none of the named skills exist -> the documented no-skill result, no throw', () => {
    const actor = makeActor([makeSkillItem('Athletics', 40)]);
    const identity = (raw) => raw;
    expect(() => resolveOrNoSkill(actor, ['Endurance', 'Willpower'], identity)).not.toThrow();
    expect(resolveOrNoSkill(actor, ['Endurance', 'Willpower'], identity)).toEqual(NO_SKILL_RESULT);
  });

  test('no-skill result is clearly marked cancelled with a reason, not a 0% skill', () => {
    expect(NO_SKILL_RESULT.cancelled).toBe(true);
    expect(NO_SKILL_RESULT.reason).toBe('no-skill');
    expect(NO_SKILL_RESULT.chosenSkillTotal).toBeNull();
  });

  test('at least one named skill exists -> returns skillOptions, not the no-skill result', () => {
    const actor = makeActor([makeSkillItem('Endurance', 65)]);
    const identity = (raw) => raw;
    const result = resolveOrNoSkill(actor, ['Willpower', 'Endurance'], identity);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([{ name: 'Endurance', rawTotal: 65, total: 65 }]);
  });
});

// =============================================================================
// Grading: difficulty applied before grading, succeeds derived from grade
// =============================================================================

describe('gradeChoice', () => {
  test('no difficulty -> grades against the raw skill total unchanged', () => {
    // determineOutcome(50, 50, 50) === 'success' (roll-math.test.js line 71)
    expect(gradeChoice(50, 50, null)).toEqual({ target: 50, grade: 'success', succeeds: true });
  });

  test('difficulty is applied via applyDifficulty before grading, not after', () => {
    // applyDifficulty(60, 'hard') === 45 (roll-math.test.js line 31)
    // determineOutcome(50, 45, 60) -> 50 > 45 -> 'failure'
    const result = gradeChoice(50, 60, 'hard');
    expect(result.target).toBe(45);
    expect(result.grade).toBe('failure');
    expect(result.succeeds).toBe(false);
  });

  test('an easy difficulty can turn what would be a failure into a success', () => {
    // applyDifficulty(60, 'easy') === 90; determineOutcome(70, 90, 60) -> 'success'
    const result = gradeChoice(70, 60, 'easy');
    expect(result.target).toBe(90);
    expect(result.grade).toBe('success');
    expect(result.succeeds).toBe(true);
  });

  test.each([
    ['critical', 5,   50, true],
    ['success',  50,  50, true],
    ['failure',  51,  50, false],
    ['fumble',   100, 50, false],
  ])('grade %s -> succeeds %s', (expectedGrade, roll, skill, expectedSucceeds) => {
    const result = gradeChoice(roll, skill, null);
    expect(result.grade).toBe(expectedGrade);
    expect(result.succeeds).toBe(expectedSucceeds);
  });

  test('fumble at a raw skill >= 100 requires a natural 100, not 99 (matches determineOutcome)', () => {
    // determineOutcome(99, 100, 100) === 'success' (roll-math.test.js line 80)
    expect(gradeChoice(99, 100, null).grade).toBe('success');
    expect(gradeChoice(100, 100, null).grade).toBe('fumble');
  });
});
