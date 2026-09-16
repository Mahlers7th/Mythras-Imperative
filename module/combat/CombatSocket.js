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

import { resolveTokenActor } from '../utils/actor-resolution.js';

const SOCKET_NAME = 'system.mythras-imperative';

// Map of exchangeId → { resolve, reject, timeout } for pending combatChallenge promises
const _pending = new Map();

// Separate map for SE opposed-roll challenges (Bleed, Trip)
const _pendingSE = new Map();

// Separate map for Luck Point decision challenges routed to an actor's owner
const _pendingLuck = new Map();

// Generic request/response channel (v1.4.333) — see CombatSocket.request.
const _pendingRequest = new Map();

/**
 * Handlers for `CombatSocket.request` / `CombatSocket.send`, by action name.
 * Each receives the decoded payload on the TARGET client and returns a
 * JSON-safe result (or nothing). Populated by `registerRequestHandler`, so the
 * modules that own each action register it themselves and this file needs no
 * static import of them.
 */
const _requestHandlers = new Map();

/** The active GM who should execute document writes, or null. */
export function activeGMUserId() {
  return game.users.find(u => u.active && u.isGM)?.id ?? null;
}

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
    const targetUserId = _findDefenderUserId(ctx.defender);

    // Defence-in-depth: both current callers already branch before reaching
    // here, but a future caller must not be able to lose a request by
    // addressing it to itself. Mirrors the combatChallenge receiver below,
    // including its "cancelled means Don't Defend" fallback.
    if (_shouldRunLocally(targetUserId)) {
      const { DefenderDialog } = await import('./DefenderDialog.js');
      return (await DefenderDialog.show(ctx, exchangeId))
        ?? { defenceType: 'none', weaponId: null, styleId: null, actorId: ctx.defender?.id ?? null };
    }

    const serialised = CombatSocket.serialiseContext(ctx);

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
    // A request addressed to this client is never delivered (see
    // _shouldRunLocally). Run it here instead — the receiving side below does
    // nothing but `_runSEDialog(payload.data)`, so the local answer is the
    // remote one by construction. Guarding HERE rather than at each caller
    // fixes all fourteen resolver call sites at once; most of them test only
    // `isSemi && !isGMMode` before socketing, with no self-check.
    if (_shouldRunLocally(targetUserId)) {
      return import('./CombatEngine.js')
        .then(({ CombatEngine }) => CombatEngine._runSEDialog(challengePayload));
    }

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
   * Ask another user's client to make a Luck Point decision for an actor they
   * own, and wait for the answer.
   *
   * **Why the decision has to travel rather than the result.** A Luck Point is
   * the player's to spend and the dialog is theirs to see or ignore; showing it
   * on the engine's client means the GM is asked to spend their players' points
   * for them. It is also a permissions fact, not only a courtesy: the engine
   * runs on the attacker's client, which cannot write to another player's actor,
   * so the charge has to happen where the owner is.
   *
   * Mirrors `seChallenge` exactly — same registry, same 5-minute timeout, same
   * "null means no" contract. A timeout is safe here in a way it is not
   * everywhere: declining a Luck Point costs nothing and changes nothing, so an
   * absent player simply does not spend.
   *
   * @param {string} exchangeId
   * @param {object} challengePayload  plain serialisable; see `_runLuckRequest`
   * @param {string} targetUserId
   * @returns {Promise<object|null>}   null = declined, timed out, or no points
   */
  luckChallenge(exchangeId, challengePayload, targetUserId) {
    return new Promise((resolve) => {
      _pendingLuck.set(exchangeId, { resolve });

      const timeout = setTimeout(() => {
        if (_pendingLuck.has(exchangeId)) {
          _pendingLuck.delete(exchangeId);
          console.warn(`Mythras Imperative | CombatSocket — luck challenge ${exchangeId} timed out`);
          resolve(null);
        }
      }, 5 * 60 * 1000);

      _pendingLuck.get(exchangeId).timeout = timeout;

      game.socket.emit(SOCKET_NAME, {
        type: 'mythras.luckChallenge',
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
   * Register the handler for a named request action. Call once per action at
   * startup, on every client — any client may be the target.
   *
   * @param {string} action
   * @param {(data: object) => Promise<*>} handler
   */
  registerRequestHandler(action, handler) {
    _requestHandlers.set(action, handler);
  },

  /**
   * Ask `targetUserId`'s client to run a named action and wait for its result.
   *
   * The generic form of `seChallenge`/`luckChallenge`, added for the three
   * v1.4.333 actions (resolve an exchange, run a card button, choose Special
   * Effects) rather than hand-rolling three more message pairs. Same contract as
   * the others: a request addressed to this client runs locally (a self-emit is
   * never delivered — see `_shouldRunLocally`), and a timeout resolves `null`.
   *
   * @param {string} action          a name registered with registerRequestHandler
   * @param {object} data            JSON-safe payload (use context-codec for ctx)
   * @param {string|null} targetUserId
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs]  defaults to five minutes
   * @returns {Promise<*|null>}
   */
  request(action, data, targetUserId, { timeoutMs = 5 * 60 * 1000 } = {}) {
    if (_shouldRunLocally(targetUserId)) {
      const handler = _requestHandlers.get(action);
      if (!handler) {
        console.error(`Mythras Imperative | no handler registered for request "${action}"`);
        return Promise.resolve(null);
      }
      return Promise.resolve().then(() => handler(data));
    }

    const requestId = foundry.utils.randomID(16);
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (_pendingRequest.has(requestId)) {
          _pendingRequest.delete(requestId);
          console.warn(`Mythras Imperative | CombatSocket — request "${action}" (${requestId}) timed out`);
          resolve(null);
        }
      }, timeoutMs);
      _pendingRequest.set(requestId, { resolve, timeout });

      game.socket.emit(SOCKET_NAME, {
        type: 'mythras.request',
        payload: { requestId, action, data, targetUserId, originUserId: game.user.id },
      });
    });
  },

  /** Send the Luck decision back to the client that asked for it. */
  luckRespond(exchangeId, responseData, originUserId) {
    game.socket.emit(SOCKET_NAME, {
      type: 'mythras.luckResponse',
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

      // Attack roll — RAW ordering (rules p.40): the attacker has already
      // rolled by the time this challenge is sent. Primitives only, no Roll
      // instance crosses the wire. Kept alongside attackerSkillTotal so the
      // defender can read both.
      attackResult:       ctx.attackResult ?? null,
      attackOutcome:      ctx.attackOutcome ?? null,

      // Difficulty & modifiers
      difficulty:         ctx.difficulty ?? 'standard',
      modifiers:          ctx.modifiers ?? 0,
      isCharge:           ctx.isCharge ?? false,
      isInterrupt:        ctx.isInterrupt ?? false,
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
    const attacker = resolveTokenActor(payload.attackerId);
    const defender = resolveTokenActor(payload.defenderId);

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
      isInterrupt:         payload.isInterrupt ?? false,
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

      // Roll results — attackResult/attackOutcome arrive already rolled (RAW
      // ordering, rules p.40 — the attacker rolls before this challenge is
      // sent). attackRoll (the live Roll instance) never crosses the wire
      // and stays null; defence hasn't happened yet, so those stay null too.
      attackRoll:          null,
      defenceRoll:         null,
      attackResult:        payload.attackResult ?? null,
      defenceResult:       null,
      attackOutcome:       payload.attackOutcome ?? null,
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

      // ── Incoming Luck decision — show the offer to the actor's owner ─────────
      // Dynamic import, matching the seChallenge case above: the socket layer
      // must not carry a static dependency on the roll modules, or the two
      // import each other (luck-point's routed wrappers call back into here).
      case 'mythras.luckChallenge': {
        if (payload.targetUserId && payload.targetUserId !== game.user.id) return;

        const { _runLuckRequest } = await import('../rolls/luck-point.js');
        let responseData = null;
        try {
          responseData = await _runLuckRequest(payload.data);
        } catch (err) {
          // Never leave the asking client hanging for the full 5 minutes
          // because of a fault on this one. A null reads as "declined", which
          // is the safe answer: nothing charged, nothing changed.
          console.error('Mythras Imperative | Luck request failed:', err);
        }

        CombatSocket.luckRespond(
          payload.exchangeId,
          responseData,
          payload.originUserId
        );
        break;
      }

      // ── Generic request — run the named action here and reply ──────────────
      case 'mythras.request': {
        if (payload.targetUserId && payload.targetUserId !== game.user.id) return;

        const handler = _requestHandlers.get(payload.action);
        let result = null;
        if (!handler) {
          console.error(`Mythras Imperative | no handler registered for request "${payload.action}"`);
        } else {
          try {
            result = await handler(payload.data);
          } catch (err) {
            // Reply regardless, so the asking client is not left waiting out
            // the timeout because of a fault on this one.
            console.error(`Mythras Imperative | request "${payload.action}" failed:`, err);
          }
        }
        game.socket.emit(SOCKET_NAME, {
          type: 'mythras.requestResponse',
          payload: { requestId: payload.requestId, result: result ?? null, targetUserId: payload.originUserId },
        });
        break;
      }

      case 'mythras.requestResponse': {
        if (payload.targetUserId && payload.targetUserId !== game.user.id) return;
        const pendingReq = _pendingRequest.get(payload.requestId);
        if (!pendingReq) return;
        clearTimeout(pendingReq.timeout);
        _pendingRequest.delete(payload.requestId);
        pendingReq.resolve(payload.result);
        break;
      }

      // ── Incoming Luck response — resume whoever asked ────────────────────────
      case 'mythras.luckResponse': {
        if (payload.targetUserId && payload.targetUserId !== game.user.id) return;

        const pendingLuck = _pendingLuck.get(payload.exchangeId);
        if (!pendingLuck) return;

        clearTimeout(pendingLuck.timeout);
        _pendingLuck.delete(payload.exchangeId);
        pendingLuck.resolve(payload.responseData);
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
/**
 * Whether a request addressed to `targetUserId` must run on THIS client
 * instead of going over the socket.
 *
 * **Foundry never delivers a socket emit back to the client that sent it.** So
 * a request addressed to yourself is not slow, it is lost: the sender waits out
 * the full five-minute timeout and then treats the defender as unable to act.
 * `_findDefenderUserId` falls back to the GM when no active player owns the
 * actor, which makes "addressed to myself" the ordinary case whenever the GM
 * runs an exchange against an NPC or an unassigned character.
 *
 * The wound-endurance path has guarded this since it was written ("self-socket
 * is unreliable in Foundry"); the main defence request and both Prepare Counter
 * requests did not, and were only ever exercised in GM Mode, which never takes
 * the socket path at all. Fixed v1.4.333 by routing every such site through
 * this one predicate.
 *
 * @param {string|null} targetUserId
 * @returns {boolean}
 */
export function _shouldRunLocally(targetUserId) {
  return !targetUserId || targetUserId === game.user.id;
}

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
