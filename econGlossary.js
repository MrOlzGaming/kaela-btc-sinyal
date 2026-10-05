// Kamus berita ekonomi AS (5 Okt 2026, permintaan Olan: "setiap jenis news kasih nama aslinya, kepanjangan dalam Inggris,
// dan artikan"). Dicocokin ke judul ASLI ForexFactory (bahasa Inggris). Urutan = prioritas (yang lebih spesifik DULUAN,
// mis. "Core CPI" sebelum "CPI"). Gak ketemu -> null (pesan tetap tampil judul asli, gak maksa ngarang arti).
// Deterministik, tanpa LLM -- sama filosofi econTranslate.js / econDirectionalView.js.

const GLOSSARY = [
  // -- The Fed / FOMC --
  { re: /federal funds rate/i, inggris: 'Federal Funds Rate -- keputusan FOMC (Federal Open Market Committee)', arti: 'Keputusan suku bunga acuan AS oleh rapat The Fed' },
  { re: /fomc statement/i, inggris: 'Federal Open Market Committee Statement', arti: 'Pernyataan resmi The Fed setelah rapat suku bunga' },
  { re: /fomc press conference/i, inggris: 'Federal Open Market Committee Press Conference', arti: 'Konferensi pers Ketua The Fed setelah keputusan suku bunga' },
  { re: /fomc economic projections/i, inggris: 'FOMC Summary of Economic Projections', arti: 'Proyeksi ekonomi & arah suku bunga ("dot plot") dari pejabat The Fed' },
  { re: /fomc meeting minutes/i, inggris: 'Federal Open Market Committee Meeting Minutes', arti: 'Notulen rapat The Fed sebelumnya (dirilis ~3 minggu setelah rapat)' },
  { re: /fed chair.*speaks/i, inggris: 'Federal Reserve Chair Speech', arti: 'Pidato Ketua The Fed -- bisa ngasih petunjuk arah suku bunga' },
  { re: /fomc member.*speaks/i, inggris: 'Federal Open Market Committee Member Speech', arti: 'Pidato salah satu pejabat penentu suku bunga The Fed' },
  { re: /beige book/i, inggris: 'Federal Reserve Beige Book', arti: 'Laporan kondisi ekonomi dari 12 wilayah The Fed' },
  // -- inflasi --
  { re: /core cpi/i, inggris: 'Core Consumer Price Index', arti: 'Inflasi harga konsumen TANPA makanan & energi (versi yang paling diawasi The Fed)' },
  { re: /\bcpi\b/i, inggris: 'Consumer Price Index', arti: 'Inflasi: kenaikan harga barang & jasa yang dibeli warga AS' },
  { re: /core ppi/i, inggris: 'Core Producer Price Index', arti: 'Inflasi tingkat produsen TANPA makanan & energi' },
  { re: /\bppi\b/i, inggris: 'Producer Price Index', arti: 'Inflasi di tingkat produsen/pabrik (harga grosir)' },
  { re: /core pce/i, inggris: 'Core Personal Consumption Expenditures Price Index', arti: 'Inflasi belanja konsumen TANPA makanan & energi -- ukuran inflasi FAVORIT The Fed' },
  { re: /pce price/i, inggris: 'Personal Consumption Expenditures Price Index', arti: 'Inflasi dari sisi belanja konsumen (dipakai The Fed buat target 2%)' },
  { re: /inflation expectations/i, inggris: 'University of Michigan Inflation Expectations', arti: 'Perkiraan inflasi setahun ke depan menurut warga AS' },
  { re: /employment cost index/i, inggris: 'Employment Cost Index', arti: 'Kenaikan total biaya tenaga kerja (gaji + tunjangan)' },
  // -- lapangan kerja --
  { re: /adp non-farm/i, inggris: 'ADP (Automatic Data Processing) Non-Farm Employment Change', arti: 'Tambahan lapangan kerja SWASTA versi ADP -- "bocoran" 2 hari sebelum NFP' },
  { re: /non-farm employment change|non-farm payrolls/i, inggris: 'Non-Farm Payrolls (NFP)', arti: 'Jumlah lapangan kerja baru di AS di luar sektor pertanian' },
  { re: /unemployment rate/i, inggris: 'Unemployment Rate', arti: 'Persentase angkatan kerja AS yang menganggur' },
  { re: /average hourly earnings/i, inggris: 'Average Hourly Earnings', arti: 'Kenaikan rata-rata upah per jam pekerja AS' },
  { re: /unemployment claims|jobless claims/i, inggris: 'Initial Jobless Claims', arti: 'Jumlah warga AS yang BARU ngajuin tunjangan pengangguran minggu ini' },
  { re: /jolts/i, inggris: 'Job Openings and Labor Turnover Survey (JOLTS)', arti: 'Jumlah lowongan kerja yang tersedia di AS' },
  { re: /nonfarm productivity/i, inggris: 'Nonfarm Business Productivity', arti: 'Produktivitas pekerja AS (output per jam kerja)' },
  { re: /unit labor costs/i, inggris: 'Unit Labor Costs', arti: 'Biaya tenaga kerja per unit hasil produksi' },
  // -- aktivitas bisnis (PMI & survei pabrik) --
  { re: /ism manufacturing pmi/i, inggris: 'Institute for Supply Management Manufacturing Purchasing Managers\' Index', arti: 'Survei manajer pembelian PABRIK AS: di atas 50 = tumbuh, di bawah 50 = menyusut' },
  { re: /ism (services|non-manufacturing) pmi/i, inggris: 'Institute for Supply Management Services Purchasing Managers\' Index', arti: 'Survei manajer pembelian perusahaan JASA AS: di atas 50 = tumbuh, di bawah 50 = menyusut' },
  { re: /chicago pmi/i, inggris: 'Chicago Purchasing Managers\' Index', arti: 'Survei kondisi bisnis wilayah Chicago: di atas 50 = tumbuh' },
  { re: /manufacturing pmi/i, inggris: 'S&P Global Manufacturing Purchasing Managers\' Index', arti: 'Survei manajer pembelian pabrik AS versi S&P Global' },
  { re: /services pmi/i, inggris: 'S&P Global Services Purchasing Managers\' Index', arti: 'Survei manajer pembelian sektor jasa AS versi S&P Global' },
  { re: /empire state/i, inggris: 'New York Empire State Manufacturing Index', arti: 'Survei kondisi pabrik di negara bagian New York' },
  { re: /philly fed/i, inggris: 'Philadelphia Fed Manufacturing Index', arti: 'Survei kondisi pabrik wilayah Philadelphia' },
  { re: /richmond manufacturing/i, inggris: 'Richmond Fed Manufacturing Index', arti: 'Survei kondisi pabrik wilayah Richmond' },
  { re: /industrial production/i, inggris: 'Industrial Production', arti: 'Total hasil produksi pabrik, tambang & utilitas AS' },
  { re: /factory orders/i, inggris: 'Factory Orders', arti: 'Total pesanan baru ke pabrik-pabrik AS' },
  { re: /durable goods/i, inggris: 'Durable Goods Orders', arti: 'Pesanan barang tahan lama (mesin, kendaraan, peralatan) ke pabrik AS' },
  // -- konsumen --
  { re: /retail sales/i, inggris: 'Retail Sales', arti: 'Total belanja warga AS di toko & online ("Core" = tanpa mobil)' },
  { re: /consumer confidence/i, inggris: 'Conference Board Consumer Confidence Index', arti: 'Survei rasa percaya diri warga AS soal ekonomi' },
  { re: /consumer sentiment/i, inggris: 'University of Michigan Consumer Sentiment', arti: 'Survei suasana hati konsumen AS versi Universitas Michigan' },
  { re: /personal spending/i, inggris: 'Personal Spending', arti: 'Total pengeluaran belanja warga AS' },
  { re: /personal income/i, inggris: 'Personal Income', arti: 'Total pendapatan warga AS' },
  // -- ekonomi makro --
  { re: /\bgdp\b/i, inggris: 'Gross Domestic Product', arti: 'Produk Domestik Bruto: total nilai ekonomi AS (Advance = rilis awal, Prelim = sementara, Final = akhir)' },
  { re: /trade balance/i, inggris: 'Trade Balance', arti: 'Selisih ekspor dikurangi impor AS' },
  { re: /federal budget/i, inggris: 'Federal Budget Balance', arti: 'Surplus/defisit anggaran pemerintah AS' },
  { re: /bond auction/i, inggris: 'U.S. Treasury Bond Auction', arti: 'Lelang obligasi pemerintah AS -- peminat sepi = yield naik = tekanan buat aset berisiko' },
  { re: /treasury currency report/i, inggris: 'Treasury Currency Report', arti: 'Laporan Kemenkeu AS soal negara yang dicurigai main kurs' },
  // -- properti --
  { re: /building permits/i, inggris: 'Building Permits', arti: 'Jumlah izin bangun rumah baru' },
  { re: /housing starts/i, inggris: 'Housing Starts', arti: 'Jumlah rumah baru yang mulai dibangun' },
  { re: /new home sales/i, inggris: 'New Home Sales', arti: 'Penjualan rumah baru' },
  { re: /existing home sales/i, inggris: 'Existing Home Sales', arti: 'Penjualan rumah bekas' },
  { re: /pending home sales/i, inggris: 'Pending Home Sales', arti: 'Kontrak jual-beli rumah yang belum selesai' },
  // -- energi & lain-lain --
  { re: /crude oil inventories/i, inggris: 'EIA Crude Oil Inventories', arti: 'Perubahan stok minyak mentah AS minggu ini' },
  { re: /natural gas storage/i, inggris: 'EIA Natural Gas Storage', arti: 'Perubahan stok gas alam AS minggu ini' },
  { re: /president.*speaks/i, inggris: 'U.S. President Speech', arti: 'Pidato Presiden AS -- bisa gerakin pasar kalau nyinggung tarif/ekonomi' },
];

function lookupGlossary(rawTitle) {
  const g = GLOSSARY.find((x) => x.re.test(String(rawTitle || '')));
  return g ? { inggris: g.inggris, arti: g.arti } : null;
}

module.exports = { lookupGlossary, GLOSSARY };
