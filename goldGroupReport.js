// Laporan harga harian/mingguan/bulanan/tahunan buat XAU/Emas (22 Agu 2026, permintaan Olan --
// "biar gak terkesan bisu soal Emas") -- versi SEDERHANA dari groupReport.js (BTC), TANPA konten
// siklus halving/Tanam/Panen (gak relevan buat Emas, itu cuma buat BTC). Cuma laporan harga polos.

const { WEB_URL, localDateKey } = require('./config');
const { CATEGORY_COLOR } = require('./categoryColors');

function pctChange(today, prev) {
  return ((today - prev) / prev) * 100;
}
function fmtPct(p) {
  return `${p >= 0 ? '📈 +' : '📉 '}${p.toFixed(1)}%`;
}

function generateGoldDaily(now, priceToday, priceYesterday) {
  const change = pctChange(priceToday, priceYesterday);
  return [
    `${CATEGORY_COLOR.laporan.emoji} 🟡 Update XAU/Emas — ${localDateKey(now)}`,
    `Harga sekarang: $${priceToday.toLocaleString('en-US')} (${fmtPct(change)} dari kemarin)`,
    '',
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

function generateGoldWeekly(now, priceToday, priceLastWeek) {
  const change = pctChange(priceToday, priceLastWeek);
  return [
    `${CATEGORY_COLOR.laporan.emoji} 🟡 📆 Laporan Mingguan Emas — minggu ${localDateKey(now)}`,
    `Harga: $${priceToday.toLocaleString('en-US')} (${fmtPct(change)} dari minggu lalu)`,
    '',
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

function generateGoldMonthly(now, priceToday, priceLastMonth) {
  const change = pctChange(priceToday, priceLastMonth);
  return [
    `${CATEGORY_COLOR.laporan.emoji} 🟡 🗓️ Laporan Bulanan Emas — ${localDateKey(now).slice(0, 7)}`,
    `Harga: $${priceToday.toLocaleString('en-US')} (${fmtPct(change)} dari bulan lalu)`,
    '',
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

function generateGoldYearly(now, priceToday, priceLastYear) {
  const change = pctChange(priceToday, priceLastYear);
  return [
    `${CATEGORY_COLOR.laporan.emoji} 🟡 📅 Laporan Tahunan Emas — ${now.getUTCFullYear()}`,
    `Harga: $${priceToday.toLocaleString('en-US')} (${fmtPct(change)} dari tahun lalu)`,
    '',
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

module.exports = { generateGoldDaily, generateGoldWeekly, generateGoldMonthly, generateGoldYearly };
