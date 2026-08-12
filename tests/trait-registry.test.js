/**
 * tests/trait-registry.test.js
 *
 * Jest tests for module/utils/trait-registry.js. Pure — no mocks required.
 */
import { getTraitsByCategory } from '../module/utils/trait-registry.js';
import { MYTHRAS } from '../module/config/config.js';

describe('getTraitsByCategory', () => {
  const registry = {
    impaling:    { key: 'impaling',    category: 'mechanical' },
    bleeding:    { key: 'bleeding',    category: 'mechanical' },
    fire:        { key: 'fire',        category: 'damageType' },
    cold:        { key: 'cold',        category: 'damageType' },
    narrative:   { key: 'narrative' }, // no category at all
  };

  test('returns only the keys matching the requested category', () => {
    expect(getTraitsByCategory(registry, 'damageType').sort()).toEqual(['cold', 'fire']);
  });

  test('a different category returns a disjoint set', () => {
    expect(getTraitsByCategory(registry, 'mechanical').sort()).toEqual(['bleeding', 'impaling']);
  });

  test('returns keys, not the entry objects', () => {
    const result = getTraitsByCategory(registry, 'damageType');
    for (const k of result) expect(typeof k).toBe('string');
  });

  test('an entry with no category field is never returned by a real category query', () => {
    expect(getTraitsByCategory(registry, 'mechanical')).not.toContain('narrative');
    expect(getTraitsByCategory(registry, 'damageType')).not.toContain('narrative');
  });

  test('an unknown category returns an empty array, not undefined or a throw', () => {
    expect(getTraitsByCategory(registry, 'notARealCategory')).toEqual([]);
  });

  test('a missing or empty registry returns an empty array rather than throwing', () => {
    expect(getTraitsByCategory(undefined, 'damageType')).toEqual([]);
    expect(getTraitsByCategory(null, 'damageType')).toEqual([]);
    expect(getTraitsByCategory({}, 'damageType')).toEqual([]);
  });

  test('against the REAL CONFIG.MYTHRAS.weaponTraits registry: every built-in entry is mechanical, none are damageType', () => {
    // config.js is plain data (only imports DIFFICULTY_GRADES, itself pure)
    // and imports cleanly under Jest -- import the real registry rather
    // than a hand-mirrored shape, so this test catches drift if a future
    // entry is added without a category field, not just a copy going stale.
    const mechanical = getTraitsByCategory(MYTHRAS.weaponTraits, 'mechanical');
    const damageType  = getTraitsByCategory(MYTHRAS.weaponTraits, 'damageType');
    expect(mechanical.length).toBe(Object.keys(MYTHRAS.weaponTraits).length);
    expect(damageType).toEqual([]);
    // No entry is silently uncategorised (would show up in neither list).
    expect(mechanical.length + damageType.length).toBe(Object.keys(MYTHRAS.weaponTraits).length);
  });
});
