// Laporan harian Kaela — jalan tiap hari jam 07:00 WITA, TERLEPAS ada sinyal entry atau enggak.
// Strategi sekarang cuma trading ~2x per 4 tahun, jadi laporan hariannya berupa status/countdown,
// bukan sinyal BUY/SELL/WAIT harian kayak desain lama.

const LAST_HALVING = new Date('2024-04-19T00:00:00Z');
const NEXT_HALVING_EST = new Date('2028-04-13T13:11:00Z'); // sumber: CoinGecko real-time countdown (bukan ekstrapolasi manual lagi)
const WINDOW_START = new Date('2026-10-19T00:00:00Z');
const WINDOW_MID = new Date('2026-11-07T00:00:00Z');
const WINDOW_END = new Date('2026-11-17T00:00:00Z');
const PROJECTED_BOTTOM_LOW = 20000;
const PROJECTED_BOTTOM_HIGH = 28600;
const PROJECTED_BOTTOM_MID = 24300;
const WATCH_MONTH = 'OKTOBER–NOVEMBER 2026';
const { WEB_URL, localDateKey } = require('./config');

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// position: null kalau TUNAI, atau { entryDate, entryPrice, stopPrice, targetSellDate } kalau OPEN
function generateDailyReport(now, currentPrice, position) {
  const daysSinceHalving = daysBetween(LAST_HALVING, now);
  const daysToNextHalving = daysBetween(now, NEXT_HALVING_EST);

  let lines = [];
  lines.push(`📊 LAPORAN HARIAN KAELA — ${localDateKey(now)}`);
  lines.push('');
  lines.push(`⏳ Hari sejak halving terakhir (19 Apr 2024): ${daysSinceHalving} hari`);
  lines.push(`🎯 Estimasi halving berikutnya: ${NEXT_HALVING_EST.toISOString().slice(0, 10)} (~${daysToNextHalving} hari lagi)`);
  lines.push(`📈 Harga BTC sekarang: $${currentPrice.toLocaleString('en-US')}`);
  lines.push('');

  if (position) {
    const pnlPct = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    const distToStopPct = ((currentPrice - position.stopPrice) / currentPrice) * 100;
    lines.push('Status: 🟢 POSISI TERBUKA (LONG)');
    lines.push(`  Masuk: ${position.entryDate} @ $${position.entryPrice.toLocaleString('en-US')}`);
    lines.push(`  Untung/Rugi saat ini: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%`);
    lines.push(`  Jarak ke Batas Rugi: ${distToStopPct.toFixed(1)}%`);
    lines.push(`  Target jual (estimasi walk-forward): ${position.targetSellDate}`);
  } else {
    const daysToMusimTanam = daysBetween(now, WINDOW_START);
    const fmt = (d) => d.toISOString().slice(0, 10);
    const musimLabel = `${fmt(WINDOW_START)} – ${fmt(WINDOW_END)} (tengah: ${fmt(WINDOW_MID)})`;
    lines.push('Status: ⚪ TUNAI (menunggu Musim Tanam)');
    lines.push('');
    if (now < WINDOW_START) {
      lines.push(`📅 Musim Tanam berikutnya: ${musimLabel}`);
      lines.push(`⏱️ ${daysToMusimTanam} hari lagi menuju Musim Tanam`);
    } else if (now <= WINDOW_END) {
      lines.push(`📅 SEDANG DALAM MUSIM TANAM (${musimLabel})`);
      lines.push(`⏱️ Sisa ${daysBetween(now, WINDOW_END)} hari lagi sebelum Musim Tanam berakhir`);
    } else {
      lines.push(`⚠️ Musim Tanam (${musimLabel}) sudah lewat, belum ada catatan masuk posisi — perlu ditinjau ulang`);
    }
    lines.push(`💰 Proyeksi harga terendah: $${PROJECTED_BOTTOM_LOW.toLocaleString('en-US')} - $${PROJECTED_BOTTOM_HIGH.toLocaleString('en-US')} (tengah ~$${PROJECTED_BOTTOM_MID.toLocaleString('en-US')})`);
    lines.push('');
    lines.push(`🔔 BULAN YANG PERLU DIPERHATIKAN UNTUK AKUMULASI: ${WATCH_MONTH}`);
    lines.push(`   Siapkan modal sesuai Exposure System (lihat calculator.js) begitu Musim Tanam tiba.`);
  }

  lines.push('');
  lines.push(`🔗 ${WEB_URL}`);

  return lines.join('\n');
}

module.exports = { generateDailyReport };

if (require.main === module) {
  // contoh: laporan hari ini (TUNAI, harga BTC terkini)
  console.log(generateDailyReport(new Date(), 64619, null));
  console.log('\n' + '='.repeat(50) + '\n');
  // contoh: laporan kalau lagi OPEN posisi
  console.log(generateDailyReport(new Date('2026-11-05'), 23500, {
    entryDate: '2026-10-22', entryPrice: 24300, stopPrice: 24300 * (1 - 1 / 3), targetSellDate: '~2028',
  }));
}
