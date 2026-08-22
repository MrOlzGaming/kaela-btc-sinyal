// Format pesan Jadwal Ekonomi -- MURNI INFORMASI (sama kayak Kaela News), gak pengaruhi sinyal.

const { WEB_URL, localDateKey } = require('./config');
const { CATEGORY_COLOR } = require('./categoryColors');

const ARAH_LABEL = { tertekan: '📉 BTC cenderung TERTEKAN', menguat: '📈 BTC cenderung MENGUAT', campuran: '↔️ Efek CAMPURAN, gak konsisten' };

// Baris perkiraan arah (11 Agu 2026, permintaan Olan: "berani memperkirakan arah, jelasin
// kalau begini maka begitu") -- heuristik makro standar (channel ekspektasi The Fed
// hawkish/dovish), BUKAN backtest data historis kayak sinyal Sniper/Musiman. `strength`
// ditampilkan biar jujur soal seberapa reliable hubungannya -- gak semua event sama kuat.
function directionalLines(e) {
  const v = e.directionalView;
  if (!v) return ['   (belum ada peta sebab-akibat buat event ini -- gak dipaksa nebak)'];
  if (v.aboveForecast === null) {
    return [`   📐 ${v.label} (keyakinan: ${v.strength}) -- ${v.mechanism}`];
  }
  return [
    `   📐 ${v.label} (keyakinan: ${v.strength}):`,
    `      • Kalau ACTUAL > forecast -> ${ARAH_LABEL[v.aboveForecast] || v.aboveForecast}`,
    `      • Kalau ACTUAL < forecast -> ${ARAH_LABEL[v.belowForecast] || v.belowForecast}`,
  ];
}

// Label hari relatif ke `now` -- "HARI INI"/"BESOK"/tanggal biasa (event bisa jatuh lebih dari
// 1 hari ke depan karena window sekarang 48 jam, bukan cuma hari kalender ini lagi).
function dayLabel(dateKey, now) {
  const todayKey = localDateKey(now);
  const tomorrowKey = localDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  if (dateKey === todayKey) return 'HARI INI';
  if (dateKey === tomorrowKey) return 'BESOK';
  return dateKey;
}

function formatEconCalendar(now, events) {
  const lines = [];
  lines.push(`${CATEGORY_COLOR.econ.emoji} 📅 JADWAL EKONOMI MENDATANG (peringatan dini)`);
  lines.push('(event USD dampak tinggi dalam 48 jam ke depan -- paling relevan buat BTC lewat sentimen risiko)');
  lines.push('');
  for (const e of events) {
    lines.push(`🕐 ${dayLabel(e.dateKey, now)}, ${e.time} WITA — ${e.title}`);
    lines.push(`   Forecast: ${e.forecast} | Sebelumnya: ${e.previous}`);
    lines.push(...directionalLines(e));
    lines.push('');
  }
  lines.push('⚠️ Perkiraan arah di atas itu LOGIKA MAKRO UMUM (sebab-akibat standar), BUKAN backtest data historis kayak sinyal Sniper/Musiman -- level keyakinannya beda, jangan disamakan. Murni informasi -- gak pengaruhi sinyal Sniper atau keputusan Musim Tanam/Panen.');
  lines.push('');
  lines.push(`🔗 ${WEB_URL}`);
  return lines.join('\n');
}

module.exports = { formatEconCalendar };

if (require.main === module) {
  const example = [
    { title: 'Non-Farm Employment Change', dateKey: localDateKey(new Date()), time: '20:30', forecast: '85K', previous: '57K' },
    { title: 'Unemployment Rate', dateKey: localDateKey(new Date()), time: '20:30', forecast: '4.2%', previous: '4.2%' },
  ];
  console.log(formatEconCalendar(new Date(), example));
}
