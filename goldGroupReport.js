// Laporan harga harian/mingguan/bulanan/tahunan buat XAU/Emas (22 Agu 2026, permintaan Olan --
// "biar gak terkesan bisu soal Emas") -- versi SEDERHANA dari groupReport.js (BTC), TANPA konten
// siklus halving/Tanam/Panen (gak relevan buat Emas, itu cuma buat BTC). Cuma laporan harga polos.

const { WEB_URL, localDateKey } = require('./config');
const { CATEGORY_COLOR } = require('./categoryColors');
const { yieldCurveInsight, formatMacroPackageLines } = require('./advancedMacro');

function pctChange(today, prev) {
  return ((today - prev) / prev) * 100;
}
function fmtPct(p) {
  return `${p >= 0 ? '📈 +' : '📉 '}${p.toFixed(1)}%`;
}

// 3 Sep 2026, permintaan Olan: "ada rupiahnya, termasuk rupiah per gram, mengingat Indonesia
// lebih ke satuan gram, tapi satuan Oz tetep biarkan -- jadi ada kombinasi". priceOz itu harga
// PAXGUSDT (1 token = 1 troy ounce emas asli), konversi ke gram pakai faktor standar (1 troy oz
// = 31.1034768 gram). idrRate null/gagal ambil -> tampil USD doang, JANGAN gagalin laporan cuma
// gara-gara kurs gak kebaca (pola sama kayak positionReconciler.js).
const GRAMS_PER_TROY_OZ = 31.1034768;
function fmtGoldPriceLine(priceOz, idrRate) {
  const priceGram = priceOz / GRAMS_PER_TROY_OZ;
  const ozUsd = `$${priceOz.toLocaleString('en-US', { maximumFractionDigits: 2 })}/oz`;
  const gramUsd = `$${priceGram.toLocaleString('en-US', { maximumFractionDigits: 2 })}/gram`;
  if (!idrRate) return `${ozUsd} atau ${gramUsd}`;
  const ozIdr = Math.round(priceOz * idrRate).toLocaleString('id-ID');
  const gramIdr = Math.round(priceGram * idrRate).toLocaleString('id-ID');
  return `${ozUsd} (≈Rp${ozIdr}) atau ${gramUsd} (≈Rp${gramIdr})`;
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

// Yield Curve (22 Agu 2026, lihat advancedMacro.js) -- KONTEKS makro bersama (dipakai juga di
// laporan BTC), tapi implikasi ke Emas beda: kurva terbalik → ekspektasi The Fed bakal potong
// suku bunga → real yield turun → historis JUSTRU tailwind buat Emas (bukan headwind kayak BTC).
function yieldCurveLines(yieldCurve) {
  if (!yieldCurve) return [];
  const base = `📉 Yield Curve 10Y-2Y: ${yieldCurve.value.toFixed(2)} -- ${yieldCurveInsight(yieldCurve)}`;
  const emasNote = yieldCurve.inverted
    ? ' -- buat Emas: ekspektasi Fed potong bunga historis jadi tailwind (beda dari BTC yang biasanya lihat ini sbg sinyal risk-off)'
    : '';
  return [base + emasNote];
}

// Regime korelasi Emas-vs-DXY (22 Agu 2026, lihat regimeTracker.js) -- opsional/best-effort.
function regimeLines(regime) {
  if (!regime) return [];
  return [`📊 Regime (90 hari): korelasi ke DXY ${regime.corr90.toFixed(2)} (${regime.label90}) -- ${regime.label90.includes('negatif') ? 'Emas lagi gerak "tekstbuk" (berlawanan dolar)' : 'Emas lagi didorong faktor LAIN (bukan cuma dolar -- misal pembelian bank sentral/safe-haven)'}`];
}

// 30 Agu 2026, permintaan Olan: "info dxy berpaket dengan suku bunga, yield, dsb" -- laporan
// harian sekarang pakai `formatMacroPackageLines` (DXY+Fed Rate+Yield Curve+Real Yield SEKALIGUS
// + 1 kalimat sintesis regime), GANTI `macroLines()` yang cuma DXY+Real Yield doang. `opts.macro`
// (macroData.js: dxy+realYield) dan `opts.advancedMacro` (advancedMacro.js: fedRate+yieldCurve)
// digabung di sini jadi 1 paket -- caller (groupMonitor.js) cukup oper 2 sumber data itu.
function generateGoldDaily(now, priceToday, priceYesterday, opts = {}) {
  const change = pctChange(priceToday, priceYesterday);
  const macroPackage = formatMacroPackageLines({
    dxy: opts.macro?.dxy || null,
    realYield: opts.macro?.realYield || null,
    fedRate: opts.advancedMacro?.fedRate || null,
    yieldCurve: opts.advancedMacro?.yieldCurve || null,
  });
  return [
    `${CATEGORY_COLOR.laporan.emoji} 🟡 Update XAU/Emas — ${localDateKey(now)}`,
    `Harga sekarang: ${fmtGoldPriceLine(priceToday, opts.idrRate)} (${fmtPct(change)} dari kemarin)`,
    ...macroPackage,
    '',
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

function generateGoldWeekly(now, priceToday, priceLastWeek, opts = {}) {
  const change = pctChange(priceToday, priceLastWeek);
  return [
    `${CATEGORY_COLOR.laporan.emoji} 🟡 📆 Laporan Mingguan Emas — minggu ${localDateKey(now)}`,
    `Harga: ${fmtGoldPriceLine(priceToday, opts.idrRate)} (${fmtPct(change)} dari minggu lalu)`,
    ...macroLines(opts.macro),
    ...cotLines(opts.cot),
    ...regimeLines(opts.regime),
    ...yieldCurveLines(opts.yieldCurve),
    '',
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

function generateGoldMonthly(now, priceToday, priceLastMonth, opts = {}) {
  const change = pctChange(priceToday, priceLastMonth);
  return [
    `${CATEGORY_COLOR.laporan.emoji} 🟡 🗓️ Laporan Bulanan Emas — ${localDateKey(now).slice(0, 7)}`,
    `Harga: ${fmtGoldPriceLine(priceToday, opts.idrRate)} (${fmtPct(change)} dari bulan lalu)`,
    '',
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

function generateGoldYearly(now, priceToday, priceLastYear, opts = {}) {
  const change = pctChange(priceToday, priceLastYear);
  return [
    `${CATEGORY_COLOR.laporan.emoji} 🟡 📅 Laporan Tahunan Emas — ${now.getUTCFullYear()}`,
    `Harga: ${fmtGoldPriceLine(priceToday, opts.idrRate)} (${fmtPct(change)} dari tahun lalu)`,
    '',
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

module.exports = { generateGoldDaily, generateGoldWeekly, generateGoldMonthly, generateGoldYearly };
