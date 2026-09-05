// econCalendarLiveMonitor.js -- detektor kalender ekonomi jendela SEMPIT (5 Sep 2026, permintaan
// Olan: "detektor tiap 5 menit.. kalo ga ada dalam waktu dekat 5 menit di depan/5 menit di
// belakang maka skip.. 5 menit lagi kasih info siap-siap high impact, 5 menit kemudian simpulkan
// intinya hawkish/dovish.. saat ada high impact itu juga wajib deteksi DXY 5 menit sebelum dan
// sesudahnya").
//
// BEDA dari econCalendarMonitor.js (peringatan dini 48 JAM ke depan, jalan di GitHub Actions tiap
// 6 jam via workflow econ-calendar.yml, TETAP APA ADANYA -- itu buat "biar bisa disiapin dari
// jauh hari") -- ini jendela MENIT di sekitar waktu event ASLINYA, jalan SERING (cron VPS tiap 5
// menit, BUKAN GitHub Actions -- jadwal GH Actions bisa telat/gak presisi buat cron sesempit ini,
// VPS jauh lebih bisa diandalkan buat timing ketat).
//
// 2 titik cek per event:
//   1) HEADS-UP (~0-5 menit SEBELUM event) -- kirim "siap-siap" + ambil snapshot DXY "sebelum".
//   2) HASIL (~5-15 menit SESUDAH event) -- ambil snapshot DXY "sesudah", bandingin ke snapshot
//      "sebelum" (dari langkah 1) buat baca REAKSI PASAR beneran, GABUNG sama perbandingan
//      actual-vs-forecast (econDirectionalView.js) buat simpulin HAWKISH/DOVISH/NETRAL.
//      Buat event KUALITATIF (FOMC Statement dst, gak ada angka) -- reaksi DXY JADI SATU-SATUNYA
//      sumber kesimpulan (lihat econCalendarLog.js concludeHawkishDovish).
//
// State dedup (econ-calendar-live-notified.json) MURNI LOKAL, gak perlu git sync (beda dari
// sniper-orders.json dkk yang dibaca ulang lewat GitHub raw buat web publik) -- script ini gak
// nyentuh file lain/git sama sekali, aman jalan tiap 5 menit tanpa flock.
//
// MURNI INFORMASI -- gak pernah pengaruhi sinyal/logic tanam-panen manapun, sama prinsip
// econCalendarMonitor.js.

const fs = require('fs');
const path = require('path');
const { fetchWeekCalendar, getAllHighImpactUsdEvents } = require('./econCalendar');
const { formatHeadsUp, formatResult } = require('./econCalendarLog');
const { fetchDxy } = require('./macroData');
const { sendWhatsApp } = require('./fonnte');
const { addEntry } = require('./archive');

const HEADSUP_BEFORE_MIN = 5; // kasih heads-up kalau event 0..5 menit LAGI
const RESULT_AFTER_MIN = [5, 15]; // simpulkan hasil kalau event 5..15 menit LALU (jeda dikit buat ForexFactory sempat isi `actual`)
const STATE_PATH = path.join(__dirname, 'econ-calendar-live-notified.json');
const PRUNE_AFTER_MS = 2 * 24 * 60 * 60 * 1000; // buang state event yang udah lewat >2 hari, file gak numpuk selamanya

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch (e) { return {}; }
}
function saveState(s) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

// Gagal ambil DXY (Yahoo Finance lagi down/lambat dsb) BUKAN alasan gagalin seluruh siklus --
// null-safe, econCalendarLog.js udah nangani null (skip baris DXY di pesan, gak fatal).
async function safeFetchDxyPrice() {
  try {
    const r = await fetchDxy();
    return r.latest.value;
  } catch (e) {
    console.log('[EconCalendarLive] Gagal ambil DXY (dilewatin, gak fatal):', e.message);
    return null;
  }
}

async function main() {
  const now = new Date();
  const state = loadState();

  for (const key of Object.keys(state)) {
    const eventTimeMs = new Date(key.split('__')[0]).getTime();
    if (now.getTime() - eventTimeMs > PRUNE_AFTER_MS) delete state[key];
  }

  const allEvents = await fetchWeekCalendar();
  const events = getAllHighImpactUsdEvents(allEvents);

  let didSomething = false;

  for (const e of events) {
    const st = state[e.key] || {};
    const minsUntil = (e.timeMs - now.getTime()) / 60000;
    const minsAgo = -minsUntil;

    // ── 1) HEADS-UP -- event 0..5 menit LAGI ──
    if (!st.headsup && minsUntil > 0 && minsUntil <= HEADSUP_BEFORE_MIN) {
      const dxyBefore = await safeFetchDxyPrice();
      const msg = formatHeadsUp(e);
      console.log(msg);
      addEntry('econ-calendar-headsup', msg, now);
      await sendWhatsApp(msg);
      state[e.key] = { ...st, headsup: true, dxyBefore };
      didSomething = true;
      continue; // 1 event cuma 1 aksi per siklus, cek berikutnya siklus 5 menit depan
    }

    // ── 2) HASIL -- event 5..15 menit LALU ──
    // Event kualitatif (FOMC dst, gak ada angka forecast/actual) TETAP dicek biar reaksi DXY-nya
    // kebaca -- syaratnya cuma "waktu udah lewat", BUKAN nunggu `actual` (yang emang gak akan
    // pernah keisi buat jenis event ini).
    const isQualitative = e.directionalView && e.directionalView.aboveForecast === null;
    const hasResultData = isQualitative || !!e.actual;
    if (!st.result && minsAgo >= RESULT_AFTER_MIN[0] && minsAgo <= RESULT_AFTER_MIN[1] && hasResultData) {
      const dxyAfter = await safeFetchDxyPrice();
      const dxyBefore = st.dxyBefore != null ? st.dxyBefore : null;
      const dxyChangePct = (dxyBefore != null && dxyAfter != null) ? ((dxyAfter - dxyBefore) / dxyBefore) * 100 : null;
      const msg = formatResult(e, dxyChangePct);
      console.log(msg);
      addEntry('econ-calendar-result', msg, now);
      await sendWhatsApp(msg);
      state[e.key] = { ...st, result: true };
      didSomething = true;
    }
  }

  if (!didSomething) console.log(`[EconCalendarLive] ${now.toISOString()} -- gak ada event dalam jendela heads-up/hasil sekarang, skip.`);
  saveState(state);
}

main().catch((e) => {
  console.error('ERROR econCalendarLiveMonitor.js:', e.message);
  process.exit(1);
});
