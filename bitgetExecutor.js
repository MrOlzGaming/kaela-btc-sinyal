// Eksekusi order di Bitget USDT-M Futures (23 Sep 2026, Olan siapin akun "Kaela Trading Engine" --
// akun REAL dari awal, BUKAN demo -- Olan udah lama trading manual di akun ini). Struktur/interface
// SENGAJA disamain PERSIS binanceExecutor.js/bingxExecutor.js (factory createXClient({apiKey,
// apiSecret,testnet}), fungsi sama nama) -- caller bisa tukar exec exchange tanpa ubah logic.
//
// Bedanya dari BingX/Binance (riset resmi docs.bitget.com, 23 Sep 2026):
//   - WAJIB 3 kredensial: apiKey, apiSecret, DAN passphrase (dibuat SENDIRI oleh Olan pas create
//     key, BUKAN dikasih Bitget) -- header ACCESS-PASSPHRASE tambahan di tiap signed request.
//   - Auth: signature HMAC-SHA256 BASE64 (bukan hex kayak BingX) dari
//     `timestamp + METHOD + requestPath + "?" + queryString + body` (queryString/body diilangin
//     dari string kalau kosong). Query params WAJIB disortir alfabetis (sample resmi Bitget pakai
//     `sorted(params.items())`) -- SAMA prinsipnya kayak BingX tapi beda cara sign (base64 vs hex).
//   - ⛔ GOTCHA izin ketemu empiris: checkbox app "Order futures" SENDIRIAN cuma ngasih akses
//     order (place/cancel/list) -- baca saldo/posisi (`account/accounts`, `position/all-position`)
//     DITOLAK ("need future pos read or future pos write permissions") sampai checkbox "Open
//     interest" JUGA dicentang. Nama itu MENYESATKAN di app (kedengerannya data pasar doang) --
//     WAJIB centang KEDUANYA tiap bikin API key Bitget baru.
//   - Response `place-order` MINIMAL (cuma orderId+clientOid, GAK ADA avgPrice/status/executedQty
//     kayak BingX) -- WAJIB polling `Get Order Detail` abis submit buat tau fill beneran (mirip
//     binanceExecutor.js `waitForFill`, TAPI di sini itu jalur UTAMA bukan fallback -- Bitget CUMA
//     PERNAH observasi minimal response, belum ketemu kasus sync-fill kayak BingX).
//   - Field NAMA beda dari Binance/BingX (`baseVolume` bukan `executedQty`, `priceAvg` bukan
//     `avgPrice`) -- placeMarketEntry MAP manual ke nama field yang caller (nyopetAutoTrader.js
//     dst) udah biasa baca, SUPAYA gak perlu ubah caller sama sekali.
//   - Posisi one-way vs hedge-mode BEDA per akun (field `posMode` di /account/account), BUKAN
//     selalu hedge kayak BingX -- dideteksi otomatis (cached) via `getPosMode()`, dipakai nentuin
//     `tradeSide`/`reduceOnly` yang bener di place-order (lihat komentar placeMarketEntry/
//     emergencyCloseMarket).
//   - getPositionRisk/getAllPositions balikin SHAPE ASLI Bitget (holdSide/openPriceAvg/total, BUKAN
//     dinormalisasi ke positionAmt/entryPrice ala Binance) -- SAMA prinsip kayak bingxExecutor.js:
//     dipakai caller DEDICATED (Channel-Breakout-style) yang baca field asli langsung, BUKAN
//     positionReconciler.js generik. Normalisasi baru dibutuhin kalau/pas Bitget dipasang ke jalur
//     generik (langkah 6, migrasi Emas) -- BELUM dikerjain di sini, keputusan terpisah nanti.
//   - `testnet:true` SENGAJA throw error "belum diimplementasi" -- Bitget punya "Demo Trading" tapi
//     mekanismenya (base URL beda? header khusus?) BELUM diriset, JANGAN nebak drpd nulis salah.
//
// UPDATE 26 Sep 2026 -- riset testnet/demo LANJUT (konteks: nyari exchange kedua buat leg Fixed-TP
// twin-position Emas, lihat goldTwinPosition.js -- Bybit awalnya dicoba, TERNYATA gak punya produk
// Emas SAMA SEKALI, linear maupun inverse, jadi pindah ke Bitget yang PUNYA PAXGUSDT/XAUTUSDT/
// XAUUSDT status normal). Demo Trading Bitget-nya SENDIRI TERNYATA JUGA gak cover Emas -- dites
// empiris productType SUSDT-FUTURES cuma ada 3 simbol (SBTCSUSDT/SETHSUSDT/SXRPSUSDT), gak ada
// gold. Kesimpulan: gak ada 1 exchange pun yang punya demo-trading BENERAN buat Emas -- `testnet`
// param di atas TETAP throw (keputusan lama masih benar), dan leg Fixed-TP Emas fase evaluasi WAJIB
// simulasi lokal murni (paperLeg() di goldTwinPosition.js), bukan nyoba testnet:true di sini.

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

const BASE_URL = 'https://api.bitget.com';
const PRODUCT_TYPE = 'USDT-FUTURES'; // USDC-FUTURES belum dipakai -- tambah param kalau butuh wallet USDC kedua nanti
const MARGIN_COIN = 'USDT';

function createBitgetClient({ apiKey, apiSecret, passphrase, testnet }) {
  if (!apiKey || !apiSecret || !passphrase) {
    throw new Error('createBitgetClient: apiKey/apiSecret/passphrase wajib diisi (Bitget WAJIB 3 kredensial, beda dari Binance/BingX).');
  }
  if (testnet) {
    throw new Error('createBitgetClient: testnet/demo Bitget BELUM diimplementasi (mekanismenya belum diriset) -- akun ini REAL dari awal, panggil dengan testnet:false.');
  }
  let symbolInfoCache = null;
  let posModeCache = null; // 'one_way_mode' | 'hedge_mode', cached SEKALI per instance (jarang ganti pas jalan)

  function sign(preHash) {
    return crypto.createHmac('sha256', apiSecret).update(preHash).digest('base64');
  }

  // Query params WAJIB disortir alfabetis (sample resmi Bitget) sebelum ditempel ke preHash MAUPUN
  // URL beneran -- signature gak match kalau urutannya beda dari yang dikirim.
  async function signedRequest(method, path, queryParams = {}, body = null) {
    const timestamp = Date.now().toString();
    const sortedKeys = Object.keys(queryParams).sort();
    const qs = sortedKeys.map((k) => `${k}=${queryParams[k]}`).join('&');
    const bodyStr = body ? JSON.stringify(body) : '';
    const preHash = timestamp + method.toUpperCase() + path + (qs ? '?' + qs : '') + bodyStr;
    const signature = sign(preHash);
    const url = `${BASE_URL}${path}${qs ? '?' + qs : ''}`;
    const res = await fetch(url, {
      method,
      headers: {
        'ACCESS-KEY': apiKey, 'ACCESS-SIGN': signature, 'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': passphrase, 'Content-Type': 'application/json',
      },
      body: body ? bodyStr : undefined,
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
      const res = await fetch(`${BASE_URL}/api/v2/mix/market/contracts?productType=${PRODUCT_TYPE}`);
      const data = await res.json();
      symbolInfoCache = {};
      for (const c of data.data) symbolInfoCache[c.symbol] = c;
    }
    const info = symbolInfoCache[symbol];
    if (!info) throw new Error(`Simbol ${symbol} gak ketemu di market/contracts Bitget.`);
    return { stepSize: parseFloat(info.sizeMultiplier), quantityPrecision: parseInt(info.volumePlace, 10), pricePrecision: parseInt(info.pricePlace, 10), minNotionalUsd: parseFloat(info.minTradeUSDT) };
  }

  // Dicek SEKALI, di-cache -- one-way vs hedge-mode NENTUIN cara isi tradeSide/reduceOnly di
  // place-order (lihat komentar header file). Pakai symbol BTCUSDT sbg probe (posMode akun-wide
  // per productType, gak spesifik per-symbol -- symbol cuma syarat parameter endpoint ini).
  async function getPosMode() {
    if (posModeCache) return posModeCache;
    const acc = await signedRequest('GET', '/api/v2/mix/account/account', { symbol: 'BTCUSDT', productType: PRODUCT_TYPE, marginCoin: MARGIN_COIN });
    posModeCache = acc.posMode;
    return posModeCache;
  }

  // `asset` diterima buat konsistensi interface (BingX/Binance) -- Bitget productType udah
  // nentuin marginCoin duluan (USDT-FUTURES = USDT doang), param ini gak dipakai buat query
  // tapi tetep divalidasi biar caller yang salah kirim 'VST'/asset lain ketauan dari awal.
  async function getAccountBalance(asset) {
    if (asset !== MARGIN_COIN) throw new Error(`bitgetExecutor cuma dukung marginCoin ${MARGIN_COIN} sekarang, diminta '${asset}'.`);
    const accounts = await signedRequest('GET', '/api/v2/mix/account/accounts', { productType: PRODUCT_TYPE });
    const acc = (accounts || []).find((a) => a.marginCoin === asset);
    return acc ? parseFloat(acc.available) : 0;
  }

  async function getWalletBalance(asset) {
    if (asset !== MARGIN_COIN) throw new Error(`bitgetExecutor cuma dukung marginCoin ${MARGIN_COIN} sekarang, diminta '${asset}'.`);
    const accounts = await signedRequest('GET', '/api/v2/mix/account/accounts', { productType: PRODUCT_TYPE });
    const acc = (accounts || []).find((a) => a.marginCoin === asset);
    return acc ? parseFloat(acc.accountEquity) : 0;
  }

  // ⚠️ Bitget TOLAK ganti margin mode kalau ADA posisi/order terbuka di symbol itu (sama kayak
  // Binance) -- WAJIB dipanggil SEBELUM entry, bukan sesudah.
  async function setIsolatedMargin(symbol) {
    return signedRequest('POST', '/api/v2/mix/account/set-margin-mode', {}, { symbol, productType: PRODUCT_TYPE, marginCoin: MARGIN_COIN, marginMode: 'isolated' });
  }

  // `positionSide` diterima buat konsistensi interface (BingX pola LONG/SHORT) TAPI SENGAJA gak
  // dipakai isi `holdSide` -- strategi di proyek ini SELALU 1 leverage sama buat kedua arah
  // (calculator.js `hitung()` cuma ngasih 1 angka), jadi cukup kirim `leverage` polos (berlaku
  // cross-margin, one-way, DAN hedge-mode-leverage-sama sekaligus per docs Bitget).
  async function setLeverage(symbol, leverage, positionSide) {
    return signedRequest('POST', '/api/v2/mix/account/set-leverage', {}, { symbol, productType: PRODUCT_TYPE, marginCoin: MARGIN_COIN, leverage: String(leverage) });
  }

  // Bitget place-order response MINIMAL (orderId+clientOid doang) -- WAJIB polling Get Order
  // Detail buat tau fill beneran (beda dari BingX yang sync di response awal).
  async function waitForFill(symbol, orderId, attempts = 8, delayMs = 400) {
    for (let i = 0; i < attempts; i++) {
      const detail = await signedRequest('GET', '/api/v2/mix/order/detail', { symbol, productType: PRODUCT_TYPE, orderId }).catch(() => null);
      if (detail && detail.state === 'filled' && parseFloat(detail.baseVolume) > 0) return detail;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    throw new Error(`Order ${orderId} (${symbol}) belum FILLED setelah ${attempts}x cek -- cek manual via getPositionRisk sebelum lanjut apapun.`);
  }

  // BUKA posisi baru. `direction`: 'buy'->LONG, 'sell'->SHORT. hedge-mode WAJIB tradeSide:'open'
  // (side=buy/sell nentuin arah LONG/SHORT-nya sendiri, SAMA di hedge maupun one-way -- beda dari
  // BingX yang butuh positionSide terpisah).
  async function placeMarketEntry({ symbol, direction, notionalUsd, livePrice }) {
    const { stepSize, quantityPrecision } = await getSymbolInfo(symbol);
    const rawQuantity = notionalUsd / livePrice;
    const quantity = roundToStepSize(rawQuantity, stepSize, quantityPrecision);
    if (quantity <= 0) throw new Error(`Quantity kehitung 0 buat ${symbol} (notional $${notionalUsd} kekecilan buat stepSize ${stepSize}) -- order gak dikirim.`);
    const posMode = await getPosMode();
    const side = direction === 'buy' ? 'buy' : 'sell';
    const body = {
      symbol, productType: PRODUCT_TYPE, marginMode: 'isolated', marginCoin: MARGIN_COIN,
      size: String(quantity), side, orderType: 'market', clientOid: generateKaelaClientOrderId(),
    };
    if (posMode === 'hedge_mode') body.tradeSide = 'open';
    const placed = await signedRequest('POST', '/api/v2/mix/order/place-order', {}, body);
    const detail = await waitForFill(symbol, placed.orderId);
    // Map nama field ke konvensi Binance/BingX (executedQty/avgPrice) -- caller (nyopetAutoTrader.js
    // dst) baca nama itu, Bitget aslinya pakai baseVolume/priceAvg.
    return { ...detail, executedQty: detail.baseVolume, avgPrice: detail.priceAvg };
  }

  async function getPositionRisk(symbol) {
    const positions = await signedRequest('GET', '/api/v2/mix/position/single-position', { symbol, productType: PRODUCT_TYPE, marginCoin: MARGIN_COIN });
    return (positions || [])[0] || null;
  }

  async function getAllPositions() {
    return signedRequest('GET', '/api/v2/mix/position/all-position', { productType: PRODUCT_TYPE });
  }

  // Cek order pembuka TERBARU (pola SAMA persis binanceExecutor.js/bingxExecutor.js
  // wasLastEntryOrderByKaela) -- `reduceOnly` field Bitget balikin string 'YES'/'NO' langsung,
  // lebih gampang drpd nebak dari tradeSide (yang beda enum one-way vs hedge-mode).
  async function wasLastEntryOrderByKaela(symbol, sinceMs = Date.now() - 24 * 3600 * 1000) {
    const result = await signedRequest('GET', '/api/v2/mix/order/orders-history', { productType: PRODUCT_TYPE, symbol, startTime: sinceMs, endTime: Date.now(), limit: 100 });
    const openingOrders = (result.entrustedList || []).filter((o) => o.status === 'filled' && o.reduceOnly !== 'YES');
    if (openingOrders.length === 0) return null;
    const latest = openingOrders.sort((a, b) => Number(b.cTime) - Number(a.cTime))[0];
    return String(latest.clientOid || '').startsWith(KAELA_ORDER_PREFIX);
  }

  // TUTUP posisi (partial ATAU penuh, `quantity` eksplisit dari caller -- SAMA pola BingX, BUKAN
  // pakai Flash Close Position yang cuma bisa tutup SEMUA sekaligus, gak dukung partial).
  // hedge-mode: side = ARAH POSISI ASLI (SAMA kayak direction, BUKAN dibalik) + tradeSide:'close'
  // (persis contoh resmi docs: "Close long: side=buy, tradeSide=close"). one-way: side DIBALIK +
  // reduceOnly:'YES' (SAMA prinsip Binance).
  async function emergencyCloseMarket({ symbol, direction, quantity }) {
    const posMode = await getPosMode();
    const body = {
      symbol, productType: PRODUCT_TYPE, marginMode: 'isolated', marginCoin: MARGIN_COIN,
      size: String(quantity), orderType: 'market', clientOid: generateKaelaClientOrderId(),
    };
    if (posMode === 'hedge_mode') {
      body.side = direction === 'buy' ? 'buy' : 'sell';
      body.tradeSide = 'close';
    } else {
      body.side = direction === 'buy' ? 'sell' : 'buy';
      body.reduceOnly = 'YES';
    }
    const placed = await signedRequest('POST', '/api/v2/mix/order/place-order', {}, body);
    const detail = await waitForFill(symbol, placed.orderId);
    return { ...detail, executedQty: detail.baseVolume, avgPrice: detail.priceAvg };
  }

  async function cancelAllOpenOrders(symbol) {
    return signedRequest('POST', '/api/v2/mix/order/cancel-all-orders', {}, { productType: PRODUCT_TYPE, symbol });
  }

  return {
    getAccountBalance, getWalletBalance, setLeverage, setIsolatedMargin, placeMarketEntry,
    getPositionRisk, getAllPositions, cancelAllOpenOrders, getSymbolInfo, roundToStepSize,
    emergencyCloseMarket, wasLastEntryOrderByKaela, getPosMode,
  };
}

// ============ Wrapper backward-compatible (pola SAMA persis binanceExecutor.js/bingxExecutor.js)
// -- akun default Olan sendiri dari secrets.js (BITGET_API_KEY/SECRET/PASSPHRASE). JANGAN numpang
// wrapper default ini kalau butuh saklar independen per-strategi -- bikin instance sendiri via
// createBitgetClient LANGSUNG (pola ninjaTrader.js ke BingX).
let _defaultClientInstance = null;
function _defaultClient() {
  if (_defaultClientInstance) return _defaultClientInstance;
  const secrets = loadSecrets();
  if (!secrets.BITGET_API_KEY || !secrets.BITGET_API_SECRET || !secrets.BITGET_API_PASSPHRASE) {
    throw new Error('BITGET_API_KEY/BITGET_API_SECRET/BITGET_API_PASSPHRASE belum di-setup (secrets.js atau env var) -- gak bisa eksekusi order Bitget.');
  }
  _defaultClientInstance = createBitgetClient({ apiKey: secrets.BITGET_API_KEY, apiSecret: secrets.BITGET_API_SECRET, passphrase: secrets.BITGET_API_PASSPHRASE, testnet: false });
  return _defaultClientInstance;
}

async function getAccountBalance(asset) { return _defaultClient().getAccountBalance(asset); }
async function getWalletBalance(asset) { return _defaultClient().getWalletBalance(asset); }
async function setLeverage(symbol, leverage, positionSide) { return _defaultClient().setLeverage(symbol, leverage, positionSide); }
async function setIsolatedMargin(symbol) { return _defaultClient().setIsolatedMargin(symbol); }
async function placeMarketEntry(args) { return _defaultClient().placeMarketEntry(args); }
async function getPositionRisk(symbol) { return _defaultClient().getPositionRisk(symbol); }
async function getAllPositions() { return _defaultClient().getAllPositions(); }
async function cancelAllOpenOrders(symbol) { return _defaultClient().cancelAllOpenOrders(symbol); }
async function getSymbolInfo(symbol) { return _defaultClient().getSymbolInfo(symbol); }
async function emergencyCloseMarket(args) { return _defaultClient().emergencyCloseMarket(args); }
async function wasLastEntryOrderByKaela(symbol, sinceMs) { return _defaultClient().wasLastEntryOrderByKaela(symbol, sinceMs); }

module.exports = {
  createBitgetClient, loadSecrets,
  getAccountBalance, getWalletBalance, setLeverage, setIsolatedMargin, placeMarketEntry,
  getPositionRisk, getAllPositions, cancelAllOpenOrders, getSymbolInfo, roundToStepSize,
  emergencyCloseMarket, wasLastEntryOrderByKaela, KAELA_ORDER_PREFIX,
};
