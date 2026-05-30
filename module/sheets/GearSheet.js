/**
 * mythras-imperative/module/sheets/GearSheet.js
 *
 * Item sheet for the 'gear' item type.
 * Generic equipment — rope, torches, laptops, rations, tools, etc.
 * Fields: name, quantity, enc, price, description.
 */

const { ItemSheetV2 }                = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class GearSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ['mythras-imperative', 'mi-item-sheet', 'gear-sheet'],
    position: { width: 440, height: 380 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {}
  };

  static PARTS = {
    sheet: {
      template: 'systems/mythras-imperative/templates/items/gear-sheet.hbs'
    }
  };

  get title() {
    return this.document.name;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item    = this.document;
    const system  = item.system.toObject ? item.system.toObject() : { ...item.system };

    return {
      ...context,
      item,
      system
    };
  }

  async _processSubmitData(event, form, submitData) {
    await this.document.update(submitData);
  }
}
