// Eksekusi order REAL di MEXC Futures (25 Agu 2026, permintaan Olan: spesialisasi alt-coin, MEXC
// dipilih krn cakupan pair jauh lebih luas dari Binance). Interface SENGAJA DISAMAIN persis kayak
// binanceExecutor.js (createXClient({apiKey,apiSecret}) -> {getAccountBalance, setLeverage,
// placeMarketEntry, ...}) biar bisa jadi drop-in client buat logic Sniper yang udah ada (mirror
// pattern sniperMultiAccount.js), gak perlu nulis ulang strategi.
//
// ⚠️ BELUM PERNAH DITES LIVE (25 Agu 2026) -- dibangun dari dokumentasi resmi
// (mexcdevelop.github.io/apidocs/contract_v1_en/) doang, BELUM divalidasi hit endpoint beneran
// (butuh API key MEXC Olan yang udah KYC+izin Futures). WAJIB dites step-by-step (saldo -> symbol
// info -> order kecil) sebelum dipercaya buat modal beneran, SAMA PERSIS kayak binanceExecutor.js
// dulu pas awal dibangun. Beberapa asumsi yang PERLU diverifikasi pas tes pertama:
//   - Base URL: https://contract.mexc.com (pola umum MEXC, belum dikonfirmasi hit langsung)
//   - Bentuk response GET /api/v1/private/account/assets (field currency/availableBalance)
//   - Format signature buat GET (requestParam = querystring TANPA leading '?', sorted alfabetis)
//   - MEXC gak punya SL/TP sbg order terpisah (STOP_MARKET) di dokumentasi yang kebaca -- jadi
//     stopLossPrice/takeProfitPrice WAJIB dikirim BARENGAN pas placeMarketEntry (bukan panggilan
//     terpisah kayak Binance placeStopLoss/placeTakeProfit) -- 2 fungsi itu sengaja throw error
//     kalau dipanggil, biar gak ada yang diam-diam nebak endpoint yang belum diverifikasi.

const crypto = require('crypto');

function loadSecrets() {
  try {
    return require('./secrets');
  } catch {
    return {
      MEXC_API_KEY: process.env.MEXC_API_KEY,
      MEXC_API_SECRET: process.env.MEXC_API_SECRET,
    };
  }
}

function roundToStepSize(quantity, stepSize, precision) {
  const rounded = Math.floor(quantity / stepSize) * stepSize;
  return parseFloat(rounded.toFixed(precision));
}

function createMexcClient({ apiKey, apiSecret }) {
  if (!apiKey || !apiSecret) {
    throw new Error('createMexcClient: apiKey/apiSecret wajib diisi.');
  }
  const baseUrl = 'https://contract.mexc.com';
  let symbolInfoCache = null;

  // Signature MEXC BEDA dari Binance -- bukan HMAC atas querystring, tapi HMAC atas
  // "accessKey + timestamp + requestParam" (requestParam: querystring buat GET/DELETE,
  // JSON.stringify(params) mentah buat POST, gak perlu sort).
  function sign(timestamp, requestParam) {
    return crypto.createHmac('sha256', apiSecret).update(apiKey + timestamp + requestParam).digest('hex');
  }

  async function signedRequest(method, path, params = {}) {
    const timestamp = Date.now().toString();
    let url = `${baseUrl}${path}`;
    let body;
    let requestParam;
    if (method === 'GET' || method === 'DELETE') {
      const sorted = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
      requestParam = sorted;
      if (sorted) url += `?${sorted}`;
    } else {
      requestParam = JSON.stringify(params);
      body = requestParam;
    }
    const signature = sign(timestamp, requestParam);
    const res = await fetch(url, {
      method,
      headers: { ApiKey: apiKey, 'Request-Time': timestamp, Signature: signature, 'Content-Type': 'application/json' },
      body,
    });
    const data = await res.json();
    if (!res.ok || data.success === false) {
      const err = new Error(`MEXC API error (HTTP ${res.status}): ${JSON.stringify(data)}`);
      err.mexcCode = data.code;
      throw err;
    }
    return data.data !== undefined ? data.data : data;
  }

  async function getSymbolInfo(symbol) {
    if (!symbolInfoCache) symbolInfoCache = {};
    if (!symbolInfoCache[symbol]) {
      const res = await fetch(`${baseUrl}/api/v1/contract/detail?symbol=${symbol}`);
      const json = await res.json();
      const info = json.data;
      if (!info) throw new Error(`Simbol ${symbol} gak ketemu di contract/detail MEXC.`);
      symbolInfoCache[symbol] = {
        contractSize: parseFloat(info.contractSize), volScale: info.volScale,
        priceScale: info.priceScale, minVol: parseFloat(info.minVol),
      };
    }
    return symbolInfoCache[symbol];
  }

  // asset default 'USDT' -- konsisten sama binanceExecutor.js.
  async function getAccountBalance(asset = 'USDT') {
    const assets = await signedRequest('GET', '/api/v1/private/account/assets', {});
    const bal = (Array.isArray(assets) ? assets : []).find((a) => a.currency === asset);
    return bal ? parseFloat(bal.availableBalance) : 0;
  }

  // Dipanggil SEBELUM ada posisi -- MEXC butuh openType+positionType eksplisit di kasus ini
  // (beda dari Binance yang cukup symbol+leverage). direction: 'buy'=long(1), 'sell'=short(2).
  async function setLeverage(symbol, leverage, direction = 'buy') {
    const positionType = direction === 'buy' ? 1 : 2;
    return signedRequest('POST', '/api/v1/private/position/change_leverage', {
      symbol, leverage, openType: 1, positionType,
    });
  }

  // Isolated margin SELALU dipasang eksplisit tiap order (openType:1 di submit), gak ada langkah
  // terpisah kayak Binance /fapi/v1/marginType -- fungsi ini no-op, disediakan cuma buat interface
  // parity (caller lama yang manggil setIsolatedMargin() gak perlu tau bedanya per-exchange).
  async function setIsolatedMargin(_symbol) {
    return { alreadyIsolated: true };
  }

  // notionalUsd -> vol (jumlah kontrak) lewat contractSize (BEDA dari Binance: quantity di sana
  // langsung base-asset, di sini vol dikali contractSize dulu buat dapet notional).
  // stopPrice/tpPrice OPSIONAL, dikirim LANGSUNG di order submit (MEXC support stopLossPrice/
  // takeProfitPrice attached) -- kalau caller mau nempel belakangan, panggil lagi endpoint ini
  // BUKAN placeStopLoss/placeTakeProfit terpisah (lihat catatan di atas kenapa).
  async function placeMarketEntry({ symbol, direction, notionalUsd, livePrice, leverage, stopPrice, tpPrice }) {
    const { contractSize, volScale, minVol } = await getSymbolInfo(symbol);
    const rawVol = notionalUsd / livePrice / contractSize;
    const vol = roundToStepSize(rawVol, Math.pow(10, -volScale), volScale);
    if (vol < minVol) throw new Error(`Vol kehitung ${vol} < minVol ${minVol} buat ${symbol} (notional $${notionalUsd} kekecilan) -- order gak dikirim.`);
    const side = direction === 'buy' ? 1 : 3; // 1=open long, 3=open short
    const params = { symbol, vol, side, type: 5, openType: 1, price: livePrice };
    if (leverage) params.leverage = leverage;
    if (stopPrice) params.stopLossPrice = stopPrice;
    if (tpPrice) params.takeProfitPrice = tpPrice;
    return signedRequest('POST', '/api/v1/private/order/submit', params);
  }

  // BELUM diimplementasi sbg panggilan terpisah -- lihat catatan ⚠️ di atas file. Kirim SL/TP
  // lewat placeMarketEntry({stopPrice, tpPrice}) pas entry, JANGAN nebak endpoint trigger-order
  // yang belum diverifikasi buat modal beneran.
  async function placeStopLoss() {
    throw new Error('mexcExecutor.placeStopLoss belum diimplementasi -- kirim stopPrice langsung ke placeMarketEntry() pas entry.');
  }
  async function placeTakeProfit() {
    throw new Error('mexcExecutor.placeTakeProfit belum diimplementasi -- kirim tpPrice langsung ke placeMarketEntry() pas entry.');
  }

  async function getPositionRisk(symbol) {
    const positions = await signedRequest('GET', '/api/v1/private/position/open_positions', { symbol });
    return (Array.isArray(positions) ? positions[0] : null) || null;
  }

  async function emergencyCloseMarket({ symbol, direction, vol }) {
    const side = direction === 'buy' ? 4 : 2; // close long=4, close short=2
    return signedRequest('POST', '/api/v1/private/order/submit', { symbol, vol, side, type: 5, openType: 1, reduceOnly: true });
  }

  async function cancelAllOpenOrders(symbol) {
    return signedRequest('POST', '/api/v1/private/order/cancel_all', { symbol });
  }

  return {
    getAccountBalance, setLeverage, setIsolatedMargin, placeMarketEntry, placeStopLoss, placeTakeProfit,
    getPositionRisk, cancelAllOpenOrders, getSymbolInfo, roundToStepSize, emergencyCloseMarket,
  };
}

module.exports = { createMexcClient, roundToStepSize };
