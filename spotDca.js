// DCA Spot Musiman -- BAYANGAN Kaela sendiri (15 Agu 2026, permintaan Olan), TERPISAH TOTAL dari
// bankroll Sniper (kaelaBankroll.js) DAN dari rencana real Olan (state.json/renderSiklusHalvingPanel).
// Mekanisme: tiap hari kalender WITA SELAMA window Musim Tanam (WINDOW_START) sampai HARI HALVING
// tiba, Kaela "beli" $2 BTC spot (modal BARU tiap hari, bukan ditarik dari saldo lama -- keputusan
// eksplisit Olan biar gak pernah macet kehabisan modal walau siklus awal kecil). Begitu halving
// lewat, STOP beli, TAHAN sampai titik jual otomatis (lihat SELL_AFTER_HALVING_DAYS di bawah), baru
// jual SEMUA sekaligus -- hasil jual masuk `totalRealizedCash` (akumulasi lintas siklus, TERUS
// bertambah/di-compound, gak pernah ditarik keluar strategi ini).
//
// TANPA notifikasi WA sama sekali (instruksi eksplisit Olan: "tanpa info ke grup") -- murni
// tercatat ke file ini, ditampilkan di tab Spot halaman Jurnal (buildDashboard.js).
//
// KETERBATASAN JUJUR: NEXT_HALVING_EST (groupReport.js) itu KONSTANTA statis buat halving
// BERIKUTNYA doang -- kodebase ini belum punya kalkulasi otomatis "halving sesudah itu lagi"
// buat siklus ke-3/ke-4 dst. Begitu 1 siklus selesai (beli->jual), modul ini otomatis BERHENTI
// (idle) sampai NEXT_HALVING_EST di-update manual ke tanggal halving berikutnya -- sama seperti
// keterbatasan yang sudah ada di sistem Musiman real (bukan regresi baru dari fitur ini).

const fs = require('fs');
const path = require('path');
const { localDateKey } = require('./config');
const { WINDOW_START, NEXT_HALVING_EST } = require('./groupReport');
const { fetchWithRetry } = require('./httpRetry');

const SPOT_PATH = path.join(__dirname, 'kaela-spot.json');
const DAILY_BUY_USD = 2;
// Titik tengah rentang Musim Panen (368-549 hari setelah halving, sama persis sama rentang yang
// udah dipakai buat rencana real Olan) -- Panen ASLI itu diskresioner/manual (gak ada tanggal
// pasti), tapi simulasi BAYANGAN ini WAJIB deterministik biar bisa otomatis, jadi dipilih titik
// tengahnya sebagai representasi wajar, BUKAN klaim "ini tanggal terbaik buat jual beneran".
const SELL_AFTER_HALVING_DAYS = Math.round((368 + 549) / 2); // 459

function load() {
  if (!fs.existsSync(SPOT_PATH)) {
    return {
      btcHeld: 0, totalInvestedCurrentCycle: 0, cycleStartedAt: null,
      totalRealizedCash: 0, completedCycles: [], buyLog: [], lastBuyDateKey: null,
    };
  }
  return JSON.parse(fs.readFileSync(SPOT_PATH, 'utf8'));
}

function save(state) {
  fs.writeFileSync(SPOT_PATH, JSON.stringify(state, null, 2));
}

async function fetchLivePrice() {
  const res = await fetchWithRetry('https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT');
  const data = await res.json();
  return parseFloat(data.price);
}

function sellTriggerDate() {
  return new Date(NEXT_HALVING_EST.getTime() + SELL_AFTER_HALVING_DAYS * 86400000);
}

// Dipanggil 1x/hari (bareng sniper-daily-trigger.yml) -- idempotent via lastBuyDateKey/cek status.
async function runDailyTick(now = new Date()) {
  const state = load();
  const dayKey = localDateKey(now);

  const inBuyWindow = now >= WINDOW_START && now < NEXT_HALVING_EST;

  if (inBuyWindow && state.lastBuyDateKey !== dayKey) {
    const price = await fetchLivePrice();
    const btcBought = DAILY_BUY_USD / price;
    if (!state.cycleStartedAt) state.cycleStartedAt = now.toISOString();
    state.btcHeld += btcBought;
    state.totalInvestedCurrentCycle += DAILY_BUY_USD;
    state.buyLog.push({ date: now.toISOString(), usdAmount: DAILY_BUY_USD, price, btcBought });
    state.lastBuyDateKey = dayKey;
    save(state);
    console.log(`[SpotDca] Beli $${DAILY_BUY_USD} BTC @ $${price.toFixed(2)} -> ${btcBought.toFixed(8)} BTC. Total held: ${state.btcHeld.toFixed(8)} BTC.`);
    return { action: 'buy', btcBought, price };
  }

  if (now >= sellTriggerDate() && state.btcHeld > 0) {
    const price = await fetchLivePrice();
    const proceedsUsd = state.btcHeld * price;
    const avgCostUsd = state.totalInvestedCurrentCycle / state.btcHeld;
    const pnlUsd = proceedsUsd - state.totalInvestedCurrentCycle;
    const pnlPct = state.totalInvestedCurrentCycle > 0 ? (pnlUsd / state.totalInvestedCurrentCycle) * 100 : 0;

    state.completedCycles.push({
      buyWindowStart: state.cycleStartedAt,
      halvingDate: NEXT_HALVING_EST.toISOString(),
      soldAt: now.toISOString(),
      totalInvested: state.totalInvestedCurrentCycle,
      btcBought: state.btcHeld,
      avgCostUsd,
      sellPriceUsd: price,
      proceedsUsd,
      pnlUsd,
      pnlPct,
    });
    state.totalRealizedCash += proceedsUsd;
    state.btcHeld = 0;
    state.totalInvestedCurrentCycle = 0;
    state.cycleStartedAt = null;
    state.buyLog = [];
    save(state);
    console.log(`[SpotDca] Musim Panen tiba -- jual semua ${state.completedCycles[state.completedCycles.length - 1].btcBought.toFixed(8)} BTC @ $${price.toFixed(2)}, proceeds $${proceedsUsd.toFixed(2)}, PnL ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)} (${pnlPct.toFixed(1)}%). Total saldo terealisasi: $${state.totalRealizedCash.toFixed(2)}.`);
    return { action: 'sell', proceedsUsd, pnlUsd };
  }

  console.log('[SpotDca]', now.toISOString(), '-- di luar window beli, belum waktunya jual, skip.');
  return { action: 'none' };
}

if (require.main === module) {
  runDailyTick(new Date()).catch((e) => {
    console.error('ERROR spotDca.js:', e.message);
    process.exit(1);
  });
}

module.exports = { load, save, runDailyTick, sellTriggerDate, DAILY_BUY_USD, SELL_AFTER_HALVING_DAYS };
