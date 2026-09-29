/**
 * mythras-imperative/module/utils/flag-entries.js
 *
 * Removing flags, and entries from object-valued flags, reliably (v1.4.363).
 *
 * Found live on Foundry v14, all with probes on throwaway actors:
 *   - `setFlag(scope, key, obj)` MERGES `obj` into the stored object, so a key
 *     deleted from `obj` stays. "delete the entry, then setFlag" never removed
 *     anything: an Entangle, Grip or Impale survived the break-free that ended
 *     it, and a cleared jam stayed jammed.
 *   - On an unlinked token's actor (its ActorDelta) NO deletion form works on a
 *     fresh delta: `unsetFlag`, `-=key`, ForcedDeletion — on the actor or on the
 *     token's `delta.*` path, whole flag or per entry — all leave it in place.
 *     Swarm tokens are exactly this case.
 *   - Writing `null` does work, on world and token actors alike, and a later
 *     setFlag onto that null stores exactly the new object.
 *
 * So nothing here deletes a key: a cleared flag reads back as `null` (every
 * reader already treats null like absent — `?? {}` / truthiness), and removing
 * entries writes the flag to null and then sets what remains.
 */

/**
 * Clear a whole flag. It reads back as `null` afterwards.
 * @param {foundry.abstract.Document} doc
 * @param {string} scope
 * @param {string} flag
 */
export async function clearFlag(doc, scope, flag) {
  if (!doc || !flag) return;
  const current = doc.getFlag?.(scope, flag);
  if (current === undefined || current === null) return;
  await doc.update({ [`flags.${scope}.${flag}`]: null });
}

/**
 * Remove entries from an object-valued flag, keeping the rest.
 * @param {foundry.abstract.Document} doc   usually an Actor (synthetic ones too)
 * @param {string} scope
 * @param {string} flag
 * @param {string[]} keys
 */
export async function removeFlagEntries(doc, scope, flag, keys) {
  const list = (keys ?? []).filter(k => k !== undefined && k !== null && k !== '');
  if (!doc || !list.length) return;
  const current = doc.getFlag?.(scope, flag);
  if (!current || typeof current !== 'object') return;
  // No "is the key still there?" shortcut: callers often `delete obj[key]` on
  // the object getFlag returned — the LIVE data — before calling this, so the
  // key already looks gone locally while the server still has it. Always write.
  const rest = { ...current };
  for (const k of list) delete rest[k];
  await doc.update({ [`flags.${scope}.${flag}`]: null });
  if (Object.keys(rest).length) await doc.setFlag(scope, flag, rest);
}
