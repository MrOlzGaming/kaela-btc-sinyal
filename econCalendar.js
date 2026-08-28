// Kalender ekonomi -- MURNI INFORMASI, gak pernah pengaruhi sinyal/logic tanam-panen manapun.
// Sumber: ForexFactory (via nfs.faireconomy.media, gratis, no API key, dipakai luas komunitas trading).
// Fokus: event USD High-impact aja (paling relevan buat BTC lewat sentimen risiko/DXY) --
// event negara lain/impact rendah cuma noise buat konteks kripto, sengaja disaring.

const { fetchWithRetry } = require('./httpRetry');
const { toLocal, localDateKey } = require('./config');
const { translateEventTitle } = require('./econTranslate');
const { getDirectionalView } = require('./econDirectionalView');

const CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

async function fetchWeekCalendar() {
  const res = await fetchWithRetry(CALENDAR_URL);
  return res.json();
}

// Event USD + High impact yang jatuh dalam `lookaheadHours` jam ke depan dari SEKARANG (bukan
// "tanggal kalender hari ini") -- fix 22 Agu 2026: model lama filter by "tanggal WITA == hari
// ini" DAN cuma dicek 1x/hari jam 07:03 WITA (lihat econCalendarMonitor.js) -- event yang jatuh
// dini hari WITA (misal FOMC ~02:00 WITA) UDAH LEWAT beberapa jam sebelum pengecekan sempat
// jalan, jadi "info"-nya nyampe SETELAH kejadian, bukan peringatan dini (kasus nyata dilaporkan
// Olan). Model baru: window relatif ke waktu sekarang + `key` stabil per event (buat dedup DI
// LUAR fungsi ini, lihat econCalendarMonitor.js) + label tanggal eksplisit (bisa "hari ini" atau
// "besok" tergantung event-nya jatuh kapan, gak diasumsikan selalu hari ini lagi).
// 28 Agu 2026, bug nyata ketemu: ForexFactory nandain pidato pejabat Fed (termasuk KADANG Fed
// Chair/Chairman sendiri) impact "Low"/"Medium", BUKAN "High" -- filter lama (`impact === 'High'`
// doang) NGELEWATIN event kayak "Fed Chairman X Speaks" total. Padahal pidato Chair (beda dari
// pidato member regional biasa yang emang low-signal) tetep market-moving buat BTC lewat DXY/
// sentimen risiko, terlepas dari label impact ForexFactory. Fix: 2 jalur -- impact High (SEMUA
// judul) TETAP masuk kayak biasa, DITAMBAH override title-match buat pidato Chair/pengumuman FOMC
// inti (BUKAN pidato member regional biasa -- itu masih legit di-skip, terlalu sering/low-signal).
const ALWAYS_RELEVANT_TITLE = /fed chair|fomc statement|fomc press conference|federal funds rate|fomc economic projections/i;

function getUpcomingHighImpactUsdEvents(allEvents, now = new Date(), lookaheadHours = 48) {
  const windowEndMs = now.getTime() + lookaheadHours * 60 * 60 * 1000;
  return allEvents
    .filter((e) => e.country === 'USD' && (e.impact === 'High' || ALWAYS_RELEVANT_TITLE.test(e.title)))
    .filter((e) => {
      const t = new Date(e.date).getTime();
      return t > now.getTime() && t <= windowEndMs; // cuma yang BELUM terjadi
    })
    .map((e) => {
      const d = new Date(e.date);
      return {
        key: `${e.date}__${e.title}`, // stabil per (waktu, judul asli) -- dipakai dedup state file
        title: translateEventTitle(e.title),
        dateKey: localDateKey(d), // buat label "hari ini"/"besok"/tanggal lain di formatter
        time: toLocal(d).toISOString().slice(11, 16), // HH:MM WITA
        forecast: e.forecast || '-',
        previous: e.previous || '-',
        directionalView: getDirectionalView(e.title),
      };
    })
    .sort((a, b) => (a.dateKey + a.time).localeCompare(b.dateKey + b.time));
}

module.exports = { fetchWeekCalendar, getUpcomingHighImpactUsdEvents };
