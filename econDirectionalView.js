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
    beginnerWhy: '"CPI"/"PPI"/"PCE" itu 3 cara ngukur BEDA yang sama-sama ngitung seberapa CEPAT harga barang-barang naik di Amerika (inflasi) -- CPI dari sisi konsumen, PPI dari sisi produsen, PCE yang dipantau langsung sama The Fed. Kenapa BTC peduli? Kalau inflasi kepanasan, bank sentral Amerika (The Fed) biasanya NAIKIN/nahan suku bunga tinggi buat ngeremnya -- itu bikin nyimpen duit di bank/obligasi jadi lebih menarik drpd taruh di aset berisiko kayak BTC.',
    aboveForecast: 'tertekan', belowForecast: 'menguat',
  },
  {
    match: ['Non-Farm Employment Change', 'ADP', 'JOLTS'],
    label: 'Data lapangan kerja', strength: 'sedang',
    mechanism: 'Lapangan kerja lebih BANYAK dari perkiraan -> ekonomi kuat -> The Fed punya alasan tetap hawkish -> BTC biasanya tertekan. Lebih SEDIKIT dari perkiraan -> ekonomi melemah -> ekspektasi dovish -> BTC biasanya diuntungkan.',
    beginnerWhy: '"NFP" (Non-Farm Payrolls) itu istilah resmi laporan bulanan ini -- ngitung berapa banyak lapangan kerja baru tercipta di Amerika bulan ini (di luar sektor pertanian). Kenapa BTC peduli? Ekonomi yang KUAT (banyak lapangan kerja baru) bikin The Fed lebih santai naikin/nahan suku bunga tinggi (gak buru-buru "nolong" ekonomi pakai suku bunga rendah) -- itu kurang menguntungkan buat aset berisiko kayak BTC.',
    aboveForecast: 'tertekan', belowForecast: 'menguat',
  },
  {
    match: ['Unemployment Rate'],
    label: 'Tingkat pengangguran', strength: 'sedang',
    mechanism: 'Angka lebih TINGGI dari perkiraan -> ekonomi melemah -> ekspektasi dovish -> BTC biasanya diuntungkan. Lebih RENDAH -> ekonomi kuat -> hawkish -> BTC biasanya tertekan (arah KEBALIKAN dari data lapangan kerja lain, krn angka ini "makin tinggi = makin buruk").',
    beginnerWhy: 'Ini ngukur persentase orang Amerika yang lagi nyari kerja tapi belum dapet. Logikanya KEBALIKAN dari data lapangan kerja di atas -- pengangguran NAIK berarti ekonomi melemah, itu bikin The Fed lebih mungkin nurunin suku bunga buat "nolong", yang biasanya BAGUS buat aset berisiko kayak BTC.',
    aboveForecast: 'menguat', belowForecast: 'tertekan',
  },
  {
    match: ['Initial Jobless Claims'],
    label: 'Klaim pengangguran mingguan', strength: 'lemah',
    mechanism: 'Logika sama kayak Tingkat Pengangguran (klaim lebih banyak = dovish = BTC diuntungkan, lebih sedikit = hawkish = BTC tertekan), tapi data mingguan/noisy -- pengaruh biasanya lemah kecuali angkanya ekstrem jauh dari perkiraan.',
    beginnerWhy: 'Ini ngitung berapa orang Amerika baru daftar klaim tunjangan pengangguran MINGGU ini. Logikanya SAMA kayak Tingkat Pengangguran (naik = ekonomi melemah = BTC berpotensi diuntungkan) -- cuma data mingguan lebih "berisik"/naik-turun, jadi pengaruhnya biasanya lebih lemah kecuali angkanya ekstrem banget beda dari perkiraan.',
    aboveForecast: 'menguat', belowForecast: 'tertekan',
  },
  {
    match: ['Federal Funds Rate'],
    label: 'Keputusan suku bunga The Fed', strength: 'kuat',
    mechanism: 'Keputusan lebih HAWKISH dari ekspektasi pasar (suku bunga naik/ditahan tinggi di luar dugaan) -> BTC biasanya tertekan. Lebih DOVISH dari ekspektasi (turun/sinyal turun) -> BTC biasanya diuntungkan. Event paling berpengaruh dari semua kalender ekonomi.',
    beginnerWhy: 'Ini keputusan RESMI bank sentral Amerika (The Fed) soal "harga sewa uang" (suku bunga) buat seluruh negara. Ini event PALING BERPENGARUH di semua kalender ekonomi -- suku bunga tinggi bikin duit "mahal" (orang lebih milih nyimpen aman drpd ambil risiko di BTC), suku bunga rendah sebaliknya bikin orang lebih berani ambil risiko.',
    aboveForecast: 'tertekan', belowForecast: 'menguat',
  },
  {
    match: ['FOMC Statement', 'FOMC Press Conference', 'FOMC Economic Projections', 'FOMC Meeting Minutes'],
    label: 'Pernyataan/Notulen FOMC', strength: 'kualitatif',
    mechanism: 'Gak ada angka forecast/actual buat dibandingkan -- arahnya ditentukan NADA pernyataan (hawkish vs dovish), bukan angka. Nada lebih hawkish dari ekspektasi pasar -> BTC biasanya tertekan, lebih dovish -> BTC biasanya diuntungkan.',
    beginnerWhy: 'Ini pernyataan RESMI The Fed abis rapat mereka soal arah suku bunga ke depan. Gak ada angka yang bisa dibandingin kayak indikator lain -- tapi NADA-nya (galak/"hawkish" vs lunak/"dovish") dibaca pasar buat nebak apa suku bunga bakal naik/turun ke depannya.',
    aboveForecast: null, belowForecast: null,
  },
  {
    match: ['Retail Sales'],
    label: 'Penjualan ritel', strength: 'sedang',
    mechanism: 'Belanja masyarakat lebih TINGGI dari perkiraan -> ekonomi/inflasi cenderung panas -> hawkish-leaning -> BTC cenderung tertekan. Lebih RENDAH -> sebaliknya, BTC cenderung diuntungkan.',
    beginnerWhy: 'Ini ngukur seberapa banyak orang Amerika belanja bulan ini. Belanja TINGGI = ekonomi lagi kuat -- logikanya mirip data lapangan kerja (ekonomi kuat = The Fed tetep santai jaga suku bunga tinggi = kurang menguntungkan buat BTC).',
    aboveForecast: 'tertekan', belowForecast: 'menguat',
  },
  {
    match: ['ISM Manufacturing PMI', 'ISM Services PMI', 'ISM Non-Manufacturing PMI'],
    label: 'PMI (Manufaktur/Jasa)', strength: 'sedang',
    mechanism: 'Angka di atas perkiraan (apalagi di atas 50 = ekspansi) -> ekonomi kuat -> hawkish-leaning -> BTC cenderung tertekan. Di bawah perkiraan -> BTC cenderung diuntungkan.',
    beginnerWhy: '"PMI" (Purchasing Managers\' Index) itu survei ke manajer pabrik/perusahaan jasa, nanya "bisnis lagi bagus apa nggak". Angka di atas 50 = lagi berkembang (ekonomi kuat), di bawah 50 = lagi menyusut (ekonomi melemah) -- logika pengaruhnya ke BTC mirip data lapangan kerja/ritel.',
    aboveForecast: 'tertekan', belowForecast: 'menguat',
  },
  {
    match: ['CB Consumer Confidence', 'Consumer Sentiment'],
    label: 'Kepercayaan/sentimen konsumen', strength: 'lemah',
    mechanism: 'Mirip data ritel tapi pengaruh ke BTC historisnya lebih lemah/gak konsisten. Kecenderungan: lebih tinggi dari perkiraan = hawkish-leaning (BTC cenderung tertekan), lebih rendah = sebaliknya.',
    beginnerWhy: 'Ini survei nanya orang biasa Amerika "perasaan lo soal ekonomi gimana". Mirip data penjualan ritel tapi lebih ke "perasaan" drpd angka belanja beneran -- pengaruhnya ke BTC lebih lemah/gak sekonsisten indikator lain.',
    aboveForecast: 'tertekan', belowForecast: 'menguat',
  },
  {
    match: ['GDP'],
    label: 'Pertumbuhan PDB', strength: 'campuran',
    mechanism: 'Efeknya ke BTC CAMPURAN/gak konsisten historisnya -- PDB kuat bisa dibaca hawkish (ekonomi kuat -> Fed tetap tinggi) TAPI juga bisa dibaca positif buat selera risiko secara umum. Sengaja gak dipaksa 1 arah.',
    beginnerWhy: '"GDP" (Gross Domestic Product/PDB) ngukur total nilai SEMUA barang+jasa yang diproduksi ekonomi Amerika (ukuran "kesehatan ekonomi" paling besar). Angka gede = ekonomi tumbuh cepat -- TAPI efeknya ke BTC CAMPUR-CAMPUR: bisa dibaca "ekonomi kuat = The Fed tetep galak" (kurang bagus buat BTC), bisa juga dibaca "orang lagi pede, berani ambil risiko" (bagus buat BTC). Sengaja gak dipaksa 1 arah.',
    aboveForecast: 'campuran', belowForecast: 'campuran',
  },
  {
    match: ['Building Permits', 'Housing Starts', 'Existing Home Sales', 'New Home Sales', 'Trade Balance', 'Durable Goods Orders', 'Crude Oil Inventories'],
    label: 'Data sektoral lain', strength: 'sangat lemah',
    mechanism: 'Pengaruh historis ke pergerakan BTC lemah/gak langsung dibanding data di atas -- biasanya cuma noise kecuali angkanya ekstrem jauh dari perkiraan.',
    beginnerWhy: 'Ini data spesifik 1 sektor ekonomi (properti/perdagangan/energi dst). Pengaruh langsungnya ke BTC biasanya kecil/gak konsisten -- cuma penting kalau angkanya ekstrem banget beda dari perkiraan.',
    aboveForecast: 'campuran', belowForecast: 'campuran',
  },
];

// Cari kategori berdasarkan judul ASLI (bahasa Inggris, sebelum diterjemahkan) -- return null
// kalau gak ada mapping yang cocok (SENGAJA gak maksa nebak buat event yang gak dikenal).
function getDirectionalView(rawTitle) {
  return CATEGORIES.find((cat) => cat.match.some((m) => rawTitle.includes(m))) || null;
}

module.exports = { getDirectionalView };
