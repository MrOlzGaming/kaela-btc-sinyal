// Format pesan Whale Alert.
// Diposting ke WEB (arsip, grup sendiri) DAN grup WA "BTC Sniper Club".
//
// Tag arah (best-effort, lihat exchangeAddresses.js buat batasan jujurnya):
//   🔴 = salah satu ALAMAT TUJUAN cocok exchange dikenal (deposit -- potensi tekanan jual)
//   🟢 = salah satu ALAMAT ASAL cocok exchange dikenal (withdrawal -- potensi akumulasi/hold)
//   ⚪ = gak ketemu exchange yang dikenal di kedua sisi (mayoritas kasus -- BUKAN berarti pasti
//        wallet biasa, cuma "gak teridentifikasi" karena daftar exchange kita gak lengkap)

const { WEB_URL, toLocal } = require('./config');
const { CATEGORY_COLOR } = require('./categoryColors');

function fmtBtc(n) {
  return n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

function fmtUsd(n) {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtIdr(n) {
  return 'Rp' + n.toLocaleString('id-ID', { maximumFractionDigits: 0 });
}

function formatWhaleAlert(tx, btcPriceUsd, usdToIdr) {
  const usdValue = tx.totalBtc * btcPriceUsd;
  const idrValue = usdValue * usdToIdr;
  const time = toLocal(new Date(tx.blockTime * 1000)).toISOString().slice(0, 16).replace('T', ' ');

  let tag = '⚪';
  let directionLine = 'Arah: gak teridentifikasi (bukan berarti pasti wallet biasa -- daftar exchange kami gak lengkap).';
  if (tx.direction === 'TO_EXCHANGE') {
    tag = '🔴';
    directionLine = `Arah: masuk ke ${tx.exchange} (deposit -- potensi tekanan jual, BUKAN kepastian).`;
  } else if (tx.direction === 'FROM_EXCHANGE') {
    tag = '🟢';
    directionLine = `Arah: keluar dari ${tx.exchange} (withdrawal -- potensi akumulasi/hold, BUKAN kepastian).`;
  }

  return [
    `${CATEGORY_COLOR.whale.emoji} ${tag} PERGERAKAN BESAR TERDETEKSI`,
    `${fmtBtc(tx.totalBtc)} BTC (~${fmtUsd(usdValue)} / ~${fmtIdr(idrValue)}) berpindah dalam 1 transaksi di blockchain.`,
    directionLine,
    `TXID: ${tx.txid}`,
    `Cek: https://mempool.space/tx/${tx.txid}`,
    time,
    '',
    '⚠️ Fakta on-chain + best-effort label exchange (daftar terbatas, lihat metodologi web).',
    'Kaela TIDAK menjamin arah pasar dari ini. Murni informasi, bukan ajakan aksi apapun.',
    '',
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

// Rekap HARIAN (10 Agu 2026, ganti dari real-time per-transaksi -- permintaan Olan). Alasan:
// konfirmasi blockchain BUKAN instan -- transaksi jam 2 pagi bisa aja baru KE-MINED (masuk blok)
// jam siang kalau network lagi padat/kompetisi fee. Alert "real-time" tiap 10 menit jadi misleading
// -- kadang telat berjam-jam dari kejadian aslinya tanpa jelas ke pembaca. Rekap harian lebih jujur:
// gak janjiin real-time, cuma laporin TOTAL pergerakan yang KE-KONFIRMASI dalam ~24 jam terakhir.
function formatWhaleDailyDigest(txList, btcPriceUsd, usdToIdr, dateStr) {
  const count = txList.length;
  if (count === 0) {
    return [
      `${CATEGORY_COLOR.whale.emoji} 🐋 REKAP WHALE HARIAN — ${dateStr}`,
      'Gak ada transaksi besar (>=1000 BTC) yang KE-KONFIRMASI dalam ~24 jam terakhir -- volatilitas whale rendah.',
      '',
      '⚠️ Rekap on-chain 24 jam terakhir, BUKAN real-time -- konfirmasi blockchain bisa telat beberapa jam dari kejadian aslinya.',
      `🔗 ${WEB_URL}`,
    ].join('\n');
  }

  const totalBtc = txList.reduce((s, t) => s + t.totalBtc, 0);
  const biggest = txList.reduce((a, b) => (b.totalBtc > a.totalBtc ? b : a));
  const toExchange = txList.filter((t) => t.direction === 'TO_EXCHANGE').length;
  const fromExchange = txList.filter((t) => t.direction === 'FROM_EXCHANGE').length;
  const unknown = count - toExchange - fromExchange;
  const usdValue = totalBtc * btcPriceUsd;
  const idrValue = usdValue * usdToIdr;

  return [
    `${CATEGORY_COLOR.whale.emoji} 🐋 REKAP WHALE HARIAN — ${dateStr}`,
    `${count} transaksi besar (>=1000 BTC) ke-konfirmasi dalam ~24 jam terakhir.`,
    `Total: ${fmtBtc(totalBtc)} BTC berpindah (~${fmtUsd(usdValue)} / ~${fmtIdr(idrValue)})`,
    `Terbesar: ${fmtBtc(biggest.totalBtc)} BTC dalam 1 transaksi.`,
    `Arah (best-effort): ${toExchange} masuk exchange (potensi tekanan jual) · ${fromExchange} keluar exchange (potensi akumulasi) · ${unknown} gak teridentifikasi.`,
    '',
    '⚠️ Rekap on-chain 24 jam terakhir, BUKAN real-time -- konfirmasi blockchain bisa telat beberapa jam dari kejadian aslinya. Bukan ajakan aksi apapun.',
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

module.exports = { formatWhaleAlert, formatWhaleDailyDigest };

if (require.main === module) {
  console.log(formatWhaleAlert({ totalBtc: 366.33, txid: 'ab1dd23585ffbc8cb2ab080c5ed929a6c8c183b9db3bcddf348dd03b90cb7791', blockTime: Math.floor(Date.now() / 1000), direction: null, exchange: null }, 64300, 17936));
  console.log();
  console.log(formatWhaleAlert({ totalBtc: 500, txid: 'contoh-deposit', blockTime: Math.floor(Date.now() / 1000), direction: 'TO_EXCHANGE', exchange: 'Binance' }, 64300, 17936));
  console.log();
  console.log(formatWhaleAlert({ totalBtc: 500, txid: 'contoh-withdrawal', blockTime: Math.floor(Date.now() / 1000), direction: 'FROM_EXCHANGE', exchange: 'Binance' }, 64300, 17936));
}
