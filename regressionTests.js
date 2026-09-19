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
const { getExposure, hitung } = require('./calculator');
const { positionTypeFor, openSideFor, closeSideFor } = require('./mexcExecutor');
const { createLedgerState, totalWealth, computeBetSizing, applyTradeResult, checkAndRolloverCycle } = require('./secureCompoundLedger');
const { formatManualOpenAutoClosed } = require('./darkKaelaLog');
const { computeSplit, WALLETS, CAP_PER_WALLET } = require('./monthlyFundingReminder');

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

  // getExposure -- ground truth persis dari tabel di header calculator.js (titik peralihan
  // paling rawan salah ketuker adalah TEPAT di $10.000, sengaja dites presisi di situ).
  await test('getExposure: titik peralihan bracket (ground truth tabel calculator.js)', () => {
    assert.strictEqual(getExposure(9999), 1.5, 'Modal $9.999 harus masih di bracket 1,5x');
    assert.strictEqual(getExposure(10000), 0.75, 'Modal PERSIS $10.000 harus udah pindah ke 0,75x');
    assert.strictEqual(getExposure(99999), 0.75, 'Modal $99.999 harus masih di bracket 0,75x');
    assert.strictEqual(getExposure(100000), 0.375, 'Modal PERSIS $100.000 harus udah pindah ke 0,375x');
  });

  // `hitung` direction-aware sizing (14 Sep 2026, permintaan Olan: "kalo short exposurenya
  // separuh dari long") -- exposure/nilaiPosisi/margin short HARUS PERSIS separuh long (modal+SL
  // jarak sama), leverage TETAP SAMA (rasio nilaiPosisi/margin gak berubah, cuma UKURAN
  // total-nya yang lebih kecil). Caller LAMA yang gak pernah kirim `direction` (kalkulator
  // manual, backtest) HARUS zero perubahan perilaku (backward-compat).
  await test('calculator hitung(): direction sell -> exposure/nilaiPosisi/margin separuh long, leverage sama', () => {
    const long = hitung({ modal: 1000, entry: 77000, stopLoss: 75000, direction: 'buy' });
    const short = hitung({ modal: 1000, entry: 77000, stopLoss: 79000, direction: 'sell' });
    const noDir = hitung({ modal: 1000, entry: 77000, stopLoss: 75000 });
    assert.strictEqual(short.exposure, long.exposure / 2, 'Exposure short harus PERSIS separuh long');
    assert.strictEqual(short.nilaiPosisi, long.nilaiPosisi / 2, 'Nilai posisi short harus PERSIS separuh long');
    assert.strictEqual(short.margin, long.margin / 2, 'Margin short harus PERSIS separuh long');
    assert.strictEqual(short.leverage, long.leverage, 'Leverage HARUS SAMA (bukan exposure yang diubah rasionya, cuma ukuran total)');
    assert.deepStrictEqual(noDir, long, '`direction` gak dioper (caller lama) harus ZERO beda dari buy eksplisit');
  });

  // positionTypeFor/openSideFor/closeSideFor -- konsolidasi (14 Sep 2026) dari ternary yang
  // sebelumnya tersebar di mexcExecutor.js internal + 5 titik pemanggil (BUG-KAELATRADE-0007
  // closeSide kebalik, BUG-KAELATRADE-0009 positionType ke-skip buat SHORT). Ground truth
  // dikonfirmasi LIVE lewat tes MEXC beneran (buka/tutup LONG+SHORT XAUUSDC) malam ini.
  await test('mexcExecutor direction mapping: buy -> long/open-long/close-long', () => {
    assert.strictEqual(positionTypeFor('buy'), 1, 'buy harus positionType 1 (long)');
    assert.strictEqual(openSideFor('buy'), 1, 'buy harus openSide 1 (open long)');
    assert.strictEqual(closeSideFor('buy'), 4, 'buy harus closeSide 4 (close long) -- ini yang kebalik di BUG-0007');
  });

  await test('mexcExecutor direction mapping: sell -> short/open-short/close-short', () => {
    assert.strictEqual(positionTypeFor('sell'), 2, 'sell harus positionType 2 (short)');
    assert.strictEqual(openSideFor('sell'), 3, 'sell harus openSide 3 (open short)');
    assert.strictEqual(closeSideFor('sell'), 2, 'sell harus closeSide 2 (close short) -- ini yang kebalik di BUG-0007');
  });

  // secureCompoundLedger.js -- money management "Secure/Compound + Target 2x" (18-19 Sep 2026,
  // permintaan Olan, REVISI v3 setelah v1/v2 SAMA-SAMA kebukti flaw struktural di backtest --
  // Trading Capital gak pernah diisi ulang dari menang -- lihat RESEARCH-LOG.md 2026-09-19 &
  // catatan panjang di secureCompoundLedger.js). v3: tiap WIN split 3 arah -- 50% Trading
  // Capital (FIX BARU: "isi separuh profit balik ke trading capital"), 25% Secure, 25% Compound
  // (compound TETAP akumulatif kayak v2).
  await test('secureCompoundLedger v3: split 3 arah (50% TC / 25% Secure / 25% Compound), TC keisi ulang dari WIN', () => {
    let state = createLedgerState(100);
    assert.strictEqual(totalWealth(state), 100);

    state = applyTradeResult(state, { pnlUsd: 10 }); // Trade1 WIN, profit $10 -> TC+5, secure+2.5, compound+2.5
    assert.strictEqual(state.tradingCapital, 105, 'Trade1 WIN: Trading Capital harus NAIK jadi 105 (100+5) -- INI FIX v3, beda dari v1/v2 yang diam');
    assert.strictEqual(state.secure, 2.5, 'Trade1 WIN: secure harus 2.5 (25% dari profit $10)');
    assert.strictEqual(state.activeCompound, 2.5, 'Trade1 WIN: compound harus 2.5 (25% dari profit $10)');

    state = applyTradeResult(state, { pnlUsd: 12 }); // Trade2 WIN, profit $12 -> TC+6, secure+3, compound+3
    assert.strictEqual(state.tradingCapital, 111, 'Trade2 WIN: Trading Capital harus 111 (105+6)');
    assert.strictEqual(state.secure, 5.5, 'Trade2 WIN: secure kumulatif harus 5.5 (2.5+3)');
    assert.strictEqual(state.activeCompound, 5.5, 'Trade2 WIN: compound NUMPUK jadi 5.5 (2.5+3), BUKAN replace jadi 3 doang');

    // Trade3 -- cek sizing SEBELUM di-apply: nilaiPosisi harus = kalkulator(TC=111) + compound(5.5).
    const opts = { entry: 65000, stopLoss: 63700, direction: 'buy' };
    const base = hitung({ modal: 111, ...opts });
    const sizing = computeBetSizing(state, opts);
    assert.ok(Math.abs(sizing.nilaiPosisi - (base.nilaiPosisi + 5.5)) < 1e-9, `nilaiPosisi Trade3 harusnya kalkulator(${base.nilaiPosisi}) + compound(5.5) = ${base.nilaiPosisi + 5.5}, malah ${sizing.nilaiPosisi}`);

    // Trade3 -- LOSS. Deduction Trading Capital pakai BET FRESH dari hitungExposure() ASLI
    // (modal=tradingCapital SAAT INI=111, TANPA komponen compound) -- sisi LOSS TIDAK berubah
    // dari v2, lihat catatan panjang di secureCompoundLedger.js.
    const expectedFreshBet = hitung({ modal: 111, ...opts });
    state = applyTradeResult(state, { pnlUsd: -expectedFreshBet.margin, ...opts });
    assert.strictEqual(state.activeCompound, 0, 'Trade3 LOSS: compound harus direset ke 0 (numpukan ilang)');
    assert.ok(Math.abs(state.tradingCapital - (111 - expectedFreshBet.margin)) < 1e-9, `Trading Capital harusnya ${111 - expectedFreshBet.margin}, malah ${state.tradingCapital}`);
    assert.strictEqual(state.secure, 5.5, 'Secure TIDAK BOLEH kesentuh sama sekali pas LOSS');
  });

  await test('secureCompoundLedger v2: computeBetSizing -- activeCompound=0 PERSIS hitung() apa adanya', () => {
    const state = createLedgerState(500);
    const opts = { entry: 65000, stopLoss: 63700, direction: 'buy' };
    const result = computeBetSizing(state, opts);
    const expected = hitung({ modal: 500, ...opts });
    assert.strictEqual(result.nilaiPosisi, expected.nilaiPosisi);
    assert.strictEqual(result.leverage, expected.leverage);
    assert.strictEqual(result.margin, expected.margin);
    assert.strictEqual(result.usedCompound, false);
  });

  await test('secureCompoundLedger v2: computeBetSizing -- compound TAMBAHAN (bukan gantiin), short dibagi 2', () => {
    let state = createLedgerState(100);
    state = { ...state, activeCompound: 11 };
    const opts = { entry: 65000, stopLoss: 63700, direction: 'buy' };
    const base = hitung({ modal: 100, ...opts });
    const long = computeBetSizing(state, opts);
    assert.ok(Math.abs(long.nilaiPosisi - (base.nilaiPosisi + 11)) < 1e-9, 'Long: nilaiPosisi harus kalkulator(TC) + compound PENUH');
    assert.strictEqual(long.usedCompound, true);
    const shortOpts = { entry: 65000, stopLoss: 66300, direction: 'sell' };
    const shortBase = hitung({ modal: 100, ...shortOpts });
    const short = computeBetSizing(state, shortOpts);
    assert.ok(Math.abs(short.nilaiPosisi - (shortBase.nilaiPosisi + 5.5)) < 1e-9, 'Short: komponen compound-nya harus dibagi 2 (11/2=5.5), komponen kalkulator TETAP formula short normal (short=separuh long, dari calculator.js sendiri)');
    assert.strictEqual(short.margin, short.nilaiPosisi / short.leverage, 'Margin harus konsisten sama leverage yang dihitung ulang dari nyawa%');
  });

  await test('secureCompoundLedger: checkAndRolloverCycle -- target 2x tercapai vs belum', () => {
    const belum = { ...createLedgerState(100), tradingCapital: 100, secure: 80, activeCompound: 10 }; // totalWealth=190 < 200
    const r1 = checkAndRolloverCycle(belum);
    assert.strictEqual(r1.cycleClosed, false);
    assert.strictEqual(r1.state, belum, 'State gak diubah/dicopy kalau belum capai target');

    const capai = { ...createLedgerState(100), tradingCapital: 100, secure: 90, activeCompound: 20 }; // totalWealth=210 >= 200
    const r2 = checkAndRolloverCycle(capai);
    assert.strictEqual(r2.cycleClosed, true);
    assert.strictEqual(r2.state.startingWealth, 210, 'startingWealth siklus baru = totalWealth siklus lama');
    assert.strictEqual(r2.state.activeCompound, 0, 'activeCompound direset pas rollover');
    assert.strictEqual(r2.state.tradingCapital, 100, 'Trading Capital TIDAK direset pas rollover');
    assert.strictEqual(r2.state.secure, 90, 'Secure TIDAK direset pas rollover');
    assert.strictEqual(r2.state.cycleCount, 1);
    assert.strictEqual(r2.state.closedCycles.length, 1);
    assert.strictEqual(r2.cycleSummary.endingWealth, 210);
  });

  // formatManualOpenAutoClosed (19 Sep 2026, fitur "auto-close posisi non-Kaela" -- permintaan
  // Olan setelah insiden FOMC) -- pastiin PnL null (mis. MEXC, realizedPnlSince cuma dukung
  // Binance) TAMPIL JUJUR "gak kebaca", BUKAN dipoles jadi $0 (kesannya beneran impas).
  await test('darkKaelaLog: formatManualOpenAutoClosed -- PnL numerik vs null (jujur, bukan $0)', () => {
    const base = { exchangeBadge: '🟨 Binance', symbol: 'BTCUSDT', direction: 'buy', entryPrice: 65000, closePrice: 64800, leverage: 10, marginUsd: 100, nilaiPosisi: 1000 };
    const withPnl = formatManualOpenAutoClosed({ ...base, closePnlUsd: -20.5 }, null);
    assert.ok(withPnl.includes('20.5') || withPnl.includes('20,5'), `Harus tampilin PnL numerik -20.5, malah: ${withPnl}`);
    assert.ok(withPnl.includes('LANGSUNG DITUTUP OTOMATIS'), 'Harus jelas nyebut auto-closed');
    const nullPnl = formatManualOpenAutoClosed({ ...base, closePnlUsd: null }, null);
    assert.ok(nullPnl.includes('gak kebaca'), 'PnL null HARUS bilang jujur "gak kebaca", bukan pura-pura $0');
    assert.ok(!nullPnl.includes('$0.00') && !nullPnl.includes('$0,00'), 'PnL null JANGAN ditampilin sebagai $0 (menyesatkan, kesannya beneran impas)');
  });

  // monthlyFundingReminder.js (20 Sep 2026, kebijakan tetap setoran bulanan Olan -- lihat memori
  // project-kaela-monthly-funding.md) -- ground-truth 4 skenario yang udah diverifikasi manual
  // sebelum dipush: normal (semua di bawah cap), 1 capped (redistribusi proporsional 3 sisa),
  // cuma 1 dompet masih terbuka (dapet full $100), dan SEMUA capped (fallback ke spot).
  function mkBalances(overrides) { return WALLETS.map((w) => ({ ...w, balance: overrides[w.key] })); }

  await test('monthlyFundingReminder: semua dompet di bawah cap -> split tetap 30/40/20/10', () => {
    const split = computeSplit(mkBalances({ sniperBtc: 60, nyopetBtc: 80, sniperEmas: 40, nyopetEmas: 20 }));
    assert.strictEqual(split.mode, 'futures');
    assert.strictEqual(split.capped.length, 0);
    const byKey = Object.fromEntries(split.allocations.map((a) => [a.key, a.amount]));
    assert.strictEqual(byKey.sniperBtc, 30);
    assert.strictEqual(byKey.nyopetBtc, 40);
    assert.strictEqual(byKey.sniperEmas, 20);
    assert.strictEqual(byKey.nyopetEmas, 10);
  });

  await test('monthlyFundingReminder: Sniper BTC capped -> jatahnya kebagi proporsional 4:2:1 ke 3 sisa, total tetap $100', () => {
    const split = computeSplit(mkBalances({ sniperBtc: 1050, nyopetBtc: 500, sniperEmas: 300, nyopetEmas: 100 }));
    assert.strictEqual(split.mode, 'futures');
    assert.strictEqual(split.capped.length, 1);
    assert.strictEqual(split.capped[0].key, 'sniperBtc');
    const byKey = Object.fromEntries(split.allocations.map((a) => [a.key, a.amount]));
    assert.strictEqual(byKey.nyopetBtc, 57.14, 'proporsi 40/(40+20+10) dari $100');
    assert.strictEqual(byKey.sniperEmas, 28.57, 'proporsi 20/70 dari $100');
    assert.strictEqual(byKey.nyopetEmas, 14.29, 'proporsi 10/70 dari $100 + sisa pembulatan');
    const total = split.allocations.reduce((s, a) => s + a.amount, 0);
    assert.ok(Math.abs(total - 100) < 1e-9, `Total alokasi HARUS persis $100, malah $${total} (pembulatan bocor)`);
  });

  await test('monthlyFundingReminder: cuma 1 dompet belum capped -> dia dapet FULL $100', () => {
    const split = computeSplit(mkBalances({ sniperBtc: 1010, nyopetBtc: 1020, sniperEmas: 1005, nyopetEmas: 300 }));
    assert.strictEqual(split.mode, 'futures');
    assert.strictEqual(split.capped.length, 3);
    assert.strictEqual(split.allocations.length, 1);
    assert.strictEqual(split.allocations[0].key, 'nyopetEmas');
    assert.strictEqual(split.allocations[0].amount, 100);
  });

  await test('monthlyFundingReminder: SEMUA 4 dompet capped -> mode spot (10 koin), bukan futures', () => {
    const split = computeSplit(mkBalances({ sniperBtc: 1200, nyopetBtc: 1500, sniperEmas: 1050, nyopetEmas: 1010 }));
    assert.strictEqual(split.mode, 'spot');
    assert.strictEqual(split.capped.length, 4);
    assert.strictEqual(split.allocations.length, 0);
  });

  await test('monthlyFundingReminder: CAP_PER_WALLET tetap $1000 (kebijakan tetap, jangan geser diam-diam)', () => {
    assert.strictEqual(CAP_PER_WALLET, 1000);
  });

  console.log(`\n${passed} lolos, ${failed} gagal (dari ${todayIso.slice(0, 10)} test run)`);
  cleanupFixtureFile();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('ERROR regressionTests.js:', e.message); cleanupFixtureFile(); process.exit(1); });
