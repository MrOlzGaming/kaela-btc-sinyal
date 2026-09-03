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
const { sendWhatsApp } = require('./fonnte');
const kaela = require('./kaelaProTraderClient');
// 3 Sep 2026 -- fmtUsdWithIdr PINDAH ke darkKaelaLog.js (SATU sumber, dipakai Sniper/Nyopet juga
// sekarang, permintaan Olan "untuk pnl sertakan idr nya"). fmtUsd LOKAL TETAP DIPERTAHANKAN di
// sini (beda opsi format dikit -- minimumFractionDigits:2 selalu, punya darkKaelaLog.js enggak --
// gak worth diseragamin, resiko ubah tampilan angka lain yang udah kepake lama di file ini).
const { fmtUsdWithIdr } = require('./darkKaelaLog');

const WIBOWO_GROUP_ID = '120363430640997174@g.us';
const KAELA_ACCESS_URL = 'https://kaela-access.netlify.app/';

function fmtUsd(n) {
  const v = Number(n) || 0;
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pnlSign(n) { return Number(n) >= 0 ? '+' : ''; }
function dirLabel(positionAmt) { return Number(positionAmt) > 0 ? '🟢 LONG' : '🔴 SHORT'; }
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
async function realizedPnlSince(exchange, client, symbol, sinceMs) {
  if (exchange !== 'binance') return null;
  try {
    const income = await client.getIncomeHistory(sinceMs, 1000);
    let total = 0;
    (income || []).forEach((row) => {
      if (row.symbol !== symbol) return;
      if (row.incomeType === 'TRANSFER') return; // setor/tarik dana, bukan hasil trading
      total += parseFloat(row.income) || 0;
    });
    return total;
  } catch (e) {
    console.log(`[PositionReconciler] Gagal ambil income history ${symbol}:`, e.message);
    return null; // null = jujur "gak kebaca", BUKAN 0 (0 kesannya beneran impas)
  }
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

  const prevSymbols = Object.keys(state.positions).filter((k) => k.startsWith(`${exchange}:`)).map((k) => k.slice(exchange.length + 1));
  const allSymbols = new Set([...Object.keys(liveBySymbol), ...prevSymbols]);

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
      const msg = `🙋 MANUAL (luar sistem) · ${badge} -- Buka Posisi\n\n${dirLabel(liveAmt)} ${symbol} @ ${fmtUsd(live.entryPrice)}\nLeverage ${live.leverage || '-'}x\nAlasan: Manual di luar sistem (kedetect di exchange, bukan lewat web -- exchange gak ngasih tau alasannya)\n\n🔗 ${KAELA_ACCESS_URL}`;
      console.log(`[PositionReconciler] MANUAL OPEN ${badge} ${symbol} @ ${live.entryPrice}`);
      await sendWhatsApp(msg, WIBOWO_GROUP_ID).catch((e) => console.log('[PositionReconciler] Gagal kirim WA (manual open):', e.message));
      state.positions[stateKey] = { positionAmt: liveAmt, entryPrice: Number(live.entryPrice), entryId, openedAtMs: nowMs };
    } else if (prevAmt !== 0 && liveAmt === 0) {
      // MANUAL CLOSE (full) -- posisi yang tadinya kecatat sekarang ilang total.
      const pnl = await realizedPnlSince(exchange, client, symbol, state.lastCheckedAtMs);
      if (prev.entryId) {
        await kaela.updateJournalEntry(prev.entryId, { status: 'closed', closedAt: new Date(nowMs).toISOString(), pnlUsd: pnl || 0 })
          .catch((e) => console.log('[PositionReconciler] updateJournalEntry gagal:', e.message));
      }
      const pnlLine = pnl === null ? '⚠️ PnL belum kebaca otomatis -- cek manual di exchange.' : `PnL: ${pnlSign(pnl)}${fmtUsdWithIdr(pnl, idrRate)}`;
      const msg = `🙋 MANUAL (luar sistem) · ${badge} -- Tutup Posisi\n\n${symbol} ditutup (entry sebelumnya ${fmtUsd(prev.entryPrice)})\n${pnlLine}\nAlasan: Manual di luar sistem (kedetect di exchange, bukan lewat web -- exchange gak ngasih tau alasannya)\n\n🔗 ${KAELA_ACCESS_URL}`;
      console.log(`[PositionReconciler] MANUAL CLOSE ${badge} ${symbol}, PnL=${pnl}`);
      await sendWhatsApp(msg, WIBOWO_GROUP_ID).catch((e) => console.log('[PositionReconciler] Gagal kirim WA (manual close):', e.message));
      delete state.positions[stateKey];
    } else if (prevAmt !== 0 && liveAmt !== 0 && Math.sign(prevAmt) === Math.sign(liveAmt) && Math.abs(liveAmt) > Math.abs(prevAmt)) {
      // MANUAL ADD -- arah SAMA, size nambah (skenario Olan: short di 75000, harga naik ke 80000,
      // re-short -- size nambah, entry rata-rata exchange sendiri yang ngitung).
      const msg = `🙋 MANUAL (luar sistem) · ${badge} -- Nambah Posisi\n\n${dirLabel(liveAmt)} ${symbol}\nEntry rata-rata sekarang: ${fmtUsd(live.entryPrice)} (sebelumnya ${fmtUsd(prev.entryPrice)})\nLeverage ${live.leverage || '-'}x\nAlasan: Manual di luar sistem (kedetect di exchange, bukan lewat web -- exchange gak ngasih tau alasannya)\n\n🔗 ${KAELA_ACCESS_URL}`;
      console.log(`[PositionReconciler] MANUAL ADD ${badge} ${symbol}: entry ${prev.entryPrice} -> ${live.entryPrice}`);
      await sendWhatsApp(msg, WIBOWO_GROUP_ID).catch((e) => console.log('[PositionReconciler] Gagal kirim WA (manual add):', e.message));
      if (prev.entryId) {
        await kaela.updateJournalEntry(prev.entryId, { entryPrice: Number(live.entryPrice), leverage: Number(live.leverage) || 0 })
          .catch((e) => console.log('[PositionReconciler] updateJournalEntry (add) gagal:', e.message));
      }
      state.positions[stateKey] = { positionAmt: liveAmt, entryPrice: Number(live.entryPrice), entryId: prev.entryId, openedAtMs: prev.openedAtMs || nowMs };
    } else if (prevAmt !== 0 && liveAmt !== 0 && Math.sign(prevAmt) === Math.sign(liveAmt) && Math.abs(liveAmt) < Math.abs(prevAmt)) {
      // MANUAL REDUCE (partial close) -- arah sama, size berkurang tapi belum nol.
      const pnl = await realizedPnlSince(exchange, client, symbol, state.lastCheckedAtMs);
      const pnlLine = pnl === null ? '⚠️ PnL bagian ini belum kebaca otomatis -- cek manual di exchange.' : `PnL bagian yang ditutup: ${pnlSign(pnl)}${fmtUsdWithIdr(pnl, idrRate)}`;
      const msg = `🙋 MANUAL (luar sistem) · ${badge} -- Kurangin Posisi\n\n${symbol} sebagian ditutup\n${pnlLine}\nSisa posisi: ${dirLabel(liveAmt)} @ ${fmtUsd(live.entryPrice)}\nAlasan: Manual di luar sistem (kedetect di exchange, bukan lewat web -- exchange gak ngasih tau alasannya)\n\n🔗 ${KAELA_ACCESS_URL}`;
      console.log(`[PositionReconciler] MANUAL REDUCE ${badge} ${symbol}, PnL sebagian=${pnl}`);
      await sendWhatsApp(msg, WIBOWO_GROUP_ID).catch((e) => console.log('[PositionReconciler] Gagal kirim WA (manual reduce):', e.message));
      state.positions[stateKey] = { positionAmt: liveAmt, entryPrice: Number(live.entryPrice), entryId: prev.entryId, openedAtMs: prev.openedAtMs || nowMs };
    } else if (prevAmt !== 0 && liveAmt !== 0 && Math.sign(prevAmt) !== Math.sign(liveAmt)) {
      // FLIP arah (short jadi long / sebaliknya) -- exchange eksekusi ini 1 order gede (bukan 2
      // order kepisah) -- hitung PnL close arah lama, catat posisi baru sebagai entry FRESH.
      const pnl = await realizedPnlSince(exchange, client, symbol, state.lastCheckedAtMs);
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
      const pnlLine = pnl === null ? '⚠️ PnL belum kebaca otomatis -- cek manual di exchange.' : `PnL posisi lama: ${pnlSign(pnl)}${fmtUsdWithIdr(pnl, idrRate)}`;
      const msg = `🙋 MANUAL (luar sistem) · ${badge} -- Balik Arah\n\n${symbol}: ${dirLabel(prevAmt)} -> ${dirLabel(liveAmt)}\n${pnlLine}\nPosisi baru: @ ${fmtUsd(live.entryPrice)}, leverage ${live.leverage || '-'}x\nAlasan: Manual di luar sistem (kedetect di exchange, bukan lewat web -- exchange gak ngasih tau alasannya)\n\n🔗 ${KAELA_ACCESS_URL}`;
      console.log(`[PositionReconciler] MANUAL FLIP ${badge} ${symbol}, PnL posisi lama=${pnl}`);
      await sendWhatsApp(msg, WIBOWO_GROUP_ID).catch((e) => console.log('[PositionReconciler] Gagal kirim WA (manual flip):', e.message));
      state.positions[stateKey] = { positionAmt: liveAmt, entryPrice: Number(live.entryPrice), entryId: newEntryId, openedAtMs: nowMs };
    }
    // else: gak ada perubahan (prevAmt===0 && liveAmt===0, atau persis sama) -- gak ada yang perlu dilaporin.
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
