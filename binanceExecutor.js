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

// Bulatin quantity ke stepSize simbol -- WAJIB, order dengan presisi salah otomatis DITOLAK Binance.
// (Fungsi murni, gak butuh kredensial -- tetap top-level, dipakai caller di luar client juga.)
function roundToStepSize(quantity, stepSize, precision) {
  const rounded = Math.floor(quantity / stepSize) * stepSize;
  return parseFloat(rounded.toFixed(precision));
}

// ============ Factory client (23 Agu 2026) -- REFACTOR biar bisa dipakai MULTI-AKUN sekaligus
// (eksekutor Kaela Pro Trader, APPS/kaela-multi-akun/) TANPA ubah perilaku pemakai LAMA (Sniper
// live monitor, Nyopet auto-trader, localLiveExecutor.js -- semua itu masih pakai akun Olan
// sendiri dari secrets.js/env var, TIDAK BOLEH regresi). Sebelumnya semua fungsi baca kredensial
// & isTestnet() dari GLOBAL state (loadSecrets()/killSwitch.js) -- gak bisa dipanggil paralel buat
// akun BEDA (state ke-share/ketimpa). Sekarang: createBinanceClient({apiKey, apiSecret, testnet})
// balikin OBJECT independen isinya semua fungsi yang sama, kredensial+base URL ke-CLOSURE per
// instance -- symbolInfoCache juga per-instance (bukan module-level lagi) biar aman dipanggil
// PARALEL buat banyak akun tanpa numpuk cache silang exchange (harusnya sama isinya sih, tapi
// per-instance lebih aman dan gampang dinalar).
function createBinanceClient({ apiKey, apiSecret, testnet }) {
  if (!apiKey || !apiSecret) {
    throw new Error('createBinanceClient: apiKey/apiSecret wajib diisi.');
  }
  const baseUrl = testnet ? 'https://demo-fapi.binance.com' : 'https://fapi.binance.com';
  let symbolInfoCache = null;

  function sign(queryString) {
    return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
  }

  async function signedRequestOnce(method, path, params) {
    // recvWindow dinaikin dari 5000->15000 (31 Agu 2026, ketemu jam komputer lokal ketinggalan
    // ~5 detik dari server Binance, PAS di batas 5000ms lama -- retry-sekali di bawah GAK NOLONG
    // krn selisih jamnya PERSISTEN, bukan gangguan jaringan sesaat kayak dikira sebelumnya).
    // Binance izinin sampai 60000ms -- 15000 kasih headroom 3x dari drift yang kejadian, masih
    // jauh di bawah limit, akar masalah (W32Time service mati di komputer) tetap perlu dibenerin
    // manual sama Olan, ini cuma bikin sistem lebih tahan banting sambil itu belum kesentuh.
    const query = new URLSearchParams({ ...params, timestamp: Date.now(), recvWindow: 15000 }).toString();
    const signature = sign(query);
    const url = `${baseUrl}${path}?${query}&signature=${signature}`;
    const res = await fetch(url, { method, headers: { 'X-MBX-APIKEY': apiKey } });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(`Binance API error (HTTP ${res.status}): ${JSON.stringify(data)}`);
      err.binanceCode = data.code;
      throw err;
    }
    return data;
  }

  // Retry SEKALI (22 Agu 2026, ketemu pas tes -- error -1021 timestamp/recvWindow sesekali
  // kejadian murni gangguan jaringan sesaat). Timestamp DIGENERATE ULANG tiap percobaan.
  async function signedRequest(method, path, params = {}) {
    try {
      return await signedRequestOnce(method, path, params);
    } catch (e) {
      if (e.binanceCode === -1021) {
        console.log('[BinanceExecutor] Timestamp/recvWindow error, retry sekali...');
        await new Promise((r) => setTimeout(r, 500));
        return signedRequestOnce(method, path, params);
      }
      throw e;
    }
  }

  async function getSymbolInfo(symbol) {
    if (!symbolInfoCache) {
      const res = await fetch(`${baseUrl}/fapi/v1/exchangeInfo`);
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

  // asset param (23 Agu 2026, "usdt untuk sniper, usdc untuk nyopet" -- 2 wallet margin TERPISAH,
  // multiAssetsMargin OFF) -- default TETAP 'USDT' biar caller lama (Sniper) gak perlu ubah apa-apa.
  async function getAccountBalance(asset = 'USDT') {
    const balances = await signedRequest('GET', '/fapi/v2/balance', {});
    const bal = balances.find((b) => b.asset === asset);
    return bal ? parseFloat(bal.availableBalance) : 0;
  }

  async function setLeverage(symbol, leverage) {
    return signedRequest('POST', '/fapi/v1/leverage', { symbol, leverage });
  }

  // Riwayat income (23-24 Agu 2026, buat laporan saldo admin Kaela Pro Trader) -- Binance udah
  // misahin sendiri per incomeType: 'TRANSFER' (setor/tarik dana) vs 'REALIZED_PNL'/'FUNDING_FEE'/
  // 'COMMISSION'/dst (hasil trading beneran). Gak butuh symbol -- ambil SEMUA aset di akun itu.
  async function getIncomeHistory(startTimeMs, limit = 1000) {
    return signedRequest('GET', '/fapi/v1/income', { startTime: startTimeMs, limit });
  }

  // Isolated margin -- LIKUIDASI isolated itu sendiri jadi SL (gak pakai order SL terpisah).
  // -4046 "No need to change margin type" BUKAN error fatal -- artinya emang udah isolated.
  async function setIsolatedMargin(symbol) {
    try {
      return await signedRequest('POST', '/fapi/v1/marginType', { symbol, marginType: 'ISOLATED' });
    } catch (e) {
      if (e.binanceCode === -4046) return { alreadyIsolated: true };
      throw e;
    }
  }

  // BUG ketemu 23 Agu 2026: respons LANGSUNG dari POST /fapi/v1/order MARKET kadang balik
  // SEBELUM fill-nya kelar diproses -- executedQty/avgPrice masih "0" padahal beneran FILLED
  // sepersekian detik kemudian. Fix: poll ULANG (GET /fapi/v1/order) sampai FILLED.
  async function waitForFill(symbol, orderId, attempts = 6, delayMs = 400) {
    for (let i = 0; i < attempts; i++) {
      const order = await signedRequest('GET', '/fapi/v1/order', { symbol, orderId });
      if (order.status === 'FILLED' && parseFloat(order.executedQty) > 0) return order;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    throw new Error(`Order ${orderId} (${symbol}) belum FILLED setelah ${attempts}x cek -- cek manual via getPositionRisk sebelum lanjut apapun.`);
  }

  // Entry MARKET order. `notionalUsd` = nilai posisi dalam USD (hasil calculator.js `nilaiPosisi`),
  // dikonversi ke quantity base-asset (BTC/dst) pakai harga live, dibulatin ke stepSize simbol.
  async function placeMarketEntry({ symbol, direction, notionalUsd, livePrice }) {
    const { stepSize, quantityPrecision } = await getSymbolInfo(symbol);
    const rawQuantity = notionalUsd / livePrice;
    const quantity = roundToStepSize(rawQuantity, stepSize, quantityPrecision);
    if (quantity <= 0) throw new Error(`Quantity kehitung 0 buat ${symbol} (notional $${notionalUsd} kekecilan buat stepSize ${stepSize}) -- order gak dikirim.`);
    const side = direction === 'buy' ? 'BUY' : 'SELL';
    const placed = await signedRequest('POST', '/fapi/v1/order', { symbol, side, type: 'MARKET', quantity });
    return waitForFill(symbol, placed.orderId);
  }

  // SL/TP sebagai order EXCHANGE-NATIVE (STOP_MARKET/TAKE_PROFIT_MARKET via /fapi/v1/algoOrder,
  // reduceOnly=true, migrasi Binance per 9 Des 2025) -- tetap eksekusi walau server kita mati.
  async function placeStopLoss({ symbol, direction, stopPrice, quantity }) {
    const closeSide = direction === 'buy' ? 'SELL' : 'BUY';
    const { pricePrecision } = await getSymbolInfo(symbol);
    return signedRequest('POST', '/fapi/v1/algoOrder', {
      algoType: 'CONDITIONAL', symbol, side: closeSide, type: 'STOP_MARKET',
      triggerPrice: stopPrice.toFixed(pricePrecision), quantity, reduceOnly: true,
    });
  }

  async function placeTakeProfit({ symbol, direction, tpPrice, quantity }) {
    const closeSide = direction === 'buy' ? 'SELL' : 'BUY';
    const { pricePrecision } = await getSymbolInfo(symbol);
    return signedRequest('POST', '/fapi/v1/algoOrder', {
      algoType: 'CONDITIONAL', symbol, side: closeSide, type: 'TAKE_PROFIT_MARKET',
      triggerPrice: tpPrice.toFixed(pricePrecision), quantity, reduceOnly: true,
    });
  }

  async function getPositionRisk(symbol) {
    const positions = await signedRequest('GET', '/fapi/v2/positionRisk', { symbol });
    return positions[0] || null;
  }

  // 2-3 Sep 2026, permintaan Olan (positionReconciler.js: "pengawas posisi" Wibowo Hedgefund) --
  // "ketika Olan trading aset lain (ZIL dll) di luar mode Kaela (cuma BTC+Emas), tetep dapet
  // pesan+jurnal". Endpoint /fapi/v2/positionRisk TANPA `symbol` balikin SEMUA symbol di akun
  // (bukan cuma yang bot kenal) -- filter positionAmt!=0 di sini (endpoint balikin SEMUA symbol
  // termasuk yang kosong, kalau gak difilter responsnya bisa ratusan baris gak berguna).
  async function getAllPositions() {
    const positions = await signedRequest('GET', '/fapi/v2/positionRisk', {});
    return (positions || []).filter((p) => Math.abs(parseFloat(p.positionAmt)) > 0);
  }

  // Jaring pengaman TERAKHIR -- kalau SL/TP gagal nempel SETELAH entry berhasil, posisi TIDAK
  // BOLEH dibiarin nganggur tanpa proteksi. Market close LANGSUNG (arah kebalikan entry).
  async function emergencyCloseMarket({ symbol, direction, quantity }) {
    const closeSide = direction === 'buy' ? 'SELL' : 'BUY';
    return signedRequest('POST', '/fapi/v1/order', { symbol, side: closeSide, type: 'MARKET', quantity, reduceOnly: true });
  }

  async function cancelAllOpenOrders(symbol) {
    return signedRequest('DELETE', '/fapi/v1/allOpenOrders', { symbol });
  }

  return {
    getAccountBalance, setLeverage, setIsolatedMargin, placeMarketEntry, placeStopLoss, placeTakeProfit,
    getPositionRisk, getAllPositions, cancelAllOpenOrders, getSymbolInfo, roundToStepSize, emergencyCloseMarket, getIncomeHistory,
  };
}

// ============ Wrapper backward-compatible (akun Olan sendiri, secrets.js/env + killSwitch.js) --
// SEMUA caller LAMA (sniperLiveMonitor.js, nyopetAutoTrader.js, localLiveExecutor.js) tetap panggil
// gaya lama (module-level function, gak per-instance) -- ZERO perubahan perilaku, cuma nge-delegate
// ke createBinanceClient() pakai kredensial GLOBAL yang sama kayak sebelumnya. SINGLETON per proses
// (bukan bikin instance baru tiap panggilan) -- biar symbolInfoCache-nya TETAP kepakai lintas
// pemanggilan dalam 1x run kayak perilaku asli SEBELUM refactor ini (module-level cache).
let _defaultClientInstance = null;
function _defaultClient() {
  if (_defaultClientInstance) return _defaultClientInstance;
  const secrets = loadSecrets();
  if (!secrets.BINANCE_API_KEY || !secrets.BINANCE_API_SECRET) {
    throw new Error('BINANCE_API_KEY/BINANCE_API_SECRET belum di-setup (secrets.js atau env var) -- gak bisa eksekusi order real.');
  }
  const { isTestnet } = require('./killSwitch');
  _defaultClientInstance = createBinanceClient({ apiKey: secrets.BINANCE_API_KEY, apiSecret: secrets.BINANCE_API_SECRET, testnet: isTestnet() });
  return _defaultClientInstance;
}

async function getAccountBalance(asset = 'USDT') { return _defaultClient().getAccountBalance(asset); }
async function setLeverage(symbol, leverage) { return _defaultClient().setLeverage(symbol, leverage); }
async function setIsolatedMargin(symbol) { return _defaultClient().setIsolatedMargin(symbol); }
async function placeMarketEntry(args) { return _defaultClient().placeMarketEntry(args); }
async function placeStopLoss(args) { return _defaultClient().placeStopLoss(args); }
async function placeTakeProfit(args) { return _defaultClient().placeTakeProfit(args); }
async function getPositionRisk(symbol) { return _defaultClient().getPositionRisk(symbol); }
async function cancelAllOpenOrders(symbol) { return _defaultClient().cancelAllOpenOrders(symbol); }
async function getSymbolInfo(symbol) { return _defaultClient().getSymbolInfo(symbol); }
async function emergencyCloseMarket(args) { return _defaultClient().emergencyCloseMarket(args); }

module.exports = {
  createBinanceClient,
  getAccountBalance, setLeverage, setIsolatedMargin, placeMarketEntry, placeStopLoss, placeTakeProfit,
  getPositionRisk, cancelAllOpenOrders, getSymbolInfo, roundToStepSize, emergencyCloseMarket,
};
