// Monitor posisi Nyopet REAL -- jalan bareng dark-kaela-monitor.yml (cron 5 menit). Posisi
// dibuka MANUAL sama Olan langsung di exchange asli; sistem CUMA mantau harga live buat deteksi
// likuidasi/profit 100% ROI, catat hasilnya ke nyopet-journal.json, dan kirim WA -- TIDAK PERNAH
// eksekusi apapun ke exchange asli (gak ada API key exchange sama sekali di sistem ini).

const { getSummary, closePosition, markProfit100Notified, markWarning80Notified } = require('./nyopetJournal');
const { formatLiquidated, formatProfit100, formatWarning80, format100TradeEvaluasi } = require('./nyopetJournalLog');
const { sendWhatsApp } = require('./fonnte');
const { fetchWithRetry } = require('./httpRetry');

const DRY_RUN = process.env.DARK_KAELA_DRY_RUN === '1';
async function sendWhatsAppOrDryRun(msg) {
  if (DRY_RUN) {
    console.log('[NyopetPositionMonitor] DRY RUN -- gak beneran kirim WA. Pesan yang HARUSNYA terkirim:\n' + msg);
    return;
  }
  await sendWhatsApp(msg);
}

async function fetchLivePrice() {
  const res = await fetchWithRetry('https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT');
  const data = await res.json();
  return parseFloat(data.price);
}

async function main() {
  const summary = getSummary();
  const pos = summary.openPosition;
  if (!pos) {
    console.log('[NyopetPositionMonitor]', new Date().toISOString(), '-- gak ada posisi Nyopet terbuka, skip.');
    return;
  }

  const price = await fetchLivePrice();
  // ROI% = pergerakan harga searah profit × leverage (diverifikasi cocok sama tampilan exchange
  // asli Olan: entry $63.596,10 -> mark $63.592,90, leverage 100x -> ROI dihitung +0,48%, sama
  // persis rumus ini: (entry-mark)/entry*100*100 = 0,503% ~ 0,48% tampilan, beda tipis wajar
  // dari fee/funding yang gak kita hitung).
  const roiPct = pos.direction === 'short'
    ? (pos.entryPrice - price) / pos.entryPrice * pos.leverage * 100
    : (price - pos.entryPrice) / pos.entryPrice * pos.leverage * 100;
  const liquidated = pos.direction === 'short' ? price >= pos.liqPrice : price <= pos.liqPrice;

  if (liquidated) {
    const trade = closePosition({ exitPrice: price, exitReason: 'liquidasi', result: 'loss' });
    const newSummary = getSummary();
    const msg = formatLiquidated(trade, newSummary, new Date());
    console.log(msg + '\n');
    await sendWhatsAppOrDryRun(msg);
    if (newSummary.total === newSummary.targetTrades) {
      await sendWhatsAppOrDryRun(format100TradeEvaluasi(newSummary, new Date()));
    }
    console.log('[NyopetPositionMonitor] Posisi kena likuidasi @', price);
    return;
  }

  // Peringatan DINI (16 Agu 2026, permintaan Olan: "jangan nunggu kena liq, tapi saat posisiku
  // -80%") -- posisi MASIH terbuka (bukan closePosition, beda dari cabang liquidated di atas),
  // cuma ngingetin lebih awal biar Olan sempat mutusin (tambah margin/tutup manual/biarin).
  if (roiPct <= -80 && !pos.warning80Notified) {
    const msg = formatWarning80(pos, price, roiPct, new Date());
    console.log(msg + '\n');
    await sendWhatsAppOrDryRun(msg);
    if (!DRY_RUN) markWarning80Notified();
    console.log('[NyopetPositionMonitor] Warning -80% ROI terkirim.');
    return;
  }

  if (roiPct >= 100 && !pos.profit100Notified) {
    const msg = formatProfit100(pos, price, roiPct, new Date());
    console.log(msg + '\n');
    await sendWhatsAppOrDryRun(msg);
    if (!DRY_RUN) markProfit100Notified();
    console.log('[NyopetPositionMonitor] Profit 100% tercapai, notifikasi terkirim.');
    return;
  }

  console.log('[NyopetPositionMonitor]', new Date().toISOString(), '-- posisi masih jalan, harga', price, '| ROI', roiPct.toFixed(1) + '%');
}

main().catch((e) => {
  console.error('ERROR nyopetPositionMonitor.js:', e.message);
  process.exit(1);
});
