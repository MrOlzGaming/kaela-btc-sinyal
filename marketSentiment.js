// Lapis ke-4 analisa gabungan: SENTIMEN & POSISI PASAR (9 Agu 2026) -- semua sumber GRATIS,
// gak ada langganan/API key berbayar. Beda dari technicalAnalysis.js (struktur harga) dan
// liquidation heatmap (event stop-out) -- ini ngukur GIMANA PASAR LAGI POSISI/MERASA sekarang,
// sudut yang dipakai trader profesional buat konfirmasi tambahan (misal funding rate ekstrem =
// pasar kepenuhan 1 arah = rawan reversal).
//
// Sumber:
//   - Fear & Greed Index: alternative.me (gratis, no key, no rate limit ketat)
//   - Funding Rate + Open Interest + Long/Short Ratio: Bybit (api.bybit.com, gratis, no key)
//     CATATAN PENTING (9 Agu 2026): awalnya pakai Binance Futures (fapi.binance.com), TERNYATA
//     kena blokir geografis (HTTP 451) di runner GitHub Actions -- beda dari data-api.binance.vision
//     (spot) yang emang didesain unblocked, gak ada versi "vision" buat futures Binance. Dites
//     langsung: Bybit gak kena blokir yang sama, dipakai gantiin buat 3 metrik ini.

const { fetchWithRetry } = require('./httpRetry');

async function fetchFearGreed() {
  const res = await fetchWithRetry('https://api.alternative.me/fng/?limit=1');
  const data = await res.json();
  const item = data.data[0];
  return { value: parseInt(item.value, 10), classification: item.value_classification };
}

async function fetchFundingAndOI(symbol = 'BTCUSDT') {
  const res = await fetchWithRetry(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`);
  const data = await res.json();
  const item = data.result.list[0];
  return { rate: parseFloat(item.fundingRate), nextFundingTime: parseInt(item.nextFundingTime, 10), openInterest: parseFloat(item.openInterest) };
}

async function fetchLongShortRatio(symbol = 'BTCUSDT') {
  const res = await fetchWithRetry(`https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${symbol}&period=1h&limit=1`);
  const data = await res.json();
  const item = data.result.list[0];
  return { longAccount: parseFloat(item.buyRatio), shortAccount: parseFloat(item.sellRatio), ratio: parseFloat(item.buyRatio) / parseFloat(item.sellRatio) };
}

async function analyzeSentiment(symbol = 'BTCUSDT') {
  const [fearGreed, fundingAndOI, longShort] = await Promise.all([
    fetchFearGreed(), fetchFundingAndOI(symbol), fetchLongShortRatio(symbol),
  ]);
  return {
    fearGreed,
    funding: { rate: fundingAndOI.rate, nextFundingTime: fundingAndOI.nextFundingTime },
    openInterest: { openInterest: fundingAndOI.openInterest },
    longShort,
  };
}

module.exports = { fetchFearGreed, fetchFundingAndOI, fetchLongShortRatio, analyzeSentiment };

if (require.main === module) {
  analyzeSentiment('BTCUSDT').then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => {
    console.error('ERROR marketSentiment.js:', e.message);
    process.exit(1);
  });
}
