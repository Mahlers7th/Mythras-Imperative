/**
 * mythras-imperative/module/sheets/VehicleSheet.js
 *
 * Actor sheet for the 'vehicle' actor type.
 * Two-tab layout using the same spine pattern as CharacterSheet:
 *
 *   Overview  — stats bar, track row, traits, description, GM notes
 *   Combat    — crew roster, named system slots, weapons, 1d10 damage table
 *
 * Drop handler accepts:
 *   • trait items (category must be 'vehicle') → any tab
 *   • weapon items → Combat tab (but accepted anywhere for convenience)
 *   • Actor documents → adds to crew roster
 *
 * Named system slots: hits are incremented/decremented via +/− buttons.
 * System components are embedded hit-location items on the vehicle actor.
 * The 1d10 System Component Damage table is resolved by range lookup on those items.
 *
 * Crew roster: Actor UUIDs stored in system.crew[]. Cached name shown when
 * uuid resolves; fallback to cachedName if actor is unavailable.
 */

const { ActorSheetV2 }               = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

const SPEED_STEPS = [
  'ponderous', 'sluggish', 'slow', 'mediocre', 'gentle',
  'moderate', 'rapid', 'fast', 'fleet', 'supersonic'
];
const SPEED_LABELS = {
  ponderous: 'Ponderous', sluggish: 'Sluggish', slow: 'Slow',
  mediocre: 'Mediocre', gentle: 'Gentle', moderate: 'Moderate',
  rapid: 'Rapid', fast: 'Fast', fleet: 'Fleet', supersonic: 'Supersonic'
};

const TRAITS_BY_SIZE = {
  small: 1, medium: 2, large: 3, huge: 4, enormous: 5, colossal: 6
};

// 1d10 System Component Damage table (rulebook p.59) — displayed as reference
const SYSTEM_DAMAGE_TABLE = [
  { roll: '1',   system: 'Cargo',        damaged: 'Proportional cargo destroyed.',                              destroyed: 'All cargo destroyed.'                              },
  { roll: '2',   system: 'Comms',        damaged: 'Comms rolls +1 difficulty grade each hit.',                  destroyed: 'Vehicle cannot communicate or spoof sensors.'      },
  { roll: '3',   system: 'Controls',     damaged: 'Drive/Pilot +1 difficulty grade; immediate Control roll.',   destroyed: 'Vehicle cannot be steered or change course.'       },
  { roll: '4',   system: 'Drive',        damaged: 'Speed reduced proportionally to damage.',                    destroyed: 'Vehicle stopped dead; aircraft crash.'              },
  { roll: '5',   system: 'Crew',         damaged: 'Proportional passengers take Major Wound; Endurance or die.',destroyed: 'All vehicle occupants die.'                        },
  { roll: '6',   system: 'Engine / Fuel',damaged: 'Max Speed halved; electronics +1 difficulty grade.',        destroyed: 'Vehicle destroyed in explosion.'                    },
  { roll: '7',   system: 'Sensors',      damaged: 'Sensor/Nav/Weapon attacks +1 difficulty grade each hit.',   destroyed: 'Vehicle rendered blind.'                           },
  { roll: '8',   system: 'Weapons',      damaged: 'Proportional weapon systems become inoperative.',           destroyed: 'Vehicle cannot fire weapons.'                      },
  { roll: '9–10',system: 'None',         damaged: 'Structure damage only.',                                     destroyed: '—'                                                 }
];

export class VehicleSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  _activeTab = 'overview';

  static DEFAULT_OPTIONS = {
    classes:  ['mythras-imperative', 'mythras-sheet', 'vehicle-sheet'],
    position: { width: 780, height: 700 },
    window:   { resizable: true },
    form:     { submitOnChange: true, closeOnSubmit: false },
    actions:  {}
  };

  static PARTS = {
    sheet: {
      template: 'systems/mythras-imperative/templates/actors/vehicle-sheet.hbs'
    }
  };

  get title() { return this.document.name; }

  // ---------------------------------------------------------------------------
  // Context
  // ---------------------------------------------------------------------------

  async _prepareContext(_options) {
    const actor  = this.document;
    const system = actor.system;

    // Items
    const allItems    = Array.from(actor.items);
    const traitItems  = allItems.filter(i => i.type === 'trait')
      .sort((a, b) => a.name.localeCompare(b.name));
    const weaponItems = allItems.filter(i => i.type === 'weapon')
      .sort((a, b) => a.name.localeCompare(b.name));

    // Traits
    const maxTraits  = TRAITS_BY_SIZE[system.size] ?? 2;
    const traitCount = traitItems.length;
    const traits = traitItems.map(item => ({
      id: item.id, name: item.name, img: item.img,
      desc: item.system.description ?? ''
    }));

    // Weapons
    const weapons = weaponItems.map(item => {
      const sys = item.system.toObject ? item.system.toObject() : { ...item.system };
      return {
        id: item.id, name: item.name, img: item.img,
        damage: sys.damage ?? '—',
        range:  sys.range  ?? '—',
        load:   sys.load   ?? '—'
      };
    });

    // Speed options
    const speedOptions = SPEED_STEPS.map(s => ({
      value: s, label: SPEED_LABELS[s], selected: s === system.speed
    }));

    // System components — hit-location items on the vehicle actor
    const systemItems = allItems
      .filter(i => i.type === 'hit-location')
      .sort((a, b) => (a.system.sort ?? 0) - (b.system.sort ?? 0));

    const systemSlots = systemItems.map(item => {
      const s         = item.system;
      const hp        = s.hp      ?? 1;
      const current   = s.current ?? hp;
      const woundClass = current >= hp  ? ''
                       : current <= 0   ? 'mi-wound-major'
                       : current / hp <= 0.5 ? 'mi-wound-serious'
                       : 'mi-wound-minor';
      const stateLabel = current >= hp  ? 'Intact'
                       : current <= 0   ? 'Destroyed'
                       : 'Damaged';
      return {
        itemId:     item.id,
        label:      s.label,
        range:      s.rangeMin === s.rangeMax ? `${s.rangeMin}` : `${s.rangeMin}\u2013${s.rangeMax}`,
        hp,
        current,
        woundClass,
        stateLabel
      };
    });

    // Crew roster — resolve UUIDs to live actor names where possible
    const rawCrew = system.toObject ? system.toObject().crew : (system.crew ?? []);
    const crew = rawCrew.map((entry, idx) => {
      const liveActor = entry.uuid ? (game.actors?.find(a => a.uuid === entry.uuid) ?? null) : null;
      return {
        idx,
        uuid:       entry.uuid,
        name:       liveActor?.name ?? entry.cachedName ?? 'Unknown',
        role:       entry.role ?? '',
        img:        liveActor?.img ?? 'icons/svg/mystery-man.svg',
        available:  !!liveActor
      };
    });

    return {
      actor,
      system,
      activeTab:    this._activeTab,
      speedOptions,
      maxTraits,
      traitCount,
      traitOver:    traitCount > maxTraits,
      traits,
      weapons,
      systemSlots,
      systemDamageTable: SYSTEM_DAMAGE_TABLE,
      crew,
      hasShields:   (system.shields?.max ?? 0) > 0
    };
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  _onRender(_context, options) {
    const html = this.element;

    // ── Tab switching ────────────────────────────────────────────────────
    html.querySelectorAll('.mi-tab-btn').forEach(btn =>
      btn.addEventListener('click', ev => {
        ev.preventDefault();
        this._activeTab = btn.dataset.tab;
        this.render();
      })
    );

    // ── Trait: open / delete ─────────────────────────────────────────────
    html.querySelectorAll('.mi-veh-trait-name').forEach(el =>
      el.addEventListener('click', () =>
        this.document.items.get(el.dataset.itemId)?.sheet?.render(true))
    );
    html.querySelectorAll('.mi-veh-trait-delete').forEach(btn =>
      btn.addEventListener('click', async ev => {
        ev.stopPropagation();
        await this.document.deleteEmbeddedDocuments('Item', [btn.dataset.itemId]);
      })
    );

    // ── Weapon: fire (click name) / open sheet (double-click) / delete ──
    html.querySelectorAll('.mi-veh-weapon-name').forEach(el => {
      // Single click → initiate vehicle weapon attack
      el.addEventListener('click', async ev => {
        ev.stopPropagation();
        const weapon = this.document.items.get(el.dataset.itemId);
        if (!weapon) return;
        const { CombatEngine } = await import('../combat/CombatEngine.js');
        CombatEngine.initiateVehicleWeaponAttack(this.document, weapon);
      });
      // Double-click → open weapon sheet
      el.addEventListener('dblclick', ev => {
        ev.stopPropagation();
        this.document.items.get(el.dataset.itemId)?.sheet?.render(true);
      });
    });
    html.querySelectorAll('.mi-veh-weapon-delete').forEach(btn =>
      btn.addEventListener('click', async ev => {
        ev.stopPropagation();
        await this.document.deleteEmbeddedDocuments('Item', [btn.dataset.itemId]);
      })
    );

    // ── Structure / Shields track +/− ────────────────────────────────────
    html.querySelectorAll('.mi-veh-track-btn').forEach(btn =>
      btn.addEventListener('click', async () => {
        const field = btn.dataset.field;
        const delta = parseInt(btn.dataset.delta, 10);
        const parts = field.split('.');
        const sub   = this.document.system[parts[0]];
        const cur   = sub[parts[1]] ?? 0;
        const max   = sub.max ?? cur;
        const next  = Math.min(max, Math.max(0, cur + delta));
        const base  = game.actors.get(this.document.id) ?? this.document;
        await base.update({ [`system.${field}`]: next });
      })
    );
    html.querySelectorAll('.mi-veh-max-btn').forEach(btn =>
      btn.addEventListener('click', async () => {
        const field = btn.dataset.field;
        const delta = parseInt(btn.dataset.delta, 10);
        const parts = field.split('.');
        const sub   = this.document.system[parts[0]];
        const cur   = sub[parts[1]] ?? 0;
        const next  = Math.max(0, cur + delta);
        const base  = game.actors.get(this.document.id) ?? this.document;
        await base.update({ [`system.${field}`]: next });
      })
    );

    // ── System component (hit-location) field edits ─────────────────────
    html.querySelectorAll('.mi-veh-sys-field').forEach(input =>
      input.addEventListener('change', async ev => {
        const input = ev.currentTarget;
        const item  = this.document.items.get(input.dataset.itemId);
        if (!item) return;
        const val = input.type === 'number' ? Number(input.value) : input.value;
        if (input.dataset.nameField) {
          await item.update({ name: val, [input.dataset.field]: val });
        } else {
          await item.update({ [input.dataset.field]: val });
        }
      })
    );

    // ── System component delete ───────────────────────────────────────────
    html.querySelectorAll('.mi-veh-sys-delete').forEach(btn =>
      btn.addEventListener('click', async ev => {
        ev.stopPropagation();
        await this.document.deleteEmbeddedDocuments('Item', [btn.dataset.itemId]);
      })
    );

    // ── Add system component ─────────────────────────────────────────────
    html.querySelector('.mi-veh-sys-add-btn')
      ?.addEventListener('click', () => this._addSystemComponent());

    // ── Crew: open actor sheet ───────────────────────────────────────────
    html.querySelectorAll('.mi-veh-crew-name').forEach(el =>
      el.addEventListener('click', async () => {
        const uuid = el.dataset.uuid;
        if (!uuid) return;
        const a = game.actors?.find(x => x.uuid === uuid);
        a?.sheet?.render(true);
      })
    );

    // ── Crew: role edit ──────────────────────────────────────────────────
    html.querySelectorAll('.mi-veh-crew-role').forEach(input =>
      input.addEventListener('change', async () => {
        const idx  = parseInt(input.dataset.idx, 10);
        await this._updateCrewRole(idx, input.value);
      })
    );

    // ── Crew: remove ────────────────────────────────────────────────────
    html.querySelectorAll('.mi-veh-crew-delete').forEach(btn =>
      btn.addEventListener('click', async ev => {
        ev.stopPropagation();
        await this._removeCrew(parseInt(btn.dataset.idx, 10));
      })
    );

    // ── Drop ─────────────────────────────────────────────────────────────
    if (options.isFirstRender) {
      html.addEventListener('dragover', ev => {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'copy';
      });
      html.addEventListener('drop', ev => this._onDrop(ev));
    }
  }

  // ---------------------------------------------------------------------------
  // Drop handler
  // ---------------------------------------------------------------------------

  async _onDrop(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    let dragData;
    try { dragData = JSON.parse(ev.dataTransfer.getData('text/plain')); }
    catch (e) { return; }

    // Actor drop → crew
    if (dragData?.type === 'Actor') {
      let srcActor;
      try { srcActor = await fromUuid(dragData.uuid); }
      catch (e) { return; }
      if (!srcActor) return;
      if (srcActor.id === this.document.id) return;       // can't crew yourself
      if (srcActor.type === 'vehicle') {
        ui.notifications.warn('Vehicles cannot crew other vehicles.');
        return;
      }
      await this._addCrew(srcActor);
      return;
    }

    // Item drop → weapon or trait
    if (dragData?.type === 'Item') {
      let srcItem;
      try { srcItem = await fromUuid(dragData.uuid); }
      catch (e) { return; }
      if (!srcItem) return;

      if (!['trait', 'weapon'].includes(srcItem.type)) {
        ui.notifications.warn('Vehicles only accept trait and weapon items.');
        return;
      }
      if (srcItem.type === 'trait' && srcItem.system.category !== 'vehicle') {
        ui.notifications.warn('Only vehicle traits can be added to a vehicle.');
        return;
      }
      if (srcItem.parent?.id === this.document.id) return;

      const data = srcItem.toObject();
      delete data._id;
      await this.document.createEmbeddedDocuments('Item', [data]);
    }
  }

  // ---------------------------------------------------------------------------
  // System component helpers
  // ---------------------------------------------------------------------------

  async _addSystemComponent() {
    const sizeStep = { small:1, medium:2, large:3, huge:4, enormous:5, colossal:6 }[this.document.system.size] ?? 2;
    const existing = Array.from(this.document.items).filter(i => i.type === 'hit-location');
    const maxSort  = existing.reduce((m, i) => Math.max(m, i.system.sort ?? 0), -1);
    await this.document.createEmbeddedDocuments('Item', [{
      name:   'New System',
      type:   'hit-location',
      system: {
        label:    'New System',
        hp:       sizeStep,
        current:  sizeStep,
        ap:       0,
        wound:    'none',
        group:    'system',
        rangeMin: 1,
        rangeMax: 1,
        sort:     maxSort + 1
      }
    }]);
  }

  // ---------------------------------------------------------------------------
  // Crew helpers
  // ---------------------------------------------------------------------------

  async _addCrew(srcActor) {
    const base = game.actors.get(this.document.id) ?? this.document;
    const crew = (base.system.toObject ? base.system.toObject().crew : base.system.crew)
      .map(e => ({ ...e }));
    // Avoid duplicates
    if (crew.some(e => e.uuid === srcActor.uuid)) {
      ui.notifications.warn(`${srcActor.name} is already crewing this vehicle.`);
      return;
    }
    crew.push({ uuid: srcActor.uuid, cachedName: srcActor.name, role: '' });
    await base.update({ 'system.crew': crew });
  }

  async _updateCrewRole(idx, role) {
    const base = game.actors.get(this.document.id) ?? this.document;
    const crew = (base.system.toObject ? base.system.toObject().crew : base.system.crew)
      .map(e => ({ ...e }));
    if (!crew[idx]) return;
    crew[idx].role = role;
    await base.update({ 'system.crew': crew });
  }

  async _removeCrew(idx) {
    const base = game.actors.get(this.document.id) ?? this.document;
    const crew = (base.system.toObject ? base.system.toObject().crew : base.system.crew)
      .map(e => ({ ...e }));
    crew.splice(idx, 1);
    await base.update({ 'system.crew': crew });
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  async _processSubmitData(event, form, submitData) {
    await this.document.update(submitData);
  }
}
