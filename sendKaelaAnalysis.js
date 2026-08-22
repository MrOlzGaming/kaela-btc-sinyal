// Pengumuman SEKALI PAKAI (22 Agu 2026) -- analisa Kaela soal short squeeze BTC 19-21 Agustus.
const { sendWhatsApp } = require('./fonnte');

const PARTS = [
`🔍 *KAELA — ANALISA PASAR*

BTC lompat ~20% dalam seminggu, sempat tembus $79rb dari $65rb, sekarang di $78.550. Sebelum ikut euforia, ini yang Kaela lihat di baliknya:

*Bukan demand organik, ini short squeeze.* 19 Agustus, >$1M short kena liquidasi dalam 1 jam, total $2,7-3M dalam 24 jam -- liquidasi terbesar sejak 2021. Trader yang short 6 minggu terakhir kepaksa beli balik rugi, itu yang dorong harga, bukan pembeli baru yang masuk.

*Tanda overheat mulai kelihatan:*
- RSI 78 (overbought)
- Fear & Greed loncat dari 29 (Fear) ke 72 (Greed) dalam hitungan hari
- Funding rate lagi numpuk cepat lagi setelah sempat adem`,

`*Preseden historisnya dua arah:* Squeeze November 2021 ($69rb) jadi PUNCAK LOKAL sebelum dumped panjang. Squeeze Maret 2024 malah jadi AWAL rally berkelanjutan. Pembedanya cuma satu: open interest numpuk cepat lagi = rapuh. OI tetap rendah = pasar udah "bersih", siap naik sehat.

✅ *VALID kalau:* OI tetap rendah/naik pelan • exchange netflow balik negatif (BTC keluar exchange) • harga bertahan di atas $70-72rb pas retest • ETF inflow makin deras • funding rate normal • Clarity Act lolos vote 15 September

❌ *INVALID kalau:* OI numpuk cepat (LAGI TERJADI) • exchange netflow tetap positif (LAGI TERJADI) • harga gagal bertahan di $70-72rb • bearish divergence (harga naik, RSI turun) • funding meledak ekstrem • Clarity Act molor lagi 15 September`,

`*Status sekarang:* zona abu-abu, condong ke sinyal invalid -- OI numpuk cepat & netflow masih positif (mirip 2021), tapi whale mulai akumulasi & ETF masih dapat inflow (mirip 2024). Level kunci: apakah $70-72rb bertahan, dan 15 September (vote Clarity Act).

Posisi Sniper BTC kita sendiri udah nyesuaiin: tahap 1 diamankan (+$11,36), SL sisa posisi di breakeven -- jadi kalaupun ini beneran cuma squeeze terus dumped balik, sistemnya udah gak bakal ketiban rugi dari skenario ini.

*Kesimpulan Kaela:* ini gerakan jangka pendek, bukan sinyal siklus -- window Musim Tanam sendiri belum buka sampai ~19 Oktober 2026. Jangan disamakan sama "bottom sudah terbentuk". Waspada, bukan panik.

_Ini pembacaan data, bukan ajakan beli/jual. Dipantau lagi kalau $70-72rb ditembus turun, atau pas 15 September._

🔗 Metodologi: https://kaela-btc-sinyal.netlify.app/metodologi-sniper.html`,
];

(async () => {
  for (let i = 0; i < PARTS.length; i++) {
    const res = await sendWhatsApp(PARTS[i]);
    console.log(`[SendKaelaAnalysis] Part ${i + 1}/${PARTS.length}:`, JSON.stringify(res));
    if (i < PARTS.length - 1) await new Promise((r) => setTimeout(r, 2000));
  }
  console.log('[SendKaelaAnalysis] Selesai.');
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
