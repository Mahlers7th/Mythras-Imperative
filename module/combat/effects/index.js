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
 * All resolved SE_RESOLVERS entries are called directly by CombatEngine
 * since refactor 2c; wrapper stubs have been removed.
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

// ── Batch 4: entangle and grip families ──────────────────────────────────────
import { resolveEntangle, resolveEntangleTripYes, resolveEntangleBreakFree } from './entangle.js';
import { resolveGrip, resolveGripBreakFree } from './grip.js';

// ── Batch 5: standalone resolvers ────────────────────────────────────────────
import { resolveSlipFree }     from './slip-free.js';
import { resolveBash }         from './bash.js';
import { resolveDamageWeapon } from './damage-weapon.js';
import { resolvePinWeapon }    from './pin-weapon.js';

// ── Batch 6: impale family ────────────────────────────────────────────────────
import {
  resolveImpale,
  postImpaleDecisionCard,
  applyImpaleLodge,
  resolveImpaleYank,
} from './impale.js';

// ── Re-export callback functions used by mythras.mjs ─────────────────────────
// These are called from chat-card button handlers in mythras.mjs, not via the
// SE dispatch loop. Exported here so mythras.mjs only needs one effects import.
export {
  resolveBleed,
  resolveEntangleTripYes,
  resolveEntangleBreakFree,
  resolveGripBreakFree,
  postImpaleDecisionCard,
  applyImpaleLodge,
  resolveImpaleYank,
  resolveDamageWeapon,
};

// ── SE_RESOLVERS catalogue ────────────────────────────────────────────────────
// Keys match the `id` field in CONFIG.MYTHRAS.specialEffects.
// Used by _resolveOpposedSEs and the attackerScored dispatch in
// _afterDefenceResolved. Also the node editor's SE entry point.

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

  // Batch 4 — entangle and grip families
  entangle:          resolveEntangle,
  grip:              resolveGrip,

  // Batch 5 — standalone resolvers
  slipFree:          resolveSlipFree,
  bash:              resolveBash,
  damageWeapon:      resolveDamageWeapon,
  pinWeapon:         resolvePinWeapon,

  // Batch 6 — impale family
  impale:            resolveImpale,
};
