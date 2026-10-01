// dcaLeverLadder.js (1 Okt 2026) -- ide Olan: "DCA futures x3, $3/hari dari BOTTOM, tiap hari 1 posisi
// independen; posisi yang kelikuidasi diganti nominal sama tapi leverage naik (x3 -> x5 -> x7 -> x9 MAKS),
// biar hari ke-N beneran N posisi hidup. Kalo liq beneran diganti tapi kerugian liq tetep dicatat.
// Selesai investasi, tunggu 30 hari, panen (tutup semua)."
//   Uji 1: 1000 hari dari bottom 2022.   Uji 2: dari bottom sampai halving (20 Apr 2024).
//   Uji 3 (ketahanan): tanggal mulai tiap kuartal 2020-2025 -- gimana kalau mulainya BUKAN pas bottom?
//
// Model:
//   - Bottom 2022 = 2022-11-21 (low siklus; tanggal ini ketahuan BELAKANGAN -> skenario timing terbaik).
//   - Tiap posisi ISOLATED, margin $3, entry di OPEN harian (perp Binance BTCUSDT), fee taker 0,05% buka
//     + 0,05% tutup dari notional.
//   - Funding ASLI Binance BTCUSDT (tiap 8 jam, dijumlah per hari) dipotong dari margin posisi.
//   - Likuidasi: margin + PnL di harga TERENDAH hari itu <= maintenance 0,5% notional -> margin $3 HILANG
//     (dicatat sbg "rugi likuidasi").
//   - Pengganti dibuka di OPEN hari berikutnya, leverage naik satu anak tangga (x9 kena lagi -> tetap x9),
//     modal pengganti = setoran $3 BARU (ikut dihitung di total setoran).
//   - Penggantian cuma selama masa investasi; selama 30 hari tunggu, yang kelikuidasi hilang tanpa ganti.
//   - Panen: tutup semua di CLOSE hari ke-(setoran terakhir + 30).
// Pembanding: x3 tanpa ganti, x1 (tanpa leverage, tetap bayar funding).
// Pakai: node backtest/dcaLeverLadder.js <ladder-data.json>
//   (file data = {c:[{t,o,h,l,c}], f:[[time,rate]]} dari fapi.binance.com -- fapi diblok di beberapa
//    jaringan, ambil lewat VPS; tanpa argumen script coba fetch langsung)

const fs = require('fs');
const BOTTOM = Date.UTC(2022, 10, 21);
const HALVING = Date.UTC(2024, 3, 20);
const MARGIN = 3, FEE = 0.0005, MMR = 0.005;
const LADDER = [3, 5, 7, 9];

async function getJson(url) {
  for (let a = 0; a < 5; a++) {
    try { const r = await fetch(url); const j = await r.json(); if (Array.isArray(j)) return j; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('gagal fetch ' + url);
}
async function fetchData() {
  const S = Date.UTC(2019, 8, 10), c = [], f = [];
  for (let t = S; t < Date.now();) { const d = await getJson(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1d&startTime=${t}&limit=1000`); if (!d.length) break; for (const x of d) c.push({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4] }); t = d.at(-1)[0] + 864e5; if (d.length < 1000) break; }
  for (let t = S; t < Date.now();) { const d = await getJson(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&startTime=${t}&limit=1000`); if (!d.length) break; for (const x of d) f.push([Number(x.fundingTime), Number(x.fundingRate)]); t = Number(d.at(-1).fundingTime) + 1; if (d.length < 1000) break; }
  return { c, f };
}

function simulate(candles, fDay, investDays, ladder, replace) {
  const lastInvestIdx = investDays - 1, harvestIdx = lastInvestIdx + 30;
  if (harvestIdx >= candles.length) return null;
  const pos = [];
  let deposited = 0, pending = [], replaced = 0, liqLoss = 0, fundingPaid = 0;
  const liqCount = {};
  for (let i = 0; i <= harvestIdx; i++) {
    const x = candles[i];
    const open = (lev, slot) => { const n = MARGIN * lev; deposited += MARGIN; pos.push({ slot, lev, entry: x.o, qty: n / x.o, margin: MARGIN - n * FEE, alive: true }); };
    if (i <= lastInvestIdx) { for (const r of pending) { open(r.lev, r.slot); replaced++; } open(ladder[0], i); }
    pending = [];
    const fr = fDay.get(Math.floor(x.t / 864e5) * 864e5) || 0;
    for (const p of pos) {
      if (!p.alive) continue;
      const fee = p.qty * x.c * fr; p.margin -= fee; fundingPaid += fee;
      if (p.margin + p.qty * (x.l - p.entry) <= MMR * p.qty * x.l) {
        p.alive = false; liqLoss += MARGIN; liqCount['x' + p.lev] = (liqCount['x' + p.lev] || 0) + 1;
        if (replace && i < lastInvestIdx) pending.push({ slot: p.slot, lev: ladder[Math.min(ladder.indexOf(p.lev) + 1, ladder.length - 1)] });
      }
    }
  }
  const hx = candles[harvestIdx];
  let value = 0, alive = 0;
  for (const p of pos) if (p.alive) { alive++; value += Math.max(0, p.margin + p.qty * (hx.c - p.entry) - p.qty * hx.c * FEE); }
  // titik terburuk selama perjalanan (nilai semua posisi hidup vs total setoran sampai hari itu) -- dihitung ulang ringan
  return { deposited, value, alive, total: pos.length, liqCount, replaced, liqLoss, fundingPaid, startPrice: candles[0].o, harvestPrice: hx.c, harvestDate: new Date(hx.t).toISOString().slice(0, 10), lastInvestDate: new Date(candles[lastInvestIdx].t).toISOString().slice(0, 10), endInvestPrice: candles[lastInvestIdx].c };
}

const pct = (a, b) => { const r = (a / b - 1) * 100; return (r >= 0 ? '+' : '') + r.toFixed(0) + '%'; };
const D = (t) => new Date(t).toISOString().slice(0, 10);

(async () => {
  const data = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : await fetchData();
  const candles = data.c;
  const fDay = new Map();
  for (const [t, r] of data.f) { const k = Math.floor(t / 864e5) * 864e5; fDay.set(k, (fDay.get(k) || 0) + r); }
  console.log(`Data perp BTCUSDT: ${candles.length} hari ${D(candles[0].t)} -> ${D(candles.at(-1).t)}, funding ${data.f.length} catatan`);
  const fromBottom = candles.slice(candles.findIndex((c) => c.t >= BOTTOM));
  const halvingDays = Math.round((HALVING - BOTTOM) / 864e5) + 1;
  for (const [nama, days] of [['UJI 1: 1000 hari dari bottom 2022', 1000], [`UJI 2: bottom 2022 -> halving (${halvingDays} hari)`, halvingDays]]) {
    console.log(`\n=== ${nama} ===`);
    for (const [label, ladder, replace] of [['Tangga x3->x5->x7->x9 (ide Olan)', LADDER, true], ['x3 tanpa ganti', [3], false], ['x1 (tanpa leverage)', [1], false]]) {
      const r = simulate(fromBottom, fDay, days, ladder, replace);
      if (!r) { console.log(`${label}: data belum cukup`); continue; }
      console.log(`${label.padEnd(33)} setor $${r.deposited} -> panen $${r.value.toFixed(0)} (${pct(r.value, r.deposited)}) | rugi likuidasi $${r.liqLoss} (${JSON.stringify(r.liqCount)}) | funding dibayar $${r.fundingPaid.toFixed(0)} | hidup ${r.alive}/${r.total}`);
      if (replace) console.log(`  harga mulai $${r.startPrice.toFixed(0)} | setoran terakhir ${r.lastInvestDate} $${r.endInvestPrice.toFixed(0)} | panen ${r.harvestDate} $${r.harvestPrice.toFixed(0)}`);
    }
  }
  // UJI 4 -- "deteksi bottom" TANPA tau masa depan: mulai pas window BEAR siklus halving berakhir
  // (halvingBearWindow.js, sama yang dipakai Sniper/Ranger). Data perp mulai 2019-09 -> cuma transisi
  // 2022-10-26 yang ketangkep; transisi berikutnya 2026-10-20 (calon start nyata).
  const { isBtcBearWindow } = require('../halvingBearWindow');
  console.log('\n=== UJI 4: mulai pas window BEAR halving berakhir (deteksi bottom otomatis, tanpa ngintip) ===');
  for (let k = 1; k < candles.length; k++) {
    if (isBtcBearWindow(new Date(candles[k - 1].t)) && !isBtcBearWindow(new Date(candles[k].t))) {
      const sub = candles.slice(k);
      const halvDays = Math.round((HALVING - candles[k].t) / 864e5) + 1;
      for (const [nm, days] of [['1000 hari', 1000], [`sampai halving (${halvDays} hari)`, halvDays]]) {
        for (const [label, ladder, replace] of [['tangga x3->x9', LADDER, true], ['x1', [1], false]]) {
          const r = simulate(sub, fDay, days, ladder, replace);
          if (!r) { console.log(`mulai ${D(candles[k].t)} ${nm} ${label}: data belum cukup`); continue; }
          console.log(`mulai ${D(candles[k].t)} $${r.startPrice.toFixed(0)} ${nm.padEnd(26)} ${label.padEnd(14)} setor $${r.deposited} -> panen ${r.harvestDate} $${r.value.toFixed(0)} (${pct(r.value, r.deposited)}) | rugi liq $${r.liqLoss} ${JSON.stringify(r.liqCount)} | funding $${r.fundingPaid.toFixed(0)}`);
        }
      }
    }
  }
  console.log(`window bear sekarang: ${isBtcBearWindow(new Date())} -- transisi ke BULL berikutnya ~2026-10-20`);

  for (const days of [1000, 500]) {
    console.log(`\n=== UJI 3: mulai BUKAN di bottom -- tiap kuartal, investasi ${days} hari, panen +30 hari ===`);
    for (let y = 2019; y <= 2025; y++) for (const m of [0, 3, 6, 9]) {
      const t0 = Date.UTC(y, m, 1);
      const k = candles.findIndex((c) => c.t >= t0);
      if (k < 0 || candles[k].t - t0 > 7 * 864e5) continue;
      const sub = candles.slice(k);
      const a = simulate(sub, fDay, days, LADDER, true), b = simulate(sub, fDay, days, [1], false);
      if (!a) continue;
      console.log(`${D(t0)} $${sub[0].o.toFixed(0).padStart(6)} -> panen ${a.harvestDate} $${a.harvestPrice.toFixed(0).padStart(6)} | tangga: setor $${a.deposited} panen $${a.value.toFixed(0)} (${pct(a.value, a.deposited)}), rugi liq $${a.liqLoss} ${JSON.stringify(a.liqCount)} | x1: ${pct(b.value, b.deposited)}`);
    }
  }
})();
