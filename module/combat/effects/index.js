/**
 * module/combat/effects/index.js
 *
 * SE resolver catalogue — the node editor's entry point.
 *
 * Maps SE id → resolver function. Built incrementally as resolvers are
 * extracted from CombatEngine into this directory (refactor 2b).
 *
 * Usage (node editor, tests, external tools):
 *   import { SE_RESOLVERS } from './module/combat/effects/index.js';
 *   await SE_RESOLVERS['withdraw'](ctx);
 *
 * The engine still dispatches via CombatEngine static wrapper stubs during
 * the extraction phase. Once all resolvers are extracted, the engine will
 * switch to calling SE_RESOLVERS[id](ctx) directly.
 */

// ── Batch 2: simple narrative resolvers ──────────────────────────────────────
import {
  resolveWithdraw,
  resolveDuckBack,
  resolveRapidReload,
  resolveOverpenetrate,
  resolveCircumventCover,
  resolveSelectTarget,
  resolveWeaponMalfunction,
} from './simple.js';

// ── Batch 3: opposed-roll resolvers ──────────────────────────────────────────
import {
  resolveBleed,
  resolveTripOpponent,
  resolveStunLocation,
  resolveDisarmOpponent,
  resolveBlindOpponent,
  resolveDropFoe,
  resolvePinDown,
} from './opposed.js';

// ── SE_RESOLVERS catalogue ────────────────────────────────────────────────────
// Grows as each batch of resolvers is extracted.
// Keys match the `id` field in CONFIG.MYTHRAS.specialEffects.

export const SE_RESOLVERS = {
  withdraw:          resolveWithdraw,
  duckBack:          resolveDuckBack,
  rapidReload:       resolveRapidReload,
  overpenetrate:     resolveOverpenetrate,
  circumventCover:   resolveCircumventCover,
  selectTarget:      resolveSelectTarget,
  weaponMalfunction: resolveWeaponMalfunction,

  // Batch 3 — opposed roll resolvers
  bleed:             resolveBleed,
  tripOpponent:      resolveTripOpponent,
  stunLocation:      resolveStunLocation,
  disarmOpponent:    resolveDisarmOpponent,
  blindOpponent:     resolveBlindOpponent,
  dropFoe:           resolveDropFoe,
  pinDown:           resolvePinDown,
};
