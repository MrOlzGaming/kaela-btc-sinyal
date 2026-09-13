// Filter konfirmasi Funding Rate BTC (14 Sep 2026, dari daftar "Ide belum dicoba" RESEARCH-LOG.md
// -- "Indikator makro lain sebagai konfirmasi entry... funding rate BTC"). Hipotesis: funding
// rate yang JAUH DI ATAS rata-rata dirinya sendiri (long jauh lebih rame/mahal drpd biasanya)
// nandain posisi LONG lagi CROWDED -- resiko reversal/squeeze lebih tinggi, kurang ideal buat
// entry LONG BARU. Filter SIMPEL (funding close < SMA-nya sendiri) SENGAJA nyontek pola
// `dxyFilter.js` PERSIS (self-referential, gak pakai angka ambang absolut) -- pelajaran project
// ini: makin banyak parameter/angka ambang sembarangan, makin gampang overfitting palsu.
const fs = require('fs');
const path = require('path');
const { sma } = require('../technicalAnalysis');

function loadFundingHistory() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'funding-rate-cache.json'), 'utf8'));
  return raw.sort((a, b) => a.fundingTime - b.fundingTime);
}

// Bikin fungsi lookup: kasih timestamp candle sinyal (ms), balikin apa funding rate BTC lagi
// "gak crowded" (funding TERAKHIR yang fundingTime <= signalTimeMs itu DI BAWAH SMA-nya sendiri)
// -- gak nyontek masa depan (funding rate dipublikasi PAS fundingTime, dipakai baru abis itu).
// smaLen default 20 (periode funding, 8 jam-an -- ~6,7 hari) -- angka bulat SAMA gaya dxyFilter.js.
function buildFundingFavorableLookup(smaLen = 20) {
  const history = loadFundingHistory();
  const rates = history.map((h) => h.fundingRate);
  const smaSeries = rates.map((_, i) => sma(rates.slice(0, i + 1), smaLen));

  return function isFundingFavorable(signalTimeMs) {
    let lo = 0, hi = history.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (history[mid].fundingTime <= signalTimeMs) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (ans === -1 || smaSeries[ans] === null) return null; // belum ada data/SMA di titik ini -- gak bisa dipastikan
    return history[ans].fundingRate < smaSeries[ans];
  };
}

module.exports = { loadFundingHistory, buildFundingFavorableLookup };

if (require.main === module) {
  const isFundingFavorable = buildFundingFavorableLookup(20);
  const history = loadFundingHistory();
  const sample = history[history.length - 1];
  console.log('Funding terakhir:', new Date(sample.fundingTime).toISOString(), sample.fundingRate);
  console.log('Funding favorable (di bawah SMA20) saat itu?', isFundingFavorable(sample.fundingTime));
}
