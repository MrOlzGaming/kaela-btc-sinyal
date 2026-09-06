// fedEvents.js -- (5 Sep 2026) Tanggal event FOMC + NFP deterministik, DIEKSTRAK dari
// backtest/econReactionBacktest.js + backtest/fedSignalGridBacktest.js (SATU sumber kebenaran,
// dipakai backtest MAUPUN live trader -- sinyal live WAJIB persis sama logic yang udah di-backtest,
// bukan ditulis ulang beda risiko bug/drift).
//
// NFP: Jumat pertama tiap bulan, 8:30 ET -- 100% deterministik, gak perlu update manual.
// FOMC: tanggal keputusan (hari KEDUA tiap meeting, 14:00 ET) di-HARDCODE dari federalreserve.gov,
// WAJIB DIPERBARUI TIAP TAHUN begitu jadwal tahun berikutnya diumumkan Fed (biasanya akhir tahun
// sebelumnya) -- generateFomcEvents() otomatis nyaring tanggal yang udah lewat doang, TAPI kalau
// daftar ini gak diupdate, live trader diem-diem BERHENTI dapet sinyal FOMC begitu daftar habis.

const DST_START_WEEK = 2; // DST AS: mulai Minggu ke-2 Maret
const DST_END_WEEK = 1; // berakhir Minggu ke-1 November -- konsisten sejak 2007

function nthSundayUTC(year, monthIndex, n) {
  const d = new Date(Date.UTC(year, monthIndex, 1));
  let count = 0;
  while (true) {
    if (d.getUTCDay() === 0) { count += 1; if (count === n) return d.getTime(); }
    d.setUTCDate(d.getUTCDate() + 1);
  }
}
function isEDT(dateUTCms) {
  const year = new Date(dateUTCms).getUTCFullYear();
  return dateUTCms >= nthSundayUTC(year, 2, DST_START_WEEK) && dateUTCms < nthSundayUTC(year, 10, DST_END_WEEK);
}

function firstFridayUTC(year, monthIndex) {
  const d = new Date(Date.UTC(year, monthIndex, 1));
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
function nfpTimestampUTC(year, monthIndex) {
  const friday = firstFridayUTC(year, monthIndex);
  const noonCheck = Date.UTC(year, monthIndex, friday.getUTCDate(), 12);
  const utcHour = isEDT(noonCheck) ? 12 : 13; // 8:30 EDT = 12:30 UTC, 8:30 EST = 13:30 UTC
  return Date.UTC(year, monthIndex, friday.getUTCDate(), utcHour, 30);
}
// `includeFuture` (BARU, live trader, sama pola kayak generateFomcEvents) -- default false =
// PERSIS perilaku lama (backtest, cuma event yg udah lewat/punya candle).
// ⚠️ BUG ketemu+fix 5 Sep 2026 (verifikasi refactor): versi awal filternya kebablasan ("+400 hari")
// nyelip ke SEMUA caller termasuk backtest, nambah 3 event depan yg gak ada candle-nya (89->96
// vs 93 yang seharusnya) -- fixed, sekarang bener2 opt-in lewat parameter.
function generateNfpEvents(startYear, endYear, includeFuture) {
  const events = [];
  for (let y = startYear; y <= endYear; y += 1) {
    for (let m = 0; m < 12; m += 1) {
      const ts = nfpTimestampUTC(y, m);
      if (!includeFuture && ts > Date.now()) continue;
      events.push({ label: `NFP ${y}-${String(m + 1).padStart(2, '0')}`, timeMs: ts });
    }
  }
  return events;
}

// Tanggal FOMC historis+dijadwalkan (hari KEDUA tiap meeting, 14:00 ET -- federalreserve.gov).
// PERBARUI TIAP TAHUN -- lihat catatan di kepala file.
const FOMC_DECISION_DATES = [
  [2019, 1, 30], [2019, 3, 20], [2019, 5, 1], [2019, 6, 19], [2019, 7, 31], [2019, 9, 18], [2019, 10, 30], [2019, 12, 11],
  [2020, 1, 29], [2020, 3, 18], [2020, 4, 29], [2020, 6, 10], [2020, 7, 29], [2020, 9, 16], [2020, 11, 5], [2020, 12, 16],
  [2021, 1, 27], [2021, 3, 17], [2021, 4, 28], [2021, 6, 16], [2021, 7, 28], [2021, 9, 22], [2021, 11, 3], [2021, 12, 15],
  [2022, 1, 26], [2022, 3, 16], [2022, 5, 4], [2022, 6, 15], [2022, 7, 27], [2022, 9, 21], [2022, 11, 2], [2022, 12, 14],
  [2023, 2, 1], [2023, 3, 22], [2023, 5, 3], [2023, 6, 14], [2023, 7, 26], [2023, 9, 20], [2023, 11, 1], [2023, 12, 13],
  [2024, 1, 31], [2024, 3, 20], [2024, 5, 1], [2024, 6, 12], [2024, 7, 31], [2024, 9, 18], [2024, 11, 7], [2024, 12, 18],
  [2025, 1, 29], [2025, 3, 19], [2025, 5, 7], [2025, 6, 18], [2025, 7, 30], [2025, 9, 17], [2025, 10, 29], [2025, 12, 10],
  [2026, 1, 28], [2026, 3, 18], [2026, 4, 29], [2026, 6, 17], [2026, 7, 29], [2026, 9, 16], [2026, 10, 28], [2026, 12, 9],
];
function fomcTimestampUTC(year, month, day) {
  const noonCheck = Date.UTC(year, month - 1, day, 12);
  const utcHour = isEDT(noonCheck) ? 18 : 19; // 14:00 EDT = 18:00 UTC, 14:00 EST = 19:00 UTC
  return Date.UTC(year, month - 1, day, utcHour, 0);
}
// `includeFuture` (BARU, live trader) -- backtest cuma butuh event yang UDAH lewat (punya candle
// buat dianalisa), live trader JUSTRU butuh tau tanggal MENDATANG juga (buat nunggu jadwal
// berikutnya) -- default false = perilaku LAMA (backtest), gak ada breaking change.
function generateFomcEvents(includeFuture) {
  const list = FOMC_DECISION_DATES.map(([y, m, d]) => ({ label: `FOMC ${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, timeMs: fomcTimestampUTC(y, m, d) }));
  return includeFuture ? list : list.filter((e) => e.timeMs <= Date.now());
}

// Event terakhir di FOMC_DECISION_DATES lebih dari 60 hari lagi dari sekarang -> daftar hampir
// habis, WAJIB diperbarui manual (lihat catatan kepala file) -- cetak PERINGATAN (bukan error,
// jangan gugurin proses) biar ketauan sebelum diem-diem berhenti dapet sinyal FOMC.
function warnIfFomcListStale() {
  const all = generateFomcEvents(true);
  const last = all[all.length - 1];
  if (!last) { console.log('[fedEvents] ⚠️ FOMC_DECISION_DATES KOSONG.'); return; }
  const daysLeft = (last.timeMs - Date.now()) / (24 * 3600 * 1000);
  if (daysLeft < 60) {
    console.log(`[fedEvents] ⚠️ FOMC_DECISION_DATES hampir habis (tanggal terakhir: ${last.label}, ${daysLeft.toFixed(0)} hari lagi) -- WAJIB update daftar tahun berikutnya dari federalreserve.gov.`);
  }
}

// ============ CPI + PPI (6 Sep 2026, permintaan Olan: "bisa di backtest juga 2 itu?") ============
// Beda dari FOMC (jadwal diumumkan resmi jauh2 hari) -- tanggal CPI/PPI DIKUMPULIN MANUAL dari
// arsip jadwal resmi BLS (bls.gov/schedule/<tahun>/home.htm, 2019-2026, WebFetch 6 Sep 2026) --
// SEMUA rilis jam 8:30 ET, gak ada rumus deterministik kayak NFP/FOMC (jadwalnya gak berpola
// tetap). 2025 PUNYA GANGGUAN NYATA (shutdown pemerintah AS) -- beberapa bulan SKIP/TELAT jauh
// dari jadwal normal (CPI Sep->Oct 24 bukan pertengahan Oct biasa, PPI Sep->Nov 25) -- DIBIARKAN
// APA ADANYA (bulan yang beneran skip TIDAK diisi tanggal karangan) biar backtest REALISTIS, bukan
// dipoles jadi kelihatan lebih rapi dari kenyataan.
const CPI_DATES = [
  [2019, 1, 11], [2019, 2, 13], [2019, 3, 12], [2019, 4, 10], [2019, 5, 10], [2019, 6, 12], [2019, 7, 11], [2019, 8, 13], [2019, 9, 12], [2019, 10, 10], [2019, 11, 13], [2019, 12, 11],
  [2020, 1, 14], [2020, 2, 13], [2020, 3, 11], [2020, 4, 10], [2020, 5, 12], [2020, 6, 10], [2020, 7, 14], [2020, 8, 12], [2020, 9, 11], [2020, 10, 13], [2020, 11, 12], [2020, 12, 10],
  [2021, 1, 13], [2021, 2, 10], [2021, 3, 10], [2021, 4, 13], [2021, 5, 12], [2021, 6, 10], [2021, 7, 13], [2021, 8, 11], [2021, 9, 14], [2021, 10, 13], [2021, 11, 10], [2021, 12, 10],
  [2022, 1, 12], [2022, 2, 10], [2022, 3, 10], [2022, 4, 12], [2022, 5, 11], [2022, 6, 10], [2022, 7, 13], [2022, 8, 10], [2022, 9, 13], [2022, 10, 13], [2022, 11, 10], [2022, 12, 13],
  [2023, 1, 12], [2023, 2, 14], [2023, 3, 14], [2023, 4, 12], [2023, 5, 10], [2023, 6, 13], [2023, 7, 12], [2023, 8, 10], [2023, 9, 13], [2023, 10, 12], [2023, 11, 14], [2023, 12, 12],
  [2024, 1, 11], [2024, 2, 13], [2024, 3, 12], [2024, 4, 10], [2024, 5, 15], [2024, 6, 12], [2024, 7, 11], [2024, 8, 14], [2024, 9, 11], [2024, 10, 10], [2024, 11, 13], [2024, 12, 11],
  [2025, 1, 15], [2025, 2, 12], [2025, 3, 12], [2025, 4, 10], [2025, 5, 13], [2025, 6, 11], [2025, 7, 15], [2025, 8, 12], [2025, 9, 11], [2025, 10, 24], [2025, 12, 18], // Nov 2025 SKIP (shutdown)
  [2026, 1, 13], [2026, 2, 13], [2026, 3, 11], [2026, 4, 10], [2026, 5, 12], [2026, 6, 10], [2026, 7, 14], [2026, 8, 12], [2026, 9, 11],
];
const PPI_DATES = [
  [2019, 1, 15], [2019, 2, 14], [2019, 3, 13], [2019, 4, 11], [2019, 5, 9], [2019, 6, 11], [2019, 7, 12], [2019, 8, 9], [2019, 9, 11], [2019, 10, 8], [2019, 11, 14], [2019, 12, 12],
  [2020, 1, 15], [2020, 2, 19], [2020, 3, 12], [2020, 4, 9], [2020, 5, 13], [2020, 6, 11], [2020, 7, 10], [2020, 8, 11], [2020, 9, 10], [2020, 10, 14], [2020, 11, 13], [2020, 12, 11],
  [2021, 1, 15], [2021, 2, 17], [2021, 3, 12], [2021, 4, 9], [2021, 5, 13], [2021, 6, 15], [2021, 7, 14], [2021, 8, 12], [2021, 9, 10], [2021, 10, 14], [2021, 11, 9], [2021, 12, 14],
  [2022, 1, 13], [2022, 2, 15], [2022, 3, 15], [2022, 4, 13], [2022, 5, 12], [2022, 6, 14], [2022, 7, 14], [2022, 8, 11], [2022, 9, 14], [2022, 10, 12], [2022, 11, 15], [2022, 12, 9],
  [2023, 1, 18], [2023, 2, 16], [2023, 3, 15], [2023, 4, 13], [2023, 5, 11], [2023, 6, 14], [2023, 7, 13], [2023, 8, 11], [2023, 9, 14], [2023, 10, 11], [2023, 11, 15], [2023, 12, 13],
  [2024, 1, 12], [2024, 2, 16], [2024, 3, 14], [2024, 4, 11], [2024, 5, 14], [2024, 6, 13], [2024, 7, 12], [2024, 8, 13], [2024, 9, 12], [2024, 10, 11], [2024, 11, 14], [2024, 12, 12],
  [2025, 1, 14], [2025, 2, 13], [2025, 3, 13], [2025, 4, 11], [2025, 5, 15], [2025, 6, 12], [2025, 7, 16], [2025, 8, 14], [2025, 9, 10], [2025, 11, 25], // Okt+Nov 2025 rilis SKIP (shutdown), balik ke jadwal normal awal 2026
  [2026, 1, 14], [2026, 1, 30], [2026, 2, 27], [2026, 3, 18], [2026, 4, 14], [2026, 5, 13], [2026, 6, 11], [2026, 7, 15], [2026, 8, 13], [2026, 9, 10],
];

function _usEconTimestampUTC(year, month, day) {
  const noonCheck = Date.UTC(year, month - 1, day, 12);
  const utcHour = isEDT(noonCheck) ? 12 : 13; // 8:30 EDT = 12:30 UTC, 8:30 EST = 13:30 UTC
  return Date.UTC(year, month - 1, day, utcHour, 30);
}
function generateCpiEvents(includeFuture) {
  const list = CPI_DATES.map(([y, m, d]) => ({ label: `CPI ${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, timeMs: _usEconTimestampUTC(y, m, d) }));
  return includeFuture ? list : list.filter((e) => e.timeMs <= Date.now());
}
function generatePpiEvents(includeFuture) {
  const list = PPI_DATES.map(([y, m, d]) => ({ label: `PPI ${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, timeMs: _usEconTimestampUTC(y, m, d) }));
  return includeFuture ? list : list.filter((e) => e.timeMs <= Date.now());
}

module.exports = {
  nfpTimestampUTC, generateNfpEvents, fomcTimestampUTC, generateFomcEvents, warnIfFomcListStale, isEDT,
  generateCpiEvents, generatePpiEvents,
};
