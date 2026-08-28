// Musiman/Spot BTC DCA -- versi REAL per-akun (29 Agu 2026, permintaan Olan: "copy sistem demo
// semua ke real, siapin"). Beli SPOT BTC beneran (bukan futures/leverage) $5/hari selama window
// Musim Tanam, stop pas halving, jual otomatis di titik Panen. Pola SAMA PERSIS kayak
// spotDcaAltAccount.js (Compound Alt real per-akun), cuma 1 koin bukan 10 -- lihat file itu buat
// pola referensi lengkap (dana: Spot dulu, kalau kurang redeem Simple Earn Flexible dulu).
//
// State per-akun: ./multi-account-state/<phone>-<mode>-musiman.json -- TERPISAH dari state
// shadow publik (kaela-spot.json) DAN dari Compound Alt (beda file lagi, JANGAN dicampur).
//
// Jurnal -- 1 baris Journal GAS per LOT beli (per hari), Status='open' pas beli, di-update
// 'closed'+PnlUsd pas jual siklus itu (bisa banyak lot per siklus krn DCA harian).
//
// ⚠️ BELUM PERNAH DITES LIVE -- sama peringatan kayak spotDcaAltAccount.js, WAJIB dites
// step-by-step (saldo -> redeem kecil -> beli kecil) pakai akun Olan sendiri dulu.

const fs = require('fs');
const { localDateKey } = require('./config');
const { WINDOW_START, NEXT_HALVING_EST } = require('./groupReport');

const DAILY_BUY_USD = 5; // sama kayak shadow publik (spotDca.js) -- Binance Spot minimum notional $5/order BTCUSDT
const SELL_AFTER_HALVING_DAYS = Math.round((368 + 549) / 2); // 459, sama persis spotDca.js
const MUSIMAN_SYMBOL = 'BTCUSDT';

function createSpotDcaAccountTrader({ client, statePath, sendWA, onEvent }) {
  const notify = sendWA || (async () => {});
  const emit = onEvent || (() => {});

  function loadState() {
    if (fs.existsSync(statePath)) return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return {
      btcHeld: 0, totalInvestedCurrentCycle: 0, cycleStartedAt: null,
      totalRealizedCash: 0, completedCycles: [], buyLog: [], lastBuyDateKey: null,
    };
  }
  function saveState(s) { fs.writeFileSync(statePath, JSON.stringify(s, null, 2)); }

  function sellTriggerDate() {
    return new Date(NEXT_HALVING_EST.getTime() + SELL_AFTER_HALVING_DAYS * 86400000);
  }

  async function runBuyStep(now, state) {
    let fundSource;
    try {
      fundSource = await client.ensureSpotBalance(DAILY_BUY_USD, 'USDT');
    } catch (e) {
      await notify(`⚠️ [Musiman DCA] Gagal siapin dana buat beli harian (butuh $${DAILY_BUY_USD}): ${e.message}`);
      return;
    }

    try {
      const order = await client.placeSpotMarketBuy({ symbol: MUSIMAN_SYMBOL, quoteOrderQty: DAILY_BUY_USD.toFixed(2) });
      if (!state.cycleStartedAt) state.cycleStartedAt = now.toISOString();
      state.btcHeld += order.executedQty;
      state.totalInvestedCurrentCycle += DAILY_BUY_USD;

      const journalEntryId = require('crypto').randomUUID();
      emit({
        entryId: journalEntryId, type: 'open', strategy: 'musiman', asset: 'btc', direction: 'buy',
        entryPrice: order.avgPrice, marginUsd: DAILY_BUY_USD, status: 'open', openedAt: now.toISOString(),
        note: `DCA harian $${DAILY_BUY_USD}`,
      });
      state.buyLog.push({ date: now.toISOString(), usdAmount: DAILY_BUY_USD, price: order.avgPrice, btcBought: order.executedQty, journalEntryId });
      state.lastBuyDateKey = localDateKey(now);
      saveState(state);
      await notify(`🌱 [Musiman DCA] Beli harian jalan (sumber dana: ${fundSource.source === 'earn' ? `Spot+redeem Earn $${fundSource.redeemedTotal.toFixed(2)}` : 'Spot'}):\nBTC: $${DAILY_BUY_USD.toFixed(2)} @ ${order.avgPrice.toFixed(2)} -> ${order.executedQty.toFixed(8)} BTC`);
    } catch (e) {
      console.log('[SpotDcaAccount] Beli BTC GAGAL:', e.message);
      await notify(`⚠️ [Musiman DCA] Beli harian GAGAL: ${e.message}`);
    }
  }

  async function runSellStep(now, state) {
    if (state.btcHeld <= 0) return;
    try {
      const order = await client.placeSpotMarketSell({ symbol: MUSIMAN_SYMBOL, quantity: state.btcHeld });
      const proceedsUsd = order.executedQty * order.avgPrice;
      const pnlUsd = proceedsUsd - state.totalInvestedCurrentCycle;
      const pnlPct = state.totalInvestedCurrentCycle > 0 ? (pnlUsd / state.totalInvestedCurrentCycle) * 100 : 0;

      for (const lot of state.buyLog) {
        if (!lot.journalEntryId) continue;
        const lotPnl = (order.avgPrice - lot.price) * lot.btcBought;
        emit({ type: 'close', entryId: lot.journalEntryId, status: 'closed', pnlUsd: lotPnl, closedAt: now.toISOString() });
      }

      state.completedCycles.push({
        buyWindowStart: state.cycleStartedAt, halvingDate: NEXT_HALVING_EST.toISOString(), soldAt: now.toISOString(),
        totalInvested: state.totalInvestedCurrentCycle, btcBought: state.btcHeld,
        avgCostUsd: state.totalInvestedCurrentCycle / state.btcHeld, sellPriceUsd: order.avgPrice, proceedsUsd, pnlUsd, pnlPct,
      });
      state.totalRealizedCash += proceedsUsd;
      state.btcHeld = 0; state.totalInvestedCurrentCycle = 0; state.cycleStartedAt = null; state.buyLog = [];
      saveState(state);
      await notify(`🌾 [Musiman DCA] Musim Panen -- BTC dijual:\n${order.executedQty.toFixed(8)} BTC @ ${order.avgPrice.toFixed(2)} -> $${proceedsUsd.toFixed(2)} (${pnlUsd >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)`);
    } catch (e) {
      console.log('[SpotDcaAccount] Jual BTC GAGAL:', e.message);
      await notify(`⚠️ [Musiman DCA] Jual Musim Panen GAGAL: ${e.message}`);
    }
  }

  async function runCycle(now = new Date()) {
    const state = loadState();
    const dayKey = localDateKey(now);
    const inBuyWindow = now >= WINDOW_START && now < NEXT_HALVING_EST;
    if (inBuyWindow && state.lastBuyDateKey !== dayKey) await runBuyStep(now, loadState());
    if (now >= sellTriggerDate() && loadState().btcHeld > 0) await runSellStep(now, loadState());
    return loadState();
  }

  return { runCycle, loadState };
}

module.exports = { createSpotDcaAccountTrader, DAILY_BUY_USD, SELL_AFTER_HALVING_DAYS };
