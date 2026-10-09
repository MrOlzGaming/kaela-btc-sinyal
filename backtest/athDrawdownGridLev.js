// athDrawdownGridLev.js (9 Okt 2026) -- lanjutan athDrawdownGrid.js: aturan Olan + LEVERAGE (Olan: "ketahan lama kita pake leverage,
// naikin pelan-pelan, coba leverage 2"). Futures perpetual BTCUSDT.
//
// Aturan (sama persis versi spot): tiap level 1% di bawah ATH = 1% modal siklus jadi MARGIN (notional = margin x lev); mulai di tengah
// = langsung kerahkan dd%. TP SEMUA begitu (margin + PnL bersih) >= 115% x MODAL DITANAM siklus itu -- modal ditanam TERMASUK margin
// posisi yang udah kelikuidasi (jujur: rugi likuidasi harus ketutup dulu). Abis TP ulang langsung dari acuan ATH.
//
// 2 model likuidasi:
//   ISO : tiap level posisi ISOLATED sendiri (cuma bisa di BingX Standard Futures -- API-nya cuma baca, jadi ini kondisi IDEAL).
//         Kena likuidasi -> margin level itu hangus, level tetap "terisi" (gak diganti) [varian +GANTI: buka ulang margin sama].
//   AGG : semua entry NUMPUK jadi 1 posisi (perpetual Bybit/Binance/BingX biasa, yang bisa otomatis). Likuidasi = SEMUA margin siklus
//         hangus sekaligus.
// Harga likuidasi = entry x (1 - margin/notional + MM 0,5%), margin dikurangi funding yang dibayar. Cek pakai LOW harian (konservatif),
// TP pakai CLOSE (konservatif). Fee taker 0,05% notional buka & tutup. Funding ASLI Binance (funding-rate-cache.json, 2019-09..);
// di luar rentang data dipakai 0,01%/8 jam. Data OHLC harian Binance BTCUSDT 2017-08..sekarang.
// Pakai: node backtest/athDrawdownGridLev.js

const fs = require('fs');
const path = require('path');

const FEE = 0.0005, MM = 0.005, CAPITAL = 1000, PRIOR_ATH = 19783; // ATH Des 2017 intraday baru ada di data, tapi ATH sebelum data mulai (Agu 2017) ~$3k
const DEFAULT_FUND_8H = 0.0001;

async function loadDaily() {
  const rows = []; let cur = Date.UTC(2017, 7, 17);
  while (cur < Date.now()) {
    const k = await (await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=${cur}&limit=1000`)).json();
    if (!Array.isArray(k) || !k.length) break;
    for (const x of k) if (x[6] < Date.now()) rows.push({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4] });
    cur = k[k.length - 1][0] + 864e5; if (k.length < 1000) break;
  }
  const f = JSON.parse(fs.readFileSync(path.join(__dirname, 'funding-rate-cache.json'), 'utf8'));
  const byDay = new Map();
  for (const x of f) { const d = Math.floor(x.fundingTime / 864e5) * 864e5; byDay.set(d, (byDay.get(d) || 0) + Number(x.fundingRate)); }
  const fMin = f[0].fundingTime, fMax = f[f.length - 1].fundingTime;
  let ath = 0;
  for (const r of rows) {
    ath = Math.max(ath, r.c); r.ath = ath; r.dd = (1 - r.c / ath) * 100;
    r.fund = r.t >= fMin && r.t <= fMax ? (byDay.get(r.t) || 0) : DEFAULT_FUND_8H * 3;
  }
  return rows;
}

// tpBasis 'all' = modal ditanam siklus TERMASUK margin yang udah kelikuidasi (jujur, tapi bisa nyangkut selamanya abis rugi gede);
// 'open' = cuma margin posisi yang MASIH kebuka (bacaan lain kalimat Olan 'modal yang ditanam ngasih return 15%').
// minDd (9 Okt, Olan: 'kasih syarat, btc ath -15% boleh entry') -- entry pertama cuma kalau dd >= minDd (lalu porsi = dd%).
function runLev(rows, startIdx, { lev, tp = 15, model = 'ISO', replace = false, tpBasis = 'all', minDd = 1 }) {
  let cash = CAPITAL, cycleCap = CAPITAL, filled = 0, investedCycle = 0, cycles = 0, cycleStart = startIdx;
  let pos = []; // {entry, qty, margin}
  let peakEq = CAPITAL, maxDd = 0, maxNotionalX = 0, liqCount = 0, liqLoss = 0, fundPaid = 0, feePaid = 0, longest = 0, ruined = false, aggLiqs = 0;
  const open = (margin, px) => {
    margin = Math.min(margin, cash); if (margin <= 0.01) return;
    const notional = margin * lev, fee = notional * FEE;
    cash -= margin; feePaid += fee; investedCycle += margin;
    pos.push({ entry: px, qty: notional / px, margin: margin - fee, margin0: margin });
  };
  const eqNow = (px) => cash + pos.reduce((a, p) => a + p.margin + p.qty * (px - p.entry), 0);
  for (let i = startIdx; i < rows.length; i++) {
    const { l, c, dd, fund, t } = rows[i];
    // 1) funding (dibayar long kalau positif) dari margin posisi
    for (const p of pos) { const fpay = p.qty * c * fund; p.margin -= fpay; fundPaid += fpay; }
    // 2) likuidasi pakai LOW
    if (model === 'ISO') {
      const keep = [];
      for (const p of pos) {
        const liqPx = p.entry * (1 - p.margin / (p.qty * p.entry) + MM);
        if (l <= liqPx || p.margin <= 0) {
          liqCount++; liqLoss += Math.max(0, p.margin + p.qty * 0) + 0; // margin hangus
          if (replace) open(p.margin > 0 ? p.margin : 0, c); // ganti margin sama (versi sederhana) -- dibuka di close
        } else keep.push(p);
      }
      pos = keep;
    } else if (pos.length) {
      const qty = pos.reduce((a, p) => a + p.qty, 0), margin = pos.reduce((a, p) => a + p.margin, 0), cost = pos.reduce((a, p) => a + p.qty * p.entry, 0);
      const avg = cost / qty, liqPx = avg * (1 - margin / cost + MM);
      if (l <= liqPx || margin <= 0) { liqCount += pos.length; aggLiqs++; liqLoss += margin; pos = []; }
    }
    // 3) TP pakai CLOSE: nilai bersih posisi (margin + PnL - fee tutup) >= investedCycle x (1+tp)
    if (pos.length) {
      const val = pos.reduce((a, p) => a + p.margin + p.qty * (c - p.entry) - p.qty * c * FEE, 0);
      const basis = tpBasis === 'open' ? pos.reduce((a, p) => a + p.margin0, 0) : investedCycle;
      if (val >= basis * (1 + tp / 100)) {
        feePaid += pos.reduce((a, p) => a + p.qty * c * FEE, 0);
        cash += val; pos = []; cycles++; filled = 0; investedCycle = 0; cycleStart = i; cycleCap = cash;
      }
    }
    // 4) entry level baru
    const level = Math.min(100, Math.floor(dd));
    if (level >= Math.max(1, minDd) && level > filled) { open((level - filled) / 100 * cycleCap, c); filled = level; }
    const eq = eqNow(c);
    if (eq < CAPITAL * 0.05) ruined = true;
    peakEq = Math.max(peakEq, eq); maxDd = Math.max(maxDd, (1 - eq / peakEq) * 100);
    maxNotionalX = Math.max(maxNotionalX, pos.reduce((a, p) => a + p.qty * c, 0) / Math.max(eq, 1e-9));
    longest = Math.max(longest, (t - rows[cycleStart].t) / 864e5);
  }
  const last = rows[rows.length - 1], eq = eqNow(last.c), years = (last.t - rows[startIdx].t) / (365.25 * 864e5);
  return { mult: eq / CAPITAL, cagr: years > 0.5 && eq > 0 ? (Math.pow(eq / CAPITAL, 1 / years) - 1) * 100 : null, maxDd, maxNotionalX, cycles, liqCount, aggLiqs, liqLoss, fundPaid, feePaid, longest, ruined };
}

const fmt = (r) => `x${r.mult.toFixed(2)} (CAGR ${r.cagr === null ? '-' : r.cagr.toFixed(0) + '%'}) DD ${r.maxDd.toFixed(0)}% | eksposur maks ${r.maxNotionalX.toFixed(2)}x | TP ${r.cycles}x | nyangkut terlama ${r.longest.toFixed(0)} hr | likuidasi ${r.liqCount}${r.aggLiqs ? ` (${r.aggLiqs}x SEMUA)` : ''} rugi $${r.liqLoss.toFixed(0)} | funding $${r.fundPaid.toFixed(0)} fee $${r.feePaid.toFixed(0)}${r.ruined ? ' | ☠️ MODAL HABIS' : ''}`;

(async () => {
  const rows = await loadDaily();
  const last = rows[rows.length - 1];
  const at = (iso) => rows.findIndex((r) => r.t >= Date.parse(iso));
  const athIdx = rows.reduce((b, r, i) => (r.c >= rows[b].c ? i : b), 0);
  console.log(`Data Binance BTCUSDT harian ${new Date(rows[0].t).toISOString().slice(0, 10)}..${new Date(last.t).toISOString().slice(0, 10)} | BTC $${last.c.toFixed(0)} ATH $${last.ath.toFixed(0)} | fee ${FEE * 100}% MM ${MM * 100}% | TP 15% modal ditanam (termasuk margin yg kelikuidasi)`);
  const starts = [['ATH Des 2017', '2017-12-17'], ['ATH Nov 2021', '2021-11-08'], ['ATH Mar 2024', '2024-03-14'], ['ATH Okt 2025', null], ['Jan 2020', '2020-01-01'], ['Bottom Nov 2022', '2022-11-21']];
  const CONFIGS = [
    ['1x (futures, ada funding)', { lev: 1, model: 'ISO' }],
    ['1,5x ISO', { lev: 1.5, model: 'ISO' }], ['2x ISO', { lev: 2, model: 'ISO' }], ['2x ISO +ganti', { lev: 2, model: 'ISO', replace: true }],
    ['2x ISO TP dr posisi kebuka', { lev: 2, model: 'ISO', tpBasis: 'open' }], ['2x AGG TP dr posisi kebuka', { lev: 2, model: 'AGG', tpBasis: 'open' }], ['1,5x ISO TP dr posisi kebuka', { lev: 1.5, model: 'ISO', tpBasis: 'open' }],
    ['2x AGG (perp numpuk)', { lev: 2, model: 'AGG' }], ['3x ISO', { lev: 3, model: 'ISO' }], ['3x AGG (perp numpuk)', { lev: 3, model: 'AGG' }],
  ];
  for (const [name, iso] of starts) {
    const idx = iso ? at(iso) : athIdx; if (idx < 0) continue;
    console.log(`\n=== Mulai ${name} (${new Date(rows[idx].t).toISOString().slice(0, 10)}, BTC $${rows[idx].c.toFixed(0)}, dd ${rows[idx].dd.toFixed(0)}%) ===`);
    for (const [lbl, cfg] of CONFIGS) console.log(`  ${lbl.padEnd(26)} ${fmt(runLev(rows, idx, cfg))}`);
  }
  console.log('\n=== Mulai TIAP AWAL BULAN 2018-01 .. 2025-10 (s/d sekarang) ===');
  for (const [lbl, cfg] of CONFIGS) {
    const rs = [];
    for (let y = 2018; y <= 2025; y++) for (let m = 0; m < 12; m++) { if (y === 2025 && m > 9) break; const i = at(new Date(Date.UTC(y, m, 1)).toISOString()); if (i >= 0) rs.push(runLev(rows, i, cfg)); }
    const med = (k) => { const s = rs.map((r) => r[k]).filter((x) => x !== null).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    console.log(`  ${lbl.padEnd(26)} median x${med('mult').toFixed(2)} | terburuk x${Math.min(...rs.map((r) => r.mult)).toFixed(2)} | rugi ${rs.filter((r) => r.mult < 1).length}/${rs.length} | DD median ${med('maxDd').toFixed(0)}% terburuk ${Math.max(...rs.map((r) => r.maxDd)).toFixed(0)}% | nyangkut terlama ${Math.max(...rs.map((r) => r.longest)).toFixed(0)} hr (median ${med('longest').toFixed(0)}) | modal habis ${rs.filter((r) => r.ruined).length}/${rs.length}`);
  }
  // ===== Syarat entry minimal (Olan 9 Okt): TP 15% dari modal yang MASIH ditanam, entry baru boleh mulai ATH -X% =====
  console.log('\n######## SYARAT ENTRY MINIMAL (TP 15% dari posisi yang masih kebuka) -- mulai tiap awal bulan 2018-01..2025-10 ########');
  for (const lev of [1, 1.5, 2]) for (const model of lev === 1 ? ['ISO'] : ['ISO', 'AGG']) for (const minDd of [1, 10, 15, 20, 25]) {
    const cfg = { lev, model, tpBasis: 'open', minDd }, rs = [];
    for (let y = 2018; y <= 2025; y++) for (let m = 0; m < 12; m++) { if (y === 2025 && m > 9) break; const i = at(new Date(Date.UTC(y, m, 1)).toISOString()); if (i >= 0) rs.push(runLev(rows, i, cfg)); }
    const med = (k) => { const v = rs.map((r) => r[k]).filter((x) => x !== null).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
    console.log(`  ${(lev + 'x ' + model).padEnd(8)} entry >= ATH -${String(minDd).padStart(2)}% | median x${med('mult').toFixed(2)} terburuk x${Math.min(...rs.map((r) => r.mult)).toFixed(2)} | rugi ${rs.filter((r) => r.mult < 1).length}/${rs.length} | DD median ${med('maxDd').toFixed(0)}% terburuk ${Math.max(...rs.map((r) => r.maxDd)).toFixed(0)}% | nyangkut terlama ${Math.max(...rs.map((r) => r.longest)).toFixed(0)} hr | likuidasi median ${med('liqCount')}`);
  }
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
