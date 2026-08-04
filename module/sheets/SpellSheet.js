/**
 * mythras-imperative/module/sheets/SpellSheet.js
 *
 * Item sheet for the 'spell' item type. Single-form sheet, no tabs — same
 * shape as TraitSheet. Casting only works when the spell is embedded on an
 * actor (this.document.actor); opened from a compendium or the Item
 * Directory, the Cast button is hidden, same null-actor handling as every
 * other actor-dependent item sheet in this codebase.
 */

const { ItemSheetV2 }                = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class SpellSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ['mythras-imperative', 'mi-item-sheet', 'spell-sheet'],
    position: { width: 480, height: 480 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {}
  };

  static PARTS = {
    sheet: {
      template: 'systems/mythras-imperative/templates/items/spell-sheet.hbs'
    }
  };

  get title() {
    return this.document.name;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item    = this.document;
    const system  = item.system.toObject ? item.system.toObject() : { ...item.system };
    const actor   = item.actor ?? null;

    return {
      ...context,
      item,
      system,
      actor,
      hasResist: (system.traits ?? []).includes('resist')
    };
  }

  async _processSubmitData(event, form, submitData) {
    // Multiple same-name checkboxes bound to an ArrayField submit
    // positionally (one slot per checkbox, `null` for unchecked) rather
    // than collecting only the checked values — confirmed live. Strip the
    // nulls so system.traits stores a clean array of only the checked
    // Magic Traits, not e.g. [null, null, "ranged", "resist"].
    if (Array.isArray(submitData.system?.traits)) {
      submitData.system.traits = submitData.system.traits.filter(Boolean);
    }
    await this.document.update(submitData);
  }

  _onRender(context, options) {
    this.element.querySelector('.mi-btn-cast-spell')
      ?.addEventListener('click', ev => this._onCastSpell(ev));
  }

  async _onCastSpell(ev) {
    ev.preventDefault();
    const actor = this.document.actor;
    if (!actor) return;

    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      const { castSpell } = await import('../combat/effects/spellcasting.js');
      const targetToken = Array.from(game.user.targets)[0] ?? null;
      const target = targetToken?.actor ?? null;
      await castSpell(actor, this.document, target);
    } finally {
      btn.disabled = false;
    }
  }
}
