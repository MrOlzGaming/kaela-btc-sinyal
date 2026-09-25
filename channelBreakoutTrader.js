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
const crypto = require('crypto');
const { detectChannel, channelLinesAt } = require('./chartPatterns');
const { hitung: hitungExposure } = require('./calculator');
const bingxExecutorDefault = require('./bingxExecutor');
const { localDateKey } = require('./config');
const { isInsufficientBalanceError } = require('./balanceAlert');
const { recordSkippedInsufficientBalance } = require('./channelBreakoutBalanceRecap');
const { CLOSE_REASON_LABEL, KAELA_ACCESS_URL, formatAutoOpen, formatAutoClosed, formatWinRateLines, formatManualOpenAutoClosed, SYSTEM_LABEL } = require('./darkKaelaLog');
const { getUsdIdrRate } = require('./kaelaProTraderClient');
const { sendWhatsAppToSniperClub } = require('./fonnte');
const { sendWhatsAppToWibowo } = require('./wibowoNotify');

const SYMBOL = 'BTCUSDT'; // format Binance -- CUMA buat fetch candle publik (data-api.binance.vision, sumber data channel/backtest)
const EXEC_SYMBOL = 'BTC-USDT'; // format BingX (hyphen) -- dipakai SEMUA panggilan eksekusi (order/posisi/ticker)
const CHANNEL_OPTS = { maxWidthAtrMultiple: 1.5 }; // SAMA PERSIS parameter tervalidasi backtest
const TRADE_EXPIRY_MS = 100 * 5 * 60 * 1000; // 100 candle 5m -- SAMA `tradeExpiryBars` backtest
const MODAL_ACTIVE_FRACTION = 1 / 5; // SAMA konvensi "cheat exposure" Nyopet
const VARIANTS = ['tpFixed', 'trailing'];
// Badge exchange (23 Sep 2026, permintaan Olan: "badge exchange juga dipake di pesan buka tutup"
// -- setelah migrasi ke BingX) -- gaya SAMA kayak EXCHANGE_BADGE positionReconciler.js (Binance
// 🟨/MEXC 🔷), warna beda biar gampang dibedain sekilas.
const EXCHANGE_BADGE = '🟣 BingX';

const CONFIG_PATH = path.join(__dirname, 'channel-breakout-config.json');
const JOURNAL_PATH = path.join(__dirname, 'channel-breakout-journal.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { enabled: false, allowReal: false };
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return { enabled: false, allowReal: false }; }
}

// stats terpisah demo/real (23 Sep 2026, permintaan Olan: "tutup posisi sertakan winrate dan
// akumulasi profit") -- akun BEDA (modal beda), jadi win-rate/profit HARUS dihitung terpisah,
// gak boleh dicampur (demo pakai saldo testnet $5rb, real nanti modal beneran -- angka gabungan
// gak ada artinya).
function freshStats() { return { wins: 0, losses: 0, totalPnlUsd: 0 }; }
function defaultJournal() {
  return {
    tpFixed: { channel: null, floating: null, closedCount: 0, stats: { demo: freshStats(), real: freshStats() } },
    trailing: { channel: null, floating: null, closedCount: 0, stats: { demo: freshStats(), real: freshStats() } },
  };
}

function loadJournal() {
  if (!fs.existsSync(JOURNAL_PATH)) return defaultJournal();
  try {
    const j = JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8'));
    const merged = { ...defaultJournal(), ...j };
    // Merge SHALLOW doang gak cukup buat field baru DI DALAM tiap varian (mis. `stats`, ditambah
    // 23 Sep 2026) -- journal lama yang udah kesave duluan gak punya field itu, jadi WAJIB
    // isi ulang manual per-varian biar gak `undefined` pas dipakai (v.stats.demo.wins dst).
    for (const variant of VARIANTS) {
      merged[variant] = { ...defaultJournal()[variant], ...(j[variant] || {}) };
      merged[variant].stats = { demo: { ...freshStats(), ...(j[variant]?.stats?.demo || {}) }, real: { ...freshStats(), ...(j[variant]?.stats?.real || {}) } };
    }
    return merged;
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
  const res = await fetch(`${baseUrl}/openApi/swap/v1/ticker/price?symbol=${EXEC_SYMBOL}`);
  return parseFloat((await res.json()).data.price);
}

// x diitung dari SELISIH WAKTU (bukan index array) -- robust lintas siklus walau candle
// di-refetch ulang tiap panggilan.
function channelLinesAtTime(channel, startCandleOpenTime, nowOpenTime) {
  const x = (nowOpenTime - startCandleOpenTime) / 300000; // 300000ms = 1 candle 5-menit
  const top = channel.highReg.slope * x + channel.highReg.intercept;
  const bottom = channel.lowReg.slope * x + channel.lowReg.intercept;
  return { top, bottom };
}

// ⚠️ WAJIB 1 AKUN/API-KEY TERPISAH per (varian x demo/real) -- 23 Sep 2026, ketemu Olan sendiri
// ("kan mexc dan binance ga bisa buka 2 layer.. kayak mt5"). Binance/MEXC futures BUKAN kayak
// MT4/5 -- gak ada "ticket" independen, SEMUA order di 1 symbol digabung jadi 1 posisi. BingX
// SEMPET disangka beda ("Separate Isolated Margin Mode") -- TERNYATA SAMA (dites empiris 23 Sep
// 2026: 2 order arah sama via API TETAP digabung 1 posisi, fitur itu cuma app/web, gak ada
// parameter API publik). Jadi TETAP 4 SLOT KEY TERPISAH (2 varian x demo/real). Key yang belum
// diisi = variant itu OTOMATIS gak jalan (execFor return null, caller skip).
//
// MIGRASI ke BingX (23 Sep 2026) -- SEBELUMNYA numpang akun Sniper-Binance (BINANCE_API_KEY),
// collision SEPARATE dari masalah TP-Tetap/Trailing (numpang SNIPER, bukan cuma sesama Channel
// Breakout) -- lihat memori project-kaela-channel-breakout.md. Trailing (varian utama, DILAPORIN)
// sekarang pakai BINGX_API_KEY ("Kaela Access Real", akun Olan sendiri, testnet=demo VST BingX).
// TP Tetap (SILENT) masih nunggu akun BingX KEDUA (belum ada) -- tetap skip otomatis.
const VARIANT_SECRET_FIELDS = {
  trailing: { demo: ['BINGX_API_KEY', 'BINGX_API_SECRET'], real: ['BINGX_API_KEY_REAL', 'BINGX_API_SECRET_REAL'] },
  tpFixed: { demo: ['BINGX_API_KEY_TPFIXED_DEMO', 'BINGX_API_SECRET_TPFIXED_DEMO'], real: ['BINGX_API_KEY_TPFIXED_REAL', 'BINGX_API_SECRET_TPFIXED_REAL'] },
};

// Varian yang trading TERUS TAPI GAK KIRIM WA sama sekali -- murni buat perbandingan nanti
// (journal/log tetap kecatat lengkap, tinggal dibaca manual kapan Olan mau bandingin).
const SILENT_VARIANTS = new Set(['tpFixed']);

function execFor(variant, testnet) {
  const { loadSecrets, createBingxClient } = bingxExecutorDefault;
  const secrets = loadSecrets();
  const [keyField, secretField] = VARIANT_SECRET_FIELDS[variant][testnet ? 'demo' : 'real'];
  const apiKey = secrets[keyField], apiSecret = secrets[secretField];
  if (!apiKey || !apiSecret) return null; // akun buat (varian, mode) ini belum disiapin -- caller WAJIB skip
  return createBingxClient({ apiKey, apiSecret, testnet });
}

function baseUrlFor(testnet) {
  return testnet ? 'https://open-api-vst.bingx.com' : 'https://open-api.bingx.com';
}

// BingX: saldo demo (VST) namanya literal "VST", BUKAN "USDT" -- beda dari Binance yang testnet
// TETAP pakai nama asset asli. Real pakai "USDT" normal (Perpetual Futures BingX cuma dukung
// USDT-margined sekarang, per riset 23 Sep 2026).
function balanceAssetFor(testnet) {
  return testnet ? 'VST' : 'USDT';
}

// Buka 1 sub-posisi (demo ATAU real) -- implementasi ASLI ada di openSubPositionSafe (bawah),
// butuh param `testnet` eksplisit biar bisa nentuin baseUrl ticker yang bener (bukan nebak dari
// perbandingan instance exec, itu bug lama).

async function closeSubPosition(exec, dir, quantity) {
  return exec.emergencyCloseMarket({ symbol: EXEC_SYMBOL, direction: dir === 'long' ? 'buy' : 'sell', quantity });
}

// (23 Sep 2026, permintaan Olan: "sekarang demo juga selesaikan masalah tumpukan posisi, kita
// dah ada 2 tempat nih.. bisa aman kan?" -- abis dia sendiri tes buka/tutup manual di akun BingX
// yang SAMA dipakai Channel Breakout Trailing pas verifikasi live tadi) -- BingX "1 akun 1
// posisi" (dibuktikan empiris 23 Sep 2026, lihat komentar VARIANT_SECRET_FIELDS di atas): kalau
// ADA posisi manual nyangkut di akun ini pas Kaela mau entry baru, order Kaela bakal KEGABUNG jadi
// 1 posisi sama punya Olan (bukan reject/2 posisi terpisah) -- entry price/quantity kecampur,
// SL/TP/trailing yang dihitung dari sini jadi SALAH TOTAL. Fix: SEBELUM tiap entry baru, cek dulu
// akun bersih. PERSIS pola isKaelaOrder tri-state punya positionReconciler.js (true=punya Kaela
// sendiri cuma jurnal lupa krn mesin pindah leader, false=PASTI manual -> auto-close kebijakan
// Olan 19 Sep 2026, null=gak bisa dipastikan) -- BEDA dari reconciler yang jalan di SIKLUS
// TERPISAH (5/15 menit), di sini nempel LANGSUNG sebelum openSubPositionSafe biar gak ada window
// balapan antara "posisi nyasar ke-detect" dan "Kaela buka order baru".
// Return: 'clear' (aman langsung/abis dibersihin) atau 'unsafe' (JANGAN entry siklus ini).
async function checkAndClearStrayPosition(exec, idrRate) {
  let stray;
  try {
    stray = await exec.getPositionRisk(EXEC_SYMBOL);
  } catch (e) {
    console.log(`[ChannelBreakout] Gagal cek posisi nyasar (${EXCHANGE_BADGE}), skip entry siklus ini demi aman:`, e.message);
    return 'unsafe';
  }
  if (!stray || Math.abs(Number(stray.positionAmt)) === 0) return 'clear';

  let isKaelaOrder = null;
  try { isKaelaOrder = await exec.wasLastEntryOrderByKaela(EXEC_SYMBOL); }
  catch (e) { console.log(`[ChannelBreakout] Gagal cek asal posisi nyasar (${EXCHANGE_BADGE}):`, e.message); }

  if (isKaelaOrder === true) {
    // Punya Kaela sendiri, jurnal lokal doang yang lupa (mesin eksekutor pindah leader) -- JANGAN
    // digabung sotoy, tapi JUGA jangan auto-close punya sendiri. Skip aman siklus ini.
    console.log(`[ChannelBreakout] Posisi nyasar (${EXCHANGE_BADGE}) ternyata punya Kaela sendiri (jurnal lupa) -- skip entry siklus ini biar gak salah gabung.`);
    return 'unsafe';
  }

  if (isKaelaOrder === null) {
    // Gak bisa dipastikan (API gagal) -- default AMAN: JANGAN entry (resiko gabung kalau ternyata manual).
    console.log(`[ChannelBreakout] Posisi nyasar (${EXCHANGE_BADGE}) gak bisa dipastikan asalnya -- skip entry siklus ini (default aman).`);
    return 'unsafe';
  }

  // isKaelaOrder === false -- PASTI manual (dikonfirmasi ke exchange). Kebijakan Olan 19 Sep 2026
  // ("trading 100% ku serahkan ke Kaela... posisi non-Kaela boleh auto-close") berlaku sama di sini.
  const closeDirection = Number(stray.positionAmt) > 0 ? 'buy' : 'sell';
  try {
    await exec.emergencyCloseMarket({ symbol: EXEC_SYMBOL, direction: closeDirection, quantity: Math.abs(Number(stray.positionAmt)) });
  } catch (e) {
    console.log(`[ChannelBreakout] GAGAL nutup posisi nyasar (${EXCHANGE_BADGE}) -- skip entry siklus ini:`, e.message);
    return 'unsafe';
  }

  const msg = formatManualOpenAutoClosed({
    exchangeBadge: EXCHANGE_BADGE, symbol: EXEC_SYMBOL, direction: closeDirection,
    entryPrice: Number(stray.avgPrice), closePrice: Number(stray.markPrice) || Number(stray.avgPrice),
    leverage: Number(stray.leverage) || 0, marginUsd: Number(stray.margin) || 0,
    nilaiPosisi: Number(stray.positionValue) || 0, closePnlUsd: null,
  }, idrRate);
  console.log(`[ChannelBreakout] Posisi nyasar (${EXCHANGE_BADGE}, BUKAN order Kaela) ketemu di akun Channel Breakout -- ditutup paksa biar gak numpuk sama entry baru.`);
  await sendWhatsAppToWibowo(msg).catch((e) => console.log('[ChannelBreakout] Gagal kirim WA (posisi nyasar auto-closed):', e.message));
  return 'clear';
}

function variantLabel(variant) { return variant === 'tpFixed' ? 'TP Tetap' : 'Trailing Stop'; }

// 23 Sep 2026, REVISI TOTAL (Olan, 3x koreksi sampai kena): "mode ada Sniper ada Nyopet..
// channel breakout itu alasan buka posisi, trailing stop alasan tutup posisi channel breakout
// itu.. jadi sekarang ada 3 alasan buka posisi: pola pattern breakout, fvg, dan channel
// breakout." -- BUKAN badge/strategi terpisah. Reuse `formatAutoOpen`/`formatAutoClosed`
// (darkKaelaLog.js) LANGSUNG, SAMA PERSIS fungsi yang dipakai Nyopet chart-pattern/FVG -- badge
// jadi "🥷 NYOPET · Kaela BTC (Demo) #id" identik, alasan buka = `channel_breakout` (PATTERN_
// REASON_LABEL, key baru ke-3 setelah flag/wedge & fvg_bounce), alasan tutup = CB_SL/CB_TP/
// CB_TRAIL (CLOSE_REASON_LABEL, mekanisme beda dari SL/TRAIL Nyopet lama makanya kode terpisah).
function buildOpenMsg({ id, dir, entryPrice, sl, tp, margin, leverage, nilaiPosisi, idrRate, isDemo }) {
  const pos = { id, direction: dir === 'long' ? 'buy' : 'sell', entryPrice, tp, sl, marginUsd: margin, nilaiPosisi, leverage, mode: 'channel_breakout', assetLabel: 'BTC' };
  return formatAutoOpen(pos, new Date(), '', isDemo, idrRate, '', null, EXCHANGE_BADGE, SYSTEM_LABEL.NINJA);
}

// outcome mentah dari checkTpFixedHit/updateTrailing ('SL'/'TP'/'TRAIL') -> kode CB_ (darkKaelaLog.js)
function outcomeCodeFor(outcome) { return outcome === 'TP' ? 'CB_TP' : outcome === 'TRAIL' ? 'CB_TRAIL' : 'CB_SL'; }

// Win-rate+akumulasi (permintaan Olan: "tutup posisi sertakan winrate dan akumulasi profit") --
// Nyopet lama BELUM punya 2 baris ini, jadi DISISIPKAN ke output formatAutoClosed (bukan bikin
// template baru) tepat sebelum link, biar strukturnya tetap 1:1 sama Nyopet + tambahan.
function buildCloseMsg({ id, variant, dir, entryPrice, exitPrice, pnlUsd, stats, outcomeCode, idrRate, isDemo }) {
  const trade = { id, direction: dir, entryPrice, exitPrice, pnlUsd, pnlPct: null, mode: 'channel_breakout', assetLabel: 'BTC' };
  const base = formatAutoClosed(trade, new Date(), isDemo, CLOSE_REASON_LABEL[outcomeCode] || outcomeCode, idrRate, null, EXCHANGE_BADGE, SYSTEM_LABEL.NINJA);
  const extraLines = formatWinRateLines(stats, `${variantLabel(variant)} (${isDemo ? 'Demo' : 'Real'})`, idrRate);
  return base.replace(`🔗 ${KAELA_ACCESS_URL}`, extraLines + `🔗 ${KAELA_ACCESS_URL}`);
}

async function reportOpen({ id, dir, wibowoRoute, demo, real, sl, tp }) {
  const idrRate = await getUsdIdrRate().catch(() => null);

  const demoMsg = buildOpenMsg({ id, dir, entryPrice: demo.entryPrice, sl, tp, margin: demo.margin, leverage: demo.leverage, nilaiPosisi: demo.nilaiPosisi, idrRate, isDemo: true });
  await sendWhatsAppToSniperClub(demoMsg).catch((e) => console.log('[ChannelBreakout] Gagal kirim Sniper Club:', e.message));

  if (wibowoRoute === 'real' && real) {
    const realMsg = buildOpenMsg({ id, dir, entryPrice: real.entryPrice, sl, tp, margin: real.margin, leverage: real.leverage, nilaiPosisi: real.nilaiPosisi, idrRate, isDemo: false });
    await sendWhatsAppToWibowo(realMsg).catch((e) => console.log('[ChannelBreakout] Gagal kirim Wibowo (real):', e.message));
  } else {
    await sendWhatsAppToWibowo(`${demoMsg}\n_(real belum jalan/saldo kurang)_`).catch((e) => console.log('[ChannelBreakout] Gagal kirim Wibowo (demo pengganti):', e.message));
  }
}

async function reportClose({ id, variant, dir, wibowoRoute, outcome, demoExit, realExit, entryPriceDemo, entryPriceReal, demoPnlUsd, realPnlUsd, demoStats, realStats }) {
  const idrRate = await getUsdIdrRate().catch(() => null);
  const outcomeCode = outcomeCodeFor(outcome);

  const demoMsg = buildCloseMsg({ id, variant, dir, entryPrice: entryPriceDemo, exitPrice: demoExit, pnlUsd: demoPnlUsd, stats: demoStats, outcomeCode, idrRate, isDemo: true });
  await sendWhatsAppToSniperClub(demoMsg).catch((e) => console.log('[ChannelBreakout] Gagal kirim Sniper Club:', e.message));

  if (wibowoRoute === 'real' && realExit != null) {
    const realMsg = buildCloseMsg({ id, variant, dir, entryPrice: entryPriceReal, exitPrice: realExit, pnlUsd: realPnlUsd, stats: realStats, outcomeCode, idrRate, isDemo: false });
    await sendWhatsAppToWibowo(realMsg).catch((e) => console.log('[ChannelBreakout] Gagal kirim Wibowo (real):', e.message));
  } else {
    await sendWhatsAppToWibowo(`${demoMsg}\n_(real belum jalan/saldo kurang)_`).catch((e) => console.log('[ChannelBreakout] Gagal kirim Wibowo (demo pengganti):', e.message));
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
  const demoExec = execFor(variant, true);
  if (!demoExec) { console.log(`[ChannelBreakout/${variant}] Skip -- belum ada akun/API-key demo buat varian ini.`); return; }
  const realAvailable = cfg.allowReal === true;
  const realExec = realAvailable ? execFor(variant, false) : null; // null kalau key belum keisi meski allowReal:true

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

      // PnL$ + winrate + akumulasi (23 Sep 2026, permintaan Olan) -- dihitung TERPISAH demo/real
      // (modal beda akun, gak boleh dicampur -- lihat catatan freshStats()).
      const pnlSign = f.dir === 'long' ? 1 : -1;
      const demoPnlUsd = (f.demoExitPrice - f.demo.entryPrice) * f.demo.quantity * pnlSign;
      v.stats.demo.totalPnlUsd += demoPnlUsd;
      if (demoPnlUsd >= 0) v.stats.demo.wins += 1; else v.stats.demo.losses += 1;
      let realPnlUsd = null;
      if (f.real) {
        realPnlUsd = (f.realExitPrice - f.real.entryPrice) * f.real.quantity * pnlSign;
        v.stats.real.totalPnlUsd += realPnlUsd;
        if (realPnlUsd >= 0) v.stats.real.wins += 1; else v.stats.real.losses += 1;
      }

      if (SILENT_VARIANTS.has(variant)) {
        console.log(`[ChannelBreakout/${variant}] (SILENT, gak kirim WA) closed #${v.closedCount}: ${f.dir} ${f.demo.entryPrice} -> ${f.demoExitPrice} (pnl ${demoPnlUsd.toFixed(2)})`);
      } else {
        await reportClose({
          id: f.id, variant, dir: f.dir, wibowoRoute: f.wibowoRoute, outcome: demoHit || 'SL',
          demoExit: f.demoExitPrice, realExit: f.realExitPrice, entryPriceDemo: f.demo.entryPrice,
          entryPriceReal: f.real ? f.real.entryPrice : null,
          demoPnlUsd, realPnlUsd, demoStats: v.stats.demo, realStats: v.stats.real,
        });
      }
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

    // Cek akun bersih SEBELUM entry (23 Sep 2026, lihat komentar panjang checkAndClearStrayPosition
    // -- BingX gabung posisi manual+bot jadi 1 kalau dibiarin, "unsafe" = SKIP total siklus ini).
    const idrRateForClean = await getUsdIdrRate().catch(() => null);
    if ((await checkAndClearStrayPosition(demoExec, idrRateForClean)) === 'unsafe') {
      console.log(`[ChannelBreakout/${variant}] Skip entry DEMO siklus ini -- akun belum dipastikan bersih.`);
      return;
    }

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
    if (realAvailable && realExec && (await checkAndClearStrayPosition(realExec, idrRateForClean)) === 'unsafe') {
      console.log(`[ChannelBreakout/${variant}] Skip entry REAL siklus ini -- akun belum dipastikan bersih (demo tetap lanjut).`);
    } else if (realAvailable && realExec) {
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

    const tradeId = crypto.randomUUID(); // 1 ID per trade (permintaan Olan, samain gaya shortId Nyopet), dipakai konsisten di pesan buka+tutup
    v.floating = {
      id: tradeId, dir, sl, tp, trailDistancePct, wibowoRoute,
      demo: { ...demoResult, extreme: demoResult.entryPrice, sl: dir === 'long' ? demoResult.entryPrice - halfWidth : demoResult.entryPrice + halfWidth },
      real: realResult ? { ...realResult, extreme: realResult.entryPrice, sl: dir === 'long' ? realResult.entryPrice - halfWidth : realResult.entryPrice + halfWidth } : null,
    };
    v.channel = null;
    console.log(`[ChannelBreakout/${variant}] Entry ${dir.toUpperCase()} demo @ ${demoResult.entryPrice}${realResult ? ` + real @ ${realResult.entryPrice}` : ''}.`);
    if (SILENT_VARIANTS.has(variant)) {
      console.log(`[ChannelBreakout/${variant}] (SILENT, gak kirim WA)`);
    } else {
      await reportOpen({ id: tradeId, dir, wibowoRoute, demo: v.floating.demo, real: v.floating.real, sl, tp });
    }
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
  const balance = await exec.getAccountBalance(balanceAssetFor(testnet));
  const modal = balance * MODAL_ACTIVE_FRACTION;
  const calc = hitungExposure({ modal, entry: entryPriceTheoretical, stopLoss: sl, direction: dir === 'long' ? 'buy' : 'sell' });
  const positionSide = dir === 'long' ? 'LONG' : 'SHORT';
  await exec.setIsolatedMargin(EXEC_SYMBOL);
  await exec.setLeverage(EXEC_SYMBOL, calc.leverage, positionSide);
  const livePrice = await fetchLivePrice(baseUrlFor(testnet));
  const placed = await exec.placeMarketEntry({ symbol: EXEC_SYMBOL, direction: dir === 'long' ? 'buy' : 'sell', notionalUsd: calc.nilaiPosisi, livePrice });
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
