/**
 * tests/area-attack.test.js
 *
 * Jest tests for module/utils/area-attack.js — the pure half of area attacks
 * (Destined's Blast: Detonate, v1.4.356).
 */

import {
  AREA_DODGE_TYPES,
  isAreaAttack,
  areaDamageAfterDodge,
  tokensInRadius,
  mergeAreaTargets,
  areaCentre,
} from '../module/utils/area-attack.js';

describe('areaCentre', () => {
  const fallback = { x: 10, y: 20 };

  test('a placed centre on this scene is used', () => {
    const ctx = { areaAttack: { radius: 3, centre: { x: 450, y: 300, sceneId: 'S1' } } };
    expect(areaCentre(ctx, fallback, 'S1')).toEqual({ x: 450, y: 300 });
  });

  test('a placed centre with no scene id is used on any scene', () => {
    const ctx = { areaAttack: { radius: 3, centre: { x: 450, y: 300 } } };
    expect(areaCentre(ctx, fallback, 'S1')).toEqual({ x: 450, y: 300 });
  });

  test('a centre placed on ANOTHER scene is ignored — the blast centres on the first target', () => {
    const ctx = { areaAttack: { radius: 3, centre: { x: 450, y: 300, sceneId: 'S2' } } };
    expect(areaCentre(ctx, fallback, 'S1')).toBe(fallback);
  });

  test('no centre, or a malformed one, falls back to the first target', () => {
    expect(areaCentre({ areaAttack: { radius: 3 } }, fallback, 'S1')).toBe(fallback);
    expect(areaCentre({ areaAttack: { radius: 3, centre: { x: 'left', y: 3 } } }, fallback, 'S1')).toBe(fallback);
    expect(areaCentre({ areaAttack: { radius: 3, centre: { y: 3 } } }, fallback, 'S1')).toBe(fallback);
    expect(areaCentre(null, fallback, 'S1')).toBe(fallback);
  });

  test('numeric strings are accepted and returned as numbers', () => {
    const ctx = { areaAttack: { radius: 3, centre: { x: '450', y: '300' } } };
    expect(areaCentre(ctx, fallback)).toEqual({ x: 450, y: 300 });
  });
});

describe('isAreaAttack', () => {
  test('a positive radius makes it an area attack', () => {
    expect(isAreaAttack({ areaAttack: { radius: 3 } })).toBe(true);
    expect(isAreaAttack({ areaAttack: { radius: 0.5 } })).toBe(true);
  });

  test('no declaration, or a radius that is not a positive number, does not', () => {
    expect(isAreaAttack({})).toBe(false);
    expect(isAreaAttack(null)).toBe(false);
    expect(isAreaAttack({ areaAttack: null })).toBe(false);
    expect(isAreaAttack({ areaAttack: { radius: 0 } })).toBe(false);
    expect(isAreaAttack({ areaAttack: { radius: -2 } })).toBe(false);
    expect(isAreaAttack({ areaAttack: { radius: 'wide' } })).toBe(false);
  });
});

describe('areaDamageAfterDodge', () => {
  test('a successful Evade halves the damage, rounding up', () => {
    expect(areaDamageAfterDodge(9, 'evade', 'success')).toEqual({ damage: 5, halved: true });
    expect(areaDamageAfterDodge(8, 'evade', 'success')).toEqual({ damage: 4, halved: true });
  });

  test('a critical Evade halves too — it is not a stronger result here', () => {
    expect(areaDamageAfterDodge(9, 'evade', 'critical')).toEqual({ damage: 5, halved: true });
  });

  test('Acrobatics, Fly and Swim are Evade substitutes and halve as well', () => {
    for (const type of ['acrobatics', 'fly', 'swim']) {
      expect(areaDamageAfterDodge(7, type, 'success')).toEqual({ damage: 4, halved: true });
    }
  });

  test('a failed or fumbled dodge takes the full damage', () => {
    expect(areaDamageAfterDodge(9, 'evade', 'failure')).toEqual({ damage: 9, halved: false });
    expect(areaDamageAfterDodge(9, 'evade', 'fumble')).toEqual({ damage: 9, halved: false });
  });

  test("Don't Defend takes the full damage", () => {
    expect(areaDamageAfterDodge(9, 'none', 'none')).toEqual({ damage: 9, halved: false });
  });

  test('a Parry is not a dodge — there is no Parry against a blast', () => {
    expect(areaDamageAfterDodge(9, 'parry', 'success')).toEqual({ damage: 9, halved: false });
  });

  test('1 damage halves to 1, and 0 or garbage stays 0', () => {
    expect(areaDamageAfterDodge(1, 'evade', 'success').damage).toBe(1);
    expect(areaDamageAfterDodge(0, 'evade', 'success').damage).toBe(0);
    expect(areaDamageAfterDodge(undefined, 'evade', 'success').damage).toBe(0);
    expect(areaDamageAfterDodge(-4, 'none', 'none').damage).toBe(0);
  });

  test('the dodge list is frozen', () => {
    expect(Object.isFrozen(AREA_DODGE_TYPES)).toBe(true);
  });
});

describe('tokensInRadius', () => {
  // 100 px squares, 1.5 m per square — a common Destined scene setup.
  const GRID = 100;
  const DIST = 1.5;
  const centre = { x: 0, y: 0 };

  test('the token at the centre is always caught', () => {
    expect(tokensInRadius(centre, [{ id: 'a', x: 0, y: 0 }], 1, GRID, DIST)).toEqual(['a']);
  });

  test('an adjacent 1-square token is caught by a 1 m blast, because its body reaches in', () => {
    // centre 1.5 m away, half-width 0.75 m, so its edge is 0.75 m from the blast centre
    expect(tokensInRadius(centre, [{ id: 'b', x: 100, y: 0 }], 1, GRID, DIST)).toEqual(['b']);
  });

  test('a token two squares away is not caught by a 1 m blast', () => {
    // centre 3 m away, edge 2.25 m away
    expect(tokensInRadius(centre, [{ id: 'c', x: 200, y: 0 }], 1, GRID, DIST)).toEqual([]);
  });

  test('a big token is caught when only part of it is inside', () => {
    // a 2-square Grotesque, centre 3 m away: edge at 3 - 1.5 = 1.5 m
    expect(tokensInRadius(centre, [{ id: 'g', x: 200, y: 0, size: 2 }], 1.5, GRID, DIST)).toEqual(['g']);
    expect(tokensInRadius(centre, [{ id: 'g', x: 200, y: 0, size: 2 }], 1, GRID, DIST)).toEqual([]);
  });

  test('diagonals are measured as real distance, not squares', () => {
    // diagonal neighbour: centre sqrt(2)*1.5 = 2.12 m, edge 1.37 m
    const diag = [{ id: 'd', x: 100, y: 100 }];
    expect(tokensInRadius(centre, diag, 1.4, GRID, DIST)).toEqual(['d']);
    expect(tokensInRadius(centre, diag, 1.3, GRID, DIST)).toEqual([]);
  });

  test('results come back nearest first', () => {
    const tokens = [
      { id: 'far',  x: 200, y: 0 },
      { id: 'near', x: 100, y: 0 },
      { id: 'here', x: 0,   y: 0 },
    ];
    expect(tokensInRadius(centre, tokens, 3, GRID, DIST)).toEqual(['here', 'near', 'far']);
  });

  test('bad inputs return nothing rather than throwing', () => {
    const one = [{ id: 'a', x: 0, y: 0 }];
    expect(tokensInRadius(null, one, 1, GRID, DIST)).toEqual([]);
    expect(tokensInRadius(centre, one, 0, GRID, DIST)).toEqual([]);
    expect(tokensInRadius(centre, one, 1, 0, DIST)).toEqual([]);
    expect(tokensInRadius(centre, one, 1, GRID, 0)).toEqual([]);
    expect(tokensInRadius(centre, null, 1, GRID, DIST)).toEqual([]);
  });
});

describe('mergeAreaTargets', () => {
  test('primary first, then the player\'s targets, then the rest the radius caught', () => {
    expect(mergeAreaTargets('p', ['p', 'x'], ['p', 'y', 'x'])).toEqual(['p', 'x', 'y']);
  });

  test('no duplicates and no empty ids', () => {
    expect(mergeAreaTargets('p', ['p', null, 'p'], ['', 'q', 'q'])).toEqual(['p', 'q']);
  });

  test('missing lists are fine', () => {
    expect(mergeAreaTargets('p', undefined, undefined)).toEqual(['p']);
  });
});
