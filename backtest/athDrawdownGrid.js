// athDrawdownGrid.js (9 Okt 2026) -- ide Olan, modif dari prompt "BTC long grid" (btc_long_grid_research_prompt.md):
//   "tanpa leverage. Open posisi selalu mikirnya seolah lagi open di ATH -1%: kalau mulai pas BTC ATH -20%, kerahkan 20% modal;
//    pas ATH -50%, separuh modal." -> porsi modal di BTC = seberapa dalam harga di bawah ATH (step 1%).
// Spot/tanpa leverage = gak ada likuidasi -> aturan "posisi pengganti 110%" gak relevan (dibuang).
//
// Data: harga close HARIAN BTC (yahoo-btc-daily.json 2014-09.., disambung Binance BTCUSDT 1d sampai hari ini).
// ATH = harga close tertinggi sejauh ini (mulai dari ATH 2013 $1.163 biar 2014-2016 gak salah). Keputusan & eksekusi di close
// hari yang sama (spot, ukuran kecil) -- konservatif: gak pakai low intraday buat isi level. Fee spot 0,1% per transaksi.
//
// Varian (modal awal $1.000, gak ada setoran tambahan):
//   HOLD_ATH  : beli bertahap (porsi = dd% dari modal siklus), JUAL SEMUA pas BTC cetak ATH baru, siklus baru dari situ.
//   TP20      : sama, tapi jual semua pas nilai BTC yang dipegang +20% dari modal yang udah masuk; mulai lagi abis harga turun
//               1% dari harga jual (biar gak langsung beli balik di harga yang sama).
//   REBALANCE : porsi BTC SELALU = dd% (beli pas turun, JUAL pas naik tiap step 1%), gak ada "siklus".
//   BUYHOLD   : 100% BTC dari hari mulai (pembanding).
// Pakai: node backtest/athDrawdownGrid.js

const fs = require('fs');
const path = require('path');

const FEE = 0.001;
const PRIOR_ATH = 1163; // ATH 2013 (sebelum data mulai)
const CAPITAL = 1000;

async function loadSeries() {
  const y = JSON.parse(fs.readFileSync(path.join(__dirname, 'yahoo-btc-daily.json'), 'utf8'));
  const rows = y.map((r) => ({ t: r.time, c: r.close })).filter((r) => r.c > 0);
  let cur = rows[rows.length - 1].t + 864e5;
  while (cur < Date.now() - 864e5) {
    const k = await (await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=${cur}&limit=1000`)).json();
    if (!Array.isArray(k) || !k.length) break;
    for (const x of k) if (x[6] < Date.now()) rows.push({ t: x[0], c: +x[4] });
    cur = k[k.length - 1][0] + 864e5;
    if (k.length < 1000) break;
  }
  let ath = PRIOR_ATH;
  for (const r of rows) { ath = Math.max(ath, r.c); r.ath = ath; r.dd = (1 - r.c / ath) * 100; }
  return rows;
}

function run(rows, startIdx, variant) {
  let cash = CAPITAL, btc = 0, cycleCap = CAPITAL, filled = 0, invested = 0, waitBelow = null, cycles = 0, trades = 0;
  let peakEq = CAPITAL, maxDd = 0, maxDeployed = 0, cycleAth = rows[startIdx].ath;
  const buy = (usd, px) => { if (usd <= 0.01) return; usd = Math.min(usd, cash); cash -= usd; btc += usd * (1 - FEE) / px; invested += usd; trades++; };
  const sellAll = (px) => { if (btc <= 0) return; cash += btc * px * (1 - FEE); btc = 0; invested = 0; trades++; };
  for (let i = startIdx; i < rows.length; i++) {
    const { c, ath, dd } = rows[i];
    const level = Math.min(100, Math.floor(dd));
    if (variant === 'BUYHOLD') { if (i === startIdx) buy(cash, c); }
    else if (variant === 'REBALANCE') {
      const eq = cash + btc * c, want = eq * level / 100, have = btc * c;
      if (want > have + eq * 0.0099) buy(want - have, c);
      else if (have > want + eq * 0.0099) { const sellBtc = (have - want) / c; cash += sellBtc * c * (1 - FEE); btc -= sellBtc; trades++; }
    } else {
      // exit dulu
      if (btc > 0) {
        const hitAth = variant === 'HOLD_ATH' && c >= cycleAth && ath > cycleAth - 1e-9 && rows[i - 1] && c >= rows[i - 1].ath;
        const hitTp = variant === 'TP20' && btc * c * (1 - FEE) >= invested * 1.2;
        if (hitAth || hitTp) {
          sellAll(c); cycles++; filled = 0; cycleCap = cash; cycleAth = ath;
          if (variant === 'TP20') waitBelow = c * 0.99;
        }
      }
      if (waitBelow !== null && c <= waitBelow) waitBelow = null;
      if (waitBelow === null && level > filled) { buy((level - filled) / 100 * cycleCap, c); filled = level; }
      if (btc === 0 && filled === 0) cycleAth = ath;
    }
    const eq = cash + btc * c;
    peakEq = Math.max(peakEq, eq); maxDd = Math.max(maxDd, (1 - eq / peakEq) * 100);
    maxDeployed = Math.max(maxDeployed, btc * c / eq * 100);
  }
  const last = rows[rows.length - 1], eq = cash + btc * last.c;
  const years = (last.t - rows[startIdx].t) / (365.25 * 864e5);
  return { eq, mult: eq / CAPITAL, cagr: years > 0.5 ? (Math.pow(eq / CAPITAL, 1 / years) - 1) * 100 : null, maxDd, maxDeployed, cycles, trades, years };
}

const fmt = (r) => `x${r.mult.toFixed(2)} (CAGR ${r.cagr === null ? '-' : r.cagr.toFixed(0) + '%'}) DD maks ${r.maxDd.toFixed(0)}% | modal kepake maks ${r.maxDeployed.toFixed(0)}% | siklus ${r.cycles} | transaksi ${r.trades}`;

(async () => {
  const rows = await loadSeries();
  const at = (iso) => rows.findIndex((r) => r.t >= Date.parse(iso));
  const last = rows[rows.length - 1];
  console.log(`Data ${new Date(rows[0].t).toISOString().slice(0, 10)} .. ${new Date(last.t).toISOString().slice(0, 10)} (${rows.length} hari) | BTC terakhir $${last.c.toFixed(0)} | ATH $${last.ath.toFixed(0)} (dd ${last.dd.toFixed(1)}%) | fee ${FEE * 100}%/transaksi`);
  const VARS = ['HOLD_ATH', 'TP20', 'REBALANCE', 'BUYHOLD'];
  const starts = [
    ['ATH Des 2017', '2017-12-17'], ['ATH Nov 2021', '2021-11-08'], ['Bottom Nov 2022', '2022-11-21'],
    ['ATH Mar 2024', '2024-03-14'], ['ATH terbaru 2025', null], ['Jan 2020', '2020-01-01'],
  ];
  const athIdx = rows.reduce((b, r, i) => (r.c >= rows[b].c ? i : b), 0);
  for (const [name, iso] of starts) {
    const idx = iso ? at(iso) : athIdx;
    if (idx < 0) continue;
    console.log(`\n=== Mulai ${name} (${new Date(rows[idx].t).toISOString().slice(0, 10)}, BTC $${rows[idx].c.toFixed(0)}, dd dari ATH ${rows[idx].dd.toFixed(0)}%) s/d hari ini ===`);
    for (const v of VARS) console.log(`  ${v.padEnd(10)} ${fmt(run(rows, idx, v))}`);
  }
  // ketahanan: mulai tiap awal bulan 2017-2025, horizon s/d hari ini
  console.log('\n=== Mulai TIAP AWAL BULAN 2017-01 .. 2025-10 (s/d hari ini) -- median / terburuk ===');
  for (const v of VARS) {
    const rs = [];
    for (let y = 2017; y <= 2025; y++) for (let m = 0; m < 12; m++) { if (y === 2025 && m > 9) break; const i = at(new Date(Date.UTC(y, m, 1)).toISOString()); if (i >= 0) rs.push(run(rows, i, v)); }
    const med = (k) => { const s = rs.map((r) => r[k]).filter((x) => x !== null).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    const worst = rs.reduce((a, b) => (b.mult < a.mult ? b : a));
    const lose = rs.filter((r) => r.mult < 1).length;
    console.log(`  ${v.padEnd(10)} n=${rs.length} | median x${med('mult').toFixed(2)} DD maks median ${med('maxDd').toFixed(0)}% | terburuk x${worst.mult.toFixed(2)} | rugi di ${lose}/${rs.length} titik mulai | DD maks terburuk ${Math.max(...rs.map((r) => r.maxDd)).toFixed(0)}%`);
  }
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
