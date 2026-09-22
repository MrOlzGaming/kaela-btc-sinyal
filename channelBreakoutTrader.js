// channelBreakoutTrader.js (22-23 Sep 2026) -- eksekutor LIVE strategi "Channel Breakout"
// (BTCUSDT candle 5-menit), divalidasi backtest 2-tahun (lihat backtestNyopetChannelBreakout*.js):
// per-tahun konsisten, split-era hampir identik, sensitivitas parameter halus/monoton,
// direction-flip kuat (75% arah asli vs 22% dibalik), tahan fee (PF 2.99->2.70 net TP-tetap).
//
// ============ ARSITEKTUR (revisi 23 Sep 2026, permintaan Olan) ============
// 2 VARIAN jalan BERBARENGAN (bukan bertahap) -- "biar ketemu yang terbaik", entry SAMA PERSIS
// (channel/breakout SATU sumber deteksi per varian), exit BEDA:
//   - tpFixed  : SL/TP tetap 1:1 R:R (PF backtest 2.99)
//   - trailing : trailing stop % dari lebar channel (PF backtest 11.68)
// Journal 1 file, dipisah per key varian -- lihat DEFAULT_JOURNAL().
//
// DEMO + REAL BERBARENGAN (bukan gantian kayak killSwitch.js/Sniper/Nyopet lama) -- demo SELALU
// jalan (testnet, key BINANCE_API_KEY di secrets.js), real cuma jalan TAMBAHAN kalau
// `allowReal:true` DAN key BINANCE_API_KEY_REAL/SECRET_REAL keisi (dua syarat, 23 Sep 2026 --
// Olan belum topup, ditarget 5 Okt 2026). Makanya 2 field key TERPISAH di secrets.js, BUKAN
// gantian 1 field kayak strategi lama.
//
// ROUTING WA (permintaan Olan persis, 23 Sep 2026):
//   - Sniper Club  : SELALU dapet notif trade DEMO (buka+tutup), apapun status real.
//   - Wibowo Fam   : kalau real BERHASIL dibuka buat trade ini -> dapet notif REAL (bukan demo,
//                    biar gak dobel laporan 1 sinyal yang sama). Kalau real GAK dicoba
//                    (allowReal false) ATAU gagal krn saldo kurang -> dapet notif DEMO sbg
//                    pengganti (rekap saldo-kurang tetap jalan terpisah, TANPA WA per-kejadian,
//                    lihat channelBreakoutBalanceRecap.js). Keputusan "demo atau real yang
//                    dilaporin ke Wibowo" DIKUNCI sekali pas ENTRY (`wibowoRoute`), dipakai
//                    KONSISTEN buat notif buka MAUPUN tutup trade yang SAMA.
//
// CADENCE: dipanggil TIAP 1 MENIT (run-channel-breakout-vultr.sh), bukan siklus 15-menit Nyopet
// lama -- channel/level TETAP dari candle 5-menit closed (persis backtest), yang beda cuma
// frekuensi cek harga-sekarang-vs-level. Konfirmasi 2x-cek (permintaan Olan, "candle 1 menit bisa
// bohong") sebelum entry beneran, hindari kepancing spike sesaat.

const fs = require('fs');
const path = require('path');
const { detectChannel, channelLinesAt } = require('./chartPatterns');
const { hitung: hitungExposure } = require('./calculator');
const binanceExecutorDefault = require('./binanceExecutor');
const { localDateKey } = require('./config');
const { isInsufficientBalanceError } = require('./balanceAlert');
const { recordSkippedInsufficientBalance } = require('./channelBreakoutBalanceRecap');
const { fmtUsd, fmtUsdWithIdr } = require('./darkKaelaLog');
const { getUsdIdrRate } = require('./kaelaProTraderClient');
const { sendWhatsAppToSniperClub } = require('./fonnte');
const { sendWhatsAppToWibowo } = require('./wibowoNotify');

const SYMBOL = 'BTCUSDT';
const CHANNEL_OPTS = { maxWidthAtrMultiple: 1.5 }; // SAMA PERSIS parameter tervalidasi backtest
const TRADE_EXPIRY_MS = 100 * 5 * 60 * 1000; // 100 candle 5m -- SAMA `tradeExpiryBars` backtest
const MODAL_ACTIVE_FRACTION = 1 / 5; // SAMA konvensi "cheat exposure" Nyopet
const VARIANTS = ['tpFixed', 'trailing'];

const CONFIG_PATH = path.join(__dirname, 'channel-breakout-config.json');
const JOURNAL_PATH = path.join(__dirname, 'channel-breakout-journal.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { enabled: false, allowReal: false };
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return { enabled: false, allowReal: false }; }
}

function defaultJournal() {
  return { tpFixed: { channel: null, floating: null, closedCount: 0 }, trailing: { channel: null, floating: null, closedCount: 0 } };
}

function loadJournal() {
  if (!fs.existsSync(JOURNAL_PATH)) return defaultJournal();
  try {
    const j = JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8'));
    return { ...defaultJournal(), ...j };
  } catch { return defaultJournal(); }
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
  return raw.map((c) => ({ openTime: c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], closeTime: c[6] })).filter((c) => c.closeTime <= nowMs);
}

async function fetchLivePrice(baseUrl) {
  const res = await fetch(`${baseUrl}/fapi/v1/ticker/price?symbol=${SYMBOL}`);
  return parseFloat((await res.json()).price);
}

// x diitung dari SELISIH WAKTU (bukan index array) -- robust lintas siklus walau candle
// di-refetch ulang tiap panggilan.
function channelLinesAtTime(channel, startCandleOpenTime, nowOpenTime) {
  const x = (nowOpenTime - startCandleOpenTime) / 300000; // 300000ms = 1 candle 5-menit
  const top = channel.highReg.slope * x + channel.highReg.intercept;
  const bottom = channel.lowReg.slope * x + channel.lowReg.intercept;
  return { top, bottom };
}

function execFor(testnet) {
  const { loadSecrets, createBinanceClient } = binanceExecutorDefault;
  const secrets = loadSecrets();
  if (testnet) return createBinanceClient({ apiKey: secrets.BINANCE_API_KEY, apiSecret: secrets.BINANCE_API_SECRET, testnet: true });
  if (!secrets.BINANCE_API_KEY_REAL || !secrets.BINANCE_API_SECRET_REAL) return null; // real belum ada key -- caller WAJIB cek null sebelum pakai
  return createBinanceClient({ apiKey: secrets.BINANCE_API_KEY_REAL, apiSecret: secrets.BINANCE_API_SECRET_REAL, testnet: false });
}

function baseUrlFor(testnet) {
  return testnet ? 'https://demo-fapi.binance.com' : 'https://fapi.binance.com';
}

// Buka 1 sub-posisi (demo ATAU real) -- implementasi ASLI ada di openSubPositionSafe (bawah),
// butuh param `testnet` eksplisit biar bisa nentuin baseUrl ticker yang bener (bukan nebak dari
// perbandingan instance exec, itu bug lama).

async function closeSubPosition(exec, dir, quantity) {
  return exec.emergencyCloseMarket({ symbol: SYMBOL, direction: dir === 'long' ? 'buy' : 'sell', quantity });
}

function variantLabel(variant) { return variant === 'tpFixed' ? 'TP Tetap' : 'Trailing Stop'; }

async function reportOpen({ variant, dir, wibowoRoute, demo, real, sl, tp, entryPriceTheoretical }) {
  const idrRate = await getUsdIdrRate().catch(() => null);
  const dirLabel = dir === 'long' ? 'LONG' : 'SHORT';
  const label = variantLabel(variant);

  const demoMsg = `🚀 *Channel Breakout ${label} DEMO* -- posisi baru *${dirLabel}*\nEntry: ${fmtUsd(demo.entryPrice)} (level teoritis ${fmtUsd(entryPriceTheoretical)})\n${tp != null ? `SL: ${fmtUsd(sl)} · TP: ${fmtUsd(tp)}` : `SL awal: ${fmtUsd(sl)} (trailing)`}\nMargin: ${fmtUsdWithIdr(demo.margin, idrRate)} (${demo.leverage}x)\nNilai Investasi: ${fmtUsdWithIdr(demo.nilaiPosisi, idrRate)}\n\n— Kaela`;
  await sendWhatsAppToSniperClub(demoMsg).catch((e) => console.log('[ChannelBreakout] Gagal kirim Sniper Club:', e.message));

  if (wibowoRoute === 'real' && real) {
    const realMsg = `🚀 *Channel Breakout ${label} REAL* -- posisi baru *${dirLabel}*\nEntry: ${fmtUsd(real.entryPrice)} (level teoritis ${fmtUsd(entryPriceTheoretical)})\n${tp != null ? `SL: ${fmtUsd(sl)} · TP: ${fmtUsd(tp)}` : `SL awal: ${fmtUsd(sl)} (trailing)`}\nMargin: ${fmtUsdWithIdr(real.margin, idrRate)} (${real.leverage}x)\nNilai Investasi: ${fmtUsdWithIdr(real.nilaiPosisi, idrRate)}\n\n— Kaela`;
    await sendWhatsAppToWibowo(realMsg).catch((e) => console.log('[ChannelBreakout] Gagal kirim Wibowo (real):', e.message));
  } else {
    await sendWhatsAppToWibowo(demoMsg.replace('DEMO*', 'DEMO* _(real belum jalan/saldo kurang)_')).catch((e) => console.log('[ChannelBreakout] Gagal kirim Wibowo (demo pengganti):', e.message));
  }
}

async function reportClose({ variant, dir, wibowoRoute, outcome, demoExit, realExit, entryPriceDemo, entryPriceReal, closedCount }) {
  const dirLabel = dir === 'long' ? 'LONG' : 'SHORT';
  const label = variantLabel(variant);

  const demoMsg = `🎯 *Channel Breakout ${label} DEMO* -- posisi ${dirLabel} ditutup *${outcome}*\nEntry: ${fmtUsd(entryPriceDemo)} -> Exit: ${fmtUsd(demoExit)}\nTotal trade ${label} selesai: ${closedCount}\n\n— Kaela`;
  await sendWhatsAppToSniperClub(demoMsg).catch((e) => console.log('[ChannelBreakout] Gagal kirim Sniper Club:', e.message));

  if (wibowoRoute === 'real' && realExit != null) {
    const realMsg = `🎯 *Channel Breakout ${label} REAL* -- posisi ${dirLabel} ditutup *${outcome}*\nEntry: ${fmtUsd(entryPriceReal)} -> Exit: ${fmtUsd(realExit)}\nTotal trade ${label} selesai: ${closedCount}\n\n— Kaela`;
    await sendWhatsAppToWibowo(realMsg).catch((e) => console.log('[ChannelBreakout] Gagal kirim Wibowo (real):', e.message));
  } else {
    await sendWhatsAppToWibowo(demoMsg.replace('DEMO*', 'DEMO* _(real belum jalan/saldo kurang)_')).catch((e) => console.log('[ChannelBreakout] Gagal kirim Wibowo (demo pengganti):', e.message));
  }
}

// ============ Exit check per varian ============

function checkTpFixedHit(sub, dir, sl, tp, livePrice) {
  const hitSL = dir === 'long' ? livePrice <= sl : livePrice >= sl;
  const hitTP = dir === 'long' ? livePrice >= tp : livePrice <= tp;
  if (hitSL) return 'SL';
  if (hitTP) return 'TP';
  return null;
}

// Trailing live -- SAMA formula simulateTrailingLegPct (backtestNyopetChannelBreakoutTrailing.js),
// diupdate tiap cek (1 menit) pakai harga sekarang, bukan candle high/low.
function updateTrailing(sub, dir, trailDistancePct, livePrice) {
  if (dir === 'long') {
    if (livePrice > sub.extreme) { sub.extreme = livePrice; sub.sl = Math.max(sub.sl, sub.extreme * (1 - trailDistancePct / 100)); }
    return livePrice <= sub.sl;
  }
  if (livePrice < sub.extreme) { sub.extreme = livePrice; sub.sl = Math.min(sub.sl, sub.extreme * (1 + trailDistancePct / 100)); }
  return livePrice >= sub.sl;
}

// ============ Proses 1 varian ============

async function processVariant(variant, journal, cfg, candles, lastCandle) {
  const v = journal[variant];
  const demoExec = execFor(true);
  const realAvailable = cfg.allowReal === true;
  const realExec = realAvailable ? execFor(false) : null; // null kalau key belum keisi meski allowReal:true

  // === ADA POSISI FLOATING -- cek exit dulu ===
  if (v.floating) {
    const f = v.floating;
    const demoPrice = await fetchLivePrice(baseUrlFor(true));

    let demoHit = null;
    if (variant === 'tpFixed') demoHit = checkTpFixedHit(f.demo, f.dir, f.sl, f.tp, demoPrice);
    else if (updateTrailing(f.demo, f.dir, f.trailDistancePct, demoPrice)) demoHit = 'TRAIL';

    let realHit = null;
    let realExitPrice = null;
    // ⚠️ KETERBATASAN DIKETAHUI: kalau allowReal/key REAL diubah SAAT posisi real masih floating,
    // realExec di sini bisa jadi null dan posisi real itu gak lagi dipantau/ditutup otomatis dari
    // sini (harus dicek manual di exchange). Rendah risiko selama allowReal cuma diubah pas GAK
    // ada posisi terbuka (kebiasaan yang sama dipegang di killSwitch.js), TAPI dicatat di sini
    // biar gak kelupaan kalau nanti muncul kasusnya.
    if (f.real && realExec) {
      const realPrice = await fetchLivePrice(baseUrlFor(false));
      if (variant === 'tpFixed') realHit = checkTpFixedHit(f.real, f.dir, f.sl, f.tp, realPrice);
      else if (updateTrailing(f.real, f.dir, f.trailDistancePct, realPrice)) realHit = 'TRAIL';
      if (realHit) realExitPrice = realPrice;
    }

    if (demoHit && !f.demoClosedAt) {
      await closeSubPosition(demoExec, f.dir, f.demo.quantity);
      f.demoClosedAt = Date.now();
      f.demoExitPrice = demoPrice;
      console.log(`[ChannelBreakout/${variant}] DEMO ditutup (${demoHit}) @ ${demoPrice}.`);
    }
    if (f.real && realHit && !f.realClosedAt) {
      await closeSubPosition(realExec, f.dir, f.real.quantity);
      f.realClosedAt = Date.now();
      f.realExitPrice = realExitPrice;
      console.log(`[ChannelBreakout/${variant}] REAL ditutup (${realHit}) @ ${realExitPrice}.`);
    }

    const demoDone = !!f.demoClosedAt;
    const realDone = !f.real || !!f.realClosedAt;
    if (demoDone && realDone) {
      v.closedCount = (v.closedCount || 0) + 1;
      await reportClose({
        variant, dir: f.dir, wibowoRoute: f.wibowoRoute, outcome: demoHit || 'SL',
        demoExit: f.demoExitPrice, realExit: f.realExitPrice, entryPriceDemo: f.demo.entryPrice,
        entryPriceReal: f.real ? f.real.entryPrice : null, closedCount: v.closedCount,
      });
      v.floating = null;
      v.channel = null;
    }
    return;
  }

  // === GAK ADA FLOATING -- channel aktif? cek breakout ===
  if (v.channel) {
    const ch = v.channel;
    if (Date.now() - ch.foundAtTime > TRADE_EXPIRY_MS) { v.channel = null; return; }

    const { top, bottom } = channelLinesAtTime(ch.data, ch.startCandleOpenTime, lastCandle.openTime);
    const halfWidth = (top - bottom) / 2;
    if (halfWidth <= 0) { v.channel = null; return; }
    const breakoutUp = top + halfWidth;
    const breakoutDown = bottom - halfWidth;

    const livePrice = await fetchLivePrice(baseUrlFor(true)); // level breakout dari harga demo (sama pasar, cukup 1x fetch buat deteksi)
    let dir = null, entryPriceTheoretical = null;
    if (livePrice >= breakoutUp) { dir = 'long'; entryPriceTheoretical = breakoutUp; }
    else if (livePrice <= breakoutDown) { dir = 'short'; entryPriceTheoretical = breakoutDown; }

    // Konfirmasi 2x-cek (permintaan Olan -- "candle 1 menit bisa bohong") sebelum entry beneran.
    if (dir && !(ch.pendingBreakout && ch.pendingBreakout.dir === dir)) {
      ch.pendingBreakout = { dir, entryPriceTheoretical };
      console.log(`[ChannelBreakout/${variant}] Breakout ${dir} terdeteksi @ ${livePrice}, tunggu konfirmasi.`);
      return;
    }
    if (!dir) {
      if (ch.pendingBreakout) delete ch.pendingBreakout;
      return;
    }

    const sl = dir === 'long' ? entryPriceTheoretical - halfWidth : entryPriceTheoretical + halfWidth;
    const tp = variant === 'tpFixed' ? (dir === 'long' ? entryPriceTheoretical + halfWidth : entryPriceTheoretical - halfWidth) : null;
    const trailDistancePct = variant === 'trailing' ? (halfWidth / entryPriceTheoretical) * 100 : null;

    let demoResult;
    try {
      demoResult = await openSubPositionSafe(demoExec, true, dir, sl, entryPriceTheoretical);
    } catch (e) {
      console.log(`[ChannelBreakout/${variant}] Gagal entry DEMO:`, e.message);
      v.channel = null;
      return; // demo gagal (bug/network) -- jangan lanjut coba real, skip siklus ini
    }

    let realResult = null;
    let wibowoRoute = 'demo';
    if (realAvailable && realExec) {
      try {
        realResult = await openSubPositionSafe(realExec, false, dir, sl, entryPriceTheoretical);
        wibowoRoute = 'real';
      } catch (e) {
        if (isInsufficientBalanceError(e.message)) {
          recordSkippedInsufficientBalance({ dir, entryPrice: entryPriceTheoretical, sl, tp });
          console.log(`[ChannelBreakout/${variant}] Real skip -- saldo kurang (dicatat ke rekap harian).`);
        } else {
          console.log(`[ChannelBreakout/${variant}] Real gagal (BUKAN saldo kurang -- perlu dicek):`, e.message);
        }
        wibowoRoute = 'demo';
      }
    }

    v.floating = {
      dir, sl, tp, trailDistancePct, wibowoRoute,
      demo: { ...demoResult, extreme: demoResult.entryPrice, sl: dir === 'long' ? demoResult.entryPrice - halfWidth : demoResult.entryPrice + halfWidth },
      real: realResult ? { ...realResult, extreme: realResult.entryPrice, sl: dir === 'long' ? realResult.entryPrice - halfWidth : realResult.entryPrice + halfWidth } : null,
    };
    v.channel = null;
    console.log(`[ChannelBreakout/${variant}] Entry ${dir.toUpperCase()} demo @ ${demoResult.entryPrice}${realResult ? ` + real @ ${realResult.entryPrice}` : ''}.`);
    await reportOpen({ variant, dir, wibowoRoute, demo: v.floating.demo, real: v.floating.real, sl, tp, entryPriceTheoretical });
    return;
  }

  const detected = detectChannel(candles, candles.length - 1, CHANNEL_OPTS);
  if (detected) {
    v.channel = { data: detected, startCandleOpenTime: candles[detected.startIndex].openTime, foundAtTime: Date.now() };
    console.log(`[ChannelBreakout/${variant}] Channel baru kedeteksi (lebar ${detected.spreadEnd.toFixed(2)}).`);
  }
}

// Wrapper openSubPosition -- versi awal (di atas) fetch livePrice pakai trik `exec===execFor(true)`
// yang RAPUH (bikin instance baru tiap panggil, perbandingan objek gak pernah match) -- fix di sini
// pakai param testnet eksplisit, JANGAN pakai openSubPosition yang lama langsung.
async function openSubPositionSafe(exec, testnet, dir, sl, entryPriceTheoretical) {
  const balance = await exec.getAccountBalance('USDT');
  const modal = balance * MODAL_ACTIVE_FRACTION;
  const calc = hitungExposure({ modal, entry: entryPriceTheoretical, stopLoss: sl, direction: dir === 'long' ? 'buy' : 'sell' });
  await exec.setIsolatedMargin(SYMBOL);
  await exec.setLeverage(SYMBOL, calc.leverage);
  const livePrice = await fetchLivePrice(baseUrlFor(testnet));
  const placed = await exec.placeMarketEntry({ symbol: SYMBOL, direction: dir === 'long' ? 'buy' : 'sell', notionalUsd: calc.nilaiPosisi, livePrice });
  const quantity = placed.executedQty ? parseFloat(placed.executedQty) : calc.nilaiPosisi / livePrice;
  return { entryPrice: livePrice, quantity, leverage: calc.leverage, margin: calc.margin, nilaiPosisi: calc.nilaiPosisi, openedAt: Date.now() };
}

async function process() {
  const cfg = loadConfig();
  if (!cfg.enabled) { console.log('[ChannelBreakout] enabled:false -- gak ngapa-ngapain.'); return; }
  const journal = loadJournal();
  const candles = await fetchClosedCandles5m(200);
  if (candles.length < 50) { console.log('[ChannelBreakout] Candle kefetch kurang, skip siklus ini.'); return; }
  const lastCandle = candles[candles.length - 1];

  for (const variant of VARIANTS) {
    try {
      await processVariant(variant, journal, cfg, candles, lastCandle);
    } catch (e) {
      console.log(`[ChannelBreakout/${variant}] ERROR:`, e.message);
    }
  }
  saveJournal(journal);
}

module.exports = { process, loadConfig };

if (require.main === module) {
  process().catch((e) => { console.error('[ChannelBreakout] ERROR:', e.message, e.stack); process.exitCode = 1; });
}
