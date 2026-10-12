// minerCost.js (12 Okt 2026) -- ⛏️ BIAYA PRODUKSI BTC (perkiraan), ditempel di laporan harian BTC grup (groupReport.js).
// Olan: "biaya produksi bitcoin bisa di logika? dan di kalkulasi otomatis? ... tempelkan di laporan harian btc".
// Rumus: biaya listrik per BTC = hashrate jaringan (TH/s) x efisiensi mesin (J/TH) x 24 jam x harga listrik ($/kWh) / BTC ditambang per hari
// (144 blok x (subsidi + fee rata2 per blok)). All-in (mesin, gaji, sewa) = listrik x allInMult.
// Hashrate & fee = DATA ASLI (mempool.space, cadangan blockstream buat tinggi blok). Efisiensi & harga listrik = ASUMSI
// (gak ada yang tau campuran mesin seluruh penambang) -> 3 skenario murah/rata2/mahal, angkanya di miner-cost-config.json
// (perbarui tiap tahun -- mesin makin efisien). Ini LANTAI KASAR, bukan sinyal: biaya ngikutin harga (harga naik -> mesin nambah).
const fs = require('fs');
const path = require('path');
const CONFIG_PATH = path.join(__dirname, 'miner-cost-config.json');
const EPOCH = 210000;
const DEF = {
  scenarios: { murah: { effJTH: 17, kwhUsd: 0.04 }, rata2: { effJTH: 20, kwhUsd: 0.05 }, mahal: { effJTH: 25, kwhUsd: 0.07 } },
  allInMult: 1.4,
};
function loadConfig() { try { return { ...DEF, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; } catch { return DEF; } }
const subsidyAt = (height) => 50 / Math.pow(2, Math.floor(height / EPOCH));

// murni (gampang diuji): hashrateHs (H/s), feePerBlockBtc, height -> biaya per skenario
function computeMinerCost({ hashrateHs, feePerBlockBtc = 0, height }, cfg = loadConfig()) {
  const TH = hashrateHs / 1e12;
  const btcPerDay = 144 * (subsidyAt(height) + feePerBlockBtc);
  const out = { hashrateEH: hashrateHs / 1e18, btcPerDay, subsidy: subsidyAt(height), feePerBlockBtc, scenarios: {} };
  for (const [k, s] of Object.entries(cfg.scenarios)) {
    const elec = (TH * s.effJTH * 24 / 1000) * s.kwhUsd / btcPerDay; // kWh/hari x $/kWh / BTC/hari
    out.scenarios[k] = { ...s, elecUsd: elec, allInUsd: elec * cfg.allInMult };
  }
  out.allInMult = cfg.allInMult;
  return out;
}

async function getJson(url) { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); }

async function fetchMinerCost() {
  const h = await getJson('https://mempool.space/api/v1/mining/hashrate/1w');
  if (!(h && h.currentHashrate > 0)) throw new Error('hashrate gak kebaca');
  let fee = 0;
  try { const f = await getJson('https://mempool.space/api/v1/mining/blocks/fees/24h'); if (Array.isArray(f) && f.length) fee = f.reduce((a, b) => a + (Number(b.avgFees) || 0), 0) / f.length / 1e8; } catch {}
  let height;
  try { height = await getJson('https://mempool.space/api/blocks/tip/height'); } catch { height = await getJson('https://blockstream.info/api/blocks/tip/height'); }
  return computeMinerCost({ hashrateHs: h.currentHashrate, feePerBlockBtc: fee, height: Number(height) });
}

const k$ = (v) => `$${Math.round(v / 1000)}rb`;
// baris laporan (null-safe)
function minerCostLines(mc, priceToday) {
  if (!mc || !mc.scenarios || !mc.scenarios.rata2) return [];
  const m = mc.scenarios.rata2, lo = mc.scenarios.murah, hi = mc.scenarios.mahal;
  const r = priceToday / m.elecUsd, rAll = priceToday / m.allInUsd;
  // Ambang dari cek sejarah (12 Okt 2026, hashrate mempool 2017-26 + kurva efisiensi kasar, listrik $0,05): DASAR bear
  // 2018 (1,22x), crash Mar 2020 (1,24x), 2022 (1,05-1,14x) semua di 1,0-1,25x biaya listrik. Tapi 1,0-1,25x juga kesentuh di luar dasar
  // (Sep 2024 1,11x, Des 2025 1,14x, Jun 2026 1,02x) -> ZONA murah, bukan titik dasar pasti. Puncak dulu 6-19x, puncak 2025 cuma 1,8x.
  let arti;
  if (r < 1) arti = 'di bawah biaya LISTRIK -- penambang rata2 rugi tiap BTC (zona stres ekstrem, kayak pas halving 2020)';
  else if (r < 1.25) arti = 'ZONA DASAR historis (dasar bear 2018/2020/2022 di 1,05-1,24x) -- murah, tapi bukan jaminan langsung mantul';
  else if (rAll < 1.5) arti = 'penambang untung tipis-sedang';
  else arti = 'penambang untung lebar -- jauh dari lantai biaya';
  return [
    `⛏️ Biaya produksi BTC (perkiraan): ~${k$(m.elecUsd)} listrik / ~${k$(m.allInUsd)} all-in -- harga ${r.toFixed(2).replace(".", ",")}x biaya listrik, ${arti}`,
    `   (kisaran listrik ${k$(lo.elecUsd)}-${k$(hi.elecUsd)} tergantung mesin & tarif; hashrate ${Math.round(mc.hashrateEH)} EH/s, ~${Math.round(mc.btcPerDay)} BTC/hari)`,
  ];
}

module.exports = { computeMinerCost, fetchMinerCost, minerCostLines, subsidyAt, loadConfig };

if (require.main === module) fetchMinerCost().then((mc) => { console.log(JSON.stringify(mc, null, 2)); }).catch((e) => { console.error(e.message); process.exitCode = 1; });
