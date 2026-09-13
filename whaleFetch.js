// Deteksi transaksi Bitcoin BESAR langsung dari blockchain (bukan dari 1 exchange tertentu).
// Sumber: blockchain.info (gratis, no API key, 1x panggilan API per blok -- efisien).
// JUJUR: cuma fakta on-chain (jumlah BTC berpindah). TIDAK tau ini dari/ke exchange mana,
// TIDAK menebak "whale akumulasi/jual" -- itu di luar apa yang bisa dibuktikan gratis & akurat.

const { fetchWithRetry } = require('./httpRetry');
const { detectExchangeDirection } = require('./exchangeAddresses');
const { lookupMinerWallet } = require('./minerWalletTracker');

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
// 12 Sep 2026: detectExchangeDirection SEKARANG async (query API WalletExplorer, lihat
// exchangeAddresses.js) -- fungsi ini ikut jadi async, TAPI cuma dipanggil buat transaksi yang
// UDAH LOLOS filter threshold (biasanya 0-3 per blok dari ribuan tx), jadi dampak performa minim.
async function findLargeTransactions(block, thresholdBtc) {
  const results = [];
  for (const tx of block.tx) {
    const totalSatoshi = tx.out.reduce((sum, o) => sum + (o.value || 0), 0);
    const totalBtc = totalSatoshi / SATOSHI;
    if (totalBtc >= thresholdBtc) {
      const exchangeMatch = await detectExchangeDirection(tx);
      // Miner-outflow tahap 2 (13 Sep 2026, GRATIS -- numpang tx yang SAMA, minerWalletTracker.js
      // numpuk peta alamat pool dari coinbase blok2 yang di-scan). `minerPool` keisi kalau SALAH
      // SATU alamat asal (input) transaksi ini dikenali sbg wallet pool -- kombinasi minerPool +
      // direction==='TO_EXCHANGE' = sinyal "miner mindahin BTC ke exchange" (potensi jual).
      const inputAddrs = (tx.inputs || []).map((i) => i.prev_out && i.prev_out.addr).filter(Boolean);
      let minerPool = null;
      for (const addr of inputAddrs) { const p = lookupMinerWallet(addr); if (p) { minerPool = p; break; } }
      results.push({
        txid: tx.hash, totalBtc, blockHeight: block.height, blockTime: block.time,
        direction: exchangeMatch ? exchangeMatch.direction : null,
        exchange: exchangeMatch ? exchangeMatch.exchange : null,
        minerPool,
      });
    }
  }
  return results;
}

module.exports = { fetchLatestBlockHeight, fetchBlockHashAtHeight, fetchBlock, findLargeTransactions };
