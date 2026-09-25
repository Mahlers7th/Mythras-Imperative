/**
 * mythras-imperative/module/utils/area-attack.js
 *
 * Pure helpers for AREA ATTACKS — an attack that strikes one point and catches
 * everyone within a radius of it. Kept free of Foundry globals so Jest can test
 * it directly. First user: Destined's Blast with the Detonate Boost (v1.4.356).
 *
 * THE CONTRACT — written by a module in a `rollHooks.preRoll` hook:
 *
 *   ctx.areaAttack = { radius, label }
 *     radius  number, scene units (metres), > 0. Anything else = not an area attack.
 *     label   optional short name for chat, e.g. 'Detonate'.
 *
 * When it is present, CombatEngine resolves the attack like this (rulings by
 * Chris, 2026-09-25, from Destined's Detonate text, core p.83):
 *
 *   - ONE attack roll, against the first target. A miss does nothing.
 *   - Everyone in the radius is caught: the player's own targets, plus every
 *     token whose footprint reaches inside the radius of the first target.
 *   - On a hit, damage is rolled ONCE and applied to every actor caught, each
 *     with its own hit location. Special Effects go to the first target only,
 *     the same convention Full Auto uses.
 *   - Every actor caught may Evade (or Acrobatics, Fly, Swim — Evade's own
 *     substitutes) as a Reaction. A success HALVES the damage, rounding up.
 *     There is no Parry. Shields absorb as normal through the existing passive
 *     block, which needs nothing here.
 */

import { roundUp } from './rounding.js';

/**
 * Defence types that count as getting out of the way of a blast. Fly and Swim
 * are the Flying/Swimmer creature traits' Evade substitutes (rules p.35).
 */
export const AREA_DODGE_TYPES = Object.freeze(['evade', 'acrobatics', 'fly', 'swim']);

/**
 * True when the context carries a usable area-attack declaration.
 *
 * @param {object} ctx
 * @returns {boolean}
 */
export function isAreaAttack(ctx) {
  const radius = Number(ctx?.areaAttack?.radius);
  return Number.isFinite(radius) && radius > 0;
}

/**
 * Damage after an area attack's dodge: halved on a successful (or critical)
 * dodge, rounding up; unchanged otherwise.
 *
 * @param {number} rawDamage
 * @param {string|null} defenceType
 * @param {string|null} defenceOutcome   'critical' | 'success' | 'failure' | 'fumble' | 'none'
 * @returns {{damage: number, halved: boolean}}
 */
export function areaDamageAfterDodge(rawDamage, defenceType, defenceOutcome) {
  const damage = Math.max(0, Number(rawDamage) || 0);
  const dodged = AREA_DODGE_TYPES.includes(defenceType)
    && (defenceOutcome === 'success' || defenceOutcome === 'critical');
  return dodged ? { damage: roundUp(damage / 2), halved: true } : { damage, halved: false };
}

/**
 * Which tokens are caught in a blast of `radius` centred on `centre`.
 *
 * A token is caught when any part of its footprint reaches inside the radius:
 * centre-to-centre distance, less half the token's own width, is within the
 * radius. Measuring to the centre alone would let a two-square Grotesque stand
 * with half its body in the fire and take nothing.
 *
 * @param {{x:number, y:number}} centre       pixel centre of the blast
 * @param {Array<{id:string, x:number, y:number, size?:number}>} tokens
 *        candidate token centres in pixels; `size` is width in grid squares (default 1)
 * @param {number} radius        blast radius, scene units
 * @param {number} gridSize      pixels per grid square
 * @param {number} gridDistance  scene units per grid square
 * @returns {string[]} ids of the tokens caught, nearest first
 */
export function tokensInRadius(centre, tokens, radius, gridSize, gridDistance) {
  if (!centre || !(radius > 0) || !(gridSize > 0) || !(gridDistance > 0)) return [];
  const unitsPerPixel = gridDistance / gridSize;
  return (tokens ?? [])
    .map(t => {
      const centreDistance = Math.hypot(t.x - centre.x, t.y - centre.y) * unitsPerPixel;
      const halfWidth      = ((Number(t.size) > 0 ? Number(t.size) : 1) * gridDistance) / 2;
      return { id: t.id, reach: centreDistance - halfWidth, distance: centreDistance };
    })
    // A small tolerance so a token exactly on the edge is not lost to float noise.
    .filter(t => t.reach <= radius + 1e-9)
    .sort((a, b) => a.distance - b.distance)
    .map(t => t.id);
}

/**
 * Where the blast is centred (v1.4.357). A module may place the blast on the
 * map — anywhere, an empty square included — by writing
 * `ctx.areaAttack.centre = { x, y, sceneId }` in scene pixel coordinates. That
 * point is used when it is valid AND belongs to the scene being measured;
 * otherwise the blast centres on the first target, as before.
 *
 * @param {object} ctx
 * @param {{x:number, y:number}} fallback   the first target's centre
 * @param {string|null} [sceneId]           the scene being measured
 * @returns {{x:number, y:number}}
 */
export function areaCentre(ctx, fallback, sceneId = null) {
  const c = ctx?.areaAttack?.centre;
  const x = Number(c?.x);
  const y = Number(c?.y);
  const sameScene = !c?.sceneId || !sceneId || c.sceneId === sceneId;
  return (c && Number.isFinite(x) && Number.isFinite(y) && sameScene) ? { x, y } : fallback;
}

/**
 * Merge the player's own targets with the tokens the radius caught: the
 * primary target first, then the rest in the order given, no duplicates.
 *
 * @param {string} primaryId
 * @param {string[]} targetedIds   the player's targets (primary included)
 * @param {string[]} caughtIds     from tokensInRadius
 * @returns {string[]}
 */
export function mergeAreaTargets(primaryId, targetedIds, caughtIds) {
  const out = [];
  for (const id of [primaryId, ...(targetedIds ?? []), ...(caughtIds ?? [])]) {
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}
