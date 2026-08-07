// Terjemahan istilah ekonomi ForexFactory -- kamus manual (bukan LLM/API translate, deterministik
// sesuai filosofi Kaela). Cakup event USD High-impact yang paling sering muncul.
// Kalau judul gak ketemu di kamus, tetap tampil bahasa Inggris asli (lebih baik daripada salah terjemahan).

const DICTIONARY = {
  'Non-Farm Employment Change': 'Perubahan Lapangan Kerja Non-Pertanian (NFP)',
  'ADP Non-Farm Employment Change': 'Perubahan Lapangan Kerja ADP',
  'Unemployment Rate': 'Tingkat Pengangguran',
  'Average Hourly Earnings m/m': 'Pertumbuhan Upah per Jam (Bulanan)',
  'Initial Jobless Claims': 'Klaim Pengangguran Mingguan',
  'JOLTS Job Openings': 'Lowongan Kerja JOLTS',
  'ISM Manufacturing PMI': 'PMI Manufaktur ISM',
  'ISM Services PMI': 'PMI Jasa ISM',
  'ISM Non-Manufacturing PMI': 'PMI Jasa ISM',
  'CPI m/m': 'Inflasi (CPI) Bulanan',
  'CPI y/y': 'Inflasi (CPI) Tahunan',
  'Core CPI m/m': 'Inflasi Inti Bulanan',
  'Core CPI y/y': 'Inflasi Inti Tahunan',
  'PPI m/m': 'Inflasi Produsen (PPI) Bulanan',
  'Core PPI m/m': 'Inflasi Produsen Inti Bulanan',
  'Federal Funds Rate': 'Suku Bunga The Fed',
  'FOMC Statement': 'Pernyataan FOMC',
  'FOMC Press Conference': 'Konferensi Pers FOMC',
  'FOMC Economic Projections': 'Proyeksi Ekonomi FOMC',
  'FOMC Meeting Minutes': 'Notulen Rapat FOMC',
  'GDP q/q': 'Pertumbuhan PDB (Kuartalan)',
  'Advance GDP q/q': 'Pertumbuhan PDB Awal (Kuartalan)',
  'Prelim GDP q/q': 'Pertumbuhan PDB Sementara (Kuartalan)',
  'Final GDP q/q': 'Pertumbuhan PDB Final (Kuartalan)',
  'Retail Sales m/m': 'Penjualan Ritel Bulanan',
  'Core Retail Sales m/m': 'Penjualan Ritel Inti Bulanan',
  'Trade Balance': 'Neraca Perdagangan',
  'Building Permits': 'Izin Pembangunan',
  'Housing Starts': 'Konstruksi Rumah Baru',
  'Existing Home Sales': 'Penjualan Rumah Bekas',
  'New Home Sales': 'Penjualan Rumah Baru',
  'CB Consumer Confidence': 'Kepercayaan Konsumen (CB)',
  'Prelim UoM Consumer Sentiment': 'Sentimen Konsumen UoM (Awal)',
  'Core PCE Price Index m/m': 'Indeks Harga PCE Inti Bulanan',
  'PCE Price Index m/m': 'Indeks Harga PCE Bulanan',
  'Durable Goods Orders m/m': 'Pesanan Barang Tahan Lama Bulanan',
  'Crude Oil Inventories': 'Persediaan Minyak Mentah',
};

function translateEventTitle(title) {
  return DICTIONARY[title] || title;
}

module.exports = { translateEventTitle };
