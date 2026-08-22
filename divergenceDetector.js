// Divergence Detector -- bukan "X lagi aneh" (itu anomalyScanner.js), tapi "X sama Y lagi SALING
// KONTRADIKSI, ada yang gak beres". 22 Agu 2026, permintaan Olan (referensi Michael Burry The Big
// Short -- gak percaya 1 angka/cerita doang, curigai kalau 2 sumber independen cerita beda).
// Bagian dari "Kaela analis tier Bloomberg" (lihat memori project-kaela-analyst-tier).
//
// SEMUA fungsi di sini PURE (data in, divergence out) -- gak fetch apapun sendiri, dipanggil dari
// groupMonitor.js pakai data yang UDAH di-fetch buat Conviction Score mingguan (gak nambah request
// API sama sekali, murni logika pembanding tambahan).

// 1) COT smart money EKSTREM net-long, tapi harga Emas malah gak naik (atau turun) minggu ini --
// biasanya berarti posisi udah penuh sesak, gak ada lagi pembeli baru buat dorong harga lebih tinggi.
function checkGoldCotPriceDivergence(cot, priceChangePct) {
  if (!cot) return null;
  const abs = Math.abs(cot.netPctOi);
  if (abs < 40) return null; // cuma relevan kalau posisinya EKSTREM
  const arahPosisi = cot.net > 0 ? 'net-long' : 'net-short';
  if (cot.net > 0 && priceChangePct <= 0.5) {
    return {
      label: '⚠️ Divergensi COT vs Harga (Emas)',
      explanation: `Smart money SANGAT ${arahPosisi} (${cot.netPctOi.toFixed(0)}% OI), tapi harga Emas minggu ini cuma ${priceChangePct >= 0 ? '+' : ''}${priceChangePct.toFixed(1)}% -- kalau posisi udah sepenuh itu tapi harga gak ikut naik, biasanya artinya udah gak ada lagi pembeli baru yang tersisa buat dorong lebih tinggi. Rawan unwind/koreksi.`,
    };
  }
  if (cot.net < 0 && priceChangePct >= -0.5) {
    return {
      label: '⚠️ Divergensi COT vs Harga (Emas)',
      explanation: `Smart money SANGAT ${arahPosisi} (${cot.netPctOi.toFixed(0)}% OI), tapi harga Emas minggu ini cuma ${priceChangePct >= 0 ? '+' : ''}${priceChangePct.toFixed(1)}% (gak ikut turun) -- posisi short udah penuh tapi harga gak nurut, rawan short squeeze/unwind.`,
    };
  }
  return null;
}

// 2) "Tenang di permukaan, stres di bawah" -- Conviction Score gak menunjukkan bearish, tapi
// DVOL (ekspektasi volatilitas) dan Credit Spread (stres kredit) sama-sama lagi NAIK bareng.
// Ini bukan penurunan harga yang keliatan, tapi 2 indikator independen udah mulai "gelisah"
// duluan sebelum harga beneran ikut turun.
function checkCalmBeforeStorm(convictionScore, dvol, creditSpread) {
  if (!dvol || !creditSpread) return null;
  if (convictionScore < 0) return null; // kalau Conviction Score UDAH bearish, ini bukan divergensi lagi, itu udah konfirmasi
  const dvolNaik = dvol.changePct > 15; // naik >15% dalam seminggu terakhir
  const spreadNaik = creditSpread.changeBps > 10; // naik >10bps dalam 30 hari terakhir
  if (dvolNaik && spreadNaik) {
    return {
      label: '⚠️ "Tenang di Permukaan, Stres di Bawah" (BTC)',
      explanation: `Conviction Score BTC gak menunjukkan bearish, TAPI DVOL naik ${dvol.changePct.toFixed(0)}% dan Credit Spread naik ${creditSpread.changeBps.toFixed(0)}bps bareng-bareng -- dua indikator independen (opsi kripto + kredit korporasi AS) sama-sama mulai gelisah duluan sebelum harga ikut bereaksi. Bukan sinyal jual, tapi layak diwaspadai.`,
    };
  }
  return null;
}

// 3) Harga bikin gerakan naik signifikan minggu ini, TAPI NUPL (on-chain profit/loss unrealized)
// masih di zona rendah -- klasik "harga naik tapi tenaganya (partisipasi profit riil) belum
// ngikut", momentum yang gak dikonfirmasi on-chain.
function checkPriceNuplDivergence(priceChangePct, nupl) {
  if (!nupl) return null;
  if (priceChangePct < 5) return null; // cuma relevan kalau harga BENERAN naik signifikan
  if (nupl.classification === 'Capitulation' || nupl.classification === 'Hope / Fear') {
    return {
      label: '⚠️ Divergensi Harga vs NUPL (BTC)',
      explanation: `Harga BTC naik ${priceChangePct.toFixed(1)}% minggu ini, TAPI NUPL cuma di "${nupl.classification}" (${nupl.value.toFixed(2)}) -- partisipasi profit on-chain belum ngonfirmasi kenaikan harga sekencang itu. Momentum keliatan kuat di harga doang, belum tentu didukung aktivitas on-chain riil.`,
    };
  }
  return null;
}

function collectDivergences({ goldCot, goldPriceChangePct, btcConvictionScore, dvol, creditSpread, btcPriceChangePct, nupl }) {
  return [
    checkGoldCotPriceDivergence(goldCot, goldPriceChangePct),
    checkCalmBeforeStorm(btcConvictionScore, dvol, creditSpread),
    checkPriceNuplDivergence(btcPriceChangePct, nupl),
  ].filter(Boolean);
}

function formatDivergenceLines(divergences) {
  if (divergences.length === 0) return [];
  const lines = ['', '🔬 DIVERGENSI TERDETEKSI (2 sumber data saling kontradiksi):'];
  for (const d of divergences) {
    lines.push(`${d.label}`);
    lines.push(`   ${d.explanation}`);
  }
  return lines;
}

module.exports = {
  checkGoldCotPriceDivergence, checkCalmBeforeStorm, checkPriceNuplDivergence,
  collectDivergences, formatDivergenceLines,
};
