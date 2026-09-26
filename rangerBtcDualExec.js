// rangerBtcDualExec.js (26 Sep 2026) -- Demo+Real PARALEL buat leg BTC Ranger (chart-pattern+FVG,
// 2 slot independen yang udah ada di rangerAutoTrader.js). Ganti dari saklar tunggal
// (killSwitch.js `testnet`) yang cuma bisa ATAU demo ATAU real -- sekarang demo SELALU jalan +
// real jalan TAMBAHAN, pola PERSIS ninjaTrader.js (BingX Channel Breakout): 2 posisi independen
// per sinyal, `wibowoRoute` dikunci sekali pas entry (dipakai konsisten pas pesan buka MAUPUN
// tutup trade yang sama), demo SELALU lapor Sniper Club, real (kalau beneran kebuka) lapor Wibowo
// Hedgefund -- real gagal/gak dicoba -> pesan DEMO yang dikirim ke Wibowo sbg pengganti (silent,
// gak expose alasan operasional, SAMA kebijakan ninjaTrader.js 26 Sep 2026).
//
// FASE 1 dari 2 (lihat plan sesi ini) -- scope CUMA chart-pattern+FVG. Fed Dovish Grid (basket
// multi-layer, butuh exec SAMA persis lintas layer buat sinkron avg-price exchange, arsitektur
// exit beda total) SENGAJA GAK disentuh -- tetap jalur lama sepenuhnya
// (`_processFedDovishGridLocked`, rangerAutoTrader.js). Emas/MEXC juga gak disentuh (gak ada mode
// demo buat MEXC sama sekali).
//
// ⚠️ Kredensial: demo pakai BINANCE_API_KEY/_SECRET (testnet, SAMA yang dipakai luas di seluruh
// proyek ini). Real pakai BINANCE_API_KEY_REAL/_SECRET_REAL -- 26 Sep 2026, key ini SEKARANG
// eksklusif punya Ranger (Sniper MASIH pakai mekanisme singleton lama sampai Fase 2 -- lihat
// `live-trading-config.json`, `testnet` dibalikin ke `true` bareng rollout modul ini biar Sniper
// gak numpuk akun real yang sama).
//
// ⚠️ Numpuk sama Fed Dovish Grid (jalur LAMA, masih baca killSwitch.js global -> demo/BINANCE_API_KEY
// SAMA yang dipakai leg demo modul ini): tanpa saling cek, breakout chart-pattern/FVG (modul ini)
// dan Fed Grid bisa BARENGAN megang symbol BTCUSDC di akun demo yang SAMA -- Binance NETTING per
// simbol bakal nge-gabung jadi 1 posisi exchange walau 2 tracker beda ngira posisi masing-masing
// independen. Mutual exclusion 2 ARAH: `hasAnyFloatingSlot()` (diekspor, dicek dari
// `_processFedDovishGridLocked` sebelum buka basket baru) + `fedGridCurrentlyFloating()` (dicek di
// sini sebelum openRangerBtcDual) -- BUKAN cuma 1 arah kayak exclusivity lama (yang cuma ngecek di
// 1 journal doang, gak tau soal journal lain).
//
// ⚠️ Scope simplification SADAR drpd jalur lama (openPosition/closePosition/manageFloatingOrder di
// rangerAutoTrader.js): TIDAK ada rekonsiliasi offline via income-history (fetchRealizedPnlSince
// jumlah-sejak-triggeredAt + clamp) ATAU auto-adopt posisi nyasar ke journal -- SAMA persis
// arsitektur ninjaTrader.js (yang juga gak punya ini, murni cek getPositionRisk tiap siklus).
// Kalau posisi ternyata udah gak ada di exchange (kelikuidasi/ditutup offline lama), leg ditutup
// JUJUR (pnl null, style formatAutoClosedUntracked) -- BUKAN nebak PnL dari histori income.

const fs = require('fs');
const path = require('path');
const { sma } = require('./technicalAnalysis');
const { hitung: hitungExposure } = require('./calculator');
const binanceExecutorDefault = require('./binanceExecutor');
const { isBtcBearWindow, isBtcApproachingWindowFlip } = require('./halvingBearWindow');
const { isInsufficientBalanceError, formatInsufficientBalanceAlert, shouldAlertInsufficientBalance } = require('./balanceAlert');
const { CLOSE_REASON_LABEL, KAELA_ACCESS_URL, EXCHANGE_BADGE, SYSTEM_LABEL, formatAutoOpen, formatAutoPartial, formatAutoClosed, formatAutoClosedUntracked, formatWinRateLines } = require('./darkKaelaLog');
const { sendWhatsAppToSniperClub } = require('./fonnte');
const { sendWhatsAppToWibowo } = require('./wibowoNotify');
const { nextSignalId, dayKeyOf } = require('./signalIdGenerator');

const CONFIG_PATH = path.join(__dirname, 'ranger-btc-dual-exec-config.json');
const JOURNAL_PATH = path.join(__dirname, 'ranger-btc-dual-exec-journal.json');
const OLD_JOURNAL_PATH = path.join(__dirname, 'nyopet-journal.json'); // baca-doang, buat exclusivity Fed Grid
const SYMBOL = 'BTCUSDC'; // sama RANGER_ASSETS.btc.symbol
const MARGIN_ASSET = 'USDC';
const ZONE_SYMBOL = 'BTCUSDT'; // sama RANGER_ASSETS.btc.zoneSymbol -- candle publik buat trailing SMA/window
const MODAL_ACTIVE_FRACTION = 1 / 5; // SAMA konvensi "cheat exposure" seluruh proyek ini
const PARTIAL_RR = 2; // SAMA persis Ranger lama
const TRAIL_SMA_LEN_4H = 60; // SAMA persis Ranger lama
const FED_GRID_PATTERN_TYPE = 'fed_dovish_grid';
const ASSET_LABEL = 'BTCUSDC';

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { enabled: false, allowReal: false };
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return { enabled: false, allowReal: false }; }
}

function freshStats() { return { wins: 0, losses: 0, totalPnlUsd: 0 }; }
function freshSlot() { return { floating: null, closedCount: 0, stats: { demo: freshStats(), real: freshStats() }, dailySignalSeq: { dayKey: null, count: 0 } }; }
function defaultJournal() { return { pattern: freshSlot(), fvg: freshSlot() }; }

function loadJournal() {
  if (!fs.existsSync(JOURNAL_PATH)) return defaultJournal();
  try {
    const j = JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8'));
    const merged = {};
    for (const slotKey of ['pattern', 'fvg']) {
      merged[slotKey] = { ...freshSlot(), ...(j[slotKey] || {}) };
      merged[slotKey].stats = { demo: { ...freshStats(), ...(j[slotKey]?.stats?.demo || {}) }, real: { ...freshStats(), ...(j[slotKey]?.stats?.real || {}) } };
      merged[slotKey].dailySignalSeq = { dayKey: null, count: 0, ...(j[slotKey]?.dailySignalSeq || {}) };
    }
    return merged;
  } catch { return defaultJournal(); }
}
function saveJournal(j) { fs.writeFileSync(JOURNAL_PATH, JSON.stringify(j, null, 2)); }

function slotKeyFor(patternType) { return (patternType && patternType.startsWith('fvg')) ? 'fvg' : 'pattern'; }

function nextSlotSignalId(slot, date = new Date()) {
  const dayKey = dayKeyOf(date);
  if (!slot.dailySignalSeq || slot.dailySignalSeq.dayKey !== dayKey) slot.dailySignalSeq = { dayKey, count: 0 };
  const id = nextSignalId(slot.dailySignalSeq.count, date);
  slot.dailySignalSeq.count += 1;
  return id;
}

// ============ Exclusivity 2 arah sama Fed Dovish Grid (lihat catatan header) ============
function isSlotFree(slotKey) { return !loadJournal()[slotKey].floating; }
function hasAnyFloatingSlot() { const j = loadJournal(); return !!(j.pattern.floating || j.fvg.floating); }
function fedGridCurrentlyFloating() {
  if (!fs.existsSync(OLD_JOURNAL_PATH)) return false;
  try {
    const oldJ = JSON.parse(fs.readFileSync(OLD_JOURNAL_PATH, 'utf8'));
    return (oldJ.orders || []).some((o) => o.status === 'floating' && o.asset === 'btc' && o.patternType === FED_GRID_PATTERN_TYPE);
  } catch { return false; }
}

// ============ Exec per mode -- 2 instance TERPISAH TOTAL (kredensial beda, BUKAN 1 key beda baseUrl
// kayak BingX) ============
function execFor(mode) {
  const secrets = binanceExecutorDefault.loadSecrets();
  const apiKey = mode === 'real' ? secrets.BINANCE_API_KEY_REAL : secrets.BINANCE_API_KEY;
  const apiSecret = mode === 'real' ? secrets.BINANCE_API_SECRET_REAL : secrets.BINANCE_API_SECRET;
  if (!apiKey || !apiSecret) return null; // belum disiapin -- skip aman, SAMA pola execFor lain
  return binanceExecutorDefault.createBinanceClient({ apiKey, apiSecret, testnet: mode !== 'real' });
}
function baseUrlFor(mode) { return mode === 'real' ? 'https://fapi.binance.com' : 'https://demo-fapi.binance.com'; }

async function fetchLivePrice(mode) {
  const res = await fetch(`${baseUrlFor(mode)}/fapi/v1/ticker/price?symbol=${SYMBOL}`);
  return parseFloat((await res.json()).price);
}

// Candle publik 4H (data-api.binance.vision, SAMA sumber dipakai rangerAutoTrader.js) -- dipakai
// buat trailing-SMA60 exit, TIDAK terikat exec/kredensial manapun (data publik). Duplikasi SADAR
// dari `fetchCandles4hPaginated` (rangerAutoTrader.js) drpd require silang (circular -- file itu
// require modul ini juga) -- fungsi kecil murni, resiko drift rendah.
async function fetchCandles4hPaginated(symbol, count) {
  const { fetchWithRetry } = require('./httpRetry');
  const BASE = 'https://data-api.binance.vision/api/v3/klines';
  let all = [];
  let endTime = Date.now();
  while (all.length < count) {
    const res = await fetchWithRetry(`${BASE}?symbol=${symbol}&interval=4h&endTime=${endTime}&limit=1000`);
    const raw = await res.json();
    if (!raw.length) break;
    const parsed = raw.map((c) => ({ openTime: c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], closeTime: c[6] }));
    all = parsed.concat(all);
    endTime = parsed[0].openTime - 1;
    if (raw.length < 1000) break;
  }
  const nowMs = Date.now();
  return all.filter((c) => c.closeTime <= nowMs).slice(-count);
}

function badge(isDemo) { return EXCHANGE_BADGE.binance; }

// ============ Buka posisi (2 leg) ============
// `sig` = { direction:'buy'|'sell', sl, patternType } -- HASIL DETEKSI YANG UDAH LOLOS filter
// window/DXY di rangerAutoTrader.js (modul ini gak deteksi/filter ulang apa-apa).
async function openRangerBtcDual({ sig, livePrice }) {
  const cfg = loadConfig();
  const slotKey = slotKeyFor(sig.patternType);
  const journal = loadJournal();
  const slot = journal[slotKey];
  if (slot.floating) { console.log(`[RangerBtcDual/${slotKey}] Udah ada posisi floating, skip sinyal baru.`); return; }
  if (fedGridCurrentlyFloating()) { console.log(`[RangerBtcDual/${slotKey}] Fed Dovish Grid lagi pegang symbol ini (jalur lama) -- skip, cegah numpuk posisi.`); return; }

  const riskDistance = Math.abs(livePrice - sig.sl);
  if (riskDistance === 0) { console.log(`[RangerBtcDual/${slotKey}] riskDistance 0, skip.`); return; }
  const partialTp = sig.direction === 'buy' ? livePrice + riskDistance * PARTIAL_RR : livePrice - riskDistance * PARTIAL_RR;

  async function openLeg(exec, mode) {
    const balance = await exec.getAccountBalance(MARGIN_ASSET).catch(() => 0);
    const modal = (balance || 0) * MODAL_ACTIVE_FRACTION;
    const calc = hitungExposure({ modal, entry: livePrice, stopLoss: sig.sl, direction: sig.direction });
    if (calc.nilaiPosisi <= 0) return null;
    // Cek akun bersih sederhana (BUKAN full adopt-ke-journal ala jalur lama, lihat catatan header)
    // -- kalau exchange BENERAN udah punya posisi live di symbol ini yang jurnal modul ini gak
    // tau, JANGAN numpuk, skip leg ini siklus ini demi aman.
    const strayCheck = await exec.getPositionRisk(SYMBOL).catch(() => null);
    if (strayCheck && Math.abs(parseFloat(strayCheck.positionAmt)) > 0) {
      console.log(`[RangerBtcDual/${slotKey}] Akun ${mode} udah ada posisi live yang gak dikenal jurnal modul ini -- skip leg ${mode} siklus ini demi aman.`);
      return null;
    }
    await exec.setIsolatedMargin(SYMBOL).catch(() => {});
    await exec.setLeverage(SYMBOL, calc.leverage).catch(() => {});
    const entryOrder = await exec.placeMarketEntry({ symbol: SYMBOL, direction: sig.direction, notionalUsd: calc.nilaiPosisi, livePrice });
    const qty = parseFloat(entryOrder.executedQty);
    const entryPrice = parseFloat(entryOrder.avgPrice);
    return { entryPrice, qty, leverage: calc.leverage, margin: calc.margin, nilaiPosisi: calc.nilaiPosisi, currentSl: sig.sl, partialDone: false, remainingFraction: 1, realizedPnlUsd: 0 };
  }

  let demoResult = null;
  try {
    const demoExec = execFor('demo');
    if (!demoExec) { console.log(`[RangerBtcDual/${slotKey}] BINANCE_API_KEY demo belum disiapin -- skip total.`); return; }
    demoResult = await openLeg(demoExec, 'demo');
  } catch (e) {
    console.log(`[RangerBtcDual/${slotKey}] Gagal buka leg DEMO:`, e.message);
    return; // demo gagal -- jangan lanjut coba real, skip siklus ini (SAMA pola ninjaTrader.js)
  }
  if (!demoResult) return;

  let realResult = null;
  let wibowoRoute = 'demo';
  if (cfg.allowReal === true) {
    const realExec = execFor('real');
    if (realExec) {
      try {
        realResult = await openLeg(realExec, 'real');
        if (realResult) wibowoRoute = 'real';
      } catch (e) {
        if (isInsufficientBalanceError(e.message)) {
          const alertKey = 'ranger-btc-dual-real';
          if (shouldAlertInsufficientBalance(alertKey)) {
            await sendWhatsAppToWibowo(formatInsufficientBalanceAlert({ strategy: 'Ranger BTC (Real)', assetLabel: ASSET_LABEL, direction: sig.direction, entry: livePrice, tp: partialTp })).catch(() => {});
          }
          console.log(`[RangerBtcDual/${slotKey}] Real skip -- saldo kurang.`);
        } else {
          console.log(`[RangerBtcDual/${slotKey}] Real gagal (BUKAN saldo kurang -- perlu dicek):`, e.message);
        }
      }
    }
  }

  const tradeId = 'ranger-btc-dual-' + Date.now();
  const signalId = nextSlotSignalId(slot, new Date());
  slot.floating = {
    id: tradeId, signalId, direction: sig.direction, patternType: sig.patternType, sl: sig.sl, partialTp, wibowoRoute,
    manualReason: sig.manualReason || null, triggeredAt: new Date().toISOString(),
    demo: demoResult, real: realResult,
  };
  saveJournal(journal);
  console.log(`[RangerBtcDual/${slotKey}] Entry ${sig.direction.toUpperCase()} @ ${livePrice} -- demo @ ${demoResult.entryPrice}${realResult ? `, real @ ${realResult.entryPrice}` : ' (real skip)'}.`);

  const posBase = { id: tradeId, signalId, direction: sig.direction, sl: sig.sl, tp: partialTp, patternType: sig.patternType, mode: sig.patternType, manualReason: sig.manualReason, assetLabel: ASSET_LABEL };
  const demoMsg = formatAutoOpen({ ...posBase, entryPrice: demoResult.entryPrice, marginUsd: demoResult.margin, leverage: demoResult.leverage, nilaiPosisi: demoResult.nilaiPosisi }, new Date(), '', true, null, '', null, badge(true), SYSTEM_LABEL.RANGER);
  await sendWhatsAppToSniperClub(demoMsg).catch((e) => console.log(`[RangerBtcDual/${slotKey}] Gagal kirim Sniper Club:`, e.message));
  if (wibowoRoute === 'real') {
    const realMsg = formatAutoOpen({ ...posBase, entryPrice: realResult.entryPrice, marginUsd: realResult.margin, leverage: realResult.leverage, nilaiPosisi: realResult.nilaiPosisi }, new Date(), '', false, null, '', null, badge(false), SYSTEM_LABEL.RANGER);
    await sendWhatsAppToWibowo(realMsg).catch((e) => console.log(`[RangerBtcDual/${slotKey}] Gagal kirim Wibowo (real):`, e.message));
  } else {
    await sendWhatsAppToWibowo(demoMsg).catch((e) => console.log(`[RangerBtcDual/${slotKey}] Gagal kirim Wibowo (demo pengganti):`, e.message));
  }
}

// ============ Tutup 1 leg (partial ATAU penuh) -- helper dipakai monitor di bawah ============
async function closeLegPartial(mode, leg, sig) {
  const exec = execFor(mode);
  if (!exec) return leg; // key dicabut di tengah jalan -- gak bisa nutup, biarin (kasus ekstrem, log di caller)
  const partialQty = leg.qty * 0.5;
  const closeOrder = await exec.emergencyCloseMarket({ symbol: SYMBOL, direction: sig.direction, quantity: partialQty });
  const filledExit = parseFloat(closeOrder.avgPrice) || 0;
  const realizedPnlUsd = sig.direction === 'buy' ? (filledExit - leg.entryPrice) * partialQty : (leg.entryPrice - filledExit) * partialQty;
  return { ...leg, partialDone: true, remainingFraction: 0.5, currentSl: leg.entryPrice, realizedPnlUsd, partialClosedAt: new Date().toISOString() };
}

async function closeLegFull(mode, leg, sig) {
  const exec = execFor(mode);
  const remainingQty = leg.qty * (leg.remainingFraction != null ? leg.remainingFraction : 1);
  if (!exec) return { ...leg, closedAt: new Date().toISOString(), exitPrice: leg.currentSl, legPnlUsd: 0 };
  const closeOrder = await exec.emergencyCloseMarket({ symbol: SYMBOL, direction: sig.direction, quantity: remainingQty });
  let avgPrice = parseFloat(closeOrder.avgPrice);
  if (!avgPrice) avgPrice = await fetchLivePrice(mode); // fallback SAMA pola jalur lama -- JANGAN nebak dari SL
  const legPnlUsd = sig.direction === 'buy' ? (avgPrice - leg.entryPrice) * remainingQty : (leg.entryPrice - avgPrice) * remainingQty;
  return { ...leg, closedAt: new Date().toISOString(), exitPrice: avgPrice, legPnlUsd };
}

// ============ Monitor + tutup posisi -- dipanggil 1x per siklus, cek KEDUA slot ============
async function monitorRangerBtcDual({ idrRate } = {}) {
  const journal = loadJournal();
  let touched = false;
  for (const slotKey of ['pattern', 'fvg']) {
    const slot = journal[slotKey];
    const f = slot.floating;
    if (!f) continue;
    touched = true;
    await monitorOneSlot(slotKey, slot, f, idrRate);
  }
  if (touched) saveJournal(journal);
}

async function monitorOneSlot(slotKey, slot, f, idrRate) {
  const sig = { direction: f.direction, sl: f.sl };
  const activeLegs = ['demo', 'real'].filter((m) => f[m] && !f[m].closedAt);
  if (activeLegs.length === 0) { slot.floating = null; return; }

  // Harga per-mode (demo/real base URL beda-beda, SAMA pola ninjaTrader.js) -- cuma fetch yang
  // beneran dibutuhin (real gak pernah dibuka -> gak usah fetch harga real).
  const priceByMode = {};
  for (const m of activeLegs) priceByMode[m] = await fetchLivePrice(m).catch(() => null);

  // Window-flip force-close (13 Sep 2026 punya jalur lama) -- BTC-only, cek 1x per slot pakai
  // isBtcBearWindow (siklus halving, gak butuh candle).
  const bearNow = isBtcBearWindow(new Date());
  const wrongSide = (f.direction === 'buy' && bearNow) || (f.direction === 'sell' && !bearNow);

  // Trailing SMA (SHARED, market sama) -- cuma dihitung kalau ADA leg yang udah lewat partial.
  let trailBroken = null;
  const anyPastPartial = activeLegs.some((m) => f[m].partialDone);
  if (anyPastPartial && !wrongSide) {
    const candles = await fetchCandles4hPaginated(ZONE_SYMBOL, TRAIL_SMA_LEN_4H + 5).catch(() => []);
    const trailSma = sma(candles.map((c) => c.close), TRAIL_SMA_LEN_4H);
    if (trailSma !== null) {
      // Pakai harga leg demo sbg acuan cek trailing (SAMA utk demo&real -- perbedaan cuma beberapa
      // dolar, gak worth fetch/hitung 2x kondisi trigger yang sama persis).
      const refPrice = priceByMode.demo ?? priceByMode.real;
      if (refPrice != null) trailBroken = f.direction === 'buy' ? refPrice < trailSma : refPrice > trailSma;
    }
  }

  for (const mode of activeLegs) {
    const leg = f[mode];
    const livePrice = priceByMode[mode];
    if (livePrice == null) continue; // gagal fetch harga mode ini -- skip leg ini siklus ini, coba lagi siklus depan

    // Posisi udah gak ada di exchange (kelikuidasi/ditutup offline) -- tutup JUJUR, JANGAN nebak PnL.
    const exec = execFor(mode);
    if (exec) {
      const posRisk = await exec.getPositionRisk(SYMBOL).catch(() => undefined);
      const stillOpen = posRisk ? Math.abs(parseFloat(posRisk.positionAmt)) > 0 : false;
      if (posRisk !== undefined && !stillOpen) {
        f[mode] = { ...leg, closedAt: new Date().toISOString(), exitPrice: null, legPnlUsd: null, untracked: true };
        await reportClose(slotKey, slot, f, mode, 'OFFLINE_UNTRACKED', idrRate);
        continue;
      }
    }

    if (wrongSide) {
      f[mode] = await closeLegFull(mode, leg, sig);
      await reportClose(slotKey, slot, f, mode, 'WINDOW_FLIP', idrRate);
      continue;
    }

    if (!leg.partialDone) {
      const hitSl = sig.direction === 'buy' ? livePrice <= leg.currentSl : livePrice >= leg.currentSl;
      const hitPartial = sig.direction === 'buy' ? livePrice >= f.partialTp : livePrice <= f.partialTp;
      if (hitSl) { f[mode] = await closeLegFull(mode, leg, sig); await reportClose(slotKey, slot, f, mode, 'SL', idrRate); continue; }
      if (hitPartial) { f[mode] = await closeLegPartial(mode, leg, sig); await reportPartial(slotKey, f, mode, idrRate); continue; }
      continue;
    }

    const hitBreakevenSl = sig.direction === 'buy' ? livePrice <= leg.currentSl : livePrice >= leg.currentSl;
    if (hitBreakevenSl) { f[mode] = await closeLegFull(mode, leg, sig); await reportClose(slotKey, slot, f, mode, 'SL_BREAKEVEN', idrRate); continue; }
    if (trailBroken) { f[mode] = await closeLegFull(mode, leg, sig); await reportClose(slotKey, slot, f, mode, 'TRAIL', idrRate); continue; }
  }

  const allDone = ['demo', 'real'].every((m) => !f[m] || !!f[m].closedAt);
  if (allDone) { slot.closedCount = (slot.closedCount || 0) + 1; slot.floating = null; }
}

async function reportPartial(slotKey, f, mode, idrRate) {
  const leg = f[mode];
  const isDemo = mode !== 'real';
  const msg = formatAutoPartial({ id: f.id, signalId: f.signalId, realizedPnlUsd: leg.realizedPnlUsd, entryPrice: leg.entryPrice, assetLabel: ASSET_LABEL, patternType: f.patternType, mode: f.patternType }, new Date(), isDemo, idrRate, null, badge(isDemo), SYSTEM_LABEL.RANGER);
  const wantsThisMode = (mode === 'real') === (f.wibowoRoute === 'real');
  await sendWhatsAppToSniperClub(msg).catch((e) => console.log(`[RangerBtcDual/${slotKey}] Gagal kirim Sniper Club (partial):`, e.message));
  if (mode === 'demo' && f.wibowoRoute === 'demo') await sendWhatsAppToWibowo(msg).catch(() => {});
  if (mode === 'real' && f.wibowoRoute === 'real') await sendWhatsAppToWibowo(msg).catch(() => {});
}

async function reportClose(slotKey, slot, f, mode, reasonCode, idrRate) {
  const leg = f[mode];
  const isDemo = mode !== 'real';
  const stats = slot.stats[mode];

  if (leg.untracked) {
    const msg = formatAutoClosedUntracked({ id: f.id, direction: f.direction === 'buy' ? 'long' : 'short', assetLabel: ASSET_LABEL, entryPrice: leg.entryPrice }, isDemo, SYSTEM_LABEL.RANGER);
    if (mode === 'demo') await sendWhatsAppToSniperClub(msg).catch(() => {});
    if ((mode === 'real') === (f.wibowoRoute === 'real')) await sendWhatsAppToWibowo(msg).catch(() => {});
    return;
  }

  const totalPnlUsd = (leg.realizedPnlUsd || 0) + (leg.legPnlUsd || 0);
  const pnlPct = leg.margin ? (totalPnlUsd / leg.margin) * 100 : null;
  const won = totalPnlUsd >= 0;
  if (won) stats.wins += 1; else stats.losses += 1;
  stats.totalPnlUsd += totalPnlUsd;

  const alasanText = CLOSE_REASON_LABEL[reasonCode] || reasonCode;
  let msg = formatAutoClosed({ id: f.id, signalId: f.signalId, direction: f.direction === 'buy' ? 'long' : 'short', mode: f.patternType, entryPrice: leg.entryPrice, exitPrice: leg.exitPrice, pnlUsd: totalPnlUsd, pnlPct, assetLabel: ASSET_LABEL }, new Date(), isDemo, alasanText, idrRate, null, badge(isDemo), SYSTEM_LABEL.RANGER);
  const winRateLines = formatWinRateLines(stats, `Ranger ${ASSET_LABEL} (${isDemo ? 'Demo' : 'Real'})`, idrRate);
  msg = msg.replace(`🔗 ${KAELA_ACCESS_URL}`, winRateLines + `🔗 ${KAELA_ACCESS_URL}`);

  if (mode === 'demo') await sendWhatsAppToSniperClub(msg).catch((e) => console.log(`[RangerBtcDual/${slotKey}] Gagal kirim Sniper Club (close):`, e.message));
  if ((mode === 'real') === (f.wibowoRoute === 'real')) await sendWhatsAppToWibowo(msg).catch((e) => console.log(`[RangerBtcDual/${slotKey}] Gagal kirim Wibowo (close):`, e.message));
}

module.exports = { loadConfig, loadJournal, openRangerBtcDual, monitorRangerBtcDual, isSlotFree, hasAnyFloatingSlot, fedGridCurrentlyFloating };
