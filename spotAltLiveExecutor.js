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

async function processCompoundAlt(client) {
  const state = loadJson(SPOT_ALT_PATH);
  if (!state) { console.log('[SpotAltLiveExecutor] kaela-spot-alt.json belum ada, skip Compound Alt.'); return; }
  if (!state.pendingLiveBuy && !state.pendingLiveSell) {
    console.log('[SpotAltLiveExecutor] Compound Alt: gak ada rencana baru yang belum dieksekusi live.');
    return;
  }
  const buyResults = await runAltPendingBuy(client, state);
  if (buyResults) await sendWhatsApp(`🧪 BINANCE DEMO (Spot Testnet) -- Eksekusi live Compound Alt:\n\n${buyResults.join('\n')}`);
  const sellResults = await runAltPendingSell(client, state);
  if (sellResults) await sendWhatsApp(`🧪 BINANCE DEMO (Spot Testnet) -- Eksekusi live jual Compound Alt:\n\n${sellResults.join('\n')}`);
}

// ============ Musiman / Spot BTC (1 koin) ============
async function processMusiman(client) {
  const state = loadJson(SPOT_MUSIMAN_PATH);
  if (!state) { console.log('[SpotAltLiveExecutor] kaela-spot.json belum ada, skip Musiman.'); return; }
  if (!state.pendingLiveBuy && !state.pendingLiveSell) {
    console.log('[SpotAltLiveExecutor] Musiman: gak ada rencana baru yang belum dieksekusi live.');
    return;
  }

  if (state.pendingLiveBuy) {
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

  if (state.pendingLiveSell) {
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
}

async function main() {
  const secrets = loadSecrets();
  if (!secrets.BINANCE_SPOT_TESTNET_API_KEY || !secrets.BINANCE_SPOT_TESTNET_API_SECRET) {
    console.log('[SpotAltLiveExecutor] BINANCE_SPOT_TESTNET_API_KEY/SECRET belum diisi di secrets.js -- skip, tetap shadow.');
    return;
  }
  const client = createBinanceSpotEarnClient({ apiKey: secrets.BINANCE_SPOT_TESTNET_API_KEY, apiSecret: secrets.BINANCE_SPOT_TESTNET_API_SECRET, testnet: true });

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
