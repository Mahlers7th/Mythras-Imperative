/**
 * mythras-imperative/module/rolls/luck-replenish.js
 *
 * Session replenishment for Luck Points.
 *
 * THE RULE
 * --------
 * *"Once a Luck Point is spent, the pool decreases; when one is out of Luck
 * Points, no more are available — unless the Games Master makes an impromptu
 * award — until the next game session when they replenish to their normal
 * value."* (Imperative p.7, restated p.33: *"Luck Points can be used during
 * play and, at the beginning of the next session, replenish to their usual
 * value."*)
 *
 * WHY THIS IS MANUAL AND NOT A HOOK
 * ---------------------------------
 * Foundry has no concept of a "session". The nearest automatic signals — world
 * startup, a user connecting, a new combat — are all wrong: a GM who restarts
 * the server mid-evening, or who preps a scene on a Sunday afternoon, would
 * silently have every pool refilled. Refilling is also strictly generous and
 * therefore invisible when wrong: nobody notices they were handed points they
 * had already spent. So the GM says when a session begins, and sees what the
 * refill will do before it happens.
 *
 * WHY "NORMAL VALUE" IS THE DERIVED MAX
 * -------------------------------------
 * `attributes.luckPoints.max` is recomputed every prepare pass from POW, the
 * Hero Level advantages, and `luckPointsHooks` (CharacterData#prepareDerivedData).
 * The stored value is overwritten, so the prepared max is the only correct
 * reading of "normal value" — and it already accounts for a module's grant
 * (Destined's Lucky x2 / Mega Lucky x4).
 *
 * Writing `value = max` is safe against the same prepare pass, which clamps
 * `value > max` back down: the write is exactly max, never above it.
 */

/**
 * Decide which actors a replenishment would touch, and by how much.
 *
 * Pure — reads only the objects it is handed, performs no updates and touches
 * no globals, so the selection rule can be tested without a live world.
 *
 * **Who is included: actors of type `character`.** Luck Points *"help
 * differentiate heroes from the rank and file"*, and in this system that line
 * is the actor type — `character` is the PC sheet, while `npc`, `creature`,
 * `merchant` and `vehicle` are the rank and file.
 *
 * **It is deliberately not `hasPlayerOwner`.** That was the first rule tried
 * here and live testing killed it: in the Destined campaign world every PC
 * (Nex, Nocturne, Mimic) is `type: 'character'` with ownership assigned to the
 * GM user alone, so `hasPlayerOwner` is `false` for all three and the plan came
 * back empty — the rule excluded precisely the characters it exists to serve.
 * Ownership records who may *open a sheet*, which is a table's seating
 * arrangement, not a statement about who is a hero. Plenty of GMs run PCs
 * unassigned, or prep a world before players have accounts at all.
 *
 * @param {Actor[]} actors             candidates, normally `game.actors`
 * @param {object}  [opts]
 * @param {boolean} [opts.includeAll]  include every actor with a pool, whatever
 *   its type — for a GM treating a named NPC ally as heroic
 * @returns {{actor: Actor, name: string, current: number, max: number, restored: number}[]}
 *   every eligible actor — including those already full, which the dialog
 *   reports as "already full" rather than hiding, so the GM can see that the
 *   actor was considered and is not missing
 */
export function luckReplenishPlan(actors, { includeAll = false } = {}) {
  const rows = [];
  for (const actor of actors ?? []) {
    const luck = actor?.system?.attributes?.luckPoints;
    if (!luck) continue;

    const max = Number(luck.max);
    // A non-finite or non-positive max means this actor type has no meaningful
    // pool (vehicles, or a creature whose POW never produced one). Skip rather
    // than write a zero.
    if (!Number.isFinite(max) || max <= 0) continue;

    if (!includeAll && actor.type !== 'character') continue;

    const current = Number(luck.value);
    const value   = Number.isFinite(current) ? current : 0;
    rows.push({
      actor,
      name:     actor.name ?? '(unnamed)',
      current:  value,
      max,
      restored: Math.max(0, max - value),
    });
  }

  // Those actually gaining points first, then alphabetically — the GM's eye
  // goes to what is about to change.
  return rows.sort((a, b) =>
    (b.restored > 0) - (a.restored > 0) || a.name.localeCompare(b.name));
}

/**
 * Apply a plan produced by {@link luckReplenishPlan}.
 *
 * Rows already at max are skipped rather than written, so a second run in the
 * same session is a no-op rather than a pile of empty update calls.
 *
 * Updates are issued per actor rather than through `Actor.updateDocuments`
 * because the candidates can span collections — world actors and unlinked
 * token actors both satisfy the plan's shape, and only the former share an
 * update context.
 *
 * @param {ReturnType<typeof luckReplenishPlan>} plan
 * @returns {Promise<{updated: number, failed: {name: string, error: string}[]}>}
 */
export async function applyLuckReplenish(plan) {
  const failed = [];
  let updated  = 0;

  for (const row of plan ?? []) {
    if (row.restored <= 0) continue;
    try {
      await row.actor.update({ 'system.attributes.luckPoints.value': row.max });
      updated += 1;
    } catch (err) {
      // One bad actor must not abort the rest of the party.
      failed.push({ name: row.name, error: err?.message ?? String(err) });
      console.error(`Mythras | Luck replenishment failed for ${row.name}`, err);
    }
  }

  return { updated, failed };
}

/**
 * Summarise a plan as the dialog's table.
 *
 * Pure, and separate from the dialog so the wording can be asserted in tests.
 *
 * @param {ReturnType<typeof luckReplenishPlan>} plan
 * @returns {string} HTML
 */
export function luckReplenishSummary(plan) {
  if (!plan?.length) {
    return `<p>${game.i18n.localize('MYTHRAS.LuckReplenishNobody')}</p>`;
  }

  const rows = plan.map(row => {
    const change = row.restored > 0
      ? `<strong>${row.current} &rarr; ${row.max}</strong> <span class="mi-muted">(+${row.restored})</span>`
      : `<span class="mi-muted">${row.current} / ${row.max} &mdash; ${game.i18n.localize('MYTHRAS.LuckReplenishFull')}</span>`;
    return `<tr><td>${row.name}</td><td>${change}</td></tr>`;
  }).join('');

  return `<table class="mi-luck-replenish"><tbody>${rows}</tbody></table>`;
}

/**
 * The GM-facing entry point: show what will change, then do it.
 *
 * Exposed on `game.system.api.replenishLuckPoints` so it can be bound to a
 * hotbar macro (`game.system.api.replenishLuckPoints()`) or called by a module
 * that owns its own session lifecycle.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.includeAll]  include every actor with a pool, whatever its type
 * @param {Actor[]} [opts.actors]      override the candidate list
 * @returns {Promise<{updated: number, failed: object[]}|null>} null if cancelled
 */
export async function replenishLuckPoints({ includeAll = false, actors } = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize('MYTHRAS.LuckReplenishGMOnly'));
    return null;
  }

  const plan = luckReplenishPlan(actors ?? game.actors, { includeAll });
  const gaining = plan.filter(r => r.restored > 0);

  const confirmed = await new Promise(resolve => {
    // Dialog callbacks are not awaited (system-CLAUDE.md), so a synchronously
    // set flag is the only reliable guard against close() resolving too.
    let resolved = false;
    const pick = (v) => { resolved = true; resolve(v); };

    const buttons = {
      cancel: {
        icon:     '<i class="fas fa-times"></i>',
        label:    game.i18n.localize('MYTHRAS.Cancel'),
        callback: () => pick(false),
      },
    };
    // No confirm button when nothing would change — an enabled "Replenish"
    // that provably does nothing is worse than not offering it.
    if (gaining.length) {
      buttons.replenish = {
        icon:     '<i class="fas fa-clover"></i>',
        label:    game.i18n.localize('MYTHRAS.LuckReplenishConfirm'),
        callback: () => pick(true),
      };
    }

    new Dialog({
      title:   game.i18n.localize('MYTHRAS.LuckReplenishTitle'),
      content: `<div class="mi-luck-dialog">
        <p>${game.i18n.localize('MYTHRAS.LuckReplenishPrompt')}</p>
        ${luckReplenishSummary(plan)}
      </div>`,
      buttons,
      default: gaining.length ? 'replenish' : 'cancel',
      close:   () => { if (!resolved) resolve(false); },
    }, { classes: ['dialog', 'mi-dialog'] }).render(true);
  });

  if (!confirmed) return null;

  const result = await applyLuckReplenish(plan);
  if (result.updated) {
    ui.notifications.info(
      game.i18n.format('MYTHRAS.LuckReplenishDone', { count: result.updated }));
  }
  if (result.failed.length) {
    ui.notifications.error(
      game.i18n.format('MYTHRAS.LuckReplenishFailed', { count: result.failed.length }));
  }
  return result;
}
