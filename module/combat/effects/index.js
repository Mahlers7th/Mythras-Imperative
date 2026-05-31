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

// ── Batch 4: entangle and grip families ──────────────────────────────────────
import { resolveEntangle } from './entangle.js';
import { resolveGrip } from './grip.js';

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
