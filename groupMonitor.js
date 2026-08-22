// Jalankan tiap hari jam 07:00 WITA (sama jadwal ikut closing candle kayak monitor.js).
// Beda dari monitor.js -- itu laporan PRIBADI Olan (dailyReport.js, cuma console+arsip).
// Ini laporan buat GRUP WA "BTC Sniper Club" (groupReport.js) -- dikirim ke WEB (arsip) DAN Fonnte.
// Weekly kirim tiap Senin, Monthly tiap tanggal 1, Yearly tiap 1 Januari (semua kalender WITA).

const {
  generateGroupDaily, generateGroupWeekly, generateGroupMonthly, generateGroupYearly, getWindowPhase,
} = require('./groupReport');
const {
  generateGoldDaily, generateGoldWeekly, generateGoldMonthly, generateGoldYearly,
} = require('./goldGroupReport');
const { sendWhatsApp } = require('./fonnte');
const { addOrReplaceDaily, hasEntryToday } = require('./archive');
const { fetchWithRetry } = require('./httpRetry');
const { toLocal } = require('./config');
const { fetchCycleMetrics, fetchTradeMetrics } = require('./onchainMetrics');
const { fetchMacroContext } = require('./macroData');
const { fetchGoldCotContext } = require('./cotReport');
const { fetchBtcNasdaqRegime, fetchGoldDxyRegime } = require('./regimeTracker');
const { fetchFearGreed } = require('./marketSentiment');
const { rsi } = require('./technicalAnalysis');
const { computeBtcConviction, computeGoldConviction, formatConvictionLines } = require('./convictionScore');
const { logVerdict, gradeMaturedVerdicts, formatTrackRecordLine, getTrackRecordSummary } = require('./trackRecord');
const { fetchAdvancedMacroContext, classifyFedRateTrend, classifyCreditSpreadTrend } = require('./advancedMacro');
const { checkGoldCotPriceDivergence, checkCalmBeforeStorm, checkPriceNuplDivergence, formatDivergenceLines } = require('./divergenceDetector');
const fs = require('fs');
const path = require('path');

// Baca state squeeze detector (squeezeDetector.js) -- read-only, dipakai sbg salah satu faktor
// Conviction Score. `lastType` null kalau kondisi lagi normal (gak ada setup aktif).
function readSqueezeState() {
  try {
    const p = path.join(__dirname, 'squeeze-alert-state.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8')).lastType || null;
  } catch {
    return null;
  }
}

async function safe(fn, label) {
  try {
    return await fn();
  } catch (e) {
    console.log(`[GroupMonitor] ${label} gagal diambil (dilewatin):`, e.message);
    return null;
  }
}

async function safeOnchain() {
  try {
    return await fetchCycleMetrics();
  } catch (e) {
    console.log('[GroupMonitor] On-chain metrics gagal diambil (dilewatin):', e.message);
    return null;
  }
}

// macroData.js sendiri udah null-safe per-field (DXY/real yield independen), tapi bungkus lagi
// jaga-jaga kalau FRED down total -- laporan Emas TETAP kirim tanpa konteks makro, bukan gagal total.
async function safeMacro() {
  try {
    return await fetchMacroContext();
  } catch (e) {
    console.log('[GroupMonitor] Konteks makro (FRED) gagal diambil (dilewatin):', e.message);
    return null;
  }
}

async function safeCot() {
  try {
    return await fetchGoldCotContext();
  } catch (e) {
    console.log('[GroupMonitor] COT Report Emas (CFTC) gagal diambil (dilewatin):', e.message);
    return null;
  }
}

async function safeRegime(fetchFn, label) {
  try {
    return await fetchFn();
  } catch (e) {
    console.log(`[GroupMonitor] Regime ${label} gagal diambil (dilewatin):`, e.message);
    return null;
  }
}

// data-api.binance.vision -- endpoint RESMI Binance khusus market data publik (harga/kline),
// gak kena batasan geografis kayak api.binance.com biasa (GitHub Actions runner ketauan
// diblokir HTTP 451 "restricted location" pas testing 2026-08-08).
const BASE_URL = 'https://data-api.binance.vision/api/v3/klines';

function parseCandle(raw) {
  return { closeTime: raw[6], close: parseFloat(raw[4]) };
}

// symbol (22 Agu 2026, upgrade laporan Emas) -- dulu hardcode BTCUSDT, sekarang parameter biar
// bisa dipanggil buat PAXGUSDT (Emas) juga, satu fungsi dipakai bareng.
async function fetchDailyCandles(symbol, limit) {
  const res = await fetchWithRetry(`${BASE_URL}?symbol=${symbol}&interval=1d&limit=${limit}`);
  const raw = await res.json();
  return raw.map(parseCandle);
}

// Bug ketemu 21 Agu 2026 (lapor Olan: "harga yang dilaporkan hari ini malah closing hari
// kemarin"): "Harga sekarang" di pesan grup dulu pakai close candle HARIAN TERAKHIR yang udah
// closed -- pas cron jalan 07:03 WITA (23:03 UTC), candle harian hari itu (UTC) BELUM closed
// (baru closed jam 00:00 UTC berikutnya), jadi "candle terakhir yang udah closed" itu candle
// KEMARIN (UTC) -- bisa sampai ~23 jam basi, padahal labelnya "sekarang". Fix: harga sekarang
// WAJIB dari ticker LIVE (sama endpoint kayak monitor.js), bukan candle close -- candle harian
// TETAP dipakai buat titik pembanding (kemarin/minggu/bulan/tahun lalu), itu emang harus fixed
// closing price biar perbandingan adil, cuma "harga SEKARANG"-nya yang harus live.
async function fetchLivePrice(symbol) {
  const res = await fetchWithRetry(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${symbol}`);
  const data = await res.json();
  return parseFloat(data.price);
}

function closeDaysAgo(candles, daysAgo) {
  const idx = candles.length - 1 - daysAgo;
  return idx >= 0 ? candles[idx].close : null;
}

async function main() {
  const now = new Date();
  const nowMs = now.getTime();

  // limit 400 candle harian (~13 bulan) cukup buat perbandingan kemarin/minggu/bulan/tahun lalu
  const raw = await fetchDailyCandles('BTCUSDT', 400);
  const closed = raw.filter((c) => c.closeTime <= nowMs);

  if (closed.length < 8) {
    console.log('[GroupMonitor] Data harian BTC belum cukup, skip siklus ini.');
    return;
  }

  const priceToday = await fetchLivePrice('BTCUSDT');
  const priceYesterday = closeDaysAgo(closed, 1);
  const priceLastWeek = closeDaysAgo(closed, 7);
  const priceLastMonth = closeDaysAgo(closed, 30);
  const priceLastYear = closeDaysAgo(closed, 365);

  // Emas/XAU (22 Agu 2026, permintaan Olan -- "biar gak terkesan bisu soal Emas") -- PAXGUSDT
  // baru ada di Binance sejak Des 2025, jadi limit histori LEBIH PENDEK dari BTC (gak semua
  // perbandingan (mis. setahun lalu) bakal selalu ada, null-safe kalau datanya belum cukup).
  let goldClosed = [];
  try {
    const goldRaw = await fetchDailyCandles('PAXGUSDT', 400);
    goldClosed = goldRaw.filter((c) => c.closeTime <= nowMs);
  } catch (e) {
    console.log('[GroupMonitor] Gagal ambil data Emas (dilewatin):', e.message);
  }
  const goldPriceToday = goldClosed.length > 0 ? await fetchLivePrice('PAXGUSDT') : null;
  const goldPriceYesterday = closeDaysAgo(goldClosed, 1);
  const goldPriceLastWeek = closeDaysAgo(goldClosed, 7);
  const goldPriceLastMonth = closeDaysAgo(goldClosed, 30);
  const goldPriceLastYear = closeDaysAgo(goldClosed, 365);

  // Hari/tanggal/bulan WAJIB dihitung dari kalender WITA (toLocal), BUKAN UTC mentah --
  // cron GitHub Actions jalan di UTC, jam 23:00 UTC hari-H = 07:00 WITA hari BERIKUTNYA,
  // jadi getUTCDate() mentah bakal salah 1 hari kalau gak digeser dulu.
  const local = toLocal(now);
  const items = [];
  // On-chain (MVRV+Puell) cuma di-fetch kalau ADA laporan yang beneran mau dikirim (hemat quota
  // 10req/jam) -- 1x fetch DIPAKAI BARENG daily (MVRV+Puell) & weekly (MVRV doang, buat Conviction
  // Score), biar gak dobel panggil onchainMetrics.js dalam 1 run yang sama.
  const willSendWeekly = local.getUTCDay() === 1 && priceLastWeek !== null;
  const onchain = (priceYesterday !== null || willSendWeekly) ? await safeOnchain() : null;

  // Nilai verdict Conviction Score LAMA yang udah cukup umur (>=7 hari) pakai harga SEKARANG,
  // SEBELUM catat verdict baru -- urutan ini penting biar verdict yang barusan dibuat gak
  // ketilep langsung ke-grade pas run yang sama. 1x panggil buat DUA aset sekaligus.
  if (willSendWeekly) gradeMaturedVerdicts(now, { btc: priceToday, xau: goldPriceToday });

  // Diisi di blok weekly BTC di bawah, dipakai lagi di blok weekly Emas (1x fetch dipakai bareng
  // 2 laporan -- DVOL/Stablecoin/YieldCurve/M2 sama-sama relevan buat kedua aset).
  let advancedMacro = null;
  // Snapshot buat web/analis.html (Kaela Analyst Terminal, 22 Agu 2026) -- data yang SAMA persis
  // yang dikirim ke WA, ditulis juga ke JSON biar bisa direfer kapan aja lewat web, bukan cuma
  // sekali lewat pas pesan WA muncul terus ilang ketimbun chat.
  let dashboardData = null;

  if (priceYesterday !== null) {
    items.push({ type: 'report-daily', content: generateGroupDaily(now, priceToday, priceYesterday, { onchain }) });
  }
  if (willSendWeekly) {
    const [regime, nupl, fearGreed] = await Promise.all([
      safeRegime(fetchBtcNasdaqRegime, 'BTC-Nasdaq'),
      safe(async () => (await fetchTradeMetrics()).nupl, 'NUPL'),
      safe(fetchFearGreed, 'Fear & Greed'),
    ]);
    advancedMacro = await safe(fetchAdvancedMacroContext, 'Advanced Macro (DVOL/Stablecoin/YieldCurve/M2)');
    const btcRsi = rsi(closed.map((c) => c.close), 14);
    const conviction = computeBtcConviction({
      rsi: btcRsi, mvrv: onchain?.mvrv || null, nupl, fearGreed,
      squeezeState: readSqueezeState(),
      halvingPhase: getWindowPhase(now),
      stablecoinGrowth: advancedMacro?.stablecoin || null,
      m2Growth: advancedMacro?.m2 || null,
      fedRateTrend: advancedMacro?.fedRate ? classifyFedRateTrend(advancedMacro.fedRate) : null,
      creditSpreadTrend: advancedMacro?.creditSpread ? classifyCreditSpreadTrend(advancedMacro.creditSpread) : null,
    });
    logVerdict('btc', now, conviction.score, conviction.verdict, priceToday);
    // Divergence Detector (22 Agu 2026, lihat divergenceDetector.js) -- pakai data yang UDAH
    // di-fetch di atas, gak nambah request. "Tenang di permukaan, stres di bawah" (DVOL+Credit
    // Spread naik bareng walau Conviction gak bearish) + harga naik tapi NUPL gak ngonfirmasi.
    const btcPriceChangePct = ((priceToday - priceLastWeek) / priceLastWeek) * 100;
    const btcDivergences = [
      checkCalmBeforeStorm(conviction.score, advancedMacro?.dvol, advancedMacro?.creditSpread),
      checkPriceNuplDivergence(btcPriceChangePct, nupl),
    ].filter(Boolean);
    const weeklyMsg = generateGroupWeekly(now, priceToday, priceLastWeek, { regime, advancedMacro: advancedMacro ? { dvol: advancedMacro.dvol, yieldCurve: advancedMacro.yieldCurve } : null })
      + '\n\n' + formatConvictionLines(conviction).join('\n')
      + '\n' + formatTrackRecordLine('btc')
      + formatDivergenceLines(btcDivergences).join('\n');
    items.push({ type: 'report-weekly', content: weeklyMsg });
    dashboardData = dashboardData || {};
    dashboardData.btc = {
      price: priceToday, conviction, trackRecord: getTrackRecordSummary('btc'), regime, advancedMacro,
    };
  }
  if (local.getUTCDate() === 1 && priceLastMonth !== null) { // tanggal 1 (WITA)
    items.push({ type: 'report-monthly', content: generateGroupMonthly(now, priceToday, priceLastMonth) });
  }
  if (local.getUTCMonth() === 0 && local.getUTCDate() === 1 && priceLastYear !== null) { // 1 Januari (WITA)
    items.push({ type: 'report-yearly', content: generateGroupYearly(now, priceToday, priceLastYear) });
  }

  // Laporan Emas -- jadwal SAMA kayak BTC (harian tiap hari, mingguan Senin, dst), key `type`
  // BEDA (suffix -gold) biar dedup archive.js gak ketuker sama laporan BTC.
  if (goldPriceToday !== null && goldPriceYesterday !== null) {
    // Makro cuma di-fetch kalau laporan Emas beneran mau dikirim (hemat request, sama pola kayak onchain).
    const macro = await safeMacro();
    items.push({ type: 'report-daily-gold', content: generateGoldDaily(now, goldPriceToday, goldPriceYesterday, { macro }) });
  }
  if (local.getUTCDay() === 1 && goldPriceToday !== null && goldPriceLastWeek !== null) {
    const [macro, cot, regime] = await Promise.all([safeMacro(), safeCot(), safeRegime(fetchGoldDxyRegime, 'Emas-DXY')]);
    const goldRsi = rsi(goldClosed.map((c) => c.close), 14);
    const conviction = computeGoldConviction({
      rsi: goldRsi, dxyTrend: macro?.dxy?.trend || null, realYieldTrend: macro?.realYield?.trend || null, cot,
      fedRateTrend: advancedMacro?.fedRate ? classifyFedRateTrend(advancedMacro.fedRate) : null,
    });
    logVerdict('xau', now, conviction.score, conviction.verdict, goldPriceToday);
    const goldPriceChangePct = ((goldPriceToday - goldPriceLastWeek) / goldPriceLastWeek) * 100;
    const goldDivergences = [checkGoldCotPriceDivergence(cot, goldPriceChangePct)].filter(Boolean);
    const weeklyGoldMsg = generateGoldWeekly(now, goldPriceToday, goldPriceLastWeek, { macro, cot, regime, yieldCurve: advancedMacro?.yieldCurve || null })
      + '\n\n' + formatConvictionLines(conviction).join('\n')
      + '\n' + formatTrackRecordLine('xau')
      + formatDivergenceLines(goldDivergences).join('\n');
    items.push({ type: 'report-weekly-gold', content: weeklyGoldMsg });
    dashboardData = dashboardData || {};
    dashboardData.xau = {
      price: goldPriceToday, conviction, trackRecord: getTrackRecordSummary('xau'), regime, macro, cot,
      yieldCurve: advancedMacro?.yieldCurve || null,
    };
  }

  if (dashboardData) {
    dashboardData.updatedAt = now.toISOString();
    fs.writeFileSync(path.join(__dirname, 'analyst-dashboard.json'), JSON.stringify(dashboardData, null, 2));
  }
  if (local.getUTCDate() === 1 && goldPriceToday !== null && goldPriceLastMonth !== null) {
    items.push({ type: 'report-monthly-gold', content: generateGoldMonthly(now, goldPriceToday, goldPriceLastMonth) });
  }
  if (local.getUTCMonth() === 0 && local.getUTCDate() === 1 && goldPriceToday !== null && goldPriceLastYear !== null) {
    items.push({ type: 'report-yearly-gold', content: generateGoldYearly(now, goldPriceToday, goldPriceLastYear) });
  }

  for (const item of items) {
    if (hasEntryToday(item.type, now)) {
      console.log(`[GroupMonitor] ${item.type} udah kirim hari ini, skip (cegah dobel WA kalau ke-run ulang).`);
      continue;
    }
    console.log(item.content + '\n');
    addOrReplaceDaily(item.type, item.content, now); // anti-dobel kalau ke-run ulang di hari sama
    await sendWhatsApp(item.content);
  }
}

main().catch((e) => {
  console.error('ERROR groupMonitor.js:', e.message);
  process.exit(1);
});
