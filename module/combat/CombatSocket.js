/**
 * mythras-imperative/module/combat/CombatSocket.js
 *
 * Socket layer for the Mythras Imperative combat system.
 *
 * Foundry uses a single system socket: "system.mythras-imperative"
 * All messages are objects with a { type, payload } shape.
 *
 * Message types:
 *
 *   mythras.combatChallenge
 *     Attacker → Defender's controlling user.
 *     Carries the serialised combat context after the attacker dialog
 *     has been confirmed. Opens the defender dialog on the correct client.
 *
 *   mythras.combatResponse
 *     Defender → GM / attacker's client (whoever is running the engine).
 *     Carries the defender's choices (defence type, weapon, style).
 *     The engine resumes resolution on receipt.
 *
 *   mythras.combatResolved
 *     Engine → all clients.
 *     Carries the final context for rendering the resolution chat card.
 *     (Used in Automated mode — Semi mode uses the existing chat card id.)
 *
 * Serialisation:
 *   Actor and Item references cannot cross the socket as live objects.
 *   We send IDs and re-resolve on the receiving end.
 *   The serialised payload is a plain object (no class instances, no Rolls).
 *
 * Pending challenge registry:
 *   When the attacker's client emits a combatChallenge, it stores a Promise
 *   resolver keyed by exchangeId. When the combatResponse arrives (back on
 *   the same client), the resolver fires and the engine continues.
 */

const SOCKET_NAME = 'system.mythras-imperative';

// Map of exchangeId → { resolve, reject, timeout } for pending combatChallenge promises
const _pending = new Map();

// Separate map for SE opposed-roll challenges (Bleed, Trip)
const _pendingSE = new Map();

// ── Public API ────────────────────────────────────────────────────────────────

export const CombatSocket = {

  /**
   * Register the socket listener. Call once from the 'ready' hook.
   */
  register() {
    game.socket.on(SOCKET_NAME, payload => CombatSocket._onMessage(payload));
    console.log('Mythras Imperative | CombatSocket registered');
  },

  /**
   * Emit a combatChallenge to the defender's controlling user and wait
   * for their response. Resolves with the defender's choice object, or
   * null if the defender's client is not connected / times out.
   *
   * @param {object} ctx          The live combatContext (after attacker dialog)
   * @param {string} exchangeId   Unique id for this exchange
   * @returns {Promise<object|null>}
   */
  async challenge(ctx, exchangeId) {
    const serialised = CombatSocket.serialiseContext(ctx);
    const targetUserId = _findDefenderUserId(ctx.defender);

    return new Promise((resolve, reject) => {
      _pending.set(exchangeId, { resolve, reject });

      // Set a generous timeout — defender may need a moment to read the situation
      const timeout = setTimeout(() => {
        if (_pending.has(exchangeId)) {
          _pending.delete(exchangeId);
          console.warn(`Mythras Imperative | CombatSocket — challenge ${exchangeId} timed out`);
          resolve(null); // treat timeout as "unable to defend"
        }
      }, 5 * 60 * 1000); // 5 minutes

      // Store timeout ref so we can clear it on response
      _pending.get(exchangeId).timeout = timeout;

      game.socket.emit(SOCKET_NAME, {
        type:    'mythras.combatChallenge',
        payload: {
          exchangeId,
          ctx:          serialised,
          targetUserId,   // Receiver checks this against their own userId
          originUserId: game.user.id  // Used by defender to route response back
        }
      });
    });
  },

  /**
   * Send the defender's response back to the attacker's client (GM or player).
   *
   * @param {string} exchangeId   Must match the id from the challenge
   * @param {object} defenceData  { defenceType, weaponId, styleId, actorId }
   * @param {string} originUserId The userId who originated the challenge
   */
  respond(exchangeId, defenceData, originUserId) {
    game.socket.emit(SOCKET_NAME, {
      type:    'mythras.combatResponse',
      payload: { exchangeId, defenceData, targetUserId: originUserId }
    });
  },

  /**
   * Send an SE opposed-roll challenge to a specific user and wait for their response.
   *
   * payload shape sent to the target:
   *   { seType, attackerName, defenderName, attackRoll, attackerSkillTotal,
   *     skillOptions, seId }
   *
   * Response shape expected back:
   *   { chosenSkillName, chosenSkillTotal }  — for Trip (skill pick)
   *   { confirmed: true }                    — for Bleed (defender just clicks Roll)
   *
   * @param {string} exchangeId
   * @param {object} challengePayload   Plain serialisable object
   * @param {string} targetUserId
   * @returns {Promise<object|null>}    null = timed out (treat as auto-resolve)
   */
  seChallenge(exchangeId, challengePayload, targetUserId) {
    return new Promise((resolve) => {
      _pendingSE.set(exchangeId, { resolve });

      const timeout = setTimeout(() => {
        if (_pendingSE.has(exchangeId)) {
          _pendingSE.delete(exchangeId);
          console.warn(`Mythras Imperative | CombatSocket — SE challenge ${exchangeId} timed out`);
          resolve(null);
        }
      }, 5 * 60 * 1000);

      _pendingSE.get(exchangeId).timeout = timeout;

      game.socket.emit(SOCKET_NAME, {
        type: 'mythras.seChallenge',
        payload: {
          exchangeId,
          originUserId: game.user.id,
          targetUserId,
          data: challengePayload
        }
      });
    });
  },

  /**
   * Send the SE response back to the engine's client.
   */
  seRespond(exchangeId, responseData, originUserId) {
    game.socket.emit(SOCKET_NAME, {
      type: 'mythras.seResponse',
      payload: { exchangeId, responseData, targetUserId: originUserId }
    });
  },



  /**
   * Convert a live combatContext into a socket-safe plain object.
   * All Actor/Item references become { id, actorId } descriptors.
   */
  serialiseContext(ctx) {
    return {
      // Participants — by actor id
      attackerId:         ctx.attacker?.id ?? null,
      defenderId:         ctx.defender?.id ?? null,

      // Weapon — by item id on the attacker
      weaponId:           ctx.weapon?.id ?? null,

      // Style — by item id on the attacker
      attackerStyleId:    ctx.attackerStyle?.id ?? null,
      attackerSkillTotal: ctx.attackerSkillTotal ?? 0,
      attackerTraits:     ctx.attackerTraits ?? [],

      // Difficulty & modifiers
      difficulty:         ctx.difficulty ?? 'standard',
      modifiers:          ctx.modifiers ?? 0,
      isCharge:           ctx.isCharge ?? false,
      isBraced:           ctx.isBraced ?? false,
      isRanged:           ctx.isRanged ?? false,
      rangeBand:          ctx.rangeBand ?? null,
      isAiming:           ctx.isAiming ?? false,
      isBurstFire:        ctx.isBurstFire ?? false,
      isFullAuto:         ctx.isFullAuto ?? false,
      declaredRounds:     ctx.declaredRounds ?? 0,

      // Bonus SEs granted by combat actions (e.g. chargeBonus)
      bonusSpecialEffects: ctx.bonusSpecialEffects ?? [],

      // Defender state
      defenderSurprised:   ctx.defenderSurprised ?? false,

      // Warded locations — plain objects, no Item refs needed
      wardedLocations:     ctx.wardedLocations ?? [],

      // Chat card state
      stage:         ctx.stage ?? 'init',
      chatMessageId: ctx.chatMessageId ?? null
    };
  },

  /**
   * Reconstruct a live combatContext from a serialised payload.
   * Re-resolves Actor and Item references from the world collections.
   * Returns null if attacker or defender cannot be resolved.
   */
  deserialiseContext(payload) {
    const attacker = game.actors.get(payload.attackerId);
    const defender = game.actors.get(payload.defenderId);

    if (!attacker || !defender) {
      console.error('Mythras Imperative | CombatSocket — could not resolve actors from payload', payload);
      return null;
    }

    const weapon         = attacker.items.get(payload.weaponId) ?? null;
    const attackerStyle  = attacker.items.get(payload.attackerStyleId) ?? null;

    return {
      attacker,
      defender,
      weapon,
      attackerStyle,
      attackerStyles:      attackerStyle ? [attackerStyle] : [],
      attackerSkillTotal:  payload.attackerSkillTotal ?? 0,
      attackerTraits:      payload.attackerTraits ?? [],

      difficulty:          payload.difficulty ?? 'standard',
      modifiers:           payload.modifiers ?? 0,
      isCharge:            payload.isCharge ?? false,
      isBraced:            payload.isBraced ?? false,
      isRanged:            payload.isRanged ?? false,
      rangeBand:           payload.rangeBand ?? null,
      isAiming:            payload.isAiming ?? false,
      isBurstFire:         payload.isBurstFire ?? false,
      isFullAuto:          payload.isFullAuto ?? false,
      declaredRounds:      payload.declaredRounds ?? 0,

      bonusSpecialEffects: payload.bonusSpecialEffects ?? [],

      // Defender setup — populated by the defender dialog
      defenceType:         null,
      defenceStyle:        null,
      defenceWeapon:       null,
      defenderSkillTotal:  null,

      defenderSurprised:   payload.defenderSurprised ?? false,
      wardedLocations:     payload.wardedLocations ?? [],

      // Roll results — all null until engine resolves
      attackRoll:          null,
      defenceRoll:         null,
      attackResult:        null,
      defenceResult:       null,
      attackOutcome:       null,
      defenceOutcome:      null,
      seAdvantage:         null,
      seWinner:            null,
      seCount:             null,
      chosenSpecialEffects:[],
      hitLocationId:       null,
      hitLocationLabel:    null,
      damageRoll:          null,
      rawDamage:           null,
      damageAfterParry:    null,
      damageAfterArmour:   null,
      parryReduction:      null,
      woundLevel:          null,
      enduranceRequired:   false,

      stage:               payload.stage ?? 'init',
      chatMessageId:       payload.chatMessageId ?? null
    };
  },

  // ── Internal message router ─────────────────────────────────────────────────

  async _onMessage(msg) {
    const { type, payload } = msg ?? {};
    if (!type || !payload) return;

    switch (type) {

      // ── Incoming challenge — open the defender dialog on this client ────────
      case 'mythras.combatChallenge': {
        // Only the intended user handles this
        if (payload.targetUserId && payload.targetUserId !== game.user.id) return;

        const ctx = CombatSocket.deserialiseContext(payload.ctx);
        if (!ctx) return;

        // Lazy-import to avoid circular dependency at module load time
        const { DefenderDialog } = await import('./DefenderDialog.js');
        const defenceData = await DefenderDialog.show(ctx, payload.exchangeId);

        // defenceData is null if the defender cancelled / cannot defend.
        // We still send a response so the attacker's engine is not left hanging.
        CombatSocket.respond(
          payload.exchangeId,
          defenceData ?? { defenceType: 'none', weaponId: null, styleId: null, actorId: ctx.defender.id },
          payload.originUserId ?? null  // Route response directly back to the user who challenged
        );
        break;
      }

      // ── Incoming response — resume the engine on the attacker's client ──────
      case 'mythras.combatResponse': {
        // Only the intended user handles this
        if (payload.targetUserId && payload.targetUserId !== game.user.id) return;

        const pending = _pending.get(payload.exchangeId);
        if (!pending) return; // already timed out or duplicate

        clearTimeout(pending.timeout);
        _pending.delete(payload.exchangeId);
        pending.resolve(payload.defenceData);
        break;
      }

      // ── Incoming SE challenge — show Bleed/Trip dialog on the correct client ─
      case 'mythras.seChallenge': {
        if (payload.targetUserId && payload.targetUserId !== game.user.id) return;

        const { CombatEngine } = await import('./CombatEngine.js');
        const responseData = await CombatEngine._runSEDialog(payload.data);

        CombatSocket.seRespond(
          payload.exchangeId,
          responseData,
          payload.originUserId
        );
        break;
      }

      // ── Incoming SE response — resume the engine ──────────────────────────────
      case 'mythras.seResponse': {
        if (payload.targetUserId && payload.targetUserId !== game.user.id) return;

        const pending = _pendingSE.get(payload.exchangeId);
        if (!pending) return;

        clearTimeout(pending.timeout);
        _pendingSE.delete(payload.exchangeId);
        pending.resolve(payload.responseData);
        break;
      }

      default:
        break;
    }
  }
};

// =============================================================================
// Private helpers — also exported for use in CombatEngine SE routing
// =============================================================================

/**
 * Find the userId of the first active player who owns the given actor.
 * Falls back to the active GM if no player owns it.
 */
export function _findDefenderUserId(actor) {
  for (const user of game.users) {
    if (!user.active) continue;
    if (user.isGM) continue;
    if (actor.testUserPermission(user, 'OWNER')) return user.id;
  }
  return game.users.find(u => u.active && u.isGM)?.id ?? null;
}

/**
 * Find the userId of the active user who controls (owns) the given actor.
 * Same logic — used to route responses back correctly.
 */
export function _findUserIdForActor(actor) {
  if (!actor) return null;
  for (const user of game.users) {
    if (!user.active) continue;
    if (actor.testUserPermission(user, 'OWNER')) return user.id;
  }
  return game.users.find(u => u.active && u.isGM)?.id ?? null;
}
