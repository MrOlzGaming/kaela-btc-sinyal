// Pengumuman SEKALI PAKAI (22 Agu 2026) -- Sniper XAU/Emas aktif.
const { sendWhatsApp } = require('./fonnte');
const MSG = `🟡 🎯 KAELA — UPDATE

Analisa otomatis Sniper (Pola Chart + FVG) buat **XAU/Emas** sekarang AKTIF.

🔗 https://kaela-btc-sinyal.netlify.app/metodologi-sniper.html`;
sendWhatsApp(MSG).then(() => console.log('[SendGoldAnnouncement] Terkirim.')).catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
