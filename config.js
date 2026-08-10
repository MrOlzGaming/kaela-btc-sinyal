// Konfigurasi bersama dipakai lintas modul — satu titik ubah kalau ada yang berubah.
const WEB_URL = 'https://kaela-btc-sinyal.netlify.app'; // LIVE sejak 2026-08-07

// Zona waktu SISTEM: WITA (UTC+8) -- Olan pakai WITA, bukan WIB. Semua jadwal/tampilan tanggal
// pakai ini. Server (GitHub Actions) jalan di UTC, jadi tiap "hari ini"/"jam berapa" WAJIB
// dihitung lewat helper ini, JANGAN pernah baca now.getUTCDate()/toISOString() langsung buat
// keperluan tampilan/trigger kalender -- itu bakal salah 8 jam dari yang Olan liat di HP-nya.
const TIMEZONE_OFFSET_HOURS = 8; // WITA

// Geser Date ke waktu lokal WITA -- HANYA buat baca komponen kalender (getUTCDate/Day/Month/dst),
// BUKAN buat dikirim balik sebagai timestamp asli (udah nggak akurat kalau dipakai gitu).
function toLocal(date) {
  return new Date(date.getTime() + TIMEZONE_OFFSET_HOURS * 3600 * 1000);
}

// String "YYYY-MM-DD" sesuai tanggal WITA pada momen `date` -- dipakai buat label tanggal
// di pesan DAN buat kunci dedup harian (archive.js addOrReplaceDaily, heartbeat Nyopet, dst).
function localDateKey(date) {
  return toLocal(date).toISOString().slice(0, 10);
}

// Mute WA sementara (10 Agu 2026, instruksi Olan): strategi baru flag+wedge AKTIF sekarang
// (sinyal tetap kedeteksi, order tetap dicatat + tampil di web/archive), TAPI broadcast WA
// ditahan sampai Jumat (2026-08-14) -- nunggu pengumuman resmi biar grup gak bingung liat
// perubahan mendadak tanpa penjelasan. Setelah tanggal ini, WA jalan normal lagi otomatis.
const WA_MUTE_UNTIL_DATE = '2026-08-14';
function isWaMuted() {
  return localDateKey(new Date()) < WA_MUTE_UNTIL_DATE;
}

module.exports = { WEB_URL, TIMEZONE_OFFSET_HOURS, toLocal, localDateKey, WA_MUTE_UNTIL_DATE, isWaMuted };
