// "Ancang-ancang" -- pola yang lagi KEBENTUK tapi BELUM breakout/konfirmasi. 22 Agu 2026,
// permintaan Olan: "kalo nemu pola chart pattern potensi bullish dah mulai kasih sinyal walau
// belum valid.. tinggal kasih info apa yang di tunggu Kaela... begitu valid baru gas".
//
// PENTING: ini BUKAN sinyal baru, gak buka posisi bayangan apapun -- murni info "lagi diawasi,
// nunggu X buat konfirmasi", numpang di pesan status harian yang UDAH ada (formatAutoInvalid di
// sniperOrderLog.js) pas hari itu emang gak ada sinyal VALID. Reuse detectFlag/detectWedge/
// detectBullishFVG APA ADANYA (chartPatterns.js/fvgDetector.js) -- sama persis logika deteksi
// yang udah divalidasi backtest, cuma DIPANGGIL DENGAN CARA BEDA (lihat komentar tiap fungsi).

const { detectFlag, detectWedge } = require('./chartPatterns');
const { detectBullishFVG } = require('./fvgDetector');

// detectFlag/detectWedge(daily, i) nyari pola pakai window SEBELUM index i (gak termasuk i).
// Buat "watching" (pola termasuk HARI INI, belum breakout), panggil pakai i = daily.length
// (SATU LEBIH dari index candle terakhir) -- window slice otomatis include candle terakhir
// (hari ini) sebagai bagian akhir konsolidasi, TANPA perlu breakout buat kedeteksi.
function detectWatchingPattern(daily, opts = {}) {
  const i = daily.length;
  const flag = detectFlag(daily, i, opts);
  if (flag && flag.type === 'bull') {
    return {
      mode: 'sniper',
      patternType: flag.shape === 'pennant' ? 'pennant_bull' : 'flag_bull',
      watchLevel: flag.flagHigh,
      note: `Pola ${flag.shape === 'pennant' ? 'Bullish Pennant' : 'Bull Flag'} lagi kebentuk -- nunggu candle harian CLOSE di atas $${flag.flagHigh.toLocaleString('en-US')} buat konfirmasi breakout.`,
    };
  }
  const wedge = detectWedge(daily, i, opts);
  if (wedge && wedge.type === 'falling') {
    return {
      mode: 'sniper',
      patternType: 'wedge_falling',
      watchLevel: wedge.projectedResistance,
      note: `Pola Falling Wedge lagi kebentuk -- nunggu candle harian CLOSE di atas $${wedge.projectedResistance.toLocaleString('en-US', { maximumFractionDigits: 0 })} buat konfirmasi breakout.`,
    };
  }
  return null;
}

// FVG aktif (belum keisi penuh) yang BELUM konfirmasi pantulan -- reuse loop scan yang sama
// gayanya kayak detectFvgSignal, TAPI TANPA syarat "lastPrice > gapTop" (itu yang bikin FVG
// BELUM valid, justru itu yang mau kita laporin sbg "lagi diawasi").
function detectWatchingFvg(daily, opts = {}) {
  const { usedGapTimes = new Set() } = opts;
  const i = daily.length - 1;
  const lastPrice = daily[i].close;

  for (let k = i; k >= 2; k--) {
    if (usedGapTimes.has(daily[k].closeTime)) continue;
    const fvg = detectBullishFVG(daily, k);
    if (!fvg) continue;

    let filled = false;
    for (let j = k + 1; j <= i; j++) {
      if (daily[j].low <= fvg.gapBottom) { filled = true; break; }
    }
    if (filled) continue;
    if (lastPrice > fvg.gapTop) continue; // ini udah KONFIRMASI (valid), bukan lagi "watching"

    const posisi = lastPrice <= fvg.gapTop && lastPrice >= fvg.gapBottom
      ? 'harga LAGI DI DALAM zona gap sekarang'
      : 'harga masih di atas zona gap, belum koreksi masuk';
    return {
      mode: 'fvg',
      gapTop: fvg.gapTop, gapBottom: fvg.gapBottom, gapCreatedTime: daily[k].closeTime,
      note: `Fair Value Gap aktif @ $${fvg.gapBottom.toLocaleString('en-US')}-$${fvg.gapTop.toLocaleString('en-US')} (${posisi}) -- nunggu candle harian CLOSE balik di atas $${fvg.gapTop.toLocaleString('en-US')} buat konfirmasi pantulan.`,
    };
  }
  return null;
}

module.exports = { detectWatchingPattern, detectWatchingFvg };
