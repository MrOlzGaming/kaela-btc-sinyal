// Riset 25 Agu 2026 (permintaan Olan: alt-Sniper LONG-only, cuma aktif di window Musim Tanam BTC
// s/d Musim Panen BTC -- "kita ikut BTC halving aja kapan masuknya") -- backtest VALIDASI dulu
// sebelum dipakai live, pola sama kayak riset Astronacci/Fibonacci Time Zone sebelumnya: bandingin
// hasil DENGAN filter window vs TANPA, jangan asumsi doang.
//
// v2 (Olan tanya: "SL kejauhan/kedeketan?" + "leverage alt di-cap 3x gimana?") -- 4 varian
// sizing/SL, kesimpulan: baseline udah paling bagus, JANGAN diubah (lihat memory).
//
// v3 (Olan: "modal awal $100 gak deposit KECUALI kena drawdown $50 dari modal awal, backtest
// ulang lapor hasilnya jadi berapa") -- simulasi bankroll REALISTIS: entry DIGERBANG di dalam
// loop (bukan post-hoc split) pakai window Tanam-Panen (biar urutan compounding beneran kayak
// live), gak ada topUp bulanan, HANYA rescue deposit $50 begitu capital jatuh ke $50 (nambah $50
// balik ke $100). Laporan: finalCapital & maxDrawdown per akun (independen, tiap alt $100 sendiri
// -- BUKAN 1 bankroll gabungan buat 6 alt, matching desain "tiap alt akun sendiri" yang direncanain).

const { runFlagBacktest, fetchAllCandles } = require('./backtestFlagBreakout');
const { HALVINGS } = require('./halvingBearWindow');

const TANAM_MAX_DAYS = 542, PANEN_END_DAYS = 549;
const DAY_MS = 86400000;
const activeWindows = HALVINGS.map((h) => {
  const t = new Date(h).getTime();
  return { start: t - TANAM_MAX_DAYS * DAY_MS, end: t + PANEN_END_DAYS * DAY_MS };
});
function inActiveWindow(dateObj) {
  const ms = dateObj.getTime();
  return activeWindows.some((w) => ms >= w.start && ms <= w.end);
}

const ALT_SYMBOLS = ['ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'LTCUSDT', 'DOGEUSDT'];
const START_TIME = new Date('2018-01-01').getTime();

(async () => {
  let totalStart = 0, totalFinal = 0;
  for (const symbol of ALT_SYMBOLS) {
    let daily;
    try {
      daily = await fetchAllCandles(symbol, '1d', START_TIME);
    } catch (e) {
      console.log(`${symbol}: gagal ambil data (${e.message})`);
      continue;
    }
    if (daily.length < 100) { console.log(`${symbol}: data kelewat pendek, skip.`); continue; }

    const { trades, finalCapital, maxDrawdownPct } = runFlagBacktest(daily, {
      allowShort: false,
      startCapital: 100,
      topUpAmount: 0,
      rescueDrawdownUsd: 50,
      rescueDepositUsd: 50,
      entryDateFilter: inActiveWindow,
    });
    console.log(`${symbol}: ${trades.length} trade | Modal akhir: $${finalCapital.toFixed(2)} | Max DD: ${maxDrawdownPct.toFixed(1)}%`);
    totalStart += 100;
    totalFinal += finalCapital;
  }
  console.log(`\nTOTAL (${ALT_SYMBOLS.length} akun $100 independen, modal gabungan $${totalStart}): $${totalFinal.toFixed(2)} (${((totalFinal / totalStart - 1) * 100).toFixed(0)}%)`);
})();
