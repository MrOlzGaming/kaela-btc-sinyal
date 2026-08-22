// Jalankan tiap 4 jam: node squeezeDetector.js
// Deteksi setup LONG/SHORT SQUEEZE otomatis di BTC perpetual futures -- lahir dari kejadian
// 19 Agustus 2026 (squeeze $2,7-3M) yang sempat dianalisa manual, lihat riset di grup WA.
//
// Rumus (dari riset publik, bukan tebakan -- lihat metodologi-sniper.html):
// - Funding rate SANGAT NEGATIF + Open Interest lagi NAIK = short numpuk (crowded shorts)
//   -> rawan SHORT SQUEEZE (harga bisa tiba-tiba MELONJAK, short kepaksa beli balik).
// - Funding rate SANGAT POSITIF + Open Interest lagi NAIK = long numpuk (crowded longs)
//   -> rawan LONG SQUEEZE (harga bisa tiba-tiba ANJLOK, long kepaksa jual paksa).
// Data funding+OI dari Bybit (v5 public API), BUKAN Binance Futures -- dicoba dulu fapi.binance.com,
// ternyata GitHub Actions (IP Azure US) kena block HTTP 451 "restricted location" dari Binance buat
// endpoint futures (beda dari data-api.binance.vision yang dipakai modul lain, itu khusus spot &
// gak kena block). Bybit gak ada batasan ini buat data publik. Harga/RSI tetap dari Binance spot
// (data-api.binance.vision) kayak modul lain -- cuma funding+OI yang pindah sumber.
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
const BYBIT_BASE = 'https://api.bybit.com';

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { lastType: null, lastAlertTime: null };
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// Bybit v5, category 'linear' (USDT perpetual) -- balikin { fundingRate, timestamp(ms) }[]
async function fetchFundingHistory(symbol, limit) {
  const res = await fetchWithRetry(`${BYBIT_BASE}/v5/market/funding/history?category=linear&symbol=${symbol}&limit=${limit}`);
  const data = await res.json();
  if (data.retCode !== 0) throw new Error(`Bybit funding error: ${data.retMsg}`);
  return data.result.list.map((f) => ({ fundingRate: f.fundingRate, timestamp: +f.fundingRateTimestamp }));
}

// Bybit v5 open interest -- balikin { openInterest, timestamp(ms) }[]
async function fetchOpenInterestHist(symbol, intervalTime, limit) {
  const res = await fetchWithRetry(`${BYBIT_BASE}/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=${intervalTime}&limit=${limit}`);
  const data = await res.json();
  if (data.retCode !== 0) throw new Error(`Bybit open-interest error: ${data.retMsg}`);
  return data.result.list.map((o) => ({ openInterest: o.openInterest, timestamp: +o.timestamp }));
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

  const [fundingHist, oiHist, dailyCandles, fearGreed] = await Promise.all([
    fetchFundingHistory('BTCUSDT', 9), // ~3 hari (funding tiap 8 jam)
    fetchOpenInterestHist('BTCUSDT', '1d', OI_LOOKBACK_DAYS + 1),
    fetchCandles('BTCUSDT', '1d', 30),
    fetchFearGreed(),
  ]);

  const avgFundingPct = (fundingHist.reduce((sum, f) => sum + parseFloat(f.fundingRate), 0) / fundingHist.length) * 100;

  const oiSorted = oiHist.map((o) => ({ oi: parseFloat(o.openInterest), t: o.timestamp })).sort((a, b) => a.t - b.t);
  const oiChangePct = oiSorted.length >= 2
    ? ((oiSorted[oiSorted.length - 1].oi - oiSorted[0].oi) / oiSorted[0].oi) * 100
    : 0;

  const closes = dailyCandles.map((c) => c.close);
  const rsiVal = rsi(closes, 14);
  const price = closes[closes.length - 1];

  let type = 'normal';
  if (avgFundingPct <= FUNDING_SHORT_THRESHOLD_PCT && oiChangePct >= OI_RISE_THRESHOLD_PCT) type = 'short_squeeze_setup';
  else if (avgFundingPct >= FUNDING_LONG_THRESHOLD_PCT && oiChangePct >= OI_RISE_THRESHOLD_PCT) type = 'long_squeeze_setup';

  console.log(`[SqueezeDetector] ${now.toISOString()} -- funding avg 3h: ${fmtPct(avgFundingPct)}, OI ${OI_LOOKBACK_DAYS}h: ${fmtPct(oiChangePct)}, RSI: ${rsiVal}, F&G: ${fearGreed}, type: ${type}`);

  if (type === 'normal') {
    if (state.lastType) console.log('[SqueezeDetector] Kondisi udah normal lagi, reset state.');
    saveState({ lastType: null, lastAlertTime: null });
    return;
  }

  const cooldownOk = state.lastType !== type || !state.lastAlertTime || now.getTime() - new Date(state.lastAlertTime).getTime() > COOLDOWN_MS;
  if (!cooldownOk) {
    console.log(`[SqueezeDetector] ${type} masih sama & masih cooldown, skip kirim.`);
    return;
  }

  const msg = formatAlert({ type, avgFundingPct, oiChangePct, rsiVal, fearGreed, price });
  console.log(msg + '\n');
  addEntry('squeeze', msg, now);
  await sendWhatsApp(msg);
  saveState({ lastType: type, lastAlertTime: now.toISOString() });
}

main().catch((e) => {
  console.error('ERROR squeezeDetector.js:', e.message);
  process.exit(1);
});
