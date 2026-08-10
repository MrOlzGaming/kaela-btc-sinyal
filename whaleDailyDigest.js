// Jalankan 1x sehari: rekap SEMUA transaksi >=1000 BTC dalam blok-blok yang ke-konfirmasi sejak
// run terakhir (~24 jam), kirim 1 pesan WA TOTAL -- BUKAN per-transaksi real-time lagi.
//
// Ganti dari whaleMonitor.js (real-time tiap 10 menit, dipensiunkan 10 Agu 2026, permintaan Olan):
// konfirmasi blockchain BUKAN instan -- transaksi jam 2 pagi bisa aja baru ke-mined jam siang
// kalau network lagi padat/kompetisi fee. "Real-time" tiap 10 menit jadi ilusi -- kadang telat
// jauh dari kejadian aslinya tanpa jelas ke pembaca. Rekap harian JUJUR soal ini: gak janjiin
// real-time, cuma laporin total yang KE-KONFIRMASI 24 jam terakhir -- lebih cocok sama cara kerja
// blockchain yang sebenarnya. whaleMonitor.js dibiarin ada (gak dihapus, buat riwayat), gak
// dipanggil workflow lagi.

const fs = require('fs');
const path = require('path');
const { fetchLatestBlockHeight, fetchBlockHashAtHeight, fetchBlock, findLargeTransactions } = require('./whaleFetch');
const { formatWhaleDailyDigest } = require('./whaleLog');
const { sendWhatsApp } = require('./fonnte');
const { addOrReplaceDaily, hasEntryToday } = require('./archive');
const { fetchWithRetry } = require('./httpRetry');
const { localDateKey } = require('./config');

const STATE_PATH = path.join(__dirname, 'whale-state.json');
const WHALE_THRESHOLD_BTC = 1000;
// ~144 blok/hari (rata-rata block time 10 menit) -- cap digedein dari versi real-time lama (6
// blok/run) karena sekarang cuma jalan 1x/hari, wajar butuh proses lebih banyak blok sekaligus.
// Buffer sampai 300 (~2 hari) jaga-jaga run sempat kelewat sehari.
const MAX_BLOCKS_PER_RUN = 300;

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { lastProcessedHeight: null };
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function fetchBtcPriceUsd() {
  const res = await fetchWithRetry('https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT');
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
  const todayKey = localDateKey(now);
  if (hasEntryToday('whale-daily', now)) {
    console.log('[WhaleDailyDigest]', now.toISOString(), '-- udah kirim rekap hari ini, skip (cegah dobel kalau ke-run ulang).');
    return;
  }

  const state = loadState();
  const { height: latestHeight } = await fetchLatestBlockHeight();

  let startHeight;
  if (state.lastProcessedHeight === null) {
    // Pertama kali jalan (migrasi dari whaleMonitor.js) -- mulai dari ~144 blok ke belakang
    // (~24 jam) biar rekap PERTAMA langsung ada isi, bukan nunggu besok baru dapet data.
    startHeight = Math.max(1, latestHeight - 144);
  } else {
    startHeight = state.lastProcessedHeight + 1;
  }

  if (startHeight > latestHeight) {
    console.log('[WhaleDailyDigest]', now.toISOString(), '-- belum ada blok baru, skip.');
    return;
  }

  const endHeight = Math.min(latestHeight, startHeight + MAX_BLOCKS_PER_RUN - 1);
  if (endHeight < latestHeight) {
    console.log(`[WhaleDailyDigest] Ketinggalan banyak blok, cuma proses ${startHeight}-${endHeight} (batas ${MAX_BLOCKS_PER_RUN} blok/run).`);
  }

  const [btcPrice, usdToIdr] = await Promise.all([fetchBtcPriceUsd(), fetchUsdToIdr()]);
  const allTx = [];

  for (let height = startHeight; height <= endHeight; height++) {
    const hash = await fetchBlockHashAtHeight(height);
    const block = await fetchBlock(hash);
    allTx.push(...findLargeTransactions(block, WHALE_THRESHOLD_BTC));
    state.lastProcessedHeight = height;
    saveState(state); // simpan per-blok, biar kalau run gagal di tengah gak ngulang dari awal
  }

  const msg = formatWhaleDailyDigest(allTx, btcPrice, usdToIdr, todayKey);
  console.log(msg + '\n');
  addOrReplaceDaily('whale-daily', msg, now); // anti-dobel kalau ke-run ulang di hari sama
  await sendWhatsApp(msg);
  console.log(`[WhaleDailyDigest] ${now.toISOString()} -- blok ${startHeight}-${endHeight} diproses, ${allTx.length} transaksi >=${WHALE_THRESHOLD_BTC} BTC ditemukan.`);
}

main().catch((e) => {
  console.error('ERROR whaleDailyDigest.js:', e.message);
  process.exit(1);
});
