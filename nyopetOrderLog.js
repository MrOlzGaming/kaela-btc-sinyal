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

function seqLabel(order) {
  return order.signalId ? `🆔 ID Sinyal: ${order.signalId}` : '';
}

function formatRencana(order) {
  const lines = [
    `${CATEGORY_COLOR.nyopet.emoji} ⚡ NYOPET MARKET — 📋 RENCANA (analisa Kaela)`,
    seqLabel(order),
    `${DIR_LABEL[order.direction] || order.direction} · ${STRATEGY_LABEL[order.strategyType] || ''}`,
    '',
    `🎯 Harga: ${fmt(order.triggerPrice)}`,
    `✅ TP: ${fmt(order.tp)}`,
  ];
  if (order.confirmationNote) lines.push('', `📋 Kondisi: ${order.confirmationNote}`);
  if (order.notes) lines.push('', `📝 ${order.notes}`);
  lines.push(
    '',
    `🧮 Hitung volume/margin: ${WEB_URL}/kalkulator.html`,
    '(masukin Modal + Harga Order Entry + Area Liquidasi)',
    '',
    '🚨 JANGAN ALL-IN! Modal wajib terpisah, yang memang siap hilang.',
    '',
    nowStr(),
    `🔗 ${WEB_URL}`,
  );
  return lines.join('\n');
}

function formatTriggered(order) {
  return [
    `${CATEGORY_COLOR.nyopet.emoji} ⚡ NYOPET MARKET — ✅ KENA TRIGGER, SEKARANG FLOATING`,
    seqLabel(order),
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
    seqLabel(order),
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

// Heartbeat harian ~08:05 WITA (abis candle Daily closed) -- BUKAN sinyal, murni status +
// ajakan Olan buka chat buat analisa multi-timeframe bareng. Gak diarsipkan ke web sama sekali
// (konsisten kebijakan "belum valid = gak tampil dimanapun"), dedup dicek via
// nyopet-trigger-state.json (lihat nyopetDailyTrigger.js).
function formatDailyTrigger(btcPrice) {
  return [
    `${CATEGORY_COLOR.nyopet.emoji} ⚡ NYOPET MARKET — 🔍 Kaela lagi kerja`,
    '',
    `Lagi ngumpulin data & analisa BTC multi-timeframe (harga sekarang: ${fmt(btcPrice)})...`,
    'Kalau ada setup yang masuk akal, baru diinfoin di sini setelah VALID.',
    '',
    nowStr(),
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

function formatCancelled(order) {
  return [
    `${CATEGORY_COLOR.nyopet.emoji} ⚡ NYOPET MARKET — 🚫 RENCANA DIBATALKAN`,
    seqLabel(order),
    `${DIR_LABEL[order.direction] || order.direction} @ trigger ${fmt(order.triggerPrice)} -- dibatalkan sebelum kena trigger.`,
    '',
    nowStr(),
  ].join('\n');
}

// Analisa gabungan OTOMATIS harian (9 Agu 2026, nyopetAutoAnalysis.js) -- 3 bagian WAJIB
// (keputusan Olan): Analisa Teknikal + Liquidation Heatmap + Kesimpulan VALID/INVALID.
// VALID = posisi BAYANGAN langsung dibuka (murni perhitungan, TIDAK ADA uang bergerak -- Kaela
// bukan eksekutor finansial, cuma "kalkulator logika"). Eksekusi ASLI (kalau Olan mau ikut)
// tetap manual di Binance.

function liqLine(liq) {
  if (liq.error) return 'Liquidation heatmap: gagal ambil data kali ini (dilewatin, gak fatal).';
  return liq.btcCount === 0
    ? `0 liquidation BTCUSDT terpantau (koin lain tetap ada liquidation jalan) -- volatilitas BTC rendah.`
    : `${liq.btcCount} liquidation BTCUSDT terpantau dalam window singkat -- ada tekanan leverage kena stop.`;
}

// Lapis ke-4 (9 Agu 2026): Sentimen & Posisi Pasar -- gratis (alternative.me + Binance Futures),
// beda dari struktur harga (taLines) dan event liquidation (liqLine).
function fundingPct(rate) {
  return (rate * 100).toFixed(4) + '%';
}

// Partial-OK -- tiap sumber independen (lihat marketSentiment.js), field yang gagal
// (geo-block derivatif dari runner GH Actions, pernah kejadian 9 Agu 2026) ditandai jelas,
// BUKAN bikin seluruh lapis sentimen ilang.
function sentimentLines(sentiment) {
  if (!sentiment) return ['Sentimen & posisi pasar: gagal ambil data kali ini (dilewatin, gak fatal).'];
  const { fearGreed, funding, openInterest, longShort } = sentiment;
  return [
    fearGreed ? `Fear & Greed Index: ${fearGreed.value}/100 (${fearGreed.classification})` : 'Fear & Greed Index: gagal ambil data.',
    funding ? `Funding Rate: ${fundingPct(funding.rate)} (${funding.rate >= 0 ? 'long bayar short' : 'short bayar long'})` : 'Funding Rate: gagal ambil data.',
    openInterest ? `Open Interest: ${openInterest.openInterest.toLocaleString('en-US', { maximumFractionDigits: 0 })} BTC` : 'Open Interest: gagal ambil data.',
    longShort ? `Long/Short Ratio (akun): ${(longShort.longAccount * 100).toFixed(1)}% long / ${(longShort.shortAccount * 100).toFixed(1)}% short` : 'Long/Short Ratio: gagal ambil data.',
  ];
}

// Lapis ke-5 (9 Agu 2026): On-chain metrics -- SOPR + NUPL (lebih pas jangka pendek-menengah
// dibanding MVRV/Puell yang dipakai buat siklus Halving). Null-safe sama kayak sentimentLines.
function onchainLines(onchain) {
  if (!onchain) return ['On-chain metrics: gagal ambil data kali ini (dilewatin, gak fatal).'];
  const { sopr, nupl } = onchain;
  return [
    sopr ? `SOPR: ${sopr.value.toFixed(4)} (${sopr.classification})` : 'SOPR: gagal ambil data.',
    nupl ? `NUPL: ${nupl.value.toFixed(4)} (${nupl.classification})` : 'NUPL: gagal ambil data.',
  ];
}

const WEEKLY_TREND_LABEL = { bullish: '📈 Bullish', bearish: '📉 Bearish', netral: '➡️ Netral' };

function taLines(ta) {
  const r = ta.resistanceZones[0], s = ta.supportZones[0];
  return [
    `Harga: ${fmt(ta.lastPrice)}`,
    `MA20 ${fmt(ta.ma.ma20)} / MA50 ${fmt(ta.ma.ma50)} / MA200 ${fmt(ta.ma.ma200)} -- ${ta.crossSignal === 'bearish_cross_active' ? 'Death Cross aktif' : ta.crossSignal === 'bullish_cross_active' ? 'Golden Cross aktif' : ta.crossSignal || '-'}`,
    `RSI14: ${ta.rsi14Daily.toFixed(0)}`,
    `Trend Weekly: ${ta.weeklyTrend ? WEEKLY_TREND_LABEL[ta.weeklyTrend] : 'belum cukup data'}`,
    r ? `Resistance kunci: ${fmt(r.price)} (tersentuh ${r.touches}x)` : 'Resistance: belum terdeteksi zona jelas',
    s ? `Support kunci: ${fmt(s.price)} (tersentuh ${s.touches}x)` : 'Support: belum terdeteksi zona jelas',
  ];
}

function formatAutoValid({ order, ta, liq, sentiment, onchain }) {
  return [
    `${CATEGORY_COLOR.nyopet.emoji} 🤖 NYOPET MARKET — ✅ VALID (analisa otomatis Kaela)`,
    seqLabel(order),
    `${DIR_LABEL[order.direction] || order.direction} @ ${fmt(order.entryPrice)} (harga pasar, langsung entry -- bukan nunggu order)`,
    '',
    '📊 ANALISA TEKNIKAL',
    ...taLines(ta),
    '',
    '🔥 LIQUIDATION HEATMAP',
    liqLine(liq),
    '',
    '🌊 SENTIMEN & POSISI PASAR',
    ...sentimentLines(sentiment),
    '',
    '⛓️ ON-CHAIN METRICS',
    ...onchainLines(onchain),
    '',
    `✅ TP: ${fmt(order.tp)}`,
    `❌ SL: ${fmt(order.sl)}`,
    order.tpReasoning ? `📐 ${order.tpReasoning}` : '',
    `Exposure ${order.exposure}× · Leverage ${order.leverage}× · Margin ${fmt(order.marginUsd)}`,
    '',
    order.confirmationNote,
    '',
    '🎭 Ini POSISI BAYANGAN -- murni perhitungan Kaela, TIDAK ADA uang bergerak. Eksekusi asli (kalau mau ikut) tetap manual sendiri di Binance.',
    '🚨 JANGAN ALL-IN! Trading kripto resiko tinggi.',
    '',
    nowStr(),
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

function formatAutoInvalid({ ta, dailyClose, livePrice, liq, sentiment, onchain, weeklyBlocked }) {
  const r = ta.resistanceZones[0], s = ta.supportZones[0];
  const syaratLine = weeklyBlocked
    ? `📋 Candle harian udah breakout arah ${DIR_LABEL[weeklyBlocked] || weeklyBlocked}, TAPI trend Weekly masih ${WEEKLY_TREND_LABEL[ta.weeklyTrend]} -- ditahan dulu biar gak lawan arah trend besar. Nunggu trend Weekly berbalik, atau breakout berikutnya lebih kuat.`
    : '📋 Syarat yang ditunggu: candle harian CLOSE di atas ' + (r ? fmt(r.priceMax) : '(resistance belum jelas)') + ' (breakout naik) atau di bawah ' + (s ? fmt(s.priceMin) : '(support belum jelas)') + ' (breakdown turun).';
  return [
    `${CATEGORY_COLOR.nyopet.emoji} 🤖 NYOPET MARKET — ❌ INVALID (analisa otomatis Kaela)`,
    'Belum ada posisi. Masih nunggu syarat terpenuhi.',
    '',
    '📊 ANALISA TEKNIKAL',
    ...taLines(ta),
    `Candle harian terakhir close: ${fmt(dailyClose)} | Harga sekarang: ${fmt(livePrice)}`,
    '',
    '🔥 LIQUIDATION HEATMAP',
    liqLine(liq),
    '',
    '🌊 SENTIMEN & POSISI PASAR',
    ...sentimentLines(sentiment),
    '',
    '⛓️ ON-CHAIN METRICS',
    ...onchainLines(onchain),
    '',
    syaratLine,
    '',
    nowStr(),
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

module.exports = { formatRencana, formatTriggered, formatClosed, formatCancelled, formatDailyTrigger, formatAutoValid, formatAutoInvalid };
