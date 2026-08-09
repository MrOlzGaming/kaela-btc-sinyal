// Jalankan tiap hari jam 07:00 WITA (sama jadwal ikut closing candle kayak monitor.js).
// Beda dari monitor.js -- itu laporan PRIBADI Olan (dailyReport.js, cuma console+arsip).
// Ini laporan buat GRUP WA "BTC Sniper Club" (groupReport.js) -- dikirim ke WEB (arsip) DAN Fonnte.
// Weekly kirim tiap Senin, Monthly tiap tanggal 1, Yearly tiap 1 Januari (semua kalender WITA).

const {
  generateGroupDaily, generateGroupWeekly, generateGroupMonthly, generateGroupYearly,
} = require('./groupReport');
const { sendWhatsApp } = require('./fonnte');
const { addOrReplaceDaily, hasEntryToday } = require('./archive');
const { fetchWithRetry } = require('./httpRetry');
const { toLocal } = require('./config');
const { fetchCycleMetrics } = require('./onchainMetrics');

async function safeOnchain() {
  try {
    return await fetchCycleMetrics();
  } catch (e) {
    console.log('[GroupMonitor] On-chain metrics gagal diambil (dilewatin):', e.message);
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

async function fetchDailyCandles(limit) {
  const res = await fetchWithRetry(`${BASE_URL}?symbol=BTCUSDT&interval=1d&limit=${limit}`);
  const raw = await res.json();
  return raw.map(parseCandle);
}

function closeDaysAgo(candles, daysAgo) {
  const idx = candles.length - 1 - daysAgo;
  return idx >= 0 ? candles[idx].close : null;
}

async function main() {
  const now = new Date();
  const nowMs = now.getTime();

  // limit 400 candle harian (~13 bulan) cukup buat perbandingan kemarin/minggu/bulan/tahun lalu
  const raw = await fetchDailyCandles(400);
  const closed = raw.filter((c) => c.closeTime <= nowMs);

  if (closed.length < 8) {
    console.log('[GroupMonitor] Data harian belum cukup, skip siklus ini.');
    return;
  }

  const priceToday = closed[closed.length - 1].close;
  const priceYesterday = closeDaysAgo(closed, 1);
  const priceLastWeek = closeDaysAgo(closed, 7);
  const priceLastMonth = closeDaysAgo(closed, 30);
  const priceLastYear = closeDaysAgo(closed, 365);

  // Hari/tanggal/bulan WAJIB dihitung dari kalender WITA (toLocal), BUKAN UTC mentah --
  // cron GitHub Actions jalan di UTC, jam 23:00 UTC hari-H = 07:00 WITA hari BERIKUTNYA,
  // jadi getUTCDate() mentah bakal salah 1 hari kalau gak digeser dulu.
  const local = toLocal(now);
  const items = [];
  if (priceYesterday !== null) {
    // On-chain cuma di-fetch kalau laporan daily beneran mau dikirim (hemat quota 10req/jam).
    const onchain = await safeOnchain();
    items.push({ type: 'report-daily', content: generateGroupDaily(now, priceToday, priceYesterday, { onchain }) });
  }
  if (local.getUTCDay() === 1 && priceLastWeek !== null) { // Senin (WITA)
    items.push({ type: 'report-weekly', content: generateGroupWeekly(now, priceToday, priceLastWeek) });
  }
  if (local.getUTCDate() === 1 && priceLastMonth !== null) { // tanggal 1 (WITA)
    items.push({ type: 'report-monthly', content: generateGroupMonthly(now, priceToday, priceLastMonth) });
  }
  if (local.getUTCMonth() === 0 && local.getUTCDate() === 1 && priceLastYear !== null) { // 1 Januari (WITA)
    items.push({ type: 'report-yearly', content: generateGroupYearly(now, priceToday, priceLastYear) });
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
