// Riset 25 Agu 2026 (Olan: "kurang optimal eh.. coba: pas window tanam beli SPOT koin 6 itu $100,
// pas window panen jual, terus di-compound") -- BEDA total dari backtestAltHalvingWindow.js (itu
// Sniper leverage+pattern, DIGERBANG window). Ini murni SPOT, gak ada leverage/SL/pattern sama
// sekali -- persis mirror strategi "Musiman" BTC yang udah ada (1 beli di Tanam, 1 jual di Panen),
// diterapin ke BASKET 6 alt (bukan 1-1 per akun kayak riset sebelumnya) + di-compound ANTAR SIKLUS
// (hasil jual siklus ke-N jadi modal beli siklus ke-N+1).

const { fetchAllCandles } = require('./backtestFlagBreakout');
const { HALVINGS } = require('./halvingBearWindow');

const TANAM_MAX_DAYS = 542, PANEN_END_DAYS = 549;
const DAY_MS = 86400000;
const ALT_SYMBOLS = ['ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'LTCUSDT', 'DOGEUSDT'];
const START_TIME = new Date('2018-01-01').getTime();

// Harga di tanggal tertentu -- candle TERDEKAT yang closeTime-nya <= target (kalau data belum
// mulai di tanggal itu, null -- koin itu di-skip buat siklus ini, JUJUR bukan dipaksa ikut).
function priceAt(daily, targetMs) {
  let found = null;
  for (const c of daily) {
    if (c.closeTime > targetMs) break;
    found = c;
  }
  return found ? found.close : null;
}

(async () => {
  const dailyBySymbol = {};
  for (const symbol of ALT_SYMBOLS) {
    try {
      dailyBySymbol[symbol] = await fetchAllCandles(symbol, '1d', START_TIME);
    } catch (e) {
      console.log(`${symbol}: gagal ambil data (${e.message})`);
    }
  }

  // Siklus yang PANEN-nya udah lewat SEKARANG doang (siklus yang masih berjalan/belum panen gak
  // ikut dihitung -- gak fair ngitung "hasil" dari siklus yang belum kelar).
  const now = Date.now();
  const cycles = HALVINGS.map((h) => {
    const t = new Date(h).getTime();
    return { halving: h, tanamStart: t - TANAM_MAX_DAYS * DAY_MS, panenEnd: t + PANEN_END_DAYS * DAY_MS };
  }).filter((c) => c.panenEnd <= now);

  console.log(`Siklus yang sudah SELESAI (panen udah lewat): ${cycles.length}`);
  cycles.forEach((c) => console.log(`  Halving ${c.halving}: Tanam ${new Date(c.tanamStart).toISOString().slice(0, 10)} -> Panen ${new Date(c.panenEnd).toISOString().slice(0, 10)}`));

  let pot = 100;
  for (const cycle of cycles) {
    console.log(`\n=== Siklus halving ${cycle.halving} (modal masuk: $${pot.toFixed(2)}) ===`);
    const available = ALT_SYMBOLS.filter((s) => dailyBySymbol[s] && priceAt(dailyBySymbol[s], cycle.tanamStart) !== null);
    const missing = ALT_SYMBOLS.filter((s) => !available.includes(s));
    if (missing.length) console.log(`  Skip (belum listing pas Tanam): ${missing.join(', ')}`);
    if (!available.length) { console.log('  Gak ada koin yang punya data, siklus ini dilewatin (pot tetap).'); continue; }

    const perCoin = pot / available.length;
    let potAfterPanen = 0;
    for (const symbol of available) {
      const buyPrice = priceAt(dailyBySymbol[symbol], cycle.tanamStart);
      const sellPrice = priceAt(dailyBySymbol[symbol], cycle.panenEnd);
      const qty = perCoin / buyPrice;
      const value = sellPrice !== null ? qty * sellPrice : perCoin; // kalau data kehabisan sebelum panen, anggap flat (jujur, bukan asumsi untung)
      const retPct = (value / perCoin - 1) * 100;
      console.log(`  ${symbol}: beli $${buyPrice.toFixed(4)} -> jual $${sellPrice ? sellPrice.toFixed(4) : '(data habis)'} | $${perCoin.toFixed(2)} -> $${value.toFixed(2)} (${retPct >= 0 ? '+' : ''}${retPct.toFixed(1)}%)`);
      potAfterPanen += value;
    }
    console.log(`  Total abis panen siklus ini: $${potAfterPanen.toFixed(2)}`);
    pot = potAfterPanen;
  }

  console.log(`\n\n========== HASIL AKHIR (compound ${cycles.length} siklus) ==========`);
  console.log(`Modal awal: $100 -> Modal akhir: $${pot.toFixed(2)} (${((pot / 100 - 1) * 100).toFixed(0)}%)`);
})();
