// Konfigurasi aset Nyopet (23 Agu 2026, permintaan Olan: "semua mode sniper dan nyopet berlaku
// buat semua aset.. baik BTC dan PAXG.. suatu saat kalo mungkin bisa tambah aset") -- pola SAMA
// kayak assetConfig.js Sniper, tapi Nyopet BUKAN semua di USDT: BTC pakai wallet USDC (terpisah
// dari Sniper), PAXG TERPAKSA numpang USDT (PAXGUSDC GAK ADA di Binance, dicek 23 Agu 2026 --
// exchangeInfo cuma balikin PAXGUSDT) -- pemisahan wallet USDT=Sniper/USDC=Nyopet jadi gak 100%
// bersih khusus buat emas, tapi itu batasan Binance, bukan pilihan desain.
const NYOPET_ASSETS = {
  btc: { key: 'btc', symbol: 'BTCUSDC', marginAsset: 'USDC', zoneSymbol: 'BTCUSDT', label: 'BTC', emoji: '🟧' },
  // Label kasih ticker eksplisit (29 Agu 2026, Olan bingung cek posisi di app Binance -- ketikan
  // "PAXGUSDT" doang di sana, gak ada yang ketulis "XAU" -- dikira posisinya beda/ilang padahal
  // sama, cuma beda penamaan). Sertain ticker di LABEL biar user gampang cocokin ke app Binance.
  xau: { key: 'xau', symbol: 'PAXGUSDT', marginAsset: 'USDT', zoneSymbol: 'PAXGUSDT', label: 'XAU/Emas (PAXGUSDT)', emoji: '🟡' },
};

module.exports = { NYOPET_ASSETS };
