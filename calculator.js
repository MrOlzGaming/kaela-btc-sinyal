// OLZ Exposure System — kalkulator resmi (Modal + Nyawa -> Leverage, Nilai Posisi, Margin)
//
// TABEL EXPOSURE (baca pakai >= dan <, JANGAN pakai rentang dua angka biar gak ketuker):
//   Modal >= $1        dan < $10        -> 12x
//   Modal >= $10        dan < $100       -> 6x
//   Modal >= $100       dan < $1.000     -> 3x
//   Modal >= $1.000      dan < $10.000    -> 1,5x
//   Modal >= $10.000      dan < $100.000   -> 0,75x   <- Modal PERSIS $10.000 masuk SINI, bukan yang 1,5x
//   Modal >= $100.000      dan < $1.000.000 -> 0,375x
//   Modal >= $1.000.000     dan < $10.000.000-> 0,1875x
//   (terus berlanjut: tiap x10 modal, Exposure dibagi 2)
//
// Titik peralihan (contoh biar nempel di kepala):
//   Modal $9.999   -> Exposure 1,5x  (masih di bracket bawah)
//   Modal $10.000  -> Exposure 0,75x (udah masuk bracket atas -- TEPAT di angka ini pindah)
//   Modal $99.999  -> Exposure 0,75x
//   Modal $100.000 -> Exposure 0,375x

function getExposure(modal) {
  if (modal < 1) modal = 1;
  const magnitude = Math.floor(Math.log10(modal));
  return 12 / Math.pow(2, magnitude);
}

function nyawaFromEntrySL(entry, stopLoss) {
  return (Math.abs(entry - stopLoss) / entry) * 100;
}

function hitung({ modal, nyawa, entry, stopLoss }) {
  const nyawaPct = nyawa !== undefined ? nyawa : nyawaFromEntrySL(entry, stopLoss);
  const exposure = getExposure(modal);
  const nilaiPosisi = modal * exposure;
  const leverage = Math.floor(100 / nyawaPct);
  const margin = nilaiPosisi / leverage;
  return { exposure, nilaiPosisi, leverage, margin };
}

function format(modal, hasil) {
  return `Modal : $${modal.toLocaleString('en-US')}\n\n` +
    `🔥 LEVERAGE      : ${hasil.leverage}×\n` +
    `🎯 NILAI POSISI  : $${hasil.nilaiPosisi.toLocaleString('en-US', { maximumFractionDigits: 2 })}\n` +
    `💰 MARGIN        : $${hasil.margin.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

module.exports = { getExposure, nyawaFromEntrySL, hitung, format };

if (require.main === module) {
  console.log(format(50, hitung({ modal: 50, entry: 65500, stopLoss: 64500 })));
  console.log();
  console.log(format(6727, hitung({ modal: 6727, entry: 65500, stopLoss: 64500 })));
}
