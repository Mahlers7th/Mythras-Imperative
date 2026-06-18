/**
 * mythras-imperative/module/utils/meg-import.js
 *
 * Transforms a Mythras Encounter Generator (MEG) JSON export into a Foundry
 * actor document that can be created directly via Actor.create().
 *
 * MEG exports are always a JSON array; each element is one creature. This
 * module handles a single element (the caller decides which index to use).
 *
 * Usage (from a GM macro or dialog):
 *   import { megToFoundryActor } from './module/utils/meg-import.js';
 *   const docData = megToFoundryActor(megJson[0]);
 *   await Actor.create(docData);
 *
 * The transformer handles:
 *   - Characteristics (STR/CON/SIZ/DEX/INT/POW/CHA)
 *   - Derived attributes (action points, damage modifier, magic points, movement)
 *   - Hit locations → embedded hit-location items (with natural AP per location)
 *   - Skills → embedded skill items (professional category if not in standard list)
 *   - Passions → embedded passion items (detected by length heuristic)
 *   - Combat styles → embedded combat-style items
 *   - Weapons → embedded weapon items (linked into the combat style)
 *   - Creature traits → embedded trait items (mapped from features array)
 *   - Notes → identity.specialAbilities (unmatched features also appended here)
 *
 * Fields MEG provides that are intentionally ignored:
 *   - cult_rank, cults, spirits — not in scope
 *   - folk_spells / theism_spells / sorcery_spells / mysticism_spells — Phase 8
 *   - attributes.strike_rank — derived by prepareDerivedData from DEX+INT
 */

// ---------------------------------------------------------------------------
// Standard skill names — used to distinguish skills from passions.
// A MEG skill entry whose key matches none of these (and is long) is treated
// as a passion item instead of a skill item.
// ---------------------------------------------------------------------------
const STANDARD_SKILL_NAMES = new Set([
  'Athletics', 'Boating', 'Brawn', 'Conceal', 'Customs', 'Dance', 'Deceit',
  'Drive', 'Endurance', 'Evade', 'First Aid', 'Influence', 'Insight', 'Locale',
  'Native Tongue', 'Perception', 'Ride', 'Sing', 'Stealth', 'Swim',
  'Unarmed', 'Willpower',
]);

// MEG weapon type string → WeaponData category
const WEAPON_CATEGORY = {
  '1h-melee':  'melee',
  '2h-melee':  'melee',
  'ranged':    'ranged',
  'thrown':    'ranged',
};

// MEG size codes are the same as WeaponData size choices (S/M/L/H/E)
// MEG also uses 'C' (Colossal) which maps to 'E' (Enormous, the largest we have)
const SIZE_MAP = { S: 'S', M: 'M', L: 'L', H: 'H', E: 'E', C: 'E' };

// Reach values are the same in MEG and WeaponData (T/S/M/L/VL)
const REACH_MAP = { T: 'T', S: 'S', M: 'M', L: 'L', VL: 'VL' };

// ---------------------------------------------------------------------------
// MEG feature name → canonical creature trait key
// MEG's features array uses plain English names from the rulebook (pp.76-79).
// Keys below match CONFIG.MYTHRAS.creatureTraits.
// Matching is case-insensitive and strips parenthetical parameters so that
// entries like "Immunity (Fire)" and "Regeneration (2)" are handled cleanly.
// The numeric parameter from traits like "Regeneration (2)" is extracted
// separately and written to system.value on the created trait item.
// ---------------------------------------------------------------------------
const MEG_FEATURE_MAP = {
  'adhering':                   'adhering',
  'aquatic':                    'aquatic',
  'blood sense':                'bloodSense',
  'breathe flame':              'breatheFlame',
  'breath flame':               'breatheFlame',    // alternate spelling
  'breath weapon':              'breatheFlame',    // MEG notes section header
  'camouflaged':                'camouflaged',
  'characteristic drain':       'characteristicDrain',
  'cold-blooded':               'coldBlooded',
  'cold blooded':               'coldBlooded',
  'dark sight':                 'darkSight',
  'death sense':                'deathSense',
  'disease immunity':           'diseaseImmunity',
  'diving strike':              'divingStrike',
  'earth sense':                'earthSense',
  'echolocation':               'echolocation',
  'engulfing':                  'engulfing',
  'flying':                     'flying',
  'formidable natural weapons': 'formidableNaturalWeapons',
  'frenzy':                     'frenzy',
  'gaze attack':                'gazeAttack',
  'grappler':                   'grappler',
  'hold breath':                'holdBreath',
  'immunity':                   'immunity',
  'intimidate':                 'intimidate',
  'leaper':                     'leaper',
  'life sense':                 'lifeSense',
  'magic sense':                'magicSense',
  'multi-headed':               'multiHeaded',
  'multi headed':               'multiHeaded',
  'multi-limbed':               'multiLimbed',
  'multi limbed':               'multiLimbed',
  'night sight':                'nightSight',
  'poison immunity':            'poisonImmunity',
  'regeneration':               'regeneration',
  'swimmer':                    'swimmer',
  'terrifying':                 'terrifying',
  'trample':                    'trample',
  'undead':                     'undead',
  'vampiric':                   'vampiric',
  'venomous':                   'venomous',
  'wing buffet':                'wingBuffet',
};

/**
 * Parse a MEG feature string into a canonical trait key and optional numeric value.
 * Handles three formats MEG actually produces:
 *   - Plain:    "Flying"  /  "Regeneration (2)"  /  "Immunity (Fire)"
 *   - Markdown: "Ability: ***Dark Sight*** see normally in any level of limited light"
 *   - Markdown: "***Formidable Natural Weapons***"
 * Returns null if no mapping found.
 */
function parseMegFeature(featureStr) {
  // Strip leading "Ability:" prefix MEG sometimes adds
  let cleaned = featureStr.replace(/^Ability\s*:\s*/i, '').trim();

  // Extract bold markdown name: ***TraitName*** ... rest of prose
  const boldMatch = cleaned.match(/^\*{3}([^*]+)\*{3}/);
  if (boldMatch) {
    cleaned = boldMatch[1].trim();
  }

  // Extract parenthetical content: "Regeneration (2)" → base="Regeneration", paren="2"
  const parenMatch = cleaned.match(/^(.+?)\s*\(([^)]+)\)\s*(?:$|:)/);
  const baseName   = (parenMatch ? parenMatch[1] : cleaned).trim().toLowerCase();
  const parenValue = parenMatch ? parenMatch[2].trim() : null;

  const key = MEG_FEATURE_MAP[baseName];
  if (!key) return null;

  // Numeric paren → value field (e.g. Regeneration (2), Vampiric (2))
  const numeric = parenValue !== null ? parseInt(parenValue, 10) : NaN;
  const value   = !isNaN(numeric) ? numeric : null;
  // Non-numeric paren → display param (e.g. Immunity (Fire))
  const param   = (parenValue !== null && isNaN(numeric)) ? parenValue : null;

  return { key, value, param };
}

/**
 * Scan the MEG notes string for trait names that appear as section headers.
 * MEG often puts ability text into notes as:
 *   "Immunity (Fire): This creature is completely immune..."
 *   "Trample: The creature is able to trample..."
 *   "Breathe Flame / Breath Weapon: ..."
 * We scan for lines where a known trait name precedes a colon.
 * Returns an array of parsed trait objects (same shape as parseMegFeature).
 * Only returns traits NOT already found in the features array (no duplicates).
 */
function extractTraitsFromNotes(notesStr, alreadyFound) {
  if (!notesStr) return [];
  const foundKeys = new Set(alreadyFound.map(t => t.key));
  const results   = [];

  // Split on newlines; test each line for "TraitName (param): prose" or "TraitName: prose"
  for (const line of notesStr.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Match "Some Trait Name (optional param):" at start of line
    const headerMatch = trimmed.match(/^([A-Za-z][A-Za-z\s\-]*)(?:\s*\([^)]*\))?\s*(?:\([^)]*\))?\s*:/);
    if (!headerMatch) continue;
    const candidate = trimmed.match(/^((?:[A-Za-z][A-Za-z\s\-]*?)(?:\s*\([^)]+\))?)\s*:/);
    if (!candidate) continue;
    const parsed = parseMegFeature(candidate[1].trim());
    if (!parsed) continue;
    if (foundKeys.has(parsed.key)) continue;
    foundKeys.add(parsed.key);
    results.push(parsed);
  }

  return results;
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip trailing colon and extra whitespace from a MEG skill key. */
function cleanSkillName(raw) {
  return raw.replace(/:+$/, '').trim();
}

/**
 * Parse a MEG range string like "01-02" or "19-20" into { rangeMin, rangeMax }.
 * Handles zero-padded values ("01") and single-value ranges ("20-20").
 */
function parseRange(rangeStr) {
  const parts = rangeStr.split('-');
  const rangeMin = parseInt(parts[0], 10);
  const rangeMax = parseInt(parts[1], 10);
  return { rangeMin, rangeMax };
}

/**
 * Detect whether a MEG skill entry should be treated as a passion rather than
 * a skill item. Heuristic: name is not in the standard skill list AND is either
 * longer than 40 characters OR contains no parentheses (i.e. not a professional
 * skill like "Language (Chromatic Dragon)").
 *
 * For this importer we use a simpler rule: if the cleaned name contains a comma,
 * or is longer than 45 characters, it's a passion. Professional skills (even
 * unusual ones) tend to be shorter and use parenthetical notation.
 */
function isPassion(name) {
  if (STANDARD_SKILL_NAMES.has(name)) return false;
  // Long descriptive strings like "Quick to anger, suspicious..." are passions
  return name.includes(',') || name.length > 45;
}

/**
 * Parse MEG's movement string (e.g. "15', 50' fly") into a display string
 * using metres (1 foot ≈ 0.3 metres, Mythras uses 5ft = 1.5m convention).
 * Mythras actually works in metres natively; MEG sometimes outputs feet for
 * Classic Fantasy creatures. We store the original string as-is — the GM can
 * correct it if needed. A pure-number string is returned unchanged.
 */
function parseMovement(movStr) {
  if (!movStr) return '6';
  // Remove foot-mark characters and return the cleaned string
  return movStr.replace(/'/g, 'ft').trim();
}

// ---------------------------------------------------------------------------
// Main transformer
// ---------------------------------------------------------------------------

/**
 * Transform a single MEG creature object into a Foundry actor document.
 *
 * @param {object} meg  - One element from a MEG JSON export array.
 * @returns {{ docData: object, styleWeaponMap: Map<string,string[]> }}
 *   docData        — actor document suitable for Actor.create()
 *   styleWeaponMap — maps combat-style name → array of weapon names,
 *                    used for post-create weapon linking
 */
export function megToFoundryActor(meg) {

  // --- 1. Name -------------------------------------------------------------
  // MEG appends rank and instance number: "Red Dragon, Young Adult (Rank 10) 1"
  // Strip trailing " N" (trailing space + digit(s)) and trim.
  const name = meg.name.replace(/\s+\d+$/, '').trim();

  // --- 2. Characteristics --------------------------------------------------
  // MEG: array of single-key objects [{ STR: 31 }, { CON: 31 }, ...]
  const rawStats = {};
  for (const entry of (meg.stats ?? [])) {
    Object.assign(rawStats, entry);
  }
  const characteristics = {
    str: { value: rawStats.STR ?? 10 },
    con: { value: rawStats.CON ?? 10 },
    siz: { value: rawStats.SIZ ?? 13 },
    dex: { value: rawStats.DEX ?? 10 },
    int: { value: rawStats.INT ?? 5  },
    pow: { value: rawStats.POW ?? 7  },
    cha: { value: rawStats.CHA ?? 5  },
  };

  // --- 3. Attributes -------------------------------------------------------
  // We store MEG's pre-computed values directly.
  // Strike rank / initiative is re-derived by prepareDerivedData — skip it.
  const megAttr = meg.attributes ?? {};
  const attributes = {
    actionPoints: {
      value: megAttr.action_points ?? 2,
      max:   megAttr.action_points ?? 2,
    },
    damageModifier:  megAttr.damage_modifier ?? '+0',
    initiativeBonus: 0,   // recalculated by prepareDerivedData
    magicPoints: {
      value: megAttr.magic_points ?? rawStats.POW ?? 7,
      max:   megAttr.magic_points ?? rawStats.POW ?? 7,
    },
    movementRate: parseMovement(megAttr.movement),
  };

  // --- 4. Identity / notes -------------------------------------------------
  // MEG's notes block contains special abilities, breath weapons, etc.
  // Store in specialAbilities so it appears on the creature sheet.
  // Unmatched features (no canonical key) are also appended here.
  const megFeatures  = meg.features ?? [];
  const unmatchedFeatures = [];
  for (const f of megFeatures) {
    if (!parseMegFeature(f)) unmatchedFeatures.push(f);
  }
  const unmatchedNote = unmatchedFeatures.length
    ? `\n\nUnrecognised features: ${unmatchedFeatures.join(', ')}`
    : '';
  const identity = {
    creatureType:     '',
    specialAbilities: (meg.notes ?? '') + unmatchedNote,
  };

  // --- 5. Natural armour ---------------------------------------------------
  // MEG's natural_armor is a boolean flag; actual AP is encoded per location.
  // We store 0 here — per-location AP comes through on the hit-location items.
  const naturalArmour = 0;

  // --- 6. Build item documents --------------------------------------------

  const items = [];

  // 6a. Hit locations -------------------------------------------------------
  // Creature hit locations bypass the humanoid seed hook because the actor
  // will already have hit-location items when createActor fires its guard:
  //   if (!hasLocations) { seed... }
  // The createItem redistribution hook will fire but for creatures it just
  // re-sorts by rangeMin — which is fine since MEG ranges are already correct.

  const megLocs = meg.hit_locations ?? [];
  megLocs.forEach((loc, idx) => {
    const { rangeMin, rangeMax } = parseRange(loc.range);
    items.push({
      name: loc.name,
      type: 'hit-location',
      system: {
        label:    loc.name,
        hp:       loc.hp,
        current:  loc.hp,
        ap:       loc.ap ?? 0,   // natural AP from MEG
        wound:    'none',
        group:    '',
        rangeMin,
        rangeMax,
        sort:     idx,
      }
    });
  });

  // 6b. Skills and Passions -------------------------------------------------
  // MEG: array of single-key objects [{ "Athletics": 77 }, ...]
  // Each key is the skill name (possibly with trailing colon); value is the %.
  // We store the MEG % as `total` and leave bonusPoints/baseValue at 0 —
  // creatures don't use the base-formula derivation path.

  for (const entry of (meg.skills ?? [])) {
    const rawName = Object.keys(entry)[0];
    const total   = Object.values(entry)[0];
    const skillName = cleanSkillName(rawName);

    if (isPassion(skillName)) {
      // Treat as a Passion item
      items.push({
        name: skillName,
        type: 'passion',
        system: {
          verb:        'Passion',
          target:      '',
          baseFormula: 'POW+CHA',
          baseValue:   0,
          bonusPoints: 0,
          total,
          description: '',
          fumbledLastSession: false,
        }
      });
    } else {
      const isStandard = STANDARD_SKILL_NAMES.has(skillName);
      items.push({
        name: skillName,
        type: 'skill',
        system: {
          category:    isStandard ? 'standard' : 'professional',
          baseFormula: '',
          baseValue:   0,
          bonusPoints: 0,
          total,
          description: '',
          fumbledLastSession: false,
        }
      });
    }
  }

  // 6c. Combat styles and weapons -------------------------------------------
  // MEG groups weapons under a combat_styles array. Each style has:
  //   name, value (skill %), weapons[]
  // We create one combat-style item per style, and one weapon item per weapon.
  // The combat-style's `weapons` array stores { id, name } references.
  // Since we're building the document before Actor.create(), we don't yet have
  // real item IDs — we use placeholder IDs that will be replaced by Foundry on
  // import. Instead, we leave the style's weapons array empty and note the
  // weapon names in the style description so the GM can link them manually.
  // (Foundry doesn't assign embedded item IDs until after creation — we can't
  // cross-reference them in the creation payload.)

  // styleWeaponMap: style name → weapon names, for post-create ID linking
  const styleWeaponMap = new Map();

  for (const style of (meg.combat_styles ?? [])) {
    const styleWeaponNames = [];

    for (const w of (style.weapons ?? [])) {
      const category = WEAPON_CATEGORY[w.type] ?? 'melee';
      const size  = SIZE_MAP[w.size]  ?? 'M';
      const reach = REACH_MAP[w.reach] ?? 'M';

      // Parse range for ranged weapons. MEG stores range as e.g. "155'" —
      // we put this in description since our range fields expect metres as numbers.
      let description = '';
      if (category === 'ranged' && w.range && w.range !== '-') {
        description = `Range: ${w.range}`;
      }
      if (w.effects && w.effects !== 'None' && w.effects !== null) {
        description += (description ? '\n' : '') + `Effects: ${w.effects}`;
      }

      const isShield = /shield/i.test(w.name);
      items.push({
        name: w.name,
        type: 'weapon',
        system: {
          category,
          damage:           w.damage ?? '1d6',
          size:             category === 'melee' ? size : 'M',
          force:            category === 'ranged' ? size : 'M',
          reach:            category === 'melee' ? reach : 'M',
          rangeClose:       0,
          rangeEffective:   0,
          rangeLong:        0,
          rangeExtreme:     0,
          load:             0,
          ammo:             0,
          ammoMax:          0,
          firingMode:       'single',
          burstSize:        0,
          cyclicRate:       0,
          impaleSize:       'M',
          damageModApplies: w.add_damage_modifier ?? true,
          ap:               w.ap ?? 0,
          hp:               w.hp ?? 0,
          currentHP:        w.hp ?? 0,
          enc:              0,
          traits:           isShield ? ['shield'] : [],
          description,
          equipped:         true,
          price: { amount: 0, denominationAbbr: '' }
        }
      });

      styleWeaponNames.push(w.name);
    }

    styleWeaponMap.set(style.name, [...styleWeaponNames]);

    // Combat style — weapons array starts empty; filled in post-create pass
    // once the actor exists and embedded item IDs are known.
    items.push({
      name: style.name,
      type: 'combat-style',
      system: {
        baseFormula:  '',
        baseValue:    0,
        bonusPoints:  0,
        total:        style.value ?? 0,
        weapons:      [],
        traits:       [],
        description:  '',
        fumbledLastSession: false,
      }
    });
  }

  // 6d. Creature traits from MEG features array + notes scanning -----------
  // MEG's features array is often empty or contains markdown prose. We parse
  // both the features array and the notes field to extract trait names.
  // Traits found in features take priority; notes scanning adds any not
  // already found. Nothing is silently dropped — unmatched features are
  // appended to identity.specialAbilities.
  const parsedFromFeatures = megFeatures
    .map(f => parseMegFeature(f))
    .filter(Boolean);

  const parsedFromNotes = extractTraitsFromNotes(meg.notes ?? '', parsedFromFeatures);

  const allParsedTraits = [...parsedFromFeatures, ...parsedFromNotes];

  for (const parsed of allParsedTraits) {
    const traitDef = CONFIG.MYTHRAS?.creatureTraits?.[parsed.key] ?? {};
    // Display name: use param suffix for things like "Immunity (Fire)"
    const traitName = parsed.param
      ? `${traitDef.label ?? parsed.key} (${parsed.param})`
      : (traitDef.label ?? parsed.key);

    items.push({
      name: traitName,
      type: 'trait',
      system: {
        category:     'creature',
        key:          parsed.key,
        description:  traitDef.description ?? '',
        engineEffect: traitDef.engineEffect ?? false,
        value:        parsed.value ?? 1,
        graph:        null,
      }
    });
  }

  // --- 7. Assemble final document ------------------------------------------
  const docData = {
    name,
    type: 'creature',
    system: {
      identity,
      characteristics,
      attributes,
      hitLocations: [],   // creature schema field — not used; real data is in items
      naturalArmour,
      fatigue:    'fresh',
      conditions: {
        prone: false, bleeding: false, unconscious: false,
        surprised: false, entangled: false, burning: false
      },
      notes: '',
    },
    items,
  };

  return { docData, styleWeaponMap };
}

// ---------------------------------------------------------------------------
// Post-create: link weapon items into combat styles by name
// ---------------------------------------------------------------------------

/**
 * After Actor.create() the actor has real embedded item IDs.
 * Walk each combat style in styleWeaponMap, find weapon items on the actor
 * by name, and write { id, name } entries into the style's weapons array.
 *
 * @param {Actor}            actor          - The freshly created Foundry actor.
 * @param {Map<string,string[]>} styleWeaponMap - style name → weapon name array.
 */
async function _linkStyleWeapons(actor, styleWeaponMap) {
  if (!actor || !styleWeaponMap.size) return;

  const updates = [];

  for (const [styleName, weaponNames] of styleWeaponMap) {
    const styleItem = actor.items.find(
      i => i.type === 'combat-style' && i.name === styleName
    );
    if (!styleItem) continue;

    const linked = [];
    for (const wName of weaponNames) {
      const weaponItem = actor.items.find(
        i => i.type === 'weapon' && i.name === wName
      );
      if (weaponItem) {
        linked.push({ id: weaponItem.id, name: weaponItem.name });
      }
    }

    if (linked.length) {
      updates.push({ _id: styleItem.id, 'system.weapons': linked });
    }
  }

  if (updates.length) {
    await actor.updateEmbeddedDocuments('Item', updates);
  }
}

// ---------------------------------------------------------------------------
// Dialog — GM file-import UI
// ---------------------------------------------------------------------------

/**
 * Open a dialog that lets the GM paste a MEG JSON export and creates the
 * creature actor(s) in the world.
 *
 * Called from the Actors sidebar button wired up in mythras.mjs.
 */
export async function openMegImportDialog() {
  const html = `
    <div style="display:flex;flex-direction:column;gap:10px;padding:4px 0">
      <p style="margin:0;font-size:0.85em;color:var(--color-text-secondary,#aaa)">
        Select the JSON file exported from the Mythras Encounter Generator (MEG).
        All creatures in the file will be imported as Foundry actors.
      </p>
      <div>
        <label style="display:block;margin-bottom:4px;font-size:0.85em">MEG JSON file</label>
        <input id="meg-file-input" type="file" accept=".json,application/json"
          style="width:100%;box-sizing:border-box"/>
      </div>
      <div id="meg-file-status" style="font-size:0.8em;color:var(--color-text-secondary,#aaa);min-height:1.2em"></div>
    </div>
  `;

  new Dialog({
    title: 'Import from Mythras Encounter Generator (MEG)',
    content: html,
    buttons: {
      import: {
        icon: '<i class="fas fa-file-import"></i>',
        label: 'Import',
        callback: async (dlgHtml) => {
          const root  = (dlgHtml instanceof HTMLElement) ? dlgHtml : dlgHtml[0];
          const input = root.querySelector('#meg-file-input');
          const file  = input?.files?.[0];

          if (!file) {
            ui.notifications.warn('MEG Import | No file selected.');
            return;
          }

          let raw;
          try {
            raw = await file.text();
          } catch (e) {
            ui.notifications.error(`MEG Import | Could not read file: ${e.message}`);
            return;
          }

          let megArray;
          try {
            megArray = JSON.parse(raw);
          } catch (e) {
            ui.notifications.error(`MEG Import | Invalid JSON: ${e.message}`);
            return;
          }

          if (!Array.isArray(megArray)) megArray = [megArray];

          let created = 0;
          for (const meg of megArray) {
            try {
              const { docData, styleWeaponMap } = megToFoundryActor(meg);
              const actor = await Actor.create(docData);
              // Post-create: link weapons into combat style by name now that IDs exist
              await _linkStyleWeapons(actor, styleWeaponMap);
              created++;
            } catch (e) {
              ui.notifications.error(`MEG Import | Failed to import "${meg.name}": ${e.message}`);
              console.error('MEG Import error', e);
            }
          }

          if (created > 0) {
            ui.notifications.info(
              `MEG Import | Created ${created} creature${created > 1 ? 's' : ''}.`
            );
          }
        }
      },
      cancel: {
        icon:  '<i class="fas fa-times"></i>',
        label: 'Cancel'
      }
    },
    default: 'import',
  }, {
    width: 420,
    height: 'auto',
  }).render(true);
}
