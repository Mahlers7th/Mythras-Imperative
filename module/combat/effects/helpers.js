/**
 * module/combat/effects/helpers.js
 *
 * Shared utilities used by SE resolver functions.
 * These are Foundry-dependent helpers — they use Dialog, Hooks, canvas,
 * ChatMessage, and CONFIG. They cannot run in Jest without mocks.
 *
 * Pure math (determineOutcome, resolveOpposedRoll, woundLevel, etc.) lives
 * in module/utils/combat-math.js and IS testable without Foundry.
 */

import { resolveOpposedRoll } from '../../utils/combat-math.js';
import { getFatigueSkillGrade } from '../../utils/fatigue.js';

const NS = 'mythras-imperative';

// -------------------------------------------------------------------------
export function waitForCard(msgId, ms = 800) {
  if (!msgId) return Promise.resolve();
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    Hooks.once('renderChatMessage', (msg) => {
      if (msg.id === msgId) finish();
    });
    setTimeout(finish, ms);
  });
}

// -------------------------------------------------------------------------
export async function applyStatusToActor(actor, statusId) {
  // Status effects are per-token — they live in the token's actorDelta, not
  // on the base actor document. We must operate on the synthetic actor obtained
  // from the canvas token placeable. If no canvas token exists (token deleted,
  // not yet placed, or off-scene), bail out — there is nothing to update.
  const canvasToken    = canvas?.tokens?.placeables
    ?.find(t => t.actor?.id === actor.id) ?? null;
  if (!canvasToken) return;
  const syntheticActor = canvasToken.actor;

  // Avoid duplicating an already-active status
  if (syntheticActor.statuses?.has(statusId)) return;

  await syntheticActor.toggleStatusEffect(statusId, { active: true });
}

// -------------------------------------------------------------------------
export async function removeStatusFromActor(actor, statusId) {
  // Status effects are per-token — they live in the token's actorDelta.
  // If no canvas token exists (token deleted or off-scene), bail out.
  // Calling toggleStatusEffect via the base actor fallback causes
  // "does not exist in EmbeddedCollection" server errors because the
  // effect IDs belong to the (now-gone) token's actorDelta, not the base actor.
  const canvasToken    = canvas?.tokens?.placeables
    ?.find(t => t.actor?.id === actor.id) ?? null;
  if (!canvasToken) return;
  const syntheticActor = canvasToken.actor;

  // Only remove if the status is actually active
  if (!syntheticActor.statuses?.has(statusId)) return;

  await syntheticActor.toggleStatusEffect(statusId, { active: false });
}

// -------------------------------------------------------------------------
export async function applyProneToDefender(defender) {
  await applyStatusToActor(defender, 'prone');
  console.debug(`Mythras Imperative | Prone condition applied to ${defender.name}`);
  ui.notifications.info(`${defender.name} is prone.`);
}

// -------------------------------------------------------------------------
export function getActiveImpaleGrade(actor) {
  if (!actor) return null;
  const impaledBy = actor.getFlag('mythras-imperative', 'impaledBy') ?? {};
  const gradeOrder = ['none','hard','formidable','herculean','incapacitated'];
  let worstIdx = 0;
  for (const entry of Object.values(impaledBy)) {
    const idx = gradeOrder.indexOf(entry.gradeId ?? 'none');
    if (idx > worstIdx) worstIdx = idx;
  }
  return worstIdx > 0 ? gradeOrder[worstIdx] : null;
}

// -------------------------------------------------------------------------
export function getActiveEntangleGrade(actor) {
  if (!actor) return null;
  const entangledBy = actor.getFlag('mythras-imperative', 'entangledBy') ?? {};
  for (const entry of Object.values(entangledBy)) {
    if (entry.gradeHard) return 'hard';
  }
  return null;
}

// -------------------------------------------------------------------------
export function applyFatigueToSkill(skillTotal, actor) {
  if (!actor) return skillTotal;

  const grades     = CONFIG.MYTHRAS?.difficultyGrades ?? {};
  const gradeOrder = ['veryEasy','easy','standard','hard','formidable','herculean','hopeless'];

  let worstIdx = 2; // minimum: standard (index 2)

  // Fatigue grade — delegated to shared utility
  const fatGrade = getFatigueSkillGrade(actor);
  if (fatGrade) {
    const idx = gradeOrder.indexOf(fatGrade);
    if (idx > worstIdx) worstIdx = idx;
  }

  // Impale grade floor — worst grade from any active impalements
  const impaleGrade = getActiveImpaleGrade(actor);
  if (impaleGrade && impaleGrade !== 'none' && impaleGrade !== 'incapacitated') {
    const idx = gradeOrder.indexOf(impaleGrade);
    if (idx > worstIdx) worstIdx = idx;
  }

  // Entangle grade floor — head/chest/abdomen entanglement imposes Hard
  const entangleGrade = getActiveEntangleGrade(actor);
  if (entangleGrade) {
    const idx = gradeOrder.indexOf(entangleGrade);
    if (idx > worstIdx) worstIdx = idx;
  }

  const worstGrade = gradeOrder[worstIdx];
  const gradeDef   = grades[worstGrade];
  if (!gradeDef) return skillTotal;
  if (gradeDef.multiplier === null) return 0; // hopeless
  return Math.max(0, Math.ceil(skillTotal * gradeDef.multiplier));
}

// -------------------------------------------------------------------------
export async function postOpposedSEResult({
  label, attackerName, defenderName,
  attackerRoll, attackerTotal,
  defenderRoll, defenderTotal, defenderRaw, defenderSkill,
  forcesFail, effectApplied, effectLabel,
  stunTurns = 0,
  attackerActor, defenderActor
}) {
  // Show base total in parentheses when conditions have reduced it
  const defRawNote = (defenderRaw != null && defenderRaw !== defenderTotal)
    ? ` (base ${defenderRaw}%)` : '';
  const attackOutcome  = attackerRoll  <= Math.ceil(attackerTotal / 10) ? 'critical'
    : attackerRoll  <= attackerTotal  ? 'success'
    : attackerRoll  >= 100            ? 'fumble' : 'failure';

  const defenceOutcome = forcesFail ? 'forced'
    : defenderRoll === null          ? 'none'
    : defenderRoll <= Math.ceil(defenderTotal / 10) ? 'critical'
    : defenderRoll <= defenderTotal  ? 'success'
    : defenderRoll >= 100            ? 'fumble' : 'failure';

  const defenceLabel = forcesFail ? 'Force Failure'
    : defenderRoll === null ? 'Accepted'
    : defenceOutcome === 'critical' ? 'Critical'
    : defenceOutcome === 'success'  ? 'Success'
    : defenceOutcome === 'fumble'   ? 'Fumble'
    : 'Failure';

  const resultClass  = effectApplied ? 'mi-wound-serious' : 'success';
  const resultIcon   = effectApplied ? 'fa-times-circle' : 'fa-check-circle';

  const content = `
    <div class="mi-chat-card">
      <div class="mi-card-header mi-card-header--stacked">
        <span class="mi-card-actor">${attackerName} → ${defenderName}</span>
        <span class="mi-card-skill">SE: ${label}</span>
      </div>
      <div class="mi-card-body">
        <div class="mi-card-rolls">
          <div class="mi-card-roll-row">
            <div class="mi-card-roll-row-top">${attackerName} (original roll)</div>
            <div class="mi-card-roll-row-bottom">
              <span class="mi-card-roll-target">${attackerTotal}%</span>
              <span class="mi-card-roll-result">${attackerRoll}</span>
              <span class="mi-outcome ${attackOutcome}">${attackOutcome.charAt(0).toUpperCase() + attackOutcome.slice(1)}</span>
            </div>
          </div>
          <div class="mi-card-roll-row mi-card-roll-row--defender">
            <div class="mi-card-roll-row-top">${defenderName} — ${defenderSkill}${defRawNote}</div>
            <div class="mi-card-roll-row-bottom">
              <span class="mi-card-roll-target">${defenderTotal > 0 ? defenderTotal + '%' : '—'}</span>
              <span class="mi-card-roll-result">${defenderRoll ?? '—'}</span>
              <span class="mi-outcome ${defenceOutcome === 'success' || defenceOutcome === 'critical' ? defenceOutcome : 'failure'}">${defenceLabel}</span>
            </div>
          </div>
        </div>
        <div class="mi-outcome-row">
          <span class="mi-outcome ${resultClass}">
            <i class="fas ${resultIcon}"></i> ${effectLabel}
          </span>
        </div>
        ${stunTurns > 0 ? `
        <div class="mi-outcome-row">
          <span class="mi-outcome mi-wound-serious">
            <i class="fas fa-dizzy"></i> Stunned — cannot attack or cast for ${stunTurns} Turn${stunTurns > 1 ? 's' : ''} (may still Parry or Evade)
          </span>
        </div>` : ''}
      </div>
    </div>`;

  // Use the attacker actor for speaker if available, otherwise fall back to name lookup
  const speakerActor = attackerActor
    ?? game.actors.find(a => a.name === attackerName)
    ?? null;

  await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ actor: speakerActor })
  });
}

// -------------------------------------------------------------------------
export async function runWoundEnduranceDialog({
  woundLevel, locationType, locationLabel,
  attackerName, defenderName,
  attackRoll, attackerSkillTotal, defenderRaw, defenderTotal, rollNote,
  lastCardId = null
}) {
  // Wait for the wound result card to render before showing the Endurance dialog
  await waitForCard(lastCardId);
  const isMajor     = woundLevel === 'major';
  const titleSuffix = isMajor ? 'Major Wound' : 'Serious Wound';
  const woundClass  = isMajor ? 'mi-wound-major' : 'mi-wound-serious';

  // Build consequence note for the dialog
  let consequenceNote = '';
  if (isMajor) {
    consequenceNote = locationType === 'limb'
      ? '<span class="mi-wound-serious">Failure → Unconscious from agony</span>'
      : '<span class="mi-wound-major">Failure → INSTANT DEATH</span>';
  } else {
    if (locationType === 'limb') {
      const ll = locationLabel.toLowerCase();
      const legExtra = /leg|foot/.test(ll) ? ' + Prone' : '';
      const armExtra = /arm|hand/.test(ll) ? ' + held items drop' : '';
      consequenceNote = `<span class="mi-wound-serious">Failure → ${locationLabel} useless until healed${legExtra}${armExtra}</span>`;
    } else {
      consequenceNote = '<span class="mi-wound-serious">Failure → Unconscious (minutes = damage dealt)</span>';
    }
  }

  return new Promise(resolve => {
    let resolved = false;
    new Dialog({
      title: `${titleSuffix} — ${defenderName}`,
      content: `
        <div class="mi-se-roll-dialog">
          <div class="mi-se-roll-header">
            <span class="mi-se-roll-title ${woundClass}">${titleSuffix} — ${locationLabel}</span>
            <span class="mi-se-roll-subtitle">${attackerName} → ${defenderName}</span>
          </div>
          <div class="mi-se-roll-body">
            <div class="mi-se-roll-row">
              <span class="mi-se-roll-label">Attack roll (opposing target)</span>
              <span class="mi-se-roll-val">${attackRoll}</span>
            </div>
            <div class="mi-se-roll-row mi-se-roll-row--resist">
              <span class="mi-se-roll-label">${defenderName} — Endurance${defenderRaw != null && defenderRaw !== defenderTotal ? ` <span class="mi-dialog-skill-raw">(base ${defenderRaw}%)</span>` : ''}</span>
              <span class="mi-se-roll-val">${defenderTotal}%</span>
            </div>
            <p class="mi-se-roll-note">${rollNote}</p>
            <p class="mi-se-roll-note">${consequenceNote}</p>
          </div>
        </div>`,
      buttons: {
        roll: {
          icon: '<i class="fas fa-dice-d10"></i>',
          label: 'Roll Endurance',
          callback: async () => {
            resolved = true;
            const roll = new Roll('1d100');
            await roll.evaluate();
            // Opposed roll: defender wins only if better level, or same level
            // with higher roll (rules p.24). attackRoll is the fixed attacker side.
            const succeeds = resolveOpposedRoll(
              attackRoll, attackerSkillTotal,
              roll.total, defenderTotal
            );
            resolve({ roll: roll.total, succeeds });
          }
        }
      },
      default: 'roll',
      classes: ['dialog', 'mi-dialog'],
      close: () => {
        // Treat dialog close without rolling as a failure (worst case for safety)
        if (!resolved) resolve({ roll: null, succeeds: false });
      }
    }).render(true);
  });
}

// -------------------------------------------------------------------------
export async function runSEDialog(data) {
  const T = 'systems/mythras-imperative/templates/dialogs';
  const { seType, attackerName, defenderName, attackRoll,
          attackerSkillTotal, defenderSkill, defenderTotal,
          defenderRaw, skillOptions, tripIsOffensive, sizeNote } = data;

  // Wait for the preceding chat card to finish rendering so the player can
  // read the dice outcome before a resistance dialog appears on top of it.
  await waitForCard(data.lastCardId);

  // Condition note — shown when fatigue/conditions have reduced the skill
  const condNote = (defenderRaw != null && defenderRaw !== defenderTotal)
    ? `<span class="mi-dialog-skill-raw"> (base ${defenderRaw}%)</span>` : '';

  // ── Drop Foe ───────────────────────────────────────────────────────────
  if (seType === 'dropFoe') {
    const content = await renderTemplate(`${T}/se-drop-foe.hbs`, {
      attackerName, defenderName, attackRoll, defenderSkill, defenderTotal, condNote
    });
    return new Promise(resolve => {
      let resolved = false;
      new Dialog({
        title: `Drop Foe — ${defenderName}`,
        content,
        buttons: {
          roll: {
            icon: '<i class="fas fa-dice-d10"></i>',
            label: 'Roll Endurance',
            callback: async () => {
              resolved = true;
              const roll = new Roll('1d100');
              await roll.evaluate();
              const succeeds = resolveOpposedRoll(
                attackRoll, attackerSkillTotal, roll.total, defenderTotal
              );
              resolve({ roll: roll.total, succeeds });
            }
          },
          autoFail: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Accept',
            callback: () => { resolved = true; resolve({ roll: null, succeeds: false }); }
          }
        },
        default: 'roll',
        classes: ['dialog', 'mi-dialog'],
        close: () => { if (!resolved) resolve({ roll: null, succeeds: false }); }
      }).render(true);
    });
  }

  // ── Pin Down ───────────────────────────────────────────────────────────
  if (seType === 'pinDown') {
    const content = await renderTemplate(`${T}/se-pin-down.hbs`, {
      attackerName, defenderName, attackRoll, defenderSkill, defenderTotal, condNote
    });
    return new Promise(resolve => {
      let resolved = false;
      new Dialog({
        title: `Pin Down — ${defenderName}`,
        content,
        buttons: {
          roll: {
            icon: '<i class="fas fa-dice-d10"></i>',
            label: 'Roll Willpower',
            callback: async () => {
              resolved = true;
              const roll = new Roll('1d100');
              await roll.evaluate();
              const succeeds = resolveOpposedRoll(
                attackRoll, attackerSkillTotal, roll.total, defenderTotal
              );
              resolve({ roll: roll.total, succeeds });
            }
          },
          autoFail: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Accept',
            callback: () => { resolved = true; resolve({ roll: null, succeeds: false }); }
          }
        },
        default: 'roll',
        classes: ['dialog', 'mi-dialog'],
        close: () => { if (!resolved) resolve({ roll: null, succeeds: false }); }
      }).render(true);
    });
  }

  // ── Bleed ──────────────────────────────────────────────────────────────
  if (seType === 'bleed') {
    const content = await renderTemplate(`${T}/se-bleed.hbs`, {
      attackerName, defenderName, attackRoll, defenderSkill, defenderTotal, condNote
    });
    return new Promise(resolve => {
      let resolved = false;
      new Dialog({
        title: `Resist Bleed — ${defenderName}`,
        content,
        buttons: {
          roll: {
            icon: '<i class="fas fa-dice-d10"></i>',
            label: `Roll ${defenderSkill}`,
            callback: async () => {
              resolved = true;
              const roll = new Roll('1d100');
              await roll.evaluate();
              const succeeds = resolveOpposedRoll(
                attackRoll, attackerSkillTotal, roll.total, defenderTotal
              );
              resolve({ roll: roll.total, succeeds });
            }
          },
          autoFail: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Accept Bleed',
            callback: () => { resolved = true; resolve({ roll: null, succeeds: false }); }
          }
        },
        default: 'roll',
        classes: ['dialog', 'mi-dialog'],
        close: () => { if (!resolved) resolve({ roll: null, succeeds: false }); }
      }).render(true);
    });
  }

  // ── Stun Location ──────────────────────────────────────────────────────
  if (seType === 'stunLocation') {
    const content = await renderTemplate(`${T}/se-stun-location.hbs`, {
      attackerName, defenderName, attackRoll, defenderTotal, condNote,
      locationLabel: data.locationLabel ?? 'location',
      damage: data.damage,
      pluralTurns: data.damage !== 1
    });
    return new Promise(resolve => {
      let resolved = false;
      new Dialog({
        title: `Resist Stun Location — ${defenderName}`,
        content,
        buttons: {
          roll: {
            icon: '<i class="fas fa-dice-d10"></i>',
            label: 'Roll Endurance',
            callback: async () => {
              resolved = true;
              const roll = new Roll('1d100');
              await roll.evaluate();
              const succeeds = resolveOpposedRoll(
                attackRoll, attackerSkillTotal, roll.total, defenderTotal
              );
              resolve({ roll: roll.total, succeeds });
            }
          },
          autoFail: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Accept Stun',
            callback: () => { resolved = true; resolve({ roll: null, succeeds: false }); }
          }
        },
        default: 'roll',
        classes: ['dialog', 'mi-dialog'],
        close: () => { if (!resolved) resolve({ roll: null, succeeds: false }); }
      }).render(true);
    });
  }

  // ── Trip Opponent ───────────────────────────────────────────────────────
  if (seType === 'trip') {
    const resistingName = tripIsOffensive ? defenderName : attackerName;
    const winnerName    = tripIsOffensive ? attackerName : defenderName;
    const winnerLabel   = tripIsOffensive ? 'Attack roll' : 'Defender roll';

    // Skill picker (if multiple options)
    const pickSkill = skillOptions.length > 1
      ? await new Promise(resolve => {
          const btns = {};
          for (const sk of skillOptions) {
            btns[sk.name] = {
              label: `${sk.name} (${sk.total}%)`,
              callback: () => resolve(sk)
            };
          }
          renderTemplate(`${T}/se-choose-skill.hbs`, {
            title: 'Trip Opponent',
            subtitle: `${winnerName} → ${resistingName}`,
            showAttackRow: true,
            attackRowLabel: winnerLabel,
            attackRoll,
            note: `${resistingName} chooses a resistance skill (Brawn, Evade, or Acrobatics):`
          }).then(content => {
            new Dialog({
              title: `Resist Trip — ${resistingName}`,
              content,
              buttons: btns,
              default: skillOptions[0].name,
              classes: ['dialog', 'mi-dialog'],
              close: () => resolve(skillOptions[0])
            }).render(true);
          });
        })
      : skillOptions[0];

    // Roll the chosen skill
    const skillCondNote = (pickSkill.rawTotal != null && pickSkill.rawTotal !== pickSkill.total)
      ? `<span class="mi-dialog-skill-raw">(base ${pickSkill.rawTotal}%)</span>` : '';
    const content = await renderTemplate(`${T}/se-trip.hbs`, {
      winnerName, resistingName, winnerLabel, attackRoll,
      skillName: pickSkill.name, skillTotal: pickSkill.total, condNote: skillCondNote
    });
    return new Promise(resolve => {
      let resolved = false;
      new Dialog({
        title: `Resist Trip — ${resistingName}`,
        content,
        buttons: {
          roll: {
            icon: '<i class="fas fa-dice-d10"></i>',
            label: `Roll ${pickSkill.name}`,
            callback: async () => {
              resolved = true;
              const roll = new Roll('1d100');
              await roll.evaluate();
              const succeeds = resolveOpposedRoll(
                attackRoll, attackerSkillTotal, roll.total, pickSkill.total
              );
              resolve({
                chosenSkillName: pickSkill.name, chosenSkillTotal: pickSkill.total,
                chosenSkillRaw: pickSkill.rawTotal ?? pickSkill.total,
                roll: roll.total, succeeds
              });
            }
          },
          autoFail: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Accept Trip',
            callback: () => {
              resolved = true;
              resolve({
                chosenSkillName: pickSkill.name, chosenSkillTotal: pickSkill.total,
                chosenSkillRaw: pickSkill.rawTotal ?? pickSkill.total,
                roll: null, succeeds: false
              });
            }
          }
        },
        default: 'roll',
        classes: ['dialog', 'mi-dialog'],
        close: () => {
          if (!resolved) resolve({
            chosenSkillName: pickSkill.name, chosenSkillTotal: pickSkill.total,
            chosenSkillRaw: pickSkill.rawTotal ?? pickSkill.total,
            roll: null, succeeds: false
          });
        }
      }).render(true);
    });
  }

  // ── Disarm ──────────────────────────────────────────────────────────────
  if (seType === 'disarm') {
    const content = await renderTemplate(`${T}/se-disarm.hbs`, {
      attackerName, defenderName, attackRoll, defenderSkill, defenderTotal, condNote,
      sizeNote: sizeNote || ''
    });
    return new Promise(resolve => {
      let resolved = false;
      new Dialog({
        title: `Resist Disarm — ${defenderName}`,
        content,
        buttons: {
          roll: {
            icon: '<i class="fas fa-dice-d10"></i>',
            label: `Roll ${defenderSkill}`,
            callback: async () => {
              resolved = true;
              const roll = new Roll('1d100');
              await roll.evaluate();
              const succeeds = resolveOpposedRoll(
                attackRoll, attackerSkillTotal, roll.total, defenderTotal
              );
              resolve({ roll: roll.total, succeeds });
            }
          },
          autoFail: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Accept Disarm',
            callback: () => { resolved = true; resolve({ roll: null, succeeds: false }); }
          }
        },
        default: 'roll',
        classes: ['dialog', 'mi-dialog'],
        close: () => { if (!resolved) resolve({ roll: null, succeeds: false }); }
      }).render(true);
    });
  }

  // ── Entangle Trip / Break Free ──────────────────────────────────────────
  if (seType === 'entangleTrip' || seType === 'entangleBreakFree') {
    const isTrip = seType === 'entangleTrip';
    const title  = isTrip ? 'Entangle Trip' : 'Break Free';
    const note   = isTrip
      ? `Roll Brawn to avoid being knocked prone by ${attackerName}'s entangle trip.`
      : `Roll Brawn to yank free of ${data.weaponName ?? 'the entangle'}.`;
    const content = await renderTemplate(`${T}/se-entangle.hbs`, {
      title, attackerName, defenderName, attackRoll, defenderTotal, condNote, note
    });
    return new Promise(resolve => {
      let resolved = false;
      new Dialog({
        title: isTrip ? `Resist Entangle Trip — ${defenderName}` : `Break Free from Entangle — ${defenderName}`,
        content,
        buttons: {
          roll: {
            icon: '<i class="fas fa-dice-d10"></i>',
            label: 'Roll Brawn',
            callback: async () => {
              resolved = true;
              const roll = new Roll('1d100');
              await roll.evaluate();
              const succeeds = resolveOpposedRoll(
                attackRoll, attackerSkillTotal, roll.total, defenderTotal
              );
              resolve({ roll: roll.total, succeeds });
            }
          },
          autoFail: {
            icon: '<i class="fas fa-times"></i>',
            label: isTrip ? 'Accept Trip' : 'Stay Entangled',
            callback: () => { resolved = true; resolve({ roll: null, succeeds: false }); }
          }
        },
        default: 'roll',
        classes: ['dialog', 'mi-dialog'],
        close: () => { if (!resolved) resolve({ roll: null, succeeds: false }); }
      }).render(true);
    });
  }

  // ── Grip — Choose Holding Skill ────────────────────────────────────────
  if (seType === 'gripChooseSkill') {
    if (skillOptions.length === 1) {
      return {
        chosenSkillName: skillOptions[0].name, chosenSkillTotal: skillOptions[0].total,
        chosenSkillRaw: skillOptions[0].rawTotal ?? skillOptions[0].total,
        roll: null, succeeds: true
      };
    }
    const content = await renderTemplate(`${T}/se-grip.hbs`, { attackerName, defenderName });
    return new Promise(resolve => {
      const btns = {};
      for (const sk of skillOptions) {
        btns[sk.name] = {
          icon: '<i class="fas fa-fist-raised"></i>',
          label: `${sk.name} (${sk.total}%)`,
          callback: () => resolve({
            chosenSkillName: sk.name, chosenSkillTotal: sk.total,
            chosenSkillRaw: sk.rawTotal ?? sk.total, roll: null, succeeds: true
          })
        };
      }
      new Dialog({
        title: 'Grip — Choose Holding Skill',
        content,
        buttons: btns,
        default: skillOptions[0].name,
        classes: ['dialog', 'mi-dialog'],
        close: () => resolve({
          chosenSkillName: skillOptions[0].name, chosenSkillTotal: skillOptions[0].total,
          chosenSkillRaw: skillOptions[0].rawTotal ?? skillOptions[0].total,
          roll: null, succeeds: true
        })
      }).render(true);
    });
  }

  // ── Grip — Break Free ──────────────────────────────────────────────────
  if (seType === 'gripBreakFree') {
    const { gripperName, gripperSkillName, gripperSkillTotal } = data;

    if (skillOptions.length === 1) {
      const sk = skillOptions[0];
      const content = await renderTemplate(`${T}/se-grip-break-free.hbs`, {
        defenderName, gripperName, gripperSkillName, gripperSkillTotal,
        skillName: sk.name, skillTotal: sk.total
      });
      return new Promise(resolve => {
        let resolved = false;
        new Dialog({
          title: `Break Free — ${defenderName}`,
          content,
          buttons: {
            roll: {
              icon: '<i class="fas fa-dice-d10"></i>',
              label: `Roll ${sk.name}`,
              callback: async () => {
                resolved = true;
                const roll = new Roll('1d100');
                await roll.evaluate();
                const succeeds = resolveOpposedRoll(
                  attackRoll, attackerSkillTotal, roll.total, sk.total
                );
                resolve({ chosenSkillName: sk.name, chosenSkillTotal: sk.total, chosenSkillRaw: sk.rawTotal ?? sk.total, roll: roll.total, succeeds });
              }
            },
            stay: {
              icon: '<i class="fas fa-times"></i>',
              label: 'Stay Gripped',
              callback: () => { resolved = true; resolve({ chosenSkillName: sk.name, chosenSkillTotal: sk.total, chosenSkillRaw: sk.rawTotal ?? sk.total, roll: null, succeeds: false }); }
            }
          },
          default: 'roll',
          classes: ['dialog', 'mi-dialog'],
          close: () => { if (!resolved) resolve({ chosenSkillName: sk.name, chosenSkillTotal: sk.total, chosenSkillRaw: sk.rawTotal ?? sk.total, roll: null, succeeds: false }); }
        }).render(true);
      });
    }

    // Multiple skills — pick then roll immediately
    const content = await renderTemplate(`${T}/se-grip-break-free-pick.hbs`, {
      defenderName, gripperName, gripperSkillName, gripperSkillTotal
    });
    return new Promise(resolveOuter => {
      const btns = {};
      for (const sk of skillOptions) {
        btns[sk.name] = {
          label: `${sk.name} (${sk.total}%)`,
          callback: async () => {
            const roll = new Roll('1d100');
            await roll.evaluate();
            const succeeds = resolveOpposedRoll(
              attackRoll, attackerSkillTotal, roll.total, sk.total
            );
            resolveOuter({ chosenSkillName: sk.name, chosenSkillTotal: sk.total, chosenSkillRaw: sk.rawTotal ?? sk.total, roll: roll.total, succeeds });
          }
        };
      }
      new Dialog({
        title: `Break Free — ${defenderName}`,
        content,
        buttons: btns,
        default: skillOptions[0].name,
        classes: ['dialog', 'mi-dialog'],
        close: () => resolveOuter({ chosenSkillName: skillOptions[0].name, chosenSkillTotal: skillOptions[0].total, chosenSkillRaw: skillOptions[0].rawTotal ?? skillOptions[0].total, roll: null, succeeds: false })
      }).render(true);
    });
  }

  // ── Impale Yank ────────────────────────────────────────────────────────
  if (seType === 'impaleYank') {
    const content = await renderTemplate(`${T}/se-impale-yank.hbs`, {
      attackerName, defenderName, attackerSkillTotal, defenderTotal, condNote
    });
    return new Promise(resolve => {
      let resolved = false;
      new Dialog({
        title: `Resist Yank — ${defenderName}`,
        content,
        buttons: {
          roll: {
            icon: '<i class="fas fa-dice-d10"></i>',
            label: 'Roll Brawn',
            callback: async () => {
              resolved = true;
              const roll = new Roll('1d100');
              await roll.evaluate();
              const succeeds = resolveOpposedRoll(
                attackerSkillTotal, attackerSkillTotal, roll.total, defenderTotal
              );
              resolve({ roll: roll.total, succeeds });
            }
          },
          autoFail: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Accept Yank',
            callback: () => { resolved = true; resolve({ roll: null, succeeds: false }); }
          }
        },
        default: 'roll',
        classes: ['dialog', 'mi-dialog'],
        close: () => { if (!resolved) resolve({ roll: null, succeeds: false }); }
      }).render(true);
    });
  }

  // ── Wound Endurance (delegates) ────────────────────────────────────────
  if (seType === 'woundEndurance') {
    return runWoundEnduranceDialog(data);
  }

  // ── Blind Opponent ─────────────────────────────────────────────────────
  if (seType === 'blindOpponent') {
    const content = await renderTemplate(`${T}/se-blind-opponent.hbs`, {
      attackerName, defenderName, attackRoll, defenderSkill, defenderTotal, condNote
    });
    return new Promise(resolve => {
      let resolved = false;
      new Dialog({
        title: `Resist Blind — ${defenderName}`,
        content,
        buttons: {
          roll: {
            icon: '<i class="fas fa-dice-d10"></i>',
            label: `Roll ${defenderSkill}`,
            callback: async html => {
              resolved = true;
              const grade = html[0].querySelector('#mi-blind-grade')?.value ?? 'hard';
              const roll  = new Roll('1d100');
              await roll.evaluate();
              const succeeds = resolveOpposedRoll(
                attackRoll, attackerSkillTotal, roll.total, defenderTotal
              );
              resolve({ roll: roll.total, succeeds, grade });
            }
          },
          autoFail: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Accept Blind',
            callback: html => {
              resolved = true;
              const grade = html[0].querySelector('#mi-blind-grade')?.value ?? 'hard';
              resolve({ roll: null, succeeds: false, grade });
            }
          }
        },
        default: 'roll',
        classes: ['dialog', 'mi-dialog'],
        close: () => { if (!resolved) resolve({ roll: null, succeeds: false, grade: 'hard' }); }
      }).render(true);
    });
  }

  // ── Bash — Obstacle declaration ────────────────────────────────────────
  if (seType === 'bashObstacle') {
    const { knockback, typeLabel } = data;
    const content = await renderTemplate(`${T}/se-bash-obstacle.hbs`, {
      defenderName, knockback, typeLabel: typeLabel ?? 'Knockback',
      pluralMetres: knockback !== 1
    });
    return new Promise(resolve => {
      new Dialog({
        title: `Bash — Obstacle? (${defenderName})`,
        content,
        buttons: {
          yes: {
            icon: '<i class="fas fa-dungeon"></i>',
            label: 'Yes — Obstacle',
            callback: () => resolve(true)
          },
          no: {
            icon: '<i class="fas fa-check"></i>',
            label: 'No — Open Space',
            callback: () => resolve(false)
          }
        },
        default: 'no',
        classes: ['dialog', 'mi-dialog'],
        close: () => resolve(false)
      }).render(true);
    });
  }

  // ── Bash — Obstacle roll ───────────────────────────────────────────────
  if (seType === 'bashObstacleRoll') {
    const { skillOptions: bashSkills } = data;

    const pickSkill = bashSkills.length > 1
      ? await new Promise(resolve => {
          const btns = {};
          for (const sk of bashSkills) {
            btns[sk.name] = {
              label: `${sk.name} (Hard: ${sk.total}%)`,
              callback: () => resolve(sk)
            };
          }
          renderTemplate(`${T}/se-choose-skill.hbs`, {
            title: 'Bash — Obstacle Collision',
            subtitle: defenderName,
            showAttackRow: false,
            note: `${defenderName}: choose a skill to avoid falling (Hard difficulty):`
          }).then(content => {
            new Dialog({
              title: `Avoid Tripping — ${defenderName}`,
              content,
              buttons: btns,
              default: bashSkills[0].name,
              classes: ['dialog', 'mi-dialog'],
              close: () => resolve(bashSkills[0])
            }).render(true);
          });
        })
      : bashSkills[0];

    const content = await renderTemplate(`${T}/se-bash-obstacle-roll.hbs`, {
      defenderName, skillName: pickSkill.name, skillTotal: pickSkill.total
    });
    return new Promise(resolve => {
      let resolved = false;
      new Dialog({
        title: `Avoid Tripping — ${defenderName}`,
        content,
        buttons: {
          roll: {
            icon: '<i class="fas fa-dice-d10"></i>',
            label: `Roll ${pickSkill.name}`,
            callback: async () => {
              resolved = true;
              const roll = new Roll('1d100');
              await roll.evaluate();
              const succeeds = roll.total <= pickSkill.total;
              resolve({ chosenSkill: pickSkill, roll: roll.total, succeeds });
            }
          },
          fail: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Fall (Accept Prone)',
            callback: () => {
              resolved = true;
              resolve({ chosenSkill: pickSkill, roll: null, succeeds: false });
            }
          }
        },
        default: 'roll',
        classes: ['dialog', 'mi-dialog'],
        close: () => { if (!resolved) resolve({ chosenSkill: pickSkill, roll: null, succeeds: false }); }
      }).render(true);
    });
  }

  // ── Prepare Counter — Watch dialog (Phase 1) ───────────────────────────
  // Shown to the defender so they can nominate an SE to watch for.
  // Resolves with the chosen SE id string, or null if cancelled.
  if (seType === 'prepareCounterWatch') {
    const { watchableSEs } = data;
    const radios = watchableSEs.map((se, idx) => {
      const label = game.i18n.localize(se.label);
      return `
        <label class="mi-loc-picker-option">
          <input type="radio" name="mi-pc-watch" value="${se.id}"
            ${idx === 0 ? 'checked' : ''}>
          <span class="mi-loc-picker-name">${label}</span>
        </label>`;
    }).join('');

    const content = `
      <div class="mi-se-roll-dialog">
        <div class="mi-se-roll-header">
          <span class="mi-se-roll-title">Prepare Counter</span>
          <span class="mi-se-roll-subtitle">${defenderName} — choose an SE to watch for</span>
        </div>
        <div class="mi-se-roll-body">
          <p class="mi-loc-picker-header">Which Special Effect are you preparing to counter?</p>
          <div class="mi-loc-picker">${radios}</div>
        </div>
      </div>`;

    return new Promise(resolve => {
      let resolved = false;
      new Dialog({
        title: `Prepare Counter — ${defenderName}`,
        content,
        buttons: {
          confirm: {
            icon:  '<i class="fas fa-check"></i>',
            label: 'Confirm',
            callback: html => {
              resolved = true;
              const checked = html[0].querySelector('input[name="mi-pc-watch"]:checked');
              resolve(checked?.value ?? null);
            }
          },
          cancel: {
            icon:  '<i class="fas fa-times"></i>',
            label: 'Cancel',
            callback: () => { resolved = true; resolve(null); }
          }
        },
        default: 'confirm',
        classes: ['dialog', 'mi-dialog'],
        close: () => { if (!resolved) resolve(null); }
      }).render(true);
    });
  }

  // ── Prepare Counter — Substitute dialog (Phase 2) ─────────────────────
  // Shown to the defender when the counter triggers — they pick the
  // substitute SE that fires automatically.
  // Resolves with the chosen SE id string, or null if skipped.
  if (seType === 'prepareCounterSubstitute') {
    const { substituteSEs } = data;
    const radios = substituteSEs.map((se, idx) => {
      const label = game.i18n.localize(se.label);
      return `
        <label class="mi-loc-picker-option">
          <input type="radio" name="mi-pc-sub" value="${se.id}"
            ${idx === 0 ? 'checked' : ''}>
          <span class="mi-loc-picker-name">${label}</span>
        </label>`;
    }).join('');

    const content = `
      <div class="mi-se-roll-dialog">
        <div class="mi-se-roll-header">
          <span class="mi-se-roll-title">Counter — Choose Substitute SE</span>
          <span class="mi-se-roll-subtitle">${defenderName} — succeeds automatically</span>
        </div>
        <div class="mi-se-roll-body">
          <p class="mi-loc-picker-header">Select a Special Effect to apply. It succeeds without a roll.</p>
          <div class="mi-loc-picker">${radios}</div>
        </div>
      </div>`;

    return new Promise(resolve => {
      let resolved = false;
      new Dialog({
        title: `Substitute SE — ${defenderName}`,
        content,
        buttons: {
          confirm: {
            icon:  '<i class="fas fa-check"></i>',
            label: 'Confirm',
            callback: html => {
              resolved = true;
              const checked = html[0].querySelector('input[name="mi-pc-sub"]:checked');
              resolve(checked?.value ?? null);
            }
          },
          skip: {
            icon:  '<i class="fas fa-forward"></i>',
            label: 'Skip',
            callback: () => { resolved = true; resolve(null); }
          }
        },
        default: 'confirm',
        classes: ['dialog', 'mi-dialog'],
        close: () => { if (!resolved) resolve(null); }
      }).render(true);
    });
  }

  return null;
}

// -------------------------------------------------------------------------
// spendActionPoint — deduct 1 AP from actor; warns and returns 0 if already
// at 0. Returns null if the actor has no actionPoints attribute.
// -------------------------------------------------------------------------
export async function spendActionPoint(actor) {
  const ap = actor.system.attributes?.actionPoints;
  if (!ap) return null;
  if (ap.value <= 0) {
    ui.notifications.warn(`${actor.name} has no Action Points remaining.`);
    return 0;
  }
  const newValue = ap.value - 1;
  await actor.update({ 'system.attributes.actionPoints.value': newValue });
  return newValue;
}
