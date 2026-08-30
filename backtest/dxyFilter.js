// Filter konfirmasi DXY (31 Agu 2026, permintaan Olan: "setiap entry juga diyakinkan dengan
// dxy.. tambahan konfirmasi") -- karena Sniper+Nyopet v2 SEKARANG long-only, filter yang masuk
// akal: cuma ambil sinyal LONG kalau DXY lagi TREN LEMAH (dolar melemah -> risk-on/emas biasanya
// lebih gampang naik). Filter SIMPEL (DXY close < SMA20 sendiri) sengaja -- hindari overfitting
// ke parameter aneh2 (pelajaran project ini berulang kali: makin banyak parameter, makin gampang
// "kelihatan bagus" tapi palsu).
const fs = require('fs');
const path = require('path');
const { sma } = require('../technicalAnalysis');

function loadDxyDaily() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'dxy-daily-cache.json'), 'utf8'));
  return raw.sort((a, b) => a.closeTime - b.closeTime);
}

// Bikin fungsi lookup: kasih timestamp candle sinyal (ms), balikin apa DXY lagi "lemah" (close <
// SMA-nya sendiri) di HARI ITU (pakai candle DXY harian TERAKHIR yang closeTime <= timestamp
// sinyal -- gak nyontek masa depan). smaLen default 20 (hari) -- angka bulat biasa dipakai,
// bukan hasil sweep/tuning.
function buildDxyWeakLookup(smaLen = 20) {
  const daily = loadDxyDaily();
  const closes = daily.map((c) => c.close);
  const smaSeries = closes.map((_, i) => sma(closes.slice(0, i + 1), smaLen));

  return function isDxyWeak(signalTimeMs) {
    // Cari index candle DXY TERAKHIR yang closeTime <= signalTimeMs (binary search, data udah sorted).
    let lo = 0, hi = daily.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (daily[mid].closeTime <= signalTimeMs) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (ans === -1 || smaSeries[ans] === null) return null; // belum ada data DXY/SMA di titik ini -- gak bisa dipastikan
    return daily[ans].close < smaSeries[ans];
  };
}

module.exports = { loadDxyDaily, buildDxyWeakLookup };

if (require.main === module) {
  const isDxyWeak = buildDxyWeakLookup(20);
  const daily = loadDxyDaily();
  const sample = daily[daily.length - 1];
  console.log('DXY candle terakhir:', new Date(sample.closeTime).toISOString().slice(0, 10), sample.close);
  console.log('DXY lemah (di bawah SMA20) hari itu?', isDxyWeak(sample.closeTime));
}
