/**
 * tests/condition-grade.test.js
 *
 * Jest tests for module/utils/condition-grade.js (seam 2, Step 1), plus
 * regression coverage for Step 2's delegation of Population A/B call sites
 * to it (helpers.js's applyFatigueToSkill, CombatEngine's
 * _resolveDefenceSkill and _getConditionFloorGrade).
 *
 * CombatEngine.js itself cannot be imported under Jest (too Foundry-
 * coupled — same reason no other test file in this repo imports it), so
 * CombatEngine's two delegated methods are still covered via hand-written
 * mirrors, not direct import. helpers.js IS importable (no Foundry access
 * at module scope), so its delegated applyFatigueToSkill is tested via a
 * REAL import, against an independent mirror of its pre-Step-2 inline body
 * — comparing the real function to the exact expression it now literally
 * is would be a tautology, so the mirror preserves independent ground
 * truth. This file does three things:
 *   1. Unit-tests getConditionGrade/applyGradeToSkill directly, against
 *      real fake-actor fixtures, importing the REAL underlying getters
 *      (getFatigueSkillGrade, getActiveImpaleGrade, getActiveEntangleGrade,
 *      getActiveBlindGrade) rather than mirroring them.
 *   2. Mirrors the composition/orchestration logic that lived inline in
 *      CombatEngine.js's _getConditionFloorGrade and _resolveDefenceSkill,
 *      and in helpers.js's applyFatigueToSkill, before each was delegated
 *      to this file's composer — built from the same real getters, kept
 *      as independent ground truth even after the delegation.
 *   3. Asserts getConditionGrade + applyGradeToSkill produce IDENTICAL
 *      numeric results to each of those three pre-delegation composers
 *      across a battery of scenarios, AND (for helpers.js, the one that's
 *      actually importable) that the real post-delegation production
 *      function still matches — the "zero behaviour change" claim
 *      verified end to end, not just at the composer boundary.
 *
 * CONFIG.MYTHRAS is the REAL config object (config.js has no Foundry
 * dependency beyond the bare DIFFICULTY_GRADES import, and imports
 * cleanly under Jest), stubbed onto globalThis.CONFIG per this project's
 * own documented testing convention (system-CLAUDE.md's "mocked Foundry
 * globals... CONFIG.MYTHRAS" step).
 */

import { getConditionGrade, applyGradeToSkill, CONDITION_GRADE_ORDER } from '../module/utils/condition-grade.js';
import { getFatigueSkillGrade, applyFatigueToSkill as applyFatigueOnly } from '../module/utils/fatigue.js';
import {
  getActiveImpaleGrade, getActiveEntangleGrade, getActiveBlindGrade,
  applyFatigueToSkill as applyFatigueImpaleEntangle,
} from '../module/combat/effects/helpers.js';
import { MYTHRAS } from '../module/config/config.js';

globalThis.CONFIG = { MYTHRAS };

// ---------------------------------------------------------------------------
// Fake actor fixture — only the surface these functions actually touch:
// system.fatigue, statuses.has(), getFlag(scope, key).
// ---------------------------------------------------------------------------
function makeActor({ fatigue = 'fresh', prone = false, flags = {} } = {}) {
  return {
    system: { fatigue },
    statuses: { has: (s) => (s === 'prone' ? prone : false) },
    getFlag: (_scope, key) => flags[key],
  };
}

// ---------------------------------------------------------------------------
// Mirrors of the two CombatEngine composers this file cannot import,
// built from the REAL getters above — faithful to CombatEngine.js as of
// the seam 2 Step 1 anchor re-verification (see condition-grade.js's own
// header comment for the exact line-by-line trace).
// ---------------------------------------------------------------------------

/** Mirror of CombatEngine._getConditionFloorGrade. */
function mirrorConditionFloorGrade(actor) {
  if (!actor) return 'standard';
  let worstIdx = CONDITION_GRADE_ORDER.indexOf('standard');
  const floor = (g) => { if (!g) return; const i = CONDITION_GRADE_ORDER.indexOf(g); if (i > worstIdx) worstIdx = i; };
  floor(getFatigueSkillGrade(actor));
  if (actor.statuses?.has?.('prone')) floor('formidable');
  const imp = getActiveImpaleGrade(actor);
  if (imp && imp !== 'none' && imp !== 'incapacitated') floor(imp);
  floor(getActiveEntangleGrade(actor));
  floor(getActiveBlindGrade(actor));
  return CONDITION_GRADE_ORDER[worstIdx];
}

/**
 * Mirror of helpers.js applyFatigueToSkill's PRE-Step-2 inline body
 * (fatigue+impale+entangle, worst-of grade-space). Kept as an independent
 * ground truth after Step 2 delegated the real function's body to
 * getConditionGrade+applyGradeToSkill — without this, the "parity with
 * helpers.js applyFatigueToSkill" block below would compare the real
 * function against the exact expression it now literally is, which
 * proves nothing. This mirror is what makes that comparison meaningful.
 */
function mirrorApplyFatigueImpaleEntangle(raw, actor) {
  if (!actor) return raw;
  let worstIdx = CONDITION_GRADE_ORDER.indexOf('standard');
  const floor = (g) => { if (!g) return; const i = CONDITION_GRADE_ORDER.indexOf(g); if (i > worstIdx) worstIdx = i; };
  floor(getFatigueSkillGrade(actor));
  const imp = getActiveImpaleGrade(actor);
  if (imp && imp !== 'none' && imp !== 'incapacitated') floor(imp);
  floor(getActiveEntangleGrade(actor));
  const gradeDef = MYTHRAS.difficultyGrades[CONDITION_GRADE_ORDER[worstIdx]];
  if (!gradeDef) return raw;
  if (gradeDef.multiplier === null) return 0;
  return Math.max(0, Math.ceil(raw * gradeDef.multiplier));
}

/** Mirror of CombatEngine._resolveDefenceSkill's PRE-Step-2 fatigue+prone composition (raw -> effective total). */
function mirrorResolveDefenceSkill(raw, actor) {
  const afterFatigue = mirrorApplyFatigueImpaleEntangle(raw, actor);
  const isProne = actor.statuses?.has?.('prone') ?? false;
  if (!isProne) return afterFatigue;
  const formidableDef = MYTHRAS.difficultyGrades['formidable'];
  if (!formidableDef || formidableDef.multiplier === null) return afterFatigue;
  const proneResult = Math.max(0, Math.ceil(raw * formidableDef.multiplier));
  return Math.min(afterFatigue, proneResult);
}

// =============================================================================
// getConditionGrade
// =============================================================================

describe('getConditionGrade', () => {
  test('no actor: standard', () => {
    expect(getConditionGrade(null, 'defence')).toBe('standard');
  });

  test('no active conditions, any role: standard', () => {
    const a = makeActor();
    expect(getConditionGrade(a, 'attack')).toBe('standard');
    expect(getConditionGrade(a, 'defence')).toBe('standard');
    expect(getConditionGrade(a, 'resist')).toBe('standard');
  });

  test('fatigue alone floors every role identically', () => {
    const a = makeActor({ fatigue: 'wearied' }); // skillGrade: 'formidable'
    expect(getConditionGrade(a, 'attack')).toBe('formidable');
    expect(getConditionGrade(a, 'defence')).toBe('formidable');
    expect(getConditionGrade(a, 'resist')).toBe('formidable');
  });

  test('impale floors every role identically', () => {
    const a = makeActor({ flags: { impaledBy: { x: { gradeId: 'herculean' } } } });
    expect(getConditionGrade(a, 'attack')).toBe('herculean');
    expect(getConditionGrade(a, 'defence')).toBe('herculean');
    expect(getConditionGrade(a, 'resist')).toBe('herculean');
  });

  test('entangle floors every role identically', () => {
    const a = makeActor({ flags: { entangledBy: { x: { gradeHard: true } } } });
    expect(getConditionGrade(a, 'attack')).toBe('hard');
    expect(getConditionGrade(a, 'defence')).toBe('hard');
    expect(getConditionGrade(a, 'resist')).toBe('hard');
  });

  test('prone floors attack and defence to at least formidable, NOT resist', () => {
    const a = makeActor({ prone: true });
    expect(getConditionGrade(a, 'attack')).toBe('formidable');
    expect(getConditionGrade(a, 'defence')).toBe('formidable');
    expect(getConditionGrade(a, 'resist')).toBe('standard'); // prone does not reach resist
  });

  test('blind floors attack AND defence (Step 3 fix), NOT resist', () => {
    const a = makeActor({ flags: { blindedBy: { turnsRemaining: 2, grade: 'formidable' } } });
    expect(getConditionGrade(a, 'attack')).toBe('formidable');
    expect(getConditionGrade(a, 'defence')).toBe('formidable'); // the gap, closed
    expect(getConditionGrade(a, 'resist')).toBe('standard'); // still excluded — not an SE resistance-roll floor
  });

  test('expired blind is ignored for both attack and defence', () => {
    const a = makeActor({ flags: { blindedBy: { turnsRemaining: 0, grade: 'formidable' } } });
    expect(getConditionGrade(a, 'attack')).toBe('standard');
    expect(getConditionGrade(a, 'defence')).toBe('standard');
  });

  test("'attack' and 'defence' are numerically identical post-Step-3, across every floor", () => {
    const scenarios = [
      {},
      { fatigue: 'wearied' },
      { prone: true },
      { flags: { impaledBy: { x: { gradeId: 'herculean' } } } },
      { flags: { entangledBy: { x: { gradeHard: true } } } },
      { flags: { blindedBy: { turnsRemaining: 2, grade: 'formidable' } } },
      {
        fatigue: 'tired', prone: true,
        flags: {
          impaledBy: { x: { gradeId: 'hard' } },
          entangledBy: { x: { gradeHard: true } },
          blindedBy: { turnsRemaining: 1, grade: 'herculean' },
        },
      },
    ];
    for (const opts of scenarios) {
      const a = makeActor(opts);
      expect(getConditionGrade(a, 'defence')).toBe(getConditionGrade(a, 'attack'));
    }
  });

  test('worst-of composition across multiple simultaneous conditions', () => {
    const a = makeActor({
      fatigue: 'winded', // hard
      prone: true,       // formidable
      flags: { entangledBy: { x: { gradeHard: true } } }, // hard
    });
    // worst of hard/formidable/hard = formidable
    expect(getConditionGrade(a, 'defence')).toBe('formidable');
  });

  test('never returns easier than standard even with no conditions', () => {
    const a = makeActor({ fatigue: 'fresh' });
    expect(CONDITION_GRADE_ORDER.indexOf(getConditionGrade(a, 'attack')))
      .toBeGreaterThanOrEqual(CONDITION_GRADE_ORDER.indexOf('standard'));
  });

  test('incapacitated impale is excluded from the floor, matching getActiveImpaleGrade\'s own contract', () => {
    // Mirrors the existing exclusion in both _getConditionFloorGrade and
    // helpers.js's own applyFatigueToSkill — 'incapacitated' impale is
    // deliberately not folded in as a skill-check floor.
    const a = makeActor({ flags: { impaledBy: { x: { gradeId: 'incapacitated' } } } });
    expect(getConditionGrade(a, 'defence')).toBe('standard');
  });
});

// =============================================================================
// conditionGradeHooks (Step 4)
// =============================================================================

describe('conditionGradeHooks', () => {
  afterEach(() => {
    CONFIG.MYTHRAS.conditionGradeHooks.length = 0;
  });

  test('no hooks registered: unchanged from Step 1-3 behaviour', () => {
    const a = makeActor();
    expect(getConditionGrade(a, 'attack')).toBe('standard');
  });

  test('a single positive hook shifts the composed floor harder', () => {
    const a = makeActor(); // composed floor: standard (index 2)
    CONFIG.MYTHRAS.conditionGradeHooks.push(() => 2);
    expect(getConditionGrade(a, 'attack')).toBe('formidable'); // index 2+2=4
  });

  test('a single negative hook shifts the composed floor easier, below the floor getConditionGrade would otherwise return', () => {
    const a = makeActor({ fatigue: 'winded' }); // composed floor: hard (index 3)
    CONFIG.MYTHRAS.conditionGradeHooks.push(() => -1);
    expect(getConditionGrade(a, 'attack')).toBe('standard'); // index 3-1=2
  });

  test('multiple hooks are summed, not last-wins or first-wins', () => {
    const a = makeActor(); // standard, index 2
    CONFIG.MYTHRAS.conditionGradeHooks.push(() => 1, () => 1, () => -1);
    // 2 + (1+1-1) = 3 -> 'hard'
    expect(getConditionGrade(a, 'attack')).toBe('hard');
  });

  test('clamps at the top of the table (hopeless), never overflows', () => {
    const a = makeActor({ prone: true }); // formidable, index 4
    CONFIG.MYTHRAS.conditionGradeHooks.push(() => 99);
    expect(getConditionGrade(a, 'attack')).toBe('hopeless');
  });

  test('clamps at the bottom of the table (veryEasy), never underflows', () => {
    const a = makeActor(); // standard, index 2
    CONFIG.MYTHRAS.conditionGradeHooks.push(() => -99);
    expect(getConditionGrade(a, 'attack')).toBe('veryEasy');
  });

  test('receives (actor, role) exactly as documented', () => {
    const a = makeActor();
    const calls = [];
    CONFIG.MYTHRAS.conditionGradeHooks.push((actor, role) => { calls.push([actor, role]); return 0; });
    getConditionGrade(a, 'resist');
    expect(calls).toEqual([[a, 'resist']]);
  });

  test('a throwing hook is isolated — does not break composition or other hooks', () => {
    const a = makeActor(); // standard, index 2
    CONFIG.MYTHRAS.conditionGradeHooks.push(
      () => { throw new Error('boom'); },
      () => 1,
    );
    expect(getConditionGrade(a, 'attack')).toBe('hard'); // 2+1=3, throwing hook contributes 0
  });

  test('non-numeric return contributes 0, does not throw', () => {
    const a = makeActor();
    CONFIG.MYTHRAS.conditionGradeHooks.push(() => 'not-a-number', () => undefined);
    expect(getConditionGrade(a, 'attack')).toBe('standard');
  });

  test('a hook can implement "ignore the prone penalty" via a negative shift (the design question this seam settled)', () => {
    const a = makeActor({ prone: true }); // formidable, index 4
    CONFIG.MYTHRAS.conditionGradeHooks.push(() => -2); // e.g. a Destined "Sturdy Footing"-style power
    expect(getConditionGrade(a, 'defence')).toBe('standard'); // 4-2=2
  });
});

// =============================================================================
// applyGradeToSkill
// =============================================================================

describe('applyGradeToSkill', () => {
  test('standard grade: unchanged (multiplier 1)', () => {
    expect(applyGradeToSkill(60, 'standard')).toBe(60);
  });

  test('hard grade: matches the real DIFFICULTY_GRADES multiplier, ceiling-rounded', () => {
    const expected = Math.max(0, Math.ceil(60 * MYTHRAS.difficultyGrades.hard.multiplier));
    expect(applyGradeToSkill(60, 'hard')).toBe(expected);
  });

  test('hopeless grade: always 0, regardless of raw', () => {
    expect(applyGradeToSkill(200, 'hopeless')).toBe(0);
  });

  test('unknown grade id: raw returned unchanged rather than throwing', () => {
    expect(applyGradeToSkill(60, 'not-a-real-grade')).toBe(60);
  });

  test('never returns negative, even for a very low raw skill at a harsh grade', () => {
    expect(applyGradeToSkill(1, 'herculean')).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// Parity with the two existing composers — the actual "zero behaviour
// change" claim, not just each piece in isolation.
// =============================================================================

describe('parity with CombatEngine._getConditionFloorGrade (role: attack)', () => {
  const scenarios = [
    { name: 'clean actor', opts: {} },
    { name: 'fatigued', opts: { fatigue: 'exhausted' } },
    { name: 'prone', opts: { prone: true } },
    { name: 'impaled', opts: { flags: { impaledBy: { x: { gradeId: 'hard' } } } } },
    { name: 'entangled', opts: { flags: { entangledBy: { x: { gradeHard: true } } } } },
    { name: 'blinded', opts: { flags: { blindedBy: { turnsRemaining: 1, grade: 'hard' } } } },
    {
      name: 'everything at once',
      opts: {
        fatigue: 'tired', prone: true,
        flags: {
          impaledBy: { x: { gradeId: 'formidable' } },
          entangledBy: { x: { gradeHard: true } },
          blindedBy: { turnsRemaining: 3, grade: 'herculean' },
        },
      },
    },
  ];

  for (const { name, opts } of scenarios) {
    test(name, () => {
      const actor = makeActor(opts);
      expect(getConditionGrade(actor, 'attack')).toBe(mirrorConditionFloorGrade(actor));
    });
  }
});

describe('parity with CombatEngine._resolveDefenceSkill (role: defence, folded into grade space)', () => {
  const rawSkills = [30, 55, 91, 12];
  const scenarios = [
    { name: 'clean actor', opts: {} },
    { name: 'fatigued only', opts: { fatigue: 'winded' } },
    { name: 'prone only', opts: { prone: true } },
    { name: 'fatigued and prone, fatigue worse', opts: { fatigue: 'debilitated', prone: true } },
    { name: 'fatigued and prone, prone worse', opts: { fatigue: 'winded', prone: true } },
    {
      name: 'impaled, entangled, and prone together',
      opts: {
        prone: true,
        flags: { impaledBy: { x: { gradeId: 'herculean' } }, entangledBy: { x: { gradeHard: true } } },
      },
    },
  ];

  for (const { name, opts } of scenarios) {
    for (const raw of rawSkills) {
      test(`${name}, raw ${raw}`, () => {
        const actor = makeActor(opts);
        const oldWay = mirrorResolveDefenceSkill(raw, actor);
        const newWay = applyGradeToSkill(raw, getConditionGrade(actor, 'defence'));
        expect(newWay).toBe(oldWay);
      });
    }
  }
});

describe('parity with helpers.js applyFatigueToSkill (role: resist)', () => {
  const rawSkills = [20, 47, 88];
  const scenarios = [
    { name: 'clean actor', opts: {} },
    { name: 'fatigued', opts: { fatigue: 'wearied' } },
    { name: 'impaled', opts: { flags: { impaledBy: { x: { gradeId: 'hard' } } } } },
    { name: 'entangled', opts: { flags: { entangledBy: { x: { gradeHard: true } } } } },
    {
      name: 'prone and blinded present but must NOT affect resist',
      opts: { prone: true, flags: { blindedBy: { turnsRemaining: 2, grade: 'herculean' } } },
    },
  ];

  for (const { name, opts } of scenarios) {
    for (const raw of rawSkills) {
      test(`${name}, raw ${raw}`, () => {
        const actor = makeActor(opts);
        // oldWay: independent mirror of the pre-Step-2 inline body, NOT the
        // real function — applyFatigueImpaleEntangle now literally IS
        // applyGradeToSkill(raw, getConditionGrade(actor,'resist')), so
        // comparing against itself would be a tautology.
        const oldWay = mirrorApplyFatigueImpaleEntangle(raw, actor);
        const newWay = applyGradeToSkill(raw, getConditionGrade(actor, 'resist'));
        expect(newWay).toBe(oldWay);
        // Also confirm the REAL, now-delegated production function
        // (Step 2, Population A) still returns the same number a live
        // caller in opposed.js/bash.js/entangle.js/grip.js/impale.js would
        // have gotten before the delegation.
        expect(applyFatigueImpaleEntangle(raw, actor)).toBe(oldWay);
      });
    }
  }
});

describe('sanity: fatigue.js\'s bare applyFatigueToSkill is a stricter subset, not reproduced by any role here', () => {
  test('documents the known fourth shape (spellcasting.js) rather than silently assuming it is covered', () => {
    // spellcasting.js imports fatigue.js's OWN bare applyFatigueToSkill
    // (fatigue only, no impale/entangle) directly -- not routed through
    // this file at all, and Step 1 does not change that. Recorded here so
    // a future reader does not assume 'resist' already covers it.
    const a = makeActor({ flags: { impaledBy: { x: { gradeId: 'formidable' } } } });
    const bareFatigueOnly = applyFatigueOnly(50, a); // ignores the impale flag entirely
    const resistRole = applyGradeToSkill(50, getConditionGrade(a, 'resist')); // does not ignore it
    expect(bareFatigueOnly).not.toBe(resistRole);
  });
});
