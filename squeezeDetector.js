// Jalankan tiap 4 jam: node squeezeDetector.js
// Deteksi setup LONG/SHORT SQUEEZE otomatis di BTC perpetual futures -- lahir dari kejadian
// 19 Agustus 2026 (squeeze $2,7-3M) yang sempat dianalisa manual, lihat riset di grup WA.
//
// Rumus (dari riset publik, bukan tebakan -- lihat metodologi-sniper.html):
// - Funding rate SANGAT NEGATIF + Open Interest lagi NAIK = short numpuk (crowded shorts)
//   -> rawan SHORT SQUEEZE (harga bisa tiba-tiba MELONJAK, short kepaksa beli balik).
// - Funding rate SANGAT POSITIF + Open Interest lagi NAIK = long numpuk (crowded longs)
//   -> rawan LONG SQUEEZE (harga bisa tiba-tiba ANJLOK, long kepaksa jual paksa).
// Data funding+OI dari OKX (public API) -- Binance Futures (fapi.binance.com) DAN Bybit sama-sama
// kena block (HTTP 451 / 403 CloudFront "restricted location") dari server GitHub Actions (Azure
// US), dicek langsung lewat workflow diagnostik 22 Agu 2026. OKX satu-satunya dari 6 exchange yang
// dites yang lolos. Harga/RSI tetap dari Binance spot (data-api.binance.vision, gak kena block --
// beda dari endpoint futures) kayak modul lain.
// OKX gak sediakan histori Open Interest publik (cuma snapshot SEKARANG) -- jadi trend OI dihitung
// SENDIRI: tiap run nyimpen snapshot OI ke state file, dibandingin sama snapshot ~OI_LOOKBACK_DAYS
// hari lalu. Butuh state numpuk dulu beberapa hari sebelum trend OI valid (skip evaluasi kalau
// belum cukup data).
// Semua GRATIS, gak perlu API key/biaya -- konsisten sama prinsip proyek ini.
//
// Ini MURNI radar/peringatan dini, BUKAN sinyal entry. Kaela gak buka posisi dari ini.

const FUNDING_LONG_THRESHOLD_PCT = 0.05;  // per 8 jam -- di atas ini dianggap long crowded (umum dipakai analis)
const FUNDING_SHORT_THRESHOLD_PCT = -0.03; // per 8 jam -- di bawah ini dianggap short crowded
const OI_RISE_THRESHOLD_PCT = 10;          // OI naik >=10% dalam window lookback = numpuk cepat
const OI_LOOKBACK_DAYS = 5;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;   // 24 jam -- funding update tiap 8 jam, jangan spam tiap kali masih di kondisi sama

const fs = require('fs');
const path = require('path');
const { fetchWithRetry } = require('./httpRetry');
const { fetchCandles, rsi } = require('./technicalAnalysis');
const { sendWhatsApp } = require('./fonnte');
const { addEntry } = require('./archive');
const { WEB_URL } = require('./config');
const { CATEGORY_COLOR } = require('./categoryColors');

const STATE_PATH = path.join(__dirname, 'squeeze-alert-state.json');
const OKX_BASE = 'https://www.okx.com';
const OKX_INST = 'BTC-USDT-SWAP';

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { lastType: null, lastAlertTime: null, oiHistory: [] };
  const s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  if (!s.oiHistory) s.oiHistory = [];
  return s;
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// OKX -- balikin { fundingRate, timestamp(ms) }[]
async function fetchFundingHistory(instId, limit) {
  const res = await fetchWithRetry(`${OKX_BASE}/api/v5/public/funding-rate-history?instId=${instId}&limit=${limit}`);
  const data = await res.json();
  if (data.code !== '0') throw new Error(`OKX funding error: ${data.msg}`);
  return data.data.map((f) => ({ fundingRate: f.fundingRate, timestamp: +f.fundingTime }));
}

// OKX cuma sediain SNAPSHOT sekarang (gak ada histori publik) -- balikin OI sekarang dalam BTC (oiCcy)
async function fetchOpenInterestNow(instId) {
  const res = await fetchWithRetry(`${OKX_BASE}/api/v5/public/open-interest?instId=${instId}`);
  const data = await res.json();
  if (data.code !== '0') throw new Error(`OKX open-interest error: ${data.msg}`);
  return { openInterest: parseFloat(data.data[0].oiCcy), timestamp: +data.data[0].ts };
}

async function fetchFearGreed() {
  try {
    const res = await fetchWithRetry('https://api.alternative.me/fng/?limit=1');
    const data = await res.json();
    return +data.data[0].value;
  } catch {
    return null; // suportif doang, gak fatal kalau gagal
  }
}

function fmtPct(n) {
  return (n >= 0 ? '+' : '') + n.toFixed(3) + '%';
}

function formatAlert({ type, avgFundingPct, oiChangePct, rsiVal, fearGreed, price }) {
  const isShort = type === 'short_squeeze_setup';
  const judul = isShort ? 'SETUP SHORT SQUEEZE' : 'SETUP LONG SQUEEZE';
  const arahRisiko = isShort ? 'harga bisa tiba-tiba MELONJAK (short kepaksa beli balik)' : 'harga bisa tiba-tiba ANJLOK (long kepaksa jual paksa)';
  const kondisi = isShort ? 'Short lagi numpuk (funding sangat negatif) + Open Interest naik cepat.' : 'Long lagi numpuk (funding sangat positif) + Open Interest naik cepat.';
  return [
    `⬛ ⚠️ KAELA — ${judul} (BTC)`,
    '',
    kondisi,
    `Risiko: ${arahRisiko}.`,
    '',
    `Harga sekarang: $${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
    `Funding rate avg (3 hari): ${fmtPct(avgFundingPct)}`,
    `Open Interest (${OI_LOOKBACK_DAYS} hari): ${fmtPct(oiChangePct)}`,
    rsiVal != null ? `RSI harian: ${rsiVal.toFixed(0)}` : null,
    fearGreed != null ? `Fear & Greed: ${fearGreed}` : null,
    '',
    '⚠️ Ini radar setup, BUKAN sinyal entry -- Kaela gak buka posisi dari ini. Murni peringatan dini biar gak kaget kalau tiba-tiba ada pergerakan liar.',
    '',
    `🔗 ${WEB_URL}/metodologi-sniper.html`,
  ].filter(Boolean).join('\n');
}

async function main() {
  const now = new Date();
  const state = loadState();

  const [fundingHist, oiNow, dailyCandles, fearGreed] = await Promise.all([
    fetchFundingHistory(OKX_INST, 9), // ~3 hari (funding tiap 8 jam)
    fetchOpenInterestNow(OKX_INST),
    fetchCandles('BTCUSDT', '1d', 30),
    fetchFearGreed(),
  ]);

  const avgFundingPct = (fundingHist.reduce((sum, f) => sum + parseFloat(f.fundingRate), 0) / fundingHist.length) * 100;

  // Numpukin snapshot OI SENDIRI (OKX gak sediain histori publik) -- buang yang lebih tua dari 2x lookback
  const oiHistory = [...state.oiHistory, { oi: oiNow.openInterest, t: oiNow.timestamp }]
    .filter((s) => now.getTime() - s.t <= OI_LOOKBACK_DAYS * 2 * 24 * 60 * 60 * 1000);

  const lookbackMs = OI_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const oldEnough = oiHistory.filter((s) => now.getTime() - s.t >= lookbackMs);
  const baseline = oldEnough.length ? oldEnough.reduce((a, b) => (a.t > b.t ? a : b)) : null; // paling BARU di antara yang udah cukup umur
  const oiChangePct = baseline ? ((oiNow.openInterest - baseline.oi) / baseline.oi) * 100 : null;

  const closes = dailyCandles.map((c) => c.close);
  const rsiVal = rsi(closes, 14);
  const price = closes[closes.length - 1];

  let type = 'normal';
  if (oiChangePct == null) {
    console.log(`[SqueezeDetector] ${now.toISOString()} -- belum cukup histori OI (butuh ${OI_LOOKBACK_DAYS} hari numpuk dulu), skip evaluasi. funding avg 3h: ${fmtPct(avgFundingPct)}, RSI: ${rsiVal}, F&G: ${fearGreed}`);
    saveState({ ...state, oiHistory });
    return;
  }
  if (avgFundingPct <= FUNDING_SHORT_THRESHOLD_PCT && oiChangePct >= OI_RISE_THRESHOLD_PCT) type = 'short_squeeze_setup';
  else if (avgFundingPct >= FUNDING_LONG_THRESHOLD_PCT && oiChangePct >= OI_RISE_THRESHOLD_PCT) type = 'long_squeeze_setup';

  console.log(`[SqueezeDetector] ${now.toISOString()} -- funding avg 3h: ${fmtPct(avgFundingPct)}, OI ${OI_LOOKBACK_DAYS}h: ${fmtPct(oiChangePct)}, RSI: ${rsiVal}, F&G: ${fearGreed}, type: ${type}`);

  if (type === 'normal') {
    if (state.lastType) console.log('[SqueezeDetector] Kondisi udah normal lagi, reset state.');
    saveState({ lastType: null, lastAlertTime: null, oiHistory });
    return;
  }

  const cooldownOk = state.lastType !== type || !state.lastAlertTime || now.getTime() - new Date(state.lastAlertTime).getTime() > COOLDOWN_MS;
  if (!cooldownOk) {
    console.log(`[SqueezeDetector] ${type} masih sama & masih cooldown, skip kirim.`);
    saveState({ ...state, oiHistory });
    return;
  }

  const msg = formatAlert({ type, avgFundingPct, oiChangePct, rsiVal, fearGreed, price });
  console.log(msg + '\n');
  addEntry('squeeze', msg, now);
  await sendWhatsApp(msg);
  saveState({ lastType: type, lastAlertTime: now.toISOString(), oiHistory });
}

main().catch((e) => {
  console.error('ERROR squeezeDetector.js:', e.message);
  process.exit(1);
});
