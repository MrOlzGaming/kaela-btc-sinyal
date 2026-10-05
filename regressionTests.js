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
const { formatManualOpenAutoClosed, formatAutoOpen, shortId, liquidationPrice, SYSTEM_LABEL, EXCHANGE_BADGE, KAELA_ACCESS_URL, SNIPER_WEB_URL, toSniperClubLink } = require('./darkKaelaLog');
const { formatTriggered: sniperFormatTriggered, formatClosed: sniperFormatClosed, formatPartialClosed: sniperFormatPartialClosed, isDemoFor: sniperIsDemoFor } = require('./sniperOrderLog');
const { nextVariantSignalId } = require('./ninjaTrader');
const { computeSplit, WALLETS, CAP_PER_WALLET } = require('./monthlyFundingReminder');
const { isInsufficientBalanceError } = require('./balanceAlert');
const { computeProgress } = require('./walletCapProgress');
const { upsertHistoryEntry, estimateMonthsToCap } = require('./walletCapHistory');
const { detectAnomaly } = require('./walletCapAnomalyWatch');
const { summarizeEvents, nearbyClusters, detectImbalance, updateBurstEpisode, BURST_THRESHOLD_USD: LIQ_BURST_THRESHOLD_USD } = require('./actionableLiquidityRadar');

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
  // ⛔ BUG NYATA ketemu+fix 27 Sep 2026 (regressionTests.js gagal sendiri pas dijalanin 01:24 UTC --
  // `todaysPnlForSymbol` day-boundary SENGAJA pakai UTC (lihat komentar di tradeHistoryStore.js),
  // TAPI fixture di bawah pakai `new Date()` mentah lalu dikurangin sampai 3 jam -- begitu tes
  // kebetulan jalan dalam 3 jam pertama abis tengah malam UTC, entry tertua (now-3h) "kebawa" ke
  // HARI SEBELUMNYA, ke-exclude dari PnL "hari ini" -> hasil salah $12,50 lebih kecil dari
  // EXPECTED_PNL, PADAHAL kode produksinya BENAR (bukan bug beneran, murni fixture rapuh). Fix:
  // jangkar `now` di tengah hari UTC (12:00), kasih buffer 12 jam ke DUA arah -- offset fixture
  // terbesar di bawah (6 jam) gak akan pernah nyebrang hari apapun jam berapa tes ini dijalanin.
  const now = new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00.000Z');
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

  // Unifikasi desain pesan buka/tutup (25 Sep 2026, permintaan Olan "desain 1 aja yang terbaik
  // dan terlengkap") -- Sniper/Ranger/Ninja SEKARANG reuse formatAutoOpen/Partial/Closed yang SAMA
  // dari darkKaelaLog.js. Ground-truth: harga likuidasi LONG di bawah entry, SHORT di atas entry
  // (rumus 100/leverage%, sama persis yang tadinya cuma dipakai Sniper).
  // (5 Okt 2026) rumus dikurangi maintenance margin 0,5% -- 10x: jarak 9,5% (bukan 10%). Angka asli BingX 50x: entry 85.723,3
  // -> likuidasi 84.388,6 (jarak 1,557%); rumus baru 1,5% (84.437, sedikit lebih DEKAT = konservatif), rumus lama 2% (84.009).
  await test('liquidationPrice: LONG di bawah entry, SHORT di atas entry, null kalau data kosong, + maintenance margin', () => {
    assert.ok(Math.abs(liquidationPrice(100, 10, 'buy') - 90.5) < 1e-9);
    assert.ok(Math.abs(liquidationPrice(100, 10, 'sell') - 109.5) < 1e-9, 'SHORT harus ~109,5 (toleransi floating-point)');
    const real = 84388.6, est = liquidationPrice(85723.3, 50, 'buy');
    assert.ok(est > real && est - real < 0.001 * real, `50x: perkiraan ${est} harus sedikit di ATAS likuidasi asli ${real} (konservatif, selisih < 0,1%)`);
    assert.strictEqual(liquidationPrice(100, 0, 'buy'), null);
    assert.strictEqual(liquidationPrice(null, 10, 'buy'), null);
  });

  await test('shortId: signalId (Sniper) dipakai APA ADANYA, fallback ke digit-extraction (Ranger/Ninja)', () => {
    assert.strictEqual(shortId('ranger-demo-1758801234567'), '#234567');
    assert.strictEqual(shortId('anything', '2026092501'), '#2026092501');
  });

  await test('formatAutoOpen: nampilin baris Likuidasi + patternType diprioritasin drpd mode', () => {
    const pos = { id: 'x', direction: 'buy', entryPrice: 100, tp: 110, sl: 90, leverage: 10, marginUsd: 10, nilaiPosisi: 100, mode: 'sniper', patternType: 'flag_bull', assetLabel: 'BTC' };
    const msg = formatAutoOpen(pos, new Date(), '', false, null, '', null, EXCHANGE_BADGE.binance, SYSTEM_LABEL.SNIPER);
    assert.ok(msg.includes('Likuidasi: $90'), `Harus nampilin harga likuidasi, malah:\n${msg}`);
    // angka ASLI exchange (kalau caller ngasih) menang drpd rumus
    const msgReal = formatAutoOpen({ ...pos, liquidationPrice: 91.23 }, new Date(), '', false, null, '', null, EXCHANGE_BADGE.binance, SYSTEM_LABEL.SNIPER);
    assert.ok(msgReal.includes('Likuidasi: $91.23'), `Harus pakai likuidasi asli exchange:\n${msgReal}`);
    assert.ok(msg.includes('Bull Flag'), `Alasan harus dari patternType (flag_bull), bukan mode ('sniper'):\n${msg}`);
  });

  // 27 Sep 2026, koreksi Olan: trailing murni (tp null) labelnya "TP", BUKAN "TP1" -- gak ada
  // tahap 1, posisi ditutup sekali di invalidasi yang ikut gerak. "TP1" tetap buat exit 2-tahap.
  await test('formatAutoOpen: trailing murni (tp null) label "TP" bukan "TP1", exit 2-tahap tetap "TP1"', () => {
    const base = { id: 'x', entryPrice: 100, sl: 90, leverage: 10, marginUsd: 10, nilaiPosisi: 100, mode: 'channel_breakout', assetLabel: 'BTC' };
    const trailLong = formatAutoOpen({ ...base, direction: 'buy', tp: null }, new Date(), '', true, null, '', null, EXCHANGE_BADGE.binance, SYSTEM_LABEL.NINJA);
    assert.ok(!trailLong.includes('TP1'), `Trailing gak boleh ada "TP1":\n${trailLong}`);
    assert.ok(trailLong.includes('TP: trailing') && trailLong.includes('ikut naik'), `Trailing LONG harus "TP: trailing ... ikut naik":\n${trailLong}`);
    const trailShort = formatAutoOpen({ ...base, direction: 'sell', tp: null, sl: 110 }, new Date(), '', true, null, '', null, EXCHANGE_BADGE.binance, SYSTEM_LABEL.NINJA);
    assert.ok(trailShort.includes('ikut turun'), `Trailing SHORT harus "ikut turun":\n${trailShort}`);
    const twoStage = formatAutoOpen({ ...base, direction: 'buy', tp: 110 }, new Date(), '', true, null, '', null, EXCHANGE_BADGE.binance, SYSTEM_LABEL.SNIPER);
    assert.ok(twoStage.includes('TP1: $110'), `Exit 2-tahap tetap "TP1":\n${twoStage}`);
  });

  // Fee round-trip (26 Sep 2026, permintaan Olan "aku mau fee trading tampil juga, biar ketemu net
  // trading" -- MASTER_RULE_DYNAMIC_CANDLE_INVALIDATION Bagian 3-5+22). Ground-truth: status
  // ✅/❌ HARUS ikutin PnL BERSIH (net), bukan gross -- trade gross untung tapi abis fee jadi rugi
  // WAJIB tampil ❌, jangan sampai menyesatkan. Caller lama (gak kirim feeUsd) TETAP 1 baris PnL
  // apa adanya (backward-compat, zero regresi).
  await test('formatAutoClosed: fee round-trip -- status ikutin NET (bukan gross), backward-compat kalau feeUsd gak dikirim', () => {
    const { formatAutoClosed } = require('./darkKaelaLog');
    const grossWinNetLoss = formatAutoClosed({ id: 'x', direction: 'long', entryPrice: 84000, exitPrice: 84050, pnlUsd: 2, feeUsd: 6.75, pnlPct: 0.4 }, new Date(), false, 'Target Profit tercapai', null, null, '🟣 BingX', { emoji: '🥷', name: 'NINJA' });
    assert.ok(grossWinNetLoss.includes('❌'), `Gross untung ($2) tapi abis fee ($6.75) jadi rugi net -- HARUS ❌, malah:\n${grossWinNetLoss}`);
    assert.ok(grossWinNetLoss.includes('PnL Kotor: +$2'), 'Harus tampilin PnL Kotor apa adanya');
    assert.ok(grossWinNetLoss.includes('Fee (round-trip): -$6.75'), 'Harus tampilin fee round-trip');
    assert.ok(grossWinNetLoss.includes('PnL Bersih: *-$4.75*') || grossWinNetLoss.includes('PnL Bersih: *-$4.75'), `Net harusnya -$4.75 (2 - 6.75), malah:\n${grossWinNetLoss}`);

    const noFeeMsg = formatAutoClosed({ id: 'x', direction: 'long', entryPrice: 84000, exitPrice: 84500, pnlUsd: 12, pnlPct: 2.4 }, new Date(), false, 'Take Profit kena', null, null, '🟨 Binance', { emoji: '🏹', name: 'RANGER' });
    assert.ok(!noFeeMsg.includes('PnL Kotor') && !noFeeMsg.includes('Fee (round-trip)'), `Caller LAMA (gak kirim feeUsd) HARUS tetap 1 baris PnL polos, gak ada breakdown fee, malah:\n${noFeeMsg}`);
    assert.ok(noFeeMsg.includes('✅'), 'Tanpa fee, status ikutin gross apa adanya (satu-satunya angka yang ada)');
  });

  await test('sniperOrderLog: formatTriggered pakai template SAMA kayak Ranger/Ninja (badge SNIPER + signalId + likuidasi)', () => {
    const order = { id: 'abc123', signalId: '2026092501', asset: 'btc', mode: 'sniper', patternType: 'flag_bull', direction: 'buy', entryPrice: 64000, tp: 66000, sl: 62000, leverage: 20, marginUsd: 50 };
    const msg = sniperFormatTriggered(order, null);
    assert.ok(msg.includes('🎯 SNIPER'), 'Badge harus tetap SNIPER');
    assert.ok(msg.includes('#2026092501'), 'Harus pakai signalId manusiawi, bukan digit-extraction dari id');
    assert.ok(msg.includes('*Buka Posisi*'), 'Judul harus 1 desain SAMA persis kayak Ranger/Ninja');
    assert.ok(msg.includes('Likuidasi:'), 'Fitur likuidasi Sniper HARUS tetap ada setelah unifikasi');
  });

  await test('sniperOrderLog: formatPartialClosed nampilin detail breakeven+SMA (field trailSmaLen Sniper)', () => {
    const order = { id: 'abc123', signalId: '2026092501', asset: 'btc', direction: 'buy', entryPrice: 64000, realizedPnlUsd: 30, trailSmaLen: 10 };
    const msg = sniperFormatPartialClosed(order, null, null);
    assert.ok(msg.includes('SMA10'), `Harus nampilin SMA berapa hari (fitur ekstra Sniper), malah:\n${msg}`);
    assert.ok(msg.includes('BREAKEVEN ($64,000)'), 'Harus nampilin harga breakeven eksak');
  });

  // isDemoFor (26 Sep 2026, audit "pastikan semua tradingan real jalan" -- Olan konfirmasi "iya
  // real dari dulu, benerin labelnya aja") -- ground-truth: MEXC (Emas) SELALU real regardless
  // liveExecution, Binance (BTC) ikutin liveExecution.testnet, default AMAN (anggap demo) kalau
  // field itu gak ada (order lama pre-fix).
  await test('sniperOrderLog: isDemoFor -- MEXC selalu real, Binance ikutin liveExecution.testnet, default aman demo', () => {
    assert.strictEqual(sniperIsDemoFor({ asset: 'xau', liveExecution: { testnet: false } }), false, 'Emas/MEXC HARUS selalu real walau liveExecution bilang testnet:false eksplisit -- override, bukan dibaca apa adanya');
    assert.strictEqual(sniperIsDemoFor({ asset: 'xau' }), false, 'Emas/MEXC real walau liveExecution gak ada sama sekali');
    assert.strictEqual(sniperIsDemoFor({ asset: 'btc', liveExecution: { testnet: false } }), false, 'BTC real kalau liveExecution eksplisit bilang testnet:false');
    assert.strictEqual(sniperIsDemoFor({ asset: 'btc', liveExecution: { testnet: true } }), true, 'BTC demo kalau liveExecution eksplisit bilang testnet:true');
    assert.strictEqual(sniperIsDemoFor({ asset: 'btc' }), true, 'BTC default AMAN (anggap demo) kalau liveExecution gak ada -- order lama pre-fix');
  });

  await test('sniperOrderLog: formatClosed nampilin win-rate+akumulasi (formatWinRateLines shared) + alasan TP polos', () => {
    const order = { id: 'abc123', signalId: '2026092501', asset: 'btc', direction: 'buy', entryPrice: 64000, exitPrice: 66000, status: 'closed_tp', pnlUsd: 55, pnlPct: 110, closeReason: 'TP' };
    const msg = sniperFormatClosed(order, null, null);
    assert.ok(msg.includes('Win rate Sniper BTCUSDT'), `Harus reuse formatWinRateLines yang SAMA dipakai Ranger/Ninja, malah:\n${msg}`);
    assert.ok(msg.includes('Take Profit kena'), 'Alasan TP tunggal Sniper HARUS teks polos, BUKAN reuse CLOSE_REASON_LABEL.TP (itu teksnya "agregat kena", khusus basket Fed Dovish Grid)');
  });

  // 🐛 FIX 26 Sep 2026 (audit proaktif, permintaan Olan "beresin sekalian biar clean") -- label
  // win-rate Sniper SEBELUMNYA gak nyebut (Demo)/(Real) sama sekali (beda dari Ranger/Ninja/
  // rangerBtcDualExec.js/sniperBtcDualExec.js yang SEMUA udah misahin) -- stats-nya JUGA gabung
  // demo+real jadi 1 angka. Ground-truth: label WAJIB include mode yang bener SESUAI
  // liveExecution.testnet order yang lagi ditutup.
  await test('sniperOrderLog: formatClosed label win-rate SEKARANG include (Demo)/(Real), gak digabung', () => {
    const demoOrder = { id: 'd1', signalId: '2026092502', asset: 'btc', direction: 'buy', entryPrice: 64000, exitPrice: 66000, status: 'closed_tp', pnlUsd: 55, pnlPct: 110, closeReason: 'TP', liveExecution: { testnet: true } };
    const realOrder = { id: 'r1', signalId: '2026092503', asset: 'btc', direction: 'buy', entryPrice: 64000, exitPrice: 66000, status: 'closed_tp', pnlUsd: 55, pnlPct: 110, closeReason: 'TP', liveExecution: { testnet: false } };
    const demoMsg = sniperFormatClosed(demoOrder, null, null);
    const realMsg = sniperFormatClosed(realOrder, null, null);
    assert.ok(demoMsg.includes('Win rate Sniper BTCUSDT (Demo)'), `Order testnet:true harus label (Demo), malah:\n${demoMsg}`);
    assert.ok(realMsg.includes('Win rate Sniper BTCUSDT (Real)'), `Order testnet:false harus label (Real), malah:\n${realMsg}`);
  });

  // ninjaTrader.js: nextVariantSignalId (26 Sep 2026) -- Ninja journal gak nyimpen histori order
  // penuh kayak Sniper/Ranger (cuma floating+closedCount), jadi pakai counter kecil TERSENDIRI
  // (dailySignalSeq) buat format ID yang SAMA (dayKey+urutan). Ground-truth: urut naik dalam 1
  // hari, RESET ke 01 begitu dayKey ganti (WITA, bukan UTC polos).
  await test('ninjaTrader: nextVariantSignalId urut dalam 1 hari + reset begitu dayKey ganti', () => {
    const v = { dailySignalSeq: { dayKey: null, count: 0 } };
    const d1 = new Date('2026-09-26T01:00:00+08:00');
    assert.strictEqual(nextVariantSignalId(v, d1), '2026092601');
    assert.strictEqual(nextVariantSignalId(v, d1), '2026092602');
    const d2 = new Date('2026-09-27T01:00:00+08:00');
    assert.strictEqual(nextVariantSignalId(v, d2), '2026092701', 'Harus reset ke 01 begitu tanggalnya ganti, bukan lanjut 03');
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

  // balanceAlert.js (20 Sep 2026, gap ditemuin pas audit minimum funding) -- ground-truth: pesan
  // error ASLI yang beneran dilempar mexcExecutor.js/binanceExecutor.js pas order kekecilan,
  // WAJIB kedeteksi isInsufficientBalanceError() (jatuh ke info-fallback, bukan hilang senyap).
  await test('isInsufficientBalanceError: pre-check lokal MEXC ("kekecilan buat contractSize") kedeteksi', () => {
    assert.ok(isInsufficientBalanceError('Vol kehitung 0 buat XAUT_USDT (notional $2.50 kekecilan buat contractSize 0.001) -- order gak dikirim.'));
  });
  await test('isInsufficientBalanceError: pre-check lokal Binance ("kekecilan buat stepSize") TETAP kedeteksi (regresi lama)', () => {
    assert.ok(isInsufficientBalanceError('Quantity kehitung 0 buat BTCUSDT (notional $5.00 kekecilan buat stepSize 0.001) -- order gak dikirim.'));
  });
  await test('isInsufficientBalanceError: penolakan REMOTE Binance LOT_SIZE (-1013) kedeteksi', () => {
    assert.ok(isInsufficientBalanceError('{"code":-1013,"msg":"Filter failure: LOT_SIZE"}'));
  });
  await test('isInsufficientBalanceError: penolakan REMOTE Binance MIN_NOTIONAL (-4164) kedeteksi', () => {
    assert.ok(isInsufficientBalanceError('{"code":-4164,"msg":"Order\'s notional must be no smaller than 100"}'));
  });
  await test('isInsufficientBalanceError: error gak nyambung (mis. signature invalid) TETAP gak kedeteksi (no false-positive)', () => {
    assert.strictEqual(isInsufficientBalanceError('{"code":-1022,"msg":"Signature for this request is not valid."}'), false);
  });

  // walletCapProgress.js (20 Sep 2026, widget dashboard "progress ke cap $1000") -- ground-truth
  // pct sederhana + dua ujung penting: separuh jalan, dan LEWAT cap (harus dicap 100%, bukan
  // >100% -- bisa kejadian di antara siklus sebelum Olan sadar berhenti isi dompet yang udah full).
  await test('walletCapProgress: separuh cap -> 50.0%', () => {
    assert.strictEqual(computeProgress(500, CAP_PER_WALLET), 50);
  });
  await test('walletCapProgress: saldo lewat cap -> dicap 100%, gak boleh >100', () => {
    assert.strictEqual(computeProgress(1234.56, CAP_PER_WALLET), 100);
  });
  await test('walletCapProgress: pembulatan 1 desimal (contoh Nyopet BTC $40 dari $1000)', () => {
    assert.strictEqual(computeProgress(40, CAP_PER_WALLET), 4);
  });

  // upsertHistoryEntry (21 Sep 2026, grafik pertumbuhan Modal Futures Pool di Saham Saya) --
  // ground-truth: 1 titik/hari (siklus lain di hari SAMA REPLACE, bukan numpuk), hari BARU
  // APPEND, dan trim gak boleh ngelewatin MAX_HISTORY_ENTRIES (1095, dicek pakai array pendek
  // biar test-nya cepet -- logic trim sama persis independen dari ukuran cap-nya).
  await test('upsertHistoryEntry: siklus lain hari SAMA -> REPLACE titik terakhir, panjang gak nambah', () => {
    const history = [{ date: '2026-09-20', totalBalance: 100, totalCap: 4000 }];
    const next = upsertHistoryEntry(history, '2026-09-20', 150, 4000);
    assert.strictEqual(next.length, 1);
    assert.strictEqual(next[0].totalBalance, 150);
  });
  await test('upsertHistoryEntry: hari BARU -> APPEND, titik lama tetap ada', () => {
    const history = [{ date: '2026-09-20', totalBalance: 150, totalCap: 4000 }];
    const next = upsertHistoryEntry(history, '2026-09-21', 190, 4000);
    assert.strictEqual(next.length, 2);
    assert.strictEqual(next[0].date, '2026-09-20');
    assert.strictEqual(next[1].date, '2026-09-21');
  });
  await test('upsertHistoryEntry: array kosong -> jadi 1 titik pertama', () => {
    const next = upsertHistoryEntry([], '2026-09-21', 40, 4000);
    assert.deepStrictEqual(next, [{ date: '2026-09-21', totalBalance: 40, totalCap: 4000 }]);
  });
  await test('upsertHistoryEntry: udah penuh 1095 (~3 tahun harian) -> tetap 1095, titik TERTUA kebuang', () => {
    const full = Array.from({ length: 1095 }, (_, i) => ({ date: `day-${i}`, totalBalance: i, totalCap: 4000 }));
    const next = upsertHistoryEntry(full, 'day-BARU', 999, 4000);
    assert.strictEqual(next.length, 1095);
    assert.strictEqual(next[0].date, 'day-1'); // day-0 (paling tua) kebuang
    assert.strictEqual(next[next.length - 1].date, 'day-BARU');
  });

  // estimateMonthsToCap (21 Sep 2026, "berapa bulan lagi Modal Futures Pool penuh") -- ground-truth
  // sengaja pakai angka bulat biar gampang diverifikasi manual (30 hari, tumbuh $10/hari -> sisa
  // $300 butuh 30 hari = 1,0 bulan PERSIS).
  await test('estimateMonthsToCap: tren naik $10/hari, sisa $300 ke cap -> 1,0 bulan', () => {
    const history = [
      { date: '2026-08-22', totalBalance: 100, totalCap: 4000 },
      { date: '2026-09-21', totalBalance: 400, totalCap: 4000 }, // 30 hari, +300 -> $10/hari
    ];
    assert.strictEqual(estimateMonthsToCap(history, 3700, 4000), 1);
  });
  await test('estimateMonthsToCap: udah >= cap -> 0 (gak perlu histori sama sekali)', () => {
    assert.strictEqual(estimateMonthsToCap([], 4000, 4000), 0);
  });
  await test('estimateMonthsToCap: histori kurang dari 2 titik -> null (belum bisa diproyeksi)', () => {
    assert.strictEqual(estimateMonthsToCap([{ date: '2026-09-21', totalBalance: 100, totalCap: 4000 }], 100, 4000), null);
  });
  await test('estimateMonthsToCap: tren STAGNAN/TURUN -> null (jujur, jangan proyeksi ngasal)', () => {
    const history = [
      { date: '2026-08-22', totalBalance: 500, totalCap: 4000 },
      { date: '2026-09-21', totalBalance: 480, totalCap: 4000 }, // turun (rugi trading), bukan naik
    ];
    assert.strictEqual(estimateMonthsToCap(history, 480, 4000), null);
  });

  // detectAnomaly (21 Sep 2026, tripwire keamanan) -- ground-truth JAWABAN buat Olan "kalo turun
  // karena trading?": kerugian trading WAJAR (rugi 1 posisi SL kena, atau bahkan beberapa
  // sekaligus) HARUS tetap null, CUMA drop di luar nalar (>=50% DAN >=$50 absolut) yang nembak.
  await test('detectAnomaly: rugi trading wajar (turun 15%, ~1 posisi SL kena) -> null, BUKAN anomali', () => {
    const history = [
      { date: '2026-09-20', totalBalance: 1000, totalCap: 4000 },
      { date: '2026-09-21', totalBalance: 850, totalCap: 4000 }, // turun $150 (15%) -- wajar buat hari sial
    ];
    assert.strictEqual(detectAnomaly(history), null);
  });
  await test('detectAnomaly: turun drastis 60% ($1000->$400) -> KEDETEKSI anomali', () => {
    const history = [
      { date: '2026-09-20', totalBalance: 1000, totalCap: 4000 },
      { date: '2026-09-21', totalBalance: 400, totalCap: 4000 },
    ];
    const a = detectAnomaly(history);
    assert.ok(a);
    assert.strictEqual(a.drop, 600);
  });
  await test('detectAnomaly: persentase gede tapi absolut kecil ($40->$15, total masih kecil) -> null (floor $50)', () => {
    const history = [
      { date: '2026-09-20', totalBalance: 40, totalCap: 4000 },
      { date: '2026-09-21', totalBalance: 15, totalCap: 4000 }, // turun 62,5% TAPI cuma $25 absolut
    ];
    assert.strictEqual(detectAnomaly(history), null);
  });
  await test('detectAnomaly: saldo NAIK -> null (bukan drop sama sekali)', () => {
    const history = [
      { date: '2026-09-20', totalBalance: 1000, totalCap: 4000 },
      { date: '2026-09-21', totalBalance: 1200, totalCap: 4000 },
    ];
    assert.strictEqual(detectAnomaly(history), null);
  });
  await test('detectAnomaly: histori kurang dari 2 titik -> null (belum bisa dibandingin)', () => {
    assert.strictEqual(detectAnomaly([{ date: '2026-09-21', totalBalance: 100, totalCap: 4000 }]), null);
  });

  // actionableLiquidityRadar.js (21 Sep 2026, Fase 1 "forced-flow / liquidity analyst") --
  // ⛔ FIX 25 Sep 2026: ground-truth konvensi side DIBALIK (bug nyata ketemu -- lihat
  // feedback-bybit-liquidation-side-convention.md) -- Bybit allLiquidation `side` = POSISI ASLI
  // yang kelikuidasi (BUKAN arah order penutup ala Binance): 'BUY' = LONG kena force-close,
  // 'SELL' = SHORT kena force-close. summarizeEvents HARUS pisahin dua sisi bener, nearbyClusters
  // HARUS urutin dari yang PALING DEKAT ke harga sekarang (bukan yang paling BESAR).
  await test('summarizeEvents: pisahin notional LONG (BUY) vs SHORT (SELL) dengan bener', () => {
    const events = [
      { side: 'BUY', price: 80000, qty: 0.5 },  // LONG liquidated, notional $40.000
      { side: 'SELL', price: 80000, qty: 1 },   // SHORT liquidated, notional $80.000
      { side: 'BUY', price: 79000, qty: 0.1 },  // LONG liquidated, notional $7.900
    ];
    const r = summarizeEvents(events);
    assert.strictEqual(r.longUsd, 47900);
    assert.strictEqual(r.shortUsd, 80000);
    assert.strictEqual(r.longCount, 2);
    assert.strictEqual(r.shortCount, 1);
  });
  await test('nearbyClusters: arah "above" -- urut dari PALING DEKAT ke harga sekarang, bukan paling BESAR', () => {
    const heatmap = {
      '81000': { shortLiquidatedUsd: 500000 }, // paling BESAR, tapi paling JAUH
      '80250': { shortLiquidatedUsd: 100000 }, // paling DEKAT
      '80750': { shortLiquidatedUsd: 200000 },
      '79000': { shortLiquidatedUsd: 999999 }, // di BAWAH harga sekarang -- harus DIABAIKAN buat arah 'above'
    };
    const result = nearbyClusters(heatmap, 80000, 'above', 'shortLiquidatedUsd', 2);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].price, 80250); // paling dekat duluan
    assert.strictEqual(result[1].price, 80750);
  });
  await test('nearbyClusters: arah "below" -- urut dari PALING DEKAT (harga TERTINGGI di bawah current)', () => {
    const heatmap = {
      '78000': { longLiquidatedUsd: 300000 },
      '79500': { longLiquidatedUsd: 150000 }, // paling DEKAT ke 80000
      '81000': { longLiquidatedUsd: 999999 }, // di ATAS harga sekarang -- harus DIABAIKAN buat arah 'below'
    };
    const result = nearbyClusters(heatmap, 80000, 'below', 'longLiquidatedUsd', 5);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].price, 79500);
    assert.strictEqual(result[1].price, 78000);
  });
  await test('nearbyClusters: bucket dengan usd 0 gak ikut kehitung (belum pernah ada liquidation di situ)', () => {
    const heatmap = { '80250': { shortLiquidatedUsd: 0 }, '80500': { shortLiquidatedUsd: 50000 } };
    const result = nearbyClusters(heatmap, 80000, 'above', 'shortLiquidatedUsd');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].price, 80500);
  });

  // detectImbalance (21 Sep 2026, jalur B "jangan mangkrak" -- crowding SEBELUM ledakan) --
  // ground-truth: funding ekstrem SENDIRIAN gak cukup, WAJIB ada cluster historis "notable" DEKAT
  // harga di arah yang relevan. Dua syarat ini KEDUANYA harus kepenuhan, bukan salah satu.
  await test('detectImbalance: funding short-crowded + cluster short notable 3% di atas -> KEDETEKSI', () => {
    const heatmap = { '81000': { shortLiquidatedUsd: 600000 } }; // 1,25% di atas 80000, notable
    const r = detectImbalance(heatmap, 80000, -0.05); // funding di bawah threshold -0.03
    assert.ok(r);
    assert.strictEqual(r.side, 'short');
    assert.strictEqual(r.cluster.price, 81000);
  });
  await test('detectImbalance: funding ekstrem TAPI cluster kejauhan (>3%) -> null', () => {
    const heatmap = { '85000': { shortLiquidatedUsd: 900000 } }; // 6,25% di atas 80000, terlalu jauh
    assert.strictEqual(detectImbalance(heatmap, 80000, -0.05), null);
  });
  await test('detectImbalance: funding ekstrem TAPI cluster kekecilan (<$500rb) -> null', () => {
    const heatmap = { '81000': { shortLiquidatedUsd: 100000 } };
    assert.strictEqual(detectImbalance(heatmap, 80000, -0.05), null);
  });
  await test('detectImbalance: funding NORMAL (di antara 2 threshold) -> null walau cluster gede ada', () => {
    const heatmap = { '81000': { shortLiquidatedUsd: 900000 }, '79000': { longLiquidatedUsd: 900000 } };
    assert.strictEqual(detectImbalance(heatmap, 80000, 0.01), null);
  });
  await test('detectImbalance: funding long-crowded + cluster long notable di bawah -> KEDETEKSI', () => {
    const heatmap = { '79000': { longLiquidatedUsd: 700000 } }; // 1,25% di bawah 80000
    const r = detectImbalance(heatmap, 80000, 0.08); // di atas threshold 0.05
    assert.ok(r);
    assert.strictEqual(r.side, 'long');
    assert.strictEqual(r.cluster.price, 79000);
  });

  // updateBurstEpisode (21 Sep 2026, jalur C "kekeringan" -- Olan liat CoinGlass Liquidation Map,
  // mau deteksi versi REAL-nya) -- ground-truth: episode mulai pas burst nembak, TETAP nge-track
  // sisi yang SAMA walau sisi lain sempat lebih gede, exhausted CUMA sekali pas beneran anjlok
  // <=30% dari puncak, dan basi kalau kelamaan diem.
  await test('updateBurstEpisode: belum ada episode + burst di bawah threshold -> tetap null', () => {
    const r = updateBurstEpisode(null, { longUsd: 1000, shortUsd: 500 }, 1000);
    assert.strictEqual(r.episode, null);
    assert.strictEqual(r.exhausted, false);
  });
  await test('updateBurstEpisode: burst SHORT nembak -> episode BARU mulai, peak = burst awal', () => {
    const r = updateBurstEpisode(null, { longUsd: 0, shortUsd: LIQ_BURST_THRESHOLD_USD + 1 }, 1000);
    assert.ok(r.episode);
    assert.strictEqual(r.episode.side, 'short');
    assert.strictEqual(r.episode.peakUsd, LIQ_BURST_THRESHOLD_USD + 1);
    assert.strictEqual(r.exhausted, false);
  });
  await test('updateBurstEpisode: volume TETAP tinggi (>30% peak) -> episode LANJUT, belum exhausted', () => {
    const episode = { side: 'short', startedAt: 1000, peakUsd: 1000000 };
    const r = updateBurstEpisode(episode, { longUsd: 0, shortUsd: 500000 }, 2000); // 50% dari peak
    assert.ok(r.episode);
    assert.strictEqual(r.exhausted, false);
    assert.strictEqual(r.episode.peakUsd, 1000000); // peak gak turun cuma karena window ini lebih kecil
  });
  await test('updateBurstEpisode: volume anjlok <=30% peak -> EXHAUSTED, episode ditutup', () => {
    const episode = { side: 'short', startedAt: 1000, peakUsd: 1000000 };
    const r = updateBurstEpisode(episode, { longUsd: 0, shortUsd: 200000 }, 2000); // 20% dari peak
    assert.strictEqual(r.exhausted, true);
    assert.strictEqual(r.exhaustedSide, 'short');
    assert.strictEqual(r.episode, null); // episode ditutup, gak lanjut di-track lagi
  });
  await test('updateBurstEpisode: episode SELALU pantau sisi yang SAMA, walau sisi LAIN sempat lebih gede', () => {
    // Episode lagi track 'short'. Siklus ini LONG kebetulan gede banget, tapi short tetap tinggi
    // (masih di atas 30% peak) -- HARUS tetap ngukur short, bukan ke-distract sisi long.
    const episode = { side: 'short', startedAt: 1000, peakUsd: 1000000 };
    const r = updateBurstEpisode(episode, { longUsd: 5000000, shortUsd: 600000 }, 2000);
    assert.strictEqual(r.exhausted, false);
    assert.strictEqual(r.episode.side, 'short');
  });
  await test('updateBurstEpisode: episode basi (kelewat EPISODE_MAX_AGE_MS) -> dianggap gak ada, mulai fresh', () => {
    const oldEpisode = { side: 'short', startedAt: 1000, peakUsd: 1000000 };
    const farFuture = 1000 + 7 * 60 * 60 * 1000; // 7 jam kemudian, lewat EPISODE_MAX_AGE_MS (6 jam)
    const r = updateBurstEpisode(oldEpisode, { longUsd: 0, shortUsd: 100 }, farFuture); // volume kecil, di bawah threshold burst baru
    assert.strictEqual(r.episode, null);
    assert.strictEqual(r.exhausted, false); // BUKAN exhausted -- episode lama dianggap gak pernah ke-track lagi, bukan "ditutup exhausted"
  });

  // ============ goldTwinPosition.js (26 Sep 2026) ============
  // Modul ini BACA/TULIS file config+journal ASLI proyek (gold-twin-position-config.json/
  // -journal.json) -- WAJIB backup+restore SETELAH tiap test, biar `enabled:false` default aman
  // gak ke-timpa/rusak kalau ada test yang crash di tengah (config ini beneran ngontrol trading
  // real Emas kalau nanti enabled).
  {
    const fsGtp = require('fs');
    const pathGtp = require('path');
    const GTP_CONFIG = pathGtp.join(__dirname, 'gold-twin-position-config.json');
    const GTP_JOURNAL = pathGtp.join(__dirname, 'gold-twin-position-journal.json');
    const origConfig = fsGtp.existsSync(GTP_CONFIG) ? fsGtp.readFileSync(GTP_CONFIG, 'utf8') : null;
    const origJournal = fsGtp.existsSync(GTP_JOURNAL) ? fsGtp.readFileSync(GTP_JOURNAL, 'utf8') : null;
    function restoreGtpFiles() {
      if (origConfig !== null) fsGtp.writeFileSync(GTP_CONFIG, origConfig); else if (fsGtp.existsSync(GTP_CONFIG)) fsGtp.unlinkSync(GTP_CONFIG);
      if (origJournal !== null) fsGtp.writeFileSync(GTP_JOURNAL, origJournal); else if (fsGtp.existsSync(GTP_JOURNAL)) fsGtp.unlinkSync(GTP_JOURNAL);
      delete require.cache[require.resolve('./goldTwinPosition')];
    }

    try {
      fsGtp.writeFileSync(GTP_CONFIG, JSON.stringify({ enabled: true, allowReal: false }));
      if (fsGtp.existsSync(GTP_JOURNAL)) fsGtp.unlinkSync(GTP_JOURNAL);
      delete require.cache[require.resolve('./goldTwinPosition')];
      const gtp = require('./goldTwinPosition');
      const assetCfg = { execSymbol: 'XAUT_USDT', label: 'XAUUSDT' };
      const sig = { direction: 'buy', sl: 3900, patternType: 'flag_bull' };
      const noopNotify = async () => {};
      const closeMessages = [];
      const captureNotify = async (m) => { closeMessages.push(m); };

      await test('goldTwinPosition: buka posisi (paper) -- kedua leg keisi, invalidation awal bener', async () => {
        await gtp.openGoldTwinPosition({ system: 'ranger', assetCfg, sig, livePrice: 4000, mexcExec: null, notify: noopNotify, notifySilent: noopNotify, idrRate: 17800 });
        const j = gtp.loadJournal();
        assert.ok(j.ranger.floating, 'floating harusnya keisi abis open');
        assert.ok(j.ranger.floating.trailing && j.ranger.floating.fixedTp, 'dua-duanya leg harus keisi (paper mode, gak ada exec yang gagal)');
        assert.ok(Math.abs(j.ranger.floating.trailing.invalidation - 3896) < 1e-6, `invalidation awal harusnya 3896 (4000*(1-2.6%)), malah ${j.ranger.floating.trailing.invalidation}`);
      });

      await test('goldTwinPosition: REGRESI ratchet WAJIB persist walau belum ada leg yang exit', async () => {
        // Bug NYATA ketemu 26 Sep 2026 -- saveJournal() cuma kepanggil di jalur "ada leg exit",
        // jadi update extreme/invalidation dari harga yang MAJU (belum sampai nyentuh exit) ilang
        // lagi tiap siklus (baca ulang journal lama dari disk). Test ini GAGAL kalau bug itu balik.
        await gtp.monitorGoldTwinPosition({ system: 'ranger', livePrice: 4080, mexcExec: null, notify: noopNotify, notifySilent: noopNotify, idrRate: 17800 });
        const j = gtp.loadJournal();
        const expected = 4080 * (1 - 2.6 / 100);
        assert.ok(Math.abs(j.ranger.floating.trailing.invalidation - expected) < 1e-6, `invalidation harusnya ikut naik ke ${expected}, malah ${j.ranger.floating.trailing.invalidation} (kalau ini gagal, ratchet gak ke-persist)`);
      });

      await test('goldTwinPosition: REGRESI pesan tutup posisi WAJIB label LONG (bukan SHORT) buat direction buy', async () => {
        // Bug NYATA ketemu 26 Sep 2026 -- formatAutoOpen pakai konvensi direction 'buy'/'sell',
        // formatAutoClosed pakai 'long'/'short' (BEDA, dua fungsi sama-sama di darkKaelaLog.js).
        // Sempat ke-lolos manggil formatAutoClosed pakai f.dir ('buy') mentah -- selalu kebaca
        // SHORT (default fallback) walau posisinya LONG.
        closeMessages.length = 0;
        await gtp.monitorGoldTwinPosition({ system: 'ranger', livePrice: 4300, mexcExec: null, notify: captureNotify, notifySilent: captureNotify, idrRate: 17800 }); // TP leg kena (tp=4000+3*100=4300)
        const closeMsg = closeMessages.find((m) => m.includes('Tutup Posisi'));
        assert.ok(closeMsg, 'harusnya ada pesan tutup posisi (leg FixedTP kena TP)');
        assert.ok(closeMsg.includes('🟢 *LONG*'), `pesan tutup harus bilang LONG buat direction buy, isinya malah: ${closeMsg.split('\n')[1]}`);
        assert.ok(!closeMsg.includes('🔴 *SHORT*'), 'pesan tutup SALAH bilang SHORT padahal posisi LONG');
      });

      await test('goldTwinPosition: full close (dua leg exit) -> floating null + closedCount naik', async () => {
        await gtp.monitorGoldTwinPosition({ system: 'ranger', livePrice: 4100, mexcExec: null, notify: noopNotify, notifySilent: noopNotify, idrRate: 17800 }); // trailing ikut kena (invalidation ~4188 > 4100)
        const j = gtp.loadJournal();
        assert.strictEqual(j.ranger.floating, null, 'floating harusnya null abis KEDUA leg closed');
        assert.strictEqual(j.ranger.closedCount, 1);
        assert.strictEqual(j.ranger.stats.trailing.wins + j.ranger.stats.trailing.losses, 1);
        assert.strictEqual(j.ranger.stats.fixedTp.wins + j.ranger.stats.fixedTp.losses, 1);
      });

      await test('goldTwinPosition: config default enabled:false/allowReal:false kalau file gak ada', () => {
        fsGtp.unlinkSync(GTP_CONFIG);
        delete require.cache[require.resolve('./goldTwinPosition')];
        const gtpFresh = require('./goldTwinPosition');
        const cfg = gtpFresh.loadConfig();
        assert.strictEqual(cfg.enabled, false);
        assert.strictEqual(cfg.allowReal, false);
      });
    } finally {
      restoreGtpFiles();
    }
  }

  // (26 Sep 2026, kebijakan Olan: "grup sniper ga ada info trading real.. link yang di share cuma
  // link btc sinyal bukan kaela akses") -- toSniperClubLink() swap KAELA_ACCESS_URL->SNIPER_WEB_URL
  // di pesan yang dikirim ke Sniper Club (ninjaTrader.js/rangerBtcDualExec.js/sniperBtcDualExec.js),
  // pesan ke Wibowo TETAP pakai KAELA_ACCESS_URL apa adanya (msg asli gak boleh ke-mutasi).
  await test('darkKaelaLog: toSniperClubLink swap ke SNIPER_WEB_URL, gak mutasi string asli', () => {
    const original = `Contoh pesan\n\n🔗 ${KAELA_ACCESS_URL}`;
    const swapped = toSniperClubLink(original);
    assert.ok(swapped.includes(SNIPER_WEB_URL), 'harusnya kepasang SNIPER_WEB_URL');
    assert.ok(!swapped.includes(KAELA_ACCESS_URL), 'harusnya KAELA_ACCESS_URL udah ke-swap total');
    assert.ok(original.includes(KAELA_ACCESS_URL), 'string ASLI harusnya TETAP KAELA_ACCESS_URL (gak boleh kemutasi -- pesan Wibowo pakai variabel yang sama)');
  });

  // ============ rangerBtcDualExec.js (26 Sep 2026) ============
  // Modul ini BACA/TULIS file config+journal ASLI proyek (ranger-btc-dual-exec-config.json/
  // -journal.json) -- WAJIB backup+restore, SAMA disiplin kayak section goldTwinPosition di atas.
  // Scope test SENGAJA dibatasin ke logika MURNI (state machine/bookkeeping/exclusivity) --
  // BUKAN alur exec/WA penuh (buka posisi/tutup posisi beneran manggil Binance+kirim WA) -- SAMA
  // precedent kayak ninjaTrader.js di proyek ini (cuma nextVariantSignalId yang ditest, bukan
  // openSubPositionSafe/processVariant) krn fungsi WA (`sendWhatsAppToSniperClub`/
  // `sendWhatsAppToWibowo`) di-import LANGSUNG (destructured) di rangerBtcDualExec.js, BUKAN
  // param yang bisa disuntik mock kayak goldTwinPosition.js -- gak bisa dites tanpa BENERAN
  // manggil Fonnte/Binance (dilarang keras, lihat [[feedback-no-local-live-script-test]]).
  // Verifikasi alur exec/WA penuh dilakuin manual via code review + smoke-test read-only di VPS
  // (getPositionRisk/getAccountBalance doang, NOL order beneran) sebelum enabled:true.
  {
    const fsRbd = require('fs');
    const pathRbd = require('path');
    const RBD_CONFIG = pathRbd.join(__dirname, 'ranger-btc-dual-exec-config.json');
    const RBD_JOURNAL = pathRbd.join(__dirname, 'ranger-btc-dual-exec-journal.json');
    const OLD_NYOPET_JOURNAL = pathRbd.join(__dirname, 'nyopet-journal.json');
    const origRbdConfig = fsRbd.existsSync(RBD_CONFIG) ? fsRbd.readFileSync(RBD_CONFIG, 'utf8') : null;
    const origRbdJournal = fsRbd.existsSync(RBD_JOURNAL) ? fsRbd.readFileSync(RBD_JOURNAL, 'utf8') : null;
    const origNyopetJournal = fsRbd.existsSync(OLD_NYOPET_JOURNAL) ? fsRbd.readFileSync(OLD_NYOPET_JOURNAL, 'utf8') : null;
    function restoreRbdFiles() {
      if (origRbdConfig !== null) fsRbd.writeFileSync(RBD_CONFIG, origRbdConfig); else if (fsRbd.existsSync(RBD_CONFIG)) fsRbd.unlinkSync(RBD_CONFIG);
      if (origRbdJournal !== null) fsRbd.writeFileSync(RBD_JOURNAL, origRbdJournal); else if (fsRbd.existsSync(RBD_JOURNAL)) fsRbd.unlinkSync(RBD_JOURNAL);
      if (origNyopetJournal !== null) fsRbd.writeFileSync(OLD_NYOPET_JOURNAL, origNyopetJournal); else if (fsRbd.existsSync(OLD_NYOPET_JOURNAL)) fsRbd.unlinkSync(OLD_NYOPET_JOURNAL);
      delete require.cache[require.resolve('./rangerBtcDualExec')];
    }

    try {
      fsRbd.writeFileSync(RBD_CONFIG, JSON.stringify({ enabled: true, allowReal: false }));
      if (fsRbd.existsSync(RBD_JOURNAL)) fsRbd.unlinkSync(RBD_JOURNAL);
      if (fsRbd.existsSync(OLD_NYOPET_JOURNAL)) fsRbd.unlinkSync(OLD_NYOPET_JOURNAL);
      delete require.cache[require.resolve('./rangerBtcDualExec')];
      const rbd = require('./rangerBtcDualExec');

      await test('rangerBtcDualExec: config default enabled:false/allowReal:false kalau file gak ada', () => {
        fsRbd.unlinkSync(RBD_CONFIG);
        delete require.cache[require.resolve('./rangerBtcDualExec')];
        const rbdFresh = require('./rangerBtcDualExec');
        const cfg = rbdFresh.loadConfig();
        assert.strictEqual(cfg.enabled, false);
        assert.strictEqual(cfg.allowReal, false);
        fsRbd.writeFileSync(RBD_CONFIG, JSON.stringify({ enabled: true, allowReal: false }));
        delete require.cache[require.resolve('./rangerBtcDualExec')];
      });

      await test('rangerSweep: sapu low 20 candle + close balik di atas (tren naik) = LONG, SL di ujung sapuan; gak balik / lawan tren = null', () => {
        const { detectSweepSignal } = require('./rangerSweep');
        const mk = (n) => Array.from({ length: n }, (_, k) => { const b = 100 + k * 0.05; return { open: b, high: b + 1, low: b - 1, close: b }; });
        const cs = mk(320); const i = cs.length - 1; const prevLo = Math.min(...cs.slice(i - 20, i).map((c) => c.low));
        cs[i] = { open: prevLo + 1, high: prevLo + 2, low: prevLo - 1, close: prevLo + 1.5 };
        const sig = detectSweepSignal(cs, i);
        assert.ok(sig && sig.direction === 'buy' && sig.patternType === 'ict_sweep');
        assert.ok(Math.abs(sig.sl - (prevLo - 1) * 0.999) < 1e-9);
        const cs2 = cs.slice(); cs2[i] = { ...cs[i], close: prevLo - 0.5 }; assert.strictEqual(detectSweepSignal(cs2, i), null, 'gak close balik = bukan sweep');
        const cs3 = mk(320).map((c, k) => ({ ...c, open: 200 - k * 0.05, high: 201 - k * 0.05, low: 199 - k * 0.05, close: 200 - k * 0.05 }));
        const lo3 = Math.min(...cs3.slice(i - 20, i).map((c) => c.low)); cs3[i] = { open: lo3 + 1, high: lo3 + 2, low: lo3 - 1, close: lo3 + 1.5 };
        assert.strictEqual(detectSweepSignal(cs3, i), null, 'long lawan tren turun (di bawah SMA300) = skip');
      });
      await test('rangerSweep: filter F&G -- short ditolak pas F&G < 25, long bebas, data F&G gagal = gak blokir', () => {
        const { passesFngFilter } = require('./rangerSweep');
        assert.strictEqual(passesFngFilter({ direction: 'sell' }, 20), false);
        assert.strictEqual(passesFngFilter({ direction: 'sell' }, 25), true);
        assert.strictEqual(passesFngFilter({ direction: 'buy' }, 5), true);
        assert.strictEqual(passesFngFilter({ direction: 'sell' }, null), true);
      });
      await test('rangerBtcDualExec: journal fresh -- 3 slot (pattern/fvg/sweep) kosong, stats demo+real nol', () => {
        delete require.cache[require.resolve('./rangerBtcDualExec')];
        const rbdFresh = require('./rangerBtcDualExec');
        const j = rbdFresh.loadJournal();
        assert.deepStrictEqual(Object.keys(j).sort(), ['fvg', 'pattern', 'sweep']);
        for (const slotKey of ['pattern', 'fvg', 'sweep']) {
          assert.strictEqual(j[slotKey].floating, null, `slot ${slotKey} harusnya kosong`);
          assert.strictEqual(j[slotKey].stats.demo.wins, 0);
          assert.strictEqual(j[slotKey].stats.real.wins, 0);
        }
      });

      await test('rangerBtcDualExec: isSlotFree true selama floating null, false begitu keisi manual', () => {
        assert.strictEqual(rbd.isSlotFree('pattern'), true);
        const j = rbd.loadJournal();
        j.pattern.floating = { id: 'x', direction: 'buy' };
        fsRbd.writeFileSync(RBD_JOURNAL, JSON.stringify(j));
        assert.strictEqual(rbd.isSlotFree('pattern'), false);
        assert.strictEqual(rbd.isSlotFree('fvg'), true, 'slot fvg harusnya TETAP bebas, independen dari pattern');
        assert.strictEqual(rbd.hasAnyFloatingSlot(), true);
        // bersihin lagi buat test berikutnya
        j.pattern.floating = null;
        fsRbd.writeFileSync(RBD_JOURNAL, JSON.stringify(j));
      });

      await test('rangerBtcDualExec: hasAnyFloatingSlot false kalau kedua slot kosong', () => {
        assert.strictEqual(rbd.hasAnyFloatingSlot(), false);
      });

      await test('rangerBtcDualExec: fedGridCurrentlyFloating false kalau nyopet-journal.json gak ada', () => {
        assert.strictEqual(fsRbd.existsSync(OLD_NYOPET_JOURNAL), false);
        assert.strictEqual(rbd.fedGridCurrentlyFloating(), false);
      });

      await test('rangerBtcDualExec: fedGridCurrentlyFloating TRUE begitu ada order fed_dovish_grid floating di journal LAMA', () => {
        fsRbd.writeFileSync(OLD_NYOPET_JOURNAL, JSON.stringify({
          orders: [
            { asset: 'btc', status: 'floating', patternType: 'fed_dovish_grid' },
            { asset: 'btc', status: 'closed_tp', patternType: 'fed_dovish_grid' }, // udah closed -- gak boleh keitung
            { asset: 'xau', status: 'floating', patternType: 'fed_dovish_grid' }, // aset LAIN -- gak boleh keitung
          ],
        }));
        assert.strictEqual(rbd.fedGridCurrentlyFloating(), true);
        fsRbd.unlinkSync(OLD_NYOPET_JOURNAL);
      });

      await test('rangerBtcDualExec: openRangerBtcDual SKIP total kalau Fed Grid lagi floating (cegah numpuk BTCUSDC)', async () => {
        fsRbd.writeFileSync(OLD_NYOPET_JOURNAL, JSON.stringify({ orders: [{ asset: 'btc', status: 'floating', patternType: 'fed_dovish_grid' }] }));
        await rbd.openRangerBtcDual({ sig: { direction: 'buy', sl: 60000, patternType: 'flag_bull' }, livePrice: 61000 });
        const j = rbd.loadJournal();
        assert.strictEqual(j.pattern.floating, null, 'harusnya SKIP total (gak ada network call), floating tetap null');
        fsRbd.unlinkSync(OLD_NYOPET_JOURNAL);
      });

      await test('rangerBtcDualExec: openRangerBtcDual SKIP kalau slot udah keisi (gak boleh dobel-entry slot yang sama)', async () => {
        const j = rbd.loadJournal();
        j.fvg.floating = { id: 'existing', direction: 'buy' };
        fsRbd.writeFileSync(RBD_JOURNAL, JSON.stringify(j));
        await rbd.openRangerBtcDual({ sig: { direction: 'buy', sl: 60000, patternType: 'fvg_bull' }, livePrice: 61000 });
        const j2 = rbd.loadJournal();
        assert.strictEqual(j2.fvg.floating.id, 'existing', 'slot fvg harusnya TETAP entry lama, gak ketiban entry baru');
        j2.fvg.floating = null;
        fsRbd.writeFileSync(RBD_JOURNAL, JSON.stringify(j2));
      });

      await test('rangerBtcDualExec: slotKeyFor -- patternType diawali "fvg" masuk slot fvg, selain itu slot pattern', () => {
        // Diuji tidak langsung lewat openRangerBtcDual (riskDistance 0 -> skip cepat, TANPA network
        // call) -- cukup buat verifikasi kategorisasi slot murni tanpa exec.
        return Promise.all([
          rbd.openRangerBtcDual({ sig: { direction: 'buy', sl: 61000, patternType: 'fvg_bull' }, livePrice: 61000 }),
          rbd.openRangerBtcDual({ sig: { direction: 'buy', sl: 61000, patternType: 'flag_bull' }, livePrice: 61000 }),
        ]).then(() => {
          const j = rbd.loadJournal();
          assert.strictEqual(j.fvg.floating, null);
          assert.strictEqual(j.pattern.floating, null);
        });
      });
    } finally {
      restoreRbdFiles();
    }
  }

  // ============ sniperBtcDualExec.js (26 Sep 2026, Fase 2) ============
  // SAMA disiplin backup+restore kayak section rangerBtcDualExec di atas. Scope test SAMA JUGA
  // dibatasin ke logika MURNI (config/journal/no-op-safe) -- alur exec/WA/leg2-reopen penuh gak
  // bisa dites tanpa BENERAN manggil Binance/Fonnte (SAMA alasan persis rangerBtcDualExec.js,
  // fungsi WA di-import LANGSUNG bukan param yang bisa disuntik mock).
  {
    const fsSbd = require('fs');
    const pathSbd = require('path');
    const SBD_CONFIG = pathSbd.join(__dirname, 'sniper-btc-dual-exec-config.json');
    const SBD_JOURNAL = pathSbd.join(__dirname, 'sniper-btc-dual-exec-journal.json');
    const origSbdConfig = fsSbd.existsSync(SBD_CONFIG) ? fsSbd.readFileSync(SBD_CONFIG, 'utf8') : null;
    const origSbdJournal = fsSbd.existsSync(SBD_JOURNAL) ? fsSbd.readFileSync(SBD_JOURNAL, 'utf8') : null;
    function restoreSbdFiles() {
      if (origSbdConfig !== null) fsSbd.writeFileSync(SBD_CONFIG, origSbdConfig); else if (fsSbd.existsSync(SBD_CONFIG)) fsSbd.unlinkSync(SBD_CONFIG);
      if (origSbdJournal !== null) fsSbd.writeFileSync(SBD_JOURNAL, origSbdJournal); else if (fsSbd.existsSync(SBD_JOURNAL)) fsSbd.unlinkSync(SBD_JOURNAL);
      delete require.cache[require.resolve('./sniperBtcDualExec')];
    }

    try {
      if (fsSbd.existsSync(SBD_JOURNAL)) fsSbd.unlinkSync(SBD_JOURNAL);
      delete require.cache[require.resolve('./sniperBtcDualExec')];
      const sbd = require('./sniperBtcDualExec');

      await test('sniperBtcDualExec: config default enabled:false/allowReal:false kalau file gak ada', () => {
        if (fsSbd.existsSync(SBD_CONFIG)) fsSbd.unlinkSync(SBD_CONFIG);
        delete require.cache[require.resolve('./sniperBtcDualExec')];
        const sbdFresh = require('./sniperBtcDualExec');
        const cfg = sbdFresh.loadConfig();
        assert.strictEqual(cfg.enabled, false);
        assert.strictEqual(cfg.allowReal, false);
      });

      await test('sniperBtcDualExec: journal fresh -- orders kosong, stats demo+real nol', () => {
        delete require.cache[require.resolve('./sniperBtcDualExec')];
        const sbdFresh = require('./sniperBtcDualExec');
        const j = sbdFresh.loadJournal();
        assert.deepStrictEqual(j.orders, {});
        assert.strictEqual(j.stats.demo.wins, 0);
        assert.strictEqual(j.stats.real.wins, 0);
        assert.strictEqual(j.stats.demo.totalPnlUsd, 0);
      });

      await test('sniperBtcDualExec: journal merge -- order LAMA yang udah ada TETAP kebaca (gak ke-reset)', () => {
        fsSbd.writeFileSync(SBD_JOURNAL, JSON.stringify({
          orders: { 'abc123': { direction: 'buy', sl: 60000, tp: 64000, wibowoRoute: 'demo', demo: { entryPrice: 62000, qty: 0.01, closedAt: null }, real: null } },
          stats: { demo: { wins: 3, losses: 1, totalPnlUsd: 42.5 }, real: { wins: 0, losses: 0, totalPnlUsd: 0 } },
        }));
        delete require.cache[require.resolve('./sniperBtcDualExec')];
        const sbdFresh = require('./sniperBtcDualExec');
        const j = sbdFresh.loadJournal();
        assert.ok(j.orders['abc123'], 'order lama harusnya tetep ada');
        assert.strictEqual(j.orders['abc123'].demo.entryPrice, 62000);
        assert.strictEqual(j.stats.demo.wins, 3);
        assert.strictEqual(j.stats.demo.totalPnlUsd, 42.5);
      });

      // Regresi LANGSUNG buat permintaan Olan "benerin bug dobel-PnL sekalian" -- order BTC yang
      // lewat modul dual-exec ini TIDAK PERNAH nyentuh kaelaBankroll.js (beda dari jalur LAMA
      // sniperOrderMonitor.js/sniperLiveMonitor.js yang DUA-DUANYA applyRealizedPnl ke situ, akar
      // bug dobel-catat). monitorSniperBtcDual() journal KOSONG -> for-loop 0 iterasi -> NOL
      // panggilan exec/network -- aman dipanggil beneran di sini (bukan pelanggaran
      // no-local-live-script-test, murni no-op).
      await test('sniperBtcDualExec: monitorSniperBtcDual (journal kosong) TIDAK PERNAH nyentuh kaelaBankroll.js', async () => {
        const kaelaBankroll = require('./kaelaBankroll');
        const before = kaelaBankroll.getBalance();
        if (fsSbd.existsSync(SBD_JOURNAL)) fsSbd.unlinkSync(SBD_JOURNAL);
        delete require.cache[require.resolve('./sniperBtcDualExec')];
        const sbdFresh = require('./sniperBtcDualExec');
        await sbdFresh.monitorSniperBtcDual({ idrRate: 17800 });
        const after = kaelaBankroll.getBalance();
        assert.strictEqual(before, after, 'kaelaBankroll balance HARUS gak berubah -- modul dual-exec sizing dari saldo exchange langsung, bukan shadow ledger global');
      });

      await test('sniperBtcDualExec: openSniperBtcDual SKIP total kalau order.id udah ada di journal (gak boleh dobel-eksekusi order yang sama)', async () => {
        const j = sbd.loadJournal();
        j.orders['existing-order'] = { direction: 'buy', sl: 60000, tp: 64000, wibowoRoute: 'demo', demo: { entryPrice: 62000, qty: 0.01, closedAt: null }, real: null };
        fsSbd.writeFileSync(SBD_JOURNAL, JSON.stringify(j));
        delete require.cache[require.resolve('./sniperBtcDualExec')];
        const sbdFresh = require('./sniperBtcDualExec');
        // order.id SAMA -- kalau fungsi ini nembus ke jalur exec (bukan early-return), test bakal
        // gantung/gagal krn network call beneran ke Binance tanpa mock. Early-return yang bener
        // artinya function selesai CEPAT tanpa exception.
        await sbdFresh.openSniperBtcDual({ order: { id: 'existing-order', direction: 'buy', sl: 60000, tp: 64000 }, livePrice: 62500 });
        const j2 = sbdFresh.loadJournal();
        assert.strictEqual(j2.orders['existing-order'].demo.entryPrice, 62000, 'entry lama harusnya TETAP, gak ketiban entry baru');
      });
    } finally {
      restoreSbdFiles();
    }
  }

  // ============ ninjaFvg.js -- aturan inti NINJA FVG (spesifikasi Olan 30 Sep 2026) ============
  {
    const nf = require('./ninjaFvg');
    const mk = (open, high, low, close, t) => ({ open, high, low, close, openTime: t * 300000, closeTime: t * 300000 + 299999 });
    // idx2 bentuk FVG bullish [101,102] (high idx0=101 < low idx2=102), idx3 ninggalin zona, idx4 balik nyentuh.
    const base = [mk(100, 101, 99, 100, 0), mk(100, 103, 100, 103, 1), mk(103, 105, 102, 104, 2), mk(104, 106, 103, 105, 3), mk(105, 105, 101.5, 104, 4)];

    await test('ninjaFvg: FVG kedeteksi + ID unik deterministik + lebar % dari ukuran aktual', () => {
      const g = nf.detectFvgAt(base, 2, '5m', { minWidthPct: 0.05 });
      assert.ok(g && g.dir === 'long' && g.top === 102 && g.bottom === 101, `FVG bullish [101,102] harusnya kedeteksi, dapet ${JSON.stringify(g)}`);
      assert.strictEqual(g.id, nf.detectFvgAt(base, 2, '5m', { minWidthPct: 0.05 }).id, 'ID harus sama tiap deteksi ulang');
      assert.ok(Math.abs(g.widthPct - (1 / 101.5) * 100) < 1e-9, 'lebar = (top-bottom)/mid');
      assert.strictEqual(nf.detectFvgAt(base, 2, '5m', { minWidthPct: 2 }), null, 'filter % harus nolak FVG di bawah minWidthPct');
    });

    await test('ninjaFvg: entry pas harga balik nyentuh FVG, SL awal = 2x lebar FVG, FVG jadi USED', () => {
      const st = nf.newState();
      for (let i = 0; i < base.length; i++) nf.stepBacktest(st, base, i, '5m', { minWidthPct: 0.05 });
      const p = st.position;
      assert.ok(p, 'harusnya ada posisi kebuka di idx4');
      assert.strictEqual(p.entryPrice, 102, 'entry di batas atas zona (sentuhan pertama)');
      assert.ok(Math.abs(p.slDistPct - 2 * p.fvgWidthPct) < 1e-9, 'SL awal = 2x lebar FVG');
      assert.ok(Math.abs(p.initialSl - 102 * (1 - p.slDistPct / 100)) < 1e-9, 'SL awal dihitung dari harga entry');
      assert.ok(!st.fvgs.some((g) => g.id === p.fvgId && g.status === 'ACTIVE'), 'FVG yang dipakai gak boleh ACTIVE lagi (USED)');
    });

    await test('ninjaFvg: trailing ratchet satu arah, 1 posisi aktif doang, FVG USED gak pernah dipakai lagi', () => {
      const cs = [...base, mk(104, 110, 103, 109, 5), mk(109, 109.5, 108.5, 109, 6), mk(109, 109, 100, 101, 7), mk(101, 101.5, 101.2, 101.4, 8)];
      const st = nf.newState();
      for (let i = 0; i <= 4; i++) nf.stepBacktest(st, cs, i, '5m', { minWidthPct: 0.05 });
      const firstId = st.position.fvgId;
      nf.stepBacktest(st, cs, 5, '5m', { minWidthPct: 0.05 });
      const slAfterRally = st.position.sl;
      assert.ok(slAfterRally > st.position.initialSl, 'harga naik -> SL ikut naik');
      // FVG B valid & kesentuh SELAMA posisi A aktif -> gak boleh entry.
      st.fvgs.push({ id: 'B', dir: 'long', top: 109, bottom: 108.6, widthPct: 0.37, createdTime: cs[5].closeTime, createdIdx: 5, left: true, status: 'ACTIVE' });
      nf.stepBacktest(st, cs, 6, '5m', { minWidthPct: 0.05 });
      assert.strictEqual(st.position.fvgId, firstId, 'posisi aktif tetap posisi A, FVG B gak boleh buka posisi kedua');
      assert.strictEqual(st.position.sl, slAfterRally, 'harga turun dikit -> SL GAK boleh melebar balik');
      nf.stepBacktest(st, cs, 7, '5m', { minWidthPct: 0.05 });
      assert.strictEqual(st.closed.length, 1, 'trailing kena -> posisi A ditutup');
      assert.strictEqual(st.position, null, 'candle yang nutup posisi gak boleh sekaligus buka posisi baru');
      nf.stepBacktest(st, cs, 8, '5m', { minWidthPct: 0.05 });
      assert.strictEqual(st.position, null, 'harga nyentuh FVG A lagi -> ABAIKAN (USED, no re-entry)');
    });
  }

  // ============ ninjaMrSignal.js -- paper live WAJIB identik backtest (30 Sep 2026) ============
  {
    const mr = require('./ninjaMrSignal');
    const { run: runR3 } = require('./backtestNinjaResearch3');
    // Random walk deterministik (PRNG sederhana) biar test stabil, cukup panjang buat EMA200 + banyak sinyal.
    let seed = 42;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const cs = [];
    let px = 60000;
    for (let i = 0; i < 4000; i++) {
      const drift = Math.sin(i / 400) * 0.0006;
      const o = px, cl = px * (1 + drift + (rnd() - 0.5) * 0.008);
      const hi = Math.max(o, cl) * (1 + rnd() * 0.003), lo = Math.min(o, cl) * (1 - rnd() * 0.003);
      cs.push({ openTime: i * 900000, closeTime: i * 900000 + 899999, open: o, high: hi, low: lo, close: cl, volume: 1 });
      px = cl;
    }
    const cfg = { enabled: true, paperModalUsd: 100, k: 3, exit: 'mean' };

    await test('ninjaMrSignal: replay live (processCandles) IDENTIK backtest run() trade-per-trade', () => {
      const bt = runR3(cs, { kind: 'mr', trend: true, k: 3, exit: 'mean' });
      const j = mr.freshJournal();
      j.lastProcessedCloseTime = cs[0].closeTime - 1; // proses dari candle pertama
      mr.processCandles(j, cs, cfg);
      assert.ok(bt.length >= 10, `data sintetis harus ngasih cukup trade, dapet ${bt.length}`);
      assert.strictEqual(j.closed.length, bt.length, `jumlah trade beda: live ${j.closed.length} vs backtest ${bt.length}`);
      for (let k = 0; k < bt.length; k++) {
        assert.strictEqual(j.closed[k].dir, bt[k].dir, `arah trade #${k} beda`);
        assert.ok(Math.abs(j.closed[k].entryPrice - bt[k].entryPrice) < 1e-9 && Math.abs(j.closed[k].exitPrice - bt[k].exitPrice) < 1e-9, `harga trade #${k} beda`);
        assert.ok(Math.abs(j.closed[k].grossPct - bt[k].grossPct) < 1e-9, `gross trade #${k} beda`);
      }
    });

    await test('ninjaMrSignal: exit TP trailing (meanTrail, default live) IDENTIK backtest run() trade-per-trade', () => {
      const cfgT = { ...cfg, exit: 'meanTrail', trailK: 1 };
      const bt = runR3(cs, { kind: 'mr', trend: true, k: 3, exit: 'meanTrail', trailK: 1 });
      const j = mr.freshJournal();
      j.lastProcessedCloseTime = cs[0].closeTime - 1;
      const evs = mr.processCandles(j, cs, cfgT);
      assert.ok(bt.length >= 10, `data sintetis harus ngasih cukup trade, dapet ${bt.length}`);
      assert.strictEqual(j.closed.length, bt.length, `jumlah trade beda: live ${j.closed.length} vs backtest ${bt.length}`);
      for (let k = 0; k < bt.length; k++) {
        assert.ok(j.closed[k].dir === bt[k].dir && Math.abs(j.closed[k].exitPrice - bt[k].exitPrice) < 1e-9, `trade #${k} beda`);
      }
      assert.ok(evs.some((e) => e.type === 'TRAIL_ON'), 'harus ada event TP trailing aktif');
      assert.ok(j.closed.some((t) => t.reason === 'TRAIL'), 'harus ada trade yang ditutup TP trailing');
      const on = evs.find((e) => e.type === 'TRAIL_ON');
      assert.ok(mr.formatTrailOn(on.position).includes('TP TRAILING AKTIF'));
    });

    await test('ninjaMrSignal: diproses per-candle (kayak cron tiap menit) hasilnya SAMA dgn sekali jalan', () => {
      const a = mr.freshJournal(); a.lastProcessedCloseTime = cs[0].closeTime - 1; mr.processCandles(a, cs, cfg);
      const b = mr.freshJournal(); b.lastProcessedCloseTime = cs[0].closeTime - 1;
      for (let n = 1000; n <= cs.length; n += 1) mr.processCandles(b, cs.slice(0, n), cfg);
      // b mulai proses penuh baru dari candle ke-1000 (window awal diproses sekaligus) -- bandingin trade SETELAH itu
      const cut = cs[1100].closeTime;
      const ta = a.closed.filter((t) => t.entryTime > cut), tb = b.closed.filter((t) => t.entryTime > cut);
      assert.ok(ta.length > 0, 'harus ada trade buat dibandingin');
      assert.deepStrictEqual(tb.map((t) => [t.dir, t.entryPrice, t.exitPrice]), ta.map((t) => [t.dir, t.entryPrice, t.exitPrice]));
    });

    await test('ninjaMrSignal: TANPA FEE dikunci -- net = gerak harga murni, $ = net% x nilai posisi, pesan "Fee: $0"', () => {
      const j = mr.freshJournal(); j.lastProcessedCloseTime = cs[0].closeTime - 1;
      mr.processCandles(j, cs, { ...cfg, slipPctPerSide: 0.05, holdFeePctPerBoundary: 0.5 }); // setting fee NYASAR di config harus DIABAIKAN
      for (const t of j.closed) {
        assert.strictEqual(t.netPct, t.grossPct, 'tanpa fee: net = gross, apapun isi config');
        assert.ok(Math.abs(t.netUsd - (t.netPct / 100) * t.sizing.nilaiPosisi) < 1e-9, 'net $ = net% x nilai posisi kalkulator');
      }
      const msg = mr.formatClose(j.closed[j.closed.length - 1], j.stats, cfg);
      assert.ok(msg.includes('Fee: $0 (tanpa fee)') && msg.includes('Bersih:') && !/bc.?game|slippage|biaya inap/i.test(msg), `pesan harus tanpa fee & tanpa nama venue:\n${msg}`);
    });

    await test('ninjaMrSignal: run pertama cuma proses candle terakhir (gak nge-replay histori jadi sinyal basi)', () => {
      const j = mr.freshJournal();
      mr.processCandles(j, cs, cfg);
      assert.strictEqual(j.lastProcessedCloseTime, cs[cs.length - 1].closeTime);
      assert.strictEqual(j.closed.length, 0);
    });
  }

  // ============ ninjaMrTrader.js -- eksekutor BingX, alur penuh dgn exchange palsu (30 Sep 2026) ============
  await test('ninjaMrTrader: selftest alur penuh (limit entry, stop/limit exit, routing WA demo/real, fee) lolos semua', () => {
    const { execFileSync } = require('child_process');
    const out = execFileSync('node', [require('path').join(__dirname, 'ninjaMrTrader.selftest.js')], { encoding: 'utf8', timeout: 120000 });
    assert.ok(/\n\d+ lolos, 0 gagal/.test(out), `selftest ada yang gagal:\n${out.split('\n').filter((l) => /GAGAL|lolos,/.test(l)).join('\n')}`);
  });

  // ============ rangerRotation.js -- Ranger Rotasi 8 koin demo BingX, alur penuh dgn exchange palsu (3 Okt 2026) ============
  await test('rangerRotation: selftest alur penuh (prioritas koin, 1 posisi, partial 2R, trailing, SL, window flip, gak nutup punya Ninja) lolos semua', () => {
    const { execFileSync } = require('child_process');
    const out = execFileSync('node', [require('path').join(__dirname, 'rangerRotation.selftest.js')], { encoding: 'utf8', timeout: 120000 });
    assert.ok(/\n\d+ lolos, 0 gagal/.test(out), `selftest ada yang gagal:\n${out.split('\n').filter((l) => /GAGAL|lolos,/.test(l)).join('\n')}`);
  });

  // ============ stdFuturesLadderMonitor.js -- pengawas likuidasi DCA Tangga (Standard Futures, 1 Okt 2026) ============
  await test('stdFuturesLadderMonitor: seed diam, likuidasi -> WA 1x + saran x5, tutup biasa diam, API gagal gak alarm palsu, tangga mentok x9', async () => {
    const M = require('./stdFuturesLadderMonitor');
    assert.strictEqual(M.nextLeverage(3), 5); assert.strictEqual(M.nextLeverage(7), 9); assert.strictEqual(M.nextLeverage(9), 9);
    const pos = (time, entry, lev) => ({ symbol: 'BTC-USDT', positionSide: 'LONG', time, entryPrice: String(entry), leverage: String(lev), initialMargin: '3', currentPrice: String(entry) });
    let live = [pos(1000, 84000, 3), pos(2000, 85000, 3)];
    let orders = [];
    let failNext = false;
    const sent = [];
    const st = M.freshState();
    const mon = M.createMonitor({
      fetchPositions: async () => { if (failNext) throw new Error('network'); return live; },
      fetchOrders: async () => orders,
      notify: async (m) => { sent.push(m); },
      now: () => 5000, log: () => {},
    }, st);
    await mon.runCycle();
    assert.strictEqual(sent.length, 0, 'seed awal gak boleh kirim WA');
    assert.strictEqual(Object.keys(st.layers).length, 2);
    failNext = true; await mon.runCycle(); failNext = false;
    assert.strictEqual(sent.length, 0, 'API gagal gak boleh dianggap posisi hilang');
    // #1 kena likuidasi (tutup di bawah estimasi liq ~56.420), #2 ditutup manual untung
    live = [];
    orders = [
      { positionSide: 'LONG', time: 1500, leverage: '3', margin: '3', closePrice: '56300', avgPrice: '56300' },
      { positionSide: 'LONG', time: 2500, leverage: '3', margin: '3', closePrice: '90000', avgPrice: '90000' },
    ];
    await mon.runCycle();
    assert.strictEqual(sent.length, 1, `harusnya cuma 1 WA (likuidasi), dapet ${sent.length}`);
    assert.ok(/LIKUIDASI/.test(sent[0]) && /x5/.test(sent[0]) && /#1/.test(sent[0]), sent[0]);
    assert.strictEqual(st.totals.liqCount, 1); assert.strictEqual(st.totals.liqLossUsd, 3); assert.strictEqual(st.totals.closedCount, 1);
    await mon.runCycle();
    assert.strictEqual(sent.length, 1, 'likuidasi yang sama gak boleh dilaporin ulang');
  });

  // (3 Okt 2026) peringatan TAMBAH COLLATERAL: minus >=50% margin -> DM, >=75% -> DM keras, gak spam, reset abis pulih
  await test('stdFuturesLadderMonitor: minus 50% -> pengingat umum cek posisi ke GRUP Wibowo (1x, tanpa sebut collateral), 75% -> pengingat lanjutan, abis collateral ditambah reset', async () => {
    const M = require('./stdFuturesLadderMonitor');
    const pos = (price, margin) => ({ symbol: 'BTC-USDT', positionSide: 'LONG', time: 1000, entryPrice: '84000', leverage: '3', initialMargin: String(margin), currentPrice: String(price) });
    let live = [pos(84000, 3)];
    const sent = [];
    const st = M.freshState();
    const dm = [];
    const mon = M.createMonitor({ fetchPositions: async () => live, fetchOrders: async () => [], notify: async (m) => { dm.push(m); }, notifyGroup: async (m) => { sent.push(m); }, now: () => 5000, log: () => {} }, st);
    await mon.runCycle(); // seed
    live = [pos(84000 * (1 - 0.17), 3)]; await mon.runCycle(); // -17% harga x3 = -51% margin
    assert.strictEqual(sent.length, 1); assert.ok(/Pengingat rutin/.test(sent[0]) && /cek posisi/i.test(sent[0]) && !/collateral/i.test(sent[0]), sent[0]);
    assert.ok(!/likuidasi|bahaya|minus|%/i.test(sent[0]), 'bahasa halus: gak boleh nyebut likuidasi/bahaya/persen minus');
    assert.strictEqual(dm.length, 0, 'pengingat collateral ke GRUP, bukan DM');
    await mon.runCycle();
    assert.strictEqual(sent.length, 1, 'level sama gak boleh dikirim ulang');
    live = [pos(84000 * (1 - 0.26), 3)]; await mon.runCycle(); // -78% margin
    assert.strictEqual(sent.length, 2); assert.ok(/Pengingat lanjutan/.test(sent[1]) && !/likuidasi|bahaya/i.test(sent[1]), sent[1]);
    // Olan tambah collateral $6 (margin 3 -> 9): leverage efektif 1x, rugi turun ke ~26% -> reset; harga likuidasi menjauh
    live = [pos(84000 * (1 - 0.26), 9)]; await mon.runCycle();
    const L = Object.values(st.layers)[0];
    assert.ok(Math.abs(L.effLev - 1) < 1e-9, `effLev harusnya 1, dapet ${L.effLev}`);
    assert.strictEqual(L.collAlert, 0, 'abis pulih di bawah 35% -> reset');
    assert.ok(L.liqEst < 84000 * 0.1, 'x1 -> harga likuidasi jauh banget');
    assert.strictEqual(sent.length, 2);
  });

  // BUG-KAELATRADE-0056 (4 Okt 2026): Ranger Emas long-only TANPA window, tapi monitor dulu masih nutup paksa long Emas
  // (WINDOW_FLIP) tiap close < SMA1200 -- backtest exit live PF 4,29 -> 1,11. Gerbang window/tutup paksa WAJIB BTC doang.
  await test('Ranger: window bear & tutup paksa WINDOW_FLIP cuma BTC, Emas gak pernah (0056)', async () => {
    const { windowFlipApplies } = require('./rangerAutoTrader');
    assert.strictEqual(windowFlipApplies('btc'), true);
    assert.strictEqual(windowFlipApplies('xau'), false);
    // statis: SEMUA pemanggilan isBearWindowFor di rangerAutoTrader.js wajib dijaga windowFlipApplies (baris sama / baris
    // tepat di atasnya, mis. `if (windowFlipApplies(..)) {`)
    const src = fs.readFileSync(require('path').join(__dirname, 'rangerAutoTrader.js'), 'utf8').split('\n');
    const idx = src.map((l, i) => i).filter((i) => /isBearWindowFor\(/.test(src[i]) && !/^\s*(\/\/|function isBearWindowFor)/.test(src[i]));
    assert.ok(idx.length >= 2, `minimal 2 pemanggilan (gerbang entry + tutup paksa), ketemu ${idx.length}`);
    for (const i of idx) assert.ok(/windowFlipApplies\(/.test(src[i]) || /windowFlipApplies\(/.test(src[i - 1]), `pemanggilan tanpa gerbang BTC (baris ${i + 1}): ${src[i].trim()}`);
  });

  // 5 Okt 2026 (keputusan Olan): filter DXY Ranger dicabut buat BTC (motong untung dua era di exit trailing 3x), Emas tetap.
  await test('Ranger: filter DXY cuma Emas, BTC gak lagi dijeda dolar kuat (5 Okt)', async () => {
    const { DXY_FILTER_ASSETS } = require('./rangerAutoTrader');
    assert.ok(!DXY_FILTER_ASSETS.includes('btc'), 'BTC gak boleh balik kena filter DXY tanpa riset baru');
    assert.ok(DXY_FILTER_ASSETS.includes('xau'), 'Emas tetap pakai filter DXY');
    const src = fs.readFileSync(require('path').join(__dirname, 'rangerAutoTrader.js'), 'utf8');
    const calls = src.split('\n').filter((l) => /isDxyWeak\(/.test(l) && !/^\s*\/\//.test(l) && !/require\(/.test(l));
    for (const l of calls) assert.ok(/DXY_FILTER_ASSETS\.includes\(/.test(l), `isDxyWeak tanpa gerbang aset: ${l.trim()}`);
  });

  // 5 Okt 2026 (permintaan Olan): ISM PMI wajib dapet pesan SIAP-SIAP walau ForexFactory ngelabel Medium; PMI S&P (Low) tetap gak.
  await test('Kalender: ISM PMI (Medium) masuk pesan siap-siap, Final PMI S&P (Low) enggak', async () => {
    const { getAllHighImpactUsdEvents } = require('./econCalendar');
    const raw = [
      { title: 'ISM Services PMI', country: 'USD', impact: 'Medium', date: '2026-10-05T10:00:00-04:00' },
      { title: 'ISM Manufacturing PMI', country: 'USD', impact: 'Medium', date: '2026-11-02T10:00:00-05:00' },
      { title: 'Final Services PMI', country: 'USD', impact: 'Low', date: '2026-10-05T09:45:00-04:00' },
      { title: 'ISM Services PMI', country: 'EUR', impact: 'Medium', date: '2026-10-05T10:00:00-04:00' },
    ];
    const got = getAllHighImpactUsdEvents(raw).map((e) => e.rawTitle);
    assert.deepStrictEqual(got, ['ISM Services PMI', 'ISM Manufacturing PMI']);
  });

  console.log(`\n${passed} lolos, ${failed} gagal (dari ${todayIso.slice(0, 10)} test run)`);
  cleanupFixtureFile();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('ERROR regressionTests.js:', e.message); cleanupFixtureFile(); process.exit(1); });
