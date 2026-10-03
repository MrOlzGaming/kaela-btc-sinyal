// kaelaJournalHook.js (3 Okt 2026) -- catat buka/tutup posisi akun Olan ke Sheet Journal Kaela Access (dashboard), aman
// (gagal = log doang, gak pernah gugurin eksekusi). Dipakai modul dual-exec yang SEBELUMNYA gak nyatet sama sekali
// (sniperBtcDualExec.js, rangerBtcDualExec.js -- ketemu pas audit dashboard 3 Okt: riwayat BTC demo+real bakal bolong).
// entryId = `${tradeId}-${mode}` (pola sama ninjaMrTrader/rangerRotation).
const MASTER_NOMOR = '6281299303888';

function client() { return require('./kaelaProTraderClient'); }

function recordOpen(mode, entry) {
  try {
    return client().recordJournalEntry(MASTER_NOMOR, mode, { status: 'open', openedAt: new Date().toISOString(), asset: 'btc', ...entry })
      .catch((e) => console.log(`[KaelaJournal] recordJournalEntry (${mode}) gagal:`, e.message));
  } catch (e) { console.log('[KaelaJournal] recordOpen error:', e.message); return Promise.resolve(); }
}
function recordClose(entryId, pnlUsd) {
  try {
    return client().updateJournalEntry(entryId, { status: 'closed', closedAt: new Date().toISOString(), pnlUsd: pnlUsd == null ? null : pnlUsd })
      .catch((e) => console.log(`[KaelaJournal] updateJournalEntry (${entryId}) gagal:`, e.message));
  } catch (e) { console.log('[KaelaJournal] recordClose error:', e.message); return Promise.resolve(); }
}
// label manusiawi buat kolom Note dashboard (bukan kode mentah patternType)
function patternLabel(patternType) {
  const p = String(patternType || '');
  if (p === 'ict_sweep') return 'ICT Liquidity Sweep';
  if (p.startsWith('fvg')) return 'Fair Value Gap';
  if (p === 'econ_reaction') return 'Scalp Rilis Data';
  if (p === 'fed_dovish_grid') return 'Fed Dovish Grid';
  return p ? 'Pola Chart (' + p.replace(/_/g, ' ') + ')' : 'Sinyal';
}
module.exports = { recordOpen, recordClose, patternLabel, MASTER_NOMOR };
