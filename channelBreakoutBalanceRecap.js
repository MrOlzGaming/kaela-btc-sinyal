// channelBreakoutBalanceRecap.js (22 Sep 2026) -- Olan: "untuk real trading saldo ga cukup jangan
// spam dm dan grup.. tapi di rekap aja.. dan dilaporkan hari esok.. misal total trading kemarin
// 10 trade tidak tereksekusi karena saldo tidak cukup". BEDA dari balanceAlert.js (yang kirim WA
// tiap kejadian, deduped max 1x/hari) -- di sini GAK ada WA sama sekali pas kejadian, MURNI
// AKUMULASI ke state, baru 1x kirim REKAP JUMLAH begitu tanggal WITA-nya udah lewat (pola SAMA
// whaleDailyDigest.js: numpuk tiap siklus + `archive.js` addOrReplaceDaily/hasEntryToday buat
// cegah kirim dobel).

const fs = require('fs');
const path = require('path');
const { localDateKey } = require('./config');
const { addOrReplaceDaily, hasEntryToday } = require('./archive');

const STATE_PATH = path.join(__dirname, 'multi-account-state', 'channel-breakout-balance-recap.json');
const ARCHIVE_TYPE = 'channel-breakout-balance-recap';

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { dateKey: null, count: 0, samples: [] };
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return { dateKey: null, count: 0, samples: [] }; }
}

function saveState(s) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

// Panggil SETIAP KALI entry real gagal karena saldo kurang -- cuma nyatet ke state, GAK kirim WA.
function recordSkippedInsufficientBalance({ dir, entryPrice, sl, tp }) {
  const today = localDateKey(new Date());
  let state = loadState();
  if (state.dateKey !== today) state = { dateKey: today, count: 0, samples: [] }; // hari baru -- reset akumulasi (hari kemarin udah/akan direkap terpisah)
  state.count += 1;
  if (state.samples.length < 3) state.samples.push({ dir, entryPrice, sl, tp, at: new Date().toISOString() }); // simpan beberapa contoh buat konteks laporan, gak perlu semua
  saveState(state);
}

// Panggil TIAP SIKLUS (bukan cuma 1x/hari) dari runner -- ngecek apakah HARI KEMARIN (WITA) ada
// akumulasi yang belum dilaporin, kirim SEKALI kalau ada. Pola generik "cek jam lewat, baru kirim"
// SENGAJA gak dipakai di sini (beda dari dailyAutomationChecklist.js) -- rekap ini nempel ke
// PERGANTIAN TANGGAL state internal sendiri (dateKey berubah = hari kemarin closed), bukan jam
// target tertentu, jadi robust walau runner-nya baru mulai/berhenti kapan aja.
async function reportYesterdayRecapIfPending() {
  const state = loadState();
  if (!state.dateKey || state.count === 0) return { sent: false, reason: 'gak ada akumulasi' };
  const today = localDateKey(new Date());
  if (state.dateKey === today) return { sent: false, reason: 'masih hari yang sama, belum waktunya' };
  if (hasEntryToday(ARCHIVE_TYPE, new Date(state.dateKey))) return { sent: false, reason: 'udah pernah dilaporin' };

  const { sendWhatsAppToWibowo } = require('./wibowoNotify');
  const msg = `📋 *Channel Breakout REAL* -- rekap ${state.dateKey}\n\n`
    + `Total *${state.count} trade tidak tereksekusi* kemarin karena saldo Real tidak cukup.\n\n`
    + `Ini murni sinyal yang kelewat, BUKAN error sistem -- begitu saldo cukup, entry otomatis jalan normal lagi.\n\n— Kaela`;
  const r = await sendWhatsAppToWibowo(msg);
  if (r && (r.ok || r.skipped)) {
    addOrReplaceDaily(ARCHIVE_TYPE, msg, new Date(state.dateKey));
    saveState({ dateKey: today, count: 0, samples: [] }); // reset buat hari ini
    return { sent: true };
  }
  return { sent: false, reason: 'gagal kirim WA, dicoba lagi siklus berikutnya' };
}

module.exports = { recordSkippedInsufficientBalance, reportYesterdayRecapIfPending };
