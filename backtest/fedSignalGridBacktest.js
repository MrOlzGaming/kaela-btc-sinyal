// backtest/fedSignalGridBacktest.js -- (5 Sep 2026, permintaan Olan: "grid trading fokus sinyal
// FED hawkish/dovish, short 10%/-10%, long 30%/-10%, stacking bertahap, compound, di Bitget") --
// UJI DULU sebelum bangun eksekusi beneran (disiplin proyek ini, sama kayak semua strategi lain).
//
// ISTILAH: ini BUKAN grid trading klasik (direction-agnostic, profit 2 arah di sideways market).
// Ini "directional DCA/martingale stacking" -- 1 basket floating (rata-rata harga, SATU TP/SL
// buat seluruh basket -- riset konfirmasi ini PERSIS cara kerja bot DCA populer kayak 3Commas,
// BUKAN model realisasi-per-layer kayak sistem BTC-ZIL punya Olan yang beda proyek).
//
// SCOPE DATA (kendala sama kayak riset DXY & NFP sebelumnya): angka forecast/actual historis
// buat SEMUA event (CPI dst) gak ada yang gratis. Jalan keluar yang kepake: ARAH ditentuin dari
// REAKSI HARGA BTC SENDIRI (T-5 s/d T+30 menit abis event, ambang 0.10% -- sama kayak
// econReactionBacktest.js), BUKAN dari nilai forecast vs actual. Event yang dipake DULU:
// FOMC (tanggal keputusan historis 2019-2026, dihardcode dari federalreserve.gov -- tanggal event
// itu sendiri GRATIS & publik, beda dari angka forecast) + NFP (deterministik, reuse dari
// econReactionBacktest.js). CPI/event lain BELUM dimasukin -- nunggu hasil ini kebukti dulu.
//
// SIMULASI BASKET (per event signal):
// - Gak ada basket aktif -> buka basket baru, arah = arah reaksi, layer 1 langsung masuk.
// - Basket aktif ARAH SAMA -> event diabaikan (nambah layer PRICE-TRIGGERED doang, bukan event).
// - Basket aktif ARAH BEDA -> basket lama DITUTUP PAKSA (sinyal balik arah = alasan berhenti,
//   sesuai permintaan Olan), basket baru dibuka di arah baru.
// - Tiap candle selama basket aktif: cek TP/SL agregat (% dari modal, LONG:+30%/-10%,
//   SHORT:+10%/-10%), cek trigger nambah layer (harga gerak X% lawan arah dari layer TERAKHIR).
// - Basket kelamaan (>MAX_HOLD_DAYS) dipaksa tutup di floating PnL saat itu (biar gak ngegantung
//   nunggu bertahun-tahun -- trader beneran juga gak akan biarin gitu).

const { fetchKlines } = require('./fetchKlines');
const { generateNfpEvents } = require('./econReactionBacktest.js');
// (5 Sep 2026) generateFomcEvents/fomcTimestampUTC DIPINDAH ke ../fedEvents.js (dipakai bareng
// live trader) -- logic+tanggal PERSIS SAMA, gak ada perubahan perilaku backtest ini.
const { generateFomcEvents: generateFomcEventsShared } = require('../fedEvents');
function generateFomcEvents() { return generateFomcEventsShared(false); } // default lama: cuma yg udah lewat

const REACTION_THRESHOLD_PCT = 0.10;
const REACTION_WINDOW_MIN = 30; // T-5 s/d T+30 menit (dilebarin dikit dari scalp 15m, ini basis buat HOLD BERHARI-HARI bukan scalp)
const MAX_HOLD_DAYS = 30;
const SL_PCT = 10; // sama utk LONG & SHORT (permintaan Olan)
const LONG_TP_PCT = 30;
const SHORT_TP_PCT = 10;

// Skenario "seberapa agresif" stacking -- angka = % NOTIONAL dari modal per layer (SUDAH termasuk
// efek leverage implisit -- makin gede totalnya, makin gede leverage efektif basket).
const LAYER_SCHEDULES = {
  konservatif_total100pct: [10, 15, 20, 25, 30],
  moderat_total200pct: [20, 30, 40, 50, 60],
  agresif_total400pct: [40, 60, 80, 100, 120],
};
const LAYER_TRIGGER_PCT_VARIANTS = [1, 2, 3]; // % gerak lawan arah dari layer terakhir buat nambah layer baru
const TREND_SMA_PERIOD = 480; // 15m candle x480 = ~5 hari -- filter tren jangka pendek

// ============ RACIKAN FINAL (5 Sep 2026, keputusan Olan lewat AskUserQuestion) ============
// LONG-ONLY (dovish) -- SHORT (hawkish) KONSISTEN rugi di SEMUA kombinasi param+hold yang dites,
// sejalan sama pola lama [[feedback-nyopet-buyonly]]. Skedul Agresif (leverage efektif ~13x,
// diturunin dari jarak SL-agregat vs liquidation, aman 3x lipat -- lihat chat, BUKAN cuma comot
// angka) + filter tren SMA480 (~5 hari) + hold maks 7 hari -- robust di 2 era independen (2019-2022
// vs 2023-2026), net-of-cost PF>1 (lihat main() di bawah). INI yang dipakai fedDovishGridTrader.js
// LIVE -- kalau parameter di sini diubah, WAJIB re-backtest dulu sebelum ikut diubah di live trader.
const FINAL_RECIPE = {
  layerSchedulePct: LAYER_SCHEDULES.agresif_total400pct, // [40,60,80,100,120] -- % modal per layer
  layerTriggerPct: 2, // nambah layer tiap harga gerak 2% lawan arah dari layer terakhir
  maxHoldDays: 7,
  trendSmaPeriod: TREND_SMA_PERIOD,
  leverage: 13,
  slPct: SL_PCT, // 10% modal, sama utk LONG&SHORT (SHORT gak dipakai live, tapi angkanya tetap relevan buat basket LONG)
  longTpPct: LONG_TP_PCT, // 30% modal
};

function binarySearchIdxAtOrAfter(candles, targetMs) {
  let lo = 0, hi = candles.length - 1, ans = candles.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].openTime >= targetMs) { ans = mid; hi = mid - 1; } else { lo = mid + 1; }
  }
  return ans;
}

// Tahap 1: tentuin arah sinyal tiap event (reaksi BTC T-5..T+30 menit abis event)
function computeSignals(candles, events) {
  const signals = [];
  for (const ev of events) {
    const idxBefore = binarySearchIdxAtOrAfter(candles, ev.timeMs - 5 * 60 * 1000);
    const idxSignal = binarySearchIdxAtOrAfter(candles, ev.timeMs + REACTION_WINDOW_MIN * 60 * 1000);
    if (idxBefore >= candles.length || idxSignal >= candles.length) continue;
    const priceBefore = candles[idxBefore].open;
    const priceSignal = candles[idxSignal].open;
    const reactionPct = ((priceSignal - priceBefore) / priceBefore) * 100;
    if (Math.abs(reactionPct) < REACTION_THRESHOLD_PCT) continue;
    signals.push({ label: ev.label, timeMs: ev.timeMs, idxSignal, direction: reactionPct > 0 ? 'LONG' : 'SHORT', reactionPct });
  }
  signals.sort((a, b) => a.idxSignal - b.idxSignal);
  return signals;
}

// Tahap 2: 1 pass linear ngelewatin candle, jalanin basket stacking
// `layerScheduleInputPct` = angka PERSEN buat dibaca manusia (10 = "10% modal") -- WAJIB
// dikonversi ke desimal (0.10) sebelum dipake ngitung, atau TP/SL kesundul 100x lebih gampang
// dari niatnya (bug nyata yang ketemu 5 Sep 2026: SL "10%" kena cuma dari harga gerak 1%).
//
// `maxHoldDays` (BARU, ganti MAX_HOLD_DAYS konstan) + `trendSma` (BARU, opsional -- array SMA
// SEJAJAR index `candles`, null = gak difilter) -- DUA parameter ini yang bikin racikan akhir
// ("hold 7 hari" + "filter tren SMA480") -- ⚠️ CATATAN PENTING 5 Sep 2026: kombinasi ini
// SEBELUMNYA cuma pernah dites di script sekali-pakai (node -e interaktif), BELUM PERNAH beneran
// masuk ke file ini -- ketauan pas verifikasi refactor fedEvents.js (hasil gak cocok sama yang
// dilaporkan). Sekarang DIPINDAH PERMANEN ke sini biar jadi SATU sumber kebenaran yang bener,
// dipakai backtest MAUPUN live trader (fedDovishGridTrader.js) -- gak ada lagi versi liar di luar.
function simulateBaskets(candles, signals, layerScheduleInputPct, layerTriggerPct, maxHoldDays = MAX_HOLD_DAYS, trendSma = null) {
  const layerSchedule = layerScheduleInputPct.map((v) => v / 100);
  const trades = [];
  let basket = null; // { direction, layers:[{price, sizeFrac}], avgEntry, totalSizeFrac, openedAtIdx }
  let sigPtr = 0;
  const maxHoldCandles = maxHoldDays * 24 * 4; // 15m candle

  function recomputeAvg() {
    let sumPriceSize = 0, sumSize = 0;
    for (const l of basket.layers) { sumPriceSize += l.price * l.sizeFrac; sumSize += l.sizeFrac; }
    basket.avgEntry = sumPriceSize / sumSize;
    basket.totalSizeFrac = sumSize;
  }
  function openBasket(direction, price, idx) {
    basket = { direction, layers: [{ price, sizeFrac: layerSchedule[0] }], openedAtIdx: idx };
    recomputeAvg();
  }
  function closeBasket(price, idx, reason) {
    const dirMult = basket.direction === 'LONG' ? 1 : -1;
    const changePct = ((price - basket.avgEntry) / basket.avgEntry) * 100 * dirMult;
    const pnlPctOfModal = basket.totalSizeFrac * changePct;
    trades.push({
      direction: basket.direction, openTime: candles[basket.openedAtIdx].openTime, closeTime: candles[idx].openTime,
      layers: basket.layers.length, pnlPct: pnlPctOfModal, reason, holdDays: (candles[idx].openTime - candles[basket.openedAtIdx].openTime) / 86400000,
    });
    basket = null;
  }

  for (let i = 0; i < candles.length; i += 1) {
    const price = candles[i].close;
    while (sigPtr < signals.length && signals[sigPtr].idxSignal === i) {
      const sig = signals[sigPtr];
      // Filter tren (opsional): skip sinyal LONG kalau harga MASIH di bawah SMA (downtrend kuat),
      // skip sinyal SHORT kalau harga MASIH di atas SMA -- "jangan lawan tren jangka pendek".
      const trendOk = !trendSma || trendSma[i] == null || (sig.direction === 'LONG' ? price > trendSma[i] : price < trendSma[i]);
      if (trendOk) {
        if (!basket) {
          openBasket(sig.direction, price, i);
        } else if (sig.direction !== basket.direction) {
          closeBasket(price, i, 'REVERSAL');
          openBasket(sig.direction, price, i);
        } // arah sama -> diabaikan (nambah layer cuma price-triggered)
      }
      sigPtr += 1;
    }

    if (basket) {
      const dirMult = basket.direction === 'LONG' ? 1 : -1;
      const changePct = ((price - basket.avgEntry) / basket.avgEntry) * 100 * dirMult;
      const floatingPct = basket.totalSizeFrac * changePct;
      const tpThreshold = basket.direction === 'LONG' ? LONG_TP_PCT : SHORT_TP_PCT;

      if (floatingPct >= tpThreshold) {
        closeBasket(price, i, 'TP');
      } else if (floatingPct <= -SL_PCT) {
        closeBasket(price, i, 'SL');
      } else if (i - basket.openedAtIdx >= maxHoldCandles) {
        closeBasket(price, i, 'TIMEOUT');
      } else if (basket.layers.length < layerSchedule.length) {
        const lastPrice = basket.layers[basket.layers.length - 1].price;
        const adversePct = basket.direction === 'LONG' ? ((lastPrice - price) / lastPrice) * 100 : ((price - lastPrice) / lastPrice) * 100;
        if (adversePct >= layerTriggerPct) {
          basket.layers.push({ price, sizeFrac: layerSchedule[basket.layers.length] });
          recomputeAvg();
        }
      }
    }
  }
  // basket masih floating pas data abis -> gak dihitung sbg trade selesai (belum ada hasil final)
  return trades;
}

function computeSMA(closes, period) {
  const sma = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i += 1) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) sma[i] = sum / period;
  }
  return sma;
}

const ROUND_TRIP_COST_PCT_OF_NOTIONAL = 0.10; // taker+taker kasar per unit notional (lihat catatan econReactionBacktest.js)

function summarizeTrades(trades, label, { showNetCost } = {}) {
  if (!trades.length) { console.log(`  ${label}: n=0`); return; }
  const wins = trades.filter((t) => t.pnlPct > 0);
  const losses = trades.filter((t) => t.pnlPct <= 0);
  const winRate = (wins.length / trades.length) * 100;
  const sumWin = wins.reduce((a, t) => a + t.pnlPct, 0);
  const sumLoss = Math.abs(losses.reduce((a, t) => a + t.pnlPct, 0));
  const pf = sumLoss > 0 ? (sumWin / sumLoss).toFixed(2) : (sumWin > 0 ? 'inf' : '-');
  let equity = 100, peak = 100, maxDD = 0;
  let equityNet = 100, peakNet = 100, maxDDNet = 0;
  for (const t of trades) {
    equity *= (1 + t.pnlPct / 100); peak = Math.max(peak, equity); maxDD = Math.max(maxDD, (peak - equity) / peak * 100);
    // Biaya kasar ~ 0.10%/layer yg dibuka (proxy notional bertambah tiap layer + 1x exit) --
    // estimasi sama arah kayak yang udah dites interaktif (net-of-cost tetep PF>1).
    const netPct = t.pnlPct - (t.layers * ROUND_TRIP_COST_PCT_OF_NOTIONAL);
    equityNet *= (1 + netPct / 100); peakNet = Math.max(peakNet, equityNet); maxDDNet = Math.max(maxDDNet, (peakNet - equityNet) / peakNet * 100);
  }
  const avgHold = trades.reduce((a, t) => a + t.holdDays, 0) / trades.length;
  const reasons = {};
  for (const t of trades) reasons[t.reason] = (reasons[t.reason] || 0) + 1;
  const reasonStr = Object.entries(reasons).map(([k, v]) => `${k}=${v}`).join(' ');
  let line = `  ${label}: n=${trades.length} winRate=${winRate.toFixed(1)}% PF=${pf} return(compound)=${(equity - 100).toFixed(1)}% maxDD=${maxDD.toFixed(1)}% avgHold=${avgHold.toFixed(1)}hari [${reasonStr}]`;
  if (showNetCost) line += ` || NET biaya: return=${(equityNet - 100).toFixed(1)}% maxDD=${maxDDNet.toFixed(1)}%`;
  console.log(line);
}

async function main() {
  console.log('Ambil candle 15m BTCUSDT 2019-2026...');
  const startMs = Date.UTC(2019, 0, 1);
  const endMs = Date.now();
  const candles = await fetchKlines('BTCUSDT', '15m', startMs, endMs);
  console.log(`Total candle: ${candles.length}`);
  const closes = candles.map((c) => c.close);

  const nfpEvents = generateNfpEvents(2019, 2026);
  const fomcEvents = generateFomcEvents();
  const allEvents = [...nfpEvents, ...fomcEvents].sort((a, b) => a.timeMs - b.timeMs);
  console.log(`Total event dicoba: ${allEvents.length} (NFP=${nfpEvents.length}, FOMC=${fomcEvents.length})`);

  const signals = computeSignals(candles, allEvents);
  console.log(`Event ada sinyal jelas (>${REACTION_THRESHOLD_PCT}%): ${signals.length} dari ${allEvents.length}`);

  // ============ LAPORAN UTAMA: racikan final (LONG-only, lihat FINAL_RECIPE) ============
  const trendSma = computeSMA(closes, FINAL_RECIPE.trendSmaPeriod);
  console.log(`\n########## RACIKAN FINAL: ${JSON.stringify(FINAL_RECIPE)} ##########`);
  const finalTrades = simulateBaskets(candles, signals, FINAL_RECIPE.layerSchedulePct, FINAL_RECIPE.layerTriggerPct, FINAL_RECIPE.maxHoldDays, trendSma)
    .filter((t) => t.direction === 'LONG'); // SHORT dibuang total dari live -- konsisten rugi, lihat catatan atas
  summarizeTrades(finalTrades, 'FULL PERIOD (LONG only)', { showNetCost: true });
  const byYearFinal = {};
  for (const t of finalTrades) { const y = new Date(t.openTime).getUTCFullYear(); (byYearFinal[y] = byYearFinal[y] || []).push(t); }
  for (const y of Object.keys(byYearFinal).sort()) summarizeTrades(byYearFinal[y], `  ${y}`);
  summarizeTrades(finalTrades.filter((t) => t.openTime < Date.UTC(2023, 0, 1)), '  Era1 <2023', { showNetCost: true });
  summarizeTrades(finalTrades.filter((t) => t.openTime >= Date.UTC(2023, 0, 1)), '  Era2 >=2023', { showNetCost: true });

  // ============ SENSITIVITAS (dokumentasi -- kenapa racikan di atas yang dipilih) ============
  console.log('\n########## SENSITIVITAS PARAMETER (LONG only, semua tanpa biaya) ##########');
  for (const [schedName, schedule] of Object.entries(LAYER_SCHEDULES)) {
    for (const triggerPct of LAYER_TRIGGER_PCT_VARIANTS) {
      const trades = simulateBaskets(candles, signals, schedule, triggerPct, 7, trendSma).filter((t) => t.direction === 'LONG');
      summarizeTrades(trades, `${schedName} trigger${triggerPct}%`);
    }
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('ERROR fedSignalGridBacktest.js:', e.message); process.exit(1); });
}

module.exports = { generateFomcEvents, computeSignals, simulateBaskets, computeSMA, FINAL_RECIPE, REACTION_THRESHOLD_PCT, REACTION_WINDOW_MIN };
