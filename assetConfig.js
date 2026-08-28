// Konfigurasi aset yang didukung Sniper (22 Agu 2026, upgrade multi-aset+multi-mode) -- SATU
// sumber kebenaran dipakai sniperAutoAnalysis.js, sniperOrderMonitor.js, DAN web (nilainya
// di-mirror manual ke web/js/*.js karena itu browser-side, gak bisa require() file Node).
//
// XAU/Emas pakai PAXGUSDT (token emas asli di Binance, 1 token = 1 troy ounce emas, dijaga
// Paxos) -- BUKAN data futures GC=F (itu cuma dipakai riset/backtest karena histori panjang,
// gak ada feed live gratis buat live trading). PAXGUSDT dipilih drpd XAUTUSDT krn history data
// -api.binance.vision buat PAXG lebih konsisten pas dites 22 Agu 2026.
const ASSETS = {
  btc: {
    key: 'btc',
    symbol: 'BTCUSDT',
    // Label = PERSIS simbol Binance (29 Agu 2026, permintaan Olan: "kalo di akun binance pasang
    // paxg ya di web paxg juga bukan malah xau" -- gak ada terjemahan/nama cantik lagi, samain
    // 1:1 sama yang keliatan di app Binance biar gak perlu mikir cocokin).
    label: 'BTCUSDT',
    emoji: '🟧',
    // Window "istirahat" (siklus halving) CUMA berlaku BTC -- lihat halvingBearWindow.js.
    useHalvingBearWindow: true,
  },
  xau: {
    key: 'xau',
    symbol: 'PAXGUSDT',
    // Label = PERSIS simbol Binance (29 Agu 2026, Olan: "kalo di akun binance pasang paxg ya di
    // web paxg juga bukan malah xau, biar ga muter muter kepalaku" -- dulu dicoba "XAU/Emas
    // (PAXGUSDT)" tapi masih bikin bingung krn ada 2 nama, sekarang SATU nama doang = PAXGUSDT).
    label: 'PAXGUSDT',
    emoji: '🟡',
    useHalvingBearWindow: false,
  },
};

module.exports = { ASSETS };
