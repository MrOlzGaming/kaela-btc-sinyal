// liquidationListener.js -- listener PERSISTEN (bukan cron) buat feed likuidasi RESMI Binance
// (wss://fstream.binance.com/ws/!forceOrder@arr), GRATIS, GAK BUTUH API key/akun. 12 Sep 2026,
// permintaan Olan ("liq heatmap BENERAN", lanjutan riset "mikir kayak bandar" -- lihat
// feedback-market-maker-mindset) -- phase 2 setelah positioning ratio (marketSentiment.js/
// smartMoneyDivergenceMonitor.js) kebukti berguna.
//
// ⚠️ ARSITEKTUR BEDA dari SEMUA script lain di folder ini (yang cron-based, jalan-lalu-KELUAR
// tiap 5/15 menit) -- ini PROSES NYALA TERUS 24 JAM, dikelola systemd (lihat
// kaela-liquidation-listener.service), krn WebSocket butuh koneksi tetap kebuka buat nerima
// event real-time. JANGAN panggil dari run-vultr-executor.sh -- bakal numpuk proses ganda tiap
// siklus kalau ke situ.
//
// ⚠️ KETERBATASAN JUJUR: Binance CUMA kirim likuidasi TERBESAR per simbol per 1000ms (snapshot,
// BUKAN akumulasi semua event dalam window itu) -- jadi ini SEDIKIT under-count total volume pas
// market lagi liar (banyak likuidasi bareng dalam 1 detik yang sama kepotong jadi 1 doang). Tetap
// representatif buat tujuan heatmap ("di harga berapa likuidasi numpuk") -- dan ini SATU-SATUNYA
// sumber likuidasi REAL yang kepake proyek ini (bukan estimasi pihak ketiga kayak Coinglass).
//
// Nyimpen 2 hal:
// 1. Raw event log (liquidation-events.jsonl, append-only, di-cap ukurannya) -- buat audit/debug.
// 2. Heatmap teragregasi per price-bucket (liquidation-heatmap.json) -- SUMBER UTAMA riset, field
//    longLiquidatedUsd (posisi LONG kena force-sell -- side pesanan SELL) vs shortLiquidatedUsd
//    (posisi SHORT kena force-buy -- side pesanan BUY) DIPISAH biar arah tekanannya jelas.
//
// Fokus BTCUSDT doang (scope proyek ini, lihat project-kaela-bloomberg-mini-scope) -- simbol lain
// tetap kesimpen di raw log (murah, siapa tau kepake nanti) tapi GAK diagregasi ke heatmap.
//
// ⛔ MURNI PENGUMPULAN DATA -- gak pernah kirim WA/pengaruhi sinyal trading apapun sendiri. Sesuai
// permintaan Olan ("belajar dulu bukan langsung buat ke sistem"), APAPUN pola yang ketemu dari
// data ini WAJIB dilaporin+minta izin dulu sebelum dipakai buat keputusan live manapun.

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const WS_URL = 'wss://fstream.binance.com/ws/!forceOrder@arr';
const HEATMAP_PATH = path.join(__dirname, 'liquidation-heatmap.json');
const RAW_LOG_PATH = path.join(__dirname, 'liquidation-events.jsonl');
const MAX_RAW_LOG_LINES = 50000; // cap ukuran file (~beberapa hari data market-wide), dipangkas berkala
const TRIM_CHECK_EVERY = 2000;   // cek pangkas tiap N event baru (bukan tiap event, hemat I/O)
const STALE_MS = 3 * 60 * 1000;  // gak ada pesan sama sekali 3 menit -> anggap koneksi zombie, paksa reconnect
const RECONNECT_DELAY_MS = 3000;
const BUCKET_SIZE = { BTCUSDT: 250 }; // simbol lain: raw log tetap kesimpen, cuma gak diagregasi ke heatmap
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const FLUSH_EVERY_N_EVENTS = 5; // heatmap ditulis ulang tiap N event (bukan tiap event, hemat I/O)

function loadHeatmap() {
  if (!fs.existsSync(HEATMAP_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(HEATMAP_PATH, 'utf8')); } catch { return {}; }
}
function saveHeatmap(h) {
  fs.writeFileSync(HEATMAP_PATH, JSON.stringify(h, null, 2));
}

function appendRawLog(entry) {
  fs.appendFileSync(RAW_LOG_PATH, JSON.stringify(entry) + '\n');
}

let linesSinceLastTrim = 0;
function maybeTrimRawLog() {
  linesSinceLastTrim++;
  if (linesSinceLastTrim < TRIM_CHECK_EVERY) return;
  linesSinceLastTrim = 0;
  try {
    if (!fs.existsSync(RAW_LOG_PATH)) return;
    const lines = fs.readFileSync(RAW_LOG_PATH, 'utf8').split('\n').filter(Boolean);
    if (lines.length > MAX_RAW_LOG_LINES) {
      fs.writeFileSync(RAW_LOG_PATH, lines.slice(-MAX_RAW_LOG_LINES).join('\n') + '\n');
      console.log(`[LiquidationListener] Raw log dipangkas ke ${MAX_RAW_LOG_LINES} baris terakhir.`);
    }
  } catch (e) {
    console.log('[LiquidationListener] Gagal cek/pangkas raw log:', e.message);
  }
}

function bucketKey(symbol, price) {
  const size = BUCKET_SIZE[symbol];
  if (!size) return null;
  return String(Math.round(price / size) * size);
}

// side 'SELL' = posisi LONG kena force-close (Binance jual paksa) -> tekanan harga TURUN.
// side 'BUY' = posisi SHORT kena force-close (Binance beli paksa balik) -> tekanan harga NAIK.
function recordLiquidation(heatmap, { symbol, side, price, qty, timestamp }) {
  const bkt = bucketKey(symbol, price);
  if (!bkt) return;
  const notional = price * qty;
  if (!heatmap[symbol]) heatmap[symbol] = {};
  if (!heatmap[symbol][bkt]) {
    heatmap[symbol][bkt] = { longLiquidatedUsd: 0, shortLiquidatedUsd: 0, longCount: 0, shortCount: 0, firstSeen: timestamp, lastSeen: timestamp };
  }
  const b = heatmap[symbol][bkt];
  if (side === 'SELL') { b.longLiquidatedUsd += notional; b.longCount++; }
  else { b.shortLiquidatedUsd += notional; b.shortCount++; }
  b.lastSeen = timestamp;
}

function connect() {
  console.log(`[LiquidationListener] Menyambung ke ${WS_URL}...`);
  const ws = new WebSocket(WS_URL);
  let lastMessageAt = Date.now();
  let heatmap = loadHeatmap();
  let dirtyCount = 0;

  const staleCheck = setInterval(() => {
    if (Date.now() - lastMessageAt > STALE_MS) {
      console.log('[LiquidationListener] Gak ada pesan >3 menit -- dianggap koneksi zombie, paksa reconnect.');
      ws.terminate();
    }
  }, 30000);

  const heartbeat = setInterval(() => {
    console.log(`[LiquidationListener] Heartbeat -- masih hidup, terakhir terima pesan ${Math.round((Date.now() - lastMessageAt) / 1000)}s lalu.`);
  }, HEARTBEAT_INTERVAL_MS);

  ws.on('open', () => console.log('[LiquidationListener] Koneksi kebuka.'));

  ws.on('message', (raw) => {
    lastMessageAt = Date.now();
    try {
      const msg = JSON.parse(raw.toString());
      const o = msg.o;
      if (!o) return;
      const entry = { symbol: o.s, side: o.S, price: parseFloat(o.p), qty: parseFloat(o.q), timestamp: o.T };
      appendRawLog(entry);
      maybeTrimRawLog();
      recordLiquidation(heatmap, entry);
      dirtyCount++;
      if (dirtyCount >= FLUSH_EVERY_N_EVENTS) { saveHeatmap(heatmap); dirtyCount = 0; }
    } catch (e) {
      console.log('[LiquidationListener] Gagal proses pesan:', e.message);
    }
  });

  ws.on('error', (e) => console.log('[LiquidationListener] WS error:', e.message));

  ws.on('close', (code, reason) => {
    clearInterval(staleCheck);
    clearInterval(heartbeat);
    saveHeatmap(heatmap); // flush sisa yang belum ketulis
    console.log(`[LiquidationListener] Koneksi tertutup (code ${code}, ${reason}) -- reconnect dalam ${RECONNECT_DELAY_MS}ms.`);
    setTimeout(connect, RECONNECT_DELAY_MS);
  });
}

connect();

process.on('SIGTERM', () => { console.log('[LiquidationListener] SIGTERM diterima, keluar bersih.'); process.exit(0); });
process.on('SIGINT', () => { console.log('[LiquidationListener] SIGINT diterima, keluar bersih.'); process.exit(0); });
