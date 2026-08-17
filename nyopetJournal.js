// Jurnal JUJUR trading Nyopet Market (Dark Kaela) -- posisi REAL, dibuka MANUAL oleh Olan
// langsung di exchange asli, sistem cuma MEMANTAU + MENCATAT (permintaan Olan 16 Agu 2026:
// "trading jujur kita nyopet market.. buat jurnal jujur.. tracking winrate 100 trade ke depan,
// jika sudah kecapai kita bisa evaluasi"). Saldo/bankroll SENGAJA gak dihitung ("saldo berjalan
// hiraukan.. ini hanya mini game") -- cuma hasil menang/kalah tiap trade yang dicatat jadi winrate.

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
    profit100Notified: false,
    openedAt: now.toISOString(), notes: notes || null,
  };
  save(data);
  return data.openPosition;
}

function markProfit100Notified() {
  const data = load();
  if (data.openPosition) { data.openPosition.profit100Notified = true; save(data); }
}

function closePosition({ exitPrice, exitReason, result }, now = new Date()) {
  const data = load();
  if (!data.openPosition) throw new Error('Gak ada posisi Nyopet yang lagi terbuka.');
  const pos = data.openPosition;
  const trade = { ...pos, exitPrice, exitReason, result, closedAt: now.toISOString() };
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
  return { total, wins, losses, winRate, openPosition: data.openPosition, targetTrades: TARGET_TRADES, trades: data.trades };
}

module.exports = { load, save, openPosition, closePosition, markProfit100Notified, getSummary, JOURNAL_PATH, TARGET_TRADES };
