// Konfigurasi aset yang didukung Sniper (22 Agu 2026, upgrade multi-aset+multi-mode) -- SATU
// sumber kebenaran dipakai sniperAutoAnalysis.js, sniperOrderMonitor.js, DAN web (nilainya
// di-mirror manual ke web/js/*.js karena itu browser-side, gak bisa require() file Node).
//
// XAU/Emas (30 Agu 2026, migrasi EKSEKUSI ke MEXC -- lihat memori project-kaela-multi-exchange,
// "4 dompet independen": Sniper BTC & Nyopet BTC tetap Binance, Sniper Emas & Nyopet Emas pindah
// eksekusi ke MEXC, 2 token beda (XAUT vs PAXG) biar gak kembar). PENTING -- `symbol` TETAP
// PAXGUSDT/Binance (dipakai buat CHART/pattern analysis, fetchCandles/fetchLivePrice/sentiment/
// onchain -- publik, gak butuh akun MEXC, data historinya udah lama+konsisten). `execSymbol` +
// `exchange` field BARU, KHUSUS dipakai di titik EKSEKUSI ORDER doang (setLeverage/
// placeMarketEntry/placeStopLoss/dkk) -- JANGAN campur adukin dua field ini, beda tujuan total.
const ASSETS = {
  btc: {
    key: 'btc',
    symbol: 'BTCUSDT',
    execSymbol: 'BTCUSDT', // sama kayak symbol -- BTC TETAP Binance, gak pindah apa-apa
    exchange: 'binance',
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
    symbol: 'PAXGUSDT', // TETAP Binance -- chart/pattern analysis, JANGAN diubah ke MEXC
    // 30 Agu 2026 -- EKSEKUSI pindah ke XAUT_USDT (MEXC, format simbol underscore beda dari
    // Binance -- verified via contract/detail MEXC, contractSize 0.001). Nyopet Emas dapat
    // PAXG_USDT (nyopetAssetConfig.js) -- 2 token beda biar Sniper Emas vs Nyopet Emas gak kembar
    // simbolnya walau dua-duanya sekarang eksekusi di MEXC.
    execSymbol: 'XAUT_USDT',
    exchange: 'mexc',
    // Label dipisah dari execSymbol (30 Agu -> revisi 3 Sep 2026). Sempat dicoba label = execSymbol
    // asli (XAUT_USDT) biar 1:1 sama app MEXC, TAPI Olan malah bingung/kaget nemu "XAUT USDT" --
    // dia expect "XAU" (ticker Emas yang dia kenal, gaya Binance BTCUSDT/PAXGUSDT), bukan nama token
    // MEXC. Balik ke gaya Binance-style: base XAU + quote margin asset (USDT), BUKAN literal MEXC.
    label: 'XAUUSDT',
    emoji: '🟡',
    useHalvingBearWindow: false,
  },
};

module.exports = { ASSETS };
