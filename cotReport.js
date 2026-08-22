// COT Report (Commitment of Traders) buat Emas -- posisi "Managed Money" (hedge fund/spekulan
// besar beneran, BUKAN ritel) di kontrak futures Gold COMEX. Sumber: CFTC (regulator resmi AS),
// GRATIS, TANPA API key, publish TIAP JUMAT (data per Selasa minggu itu). Ini data yang BENERAN
// dipakai analis institusional buat baca "smart money lagi posisi kemana" -- beda dari sentimen
// ritel (Fear&Greed) atau funding rate kripto yang udah kita punya, ini spesifik POSISI Emas.
// 22 Agu 2026 -- bagian dari "Kaela analis tier Bloomberg" (lihat memori project-kaela-analyst-tier).

const { fetchWithRetry } = require('./httpRetry');

const CFTC_BASE = 'https://publicreporting.cftc.gov/resource/6dca-aqww.json';
// Kontrak GOLD utama di COMEX (New York) -- ada beberapa kontrak "GOLD" lain (mini, dsb) dengan
// open interest jauh lebih kecil, ini yang paling likuid/representatif buat baca posisi pasar.
const GOLD_MARKET_NAME = 'GOLD - COMMODITY EXCHANGE INC.';

// Ambil 2 laporan MINGGUAN terakhir (buat hitung perubahan minggu-ke-minggu).
async function fetchGoldCotHistory(limit = 2) {
  const url = `${CFTC_BASE}?market_and_exchange_names=${encodeURIComponent(GOLD_MARKET_NAME)}&$order=report_date_as_yyyy_mm_dd DESC&$limit=${limit}`;
  const res = await fetchWithRetry(url);
  const rows = await res.json();
  if (!rows.length) throw new Error('CFTC COT: gak ada data Gold ditemukan');
  return rows.map((r) => ({
    date: r.report_date_as_yyyy_mm_dd.slice(0, 10),
    managedMoneyLong: +r.noncomm_positions_long_all,
    managedMoneyShort: +r.noncomm_positions_short_all,
    openInterest: +r.open_interest_all,
  }));
}

// Net positioning "Managed Money" -- positif = net LONG (bullish consensus smart money),
// negatif = net SHORT. Persentase dari total open interest biar bisa dibandingin lintas waktu
// (angka absolut gak berarti apa-apa tanpa konteks ukuran pasar).
function classifyNetPositioning(long, short, openInterest) {
  const net = long - short;
  const netPctOi = (net / openInterest) * 100;
  let label;
  if (netPctOi > 40) label = 'SANGAT net-long -- smart money kompak bullish, tapi historis makin ramai 1 arah makin rawan koreksi (crowded trade)';
  else if (netPctOi > 15) label = 'Net-long moderat -- smart money condong bullish';
  else if (netPctOi > -15) label = 'Cenderung seimbang';
  else if (netPctOi > -40) label = 'Net-short moderat -- smart money condong bearish';
  else label = 'SANGAT net-short -- smart money kompak bearish, rawan koreksi kalau salah arah (crowded trade)';
  return { net, netPctOi, label };
}

async function fetchGoldCotContext() {
  const history = await fetchGoldCotHistory(2);
  const [latest, prev] = history;
  const current = classifyNetPositioning(latest.managedMoneyLong, latest.managedMoneyShort, latest.openInterest);
  const weekChange = prev
    ? current.net - (prev.managedMoneyLong - prev.managedMoneyShort)
    : null;
  return { date: latest.date, ...current, weekChangeContracts: weekChange };
}

module.exports = { fetchGoldCotHistory, classifyNetPositioning, fetchGoldCotContext };

if (require.main === module) {
  fetchGoldCotContext().then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => {
    console.error('ERROR cotReport.js:', e.message);
    process.exit(1);
  });
}
