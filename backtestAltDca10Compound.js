// (26 Sep 2026) Backtest KHUSUS konfigurasi Compound Alt DCA yang BENERAN live sekarang
// (spotDcaAltShared.js/spotDcaAlt.js) -- BEDA dari backtestAltSpotTanamPanen.js (riset LAMA
// 25 Agu 2026, basket 6 koin + pool-compound + window ±542/+549 hari sekitar halving, DIGANTI
// sebelum pernah live).
//
// Replikasi PERSIS mekanisme live (spotDcaAlt.js `runBuyStep`/`runSellStep`):
//   - Basket 10 koin: ETHUSDT/BNBUSDT/XRPUSDT/ADAUSDT/LTCUSDT/DOGEUSDT/ZILUSDT/TRXUSDT/XLMUSDT/SOLUSDT.
//   - Beli $10/koin TIAP TANGGAL 5 kalender (UTC), SELAMA window Tanam (halving - 542 hari s/d halving).
//   - Kompound PER-KOIN INDEPENDEN: lot PERTAMA tiap siklus Tanam = $10 + SEMUA hasil jual koin
//     yang SAMA dari siklus sebelumnya (lumpSum) -- BUKAN pool gabungan semua koin.
//   - Jual SEMUA di hari ke-536 setelah halving (rata2 historis hari puncak harga BTC 3 siklus,
//     lihat spotDcaAltShared.js) -- realisasi cash per-koin dibawa ke siklus Tanam BERIKUTNYA.
//   - Koin yang BELUM listing pas window Tanam mulai -- di-skip JUJUR utk siklus itu (gak dipaksa
//     ikut), sama perilaku kayak `priceAt` null-check di backtest lama.
//
// Siklus yang bisa dites SEKARANG (data historis, panen udah lewat): halving 2020-05-11 (panen
// ~2021-10-29) dan 2024-04-19 (panen ~2025-10-08). Siklus 2016 DIBUANG -- basket 10 koin belum
// lengkap listing di window Tanam-nya (~akhir 2014, cuma BTC/LTC yang ada). Siklus 2028 (depan)
// belum relevan -- window Tanam-nya sendiri baru mulai 2026-10-19.

const { fetchAllCandles } = require('./backtestFlagBreakout');
const { HALVINGS } = require('./halvingBearWindow');
const { ALT10_SYMBOLS, PER_COIN_USD, PANEN_SELL_DAYS_AFTER_HALVING } = require('./spotDcaAltShared');

const DAY_MS = 86400000;
const TANAM_DAYS_BEFORE_HALVING = 542; // SAMA jarak WINDOW_START->HALVING_DATE di spotDcaAltShared.js

function priceAt(daily, targetMs) {
  let found = null;
  for (const c of daily) {
    if (c.closeTime > targetMs) break;
    found = c;
  }
  return found ? found.close : null;
}

function monthlyBuyDates(tanamStartMs, halvingMs) {
  const dates = [];
  const start = new Date(tanamStartMs);
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 5));
  if (cursor.getTime() < tanamStartMs) cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 5));
  while (cursor.getTime() < halvingMs) {
    dates.push(cursor.getTime());
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 5));
  }
  return dates;
}

(async () => {
  const dailyBySymbol = {};
  for (const symbol of ALT10_SYMBOLS) {
    try {
      dailyBySymbol[symbol] = await fetchAllCandles(symbol, '1d', new Date('2017-01-01').getTime());
      console.log(`${symbol}: ${dailyBySymbol[symbol].length} candle harian, mulai ${new Date(dailyBySymbol[symbol][0].closeTime).toISOString().slice(0, 10)}`);
    } catch (e) {
      console.log(`${symbol}: gagal ambil data (${e.message})`);
      dailyBySymbol[symbol] = [];
    }
  }

  const now = Date.now();
  const cycles = HALVINGS.map((h) => {
    const halvingMs = new Date(h).getTime();
    const tanamStartMs = halvingMs - TANAM_DAYS_BEFORE_HALVING * DAY_MS;
    const sellMs = halvingMs + PANEN_SELL_DAYS_AFTER_HALVING * DAY_MS;
    return { halving: h, tanamStartMs, halvingMs, sellMs };
  }).filter((c) => c.sellMs <= now);

  console.log(`\nSiklus yang sudah SELESAI (panen udah lewat): ${cycles.length}`);
  cycles.forEach((c) => console.log(`  Halving ${c.halving}: Tanam ${new Date(c.tanamStartMs).toISOString().slice(0, 10)} -> Panen ${new Date(c.sellMs).toISOString().slice(0, 10)}`));

  const realizedCashBySymbol = {};
  ALT10_SYMBOLS.forEach((s) => { realizedCashBySymbol[s] = 0; });

  let grandTotalInvested = 0, grandTotalProceeds = 0;

  for (const cycle of cycles) {
    console.log(`\n=== Siklus halving ${cycle.halving} ===`);
    const buyDates = monthlyBuyDates(cycle.tanamStartMs, cycle.halvingMs);
    let cycleInvested = 0, cycleProceeds = 0;

    for (const symbol of ALT10_SYMBOLS) {
      const daily = dailyBySymbol[symbol];
      if (!daily.length || daily[0].closeTime > cycle.tanamStartMs) {
        console.log(`  ${symbol}: SKIP (belum listing pas window Tanam mulai)`);
        continue;
      }
      let qty = 0, invested = 0, firstLotDone = false;
      for (const buyMs of buyDates) {
        const price = priceAt(daily, buyMs);
        if (price == null) continue;
        const lumpSum = !firstLotDone ? realizedCashBySymbol[symbol] : 0;
        const usdAmount = PER_COIN_USD + lumpSum;
        qty += usdAmount / price;
        invested += usdAmount;
        firstLotDone = true;
      }
      if (invested === 0) { console.log(`  ${symbol}: SKIP (0 hari beli valid)`); continue; }
      realizedCashBySymbol[symbol] = 0; // lumpSum siklus ini udah kepake, reset sebelum jual siklus ini
      const sellPrice = priceAt(daily, cycle.sellMs);
      const proceeds = sellPrice != null ? qty * sellPrice : 0;
      const pnlPct = invested > 0 ? ((proceeds - invested) / invested) * 100 : 0;
      console.log(`  ${symbol}: invest $${invested.toFixed(2)} -> jual $${proceeds.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)`);
      realizedCashBySymbol[symbol] = proceeds; // all-in balik ke koin yang SAMA siklus berikutnya
      cycleInvested += invested;
      cycleProceeds += proceeds;
    }
    console.log(`  TOTAL siklus ini: invest $${cycleInvested.toFixed(2)} -> jual $${cycleProceeds.toFixed(2)} (${cycleProceeds >= cycleInvested ? '+' : ''}${(cycleProceeds - cycleInvested).toFixed(2)}, ${(((cycleProceeds / cycleInvested) - 1) * 100).toFixed(1)}%)`);
    grandTotalInvested += cycleInvested;
    grandTotalProceeds += cycleProceeds;
  }

  console.log(`\n=== AGREGAT SEMUA SIKLUS SELESAI ===`);
  console.log(`Total modal DCA disetor: $${grandTotalInvested.toFixed(2)}`);
  console.log(`Total hasil jual (semua koin, semua siklus): $${grandTotalProceeds.toFixed(2)}`);
  console.log(`Net: ${grandTotalProceeds >= grandTotalInvested ? '+' : ''}$${(grandTotalProceeds - grandTotalInvested).toFixed(2)} (${(((grandTotalProceeds / grandTotalInvested) - 1) * 100).toFixed(1)}%)`);
  console.log(`\nCatatan: "realized cash per koin" di akhir run ini (siklus terakhir yg SELESAI) BUKAN\nakhir cerita -- itu yg bakal di-all-in balik pas siklus 2028 mulai (belum dihitung di sini).`);
})();
