/**
 * mythras-imperative/module/data/ItemData.js
 *
 * TypeDataModel definitions for all core item types:
 *   SkillData, WeaponData, ArmourData, GearData, CombatStyleData, PassionData
 */

const { fields } = foundry.data;

// ---------------------------------------------------------------------------
// SKILL
// ---------------------------------------------------------------------------

export class SkillData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      category:     new fields.StringField({ initial: 'standard', choices: ['standard', 'professional'] }),
      baseFormula:  new fields.StringField({ initial: 'STR+DEX' }),   // e.g. "STR+DEX", "INT×2"
      baseValue:    new fields.NumberField({ initial: 0, integer: true }),   // computed from actor chars
      bonusPoints:  new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      total:        new fields.NumberField({ initial: 0, integer: true }),   // baseValue + bonusPoints
      description:  new fields.StringField({ initial: '' }),
      // Track if this skill was fumbled last session (for experience roll bonus)
      fumbledLastSession: new fields.BooleanField({ initial: false })
    };
  }
}

// ---------------------------------------------------------------------------
// WEAPON
//
// Covers both melee and ranged weapons. Category drives which fields are
// relevant in the sheet and in the combat engine.
//
// Size / Force codes:  S = Small  M = Medium  L = Large  H = Huge  E = Enormous
// Reach codes:         T = Touch  S = Short   M = Medium  L = Long  VL = Very Long
//
// Traits are stored as an array of canonical string keys. The combat engine
// reads these to filter available Special Effects for each exchange.
// Valid trait keys (all lower-case, hyphenated):
//   melee:  'impaling', 'bleeding', 'sundering', 'entangling', 'bludgeoning',
//           'two-handed', 'unarmed'
//   ranged: 'impaling', 'bleeding', 'firearm', 'burst-fire', 'full-auto'
//   either: 'thrown'
// ---------------------------------------------------------------------------

export class WeaponData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {

      // --- Category --------------------------------------------------------
      // Drives which fields the sheet shows and which engine paths fire.
      category: new fields.StringField({
        initial: 'melee',
        choices: ['melee', 'ranged']
      }),

      // --- Damage ----------------------------------------------------------
      // Dice expression only — Damage Modifier is appended at roll time from
      // the owning actor's system.attributes.damageModifier.
      damage: new fields.StringField({ initial: '1d6' }),

      // --- Size / Force ----------------------------------------------------
      // 'size'  — melee: governs parry damage reduction (S/M/L/H/E)
      // 'force' — ranged: equivalent of Size for parry purposes (S/M/L/H/E)
      size:  new fields.StringField({ initial: 'M', choices: ['S','M','L','H','E'] }),
      force: new fields.StringField({ initial: 'M', choices: ['S','M','L','H','E'] }),

      // --- Melee-specific --------------------------------------------------
      // Reach category used to resolve engagement and Choose Location limits.
      reach: new fields.StringField({
        initial: 'M',
        choices: ['T','S','M','L','VL']   // Touch / Short / Medium / Long / Very Long
      }),

      // --- Ranged-specific -------------------------------------------------
      // Four range bands in metres (Close / Effective / Long / Extreme).
      // Extreme band is firearms only — bows and thrown weapons leave it at 0.
      // At Long range: damage halved, Force reduced one step.
      // At Extreme range: firearms only, Herculean difficulty.
      // Choose Location is available at Close range only (stationary/unaware target).
      rangeClose:     new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      rangeEffective: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      rangeLong:      new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      rangeExtreme:   new fields.NumberField({ initial: 0, integer: true, min: 0 }),

      // Turns to load/reload. Rapid Reload SE can reduce this.
      load: new fields.NumberField({ initial: 0, integer: true, min: 0 }),

      // --- Ammunition ------------------------------------------------------
      // ammo: current rounds loaded. ammoMax: magazine/clip capacity.
      // Not used by thrown weapons or bows (leave at 0).
      ammo:    new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      ammoMax: new fields.NumberField({ initial: 0, integer: true, min: 0 }),

      // --- Firing modes (firearms only) ------------------------------------
      // single:   one shot per action — standard resolution
      // burst:    Hard difficulty; 1d[burstSize] rounds strike on hit
      // fullAuto: Formidable difficulty; rounds distributed across targets
      firingMode: new fields.StringField({
        initial: 'single',
        choices: ['single', 'burst', 'fullAuto']
      }),

      // Burst size: maximum rounds per burst (e.g. 3, 5, 10).
      // Full-auto cyclic rate: maximum rounds the weapon can fire in one action.
      burstSize:   new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      cyclicRate:  new fields.NumberField({ initial: 0, integer: true, min: 0 }),

      // Impale Size — ranged impaling weapons have a separate size value
      // governing the hindrance caused by the Impale SE (distinct from Force).
      impaleSize: new fields.StringField({
        initial: 'M',
        choices: ['S','M','L','H','E']
      }),

      // Whether the owning actor's Damage Modifier adds to this weapon's roll.
      // True for self-drawn bows and thrown weapons; false for firearms etc.
      damageModApplies: new fields.BooleanField({ initial: true }),

      // --- Weapon condition ------------------------------------------------
      // ap / hp represent the weapon's own structural integrity.
      // currentHP tracks damage taken (Damage Weapon SE, Sunder, etc.).
      ap:        new fields.NumberField({ initial: 6, integer: true, min: 0 }),
      hp:        new fields.NumberField({ initial: 8, integer: true, min: 0 }),
      currentHP: new fields.NumberField({ initial: 8, integer: true }),

      // --- Encumbrance -----------------------------------------------------
      enc: new fields.NumberField({ initial: 1, min: 0 }),

      // --- Traits ----------------------------------------------------------
      // Array of canonical lower-case hyphenated trait keys (see header above).
      // The Special Effects filter reads this array — keep values canonical.
      traits: new fields.ArrayField(
        new fields.StringField(),
        { initial: [] }
      ),

      // --- Description -----------------------------------------------------
      description: new fields.StringField({ initial: '' }),

      // --- Equipped state --------------------------------------------------
      // Whether this weapon appears on the Combat tab as active.
      equipped: new fields.BooleanField({ initial: false }),

      // --- Loaded ammo -----------------------------------------------------
      // Id of the ammo item currently loaded into this weapon. Empty string
      // means no ammo is loaded. Set by dragging an ammo item onto the
      // weapon sheet; cleared by the × button on the loaded-ammo pill.
      // The engine reads traits from this item at _buildContext time.
      loadedAmmoId: new fields.StringField({ initial: '' }),

      // Ammo type this weapon accepts — matches AmmoData.type values.
      // Used by the Reload picker to filter compatible ammo items on the actor.
      // Empty string means no filter (accepts any / not applicable).
      ammoType: new fields.StringField({ initial: '', blank: true }),

      // --- Price -----------------------------------------------------------
      // The listed price in a merchant's inventory. amount is the numeric cost;
      // denominationAbbr is the abbreviation of the currency item (e.g. 'GP').
      // Both default to empty — unpurchaseable items have no price set.
      price: new fields.SchemaField({
        amount:           new fields.NumberField({ initial: 0, min: 0 }),
        denominationAbbr: new fields.StringField({ initial: '' })
      })
    };
  }

  // -------------------------------------------------------------------------
  // Derived helpers — read-only convenience getters used by the engine
  // -------------------------------------------------------------------------

  /** True if this weapon has the impaling trait */
  get isImpaling()    { return this.traits.includes('impaling'); }

  /** True if this weapon has the bleeding trait */
  get isBleeding()    { return this.traits.includes('bleeding'); }

  /** True if this weapon has the sundering trait */
  get isSundering()   { return this.traits.includes('sundering'); }

  /** True if this weapon has the entangling trait */
  get isEntangling()  { return this.traits.includes('entangling'); }

  /** True if this weapon has the bludgeoning trait */
  get isBludgeoning() { return this.traits.includes('bludgeoning'); }

  /** True if this is a two-handed weapon */
  get isTwoHanded()   { return this.traits.includes('two-handed'); }

  /** True if this is a firearm */
  get isFirearm()     { return this.traits.includes('firearm'); }

  /** True if this weapon can be thrown (melee weapon with the thrown trait) */
  get isThrown()      { return this.traits.includes('thrown'); }

  /** True if this weapon is broken (currentHP at or below zero) */
  get isBroken()      { return this.currentHP <= 0; }

  /**
   * The size code used by the combat engine when resolving parry reduction.
   * Melee weapons use 'size'; ranged weapons use 'force'.
   */
  get parrySize() {
    return this.category === 'ranged' ? this.force : this.size;
  }
}

// ---------------------------------------------------------------------------
// ARMOUR
// ---------------------------------------------------------------------------

export class ArmourData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ap:           new fields.NumberField({ initial: 2, integer: true, min: 0 }),
      // Which hit locations this armour covers
      locations: new fields.SchemaField({
        head:     new fields.BooleanField({ initial: false }),
        chest:    new fields.BooleanField({ initial: false }),
        abdomen:  new fields.BooleanField({ initial: false }),
        rightArm: new fields.BooleanField({ initial: false }),
        leftArm:  new fields.BooleanField({ initial: false }),
        rightLeg: new fields.BooleanField({ initial: false }),
        leftLeg:  new fields.BooleanField({ initial: false })
      }),
      enc:               new fields.NumberField({ initial: 2, min: 0 }),
      initiativePenalty: new fields.NumberField({ initial: 0, integer: true }),
      description:       new fields.StringField({ initial: '' }),
      equipped:          new fields.BooleanField({ initial: false }),
      price: new fields.SchemaField({
        amount:           new fields.NumberField({ initial: 0, min: 0 }),
        denominationAbbr: new fields.StringField({ initial: '' })
      })
    };
  }
}

// ---------------------------------------------------------------------------
// GEAR
// ---------------------------------------------------------------------------

export class GearData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      enc:         new fields.NumberField({ initial: 0, min: 0 }),
      quantity:    new fields.NumberField({ initial: 1, integer: true, min: 0 }),
      description: new fields.StringField({ initial: '' }),
      price: new fields.SchemaField({
        amount:           new fields.NumberField({ initial: 0, min: 0 }),
        denominationAbbr: new fields.StringField({ initial: '' })
      })
    };
  }

  /** Total encumbrance for this stack */
  get totalEnc() {
    return (this.enc ?? 0) * (this.quantity ?? 1);
  }
}

// ---------------------------------------------------------------------------
// COMBAT STYLE
// ---------------------------------------------------------------------------

export class CombatStyleData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      baseFormula:  new fields.StringField({ initial: 'STR+DEX' }),
      baseValue:    new fields.NumberField({ initial: 0, integer: true }),
      bonusPoints:  new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      total:        new fields.NumberField({ initial: 0, integer: true }),
      // Weapons covered by this style — stored as { id, name } objects so we
      // can reference actual weapon items on the actor and display their names.
      // id may be an actor-item id or '' for manually entered weapons.
      weapons: new fields.ArrayField(
        new fields.SchemaField({
          id:   new fields.StringField({ initial: '' }),
          name: new fields.StringField({ initial: '' })
        }),
        { initial: [] }
      ),
      // Canonical trait keys from MYTHRAS.combatStyleTraits
      // e.g. ['mountedCombat', 'skirmishing']
      traits: new fields.ArrayField(
        new fields.StringField(),
        { initial: [] }
      ),
      description:  new fields.StringField({ initial: '' }),
      fumbledLastSession: new fields.BooleanField({ initial: false })
    };
  }
}

// ---------------------------------------------------------------------------
// PASSION
// ---------------------------------------------------------------------------

export class PassionData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      // Verb describing the passion e.g. "Love", "Hate", "Loyalty to"
      verb:        new fields.StringField({ initial: 'Love' }),
      // Target of the passion e.g. "The King", "The Thieves Guild"
      target:      new fields.StringField({ initial: '' }),
      // Base formula e.g. "POW+CHA"
      baseFormula: new fields.StringField({ initial: 'POW+CHA' }),
      baseValue:   new fields.NumberField({ initial: 0, integer: true }),
      bonusPoints: new fields.NumberField({ initial: 0, integer: true }),
      total:       new fields.NumberField({ initial: 0, integer: true }),
      description: new fields.StringField({ initial: '' }),
      fumbledLastSession: new fields.BooleanField({ initial: false })
    };
  }

  /** Display name: verb + target e.g. "Love (The King)" */
  get displayName() {
    return this.target ? `${this.verb} (${this.target})` : this.verb;
  }

  /** Augmentation bonus: 20% of passion total, rounded up */
  get augmentBonus() {
    return Math.ceil(this.total * 0.2);
  }
}

// =============================================================================
// HIT LOCATION
//
// Hit locations are items, not hardcoded actor schema fields. This lets any
// creature have an arbitrary location set. Characters and NPCs are seeded with
// the standard 7 humanoid locations on creation.
//
// Roll ranges (rangeMin / rangeMax) are NEVER set manually — they are always
// recalculated by redistributeHitLocationRanges() when locations are added or
// removed. The redistribution spreads 1–20 as evenly as possible across all
// locations ordered by their `sort` field.
// =============================================================================

export class HitLocationData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      // Display label e.g. "Head", "Right Hind Leg", "Centre Head"
      label:    new fields.StringField({ initial: 'Location' }),

      // HP for this location. For characters derived from CON+SIZ on creation;
      // for creatures the GM sets it directly.
      hp:       new fields.NumberField({ initial: 4, integer: true, min: 0 }),
      current:  new fields.NumberField({ initial: 4, integer: true }),

      // Natural armour AP — 0 for most humanoids.
      // Worn armour contribution is computed at display time from equipped items.
      ap:       new fields.NumberField({ initial: 0, integer: true, min: 0 }),

      // Wound state for this location
      wound:    new fields.StringField({
        initial: 'none', choices: ['none', 'minor', 'serious', 'major']
      }),

      // Optional group name — clusters related locations (e.g. "heads" on a
      // Hydra). Wound logic applies per location, not per group.
      group:    new fields.StringField({ initial: '' }),

      // Auto-distributed 1d20 range. Set by redistribution only — never edited
      // manually. rangeMin === rangeMax is a single-value range.
      rangeMin: new fields.NumberField({ initial: 1,  integer: true, min: 1, max: 20 }),
      rangeMax: new fields.NumberField({ initial: 20, integer: true, min: 1, max: 20 }),

      // Sort order determines position in the location list and the
      // redistribution order. Lower values = lower d20 range.
      sort:     new fields.NumberField({ initial: 0, integer: true, min: 0 })
    };
  }

  /** Display string for the roll range e.g. "1–3" or "19–20" */
  get rangeLabel() {
    return this.rangeMin === this.rangeMax
      ? `${this.rangeMin}`
      : `${this.rangeMin}\u2013${this.rangeMax}`;
  }
}

/**
 * Redistribute 1d20 hit location ranges evenly across all hit-location items
 * on an actor. Call this after any hit-location item is created or deleted.
 *
 * Sorts locations by their `sort` field, then divides 1–20 into bands.
 * Remainder points go to the first N locations (matching the standard humanoid
 * table where chest and abdomen are 3-wide and head is 2-wide across 7 locs).
 *
 * @param {Actor} actor
 */
export async function redistributeHitLocationRanges(actor) {
  const locs = Array.from(actor.items)
    .filter(i => i.type === 'hit-location')
    .sort((a, b) => (a.system.sort ?? 0) - (b.system.sort ?? 0));

  if (locs.length === 0) return;

  const base      = Math.floor(20 / locs.length);
  const remainder = 20 % locs.length;

  const updates = [];
  let cursor = 1;
  for (let i = 0; i < locs.length; i++) {
    const width  = base + (i < remainder ? 1 : 0);
    const rangeMin = cursor;
    const rangeMax = cursor + width - 1;
    cursor += width;
    updates.push({ _id: locs[i].id, 'system.rangeMin': rangeMin, 'system.rangeMax': rangeMax });
  }

  await actor.updateEmbeddedDocuments('Item', updates);
}

// =============================================================================
// ABILITY
// Spells, powers, miracles, special abilities — anything that lives on the
// Abilities tab. Flexible enough for Folk Magic, Animism, Mysticism, Sorcery.
// =============================================================================
export class AbilityData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      // e.g. "Folk Magic", "Animism", "Mysticism", "Sorcery", "Special"
      type:        new fields.StringField({ initial: '' }),
      // Rank or intensity — e.g. "Rank 1", "Magnitude 2", or free text
      rank:        new fields.StringField({ initial: '' }),
      // MP cost or casting cost
      cost:        new fields.StringField({ initial: '' }),
      // Duration string e.g. "1 Round", "Concentration"
      duration:    new fields.StringField({ initial: '' }),
      // Range string e.g. "Touch", "Line of Sight"
      range:       new fields.StringField({ initial: 'Touch' }),
      // Full description / rules text
      description: new fields.StringField({ initial: '' })
    };
  }
}

// ---------------------------------------------------------------------------
// CurrencyData — TypeDataModel for the 'currency' item type
//
// Currency items represent denominations of money in a campaign setting.
// The GM creates these via the currency macro, which calculates baseValue
// from a relative rate chain (e.g. 1 GP = 10 SP = 20 CP → CP=1, SP=20, GP=200).
//
// The engine always works in base units. The macro is the only place where
// relative rates appear — each item stores the resolved absolute baseValue.
//
// Extension: downstream modules add custom denominations by creating currency
// items directly. No CONFIG changes needed.
// ---------------------------------------------------------------------------

export class CurrencyData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      // Short symbol shown in price displays and the Buy dialog (e.g. "GP", "Cr")
      abbreviation: new fields.StringField({ initial: '' }),

      // Absolute value in base units. The base denomination (e.g. Copper Piece)
      // has baseValue: 1. All others are multiples of it.
      // e.g. CP=1, SP=20, GP=200 for a system where 1GP=10SP=20CP
      baseValue: new fields.NumberField({ initial: 1, integer: true, min: 1 }),

      // How many of this denomination the actor holds
      quantity: new fields.NumberField({ initial: 0, integer: true, min: 0 }),

      description: new fields.StringField({ initial: '' })
    };
  }

  // Convenience: total value of this stack in base units
  get totalBaseValue() {
    return (this.baseValue ?? 1) * (this.quantity ?? 0);
  }
}

// ---------------------------------------------------------------------------
// TraitData — TypeDataModel for the 'trait' item type
//
// Traits are first-class identity items that back the string-key system on
// weapons (system.traits[]) and combat styles (system.traits[]). Each trait
// item's system.key is the canonical identifier the engine matches against.
// The description carries full rules text. The graph field is the Phase 11
// node editor hook point (null until that phase begins).
// ---------------------------------------------------------------------------

export class TraitData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      // Family of trait
      category: new fields.StringField({
        initial: 'weapon',
        choices: ['weapon', 'combatStyle', 'creature', 'vehicle', 'ammo']
      }),

      // Canonical key — the string the engine matches against.
      // e.g. 'impaling', 'daredevil', 'adhering'
      key: new fields.StringField({ initial: '' }),

      // Full rules text
      description: new fields.HTMLField({ initial: '' }),

      // Whether the combat engine reads this trait mechanically
      engineEffect: new fields.BooleanField({ initial: false }),

      // Node editor hook — null until Phase 11
      graph: new fields.ObjectField({ initial: null, nullable: true, required: false })
    };
  }
}

// ---------------------------------------------------------------------------
// AMMO
// ---------------------------------------------------------------------------

export class AmmoData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      // Projectile family — drives icon and label in the UI
      type: new fields.StringField({
        initial: 'arrow',
        choices: ['arrow', 'bolt', 'bullet', 'shot', 'thrown']
      }),

      // Trait items dragged onto this ammo item (category: 'ammo').
      // Each entry is { id, name, key } referencing a trait item in the world/compendium.
      // The engine reads these via ctx.ammoTraits at _buildContext time.
      traits: new fields.ArrayField(
        new fields.SchemaField({
          id:   new fields.StringField({ initial: '' }),
          name: new fields.StringField({ initial: '' }),
          key:  new fields.StringField({ initial: '' })
        }),
        { initial: [] }
      ),

      // How many of this ammo item the character is carrying
      quantity: new fields.NumberField({ initial: 1, integer: true, min: 0 }),

      // Encumbrance per item
      enc: new fields.NumberField({ initial: 0, min: 0 }),

      // Price
      price: new fields.SchemaField({
        amount:           new fields.NumberField({ initial: 0, min: 0 }),
        denominationAbbr: new fields.StringField({ initial: '' })
      }),

      // Notes / flavour text
      description: new fields.StringField({ initial: '' })
    };
  }

  /** Total encumbrance for this ammo stack */
  get totalEnc() {
    return (this.enc ?? 0) * (this.quantity ?? 1);
  }
}
