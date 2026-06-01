/**
 * mythras-imperative/module/sheets/TraitSheet.js
 *
 * Item sheet for the 'trait' item type.
 * Simple single-form sheet — no tabs.
 * Shows category, key (read-only), description, engineEffect toggle,
 * and a placeholder graph editor button (disabled until Phase 11).
 */

const { ItemSheetV2 }                = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class TraitSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ['mythras-imperative', 'mi-item-sheet', 'trait-sheet'],
    position: { width: 480, height: 440 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {}
  };

  static PARTS = {
    sheet: {
      template: 'systems/mythras-imperative/templates/items/trait-sheet.hbs'
    }
  };

  get title() {
    return this.document.name;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item    = this.document;
    const system  = item.system.toObject ? item.system.toObject() : { ...item.system };

    const categoryLabel = {
      weapon:       'Weapon Trait',
      combatStyle:  'Combat Style Trait',
      creature:     'Creature Trait',
      vehicle:      'Vehicle Trait',
      ammo:         'Ammo Trait'
    }[system.category] ?? 'Trait';

    return {
      ...context,
      item,
      system,
      categoryLabel
    };
  }

  async _processSubmitData(event, form, submitData) {
    await this.document.update(submitData);
  }
}
