// Format pesan Nyopet Market MANUAL -- 4 momen (rencana/trigger/closed_tp/closed_sl), diposting
// ke WEB (arsip) DAN grup WA "BTC Sniper Club". WA cuma dikirim pas ADA PERUBAHAN STATUS
// (rencana dibuat / kena trigger / closed) -- BUKAN tiap kali dicek (hindari spam "masih floating"
// tiap jam, lihat archive.js anti-dobel lesson). Floating P&L LIVE cukup di web (client-side).

const { WEB_URL, toLocal } = require('./config');
const { CATEGORY_COLOR } = require('./categoryColors');

function fmt(n) {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: n < 1000 ? 2 : 0 });
}

function nowStr() {
  return toLocal(new Date()).toISOString().slice(0, 16).replace('T', ' ') + ' WITA';
}

const DIR_LABEL = { buy: '🟢 BUY', sell: '🔴 SELL' };
const STRATEGY_LABEL = { range: 'Range Trading', breakout: 'Breakout', trend: 'Trend Following' };

function formatRencana(order) {
  const lines = [
    `${CATEGORY_COLOR.nyopet.emoji} ⚡ NYOPET MARKET — 📋 RENCANA (analisa Kaela)`,
    `${DIR_LABEL[order.direction] || order.direction} · ${STRATEGY_LABEL[order.strategyType] || ''}`,
    '',
    `🎯 Harga: ${fmt(order.triggerPrice)}`,
    `✅ TP: ${fmt(order.tp)}`,
  ];
  if (order.confirmationNote) lines.push('', `📋 Kondisi: ${order.confirmationNote}`);
  if (order.notes) lines.push('', `📝 ${order.notes}`);
  lines.push(
    '',
    'Volume/margin pakai Kalkulator OLZ Exposure di web -- tinggal masukin modal.',
    '',
    nowStr(),
    `🔗 ${WEB_URL}`,
  );
  return lines.join('\n');
}

function formatTriggered(order) {
  return [
    `${CATEGORY_COLOR.nyopet.emoji} ⚡ NYOPET MARKET — ✅ KENA TRIGGER, SEKARANG FLOATING`,
    `${DIR_LABEL[order.direction] || order.direction} @ ${fmt(order.entryPrice)}`,
    '',
    `✅ TP: ${fmt(order.tp)}`,
    `❌ SL: ${fmt(order.sl)}`,
    '',
    'Live floating P&L bisa dipantau di web.',
    '',
    nowStr(),
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

function formatClosed(order) {
  const won = order.status === 'closed_tp';
  const pnlSign = order.pnlUsd >= 0 ? '+' : '-';
  return [
    `${CATEGORY_COLOR.nyopet.emoji} ⚡ NYOPET MARKET — ${won ? '✅ TP KENA' : '❌ KENA STOP LOSS'}`,
    `${DIR_LABEL[order.direction] || order.direction}`,
    '',
    `Entry: ${fmt(order.entryPrice)}`,
    `Exit (${won ? 'TP' : 'SL'}): ${fmt(won ? order.tp : order.sl)}`,
    `P&L: ${pnlSign}${fmt(Math.abs(order.pnlUsd))} (${pnlSign}${Math.abs(order.pnlPct).toFixed(2)}%)`,
    '',
    nowStr(),
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

function formatCancelled(order) {
  return [
    `${CATEGORY_COLOR.nyopet.emoji} ⚡ NYOPET MARKET — 🚫 RENCANA DIBATALKAN`,
    `${DIR_LABEL[order.direction] || order.direction} @ trigger ${fmt(order.triggerPrice)} -- dibatalkan sebelum kena trigger.`,
    '',
    nowStr(),
  ].join('\n');
}

module.exports = { formatRencana, formatTriggered, formatClosed, formatCancelled };
