// Sniper Live Monitor -- LOCAL ONLY (numpang cadence run-local-executor.ps1, Binance Demo
// diblokir GitHub Actions). Mantau posisi Sniper yang UDAH dieksekusi live (liveExecution.ok=true)
// buat 2 hal yang localLiveExecutor.js (entry doang) belum nanganin:
//
// 1. Leg 1 (entry awal): TP separuh (2R) kena? -> "tutup dulu lalu buka lagi dengan sisanya"
//    (23 Agu 2026, permintaan Olan) -- sisa qty yang masih floating ditutup PENUH, langsung dibuka
//    ULANG size sama, leverage dihitung dari jarak harga-SEKARANG ke ENTRY AWAL (`hitungExposure`
//    yang SAMA persis, cuma stopLoss param-nya = entry awal). Likuidasi ISOLATED margin leg baru
//    ini otomatis jatuh ~breakeven -- gak perlu order SL eksplisit ("SL = likuidasi" tetap
//    konsisten buat leg kedua ini, cuma "dipaksa" lewat reopen bukan lewat order).
// 2. Leg 2 (abis reopen): trailing SMA10 harian -- close < SMA10 (buy) / > SMA10 (sell) -> tutup
//    market manual (trailing itu dinamis, gak bisa jadi 1 order statis).
//
// Kalau POSISI ILANG SAMA SEKALI kapanpun (kelikuidasi selama kita offline, di leg manapun) --
// REKONSILIASI dari income history Binance (bukan nebak dari harga), sama pola persis
// nyopetAutoTrader.js. Total PNL final SELALU diambil dari income history (jumlah SEMUA realized
// PNL+fee sejak order.triggeredAt) -- BUKAN dijumlah manual dari tiap leg, biar akurat & gak
// keliru (ada 3 potongan realisasi: fill TP partial native, close sisa leg1, close leg2 final).

const crypto = require('crypto');
const { getActiveOrders, updateOrder } = require('./sniperOrders');
const { ASSETS } = require('./assetConfig');
const { hitung: hitungExposure } = require('./calculator');
const { getAccountBalance, setLeverage, setIsolatedMargin, placeMarketEntry, emergencyCloseMarket, getPositionRisk, cancelAllOpenOrders } = require('./binanceExecutor');
const { fetchCandles, sma } = require('./technicalAnalysis');
const { applyRealizedPnl } = require('./kaelaBankroll');

function sign(q, s) { return crypto.createHmac('sha256', s).update(q).digest('hex'); }

async function fetchRealizedPnlSince(symbol, startTime) {
  const secrets = require('./secrets');
  const params = { symbol, startTime, timestamp: Date.now(), recvWindow: 5000, limit: 1000 };
  const query = new URLSearchParams(params).toString();
  const sig = sign(query, secrets.BINANCE_API_SECRET);
  const res = await fetch(`https://demo-fapi.binance.com/fapi/v1/income?${query}&signature=${sig}`, { headers: { 'X-MBX-APIKEY': secrets.BINANCE_API_KEY } });
  const income = await res.json();
  return income.reduce((s, inc) => s + parseFloat(inc.income), 0);
}

function finalize(order, realPnl) {
  updateOrder(order.id, {
    status: realPnl >= 0 ? 'closed_tp' : 'closed_sl', pnlUsd: realPnl, closedAt: new Date().toISOString(),
    liveExecution: { ...order.liveExecution, fullyClosedAt: new Date().toISOString() },
  });
  applyRealizedPnl(realPnl, 'live_closed', new Date());
  console.log(`[SniperLiveMonitor] ${order.id} SELESAI -- PNL real (income history) $${realPnl.toFixed(2)}.`);
}

async function closeThenReopenBreakeven(order, assetCfg, remainingQty) {
  await cancelAllOpenOrders(assetCfg.symbol); // buang TP order lama (qty-nya udah gak nyambung, sisa beda dari awal)
  await emergencyCloseMarket({ symbol: assetCfg.symbol, direction: order.direction, quantity: remainingQty });

  const le = order.liveExecution;
  const [modalFull, priceRes] = await Promise.all([
    getAccountBalance(),
    fetch(`https://demo-fapi.binance.com/fapi/v1/ticker/price?symbol=${assetCfg.symbol}`),
  ]);
  const livePrice = parseFloat((await priceRes.json()).price);
  // stopLoss = ENTRY AWAL (bukan zona pola lagi) -- inilah trik breakeven-via-likuidasi.
  const calc = hitungExposure({ modal: modalFull, entry: livePrice, stopLoss: le.entryPriceReal });
  await setIsolatedMargin(assetCfg.symbol);
  await setLeverage(assetCfg.symbol, calc.leverage);
  const reopenOrder = await placeMarketEntry({ symbol: assetCfg.symbol, direction: order.direction, notionalUsd: remainingQty * livePrice, livePrice });
  const leg2Qty = parseFloat(reopenOrder.executedQty);
  const leg2Entry = parseFloat(reopenOrder.avgPrice);

  updateOrder(order.id, {
    liveExecution: { ...le, leg2: { qty: leg2Qty, entryPrice: leg2Entry, leverage: calc.leverage, openedAt: new Date().toISOString() } },
  });
  console.log(`[SniperLiveMonitor] Leg2 dibuka: qty ${leg2Qty} @ ${leg2Entry}, leverage ${calc.leverage}x (target likuidasi ~breakeven ${le.entryPriceReal.toFixed(2)}).`);
}

async function processOrder(order) {
  const assetCfg = ASSETS[order.asset] || ASSETS.btc;
  const le = order.liveExecution;
  const posRisk = await getPositionRisk(assetCfg.symbol);
  const posQty = Math.abs(parseFloat(posRisk.positionAmt));

  if (!le.leg2) {
    if (posQty <= 0) {
      console.log(`[SniperLiveMonitor] ${assetCfg.label} ${order.id} -- posisi abis SEBELUM sempat partial (kelikuidasi/SL=liq kena).`);
      const realPnl = await fetchRealizedPnlSince(assetCfg.symbol, new Date(order.triggeredAt).getTime());
      finalize(order, realPnl);
      return;
    }
    // Threshold longgar (bukan PERSIS setengah) -- native partial Binance bisa geser dikit krn
    // pembulatan stepSize, yang penting qty udah BERKURANG SIGNIFIKAN dari full awal.
    if (posQty < le.filledQty * 0.75) {
      console.log(`[SniperLiveMonitor] ${assetCfg.label} ${order.id} -- partial TP kena (qty ${le.filledQty}->${posQty}), reopen leg2 breakeven.`);
      await closeThenReopenBreakeven(order, assetCfg, posQty);
    } else {
      console.log(`[SniperLiveMonitor] ${assetCfg.label} ${order.id} -- leg1 masih penuh floating, lanjut pantau.`);
    }
    return;
  }

  // Udah ada leg2.
  if (posQty <= 0) {
    console.log(`[SniperLiveMonitor] ${assetCfg.label} ${order.id} -- leg2 ilang (kelikuidasi/tertutup selama offline).`);
    const realPnl = await fetchRealizedPnlSince(assetCfg.symbol, new Date(order.triggeredAt).getTime());
    finalize(order, realPnl);
    return;
  }

  const daily = await fetchCandles(assetCfg.symbol, '1d', 220);
  const closes = daily.map((c) => c.close);
  const trailSma = sma(closes, 10);
  const lastClose = closes[closes.length - 1];
  const trendBroken = order.direction === 'buy' ? lastClose < trailSma : lastClose > trailSma;
  if (trendBroken) {
    console.log(`[SniperLiveMonitor] ${assetCfg.label} ${order.id} -- trend patah (close ${lastClose} vs SMA10 ${trailSma.toFixed(2)}), tutup leg2.`);
    await emergencyCloseMarket({ symbol: assetCfg.symbol, direction: order.direction, quantity: le.leg2.qty });
    const realPnl = await fetchRealizedPnlSince(assetCfg.symbol, new Date(order.triggeredAt).getTime());
    finalize(order, realPnl);
  } else {
    console.log(`[SniperLiveMonitor] ${assetCfg.label} ${order.id} -- leg2 masih floating (trail SMA10 blm patah, close ${lastClose} vs SMA10 ${trailSma.toFixed(2)}).`);
  }
}

async function main() {
  const orders = getActiveOrders().filter((o) => o.liveExecution && o.liveExecution.ok && !o.liveExecution.fullyClosedAt);
  if (orders.length === 0) { console.log('[SniperLiveMonitor] Gak ada posisi live yang perlu dipantau.'); return; }
  for (const order of orders) {
    try { await processOrder(order); } catch (e) { console.log(`[SniperLiveMonitor] ERROR order ${order.id}:`, e.message); }
  }
}

main().catch((e) => { console.error('ERROR sniperLiveMonitor.js:', e.message); process.exit(1); });
