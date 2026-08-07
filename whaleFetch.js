// Deteksi transaksi Bitcoin BESAR langsung dari blockchain (bukan dari 1 exchange tertentu).
// Sumber: blockchain.info (gratis, no API key, 1x panggilan API per blok -- efisien).
// JUJUR: cuma fakta on-chain (jumlah BTC berpindah). TIDAK tau ini dari/ke exchange mana,
// TIDAK menebak "whale akumulasi/jual" -- itu di luar apa yang bisa dibuktikan gratis & akurat.

const { fetchWithRetry } = require('./httpRetry');
const { detectExchangeDirection } = require('./exchangeAddresses');

const SATOSHI = 100000000;

async function fetchLatestBlockHeight() {
  const res = await fetchWithRetry('https://blockchain.info/latestblock');
  const data = await res.json();
  return { height: data.height, hash: data.hash };
}

async function fetchBlockHashAtHeight(height) {
  const res = await fetchWithRetry(`https://blockchain.info/block-height/${height}?format=json`);
  const data = await res.json();
  return data.blocks[0].hash;
}

async function fetchBlock(hash) {
  const res = await fetchWithRetry(`https://blockchain.info/rawblock/${hash}`);
  return res.json();
}

// totalBtc per transaksi = jumlah semua output (proxy standar buat "ukuran transaksi" --
// bisa termasuk kembalian ke pengirim sendiri, jadi bukan berarti semua itu "terkirim" ke pihak lain,
// tapi tetap fakta valid: sejumlah itu BTC "bergerak" dalam 1 transaksi di blockchain).
function findLargeTransactions(block, thresholdBtc) {
  const results = [];
  for (const tx of block.tx) {
    const totalSatoshi = tx.out.reduce((sum, o) => sum + (o.value || 0), 0);
    const totalBtc = totalSatoshi / SATOSHI;
    if (totalBtc >= thresholdBtc) {
      const exchangeMatch = detectExchangeDirection(tx);
      results.push({
        txid: tx.hash, totalBtc, blockHeight: block.height, blockTime: block.time,
        direction: exchangeMatch ? exchangeMatch.direction : null,
        exchange: exchangeMatch ? exchangeMatch.exchange : null,
      });
    }
  }
  return results;
}

module.exports = { fetchLatestBlockHeight, fetchBlockHashAtHeight, fetchBlock, findLargeTransactions };
