// Blok inti pesan sinyal -- SATU fungsi dipakai Sniper (sniperOrderLog.js) DAN Nyopet
// (darkKaelaLog.js) buat bagian yang HARUS seragam (23 Agu 2026, permintaan Olan: "buat pesan
// dengan konsep mendekati seragam -- long/short di harga berapa, TP, SL/nyawa, leverage, alasan").
// Konteks TAMBAHAN yang beda antar strategi (TA/sentimen/onchain Sniper, konteks zona Nyopet)
// TETAP boleh nempel di luar blok ini -- yang seragam cuma bentuk INTI-nya, bukan seluruh pesan.
function fmtUsd(n) {
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: n < 1000 ? 2 : 0 });
}

function formatSignalCore({ direction, entryPrice, tp, sl, leverage, marginUsd, reason }) {
  const dirLabel = direction === 'buy' ? '🟢 LONG' : '🔴 SHORT';
  const nyawaPct = Math.abs(entryPrice - sl) / entryPrice * 100;
  return [
    `${dirLabel} @ ${fmtUsd(entryPrice)}`,
    `🎯 TP: ${fmtUsd(tp)}`,
    `❌ Nyawa (SL, ${nyawaPct.toFixed(1)}%): ${fmtUsd(sl)}`,
    `⚙️ Leverage ${leverage}× · Margin ${fmtUsd(marginUsd)}`,
    '',
    `💡 Alasan: ${reason}`,
  ];
}

module.exports = { formatSignalCore, fmtUsd };
