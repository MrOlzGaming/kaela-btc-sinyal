// Jalankan 1x sehari, abis candle HARIAN closing (00:00 UTC = 08:00 WITA -- pas jadwal
// nyopet-daily-trigger.yml, 00:05 UTC): analisa gabungan OTOMATIS (teknikal + liquidation
// heatmap) -> kesimpulan VALID/INVALID -> kalau VALID langsung catat "posisi bayangan" (shadow --
// TIDAK ADA uang beneran, Kaela cuma ngitung seolah entry market saat itu, murni bookkeeping) dan
// kirim WA. Kalau INVALID, kirim status + syarat yang masih ditunggu (Kaela BUKAN eksekutor
// finansial -- keputusan Olan 9 Agu 2026, murni "kalkulator logika": VALID = buka posisi bayangan,
// INVALID = nunggu syarat kepenuhi sesuai analisa).
//
// PENTING: kalau UDAH ADA order aktif (pending/floating), SKIP -- 1 posisi bayangan per waktu,
// gak numpuk. candle HARIAN dipakai (bukan H1) -- keputusan Olan: closing candle harian pas
// dijadwal 08:05 WITA emang momen konfirmasi asli, sinyal lebih kuat/jarang dari cek per-jam.

const fs = require('fs');
const path = require('path');
const { analyze } = require('./technicalAnalysis');
const { getActiveOrders, createOrder, updateOrder } = require('./nyopetOrders');
const { hitung } = require('./calculator');
const { load: loadOrdersState } = require('./nyopetOrders');
const { formatAutoValid, formatAutoInvalid } = require('./nyopetOrderLog');
const { sendWhatsApp } = require('./fonnte');
const { addEntry } = require('./archive');
const { fetchWithRetry } = require('./httpRetry');
const { localDateKey } = require('./config');
const { analyzeSentiment } = require('./marketSentiment');
const { fetchTradeMetrics } = require('./onchainMetrics');

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

// Sampel liquidation heatmap singkat -- endpoint BARU (lihat KNOWLEDGE, yang lama mati 23 Apr 2026).
async function sampleLiquidations(windowMs = 15000) {
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://fstream.binance.com/market/ws/!forceOrder@arr');
    let btcCount = 0, totalCount = 0;
    ws.onmessage = (msg) => {
      try {
        const o = JSON.parse(msg.data).o;
        if (o) { totalCount++; if (o.s === 'BTCUSDT') btcCount++; }
      } catch (e) { /* abaikan pesan gak valid */ }
    };
    ws.onerror = () => resolve({ btcCount: 0, totalCount: 0, error: true });
    setTimeout(() => { ws.close(); resolve({ btcCount, totalCount, error: false }); }, windowMs);
  });
}

async function fetchLastDailyClose() {
  const res = await fetchWithRetry('https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=2');
  const raw = await res.json();
  return +raw[0][4]; // candle ke-0 = candle harian TERAKHIR yang udah closed
}

async function fetchLivePrice() {
  const res = await fetchWithRetry('https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT');
  const data = await res.json();
  return parseFloat(data.price);
}

// TP adaptif (10 Agu 2026, respons temuan backtest: TP "zona terdekat" sering ngasih R:R kecil
// meski win rate tinggi -- avg cuma +0,18R/trade). Sekarang TP nyesuaiin KEKUATAN trend Weekly
// (momentum MA10 vs MA30 mingguan), bukan selalu ambil zona paling deket atau R:R flat 1:1:
// - momentum LEMAH -> target lebih konservatif (minRR 1.0x), ambil zona terdekat yang masih masuk akal.
// - momentum SEDANG -> minRR 1.5x, lewatin zona yang terlalu deket, cari yang lebih berarti.
// - momentum KUAT -> minRR 2.0x, berani nunggu zona lebih jauh karena momentum besar sering nembus
//   zona lemah di depannya.
// Ambang lemah/sedang/kuat (10% / 20%) diambil dari PERSENTIL riil histori jarak MA10-MA30
// mingguan BTCUSDT 2017-2026 (p33=10,2% / p67=19,8%, lihat riset backtestNyopet.js) -- BUKAN
// angka tebakan.
function classifyWeeklyStrength(momentumPct) {
  if (momentumPct === null || momentumPct === undefined) return 'lemah'; // data belum cukup, konservatif
  if (momentumPct < 10) return 'lemah';
  if (momentumPct < 20) return 'sedang';
  return 'kuat';
}
const MIN_RR_BY_STRENGTH = { lemah: 1.0, sedang: 1.5, kuat: 2.0 };

// Susun zona SEARAH trade (di luar entry), terdekat dulu.
function sortedZonesInDirection(zones, entryPrice, direction) {
  return direction === 'buy'
    ? zones.filter((z) => z.price > entryPrice).sort((a, b) => a.price - b.price)
    : zones.filter((z) => z.price < entryPrice).sort((a, b) => b.price - a.price);
}

// Pilih zona TP PERTAMA (dari yang terdekat) yang R:R-nya udah penuhi minRR -- kalau zona
// terdekat kasih R:R kecil, LEWATIN, cari yang lebih jauh/berarti. Return null kalau semua
// zona yang ada masih di bawah minRR (caller fallback ke proyeksi minRR × risk).
function pickAdaptiveTp(zones, entryPrice, sl, direction, minRR) {
  const riskDistance = Math.abs(entryPrice - sl);
  if (riskDistance === 0) return null;
  const candidates = sortedZonesInDirection(zones, entryPrice, direction);
  for (const z of candidates) {
    const reward = Math.abs(z.price - entryPrice);
    if (reward / riskDistance >= minRR) return z;
  }
  return null;
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

  const [ta, dailyClose, livePrice, liq, sentiment, onchain] = await Promise.all([
    analyze('BTCUSDT'), fetchLastDailyClose(), fetchLivePrice(), sampleLiquidations(), safeSentiment(), safeOnchain(),
  ]);

  const topResistance = ta.resistanceZones[0]; // udah kesortir touches terbanyak dari analyze()
  const topSupport = ta.supportZones[0];

  // Konfirmasi Weekly (9 Agu 2026): breakout daily WAJIB gak lawan trend Weekly -- kalau
  // breakout kedeteksi tapi trend Weekly kontra, tetap INVALID (ditahan), bukan langsung entry.
  // weeklyTrend null (data belum cukup) atau 'netral' TIDAK memblokir -- cuma blokir kontradiksi jelas.
  let direction = null;
  let weeklyBlocked = null;
  if (topResistance && dailyClose > topResistance.priceMax) {
    if (ta.weeklyTrend === 'bearish') weeklyBlocked = 'buy'; else direction = 'buy';
  } else if (topSupport && dailyClose < topSupport.priceMin) {
    if (ta.weeklyTrend === 'bullish') weeklyBlocked = 'sell'; else direction = 'sell';
  }

  if (!direction) {
    const msg = formatAutoInvalid({ ta, dailyClose, livePrice, liq, sentiment, onchain, weeklyBlocked });
    console.log(msg + '\n');
    addEntry('nyopet', msg, now);
    await sendWhatsApp(msg);
    saveTriggerState({ lastSentDate: todayKey });
    console.log('[NyopetAutoAnalysis] INVALID --', weeklyBlocked ? `breakout ${weeklyBlocked} ditahan (lawan trend Weekly)` : 'belum ada breakout candle harian.');
    return;
  }

  // SL: titik struktur berlawanan terdekat (aturan proyek -- swing low buat buy, swing high buat sell)
  const swingSource = direction === 'buy' ? ta.supportZones : ta.resistanceZones;
  const sl = swingSource[0] ? swingSource[0].price : null;
  if (sl === null) {
    console.log('[NyopetAutoAnalysis] Gagal tentuin SL (gak ada swing zone terdeteksi), skip -- lebih aman diam daripada asal.');
    return;
  }

  const weeklyStrength = classifyWeeklyStrength(ta.weeklyMomentumPct);
  const minRR = MIN_RR_BY_STRENGTH[weeklyStrength];
  const oppositeZones = direction === 'buy' ? ta.resistanceZones : ta.supportZones;
  const adaptiveZone = pickAdaptiveTp(oppositeZones, livePrice, sl, direction, minRR);
  const riskDistance = Math.abs(livePrice - sl);
  const tp = adaptiveZone ? adaptiveZone.price : (direction === 'buy' ? livePrice + riskDistance * minRR : livePrice - riskDistance * minRR);
  const tpReasoning = adaptiveZone
    ? `TP di zona ${direction === 'buy' ? 'resistance' : 'support'} $${adaptiveZone.price.toLocaleString('en-US', { maximumFractionDigits: 0 })} (tersentuh ${adaptiveZone.touches}x) -- momentum Weekly ${weeklyStrength.toUpperCase()} (${ta.weeklyMomentumPct === null ? 'data belum cukup' : ta.weeklyMomentumPct.toFixed(1) + '%'}), minimal target ${minRR}x risiko, zona ini penuhi itu.`
    : `Gak ada zona ${direction === 'buy' ? 'resistance' : 'support'} yang penuhi target minimal ${minRR}x risiko (momentum Weekly ${weeklyStrength.toUpperCase()}) -- TP diproyeksi ${minRR}x jarak SL sebagai gantinya.`;

  const ordersState = loadOrdersState();
  const modal = ordersState.balance || 0;
  if (modal <= 0) {
    console.log('[NyopetAutoAnalysis] Saldo belum diset (0), skip -- gak bisa hitung exposure.');
    return;
  }
  const calc = hitung({ modal, entry: livePrice, stopLoss: sl });

  const created = createOrder({
    direction,
    strategyType: 'breakout',
    triggerPrice: livePrice,
    confirmationNote: `Candle harian CLOSE ${direction === 'buy' ? 'di atas' : 'di bawah'} zona ${direction === 'buy' ? 'resistance' : 'support'} ($${dailyClose.toLocaleString('en-US')}) -- deteksi otomatis technicalAnalysis.js.`,
    tpReasoning,
    tp, sl,
    exposure: calc.exposure, leverage: calc.leverage, marginUsd: calc.margin,
    notes: 'Analisa otomatis Kaela (9 Agu 2026): posisi BAYANGAN, murni perhitungan, tidak ada uang bergerak. Eksekusi asli tetap manual Olan di Binance kalau mau ikut.',
  }, now);
  const opened = updateOrder(created.id, { status: 'floating', entryPrice: livePrice, triggeredAt: now.toISOString() });

  const msg = formatAutoValid({ order: opened, ta, liq, sentiment, onchain });
  console.log(msg + '\n');
  addEntry('nyopet', msg, now);
  await sendWhatsApp(msg);
  saveTriggerState({ lastSentDate: todayKey });
  console.log('[NyopetAutoAnalysis] VALID --', direction, 'posisi bayangan dibuka @', livePrice);
}

main().catch((e) => {
  console.error('ERROR nyopetAutoAnalysis.js:', e.message);
  process.exit(1);
});
