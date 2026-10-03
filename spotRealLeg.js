// spotRealLeg.js (3 Okt 2026) -- leg REAL buat Compound Alt DCA + Musiman BTC (sebelumnya cuma demo Spot Testnet).
// Arahan Olan 3 Okt: "semua sistem jalan otomatis.. demo dan real jalan". Rencana beli/jual SAMA PERSIS sama demo (dibikin
// spotDcaAlt.js / spotDca.js -> pendingLiveBuy/pendingLiveSell), dieksekusi spotAltLiveExecutor.js ke 2 akun.
//
// ATURAN AMAN (uang asli):
//   - Beli CUMA pakai saldo USDT bebas di SPOT real. TIDAK nyairin Earn/tabungan (ensureSpotBalance sengaja gak dipakai),
//     gak mindahin dana dari futures. Saldo kurang -> beli koin itu di-skip DIAM (bukan error), dicatat.
//   - Kepemilikan real dicatat TERPISAH (kaela-spot-real-ledger.json) -- jual cuma jumlah yang dibeli sistem ini (dibatasi
//     saldo koin sebenarnya, karena fee beli Binance dipotong dari koinnya). Koin punya Olan di luar itu GAK disentuh.
//   - WA cuma ke Wibowo Hedgefund (kebijakan: info real gak ke Sniper Club), dan cuma kalau ADA yang dieksekusi/gagal beneran.
//   - ANGGARAN KHUSUS (realBudgetUsd di spot-live-config.json): leg real cuma boleh belanja total segini (kumulatif, dicatat
//     ledger.spentUsd). Alasan: setoran Olan ke Binance MENDARAT DI SPOT dulu sebelum dipindah ke futures -- tanpa anggaran,
//     DCA bisa 'makan' setoran itu. Sesuai kebijakan setoran bulanan: Alt DCA cuma dapet jatah kalau 4 dompet trading udah
//     cap $1000. Default 0 = gak belanja sampai ada alokasi.
//   - Saklar: spot-live-config.json { allowReal, realBudgetUsd }.

const fs = require('fs');
const path = require('path');

const LEDGER_PATH = path.join(__dirname, 'kaela-spot-real-ledger.json');
const CONFIG_PATH = path.join(__dirname, 'spot-live-config.json');
const MIN_ORDER_USD = 5; // minimum notional Binance spot (BTCUSDT dkk)

function loadConfig() {
  try { return { allowReal: false, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; } catch { return { allowReal: false }; }
}
function freshLedger() { return { alt: {}, musiman: { BTCUSDT: 0 }, spentUsd: 0, history: [] }; }
function loadLedger(p = LEDGER_PATH) {
  try { return { ...freshLedger(), ...JSON.parse(fs.readFileSync(p, 'utf8')) }; } catch { return freshLedger(); }
}
function saveLedger(l, p = LEDGER_PATH) { fs.writeFileSync(p, JSON.stringify(l, null, 2)); }
const baseOf = (symbol) => symbol.replace(/USDT$/, '');

// amounts: { SYMBOL: usd }. bucket: 'alt' | 'musiman'. Return { lines[], executed, skippedLowBalance }
async function realBuys(client, ledger, bucket, amounts, now = new Date(), budgetUsd = Infinity) {
  const lines = []; let executed = 0, skippedLowBalance = 0;
  let free = Math.min(await client.getSpotBalance('USDT'), Math.max(0, budgetUsd - (ledger.spentUsd || 0)));
  for (const [symbol, usdRaw] of Object.entries(amounts)) {
    const usd = Math.round(Number(usdRaw) * 100) / 100;
    if (!(usd >= MIN_ORDER_USD)) { lines.push(`⏭️ ${baseOf(symbol)}: $${usd} di bawah minimum order $${MIN_ORDER_USD} -- skip`); continue; }
    if (free < usd) { skippedLowBalance += 1; continue; }
    try {
      const o = await client.placeSpotMarketBuy({ symbol, quoteOrderQty: usd });
      ledger[bucket][symbol] = (ledger[bucket][symbol] || 0) + o.executedQty;
      free -= o.cumulativeQuote;
      ledger.spentUsd = (ledger.spentUsd || 0) + o.cumulativeQuote;
      executed += 1;
      ledger.history.push({ at: now.toISOString(), bucket, side: 'BUY', symbol, usd: o.cumulativeQuote, qty: o.executedQty, price: o.avgPrice });
      lines.push(`✅ ${baseOf(symbol)}: $${o.cumulativeQuote.toFixed(2)} -> ${o.executedQty} @ $${o.avgPrice.toFixed(4)}`);
    } catch (e) {
      lines.push(`❌ ${baseOf(symbol)}: GAGAL -- ${e.message}`);
    }
  }
  return { lines, executed, skippedLowBalance };
}

// symbols: [SYMBOL]. Jual SEMUA yang tercatat di ledger bucket itu (dibatasi saldo koin asli).
async function realSells(client, ledger, bucket, symbols, now = new Date()) {
  const lines = []; let executed = 0;
  for (const symbol of symbols) {
    const held = ledger[bucket][symbol] || 0;
    if (!(held > 0)) continue;
    try {
      const actual = await client.getSpotBalance(baseOf(symbol));
      const qty = Math.min(held, actual);
      if (!(qty > 0)) { ledger[bucket][symbol] = 0; lines.push(`⚠️ ${baseOf(symbol)}: tercatat ${held} tapi saldo asli 0 -- ledger dinolkan`); continue; }
      const o = await client.placeSpotMarketSell({ symbol, quantity: qty });
      ledger[bucket][symbol] = Math.max(0, held - o.executedQty);
      ledger.spentUsd = Math.max(0, (ledger.spentUsd || 0) - o.cumulativeQuote); // hasil jual balik ke anggaran (compound)
      if (ledger[bucket][symbol] < held * 0.01) ledger[bucket][symbol] = 0; // sisa debu pembulatan/fee
      executed += 1;
      ledger.history.push({ at: now.toISOString(), bucket, side: 'SELL', symbol, usd: o.cumulativeQuote, qty: o.executedQty, price: o.avgPrice });
      lines.push(`✅ ${baseOf(symbol)}: ${o.executedQty} -> $${o.cumulativeQuote.toFixed(2)} @ $${o.avgPrice.toFixed(4)}`);
    } catch (e) {
      lines.push(`❌ ${baseOf(symbol)}: GAGAL jual -- ${e.message}`);
    }
  }
  return { lines, executed };
}

module.exports = { loadConfig, loadLedger, saveLedger, freshLedger, realBuys, realSells, MIN_ORDER_USD, LEDGER_PATH };
