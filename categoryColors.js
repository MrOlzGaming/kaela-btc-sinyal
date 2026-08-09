// Warna 5 kategori sinyal Kaela -- 1 warna TETAP per kategori, dipakai KONSISTEN di web (border+emoji)
// DAN WhatsApp (emoji kotak warna -- satu-satunya cara "warna" di pesan teks polos WA).
// Tujuan: orang bisa scan cepat cari kategori tertentu tanpa baca teks lengkap tiap pesan
// (misal cuma mau Nyopet Market, langsung cari kotak 🟧 pas scroll).
//
// Sengaja BUKAN pakai 🟥/🟩 (merah/hijau) -- itu udah dipakai buat arti lain (sentimen berita,
// arah exchange whale, untung/rugi) di dalam ISI pesan. Kalau dipakai juga buat kategori,
// jadi membingungkan (dua makna beda warna sama).

const CATEGORY_COLOR = {
  news: { emoji: '🟦', hex: '#3b82f6', label: 'Berita' },
  laporan: { emoji: '🟪', hex: '#a855f7', label: 'Laporan' },
  nyopet: { emoji: '🟧', hex: '#f7931a', label: 'Nyopet Market' },
  whale: { emoji: '🟨', hex: '#eab308', label: 'Whale Alert' },
  econ: { emoji: '⬜', hex: '#8b949e', label: 'Jadwal Ekonomi' },
  priceAlert: { emoji: '🟫', hex: '#a16207', label: 'Pergerakan Harga' },
};

// type archive.json -> kategori (dipakai buildDashboard.js buat nentuin warna border kartu)
function categoryOfType(type) {
  if (type === 'news') return 'news';
  if (type.startsWith('report-')) return 'laporan';
  if (type === 'nyopet') return 'nyopet';
  if (type === 'whale') return 'whale';
  if (type === 'econ-calendar') return 'econ';
  if (type === 'price-alert') return 'priceAlert';
  return null;
}

module.exports = { CATEGORY_COLOR, categoryOfType };
