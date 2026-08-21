// Window "istirahat" siklus halving BTC (22 Agu 2026, riset+validasi backtestCombinedMultiPos.js)
// -- SATU sumber kebenaran dipakai backtest MAUPUN live (sniperAutoAnalysis.js), biar gak
// diam-diam geser beda logic. CUMA berlaku buat BTC (siklus halving gak relevan buat aset lain).
//
// Window = dari akhir Musim Panen (halving+549 hari) sampai awal Musim Tanam siklus BERIKUTNYA
// (halving_next-542 hari) -- fase pasca-puncak yang historis rawan bear/crash. Verifikasi
// backtest: 26 trade yang entry di window ini RUGI -$19.753 total, 98 trade di luar UNTUNG
// +$58.109 (backtestCombinedMultiPos.js, 22 Agu 2026). Dengan halt, modal akhir naik $39.156->
// $48.363 (PF 1,40->1,77), walau max DD gak berubah (episode drawdown terburuk kita, Sep-Nov 2019,
// ternyata jatuh DI LUAR window ini).
//
// HALVINGS[terakhir] = NEXT_HALVING_EST (groupReport.js) -- estimasi resmi proyek buat halving
// berikutnya, WAJIB di-update manual kalau tanggal itu berubah/dikonfirmasi ulang.
const HALVINGS = ['2016-07-09', '2020-05-11', '2024-04-19', '2028-04-13'];
const PANEN_END_DAYS = 549, TANAM_MAX_DAYS = 542;

const bearWindows = [];
for (let i = 0; i < HALVINGS.length - 1; i++) {
  const h = new Date(HALVINGS[i]).getTime();
  const hNext = new Date(HALVINGS[i + 1]).getTime();
  bearWindows.push({ start: h + PANEN_END_DAYS * 86400000, end: hNext - TANAM_MAX_DAYS * 86400000 });
}

function isBtcBearWindow(date = new Date()) {
  const ms = date.getTime();
  return bearWindows.some((w) => ms >= w.start && ms <= w.end);
}

module.exports = { isBtcBearWindow, bearWindows, HALVINGS };
