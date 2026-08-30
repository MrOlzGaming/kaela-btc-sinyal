// Konfigurasi aset Nyopet (23 Agu 2026, permintaan Olan: "semua mode sniper dan nyopet berlaku
// buat semua aset.. baik BTC dan PAXG.. suatu saat kalo mungkin bisa tambah aset") -- pola SAMA
// kayak assetConfig.js Sniper.
//
// `symbol` = simbol EKSEKUSI (dikirim ke exchange buat buka posisi beneran). `zoneSymbol` = simbol
// buat DETEKSI ZONA/chart (darkKaelaZones.js) -- publik, TETAP Binance buat Emas walau eksekusinya
// pindah, biar gak perlu bangun feed candle MEXC juga. `exchange` (BARU, 30 Agu 2026) nentuin
// client mana (Binance/MEXC) yang dipanggil buat `symbol` itu -- lihat nyopetAutoTrader.js.
//
// 30 Agu 2026 -- migrasi EKSEKUSI Emas ke MEXC (lihat memori project-kaela-multi-exchange, "4
// dompet independen, POLA SAMA PERSIS kayak Binance": Sniper=USDT, Nyopet=USDC -- Olan eksplisit
// minta ini SETELAH ketauan MEXC ternyata beneran punya kontrak USDC buat emas juga, bukan cuma
// USDT). Nyopet Emas dapat token PAXG+USDC (beda dari Sniper Emas yang dapat XAUT+USDT) -- 2 lapis
// pembeda sekaligus (token BEDA + margin asset BEDA), gak kembar sama sekali walau exchange sama.
const NYOPET_ASSETS = {
  // Label = PERSIS simbol Binance (29 Agu 2026, Olan: "kalo di akun binance pasang paxg ya di
  // web paxg juga bukan malah xau, biar ga muter muter kepalaku") -- Nyopet BTC pakai wallet
  // USDC jadi tikernya BTCUSDC, BEDA dari Sniper (BTCUSDT). BTC TETAP Binance, gak pindah apa-apa.
  btc: { key: 'btc', symbol: 'BTCUSDC', exchange: 'binance', marginAsset: 'USDC', zoneSymbol: 'BTCUSDT', label: 'BTCUSDC', emoji: '🟧' },
  // 30 Agu 2026 -- symbol eksekusi PAXG_USDC (MEXC, margin USDC -- verified LIVE via
  // contract/detail MEXC: contractSize 0.001, quoteCoin USDC, state aktif). zoneSymbol TETAP
  // PAXGUSDT/Binance (chart-nya udah lama+konsisten, gak ada alasan pindah cuma buat baca zona).
  xau: { key: 'xau', symbol: 'PAXG_USDC', exchange: 'mexc', marginAsset: 'USDC', zoneSymbol: 'PAXGUSDT', label: 'PAXG_USDC', emoji: '🟡' },
};

module.exports = { NYOPET_ASSETS };
