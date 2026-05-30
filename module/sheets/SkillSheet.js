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

    // Compute live total if this skill belongs to an actor
    let liveBase  = system.baseValue ?? 0;
    let liveTotal = system.total ?? 0;

    if (item.actor) {
      const formula = system.baseFormula ?? '';
      if (!formula) {
        // No formula — stored total is authoritative (e.g. MEG-imported creature skills)
        liveBase  = system.total ?? 0;
        liveTotal = system.total ?? 0;
      } else {
        const c = item.actor.system.characteristics;
        const chars = {
          STR: c.str.value, CON: c.con.value, SIZ: c.siz.value,
          DEX: c.dex.value, INT: c.int.value, POW: c.pow.value, CHA: c.cha.value
        };
        liveBase  = this._evalFormula(formula, chars);
        liveTotal = liveBase + (system.bonusPoints ?? 0);
      }
    }

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

  _evalFormula(formula, chars) {
    if (!formula) return 0;
    let f = formula.replace(/×/g, '*');
    for (const [k, v] of Object.entries(chars)) {
      f = f.replace(new RegExp(`\\b${k}\\b`, 'gi'), v);
    }
    try {
      if (/^[\d\s+\-*/().]+$/.test(f)) return Math.floor(Function('"use strict";return(' + f + ')')());
    } catch(e) { /* ignore */ }
    return 0;
  }

  _onRender(context, options) {
    // Nothing extra needed — form submitOnChange handles all edits
  }
}
