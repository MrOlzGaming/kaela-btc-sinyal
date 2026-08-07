// Jalankan tiap hari jam 07:00 WIB (sama jadwal ikut closing candle kayak monitor.js).
// Beda dari monitor.js -- itu laporan PRIBADI Olan (dailyReport.js, cuma console+arsip).
// Ini laporan buat GRUP WA "BTC Sniper Club" (groupReport.js) -- dikirim ke WEB (arsip) DAN Fonnte.
// Weekly kirim tiap Senin, Monthly tiap tanggal 1, Yearly tiap 1 Januari -- Daily tiap hari.

const {
  generateGroupDaily, generateGroupWeekly, generateGroupMonthly, generateGroupYearly,
} = require('./groupReport');
const { sendWhatsApp } = require('./fonnte');
const { addEntry } = require('./archive');

const BASE_URL = 'https://api.binance.com/api/v3/klines';

function parseCandle(raw) {
  return { closeTime: raw[6], close: parseFloat(raw[4]) };
}

async function fetchDailyCandles(limit) {
  const res = await fetch(`${BASE_URL}?symbol=BTCUSDT&interval=1d&limit=${limit}`);
  if (!res.ok) throw new Error(`Binance API error ${res.status}: ${await res.text()}`);
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

  const items = [];
  if (priceYesterday !== null) {
    items.push({ type: 'report-daily', content: generateGroupDaily(now, priceToday, priceYesterday) });
  }
  if (now.getUTCDay() === 1 && priceLastWeek !== null) { // Senin
    items.push({ type: 'report-weekly', content: generateGroupWeekly(now, priceToday, priceLastWeek) });
  }
  if (now.getUTCDate() === 1 && priceLastMonth !== null) { // tanggal 1
    items.push({ type: 'report-monthly', content: generateGroupMonthly(now, priceToday, priceLastMonth) });
  }
  if (now.getUTCMonth() === 0 && now.getUTCDate() === 1 && priceLastYear !== null) { // 1 Januari
    items.push({ type: 'report-yearly', content: generateGroupYearly(now, priceToday, priceLastYear) });
  }

  for (const item of items) {
    console.log(item.content + '\n');
    addEntry(item.type, item.content, now);
    await sendWhatsApp(item.content);
  }
}

main().catch((e) => {
  console.error('ERROR groupMonitor.js:', e.message);
  process.exit(1);
});
