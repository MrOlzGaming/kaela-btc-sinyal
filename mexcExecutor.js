// Eksekusi order REAL di MEXC Futures (30 Agu 2026, migrasi trading Emas Binance->MEXC -- lihat
// memori project-kaela-multi-exchange). CETAKAN dari binanceExecutor.js (interface function SAMA
// biar nyopetAutoTrader.js/sniperMultiAccount.js bisa nerima client MEXC tanpa rombak besar),
// TAPI internal beda total krn API MEXC beda konvensi dari Binance di 3 hal penting:
//
// 1. AUTH: header ApiKey/Request-Time/Signature (BUKAN query string kayak Binance). Signature =
//    HMAC-SHA256(secretKey, accessKey + timestamp + parameterString) -- parameterString GET =
//    query di-sort dictionary order + "&", POST = JSON string body (gak perlu di-sort).
// 2. VOL = JUMLAH KONTRAK, BUKAN quantity aset langsung -- tiap simbol punya `contractSize`
//    sendiri (misal BTC_USDT contractSize=0.0001 -> 1 kontrak = 0,0001 BTC). WAJIB fetch
//    contract/detail dulu buat convert notionalUsd -> vol yang bener. INI TITIK PALING RISKAN --
//    kalau salah convert, posisi kebuka salah ukuran drastis (bisa berkali-kali lipat).
// 3. SIDE pakai kode angka (1=open long, 2=close short, 3=open short, 4=close long), openType
//    (1=isolated, 2=cross) dipilih PER-ORDER (bukan endpoint terpisah kayak Binance marginType).
//
// ⚠️ BELUM PERNAH DITES LIVE (30 Agu 2026) -- ditulis dari dokumentasi resmi
// (mexcdevelop.github.io/apidocs/contract_v1_en/) doang, BELUM ada API key buat verifikasi
// beneran. SEBELUM dipakai modal real: tes `getContractDetail` + `placeMarketEntry` nominal
// SEKECIL MUNGKIN dulu, cek posisi yang kebuka beneran sesuai itungan, baru naikin.

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

const BASE_URL = 'https://contract.mexc.com';

function createMexcClient({ apiKey, apiSecret }) {
  if (!apiKey || !apiSecret) {
    throw new Error('createMexcClient: apiKey/apiSecret wajib diisi.');
  }
  let contractInfoCache = null;

  // GET: parameterString = query di-sort dictionary order, gabung "&". POST: parameterString =
  // JSON string body (gak perlu di-sort) -- 2 aturan BEDA, jangan disamain.
  function buildParamString(method, params) {
    if (method === 'GET' || method === 'DELETE') {
      const keys = Object.keys(params).sort();
      return keys.map((k) => `${k}=${params[k]}`).join('&');
    }
    return JSON.stringify(params);
  }

  function sign(accessKey, timestamp, parameterString) {
    return crypto.createHmac('sha256', apiSecret).update(accessKey + timestamp + parameterString).digest('hex');
  }

  async function signedRequest(method, path, params = {}) {
    const timestamp = Date.now().toString();
    const parameterString = buildParamString(method, params);
    const signature = sign(apiKey, timestamp, parameterString);
    const headers = {
      ApiKey: apiKey, 'Request-Time': timestamp, Signature: signature, 'Content-Type': 'application/json',
    };
    let url = `${BASE_URL}${path}`;
    let body;
    if (method === 'GET' || method === 'DELETE') {
      if (parameterString) url += `?${parameterString}`;
    } else {
      body = parameterString;
    }
    const res = await fetch(url, { method, headers, body });
    const data = await res.json();
    if (!res.ok || data.success === false) {
      const err = new Error(`MEXC API error (HTTP ${res.status}): ${JSON.stringify(data)}`);
      err.mexcCode = data.code;
      throw err;
    }
    return data.data !== undefined ? data.data : data;
  }

  // ⚠️ TITIK PALING RISKAN (lihat catatan atas file) -- `contractSize` per simbol WAJIB dipakai
  // buat convert notionalUsd -> vol (jumlah kontrak). Cache-nya per-instance, sama pola kayak
  // symbolInfoCache di binanceExecutor.js.
  async function getContractDetail(symbol) {
    if (!contractInfoCache) {
      const res = await fetch(`${BASE_URL}/api/v1/contract/detail`);
      const json = await res.json();
      contractInfoCache = {};
      for (const c of json.data) contractInfoCache[c.symbol] = c;
    }
    const info = contractInfoCache[symbol];
    if (!info) throw new Error(`Simbol ${symbol} gak ketemu di MEXC contract/detail.`);
    return info; // { symbol, contractSize, priceScale, volScale, ... }
  }

  // Interface DISAMAIN kayak binanceExecutor.js getSymbolInfo -- caller (sniperMultiAccount.js
  // dkk) pakai `stepSize`+`quantityPrecision` buat `roundToStepSize()` (fungsi murni, sama dipakai
  // dua-duanya) pas ngitung setengah qty buat partial TP. `stepSize` = contractSize (satuan
  // terkecil quantity ASET, bukan vol) -- quantityPrecision dihitung dari situ.
  async function getSymbolInfo(symbol) {
    const { contractSize, priceScale } = await getContractDetail(symbol);
    const stepStr = contractSize.toString();
    const quantityPrecision = stepStr.includes('.') ? stepStr.split('.')[1].length : 0;
    return { stepSize: contractSize, quantityPrecision, pricePrecision: priceScale };
  }

  // asset default 'USDT' -- MEXC gold pair (GOLD_XAUTUSDT/GOLD_PAXGUSDT) dua-duanya margin USDT.
  async function getAccountBalance(asset = 'USDT') {
    const assets = await signedRequest('GET', '/api/v1/private/account/assets', {});
    const bal = (Array.isArray(assets) ? assets : []).find((a) => a.currency === asset);
    return bal ? parseFloat(bal.availableBalance) : 0;
  }

  // MEXC gak punya endpoint "set margin type" terpisah kayak Binance -- isolated/cross dipilih
  // PER-ORDER lewat openType (1=isolated) di placeMarketEntry. Fungsi ini no-op, DIPERTAHANKAN
  // biar interface tetap sama kayak binanceExecutor.js (caller gak perlu tau bedanya).
  async function setIsolatedMargin(_symbol) {
    return { alreadyIsolated: true, note: 'MEXC: openType diset per-order, bukan endpoint terpisah.' };
  }

  // positionType 1=long, 2=short -- WAJIB SESUAI ARAH POSISI yang mau diubah leverage-nya (beda
  // dari Binance yang leverage-nya per-symbol doang, gak peduli arah).
  async function setLeverage(symbol, leverage, positionType = 1) {
    return signedRequest('POST', '/api/v1/private/position/change_leverage', {
      symbol, leverage, openType: 1, positionType,
    });
  }

  // ⚠️ BUG KETEMU+FIX 3 Sep 2026 (Olan buka posisi manual di MEXC buat tes, "kok ga ada
  // informasi?") -- fungsi ini SEBELUMNYA balikin object MENTAH dari MEXC apa adanya, TAPI field
  // NAME-nya BEDA TOTAL dari Binance (dicek langsung ke dokumentasi resmi MEXC contract API):
  //   holdVol (bukan positionAmt, SELALU POSITIF -- arah dari positionType terpisah)
  //   holdAvgPrice (bukan entryPrice), positionType 1=long/2=short (bukan tanda +/- di qty),
  //   liquidatePrice (bukan liquidationPrice), gak ada notional/unRealizedProfit sama sekali.
  // SEMUA caller (sniperMultiAccount.js `posRisk.positionAmt`, positionReconciler.js) nulis kode
  // ASUMSI shape Binance -- `posRisk.positionAmt` MEXC SELALU `undefined` -> parseFloat(undefined)
  // = NaN -> Math.abs(NaN) = NaN -> qty keitung 0 PADAHAL POSISI BENERAN ADA. Ini BUKAN cuma soal
  // notifikasi -- Sniper MEXC (Emas) yang UDAH LIVE bisa salah kira posisi "gak ada"/"udah
  // ketutup" padahal masih floating. Fix: normalize ke shape SAMA PERSIS Binance di SINI (satu
  // tempat), semua caller lama otomatis kebenerin tanpa disentuh.
  async function _normalizePosition(raw) {
    const { contractSize } = await getContractDetail(raw.symbol);
    const qtyAsset = Number(raw.holdVol) * contractSize;
    const sign = Number(raw.positionType) === 2 ? -1 : 1; // 1=long, 2=short
    const entryPrice = Number(raw.holdAvgPrice) || 0;
    return {
      symbol: raw.symbol,
      positionAmt: (sign * qtyAsset).toString(),
      entryPrice: entryPrice.toString(),
      markPrice: null, // MEXC open_positions gak balikin mark price -- gak dipakai reconciler/Sniper close-check
      unRealizedProfit: null, // sama, gak dibalikin endpoint ini -- caller yang butuh WAJIB fetch terpisah
      leverage: (Number(raw.leverage) || 0).toString(),
      liquidationPrice: (Number(raw.liquidatePrice) || 0).toString(),
      marginType: Number(raw.openType) === 1 ? 'isolated' : 'cross',
      notional: (qtyAsset * entryPrice).toString(),
    };
  }

  async function getPositionRisk(symbol) {
    const positions = await signedRequest('GET', '/api/v1/private/position/open_positions', { symbol });
    const raw = (Array.isArray(positions) ? positions : []).find((p) => p.symbol === symbol) || null;
    return raw ? _normalizePosition(raw) : null;
  }

  // BARU (3 Sep 2026) -- endpoint TANPA symbol filter balikin SEMUA posisi terbuka akun ini
  // (dikonfirmasi dokumentasi resmi: "symbol parameter optional, omitted returns all open
  // positions"). Interface DISAMAIN persis binanceExecutor.js punya (dipakai positionReconciler.js
  // buat pantau posisi manual APAPUN, gak cuma symbol yang bot kenal).
  async function getAllPositions() {
    const positions = await signedRequest('GET', '/api/v1/private/position/open_positions', {});
    const raws = Array.isArray(positions) ? positions : [];
    return Promise.all(raws.map((p) => _normalizePosition(p)));
  }

  // Quantity (aset unit, misal BTC/XAUT) -> vol (jumlah kontrak) -- WAJIB pakai contractSize
  // simbol, INI TITIK PALING RISKAN kalau contractSize-nya salah/berubah (lihat catatan atas file).
  async function quantityToVol(symbol, quantity) {
    const { contractSize } = await getContractDetail(symbol);
    return Math.floor(quantity / contractSize);
  }

  // Interface DISAMAIN PERSIS kayak binanceExecutor.js (notionalUsd+livePrice masuk, BUKAN vol
  // langsung) -- caller (sniperAutoAnalysis.js dkk) gak perlu tau soal vol/contractSize sama
  // sekali, itu detail internal MEXC doang. Balikin `executedQty` (STRING, quantity ASET bukan
  // vol) biar caller bisa langsung pakai buat placeStopLoss/placeTakeProfit selanjutnya SAMA
  // PERSIS pola Binance (entryOrder.executedQty).
  async function placeMarketEntry({ symbol, direction, notionalUsd, livePrice }) {
    const { contractSize } = await getContractDetail(symbol);
    const rawVol = notionalUsd / livePrice / contractSize;
    const vol = Math.floor(rawVol); // MEXC vol WAJIB integer (jumlah kontrak bulat)
    if (vol <= 0) throw new Error(`Vol kehitung 0 buat ${symbol} (notional $${notionalUsd} kekecilan buat contractSize ${contractSize}) -- order gak dikirim.`);
    const side = direction === 'buy' ? 1 : 3; // 1=open long, 3=open short
    const placed = await signedRequest('POST', '/api/v1/private/order/create', { symbol, vol, side, type: 5, openType: 1 });
    // ⚠️ BEDA dari Binance -- belum ketemu endpoint "query order by id" MEXC di riset ini buat
    // poll status FILLED kayak waitForFill() Binance. Vol yang BENERAN kefill diasumsikan = vol
    // yang dikirim (market order harusnya fill penuh), tapi INI ASUMSI, BELUM diverifikasi live.
    // TODO: cari endpoint query-order MEXC, tambahin poll-fill sebelum dipakai modal real beneran.
    const executedQty = (vol * contractSize).toString();
    // ⚠️ avgPrice DIISI DARI livePrice yang DIKIRIM (pendekatan), BUKAN harga fill BENERAN dari
    // MEXC -- respons order/create MEXC cuma balikin {orderId, ts}, gak ada avgPrice kayak
    // Binance. Buat market order di pair likuid biasanya deket banget, TAPI ini TETAP pendekatan,
    // bukan angka pasti. TODO: cari endpoint query-order MEXC buat avgPrice akurat.
    return { ...placed, executedQty, avgPrice: livePrice.toString(), vol, contractSize };
  }

  // Plan order (trigger/conditional) -- endpoint TERPISAH dari order/create, beda dari Binance yang
  // nempelin SL/TP lewat algoOrder based on entry order. ⚠️ Riset nemu catatan changelog LAMA
  // (2022) bilang endpoint ini sempat "under maintenance" -- WAJIB dites ulang manual sebelum
  // diandelin buat proteksi posisi real, JANGAN asumsikan langsung jalan.
  // `quantity` (BUKAN vol) -- disamain kayak Binance, dikonversi ke vol internal di sini.
  async function placeStopLoss({ symbol, direction, stopPrice, quantity }) {
    const vol = await quantityToVol(symbol, quantity);
    const closeSide = direction === 'buy' ? 2 : 4; // CATATAN: dokumentasi order/create pakai 2=close short/4=close long buat ORDER BIASA; utk planorder triggerType mungkin beda, TODO verifikasi field persis pas API key ada.
    return signedRequest('POST', '/api/v1/private/planorder/place', {
      symbol, vol, side: closeSide, triggerPrice: stopPrice, triggerType: direction === 'buy' ? 2 : 1, trend: 1, executeCycle: 1, orderType: 5,
    });
  }

  async function placeTakeProfit({ symbol, direction, tpPrice, quantity }) {
    const vol = await quantityToVol(symbol, quantity);
    const closeSide = direction === 'buy' ? 2 : 4;
    return signedRequest('POST', '/api/v1/private/planorder/place', {
      symbol, vol, side: closeSide, triggerPrice: tpPrice, triggerType: direction === 'buy' ? 1 : 2, trend: 1, executeCycle: 1, orderType: 5,
    });
  }

  async function emergencyCloseMarket({ symbol, direction, quantity }) {
    const vol = await quantityToVol(symbol, quantity);
    const closeSide = direction === 'buy' ? 2 : 4;
    return signedRequest('POST', '/api/v1/private/order/create', { symbol, vol, side: closeSide, type: 5, openType: 1, reduceOnly: true });
  }

  // ⚠️ BARU 4 Sep 2026, BELUM PERNAH DITES LIVE (sama peringatan kayak seluruh file ini -- IP
  // lokal gak di-whitelist MEXC, gak bisa verifikasi respons beneran) -- ditulis dari riset
  // dokumentasi resmi (mexcdevelop.github.io/apidocs/contract_v1_en/, endpoint "Get All Transaction
  // Details of User's Orders"). Balikin histori FILL per-order (BUKAN per-posisi) -- tiap fill ada
  // `profit` (realized PnL fill itu) + `fee`. Range max 90 hari per panggilan (beda dari Binance
  // yang gak ada batasan eksplisit) -- caller WAJIB chunking kalau butuh lebih jauh dari itu.
  // ⚠️ TANDA field `fee` BELUM DIVERIFIKASI (positif=dipotong ATAU udah negatif?) -- JANGAN
  // dipercaya buat laporan PnL resmi sebelum dicocokin manual sama 1 transaksi MEXC beneran.
  async function getOrderDeals(startTime, endTime, pageNum = 1, pageSize = 100) {
    return signedRequest('GET', '/api/v1/private/order/list/order_deals', {
      start_time: startTime, end_time: endTime, page_num: pageNum, page_size: pageSize,
    });
  }

  async function cancelAllOpenOrders(symbol) {
    return signedRequest('POST', '/api/v1/private/order/cancel_all', { symbol });
  }

  return {
    getAccountBalance, setLeverage, setIsolatedMargin, placeMarketEntry, placeStopLoss, placeTakeProfit,
    getPositionRisk, getAllPositions, getOrderDeals, cancelAllOpenOrders, getContractDetail, getSymbolInfo, emergencyCloseMarket,
  };
}

// Wrapper singleton (pola SAMA PERSIS binanceExecutor.js _defaultClient()) -- akun Olan sendiri
// dari secrets.js/env var. Kalau MEXC_API_KEY/SECRET belum diisi, LEMPAR error jelas -- caller
// (sniperAutoAnalysis.js dkk) WAJIB tangkep ini dan skip aset Emas dengan aman, BUKAN crash
// seluruh siklus (BTC harus tetap jalan normal walau MEXC belum disetup).
let _defaultClientInstance = null;
function _defaultClient() {
  if (_defaultClientInstance) return _defaultClientInstance;
  const secrets = loadSecrets();
  if (!secrets.MEXC_API_KEY || !secrets.MEXC_API_SECRET) {
    throw new Error('MEXC_API_KEY/MEXC_API_SECRET belum di-setup (secrets.js atau env var) -- gak bisa eksekusi order MEXC.');
  }
  _defaultClientInstance = createMexcClient({ apiKey: secrets.MEXC_API_KEY, apiSecret: secrets.MEXC_API_SECRET });
  return _defaultClientInstance;
}

// isMexcConfigured() -- cek AMAN (gak throw) buat caller yang mau tau duluan sebelum nyoba
// eksekusi, dipakai buat skip Emas dengan pesan jelas selama MEXC_API_KEY belum diisi.
function isMexcConfigured() {
  const secrets = loadSecrets();
  return !!(secrets.MEXC_API_KEY && secrets.MEXC_API_SECRET);
}

async function getAccountBalance(asset = 'USDT') { return _defaultClient().getAccountBalance(asset); }
async function setLeverage(symbol, leverage, positionType) { return _defaultClient().setLeverage(symbol, leverage, positionType); }
async function setIsolatedMargin(symbol) { return _defaultClient().setIsolatedMargin(symbol); }
async function placeMarketEntry(args) { return _defaultClient().placeMarketEntry(args); }
async function placeStopLoss(args) { return _defaultClient().placeStopLoss(args); }
async function placeTakeProfit(args) { return _defaultClient().placeTakeProfit(args); }
async function getPositionRisk(symbol) { return _defaultClient().getPositionRisk(symbol); }
async function getAllPositions() { return _defaultClient().getAllPositions(); }
async function getOrderDeals(startTime, endTime, pageNum, pageSize) { return _defaultClient().getOrderDeals(startTime, endTime, pageNum, pageSize); }
async function cancelAllOpenOrders(symbol) { return _defaultClient().cancelAllOpenOrders(symbol); }
async function emergencyCloseMarket(args) { return _defaultClient().emergencyCloseMarket(args); }
async function getSymbolInfo(symbol) { return _defaultClient().getSymbolInfo(symbol); }

module.exports = {
  createMexcClient, isMexcConfigured, EXCHANGE_NAME: 'mexc',
  getAccountBalance, setLeverage, setIsolatedMargin, placeMarketEntry, placeStopLoss, placeTakeProfit,
  getPositionRisk, getAllPositions, getOrderDeals, cancelAllOpenOrders, emergencyCloseMarket, getSymbolInfo,
};
