// Lapis ke-4 analisa gabungan: SENTIMEN & POSISI PASAR (9 Agu 2026) -- semua sumber GRATIS,
// gak ada langganan/API key berbayar. Beda dari technicalAnalysis.js (struktur harga) dan
// liquidation heatmap (event stop-out) -- ini ngukur GIMANA PASAR LAGI POSISI/MERASA sekarang,
// sudut yang dipakai trader profesional buat konfirmasi tambahan (misal funding rate ekstrem =
// pasar kepenuhan 1 arah = rawan reversal).
//
// Sumber:
//   - Fear & Greed Index: alternative.me (gratis, no key, no rate limit ketat)
//   - Funding Rate + Open Interest + Long/Short Ratio: Bybit (api.bybit.com, gratis, no key)
//     CATATAN PENTING (9 Agu 2026): data DERIVATIF/FUTURES ternyata rawan blokir geografis dari
//     runner GitHub Actions (berbasis US) -- Binance Futures (fapi.binance.com) kena HTTP 451,
//     Bybit kena blokir CloudFront-nya sendiri juga. Pola berulang lintas exchange, bukan cuma 1
//     penyedia. Fear & Greed (bukan data derivatif exchange) gak kena pola yang sama. Karena itu
//     SETIAP sumber di bawah independen (try/catch masing-masing) -- kalau 1 gagal, yang lain
//     TETAP tampil, bukan semuanya ikut gugur.

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

async function safe(fn, label) {
  try {
    return await fn();
  } catch (e) {
    console.log(`[MarketSentiment] ${label} gagal (dilewatin):`, e.message.slice(0, 120));
    return null;
  }
}

// Partial-OK by design -- tiap sumber independen, sebagian gagal TIDAK gugurin yang lain
// (lihat catatan di atas soal blokir geografis derivatif). Field yang gagal jadi null,
// caller (nyopetOrderLog.js sentimentLines) WAJIB handle null per-field.
async function analyzeSentiment(symbol = 'BTCUSDT') {
  const [fearGreed, fundingAndOI, longShort] = await Promise.all([
    safe(fetchFearGreed, 'Fear & Greed'),
    safe(() => fetchFundingAndOI(symbol), 'Funding/OI (Bybit)'),
    safe(() => fetchLongShortRatio(symbol), 'Long/Short Ratio (Bybit)'),
  ]);
  return {
    fearGreed,
    funding: fundingAndOI ? { rate: fundingAndOI.rate, nextFundingTime: fundingAndOI.nextFundingTime } : null,
    openInterest: fundingAndOI ? { openInterest: fundingAndOI.openInterest } : null,
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
