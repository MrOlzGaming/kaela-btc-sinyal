// Pengumuman SEKALI PAKAI (22 Agu 2026) -- fitur Kaela Analyst Terminal + lapisan analis institusional aktif.
const { sendWhatsApp } = require('./fonnte');

const PARTS = [
`🔍 *KAELA — UPDATE BESAR*

Kaela sekarang punya lapisan analisa setingkat institusional, semua otomatis & gratis:

🎯 *Conviction Score* -- gabungin semua sinyal (teknikal, on-chain, makro, posisi institusional) jadi 1 verdict jelas per aset, LENGKAP alasannya. Update tiap Senin.

📈 *Track Record* -- tiap verdict dinilai balik 7 hari kemudian, biar kredibilitasnya terukur bukan klaim doang.

📊 *8 indikator makro baru*: DXY, Real Yield, Yield Curve, M2, Fed Funds Rate, Credit Spread, DVOL (volatilitas BTC), COT Report (posisi smart money Emas).

🔗 *Regime Tracker* -- korelasi BTC-Nasdaq & Emas-DXY, biar tau lagi "rezim" apa sekarang.

⚡ *Squeeze Detector* -- deteksi otomatis setup long/short squeeze.

📰 *Kaela News 3x sehari* (pagi/siang/sore) -- plus liputan bencana & konflik geopolitik.`,

`Semua bisa dipantau kapan aja di halaman baru:

🔗 https://kaela-btc-sinyal.netlify.app/analis.html

Verdict pertama muncul Senin. Ini murni analisa tambahan -- TIDAK pengaruhi sinyal Sniper atau keputusan Musim Tanam/Panen.`,
];

(async () => {
  for (let i = 0; i < PARTS.length; i++) {
    const res = await sendWhatsApp(PARTS[i]);
    console.log(`[SendAnalystTerminalAnnouncement] Part ${i + 1}/${PARTS.length}:`, JSON.stringify(res));
    if (i < PARTS.length - 1) await new Promise((r) => setTimeout(r, 2000));
  }
  console.log('[SendAnalystTerminalAnnouncement] Selesai.');
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
