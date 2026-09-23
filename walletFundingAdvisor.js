// walletFundingAdvisor.js (23 Sep 2026, permintaan Olan: "sistem juga harus pintar nge saran
// bagi modal ke dompet lain.. misal total saldo 1500 masa mau nyopet ga bisa.. saran taruh duit
// di nyopet dompet minimal berapa") -- tool ADVISORY (dijalanin manual/laporan berkala, BELUM
// nge-blokir/ngubah eksekusi live) yang ngecek tiap dompet: dengan bracket exposure SEKARANG
// (dari totalWealthAggregator.js, basis TOTAL kekayaan -- lihat calculator.js `exposureModal`),
// apakah dompet itu udah CUKUP buat nutup nilai-posisi minimum exchange (MIN_NOTIONAL), dan
// kalau enggak, berapa MINIMAL yang perlu ditambahin.
//
// ⚠️ HEURISTIK, bukan presisi mutlak -- nyawa% (jarak SL) beda-beda tiap sinyal asli, di sini
// dipakai beberapa SKENARIO REPRESENTATIF (1%/2%/5%) biar Olan liat rentang "aman" vs "mepet"
// vs "kurang", bukan 1 angka tunggal yang keliatan pasti padahal sebenarnya bervariasi.

const { getTotalWealth } = require('./totalWealthAggregator');
const { hitung: hitungExposure } = require('./calculator');

const MODAL_ACTIVE_FRACTION = 1 / 5; // SAMA "cheat" yang dipakai Nyopet -- exposureModal juga pakai fraksi ini (lihat nyopetAutoTrader.js)
const ASSUMED_MIN_NOTIONAL_USD = 20; // fallback kalau fetch live gagal (lihat fetchMinNotional())

async function fetchMinNotional(symbol) {
  try {
    // exchangeInfo mentah (getSymbolInfo shared cuma expose stepSize/precision, BUKAN
    // MIN_NOTIONAL) -- fetch langsung di sini, JANGAN ubah binanceExecutor.js shared cuma buat 1
    // tool advisory ini (kurang risiko).
    const res = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
    const data = await res.json();
    const info = data.symbols.find((s) => s.symbol === symbol);
    const filter = info && info.filters.find((f) => f.filterType === 'MIN_NOTIONAL');
    return filter ? parseFloat(filter.notional) : ASSUMED_MIN_NOTIONAL_USD;
  } catch {
    return ASSUMED_MIN_NOTIONAL_USD; // gagal fetch -- fallback approksimasi, JANGAN gagalin laporan
  }
}

// nilaiPosisi = modal x exposure(exposureModal) -- exposure CUMA fungsi exposureModal+direction
// (independen dari nyawa%/SL -- itu cuma ngaruh ke LEVERAGE/margin, bukan ke besar nilaiPosisi).
// Jadi modal_minimal buat clear MIN_NOTIONAL = minNotional / exposure, SATU angka doang, gak perlu
// diulang per skenario nyawa% (awalnya sempet dikira perlu, ternyata gak relevan buat cek ini).
function minModalForNotional(minNotional, exposureModal, direction) {
  const probe = hitungExposure({ modal: 1, exposureModal, entry: 100, stopLoss: direction === 'sell' ? 105 : 95, direction });
  return minNotional / probe.exposure;
}

async function main() {
  console.log('=== Wallet Funding Advisor -- ' + new Date().toISOString().slice(0, 10) + ' ===\n');
  const minNotional = await fetchMinNotional('BTCUSDT');
  console.log(`MIN_NOTIONAL BTCUSDT (fetch live): $${minNotional}\n`);
  const demo = await getTotalWealth({ real: false });
  const real = await getTotalWealth({ real: true });

  for (const [label, agg] of [['DEMO', demo], ['REAL', real]]) {
    if (agg.breakdown.length === 0) { console.log(`--- ${label}: gak ada dompet aktif, skip ---\n`); continue; }
    console.log(`--- ${label} (total kekayaan $${agg.total.toFixed(2)}) ---`);
    const exposureModal = agg.total * MODAL_ACTIVE_FRACTION;
    console.log(`exposureModal (basis bracket exposure, total x 1/5): $${exposureModal.toFixed(2)}\n`);

    const minModal = minModalForNotional(minNotional, exposureModal, undefined);
    for (const w of agg.breakdown) {
      const modalAktif = w.balance * MODAL_ACTIVE_FRACTION;
      const cukup = modalAktif >= minModal;
      console.log(`  ${w.name}: saldo $${w.balance.toFixed(2)} (modal aktif $${modalAktif.toFixed(2)}, butuh min $${minModal.toFixed(2)}) -- ${cukup ? '✅ CUKUP buat trading' : `❌ KURANG -- saran tambah saldo min $${((minModal - modalAktif) / MODAL_ACTIVE_FRACTION).toFixed(2)} biar dompet ini bisa dipakai`}`);
    }
    console.log();
  }
  console.log(`(Asumsi MIN_NOTIONAL $${ASSUMED_MIN_NOTIONAL_USD} kalau fetch live gagal -- exchange beneran bisa beda dikit per symbol, lihat fetchMinNotional().)`);
}

if (require.main === module) { main().catch((e) => { console.error('ERROR:', e.message, e.stack); process.exit(1); }); }
module.exports = { minModalForNotional, fetchMinNotional };
