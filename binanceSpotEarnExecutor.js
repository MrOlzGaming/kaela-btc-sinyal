// Eksekutor SPOT + Simple Earn Flexible Binance (25 Agu 2026, permintaan Olan buat Compound Alt
// DCA -- beli 10 koin SPOT beneran, BUKAN futures/leverage kayak binanceExecutor.js yang udah ada
// sekalian). Namespace API-nya TOTAL BEDA dari futures (fapi/v1) -- ini pakai api/v3 (spot) +
// sapi/v1/simple-earn (Earn), base URL https://api.binance.com.
//
// Kenapa butuh Earn juga: Olan cerita "dolarku kalo diem lama masuk Earn otomatis" (auto-subscribe
// Binance) -- jadi urutan ambil dana WAJIB: cek Spot dulu, kalau kurang REDEEM dari Simple Earn
// Flexible secukupnya buat nutup kekurangan, BARU eksekusi beli. Ini nyentuh dana REAL member --
// WAJIB dites step-by-step (saldo -> exchangeInfo -> redeem kecil -> order kecil) pakai API key
// Olan sendiri SEBELUM dipercaya jalan otomatis buat member lain, PERSIS pola binanceExecutor.js/
// mexcExecutor.js dulu pas awal dibangun -- JANGAN dianggap siap produksi cuma dari baca kode ini.
//
// ⚠️ Endpoint Simple Earn (sapi/v1/simple-earn/flexible/position + redeem) disusun dari dokumentasi
// resmi Binance yang kebaca (binance-docs.github.io/apidocs/spot/en/#simple-earn-endpoints), BELUM
// divalidasi hit langsung. Param yang PALING perlu diverifikasi pas tes pertama: field respons
// position (apa beneran `totalAmount` per row, atau field lain), dan apakah redeem butuh
// `redeemAll` (produk fixed) vs `amount` (flexible, yang dipakai di sini) -- kode di bawah asumsi
// jalur FLEXIBLE (redeem sebagian by amount), BUKAN locked/fixed-term Earn.

const crypto = require('crypto');

function loadSecrets() {
  try {
    return require('./secrets');
  } catch {
    return { BINANCE_API_KEY: process.env.BINANCE_API_KEY, BINANCE_API_SECRET: process.env.BINANCE_API_SECRET };
  }
}

function roundToStepSize(quantity, stepSize, precision) {
  const rounded = Math.floor(quantity / stepSize) * stepSize;
  return parseFloat(rounded.toFixed(precision));
}

// testnet (29 Agu 2026, permintaan Olan: "Compound Alt harus demo dulu kayak Sniper/Nyopet") --
// Spot Testnet itu SISTEM TERPISAH TOTAL dari Demo Futures yang udah dipakai Sniper/Nyopet
// (demo-fapi.binance.com) -- base URL beda (testnet.binance.vision), akun/saldo/API key BEDA,
// daftar lewat login GitHub di testnet.binance.vision (bukan akun Binance biasa). Simple Earn
// TIDAK ADA di testnet (produk Earn cuma di mainnet) -- ensureSpotBalance/redeem otomatis
// di-skip kalau testnet=true, langsung asumsi saldo Spot testnet cukup (dari faucet).
function createBinanceSpotEarnClient({ apiKey, apiSecret, testnet }) {
  if (!apiKey || !apiSecret) throw new Error('createBinanceSpotEarnClient: apiKey/apiSecret wajib diisi.');
  const baseUrl = testnet ? 'https://testnet.binance.vision' : 'https://api.binance.com';
  let symbolInfoCache = null;

  function sign(queryString) {
    return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
  }

  async function signedRequest(method, path, params = {}) {
    const qs = new URLSearchParams({ ...params, timestamp: Date.now(), recvWindow: 10000 }).toString();
    const signature = sign(qs);
    const url = `${baseUrl}${path}?${qs}&signature=${signature}`;
    const res = await fetch(url, { method, headers: { 'X-MBX-APIKEY': apiKey } });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(`Binance Spot/Earn API error (HTTP ${res.status}): ${JSON.stringify(data)}`);
      err.binanceCode = data.code;
      throw err;
    }
    return data;
  }

  async function getSpotBalance(asset = 'USDT') {
    const account = await signedRequest('GET', '/api/v3/account', {});
    const bal = (account.balances || []).find((b) => b.asset === asset);
    return bal ? parseFloat(bal.free) : 0;
  }

  // Daftar posisi Earn Flexible buat 1 asset -- BISA lebih dari 1 productId per asset (jarang,
  // tapi mungkin), jadi balikin array, caller yang putusin mau redeem yang mana/berapa banyak.
  async function getEarnFlexiblePositions(asset = 'USDT') {
    const res = await signedRequest('GET', '/sapi/v1/simple-earn/flexible/position', { asset });
    return (res.rows || []).map((r) => ({ productId: r.productId, asset: r.asset, totalAmount: parseFloat(r.totalAmount) }));
  }

  async function redeemEarnFlexible(productId, amount) {
    return signedRequest('POST', '/sapi/v1/simple-earn/flexible/redeem', { productId, amount, destAccount: 'SPOT' });
  }

  // Pastiin saldo Spot cukup: cek Spot dulu, kalau kurang redeem dari Earn Flexible secukupnya
  // (bisa dari >1 posisi kalau 1 posisi gak cukup), tunggu sampai saldo Spot ke-update (polling,
  // redeem Flexible BIASANYA cepat tapi gak instan-instan-banget di sisi ledger).
  async function ensureSpotBalance(neededAmount, asset = 'USDT') {
    let spotBal = await getSpotBalance(asset);
    if (spotBal >= neededAmount) return { source: 'spot', redeemedTotal: 0, spotBalance: spotBal };
    if (testnet) throw new Error(`Saldo Spot Testnet ${asset} kurang ($${spotBal.toFixed(2)} < $${neededAmount}) -- testnet gak punya Simple Earn buat di-redeem, minta faucet lagi di testnet.binance.vision.`);

    let shortfall = neededAmount - spotBal;
    const positions = await getEarnFlexiblePositions(asset);
    if (!positions.length) throw new Error(`Saldo Spot ${asset} kurang ($${spotBal.toFixed(2)} < $${neededAmount}) dan gak ada posisi Earn Flexible buat di-redeem.`);

    let redeemedTotal = 0;
    for (const pos of positions) {
      if (shortfall <= 0) break;
      const redeemAmount = Math.min(pos.totalAmount, shortfall);
      if (redeemAmount <= 0) continue;
      await redeemEarnFlexible(pos.productId, redeemAmount);
      redeemedTotal += redeemAmount;
      shortfall -= redeemAmount;
    }
    if (shortfall > 0) throw new Error(`Redeem Earn Flexible gak cukup nutup kekurangan (masih kurang $${shortfall.toFixed(2)}).`);

    // Polling saldo Spot sampai ke-update (maks ~30 detik, 6x cek @5 detik).
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      spotBal = await getSpotBalance(asset);
      if (spotBal >= neededAmount) return { source: 'earn', redeemedTotal, spotBalance: spotBal };
    }
    throw new Error(`Redeem Earn udah dikirim ($${redeemedTotal.toFixed(2)}) tapi saldo Spot belum ke-update setelah 30 detik -- cek manual sebelum lanjut beli.`);
  }

  async function getSymbolInfo(symbol) {
    if (!symbolInfoCache) symbolInfoCache = {};
    if (!symbolInfoCache[symbol]) {
      const res = await fetch(`${baseUrl}/api/v3/exchangeInfo?symbol=${symbol}`);
      const json = await res.json();
      const info = (json.symbols || [])[0];
      if (!info) throw new Error(`Simbol ${symbol} gak ketemu di exchangeInfo Binance Spot.`);
      const lotSize = info.filters.find((f) => f.filterType === 'LOT_SIZE');
      const notional = info.filters.find((f) => f.filterType === 'NOTIONAL' || f.filterType === 'MIN_NOTIONAL');
      symbolInfoCache[symbol] = {
        stepSize: parseFloat(lotSize.stepSize), baseAssetPrecision: info.baseAssetPrecision,
        minNotional: notional ? parseFloat(notional.minNotional || notional.notional) : 0,
      };
    }
    return symbolInfoCache[symbol];
  }

  // Beli spot pakai quoteOrderQty (nominal USDT langsung, Binance yang itung base qty-nya sendiri
  // -- lebih aman dari salah pembulatan manual ketimbang itung quantity dari livePrice sendiri).
  async function placeSpotMarketBuy({ symbol, quoteOrderQty }) {
    const order = await signedRequest('POST', '/api/v3/order', { symbol, side: 'BUY', type: 'MARKET', quoteOrderQty });
    const executedQty = parseFloat(order.executedQty);
    const cumulativeQuote = parseFloat(order.cummulativeQuoteQty);
    const avgPrice = executedQty > 0 ? cumulativeQuote / executedQty : 0;
    return { orderId: order.orderId, executedQty, cumulativeQuote, avgPrice };
  }

  async function placeSpotMarketSell({ symbol, quantity }) {
    const { stepSize, baseAssetPrecision } = await getSymbolInfo(symbol);
    const roundedQty = roundToStepSize(quantity, stepSize, baseAssetPrecision);
    if (roundedQty <= 0) throw new Error(`Quantity ${quantity} ${symbol} kebulet jadi 0 setelah step-size rounding -- order gak dikirim.`);
    const order = await signedRequest('POST', '/api/v3/order', { symbol, side: 'SELL', type: 'MARKET', quantity: roundedQty });
    const executedQty = parseFloat(order.executedQty);
    const cumulativeQuote = parseFloat(order.cummulativeQuoteQty);
    const avgPrice = executedQty > 0 ? cumulativeQuote / executedQty : 0;
    return { orderId: order.orderId, executedQty, cumulativeQuote, avgPrice };
  }

  return { getSpotBalance, getEarnFlexiblePositions, redeemEarnFlexible, ensureSpotBalance, getSymbolInfo, placeSpotMarketBuy, placeSpotMarketSell };
}

module.exports = { createBinanceSpotEarnClient, roundToStepSize };
