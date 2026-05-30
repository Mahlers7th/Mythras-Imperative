/**
 * mythras-imperative/module/sheets/CurrencySheet.js
 *
 * Item sheet for the 'currency' item type.
 * Simple sheet — name, abbreviation, baseValue (read-only display),
 * quantity (editable), description.
 *
 * The baseValue is set by the currency macro and should not normally
 * be edited directly. It is shown read-only here as a reference.
 * Advanced users can override it by editing the item directly in the
 * item directory.
 */

const { ItemSheetV2 }                = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class CurrencySheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ['mythras-imperative', 'mi-item-sheet', 'currency-sheet'],
    position: { width: 420, height: 340 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {}
  };

  static PARTS = {
    sheet: {
      template: 'systems/mythras-imperative/templates/items/currency-sheet.hbs'
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
