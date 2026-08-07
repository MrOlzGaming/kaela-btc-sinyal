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

const MAX_ITEMS = 20;

// item: { sentiment: 'positif'|'negatif'|'netral', headline: string, source: string, url: string }
function formatNewsUpdate(now, items) {
  const capped = items.slice(0, MAX_ITEMS);
  const lines = [];
  lines.push(`📰 KAELA NEWS — ${localDateKey(now)}`);
  lines.push('');
  for (const item of capped) {
    const tag = item.sentiment === 'positif' ? '🟢' : item.sentiment === 'negatif' ? '🔴' : '⚪';
    lines.push(`${tag} ${item.headline}`);
    lines.push(`   ${item.source} — ${item.url}`);
  }
  lines.push('');
  lines.push(`🔗 ${WEB_URL}`);
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
