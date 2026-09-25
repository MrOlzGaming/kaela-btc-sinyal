// Eksekusi order di BingX Perpetual Futures (23 Sep 2026, Olan siapin akun "Kaela Access Real" --
// tujuan REAL dari awal, tapi mulai dari DEMO/VST dulu sesuai disiplin backtest->demo->real yang
// dipegang proyek ini). Struktur/interface SENGAJA disamain PERSIS `binanceExecutor.js` (factory
// createXClient({apiKey,apiSecret,testnet}), fungsi sama nama) -- caller (ninjaTrader.js
// dst) bisa tukar exec Binance<->BingX tanpa ubah logic, cuma beda `require()`.
//
// ⚠️ TEMUAN PENTING (23 Sep 2026, dites EMPIRIS bukan asumsi): "Separate Isolated Margin Mode"
// (multi-posisi 1 symbol) BingX TERNYATA gak bisa dikontrol dari API publik -- 2 order arah sama
// via endpoint standar TETAP DIGABUNG jadi 1 posisi (lihat memori project-kaela-channel-breakout).
// Jadi modul ini TETAP "1 akun 1 posisi per symbol", SAMA kayak Binance/MEXC -- BUKAN solusi
// layering, cuma exchange TAMBAHAN buat nampung slot terpisah (via 2 wallet USDT/USDC alami).
//
// Bedanya dari binanceExecutor.js:
//   - Base URL beda utk demo (open-api-vst.bingx.com, VST=virtual) vs real (open-api.bingx.com).
//   - Auth: signature HMAC-SHA256 HEX (bukan base64), header X-BX-APIKEY, symbol pakai HYPHEN
//     ("BTC-USDT", bukan "BTCUSDT").
//   - Akun ini HEDGE MODE aktif (dualSidePosition:true, dicek 23 Sep) -- SEMUA order WAJIB kirim
//     `positionSide` (LONG/SHORT) SELAIN `side` (BUY/SELL). Utk BUKA: side&positionSide searah
//     (buy->BUY+LONG, sell->SELL+SHORT). Utk TUTUP: side KEBALIKAN tapi positionSide TETAP SAMA
//     (verified empiris: tutup SHORT pakai side=BUY, positionSide=SHORT -- BUKAN LONG).
//   - `asset` buat getAccountBalance BEDA per mode: demo="VST" (virtual), real="USDT" -- caller
//     WAJIB pilih sendiri sesuai testnet, gak ada default yang bisa dipercaya bulat-bulat.

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
      BINGX_API_KEY: process.env.BINGX_API_KEY,
      BINGX_API_SECRET: process.env.BINGX_API_SECRET,
    };
  }
}

function roundToStepSize(quantity, stepSize, precision) {
  const rounded = Math.floor(quantity / stepSize) * stepSize;
  return parseFloat(rounded.toFixed(precision));
}

function createBingxClient({ apiKey, apiSecret, testnet }) {
  if (!apiKey || !apiSecret) {
    throw new Error('createBingxClient: apiKey/apiSecret wajib diisi.');
  }
  const baseUrl = testnet ? 'https://open-api-vst.bingx.com' : 'https://open-api.bingx.com';
  let symbolInfoCache = null;

  function sign(paramsStr) {
    return crypto.createHmac('sha256', apiSecret).update(paramsStr).digest('hex');
  }

  // BingX: params disortir alfabetis + timestamp DITEMPEL PALING BELAKANG (BUKAN ikut disortir --
  // beda dari Binance yang semua field termasuk timestamp ikut ke query builder biasa), signature
  // ditempel sbg query param TAMBAHAN (bukan header). Dipakai SAMA persis buat GET/POST/DELETE --
  // BingX gak bedain method buat cara sign, cuma method HTTP request-nya yang beda.
  async function signedRequest(method, path, params = {}) {
    const sortedKeys = Object.keys(params).sort();
    const base = sortedKeys.map((k) => `${k}=${params[k]}`).join('&');
    const paramsStr = (base ? base + '&' : '') + `timestamp=${Date.now()}`;
    const signature = sign(paramsStr);
    const url = `${baseUrl}${path}?${paramsStr}&signature=${signature}`;
    const res = await fetch(url, { method, headers: { 'X-BX-APIKEY': apiKey } });
    const data = await res.json();
    if (data.code !== 0) {
      const err = new Error(`BingX API error (code ${data.code}): ${data.msg}`);
      err.bingxCode = data.code;
      throw err;
    }
    return data.data;
  }

  async function getSymbolInfo(symbol) {
    if (!symbolInfoCache) {
      const res = await fetch(`${baseUrl}/openApi/swap/v2/quote/contracts`);
      const data = await res.json();
      symbolInfoCache = {};
      for (const c of data.data) symbolInfoCache[c.symbol] = c;
    }
    const info = symbolInfoCache[symbol];
    if (!info) throw new Error(`Simbol ${symbol} gak ketemu di quote/contracts BingX.`);
    return { stepSize: parseFloat(info.size), quantityPrecision: info.quantityPrecision, pricePrecision: info.pricePrecision, minNotionalUsd: info.tradeMinUSDT };
  }

  // `asset` WAJIB dioper caller eksplisit -- "VST" (demo) vs "USDT" (real) BEDA total, gak ada
  // default aman (lihat catatan header file). Balikin `availableMargin` (analog `availableBalance`
  // Binance -- saldo yang BENERAN bisa dipakai buka posisi baru, bukan `balance` total yg termasuk
  // margin yg udah ke-lock).
  async function getAccountBalance(asset) {
    const balances = await signedRequest('GET', '/openApi/swap/v3/user/balance', {});
    const bal = (balances || []).find((b) => b.asset === asset);
    return bal ? parseFloat(bal.availableMargin) : 0;
  }

  async function getWalletBalance(asset) {
    const balances = await signedRequest('GET', '/openApi/swap/v3/user/balance', {});
    const bal = (balances || []).find((b) => b.asset === asset);
    return bal ? parseFloat(bal.balance) : 0;
  }

  async function setIsolatedMargin(symbol) {
    return signedRequest('POST', '/openApi/swap/v2/trade/marginType', { symbol, marginType: 'ISOLATED' });
  }

  // `direction` nentuin positionSide (LONG/SHORT) buat BUKA posisi baru -- hedge mode WAJIB ini
  // ke-set BENAR sebelum entry, leverage per-side (LONG/SHORT beda slot) SAMA kayak Binance
  // per-symbol (BingX per-symbol PER-SIDE, sedikit beda -- set 2x kalau strategi bisa 2 arah).
  async function setLeverage(symbol, leverage, positionSide) {
    return signedRequest('POST', '/openApi/swap/v2/trade/leverage', { symbol, side: positionSide, leverage });
  }

  // Fallback SAJA -- ketemu 23 Sep 2026 (tes empiris VPS) BingX MARKET order balikin status
  // FILLED LANGSUNG di response POST awal (beda dari Binance yang butuh polling, lihat catatan
  // binanceExecutor.js). placeMarketEntry cek fast-path dulu, CUMA masuk sini kalau ternyata BELUM
  // filled di respons awal (jaga-jaga async fill langka, bukan perilaku normal yang diamati).
  async function waitForFill(symbol, orderId, attempts = 6, delayMs = 400) {
    for (let i = 0; i < attempts; i++) {
      const result = await signedRequest('GET', '/openApi/swap/v2/trade/order', { symbol, orderId }).catch(() => null);
      const order = result && result.order;
      if (order && order.status === 'FILLED' && parseFloat(order.executedQty) > 0) return order;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    throw new Error(`Order ${orderId} (${symbol}) belum FILLED setelah ${attempts}x cek -- cek manual via getPositionRisk sebelum lanjut apapun.`);
  }

  // BUKA posisi baru. `direction`: 'buy'->LONG, 'sell'->SHORT (side&positionSide SEARAH pas buka
  // -- beda dari tutup, lihat emergencyCloseMarket).
  async function placeMarketEntry({ symbol, direction, notionalUsd, livePrice }) {
    const { stepSize, quantityPrecision } = await getSymbolInfo(symbol);
    const rawQuantity = notionalUsd / livePrice;
    const quantity = roundToStepSize(rawQuantity, stepSize, quantityPrecision);
    if (quantity <= 0) throw new Error(`Quantity kehitung 0 buat ${symbol} (notional $${notionalUsd} kekecilan buat stepSize ${stepSize}) -- order gak dikirim.`);
    const side = direction === 'buy' ? 'BUY' : 'SELL';
    const positionSide = direction === 'buy' ? 'LONG' : 'SHORT';
    const placed = await signedRequest('POST', '/openApi/swap/v2/trade/order', { symbol, side, positionSide, type: 'MARKET', quantity, clientOrderId: generateKaelaClientOrderId() });
    if (placed.order.status === 'FILLED' && parseFloat(placed.order.executedQty) > 0) return placed.order;
    return waitForFill(symbol, placed.order.orderId);
  }

  async function getPositionRisk(symbol) {
    const positions = await signedRequest('GET', '/openApi/swap/v2/user/positions', { symbol });
    return (positions || [])[0] || null;
  }

  async function getAllPositions() {
    const positions = await signedRequest('GET', '/openApi/swap/v2/user/positions', {});
    return (positions || []).filter((p) => Math.abs(parseFloat(p.positionAmt)) > 0);
  }

  // Cek order pembuka TERBARU (pola SAMA persis binanceExecutor.js wasLastEntryOrderByKaela) --
  // dipakai positionReconciler.js bedain PASTI posisi Kaela vs manual, buat auto-close manual.
  async function wasLastEntryOrderByKaela(symbol, sinceMs = Date.now() - 24 * 3600 * 1000) {
    const orders = await signedRequest('GET', '/openApi/swap/v2/trade/allOrders', { symbol, startTime: sinceMs, limit: 50 });
    const openingOrders = (orders.orders || []).filter((o) => o.status === 'FILLED' && !o.reduceOnly);
    if (openingOrders.length === 0) return null;
    const latest = openingOrders.sort((a, b) => b.time - a.time)[0];
    return String(latest.clientOrderId || '').startsWith(KAELA_ORDER_PREFIX);
  }

  // TUTUP posisi -- `direction` di sini adalah ARAH POSISI ASLI (bukan arah order tutup): side
  // dibalik (buy->SELL, sell->BUY) TAPI positionSide TETAP SAMA kayak posisi aslinya (VERIFIED
  // EMPIRIS 23 Sep 2026: tutup SHORT = side BUY + positionSide SHORT, BUKAN LONG -- salah di sini
  // bisa kebuka posisi arah SEBALIKNYA alih-alih nutup yang ada).
  // ⚠️ `reduceOnly` SENGAJA GAK dikirim -- BingX TOLAK field ini di hedge mode ("In the Hedge
  // mode, the 'ReduceOnly' field can not be filled", ketemu 23 Sep 2026 tes empiris). Beda dari
  // Binance yang WAJIB reduceOnly:true. Di hedge mode, side+positionSide kebalik SUDAH CUKUP
  // nandain ini order penutup (exchange yang nentuin otomatis, bukan flag eksplisit).
  async function emergencyCloseMarket({ symbol, direction, quantity }) {
    const closeSide = direction === 'buy' ? 'SELL' : 'BUY';
    const positionSide = direction === 'buy' ? 'LONG' : 'SHORT';
    return signedRequest('POST', '/openApi/swap/v2/trade/order', { symbol, side: closeSide, positionSide, type: 'MARKET', quantity });
  }

  async function cancelAllOpenOrders(symbol) {
    return signedRequest('DELETE', '/openApi/swap/v2/trade/allOpenOrders', { symbol });
  }

  return {
    getAccountBalance, getWalletBalance, setLeverage, setIsolatedMargin, placeMarketEntry,
    getPositionRisk, getAllPositions, cancelAllOpenOrders, getSymbolInfo, roundToStepSize,
    emergencyCloseMarket, wasLastEntryOrderByKaela,
  };
}

// ============ Wrapper backward-compatible (pola SAMA persis binanceExecutor.js) -- akun default
// Olan sendiri dari secrets.js (BINGX_API_KEY/SECRET), testnet ikut killSwitch.js GLOBAL kalau
// caller gak spesifikasiin (ninjaTrader.js dkk sebaiknya bikin instance sendiri via
// createBingxClient LANGSUNG, sama pola kayak Channel Breakout treatment ke binanceExecutor.js --
// JANGAN numpang wrapper default ini kalau butuh saklar independen per-strategi).
let _defaultClientInstance = null;
function _defaultClient() {
  if (_defaultClientInstance) return _defaultClientInstance;
  const secrets = loadSecrets();
  if (!secrets.BINGX_API_KEY || !secrets.BINGX_API_SECRET) {
    throw new Error('BINGX_API_KEY/BINGX_API_SECRET belum di-setup (secrets.js atau env var) -- gak bisa eksekusi order BingX.');
  }
  const { isTestnet } = require('./killSwitch');
  _defaultClientInstance = createBingxClient({ apiKey: secrets.BINGX_API_KEY, apiSecret: secrets.BINGX_API_SECRET, testnet: isTestnet() });
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
  createBingxClient, loadSecrets,
  getAccountBalance, getWalletBalance, setLeverage, setIsolatedMargin, placeMarketEntry,
  getPositionRisk, getAllPositions, cancelAllOpenOrders, getSymbolInfo, roundToStepSize,
  emergencyCloseMarket, wasLastEntryOrderByKaela, KAELA_ORDER_PREFIX,
};
