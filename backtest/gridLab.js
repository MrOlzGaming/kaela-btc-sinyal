// gridLab.js (9-10 Okt 2026) -- laboratorium grid BTC LONG, riset MANDIRI atas permintaan Olan:
//   "cari sendiri, simulasi berkali-kali. Grid bisa diulang terus siklusnya & di-COMPOUND, aman. Fokus return dari uang yang
//    DITANAM ke grid (bukan seluruh modal). Selesai siklus langsung mulai lagi selama BTC masih <= ATH -15%. Mainkan modal &
//    leverage. Kekuatan kita compounding."
//
// Mesin (perpetual BTCUSDT, 1 posisi CROSS numpuk -- yang bisa otomatis di exchange biasa):
//   - Level grid = ATH x (1 - n x step%). ATH = high tertinggi sejauh ini. Entry cuma kalau harga <= ATH -minDd%.
//   - "Modal ditanam" per level = unit = k% x modal (k = agresivitas per 1% turun). Volume = unit x pengali kedalaman (leverage via
//     volume, gak ganti setting leverage). Return dihitung dari modal ditanam.
//   - Mode CYCLE (aturan Olan): mulai siklus = langsung tanam dd% (sesuai kedalaman), tiap level baru tambah; TP SEMUA begitu untung
//     bersih >= tp% x modal ditanam siklus; abis TP langsung siklus baru (modal = ekuitas -> compound).
//   - Mode LOT (grid klasik): tiap lot punya TP sendiri (+tp% dari modal yang ditanam lot itu); lot TP -> level kosong lagi, beli lagi
//     kalau harga balik turun ke situ. Unit dihitung dari ekuitas SAAT beli -> compound terus.
//   - Pengaman: batas eksposur (volume/ekuitas) -> gak nambah kalau lewat. Likuidasi CROSS level akun pakai LOW candle -> HANGUS.
//   - Biaya: maker 0,02% (limit grid & TP), taker 0,05% (tanam awal siklus), funding ASLI Binance tiap 8 jam (di luar data 0,01%).
//   - Urutan dalam 1 candle (konservatif buat long): LOW dulu (beli + cek likuidasi), baru HIGH (TP); lot yang baru dibeli di candle
//     itu gak boleh TP di candle yang sama.
// Data: Binance BTCUSDT 1 jam 2017-08..sekarang (cache backtest/btc-1h-gridlab-cache.json).
// Pakai: node backtest/gridLab.js [search|validate]

const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, 'btc-1h-gridlab-cache.json');
const MAKER = 0.0002, TAKER = 0.0005, MM = 0.005, CAPITAL = 1000, DEFAULT_FUND = 0.0001;

async function loadHourly() {
  let rows = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : [];
  let cur = rows.length ? rows[rows.length - 1][0] + 3600e3 : Date.UTC(2017, 7, 17);
  // cache cukup baru (< 1 hari) -> gak download (6 Okt: fetch tanpa batas waktu sempat bikin proses nyangkut 40 menit)
  const fresh = rows.length && Date.now() - rows[rows.length - 1][0] < 864e5;
  while (!fresh && cur < Date.now() - 3600e3) {
    const k = await (await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&startTime=${cur}&limit=1000`, { signal: AbortSignal.timeout(20000) })).json();
    if (!Array.isArray(k) || !k.length) break;
    for (const x of k) if (x[6] < Date.now()) rows.push([x[0], +x[1], +x[2], +x[3], +x[4]]);
    cur = k[k.length - 1][0] + 3600e3; if (k.length < 1000) break;
  }
  fs.writeFileSync(CACHE, JSON.stringify(rows));
  const f = JSON.parse(fs.readFileSync(path.join(__dirname, 'funding-rate-cache.json'), 'utf8'));
  const fund = new Map(f.map((x) => [Math.floor(x.fundingTime / 3600e3) * 3600e3, Number(x.fundingRate)]));
  const fMin = f[0].fundingTime, fMax = f[f.length - 1].fundingTime;
  const T = new Float64Array(rows.length), O = new Float64Array(rows.length), H = new Float64Array(rows.length), L = new Float64Array(rows.length), C = new Float64Array(rows.length), F = new Float64Array(rows.length), ATH = new Float64Array(rows.length);
  let ath = 0;
  rows.forEach((r, i) => {
    T[i] = r[0]; O[i] = r[1]; H[i] = r[2]; L[i] = r[3]; C[i] = r[4];
    const hr = new Date(r[0]).getUTCHours();
    F[i] = hr % 8 === 0 ? (r[0] >= fMin && r[0] <= fMax ? (fund.get(r[0]) || 0) : DEFAULT_FUND) : 0;
    ATH[i] = ath; ath = Math.max(ath, r[2]); // ATH SEBELUM candle ini (gak look-ahead)
  });
  return { T, O, H, L, C, F, ATH, n: rows.length };
}

// cfg: { mode:'CYCLE'|'LOT', step, k, mult(ddPct)->x, tp, minDd, cap }
function sim(D, i0, i1, cfg) {
  const { mode, step, k, mult, tp, minDd = 15, cap = 99 } = cfg;
  let wallet = CAPITAL, qty = 0, cost = 0; // posisi gabungan (cross)
  let lots = []; // LOT: {entry, qty, unit, target, lvl, bornAt}
  let planted = 0, cycleCap = CAPITAL, filledLvl = 0, cycles = 0, cycleStart = i0, wipes = 0, tradesTp = 0;
  let peak = CAPITAL, maxDd = 0, maxExpo = 0, longest = 0, fundPaid = 0, fees = 0, sumRetPlanted = 0;
  let lastAth = -1, occupied = new Set();
  const eqAt = (px) => wallet + qty * px - cost;
  const addBuy = (px, unit, volMult, fee) => {
    const vol = unit * volMult, q = vol / px;
    qty += q; cost += vol; wallet -= vol * fee; fees += vol * fee; planted += unit;
    return q;
  };
  for (let i = i0; i < i1; i++) {
    const ath = D.ATH[i]; if (!(ath > 0)) continue;
    const o = D.O[i], h = D.H[i], l = D.L[i], c = D.C[i];
    // funding
    if (D.F[i] !== 0 && qty > 0) { const fp = qty * o * D.F[i]; wallet -= fp; fundPaid += fp; }
    // ---- LOW: entry ----
    const lvlAt = (px) => Math.floor((1 - px / ath) * 100 / step + 1e-9); // level yang udah ditembus harga px
    if (mode === 'CYCLE') {
      const lowLvl = lvlAt(l);
      if (lowLvl * step >= minDd && lowLvl > filledLvl) {
        const eq = eqAt(l);
        if (eq > 0) {
          for (let lv = filledLvl + 1; lv <= lowLvl; lv++) {
            const ddPct = lv * step;
            if (ddPct < minDd) { continue; }
            const px = Math.min(ath * (1 - ddPct / 100), o);
            const unit = cycleCap * k / 100 * step; // k% modal per 1% turun
            const vol = unit * mult(ddPct);
            if ((qty * px + vol) / Math.max(eqAt(px), 1e-9) > cap) break;
            // level < minDd yang "kelewat" (mulai di tengah) ikut ditanam sekaligus di level pertama yang diizinkan -- aturan Olan dd%
            addBuy(px, unit, mult(ddPct), filledLvl === 0 && lv === Math.ceil(minDd / step) ? TAKER : MAKER);
          }
          if (filledLvl === 0 && lowLvl * step >= minDd) {
            // tanam level 1..minDd sekaligus (porsi = dd%) pas pertama masuk
            const extra = Math.ceil(minDd / step) - 1;
            if (extra > 0) { const px = Math.min(ath * (1 - minDd / 100), o); for (let lv = 1; lv <= extra; lv++) { const unit = cycleCap * k / 100 * step; if ((qty * px + unit * mult(minDd)) / Math.max(eqAt(px), 1e-9) > cap) break; addBuy(px, unit, mult(minDd), TAKER); } }
          }
          filledLvl = Math.max(filledLvl, lowLvl);
        }
      }
    } else { // LOT
      if (ath !== lastAth) { lastAth = ath; occupied = new Set(lots.map((x) => lvlAt(x.entry * 1.000001))); }
      const lowLvl = lvlAt(l);
      if (lowLvl * step >= minDd) {
        const startLv = Math.max(Math.ceil(minDd / step), 1);
        for (let lv = startLv; lv <= lowLvl; lv++) {
          if (occupied.has(lv)) continue;
          const ddPct = lv * step, px = Math.min(ath * (1 - ddPct / 100), o);
          const eq = eqAt(px); if (eq <= 0) break;
          const unit = eq * k / 100 * step, vm = mult(ddPct), vol = unit * vm;
          if ((qty * px + vol) / eq > cap) break;
          const q = addBuy(px, unit, vm, MAKER);
          const target = px * (1 + tp / 100 / vm); // +tp% dari modal ditanam lot (volume x pengali)
          lots.push({ entry: px, qty: q, unit, target, lvl: lv, born: i });
          occupied.add(lv);
        }
      }
    }
    // ---- likuidasi cross di LOW ----
    if (qty > 0 && eqAt(l) <= MM * qty * l) {
      wallet = Math.max(0, eqAt(l)); qty = 0; cost = 0; lots = []; occupied = new Set(); planted = 0; filledLvl = 0; wipes++; cycleCap = wallet; cycleStart = i;
      if (wallet < 1) break;
    }
    // ---- HIGH: TP ----
    if (qty > 0) {
      if (mode === 'CYCLE') {
        // harga TP siklus: qty*P*(1-MAKER) - cost >= planted*tp
        const tpPx = (cost + planted * tp / 100) / (qty * (1 - MAKER));
        if (h >= tpPx && i > cycleStart) {
          const fee = qty * tpPx * MAKER, pnl = qty * tpPx - cost - fee;
          wallet += pnl; fees += fee; sumRetPlanted += pnl / planted; cycles++;
          qty = 0; cost = 0; planted = 0; filledLvl = 0; cycleCap = wallet; cycleStart = i;
        }
      } else {
        const keep = [];
        for (const lot of lots) {
          if (lot.born < i && h >= lot.target) {
            const fee = lot.qty * lot.target * MAKER, pnl = lot.qty * (lot.target - lot.entry) - fee;
            wallet += pnl; fees += fee; qty -= lot.qty; cost -= lot.qty * lot.entry; planted -= lot.unit;
            sumRetPlanted += pnl / lot.unit; tradesTp++; occupied.delete(lot.lvl);
          } else keep.push(lot);
        }
        lots = keep; if (qty < 1e-12) { qty = 0; cost = 0; planted = 0; cycleStart = i; }
      }
    }
    const eq = eqAt(c);
    if (eq > peak) peak = eq; const ddq = (1 - eq / peak) * 100; if (ddq > maxDd) maxDd = ddq;
    if (eq > 0 && qty > 0) { const ex = qty * c / eq; if (ex > maxExpo) maxExpo = ex; }
    const stuck = (D.T[i] - D.T[cycleStart]) / 864e5; if (qty > 0 && stuck > longest) longest = stuck;
  }
  const last = Math.min(i1, D.n) - 1, eq = eqAt(D.C[last]), yrs = (D.T[last] - D.T[i0]) / (365.25 * 864e5);
  const nTp = mode === 'CYCLE' ? cycles : tradesTp;
  return { mult: eq / CAPITAL, cagr: yrs > 0.3 && eq > 0 ? (Math.pow(eq / CAPITAL, 1 / yrs) - 1) * 100 : -100, maxDd, maxExpo, nTp, avgRetPlanted: nTp ? sumRetPlanted / nTp * 100 : 0, longest, wipes, fundPaid, fees, yrs };
}

// ---------- jadwal pengali volume ----------
const MULTS = {
  'x1': () => 1, 'x1.5': () => 1.5, 'x2': () => 2, 'x3': () => 3,
  '1>2@40': (d) => (d >= 40 ? 2 : 1), '1>2@50': (d) => (d >= 50 ? 2 : 1), '1>3@50': (d) => (d >= 50 ? 3 : 1),
  'halus1+d/50': (d) => 1 + d / 50, '2>1@50': (d) => (d >= 50 ? 1 : 2), // kebalikan: agresif di atas, kalem di bawah
};

function idxAt(D, iso) { const t = Date.parse(iso); let lo = 0, hi = D.n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (D.T[m] < t) lo = m + 1; else hi = m; } return lo; }
function athIdx(D) { let b = 0; for (let i = 0; i < D.n; i++) if (D.H[i] >= D.H[b]) b = i; return b; }

module.exports = { loadHourly, sim, MULTS, idxAt, athIdx };

// Tahap 2 (refine): zona AMAN. Saring 9 titik mulai -> kandidat divalidasi di 94 titik mulai bulanan 2018-01..2025-10
// + uji jujur 2 era (setel di mulai 2018-2021, lihat hasil mulai 2022-2025). Aman = gak pernah hangus, eksposur maks <= 2x,
// DD terburuk <= batas. Pembanding: buy&hold BTC (CAGR median titik mulai yang sama).
async function refine(D) {
  const end = D.n;
  const screenStarts = ['2017-12-17', '2018-06-01', '2019-06-01', '2020-01-01', '2021-04-14', '2021-11-10', '2023-01-01', '2024-03-14', null].map((s) => (s ? idxAt(D, s) : athIdx(D)));
  const monthly = []; for (let y = 2018; y <= 2025; y++) for (let m = 0; m < 12; m++) { if (y === 2025 && m > 9) break; monthly.push({ y, i: idxAt(D, new Date(Date.UTC(y, m, 1)).toISOString()) }); }
  const MX = { ...MULTS, '1>1.5@40': (d) => (d >= 40 ? 1.5 : 1), '1>2@60': (d) => (d >= 60 ? 2 : 1), '1>1.5@30>2@50': (d) => (d >= 50 ? 2 : d >= 30 ? 1.5 : 1) };
  const cands = []; let nDone = 0;
  for (const m of ['CYCLE', 'LOT']) for (const step of [1, 2, 3]) for (const k of [0.25, 0.5, 0.75, 1, 1.25]) for (const mk of ['x1', 'x1.5', '1>1.5@40', '1>2@40', '1>2@50', '1>2@60', '1>1.5@30>2@50', '1>3@50', 'halus1+d/50']) for (const tp of [8, 10, 15, 20, 30, 50]) {
    const cfg = { mode: m, step, k, mult: MX[mk], tp, cap: 2, minDd: 15 };
    const rs = screenStarts.map((s) => sim(D, s, end, cfg));
    if (++nDone % 200 === 0) console.log(`  saringan ${nDone} konfigurasi...`);
    if (rs.some((r) => r.wipes > 0 || r.maxExpo > 2.01)) continue;
    const worstDd = Math.max(...rs.map((r) => r.maxDd));
    if (worstDd > 65) continue;
    const cg = rs.map((r) => r.cagr).sort((a, b) => a - b);
    cands.push({ m, step, k, mk, tp, worstDd, med: cg[4], cfg });
  }
  console.log(`Lolos saringan aman (9 titik): ${cands.length} konfigurasi`);
  const bh = monthly.map(({ i }) => { const yrs = (D.T[end - 1] - D.T[i]) / (365.25 * 864e5); return (Math.pow(D.C[end - 1] / D.O[i], 1 / yrs) - 1) * 100; }).sort((a, b) => a - b);
  console.log(`Pembanding BUY&HOLD BTC (94 titik mulai): CAGR median ${bh[47].toFixed(0)}%`);
  const results = [];
  let nVal = 0;
  for (const c of cands) {
    if (++nVal % 50 === 0) console.log(`  validasi ${nVal}/${cands.length}...`);
    const rs = monthly.map(({ y, i }) => ({ y, ...sim(D, i, end, c.cfg) }));
    if (rs.some((r) => r.wipes > 0)) continue;
    const med = (arr, key) => { const v = arr.map((r) => r[key]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
    const e1 = rs.filter((r) => r.y <= 2021), e2 = rs.filter((r) => r.y >= 2022);
    results.push({ ...c, cfg: undefined, medCagr: med(rs, 'cagr'), e1: med(e1, 'cagr'), e2: med(e2, 'cagr'), worstDd94: Math.max(...rs.map((r) => r.maxDd)), medDd: med(rs, 'maxDd'), lose: rs.filter((r) => r.mult < 1).length, stuck: Math.max(...rs.map((r) => r.longest)), expo: Math.max(...rs.map((r) => r.maxExpo)), avgRet: rs.reduce((a, r) => a + r.avgRetPlanted, 0) / rs.length, nTp: med(rs, 'nTp') });
  }
  fs.writeFileSync(path.join(__dirname, 'gridlab-refine-result.json'), JSON.stringify(results));
  const line = (r) => `  ${r.m.padEnd(5)} jarak ${r.step}% | entry ${r.k}%modal/1% turun | volume ${r.mk.padEnd(13)} | TP ${String(r.tp).padStart(2)}% | CAGR median ${r.medCagr.toFixed(1)}% (era1 ${r.e1.toFixed(0)}% era2 ${r.e2.toFixed(0)}%) | DD terburuk ${r.worstDd94.toFixed(0)}% median ${r.medDd.toFixed(0)}% | rugi ${r.lose}/94 | nyangkut ${r.stuck.toFixed(0)} hr | eksposur ${r.expo.toFixed(2)}x | TP median ${r.nTp}x`;
  for (const lim of [40, 50, 60]) {
    const ok = results.filter((r) => r.worstDd94 <= lim && r.lose === 0).sort((a, b) => b.medCagr - a.medCagr);
    console.log(`\n=== AMAN: 94 titik mulai, gak hangus, gak ada yang rugi, DD terburuk <= ${lim}% (${ok.length} konfigurasi) ===`);
    ok.slice(0, 10).forEach((r) => console.log(line(r)));
  }
  // uji jujur: pilih juara pakai era1 doang, lihat era2
  const pick = results.filter((r) => r.worstDd94 <= 60 && r.lose === 0).sort((a, b) => b.e1 - a.e1)[0];
  if (pick) console.log(`\n=== UJI JUJUR: juara dipilih dari era1 (mulai 2018-2021) ===\n${line(pick)}\n  -> era2 (mulai 2022-2025, gak dipakai buat milih): CAGR median ${pick.e2.toFixed(1)}%`);
}

if (require.main === module && process.argv[2] === 'refine') (async () => { await refine(await loadHourly()); })().catch((e) => { console.error('ERROR', e.stack); process.exit(1); });

if (require.main === module && process.argv[2] !== 'refine') (async () => {
  const D = await loadHourly();
  const mode = process.argv[2] || 'search';
  const end = D.n;
  console.log(`BTCUSDT 1j ${new Date(D.T[0]).toISOString().slice(0, 10)}..${new Date(D.T[D.n - 1]).toISOString().slice(0, 10)} (${D.n} candle)`);
  const KEY_STARTS = ['2017-12-17', '2018-06-01', '2019-06-01', '2020-01-01', '2021-04-14', '2021-11-10', '2023-01-01', '2024-03-14', null];
  const starts = KEY_STARTS.map((s) => (s ? idxAt(D, s) : athIdx(D)));
  if (mode === 'search') {
    const out = [];
    let nRun = 0; const t0 = Date.now();
    for (const m of ['CYCLE', 'LOT']) for (const step of [0.5, 1, 2]) for (const k of [0.5, 1, 1.5, 2]) for (const mk of Object.keys(MULTS)) for (const tp of [10, 15, 20, 30]) for (const cap of [1.5, 2, 3, 99]) {
      const cfg = { mode: m, step, k, mult: MULTS[mk], tp, cap, minDd: 15 };
      const rs = starts.map((s) => sim(D, s, end, cfg)); nRun += rs.length;
      const cagrs = rs.map((r) => r.cagr).sort((a, b) => a - b);
      out.push({ m, step, k, mk, tp, cap, medCagr: cagrs[Math.floor(cagrs.length / 2)], minMult: Math.min(...rs.map((r) => r.mult)), worstDd: Math.max(...rs.map((r) => r.maxDd)), wipes: rs.reduce((a, r) => a + r.wipes, 0), longest: Math.max(...rs.map((r) => r.longest)), avgRet: rs.reduce((a, r) => a + r.avgRetPlanted, 0) / rs.length, nTp: rs.reduce((a, r) => a + r.nTp, 0) / rs.length, expo: Math.max(...rs.map((r) => r.maxExpo)) });
    }
    console.log(`${out.length} konfigurasi x ${starts.length} titik mulai = ${nRun} simulasi, ${((Date.now() - t0) / 1000).toFixed(0)} dtk`);
    fs.writeFileSync(path.join(__dirname, 'gridlab-search-result.json'), JSON.stringify(out));
    const show = (title, arr) => { console.log(`\n${title}`); for (const r of arr.slice(0, 15)) console.log(`  ${r.m.padEnd(5)} step ${r.step}% k ${r.k} vol ${r.mk.padEnd(11)} TP ${r.tp}% cap ${r.cap === 99 ? '-' : r.cap + 'x'} | CAGR median ${r.medCagr.toFixed(0)}% | terburuk x${r.minMult.toFixed(2)} | DD terburuk ${r.worstDd.toFixed(0)}% | hangus ${r.wipes} | nyangkut ${r.longest.toFixed(0)} hr | TP ${r.nTp.toFixed(0)}x rata2 +${r.avgRet.toFixed(1)}%/tanam | eksposur maks ${r.expo.toFixed(1)}x`); };
    const safe = (dd) => out.filter((r) => r.wipes === 0 && r.worstDd <= dd && r.minMult >= 1).sort((a, b) => b.medCagr - a.medCagr);
    show('=== TERBAIK: gak pernah hangus, gak pernah rugi, DD terburuk <= 50% ===', safe(50));
    show('=== TERBAIK: gak pernah hangus, gak pernah rugi, DD terburuk <= 65% ===', safe(65));
    show('=== TERBAIK TANPA BATAS DD (tetap gak hangus) ===', out.filter((r) => r.wipes === 0).sort((a, b) => b.medCagr - a.medCagr));
  }
})().catch((e) => { console.error('ERROR', e.stack); process.exit(1); });
