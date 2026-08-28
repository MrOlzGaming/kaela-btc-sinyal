// Konfigurasi aset Nyopet (23 Agu 2026, permintaan Olan: "semua mode sniper dan nyopet berlaku
// buat semua aset.. baik BTC dan PAXG.. suatu saat kalo mungkin bisa tambah aset") -- pola SAMA
// kayak assetConfig.js Sniper, tapi Nyopet BUKAN semua di USDT: BTC pakai wallet USDC (terpisah
// dari Sniper), PAXG TERPAKSA numpang USDT (PAXGUSDC GAK ADA di Binance, dicek 23 Agu 2026 --
// exchangeInfo cuma balikin PAXGUSDT) -- pemisahan wallet USDT=Sniper/USDC=Nyopet jadi gak 100%
// bersih khusus buat emas, tapi itu batasan Binance, bukan pilihan desain.
const NYOPET_ASSETS = {
  // Label = PERSIS simbol Binance (29 Agu 2026, Olan: "kalo di akun binance pasang paxg ya di
  // web paxg juga bukan malah xau, biar ga muter muter kepalaku") -- Nyopet BTC pakai wallet
  // USDC jadi tikernya BTCUSDC, BEDA dari Sniper (BTCUSDT).
  btc: { key: 'btc', symbol: 'BTCUSDC', marginAsset: 'USDC', zoneSymbol: 'BTCUSDT', label: 'BTCUSDC', emoji: '🟧' },
  // Sama -- SATU nama doang, persis ticker app Binance, gak ada "XAU/Emas" lagi.
  xau: { key: 'xau', symbol: 'PAXGUSDT', marginAsset: 'USDT', zoneSymbol: 'PAXGUSDT', label: 'PAXGUSDT', emoji: '🟡' },
};

module.exports = { NYOPET_ASSETS };
