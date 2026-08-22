// Regime tracker -- korelasi ROLLING antara BTC-vs-Nasdaq dan Emas-vs-DXY. 22 Agu 2026, bagian
// dari "Kaela analis tier Bloomberg" (lihat memori project-kaela-analyst-tier).
//
// Kenapa ini penting: analis institusional selalu mikir "rezim apa sekarang" sebelum baca sinyal
// apapun. BTC KADANG gerak kayak aset risiko biasa (ngikutin saham teknologi -- "risk-on regime"),
// KADANG independen/decoupled. Emas KADANG gerak PERSIS kebalikan DXY (rezim "tekstbuk"), KADANG
// didorong faktor lain (pembelian bank sentral, safe-haven flows) yang bikin korelasi ke DXY
// lemah. Tau rezim SEKARANG bikin baca sinyal harian (macroData.js/cotReport.js) lebih akurat --
// makna "DXY naik" beda kalau lagi rezim korelasi kuat vs lemah.
//
// Sumber data: Nasdaq Composite (NASDAQCOM) + DXY (DTWEXBGS) dari FRED (gratis, resmi, lihat
// macroData.js), BTC/Emas dari Binance spot (data-api.binance.vision, gratis, gak kena geo-block).

const { fetchWithRetry } = require('./httpRetry');
const { fetchFredSeriesRows } = require('./macroData');

const BINANCE_BASE = 'https://data-api.binance.vision/api/v3/klines';

async function fetchDailyCloses(symbol, limit) {
  const res = await fetchWithRetry(`${BINANCE_BASE}?symbol=${symbol}&interval=1d&limit=${limit}`);
  const raw = await res.json();
  return raw.map((c) => ({ date: new Date(c[6]).toISOString().slice(0, 10), value: parseFloat(c[4]) }));
}

// Pearson correlation coefficient dari 2 array angka SEJAJAR (index sama = pasangan sama).
function pearsonCorrelation(a, b) {
  const n = a.length;
  const meanA = a.reduce((s, x) => s + x, 0) / n;
  const meanB = b.reduce((s, x) => s + x, 0) / n;
  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA, db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA === 0 || varB === 0) return 0;
  return cov / Math.sqrt(varA * varB);
}

// Gabungin 2 seri {date, value}[] jadi pasangan return harian (%) yang TANGGALNYA COCOK di
// dua-duanya -- BTC/Emas trading 7 hari/minggu, Nasdaq/DXY cuma weekday, jadi inner-join by date
// otomatis buang weekend (gak dipaksa isi kosong).
function alignedDailyReturns(seriesA, seriesB) {
  const mapB = new Map(seriesB.map((r) => [r.date, r.value]));
  const paired = seriesA
    .filter((r) => mapB.has(r.date))
    .map((r) => ({ date: r.date, a: r.value, b: mapB.get(r.date) }))
    .sort((x, y) => x.date.localeCompare(y.date));

  const returnsA = [], returnsB = [];
  for (let i = 1; i < paired.length; i++) {
    returnsA.push((paired[i].a - paired[i - 1].a) / paired[i - 1].a);
    returnsB.push((paired[i].b - paired[i - 1].b) / paired[i - 1].b);
  }
  return { returnsA, returnsB, dates: paired.slice(1).map((p) => p.date) };
}

function classifyCorrelation(r) {
  const abs = Math.abs(r);
  if (abs >= 0.6) return r > 0 ? 'KUAT POSITIF' : 'KUAT NEGATIF';
  if (abs >= 0.3) return r > 0 ? 'moderat positif' : 'moderat negatif';
  return 'lemah/gak konsisten';
}

async function fetchBtcNasdaqRegime() {
  // 120 hari kalender cukup buat dapet ~85-90 hari trading beririsan (buang weekend) -- cukup
  // buat window 30 & 90 hari rolling.
  const [btc, nasdaqRows] = await Promise.all([
    fetchDailyCloses('BTCUSDT', 120),
    fetchFredSeriesRows('NASDAQCOM'),
  ]);
  const nasdaq = nasdaqRows.slice(-120);
  const { returnsA, returnsB, dates } = alignedDailyReturns(btc, nasdaq);
  if (returnsA.length < 15) throw new Error('Data BTC-Nasdaq beririsan gak cukup buat korelasi');

  const corr30 = pearsonCorrelation(returnsA.slice(-30), returnsB.slice(-30));
  const corr90 = pearsonCorrelation(returnsA.slice(-90), returnsB.slice(-90));
  return {
    corr30, corr90,
    label30: classifyCorrelation(corr30),
    label90: classifyCorrelation(corr90),
    sampleDays: returnsA.length,
    latestDate: dates[dates.length - 1],
  };
}

async function fetchGoldDxyRegime() {
  const [gold, dxyRows] = await Promise.all([
    fetchDailyCloses('PAXGUSDT', 120),
    fetchFredSeriesRows('DTWEXBGS'),
  ]);
  const dxy = dxyRows.slice(-120);
  const { returnsA, returnsB, dates } = alignedDailyReturns(gold, dxy);
  if (returnsA.length < 15) throw new Error('Data Emas-DXY beririsan gak cukup buat korelasi');

  const corr30 = pearsonCorrelation(returnsA.slice(-30), returnsB.slice(-30));
  const corr90 = pearsonCorrelation(returnsA.slice(-90), returnsB.slice(-90));
  return {
    corr30, corr90,
    label30: classifyCorrelation(corr30),
    label90: classifyCorrelation(corr90),
    sampleDays: returnsA.length,
    latestDate: dates[dates.length - 1],
  };
}

module.exports = { pearsonCorrelation, alignedDailyReturns, classifyCorrelation, fetchBtcNasdaqRegime, fetchGoldDxyRegime };

if (require.main === module) {
  (async () => {
    console.log('BTC vs Nasdaq:', JSON.stringify(await fetchBtcNasdaqRegime(), null, 2));
    console.log('Emas vs DXY:', JSON.stringify(await fetchGoldDxyRegime(), null, 2));
  })().catch((e) => {
    console.error('ERROR regimeTracker.js:', e.message);
    process.exit(1);
  });
}
