// Pengumuman SEKALI PAKAI (22 Agu 2026) -- fitur deteksi otomatis long/short squeeze aktif.
const { sendWhatsApp } = require('./fonnte');
const MSG = `🔍 *KAELA — UPDATE*

Kaela sekarang bisa deteksi otomatis setup *long/short squeeze* BTC (funding rate + open interest numpuk), dicek tiap 4 jam. Contohnya analisa squeeze yang barusan Kaela kirim di atas ⬆️ -- nanti kalau kondisi serupa kedeteksi lagi, Kaela auto-infoin ke grup.

🔗 https://kaela-btc-sinyal.netlify.app/metodologi-sniper.html`;
sendWhatsApp(MSG).then(() => console.log('[SendSqueezeFeatureAnnouncement] Terkirim.')).catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
