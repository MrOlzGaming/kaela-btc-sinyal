// Simulasi ide BARU Olan (10 Agu 2026): DCA $100/bulan NON-STOP (gak berhenti di $1.000 kayak
// skenario Nyopet) -- kalau lagi di window Musim Tanam (513-542 hari SEBELUM halving, window
// RESMI proyek ini, sama persis dailyReport.js WINDOW_START/END), tiap setoran $100 DIBAGI dua
// pakai OLZ Exposure System: porsi margin (`getDynamicRiskPerTrade`) dipakai buka posisi
// LEVERAGE, SISANYA langsung dibeliin BTC SPOT juga (bukan nganggur) -- alasan Olan: "kalau
// bottom-nya ternyata lebih dalam dari siklus lalu, kita masih ada saldo spot" (spot jadi
// jaring pengaman kalau hipotesis bottom meleset). Di LUAR window Tanam, setoran $100 100%
// SPOT (no leverage). Musim Panen (walk-forward, titik sama kayak halvingOptimized.js): SEMUA
// posisi (leverage cycle itu + spot yang numpuk) dijual BARENG jadi cash (konfirmasi Olan:
// "semua dijual, ikut aturan Halving asli").
//
// Nyawa/STOP_PCT leverage TIDAK dipatok angka tebakan -- dihitung dari data ASLI: seberapa jauh
// harga "overshoot" (turun lebih lanjut) dari titik masuk Tanam SIKLUS SEBELUMNYA (yang paling
// baru), sampai ~200 hari pasca halving itu. Permintaan Olan: "nyawa yang disediakan sesuai
// bottom masa lalu yang terbaru".
//
// Data: backtest/yahoo-btc-ohlc.json (2014-2026, cakup semua 3 halving asli: 2016/2020/2024).

const { getExposure, getDynamicRiskPerTrade } = require('./backtest/moneyManagement');
const candles = require('./backtest/yahoo-btc-ohlc.json');

const HALVINGS = ['2016-07-09', '2020-05-11', '2024-04-19'];
const DAYS_AFTER_TO_PEAK = { prior1: [368], prior2: [368, 526], prior3: [368, 526, 549] };
const TANAM_MIN_DAYS = 513, TANAM_MAX_DAYS = 542; // window RESMI proyek
const OVERSHOOT_LOOKAHEAD_DAYS = 200; // sama window liat-overshoot kayak riset awal
const DEFAULT_STOP_PCT = 0.30; // fallback CUMA buat siklus 2016 (gak ada data siklus sebelumnya)

function avg(arr) { return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length); }
function idxAt(ms) {
  const idx = candles.findIndex((c) => c.time >= ms);
  return idx === -1 ? candles.length - 1 : idx;
}

const cycles = [
  { label: 'Halving 2016-07-09', h: new Date(HALVINGS[0]).getTime(), after: avg(DAYS_AFTER_TO_PEAK.prior1) },
  { label: 'Halving 2020-05-11', h: new Date(HALVINGS[1]).getTime(), after: avg(DAYS_AFTER_TO_PEAK.prior2) },
  { label: 'Halving 2024-04-19', h: new Date(HALVINGS[2]).getTime(), after: avg(DAYS_AFTER_TO_PEAK.prior3) },
].map((c) => ({ ...c, tanamStart: c.h - TANAM_MAX_DAYS * 86400000, tanamEnd: c.h - TANAM_MIN_DAYS * 86400000, panenMs: c.h + c.after * 86400000 }));

// Overshoot HISTORIS aktual siklus ke-`idx`: dari harga di AWAL window Tanam-nya, seberapa
// dalam harga masih bisa turun lebih lanjut (low terendah) sampai OVERSHOOT_LOOKAHEAD_DAYS
// hari pasca halving-nya SENDIRI.
function historicalOvershootPct(idx) {
  const cyc = cycles[idx];
  const startIdx = idxAt(cyc.tanamStart);
  const entryPrice = candles[startIdx].close;
  const endIdx = idxAt(cyc.h + OVERSHOOT_LOOKAHEAD_DAYS * 86400000);
  let lowest = entryPrice;
  for (let i = startIdx; i <= endIdx; i++) if (candles[i].low < lowest) lowest = candles[i].low;
  return (entryPrice - lowest) / entryPrice * 100;
}

// Nyawa buat siklus ke-`idx` = overshoot AKTUAL siklus SEBELUMNYA (idx-1) -- "sesuai bottom masa
// lalu yang terbaru". Siklus pertama (idx=0) gak punya siklus sebelumnya dalam data kita -> pakai
// DEFAULT_STOP_PCT, dicatat jelas sebagai keterbatasan.
function stopPctForCycle(idx) {
  if (idx === 0) return DEFAULT_STOP_PCT;
  return historicalOvershootPct(idx - 1) / 100;
}

function cycleForDate(ms) {
  return cycles.find((c) => ms >= c.tanamStart && ms <= c.tanamEnd) || null;
}

function resolveLeveragedExit(entryIdx, panenMs, stopPrice) {
  const panenIdx = idxAt(panenMs);
  for (let i = entryIdx; i <= panenIdx; i++) {
    if (candles[i].low <= stopPrice) return { exitPrice: stopPrice, stopped: true, exitIdx: i };
  }
  return { exitPrice: candles[panenIdx].close, stopped: false, exitIdx: panenIdx };
}

function main() {
  let cash = 0;
  let spotBtc = 0;
  let totalDeposited = 0;
  let lastTopUp = candles[0].time;
  const openLeveraged = [];
  let peak = 0, maxDD = 0;
  const log = [];

  console.log('=== Nyawa per siklus (dari overshoot AKTUAL siklus sebelumnya) ===');
  cycles.forEach((c, idx) => {
    const stopPct = stopPctForCycle(idx);
    console.log(`${c.label}: nyawa=${(stopPct * 100).toFixed(1)}%${idx === 0 ? ' (default, gak ada data siklus sebelumnya)' : ` (= overshoot aktual ${cycles[idx - 1].label})`}`);
  });
  console.log();

  for (let i = 0; i < candles.length; i++) {
    const today = candles[i];

    if (today.time - lastTopUp >= 30 * 86400000) {
      lastTopUp = today.time;
      totalDeposited += 100;
      const cycIdx = cycles.findIndex((c) => today.time >= c.tanamStart && today.time <= c.tanamEnd);
      const cyc = cycIdx === -1 ? null : cycles[cycIdx];

      if (cyc) {
        // Bagi $100: porsi margin (getDynamicRiskPerTrade dari cash yang UDAH ke-realisasi --
        // saldo realisasi doang, sama filosofi kayak Nyopet fixedRisk) buat leverage, SISANYA
        // langsung spot juga (permintaan Olan: jangan nganggur, jadi jaring pengaman kalau
        // bottom ternyata lebih dalam dari perkiraan).
        const riskPct = getDynamicRiskPerTrade(cash);
        const marginPortion = 100 * riskPct;
        const spotPortion = 100 - marginPortion;
        const stopPct = stopPctForCycle(cycIdx);
        const stopPrice = today.close * (1 - stopPct);
        const leverage = Math.max(1, Math.min(150, Math.floor(1 / stopPct)));

        if (marginPortion > 0) {
          openLeveraged.push({ entryIdx: i, entryPrice: today.close, margin: marginPortion, stopPrice, leverage, cycleH: cyc.h });
          log.push(`[LEVERAGE] ${new Date(today.time).toISOString().slice(0, 10)} @ $${today.close.toFixed(0)} -- margin=$${marginPortion.toFixed(0)} (riskPct=${(riskPct * 100).toFixed(0)}%) leverage=${leverage}x nyawa=${(stopPct * 100).toFixed(1)}% (${cyc.label})`);
        }
        if (spotPortion > 0) {
          spotBtc += spotPortion / today.close;
          log.push(`[SPOT-SISA] ${new Date(today.time).toISOString().slice(0, 10)} @ $${today.close.toFixed(0)} -- sisa $${spotPortion.toFixed(0)} dibeliin spot`);
        }
      } else {
        // Di luar window Tanam -- 100% spot.
        spotBtc += 100 / today.close;
      }
    }

    for (const cyc of cycles) {
      if (today.time >= cyc.panenMs && !cyc._settled) {
        cyc._settled = true;
        let proceeds = 0;
        const thisCycleLeveraged = openLeveraged.filter((p) => p.cycleH === cyc.h);
        for (const pos of thisCycleLeveraged) {
          const { exitPrice, stopped } = resolveLeveragedExit(pos.entryIdx, cyc.panenMs, pos.stopPrice);
          const priceMovePct = (exitPrice - pos.entryPrice) / pos.entryPrice;
          const value = pos.margin + pos.margin * pos.leverage * priceMovePct;
          proceeds += Math.max(0, value);
          log.push(`  [SETTLE-LEV] entry $${pos.entryPrice.toFixed(0)} -> exit $${exitPrice.toFixed(0)} ${stopped ? '(KENA STOP)' : '(jadwal Panen)'} margin=$${pos.margin.toFixed(0)} -> $${value.toFixed(2)}`);
        }
        const panenIdx = idxAt(cyc.panenMs);
        const panenPrice = candles[panenIdx].close;
        const spotValue = spotBtc * panenPrice;
        proceeds += spotValue;
        log.push(`  [SETTLE-SPOT] ${spotBtc.toFixed(6)} BTC @ $${panenPrice.toFixed(0)} = $${spotValue.toFixed(2)}`);

        cash += proceeds;
        spotBtc = 0;
        for (let k = openLeveraged.length - 1; k >= 0; k--) if (openLeveraged[k].cycleH === cyc.h) openLeveraged.splice(k, 1);

        log.push(`[PANEN ${cyc.label}] total proceeds = $${proceeds.toFixed(2)}, cash sekarang = $${cash.toFixed(2)}\n`);
      }
    }

    // Mark-to-market JUJUR: cash + spot yang numpuk + NILAI FLOATING posisi leverage yang masih
    // terbuka (bukan diabaikan -- biar drawdown kelihatan beneran, termasuk pas leverage lagi
    // nyangkut di bawah air sebelum settle).
    let floatingLevValue = 0;
    for (const pos of openLeveraged) {
      const movePct = (today.close - pos.entryPrice) / pos.entryPrice;
      floatingLevValue += Math.max(0, pos.margin + pos.margin * pos.leverage * movePct);
    }
    const mtm = cash + spotBtc * today.close + floatingLevValue;
    peak = Math.max(peak, mtm);
    if (peak > 0) maxDD = Math.max(maxDD, (peak - mtm) / peak * 100);
  }

  const lastPrice = candles[candles.length - 1].close;
  const finalSpotValue = spotBtc * lastPrice;
  const finalMtm = cash + finalSpotValue;

  console.log(log.join('\n'));
  console.log('\n=== HASIL AKHIR ===');
  console.log('Total disetor:', totalDeposited, '(', ((candles[candles.length - 1].time - candles[0].time) / (365.25 * 86400000)).toFixed(1), 'tahun data)');
  console.log('Cash (dari Panen yg udah settle):', cash.toFixed(2));
  console.log('Spot BTC yg masih numpuk (belum Panen lagi):', spotBtc.toFixed(6), '= $' + finalSpotValue.toFixed(2));
  console.log('Nilai portofolio akhir (mark-to-market):', finalMtm.toFixed(2));
  console.log('Return:', ((finalMtm / totalDeposited - 1) * 100).toFixed(0) + '%');
  console.log('Max drawdown (mark-to-market JUJUR, termasuk leverage floating):', maxDD.toFixed(1) + '%');
}

main();
