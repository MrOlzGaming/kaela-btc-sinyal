// Sniper -- versi MULTI-AKUN (23 Agu 2026, "Kaela Pro Trader"). Sinyal (arah/SL/TP/pola) itu
// SATU SUMBER KEBENARAN BERSAMA -- Olan sendiri (sniper-orders.json, dianalisa cloud, dieksekusi
// localLiveExecutor.js) -- yang beda per-akun cuma SIZING (dari saldo masing2 via
// hitungExposure) & EKSEKUSI (API key masing2). Modul ini "MIRROR" keputusan itu ke akun lain:
// begitu Olan berhasil entry (order.liveExecution.ok), tiap akun aktif ikut entry SENDIRI pakai
// kalkulator exposure dari saldo mereka -- BUKAN copy-trade buta (persis kekhawatiran awal Olan:
// "masalahnya copy trading ga ngerti exposure").
//
// State per-akun DIPISAH dari sniper-orders.json Olan (JANGAN PERNAH ditulis ke situ) -- 1 file
// JSON per (phone,mode), isinya array "mirror order" yang nunjuk ke originalOrderId. Field &
// logika leg1(partial 2R)->leg2(reopen breakeven)->trailing SMA10 SAMA PERSIS sniperLiveMonitor.js,
// cuma di-parametrize (client/state-path/notify) biar bisa jalan paralel banyak akun.

const fs = require('fs');
const { ASSETS } = require('./assetConfig');
const { hitung: hitungExposure } = require('./calculator');
const { fetchCandles, sma } = require('./technicalAnalysis');
const { roundToStepSize } = require('./binanceExecutor');

function createSniperAccountTrader({ client, statePath, sendWA, getModalBase, apiCreds, onEvent }) {
  const notify = sendWA || (async () => {});
  const emit = onEvent || (() => {}); // hook OPSIONAL buat jurnal personal (Kaela Pro Trader)
  const baseUrl = apiCreds && apiCreds.testnet === false ? 'https://fapi.binance.com' : 'https://demo-fapi.binance.com';

  function loadState() {
    if (!fs.existsSync(statePath)) return { orders: [] };
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  }
  function saveState(s) { fs.writeFileSync(statePath, JSON.stringify(s, null, 2)); }

  async function fetchLivePrice(symbol) {
    const res = await fetch(`${baseUrl}/fapi/v1/ticker/price?symbol=${symbol}`);
    return parseFloat((await res.json()).price);
  }

  // Sniper SELALU wallet USDT (beda dari Nyopet yang bisa USDT/USDC tergantung aset).
  async function resolveModal() {
    if (getModalBase) {
      const override = await getModalBase('USDT');
      if (override != null) return override;
    }
    return client.getAccountBalance('USDT');
  }

  // Entry mirror -- no-op kalau originalOrderId ini UDAH dimirror akun ini (idempotent, aman
  // dijalanin berkali2 tiap siklus kayak semua eksekutor lain di proyek ini).
  async function mirrorEntry(originalOrder) {
    const state = loadState();
    if (state.orders.find((o) => o.originalOrderId === originalOrder.id)) return null;

    const assetCfg = ASSETS[originalOrder.asset] || ASSETS.btc;
    const [modal, livePrice] = await Promise.all([resolveModal(), fetchLivePrice(assetCfg.symbol)]);
    const calc = hitungExposure({ modal, entry: livePrice, stopLoss: originalOrder.sl });

    await client.setIsolatedMargin(assetCfg.symbol);
    await client.setLeverage(assetCfg.symbol, calc.leverage);
    const entryOrder = await client.placeMarketEntry({ symbol: assetCfg.symbol, direction: originalOrder.direction, notionalUsd: calc.nilaiPosisi, livePrice });
    const filledQty = parseFloat(entryOrder.executedQty);

    const { stepSize, quantityPrecision } = await client.getSymbolInfo(assetCfg.symbol);
    const halfQtyRaw = filledQty / 2;
    const halfQty = roundToStepSize(halfQtyRaw, stepSize, quantityPrecision);
    const tpPrice = originalOrder.partialTp || originalOrder.tp;
    if (halfQty > 0) {
      await client.placeTakeProfit({ symbol: assetCfg.symbol, direction: originalOrder.direction, tpPrice, quantity: halfQty });
    } else {
      await client.placeTakeProfit({ symbol: assetCfg.symbol, direction: originalOrder.direction, tpPrice, quantity: filledQty });
    }

    const mirror = {
      originalOrderId: originalOrder.id, asset: originalOrder.asset, mode: originalOrder.mode,
      direction: originalOrder.direction, sl: originalOrder.sl, tp: originalOrder.tp,
      status: 'floating', filledQty, halfQty: halfQty > 0 ? halfQty : filledQty,
      entryPriceReal: parseFloat(entryOrder.avgPrice), leverage: calc.leverage, marginUsd: calc.margin,
      openedAt: new Date().toISOString(), leg2: null, fullyClosedAt: null, pnlUsd: null,
    };
    state.orders.push(mirror);
    saveState(state);
    await notify(`🎯 [Sniper] Entry ${assetCfg.label} ${mirror.direction.toUpperCase()} @ ${mirror.entryPriceReal} -- leverage ${mirror.leverage}x, margin $${mirror.marginUsd.toFixed(2)}.`);
    emit({ entryId: mirror.originalOrderId, type: 'open', strategy: 'sniper', asset: mirror.asset, direction: mirror.direction, entryPrice: mirror.entryPriceReal, sl: mirror.sl, tp: mirror.tp, leverage: mirror.leverage, marginUsd: mirror.marginUsd, status: 'open', openedAt: mirror.openedAt });
    return mirror;
  }

  async function closeThenReopenBreakeven(mirror, assetCfg, remainingQty) {
    await client.cancelAllOpenOrders(assetCfg.symbol);
    await client.emergencyCloseMarket({ symbol: assetCfg.symbol, direction: mirror.direction, quantity: remainingQty });

    const [modalFull, livePrice] = await Promise.all([resolveModal(), fetchLivePrice(assetCfg.symbol)]);
    const calc = hitungExposure({ modal: modalFull, entry: livePrice, stopLoss: mirror.entryPriceReal });
    await client.setIsolatedMargin(assetCfg.symbol);
    await client.setLeverage(assetCfg.symbol, calc.leverage);
    const reopenOrder = await client.placeMarketEntry({ symbol: assetCfg.symbol, direction: mirror.direction, notionalUsd: remainingQty * livePrice, livePrice });
    const leg2Qty = parseFloat(reopenOrder.executedQty);
    const leg2Entry = parseFloat(reopenOrder.avgPrice);

    const state = loadState();
    const target = state.orders.find((o) => o.originalOrderId === mirror.originalOrderId);
    target.leg2 = { qty: leg2Qty, entryPrice: leg2Entry, leverage: calc.leverage, openedAt: new Date().toISOString() };
    saveState(state);
    await notify(`🎯 [Sniper] ${assetCfg.label}: partial TP kena -- leg2 dibuka @ ${leg2Entry}, target likuidasi ~breakeven ${mirror.entryPriceReal.toFixed(2)}.`);
  }

  function finalize(mirror, pnlUsd) {
    const state = loadState();
    const target = state.orders.find((o) => o.originalOrderId === mirror.originalOrderId);
    target.status = pnlUsd >= 0 ? 'closed_tp' : 'closed_sl';
    target.pnlUsd = pnlUsd;
    target.closedAt = new Date().toISOString();
    target.fullyClosedAt = new Date().toISOString();
    saveState(state);
    emit({ entryId: mirror.originalOrderId, type: 'close', status: 'closed', pnlUsd, closedAt: target.closedAt });
    return target;
  }

  async function processMirror(mirror) {
    const assetCfg = ASSETS[mirror.asset] || ASSETS.btc;
    const posRisk = await client.getPositionRisk(assetCfg.symbol);
    const posQty = Math.abs(parseFloat(posRisk.positionAmt));

    if (!mirror.leg2) {
      if (posQty <= 0) {
        // Kelikuidasi/tertutup sebelum sempat partial -- estimasi PNL dari entry vs harga sekarang
        // (rekonsiliasi presisi via income history bisa nyusul, tapi field ini WAJIB keisi biar
        // journal gak nyangkut 'open' selamanya).
        const livePrice = await fetchLivePrice(assetCfg.symbol);
        const pnlUsd = mirror.direction === 'buy' ? (livePrice - mirror.entryPriceReal) * mirror.filledQty : (mirror.entryPriceReal - livePrice) * mirror.filledQty;
        const closed = finalize(mirror, pnlUsd);
        await notify(`🎯 [Sniper] ${assetCfg.label}: posisi ditutup (kelikuidasi/SL) -- estimasi PNL $${pnlUsd.toFixed(2)}.`);
        return closed;
      }
      if (posQty < mirror.filledQty * 0.75) {
        await closeThenReopenBreakeven(mirror, assetCfg, posQty);
      }
      return null;
    }

    if (posQty <= 0) {
      const livePrice = await fetchLivePrice(assetCfg.symbol);
      const pnlUsd = mirror.direction === 'buy' ? (livePrice - mirror.leg2.entryPrice) * mirror.leg2.qty : (mirror.leg2.entryPrice - livePrice) * mirror.leg2.qty;
      const closed = finalize(mirror, pnlUsd);
      await notify(`🎯 [Sniper] ${assetCfg.label}: leg2 ditutup (kelikuidasi/breakeven) -- estimasi PNL $${pnlUsd.toFixed(2)}.`);
      return closed;
    }

    const daily = await fetchCandles(assetCfg.symbol, '1d', 220);
    const closes = daily.map((c) => c.close);
    const trailSma = sma(closes, 10);
    const lastClose = closes[closes.length - 1];
    const trendBroken = mirror.direction === 'buy' ? lastClose < trailSma : lastClose > trailSma;
    if (trendBroken) {
      const closeOrder = await client.emergencyCloseMarket({ symbol: assetCfg.symbol, direction: mirror.direction, quantity: mirror.leg2.qty });
      const exitPrice = parseFloat(closeOrder.avgPrice) || lastClose;
      const pnlUsd = mirror.direction === 'buy' ? (exitPrice - mirror.leg2.entryPrice) * mirror.leg2.qty : (mirror.leg2.entryPrice - exitPrice) * mirror.leg2.qty;
      const closed = finalize(mirror, pnlUsd);
      await notify(`🎯 [Sniper] ${assetCfg.label}: trend patah (trailing SMA10) -- tutup leg2, PNL $${pnlUsd.toFixed(2)}.`);
      return closed;
    }
    return null;
  }

  // originalActiveOrders = Olan punya sniper-orders.js getActiveOrders()-style array, yang
  // liveExecution.ok=true & belum fullyClosedAt -- caller (multiAccountExecutor.js) yang nyuplai.
  async function runCycle(originalActiveOrders) {
    const closedEntries = [];
    for (const o of originalActiveOrders) {
      try { await mirrorEntry(o); } catch (e) { console.log(`[SniperMultiAccount] mirrorEntry ${o.id} ERROR:`, e.message); }
    }
    const state = loadState();
    for (const mirror of state.orders.filter((o) => o.status === 'floating')) {
      try {
        const closed = await processMirror(mirror);
        if (closed) closedEntries.push(closed);
      } catch (e) { console.log(`[SniperMultiAccount] processMirror ${mirror.originalOrderId} ERROR:`, e.message); }
    }
    return { state: loadState(), closedEntries };
  }

  return { runCycle, loadState };
}

module.exports = { createSniperAccountTrader };
