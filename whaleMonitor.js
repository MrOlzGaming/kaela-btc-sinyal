// Jalankan tiap 15 menit: node whaleMonitor.js
// Pantau blok Bitcoin baru, cari transaksi >=1000 BTC (WHALE_THRESHOLD_BTC), kirim ke WEB (arsip,
// grup "Aktivitas Whale") DAN grup WA "BTC Sniper Club" lewat Fonnte.
// JUJUR: fakta on-chain doang, gak nebak siapa/kenapa (lihat whaleLog.js).

const fs = require('fs');
const path = require('path');
const { fetchLatestBlockHeight, fetchBlockHashAtHeight, fetchBlock, findLargeTransactions } = require('./whaleFetch');
const { formatWhaleAlert } = require('./whaleLog');
const { sendWhatsApp } = require('./fonnte');
const { addEntry } = require('./archive');
const { fetchWithRetry } = require('./httpRetry');

const STATE_PATH = path.join(__dirname, 'whale-state.json');
const WHALE_THRESHOLD_BTC = 1000; // naik dari 500 -> 1000 (permintaan Olan 8 Agu 2026, biar makin selektif)
const MAX_BLOCKS_PER_RUN = 6; // cap ~1 jam data kalau run sempat kelewat/mati, hindari banjir alert lama

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { lastProcessedHeight: null };
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function fetchBtcPriceUsd() {
  const res = await fetchWithRetry('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
  const data = await res.json();
  return parseFloat(data.price);
}

async function fetchUsdToIdr() {
  const res = await fetchWithRetry('https://open.er-api.com/v6/latest/USD');
  const data = await res.json();
  return data.rates.IDR;
}

async function main() {
  const now = new Date();
  const state = loadState();
  const { height: latestHeight } = await fetchLatestBlockHeight();

  let startHeight;
  if (state.lastProcessedHeight === null) {
    // Pertama kali jalan -- gak usah backfill seluruh history, mulai dari blok TERBARU aja
    startHeight = latestHeight;
  } else {
    startHeight = state.lastProcessedHeight + 1;
  }

  if (startHeight > latestHeight) {
    console.log('[WhaleMonitor]', now.toISOString(), '— belum ada blok baru, skip.');
    return;
  }

  const endHeight = Math.min(latestHeight, startHeight + MAX_BLOCKS_PER_RUN - 1);
  if (endHeight < latestHeight) {
    console.log(`[WhaleMonitor] Ketinggalan banyak blok, cuma proses ${startHeight}-${endHeight} (batas ${MAX_BLOCKS_PER_RUN} blok/run).`);
  }

  const [btcPrice, usdToIdr] = await Promise.all([fetchBtcPriceUsd(), fetchUsdToIdr()]);
  let totalFound = 0;

  for (let height = startHeight; height <= endHeight; height++) {
    const hash = await fetchBlockHashAtHeight(height);
    const block = await fetchBlock(hash);
    const largeTx = findLargeTransactions(block, WHALE_THRESHOLD_BTC);

    for (const tx of largeTx) {
      const msg = formatWhaleAlert(tx, btcPrice, usdToIdr);
      console.log(msg + '\n');
      addEntry('whale', msg, now);
      await sendWhatsApp(msg);
      totalFound++;
    }

    state.lastProcessedHeight = height;
    saveState(state); // simpan per-blok, biar kalau run gagal di tengah gak ngulang dari awal
  }

  console.log(`[WhaleMonitor] ${now.toISOString()} — blok ${startHeight}-${endHeight} diproses, ${totalFound} transaksi >=${WHALE_THRESHOLD_BTC} BTC ditemukan.`);
}

main().catch((e) => {
  console.error('ERROR whaleMonitor.js:', e.message);
  process.exit(1);
});
