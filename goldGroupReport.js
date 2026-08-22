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

// Konteks makro DXY + real yield (22 Agu 2026, lihat macroData.js) -- opsional/best-effort,
// null-safe kalau FRED gagal diambil. Ini yang beneran gerakin Emas secara fundamental, bukan
// cuma chart pattern.
function macroLines(macro) {
  if (!macro) return [];
  const lines = [];
  if (macro.dxy) lines.push(`💵 DXY: ${macro.dxy.latest.value.toFixed(1)} (${macro.dxy.trend.arah}) -- Emas ${macro.dxy.trend.efekEmas}`);
  if (macro.realYield) lines.push(`📉 Real Yield 10Y: ${macro.realYield.latest.value.toFixed(2)}% (${macro.realYield.trend.arah}) -- Emas ${macro.realYield.trend.efekEmas}`);
  return lines;
}

// Posisi smart money COMEX (COT Report CFTC, mingguan -- lihat cotReport.js) -- opsional/best-effort.
function cotLines(cot) {
  if (!cot) return [];
  return [`🏦 Smart Money (COT, per ${cot.date}): ${cot.label}`];
}

// Regime korelasi Emas-vs-DXY (22 Agu 2026, lihat regimeTracker.js) -- opsional/best-effort.
function regimeLines(regime) {
  if (!regime) return [];
  return [`📊 Regime (90 hari): korelasi ke DXY ${regime.corr90.toFixed(2)} (${regime.label90}) -- ${regime.label90.includes('negatif') ? 'Emas lagi gerak "tekstbuk" (berlawanan dolar)' : 'Emas lagi didorong faktor LAIN (bukan cuma dolar -- misal pembelian bank sentral/safe-haven)'}`];
}

function generateGoldDaily(now, priceToday, priceYesterday, opts = {}) {
  const change = pctChange(priceToday, priceYesterday);
  return [
    `${CATEGORY_COLOR.laporan.emoji} 🟡 Update XAU/Emas — ${localDateKey(now)}`,
    `Harga sekarang: $${priceToday.toLocaleString('en-US')} (${fmtPct(change)} dari kemarin)`,
    ...macroLines(opts.macro),
    '',
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

function generateGoldWeekly(now, priceToday, priceLastWeek, opts = {}) {
  const change = pctChange(priceToday, priceLastWeek);
  return [
    `${CATEGORY_COLOR.laporan.emoji} 🟡 📆 Laporan Mingguan Emas — minggu ${localDateKey(now)}`,
    `Harga: $${priceToday.toLocaleString('en-US')} (${fmtPct(change)} dari minggu lalu)`,
    ...macroLines(opts.macro),
    ...cotLines(opts.cot),
    ...regimeLines(opts.regime),
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
