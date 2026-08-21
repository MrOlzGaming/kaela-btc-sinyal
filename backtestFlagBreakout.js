// ⛔ CATATAN STATUS FUNGSI DI FILE INI (22 Agu 2026, riset "kalahin baseline") -- HANYA
// `runFlagBacktest()` (versi buy-only, ini fungsi dasar/baseline) yang jadi acuan sistem LIVE
// (sekarang di chartPatterns.js+sniperAutoAnalysis.js). Fungsi lain di file ini DITES tapi
// TIDAK DIPAKAI, disimpan APA ADANYA sbg ilmu:
//   - `runShortHedgeBacktest`, shortModalDivisor di atas -- short APAPUN bentuknya kebukti
//     ngerusak hasil (lihat [[feedback-nyopet-buyonly]]).
//   - `runFlag3TierBacktest` -- 3-tier exit LEBIH JELEK dari 2-tier baseline ($13.295 vs $17.584).
//   - `runFlag3TierProfitShortBacktest` -- profit-short JAUH lebih jelek ($957).
//   - `runFlagFullTrailBacktest` (full-ride, gak jual separuh) -- MENANG di histori penuh
//     ($34.406) tapi TERBUKTI GAK ROBUST lintas rezim pasar (kalah/rata di era choppy, DD lebih
//     jelek) begitu divalidasi split-era -- lihat memory project-kaela-btc-sinyal buat detail.
// Yang BENERAN dipakai live: baseline 2-tier ini, SEKARANG DIGABUNG sama FVG (backtestFVG.js)
// multi-posisi multi-aset (backtestCombinedMultiPos.js/backtestCrossAsset.js) + window istirahat
// siklus halving (halvingBearWindow.js).
//
// Strategi BREAKOUT DARI POLA CHART SPESIFIK (10 Agu 2026, usulan Olan) -- beda dari Nyopet lama
// yang SL-nya diambil dari zona swing high/low umum (bisa jauh, nyawa lebar 10-38%). Di sini SL
// diambil dari lebar PATTERN-nya sendiri (bull flag / bear flag) -- pattern ini secara definisi
// SEMPIT (konsolidasi ketat abis gerakan tajam/"tiang"), jadi SL alami TIPIS tanpa dipaksa/arbitrer
// kayak percobaan cap 5% kemarin yang gagal (itu gagal krn maksa SL tipis di ATAS zona yg lebar,
// bukan krn pattern-nya sendiri emang sempit).
//
// Anatomi:
//   1. TIANG (pole): gerakan tajam searah, >=poleMinMovePct dalam poleLookbackDays.
//   2. BENDERA (flag): abis tiang, harga KONSOLIDASI SEMPIT (range <=flagMaxRangePct) selama
//      flagLookbackDays -- ini pause/napas pasar, BUKAN pembalikan.
//   3. BREAKOUT: harga tembus batas bendera SEARAH tiang -> entry, SL di ujung LAIN bendera
//      (sempit, karena bendera sendiri udah sempit).
//   4. Target 1:2 R diambil SEBAGIAN (jual separuh), sisanya di-trail (SL geser ke breakeven,
//      keluar kalau harga tutup di bawah/atas SMA pendek -- proksi "lihat kelakuan candle").

const { fetchWithRetry } = require('./httpRetry');
const { sma } = require('./technicalAnalysis');
const { hitung: hitungExposure } = require('./calculator');
const { detectFlag, detectWedge } = require('./chartPatterns');

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

// detectFlag/detectWedge dipindah ke chartPatterns.js (10 Agu 2026) -- dipakai bareng sama live
// (nyopetAutoAnalysis.js), satu sumber kebenaran.

function runFlagBacktest(daily, opts = {}) {
  const {
    warmupDays = 60, poleLookbackRange = [5, 20], poleMinMovePct = 15, flagLookbackRange = [3, 15], flagMaxRangePct = 8,
    slBufferPct = 0.5, partialRR = 2, trailSmaLen = 10, allowShort = true,
    startCapital = 100, topUpAmount = 100, topUpStopAt = 1000, topUpDayOfMonth = 5,
    // Pola mana yang mau di-scan tiap hari -- flag/pennant (lanjutan) dan/atau wedge (pembalikan).
    usePatterns = ['flag', 'wedge'],
    // wedgeMinTouches=2 (bukan 3 kayak "aturan textbook") -- dites 10 Agu 2026, TERBUKTI lebih
    // baik di SEMUA metrik (PF, totalR, DD, modal akhir) drpd syarat 3 sentuhan yang lebih ketat.
    // 3 sentuhan kebanyakan MISS wedge yang beneran valid tapi cuma kebentuk dari 2 titik jelas.
    wedgeLookbackRange = [15, 40], wedgeMinTouches = 2, wedgeConvergenceRatio = 0.65,
    // Batas keras margin/modal per-trade (10 Agu 2026, instruksi Olan: "gak boleh ada lagi posisi
    // margin super -- kita nyopet, bukan investasi"). Kalkulator exposure udah alami ngasih margin
    // kecil kalau nyawa tipis (pattern-based SL emang tipis), tapi ini jaring pengaman keras biar
    // gak ada 1 trade pun yang lolos dengan margin gede -- skip trade kalau kejadian.
    maxMarginPct = 20,
    // Batas keras nyawa% (12 Agu 2026, instruksi Olan: "nyopet ya pake nyawa dikit aja, max
    // nyawa% sesuai yang kita buat.. invalidasi diterima dengan lapang, gak maksa nyawa lebar
    // buat ukuran nyopet"). null = gak dibatasi (perilaku lama).
    maxNyawaPct = null,
    // shortModalDivisor (21 Agu 2026, usulan Olan: "coba adakan lagi short.. tapi 1/10 modal
    // asli") -- short TERBUKTI berkali-kali ngerusak hasil di versi equal-sizing (lihat
    // [[feedback-nyopet-buyonly]]), sekarang dicoba lagi TAPI modal yang dimasukin ke kalkulator
    // exposure buat short cuma capital/shortModalDivisor (posisi jauh lebih kecil dari long),
    // biar downside short ikut mengecil proporsional kalau tetap ngerusak. 1 = sizing sama rata
    // (perilaku lama), null/allowShort=false = short tetap mati total.
    shortModalDivisor = 1,
  } = opts;
  const trades = [];
  let openPos = null;
  let capital = startCapital;
  let lastTopUpMonthKey = null;
  const capitalSeries = [{ time: daily[warmupDays] ? daily[warmupDays].closeTime : 0, capital }];

  for (let i = warmupDays; i < daily.length; i++) {
    const today = daily[i];
    const todayDate = new Date(today.closeTime);
    const curMonthKey = todayDate.getUTCFullYear() * 12 + todayDate.getUTCMonth();
    if (todayDate.getUTCDate() >= topUpDayOfMonth && curMonthKey !== lastTopUpMonthKey) {
      lastTopUpMonthKey = curMonthKey;
      if (capital < topUpStopAt) { capital += topUpAmount; capitalSeries.push({ time: today.closeTime, capital }); }
    }

    if (openPos) {
      const closes = daily.slice(0, i + 1).map((c) => c.close);
      const trailSma = sma(closes, trailSmaLen);
      if (!openPos.partialDone) {
        const hitSl = openPos.direction === 'buy' ? today.low <= openPos.sl : today.high >= openPos.sl;
        const hitPartial = openPos.direction === 'buy' ? today.high >= openPos.partialTp : today.low <= openPos.partialTp;
        if (hitSl) {
          capital = Math.max(0, capital - openPos.lossAtSl);
          trades.push({ ...openPos, exitReason: 'SL', rMultiple: -1, pnlUsd: -openPos.lossAtSl, exitTime: today.closeTime });
          capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
        } else if (hitPartial) {
          const rewardPct = Math.abs(openPos.partialTp - openPos.entryPrice) / openPos.entryPrice * 100;
          const profitHalf = openPos.nilaiPosisi * 0.5 * (rewardPct / 100);
          capital += profitHalf;
          openPos.realizedPnl = profitHalf;
          openPos.partialDone = true;
          openPos.sl = openPos.entryPrice; // breakeven buat sisa separuh
        }
      } else {
        // Separuh sisa: trail pakai SMA pendek -- proksi "lihat kelakuan candle" (keluar kalau
        // momentum jangka pendek udah patah, bukan nunggu SL lebar/statis).
        const hitSl = openPos.direction === 'buy' ? today.low <= openPos.sl : today.high >= openPos.sl;
        const trendBroken = trailSma !== null && (openPos.direction === 'buy' ? today.close < trailSma : today.close > trailSma);
        if (hitSl || trendBroken) {
          const movePctSigned = (today.close - openPos.entryPrice) / openPos.entryPrice * (openPos.direction === 'buy' ? 1 : -1) * 100;
          const pnlRest = openPos.nilaiPosisi * 0.5 * (movePctSigned / 100);
          capital = Math.max(0, capital + pnlRest);
          const totalPnl = openPos.realizedPnl + pnlRest;
          const riskPct = Math.abs(openPos.entryPrice - openPos.originalSl) / openPos.entryPrice * 100;
          trades.push({ ...openPos, exitReason: hitSl ? 'SL_BREAKEVEN' : 'TRAIL_EXIT', rMultiple: riskPct > 0 ? movePctSigned / riskPct : 0, pnlUsd: totalPnl, exitTime: today.closeTime });
          capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
        }
      }
      continue;
    }

    const lastPrice = today.close;
    let direction = null, sl = null, patternType = null;

    if (usePatterns.includes('flag')) {
      const flag = detectFlag(daily, i, { poleLookbackRange, poleMinMovePct, flagLookbackRange, flagMaxRangePct });
      if (flag && flag.type === 'bull' && lastPrice > flag.flagHigh) {
        direction = 'buy'; sl = flag.flagLow * (1 - slBufferPct / 100); patternType = 'flag_bull';
      } else if (flag && flag.type === 'bear' && lastPrice < flag.flagLow && allowShort) {
        direction = 'sell'; sl = flag.flagHigh * (1 + slBufferPct / 100); patternType = 'flag_bear';
      }
    }
    if (!direction && usePatterns.includes('wedge')) {
      const wedge = detectWedge(daily, i, { wedgeLookbackRange, minTouches: wedgeMinTouches, convergenceRatio: wedgeConvergenceRatio });
      // Rising wedge -> breakout TURUN (short). Falling wedge -> breakout NAIK (long). SL di
      // swing extreme TERAKHIR di dalam pola (bukan ujung bendera -- wedge beda geometri).
      if (wedge && wedge.type === 'rising' && lastPrice < wedge.projectedSupport && allowShort) {
        direction = 'sell'; sl = wedge.recentSwingHigh * (1 + slBufferPct / 100); patternType = 'wedge_rising';
      } else if (wedge && wedge.type === 'falling' && lastPrice > wedge.projectedResistance) {
        direction = 'buy'; sl = wedge.recentSwingLow * (1 - slBufferPct / 100); patternType = 'wedge_falling';
      }
    }
    if (!direction) continue;

    const riskDistance = Math.abs(lastPrice - sl);
    if (riskDistance === 0) continue;
    const nyawaPct = riskDistance / lastPrice * 100;
    if (maxNyawaPct !== null && nyawaPct > maxNyawaPct) continue; // invalidasi -- nyawa kelewat lebar buat ukuran nyopet
    // Modal yang dimasukin ke kalkulator BEDA per arah kalau shortModalDivisor>1 -- long tetap
    // full capital, short cuma capital/shortModalDivisor (posisi jauh lebih kecil). Cap
    // margin/marginPct di bawah tetap dibandingin ke CAPITAL PENUH (bukan sizingModal) -- itu
    // jaring pengaman "berapa % modal TOTAL yang dipertaruhkan", bukan berubah maknanya.
    const sizingModal = direction === 'sell' ? capital / shortModalDivisor : capital;
    const { nilaiPosisi, margin } = hitungExposure({ modal: sizingModal, entry: lastPrice, stopLoss: sl });
    if (margin > capital) continue;
    const marginPct = margin / capital * 100;
    if (marginPct > maxMarginPct) continue; // jaring pengaman keras -- nyopet, bukan investasi
    const lossAtSl = nilaiPosisi * (nyawaPct / 100);
    const partialTp = direction === 'buy' ? lastPrice + riskDistance * partialRR : lastPrice - riskDistance * partialRR;

    openPos = {
      direction, entryPrice: lastPrice, sl, originalSl: sl, partialTp, entryTime: today.closeTime,
      nilaiPosisi, margin, marginPct, lossAtSl, partialDone: false, realizedPnl: 0, patternType,
    };
  }

  let peak = -Infinity, maxDrawdownPct = 0;
  for (const pt of capitalSeries) { peak = Math.max(peak, pt.capital); maxDrawdownPct = Math.max(maxDrawdownPct, (peak - pt.capital) / peak * 100); }
  return { trades, finalCapital: capital, maxDrawdownPct, capitalSeries };
}

// Strategi HEDGE PASIF (21 Agu 2026, usulan Olan): "ketika gak ada sinyal sniper sama sekali,
// default SELALU flat short 1% modal leverage 3x. Begitu ada sinyal, short ditutup, masuk long
// sesuai sinyal pakai kalkulator exposure." Beda TOTAL dari runFlagBacktest() -- di situ short
// muncul dari POLA CHART (bear flag/rising wedge), di sini short itu STATE DEFAULT pasif (gak ada
// pola pemicu sama sekali), cuma nunggu ditutup begitu long signal muncul. SL/TP short: TIDAK
// ADA target, cuma dipotong likuidasi (leverage 3x -> harga naik ~33,3% dari entry = margin abis)
// -- realistis buat "flat" beneran (dibiarin ada, ditutup PAKSA cuma kalau kena liq atau ada sinyal).
function runShortHedgeBacktest(daily, opts = {}) {
  const {
    warmupDays = 60, poleLookbackRange = [5, 20], poleMinMovePct = 15, flagLookbackRange = [3, 15], flagMaxRangePct = 8,
    slBufferPct = 0.5, partialRR = 2, trailSmaLen = 10,
    startCapital = 100, topUpAmount = 100, topUpStopAt = 1000, topUpDayOfMonth = 5,
    usePatterns = ['flag', 'wedge'], wedgeLookbackRange = [15, 40], wedgeMinTouches = 2, wedgeConvergenceRatio = 0.65,
    maxMarginPct = 20, maxNyawaPct = null,
    shortPct = 1, shortLeverage = 3, // "flat short 1% modal, leverage 3x"
  } = opts;
  const trades = [];
  const shortTrades = [];
  let openPos = null; // posisi LONG (sinyal Sniper)
  let shortHedge = null; // posisi SHORT pasif (default state)
  let capital = startCapital;
  let lastTopUpMonthKey = null;
  const capitalSeries = [{ time: daily[warmupDays] ? daily[warmupDays].closeTime : 0, capital }];

  function openShortHedge(entryPrice, entryTime) {
    const margin = capital * (shortPct / 100);
    const nilaiPosisi = margin * shortLeverage;
    const liqPrice = entryPrice * (1 + 1 / shortLeverage); // short: naik 1/leverage = margin abis
    shortHedge = { entryPrice, entryTime, margin, nilaiPosisi, liqPrice };
  }
  function closeShortHedge(exitPrice, exitTime, reason) {
    const movePct = (shortHedge.entryPrice - exitPrice) / shortHedge.entryPrice * 100;
    const pnlUsd = reason === 'LIQUIDASI' ? -shortHedge.margin : shortHedge.nilaiPosisi * (movePct / 100);
    capital = Math.max(0, capital + pnlUsd);
    shortTrades.push({ ...shortHedge, exitPrice, exitTime, reason, pnlUsd });
    shortHedge = null;
  }

  for (let i = warmupDays; i < daily.length; i++) {
    const today = daily[i];
    const todayDate = new Date(today.closeTime);
    const curMonthKey = todayDate.getUTCFullYear() * 12 + todayDate.getUTCMonth();
    if (todayDate.getUTCDate() >= topUpDayOfMonth && curMonthKey !== lastTopUpMonthKey) {
      lastTopUpMonthKey = curMonthKey;
      if (capital < topUpStopAt) { capital += topUpAmount; capitalSeries.push({ time: today.closeTime, capital }); }
    }

    // ===== State LONG (sinyal Sniper aktif) -- logic PERSIS sama kayak runFlagBacktest() =====
    if (openPos) {
      const closes = daily.slice(0, i + 1).map((c) => c.close);
      const trailSma = sma(closes, trailSmaLen);
      if (!openPos.partialDone) {
        const hitSl = today.low <= openPos.sl;
        const hitPartial = today.high >= openPos.partialTp;
        if (hitSl) {
          capital = Math.max(0, capital - openPos.lossAtSl);
          trades.push({ ...openPos, exitReason: 'SL', rMultiple: -1, pnlUsd: -openPos.lossAtSl, exitTime: today.closeTime });
          capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
          openShortHedge(today.close, today.closeTime); // balik ke state default
        } else if (hitPartial) {
          const rewardPct = Math.abs(openPos.partialTp - openPos.entryPrice) / openPos.entryPrice * 100;
          const profitHalf = openPos.nilaiPosisi * 0.5 * (rewardPct / 100);
          capital += profitHalf;
          openPos.realizedPnl = profitHalf; openPos.partialDone = true; openPos.sl = openPos.entryPrice;
        }
      } else {
        const hitSl = today.low <= openPos.sl;
        const trendBroken = trailSma !== null && today.close < trailSma;
        if (hitSl || trendBroken) {
          const movePctSigned = (today.close - openPos.entryPrice) / openPos.entryPrice * 100;
          const pnlRest = openPos.nilaiPosisi * 0.5 * (movePctSigned / 100);
          capital = Math.max(0, capital + pnlRest);
          const totalPnl = openPos.realizedPnl + pnlRest;
          const riskPct = Math.abs(openPos.entryPrice - openPos.originalSl) / openPos.entryPrice * 100;
          trades.push({ ...openPos, exitReason: hitSl ? 'SL_BREAKEVEN' : 'TRAIL_EXIT', rMultiple: riskPct > 0 ? movePctSigned / riskPct : 0, pnlUsd: totalPnl, exitTime: today.closeTime });
          capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
          openShortHedge(today.close, today.closeTime); // balik ke state default
        }
      }
      continue;
    }

    // ===== State SHORT (default, gak ada sinyal) =====
    if (!shortHedge) openShortHedge(today.close, today.closeTime); // jaga2 kalau belum ada (hari pertama)
    if (today.high >= shortHedge.liqPrice) {
      closeShortHedge(shortHedge.liqPrice, today.closeTime, 'LIQUIDASI');
      capitalSeries.push({ time: today.closeTime, capital });
      openShortHedge(today.close, today.closeTime); // langsung buka lagi (state default, bukan nunggu apa2)
    }

    // Cek sinyal LONG (flag bull / falling wedge doang -- short udah ditangani terpisah di atas)
    const lastPrice = today.close;
    let direction = null, sl = null, patternType = null;
    if (usePatterns.includes('flag')) {
      const flag = detectFlag(daily, i, { poleLookbackRange, poleMinMovePct, flagLookbackRange, flagMaxRangePct });
      if (flag && flag.type === 'bull' && lastPrice > flag.flagHigh) { direction = 'buy'; sl = flag.flagLow * (1 - slBufferPct / 100); patternType = 'flag_bull'; }
    }
    if (!direction && usePatterns.includes('wedge')) {
      const wedge = detectWedge(daily, i, { wedgeLookbackRange, minTouches: wedgeMinTouches, convergenceRatio: wedgeConvergenceRatio });
      if (wedge && wedge.type === 'falling' && lastPrice > wedge.projectedResistance) { direction = 'buy'; sl = wedge.recentSwingLow * (1 - slBufferPct / 100); patternType = 'wedge_falling'; }
    }
    if (!direction) continue;

    const riskDistance = Math.abs(lastPrice - sl);
    if (riskDistance === 0) continue;
    const nyawaPct = riskDistance / lastPrice * 100;
    if (maxNyawaPct !== null && nyawaPct > maxNyawaPct) continue;

    // Sinyal beneran valid -- TUTUP short hedge dulu (harga hari yang sama), baru masuk long.
    closeShortHedge(lastPrice, today.closeTime, 'SINYAL_LONG');
    capitalSeries.push({ time: today.closeTime, capital });

    const { nilaiPosisi, margin } = hitungExposure({ modal: capital, entry: lastPrice, stopLoss: sl });
    if (margin > capital) continue;
    const marginPct = margin / capital * 100;
    if (marginPct > maxMarginPct) { openShortHedge(lastPrice, today.closeTime); continue; } // gagal sizing -> balik short
    const lossAtSl = nilaiPosisi * (nyawaPct / 100);
    const partialTp = direction === 'buy' ? lastPrice + riskDistance * partialRR : lastPrice - riskDistance * partialRR;
    openPos = { direction, entryPrice: lastPrice, sl, originalSl: sl, partialTp, entryTime: today.closeTime, nilaiPosisi, margin, marginPct, lossAtSl, partialDone: false, realizedPnl: 0, patternType };
  }

  let peak = -Infinity, maxDrawdownPct = 0;
  for (const pt of capitalSeries) { peak = Math.max(peak, pt.capital); maxDrawdownPct = Math.max(maxDrawdownPct, (peak - pt.capital) / peak * 100); }
  return { trades, shortTrades, finalCapital: capital, maxDrawdownPct, capitalSeries };
}

// Exit 3-TAHAP (21 Agu 2026, usulan Olan, "bahas dulu" -> disetujui buat dibacktest): TP1=1R info
// doang, TP2=2R jual separuh (PERSIS titik TP1 yang sekarang, cuma digeser nama), TP3=3R jual
// separuh LAGI dari sisa (tinggal 1/4 modal awal), SL sisa seperempat itu DIRATCHET ke level TP2
// (bukan cuma breakeven) -- "bonus, bodo amat, tapi tetep ada metode exit" (kalaupun keluar,
// minimal untung sebesar TP2, gak mungkin balik ke rugi/impas). Trailing SMA jalan paralel di
// SEMUA tahap abis TP2 kena -- exit-nya "mana duluan kena" (SL/ratchet vs trend patah), BUKAN
// nunggu TP3 doang -- kalau trend patah sebelum sempat TP3, tetap keluar normal di titik itu.
function runFlag3TierBacktest(daily, opts = {}) {
  const {
    warmupDays = 60, poleLookbackRange = [5, 20], poleMinMovePct = 15, flagLookbackRange = [3, 15], flagMaxRangePct = 8,
    slBufferPct = 0.5, trailSmaLen = 10,
    startCapital = 100, topUpAmount = 100, topUpStopAt = 1000, topUpDayOfMonth = 5,
    usePatterns = ['flag', 'wedge'], wedgeLookbackRange = [15, 40], wedgeMinTouches = 2, wedgeConvergenceRatio = 0.65,
    maxMarginPct = 20, maxNyawaPct = null,
    tp2R = 2, tp3R = 3, // TP1 SELALU 1R (info doang, gak butuh parameter -- gak ada aksi yg bergantung ke situ)
  } = opts;
  const trades = [];
  let openPos = null;
  let capital = startCapital;
  let lastTopUpMonthKey = null;
  const capitalSeries = [{ time: daily[warmupDays] ? daily[warmupDays].closeTime : 0, capital }];

  for (let i = warmupDays; i < daily.length; i++) {
    const today = daily[i];
    const todayDate = new Date(today.closeTime);
    const curMonthKey = todayDate.getUTCFullYear() * 12 + todayDate.getUTCMonth();
    if (todayDate.getUTCDate() >= topUpDayOfMonth && curMonthKey !== lastTopUpMonthKey) {
      lastTopUpMonthKey = curMonthKey;
      if (capital < topUpStopAt) { capital += topUpAmount; capitalSeries.push({ time: today.closeTime, capital }); }
    }

    if (openPos) {
      const closes = daily.slice(0, i + 1).map((c) => c.close);
      const trailSma = sma(closes, trailSmaLen);
      const trendBroken = trailSma !== null && today.close < trailSma;

      if (openPos.tier === 0) { // belum partial sama sekali -- cek SL vs TP2 (TP1 info doang, gak ngaruh state)
        const hitSl = today.low <= openPos.sl;
        const hitTp2 = today.high >= openPos.tp2Price;
        if (hitSl) {
          capital = Math.max(0, capital - openPos.lossAtSl);
          trades.push({ ...openPos, exitReason: 'SL', rMultiple: -1, pnlUsd: -openPos.lossAtSl, exitTime: today.closeTime, tiersHit: 0 });
          capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
        } else if (hitTp2) {
          const profitLeg = openPos.nilaiPosisi * 0.5 * (tp2R * openPos.nyawaPct / 100); // 2R senilai apa dlm $ buat separuh posisi
          capital += profitLeg;
          openPos.realizedPnl = profitLeg; openPos.sl = openPos.entryPrice; openPos.tier = 1;
        }
      } else if (openPos.tier === 1) { // udah TP2 (separuh terjual), SL=breakeven, nunggu TP3 ATAU trend patah
        const hitSl = today.low <= openPos.sl; // breakeven
        const hitTp3 = today.high >= openPos.tp3Price;
        if (hitSl || trendBroken) {
          const exitPrice = hitSl ? openPos.sl : today.close;
          const movePctSigned = (exitPrice - openPos.entryPrice) / openPos.entryPrice * 100;
          const pnlRest = openPos.nilaiPosisi * 0.5 * (movePctSigned / 100);
          capital = Math.max(0, capital + pnlRest);
          const totalPnl = openPos.realizedPnl + pnlRest;
          trades.push({ ...openPos, exitReason: hitSl ? 'SL_BREAKEVEN' : 'TRAIL_EXIT', rMultiple: openPos.nyawaPct > 0 ? movePctSigned / openPos.nyawaPct : 0, pnlUsd: totalPnl, exitTime: today.closeTime, tiersHit: 1 });
          capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
        } else if (hitTp3) {
          // BUG ketemu+fix (21 Agu 2026, angka awal $17.584->$1.826 gak masuk akal buat R-multiple
          // yang cuma turun dikit -- ketauan): cost basis leg ini TETAP dari ENTRY asli (bukan
          // TP2), jadi reward-nya WAJIB 3R penuh (tp3R*nyawaPct) sama kayak pola pnlRest final di
          // 2-tahap asli, BUKAN cuma kenaikan incremental TP2->TP3 (1R) -- versi salah understate
          // profit leg ini 3x lipat, compound ke SEMUA trade berikutnya lewat sizing capital yg
          // jadi lebih kecil dari seharusnya tiap kali.
          const rewardPct = tp3R * openPos.nyawaPct; // R PENUH dari entry, bukan incremental
          const profitLeg2 = openPos.nilaiPosisi * 0.25 * (rewardPct / 100);
          capital += profitLeg2;
          openPos.realizedPnl += profitLeg2;
          openPos.sl = openPos.tp2Price; // ratchet SL ke level TP2 -- sisa 1/4 minimal untung segitu
          openPos.tier = 2;
        }
      } else { // tier 2: sisa 1/4 "bonus", SL diratchet ke TP2, trailing SMA tetap jalan
        const hitSl = today.low <= openPos.sl; // level TP2
        if (hitSl || trendBroken) {
          const exitPrice = hitSl ? openPos.sl : today.close;
          const movePctSigned = (exitPrice - openPos.entryPrice) / openPos.entryPrice * 100;
          const pnlRest = openPos.nilaiPosisi * 0.25 * (movePctSigned / 100);
          capital = Math.max(0, capital + pnlRest);
          const totalPnl = openPos.realizedPnl + pnlRest;
          trades.push({ ...openPos, exitReason: hitSl ? 'SL_RATCHET_TP2' : 'TRAIL_EXIT', rMultiple: openPos.nyawaPct > 0 ? movePctSigned / openPos.nyawaPct : 0, pnlUsd: totalPnl, exitTime: today.closeTime, tiersHit: 2 });
          capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
        }
      }
      continue;
    }

    const lastPrice = today.close;
    let direction = null, sl = null, patternType = null;
    if (usePatterns.includes('flag')) {
      const flag = detectFlag(daily, i, { poleLookbackRange, poleMinMovePct, flagLookbackRange, flagMaxRangePct });
      if (flag && flag.type === 'bull' && lastPrice > flag.flagHigh) { direction = 'buy'; sl = flag.flagLow * (1 - slBufferPct / 100); patternType = 'flag_bull'; }
    }
    if (!direction && usePatterns.includes('wedge')) {
      const wedge = detectWedge(daily, i, { wedgeLookbackRange, minTouches: wedgeMinTouches, convergenceRatio: wedgeConvergenceRatio });
      if (wedge && wedge.type === 'falling' && lastPrice > wedge.projectedResistance) { direction = 'buy'; sl = wedge.recentSwingLow * (1 - slBufferPct / 100); patternType = 'wedge_falling'; }
    }
    if (!direction) continue;

    const riskDistance = Math.abs(lastPrice - sl);
    if (riskDistance === 0) continue;
    const nyawaPct = riskDistance / lastPrice * 100;
    if (maxNyawaPct !== null && nyawaPct > maxNyawaPct) continue;
    const { nilaiPosisi, margin } = hitungExposure({ modal: capital, entry: lastPrice, stopLoss: sl });
    if (margin > capital) continue;
    const marginPct = margin / capital * 100;
    if (marginPct > maxMarginPct) continue;
    const lossAtSl = nilaiPosisi * (nyawaPct / 100);
    const tp2Price = lastPrice + riskDistance * tp2R;
    const tp3Price = lastPrice + riskDistance * tp3R;

    openPos = {
      direction, entryPrice: lastPrice, sl, originalSl: sl, tp2Price, tp3Price, entryTime: today.closeTime,
      nilaiPosisi, margin, marginPct, lossAtSl, nyawaPct, realizedPnl: 0, tier: 0, patternType,
    };
  }

  let peak = -Infinity, maxDrawdownPct = 0;
  for (const pt of capitalSeries) { peak = Math.max(peak, pt.capital); maxDrawdownPct = Math.max(maxDrawdownPct, (peak - pt.capital) / peak * 100); }
  return { trades, finalCapital: capital, maxDrawdownPct, capitalSeries };
}

// Strategi PROFIT-SHORT (21 Agu 2026, usulan Olan): sama kayak runFlag3TierBacktest, TAPI profit
// yang direalisasi di TP2 dan TP3 GAK langsung masuk capital -- dipakai jadi MODAL short leverage
// 1x (uang untung sendiri yang di-short-kan, bukan dolar baru). Short ini GAK punya SL/TP sendiri,
// dibiarin jalan terus (cuma kena liquidasi kalau harga naik >=2x dari entry short, leverage 1x)
// SELAMA sisa umur posisi long ini (tier1->tier2->exit) DAN selama masa nunggu sampai sinyal
// long BERIKUTNYA muncul. Begitu sinyal long baru valid: SEMUA short ditutup paksa (untung/rugi
// apa adanya), hasilnya baru masuk capital, baru long baru entry pakai kalkulator exposure normal.
// Sisa 1/4 "bonus" tetap exit biasa (SL ratchet TP2 / trend patah) LANGSUNG ke capital, TIDAK
// di-short-kan (permintaan awal Olan: "sisanya lebih ke bodo amat... tapi tetep punya metode exit").
function runFlag3TierProfitShortBacktest(daily, opts = {}) {
  const {
    warmupDays = 60, poleLookbackRange = [5, 20], poleMinMovePct = 15, flagLookbackRange = [3, 15], flagMaxRangePct = 8,
    slBufferPct = 0.5, trailSmaLen = 10,
    startCapital = 100, topUpAmount = 100, topUpStopAt = 1000, topUpDayOfMonth = 5,
    usePatterns = ['flag', 'wedge'], wedgeLookbackRange = [15, 40], wedgeMinTouches = 2, wedgeConvergenceRatio = 0.65,
    maxMarginPct = 20, maxNyawaPct = null,
    tp2R = 2, tp3R = 3, shortLeverage = 1,
  } = opts;
  const trades = [];
  const shortTrades = [];
  let shorts = []; // { entryPrice, entryTime, margin, nilaiPosisi, liqPrice, source }
  let openPos = null;
  let capital = startCapital;
  let lastTopUpMonthKey = null;
  const capitalSeries = [{ time: daily[warmupDays] ? daily[warmupDays].closeTime : 0, capital }];

  function openProfitShort(entryPrice, entryTime, margin, source) {
    if (margin <= 0) return;
    const nilaiPosisi = margin * shortLeverage;
    const liqPrice = entryPrice * (1 + 1 / shortLeverage);
    shorts.push({ entryPrice, entryTime, margin, nilaiPosisi, liqPrice, source });
  }

  function closeShort(sh, exitPrice, exitTime, reason) {
    const movePctSigned = (sh.entryPrice - exitPrice) / sh.entryPrice * 100; // short: turun = untung
    const pnlUsd = reason === 'LIQ' ? -sh.margin : sh.nilaiPosisi * (movePctSigned / 100);
    capital = Math.max(0, capital + pnlUsd);
    shortTrades.push({ ...sh, exitPrice, exitTime, exitReason: reason, pnlUsd });
    capitalSeries.push({ time: exitTime, capital });
  }

  for (let i = warmupDays; i < daily.length; i++) {
    const today = daily[i];
    const todayDate = new Date(today.closeTime);
    const curMonthKey = todayDate.getUTCFullYear() * 12 + todayDate.getUTCMonth();
    if (todayDate.getUTCDate() >= topUpDayOfMonth && curMonthKey !== lastTopUpMonthKey) {
      lastTopUpMonthKey = curMonthKey;
      if (capital < topUpStopAt) { capital += topUpAmount; capitalSeries.push({ time: today.closeTime, capital }); }
    }

    // Cek liquidasi short profit-funded tiap hari, independen dari status openPos.
    if (shorts.length > 0) {
      const stillOpen = [];
      for (const sh of shorts) {
        if (today.high >= sh.liqPrice) closeShort(sh, sh.liqPrice, today.closeTime, 'LIQ');
        else stillOpen.push(sh);
      }
      shorts = stillOpen;
    }

    if (openPos) {
      const closes = daily.slice(0, i + 1).map((c) => c.close);
      const trailSma = sma(closes, trailSmaLen);
      const trendBroken = trailSma !== null && today.close < trailSma;

      if (openPos.tier === 0) {
        const hitSl = today.low <= openPos.sl;
        const hitTp2 = today.high >= openPos.tp2Price;
        if (hitSl) {
          capital = Math.max(0, capital - openPos.lossAtSl);
          trades.push({ ...openPos, exitReason: 'SL', rMultiple: -1, pnlUsd: -openPos.lossAtSl, exitTime: today.closeTime, tiersHit: 0 });
          capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
        } else if (hitTp2) {
          const profitLeg = openPos.nilaiPosisi * 0.5 * (tp2R * openPos.nyawaPct / 100);
          openProfitShort(today.close, today.closeTime, profitLeg, 'TP2'); // profit -> modal short, BUKAN capital langsung
          openPos.realizedPnl = profitLeg; openPos.sl = openPos.entryPrice; openPos.tier = 1;
        }
      } else if (openPos.tier === 1) {
        const hitSl = today.low <= openPos.sl;
        const hitTp3 = today.high >= openPos.tp3Price;
        if (hitSl || trendBroken) {
          const exitPrice = hitSl ? openPos.sl : today.close;
          const movePctSigned = (exitPrice - openPos.entryPrice) / openPos.entryPrice * 100;
          const pnlRest = openPos.nilaiPosisi * 0.5 * (movePctSigned / 100);
          capital = Math.max(0, capital + pnlRest);
          const totalPnl = openPos.realizedPnl + pnlRest;
          trades.push({ ...openPos, exitReason: hitSl ? 'SL_BREAKEVEN' : 'TRAIL_EXIT', rMultiple: openPos.nyawaPct > 0 ? movePctSigned / openPos.nyawaPct : 0, pnlUsd: totalPnl, exitTime: today.closeTime, tiersHit: 1 });
          capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
        } else if (hitTp3) {
          const rewardPct = tp3R * openPos.nyawaPct;
          const profitLeg2 = openPos.nilaiPosisi * 0.25 * (rewardPct / 100);
          openProfitShort(today.close, today.closeTime, profitLeg2, 'TP3'); // profit -> modal short juga
          openPos.realizedPnl += profitLeg2;
          openPos.sl = openPos.tp2Price;
          openPos.tier = 2;
        }
      } else { // tier 2: sisa 1/4 "bodo amat" -- exit LANGSUNG ke capital, gak di-short-kan
        const hitSl = today.low <= openPos.sl;
        if (hitSl || trendBroken) {
          const exitPrice = hitSl ? openPos.sl : today.close;
          const movePctSigned = (exitPrice - openPos.entryPrice) / openPos.entryPrice * 100;
          const pnlRest = openPos.nilaiPosisi * 0.25 * (movePctSigned / 100);
          capital = Math.max(0, capital + pnlRest);
          const totalPnl = openPos.realizedPnl + pnlRest;
          trades.push({ ...openPos, exitReason: hitSl ? 'SL_RATCHET_TP2' : 'TRAIL_EXIT', rMultiple: openPos.nyawaPct > 0 ? movePctSigned / openPos.nyawaPct : 0, pnlUsd: totalPnl, exitTime: today.closeTime, tiersHit: 2 });
          capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
        }
      }
      continue;
    }

    const lastPrice = today.close;
    let direction = null, sl = null, patternType = null;
    if (usePatterns.includes('flag')) {
      const flag = detectFlag(daily, i, { poleLookbackRange, poleMinMovePct, flagLookbackRange, flagMaxRangePct });
      if (flag && flag.type === 'bull' && lastPrice > flag.flagHigh) { direction = 'buy'; sl = flag.flagLow * (1 - slBufferPct / 100); patternType = 'flag_bull'; }
    }
    if (!direction && usePatterns.includes('wedge')) {
      const wedge = detectWedge(daily, i, { wedgeLookbackRange, minTouches: wedgeMinTouches, convergenceRatio: wedgeConvergenceRatio });
      if (wedge && wedge.type === 'falling' && lastPrice > wedge.projectedResistance) { direction = 'buy'; sl = wedge.recentSwingLow * (1 - slBufferPct / 100); patternType = 'wedge_falling'; }
    }
    if (!direction) continue;

    // Sinyal long baru valid -- tutup paksa SEMUA short profit-funded yang masih nyisa (untung/rugi
    // apa adanya), baru capital dihitung ulang, baru entry long pakai kalkulator exposure normal.
    if (shorts.length > 0) {
      for (const sh of shorts) closeShort(sh, lastPrice, today.closeTime, 'SINYAL_LONG');
      shorts = [];
    }

    const riskDistance = Math.abs(lastPrice - sl);
    if (riskDistance === 0) continue;
    const nyawaPct = riskDistance / lastPrice * 100;
    if (maxNyawaPct !== null && nyawaPct > maxNyawaPct) continue;
    const { nilaiPosisi, margin } = hitungExposure({ modal: capital, entry: lastPrice, stopLoss: sl });
    if (margin > capital) continue;
    const marginPct = margin / capital * 100;
    if (marginPct > maxMarginPct) continue;
    const lossAtSl = nilaiPosisi * (nyawaPct / 100);
    const tp2Price = lastPrice + riskDistance * tp2R;
    const tp3Price = lastPrice + riskDistance * tp3R;

    openPos = {
      direction, entryPrice: lastPrice, sl, originalSl: sl, tp2Price, tp3Price, entryTime: today.closeTime,
      nilaiPosisi, margin, marginPct, lossAtSl, nyawaPct, realizedPnl: 0, tier: 0, patternType,
    };
  }

  let peak = -Infinity, maxDrawdownPct = 0;
  for (const pt of capitalSeries) { peak = Math.max(peak, pt.capital); maxDrawdownPct = Math.max(maxDrawdownPct, (peak - pt.capital) / peak * 100); }
  return { trades, shortTrades, finalCapital: capital, maxDrawdownPct, capitalSeries };
}

// Riset 21 Agu 2026 (Olan: "kalahin metode terbaik kita" -- $17.584 baseline 2-tier): 3-tier DAN
// profit-short SAMA-SAMA kebukti ngerusak compounding krn motong sebagian besar posisi lebih awal
// (lihat [[feedback-nyopet-buyonly]] & [[project-kaela-btc-sinyal]]). Hipotesis kebalikannya: kalau
// motong SEBAGIAN aja udah ngerusak, gimana kalau JANGAN jual separuh SAMA SEKALI -- posisi penuh
// dibiarin lari terus (cuma SL digeser breakeven pas profit udah sekian R), baru exit PENUH pas
// trend beneran patah (trailing SMA) atau breakeven kesentuh. Full-ride, gak ada partial exit.
function runFlagFullTrailBacktest(daily, opts = {}) {
  const {
    warmupDays = 60, poleLookbackRange = [5, 20], poleMinMovePct = 15, flagLookbackRange = [3, 15], flagMaxRangePct = 8,
    slBufferPct = 0.5, trailSmaLen = 10, beTriggerR = 1,
    startCapital = 100, topUpAmount = 100, topUpStopAt = 1000, topUpDayOfMonth = 5,
    usePatterns = ['flag', 'wedge'], wedgeLookbackRange = [15, 40], wedgeMinTouches = 2, wedgeConvergenceRatio = 0.65,
    maxMarginPct = 20, maxNyawaPct = null,
    // partialSellFraction (0-1): porsi posisi yang dijual pas beTriggerPrice kesentuh (0 = full-ride
    // murni/default, 0.5 = sama kayak baseline 2-tier lama). Sisanya (1-fraction) tetap trail penuh.
    partialSellFraction = 0,
  } = opts;
  const trades = [];
  let openPos = null;
  let capital = startCapital;
  let lastTopUpMonthKey = null;
  const capitalSeries = [{ time: daily[warmupDays] ? daily[warmupDays].closeTime : 0, capital }];

  for (let i = warmupDays; i < daily.length; i++) {
    const today = daily[i];
    const todayDate = new Date(today.closeTime);
    const curMonthKey = todayDate.getUTCFullYear() * 12 + todayDate.getUTCMonth();
    if (todayDate.getUTCDate() >= topUpDayOfMonth && curMonthKey !== lastTopUpMonthKey) {
      lastTopUpMonthKey = curMonthKey;
      if (capital < topUpStopAt) { capital += topUpAmount; capitalSeries.push({ time: today.closeTime, capital }); }
    }

    if (openPos) {
      const closes = daily.slice(0, i + 1).map((c) => c.close);
      const trailSma = sma(closes, trailSmaLen);
      const hitSl = today.low <= openPos.sl;
      if (hitSl) {
        const exitPrice = openPos.sl;
        const movePctSigned = (exitPrice - openPos.entryPrice) / openPos.entryPrice * 100;
        const pnlUsd = openPos.remainingNilai * (movePctSigned / 100);
        capital = Math.max(0, capital + pnlUsd);
        const totalPnl = openPos.realizedPnl + pnlUsd;
        trades.push({ ...openPos, exitReason: openPos.beMoved ? 'SL_BREAKEVEN' : 'SL', rMultiple: openPos.nyawaPct > 0 ? movePctSigned / openPos.nyawaPct : 0, pnlUsd: totalPnl, exitTime: today.closeTime });
        capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
        continue;
      }
      if (!openPos.beMoved && today.high >= openPos.beTriggerPrice) {
        if (partialSellFraction > 0) {
          const rewardPct = (openPos.beTriggerPrice - openPos.entryPrice) / openPos.entryPrice * 100;
          const profitLeg = openPos.nilaiPosisi * partialSellFraction * (rewardPct / 100);
          capital += profitLeg;
          openPos.realizedPnl += profitLeg;
          openPos.remainingNilai = openPos.nilaiPosisi * (1 - partialSellFraction);
        }
        openPos.sl = openPos.entryPrice; openPos.beMoved = true; // kunci gak rugi buat sisa posisi
      }
      const trendBroken = openPos.beMoved && trailSma !== null && today.close < trailSma;
      if (trendBroken) {
        const exitPrice = today.close;
        const movePctSigned = (exitPrice - openPos.entryPrice) / openPos.entryPrice * 100;
        const pnlUsd = openPos.remainingNilai * (movePctSigned / 100);
        capital = Math.max(0, capital + pnlUsd);
        const totalPnl = openPos.realizedPnl + pnlUsd;
        trades.push({ ...openPos, exitReason: 'TRAIL_EXIT', rMultiple: openPos.nyawaPct > 0 ? movePctSigned / openPos.nyawaPct : 0, pnlUsd: totalPnl, exitTime: today.closeTime });
        capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
      }
      continue;
    }

    const lastPrice = today.close;
    let direction = null, sl = null, patternType = null;
    if (usePatterns.includes('flag')) {
      const flag = detectFlag(daily, i, { poleLookbackRange, poleMinMovePct, flagLookbackRange, flagMaxRangePct });
      if (flag && flag.type === 'bull' && lastPrice > flag.flagHigh) { direction = 'buy'; sl = flag.flagLow * (1 - slBufferPct / 100); patternType = 'flag_bull'; }
    }
    if (!direction && usePatterns.includes('wedge')) {
      const wedge = detectWedge(daily, i, { wedgeLookbackRange, minTouches: wedgeMinTouches, convergenceRatio: wedgeConvergenceRatio });
      if (wedge && wedge.type === 'falling' && lastPrice > wedge.projectedResistance) { direction = 'buy'; sl = wedge.recentSwingLow * (1 - slBufferPct / 100); patternType = 'wedge_falling'; }
    }
    if (!direction) continue;

    const riskDistance = Math.abs(lastPrice - sl);
    if (riskDistance === 0) continue;
    const nyawaPct = riskDistance / lastPrice * 100;
    if (maxNyawaPct !== null && nyawaPct > maxNyawaPct) continue;
    const { nilaiPosisi, margin } = hitungExposure({ modal: capital, entry: lastPrice, stopLoss: sl });
    if (margin > capital) continue;
    const marginPct = margin / capital * 100;
    if (marginPct > maxMarginPct) continue;
    const lossAtSl = nilaiPosisi * (nyawaPct / 100);
    const beTriggerPrice = lastPrice + riskDistance * beTriggerR;

    openPos = {
      direction, entryPrice: lastPrice, sl, originalSl: sl, beTriggerPrice, entryTime: today.closeTime,
      nilaiPosisi, remainingNilai: nilaiPosisi, margin, marginPct, lossAtSl, nyawaPct, beMoved: false, realizedPnl: 0, patternType,
    };
  }

  let peak = -Infinity, maxDrawdownPct = 0;
  for (const pt of capitalSeries) { peak = Math.max(peak, pt.capital); maxDrawdownPct = Math.max(maxDrawdownPct, (peak - pt.capital) / peak * 100); }
  return { trades, finalCapital: capital, maxDrawdownPct, capitalSeries };
}

function summarize(trades) {
  const n = trades.length;
  if (n === 0) return { n: 0 };
  const wins = trades.filter((t) => t.rMultiple > 0);
  const totalR = trades.reduce((s, t) => s + t.rMultiple, 0);
  const grossWinR = wins.reduce((s, t) => s + t.rMultiple, 0);
  const grossLossR = Math.abs(trades.filter((t) => t.rMultiple <= 0).reduce((s, t) => s + t.rMultiple, 0));
  return { n, winRate: (wins.length / n * 100).toFixed(1) + '%', profitFactor: grossLossR > 0 ? (grossWinR / grossLossR).toFixed(2) : 'inf', totalR: totalR.toFixed(2), avgR: (totalR / n).toFixed(2) };
}

module.exports = { runFlagBacktest, runShortHedgeBacktest, runFlag3TierBacktest, runFlag3TierProfitShortBacktest, runFlagFullTrailBacktest, detectFlag, detectWedge, summarize, fetchAllCandles };

if (require.main === module) {
  (async () => {
    // Reuse cache candle harian yang udah ada (backtest/daily-cache.json, dipakai riset Dark
    // Kaela juga) -- sama simbol/interval/rentang, hindari fetch ulang lewat jaringan.
    const path = require('path');
    const fs = require('fs');
    const cachePath = path.join(__dirname, 'backtest', 'daily-cache.json');
    let daily;
    if (fs.existsSync(cachePath)) {
      daily = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      console.log('Pakai cache:', cachePath);
    } else {
      const startTime = new Date('2017-08-17').getTime();
      daily = await fetchAllCandles('BTCUSDT', '1d', startTime);
    }
    console.log('Daily candles:', daily.length);

    function report(label, opts) {
      const r = runFlagBacktest(daily, opts);
      const s = summarize(r.trades);
      console.log(`\n[${label}]`);
      console.log(`  n=${s.n} | winRate=${s.winRate} | PF=${s.profitFactor} | totalR=${s.totalR} | avgR=${s.avgR}`);
      console.log(`  finalCapital=$${r.finalCapital.toFixed(2)} | maxDD=${r.maxDrawdownPct.toFixed(1)}%`);
      const shorts = r.trades.filter((t) => t.direction === 'sell');
      const shortWins = shorts.filter((t) => t.rMultiple > 0);
      if (shorts.length > 0) {
        console.log(`  -- khusus SHORT: n=${shorts.length} | winRate=${(shortWins.length / shorts.length * 100).toFixed(1)}% | totalR=${shorts.reduce((s2, t) => s2 + t.rMultiple, 0).toFixed(2)} | totalPnl=$${shorts.reduce((s2, t) => s2 + t.pnlUsd, 0).toFixed(2)}`);
      }
      return { r, s };
    }

    // 21 Agu 2026, permintaan Olan: "backtest sniper.. coba adakan lagi short.. dengan syarat
    // input modal kalkulator exposure selalu, tapi short 1/10 modal asli" -- 3 varian dibandingin.
    report('BASELINE (buy-only, live sekarang)', { allowShort: false });
    report('Short AKTIF, sizing SAMA RATA (versi lama yang kebukti ngerusak)', { allowShort: true, shortModalDivisor: 1 });
    report('Short AKTIF, sizing 1/10 modal (usulan baru Olan)', { allowShort: true, shortModalDivisor: 10 });

    // 21 Agu 2026: "kalo gak ada sinyal sniper, default selalu flat short 1% modal leverage 3x,
    // begitu ada sinyal short ditutup masuk long" -- strategi BEDA total, fungsi terpisah.
    console.log('\n=== Strategi HEDGE PASIF (flat short 1% modal/3x nunggu sinyal) ===');
    const hedge = runShortHedgeBacktest(daily);
    const hs = summarize(hedge.trades);
    console.log(`\n[Hedge pasif -- sisi LONG (sinyal Sniper)]`);
    console.log(`  n=${hs.n} | winRate=${hs.winRate} | PF=${hs.profitFactor} | totalR=${hs.totalR} | avgR=${hs.avgR}`);
    console.log(`  finalCapital=$${hedge.finalCapital.toFixed(2)} | maxDD=${hedge.maxDrawdownPct.toFixed(1)}%`);
    const liqCount = hedge.shortTrades.filter((t) => t.reason === 'LIQUIDASI').length;
    const totalShortPnl = hedge.shortTrades.reduce((s, t) => s + t.pnlUsd, 0);
    console.log(`\n[Hedge pasif -- sisi SHORT (default state)]`);
    console.log(`  total short dibuka: ${hedge.shortTrades.length} | KENA LIKUIDASI: ${liqCount}x | total PNL short: $${totalShortPnl.toFixed(2)}`);

    // 21 Agu 2026: 3-tier exit (TP1 info/TP2 jual separuh/TP3 jual separuh sisa) vs versi profit-short
    // (profit TP2+TP3 dipakai modal short leverage 1x, ditutup paksa pas sinyal long berikutnya).
    console.log('\n=== 3-TIER EXIT vs 3-TIER + PROFIT-SHORT ===');
    const tier3 = runFlag3TierBacktest(daily);
    const t3s = summarize(tier3.trades);
    console.log(`\n[3-Tier polos]`);
    console.log(`  n=${t3s.n} | winRate=${t3s.winRate} | PF=${t3s.profitFactor} | totalR=${t3s.totalR} | avgR=${t3s.avgR}`);
    console.log(`  finalCapital=$${tier3.finalCapital.toFixed(2)} | maxDD=${tier3.maxDrawdownPct.toFixed(1)}%`);

    const ps = runFlag3TierProfitShortBacktest(daily);
    const pss = summarize(ps.trades);
    console.log(`\n[3-Tier + Profit-Short (TP2/TP3 profit di-short-kan sampai sinyal long berikutnya)]`);
    console.log(`  n=${pss.n} | winRate=${pss.winRate} | PF=${pss.profitFactor} | totalR=${pss.totalR} | avgR=${pss.avgR}`);
    console.log(`  finalCapital=$${ps.finalCapital.toFixed(2)} | maxDD=${ps.maxDrawdownPct.toFixed(1)}%`);
    const psLiq = ps.shortTrades.filter((t) => t.exitReason === 'LIQ').length;
    const psShortPnl = ps.shortTrades.reduce((s, t) => s + t.pnlUsd, 0);
    const psShortWins = ps.shortTrades.filter((t) => t.pnlUsd > 0).length;
    console.log(`\n[Profit-Short -- sisi SHORT]`);
    console.log(`  total short dibuka: ${ps.shortTrades.length} (dari TP2: ${ps.shortTrades.filter((t) => t.source === 'TP2').length}, dari TP3: ${ps.shortTrades.filter((t) => t.source === 'TP3').length})`);
    console.log(`  menang: ${psShortWins}/${ps.shortTrades.length} | KENA LIKUIDASI: ${psLiq}x | total PNL short: $${psShortPnl.toFixed(2)}`);
    console.log(`\n[Perbandingan finalCapital] Baseline biasa=$17.584,32 (referensi lama) | 3-Tier polos=$${tier3.finalCapital.toFixed(2)} | 3-Tier+ProfitShort=$${ps.finalCapital.toFixed(2)}`);
  })().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
}
