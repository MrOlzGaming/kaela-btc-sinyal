// Tes koneksi SEKALI PAKAI -- validasi BINANCE_API_KEY/SECRET beneran nyambung ke Demo Trading.
// Cuma baca saldo (read-only), GAK ADA order dikirim.
const { getAccountBalance } = require('./binanceExecutor');

getAccountBalance()
  .then((balance) => console.log(`[TestBinanceConnection] OK -- saldo USDT Demo Trading: $${balance}`))
  .catch((e) => { console.error('[TestBinanceConnection] GAGAL:', e.message); process.exit(1); });
