/**
 * mythras-imperative/module/sheets/SkillSheet.js
 *
 * Item sheet for skill, combat-style, and passion item types.
 * Displays base formula, bonus points, total, description, and experience tracking.
 */

const { ItemSheetV2 }              = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class SkillSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ['mythras-imperative', 'mi-item-sheet', 'skill-sheet'],
    position: { width: 480, height: 420 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {}
  };

  static PARTS = {
    sheet: {
      template: 'systems/mythras-imperative/templates/items/skill-sheet.hbs'
    }
  };

  get title() {
    return this.document.name;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item    = this.document;
    // Convert TypeDataModel proxy to a plain object Handlebars can read
    const system  = item.system.toObject ? item.system.toObject() : { ...item.system };

    // An owned item's percentage is derived by its ACTOR, in
    // prepareDerivedData (deriveSkillTotals, ActorData.js), including any
    // skillBonusHooks contribution. Read the live TypeDataModel here, NOT the
    // `system` snapshot above: `toObject()` returns SOURCE data, so
    // `system.total` is the persisted value and would show a hook-less number
    // on the one sheet whose entire job is displaying that number.
    //
    // A world item with no actor has no characteristics to derive against, so
    // its stored values stand — same as before.
    const liveBase  = item.actor ? (item.system.baseValue ?? 0) : (system.baseValue ?? 0);
    const liveTotal = item.actor ? (item.system.total ?? 0)     : (system.total ?? 0);

    return {
      ...context,
      item,
      system,
      liveBase,
      liveTotal,
      isSkill:       item.type === 'skill',
      isCombatStyle: item.type === 'combat-style',
      isPassion:     item.type === 'passion'
    };
  }

  // _evalFormula removed in v1.4.311 — it was one of three byte-identical
  // copies. The single definition is evalSkillFormula in utils/skill-math.js,
  // and this sheet no longer evaluates anything: it reads the total its actor
  // derived.

  _onRender(context, options) {
    // Nothing extra needed — form submitOnChange handles all edits
  }
}
