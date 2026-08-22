// Jalankan tiap 6 jam: node econCalendarMonitor.js
// Cari jadwal ekonomi USD dampak tinggi dalam 48 jam ke depan (econCalendar.js, ForexFactory
// gratis) -> format (econCalendarLog.js) -> arsip WEB + kirim grup WA "BTC Sniper Club" lewat Fonnte.
// MURNI INFORMASI -- gak pernah pengaruhi sinyal/logic tanam-panen manapun.
//
// FIX 22 Agu 2026 (bug nyata dilaporin Olan): model lama cek 1x/hari jam 07:03 WITA, filter
// "event yang jatuh tanggal kalender WITA hari ini" -- event dini hari WITA (misal FOMC ~02:00
// WITA) UDAH LEWAT ~5 jam sebelum pengecekan sempat jalan, jadi infonya nyampe SETELAH kejadian,
// bukan peringatan dini. Model baru: window 48 jam ke depan dari SEKARANG (bukan tanggal
// kalender), dicek tiap 6 jam, dedup PER EVENT (state file, bukan "1 pesan per hari") -- event
// baru masuk window langsung diinfoin begitu kedeteksi, biasanya dengan notice 1-2 hari, bukan
// nunggu jam tetap yang bisa kelewat.

const { fetchWeekCalendar, getUpcomingHighImpactUsdEvents } = require('./econCalendar');
const { formatEconCalendar } = require('./econCalendarLog');
const { sendWhatsApp } = require('./fonnte');
const { addEntry } = require('./archive');
const fs = require('fs');
const path = require('path');

const LOOKAHEAD_HOURS = 48;
const STATE_PATH = path.join(__dirname, 'econ-calendar-notified.json');
const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // buang key event yang udah lewat >7 hari, state file gak numpuk selamanya

function loadNotified() {
  if (!fs.existsSync(STATE_PATH)) return {};
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

function saveNotified(map) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(map, null, 2));
}

async function main() {
  const now = new Date();
  const notified = loadNotified();

  // Prune: buang key yang event-timestamp-nya (bagian sebelum "__" di key) udah lewat >7 hari
  for (const key of Object.keys(notified)) {
    const eventTimeMs = new Date(key.split('__')[0]).getTime();
    if (now.getTime() - eventTimeMs > PRUNE_AFTER_MS) delete notified[key];
  }

  const allEvents = await fetchWeekCalendar();
  const upcoming = getUpcomingHighImpactUsdEvents(allEvents, now, LOOKAHEAD_HOURS);
  const freshEvents = upcoming.filter((e) => !notified[e.key]);

  if (freshEvents.length === 0) {
    console.log(`[EconCalendar] ${now.toISOString()} -- gak ada event baru dalam ${LOOKAHEAD_HOURS} jam ke depan (di luar yang udah diinfoin), skip kirim.`);
    saveNotified(notified);
    return;
  }

  const msg = formatEconCalendar(now, freshEvents);
  console.log(msg);
  addEntry('econ-calendar', msg, now);
  await sendWhatsApp(msg);

  for (const e of freshEvents) notified[e.key] = now.toISOString();
  saveNotified(notified);
}

main().catch((e) => {
  console.error('ERROR econCalendarMonitor.js:', e.message);
  process.exit(1);
});
