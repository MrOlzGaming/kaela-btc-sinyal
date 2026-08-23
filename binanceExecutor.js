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

// demo-fapi.binance.com (22 Agu 2026) -- Binance "Demo Trading" resmi, TERBARU, nempel ke akun
// asli (bukan testnet.binancefuture.com yang lama/API key terpisah). Key yang di-generate dari
// demo.binance.com/.../api-management CUMA jalan di endpoint ini, bukan endpoint testnet lama.
function baseUrl() {
  const { isTestnet } = require('./killSwitch');
  return isTestnet() ? 'https://demo-fapi.binance.com' : 'https://fapi.binance.com';
}

function sign(queryString, secret) {
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

async function signedRequestOnce(method, path, params) {
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
    const err = new Error(`Binance API error (HTTP ${res.status}): ${JSON.stringify(data)}`);
    err.binanceCode = data.code;
    throw err;
  }
  return data;
}

// Retry SEKALI (22 Agu 2026, ketemu pas tes -- error -1021 timestamp/recvWindow sesekali kejadian
// murni gangguan jaringan sesaat, BUKAN masalah jam sistem -- dicek langsung, selisih cuma ~1,5
// detik, jauh di bawah batas 5 detik). Timestamp DIGENERATE ULANG tiap percobaan (signedRequestOnce
// bikin baru tiap dipanggil), jadi retry beneran dapet timestamp fresh, bukan yang basi.
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

// asset param (23 Agu 2026, permintaan Olan: "usdt untuk sniper, usdc untuk nyopet" -- 2 wallet
// margin TERPISAH di Binance Demo, `multiAssetsMargin` OFF jadi USDT/USDC gak saling nyambung
// buat margin) -- default TETAP 'USDT' biar caller lama (Sniper) gak perlu ubah apa-apa.
async function getAccountBalance(asset = 'USDT') {
  const balances = await signedRequest('GET', '/fapi/v2/balance', {});
  const bal = balances.find((b) => b.asset === asset);
  return bal ? parseFloat(bal.availableBalance) : 0;
}

async function setLeverage(symbol, leverage) {
  return signedRequest('POST', '/fapi/v1/leverage', { symbol, leverage });
}

// BUG ketemu 23 Agu 2026 (posisi short beneran kejadian live): respons LANGSUNG dari POST
// /fapi/v1/order MARKET kadang balik SEBELUM fill-nya kelar diproses di demo-fapi.binance.com --
// executedQty/avgPrice masih "0"/kosong padahal order itu SENDIRI beneran udah FILLED sepersekian
// detik kemudian (dicek manual pakai GET /fapi/v1/order, ketauan status FILLED + executedQty benar).
// Caller (SL/TP attach, emergency-close) yang percaya buta ke angka 0 itu bisa nyangka quantity-nya
// nol -> SL gagal nempel -> posisi kebuka TELANJANG tanpa proteksi. Fix: begitu POST balik, poll
// ULANG statusnya (GET /fapi/v1/order) sampai FILLED, JANGAN percaya angka di respons POST awal.
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

// SL/TP sebagai order EXCHANGE-NATIVE (STOP_MARKET/TAKE_PROFIT_MARKET, reduceOnly=true) -- tetap
// eksekusi walau server/internet kita lagi mati, gak nunggu monitoring manual.
//
// FIX 22 Agu 2026 (ketemu pas tes demo beneran, error -4120): Binance migrasi SEMUA conditional
// order (STOP_MARKET/TAKE_PROFIT_MARKET/dst) ke endpoint BARU /fapi/v1/algoOrder per 9 Des 2025 --
// endpoint /fapi/v1/order LAMA nolak order jenis ini sekarang ("gunakan Algo Order API").
// Bedanya: path beda, WAJIB `algoType: 'CONDITIONAL'`, param harga trigger namanya `triggerPrice`
// (bukan `stopPrice` lagi).
async function placeStopLoss({ symbol, direction, stopPrice, quantity }) {
  const closeSide = direction === 'buy' ? 'SELL' : 'BUY'; // order penutup arahnya KEBALIKAN dari entry
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

// Jaring pengaman TERAKHIR (22 Agu 2026) -- kalau SL/TP gagal nempel SETELAH entry berhasil,
// posisi TIDAK BOLEH dibiarin nganggur tanpa proteksi. Market close LANGSUNG (arah kebalikan
// entry, reduceOnly) -- lebih baik keluar rugi kecil/breakeven drpd nyangkut leverage tanpa SL.
async function emergencyCloseMarket({ symbol, direction, quantity }) {
  const closeSide = direction === 'buy' ? 'SELL' : 'BUY';
  return signedRequest('POST', '/fapi/v1/order', { symbol, side: closeSide, type: 'MARKET', quantity, reduceOnly: true });
}

async function cancelAllOpenOrders(symbol) {
  return signedRequest('DELETE', '/fapi/v1/allOpenOrders', { symbol });
}

module.exports = {
  getAccountBalance, setLeverage, placeMarketEntry, placeStopLoss, placeTakeProfit,
  getPositionRisk, cancelAllOpenOrders, getSymbolInfo, roundToStepSize, emergencyCloseMarket,
};
