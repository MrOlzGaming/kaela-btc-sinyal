// 4 indikator makro tambahan (22 Agu 2026, riset+approval Olan) -- semua GRATIS, no API key:
// - DVOL (Deribit): "VIX-nya BTC", ekspektasi volatilitas 30 hari ke depan dari pasar OPSI
// - Stablecoin Supply Growth (DefiLlama): suplai USDT beredar naik = dana segar siap masuk crypto
// - Yield Curve 10Y-2Y (FRED): indikator resesi klasik, dipantau semua analis makro beneran
// - M2 Money Supply (FRED): jumlah uang beredar AS, BTC historisnya korelasi ke pertumbuhan M2
// Bagian dari "Kaela analis tier Bloomberg" (lihat memori project-kaela-analyst-tier).

const { fetchWithRetry } = require('./httpRetry');
const { fetchFredSeriesRows } = require('./macroData');

// ============ DVOL (Deribit, volatilitas implisit BTC) ============
async function fetchBtcDvol() {
  const end = Date.now();
  const start = end - 7 * 24 * 60 * 60 * 1000;
  const res = await fetchWithRetry(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&start_timestamp=${start}&end_timestamp=${end}&resolution=3600`);
  const data = await res.json();
  const rows = data.result.data; // [timestamp, open, high, low, close][]
  if (!rows || rows.length === 0) throw new Error('DVOL: gak ada data');
  const latest = rows[rows.length - 1][4]; // close terbaru
  const weekAgo = rows[0][4];
  return { value: latest, changePct: ((latest - weekAgo) / weekAgo) * 100 };
}

function dvolInsight(dvol) {
  // Ambang KASAR (bukan backtest presisi) -- DVOL historis BTC biasanya berkisar 40-80, <35
  // dianggap tenang/complacent, >90 dianggap panik/ekstrem. Dipakai buat KONTEKS, bukan vote.
  if (dvol.value < 35) return 'pasar opsi TENANG (complacent) -- historis kondisi setenang ini kadang jadi "kalem sebelum badai"';
  if (dvol.value > 90) return 'pasar opsi PANIK/ekstrem -- ekspektasi gerakan liar 30 hari ke depan';
  return 'pasar opsi normal';
}

// ============ Stablecoin Supply (DefiLlama) ============
async function fetchStablecoinSupplyGrowth() {
  const res = await fetchWithRetry('https://stablecoins.llama.fi/stablecoins?includePrices=false');
  const data = await res.json();
  // Jumlahin USDT+USDC doang (2 stablecoin terbesar, paling representatif buat "dana siap masuk
  // crypto" -- yang lain porsinya kecil/noise) -- semua dalam denominasi USD (peggedUSD).
  const target = ['Tether', 'USD Coin'];
  const relevant = data.peggedAssets.filter((a) => target.includes(a.name));
  const current = relevant.reduce((s, a) => s + (a.circulating?.peggedUSD || 0), 0);
  const weekAgo = relevant.reduce((s, a) => s + (a.circulatingPrevWeek?.peggedUSD || 0), 0);
  if (weekAgo === 0) throw new Error('Stablecoin supply: data minggu lalu kosong');
  return { current, weekAgo, changePct: ((current - weekAgo) / weekAgo) * 100 };
}

// ============ Yield Curve 10Y-2Y (FRED T10Y2Y) ============
async function fetchYieldCurve() {
  const rows = await fetchFredSeriesRows('T10Y2Y');
  const latest = rows[rows.length - 1];
  return { value: latest.value, date: latest.date, inverted: latest.value < 0 };
}

function yieldCurveInsight(yc) {
  if (yc.inverted) return 'TERBALIK (inverted) -- historis sering mendahului resesi 12-18 bulan ke depan, sinyal makro paling dipercaya analis';
  if (yc.value < 0.3) return 'hampir datar -- pasar obligasi lagi waspada, belum panik';
  return 'normal (positif) -- gak ada sinyal resesi dari kurva ini';
}

// ============ M2 Money Supply (FRED WM2NS, mingguan) ============
async function fetchM2Growth() {
  const rows = await fetchFredSeriesRows('WM2NS');
  const latest = rows[rows.length - 1];
  const targetDate = new Date(latest.date);
  targetDate.setFullYear(targetDate.getFullYear() - 1);
  // rows ASCENDING (lama->baru) -- ambil yang PALING BARU di antara yang masih <= target (bukan
  // yang PERTAMA ketemu, itu bug: .find() di array ascending balikin baris TERTUA di seluruh
  // histori, bukan yang paling dekat ke 1 tahun lalu).
  const candidates = rows.filter((r) => new Date(r.date) <= targetDate);
  const yearAgo = candidates.length ? candidates[candidates.length - 1] : null;
  const changePctYoY = yearAgo ? ((latest.value - yearAgo.value) / yearAgo.value) * 100 : null;
  return { value: latest.value, date: latest.date, changePctYoY };
}

function m2Insight(m2) {
  if (m2.changePctYoY == null) return 'data histori kurang buat perbandingan tahunan';
  if (m2.changePctYoY > 5) return `tumbuh ${m2.changePctYoY.toFixed(1)}% YoY -- likuiditas melimpah, historis tailwind buat aset risiko termasuk BTC`;
  if (m2.changePctYoY < 0) return `MENYUSUT ${Math.abs(m2.changePctYoY).toFixed(1)}% YoY -- likuiditas mengetat, historis headwind buat aset risiko`;
  return `tumbuh pelan ${m2.changePctYoY.toFixed(1)}% YoY -- netral`;
}

// ============ Fed Funds Rate (FRED DFF, harian) ============
// SINYAL diambil dari TREN (naik/turun 90 hari), BUKAN level absolut -- level 3,63% artinya beda
// tergantung konteks (siklus 2020 vs 2024 vs sekarang), tapi ARAH pergerakannya (lagi dipotong
// The Fed = dovish, lagi dinaikkan = hawkish) konsisten maknanya kapan pun -- sama pola kayak
// classifyDxyTrend/classifyRealYieldTrend di macroData.js.
async function fetchFedFundsRate() {
  const rows = await fetchFredSeriesRows('DFF');
  const latest = rows[rows.length - 1];
  const targetDate = new Date(latest.date);
  targetDate.setDate(targetDate.getDate() - 90);
  const candidates = rows.filter((r) => new Date(r.date) <= targetDate);
  const ago90d = candidates.length ? candidates[candidates.length - 1] : null;
  const changeBps = ago90d ? (latest.value - ago90d.value) * 100 : null; // basis poin
  return { value: latest.value, date: latest.date, changeBps };
}

// Ambang 25bp = 1x langkah standar The Fed (naik/turun 0,25%) -- di bawah itu dianggap "ditahan".
function classifyFedRateTrend(fed) {
  if (fed.changeBps == null) return { arah: 'TIDAK DIKETAHUI', efek: 'data histori kurang' };
  if (fed.changeBps <= -25) return { arah: 'DIPOTONG (dovish)', efek: 'historis BULLISH buat aset risiko (BTC) & Emas -- likuiditas lebih longgar, biaya peluang pegang Emas turun' };
  if (fed.changeBps >= 25) return { arah: 'DINAIKKAN (hawkish)', efek: 'historis BEARISH buat aset risiko (BTC) & Emas -- likuiditas mengetat, biaya peluang pegang Emas naik' };
  return { arah: 'DITAHAN', efek: 'netral, The Fed lagi wait-and-see' };
}

// ============ Credit Spread High-Yield (FRED BAMLH0A0HYM2, harian) ============
// Selisih bunga obligasi korporasi BERISIKO vs obligasi pemerintah AMAN -- melebar = investor
// mulai takut/minta kompensasi lebih (risk-off), menyempit = pede/risk-on. Beda dari yield curve
// (itu bandingin JATUH TEMPO beda, ini bandingin RISIKO KREDIT beda) -- nangkep jenis stres pasar
// yang beda, sering duluan gerak sebelum kelihatan di harga saham/crypto.
async function fetchCreditSpread() {
  const rows = await fetchFredSeriesRows('BAMLH0A0HYM2');
  const latest = rows[rows.length - 1];
  const targetDate = new Date(latest.date);
  targetDate.setDate(targetDate.getDate() - 30);
  const candidates = rows.filter((r) => new Date(r.date) <= targetDate);
  const ago30d = candidates.length ? candidates[candidates.length - 1] : null;
  const changeBps = ago30d ? (latest.value - ago30d.value) * 100 : null;
  return { value: latest.value, date: latest.date, changeBps };
}

function classifyCreditSpreadTrend(cs) {
  if (cs.changeBps == null) return { arah: 'TIDAK DIKETAHUI', efek: 'data histori kurang' };
  if (cs.changeBps >= 30) return { arah: 'MELEBAR', efek: 'pasar kredit mulai waspada/risk-off -- historis headwind buat BTC (aset risiko)' };
  if (cs.changeBps <= -30) return { arah: 'MENYEMPIT', efek: 'pasar kredit pede/risk-on -- historis tailwind buat BTC' };
  return { arah: 'STABIL', efek: 'netral' };
}

async function safe(fn, label) {
  try {
    return await fn();
  } catch (e) {
    console.log(`[AdvancedMacro] ${label} gagal diambil (dilewatin):`, e.message.slice(0, 120));
    return null;
  }
}

async function fetchAdvancedMacroContext() {
  const [dvol, stablecoin, yieldCurve, m2, fedRate, creditSpread] = await Promise.all([
    safe(fetchBtcDvol, 'DVOL'),
    safe(fetchStablecoinSupplyGrowth, 'Stablecoin Supply'),
    safe(fetchYieldCurve, 'Yield Curve'),
    safe(fetchM2Growth, 'M2 Money Supply'),
    safe(fetchFedFundsRate, 'Fed Funds Rate'),
    safe(fetchCreditSpread, 'Credit Spread'),
  ]);
  return { dvol, stablecoin, yieldCurve, m2, fedRate, creditSpread };
}

module.exports = {
  fetchBtcDvol, dvolInsight, fetchStablecoinSupplyGrowth, fetchYieldCurve, yieldCurveInsight,
  fetchM2Growth, m2Insight, fetchFedFundsRate, classifyFedRateTrend, fetchCreditSpread,
  classifyCreditSpreadTrend, fetchAdvancedMacroContext,
};

if (require.main === module) {
  fetchAdvancedMacroContext().then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => {
    console.error('ERROR advancedMacro.js:', e.message);
    process.exit(1);
  });
}
