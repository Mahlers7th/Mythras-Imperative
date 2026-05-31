/**
 * module/combat/effects/damage-weapon.js
 *
 * SE resolver for Damage Weapon.
 * Rules p.43: The target weapon's own AP absorbs first; surplus reduces
 * currentHP. If currentHP reaches 0 the weapon breaks. No opposed roll,
 * no dialog — automatic in all automation modes.
 *
 * No external dependencies beyond Foundry globals.
 */

const NS = 'mythras-imperative';

// -------------------------------------------------------------------------
// resolveDamageWeapon — SE: Damage Weapon (attacker or defender)
//
// Attacker wins SE → damage applied to defender's parrying weapon
// Defender wins SE → damage applied to attacker's striking weapon
// -------------------------------------------------------------------------
export async function resolveDamageWeapon(ctx) {
  const { attacker, defender } = ctx;
  if (!attacker || !defender) return;

  const damageIsOffensive = ctx.seWinner === 'attacker';

  const targetWeapon = damageIsOffensive ? ctx.defenceWeapon : ctx.weapon;
  const targetActor  = damageIsOffensive ? defender          : attacker;
  const damagerActor = damageIsOffensive ? attacker          : defender;

  if (!targetWeapon) {
    await ChatMessage.create({
      content: `
        <div class="mi-chat-card">
          <div class="mi-card-header mi-card-header--stacked">
            <span class="mi-card-actor">${damagerActor.name} → ${targetActor.name}</span>
            <span class="mi-card-skill">Damage Weapon</span>
          </div>
          <div class="mi-card-body">
            <div class="mi-outcome-row">
              <span class="mi-outcome mi-wound-minor">
                <i class="fas fa-hammer"></i> No weapon to damage
              </span>
            </div>
          </div>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor: damagerActor })
    });
    return;
  }

  // Raw damage (pre-parry, pre-armour)
  const rawDamage = (ctx.rawDamage > 0 ? ctx.rawDamage : null)
                 ?? (ctx.damageAfterParry > 0 ? ctx.damageAfterParry : null)
                 ?? 0;

  // Weapon AP absorbs first; surplus chips away at HP
  const weaponAP      = targetWeapon.system.ap       ?? 0;
  const weaponMaxHP   = targetWeapon.system.hp        ?? 0;
  const weaponCurrent = targetWeapon.system.currentHP ?? weaponMaxHP;

  const surplus    = Math.max(0, rawDamage - weaponAP);
  const newCurrent = weaponCurrent - surplus;
  const broken     = newCurrent <= 0;

  if (surplus > 0) {
    await targetWeapon.update({ 'system.currentHP': newCurrent });
  }

  const outcomeClass = broken      ? 'mi-wound-major'
                     : surplus > 0 ? 'mi-wound-serious'
                     :               'success';
  const outcomeIcon  = broken      ? 'fa-times-circle'
                     : surplus > 0 ? 'fa-exclamation-circle'
                     :               'fa-check-circle';
  const outcomeText  = broken
    ? `${targetWeapon.name} is BROKEN`
    : surplus > 0
      ? `${targetWeapon.name} takes ${surplus} damage (${newCurrent}/${weaponMaxHP} HP)`
      : `${targetWeapon.name} absorbs the blow — no HP damage (${weaponAP} AP)`;

  await ChatMessage.create({
    content: `
      <div class="mi-chat-card">
        <div class="mi-card-header mi-card-header--stacked">
          <span class="mi-card-actor">${damagerActor.name} → ${targetActor.name}</span>
          <span class="mi-card-skill">Damage Weapon — ${targetWeapon.name}</span>
        </div>
        <div class="mi-card-body">
          <div class="mi-se-roll-row">
            <span class="mi-se-roll-label">Damage roll</span>
            <span class="mi-se-roll-val">${rawDamage}</span>
          </div>
          <div class="mi-se-roll-row">
            <span class="mi-se-roll-label">Weapon AP / HP</span>
            <span class="mi-se-roll-val">${weaponAP} AP · ${weaponCurrent}/${weaponMaxHP} HP</span>
          </div>
          ${surplus > 0 ? `
          <div class="mi-se-roll-row">
            <span class="mi-se-roll-label">Surplus (over AP)</span>
            <span class="mi-se-roll-val">${surplus}</span>
          </div>` : ''}
          <div class="mi-outcome-row">
            <span class="mi-outcome ${outcomeClass}">
              <i class="fas ${outcomeIcon}"></i> ${outcomeText}
            </span>
          </div>
          ${broken ? `
          <div class="mi-outcome-row">
            <span class="mi-outcome mi-wound-major">
              <i class="fas fa-ban"></i>
              ${targetActor.name} can no longer use ${targetWeapon.name} until repaired
            </span>
          </div>` : ''}
        </div>
      </div>`,
    speaker: ChatMessage.getSpeaker({ actor: damagerActor })
  });
}
