// Anomaly Scanner -- rekam histori indikator kita SENDIRI tiap hari, lapor kalau ada yang keluar
// jauh dari kebiasaan historisnya. 22 Agu 2026, permintaan Olan ("aku pengen Kaela beneran makin
// pinter... kritis terhadap data, kayak Burry The Big Short") -- bagian dari "Kaela analis tier
// Bloomberg" (lihat memori project-kaela-analyst-tier).
//
// Metode: robust z-score (median + MAD, BUKAN mean+stddev biasa -- MAD lebih tahan sama outlier
// ekstrem yang justru sering muncul di data finansial, jadi gak gampang "keracunan" data lama).
// DIVALIDASI via backtest data historis FRED beneran (Credit Spread + Yield Curve, puluhan tahun)
// sebelum dipasang live -- z>=2.5 nangkep klaster kejadian NYATA (Agustus 2024 gejolak carry-trade
// global, dst), bukan noise acak.
//
// Butuh minimal 20 hari histori numpuk dulu per indikator sebelum mulai evaluasi (statistik gak
// bisa dipercaya kalau sample-nya kurang) -- sama filosofinya kayak squeezeDetector.js nunggu OI.

const fs = require('fs');
const path = require('path');
const { fetchAdvancedMacroContext } = require('./advancedMacro');
const { fetchGoldCotContext } = require('./cotReport');
const { fetchBtcNasdaqRegime, fetchGoldDxyRegime } = require('./regimeTracker');
const { sendWhatsApp } = require('./fonnte');
const { addEntry } = require('./archive');
const { WEB_URL } = require('./config');
const { CATEGORY_COLOR } = require('./categoryColors');

const STATE_PATH = path.join(__dirname, 'anomaly-history.json');
const MIN_HISTORY = 20;
const MAX_HISTORY = 200; // ~6-7 bulan data harian, cukup buat konteks tanpa file numpuk selamanya
const Z_THRESHOLD = 2.5;
const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3 hari -- anomali yang MASIH sama gak diulang-ulang lapor tiap hari

const TRACKED_LABELS = {
  dvol: '🌊 DVOL (Volatilitas BTC)',
  fedRate: '🏦 Fed Funds Rate',
  creditSpread: '📊 Credit Spread (High-Yield)',
  yieldCurve: '📉 Yield Curve 10Y-2Y',
  m2YoY: '💵 M2 Money Supply (YoY)',
  stablecoinGrowth: '💰 Stablecoin Supply (7 hari)',
  cotNetPct: '🏦 COT Smart Money Emas (% net-long)',
  btcNasdaqCorr: '🔗 Korelasi BTC-Nasdaq (90 hari)',
  goldDxyCorr: '🔗 Korelasi Emas-DXY (90 hari)',
};

async function safe(fn, label) {
  try {
    return await fn();
  } catch (e) {
    console.log(`[AnomalyScanner] ${label} gagal diambil (dilewatin):`, e.message.slice(0, 120));
    return null;
  }
}

async function collectTodayValues() {
  const [advancedMacro, cot, btcRegime, goldRegime] = await Promise.all([
    safe(fetchAdvancedMacroContext, 'Advanced Macro'),
    safe(fetchGoldCotContext, 'COT'),
    safe(fetchBtcNasdaqRegime, 'BTC-Nasdaq Regime'),
    safe(fetchGoldDxyRegime, 'Emas-DXY Regime'),
  ]);

  const values = {};
  if (advancedMacro?.dvol) values.dvol = advancedMacro.dvol.value;
  if (advancedMacro?.fedRate) values.fedRate = advancedMacro.fedRate.value;
  if (advancedMacro?.creditSpread) values.creditSpread = advancedMacro.creditSpread.value;
  if (advancedMacro?.yieldCurve) values.yieldCurve = advancedMacro.yieldCurve.value;
  if (advancedMacro?.m2?.changePctYoY != null) values.m2YoY = advancedMacro.m2.changePctYoY;
  if (advancedMacro?.stablecoin?.changePct != null) values.stablecoinGrowth = advancedMacro.stablecoin.changePct;
  if (cot) values.cotNetPct = cot.netPctOi;
  if (btcRegime) values.btcNasdaqCorr = btcRegime.corr90;
  if (goldRegime) values.goldDxyCorr = goldRegime.corr90;
  return values;
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { history: {}, lastFlagged: {} };
  const s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  if (!s.history) s.history = {};
  if (!s.lastFlagged) s.lastFlagged = {};
  return s;
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Robust z-score: (nilai - median) / (MAD * 1.4826) -- konstanta 1.4826 nyamain skala MAD ke
// setara standard deviation buat distribusi normal, konvensi statistik baku.
function robustZScore(value, history) {
  const med = median(history);
  const mad = median(history.map((x) => Math.abs(x - med)));
  if (mad === 0) return 0;
  return (value - med) / (mad * 1.4826);
}

function formatAnomaly(key, value, z, history) {
  const label = TRACKED_LABELS[key] || key;
  const med = median(history);
  const arah = z > 0 ? 'JAUH DI ATAS' : 'JAUH DI BAWAH';
  return [
    `${label}: ${value.toFixed(2)} -- ${arah} kebiasaan historis kita (median ${med.toFixed(2)}, z-score ${z.toFixed(1)})`,
    `   Ringkasan: nilai sekarang beda signifikan dari ${history.length} hari terakhir -- layak diperhatiin, bukan berarti otomatis sinyal beli/jual, tapi kondisi lagi gak biasa.`,
  ].join('\n');
}

async function main() {
  const now = new Date();
  const state = loadState();
  const todayValues = await collectTodayValues();

  const anomalies = [];
  for (const [key, value] of Object.entries(todayValues)) {
    if (!state.history[key]) state.history[key] = [];
    const hist = state.history[key];

    if (hist.length >= MIN_HISTORY) {
      const z = robustZScore(value, hist.map((h) => h.v));
      if (Math.abs(z) >= Z_THRESHOLD) {
        const lastFlag = state.lastFlagged[key];
        const cooldownOk = !lastFlag || now.getTime() - new Date(lastFlag).getTime() > COOLDOWN_MS;
        if (cooldownOk) {
          anomalies.push({ key, value, z, historyValues: hist.map((h) => h.v) });
          state.lastFlagged[key] = now.toISOString();
        }
      }
    }

    hist.push({ date: now.toISOString(), v: value });
    state.history[key] = hist.slice(-MAX_HISTORY);
  }

  saveState(state);

  if (anomalies.length === 0) {
    console.log(`[AnomalyScanner] ${now.toISOString()} -- normal, gak ada anomali (histori: ${Object.entries(state.history).map(([k, v]) => `${k}=${v.length}`).join(', ')}).`);
    return;
  }

  const msg = [
    `${CATEGORY_COLOR.laporan.emoji} 🔍 KAELA ANOMALY SCANNER`,
    '',
    `Ditemukan ${anomalies.length} indikator lagi gak biasa dibanding histori kita sendiri:`,
    '',
    ...anomalies.map((a) => formatAnomaly(a.key, a.value, a.z, a.historyValues)),
    '',
    '⚠️ Ini deteksi STATISTIK murni (z-score vs histori kita), BUKAN backtest sinyal Sniper/Musiman -- level keyakinannya beda, murni radar "ada yang aneh, cek lebih lanjut".',
    '',
    `🔗 ${WEB_URL}/analis.html`,
  ].join('\n');

  console.log(msg);
  addEntry('anomaly', msg, now);
  await sendWhatsApp(msg);
}

main().catch((e) => {
  console.error('ERROR anomalyScanner.js:', e.message);
  process.exit(1);
});
