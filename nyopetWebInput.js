// Handler input posisi Nyopet dari FORM WEB (17 Agu 2026, permintaan Olan: "kasih aku metode
// input lewat web langsung.. karena sampe jumat aku ga bisa input kayak tadi kasih foto disini").
// Dipanggil dari .github/workflows/nyopet-web-input.yml (workflow_dispatch, PIN dicek di WORKFLOW
// SEBELUM script ini dipanggil sama sekali -- lihat catatan PIN di situ). Baca semua input dari
// environment variable (workflow_dispatch inputs -> env), BUKAN argv, biar konsisten sama pola
// secrets.js di seluruh project ini.

const { openPosition, closePosition, getSummary, markProfit100Notified, markWarning80Notified } = require('./nyopetJournal');
const { formatOpened, formatManualClosed, format100TradeEvaluasi } = require('./nyopetJournalLog');
const { sendWhatsApp } = require('./fonnte');

async function main() {
  const action = process.env.NYOPET_ACTION;
  const now = new Date();

  if (action === 'open') {
    const pos = openPosition({
      direction: process.env.NYOPET_DIRECTION,
      entryPrice: parseFloat(process.env.NYOPET_ENTRY),
      liqPrice: parseFloat(process.env.NYOPET_LIQ),
      marginUsd: parseFloat(process.env.NYOPET_MARGIN),
      sizeUsd: parseFloat(process.env.NYOPET_SIZE),
      leverage: parseFloat(process.env.NYOPET_LEVERAGE),
      notes: process.env.NYOPET_NOTES || null,
    }, now);
    const msg = formatOpened(pos, now);
    console.log(msg + '\n');
    await sendWhatsApp(msg);
    console.log('[NyopetWebInput] Posisi dibuka via web:', pos.direction, '@', pos.entryPrice);
    return;
  }

  if (action === 'close') {
    const entry = getSummary().openPosition;
    if (!entry) throw new Error('Gak ada posisi Nyopet yang lagi terbuka buat ditutup.');
    const exitPrice = parseFloat(process.env.NYOPET_EXIT);
    // Hasil dihitung OTOMATIS dari arah+entry+exit -- bukan dipilih manual, biar gak ada salah
    // ketik "menang" pas sebenarnya rugi (atau sebaliknya).
    const result = entry.direction === 'short'
      ? (exitPrice < entry.entryPrice ? 'win' : 'loss')
      : (exitPrice > entry.entryPrice ? 'win' : 'loss');
    const trade = closePosition({ exitPrice, exitReason: 'manual', result }, now);
    const summary = getSummary();
    const msg = formatManualClosed(trade, summary, now);
    console.log(msg + '\n');
    await sendWhatsApp(msg);
    if (summary.total === summary.targetTrades) {
      await sendWhatsApp(format100TradeEvaluasi(summary, now));
    }
    console.log('[NyopetWebInput] Posisi ditutup via web:', trade.result, '@', trade.exitPrice);
    return;
  }

  throw new Error('NYOPET_ACTION gak dikenali: ' + action);
}

main().catch((e) => {
  console.error('ERROR nyopetWebInput.js:', e.message);
  process.exit(1);
});
