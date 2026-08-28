// Eksekusi LIVE Compound Alt DCA (29 Agu 2026, permintaan Olan: "semua tradingan Kaela web itu
// pionir buat diikuti realistic" -- Compound Alt terakhir yang masih shadow doang, dibikin live
// kayak Sniper/Nyopet). LOCAL ONLY -- sama alasan localLiveExecutor.js: server GitHub Actions
// (Azure US) DIBLOKIR Binance (HTTP 451), spotDcaAlt.js (yang jalan di cloud) cuma nyatet RENCANA
// beli/jual ke `state.pendingLiveBuy`/`pendingLiveSell`, eksekusi beneran di sini.
//
// DEMO DULU (Spot Testnet, testnet.binance.vision) -- BEDA TOTAL dari Demo Futures yang dipakai
// Sniper/Nyopet (demo-fapi.binance.com), akun/kredensial terpisah (BINANCE_SPOT_TESTNET_API_KEY
// di secrets.js). Real (mainnet asli) NANTI nyusul kalau demo udah lama teruji -- pola sama kayak
// Sniper/Nyopet dulu.

const fs = require('fs');
const path = require('path');
const { createBinanceSpotEarnClient } = require('./binanceSpotEarnExecutor');
const { sendWhatsApp } = require('./fonnte');

const SPOT_ALT_PATH = path.join(__dirname, 'kaela-spot-alt.json');

function loadSecrets() {
  try { return require('./secrets'); } catch { return {}; }
}

function load() {
  if (!fs.existsSync(SPOT_ALT_PATH)) return null;
  return JSON.parse(fs.readFileSync(SPOT_ALT_PATH, 'utf8'));
}
function save(state) { fs.writeFileSync(SPOT_ALT_PATH, JSON.stringify(state, null, 2)); }

function coinLabel(symbol) { return symbol.replace('USDT', ''); }

async function runPendingBuy(client, state) {
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
  save(state);
  return results;
}

async function runPendingSell(client, state) {
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
  save(state);
  return results;
}

async function main() {
  const state = load();
  if (!state) { console.log('[SpotAltLiveExecutor] kaela-spot-alt.json belum ada, gak ada apa-apa buat dieksekusi.'); return; }
  if (!state.pendingLiveBuy && !state.pendingLiveSell) {
    console.log('[SpotAltLiveExecutor] Gak ada rencana beli/jual baru yang belum dieksekusi live.');
    return;
  }

  const secrets = loadSecrets();
  if (!secrets.BINANCE_SPOT_TESTNET_API_KEY || !secrets.BINANCE_SPOT_TESTNET_API_SECRET) {
    console.log('[SpotAltLiveExecutor] BINANCE_SPOT_TESTNET_API_KEY/SECRET belum diisi di secrets.js -- skip, tetap shadow.');
    return;
  }
  const client = createBinanceSpotEarnClient({ apiKey: secrets.BINANCE_SPOT_TESTNET_API_KEY, apiSecret: secrets.BINANCE_SPOT_TESTNET_API_SECRET, testnet: true });

  const buyResults = await runPendingBuy(client, state);
  if (buyResults) {
    const msg = `🧪 BINANCE DEMO (Spot Testnet) -- Eksekusi live Compound Alt:\n\n${buyResults.join('\n')}`;
    console.log(msg);
    await sendWhatsApp(msg);
  }

  const sellResults = await runPendingSell(client, state);
  if (sellResults) {
    const msg = `🧪 BINANCE DEMO (Spot Testnet) -- Eksekusi live jual Compound Alt:\n\n${sellResults.join('\n')}`;
    console.log(msg);
    await sendWhatsApp(msg);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('ERROR spotAltLiveExecutor.js:', e.message);
    process.exit(1);
  });
}

module.exports = { main };
