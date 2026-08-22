// Eksekusi LIVE dari KOMPUTER OLAN sendiri (22 Agu 2026) -- server GitHub Actions (Azure US)
// DIBLOKIR Binance Futures/Demo Trading (HTTP 451 "restricted location"), ketauan pas tes
// koneksi. Analisa sinyal TETAP di GitHub Actions (gak kena blokir, itu cuma data spot biasa) --
// yang PINDAH ke lokal cuma bagian EKSEKUSI order beneran, karena Indonesia gak diblokir Binance.
//
// CARA PAKAI: `node localLiveExecutor.js` -- jalanin manual kapan aja mau cek ada sinyal baru yang
// belum dieksekusi (abis "git pull" biar sniper-orders.json paling baru). Scan semua posisi
// FLOATING yang belum ada `liveExecutedAt` (ini field PENANDA -- sekali dieksekusi/dicoba, gak
// dicoba ulang lagi walau gagal, biar gak dobel order kalau dijalanin berkali-kali).
//
// SETUP SEKALI: tambahin BINANCE_API_KEY/BINANCE_API_SECRET ke secrets.js LOKAL (file yang sama
// yang udah ada FONNTE_TOKEN) -- lihat contoh format di bawah `require('./secrets')`.

const fs = require('fs');
const path = require('path');
const { getActiveOrders, updateOrder } = require('./sniperOrders');
const { getAccountBalance, setLeverage, placeMarketEntry, placeStopLoss, placeTakeProfit, emergencyCloseMarket } = require('./binanceExecutor');
const { hitung: hitungExposure } = require('./calculator');
const { isLiveTradingEnabled, isTestnet } = require('./killSwitch');
const { ASSETS } = require('./assetConfig');
const { fetchWithRetry } = require('./httpRetry');

async function fetchLivePrice(symbol) {
  const res = await fetchWithRetry(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${symbol}`);
  return parseFloat((await res.json()).price);
}

// 22 Agu 2026 (permintaan Olan: "replace semua yang berbau bayangan jadi Binance Demo") -- sizing
// GAK LAGI reuse margin/leverage dari order shadow (itu dihitung dari bankroll bayangan yang
// TERPISAH dari Binance). Dihitung ULANG di sini pakai saldo REAL Binance + harga LIVE sekarang --
// arah/SL/pola tetap dari sinyal shadow (itu bagian ANALISA yang gak berubah), tapi UKURAN
// posisinya sepenuhnya dari kondisi real saat eksekusi.
async function executeOne(order) {
  const assetCfg = ASSETS[order.asset] || ASSETS.btc;
  console.log(`\n[LocalLiveExecutor] Eksekusi ${assetCfg.label} ${order.mode} (${order.direction})...`);

  let entryFilledQty = null;
  try {
    const [modal, livePrice] = await Promise.all([getAccountBalance(), fetchLivePrice(assetCfg.symbol)]);
    const calc = hitungExposure({ modal, entry: livePrice, stopLoss: order.sl });
    console.log(`[LocalLiveExecutor] Saldo available: $${modal.toFixed(2)} | Harga live: $${livePrice} | Exposure ${calc.exposure}x | Leverage ${calc.leverage}x | Margin $${calc.margin.toFixed(2)}`);

    await setLeverage(assetCfg.symbol, calc.leverage);
    const entryOrder = await placeMarketEntry({
      symbol: assetCfg.symbol, direction: order.direction, notionalUsd: calc.nilaiPosisi, livePrice,
    });
    entryFilledQty = parseFloat(entryOrder.executedQty || entryOrder.origQty);

    try {
      await placeStopLoss({ symbol: assetCfg.symbol, direction: order.direction, stopPrice: order.sl, quantity: entryFilledQty });
    } catch (slError) {
      console.log(`[LocalLiveExecutor] SL GAGAL nempel (${slError.message}) -- tutup PAKSA demi keamanan.`);
      await emergencyCloseMarket({ symbol: assetCfg.symbol, direction: order.direction, quantity: entryFilledQty });
      throw new Error(`Entry masuk tapi SL gagal (${slError.message}) -- posisi UDAH DITUTUP PAKSA otomatis.`);
    }

    await placeTakeProfit({ symbol: assetCfg.symbol, direction: order.direction, tpPrice: order.partialTp || order.tp, quantity: entryFilledQty });

    updateOrder(order.id, {
      liveExecutedAt: new Date().toISOString(),
      liveExecution: {
        ok: true, filledQty: entryFilledQty, testnet: isTestnet(),
        modal, livePrice, exposure: calc.exposure, leverage: calc.leverage, marginUsd: calc.margin,
      },
    });
    console.log(`[LocalLiveExecutor] ✅ SUKSES -- qty ${entryFilledQty} (${isTestnet() ? 'Demo Trading' : 'MAINNET ASLI'}).`);
  } catch (e) {
    updateOrder(order.id, {
      liveExecutedAt: new Date().toISOString(),
      liveExecution: { ok: false, error: e.message, testnet: isTestnet() },
    });
    console.log(`[LocalLiveExecutor] ❌ GAGAL: ${e.message}`);
  }
}

// Cuma sinyal yang muncul SETELAH fitur live ini dipasang (22 Agu 2026) yang boleh dieksekusi --
// posisi shadow LAMA (sebelum fitur ini ada) entry-nya udah basi, eksekusi market order SEKARANG
// buat sinyal yang triggeredAt-nya beberapa hari lalu bakal entry di harga yang salah sama sekali.
const LIVE_TRADING_CUTOFF = new Date('2026-08-22T20:00:00Z');

async function main() {
  if (!isLiveTradingEnabled()) {
    console.log('[LocalLiveExecutor] Kill switch OFF (live-trading-config.json enabled=false) -- gak ngapa-ngapain.');
    return;
  }

  const pending = getActiveOrders().filter((o) =>
    o.status === 'floating' && !o.liveExecutedAt && !o.silentTest
    && new Date(o.triggeredAt || o.createdAt) >= LIVE_TRADING_CUTOFF);
  if (pending.length === 0) {
    console.log('[LocalLiveExecutor] Gak ada posisi floating baru yang belum dieksekusi.');
    return;
  }

  console.log(`[LocalLiveExecutor] Ketemu ${pending.length} posisi belum dieksekusi live.`);
  for (const order of pending) {
    await executeOne(order);
  }
  console.log('\n[LocalLiveExecutor] Selesai -- JANGAN LUPA "git add sniper-orders.json && git commit && git push" biar status ke-simpen.');
}

main().catch((e) => {
  console.error('ERROR localLiveExecutor.js:', e.message);
  process.exit(1);
});
