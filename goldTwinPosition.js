// goldTwinPosition.js (26 Sep 2026) -- Twin-position Emas buat Ranger (4-jam) & Sniper (harian).
// 1 sinyal (dari deteksi chart-pattern/FVG yang UDAH ADA di rangerAutoTrader.js/
// sniperAutoAnalysis.js, TERMASUK filter DXY yang udah lolos live) buka 2 POSISI SEKALIGUS, modal
// dibagi 50/50, exit BEDA:
//   - Leg TRAILING : ratchet stop (SAMA logika masterRuleTrailingInvalidation.js, versi LIVE per-
//                    tick bukan per-candle) -- exchange SAMA kayak yang UDAH jalan sekarang (MEXC,
//                    lewat execFor(assetCfg) punya caller) -- REAL DOANG (MEXC gak punya demo).
//   - Leg FIXED_TP : target keras 3:1 R:R, full-close SEKALI kena -- exchange Bitget (lihat
//                    bitgetExecutor.js).
//
// ⚠️ RISET EXCHANGE KEDUA (26 Sep 2026, jangan diulang -- 2 dead-end ketemu sebelum Bitget):
//   1. Bybit DICOBA duluan (sampe sempet bikin BYBIT_API_KEY_DEMO segala di secrets.js) --
//      TERNYATA gak punya produk Emas SAMA SEKALI (nol simbol PAXG/XAU/GOLD di /v5/market/
//      instruments-info, category linear MAUPUN inverse, dites langsung ke API). Dibatalkan total.
//   2. Bitget PUNYA produk Emas real (PAXGUSDT/XAUTUSDT/XAUUSDT, semua status normal, dites
//      empiris) -- DIPILIH. TAPI Demo Trading Bitget-nya SENDIRI TERNYATA JUGA gak cover Emas
//      (productType SUSDT-FUTURES cuma 3 simbol: SBTCSUSDT/SETHSUSDT/SXRPSUSDT).
// Kesimpulan: TIDAK ADA exchange manapun yang punya demo-trading ASLI buat Emas (beda dari Ninja/
// BingX yang demo-nya genuinely exchange asli). Leg FixedTP fase evaluasi (allowReal:false) WAJIB
// paper/simulasi lokal, SAMA kayak leg Trailing -- BUKAN eksekusi ke exchange manapun.
//
// Riset backtest (25-26 Sep 2026, backtest/rangerTwinPositionBacktest.js + filter DXY dipasang
// manual buat tes): PF-net Trailing 1,79 / FixedTP 2,38 lintas 2020-2026, split-era DUA-DUANYA
// positif ($100->$145 era1, $100->$418 era2) -- jauh lebih tahan lintas rezim drpd versi tanpa
// filter DXY (yang cuma 3 dari 7 tahun untung). TETAP ada tahun rugi (2026 parsial, -20%) --
// BUKAN mesin ajaib.
//
// ⚠️ DEFAULT AMAN (gold-twin-position-config.json): enabled:false -- caller (rangerAutoTrader.js)
// TETAP jalanin openPosition() versi lama 100% gak berubah selama ini false. Begitu enabled:true:
//   - allowReal:false (default) -> KEDUA leg PAPER/SIMULASI MURNI, livePrice publik doang, NOL
//     panggilan exchange -- gak ada demo asli yang bisa dipakai (lihat riset di atas). Trading
//     real Gold versi LAMA otomatis PAUSE selama fase ini (caller berhenti manggil openPosition
//     lama, gantiin modul ini) -- keputusan sadar Olan lewat kapan dia enable, bukan kecelakaan.
//   - allowReal:true -> Leg Trailing REAL ke MEXC (persis akun/wallet yang udah dipakai gold
//     sekarang), Leg FixedTP REAL ke Bitget KALAU BITGET_API_KEY ada (skip aman kalau kosong,
//     sama pola execFor return-null di seluruh proyek ini).
// Setiap leg nyimpen `execMode` sendiri ('paper'/'mexc-real'/'bitget-real') di journal pas open --
// dipakai monitor buat mutusin exec mana yang dipanggil pas close (SUMBER KEBENARAN dari journal,
// bukan baca ulang config, biar konsisten walau config keubah pas posisi floating).
//
// Journal per SYSTEM (biar Sniper/Ranger gak numpuk data), 1 slot floating per system (assetKey
// SELALU 'xau' -- modul ini KHUSUS Emas, BTC TETAP pola lama di rangerAutoTrader.js/
// sniperAutoAnalysis.js, gak disentuh modul ini sama sekali).

const fs = require('fs');
const path = require('path');
const { hitung: hitungExposure } = require('./calculator');
const { FALLBACK_FEE_PERCENT } = require('./masterRuleTrailingInvalidation');
const bitgetExecutorDefault = require('./bitgetExecutor');
const mexcExecutorDefault = require('./mexcExecutor');
const { CLOSE_REASON_LABEL, KAELA_ACCESS_URL, formatAutoOpen, formatAutoClosed, formatWinRateLines, SYSTEM_LABEL } = require('./darkKaelaLog');
const { nextSignalId, dayKeyOf } = require('./signalIdGenerator');

const CONFIG_PATH = path.join(__dirname, 'gold-twin-position-config.json');
const JOURNAL_PATH = path.join(__dirname, 'gold-twin-position-journal.json');
const MODAL_ACTIVE_FRACTION = 1 / 5; // SAMA konvensi "cheat exposure" seluruh proyek ini
const MEXC_BADGE = '🔷 MEXC';
const BITGET_BADGE = '🟩 Bitget';
const BITGET_SYMBOL = 'PAXGUSDT'; // format Bitget (tanpa underscore) -- token PAXG sama kayak Ranger/Sniper Emas MEXC (PAXG_USDT)

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { enabled: false, allowReal: false };
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return { enabled: false, allowReal: false }; }
}

function freshStats() { return { wins: 0, losses: 0, totalPnlUsd: 0 }; }
function freshSystemJournal() {
  return {
    floating: null, closedCount: 0,
    stats: { trailing: freshStats(), fixedTp: freshStats() },
    dailySignalSeq: { dayKey: null, count: 0 },
  };
}

function loadJournal() {
  const def = { ranger: freshSystemJournal(), sniper: freshSystemJournal() };
  if (!fs.existsSync(JOURNAL_PATH)) return def;
  try {
    const j = JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8'));
    const merged = {};
    for (const sysKey of ['ranger', 'sniper']) {
      merged[sysKey] = { ...freshSystemJournal(), ...(j[sysKey] || {}) };
      merged[sysKey].stats = {
        trailing: { ...freshStats(), ...(j[sysKey]?.stats?.trailing || {}) },
        fixedTp: { ...freshStats(), ...(j[sysKey]?.stats?.fixedTp || {}) },
      };
      merged[sysKey].dailySignalSeq = { dayKey: null, count: 0, ...(j[sysKey]?.dailySignalSeq || {}) };
    }
    return merged;
  } catch { return def; }
}

function saveJournal(j) { fs.writeFileSync(JOURNAL_PATH, JSON.stringify(j, null, 2)); }

function nextSysSignalId(sysJournal, date = new Date()) {
  const dayKey = dayKeyOf(date);
  if (!sysJournal.dailySignalSeq || sysJournal.dailySignalSeq.dayKey !== dayKey) sysJournal.dailySignalSeq = { dayKey, count: 0 };
  const id = nextSignalId(sysJournal.dailySignalSeq.count, date);
  sysJournal.dailySignalSeq.count += 1;
  return id;
}

// Bitget real key -- testnet:true SENGAJA throw di bitgetExecutor.js (gak ada demo yang cover
// Emas, jangan dicoba -- lihat riset di header file). Cukup 1 fungsi TANPA param testnet (beda
// dari exchange lain yang punya varian demo genuinely bisa dipakai), krn cuma 1 mode yang valid.
function bitgetExecForReal() {
  const secrets = bitgetExecutorDefault.loadSecrets();
  if (!secrets.BITGET_API_KEY || !secrets.BITGET_API_SECRET || !secrets.BITGET_API_PASSPHRASE) return null; // belum disiapin -- skip aman, SAMA pola execFor lain
  return bitgetExecutorDefault.createBitgetClient({ apiKey: secrets.BITGET_API_KEY, apiSecret: secrets.BITGET_API_SECRET, passphrase: secrets.BITGET_API_PASSPHRASE, testnet: false });
}

// ============ Live trailing (ratchet) -- versi PER-TICK dari masterRuleTrailingInvalidation.js ============
// Logika SAMA PERSIS (extreme + invalidation ratchet cuma ke arah untung), cuma di sini dipanggil
// tiap cek harga LIVE (bukan iterasi candle historis) -- pola IDENTIK ninjaTrader.js updateTrailing().
function updateLiveTrailing(sub, dir, effectivePct, livePrice) {
  const f = effectivePct / 100;
  if (dir === 'buy') {
    if (livePrice > sub.extreme) { sub.extreme = livePrice; sub.invalidation = Math.max(sub.invalidation, sub.extreme * (1 - f)); }
    return livePrice <= sub.invalidation;
  }
  if (livePrice < sub.extreme) { sub.extreme = livePrice; sub.invalidation = Math.min(sub.invalidation, sub.extreme * (1 + f)); }
  return livePrice >= sub.invalidation;
}

function checkFixedTpHit(dir, sl, tp, livePrice) {
  const hitSl = dir === 'buy' ? livePrice <= sl : livePrice >= sl;
  const hitTp = dir === 'buy' ? livePrice >= tp : livePrice <= tp;
  if (hitSl) return 'SL';
  if (hitTp) return 'TP';
  return null;
}

// ============ Buka posisi (2 leg) ============
// `sig` = { direction: 'buy'|'sell', sl, patternType } -- HASIL DETEKSI YANG UDAH ADA (caller udah
// lolosin lewat filter window/DXY dia sendiri, modul ini gak deteksi ulang apa-apa).
async function openGoldTwinPosition({ system, assetCfg, sig, livePrice, mexcExec, notify, notifySilent, idrRate }) {
  const cfg = loadConfig();
  const journal = loadJournal();
  const v = journal[system];
  if (v.floating) { console.log(`[GoldTwin/${system}] Udah ada posisi floating, skip sinyal baru.`); return; }

  const riskDistance = Math.abs(livePrice - sig.sl);
  if (riskDistance === 0) { console.log(`[GoldTwin/${system}] riskDistance 0, skip.`); return; }
  const nyawaPct = (riskDistance / livePrice) * 100;
  const effectivePct = nyawaPct + FALLBACK_FEE_PERCENT;
  const tp = sig.direction === 'buy' ? livePrice + riskDistance * 3 : livePrice - riskDistance * 3; // Fixed-TP 3:1

  async function openLeg(exec, symbol, execMode) {
    const balance = await exec.getAccountBalance('USDT').catch(() => 0);
    const modal = (balance || 0) * MODAL_ACTIVE_FRACTION / 2; // /2 -- separuh modal per leg (twin), dari akun exchange leg ITU SENDIRI
    const calc = hitungExposure({ modal, entry: livePrice, stopLoss: sig.sl, direction: sig.direction });
    if (calc.nilaiPosisi <= 0) return null;
    await exec.setIsolatedMargin(symbol).catch(() => {});
    // 3 arg (positionType) WAJIB buat MEXC (setLeverage(symbol,leverage,positionType), default 1
    // kalau diomit -- salah kalau ini pernah dipanggil buat SHORT) -- Bitget setLeverage(symbol,
    // leverage) abaikan arg ke-3 apa adanya (leverage sama utk 2 arah per docs-nya), aman
    // dipanggil generik kayak gini.
    await exec.setLeverage(symbol, calc.leverage, mexcExecutorDefault.positionTypeFor(sig.direction)).catch(() => {});
    const placed = await exec.placeMarketEntry({ symbol, direction: sig.direction === 'buy' ? 'buy' : 'sell', notionalUsd: calc.nilaiPosisi, livePrice });
    const quantity = placed.executedQty ? parseFloat(placed.executedQty) : calc.nilaiPosisi / livePrice;
    return { entryPrice: livePrice, quantity, leverage: calc.leverage, margin: calc.margin, nilaiPosisi: calc.nilaiPosisi, openedAt: Date.now(), symbol, execMode };
  }

  // Simulasi lokal MURNI -- livePrice diambil apa adanya, nilai posisi dihitung dari
  // MODAL_ACTIVE_FRACTION/2 x $1000 (angka referensi tetap, BUKAN saldo real), NOL panggilan
  // exchange. Dipakai buat KEDUA leg selama allowReal:false -- gak ada exchange manapun yang
  // punya demo asli buat Emas (lihat riset di header file), jadi paper itu SATU-SATUNYA cara
  // evaluasi yang aman.
  function paperLeg() {
    const modal = (1000 * MODAL_ACTIVE_FRACTION) / 2;
    const calc = hitungExposure({ modal, entry: livePrice, stopLoss: sig.sl, direction: sig.direction });
    return { entryPrice: livePrice, quantity: calc.nilaiPosisi / livePrice, leverage: calc.leverage, margin: calc.margin, nilaiPosisi: calc.nilaiPosisi, openedAt: Date.now(), execMode: 'paper' };
  }

  let trailingResult, fixedTpResult;
  const allowReal = cfg.allowReal === true;
  if (allowReal) {
    try { trailingResult = await openLeg(mexcExec, assetCfg.execSymbol, 'mexc-real'); }
    catch (e) { console.log(`[GoldTwin/${system}] Gagal buka leg Trailing (MEXC real):`, e.message); trailingResult = null; }
    const bitgetReal = bitgetExecForReal();
    if (bitgetReal) {
      try { fixedTpResult = await openLeg(bitgetReal, BITGET_SYMBOL, 'bitget-real'); }
      catch (e) { console.log(`[GoldTwin/${system}] Gagal buka leg FixedTP (Bitget real):`, e.message); fixedTpResult = null; }
    } else { console.log(`[GoldTwin/${system}] Bitget real belum disiapin -- leg FixedTP skip, Trailing tetap jalan sendiri.`); }
  } else {
    // Fase evaluasi -- KEDUA leg paper, gak ada exchange manapun (Bybit/Bitget) yang punya demo
    // asli buat Emas (lihat riset di header file). JANGAN coba testnet:true ke bitgetExecutor.js,
    // itu SENGAJA throw.
    trailingResult = paperLeg();
    fixedTpResult = paperLeg();
  }

  if (!trailingResult && !fixedTpResult) { console.log(`[GoldTwin/${system}] Kedua leg gagal dibuka, batal.`); return; }

  const tradeId = require('crypto').randomUUID();
  const signalId = nextSysSignalId(v, new Date());
  v.floating = {
    id: tradeId, signalId, dir: sig.direction, sl: sig.sl, tp, effectivePct, patternType: sig.patternType,
    trailing: trailingResult ? { ...trailingResult, extreme: trailingResult.entryPrice, invalidation: sig.direction === 'buy' ? trailingResult.entryPrice * (1 - effectivePct / 100) : trailingResult.entryPrice * (1 + effectivePct / 100) } : null,
    fixedTp: fixedTpResult || null,
  };
  saveJournal(journal);

  const sysLabel = system === 'ranger' ? SYSTEM_LABEL.RANGER : SYSTEM_LABEL.SNIPER;
  console.log(`[GoldTwin/${system}] Entry ${sig.direction.toUpperCase()} @ ${livePrice} -- Trailing ${trailingResult ? trailingResult.execMode : 'skip'}, FixedTP ${fixedTpResult ? fixedTpResult.execMode : 'skip'}.`);

  // Demo (paper) ke Sniper Club, Real (mexc-real/bitget-real) ke Wibowo -- per LEG, BUKAN per
  // keseluruhan posisi (leg bisa beda execMode kalau salah satu real-nya gagal parsial).
  if (trailingResult) {
    const isDemo = trailingResult.execMode !== 'mexc-real';
    const msg = formatAutoOpen({ id: tradeId, signalId, direction: sig.direction, entryPrice: trailingResult.entryPrice, tp: null, sl: sig.sl, marginUsd: trailingResult.margin, nilaiPosisi: trailingResult.nilaiPosisi, leverage: trailingResult.leverage, mode: 'gold_twin_trailing', assetLabel: 'XAU' }, new Date(), '', isDemo, idrRate, '', null, MEXC_BADGE, sysLabel);
    await (isDemo ? notifySilent : notify)(msg).catch((e) => console.log(`[GoldTwin/${system}] Gagal kirim WA (open Trailing):`, e.message));
  }
  if (fixedTpResult) {
    const isDemo = fixedTpResult.execMode !== 'bitget-real';
    const msg = formatAutoOpen({ id: tradeId, signalId, direction: sig.direction, entryPrice: fixedTpResult.entryPrice, tp, sl: sig.sl, marginUsd: fixedTpResult.margin, nilaiPosisi: fixedTpResult.nilaiPosisi, leverage: fixedTpResult.leverage, mode: 'gold_twin_fixedtp', assetLabel: 'XAU' }, new Date(), '', isDemo, idrRate, '', null, BITGET_BADGE, sysLabel);
    await (isDemo ? notifySilent : notify)(msg).catch((e) => console.log(`[GoldTwin/${system}] Gagal kirim WA (open FixedTP):`, e.message));
  }
}

// ============ Monitor + tutup posisi ============
async function monitorGoldTwinPosition({ system, livePrice, mexcExec, notify, notifySilent, idrRate }) {
  const journal = loadJournal();
  const v = journal[system];
  const f = v.floating;
  if (!f) return;

  // execMode nempel di JOURNAL tiap leg (dicatat pas open) -- SUMBER KEBENARAN buat exec mana yang
  // dipanggil pas close, BUKAN baca ulang config sekarang (config bisa keubah SEMENTARA posisi
  // masih floating, closing WAJIB konsisten sama exchange yang beneran dipakai buka).
  function execFor(execMode) {
    if (execMode === 'mexc-real') return mexcExec;
    if (execMode === 'bitget-real') return bitgetExecForReal();
    return null; // 'paper' -- gak ada exec, gak pernah dipanggil closeLeg
  }
  async function closeLeg(execMode, symbol, quantity) {
    const exec = execFor(execMode);
    if (!exec) return;
    return exec.emergencyCloseMarket({ symbol, direction: f.dir, quantity });
  }

  let trailingHit = null, fixedTpHit = null;
  if (f.trailing && !f.trailing.closedAt) {
    // updateLiveTrailing MUTASI f.trailing.extreme/invalidation tiap panggil (ratchet) -- WAJIB
    // saveJournal() di BAWAH jalan tiap siklus, bukan cuma pas ada leg yang beneran exit, ATAU
    // ratchet-nya ke-reset ke titik entry tiap siklus (baca ulang dari disk state lama). Bug NYATA
    // ketemu 26 Sep 2026 dari smoke test sendiri sebelum dipasang live -- lihat catatan di bawah.
    if (updateLiveTrailing(f.trailing, f.dir, f.effectivePct, livePrice)) trailingHit = 'TRAIL';
  }
  if (f.fixedTp && !f.fixedTp.closedAt) {
    const outcome = checkFixedTpHit(f.dir, f.sl, f.tp, livePrice);
    if (outcome) fixedTpHit = outcome;
  }
  if (!trailingHit && !fixedTpHit) { saveJournal(journal); return; } // simpen update ratchet walau belum ada yang exit

  const sysLabel = system === 'ranger' ? SYSTEM_LABEL.RANGER : SYSTEM_LABEL.SNIPER;
  const feeFraction = FALLBACK_FEE_PERCENT / 100;
  const pnlSign = f.dir === 'buy' ? 1 : -1;
  const dirLongShort = f.dir === 'buy' ? 'long' : 'short'; // formatAutoClosed pakai konvensi long/short, BEDA dari formatAutoOpen yang buy/sell

  if (trailingHit && f.trailing && !f.trailing.closedAt) {
    const isDemo = f.trailing.execMode !== 'mexc-real';
    try { await closeLeg(f.trailing.execMode, f.trailing.symbol, f.trailing.quantity); } catch (e) { console.log(`[GoldTwin/${system}] Gagal tutup leg Trailing (${f.trailing.execMode}):`, e.message); }
    f.trailing.closedAt = Date.now();
    f.trailing.exitPrice = livePrice;
    const gross = (livePrice - f.trailing.entryPrice) * f.trailing.quantity * pnlSign;
    const feeUsd = (f.trailing.nilaiPosisi + livePrice * f.trailing.quantity) * feeFraction;
    const net = gross - feeUsd;
    v.stats.trailing.totalPnlUsd += net;
    if (net >= 0) v.stats.trailing.wins += 1; else v.stats.trailing.losses += 1;
    const msg = formatAutoClosed({ id: f.id, signalId: f.signalId, direction: dirLongShort, entryPrice: f.trailing.entryPrice, exitPrice: livePrice, pnlUsd: gross, feeUsd, pnlPct: null, mode: 'gold_twin_trailing', assetLabel: 'XAU' }, new Date(), isDemo, CLOSE_REASON_LABEL.CB_TRAIL, idrRate, null, MEXC_BADGE, sysLabel);
    const extra = formatWinRateLines(v.stats.trailing, `Gold Trailing (${isDemo ? 'Demo' : 'Real'})`, idrRate);
    await (isDemo ? notifySilent : notify)(msg.replace(`🔗 ${KAELA_ACCESS_URL}`, extra + `🔗 ${KAELA_ACCESS_URL}`)).catch((e) => console.log(`[GoldTwin/${system}] Gagal kirim WA (close Trailing):`, e.message));
  }
  if (fixedTpHit && f.fixedTp && !f.fixedTp.closedAt) {
    const isDemo = f.fixedTp.execMode !== 'bitget-real';
    const exitPrice = fixedTpHit === 'TP' ? f.tp : f.sl;
    try { await closeLeg(f.fixedTp.execMode, BITGET_SYMBOL, f.fixedTp.quantity); } catch (e) { console.log(`[GoldTwin/${system}] Gagal tutup leg FixedTP (${f.fixedTp.execMode}):`, e.message); }
    f.fixedTp.closedAt = Date.now();
    f.fixedTp.exitPrice = exitPrice;
    const gross = (exitPrice - f.fixedTp.entryPrice) * f.fixedTp.quantity * pnlSign;
    const feeUsd = (f.fixedTp.nilaiPosisi + exitPrice * f.fixedTp.quantity) * feeFraction;
    const net = gross - feeUsd;
    v.stats.fixedTp.totalPnlUsd += net;
    if (net >= 0) v.stats.fixedTp.wins += 1; else v.stats.fixedTp.losses += 1;
    const msg = formatAutoClosed({ id: f.id, signalId: f.signalId, direction: dirLongShort, entryPrice: f.fixedTp.entryPrice, exitPrice, pnlUsd: gross, feeUsd, pnlPct: null, mode: 'gold_twin_fixedtp', assetLabel: 'XAU' }, new Date(), isDemo, fixedTpHit === 'TP' ? 'Target tercapai' : 'Stop loss kena', idrRate, null, BITGET_BADGE, sysLabel);
    const extra = formatWinRateLines(v.stats.fixedTp, `Gold TP Tetap (${isDemo ? 'Demo' : 'Real'})`, idrRate);
    await (isDemo ? notifySilent : notify)(msg.replace(`🔗 ${KAELA_ACCESS_URL}`, extra + `🔗 ${KAELA_ACCESS_URL}`)).catch((e) => console.log(`[GoldTwin/${system}] Gagal kirim WA (close FixedTP):`, e.message));
  }

  const trailingDone = !f.trailing || !!f.trailing.closedAt;
  const fixedTpDone = !f.fixedTp || !!f.fixedTp.closedAt;
  if (trailingDone && fixedTpDone) {
    v.closedCount = (v.closedCount || 0) + 1;
    v.floating = null;
    console.log(`[GoldTwin/${system}] Twin position ditutup penuh (closedCount ${v.closedCount}).`);
  }
  saveJournal(journal);
}

module.exports = { loadConfig, loadJournal, openGoldTwinPosition, monitorGoldTwinPosition };
