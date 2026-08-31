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

import { getConditionGrade, applyGradeToSkill, explainConditionGrade, CONDITION_GRADE_ORDER } from '../module/utils/condition-grade.js';
import { getFatigueSkillGrade, applyFatigueToSkill as applyFatigueOnly } from '../module/utils/fatigue.js';
import {
  getActiveImpaleGrade, getActiveEntangleGrade, getActiveBlindGrade,
  applyFatigueToSkill as applyFatigueImpaleEntangle,
} from '../module/combat/effects/helpers.js';
import { MYTHRAS } from '../module/config/config.js';
// determineOutcome — imported for real by the torso Stun Location guard at the
// foot of this file, so the crit-band assertion exercises the shipped grader.
import { determineOutcome } from '../module/utils/roll-math.js';

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

// ---------------------------------------------------------------------------
// Torso Stun Location regression guard  (v1.4.312)
//
// Mirror of the torso-collapse check in effects/opposed.js (Foundry-coupled:
// rolls dice, writes flags, posts a card). Both functions under test are
// imported for real; what is mirrored is only the call site's CHOICE of grade
// and of what it passes as determineOutcome's target.
//
// Two defects lived here until v1.4.312, ten lines apart:
//   1. `Math.ceil(enduranceTotal / 2)` — the FORMIDABLE multiplier — while the
//      chat card called it "Hard" in two places.
//   2. The critical band was taken from the UNMODIFIED Endurance, while
//      success was graded against the modified target.
// ---------------------------------------------------------------------------

/** Mirror of the torso check's target + outcome derivation. */
function torsoStunCheck(enduranceTotal, roll) {
  const hardTotal = applyGradeToSkill(enduranceTotal, 'hard');
  return {
    target:     hardTotal,
    outcome:    determineOutcome(roll, hardTotal, enduranceTotal),
    fallsProne: roll > hardTotal
  };
}

describe('torso Stun Location — grade and outcome band', () => {
  test('the target is Hard (two-thirds), not half', () => {
    // The exact regression: 60 Endurance is 40 at Hard, not 30.
    expect(torsoStunCheck(60, 1).target).toBe(40);
    expect(torsoStunCheck(60, 1).target).not.toBe(Math.ceil(60 / 2));
  });

  test('Hard and Formidable are different grades, and this site uses Hard', () => {
    // Guards against someone "simplifying" back to a divisor. If these ever
    // become equal the grade table itself has been broken.
    expect(applyGradeToSkill(60, 'hard')).toBe(40);
    expect(applyGradeToSkill(60, 'formidable')).toBe(30);
    expect(applyGradeToSkill(60, 'hard')).not.toBe(applyGradeToSkill(60, 'formidable'));
  });

  test('the critical band comes from the MODIFIED target, not raw Endurance', () => {
    // At Endurance 60 the modified target is 40, so criticals are 1-4.
    // The old code allowed 1-6 (60/10) — half again too generous.
    expect(torsoStunCheck(60, 4).outcome).toBe('critical');
    expect(torsoStunCheck(60, 5).outcome).toBe('success');
    expect(torsoStunCheck(60, 6).outcome).toBe('success');
  });

  test('rolls between the old and new targets now succeed, as Hard requires', () => {
    for (const roll of [31, 35, 40]) {
      expect(torsoStunCheck(60, roll).outcome).toBe('success');
      expect(torsoStunCheck(60, roll).fallsProne).toBe(false);
    }
    expect(torsoStunCheck(60, 41).outcome).toBe('failure');
    expect(torsoStunCheck(60, 41).fallsProne).toBe(true);
  });

  test('prone still follows the target, not the outcome label', () => {
    // 99/100 now report "fumble" rather than "failure" (canonical grading),
    // but the collapse itself is decided by the target comparison and is
    // unchanged by that relabelling.
    expect(torsoStunCheck(60, 99).fallsProne).toBe(true);
    expect(torsoStunCheck(60, 100).fallsProne).toBe(true);
    expect(torsoStunCheck(60, 99).outcome).toBe('fumble');
  });

  test('a zero-Endurance defender degrades safely', () => {
    expect(torsoStunCheck(0, 50).target).toBe(0);
    expect(torsoStunCheck(0, 50).fallsProne).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// conditionGradeHooks' third argument — `context`  (v1.4.312)
//
// The family fired everywhere and could see nothing about WHAT was being
// rolled. grade-shift-coverage-design.md found that coverage was already
// solved and the real limit was the subject: the only consumer that has ever
// named this family in code (Destined's Bulky, a per-weapon demand) could not
// be expressed by the two-argument signature at all.
//
// These use the REAL getConditionGrade/explainConditionGrade. CONFIG.MYTHRAS
// is the real config object, so every test restores conditionGradeHooks.
// ---------------------------------------------------------------------------

describe('conditionGradeHooks — context argument', () => {
  const saved = MYTHRAS.conditionGradeHooks;
  afterEach(() => { MYTHRAS.conditionGradeHooks = saved; });

  test('the two-argument call still works — context defaults to an empty object', () => {
    const seen = [];
    MYTHRAS.conditionGradeHooks = [(a, role, ctx) => { seen.push(ctx); return 0; }];
    expect(getConditionGrade(makeActor(), 'attack')).toBe('standard');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({});   // never undefined — hooks may destructure it
  });

  test('context is forwarded to the hook verbatim', () => {
    const weapon = { id: 'w1', name: 'Greatsword' };
    const seen = [];
    MYTHRAS.conditionGradeHooks = [(a, role, ctx) => { seen.push([role, ctx]); return 0; }];
    getConditionGrade(makeActor(), 'defence', { kind: 'defence', weapon });
    expect(seen[0][0]).toBe('defence');
    expect(seen[0][1].kind).toBe('defence');
    expect(seen[0][1].weapon).toBe(weapon);
  });

  test('a per-weapon hook fires for one weapon and not another — the Bulky shape', () => {
    // The demand that motivated the widening. Under (actor, role) this hook
    // could not be written at all: nothing distinguished the two calls.
    const bulky  = { id: 'w1', name: 'Gravity Club', system: { traits: ['destinedBulky'] } };
    const normal = { id: 'w2', name: 'Knife',        system: { traits: [] } };
    MYTHRAS.conditionGradeHooks = [
      (a, role, ctx) => (ctx.weapon?.system?.traits ?? []).includes('destinedBulky') ? 1 : 0
    ];
    const actor = makeActor();
    expect(getConditionGrade(actor, 'attack', { weapon: bulky  })).toBe('hard');
    expect(getConditionGrade(actor, 'attack', { weapon: normal })).toBe('standard');
  });

  test('a hook can tell a sheet roll from an attack, though both use role attack', () => {
    // The role-'attack' overload is NOT resolved by this change (open ruling
    // 9.2). `kind` is what makes it survivable in the meantime: a weapon-shaped
    // hook must not fire on a Perception check.
    MYTHRAS.conditionGradeHooks = [(a, role, ctx) => ctx.kind === 'attack' ? 1 : 0];
    const actor = makeActor();
    expect(getConditionGrade(actor, 'attack', { kind: 'attack' })).toBe('hard');
    expect(getConditionGrade(actor, 'attack', { kind: 'sheet'  })).toBe('standard');
  });

  test('a hook can discriminate on the item being rolled', () => {
    const perception = { id: 's1', name: 'Perception', type: 'skill' };
    const stealth    = { id: 's2', name: 'Stealth',    type: 'skill' };
    MYTHRAS.conditionGradeHooks = [(a, role, ctx) => ctx.item?.name === 'Stealth' ? -1 : 0];
    const actor = makeActor({ fatigue: 'wearied' });   // floors to formidable
    expect(getConditionGrade(actor, 'attack', { item: stealth    })).toBe('hard');
    expect(getConditionGrade(actor, 'attack', { item: perception })).toBe('formidable');
  });

  test('missing context fields are absent, not undefined-valued surprises', () => {
    // A hook reading ctx.weapon when the site has none must see undefined and
    // decline, not throw and not be handed a stand-in.
    MYTHRAS.conditionGradeHooks = [(a, role, ctx) => ctx.weapon?.system?.traits?.includes('x') ? 1 : 0];
    expect(() => getConditionGrade(makeActor(), 'resist', { kind: 'seResist' })).not.toThrow();
    expect(getConditionGrade(makeActor(), 'resist', { kind: 'seResist' })).toBe('standard');
  });

  test('shifts still sum, and order still does not matter, with context in play', () => {
    const run = hooks => {
      MYTHRAS.conditionGradeHooks = hooks;
      return getConditionGrade(makeActor(), 'attack', { kind: 'attack' });
    };
    const a = () => 1, b = () => 1;
    expect(run([a, b])).toBe('formidable');    // standard + 2
    expect(run([b, a])).toBe('formidable');
  });

  test('a throwing hook is still isolated', () => {
    MYTHRAS.conditionGradeHooks = [
      () => { throw new Error('module bug'); },
      (a, role, ctx) => ctx.kind === 'attack' ? 1 : 0
    ];
    expect(getConditionGrade(makeActor(), 'attack', { kind: 'attack' })).toBe('hard');
  });
});

describe('explainConditionGrade', () => {
  const saved = MYTHRAS.conditionGradeHooks;
  afterEach(() => { MYTHRAS.conditionGradeHooks = saved; });

  test('reports the composed grade, the net shift, and who moved it', () => {
    const named = (a, role, ctx) => ctx.kind === 'attack' ? 2 : 0;
    named.destinedHookName = 'bulkyWeapon';
    MYTHRAS.conditionGradeHooks = [named];
    const out = explainConditionGrade(makeActor(), 'attack', { kind: 'attack' });
    expect(out.grade).toBe('formidable');       // standard + 2
    expect(out.shift).toBe(2);
    expect(out.breakdown).toEqual([{ name: 'bulkyWeapon', value: 2 }]);
  });

  test('with no hooks it is silent — shift 0, empty breakdown', () => {
    MYTHRAS.conditionGradeHooks = [];
    const out = explainConditionGrade(makeActor(), 'attack');
    expect(out.shift).toBe(0);
    expect(out.breakdown).toEqual([]);
    expect(out.grade).toBe('standard');
  });

  test('its grade always agrees with getConditionGrade for the same inputs', () => {
    // The banner and the roll must never disagree — the v1.4.309 bug class.
    MYTHRAS.conditionGradeHooks = [(a, role, ctx) => ctx.kind === 'attack' ? 1 : 0];
    const actor = makeActor({ fatigue: 'wearied' });
    for (const ctx of [{ kind: 'attack' }, { kind: 'sheet' }, {}]) {
      expect(explainConditionGrade(actor, 'attack', ctx).grade)
        .toBe(getConditionGrade(actor, 'attack', ctx));
    }
  });

  test('contributions that cancel report a zero net shift, so the banner stays quiet', () => {
    MYTHRAS.conditionGradeHooks = [() => 1, () => -1];
    expect(explainConditionGrade(makeActor(), 'attack').shift).toBe(0);
  });
});
