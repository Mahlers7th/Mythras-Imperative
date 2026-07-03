/**
 * mythras-imperative/module/data/CharacterData.js
 *
 * TypeDataModel for the Character actor type.
 * Defines all fields, types, and defaults for a player character.
 */

const { fields } = foundry.data;

export class CharacterData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {

      // --- Identity --------------------------------------------------------
      identity: new fields.SchemaField({
        playerName:  new fields.StringField({ initial: '' }),
        culture:     new fields.StringField({ initial: 'civilised', choices: ['barbarian','civilised','nomadic','primitive'] }),
        career:      new fields.StringField({ initial: '' }),
        age:         new fields.NumberField({ initial: 25, integer: true, min: 0 }),
        species:     new fields.StringField({ initial: 'Human' }),
        background:  new fields.StringField({ initial: '' })
      }),

      // --- Hero Level (Larger-Than-Life Heroics, p.13) ---------------------
      heroLevel:      new fields.StringField({ initial: 'normal', choices: ['normal','pulp','paragon'] }),
      heroAdvantages: new fields.ArrayField(new fields.StringField()),

      // --- Characteristics -------------------------------------------------
      characteristics: new fields.SchemaField({
        str: new fields.SchemaField({ value: new fields.NumberField({ initial: 10, integer: true, min: 0 }) }),
        con: new fields.SchemaField({ value: new fields.NumberField({ initial: 10, integer: true, min: 0 }) }),
        siz: new fields.SchemaField({ value: new fields.NumberField({ initial: 10, integer: true, min: 0 }) }),
        dex: new fields.SchemaField({ value: new fields.NumberField({ initial: 10, integer: true, min: 0 }) }),
        int: new fields.SchemaField({ value: new fields.NumberField({ initial: 10, integer: true, min: 0 }) }),
        pow: new fields.SchemaField({ value: new fields.NumberField({ initial: 10, integer: true, min: 0 }) }),
        cha: new fields.SchemaField({ value: new fields.NumberField({ initial: 10, integer: true, min: 0 }) })
      }),

      // --- Derived Attributes (overrides for GM adjustment) -----------------
      attributes: new fields.SchemaField({
        actionPoints:      new fields.SchemaField({
          value:    new fields.NumberField({ initial: 2, integer: true }),
          max:      new fields.NumberField({ initial: 2, integer: true }),
          bonus:    new fields.NumberField({ initial: 0, integer: true }),
          override: new fields.BooleanField({ initial: false })  // true = max set manually, skip INT+DEX derivation
        }),
        damageModifier:    new fields.StringField({ initial: '' }),   // e.g. "+1d4", "-1d2", "0"
        dmOffset:          new fields.NumberField({ initial: 0, integer: true }),  // step offset applied on top of STR+SIZ table result
        experienceModifier: new fields.NumberField({ initial: 0, integer: true }),
        experienceRolls:   new fields.NumberField({ initial: 0, integer: true, min: 0 }), // session award; spent to improve skills
        healingRate:       new fields.NumberField({ initial: 1, integer: true }),
        initiativeBonus:   new fields.NumberField({ initial: 0, integer: true }),
        luckPoints: new fields.SchemaField({
          value: new fields.NumberField({ initial: 2, integer: true, min: 0 }),
          max:   new fields.NumberField({ initial: 2, integer: true, min: 0 })
        }),
        magicPoints: new fields.SchemaField({
          value: new fields.NumberField({ initial: 10, integer: true, min: 0 }),
          max:   new fields.NumberField({ initial: 10, integer: true, min: 0 })
        }),
        // Power Points — a separate resource pool from Magic Points, used by
        // downstream modules (e.g. Destined superpowers) for activating powers.
        // Kept distinct so the system's own Magic Points mechanics are never
        // overloaded. Defaults to 0; modules populate value/max as needed.
        powerPoints: new fields.SchemaField({
          value: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
          max:   new fields.NumberField({ initial: 0, integer: true, min: 0 })
        }),
        movementRate: new fields.NumberField({ initial: 6, integer: true }),
        // Derived from movementRate — computed in prepareDerivedData, not stored
        walk:   new fields.NumberField({ initial: 6, integer: true }),
        run:    new fields.NumberField({ initial: 18, integer: true }),
        sprint: new fields.NumberField({ initial: 30, integer: true })
      }),

      // --- Hit Locations ----------------------------------------------------
      hitLocations: new fields.SchemaField({
        rightLeg: new fields.SchemaField({
          hp:      new fields.NumberField({ initial: 0, integer: true }),
          current: new fields.NumberField({ initial: 0, integer: true }),
          ap:      new fields.NumberField({ initial: 0, integer: true, min: 0 }),
          wound:   new fields.StringField({ initial: '' })
        }),
        leftLeg: new fields.SchemaField({
          hp:      new fields.NumberField({ initial: 0, integer: true }),
          current: new fields.NumberField({ initial: 0, integer: true }),
          ap:      new fields.NumberField({ initial: 0, integer: true, min: 0 }),
          wound:   new fields.StringField({ initial: '' })
        }),
        abdomen: new fields.SchemaField({
          hp:      new fields.NumberField({ initial: 0, integer: true }),
          current: new fields.NumberField({ initial: 0, integer: true }),
          ap:      new fields.NumberField({ initial: 0, integer: true, min: 0 }),
          wound:   new fields.StringField({ initial: '' })
        }),
        chest: new fields.SchemaField({
          hp:      new fields.NumberField({ initial: 0, integer: true }),
          current: new fields.NumberField({ initial: 0, integer: true }),
          ap:      new fields.NumberField({ initial: 0, integer: true, min: 0 }),
          wound:   new fields.StringField({ initial: '' })
        }),
        rightArm: new fields.SchemaField({
          hp:      new fields.NumberField({ initial: 0, integer: true }),
          current: new fields.NumberField({ initial: 0, integer: true }),
          ap:      new fields.NumberField({ initial: 0, integer: true, min: 0 }),
          wound:   new fields.StringField({ initial: '' })
        }),
        leftArm: new fields.SchemaField({
          hp:      new fields.NumberField({ initial: 0, integer: true }),
          current: new fields.NumberField({ initial: 0, integer: true }),
          ap:      new fields.NumberField({ initial: 0, integer: true, min: 0 }),
          wound:   new fields.StringField({ initial: '' })
        }),
        head: new fields.SchemaField({
          hp:      new fields.NumberField({ initial: 0, integer: true }),
          current: new fields.NumberField({ initial: 0, integer: true }),
          ap:      new fields.NumberField({ initial: 0, integer: true, min: 0 }),
          wound:   new fields.StringField({ initial: '' })
        })
      }),

      // --- Warded Locations ------------------------------------------------
      // Passive blocking state for the Combat tab Ward checkboxes.
      // Each location records whether it is warded and which weapon/shield
      // is doing the warding. The combat engine reads this during passive
      // blocking resolution (Don't Defend path).
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

      // --- Encumbrance -----------------------------------------------------
      encumbrance: new fields.SchemaField({
        current: new fields.NumberField({ initial: 0, min: 0 }),
        max:     new fields.NumberField({ initial: 0, min: 0 })  // computed from STR+SIZ
      }),

      // --- Currency / Wealth -----------------------------------------------
      wealth: new fields.StringField({ initial: '' }),

      // --- Notes -----------------------------------------------------------
      notes: new fields.StringField({ initial: '' })
    };
  }

  /**
   * Derive attributes automatically from characteristics.
   * Called by Foundry after data is prepared.
   */
  prepareDerivedData() {
    const c = this.characteristics;

    // ── Characteristic bonus hooks (modules) ───────────────────────────────
    // Fire BEFORE any characteristic local is read so deltas cascade into every
    // derived value below. Each hook mutates `c` in place (e.g. Destined
    // Enhanced STR / Growth). Defensive: a throwing hook must not break
    // derivation for the whole actor.
    for (const fn of (CONFIG.MYTHRAS?.characteristicBonusHooks ?? [])) {
      try { fn(c, this.parent); }
      catch (err) { console.error('Mythras | characteristicBonusHook error:', err); }
    }

    const str = c.str.value;
    const con = c.con.value;
    const siz = c.siz.value;
    const dex = c.dex.value;
    const int = c.int.value;
    const pow = c.pow.value;
    const cha = c.cha.value;

    const attr = this.attributes;

    // ── Action Points ──────────────────────────────────────────────────────
    // Derived from INT+DEX table (p.19) unless the GM has set a manual max.
    if (!attr.actionPoints.override) {
      const intDex = int + dex;
      attr.actionPoints.max = intDex <= 12 ? 1
        : 1 + Math.floor((intDex - 1) / 12);
    }

    // Step 2: Fatigue AP penalty (applied before bonus hooks so powers
    // that grant AP are not themselves fatigued away).
    const fatigueLevel = (CONFIG.MYTHRAS?.fatigueLevels ?? [])
      .find(f => f.id === (this.fatigue ?? 'fresh'));
    const apPenalty = fatigueLevel?.actionPenalty ?? 0;
    attr.actionPoints.max = Math.max(1, attr.actionPoints.max - apPenalty);

    // Step 3: Module bonus hooks (e.g. Destined Combat Expert grants +1).
    // Each hook receives the actor document and returns a non-negative integer.
    // Hooks fire after fatigue so bonuses are additive on top of the penalised base.
    const apBonus = (CONFIG.MYTHRAS?.apBonusHooks ?? [])
      .reduce((sum, fn) => {
        try { return sum + (Number(fn(this.parent)) || 0); }
        catch { return sum; }
      }, 0);
    attr.actionPoints.bonus = apBonus;
    attr.actionPoints.max   = Math.max(1, attr.actionPoints.max + apBonus);

    // Clamp value to max if it somehow exceeds it (e.g. max was reduced).
    // Do NOT reset to max when value is 0 — that is a valid in-combat state
    // (all AP spent). AP only refill at the start of a new round via updateCombat.
    if (attr.actionPoints.value > attr.actionPoints.max) {
      attr.actionPoints.value = attr.actionPoints.max;
    }

    // Walk / Run / Sprint derived from base movement rate (p.30)
    // Fatigue: normal → full rates; halved → all halved; immobile → all 0
    // Module movementHooks (e.g. Destined Enhanced Speed / Enhanced Body /
    // Multi-Limbs) add a signed integer to the base BEFORE the trio derives, so
    // walk/run/sprint all inherit the bonus. The stored movementRate is not
    // mutated; this is a read-time adjustment for this cycle only. Floored at 0.
    const moveMode = fatigueLevel?.moveMode ?? 'normal';
    let baseMove = attr.movementRate ?? 6;
    const moveBonus = (CONFIG.MYTHRAS?.movementHooks ?? [])
      .reduce((sum, fn) => {
        try { return sum + (Number(fn(this.parent)) || 0); }
        catch { return sum; }
      }, 0);
    baseMove = Math.max(0, baseMove + moveBonus);
    if (moveMode === 'immobile') {
      attr.walk   = 0;
      attr.run    = 0;
      attr.sprint = 0;
    } else if (moveMode === 'halved') {
      attr.walk   = Math.floor(baseMove / 2);
      attr.run    = Math.floor((baseMove * 3) / 2);
      attr.sprint = Math.floor((baseMove * 5) / 2);
    } else {
      attr.walk   = baseMove;
      attr.run    = baseMove * 3;
      attr.sprint = baseMove * 5;
    }

    // Initiative Bonus: (DEX + INT) / 2, round down
    attr.initiativeBonus = Math.floor((dex + int) / 2);
    // Module initiativeOffsetHooks (e.g. Destined Enhanced Reactions +, Bulky −,
    // Growth −) add a signed integer. Read-time, idempotent.
    for (const fn of (CONFIG.MYTHRAS?.initiativeOffsetHooks ?? [])) {
      try { attr.initiativeBonus += Number(fn(this.parent)) || 0; }
      catch (err) { console.error('Mythras | initiativeOffsetHook error:', err); }
    }

    // Magic Points: equal to POW
    attr.magicPoints.max = pow;
    if (attr.magicPoints.value > attr.magicPoints.max) {
      attr.magicPoints.value = attr.magicPoints.max;
    }

    // Damage Modifier from STR+SIZ table, then apply dmOffset step.
    // Module damageModOffsetHooks (e.g. Destined Enhanced Strength) add a
    // signed step shift on top of the manual offset. Read-time, idempotent:
    // the hook derives from the actor's powers each cycle. STR itself is
    // untouched so lift/encumbrance/skills stay on the true score.
    let dmOffset = attr.dmOffset ?? 0;
    for (const fn of (CONFIG.MYTHRAS?.damageModOffsetHooks ?? [])) {
      try { dmOffset += fn(this.parent) ?? 0; }
      catch (err) { console.error('Mythras | damageModOffsetHook error:', err); }
    }
    attr.damageModifier = this._calcDamageModifierWithOffset(str + siz, dmOffset);

    // Experience Modifier from CHA table
    attr.experienceModifier = this._calcExperienceModifier(cha);

    // Healing Rate from CON table
    attr.healingRate = this._calcHealingRate(con);
    // Module healingRateHooks (e.g. Destined Durability) add a signed integer
    // BEFORE the Hero Level ×2 below, so the power delta stacks additively and
    // is then doubled if the healingRate advantage is present. Read-time.
    for (const fn of (CONFIG.MYTHRAS?.healingRateHooks ?? [])) {
      try { attr.healingRate += Number(fn(this.parent)) || 0; }
      catch (err) { console.error('Mythras | healingRateHook error:', err); }
    }

    // Luck Points from POW table
    attr.luckPoints.max = this._calcLuckPoints(pow);

    // ── Hero Level advantages (Larger-Than-Life Heroics, p.13–14) ──────────
    const adv = this.heroAdvantages ?? [];
    if (adv.includes('actionPoint'))   attr.actionPoints.max   += 1;
    if (adv.includes('luckyPoint'))    attr.luckPoints.max     += 1;
    if (adv.includes('luckyPoint2'))   attr.luckPoints.max     += 2;
    if (adv.includes('healingRate'))   attr.healingRate         = attr.healingRate * 2;
    // hitPoints bonus applied inside _calcHitLocationHP; grade-easier handled at roll time

    // Module luckPointsHooks (e.g. Destined Lucky ×2 / Mega Lucky ×4) add a
    // signed integer to the max AFTER the Hero Level luckyPoint adjustments.
    // Read-time, idempotent.
    for (const fn of (CONFIG.MYTHRAS?.luckPointsHooks ?? [])) {
      try { attr.luckPoints.max += Number(fn(this.parent)) || 0; }
      catch (err) { console.error('Mythras | luckPointsHook error:', err); }
    }
    if (attr.luckPoints.value > attr.luckPoints.max) {
      attr.luckPoints.value = attr.luckPoints.max;
    }

    // Max Encumbrance from STR+SIZ (simplified: STR score)
    this.encumbrance.max = str;

    // Derive hit location HP from CON+SIZ
    this._calcHitLocationHP(con, siz);
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
    if (strSiz <= 60) return '+1d12';
    if (strSiz <= 70) return '+2d6';
    if (strSiz <= 80) return '+2d8';
    if (strSiz <= 90) return '+2d10';
    return '+2d12';
  }

  // The canonical 15-step DM table. Index 0 = worst, 14 = best.
  static DM_TABLE = [
    '-1d8', '-1d6', '-1d4', '-1d2', '+0',
    '+1d2', '+1d4', '+1d6', '+1d8', '+1d10',
    '+1d12', '+2d6', '+2d8', '+2d10', '+2d12'
  ];

  // Map a STR+SIZ sum to its base table index
  _dmBaseIndex(strSiz) {
    if (strSiz <= 5)  return 0;
    if (strSiz <= 10) return 1;
    if (strSiz <= 15) return 2;
    if (strSiz <= 20) return 3;
    if (strSiz <= 25) return 4;
    if (strSiz <= 30) return 5;
    if (strSiz <= 35) return 6;
    if (strSiz <= 40) return 7;
    if (strSiz <= 45) return 8;
    if (strSiz <= 50) return 9;
    if (strSiz <= 60) return 10;
    if (strSiz <= 70) return 11;
    if (strSiz <= 80) return 12;
    if (strSiz <= 90) return 13;
    return 14;
  }

  // Apply a step offset to the base table position and return the DM string.
  _calcDamageModifierWithOffset(strSiz, offset) {
    const table = CharacterData.DM_TABLE;
    const base  = this._dmBaseIndex(strSiz);
    const idx   = Math.max(0, Math.min(table.length - 1, base + (offset ?? 0)));
    return table[idx];
  }

  _calcExperienceModifier(cha) {
    if (cha <= 4)  return -1;
    if (cha <= 12) return 0;
    return 1;
  }

  _calcHealingRate(con) {
    if (con <= 6)  return 1;
    if (con <= 12) return 2;
    if (con <= 18) return 3;
    return 4;
  }

  _calcLuckPoints(pow) {
    if (pow <= 6)  return 1;
    if (pow <= 12) return 2;
    if (pow <= 18) return 3;
    return 4;
  }

  _calcHitLocationHP(con, siz) {
    // HP per location derived from (CON + SIZ) lookup table
    const conSiz = con + siz;
    let head, chest, abdomen, arm, leg;

    if (conSiz <= 5)       { head=1; chest=2; abdomen=2; arm=1; leg=1; }
    else if (conSiz <= 10) { head=2; chest=3; abdomen=3; arm=2; leg=2; }
    else if (conSiz <= 15) { head=3; chest=4; abdomen=4; arm=3; leg=3; }
    else if (conSiz <= 20) { head=4; chest=5; abdomen=5; arm=3; leg=4; }
    else if (conSiz <= 25) { head=5; chest=6; abdomen=6; arm=4; leg=5; }
    else if (conSiz <= 30) { head=6; chest=7; abdomen=7; arm=5; leg=6; }
    else if (conSiz <= 35) { head=7; chest=8; abdomen=8; arm=6; leg=7; }
    else if (conSiz <= 40) { head=8; chest=9; abdomen=9; arm=7; leg=8; }
    else                   { head=9; chest=10; abdomen=10; arm=8; leg=9; }

    // Hero Level HP bonus
    const adv = this.heroAdvantages ?? [];
    const hpBonus = adv.includes('hitPoints2') ? 2 : adv.includes('hitPoints') ? 1 : 0;
    if (hpBonus) { head += hpBonus; chest += hpBonus; abdomen += hpBonus; arm += hpBonus; leg += hpBonus; }

    // hitPointBonusHooks are NOT consumed here. hit-location items are the
    // sole HP-max authority — mythras.mjs syncHitLocationHP() is the one
    // writer, and it applies the hook sum at write time. This derived object
    // is read by nothing for HP-max purposes.
    const locs = this.hitLocations;
    locs.head.hp    = head;
    locs.chest.hp   = chest;
    locs.abdomen.hp = abdomen;
    locs.rightArm.hp = arm;
    locs.leftArm.hp  = arm;
    locs.rightLeg.hp = leg;
    locs.leftLeg.hp  = leg;

    // Sync current to hp when uninitialised (0) — ensures fresh characters show full HP
    for (const loc of Object.values(locs)) {
      if (loc.current === 0 && loc.hp > 0) loc.current = loc.hp;
    }
  }
}
