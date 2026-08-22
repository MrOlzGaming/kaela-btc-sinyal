// Eksekusi order REAL di Binance Futures (22 Agu 2026, permintaan Olan: "eksekusi sinyal Kaela
// donk, semua sesuai exposure juga"). Zero dependency (Node crypto+fetch bawaan, gak npm install)
// -- konsisten sama seluruh proyek ini. TESTNET dulu WAJIB (lihat killSwitch.js) sebelum modal asli.
//
// PENTING -- BATAS TANGGUNG JAWAB: modul ini CUMA nempelin order sesuai angka yang UDAH dihitung
// calculator.js (exposure/leverage/margin) -- gak ada keputusan trading APAPUN di sini, murni
// eksekusi mekanis. API key WAJIB "disable withdrawal" + IP-whitelist (Olan yang setup sendiri di
// Binance, Kaela gak pernah pegang/liat key aslinya -- cuma baca dari GitHub Secrets pas runtime,
// sama pola kayak FONNTE_TOKEN).

const crypto = require('crypto');

function loadSecrets() {
  try {
    return require('./secrets');
  } catch {
    return {
      BINANCE_API_KEY: process.env.BINANCE_API_KEY,
      BINANCE_API_SECRET: process.env.BINANCE_API_SECRET,
    };
  }
}

function baseUrl() {
  const { isTestnet } = require('./killSwitch');
  return isTestnet() ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com';
}

function sign(queryString, secret) {
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

async function signedRequest(method, path, params = {}) {
  const secrets = loadSecrets();
  if (!secrets.BINANCE_API_KEY || !secrets.BINANCE_API_SECRET) {
    throw new Error('BINANCE_API_KEY/BINANCE_API_SECRET belum di-setup (secrets.js atau env var) -- gak bisa eksekusi order real.');
  }
  const query = new URLSearchParams({ ...params, timestamp: Date.now(), recvWindow: 5000 }).toString();
  const signature = sign(query, secrets.BINANCE_API_SECRET);
  const url = `${baseUrl()}${path}?${query}&signature=${signature}`;

  const res = await fetch(url, {
    method,
    headers: { 'X-MBX-APIKEY': secrets.BINANCE_API_KEY },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Binance API error (HTTP ${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

// ============ Info simbol (precision/stepSize) -- WAJIB dicek sebelum kirim quantity, Binance
// nolak order kalau jumlah desimalnya gak sesuai aturan tiap simbol. ============
let symbolInfoCache = null;
async function getSymbolInfo(symbol) {
  if (!symbolInfoCache) {
    const res = await fetch(`${baseUrl()}/fapi/v1/exchangeInfo`);
    const data = await res.json();
    symbolInfoCache = {};
    for (const s of data.symbols) symbolInfoCache[s.symbol] = s;
  }
  const info = symbolInfoCache[symbol];
  if (!info) throw new Error(`Simbol ${symbol} gak ketemu di exchangeInfo Binance Futures.`);
  const lotSizeFilter = info.filters.find((f) => f.filterType === 'LOT_SIZE');
  const stepSize = parseFloat(lotSizeFilter.stepSize);
  const quantityPrecision = info.quantityPrecision;
  return { stepSize, quantityPrecision, pricePrecision: info.pricePrecision };
}

// Bulatin quantity ke stepSize simbol -- WAJIB, order dengan presisi salah otomatis DITOLAK Binance.
function roundToStepSize(quantity, stepSize, precision) {
  const rounded = Math.floor(quantity / stepSize) * stepSize;
  return parseFloat(rounded.toFixed(precision));
}

// ============ Fungsi publik ============

async function getAccountBalance() {
  const balances = await signedRequest('GET', '/fapi/v2/balance', {});
  const usdt = balances.find((b) => b.asset === 'USDT');
  return usdt ? parseFloat(usdt.availableBalance) : 0;
}

async function setLeverage(symbol, leverage) {
  return signedRequest('POST', '/fapi/v1/leverage', { symbol, leverage });
}

// Entry MARKET order. `notionalUsd` = nilai posisi dalam USD (hasil calculator.js `nilaiPosisi`),
// dikonversi ke quantity base-asset (BTC/dst) pakai harga live, dibulatin ke stepSize simbol.
async function placeMarketEntry({ symbol, direction, notionalUsd, livePrice }) {
  const { stepSize, quantityPrecision } = await getSymbolInfo(symbol);
  const rawQuantity = notionalUsd / livePrice;
  const quantity = roundToStepSize(rawQuantity, stepSize, quantityPrecision);
  if (quantity <= 0) throw new Error(`Quantity kehitung 0 buat ${symbol} (notional $${notionalUsd} kekecilan buat stepSize ${stepSize}) -- order gak dikirim.`);

  const side = direction === 'buy' ? 'BUY' : 'SELL';
  return signedRequest('POST', '/fapi/v1/order', { symbol, side, type: 'MARKET', quantity });
}

// SL/TP sebagai order EXCHANGE-NATIVE (STOP_MARKET/TAKE_PROFIT_MARKET, reduceOnly=true) -- tetap
// eksekusi walau server/internet kita lagi mati, gak nunggu monitoring manual.
async function placeStopLoss({ symbol, direction, stopPrice, quantity }) {
  const closeSide = direction === 'buy' ? 'SELL' : 'BUY'; // order penutup arahnya KEBALIKAN dari entry
  const { pricePrecision } = await getSymbolInfo(symbol);
  return signedRequest('POST', '/fapi/v1/order', {
    symbol, side: closeSide, type: 'STOP_MARKET',
    stopPrice: stopPrice.toFixed(pricePrecision), quantity, reduceOnly: true,
  });
}

async function placeTakeProfit({ symbol, direction, tpPrice, quantity }) {
  const closeSide = direction === 'buy' ? 'SELL' : 'BUY';
  const { pricePrecision } = await getSymbolInfo(symbol);
  return signedRequest('POST', '/fapi/v1/order', {
    symbol, side: closeSide, type: 'TAKE_PROFIT_MARKET',
    stopPrice: tpPrice.toFixed(pricePrecision), quantity, reduceOnly: true,
  });
}

async function getPositionRisk(symbol) {
  const positions = await signedRequest('GET', '/fapi/v2/positionRisk', { symbol });
  return positions[0] || null;
}

async function cancelAllOpenOrders(symbol) {
  return signedRequest('DELETE', '/fapi/v1/allOpenOrders', { symbol });
}

module.exports = {
  getAccountBalance, setLeverage, placeMarketEntry, placeStopLoss, placeTakeProfit,
  getPositionRisk, cancelAllOpenOrders, getSymbolInfo, roundToStepSize,
};
