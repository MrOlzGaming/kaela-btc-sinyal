// Data layer buat sistem Nyopet Market MANUAL (gantiin auto-entry nyopetMonitor.js lama).
// Olan + Kaela ANALISA BARENG (chart+alat gambar di web), baru KEPUTUSAN order dicatat di sini.
// Eksekusi order ASLI tetap Olan sendiri di Binance -- ini cuma MONITOR/TRACKER, gak pernah
// eksekusi apapun. Saldo di sini SENGAJA saldo trading ASLI Olan (sinkron manual, konfirmasi
// user 2026-08-08) -- ditampilkan APA ADANYA di web publik (juga konfirmasi user, publik boleh
// lihat nominal asli). Mata uang USD, konsisten sama calculator.js/kalkulator.html.

const fs = require('fs');
const path = require('path');
const { localDateKey } = require('./config');

const ORDERS_PATH = path.join(__dirname, 'nyopet-orders.json');

function load() {
  if (!fs.existsSync(ORDERS_PATH)) return { balance: 0, balanceUpdatedAt: null, orders: [] };
  return JSON.parse(fs.readFileSync(ORDERS_PATH, 'utf8'));
}

function save(state) {
  fs.writeFileSync(ORDERS_PATH, JSON.stringify(state, null, 2));
}

function setBalance(amountUsd, date = new Date()) {
  const state = load();
  state.balance = amountUsd;
  state.balanceUpdatedAt = date.toISOString();
  save(state);
  return state;
}

// order: { direction:'buy'|'sell', strategyType:'range'|'breakout'|'trend', triggerPrice,
//          testLevel (opsional, buat setup fade/rejection -- lihat nyopetOrderMonitor.js),
//          confirmationNote, tpReasoning (alasan pemilihan TP, lihat nyopetAutoAnalysis.js
//          pickAdaptiveTp), tp, sl, exposure, leverage, marginUsd, notes,
//          patternType/partialTp/trailSmaLen (opsional, 10 Agu 2026 -- strategi pola chart
//          flag/wedge: exit 2 tahap, separuh di partialTp lalu sisanya di-trail. Order LAMA
//          [zona breakout biasa] gak isi field ini, tetap jalan TP/SL tunggal seperti biasa) }
function createOrder(order, date = new Date()) {
  const state = load();
  const id = date.getTime().toString(36) + Math.random().toString(36).slice(2, 6);
  // ID Sinyal manusiawi: YYYYMMDD (kalender WITA) + nomor urut 2 digit HARI ITU.
  // Contoh: 2026080801 = 2026, bulan 08, tanggal 08, sinyal ke-1 hari itu.
  const dayKey = localDateKey(date).replace(/-/g, ''); // 'YYYY-MM-DD' -> 'YYYYMMDD'
  const countToday = (state.orders || []).filter((o) => (o.signalId || '').startsWith(dayKey)).length;
  const signalId = dayKey + String(countToday + 1).padStart(2, '0');
  const entry = {
    id,
    signalId,
    status: 'pending', // pending -> floating -> closed_tp | closed_sl ; atau pending -> cancelled
    direction: order.direction,
    strategyType: order.strategyType || null,
    triggerPrice: order.triggerPrice,
    testLevel: order.testLevel ?? null,
    confirmationNote: order.confirmationNote || '',
    tpReasoning: order.tpReasoning || '',
    entryPrice: null,
    tp: order.tp,
    sl: order.sl,
    originalSl: order.sl,
    exposure: order.exposure ?? null,
    leverage: order.leverage ?? null,
    marginUsd: order.marginUsd ?? null,
    notes: order.notes || '',
    patternType: order.patternType ?? null,
    partialTp: order.partialTp ?? null,
    partialDone: false,
    remainingFraction: 1,
    trailSmaLen: order.trailSmaLen ?? null,
    realizedPnlUsd: 0,
    // silentTest (14 Agu 2026, buat order trial/simulasi) -- tetap kecatat NORMAL di web/jurnal/
    // bankroll, tapi nyopetOrderMonitor.js WAJIB skip WA SELAMANYA buat order ini (beda dari
    // isWaMuted() yang cuma nunda sementara).
    silentTest: order.silentTest === true,
    createdAt: date.toISOString(),
    triggeredAt: null,
    closedAt: null,
    closeReason: null,
    pnlUsd: null,
    pnlPct: null,
  };
  state.orders.push(entry);
  save(state);
  return entry;
}

function updateOrder(id, patch) {
  const state = load();
  const idx = state.orders.findIndex((o) => o.id === id);
  if (idx === -1) return null;
  state.orders[idx] = { ...state.orders[idx], ...patch };
  save(state);
  return state.orders[idx];
}

function cancelOrder(id, date = new Date()) {
  return updateOrder(id, { status: 'cancelled', closedAt: date.toISOString(), closeReason: 'dibatalkan manual' });
}

function getActiveOrders() {
  return load().orders.filter((o) => o.status === 'pending' || o.status === 'floating');
}

function getClosedOrders() {
  return load().orders.filter((o) => o.status.startsWith('closed') || o.status === 'cancelled').reverse();
}

module.exports = {
  ORDERS_PATH, load, save, setBalance, createOrder, updateOrder, cancelOrder, getActiveOrders, getClosedOrders,
};
