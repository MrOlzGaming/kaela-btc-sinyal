// Kalender ekonomi -- MURNI INFORMASI, gak pernah pengaruhi sinyal/logic tanam-panen manapun.
// Sumber: ForexFactory (via nfs.faireconomy.media, gratis, no API key, dipakai luas komunitas trading).
// Fokus: event USD High-impact aja (paling relevan buat BTC lewat sentimen risiko/DXY) --
// event negara lain/impact rendah cuma noise buat konteks kripto, sengaja disaring.

const { fetchWithRetry } = require('./httpRetry');
const { toLocal, localDateKey } = require('./config');
const { translateEventTitle } = require('./econTranslate');

const CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

async function fetchWeekCalendar() {
  const res = await fetchWithRetry(CALENDAR_URL);
  return res.json();
}

// Event USD + High impact aja, tanggal WITA-nya sama kayak `now` (hari ini).
function getTodayHighImpactUsdEvents(allEvents, now = new Date()) {
  const todayKey = localDateKey(now);
  return allEvents
    .filter((e) => e.country === 'USD' && e.impact === 'High')
    .filter((e) => localDateKey(new Date(e.date)) === todayKey)
    .map((e) => ({
      title: translateEventTitle(e.title),
      time: toLocal(new Date(e.date)).toISOString().slice(11, 16), // HH:MM WITA
      forecast: e.forecast || '-',
      previous: e.previous || '-',
    }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

module.exports = { fetchWeekCalendar, getTodayHighImpactUsdEvents };
