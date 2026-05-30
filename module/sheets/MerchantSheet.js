/**
 * mythras-imperative/module/sheets/MerchantSheet.js
 *
 * Actor sheet for the 'merchant' actor type.
 * Two modes:
 *   shop      — priced inventory, Buy button, trade-in via drag
 *   container — treasure chest / loot pile, optional lock
 */

const { ActorSheetV2 }               = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class MerchantSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  _dropInProgress = false;

  static DEFAULT_OPTIONS = {
    classes:  ['mythras-imperative', 'mythras-sheet', 'merchant-sheet'],
    position: { width: 560, height: 640 },
    window:   { resizable: true },
    form:     { submitOnChange: true, closeOnSubmit: false },
    actions:  {}
  };

  static PARTS = {
    sheet: {
      template: 'systems/mythras-imperative/templates/actors/merchant-sheet.hbs'
    }
  };

  get title() {
    const mode = this.document.system.mode === 'container' ? ' [Container]' : '';
    return `${this.document.name}${mode}`;
  }

  // ---------------------------------------------------------------------------
  // Context — built from scratch, no super call (matches CharacterSheet pattern)
  // ---------------------------------------------------------------------------

  async _prepareContext(_options) {
    const actor  = this.document;
    const system = actor.system;
    const mode   = system.mode ?? 'shop';
    const isShop = mode === 'shop';

    const allItems = Array.from(actor.items);

    const currencyItems = allItems
      .filter(i => i.type === 'currency')
      .sort((a, b) => (b.system.baseValue ?? 1) - (a.system.baseValue ?? 1));

    const inventoryItems = allItems
      .filter(i => i.type !== 'currency')
      .sort((a, b) => a.name.localeCompare(b.name));

    const inventory = inventoryItems.map(item => {
      const sys   = item.system.toObject ? item.system.toObject() : { ...item.system };
      const amt   = Number(sys.price?.amount   ?? 0);
      const denom = String(sys.price?.denominationAbbr ?? '').trim();
      return {
        id:           item.id,
        uuid:         item.uuid,
        name:         item.name,
        img:          item.img,
        quantity:     Number(sys.quantity ?? 1),
        hasPrice:     amt > 0,
        canBuy:       amt > 0 && denom.length > 0,
        priceDisplay: amt > 0 ? (denom ? `${amt} ${denom}` : `${amt}`) : '—'
      };
    });

    return {
      actor,
      system,
      isShop,
      isContainer: !isShop,
      currencyItems,
      inventory,
      tradeInPct: Math.round((system.tradeInFraction ?? 0.5) * 100)
    };
  }

  // ---------------------------------------------------------------------------
  // Render — wire event listeners every render (fresh DOM each time)
  // ---------------------------------------------------------------------------

  _onRender(_context, options) {
    const html = this.element;

    // All button/input listeners are re-bound each render (safe — DOM is replaced)

    // Item name → open sheet
    html.querySelectorAll('.mi-merchant-item-name').forEach(el =>
      el.addEventListener('click', () => {
        const item = this.document.items.get(el.dataset.itemId);
        item?.sheet?.render(true);
      })
    );

    // Delete item
    html.querySelectorAll('.mi-merchant-item-delete').forEach(btn =>
      btn.addEventListener('click', async ev => {
        ev.stopPropagation();
        await this.document.deleteEmbeddedDocuments('Item', [btn.dataset.itemId]);
      })
    );

    // Currency quantity
    html.querySelectorAll('.mi-currency-qty').forEach(input =>
      input.addEventListener('change', async () => {
        const qty = parseInt(input.value, 10) || 0;
        await this.document.items.get(input.dataset.itemId)
          ?.update({ 'system.quantity': qty });
      })
    );

    // Buy button
    html.querySelectorAll('.mi-merchant-buy-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        const item = this.document.items.get(btn.dataset.itemId);
        if (item) this._onBuy(item);
      })
    );

    // Lock toggle (container mode only)
    html.querySelector('#mi-merchant-locked')
      ?.addEventListener('change', async ev => {
        await this.document.update({ 'system.locked': ev.target.checked });
      });

    // Container mode — make inventory rows draggable so players can take items
    if (this.document.system.mode === 'container') {
      html.querySelectorAll('.mi-merchant-inv-row[data-item-uuid]').forEach(row => {
        row.setAttribute('draggable', 'true');
        row.addEventListener('dragstart', ev => {
          ev.stopPropagation();
          ev.dataTransfer.setData('text/plain', JSON.stringify({
            type: 'Item',
            uuid: row.dataset.itemUuid
          }));
        });
      });
    }

    // Drop — one listener, guarded by _dropInProgress
    if (options.isFirstRender) {
      html.addEventListener('dragover', ev => {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'copy';
      });
      html.addEventListener('drop', ev => this._onDrop(ev));
    }
  }

  // ---------------------------------------------------------------------------
  // Drop
  // ---------------------------------------------------------------------------

  async _onDrop(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    if (this._dropInProgress) return;
    this._dropInProgress = true;
    try {
      let dragData;
      try { dragData = JSON.parse(ev.dataTransfer.getData('text/plain')); }
      catch(e) { return; }
      if (dragData?.type !== 'Item') return;

      if (this.document.system.mode === 'container' && this.document.system.locked) {
        ui.notifications.warn(`${this.document.name} is locked.`);
        return;
      }

      let srcItem;
      try { srcItem = await fromUuid(dragData.uuid); }
      catch(e) { return; }
      if (!srcItem || srcItem.parent?.id === this.document.id) return;

      // Item from a player actor in shop mode → trade-in
      if (this.document.system.mode === 'shop' &&
          (srcItem.parent?.type === 'character' || srcItem.parent?.type === 'npc')) {
        return this._onTradeIn(srcItem);
      }

      // Add to inventory
      const data = srcItem.toObject();
      delete data._id;
      await this.document.createEmbeddedDocuments('Item', [data]);
    } finally {
      this._dropInProgress = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Buy dialog
  // ---------------------------------------------------------------------------

  async _onBuy(item) {
    const sys   = item.system.toObject ? item.system.toObject() : { ...item.system };
    const amt   = Number(sys.price?.amount ?? 0);
    const denom = String(sys.price?.denominationAbbr ?? '').trim();
    if (!amt || !denom) {
      ui.notifications.warn(`${item.name} has no price set.`);
      return;
    }
    const buyerActor = this._resolveBuyer();
    if (!buyerActor) {
      ui.notifications.warn('Select or target a character token to buy items.');
      return;
    }
    const denomItem = this._findDenomination(denom);
    if (!denomItem) {
      ui.notifications.warn(`Cannot resolve denomination "${denom}". Make sure currency items exist in the world.`);
      return;
    }
    const basePriceUnits = amt * denomItem.system.baseValue;
    const buyerWealth    = this._calcWealth(buyerActor);
    const adjustOptions  = this._buildAdjustOptions();
    const payOptions     = this._buildPayWithOptions(buyerActor, basePriceUnits);

    new Dialog({
      title: `Buy — ${item.name}`,
      content: `
        <div class="mi-roll-dialog">
          <div class="mi-dialog-skill-header">
            <span class="mi-dialog-skill-name">${item.name}</span>
            <span class="mi-dialog-skill-base">${this.document.name}</span>
          </div>
          <div class="mi-dialog-fields">
            <div class="mi-form-row">
              <label>List Price</label>
              <span class="mi-form-value">${amt} ${denom}</span>
            </div>
            <div class="mi-form-row">
              <label>Price Adjustment</label>
              <select id="mi-buy-adjust">${adjustOptions}</select>
            </div>
            <div class="mi-form-row">
              <label>Pay With</label>
              <select id="mi-buy-paywith">${payOptions}</select>
            </div>
            <div class="mi-form-row">
              <label>Final Price</label>
              <span id="mi-buy-final" class="mi-form-value">${amt} ${denom}</span>
            </div>
            <div class="mi-form-row">
              <label>${buyerActor.name} Wealth</label>
              <span class="mi-form-value ${buyerWealth >= basePriceUnits ? '' : 'mi-wealth-insufficient'}">
                ${this._formatWealth(buyerActor)}
              </span>
            </div>
          </div>
        </div>`,
      buttons: {
        buy: {
          icon:  '<i class="fas fa-coins"></i>',
          label: 'Buy',
          callback: async html => {
            const adjFactor    = 1 + (parseFloat(html.find('#mi-buy-adjust').val()) || 0) / 100;
            const finalBase    = Math.round(basePriceUnits * adjFactor);
            const payWithAbbr  = html.find('#mi-buy-paywith').val();
            const payDenomItem = payWithAbbr ? (this._findDenomination(payWithAbbr) ?? denomItem) : denomItem;
            if (this._calcWealth(buyerActor) < finalBase) {
              ui.notifications.warn(`${buyerActor.name} cannot afford this item.`);
              return;
            }
            await this._executePurchase(buyerActor, item, finalBase, payDenomItem);
          }
        },
        cancel: { label: 'Cancel' }
      },
      default: 'buy',
      classes: ['dialog', 'mi-dialog'],
      render: html => {
        const updateFinal = () => {
          const adjFactor   = 1 + (parseFloat(html.find('#mi-buy-adjust').val()) || 0) / 100;
          const finalBase   = Math.round(basePriceUnits * adjFactor);
          const payWithAbbr = html.find('#mi-buy-paywith').val();
          const payDenom    = payWithAbbr ? (this._findDenomination(payWithAbbr) ?? denomItem) : denomItem;
          const bv          = payDenom.system.baseValue ?? 1;
          const finalAmt    = Math.ceil(finalBase / bv);
          const finalEl     = html.find('#mi-buy-final')[0];
          if (finalEl) finalEl.textContent = `${finalAmt} ${payDenom.system.abbreviation || payDenom.name}`;
        };
        html.find('#mi-buy-adjust')[0]?.addEventListener('change', updateFinal);
        html.find('#mi-buy-paywith')[0]?.addEventListener('change', updateFinal);
      }
    }).render(true);
  }

  // ---------------------------------------------------------------------------
  // Trade-in dialog
  // ---------------------------------------------------------------------------

  async _onTradeIn(item) {
    const sys   = item.system.toObject ? item.system.toObject() : { ...item.system };
    const amt   = Number(sys.price?.amount ?? 0);
    const denom = String(sys.price?.denominationAbbr ?? '').trim();
    if (!amt || !denom) {
      ui.notifications.warn(`${item.name} has no list price — set a price before trade-in.`);
      return;
    }
    const denomItem = this._findDenomination(denom);
    if (!denomItem) {
      ui.notifications.warn(`Cannot resolve denomination "${denom}".`);
      return;
    }
    const fraction  = this.document.system.tradeInFraction ?? 0.5;
    const offerBase = Math.round(amt * denomItem.system.baseValue * fraction);
    const adjustOptions = this._buildAdjustOptions();

    new Dialog({
      title: `Trade-in — ${item.name}`,
      content: `
        <div class="mi-roll-dialog">
          <div class="mi-dialog-skill-header">
            <span class="mi-dialog-skill-name">${item.name}</span>
            <span class="mi-dialog-skill-base">Trade-in to ${this.document.name}</span>
          </div>
          <div class="mi-dialog-fields">
            <div class="mi-form-row">
              <label>List Price</label>
              <span class="mi-form-value">${amt} ${denom}</span>
            </div>
            <div class="mi-form-row">
              <label>Base Offer (${Math.round(fraction * 100)}%)</label>
              <span class="mi-form-value">${this._baseToDisplay(offerBase, denomItem)}</span>
            </div>
            <div class="mi-form-row">
              <label>Offer Adjustment</label>
              <select id="mi-tradein-adjust">${adjustOptions}</select>
            </div>
            <div class="mi-form-row">
              <label>Final Offer</label>
              <span id="mi-tradein-final" class="mi-form-value">${this._baseToDisplay(offerBase, denomItem)}</span>
            </div>
          </div>
        </div>`,
      buttons: {
        accept: {
          icon:  '<i class="fas fa-handshake"></i>',
          label: 'Accept',
          callback: async html => {
            const adjFactor = 1 + (parseFloat(html.find('#mi-tradein-adjust').val()) || 0) / 100;
            await this._executeTradeIn(item, Math.round(offerBase * adjFactor), denomItem);
          }
        },
        decline: { label: 'Decline' }
      },
      default: 'accept',
      classes: ['dialog', 'mi-dialog'],
      render: html => {
        html.find('#mi-tradein-adjust')[0]?.addEventListener('change', ev => {
          const adjFactor = 1 + (parseFloat(ev.target.value) || 0) / 100;
          html.find('#mi-tradein-final')[0].textContent =
            this._baseToDisplay(Math.round(offerBase * adjFactor), denomItem);
        });
      }
    }).render(true);
  }

  // ---------------------------------------------------------------------------
  // Transaction execution
  // ---------------------------------------------------------------------------

  async _executePurchase(buyerActor, item, totalBaseUnits, denomItem) {
    if (!await this._deductCurrency(buyerActor, totalBaseUnits, denomItem)) {
      ui.notifications.warn('Purchase failed — currency deduction error.');
      return;
    }
    const data = item.toObject();
    delete data._id;
    if ((data.system?.quantity ?? 1) > 1) {
      data.system.quantity = 1;
      await item.update({ 'system.quantity': item.system.quantity - 1 });
    } else {
      await this.document.deleteEmbeddedDocuments('Item', [item.id]);
    }
    await buyerActor.createEmbeddedDocuments('Item', [data]);
    await this._addCurrency(this.document, totalBaseUnits, denomItem);
    ui.notifications.info(`${buyerActor.name} purchased ${item.name} from ${this.document.name}.`);
  }

  async _executeTradeIn(item, totalBaseUnits, denomItem) {
    const sellerActor = item.parent;
    if (!sellerActor) return;
    if ((item.system?.quantity ?? 1) > 1) {
      await item.update({ 'system.quantity': item.system.quantity - 1 });
    } else {
      await sellerActor.deleteEmbeddedDocuments('Item', [item.id]);
    }
    const data = item.toObject();
    delete data._id;
    data.system.quantity = 1;
    await this.document.createEmbeddedDocuments('Item', [data]);
    await this._addCurrency(sellerActor, totalBaseUnits, denomItem);
    ui.notifications.info(`${sellerActor.name} sold ${item.name} to ${this.document.name}.`);
  }

  // ---------------------------------------------------------------------------
  // Currency helpers
  // ---------------------------------------------------------------------------

  async _deductCurrency(actor, totalBaseUnits, denomItem) {
    const currencies = Array.from(actor.items)
      .filter(i => i.type === 'currency' && i.system.quantity > 0)
      .sort((a, b) => b.system.baseValue - a.system.baseValue);
    const wealth = currencies.reduce((s, c) => s + c.system.baseValue * c.system.quantity, 0);
    if (wealth < totalBaseUnits) return false;
    let remaining = totalBaseUnits;
    const updates = [];
    for (const c of currencies) {
      if (remaining <= 0) break;
      const used = Math.min(c.system.quantity, Math.ceil(remaining / c.system.baseValue));
      updates.push({ _id: c.id, 'system.quantity': c.system.quantity - used });
      remaining -= used * c.system.baseValue;
    }
    if (remaining < 0) await this._addCurrency(actor, Math.abs(remaining), denomItem);
    await actor.updateEmbeddedDocuments('Item', updates);
    return true;
  }

  async _addCurrency(actor, totalBaseUnits, baseDenomItem) {
    if (totalBaseUnits <= 0) return;
    const currencies = Array.from(actor.items)
      .filter(i => i.type === 'currency')
      .sort((a, b) => b.system.baseValue - a.system.baseValue);
    let remaining = totalBaseUnits;
    const updates = [];
    for (const c of currencies) {
      if (remaining <= 0) break;
      const whole = Math.floor(remaining / c.system.baseValue);
      if (whole > 0) {
        updates.push({ _id: c.id, 'system.quantity': c.system.quantity + whole });
        remaining -= whole * c.system.baseValue;
      }
    }
    if (remaining > 0 && currencies.length > 0) {
      const lowest = currencies[currencies.length - 1];
      const lowestUnits = Math.ceil(remaining / lowest.system.baseValue);
      const existing = updates.find(u => u._id === lowest.id);
      if (existing) existing['system.quantity'] += lowestUnits;
      else updates.push({ _id: lowest.id, 'system.quantity': lowest.system.quantity + lowestUnits });
    }
    if (updates.length > 0) {
      await actor.updateEmbeddedDocuments('Item', updates);
    } else {
      const data = baseDenomItem.toObject();
      delete data._id;
      data.system.quantity = Math.ceil(totalBaseUnits / baseDenomItem.system.baseValue);
      await actor.createEmbeddedDocuments('Item', [data]);
    }
  }

  _calcWealth(actor) {
    return Array.from(actor.items)
      .filter(i => i.type === 'currency')
      .reduce((s, c) => s + (c.system.baseValue ?? 1) * (c.system.quantity ?? 0), 0);
  }

  _formatWealth(actor) {
    const currencies = Array.from(actor.items)
      .filter(i => i.type === 'currency' && i.system.quantity > 0)
      .sort((a, b) => b.system.baseValue - a.system.baseValue);
    if (!currencies.length) return 'No currency';
    return currencies.map(c => `${c.system.quantity} ${c.system.abbreviation || c.name}`).join(', ');
  }

  _baseToDisplay(baseUnits, baseDenomItem) {
    const worldCurrencies = Array.from(game.items ?? [])
      .filter(i => i.type === 'currency')
      .sort((a, b) => b.system.baseValue - a.system.baseValue);
    if (!worldCurrencies.length) {
      const bv = baseDenomItem.system.baseValue ?? 1;
      return `${Math.ceil(baseUnits / bv)} ${baseDenomItem.system.abbreviation || baseDenomItem.name}`;
    }
    const parts = [];
    let remaining = baseUnits;
    for (const c of worldCurrencies) {
      const whole = Math.floor(remaining / c.system.baseValue);
      if (whole > 0) {
        parts.push(`${whole} ${c.system.abbreviation || c.name}`);
        remaining -= whole * c.system.baseValue;
      }
    }
    return parts.join(', ') || '0';
  }

  _findDenomination(abbr) {
    const upper = abbr.toUpperCase();
    return Array.from(game.items ?? [])
      .find(i => i.type === 'currency' && (i.system.abbreviation ?? '').toUpperCase() === upper)
      ?? Array.from(this.document.items)
      .find(i => i.type === 'currency' && (i.system.abbreviation ?? '').toUpperCase() === upper)
      ?? null;
  }

  _resolveBuyer() {
    const targeted = Array.from(game.user.targets ?? []);
    if (targeted.length === 1) return targeted[0].actor ?? null;
    const controlled = canvas.tokens?.controlled ?? [];
    if (controlled.length === 1) return controlled[0].actor ?? null;
    return null;
  }

  _buildAdjustOptions() {
    const steps = [];
    for (let pct = -30; pct <= 30; pct += 5) {
      const label = pct === 0 ? 'List Price' : `${pct > 0 ? '+' : ''}${pct}%`;
      steps.push(`<option value="${pct}"${pct === 0 ? ' selected' : ''}>${label}</option>`);
    }
    return steps.join('\n');
  }

  _buildPayWithOptions(buyerActor, basePriceUnits) {
    // All world currency items, sorted highest to lowest value
    const worldCurrencies = Array.from(game.items ?? [])
      .filter(i => i.type === 'currency')
      .sort((a, b) => b.system.baseValue - a.system.baseValue);

    if (!worldCurrencies.length) return '<option value="">No currency defined</option>';

    // Build a lookup of how many the buyer holds for each denomination
    const holdings = {};
    for (const c of Array.from(buyerActor.items).filter(i => i.type === 'currency')) {
      const abbr = (c.system.abbreviation ?? '').toUpperCase();
      if (abbr) holdings[abbr] = (c.system.quantity ?? 0);
    }

    return worldCurrencies.map(c => {
      const abbr     = c.system.abbreviation || c.name;
      const bv       = c.system.baseValue ?? 1;
      const needed   = Math.ceil(basePriceUnits / bv);
      const held     = holdings[abbr.toUpperCase()] ?? 0;
      const canAfford = held >= needed;
      const label    = canAfford
        ? `${abbr} (need ${needed}, have ${held})`
        : `${abbr} (need ${needed}, have ${held} ✗)`;
      return `<option value="${abbr}"${canAfford ? '' : ' class="mi-wealth-insufficient"'}>${label}</option>`;
    }).join('\n');
  }

  async _processSubmitData(event, form, submitData) {
    // Convert tradeInFraction from display % (e.g. 50) back to decimal (0.5)
    if (submitData['system.tradeInFraction'] !== undefined) {
      const pct = parseFloat(submitData['system.tradeInFraction']) || 50;
      submitData['system.tradeInFraction'] = Math.max(0, Math.min(1, pct / 100));
    }
    await this.document.update(submitData);
  }
}
