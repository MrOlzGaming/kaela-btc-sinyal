// Jalankan tiap hari jam 07:00 WITA (bareng Laporan Harian): node econCalendarMonitor.js
// Cari jadwal ekonomi USD dampak tinggi HARI INI (econCalendar.js, ForexFactory gratis)
// -> format (econCalendarLog.js) -> arsip WEB + kirim grup WA "BTC Sniper Club" lewat Fonnte.
// MURNI INFORMASI -- gak pernah pengaruhi sinyal/logic tanam-panen manapun.

const { fetchWeekCalendar, getTodayHighImpactUsdEvents } = require('./econCalendar');
const { formatEconCalendar } = require('./econCalendarLog');
const { sendWhatsApp } = require('./fonnte');
const { addOrReplaceDaily, hasEntryToday } = require('./archive');

async function main() {
  const now = new Date();

  if (hasEntryToday('econ-calendar', now)) {
    console.log('[EconCalendar]', now.toISOString(), '— udah kirim hari ini, skip (cegah dobel WA kalau ke-run ulang).');
    return;
  }

  const allEvents = await fetchWeekCalendar();
  const todayEvents = getTodayHighImpactUsdEvents(allEvents, now);

  if (todayEvents.length === 0) {
    console.log('[EconCalendar]', now.toISOString(), '— gak ada event USD dampak tinggi hari ini, skip kirim.');
    return;
  }

  const msg = formatEconCalendar(now, todayEvents);
  console.log(msg);
  addOrReplaceDaily('econ-calendar', msg, now); // anti-dobel kalau ke-run ulang di hari sama
  await sendWhatsApp(msg);
}

main().catch((e) => {
  console.error('ERROR econCalendarMonitor.js:', e.message);
  process.exit(1);
});
