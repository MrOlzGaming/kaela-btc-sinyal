// Lapis ke-4 analisa gabungan: SENTIMEN & POSISI PASAR (9 Agu 2026) -- semua sumber GRATIS,
// gak ada langganan/API key berbayar. Beda dari technicalAnalysis.js (struktur harga) dan
// liquidation heatmap (event stop-out) -- ini ngukur GIMANA PASAR LAGI POSISI/MERASA sekarang,
// sudut yang dipakai trader profesional buat konfirmasi tambahan (misal funding rate ekstrem =
// pasar kepenuhan 1 arah = rawan reversal).
//
// Sumber:
//   - Fear & Greed Index: alternative.me (gratis, no key, no rate limit ketat)
//   - Funding Rate + Open Interest + Long/Short Ratio: Binance Futures (fapi.binance.com, gratis)
//     CATATAN: ini domain BEDA dari data-api.binance.vision yang biasa kita pakai (itu buat SPOT).
//     fapi.binance.com belum pernah dites dari runner GitHub Actions -- kalau ternyata kena
//     blokir geografis kayak api.binance.com dulu, perlu dicari alternatif.

const { fetchWithRetry } = require('./httpRetry');

async function fetchFearGreed() {
  const res = await fetchWithRetry('https://api.alternative.me/fng/?limit=1');
  const data = await res.json();
  const item = data.data[0];
  return { value: parseInt(item.value, 10), classification: item.value_classification };
}

async function fetchFundingRate(symbol = 'BTCUSDT') {
  const res = await fetchWithRetry(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`);
  const data = await res.json();
  return { rate: parseFloat(data.lastFundingRate), nextFundingTime: data.nextFundingTime };
}

async function fetchOpenInterest(symbol = 'BTCUSDT') {
  const res = await fetchWithRetry(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`);
  const data = await res.json();
  return { openInterest: parseFloat(data.openInterest) };
}

async function fetchLongShortRatio(symbol = 'BTCUSDT') {
  const res = await fetchWithRetry(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`);
  const data = await res.json();
  const item = data[0];
  return { longAccount: parseFloat(item.longAccount), shortAccount: parseFloat(item.shortAccount), ratio: parseFloat(item.longShortRatio) };
}

async function analyzeSentiment(symbol = 'BTCUSDT') {
  const [fearGreed, funding, openInterest, longShort] = await Promise.all([
    fetchFearGreed(), fetchFundingRate(symbol), fetchOpenInterest(symbol), fetchLongShortRatio(symbol),
  ]);
  return { fearGreed, funding, openInterest, longShort };
}

module.exports = { fetchFearGreed, fetchFundingRate, fetchOpenInterest, fetchLongShortRatio, analyzeSentiment };

if (require.main === module) {
  analyzeSentiment('BTCUSDT').then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => {
    console.error('ERROR marketSentiment.js:', e.message);
    process.exit(1);
  });
}
