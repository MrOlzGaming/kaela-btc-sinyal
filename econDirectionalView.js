// Peta arah SEBAB-AKIBAT standar makro -> BTC (permintaan Olan: "berani memperkirakan arah,
// jelasin kalau begini maka begitu"). INI HEURISTIK MAKRO UMUM (channel ekspektasi The Fed
// hawkish/dovish -> dolar/yield -> selera risiko), BUKAN backtest data historis -- beda level
// keyakinan dari sinyal Sniper/Musiman yang semua diuji lewat data. Disclaimer ini WAJIB tetap
// ditampilkan di pesan (lihat econCalendarLog.js), jangan disamakan levelnya sama sinyal utama.
//
// `strength` jujur soal seberapa reliable hubungan tiap event ke BTC secara historis -- 'kuat'
// (CPI, keputusan suku bunga) sampai 'sangat lemah'/'campuran' (data sektoral, GDP) yang
// SENGAJA gak dipaksa 1 arah kalau hubungannya emang gak konsisten.

const CATEGORIES = [
  {
    match: ['CPI', 'PPI', 'PCE Price Index'],
    label: 'Inflasi', strength: 'kuat',
    mechanism: 'Inflasi lebih PANAS dari perkiraan -> The Fed cenderung tahan/naikkan suku bunga (hawkish) -> dolar & yield naik -> aset risiko (termasuk BTC) biasanya tertekan. Lebih DINGIN dari perkiraan -> ekspektasi The Fed lebih dovish -> BTC biasanya diuntungkan.',
    aboveForecast: 'tertekan', belowForecast: 'menguat',
  },
  {
    match: ['Non-Farm Employment Change', 'ADP', 'JOLTS'],
    label: 'Data lapangan kerja', strength: 'sedang',
    mechanism: 'Lapangan kerja lebih BANYAK dari perkiraan -> ekonomi kuat -> The Fed punya alasan tetap hawkish -> BTC biasanya tertekan. Lebih SEDIKIT dari perkiraan -> ekonomi melemah -> ekspektasi dovish -> BTC biasanya diuntungkan.',
    aboveForecast: 'tertekan', belowForecast: 'menguat',
  },
  {
    match: ['Unemployment Rate'],
    label: 'Tingkat pengangguran', strength: 'sedang',
    mechanism: 'Angka lebih TINGGI dari perkiraan -> ekonomi melemah -> ekspektasi dovish -> BTC biasanya diuntungkan. Lebih RENDAH -> ekonomi kuat -> hawkish -> BTC biasanya tertekan (arah KEBALIKAN dari data lapangan kerja lain, krn angka ini "makin tinggi = makin buruk").',
    aboveForecast: 'menguat', belowForecast: 'tertekan',
  },
  {
    match: ['Initial Jobless Claims'],
    label: 'Klaim pengangguran mingguan', strength: 'lemah',
    mechanism: 'Logika sama kayak Tingkat Pengangguran (klaim lebih banyak = dovish = BTC diuntungkan, lebih sedikit = hawkish = BTC tertekan), tapi data mingguan/noisy -- pengaruh biasanya lemah kecuali angkanya ekstrem jauh dari perkiraan.',
    aboveForecast: 'menguat', belowForecast: 'tertekan',
  },
  {
    match: ['Federal Funds Rate'],
    label: 'Keputusan suku bunga The Fed', strength: 'kuat',
    mechanism: 'Keputusan lebih HAWKISH dari ekspektasi pasar (suku bunga naik/ditahan tinggi di luar dugaan) -> BTC biasanya tertekan. Lebih DOVISH dari ekspektasi (turun/sinyal turun) -> BTC biasanya diuntungkan. Event paling berpengaruh dari semua kalender ekonomi.',
    aboveForecast: 'tertekan', belowForecast: 'menguat',
  },
  {
    match: ['FOMC Statement', 'FOMC Press Conference', 'FOMC Economic Projections', 'FOMC Meeting Minutes'],
    label: 'Pernyataan/Notulen FOMC', strength: 'kualitatif',
    mechanism: 'Gak ada angka forecast/actual buat dibandingkan -- arahnya ditentukan NADA pernyataan (hawkish vs dovish), bukan angka. Nada lebih hawkish dari ekspektasi pasar -> BTC biasanya tertekan, lebih dovish -> BTC biasanya diuntungkan.',
    aboveForecast: null, belowForecast: null,
  },
  {
    match: ['Retail Sales'],
    label: 'Penjualan ritel', strength: 'sedang',
    mechanism: 'Belanja masyarakat lebih TINGGI dari perkiraan -> ekonomi/inflasi cenderung panas -> hawkish-leaning -> BTC cenderung tertekan. Lebih RENDAH -> sebaliknya, BTC cenderung diuntungkan.',
    aboveForecast: 'tertekan', belowForecast: 'menguat',
  },
  {
    match: ['ISM Manufacturing PMI', 'ISM Services PMI', 'ISM Non-Manufacturing PMI'],
    label: 'PMI (Manufaktur/Jasa)', strength: 'sedang',
    mechanism: 'Angka di atas perkiraan (apalagi di atas 50 = ekspansi) -> ekonomi kuat -> hawkish-leaning -> BTC cenderung tertekan. Di bawah perkiraan -> BTC cenderung diuntungkan.',
    aboveForecast: 'tertekan', belowForecast: 'menguat',
  },
  {
    match: ['CB Consumer Confidence', 'Consumer Sentiment'],
    label: 'Kepercayaan/sentimen konsumen', strength: 'lemah',
    mechanism: 'Mirip data ritel tapi pengaruh ke BTC historisnya lebih lemah/gak konsisten. Kecenderungan: lebih tinggi dari perkiraan = hawkish-leaning (BTC cenderung tertekan), lebih rendah = sebaliknya.',
    aboveForecast: 'tertekan', belowForecast: 'menguat',
  },
  {
    match: ['GDP'],
    label: 'Pertumbuhan PDB', strength: 'campuran',
    mechanism: 'Efeknya ke BTC CAMPURAN/gak konsisten historisnya -- PDB kuat bisa dibaca hawkish (ekonomi kuat -> Fed tetap tinggi) TAPI juga bisa dibaca positif buat selera risiko secara umum. Sengaja gak dipaksa 1 arah.',
    aboveForecast: 'campuran', belowForecast: 'campuran',
  },
  {
    match: ['Building Permits', 'Housing Starts', 'Existing Home Sales', 'New Home Sales', 'Trade Balance', 'Durable Goods Orders', 'Crude Oil Inventories'],
    label: 'Data sektoral lain', strength: 'sangat lemah',
    mechanism: 'Pengaruh historis ke pergerakan BTC lemah/gak langsung dibanding data di atas -- biasanya cuma noise kecuali angkanya ekstrem jauh dari perkiraan.',
    aboveForecast: 'campuran', belowForecast: 'campuran',
  },
];

// Cari kategori berdasarkan judul ASLI (bahasa Inggris, sebelum diterjemahkan) -- return null
// kalau gak ada mapping yang cocok (SENGAJA gak maksa nebak buat event yang gak dikenal).
function getDirectionalView(rawTitle) {
  return CATEGORIES.find((cat) => cat.match.some((m) => rawTitle.includes(m))) || null;
}

module.exports = { getDirectionalView };
