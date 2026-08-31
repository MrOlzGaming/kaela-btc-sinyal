// Trigger berita pagi/siang/sore dari siklus eksekutor lokal/VPS (tiap 15 menit) sebagai CADANGAN
// kalau jadwal cron GitHub Actions (news-pagi/siang/sore.yml) kelewat/telat -- ketauan 31 Agu 2026
// (Olan lapor: "kadang berita siang dikirim sore dan berita sore dikirim dinihari"). Diagnosis:
// akun ini punya BANYAK workflow terjadwal (price-alert tiap 5 menit dkk), kadang bikin jadwal
// low-frequency kayak berita telat berjam-jam atau skip total -- bukan bug cron/timezone kita.
//
// newsMonitor.js SENDIRI udah dedup per slot per hari (hasEntryToday, baca archive.json) -- jadi
// AMAN dipanggil berkali-kali tiap siklus, no-op murah kalau slot itu udah kekirim (baik oleh GH
// Actions ATAU siklus sebelumnya). Gak ada penjadwalan baru yang perlu dijaga di sini -- cukup:
// "kalau jam WITA sekarang udah lewat jam target slot ini, coba kirim (atau no-op kalau udah)".
const { execFileSync } = require('child_process');
const { toLocal } = require('./config');

// Samain persis sama cron di .github/workflows/news-<slot>.yml.
const SLOTS = [
  { name: 'pagi', hour: 9, minute: 7 },
  { name: 'siang', hour: 13, minute: 13 },
  { name: 'sore', hour: 18, minute: 19 },
];

function main() {
  const local = toLocal(new Date());
  const nowMinutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  for (const slot of SLOTS) {
    const targetMinutes = slot.hour * 60 + slot.minute;
    if (nowMinutes < targetMinutes) continue;
    try {
      const out = execFileSync('node', ['newsMonitor.js', slot.name], { encoding: 'utf8' });
      if (out.trim()) console.log(out.trim());
    } catch (e) {
      console.error(`ERROR runDueNews.js slot ${slot.name}:`, e.message);
    }
  }
}

main();
