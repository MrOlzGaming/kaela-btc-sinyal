// Eksekusi LIVE Compound Alt DCA + Musiman/Spot BTC (29 Agu 2026, permintaan Olan: "semua
// tradingan Kaela web itu pionir buat diikuti realistic" -- 2 sistem terakhir yang masih shadow
// doang, dibikin live kayak Sniper/Nyopet). LOCAL ONLY -- sama alasan localLiveExecutor.js: server
// GitHub Actions (Azure US) DIBLOKIR Binance (HTTP 451), spotDcaAlt.js/spotDca.js (cloud) cuma
// nyatet RENCANA beli/jual ke `state.pendingLiveBuy`/`pendingLiveSell`, eksekusi beneran di sini.
//
// DEMO DULU (Spot Testnet, testnet.binance.vision) -- BEDA TOTAL dari Demo Futures yang dipakai
// Sniper/Nyopet (demo-fapi.binance.com), akun/kredensial terpisah (BINANCE_SPOT_TESTNET_API_KEY
// di secrets.js). Real (mainnet asli) NANTI nyusul kalau demo udah lama teruji -- pola sama kayak
// Sniper/Nyopet dulu.
//
// 2 state file, BENTUK pendingLiveBuy BEDA (Alt = multi-koin {amounts:{symbol:usd}}, Musiman =
// 1 koin {usdAmount}) -- JANGAN disamain paksa, handler terpisah per file.

const fs = require('fs');
const path = require('path');
const { createBinanceSpotEarnClient } = require('./binanceSpotEarnExecutor');
const { sendWhatsApp } = require('./fonnte');
const realLeg = require('./spotRealLeg');

const SPOT_ALT_PATH = path.join(__dirname, 'kaela-spot-alt.json');
const SPOT_MUSIMAN_PATH = path.join(__dirname, 'kaela-spot.json');
const MUSIMAN_SYMBOL = 'BTCUSDT';

function loadSecrets() {
  try { return require('./secrets'); } catch { return {}; }
}
function loadJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function saveJson(p, state) { fs.writeFileSync(p, JSON.stringify(state, null, 2)); }

function coinLabel(symbol) { return symbol.replace('USDT', ''); }

// ============ Compound Alt (multi-koin) ============
async function runAltPendingBuy(client, state) {
  const pending = state.pendingLiveBuy;
  if (!pending) return null;
  const results = [];
  for (const [symbol, usdAmount] of Object.entries(pending.amounts)) {
    try {
      const order = await client.placeSpotMarketBuy({ symbol, quoteOrderQty: usdAmount });
      results.push(`✅ ${coinLabel(symbol)}: $${usdAmount.toFixed(2)} -> ${order.executedQty} @ $${order.avgPrice.toFixed(4)}`);
      console.log(`[SpotAltLiveExecutor] BELI LIVE ${symbol}: qty ${order.executedQty} @ $${order.avgPrice}`);
    } catch (e) {
      results.push(`❌ ${coinLabel(symbol)}: GAGAL -- ${e.message}`);
      console.log(`[SpotAltLiveExecutor] ERROR beli ${symbol}:`, e.message);
    }
  }
  delete state.pendingLiveBuy;
  saveJson(SPOT_ALT_PATH, state);
  return results;
}

async function runAltPendingSell(client, state) {
  const pending = state.pendingLiveSell;
  if (!pending) return null;
  const results = [];
  for (const [symbol, qty] of Object.entries(pending.symbols)) {
    try {
      const order = await client.placeSpotMarketSell({ symbol, quantity: qty });
      results.push(`✅ ${coinLabel(symbol)}: ${order.executedQty} -> $${order.cumulativeQuote.toFixed(2)} @ $${order.avgPrice.toFixed(4)}`);
      console.log(`[SpotAltLiveExecutor] JUAL LIVE ${symbol}: qty ${order.executedQty} @ $${order.avgPrice}`);
    } catch (e) {
      results.push(`❌ ${coinLabel(symbol)}: GAGAL -- ${e.message}`);
      console.log(`[SpotAltLiveExecutor] ERROR jual ${symbol}:`, e.message);
    }
  }
  delete state.pendingLiveSell;
  saveJson(SPOT_ALT_PATH, state);
  return results;
}

// ============ Leg REAL (3 Okt 2026, spotRealLeg.js) -- rencana SAMA demo, saldo spot USDT real doang ============
function realClientOrNull() {
  if (!realLeg.loadConfig().allowReal) return null;
  const s = loadSecrets();
  if (!s.BINANCE_API_KEY_REAL || !s.BINANCE_API_SECRET_REAL) return null;
  return createBinanceSpotEarnClient({ apiKey: s.BINANCE_API_KEY_REAL, apiSecret: s.BINANCE_API_SECRET_REAL, testnet: false });
}
async function runRealLeg(label, bucket, buyAmounts, sellSymbols) {
  const rc = realClientOrNull();
  if (!rc || (!buyAmounts && !sellSymbols)) return;
  const ledger = realLeg.loadLedger();
  const out = [];
  try {
    if (buyAmounts) {
      const r = await realLeg.realBuys(rc, ledger, bucket, buyAmounts, new Date(), Number(realLeg.loadConfig().realBudgetUsd) || 0);
      out.push(...r.lines);
      if (r.skippedLowBalance) console.log(`[SpotAltLiveExecutor] REAL ${label}: ${r.skippedLowBalance} beli di-skip (anggaran realBudgetUsd / saldo USDT spot real kurang).`);
    }
    if (sellSymbols) { const r = await realLeg.realSells(rc, ledger, bucket, sellSymbols); out.push(...r.lines); }
  } catch (e) { out.push(`❌ GAGAL akses akun real: ${e.message}`); }
  realLeg.saveLedger(ledger);
  if (out.length) {
    console.log(`[SpotAltLiveExecutor] REAL ${label}:\n${out.join('\n')}`);
    await require('./wibowoNotify').sendWhatsAppToWibowo(`💰 BINANCE REAL (Spot) -- ${label}:\n\n${out.join('\n')}\n\n— Kaela`).catch((e) => console.log('[SpotAltLiveExecutor] WA Wibowo gagal:', e.message));
  }
}

async function processCompoundAlt(client) {
  const state = loadJson(SPOT_ALT_PATH);
  if (!state) { console.log('[SpotAltLiveExecutor] kaela-spot-alt.json belum ada, skip Compound Alt.'); return; }
  if (!state.pendingLiveBuy && !state.pendingLiveSell) {
    console.log('[SpotAltLiveExecutor] Compound Alt: gak ada rencana baru yang belum dieksekusi live.');
    return;
  }
  // rencana disalin DULU (fungsi demo di bawah ngehapus pending abis jalan) -> leg real pakai rencana yang SAMA
  const realBuy = state.pendingLiveBuy ? { ...state.pendingLiveBuy.amounts } : null;
  const realSell = state.pendingLiveSell ? Object.keys(state.pendingLiveSell.symbols || {}) : null;
  if (client) {
    const buyResults = await runAltPendingBuy(client, state);
    if (buyResults) await sendWhatsApp(`🧪 BINANCE DEMO (Spot Testnet) -- Eksekusi live Compound Alt:\n\n${buyResults.join('\n')}`);
    const sellResults = await runAltPendingSell(client, state);
    if (sellResults) await sendWhatsApp(`🧪 BINANCE DEMO (Spot Testnet) -- Eksekusi live jual Compound Alt:\n\n${sellResults.join('\n')}`);
  } else {
    delete state.pendingLiveBuy; delete state.pendingLiveSell; saveJson(SPOT_ALT_PATH, state);
  }
  await runRealLeg('Compound Alt DCA', 'alt', realBuy, realSell);
}

// ============ Musiman / Spot BTC (1 koin) ============
async function processMusiman(client) {
  const state = loadJson(SPOT_MUSIMAN_PATH);
  if (!state) { console.log('[SpotAltLiveExecutor] kaela-spot.json belum ada, skip Musiman.'); return; }
  if (!state.pendingLiveBuy && !state.pendingLiveSell) {
    console.log('[SpotAltLiveExecutor] Musiman: gak ada rencana baru yang belum dieksekusi live.');
    return;
  }

  const realBuy = state.pendingLiveBuy ? { [MUSIMAN_SYMBOL]: state.pendingLiveBuy.usdAmount } : null;
  const realSell = state.pendingLiveSell ? [MUSIMAN_SYMBOL] : null;
  if (!client) { delete state.pendingLiveBuy; delete state.pendingLiveSell; saveJson(SPOT_MUSIMAN_PATH, state); }

  if (client && state.pendingLiveBuy) {
    const { usdAmount } = state.pendingLiveBuy;
    try {
      const order = await client.placeSpotMarketBuy({ symbol: MUSIMAN_SYMBOL, quoteOrderQty: usdAmount });
      console.log(`[SpotAltLiveExecutor] BELI LIVE Musiman ${MUSIMAN_SYMBOL}: qty ${order.executedQty} @ $${order.avgPrice}`);
      await sendWhatsApp(`🧪 BINANCE DEMO (Spot Testnet) -- Eksekusi live Musiman:\n\n✅ BTC: $${usdAmount.toFixed(2)} -> ${order.executedQty} @ $${order.avgPrice.toFixed(2)}`);
    } catch (e) {
      console.log('[SpotAltLiveExecutor] ERROR beli Musiman:', e.message);
      await sendWhatsApp(`🧪 BINANCE DEMO (Spot Testnet) -- Eksekusi live Musiman GAGAL:\n\n❌ BTC: ${e.message}`);
    }
    delete state.pendingLiveBuy;
    saveJson(SPOT_MUSIMAN_PATH, state);
  }

  if (client && state.pendingLiveSell) {
    const { qty } = state.pendingLiveSell;
    try {
      const order = await client.placeSpotMarketSell({ symbol: MUSIMAN_SYMBOL, quantity: qty });
      console.log(`[SpotAltLiveExecutor] JUAL LIVE Musiman ${MUSIMAN_SYMBOL}: qty ${order.executedQty} @ $${order.avgPrice}`);
      await sendWhatsApp(`🧪 BINANCE DEMO (Spot Testnet) -- Eksekusi live jual Musiman:\n\n✅ BTC: ${order.executedQty} -> $${order.cumulativeQuote.toFixed(2)} @ $${order.avgPrice.toFixed(2)}`);
    } catch (e) {
      console.log('[SpotAltLiveExecutor] ERROR jual Musiman:', e.message);
      await sendWhatsApp(`🧪 BINANCE DEMO (Spot Testnet) -- Eksekusi live jual Musiman GAGAL:\n\n❌ BTC: ${e.message}`);
    }
    delete state.pendingLiveSell;
    saveJson(SPOT_MUSIMAN_PATH, state);
  }
  await runRealLeg('Musiman BTC', 'musiman', realBuy, realSell);
}

async function main() {
  const secrets = loadSecrets();
  let client = null; // demo (Spot Testnet) -- kalau key-nya gak ada, leg real TETAP jalan sendiri
  if (!secrets.BINANCE_SPOT_TESTNET_API_KEY || !secrets.BINANCE_SPOT_TESTNET_API_SECRET) {
    console.log('[SpotAltLiveExecutor] BINANCE_SPOT_TESTNET_API_KEY/SECRET belum diisi -- leg demo skip (real tetap dicek).');
  } else {
    client = createBinanceSpotEarnClient({ apiKey: secrets.BINANCE_SPOT_TESTNET_API_KEY, apiSecret: secrets.BINANCE_SPOT_TESTNET_API_SECRET, testnet: true });
  }

  await processCompoundAlt(client);
  await processMusiman(client);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('ERROR spotAltLiveExecutor.js:', e.message);
    process.exit(1);
  });
}

module.exports = { main, processCompoundAlt, processMusiman };
