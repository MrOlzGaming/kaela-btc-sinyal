// liquidationListener.js -- listener PERSISTEN (bukan cron) buat feed likuidasi REAL-TIME, GRATIS,
// GAK BUTUH API key/akun. 12 Sep 2026, permintaan Olan ("liq heatmap BENERAN", lanjutan riset
// "mikir kayak bandar" -- lihat feedback-market-maker-mindset) -- phase 2 setelah positioning
// ratio (marketSentiment.js/smartMoneyDivergenceMonitor.js) kebukti berguna.
//
// ⛔ RIWAYAT 12 Sep 2026 -- Binance (wss://fstream.binance.com/ws/!forceOrder@arr) DIDIAGNOSA
// PANJANG: koneksi genuinely kebuka, subscribe-ack diterima, TAPI data streaming lanjutan GAK
// PERNAH nyampe, dari 2 jaringan beda (sandbox lokal + VPS Vultr ini sendiri) -- Binance SPOT WS
// & Bybit Futures WS dua-duanya LANCAR dari IP yang SAMA persis, jadi BUKAN masalah jaringan Vultr
// umum, SPESIFIK ke Binance FUTURES WebSocket. Dugaan kuat: Binance sengaja gak ngirim data
// real-time Futures ke IP datacenter/VPS/cloud (anti-bot/HFT). Olan putuskan "cukup sampai sini,
// simpan kodenya" -- BELUM worth kejar proxy residential berbayar.
//
// ✅ GANTI KE BYBIT 13 Sep 2026 -- riset lanjutan nemuin Bybit punya topik PUBLIK setara
// (`allLiquidation.{symbol}`, malah LEBIH LENGKAP dari Binance: push SEMUA liquidation event,
// bukan cuma 1 snapshot terbesar per detik). DIVERIFIKASI LANGSUNG dari VPS ini (SSH, bukan asumsi):
//   1. `allLiquidation.BTCUSDT` doang: 0 event dalam 5 menit -- awalnya keliatan mirip gejala
//      Binance (nyambung tapi gak ada data), TAPI...
//   2. Cross-check `publicTrade.BTCUSDT` bareng: 93 trade masuk normal dalam 5 menit yang SAMA
//      (match REST API ground-truth ~0,4 trade/detik) -- KONEKSI SEHAT, bukan diblokir.
//   3. Cross-check CoinGlass (coinglass.com/LiquidationData): BTC GAK MASUK top-liquidated-coins
//      1 jam terakhir sama sekali (market lagi kalem, ini konsisten sama priceAlertMonitor yang
//      nunjukin BTC 1h/24h nyaris 0%) -- 0 liquidation BTC emang WAJAR, bukan tanda diblokir.
//   4. Pembuktian FINAL: subscribe ke simbol yang KETAHUAN lagi aktif liquidasi (LSKUSDT, dari
//      CoinGlass real-time ticker) -- 6 pesan (multi-event tiap pesan) masuk LANCAR dalam 90 detik.
// Kesimpulan: kanal `allLiquidation` Bybit TIDAK diblokir dari IP datacenter/VPS -- beda nasib
// total dari Binance Futures. BTC yang 0 di 2 percobaan awal itu representasi JUJUR pasar lagi
// kalem, bukan bug/blokir.
//
// ⚠️ ARSITEKTUR BEDA dari SEMUA script lain di folder ini (yang cron-based, jalan-lalu-KELUAR
// tiap 5/15 menit) -- ini PROSES NYALA TERUS 24 JAM, dikelola systemd (lihat
// kaela-liquidation-listener.service), krn WebSocket butuh koneksi tetap kebuka buat nerima
// event real-time. JANGAN panggil dari run-vultr-executor.sh -- bakal numpuk proses ganda tiap
// siklus kalau ke situ.
//
// Bybit WAJIB client ping tiap ~20 detik (server nutup koneksi kalau diem >60 detik tanpa
// heartbeat) -- BEDA dari Binance yang server-side ping/pong otomatis di level protokol WS.
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

const WS_URL = 'wss://stream.bybit.com/v5/public/linear';
const SUBSCRIBE_TOPIC = 'allLiquidation.BTCUSDT';
const HEATMAP_PATH = path.join(__dirname, 'liquidation-heatmap.json');
const RAW_LOG_PATH = path.join(__dirname, 'liquidation-events.jsonl');
const MAX_RAW_LOG_LINES = 50000; // cap ukuran file (~beberapa hari data), dipangkas berkala
const TRIM_CHECK_EVERY = 2000;   // cek pangkas tiap N event baru (bukan tiap event, hemat I/O)
const STALE_MS = 90 * 1000;      // gak ada pesan sama sekali 90 detik -> anggap koneksi zombie, paksa reconnect
const RECONNECT_DELAY_MS = 3000;
const BUCKET_SIZE = { BTCUSDT: 250 }; // simbol lain: raw log tetap kesimpen, cuma gak diagregasi ke heatmap
const HEARTBEAT_LOG_INTERVAL_MS = 5 * 60 * 1000; // log status ke console, BEDA dari ping keep-alive di bawah
const PING_INTERVAL_MS = 20 * 1000; // wajib Bybit -- server nutup kalau diem >60 detik
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

// side 'SELL' = posisi LONG kena force-close (bursa jual paksa) -> tekanan harga TURUN.
// side 'BUY' = posisi SHORT kena force-close (bursa beli paksa balik) -> tekanan harga NAIK.
// (Bybit kirim 'Sell'/'Buy' kapital-awal-doang -- dinormalisasi ke UPPERCASE di pemanggil biar
// fungsi ini tetap sama persis kayak versi Binance lama, gak perlu diubah.)
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
      console.log('[LiquidationListener] Gak ada pesan >90 detik -- dianggap koneksi zombie, paksa reconnect.');
      ws.terminate();
    }
  }, 15000);

  // Bybit WAJIB client-initiated ping (beda dari Binance yang server-side otomatis) -- tanpa ini
  // koneksi ditutup paksa server setelah ~60 detik diam.
  const pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' }));
  }, PING_INTERVAL_MS);

  const heartbeatLog = setInterval(() => {
    console.log(`[LiquidationListener] Heartbeat -- masih hidup, terakhir terima pesan ${Math.round((Date.now() - lastMessageAt) / 1000)}s lalu.`);
  }, HEARTBEAT_LOG_INTERVAL_MS);

  ws.on('open', () => {
    console.log('[LiquidationListener] Koneksi kebuka, subscribe ke', SUBSCRIBE_TOPIC);
    ws.send(JSON.stringify({ op: 'subscribe', args: [SUBSCRIBE_TOPIC] }));
  });

  ws.on('message', (raw) => {
    lastMessageAt = Date.now();
    try {
      const msg = JSON.parse(raw.toString());
      // Balasan subscribe/pong -- bukan data liquidation, cukup dicatat "koneksi hidup" (udah
      // ditandai lastMessageAt di atas), gak ada yang diproses lebih lanjut.
      if (msg.op === 'pong' || msg.op === 'subscribe' || msg.success !== undefined) return;
      if (msg.topic !== SUBSCRIBE_TOPIC || !Array.isArray(msg.data)) return;

      for (const o of msg.data) {
        const entry = { symbol: o.s, side: String(o.S || '').toUpperCase(), price: parseFloat(o.p), qty: parseFloat(o.v), timestamp: o.T };
        appendRawLog(entry);
        maybeTrimRawLog();
        recordLiquidation(heatmap, entry);
        dirtyCount++;
      }
      if (dirtyCount >= FLUSH_EVERY_N_EVENTS) { saveHeatmap(heatmap); dirtyCount = 0; }
    } catch (e) {
      console.log('[LiquidationListener] Gagal proses pesan:', e.message);
    }
  });

  ws.on('error', (e) => console.log('[LiquidationListener] WS error:', e.message));

  ws.on('close', (code, reason) => {
    clearInterval(staleCheck);
    clearInterval(pingTimer);
    clearInterval(heartbeatLog);
    saveHeatmap(heatmap); // flush sisa yang belum ketulis
    console.log(`[LiquidationListener] Koneksi tertutup (code ${code}, ${reason}) -- reconnect dalam ${RECONNECT_DELAY_MS}ms.`);
    setTimeout(connect, RECONNECT_DELAY_MS);
  });
}

connect();

process.on('SIGTERM', () => { console.log('[LiquidationListener] SIGTERM diterima, keluar bersih.'); process.exit(0); });
process.on('SIGINT', () => { console.log('[LiquidationListener] SIGINT diterima, keluar bersih.'); process.exit(0); });
