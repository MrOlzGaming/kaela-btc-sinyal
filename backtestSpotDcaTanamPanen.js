// Riset 25 Agu 2026 (Olan: "setiap bulan isi $100, dibagi ke koin-koin itu termasuk BTC.. karena
// ganjil (7 koin) butuh 3 kandidat lagi -- ZIL punya beb, 2 lain ide Kaela: aku usul TRX & XLM,
// sama-sama OG alt listing lama di Binance biar cukup data lintas siklus" -- basket jadi 10 koin,
// $100/10 = $10 rapi per koin per bulan).
//
// Timing (dikonfirmasi Olan): "ikut window tanam juga, window tanam DCA terus, stop pas halving,
// jual pas window panen/peak" -- jadi BEDA dari backtestAltSpotTanamPanen.js (yang itu 1x beli lump
// sum pas Tanam start doang). Di sini:
//   - Tanam start s/d halving : DCA $100/bulan (uang BARU, dibagi rata ke koin yg udah ada data)
//   - Pas halving             : STOP nambah beli
//   - Halving s/d Panen end   : cuma TAHAN (no action)
//   - Panen end               : JUAL SEMUA -> hasilnya jadi "pot" buat siklus berikutnya
//   - Siklus berikutnya       : pot dari siklus lalu di-invest LUMP SUM pas Tanam start (matching
//     ide awal "beli spot pas tanam"), DITAMBAH tetap lanjut DCA $100/bulan uang baru di atasnya.
// UPDATE (Olan: "peak ga bisa di-predict.. ikuti rata-rata hari peak BTC aja di hari ke berapa,
// kasih poin disitu") -- peak beneran gak dipakai buat nentuin jual REAL-TIME (mustahil ditebak
// live), tapi dihitung dari SEJARAH: cek harga ATH BTC tiap siklus lalu, hari ke-berapa dari
// halving munculnya, rata-ratain, jadiin TITIK JUAL TETAP buat siklus depan. Hasil cek 3 siklus
// (_findpeaks.js, data candle Binance asli bukan tebakan): halving 2016->peak hari ke-526,
// 2020->hari ke-547, 2024->hari ke-536. Rata-rata = hari ke-536 setelah halving -> ini yang
// dipakai sbg PANEN_SELL_DAYS (gantiin PANEN_END_DAYS=549 yang tadinya cuma batas window, bukan
// titik jual beneran).

const { fetchAllCandles } = require('./backtestFlagBreakout');
const { HALVINGS } = require('./halvingBearWindow');

const TANAM_MAX_DAYS = 542, PANEN_END_DAYS = 549;
const PANEN_SELL_DAYS = 536; // rata-rata historis hari peak BTC setelah halving (2016/2020/2024: 526/547/536)
const DAY_MS = 86400000;
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'LTCUSDT', 'DOGEUSDT', 'ZILUSDT', 'TRXUSDT', 'XLMUSDT'];
const MONTHLY_DCA = 100;
const START_TIME = new Date('2017-01-01').getTime();

function priceAt(daily, targetMs) {
  let found = null;
  for (const c of daily) {
    if (c.closeTime > targetMs) break;
    found = c;
  }
  return found ? found.close : null;
}

function addMonths(ms, n) {
  const d = new Date(ms);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.getTime();
}

(async () => {
  const dailyBySymbol = {};
  for (const symbol of SYMBOLS) {
    try {
      dailyBySymbol[symbol] = await fetchAllCandles(symbol, '1d', START_TIME);
    } catch (e) {
      console.log(`${symbol}: gagal ambil data (${e.message})`);
      dailyBySymbol[symbol] = [];
    }
  }

  const now = Date.now();
  const cycles = HALVINGS.map((h) => {
    const t = new Date(h).getTime();
    return { halving: h, tanamStart: t - TANAM_MAX_DAYS * DAY_MS, halvingMs: t, panenEnd: t + PANEN_SELL_DAYS * DAY_MS };
  }).filter((c) => c.panenEnd <= now);

  console.log(`Siklus yang sudah SELESAI: ${cycles.length}`);
  cycles.forEach((c) => console.log(`  Halving ${c.halving}: Tanam ${new Date(c.tanamStart).toISOString().slice(0, 10)} -> Halving (stop DCA) -> Jual hari ke-${PANEN_SELL_DAYS} (${new Date(c.panenEnd).toISOString().slice(0, 10)})`));

  let carryPot = 0;
  let totalFreshCash = 0;

  for (const cycle of cycles) {
    console.log(`\n=== Siklus halving ${cycle.halving} ===`);
    const holdings = {}; // qty per symbol
    let freshCashThisCycle = 0;

    // Lump sum modal bawaan dari siklus sebelumnya, di-invest pas Tanam start.
    if (carryPot > 0) {
      const available0 = SYMBOLS.filter((s) => priceAt(dailyBySymbol[s], cycle.tanamStart) !== null);
      const per0 = carryPot / available0.length;
      available0.forEach((s) => {
        const p = priceAt(dailyBySymbol[s], cycle.tanamStart);
        holdings[s] = (holdings[s] || 0) + per0 / p;
      });
      console.log(`  Lump sum awal (bawaan siklus lalu): $${carryPot.toFixed(2)} -> dibagi ${available0.length} koin`);
    }

    // DCA bulanan $100 (uang baru) dari Tanam start s/d halving (exclusive).
    let dcaDate = cycle.tanamStart;
    let dcaCount = 0;
    while (dcaDate < cycle.halvingMs) {
      const available = SYMBOLS.filter((s) => priceAt(dailyBySymbol[s], dcaDate) !== null);
      if (available.length > 0) {
        const per = MONTHLY_DCA / available.length;
        available.forEach((s) => {
          const p = priceAt(dailyBySymbol[s], dcaDate);
          holdings[s] = (holdings[s] || 0) + per / p;
        });
        freshCashThisCycle += MONTHLY_DCA;
        dcaCount++;
      }
      dcaDate = addMonths(dcaDate, 1);
    }
    console.log(`  DCA: ${dcaCount}x $100/bulan = $${freshCashThisCycle.toFixed(2)} uang baru masuk`);

    // Jual semua pas Panen end.
    let totalValue = 0;
    const rows = [];
    for (const s of SYMBOLS) {
      const qty = holdings[s] || 0;
      if (qty <= 0) continue;
      const sellPrice = priceAt(dailyBySymbol[s], cycle.panenEnd);
      const value = sellPrice !== null ? qty * sellPrice : 0;
      totalValue += value;
      rows.push(`${s}: ${qty.toFixed(6)} @ $${sellPrice ? sellPrice.toFixed(4) : '?'} = $${value.toFixed(2)}`);
    }
    rows.forEach((r) => console.log(`    ${r}`));

    const modalMasukSiklus = carryPot + freshCashThisCycle;
    console.log(`  Modal masuk siklus ini (lump sum + DCA): $${modalMasukSiklus.toFixed(2)} -> Nilai jual Panen: $${totalValue.toFixed(2)} (${((totalValue / modalMasukSiklus - 1) * 100).toFixed(0)}%)`);

    totalFreshCash += freshCashThisCycle;
    carryPot = totalValue;
  }

  console.log(`\n\n========== HASIL AKHIR ==========`);
  console.log(`Total uang baru yang pernah disetor (DCA semua siklus): $${totalFreshCash.toFixed(2)}`);
  console.log(`Modal akhir setelah compound ${cycles.length} siklus: $${carryPot.toFixed(2)}`);
  console.log(`Profit bersih (modal akhir - total setoran): $${(carryPot - totalFreshCash).toFixed(2)}`);
})();
