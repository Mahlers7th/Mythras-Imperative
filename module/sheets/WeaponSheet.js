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

      // Loaded ammo — resolved from loadedAmmoId for display.
      // Must use the synthetic token actor (canvas token lookup) because
      // item.parent returns the base world actor whose items collection does
      // not contain synthetic-actor-embedded items for unlinked tokens.
      loadedAmmo: (() => {
        const id = system.loadedAmmoId;
        if (!id) return null;
        const baseActor = item.parent ?? null;
        const actorId   = baseActor?.id ?? null;
        const token     = actorId
          ? (canvas?.tokens?.placeables?.find(t => t.actor?.id === actorId || t.document?.actorId === actorId) ?? null)
          : null;
        const actor     = token?.actor ?? baseActor;
        const ammoItem  = actor?.items?.get(id) ?? game.items.get(id) ?? null;
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
    // Drop listener and click handlers registered once only — base class
    // _onRender also attaches a drop handler; we must register ours first and
    // call stopImmediatePropagation() so the base handler never fires.
    if (html && !html.dataset.miDropBound) {
      html.dataset.miDropBound = '1';
      html.addEventListener('dragover', ev => ev.preventDefault());
      html.addEventListener('drop',     ev => this._onDrop(ev));
      html.querySelectorAll('.mi-reload-btn').forEach(btn =>
        btn.addEventListener('click', ev => this._onReload(ev)));
      html.querySelectorAll('.mi-clear-jam-btn').forEach(btn =>
        btn.addEventListener('click', ev => this._onClearJam(ev)));
      html.querySelectorAll('.mi-clear-ammo-btn').forEach(btn =>
        btn.addEventListener('click', ev => this._onClearAmmo(ev)));
      html.querySelectorAll('.mi-loaded-ammo-open').forEach(span =>
        span.addEventListener('click', ev => this._onOpenAmmo(ev)));
    }
  }

  // ── Ammo drag-drop ────────────────────────────────────────────────────────

  async _onDrop(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation(); // prevent base ItemSheetV2 handler from firing a second time
    let dragData;
    try { dragData = JSON.parse(ev.dataTransfer.getData('text/plain')); }
    catch(e) { return; }

    if (dragData?.type !== 'Item') return;

    let srcItem;
    try { srcItem = await fromUuid(dragData.uuid); }
    catch(e) { return; }
    if (!srcItem || srcItem.type !== 'ammo') return;

    const baseActor = this.document.parent ?? null;
    const system    = this.document.system;

    // Resolve through canvas token placeables to get the synthetic actor.
    // Using this.document.parent directly returns the base world actor, so
    // createEmbeddedDocuments goes to the wrong collection and the item never
    // appears on the token sheet.
    const actorId = baseActor?.id ?? null;
    const token   = actorId
      ? (canvas?.tokens?.placeables?.find(t => t.actor?.id === actorId || t.document?.actorId === actorId) ?? null)
      : null;
    const actor   = token?.actor ?? baseActor;

    // Deduplicate: if the actor already has an ammo item with the same name,
    // increment its quantity rather than creating a new copy.
    let ammoItem = actor?.items?.find(i => i.type === 'ammo' && i.name === srcItem.name) ?? null;

    if (!ammoItem) {
      if (actor && srcItem.parent?.id !== actor.id) {
        const data = srcItem.toObject();
        delete data._id;
        const [created] = await actor.createEmbeddedDocuments('Item', [data]);
        ammoItem = created;
      } else {
        ammoItem = srcItem;
      }
    } else {
      // Already exists — increment quantity by the source quantity
      const addQty = srcItem.system?.quantity ?? 1;
      await ammoItem.update({ 'system.quantity': (ammoItem.system.quantity ?? 0) + addQty });
      ui.notifications.info(`${ammoItem.name} quantity updated (${ammoItem.system.quantity + addQty} total).`);
    }

    // If no ammo is loaded yet, set this as the loaded ammo (fills the pill).
    // If ammoType is set and something is already loaded, the Reload picker handles switching.
    if (!system.loadedAmmoId) {
      await this.document.update({ 'system.loadedAmmoId': ammoItem.id });
    }

    if (system.ammoType && system.loadedAmmoId) {
      ui.notifications.info(`${srcItem.name} added to inventory — use Reload to switch ammo type.`);
    }
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

    // Resolve synthetic token actor — item.parent returns base world actor for
    // token-owned items, which has a different items collection.
    const baseActor = item.parent ?? null;
    const actorId   = baseActor?.id ?? null;
    const token     = actorId
      ? (canvas?.tokens?.placeables?.find(t => t.actor?.id === actorId || t.document?.actorId === actorId) ?? null)
      : null;
    const actor     = token?.actor ?? baseActor;

    // ── Firearm reload ──────────────────────────────────────────────────────
    if (system.category === 'ranged' && system.traits?.includes('firearm')) {
      const ammoMax = system.ammoMax ?? 0;
      if (ammoMax <= 0) {
        ui.notifications.info(`Set Ammo (max) first — nothing to reload to.`);
        return;
      }

      // If ammoType is set, show picker so player chooses which ammo to load.
      if (system.ammoType && actor) {
        const candidates = actor.items.filter(
          i => i.type === 'ammo' && i.system.type === system.ammoType && (i.system.quantity ?? 0) > 0
        );

        if (candidates.length === 0) {
          ui.notifications.warn(`No ${system.ammoType} ammo in inventory — drag ammo onto ${actor.name} first.`);
          return;
        }

        let chosen = candidates.length === 1 ? candidates[0] : null;

        if (!chosen) {
          chosen = await new Promise(resolve => {
            const rows = candidates.map(a =>
              `<div class="mi-ammo-pick-row" data-id="${a.id}" style="display:flex;align-items:center;justify-content:space-between;padding:6px 14px;cursor:pointer;border-bottom:1px solid var(--mi-paper-3);">
                <span style="font-weight:600;color:var(--mi-ink);">${a.name}</span>
                <span style="color:var(--mi-ink-3);font-size:11px;">${a.system.quantity} remaining</span>
              </div>`
            ).join('');
            const content = `<div style="padding:8px 0 4px;">
              <div style="padding:4px 14px 8px;color:var(--mi-ink-3);font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Choose ammo to load</div>
              ${rows}
            </div>`;
            const d = new Dialog({
              title: `Reload — ${item.name}`,
              content,
              buttons: { cancel: { label: 'Cancel', callback: () => resolve(null) } },
              default: 'cancel',
              render: html => {
                html[0].querySelectorAll('.mi-ammo-pick-row').forEach(row => {
                  row.addEventListener('mouseenter', () => row.style.background = 'var(--mi-teal-bg)');
                  row.addEventListener('mouseleave', () => row.style.background = '');
                  row.addEventListener('click', () => {
                    const picked = candidates.find(a => a.id === row.dataset.id) ?? null;
                    resolve(picked);
                    d.close();
                  });
                });
              },
              close: () => resolve(null)
            }, { classes: ['mi-dialog', 'mi-ammo-picker-dialog'], width: 320 });
            d.render(true);
          });
          if (!chosen) return;
        }

        await item.update({ 'system.loadedAmmoId': chosen.id, 'system.ammo': ammoMax });
        ui.notifications.info(`${item.name} loaded with ${chosen.name} — ${ammoMax} rounds ready.`);
        return;
      }

      // No ammoType — plain reload, no picker needed.
      await item.update({ 'system.ammo': ammoMax });
      ui.notifications.info(`${item.name} reloaded — ${ammoMax} rounds ready.`);
      return;
    }

    // ── Ranged non-firearm (bow, crossbow, sling) — nock from inventory ────
    if (system.category === 'ranged' && !system.traits?.includes('firearm')) {
      let candidates = [];
      if (system.ammoType && actor) {
        candidates = actor.items.filter(
          i => i.type === 'ammo' && i.system.type === system.ammoType && (i.system.quantity ?? 0) > 0
        );
      }

      const nock = async (ammoItem) => {
        const updated = (ammoItem.system.quantity ?? 0) - 1;
        await ammoItem.update({ 'system.quantity': updated });
        await item.update({ 'system.loadedAmmoId': ammoItem.id, 'system.ammo': 1, 'system.ammoMax': 1 });
        ui.notifications.info(`${item.name} nocked — ${ammoItem.name} remaining: ${updated}.`);
        if (updated === 0) ui.notifications.warn(`${ammoItem.name} is now empty.`);
      };

      if (candidates.length > 1) {
        const chosen = await new Promise(resolve => {
          const rows = candidates.map(a =>
            `<div class="mi-ammo-pick-row" data-id="${a.id}" style="display:flex;align-items:center;justify-content:space-between;padding:6px 14px;cursor:pointer;border-bottom:1px solid var(--mi-paper-3);">
              <span style="font-weight:600;color:var(--mi-ink);">${a.name}</span>
              <span style="color:var(--mi-ink-3);font-size:11px;">${a.system.quantity} remaining</span>
            </div>`
          ).join('');
          const content = `<div style="padding:8px 0 4px;">
            <div style="padding:4px 14px 8px;color:var(--mi-ink-3);font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Choose ammo to nock</div>
            ${rows}
          </div>`;
          const d = new Dialog({
            title: `Nock — ${item.name}`,
            content,
            buttons: { cancel: { label: 'Cancel', callback: () => resolve(null) } },
            default: 'cancel',
            render: html => {
              html[0].querySelectorAll('.mi-ammo-pick-row').forEach(row => {
                row.addEventListener('mouseenter', () => row.style.background = 'var(--mi-teal-bg)');
                row.addEventListener('mouseleave', () => row.style.background = '');
                row.addEventListener('click', () => {
                  const picked = candidates.find(a => a.id === row.dataset.id) ?? null;
                  resolve(picked);
                  d.close();
                });
              });
            },
            close: () => resolve(null)
          }, { classes: ['mi-dialog', 'mi-ammo-picker-dialog'], width: 320 });
          d.render(true);
        });
        if (!chosen) return;
        await nock(chosen);
        return;
      }

      if (candidates.length === 1) {
        await nock(candidates[0]);
        return;
      }

      if (system.loadedAmmoId) {
        const ammoItem = actor?.items?.get(system.loadedAmmoId) ?? game.items.get(system.loadedAmmoId) ?? null;
        if (!ammoItem) { ui.notifications.warn(`No ammo loaded — drag an ammo item onto the weapon first.`); return; }
        const current = ammoItem.system.quantity ?? 0;
        if (current <= 0) { ui.notifications.warn(`${ammoItem.name} is empty.`); return; }
        await nock(ammoItem);
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
