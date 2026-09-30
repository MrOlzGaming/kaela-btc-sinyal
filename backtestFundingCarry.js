// backtestFundingCarry.js (30 Sep 2026) -- riset "funding rate carry" buat perluasan Nyopet ke
// timeframe < 4 jam. Latar: riset Ninja 30 Sep 2026 (BACKTEST-REGISTRY.md) nunjukin pola chart
// timeframe rendah punya PF gross ~1,1-1,2 tapi habis dimakan fee taker -- yang untung di timeframe
// rendah itu yang DIBAYAR struktur pasar, bukan yang nebak arah. Olan setuju lanjut ("silahkan").
//
// Strategi (delta-netral, GAK nebak arah BTC):
//   funding perp positif = long bayar short tiap 8 jam. Posisi: BELI spot + SHORT perp dengan
//   notional sama -> harga naik/turun saling netral, yang tersisa = funding yang diterima
//   dikurangi fee 4 kaki (spot beli/jual, perp buka/tutup) dan perubahan basis (selisih perp-spot).
//   Masuk kalau rata2 funding N periode terakhir (disetahunkan) >= ambang masuk, keluar kalau
//   < ambang keluar. Keputusan cuma pakai funding yang UDAH settle (gak ada look-ahead).
//
// Sumber data: Bybit v5 publik (funding history + kline linear & spot 1 jam) -- Bybit terverifikasi
// bisa diakses dari VPS Vultr (SYSTEM-MAP.md, liquidationListener.js), Binance futures diblokir
// di sana. Sesi cloud Claude juga butuh api.bybit.com di allowlist jaringan.
//
// Satuan: return per siklus dalam % NOTIONAL satu kaki. Modal yang kepake = notional spot +
// margin perp (notional / PERP_LEVERAGE) -> return atas modal = return notional / (1 + 1/lev).
// Pakai: node backtestFundingCarry.js [tahunMulai=2020]   (FUNDING_CACHE=/dir buat cache)

const fs = require('fs');
const path = require('path');

const BASE = 'https://api.bybit.com/v5/market';
const PERP_LEVERAGE = 2; // margin perp 50% notional -- jauh dari likuidasi walau BTC +40% sebelum rebalance
const FEE_SCENARIOS = {
  taker: { spot: 0.10, perp: 0.055 },  // % per sisi (Bybit non-VIP kasar)
  maker: { spot: 0.10, perp: 0.02 },   // spot tetap taker (konservatif), perp pakai limit
};

async function getJson(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url);
      if (r.ok) { const j = await r.json(); if (j.retCode === 0) return j.result; throw new Error(`retCode ${j.retCode} ${j.retMsg}`); }
      throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
    }
  }
  return null;
}

function cached(name, fn) {
  const dir = process.env.FUNDING_CACHE;
  const file = dir ? path.join(dir, name) : null;
  if (file && fs.existsSync(file)) return Promise.resolve(JSON.parse(fs.readFileSync(file, 'utf8')));
  return fn().then((data) => { if (file) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); } return data; });
}

// Funding history: API balikin 200 terbaru sebelum endTime -> jalan mundur.
async function fetchFunding(symbol, startTime, endTime) {
  const out = new Map();
  let end = endTime;
  while (end > startTime) {
    const res = await getJson(`${BASE}/funding/history?category=linear&symbol=${symbol}&startTime=${startTime}&endTime=${end}&limit=200`);
    const list = res.list || [];
    if (!list.length) break;
    for (const x of list) out.set(+x.fundingRateTimestamp, +x.fundingRate);
    const oldest = Math.min(...list.map((x) => +x.fundingRateTimestamp));
    if (oldest >= end) break;
    end = oldest - 1;
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([t, rate]) => ({ t, rate }));
}

// Kline 1 jam: map openTime -> close.
async function fetchCloses(category, symbol, startTime, endTime) {
  const out = new Map();
  let end = endTime;
  while (end > startTime) {
    const res = await getJson(`${BASE}/kline?category=${category}&symbol=${symbol}&interval=60&start=${startTime}&end=${end}&limit=1000`);
    const list = res.list || [];
    if (!list.length) break;
    for (const k of list) out.set(+k[0], +k[4]);
    const oldest = Math.min(...list.map((k) => +k[0]));
    if (oldest >= end) break;
    end = oldest - 1;
  }
  return out;
}

// Harga close candle 1 jam yang BERAKHIR tepat di/sebelum waktu t (candle openTime = t - 1 jam).
function priceAt(closes, t) {
  for (let back = 1; back <= 6; back++) { const v = closes.get(t - back * 3600e3); if (v !== undefined) return v; }
  return null;
}

function simulate(funding, perp, spot, { n, entryApr, exitApr }, fee) {
  const periodsPerYear = 3 * 365;
  const cycles = [];
  let pos = null;
  for (let k = n; k < funding.length; k++) {
    const { t, rate } = funding[k];
    // 1) kalau posisi kebuka SEBELUM settlement ini -> terima funding periode ini
    if (pos) pos.fundingPct += rate * 100;
    // 2) keputusan pakai rata2 N funding terakhir yang UDAH settle (termasuk yang barusan)
    const avg = funding.slice(k - n + 1, k + 1).reduce((a, b) => a + b.rate, 0) / n;
    const apr = avg * periodsPerYear * 100;
    const ps = priceAt(spot, t), pp = priceAt(perp, t);
    if (ps === null || pp === null) continue;
    if (!pos && apr >= entryApr) pos = { entryT: t, spot0: ps, perp0: pp, fundingPct: 0 };
    else if (pos && apr < exitApr) {
      const spotPct = (ps / pos.spot0 - 1) * 100;
      const perpPct = -(pp / pos.perp0 - 1) * 100; // short perp
      const feePct = 2 * fee.spot + 2 * fee.perp;
      cycles.push({ entryT: pos.entryT, exitT: t, fundingPct: pos.fundingPct, basisPct: spotPct + perpPct, feePct, netPct: pos.fundingPct + spotPct + perpPct - feePct, days: (t - pos.entryT) / 864e5 });
      pos = null;
    }
  }
  return cycles;
}

const f2 = (x, d = 2) => (x === undefined || x === null || !isFinite(x) ? String(x) : x.toFixed(d));

async function main() {
  const startYear = Number(process.argv[2] || 2020);
  const startTime = Date.UTC(startYear, 0, 1), endTime = Date.now();
  const tag = `${startYear}-${Math.floor(endTime / 864e5)}`;
  console.log(`[FundingCarry] Fetch Bybit BTCUSDT funding + kline 1h perp & spot, ${startYear} s/d sekarang...`);
  const funding = await cached(`bybit-funding-${tag}.json`, () => fetchFunding('BTCUSDT', startTime, endTime));
  const perp = new Map(await cached(`bybit-perp1h-${tag}.json`, async () => [...(await fetchCloses('linear', 'BTCUSDT', startTime, endTime)).entries()]));
  const spot = new Map(await cached(`bybit-spot1h-${tag}.json`, async () => [...(await fetchCloses('spot', 'BTCUSDT', startTime, endTime)).entries()]));
  const years = (endTime - Math.max(startTime, funding[0].t)) / (365 * 864e5);
  console.log(`funding ${funding.length} periode (${new Date(funding[0].t).toISOString().slice(0, 10)} s/d ${new Date(funding[funding.length - 1].t).toISOString().slice(0, 10)}), perp ${perp.size} jam, spot ${spot.size} jam`);
  const allAvg = funding.reduce((a, b) => a + b.rate, 0) / funding.length;
  console.log(`rata2 funding seluruh periode: ${f2(allAvg * 100, 4)}%/8 jam = ${f2(allAvg * 1095 * 100, 1)}%/tahun (disetahunkan), periode negatif ${f2(funding.filter((x) => x.rate < 0).length / funding.length * 100, 1)}%`);

  const capitalFactor = 1 + 1 / PERP_LEVERAGE;
  for (const [feeName, fee] of Object.entries(FEE_SCENARIOS)) {
    console.log(`\n=== fee ${feeName} (spot ${fee.spot}%/sisi, perp ${fee.perp}%/sisi -> ${f2(2 * fee.spot + 2 * fee.perp)}% per siklus) ===`);
    for (const n of [3, 9, 21]) for (const entryApr of [5, 10, 20]) for (const exitApr of [0, 5]) {
      if (exitApr >= entryApr) continue;
      const cyc = simulate(funding, perp, spot, { n, entryApr, exitApr }, fee);
      if (!cyc.length) { console.log(`n=${n} masuk>=${entryApr}% keluar<${exitApr}%: 0 siklus`); continue; }
      const net = cyc.reduce((a, c) => a + c.netPct, 0);
      const fund = cyc.reduce((a, c) => a + c.fundingPct, 0);
      const basis = cyc.reduce((a, c) => a + c.basisPct, 0);
      const feeTot = cyc.reduce((a, c) => a + c.feePct, 0);
      const daysIn = cyc.reduce((a, c) => a + c.days, 0);
      const perYear = {};
      for (const c of cyc) { const y = new Date(c.exitT).getUTCFullYear(); perYear[y] = (perYear[y] || 0) + c.netPct; }
      const half = Math.floor(cyc.length / 2);
      const sumNet = (a) => a.reduce((x, c) => x + c.netPct, 0);
      console.log(`n=${String(n).padStart(2)} masuk>=${String(entryApr).padStart(2)}% keluar<${exitApr}% | siklus=${String(cyc.length).padStart(3)} di-pasar ${f2(daysIn / (years * 365) * 100, 0)}% waktu `
        + `| funding ${f2(fund, 1)}% basis ${f2(basis, 1)}% fee -${f2(feeTot, 1)}% NET ${f2(net, 1)}% notional `
        + `= ${f2(net / capitalFactor / years, 1)}%/thn atas modal | menang ${cyc.filter((c) => c.netPct > 0).length}/${cyc.length} `
        + `| paruh ${f2(sumNet(cyc.slice(0, half)), 1)}/${f2(sumNet(cyc.slice(half)), 1)} | thn ${Object.entries(perYear).map(([y, v]) => `${y}:${f2(v, 1)}`).join(' ')}`);
    }
  }
}

if (require.main === module) main().catch((e) => { console.error('ERROR backtestFundingCarry.js:', e.message); process.exit(1); });

module.exports = { simulate, fetchFunding, fetchCloses };
