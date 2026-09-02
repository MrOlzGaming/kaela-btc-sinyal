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
const { getActiveOrders, updateOrder, setBalance } = require('./sniperOrders');
const binanceClient = require('./binanceExecutor');
const { roundToStepSize } = require('./binanceExecutor');
const mexcClient = require('./mexcExecutor');
const { hitung: hitungExposure } = require('./calculator');
const { load: loadBankroll, save: saveBankroll } = require('./kaelaBankroll');
const { isLiveTradingEnabled, isTestnet } = require('./killSwitch');
const { ASSETS } = require('./assetConfig');
const { fetchWithRetry } = require('./httpRetry');
const kaela = require('./kaelaProTraderClient');

// 3 Sep 2026, permintaan Olan -- BUG ketemu: file ini (Sniper punya Olan sendiri, demo MAUPUN
// real tergantung isTestnet()) gak PERNAH nulis ke Sheet Journal GAS sama sekali, beda dari
// Nyopet yang UDAH dibenerin (lihat nyopetAutoTrader.js _journalHookOlanDemo). Akibatnya tab
// "Jurnal Demo"/"Jurnal Real Olan" (Kaela Access) bagian Sniper selalu kosong walau posisi
// beneran jalan. MASTER_NOMOR sama persis multiAccountExecutor.js -- bukan secret, ID member.
const MASTER_NOMOR = '6281299303888';

// ⚠️ BUG KRITIS ditemukan+fix 31 Agu 2026 (Olan: "ada posisi jalan padahal di demo ga ada", XAU
// order gagal "-4161 Leverage reduction is not supported... with open positions"): file ini
// KETINGGALAN dari migrasi eksekusi Emas ke MEXC (30 Agu 2026, lihat memori
// project-kaela-multi-exchange) -- masih manggil Binance LANGSUNG pakai `assetCfg.symbol`
// (PAXGUSDT, simbol CHART bukan eksekusi) buat SEMUA aset, padahal `sniperMultiAccount.js`
// (versi multi-akun) UDAH BENER pakai `execFor(assetCfg)`+`execSymbol` sejak migrasi itu. Akibatnya
// SETIAP sinyal XAU Olan sendiri nyoba nempel ke posisi Binance PAXGUSDT yang UDAH ADA dari
// percobaan2 sebelumnya (leverage beda), Binance nolak ganti leverage sementara ada posisi terbuka
// -> gagal terus-menerus, order shadow tetap 'floating' (buat tracking performa) tapi TIDAK PERNAH
// beneran ada di Binance/MEXC -- kartu web nunjukin "DEMO" padahal itu 100% bayangan doang.
// Fix: port PERSIS pola execFor/execSymbol dari sniperMultiAccount.js ke sini.
function execFor(assetCfg) { return assetCfg.exchange === 'mexc' ? mexcClient : binanceClient; }

async function fetchLivePrice(symbol, exchange = 'binance') {
  if (exchange === 'mexc') {
    const res = await fetchWithRetry(`https://contract.mexc.com/api/v1/contract/ticker?symbol=${symbol}`);
    return parseFloat((await res.json()).data.lastPrice);
  }
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
  const exec = execFor(assetCfg);
  const execSymbol = assetCfg.execSymbol || assetCfg.symbol;
  console.log(`\n[LocalLiveExecutor] Eksekusi ${assetCfg.label} ${order.mode} (${order.direction}) via ${assetCfg.exchange || 'binance'}...`);

  let entryFilledQty = null;
  try {
    const [modal, livePrice] = await Promise.all([exec.getAccountBalance('USDT'), fetchLivePrice(execSymbol, assetCfg.exchange)]);
    const calc = hitungExposure({ modal, entry: livePrice, stopLoss: order.sl });
    console.log(`[LocalLiveExecutor] Saldo available: $${modal.toFixed(2)} | Harga live: $${livePrice} | Exposure ${calc.exposure}x | Leverage ${calc.leverage}x | Margin $${calc.margin.toFixed(2)}`);

    // Gak pakai order SL terpisah (23 Agu 2026, permintaan Olan: "sl stop loss = liq" -- berlaku
    // Sniper JUGA, bukan cuma Nyopet) -- leverage-nya UDAH dihitung dari nyawa (jarak entry->SL
    // pola chart) via hitungExposure di atas, jadi likuidasi ISOLATED margin otomatis mendekati
    // level SL itu tanpa perlu order STOP_MARKET terpisah. TP TETAP order eksplisit (placeTakeProfit
    // di bawah) -- itu WAJIB presisi ambil profit, likuidasi gak bisa gantiin itu.
    // CATATAN: ini cuma buat SL AWAL. Breakeven-SL abis partial-exit (2R) masih perlu ditangani
    // terpisah di sniperOrderMonitor.js -- liquidation gak bisa presisi ke harga breakeven arbitrer.
    await exec.setIsolatedMargin(execSymbol);
    await exec.setLeverage(execSymbol, calc.leverage);
    const entryOrder = await exec.placeMarketEntry({
      symbol: execSymbol, direction: order.direction, notionalUsd: calc.nilaiPosisi, livePrice,
    });
    entryFilledQty = parseFloat(entryOrder.executedQty);

    // TP buat SEPARUH doang (23 Agu 2026, bug ketemu: sebelumnya kirim FULL qty ke harga partial
    // -- itu nutup SELURUH posisi di 2R, ngilangin edge "biarin separuh lari ikutin trend" yang
    // justru divalidasi backtest). Native partial-close Binance (quantity < posisi = OK, sisanya
    // TETAP kebuka) -- gak perlu workaround apapun buat leg PERTAMA ini.
    const { stepSize, quantityPrecision } = await exec.getSymbolInfo(execSymbol);
    const halfQtyRaw = entryFilledQty / 2;
    const halfQty = roundToStepSize(halfQtyRaw, stepSize, quantityPrecision);
    const tpPrice = order.partialTp || order.tp;
    if (halfQty > 0) {
      await exec.placeTakeProfit({ symbol: execSymbol, direction: order.direction, tpPrice, quantity: halfQty });
    } else {
      // Posisi kekecilan buat dibagi 2 (stepSize gede relatif ke qty) -- TP full aja drpd 0.
      await exec.placeTakeProfit({ symbol: execSymbol, direction: order.direction, tpPrice, quantity: entryFilledQty });
    }

    const entryPriceReal = parseFloat(entryOrder.avgPrice);
    updateOrder(order.id, {
      liveExecutedAt: new Date().toISOString(),
      liveExecution: {
        ok: true, filledQty: entryFilledQty, halfQty: halfQty > 0 ? halfQty : entryFilledQty, testnet: isTestnet(),
        modal, livePrice, exposure: calc.exposure, leverage: calc.leverage, marginUsd: calc.margin,
        entryPriceReal, leg2: null, fullyClosedAt: null,
      },
    });
    // Jurnal (3 Sep 2026, fix "Jurnal Demo/Real Olan bagian Sniper selalu kosong") -- entryId =
    // order.id SNIPER ASLI (sniper-orders.json), dipakai lagi di sniperOrderMonitor.js pas nutup
    // biar updateJournalEntry nyambung ke baris yang SAMA (bukan bikin baris baru tiap close).
    kaela.recordJournalEntry(MASTER_NOMOR, isTestnet() ? 'demo' : 'real', {
      entryId: order.id, strategy: 'sniper', asset: order.asset, direction: order.direction,
      entryPrice: entryPriceReal, sl: order.sl, tp: tpPrice, leverage: calc.leverage, marginUsd: calc.margin,
      status: 'open', openedAt: new Date().toISOString(), note: `Chart Pattern/FVG (${order.mode || 'sniper'})`,
    }).catch((e) => console.log('[LocalLiveExecutor] recordJournalEntry gagal:', e.message));
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

// Kadaluarsa (23 Agu 2026, permintaan Olan: skema "catch-up begitu komputer nyambung lagi" GANTI
// sewa VPS -- gak masalah eksekusi telat NUNGGU komputer/jaringan hidup lagi, TAPI kalau matinya
// KELAMAAN, entry di harga SEKARANG udah gak nyambung sama sinyal aslinya (pola breakout udah basi,
// SL yang dihitung dari zona swing waktu itu bisa udah gak relevan/harga udah lewat jauh). 48 jam =
// 2x lipat timeframe candle HARIAN yang jadi basis deteksi pola (flag/wedge/FVG), cukup longgar buat
// nutup downtime wajar (mati lampu semalam, jaringan ngambek berjam-jam) tapi masih nolak kalau
// telat berhari-hari. Order yang kadaluarsa ditandai (BUKAN dicoba eksekusi) biar gak nyangkut
// selamanya nunggu retry yang gak akan pernah bener.
const STALE_THRESHOLD_HOURS = 48;

async function main() {
  if (!isLiveTradingEnabled()) {
    console.log('[LocalLiveExecutor] Kill switch OFF (live-trading-config.json enabled=false) -- gak ngapa-ngapain.');
    return;
  }

  // Sync saldo web dashboard ke saldo Binance REAL tiap kali script ini jalan (22 Agu 2026,
  // permintaan Olan: "semua berbau bayangan replace jadi Binance Demo") -- gak nunggu ada
  // sinyal baru buat update ini, biar dashboard selalu kebaca fresh.
  try {
    const balance = await binanceClient.getAccountBalance();
    setBalance(balance); // sniper-orders.json (panel Sniper) -- BTC/Binance doang, sama kayak sebelumnya
    const bankroll = loadBankroll();
    bankroll.balance = balance; // kaela-bankroll.json (Jurnal Fund Report)
    saveBankroll(bankroll);
    console.log(`[LocalLiveExecutor] Saldo web disinkronin: $${balance.toFixed(2)}`);
  } catch (e) {
    console.log('[LocalLiveExecutor] Gagal sync saldo (dilewatin, gak fatal):', e.message);
  }

  const pending = getActiveOrders().filter((o) =>
    o.status === 'floating' && !o.liveExecutedAt && !o.silentTest
    && new Date(o.triggeredAt || o.createdAt) >= LIVE_TRADING_CUTOFF);
  if (pending.length === 0) {
    console.log('[LocalLiveExecutor] Gak ada posisi floating baru yang belum dieksekusi.');
    return;
  }

  console.log(`[LocalLiveExecutor] Ketemu ${pending.length} posisi belum dieksekusi live.`);
  const now = new Date();
  for (const order of pending) {
    const ageHours = (now - new Date(order.triggeredAt || order.createdAt)) / 3600000;
    if (ageHours > STALE_THRESHOLD_HOURS) {
      updateOrder(order.id, {
        liveExecutedAt: now.toISOString(),
        liveExecution: { ok: false, expired: true, error: `Sinyal udah ${ageHours.toFixed(1)} jam (>${STALE_THRESHOLD_HOURS} jam) -- kadaluarsa, TIDAK dieksekusi (harga sekarang udah gak nyambung sama setup aslinya).` },
      });
      console.log(`[LocalLiveExecutor] ⏳ ${order.asset || 'btc'} ${order.mode} kadaluarsa (${ageHours.toFixed(1)} jam) -- dilewatin, ditandai gak dieksekusi.`);
      continue;
    }
    await executeOne(order);
  }
  console.log('\n[LocalLiveExecutor] Selesai -- JANGAN LUPA "git add sniper-orders.json && git commit && git push" biar status ke-simpen.');
}

main().catch((e) => {
  console.error('ERROR localLiveExecutor.js:', e.message);
  process.exit(1);
});
