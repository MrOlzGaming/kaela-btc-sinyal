// Uji trialReport.js -- data palsu, gak ada WA asli. node trialReport.selftest.js
const assert = require('assert');
const { run, verdict, pfOf } = require('./trialReport');

const toLocal = (d) => new Date(new Date(d).getTime() + 8 * 3600e3);
const MONDAY = new Date('2026-10-12T02:00:00Z'); // Senin 10:00 WITA
const TUESDAY = new Date('2026-10-13T02:00:00Z');
const MONDAY_MIDNIGHT = new Date('2026-10-11T16:15:00Z'); // Senin 00:15 WITA

function harness(files, state = {}) {
  const sent = [], archive = { entries: new Set(), hasEntryToday: (t) => archive.entries.has(t), addOrReplaceDaily: (t) => archive.entries.add(t) };
  let st = state;
  return { sent, archive, deps: (now) => ({ now, read: (f) => files[f] || null, toLocal, archive, send: async (m) => sent.push(m), loadState: () => st, saveState: (s) => { st = s; } }), state: () => st };
}
const exJournal = (nets) => ({ signals: nets.length + 3, skipped: 1, stats: { demo: { wins: nets.filter((x) => x >= 0).length, losses: nets.filter((x) => x < 0).length, totalPnlUsd: nets.reduce((a, b) => a + b, 0) } }, history: nets.map((n, i) => ({ at: i, mode: 'demo', net: n })) });

const tests = [];
const test = (n, f) => tests.push([n, f]);

test('pfOf & verdict: lolos / gagal / belum meyakinkan', () => {
  assert.strictEqual(pfOf([2, -1]), 2);
  assert.ok(verdict([...Array(50)].map((_, i) => (i % 2 ? 2 : -1))).ok);
  assert.ok(/GAGAL/.test(verdict([...Array(50)].map((_, i) => (i % 2 ? 0.5 : -1))).text));
  // paruh 1 bagus (PF ~2,8), paruh 2 jelek (PF ~0,46): total PF 1,6 > 1,2 TAPI ada paruh < 1 -> belum meyakinkan
  const mixed = [...[...Array(25)].map((_, i) => (i % 2 ? 3 : -1)), ...[...Array(25)].map((_, i) => (i % 2 ? 0.5 : -1))];
  assert.ok(/BELUM/.test(verdict(mixed).text), verdict(mixed).text);
});

test('belum ada transaksi sama sekali -> Senin pun DIAM (anti-spam)', async () => {
  const h = harness({ 'ninja-exhaustion-journal.json': exJournal([]), 'ninja-mr-exec-journal.json': { stats: { demo: { wins: 0, losses: 0, totalPnlUsd: 0 } } } });
  await run(h.deps(MONDAY));
  assert.strictEqual(h.sent.length, 0);
});

test('ada transaksi -> rapor Senin 1x (rapi per baris), Selasa gak kirim, Senin yg sama gak dobel', async () => {
  const h = harness({ 'ninja-exhaustion-journal.json': exJournal([1, -0.5, 2]) });
  await run(h.deps(TUESDAY)); assert.strictEqual(h.sent.length, 0);
  await run(h.deps(MONDAY_MIDNIGHT)); assert.strictEqual(h.sent.length, 0, 'Senin 00:15 WITA jangan bunyiin grup tengah malam');
  await run(h.deps(MONDAY)); assert.strictEqual(h.sent.length, 1);
  assert.ok(/RAPOR UJI DEMO/.test(h.sent[0]) && /3 \/ 100/.test(h.sent[0]) && /— Kaela/.test(h.sent[0]), h.sent[0]);
  await run(h.deps(MONDAY)); assert.strictEqual(h.sent.length, 1, 'gak boleh dobel di hari yang sama');
});

test('Exhaustion tembus 100 transaksi -> tonggak + penilaian SEKALI aja', async () => {
  const nets = [...Array(100)].map((_, i) => (i % 2 ? 2 : -1));
  const h = harness({ 'ninja-exhaustion-journal.json': exJournal(nets) });
  await run(h.deps(TUESDAY));
  assert.strictEqual(h.sent.length, 1); assert.ok(/TONGGAK/.test(h.sent[0]) && /LOLOS/.test(h.sent[0]), h.sent[0]);
  await run(h.deps(TUESDAY));
  assert.strictEqual(h.sent.length, 1, 'tonggak cuma sekali');
});

(async () => {
  let ok = 0, fail = 0;
  for (const [n, f] of tests) { try { await f(); ok++; console.log('  OK  ', n); } catch (e) { fail++; console.log('  GAGAL', n, '--', e.message); } }
  console.log(`\n${ok} lolos, ${fail} gagal`);
  if (fail) process.exit(1);
})();
