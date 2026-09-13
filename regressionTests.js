// regressionTests.js -- Solusi #3 (13 Sep 2026, dari "kamu ada kritik buat sistem kita sendiri?"
// -> "ada kritik ada solusi.. minta saran" -> Olan: "kerjakan nomor 2 dulu\nlalu 3"). Kritik #3:
// sistem gak punya test regresi -- bug KRITIS tranId-dedup (lihat tradeHistoryStore.js baris 78-88)
// baru ketauan gara-gara Olan cross-check MANUAL ke app Binance, BUKAN kedeteksi otomatis, dan
// udah mencemari data sejak 4 Sep 2026 (9 hari) sebelum ketemu.
//
// TUJUAN: pakai kejadian NYATA hari ini sbg "ground truth" -- kalau ada perubahan kode di masa
// depan yang balikin lagi bug yang SAMA (atau serupa), test ini WAJIB gagal SEBELUM sempat push,
// bukan nunggu Olan nemu sendiri dari app Binance lagi.
//
// ⛔ Zero-dependency by design (lihat package.json) -- pakai `assert` bawaan Node, BUKAN
// jest/mocha. Jalanin manual: `node regressionTests.js` (exit code 0 = semua lolos, 1 = ada yang
// gagal). AMAN dijalanin lokal -- pakai mock client (gak pernah panggil API Binance asli) dan
// phone/mode fixture (`000TESTFIXTURE000`/`regression`) yang gak pernah dipakai akun nyata, file
// hasil test dihapus otomatis di akhir. TIDAK melanggar aturan "jangan exec live script di laptop"
// (feedback-no-local-live-script-test) -- itu soal script yang KIRIM WA/TRADING beneran, ini murni
// fungsi lokal (fs+logic), nol network call.

const assert = require('assert');
const fs = require('fs');
const tradeHistoryStore = require('./tradeHistoryStore');
const { detectStuck, parseTimestamp } = require('./checkExecutorStuck');

const FIXTURE_PHONE = '000TESTFIXTURE000';
const FIXTURE_MODE = 'regression';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  OK   ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL ${name}`);
    console.log(`       ${e.message}`);
    failed++;
  }
}

function makeMockClient(pages) {
  let call = 0;
  return {
    getIncomeHistory: async () => {
      const page = pages[call] || [];
      call++;
      return page;
    },
  };
}

function cleanupFixtureFile() {
  const filePath = tradeHistoryStore.storePath('binance', FIXTURE_PHONE, FIXTURE_MODE);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

async function main() {
  console.log('=== Regresi tradeHistoryStore.js -- ground truth: insiden tranId 13 Sep 2026 ===\n');

  // Angka fixture ini BUKAN acak -- reproduksi PERSIS mekanisme bug nyata 13 Sep 2026: Binance
  // ngasih `tranId` yang SAMA buat REALIZED_PNL + COMMISSION dari 1 fill (dikonfirmasi via raw
  // API waktu itu). Totalnya (+12.96136192) SAMA PERSIS sama angka yang Olan konfirmasi cocok ke
  // kalender PnL app Binance-nya sendiri hari itu -- ini "ground truth" beneran, bukan direka.
  const now = new Date();
  const todayIso = now.toISOString();
  const FIXTURE_RAW = [
    { tranId: 555001, incomeType: 'REALIZED_PNL', symbol: 'BTCUSDC', income: '15.00000000', time: now.getTime() - 3 * 3600000 },
    { tranId: 555001, incomeType: 'COMMISSION', symbol: 'BTCUSDC', income: '-2.50000000', time: now.getTime() - 3 * 3600000 },
    { tranId: 555002, incomeType: 'REALIZED_PNL', symbol: 'BTCUSDC', income: '0.50000000', time: now.getTime() - 1 * 3600000 },
    { tranId: 555002, incomeType: 'COMMISSION', symbol: 'BTCUSDC', income: '-0.03863808', time: now.getTime() - 1 * 3600000 },
    { tranId: 555003, incomeType: 'TRANSFER', symbol: 'BTCUSDC', income: '100.00000000', time: now.getTime() - 30 * 60000 }, // setor dana, HARUS dikecualikan dari PnL
  ];
  const EXPECTED_PNL = 12.96136192;

  await test('mergeEntries TIDAK menimpa REALIZED_PNL dengan COMMISSION walau tranId sama (bug tranId asli)', () => {
    const store = { entries: [], lastSyncedMs: 0 };
    const normalized = FIXTURE_RAW.map((r) => ({ id: `${r.tranId}|${r.incomeType}`, time: Number(r.time), symbol: r.symbol, type: r.incomeType, amount: Number(r.income) || 0 }));
    const added = tradeHistoryStore.mergeEntries(store, normalized);
    assert.strictEqual(added, 5, `Harusnya 5 entry unik tersimpan (id komposit tranId+type), malah ${added}`);
    const realizedEntries = store.entries.filter((e) => e.type === 'REALIZED_PNL');
    assert.strictEqual(realizedEntries.length, 2, `Kedua REALIZED_PNL harus SELAMAT (bug lama: ketiban COMMISSION krn tranId sama), ketemu ${realizedEntries.length}`);
  });

  await test('REGRESI GUARD: kalau id balik cuma pakai tranId polos (skema bug lama), REALIZED_PNL kebukti HILANG', () => {
    // Ini BUKAN test fungsi produksi -- sengaja simulasi skema id BUGGY (tranId doang, tanpa
    // incomeType) buat BUKTIKAN kenapa fix-nya perlu, dan jaga2 kalau suatu saat ada yang "refactor"
    // id balik ke bentuk simpel tanpa sadar bahayanya.
    const buggyStore = { entries: [], lastSyncedMs: 0 };
    const buggyNormalized = FIXTURE_RAW.map((r) => ({ id: String(r.tranId), time: Number(r.time), symbol: r.symbol, type: r.incomeType, amount: Number(r.income) || 0 }));
    tradeHistoryStore.mergeEntries(buggyStore, buggyNormalized);
    const realizedEntries = buggyStore.entries.filter((e) => e.type === 'REALIZED_PNL');
    assert.strictEqual(realizedEntries.length, 0, 'Skema id lama SEHARUSNYA kehilangan kedua REALIZED_PNL (buat dokumentasi kenapa fix perlu) -- kalau ini gagal, berarti fixture perlu diupdate');
  });

  await test('todaysPnlForSymbol menghitung PnL BENAR (termasuk komisi, exclude TRANSFER) = ground truth insiden', () => {
    const store = { entries: [], lastSyncedMs: 0 };
    const normalized = FIXTURE_RAW.map((r) => ({ id: `${r.tranId}|${r.incomeType}`, time: Number(r.time), symbol: r.symbol, type: r.incomeType, amount: Number(r.income) || 0 }));
    tradeHistoryStore.mergeEntries(store, normalized);
    const pnl = tradeHistoryStore.todaysPnlForSymbol(store, 'BTCUSDC', now);
    assert.ok(Math.abs(pnl - EXPECTED_PNL) < 1e-8, `Harusnya ${EXPECTED_PNL}, malah ${pnl}`);
  });

  await test('syncIncomeStore (fungsi produksi asli, lewat mock client+paginasi) hasilkan angka yang SAMA', async () => {
    cleanupFixtureFile();
    // Halaman 1: 1000 baris dummy (beda tranId/symbol, biar gak ganggu hitungan) buat mancing loop
    // paginasi jalan (rawNew.length === 1000 -> lanjut ambil halaman berikutnya).
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      tranId: 900000 + i, incomeType: 'FUNDING_FEE', symbol: 'ETHUSDT', income: '0.00000001', time: now.getTime() - 6 * 3600000 + i,
    }));
    const page2 = FIXTURE_RAW; // < 1000 baris -> paginasi berhenti di sini
    const client = makeMockClient([page1, page2]);
    const store = await tradeHistoryStore.syncIncomeStore('binance', client, FIXTURE_PHONE, FIXTURE_MODE, now.getTime() - 24 * 3600000);
    assert.strictEqual(store.entries.length, 1005, `Harusnya 1000 dummy + 5 fixture = 1005, malah ${store.entries.length}`);
    const pnl = tradeHistoryStore.todaysPnlForSymbol(store, 'BTCUSDC', now);
    assert.ok(Math.abs(pnl - EXPECTED_PNL) < 1e-8, `syncIncomeStore end-to-end harusnya ${EXPECTED_PNL}, malah ${pnl}`);
    cleanupFixtureFile();
  });

  // 14 Sep 2026, insiden NYATA -- eksekutor VPS macet 6+ jam (19:32-01:41 WITA), 3+ siklus 15-menit
  // berturut-turut skip TANPA ada yang lapor sampai Olan sendiri nyadar "PnL Harian 0%" di web.
  // Test ini pakai POLA WAKTU PERSIS insiden asli sbg ground truth buat checkExecutorStuck.js.
  await test('parseTimestamp baca format log "[yyyy-MM-dd HH:mm:ss]" dengan benar', () => {
    const t = parseTimestamp('[2026-09-13 19:32:20] --- Run selesai ---');
    assert.strictEqual(new Date(t).getFullYear(), 2026);
    assert.strictEqual(new Date(t).getMonth(), 8); // 0-indexed, September
    assert.strictEqual(new Date(t).getDate(), 13);
    assert.strictEqual(parseTimestamp('baris tanpa timestamp'), null, 'Baris tanpa format [...] harus balikin null, bukan NaN/crash');
  });

  await test('detectStuck: 3 siklus berturut2 skip TANPA "Run mulai" -- TERDETEKSI macet (ground truth insiden 14 Sep)', () => {
    const base = new Date('2026-09-13T19:45:00').getTime();
    const heartbeats = [base, base + 15 * 60000, base + 30 * 60000]; // 19:45, 20:00, 20:15 -- persis pola insiden
    const execLines = [
      '[2026-09-13 19:32:20] --- Run selesai ---', // run TERAKHIR yang beneran jalan, SEBELUM window ini
      '[2026-09-13 19:45:01] Lock lagi kepegang (mungkin run sebelumnya masih jalan/macet) -- skip siklus ini.',
      '[2026-09-13 20:00:01] Lock lagi kepegang (mungkin run sebelumnya masih jalan/macet) -- skip siklus ini.',
    ];
    const { stuck, windowStart } = detectStuck(heartbeats, execLines);
    assert.strictEqual(stuck, true, 'Harusnya TERDETEKSI macet -- persis pola insiden nyata 14 Sep 2026');
    assert.strictEqual(windowStart, base);
  });

  await test('detectStuck: ADA "Run mulai" di tengah window -- SEHAT, gak dianggap macet', () => {
    const base = new Date('2026-09-14T02:00:00').getTime();
    const heartbeats = [base, base + 15 * 60000, base + 30 * 60000];
    const execLines = [
      '[2026-09-14 02:00:01] --- Run mulai ---', // run BENERAN jalan tepat di siklus pertama
      '[2026-09-14 02:00:15] --- Run selesai ---',
      '[2026-09-14 02:15:01] --- Run mulai ---',
      '[2026-09-14 02:15:14] --- Run selesai ---',
    ];
    const { stuck } = detectStuck(heartbeats, execLines);
    assert.strictEqual(stuck, false, 'Ada "Run mulai" dalam window -- HARUSNYA dianggap sehat, bukan macet');
  });

  await test('detectStuck: histori heartbeat kurang dari ambang -- gak nge-judge apa2 (wajar di awal)', () => {
    const { stuck, windowStart } = detectStuck([Date.now(), Date.now() + 900000], []); // cuma 2, ambang 3
    assert.strictEqual(stuck, false);
    assert.strictEqual(windowStart, null, 'windowStart null nandain "belum cukup data", BEDA dari "sehat"');
  });

  console.log(`\n${passed} lolos, ${failed} gagal (dari ${todayIso.slice(0, 10)} test run)`);
  cleanupFixtureFile();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('ERROR regressionTests.js:', e.message); cleanupFixtureFile(); process.exit(1); });
