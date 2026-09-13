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

// 13 Sep 2026, permintaan Olan: "kita akan kabur 1 bulan buat tidak trading sebelum saat window
// mendekati habis" -- BTC (beda dari Emas SMA200 yang reaktif/gak bisa diprediksi) punya tanggal
// transisi yang UDAH DIKETAHUI dari sekarang (siklus halving, `bearWindows` array), jadi bisa
// dihitung mundur. Dipakai buat JEDA auto-trading (BUKAN nutup posisi yang lagi jalan -- itu
// tugas WINDOW_FLIP force-close yang udah ada, ini CUMA nolak entry BARU) di hari-hari terakhir
// sebelum window (bull ATAU bear) ganti -- alasan: entry baru yang kebuka mepet banget sama
// transisi kemungkinan besar bakal langsung kena force-close lagi begitu window ganti, buang
// biaya (spread/fee/slippage) tanpa sempat profit sama sekali.
function daysUntilBtcWindowFlip(date = new Date()) {
  const ms = date.getTime();
  const boundaries = [];
  for (const w of bearWindows) { boundaries.push(w.start); boundaries.push(w.end); }
  const future = boundaries.filter((b) => b > ms).sort((a, b) => a - b);
  if (future.length === 0) return Infinity; // gak ada halving berikutnya terdaftar (HALVINGS perlu di-update)
  return (future[0] - ms) / 86400000;
}

function isBtcApproachingWindowFlip(date = new Date(), thresholdDays = 30) {
  return daysUntilBtcWindowFlip(date) <= thresholdDays;
}

module.exports = { isBtcBearWindow, bearWindows, HALVINGS, daysUntilBtcWindowFlip, isBtcApproachingWindowFlip };
