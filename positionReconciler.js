// positionReconciler.js (2-3 Sep 2026, permintaan Olan) -- "pengawas posisi" KHUSUS akun REAL
// Olan sendiri (dasar saham Wibowo Hedgefund). Tujuan: kalau Olan buka/nambah/kurangin/tutup
// posisi LANGSUNG di Binance (bukan lewat bot) -- TERMASUK aset yang bot SAMA SEKALI GAK
// DUKUNG (Olan: "kaela ga bisa trading selain emas dan btc.. misal trading zilliqa, walau itu di
// luar mode, apa akan tetep ada pesan?.. aku pengennya tetep dapet pesan itu.. jurnal juga tetep
// kecatat") -- sistem tetap TAU, kirim WA ke grup Wibowo Hedgefund, DAN catat ke Jurnal.
//
// Cara kerja: tiap siklus, ambil SEMUA posisi live via client.getAllPositions() (endpoint
// Binance TANPA filter symbol -- balikin APAPUN yang lagi kebuka, bukan cuma BTC/Emas yang bot
// kenal), bandingin sama snapshot TERAKHIR (state file, per symbol + entryId Journal-nya).
// Symbol yang BENERAN disentuh bot siklus ini (touchedSymbols, dari onEvent) di-skip -- broadcast
// buat itu udah dihandle notify() bot sendiri (lihat multiAccountExecutor.js buildSendWA, sekarang
// broadcast ke Wibowo juga). Symbol LAIN yang berubah -> Olan yang ngutak-atik manual (asset
// APAPUN, bot gak perlu "kenal" symbol-nya buat sistem ini bisa mantau).
//
// PnL buat REDUCE/CLOSE manual DIAMBIL DARI INCOME HISTORY BINANCE ASLI (getIncomeHistory,
// REALIZED_PNL+COMMISSION+FUNDING_FEE, dijumlah sejak lastCheckedAtMs) -- permintaan Olan: "angka
// jujur dari binance langsung. bukan perhitungan sendiri" (fee kepotong beneran, bukan estimasi).
//
// Jurnal (Sheet "Journal" GAS): SEMUA event manual dicatat Strategy='manual', Asset=symbol
// (lowercase) -- beda dari Sniper/Nyopet yang asset-nya key pendek ('btc'/'xau'), biar jurnal
// alt-coin/apapun tetep bisa ketulis walau bot gak punya konfigurasi buat symbol itu.

const fs = require('fs');
const { sendWhatsApp } = require('./fonnte');
const kaela = require('./kaelaProTraderClient');

const WIBOWO_GROUP_ID = '120363430640997174@g.us';
const KAELA_ACCESS_URL = 'https://kaela-access.netlify.app/';

function fmtUsd(n) {
  const v = Number(n) || 0;
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Rp disertain (permintaan Olan: "pnl yang betul dalam dolar dan dalam kurung rupiah") -- rate
// dioper dari caller (kaelaProTraderClient.getUsdIdrRate) -- gagal/null -> fallback USD doang.
function fmtUsdWithIdr(n, idrRate) {
  const usdText = fmtUsd(n);
  if (!idrRate) return usdText;
  const idr = Math.round((Number(n) || 0) * idrRate);
  return `${usdText} (${idr < 0 ? '-Rp' : 'Rp'}${Math.abs(idr).toLocaleString('id-ID')})`;
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
async function realizedPnlSince(client, symbol, sinceMs) {
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

async function reconcileWibowoPositions({ phone, client, touchedSymbols, statePath, idrRate }) {
  // BUG ketemu SEBELUM live (2-3 Sep 2026) -- run PERTAMA kali (state file belum ada), posisi yang
  // UDAH kebuka DULUAN (misal posisi Nyopet BTC yang bot sendiri buka dari 31 Agustus, masih
  // floating tanpa event baru siklus ini) bakal salah kedeteksi "MANUAL OPEN" krn state.positions
  // kosong = "gak pernah kecatat" secara literal, padahal cuma "sistem ini baru pertama jalan".
  // Fix: run pertama CUMA nyimpen snapshot diam-diam (gak broadcast/gak tulis Journal apapun) --
  // baseline yang bener baru kebentuk abis siklus ini, perbandingan jujur mulai siklus BERIKUTNYA.
  const isFirstRun = !fs.existsSync(statePath);
  const state = loadState(statePath);
  const nowMs = Date.now();

  let livePositions;
  try {
    livePositions = await client.getAllPositions();
  } catch (e) {
    console.log('[PositionReconciler] Gagal ambil getAllPositions:', e.message);
    return;
  }
  const liveBySymbol = {};
  livePositions.forEach((p) => { liveBySymbol[p.symbol] = p; });

  if (isFirstRun) {
    console.log(`[PositionReconciler] Run pertama -- nyimpen snapshot baseline (${livePositions.length} posisi), gak broadcast apa-apa.`);
    livePositions.forEach((p) => {
      state.positions[p.symbol] = { positionAmt: Number(p.positionAmt), entryPrice: Number(p.entryPrice), entryId: null, openedAtMs: nowMs };
    });
    state.lastCheckedAtMs = nowMs;
    saveState(statePath, state);
    return;
  }

  const allSymbols = new Set([...Object.keys(liveBySymbol), ...Object.keys(state.positions)]);

  for (const symbol of allSymbols) {
    if (touchedSymbols && touchedSymbols.has(symbol)) {
      // Bot sendiri yang megang symbol ini siklus ini -- notify()-nya bot udah cover (broadcast
      // Wibowo otomatis ikut, lihat buildSendWA). Cuma sinkronin snapshot, jangan broadcast dobel.
      const live = liveBySymbol[symbol];
      if (live) {
        const prevEntry = state.positions[symbol];
        state.positions[symbol] = { positionAmt: Number(live.positionAmt), entryPrice: Number(live.entryPrice), entryId: prevEntry ? prevEntry.entryId : null, openedAtMs: (prevEntry && prevEntry.openedAtMs) || nowMs };
      } else {
        delete state.positions[symbol];
      }
      continue;
    }

    const live = liveBySymbol[symbol];
    const prev = state.positions[symbol];
    const liveAmt = live ? Number(live.positionAmt) : 0;
    const prevAmt = prev ? Number(prev.positionAmt) : 0;

    if (prevAmt === 0 && liveAmt !== 0) {
      // MANUAL OPEN -- gak pernah kecatat sebelumnya, tiba-tiba ada, BUKAN bot yang buka. Bisa
      // asset APAPUN (BTC/Emas/ZIL/dll) -- bot gak perlu "kenal" symbol-nya.
      const entryId = `manual-${symbol}-${nowMs}`;
      const marginUsd = (Number(live.leverage) > 0 && live.notional) ? Math.abs(Number(live.notional)) / Number(live.leverage) : 0;
      await writeJournal(entryId, {
        phone, mode: 'real', strategy: 'manual', asset: symbol.toLowerCase(), direction: dirWord(liveAmt),
        entryPrice: Number(live.entryPrice), leverage: Number(live.leverage) || 0, marginUsd,
        status: 'open', openedAt: new Date(nowMs).toISOString(), note: 'Manual Olan', exchange: 'binance',
      });
      const msg = `🙋 Wibowo Hedgefund -- Buka Posisi\n\n${dirLabel(liveAmt)} ${symbol} @ ${fmtUsd(live.entryPrice)}\nLeverage ${live.leverage || '-'}x\nAlasan: Manual Olan\n\n🔗 ${KAELA_ACCESS_URL}`;
      console.log(`[PositionReconciler] MANUAL OPEN ${symbol} @ ${live.entryPrice}`);
      await sendWhatsApp(msg, WIBOWO_GROUP_ID).catch((e) => console.log('[PositionReconciler] Gagal kirim WA (manual open):', e.message));
      state.positions[symbol] = { positionAmt: liveAmt, entryPrice: Number(live.entryPrice), entryId, openedAtMs: nowMs };
    } else if (prevAmt !== 0 && liveAmt === 0) {
      // MANUAL CLOSE (full) -- posisi yang tadinya kecatat sekarang ilang total.
      const pnl = await realizedPnlSince(client, symbol, state.lastCheckedAtMs);
      if (prev.entryId) {
        await kaela.updateJournalEntry(prev.entryId, { status: 'closed', closedAt: new Date(nowMs).toISOString(), pnlUsd: pnl || 0 })
          .catch((e) => console.log('[PositionReconciler] updateJournalEntry gagal:', e.message));
      }
      const pnlLine = pnl === null ? '⚠️ PnL belum kebaca otomatis -- cek manual di exchange.' : `PnL: ${pnlSign(pnl)}${fmtUsdWithIdr(pnl, idrRate)}`;
      const msg = `🙋 Wibowo Hedgefund -- Tutup Posisi\n\n${symbol} ditutup (entry sebelumnya ${fmtUsd(prev.entryPrice)})\n${pnlLine}\nAlasan: Manual Olan\n\n🔗 ${KAELA_ACCESS_URL}`;
      console.log(`[PositionReconciler] MANUAL CLOSE ${symbol}, PnL=${pnl}`);
      await sendWhatsApp(msg, WIBOWO_GROUP_ID).catch((e) => console.log('[PositionReconciler] Gagal kirim WA (manual close):', e.message));
      delete state.positions[symbol];
    } else if (prevAmt !== 0 && liveAmt !== 0 && Math.sign(prevAmt) === Math.sign(liveAmt) && Math.abs(liveAmt) > Math.abs(prevAmt)) {
      // MANUAL ADD -- arah SAMA, size nambah (skenario Olan: short di 75000, harga naik ke 80000,
      // re-short -- size nambah, entry rata-rata Binance sendiri yang ngitung).
      const msg = `🙋 Wibowo Hedgefund -- Nambah Posisi\n\n${dirLabel(liveAmt)} ${symbol}\nEntry rata-rata sekarang: ${fmtUsd(live.entryPrice)} (sebelumnya ${fmtUsd(prev.entryPrice)})\nLeverage ${live.leverage || '-'}x\nAlasan: Manual Olan\n\n🔗 ${KAELA_ACCESS_URL}`;
      console.log(`[PositionReconciler] MANUAL ADD ${symbol}: entry ${prev.entryPrice} -> ${live.entryPrice}`);
      await sendWhatsApp(msg, WIBOWO_GROUP_ID).catch((e) => console.log('[PositionReconciler] Gagal kirim WA (manual add):', e.message));
      if (prev.entryId) {
        await kaela.updateJournalEntry(prev.entryId, { entryPrice: Number(live.entryPrice), leverage: Number(live.leverage) || 0 })
          .catch((e) => console.log('[PositionReconciler] updateJournalEntry (add) gagal:', e.message));
      }
      state.positions[symbol] = { positionAmt: liveAmt, entryPrice: Number(live.entryPrice), entryId: prev.entryId, openedAtMs: prev.openedAtMs || nowMs };
    } else if (prevAmt !== 0 && liveAmt !== 0 && Math.sign(prevAmt) === Math.sign(liveAmt) && Math.abs(liveAmt) < Math.abs(prevAmt)) {
      // MANUAL REDUCE (partial close) -- arah sama, size berkurang tapi belum nol.
      const pnl = await realizedPnlSince(client, symbol, state.lastCheckedAtMs);
      const pnlLine = pnl === null ? '⚠️ PnL bagian ini belum kebaca otomatis -- cek manual di exchange.' : `PnL bagian yang ditutup: ${pnlSign(pnl)}${fmtUsdWithIdr(pnl, idrRate)}`;
      const msg = `🙋 Wibowo Hedgefund -- Kurangin Posisi\n\n${symbol} sebagian ditutup\n${pnlLine}\nSisa posisi: ${dirLabel(liveAmt)} @ ${fmtUsd(live.entryPrice)}\nAlasan: Manual Olan\n\n🔗 ${KAELA_ACCESS_URL}`;
      console.log(`[PositionReconciler] MANUAL REDUCE ${symbol}, PnL sebagian=${pnl}`);
      await sendWhatsApp(msg, WIBOWO_GROUP_ID).catch((e) => console.log('[PositionReconciler] Gagal kirim WA (manual reduce):', e.message));
      state.positions[symbol] = { positionAmt: liveAmt, entryPrice: Number(live.entryPrice), entryId: prev.entryId, openedAtMs: prev.openedAtMs || nowMs };
    } else if (prevAmt !== 0 && liveAmt !== 0 && Math.sign(prevAmt) !== Math.sign(liveAmt)) {
      // FLIP arah (short jadi long / sebaliknya) -- Binance eksekusi ini 1 order gede (bukan 2
      // order kepisah) -- hitung PnL close arah lama, catat posisi baru sebagai entry FRESH.
      const pnl = await realizedPnlSince(client, symbol, state.lastCheckedAtMs);
      if (prev.entryId) {
        await kaela.updateJournalEntry(prev.entryId, { status: 'closed', closedAt: new Date(nowMs).toISOString(), pnlUsd: pnl || 0 })
          .catch((e) => console.log('[PositionReconciler] updateJournalEntry (flip close) gagal:', e.message));
      }
      const newEntryId = `manual-${symbol}-${nowMs}`;
      const marginUsd = (Number(live.leverage) > 0 && live.notional) ? Math.abs(Number(live.notional)) / Number(live.leverage) : 0;
      await writeJournal(newEntryId, {
        phone, mode: 'real', strategy: 'manual', asset: symbol.toLowerCase(), direction: dirWord(liveAmt),
        entryPrice: Number(live.entryPrice), leverage: Number(live.leverage) || 0, marginUsd,
        status: 'open', openedAt: new Date(nowMs).toISOString(), note: 'Manual Olan', exchange: 'binance',
      });
      const pnlLine = pnl === null ? '⚠️ PnL belum kebaca otomatis -- cek manual di exchange.' : `PnL posisi lama: ${pnlSign(pnl)}${fmtUsdWithIdr(pnl, idrRate)}`;
      const msg = `🙋 Wibowo Hedgefund -- Balik Arah\n\n${symbol}: ${dirLabel(prevAmt)} -> ${dirLabel(liveAmt)}\n${pnlLine}\nPosisi baru: @ ${fmtUsd(live.entryPrice)}, leverage ${live.leverage || '-'}x\nAlasan: Manual Olan\n\n🔗 ${KAELA_ACCESS_URL}`;
      console.log(`[PositionReconciler] MANUAL FLIP ${symbol}, PnL posisi lama=${pnl}`);
      await sendWhatsApp(msg, WIBOWO_GROUP_ID).catch((e) => console.log('[PositionReconciler] Gagal kirim WA (manual flip):', e.message));
      state.positions[symbol] = { positionAmt: liveAmt, entryPrice: Number(live.entryPrice), entryId: newEntryId, openedAtMs: nowMs };
    }
    // else: gak ada perubahan (prevAmt===0 && liveAmt===0, atau persis sama) -- gak ada yang perlu dilaporin.
  }

  state.lastCheckedAtMs = nowMs;
  saveState(statePath, state);
}

module.exports = { reconcileWibowoPositions };
