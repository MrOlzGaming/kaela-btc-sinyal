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
const { addOrReplaceDaily, hasEntryToday } = require('./archive');
const { fetchWithRetry } = require('./httpRetry');
const { localDateKey } = require('./config');
const { recordDailyNetflow } = require('./whaleNetflowResearchLog');

const STATE_PATH = path.join(__dirname, 'whale-state.json');
// Diturunin 1000->300 (12 Sep 2026, permintaan Olan) -- dites 12 Sep: 60 transaksi >=300 BTC
// dari 40 blok terakhir, tapi 0 match ke 6 exchange dikenal (didominasi 1 entitas non-exchange).
// Ambang lebih rendah kasih lebih banyak kesempatan nangkep transaksi exchange ASLI (biasanya
// lebih kecil drpd transfer institusi/custodian raksasa) -- trade-off: sedikit lebih banyak noise
// "gak teridentifikasi" juga, tapi itu udah gak masalah krn sekarang whale gak spam WA harian
// lagi (masuk sistem anomali, lihat anomalyScanner.js).
const WHALE_THRESHOLD_BTC = 300;
// ⛔ INSIDEN 8 Sep 2026: cap 300 (didesain buat run 1x/hari doang) TERNYATA nge-BLOCK seluruh
// pipeline trading Vultr ~13+ menit pas script ini ditambahin ke run-vultr-executor.sh (siklus
// 15 menit, backup GH Actions yang sering telat) -- lock flock bareng dipegang script INI sampai
// beres, sniperLiveMonitor/nyopetAutoTrader/multiAccountExecutor ANTRE di belakangnya. Diturunin
// balik ke 20 (dekat versi real-time lama, 6 blok/run).
// ⛔ LANJUTAN 12 Sep 2026 (ketauan dari audit log mandiri, BUKAN laporan Olan): cap 20 TERNYATA
// MASIH kena timeout 120 detik di ~25% siklus (131 dari 527 siklus selama 4 hari, dicek
// local-executor.log) -- akar masalah: 20 blok = 40 panggilan API blockchain.info SEKUENSIAL
// (fetchBlockHashAtHeight + fetchBlock per blok, gak paralel), gampang lewat 120 detik kalau
// providernya lagi agak lambat pas lagi banyak tunggakan blok. Progress per-blok TETAP kesimpen
// aman (gak ada data hilang/dobel), TAPI tiap kali timeout, seluruh pipeline trading ikut
// ketunda sampai 2 menit (lock flock yang sama). Diturunin lagi ke 8 -- di steady-state (rata2
// ~1 blok baru/siklus 15 menit) ini LEBIH dari cukup, backlog gede tetap kelar (nyicil lebih
// banyak siklus), tapi worst-case sekuensial (16 panggilan API) jauh lebih aman dari batas 120s.
const MAX_BLOCKS_PER_RUN = 8;

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
    allTx.push(...(await findLargeTransactions(block, WHALE_THRESHOLD_BTC)));
    state.lastProcessedHeight = height;
    saveState(state); // simpan per-blok, biar kalau run gagal di tengah gak ngulang dari awal
  }

  const msg = formatWhaleDailyDigest(allTx, btcPrice, usdToIdr, todayKey);
  console.log(msg + '\n');
  addOrReplaceDaily('whale-daily', msg, now); // anti-dobel kalau ke-run ulang di hari sama, TETAP kesimpen buat riwayat web

  // 12 Sep 2026, permintaan Olan ("whale alert lebih pintar atau hapus aja kek ga guna") --
  // STOP kirim WA sendiri tiap hari (7 hari sample: SEMUA bilang "0 masuk exchange, 0 keluar
  // exchange, semua gak teridentifikasi" -- daftar alamat exchange kita cuma 6, nyaris gak
  // pernah cocok, jadi pesannya emang gak ada isi). Total harian ini SEKARANG cuma ditulis ke
  // state, dibaca anomalyScanner.js (TRACKED_LABELS whaleVolumeBtc/whaleTxCount) -- WA cuma
  // kekirim kalau angkanya BENERAN beda jauh dari kebiasaan kita sendiri (z-score), bukan tiap
  // hari apapun isinya. Data mentah tetap kesimpen di archive (baris di atas) buat yang mau cek manual.
  const totalBtc = allTx.reduce((s, t) => s + t.totalBtc, 0);
  const toExchangeBtc = allTx.filter((t) => t.direction === 'TO_EXCHANGE').reduce((s, t) => s + t.totalBtc, 0);
  const fromExchangeBtc = allTx.filter((t) => t.direction === 'FROM_EXCHANGE').reduce((s, t) => s + t.totalBtc, 0);
  state.lastDigest = { dateKey: todayKey, totalBtc, count: allTx.length, toExchangeBtc, fromExchangeBtc };
  saveState(state);
  recordDailyNetflow({ dateKey: todayKey, totalBtc, count: allTx.length, toExchangeBtc, fromExchangeBtc, btcPriceUsd: btcPrice });
  console.log(`[WhaleDailyDigest] ${now.toISOString()} -- blok ${startHeight}-${endHeight} diproses, ${allTx.length} transaksi >=${WHALE_THRESHOLD_BTC} BTC ditemukan (${totalBtc.toFixed(0)} BTC total) -- ditulis ke state buat anomalyScanner.js, GAK kirim WA sendiri.`);
}

main().catch((e) => {
  console.error('ERROR whaleDailyDigest.js:', e.message);
  process.exit(1);
});
