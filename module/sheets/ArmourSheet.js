/**
 * mythras-imperative/module/sheets/ArmourSheet.js
 *
 * Item sheet for armour items.
 * Same pattern as WeaponSheet — ItemSheetV2 + HandlebarsApplicationMixin.
 */

const { ItemSheetV2 }                = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class ArmourSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ['mythras-imperative', 'mi-item-sheet', 'armour-sheet'],
    position: { width: 460, height: 440 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {}
  };

  static PARTS = {
    sheet: {
      template: 'systems/mythras-imperative/templates/items/armour-sheet.hbs'
    }
  };

  get title() {
    return this.document.name;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item    = this.document;
    const system  = item.system.toObject ? item.system.toObject() : { ...item.system };

    // Build a flat array of location objects for the template
    // Order matches the humanoid hit location table top-to-bottom
    const locationDefs = [
      { key: 'head',     label: 'Head'      },
      { key: 'chest',    label: 'Chest'     },
      { key: 'abdomen',  label: 'Abdomen'   },
      { key: 'rightArm', label: 'Right Arm' },
      { key: 'leftArm',  label: 'Left Arm'  },
      { key: 'rightLeg', label: 'Right Leg' },
      { key: 'leftLeg',  label: 'Left Leg'  },
    ];

    const locations = locationDefs.map(def => ({
      key:     def.key,
      label:   def.label,
      checked: system.locations?.[def.key] ?? false
    }));

    // Coverage summary for the header badge — e.g. "Head · Chest · Abdomen"
    const covered = locations.filter(l => l.checked).map(l => l.label);
    const coverageSummary = covered.length > 0 ? covered.join(' · ') : 'No locations covered';

    return {
      ...context,
      item,
      system,
      locations,
      coverageSummary
    };
  }
}
