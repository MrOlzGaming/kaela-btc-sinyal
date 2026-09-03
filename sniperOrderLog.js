// Format pesan Sniper MANUAL (rename dari "Nyopet Market", 12 Agu 2026) -- 4 momen (rencana/trigger/closed_tp/closed_sl), diposting
// ke WEB (arsip) DAN grup WA "BTC Sniper Club". WA cuma dikirim pas ADA PERUBAHAN STATUS
// (rencana dibuat / kena trigger / closed) -- BUKAN tiap kali dicek (hindari spam "masih floating"
// tiap jam, lihat archive.js anti-dobel lesson). Floating P&L LIVE cukup di web (client-side).

const { WEB_URL, toLocal } = require('./config');
const { CATEGORY_COLOR } = require('./categoryColors');
const { getExtremeFearGreedNote } = require('./fearGreedInsight');
const { ASSETS } = require('./assetConfig');

// assetLabel (22 Agu 2026, upgrade multi-aset) -- semua fungsi format di bawah TERIMA order yang
// sekarang punya field `order.asset` ('btc'/'xau') -- fallback ke ASSETS.btc kalau order LAMA
// (dari sebelum upgrade ini) gak punya field itu.
function assetOf(order) {
  return ASSETS[order.asset] || ASSETS.btc;
}
function modeLabel(order) {
  return order.mode === 'fvg' ? 'FVG' : 'Pola Chart';
}

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
    `${CATEGORY_COLOR.sniper.emoji} 🎯 SNIPER — 📋 RENCANA (analisa Kaela)`,
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
  const asset = assetOf(order);
  return [
    `${CATEGORY_COLOR.sniper.emoji} 🎯 SNIPER — ${asset.emoji} ${asset.label} (${modeLabel(order)}) — ✅ KENA TRIGGER, SEKARANG FLOATING`,
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
  const asset = assetOf(order);
  const won = order.status === 'closed_tp';
  const pnlSign = order.pnlUsd >= 0 ? '+' : '-';
  const exitLabelMap = { TP: '✅ TP KENA', SL: '❌ KENA STOP LOSS', SL_BREAKEVEN: '⚪ TUTUP DI BREAKEVEN (abis partial)', TRAIL: '🏁 TUTUP -- MOMENTUM PATAH (trailing exit)' };
  const exitLabel = exitLabelMap[order.closeReason] || (won ? '✅ TP KENA' : '❌ KENA STOP LOSS');
  return [
    `${CATEGORY_COLOR.sniper.emoji} 🎯 SNIPER — ${asset.emoji} ${asset.label} (${modeLabel(order)}) — ${exitLabel}`,
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
  const asset = assetOf(order);
  const pnlSign = order.realizedPnlUsd >= 0 ? '+' : '-';
  return [
    `${CATEGORY_COLOR.sniper.emoji} 🎯 SNIPER — ${asset.emoji} ${asset.label} (${modeLabel(order)}) — 🟡 TARGET TAHAP 1 KENA (separuh diamankan)`,
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
function formatPositionMonitor(order, livePrice, assetCfgParam) {
  const asset = assetCfgParam || assetOf(order);
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
    `${CATEGORY_COLOR.sniper.emoji} 🎯 SNIPER — ${asset.emoji} ${asset.label} (${modeLabel(order)}) — 📡 PEMANTAUAN POSISI${daysHeld !== null ? ` (hari ke-${daysHeld + 1})` : ''}`,
    seqLabel(order),
    `${DIR_LABEL[order.direction] || order.direction} @ ${fmt(order.entryPrice)} -- masih FLOATING, bukan sinyal baru.`,
    '',
    `Harga sekarang: ${fmt(livePrice)} (${movePct >= 0 ? '+' : ''}${movePct.toFixed(2)}% dari entry)`,
    statusLine,
  ];
  if (totalPnlUsd !== null) lines.push(`P&L saat ini: ${totalPnlUsd >= 0 ? '+' : ''}${fmt(Math.abs(totalPnlUsd))}`);
  // 3 Sep 2026, bug ketemu Olan (screenshot WA) -- baris "🎭 Posisi bayangan, murni perhitungan..."
  // KELEWAT pas migrasi 29 Agu 2026 (standing rule [[feedback-no-shadow-position]]: SEMUA sinyal
  // Sniper udah live-executed di Binance Demo lewat localLiveExecutor.js, BUKAN kalkulasi doang
  // lagi). formatAutoValid() di bawah UDAH dibetulin waktu itu ("Posisi RIIL di Binance Demo,
  // bukan bayangan lagi") -- cuma pesan PEMANTAUAN HARIAN ini yang gak ikut ke-update, jadi masih
  // nunjukkin kalimat lama tiap hari selama posisi floating. Disamain sekarang.
  lines.push(
    '',
    '🤖 Posisi RIIL di Binance Demo (duit virtual, bukan bayangan) -- kalau kamu ikut jasa Kaela, ini otomatis ke-mirror ke akunmu sendiri juga.',
    '',
    nowStr(),
    `🔗 ${WEB_URL}`,
  );
  return lines.join('\n');
}

// Heartbeat harian ~08:05 WITA (abis candle Daily closed) -- BUKAN sinyal, murni status +
// ajakan Olan buka chat buat analisa multi-timeframe bareng. Gak diarsipkan ke web sama sekali
// (konsisten kebijakan "belum valid = gak tampil dimanapun"), dedup dicek via
// sniper-trigger-state.json (lihat sniperDailyTrigger.js).
function formatDailyTrigger(btcPrice) {
  return [
    `${CATEGORY_COLOR.sniper.emoji} 🎯 SNIPER — 🔍 Kaela lagi kerja`,
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
    `${CATEGORY_COLOR.sniper.emoji} 🎯 SNIPER — 🚫 RENCANA DIBATALKAN`,
    seqLabel(order),
    `${DIR_LABEL[order.direction] || order.direction} @ trigger ${fmt(order.triggerPrice)} -- dibatalkan sebelum kena trigger.`,
    '',
    nowStr(),
  ].join('\n');
}

// Analisa gabungan OTOMATIS harian (9 Agu 2026, sniperAutoAnalysis.js) -- Analisa Teknikal +
// Sentimen + On-chain + Kesimpulan VALID/INVALID (Liquidation Heatmap dicabut 12 Agu 2026, lihat
// liqLine() di bawah). VALID = posisi LANGSUNG DIEKSEKUSI LIVE ke Binance Demo (duit virtual)
// oleh localLiveExecutor.js -- keterangan "posisi bayangan/murni perhitungan/eksekusi manual"
// di komentar ini SENGAJA DIBIARIN sebagai jejak sejarah (desain ASLI 9 Agu 2026), TAPI SUDAH
// GAK BERLAKU sejak standing rule 29 Agu 2026 [[feedback-no-shadow-position]]. Kalau nemu kode
// baru yang masih pakai frasa itu, itu BUG -- perbaiki, jangan anggap desain yang disengaja.

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
// sniperOrderMonitor.js) -- ini gak ngubah eksekusi, cuma kasih konteks R-multiple lengkap.
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

// formatSignalInfoOnly (22 Agu 2026, permintaan Olan: "sinyal gas terus, jangan patokan modal
// Kaela/Olan yang tipis kayak tisu") -- dipakai pas pola KETEMU tapi margin-nya kegedean buat
// bankroll bayangan KAELA sendiri (kecil, $100-1000-an). Kaela GAK buka posisi bayangan (biar
// tracking performa-nya tetap konsisten sama backtest yang selalu hormat batas margin) -- tapi
// INFO sinyalnya (arah/entry/SL/alasan) tetap disiarkan penuh, biar siapapun yang modalnya lebih
// gede bisa hitung sizing SENDIRI di kalkulator.html tanpa nunggu Kaela.
function formatSignalInfoOnly({ direction, entryPrice, sl, patternType, mode, confirmationNote, assetCfg, nyawaPct }) {
  const risk = Math.abs(entryPrice - sl);
  const sign = direction === 'buy' ? 1 : -1;
  const at = (r) => entryPrice + sign * risk * r;
  const modeLabel = mode === 'fvg' ? 'FVG' : 'Pola Chart';
  return [
    `${CATEGORY_COLOR.sniper.emoji} 🤖 SNIPER — ${assetCfg.emoji} ${assetCfg.label} (${modeLabel}) — 🔔 SINYAL KETEMU (info doang)`,
    `${DIR_LABEL[direction] || direction} @ ${fmt(entryPrice)}`,
    `❌ SL: ${fmt(sl)} (nyawa ${nyawaPct.toFixed(1)}%)`,
    `🎯 TP 1:1 = ${fmt(at(1))}  |  1:2 = ${fmt(at(2))}  |  1:3 = ${fmt(at(3))}`,
    '',
    confirmationNote,
    '',
    `💡 Bankroll bayangan Kaela sendiri kekecilan buat sinyal ini (margin kelewat batas 20%) -- Kaela SKIP biar tracking performanya tetap konsisten sama backtest. Tapi sinyalnya VALID -- kalau modal kamu lebih gede, hitung sizing sendiri di kalkulator.html.`,
    `🧮 ${WEB_URL}/kalkulator.html`,
    '',
    '🎭 Bukan posisi bayangan Kaela -- ini murni INFO pola yang kedeteksi. Eksekusi & sizing sepenuhnya keputusan sendiri.',
    '🚨 JANGAN ALL-IN! Trading resiko tinggi.',
    '',
    nowStr(),
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

// Status eksekusi LIVE (22 Agu 2026, lihat binanceExecutor.js/killSwitch.js) -- null kalau
// kill switch OFF (default, gak perlu nampilin apa-apa soal ini). Kalau ON, WAJIB jelas ke Olan
// apa beneran kejalan atau gagal -- ini uang beneran (atau testnet, ditandain jelas).
function liveExecutionLines(liveExecution) {
  if (!liveExecution) return [];
  const modeLabel = liveExecution.testnet ? '🧪 BINANCE DEMO (duit virtual)' : '💰 MAINNET (UANG ASLI)';
  if (liveExecution.ok) {
    return ['', `${modeLabel} -- Order berhasil masuk, qty ${liveExecution.filledQty}. SL+TP udah nempel di exchange.`];
  }
  // Kasus TERDUGA & SELALU KEJADIAN (29 Agu 2026, bikin Olan bingung liat "ERROR" di web padahal
  // bukan bug) -- analisa ini jalan di GitHub Actions (cloud), yang MEMANG sengaja gak dikasih
  // kredensial Binance (Demo diblokir dari cloud, lihat localLiveExecutor.js) -- pesan tenang,
  // bukan alarm, karena eksekusi beneran nyusul otomatis siklus lokal berikutnya (~15 menit).
  if (/BINANCE_API_KEY\/BINANCE_API_SECRET belum di-setup/.test(liveExecution.error || '')) {
    return ['', `${modeLabel} -- ⏳ Analisa ini jalan di server cloud (sengaja gak pegang kunci Binance) -- eksekusi beneran nyusul otomatis di siklus komputer lokal berikutnya (~15 menit), TIDAK PERLU aksi manual.`];
  }
  return ['', `${modeLabel} -- ❌ Eksekusi GAGAL: ${liveExecution.error} -- TIDAK ADA order di Binance, cek manual.`];
}

function formatAutoValid({ order, ta, sentiment, onchain, assetCfg, liveExecution }) {
  const asset = assetCfg || assetOf(order);
  const extremeNote = getExtremeFearGreedNote(sentiment && sentiment.fearGreed);
  const { formatWinRateLine } = require('./winRate');
  const { formatSignalCore } = require('./signalCore');
  const { getClosedOrders } = require('./sniperOrders');
  const winRateLine = formatWinRateLine(getClosedOrders());
  // ta/sentiment/onchain CUMA ada buat BTC (metrik makro kripto, gak relevan/gak ada buat emas,
  // 22 Agu 2026) -- bagian2 ini di-skip otomatis kalau null, bukan error.
  const modeExplain = order.mode === 'fvg'
    ? 'Mode FVG (Fair Value Gap): nyari zona harga yang "dilompatin" pas gerakan cepat, dianggap area support -- entry pas harga koreksi balik ke zona itu terus mantul.'
    : 'Mode Pola Chart: nyari pola breakout klasik (bull flag/pennant lanjutan tren, atau falling wedge pembalikan) di candle harian.';
  // Blok inti SERAGAM sama Nyopet (23 Agu 2026, permintaan Olan) -- TP dipakai order.partialTp
  // (2R) karena itu PERSIS harga yang beneran dipasang jadi order TP live (lihat
  // localLiveExecutor.js) -- separuh diamanin situ, sisanya di-reopen breakeven abis kena (lihat
  // sniperLiveMonitor.js), bukan lari sampai R:R jauh kayak dulu.
  const coreLines = formatSignalCore({
    direction: order.direction, entryPrice: order.entryPrice, tp: order.partialTp || order.tp, sl: order.sl,
    leverage: order.leverage, marginUsd: order.marginUsd,
    reason: modeExplain + (order.tpReasoning ? ` ${order.tpReasoning}` : '') + ' Separuh diamanin di TP, sisanya di-reopen breakeven (likuidasi = SL) buat lanjut trail SMA10.',
  });
  return [
    `${CATEGORY_COLOR.sniper.emoji} 🤖 SNIPER — ${asset.emoji} ${asset.label} — ✅ VALID 🐂🚀 (analisa otomatis Kaela)`,
    seqLabel(order),
    ...coreLines,
    ...(ta ? ['', '📊 ANALISA TEKNIKAL', ...taLines(ta)] : []),
    ...(asset.key === 'btc' ? ['', '🔥 LIQUIDATION HEATMAP', liqLine()] : []),
    ...(sentiment ? ['', '🌊 SENTIMEN & POSISI PASAR', ...sentimentLines(sentiment), ...(extremeNote ? ['', extremeNote] : [])] : []),
    ...(onchain ? ['', '⛓️ ON-CHAIN METRICS', ...onchainLines(onchain)] : []),
    '',
    winRateLine,
    ...liveExecutionLines(liveExecution),
    '',
    order.confirmationNote,
    '',
liveExecution
      ? '🤖 Posisi RIIL di Binance Demo (duit virtual, bukan bayangan lagi) -- lihat status EKSEKUSI di atas.'
      // Fallback kalau kill switch lagi OFF (maintenance) -- BUKAN "ajakan ikut manual" lagi (29
      // Agu 2026, standing rule: buka posisi Kaela sendiri UDAH jadi sinyalnya, gak ada ajakan).
      : '⏸️ Eksekusi live lagi dimatiin sementara (kill switch OFF, maintenance) -- sinyal ini TETAP tercatat lengkap, TIDAK ADA order ke Binance sampai dinyalain lagi.',
    '🚨 JANGAN ALL-IN! Trading resiko tinggi.',
    '⚠️ Deteksi pola ini pendekatan NUMERIK (regresi/aturan angka), bukan mata manusia -- cocokkan dulu sama chart aslinya sebelum diikuti.',
    '',
    '🍀 Semoga beruntung!',
    '',
    nowStr(),
    `🧮 Hitung volume/margin sendiri (WAJIB kalau modal beda dari bayangan Kaela): ${WEB_URL}/kalkulator.html`,
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

// formatAutoInvalid (22 Agu 2026, disederhanakan buat multi-aset) -- dulu 1 pesan panjang penuh
// TA/sentimen/onchain buat BTC doang, sekarang 1 pesan RINGKAS ngerangkum status SEMUA aset
// sekaligus (`notes` = array baris per-aset dari sniperAutoAnalysis.js) -- biar gak spam
// beberapa pesan panjang terpisah tiap hari kalau kedua aset sama-sama belum ada sinyal.
// Header/intro beda kalau ADA ancang-ancang lagi diawasi (22 Agu 2026, patternWatchlist.js) --
// biar gak kerasa "gak ada apa-apa" pas sebenernya ada pola lagi kebentuk, cuma belum konfirmasi.
function formatAutoInvalid({ notes }) {
  const hasWatch = (notes || []).some((n) => n.includes('ANCANG-ANCANG'));
  return [
    hasWatch
      ? `${CATEGORY_COLOR.sniper.emoji} 🤖 SNIPER — 👀 ANCANG-ANCANG (analisa otomatis Kaela)`
      : `${CATEGORY_COLOR.sniper.emoji} 🤖 SNIPER — ❌ BELUM ADA SINYAL (analisa otomatis Kaela)`,
    hasWatch
      ? 'Belum ada posisi baru, TAPI ada pola lagi diawasi -- lihat detail di bawah.'
      : 'Belum ada posisi baru. Masih nunggu syarat terpenuhi.',
    '',
    ...(notes || []),
    '',
    nowStr(),
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

module.exports = { formatRencana, formatTriggered, formatClosed, formatPartialClosed, formatPositionMonitor, formatCancelled, formatDailyTrigger, formatAutoValid, formatAutoInvalid, formatSignalInfoOnly };
