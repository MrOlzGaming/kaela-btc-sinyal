// Pengumuman SEKALI PAKAI (22 Agu 2026) -- upgrade Sniper multi-aset (BTC+XAU) x multi-mode (Pola
// Chart+FVG). Dijalankan manual via workflow_dispatch, BUKAN bagian dari cron rutin manapun.

const { sendWhatsApp } = require('./fonnte');

const MSG = `🟧 🎯 KAELA SNIPER — UPGRADE SISTEM

Halo semua! Sniper baru aja di-upgrade:

🔹 Sekarang analisa 2 aset sekaligus: BTC dan XAU/Emas
🔹 2 mode deteksi: Pola Chart (flag/wedge kayak biasa) + Fair Value Gap (FVG)
🔹 Bisa punya beberapa posisi bayangan floating bareng, saldo dibagi otomatis ke yang masih available
🔹 BTC punya jeda otomatis pas fase pasca-puncak siklus halving (historis rawan turun tajam) -- Emas tetap jalan terus di periode itu

Detail lengkap + histori performa bisa dicek sendiri di web ya
🔗 https://kaela-btc-sinyal.netlify.app

Eksekusi tetap 100% manual di tangan masing-masing, ini murni alat bantu analisa. Semoga makin membantu! 🙏`;

sendWhatsApp(MSG).then(() => {
  console.log('[SendUpgradeAnnouncement] Terkirim.');
}).catch((e) => {
  console.error('ERROR sendUpgradeAnnouncement.js:', e.message);
  process.exit(1);
});
