// Lapis ke-4 analisa gabungan: SENTIMEN & POSISI PASAR (9 Agu 2026) -- semua sumber GRATIS,
// gak ada langganan/API key berbayar. Beda dari technicalAnalysis.js (struktur harga) dan
// liquidation heatmap (event stop-out) -- ini ngukur GIMANA PASAR LAGI POSISI/MERASA sekarang,
// sudut yang dipakai trader profesional buat konfirmasi tambahan (misal funding rate ekstrem =
// pasar kepenuhan 1 arah = rawan reversal).
//
// Sumber:
//   - Fear & Greed Index: alternative.me (gratis, no key, no rate limit ketat)
//   - Funding Rate + Open Interest: OKX (www.okx.com/api/v5/public/..., resmi & terdokumentasi, gratis)
//   - Long/Short Ratio: OKX endpoint internal (priapi, gak resmi/gak didokumentasikan -- dites
//     jalan tapi BISA berubah sewaktu-waktu tanpa pemberitahuan), fallback ke Bybit kalau gagal
//
// CATATAN PENTING (9 Agu 2026): data DERIVATIF/FUTURES ternyata rawan blokir geografis dari
// runner GitHub Actions (berbasis US) -- Binance Futures (fapi.binance.com) kena HTTP 451,
// Bybit (api.bybit.com) kena blokir CloudFront. OKX dites JALAN dari lokal (belum dites dari
// runner GH Actions -- kalau ternyata juga kena blokir, itu bakal ke-log jelas, gak nge-crash,
// lihat pola fault-tolerant di bawah). Fear & Greed (bukan data derivatif exchange) gak kena
// pola blokir yang sama. SETIAP sumber independen (try/catch masing-masing + fallback berjenjang)
// -- kalau 1 gagal, yang lain TETAP tampil, bukan semuanya ikut gugur.

const { fetchWithRetry } = require('./httpRetry');

async function fetchFearGreed() {
  const res = await fetchWithRetry('https://api.alternative.me/fng/?limit=1');
  const data = await res.json();
  const item = data.data[0];
  return { value: parseInt(item.value, 10), classification: item.value_classification };
}

async function fetchFundingAndOI_OKX(symbol = 'BTC-USDT-SWAP') {
  const [fundingRes, oiRes] = await Promise.all([
    fetchWithRetry(`https://www.okx.com/api/v5/public/funding-rate?instId=${symbol}`),
    fetchWithRetry(`https://www.okx.com/api/v5/public/open-interest?instId=${symbol}`),
  ]);
  const funding = (await fundingRes.json()).data[0];
  const oi = (await oiRes.json()).data[0];
  return { rate: parseFloat(funding.fundingRate), nextFundingTime: parseInt(funding.nextFundingTime, 10), openInterest: parseFloat(oi.oiCcy) };
}

async function fetchFundingAndOI_Bybit(symbol = 'BTCUSDT') {
  const res = await fetchWithRetry(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`);
  const data = await res.json();
  const item = data.result.list[0];
  return { rate: parseFloat(item.fundingRate), nextFundingTime: parseInt(item.nextFundingTime, 10), openInterest: parseFloat(item.openInterest) };
}

// Endpoint internal OKX (dipakai frontend mereka sendiri, BUKAN /api/v5/public resmi -- gak ada
// versi resmi buat long/short ratio per 9 Agu 2026). Dites jalan, tapi rawan berubah.
async function fetchLongShortRatio_OKX(ccy = 'BTC') {
  const res = await fetchWithRetry(`https://www.okx.com/priapi/v5/rubik/stat/contracts/long-short-account-ratio?ccy=${ccy}&period=5m`);
  const data = await res.json();
  const [, ratioStr] = data.data[0]; // [timestamp, ratio] -- terbaru duluan
  const ratio = parseFloat(ratioStr);
  return { longAccount: ratio / (ratio + 1), shortAccount: 1 / (ratio + 1), ratio };
}

async function fetchLongShortRatio_Bybit(symbol = 'BTCUSDT') {
  const res = await fetchWithRetry(`https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${symbol}&period=1h&limit=1`);
  const data = await res.json();
  const item = data.result.list[0];
  return { longAccount: parseFloat(item.buyRatio), shortAccount: parseFloat(item.sellRatio), ratio: parseFloat(item.buyRatio) / parseFloat(item.sellRatio) };
}

// Coba tiap sumber berurutan, sumber pertama yang sukses menang -- gak nge-throw kecuali SEMUA gagal.
async function tryInOrder(fns, label) {
  for (const fn of fns) {
    try {
      return await fn();
    } catch (e) {
      console.log(`[MarketSentiment] ${label}: 1 sumber gagal (${e.message.slice(0, 80)}), coba sumber berikutnya...`);
    }
  }
  console.log(`[MarketSentiment] ${label}: SEMUA sumber gagal, dilewatin.`);
  return null;
}

// Partial-OK by design -- tiap kategori independen, sebagian gagal TIDAK gugurin yang lain.
// Field yang gagal jadi null, caller (sniperOrderLog.js sentimentLines) WAJIB handle null per-field.
async function analyzeSentiment() {
  const [fearGreed, fundingAndOI, longShort] = await Promise.all([
    tryInOrder([fetchFearGreed], 'Fear & Greed'),
    tryInOrder([fetchFundingAndOI_OKX, fetchFundingAndOI_Bybit], 'Funding/OI'),
    tryInOrder([fetchLongShortRatio_OKX, fetchLongShortRatio_Bybit], 'Long/Short Ratio'),
  ]);
  return {
    fearGreed,
    funding: fundingAndOI ? { rate: fundingAndOI.rate, nextFundingTime: fundingAndOI.nextFundingTime } : null,
    openInterest: fundingAndOI ? { openInterest: fundingAndOI.openInterest } : null,
    longShort,
  };
}

module.exports = {
  fetchFearGreed, fetchFundingAndOI_OKX, fetchFundingAndOI_Bybit,
  fetchLongShortRatio_OKX, fetchLongShortRatio_Bybit, analyzeSentiment,
};

if (require.main === module) {
  analyzeSentiment('BTCUSDT').then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => {
    console.error('ERROR marketSentiment.js:', e.message);
    process.exit(1);
  });
}
