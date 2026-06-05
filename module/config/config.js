/**
 * mythras-imperative/module/config/config.js
 *
 * The MYTHRAS CONFIG object. This is the primary extension point for modules
 * building on top of the Mythras Imperative system. All properties are
 * documented below. Modules should write to these during their setup hooks.
 *
 * Example (in a module's setup hook):
 *   Hooks.once('setup', () => {
 *     MYTHRAS.itemTypes.push('destined-power');
 *     MYTHRAS.dataModels.items['destined-power'] = DestinedPowerModel;
 *     MYTHRAS.sheets.items['destined-power'] = DestinedPowerSheet;
 *   });
 */

export const MYTHRAS = {

  // -----------------------------------------------------------------------
  // ACTOR & ITEM TYPE REGISTRATION
  // Modules push additional type name strings into these arrays.
  // The system's item/actor creation dialogs will offer them as options.
  // -----------------------------------------------------------------------

  /** @type {string[]} Additional actor type names registered by modules */
  actorTypes: [],

  /** @type {string[]} Additional item type names registered by modules */
  itemTypes: [],

  // -----------------------------------------------------------------------
  // DATA MODEL REGISTRATION
  // Modules register their TypeDataModel class for each custom type.
  // Key: type name string. Value: DataModel class.
  // -----------------------------------------------------------------------

  dataModels: {
    /** @type {Object.<string, typeof TypeDataModel>} Custom actor data models */
    actors: {},
    /** @type {Object.<string, typeof TypeDataModel>} Custom item data models */
    items: {}
  },

  // -----------------------------------------------------------------------
  // SHEET REGISTRATION
  // Modules register their ApplicationV2 sheet class for each custom type.
  // Key: type name string. Value: ApplicationV2 class.
  // -----------------------------------------------------------------------

  sheets: {
    /** @type {Object.<string, typeof ApplicationV2>} Custom actor sheet classes */
    actors: {},
    /** @type {Object.<string, typeof ApplicationV2>} Custom item sheet classes */
    items: {}
  },

  // -----------------------------------------------------------------------
  // ROLL HOOKS
  // Modules register callbacks that fire before and after roll resolution.
  // preRoll  : ({ actor, skill, difficulty, modifier }) => void | false
  //            Return false to cancel the roll entirely.
  // postRoll : ({ actor, skill, roll, outcome, chatData }) => void
  //            Modify chatData to alter the chat card output.
  // -----------------------------------------------------------------------

  rollHooks: {
    /** @type {Function[]} Called before a skill/combat roll is resolved */
    preRoll: [],
    /** @type {Function[]} Called after a roll is resolved, before chat output */
    postRoll: []
  },

  // -----------------------------------------------------------------------
  // DAMAGE HOOKS
  // applyDamage : ({ actor, location, damage, source }) => void
  //              Intercept for damage reduction powers, shields, etc.
  // -----------------------------------------------------------------------

  /** @type {Function[]} Called when damage is about to be applied to an actor */
  damageHooks: [],

  // -----------------------------------------------------------------------
  // EVASION HOOKS
  // evasionHook : (ctx, willBeProne) => boolean | void
  //   Called after the defender chooses Evade or Acrobatics.
  //   Return false to suppress the prone condition being applied.
  //   ctx.defenceType is 'evade' or 'acrobatics'.
  //   ctx.willBeProne reflects the dialog's determination before hooks run.
  // -----------------------------------------------------------------------

  /** @type {Function[]} Called when a defender evades; return false to prevent prone */
  evasionHooks: [],

  // -----------------------------------------------------------------------
  // ACTION POINT BONUS HOOKS
  // apBonusHook : (actor) => number
  //   Called during prepareDerivedData AFTER the base AP max is computed
  //   from INT+DEX (or the GM override) and AFTER the fatigue penalty is
  //   applied. Return a positive integer to add bonus AP (e.g. Combat Expert
  //   in Destined grants +1). Multiple hooks stack. The result is always
  //   clamped to a minimum of 1.
  // -----------------------------------------------------------------------

  /** @type {Function[]} Each returns a bonus AP count for the given actor */
  apBonusHooks: [],

  // -----------------------------------------------------------------------
  // COMBAT ACTIONS
  // Modules register additional Combat Actions that appear in the combat
  // action menu. Each entry: { id, label, icon, handler }
  // -----------------------------------------------------------------------

  /** @type {Array<{id: string, label: string, icon: string, handler: Function}>} */
  combatActions: [],

  // -----------------------------------------------------------------------
  // DIFFICULTY GRADES
  // The standard Mythras Imperative difficulty scale.
  // Modules should not modify this unless implementing a house rule variant.
  // -----------------------------------------------------------------------

  difficultyGrades: {
    veryEasy:    { label: 'MYTHRAS.DifficultyVeryEasy',   multiplier: 2    },
    easy:        { label: 'MYTHRAS.DifficultyEasy',        multiplier: 1.5  },
    standard:    { label: 'MYTHRAS.DifficultyStandard',   multiplier: 1    },
    hard:        { label: 'MYTHRAS.DifficultyHard',        multiplier: 0.667 },
    formidable:  { label: 'MYTHRAS.DifficultyFormidable', multiplier: 0.5  },
    herculean:   { label: 'MYTHRAS.DifficultyHerculean',  multiplier: 0.2  },
    hopeless:    { label: 'MYTHRAS.DifficultyHopeless',   multiplier: null }
  },

  // -----------------------------------------------------------------------
  // CHARACTERISTICS
  // The seven core characteristics of every Mythras character.
  // -----------------------------------------------------------------------

  characteristics: {
    str: { label: 'MYTHRAS.CharSTR', abbreviation: 'MYTHRAS.CharSTRAbbr' },
    con: { label: 'MYTHRAS.CharCON', abbreviation: 'MYTHRAS.CharCONAbbr' },
    siz: { label: 'MYTHRAS.CharSIZ', abbreviation: 'MYTHRAS.CharSIZAbbr' },
    dex: { label: 'MYTHRAS.CharDEX', abbreviation: 'MYTHRAS.CharDEXAbbr' },
    int: { label: 'MYTHRAS.CharINT', abbreviation: 'MYTHRAS.CharINTAbbr' },
    pow: { label: 'MYTHRAS.CharPOW', abbreviation: 'MYTHRAS.CharPOWAbbr' },
    cha: { label: 'MYTHRAS.CharCHA', abbreviation: 'MYTHRAS.CharCHAAbbr' }
  },

  // -----------------------------------------------------------------------
  // HIT LOCATIONS
  // Standard humanoid hit location table (1d20).
  // Creatures may define custom tables on their actor data.
  // -----------------------------------------------------------------------

  hitLocations: {
    humanoid: [
      { label: 'MYTHRAS.LocationRightLeg',  range: [1,  3],  id: 'rightLeg'  },
      { label: 'MYTHRAS.LocationLeftLeg',   range: [4,  6],  id: 'leftLeg'   },
      { label: 'MYTHRAS.LocationAbdomen',   range: [7,  9],  id: 'abdomen'   },
      { label: 'MYTHRAS.LocationChest',     range: [10, 12], id: 'chest'     },
      { label: 'MYTHRAS.LocationRightArm',  range: [13, 15], id: 'rightArm'  },
      { label: 'MYTHRAS.LocationLeftArm',   range: [16, 18], id: 'leftArm'   },
      { label: 'MYTHRAS.LocationHead',      range: [19, 20], id: 'head'      }
    ]
  },

  // -----------------------------------------------------------------------
  // HIT LOCATION ADJACENCY MAP — fallback for the Marksman Special Effect
  //
  // Used only when the defender has NO hit-location items on their actor
  // (uncommon — most placed actors have them). In the normal case, Marksman
  // resolves adjacency by index position in the sorted hit-location item
  // list (same sort as Choose Location), with no name matching required.
  //
  // Downstream modules may extend this map via CONFIG.MYTHRAS.hitLocationAdjacency
  // to add creature-specific adjacency for actors without hit-location items.
  //
  // Source: Mythras Imperative p.45 — "move the Hit Location struck by one
  // step, to an immediately adjoining body area."
  // -----------------------------------------------------------------------

  hitLocationAdjacency: {
    // Standard humanoid layout
    'right leg':  ['abdomen'],
    'left leg':   ['abdomen'],
    'abdomen':    ['chest', 'right leg', 'left leg'],
    'chest':      ['abdomen', 'right arm', 'left arm', 'head'],
    'right arm':  ['chest'],
    'left arm':   ['chest'],
    'head':       ['chest'],
  },

  // -----------------------------------------------------------------------
  // FATIGUE LEVELS
  // Ordered from best to worst. Used by fatigue tracking automation.
  //
  // skillGrade:        difficulty grade applied to ALL skill rolls at this level
  // moveMode:          'normal' | 'halved' | 'immobile'
  // initiativePenalty: subtracted from initiative roll result
  // actionPenalty:     subtracted from actionPoints.max (floored at 0)
  // recoveryHours:     base recovery time (divide by Healing Rate for actual)
  //
  // Source: Mythras Imperative p.30 Fatigue Levels table
  // -----------------------------------------------------------------------

  fatigueLevels: [
    { id: 'fresh',         label: 'MYTHRAS.FatigueFresh',         skillGrade: null,         moveMode: 'normal',   initiativePenalty: 0, actionPenalty: 0, recoveryHours: 0    },
    { id: 'winded',        label: 'MYTHRAS.FatigueWinded',        skillGrade: 'hard',        moveMode: 'normal',   initiativePenalty: 0, actionPenalty: 0, recoveryHours: 0.25 },
    { id: 'tired',         label: 'MYTHRAS.FatigueTired',         skillGrade: 'hard',        moveMode: 'normal',   initiativePenalty: 0, actionPenalty: 0, recoveryHours: 3    },
    { id: 'wearied',       label: 'MYTHRAS.FatigueWearied',       skillGrade: 'formidable',  moveMode: 'normal',   initiativePenalty: 2, actionPenalty: 0, recoveryHours: 6    },
    { id: 'exhausted',     label: 'MYTHRAS.FatigueExhausted',     skillGrade: 'formidable',  moveMode: 'halved',   initiativePenalty: 4, actionPenalty: 1, recoveryHours: 12   },
    { id: 'debilitated',   label: 'MYTHRAS.FatigueDebilitated',   skillGrade: 'herculean',   moveMode: 'halved',   initiativePenalty: 6, actionPenalty: 2, recoveryHours: 18   },
    { id: 'incapacitated', label: 'MYTHRAS.FatigueIncapacitated', skillGrade: 'herculean',   moveMode: 'immobile', initiativePenalty: 8, actionPenalty: 3, recoveryHours: 24   },
    { id: 'semiconscious', label: 'MYTHRAS.FatigueSemiConscious', skillGrade: 'hopeless',    moveMode: 'immobile', initiativePenalty: 8, actionPenalty: 3, recoveryHours: 36   },
    { id: 'comatose',      label: 'MYTHRAS.FatigueComatose',      skillGrade: 'hopeless',    moveMode: 'immobile', initiativePenalty: 8, actionPenalty: 3, recoveryHours: 48   },
    { id: 'dead',          label: 'MYTHRAS.FatigueDead',          skillGrade: null,          moveMode: 'immobile', initiativePenalty: 8, actionPenalty: 3, recoveryHours: null  }
  ],

  // -----------------------------------------------------------------------
  // CONDITIONS
  // Simple flag-based conditions tracked as token status icons.
  // -----------------------------------------------------------------------

  conditions: {
    prone:          { label: 'MYTHRAS.ConditionProne',          icon: 'icons/svg/falling.svg'      },
    bleeding:       { label: 'MYTHRAS.ConditionBleeding',       icon: 'icons/svg/blood.svg'        },
    unconscious:    { label: 'MYTHRAS.ConditionUnconscious',    icon: 'icons/svg/unconscious.svg'  },
    surprised:      { label: 'MYTHRAS.ConditionSurprised',      icon: 'icons/svg/eye.svg'          },
    entangled:      { label: 'MYTHRAS.ConditionEntangled',      icon: 'icons/svg/net.svg'          },
    burning:        { label: 'MYTHRAS.ConditionBurning',        icon: 'icons/svg/fire.svg'         },
    // Wound-state conditions — applied by the wound consequence engine
    stunned:        { label: 'MYTHRAS.ConditionStunned',        icon: 'icons/svg/daze.svg'         },
    blinded:        { label: 'MYTHRAS.ConditionBlinded',        icon: 'icons/svg/blind.svg'        },
    incapacitated:  { label: 'MYTHRAS.ConditionIncapacitated',  icon: 'icons/svg/paralysis.svg'    },
    dead:           { label: 'MYTHRAS.ConditionDead',           icon: 'icons/svg/skull.svg'        }
  },

  // -----------------------------------------------------------------------
  // WEAPON TRAITS
  // Standard weapon special traits referenced in the rules.
  //
  // Each entry: { key, label, description, engineEffect }
  //   key          — canonical string the engine matches against (e.g. traits.includes('impaling'))
  //   label        — human-readable name for the weapon sheet UI
  //   description  — rules text shown as a tooltip on the weapon sheet
  //   engineEffect — true = the combat engine reads this trait mechanically
  //
  // EXTENSION: downstream modules add entries during their setup hook:
  //   CONFIG.MYTHRAS.weaponTraits.energyWeapon = { key: 'energyWeapon', label: '...', ... };
  //
  // NOTE: The stored weapon.system.traits array still contains canonical key strings.
  // No engine code needs to change — traits.includes('impaling') continues to work.
  // -----------------------------------------------------------------------

  weaponTraits: {
    bleeding: {
      key:          'bleeding',
      label:        'Bleeding',
      description:  'Pointed edges or blades cause profuse bleeding on contact. Enables the Bleed Special Effect (Critical only for firearms).',
      engineEffect: true
    },
    bludgeoning: {
      key:          'bludgeoning',
      label:        'Bludgeoning',
      description:  'Delivers impact trauma rather than cuts. Enables the Bash and Stun Location Special Effects.',
      engineEffect: true
    },
    entangling: {
      key:          'entangling',
      label:        'Entangling',
      description:  'Can wrap around or snag an opponent. Enables the Entangle Special Effect.',
      engineEffect: true
    },
    firearm: {
      key:          'firearm',
      label:        'Firearm',
      description:  'A ranged firearm. Unlocks burst fire, full auto, and firearm-specific Special Effects (Duck Back, Drop Foe, Pin Down, Weapon Malfunction).',
      engineEffect: true
    },
    'burst-fire': {
      key:          'burst-fire',
      label:        'Burst Fire',
      description:  'Can fire a short burst. Hard difficulty; 1d[burst size] rounds strike on a hit.',
      engineEffect: true
    },
    'full-auto': {
      key:          'full-auto',
      label:        'Full Auto',
      description:  'Can fire fully automatically. Formidable difficulty; rounds are distributed across declared targets.',
      engineEffect: true
    },
    impaling: {
      key:          'impaling',
      label:        'Impaling',
      description:  'Can lodge in a wound. Enables the Impale Special Effect — roll damage twice and use the better result.',
      engineEffect: true
    },
    shield: {
      key:          'shield',
      label:        'Shield',
      description:  'A shield. Provides Passive Blocking locations. Bash knockback uses a divisor of 2 instead of 3.',
      engineEffect: true
    },
    sundering: {
      key:          'sundering',
      label:        'Sundering',
      description:  'Designed to damage weapons and armour. Enables the Sunder Special Effect.',
      engineEffect: true
    },
    thrown: {
      key:          'thrown',
      label:        'Thrown',
      description:  'A melee weapon that can also be thrown, using ranged combat resolution.',
      engineEffect: true
    },
    'two-handed': {
      key:          'two-handed',
      label:        'Two-Handed',
      description:  'Requires both hands to wield. Also enables the Sunder Special Effect.',
      engineEffect: true
    },
    unarmed: {
      key:          'unarmed',
      label:        'Unarmed',
      description:  'Represents a natural or unarmed attack. Enables the Grip Special Effect.',
      engineEffect: true
    },
    mounted: {
      key:          'mounted',
      label:        'Mounted',
      description:  'Designed for use from horseback or another mount.',
      engineEffect: false
    },
    'set-to-receive-charge': {
      key:          'set-to-receive-charge',
      label:        'Set to Receive Charge',
      description:  "Can be braced to receive a charging opponent, using the charger's Damage Modifier instead of the defender's.",
      engineEffect: true
    },
    hightech: {
      key:          'hightech',
      label:        'High-Tech',
      description:  'Advanced high-technology weapon. Enables the Circumvent Cover Special Effect.',
      engineEffect: true
    }
  },

  // -----------------------------------------------------------------------
  // WEAPON SIZE CATEGORIES
  // Used in parry resolution.
  // -----------------------------------------------------------------------

  weaponSizes: {
    S: { label: 'MYTHRAS.SizeSmall'    },
    M: { label: 'MYTHRAS.SizeMedium'   },
    L: { label: 'MYTHRAS.SizeLarge'    },
    H: { label: 'MYTHRAS.SizeHuge'     },
    E: { label: 'MYTHRAS.SizeEnormous' }
  },

  // -----------------------------------------------------------------------
  // SPECIAL EFFECTS
  // All 32 special effects from Mythras Imperative.
  //
  // Fields: id, label, who (attacker/defender/both), restriction,
  //   phase, requiresDamage, requiresFumble, resolver.
  //
  // phase values:
  //   'opposed'        — dispatched through CombatEngine._resolveOpposedSEs
  //   'attackerScored' — fires immediately in _afterDefenceResolved when the
  //                      attacker scored (before damage), regardless of
  //                      automation level
  //   'damage'         — read inline during damage resolution; not dispatched
  //   'none'           — no engine dispatch (narrative, or handled separately)
  //
  // requiresDamage: true  → resolver only called when damage > 0
  // requiresFumble: true  → resolver only called when ctx.attackOutcome === 'fumble'
  //
  // resolver: SE id key for 'opposed' and 'attackerScored' SEs — matches
  //           the key in SE_RESOLVERS (effects/index.js); null for 'damage' and 'none'.
  //
  // Extension point: modules may push additional entries into this array.
  // The engine iterates it at resolution time, so custom SEs added here
  // are automatically included in dispatch and the hasOpposedSE gate.
  // -----------------------------------------------------------------------

  specialEffects: [
    // ── Attacker SEs ──────────────────────────────────────────────────────
    { id: 'bash',             label: 'MYTHRAS.SEBash',             who: 'attacker', restriction: 'shieldOrBludgeon',       phase: 'opposed',        requiresDamage: false, requiresFumble: false, resolver: 'bash'             },
    { id: 'bleed',            label: 'MYTHRAS.SEBleed',            who: 'attacker', restriction: 'cuttingOrFirearmCritical',phase: 'opposed',        requiresDamage: true,  requiresFumble: false, resolver: 'bleed'            },
    { id: 'bypassArmour',     label: 'MYTHRAS.SEBypassArmour',     who: 'attacker', restriction: 'attackerCritical',        phase: 'damage',         requiresDamage: false, requiresFumble: false, resolver: null                       },
    { id: 'chooseLocation',   label: 'MYTHRAS.SEChooseLocation',   who: 'attacker', restriction: 'rangedNotClose',          phase: 'damage',         requiresDamage: false, requiresFumble: false, resolver: null                       },
    { id: 'circumventCover',  label: 'MYTHRAS.SECircumventCover',  who: 'attacker', restriction: 'highTechFirearm',         phase: 'attackerScored', requiresDamage: false, requiresFumble: false, resolver: 'circumventCover'  },
    { id: 'circumventParry',  label: 'MYTHRAS.SECircumventParry',  who: 'attacker', restriction: 'attackerCritical',        phase: 'damage',         requiresDamage: false, requiresFumble: false, resolver: null                       },
    { id: 'disarmOpponent',   label: 'MYTHRAS.SEDisarmOpponent',   who: 'both',     restriction: null,                      phase: 'opposed',        requiresDamage: false, requiresFumble: false, resolver: 'disarmOpponent'   },
    { id: 'dropFoe',          label: 'MYTHRAS.SEDropFoe',          who: 'attacker', restriction: 'firearmsOnly',            phase: 'opposed',        requiresDamage: false, requiresFumble: false, resolver: 'dropFoe'          },
    { id: 'duckBack',         label: 'MYTHRAS.SEDuckBack',         who: 'attacker', restriction: 'firearmsOnly',            phase: 'attackerScored', requiresDamage: false, requiresFumble: false, resolver: 'duckBack'         },
    { id: 'entangle',         label: 'MYTHRAS.SEEntangle',         who: 'attacker', restriction: 'entanglingWeapon',        phase: 'opposed',        requiresDamage: false, requiresFumble: false, resolver: 'entangle'         },
    { id: 'forceFailure',     label: 'MYTHRAS.SEForceFailure',     who: 'both',     restriction: 'opponentFumbles',         phase: 'none',           requiresDamage: false, requiresFumble: false, resolver: null                       },
    { id: 'grip',             label: 'MYTHRAS.SEGrip',             who: 'attacker', restriction: 'unarmed',                 phase: 'opposed',        requiresDamage: false, requiresFumble: false, resolver: 'grip'             },
    { id: 'impale',           label: 'MYTHRAS.SEImpale',           who: 'attacker', restriction: 'impalingWeapon',          phase: 'opposed',        requiresDamage: true,  requiresFumble: false, resolver: 'impale'           },
    { id: 'marksman',         label: 'MYTHRAS.SEMarksman',         who: 'attacker', restriction: 'rangedWeapon',            phase: 'damage',         requiresDamage: false, requiresFumble: false, resolver: null                       },
    { id: 'maximiseDamage',   label: 'MYTHRAS.SEMaximiseDamage',   who: 'attacker', restriction: 'attackerCritical',        phase: 'damage',         requiresDamage: false, requiresFumble: false, resolver: null                       },
    { id: 'overpenetrate',    label: 'MYTHRAS.SEOverpenetrate',    who: 'attacker', restriction: 'firearmsOnlyCritical',    phase: 'attackerScored', requiresDamage: false, requiresFumble: false, resolver: 'overpenetrate'    },
    { id: 'pinDown',          label: 'MYTHRAS.SEPinDown',          who: 'attacker', restriction: 'firearmsOnly',            phase: 'opposed',        requiresDamage: false, requiresFumble: false, resolver: 'pinDown'          },
    { id: 'rapidReload',      label: 'MYTHRAS.SERapidReload',      who: 'attacker', restriction: 'rangedWeapon',            phase: 'attackerScored', requiresDamage: false, requiresFumble: false, resolver: 'rapidReload'      },
    { id: 'scarFoe',          label: 'MYTHRAS.SEScarFoe',          who: 'attacker', restriction: null,                      phase: 'none',           requiresDamage: false, requiresFumble: false, resolver: null                       },
    { id: 'stunLocation',     label: 'MYTHRAS.SEStunLocation',     who: 'attacker', restriction: 'bludgeoning',             phase: 'opposed',        requiresDamage: true,  requiresFumble: false, resolver: 'stunLocation'     },
    { id: 'sunder',           label: 'MYTHRAS.SESunder',           who: 'attacker', restriction: 'sunderWeapon',            phase: 'damage',         requiresDamage: false, requiresFumble: false, resolver: null                       },
    { id: 'tripOpponent',     label: 'MYTHRAS.SETripOpponent',     who: 'both',     restriction: null,                      phase: 'opposed',        requiresDamage: false, requiresFumble: false, resolver: 'tripOpponent'     },
    // ── Defender SEs ──────────────────────────────────────────────────────
    { id: 'accidentalInjury', label: 'MYTHRAS.SEAccidentalInjury', who: 'defender', restriction: 'attackerFumbles',         phase: 'opposed',        requiresDamage: false, requiresFumble: true,  resolver: 'accidentalInjury' },
    { id: 'blindOpponent',    label: 'MYTHRAS.SEBlindOpponent',    who: 'defender', restriction: 'defenderCritical',        phase: 'opposed',        requiresDamage: false, requiresFumble: false, resolver: 'blindOpponent'    },
    { id: 'damageWeapon',     label: 'MYTHRAS.SEDamageWeapon',     who: 'both',     restriction: null,                      phase: 'opposed',        requiresDamage: false, requiresFumble: false, resolver: 'damageWeapon'     },
    { id: 'enhanceParry',     label: 'MYTHRAS.SEEnhanceParry',     who: 'defender', restriction: 'defenderCritical',        phase: 'damage',         requiresDamage: false, requiresFumble: false, resolver: null                       },
    { id: 'pinWeapon',        label: 'MYTHRAS.SEPinWeapon',        who: 'defender', restriction: null,                      phase: 'opposed',        requiresDamage: false, requiresFumble: false, resolver: 'pinWeapon'        },
    { id: 'prepareCounter',   label: 'MYTHRAS.SEPrepareCounter',   who: 'defender', restriction: null,                      phase: 'opposed',        requiresDamage: false, requiresFumble: false, resolver: 'prepareCounter'   },
    { id: 'selectTarget',     label: 'MYTHRAS.SESelectTarget',     who: 'defender', restriction: 'attackerFumbles',         phase: 'opposed',        requiresDamage: false, requiresFumble: false, resolver: 'selectTarget'     },
    { id: 'slipFree',         label: 'MYTHRAS.SESlipFree',         who: 'defender', restriction: 'defenderCritical',        phase: 'opposed',        requiresDamage: false, requiresFumble: false, resolver: 'slipFree'         },
    { id: 'weaponMalfunction',label: 'MYTHRAS.SEWeaponMalfunction',who: 'defender', restriction: 'attackerFumblesFirearm',  phase: 'opposed',        requiresDamage: false, requiresFumble: true,  resolver: 'weaponMalfunction' },
    { id: 'withdraw',         label: 'MYTHRAS.SEWithdraw',         who: 'defender', restriction: null,                      phase: 'opposed',        requiresDamage: false, requiresFumble: false, resolver: 'withdraw'         },
  ],

  // -----------------------------------------------------------------------
  // CULTURES
  // The four standard human cultures from Mythras Imperative.
  // -----------------------------------------------------------------------

  cultures: {
    barbarian:  { label: 'MYTHRAS.CultureBarbarian'  },
    civilised:  { label: 'MYTHRAS.CultureCivilised'  },
    nomadic:    { label: 'MYTHRAS.CultureNomadic'     },
    primitive:  { label: 'MYTHRAS.CulturePrimitive'   }
  },

  // -----------------------------------------------------------------------
  // COMBAT STYLE TRAITS
  // The 11 canonical traits from Mythras Imperative p.34.
  // engineEffect: true = the combat engine reads this trait and modifies
  //               resolution. false = narrative/reminder only.
  // -----------------------------------------------------------------------

  combatStyleTraits: {
    beastBackLancer:  {
      key:          'beastBackLancer',
      label: 'Beast-back Lancer',
      description: 'Performing a mounted charge with this style does not incur the one step difficulty penalty to hit.',
      engineEffect: true   // removes Hard grade on mounted charge attack
    },
    blindFighting: {
      key:          'blindFighting',
      label: 'Blind Fighting',
      description: 'Allows the user to ignore any penalties imposed due to poor lighting or temporary blinding.',
      engineEffect: true   // engine ignores darkness difficulty modifiers
    },
    daredevil: {
      key:          'daredevil',
      label: 'Daredevil',
      description: 'May use the Evade skill to dodge blows in hand-to-hand combat without ending up prone.',
      engineEffect: true   // successful Evade does not apply prone condition
    },
    defensiveMinded: {
      key:          'defensiveMinded',
      label: 'Defensive Minded',
      description: 'Increases the Size of your weapon when parrying by one step, provided no offensive action is taken that round.',
      engineEffect: true   // parry size steps up one during parry resolution
    },
    formationFighting: {
      key:          'formationFighting',
      label: 'Formation Fighting',
      description: 'Permits an unflanked group of three or more warriors to draw into close formation, reducing each foe\'s Action Points by one if they engage.',
      engineEffect: true   // reduces opposing AP by 1 when formation conditions met
    },
    knockoutBlow: {
      key:          'knockoutBlow',
      label: 'Knockout Blow',
      description: 'When attacking with surprise, treat any Stun Location as lasting minutes instead of turns.',
      engineEffect: true   // extends Stun Location duration when target is surprised
    },
    mountedCombat: {
      key:          'mountedCombat',
      label: 'Mounted Combat',
      description: 'Allows the character to ignore the skill cap placed upon combat rolls by the Ride skill.',
      engineEffect: true   // removes Ride-based skill cap from attack/parry rolls
    },
    rangedMarksman: {
      key:          'rangedMarksman',
      label: 'Ranged Marksman',
      description: 'When using a ranged weapon, shift a random Hit Location roll to an adjoining body location.',
      engineEffect: true   // attacker may shift hit location one step on ranged hit
    },
    skirmishing: {
      key:          'skirmishing',
      label: 'Skirmishing',
      description: 'The style permits launching ranged attacks whilst walking or running.',
      engineEffect: true   // removes movement penalty on ranged attacks
    },
    throwWeapons: {
      key:          'throwWeapons',
      label: 'Throw Weapons',
      description: 'Any melee weapon in the style can also be thrown at no penalty to skill, but damage roll is halved.',
      engineEffect: true   // melee weapons in style gain thrown capability; damage halved
    },
    unarmedProwess: {
      key:          'unarmedProwess',
      label: 'Unarmed Prowess',
      description: 'Permits the user to treat Unarmed blocks and parries as Medium sized, enabling better defence against armed opponents.',
      engineEffect: true   // unarmed parry size treated as Medium instead of Small
    }
  },

  // -----------------------------------------------------------------------
  // AMMO TRAITS
  // Traits on ammo items (category: 'ammo' in TraitData).
  // Engine-automatic: no SE slot consumed, no attacker choice required.
  //
  // EXTENSION: downstream modules add entries during setup:
  //   CONFIG.MYTHRAS.ammoTraits.explosiveRound = { key: 'explosiveRound', ... };
  ammoTraits: {
    broadhead: {
      key:          'broadhead',
      label:        'Broadhead',
      description:  'On any hit that penetrates armour, automatically triggers Bleed. Defender rolls Endurance to resist as normal. No Special Effect slot required.',
      engineEffect: true
    },
    bodkin: {
      key:          'bodkin',
      label:        'Bodkin',
      description:  'Reduces effective armour AP at the hit location by ceil(weaponBaseMax / 2) before damage is applied. AP cannot be reduced below 0. No Special Effect slot required.',
      engineEffect: true
    },
    armourPiercing: {
      key:          'armourPiercing',
      label:        'Armour Piercing',
      description:  'Reduces effective armour AP at the hit location by ceil(weaponBaseMax / 2) before damage is applied. AP cannot be reduced below 0. No Special Effect slot required.',
      engineEffect: true
    },
    stunRound: {
      key:          'stunRound',
      label:        'Stun Round',
      description:  'On any hit, automatically triggers Stun Location. The defender rolls Endurance to resist as normal. The round deals no Hit Point damage — the stun duration equals the damage roll. No Special Effect slot required.',
      engineEffect: true
    }
  },

  // -----------------------------------------------------------------------
  // CREATURE TRAITS
  // The 37 canonical creature traits from Mythras Imperative pp.76-79.
  //
  // Same shape as weaponTraits. engineEffect: true = the trait has a
  // mechanical effect the engine or sheet can automate. false = narrative
  // reference only (the GM adjudicates).
  //
  // EXTENSION: modules add entries during setup:
  //   CONFIG.MYTHRAS.creatureTraits.superStrength = { key: 'superStrength', ... };
  //
  // NOTE: Immunity is parameterised in the rules (e.g. Immunity (Fire)).
  // The key 'immunity' is the base registration. The param is stored
  // per-creature as a separate field — this is a creature schema decision
  // deferred until the creature sheet and MEG importer work begins.
  // -----------------------------------------------------------------------

  creatureTraits: {
    adhering: {
      key:          'adhering',
      label:        'Adhering',
      description:  'Moves freely on vertical surfaces and ceilings at half Movement rate.',
      engineEffect: true
    },
    aquatic: {
      key:          'aquatic',
      label:        'Aquatic',
      description:  'Breathes water. If removed from water and breathing organs dry out, suffocates after CON minutes.',
      engineEffect: true
    },
    bloodSense: {
      key:          'bloodSense',
      label:        'Blood Sense',
      description:  'Detects blood over great distances — up to 1d6+6 kilometres.',
      engineEffect: false
    },
    breatheFlame: {
      key:          'breatheFlame',
      label:        'Breathe Flame',
      description:  'Breathes flame in a cone stretching CON metres, width one quarter CON. Fire damage to all hit locations; Evade halves.',
      engineEffect: true
    },
    camouflaged: {
      key:          'camouflaged',
      label:        'Camouflaged',
      description:  'Naturally camouflaged, granting a bonus to Stealth or making visual detection harder.',
      engineEffect: false
    },
    characteristicDrain: {
      key:          'characteristicDrain',
      label:        'Characteristic Drain',
      description:  'Can drain temporary Characteristic points from attack targets. Details vary by creature.',
      engineEffect: true
    },
    coldBlooded: {
      key:          'coldBlooded',
      label:        'Cold-Blooded',
      description:  'Eats infrequently. Below 15°C: –6 Initiative, –1 Combat Action. Below 5°C: catatonic.',
      engineEffect: true
    },
    darkSight: {
      key:          'darkSight',
      label:        'Dark Sight',
      description:  'Sees normally in complete darkness.',
      engineEffect: true
    },
    deathSense: {
      key:          'deathSense',
      label:        'Death Sense',
      description:  'Senses death of living things and dead flesh within half INT kilometres.',
      engineEffect: false
    },
    diseaseImmunity: {
      key:          'diseaseImmunity',
      label:        'Disease Immunity',
      description:  'Immune to all diseases. Automatic for creatures without SIZ.',
      engineEffect: false
    },
    divingStrike: {
      key:          'divingStrike',
      label:        'Diving Strike',
      description:  'Charges from air or water. Increases attack Size and Damage Modifier by one step each. Once per round.',
      engineEffect: true
    },
    earthSense: {
      key:          'earthSense',
      label:        'Earth Sense',
      description:  'Senses vibration and air pressure underground. Fights without penalty within INT metres. Halved above ground.',
      engineEffect: true
    },
    echolocation: {
      key:          'echolocation',
      label:        'Echolocation',
      description:  'Senses the environment through sonic waves. Stealth against this creature is two grades harder.',
      engineEffect: true
    },
    engulfing: {
      key:          'engulfing',
      label:        'Engulfing',
      description:  'Can swallow targets up to half its SIZ whole. The victim suffers bite damage then suffocation.',
      engineEffect: true
    },
    flying: {
      key:          'flying',
      label:        'Flying',
      description:  'Auto-succeeds at routine flight. May substitute Fly skill (STR+DEX base) for Evade whilst aloft.',
      engineEffect: true
    },
    formidableNaturalWeapons: {
      key:          'formidableNaturalWeapons',
      label:        'Formidable Natural Weapons',
      description:  'Can actively parry with natural weapons such as horns, chitin, or bone. Without this, creatures rely on armour or Evade.',
      engineEffect: true
    },
    frenzy: {
      key:          'frenzy',
      label:        'Frenzy',
      description:  'When wounded: Willpower roll or enter frenzy for CON rounds. Attack only; no parry or evade; immune to pain and mental control. Exhausted afterwards.',
      engineEffect: true
    },
    gazeAttack: {
      key:          'gazeAttack',
      label:        'Gaze Attack',
      description:  'Active (costs an AP) or passive (affects anyone looking) gaze attack. Effect varies by creature.',
      engineEffect: true
    },
    grappler: {
      key:          'grappler',
      label:        'Grappler',
      description:  'On a successful strike, immediately seizes the opponent. If parried, gains Grip or Pin Weapon instead. Uses Brawn to resist escape.',
      engineEffect: true
    },
    holdBreath: {
      key:          'holdBreath',
      label:        'Hold Breath',
      description:  'Holds breath for CON minutes (passive activity) or half CON minutes (active combat).',
      engineEffect: false
    },
    immunity: {
      key:          'immunity',
      label:        'Immunity',
      description:  'Immune to one damage type (cold, fire, iron, etc.). The specific immunity is specified per creature instance.',
      engineEffect: true
    },
    intimidate: {
      key:          'intimidate',
      label:        'Intimidate',
      description:  'Opponents make a Willpower roll: success = hold ground, failure = retreat for one round, fumble = flee, critical = immune for the encounter.',
      engineEffect: true
    },
    leaper: {
      key:          'leaper',
      label:        'Leaper',
      description:  'Combines a leaping attack with a natural weapon. Winning the opposed roll automatically inflicts damage (only Passive Blocking defends).',
      engineEffect: true
    },
    lifeSense: {
      key:          'lifeSense',
      label:        'Life Sense',
      description:  'Determines vitality by touch. Aware of living beings within Willpower skill metres.',
      engineEffect: true
    },
    magicSense: {
      key:          'magicSense',
      label:        'Magic Sense',
      description:  'Detects magical emanations. Touch plus a Perception roll reveals magic points, enchantments, and active spells.',
      engineEffect: true
    },
    multiHeaded: {
      key:          'multiHeaded',
      label:        'Multi-Headed',
      description:  'Gains one extra Combat Action per additional head. Lost as heads are incapacitated. Individual saves against mental spells per head.',
      engineEffect: true
    },
    multiLimbed: {
      key:          'multiLimbed',
      label:        'Multi-Limbed',
      description:  'Gains one extra Combat Action per extra pair of combat-capable limbs. Locomotion-only limbs do not count.',
      engineEffect: true
    },
    nightSight: {
      key:          'nightSight',
      label:        'Night Sight',
      description:  'Treats partial darkness as illuminated and total darkness as partial darkness.',
      engineEffect: true
    },
    poisonImmunity: {
      key:          'poisonImmunity',
      label:        'Poison Immunity',
      description:  'Immune to all poisons. Automatic for creatures without SIZ.',
      engineEffect: false
    },
    regeneration: {
      key:          'regeneration',
      label:        'Regeneration',
      description:  'Regenerates lost Hit Points each round. Rate varies by creature. Does not replace severed limbs. Severance of a vital location still kills.',
      engineEffect: true
    },
    swimmer: {
      key:          'swimmer',
      label:        'Swimmer',
      description:  'Auto-succeeds at routine swimming. May substitute Swim skill for Athletics and Evade whilst in water.',
      engineEffect: true
    },
    terrifying: {
      key:          'terrifying',
      label:        'Terrifying',
      description:  'Viewers make a Willpower roll: critical = unhindered, success = shaken for one round, failure = flee, fumble = unconscious.',
      engineEffect: true
    },
    trample: {
      key:          'trample',
      label:        'Trample',
      description:  'Tramples beings of half SIZ or less using Athletics. Damage equals twice the base Damage Modifier, Size one step larger. Free Action if charging.',
      engineEffect: true
    },
    undead: {
      key:          'undead',
      label:        'Undead',
      description:  'Immune to Fatigue and Serious Wound effects. A Major Wound to a bound location (head or chest) destroys the creature outright.',
      engineEffect: true
    },
    vampiric: {
      key:          'vampiric',
      label:        'Vampiric',
      description:  "Drains blood via bite, increasing the victim's Fatigue levels. Rate varies by creature.",
      engineEffect: true
    },
    venomous: {
      key:          'venomous',
      label:        'Venomous',
      description:  'Possesses a venomous bite, sting, or other delivery mechanism. Poison details specified per creature.',
      engineEffect: true
    },
    wingBuffet: {
      key:          'wingBuffet',
      label:        'Wing Buffet',
      description:  "Damages opponents within 3 metres by beating wings. Costs an Attack Action. Damage equals the creature's Damage Modifier.",
      engineEffect: true
    }
  },


  // -----------------------------------------------------------------------
  // VEHICLE TRAITS
  // The 27 canonical vehicle traits from Mythras Imperative pp.56-59.
  //
  // Same shape as weaponTraits. engineEffect: true = the trait has a
  // mechanical effect the engine or sheet can automate. false = narrative
  // reference / GM adjudication only.
  //
  // EXTENSION: modules add entries during setup:
  //   CONFIG.MYTHRAS.vehicleTraits.cloakingDevice = { key: 'cloakingDevice', ... };
  // -----------------------------------------------------------------------

  vehicleTraits: {
    airborne:             { key: 'airborne',             label: 'Airborne',             description: 'The vehicle is capable of atmospheric flight.',                                                                                    engineEffect: false },
    allTerrain:           { key: 'allTerrain',           label: 'All Terrain',           description: 'Traverses inhospitable, difficult, and steep terrain. Ground vehicles only.',                                                      engineEffect: false },
    burrowing:            { key: 'burrowing',            label: 'Burrowing',             description: 'Designed to tunnel through ground to a max depth of Hull Rating × 5 metres.',                                                     engineEffect: false },
    camouflaged:          { key: 'camouflaged',          label: 'Camouflaged',           description: 'Camouflage paint or mimetic sensors. Visual detection is one grade harder.',                                                       engineEffect: true  },
    cargo:                { key: 'cargo',                label: 'Cargo',                 description: 'Designed to haul cargo; speed is two steps lower when laden.',                                                                    engineEffect: false },
    carrier:              { key: 'carrier',              label: 'Carrier',               description: 'Carries smaller craft. Must be at least Enormous. Capacity = Structure rating.',                                                  engineEffect: false },
    construction:         { key: 'construction',         label: 'Construction',          description: 'Equipped for heavy construction. All Terrain included; speed two steps lower.',                                                   engineEffect: false },
    empResistant:         { key: 'empResistant',         label: 'EMP Resistant',         description: 'Shielded against electromagnetic pulse attacks.',                                                                                  engineEffect: false },
    enhancedPerformance:  { key: 'enhancedPerformance',  label: 'Enhanced Performance',  description: 'Speed rating is one step higher than the maximum for its size.',                                                                  engineEffect: true  },
    ejectorSeat:          { key: 'ejectorSeat',          label: 'Ejector Seat',          description: 'Propels occupants clear in emergencies; deploys parachute.',                                                                      engineEffect: false },
    ftl:                  { key: 'ftl',                  label: 'FTL',                   description: 'Spacecraft only. Faster-than-light engine with its own parsec-travel Speed rating.',                                             engineEffect: false },
    groundVehicle:        { key: 'groundVehicle',        label: 'Ground Vehicle',        description: 'Capable of ground travel. Inherent for all land-based vehicles.',                                                                 engineEffect: false },
    hover:                { key: 'hover',                label: 'Hover',                 description: 'Hovers above ground via air cushion or anti-gravity repulsor.',                                                                   engineEffect: false },
    luxurious:            { key: 'luxurious',            label: 'Luxurious',             description: 'Designed to carry passengers in luxury; excess space devoted to amenities.',                                                      engineEffect: false },
    rails:                { key: 'rails',                label: 'Rails',                 description: 'Uses a rail system. Speed three steps higher than size allows, but restricted to rails.',                                         engineEffect: false },
    resilient:            { key: 'resilient',            label: 'Resilient',             description: 'Each system withstands one extra hit beyond the Size norm. Stackable.',                                                           engineEffect: true  },
    seaborne:             { key: 'seaborne',             label: 'Seaborne',              description: 'The vehicle is buoyant on water.',                                                                                                 engineEffect: false },
    spacecraft:           { key: 'spacecraft',           label: 'Spacecraft',            description: 'Sealed against vacuum and cosmic radiation; capable of atmospheric re-entry.',                                                    engineEffect: false },
    stealth:              { key: 'stealth',              label: 'Stealth',               description: 'Aircraft only. Electronic sensor detection is one grade harder.',                                                                 engineEffect: true  },
    submersible:          { key: 'submersible',          label: 'Submersible',           description: 'Submerges to Hull Rating × 10 m operating depth; collapse depth is 1.5×.',                                                      engineEffect: false },
    superiorHandling:     { key: 'superiorHandling',     label: 'Superior Handling',     description: 'Handling is rated as Easy.',                                                                                                      engineEffect: true  },
    surveillanceSuite:    { key: 'surveillanceSuite',    label: 'Surveillance Suite',    description: 'Onboard comms interception and smartphone-signal capture within 100 metres.',                                                    engineEffect: false },
    tough:                { key: 'tough',                label: 'Tough',                 description: 'Civilian: draws Military hull and maximum Structure. Military: draws from next row down.',                                        engineEffect: false },
    tractorBeam:          { key: 'tractorBeam',          label: 'Tractor Beam',          description: 'Spacecraft only. Ensnares vehicles up to two hull-size steps smaller.',                                                           engineEffect: false },
    vtol:                 { key: 'vtol',                 label: 'VTOL',                  description: 'Vertical take-off and landing. Inherent for helicopters; applied to fixed-wing via aligned thrusters.',                          engineEffect: false },
    walker:               { key: 'walker',               label: 'Walker',                description: 'Articulated legs. Capped at Gentle speed regardless of size.',                                                                   engineEffect: false },
    weaponised:           { key: 'weaponised',           label: 'Weaponised',            description: 'Adapted for hard points, ammunition storage, and weapons control systems.',                                                       engineEffect: false }
  },

  // -----------------------------------------------------------------------
  // SKILL CATEGORIES
  // -----------------------------------------------------------------------

  skillCategories: {
    standard:     { label: 'MYTHRAS.SkillCategoryStandard'     },
    professional: { label: 'MYTHRAS.SkillCategoryProfessional' }
  }

};
