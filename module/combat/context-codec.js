/**
 * mythras-imperative/module/combat/context-codec.js
 *
 * Carry a live combat context across the socket, whole.
 *
 * WHY NOT `CombatSocket.serialiseContext`
 * ----------------------------------------
 * That serialiser is a hand-maintained **allowlist**, written for one job: the
 * defender's dialog, which needs about twenty fields. Resolving an entire
 * exchange needs far more — `_targetActors`, vehicle-weapon flags, Full Auto's
 * declared rounds and results array, every field a Destined `preRoll` hook
 * writes, and anything added next month. An allowlist drops the fields it was
 * never told about, silently, and the exchange then resolves with a context
 * that is *nearly* right. That is the worst kind of failure to diagnose at a
 * table.
 *
 * So this codec is the opposite shape: it keeps **everything**, and only
 * translates the three kinds of value that cannot cross a socket.
 *
 *   - **Documents** (actors, items, chat messages) become `{ __uuid }` and are
 *     rehydrated with `fromUuidSync`. A UUID is the right key rather than an
 *     id: an unlinked token's actor has the base actor's `id` but its own
 *     `Scene.x.Token.y.Actor.z` UUID, and resolving it by id — which the
 *     allowlist serialiser does — would hand the GM the *base* actor, whose
 *     Action Points and wounds are not the ones in play.
 *   - **Rolls** become `{ __roll }` via `toJSON` and come back through
 *     `Roll.fromData`.
 *   - **Sets** become `{ __set }` arrays.
 *
 * Functions are dropped. Class instances the codec does not recognise are
 * dropped rather than flattened, because a half-copied object that looks like
 * the real thing is worse than a missing one.
 *
 * The recognisers are injectable so the codec can be tested without Foundry.
 */

const MAX_DEPTH = 8;

/** Default recognisers — the live Foundry classes, resolved lazily. */
function defaultKinds() {
  return {
    isDocument: (v) => {
      const D = globalThis.foundry?.abstract?.Document;
      return !!D && v instanceof D;
    },
    isRoll: (v) => {
      const R = globalThis.Roll;
      return !!R && v instanceof R;
    },
  };
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Encode a value for the socket.
 *
 * @param {*} value
 * @param {object} [kinds]  `{ isDocument, isRoll }` recognisers
 * @param {number} [depth]
 * @returns {*} a JSON-safe value, or `undefined` for something to drop
 */
export function encodeContext(value, kinds = defaultKinds(), depth = 0) {
  if (depth > MAX_DEPTH) return undefined;
  if (value === null || value === undefined) return value;

  const t = typeof value;
  if (t === 'function' || t === 'symbol') return undefined;
  if (t !== 'object') return value;

  if (kinds.isDocument(value)) {
    // A document without a UUID (an unsaved temporary) cannot be found again.
    return value.uuid ? { __uuid: value.uuid } : undefined;
  }
  if (kinds.isRoll(value)) {
    try { return { __roll: value.toJSON() }; } catch { return undefined; }
  }
  if (value instanceof Set) {
    return { __set: [...value].map(v => encodeContext(v, kinds, depth + 1)) };
  }
  if (Array.isArray(value)) {
    // Keep positions: a dropped element becomes null rather than shifting the
    // rest, because some arrays are read by index (Impale's two rolls).
    return value.map(v => {
      const e = encodeContext(v, kinds, depth + 1);
      return e === undefined ? null : e;
    });
  }
  if (!isPlainObject(value)) return undefined;

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const e = encodeContext(v, kinds, depth + 1);
    if (e !== undefined) out[k] = e;
  }
  return out;
}

/**
 * Decode a value produced by {@link encodeContext}.
 *
 * @param {*} value
 * @param {object} [resolvers]  `{ fromUuid, rollFromData }`
 * @returns {*}
 */
export function decodeContext(value, resolvers = defaultResolvers()) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(v => decodeContext(v, resolvers));
  if (typeof value !== 'object') return value;

  if (typeof value.__uuid === 'string') return resolvers.fromUuid(value.__uuid) ?? null;
  if (value.__roll !== undefined) {
    try { return resolvers.rollFromData(value.__roll); } catch { return null; }
  }
  if (Array.isArray(value.__set)) {
    return new Set(value.__set.map(v => decodeContext(v, resolvers)));
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = decodeContext(v, resolvers);
  return out;
}

function defaultResolvers() {
  return {
    fromUuid:     (uuid) => globalThis.fromUuidSync?.(uuid) ?? null,
    rollFromData: (data) => globalThis.Roll.fromData(data),
  };
}
