// Riset 25 Agu 2026 (permintaan Olan: alt-Sniper LONG-only, cuma aktif di window Musim Tanam BTC
// s/d Musim Panen BTC -- "kita ikut BTC halving aja kapan masuknya") -- backtest VALIDASI dulu
// sebelum dipakai live, pola sama kayak riset Astronacci/Fibonacci Time Zone sebelumnya: bandingin
// hasil DENGAN filter window vs TANPA, jangan asumsi doang.
//
// v2 (Olan tanya: "SL kejauhan/kedeketan?" + "leverage alt di-cap 3x gimana?") -- nambah 4 varian
// sizing/SL buat tes 2 hipotesis itu EMPIRIS, bukan debat doang: baseline (sama kayak BTC live),
// SL buffer lebih lebar (1.5% drpd 0.5%), leverage di-cap 3x, dan gabungan keduanya.
//
// Metodologi: reuse detektor pola (flag/wedge) + mesin backtest (runFlagBacktest) yang SAMA
// persis dipakai Sniper BTC live -- cuma allowShort:false (long-only) dan sesudahnya trade
// di-SPLIT berdasar tanggal entry (di dalam/luar window Tanam-Panen BTC), BUKAN filter di
// tengah-simulasi -- biar apple-to-apple ngebandingin "seleksi sinyal yang sama, filter tanggal
// beda" (metodologi identik kayak yang dipakai validasi window istirahat BTC di
// backtestCombinedMultiPos.js, lihat catatan halvingBearWindow.js).

const { runFlagBacktest, fetchAllCandles, summarize } = require('./backtestFlagBreakout');
const { HALVINGS } = require('./halvingBearWindow');

const TANAM_MAX_DAYS = 542, PANEN_END_DAYS = 549;
const DAY_MS = 86400000;

const activeWindows = HALVINGS.map((h) => {
  const t = new Date(h).getTime();
  return { start: t - TANAM_MAX_DAYS * DAY_MS, end: t + PANEN_END_DAYS * DAY_MS, halving: h };
});
function inActiveWindow(ms) {
  return activeWindows.some((w) => ms >= w.start && ms <= w.end);
}

const ALT_SYMBOLS = ['ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'LTCUSDT', 'DOGEUSDT'];
const START_TIME = new Date('2018-01-01').getTime();

const VARIANTS = {
  'A. Baseline (sama BTC live)': { allowShort: false },
  'B. SL buffer lebar (1.5%)': { allowShort: false, slBufferPct: 1.5 },
  'C. Leverage cap 3x': { allowShort: false, maxLeverage: 3 },
  'D. SL lebar + leverage 3x': { allowShort: false, slBufferPct: 1.5, maxLeverage: 3 },
};

function splitByWindow(trades) {
  return {
    inWin: trades.filter((t) => inActiveWindow(t.entryTime)),
    outWin: trades.filter((t) => !inActiveWindow(t.entryTime)),
  };
}

(async () => {
  // Fetch data SEKALI per simbol, dipakai ulang buat semua varian (hemat network).
  const dailyBySymbol = {};
  for (const symbol of ALT_SYMBOLS) {
    try {
      const daily = await fetchAllCandles(symbol, '1d', START_TIME);
      if (daily.length < 100) { console.log(`${symbol}: data kelewat pendek, skip.`); continue; }
      dailyBySymbol[symbol] = daily;
      console.log(`${symbol}: ${daily.length} candle OK`);
    } catch (e) {
      console.log(`${symbol}: gagal ambil data (${e.message})`);
    }
  }

  for (const [variantName, opts] of Object.entries(VARIANTS)) {
    console.log(`\n\n########## VARIAN: ${variantName} ##########`);
    const allTrades = [];
    for (const symbol of Object.keys(dailyBySymbol)) {
      const { trades } = runFlagBacktest(dailyBySymbol[symbol], opts);
      trades.forEach((t) => { t.symbol = symbol; });
      allTrades.push(...trades);
    }
    const { inWin, outWin } = splitByWindow(allTrades);
    console.log('  DALAM window Tanam-Panen:', JSON.stringify(summarize(inWin)));
    console.log('  LUAR window:', JSON.stringify(summarize(outWin)));
    // Rata-rata leverage yang KEPAKE beneran (buktiin cap-nya ngefek, bukan cuma parameter kosong).
    if (inWin.length) {
      // leverage gak disimpen langsung di trade record -- derive dari nilaiPosisi/margin.
      const avgLev = inWin.reduce((s, t) => s + (t.margin ? t.nilaiPosisi / t.margin : 0), 0) / inWin.length;
      console.log('  Rata-rata leverage (dalam window):', avgLev.toFixed(1) + 'x');
    }
  }
})();
