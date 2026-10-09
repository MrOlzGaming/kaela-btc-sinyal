// athDrawdownGridVolume.js (9 Okt 2026) -- lanjutan riset grid ATH. Olan: "gak ada exchange yang bisa ubah leverage per posisi
// (posisi numpuk jadi 1, leverage ikut 1 angka) -- fokus ke VOLUME trading, bukan margin."
//
// Jadi "leverage naik sesuai kedalaman" diwujudkan lewat UKURAN POSISI (volume/notional) per level, bukan setting leverage:
//   - Tiap level 1% di bawah ATH tetap "menanam" 1% modal siklus (modal ditanam = dasar TP 15%).
//   - Volume yang dibeli di level itu = 1% modal x PENGALI kedalaman (mis. 1x sampai ATH -40%, 2x di bawahnya).
//   - Semua entry NUMPUK jadi 1 posisi CROSS (perpetual biasa Bybit/Binance/BingX -- bisa otomatis). Setting leverage exchange
//     cukup dipasang tinggi sekali di awal, yang nentuin risiko = total volume / ekuitas akun.
//   - Likuidasi CROSS level akun: ekuitas akun (cash + PnL) <= maintenance 0,5% x volume (pakai LOW harian) -> SEMUA HANGUS.
//   - TP SEMUA: untung bersih posisi >= 15% x modal ditanam (Olan: modal $10 ditanam -> ambil $1,5). Abis TP ulang dari acuan ATH.
//   - Entry minimal ATH -15% (syarat Olan). Fee taker 0,05% volume, funding ASLI Binance per hari dari volume.
// Pakai: node backtest/athDrawdownGridVolume.js

const fs = require('fs');
const path = require('path');

const FEE = 0.0005, MM = 0.005, CAPITAL = 1000, DEFAULT_FUND_DAY = 0.0003;

async function loadDaily() {
  const rows = []; let cur = Date.UTC(2017, 7, 17);
  while (cur < Date.now()) {
    const k = await (await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=${cur}&limit=1000`)).json();
    if (!Array.isArray(k) || !k.length) break;
    for (const x of k) if (x[6] < Date.now()) rows.push({ t: x[0], h: +x[2], l: +x[3], c: +x[4] });
    cur = k[k.length - 1][0] + 864e5; if (k.length < 1000) break;
  }
  const f = JSON.parse(fs.readFileSync(path.join(__dirname, 'funding-rate-cache.json'), 'utf8'));
  const byDay = new Map();
  for (const x of f) { const d = Math.floor(x.fundingTime / 864e5) * 864e5; byDay.set(d, (byDay.get(d) || 0) + Number(x.fundingRate)); }
  const fMin = f[0].fundingTime, fMax = f[f.length - 1].fundingTime;
  let ath = 0;
  for (const r of rows) { ath = Math.max(ath, r.c); r.ath = ath; r.dd = (1 - r.c / ath) * 100; r.fund = r.t >= fMin && r.t <= fMax ? (byDay.get(r.t) || 0) : DEFAULT_FUND_DAY; }
  return rows;
}

// mult(level) = pengali volume per level kedalaman
function run(rows, startIdx, { mult, minDd = 15, tp = 15 }) {
  let cash = CAPITAL, qty = 0, cost = 0, planted = 0, filled = 0, cycleCap = CAPITAL, cycles = 0, cycleStart = startIdx;
  let peak = CAPITAL, maxDd = 0, maxExpo = 0, longest = 0, wipes = 0, fund = 0, fee = 0;
  for (let i = startIdx; i < rows.length; i++) {
    const { l, c, dd, fund: fr, t } = rows[i];
    if (qty > 0) { const fp = qty * c * fr; cash -= fp; fund += fp; }
    // likuidasi cross (akun): ekuitas di LOW <= MM x volume di LOW
    if (qty > 0) {
      const eqLow = cash + qty * l - cost;
      if (eqLow <= MM * qty * l) { cash = Math.max(0, eqLow); qty = 0; cost = 0; planted = 0; filled = 0; wipes++; cycleCap = cash; cycleStart = i; }
    }
    // TP: untung bersih >= tp% modal ditanam
    if (qty > 0) {
      const closeFee = qty * c * FEE, pnl = qty * c - cost - closeFee;
      if (pnl >= planted * tp / 100) { cash += pnl; fee += closeFee; qty = 0; cost = 0; planted = 0; filled = 0; cycles++; cycleCap = cash; cycleStart = i; }
    }
    // entry
    const level = Math.min(100, Math.floor(dd));
    if (cycleCap > 1 && level >= minDd && level > filled) {
      for (let lv = filled + 1; lv <= level; lv++) {
        if (lv < minDd) continue;
        const unit = cycleCap / 100, vol = unit * mult(lv);
        const eq = cash + qty * c - cost;
        if (eq <= 0) break;
        qty += vol / c; cost += vol; planted += unit; cash -= vol * FEE; fee += vol * FEE;
      }
      filled = level;
    }
    const eq = cash + qty * c - cost;
    peak = Math.max(peak, eq); maxDd = Math.max(maxDd, (1 - eq / peak) * 100);
    if (eq > 0) maxExpo = Math.max(maxExpo, qty * c / eq);
    longest = Math.max(longest, (t - rows[cycleStart].t) / 864e5);
  }
  const last = rows[rows.length - 1], eq = cash + qty * last.c - cost;
  return { mult: eq / CAPITAL, maxDd, maxExpo, cycles, longest, wipes, fund, fee };
}

const SCHEDULES = [
  ['1x rata (tanpa tambahan volume)', () => 1],
  ['1x s/d -40%, 2x di bawahnya', (lv) => (lv >= 40 ? 2 : 1)],
  ['1x s/d -30%, 2x di bawahnya', (lv) => (lv >= 30 ? 2 : 1)],
  ['1x s/d -50%, 2x di bawahnya', (lv) => (lv >= 50 ? 2 : 1)],
  ['1x/-40% 2x/-60% 3x', (lv) => (lv >= 60 ? 3 : lv >= 40 ? 2 : 1)],
  ['naik halus 1+dd/50 (-50%=2x)', (lv) => 1 + lv / 50],
  ['2x rata', () => 2],
];

(async () => {
  const rows = await loadDaily();
  const at = (iso) => rows.findIndex((r) => r.t >= Date.parse(iso));
  const athIdx = rows.reduce((b, r, i) => (r.c >= rows[b].c ? i : b), 0);
  const last = rows[rows.length - 1];
  console.log(`Binance BTCUSDT harian ${new Date(rows[0].t).toISOString().slice(0, 10)}..${new Date(last.t).toISOString().slice(0, 10)} | entry >= ATH -15% | TP 15% modal ditanam | 1 posisi CROSS, likuidasi akun (LOW) | fee 0,05% | funding asli`);
  const fmt = (r) => `x${r.mult.toFixed(2)} | DD ${r.maxDd.toFixed(0)}% | eksposur maks ${r.maxExpo.toFixed(2)}x | TP ${r.cycles}x | nyangkut terlama ${r.longest.toFixed(0)} hr | ${r.wipes ? `☠️ HANGUS ${r.wipes}x` : 'gak pernah hangus'} | funding $${r.fund.toFixed(0)}`;
  for (const [name, iso] of [['ATH Des 2017', '2017-12-17'], ['ATH Nov 2021', '2021-11-08'], ['ATH Okt 2025', null], ['Jan 2020', '2020-01-01']]) {
    const idx = iso ? at(iso) : athIdx;
    console.log(`\n=== Mulai ${name} (${new Date(rows[idx].t).toISOString().slice(0, 10)}, BTC $${rows[idx].c.toFixed(0)}) ===`);
    for (const [lbl, mult] of SCHEDULES) console.log(`  ${lbl.padEnd(32)} ${fmt(run(rows, idx, { mult }))}`);
  }
  console.log('\n=== Mulai TIAP AWAL BULAN 2018-01 .. 2025-10 (94 titik) ===');
  for (const [lbl, mult] of SCHEDULES) {
    const rs = [];
    for (let y = 2018; y <= 2025; y++) for (let m = 0; m < 12; m++) { if (y === 2025 && m > 9) break; const i = at(new Date(Date.UTC(y, m, 1)).toISOString()); if (i >= 0) rs.push(run(rows, i, { mult })); }
    const med = (k) => { const v = rs.map((r) => r[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
    console.log(`  ${lbl.padEnd(32)} median x${med('mult').toFixed(2)} terburuk x${Math.min(...rs.map((r) => r.mult)).toFixed(2)} | rugi ${rs.filter((r) => r.mult < 1).length}/94 | DD median ${med('maxDd').toFixed(0)}% terburuk ${Math.max(...rs.map((r) => r.maxDd)).toFixed(0)}% | nyangkut terlama ${Math.max(...rs.map((r) => r.longest)).toFixed(0)} hr (median ${med('longest').toFixed(0)}) | eksposur maks ${Math.max(...rs.map((r) => r.maxExpo)).toFixed(2)}x | hangus ${rs.filter((r) => r.wipes > 0).length}/94`);
  }
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
