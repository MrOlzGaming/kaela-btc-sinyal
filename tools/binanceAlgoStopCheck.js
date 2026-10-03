// tools/binanceAlgoStopCheck.js (4 Okt 2026, audit malam) -- verifikasi EMPIRIS di Binance DEMO (testnet, uang palsu):
// placeStopLoss pakai endpoint ALGO baru (/fapi/v1/algoOrder, migrasi Binance Des 2025), tapi cancelAllOpenOrders pakai
// /fapi/v1/allOpenOrders (endpoint order biasa). Pertanyaan: SL algo ikut kebatal gak? Kalau nggak, trailing Sniper BTC
// (cancel + pasang ulang tiap naik) bakal NUMPUK SL lama, dan TP algo lama bisa nyangkut.
// Langkah (BTCUSDT demo, semua dibersihin di akhir): buka LONG mini -> pasang SL algo -> cek daftar algo terbuka ->
// cancelAllOpenOrders -> cek lagi -> (kalau masih ada) coba DELETE /fapi/v1/algoOpenOrders -> cek lagi -> tutup posisi.
// Pakai (dari VPS): node tools/binanceAlgoStopCheck.js
const crypto = require('crypto');
const binance = require('../binanceExecutor');
const s = require('../secrets');

const SYMBOL = 'BTCUSDT';
const BASE = 'https://demo-fapi.binance.com';

async function raw(method, path, params = {}) {
  const qs = new URLSearchParams({ ...params, timestamp: Date.now(), recvWindow: 10000 }).toString();
  const sig = crypto.createHmac('sha256', s.BINANCE_API_SECRET).update(qs).digest('hex');
  const res = await fetch(`${BASE}${path}?${qs}&signature=${sig}`, { method, headers: { 'X-MBX-APIKEY': s.BINANCE_API_KEY } });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}
async function listAlgo() {
  for (const p of ['/fapi/v1/openAlgoOrders', '/fapi/v1/algo/openOrders']) {
    const r = await raw('GET', p, { symbol: SYMBOL });
    if (r.ok) return { path: p, orders: Array.isArray(r.data) ? r.data : (r.data.orders || r.data.rows || r.data) };
  }
  return { path: null, orders: null };
}

(async () => {
  const ex = binance.createBinanceClient({ apiKey: s.BINANCE_API_KEY, apiSecret: s.BINANCE_API_SECRET, testnet: true });
  const pos0 = await ex.getPositionRisk(SYMBOL);
  if (pos0 && Math.abs(parseFloat(pos0.positionAmt)) > 0) { console.log('Ada posisi BTCUSDT di demo -- batal biar gak ganggu sistem.'); process.exit(2); }
  const t = await (await fetch(`${BASE}/fapi/v1/ticker/price?symbol=${SYMBOL}`)).json();
  const live = parseFloat(t.price);
  console.log('Harga demo', live);
  await ex.setLeverage(SYMBOL, 5).catch(() => {});
  const fill = await ex.placeMarketEntry({ symbol: SYMBOL, direction: 'buy', notionalUsd: 130, livePrice: live });
  const qty = parseFloat(fill.executedQty);
  console.log('Posisi LONG', qty, '@', fill.avgPrice);
  try {
    const sl1 = await ex.placeStopLoss({ symbol: SYMBOL, direction: 'buy', stopPrice: live * 0.97, quantity: qty });
    console.log('SL algo #1 dipasang:', JSON.stringify(sl1).slice(0, 160));
    let l = await listAlgo();
    console.log(`Daftar algo terbuka (${l.path}):`, l.orders ? l.orders.length : 'GAK BISA DIBACA');
    await ex.cancelAllOpenOrders(SYMBOL);
    l = await listAlgo();
    const sisa = l.orders ? l.orders.length : null;
    console.log('Setelah cancelAllOpenOrders (/fapi/v1/allOpenOrders) -> sisa algo:', sisa);
    if (sisa) {
      for (const p of ['/fapi/v1/algoOpenOrders', '/fapi/v1/algo/openOrders']) {
        const r = await raw('DELETE', p, { symbol: SYMBOL });
        console.log(`DELETE ${p} ->`, r.status, JSON.stringify(r.data).slice(0, 140));
        if (r.ok) break;
      }
      l = await listAlgo();
      console.log('Setelah cancel algo -> sisa:', l.orders ? l.orders.length : 'GAK BISA DIBACA');
    }
    console.log(sisa === 0 ? '\nHASIL: cancelAllOpenOrders IKUT ngebatalin SL algo -- trailing aman.' : '\nHASIL: cancelAllOpenOrders TIDAK ngebatalin SL algo -- PERLU FIX.');
  } finally {
    await ex.cancelAllOpenOrders(SYMBOL).catch(() => {});
    await raw('DELETE', '/fapi/v1/algoOpenOrders', { symbol: SYMBOL }).catch(() => {});
    const p = await ex.getPositionRisk(SYMBOL);
    const amt = p ? Math.abs(parseFloat(p.positionAmt)) : 0;
    if (amt > 0) await ex.emergencyCloseMarket({ symbol: SYMBOL, direction: 'buy', quantity: amt });
    const p2 = await ex.getPositionRisk(SYMBOL);
    console.log('Bersih-bersih: posisi sisa', p2 ? p2.positionAmt : 0);
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
