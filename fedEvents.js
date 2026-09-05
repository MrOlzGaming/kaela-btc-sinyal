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

module.exports = { nfpTimestampUTC, generateNfpEvents, fomcTimestampUTC, generateFomcEvents, warnIfFomcListStale, isEDT };
