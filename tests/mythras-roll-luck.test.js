/**
 * tests/mythras-roll-luck.test.js
 *
 * Jest tests for the Luck Point affordance on a roll card (v1.4.318).
 *
 * `MythrasRoll` is a plain class whose only import is roll-math.js, so it can
 * be imported here directly — no Foundry globals are needed at module scope.
 * `_retireLuckButtons` calls `game.i18n.localize`, so a minimal `game` stub is
 * installed below; that is the whole Foundry surface this touches.
 *
 * Rule under test — Imperative p.33 / Core p.81: *"Only one Luck Point can be
 * used in support of a particular Action."* Re-roll and swap are two shapes of
 * that single use, so once either fires the card must stop offering BOTH.
 */

import { MythrasRoll } from '../module/rolls/MythrasRoll.js';
import { swapDigits, canSpendLuck } from '../module/rolls/luck-point.js';

globalThis.game = {
  i18n: {
    localize: (k) => ({
      'MYTHRAS.LuckPointSpent': 'Luck Point spent — only one per Action',
    }[k] ?? k),
  },
};

/** The exact block MythrasRoll.buildCard emits when the actor has points. */
const LUCK_HTML = `
      <div class="mi-luck-buttons">
        <button class="mi-luck-reroll"><i class="fas fa-dice"></i> Re-roll</button>
        <button class="mi-luck-swap"><i class="fas fa-exchange-alt"></i> Swap Digits</button>
      </div>`;

function card({ withLuck = true } = {}) {
  return [
    '<div class="mi-chat-card">',
    '  <div class="mi-card-header"><span class="mi-card-actor">Nocturne</span></div>',
    '  <div class="mi-card-body">',
    '    <div class="mi-card-target">Target <strong>65%</strong></div>',
    '    <div class="mi-roll-result">75</div>',
    '    <div class="mi-outcome-row"><span class="mi-outcome failure">Failure</span></div>',
    withLuck ? LUCK_HTML : '',
    '  </div>',
    '</div>',
  ].join('\n');
}

describe('MythrasRoll._retireLuckButtons', () => {
  test('removes BOTH buttons, not just the one that was used', () => {
    // The bug this fixes: until v1.4.318 neither was removed, so a player
    // could re-roll, re-roll again, then swap — three points on one Action.
    const out = MythrasRoll._retireLuckButtons(card());
    expect(out).not.toContain('mi-luck-buttons');
    expect(out).not.toContain('mi-luck-reroll');
    expect(out).not.toContain('mi-luck-swap');
  });

  test('leaves a visible spent note in their place', () => {
    const out = MythrasRoll._retireLuckButtons(card());
    expect(out).toContain('mi-luck-spent');
    expect(out).toContain('only one per Action');
  });

  test('preserves the rest of the card', () => {
    const out = MythrasRoll._retireLuckButtons(card());
    expect(out).toContain('<div class="mi-roll-result">75</div>');
    expect(out).toContain('mi-outcome failure');
    expect(out).toContain('Target <strong>65%</strong>');
    expect(out).toContain('Nocturne');
  });

  test('leaves the markup balanced', () => {
    // A greedy regex here would have eaten the card's closing divs.
    const out = MythrasRoll._retireLuckButtons(card());
    expect((out.match(/<div/g) || []).length).toBe((out.match(/<\/div>/g) || []).length);
  });

  test('is idempotent — a second call changes nothing', () => {
    // The click handler guards on the message flag, but a re-entrant render
    // must not corrupt a card that has already been retired.
    const once = MythrasRoll._retireLuckButtons(card());
    expect(MythrasRoll._retireLuckButtons(once)).toBe(once);
  });

  test('is a no-op on a card that never offered the buttons', () => {
    // Cards for actors with zero Luck Points are built without the block.
    const plain = card({ withLuck: false });
    expect(MythrasRoll._retireLuckButtons(plain)).toBe(plain);
  });
});

// =============================================================================
// luck-point.js — the shared component's pure surface
// =============================================================================

describe('swapDigits', () => {
  test("the book's own example: 75 becomes 57", () => {
    expect(swapDigits(75)).toBe(57);
  });

  test('handles single-digit results as the leading-zero face they are', () => {
    expect(swapDigits(5)).toBe(50);   // "05" -> "50"
    expect(swapDigits(1)).toBe(10);   // "01" -> "10"
    expect(swapDigits(50)).toBe(5);   // "50" -> "05"
    expect(swapDigits(10)).toBe(1);   // "10" -> "01"
  });

  test('a palindrome is unchanged', () => {
    expect(swapDigits(99)).toBe(99);
    expect(swapDigits(44)).toBe(44);
  });

  test('REGRESSION: 100 is the face "00" and swaps to itself, not to 10', () => {
    // The inline version this replaced computed Math.floor(100/10) = 10 tens
    // and 0 units and returned 10 — turning the game's one guaranteed fumble
    // into a near-certain success for a single Luck Point.
    expect(swapDigits(100)).toBe(100);
  });

  test('swapping twice returns the original for ordinary results', () => {
    for (const n of [12, 34, 75, 99, 100]) {
      expect(swapDigits(swapDigits(n))).toBe(n);
    }
  });

  test('degrades safely on malformed input', () => {
    expect(swapDigits(undefined)).toBe(undefined);
    expect(swapDigits(NaN)).toBeNaN();
  });
});

describe('canSpendLuck', () => {
  const withLuck = (value) => ({ system: { attributes: { luckPoints: { value } } } });

  test('true only when the pool has a point left', () => {
    expect(canSpendLuck(withLuck(2))).toBe(true);
    expect(canSpendLuck(withLuck(1))).toBe(true);
    expect(canSpendLuck(withLuck(0))).toBe(false);
  });

  test('false for a missing actor or missing attributes, never a throw', () => {
    expect(canSpendLuck(null)).toBe(false);
    expect(canSpendLuck(undefined)).toBe(false);
    expect(canSpendLuck({})).toBe(false);
    expect(canSpendLuck({ system: {} })).toBe(false);
    expect(canSpendLuck({ system: { attributes: {} } })).toBe(false);
  });
});
