// Tool sekali-pakai -- kirim pengumuman manual ke Wibowo Hedgefund (draft disetujui Olan di chat,
// 14 Sep 2026) soal izin short BTC window-bear auto-eksekusi real + rute demo gak lagi ke sini.
const { sendWhatsAppToWibowo } = require('./wibowoNotify');

const msg = `🎯 SNIPER · Kaela — 📢 UPDATE STRATEGI

Mulai sekarang, khusus BTCUSDT pas window istirahat siklus halving, kalau Kaela buka posisi SHORT -- itu POSISI BENERAN yang dibuka Kaela sendiri (bukan sinyal buat dipertimbangkan lagi), atas izin eksplisit Olan.

⚠️ Emas TETAP jalur sinyal manual seperti biasa (short Emas historisnya lebih jelek di backtest) -- Olan pegang sendiri kalau mau ikut.

💰 Modal real Sniper BELUM diisi -- rencana bulan depan. Sampai saat itu, aktivitas Sniper (buka/tutup posisi apapun) masih 100% mode demo, jadi laporannya SEMENTARA gak dikirim ke grup ini dulu (biar grup ini fokus aktivitas REAL doang). Begitu modal real masuk, laporannya otomatis lanjut kesini lagi.

🔗 https://kaela-btc-sinyal.netlify.app`;

sendWhatsAppToWibowo(msg).then((res) => {
  console.log('Hasil kirim:', JSON.stringify(res));
}).catch((e) => {
  console.error('GAGAL kirim:', e.message);
  process.exit(1);
});
