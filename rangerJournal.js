// Jurnal JUJUR trading Nyopet Market (Dark Kaela) -- posisi REAL, dibuka MANUAL oleh Olan
// langsung di exchange asli, sistem cuma MEMANTAU + MENCATAT (permintaan Olan 16 Agu 2026:
// "trading jujur kita nyopet market.. buat jurnal jujur.. tracking winrate 100 trade ke depan,
// jika sudah kecapai kita bisa evaluasi"). Saldo/bankroll BERJALAN (compound/sizing) SENGAJA gak
// dihitung ("saldo berjalan hiraukan.. ini hanya mini game") -- TAPI PNL $ jujur per-trade TETAP
// dicatat (17 Agu 2026: "kasih dengan jujur pnl berjalan.. jadi nanti ketauan 100 trade minus apa
// plus") -- beda hal: gak nge-compound modal buat sizing, tapi hasil $ tetap dihitung apa adanya.

// PNL $ dari 1 trade -- rumus SAMA PERSIS kayak ROI% di nyopetPositionMonitor.js (udah
// diverifikasi cocok sama tampilan exchange asli Olan). KHUSUS likuidasi: margin HABIS TOTAL di
// isolated margin (bukan sekadar "harga udah lewat dikit dari liq") -- exitPrice hasil deteksi
// cron (interval ~5 menit) bisa aja udah lewat jauh dari liqPrice pas kedeteksi, rumus biasa bisa
// nunjukkin rugi >100% margin yang gak realistis (di real exchange gak mungkin rugi lebih dari
// margin sendiri di isolated mode) -- makanya likuidasi SELALU -marginUsd persis, bukan dihitung.
function computePnlUsd(pos, exitPrice, exitReason) {
  if (exitReason === 'liquidasi') return -pos.marginUsd;
  const roiPct = pos.direction === 'short'
    ? (pos.entryPrice - exitPrice) / pos.entryPrice * pos.leverage * 100
    : (exitPrice - pos.entryPrice) / pos.entryPrice * pos.leverage * 100;
  return pos.marginUsd * roiPct / 100;
}

const fs = require('fs');
const path = require('path');
const JOURNAL_PATH = path.join(__dirname, 'nyopet-journal.json');
const TARGET_TRADES = 100;

function load() {
  if (!fs.existsSync(JOURNAL_PATH)) return { openPosition: null, trades: [] };
  return JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8'));
}
function save(data) {
  fs.writeFileSync(JOURNAL_PATH, JSON.stringify(data, null, 2));
}

function openPosition({ direction, entryPrice, liqPrice, marginUsd, sizeUsd, leverage, notes }, now = new Date()) {
  const data = load();
  if (data.openPosition) throw new Error('Udah ada posisi Nyopet yang lagi terbuka -- tutup dulu sebelum buka baru (1 posisi per waktu).');
  data.openPosition = {
    id: 'nyopet-' + now.getTime(),
    direction, entryPrice, liqPrice, marginUsd, sizeUsd, leverage,
    profit100Notified: false, warning80Notified: false,
    openedAt: now.toISOString(), notes: notes || null,
  };
  save(data);
  return data.openPosition;
}

function markProfit100Notified() {
  const data = load();
  if (data.openPosition) { data.openPosition.profit100Notified = true; save(data); }
}

function markWarning80Notified() {
  const data = load();
  if (data.openPosition) { data.openPosition.warning80Notified = true; save(data); }
}

function closePosition({ exitPrice, exitReason, result }, now = new Date()) {
  const data = load();
  if (!data.openPosition) throw new Error('Gak ada posisi Nyopet yang lagi terbuka.');
  const pos = data.openPosition;
  const pnlUsd = computePnlUsd(pos, exitPrice, exitReason);
  const trade = { ...pos, exitPrice, exitReason, result, pnlUsd, closedAt: now.toISOString() };
  data.trades.push(trade);
  data.openPosition = null;
  save(data);
  return trade;
}

function getSummary() {
  const data = load();
  const wins = data.trades.filter((t) => t.result === 'win').length;
  const losses = data.trades.filter((t) => t.result === 'loss').length;
  const total = data.trades.length;
  const winRate = total ? (wins / total) * 100 : 0;
  const totalPnlUsd = data.trades.reduce((sum, t) => sum + (t.pnlUsd || 0), 0);
  return { total, wins, losses, winRate, totalPnlUsd, openPosition: data.openPosition, targetTrades: TARGET_TRADES, trades: data.trades };
}

module.exports = { load, save, openPosition, closePosition, markProfit100Notified, markWarning80Notified, getSummary, JOURNAL_PATH, TARGET_TRADES };
