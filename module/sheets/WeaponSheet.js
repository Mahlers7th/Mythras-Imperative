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
      isJammed
    };
  }

  // -------------------------------------------------------------------------
  // Event wiring
  // -------------------------------------------------------------------------
  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;
    html.querySelectorAll('.mi-reload-btn').forEach(btn =>
      btn.addEventListener('click', ev => this._onReload(ev)));
    html.querySelectorAll('.mi-clear-jam-btn').forEach(btn =>
      btn.addEventListener('click', ev => this._onClearJam(ev)));
  }

  async _onReload(ev) {
    ev.preventDefault();
    const item    = this.document;
    const ammoMax = item.system.ammoMax ?? 0;
    if (ammoMax <= 0) {
      ui.notifications.info(`Set Ammo (max) first — nothing to reload to.`);
      return;
    }
    await item.update({ 'system.ammo': ammoMax });
    ui.notifications.info(`${item.name} reloaded — ${ammoMax} rounds ready.`);
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
