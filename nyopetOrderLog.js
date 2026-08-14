// Format pesan Sniper MANUAL (rename dari "Nyopet Market", 12 Agu 2026) -- 4 momen (rencana/trigger/closed_tp/closed_sl), diposting
// ke WEB (arsip) DAN grup WA "BTC Sniper Club". WA cuma dikirim pas ADA PERUBAHAN STATUS
// (rencana dibuat / kena trigger / closed) -- BUKAN tiap kali dicek (hindari spam "masih floating"
// tiap jam, lihat archive.js anti-dobel lesson). Floating P&L LIVE cukup di web (client-side).

const { WEB_URL, toLocal } = require('./config');
const { CATEGORY_COLOR } = require('./categoryColors');
const { getExtremeFearGreedNote } = require('./fearGreedInsight');

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

// Harga LIKUIDASI (14 Agu 2026, permintaan Olan: "ada liquidated dimana") -- BEDA dari SL walau
// sering deket/sama: margin abis kalau harga gerak 100/leverage% lawan posisi. SL biasanya
// kena DULUAN (floor(leverage) di calculator.js ngasih buffer kecil), tapi titik likuidasi
// sesungguhnya tetap ditampilkan terpisah, jangan disamain sama SL biar gak nyesatin.
function liquidationPrice(order) {
  if (!order.leverage || !order.entryPrice) return null;
  const distPct = 100 / order.leverage;
  return order.direction === 'buy' ? order.entryPrice * (1 - distPct / 100) : order.entryPrice * (1 + distPct / 100);
}

// Baris margin/leverage/volume/likuidasi -- volume (nilai posisi/notional) = margin x leverage,
// dihitung on-the-fly (bukan field tersendiri di data).
function tradeMetaLine(order) {
  const volumeUsd = (order.marginUsd && order.leverage) ? order.marginUsd * order.leverage : null;
  const liqPrice = liquidationPrice(order);
  return `Margin ${fmt(order.marginUsd)} · Leverage ${order.leverage}× · Volume ${volumeUsd !== null ? fmt(volumeUsd) : '-'}${liqPrice !== null ? ` · Liquidated @ ${fmt(liqPrice)}` : ''}`;
}

function formatRencana(order) {
  const lines = [
    `${CATEGORY_COLOR.nyopet.emoji} 🎯 SNIPER — 📋 RENCANA (analisa Kaela)`,
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
    `${CATEGORY_COLOR.nyopet.emoji} 🎯 SNIPER — ✅ KENA TRIGGER, SEKARANG FLOATING`,
    seqLabel(order),
    `${DIR_LABEL[order.direction] || order.direction} @ ${fmt(order.entryPrice)}`,
    '',
    `✅ TP: ${fmt(order.tp)}`,
    `❌ SL: ${fmt(order.sl)}`,
    order.leverage ? tradeMetaLine(order) : '',
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
  const exitLabelMap = { TP: '✅ TP KENA', SL: '❌ KENA STOP LOSS', SL_BREAKEVEN: '⚪ TUTUP DI BREAKEVEN (abis partial)', TRAIL: '🏁 TUTUP -- MOMENTUM PATAH (trailing exit)' };
  const exitLabel = exitLabelMap[order.closeReason] || (won ? '✅ TP KENA' : '❌ KENA STOP LOSS');
  return [
    `${CATEGORY_COLOR.nyopet.emoji} 🎯 SNIPER — ${exitLabel}`,
    seqLabel(order),
    `${DIR_LABEL[order.direction] || order.direction}`,
    '',
    `Entry: ${fmt(order.entryPrice)}`,
    `Exit (${order.closeReason || (won ? 'TP' : 'SL')}): ${fmt(order.exitPrice ?? (won ? order.tp : order.sl))}`,
    order.partialDone ? `(Ini penutupan sisa posisi -- separuh pertama udah diamankan duluan pas kena target tahap 1)` : '',
    `P&L TOTAL: ${pnlSign}${fmt(Math.abs(order.pnlUsd))} (${pnlSign}${Math.abs(order.pnlPct).toFixed(2)}%)`,
    '',
    nowStr(),
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

// Notifikasi TAHAP 1 (10 Agu 2026, strategi pola chart flag/wedge) -- separuh posisi diamankan
// pas kena target 2R, SL sisanya digeser ke breakeven (gak bisa rugi lagi dari titik ini), sisa
// separuh di-trail pakai SMA harian sampai momentum patah. Notifikasi TERPISAH dari formatClosed
// (posisi BELUM full closed, cuma dikurangin).
function formatPartialClosed(order) {
  const pnlSign = order.realizedPnlUsd >= 0 ? '+' : '-';
  return [
    `${CATEGORY_COLOR.nyopet.emoji} 🎯 SNIPER — 🟡 TARGET TAHAP 1 KENA (separuh diamankan)`,
    seqLabel(order),
    `${DIR_LABEL[order.direction] || order.direction}`,
    '',
    `Entry: ${fmt(order.entryPrice)}`,
    `Separuh posisi diamankan @ ${fmt(order.partialTp)} -- P&L separuh: ${pnlSign}${fmt(Math.abs(order.realizedPnlUsd))}`,
    `SL sisa separuh digeser ke BREAKEVEN (${fmt(order.entryPrice)}) -- gak bisa rugi lagi dari sini.`,
    `Sisa separuh di-trail pakai SMA${order.trailSmaLen} harian -- ditutup kalau momentum patah, biar gak buru-buru lepas semua pas trend masih jalan.`,
    '',
    nowStr(),
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

// Laporan PEMANTAUAN harian (12 Agu 2026, permintaan Olan: "saat dipantau, tiap hari berarti
// laporan sinyalnya dalam bentuk posisi dia sendiri yang dipantau") -- SELAMA ada posisi
// floating, Kaela gak lagi diam total tiap hari (dulu skip penuh). Bukan sinyal BARU -- status
// posisi yang UDAH terbuka: floating P&L hari ini, jarak ke SL/TP, udah berapa hari ditahan.
function formatPositionMonitor(order, livePrice) {
  const sign = order.direction === 'buy' ? 1 : -1;
  const movePct = ((livePrice - order.entryPrice) / order.entryPrice) * 100 * sign;
  const remFrac = order.remainingFraction !== undefined && order.remainingFraction !== null ? order.remainingFraction : 1;
  const leverage = order.leverage || 1;
  const floatingPnlUsd = order.marginUsd ? (order.marginUsd * remFrac * movePct * leverage) / 100 : null;
  const totalPnlUsd = floatingPnlUsd !== null ? floatingPnlUsd + (order.realizedPnlUsd || 0) : null;
  const daysHeld = order.triggeredAt ? Math.floor((Date.now() - new Date(order.triggeredAt).getTime()) / 86400000) : null;

  const statusLine = order.partialDone
    ? `🟡 Tahap 1 udah diamankan (${order.realizedPnlUsd >= 0 ? '+' : ''}${fmt(order.realizedPnlUsd || 0)}) -- SL sisa di BREAKEVEN (${fmt(order.entryPrice)}), sisa ${(remFrac * 100).toFixed(0)}% posisi di-trail SMA${order.trailSmaLen} harian.`
    : `❌ SL: ${fmt(order.sl)}  🎯 TP tahap 1: ${fmt(order.partialTp)}`;

  const lines = [
    `${CATEGORY_COLOR.nyopet.emoji} 🎯 SNIPER — 📡 PEMANTAUAN POSISI${daysHeld !== null ? ` (hari ke-${daysHeld + 1})` : ''}`,
    seqLabel(order),
    `${DIR_LABEL[order.direction] || order.direction} @ ${fmt(order.entryPrice)} -- masih FLOATING, bukan sinyal baru.`,
    '',
    `Harga sekarang: ${fmt(livePrice)} (${movePct >= 0 ? '+' : ''}${movePct.toFixed(2)}% dari entry)`,
    statusLine,
  ];
  if (totalPnlUsd !== null) lines.push(`P&L saat ini: ${totalPnlUsd >= 0 ? '+' : ''}${fmt(Math.abs(totalPnlUsd))}`);
  lines.push(
    '',
    '🎭 Posisi bayangan, murni perhitungan -- eksekusi asli (kalau ikut) tetap manual sendiri di Binance.',
    '',
    nowStr(),
    `🔗 ${WEB_URL}`,
  );
  return lines.join('\n');
}

// Heartbeat harian ~08:05 WITA (abis candle Daily closed) -- BUKAN sinyal, murni status +
// ajakan Olan buka chat buat analisa multi-timeframe bareng. Gak diarsipkan ke web sama sekali
// (konsisten kebijakan "belum valid = gak tampil dimanapun"), dedup dicek via
// nyopet-trigger-state.json (lihat nyopetDailyTrigger.js).
function formatDailyTrigger(btcPrice) {
  return [
    `${CATEGORY_COLOR.nyopet.emoji} 🎯 SNIPER — 🔍 Kaela lagi kerja`,
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
    `${CATEGORY_COLOR.nyopet.emoji} 🎯 SNIPER — 🚫 RENCANA DIBATALKAN`,
    seqLabel(order),
    `${DIR_LABEL[order.direction] || order.direction} @ trigger ${fmt(order.triggerPrice)} -- dibatalkan sebelum kena trigger.`,
    '',
    nowStr(),
  ].join('\n');
}

// Analisa gabungan OTOMATIS harian (9 Agu 2026, nyopetAutoAnalysis.js) -- Analisa Teknikal +
// Sentimen + On-chain + Kesimpulan VALID/INVALID (Liquidation Heatmap dicabut 12 Agu 2026, lihat
// liqLine() di bawah). VALID = posisi BAYANGAN langsung dibuka (murni perhitungan, TIDAK ADA
// uang bergerak -- Kaela bukan eksekutor finansial, cuma "kalkulator logika"). Eksekusi ASLI
// (kalau Olan mau ikut) tetap manual di Binance.

// Liquidation heatmap OTOMATIS DICABUT (12 Agu 2026) -- Kaela gak mampu akses data ini gratis
// & akurat dari infrastruktur yang ada (Binance kemungkinan blokir WebSocket streaming dari IP
// datacenter GitHub Actions, ketauan lewat kecurigaan Olan "0 liquidation tiap hari gak
// mungkin"). Daripada nampilin angka yang gak bisa dipercaya, dikasih link buat cek MANUAL.
function liqLine() {
  return `Liquidation heatmap otomatis DIMATIKAN -- Kaela gak bisa akses data ini gratis & akurat dari infrastrukturnya. Cek manual: https://www.coinglass.com/LiquidationData`;
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

// Level TP 1:1/1:2/1:3 (11 Agu 2026, permintaan Olan: "kasih SL + TP 1:1/1:2/1:3 sekalian,
// biar bisa dibandingin sama analisaku sendiri") -- MURNI TAMPILAN referensi, dihitung langsung
// dari entry+SL. Exit BENERAN tetap ikut mekanisme partial 2R + trailing SMA (lihat
// nyopetOrderMonitor.js) -- ini gak ngubah eksekusi, cuma kasih konteks R-multiple lengkap.
function rMultipleLevels(order) {
  const risk = Math.abs(order.entryPrice - order.sl);
  const nyawaPct = risk / order.entryPrice * 100;
  const sign = order.direction === 'buy' ? 1 : -1;
  const at = (r) => order.entryPrice + sign * risk * r;
  return [
    `❌ SL: ${fmt(order.sl)} (nyawa ${nyawaPct.toFixed(1)}% -- jarak entry-SL, biar gampang diinput ulang manual)`,
    `🎯 TP 1:1 = ${fmt(at(1))}  |  1:2 = ${fmt(at(2))}  |  1:3 = ${fmt(at(3))}`,
    `   (eksekusi beneran: partial di 1:2 -- jual separuh, sisanya di-trail SMA harian sampai momentum patah)`,
  ];
}

function formatAutoValid({ order, ta, sentiment, onchain }) {
  const extremeNote = getExtremeFearGreedNote(sentiment && sentiment.fearGreed);
  return [
    `${CATEGORY_COLOR.nyopet.emoji} 🤖 SNIPER — ✅ VALID (analisa otomatis Kaela)`,
    seqLabel(order),
    `${DIR_LABEL[order.direction] || order.direction} @ ${fmt(order.entryPrice)} (harga pasar, langsung entry -- bukan nunggu order)`,
    ...rMultipleLevels(order),
    '',
    '📊 ANALISA TEKNIKAL',
    ...taLines(ta),
    '',
    '🔥 LIQUIDATION HEATMAP',
    liqLine(),
    '',
    '🌊 SENTIMEN & POSISI PASAR',
    ...sentimentLines(sentiment),
    ...(extremeNote ? ['', extremeNote] : []),
    '',
    '⛓️ ON-CHAIN METRICS',
    ...onchainLines(onchain),
    '',
    order.tpReasoning ? `📐 ${order.tpReasoning}` : '',
    `Exposure ${order.exposure}× · Leverage ${order.leverage}× · Margin ${fmt(order.marginUsd)}`,
    '',
    order.confirmationNote,
    '',
    '🎭 Ini POSISI BAYANGAN -- murni perhitungan Kaela, TIDAK ADA uang bergerak. Eksekusi asli (kalau mau ikut) tetap manual sendiri di Binance.',
    '🚨 JANGAN ALL-IN! Trading kripto resiko tinggi.',
    '⚠️ Deteksi pola ini pendekatan NUMERIK (regresi/aturan angka), bukan mata manusia -- cocokkan dulu sama chart aslinya sebelum diikuti.',
    '',
    '🍀 Semoga beruntung!',
    '',
    nowStr(),
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

function formatAutoInvalid({ ta, dailyClose, livePrice, sentiment, onchain }) {
  const syaratLine = '📋 Syarat yang ditunggu: candle harian CLOSE breakout dari pola Bull Flag/Pennant (lanjutan tren naik) atau Falling Wedge (pembalikan ke atas) -- BUY only, sesuai riset backtest terbaru. Belum ada pola valid yang breakout hari ini.';
  const extremeNote = getExtremeFearGreedNote(sentiment && sentiment.fearGreed);
  return [
    `${CATEGORY_COLOR.nyopet.emoji} 🤖 SNIPER — ❌ INVALID (analisa otomatis Kaela)`,
    'Belum ada posisi. Masih nunggu syarat terpenuhi.',
    '',
    '📊 ANALISA TEKNIKAL',
    ...taLines(ta),
    `Candle harian terakhir close: ${fmt(dailyClose)} | Harga sekarang: ${fmt(livePrice)}`,
    '',
    '🔥 LIQUIDATION HEATMAP',
    liqLine(),
    '',
    '🌊 SENTIMEN & POSISI PASAR',
    ...sentimentLines(sentiment),
    ...(extremeNote ? ['', extremeNote] : []),
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

module.exports = { formatRencana, formatTriggered, formatClosed, formatPartialClosed, formatPositionMonitor, formatCancelled, formatDailyTrigger, formatAutoValid, formatAutoInvalid };
