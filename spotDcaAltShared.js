// Konstanta & helper BERSAMA buat Compound Alt DCA (25 Agu 2026, permintaan Olan) -- dipakai KEDUA
// versi: shadow publik (spotDcaAlt.js, kaela-btc-sinyal) DAN real per-akun (spotDcaAltAccount.js,
// Kaela Access) -- biar logika window/basket/hari-jual PERSIS SAMA di dua tempat, gak nyimpang.
//
// Spesifikasi (dikonfirmasi Olan lewat backtest & diskusi 25 Agu 2026):
// - Basket 10 koin: BTC + ETH/BNB/XRP/ADA/LTC/DOGE (6 alt lama) + ZIL/TRX/XLM (3 kandidat baru,
//   ZIL request Olan, TRX+XLM usul Kaela -- OG alt listing lama di Binance).
// - $10/koin tiap TANGGAL 5 kalender, SELAMA window Musim Tanam (WINDOW_START s/d HALVING_DATE).
// - Pas halving: STOP DCA, cuma tahan.
// - Jual di hari ke PANEN_SELL_DAYS_AFTER_HALVING setelah halving -- angka ini BUKAN tebakan,
//   dihitung dari rata-rata HISTORIS hari puncak harga BTC 3 siklus lalu (lihat _findpeaks.js:
//   2016->hari526, 2020->hari547, 2024->hari536, rata2=536) -- "peak gak bisa di-predict, ikuti
//   rata-rata historis" (Olan).
// - Kompound PER-KOIN INDEPENDEN (bukan pool+redistribusi kayak backtestSpotDcaTanamPanen.js) --
//   hasil jual tiap koin jadi "dompet" sendiri, di-all-in balik ke koin YANG SAMA pas Tanam
//   berikutnya + tetap lanjut DCA $10/bulan di atasnya (Olan: "dompetnya tetep sendiri sendiri..
//   biar next siklus aku bisa allin lagi ke koin itu").

const WINDOW_START = new Date('2026-10-19T00:00:00Z');
const HALVING_DATE = new Date('2028-04-13T13:11:00Z');
const PANEN_SELL_DAYS_AFTER_HALVING = 536;
const DAY_MS = 86400000;
const MONTHLY_BUY_DAY = 5; // tanggal 5 kalender (UTC)
const PER_COIN_USD = 10;

const ALT10_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'LTCUSDT', 'DOGEUSDT', 'ZILUSDT', 'TRXUSDT', 'XLMUSDT'];

function sellTriggerDate(halvingDate = HALVING_DATE) {
  return new Date(halvingDate.getTime() + PANEN_SELL_DAYS_AFTER_HALVING * DAY_MS);
}

function inTanamWindow(now, windowStart = WINDOW_START, halvingDate = HALVING_DATE) {
  return now >= windowStart && now < halvingDate;
}

// Idempotency key bulanan (BEDA dari spotDca.js yang harian) -- "YYYY-MM" berbasis UTC, dicek
// SEKALI aja tiap bulan biar gak double-buy kalau workflow re-run di hari yang sama.
function monthKey(now) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Hari ini tanggal 5 (UTC) DAN masih di window Tanam DAN belum pernah beli bulan ini.
function shouldBuyToday(now, lastBuyMonthKey, windowStart = WINDOW_START, halvingDate = HALVING_DATE) {
  if (now.getUTCDate() !== MONTHLY_BUY_DAY) return false;
  if (!inTanamWindow(now, windowStart, halvingDate)) return false;
  return lastBuyMonthKey !== monthKey(now);
}

function shouldSellNow(now, halvingDate = HALVING_DATE) {
  return now >= sellTriggerDate(halvingDate);
}

module.exports = {
  WINDOW_START, HALVING_DATE, PANEN_SELL_DAYS_AFTER_HALVING, PER_COIN_USD, ALT10_SYMBOLS, MONTHLY_BUY_DAY,
  sellTriggerDate, inTanamWindow, monthKey, shouldBuyToday, shouldSellNow,
};
