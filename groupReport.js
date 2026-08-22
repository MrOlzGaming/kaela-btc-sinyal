// Laporan buat GRUP WA (teman-teman) — beda dari dailyReport.js (itu buat Olan pribadi).
// Aturan: ramah, TIDAK PERNAH sebut modal/nominal individu siapapun (privasi total, sesuai desain kalkulator anonim).
// Selama window Musim Tanam/Panen: nambahin pesan pengingat komitmen, bahasa santai, gonta-ganti biar gak monoton.

const { WEB_URL, toLocal, localDateKey } = require('./config');
const { CATEGORY_COLOR } = require('./categoryColors');
const { dvolInsight, yieldCurveInsight } = require('./advancedMacro');

const NEXT_HALVING_EST = new Date('2028-04-13T13:11:00Z'); // sumber: CoinGecko real-time countdown — cek ulang berkala
const WINDOW_START = new Date('2026-10-19T00:00:00Z');
const WINDOW_END = new Date('2026-11-17T00:00:00Z');

const REMINDER_TANAM = [
  '🌱 Masih di Musim Tanam. Udah cek rencana yang kamu susun sendiri belum?',
  '🌱 Ingat komitmen awal kamu — bukan keputusan baru, tinggal jalanin yang udah dipikirin matang.',
  '🌱 Musim Tanam jalan terus. Ragu itu wajar, tapi jangan biarin ragu ngambil alih rencana kamu.',
  '🌱 Default-nya: beli spot biasa, tahan sampai Musim Panen. Simpel, gak ada risiko likuidasi.',
];
const ADVANCED_NOTE =
  '⚠️ Opsional buat yang paham risikonya: bisa pakai leverage (OLZ Exposure System, lihat calculator.js) — ' +
  'tapi itu artinya ada risiko likuidasi nyata, beda dari sekadar spot. Kelola sendiri, sesuai keputusan sendiri.';
const REMINDER_PANEN = [
  '🌾 Masih di Musim Panen. Rencana realisasi kamu — masih sesuai jalur?',
  '🌾 Ingat kesepakatan sama diri sendiri dari awal. "Nanggung dikit lagi" itu suara emosi, bukan rencana.',
  '🌾 Musim Panen jalan terus. Kalau udah sesuai target kamu sendiri, saatnya eksekusi.',
];
const PANEN_DISCLAIMER =
  'Kaela udah kasih peringatan sesuai data & pola historis — sampai situ tugas Kaela. ' +
  'Kalau kamu tetap pilih hold lebih lama dari yang disaranin, itu keputusanmu sepenuhnya — Kaela cuma bisa doain semoga beruntung. ' +
  'Begitu juga sebaliknya: kalau udah dijual terus harganya lanjut naik, itu bukan salah Kaela. ' +
  'Kaela bukan peramal — Kaela sistem logika yang jalan berdasar pola masa lalu, bukan jaminan masa depan.';

function pick(arr, seed) {
  return arr[seed % arr.length];
}

function pctChange(today, prev) {
  return ((today - prev) / prev) * 100;
}

function fmtPct(p) {
  return `${p >= 0 ? '📈 +' : '📉 '}${p.toFixed(1)}%`;
}

function daysToHalving(now) {
  return Math.round((NEXT_HALVING_EST.getTime() - now.getTime()) / 86400000);
}

function halvingLine(now) {
  return `⏳ Halving berikutnya: ${daysToHalving(now)} hari lagi (~${NEXT_HALVING_EST.toISOString().slice(0, 10)})`;
}

function getWindowPhase(now) {
  if (now < WINDOW_START) return null;
  if (now <= WINDOW_END) return 'TANAM'; // catatan: fase PANEN dipakai kalau lagi ada posisi OPEN nunggu jual, bukan cuma tanggal
  return null;
}

// On-chain siklus (MVRV + Puell Multiple) -- opsional/best-effort, lihat onchainMetrics.js
// (sumber gratis limit 10req/jam, update 1x/hari). Null-safe: kalau gagal ambil, baris dilewatin
// aja (bukan bikin laporan gagal total).
function onchainCycleLines(onchain) {
  if (!onchain) return [];
  const { mvrv, puellMultiple } = onchain;
  const lines = [];
  if (mvrv) lines.push(`⛓️ MVRV: ${mvrv.value.toFixed(2)} (${mvrv.classification})`);
  if (puellMultiple) lines.push(`⛓️ Puell Multiple: ${puellMultiple.value.toFixed(2)} (${puellMultiple.classification})`);
  return lines;
}

function generateGroupDaily(now, priceToday, priceYesterday, opts = {}) {
  const lines = [];
  const change = pctChange(priceToday, priceYesterday);
  lines.push(`${CATEGORY_COLOR.laporan.emoji} 📊 Update BTC — ${localDateKey(now)}`);
  lines.push(`Harga sekarang: $${priceToday.toLocaleString('en-US')} (${fmtPct(change)} dari kemarin)`);
  lines.push(halvingLine(now));
  lines.push(...onchainCycleLines(opts.onchain));

  const phase = opts.phase || getWindowPhase(now); // 'TANAM' | 'PANEN' | null
  if (phase === 'TANAM') {
    lines.push('');
    lines.push(pick(REMINDER_TANAM, toLocal(now).getUTCDate()));
    lines.push('');
    lines.push(ADVANCED_NOTE);
  } else if (phase === 'PANEN') {
    lines.push('');
    lines.push(pick(REMINDER_PANEN, toLocal(now).getUTCDate()));
    lines.push('');
    lines.push(PANEN_DISCLAIMER);
  }
  lines.push('');
  lines.push(`🔗 ${WEB_URL}`);
  return lines.join('\n');
}

// Regime korelasi BTC-vs-Nasdaq (22 Agu 2026, lihat regimeTracker.js) -- opsional/best-effort.
function regimeLines(regime) {
  if (!regime) return [];
  return [`📊 Regime (90 hari): korelasi ke Nasdaq ${regime.corr90.toFixed(2)} (${regime.label90}) -- ${regime.label90.includes('positif') ? 'BTC lagi condong gerak kayak aset risiko/saham teknologi' : regime.label90.includes('negatif') ? 'BTC lagi gerak BERLAWANAN Nasdaq' : 'BTC lagi decoupled/independen dari saham'}`];
}

// DVOL + Yield Curve (22 Agu 2026, lihat advancedMacro.js) -- opsional/best-effort, KONTEKS
// doang (bukan vote Conviction Score -- DVOL ngukur BESARAN gerakan, bukan ARAH; yield curve
// efeknya ke BTC lebih nuanced/lag, gak dipaksa jadi vote langsung).
function advancedMacroLines(adv) {
  if (!adv) return [];
  const lines = [];
  if (adv.dvol) lines.push(`🌊 DVOL (volatilitas implisit BTC): ${adv.dvol.value.toFixed(1)} -- ${dvolInsight(adv.dvol)}`);
  if (adv.yieldCurve) lines.push(`📉 Yield Curve 10Y-2Y: ${adv.yieldCurve.value.toFixed(2)} -- ${yieldCurveInsight(adv.yieldCurve)}`);
  return lines;
}

function generateGroupWeekly(now, priceToday, priceLastWeek, opts = {}) {
  const change = pctChange(priceToday, priceLastWeek);
  return [
    `${CATEGORY_COLOR.laporan.emoji} 📆 Laporan Mingguan BTC — minggu ${localDateKey(now)}`,
    `Harga: $${priceToday.toLocaleString('en-US')} (${fmtPct(change)} dari minggu lalu)`,
    halvingLine(now),
    ...regimeLines(opts.regime),
    ...advancedMacroLines(opts.advancedMacro),
    '',
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

function generateGroupMonthly(now, priceToday, priceLastMonth) {
  const change = pctChange(priceToday, priceLastMonth);
  return [
    `${CATEGORY_COLOR.laporan.emoji} 🗓️ Laporan Bulanan BTC — ${localDateKey(now).slice(0, 7)}`,
    `Harga: $${priceToday.toLocaleString('en-US')} (${fmtPct(change)} dari bulan lalu)`,
    halvingLine(now),
    '',
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

function generateGroupYearly(now, priceToday, priceLastYear) {
  const change = pctChange(priceToday, priceLastYear);
  return [
    `${CATEGORY_COLOR.laporan.emoji} 📅 Laporan Tahunan BTC — ${toLocal(now).getUTCFullYear()}`,
    `Harga: $${priceToday.toLocaleString('en-US')} (${fmtPct(change)} dari tahun lalu)`,
    halvingLine(now),
    '',
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

module.exports = {
  generateGroupDaily, generateGroupWeekly, generateGroupMonthly, generateGroupYearly, getWindowPhase,
  NEXT_HALVING_EST, WINDOW_START, WINDOW_END, daysToHalving,
};

if (require.main === module) {
  const now = new Date('2026-10-25');
  console.log(generateGroupDaily(now, 24500, 24100));
  console.log();
  console.log(generateGroupWeekly(now, 24500, 23000));
  console.log();
  console.log(generateGroupMonthly(now, 24500, 30000));
  console.log();
  console.log(generateGroupYearly(now, 24500, 64000));
}
