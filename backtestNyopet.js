// Backtest walk-forward strategi Nyopet Auto-Analysis (breakout daily + konfirmasi Weekly)
// pakai data historis BTCUSDT Binance. TUJUAN: cek beneran ada edge statistik apa nggak,
// bukan cuma "kedengeran masuk akal". Tool diagnostik manual (run langsung, BUKAN dipanggil
// workflow) -- laporan buat Olan review dulu, BUKAN auto-posting ke grup manapun.
//
// CATATAN JUJUR soal beda backtest ini vs live nyopetAutoAnalysis.js (biar gak disalahpahami
// sebagai replay 1:1 baris-demi-baris):
// 1. Live pakai swing zone dari candle HOURLY (96 candle/4 hari) buat resistance/support.
//    Backtest ini pakai swing zone dari candle DAILY (lookback ~90 hari) -- nyimpen histori
//    hourly bertahun-tahun butuh ribuan request paginated ke Binance, gak worth buat validasi
//    konsep. Level DAILY malah lebih signifikan/gak senoisy level hourly, jadi ini pendekatan
//    yang WAJAR, bukan disederhanain sampai gak representatif.
// 2. Live cek TP/SL tembus pakai candle HOURLY (presisi jam). Backtest ini pakai candle DAILY
//    High/Low (presisi hari) -- kalau TP & SL ke-touch di hari yang sama, SL menang (konservatif,
//    sama aturan kayak live).
// 3. Live entry di harga PASAR real-time saat dicek. Backtest entry di harga CLOSE candle harian
//    breakout itu sendiri (proxy wajar, karena di live juga baru dicek abis candle harian closed).
// 4. Hasil dilaporkan dalam R-multiple (risk unit), BUKAN dolar/persen modal -- biar independen
//    dari exposure/leverage yang beda-beda tiap orang, murni ngukur KUALITAS SINYAL.

const { fetchWithRetry } = require('./httpRetry');
const { sma, findSwingPoints, clusterLevels } = require('./technicalAnalysis');
const { hitung: hitungExposure } = require('./calculator');

const BASE_URL = 'https://data-api.binance.vision/api/v3/klines';

function parseCandle(raw) {
  return { openTime: raw[0], open: +raw[1], high: +raw[2], low: +raw[3], close: +raw[4], closeTime: raw[6] };
}

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

function findNextZone(zones, entryPrice, direction) {
  const candidates = direction === 'buy'
    ? zones.filter((z) => z.price > entryPrice).sort((a, b) => a.price - b.price)
    : zones.filter((z) => z.price < entryPrice).sort((a, b) => b.price - a.price);
  return candidates[0] || null;
}

function computeWeeklyStatsAt(weeklyCandles, asOfMs) {
  const closes = weeklyCandles.filter((c) => c.closeTime <= asOfMs).map((c) => c.close);
  const ma10 = sma(closes, 10);
  const ma30 = sma(closes, 30);
  if (!ma10 || !ma30) return { trend: null, momentumPct: null };
  const trend = ma10 > ma30 ? 'bullish' : ma10 < ma30 ? 'bearish' : 'netral';
  const momentumPct = Math.abs((ma10 - ma30) / ma30) * 100;
  return { trend, momentumPct };
}

// Sama persis logika `nyopetAutoAnalysis.js` (10 Agu 2026) -- direplikasi di sini (bukan
// require langsung) biar backtestNyopet.js tetap berdiri sendiri, konsisten sama pola findNextZone
// di atas yang juga duplikat manual buat keperluan backtest.
function classifyWeeklyStrength(momentumPct) {
  if (momentumPct === null || momentumPct === undefined) return 'lemah';
  if (momentumPct < 10) return 'lemah';
  if (momentumPct < 20) return 'sedang';
  return 'kuat';
}
const MIN_RR_BY_STRENGTH = { lemah: 1.0, sedang: 1.5, kuat: 2.0 };

function pickAdaptiveTp(zones, entryPrice, sl, direction, minRR) {
  const riskDistance = Math.abs(entryPrice - sl);
  if (riskDistance === 0) return null;
  const candidates = direction === 'buy'
    ? zones.filter((z) => z.price > entryPrice).sort((a, b) => a.price - b.price)
    : zones.filter((z) => z.price < entryPrice).sort((a, b) => b.price - a.price);
  for (const z of candidates) {
    const reward = Math.abs(z.price - entryPrice);
    if (reward / riskDistance >= minRR) return z;
  }
  return null;
}

// SL "nearest" (10 Agu 2026, respons diskusi Olan: "kalau breakout, biasanya gak ambil nyawa
// yang terlalu lebar kan?") -- zona TERDEKAT ke harga entry, BUKAN zona "paling tersentuh"
// (`swingSource[0]` lama). Buat trade breakout, invalidation yang natural itu TIPIS (dekat level
// breakout-nya sendiri -- "kalau balik lagi ke bawah level itu, breakout-nya gagal"), bukan zona
// struktur mayor yang kebetulan paling sering disentuh historis (bisa jadi zona LAMA yang jauh
// banget, apalagi abis crash/pump tajam). VALIDASI EMPIRIS (backtest realistis, modal $100):
// mostTouched -> nyaris ambruk total ($0,06 final). nearest -> $977 final, TANPA ubah apapun
// selain SL selection ini. Perbedaannya besar BUKAN dari lebar SL (median nyawa% mirip), tapi
// dari MENGHINDARI kasus ekor ekstrem (SL kebetulan zona jauh banget dari histori lama).
function pickNearestSl(zones, entryPrice, direction) {
  const candidates = direction === 'buy'
    ? zones.filter((z) => z.price < entryPrice).sort((a, b) => b.price - a.price)
    : zones.filter((z) => z.price > entryPrice).sort((a, b) => a.price - b.price);
  return candidates[0] || null;
}

function runBacktest(dailyCandles, weeklyCandles, opts = {}) {
  const {
    useWeeklyFilter = true, useAdaptiveTp = true, swingLookbackDays = 90, swingPointLookback = 3, warmupDays = 220,
  } = opts;
  const trades = [];
  let openPos = null;

  for (let i = warmupDays; i < dailyCandles.length; i++) {
    const today = dailyCandles[i];

    if (openPos) {
      const hitTp = openPos.direction === 'buy' ? today.high >= openPos.tp : today.low <= openPos.tp;
      const hitSl = openPos.direction === 'buy' ? today.low <= openPos.sl : today.high >= openPos.sl;
      if (hitSl) {
        trades.push({ ...openPos, exitIdx: i, exitPrice: openPos.sl, exitReason: 'SL', rMultiple: -1, exitTime: today.closeTime });
        openPos = null;
      } else if (hitTp) {
        const risk = Math.abs(openPos.entryPrice - openPos.sl);
        const reward = Math.abs(openPos.tp - openPos.entryPrice);
        trades.push({ ...openPos, exitIdx: i, exitPrice: openPos.tp, exitReason: 'TP', rMultiple: risk > 0 ? reward / risk : 0, exitTime: today.closeTime });
        openPos = null;
      }
      continue;
    }

    const dailyCloses = dailyCandles.slice(0, i + 1).map((c) => c.close);
    const ma200 = sma(dailyCloses, 200);
    if (!ma200) continue;

    // PENTING: zona dibentuk dari data SAMPAI KEMARIN (i-1), BUKAN termasuk candle hari ini --
    // kalau ikut candle hari ini, zona "resistance" pasti kebentuk DI ATAS harga close hari ini
    // by construction (definisi filter `price > lastPrice`), jadi breakout jadi mustahil terjadi
    // secara logis (self-referential). Ini juga lebih benar buat walk-forward: keputusan breakout
    // HARI INI wajib berbasis zona yang udah diketahui SEBELUM candle hari ini closed (no lookahead).
    const priorIdx = i - 1;
    const window = dailyCandles.slice(Math.max(0, priorIdx - swingLookbackDays), priorIdx + 1);
    const { highs, lows } = findSwingPoints(window, swingPointLookback);
    const priorPrice = dailyCandles[priorIdx].close;
    const resistanceZones = clusterLevels(highs.filter((h) => h.price > priorPrice), 0.4);
    const supportZones = clusterLevels(lows.filter((l) => l.price < priorPrice), 0.4);
    const topResistance = resistanceZones[0];
    const topSupport = supportZones[0];
    const lastPrice = today.close;

    const weeklyStats = computeWeeklyStatsAt(weeklyCandles, today.closeTime);

    let direction = null;
    if (topResistance && today.close > topResistance.priceMax) {
      if (!(useWeeklyFilter && weeklyStats.trend === 'bearish')) direction = 'buy';
    } else if (topSupport && today.close < topSupport.priceMin) {
      if (!(useWeeklyFilter && weeklyStats.trend === 'bullish')) direction = 'sell';
    }
    if (!direction) continue;

    const swingSource = direction === 'buy' ? supportZones : resistanceZones;
    if (!swingSource[0]) continue;
    const sl = swingSource[0].price;
    const riskDistance = Math.abs(lastPrice - sl);
    if (riskDistance === 0) continue;

    const oppositeZones = direction === 'buy' ? resistanceZones : supportZones;
    let tp;
    if (useAdaptiveTp) {
      const strength = classifyWeeklyStrength(weeklyStats.momentumPct);
      const minRR = MIN_RR_BY_STRENGTH[strength];
      const adaptiveZone = pickAdaptiveTp(oppositeZones, lastPrice, sl, direction, minRR);
      tp = adaptiveZone ? adaptiveZone.price : (direction === 'buy' ? lastPrice + riskDistance * minRR : lastPrice - riskDistance * minRR);
    } else {
      const nextZone = findNextZone(oppositeZones, lastPrice, direction);
      tp = nextZone ? nextZone.price : (direction === 'buy' ? lastPrice + riskDistance : lastPrice - riskDistance);
    }
    // Sanity guard sama kayak live nyopetAutoAnalysis.js: SL dari zona PALING BANYAK TERSENTUH
    // (bukan paling deket) sesekali jauh banget dari harga pas abis crash/pump tajam -- fallback
    // TP bisa jadi negatif/gak masuk akal. Skip trade itu (harusnya jarang -- kejadian nyata cuma
    // 1x di seluruh histori pas ngetest ini, Des 2018).
    if (tp <= 0) continue;

    openPos = { direction, entryIdx: i, entryPrice: lastPrice, sl, tp, entryTime: today.closeTime };
  }

  return trades;
}

// Varian MULTI-POSISI (10 Agu 2026, diskusi Olan: "posisi 1 belum target, muncul sinyal 2,
// reposisi dengan modal baru"). Beda dari runBacktest() di atas (1 posisi doang, skip cari
// sinyal baru selama masih ada yang floating) -- di sini boleh ada sampai `maxConcurrent` posisi
// bersamaan, TIAP posisi baru di-size dari SALDO REALISASI SAAT ITU doang (keputusan Olan: floating
// P&L posisi lain yang masih jalan TIDAK ikut dihitung -- "gak menghitung ayam belum menetas").
// Karena sizing sekarang beneran mempengaruhi hasil (bukan cuma R-multiple murni), simulasi ini
// pakai bankroll compounding (mulai dari 1.0 = 100% modal awal), risiko TETAP per-trade
// (riskFractionPerTrade, default 1% -- standar "Market Wizards" yang udah jadi rujukan proyek ini,
// lihat aturan resiko resmi) supaya perbandingan 1-posisi vs multi-posisi adil (variabel yang
// diuji CUMA soal konkurensi, bukan soal sizing).
function runBacktestMultiPos(dailyCandles, weeklyCandles, opts = {}) {
  const {
    useWeeklyFilter = true, useAdaptiveTp = true, swingLookbackDays = 90, swingPointLookback = 3,
    warmupDays = 220, maxConcurrent = 1, riskFractionPerTrade = 0.01,
  } = opts;
  const trades = [];
  let openPositions = [];
  let bankroll = 1.0;
  let maxConcurrentReached = 0;
  const bankrollSeries = [{ time: dailyCandles[warmupDays] ? dailyCandles[warmupDays].closeTime : 0, bankroll }];

  for (let i = warmupDays; i < dailyCandles.length; i++) {
    const today = dailyCandles[i];

    const stillOpen = [];
    for (const pos of openPositions) {
      const hitTp = pos.direction === 'buy' ? today.high >= pos.tp : today.low <= pos.tp;
      const hitSl = pos.direction === 'buy' ? today.low <= pos.sl : today.high >= pos.sl;
      if (hitSl) {
        bankroll += pos.riskAmountAtEntry * -1;
        trades.push({ ...pos, exitIdx: i, exitPrice: pos.sl, exitReason: 'SL', rMultiple: -1, exitTime: today.closeTime, bankrollAfter: bankroll });
        bankrollSeries.push({ time: today.closeTime, bankroll });
      } else if (hitTp) {
        const risk = Math.abs(pos.entryPrice - pos.sl);
        const reward = Math.abs(pos.tp - pos.entryPrice);
        const rMultiple = risk > 0 ? reward / risk : 0;
        bankroll += pos.riskAmountAtEntry * rMultiple;
        trades.push({ ...pos, exitIdx: i, exitPrice: pos.tp, exitReason: 'TP', rMultiple, exitTime: today.closeTime, bankrollAfter: bankroll });
        bankrollSeries.push({ time: today.closeTime, bankroll });
      } else {
        stillOpen.push(pos);
      }
    }
    openPositions = stillOpen;

    if (openPositions.length >= maxConcurrent) continue; // slot penuh, gak nyari sinyal baru hari ini

    const dailyCloses = dailyCandles.slice(0, i + 1).map((c) => c.close);
    const ma200 = sma(dailyCloses, 200);
    if (!ma200) continue;

    const priorIdx = i - 1;
    const window = dailyCandles.slice(Math.max(0, priorIdx - swingLookbackDays), priorIdx + 1);
    const { highs, lows } = findSwingPoints(window, swingPointLookback);
    const priorPrice = dailyCandles[priorIdx].close;
    const resistanceZones = clusterLevels(highs.filter((h) => h.price > priorPrice), 0.4);
    const supportZones = clusterLevels(lows.filter((l) => l.price < priorPrice), 0.4);
    const topResistance = resistanceZones[0];
    const topSupport = supportZones[0];
    const lastPrice = today.close;

    const weeklyStats = computeWeeklyStatsAt(weeklyCandles, today.closeTime);

    let direction = null;
    if (topResistance && today.close > topResistance.priceMax) {
      if (!(useWeeklyFilter && weeklyStats.trend === 'bearish')) direction = 'buy';
    } else if (topSupport && today.close < topSupport.priceMin) {
      if (!(useWeeklyFilter && weeklyStats.trend === 'bullish')) direction = 'sell';
    }
    if (!direction) continue;

    const swingSource = direction === 'buy' ? supportZones : resistanceZones;
    if (!swingSource[0]) continue;
    const sl = swingSource[0].price;
    const riskDistance = Math.abs(lastPrice - sl);
    if (riskDistance === 0) continue;

    const oppositeZones = direction === 'buy' ? resistanceZones : supportZones;
    let tp;
    if (useAdaptiveTp) {
      const strength = classifyWeeklyStrength(weeklyStats.momentumPct);
      const minRR = MIN_RR_BY_STRENGTH[strength];
      const adaptiveZone = pickAdaptiveTp(oppositeZones, lastPrice, sl, direction, minRR);
      tp = adaptiveZone ? adaptiveZone.price : (direction === 'buy' ? lastPrice + riskDistance * minRR : lastPrice - riskDistance * minRR);
    } else {
      const nextZone = findNextZone(oppositeZones, lastPrice, direction);
      tp = nextZone ? nextZone.price : (direction === 'buy' ? lastPrice + riskDistance : lastPrice - riskDistance);
    }
    if (tp <= 0) continue;

    // Modal buat posisi ini = saldo realisasi SAAT INI (bankroll cuma berubah pas ada posisi
    // LAIN yang beneran closed di atas -- posisi yang masih floating gak ikut mempengaruhi).
    const riskAmountAtEntry = bankroll * riskFractionPerTrade;
    openPositions.push({ direction, entryIdx: i, entryPrice: lastPrice, sl, tp, entryTime: today.closeTime, riskAmountAtEntry });
    maxConcurrentReached = Math.max(maxConcurrentReached, openPositions.length);
  }

  let peak = -Infinity, maxDrawdownPct = 0;
  for (const pt of bankrollSeries) {
    peak = Math.max(peak, pt.bankroll);
    maxDrawdownPct = Math.max(maxDrawdownPct, (peak - pt.bankroll) / peak * 100);
  }

  return { trades, finalBankroll: bankroll, maxConcurrentReached, maxDrawdownPct, bankrollSeries };
}

// Varian REALISTIS (10 Agu 2026, koreksi Olan atas asumsi 1% flat di runBacktestMultiPos):
// sizing pakai OLZ Exposure System ASLI (calculator.js `hitung()`), BUKAN persen risiko flat --
// risiko per-trade OTOMATIS gede pas modal kecil (~12% di modal <$10) dan mengecil sendiri pas
// modal membesar (<1% di modal $10rb+, lihat "Aturan resiko RESMI"). Skenario modal REALISTIS
// Olan: mulai $100, top-up $100/bulan sampai saldo nyentuh $1.000 (abis itu BERHENTI top-up,
// murni dari hasil trading). Rugi di SL gak pernah "all-in" -- exposure system udah nentuin
// leverage dari jarak SL (nyawa%) spesifik biar rugi kalau SL kena ~seukuran margin yang
// dialokasikan, BUKAN persentase modal yang gede sembarangan kayak yang keliatan di harga.
function runBacktestRealistic(dailyCandles, weeklyCandles, opts = {}) {
  const {
    useWeeklyFilter = true, useAdaptiveTp = true, swingLookbackDays = 90, swingPointLookback = 3,
    warmupDays = 220, maxConcurrent = 3, startCapital = 100, topUpAmount = 100, topUpStopAt = 1000,
    topUpIntervalDays = 30, slSelection = 'nearest', // 'nearest' (default, tervalidasi) | 'mostTouched' (lama)
  } = opts;
  const trades = [];
  let openPositions = [];
  let capital = startCapital;
  let toppedUpStopped = capital >= topUpStopAt;
  let lastTopUpTime = dailyCandles[warmupDays] ? dailyCandles[warmupDays].closeTime : 0;
  let maxConcurrentReached = 0;
  const capitalSeries = [{ time: lastTopUpTime, capital }];

  for (let i = warmupDays; i < dailyCandles.length; i++) {
    const today = dailyCandles[i];

    // Top-up bulanan (simulasi kebiasaan Olan) -- berhenti PERMANEN begitu saldo pernah nyentuh
    // topUpStopAt, gak topup lagi walau nanti turun lagi karena rugi trading.
    if (!toppedUpStopped && today.closeTime - lastTopUpTime >= topUpIntervalDays * 86400000) {
      capital += topUpAmount;
      lastTopUpTime = today.closeTime;
      if (capital >= topUpStopAt) toppedUpStopped = true;
      capitalSeries.push({ time: today.closeTime, capital });
    }

    const stillOpen = [];
    for (const pos of openPositions) {
      const hitTp = pos.direction === 'buy' ? today.high >= pos.tp : today.low <= pos.tp;
      const hitSl = pos.direction === 'buy' ? today.low <= pos.sl : today.high >= pos.sl;
      if (hitSl) {
        // Floor di 0 -- kejadian LANGKA (posisi lain yang masih terbuka ikut nguras modal duluan
        // sebelum posisi ini closed), tapi real trading gak pernah biarin saldo negatif (exchange
        // liquidasi/nolak duluan). Lebih baik "wipeout" di 0 daripada angka ngaco negatif.
        capital = Math.max(0, capital - pos.lossAtSl);
        trades.push({ ...pos, exitIdx: i, exitPrice: pos.sl, exitReason: 'SL', rMultiple: -1, pnlUsd: -pos.lossAtSl, exitTime: today.closeTime, capitalAfter: capital });
        capitalSeries.push({ time: today.closeTime, capital });
      } else if (hitTp) {
        const rewardPct = Math.abs(pos.tp - pos.entryPrice) / pos.entryPrice * 100;
        const profitUsd = pos.nilaiPosisi * (rewardPct / 100);
        capital += profitUsd;
        const risk = Math.abs(pos.entryPrice - pos.sl);
        const reward = Math.abs(pos.tp - pos.entryPrice);
        trades.push({ ...pos, exitIdx: i, exitPrice: pos.tp, exitReason: 'TP', rMultiple: risk > 0 ? reward / risk : 0, pnlUsd: profitUsd, exitTime: today.closeTime, capitalAfter: capital });
        capitalSeries.push({ time: today.closeTime, capital });
      } else {
        stillOpen.push(pos);
      }
    }
    openPositions = stillOpen;

    if (openPositions.length >= maxConcurrent) continue;

    const dailyCloses = dailyCandles.slice(0, i + 1).map((c) => c.close);
    const ma200 = sma(dailyCloses, 200);
    if (!ma200) continue;

    const priorIdx = i - 1;
    const window = dailyCandles.slice(Math.max(0, priorIdx - swingLookbackDays), priorIdx + 1);
    const { highs, lows } = findSwingPoints(window, swingPointLookback);
    const priorPrice = dailyCandles[priorIdx].close;
    const resistanceZones = clusterLevels(highs.filter((h) => h.price > priorPrice), 0.4);
    const supportZones = clusterLevels(lows.filter((l) => l.price < priorPrice), 0.4);
    const topResistance = resistanceZones[0];
    const topSupport = supportZones[0];
    const lastPrice = today.close;

    const weeklyStats = computeWeeklyStatsAt(weeklyCandles, today.closeTime);

    let direction = null;
    if (topResistance && today.close > topResistance.priceMax) {
      if (!(useWeeklyFilter && weeklyStats.trend === 'bearish')) direction = 'buy';
    } else if (topSupport && today.close < topSupport.priceMin) {
      if (!(useWeeklyFilter && weeklyStats.trend === 'bullish')) direction = 'sell';
    }
    if (!direction) continue;

    const swingSource = direction === 'buy' ? supportZones : resistanceZones;
    const slZone = slSelection === 'nearest' ? pickNearestSl(swingSource, lastPrice, direction) : (swingSource[0] || null);
    if (!slZone) continue;
    const sl = slZone.price;
    const riskDistance = Math.abs(lastPrice - sl);
    if (riskDistance === 0) continue;

    const oppositeZones = direction === 'buy' ? resistanceZones : supportZones;
    let tp;
    if (useAdaptiveTp) {
      const strength = classifyWeeklyStrength(weeklyStats.momentumPct);
      const minRR = MIN_RR_BY_STRENGTH[strength];
      const adaptiveZone = pickAdaptiveTp(oppositeZones, lastPrice, sl, direction, minRR);
      tp = adaptiveZone ? adaptiveZone.price : (direction === 'buy' ? lastPrice + riskDistance * minRR : lastPrice - riskDistance * minRR);
    } else {
      const nextZone = findNextZone(oppositeZones, lastPrice, direction);
      tp = nextZone ? nextZone.price : (direction === 'buy' ? lastPrice + riskDistance : lastPrice - riskDistance);
    }
    if (tp <= 0) continue;

    // Sizing ASLI dari calculator.js, dihitung dari MODAL SAAT INI (saldo realisasi -- floating
    // P&L posisi lain yang masih jalan gak ikut dihitung, konsisten sama keputusan Olan sebelumnya).
    // PENTING (ketemu 2 lapis bug pas nge-run ini pertama kali -- hasil awal absurd, $100 jadi
    // $12 JUTA, drawdown >100%): (1) calculator.js `getExposure()` cuma nge-clamp `modal`
    // LOKALNYA SENDIRI ke >=1, tapi `hitung()` tetap ngali-in `nilaiPosisi` pakai `modal` ASLI --
    // kalau modal negatif (dari bug #2 di bawah), nilaiPosisi ikut negatif dan hasil selanjutnya
    // ngaco liar. (2) margin buat posisi baru gak pernah "dikunci" dari modal -- jadi kalau 3
    // posisi bersamaan (maxConcurrent) SEMUA kebagian margin gede dari modal yang SAMA, gabungan
    // margin bisa lebih gede dari modal beneran, dan kalau semuanya kena SL bareng modal jadi
    // NEGATIF (mustahil di real trading -- exchange bakal liquidasi/nolak order duluan sebelum itu
    // kejadian). Fix: hitung `lockedMargin` (total margin posisi yang masih terbuka), affordability
    // dicek terhadap `capital - lockedMargin` (modal yang BENERAN available), bukan `capital` mentah.
    const lockedMargin = openPositions.reduce((s, p) => s + p.margin, 0);
    const availableCapital = capital - lockedMargin;
    if (availableCapital <= 0) continue;
    const { exposure, nilaiPosisi, leverage, margin } = hitungExposure({ modal: capital, entry: lastPrice, stopLoss: sl });
    if (margin > availableCapital) continue; // gak cukup modal available buat kunci margin ini
    const nyawaPct = riskDistance / lastPrice * 100;
    const lossAtSl = nilaiPosisi * (nyawaPct / 100); // presisi langsung dari nilai posisi, bukan margin (yang kena pembulatan floor(leverage))

    openPositions.push({
      direction, entryIdx: i, entryPrice: lastPrice, sl, tp, entryTime: today.closeTime,
      capitalAtEntry: capital, exposure, nilaiPosisi, leverage, margin, lossAtSl,
    });
    maxConcurrentReached = Math.max(maxConcurrentReached, openPositions.length);
  }

  let peak = -Infinity, maxDrawdownPct = 0;
  for (const pt of capitalSeries) {
    peak = Math.max(peak, pt.capital);
    maxDrawdownPct = Math.max(maxDrawdownPct, (peak - pt.capital) / peak * 100);
  }

  return { trades, finalCapital: capital, maxConcurrentReached, maxDrawdownPct, capitalSeries };
}

function summarize(trades) {
  const n = trades.length;
  if (n === 0) return { n: 0 };
  const wins = trades.filter((t) => t.rMultiple > 0);
  const losses = trades.filter((t) => t.rMultiple <= 0);
  const totalR = trades.reduce((s, t) => s + t.rMultiple, 0);
  const grossWinR = wins.reduce((s, t) => s + t.rMultiple, 0);
  const grossLossR = Math.abs(losses.reduce((s, t) => s + t.rMultiple, 0));
  let maxConsecLoss = 0, curConsecLoss = 0;
  for (const t of trades) {
    if (t.rMultiple <= 0) { curConsecLoss++; maxConsecLoss = Math.max(maxConsecLoss, curConsecLoss); } else curConsecLoss = 0;
  }
  const buy = trades.filter((t) => t.direction === 'buy');
  const sell = trades.filter((t) => t.direction === 'sell');
  return {
    n,
    wins: wins.length,
    losses: losses.length,
    winRate: (wins.length / n * 100).toFixed(1) + '%',
    avgR: (totalR / n).toFixed(2),
    profitFactor: grossLossR > 0 ? (grossWinR / grossLossR).toFixed(2) : 'inf',
    totalR: totalR.toFixed(2),
    maxConsecLoss,
    buyCount: buy.length,
    buyWinRate: buy.length ? (buy.filter((t) => t.rMultiple > 0).length / buy.length * 100).toFixed(1) + '%' : '-',
    sellCount: sell.length,
    sellWinRate: sell.length ? (sell.filter((t) => t.rMultiple > 0).length / sell.length * 100).toFixed(1) + '%' : '-',
  };
}

async function main() {
  console.log('Ambil histori candle BTCUSDT dari Binance (daily+weekly, dari listing 2017)...');
  const startTime = new Date('2017-08-17').getTime();
  const [daily, weekly] = await Promise.all([
    fetchAllCandles('BTCUSDT', '1d', startTime),
    fetchAllCandles('BTCUSDT', '1w', startTime),
  ]);
  console.log(`Daily candles: ${daily.length}, Weekly candles: ${weekly.length}`);

  const noFilterFlatTp = runBacktest(daily, weekly, { useWeeklyFilter: false, useAdaptiveTp: false });
  const filterFlatTp = runBacktest(daily, weekly, { useWeeklyFilter: true, useAdaptiveTp: false });
  const filterAdaptiveTp = runBacktest(daily, weekly, { useWeeklyFilter: true, useAdaptiveTp: true });

  console.log('\n=== A. TANPA filter Weekly, TP zona-terdekat/flat (baseline paling awal) ===');
  console.log(JSON.stringify(summarize(noFilterFlatTp), null, 2));
  console.log('\n=== B. DENGAN filter Weekly, TP zona-terdekat/flat (strategi SEBELUM TP adaptif) ===');
  console.log(JSON.stringify(summarize(filterFlatTp), null, 2));
  console.log('\n=== C. DENGAN filter Weekly, TP ADAPTIF momentum (strategi SEKARANG) ===');
  console.log(JSON.stringify(summarize(filterAdaptiveTp), null, 2));

  // D vs E: efek MULTI-POSISI (diskusi Olan 10 Agu 2026) -- sizing tiap posisi baru dari saldo
  // REALISASI doang (bukan floating), maks 3 posisi bersamaan. D pakai maxConcurrent=1 (setara
  // sistem sekarang tapi disimulasikan bankroll compounding, bukan cuma jumlah R) buat pembanding
  // adil vs E (maxConcurrent=3).
  const singlePos = runBacktestMultiPos(daily, weekly, { useWeeklyFilter: true, useAdaptiveTp: true, maxConcurrent: 1 });
  const multiPos3 = runBacktestMultiPos(daily, weekly, { useWeeklyFilter: true, useAdaptiveTp: true, maxConcurrent: 3 });

  console.log('\n=== D. MAKS 1 posisi bersamaan (setara sistem sekarang, bankroll compounding) ===');
  console.log(JSON.stringify({ ...summarize(singlePos.trades), finalReturn: ((singlePos.finalBankroll - 1) * 100).toFixed(1) + '%', maxDrawdown: singlePos.maxDrawdownPct.toFixed(1) + '%', maxConcurrentReached: singlePos.maxConcurrentReached }, null, 2));
  console.log('\n=== E. MAKS 3 posisi bersamaan (usulan Olan, saldo realisasi doang) ===');
  console.log(JSON.stringify({ ...summarize(multiPos3.trades), finalReturn: ((multiPos3.finalBankroll - 1) * 100).toFixed(1) + '%', maxDrawdown: multiPos3.maxDrawdownPct.toFixed(1) + '%', maxConcurrentReached: multiPos3.maxConcurrentReached }, null, 2));

  // F: versi REALISTIS (koreksi Olan 10 Agu 2026) -- sizing pakai OLZ Exposure System asli
  // (calculator.js), modal mulai $100, top-up $100/bulan sampai $1.000 lalu berhenti.
  const realistic = runBacktestRealistic(daily, weekly, { useWeeklyFilter: true, useAdaptiveTp: true, maxConcurrent: 3 });
  console.log('\n=== F. Realistis: exposure system asli + modal $100 top-up $100/bulan s.d. $1.000 ===');
  console.log(JSON.stringify({
    ...summarize(realistic.trades),
    startCapital: 100,
    finalCapital: '$' + realistic.finalCapital.toFixed(2),
    finalReturnPct: ((realistic.finalCapital / 100 - 1) * 100).toFixed(1) + '%',
    maxDrawdown: realistic.maxDrawdownPct.toFixed(1) + '%',
    maxConcurrentReached: realistic.maxConcurrentReached,
  }, null, 2));

  return { noFilterFlatTp, filterFlatTp, filterAdaptiveTp, singlePos, multiPos3, realistic, daily, weekly };
}

if (require.main === module) {
  main().catch((e) => { console.error('ERROR backtestNyopet.js:', e.message); process.exit(1); });
}

module.exports = {
  runBacktest, runBacktestMultiPos, runBacktestRealistic, summarize, fetchAllCandles, computeWeeklyStatsAt, classifyWeeklyStrength, pickAdaptiveTp,
};
