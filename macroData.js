// Data makro AS -- DXY (indeks dolar) + real yield 10 tahun -- dari FRED (Federal Reserve
// Economic Data), sumber RESMI pemerintah AS, GRATIS, TANPA API key (pakai endpoint publik
// fredgraph.csv, bukan REST API resmi yang butuh registrasi key -- data SAMA, cuma beda cara akses).
// 22 Agu 2026 -- awal dari ide "Kaela analis tier Bloomberg" (lihat memori project-kaela-analyst-tier).
//
// Kenapa ini penting buat Emas: harga Emas historisnya BERLAWANAN arah sama real yield (yield
// riil naik = biaya peluang pegang emas -yang gak ada bunganya- naik = Emas cenderung tertekan)
// dan BERLAWANAN arah sama DXY (dolar kuat = Emas dalam dolar jadi lebih mahal buat pembeli
// non-dolar = permintaan turun). Ini BUKAN korelasi sempurna/pasti, tapi hubungan makro paling
// mendasar yang dipakai analis institusional buat baca Emas -- jauh lebih relevan dari chart
// pattern doang.

const { fetchWithRetry } = require('./httpRetry');

const FRED_CSV_BASE = 'https://fred.stlouisfed.org/graph/fredgraph.csv';

// Balikin { date, value } TERBARU + SEBELUMNYA (buat hitung perubahan) dari 1 seri FRED.
// CSV formatnya: header lalu baris "YYYY-MM-DD,value" -- kadang value "." (hari libur/blm rilis),
// difilter biar cuma ambil baris valid.
async function fetchFredSeries(seriesId) {
  const res = await fetchWithRetry(`${FRED_CSV_BASE}?id=${seriesId}`);
  const text = await res.text();
  const rows = text.trim().split('\n').slice(1) // buang header
    .map((line) => {
      const [date, raw] = line.split(',');
      return { date, value: parseFloat(raw) };
    })
    .filter((r) => !isNaN(r.value));
  if (rows.length === 0) throw new Error(`FRED ${seriesId}: gak ada data valid`);
  const latest = rows[rows.length - 1];
  const prev = rows.length >= 2 ? rows[rows.length - 2] : null;
  return { latest, prev, changePct: prev ? ((latest.value - prev.value) / prev.value) * 100 : null };
}

// DTWEXBGS = Nominal Broad U.S. Dollar Index (seri resmi The Fed, harian)
async function fetchDxy() {
  return fetchFredSeries('DTWEXBGS');
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
  fetchFredSeries, fetchDxy, fetchRealYield10Y, classifyDxyTrend, classifyRealYieldTrend, fetchMacroContext,
};

if (require.main === module) {
  fetchMacroContext().then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => {
    console.error('ERROR macroData.js:', e.message);
    process.exit(1);
  });
}
