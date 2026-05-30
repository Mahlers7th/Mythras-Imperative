/**
 * mythras-imperative/module/data/NPCData.js
 *
 * TypeDataModel for the NPC actor type.
 * Simplified version of CharacterData — same mechanical fields,
 * no culture/career workflow. GM enters values directly.
 */

const { fields } = foundry.data;

export class NPCData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {

      // --- Identity --------------------------------------------------------
      identity: new fields.SchemaField({
        role:       new fields.StringField({ initial: '' }),   // e.g. "Guard Captain"
        faction:    new fields.StringField({ initial: '' }),
        notes:      new fields.StringField({ initial: '' })
      }),

      // --- Characteristics -------------------------------------------------
      characteristics: new fields.SchemaField({
        str: new fields.SchemaField({ value: new fields.NumberField({ initial: 10, integer: true, min: 0 }) }),
        con: new fields.SchemaField({ value: new fields.NumberField({ initial: 10, integer: true, min: 0 }) }),
        siz: new fields.SchemaField({ value: new fields.NumberField({ initial: 13, integer: true, min: 0 }) }),
        dex: new fields.SchemaField({ value: new fields.NumberField({ initial: 10, integer: true, min: 0 }) }),
        int: new fields.SchemaField({ value: new fields.NumberField({ initial: 13, integer: true, min: 0 }) }),
        pow: new fields.SchemaField({ value: new fields.NumberField({ initial: 10, integer: true, min: 0 }) }),
        cha: new fields.SchemaField({ value: new fields.NumberField({ initial: 10, integer: true, min: 0 }) })
      }),

      // --- Derived Attributes ----------------------------------------------
      attributes: new fields.SchemaField({
        actionPoints:       new fields.SchemaField({
          value:    new fields.NumberField({ initial: 2, integer: true }),
          max:      new fields.NumberField({ initial: 2, integer: true })
        }),
        damageModifier:     new fields.StringField({ initial: '+0' }),
        initiativeBonus:    new fields.NumberField({ initial: 0, integer: true }),
        magicPoints: new fields.SchemaField({
          value: new fields.NumberField({ initial: 10, integer: true, min: 0 }),
          max:   new fields.NumberField({ initial: 10, integer: true, min: 0 })
        }),
        movementRate:       new fields.StringField({ initial: '6' })          // free text — e.g. '6' or '6, 12 fly'
      }),

      // --- Hit Locations ---------------------------------------------------
      hitLocations: new fields.SchemaField({
        rightLeg: new fields.SchemaField({ hp: new fields.NumberField({ initial: 4 }), current: new fields.NumberField({ initial: 4 }), ap: new fields.NumberField({ initial: 0 }), wound: new fields.StringField({ initial: '' }) }),
        leftLeg:  new fields.SchemaField({ hp: new fields.NumberField({ initial: 4 }), current: new fields.NumberField({ initial: 4 }), ap: new fields.NumberField({ initial: 0 }), wound: new fields.StringField({ initial: '' }) }),
        abdomen:  new fields.SchemaField({ hp: new fields.NumberField({ initial: 5 }), current: new fields.NumberField({ initial: 5 }), ap: new fields.NumberField({ initial: 0 }), wound: new fields.StringField({ initial: '' }) }),
        chest:    new fields.SchemaField({ hp: new fields.NumberField({ initial: 6 }), current: new fields.NumberField({ initial: 6 }), ap: new fields.NumberField({ initial: 0 }), wound: new fields.StringField({ initial: '' }) }),
        rightArm: new fields.SchemaField({ hp: new fields.NumberField({ initial: 3 }), current: new fields.NumberField({ initial: 3 }), ap: new fields.NumberField({ initial: 0 }), wound: new fields.StringField({ initial: '' }) }),
        leftArm:  new fields.SchemaField({ hp: new fields.NumberField({ initial: 3 }), current: new fields.NumberField({ initial: 3 }), ap: new fields.NumberField({ initial: 0 }), wound: new fields.StringField({ initial: '' }) }),
        head:     new fields.SchemaField({ hp: new fields.NumberField({ initial: 4 }), current: new fields.NumberField({ initial: 4 }), ap: new fields.NumberField({ initial: 0 }), wound: new fields.StringField({ initial: '' }) })
      }),

      // --- Warded Locations ------------------------------------------------
      wardedLocations: new fields.SchemaField({
        rightLeg: new fields.SchemaField({ warded: new fields.BooleanField({ initial: false }), weaponId: new fields.StringField({ initial: '' }) }),
        leftLeg:  new fields.SchemaField({ warded: new fields.BooleanField({ initial: false }), weaponId: new fields.StringField({ initial: '' }) }),
        abdomen:  new fields.SchemaField({ warded: new fields.BooleanField({ initial: false }), weaponId: new fields.StringField({ initial: '' }) }),
        chest:    new fields.SchemaField({ warded: new fields.BooleanField({ initial: false }), weaponId: new fields.StringField({ initial: '' }) }),
        rightArm: new fields.SchemaField({ warded: new fields.BooleanField({ initial: false }), weaponId: new fields.StringField({ initial: '' }) }),
        leftArm:  new fields.SchemaField({ warded: new fields.BooleanField({ initial: false }), weaponId: new fields.StringField({ initial: '' }) }),
        head:     new fields.SchemaField({ warded: new fields.BooleanField({ initial: false }), weaponId: new fields.StringField({ initial: '' }) })
      }),

      // --- Fatigue & Conditions --------------------------------------------
      fatigue: new fields.StringField({ initial: 'fresh' }),
      conditions: new fields.SchemaField({
        prone:       new fields.BooleanField({ initial: false }),
        bleeding:    new fields.BooleanField({ initial: false }),
        unconscious: new fields.BooleanField({ initial: false }),
        surprised:   new fields.BooleanField({ initial: false }),
        entangled:   new fields.BooleanField({ initial: false }),
        burning:     new fields.BooleanField({ initial: false })
      }),

      // --- GM Notes --------------------------------------------------------
      gmNotes: new fields.StringField({ initial: '' })
    };
  }

  prepareDerivedData() {
    const c = this.characteristics;
    const str = c.str.value;
    const con = c.con.value;
    const siz = c.siz.value;
    const dex = c.dex.value;
    const int = c.int.value;
    const pow = c.pow.value;

    const attr = this.attributes;
    attr.initiativeBonus = Math.floor((dex + int) / 2);
    attr.magicPoints.max = pow;
    attr.damageModifier = this._calcDamageModifier(str + siz);
  }

  _calcDamageModifier(strSiz) {
    if (strSiz <= 5)  return '-1d8';
    if (strSiz <= 10) return '-1d6';
    if (strSiz <= 15) return '-1d4';
    if (strSiz <= 20) return '-1d2';
    if (strSiz <= 25) return '+0';
    if (strSiz <= 30) return '+1d2';
    if (strSiz <= 35) return '+1d4';
    if (strSiz <= 40) return '+1d6';
    if (strSiz <= 45) return '+1d8';
    if (strSiz <= 50) return '+1d10';
    return '+1d12';
  }
}


/**
 * mythras-imperative/module/data/CreatureData.js
 *
 * TypeDataModel for the Creature actor type.
 * Supports custom hit location layouts and natural armour.
 */

export class CreatureData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {

      // --- Identity --------------------------------------------------------
      identity: new fields.SchemaField({
        creatureType:    new fields.StringField({ initial: '' }),   // e.g. "Undead", "Beast"
        specialAbilities: new fields.StringField({ initial: '' })
      }),

      // --- Characteristics -------------------------------------------------
      characteristics: new fields.SchemaField({
        str: new fields.SchemaField({ value: new fields.NumberField({ initial: 10, integer: true, min: 0 }) }),
        con: new fields.SchemaField({ value: new fields.NumberField({ initial: 10, integer: true, min: 0 }) }),
        siz: new fields.SchemaField({ value: new fields.NumberField({ initial: 13, integer: true, min: 0 }) }),
        dex: new fields.SchemaField({ value: new fields.NumberField({ initial: 10, integer: true, min: 0 }) }),
        int: new fields.SchemaField({ value: new fields.NumberField({ initial: 5,  integer: true, min: 0 }) }),
        pow: new fields.SchemaField({ value: new fields.NumberField({ initial: 7,  integer: true, min: 0 }) }),
        cha: new fields.SchemaField({ value: new fields.NumberField({ initial: 5,  integer: true, min: 0 }) })
      }),

      // --- Derived Attributes ----------------------------------------------
      attributes: new fields.SchemaField({
        actionPoints:    new fields.SchemaField({
          value:    new fields.NumberField({ initial: 2, integer: true }),
          max:      new fields.NumberField({ initial: 2, integer: true })
        }),
        damageModifier:  new fields.StringField({ initial: '+0' }),
        initiativeBonus: new fields.NumberField({ initial: 0, integer: true }),
        magicPoints: new fields.SchemaField({
          value: new fields.NumberField({ initial: 7, integer: true, min: 0 }),
          max:   new fields.NumberField({ initial: 7, integer: true, min: 0 })
        }),
        movementRate:    new fields.StringField({ initial: '6' })             // free text — e.g. '6' or '15, 50 fly'
      }),

      // --- Custom Hit Locations (array for non-humanoid layouts) ----------
      // Each entry: { id, label, range: [min, max], hp, current, ap, wound }
      hitLocations: new fields.ArrayField(
        new fields.SchemaField({
          id:      new fields.StringField({ initial: 'location' }),
          label:   new fields.StringField({ initial: 'Location' }),
          rangeMin: new fields.NumberField({ initial: 1, integer: true }),
          rangeMax: new fields.NumberField({ initial: 20, integer: true }),
          hp:      new fields.NumberField({ initial: 4, integer: true }),
          current: new fields.NumberField({ initial: 4, integer: true }),
          ap:      new fields.NumberField({ initial: 0, integer: true, min: 0 }),
          wound:   new fields.StringField({ initial: '' })
        }),
        { initial: [] }
      ),

      // --- Natural Armour --------------------------------------------------
      naturalArmour: new fields.NumberField({ initial: 0, integer: true, min: 0 }),

      // --- Fatigue & Conditions --------------------------------------------
      fatigue: new fields.StringField({ initial: 'fresh' }),
      conditions: new fields.SchemaField({
        prone:       new fields.BooleanField({ initial: false }),
        bleeding:    new fields.BooleanField({ initial: false }),
        unconscious: new fields.BooleanField({ initial: false }),
        surprised:   new fields.BooleanField({ initial: false }),
        entangled:   new fields.BooleanField({ initial: false }),
        burning:     new fields.BooleanField({ initial: false })
      }),

      // --- Notes -----------------------------------------------------------
      notes: new fields.StringField({ initial: '' })
    };
  }

  prepareDerivedData() {
    const c = this.characteristics;
    const str = c.str.value;
    const siz = c.siz.value;
    const dex = c.dex.value;
    const int = c.int.value;
    const pow = c.pow.value;

    const attr = this.attributes;
    attr.initiativeBonus = Math.floor((dex + int) / 2);
    attr.magicPoints.max = pow;
    attr.damageModifier = this._calcDamageModifier(str + siz);
  }

  _calcDamageModifier(strSiz) {
    if (strSiz <= 5)  return '-1d8';
    if (strSiz <= 10) return '-1d6';
    if (strSiz <= 15) return '-1d4';
    if (strSiz <= 20) return '-1d2';
    if (strSiz <= 25) return '+0';
    if (strSiz <= 30) return '+1d2';
    if (strSiz <= 35) return '+1d4';
    if (strSiz <= 40) return '+1d6';
    if (strSiz <= 45) return '+1d8';
    if (strSiz <= 50) return '+1d10';
    return '+1d12';
  }
}


// ---------------------------------------------------------------------------
// MerchantData — TypeDataModel for the 'merchant' actor type
//
// Covers two use cases:
//   shop      — has proprietor, Commerce %, priced inventory, Buy/trade-in flow
//   container — treasure chest / loot pile; no prices, unrestricted drag-out
//
// Currency items and inventory items are stored as embedded Item documents
// on the actor (same as character weapons/gear). The sheet groups them.
// ---------------------------------------------------------------------------

export class MerchantData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;
    return {

      // Shop or container mode
      mode: new fields.StringField({
        initial:  'shop',
        choices:  ['shop', 'container']
      }),

      // Container mode: locked state (GM seals the chest)
      locked: new fields.BooleanField({ initial: false }),

      // Shop mode: who runs this establishment
      proprietorName: new fields.StringField({ initial: '' }),

      // Shop mode: Commerce skill % — GM reference only, no automation
      commerceSkill: new fields.NumberField({
        initial: 40, integer: true, min: 0, max: 200
      }),

      // Shop mode: default trade-in fraction (0.0–1.0, shown as %)
      // GM can override per transaction via the trade-in dialog
      tradeInFraction: new fields.NumberField({
        initial: 0.5, min: 0, max: 1
      }),

      // Free-text description / flavour
      description: new fields.StringField({ initial: '' })
    };
  }
}


// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// VehicleData — TypeDataModel for the 'vehicle' actor type
//
// Tracks the six core vehicle statistics from Mythras Imperative pp.53-63:
//   Size, Hull, Structure, Speed, Systems (named slots), Shields, Handling
//
// Weapons and Traits are embedded Item documents (weapon / trait items).
// No characteristics, no fatigue, no hit locations — vehicles are statblocks.
//
// System components are stored as embedded hit-location items (type='hit-location')
// using the same HitLocationData schema. Fields are repurposed:
//   label    — system name (Cargo, Comms, Drive, etc.)
//   hp       — max hits before destruction (= Size step, seeded on creation)
//   current  — remaining undamaged hits (starts at hp, decrements toward 0)
//   ap       — unused (always 0)
//   rangeMin/rangeMax — 1d10 roll range for the System Component Damage table
//   wound    — intact/minor/serious/major maps to intact/damaged/destroyed
//
// This reuses all the hit location CSS, wiring, and redistribution guards.
// The createItem/deleteItem redistribution hook guards against vehicle actors.
//
// Crew is an ArrayField of lightweight roster entries (uuid + cached name +
// role). UUIDs go stale on deletion; cached name provides display fallback.
// ---------------------------------------------------------------------------

export class VehicleData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const { fields } = foundry.data;
    return {

      // --- Classification --------------------------------------------------
      size: new fields.StringField({
        initial: 'medium',
        choices: ['small', 'medium', 'large', 'huge', 'enormous', 'colossal']
      }),

      vehicleType: new fields.StringField({
        initial: 'terrestrial',
        choices: ['terrestrial', 'spacecraft']
      }),

      // --- Core Stats ------------------------------------------------------
      hull: new fields.NumberField({ initial: 4, integer: true, min: 0 }),

      structure: new fields.SchemaField({
        value: new fields.NumberField({ initial: 25, integer: true, min: 0 }),
        max:   new fields.NumberField({ initial: 25, integer: true, min: 0 })
      }),

      speed: new fields.StringField({
        initial: 'moderate',
        choices: [
          'ponderous', 'sluggish', 'slow', 'mediocre', 'gentle',
          'moderate', 'rapid', 'fast', 'fleet', 'supersonic'
        ]
      }),

      handling: new fields.StringField({
        initial: 'standard',
        choices: ['easy', 'standard', 'hard', 'formidable', 'herculean']
      }),

      shields: new fields.SchemaField({
        value: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
        max:   new fields.NumberField({ initial: 0, integer: true, min: 0 })
      }),

      // --- Crew Roster -----------------------------------------------------
      // Lightweight array of actor references. uuid may go stale if the
      // actor is deleted; cachedName provides a display fallback.
      crew: new fields.ArrayField(
        new fields.SchemaField({
          uuid:       new fields.StringField({ initial: '' }),
          cachedName: new fields.StringField({ initial: '' }),
          role:       new fields.StringField({ initial: '' })
        }),
        { initial: [] }
      ),

      // --- Notes -----------------------------------------------------------
      description: new fields.StringField({ initial: '' }),
      gmNotes:     new fields.StringField({ initial: '' })
    };
  }
}
