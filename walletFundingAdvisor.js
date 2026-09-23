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
// Buffer (23 Sep 2026, permintaan Olan: "exchange lain diisi minimal sesuai kalkulator exposure,
// ditambah sedikit biar gak mepet banget") -- target saran BUKAN pas-pasan di garis MIN_NOTIONAL
// (kalau harga gerak dikit turun, langsung di bawah minimum lagi), tapi minimum + 25% ekstra.
// Angka 25% TITIK AWAL (belum di-tuning/backtest), gampang diubah kalau kerasa kurang/lebih.
const MIN_MODAL_BUFFER_PCT = 25;

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
// `withBuffer` (default true) -- tambah MIN_MODAL_BUFFER_PCT di atas garis pas-pasan, biar saran
// gak ngasih angka yang begitu harga gerak dikit langsung di bawah minimum lagi.
function minModalForNotional(minNotional, exposureModal, direction, withBuffer = true) {
  const probe = hitungExposure({ modal: 1, exposureModal, entry: 100, stopLoss: direction === 'sell' ? 105 : 95, direction });
  const bare = minNotional / probe.exposure;
  return withBuffer ? bare * (1 + MIN_MODAL_BUFFER_PCT / 100) : bare;
}

// Saran REBALANCE (23 Sep 2026, permintaan Olan: "kalo seluruh modal harusnya cukup buat open
// posisi, tapi malah gak bisa.. sistem lapor buat bagi modal ke dompet lain") -- BUKAN eksekusi
// transfer (mindahin duit beneran WAJIB manual, Kaela gak pernah pegang kunci withdraw), MURNI
// saran ANGKA+ARAH biar Olan tau harus mindahin dari mana ke mana. Prioritas SAMA EXCHANGE dulu
// (Binance USDT<->USDC convert instan, gratis/murah) sebelum LINTAS exchange (Binance->MEXC
// butuh withdraw+deposit, lebih lambat+ada network fee) -- exchange diturunin dari walletId
// (`"binance:USDT"` -> `"binance"`), bukan field baru terpisah.
function suggestRebalance(breakdown, minModal) {
  const withSurplus = breakdown.map((w) => ({ ...w, exchange: w.walletId.split(':')[0], modalAktif: w.balance * MODAL_ACTIVE_FRACTION, surplus: w.balance * MODAL_ACTIVE_FRACTION - minModal }));
  const deficits = withSurplus.filter((w) => w.surplus < 0).sort((a, b) => a.surplus - b.surplus); // paling kurang duluan
  const donors = withSurplus.filter((w) => w.surplus > 0).map((w) => ({ ...w, remaining: w.surplus })); // salinan -- `remaining` abis dipotong tiap sumbang, JANGAN pakai `surplus` asli lagi
  const suggestions = [];

  for (const d of deficits) {
    let need = -d.surplus; // deficit positif
    // Same-exchange dulu (diurutin remaining terbesar), baru lintas-exchange kalau gak cukup.
    const sorted = [...donors].sort((a, b) => (b.exchange === d.exchange) - (a.exchange === d.exchange) || b.remaining - a.remaining);
    for (const donor of sorted) {
      if (need <= 0) break;
      if (donor.remaining <= 0) continue;
      const amountModal = Math.min(need, donor.remaining); // dalam satuan "modal aktif" (1/5 saldo)
      const amountSaldo = amountModal / MODAL_ACTIVE_FRACTION; // konversi balik ke satuan saldo ASLI (yang beneran ditransfer Olan)
      suggestions.push({ from: donor.name, to: d.name, amountSaldo, sameExchange: donor.exchange === d.exchange });
      donor.remaining -= amountModal;
      need -= amountModal;
    }
    if (need > 0.01) suggestions.push({ from: null, to: d.name, amountSaldo: need / MODAL_ACTIVE_FRACTION, sameExchange: null }); // gak ada donor cukup -- WAJIB top-up dari luar sistem
  }
  return suggestions;
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
    console.log(`Target minimal per-dompet (MIN_NOTIONAL + buffer ${MIN_MODAL_BUFFER_PCT}%): $${minModal.toFixed(2)}\n`);
    for (const w of agg.breakdown) {
      const modalAktif = w.balance * MODAL_ACTIVE_FRACTION;
      const cukup = modalAktif >= minModal;
      console.log(`  ${w.name}: saldo $${w.balance.toFixed(2)} (modal aktif $${modalAktif.toFixed(2)}, butuh min $${minModal.toFixed(2)}) -- ${cukup ? '✅ CUKUP buat trading' : '❌ KURANG'}`);
    }

    const suggestions = suggestRebalance(agg.breakdown, minModal);
    if (suggestions.length > 0) {
      console.log('\n  📋 Saran (TOTAL kekayaan sebenarnya CUKUP, cuma perlu digeser -- transfer manual, Kaela gak eksekusi ini):');
      suggestions.forEach((s) => {
        if (!s.from) console.log(`    ⚠️ ${s.to}: gak ada surplus dompet lain yang cukup -- WAJIB top-up ~$${s.amountSaldo.toFixed(2)} dari luar sistem.`);
        else console.log(`    Pindahin ~$${s.amountSaldo.toFixed(2)} dari "${s.from}" -> "${s.to}"${s.sameExchange ? ' (1 exchange, convert instan)' : ' (⚠️ BEDA exchange, butuh withdraw+deposit, gak instan)'}`);
      });
    }
    console.log();
  }
  console.log(`(Asumsi MIN_NOTIONAL $${ASSUMED_MIN_NOTIONAL_USD} kalau fetch live gagal -- exchange beneran bisa beda dikit per symbol, lihat fetchMinNotional().)`);
}

if (require.main === module) { main().catch((e) => { console.error('ERROR:', e.message, e.stack); process.exit(1); }); }
module.exports = { minModalForNotional, fetchMinNotional, suggestRebalance };
