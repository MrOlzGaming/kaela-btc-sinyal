// dxyZoneMonitor.js (28 Agu 2026, permintaan Olan: "sinyal dxy juga pas dekat support/resisten,
// kabari kalo ditembus atau gagal ditembus") -- MURNI INFORMASI/KONTEKS MAKRO, sama kelasnya kayak
// econCalendarMonitor.js -- gak pernah buka posisi/eksekusi apapun, DXY gak ada di Binance sama
// sekali. Reuse fungsi zona GENERIK yang udah divalidasi (findSwingPoints/clusterLevels dari
// technicalAnalysis.js, findTouchCandidate/isZoneBroken/findNearestPair/pctDist dari
// darkKaelaZones.js) -- TAPI TIDAK reuse `detectZones`/`roundNumberStep` langsung, karena itu
// dikalibrasi buat skala harga crypto ($1rb-$100rb, round step 250-10rb) -- kalau dipaksa ke DXY
// (~90-110) hasilnya ngaco. `detectDxyZones()` di bawah ini scoped SENDIRI ke file ini, gak
// nyentuh/ubah `darkKaelaZones.js` sama sekali -- ZERO resiko ke logic Sniper/Nyopet REAL yang
// pakai file itu.

const { findSwingPoints, clusterLevels } = require('./technicalAnalysis');
const { findTouchCandidate, isZoneBroken, findNearestPair, pctDist } = require('./darkKaelaZones');
const { sendWhatsApp } = require('./fonnte');
const { addEntry } = require('./archive');
const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, 'dxy-zone-state.json');
const DXY_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1h&range=1mo';

// Parameter DIKALIBRASI ULANG buat DXY (jauh lebih kalem gerakannya drpd crypto -- toleransi/near%
// jauh lebih ketat drpd DEFAULT_PARAMS darkKaelaZones.js yang buat BTC/XAU).
const PARAMS = {
  SWING_LOOKBACK: 3,
  ZONE_WINDOW_CANDLES: 24 * 14, // ~14 hari candle jam-an
  CLUSTER_TOLERANCE_PCT: 0.15,
  MIN_TOUCHES: 2,
  BREAK_CONFIRM_PCT: 0.08,
  MOVE_AWAY_PCT: 0.45, // dianggap "udah mantul/beranjak" kalau jarak ke zona lebih dari ini
  ROUND_STEP: 1.0, // level bulat DXY tiap 1.00 poin (99.00, 100.00, dst) -- BEDA dari crypto
};

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { watchZone: null };
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}
function saveState(s) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

async function fetchDxyCandles() {
  const res = await fetch(DXY_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await res.json();
  const r = data.chart.result[0];
  const q = r.indicators.quote[0];
  return r.timestamp
    .map((t, idx) => ({ open: q.open[idx], high: q.high[idx], low: q.low[idx], close: q.close[idx], closeTime: t * 1000 }))
    .filter((c) => c.close != null && c.high != null && c.low != null); // Yahoo kadang null di candle paling ujung (belum settle)
}

function detectDxyZones(candles, i) {
  const window = candles.slice(Math.max(0, i - PARAMS.ZONE_WINDOW_CANDLES), i);
  if (window.length < PARAMS.SWING_LOOKBACK * 4) return { resistance: [], support: [] };
  const price = candles[i].close;
  const { highs, lows } = findSwingPoints(window, PARAMS.SWING_LOOKBACK);
  const resistance = clusterLevels(highs.filter((h) => h.price > price), PARAMS.CLUSTER_TOLERANCE_PCT)
    .filter((z) => z.touches >= PARAMS.MIN_TOUCHES)
    .map((z) => ({ price: z.price, touches: z.touches, kind: 'swing' }));
  const support = clusterLevels(lows.filter((l) => l.price < price), PARAMS.CLUSTER_TOLERANCE_PCT)
    .filter((z) => z.touches >= PARAMS.MIN_TOUCHES)
    .map((z) => ({ price: z.price, touches: z.touches, kind: 'swing' }));
  const roundBelow = Math.floor(price / PARAMS.ROUND_STEP) * PARAMS.ROUND_STEP;
  resistance.push({ price: roundBelow + PARAMS.ROUND_STEP, touches: null, kind: 'round' });
  support.push({ price: roundBelow, touches: null, kind: 'round' });
  return { resistance, support };
}

function fmtDxy(n) { return Number(n).toFixed(2); }
const DISCLAIMER = '\n\n(Info makro DXY doang -- BUKAN sinyal trading Kaela, DXY gak ada di Binance. Keputusan tetap di kamu.)';

async function main() {
  const candles = await fetchDxyCandles();
  if (candles.length < PARAMS.SWING_LOOKBACK * 4) {
    console.log('[DxyZoneMonitor] Data candle DXY kurang, skip siklus ini.');
    return;
  }
  const i = candles.length - 1;
  const latest = candles[i];
  const zones = detectDxyZones(candles, i);
  const state = loadState();

  if (state.watchZone) {
    const sideLabel = state.watchZone.side === 'support' ? 'SUPPORT' : 'RESISTANCE';
    const zoneAsActive = { price: state.watchZone.price, direction: state.watchZone.side === 'support' ? 'long' : 'short' };

    if (isZoneBroken(latest, zoneAsActive, { BREAK_CONFIRM_PCT: PARAMS.BREAK_CONFIRM_PCT })) {
      const impact = state.watchZone.side === 'support'
        ? 'dolar makin MELEMAH -- historisnya DUKUNG BTC/emas ke atas'
        : 'dolar makin MENGUAT -- historisnya TEKAN BTC/emas ke bawah';
      const msg = `💵 [Kaela] DXY TEMBUS ${sideLabel} $${fmtDxy(state.watchZone.price)}\n\nHarga sekarang $${fmtDxy(latest.close)} -- ${impact}.${DISCLAIMER}`;
      console.log(msg); addEntry('dxy-zone', msg, new Date()); await sendWhatsApp(msg);
      state.watchZone = null;
    } else if (pctDist(latest.close, state.watchZone.price) > PARAMS.MOVE_AWAY_PCT) {
      const msg = `💵 [Kaela] DXY GAGAL TEMBUS ${sideLabel} $${fmtDxy(state.watchZone.price)} -- mantul, harga sekarang $${fmtDxy(latest.close)}.${DISCLAIMER}`;
      console.log(msg); addEntry('dxy-zone', msg, new Date()); await sendWhatsApp(msg);
      state.watchZone = null;
    } else {
      console.log(`[DxyZoneMonitor] Masih mantengin ${sideLabel} $${fmtDxy(state.watchZone.price)}, harga sekarang $${fmtDxy(latest.close)}.`);
    }
  } else {
    const touched = findTouchCandidate(latest, zones);
    if (touched) {
      const sideLabel = touched.direction === 'long' ? 'SUPPORT' : 'RESISTANCE';
      state.watchZone = { price: touched.price, side: touched.direction === 'long' ? 'support' : 'resistance', kind: touched.kind, touches: touched.touches };
      const pair = findNearestPair(latest.close, zones);
      const msg = `💵 [Kaela] DXY DEKAT ${sideLabel} $${fmtDxy(touched.price)}\n\nHarga sekarang $${fmtDxy(latest.close)} -- WASPADA, titik ini biasanya jadi tempat mantul/tembus. Kaela kabarin lagi begitu arahnya jelas.${DISCLAIMER}`;
      console.log(msg); addEntry('dxy-zone', msg, new Date()); await sendWhatsApp(msg);
    } else {
      console.log(`[DxyZoneMonitor] DXY $${fmtDxy(latest.close)} belum deket zona manapun, skip.`);
    }
  }
  saveState(state);
}

main().catch((e) => {
  console.error('ERROR dxyZoneMonitor.js:', e.message);
  process.exit(1);
});
