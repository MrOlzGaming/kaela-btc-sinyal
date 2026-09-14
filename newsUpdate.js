// Update berita ekonomi/kripto — MURNI INFORMASI.
// ⚠️ PENTING: modul ini TIDAK PERNAH dipanggil oleh signalEngine, backtest, atau logic tanam/panen manapun.
// Kaela tetap 100% deterministik dari kalender siklus halving — berita di sini cuma buat pengetahuan
// anggota grup, gak pernah jadi alasan majuin/mundurin/batalin keputusan beli-jual.
//
// Cakupan: ekonomi GLOBAL dan INDONESIA — apapun yang mempengaruhi ekonomi (perang, korupsi,
// kebijakan, atau apapun boleh masuk, bukan cuma kripto).
// Jumlah item: 1-20 per hari (fleksibel sesuai yang relevan hari itu, gak dipaksa penuh).
// Jadwal kirim: 09:00 WIB tiap hari (beda dari Kaela Report yang 07:00 WIB, biar gak numpuk).
//
// Pencarian berita: newsFetch.js (RSS Google News gratis, no API key, sentimen keyword-based --
// bukan LLM, deterministik sesuai filosofi Kaela). Runner harian: newsMonitor.js.

const { WEB_URL, localDateKey } = require('./config');
const { roleOpener } = require('./teamRoles');

const MAX_ITEMS = 20;

const SLOT_LABEL = { pagi: 'PAGI', siang: 'SIANG', sore: 'SORE' };

// item: { sentiment: 'positif'|'negatif'|'netral', headline: string, source: string, url: string }
// slot (22 Agu 2026, upgrade 3x sehari): 'pagi'|'siang'|'sore'|null (null = 1 edisi/hari, format lama)
function formatNewsUpdate(now, items, slot = null) {
  const capped = items.slice(0, MAX_ITEMS);
  const lines = [];
  const slotTag = slot && SLOT_LABEL[slot] ? ` (${SLOT_LABEL[slot]})` : '';
  lines.push(`${roleOpener('REED', `ada update berita ekonomi/kripto${slotTag} ${localDateKey(now)}`)}`);
  lines.push('');
  for (const item of capped) {
    const tag = item.sentiment === 'positif' ? '🟢' : item.sentiment === 'negatif' ? '🔴' : '⚪';
    lines.push(`${tag} ${item.headline}`);
    lines.push(`   ${item.source} — ${item.url}`);
  }
  lines.push('');
  lines.push(`🔗 ${WEB_URL}`);
  // Badge role (15 Sep 2026, dipindah ke OPENER di atas -- lihat teamRoles.js). Contoh PERSIS
  // dari Olan yang mulai konvensi ini (13 Sep 2026): "kaela news.. kaela sudah ga bikin sendiri..
  // tapi by Reed misalnya".
  lines.push('');
  lines.push('— Kaela');
  return lines.join('\n');
}

module.exports = { formatNewsUpdate };

if (require.main === module) {
  const example = [
    { sentiment: 'netral', headline: 'Bitcoin gagal bertahan di atas $64.000, resistance masih kuat', source: 'CaptainAltcoin', url: 'captainaltcoin.com/bitcoin-price-prediction-for-today-august-6-2026' },
    { sentiment: 'negatif', headline: 'ETF Bitcoin AS catat outflow $265,4 juta, dipimpin redemption IBIT BlackRock', source: 'Zerocap', url: 'zerocap.com/insights/weekly-crypto-market-wrap' },
    { sentiment: 'positif', headline: 'Juli tetap net inflow ~$172 juta — bulan positif pertama sejak April', source: 'Nexo', url: 'nexo.com/blog/markets-today-august-3' },
    { sentiment: 'netral', headline: 'The Fed tahan suku bunga di 3,50%-3,75%, inflasi masih bandel', source: 'CoinDesk', url: 'coindesk.com/markets/2026/08/03/crypto-week-ahead' },
  ];
  console.log(formatNewsUpdate(new Date(), example));
}
