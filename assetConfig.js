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
    label: 'BTC',
    emoji: '🟧',
    // Window "istirahat" (siklus halving) CUMA berlaku BTC -- lihat halvingBearWindow.js.
    useHalvingBearWindow: true,
  },
  xau: {
    key: 'xau',
    symbol: 'PAXGUSDT',
    label: 'XAU/Emas',
    emoji: '🟡',
    useHalvingBearWindow: false,
  },
};

module.exports = { ASSETS };
