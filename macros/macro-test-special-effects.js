// ============================================================
// Mythras Imperative — Special Effect Test Macro  v1.4.215
// ============================================================
// Select exactly two tokens before running: attacker first,
// then shift-click the defender (or target the defender).
// Presents a dialog to configure the full combat context,
// pre-select SEs, then fires the resolution engine directly.
// ============================================================

const CE = CONFIG.MYTHRAS?.CombatEngine;
if (!CE) return ui.notifications.error('CombatEngine not found.');

// ── Resolve attacker and defender ────────────────────────────
const selected = canvas.tokens.controlled;
const targeted = Array.from(game.user.targets ?? []);

let attacker, defender;

if (selected.length === 1 && targeted.length === 1) {
  attacker = selected[0].actor;
  defender = targeted[0].actor;
} else if (selected.length === 2) {
  attacker = selected[0].actor;
  defender = selected[1].actor;
} else {
  return ui.notifications.warn(
    'Select the attacker token and target (or select) the defender token before running.'
  );
}

if (!attacker || !defender) return ui.notifications.warn('Could not resolve actors from tokens.');

// ── Build weapon options from attacker ───────────────────────
const weapons = Array.from(attacker.items).filter(i => i.type === 'weapon');
if (weapons.length === 0) return ui.notifications.warn(`${attacker.name} has no weapons.`);

const weaponOptions = weapons
  .map((w, i) => `<option value="${w.id}" ${i === 0 ? 'selected' : ''}>${w.name} (${w.system.damage})</option>`)
  .join('');

// ── Build weapon options from defender (for defenceWeapon) ───
const defenderWeapons = Array.from(defender.items).filter(i => i.type === 'weapon');
const defWeaponOptions = [
  '<option value="">— None —</option>',
  ...defenderWeapons.map(w => `<option value="${w.id}">${w.name}</option>`)
].join('');

// ── Build SE checkboxes ───────────────────────────────────────
const ses = CONFIG.MYTHRAS?.specialEffects ?? [];

const attackerSEs = ses.filter(se => se.who === 'attacker' || se.who === 'both');
const defenderSEs = ses.filter(se => se.who === 'defender' || se.who === 'both');

const STACKABLE_SES = new Set(['maximiseDamage', 'bypassArmour', 'rapidReload', 'scarFoe', 'pinDown']);

const seLabel = (se) => {
  const key = se.label;
  const localised = game.i18n.localize(key);
  if (localised !== key) return localised;
  return key.replace('MYTHRAS.SE', '').replace(/([A-Z])/g, ' $1').trim();
};

const seCheckbox = (se, side) => {
  const stackable = STACKABLE_SES.has(se.id);
  const restriction = se.restriction ? `<span class="mi-se-restriction">(${se.restriction})</span>` : '';
  if (stackable) {
    return `
  <label class="mi-se-check" title="${se.restriction ?? ''}">
    <input type="number" name="se-${side}-stack" data-id="${se.id}" value="0" min="0" max="4" style="width:36px;flex-shrink:0;">
    <span>${seLabel(se)} <em style="opacity:0.5;font-size:0.85em">stackable</em></span>
    ${restriction}
  </label>`;
  }
  return `
  <label class="mi-se-check" title="${se.restriction ?? ''}">
    <input type="checkbox" name="se-${side}" value="${se.id}">
    <span>${seLabel(se)}</span>
    ${restriction}
  </label>`;
};

const attackerSEHtml = attackerSEs.map(se => seCheckbox(se, 'attacker')).join('');
const defenderSEHtml = defenderSEs.map(se => seCheckbox(se, 'defender')).join('');

const content = `
  <style>
    .mi-test-se { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 0.88em; }
    .mi-test-se label { display: block; font-weight: bold; margin: 8px 0 4px; }
    .mi-test-se select, .mi-test-se input[type=number] { width: 100%; }
    .mi-se-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 4px; }
    .mi-se-col h4 { margin: 0 0 6px; font-size: 0.9em; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 4px; }
    .mi-se-check { display: flex; align-items: baseline; gap: 4px; margin: 3px 0; }
    .mi-se-check input { margin: 0; flex-shrink: 0; }
    .mi-se-restriction { opacity: 0.5; font-size: 0.8em; margin-left: auto; }
    .mi-full-row { grid-column: 1 / -1; }
  </style>

  <div class="mi-test-se">
    <div>
      <label>Attacker</label>
      <div>${attacker.name}</div>
    </div>
    <div>
      <label>Defender</label>
      <div>${defender.name}</div>
    </div>

    <div>
      <label>Attacker Weapon</label>
      <select id="se-weapon">${weaponOptions}</select>
    </div>
    <div>
      <label>Defender Weapon</label>
      <select id="se-def-weapon">${defWeaponOptions}</select>
    </div>

    <div>
      <label>Attack Outcome</label>
      <select id="se-atk-outcome">
        <option value="critical">Critical</option>
        <option value="success" selected>Success</option>
        <option value="failure">Failure</option>
        <option value="fumble">Fumble</option>
      </select>
    </div>
    <div>
      <label>Defence Outcome</label>
      <select id="se-def-outcome">
        <option value="success" selected>Success</option>
        <option value="critical">Critical</option>
        <option value="failure">Failure</option>
        <option value="fumble">Fumble</option>
        <option value="none">None</option>
      </select>
    </div>

    <div>
      <label>Defence Type</label>
      <select id="se-def-type">
        <option value="none">Don't Defend</option>
        <option value="parry" selected>Parry</option>
        <option value="evade">Evade</option>
      </select>
    </div>
    <div></div>

    <div>
      <label>Attack Roll (d100)</label>
      <input id="se-atk-roll" type="number" min="1" max="100" value="99">
    </div>
    <div>
      <label>Defence Roll (d100)</label>
      <input id="se-def-roll" type="number" min="1" max="100" value="30">
    </div>

    <div>
      <label>Attacker Skill %</label>
      <input id="se-atk-skill" type="number" min="1" max="200" value="60">
    </div>
    <div>
      <label>Defender Skill %</label>
      <input id="se-def-skill" type="number" min="1" max="200" value="50">
    </div>

    <div class="mi-full-row">
      <label>Special Effects</label>
      <div class="mi-se-cols">
        <div class="mi-se-col">
          <h4>Attacker SEs</h4>
          ${attackerSEHtml}
        </div>
        <div class="mi-se-col">
          <h4>Defender SEs</h4>
          ${defenderSEHtml}
        </div>
      </div>
    </div>
  </div>`;

new Dialog({
  title: 'Test: Special Effects',
  content,
  buttons: {
    run: {
      label: 'Fire Resolution',
      callback: async (html) => {
        const weaponId      = html.find('#se-weapon').val();
        const defWeaponId   = html.find('#se-def-weapon').val();
        const atkOutcome    = html.find('#se-atk-outcome').val();
        const defType       = html.find('#se-def-type').val();
        const defOutcome    = html.find('#se-def-outcome').val();
        const atkRoll       = parseInt(html.find('#se-atk-roll').val())   || 99;
        const defRoll       = parseInt(html.find('#se-def-roll').val())   || 30;
        const atkSkill      = parseInt(html.find('#se-atk-skill').val())  || 60;
        const defSkill      = parseInt(html.find('#se-def-skill').val())  || 50;

        const weapon    = attacker.items.get(weaponId);
        if (!weapon) return ui.notifications.warn('Weapon not found.');

        const defWeapon = defWeaponId
          ? (defender.items.get(defWeaponId) ?? null)
          : (defType === 'parry'
              ? (Array.from(defender.items).find(i => i.type === 'weapon') ?? null)
              : null);
        const defStyle = defType === 'parry'
          ? (Array.from(defender.items).find(i => i.type === 'combat-style') ?? null)
          : null;

        // Collect chosen SEs from both columns.
        // Non-stackable SEs: read checked checkboxes (push id once each).
        // Stackable SEs: read number inputs (push id N times for stack of N).
        const chosenSEs = [];
        html.find('input[name="se-attacker"]:checked, input[name="se-defender"]:checked')
          .each((_, el) => chosenSEs.push(el.value));
        html.find('input[name="se-attacker-stack"], input[name="se-defender-stack"]')
          .each((_, el) => {
            const count = parseInt(el.value, 10) || 0;
            const id    = el.dataset.id;
            for (let i = 0; i < count; i++) chosenSEs.push(id);
          });

        // ── Derive seWinner from the differential table ───────────────────────
        const differential = CE.resolveDifferential(atkOutcome, defType !== 'none' ? defOutcome : 'none');
        const seWinner = differential.seWinner;

        // Build ctx — matches the full shape from _buildContext
        const ctx = {
          attacker,
          defender,
          weapon,
          attackerStyle:        null,
          attackerStyles:       [],
          styleTraits:          [],
          difficulty:           'standard',
          modifiers:            0,
          bonusSpecialEffects:  [],
          isCharge:             false,
          isBraced:             false,
          defenderSurprised:    false,
          willBeProne:          false,

          defenceType:          defType,
          defenceWeapon:        defWeapon,
          defenceStyle:         defStyle,
          defenderSkillTotal:   defSkill,
          attackerSkillTotal:   atkSkill,
          wardedLocations:      [],

          attackResult:         atkRoll,
          defenceResult:        defType !== 'none' ? defRoll : null,
          attackOutcome:        atkOutcome,
          defenceOutcome:       defType !== 'none' ? defOutcome : 'none',

          seWinner,
          seCount:              chosenSEs.length,
          chosenSpecialEffects: chosenSEs,

          hitLocationId:        null,
          hitLocationLabel:     null,
          hitLocationRoll:      null,
          damageRoll:           null,
          rawDamage:            null,
          damageAfterParry:     null,
          damageAfterArmour:    null,
          parryReduction:       null,
          woundLevel:           null,
          enduranceRequired:    false,
          newCurrent:           null,
          maxHp:                null,
          locationType:         null,
        };

        ui.notifications.info(
          `Firing: ${atkOutcome} attack, seWinner: ${seWinner}, SEs: ${chosenSEs.join(', ') || 'none'}…`
        );

        // Post the outcome card
        const chatMsg = await CE._postOutcomeCard(ctx);

        const attackerScored = atkOutcome === 'critical' || atkOutcome === 'success';
        const registry = CONFIG.MYTHRAS.specialEffects;

        if (attackerScored) {
          if (CE.automationLevel === 'full') {
            await CE._resolveFullAutoDamage(ctx, chatMsg);
          } else {
            // Semi/Manual: Roll Hit Location + Roll Damage buttons appear on the card.
            // The macro can't click those buttons, so we fire SEs directly here.

            // ── attackerScored-phase SEs — fire immediately, no damage needed ──
            // Registry-driven: matches _afterDefenceResolved exactly.
            const seen = new Set();
            for (const id of chosenSEs) {
              if (seen.has(id)) continue;
              seen.add(id);
              const def = registry.find(e => e.id === id);
              if (!def || def.phase !== 'attackerScored' || !def.resolver) continue;
              await CE[def.resolver](ctx);
            }

            // ── Marksman: fires at hit-location time in live play ─────────────
            // In the macro we roll a real d20 and resolve the location for testing.
            if (chosenSEs.includes('marksman')) {
              const d20  = Math.ceil(Math.random() * 20);
              const locs = Array.from(defender.items).filter(i => i.type === 'hit-location')
                             .sort((a, b) => (a.system.rangeMin ?? 0) - (b.system.rangeMin ?? 0));
              let testLocId = null, testLocLabel = null;
              if (locs.length > 0) {
                const locItem  = locs.find(l => d20 >= (l.system.rangeMin ?? 1) && d20 <= (l.system.rangeMax ?? 20)) ?? locs[locs.length - 1];
                testLocId    = locItem.id;
                testLocLabel = locItem.name;
              } else {
                const table = CONFIG.MYTHRAS?.hitLocations?.humanoid ?? [];
                const entry = table.find(e => d20 >= e.range[0] && d20 <= e.range[1]) ?? table[table.length - 1];
                testLocLabel = entry ? game.i18n.localize(entry.label) : 'Chest';
              }
              ui.notifications.info(`Marksman test: rolled ${d20} → ${testLocLabel}`);
              await CE._resolveMarksman(defender, testLocId, testLocLabel, attacker.name);
            }

            // ── Damage Weapon: requires a real damage roll ────────────────────
            // In live play this fires via the dedicated button with a rolled value.
            // In the macro we roll the formula then call the resolver directly.
            // Do NOT route through _resolveOpposedSEs — rawDamage must be set.
            if (chosenSEs.includes('damageWeapon')) {
              const dmMod    = attacker.system.attributes?.damageModifier ?? '';
              const applyMod = weapon.system.damageModApplies ?? true;
              const formula  = (applyMod && dmMod && dmMod !== '+0' && dmMod !== '0')
                ? `${weapon.system.damage}${dmMod}` : weapon.system.damage;
              const dmgRoll  = new Roll(formula);
              await dmgRoll.evaluate();
              await CE._resolveDamageWeapon({ ...ctx, rawDamage: dmgRoll.total });
            }

            // ── All other opposed-phase SEs that can resolve without a damage value ──
            // Registry-driven: fire any 'opposed'-phase SE that isn't damageWeapon
            // (which needs its own roll above). requiresDamage SEs pass damage=0 and
            // gate themselves inside the dispatcher.
            // NOTE: in live semi-auto play these fire from the Apply Damage button
            // handler, not here. The macro fires them directly since it cannot click
            // that button. This means damageWeapon must be excluded to avoid a second
            // call (already handled above).
            const sesForDirectFire = chosenSEs.filter(id => id !== 'damageWeapon');
            const hasOpposedSE = sesForDirectFire.some(
              id => registry.find(e => e.id === id)?.phase === 'opposed'
            );
            if (hasOpposedSE) {
              await CE._resolveOpposedSEs({ ...ctx, chosenSpecialEffects: sesForDirectFire }, 0);
            }
          }
        } else {
          // Attacker did NOT score — fire defender-won opposed SEs directly.
          // Registry-driven: matches _afterDefenceResolved exactly.
          if (chosenSEs.length > 0) {
            const hasOpposedSE = chosenSEs.some(
              id => registry.find(e => e.id === id)?.phase === 'opposed'
            );
            if (hasOpposedSE) {
              await CE._resolveOpposedSEs(ctx, 0);
            }
          }
        }
      }
    },
    cancel: { label: 'Cancel' }
  },
  default: 'run',
  width: 620
}).render(true);
