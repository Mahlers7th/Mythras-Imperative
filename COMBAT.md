# Combat System Guide

This document covers how to use the Mythras Imperative combat engine in Foundry VTT. Read this before running your first session — the system has several modes and the setup choices affect how combat plays out at the table.

---

## Settings

Two world-level settings control how combat works. Both are found in **Game Settings → Configure Settings → System Settings**.

### Combat Automation Level

| Setting | What it does |
|---|---|
| **Manual** | Rolls the attack and posts a result to chat. No dialogs, no automatic damage. The GM reads the chat card and applies everything by hand. |
| **Semi-Automatic** | Full combat dialogs — attacker chooses weapon and action, defender chooses parry or evade, Special Effects are selected by the winner. Damage is rolled and shown but **not applied automatically** — the GM clicks a button to apply it. |
| **Full Automatic** | Same as Semi-Automatic but damage and wounds are applied to the actor automatically after Special Effects are chosen. No click-through required. |

Start with **Semi-Automatic** if you're new to the system. It gives you full control while showing you the whole flow. Move to Full Automatic once you're comfortable.

**Manual mode** is there if you want to use the system purely as a dice roller and handle all bookkeeping yourself.

### GM Mode

A toggle available in **Semi-Automatic** and **Full Automatic** only.

When **GM Mode is off** (default for multiplayer): the attacker's player sees the attacker dialog; when the attacker confirms, a socket message is sent to the defending player's client and their defender dialog opens there. Both players make their own choices.

When **GM Mode is on**: the defender's choices appear as an inline panel inside the attacker dialog. The GM picks both sides — the attacker's action and the defender's response — from a single window. No socket round-trip, no waiting for a player to respond.

**Use GM Mode for:**
- Running NPCs and creatures against each other
- Solo prep and testing
- Games where the GM controls all actors
- Any situation where you don't want to wait for a player's client to respond

**Turn GM Mode off for** live multiplayer sessions where players control their own characters and should make their own defence choices.

---

## Starting a Combat Exchange

### Standard Attack (Manual, Semi-Auto, or Full Auto)

1. **Select** your attacking token on the canvas
2. **Target** the defender — right-click the defender's token and choose Target, or use the target tool (crosshair) in the toolbar
3. **Open the attacker's character sheet** and go to the Combat tab
4. **Click the weapon** you want to attack with

The engine validates that a target is selected and that the weapon belongs to a combat style. If anything is missing it will notify you.

### What happens next depends on your automation level

**Manual mode:** The attack roll is made immediately and a chat card is posted. Read the result and apply damage by hand.

**Semi/Full Auto — attacker dialog opens:**

The attacker dialog shows:
- The selected weapon and its combat style
- Current action point cost
- Attack roll result (or a Roll button if not yet rolled)
- Available Special Effects if the attacker wins the exchange
- In GM Mode: an inline defender panel (see below)

---

## The Attacker Dialog

### Rolling the Attack

Click **Roll Attack** to make the d100 roll. The result shows your roll, your skill percentage, and the outcome (Critical, Success, Failure, Fumble).

### Choosing Special Effects

If the exchange result gives you Special Effect slots, a list of available effects appears. Select one per slot. Effects are filtered to what's valid for the weapon type and situation — you won't see ranged-only effects on a melee weapon.

### Confirming

Click **Confirm** to lock in your choices and proceed. In multiplayer (GM Mode off) this sends the exchange to the defender's client. In GM Mode it shows the inline defender panel.

---

## The Defender Dialog

### Multiplayer (GM Mode off)

The defending player sees a dialog on their screen showing:
- The incoming attack details (weapon, attacker, roll result)
- Available defence options: Parry or Evade (depending on what they have)
- Their combat styles and skills for parrying
- Their Evade skill

The defender rolls their chosen defence and confirms. The engine then resolves the full exchange.

### GM Mode (inline panel)

The defender panel appears at the bottom of the attacker dialog. The GM chooses the defence on behalf of the defending actor — same options, same rolls, just in one window.

---

## Ranged Combat

Ranged combat follows the same flow as melee with additional steps:

### Range Bands

When you click a ranged weapon, the engine checks the distance to the target token and determines the range band automatically:
- **Close** — within close range, no penalty
- **Effective** — standard range, no penalty
- **Long** — one difficulty grade harder
- **Extreme** — two difficulty grades harder
- **Out of range** — attack not permitted

The range band is shown in the attacker dialog.

### Firing Modes

Firearms and some ranged weapons support multiple firing modes. The attacker dialog shows the available modes for the weapon:

**Single shot** — one attack against one target, costs 1 round of ammunition.

**Burst fire** — three rounds fired at one target. Costs 3 rounds of ammunition. On a hit, rolls 1d3 hit locations and applies damage to each. Provides a bonus to hit. Special Effects are only available on the first hit of a burst.

**Full auto** — fires at multiple targets in sequence, or multiple hits on one target. See Full Auto below.

---

## Full Auto

Full auto sprays multiple targets (or the same target multiple times). 

1. **Select** your attacking token
2. **Target multiple tokens** — you can target as many as the weapon's cyclic rate allows
3. **Click the weapon** to open the attacker dialog
4. **Choose Full Auto** from the firing mode options
5. The engine runs a separate exchange against each target in sequence

**Important:** Special Effects are only available on the first target in a full auto spray. Subsequent targets are resolved without SE selection to keep the flow moving.

Ammunition is consumed per burst segment. The engine will warn you if you don't have enough ammunition.

---

## Vehicle Combat

### Crew Firing Vehicle Weapons

1. Open the **vehicle sheet** and go to the **Combat tab**
2. Ensure at least one crew member is assigned in the Crew roster (drag actor tokens onto the crew list)
3. **Target** the enemy vehicle or actor token
4. Click the **weapon** in the Weapon Systems section

If there are multiple crew members, a **crew picker dialog** opens — choose which crew member is operating the weapon. Then a **style picker** selects their combat style.

From there the normal combat engine runs, with the crew member's skills used for the attack.

### Vehicle as Defender (Flow B)

When a vehicle is the target of an attack the engine uses a simplified resolution path:
- No parry or evade — vehicles use their armour rating directly
- Damage is applied to the specific system component hit (determined by the 1d10 location roll shown on the Combat tab reference table)
- Structure points are tracked separately from individual system HP

---

## Chat Cards

Every exchange produces a chat card showing:
- Attacker and defender names
- Rolls and outcomes
- Special Effects chosen
- Hit location and damage rolled
- Wound result (in Semi/Full Auto)

In **Semi-Automatic** mode, the damage card includes an **Apply Damage** button. Click it to write the damage to the actor. Until you click it, the actor's HP is unchanged.

In **Full Automatic** mode, damage is applied automatically — no button needed.

---

## Special Effects

Special Effects are chosen by the winner(s) of the differential roll. The number of SEs available depends on the margin of victory:

| Margin | SEs |
|---|---|
| Critical vs Failure | 2 attacker SEs |
| Critical vs Fumble | 3 attacker SEs |
| Success vs Failure | 1 attacker SE |
| etc. | (see rulebook p.25) |

Some SEs trigger follow-up dialogs:
- **Bash Obstacle** — rolls the obstacle's AP against your damage
- **Bleed** — confirms the location and starts the bleed timer
- **Choose Location** — lets you pick the hit location instead of rolling
- **Disarm** — rolls your Brawn vs their Brawn
- **Grip** — initiates a grapple; follow-up options appear on subsequent turns
- **Impale** — prompts whether to yank the weapon free
- **Pin Weapon** — locks the defender's weapon
- **Stun Location** — applies the stun effect to the hit location
- **Trip Opponent** — rolls opposed Athletics

---

## Action Points

Action Points are tracked in the attributes bar at the top of the character sheet. Each combat exchange costs 1 AP for the attacker (and 1 for the defender if they parry or evade).

AP are not automatically deducted — the GM manages AP expenditure during the combat round using the **±** buttons on the sheet. At the start of each new round, reset AP to the actor's maximum using the reset button.

---

## Fatigue

Fatigue grades are tracked in the attributes bar. The current grade applies a penalty modifier to all skill rolls automatically — the engine reads the fatigue grade and adjusts difficulty before rolling.

Grades: Fresh → Winded → Tired → Wearied → Exhausted → Debilitating → Incapacitated

Change the fatigue grade using the fatigue selector on the sheet. The combat engine applies the appropriate skill grade penalty automatically.

---

## Quick Reference — Combat Checklist

**Before combat:**
- [ ] Set Combat Automation Level in System Settings
- [ ] Decide whether to use GM Mode
- [ ] Make sure all combatants have tokens on the canvas

**Each exchange:**
- [ ] Select attacker token
- [ ] Target defender token (right-click → Target)
- [ ] Click weapon on Combat tab
- [ ] Roll attack in attacker dialog
- [ ] Defender responds (their dialog or inline if GM Mode)
- [ ] Choose Special Effects if any
- [ ] Apply damage (Semi-Auto: defending player clicks Apply on chat card; Full Auto: automatic)
- [ ] Action Points deducted automatically

**Each round:**
- [ ] Action Points reset automatically by the combat tracker
- [ ] Check fatigue if relevant
