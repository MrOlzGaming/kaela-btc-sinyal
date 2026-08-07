// Filter rezim berbasis siklus halving BTC (4 tahun).
// Tahun ke-0 (saat halving) & tahun ke-3: cari peluang BUY.
// Tahun ke-1 & ke-2 (pasca halving): cari peluang SELL.
const HALVING_DATES = ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-19', '2028-04-01']
  .map((d) => new Date(d + 'T00:00:00Z').getTime());

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

// return 'BUY' | 'SELL' | null (null = sebelum halving pertama, gak ada aturan)
function getHalvingPhaseDirection(dateMs) {
  let recentHalving = null;
  for (const h of HALVING_DATES) {
    if (h <= dateMs) recentHalving = h;
    else break;
  }
  if (recentHalving === null) return null;

  const yearsSince = (dateMs - recentHalving) / YEAR_MS;
  const yearIndex = Math.floor(yearsSince) % 4;
  return (yearIndex === 0 || yearIndex === 3) ? 'BUY' : 'SELL';
}

module.exports = { getHalvingPhaseDirection, HALVING_DATES };
