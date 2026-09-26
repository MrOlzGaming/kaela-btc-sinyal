// Eksekusi order di Bybit USDT Perpetual (Unified Trading Account/UTA), disiapin 26 Sep 2026
// buat Ninja TP Tetap (gantiin rencana akun BingX kedua -- BingX gak bisa 2 posisi independen 1
// symbol di 1 akun, lihat catatan ninjaTrader.js). Struktur/interface SENGAJA disamain PERSIS
// binanceExecutor.js/bingxExecutor.js (factory createBybitClient({apiKey,apiSecret,testnet}),
// fungsi sama nama) -- caller bisa tukar exec tanpa ubah logic, cuma beda require().
//
// ⚠️ TEMUAN PENTING (26 Sep 2026, dites EMPIRIS): Bybit BEDA dari BingX soal demo/real --
// BYBIT_API_KEY yang Olan kasih cuma valid di api.bybit.com (REAL, UTA, dites baca saldo OK).
// Dicoba juga ke api-demo.bybit.com (Bybit "Demo Trading", domain terpisah) -- HASIL: "API key is
// invalid" (retCode 10003). Jadi Bybit demo/real itu KREDENSIAL TERPISAH TOTAL, SAMA kayak
// Binance/MEXC -- BUKAN 1-key-2-mode kayak BingX. Kalau mau jalanin fase DEMO Ninja TP Tetap di
// Bybit, Olan WAJIB bikin API key BARU khusus dari toggle "Demo Trading" di web Bybit (beda key
// dari yang real ini), isi ke BYBIT_API_KEY_DEMO/BYBIT_API_SECRET_DEMO di secrets.js.
//
// Bedanya dari bingxExecutor.js:
//   - Base URL SELALU sama per key (api.bybit.com utk real, api-demo.bybit.com utk demo key
//     TERPISAH) -- parameter `testnet` di createBybitClient cuma nentuin base URL, TIDAK ada
//     logic "1 key 2 mode" kayak BingX (kalau testnet:true tapi key yang dikasih adalah key REAL,
//     request bakal gagal "API key is invalid" -- caller WAJIB pastiin key yang dioper cocok sama
//     domain yang dituju).
//   - Auth: V5 API, header X-BAPI-API-KEY/X-BAPI-SIGN/X-BAPI-SIGN-TYPE(2)/X-BAPI-TIMESTAMP/
//     X-BAPI-RECV-WINDOW. Sign payload = timestamp+apiKey+recvWindow+queryString(GET, urutan
//     APA ADANYA -- BEDA dari BingX yang wajib disortir alfabetis) atau +JSON.stringify(body)
//     (POST, RAW string, bukan query).
//   - `category: 'linear'` WAJIB di HAMPIR SEMUA endpoint V5 (order/posisi/saldo kalau UNIFIED).
//   - Symbol TANPA hyphen ("BTCUSDT", bukan "BTC-USDT" kayak BingX).
//   - Akun ini UNIFIED Trading Account (UTA) -- accountType WAJIB "UNIFIED" (dites empiris 26 Sep
//     2026: "CONTRACT" ditolak, "accountType only support UNIFIED"). marginMode akun =
//     REGULAR_MARGIN (cross, account-wide) per default -- ISOLATED per-symbol WAJIB di-set
//     eksplisit via /v5/position/switch-isolated sebelum entry pertama.
//   - Position mode: BELUM dites empiris buka/tutup order beneran (baru baca saldo/posisi/info
//     akun) -- kode ini ASUMSI one-way mode (positionIdx:0), PALING UMUM buat akun UTA baru yang
//     belum pernah diaktifin hedge mode manual. WAJIB verifikasi ulang (via /v5/position/list
//     abis 1x buka manual test, atau tanya Olan langsung) SEBELUM ninjaTrader.js beneran ngirim
//     order live -- kalau ternyata hedge mode, semua placeMarketEntry/emergencyCloseMarket di
//     bawah butuh positionIdx 1/2 (bukan 0), pola SAMA kayak BingX positionSide LONG/SHORT.
//   - Saldo REAL akun ini per 26 Sep 2026: ~$0.0004 (kosong/nganggur) -- order beneran bakal gagal
//     minNotional sampai Olan topup.

const crypto = require('crypto');

const KAELA_ORDER_PREFIX = 'kaela-';
function generateKaelaClientOrderId() {
  return `${KAELA_ORDER_PREFIX}${Date.now()}`;
}

function loadSecrets() {
  try {
    return require('./secrets');
  } catch {
    return {
      BYBIT_API_KEY: process.env.BYBIT_API_KEY,
      BYBIT_API_SECRET: process.env.BYBIT_API_SECRET,
      BYBIT_API_KEY_DEMO: process.env.BYBIT_API_KEY_DEMO,
      BYBIT_API_SECRET_DEMO: process.env.BYBIT_API_SECRET_DEMO,
    };
  }
}

function roundToStepSize(quantity, stepSize, precision) {
  const rounded = Math.floor(quantity / stepSize) * stepSize;
  return parseFloat(rounded.toFixed(precision));
}

function createBybitClient({ apiKey, apiSecret, testnet }) {
  if (!apiKey || !apiSecret) {
    throw new Error('createBybitClient: apiKey/apiSecret wajib diisi.');
  }
  // Bybit: base URL BEDA per KEY yang dipakai (key demo cuma jalan di api-demo, key real cuma
  // jalan di api.bybit.com) -- BUKAN 1 key nurut ke-2 base URL kayak BingX. `testnet` di sini
  // sekadar nentuin base URL yang DITUJU, caller wajib pastiin key-nya emang buat mode itu.
  const baseUrl = testnet ? 'https://api-demo.bybit.com' : 'https://api.bybit.com';
  const CATEGORY = 'linear';
  let symbolInfoCache = null;

  function sign(payload) {
    return crypto.createHmac('sha256', apiSecret).update(payload).digest('hex');
  }

  async function signedGet(path, params = {}) {
    const timestamp = Date.now().toString();
    const recvWindow = '5000';
    const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
    const signature = sign(timestamp + apiKey + recvWindow + qs);
    const url = `${baseUrl}${path}${qs ? '?' + qs : ''}`;
    const res = await fetch(url, {
      headers: {
        'X-BAPI-API-KEY': apiKey, 'X-BAPI-SIGN': signature, 'X-BAPI-SIGN-TYPE': '2',
        'X-BAPI-TIMESTAMP': timestamp, 'X-BAPI-RECV-WINDOW': recvWindow,
      },
    });
    const data = await res.json();
    if (data.retCode !== 0) {
      const err = new Error(`Bybit API error (retCode ${data.retCode}): ${data.retMsg}`);
      err.bybitCode = data.retCode;
      throw err;
    }
    return data.result;
  }

  async function signedPost(path, body = {}) {
    const timestamp = Date.now().toString();
    const recvWindow = '5000';
    const bodyStr = JSON.stringify(body);
    const signature = sign(timestamp + apiKey + recvWindow + bodyStr);
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'X-BAPI-API-KEY': apiKey, 'X-BAPI-SIGN': signature, 'X-BAPI-SIGN-TYPE': '2',
        'X-BAPI-TIMESTAMP': timestamp, 'X-BAPI-RECV-WINDOW': recvWindow,
        'Content-Type': 'application/json',
      },
      body: bodyStr,
    });
    const data = await res.json();
    if (data.retCode !== 0) {
      const err = new Error(`Bybit API error (retCode ${data.retCode}): ${data.retMsg}`);
      err.bybitCode = data.retCode;
      throw err;
    }
    return data.result;
  }

  async function getSymbolInfo(symbol) {
    if (!symbolInfoCache) {
      const res = await fetch(`${baseUrl}/v5/market/instruments-info?category=${CATEGORY}`);
      const data = await res.json();
      symbolInfoCache = {};
      for (const s of data.result.list) symbolInfoCache[s.symbol] = s;
    }
    const info = symbolInfoCache[symbol];
    if (!info) throw new Error(`Simbol ${symbol} gak ketemu di instruments-info Bybit.`);
    const stepSize = parseFloat(info.lotSizeFilter.qtyStep);
    const decimalPart = info.lotSizeFilter.qtyStep.split('.')[1];
    return {
      stepSize,
      quantityPrecision: decimalPart ? decimalPart.length : 0,
      pricePrecision: info.priceFilter.tickSize.includes('.') ? info.priceFilter.tickSize.split('.')[1].length : 0,
      minNotionalUsd: parseFloat(info.lotSizeFilter.minNotionalValue || '5'),
    };
  }

  // UTA cuma dukung accountType=UNIFIED (dites empiris 26 Sep 2026 -- CONTRACT ditolak). Balikin
  // `totalAvailableBalance` (analog availableMargin BingX/availableBalance Binance).
  async function getAccountBalance() {
    const result = await signedGet('/v5/account/wallet-balance', { accountType: 'UNIFIED' });
    const acct = (result.list || [])[0];
    return acct ? parseFloat(acct.totalAvailableBalance) : 0;
  }

  async function getWalletBalance() {
    const result = await signedGet('/v5/account/wallet-balance', { accountType: 'UNIFIED' });
    const acct = (result.list || [])[0];
    return acct ? parseFloat(acct.totalWalletBalance) : 0;
  }

  async function setIsolatedMargin(symbol, leverage) {
    return signedPost('/v5/position/switch-isolated', {
      category: CATEGORY, symbol, tradeMode: 1,
      buyLeverage: String(leverage), sellLeverage: String(leverage),
    });
  }

  async function setLeverage(symbol, leverage) {
    return signedPost('/v5/position/set-leverage', {
      category: CATEGORY, symbol, buyLeverage: String(leverage), sellLeverage: String(leverage),
    });
  }

  // ⚠️ ASUMSI one-way mode (positionIdx:0) -- BELUM dites empiris buka order beneran, lihat
  // catatan header file. Kalau ternyata hedge mode, WAJIB positionIdx 1 (Buy)/2 (Sell).
  async function placeMarketEntry({ symbol, direction, notionalUsd, livePrice }) {
    const { stepSize, quantityPrecision } = await getSymbolInfo(symbol);
    const rawQuantity = notionalUsd / livePrice;
    const quantity = roundToStepSize(rawQuantity, stepSize, quantityPrecision);
    if (quantity <= 0) throw new Error(`Quantity kehitung 0 buat ${symbol} (notional $${notionalUsd} kekecilan buat stepSize ${stepSize}) -- order gak dikirim.`);
    const side = direction === 'buy' ? 'Buy' : 'Sell';
    const order = await signedPost('/v5/order/create', {
      category: CATEGORY, symbol, side, orderType: 'Market', qty: String(quantity),
      positionIdx: 0, orderLinkId: generateKaelaClientOrderId(),
    });
    return waitForFill(symbol, order.orderId);
  }

  // Bybit gak balikin status FILLED langsung di response create (beda dari BingX) -- WAJIB
  // polling /v5/order/history atau /v5/execution/list. Pola SAMA kayak binanceExecutor.js.
  async function waitForFill(symbol, orderId, attempts = 6, delayMs = 400) {
    for (let i = 0; i < attempts; i++) {
      const result = await signedGet('/v5/order/history', { category: CATEGORY, symbol, orderId }).catch(() => null);
      const order = result && (result.list || [])[0];
      if (order && order.orderStatus === 'Filled' && parseFloat(order.cumExecQty) > 0) return order;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    throw new Error(`Order ${orderId} (${symbol}) belum Filled setelah ${attempts}x cek -- cek manual via getPositionRisk sebelum lanjut apapun.`);
  }

  async function getPositionRisk(symbol) {
    const result = await signedGet('/v5/position/list', { category: CATEGORY, symbol });
    return (result.list || [])[0] || null;
  }

  async function getAllPositions() {
    const result = await signedGet('/v5/position/list', { category: CATEGORY, settleCoin: 'USDT' });
    return (result.list || []).filter((p) => Math.abs(parseFloat(p.size)) > 0);
  }

  async function wasLastEntryOrderByKaela(symbol, sinceMs = Date.now() - 24 * 3600 * 1000) {
    const result = await signedGet('/v5/order/history', { category: CATEGORY, symbol, startTime: sinceMs, limit: 50 });
    const openingOrders = (result.list || []).filter((o) => o.orderStatus === 'Filled' && !o.reduceOnly);
    if (openingOrders.length === 0) return null;
    const latest = openingOrders.sort((a, b) => Number(b.createdTime) - Number(a.createdTime))[0];
    return String(latest.orderLinkId || '').startsWith(KAELA_ORDER_PREFIX);
  }

  // TUTUP posisi -- `direction` = arah POSISI ASLI (bukan arah order tutup): side dibalik
  // (buy->Sell, sell->Buy), reduceOnly:true (Bybit one-way TERIMA reduceOnly, beda dari BingX
  // hedge mode yang nolak field ini).
  async function emergencyCloseMarket({ symbol, direction, quantity }) {
    const closeSide = direction === 'buy' ? 'Sell' : 'Buy';
    return signedPost('/v5/order/create', {
      category: CATEGORY, symbol, side: closeSide, orderType: 'Market',
      qty: String(quantity), positionIdx: 0, reduceOnly: true,
    });
  }

  async function cancelAllOpenOrders(symbol) {
    return signedPost('/v5/order/cancel-all', { category: CATEGORY, symbol });
  }

  return {
    getAccountBalance, getWalletBalance, setLeverage, setIsolatedMargin, placeMarketEntry,
    getPositionRisk, getAllPositions, cancelAllOpenOrders, getSymbolInfo, roundToStepSize,
    emergencyCloseMarket, wasLastEntryOrderByKaela,
  };
}

module.exports = {
  createBybitClient, loadSecrets, roundToStepSize, KAELA_ORDER_PREFIX,
};
