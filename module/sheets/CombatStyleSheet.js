/**
 * mythras-imperative/module/sheets/CombatStyleSheet.js
 *
 * Dedicated ItemSheetV2 for the combat-style item type.
 * Features:
 *   - Weapon drop zone — drag weapon items onto the sheet to associate them
 *   - Inline weapon pill list with remove buttons
 *   - Trait toggle pills — the 11 canonical Combat Style Traits
 *   - Bonus points, live total, description
 */

const { ItemSheetV2 }              = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class CombatStyleSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ['mythras-imperative', 'mi-item-sheet', 'combat-style-sheet'],
    position: { width: 520, height: 560 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {}
  };

  static PARTS = {
    sheet: {
      template: 'systems/mythras-imperative/templates/items/combat-style-sheet.hbs'
    }
  };

  get title() {
    return this.document.name;
  }

  // -------------------------------------------------------------------------
  // Context
  // -------------------------------------------------------------------------

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item    = this.document;
    const system  = item.system.toObject ? item.system.toObject() : { ...item.system };

    // Live total from owning actor characteristics.
    // Creature actors (MEG import) store totals directly in system.total —
    // baseFormula is empty and recomputation produces 0. Guard exactly as
    // CharacterSheet._onRoll does.
    let liveBase = system.baseValue ?? 0;
    let liveTotal = system.total ?? 0;
    if (item.actor && item.actor.type !== 'creature') {
      const c = item.actor.system.characteristics;
      const chars = {
        STR: c.str.value, CON: c.con.value, SIZ: c.siz.value,
        DEX: c.dex.value, INT: c.int.value, POW: c.pow.value, CHA: c.cha.value
      };
      liveBase  = _evalFormula(system.baseFormula ?? '', chars);
      liveTotal = liveBase + (system.bonusPoints ?? 0);
    }

    // Build trait pills from system.traits (key strings) by resolving labels
    // from CONFIG. Unknown keys (custom module traits) fall back to the key itself.
    const traitRegistry = CONFIG.MYTHRAS.combatStyleTraits ?? {};
    const traitItems = (system.traits ?? []).map(key => {
      const t = traitRegistry[key];
      return {
        key,
        name:         t?.label       ?? key,
        description:  t?.description ?? '',
        engineEffect: t?.engineEffect ?? false
      };
    });

    return {
      ...context,
      item,
      system,
      liveBase,
      liveTotal,
      traitItems,
      weapons: system.weapons ?? []
    };
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  _onRender(context, options) {
    const html = this.element;

    // Trait pill remove buttons
    html.querySelectorAll('.mi-cs-trait-remove').forEach(btn =>
      btn.addEventListener('click', ev => { ev.stopPropagation(); this._onTraitRemove(ev); }));

    // Weapon pill click — open the weapon's item sheet
    html.querySelectorAll('.mi-cs-weapon-pill').forEach(pill =>
      pill.addEventListener('click', ev => this._onWeaponOpen(ev)));

    // Weapon remove buttons — stopPropagation so pill click doesn't also fire
    html.querySelectorAll('.mi-cs-weapon-remove').forEach(btn =>
      btn.addEventListener('click', ev => { ev.stopPropagation(); this._onWeaponRemove(ev); }));

    // Drop zone — accept weapon items dragged from actor sheet or compendium
    if (options.isFirstRender) {
      html.addEventListener('dragover', ev => ev.preventDefault());
      html.addEventListener('drop',     ev => this._onDrop(ev));
    }
  }

  async _onTraitRemove(ev) {
    ev.preventDefault();
    const key     = ev.currentTarget.dataset.traitKey;
    const current = Array.from(this.document.system.traits ?? []);
    const updated = current.filter(k => k !== key);
    await this.document.update({ 'system.traits': updated });
  }

  async _onWeaponOpen(ev) {
    ev.preventDefault();
    const weaponId = ev.currentTarget.dataset.weaponId;
    // The weapon may live on the owning actor or (if this style is unowned) nowhere
    const actor  = this.document.actor;
    const weapon = actor?.items.get(weaponId);
    if (weapon) {
      weapon.sheet?.render(true);
    } else {
      // Fallback — try to find it by UUID stored on the pill (future-proofing)
      const uuid = ev.currentTarget.dataset.weaponUuid;
      if (uuid) {
        const item = await fromUuid(uuid).catch(() => null);
        item?.sheet?.render(true);
      }
    }
  }

  async _onWeaponRemove(ev) {
    ev.preventDefault();
    const weaponId = ev.currentTarget.dataset.weaponId;

    // Remove from this style's weapon list
    const current = Array.from(this.document.system.weapons ?? []);
    const updated = current.filter(w => w.id !== weaponId);
    await this.document.update({ 'system.weapons': updated });

    // Also delete the weapon item from the owning actor
    const actor  = this.document.actor;
    const weapon = actor?.items.get(weaponId);
    if (weapon) await weapon.delete();
  }

  async _onDrop(ev) {
    ev.preventDefault();
    let dragData;
    try { dragData = JSON.parse(ev.dataTransfer.getData('text/plain')); }
    catch(e) { return; }

    if (dragData?.type !== 'Item') return;

    let srcItem;
    try { srcItem = await fromUuid(dragData.uuid); }
    catch(e) { return; }
    if (!srcItem) return;

    // Route by item type
    if (srcItem.type === 'trait') {
      return this._onDropTrait(srcItem);
    }
    if (srcItem.type !== 'weapon') return;

    const actor = this.document.actor;

    // Resolve or create the weapon on the owning actor so it appears on the
    // Combat tab. Three cases:
    //   1. Weapon already owned by this actor — use it directly
    //   2. Weapon owned by a different actor or is unowned (compendium) — copy it
    //   3. This combat style has no owning actor — just record the name
    let ownedWeapon = null;
    if (actor) {
      if (srcItem.parent?.id === actor.id) {
        // Case 1 — already on this actor
        ownedWeapon = srcItem;
      } else {
        // Case 2 — copy it onto the actor
        const data = srcItem.toObject();
        delete data._id;
        const [created] = await actor.createEmbeddedDocuments('Item', [data]);
        ownedWeapon = created;
      }
    }

    // Don't add duplicate entries to the style's weapon list
    const weaponId   = ownedWeapon?.id ?? srcItem.id;
    const weaponName = ownedWeapon?.name ?? srcItem.name;
    const current    = Array.from(this.document.system.weapons ?? []);
    if (current.some(w => w.id === weaponId)) return;

    current.push({ id: weaponId, name: weaponName });
    await this.document.update({ 'system.weapons': current });
  }

  async _onDropTrait(traitItem) {
    const key = traitItem.system?.key;
    if (!key) {
      ui.notifications.warn('This item has no trait key — cannot add to combat style.');
      return;
    }
    // Only combatStyle category traits make sense here
    const category = traitItem.system?.category;
    if (category && category !== 'combatStyle') {
      ui.notifications.warn(`"${traitItem.name}" is a ${category} trait, not a combat style trait.`);
      return;
    }
    const current = Array.from(this.document.system.traits ?? []);
    if (current.includes(key)) return; // already present
    current.push(key);
    await this.document.update({ 'system.traits': current });
  }

  async _processSubmitData(event, form, submitData) {
    await this.document.update(submitData);
  }
}

// ---------------------------------------------------------------------------
// Module-level helper — same formula evaluator used by CharacterSheet
// ---------------------------------------------------------------------------
function _evalFormula(formula, chars) {
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
