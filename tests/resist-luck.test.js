/**
 * tests/resist-luck.test.js
 *
 * Jest tests for the gate in module/combat/effects/resist-luck.js (v1.4.335).
 *
 * The rule under test is Chris's ruling of 2026-09-17: a resistance roll made
 * during an exchange draws on the defender's ONE point for that exchange, so a
 * point already spent on Cheat Fate, Desperate Effort or Mitigate Damage
 * silences the offer. A resistance roll made later, as its own Action, does
 * not consult the exchange at all.
 *
 * Only the pure gate is tested here; the offer itself is a routed dialog and
 * an actor update, covered by the live test in CHANGELOG v1.4.335.
 */

import { canOfferResistLuck, exchangeFlagFor } from '../module/combat/effects/resist-luck.js';

const base = { roll: 55, canSpend: true, alreadySpent: false, ownAction: false };

describe('canOfferResistLuck', () => {
  test('offers a rolled resistance when the point is still there', () => {
    expect(canOfferResistLuck(base)).toBe(true);
  });

  test('no roll, no offer — declining to roll at all is not a Cheat Fate moment', () => {
    // `Accept Bleed`, or closing the dialog, comes back as { roll: null }.
    expect(canOfferResistLuck({ ...base, roll: null })).toBe(false);
    expect(canOfferResistLuck({ ...base, roll: undefined })).toBe(false);
  });

  test('a roll of 0 is not treated as "no roll"', () => {
    // Not reachable from a d100, but `roll == null` must not swallow falsy
    // numbers — that class of bug is why this is a separate function.
    expect(canOfferResistLuck({ ...base, roll: 0 })).toBe(true);
  });

  test('an empty pool is refused before any dialog', () => {
    expect(canOfferResistLuck({ ...base, canSpend: false })).toBe(false);
  });

  test('the exchange point is spent: no offer', () => {
    expect(canOfferResistLuck({ ...base, alreadySpent: true })).toBe(false);
  });

  test('a roll that is its own Action ignores the exchange entirely', () => {
    // Yanking an impaled weapon, breaking free of a grip, a wound Endurance
    // roll at a turn boundary: a new Action, so a new point.
    expect(canOfferResistLuck({ ...base, alreadySpent: true, ownAction: true })).toBe(true);
  });

  test('its own Action still needs a point in the pool', () => {
    expect(canOfferResistLuck({ ...base, canSpend: false, ownAction: true })).toBe(false);
  });
});

describe('exchangeFlagFor', () => {
  // Trip and Disarm are offensive OR defensive (Imperative p.46), so the
  // resisting combatant may be either one. Charging the wrong side's flag
  // would let that side spend twice and block the other for nothing, and
  // nothing in the UI would show it.
  test('each side maps to its own flag', () => {
    expect(exchangeFlagFor('attacker')).toBe('attackerLuckSpent');
    expect(exchangeFlagFor('defender')).toBe('defenderLuckSpent');
  });

  test('an unrecognised side charges nothing rather than guessing', () => {
    expect(exchangeFlagFor('bystander')).toBeNull();
    expect(exchangeFlagFor(undefined)).toBeNull();
  });
});
