// Compound Alt DCA -- versi SHADOW PUBLIK (25 Agu 2026, permintaan Olan: "biar aku dan temen-temen
// tiru"). BEDA dari spotDca.js (BTC-only, harian, TANPA WA) -- ini 10 koin, BULANAN (tanggal 5),
// DAN LOUD ke grup WA di 3 titik (beli/stop/jual) SESUAI TEMPLATE YANG DIAPPROVE Olan 25 Agu 2026 --
// biar member bisa manual meniru beli/jual di akun mereka sendiri. Spesifikasi lengkap window/
// basket/hari-jual ada di spotDcaAltShared.js (dipakai bareng versi real spotDcaAltAccount.js).
//
// Harga LIVE publik (data-api.binance.vision, TANPA API key -- sama endpoint kayak spotDca.js),
// modal FIKTIF (bayangan Kaela, bukan uang beneran) -- state kaela-spot-alt.json, ditampilkan di
// tab baru halaman Jurnal (web/jurnal.html).

const fs = require('fs');
const path = require('path');
const { sendWhatsApp } = require('./fonnte');
const { fetchWithRetry } = require('./httpRetry');
const { ALT10_SYMBOLS, PER_COIN_USD, HALVING_DATE, shouldBuyToday, shouldSellNow, sellTriggerDate, monthKey } = require('./spotDcaAltShared');

const SPOT_ALT_PATH = path.join(__dirname, 'kaela-spot-alt.json');

function coinLabel(symbol) { return symbol.replace('USDT', ''); }
function fmtPrice(n) { return n.toLocaleString('en-US', { minimumFractionDigits: n >= 1 ? 2 : 4, maximumFractionDigits: n >= 1 ? 2 : 4 }); }

function load() {
  if (fs.existsSync(SPOT_ALT_PATH)) return JSON.parse(fs.readFileSync(SPOT_ALT_PATH, 'utf8'));
  const coins = {};
  ALT10_SYMBOLS.forEach((s) => {
    coins[s] = { heldQty: 0, totalInvestedCurrentCycle: 0, cycleStartedAt: null, totalRealizedCash: 0, completedCycles: [], buyLog: [] };
  });
  return { coins, lastBuyMonthKey: null, halvingStopNotified: false, pendingLiveBuy: null, pendingLiveSell: null };
}
function save(state) { fs.writeFileSync(SPOT_ALT_PATH, JSON.stringify(state, null, 2)); }

async function fetchLivePrices() {
  const res = await fetchWithRetry(`https://data-api.binance.vision/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(ALT10_SYMBOLS))}`);
  const data = await res.json();
  const prices = {};
  data.forEach((d) => { prices[d.symbol] = parseFloat(d.price); });
  return prices;
}

async function runBuyStep(now, state) {
  const prices = await fetchLivePrices();
  const bought = [];
  let dcaCountThisCoin = 0;

  for (const symbol of ALT10_SYMBOLS) {
    const coinState = state.coins[symbol];
    const isFirstLotOfCycle = !coinState.cycleStartedAt;
    const lumpSum = isFirstLotOfCycle ? coinState.totalRealizedCash : 0;
    const buyAmountUsd = PER_COIN_USD + lumpSum;
    const price = prices[symbol];
    if (!price) { bought.push(`${coinLabel(symbol)}: gagal ambil harga, skip`); continue; }

    const qty = buyAmountUsd / price;
    if (isFirstLotOfCycle) { coinState.cycleStartedAt = now.toISOString(); coinState.totalRealizedCash = 0; }
    coinState.heldQty += qty;
    coinState.totalInvestedCurrentCycle += buyAmountUsd;
    coinState.buyLog.push({ date: now.toISOString(), usdAmount: buyAmountUsd, price, qty });
    bought.push(`🔸 ${coinLabel(symbol)}: $${buyAmountUsd.toFixed(2)} @ $${fmtPrice(price)}`);
    dcaCountThisCoin = coinState.buyLog.length;
  }

  state.lastBuyMonthKey = monthKey(now);
  // Antrian buat eksekusi LIVE (29 Agu 2026, permintaan Olan: "tradingan Kaela itu pionir buat
  // diikuti realistic" -- gak boleh shadow doang lagi) -- ini jalan di GitHub Actions (cloud),
  // Binance DIBLOKIR dari sana (HTTP 451, sama kasus kayak Sniper) jadi CUMA nyatet rencana beli
  // di sini, eksekusi beneran nyusul spotAltLiveExecutor.js (LOCAL, komputer Olan) siklus berikutnya.
  state.pendingLiveBuy = { monthKey: state.lastBuyMonthKey, amounts: {}, createdAt: now.toISOString() };
  for (const symbol of ALT10_SYMBOLS) {
    const lastLog = state.coins[symbol].buyLog[state.coins[symbol].buyLog.length - 1];
    if (lastLog) state.pendingLiveBuy.amounts[symbol] = lastLog.usdAmount;
  }
  save(state);

  const totalInvestedAll = ALT10_SYMBOLS.reduce((sum, s) => sum + state.coins[s].totalInvestedCurrentCycle, 0);
  // "Mau ikut?" DIBUANG (29 Agu 2026, permintaan Olan: "udah gak ada ajakan lagi, buka posisi/buy
  // demo sendiri udah jadi sinyalnya") -- Compound Alt sekarang eksekusi LIVE otomatis (bukan
  // shadow), jadi pesannya laporan FAKTUAL apa yang Kaela lakuin, bukan tawaran buat diikuti.
  const message = `🌱 Compound Alt DCA — Musim Tanam, waktunya beli!\n\n` +
    `🧪 DEMO — Kaela beli $10 di masing-masing 10 koin ini (total $100) di akun Binance Demo (Spot Testnet, eksekusi live nyusul ~15 menit lewat sinkronisasi lokal):\n\n${bought.join('\n')}\n\n` +
    `DCA ke-${dcaCountThisCoin} siklus ini · Total modal masuk siklus ini: $${totalInvestedAll.toFixed(2)}`;
  await sendWhatsApp(message);
  console.log('[SpotDcaAlt]', message);
  return { action: 'buy' };
}

async function runHalvingStopStep(now, state) {
  const anyHeld = ALT10_SYMBOLS.some((s) => state.coins[s].heldQty > 0);
  if (!anyHeld) return { action: 'none' };
  state.halvingStopNotified = true;
  save(state);
  const totalInvestedAll = ALT10_SYMBOLS.reduce((sum, s) => sum + state.coins[s].totalInvestedCurrentCycle, 0);
  const message = `⚡ Compound Alt DCA — Halving tiba, STOP beli!\n\n` +
    `Fase Tanam basket 10 koin ini selesai. Mulai sekarang TAHAN aja, jangan nambah beli lagi.\n\n` +
    `Total modal yang udah masuk siklus ini: $${totalInvestedAll.toFixed(2)}\n\n` +
    `Kaela bakal kabarin lagi pas waktunya jual (perkiraan sekitar ${sellTriggerDate().toISOString().slice(0, 10)}).`;
  await sendWhatsApp(message);
  console.log('[SpotDcaAlt]', message);
  return { action: 'halving-stop' };
}

async function runSellStep(now, state) {
  const prices = await fetchLivePrices();
  const results = [];
  let totalProceeds = 0, totalInvestedAll = 0;
  // Antrian jual LIVE (29 Agu 2026) -- pola sama kayak pendingLiveBuy, qty diambil SEBELUM
  // coinState.heldQty di-nolin di bawah (posisi shadow di-reset abis dicatat, bukan sebelum).
  const pendingLiveSell = { symbols: {}, createdAt: now.toISOString() };

  for (const symbol of ALT10_SYMBOLS) {
    const coinState = state.coins[symbol];
    if (coinState.heldQty <= 0) continue;
    pendingLiveSell.symbols[symbol] = coinState.heldQty;
    const price = prices[symbol];
    if (!price) { results.push(`${coinLabel(symbol)}: gagal ambil harga, skip jual`); continue; }

    const proceedsUsd = coinState.heldQty * price;
    const pnlUsd = proceedsUsd - coinState.totalInvestedCurrentCycle;
    const pnlPct = coinState.totalInvestedCurrentCycle > 0 ? (pnlUsd / coinState.totalInvestedCurrentCycle) * 100 : 0;

    coinState.completedCycles.push({
      buyWindowStart: coinState.cycleStartedAt, halvingDate: HALVING_DATE.toISOString(), soldAt: now.toISOString(),
      totalInvested: coinState.totalInvestedCurrentCycle, qtyBought: coinState.heldQty,
      sellPriceUsd: price, proceedsUsd, pnlUsd, pnlPct,
    });
    totalProceeds += proceedsUsd;
    totalInvestedAll += coinState.totalInvestedCurrentCycle;
    coinState.totalRealizedCash = proceedsUsd;
    coinState.heldQty = 0; coinState.totalInvestedCurrentCycle = 0; coinState.cycleStartedAt = null; coinState.buyLog = [];
    results.push(`🔸 ${coinLabel(symbol)} @ $${fmtPrice(price)}: $${proceedsUsd.toFixed(2)} (${pnlUsd >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)`);
  }

  if (results.length === 0) return { action: 'none' };
  state.halvingStopNotified = false;
  state.pendingLiveSell = pendingLiveSell;
  save(state);
  const pctTotal = totalInvestedAll > 0 ? ((totalProceeds / totalInvestedAll - 1) * 100) : 0;
  const message = `🌾 Compound Alt DCA — JUAL SEKARANG!\n\n` +
    `Ini titiknya — rata-rata historis hari puncak siklus (hari ke-536 pasca halving). JUAL SEMUA 10 koin basket ini sekarang juga.\n\n` +
    `${results.join('\n')}\n\n` +
    `Hasil siklus ini: $${totalProceeds.toFixed(2)} (modal $${totalInvestedAll.toFixed(2)} → ${pctTotal >= 0 ? '+' : ''}${pctTotal.toFixed(0)}%)\n\n` +
    `Hasil jual bakal Kaela all-in-in lagi ke koin yang sama pas Musim Tanam berikutnya, plus tetap lanjut DCA rutin.`;
  await sendWhatsApp(message);
  console.log('[SpotDcaAlt]', message);
  return { action: 'sell' };
}

// Dipanggil 1x/hari (bareng sniper-daily-trigger.yml, SAMA cadence spotDca.js) -- internal cek
// tanggal 5+window/stop-halving/hari-jual sendiri, idempotent via lastBuyMonthKey+halvingStopNotified.
async function runDailyTick(now = new Date()) {
  const state = load();
  if (shouldBuyToday(now, state.lastBuyMonthKey)) return runBuyStep(now, state);
  if (now >= HALVING_DATE && !state.halvingStopNotified) return runHalvingStopStep(now, state);
  if (shouldSellNow(now)) return runSellStep(now, state);
  console.log('[SpotDcaAlt]', now.toISOString(), '-- gak ada aksi hari ini, skip.');
  return { action: 'none' };
}

if (require.main === module) {
  runDailyTick(new Date()).catch((e) => {
    console.error('ERROR spotDcaAlt.js:', e.message);
    process.exit(1);
  });
}

module.exports = { load, save, runDailyTick };
