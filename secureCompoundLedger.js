// secureCompoundLedger.js -- Lapisan money management "Secure/Compound + Target 2x" (18 Sep
// 2026, permintaan Olan) DI ATAS Kalkulator Exposure OLZ (calculator.js) yang SAMA SEKALI TIDAK
// diubah -- modul ini reuse hitung() apa adanya, cuma nentuin angka modal/nilai-posisi mana yang
// dikirim ke situ, dan gimana profit/loss tiap trade dialokasikan ke 3 ember terpisah:
// TRADING CAPITAL (basis Kalkulator Exposure), SECURE (profit aman, gak pernah dipakai lagi
// buat bet/exposure/compound/recovery), ACTIVE COMPOUND (profit yang lagi "ditumpuk" jadi bet
// trade berikutnya selama masih menang beruntun, direset ke 0 begitu kalah).
//
// PENTING (baca sebelum pakai): `totalWealth()` di sini angka VIRTUAL/bookkeeping buat mandu
// ukuran bet -- BUKAN cerminan 1:1 saldo real di exchange. Deduction pas LOSS pakai bet FRESH
// dari Trading Capital saat itu (bukan nilai Compound yang beneran dipasang pas kalah) --
// SENGAJA per desain Olan, biar downside ke Trading Capital selalu kecil-terkontrol walau
// Compound udah gede. Saldo real exchange tetap bergerak sesuai PnL ASLI tiap trade (termasuk
// kalau rugi dari posisi ber-notional Compound gede) -- 2 angka ini AKAN beda seiring waktu,
// itu BY DESIGN, bukan bug.
//
// Semua fungsi di sini PURE (gak nyimpen state sendiri, gak ada I/O, gak mutasi input) --
// caller yang persist state ke JSON. Gampang ditest (lihat regressionTests.js), gampang dipasang
// backtest MAUPUN live tanpa duplikasi logic.

const { hitung: hitungExposure } = require('./calculator');

function createLedgerState(startingWealth) {
  return {
    startingWealth,
    tradingCapital: startingWealth,
    secure: 0,
    activeCompound: 0,
    cycleCount: 0,
    closedCycles: [],
  };
}

function totalWealth(state) {
  return state.tradingCapital + state.secure + state.activeCompound;
}

// Nentuin ukuran bet trade BERIKUTNYA.
// `activeCompound <= 0` (chain baru -- abis LOSS, abis rollover siklus, atau memang belum
// pernah menang) -> bet FRESH dari Trading Capital, PERSIS `hitung()` apa adanya.
// `activeCompound > 0` (lagi nunggang streak menang) -> leverage TETAP dari formula nyawa% yang
// SAMA (`hitung()`, termasuk cap MAX_LEVERAGE), TAPI nilaiPosisi/margin di-override pakai nilai
// Compound (dibagi 2 dulu kalau short -- konsisten sama aturan besi "short = separuh exposure
// long", lihat feedback-nyopet-buyonly.md).
// `freshModal` (opsional) -- modal yang dikirim ke Kalkulator Exposure buat bet FRESH, default
// `state.tradingCapital` apa adanya. Caller Nyopet ngirim `tradingCapital/modalDivisor` di sini
// (PRESERVE "cheat exposure" yang emang udah jadi identitas sizing Nyopet, lihat
// `nyopetChartPatternFvg.js` -- BUKAN bagian dari ledger ini, cuma dioper lewat).
function computeBetSizing(state, { entry, stopLoss, direction, maxLeverage, freshModal } = {}) {
  const modal = freshModal !== undefined ? freshModal : state.tradingCapital;
  const base = hitungExposure({ modal, entry, stopLoss, direction, maxLeverage });
  if (state.activeCompound <= 0) {
    return { ...base, usedCompound: false };
  }
  const nilaiPosisi = direction === 'sell' ? state.activeCompound / 2 : state.activeCompound;
  const margin = nilaiPosisi / base.leverage;
  return {
    exposure: base.exposure, // gak relevan lagi (nilaiPosisi bukan lagi modal*exposure) -- disisain apa adanya biar shape konsisten
    nilaiPosisi,
    leverage: base.leverage,
    margin,
    // marginPct/warning SENGAJA gak diisi ulang -- makna "risiko vs modal" beda buat bet
    // Compound (yang dipertaruhkan itu profit yang UDAH menang, bukan Trading Capital) --
    // jangan pura-pura reuse assessMarginRisk() yang didesain buat konteks Trading Capital biasa.
    marginPct: null,
    warning: null,
    usedCompound: true,
  };
}

// Apply hasil 1 trade yang BENERAN udah full-closed (kalau ada partial+sisa/trailing, gabungin
// dulu jadi SATU angka `pnlUsd` NET sebelum manggil ini -- JANGAN panggil 2x per 1 posisi, lihat
// plan/riset 18 Sep 2026 soal kenapa "trade selesai" = status closed, bukan tiap leg partial).
// `entry`/`stopLoss`/`direction` WAJIB dari trade yang SAMA (dipakai buat hitung ulang "bet
// fresh" kalau kebetulan LOSS -- lihat catatan penting di atas file). `freshModal` sama semantik
// kayak di `computeBetSizing` -- WAJIB dioper SAMA PERSIS biar deduction LOSS konsisten sama
// gimana bet fresh beneran dihitung buat caller ini (Nyopet: `tradingCapital/modalDivisor`).
function applyTradeResult(state, { pnlUsd, entry, stopLoss, direction, maxLeverage, freshModal } = {}) {
  if (pnlUsd > 0) {
    const half = pnlUsd / 2;
    return { ...state, secure: state.secure + half, activeCompound: half };
  }
  const modal = freshModal !== undefined ? freshModal : state.tradingCapital;
  const freshBet = hitungExposure({ modal, entry, stopLoss, direction, maxLeverage });
  return { ...state, tradingCapital: Math.max(0, state.tradingCapital - freshBet.margin), activeCompound: 0 };
}

// Cek target 2x -- panggil SETELAH applyTradeResult (urutan: WIN/LOSS diapply dulu, baru cek
// rollover). Return `{ state, cycleClosed, cycleSummary }` TERPISAH dari state ledger murni --
// biar caller yang persist `state` ke JSON gak ikut nyimpen flag transient `cycleClosed`.
function checkAndRolloverCycle(state) {
  const wealth = totalWealth(state);
  if (wealth < state.startingWealth * 2) {
    return { state, cycleClosed: false, cycleSummary: null };
  }
  const cycleSummary = { cycleNumber: state.cycleCount + 1, startingWealth: state.startingWealth, endingWealth: wealth };
  const newState = {
    ...state,
    startingWealth: wealth,
    activeCompound: 0,
    cycleCount: state.cycleCount + 1,
    closedCycles: [...state.closedCycles, cycleSummary],
  };
  return { state: newState, cycleClosed: true, cycleSummary };
}

module.exports = { createLedgerState, totalWealth, computeBetSizing, applyTradeResult, checkAndRolloverCycle };
