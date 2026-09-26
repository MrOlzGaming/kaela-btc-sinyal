// Eksekusi order di Bitget USDT-M Futures (26 Sep 2026, gantiin rencana Bybit buat leg Fixed-TP
// twin-position Emas -- lihat goldTwinPosition.js). Struktur/interface SENGAJA disamain PERSIS
// bybitExecutor.js/mexcExecutor.js (factory createBitgetClient({apiKey,apiSecret,passphrase}),
// fungsi sama nama) -- caller bisa tukar exec tanpa ubah logic, cuma beda require().
//
// ⚠️ KENAPA GANTI DARI BYBIT (26 Sep 2026, dites EMPIRIS): Bybit TERNYATA gak punya produk Emas
// SAMA SEKALI (nol simbol PAXG/XAU/GOLD di /v5/market/instruments-info, category linear MAUPUN
// inverse) -- rencana awal salah asumsi. Bitget PUNYA (PAXGUSDT, XAUTUSDT, XAUUSDT, semua
// symbolStatus "normal", dicek 26 Sep 2026 via /api/v2/mix/market/contracts).
//
// ⚠️ DEMO TRADING BITGET GAK COVER EMAS: productType SUSDT-FUTURES (demo) cuma punya 3 simbol
// (SBTCSUSDT/SETHSUSDT/SXRPSUSDT), TIDAK ADA gold sama sekali (dites empiris 26 Sep 2026). Beda
// dari Bybit's Demo Trading yang genuinely gak ada gold-nya JUGA -- kesimpulannya: TIDAK ADA
// exchange manapun yang nawarin demo-trading BENERAN buat Emas. Fase "paper" evaluasi Fixed-TP
// leg Emas WAJIB simulasi lokal murni (lihat goldTwinPosition.js paperLeg()), BUKAN demo exchange
// asli -- ini beda dari Ninja (BingX) yang demo-nya genuinely exchange asli.
//
// Auth: HMAC-SHA256, base64 (BUKAN hex kayak Bybit/BingX), prehash = timestamp+method+requestPath
// (+queryString kalau GET, +body JSON string kalau POST). Header ACCESS-KEY/ACCESS-SIGN/
// ACCESS-TIMESTAMP/ACCESS-PASSPHRASE (WAJIB, beda dari Binance/BingX/Bybit/MEXC yang cuma 2 field
// -- Bitget butuh passphrase TAMBAHAN yang di-set pas bikin API key, BUKAN dipakai buat sign HMAC
// itu sendiri, cuma header terpisah).
//
// ⚠️ Position mode BELUM dites empiris buka/tutup order beneran -- kode ini ASUMSI one-way mode
// (gak kirim tradeSide, side buy/sell langsung). Kalau ternyata hedge mode, placeMarketEntry/
// emergencyCloseMarket butuh param tradeSide (open/close) tambahan.

const crypto = require('crypto');

const PRODUCT_TYPE = 'USDT-FUTURES';
const MARGIN_COIN = 'USDT';

function loadSecrets() {
  try {
    return require('./secrets');
  } catch {
    return {
      BITGET_API_KEY: process.env.BITGET_API_KEY,
      BITGET_API_SECRET: process.env.BITGET_API_SECRET,
      BITGET_API_PASSPHRASE: process.env.BITGET_API_PASSPHRASE,
    };
  }
}

function roundToStepSize(quantity, stepSize, precision) {
  const rounded = Math.floor(quantity / stepSize) * stepSize;
  return parseFloat(rounded.toFixed(precision));
}

function createBitgetClient({ apiKey, apiSecret, passphrase }) {
  if (!apiKey || !apiSecret || !passphrase) {
    throw new Error('createBitgetClient: apiKey/apiSecret/passphrase wajib diisi.');
  }
  const baseUrl = 'https://api.bitget.com'; // SATU domain -- gak ada demo/testnet domain terpisah kayak Bybit
  let symbolInfoCache = null;

  function sign(prehash) {
    return crypto.createHmac('sha256', apiSecret).update(prehash).digest('base64');
  }

  async function signedGet(path, params = {}) {
    const qs = Object.keys(params).length ? '?' + Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&') : '';
    const timestamp = Date.now().toString();
    const prehash = timestamp + 'GET' + path + qs;
    const signature = sign(prehash);
    const res = await fetch(baseUrl + path + qs, {
      headers: {
        'ACCESS-KEY': apiKey, 'ACCESS-SIGN': signature, 'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': passphrase, 'Content-Type': 'application/json', locale: 'en-US',
      },
    });
    const data = await res.json();
    if (data.code !== '00000') {
      const err = new Error(`Bitget API error (code ${data.code}): ${data.msg}`);
      err.bitgetCode = data.code;
      throw err;
    }
    return data.data;
  }

  async function signedPost(path, body = {}) {
    const bodyStr = JSON.stringify(body);
    const timestamp = Date.now().toString();
    const prehash = timestamp + 'POST' + path + bodyStr;
    const signature = sign(prehash);
    const res = await fetch(baseUrl + path, {
      method: 'POST',
      headers: {
        'ACCESS-KEY': apiKey, 'ACCESS-SIGN': signature, 'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': passphrase, 'Content-Type': 'application/json', locale: 'en-US',
      },
      body: bodyStr,
    });
    const data = await res.json();
    if (data.code !== '00000') {
      const err = new Error(`Bitget API error (code ${data.code}): ${data.msg}`);
      err.bitgetCode = data.code;
      throw err;
    }
    return data.data;
  }

  async function getSymbolInfo(symbol) {
    if (!symbolInfoCache) {
      const res = await fetch(`${baseUrl}/api/v2/mix/market/contracts?productType=${PRODUCT_TYPE}`);
      const data = await res.json();
      symbolInfoCache = {};
      for (const c of data.data) symbolInfoCache[c.symbol] = c;
    }
    const info = symbolInfoCache[symbol];
    if (!info) throw new Error(`Simbol ${symbol} gak ketemu di contracts Bitget.`);
    const stepStr = info.volumePlace != null ? info.volumePlace : '3';
    const stepSize = Math.pow(10, -Number(stepStr));
    return {
      stepSize, quantityPrecision: Number(stepStr), pricePrecision: Number(info.pricePlace || 2),
      minNotionalUsd: parseFloat(info.minTradeUSDT || '5'),
    };
  }

  async function getAccountBalance() {
    const result = await signedGet('/api/v2/mix/account/accounts', { productType: PRODUCT_TYPE });
    const acct = (result || []).find((a) => a.marginCoin === MARGIN_COIN);
    return acct ? parseFloat(acct.available) : 0;
  }

  async function getWalletBalance() {
    const result = await signedGet('/api/v2/mix/account/accounts', { productType: PRODUCT_TYPE });
    const acct = (result || []).find((a) => a.marginCoin === MARGIN_COIN);
    return acct ? parseFloat(acct.accountEquity) : 0;
  }

  async function setIsolatedMargin(symbol) {
    return signedPost('/api/v2/mix/account/set-margin-mode', { symbol, productType: PRODUCT_TYPE, marginCoin: MARGIN_COIN, marginMode: 'isolated' });
  }

  async function setLeverage(symbol, leverage) {
    return signedPost('/api/v2/mix/account/set-leverage', { symbol, productType: PRODUCT_TYPE, marginCoin: MARGIN_COIN, leverage: String(leverage) });
  }

  async function placeMarketEntry({ symbol, direction, notionalUsd, livePrice }) {
    const { stepSize, quantityPrecision } = await getSymbolInfo(symbol);
    const rawQuantity = notionalUsd / livePrice;
    const size = roundToStepSize(rawQuantity, stepSize, quantityPrecision);
    if (size <= 0) throw new Error(`Quantity kehitung 0 buat ${symbol} (notional $${notionalUsd} kekecilan buat stepSize ${stepSize}) -- order gak dikirim.`);
    const side = direction === 'buy' ? 'buy' : 'sell';
    const placed = await signedPost('/api/v2/mix/order/place-order', {
      symbol, productType: PRODUCT_TYPE, marginMode: 'isolated', marginCoin: MARGIN_COIN,
      size: String(size), side, orderType: 'market',
    });
    return { orderId: placed.orderId, clientOid: placed.clientOid, executedQty: String(size) };
  }

  async function getPositionRisk(symbol) {
    const result = await signedGet('/api/v2/mix/position/single-position', { symbol, productType: PRODUCT_TYPE, marginCoin: MARGIN_COIN });
    return (result || [])[0] || null;
  }

  async function getAllPositions() {
    const result = await signedGet('/api/v2/mix/position/all-position', { productType: PRODUCT_TYPE, marginCoin: MARGIN_COIN });
    return (result || []).filter((p) => Math.abs(parseFloat(p.total || p.available || 0)) > 0);
  }

  // TUTUP posisi -- `direction` = arah POSISI ASLI, side dibalik. reduceOnly:"YES" (one-way mode).
  async function emergencyCloseMarket({ symbol, direction, quantity }) {
    const closeSide = direction === 'buy' ? 'sell' : 'buy';
    return signedPost('/api/v2/mix/order/place-order', {
      symbol, productType: PRODUCT_TYPE, marginMode: 'isolated', marginCoin: MARGIN_COIN,
      size: String(quantity), side: closeSide, orderType: 'market', reduceOnly: 'YES',
    });
  }

  async function cancelAllOpenOrders(symbol) {
    return signedPost('/api/v2/mix/order/cancel-all-orders', { symbol, productType: PRODUCT_TYPE });
  }

  return {
    getAccountBalance, getWalletBalance, setLeverage, setIsolatedMargin, placeMarketEntry,
    getPositionRisk, getAllPositions, cancelAllOpenOrders, getSymbolInfo, roundToStepSize,
    emergencyCloseMarket,
  };
}

module.exports = { createBitgetClient, loadSecrets, roundToStepSize };
