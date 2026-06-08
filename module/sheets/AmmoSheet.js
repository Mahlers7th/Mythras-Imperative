/**
 * mythras-imperative/module/sheets/AmmoSheet.js
 *
 * Item sheet for the 'ammo' item type.
 * Fields: type, quantity, enc, price, description.
 * Drag-drop target: ammo category trait items.
 */

const { ItemSheetV2 }                = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class AmmoSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ['mythras-imperative', 'mi-item-sheet', 'ammo-sheet'],
    position: { width: 480, height: 460 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {}
  };

  static PARTS = {
    sheet: {
      template: 'systems/mythras-imperative/templates/items/ammo-sheet.hbs'
    }
  };

  get title() {
    return this.document.name;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item    = this.document;
    const system  = item.system.toObject ? item.system.toObject() : { ...item.system };

    const typeLabel = {
      arrow:  'Arrow',
      bolt:   'Bolt',
      bullet: 'Bullet',
      shot:   'Shot',
      thrown: 'Thrown',
    }[system.type] ?? 'Ammo';

    // Resolve trait items for display (id + name stored; look up full item for description)
    const resolvedTraits = await Promise.all(
      (system.traits ?? []).map(async ({ id, name }) => {
        const item = game.items.get(id) ?? null;
        return { id, name, description: item?.system?.description ?? '' };
      })
    );

    return {
      ...context,
      item,
      system,
      typeLabel,
      resolvedTraits,
      typeChoices: {
        arrow:  'Arrow',
        bolt:   'Bolt',
        bullet: 'Bullet',
        shot:   'Shot',
        thrown: 'Thrown',
      }
    };
  }

  // ── Drag-drop ─────────────────────────────────────────────────────────────

  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;
    if (html && !html.dataset.miDropBound) {
      html.dataset.miDropBound = '1';
      html.addEventListener('dragover', ev => ev.preventDefault());
      html.addEventListener('drop',     ev => this._onDrop(ev));
      html.querySelectorAll('.mi-trait-remove').forEach(btn =>
        btn.addEventListener('click', ev => this._onTraitRemove(ev)));
    }
  }

  async _onDrop(ev) {
    ev.preventDefault();
    ev.stopImmediatePropagation(); // prevent base ItemSheetV2 handler from firing a second time
    let dragData;
    try { dragData = JSON.parse(ev.dataTransfer.getData('text/plain')); }
    catch(e) { return; }

    if (dragData?.type !== 'Item') return;

    let srcItem;
    try { srcItem = await fromUuid(dragData.uuid); }
    catch(e) { return; }
    if (!srcItem || srcItem.type !== 'trait') return;

    // Only accept ammo category traits
    const category = srcItem.system?.category;
    if (category !== 'ammo') {
      ui.notifications.warn(`"${srcItem.name}" is a ${category} trait, not an ammo trait.`);
      return;
    }

    const key = srcItem.system?.key;
    if (!key) {
      ui.notifications.warn('This trait has no key — cannot add to ammo.');
      return;
    }

    const current = Array.from(this.document.system.traits ?? []);
    if (current.some(t => t.id === srcItem.id)) return; // already present

    current.push({ id: srcItem.id, name: srcItem.name, key });
    await this.document.update({ 'system.traits': current });
  }

  async _onTraitRemove(ev) {
    ev.preventDefault();
    const traitId = ev.currentTarget.dataset.traitId;
    const current = Array.from(this.document.system.traits ?? []);
    const updated = current.filter(t => t.id !== traitId);
    await this.document.update({ 'system.traits': updated });
  }

  async _processSubmitData(event, form, submitData) {
    await this.document.update(submitData);
  }
}
