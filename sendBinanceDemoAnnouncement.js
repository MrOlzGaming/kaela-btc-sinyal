// Pengumuman SEKALI PAKAI (22 Agu 2026) -- Kaela Sniper migrasi ke eksekusi Binance Demo.
const { sendWhatsApp } = require('./fonnte');
const MSG = `🔍 *KAELA — UPDATE*

Kaela lagi riset pakai akun *Binance Demo* (duit virtual, zero risiko) -- sinyal Sniper VALID sekarang dieksekusi otomatis di sana, lengkap SL+TP nempel di exchange. Bukan cuma monitor bayangan lagi.

Ini fase uji coba beberapa minggu ke depan -- cari & benerin bug sebelum nanti ke akun asli. Tetap pakai kalkulator exposure yang sama.

🔗 https://kaela-btc-sinyal.netlify.app/metodologi-sniper.html`;
sendWhatsApp(MSG).then(() => console.log('[SendBinanceDemoAnnouncement] Terkirim.')).catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
