/**
 * tests/luck-replenish.test.js
 *
 * Jest tests for module/rolls/luck-replenish.js
 *
 * Replenishment is strictly generous, which makes it the kind of bug nobody
 * reports: a player handed back points they had already spent does not file a
 * ticket. So the selection rule — who is in, who is out, and what "normal
 * value" reads from — is pinned here rather than trusted to a live look.
 */

import { luckReplenishPlan, applyLuckReplenish } from '../module/rolls/luck-replenish.js';

/** Minimal actor stand-in: only the fields the plan actually reads. */
function actor(name, { value, max, type = 'character' } = {}) {
  return {
    id: name.toLowerCase(),
    name,
    type,
    system: { attributes: { luckPoints: { value, max } } },
  };
}

describe('luckReplenishPlan', () => {
  test('refills a spent pool to the derived max', () => {
    const plan = luckReplenishPlan([actor('Nex', { value: 1, max: 4 })]);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ name: 'Nex', current: 1, max: 4, restored: 3 });
  });

  test('keeps an already-full actor in the plan, but with nothing to restore', () => {
    // Reported rather than hidden: a GM scanning the list must be able to see
    // that the actor was considered, not wonder why they are missing.
    const plan = luckReplenishPlan([actor('Nocturne', { value: 3, max: 3 })]);
    expect(plan).toHaveLength(1);
    expect(plan[0].restored).toBe(0);
  });

  // The rule is actor TYPE, not ownership. Live testing found every PC in the
  // Destined world is GM-owned, so a hasPlayerOwner rule selected nobody.
  test('excludes non-character actors by default, even when GM-owned', () => {
    const plan = luckReplenishPlan([
      actor('Nex',    { value: 0, max: 4 }),
      actor('Goblin', { value: 0, max: 2, type: 'creature' }),
    ]);
    expect(plan.map(r => r.name)).toEqual(['Nex']);
  });

  test('includes a character with no player owner — ownership is not the axis', () => {
    const gmOwned = actor('Nocturne', { value: 0, max: 4 });
    gmOwned.hasPlayerOwner = false;
    expect(luckReplenishPlan([gmOwned]).map(r => r.name)).toEqual(['Nocturne']);
  });

  test('includeAll brings other actor types back in', () => {
    const plan = luckReplenishPlan([
      actor('Nex',    { value: 0, max: 4 }),
      actor('Goblin', { value: 0, max: 2, type: 'creature' }),
    ], { includeAll: true });
    expect(plan.map(r => r.name).sort()).toEqual(['Goblin', 'Nex']);
  });

  test('skips actors with no Luck Point pool at all', () => {
    const vehicle = { id: 'v', name: 'Truck', type: 'character', system: { attributes: {} } };
    const noMax   = actor('Ghost', { value: 0, max: 0 });
    const nanMax  = actor('Broken', { value: 0, max: undefined });
    expect(luckReplenishPlan([vehicle, noMax, nanMax])).toEqual([]);
  });

  test('treats a missing current value as zero rather than NaN', () => {
    const plan = luckReplenishPlan([actor('Fresh', { value: undefined, max: 3 })]);
    expect(plan[0].current).toBe(0);
    expect(plan[0].restored).toBe(3);
  });

  test('never reports a negative restore when value somehow exceeds max', () => {
    const plan = luckReplenishPlan([actor('Overfull', { value: 9, max: 3 })]);
    expect(plan[0].restored).toBe(0);
  });

  test('sorts those gaining points first, then alphabetically', () => {
    const plan = luckReplenishPlan([
      actor('Zara',  { value: 2, max: 2 }),  // full
      actor('Nex',   { value: 0, max: 4 }),  // gaining
      actor('Alba',  { value: 3, max: 3 }),  // full
      actor('Brann', { value: 1, max: 2 }),  // gaining
    ]);
    expect(plan.map(r => r.name)).toEqual(['Brann', 'Nex', 'Alba', 'Zara']);
  });

  test('tolerates a null or empty candidate list', () => {
    expect(luckReplenishPlan(null)).toEqual([]);
    expect(luckReplenishPlan([])).toEqual([]);
  });
});

describe('applyLuckReplenish', () => {
  /** Actor stand-in that records what update() was called with. */
  function updatable(name, { value, max }) {
    const a = actor(name, { value, max });
    a.updates = [];
    a.update = async (data) => { a.updates.push(data); };
    return a;
  }

  test('writes exactly the max, never more', async () => {
    const nex  = updatable('Nex', { value: 1, max: 4 });
    const plan = luckReplenishPlan([nex]);
    const res  = await applyLuckReplenish(plan);

    expect(res).toEqual({ updated: 1, failed: [] });
    // Exactly max matters: prepareDerivedData clamps value > max back down,
    // so a write above max would silently revert.
    expect(nex.updates).toEqual([{ 'system.attributes.luckPoints.value': 4 }]);
  });

  test('does not write to an actor that is already full', async () => {
    const full = updatable('Nocturne', { value: 3, max: 3 });
    const res  = await applyLuckReplenish(luckReplenishPlan([full]));

    expect(res.updated).toBe(0);
    expect(full.updates).toEqual([]);
  });

  test('one failing actor does not abort the rest of the party', async () => {
    const bad  = updatable('Cursed', { value: 0, max: 3 });
    const good = updatable('Nex',    { value: 0, max: 4 });
    bad.update = async () => { throw new Error('locked'); };

    const errors = [];
    const realError = console.error;
    console.error = (...args) => errors.push(args);
    let res;
    try {
      res = await applyLuckReplenish(luckReplenishPlan([bad, good]));
    } finally {
      console.error = realError;
    }

    expect(res.updated).toBe(1);
    expect(res.failed).toEqual([{ name: 'Cursed', error: 'locked' }]);
    expect(good.updates).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  test('tolerates a null plan', async () => {
    expect(await applyLuckReplenish(null)).toEqual({ updated: 0, failed: [] });
  });
});
