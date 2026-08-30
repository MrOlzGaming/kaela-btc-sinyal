// Data makro AS -- DXY (indeks dolar) + real yield 10 tahun. Real yield dari FRED (Federal Reserve
// Economic Data), sumber RESMI pemerintah AS, GRATIS, TANPA API key (pakai endpoint publik
// fredgraph.csv, bukan REST API resmi yang butuh registrasi key -- data SAMA, cuma beda cara akses).
// 22 Agu 2026 -- awal dari ide "Kaela analis tier Bloomberg" (lihat memori project-kaela-analyst-tier).
//
// FIX 30 Agu 2026 (Olan: "setiap pesan yang dikirim kaela dxy 118 stabil, aku fikir itu dxy index
// dolar yang sekarang 99-100") -- DXY DULU pakai FRED DTWEXBGS ("Nominal Broad U.S. Dollar Index"),
// index RESMI & VALID tapi BEDA index dari DXY yang dikenal umum di dunia trading (basket mata
// uang lebih luas + base tahun beda -- nilainya ~118, BUKAN salah/palsu, cuma SALAH LABEL). DXY
// sekarang pakai sumber yang SAMA PERSIS kayak dxyContext.js/dxyZoneMonitor.js (Yahoo Finance
// DX-Y.NYB, ICE US Dollar Index -- index asli yang dimaksud "DXY" di pasar) -- SATU sumber
// kebenaran DXY di SELURUH sistem, gak ada lagi 2 angka beda buat "DXY" yang sama tergantung
// subsistem mana yang generate pesannya.
//
// Kenapa ini penting buat Emas: harga Emas historisnya BERLAWANAN arah sama real yield (yield
// riil naik = biaya peluang pegang emas -yang gak ada bunganya- naik = Emas cenderung tertekan)
// dan BERLAWANAN arah sama DXY (dolar kuat = Emas dalam dolar jadi lebih mahal buat pembeli
// non-dolar = permintaan turun). Ini BUKAN korelasi sempurna/pasti, tapi hubungan makro paling
// mendasar yang dipakai analis institusional buat baca Emas -- jauh lebih relevan dari chart
// pattern doang.

const { fetchWithRetry } = require('./httpRetry');

const FRED_CSV_BASE = 'https://fred.stlouisfed.org/graph/fredgraph.csv';

// Semua baris { date, value } valid dari 1 seri FRED, TERLAMA->TERBARU. CSV formatnya: header
// lalu baris "YYYY-MM-DD,value" -- kadang value "." (hari libur/blm rilis), difilter biar cuma
// ambil baris valid. Diekspos terpisah (bukan cuma latest/prev) buat kebutuhan korelasi rolling
// (regimeTracker.js) yang butuh histori penuh, bukan cuma 2 titik terakhir.
async function fetchFredSeriesRows(seriesId) {
  const res = await fetchWithRetry(`${FRED_CSV_BASE}?id=${seriesId}`);
  const text = await res.text();
  const rows = text.trim().split('\n').slice(1) // buang header
    .map((line) => {
      const [date, raw] = line.split(',');
      return { date, value: parseFloat(raw) };
    })
    .filter((r) => !isNaN(r.value));
  if (rows.length === 0) throw new Error(`FRED ${seriesId}: gak ada data valid`);
  return rows;
}

// Balikin { date, value } TERBARU + SEBELUMNYA (buat hitung perubahan) dari 1 seri FRED.
async function fetchFredSeries(seriesId) {
  const rows = await fetchFredSeriesRows(seriesId);
  const latest = rows[rows.length - 1];
  const prev = rows.length >= 2 ? rows[rows.length - 2] : null;
  return { latest, prev, changePct: prev ? ((latest.value - prev.value) / prev.value) * 100 : null };
}

// DX-Y.NYB = ICE US Dollar Index (DXY beneran, dari Yahoo Finance -- GRATIS, gak perlu API key,
// sumber yang sama dipakai dxyContext.js/dxyZoneMonitor.js). Return shape DISAMAIN kayak
// fetchFredSeries() ({latest:{date,value}, prev, changePct}) biar semua caller lama (goldGroupReport.js,
// convictionScore.js via classifyDxyTrend, web analis-render.js) ZERO perlu berubah.
async function fetchDxy() {
  const res = await fetchWithRetry('https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1d&range=5d', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await res.json();
  const meta = data.chart.result[0].meta;
  if (meta.regularMarketPrice == null || meta.chartPreviousClose == null) throw new Error('DXY: data harga gak lengkap dari Yahoo Finance');
  const latest = { date: new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10), value: meta.regularMarketPrice };
  const prev = { date: null, value: meta.chartPreviousClose };
  return { latest, prev, changePct: ((latest.value - prev.value) / prev.value) * 100 };
}

// DFII10 = 10-Year Treasury Inflation-Indexed Security, harian -- ini "real yield" (yield
// setelah inflasi) yang dipakai analis, BUKAN nominal yield (DGS10) yang gak dikurangi inflasi.
async function fetchRealYield10Y() {
  return fetchFredSeries('DFII10');
}

function classifyDxyTrend(changePct) {
  if (changePct > 0.3) return { arah: 'MENGUAT', efekEmas: 'cenderung TERTEKAN (dolar kuat = Emas lebih mahal buat pembeli non-dolar)' };
  if (changePct < -0.3) return { arah: 'MELEMAH', efekEmas: 'cenderung DIUNTUNGKAN' };
  return { arah: 'STABIL', efekEmas: 'netral' };
}

function classifyRealYieldTrend(changePct) {
  if (changePct > 1) return { arah: 'NAIK', efekEmas: 'cenderung TERTEKAN (biaya peluang pegang Emas naik)' };
  if (changePct < -1) return { arah: 'TURUN', efekEmas: 'cenderung DIUNTUNGKAN' };
  return { arah: 'STABIL', efekEmas: 'netral' };
}

async function safe(fn, label) {
  try {
    return await fn();
  } catch (e) {
    console.log(`[MacroData] ${label} gagal (dilewatin):`, e.message.slice(0, 120));
    return null;
  }
}

async function fetchMacroContext() {
  const [dxy, realYield] = await Promise.all([
    safe(fetchDxy, 'DXY'),
    safe(fetchRealYield10Y, 'Real Yield 10Y'),
  ]);
  return {
    dxy: dxy ? { ...dxy, trend: classifyDxyTrend(dxy.changePct) } : null,
    realYield: realYield ? { ...realYield, trend: classifyRealYieldTrend(realYield.changePct) } : null,
  };
}

module.exports = {
  fetchFredSeriesRows, fetchFredSeries, fetchDxy, fetchRealYield10Y, classifyDxyTrend, classifyRealYieldTrend, fetchMacroContext,
};

if (require.main === module) {
  fetchMacroContext().then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => {
    console.error('ERROR macroData.js:', e.message);
    process.exit(1);
  });
}
