import { reachIndex, reachCode, engagementReach, reachVerdict, closedReach, pairKey, HAFT_DAMAGE } from '../module/utils/reach.js';

const T = 0, S = 1, M = 2, L = 3, VL = 4;

describe('reachIndex', () => {
  test('Touch to Very Long', () => {
    expect(['T', 'S', 'M', 'L', 'VL'].map(reachIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(reachIndex('vl')).toBe(4);
  });
  test('unknown is Medium', () => { expect(reachIndex(undefined)).toBe(2); expect(reachIndex('X')).toBe(2); });
  test('round trip', () => { expect(reachCode(3)).toBe('L'); expect(reachCode(9)).toBe('VL'); });
});

describe('engagementReach', () => {
  test('starts at the longer weapon', () => {
    expect(engagementReach(S, L)).toBe(L);
    expect(engagementReach(L, S)).toBe(L);
  });
  test('a stored range wins', () => { expect(engagementReach(S, L, S)).toBe(S); });
});

describe('reachVerdict — the book examples', () => {
  test('dagger (Short) against falchion (Medium): one step, no penalties', () => {
    const R = engagementReach(S, M);
    expect(reachVerdict(R, S)).toEqual({ canAttack: true, canParry: true, haftSteps: 0 });
  });
  test('dagger against great axe (Long), held at the longer reach: the dagger cannot attack', () => {
    const R = engagementReach(S, L);
    expect(reachVerdict(R, S).canAttack).toBe(false);
    expect(reachVerdict(R, L)).toEqual({ canAttack: true, canParry: true, haftSteps: 0 });
  });
  test('once the dagger closes: the axe cannot parry, strikes with the haft at Size −2', () => {
    const R = closedReach(S, L);
    expect(R).toBe(S);
    expect(reachVerdict(R, L)).toEqual({ canAttack: true, canParry: false, haftSteps: 2 });
    expect(reachVerdict(R, S)).toEqual({ canAttack: true, canParry: true, haftSteps: 0 });
  });
  test('an encroached lance (Very Long) against a knife (Short) loses three steps', () => {
    expect(reachVerdict(S, VL).haftSteps).toBe(3);
  });
  test('switching to a short backup weapon once closed restores a normal fight', () => {
    expect(reachVerdict(closedReach(S, L), S).haftSteps).toBe(0);
  });
  test('an unarmed fighter (Touch) held off by a Medium sword', () => {
    expect(reachVerdict(engagementReach(T, M), T).canAttack).toBe(false);
  });
});

describe('pairKey', () => {
  test('the same either way round', () => { expect(pairKey('b', 'a')).toBe(pairKey('a', 'b')); });
});

test('haft damage is 1d3+1', () => { expect(HAFT_DAMAGE).toBe('1d3+1'); });
