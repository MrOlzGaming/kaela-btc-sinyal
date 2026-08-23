// Nyopet Auto-Trader -- era Binance Demo (23 Agu 2026, desain Olan). LOCAL ONLY (numpang jalan
// bareng localLiveExecutor.js di run-local-executor.ps1) -- Binance Demo diblokir dari GitHub
// Actions, dan sistem ini butuh cek SETIAP SIKLUS (bukan cuma pas ada sinyal baru) buat mantau
// posisi floating, jadi gak worth dipisah cloud-detect/local-execute kayak Sniper.
//
// LOGIKA (murni trigger zona likuiditas, GAK PAKAI R:R):
//   FADE (default, asumsi SELALU mantul): harga nyentuh zona -> counter posisi, nyawa 1% FLAT,
//     TP = zona LAWAN. Kena TP -> tutup (WIN), REVERSE (posisi baru arah kebalikan di zona ini).
//   FOLLOW (override kalau zona GAGAL nahan/ditembus beneran, bukan cuma wick): ikutin arah
//     tembusan, target = zona BERIKUTNYA di arah situ. Kena target -> tutup, balik ke FADE lagi.
//   Kena NYAWA (SL) di mode manapun -> tutup (LOSS), buka posisi baru lagi (cek zona ulang).
// Selalu (hampir) ada 1 posisi kebuka -- "ping-pong tiada henti" (istilah Olan). Symbol BTCUSDC,
// wallet USDC (terpisah dari Sniper yang pakai USDT, lihat project-kaela-btc-sinyal memory).
//
// SKEMA JURNAL (23 Agu 2026, permintaan Olan: "100% sama kayak sniper pencatatanya") -- SAMA
// PERSIS struktur sniper-orders.json ({balance, orders[]}, tiap order punya `status`
// floating/closed_tp/closed_sl, `direction` buy/sell) -- BUKAN openPosition+trades[] terpisah kayak
// versi lama, dan GAK ADA lagi batas "100 trade buat evaluasi". Field TAMBAHAN yang cuma dipunyai
// Nyopet (mode/zonePrice/zoneKind/zoneTouches) numpang di object yang sama, gak masalah beda field
// count dari Sniper -- yang penting KONTRAK INTI (status/direction/pnlUsd/dst) konsisten.

const fs = require('fs');
const path = require('path');
const { fetchCandles } = require('./technicalAnalysis');
const { detectZones, findTouchCandidate, findNearestPair, isZoneBroken } = require('./darkKaelaZones');
const { hitung: hitungExposure } = require('./calculator');
const { getAccountBalance, setLeverage, placeMarketEntry, placeStopLoss, emergencyCloseMarket } = require('./binanceExecutor');
const { formatAutoOpen, formatAutoClosed } = require('./darkKaelaLog');
const { sendWhatsApp } = require('./fonnte');
const { isLiveTradingEnabled } = require('./killSwitch');

const SYMBOL = 'BTCUSDC';
const MARGIN_ASSET = 'USDC';
const NYAWA_PCT = 1; // flat, permintaan Olan ("selalu pake nyawa 1% saja") -- BUKAN dari jarak ke zona
const JOURNAL_PATH = path.join(__dirname, 'nyopet-journal.json');

function loadJournal() {
  if (!fs.existsSync(JOURNAL_PATH)) return { balance: 0, orders: [], watchZone: null };
  return JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8'));
}
function saveJournal(j) {
  fs.writeFileSync(JOURNAL_PATH, JSON.stringify(j, null, 2));
}
function getFloatingOrder(journal) {
  return (journal.orders || []).find((o) => o.status === 'floating') || null;
}

async function fetchLivePrice() {
  const res = await fetch(`https://demo-fapi.binance.com/fapi/v1/ticker/price?symbol=${SYMBOL}`);
  return parseFloat((await res.json()).price);
}

// "Modal aktif" = 1/5 saldo (23 Agu 2026, permintaan Olan) -- BUKAN all-in tiap posisi. Karena
// sistem ping-pong ini selalu buka posisi baru lagi begitu satu ditutup (tanpa henti), all-in tiap
// kali bikin 1 nyawa buruk beruntun bisa nguras porsi besar saldo sekaligus -- 1/5 ngasih ruang
// buat believe beberapa siklus tanpa modal abis. Kalkulator exposure TETAP dipakai persis sama
// (WAJIB, "cheat anti rungkad"), cuma `modal` yang diinput ke situ udah dikecilin duluan.
const MODAL_ACTIVE_FRACTION = 1 / 5;

// Buka posisi beneran di Binance Demo + tulis ke journal (status floating) + kirim WA.
async function openPosition({ direction, tp, mode, zoneCtx }) {
  const [modalFull, livePrice] = await Promise.all([getAccountBalance(MARGIN_ASSET), fetchLivePrice()]);
  const modal = modalFull * MODAL_ACTIVE_FRACTION;
  const calc = hitungExposure({ modal, nyawa: NYAWA_PCT, entry: livePrice });
  console.log(`[NyopetAutoTrader] Saldo penuh $${modalFull.toFixed(2)} -> modal aktif (1/5) $${modal.toFixed(2)}`);
  console.log(`[NyopetAutoTrader] Buka ${mode.toUpperCase()} ${direction} -- modal $${modal.toFixed(2)} | leverage ${calc.leverage}x | margin $${calc.margin.toFixed(2)}`);

  await setLeverage(SYMBOL, calc.leverage);
  const entryOrder = await placeMarketEntry({ symbol: SYMBOL, direction, notionalUsd: calc.nilaiPosisi, livePrice });
  const qty = parseFloat(entryOrder.executedQty);
  const entryPrice = parseFloat(entryOrder.avgPrice);

  const slPrice = entryPrice * (direction === 'buy' ? 1 - NYAWA_PCT / 100 : 1 + NYAWA_PCT / 100);
  try {
    await placeStopLoss({ symbol: SYMBOL, direction, stopPrice: slPrice, quantity: qty });
  } catch (slErr) {
    console.log(`[NyopetAutoTrader] SL GAGAL nempel (${slErr.message}) -- tutup paksa demi keamanan.`);
    await emergencyCloseMarket({ symbol: SYMBOL, direction, quantity: qty });
    throw new Error(`Entry masuk tapi SL gagal -- posisi udah ditutup paksa otomatis: ${slErr.message}`);
  }

  const order = {
    id: 'nyopet-demo-' + Date.now(), direction, status: 'floating', mode, entryPrice, sl: slPrice, tp, qty,
    leverage: calc.leverage, marginUsd: calc.margin, zonePrice: zoneCtx.price, zoneKind: zoneCtx.kind,
    zoneTouches: zoneCtx.touches, triggeredAt: new Date().toISOString(),
  };
  const journal = loadJournal();
  journal.balance = modalFull;
  journal.orders.push(order);
  journal.watchZone = { price: zoneCtx.price, side: zoneCtx.side, zoneKind: zoneCtx.kind, touches: zoneCtx.touches };
  saveJournal(journal);

  const msg = formatAutoOpen({ ...order, direction: direction === 'buy' ? 'long' : 'short' }, new Date());
  console.log(msg + '\n');
  await sendWhatsApp(msg);
  return order;
}

async function closePosition(order, reasonWon) {
  const closeOrder = await emergencyCloseMarket({ symbol: SYMBOL, direction: order.direction, quantity: order.qty });
  const exitPrice = parseFloat(closeOrder.avgPrice) || (reasonWon ? order.tp : order.sl);
  const pnlUsd = order.direction === 'buy'
    ? (exitPrice - order.entryPrice) * order.qty
    : (order.entryPrice - exitPrice) * order.qty;
  const pnlPct = (pnlUsd / order.marginUsd) * 100;

  const journal = loadJournal();
  const target = journal.orders.find((o) => o.id === order.id);
  Object.assign(target, {
    status: reasonWon ? 'closed_tp' : 'closed_sl', exitPrice, pnlUsd, pnlPct, closedAt: new Date().toISOString(),
  });
  saveJournal(journal);

  const msg = formatAutoClosed({ direction: order.direction === 'buy' ? 'long' : 'short', mode: order.mode, entryPrice: order.entryPrice, exitPrice, pnlUsd }, new Date());
  console.log(msg + '\n');
  await sendWhatsApp(msg);
  return target;
}

async function main() {
  if (!isLiveTradingEnabled()) {
    console.log('[NyopetAutoTrader] Kill switch OFF -- gak ngapa-ngapain.');
    return;
  }

  let journal = loadJournal();
  const floating = getFloatingOrder(journal);

  // 1. Ada posisi floating -- cek SL/TP kena apa belum.
  if (floating) {
    const livePrice = await fetchLivePrice();
    const hitSl = floating.direction === 'buy' ? livePrice <= floating.sl : livePrice >= floating.sl;
    const hitTp = floating.direction === 'buy' ? livePrice >= floating.tp : livePrice <= floating.tp;

    if (hitSl) {
      console.log(`[NyopetAutoTrader] Nyawa kena (${livePrice} vs SL ${floating.sl}) -- tutup rugi.`);
      await closePosition(floating, false);
      journal = loadJournal(); // watchZone TETAP di zona ini (belum tentu bener2 ditembus, cek isZoneBroken run berikutnya)
    } else if (hitTp) {
      console.log(`[NyopetAutoTrader] Target kena (${livePrice} vs TP ${floating.tp}) -- tutup untung, reverse.`);
      await closePosition(floating, true);
      journal = loadJournal();
      journal.watchZone = { price: floating.tp, side: floating.direction === 'buy' ? 'resistance' : 'support' };
      saveJournal(journal);
    } else {
      console.log(`[NyopetAutoTrader] Posisi masih floating (${floating.direction} @ ${floating.entryPrice}, sekarang ${livePrice}) -- lanjut pantau.`);
      return;
    }
  }

  // 2. Gak ada posisi -- cari entry baru dari watchZone (kalau ada) atau deteksi fresh.
  const candles1h = await fetchCandles('BTCUSDT', '1h', 386);
  const i = candles1h.length - 1;
  const zones = detectZones(candles1h, i);
  const candles5m = await fetchCandles('BTCUSDT', '5m', 4);
  const latest5m = candles5m[candles5m.length - 1];

  const watchZone = journal.watchZone;
  if (watchZone) {
    const zoneAsActive = { price: watchZone.price, direction: watchZone.side === 'support' ? 'long' : 'short' };
    if (isZoneBroken(latest5m, zoneAsActive)) {
      // FOLLOW: ikutin arah tembusan, target = zona berikutnya di arah situ.
      const breakoutDirection = watchZone.side === 'support' ? 'sell' : 'buy';
      const pair = findNearestPair(latest5m.close, zones);
      const nextTarget = breakoutDirection === 'sell' ? pair.support : pair.resistance;
      if (!nextTarget) {
        console.log('[NyopetAutoTrader] Zona ditembus tapi belum ketemu target zona berikutnya -- tunggu siklus depan.');
        return;
      }
      await openPosition({
        direction: breakoutDirection, tp: nextTarget.price, mode: 'follow',
        zoneCtx: { price: watchZone.price, kind: watchZone.zoneKind || 'swing', touches: watchZone.touches, side: watchZone.side },
      });
      return;
    }
    // Belum ditembus -- FADE lagi di zona yang sama (ini yang bikin "reverse" abis TP kejadian).
    const direction = watchZone.side === 'support' ? 'buy' : 'sell';
    const pair = findNearestPair(latest5m.close, zones);
    const tp = direction === 'buy' ? pair.resistance : pair.support;
    if (!tp) {
      console.log('[NyopetAutoTrader] Belum ketemu zona lawan buat TP -- tunggu siklus depan.');
      return;
    }
    await openPosition({
      direction, tp: tp.price, mode: 'fade',
      zoneCtx: { price: watchZone.price, kind: watchZone.zoneKind || 'swing', touches: watchZone.touches, side: watchZone.side },
    });
    return;
  }

  // 3. Belum pernah ada watchZone sama sekali (run pertama) -- tunggu touch beneran dulu.
  const touched = findTouchCandidate(latest5m, zones);
  if (!touched) {
    console.log('[NyopetAutoTrader] Belum ada zona ke-touch, dan belum ada watchZone -- tunggu siklus depan.');
    return;
  }
  const pair = findNearestPair(latest5m.close, zones);
  const tp = touched.direction === 'long' ? pair.resistance : pair.support;
  await openPosition({
    direction: touched.direction === 'long' ? 'buy' : 'sell', tp: tp ? tp.price : touched.price, mode: 'fade',
    zoneCtx: { price: touched.price, kind: touched.kind, touches: touched.touches, side: touched.direction === 'long' ? 'support' : 'resistance' },
  });
}

main().catch((e) => {
  console.error('ERROR nyopetAutoTrader.js:', e.message);
  process.exit(1);
});
