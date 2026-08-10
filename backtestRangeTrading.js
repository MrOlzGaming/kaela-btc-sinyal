// Strategi RANGE-TRADING (10 Agu 2026) -- beda filosofi total dari Nyopet breakout: BUKAN ngejar
// kelanjutan tren, tapi MANFAATIN mantulan harga dalam kisaran (beli deket support, jual/short
// deket resistance). Motivasi: riset hari ini nunjukkin breakout Nyopet KALAH dari hold di
// periode "flat" 2024-2026 (CAGR hold cuma 0,5%/th, volatilitas masih ada 45% tapi drift ilang) --
// breakout emang butuh trend buat menang, range-trading harusnya lebih cocok pas trend ilang
// tapi ayunan harga masih ada.

const { fetchWithRetry } = require('./httpRetry');
const { sma, findSwingPoints, clusterLevels } = require('./technicalAnalysis');
const { hitung: hitungExposure } = require('./calculator');

const BASE_URL = 'https://data-api.binance.vision/api/v3/klines';
function parseCandle(raw) { return { openTime: raw[0], open: +raw[1], high: +raw[2], low: +raw[3], close: +raw[4], closeTime: raw[6] }; }
async function fetchAllCandles(symbol, interval, startTime) {
  let all = [];
  let cursor = startTime;
  for (;;) {
    const res = await fetchWithRetry(`${BASE_URL}?symbol=${symbol}&interval=${interval}&startTime=${cursor}&limit=1000`);
    const raw = await res.json();
    if (!raw.length) break;
    all = all.concat(raw.map(parseCandle));
    if (raw.length < 1000) break;
    cursor = raw[raw.length - 1][6] + 1;
  }
  return all;
}

// Entry: harga close MASUK ke dalam X% dari batas zona (tapi belum TEMBUS -- itu beda urusan,
// itu wilayah breakout). SL di luar batas zona (kalau tembus, berarti mantulannya gagal).
// TP di zona berlawanan (support -> TP resistance, sebaliknya).
function runRangeBacktest(daily, opts = {}) {
  const {
    warmupDays = 220, lookbackDays = 90, swingPointLookback = 3, proximityPct = 1.5,
    targetRiskPct = 10, startCapital = 100, topUpAmount = 100, topUpStopAt = 1000, topUpIntervalDays = 30,
    fromMs = null, toMs = null,
    // Filter "market BENERAN sideways" (10 Agu 2026, penyempurnaan #2) -- range-trading cuma
    // masuk akal kalau market emang lagi gak trending. Cek net-move harga N hari terakhir --
    // kalau geraknya udah jauh satu arah (trending), skip (biar gak nge-range-trade pas lagi trend).
    rangeFilterDays = 30, rangeFilterMaxMovePct = 15,
    // TP lebih realistis -- BUKAN full ke zona seberang (kadang terlalu jauh/optimis), tapi
    // sebagian jalan ke sana (default 70%).
    tpFraction = 0.7,
  } = opts;
  const trades = [];
  let openPos = null;
  let capital = startCapital;
  let toppedUpStopped = capital >= topUpStopAt;
  let lastTopUp = daily[warmupDays] ? daily[warmupDays].closeTime : 0;
  const capitalSeries = [{ time: lastTopUp, capital }];

  for (let i = warmupDays; i < daily.length; i++) {
    const today = daily[i];
    if (fromMs && today.closeTime < fromMs) continue;
    if (toMs && today.closeTime > toMs) break;

    if (!toppedUpStopped && today.closeTime - lastTopUp >= topUpIntervalDays * 86400000) {
      capital += topUpAmount; lastTopUp = today.closeTime;
      if (capital >= topUpStopAt) toppedUpStopped = true;
      capitalSeries.push({ time: today.closeTime, capital });
    }

    if (openPos) {
      const hitTp = openPos.direction === 'buy' ? today.high >= openPos.tp : today.low <= openPos.tp;
      const hitSl = openPos.direction === 'buy' ? today.low <= openPos.sl : today.high >= openPos.sl;
      if (hitSl) {
        capital = Math.max(0, capital - openPos.lossAtSl);
        trades.push({ ...openPos, exitReason: 'SL', rMultiple: -1, pnlUsd: -openPos.lossAtSl, exitTime: today.closeTime, capitalAfter: capital });
        capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
      } else if (hitTp) {
        const rewardPct = Math.abs(openPos.tp - openPos.entryPrice) / openPos.entryPrice * 100;
        const profitUsd = openPos.nilaiPosisi * (rewardPct / 100);
        capital += profitUsd;
        const risk = Math.abs(openPos.entryPrice - openPos.sl), reward = Math.abs(openPos.tp - openPos.entryPrice);
        trades.push({ ...openPos, exitReason: 'TP', rMultiple: risk > 0 ? reward / risk : 0, pnlUsd: profitUsd, exitTime: today.closeTime, capitalAfter: capital });
        capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
      }
      continue;
    }

    // Filter sideways: net-move harga rangeFilterDays hari terakhir harus KECIL (bukti market
    // beneran lagi gak trending, bukan cuma volatile).
    const rf = daily[Math.max(0, i - rangeFilterDays)];
    const netMovePct = Math.abs(today.close - rf.close) / rf.close * 100;
    if (netMovePct > rangeFilterMaxMovePct) continue;

    const priorIdx = i - 1;
    const window = daily.slice(Math.max(0, priorIdx - lookbackDays), priorIdx + 1);
    const { highs, lows } = findSwingPoints(window, swingPointLookback);
    const priorPrice = daily[priorIdx].close;
    const resistanceZones = clusterLevels(highs.filter((h) => h.price > priorPrice), 0.4).sort((a, b) => a.price - b.price);
    const supportZones = clusterLevels(lows.filter((l) => l.price < priorPrice), 0.4).sort((a, b) => b.price - a.price);
    // Zona TERDEKAT (bukan paling sering disentuh) -- bug yang SAMA kayak SL breakout dulu:
    // zona "paling touch" bisa jadi level LAMA yang jauh, ketauan lagi di sini.
    const topResistance = resistanceZones[0], topSupport = supportZones[0];
    const lastPrice = today.close;

    // Konfirmasi REJECTION CANDLE (10 Agu 2026, fix atas bug ketemu: entry lama cuma modal
    // "deket zona" TANPA bukti pembalikan, jadi sering masuk pas harga masih lanjut jatuh/naik
    // -- whipsaw parah, win rate 8,6%). Sekarang WAJIB candle hari ini nunjukkin PENOLAKAN nyata:
    // BUY = candle hijau (close>open) DAN close di paruh ATAS range hari itu (nolak low).
    // SELL = candle merah (close<open) DAN close di paruh BAWAH range hari itu (nolak high).
    const dayRange = today.high - today.low;
    const closePosInRange = dayRange > 0 ? (today.close - today.low) / dayRange : 0.5;
    const bullishRejection = today.close > today.open && closePosInRange >= 0.6;
    const bearishRejection = today.close < today.open && closePosInRange <= 0.4;

    let direction = null, zone = null, oppositeZone = null;
    // Deket support (mantul ke atas -- BUY), TAPI belum tembus ke bawah priceMin (itu breakdown, bukan range).
    if (topSupport && bullishRejection && lastPrice > topSupport.priceMin && (lastPrice - topSupport.priceMin) / topSupport.priceMin * 100 <= proximityPct) {
      direction = 'buy'; zone = topSupport; oppositeZone = topResistance;
    } else if (topResistance && bearishRejection && lastPrice < topResistance.priceMax && (topResistance.priceMax - lastPrice) / lastPrice * 100 <= proximityPct) {
      direction = 'sell'; zone = topResistance; oppositeZone = topSupport;
    }
    if (!direction || !oppositeZone) continue;

    const sl = direction === 'buy' ? zone.priceMin * 0.99 : zone.priceMax * 1.01; // dikit di luar zona
    const riskDistance = Math.abs(lastPrice - sl);
    if (riskDistance === 0) continue;
    // TP sebagian (tpFraction) jalan ke zona seberang -- lebih realistis, gak nunggu FULL nyampe
    // zona lawan yang kadang kejauhan/optimis.
    const tp = lastPrice + (oppositeZone.price - lastPrice) * tpFraction;
    if ((direction === 'buy' && tp <= lastPrice) || (direction === 'sell' && tp >= lastPrice)) continue; // TP harus searah untung

    const nyawaPct = riskDistance / lastPrice * 100;
    const leverage = Math.max(1, Math.floor(100 / nyawaPct));
    const margin = capital * (targetRiskPct / 100);
    const nilaiPosisi = margin * leverage;
    if (margin > capital) continue;
    const lossAtSl = nilaiPosisi * (nyawaPct / 100);

    openPos = { direction, entryPrice: lastPrice, sl, tp, entryTime: today.closeTime, nilaiPosisi, margin, lossAtSl, zoneToches: zone.touches };
  }

  let peak = -Infinity, maxDrawdownPct = 0;
  for (const pt of capitalSeries) { peak = Math.max(peak, pt.capital); maxDrawdownPct = Math.max(maxDrawdownPct, (peak - pt.capital) / peak * 100); }
  return { trades, finalCapital: capital, maxDrawdownPct };
}

function summarize(trades) {
  const n = trades.length;
  if (n === 0) return { n: 0 };
  const wins = trades.filter((t) => t.rMultiple > 0);
  const totalR = trades.reduce((s, t) => s + t.rMultiple, 0);
  const grossWinR = wins.reduce((s, t) => s + t.rMultiple, 0);
  const grossLossR = Math.abs(trades.filter((t) => t.rMultiple <= 0).reduce((s, t) => s + t.rMultiple, 0));
  return { n, winRate: (wins.length / n * 100).toFixed(1) + '%', profitFactor: grossLossR > 0 ? (grossWinR / grossLossR).toFixed(2) : 'inf', totalR: totalR.toFixed(2) };
}

module.exports = { runRangeBacktest, summarize, fetchAllCandles };

if (require.main === module) {
  (async () => {
    const startTime = new Date('2017-08-17').getTime();
    const daily = await fetchAllCandles('BTCUSDT', '1d', startTime);
    console.log('=== SELURUH PERIODE 2018-2026 ===');
    let r = runRangeBacktest(daily);
    console.log(JSON.stringify(summarize(r.trades)), 'final=$' + r.finalCapital.toFixed(2), 'DD=' + r.maxDrawdownPct.toFixed(1) + '%');

    console.log('\n=== KHUSUS PERIODE FLAT 2024-08 s.d. sekarang ===');
    const cutoff = new Date('2024-08-10').getTime();
    let r2 = runRangeBacktest(daily, { fromMs: cutoff, startCapital: 100 });
    console.log(JSON.stringify(summarize(r2.trades)), 'final=$' + r2.finalCapital.toFixed(2), 'DD=' + r2.maxDrawdownPct.toFixed(1) + '%');
  })().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
}
