/**
 * tests/helpers/fake-foundry.js — a small stand-in for the parts of Foundry the
 * combat effect resolvers touch, so they can be tested without a running world.
 *
 * Faithful where this code has been bitten before (v1.4.362-363):
 *   - `setFlag` MERGES an object into the stored one, like Foundry — so a key
 *     deleted before setFlag survives, and a test notices.
 *   - Several tokens can share one actor id (a dragged-out swarm) while each
 *     keeps its own flags and statuses; `uuid` tells them apart.
 *   - `update({ 'flags.s.k': null })` stores null, which is how removals work.
 *
 * Call `installFoundry()` in beforeEach; it returns the recorders (chat cards,
 * notifications) and resets everything.
 */

import { DIFFICULTY_GRADES } from '../../module/utils/roll-math.js';

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function mergeInto(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (isObj(v) && isObj(target[k])) mergeInto(target[k], v);
    else target[k] = isObj(v) || Array.isArray(v) ? structuredClone(v) : v;
  }
  return target;
}

function setPath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) {
    if (!isObj(o[p])) o[p] = {};
    o = o[p];
  }
  const last = parts.at(-1);
  if (isObj(value) && isObj(o[last])) mergeInto(o[last], value);
  else o[last] = isObj(value) || Array.isArray(value) ? structuredClone(value) : value;
}

let counter = 0;
const nextId = (p = 'id') => `${p}${(++counter).toString(36).padStart(6, '0')}`;

function makeCollection(docs = []) {
  const list = [...docs];
  return {
    get: (id) => list.find(d => d.id === id),
    find: (fn) => list.find(fn),
    filter: (fn) => list.filter(fn),
    some: (fn) => list.some(fn),
    map: (fn) => list.map(fn),
    get contents() { return list; },
    get size() { return list.length; },
    push: (d) => list.push(d),
    remove: (id) => { const i = list.findIndex(d => d.id === id); if (i >= 0) list.splice(i, 1); },
    [Symbol.iterator]: () => list[Symbol.iterator](),
  };
}

/**
 * A fake Item.
 * @param {object} data  { id?, name, type, system? }
 */
export function makeItem({ id, name, type = 'weapon', system = {} } = {}) {
  return { id: id ?? nextId('item'), name, type, system: structuredClone(system), parent: null,
    async update(d) { for (const [p, v] of Object.entries(d)) setPath(this, p, v); return this; },
    async delete() { this.parent?.items.remove(this.id); } };
}

/**
 * A fake Actor. Pass `tokenId` to make it an unlinked token's synthetic actor:
 * several may share one `id` and still hold separate state.
 *
 * Flags are modelled the way Foundry holds them:
 *   - `_stored` is what the server has. Every write goes there, then the
 *     local view is rebuilt from it — so deleting a key from the object
 *     getFlag returned (the LIVE view) only lasts until the next write.
 *   - A token actor with a `base` sees the base actor's flags underneath its
 *     own (its delta), so anything written to the shared base shows up on
 *     every token of that actor — the swarm bug.
 */
export function makeActor({ id, name = 'Actor', type = 'character', tokenId = null, base = null, items = [], flags = {}, statuses = [], system = {} } = {}) {
  const actorId = id ?? base?.id ?? nextId('actor');
  const actor = {
    id: actorId, name, type, documentName: 'Actor', system: structuredClone(system),
    _stored: structuredClone(flags),
    _view: {},
    _base: base,
    _tokens: [],
    isToken: !!tokenId,
    uuid: tokenId ? `Scene.scene1.Token.${tokenId}.Actor.${actorId}` : `Actor.${actorId}`,
    token: tokenId ? { id: tokenId, object: null } : null,
    statuses: new Set(statuses),
    items: makeCollection(),
    updates: [],
    get flags() { return this._view; },
    _refresh() {
      this._view = mergeInto(structuredClone(this._base?._stored ?? {}), structuredClone(this._stored));
      for (const t of this._tokens) t._refresh();
    },
    getFlag(scope, key) { return this._view?.[scope]?.[key]; },
    async setFlag(scope, key, value) {
      this._stored[scope] ??= {};
      if (isObj(value) && isObj(this._stored[scope][key])) mergeInto(this._stored[scope][key], value);
      else this._stored[scope][key] = isObj(value) ? structuredClone(value) : value;
      this._refresh();
      return this;
    },
    async unsetFlag(scope, key) { if (this._stored[scope]) delete this._stored[scope][key]; this._refresh(); return this; },
    async update(data) {
      this.updates.push(data);
      for (const [p, v] of Object.entries(data)) {
        // `….-=key` removes the key on a world document; on an unlinked
        // token's actor (ActorDelta) Foundry was seen to ignore it — so here too.
        const del = p.match(/^(.*)\.-=([^.]+)$/);
        if (del) {
          if (this.isToken) continue;
          const parent = del[1].split('.').reduce((o, k) => o?.[k], p.startsWith('flags.') ? { flags: this._stored } : this);
          if (parent && typeof parent === 'object') delete parent[del[2]];
          continue;
        }
        if (p.startsWith('flags.')) setPath(this._stored, p.slice('flags.'.length), v);
        else setPath(this, p, v);
      }
      this._refresh();
      return this;
    },
    async toggleStatusEffect(id, { active } = {}) {
      const on = active ?? !this.statuses.has(id);
      if (on) this.statuses.add(id); else this.statuses.delete(id);
      return on;
    },
    async createEmbeddedDocuments(_type, datas) { return datas.map(d => { const it = makeItem(d); it.parent = actor; actor.items.push(it); return it; }); },
  };
  for (const it of items) { const item = it.parent !== undefined ? it : makeItem(it); item.parent = actor; actor.items.push(item); }
  if (tokenId) actor.token.object = { id: tokenId, actor, document: { id: tokenId, actorId } };
  if (base) base._tokens.push(actor);
  actor._refresh();
  return actor;
}

/**
 * Several unlinked tokens of ONE world actor — a swarm dragged out N times.
 * The shared world actor is on the returned array as `.base`; installFoundry
 * puts it in game.actors (unplaced), where the old code used to write.
 */
export function makeSwarmTokens(n, { name = 'Howler Swarm (5)', items = [] } = {}) {
  const base = makeActor({ id: nextId('swarm'), name, type: 'creature', items });
  base._unplaced = true;
  const tokens = Array.from({ length: n }, (_, i) =>
    makeActor({ base, name, type: 'creature', tokenId: `tok${i + 1}`, items: items.map(it => ({ ...it })) }));
  tokens.base = base;
  return tokens;
}

/**
 * Install the fake globals. Returns { chat, notes, settings }.
 * @param {{ actors?: object[], settings?: object, rolls?: number[] }} [opts]
 */
export function installFoundry(opts = {}) {
  const { actors = [], settings = {} } = opts;
  const chat = [];
  const notes = [];
  const allSettings = { automationLevel: 'semi', gmMode: true, weaponReach: false, ...settings };
  const tokenActors = actors.filter(a => a.isToken);
  const bases = [...new Set(tokenActors.map(a => a._base).filter(Boolean))];
  const worldActors = makeCollection([...actors.filter(a => !a.isToken), ...bases.filter(b => !actors.includes(b))]);
  const placeables = [
    ...tokenActors.map(a => a.token.object),
    ...worldActors.contents.filter(a => !a._unplaced).map(a => ({ id: `ph-${a.id}`, actor: a, document: { id: `ph-${a.id}`, actorId: a.id } })),
  ];
  globalThis.game = {
    settings: { get: (_ns, key) => allSettings[key], set: async (_ns, key, v) => { allSettings[key] = v; } },
    user: { id: 'gm', isGM: true, targets: new Set() },
    users: makeCollection([{ id: 'gm', isGM: true, active: true, name: 'Gamemaster' }]),
    actors: worldActors,
    scenes: { contents: [{ tokens: { contents: tokenActors.map(a => ({ actorLink: false, actor: a })) } }] },
    combat: null,
    combats: { active: null },
    messages: { get: () => null, contents: [] },
    i18n: { localize: (k) => k, format: (k) => k },
    system: { api: {} },
  };
  globalThis.canvas = { tokens: { placeables, get: (id) => placeables.find(p => p.id === id) ?? null } };
  globalThis.ChatMessage = {
    create: async (data) => { const m = { id: nextId('msg'), ...data }; chat.push(m); return m; },
    getSpeaker: ({ actor } = {}) => ({ alias: actor?.name }),
  };
  globalThis.ui = { notifications: {
    info: (m) => notes.push(['info', m]), warn: (m) => notes.push(['warn', m]), error: (m) => notes.push(['error', m]),
  } };
  globalThis.foundry = { utils: {
    randomID: (n = 8) => nextId('r').slice(-n),
    deepClone: (v) => structuredClone(v),
    mergeObject: (a, b) => mergeInto(structuredClone(a ?? {}), b ?? {}),
    duplicate: (v) => structuredClone(v),
  } };
  globalThis.Hooks = { on: () => 0, once: () => 0, off: () => {}, call: () => true, callAll: () => true };
  // The real grade table (pure, from roll-math.js); fatigue kept to 'fresh'.
  globalThis.CONFIG = { MYTHRAS: {
    difficultyGrades: Object.fromEntries(Object.entries(DIFFICULTY_GRADES).map(([k, v]) => [k, { label: k, ...v }])),
    fatigueLevels: [{ id: 'fresh', skillGrade: null }],
    conditionGradeHooks: [],
  } };
  // Dice: each evaluated Roll takes the next scripted total (default 50).
  const rolls = [...(opts.rolls ?? [])];
  globalThis.Roll = class {
    constructor(formula) { this.formula = formula; this.total = null; }
    async evaluate() { this.total = rolls.length ? rolls.shift() : 50; return this; }
    toJSON() { return { formula: this.formula, total: this.total }; }
  };
  globalThis.fromUuidSync = (uuid) => actors.find(a => a.uuid === uuid) ?? null;
  return { chat, notes, settings: allSettings };
}

/** Plain text of every chat card posted so far. */
export const chatText = (chat) => chat.map(m => String(m.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
