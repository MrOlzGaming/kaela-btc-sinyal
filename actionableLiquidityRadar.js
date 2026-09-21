// actionableLiquidityRadar.js -- Fase 1 (21 Sep 2026, permintaan Olan: filosofi "forced-flow /
// liquidity analyst" -- "jangan tanya BTC bakal ke mana, tanya uang siapa yang paling rentan
// dipaksa bergerak"). MURNI RADAR INFO -- BUKAN sinyal entry, Kaela GAK BUKA POSISI dari ini,
// PRINSIP SAMA PERSIS squeezeDetector.js.
//
// Menjawab "gimana caranya kita dapat info yang LIVE?" -- gabungin 3 sumber REAL (BUKAN model/
// tebakan kayak "liquidation heatmap" yang dijual CoinGlass dkk -- itu ESTIMASI dari OI+asumsi
// leverage, bukan data posisi asli):
//   1. HISTORI cluster (liquidation-heatmap.json, ditulis liquidationListener.js sejak 13 Sep) --
//      "level mana yang DULU rame numpuk", BUKAN snapshot posisi terbuka SEKARANG -- itu emang
//      gak ada sumbernya di manapun, gratis atau berbayar (privat exchange, gak pernah publik).
//   2. CROWDING SEKARANG (marketSentiment.js -- funding rate, Open Interest, long/short ratio,
//      Binance top-trader-vs-global -- SEMUA live, resmi, gratis).
//   3. FORCED-FLOW REAL-TIME (liquidation-events.jsonl, filter window terakhir -- liquidation yang
//      BENERAN kejadian barusan, bukan histori lama).
//
// TIGA jalur trigger, INDEPENDEN, jalan tiap siklus 15 menit (state/cooldown sendiri-sendiri):
//   A. BURST -- forced-flow yang LAGI KEJADIAN (>=$300rb likuidasi 1 sisi dalam 30 menit). Jarang
//      (nunggu ledakan beneran), tapi ini yang PALING "live"/konkret.
//   B. IMBALANCE -- crowding yang KELIATAN DULUAN, SEBELUM ledakan kejadian (funding rate ekstrem
//      + ada cluster historis lumayan besar deket harga di arah yang bakal kena squeeze). Lebih
//      SERING nembak (21 Sep 2026, permintaan Olan: "jangan jadi sinyal mangkrak, beneran jalan
//      donk") -- funding rate berubah lebih pelan/kelihatan duluan drpd ledakannya sendiri.
//   C. EXHAUSTION/"kekeringan" (21 Sep 2026, Olan liat CoinGlass Liquidation Map, nanya "bisa
//      deteksi kekeringan gini gak, secara live") -- BEDA dari model OI+asumsi-leverage CoinGlass
//      (itu nebak "amunisi TERSISA", gak ada sumbernya di manapun beneran). Ini PANTAU forced-flow
//      REAL yang LAGI kejadian (mulai dari trigger BURST di atas) -- begitu kecepatan likuidasi di
//      sisi yang sama ANJLOK ke <=30% dari puncaknya, itu tanda tenaga forced-flow abis "kering".
//      Olan pakai ini buat FADE manual (short kalau short-liquidation kering [harga abis naik
//      kepaksa], long kalau long-liquidation kering [harga abis turun kepaksa]) -- di akun/exchange
//      TERPISAH dari Binance/MEXC (yang itu 100% domain Kaela), modal sangat kecil, EKSEKUSI
//      MANUAL SENDIRI (Kaela cuma kasih info, gak pegang akses exchange itu sama sekali).
//      WA TETAP OTOMATIS KEKIRIM (Olan koreksi 21 Sep -- sempat salah paham sebentar, DIBALIKIN
//      sama hari), tapi CUMA ke grup Wibowo Hedgefund (beda dari A/B yang broadcast SEMUA grup
//      -- ini eksperimen pribadi Olan, bukan konten publik Sniper Club). Olan JUGA bisa review
//      manual lewat chat Kaela kapan aja (appendSignalLog nyimpen semua) -- dua-duanya jalan,
//      bukan salah satu.
//
// Threshold KETIGANYA ini TITIK AWAL (belum divalidasi backtest, status SAMA kayak
// OI_RISE_THRESHOLD_PCT squeezeDetector.js) -- worth ditinjau ulang begitu keliatan seberapa
// sering nembak + gimana respons harga abis itu di praktiknya.
//
// SETIAP kali nembak (burst MAUPUN imbalance), dicatat ke actionable-liquidity-signal-log.json
// (append-only, numpuk data OBSERVASI REAL-TIME -- WAJIB masuk git, JANGAN gitignore, lihat
// feedback-backup-accumulated-research-data.md) -- ini yang jadi bahan Fase 2 (cross-check
// respons harga abis tiap sinyal) TANPA perlu infra tambahan nanti, tinggal fetchCandles balik
// ke timestamp yang udah kecatat.
//
// ⛔ FASE 1 doang -- info WA, BELUM masuk archive.json/kategori dashboard/Anomaly Scanner. Sesuai
// aturan proyek ("ide baru wajib backtest dulu" -- SYSTEM-MAP.md Aturan Besi #5 -- + "belajar
// dulu bukan langsung ke sistem" per komentar liquidationListener.js), Fase 2 (analisa
// signal-log ini abis numpuk beberapa minggu) & Fase 3 (backtest bener, BARU masuk Anomaly
// Scanner) NUNGGU hasil Fase 1 jalan dulu.

const fs = require('fs');
const path = require('path');
const { fetchWithRetry } = require('./httpRetry');
const { sendWhatsApp } = require('./fonnte');
const { analyzeSentiment } = require('./marketSentiment');
const { WIBOWO_GROUP_ID } = require('./wibowoNotify');

const HEATMAP_PATH = path.join(__dirname, 'liquidation-heatmap.json');
const RAW_LOG_PATH = path.join(__dirname, 'liquidation-events.jsonl');
const STATE_PATH = path.join(__dirname, 'actionable-liquidity-state.json');
const SIGNAL_LOG_PATH = path.join(__dirname, 'actionable-liquidity-signal-log.json');
const SYMBOL = 'BTCUSDT';

// --- Jalur A: BURST ---
const RECENT_WINDOW_MS = 30 * 60 * 1000; // 30 menit -- window "forced-flow lagi kejadian"
const BURST_THRESHOLD_USD = 300000; // titik awal, BELUM divalidasi
// Lebih PENDEK dari cooldown squeezeDetector.js (24 jam) -- burst liquidation natural-nya lebih
// SERING & lebih CEPAT berlalu drpd setup squeeze OI/funding yang bisa nahan berhari-hari.
const BURST_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 jam

// --- Jalur B: IMBALANCE (21 Sep 2026, biar gak mangkrak -- lebih sering nembak) ---
// Threshold funding SAMA PERSIS squeezeDetector.js (udah "kebukti dipakai" walau bukan dari
// backtest ketat, lihat riset publik metodologi-sniper.html) -- BEDA dari squeezeDetector: di
// sini pakai funding SNAPSHOT SEKARANG (marketSentiment.js), bukan rata-rata 3 hari -- lebih
// CEPAT respons, sengaja saling melengkapi (squeezeDetector = lambat+halus, ini = cepat+kasar).
const FUNDING_LONG_THRESHOLD_PCT = 0.05;
const FUNDING_SHORT_THRESHOLD_PCT = -0.03;
const NEARBY_CLUSTER_PCT = 0.03; // cluster relevan = dalam 3% dari harga sekarang
const MIN_CLUSTER_USD = 500000; // cluster historis di bawah ini dianggap gak cukup "notable"
const IMBALANCE_COOLDOWN_MS = 8 * 60 * 60 * 1000; // ~1x per periode funding (8 jam)

// --- Jalur C: EXHAUSTION/"kekeringan" (21 Sep 2026) ---
// Titik awal, BELUM divalidasi -- 30% dipilih biar cukup jelas "udah ngerem drastis" (bukan cuma
// naik-turun wajar antar siklus), bukan dari backtest ketat.
const EXHAUSTION_RATIO_THRESHOLD = 0.3;
// Episode basi (gak pernah nyampe exhaustion, likuidasi diem gak nambah2) -- lepas tracking-nya
// biar gak numpuk state selamanya nunggu kondisi yang mungkin gak pernah kepenuhan lagi.
const EPISODE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const MAX_SIGNAL_LOG_ENTRIES = 5000; // numpuk bertahun-tahun sebelum kepenuhan (ketiga jalur cooldown/episode-gated, gak akan sering)

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}
function saveState(s) { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); }

function appendSignalLog(entry) {
  let log = [];
  if (fs.existsSync(SIGNAL_LOG_PATH)) {
    try { log = JSON.parse(fs.readFileSync(SIGNAL_LOG_PATH, 'utf8')); } catch { log = []; }
  }
  log.push(entry);
  if (log.length > MAX_SIGNAL_LOG_ENTRIES) log = log.slice(log.length - MAX_SIGNAL_LOG_ENTRIES);
  fs.writeFileSync(SIGNAL_LOG_PATH, JSON.stringify(log, null, 2));
}

async function fetchLivePrice() {
  const res = await fetchWithRetry(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${SYMBOL}`);
  return parseFloat((await res.json()).price);
}

function loadHeatmap() {
  if (!fs.existsSync(HEATMAP_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(HEATMAP_PATH, 'utf8'))[SYMBOL] || {}; } catch { return {}; }
}

// Baca N baris TERAKHIR file JSONL (bukan seluruh file -- raw log bisa puluhan ribu baris) --
// cukup buat nyakup RECENT_WINDOW_MS asal event gak lagi SUPER padat (>2000 event/30menit, jarang
// banget kejadian bahkan pas market rame -- histori 8 hari baseline-nya ~10 event/jam).
function readRecentEvents(windowMs, now = Date.now()) {
  if (!fs.existsSync(RAW_LOG_PATH)) return [];
  const lines = fs.readFileSync(RAW_LOG_PATH, 'utf8').split('\n').filter(Boolean).slice(-2000);
  const cutoff = now - windowMs;
  return lines
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && e.symbol === SYMBOL && e.timestamp >= cutoff);
}

// Pure function biar gampang ditest -- ringkas event jadi total notional per sisi.
// side 'SELL' = LONG kena force-close (tekanan harga TURUN). side 'BUY' = SHORT kena force-close
// (tekanan harga NAIK) -- konvensi SAMA PERSIS liquidationListener.js recordLiquidation().
function summarizeEvents(events) {
  let longUsd = 0, shortUsd = 0, longCount = 0, shortCount = 0;
  for (const e of events) {
    const notional = e.price * e.qty;
    if (e.side === 'SELL') { longUsd += notional; longCount++; }
    else { shortUsd += notional; shortCount++; }
  }
  return { longUsd, shortUsd, longCount, shortCount };
}

// Cari cluster historis di 1 SISI harga (di atas ATAU di bawah currentPrice), diurut dari yang
// PALING DEKAT ke currentPrice dulu (bukan yang paling BESAR) -- relevansi JARAK lebih penting
// drpd ukuran buat "apa yang bakal ketemu duluan kalau harga jalan ke arah situ".
function nearbyClusters(heatmap, currentPrice, direction, field, limit = 3) {
  const buckets = Object.keys(heatmap)
    .map((k) => ({ price: Number(k), usd: heatmap[k][field] || 0 }))
    .filter((b) => b.usd > 0 && (direction === 'above' ? b.price > currentPrice : b.price < currentPrice));
  buckets.sort((a, b) => (direction === 'above' ? a.price - b.price : b.price - a.price));
  return buckets.slice(0, limit);
}

// Pure function -- deteksi crowding funding EKSTREM + ada cluster historis "notable" DEKAT harga
// di arah yang relevan (short crowded -> cek cluster short DI ATAS; long crowded -> cek cluster
// long DI BAWAH). Return null kalau kondisi gak kepenuhan (funding normal, ATAU funding ekstrem
// tapi gak ada cluster relevan deket -- dua-duanya WAJIB, funding doang gak cukup "actionable"
// tanpa konteks lokasi).
function detectImbalance(heatmap, currentPrice, fundingPct) {
  if (fundingPct <= FUNDING_SHORT_THRESHOLD_PCT) {
    const clusters = nearbyClusters(heatmap, currentPrice, 'above', 'shortLiquidatedUsd', 1)
      .filter((c) => c.price <= currentPrice * (1 + NEARBY_CLUSTER_PCT) && c.usd >= MIN_CLUSTER_USD);
    if (clusters.length) return { side: 'short', fundingPct, cluster: clusters[0] };
    return null;
  }
  if (fundingPct >= FUNDING_LONG_THRESHOLD_PCT) {
    const clusters = nearbyClusters(heatmap, currentPrice, 'below', 'longLiquidatedUsd', 1)
      .filter((c) => c.price >= currentPrice * (1 - NEARBY_CLUSTER_PCT) && c.usd >= MIN_CLUSTER_USD);
    if (clusters.length) return { side: 'long', fundingPct, cluster: clusters[0] };
    return null;
  }
  return null;
}

// Pure function (gampang ditest) -- lacak 1 "episode" burst aktif (per SISI, mulai dari trigger
// BURST). SELALU pantau sisi yang SAMA sepanjang episode (bukan "sisi dominan siklus ini") --
// begitu volume di sisi itu ANJLOK ke <=EXHAUSTION_RATIO_THRESHOLD dari puncaknya, episode DITUTUP
// + tandain exhausted (SEKALI doang per episode, gak diulang-ulang). Episode BARU cuma mulai kalau
// gak lagi nge-track apapun (atau yang lama udah basi) DAN ada sisi yang crossing BURST_THRESHOLD_USD.
function updateBurstEpisode(episode, burst, now) {
  const isStale = episode && (now - episode.startedAt > EPISODE_MAX_AGE_MS);
  if (episode && !isStale) {
    const windowUsd = episode.side === 'long' ? burst.longUsd : burst.shortUsd;
    const peakUsd = Math.max(episode.peakUsd, windowUsd);
    const ratio = peakUsd > 0 ? windowUsd / peakUsd : 0;
    if (ratio <= EXHAUSTION_RATIO_THRESHOLD) {
      return { episode: null, exhausted: true, exhaustedSide: episode.side, peakUsd };
    }
    return { episode: { side: episode.side, startedAt: episode.startedAt, peakUsd }, exhausted: false };
  }
  const dominant = burst.longUsd > burst.shortUsd ? 'long' : 'short';
  const dominantUsd = Math.max(burst.longUsd, burst.shortUsd);
  if (dominantUsd >= BURST_THRESHOLD_USD) {
    return { episode: { side: dominant, startedAt: now, peakUsd: dominantUsd }, exhausted: false };
  }
  return { episode: null, exhausted: false };
}

function fmtUsd(n) { return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 }); }

function sentimentLines(sentiment) {
  const lines = [];
  if (sentiment.funding) lines.push(`Funding rate: ${(sentiment.funding.rate * 100).toFixed(4)}% (${sentiment.funding.rate > 0 ? 'long bayar short -- long lebih crowded' : 'short bayar long -- short lebih crowded'})`);
  if (sentiment.openInterest) lines.push(`Open Interest: ${sentiment.openInterest.openInterest.toLocaleString('en-US', { maximumFractionDigits: 0 })} BTC`);
  if (sentiment.binancePositioning) {
    const bp = sentiment.binancePositioning;
    lines.push(`Top Trader vs Global: ${bp.topLongPct.toFixed(0)}% long (top trader) vs ${bp.globalLongPct.toFixed(0)}% long (global/retail)`);
  }
  return lines;
}

function formatBurstAlert({ price, burst, clustersSameDirection, sentiment }) {
  const isShortBurst = burst.shortUsd > burst.longUsd; // short-burst = harga lagi NAIK (short kepaksa beli)
  const dirLabel = isShortBurst ? 'NAIK (short kepaksa beli balik)' : 'TURUN (long kepaksa jual paksa)';
  const burstUsd = isShortBurst ? burst.shortUsd : burst.longUsd;
  const burstCount = isShortBurst ? burst.shortCount : burst.longCount;
  const clusterLabel = isShortBurst ? 'SHORT' : 'LONG';

  const lines = [
    '🟣 ⚠️ KAELA -- FORCED-FLOW TERDETEKSI (BTC)',
    '',
    `Harga lagi ${dirLabel} -- ${fmtUsd(burstUsd)} posisi ${clusterLabel} kena likuidasi paksa dalam 30 menit terakhir (${burstCount} event, data real Bybit).`,
    `Harga sekarang: $${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
    '',
  ];

  if (clustersSameDirection.length) {
    lines.push(`📍 Zona historis "${clusterLabel.toLowerCase()}-crowded" terdekat di arah yang sama (data 8+ hari terakhir, BUKAN posisi terbuka sekarang -- cuma nunjukin level yang DULU rame):`);
    clustersSameDirection.forEach((c) => lines.push(`  $${c.price.toLocaleString('en-US')} -- pernah ${fmtUsd(c.usd)} kelikuidasi di sini`));
    lines.push('');
  } else {
    lines.push('📍 Belum ada zona historis tercatat di arah ini (data masih numpuk sejak 13 Sep 2026, atau harga masuk wilayah baru).', '');
  }

  lines.push(...sentimentLines(sentiment));
  lines.push(
    '',
    '⚠️ Ini RADAR FASE 1 (belum divalidasi backtest) -- MURNI info forced-flow yang LAGI KEJADIAN + konteks historis, BUKAN sinyal entry. Kaela gak buka posisi dari ini.',
    '',
    '— Kaela',
  );
  return lines.join('\n');
}

function formatImbalanceAlert({ price, imbalance, sentiment }) {
  const isShort = imbalance.side === 'short';
  const dirLabel = isShort ? 'SHORT lebih crowded (funding negatif)' : 'LONG lebih crowded (funding positif)';
  const watchLabel = isShort ? 'NAIK' : 'TURUN';
  const clusterLabel = isShort ? 'short' : 'long';

  const lines = [
    '🟣 👀 KAELA -- CROWDING TERDETEKSI, ZONA BUAT DIPANTAU (BTC)',
    '',
    `${dirLabel} -- kalau harga ${watchLabel} mendekati zona di bawah ini, berpotensi jadi pemicu squeeze (BELUM terjadi, ini crowding SEBELUM ledakan).`,
    `Harga sekarang: $${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
    `Zona historis ${clusterLabel}-crowded terdekat: $${imbalance.cluster.price.toLocaleString('en-US')} (pernah ${fmtUsd(imbalance.cluster.usd)} kelikuidasi di sini, data 8+ hari terakhir).`,
    '',
  ];
  lines.push(...sentimentLines(sentiment));
  lines.push(
    '',
    '⚠️ Ini RADAR FASE 1 (belum divalidasi backtest) -- MURNI info crowding + lokasi zona historis, BUKAN sinyal entry. Kaela gak buka posisi dari ini.',
    '',
    '— Kaela',
  );
  return lines.join('\n');
}

function formatExhaustionAlert({ price, exhaustedSide, peakUsd, sentiment }) {
  const isShort = exhaustedSide === 'short';
  // short-liquidation kering = harga abis dipaksa NAIK (short kepaksa beli), tenaga itu abis
  // -> fade = SHORT. long-liquidation kering = harga abis dipaksa TURUN, tenaga itu abis -> fade = LONG.
  const fadeAction = isShort ? 'SHORT' : 'LONG';
  const causeLabel = isShort ? 'short kepaksa beli balik (harga abis NAIK)' : 'long kepaksa jual paksa (harga abis TURUN)';

  const lines = [
    '🟣 🏜️ KAELA -- FORCED-FLOW MULAI KERING (BTC)',
    '',
    `Ledakan likuidasi ${exhaustedSide.toUpperCase()} (${causeLabel}) kelihatan udah NGEREM DRASTIS -- kecepatannya turun ke bawah 30% dari puncaknya (puncak sempat ${fmtUsd(peakUsd)}/30 menit).`,
    `Harga sekarang: $${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
    '',
    `Sesuai logic fade yang kamu pakai: ini titik yang biasanya jadi pertimbangan buka ${fadeAction} manual (di akun terpisah, modal kecil) -- tenaga forced-flow yang tadi dorong harga kemungkinan udah abis.`,
    '',
  ];
  lines.push(...sentimentLines(sentiment));
  lines.push(
    '',
    '⚠️ Ini RADAR FASE 1 (belum divalidasi backtest) -- MURNI observasi kecepatan forced-flow, BUKAN sinyal entry resmi Kaela. Keputusan & eksekusi manual sepenuhnya di tangan kamu.',
    '',
    '— Kaela',
  );
  return lines.join('\n');
}

async function checkBurst(state, price, sentiment, heatmap, burst, now) {
  const dominant = Math.max(burst.longUsd, burst.shortUsd);
  if (dominant < BURST_THRESHOLD_USD) {
    console.log(`[ActionableLiquidityRadar] Burst: belum signifikan (long ${fmtUsd(burst.longUsd)}, short ${fmtUsd(burst.shortUsd)}) -- skip.`);
    return;
  }
  const side = burst.shortUsd > burst.longUsd ? 'short' : 'long';
  if (state.lastBurstSide === side && state.lastBurstAt && now - new Date(state.lastBurstAt).getTime() < BURST_COOLDOWN_MS) {
    console.log(`[ActionableLiquidityRadar] Burst ${side} masih dalam cooldown -- skip.`);
    return;
  }
  const clustersSameDirection = nearbyClusters(heatmap, price, side === 'short' ? 'above' : 'below', side === 'short' ? 'shortLiquidatedUsd' : 'longLiquidatedUsd');
  const msg = formatBurstAlert({ price, burst, clustersSameDirection, sentiment });
  console.log(msg);
  await sendWhatsApp(msg); // broadcast biasa -- Sniper Club + Wibowo Hedgefund (Aturan Besi #4 SYSTEM-MAP.md)
  state.lastBurstSide = side;
  state.lastBurstAt = new Date(now).toISOString();
  appendSignalLog({ timestamp: new Date(now).toISOString(), type: 'burst', side, price, burstUsd: side === 'short' ? burst.shortUsd : burst.longUsd, burstCount: side === 'short' ? burst.shortCount : burst.longCount });
}

async function checkImbalance(state, price, sentiment, heatmap, now) {
  if (!sentiment.funding) {
    console.log('[ActionableLiquidityRadar] Imbalance: funding rate gagal diambil -- skip siklus ini.');
    return;
  }
  const fundingPct = sentiment.funding.rate * 100;
  const imbalance = detectImbalance(heatmap, price, fundingPct);
  if (!imbalance) {
    console.log(`[ActionableLiquidityRadar] Imbalance: belum kepenuhan (funding ${fundingPct.toFixed(4)}%) -- skip.`);
    return;
  }
  if (state.lastImbalanceSide === imbalance.side && state.lastImbalanceAt && now - new Date(state.lastImbalanceAt).getTime() < IMBALANCE_COOLDOWN_MS) {
    console.log(`[ActionableLiquidityRadar] Imbalance ${imbalance.side} masih dalam cooldown -- skip.`);
    return;
  }
  const msg = formatImbalanceAlert({ price, imbalance, sentiment });
  console.log(msg);
  await sendWhatsApp(msg);
  state.lastImbalanceSide = imbalance.side;
  state.lastImbalanceAt = new Date(now).toISOString();
  appendSignalLog({ timestamp: new Date(now).toISOString(), type: 'imbalance', side: imbalance.side, price, fundingPct, clusterPrice: imbalance.cluster.price, clusterUsd: imbalance.cluster.usd });
}

// Jalur C -- update tracking episode SETIAP siklus (regardless nembak atau nggak, biar peak/basi
// ke-track bener), kirim WA CUMA pas beneran exhausted (sekali per episode).
// 21 Sep 2026 -- WA TETAP OTOMATIS ke grup Wibowo Hedgefund (Olan konfirmasi ulang: "sinyal ttep
// otomatis kirim ke grup hedgefund wibowo.. tadi itu aku mau minta tampilanya disini juga biar
// aku review" -- jadi DUA-DUANYA jalan, WA + review manual, bukan salah satu). BEDA dari jalur
// A/B yang broadcast ke SEMUA grup (Sniper Club juga) -- jalur C CUMA ke Wibowo Hedgefund
// (WIBOWO_GROUP_ID spesifik), karena ini eksperimen pribadi Olan, bukan konten publik Sniper
// Club. LANGSUNG sendWhatsApp+WIBOWO_GROUP_ID (BUKAN sendWhatsAppToWibowo -- itu ke-gate toggle
// Silent Trade, gak relevan di sini), pola sama kayak laporan non-trading lain
// (feedback-wa-no-personal-dm-reports.md).
async function checkExhaustion(state, price, sentiment, burst, now) {
  const result = updateBurstEpisode(state.burstEpisode || null, burst, now);
  state.burstEpisode = result.episode;
  if (!result.exhausted) return;
  const msg = formatExhaustionAlert({ price, exhaustedSide: result.exhaustedSide, peakUsd: result.peakUsd, sentiment });
  console.log(msg);
  await sendWhatsApp(msg, WIBOWO_GROUP_ID);
  appendSignalLog({ timestamp: new Date(now).toISOString(), type: 'exhaustion', side: result.exhaustedSide, price, peakUsd: result.peakUsd });
}

async function main() {
  const now = Date.now();
  const [price, sentiment] = await Promise.all([fetchLivePrice(), analyzeSentiment()]);
  const heatmap = loadHeatmap();
  const state = loadState();
  const burst = summarizeEvents(readRecentEvents(RECENT_WINDOW_MS, now));

  await checkBurst(state, price, sentiment, heatmap, burst, now);
  await checkImbalance(state, price, sentiment, heatmap, now);
  await checkExhaustion(state, price, sentiment, burst, now);

  saveState(state);
}

module.exports = {
  main, summarizeEvents, nearbyClusters, readRecentEvents, detectImbalance, updateBurstEpisode,
  BURST_THRESHOLD_USD, RECENT_WINDOW_MS, BURST_COOLDOWN_MS,
  FUNDING_LONG_THRESHOLD_PCT, FUNDING_SHORT_THRESHOLD_PCT, NEARBY_CLUSTER_PCT, MIN_CLUSTER_USD, IMBALANCE_COOLDOWN_MS,
  EXHAUSTION_RATIO_THRESHOLD, EPISODE_MAX_AGE_MS,
};
if (require.main === module) { main().catch((e) => console.log('[ActionableLiquidityRadar] ERROR:', e.message)); }
