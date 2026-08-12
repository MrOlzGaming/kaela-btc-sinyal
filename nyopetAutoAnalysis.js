// Jalankan 1x sehari, abis candle HARIAN closing (00:00 UTC = 08:00 WITA -- pas jadwal
// nyopet-daily-trigger.yml, 00:05 UTC): analisa gabungan OTOMATIS (teknikal + sentimen +
// on-chain -- liquidation heatmap DICABUT 12 Agu 2026, lihat komentar di bawah) -> kesimpulan
// VALID/INVALID -> kalau VALID langsung catat "posisi bayangan" (shadow --
// TIDAK ADA uang beneran, Kaela cuma ngitung seolah entry market saat itu, murni bookkeeping) dan
// kirim WA. Kalau INVALID, kirim status + syarat yang masih ditunggu (Kaela BUKAN eksekutor
// finansial -- keputusan Olan 9 Agu 2026, murni "kalkulator logika": VALID = buka posisi bayangan,
// INVALID = nunggu syarat kepenuhi sesuai analisa).
//
// STRATEGI (10 Agu 2026, GANTI TOTAL dari versi zona-breakout+Weekly-filter lama): sekarang
// nyari breakout dari POLA CHART SPESIFIK (bull flag/pennant + falling wedge -- lihat
// chartPatterns.js), BUKAN breakout dari zona swing high/low umum. Riset backtestFlagBreakout.js
// (10 Agu 2026): SL yang nempel di lebar POLA-nya sendiri (bukan zona jauh) alami TIPIS, hasilnya
// jauh lebih baik (profit factor 2,51 vs 1,11-1,19 punya versi lama, drawdown 38% vs 90%+).
// BUY ONLY (short kebukti berkali-kali ngerusak edge, baik di sistem lama maupun baru ini).
// Sizing pakai kalkulator exposure ASLI (bukan fixedRisk lagi) + jaring pengaman keras: margin
// per-trade gak boleh >MAX_MARGIN_PCT dari modal ("kita nyopet, bukan investasi" -- instruksi
// Olan 10 Agu 2026).
//
// PENTING: kalau UDAH ADA order aktif (pending/floating), SKIP -- 1 posisi bayangan per waktu,
// gak numpuk. candle HARIAN dipakai (bukan H1) -- keputusan Olan: closing candle harian pas
// dijadwal 08:05 WITA emang momen konfirmasi asli, sinyal lebih kuat/jarang dari cek per-jam.

const fs = require('fs');
const path = require('path');
const { analyze, fetchCandles } = require('./technicalAnalysis');
const { detectPatternSignal } = require('./chartPatterns');
const { getActiveOrders, createOrder, updateOrder } = require('./nyopetOrders');
const { hitung: hitungExposure } = require('./calculator');
const { load: loadOrdersState } = require('./nyopetOrders');
const { formatAutoValid, formatAutoInvalid } = require('./nyopetOrderLog');
const { sendWhatsApp } = require('./fonnte');
const { addEntry } = require('./archive');
const { fetchWithRetry } = require('./httpRetry');
const { localDateKey, isWaMuted } = require('./config');
const { analyzeSentiment } = require('./marketSentiment');
const { fetchTradeMetrics } = require('./onchainMetrics');

// Batas keras margin/modal per-trade (10 Agu 2026, instruksi Olan langsung: "gak boleh ada lagi
// posisi margin super, kita nyopet bukan investasi"). SL pattern-based udah alami ngasih margin
// kecil (tervalidasi backtest: margin terbesar dari 66 trade cuma 18,8%), ini jaring pengaman
// tambahan biar gak ada 1 sinyal pun yang lolos kalau kejadian nyawa-nya kebetulan lebar.
const MAX_MARGIN_PCT = 20;
// Batas keras nyawa% (12 Agu 2026, instruksi Olan: "nyopet ya pake nyawa dikit aja.. invalidasi
// diterima dengan lapang"). Dites sweep 5-20% di backtestFlagBreakout.js -- nyawa TERLEBAR yang
// pernah muncul di 66 trade cuma 20,5% (sistem pola chart emang alami tipis, beda dari zona lama
// yang bisa 38%). Mempersempit lebih dari ini TERBUKTI ngerusak hasil (batas 8% malah drawdown
// 57,7%, lebih parah dari tanpa batas). 20% dipilih sbg jaring pengaman yang HAMPIR GAK PERNAH
// kesentuh, bukan pembatas aktif -- hasil backtest sama persis (finalCapital $20.391 vs $20.523).
const MAX_NYAWA_PCT = 20;
// Target R:R buat exit tahap 1 (jual separuh posisi) -- tervalidasi backtest sbg titik optimal.
const PARTIAL_RR = 2;
// SMA (hari) buat trailing sisa separuh posisi abis partial exit -- proksi "lihat kelakuan candle".
const TRAIL_SMA_LEN = 10;
// Berapa hari histori candle harian diambil -- cukup buat wedge (lookback maks 40 hari + swing
// point) + pole (maks 20 hari) + margin aman, TANPA amit-amit kurang data pas market baru listing.
const PATTERN_HISTORY_DAYS = 200;

// Sentimen (Fear&Greed + Binance Futures) BUKAN dari data-api.binance.vision yang biasa kita
// pakai -- domain fapi.binance.com belum pernah dites dari runner GitHub Actions. Kalau gagal
// (misal kena blokir geografis kayak api.binance.com dulu), JANGAN gugurin seluruh analisa --
// lapis lain (teknikal+liquidation) tetap valid tanpa ini, sentimen jadi opsional/best-effort.
async function safeSentiment() {
  try {
    return await analyzeSentiment('BTCUSDT');
  } catch (e) {
    console.log('[NyopetAutoAnalysis] Sentimen gagal diambil (dilewatin):', e.message);
    return null;
  }
}

// On-chain (SOPR + NUPL, lihat onchainMetrics.js) -- opsional/best-effort, sama pola kayak
// safeSentiment(). Modul ini sendiri udah null-safe per-metrik, tapi tetap dibungkus try/catch
// jaga-jaga error tak terduga (misal network putus total) gak gugurin seluruh analisa.
async function safeOnchain() {
  try {
    return await fetchTradeMetrics();
  } catch (e) {
    console.log('[NyopetAutoAnalysis] On-chain metrics gagal diambil (dilewatin):', e.message);
    return null;
  }
}

// Kirim WA respek mute sementara (config.js isWaMuted, aktif sampai 2026-08-14) -- tetap DIARSIP
// ke web/archive.json apa adanya, cuma broadcast grup yang ditahan sampai pengumuman resmi.
async function sendWhatsAppRespectMute(msg, label) {
  if (isWaMuted()) {
    console.log(`[NyopetAutoAnalysis] WA DIMUTE sampai Jumat -- ${label} TETAP tercatat di web, gak dikirim ke grup dulu.`);
    return;
  }
  await sendWhatsApp(msg);
}

// Dedup harian -- 1x cek per hari kalender WITA (nempel jadwal candle harian), cegah spam
// kalau workflow ke-run ulang hari yang sama (pola sama kayak nyopetDailyTrigger.js lama,
// yang diretire/digantikan script ini).
const TRIGGER_STATE_PATH = path.join(__dirname, 'nyopet-trigger-state.json');
function loadTriggerState() {
  if (!fs.existsSync(TRIGGER_STATE_PATH)) return { lastSentDate: null };
  return JSON.parse(fs.readFileSync(TRIGGER_STATE_PATH, 'utf8'));
}
function saveTriggerState(state) {
  fs.writeFileSync(TRIGGER_STATE_PATH, JSON.stringify(state, null, 2));
}

// Liquidation heatmap DIMATIKAN (12 Agu 2026) -- diselidiki abis Olan curiga "0 liquidation
// tiap hari gak mungkin". Ketemu endpoint lama `/market/ws/!forceOrder@arr` SALAH (dibetulkan),
// tapi bahkan versi benar tetap 0/0 di runner GitHub Actions (kemungkinan besar Binance
// blokir/diamkan koneksi WebSocket streaming dari IP datacenter/cloud -- masalah umum, beda
// dari data-api.binance.vision yang emang didesain khusus publik/gak kena blokir). Kaela gak
// mampu akses data ini gratis dari infrastruktur yang ada -- daripada nampilin angka yang gak
// bisa dipercaya, lapisan ini dicabut. Link manual (Coinglass) dikasih di pesan sebagai gantinya.

async function fetchLivePrice() {
  const res = await fetchWithRetry('https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT');
  const data = await res.json();
  return parseFloat(data.price);
}

async function main() {
  const now = new Date();
  const todayKey = localDateKey(now);
  const triggerState = loadTriggerState();
  if (triggerState.lastSentDate === todayKey) {
    console.log('[NyopetAutoAnalysis]', now.toISOString(), '-- udah dicek hari ini, skip (cegah dobel kalau ke-run ulang).');
    return;
  }

  const active = getActiveOrders();
  if (active.length > 0) {
    console.log('[NyopetAutoAnalysis]', now.toISOString(), '-- posisi bayangan masih aktif (', active[0].signalId, '), skip analisa baru.');
    return;
  }

  const [ta, daily, livePrice, sentiment, onchain] = await Promise.all([
    analyze('BTCUSDT'), fetchCandles('BTCUSDT', '1d', PATTERN_HISTORY_DAYS), fetchLivePrice(), safeSentiment(), safeOnchain(),
  ]);

  const dailyClose = daily[daily.length - 1].close;
  const signal = detectPatternSignal(daily, daily.length - 1, { allowShort: false });

  if (!signal) {
    const msg = formatAutoInvalid({ ta, dailyClose, livePrice, sentiment, onchain });
    console.log(msg + '\n');
    addEntry('nyopet', msg, now);
    await sendWhatsAppRespectMute(msg, 'status INVALID');
    saveTriggerState({ lastSentDate: todayKey });
    console.log('[NyopetAutoAnalysis] INVALID -- belum ada pola flag/wedge yang breakout candle harian.');
    return;
  }

  const { direction, sl, patternType } = signal;
  const riskDistance = Math.abs(livePrice - sl);
  if (riskDistance === 0) {
    console.log('[NyopetAutoAnalysis] Jarak SL 0 (harga = SL), skip -- lebih aman diam daripada asal.');
    return;
  }
  const nyawaPct = riskDistance / livePrice * 100;
  if (nyawaPct > MAX_NYAWA_PCT) {
    console.log(`[NyopetAutoAnalysis] Nyawa ${nyawaPct.toFixed(1)}% ngelewatin batas ${MAX_NYAWA_PCT}% -- invalidasi diterima, nyopet pake nyawa dikit aja.`);
    saveTriggerState({ lastSentDate: todayKey });
    return;
  }
  const partialTp = direction === 'buy' ? livePrice + riskDistance * PARTIAL_RR : livePrice - riskDistance * PARTIAL_RR;
  if (partialTp <= 0) {
    console.log('[NyopetAutoAnalysis] Proyeksi TP gak masuk akal, skip -- lebih aman diam daripada asal.');
    return;
  }

  const ordersState = loadOrdersState();
  const modal = ordersState.balance || 0;
  if (modal <= 0) {
    console.log('[NyopetAutoAnalysis] Saldo belum diset (0), skip -- gak bisa hitung exposure.');
    return;
  }
  const calc = hitungExposure({ modal, entry: livePrice, stopLoss: sl });
  if (calc.marginPct > MAX_MARGIN_PCT) {
    console.log(`[NyopetAutoAnalysis] Margin ${calc.marginPct.toFixed(1)}% modal ngelewatin batas ${MAX_MARGIN_PCT}% -- skip, nyopet bukan investasi.`);
    saveTriggerState({ lastSentDate: todayKey });
    return;
  }

  const patternLabel = { flag_bull: 'Bull Flag/Pennant', flag_bear: 'Bear Flag/Pennant', wedge_falling: 'Falling Wedge', wedge_rising: 'Rising Wedge' }[patternType] || patternType;
  const confirmationNote = `Breakout pola ${patternLabel} -- candle harian CLOSE ${direction === 'buy' ? 'di atas' : 'di bawah'} batas pola ($${dailyClose.toLocaleString('en-US')}). SL nempel lebar pola itu sendiri (nyawa ${(riskDistance / livePrice * 100).toFixed(1)}%), bukan zona jauh. Deteksi otomatis chartPatterns.js.`;
  const tpReasoning = `Target tahap 1 (jual separuh): ${PARTIAL_RR}x risiko @ $${partialTp.toLocaleString('en-US', { maximumFractionDigits: 0 })}. Sisanya di-trail pakai SMA${TRAIL_SMA_LEN} harian (SL digeser breakeven abis tahap 1) -- "lihat kelakuan candle" sebelum lepas semua.`;

  const created = createOrder({
    direction,
    strategyType: 'breakout',
    triggerPrice: livePrice,
    confirmationNote,
    tpReasoning,
    tp: partialTp, // dipakai formatAutoValid buat tampilan "TP tahap 1"; exit penuh via trail
    sl,
    exposure: calc.exposure, leverage: calc.leverage, marginUsd: calc.margin,
    patternType, partialTp, trailSmaLen: TRAIL_SMA_LEN,
    notes: 'Analisa otomatis Kaela (strategi pola chart, 10 Agu 2026): posisi BAYANGAN, murni perhitungan, tidak ada uang bergerak. Eksekusi asli tetap manual Olan di Binance kalau mau ikut.',
  }, now);
  const opened = updateOrder(created.id, { status: 'floating', entryPrice: livePrice, triggeredAt: now.toISOString() });

  const msg = formatAutoValid({ order: opened, ta, sentiment, onchain });
  console.log(msg + '\n');
  addEntry('nyopet', msg, now);
  await sendWhatsAppRespectMute(msg, `sinyal VALID (${patternLabel})`);
  saveTriggerState({ lastSentDate: todayKey });
  console.log('[NyopetAutoAnalysis] VALID --', direction, patternLabel, 'posisi bayangan dibuka @', livePrice);
}

main().catch((e) => {
  console.error('ERROR nyopetAutoAnalysis.js:', e.message);
  process.exit(1);
});
