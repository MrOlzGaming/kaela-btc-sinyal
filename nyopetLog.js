// Log event mode "Nyopet" (side-trading super mini) — diposting ke WEB (arsip) DAN grup WA.
// SPESIFIKASI FINAL (hasil sweep 315 kombinasi, backtest/nyopetSweep.js):
//   Timeframe : Hourly (entry) + Weekly (konfirmasi arah)
//   Arah      : LONG-ONLY (short dibuang total, terbukti gak menang di sweep manapun)
//   Nyawa (SL): 10% -> Leverage 10x
//   TP        : TUNGGAL di RR 1:2 (bukan tiered 1/2/3 lagi)
//   Stake     : 15% saldo TERBARU tiap entry (compound otomatis, naik-turun ngikut saldo)
//   Hasil backtest 9 tahun: CAGR 20,1%/tahun, Max DD 47%, 71 trade, winrate 45,1%
//   (dibanding Siklus Halving 73,8%/tahun DD 0% — Nyopet TETAP side-experiment, bukan pesaing)
// Sinyal murni — TIDAK PERNAH sebut saldo/stake dalam nominal dolar.

const { WEB_URL } = require('./config');

const NYAWA_PCT = 0.10;
const RR = 2;

function computeLevels(entry) {
  return {
    sl: entry * (1 - NYAWA_PCT),
    tp: entry * (1 + NYAWA_PCT * RR),
  };
}

function fmt(n) {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatNyopetEvent({ type, price, entry }) {
  const time = new Date().toISOString().slice(0, 16).replace('T', ' ');

  if (type === 'ENTRY') {
    const lv = computeLevels(price);
    return [
      `⚡ NYOPET — ENTRY BARU`,
      `🟢 LONG @ ${fmt(price)}`,
      `Nyawa (SL): ${fmt(lv.sl)}`,
      `TP (1:2): ${fmt(lv.tp)}`,
      '',
      '🚨 DISCLAIMER KERAS: JANGAN ALL-IN. Stake WAJIB 15% saldo — titik. Ini side-experiment',
      'modal super mini, bukan strategi utama (CAGR jauh di bawah Siklus Halving, drawdown jauh',
      'lebih besar). Menaikkan stake di luar aturan ini = keluar dari sistem yang udah diuji.',
      time,
      '',
      `🔗 ${WEB_URL}`,
    ].join('\n');
  }

  if (type === 'SL') {
    return [
      `⚡ NYOPET — ❌ KENA STOP LOSS`,
      `🟢 LONG | Entry ${fmt(entry)} -> SL ${fmt(price)}`,
      time,
      '',
      `🔗 ${WEB_URL}`,
    ].join('\n');
  }

  // TP
  return [
    `⚡ NYOPET — ✅ TP KENA (RR 1:2)`,
    `🟢 LONG | Entry ${fmt(entry)} -> TP ${fmt(price)}`,
    time,
    '',
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

module.exports = { formatNyopetEvent, computeLevels, NYAWA_PCT, RR };

if (require.main === module) {
  console.log(formatNyopetEvent({ type: 'ENTRY', price: 64500 }));
  console.log();
  console.log(formatNyopetEvent({ type: 'TP', price: 77400, entry: 64500 }));
  console.log();
  console.log(formatNyopetEvent({ type: 'SL', price: 58050, entry: 64500 }));
}
