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

// ── Tanggal FOMC historis (hari KEDUA tiap meeting, 14:00 ET -- sumber: federalreserve.gov) ──
const FOMC_DECISION_DATES = [
  [2019, 1, 30], [2019, 3, 20], [2019, 5, 1], [2019, 6, 19], [2019, 7, 31], [2019, 9, 18], [2019, 10, 30], [2019, 12, 11],
  [2020, 1, 29], [2020, 3, 18], [2020, 4, 29], [2020, 6, 10], [2020, 7, 29], [2020, 9, 16], [2020, 11, 5], [2020, 12, 16],
  [2021, 1, 27], [2021, 3, 17], [2021, 4, 28], [2021, 6, 16], [2021, 7, 28], [2021, 9, 22], [2021, 11, 3], [2021, 12, 15],
  [2022, 1, 26], [2022, 3, 16], [2022, 5, 4], [2022, 6, 15], [2022, 7, 27], [2022, 9, 21], [2022, 11, 2], [2022, 12, 14],
  [2023, 2, 1], [2023, 3, 22], [2023, 5, 3], [2023, 6, 14], [2023, 7, 26], [2023, 9, 20], [2023, 11, 1], [2023, 12, 13],
  [2024, 1, 31], [2024, 3, 20], [2024, 5, 1], [2024, 6, 12], [2024, 7, 31], [2024, 9, 18], [2024, 11, 7], [2024, 12, 18],
  [2025, 1, 29], [2025, 3, 19], [2025, 5, 7], [2025, 6, 18], [2025, 7, 30], [2025, 9, 17], [2025, 10, 29], [2025, 12, 10],
  [2026, 1, 28], [2026, 3, 18], [2026, 4, 29], [2026, 6, 17], [2026, 7, 29], [2026, 9, 16], [2026, 10, 28], [2026, 12, 9],
];

function nthSundayUTC(year, monthIndex, n) {
  const d = new Date(Date.UTC(year, monthIndex, 1));
  let count = 0;
  while (true) {
    if (d.getUTCDay() === 0) { count += 1; if (count === n) return d.getTime(); }
    d.setUTCDate(d.getUTCDate() + 1);
  }
}
function isEDT(dateUTCms) {
  const year = new Date(dateUTCms).getUTCFullYear();
  return dateUTCms >= nthSundayUTC(year, 2, 2) && dateUTCms < nthSundayUTC(year, 10, 1);
}
function fomcTimestampUTC(year, month, day) {
  const noonCheck = Date.UTC(year, month - 1, day, 12);
  const utcHour = isEDT(noonCheck) ? 18 : 19; // 14:00 EDT = 18:00 UTC, 14:00 EST = 19:00 UTC
  return Date.UTC(year, month - 1, day, utcHour, 0);
}
function generateFomcEvents() {
  return FOMC_DECISION_DATES
    .map(([y, m, d]) => ({ label: `FOMC ${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, timeMs: fomcTimestampUTC(y, m, d) }))
    .filter((e) => e.timeMs <= Date.now());
}

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
function simulateBaskets(candles, signals, layerScheduleInputPct, layerTriggerPct) {
  const layerSchedule = layerScheduleInputPct.map((v) => v / 100);
  const trades = [];
  let basket = null; // { direction, layers:[{price, sizeFrac}], avgEntry, totalSizeFrac, openedAtIdx }
  let sigPtr = 0;
  const maxHoldCandles = MAX_HOLD_DAYS * 24 * 4; // 15m candle

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
      if (!basket) {
        openBasket(sig.direction, price, i);
      } else if (sig.direction !== basket.direction) {
        closeBasket(price, i, 'REVERSAL');
        openBasket(sig.direction, price, i);
      } // arah sama -> diabaikan (nambah layer cuma price-triggered)
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

function summarizeTrades(trades, label) {
  if (!trades.length) { console.log(`  ${label}: n=0`); return; }
  const wins = trades.filter((t) => t.pnlPct > 0);
  const losses = trades.filter((t) => t.pnlPct <= 0);
  const winRate = (wins.length / trades.length) * 100;
  const sumWin = wins.reduce((a, t) => a + t.pnlPct, 0);
  const sumLoss = Math.abs(losses.reduce((a, t) => a + t.pnlPct, 0));
  const pf = sumLoss > 0 ? (sumWin / sumLoss).toFixed(2) : (sumWin > 0 ? 'inf' : '-');
  let equity = 100, peak = 100, maxDD = 0;
  for (const t of trades) { equity *= (1 + t.pnlPct / 100); peak = Math.max(peak, equity); maxDD = Math.max(maxDD, (peak - equity) / peak * 100); }
  const avgHold = trades.reduce((a, t) => a + t.holdDays, 0) / trades.length;
  const reasons = {};
  for (const t of trades) reasons[t.reason] = (reasons[t.reason] || 0) + 1;
  const reasonStr = Object.entries(reasons).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`  ${label}: n=${trades.length} winRate=${winRate.toFixed(1)}% PF=${pf} return(compound)=${(equity - 100).toFixed(1)}% maxDD=${maxDD.toFixed(1)}% avgHold=${avgHold.toFixed(1)}hari [${reasonStr}]`);
}

async function main() {
  console.log('Ambil candle 15m BTCUSDT 2019-2026...');
  const startMs = Date.UTC(2019, 0, 1);
  const endMs = Date.now();
  const candles = await fetchKlines('BTCUSDT', '15m', startMs, endMs);
  console.log(`Total candle: ${candles.length}`);

  const nfpEvents = generateNfpEvents(2019, 2026);
  const fomcEvents = generateFomcEvents();
  const allEvents = [...nfpEvents, ...fomcEvents].sort((a, b) => a.timeMs - b.timeMs);
  console.log(`Total event dicoba: ${allEvents.length} (NFP=${nfpEvents.length}, FOMC=${fomcEvents.length})`);

  const signals = computeSignals(candles, allEvents);
  console.log(`Event ada sinyal jelas (>${REACTION_THRESHOLD_PCT}%): ${signals.length} dari ${allEvents.length}`);

  for (const [schedName, schedule] of Object.entries(LAYER_SCHEDULES)) {
    for (const triggerPct of LAYER_TRIGGER_PCT_VARIANTS) {
      console.log(`\n=== Skenario: ${schedName} | trigger layer tiap ${triggerPct}% lawan arah ===`);
      const trades = simulateBaskets(candles, signals, schedule, triggerPct);
      summarizeTrades(trades, 'FULL PERIOD');
      summarizeTrades(trades.filter((t) => t.direction === 'LONG'), '  LONG only');
      summarizeTrades(trades.filter((t) => t.direction === 'SHORT'), '  SHORT only');

      const byYear = {};
      for (const t of trades) { const y = new Date(t.openTime).getUTCFullYear(); (byYear[y] = byYear[y] || []).push(t); }
      for (const y of Object.keys(byYear).sort()) summarizeTrades(byYear[y], `  ${y}`);

      const era1 = trades.filter((t) => t.openTime < Date.UTC(2023, 0, 1));
      const era2 = trades.filter((t) => t.openTime >= Date.UTC(2023, 0, 1));
      summarizeTrades(era1, '  Era1 <2023');
      summarizeTrades(era2, '  Era2 >=2023');
    }
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('ERROR fedSignalGridBacktest.js:', e.message); process.exit(1); });
}

module.exports = { generateFomcEvents, fomcTimestampUTC, computeSignals, simulateBaskets };
