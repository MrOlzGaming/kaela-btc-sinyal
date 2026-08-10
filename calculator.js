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

// Peringatan margin/modal (10 Agu 2026) -- ambang dari riset backtest Nyopet (backtestNyopet.js):
// margin/modal <10% -> drawdown historis terkendali (~33%). >20% -> drawdown historis berat
// (58%+, bahkan bisa ambruk total di kasus ekstrem). BUKAN pembatas keras -- tetap bisa diinput,
// cuma dikasih tau biar sadar seberapa besar porsi modal yang nyangkut di 1 trade ini.
function assessMarginRisk(marginPct) {
  if (marginPct > 20) {
    return { level: 'bahaya', message: `Nyawa ini kegedean buat modal segini -- margin yang kepake ${marginPct.toFixed(1)}% dari modal. Riskan banget kalau kena SL.` };
  }
  if (marginPct > 10) {
    return { level: 'perhatian', message: `Nyawa lumayan lebar -- margin yang kepake ${marginPct.toFixed(1)}% dari modal. Pertimbangkan modal lebih besar atau nyawa lebih tipis.` };
  }
  return null;
}

function hitung({ modal, nyawa, entry, stopLoss }) {
  const nyawaPct = nyawa !== undefined ? nyawa : nyawaFromEntrySL(entry, stopLoss);
  const exposure = getExposure(modal);
  const nilaiPosisi = modal * exposure;
  const leverage = Math.floor(100 / nyawaPct);
  const margin = nilaiPosisi / leverage;
  const marginPct = margin / modal * 100;
  const warning = assessMarginRisk(marginPct);
  return { exposure, nilaiPosisi, leverage, margin, marginPct, warning };
}

// Sizing "fixed risk" (10 Agu 2026, Nyopet Auto-Analysis SAJA -- BUKAN ganti `hitung()` di atas,
// yang tetap jadi rumus RESMI buat kalkulator manual/proyek lain). Beda arah hitung: `hitung()`
// jaga NILAI POSISI tetap (exposure × modal), margin BISA MEMBENGKAK kalau nyawa lebar (ketemu
// bisa sampai 100% modal 1 trade -- akar masalah drawdown Nyopet, riset backtestNyopet.js
// 10 Agu 2026). Di sini margin DIJAGA KONSTAN (targetRiskPct × modal), nilai posisi yang otomatis
// MENGECIL kalau nyawa lebar. Tervalidasi backtest: targetRiskPct=15% -> drawdown historis turun
// dari 78,1% jadi 47% (modal simulasi $100 -> $3.228 dalam 6,5 tahun), dipilih Olan sebagai
// keseimbangan return-vs-drawdown.
function hitungFixedRisk({ modal, targetRiskPct, nyawa, entry, stopLoss }) {
  const nyawaPct = nyawa !== undefined ? nyawa : nyawaFromEntrySL(entry, stopLoss);
  const leverage = Math.max(1, Math.floor(100 / nyawaPct));
  const margin = modal * (targetRiskPct / 100);
  const nilaiPosisi = margin * leverage;
  const exposure = nilaiPosisi / modal;
  const marginPct = targetRiskPct; // by design, selalu = targetRiskPct
  const warning = assessMarginRisk(marginPct);
  return { exposure, nilaiPosisi, leverage, margin, marginPct, warning };
}

function format(modal, hasil) {
  return `Modal : $${modal.toLocaleString('en-US')}\n\n` +
    `🔥 LEVERAGE      : ${hasil.leverage}×\n` +
    `🎯 NILAI POSISI  : $${hasil.nilaiPosisi.toLocaleString('en-US', { maximumFractionDigits: 2 })}\n` +
    `💰 MARGIN        : $${hasil.margin.toLocaleString('en-US', { maximumFractionDigits: 2 })}` +
    (hasil.warning ? `\n\n⚠️ ${hasil.warning.message}` : '');
}

module.exports = { getExposure, nyawaFromEntrySL, hitung, hitungFixedRisk, format };

if (require.main === module) {
  console.log(format(50, hitung({ modal: 50, entry: 65500, stopLoss: 64500 })));
  console.log();
  console.log(format(6727, hitung({ modal: 6727, entry: 65500, stopLoss: 64500 })));
}
