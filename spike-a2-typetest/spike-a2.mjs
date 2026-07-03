/* ============================================================================
 * PHASE 0 — SPIKE A2  (esmodule for the stub module)
 *
 * Pairs with module.json's documentTypes declaration. The manifest tells
 * Foundry the types EXIST; this file gives them a data model + sheet so they
 * are actually usable, exercising the same path the real Destined module will.
 *
 * It registers via the SYSTEM's documented extension surface
 * (CONFIG.MYTHRAS.actorTypes / dataModels.actors / sheets.actors) during the
 * `setup` hook — i.e. the exact pattern the port's Phase 2 module skeleton will
 * use — so a pass here validates BOTH the manifest declaration AND the system's
 * extension wiring in one shot.
 *
 * SUCCESS CRITERIA (reported in console + notification at `ready`):
 *   1. "spikeActor" appears in game.documentTypes.Actor
 *   2. An actor of type spikeActor can be created (we create + delete one)
 *   3. Same for spikeItem
 * If all three pass, the durable manifest route is confirmed.
 * ========================================================================== */

const SPIKE = 'spike-a2-typetest';

Hooks.once('setup', () => {
  const M = CONFIG.MYTHRAS;
  if (!M) {
    console.error('SPIKE-A2 | CONFIG.MYTHRAS missing — is the mythras-imperative system active?');
    return;
  }

  // Minimal data models. We extend the system's own base so derivation does not
  // explode; for the spike we only need the type to be valid and instantiable.
  const fields = foundry.data.fields;

  class SpikeActorData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
      return { note: new fields.StringField({ initial: 'spike actor' }) };
    }
  }
  class SpikeItemData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
      return { note: new fields.StringField({ initial: 'spike item' }) };
    }
  }

  // Register through the SYSTEM's extension arrays — same as the real module.
  M.actorTypes.push('spikeActor');
  M.itemTypes.push('spikeItem');
  M.dataModels.actors['spikeActor'] = SpikeActorData;
  M.dataModels.items['spikeItem']  = SpikeItemData;

  // Sheets are optional for the create test, but register a trivial one so the
  // type opens without error if you double-click it in the sidebar.
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
  const { ActorSheetV2 } = foundry.applications.sheets;
  class SpikeActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
    static DEFAULT_OPTIONS = { position: { width: 320, height: 160 } };
    async _renderHTML() { return '<div style="padding:1em">Spike actor sheet OK</div>'; }
    _replaceHTML(result, content) { content.innerHTML = result; }
  }
  M.sheets.actors['spikeActor'] = SpikeActorSheet;

  console.log('SPIKE-A2 | setup: pushed spikeActor/spikeItem into MYTHRAS extension arrays');
});

Hooks.once('ready', async () => {
  const report = [];
  const log = (m) => { report.push(m); console.log('SPIKE-A2 |', m); };

  log('============ PHASE 0 SPIKE A2 — manifest documentTypes ============');

  const actorTypes = game.documentTypes?.Actor ?? [];
  const itemTypes  = game.documentTypes?.Item ?? [];
  log(`game.documentTypes.Actor includes spikeActor? ${actorTypes.includes('spikeActor')}`);
  log(`game.documentTypes.Item  includes spikeItem?  ${itemTypes.includes('spikeItem')}`);
  log(`CONFIG.Actor.dataModels has spikeActor model?  ${!!CONFIG.Actor.dataModels.spikeActor}`);
  log(`CONFIG.Item.dataModels has spikeItem model?    ${!!CONFIG.Item.dataModels.spikeItem}`);

  let actorOk = false, itemOk = false;
  try {
    const a = await Actor.create({ name: 'SpikeA2 Actor', type: 'spikeActor' });
    actorOk = !!a;
    log(`CREATE spikeActor → ${actorOk ? 'SUCCESS' : 'returned null'}`);
    if (a) await a.delete();
  } catch (e) { log(`CREATE spikeActor → FAILED: ${e.message}`); }

  try {
    const i = await Item.create({ name: 'SpikeA2 Item', type: 'spikeItem' });
    itemOk = !!i;
    log(`CREATE spikeItem  → ${itemOk ? 'SUCCESS' : 'returned null'}`);
    if (i) await i.delete();
  } catch (e) { log(`CREATE spikeItem  → FAILED: ${e.message}`); }

  const verdict = (actorOk && itemOk)
    ? 'VIABLE — module manifest documentTypes + system extension arrays register custom Actor AND Item types cleanly. Phase 5 proceeds as written.'
    : actorOk
      ? 'PARTIAL — custom ITEM types work but custom ACTOR types did not. Investigate before Phase 5; Item-only port is still fully viable.'
      : 'NOT VIABLE — custom actor types failed even via manifest. Phase 5 must fall back to flag-tagged generic actors (old gotham approach).';

  log('======================== VERDICT ========================');
  log(verdict);
  ui.notifications[(actorOk && itemOk) ? 'info' : 'warn'](`Spike A2: ${verdict}`);
  console.log('\n\n----- SPIKE A2 REPORT (copy this back) -----\n' + report.join('\n') + '\n----- END -----');
});
