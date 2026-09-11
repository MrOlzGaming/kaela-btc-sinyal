// econReactionResearchLog.js -- arsip riset "kalender ekonomi vs reaksi BTC beneran" (12 Sep 2026,
// permintaan Olan: "simpan sendiri hasil-hasil kalender ekonomi buat kelak penelitian").
//
// Tujuan: sekarang `tvEconActual.js` udah ngasih actual real, kita bisa BANDINGIN kesimpulan
// hawkish/dovish (yang "SEHARUSNYA" bikin BTC tertekan/menguat) sama REAKSI HARGA BTC BENERAN.
// Kasus nyata yang dikasih Olan: rilis CPI Juli hawkish (harusnya BTC tertekan) TAPI BTC malah
// pump brutal -- dugaan: bandar/whale liat posisi SHORT numpuk tebal, sengaja "gurih"-in stop
// hunt/short squeeze ke arah berlawanan dari fundamental. Field `divergence` di bawah nandain
// OTOMATIS kasus kayak gini (label hawkish/dovish TAPI reaksi BTC kebalikan) -- biar gampang
// difilter belakangan buat riset pola manipulasi, TANPA scroll manual satu-satu.
//
// ⛔ MURNI RISET/ARSIP -- SENGAJA GAK PERNAH pengaruhi sinyal/eksekusi trading manapun. Kalau nanti
// riset ini nemuin pola kuat (misal "kalau liq heatmap short numpuk + hawkish -> lebih sering
// pump"), itu jadi TEMUAN yang WAJIB dilaporin+minta izin dulu sebelum diterapkan ke sistem live --
// SAMA PERSIS disiplin riset backtest lain di proyek ini (lihat project-kaela-btc-sinyal.md).
//
// State MURNI LOKAL (pola sama kayak econ-calendar-live-notified.json/archive.json) -- gak perlu
// git sync, append-only, gak ada batas retensi (riset butuh histori sepanjang mungkin).

const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, 'econ-reaction-research-log.json');
const BTC_REACTION_THRESHOLD_PCT = 0.10; // SAMA PERSIS threshold sinyal econCalendarLiveMonitor.js -- konsisten definisi "gerakan berarti"

function _load() {
  if (!fs.existsSync(LOG_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); } catch (e) { return []; }
}
function _save(arr) {
  fs.writeFileSync(LOG_PATH, JSON.stringify(arr, null, 2));
}

// `expectedDirection`: 'tertekan'/'menguat'/'campuran'/null (dari directionalView, arah yang
// SEHARUSNYA kejadian ke BTC menurut logika makro standar). `btcReactionPct`: reaksi BTC BENERAN
// dalam window heads-up->hasil (SAMA data yang dipakai keputusan scalp, biar konsisten).
// `divergence` cuma dihitung kalau expectedDirection JELAS (tertekan/menguat, bukan campuran/null)
// DAN reaksi BTC ngelewatin threshold KE ARAH BERLAWANAN -- itu kandidat "market gerak lawan
// fundamental", bukan sekadar noise kecil di bawah threshold.
function _computeDivergence(expectedDirection, btcReactionPct) {
  if (btcReactionPct == null) return null;
  if (expectedDirection === 'tertekan' && btcReactionPct >= BTC_REACTION_THRESHOLD_PCT) return true;
  if (expectedDirection === 'menguat' && btcReactionPct <= -BTC_REACTION_THRESHOLD_PCT) return true;
  if (expectedDirection === 'tertekan' || expectedDirection === 'menguat') return false;
  return null; // campuran/null -- gak ada ekspektasi jelas buat dibandingin
}

// Dipanggil econCalendarLiveMonitor.js pas jendela HASIL (append-only, 1 entry per event).
// `positioningBefore` (opsional) -- snapshot funding/OI/long-short (marketSentiment.js) diambil
// pas jendela heads-up (5 menit SEBELUM rilis), diarsipin APA ADANYA (null field kalau salah satu
// sumbernya gagal) buat riset "posisi lagi numpuk kemana sebelum event ini" (permintaan Olan,
// lihat feedback-market-maker-mindset).
function recordReaction({ event, conclusionLabel, dxyChangePct, btcBefore, btcAfter, positioningBefore }) {
  const btcReactionPct = (btcBefore != null && btcAfter != null) ? ((btcAfter - btcBefore) / btcBefore) * 100 : null;
  const v = event.directionalView;
  const c = parseFloat(event.actual), f = parseFloat(event.forecast);
  let expectedDirection = null;
  if (v && v.aboveForecast !== null && !isNaN(c) && !isNaN(f)) {
    expectedDirection = c === f ? null : (c > f ? v.aboveForecast : v.belowForecast);
  }
  const entry = {
    recordedAt: new Date().toISOString(),
    key: event.key,
    title: event.rawTitle,
    timeMs: event.timeMs,
    actual: event.actual || null,
    forecast: event.forecast,
    previous: event.previous,
    conclusionLabel: conclusionLabel || null,
    expectedDirection,
    dxyChangePct: dxyChangePct != null ? Number(dxyChangePct.toFixed(4)) : null,
    btcBefore: btcBefore != null ? Number(btcBefore) : null,
    btcAfter: btcAfter != null ? Number(btcAfter) : null,
    btcReactionPct: btcReactionPct != null ? Number(btcReactionPct.toFixed(4)) : null,
    divergence: _computeDivergence(expectedDirection, btcReactionPct),
    positioningBefore: positioningBefore ? {
      fundingRate: positioningBefore.funding ? positioningBefore.funding.rate : null,
      openInterest: positioningBefore.openInterest ? positioningBefore.openInterest.openInterest : null,
      longAccountPct: positioningBefore.longShort ? Number((positioningBefore.longShort.longAccount * 100).toFixed(2)) : null,
      shortAccountPct: positioningBefore.longShort ? Number((positioningBefore.longShort.shortAccount * 100).toFixed(2)) : null,
      fearGreed: positioningBefore.fearGreed ? positioningBefore.fearGreed.value : null,
    } : null,
  };
  const arr = _load();
  arr.push(entry);
  _save(arr);
  return entry;
}

function loadAll() { return _load(); }

module.exports = { recordReaction, loadAll, LOG_PATH };
