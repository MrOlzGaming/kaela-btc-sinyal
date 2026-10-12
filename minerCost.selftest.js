// Uji minerCost.js + baris laporan grup -- tanpa internet. node minerCost.selftest.js
const assert = require('assert');
const { computeMinerCost, minerCostLines, subsidyAt } = require('./minerCost');
const { generateGroupDaily } = require('./groupReport');
const tests = []; const test = (n, f) => tests.push([n, f]);

test('subsidi per halving: 50 / 25 / 12,5 / 6,25 / 3,125', () => {
  assert.deepStrictEqual([0, 210000, 420000, 630000, 840000, 970900].map(subsidyAt), [50, 25, 12.5, 6.25, 3.125, 3.125]);
});
test('hitungan 12 Okt 2026 (1.007 EH/s, fee 0,0125) -> listrik rata2 ~$53,5rb, all-in ~$75rb', () => {
  const mc = computeMinerCost({ hashrateHs: 1.007e21, feePerBlockBtc: 0.0125, height: 970900 });
  assert(Math.abs(mc.btcPerDay - 451.8) < 0.1, mc.btcPerDay);
  assert(Math.abs(mc.scenarios.rata2.elecUsd - 53500) < 300, mc.scenarios.rata2.elecUsd);
  assert(Math.abs(mc.scenarios.rata2.allInUsd - 74900) < 400);
  assert(mc.scenarios.murah.elecUsd < mc.scenarios.rata2.elecUsd && mc.scenarios.rata2.elecUsd < mc.scenarios.mahal.elecUsd);
});
test('baris laporan: arti berubah sesuai harga vs biaya', () => {
  const mc = computeMinerCost({ hashrateHs: 1.007e21, feePerBlockBtc: 0.0125, height: 970900 });
  assert(/untung tipis/.test(minerCostLines(mc, 84000)[0]));
  assert(/ZONA DASAR/.test(minerCostLines(mc, 60000)[0]));
  assert(/untung lebar/.test(minerCostLines(mc, 130000)[0]));
  assert(/bawah biaya LISTRIK/.test(minerCostLines(mc, 45000)[0]));
  assert.deepStrictEqual(minerCostLines(null, 84000), []);
});
test('laporan harian grup: baris ⛏️ nempel, dan kalau data gagal laporan tetap jadi', () => {
  const mc = computeMinerCost({ hashrateHs: 1.007e21, feePerBlockBtc: 0.0125, height: 970900 });
  const now = new Date('2026-10-12T00:00:00Z');
  const a = generateGroupDaily(now, 84216, 83000, { minerCost: mc });
  assert(/⛏️ Biaya produksi BTC/.test(a), a);
  const b = generateGroupDaily(now, 84216, 83000, {});
  assert(!/⛏️/.test(b) && /Bloomberg Mini/.test(b));
});

let ok = 0, fail = 0;
for (const [n, f] of tests) { try { f(); ok++; console.log(`  OK   ${n}`); } catch (e) { fail++; console.log(`  GAGAL ${n}\n       ${e.message}`); } }
console.log(`\n${ok} lolos, ${fail} gagal`); if (fail) process.exitCode = 1;
