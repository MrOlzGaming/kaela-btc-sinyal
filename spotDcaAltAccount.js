// Compound Alt DCA -- versi REAL per-akun (25 Agu 2026, Kaela Access). Beli SPOT beneran (bukan
// futures/leverage) 10 koin basket (lihat spotDcaAltShared.js buat spesifikasi lengkap: $10/koin
// tanggal 5 selama window Tanam, stop pas halving, jual hari ke-536 pasca halving, kompound
// PER-KOIN independen). Dana: Spot dulu, kalau kurang REDEEM dari Simple Earn Flexible dulu
// (binanceSpotEarnExecutor.js -- permintaan Olan, dolarnya sering "keparkir" otomatis di Earn).
//
// State per-akun: ./multi-account-state/<phone>-<mode>-compoundalt.json -- TERPISAH dari Sniper/
// Nyopet state (JANGAN dicampur), 1 sub-objek per simbol (holding/investasi/realisasi/log SENDIRI-
// SENDIRI per koin, BUKAN 1 bankroll gabungan -- ini disengaja, lihat spotDcaAltShared.js).
//
// Jurnal (Olan: "jurnalnya dibuat mantap") -- 1 baris Journal GAS per LOT beli (per koin per
// bulan), Status='open' pas beli, di-update 'closed'+PnlUsd pas jual (bisa banyak lot per koin
// per siklus krn DCA bulanan -- SEMUA dicatat apa adanya, gak diringkas/disembunyiin).
//
// ⚠️ BELUM PERNAH DITES LIVE -- WAJIB dicoba step-by-step (saldo -> redeem kecil -> beli kecil)
// pakai akun Olan sendiri dulu sebelum diaktifin buat member lain (sama kayak eksekutor lain di
// proyek ini pas pertama dibangun).

const fs = require('fs');
const crypto = require('crypto');
const { ALT10_SYMBOLS, PER_COIN_USD, WINDOW_START, HALVING_DATE, shouldBuyToday, shouldSellNow, sellTriggerDate, monthKey } = require('./spotDcaAltShared');

function coinLabel(symbol) { return symbol.replace('USDT', ''); }

function createSpotDcaAltAccountTrader({ client, statePath, sendWA, onEvent }) {
  const notify = sendWA || (async () => {});
  const emit = onEvent || (() => {});

  function loadState() {
    if (fs.existsSync(statePath)) return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const coins = {};
    ALT10_SYMBOLS.forEach((s) => {
      coins[s] = { heldQty: 0, totalInvestedCurrentCycle: 0, cycleStartedAt: null, totalRealizedCash: 0, completedCycles: [], buyLog: [] };
    });
    return { coins, lastBuyMonthKey: null, halvingStopNotified: false };
  }
  function saveState(s) { fs.writeFileSync(statePath, JSON.stringify(s, null, 2)); }

  async function runBuyStep(now, state) {
    const totalNeeded = PER_COIN_USD * ALT10_SYMBOLS.length + ALT10_SYMBOLS.reduce((sum, s) => sum + (state.coins[s].cycleStartedAt ? 0 : state.coins[s].totalRealizedCash), 0);
    let fundSource;
    try {
      fundSource = await client.ensureSpotBalance(totalNeeded, 'USDT');
    } catch (e) {
      await notify(`⚠️ [Compound Alt DCA] Gagal siapin dana buat beli bulanan (butuh ~$${totalNeeded.toFixed(2)}): ${e.message}`);
      return;
    }

    const bought = [];
    for (const symbol of ALT10_SYMBOLS) {
      const coinState = state.coins[symbol];
      const isFirstLotOfCycle = !coinState.cycleStartedAt;
      const lumpSum = isFirstLotOfCycle ? coinState.totalRealizedCash : 0;
      const buyAmountUsd = PER_COIN_USD + lumpSum;

      try {
        const order = await client.placeSpotMarketBuy({ symbol, quoteOrderQty: buyAmountUsd.toFixed(2) });
        if (isFirstLotOfCycle) { coinState.cycleStartedAt = now.toISOString(); coinState.totalRealizedCash = 0; }
        coinState.heldQty += order.executedQty;
        coinState.totalInvestedCurrentCycle += buyAmountUsd;

        // entryId DIBIKIN DI SINI (bukan nunggu balikan emit()) -- onEvent (buildJournalHook di
        // multiAccountExecutor.js) itu fire-and-forget SINKRON kayak pola sniperMultiAccount.js,
        // gak nunggu/balikin hasil GAS. UUID lokal dipasang duluan biar entryId yang dicatat di
        // buyLog PASTI sama persis sama EntryId yang bakal masuk Sheet Journal (dipakai lagi pas
        // jual buat update baris ini jadi 'closed').
        const journalEntryId = crypto.randomUUID();
        emit({
          entryId: journalEntryId, type: 'open', strategy: 'compound-alt', asset: coinLabel(symbol), direction: 'buy',
          entryPrice: order.avgPrice, marginUsd: buyAmountUsd, status: 'open', openedAt: now.toISOString(),
          note: isFirstLotOfCycle && lumpSum > 0 ? `Lump sum all-in $${lumpSum.toFixed(2)} + DCA $${PER_COIN_USD}` : `DCA bulanan $${PER_COIN_USD}`,
        });
        coinState.buyLog.push({ date: now.toISOString(), usdAmount: buyAmountUsd, price: order.avgPrice, qty: order.executedQty, journalEntryId });
        bought.push(`${coinLabel(symbol)}: $${buyAmountUsd.toFixed(2)} @ ${order.avgPrice.toFixed(4)}`);
      } catch (e) {
        console.log(`[SpotDcaAltAccount] Beli ${symbol} GAGAL:`, e.message);
        bought.push(`${coinLabel(symbol)}: GAGAL (${e.message})`);
      }
    }

    state.lastBuyMonthKey = monthKey(now);
    saveState(state);
    await notify(`🌱 [Compound Alt DCA] DCA bulanan jalan (sumber dana: ${fundSource.source === 'earn' ? `Spot+redeem Earn $${fundSource.redeemedTotal.toFixed(2)}` : 'Spot'}):\n${bought.join('\n')}`);
  }

  async function runHalvingStopStep(now, state) {
    const anyHeld = ALT10_SYMBOLS.some((s) => state.coins[s].heldQty > 0);
    if (!anyHeld) return;
    state.halvingStopNotified = true;
    saveState(state);
    await notify(`⚡ [Compound Alt DCA] Halving tiba -- DCA berhenti otomatis, posisi ditahan sampai ~${sellTriggerDate().toISOString().slice(0, 10)}.`);
  }

  async function runSellStep(now, state) {
    const results = [];
    for (const symbol of ALT10_SYMBOLS) {
      const coinState = state.coins[symbol];
      if (coinState.heldQty <= 0) continue;
      try {
        const order = await client.placeSpotMarketSell({ symbol, quantity: coinState.heldQty });
        const proceedsUsd = order.executedQty * order.avgPrice;
        const pnlUsd = proceedsUsd - coinState.totalInvestedCurrentCycle;
        const pnlPct = coinState.totalInvestedCurrentCycle > 0 ? (pnlUsd / coinState.totalInvestedCurrentCycle) * 100 : 0;

        // Tutup SEMUA lot (journal row) koin ini di siklus ini -- PnL per-lot dihitung proporsional
        // dari harga masuk lot itu vs harga jual sama (avgPrice), bukan cuma 1 angka gabungan, biar
        // jurnal tetap akurat per baris.
        for (const lot of coinState.buyLog) {
          if (!lot.journalEntryId) continue;
          const lotPnl = (order.avgPrice - lot.price) * lot.qty;
          emit({ type: 'close', entryId: lot.journalEntryId, status: 'closed', pnlUsd: lotPnl, closedAt: now.toISOString() });
        }

        coinState.completedCycles.push({
          buyWindowStart: coinState.cycleStartedAt, halvingDate: HALVING_DATE.toISOString(), soldAt: now.toISOString(),
          totalInvested: coinState.totalInvestedCurrentCycle, qtyBought: coinState.heldQty,
          sellPriceUsd: order.avgPrice, proceedsUsd, pnlUsd, pnlPct,
        });
        coinState.totalRealizedCash = proceedsUsd;
        coinState.heldQty = 0; coinState.totalInvestedCurrentCycle = 0; coinState.cycleStartedAt = null; coinState.buyLog = [];
        results.push(`${coinLabel(symbol)}: jual @ ${order.avgPrice.toFixed(4)} -> $${proceedsUsd.toFixed(2)} (${pnlUsd >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)`);
      } catch (e) {
        console.log(`[SpotDcaAltAccount] Jual ${symbol} GAGAL:`, e.message);
        results.push(`${coinLabel(symbol)}: GAGAL jual (${e.message})`);
      }
    }
    if (results.length === 0) return;
    state.halvingStopNotified = false; // reset buat siklus berikutnya
    saveState(state);
    await notify(`🌾 [Compound Alt DCA] Musim Panen -- semua koin dijual:\n${results.join('\n')}\n\nHasil jual bakal all-in balik ke koin yang sama pas Tanam siklus berikutnya.`);
  }

  async function runCycle(now = new Date()) {
    const state = loadState();
    if (shouldBuyToday(now, state.lastBuyMonthKey)) await runBuyStep(now, state);
    if (now >= HALVING_DATE && !state.halvingStopNotified) await runHalvingStopStep(now, loadState());
    if (shouldSellNow(now)) await runSellStep(now, loadState());
    return loadState();
  }

  return { runCycle, loadState };
}

module.exports = { createSpotDcaAltAccountTrader };
