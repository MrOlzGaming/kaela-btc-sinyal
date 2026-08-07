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

module.exports = { formatWhaleAlert };

if (require.main === module) {
  console.log(formatWhaleAlert({ totalBtc: 366.33, txid: 'ab1dd23585ffbc8cb2ab080c5ed929a6c8c183b9db3bcddf348dd03b90cb7791', blockTime: Math.floor(Date.now() / 1000), direction: null, exchange: null }, 64300, 17936));
  console.log();
  console.log(formatWhaleAlert({ totalBtc: 500, txid: 'contoh-deposit', blockTime: Math.floor(Date.now() / 1000), direction: 'TO_EXCHANGE', exchange: 'Binance' }, 64300, 17936));
  console.log();
  console.log(formatWhaleAlert({ totalBtc: 500, txid: 'contoh-withdrawal', blockTime: Math.floor(Date.now() / 1000), direction: 'FROM_EXCHANGE', exchange: 'Binance' }, 64300, 17936));
}
