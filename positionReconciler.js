// positionReconciler.js (2-3 Sep 2026, permintaan Olan) -- "pengawas posisi" KHUSUS akun REAL
// Olan sendiri (dasar saham Wibowo Hedgefund). Tujuan: kalau Olan buka/nambah/kurangin/tutup
// posisi LANGSUNG di exchange (bukan lewat bot) -- TERMASUK aset yang bot SAMA SEKALI GAK
// DUKUNG (Olan: "kaela ga bisa trading selain emas dan btc.. misal trading zilliqa, walau itu di
// luar mode, apa akan tetep ada pesan?.. aku pengennya tetep dapet pesan itu.. jurnal juga tetep
// kecatat") -- sistem tetap TAU, kirim WA ke grup Wibowo Hedgefund, DAN catat ke Jurnal.
//
// Cara kerja: tiap siklus, ambil SEMUA posisi live via client.getAllPositions() (endpoint TANPA
// filter symbol -- balikin APAPUN yang lagi kebuka, bukan cuma BTC/Emas yang bot kenal),
// bandingin sama snapshot TERAKHIR (state file, per symbol + entryId Journal-nya).
// Symbol yang BENERAN disentuh bot siklus ini (touchedSymbols, dari onEvent) di-skip -- broadcast
// buat itu udah dihandle notify() bot sendiri (lihat multiAccountExecutor.js buildSendWA, sekarang
// broadcast ke Wibowo juga). Symbol LAIN yang berubah -> Olan yang ngutak-atik manual (asset
// APAPUN, bot gak perlu "kenal" symbol-nya buat sistem ini bisa mantau).
//
// PnL buat REDUCE/CLOSE manual (Binance) DIAMBIL DARI INCOME HISTORY ASLI (getIncomeHistory,
// REALIZED_PNL+COMMISSION+FUNDING_FEE, dijumlah sejak lastCheckedAtMs) -- permintaan Olan: "angka
// jujur dari binance langsung. bukan perhitungan sendiri" (fee kepotong beneran, bukan estimasi).
//
// MULTI-EXCHANGE (BARU, 3 Sep 2026, Olan tes buka manual di MEXC -- "kok ga ada informasi?") --
// SEBELUMNYA fungsi ini Binance-doang (`client.getAllPositions()` 1 exchange), MEXC gak pernah
// dicek sama sekali. Sekarang loop 2 sumber (Binance+MEXC), state di-key `exchange:symbol` (biar
// gak collision -- symbol beda exchange kebetulan sama gak nyampur), tiap pesan dikasih BADGE
// exchange eksplisit (permintaan Olan: "perlu badge binance dan mexc") biar shareholder gampang
// bedain. MEXC BELUM punya endpoint income-history yang dipetakan di sini -- PnL manual
// close/reduce di MEXC jujur dilaporin "belum kebaca otomatis" (fallback yang UDAH ADA dari
// awal), BUKAN dikarang jadi 0.
//
// Jurnal (Sheet "Journal" GAS): SEMUA event manual dicatat Strategy='manual', Asset=symbol
// (lowercase) -- beda dari Sniper/Nyopet yang asset-nya key pendek ('btc'/'xau'), biar jurnal
// alt-coin/apapun tetep bisa ketulis walau bot gak punya konfigurasi buat symbol itu. `exchange`
// field sekarang DINAMIS ('binance'/'mexc'), dulu di-hardcode 'binance'.

const fs = require('fs');
const { sendWhatsAppToWibowo } = require('./wibowoNotify');
const kaela = require('./kaelaProTraderClient');
// (5 Sep 2026, permintaan Olan: "semua pesan broadcast trading perlu disamakan semua kerangkanya")
// -- template pesan (dan fmtUsd yang dipakainya) SEKARANG PENUH dari darkKaelaLog.js, gak ada lagi
// versi lokal terpisah di sini (dulu fmtUsd lokal SENGAJA beda opsi format, sekarang diseragamin
// -- itu justru inti permintaannya: SATU gaya angka di semua pesan trading, bukan per-file beda).
const { fmtUsdWithIdr, formatManualOpen, formatManualClose, formatManualAdd, formatManualReduce, formatManualFlip, formatHiddenActivity } = require('./darkKaelaLog');
const tradeHistoryStore = require('./tradeHistoryStore');

// WIBOWO_GROUP_ID + saklar pause SEKARANG di wibowoNotify.js (4 Sep 2026, sebelumnya duplikat
// konstanta di sini & multiAccountExecutor.js). KAELA_ACCESS_URL juga gak perlu lokal lagi --
// formatManual*() (darkKaelaLog.js) udah nyelipin link sendiri di tiap pesan.
function dirWord(positionAmt) { return Number(positionAmt) > 0 ? 'buy' : 'sell'; }

function loadState(statePath) {
  if (!fs.existsSync(statePath)) return { positions: {}, lastCheckedAtMs: Date.now() };
  try {
    const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!s.positions) s.positions = {};
    if (!s.lastCheckedAtMs) s.lastCheckedAtMs = Date.now();
    // MIGRASI (3 Sep 2026, nambah dukungan MEXC) -- state LAMA nyimpen key bare symbol
    // ("BTCUSDT"), format BARU "exchange:symbol" ("binance:BTCUSDT") biar gak collision sama
    // MEXC. Tanpa migrasi ini, siklus PERTAMA abis update bakal salah kira SEMUA posisi Binance
    // yang UDAH ketrack "MANUAL OPEN baru" (key lama gak ketemu di lookup key baru) -- broadcast
    // WA palsu ke Wibowo Hedgefund padahal posisinya udah lama ada. Key lama SELALU Binance (dulu
    // exchange lain belum ada), migrasi aman langsung prefix 'binance:'.
    const migrated = {};
    let didMigrate = false;
    for (const key of Object.keys(s.positions)) {
      if (key.includes(':')) { migrated[key] = s.positions[key]; continue; }
      migrated[`binance:${key}`] = s.positions[key];
      didMigrate = true;
    }
    if (didMigrate) {
      console.log('[PositionReconciler] Migrasi state key lama (bare symbol) -> "binance:symbol".');
      s.positions = migrated;
    }
    return s;
  } catch (e) {
    return { positions: {}, lastCheckedAtMs: Date.now() };
  }
}
function saveState(statePath, state) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

// Jumlah income REALIZED_PNL+COMMISSION+FUNDING_FEE Binance buat 1 symbol sejak sinceMs --
// SUMBER KEBENARAN PnL asli (fee kepotong), BUKAN dihitung sendiri dari entry/exit/leverage.
// MEXC BELUM punya endpoint setara yang dipetakan (lihat catatan atas file) -- exchange 'mexc'
// SELALU balikin null (jujur "belum kebaca", bukan 0 yang kesannya beneran impas).
// 4 Sep 2026 (permintaan Olan: "tiap tarikan data binance... simpan di data kita sendiri") --
// SEKARANG lewat tradeHistoryStore.js (SATU cache lokal dipakai bareng runBalanceReports) --
// window reconciler pendek (~15 menit sejak lastCheckedAtMs) jadi 1 panggilan tanpa paginasi udah
// cukup, TAPI tetap disimpen ke store yang sama biar makin lengkap + konsisten sumbernya.
// Sync SEKALI per siklus (dipisah dari realizedPnlSince, 12 Sep 2026) -- fetch getIncomeHistory
// itu SENDIRI udah balikin SEMUA symbol (Binance gak punya filter per-symbol di endpoint ini),
// jadi gak perlu diulang tiap symbol. Dipakai bareng: (1) realizedPnlSince (PnL 1 symbol spesifik),
// (2) _symbolsWithHiddenActivity (nemuin symbol yang KETOUCH tapi gak masuk radar getAllPositions,
// lihat komentar _reconcileOneExchange soal "round-trip tersembunyi").
async function _syncIncomeStore(exchange, client, phone, sinceMs) {
  return tradeHistoryStore.syncIncomeStore(exchange, client, phone, 'real', sinceMs);
}

// (12 Sep 2026, permintaan Olan: "jadi pertanyaan di grup.. kok minus terus.. padahal di riwayat
// aku surplus.. tapi ga ketauan.. apa di followup total pnl today ya?") -- tiap pesan PnL manual
// (Tutup/Kurangin/Balik Arah/Aktivitas Tersembunyi) cuma nunjukin HASIL 1 TRANSAKSI doang -- kalau
// Olan lagi flip cepat berkali-kali, transaksi PER-POTONG sering kecil minus (fee, lihat komentar
// panjang di darkKaelaLog.js soal ini), padahal TOTAL hari itu bisa surplus. Anggota grup cuma
// liat angka minus berulang-ulang tanpa konteks "gambaran besarnya gimana" -- kesan yang salah.
// Fix: hitung total PnL symbol ini HARI INI (kalender WITA, exchange !== TRANSFER -- funding fee
// IKUT kehitung di sini beda dari _extractActiveTradingSymbols, karena tujuannya "gambaran
// ekonomi total", bukan "ada aktivitas apa nggak"), disisipin ke SEMUA pesan yang nunjukin PnL.
// Diekstrak jadi tradeHistoryStore.todaysPnlForSymbol (12 Sep 2026) -- SEKARANG Sniper/Nyopet auto
// juga reuse fungsi yang SAMA (dulu cuma jalur manual reconciler ini yang punya), thin wrapper di
// sini biar semua call site di file ini gak perlu diganti nama.
function _todaysPnlForSymbol(store, symbol, now) {
  return tradeHistoryStore.todaysPnlForSymbol(store, symbol, now);
}

async function realizedPnlSince(exchange, client, phone, symbol, sinceMs, presyncedStore) {
  if (exchange !== 'binance') return null;
  try {
    const store = presyncedStore || await _syncIncomeStore(exchange, client, phone, sinceMs);
    return store.entries
      .filter((e) => e.time >= sinceMs && e.symbol === symbol && e.type !== 'TRANSFER')
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  } catch (e) {
    console.log(`[PositionReconciler] Gagal ambil income history ${symbol}:`, e.message);
    return null; // null = jujur "gak kebaca", BUKAN 0 (0 kesannya beneran impas)
  }
}

// ⛔ BUG NYATA ketemu 12 Sep 2026 (Olan nanya: "kalo aku long short long short terus.. dan aku
// menutup total, berapa lama total akumulasi PnL akan dihitung?") -- jawaban JUJURnya: BISA GAK
// PERNAH SAMA SEKALI. Reconciler ini murni diff 2 snapshot (posisi pas cek terakhir vs sekarang).
// Kalau Olan buka+tutup (atau serangkaian flip yang net-nya balik ke ukuran/arah SAMA) SEMUANYA
// kelar DALAM SATU window ~15 menit, snapshot SEBELUM dan SESUDAH keliatan IDENTIK dari sudut
// pandang getAllPositions() -- diff-nya NOL, gak ada MANUAL OPEN/CLOSE/ADD/REDUCE/FLIP yang
// ke-trigger, PnL beneran (fee+untung/rugi harga) dari seluruh rangkaian itu HILANG TOTAL, gak
// pernah dilaporin ke grup ATAU jurnal. Paling parah buat symbol yang SEBELUMNYA gak pernah
// ketrack (buka-tutup penuh dalam 1 window) -- symbol itu bahkan gak PERNAH masuk `allSymbols`
// sama sekali (gak ada di liveBySymbol krn udah balik 0, gak ada di prevSymbols krn emang baru).
// Fix: pakai income history (getIncomeHistory balikin SEMUA symbol sekaligus, gak butuh posisi
// masih kebuka) buat NEMUIN symbol yang ada aktivitas trading nyata (COMMISSION/REALIZED_PNL,
// BUKAN FUNDING_FEE -- itu biaya pasif otomatis tiap 8 jam buat SEMUA posisi kebuka, bukan tanda
// "Olan ngapa-ngapain") dalam window ini, REGARDLESS posisi net-nya keliatan berubah apa nggak.
function _extractActiveTradingSymbols(store, sinceMs) {
  if (!store) return new Set();
  return new Set(
    store.entries
      .filter((e) => e.time >= sinceMs && (e.type === 'COMMISSION' || e.type === 'REALIZED_PNL'))
      .map((e) => e.symbol)
  );
}

async function writeJournal(entryId, fields) {
  return kaela.recordJournalEntry(fields.phone, fields.mode, { entryId, ...fields })
    .catch((e) => console.log('[PositionReconciler] recordJournalEntry gagal:', e.message));
}

// Badge exchange (BARU, 3 Sep 2026, permintaan Olan "perlu badge binance dan mexc") -- ditempel
// di HEADER tiap pesan manual, biar shareholder langsung tau posisi ini di exchange mana.
const EXCHANGE_BADGE = { binance: '🟨 Binance', mexc: '🔷 MEXC' };

// Diekstrak dari reconcileWibowoPositions (dulu Binance-doang, sekarang dipanggil 2x per siklus --
// sekali per exchange) biar logika diff (open/close/add/reduce/flip) SATU SUMBER, gak diketik
// ulang 2x beda exchange (resiko divergen kalau nanti exchange ke-3 nyusul).
async function _reconcileOneExchange({ exchange, phone, client, touchedSymbols, state, nowMs, idrRate }) {
  const badge = EXCHANGE_BADGE[exchange] || exchange;
  let livePositions;
  try {
    livePositions = await client.getAllPositions();
  } catch (e) {
    console.log(`[PositionReconciler] Gagal ambil getAllPositions (${exchange}):`, e.message);
    return;
  }
  const liveBySymbol = {};
  livePositions.forEach((p) => { liveBySymbol[p.symbol] = p; });

  // Sync income SEKALI per exchange per siklus (12 Sep 2026, fix "round-trip tersembunyi" --
  // lihat komentar panjang di _extractActiveTradingSymbols) -- dipakai NEMUIN symbol yang ada
  // aktivitas trading nyata WALAU gak lagi kebuka SEKARANG dan gak pernah ketrack SEBELUMNYA.
  const incomeStore = await _syncIncomeStore(exchange, client, phone, state.lastCheckedAtMs).catch((e) => {
    console.log(`[PositionReconciler] Gagal sync income history (${exchange}), skip deteksi aktivitas tersembunyi siklus ini:`, e.message);
    return null;
  });
  const activeTradingSymbols = _extractActiveTradingSymbols(incomeStore, state.lastCheckedAtMs);

  const prevSymbols = Object.keys(state.positions).filter((k) => k.startsWith(`${exchange}:`)).map((k) => k.slice(exchange.length + 1));
  const allSymbols = new Set([...Object.keys(liveBySymbol), ...prevSymbols, ...activeTradingSymbols]);

  for (const symbol of allSymbols) {
    const stateKey = `${exchange}:${symbol}`;
    if (touchedSymbols && touchedSymbols.has(symbol)) {
      // Bot sendiri yang megang symbol ini siklus ini -- notify()-nya bot udah cover (broadcast
      // Wibowo otomatis ikut, lihat buildSendWA). Cuma sinkronin snapshot, jangan broadcast dobel.
      const live = liveBySymbol[symbol];
      if (live) {
        const prevEntry = state.positions[stateKey];
        state.positions[stateKey] = { positionAmt: Number(live.positionAmt), entryPrice: Number(live.entryPrice), entryId: prevEntry ? prevEntry.entryId : null, openedAtMs: (prevEntry && prevEntry.openedAtMs) || nowMs };
      } else {
        delete state.positions[stateKey];
      }
      continue;
    }

    const live = liveBySymbol[symbol];
    const prev = state.positions[stateKey];
    const liveAmt = live ? Number(live.positionAmt) : 0;
    const prevAmt = prev ? Number(prev.positionAmt) : 0;

    if (prevAmt === 0 && liveAmt !== 0) {
      // MANUAL OPEN -- gak pernah kecatat sebelumnya, tiba-tiba ada, BUKAN bot yang buka. Bisa
      // asset APAPUN -- bot gak perlu "kenal" symbol-nya.
      const entryId = `manual-${exchange}-${symbol}-${nowMs}`;
      const marginUsd = (Number(live.leverage) > 0 && live.notional) ? Math.abs(Number(live.notional)) / Number(live.leverage) : 0;
      await writeJournal(entryId, {
        phone, mode: 'real', strategy: 'manual', asset: symbol.toLowerCase(), direction: dirWord(liveAmt),
        entryPrice: Number(live.entryPrice), leverage: Number(live.leverage) || 0, marginUsd,
        status: 'open', openedAt: new Date(nowMs).toISOString(), note: 'Manual Olan', exchange,
      });
      const msg = formatManualOpen({ exchangeBadge: badge, symbol, direction: dirWord(liveAmt), entryPrice: Number(live.entryPrice), leverage: Number(live.leverage) || 0, marginUsd, nilaiPosisi: Math.abs(Number(live.notional)) || 0 }, idrRate);
      console.log(`[PositionReconciler] MANUAL OPEN ${badge} ${symbol} @ ${live.entryPrice}`);
      await sendWhatsAppToWibowo(msg).catch((e) => console.log('[PositionReconciler] Gagal kirim WA (manual open):', e.message));
      state.positions[stateKey] = { positionAmt: liveAmt, entryPrice: Number(live.entryPrice), entryId, openedAtMs: nowMs };
    } else if (prevAmt !== 0 && liveAmt === 0) {
      // MANUAL CLOSE (full) -- posisi yang tadinya kecatat sekarang ilang total.
      // ⛔ FIX BUG NYATA 12 Sep 2026 (Olan: "riwayat jurnal kalah semua, padahal aslinya surplus")
      // -- SEBELUMNYA pakai state.lastCheckedAtMs (~siklus TERAKHIR doang, ~15 menit), BUKAN
      // prev.openedAtMs (posisi ini SEBENARNYA dibuka). Kalau posisi kepegang BERJAM-JAM lintas
      // banyak siklus reconcile tanpa ADD/REDUCE/FLIP (cuma HOLD diam), PnL dari siklus2 awal itu
      // HILANG TOTAL dari hitungan -- cuma window siklus terakhir sebelum close yang kehitung.
      // Dibuktikan lewat rekonsiliasi manual ke income history asli Binance (matchJournalToIncomeV2,
      // 12 Sep 2026): 22 entry BTCUSDC/BTCUSDT selisih drastis dari angka asli (mis. -$0.99 tercatat
      // vs -$14.82 asli, atau -$0.46 tercatat vs +$15.59 asli) -- 24 entry sudah dikoreksi manual ke
      // Sheet. `_syncIncomeStore` nyimpen store PERSISTEN (tradeHistoryStore.js), jadi filter mundur
      // ke prev.openedAtMs AMAN walau lebih jauh dari state.lastCheckedAtMs -- datanya udah ke-cache.
      const pnl = await realizedPnlSince(exchange, client, phone, symbol, prev.openedAtMs || state.lastCheckedAtMs, incomeStore);
      if (prev.entryId) {
        await kaela.updateJournalEntry(prev.entryId, { status: 'closed', closedAt: new Date(nowMs).toISOString(), pnlUsd: pnl || 0 })
          .catch((e) => console.log('[PositionReconciler] updateJournalEntry gagal:', e.message));
      }
      const todaysPnl = _todaysPnlForSymbol(incomeStore, symbol, new Date(nowMs));
      const msg = formatManualClose({ exchangeBadge: badge, symbol, direction: dirWord(prevAmt), prevEntryPrice: Number(prev.entryPrice), pnlUsd: pnl, todaysPnl }, idrRate);
      console.log(`[PositionReconciler] MANUAL CLOSE ${badge} ${symbol}, PnL=${pnl}`);
      await sendWhatsAppToWibowo(msg).catch((e) => console.log('[PositionReconciler] Gagal kirim WA (manual close):', e.message));
      delete state.positions[stateKey];
    } else if (prevAmt !== 0 && liveAmt !== 0 && Math.sign(prevAmt) === Math.sign(liveAmt) && Math.abs(liveAmt) > Math.abs(prevAmt)) {
      // MANUAL ADD -- arah SAMA, size nambah (skenario Olan: short di 75000, harga naik ke 80000,
      // re-short -- size nambah, entry rata-rata exchange sendiri yang ngitung).
      const addMarginUsd = (Number(live.leverage) > 0 && live.notional) ? Math.abs(Number(live.notional)) / Number(live.leverage) : 0;
      const msg = formatManualAdd({ exchangeBadge: badge, symbol, direction: dirWord(liveAmt), entryPrice: Number(live.entryPrice), prevEntryPrice: Number(prev.entryPrice), leverage: Number(live.leverage) || 0, marginUsd: addMarginUsd, nilaiPosisi: Math.abs(Number(live.notional)) || 0 }, idrRate);
      console.log(`[PositionReconciler] MANUAL ADD ${badge} ${symbol}: entry ${prev.entryPrice} -> ${live.entryPrice}`);
      await sendWhatsAppToWibowo(msg).catch((e) => console.log('[PositionReconciler] Gagal kirim WA (manual add):', e.message));
      if (prev.entryId) {
        await kaela.updateJournalEntry(prev.entryId, { entryPrice: Number(live.entryPrice), leverage: Number(live.leverage) || 0 })
          .catch((e) => console.log('[PositionReconciler] updateJournalEntry (add) gagal:', e.message));
      }
      state.positions[stateKey] = { positionAmt: liveAmt, entryPrice: Number(live.entryPrice), entryId: prev.entryId, openedAtMs: prev.openedAtMs || nowMs };
    } else if (prevAmt !== 0 && liveAmt !== 0 && Math.sign(prevAmt) === Math.sign(liveAmt) && Math.abs(liveAmt) < Math.abs(prevAmt)) {
      // MANUAL REDUCE (partial close) -- arah sama, size berkurang tapi belum nol. SENGAJA TETAP
      // state.lastCheckedAtMs (BUKAN prev.openedAtMs kayak CLOSE/FLIP di bawah) -- pnl di sini
      // CUMA buat pesan WA "PnL sebagian" (potongan INI doang), gak pernah ditulis ke Sheet Journal
      // (PnlUsd final Sheet baru diisi pas posisi BENERAN close/flip, udah nyakup seluruh masa
      // pegang lewat prev.openedAtMs di situ) -- kalau dipakein prev.openedAtMs di sini juga,
      // pesan tiap reduce jadi nunjukin PnL KUMULATIF sejak awal buka, bukan potongan ini doang.
      const pnl = await realizedPnlSince(exchange, client, phone, symbol, state.lastCheckedAtMs, incomeStore);
      const remainMarginUsd = (Number(live.leverage) > 0 && live.notional) ? Math.abs(Number(live.notional)) / Number(live.leverage) : 0;
      const todaysPnl = _todaysPnlForSymbol(incomeStore, symbol, new Date(nowMs));
      const msg = formatManualReduce({ exchangeBadge: badge, symbol, direction: dirWord(liveAmt), entryPrice: Number(live.entryPrice), marginUsd: remainMarginUsd, nilaiPosisi: Math.abs(Number(live.notional)) || 0, pnlUsd: pnl, todaysPnl }, idrRate);
      console.log(`[PositionReconciler] MANUAL REDUCE ${badge} ${symbol}, PnL sebagian=${pnl}`);
      await sendWhatsAppToWibowo(msg).catch((e) => console.log('[PositionReconciler] Gagal kirim WA (manual reduce):', e.message));
      state.positions[stateKey] = { positionAmt: liveAmt, entryPrice: Number(live.entryPrice), entryId: prev.entryId, openedAtMs: prev.openedAtMs || nowMs };
    } else if (prevAmt !== 0 && liveAmt !== 0 && Math.sign(prevAmt) !== Math.sign(liveAmt)) {
      // FLIP arah (short jadi long / sebaliknya) -- exchange eksekusi ini 1 order gede (bukan 2
      // order kepisah) -- hitung PnL close arah lama, catat posisi baru sebagai entry FRESH.
      // Fix sama kayak MANUAL CLOSE di atas (12 Sep 2026) -- posisi ARAH LAMA yang lagi di-close di
      // sini bisa aja kepegang lintas banyak siklus diam, prev.openedAtMs nyakup SELURUH masa pegang
      // arah lama itu (BUKAN cuma siklus terakhir kayak state.lastCheckedAtMs).
      const pnl = await realizedPnlSince(exchange, client, phone, symbol, prev.openedAtMs || state.lastCheckedAtMs, incomeStore);
      if (prev.entryId) {
        await kaela.updateJournalEntry(prev.entryId, { status: 'closed', closedAt: new Date(nowMs).toISOString(), pnlUsd: pnl || 0 })
          .catch((e) => console.log('[PositionReconciler] updateJournalEntry (flip close) gagal:', e.message));
      }
      const newEntryId = `manual-${exchange}-${symbol}-${nowMs}`;
      const marginUsd = (Number(live.leverage) > 0 && live.notional) ? Math.abs(Number(live.notional)) / Number(live.leverage) : 0;
      await writeJournal(newEntryId, {
        phone, mode: 'real', strategy: 'manual', asset: symbol.toLowerCase(), direction: dirWord(liveAmt),
        entryPrice: Number(live.entryPrice), leverage: Number(live.leverage) || 0, marginUsd,
        status: 'open', openedAt: new Date(nowMs).toISOString(), note: 'Manual Olan', exchange,
      });
      const todaysPnl = _todaysPnlForSymbol(incomeStore, symbol, new Date(nowMs));
      const msg = formatManualFlip({ exchangeBadge: badge, symbol, prevDirection: dirWord(prevAmt), direction: dirWord(liveAmt), entryPrice: Number(live.entryPrice), leverage: Number(live.leverage) || 0, marginUsd, nilaiPosisi: Math.abs(Number(live.notional)) || 0, pnlUsd: pnl, todaysPnl }, idrRate);
      console.log(`[PositionReconciler] MANUAL FLIP ${badge} ${symbol}, PnL posisi lama=${pnl}`);
      await sendWhatsAppToWibowo(msg).catch((e) => console.log('[PositionReconciler] Gagal kirim WA (manual flip):', e.message));
      state.positions[stateKey] = { positionAmt: liveAmt, entryPrice: Number(live.entryPrice), entryId: newEntryId, openedAtMs: nowMs };
    } else if (activeTradingSymbols.has(symbol)) {
      // ⛔ FIX BUG NYATA 12 Sep 2026 (Olan: "kalo aku long short long short terus.. dan aku
      // menutup total, berapa lama total akumulasi PnL akan dihitung?") -- posisi NET keliatan
      // GAK BERUBAH dari snapshot terakhir (termasuk 0->0, buka-tutup PENUH dalam 1 window ~15
      // menit) TAPI kedetect ADA aktivitas trading nyata (COMMISSION/REALIZED_PNL) dari income
      // history -- tanpa cabang ini, PnL rangkaian itu HILANG TOTAL, gak pernah kelaporin
      // kemanapun (lihat komentar panjang _extractActiveTradingSymbols). `pnl === null` (gagal
      // baca) ATAU nyaris nol (<0.5 sen, funding-fee-doang/noise) -- SENGAJA gak kirim WA, biar
      // gak spam tiap symbol yang cuma numpang lewat allSymbols krn kena funding.
      const pnl = await realizedPnlSince(exchange, client, phone, symbol, state.lastCheckedAtMs, incomeStore);
      if (pnl !== null && Math.abs(pnl) > 0.005) {
        const todaysPnl = _todaysPnlForSymbol(incomeStore, symbol, new Date(nowMs));
        const msg = formatHiddenActivity({ exchangeBadge: badge, symbol, pnlUsd: pnl, stillOpen: liveAmt !== 0, todaysPnl }, idrRate);
        console.log(`[PositionReconciler] AKTIVITAS TERSEMBUNYI ${badge} ${symbol} (posisi net gak berubah, round-trip dalam 1 window) -- PnL=${pnl}`);
        await sendWhatsAppToWibowo(msg).catch((e) => console.log('[PositionReconciler] Gagal kirim WA (hidden activity):', e.message));
      }
    }
    // else: gak ada perubahan DAN gak ada aktivitas trading kedetek -- beneran gak ada yang perlu dilaporin.
  }
}

// `mexcClient` (BARU, 3 Sep 2026) -- OPSIONAL, kalau null/gak dioper cuma Binance yang dicek
// (mundur-kompatibel). Kalau dioper stub "belum disetup" (lihat multiAccountExecutor.js
// _mexcNotConfiguredStub), getAllPositions()-nya reject rapi -- ketangkep try/catch di
// _reconcileOneExchange, JANGAN gugurin Binance cuma gara-gara MEXC belum disetup.
async function reconcileWibowoPositions({ phone, client, mexcClient, touchedSymbols, statePath, idrRate }) {
  // BUG ketemu SEBELUM live (2-3 Sep 2026) -- run PERTAMA kali (state file belum ada), posisi yang
  // UDAH kebuka DULUAN (misal posisi Nyopet BTC yang bot sendiri buka dari 31 Agustus, masih
  // floating tanpa event baru siklus ini) bakal salah kedeteksi "MANUAL OPEN" krn state.positions
  // kosong = "gak pernah kecatat" secara literal, padahal cuma "sistem ini baru pertama jalan".
  // Fix: run pertama CUMA nyimpen snapshot diam-diam (gak broadcast/gak tulis Journal apapun) --
  // baseline yang bener baru kebentuk abis siklus ini, perbandingan jujur mulai siklus BERIKUTNYA.
  const isFirstRun = !fs.existsSync(statePath);
  const state = loadState(statePath);
  const nowMs = Date.now();

  if (isFirstRun) {
    const sources = [{ exchange: 'binance', client }, ...(mexcClient ? [{ exchange: 'mexc', client: mexcClient }] : [])];
    let total = 0;
    for (const { exchange, client: exClient } of sources) {
      try {
        const livePositions = await exClient.getAllPositions();
        livePositions.forEach((p) => { state.positions[`${exchange}:${p.symbol}`] = { positionAmt: Number(p.positionAmt), entryPrice: Number(p.entryPrice), entryId: null, openedAtMs: nowMs }; });
        total += livePositions.length;
      } catch (e) {
        console.log(`[PositionReconciler] Run pertama, gagal snapshot ${exchange} (dilewatin, dicoba lagi siklus berikutnya):`, e.message);
      }
    }
    console.log(`[PositionReconciler] Run pertama -- nyimpen snapshot baseline (${total} posisi), gak broadcast apa-apa.`);
    state.lastCheckedAtMs = nowMs;
    saveState(statePath, state);
    return;
  }

  await _reconcileOneExchange({ exchange: 'binance', phone, client, touchedSymbols, state, nowMs, idrRate });
  if (mexcClient) {
    await _reconcileOneExchange({ exchange: 'mexc', phone, client: mexcClient, touchedSymbols, state, nowMs, idrRate });
  }

  state.lastCheckedAtMs = nowMs;
  saveState(statePath, state);
}

module.exports = { reconcileWibowoPositions };
