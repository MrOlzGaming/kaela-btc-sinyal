// Nyopet Auto-Trader -- era Binance Demo (23 Agu 2026, desain Olan). LOCAL ONLY (numpang jalan
// bareng localLiveExecutor.js di run-local-executor.ps1) -- Binance Demo diblokir dari GitHub
// Actions, dan sistem ini butuh cek SETIAP SIKLUS (bukan cuma pas ada sinyal baru) buat mantau
// posisi floating, jadi gak worth dipisah cloud-detect/local-execute kayak Sniper.
//
// LOGIKA (murni trigger zona likuiditas, GAK PAKAI R:R):
//   FADE (default, asumsi SELALU mantul): harga nyentuh zona -> counter posisi, nyawa 1% FLAT
//     (jadi leverage), TP = zona LAWAN. Kena TP -> tutup (WIN), REVERSE (posisi baru arah
//     kebalikan di zona ini).
//   FOLLOW (override kalau zona GAGAL nahan/ditembus beneran, bukan cuma wick): ikutin arah
//     tembusan, target = zona BERIKUTNYA di arah situ. Kena target -> tutup, balik ke FADE lagi.
//   Kena LIKUIDASI di mode manapun -> tutup (LOSS), buka posisi baru lagi (cek zona ulang).
// Selalu (hampir) ada 1 posisi kebuka -- "ping-pong tiada henti" (istilah Olan). Symbol BTCUSDC,
// wallet USDC (terpisah dari Sniper yang pakai USDT, lihat project-kaela-btc-sinyal memory).
//
// GAK PAKAI ORDER SL TERPISAH (23 Agu 2026, permintaan Olan: "kita ga pake sl tp pastikan buka
// pake isolated jadi liq adalah sl.. tujuan biar ga usah ketik sl sl an") -- margin ISOLATED
// dipastiin eksplisit tiap buka posisi, LIKUIDASI-nya sendiri yang jadi nyawa (leverage udah
// dihitung dari nyawa 1% via calculator.js, jadi liquidation price otomatis mendekati level itu).
// Konsekuensi: monitoring TP/loss WAJIB nanya status REAL ke Binance (getPositionRisk) dulu tiap
// siklus, JANGAN cuma bandingin harga live vs angka SL yang "seharusnya" -- kalau posisi udah
// kelikuidasi SELAMA kita offline, kita gak akan pernah tau dari sisi kita doang, harus tanya
// exchange langsung + rekonsiliasi PNL asli dari income history (bukan asal tebak dari harga).
//
// SKEMA JURNAL 100% sama sniper-orders.json ({balance, orders[]} + status
// floating/closed_tp/closed_sl) -- gak ada lagi batas 100 trade evaluasi (era REAL manual lama).

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

const SYMBOL = 'BTCUSDC';
const MARGIN_ASSET = 'USDC';
const NYAWA_PCT = 2; // flat (23 Agu 2026, direvisi dari 1% -> 2%), dipakai buat nentuin LEVERAGE (bukan buat SL order -- itu gak ada lagi, likuidasi yang jadi SL)
const JOURNAL_PATH = path.join(__dirname, 'nyopet-journal.json');
// "Modal aktif" = 1/5 saldo (23 Agu 2026, permintaan Olan) -- BUKAN all-in tiap posisi, biar tahan
// beberapa siklus rugi beruntun tanpa ngabisin saldo sekaligus. Kalkulator exposure TETAP dipakai
// persis sama (WAJIB, "cheat anti rungkad"), cuma `modal` yang diinput ke situ udah dikecilin duluan.
const MODAL_ACTIVE_FRACTION = 1 / 5;

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

function sign(q, s) { return crypto.createHmac('sha256', s).update(q).digest('hex'); }
// Income history (realized PNL asli dari Binance) -- WAJIB dipakai buat rekonsiliasi kalau posisi
// ternyata udah closed/likuidasi SELAMA kita offline, JANGAN pernah nebak PNL dari harga sendiri
// (harga sekarang bisa udah jauh dari harga likuidasi asli).
async function fetchRealizedPnlSince(symbol, startTime) {
  const secrets = require('./secrets');
  const params = { symbol, startTime, timestamp: Date.now(), recvWindow: 5000, limit: 1000 };
  const query = new URLSearchParams(params).toString();
  const sig = sign(query, secrets.BINANCE_API_SECRET);
  const res = await fetch(`https://demo-fapi.binance.com/fapi/v1/income?${query}&signature=${sig}`, { headers: { 'X-MBX-APIKEY': secrets.BINANCE_API_KEY } });
  const income = await res.json();
  return income.reduce((s, inc) => s + parseFloat(inc.income), 0); // REALIZED_PNL + COMMISSION (udah negatif) + funding kalau ada
}

// Buka posisi beneran di Binance Demo + tulis ke journal (status floating) + kirim WA.
async function openPosition({ direction, tp, mode, zoneCtx }) {
  const [modalFull, livePrice] = await Promise.all([getAccountBalance(MARGIN_ASSET), fetchLivePrice()]);
  const modal = modalFull * MODAL_ACTIVE_FRACTION;
  const calc = hitungExposure({ modal, nyawa: NYAWA_PCT, entry: livePrice });
  console.log(`[NyopetAutoTrader] Saldo penuh $${modalFull.toFixed(2)} -> modal aktif (1/5) $${modal.toFixed(2)} | leverage ${calc.leverage}x`);

  await setIsolatedMargin(SYMBOL);
  await setLeverage(SYMBOL, calc.leverage);
  const entryOrder = await placeMarketEntry({ symbol: SYMBOL, direction, notionalUsd: calc.nilaiPosisi, livePrice });
  const qty = parseFloat(entryOrder.executedQty);
  const entryPrice = parseFloat(entryOrder.avgPrice);
  const posRisk = await getPositionRisk(SYMBOL);

  const order = {
    id: 'nyopet-demo-' + Date.now(), direction, status: 'floating', mode, entryPrice,
    liqPrice: parseFloat(posRisk.liquidationPrice), tp, qty,
    leverage: calc.leverage, marginUsd: calc.margin, zonePrice: zoneCtx.price, zoneKind: zoneCtx.kind,
    zoneTouches: zoneCtx.touches, triggeredAt: new Date().toISOString(),
  };
  const journal = loadJournal();
  journal.balance = modalFull;
  journal.orders.push(order);
  journal.watchZone = { price: zoneCtx.price, side: zoneCtx.side, zoneKind: zoneCtx.kind, touches: zoneCtx.touches };
  saveJournal(journal);

  const msg = formatAutoOpen({ ...order, sl: order.liqPrice }, new Date());
  console.log(msg + '\n');
  await sendWhatsApp(msg);
  return order;
}

// `alreadyClosed` (23 Agu 2026) -- true kalau posisi UDAH kelikuidasi/hilang duluan di exchange
// (ketauan pas getPositionRisk balik qty=0), PNL diambil dari income history asli. false kalau kita
// yang MUTUSIN nutup sekarang (kena TP), pakai emergencyCloseMarket seperti biasa.
async function closePosition(order, { alreadyClosed, realPnlUsd, won }) {
  let pnlUsd, exitPrice, pnlPct;
  if (alreadyClosed) {
    pnlUsd = realPnlUsd;
    exitPrice = order.direction === 'buy' ? order.entryPrice + pnlUsd / order.qty : order.entryPrice - pnlUsd / order.qty;
  } else {
    const closeOrder = await emergencyCloseMarket({ symbol: SYMBOL, direction: order.direction, quantity: order.qty });
    exitPrice = parseFloat(closeOrder.avgPrice) || order.tp;
    pnlUsd = order.direction === 'buy' ? (exitPrice - order.entryPrice) * order.qty : (order.entryPrice - exitPrice) * order.qty;
  }
  pnlPct = (pnlUsd / order.marginUsd) * 100;

  const journal = loadJournal();
  const target = journal.orders.find((o) => o.id === order.id);
  Object.assign(target, { status: won ? 'closed_tp' : 'closed_sl', exitPrice, pnlUsd, pnlPct, closedAt: new Date().toISOString() });
  saveJournal(journal);

  const msg = formatAutoClosed({ direction: order.direction === 'buy' ? 'long' : 'short', mode: order.mode, entryPrice: order.entryPrice, exitPrice, pnlUsd }, new Date())
    + (alreadyClosed ? '\n\n(⏳ Kelikuidasi PAS lagi offline -- baru kesinkronin sekarang begitu online lagi.)' : '');
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

  // 1. Ada posisi floating tercatat -- TANYA LANGSUNG ke Binance dulu, JANGAN percaya jurnal lokal
  // begitu aja (bisa aja udah kelikuidasi selama kita offline, lihat catatan di atas file).
  if (floating) {
    const posRisk = await getPositionRisk(SYMBOL);
    const stillOpen = Math.abs(parseFloat(posRisk.positionAmt)) > 0;

    if (!stillOpen) {
      console.log('[NyopetAutoTrader] Posisi UDAH GAK ADA di exchange (kelikuidasi/tertutup selama offline) -- rekonsiliasi dari income history.');
      const realPnlUsd = await fetchRealizedPnlSince(SYMBOL, new Date(floating.triggeredAt).getTime());
      await closePosition(floating, { alreadyClosed: true, realPnlUsd, won: realPnlUsd >= 0 });
      journal = loadJournal();
      journal.watchZone = realPnlUsd >= 0
        ? { price: floating.tp, side: floating.direction === 'buy' ? 'resistance' : 'support' }
        : journal.watchZone; // loss -- watchZone TETAP di zona yang sama (belum tentu bener2 ditembus)
      saveJournal(journal);
    } else {
      const livePrice = await fetchLivePrice();
      const hitTp = floating.direction === 'buy' ? livePrice >= floating.tp : livePrice <= floating.tp;
      if (hitTp) {
        console.log(`[NyopetAutoTrader] Target kena (${livePrice} vs TP ${floating.tp}) -- tutup untung, reverse.`);
        await closePosition(floating, { alreadyClosed: false, won: true });
        journal = loadJournal();
        journal.watchZone = { price: floating.tp, side: floating.direction === 'buy' ? 'resistance' : 'support' };
        saveJournal(journal);
      } else {
        console.log(`[NyopetAutoTrader] Posisi masih floating (${floating.direction} @ ${floating.entryPrice}, sekarang ${livePrice}, liq ${floating.liqPrice}) -- lanjut pantau.`);
        return;
      }
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
      const breakoutDirection = watchZone.side === 'support' ? 'sell' : 'buy';
      const pair = findNearestPair(latest5m.close, zones);
      const nextTarget = breakoutDirection === 'sell' ? pair.support : pair.resistance;
      if (!nextTarget) { console.log('[NyopetAutoTrader] Zona ditembus tapi belum ketemu target zona berikutnya -- tunggu siklus depan.'); return; }
      await openPosition({ direction: breakoutDirection, tp: nextTarget.price, mode: 'follow', zoneCtx: { price: watchZone.price, kind: watchZone.zoneKind || 'swing', touches: watchZone.touches, side: watchZone.side } });
      return;
    }
    const direction = watchZone.side === 'support' ? 'buy' : 'sell';
    const pair = findNearestPair(latest5m.close, zones);
    const tp = direction === 'buy' ? pair.resistance : pair.support;
    if (!tp) { console.log('[NyopetAutoTrader] Belum ketemu zona lawan buat TP -- tunggu siklus depan.'); return; }
    await openPosition({ direction, tp: tp.price, mode: 'fade', zoneCtx: { price: watchZone.price, kind: watchZone.zoneKind || 'swing', touches: watchZone.touches, side: watchZone.side } });
    return;
  }

  // 3. Belum pernah ada watchZone sama sekali (run pertama) -- tunggu touch beneran dulu.
  const touched = findTouchCandidate(latest5m, zones);
  if (!touched) { console.log('[NyopetAutoTrader] Belum ada zona ke-touch, dan belum ada watchZone -- tunggu siklus depan.'); return; }
  const pair = findNearestPair(latest5m.close, zones);
  const tp = touched.direction === 'long' ? pair.resistance : pair.support;
  await openPosition({ direction: touched.direction === 'long' ? 'buy' : 'sell', tp: tp ? tp.price : touched.price, mode: 'fade', zoneCtx: { price: touched.price, kind: touched.kind, touches: touched.touches, side: touched.direction === 'long' ? 'support' : 'resistance' } });
}

main().catch((e) => {
  console.error('ERROR nyopetAutoTrader.js:', e.message);
  process.exit(1);
});
