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

// Cari zona berikutnya SEARAH trade di luar entry (buat TP) -- kalau gak ada, null (caller fallback R:R 1:1).
function findNextZone(zones, entryPrice, direction) {
  const candidates = direction === 'buy'
    ? zones.filter((z) => z.price > entryPrice).sort((a, b) => a.price - b.price)
    : zones.filter((z) => z.price < entryPrice).sort((a, b) => b.price - a.price);
  return candidates[0] || null;
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

  const [ta, dailyClose, livePrice, liq] = await Promise.all([
    analyze('BTCUSDT'), fetchLastDailyClose(), fetchLivePrice(), sampleLiquidations(),
  ]);

  const topResistance = ta.resistanceZones[0]; // udah kesortir touches terbanyak dari analyze()
  const topSupport = ta.supportZones[0];

  let direction = null;
  if (topResistance && dailyClose > topResistance.priceMax) direction = 'buy';
  else if (topSupport && dailyClose < topSupport.priceMin) direction = 'sell';

  if (!direction) {
    const msg = formatAutoInvalid({ ta, dailyClose, livePrice, liq });
    console.log(msg + '\n');
    addEntry('nyopet', msg, now);
    await sendWhatsApp(msg);
    saveTriggerState({ lastSentDate: todayKey });
    console.log('[NyopetAutoAnalysis] INVALID -- belum ada breakout candle harian.');
    return;
  }

  // SL: titik struktur berlawanan terdekat (aturan proyek -- swing low buat buy, swing high buat sell)
  const swingSource = direction === 'buy' ? ta.supportZones : ta.resistanceZones;
  const sl = swingSource[0] ? swingSource[0].price : null;
  if (sl === null) {
    console.log('[NyopetAutoAnalysis] Gagal tentuin SL (gak ada swing zone terdeteksi), skip -- lebih aman diam daripada asal.');
    return;
  }

  const oppositeZones = direction === 'buy' ? ta.resistanceZones : ta.supportZones;
  const nextZone = findNextZone(oppositeZones, livePrice, direction);
  const riskDistance = Math.abs(livePrice - sl);
  const tp = nextZone ? nextZone.price : (direction === 'buy' ? livePrice + riskDistance : livePrice - riskDistance);

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
    tp, sl,
    exposure: calc.exposure, leverage: calc.leverage, marginUsd: calc.margin,
    notes: 'Analisa otomatis Kaela (9 Agu 2026): posisi BAYANGAN, murni perhitungan, tidak ada uang bergerak. Eksekusi asli tetap manual Olan di Binance kalau mau ikut.',
  }, now);
  const opened = updateOrder(created.id, { status: 'floating', entryPrice: livePrice, triggeredAt: now.toISOString() });

  const msg = formatAutoValid({ order: opened, ta, liq });
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
