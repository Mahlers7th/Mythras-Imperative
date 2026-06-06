/**
 * mythras-imperative/module/sheets/CharacterSheet.js
 *
 * Foundry v14 ActorSheetV2 for the Character actor type.
 */

const { ActorSheetV2 }             = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Convert a hit location label to the camelCase key used by ArmourData.locations
 * and wardedLocations. Handles the standard 7 humanoid labels; unknown labels
 * fall back to a simple camelCase conversion.
 */
function _locationNameToKey(label) {
  const map = {
    'head':      'head',
    'chest':     'chest',
    'abdomen':   'abdomen',
    'right arm': 'rightArm',
    'left arm':  'leftArm',
    'right leg': 'rightLeg',
    'left leg':  'leftLeg',
  };
  return map[label?.toLowerCase()] ?? label?.replace(/\s+(.)/g, (_, c) => c.toUpperCase()).replace(/^\w/, c => c.toLowerCase()) ?? label;
}

export class CharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ['mythras-imperative', 'mythras-sheet', 'character-sheet'],
    position: { width: 880, height: 760 },
    window: { resizable: true },
    form: {
      submitOnChange: true,
      closeOnSubmit: false
    },
    actions: {}
  };

  static PARTS = {
    sheet: {
      template: 'systems/mythras-imperative/templates/actors/character-sheet.hbs'
    }
  };

  _activeTab = 'character';

  get title() {
    return this.document.name;
  }

  // -------------------------------------------------------------------------
  // Context
  // -------------------------------------------------------------------------

  async _prepareContext(options) {
    const actor  = this.document;
    const system = actor.system;

    const allItems           = Array.from(actor.items);
    const currencyItems      = allItems
      .filter(i => i.type === 'currency')
      .sort((a, b) => (b.system.baseValue ?? 1) - (a.system.baseValue ?? 1));
    const totalWealth        = currencyItems.reduce(
      (sum, c) => sum + (c.system.baseValue ?? 1) * (c.system.quantity ?? 0), 0
    );
    const standardSkills     = allItems.filter(i => i.type === 'skill' && i.system.category === 'standard')
                                       .sort((a, b) => a.name.localeCompare(b.name));
    const professionalSkills = allItems.filter(i => i.type === 'skill' && i.system.category === 'professional')
                                       .sort((a, b) => a.name.localeCompare(b.name));
    const combatStyles       = allItems.filter(i => i.type === 'combat-style');
    const passions           = allItems.filter(i => i.type === 'passion');
    const meleeWeapons       = allItems.filter(i => i.type === 'weapon' && i.system.category !== 'ranged');
    const rangedWeapons      = allItems.filter(i => i.type === 'weapon' && i.system.category === 'ranged');
    const armourItems        = allItems.filter(i => i.type === 'armour');
    const gearItems          = allItems.filter(i => i.type === 'gear');
    const ammoItems          = allItems.filter(i => i.type === 'ammo');
    const abilities          = allItems.filter(i => i.type === 'ability').sort((a, b) => a.name.localeCompare(b.name));
    const locationItems      = allItems.filter(i => i.type === 'hit-location')
                                       .sort((a, b) => (a.system.sort ?? 0) - (b.system.sort ?? 0));

    // Compute live totals — returns a map, never mutates proxies
    const totalsMap = this._calcSkillTotals(actor, [...standardSkills, ...professionalSkills, ...combatStyles, ...passions]);

    // Build plain-object skill arrays the template can safely read
    const _enrichSkill = (skill) => {
      const t = totalsMap[skill.id] ?? { base: 0, total: 0 };
      const base = {
        id:   skill.id,
        name: skill.name,
        img:  skill.img,
        system: {
          ...skill.system.toObject(),
          baseValue: t.base,
          total:     t.total
        }
      };
      // Combat styles carry weapon pills and trait pills for inline display
      if (skill.type === 'combat-style') {
        base.weaponNames  = (skill.system.weapons ?? []).map(w => w.name).filter(Boolean);
        base.activeTraits = (skill.system.traits  ?? []).map(id => {
          const t = CONFIG.MYTHRAS.combatStyleTraits?.[id];
          return t ? { id, label: t.label, engineEffect: t.engineEffect } : null;
        }).filter(Boolean);
      }
      return base;
    };

    // Weapons eligible to be used as a ward — all melee weapons on the actor.
    // Ranged weapons cannot ward in close combat so they are excluded.
    // No equipped filter: the Combat tab has no equipped toggle yet, so
    // filtering by equipped would always produce an empty list.
    const wardWeapons = allItems
      .filter(i => i.type === 'weapon' && i.system.category !== 'ranged')
      .map(w => ({ id: w.id, name: w.name }));

    const hitLocations = this._buildHitLocations(locationItems, armourItems, system);

    // Resistance skills — pulled from the totalsMap computed above
    const _resistTotal = (name) => {
      const skill = allItems.find(i => i.type === 'skill' && i.name === name);
      if (!skill) return '—';
      return (totalsMap[skill.id]?.total ?? skill.system.total ?? 0) + '%';
    };
    const resistanceSkills = [
      { label: 'Brawn',     total: _resistTotal('Brawn')     },
      { label: 'Endurance', total: _resistTotal('Endurance') },
      { label: 'Evade',     total: _resistTotal('Evade')     },
      { label: 'Willpower', total: _resistTotal('Willpower') },
    ];

    const armour = armourItems.map(a => ({
      id:             a.id,
      name:           a.name,
      img:            a.img,
      system:         a.system.toObject ? a.system.toObject() : { ...a.system },
      locationString: this._armourLocationString(a.system.locations)
    }));

    const gear = gearItems.map(g => ({
      id:       g.id,
      name:     g.name,
      img:      g.img,
      system:   g.system.toObject ? g.system.toObject() : { ...g.system },
      totalEnc: +(g.system.enc * g.system.quantity).toFixed(1)
    }));

    const currentEnc = this._calcEncumbrance(allItems);
    const encMax     = system.encumbrance?.max ?? 0;
    const encPercent = encMax > 0 ? Math.min(100, Math.round((currentEnc / encMax) * 100)) : 0;
    const encOver    = currentEnc > encMax;

    // Split standard skills evenly across two columns
    const _enrichedStandard = standardSkills.map(_enrichSkill);
    const _stdMid            = Math.ceil(_enrichedStandard.length / 2);
    const standardSkillsCol1 = _enrichedStandard.slice(0, _stdMid);
    const standardSkillsCol2 = _enrichedStandard.slice(_stdMid);

    return {
      actor,
      system,
      activeTab: this._activeTab,
      standardSkillsCol1,
      standardSkillsCol2,
      professionalSkills: professionalSkills.map(_enrichSkill),
      combatStyles:       combatStyles.map(_enrichSkill),
      passions:           passions.map(_enrichSkill),
      meleeWeapons: meleeWeapons.map(w => ({
        id:     w.id,
        name:   w.name,
        img:    w.img,
        system: w.system.toObject ? w.system.toObject() : { ...w.system }
      })),
      rangedWeapons: rangedWeapons.map(w => {
        const pr = actor.getFlag('mythras-imperative', 'pendingReload') ?? null;
        const jammed = actor.getFlag('mythras-imperative', 'jammedWeapons') ?? {};
        const isReloading = pr?.weaponId === w.id;
        const isJammed    = !!jammed[w.id];
        const sys = w.system.toObject ? w.system.toObject() : { ...w.system };
        const ammoTracked = (sys.ammoMax ?? 0) > 0;
        const canReload   = ammoTracked && !isReloading && !isJammed && (sys.ammo ?? 0) < (sys.ammoMax ?? 0);
        const outOfAmmo   = ammoTracked && (sys.ammo ?? 0) <= 0;
        return {
          id:     w.id,
          name:   w.name,
          img:    w.img,
          system: sys,
          isReloading,
          isJammed,
          reloadTurnsRemaining: isReloading ? (pr.turnsRemaining ?? 0) : 0,
          ammoTracked,
          canReload,
          outOfAmmo
        };
      }),
      armour,
      gear,
      ammoItems,
      abilities,
      currencyItems,
      totalWealth,
      hitLocations,
      wardWeapons,
      resistanceSkills,
      encPercent,
      encOver,
      isGM: game.user.isGM
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  _calcSkillTotals(actor, skills) {
    const c = actor.system.characteristics;
    const chars = {
      STR: c.str.value, CON: c.con.value, SIZ: c.siz.value,
      DEX: c.dex.value, INT: c.int.value, POW: c.pow.value, CHA: c.cha.value
    };
    const totals = {};
    for (const skill of skills) {
      // Creatures and NPCs imported from MEG have no baseFormula — their total
      // is the authoritative MEG value. Skip recalculation for those skills.
      const formula = skill.system.baseFormula ?? '';
      if (!formula) {
        const stored = skill.system.total ?? 0;
        totals[skill.id] = { base: stored, total: stored };
        continue;
      }
      const base  = this._evalFormula(formula, chars);
      const total = base + (skill.system.bonusPoints ?? 0);
      totals[skill.id] = { base, total };
      // Write to DB only when stale, no render to avoid loops
      const src = skill._source?.system ?? {};
      if (src.baseValue !== base || src.total !== total) {
        skill.update({ 'system.baseValue': base, 'system.total': total }, { render: false });
      }
    }
    return totals;
  }

  _evalFormula(formula, chars) {
    if (!formula) return 0;
    // Replace only the unicode × multiplication sign — NOT the letter X which appears in DEX
    let f = formula.replace(/×/g, '*');
    // Substitute characteristics using word boundaries, case-insensitive
    for (const [k, v] of Object.entries(chars)) {
      f = f.replace(new RegExp(`\\b${k}\\b`, 'gi'), v);
    }
    try {
      if (/^[\d\s+\-*/().]+$/.test(f)) return Math.floor(Function('"use strict";return(' + f + ')')());
    } catch(e) { /* ignore */ }
    return 0;
  }

  _buildHitLocations(locationItems, armourItems = [], system = {}) {
    const equipped   = armourItems.filter(a => a.system.equipped);
    const wardedLocs = system.wardedLocations ?? {};

    // Per-location AP reductions from Sunder SE — keyed by camelCase locKey
    const sunderedAP = this.actor?.getFlag('mythras-imperative', 'sunderedAP') ?? {};

    return locationItems.map(loc => {
      const s          = loc.system;
      const naturalAP  = s.ap ?? 0;

      // Highest AP from any single equipped armour piece covering this location.
      // Match by location id (canonical key) against armour item's locations map.
      // The location item's name is used as the key — we normalise to camelCase
      // to match the ArmourData schema keys (head, chest, abdomen, rightArm, etc.)
      const locKey = _locationNameToKey(s.label);
      let highestWornAP = 0;
      for (const piece of equipped) {
        if (piece.system.locations?.[locKey]) {
          const pieceAP = piece.system.ap ?? 0;
          if (pieceAP > highestWornAP) highestWornAP = pieceAP;
        }
      }

      // Subtract any AP permanently sundered at this specific location.
      // Sunder reduces worn AP first, then natural AP.
      const sunderAtLoc      = sunderedAP[locKey] ?? 0;
      const wornReduction    = Math.min(sunderAtLoc, highestWornAP);
      const naturalReduction = Math.min(Math.max(0, sunderAtLoc - wornReduction), naturalAP);
      const effectiveWornAP    = Math.max(0, highestWornAP - wornReduction);
      const effectiveNaturalAP = Math.max(0, naturalAP - naturalReduction);

      const totalAP    = effectiveNaturalAP + effectiveWornAP;
      const woundClass = this._woundClass(s.current, s.hp);
      const woundLevel = woundClass === 'mi-wound-major'   ? 'major'
                       : woundClass === 'mi-wound-serious' ? 'serious'
                       : woundClass === 'mi-wound-minor'   ? 'minor'
                       : 'none';

      // Ward state — keyed by the same camelCase locKey
      const warded = wardedLocs[locKey] ?? { warded: false, weaponId: '' };

      return {
        id:          loc.id,
        itemId:      loc.id,
        label:       s.label,
        range:       s.rangeMin === s.rangeMax ? `${s.rangeMin}` : `${s.rangeMin}\u2013${s.rangeMax}`,
        hp:          s.hp,
        current:     s.current,
        ap:          totalAP,
        naturalAP,
        wornAP:      highestWornAP,
        wound:       s.wound,
        group:       s.group,
        sort:        s.sort,
        woundClass,
        woundLevel,
        warded:      warded.warded,
        wardWeaponId: warded.weaponId,
        // Keep locKey so template can reference system.hitLocations if needed
        locKey
      };
    });
  }

  _woundClass(current, max) {
    if (current >= max) return '';
    const r = current / max;
    if (r <= 0)   return 'mi-wound-major';
    if (r <= 0.5) return 'mi-wound-serious';
    return 'mi-wound-minor';
  }

  _armourLocationString(locs) {
    const map = { head:'Hd', chest:'Ch', abdomen:'Ab', rightArm:'RA', leftArm:'LA', rightLeg:'RL', leftLeg:'LL' };
    return Object.entries(locs).filter(([,v]) => v).map(([k]) => map[k] ?? k).join(' ') || '—';
  }

  _calcEncumbrance(items) {
    let t = 0;
    for (const i of items) {
      if ((i.type === 'weapon' || i.type === 'armour') && i.system.equipped) t += i.system.enc ?? 0;
      else if (i.type === 'gear' || i.type === 'ammo') t += (i.system.enc ?? 0) * (i.system.quantity ?? 1);
    }
    return Math.round(t * 10) / 10;
  }

  // -------------------------------------------------------------------------
  // Render events
  // -------------------------------------------------------------------------

  _onRender(context, options) {
    const html = this.element;

    // Hero level dropdown — open advantage picker when changed away from 'normal'
    html.querySelector('.mi-hero-level-select')
      ?.addEventListener('change', ev => this._onHeroLevelChange(ev));

    // Re-pick advantages button (shown when level is already set)
    html.querySelector('.mi-hero-repick-btn')
      ?.addEventListener('click', ev => {
        ev.preventDefault();
        this._openAdvantagePicker(this.document.system.heroLevel);
      });

    // Tabs
    html.querySelectorAll('.mi-tab-btn').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.preventDefault();
        this._activeTab = btn.dataset.tab;
        this.render();
      });
    });

    // Skill name → open item sheet
    html.querySelectorAll('.mi-item-open').forEach(el =>
      el.addEventListener('click', ev => this._onItemOpen(ev)));

    // Skill total % → roll
    html.querySelectorAll('.rollable').forEach(el =>
      el.addEventListener('click', ev => this._onRoll(ev)));

    // Luck pips
    html.querySelectorAll('.mi-luck-pip').forEach((pip, i) =>
      pip.addEventListener('click', () => this._onLuckPipClick(i)));

    // Action point +/-
    html.querySelectorAll('.mi-ap-btn').forEach(btn =>
      btn.addEventListener('click', ev => this._onActionPointChange(ev)));

    // AP max +/- (GM only) — sets override implicitly on first use
    html.querySelectorAll('.mi-ap-max-btn').forEach(btn =>
      btn.addEventListener('click', ev => this._onApMaxChange(ev)));

    // Damage modifier step +/-
    html.querySelectorAll('.mi-dm-btn').forEach(btn =>
      btn.addEventListener('click', ev => this._onDmOffsetChange(ev)));

    // Experience rolls +/-
    html.querySelectorAll('.mi-exp-btn').forEach(btn =>
      btn.addEventListener('click', ev => this._onExperienceRollsChange(ev)));

    // Item controls
    html.querySelectorAll('.mi-item-delete').forEach(btn =>
      btn.addEventListener('click', ev => this._onItemDelete(ev)));
    html.querySelectorAll('.mi-item-edit').forEach(btn =>
      btn.addEventListener('click', ev => this._onItemEdit(ev)));
    html.querySelectorAll('.mi-add-btn').forEach(btn =>
      btn.addEventListener('click', ev => this._onAddItem(ev)));

    // Reload buttons — ranged weapon rows
    html.querySelectorAll('.mi-reload-btn').forEach(btn =>
      btn.addEventListener('click', ev => this._onReload(ev)));

    // Clear-jam buttons — appear on jammed firearms
    html.querySelectorAll('.mi-clear-jam-btn').forEach(btn =>
      btn.addEventListener('click', ev => this._onClearJam(ev)));

    html.querySelector('.mi-heal-all-btn')
      ?.addEventListener('click', ev => this._onHealAll(ev));

    // Inline field edits
    html.querySelectorAll('.mi-item-field').forEach(input =>
      input.addEventListener('change', ev => this._onItemFieldChange(ev)));

    // Weapon attack buttons — fire the combat engine
    html.querySelectorAll('.mi-weapon-attack').forEach(btn =>
      btn.addEventListener('click', ev => this._onAttack(ev)));

    // Damage rolls — click the damage expression on a weapon row
    html.querySelectorAll('.rollable-damage').forEach(el =>
      el.addEventListener('click', ev => this._onRollDamage(ev)));

    // Resistance skill rolls — click a resistance cell
    html.querySelectorAll('.rollable-resistance').forEach(el =>
      el.addEventListener('click', ev => this._onRollResistance(ev)));

    // Hit location drag-to-reorder — draggable is set only while the handle
    // is held down so it doesn't suppress CSS hover on the rest of the row.
    html.querySelectorAll('.mi-loc-row-contents').forEach(row => {
      const handle = row.querySelector('.mi-loc-handle');
      if (handle) {
        handle.addEventListener('mousedown', () => row.setAttribute('draggable', 'true'));
        handle.addEventListener('mouseup',   () => row.setAttribute('draggable', 'false'));
      }
      row.addEventListener('dragstart', ev => this._onLocDragStart(ev, row));
      row.addEventListener('dragover',  ev => this._onLocDragOver(ev, row));
      row.addEventListener('dragleave', ev => row.classList.remove('mi-loc-drag-over'));
      row.addEventListener('drop',      ev => this._onLocDrop(ev, row));
      row.addEventListener('dragend',   ev => {
        row.setAttribute('draggable', 'false');
        html.querySelectorAll('.mi-loc-row-contents').forEach(r => {
          r.classList.remove('mi-loc-dragging', 'mi-loc-drag-over');
        });
      });
    });

    // Hit location item field edits (AP, current HP, wound state)
    html.querySelectorAll('.mi-loc-item-field').forEach(input =>
      input.addEventListener('change', ev => this._onItemFieldChange(ev)));

    // Ward checkboxes and weapon selectors
    html.querySelectorAll('.mi-ward-checkbox').forEach(cb =>
      cb.addEventListener('change', ev => this._onWardChange(ev)));
    html.querySelectorAll('.mi-ward-weapon').forEach(sel =>
      sel.addEventListener('change', ev => this._onWardWeaponChange(ev)));

    // Drag-drop — wire ONLY on first render.
    // _onRender fires on every re-render; without this guard listeners stack
    // and each drop fires once per render cycle. isFirstRender is the correct flag.
    if (options.isFirstRender) {
      html.addEventListener('dragover', ev => ev.preventDefault());
      html.addEventListener('drop',     ev => this._onDrop(ev));

      // Weapon drag — sets { type:'Item', uuid } so combat style sheet can receive drops
      html.querySelectorAll('[data-drag="weapon"]').forEach(el => {
        el.addEventListener('dragstart', ev => {
          const itemId = el.dataset.itemId;
          const item   = this.actor.items.get(itemId);
          if (!item) return;
          ev.dataTransfer.effectAllowed = 'copy';
          ev.dataTransfer.setData('text/plain', JSON.stringify({ type: 'Item', uuid: item.uuid }));
        });
      });
    }
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  async _onAttack(ev) {
    ev.preventDefault();
    const weapon = this.document.items.get(ev.currentTarget.dataset.itemId);
    if (!weapon) return;
    const { CombatEngine } = await import('../combat/CombatEngine.js');
    await CombatEngine.initiateAttack(this.document, weapon);
  }

  async _onReload(ev) {
    ev.preventDefault();
    const baseActor = this.document;
    const actorId   = baseActor?.id ?? null;
    const token     = actorId
      ? (canvas?.tokens?.placeables?.find(t => t.actor?.id === actorId || t.document?.actorId === actorId) ?? null)
      : null;
    const actor     = token?.actor ?? baseActor;
    const weapon    = actor.items.get(ev.currentTarget.dataset.itemId);
    if (!weapon) return;

    const NS     = 'mythras-imperative';
    const system = weapon.system;
    const ammo   = system.ammo ?? 0;
    const ammoMax = system.ammoMax ?? 0;

    // ── Non-firearm ranged (bow, sling, crossbow) — nock from inventory ────
    // Uses ammoType to find compatible ammo items. Shows a picker when
    // multiple compatible items are available.
    if (system.category === 'ranged' && !system.traits?.includes('firearm')) {
      let candidates = [];
      if (system.ammoType) {
        candidates = actor.items.filter(
          i => i.type === 'ammo' && i.system.type === system.ammoType && (i.system.quantity ?? 0) > 0
        );
      }

      // Helper to nock a chosen ammo item
      const nock = async (ammoItem) => {
        const updated = (ammoItem.system.quantity ?? 0) - 1;
        await ammoItem.update({ 'system.quantity': updated });
        await weapon.update({ 'system.loadedAmmoId': ammoItem.id, 'system.ammo': 1, 'system.ammoMax': 1 });
        ui.notifications.info(`${weapon.name} nocked — ${ammoItem.name} remaining: ${updated}.`);
        if (updated === 0) ui.notifications.warn(`${ammoItem.name} is now empty.`);
      };

      if (candidates.length > 1) {
        const chosen = await new Promise(resolve => {
          const buttons = {};
          for (const ammoItem of candidates) {
            buttons[ammoItem.id] = {
              label: `${ammoItem.name} (${ammoItem.system.quantity} remaining)`,
              callback: () => resolve(ammoItem)
            };
          }
          buttons.cancel = { label: 'Cancel', callback: () => resolve(null) };
          new Dialog({
            title: `Nock — ${weapon.name}`,
            content: `<p>Choose which ammo to nock:</p>`,
            buttons,
            default: candidates[0].id
          }, { classes: ['mi-dialog', 'mi-ammo-picker-dialog'], width: 360 }).render(true);
        });
        if (!chosen) return;
        await nock(chosen);
        return;
      }

      if (candidates.length === 1) {
        await nock(candidates[0]);
        return;
      }

      // Fall back to loadedAmmoId if no ammoType filter or no candidates
      if (system.loadedAmmoId) {
        const ammoItem = actor.items.get(system.loadedAmmoId) ?? null;
        if (!ammoItem) { ui.notifications.warn(`Loaded ammo item not found on ${actor.name}.`); return; }
        const current = ammoItem.system.quantity ?? 0;
        if (current <= 0) { ui.notifications.warn(`${ammoItem.name} is empty.`); return; }
        await nock(ammoItem);
        return;
      }

      ui.notifications.warn(`No ammo in inventory — drag ammo items onto ${actor.name} first.`);
      return;
    }

    // ── Firearm reload ──────────────────────────────────────────────────────
    // If ammoMax is not configured, just set ammo to 0 (no-op reset)
    // and notify — don't block the button
    if (ammoMax <= 0) {
      await weapon.update({ 'system.ammo': 0 });
      ui.notifications.info(`${weapon.name} has no magazine capacity set — set Ammo (max) on the weapon sheet.`);
      return;
    }

    // Already full?
    if (ammo >= ammoMax) {
      ui.notifications.info(`${weapon.name} is already fully loaded.`);
      return;
    }

    // If ammoType is set, find compatible ammo items and show picker if multiple.
    // This sets loadedAmmoId so the loaded-ammo pill shows what's chambered.
    if (system.ammoType) {
      const candidates = actor.items.filter(
        i => i.type === 'ammo' && i.system.type === system.ammoType && (i.system.quantity ?? 0) > 0
      );
      console.log(`[MI Reload] ammoType=${system.ammoType} candidates:`, candidates.map(i => `${i.name} (qty:${i.system.quantity})`));

      if (candidates.length === 0) {
        ui.notifications.warn(`No ${system.ammoType} ammo in inventory — drag ammo items onto ${actor.name} first.`);
        return;
      }

      let chosen = candidates.length === 1 ? candidates[0] : null;

      if (!chosen) {
        chosen = await new Promise(resolve => {
          const buttons = {};
          for (const ammoItem of candidates) {
            buttons[ammoItem.id] = {
              label: `${ammoItem.name} (${ammoItem.system.quantity} remaining)`,
              callback: () => resolve(ammoItem)
            };
          }
          buttons.cancel = { label: 'Cancel', callback: () => resolve(null) };
          new Dialog({
            title: `Reload — ${weapon.name}`,
            content: `<p>Choose which ammo to load:</p>`,
            buttons,
            default: candidates[0].id
          }, { classes: ['mi-dialog', 'mi-ammo-picker-dialog'], width: 360 }).render(true);
        });
        if (!chosen) return;
      }

      await weapon.update({ 'system.loadedAmmoId': chosen.id });
    }
    // Guard: another weapon is already reloading
    const existing = actor.getFlag(NS, 'pendingReload') ?? null;
    if (existing) {
      const existingWeapon = actor.items.get(existing.weaponId);
      ui.notifications.warn(
        `Already reloading ${existingWeapon?.name ?? 'a weapon'} — finish that reload first.`
      );
      return;
    }

    // Check if we're in combat — if so, spend AP and track reload time
    const inCombat = game.combat?.started && game.combat.combatants.some(
      c => c.actorId === actor.id
    );

    if (inCombat) {
      // Spend 1 AP for the reload action
      const { CombatEngine } = await import('../combat/CombatEngine.js');
      const ap = actor.system.attributes?.actionPoints;
      if (!ap || ap.value <= 0) {
        ui.notifications.warn(`${actor.name} has no Action Points remaining.`);
        return;
      }
      await CombatEngine._spendActionPoint(actor);

      const load     = weapon.system.load ?? 0;
      const loadTime = load <= 1 ? 1 : load;

      if (loadTime <= 1) {
        // Instant reload (load 0 or 1) — complete immediately
        await weapon.update({ 'system.ammo': ammoMax });
        await ChatMessage.create({
          content: `
            <div class="mi-chat-card">
              <div class="mi-card-header mi-card-header--stacked">
                <span class="mi-card-actor">${actor.name}</span>
                <span class="mi-card-skill">Reload — ${weapon.name}</span>
              </div>
              <div class="mi-card-body">
                <div class="mi-outcome-row">
                  <span class="mi-outcome mi-outcome--success">
                    <i class="fas fa-redo"></i> Reloaded — ${ammoMax} rounds ready
                  </span>
                </div>
              </div>
            </div>`,
          speaker: ChatMessage.getSpeaker({ actor })
        });
      } else {
        // Multi-turn reload — set pending flag, post start card
        await actor.setFlag(NS, 'pendingReload', {
          weaponId:       weapon.id,
          turnsRemaining: loadTime - 1   // this turn counts as the first
        });
        await ChatMessage.create({
          content: `
            <div class="mi-chat-card">
              <div class="mi-card-header mi-card-header--stacked">
                <span class="mi-card-actor">${actor.name}</span>
                <span class="mi-card-skill">Reloading — ${weapon.name}</span>
              </div>
              <div class="mi-card-body">
                <div class="mi-outcome-row">
                  <span class="mi-outcome mi-outcome--info">
                    <i class="fas fa-redo"></i> Reloading… ${loadTime - 1} more Turn${loadTime - 1 > 1 ? 's' : ''} remaining
                  </span>
                </div>
              </div>
            </div>`,
          speaker: ChatMessage.getSpeaker({ actor })
        });
      }
    } else {
      // Outside combat — instant reset, no AP cost, no turn tracking
      await weapon.update({ 'system.ammo': ammoMax });
      ui.notifications.info(`${weapon.name} reloaded — ${ammoMax} rounds ready.`);
    }
  }

  // -------------------------------------------------------------------------
  // _onClearJam — field-strip a jammed firearm to clear the malfunction.
  // Costs 1 AP if in combat; instant if out of combat.
  // -------------------------------------------------------------------------
  async _onClearJam(ev) {
    ev.preventDefault();
    const actor    = this.document;
    const NS       = 'mythras-imperative';
    const weaponId = ev.currentTarget.dataset.itemId;
    const weapon   = actor.items.get(weaponId);
    if (!weapon) return;

    const jammed = actor.getFlag(NS, 'jammedWeapons') ?? {};
    if (!jammed[weaponId]) {
      ui.notifications.info(`${weapon.name} is not jammed.`);
      return;
    }

    const inCombat = game.combat?.started && game.combat.combatants.some(
      c => c.actorId === actor.id
    );

    if (inCombat) {
      const { CombatEngine } = await import('../combat/CombatEngine.js');
      const ap = actor.system.attributes?.actionPoints;
      if (!ap || ap.value <= 0) {
        ui.notifications.warn(`${actor.name} has no Action Points remaining to field-strip ${weapon.name}.`);
        return;
      }
      await CombatEngine._spendActionPoint(actor);
    }

    // Clear the jam flag for this weapon
    const updated = { ...jammed };
    delete updated[weaponId];
    await actor.setFlag(NS, 'jammedWeapons', updated);

    await ChatMessage.create({
      content: `
        <div class="mi-chat-card">
          <div class="mi-card-header mi-card-header--stacked">
            <span class="mi-card-actor">${actor.name}</span>
            <span class="mi-card-skill">Field Strip — ${weapon.name}</span>
          </div>
          <div class="mi-card-body">
            <div class="mi-outcome-row">
              <span class="mi-outcome mi-outcome--success">
                <i class="fas fa-wrench"></i> Jam cleared — ${weapon.name} is ready to fire again
              </span>
            </div>
          </div>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor })
    });

    ui.notifications.info(`${weapon.name} field-stripped — jam cleared.`);
  }

  async _onRoll(ev) {
    ev.preventDefault();
    const itemId = ev.currentTarget.dataset.itemId;
    const item   = this.document.items.get(itemId);
    if (!item) return;

    // Combat styles route to the engine when automation is enabled.
    // In manual mode the % click shows the normal skill roll dialog.
    if (item.type === 'combat-style') {
      const level = game.settings.get('mythras-imperative', 'automationLevel') ?? 'manual';
      if (level !== 'manual') {
        const { CombatEngine } = await import('../combat/CombatEngine.js');
        await CombatEngine.initiateAttackFromStyle(this.document, item);
        return;
      }
    }

    // Compute live total without mutating the TypeDataModel proxy.
    // For character/NPC actors: recompute from baseFormula + bonusPoints.
    // For creature actors: skills are stored with a flat system.total (set by
    // MEG import or manual entry) — no formula to recompute, use it directly.
    let skillTotal = item.system.total ?? 0;
    if ((item.type === 'skill' || item.type === 'combat-style' || item.type === 'passion')
        && this.document.type !== 'creature') {
      const c = this.document.system.characteristics;
      const chars = {
        STR: c.str.value, CON: c.con.value, SIZ: c.siz.value,
        DEX: c.dex.value, INT: c.int.value, POW: c.pow.value, CHA: c.cha.value
      };
      const base = this._evalFormula(item.system.baseFormula ?? '', chars);
      skillTotal = base + (item.system.bonusPoints ?? 0);
    }

    const { MythrasRoll } = await import('../rolls/MythrasRoll.js');

    // Hero advantage: grade-easier skills
    const advantages  = this.document.system.heroAdvantages ?? [];
    const skillName   = item.name.toLowerCase();
    const gradeEasier = (advantages.includes('enduranceEasier')  && skillName === 'endurance')  ||
                        (advantages.includes('stealthEasier')    && skillName === 'stealth')    ||
                        (advantages.includes('willpowerEasier')  && skillName === 'willpower');

    await MythrasRoll.rollDialog({
      actor:    this.document,
      item,
      skillTotal,
      passions: Array.from(this.document.items).filter(i => i.type === 'passion'),
      gradeEasier
    });
  }

    async _onItemOpen(ev) {
    ev.preventDefault();
    const item = this.document.items.get(ev.currentTarget.dataset.itemId);
    item?.sheet?.render(true);
  }

  async _onActionPointChange(ev) {
    ev.preventDefault();
    const ap    = this.document.system.attributes.actionPoints;
    const delta = ev.currentTarget.dataset.action === 'ap-inc' ? 1 : -1;
    const newVal = Math.max(0, Math.min(ap.max, (ap.value ?? ap.max) + delta));
    await this.document.update({ 'system.attributes.actionPoints.value': newVal });
  }

  async _onApMaxChange(ev) {
    ev.preventDefault();
    const ap    = this.document.system.attributes.actionPoints;
    const delta = ev.currentTarget.dataset.action === 'ap-max-inc' ? 1 : -1;
    const newMax = Math.max(1, (ap.max ?? 2) + delta);
    await this.document.update({
      'system.attributes.actionPoints.max':      newMax,
      'system.attributes.actionPoints.override': true,
      // Clamp current value if it now exceeds the new max
      ...(ap.value > newMax ? { 'system.attributes.actionPoints.value': newMax } : {})
    });
  }

  // ── Hero Level / Advantage Picker ────────────────────────────────────────

  // Advantage definitions — key, label, and which levels offer it
  static ADVANTAGES = [
    { key: 'actionPoint',      label: '+1 Action Point',                    levels: ['pulp','paragon'] },
    { key: 'luckyPoint',       label: '+1 Luck Point',                      levels: ['pulp'] },
    { key: 'luckyPoint2',      label: '+2 Luck Points',                     levels: ['paragon'] },
    { key: 'hitPoints',        label: '+1 Hit Point to each location',      levels: ['pulp'] },
    { key: 'hitPoints2',       label: '+2 Hit Points to each location',     levels: ['paragon'] },
    { key: 'enduranceEasier',  label: 'Endurance rolls one grade easier',   levels: ['pulp','paragon'] },
    { key: 'stealthEasier',    label: 'Stealth rolls one grade easier',     levels: ['pulp','paragon'] },
    { key: 'willpowerEasier',  label: 'Willpower rolls one grade easier',   levels: ['pulp','paragon'] },
    { key: 'healingRate',      label: 'Double Healing Rate (Minor/Serious)',levels: ['pulp','paragon'] },
  ];

  async _onHeroLevelChange(ev) {
    ev.preventDefault();
    const newLevel = ev.target.value;

    if (newLevel === 'normal') {
      // Clear advantages immediately
      await this.document.update({
        'system.heroLevel':      'normal',
        'system.heroAdvantages': []
      });
      return;
    }

    // Save the level first, then open the picker
    await this.document.update({ 'system.heroLevel': newLevel });
    this._openAdvantagePicker(newLevel);
  }

  _openAdvantagePicker(level) {
    const maxPicks   = level === 'paragon' ? 3 : 2;
    const levelLabel = level === 'paragon' ? 'Paragon' : 'Pulp Hero';
    const levelClass = `mi-adv-picker--${level}`;
    const current    = this.document.system.heroAdvantages ?? [];

    const available = CharacterSheet.ADVANTAGES.filter(a => a.levels.includes(level));

    const rows = available.map(a => {
      const isChecked = current.includes(a.key);
      return `
        <label class="mi-advantage-row${isChecked ? ' mi-advantage-row--checked' : ''}">
          <input type="checkbox" class="mi-advantage-check" value="${a.key}" ${isChecked ? 'checked' : ''}/>
          <span>${a.label}</span>
        </label>`;
    }).join('');

    new Dialog({
      title: `${levelLabel} — Choose Advantages`,
      content: `
        <div class="mi-roll-dialog">
          <div class="mi-dialog-skill-header mi-adv-picker-header ${levelClass}">
            <span class="mi-dialog-skill-name">
              <i class="fas fa-star" style="margin-right:6px;opacity:.8"></i>${levelLabel}
            </span>
            <span class="mi-adv-picker-subtitle">Choose ${maxPicks}</span>
          </div>
          <div class="mi-dialog-fields">
            <div class="mi-advantage-list ${levelClass}">${rows}</div>
          </div>
          <div class="mi-adv-picker-footer ${levelClass}">
            <span class="mi-adv-picker-note">Advantages cannot be stacked</span>
            <span class="mi-advantage-count" id="mi-adv-count">0 / ${maxPicks}</span>
          </div>
        </div>`,
      buttons: {
        apply: {
          icon:  '<i class="fas fa-check"></i>',
          label: 'Apply',
          callback: async html => {
            const checked = Array.from(html[0].querySelectorAll('.mi-advantage-check:checked'))
              .map(cb => cb.value);
            if (checked.length !== maxPicks) {
              ui.notifications.warn(`Choose exactly ${maxPicks} advantages.`);
              return false;
            }
            await this.document.update({ 'system.heroAdvantages': checked });
          }
        },
        cancel: {
          label: 'Cancel',
          callback: async () => {
            if ((this.document.system.heroAdvantages ?? []).length === 0) {
              await this.document.update({ 'system.heroLevel': 'normal' });
            }
          }
        }
      },
      default: 'apply',
      classes: ['dialog', 'mi-dialog'],
      render: html => {
        const root    = html[0];
        const countEl = root.querySelector('#mi-adv-count');
        const updateCount = () => {
          const n = root.querySelectorAll('.mi-advantage-check:checked').length;
          countEl.textContent = `${n} / ${maxPicks}`;
          countEl.classList.toggle('mi-adv-count--over', n > maxPicks);
          countEl.classList.toggle('mi-adv-count--done', n === maxPicks);
          root.querySelectorAll('.mi-advantage-check').forEach(cb => {
            if (!cb.checked) cb.disabled = n >= maxPicks;
          });
          root.querySelectorAll('.mi-advantage-row').forEach(row => {
            const cb = row.querySelector('.mi-advantage-check');
            row.classList.toggle('mi-advantage-row--checked', cb?.checked ?? false);
          });
        };
        root.querySelectorAll('.mi-advantage-check').forEach(cb =>
          cb.addEventListener('change', updateCount)
        );
        updateCount();
      }
    }).render(true);
  }

  async _onDmOffsetChange(ev) {
    ev.preventDefault();
    const delta  = ev.currentTarget.dataset.action === 'dm-inc' ? 1 : -1;
    const current = this.document.system.attributes.dmOffset ?? 0;
    // Clamp within the 15-step table (indices 0–14, so offset range is −14 to +14)
    const newVal = Math.max(-14, Math.min(14, current + delta));
    await this.document.update({ 'system.attributes.dmOffset': newVal });
  }

  async _onExperienceRollsChange(ev) {
    ev.preventDefault();
    const delta   = ev.currentTarget.dataset.action === 'exp-inc' ? 1 : -1;
    const current = this.document.system.attributes.experienceRolls ?? 0;
    const newVal  = Math.max(0, current + delta);
    await this.document.update({ 'system.attributes.experienceRolls': newVal });
  }

  async _onLuckPipClick(index) {
    const lp  = this.document.system.attributes.luckPoints;
    const cur = lp.value;
    const newVal = index < cur ? index : index + 1;
    await this.document.update({
      'system.attributes.luckPoints.value': Math.max(0, Math.min(newVal, lp.max))
    });
  }

  async _onItemDelete(ev) {
    ev.preventDefault();
    const item = this.document.items.get(ev.currentTarget.dataset.itemId);
    if (item) await item.delete();
  }

  async _onItemEdit(ev) {
    ev.preventDefault();
    const item = this.document.items.get(ev.currentTarget.dataset.itemId);
    item?.sheet?.render(true);
  }

  // -------------------------------------------------------------------------
  // Heal All — restore every hit location to max HP and clear wounds
  // -------------------------------------------------------------------------

  async _onHealAll(ev) {
    ev.preventDefault();
    const locs = this.actor.items.filter(i => i.type === 'hit-location');
    if (locs.length === 0) return;

    const updates = locs.map(loc => ({
      _id:               loc.id,
      'system.current':  loc.system.hp,   // reset to max
      'system.wound':    'none'
    }));

    await this.actor.updateEmbeddedDocuments('Item', updates);
    ui.notifications.info(`${this.actor.name} — all hit locations restored.`);
  }

  async _onAddItem(ev) {
    ev.preventDefault();
    const type     = ev.currentTarget.dataset.type;
    const category = ev.currentTarget.dataset.category;

    if (type === 'hit-location') {
      const name = await this._promptHitLocationName('');
      if (name === null) return;
      const existing = Array.from(this.document.items).filter(i => i.type === 'hit-location');
      const [created] = await this.document.createEmbeddedDocuments('Item', [{
        name, type: 'hit-location',
        system: { label: name, hp: 4, current: 4, ap: 0, wound: 'none', group: '', sort: existing.length }
      }]);
      return;
    }

    const data = { name: `New ${type.replace('-', ' ')}`, type, system: {} };
    if (category) data.system.category = category;
    const [created] = await this.document.createEmbeddedDocuments('Item', [data]);
    created?.sheet?.render(true);
  }

  async _onItemFieldChange(ev) {
    const input  = ev.currentTarget;
    const item   = this.document.items.get(input.dataset.itemId);
    if (!item) return;
    const value  = input.type === 'checkbox' ? input.checked
                 : input.type === 'number'   ? Number(input.value)
                 : input.value;
    // When editing the hit location label, keep the item's name in sync too
    if (input.dataset.nameField) {
      await item.update({ name: value, [input.dataset.field]: value });
    } else {
      await item.update({ [input.dataset.field]: value });
    }
  }

  async _onRollDamage(ev) {
    ev.preventDefault();
    const itemId = ev.currentTarget.dataset.itemId;
    const weapon = this.document.items.get(itemId);
    if (!weapon) return;

    const actor       = this.document;
    const dmgFormula  = weapon.system.damage ?? '1d6';
    const applyDmgMod = weapon.system.damageModApplies;
    const actorDmgMod = actor.system.attributes?.damageModifier ?? '';

    // Build the full formula — append actor damage modifier if applicable and non-zero
    let formula = dmgFormula;
    if (applyDmgMod && actorDmgMod && actorDmgMod !== '0' && actorDmgMod !== '') {
      // actorDmgMod is stored as e.g. "+1d4", "-1d2", "+1d6" — append directly
      formula = `${dmgFormula}${actorDmgMod}`;
    }

    const roll = new Roll(formula);
    await roll.evaluate();

    const modNote = (applyDmgMod && actorDmgMod && actorDmgMod !== '0')
      ? `<span class="mi-card-pill">${actorDmgMod} damage mod</span>`
      : '';

    const content = `
      <div class="mi-chat-card">
        <div class="mi-card-header">
          <span class="mi-card-actor">${actor.name}</span>
          <span class="mi-card-skill">${weapon.name} — Damage</span>
        </div>
        <div class="mi-card-body">
          ${modNote ? `<div class="mi-card-details">${modNote}</div>` : ''}
          <div class="mi-card-target">Formula <strong>${formula}</strong></div>
          <div class="mi-roll-result">${roll.total}</div>
        </div>
      </div>
    `;

    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ actor }),
      rolls: [roll]
    });
  }

  async _onRollResistance(ev) {
    ev.preventDefault();
    const skillName = ev.currentTarget.dataset.skill;
    const actor     = this.document;

    // Find the matching skill item on the actor
    const item = Array.from(actor.items).find(
      i => i.type === 'skill' && i.name === skillName
    );
    if (!item) {
      ui.notifications.warn(`${skillName} skill not found on this character.`);
      return;
    }

    // Compute live total — creature actors store a flat system.total, skip formula
    let skillTotal;
    if (actor.type === 'creature') {
      skillTotal = item.system.total ?? 0;
    } else {
      const c = actor.system.characteristics;
      const chars = {
        STR: c.str.value, CON: c.con.value, SIZ: c.siz.value,
        DEX: c.dex.value, INT: c.int.value, POW: c.pow.value, CHA: c.cha.value
      };
      const base = this._evalFormula(item.system.baseFormula ?? '', chars);
      skillTotal = base + (item.system.bonusPoints ?? 0);
    }

    const { MythrasRoll } = await import('../rolls/MythrasRoll.js');
    await MythrasRoll.rollDialog({
      actor,
      item,
      skillTotal,
      passions: Array.from(actor.items).filter(i => i.type === 'passion')
    });
  }

  _onLocDragStart(ev, row) {
    ev.stopPropagation(); // prevent the sheet's generic item drag from firing
    row.classList.add('mi-loc-dragging');
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', JSON.stringify({ locItemId: row.dataset.itemId }));
  }

  _onLocDragOver(ev, row) {
    ev.preventDefault();
    ev.stopPropagation();
    ev.dataTransfer.dropEffect = 'move';
    // Only highlight if dragging a loc row (not an external item drop)
    try {
      const data = JSON.parse(ev.dataTransfer.getData('text/plain'));
      if (data.locItemId) row.classList.add('mi-loc-drag-over');
    } catch(e) { /* not our drag */ }
  }

  async _onLocDrop(ev, targetRow) {
    ev.preventDefault();
    ev.stopPropagation();
    targetRow.classList.remove('mi-loc-drag-over');

    let dragData;
    try { dragData = JSON.parse(ev.dataTransfer.getData('text/plain')); }
    catch(e) { return; }

    const srcId = dragData?.locItemId;
    if (!srcId) return; // not a location reorder — fall through to generic drop

    const tgtId = targetRow.dataset.itemId;
    if (srcId === tgtId) return;

    // Collect all location rows in their current DOM order, swap the dragged one
    const grid = this.element.querySelector('#mi-locations-grid');
    const rows = Array.from(grid.querySelectorAll('.mi-loc-row-contents'));
    const ids  = rows.map(r => r.dataset.itemId);

    const srcIdx = ids.indexOf(srcId);
    const tgtIdx = ids.indexOf(tgtId);
    if (srcIdx === -1 || tgtIdx === -1) return;

    // Reorder: remove src, insert at tgt position
    ids.splice(srcIdx, 1);
    ids.splice(tgtIdx, 0, srcId);

    // Assign new sort values and batch update
    const updates = ids.map((id, i) => ({ _id: id, 'system.sort': i }));
    await this.document.updateEmbeddedDocuments('Item', updates);
    // redistributeHitLocationRanges fires automatically via the updateEmbeddedDocuments
    // but it only triggers on create/delete — call it directly after a reorder
    const { redistributeHitLocationRanges } = await import('../data/ItemData.js');
    await redistributeHitLocationRanges(this.document);
  }

  async _onWardChange(ev) {
    const locId  = ev.currentTarget.dataset.locId;
    const warded = ev.currentTarget.checked;
    // Show/hide the selector immediately in the DOM — no re-render needed.
    // The selector is always present; we just toggle its visibility class.
    const wardCell = ev.currentTarget.closest('.mi-loc-ward');
    const selector = wardCell?.querySelector('.mi-ward-weapon');
    if (selector) selector.classList.toggle('mi-ward-weapon-hidden', !warded);
    await this.document.update({ [`system.wardedLocations.${locId}.warded`]: warded });
  }

  async _onWardWeaponChange(ev) {
    const locId    = ev.currentTarget.dataset.locId;
    const weaponId = ev.currentTarget.value;
    await this.document.update({ [`system.wardedLocations.${locId}.weaponId`]: weaponId });
  }

  async _onDrop(ev) {
    ev.preventDefault();
    ev.stopPropagation();

    let dragData;
    try { dragData = JSON.parse(ev.dataTransfer.getData('text/plain')); }
    catch(e) { return; }

    // Ignore internal location reorders — handled by _onLocDrop
    if (dragData?.locItemId) return;

    if (dragData?.type !== 'Item') return;

    let srcItem;
    try { srcItem = await fromUuid(dragData.uuid); }
    catch(e) { return; }
    if (!srcItem) return;

    // Already owned by this actor — nothing to do
    if (srcItem.parent?.id === this.document.id) return;

    // Hit locations dropped from compendium or sidebar: prompt for a name
    // so the GM isn't left with a row labelled "Location"
    if (srcItem.type === 'hit-location') {
      const name = await this._promptHitLocationName(srcItem.system.label || srcItem.name);
      if (name === null) return; // cancelled
      const data  = srcItem.toObject();
      delete data._id;
      data.name            = name;
      data.system.label    = name;
      // Sort it after the current last location
      const existing = Array.from(this.document.items).filter(i => i.type === 'hit-location');
      data.system.sort = existing.length;
      await this.document.createEmbeddedDocuments('Item', [data]);
      return;
    }

    // Ammo: deduplicate by name — increment quantity if already present.
    // Resolve synthetic token actor first so find/create hit the right collection.
    if (srcItem.type === 'ammo') {
      const baseActor = this.document;
      const actorId   = baseActor?.id ?? null;
      const token     = actorId
        ? (canvas?.tokens?.placeables?.find(t => t.actor?.id === actorId || t.document?.actorId === actorId) ?? null)
        : null;
      const actor     = token?.actor ?? baseActor;
      const existing  = actor.items.find(i => i.type === 'ammo' && i.name === srcItem.name);
      if (existing) {
        const addQty = srcItem.system?.quantity ?? 1;
        await existing.update({ 'system.quantity': (existing.system.quantity ?? 0) + addQty });
        ui.notifications.info(`${srcItem.name} quantity updated.`);
      } else {
        const data = srcItem.toObject();
        delete data._id;
        await actor.createEmbeddedDocuments('Item', [data]);
      }
      return;
    }

    const data = srcItem.toObject();
    delete data._id;
    await this.document.createEmbeddedDocuments('Item', [data]);

    // If the source is a container merchant, remove or decrement the item there
    if (srcItem.parent?.type === 'merchant' &&
        srcItem.parent?.system?.mode === 'container') {
      const qty = srcItem.system?.quantity ?? 1;
      if (qty > 1) {
        await srcItem.update({ 'system.quantity': qty - 1 });
      } else {
        await srcItem.parent.deleteEmbeddedDocuments('Item', [srcItem.id]);
      }
    }
  }

  /** Prompt the GM for a hit location name. Returns the string or null if cancelled. */
  _promptHitLocationName(defaultName = '') {
    return new Promise(resolve => {
      new Dialog({
        title: 'Hit Location',
        content: `
          <div class="mi-roll-dialog">
            <div class="mi-dialog-skill-header">
              <span class="mi-dialog-skill-name">New Hit Location</span>
            </div>
            <div class="mi-dialog-fields">
              <div class="mi-form-row">
                <label>Name</label>
                <input id="mi-loc-name-input" type="text" value="${defaultName}" placeholder="e.g. Right Arm"/>
              </div>
            </div>
          </div>`,
        buttons: {
          ok: {
            icon: '<i class="fas fa-check"></i>', label: 'Add',
            callback: html => resolve(html.find('#mi-loc-name-input').val().trim() || defaultName)
          },
          cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel', callback: () => resolve(null) }
        },
        default: 'ok',
        classes: ['dialog', 'mi-dialog'],
        render: html => { html.find('#mi-loc-name-input').focus().select(); }
      }).render(true);
    });
  }

  // -------------------------------------------------------------------------
  // Form submission
  // -------------------------------------------------------------------------

  async _processSubmitData(event, form, submitData) {
    await this.document.update(submitData);
  }
}
