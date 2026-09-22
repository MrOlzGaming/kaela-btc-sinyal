// channelBreakoutTrader.js (22 Sep 2026) -- eksekutor LIVE buat strategi "Channel Breakout"
// (BTCUSDT candle 5-menit) yang udah divalidasi lewat backtest 2-tahun: per-tahun konsisten,
// split-era hampir identik, sensitivitas parameter halus/monoton, direction-flip kuat (75%
// arah asli vs 22% dibalik), tahan fee (PF 2,99->2,70 net). Olan: "lanjut, biar aku pengen lihat
// langsung proses trading demo".
//
// ⚠️ DEMO-ONLY buat sekarang -- SENGAJA punya saklar SENDIRI (channel-breakout-config.json),
// TERPISAH dari killSwitch.js (live-trading-config.json) yang dipakai Sniper/Nyopet. Alasan:
// killSwitch.js itu SATU saklar GLOBAL buat SEMUA strategi -- kalau Olan nanti nyalain testnet:false
// buat Sniper/Nyopet (yang udah lama tervalidasi), strategi BARU ini otomatis ikut real TANPA
// keputusan sadar terpisah kalau numpang saklar yang sama. Channel-breakout WAJIB approval
// SENDIRI sebelum boleh nyentuh uang real, gak peduli status saklar strategi lain.
//
// ⚠️ CADENCE: modul ini dipanggil TIAP 1 MENIT (lihat run-channel-breakout-vultr.sh), BUKAN
// siklus 15-menit Nyopet biasa -- linimasa breakout+trailing-stop-nya sendiri berbasis candle
// 5-menit, kalau cuma dicek tiap 15 menit gap eksekusi-vs-backtest bisa signifikan (lihat diskusi
// sesi 22 Sep 2026). Channel/level TETAP dihitung dari candle 5-menit yang SUDAH CLOSED (persis
// logic backtest, chartPatterns.js detectChannel/channelLinesAt) -- yang beda cuma FREKUENSI CEK
// harga-sekarang-vs-level, bukan timeframe strateginya sendiri.
//
// VARIAN: TP TETAP dulu (bukan Trailing%, walau PF backtest-nya lebih rendah) -- exit logic-nya
// jauh lebih sederhana (SL/TP fix, gak perlu state trailing yang harus diupdate tiap cek), risiko
// bug wiring-exchange-pertama-kali lebih kecil. Trailing% nyusul SETELAH TP-tetap kebukti jalan
// mulus end-to-end di demo (persis pola "buktiin primitive dulu, baru fitur lebih kompleks" yang
// dipakai Nyopet v2 -- lihat komentar nyopetAutoTrader.js baris 25-33).

const fs = require('fs');
const path = require('path');
const { detectChannel, channelLinesAt } = require('./chartPatterns');
const { hitung: hitungExposure } = require('./calculator');
const binanceExecutorDefault = require('./binanceExecutor');
const { sendWhatsApp } = require('./fonnte');
const { localDateKey } = require('./config');
const { isInsufficientBalanceError } = require('./balanceAlert');
const { recordSkippedInsufficientBalance } = require('./channelBreakoutBalanceRecap');

const SYMBOL = 'BTCUSDT';
const CHANNEL_OPTS = { maxWidthAtrMultiple: 1.5 }; // SAMA PERSIS parameter yang divalidasi backtest (backtestNyopetChannelBreakoutOnly.js)
const TRADE_EXPIRY_MS = 100 * 5 * 60 * 1000; // 100 candle 5m -- SAMA `tradeExpiryBars` backtest
const MODAL_ACTIVE_FRACTION = 1 / 5; // SAMA konvensi "cheat exposure" Nyopet (nyopetAutoTrader.js MODAL_ACTIVE_FRACTION)

const CONFIG_PATH = path.join(__dirname, 'channel-breakout-config.json');
const JOURNAL_PATH = path.join(__dirname, 'channel-breakout-journal.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { enabled: false, testnet: true };
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return { enabled: false, testnet: true }; }
}

// testnet SELALU true kecuali DUA syarat eksplisit sekaligus: config testnet:false DAN
// allowReal:true (2 kunci sengaja, sama filosofi enabled/testnet terpisah di killSwitch.js --
// biar transisi ke uang asli SELALU keputusan sadar, bukan kecelakaan config).
function isChannelBreakoutTestnet(cfg) {
  return !(cfg.testnet === false && cfg.allowReal === true);
}

function loadJournal() {
  if (!fs.existsSync(JOURNAL_PATH)) return { channel: null, floating: null, closedCount: 0 };
  try { return JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8')); } catch { return { channel: null, floating: null, closedCount: 0 }; }
}

function saveJournal(j) {
  fs.writeFileSync(JOURNAL_PATH, JSON.stringify(j, null, 2));
}

async function fetchClosedCandles5m(count) {
  const { fetchWithRetry } = require('./httpRetry');
  const BASE = 'https://data-api.binance.vision/api/v3/klines';
  const res = await fetchWithRetry(`${BASE}?symbol=${SYMBOL}&interval=5m&limit=${count}`);
  const raw = await res.json();
  const nowMs = Date.now();
  // Buang candle TERAKHIR kalau belum closed (closeTime masih di masa depan) -- backtest cuma
  // pernah lihat candle yang UDAH selesai, live harus disiplin sama biar levelnya konsisten.
  return raw.map((c) => ({ openTime: c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], closeTime: c[6] })).filter((c) => c.closeTime <= nowMs);
}

// x diitung dari SELISIH WAKTU (bukan index array) -- robust lintas siklus walau candle array
// di-refetch ulang tiap panggilan (index array bakal beda-beda, waktu openTime candle awal channel
// TETAP sama). 300000ms = 1 candle 5-menit.
function channelLinesAtTime(channel, startCandleOpenTime, nowCandleOpenTime) {
  const x = (nowCandleOpenTime - startCandleOpenTime) / 300000;
  const top = channel.highReg.slope * x + channel.highReg.intercept;
  const bottom = channel.lowReg.slope * x + channel.lowReg.intercept;
  return { top, bottom };
}

function execFor(testnet) {
  // binanceExecutor.js wrapper module-level SELALU baca killSwitch.js GLOBAL buat testnet --
  // gak cocok buat saklar independen strategi ini, jadi bikin client SENDIRI via createBinanceClient
  // langsung (SAMA primitive, kredensial SAMA secrets.js via loadSecrets(), cuma `testnet` diambil
  // dari config lokal strategi ini, bukan killSwitch.js global).
  const { loadSecrets, createBinanceClient } = binanceExecutorDefault;
  const secrets = loadSecrets();
  return createBinanceClient({ apiKey: secrets.BINANCE_API_KEY, apiSecret: secrets.BINANCE_API_SECRET, testnet });
}

async function reportWa(msg) {
  const { sendWhatsAppToWibowo } = require('./wibowoNotify');
  await sendWhatsAppToWibowo(msg).catch((e) => console.log('[ChannelBreakout] Gagal kirim WA (dilewatin, dicoba lagi trade berikutnya):', e.message));
}

async function process() {
  const cfg = loadConfig();
  if (!cfg.enabled) { console.log('[ChannelBreakout] enabled:false di channel-breakout-config.json -- gak ngapa-ngapain.'); return; }
  const testnet = isChannelBreakoutTestnet(cfg);
  const exec = execFor(testnet);
  const journal = loadJournal();

  const candles = await fetchClosedCandles5m(200); // cukup buat channelLookbackRange maksimal (40) + expiry (100) + buffer
  if (candles.length < 50) { console.log('[ChannelBreakout] Candle kefetch kurang, skip siklus ini.'); return; }
  const lastCandle = candles[candles.length - 1];

  // === ADA POSISI FLOATING -- cek SL/TP dulu, JANGAN cari sinyal baru ===
  if (journal.floating) {
    const f = journal.floating;
    const priceRes = await fetch(`${testnet ? 'https://demo-fapi.binance.com' : 'https://fapi.binance.com'}/fapi/v1/ticker/price?symbol=${SYMBOL}`);
    const livePrice = parseFloat((await priceRes.json()).price);
    const hitSL = f.dir === 'long' ? livePrice <= f.sl : livePrice >= f.sl;
    const hitTP = f.dir === 'long' ? livePrice >= f.tp : livePrice <= f.tp;
    if (hitSL || hitTP) {
      const closed = await exec.emergencyCloseMarket({ symbol: SYMBOL, direction: f.dir === 'long' ? 'buy' : 'sell', quantity: f.quantity });
      const outcome = hitTP ? 'TP' : 'SL';
      const r = hitTP ? 1 : -1;
      journal.closedCount = (journal.closedCount || 0) + 1;
      console.log(`[ChannelBreakout] Posisi ditutup (${outcome}) @ ${livePrice}, r=${r}`);
      await reportWa(`🎯 *Channel Breakout ${testnet ? 'DEMO' : 'REAL'}* -- posisi ${f.dir === 'long' ? 'LONG' : 'SHORT'} ditutup *${outcome}*\nEntry: $${f.entryPrice.toFixed(2)} -> Exit: $${livePrice.toFixed(2)}\nTotal trade selesai: ${journal.closedCount}\n\n— Kaela`);
      journal.floating = null;
      journal.channel = null;
    } else {
      console.log(`[ChannelBreakout] Posisi floating masih jalan (${f.dir}, entry ${f.entryPrice}, SL ${f.sl}, TP ${f.tp}, harga sekarang ${livePrice}).`);
    }
    saveJournal(journal);
    return;
  }

  // === GAK ADA FLOATING -- channel aktif? cek breakout. kalau enggak, cari channel baru ===
  if (journal.channel) {
    const ch = journal.channel;
    if (Date.now() - ch.foundAtTime > TRADE_EXPIRY_MS) {
      console.log('[ChannelBreakout] Channel expired (100 candle lewat tanpa breakout), buang.');
      journal.channel = null;
      saveJournal(journal);
      return;
    }
    const { top, bottom } = channelLinesAtTime(ch.data, ch.startCandleOpenTime, lastCandle.openTime);
    const halfWidth = (top - bottom) / 2;
    if (halfWidth <= 0) { journal.channel = null; saveJournal(journal); return; }
    const breakoutUp = top + halfWidth;
    const breakoutDown = bottom - halfWidth;

    const priceRes = await fetch(`${testnet ? 'https://demo-fapi.binance.com' : 'https://fapi.binance.com'}/fapi/v1/ticker/price?symbol=${SYMBOL}`);
    const livePrice = parseFloat((await priceRes.json()).price);

    let dir = null, entryPrice = null;
    if (livePrice >= breakoutUp) { dir = 'long'; entryPrice = breakoutUp; }
    else if (livePrice <= breakoutDown) { dir = 'short'; entryPrice = breakoutDown; }

    // Konfirmasi 2x-cek (22 Sep 2026, permintaan Olan -- "candle 1 menit bisa bohong", khawatir
    // spike sesaat kepancing jadi entry) -- breakout HARUS masih valid di cek berikutnya (~1
    // menit lagi) baru beneran entry, BUKAN langsung entry di deteksi PERTAMA. Kalau ternyata
    // cuma spike sesaat (harga balik ke dalam channel sebelum cek berikutnya), `dir` bakal null
    // lagi next cycle -- pending dibuang otomatis (gak ada cleanup eksplisit dibutuhin).
    if (dir && !(ch.pendingBreakout && ch.pendingBreakout.dir === dir)) {
      journal.channel.pendingBreakout = { dir, entryPrice, sl: dir === 'long' ? entryPrice - halfWidth : entryPrice + halfWidth, tp: dir === 'long' ? entryPrice + halfWidth : entryPrice - halfWidth };
      console.log(`[ChannelBreakout] Breakout ${dir} terdeteksi @ ${livePrice}, TUNGGU konfirmasi 1 cek lagi sebelum entry.`);
      saveJournal(journal);
      return;
    }
    if (!dir) {
      if (ch.pendingBreakout) { delete journal.channel.pendingBreakout; saveJournal(journal); }
      dir = null; // pastikan gak lanjut ke blok entry di bawah
    }

    if (dir) {
      const sl = dir === 'long' ? entryPrice - halfWidth : entryPrice + halfWidth;
      const tp = dir === 'long' ? entryPrice + halfWidth : entryPrice - halfWidth;
      const balance = await exec.getAccountBalance('USDT');
      const modal = balance * MODAL_ACTIVE_FRACTION;
      const calc = hitungExposure({ modal, entry: entryPrice, stopLoss: sl, direction: dir === 'long' ? 'buy' : 'sell' });
      try {
        await exec.setIsolatedMargin(SYMBOL);
        await exec.setLeverage(SYMBOL, calc.leverage);
        const placed = await exec.placeMarketEntry({ symbol: SYMBOL, direction: dir === 'long' ? 'buy' : 'sell', notionalUsd: calc.nilaiPosisi, livePrice });
        journal.floating = { dir, entryPrice: livePrice, sl, tp, quantity: placed.executedQty ? parseFloat(placed.executedQty) : calc.nilaiPosisi / livePrice, openedAt: Date.now() };
        journal.channel = null;
        console.log(`[ChannelBreakout] Entry ${dir.toUpperCase()} @ ${livePrice} (level breakout teoritis: ${entryPrice.toFixed(2)}), SL ${sl.toFixed(2)}, TP ${tp.toFixed(2)}.`);
        await reportWa(`🚀 *Channel Breakout ${testnet ? 'DEMO' : 'REAL'}* -- posisi baru *${dir === 'long' ? 'LONG' : 'SHORT'}*\nEntry: $${livePrice.toFixed(2)} (level teoritis $${entryPrice.toFixed(2)})\nSL: $${sl.toFixed(2)} · TP: $${tp.toFixed(2)}\nLeverage: ${calc.leverage}x · Margin: $${calc.margin.toFixed(2)}\n\n— Kaela`);
      } catch (e) {
        if (!testnet && isInsufficientBalanceError(e.message)) {
          recordSkippedInsufficientBalance({ dir, entryPrice, sl, tp });
          console.log('[ChannelBreakout] Skip entry -- saldo real kurang (dicatat ke rekap harian, GAK kirim WA per-kejadian).');
          journal.channel = null;
        } else {
          console.log('[ChannelBreakout] Gagal buka posisi:', e.message);
          throw e;
        }
      }
    }
    saveJournal(journal);
    return;
  }

  const detected = detectChannel(candles, candles.length - 1, CHANNEL_OPTS);
  if (detected) {
    journal.channel = { data: detected, startCandleOpenTime: candles[detected.startIndex].openTime, foundAtTime: Date.now() };
    console.log(`[ChannelBreakout] Channel baru kedeteksi (lebar ${detected.spreadEnd.toFixed(2)}).`);
    saveJournal(journal);
  } else {
    console.log('[ChannelBreakout] Gak ada channel aktif saat ini.');
  }
}

module.exports = { process, isChannelBreakoutTestnet, loadConfig };

if (require.main === module) {
  process().catch((e) => { console.error('[ChannelBreakout] ERROR:', e.message, e.stack); process.exitCode = 1; });
}
