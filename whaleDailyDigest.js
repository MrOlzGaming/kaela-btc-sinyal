// Jalankan tiap ~15 menit (lewat run-vultr-executor.sh): SCAN blok baru TIAP RUN (gak digate
// status WA harian lagi -- lihat catatan bug 13 Sep 2026 di bawah), TAPI cuma KIRIM 1 pesan WA
// rekap per hari kalender WITA.
//
// Ganti dari whaleMonitor.js (real-time tiap 10 menit, dipensiunkan 10 Agu 2026, permintaan Olan):
// konfirmasi blockchain BUKAN instan -- transaksi jam 2 pagi bisa aja baru ke-mined jam siang
// kalau network lagi padat/kompetisi fee. "Real-time" tiap 10 menit jadi ilusi -- kadang telat
// jauh dari kejadian aslinya tanpa jelas ke pembaca. Rekap harian JUJUR soal ini: gak janjiin
// real-time, cuma laporin total yang KE-KONFIRMASI 24 jam terakhir -- lebih cocok sama cara kerja
// blockchain yang sebenarnya. whaleMonitor.js dibiarin ada (gak dihapus, buat riwayat), gak
// dipanggil workflow lagi.
//
// ⛔ BUG DITEMUKAN+DIPERBAIKI 13 Sep 2026 (ketauan iseng pas mau nambah fitur baru, BUKAN laporan
// Olan): versi LAMA nge-skip SELURUH proses scan blok (termasuk majuin lastProcessedHeight) kalau
// hasEntryToday('whale-daily') udah true -- artinya begitu rekap WA hari itu KEKIRIM SEKALI (abis
// batch pertama, cuma MAX_BLOCKS_PER_RUN=8 blok), SISA ~136 blok hari itu (blockchain hasilin
// ~144 blok/hari) GAK PERNAH di-scan sampai besok. Backlog numpuk TERUS tanpa pernah kekejar
// (dicek 13 Sep: udah 211 blok / ~1,5 hari ketinggalan dari tip asli). Data whale netflow yang
// dipakai anomalyScanner.js + whaleNetflowResearchLog.js selama ini KURANG LENGKAP dari yang
// diklaim ("~24 jam terakhir"), makin lama makin ketinggalan. FIX: scan blok jalan TIAP RUN tanpa
// syarat, akumulasi ke state.todayAccum sepanjang hari; hasEntryToday CUMA nge-gate pengiriman
// pesan WA (biar gak dobel), BUKAN nge-gate proses scan-nya.

const fs = require('fs');
const path = require('path');
const { fetchLatestBlockHeight, fetchBlockHashAtHeight, fetchBlock, findLargeTransactions } = require('./whaleFetch');
const { formatWhaleDailyDigest } = require('./whaleLog');
const { addOrReplaceDaily, hasEntryToday } = require('./archive');
const { fetchWithRetry } = require('./httpRetry');
const { localDateKey, local4hBucketKey } = require('./config');
const { recordDailyNetflow, recordNetflowBucket } = require('./whaleNetflowResearchLog');
const { detectMinerPool } = require('./minerPools');
const { recordDailyPoolCounts } = require('./minerPoolResearchLog');

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
// banyak siklus -- SEKARANG beneran nyicil TIAP SIKLUS, bukan cuma 1x/hari, lihat fix bug di atas).
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

  let newTx = [];
  if (startHeight > latestHeight) {
    console.log('[WhaleDailyDigest]', now.toISOString(), '-- belum ada blok baru buat di-scan.');
  } else {
    const endHeight = Math.min(latestHeight, startHeight + MAX_BLOCKS_PER_RUN - 1);
    if (endHeight < latestHeight) {
      console.log(`[WhaleDailyDigest] Ketinggalan banyak blok, cuma proses ${startHeight}-${endHeight} (batas ${MAX_BLOCKS_PER_RUN} blok/run, sisa lanjut run berikutnya).`);
    }

    const poolCounts = {};
    for (let height = startHeight; height <= endHeight; height++) {
      const hash = await fetchBlockHashAtHeight(height);
      const block = await fetchBlock(hash);
      newTx.push(...(await findLargeTransactions(block, WHALE_THRESHOLD_BTC)));

      const pool = detectMinerPool(block); // null = gak teridentifikasi (BUKAN "pool aneh")
      poolCounts[pool === null ? 'unidentified' : pool] = (poolCounts[pool === null ? 'unidentified' : pool] || 0) + 1;

      state.lastProcessedHeight = height;
      saveState(state); // simpan per-blok, biar kalau run gagal di tengah gak ngulang dari awal
    }
    recordDailyPoolCounts(todayKey, poolCounts);

    // Akumulasi ke state -- BEDA dari versi lama, ini jalan TIAP RUN tanpa syarat status WA hari
    // ini (itu bug-nya, lihat catatan atas). Reset akumulator kalau ganti hari kalender WITA.
    if (!state.todayAccum || state.todayAccum.dateKey !== todayKey) {
      state.todayAccum = { dateKey: todayKey, txList: [] };
    }
    state.todayAccum.txList.push(...newTx.map((t) => ({ totalBtc: t.totalBtc, direction: t.direction, exchange: t.exchange })));
    saveState(state);

    // Bucket 4H -- riset resolusi Nyopet, jalan TIAP RUN yang ada blok diproses (walau newTx
    // kosong, biar bucket "sepi" juga tercatat sbg baseline, bukan cuma pas ada whale).
    const toExchangeBtc = newTx.filter((t) => t.direction === 'TO_EXCHANGE').reduce((s, t) => s + t.totalBtc, 0);
    const fromExchangeBtc = newTx.filter((t) => t.direction === 'FROM_EXCHANGE').reduce((s, t) => s + t.totalBtc, 0);
    const totalBtcThisRun = newTx.reduce((s, t) => s + t.totalBtc, 0);
    const btcPriceForBucket = await fetchBtcPriceUsd();
    recordNetflowBucket({
      bucketKey: local4hBucketKey(now),
      totalBtc: totalBtcThisRun, count: newTx.length, toExchangeBtc, fromExchangeBtc,
      btcPriceUsd: btcPriceForBucket,
    });
  }

  // Kirim rekap WA cuma 1x per hari kalender WITA -- pakai AKUMULASI SEJAUH INI hari ini (state.
  // todayAccum), BUKAN cuma batch run ini. hasEntryToday DIGATE DI SINI DOANG (kirim pesan),
  // TIDAK lagi nge-gate proses scan blok di atas (itu bug-nya).
  if (hasEntryToday('whale-daily', now)) {
    console.log('[WhaleDailyDigest]', now.toISOString(), '-- rekap WA hari ini udah kekirim, skip kirim ulang (scan blok tetap jalan di atas).');
    return;
  }
  if (!state.todayAccum || state.todayAccum.txList.length === 0) {
    // Belum ada akumulasi apapun hari ini (misal run pertama hari ini pas belum ada blok baru).
    // Jangan kirim rekap kosong prematur -- tunggu run berikutnya yang beneran ada progress scan.
    console.log('[WhaleDailyDigest]', now.toISOString(), '-- belum ada akumulasi hari ini, tunda kirim rekap.');
    return;
  }

  const allTx = state.todayAccum.txList;
  const [btcPrice, usdToIdr] = await Promise.all([fetchBtcPriceUsd(), fetchUsdToIdr()]);
  const msg = formatWhaleDailyDigest(allTx, btcPrice, usdToIdr, todayKey);
  console.log(msg + '\n');
  addOrReplaceDaily('whale-daily', msg, now);

  const totalBtc = allTx.reduce((s, t) => s + t.totalBtc, 0);
  const toExchangeBtc = allTx.filter((t) => t.direction === 'TO_EXCHANGE').reduce((s, t) => s + t.totalBtc, 0);
  const fromExchangeBtc = allTx.filter((t) => t.direction === 'FROM_EXCHANGE').reduce((s, t) => s + t.totalBtc, 0);
  state.lastDigest = { dateKey: todayKey, totalBtc, count: allTx.length, toExchangeBtc, fromExchangeBtc };
  saveState(state);
  recordDailyNetflow({ dateKey: todayKey, totalBtc, count: allTx.length, toExchangeBtc, fromExchangeBtc, btcPriceUsd: btcPrice });
  console.log(`[WhaleDailyDigest] ${now.toISOString()} -- rekap hari ${todayKey} dikirim (${allTx.length} transaksi >=${WHALE_THRESHOLD_BTC} BTC, ${totalBtc.toFixed(0)} BTC total) -- ditulis ke state buat anomalyScanner.js.`);
}

main().catch((e) => {
  console.error('ERROR whaleDailyDigest.js:', e.message);
  process.exit(1);
});
