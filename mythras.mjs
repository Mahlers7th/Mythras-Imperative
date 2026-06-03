/**
 * mythras-imperative/mythras.mjs
 * Phase 2 — sheets, roll engine, Handlebars helpers, standard skills seeding.
 */

import { MYTHRAS }                    from './module/config/config.js';
import { openMegImportDialog }          from './module/utils/meg-import.js';
import { CharacterData }              from './module/data/CharacterData.js';
import { NPCData, CreatureData, MerchantData, VehicleData } from './module/data/ActorData.js';
import { SkillData, WeaponData, ArmourData, GearData, CombatStyleData, PassionData, AbilityData, HitLocationData, TraitData, CurrencyData, AmmoData, redistributeHitLocationRanges } from './module/data/ItemData.js';
import { CharacterSheet }             from './module/sheets/CharacterSheet.js';
import { TraitSheet }                 from './module/sheets/TraitSheet.js';
import { CurrencySheet }              from './module/sheets/CurrencySheet.js';
import { GearSheet }                  from './module/sheets/GearSheet.js';
import { MerchantSheet }              from './module/sheets/MerchantSheet.js';
import { VehicleSheet }               from './module/sheets/VehicleSheet.js';
import { SkillSheet }                 from './module/sheets/SkillSheet.js';
import { WeaponSheet }                from './module/sheets/WeaponSheet.js';
import { ArmourSheet }                from './module/sheets/ArmourSheet.js';
import { CombatStyleSheet }           from './module/sheets/CombatStyleSheet.js';
import { AmmoSheet }                  from './module/sheets/AmmoSheet.js';
import { CombatEngine }               from './module/combat/CombatEngine.js';
import { weaponBaseMax }              from './module/utils/combat-math.js';
import {
  resolveEntangleBreakFree,
  resolveGripBreakFree,
  postImpaleDecisionCard,
  resolveEntangleTripYes,
  applyImpaleLodge,
  resolveImpaleYank,
  resolveDamageWeapon,
} from './module/combat/effects/index.js';
import { CombatSocket }               from './module/combat/CombatSocket.js';

// ---------------------------------------------------------------------------
// Fatigue utilities — canonical implementations live in module/utils/fatigue.js.
// Re-exported here so any external consumer importing from mythras.mjs still works.
// ---------------------------------------------------------------------------
export { getFatigueSkillGrade, applyFatigueToSkill } from './module/utils/fatigue.js';

// ---------------------------------------------------------------------------
// Standard skills — seeded on every new Character actor
// All 22 from Mythras Imperative with correct base formulae and descriptions
// ---------------------------------------------------------------------------
const STANDARD_SKILLS = [
  { name: 'Athletics',     baseFormula: 'STR+DEX',    description: 'Athletics covers a range of physical activities, including climbing, jumping, throwing, and running. Skill rolls for any of these activities are handled by a single roll against the Athletics skill.' },
  { name: 'Boating',       baseFormula: 'STR+CON',    description: 'The Boating skill covers the operation of small floating craft on rivers, lakes, and close inshore. Appropriate vessels are generally boats, canoes, or rafts unsuited to the rigours of the open sea. Ships with large crews or designed for long overseas journeys are covered under the Seamanship Professional Skill.' },
  { name: 'Brawn',         baseFormula: 'STR+SIZ',    description: 'Brawn is the efficient application of technique when applying raw physical force. The skill covers acts of applied might, including lifting, breaking down doors and contests of strength.' },
  { name: 'Conceal',       baseFormula: 'DEX+POW',    description: 'Conceal is the counterpoint to Stealth, being the concealment of large objects rather than the character themselves. It is versatile in application, from hiding a scroll in a library to disguising the presence of a trap or secret passage.' },
  { name: 'Customs',       baseFormula: 'INT*2+40',   description: "Customs represents the character's knowledge of their own community: its social codes, rites, rituals, taboos, and so on. Used when it is essential to accurately interpret or perform any socially important custom. Includes a static +40% bonus." },
  { name: 'Dance',         baseFormula: 'DEX+CHA',    description: "Just about every culture uses dance in some way - either as recreation or as part of important rituals. The Dance skill measures a character's ability to move rhythmically and accurately when called upon to do so." },
  { name: 'Deceit',        baseFormula: 'INT+CHA',    description: 'Deceit covers all instances where a character attempts to mask the truth and offer a deception of some kind: barefaced lying, misleading a guard, or bluffing during a card game. Deceit forms a counterpart to the Insight skill and can be used to oppose Insight rolls.' },
  { name: 'Drive',         baseFormula: 'DEX+POW',    description: 'Drive covers the control of wheeled or drawn vehicles, whether by beasts of burden or powered by more esoteric means, such as chariots, sleds, sail carts, or gasoline cars.' },
  { name: 'Endurance',     baseFormula: 'CON*2',      description: "Endurance is a character's capacity to endure physical stress, pain, and fatigue. A general gauge of resilience, stamina, and metabolism, used most specifically to resist the effects of injuries, poisons, and disease." },
  { name: 'Evade',         baseFormula: 'DEX*2',      description: 'Evade is used to escape from observed, impending danger - against ranged weapons, avoiding traps, changing the engagement distance in combat, and generally getting out of the way of physical hazards. Using Evade usually leaves the character prone.' },
  { name: 'First Aid',     baseFormula: 'INT+DEX',    description: "The skill of First Aid measures a character's ability to treat minor injuries and stabilise more severe ones. First Aid may be applied only once per specific injury and heals 1d3 points of damage." },
  { name: 'Influence',     baseFormula: 'CHA*2',      description: "Influence is a measurement of a character's ability to persuade others, through personal charisma, into a desired way of behaving. Used in a wide variety of situations, from changing someone's mind to bribing an official or guard." },
  { name: 'Insight',       baseFormula: 'INT+POW',    description: "Insight is the ability to read or intuitively define another's verbal and non-verbal behaviour to establish their motives and state of mind. Used to determine whether someone is telling a lie (opposed by the other person's Deceit skill)." },
  { name: 'Locale',        baseFormula: 'INT*2',      description: "Locale measures a character's understanding of local flora, fauna, terrain, and weather in the area where they have spent much of their life. In neighbouring, yet unfamiliar locations Locale should be made one or more grades harder." },
  { name: 'Native Tongue', baseFormula: 'INT+CHA+40', description: "Native Tongue is the ability to speak and read one's own language, measuring articulation, eloquence, and the depth of the speaker's vocabulary. Treated as a static representation of overall fluency rather than rolled against directly. Includes a static +40% bonus." },
  { name: 'Perception',    baseFormula: 'INT+POW',    description: 'Perception is used for both passive observation and focused detection; whether hunting for something specific, a general scan of an area, or simple awareness of surroundings. Specific conditions such as darkness may affect the Difficulty Grade.' },
  { name: 'Ride',          baseFormula: 'DEX+POW',    description: 'Ride covers the ability to control and remain mounted on those creatures that are trained to be ridden. It can be applied to a diverse range of beasts. Riding an unfamiliar species is always one Difficulty Grade harder.' },
  { name: 'Sing',          baseFormula: 'CHA+POW',    description: "Carrying a tune is covered by Sing, anything from monotonous chants through to complex arias. The skill reflects the user's ability to maintain rhythm, keep in key, and remember the correct words." },
  { name: 'Stealth',       baseFormula: 'DEX+INT',    description: 'Hiding out of plain sight, or moving with minimal sound, are covered by the Stealth skill. Cover and conditions such as darkness or loud background noise improve the grade of the skill.' },
  { name: 'Swim',          baseFormula: 'STR+CON',    description: "Without development, the ability to swim is limited to keeping one's head above water for a short time. Higher Swim percentages indicate being able to negotiate deeper and stronger waters with less risk of drowning." },
  { name: 'Unarmed',       baseFormula: 'STR+DEX',    description: "Unarmed is a universal Combat Skill common to all characters, measuring the ability to defend oneself without weapons. As a Combat Skill, its Critical and Fumble effects are covered by the rules for combat." },
  { name: 'Willpower',     baseFormula: 'POW*2',      description: "Willpower is a measure of a character's ability to concentrate, channel their force of will in a particular direction, or harden their psyche to possible mental shock. Used in all situations where mental resilience is required, including resisting magic." },
];

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------
Hooks.once('init', () => {
  console.log('Mythras Imperative | Initialising');
  globalThis.MYTHRAS = MYTHRAS;
  CONFIG.MYTHRAS     = MYTHRAS;
  CONFIG.MYTHRAS.CombatEngine = CombatEngine;

  CONFIG.Actor.dataModels = {
    character: CharacterData, npc: NPCData, creature: CreatureData, merchant: MerchantData,
    vehicle: VehicleData,
    ...MYTHRAS.dataModels.actors
  };
  CONFIG.Item.dataModels = {
    skill: SkillData, weapon: WeaponData, armour: ArmourData,
    gear: GearData, 'combat-style': CombatStyleData, passion: PassionData,
    ability: AbilityData, 'hit-location': HitLocationData, trait: TraitData, currency: CurrencyData,
    ammo: AmmoData,
    ...MYTHRAS.dataModels.items
  };

  DocumentSheetConfig.registerSheet(Actor, 'mythras-imperative', CharacterSheet, {
    types: ['character', 'npc', 'creature'], makeDefault: true,
    label: 'Mythras Imperative Character Sheet'
  });
  DocumentSheetConfig.registerSheet(Actor, 'mythras-imperative', MerchantSheet, {
    types: ['merchant'], makeDefault: true,
    label: 'Mythras Imperative Merchant Sheet'
  });
  DocumentSheetConfig.registerSheet(Actor, 'mythras-imperative', VehicleSheet, {
    types: ['vehicle'], makeDefault: true,
    label: 'Mythras Imperative Vehicle Sheet'
  });

  DocumentSheetConfig.registerSheet(Item, 'mythras-imperative', SkillSheet, {
    types: ['skill', 'passion'], makeDefault: true,
    label: 'Mythras Imperative Skill Sheet'
  });

  DocumentSheetConfig.registerSheet(Item, 'mythras-imperative', CombatStyleSheet, {
    types: ['combat-style'], makeDefault: true,
    label: 'Mythras Imperative Combat Style Sheet'
  });

  DocumentSheetConfig.registerSheet(Item, 'mythras-imperative', WeaponSheet, {
    types: ['weapon'], makeDefault: true,
    label: 'Mythras Imperative Weapon Sheet'
  });

  DocumentSheetConfig.registerSheet(Item, 'mythras-imperative', ArmourSheet, {
    types: ['armour'], makeDefault: true,
    label: 'Mythras Imperative Armour Sheet'
  });
  DocumentSheetConfig.registerSheet(Item, 'mythras-imperative', TraitSheet, {
    types: ['trait'], makeDefault: true,
    label: 'Mythras Imperative Trait Sheet'
  });
  DocumentSheetConfig.registerSheet(Item, 'mythras-imperative', CurrencySheet, {
    types: ['currency'], makeDefault: true,
    label: 'Mythras Imperative Currency Sheet'
  });
  DocumentSheetConfig.registerSheet(Item, 'mythras-imperative', GearSheet, {
    types: ['gear'], makeDefault: true,
    label: 'Mythras Imperative Gear Sheet'
  });
  DocumentSheetConfig.registerSheet(Item, 'mythras-imperative', AmmoSheet, {
    types: ['ammo'], makeDefault: true,
    label: 'Mythras Imperative Ammo Sheet'
  });

  CONFIG.Combat.initiative = { formula: '1d10 + @attributes.initiativeBonus', decimals: 0 };

  // ---------------------------------------------------------------------------
  // Register MYTHRAS conditions as Foundry v14 token status effects.
  // CONFIG.MYTHRAS.conditions uses { label, icon }; Foundry statusEffects
  // expects { id, name, img }. We map across and push into the global array.
  // Existing core Foundry effects (dead, unconscious, etc.) are preserved —
  // we only add entries for ids not already present.
  // ---------------------------------------------------------------------------
  const existingIds = new Set((CONFIG.statusEffects ?? []).map(e => e.id));
  for (const [id, def] of Object.entries(MYTHRAS.conditions)) {
    if (existingIds.has(id)) continue;
    CONFIG.statusEffects.push({
      id,
      // game.i18n.localize() is NOT available during the init hook in Foundry v14.
      // i18n loads after init, so we store the raw label key here.
      // Foundry will localise it when rendering the token HUD.
      name: def.label,
      img:  def.icon                          // e.g. "icons/svg/eye.svg"
    });
  }

  _registerHelpers();

  // ---------------------------------------------------------------------------
  // Extend Combatant to apply the Surprised initiative penalty (-10).
  // getInitiativeRoll(formula) is called per-combatant in v14 when initiative
  // is rolled. We append "- 10" to the formula string when the combatant's
  // token actor has the surprised status. Foundry evaluates the returned Roll.
  // ---------------------------------------------------------------------------
  const _BaseCombatant = CONFIG.Combatant.documentClass;
  class MythrasCombatant extends _BaseCombatant {
    getInitiativeRoll(formula) {
      const actor = this.token?.actor ?? this.actor;
      let mod = 0;
      let notes = [];

      // Surprised penalty
      if (actor?.statuses?.has('surprised')) {
        console.log(`Mythras Imperative | ${actor?.name} is Surprised — applying -10 to initiative`);
        ui.notifications.info(`${actor.name} is Surprised — Initiative −10`);
        mod -= 10;
        notes.push('Surprised −10');
      }

      // Fatigue initiative penalty
      if (actor) {
        const fatigueId = actor.system?.fatigue ?? 'fresh';
        const fatigueDef = (CONFIG.MYTHRAS?.fatigueLevels ?? []).find(f => f.id === fatigueId);
        const initPenalty = fatigueDef?.initiativePenalty ?? 0;
        if (initPenalty > 0) {
          mod -= initPenalty;
          notes.push(`${fatigueId.charAt(0).toUpperCase() + fatigueId.slice(1)} −${initPenalty}`);
        }
      }

      if (mod !== 0) {
        formula = `(${formula ?? CONFIG.Combat.initiative.formula}) + (${mod})`;
      }
      return super.getInitiativeRoll(formula);
    }
  }
  CONFIG.Combatant.documentClass = MythrasCombatant;

  console.log('Mythras Imperative | Init complete');
});

// ---------------------------------------------------------------------------
// SETUP
// ---------------------------------------------------------------------------
Hooks.once('setup', () => {
  for (const [t, m] of Object.entries(MYTHRAS.dataModels.actors)) CONFIG.Actor.dataModels[t] = m;
  for (const [t, m] of Object.entries(MYTHRAS.dataModels.items))  CONFIG.Item.dataModels[t]  = m;
  for (const [t, s] of Object.entries(MYTHRAS.sheets.actors))
    DocumentSheetConfig.registerSheet(Actor, 'mythras-imperative', s, { types: [t], makeDefault: true });
  for (const [t, s] of Object.entries(MYTHRAS.sheets.items))
    DocumentSheetConfig.registerSheet(Item, 'mythras-imperative', s, { types: [t], makeDefault: true });

  // Settings registered here so all Foundry APIs are fully available

  // Automation level — three modes
  game.settings.register('mythras-imperative', 'automationLevel', {
    name:    'Combat Automation Level',
    hint:    'Manual: roll and post to chat only. Semi-Auto: full dialogs, player/GM always chooses Special Effects, click-through damage. Full Auto: same as Semi but damage and wounds applied automatically after SEs are chosen.',
    scope:   'world',
    config:  true,
    type:    String,
    choices: {
      manual:   'Manual — Roll and post to chat',
      semi:     'Semi-Automatic — Dialogs, choose SEs, click-through damage',
      full:     'Full Automatic — Dialogs, choose SEs, auto damage & wounds'
    },
    default: 'manual'
  });

  // GM Mode toggle — works with Semi and Full Auto only.
  // Collapses the defender dialog inline on the attacker dialog so the GM
  // can make the defence choice without a socket round-trip.
  // Intended as a prep/testing tool, not for live multiplayer sessions.
  game.settings.register('mythras-imperative', 'gmMode', {
    name:    'GM Mode',
    hint:    'When enabled (Semi/Full Auto only), the defender\'s choices appear inline on the attacker dialog. The GM picks both sides. Useful for prep, testing, and running NPCs/animals without a socket round-trip.',
    scope:   'world',
    config:  true,
    type:    Boolean,
    default: false
  });
});

// ---------------------------------------------------------------------------
// READY
// ---------------------------------------------------------------------------
Hooks.once('ready', () => {
  console.log('Mythras Imperative | Ready');
  console.log('Actor types:', Object.keys(CONFIG.Actor.dataModels));
  console.log('Item types:',  Object.keys(CONFIG.Item.dataModels));

  // Register the combat socket listener.
  // This must run in 'ready' — game.socket is not available before this hook.
  CombatSocket.register();

  // ── Settings migration ────────────────────────────────────────────────────
  // If an old stored value ('automated', 'gmOnly') is present from a previous
  // version, reset it to 'manual' so the settings UI renders correctly.
  if (game.user.isGM) {
    const valid  = ['manual', 'semi', 'full'];
    const stored = game.settings.get('mythras-imperative', 'automationLevel');
    if (!valid.includes(stored)) {
      game.settings.set('mythras-imperative', 'automationLevel', 'manual');
      ui.notifications.info('Mythras Imperative: Combat automation level reset to Manual (settings updated).');
    }
  }
});

// ---------------------------------------------------------------------------
// PAUSE GRAPHIC — swap in The Design Mechanism logo when the game is paused.
// GamePause is an ApplicationV2 in v14. The renderGamePause hook fires each
// time the banner is rendered and receives (app, element). We find the icon
// element rendered by the template and replace it with our <img>.
// ---------------------------------------------------------------------------

// Disable all sibling buttons in a `.mi-manual-actions` container once one is
// clicked, preventing double-activation.  Called from chat card button handlers.
function _disableSiblingButtons(btn) {
  btn.closest('.mi-manual-actions')
    ?.querySelectorAll('button')
    .forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });
}

Hooks.on('renderGamePause', (_app, element) => {
  // The pause banner renders an <i> or <img> icon inside its content.
  // Replace whatever icon is there with the TDM logo image.
  const iconEl = element.querySelector('i[class*="fa"], img.pause-icon');
  if (!iconEl) return;
  const img = document.createElement('img');
  img.src    = 'systems/mythras-imperative/assets/tdm-logo.webp';
  img.alt    = 'The Design Mechanism';
  img.classList.add('pause-icon', 'mi-pause-logo');
  iconEl.replaceWith(img);
});

// ---------------------------------------------------------------------------
// Standard humanoid hit locations — seeded on every new Character/NPC actor.
// Sort values match the ascending d20 order (right leg lowest, head highest).
// HP values are placeholders; CharacterSheet._calcSkillTotals-style logic
// will keep them in sync with CON+SIZ. For NPCs the GM edits directly.
// ---------------------------------------------------------------------------
const HUMANOID_HIT_LOCATIONS = [
  { label: 'Right Leg', sort: 0,  rangeMin: 1,  rangeMax: 3,  hp: 4, ap: 0 },
  { label: 'Left Leg',  sort: 1,  rangeMin: 4,  rangeMax: 6,  hp: 4, ap: 0 },
  { label: 'Abdomen',   sort: 2,  rangeMin: 7,  rangeMax: 9,  hp: 5, ap: 0 },
  { label: 'Chest',     sort: 3,  rangeMin: 10, rangeMax: 12, hp: 6, ap: 0 },
  { label: 'Right Arm', sort: 4,  rangeMin: 13, rangeMax: 15, hp: 3, ap: 0 },
  { label: 'Left Arm',  sort: 5,  rangeMin: 16, rangeMax: 18, hp: 3, ap: 0 },
  { label: 'Head',      sort: 6,  rangeMin: 19, rangeMax: 20, hp: 4, ap: 0 },
];

// ---------------------------------------------------------------------------
// ACTOR CREATED — seed standard skills and hit locations on new Characters/NPCs
// ---------------------------------------------------------------------------
// System components seeded on new vehicle actors as hit-location items.
// 1d10 ranges match the System Component Damage table (rulebook p.59).
// Rolls 9-10 = "None" — no item covers those, the roll just misses all.
// Max hits (hp) per component = Size step at creation time.
const VEHICLE_SYSTEM_COMPONENTS = [
  { label: 'Cargo',         rangeMin: 1, rangeMax: 1, sort: 0 },
  { label: 'Comms',         rangeMin: 2, rangeMax: 2, sort: 1 },
  { label: 'Controls',      rangeMin: 3, rangeMax: 3, sort: 2 },
  { label: 'Drive',         rangeMin: 4, rangeMax: 4, sort: 3 },
  { label: 'Crew',          rangeMin: 5, rangeMax: 5, sort: 4 },
  { label: 'Engine / Fuel', rangeMin: 6, rangeMax: 6, sort: 5 },
  { label: 'Sensors',       rangeMin: 7, rangeMax: 7, sort: 6 },
  { label: 'Weapons',       rangeMin: 8, rangeMax: 8, sort: 7 }
];

const VEHICLE_SIZE_STEPS = {
  small: 1, medium: 2, large: 3, huge: 4, enormous: 5, colossal: 6
};

Hooks.on('createActor', async (actor, _options, _userId) => {
  // --- Vehicle: seed system components as hit-location items --------------
  if (actor.type === 'vehicle') {
    const hasComponents = actor.items.some(i => i.type === 'hit-location');
    if (!hasComponents) {
      const sizeStep = VEHICLE_SIZE_STEPS[actor.system.size] ?? 2;
      const itemData = VEHICLE_SYSTEM_COMPONENTS.map(c => ({
        name:   c.label,
        type:   'hit-location',
        system: {
          label:    c.label,
          hp:       sizeStep,
          current:  sizeStep,
          ap:       0,
          wound:    'none',
          group:    'system',
          rangeMin: c.rangeMin,
          rangeMax: c.rangeMax,
          sort:     c.sort
        }
      }));
      const baseActor = game.actors.get(actor.id) ?? actor;
      await baseActor.createEmbeddedDocuments('Item', itemData);
      console.log(`Mythras Imperative | Seeded ${itemData.length} system components on vehicle "${actor.name}"`);
    }
    return;
  }

  if (!['character', 'npc', 'creature'].includes(actor.type)) return;

  const promises = [];

  // Seed standard skills on characters only
  if (actor.type === 'character') {
    const hasSkills = actor.items.some(i => i.type === 'skill');
    if (!hasSkills) {
      const skillData = STANDARD_SKILLS.map(s => ({
        name:   s.name,
        type:   'skill',
        system: {
          category:    'standard',
          baseFormula: s.baseFormula,
          baseValue:   0,
          bonusPoints: 0,
          total:       0,
          description: s.description ?? '',
          fumbledLastSession: false
        }
      }));
      promises.push(actor.createEmbeddedDocuments('Item', skillData)
        .then(() => console.log(`Mythras Imperative | Seeded ${skillData.length} standard skills on "${actor.name}"`)));
    }
  }

  // Seed hit locations on characters, NPCs, and manually-created creatures
  // (MEG-imported creatures come with locations in the create payload — hasLocations guard prevents double-seeding)
  const hasLocations = actor.items.some(i => i.type === 'hit-location');
  if (!hasLocations) {
    const locData = HUMANOID_HIT_LOCATIONS.map(l => ({
      name:   l.label,
      type:   'hit-location',
      system: {
        label:    l.label,
        hp:       l.hp,
        current:  l.hp,
        ap:       l.ap,
        wound:    'none',
        group:    '',
        rangeMin: l.rangeMin,
        rangeMax: l.rangeMax,
        sort:     l.sort
      }
    }));
    promises.push(actor.createEmbeddedDocuments('Item', locData)
      .then(() => console.log(`Mythras Imperative | Seeded ${locData.length} hit locations on "${actor.name}"`)));
  }

  await Promise.all(promises);
});

// ---------------------------------------------------------------------------
// HIT LOCATION REDISTRIBUTION
// Fires whenever a hit-location item is created or deleted on any actor.
// Debounced per actor — bulk creates (e.g. seeding 7 locations at once)
// only trigger one redistribution after the dust settles.
// ---------------------------------------------------------------------------
const _redistributeDebounce = new Map(); // actorId → timeout id

Hooks.on('createItem', (item, _options, _userId) => {
  if (item.type !== 'hit-location') return;
  if (!item.parent) return;
  if (item.parent.type === 'vehicle') return;  // vehicle system components use fixed 1d10 ranges
  if (item.parent.type === 'creature') return; // creature locations have hand-set MEG ranges
  _scheduleRedistribute(item.parent);
});

Hooks.on('deleteItem', async (item, _options, _userId) => {
  // Hit location redistribution (debounced) — skip vehicle and creature actors
  if (item.type === 'hit-location' && item.parent &&
      item.parent.type !== 'vehicle' && item.parent.type !== 'creature') {
    _scheduleRedistribute(item.parent);
  }

  // When a weapon is deleted from an actor, remove it from any combat styles
  if (item.type === 'weapon' && item.parent) {
    const actor          = item.parent;
    const deletedId      = item.id;
    const affectedStyles = actor.items.filter(i =>
      i.type === 'combat-style' &&
      (i.system.weapons ?? []).some(w => w.id === deletedId)
    );
    for (const style of affectedStyles) {
      const updated = (style.system.weapons ?? []).filter(w => w.id !== deletedId);
      await style.update({ 'system.weapons': updated });
    }
    // Also clear any jam flag entry for this weapon
    const jammed = actor.getFlag('mythras-imperative', 'jammedWeapons') ?? {};
    if (jammed[deletedId]) {
      const updated = { ...jammed };
      delete updated[deletedId];
      await actor.setFlag('mythras-imperative', 'jammedWeapons', updated);
    }
  }
});

function _scheduleRedistribute(actor) {
  if (_redistributeDebounce.has(actor.id)) {
    clearTimeout(_redistributeDebounce.get(actor.id));
  }
  const tid = setTimeout(async () => {
    _redistributeDebounce.delete(actor.id);
    await redistributeHitLocationRanges(actor);
  }, 200); // 200ms — long enough to let a bulk createEmbeddedDocuments finish
  _redistributeDebounce.set(actor.id, tid);
}

// ---------------------------------------------------------------------------
// ACTOR UPDATE — sync hit location item HP when CON or SIZ changes
// ---------------------------------------------------------------------------
Hooks.on('updateActor', async (actor, changed, _options, _userId) => {
  if (!game.user.isGM) return;
  if (!['character', 'npc'].includes(actor.type)) return;

  // ── Fatigue change — apply mechanical penalties ───────────────────────────
  // When fatigue changes, we write the penalised actionPoints.max back to the
  // document so every reader (combat tracker AP reset, dialogs, macros) sees
  // the correct value without relying on prepareDerivedData being in-flight.
  const changedFatigue = foundry.utils.getProperty(changed, 'system.fatigue');
  if (changedFatigue !== undefined) {
    const fatigueLevels = CONFIG.MYTHRAS?.fatigueLevels ?? [];
    const fatigueDef    = fatigueLevels.find(f => f.id === changedFatigue);
    const apPenalty     = fatigueDef?.actionPenalty ?? 0;

    // Recompute base AP max — INT+DEX table unless GM has set a manual override
    let baseMax;
    if (actor.system.attributes.actionPoints.override) {
      baseMax = actor.system.attributes.actionPoints.max;
    } else {
      const intVal = actor.system.characteristics.int.value;
      const dexVal = actor.system.characteristics.dex.value;
      const intDex = intVal + dexVal;
      baseMax = intDex <= 12 ? 1 : 1 + Math.floor((intDex - 1) / 12);
    }

    // Step 2: fatigue penalty
    const penalisedMax = Math.max(1, baseMax - apPenalty);

    // Step 3: module bonus hooks
    const apBonus = (CONFIG.MYTHRAS?.apBonusHooks ?? [])
      .reduce((sum, fn) => { try { return sum + (Number(fn(actor)) || 0); } catch { return sum; } }, 0);
    const newMax = Math.max(1, penalisedMax + apBonus);

    const apUpdates = {
      'system.attributes.actionPoints.max':   newMax,
      'system.attributes.actionPoints.bonus': apBonus
    };

    // Also clamp current value if it now exceeds the new max
    const currentVal = actor.system.attributes.actionPoints.value;
    if (currentVal > newMax) {
      apUpdates['system.attributes.actionPoints.value'] = newMax;
    }

    await actor.update(apUpdates);

    // Notify with the skill grade so the GM knows what's applied
    const skillGrade = fatigueDef?.skillGrade;
    const gradeName  = skillGrade
      ? game.i18n.localize(CONFIG.MYTHRAS?.difficultyGrades?.[skillGrade]?.label ?? skillGrade)
      : null;
    const fatigueName = changedFatigue.charAt(0).toUpperCase() + changedFatigue.slice(1);
    const parts = [`${actor.name} is now ${fatigueName}.`];
    if (skillGrade)  parts.push(`All skills: ${gradeName}.`);
    if (apPenalty)   parts.push(`Action Points max: ${newMax} (−${apPenalty}).`);
    if (fatigueDef?.initiativePenalty > 0) parts.push(`Initiative: −${fatigueDef.initiativePenalty}.`);
    ui.notifications.info(parts.join(' '));
  }

  // ── CON/SIZ change OR heroAdvantages change — sync hit location HP ────────
  const changedCon        = foundry.utils.getProperty(changed, 'system.characteristics.con.value');
  const changedSiz        = foundry.utils.getProperty(changed, 'system.characteristics.siz.value');
  const changedAdvantages = foundry.utils.getProperty(changed, 'system.heroAdvantages');
  if (changedCon === undefined && changedSiz === undefined && changedAdvantages === undefined) return;

  const con    = actor.system.characteristics.con.value;
  const siz    = actor.system.characteristics.siz.value;
  const conSiz = con + siz;

  let head, chest, abdomen, arm, leg;
  if      (conSiz <= 5)  { head=1; chest=2;  abdomen=2;  arm=1; leg=1; }
  else if (conSiz <= 10) { head=2; chest=3;  abdomen=3;  arm=2; leg=2; }
  else if (conSiz <= 15) { head=3; chest=4;  abdomen=4;  arm=3; leg=3; }
  else if (conSiz <= 20) { head=4; chest=5;  abdomen=5;  arm=3; leg=4; }
  else if (conSiz <= 25) { head=5; chest=6;  abdomen=6;  arm=4; leg=5; }
  else if (conSiz <= 30) { head=6; chest=7;  abdomen=7;  arm=5; leg=6; }
  else if (conSiz <= 35) { head=7; chest=8;  abdomen=8;  arm=6; leg=7; }
  else if (conSiz <= 40) { head=8; chest=9;  abdomen=9;  arm=7; leg=8; }
  else                   { head=9; chest=10; abdomen=10; arm=8; leg=9; }

  // Apply hero level HP bonus
  const advantages = actor.system.heroAdvantages ?? [];
  const hpBonus = advantages.includes('hitPoints2') ? 2 : advantages.includes('hitPoints') ? 1 : 0;
  if (hpBonus) { head += hpBonus; chest += hpBonus; abdomen += hpBonus; arm += hpBonus; leg += hpBonus; }

  const hpByKey = {
    head, chest, abdomen,
    rightarm: arm, leftarm: arm,
    rightleg: leg, leftleg: leg
  };

  const locationItems = Array.from(actor.items).filter(i => i.type === 'hit-location');
  if (locationItems.length === 0) return;

  const updates = [];
  for (const loc of locationItems) {
    const key    = (loc.system.label ?? loc.name).toLowerCase().replace(/\s+/g, '');
    const newMax = hpByKey[key] ?? null;
    if (newMax === null || loc.system.hp === newMax) continue;
    updates.push({ _id: loc.id, 'system.hp': newMax });
  }

  if (updates.length > 0) {
    await actor.updateEmbeddedDocuments('Item', updates);
    console.log(`Mythras Imperative | Synced hit location HP for ${actor.name} (CON+SIZ=${conSiz})`);
  }
});

// ---------------------------------------------------------------------------
// SURPRISED CONDITION — Combat tracker integration
//
// Two behaviours:
//
//   1. Initiative penalty (-10) for surprised combatants.
//      In Foundry v14 the correct approach is to extend CONFIG.Combatant
//      .documentClass and override getInitiativeRoll(formula). That method
//      is called per-combatant when initiative is rolled, and returns the
//      Roll instance that Foundry evaluates. We append "- 10" to the formula
//      when the combatant's token has the surprised status.
//
//      This is registered in the init hook (below) where CONFIG is available.
//
//   2. Auto-clear at turn start via the updateCombat hook.
// ---------------------------------------------------------------------------

/**
 * Hook: updateCombat (Foundry v14)
 * Fires after the tracker advances turn or round.
 *
 * Mythras AP rules (p.36-37):
 *   A Mythras combat round is NOT the same as a Foundry round. Foundry increments
 *   its round counter every time the tracker wraps past the last combatant. But in
 *   Mythras the GM cycles through the initiative order as many times as needed until
 *   all combatants have spent all their AP — that full cycle is one Mythras round.
 *
 *   Consequence: we CANNOT use Foundry's round increment as the AP reset trigger,
 *   because the tracker will wrap (and Foundry will fire 'round' in changed) the
 *   moment the lowest-AP combatant runs out — while others may still have AP left.
 *
 *   Correct trigger: AP reset when ALL active combatants have 0 AP remaining.
 *   We check this after every turn advance. When the condition is met we reset
 *   everyone to their max and post a notification.
 *
 * If the newly active combatant's token has the surprised condition, remove it.
 * Only the GM removes effects to avoid permission errors from other clients.
 */
// =============================================================================
// createCombat — clear all pending Mythras combat flags at the start of each
// new combat. This ensures stale flags from a previous session don't fire
// break-free dialogs or trip prompts at the start of a fresh encounter.
// Only the GM runs this.
// =============================================================================
Hooks.on('createCombat', async (combat) => {
  if (!game.user.isGM) return;
  const NS = 'mythras-imperative';
  const pendingFlags = [
    'pendingImpales', 'pendingGripCheck',
    'pendingEntangleTrip', 'pendingEntangleBreakFree',
    'pendingReload'
  ];
  for (const actor of game.actors.contents) {
    for (const flag of pendingFlags) {
      try {
        const val = actor.getFlag(NS, flag);
        if (val && Object.keys(val).length > 0) await actor.unsetFlag(NS, flag);
      } catch (_) {}
    }
  }
});

// =============================================================================
// deleteCombat — clear Prepare Counter flags when combat is ended in the
// combat tracker. Persistent condition flags (impaledBy, grippedBy, etc.)
// are intentionally preserved — they survive between combats. Prepare Counter
// is scoped to "the fight" so it clears when the tracker combat is deleted.
// Only the GM runs this.
// =============================================================================
Hooks.on('deleteCombat', async (_combat) => {
  if (!game.user.isGM) return;
  const NS = 'mythras-imperative';
  for (const actor of game.actors.contents) {
    try {
      const pc = actor.getFlag(NS, 'prepareCounter');
      if (pc) await actor.unsetFlag(NS, 'prepareCounter');
    } catch (_) {}
  }
});

async function _onUpdateCombat(combat, changed) {
  if (!game.user.isGM) return;

  // ── AP reset + Bleed drain — fires when all combatants reach 0 AP ────────
  // A Mythras round ends when ALL active combatants have spent all AP.
  // Rules p.43: at the START of each Combat Round, a bleeding actor loses
  // one Fatigue level. "Combat Round" = one full Mythras round, not a Foundry
  // turn. We detect round end via the allSpent check and drain bleed there.
  if ('turn' in changed || 'round' in changed) {
    const active = combat.combatants.filter(c => !c.defeated);
    const allSpent = active.every(c => {
      const actor = c.token?.actor ?? c.actor;
      if (!actor) return true;
      const ap = actor.system.attributes?.actionPoints;
      if (!ap || typeof ap.max !== 'number') return true;
      return ap.value <= 0;
    });

    if (allSpent && active.length > 0) {
      // ── AP reset ───────────────────────────────────────────────────────────
      const resets = [];
      for (const combatant of active) {
        const actor = combatant.token?.actor ?? combatant.actor;
        if (!actor) continue;
        const ap = actor.system.attributes?.actionPoints;
        if (!ap || typeof ap.max !== 'number') continue;
        resets.push(actor.update({ 'system.attributes.actionPoints.value': ap.max }));
      }
      if (resets.length) {
        await Promise.all(resets);
        ui.notifications.info('Mythras Imperative — new Combat Round: Action Points restored.');
        console.log('Mythras Imperative | All AP spent — new Mythras round, AP reset for all combatants.');
      }

      // ── Pin Weapon reset — pins expire at the end of each Mythras round ───
      for (const combatant of active) {
        const actor = combatant.token?.actor ?? combatant.actor;
        if (!actor) continue;
        const pinned = actor.getFlag('mythras-imperative', 'pinnedWeapons');
        if (pinned && Object.keys(pinned).length > 0) {
          await actor.unsetFlag('mythras-imperative', 'pinnedWeapons');
          console.log(`Mythras Imperative | Pin Weapon cleared for ${actor.name}`);
        }
      }

      // ── Bleed drain — one Fatigue per Mythras round for each bleeding actor ─
      // Rules p.43: "At the start of each Combat Round, the recipient loses
      // one level of Fatigue, until they collapse and possibly die."
      const fatigueLevels = CONFIG.MYTHRAS?.fatigueLevels ?? [];
      for (const combatant of active) {
        const actor = combatant.token?.actor ?? combatant.actor;
        if (!actor?.statuses?.has('bleeding')) continue;

        const currentFatigue = actor.system.fatigue ?? 'fresh';
        const currentIdx     = fatigueLevels.findIndex(f => f.id === currentFatigue);
        if (currentIdx === -1 || currentIdx >= fatigueLevels.length - 1) continue;

        const nextLevel = fatigueLevels[currentIdx + 1];
        await actor.update({ 'system.fatigue': nextLevel.id });

        const nextName = nextLevel.id.charAt(0).toUpperCase() + nextLevel.id.slice(1);
        ui.notifications.warn(`${actor.name} is Bleeding — Fatigue drops to ${nextName}.`);

        // Post a bleed drain chat card
        const content = `
          <div class="mi-chat-card">
            <div class="mi-card-header mi-card-header--stacked">
              <span class="mi-card-actor">${actor.name}</span>
              <span class="mi-card-skill">Blood Loss</span>
            </div>
            <div class="mi-card-body">
              <div class="mi-outcome-row">
                <span class="mi-outcome mi-wound-serious">
                  <i class="fas fa-tint"></i> Bleeding — Fatigue: ${nextName}
                </span>
              </div>
              ${nextLevel.id === 'dead' || nextLevel.id === 'comatose'
                ? `<div class="mi-outcome-row"><span class="mi-outcome mi-wound-major"><i class="fas fa-skull"></i> ${actor.name} has collapsed from blood loss!</span></div>`
                : ''}
            </div>
          </div>`;
        await ChatMessage.create({
          content,
          speaker: ChatMessage.getSpeaker({ actor })
        });

        if (nextLevel.id === 'dead' || nextLevel.id === 'comatose') {
          ui.notifications.error(`${actor.name} has collapsed from blood loss!`);
        }
      }
    }
  }

  // ── Each Turn — clear surprised condition when that combatant's turn arrives
  if (!('turn' in changed) && !('round' in changed)) return;

  const combatant = combat.combatant;
  if (!combatant) return;

  // Use the synthetic actor from the canvas token placeable (same path as _applyStatusToActor)
  // so we remove the effect from the same place it was applied.
  const tokenDoc       = combatant.token ?? null;
  const actor          = tokenDoc?.actor ?? combatant.actor;
  const canvasToken    = canvas?.tokens?.placeables?.find(t => t.document?.id === tokenDoc?.id) ?? null;
  const syntheticActor = canvasToken?.actor ?? actor;

  // ── Pending Entangle trip — post trip-or-skip card at start of attacker's turn
  const pendingEntangleTrip = actor.getFlag('mythras-imperative', 'pendingEntangleTrip') ?? {};
  if (Object.keys(pendingEntangleTrip).length > 0) {
    const { CombatEngine } = await import('./module/combat/CombatEngine.js');
    for (const entry of Object.values(pendingEntangleTrip)) {
      await CombatEngine._postEntangleTripCard(actor, entry);
    }
    // Clear pending — user action on the card drives the rest
    await actor.setFlag('mythras-imperative', 'pendingEntangleTrip', {});
  }

  // ── Pending Entangle break-free — post Brawn roll at start of entangled actor's turn
  // The resolver owns the flag: clears the entry on success, re-queues on failure.
  // Clear first, then dispatch — so re-queued entries from the resolver accumulate
  // cleanly and are not wiped by a post-loop clear.
  const pendingEntangleBreakFree = actor.getFlag('mythras-imperative', 'pendingEntangleBreakFree') ?? {};
  if (Object.keys(pendingEntangleBreakFree).length > 0) {
    const { CombatEngine } = await import('./module/combat/CombatEngine.js');
    await actor.setFlag('mythras-imperative', 'pendingEntangleBreakFree', {});
    for (const [entangleId, entry] of Object.entries(pendingEntangleBreakFree)) {
      await resolveEntangleBreakFree(actor, entry, entangleId);
    }
  }

  // ── Pending Grip break-free — post break-free dialog at start of gripped actor's turn
  // Same pattern: clear first, then dispatch so re-queues accumulate cleanly.
  const pendingGripCheck = actor.getFlag('mythras-imperative', 'pendingGripCheck') ?? {};
  if (Object.keys(pendingGripCheck).length > 0) {
    const { CombatEngine } = await import('./module/combat/CombatEngine.js');
    await actor.setFlag('mythras-imperative', 'pendingGripCheck', {});
    for (const [gripEntryId, entry] of Object.entries(pendingGripCheck)) {
      await resolveGripBreakFree(actor, entry, gripEntryId);
    }
  }

  // ── Pending Impale decision — post lodge/yank card at start of attacker's turn
  const pendingImpales = actor.getFlag('mythras-imperative', 'pendingImpales') ?? {};
  if (Object.keys(pendingImpales).length > 0) {
    const { CombatEngine } = await import('./module/combat/CombatEngine.js');
    for (const entry of Object.values(pendingImpales)) {
      await postImpaleDecisionCard(actor, entry);
    }
    // Clear all pending entries — cards are now posted
    await actor.setFlag('mythras-imperative', 'pendingImpales', {});
  }

  // ── Pending Reload countdown — decrement each turn, complete on 0 ────────
  const pendingReload = actor.getFlag('mythras-imperative', 'pendingReload') ?? null;
  if (pendingReload) {
    const weapon = actor.items.get(pendingReload.weaponId);
    const remaining = (pendingReload.turnsRemaining ?? 1) - 1;
    if (remaining <= 0) {
      // Reload complete — fill ammo and clear flag
      if (weapon) await weapon.update({ 'system.ammo': weapon.system.ammoMax ?? 0 });
      await actor.unsetFlag('mythras-imperative', 'pendingReload');
      ui.notifications.info(`${actor.name} has finished reloading ${weapon?.name ?? 'their weapon'}.`);
      await ChatMessage.create({
        content: `
          <div class="mi-chat-card">
            <div class="mi-card-header mi-card-header--stacked">
              <span class="mi-card-actor">${actor.name}</span>
              <span class="mi-card-skill">Reload Complete — ${weapon?.name ?? 'Weapon'}</span>
            </div>
            <div class="mi-card-body">
              <div class="mi-outcome-row">
                <span class="mi-outcome mi-outcome--success">
                  <i class="fas fa-redo"></i> Reloaded — ${weapon?.system?.ammoMax ?? 0} rounds ready
                </span>
              </div>
            </div>
          </div>`,
        speaker: ChatMessage.getSpeaker({ actor })
      });
    } else {
      await actor.setFlag('mythras-imperative', 'pendingReload', {
        ...pendingReload,
        turnsRemaining: remaining
      });
      ui.notifications.info(`${actor.name} is still reloading ${weapon?.name ?? 'their weapon'} — ${remaining} Turn${remaining > 1 ? 's' : ''} remaining.`);
    }
  }

  // ── Surprised: clear on this combatant's turn ─────────────────────────
  if (syntheticActor?.statuses?.has('surprised')) {
    const { CombatEngine } = await import('./module/combat/CombatEngine.js');
    await CombatEngine._removeStatusFromActor(actor, 'surprised');
    console.log(`Mythras Imperative | Surprised condition cleared from ${actor.name}`);
    ui.notifications.info(`${actor.name}'s Surprised condition has ended.`);
  }

  // ── Stun: decrement counter each turn, clear when it reaches 0 ───────
  const stunTurns = actor.getFlag('mythras-imperative', 'stunTurns') ?? 0;
  if (stunTurns > 0) {
    const remaining = stunTurns - 1;
    await actor.setFlag('mythras-imperative', 'stunTurns', remaining);
    if (remaining === 0) {
      // Remove the stunned status effect via the canonical path
      const { CombatEngine } = await import('./module/combat/CombatEngine.js');
      await CombatEngine._removeStatusFromActor(actor, 'stunned');
      console.log(`Mythras Imperative | Stun cleared from ${actor.name}`);
      ui.notifications.info(`${actor.name}'s Stun has ended — may now attack and cast normally.`);
    } else {
      ui.notifications.warn(`${actor.name} is still Stunned — ${remaining} Turn${remaining > 1 ? 's' : ''} remaining. Cannot attack or cast.`);
    }
  }

  // ── Pin Down: clear at the start of the pinned actor's next Turn ────────
  // Rules p.45: The target cannot return fire on their next Turn. The flag
  // is cleared here (start-of-turn hook) so the constraint lasts exactly
  // until the next time this combatant acts.
  const pinnedDown = actor.getFlag('mythras-imperative', 'pinnedDown') ?? null;
  if (pinnedDown) {
    await actor.unsetFlag('mythras-imperative', 'pinnedDown');
    console.log(`Mythras Imperative | Pin Down cleared from ${actor.name}`);
    ui.notifications.info(`${actor.name} is no longer Pinned Down — may return fire.`);
  }

  // ── Stun Location: decrement per-location counters each turn ─────────
  // flags.stunLocations = { [hitLocationId]: turnsRemaining }
  // When a location reaches 0 it is no longer incapacitated.
  const stunLocations = actor.getFlag('mythras-imperative', 'stunLocations') ?? {};
  if (Object.keys(stunLocations).length > 0) {
    const updated = {};
    const cleared = [];
    for (const [locId, turns] of Object.entries(stunLocations)) {
      const remaining = turns - 1;
      if (remaining > 0) {
        updated[locId] = remaining;
        // Resolve the location name from the actor's hit-location items for the notification
        const locItem = actor.items.get(locId);
        const locName = locItem?.name ?? locId;
        ui.notifications.warn(`${actor.name}'s ${locName} is still Incapacitated — ${remaining} Turn${remaining > 1 ? 's' : ''} remaining.`);
      } else {
        cleared.push(locId);
      }
    }
    // Write back the updated map (or clear if all expired)
    await actor.setFlag('mythras-imperative', 'stunLocations', updated);
    for (const locId of cleared) {
      const locItem = actor.items.get(locId);
      const locName = locItem?.name ?? locId;
      console.log(`Mythras Imperative | Stun Location cleared: ${actor.name} — ${locName}`);
      ui.notifications.info(`${actor.name}'s ${locName} stun has ended — location no longer Incapacitated.`);
    }
  }

  // ── Blind Opponent: decrement counter each turn, clear when it reaches 0 ─
  const blindedBy = actor.getFlag('mythras-imperative', 'blindedBy') ?? null;
  if (blindedBy && blindedBy.turnsRemaining > 0) {
    const remaining = blindedBy.turnsRemaining - 1;
    if (remaining === 0) {
      await actor.unsetFlag('mythras-imperative', 'blindedBy');
      // Remove the blinded token status via the canonical path
      const { CombatEngine } = await import('./module/combat/CombatEngine.js');
      await CombatEngine._removeStatusFromActor(actor, 'blinded');
      console.log(`Mythras Imperative | Blinded condition cleared from ${actor.name}`);
      ui.notifications.info(`${actor.name}'s Blinded condition has ended — vision restored.`);
    } else {
      await actor.setFlag('mythras-imperative', 'blindedBy', { ...blindedBy, turnsRemaining: remaining });
      const gradeLabel = blindedBy.grade === 'formidable' ? 'Formidable' : 'Hard';
      ui.notifications.warn(`${actor.name} is still Blinded (${gradeLabel}) — ${remaining} Turn${remaining > 1 ? 's' : ''} remaining.`);
    }
  }
}

Hooks.on('updateCombat', _onUpdateCombat);

// ---------------------------------------------------------------------------
// CHAT — Luck Point buttons + Manual combat buttons
// ---------------------------------------------------------------------------
function _onRenderChatMessage(message, html) {
  // Guard against double-registration on re-renders (scroll, content update).
  // renderChatMessageHTML fires every time the message HTML is (re)rendered.
  // When _updateCardWithSEs rewrites the card content, Foundry creates a brand
  // new DOM element — any root-level sentinel is gone. Instead we stamp each
  // button individually: _bindOnce skips buttons that already have a listener.
  const _bindOnce = (btn, handler) => {
    if (btn.dataset.miBound) return;
    btn.dataset.miBound = '1';
    btn.addEventListener('click', handler);
  };

  // ── Initiative card reskin ──────────────────────────────────────────────
  // Foundry posts a plain chat message for each initiative roll.
  // In v14 these carry flags.core.initiativeRoll = true.
  // We intercept and rewrap the content to match the mi-chat-card theme.
  if (message.flags?.core?.initiativeRoll) {
    const roll       = message.rolls?.[0];
    const total      = roll?.total ?? '?';
    const speaker    = message.speaker?.alias ?? game.i18n.localize('COMBAT.Combatant');
    const formula    = roll?.formula ?? CONFIG.Combat.initiative.formula;
    const isSurprised = formula.includes('- 10') || formula.includes('-10');
    const surprisedPill = isSurprised
      ? '<span class="mi-card-pill mi-card-pill--alert">Surprised −10</span>' : '';

    html.innerHTML = `
      <div class="mi-chat-card">
        <div class="mi-card-header">
          <span class="mi-card-actor">${speaker}</span>
          <span class="mi-card-skill">Initiative</span>
        </div>
        <div class="mi-card-body">
          ${surprisedPill ? `<div class="mi-card-details">${surprisedPill}</div>` : ''}
          <div class="mi-card-target">Formula <strong>${formula}</strong></div>
          <div class="mi-roll-result">${total}</div>
        </div>
      </div>`;
    return;
  }

  // ── Apply Damage button (Semi-Auto — appears after Roll Damage is clicked) ─
  html.querySelectorAll('.mi-btn-apply-dmg').forEach(btn => {
    _bindOnce(btn, async () => {
      if (!game.user.isGM) { ui.notifications.warn('Only the GM can apply damage.'); return; }
      const actorId    = btn.dataset.actorId;
      const locationId = btn.dataset.locationId;
      const damage     = parseInt(btn.dataset.damage, 10);
      const rawDamage  = parseInt(btn.dataset.rawDamage, 10) || damage; // pre-armour damage for Bash
      const locLabel   = btn.dataset.locationLabel ?? '';
      const actor      = game.actors.get(actorId);
      if (!actor || isNaN(damage)) return;

      const locItem = CombatEngine._getItem(actor, locationId);
      let semiCtxForWound = null;
      if (locItem) {
        // Schema: system.hp = max, system.current = current, system.wound = wound string
        const maxHp      = locItem.system.hp ?? 4;
        const currentHp  = locItem.system.current ?? maxHp;
        const newCurrent = currentHp - damage;
        // Wound severity per rules pp.31-32: use cumulative newCurrent thresholds,
        // not single-blow damage size.
        const { CombatEngine: CE } = await import('./module/combat/CombatEngine.js');
        const woundLevel = CE._woundLevel(damage, maxHp, newCurrent);
        await locItem.update({ 'system.current': newCurrent, 'system.wound': woundLevel });
        ui.notifications.info(
          `Applied ${damage} to ${actor.name}'s ${locLabel}. Current HP: ${newCurrent}. Wound: ${woundLevel}.`
        );
        // Build wound ctx for later consequence resolution
        semiCtxForWound = {
          woundLevel,
          newCurrent,
          maxHp,
          locationType:    CE._classifyLocation(locItem.name),
          hitLocationLabel: locLabel,
          enduranceRequired: newCurrent <= 0,
          damageAfterArmour: damage
        };
      } else {
        ui.notifications.warn(`Hit location item not found on ${actor?.name}.`);
      }

      // ── Resolve opposed SEs (Bleed, Trip, etc.) using flags from the outcome message ──
      const outcomeMsg = game.messages.get(btn.dataset.messageId);
      const flags = outcomeMsg?.flags?.['mythras-imperative'] ?? {};
      const chosenSEs = flags.chosenSEs ?? [];

      // Registry-driven: any SE with phase:'opposed' fires through _resolveOpposedSEs.
      // requiresDamage and requiresFumble gates are enforced inside the dispatcher.
      const hasOpposedSE = chosenSEs.some(
        id => CONFIG.MYTHRAS.specialEffects.find(e => e.id === id)?.phase === 'opposed'
      );

      if (hasOpposedSE) {
        const attacker = _resolveActor(flags.attackerId);
        if (attacker && actor) {
          try {
            const { CombatEngine } = await import('./module/combat/CombatEngine.js');
            const minimalCtx = {
              attacker,
              defender:           actor,
              weapon:             CombatEngine._getItem(attacker, flags.weaponId),
              defenceWeapon:      CombatEngine._getItem(actor,    flags.defenceWeaponId),
              attackResult:       flags.attackResult       ?? 0,
              attackerSkillTotal: flags.attackerSkillTotal ?? 0,
              defenceResult:      flags.defenceResult      ?? 0,
              defenderSkillTotal: flags.defenderSkillTotal ?? 0,
              chosenSpecialEffects: chosenSEs,
              seWinner:           flags.seWinner           ?? 'attacker',
              hitLocationId:      locationId ?? null,
              hitLocationLabel:   locLabel,
              locationType:       CombatEngine._classifyLocation(locLabel ?? ''),
              rawDamage:          rawDamage,   // pre-armour damage — used by Bash for knockback
              attackerStyle:      null,        // not available from card flags; Knockout Blow inactive in Semi-Auto
              chatMessageId:      btn.dataset.messageId ?? null   // outcome card — player has seen it
            };
            await CombatEngine._resolveOpposedSEs(minimalCtx, damage);
          } catch (err) {
            console.error('Mythras Imperative | Opposed SE failed:', err);
            ui.notifications.error('Special Effect roll failed — check console for details.');
          }
        }
      }

      // ── Resolve wound consequences (Endurance roll for Serious/Major) ─────────
      if (semiCtxForWound?.enduranceRequired) {
        const attacker = _resolveActor(flags.attackerId);
        try {
          const { CombatEngine } = await import('./module/combat/CombatEngine.js');
          const woundCtx = {
            ...semiCtxForWound,
            attacker:           attacker ?? null,
            defender:           actor,
            attackResult:       flags.attackResult       ?? 0,
            attackerSkillTotal: flags.attackerSkillTotal ?? 0,
            chosenSpecialEffects: chosenSEs
          };
          await CombatEngine._resolveWoundConsequences(woundCtx);
        } catch (err) {
          console.error('Mythras Imperative | Wound consequence failed:', err);
          ui.notifications.error('Wound consequence roll failed — check console for details.');
        }
      }

      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-check"></i> Applied';
    });
  });

  // Impale decision card — re-disable buttons if choice already made (persists across reloads)
  if (message.flags?.['mythras-imperative']?.impaleResolved) {
    html.querySelectorAll('.mi-btn-impale-leave, .mi-btn-impale-yank').forEach(b => {
      b.disabled = true;
      b.style.opacity = '0.5';
    });
  }

  // Entangle trip — Yes (spend AP and trip)
  html.querySelectorAll('.mi-btn-entangle-trip-yes').forEach(btn => _bindOnce(btn, async ev => {
      ev.preventDefault();
      const target = btn;
      target.disabled = true;
      _disableSiblingButtons(target);
      const { CombatEngine } = await import('./module/combat/CombatEngine.js');
      await resolveEntangleTripYes(target);
    }));

  // Entangle trip — No (skip, act normally)
  html.querySelectorAll('.mi-btn-entangle-trip-no').forEach(btn => _bindOnce(btn, async ev => {
      ev.preventDefault();
      const target = btn;
      target.disabled = true;
      _disableSiblingButtons(target);
      // Stamp the card resolved — no further action needed
      const { CombatEngine } = await import('./module/combat/CombatEngine.js');
      await ChatMessage.create({
        content: `<div class="mi-chat-card"><div class="mi-card-body"><div class="mi-outcome-row"><span class="mi-outcome mi-wound-minor"><i class="fas fa-walking"></i> ${game.actors.get(target.dataset.attackerId)?.name ?? 'Attacker'} skips the trip — acts normally.</span></div></div></div>`,
        speaker: { alias: game.actors.get(target.dataset.attackerId)?.name ?? 'Attacker' }
      });
    }));

  // Impale — Leave In
  // Capture btn before any await — ev.currentTarget becomes null after async suspension.
  html.querySelectorAll('.mi-btn-impale-leave').forEach(btn => _bindOnce(btn, async ev => {
      ev.preventDefault();
      const target = btn; // capture before await
      target.disabled = true;
      _disableSiblingButtons(target);
      const { CombatEngine } = await import('./module/combat/CombatEngine.js');
      await applyImpaleLodge(target);
    }));

  // Impale — Yank Free
  html.querySelectorAll('.mi-btn-impale-yank').forEach(btn => _bindOnce(btn, async ev => {
      ev.preventDefault();
      const target = btn; // capture before await
      target.disabled = true;
      _disableSiblingButtons(target);
      const { CombatEngine } = await import('./module/combat/CombatEngine.js');
      await resolveImpaleYank(target);
    }));

  html.querySelectorAll('.mi-luck-reroll').forEach(btn => _bindOnce(btn, ev => _onLuckReroll(ev, message)));
  html.querySelectorAll('.mi-luck-swap').forEach(btn => _bindOnce(btn, ev => _onLuckSwap(ev, message)));

  // Manual mode — Roll Hit Location
  html.querySelectorAll('.mi-btn-loc[data-defender-name]').forEach(btn => _bindOnce(btn, ev => _onManualRollLocation(ev, message)));

  // Semi-Auto mode — Roll Hit Location (has data-defender-id and data-message-id)
  html.querySelectorAll('.mi-btn-loc[data-defender-id]').forEach(btn => _bindOnce(btn, ev => _onSemiAutoRollLocation(ev, message)));

  // Manual mode — Roll Damage
  html.querySelectorAll('.mi-btn-dmg[data-defender-name]').forEach(btn => _bindOnce(btn, ev => _onManualRollDamage(ev, message)));

  // Semi-Auto mode — Roll Damage (has data-attacker-id)
  html.querySelectorAll('.mi-btn-dmg[data-attacker-id]').forEach(btn => _bindOnce(btn, ev => _onSemiAutoRollDamage(ev, message)));

  // Semi-Auto mode — Roll Vehicle Damage
  html.querySelectorAll('.mi-btn-veh-dmg').forEach(btn => _bindOnce(btn, ev => _onSemiAutoVehicleDamage(ev, message)));

  // Semi-Auto mode — Apply Vehicle Damage (step 2: 1d10 system roll + write to actor)
  html.querySelectorAll('.mi-btn-veh-apply').forEach(btn => _bindOnce(btn, () => _onApplyVehicleDamage(btn)));

  // Semi-Auto mode — Damage Weapon direct roll (bypasses hit location flow)
  html.querySelectorAll('.mi-btn-dmg-weapon').forEach(btn => _bindOnce(btn, ev => _onSemiAutoDamageWeapon(ev, message)));

  // Semi-Auto mode — Burst fire (rolls 1d3 rounds of location+damage)
  html.querySelectorAll('.mi-btn-burst').forEach(btn => _bindOnce(btn, ev => _onSemiAutoBurstDamage(ev, message)));
}

Hooks.on('renderChatMessageHTML', _onRenderChatMessage);

async function _onManualRollLocation(ev, message) {
  ev.preventDefault();

  const defenderName = ev.currentTarget.dataset.defenderName ?? 'Defender';

  const roll = new Roll('1d20');
  await roll.evaluate();
  const d20 = roll.total;
  const locationLabel = _resolveHitLocation(d20);

  const content = `
    <div class="mi-chat-card">
      <div class="mi-card-header mi-card-header--stacked">
        <span class="mi-card-actor">${defenderName}</span>
        <span class="mi-card-skill">Hit Location</span>
      </div>
      <div class="mi-card-body">
        <div class="mi-card-target">1d20 roll <strong>${d20}</strong></div>
        <div class="mi-roll-result" style="font-size:1.6em">${locationLabel}</div>
      </div>
    </div>`;

  await ChatMessage.create({ content, speaker: message.speaker, rolls: [roll] });
}

async function _onManualRollDamage(ev, message) {
  ev.preventDefault();
  const formula      = ev.currentTarget.dataset.formula;
  const defenderName = ev.currentTarget.dataset.defenderName ?? 'Defender';
  if (!formula) return;

  const roll = new Roll(formula);
  await roll.evaluate();

  const content = `
    <div class="mi-chat-card">
      <div class="mi-card-header mi-card-header--stacked">
        <span class="mi-card-actor">${defenderName}</span>
        <span class="mi-card-skill">Damage</span>
      </div>
      <div class="mi-card-body">
        <div class="mi-card-target">Formula <strong>${formula}</strong></div>
        ${CombatEngine._diceBreakdown(roll)}
        <div class="mi-roll-result">${roll.total}</div>
      </div>
    </div>`;

  await ChatMessage.create({ content, speaker: message.speaker, rolls: [roll] });
}

// ---------------------------------------------------------------------------
// _resolveActor — resolve an actor by ID via canvas token first.
// ctx.attacker / ctx.defender are always token actors (synthetic). The IDs
// stamped on card buttons come from ctx, so we must resolve via the canvas
// token to get the same synthetic actor and its items. Falling back to
// game.actors.get() handles the case where the token is no longer on canvas.
// ---------------------------------------------------------------------------
function _resolveActor(actorId) {
  if (!actorId) return null;
  const token = canvas?.tokens?.placeables?.find(t =>
    t.actor?.id === actorId || t.document?.actorId === actorId
  ) ?? null;
  return token?.actor ?? game.actors.get(actorId) ?? null;
}

// Semi-Auto: Roll Hit Location
async function _onSemiAutoRollLocation(ev, message) {
  ev.preventDefault();
  const btn        = ev.currentTarget;
  const defenderId = btn.dataset.defenderId;
  const messageId  = btn.dataset.messageId;
  const defender   = _resolveActor(defenderId);
  if (!defender) return;

  const chooseLocation = btn.dataset.chooseLocation === 'true'
    || (message.flags?.['mythras-imperative']?.chosenSEs ?? []).includes('chooseLocation');
  const useMarksman = (message.flags?.['mythras-imperative']?.chosenSEs ?? []).includes('marksman');

  let locId    = null;
  let locLabel = null;
  let roll     = null;
  let d20      = null;

  if (chooseLocation) {
    // Choose Location SE — show picker instead of rolling
    const { CombatEngine } = await import('./module/combat/CombatEngine.js');
    const attackerName = message.flags?.['mythras-imperative']
      ? (game.actors.get(message.flags['mythras-imperative'].attackerId)?.name ?? '') : '';
    const picked = await CombatEngine._showLocationPicker(defender, attackerName);
    locId    = picked.id;
    locLabel = picked.label;
  } else {
    // Normal roll
    roll = new Roll('1d20');
    await roll.evaluate();
    d20 = roll.total;

    const locs = Array.from(defender.items)
      .filter(i => i.type === 'hit-location')
      .sort((a, b) => (a.system.rangeMin ?? 0) - (b.system.rangeMin ?? 0));
    const locItem = locs.find(l => d20 >= (l.system.rangeMin ?? 1) && d20 <= (l.system.rangeMax ?? 20))
      ?? locs[locs.length - 1] ?? null;
    locLabel = locItem?.name ?? _resolveHitLocation(d20);
    locId    = locItem?.id ?? null;
  }

  // Post the hit location card now — with the rolled/chosen location —
  // before any Marksman picker appears.
  const locContent = chooseLocation
    ? `
    <div class="mi-chat-card">
      <div class="mi-card-header mi-card-header--stacked">
        <span class="mi-card-actor">${defender.name}</span>
        <span class="mi-card-skill">Choose Location</span>
      </div>
      <div class="mi-card-body">
        <div class="mi-roll-result mi-roll-result--location">${locLabel}</div>
      </div>
    </div>`
    : `
    <div class="mi-chat-card">
      <div class="mi-card-header mi-card-header--stacked">
        <span class="mi-card-actor">${defender.name}</span>
        <span class="mi-card-skill">Hit Location</span>
      </div>
      <div class="mi-card-body">
        <div class="mi-card-target">1d20: <strong>${d20}</strong></div>
        <div class="mi-roll-result mi-roll-result--location">${locLabel}</div>
      </div>
    </div>`;

  const locMsg = await ChatMessage.create({
    content: locContent,
    speaker: message.speaker,
    ...(roll ? { rolls: [roll] } : {})
  });

  // Marksman SE or Ranged Marksman style trait — wait until the hit location
  // card has rendered, then show the adjacency picker.
  // The SE and the trait use the same picker and do not stack.
  const outcomeFlags      = message.flags?.['mythras-imperative'] ?? {};
  const attackerStyleItem = (() => {
    const attacker = game.actors.get(outcomeFlags.attackerId);
    const styleId  = outcomeFlags.attackerStyleId ?? null;
    return styleId ? attacker?.items.get(styleId) ?? null : null;
  })();
  const useRangedMarksman = !useMarksman
    && (attackerStyleItem?.system.traits ?? []).includes('rangedMarksman')
    && outcomeFlags.isRanged;

  if ((useMarksman || useRangedMarksman) && locLabel && !chooseLocation) {
    const { CombatEngine } = await import('./module/combat/CombatEngine.js');
    const attackerName = game.actors.get(outcomeFlags.attackerId)?.name ?? '';
    await new Promise(resolve => {
      const targetId = locMsg?.id ?? null;
      if (!targetId) { resolve(); return; }
      Hooks.once('renderChatMessage', (msg) => {
        if (msg.id === targetId) resolve();
      });
      // Safety fallback — if hook never fires (e.g. GM hidden roll), resolve anyway
      setTimeout(resolve, 1500);
    });
    const shifted = await CombatEngine._resolveMarksman(defender, locId, locLabel, attackerName);
    locId    = shifted.id;
    locLabel = shifted.label;
  }

  // Stamp location onto the parent outcome card so Roll Damage can read it
  if (messageId && messageId !== 'PENDING') {
    const parentMsg = game.messages.get(messageId);
    if (parentMsg) {
      let updated = parentMsg.content
        .replace(/class="mi-btn mi-btn-loc[^"]*"([^>]*)>/,
          `class="mi-btn mi-btn-loc mi-btn--done" data-defender-id="${defenderId}" data-location-id="${locId ?? ''}" data-location-label="${locLabel}" data-message-id="${messageId}">`
        )
        .replace(/<i class="fas fa-(?:crosshairs|bullseye|location-arrow)"><\/i> (?:Roll Hit Location|Choose Location|Roll \+ Marksman)/,
          `<i class="fas fa-check"></i> ${locLabel}`
        );
      await parentMsg.update({ content: updated });
    }
  }
}

// Semi-Auto: Roll Damage
async function _onSemiAutoRollDamage(ev, message) {
  ev.preventDefault();
  const btn               = ev.currentTarget;
  const formula           = btn.dataset.formula;
  const defenderId        = btn.dataset.defenderId;
  const attackerId        = btn.dataset.attackerId;
  const weaponId          = btn.dataset.weaponId;
  const isCharge          = btn.dataset.isCharge === 'true';
  const parryWeaponId     = btn.dataset.parryWeaponId ?? '';
  const parryStyleId      = btn.dataset.parryStyleId  ?? '';
  const defenceType       = btn.dataset.defenceType   ?? 'none';
  const defenceWeaponName = btn.dataset.defenceWeaponName ?? '';
  const messageId         = btn.dataset.messageId;

  if (!formula || !defenderId || !attackerId) return;

  const defender  = _resolveActor(defenderId);
  // Resolve attacker via canvas token so we get the synthetic token actor.
  // game.actors.get() returns the base actor; for linked tokens the items
  // match, but the weapon item on the button came from ctx.attacker which
  // is always the token actor. Using the canvas token avoids the mismatch.
  const attacker  = _resolveActor(attackerId);
  const weapon    = CombatEngine._getItem(attacker, weaponId);
  if (!defender || !attacker) return;

  // formula from the card button already has the stepped-up DM applied (Charge handled at card-build time)
  let dmgFormula = formula;
  const roll = new Roll(dmgFormula);
  await roll.evaluate();
  let rawDamage = roll.total;

  // Read chosenSEs from outcome flags — single source of truth for all SE flags in this function.
  // (Read early here so Impale double-roll can use it before the main block below)
  // messageId points to the outcome card message where CombatEngine stored the SE choices.
  const outcomeMsg0    = (messageId && messageId !== 'PENDING') ? game.messages.get(messageId) : null;
  const outcomeFlags0  = outcomeMsg0?.flags?.['mythras-imperative'] ?? {};
  const chosenSEs0     = outcomeFlags0.chosenSEs ?? [];

  // Impale SE — roll damage twice, attacker picks best (rules p.44)
  let impaleSection2 = '';
  if (chosenSEs0.includes('impale')) {
    const roll1val = rawDamage;
    const roll2    = new Roll(dmgFormula);
    await roll2.evaluate();
    const roll2val = roll2.total;
    if (roll2val > rawDamage) rawDamage = roll2val;
    const winner = rawDamage;
    impaleSection2 = `
      <div class="mi-card-impale-rolls">
        <span class="mi-card-note">Impale — two rolls, best used:</span>
        <span class="mi-card-impale-die ${roll1val >= roll2val ? 'mi-impale-winner' : 'mi-impale-loser'}">${roll1val}</span>
        <span class="mi-card-note">vs</span>
        <span class="mi-card-impale-die ${roll2val > roll1val ? 'mi-impale-winner' : 'mi-impale-loser'}">${roll2val}</span>
      </div>`;
  }

  // Bypass Armour SE: read from outcome flags, not btn.dataset, because CombatEngine cannot
  // stamp this on the button at card-build time (the SE choice is stored in flags, not HTML).
  // This is the same pattern used by circumventParry and enhanceParry below.
  // ── Ammo quantity decrement (semi-auto) ──────────────────────────────────
  // Decrement loaded ammo item quantity when a ranged weapon fires.
  // Fires once per Roll Damage click regardless of hit outcome.
  const isRangedShot = (outcomeFlags0.isRanged ?? false) && weapon?.system?.loadedAmmoId;
  if (isRangedShot) {
    const ammoItem = attacker.items?.get(weapon.system.loadedAmmoId)
                  ?? game.items.get(weapon.system.loadedAmmoId)
                  ?? null;
    if (ammoItem?.type === 'ammo') {
      const qCurrent = ammoItem.system.quantity ?? 0;
      const qUpdated = Math.max(0, qCurrent - 1);
      await ammoItem.update({ 'system.quantity': qUpdated });
      if (qUpdated === 0) ui.notifications.warn(`${ammoItem.name} is now empty.`);
    }
  }

  const bypassArmour = chosenSEs0.includes('bypassArmour');

  // Maximise Damage SE — substitute each chosen die with its maximum face value.
  // Rules p.45: one die per stack count; DM dice are not affected.
  const maximiseCount  = chosenSEs0.filter(s => s === 'maximiseDamage').length;
  if (maximiseCount > 0) {
    const dieTerms = roll.terms.filter(t => t.faces);
    for (let i = 0; i < Math.min(maximiseCount, dieTerms.length); i++) {
      rawDamage += (dieTerms[i].faces - dieTerms[i].total);
    }
  }

  // Parry reduction (p.40): only applies when the defender succeeded or critically succeeded.
  // A failed or fumbled parry does not reduce damage at all.
  // We read defenceOutcome and chosen SEs from the parent outcome message flags.
  const parryWeapon     = parryWeaponId ? defender.items.get(parryWeaponId) : null;
  const parryStyle      = parryStyleId  ? defender.items.get(parryStyleId)  : null;
  const circumventParry = chosenSEs0.includes('circumventParry');
  const enhanceParry    = chosenSEs0.includes('enhanceParry');
  let damageAfterParry  = rawDamage;
  let parryNote = '';

  if (parryWeapon && weapon && !circumventParry) {
    // Read the defender's roll outcome from the outcome message flags
    const parentMsgForOutcome = (messageId && messageId !== 'PENDING')
      ? game.messages.get(messageId) : null;
    const outcomeFlags     = parentMsgForOutcome?.flags?.['mythras-imperative'] ?? {};
    const defenceOutcome   = outcomeFlags.defenceOutcome ?? 'failure';
    const parrySucceeded   = defenceOutcome === 'success' || defenceOutcome === 'critical';

    if (parrySucceeded) {
      if (enhanceParry) {
        // Enhance Parry: full block regardless of weapon size (rules p.42)
        damageAfterParry = 0;
        parryNote = 'fully blocked';
      } else {
        const { CombatEngine } = await import('./module/combat/CombatEngine.js');
        const pr = CombatEngine.resolveParryReduction(weapon, parryWeapon, parryStyle);
        damageAfterParry = Math.ceil(rawDamage * pr.multiplier);
        parryNote = pr.label === 'full' ? 'fully blocked' : pr.label === 'half' ? 'half damage' : '';
      }
    }
    // If parry failed/fumbled: no reduction, parryNote stays ''
  }

  // Read location from the parent outcome card (stamped by Roll Hit Location)
  let locationId    = null;
  let locationLabel = 'Unknown';
  let armourAP      = 0;
  if (messageId && messageId !== 'PENDING') {
    const parentMsg = game.messages.get(messageId);
    if (parentMsg) {
      const locIdMatch  = parentMsg.content.match(/data-location-id="([^"]*)"/);
      const locLblMatch = parentMsg.content.match(/data-location-label="([^"]*)"/);
      locationId    = locIdMatch?.[1]  || null;
      locationLabel = locLblMatch?.[1] || 'Unknown';
      if (locationId && !bypassArmour) {
        // Sum natural AP (hit-location item) + worn armour items covering this location
        const locItem = defender.items.get(locationId);
        if (locItem) {
          armourAP = locItem.system.ap ?? 0;
          // Derive location key: "Right Leg" -> "rightLeg"
          const label  = (locItem.system.label ?? locItem.name ?? '');
          const locKey = label.trim()
            .replace(/\s+(\w)/g, (_, c) => c.toUpperCase())
            .replace(/^(\w)/, c => c.toLowerCase());
          let wornAP = 0;
          for (const armourItem of defender.items) {
            if (armourItem.type !== 'armour') continue;
            if (!armourItem.system.equipped) continue;
            if (armourItem.system.locations?.[locKey]) {
              wornAP += armourItem.system.ap ?? 0;
            }
          }
          // Subtract any AP permanently sundered at this specific location
          const sunderedAP  = defender.getFlag('mythras-imperative', 'sunderedAP') ?? {};
          const sunderAtLoc = sunderedAP[locKey] ?? 0;
          const wornReduction    = Math.min(sunderAtLoc, wornAP);
          const naturalReduction = Math.min(Math.max(0, sunderAtLoc - wornReduction), armourAP);
          armourAP = Math.max(0, armourAP - naturalReduction) + Math.max(0, wornAP - wornReduction);
        }
      }
    }
  }

  // ── Sunder SE — redirect damage at armour, carry remainder to HP ─────────
  // Rules p.46: damage after parry hits armour AP first; surplus reduces AP permanently.
  // ── Bodkin ammo trait (semi-auto) ────────────────────────────────────────
  // Reduces effective armour AP by ceil(weaponBaseMax / 2) before damage.
  if (isRangedShot && !bypassArmour && armourAP > 0) {
    const ammoItem2 = attacker.items?.get(weapon.system.loadedAmmoId)
                   ?? game.items.get(weapon.system.loadedAmmoId) ?? null;
    const ammoTraits2 = Array.from(ammoItem2?.system?.traits ?? [])
      .map(t => (t.key ?? t.name ?? '').toLowerCase());
    if (ammoTraits2.includes('bodkin')) {
      const reduction = Math.ceil(weaponBaseMax(weapon?.system?.damage ?? '') / 2);
      armourAP = Math.max(0, armourAP - reduction);
    }
  }

  let finalDamage    = Math.max(0, damageAfterParry - armourAP);
  let sunderResult   = null;
  const sunderChosen = chosenSEs0.includes('sunder');
  if (sunderChosen && !chosenSEs0.includes('bypassArmour') && armourAP > 0) {
    try {
      const { CombatEngine: CE_sunder } = await import('./module/combat/CombatEngine.js');
      sunderResult = await CE_sunder._applySunder(defender, locationId, damageAfterParry, weapon);
      finalDamage  = sunderResult.carryOver;
    } catch (err) {
      console.error('Mythras Imperative | Sunder failed:', err);
    }
  }

  const parryText   = parryNote ? ` (${parryNote})` : '';
  const armourText  = sunderResult
    ? ` vs ${sunderResult.totalApBefore} AP`
    : armourAP ? ` − ${armourAP} AP` : '';

  // Build compact defence description for card sub-line
  const defenceDesc = defenceType === 'none'       ? 'No Defence'
    : defenceType === 'evade'                       ? 'Evade'
    : defenceType === 'acrobatics'                  ? 'Acrobatics'
    : defenceWeaponName                             ? `Parry — ${defenceWeaponName}`
    : 'Parry';
  const weaponDesc = isCharge
    ? `${weapon?.name ?? 'weapon'} (Charge)`
    : (weapon?.name ?? 'weapon');

  // Read chosenSEs from the outcome message flags
  const outcomeMsg2    = (messageId && messageId !== 'PENDING') ? game.messages.get(messageId) : null;
  const outcomeFlags2  = outcomeMsg2?.flags?.['mythras-imperative'] ?? {};
  const chosenSEs2     = outcomeFlags2.chosenSEs ?? [];

  // If damage is fully blocked, the Apply Damage button never appears — fire
  // any 'opposed'-phase SEs right here. Registry-driven: requiresDamage and
  // requiresFumble gates are enforced inside _resolveOpposedSEs.
  // ── Broadhead ammo trait (semi-auto) ─────────────────────────────────────
  // If damage penetrated armour, automatically trigger Bleed. No SE slot used.
  if (isRangedShot && finalDamage > 0) {
    const ammoItem3 = attacker.items?.get(weapon.system.loadedAmmoId)
                   ?? game.items.get(weapon.system.loadedAmmoId) ?? null;
    const ammoTraits3 = Array.from(ammoItem3?.system?.traits ?? [])
      .map(t => (t.key ?? t.name ?? '').toLowerCase());
    if (ammoTraits3.includes('broadhead')) {
      try {
        const { SE_RESOLVERS } = await import('./module/combat/effects/index.js');
        const broadCtx = {
          attacker,
          defender,
          weapon,
          defenceWeapon:        CombatEngine._getItem(defender, outcomeFlags2.defenceWeaponId ?? ''),
          attackResult:         outcomeFlags2.attackResult       ?? 0,
          attackerSkillTotal:   outcomeFlags2.attackerSkillTotal ?? 0,
          defenceResult:        outcomeFlags2.defenceResult      ?? 0,
          defenderSkillTotal:   outcomeFlags2.defenderSkillTotal ?? 0,
          chosenSpecialEffects: ['bleed'],
          seWinner:             'attacker',
          hitLocationId:        locationId ?? null,
          hitLocationLabel:     locationLabel,
          chatMessageId:        messageId ?? null
        };
        await SE_RESOLVERS['bleed'](broadCtx, finalDamage, false);
      } catch (err) {
        console.error('MI | Broadhead bleed failed:', err);
      }
    }
  }

  if (finalDamage === 0) {
    const hasOpposedSE2 = chosenSEs2.some(
      id => CONFIG.MYTHRAS.specialEffects.find(e => e.id === id)?.phase === 'opposed'
    );
    if (hasOpposedSE2) {
      try {
        const { CombatEngine } = await import('./module/combat/CombatEngine.js');
        const attackerWeapon2  = CombatEngine._getItem(attacker, outcomeFlags2.weaponId);
        const defenceWeapon2   = CombatEngine._getItem(defender, outcomeFlags2.defenceWeaponId);
        const minimalCtx = {
          attacker,
          defender,
          weapon:               attackerWeapon2,
          defenceWeapon:        defenceWeapon2,
          attackResult:         outcomeFlags2.attackResult       ?? 0,
          attackerSkillTotal:   outcomeFlags2.attackerSkillTotal ?? 0,
          defenceResult:        outcomeFlags2.defenceResult      ?? 0,
          defenderSkillTotal:   outcomeFlags2.defenderSkillTotal ?? 0,
          chosenSpecialEffects: chosenSEs2,
          seWinner:             outcomeFlags2.seWinner           ?? 'attacker',
          hitLocationId:        locationId ?? null,
          hitLocationLabel:     locationLabel,
          chatMessageId:        messageId ?? null
        };
        await CombatEngine._resolveOpposedSEs(minimalCtx, 0);
      } catch (err) {
        console.error('Mythras Imperative | Opposed SE at zero damage failed:', err);
        ui.notifications.error('Special Effect roll failed — check console for details.');
      }
    }
  }

  const dmgContent = `
    <div class="mi-chat-card">
      <div class="mi-card-header mi-card-header--stacked">
        <span class="mi-card-actor">${attacker.name} → ${defender.name}</span>
        <span class="mi-card-skill">Damage — ${locationLabel}</span>
        <span class="mi-card-combatants">
          <span class="mi-card-combatant-atk"><i class="fas fa-sword"></i> ${weaponDesc}</span>
          <span class="mi-card-combatant-sep">·</span>
          <span class="mi-card-combatant-def"><i class="fas fa-shield-alt"></i> ${defenceDesc}</span>
        </span>
      </div>
      <div class="mi-card-body">
        <div class="mi-card-target">Roll <strong>${rawDamage}</strong>${parryText}${armourText}</div>
        ${CombatEngine._diceBreakdown(roll)}
        ${impaleSection2}
        ${sunderResult ? `
        <div class="mi-outcome-row">
          <span class="mi-outcome mi-wound-${sunderResult.carryOver > 0 ? 'serious' : 'minor'}">
            <i class="fas fa-shield-alt"></i>
            Sunder — ${sunderResult.affectedNames.join(', ')}
            ${sunderResult.carryOver > 0
              ? ` · ${sunderResult.carryOver} damage carries over to ${locationLabel}`
              : ' · Armour absorbed all damage'}
          </span>
        </div>` : ''}
        <div class="mi-roll-result">${finalDamage}</div>
        ${finalDamage > 0 ? `
        <div class="mi-manual-actions">
          <button class="mi-btn mi-btn-apply-dmg"
            data-actor-id="${defenderId}"
            data-location-id="${locationId ?? ''}"
            data-damage="${finalDamage}"
            data-raw-damage="${rawDamage}"
            data-location-label="${locationLabel}"
            data-message-id="${messageId ?? ''}">
            <i class="fas fa-heart-broken"></i> Apply ${finalDamage} to ${locationLabel}
          </button>
        </div>` : '<div class="mi-outcome-row"><span class="mi-outcome success">Damage fully blocked</span></div>'}
      </div>
    </div>`;

  await ChatMessage.create({ content: dmgContent, speaker: message.speaker, rolls: [roll] });
}

// Semi-Auto — Roll Vehicle Damage
// Called when the "Roll Vehicle Damage" button on a vehicle attack card is clicked.
// Reconstructs a minimal ctx and delegates to CombatEngine._applyVehicleDamage.
// ─── Vehicle combat — semi-auto two-step flow ────────────────────────────────
//
// Step 1 — "Roll Vehicle Damage" button:
//   Rolls damage dice, compares to shields then hull, posts a new chat card
//   showing the dice breakdown + hull result.
//   If the attack penetrates, the card also contains an "Apply to Vehicle"
//   button carrying the penetrating damage and vehicle ID.
//
// Step 2 — "Apply to Vehicle" button:
//   Rolls 1d10 for the system component, writes structure and systems to the
//   vehicle actor, posts a new chat card showing the 1d10 result + system state.
// ─────────────────────────────────────────────────────────────────────────────

async function _onSemiAutoVehicleDamage(ev, message) {
  ev.preventDefault();
  const btn       = ev.currentTarget;
  const formula   = btn.dataset.formula;
  const vehicleId = btn.dataset.vehicleId;
  const messageId = btn.dataset.messageId;

  if (!vehicleId || !formula) {
    console.error('MI | Vehicle damage: missing data on button', btn.dataset);
    return;
  }
  const vehicle = game.actors.get(vehicleId);
  if (!vehicle) {
    ui.notifications.error('Vehicle not found.');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Rolling…';

  try {
    // ── Roll damage ─────────────────────────────────────────────────────────
    const damageRoll = new Roll(formula);
    await damageRoll.evaluate();
    const rawDamage = damageRoll.total;
    const diceHtml  = CombatEngine._diceBreakdown(damageRoll);

    // ── Read vehicle stats ──────────────────────────────────────────────────
    const vObj      = vehicle.system.toObject ? vehicle.system.toObject() : { ...vehicle.system };
    const shields   = vObj.shields  ?? { value: 0, max: 0 };
    const hull      = vObj.hull     ?? 0;
    const structure = vObj.structure ?? { value: 0, max: 0 };

    let shieldAbsorb       = 0;
    let damageAfterShields = rawDamage;

    // ── Shields ─────────────────────────────────────────────────────────────
    if (shields.max > 0 && shields.value > 0) {
      shieldAbsorb       = Math.min(rawDamage, shields.value);
      damageAfterShields = rawDamage - shieldAbsorb;
      const baseVehicle = game.actors.get(vehicleId);
      await baseVehicle.update({ 'system.shields.value': Math.max(0, shields.value - shieldAbsorb) });
    }

    // ── Hull comparison ─────────────────────────────────────────────────────
    const penetrating = Math.max(0, damageAfterShields - hull);

    // ── Build card content ──────────────────────────────────────────────────
    const shieldLine = shieldAbsorb > 0
      ? `<div class="mi-outcome-row">
           <span class="mi-outcome failure">
             <i class="fas fa-shield-alt"></i> Shields absorbed ${shieldAbsorb}
           </span>
         </div>`
      : '';

    let resultSection;
    let applyBtn = '';

    if (penetrating <= 0) {
      // Stopped by hull — no apply button needed
      resultSection = `
        <div class="mi-outcome-row">
          <span class="mi-outcome success">
            <i class="fas fa-car"></i> Stopped by Hull (${hull}) — no penetration
          </span>
        </div>`;
    } else {
      // Penetrates — show apply button
      resultSection = `
        <div class="mi-outcome-row">
          <span class="mi-outcome failure">
            <i class="fas fa-car-crash"></i>
            Penetrated! ${damageAfterShields} &minus; Hull (${hull}) = <strong>${penetrating}</strong> to Structure
          </span>
        </div>`;
      applyBtn = `
        <div class="mi-manual-actions">
          <button class="mi-btn mi-btn-veh-apply"
            data-vehicle-id="${vehicleId}"
            data-penetrating="${penetrating}"
            data-structure-current="${structure.value}"
            data-structure-max="${structure.max}">
            <i class="fas fa-car-crash"></i> Apply ${penetrating} to ${vehicle.name}
          </button>
        </div>`;
    }

    const cardContent = `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${vehicle.name}</span>
          <span class="mi-card-skill">Vehicle Damage</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-card-target">Roll <strong>${rawDamage}</strong> vs Hull ${hull}</div>
          ${diceHtml}
          ${shieldLine}
          <div class="mi-roll-result">${penetrating > 0 ? penetrating : 0}</div>
          ${resultSection}
          ${applyBtn}
        </div>
      </div>`;

    await ChatMessage.create({
      content: cardContent,
      speaker: message?.speaker ?? ChatMessage.getSpeaker({ actor: vehicle }),
      rolls:   [damageRoll]
    });

    // Mark button as done — prevent double-fire and clear spinner
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-check"></i> Rolled';
    btn.style.opacity = '0.5';

  } catch (err) {
    console.error('MI | Vehicle damage error:', err);
    ui.notifications.error('Vehicle damage failed — see console for details.');
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-dice"></i> Roll Vehicle Damage';
  }
}

// Semi-auto vehicle — Step 2: apply penetrating damage to structure + roll 1d10 system
async function _onApplyVehicleDamage(btn) {
  if (!game.user.isGM) { ui.notifications.warn('Only the GM can apply vehicle damage.'); return; }

  const vehicleId        = btn.dataset.vehicleId;
  const penetrating      = parseInt(btn.dataset.penetrating, 10);
  const structureCurrent = parseInt(btn.dataset.structureCurrent, 10);
  const structureMax     = parseInt(btn.dataset.structureMax, 10);
  if (!vehicleId || isNaN(penetrating)) return;

  const vehicle = game.actors.get(vehicleId);
  if (!vehicle) { ui.notifications.error('Vehicle not found.'); return; }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Applying…';

  try {
    // ── Structure damage ────────────────────────────────────────────────────
    const structureNew = Math.max(0, structureCurrent - penetrating);

    // ── 1d10 System Component roll ─────────────────────────────────────────
    // System components are now hit-location items — find by 1d10 range match
    const sysRoll    = new Roll('1d10');
    await sysRoll.evaluate();
    const sysRollVal = sysRoll.total;

    const sysItems   = Array.from(vehicle.items)
      .filter(i => i.type === 'hit-location')
      .sort((a, b) => (a.system.sort ?? 0) - (b.system.sort ?? 0));
    const hitItem    = sysItems.find(i =>
      sysRollVal >= (i.system.rangeMin ?? 1) && sysRollVal <= (i.system.rangeMax ?? 1)
    ) ?? null;

    let systemResult = null;
    if (hitItem) {
      const hp      = hitItem.system.hp ?? 1;
      const current = Math.max(0, (hitItem.system.current ?? hp) - 1);
      const wound   = current <= 0  ? 'major'
                    : current / hp <= 0.5 ? 'serious'
                    : 'minor';
      await hitItem.update({ 'system.current': current, 'system.wound': wound });
      systemResult = { label: hitItem.system.label, current, hp, destroyed: current <= 0 };
    }

    // ── Update vehicle structure ────────────────────────────────────────────
    const baseVehicle = game.actors.get(vehicleId);
    await baseVehicle.update({ 'system.structure.value': structureNew });

    // ── Build result card ────────────────────────────────────────────────────
    const structLine = `<div class="mi-outcome-row">
      <span class="mi-outcome failure">
        <i class="fas fa-car-crash"></i>
        Structure ${structureNew} / ${structureMax}
        <span class="mi-muted">(&minus;${penetrating})</span>
      </span>
    </div>`;

    let sysLine;
    if (!hitItem) {
      sysLine = `<div class="mi-outcome-row">
        <span class="mi-outcome success">
          <i class="fas fa-check"></i> Roll ${sysRollVal} — no system affected
        </span>
      </div>`;
    } else if (systemResult) {
      const cls   = systemResult.destroyed ? 'mi-veh-sys-state-destroyed' : 'mi-veh-sys-state-damaged';
      const state = systemResult.destroyed
        ? 'Destroyed'
        : `${systemResult.current} / ${systemResult.hp} remaining`;
      sysLine = `<div class="mi-outcome-row">
        <span class="mi-outcome ${systemResult.destroyed ? 'fumble' : 'failure'}">
          <i class="fas fa-cogs"></i>
          ${systemResult.label}
          &mdash; <span class="${cls}">${state}</span>
        </span>
      </div>`;
    }

    const cardContent = `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${vehicle.name}</span>
          <span class="mi-card-skill">System Damage</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-card-target">System Roll <strong>${sysRollVal}</strong></div>
          <div class="mi-roll-result">${sysRollVal}</div>
          ${structLine}
          ${sysLine}
        </div>
      </div>`;

    await ChatMessage.create({
      content: cardContent,
      speaker: ChatMessage.getSpeaker({ actor: vehicle }),
      rolls:   [sysRoll]
    });

    // Mark button as done — prevent double-fire and clear spinner
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-check"></i> Applied';
    btn.style.opacity = '0.5';

  } catch (err) {
    console.error('MI | Apply vehicle damage error:', err);
    ui.notifications.error('Apply vehicle damage failed — see console.');
    btn.disabled = false;
    btn.innerHTML = `<i class="fas fa-car-crash"></i> Apply ${penetrating} to ${vehicle.name}`;
  }
}


// Semi-Auto — Damage Weapon direct handler.
// Bypasses the hit location and apply-damage flow entirely.
// Rolls the weapon damage formula then fires _resolveDamageWeapon with rawDamage on ctx.
async function _onSemiAutoDamageWeapon(ev, message) {
  ev.preventDefault();
  const btn           = ev.currentTarget;
  const formula       = btn.dataset.formula;
  const attackerId    = btn.dataset.attackerId;
  const defenderId    = btn.dataset.defenderId;
  const weaponId      = btn.dataset.weaponId;
  const defWeaponId   = btn.dataset.defenceWeaponId ?? '';
  const seWinner      = btn.dataset.seWinner ?? 'attacker';

  if (!formula || !attackerId || !defenderId) return;

  // Import first — _getItem is called below before any await
  const { CombatEngine } = await import('./module/combat/CombatEngine.js');

  const attacker    = _resolveActor(attackerId);
  const defender    = _resolveActor(defenderId);
  const weapon      = CombatEngine._getItem(attacker, weaponId);
  const defWeapon   = CombatEngine._getItem(defender, defWeaponId) ?? null;

  if (!attacker || !defender || !weapon) return;

  // Roll the weapon damage formula
  const roll = new Roll(formula);
  await roll.evaluate();
  const rawDamage = roll.total;

  // Build a minimal ctx — all _resolveDamageWeapon needs
  const minimalCtx = {
    attacker,
    defender,
    weapon,
    defenceWeapon:        defWeapon,
    seWinner,
    rawDamage,
    chosenSpecialEffects: ['damageWeapon']
  };

  await resolveDamageWeapon(minimalCtx);
}

// ---------------------------------------------------------------------------
// Semi-Auto burst fire handler
// Reconstructs ctx from the outcome card flags, then calls _resolveBurstDamage.
// ---------------------------------------------------------------------------
async function _onSemiAutoBurstDamage(ev, message) {
  ev.preventDefault();
  const btn        = ev.currentTarget;
  const attackerId = btn.dataset.attackerId;
  const defenderId = btn.dataset.defenderId;
  const weaponId   = btn.dataset.weaponId;
  const messageId  = btn.dataset.messageId;

  if (!attackerId || !defenderId || !weaponId) return;

  // Disable button immediately to prevent double-click
  btn.disabled = true;

  const { CombatEngine } = await import('./module/combat/CombatEngine.js');

  const attacker = _resolveActor(attackerId);
  const defender = _resolveActor(defenderId);
  const weapon   = CombatEngine._getItem(attacker, weaponId);
  if (!attacker || !defender || !weapon) return;

  // Reconstruct ctx from stored flags
  const flags = message.flags?.['mythras-imperative'] ?? {};
  const defWeapon = CombatEngine._getItem(defender, flags.defenceWeaponId ?? '') ?? null;
  const defStyle  = CombatEngine._getItem(attacker, flags.defenceStyleId ?? '') ?? null;

  const ctx = {
    attacker,
    defender,
    weapon,
    attackerStyle:        attacker.items.get(flags.weaponId) ?? null,
    attackerSkillTotal:   flags.attackerSkillTotal ?? 0,
    attackerTraits:       [],
    defenceType:          flags.defenceType ?? 'none',
    defenceWeapon:        defWeapon,
    defenceStyle:         defStyle,
    defenderSkillTotal:   0,
    defenderSurprised:    false,
    wardedLocations:      [],
    attackRoll:           null,
    defenceRoll:          null,
    attackResult:         flags.attackResult ?? null,
    defenceResult:        flags.defenceResult ?? null,
    attackOutcome:        flags.attackOutcome ?? 'success',
    defenceOutcome:       flags.defenceOutcome ?? 'none',
    seWinner:             flags.seWinner ?? 'attacker',
    seCount:              0,
    chosenSpecialEffects: flags.chosenSEs ?? [],
    hitLocationId:        null,
    hitLocationLabel:     null,
    damageRoll:           null,
    rawDamage:            null,
    damageAfterParry:     null,
    damageAfterArmour:    null,
    parryReduction:       null,
    woundLevel:           null,
    enduranceRequired:    false,
    isCharge:             flags.isCharge ?? false,
    isBraced:             false,
    isRanged:             true,
    rangeBand:            flags.rangeBand ?? null,
    isAiming:             false,
    isBurstFire:          true,
    difficulty:           flags.difficulty ?? 'hard',
    modifiers:            0,
    bonusSpecialEffects:  [],
    stage:                'damage',
    chatMessageId:        messageId
  };

  const chatMsg = game.messages.get(messageId);
  await CombatEngine._resolveBurstDamage(ctx, chatMsg);
}

function _resolveHitLocation(d20) {
  // Check if there's exactly one targeted token with hit-location items
  const targets = Array.from(game.user.targets ?? []);
  if (targets.length === 1) {
    const actor = targets[0].actor;
    if (actor) {
      const locs = Array.from(actor.items)
        .filter(i => i.type === 'hit-location')
        .sort((a, b) => (a.system.sort ?? 0) - (b.system.sort ?? 0));
      const hit = locs.find(l => d20 >= l.system.rangeMin && d20 <= l.system.rangeMax);
      if (hit) return hit.system.label;
    }
  }
  // Fallback: standard humanoid table from CONFIG
  const humanoid = CONFIG.MYTHRAS?.hitLocations?.humanoid ?? [];
  const loc = humanoid.find(l => d20 >= l.range[0] && d20 <= l.range[1]);
  return loc ? game.i18n.localize(loc.label) : `Location ${d20}`;
}

async function _onLuckReroll(ev, message) {
  ev.preventDefault();
  const actor = _actorFromMessage(message);
  if (!actor) return;
  const lp = actor.system.attributes?.luckPoints;
  if (!lp || lp.value <= 0) return ui.notifications.warn(game.i18n.localize('MYTHRAS.NoLuckPoints'));
  await actor.update({ 'system.attributes.luckPoints.value': lp.value - 1 });
  const { MythrasRoll } = await import('./module/rolls/MythrasRoll.js');
  await MythrasRoll.reroll(message, actor);
}

async function _onLuckSwap(ev, message) {
  ev.preventDefault();
  const actor = _actorFromMessage(message);
  if (!actor) return;
  const lp = actor.system.attributes?.luckPoints;
  if (!lp || lp.value <= 0) return ui.notifications.warn(game.i18n.localize('MYTHRAS.NoLuckPoints'));
  await actor.update({ 'system.attributes.luckPoints.value': lp.value - 1 });
  const { MythrasRoll } = await import('./module/rolls/MythrasRoll.js');
  await MythrasRoll.swapDigits(message, actor);
}

function _actorFromMessage(message) {
  const id = message.flags?.['mythras-imperative']?.actorId;
  return id ? game.actors.get(id) : null;
}

// ---------------------------------------------------------------------------
// HANDLEBARS HELPERS
// ---------------------------------------------------------------------------
function _registerHelpers() {
  Handlebars.registerHelper('eq',         (a, b)    => a === b);
  Handlebars.registerHelper('lt',         (a, b)    => a < b);   // strict less-than for luck pips
  Handlebars.registerHelper('lte',        (a, b)    => a <= b);
  Handlebars.registerHelper('gt',         (a, b)    => a > b);
  Handlebars.registerHelper('uppercase',  str       => typeof str === 'string' ? str.toUpperCase() : str);
  Handlebars.registerHelper('capitalize', str       => typeof str === 'string' ? str.charAt(0).toUpperCase() + str.slice(1) : str);
  Handlebars.registerHelper('concat',     (...args) => args.slice(0, -1).join(''));

  // Maps heroAdvantages keys to short display labels for the hero banner
  const _ADVANTAGE_LABELS = {
    actionPoint:      '+1 Action Point',
    luckyPoint:       '+1 Luck Point',
    luckyPoint2:      '+2 Luck Points',
    hitPoints:        '+1 HP/location',
    hitPoints2:       '+2 HP/location',
    enduranceEasier:  'Endurance easier',
    stealthEasier:    'Stealth easier',
    willpowerEasier:  'Willpower easier',
    healingRate:      '×2 Healing Rate',
  };
  Handlebars.registerHelper('heroAdvantageLabel', key => _ADVANTAGE_LABELS[key] ?? key);

  Handlebars.registerHelper('select', function(selected, options) {
    return options.fn(this).replace(new RegExp(`value="${selected}"`), `value="${selected}" selected`);
  });

  Handlebars.registerHelper('times', function(n, options) {
    let out = '';
    for (let i = 0; i < n; i++) out += options.fn({ index: i }, { data: { index: i } });
    return out;
  });
}

// ---------------------------------------------------------------------------
// DICE BREAKDOWN HELPER
// Converts a Roll's die terms into a compact readable breakdown.
// e.g. Roll('2d6+1d4') with results [4,3]+[2] → '2d6: [4, 3]  1d4: [2]'
// ---------------------------------------------------------------------------
// =============================================================================
// deleteToken — clean up all Mythras combat state when a token is removed.
//
// What we clean on the deleted actor:
//   - All hit location items: HP restored to max, wound state cleared to 'none'
//   - All active effects (status conditions): deleted entirely
//   - Mythras flags: impaledBy, grippedBy, entangledBy, pendingImpales,
//     pendingGripCheck, pendingEntangleTrip, pendingEntangleBreakFree,
//     stunLocations, stunTurns, sunderedAP, pendingReload, blindedBy,
//     pinnedWeapons, prepareCounter
//
//   On every other actor in the world (cross-reference cleanup):
//     - impaledBy entries where attackerId === deletedId
//     - grippedBy entries where gripperActorId === deletedId
//     - entangledBy entries where attackerActorId === deletedId
//     - pendingGripCheck entries where gripperActorId === deletedId
//     - pendingEntangleBreakFree entries where attackerActorId === deletedId
//     - pendingImpales entries where attackerId === deletedId
//
// Only the GM runs this — prevents races between clients.
// NOTE: This resets the BASE actor. If the token is unlinked (delta-based),
// only the base actor's data is cleared; the token delta is discarded on delete
// automatically by Foundry. For linked tokens this is the full actor reset.
// =============================================================================

// preDeleteToken — clear status effects while the token is still alive.
// This must run BEFORE deletion because the synthetic actor (tokenDoc.actor)
// and its embedded effect collection become invalid once the token is torn down.
// Only the GM runs this to avoid race conditions across clients.
// preDeleteToken — formerly cleared status effects on the synthetic actor here.
// That approach raced with Foundry's own token teardown and produced
// "does not exist in EmbeddedCollection" errors.
// The correct fix is in _removeStatusFromActor / _applyStatusToActor: both now
// bail immediately when no canvas token is found, so any in-flight status
// removal calls (from updateCombat etc.) are safe to fire even after deletion.
// Nothing needs to happen here — Foundry cleans up the actorDelta effects itself.
Hooks.on('preDeleteToken', (_tokenDoc) => {});

Hooks.on('deleteToken', async (tokenDoc) => {
  if (!game.user.isGM) return;

  // For linked tokens tokenDoc.actorId is the base actor's ID.
  // For unlinked tokens tokenDoc.actor is a synthetic actor with a different ID;
  // we must use game.actors.get(tokenDoc.actorId) to reach the persisted base actor.
  const baseActorId = tokenDoc.actorId;
  const baseActor   = baseActorId ? game.actors.get(baseActorId) : null;

  // deletedId covers both the base actor ID (linked tokens) and the synthetic
  // actor ID (unlinked tokens) so cross-reference cleanup catches both cases.
  const syntheticId = tokenDoc.actor?.id ?? null;
  const deletedIds  = new Set([baseActorId, syntheticId].filter(Boolean));

  const NS = 'mythras-imperative';

  // ── 1. Clear all Mythras flags on the base actor ──────────────────────────
  const ownFlags = [
    'impaledBy', 'grippedBy', 'entangledBy',
    'pendingImpales', 'pendingGripCheck',
    'pendingEntangleTrip', 'pendingEntangleBreakFree',
    'stunLocations', 'stunTurns', 'sunderedAP', 'blindedBy', 'pinnedWeapons', 'pinnedDown',
    'prepareCounter', 'pendingReload', 'jammedWeapons'
  ];
  if (baseActor) {
    for (const flag of ownFlags) {
      try {
        const val = baseActor.getFlag(NS, flag);
        if (val !== undefined && val !== null) await baseActor.unsetFlag(NS, flag);
      } catch (_) {}
    }
  }

  // ── 2. Reset hit location wounds on the base actor ────────────────────────
  // system.current and system.wound live on the base actor's hit-location items.
  if (baseActor) {
    const locItems = baseActor.items.filter(i => i.type === 'hit-location');
    for (const loc of locItems) {
      const maxHp = loc.system.hp ?? loc.system.max ?? 0;
      const updates = {};
      if ((loc.system.current ?? maxHp) !== maxHp) updates['system.current'] = maxHp;
      if (loc.system.wound && loc.system.wound !== 'none') updates['system.wound'] = 'none';
      if (Object.keys(updates).length > 0) {
        try { await loc.update(updates); } catch (_) {}
      }
    }
  }

  // ── 3. Cross-reference cleanup on all other actors ────────────────────────
  // Remove any flag entries on other actors that reference the deleted actor.
  // We check against all IDs for this token (base + synthetic).
  const crossRefs = [
    ['impaledBy',                'attackerId'],
    ['grippedBy',                'gripperActorId'],
    ['entangledBy',              'attackerActorId'],
    ['pendingGripCheck',         'gripperActorId'],
    ['pendingEntangleBreakFree', 'attackerActorId'],
    ['pendingImpales',           'attackerId'],
    ['pendingEntangleTrip',      'defenderId'],   // attacker holds this; defenderId is the victim
  ];

  for (const otherActor of game.actors.contents) {
    if (deletedIds.has(otherActor.id)) continue;
    for (const [flagName, fieldName] of crossRefs) {
      let entries;
      try { entries = otherActor.getFlag(NS, flagName); }
      catch (_) { continue; }
      if (!entries || typeof entries !== 'object') continue;

      const filtered = Object.fromEntries(
        Object.entries(entries).filter(([, entry]) => !deletedIds.has(entry[fieldName]))
      );
      if (Object.keys(filtered).length !== Object.keys(entries).length) {
        await otherActor.setFlag(NS, flagName, filtered);
      }
    }

    // Prepare Counter: if the deleted token is the attacker being watched,
    // clear the prepareCounter flag on the defending actor.
    try {
      const pc = otherActor.getFlag(NS, 'prepareCounter');
      if (pc && deletedIds.has(pc.attackerActorId)) {
        await otherActor.unsetFlag(NS, 'prepareCounter');
      }
    } catch (_) {}
  }
});

// =============================================================================
// TOKEN WOUND BADGES
//
// Draws a small coloured dot on each token to indicate the worst wound state
// across all hit locations.  Badge is redrawn on every token refresh so it
// stays in sync when damage is applied or healed.
//
// Wound colours match the CSS palette:
//   minor   — amber   #d4a017
//   serious — orange  #c05500
//   major   — red     #8b1a1a
//
// The badge renders in the bottom-right quadrant of the token so it doesn't
// obscure the token artwork or clash with Foundry's own status effect icons
// (which render along the bottom-left).
// =============================================================================

const WOUND_ORDER  = ['none', 'minor', 'serious', 'major'];
const WOUND_COLOUR = { minor: 0xd4a017, serious: 0xc05500, major: 0x8b1a1a };

/** Return the worst wound level across all hit-location items on an actor. */
function _worstWound(actor) {
  if (!actor) return 'none';
  let worst = 0;
  for (const item of actor.items) {
    if (item.type !== 'hit-location') continue;
    const lvl = WOUND_ORDER.indexOf(item.system?.wound ?? 'none');
    if (lvl > worst) worst = lvl;
  }
  return WOUND_ORDER[worst];
}

Hooks.on('refreshToken', (token) => {
  // Remove any existing badge container
  if (token._miWoundBadge) {
    token._miWoundBadge.destroy({ children: true });
    token._miWoundBadge = null;
  }

  const actor = token.document?.actor;
  const level = _worstWound(actor);
  if (level === 'none') return;

  const colour = WOUND_COLOUR[level];

  // Size the badge relative to the token grid size — stays proportional
  // across different token sizes (1×1, 2×2, etc.)
  const size   = token.w;           // token width in pixels
  const radius = Math.max(5, size * 0.10);
  const border = Math.max(1, radius * 0.25);
  const margin = radius * 0.6;

  // Position: bottom-right corner
  const x = size - margin - radius;
  const y = size - margin - radius;

  const g = new PIXI.Graphics();

  // Dark border ring for legibility on light token art
  g.beginFill(0x000000, 0.55);
  g.drawCircle(x, y, radius + border);
  g.endFill();

  // Coloured fill
  g.beginFill(colour, 0.92);
  g.drawCircle(x, y, radius);
  g.endFill();

  // Attach above the base mesh but below UI elements
  token.addChild(g);
  token._miWoundBadge = g;
});

// ---------------------------------------------------------------------------
// MEG IMPORTER — "Import from MEG" button in the Actors sidebar
// ---------------------------------------------------------------------------
Hooks.on('renderActorDirectory', (_app, html, _data) => {
  if (!game.user.isGM) return;

  // Foundry v14 passes html as a plain HTMLElement; guard against jQuery too
  const root = (html instanceof HTMLElement) ? html : html[0];
  if (!root) return;

  // Place button in the sidebar footer (below the directory list)
  // Fall back to header-actions if footer doesn't exist in this Foundry build
  let target = root.querySelector('.directory-footer');
  if (!target) {
    // Create a footer if one doesn't exist
    target = document.createElement('div');
    target.className = 'directory-footer';
    target.style.cssText = 'padding:4px 8px';
    root.appendChild(target);
  }
  if (target.querySelector('.meg-import-btn')) return;   // already added

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'meg-import-btn';
  btn.innerHTML = '<i class="fas fa-file-import"></i> Import from MEG';
  btn.style.cssText = 'width:100%;margin-top:4px';
  btn.addEventListener('click', () => openMegImportDialog());
  target.appendChild(btn);
});

