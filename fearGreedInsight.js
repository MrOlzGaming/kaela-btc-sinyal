// Catatan tambahan pas Fear & Greed Index nyentuh titik EKSTREM (12 Agu 2026, permintaan Olan:
// "pelajari fear and greed, di titik tertentu extreme fear/greed kasih info"). Klasifikasi
// LANGSUNG dari sumber (alternative.me `value_classification`) -- 'Extreme Fear'/'Extreme Greed',
// bukan ambang buatan sendiri. MURNI INFORMASI/konteks, bukan sinyal entry -- gak pengaruhi
// keputusan VALID/INVALID sama sekali.

// Kutipan "buy when there's blood in the streets" -- umum diatributkan ke Baron Rothschild, TAPI
// sumbernya sendiri gak pasti/kemungkinan besar apokrif (gak ada bukti historis kuat dia beneran
// pernah bilang ini persis). Tetap dicantumkan sesuai permintaan Olan, dengan catatan jujur soal
// itu -- biar gak keliru dikira fakta sejarah pasti.
const ROTHSCHILD_QUOTE_EN = "Buy when there's blood in the streets, even if the blood is your own.";
const ROTHSCHILD_QUOTE_ID = 'Beli saat darah tumpah di jalanan, bahkan kalau itu darahmu sendiri.';

function extremeFearNote(value) {
  return [
    `🩸 EXTREME FEAR (${value}/100) -- pasar lagi ketakutan parah.`,
    '',
    `"${ROTHSCHILD_QUOTE_EN}"`,
    `"${ROTHSCHILD_QUOTE_ID}"`,
    `— sering diatributkan ke Baron Rothschild (catatan jujur: sumbernya sendiri gak pasti/kemungkinan apokrif, tapi pesannya tetap relevan sbg pengingat kontrarian klasik).`,
    '',
    'Ini BUKAN sinyal beli otomatis -- ketakutan ekstrem bisa juga berarti tren turun masih lanjut, bukan selalu titik balik. Murni pengingat perspektif kontrarian, keputusan tetap di tangan masing-masing.',
  ].join('\n');
}

function extremeGreedNote(value) {
  return [
    `🟢 EXTREME GREED (${value}/100) -- pasar lagi euforia/serakah parah.`,
    '',
    'Kebalikan dari extreme fear -- momen paling ramai/optimis biasanya juga momen paling rawan koreksi mendadak. Bukan sinyal jual otomatis, cuma pengingat buat gak ikut euforia tanpa pikir panjang, keputusan tetap di tangan masing-masing.',
  ].join('\n');
}

// Return string catatan kalau klasifikasi ekstrem, null kalau normal (Fear/Neutral/Greed biasa).
function getExtremeFearGreedNote(fearGreed) {
  if (!fearGreed) return null;
  if (fearGreed.classification === 'Extreme Fear') return extremeFearNote(fearGreed.value);
  if (fearGreed.classification === 'Extreme Greed') return extremeGreedNote(fearGreed.value);
  return null;
}

module.exports = { getExtremeFearGreedNote, ROTHSCHILD_QUOTE_EN, ROTHSCHILD_QUOTE_ID };
