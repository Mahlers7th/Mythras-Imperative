/**
 * mythras-imperative/module/sheets/WeaponSheet.js
 *
 * Item sheet for melee and ranged weapon types.
 * Uses ItemSheetV2 + HandlebarsApplicationMixin, same pattern as SkillSheet.
 */

const { ItemSheetV2 }                = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class WeaponSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ['mythras-imperative', 'mi-item-sheet', 'weapon-sheet'],
    position: { width: 580, height: 580 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {}
  };

  static PARTS = {
    sheet: {
      template: 'systems/mythras-imperative/templates/items/weapon-sheet.hbs'
    }
  };

  get title() {
    return this.document.name;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item    = this.document;
    const system  = item.system.toObject ? item.system.toObject() : { ...item.system };

    // All available trait options from CONFIG (now an object map)
    const traitRegistry = CONFIG.MYTHRAS?.weaponTraits ?? {};
    const currentTraits = Array.isArray(system.traits) ? system.traits : [];

    const traitOptions = Object.entries(traitRegistry).map(([key, t]) => ({
      key,
      label:       t.label,
      description: t.description,
      checked:     currentTraits.includes(key)
    }));

    // Jammed state — read from the owning actor's base flags (null if unowned)
    const actor    = item.parent ?? null;
    const jammed   = actor ? (actor.getFlag('mythras-imperative', 'jammedWeapons') ?? {}) : {};
    const isJammed = !!jammed[item.id];

    return {
      ...context,
      item,
      system,
      traitOptions,
      isMelee:   system.category === 'melee',
      isRanged:  system.category === 'ranged',
      isFirearm: Array.isArray(system.traits) && system.traits.includes('firearm'),
      isThrown:  Array.isArray(system.traits) && system.traits.includes('thrown'),
      isJammed,

      // Loaded ammo — resolved from loadedAmmoId for display
      loadedAmmo: (() => {
        const id = system.loadedAmmoId;
        if (!id) return null;
        const ammoItem = item.parent?.items.get(id) ?? game.items.get(id) ?? null;
        return ammoItem ? { id: ammoItem.id, name: ammoItem.name } : null;
      })()
    };
  }

  // -------------------------------------------------------------------------
  // Event wiring
  // -------------------------------------------------------------------------
  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;
    html.querySelectorAll('.mi-reload-btn').forEach(btn =>
      btn.addEventListener('click', ev => this._onReload(ev)));
    html.querySelectorAll('.mi-clear-jam-btn').forEach(btn =>
      btn.addEventListener('click', ev => this._onClearJam(ev)));
    html.querySelectorAll('.mi-clear-ammo-btn').forEach(btn =>
      btn.addEventListener('click', ev => this._onClearAmmo(ev)));
    html.querySelectorAll('.mi-loaded-ammo-open').forEach(span =>
      span.addEventListener('click', ev => this._onOpenAmmo(ev)));
    if (html && !html.dataset.miDropBound) {
      html.dataset.miDropBound = '1';
      html.addEventListener('dragover', ev => ev.preventDefault());
      html.addEventListener('drop',     ev => this._onDrop(ev));
    }
  }

  // ── Ammo drag-drop ────────────────────────────────────────────────────────

  async _onDrop(ev) {
    ev.preventDefault();
    let dragData;
    try { dragData = JSON.parse(ev.dataTransfer.getData('text/plain')); }
    catch(e) { return; }

    if (dragData?.type !== 'Item') return;

    let srcItem;
    try { srcItem = await fromUuid(dragData.uuid); }
    catch(e) { return; }
    if (!srcItem || srcItem.type !== 'ammo') return;

    // Ensure the ammo item is on the same actor if possible
    const actor = this.document.parent ?? null;
    let ammoId  = srcItem.id;

    if (actor && srcItem.parent?.id !== actor.id) {
      // Copy ammo onto the actor so it appears in their inventory
      const data = srcItem.toObject();
      delete data._id;
      const [created] = await actor.createEmbeddedDocuments('Item', [data]);
      ammoId = created.id;
    }

    await this.document.update({ 'system.loadedAmmoId': ammoId });
    ui.notifications.info(`${srcItem.name} loaded into ${this.document.name}.`);
  }

  async _onClearAmmo(ev) {
    ev.preventDefault();
    await this.document.update({ 'system.loadedAmmoId': '' });
  }

  async _onOpenAmmo(ev) {
    ev.preventDefault();
    const id       = ev.currentTarget.closest('[data-ammo-id]')?.dataset.ammoId;
    if (!id) return;
    const item     = this.document;
    const ammoItem = item.parent?.items.get(id) ?? game.items.get(id) ?? null;
    if (ammoItem) ammoItem.sheet.render(true);
  }

  async _onReload(ev) {
    ev.preventDefault();
    const item    = this.document;
    const system  = item.system;

    // Firearm reload — refill magazine from system.ammoMax
    if (system.category === 'ranged' && system.traits?.includes('firearm')) {
      const ammoMax = system.ammoMax ?? 0;
      if (ammoMax <= 0) {
        ui.notifications.info(`Set Ammo (max) first — nothing to reload to.`);
        return;
      }
      await item.update({ 'system.ammo': ammoMax });
      ui.notifications.info(`${item.name} reloaded — ${ammoMax} rounds ready.`);
      return;
    }

    // Ranged non-firearm (bow, crossbow, sling) — nocking costs one ammo item.
    // Sets system.ammo = 1 (nocked) so "Ammo (loaded)" shows readiness.
    // Firing clears system.ammo back to 0. system.ammoMax = 1 (capacity is always 1 nocked arrow).
    if (system.category === 'ranged' && !system.traits?.includes('firearm')) {
      const actor = item.parent ?? null;

      // Find compatible ammo items on the actor.
      // If ammoType is set, filter by matching type; otherwise fall back to loadedAmmoId.
      let candidates = [];
      if (system.ammoType && actor) {
        candidates = actor.items.filter(
          i => i.type === 'ammo' && i.system.type === system.ammoType && (i.system.quantity ?? 0) > 0
        );
      }

      // More than one compatible ammo item — show picker dialog.
      if (candidates.length > 1) {
        const chosen = await new Promise(resolve => {
          const buttons = {};
          for (const ammoItem of candidates) {
            buttons[ammoItem.id] = {
              label: `${ammoItem.name} (${ammoItem.system.quantity} remaining)`,
              callback: () => resolve(ammoItem)
            };
          }
          buttons.cancel = { label: 'Cancel', callback: () => resolve(null) };
          new Dialog({
            title: `Nock — ${item.name}`,
            content: `<p>Choose which ammo to nock:</p>`,
            buttons,
            default: candidates[0].id
          }).render(true);
        });
        if (!chosen) return;
        const updated = (chosen.system.quantity ?? 0) - 1;
        await chosen.update({ 'system.quantity': updated });
        await item.update({ 'system.loadedAmmoId': chosen.id, 'system.ammo': 1, 'system.ammoMax': 1 });
        ui.notifications.info(`${item.name} nocked — ${chosen.name} remaining: ${updated}.`);
        if (updated === 0) ui.notifications.warn(`${chosen.name} is now empty.`);
        return;
      }

      // Single candidate from ammoType filter — nock it directly.
      if (candidates.length === 1) {
        const ammoItem = candidates[0];
        const updated = (ammoItem.system.quantity ?? 0) - 1;
        await ammoItem.update({ 'system.quantity': updated });
        await item.update({ 'system.loadedAmmoId': ammoItem.id, 'system.ammo': 1, 'system.ammoMax': 1 });
        ui.notifications.info(`${item.name} nocked — ${ammoItem.name} remaining: ${updated}.`);
        if (updated === 0) ui.notifications.warn(`${ammoItem.name} is now empty.`);
        return;
      }

      // No ammoType set or no candidates found — fall back to loadedAmmoId as before.
      if (system.loadedAmmoId) {
        const ammoItem = actor?.items?.get(system.loadedAmmoId)
                      ?? game.items.get(system.loadedAmmoId)
                      ?? null;
        if (!ammoItem) {
          ui.notifications.warn(`No ammo loaded — drag an ammo item onto the weapon first.`);
          return;
        }
        const current = ammoItem.system.quantity ?? 0;
        if (current <= 0) {
          ui.notifications.warn(`${ammoItem.name} is empty — no ammunition remaining.`);
          return;
        }
        const updated = current - 1;
        await ammoItem.update({ 'system.quantity': updated });
        await item.update({ 'system.ammo': 1, 'system.ammoMax': 1 });
        ui.notifications.info(`${item.name} nocked — ${ammoItem.name} remaining: ${updated}.`);
        if (updated === 0) ui.notifications.warn(`${ammoItem.name} is now empty.`);
        return;
      }

      ui.notifications.info(`No ammo loaded — drag an ammo item onto ${item.name} first.`);
      return;
    }
  }

  async _onClearJam(ev) {
    ev.preventDefault();
    const item  = this.document;
    const actor = item.parent ?? null;
    if (!actor) {
      ui.notifications.warn('This weapon is not owned by an actor — cannot clear jam.');
      return;
    }

    const NS     = 'mythras-imperative';
    const jammed = actor.getFlag(NS, 'jammedWeapons') ?? {};
    if (!jammed[item.id]) {
      ui.notifications.info(`${item.name} is not jammed.`);
      return;
    }

    const inCombat = game.combat?.started && game.combat.combatants.some(
      c => c.actorId === actor.id
    );

    if (inCombat) {
      const { CombatEngine } = await import('../combat/CombatEngine.js');
      const ap = actor.system.attributes?.actionPoints;
      if (!ap || ap.value <= 0) {
        ui.notifications.warn(`${actor.name} has no Action Points remaining to field-strip ${item.name}.`);
        return;
      }
      await CombatEngine._spendActionPoint(actor);
    }

    const updated = { ...jammed };
    delete updated[item.id];
    await actor.setFlag(NS, 'jammedWeapons', updated);

    await ChatMessage.create({
      content: `
        <div class="mi-chat-card">
          <div class="mi-card-header mi-card-header--stacked">
            <span class="mi-card-actor">${actor.name}</span>
            <span class="mi-card-skill">Field Strip — ${item.name}</span>
          </div>
          <div class="mi-card-body">
            <div class="mi-outcome-row">
              <span class="mi-outcome mi-outcome--success">
                <i class="fas fa-wrench"></i> Jam cleared — ${item.name} is ready to fire again
              </span>
            </div>
          </div>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor })
    });

    ui.notifications.info(`${item.name} field-stripped — jam cleared.`);
  }

  // -------------------------------------------------------------------------
  // Intercept submit — collect checked trait checkboxes into array
  // -------------------------------------------------------------------------
  async _processSubmitData(event, form, submitData) {
    // Gather all trait checkboxes from the form directly
    const checked = Array.from(form.querySelectorAll('.mi-trait-cb:checked'))
      .map(cb => cb.value);
    submitData['system.traits'] = checked;
    // Remove any stray traitsString key if present
    delete submitData['system.traitsString'];
    await this.document.update(submitData);
  }
}
