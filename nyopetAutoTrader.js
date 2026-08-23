// Nyopet Auto-Trader -- era Binance Demo (23 Agu 2026, desain Olan). LOCAL ONLY (numpang jalan
// bareng localLiveExecutor.js di run-local-executor.ps1) -- Binance Demo diblokir dari GitHub
// Actions, dan sistem ini butuh cek SETIAP SIKLUS (bukan cuma pas ada sinyal baru) buat mantau
// posisi floating, jadi gak worth dipisah cloud-detect/local-execute kayak Sniper.
//
// MULTI-ASET (23 Agu 2026, permintaan Olan: "semua mode sniper dan nyopet berlaku buat semua
// aset.. baik BTC dan PAXG") -- loop tiap aset di NYOPET_ASSETS, TIAP ASET dapet slot 1 posisi
// SENDIRI-SENDIRI (BTC dan PAXG bisa floating bebarengan, gak rebutan slot) -- pola sama kayak
// Sniper multi-aset. State (`orders`/`watchZoneByAsset`) di journal dipisah per-key aset.
//
// LOGIKA per-aset (murni trigger zona likuiditas, GAK PAKAI R:R):
//   FADE (default, asumsi SELALU mantul): harga nyentuh zona -> counter posisi, nyawa 2% FLAT
//     (jadi leverage), TP = zona LAWAN. Kena TP -> tutup (WIN), REVERSE (posisi baru arah
//     kebalikan di zona ini).
//   FOLLOW (override kalau zona GAGAL nahan/ditembus beneran, bukan cuma wick): ikutin arah
//     tembusan, target = zona BERIKUTNYA di arah situ. Kena target -> tutup, balik ke FADE lagi.
//   Kena LIKUIDASI di mode manapun -> tutup (LOSS), buka posisi baru lagi (cek zona ulang).
//
// GAK PAKAI ORDER SL TERPISAH (23 Agu 2026, permintaan Olan: "kita ga pake sl tp pastikan buka
// pake isolated jadi liq adalah sl") -- margin ISOLATED dipastiin eksplisit tiap buka posisi,
// LIKUIDASI-nya sendiri yang jadi nyawa. Konsekuensi: monitoring TP/loss WAJIB nanya status REAL
// ke Binance (getPositionRisk) dulu tiap siklus, JANGAN cuma bandingin harga live vs SL yang
// "seharusnya" -- kalau posisi udah kelikuidasi SELAMA kita offline, rekonsiliasi dari income
// history Binance (bukan nebak harga).
//
// SKEMA JURNAL 100% sama sniper-orders.json ({balance, orders[]} + status
// floating/closed_tp/closed_sl, tiap order punya field `asset`) -- gak ada batas 100 trade lagi.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fetchCandles } = require('./technicalAnalysis');
const { detectZones, findTouchCandidate, findNearestPair, isZoneBroken } = require('./darkKaelaZones');
const { hitung: hitungExposure } = require('./calculator');
const { getAccountBalance, setLeverage, setIsolatedMargin, placeMarketEntry, emergencyCloseMarket, getPositionRisk } = require('./binanceExecutor');
const { formatAutoOpen, formatAutoClosed } = require('./darkKaelaLog');
const { sendWhatsApp } = require('./fonnte');
const { isLiveTradingEnabled } = require('./killSwitch');
const { NYOPET_ASSETS } = require('./nyopetAssetConfig');

const NYAWA_PCT = 2; // flat (23 Agu 2026, direvisi dari 1% -> 2%), dipakai buat nentuin LEVERAGE (bukan buat SL order -- itu gak ada lagi, likuidasi yang jadi SL)
const JOURNAL_PATH = path.join(__dirname, 'nyopet-journal.json');
// "Modal aktif" = 1/5 saldo (23 Agu 2026, permintaan Olan) -- BUKAN all-in tiap posisi, biar tahan
// beberapa siklus rugi beruntun tanpa ngabisin saldo sekaligus. Kalkulator exposure TETAP dipakai
// persis sama (WAJIB, "cheat anti rungkad"), cuma `modal` yang diinput ke situ udah dikecilin duluan.
const MODAL_ACTIVE_FRACTION = 1 / 5;

// Migrasi otomatis dari skema single-asset lama (23 Agu 2026, bug ketemu: order lama gak punya
// field `asset`, watchZone lama singular bukan per-aset -- refactor multi-aset SEMPAT bikin
// posisi BTC yang lagi jalan "hilang" dari deteksi, untung belum sampe buka posisi dobel).
// SEMUA data sebelum multi-aset itu otomatis BTC (satu-satunya aset Nyopet sebelum ini).
function loadJournal() {
  if (!fs.existsSync(JOURNAL_PATH)) return { balance: 0, orders: [], watchZoneByAsset: {} };
  const j = JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8'));
  let migrated = false;
  for (const o of j.orders || []) {
    if (!o.asset) { o.asset = 'btc'; migrated = true; }
  }
  if (!j.watchZoneByAsset) j.watchZoneByAsset = {};
  if (j.watchZone && !j.watchZoneByAsset.btc) { j.watchZoneByAsset.btc = j.watchZone; migrated = true; }
  if (j.watchZone) { delete j.watchZone; migrated = true; }
  if (migrated) saveJournal(j);
  return j;
}
function saveJournal(j) {
  fs.writeFileSync(JOURNAL_PATH, JSON.stringify(j, null, 2));
}
function getFloatingOrder(journal, assetKey) {
  return (journal.orders || []).find((o) => o.status === 'floating' && o.asset === assetKey) || null;
}

async function fetchLivePrice(symbol) {
  const res = await fetch(`https://demo-fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`);
  return parseFloat((await res.json()).price);
}

function sign(q, s) { return crypto.createHmac('sha256', s).update(q).digest('hex'); }
// Income history (realized PNL asli dari Binance) -- WAJIB dipakai buat rekonsiliasi kalau posisi
// ternyata udah closed/likuidasi SELAMA kita offline, JANGAN pernah nebak PNL dari harga sendiri.
async function fetchRealizedPnlSince(symbol, startTime) {
  const secrets = require('./secrets');
  const params = { symbol, startTime, timestamp: Date.now(), recvWindow: 5000, limit: 1000 };
  const query = new URLSearchParams(params).toString();
  const sig = sign(query, secrets.BINANCE_API_SECRET);
  const res = await fetch(`https://demo-fapi.binance.com/fapi/v1/income?${query}&signature=${sig}`, { headers: { 'X-MBX-APIKEY': secrets.BINANCE_API_KEY } });
  const income = await res.json();
  return income.reduce((s, inc) => s + parseFloat(inc.income), 0);
}

// Buka posisi beneran di Binance Demo + tulis ke journal (status floating) + kirim WA.
async function openPosition(assetCfg, { direction, tp, mode, zoneCtx }) {
  const { symbol, marginAsset, key: assetKey } = assetCfg;
  const [modalFull, livePrice] = await Promise.all([getAccountBalance(marginAsset), fetchLivePrice(symbol)]);
  const modal = modalFull * MODAL_ACTIVE_FRACTION;
  const calc = hitungExposure({ modal, nyawa: NYAWA_PCT, entry: livePrice });
  console.log(`[NyopetAutoTrader] ${assetCfg.label}: Saldo ${marginAsset} penuh $${modalFull.toFixed(2)} -> modal aktif (1/5) $${modal.toFixed(2)} | leverage ${calc.leverage}x`);

  await setIsolatedMargin(symbol);
  await setLeverage(symbol, calc.leverage);
  const entryOrder = await placeMarketEntry({ symbol, direction, notionalUsd: calc.nilaiPosisi, livePrice });
  const qty = parseFloat(entryOrder.executedQty);
  const entryPrice = parseFloat(entryOrder.avgPrice);
  const posRisk = await getPositionRisk(symbol);

  const order = {
    id: 'nyopet-demo-' + Date.now(), asset: assetKey, direction, status: 'floating', mode, entryPrice,
    liqPrice: parseFloat(posRisk.liquidationPrice), tp, qty,
    leverage: calc.leverage, marginUsd: calc.margin, zonePrice: zoneCtx.price, zoneKind: zoneCtx.kind,
    zoneTouches: zoneCtx.touches, triggeredAt: new Date().toISOString(),
  };
  const journal = loadJournal();
  journal.balance = modalFull; // catatan: field balance tunggal, USDT/USDC dicampur kalau 2 aset kepake -- cukup buat sizing display, detail per-wallet ada di liveExecution tiap order kalau perlu
  journal.orders.push(order);
  journal.watchZoneByAsset[assetKey] = { price: zoneCtx.price, side: zoneCtx.side, zoneKind: zoneCtx.kind, touches: zoneCtx.touches };
  saveJournal(journal);

  const msg = formatAutoOpen({ ...order, sl: order.liqPrice, assetLabel: assetCfg.label }, new Date());
  console.log(msg + '\n');
  await sendWhatsApp(msg);
  return order;
}

async function closePosition(assetCfg, order, { alreadyClosed, realPnlUsd, won }) {
  const { symbol } = assetCfg;
  let pnlUsd, exitPrice, pnlPct;
  if (alreadyClosed) {
    pnlUsd = realPnlUsd;
    exitPrice = order.direction === 'buy' ? order.entryPrice + pnlUsd / order.qty : order.entryPrice - pnlUsd / order.qty;
  } else {
    const closeOrder = await emergencyCloseMarket({ symbol, direction: order.direction, quantity: order.qty });
    exitPrice = parseFloat(closeOrder.avgPrice) || order.tp;
    pnlUsd = order.direction === 'buy' ? (exitPrice - order.entryPrice) * order.qty : (order.entryPrice - exitPrice) * order.qty;
  }
  pnlPct = (pnlUsd / order.marginUsd) * 100;

  const journal = loadJournal();
  const target = journal.orders.find((o) => o.id === order.id);
  Object.assign(target, { status: won ? 'closed_tp' : 'closed_sl', exitPrice, pnlUsd, pnlPct, closedAt: new Date().toISOString() });
  saveJournal(journal);

  const msg = formatAutoClosed({ direction: order.direction === 'buy' ? 'long' : 'short', mode: order.mode, entryPrice: order.entryPrice, exitPrice, pnlUsd, assetLabel: assetCfg.label }, new Date())
    + (alreadyClosed ? '\n\n(⏳ Kelikuidasi PAS lagi offline -- baru kesinkronin sekarang begitu online lagi.)' : '');
  console.log(msg + '\n');
  await sendWhatsApp(msg);
  return target;
}

async function processAsset(assetCfg) {
  const { symbol, zoneSymbol, key: assetKey } = assetCfg;
  let journal = loadJournal();
  const floating = getFloatingOrder(journal, assetKey);

  if (floating) {
    const posRisk = await getPositionRisk(symbol);
    const stillOpen = Math.abs(parseFloat(posRisk.positionAmt)) > 0;

    if (!stillOpen) {
      console.log(`[NyopetAutoTrader] ${assetCfg.label}: posisi UDAH GAK ADA (kelikuidasi/offline) -- rekonsiliasi income history.`);
      const realPnlUsd = await fetchRealizedPnlSince(symbol, new Date(floating.triggeredAt).getTime());
      await closePosition(assetCfg, floating, { alreadyClosed: true, realPnlUsd, won: realPnlUsd >= 0 });
      journal = loadJournal();
      if (realPnlUsd >= 0) journal.watchZoneByAsset[assetKey] = { price: floating.tp, side: floating.direction === 'buy' ? 'resistance' : 'support' };
      saveJournal(journal);
    } else {
      const livePrice = await fetchLivePrice(symbol);
      const hitTp = floating.direction === 'buy' ? livePrice >= floating.tp : livePrice <= floating.tp;
      if (hitTp) {
        console.log(`[NyopetAutoTrader] ${assetCfg.label}: target kena (${livePrice} vs TP ${floating.tp}) -- tutup untung, reverse.`);
        await closePosition(assetCfg, floating, { alreadyClosed: false, won: true });
        journal = loadJournal();
        journal.watchZoneByAsset[assetKey] = { price: floating.tp, side: floating.direction === 'buy' ? 'resistance' : 'support' };
        saveJournal(journal);
      } else {
        console.log(`[NyopetAutoTrader] ${assetCfg.label}: masih floating (${floating.direction} @ ${floating.entryPrice}, sekarang ${livePrice}, liq ${floating.liqPrice}) -- lanjut pantau.`);
        return;
      }
    }
  }

  const candlesStruct = await fetchCandles(zoneSymbol, '1h', 386);
  const i = candlesStruct.length - 1;
  const zones = detectZones(candlesStruct, i);
  const candles5m = await fetchCandles(zoneSymbol, '5m', 4);
  const latest5m = candles5m[candles5m.length - 1];

  const watchZone = journal.watchZoneByAsset[assetKey];
  if (watchZone) {
    const zoneAsActive = { price: watchZone.price, direction: watchZone.side === 'support' ? 'long' : 'short' };
    if (isZoneBroken(latest5m, zoneAsActive)) {
      const breakoutDirection = watchZone.side === 'support' ? 'sell' : 'buy';
      const pair = findNearestPair(latest5m.close, zones);
      const nextTarget = breakoutDirection === 'sell' ? pair.support : pair.resistance;
      if (!nextTarget) { console.log(`[NyopetAutoTrader] ${assetCfg.label}: zona ditembus tapi belum ketemu target berikutnya -- tunggu siklus depan.`); return; }
      await openPosition(assetCfg, { direction: breakoutDirection, tp: nextTarget.price, mode: 'follow', zoneCtx: { price: watchZone.price, kind: watchZone.zoneKind || 'swing', touches: watchZone.touches, side: watchZone.side } });
      return;
    }
    const direction = watchZone.side === 'support' ? 'buy' : 'sell';
    const pair = findNearestPair(latest5m.close, zones);
    const tp = direction === 'buy' ? pair.resistance : pair.support;
    if (!tp) { console.log(`[NyopetAutoTrader] ${assetCfg.label}: belum ketemu zona lawan buat TP -- tunggu siklus depan.`); return; }
    await openPosition(assetCfg, { direction, tp: tp.price, mode: 'fade', zoneCtx: { price: watchZone.price, kind: watchZone.zoneKind || 'swing', touches: watchZone.touches, side: watchZone.side } });
    return;
  }

  const touched = findTouchCandidate(latest5m, zones);
  if (!touched) { console.log(`[NyopetAutoTrader] ${assetCfg.label}: belum ada zona ke-touch, dan belum ada watchZone -- tunggu siklus depan.`); return; }
  const pair = findNearestPair(latest5m.close, zones);
  const tp = touched.direction === 'long' ? pair.resistance : pair.support;
  await openPosition(assetCfg, { direction: touched.direction === 'long' ? 'buy' : 'sell', tp: tp ? tp.price : touched.price, mode: 'fade', zoneCtx: { price: touched.price, kind: touched.kind, touches: touched.touches, side: touched.direction === 'long' ? 'support' : 'resistance' } });
}

async function main() {
  if (!isLiveTradingEnabled()) {
    console.log('[NyopetAutoTrader] Kill switch OFF -- gak ngapa-ngapain.');
    return;
  }
  for (const assetCfg of Object.values(NYOPET_ASSETS)) {
    try {
      await processAsset(assetCfg);
    } catch (e) {
      console.log(`[NyopetAutoTrader] ERROR ${assetCfg.label}:`, e.message);
    }
  }
}

main().catch((e) => { console.error('ERROR nyopetAutoTrader.js:', e.message); process.exit(1); });
