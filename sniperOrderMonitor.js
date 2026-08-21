// Jalankan tiap jam (bareng jadwal candle H1 close): node sniperOrderMonitor.js
// Pantau order (sniperOrders.js, dibuat manual ATAU otomatis sniperAutoAnalysis.js). 2 jenis:
//   1. Order LAMA/manual (gak ada partialTp) -- TP/SL tunggal, perilaku asli:
//      PENDING -> cek candle H1 TERAKHIR YANG SUDAH CLOSE: kalau CLOSE-nya konfirmasi arah
//      (buy: close >= triggerPrice; sell: close <= triggerPrice) -> flip ke FLOATING.
//      FLOATING -> cek High/Low candle buat TP/SL kena (touch, bukan nunggu close).
//   2. Order strategi POLA CHART (10 Agu 2026, ada partialTp) -- exit 2 TAHAP:
//      FLOATING, belum partial -> SL kena (full close) ATAU partialTp kena (separuh diamankan,
//      SL sisa digeser breakeven, kirim notifikasi TAHAP 1 terpisah).
//      FLOATING, udah partial -> SL breakeven kena (full close sisa) ATAU candle harian tutup
//      di bawah/atas SMA trailing (momentum patah -> full close sisa, "lihat kelakuan candle").
// Eksekusi ASLI tetap Olan manual di Binance -- ini cuma monitor, TIDAK PERNAH generate order baru.

const { getActiveOrders, updateOrder } = require('./sniperOrders');
const { applyRealizedPnl } = require('./kaelaBankroll');
const { formatTriggered, formatClosed, formatPartialClosed } = require('./sniperOrderLog');
const { addEntry } = require('./archive');
const { sendWhatsApp } = require('./fonnte');
const { fetchWithRetry } = require('./httpRetry');
const { sma } = require('./technicalAnalysis');
const { isWaMuted } = require('./config');
const { ASSETS } = require('./assetConfig');

// data-api.binance.vision -- endpoint RESMI Binance khusus market data publik, gak kena
// blokir geografis kayak api.binance.com (GitHub Actions runner ketauan HTTP 451 pas testing).
const BASE_URL = 'https://data-api.binance.vision/api/v3/klines';

function parseCandle(raw) {
  return { openTime: raw[0], open: +raw[1], high: +raw[2], low: +raw[3], close: +raw[4], closeTime: raw[6] };
}

// symbol (22 Agu 2026, upgrade multi-aset) -- dulu hardcode BTCUSDT, sekarang parameter biar
// bisa dipanggil per-aset (BTCUSDT/PAXGUSDT, lihat assetConfig.js).
async function fetchHourlyClosed(symbol, limit = 5) {
  const res = await fetchWithRetry(`${BASE_URL}?symbol=${symbol}&interval=1h&limit=${limit}`);
  const raw = await res.json();
  const nowMs = Date.now();
  return raw.map(parseCandle).filter((c) => c.closeTime <= nowMs);
}

async function fetchDailyClosed(symbol, limit = 30) {
  const res = await fetchWithRetry(`${BASE_URL}?symbol=${symbol}&interval=1d&limit=${limit}`);
  const raw = await res.json();
  // Fix 14 Agu 2026 (ketauan pas audit): lupa filter closeTime kayak fetchHourlyClosed di atas --
  // tanpa ini, candle HARIAN yang masih jalan (belum closed) ikut kehitung, bikin trailing-SMA
  // exit bisa kepicu dari harga intraday yang masih goyang, bukan candle yang beneran closed.
  const nowMs = Date.now();
  return raw.map(parseCandle).filter((c) => c.closeTime <= nowMs);
}

function computePnl(order, exitPrice, fraction = 1) {
  const dir = order.direction === 'buy' ? 1 : -1;
  const priceMovePct = ((exitPrice - order.entryPrice) / order.entryPrice) * 100 * dir;
  const pnlPct = priceMovePct * (order.leverage || 1);
  const pnlUsd = order.marginUsd ? (order.marginUsd * fraction * pnlPct) / 100 : null;
  return { pnlPct, pnlUsd };
}

// `silent` (14 Agu 2026, buat order trial/simulasi "jangan pernah kasih tau WA") -- BEDA dari
// isWaMuted() yang cuma nunda sementara: order silent SELAMANYA gak pernah kirim WA di
// SEPANJANG hidupnya (trigger/partial/closed), tetap kecatat normal di web/jurnal/bankroll.
async function sendWhatsAppRespectMute(msg, label, silent = false) {
  if (silent) {
    console.log(`[SniperOrderMonitor] Order SILENT (trial/simulasi) -- ${label} TETAP tercatat di web, gak pernah dikirim ke grup.`);
    return;
  }
  if (isWaMuted()) {
    console.log(`[SniperOrderMonitor] WA DIMUTE sampai Jumat -- ${label} TETAP tercatat di web, gak dikirim ke grup dulu.`);
    return;
  }
  await sendWhatsApp(msg);
}

// Proses semua order 1 ASET (candle H1/daily udah difetch khusus buat aset itu) -- diekstrak
// dari main() (22 Agu 2026, upgrade multi-aset) biar bisa dipanggil per-grup aset.
async function processAsset(assetKey, ordersThisAsset, now) {
  const assetCfg = ASSETS[assetKey] || ASSETS.btc;
  const candles = await fetchHourlyClosed(assetCfg.symbol, 5);
  if (candles.length === 0) {
    console.log(`[SniperOrderMonitor] ${assetCfg.label}: belum ada candle H1 closed, skip.`);
    return;
  }
  const last = candles[candles.length - 1];

  const needsDaily = ordersThisAsset.some((o) => o.status === 'floating' && o.partialDone && o.trailSmaLen);
  const dailyCandles = needsDaily
    ? await fetchDailyClosed(assetCfg.symbol, Math.max(30, ...ordersThisAsset.filter((o) => o.trailSmaLen).map((o) => o.trailSmaLen + 5)))
    : null;

  for (const order of ordersThisAsset) {
    if (order.status === 'pending') {
      const closeConfirmed = order.direction === 'buy' ? last.close >= order.triggerPrice : last.close <= order.triggerPrice;
      const testConfirmed = order.testLevel == null
        ? true
        : (order.direction === 'buy' ? last.low <= order.testLevel : last.high >= order.testLevel);
      const confirmed = closeConfirmed && testConfirmed;
      if (!confirmed) continue;

      const updated = updateOrder(order.id, {
        status: 'floating', entryPrice: last.close, triggeredAt: new Date(last.closeTime).toISOString(),
      });
      const msg = formatTriggered(updated);
      console.log(msg + '\n');
      addEntry('sniper', msg, now);
      await sendWhatsAppRespectMute(msg, 'order kena trigger', order.silentTest);
      continue;
    }

    if (order.status !== 'floating') continue;

    // ===== Order strategi POLA CHART (partialTp diisi) -- exit 2 tahap =====
    if (order.partialTp) {
      if (!order.partialDone) {
        const hitSl = order.sl == null ? false : (order.direction === 'buy' ? last.low <= order.sl : last.high >= order.sl);
        const hitPartial = order.direction === 'buy' ? last.high >= order.partialTp : last.low <= order.partialTp;
        if (hitSl && !hitPartial) {
          // Kena SL sebelum sempat partial -- full close rugi, sama kayak order biasa.
          const { pnlPct, pnlUsd } = computePnl(order, order.sl, 1);
          const updated = updateOrder(order.id, {
            status: 'closed_sl', closedAt: new Date(last.closeTime).toISOString(), closeReason: 'SL', exitPrice: order.sl, pnlPct, pnlUsd,
          });
          applyRealizedPnl(pnlUsd || 0, 'closed_sl', now); // update bankroll bayangan Kaela
          const msg = formatClosed(updated);
          console.log(msg + '\n');
          addEntry('sniper', msg, now);
          await sendWhatsAppRespectMute(msg, 'posisi kena SL', order.silentTest);
          continue;
        }
        if (hitPartial) {
          // Dua-duanya kena candle sama = SL menang (konservatif), KECUALI SL gak kena -- normal case.
          if (hitSl) {
            const { pnlPct, pnlUsd } = computePnl(order, order.sl, 1);
            const updated = updateOrder(order.id, {
              status: 'closed_sl', closedAt: new Date(last.closeTime).toISOString(), closeReason: 'SL', exitPrice: order.sl, pnlPct, pnlUsd,
            });
            applyRealizedPnl(pnlUsd || 0, 'closed_sl', now);
            const msg = formatClosed(updated);
            console.log(msg + '\n');
            addEntry('sniper', msg, now);
            await sendWhatsAppRespectMute(msg, 'posisi kena SL', order.silentTest);
            continue;
          }
          const { pnlUsd: realizedPnlUsd } = computePnl(order, order.partialTp, 0.5);
          const updated = updateOrder(order.id, {
            partialDone: true, remainingFraction: 0.5, sl: order.entryPrice, realizedPnlUsd: realizedPnlUsd || 0, partialClosedAt: new Date(last.closeTime).toISOString(),
          });
          applyRealizedPnl(realizedPnlUsd || 0, 'partial_tahap1', now); // update bankroll bayangan Kaela -- cuma separuh
          const msg = formatPartialClosed(updated);
          console.log(msg + '\n');
          addEntry('sniper', msg, now);
          await sendWhatsAppRespectMute(msg, 'target tahap 1 kena', order.silentTest);
          continue;
        }
        continue; // belum kena apa-apa
      }

      // Udah partial -- SL sekarang breakeven, pantau itu (hourly) + trailing SMA (daily).
      const hitBreakevenSl = order.direction === 'buy' ? last.low <= order.sl : last.high >= order.sl;
      let trailBroken = false;
      if (dailyCandles && dailyCandles.length >= order.trailSmaLen) {
        const closes = dailyCandles.map((c) => c.close);
        const trailSma = sma(closes, order.trailSmaLen);
        const lastDailyClose = dailyCandles[dailyCandles.length - 1].close;
        if (trailSma !== null) trailBroken = order.direction === 'buy' ? lastDailyClose < trailSma : lastDailyClose > trailSma;
      }
      if (!hitBreakevenSl && !trailBroken) continue;

      const exitPrice = hitBreakevenSl ? order.sl : last.close;
      const { pnlUsd: restPnlUsd, pnlPct } = computePnl(order, exitPrice, order.remainingFraction);
      const totalPnlUsd = (order.realizedPnlUsd || 0) + (restPnlUsd || 0);
      const updated = updateOrder(order.id, {
        status: hitBreakevenSl ? 'closed_sl' : 'closed_tp',
        closedAt: new Date(last.closeTime).toISOString(),
        closeReason: hitBreakevenSl ? 'SL_BREAKEVEN' : 'TRAIL',
        exitPrice, pnlPct, pnlUsd: totalPnlUsd,
      });
      // Bankroll bayangan Kaela: cuma sisa leg ini (restPnlUsd) -- porsi tahap 1 udah
      // diaplikasikan pas partial kena, jangan dobel-hitung.
      applyRealizedPnl(restPnlUsd || 0, hitBreakevenSl ? 'closed_sl_breakeven' : 'closed_trail', now);
      const msg = formatClosed(updated);
      console.log(msg + '\n');
      addEntry('sniper', msg, now);
      await sendWhatsAppRespectMute(msg, 'posisi ditutup penuh', order.silentTest);
      continue;
    }

    // ===== Order LAMA/manual (TP/SL tunggal) -- perilaku asli, gak berubah =====
    const hitTP = order.direction === 'buy' ? last.high >= order.tp : last.low <= order.tp;
    // sl bisa null/undefined buat order "main liq" (gak ada SL formal, ride sampai
    // TP/liquidation asli) -- WAJIB guard eksplisit. Tanpa ini, perbandingan JS `x >= null`
    // ke-coerce jadi `x >= 0` (SELALU true buat harga BTC!) -- order SELL tanpa SL bakal
    // langsung ke-anggap "kena SL" di candle pertama walau harga gak gerak sama sekali.
    const hitSL = order.sl == null ? false : (order.direction === 'buy' ? last.low <= order.sl : last.high >= order.sl);
    if (!hitTP && !hitSL) continue;

    // kalau dua-duanya kena di candle yang sama (gap/candle lebar), SL menang -- konservatif,
    // gak asumsikan urutan intrabar yang gak kita tau.
    const isTP = hitTP && !hitSL;
    const exitPrice = isTP ? order.tp : order.sl;
    const { pnlPct, pnlUsd } = computePnl(order, exitPrice, 1);
    const updated = updateOrder(order.id, {
      status: isTP ? 'closed_tp' : 'closed_sl',
      closedAt: new Date(last.closeTime).toISOString(),
      closeReason: isTP ? 'TP' : 'SL',
      exitPrice, pnlPct, pnlUsd,
    });
    const msg = formatClosed(updated);
    console.log(msg + '\n');
    addEntry('sniper', msg, now);
    await sendWhatsAppRespectMute(msg, 'posisi ditutup', order.silentTest);
  }
}

// main() (22 Agu 2026, upgrade multi-aset) -- kelompokin order aktif per ASET (order LAMA tanpa
// field `asset` dianggap 'btc', backward-compat), proses tiap grup pakai candle aset itu sendiri.
async function main() {
  const now = new Date();
  const active = getActiveOrders();
  if (active.length === 0) {
    console.log('[SniperOrderMonitor]', now.toISOString(), '— gak ada order aktif, skip.');
    return;
  }

  const byAsset = {};
  for (const order of active) {
    const key = order.asset || 'btc';
    (byAsset[key] = byAsset[key] || []).push(order);
  }
  for (const assetKey of Object.keys(byAsset)) {
    await processAsset(assetKey, byAsset[assetKey], now);
  }
}

main().catch((e) => {
  console.error('ERROR sniperOrderMonitor.js:', e.message);
  process.exit(1);
});
