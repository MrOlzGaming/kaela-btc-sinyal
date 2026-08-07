// Format pesan Jadwal Ekonomi -- MURNI INFORMASI (sama kayak Kaela News), gak pengaruhi sinyal.

const { WEB_URL, localDateKey } = require('./config');
const { CATEGORY_COLOR } = require('./categoryColors');

function formatEconCalendar(now, events) {
  const lines = [];
  lines.push(`${CATEGORY_COLOR.econ.emoji} 📅 JADWAL EKONOMI HARI INI — ${localDateKey(now)}`);
  lines.push('(event USD dampak tinggi aja -- paling relevan buat BTC lewat sentimen risiko)');
  lines.push('');
  for (const e of events) {
    lines.push(`🕐 ${e.time} WITA — ${e.title}`);
    lines.push(`   Forecast: ${e.forecast} | Sebelumnya: ${e.previous}`);
  }
  lines.push('');
  lines.push('⚠️ Murni informasi -- gak pengaruhi sinyal Nyopet Market atau keputusan Musim Tanam/Panen.');
  lines.push('');
  lines.push(`🔗 ${WEB_URL}`);
  return lines.join('\n');
}

module.exports = { formatEconCalendar };

if (require.main === module) {
  const example = [
    { title: 'Non-Farm Employment Change', time: '20:30', forecast: '85K', previous: '57K' },
    { title: 'Unemployment Rate', time: '20:30', forecast: '4.2%', previous: '4.2%' },
  ];
  console.log(formatEconCalendar(new Date(), example));
}
