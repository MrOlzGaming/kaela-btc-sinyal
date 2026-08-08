// Jalankan tiap jam (bareng jadwal candle H1 close): node nyopetOrderMonitor.js
// Pantau order MANUAL (nyopetOrders.js, dibuat pas Olan+Kaela analisa bareng) -- BUKAN auto-decide
// entry kayak nyopetMonitor.js lama. Cuma 2 kerjaan:
//   1. PENDING -> cek candle H1 TERAKHIR YANG SUDAH CLOSE: kalau CLOSE-nya konfirmasi arah
//      (buy: close >= triggerPrice; sell: close <= triggerPrice) -> flip ke FLOATING.
//      "Tunggu candle close" ini implementasi "candle konfirmasi" yang diminta Olan -- gak asal
//      kesentuh intrabar/wick, harus beneran CLOSE di sisi yang benar dulu.
//   2. FLOATING -> cek High/Low candle buat TP/SL kena (touch, bukan nunggu close -- begitu kena,
//      posisi beneran ketutup di real trading, gak nunggu candle selesai).
// Eksekusi ASLI tetap Olan manual di Binance -- ini cuma monitor, TIDAK PERNAH generate order baru.

const { getActiveOrders, updateOrder } = require('./nyopetOrders');
const { formatTriggered, formatClosed } = require('./nyopetOrderLog');
const { addEntry } = require('./archive');
const { sendWhatsApp } = require('./fonnte');
const { fetchWithRetry } = require('./httpRetry');

const BASE_URL = 'https://api.binance.com/api/v3/klines';

function parseCandle(raw) {
  return { openTime: raw[0], open: +raw[1], high: +raw[2], low: +raw[3], close: +raw[4], closeTime: raw[6] };
}

async function fetchHourlyClosed(limit = 5) {
  const res = await fetchWithRetry(`${BASE_URL}?symbol=BTCUSDT&interval=1h&limit=${limit}`);
  const raw = await res.json();
  const nowMs = Date.now();
  return raw.map(parseCandle).filter((c) => c.closeTime <= nowMs);
}

function computePnl(order, exitPrice) {
  const dir = order.direction === 'buy' ? 1 : -1;
  const priceMovePct = ((exitPrice - order.entryPrice) / order.entryPrice) * 100 * dir;
  const pnlPct = priceMovePct * (order.leverage || 1);
  const pnlUsd = order.marginUsd ? (order.marginUsd * pnlPct) / 100 : null;
  return { pnlPct, pnlUsd };
}

async function main() {
  const now = new Date();
  const active = getActiveOrders();
  if (active.length === 0) {
    console.log('[NyopetOrderMonitor]', now.toISOString(), '— gak ada order aktif, skip.');
    return;
  }

  const candles = await fetchHourlyClosed(5);
  if (candles.length === 0) {
    console.log('[NyopetOrderMonitor] Belum ada candle H1 closed, skip.');
    return;
  }
  const last = candles[candles.length - 1];

  for (const order of active) {
    if (order.status === 'pending') {
      const confirmed = order.direction === 'buy' ? last.close >= order.triggerPrice : last.close <= order.triggerPrice;
      if (!confirmed) continue;

      const updated = updateOrder(order.id, {
        status: 'floating', entryPrice: last.close, triggeredAt: new Date(last.closeTime).toISOString(),
      });
      const msg = formatTriggered(updated);
      console.log(msg + '\n');
      addEntry('nyopet', msg, now);
      await sendWhatsApp(msg);
      continue;
    }

    if (order.status === 'floating') {
      const hitTP = order.direction === 'buy' ? last.high >= order.tp : last.low <= order.tp;
      const hitSL = order.direction === 'buy' ? last.low <= order.sl : last.high >= order.sl;
      if (!hitTP && !hitSL) continue;

      // kalau dua-duanya kena di candle yang sama (gap/candle lebar), SL menang -- konservatif,
      // gak asumsikan urutan intrabar yang gak kita tau.
      const isTP = hitTP && !hitSL;
      const exitPrice = isTP ? order.tp : order.sl;
      const { pnlPct, pnlUsd } = computePnl(order, exitPrice);
      const updated = updateOrder(order.id, {
        status: isTP ? 'closed_tp' : 'closed_sl',
        closedAt: new Date(last.closeTime).toISOString(),
        closeReason: isTP ? 'TP' : 'SL',
        pnlPct, pnlUsd,
      });
      const msg = formatClosed(updated);
      console.log(msg + '\n');
      addEntry('nyopet', msg, now);
      await sendWhatsApp(msg);
    }
  }
}

main().catch((e) => {
  console.error('ERROR nyopetOrderMonitor.js:', e.message);
  process.exit(1);
});
