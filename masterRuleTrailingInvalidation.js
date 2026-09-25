// Simulator "Dynamic Candle Invalidation" (25 Sep 2026, dari MASTER_RULE_DYNAMIC_CANDLE_
// INVALIDATION_v3_4.md yang dikasih Olan) -- trailing stop berbasis HIGH/LOW candle sejak entry
// (BUKAN harga terakhir/close), ratchet SATU ARAH, jarak = Nyawa% (dari Kalkulator Exposure) +
// buffer fee. Modul INI CUMA logic-nya (Bagian 7/8/15 dokumen), exchange-agnostic -- dipakai
// backtest (BTC/Emas, Sniper harian & sistem 4-jam) SEBELUM dipasang live di manapun (permintaan
// eksplisit Olan: "coba dulu di backtest.. fokus ke logikanya dulu").
//
// BEDA dari trailing yang UDAH ADA (ninjaTrader.js updateTrailing, nyopetChartPatternFvg.js
// trail-SMA): itu semua trail dari HARGA SESAAT/close per siklus, modul INI trail dari CANDLE
// HIGH/LOW (nangkep wick), dan trigger-exit dicek pakai invalidation SEBELUM di-update candle yang
// sama (Bagian 16.1 dokumen -- cegah look-ahead, urutan: cek trigger dulu, baru ratchet).
//
// `feePercent` FALLBACK 0.10% (Bagian 4 dokumen, "WAJIB 0.10%, jangan 0%") -- backtest caller WAJIB
// oper fee ASLI exchange kalau ada (Bagian 3, prioritas 1-4), fallback ini cuma kalau bener2 gak
// ketemu.

const FALLBACK_FEE_PERCENT = 0.10;

// `candles`: array {high, low, close, closeTime}, urut lama->baru. `entryIndex`: index candle
// TEMPAT sinyal dideteksi (posisi mulai dipantau dari candle SETELAHNYA -- Bagian 9 "Candle pada
// saat entry": HIGH/LOW SEBELUM entry gak boleh ikut, extreme mulai dari entry_price apa adanya).
// `nyawaPct`: base_invalidation_percent (jarak entry->SL struktural asli, dari kalkulator/pola).
function simulateTrailingInvalidation({ candles, entryIndex, entryPrice, direction, nyawaPct, feePercent = FALLBACK_FEE_PERCENT }) {
  if (!(nyawaPct > 0)) throw new Error('simulateTrailingInvalidation: nyawaPct wajib > 0 (Bagian 6.1 -- jangan buka posisi kalau Nyawa gak valid).');
  const effectivePct = nyawaPct + feePercent;
  const f = effectivePct / 100;
  let extreme = entryPrice;
  let invalidation = direction === 'buy' ? entryPrice * (1 - f) : entryPrice * (1 + f);
  const initialInvalidation = invalidation;

  for (let i = entryIndex + 1; i < candles.length; i++) {
    const c = candles[i];
    if (c.high == null || c.low == null || c.high < c.low) continue; // Bagian 13 -- data gak valid, skip diam (state gak berubah)

    if (direction === 'buy') {
      // Cek trigger DULU pakai invalidation LAMA (Bagian 16.1) -- baru abis itu ratchet naik.
      if (c.low <= invalidation) {
        return { exitPrice: invalidation, exitIndex: i, exitTime: c.closeTime, reason: 'INVALIDATED', extreme, initialInvalidation, finalInvalidation: invalidation, effectivePct };
      }
      extreme = Math.max(extreme, c.high);
      const dynamic = extreme * (1 - f);
      if (dynamic > invalidation) invalidation = dynamic; // ratchet naik doang (Bagian 7.4)
    } else {
      if (c.high >= invalidation) {
        return { exitPrice: invalidation, exitIndex: i, exitTime: c.closeTime, reason: 'INVALIDATED', extreme, initialInvalidation, finalInvalidation: invalidation, effectivePct };
      }
      extreme = Math.min(extreme, c.low);
      const dynamic = extreme * (1 + f);
      if (dynamic < invalidation) invalidation = dynamic; // ratchet turun doang (Bagian 8.4)
    }
  }
  // Data candle abis (backtest cutoff) SEBELUM ter-invalidasi -- posisi masih "floating" pas data berakhir.
  const last = candles[candles.length - 1];
  return { exitPrice: null, exitIndex: candles.length - 1, exitTime: last ? last.closeTime : null, reason: 'STILL_OPEN', extreme, initialInvalidation, finalInvalidation: invalidation, effectivePct };
}

module.exports = { simulateTrailingInvalidation, FALLBACK_FEE_PERCENT };
