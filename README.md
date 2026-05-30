# Mythras Imperative for Foundry VTT

A Foundry VTT game system implementing the **Mythras Imperative** ruleset by The Design Mechanism.

---

## About This Project

This system was built for personal use as a fully-featured implementation of Mythras Imperative in Foundry VTT v14. It is shared publicly in the spirit of transparency and community, not as a supported product. See [Status & Testing](#status--testing) and [A Note on How This Was Built](#a-note-on-how-this-was-built) before using it in your own games.

---

## Compatibility

| Requirement | Version |
|---|---|
| Foundry VTT | v14 (ApplicationV2 architecture) |
| Foundry VTT v11/v12/v13 | ❌ Not supported |
| Mythras Imperative rules | July 2023 edition (ORC licence) |

---

## Features

### Core Rules
- Full character sheet — characteristics, derived attributes, hit locations, skills, passions, combat styles, weapons, armour, gear
- Standard and professional skill support with base formula derivation
- Hero Level system (Normal, Pulp Hero, Paragon) with advantage selection
- Fatigue grades, conditions, and wound tracking
- Currency management

### Combat Engine
A custom combat resolution engine (~10,600 lines) handling the full Mythras combat sequence:
- Full melee combat flow — attack, parry, evade, success level resolution, differential table
- Hit location determination and damage application with AP tracking
- All melee Special Effects (Bleed, Impale, Stun Location, Choose Location, Grip, Disarm, etc.)
- Ranged combat — range bands, range penalties, cover
- Firearm rules — semi-auto, burst fire, full auto, ammunition tracking
- Firearm Special Effects (Weapon Malfunction, Duck Back, Rapid Reload, Marksman, etc.)
- GM Mode — GM controls both sides of combat from a single dialog
- Combat socket — player defender dialog for multi-client sessions

### Actor Types
- **Character** — full PC sheet
- **NPC** — streamlined sheet for non-player characters
- **Creature** — creature sheet with hit location table, MEG JSON import
- **Merchant** — shop and container modes, buy/trade-in workflow
- **Vehicle** — vehicle combat, system damage, crew management, weapon systems

### Item Types
Skill, Weapon, Armour, Gear, Combat Style, Passion, Ability, Hit Location, Trait, Currency

### Compendiums
- Standard skills (22 entries)
- Professional skills
- Weapons (melee and ranged)
- Armour
- Combat style traits
- Weapon traits
- Creature traits
- Vehicle traits
- Vehicle weapons

### Creature Import
Creatures can be imported directly from the [Mythras Encounter Generator (MEG)](https://mythras.skoll.xyz/) via JSON export. The import button is in the Actors sidebar footer (GM only). All characteristics, hit locations, skills, weapons, and combat styles are populated automatically.

---

## Installation

This system is **not listed in the Foundry package registry** and must be installed manually.

1. Download the latest release zip from the [Releases](../../releases) page
2. In Foundry VTT, go to **Game Systems → Install System**
3. Click **Install from Manifest URL** (or use the zip install option if available)
4. Alternatively, unzip directly into your Foundry `Data/systems/` folder as `mythras-imperative/`
5. Restart Foundry

---

## Status & Testing

**This is personal-use software shared publicly, not a polished community release.**

Testing has been done feature-by-feature by the author in a live Foundry v14 instance — every build is tested immediately after implementation, which provides solid integration coverage for each feature as it lands. What it does not provide:

- Broad testing across different operating systems, browsers, and hosting setups
- Testing with large or diverse world configurations
- Community stress-testing with varied use cases

A Jest unit test suite covers the pure deterministic combat math functions (success level resolution, differential table, parry arithmetic, wound thresholds, fatigue grades, range band lookups). These functions are extracted into standalone utility modules and run without any Foundry mocking.

**In short:** the system works well for the author's use case and has been exercised thoroughly through active play. Your mileage may vary, particularly in edge cases and non-standard configurations. Bug reports are welcome.

---

## A Note on How This Was Built

This system was designed and directed by the author and built in collaboration with **Claude** (Anthropic's AI assistant). Every design decision — what to build, how game mechanics should be implemented, what the rules mean, what the UI should look like — was made by the author. Claude handled the implementation: writing code, debugging, and iterating on each feature based on the author's direction and test feedback.

This is disclosed upfront because transparency matters. The codebase is the result of hundreds of tight design-build-test cycles over many sessions. The author has read, reviewed, and tested every feature. The AI-assisted workflow made it possible to implement a system of this scope (~10,600 lines of combat engine alone) alongside real life.

If you have opinions about AI-assisted development, that's fair. The disclosure is here so you can make an informed decision about whether to use this system.

---

## Planned Features

- Creature traits wiring (Formidable Natural Weapons, Grappler, Frenzy, Intimidate, Terrifying)
- Breath weapon / cone attack system
- Poison / venom system
- Classic Fantasy Imperative module extension

---

## Relationship to Other Mythras Systems

A community Mythras system exists and is maintained by the broader Foundry community. This system was developed independently for personal use. The author is aware of the community system and has been in contact with its maintainer. No formal merge or coordination is in place — if that changes, it will be noted here.

---

## Documentation

- [COMBAT.md](COMBAT.md) — full guide to the combat system (automation levels, GM Mode, ranged combat, full auto, vehicle combat, Special Effects)
- [CHANGELOG.md](CHANGELOG.md) — version history
- [LEGAL.md](LEGAL.md) — ORC licence acknowledgement

## Licence

See [LICENCE.txt](LICENCE.txt) for terms covering this code.

See [LEGAL.md](LEGAL.md) for acknowledgement of the Mythras Imperative rules licence.

---

## Credits

- **Mythras Imperative** rules by The Design Mechanism — Pete Nash and Lawrence Whitaker
- System design and direction by the author
- Implementation assisted by Claude (Anthropic)
- Mythras Encounter Generator (MEG) by [Skoll](https://mythras.skoll.xyz/) — used for creature import
