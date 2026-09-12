// Blok inti pesan sinyal -- SATU fungsi dipakai Sniper (sniperOrderLog.js) DAN Nyopet
// (darkKaelaLog.js) buat bagian yang HARUS seragam (23 Agu 2026, permintaan Olan: "buat pesan
// dengan konsep mendekati seragam -- long/short di harga berapa, TP, SL/nyawa, leverage, alasan").
// Konteks TAMBAHAN yang beda antar strategi (TA/sentimen/onchain Sniper, konteks zona Nyopet)
// TETAP boleh nempel di luar blok ini -- yang seragam cuma bentuk INTI-nya, bukan seluruh pesan.
function fmtUsd(n) {
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: n < 1000 ? 2 : 0 });
}

// fmtUsdWithIdr (13 Sep 2026, permintaan Olan "nilai investasi juga di rupiahin dalam kurung..
// berlaku semua") -- REUSE dari darkKaelaLog.js (SATU sumber format IDR), dipakai KHUSUS buat
// Margin (nilai yang di-invest) -- entryPrice/TP/SL TETAP USD polos karena itu level HARGA aset,
// bukan nilai investasi. `idrRate` OPSIONAL (null/gagal -> fallback USD doang, gak gugurin pesan).
const { fmtUsdWithIdr } = require('./darkKaelaLog');

function formatSignalCore({ direction, entryPrice, tp, sl, leverage, marginUsd, reason, idrRate }) {
  const dirLabel = direction === 'buy' ? '🟢 LONG' : '🔴 SHORT';
  const nyawaPct = Math.abs(entryPrice - sl) / entryPrice * 100;
  return [
    `${dirLabel} @ ${fmtUsd(entryPrice)}`,
    `🎯 TP: ${fmtUsd(tp)}`,
    `❌ Nyawa (SL, ${nyawaPct.toFixed(1)}%): ${fmtUsd(sl)}`,
    `⚙️ Leverage ${leverage}× · Margin ${fmtUsdWithIdr(marginUsd, idrRate)}`,
    '',
    `💡 Alasan: ${reason}`,
  ];
}

module.exports = { formatSignalCore, fmtUsd };
