// secureCompoundLedger.js -- Lapisan money management "Secure/Compound + Target 2x" (18 Sep
// 2026, permintaan Olan) DI ATAS Kalkulator Exposure OLZ (calculator.js) yang SAMA SEKALI TIDAK
// diubah -- modul ini reuse hitung() apa adanya, cuma nentuin angka modal/nilai-posisi mana yang
// dikirim ke situ, dan gimana profit/loss tiap trade dialokasikan ke 3 ember terpisah:
// TRADING CAPITAL (basis Kalkulator Exposure), SECURE (profit aman, gak pernah dipakai lagi
// buat bet/exposure/compound/recovery), ACTIVE COMPOUND (profit yang lagi "ditumpuk" jadi
// TAMBAHAN bet trade berikutnya selama masih menang beruntun, direset ke 0 begitu kalah).
//
// ⛔ REVISI 18 Sep 2026 (v2, SORE) -- versi PERTAMA (pagi) bikin Compound GANTIIN nilaiPosisi
// dari Kalkulator Exposure sepenuhnya (bypass total) -- backtest nemuin FLAW STRUKTURAL: Trading
// Capital jadi CUMA BISA turun/diam selamanya (WIN gak pernah ngisi ulang TC krn nilaiPosisi
// trade gak lagi berbasis TC sama sekali selama streak), Nyopet (ratusan trade) TERGERUS SAMPAI
// $0 (lihat RESEARCH-LOG.md 2026-09-18). Olan koreksi desainnya: Kalkulator Exposure WAJIB TETAP
// jalan/dipanggil TIAP TRADE (basis dari Trading Capital, gak pernah di-skip), Compound cuma
// TAMBAHAN (`+`) di ATAS nilaiPosisi yang dihasilinnya -- BUKAN gantiin. Compound juga sekarang
// AKUMULATIF (nambah tiap menang beruntun, `compound += profit/2`), bukan REPLACE (`compound =
// profit/2`) kayak versi pertama. Ini SENGAJA bikin nilaiPosisi trade SELALU ada komponen basis
// dari Trading Capital -- gak akan pernah "lepas total" dari TC kayak versi pertama.
//
// PENTING (baca sebelum pakai): `totalWealth()` di sini angka VIRTUAL/bookkeeping buat mandu
// ukuran bet -- BUKAN cerminan 1:1 saldo real di exchange. Deduction pas LOSS pakai bet FRESH
// dari Trading Capital saat itu (nilaiPosisi basis Kalkulator Exposure doang, TANPA komponen
// Compound yang beneran nempel di bet yang kalah) -- SENGAJA per desain Olan, biar downside ke
// Trading Capital selalu kecil-terkontrol walau Compound udah gede. Saldo real exchange tetap
// bergerak sesuai PnL ASLI tiap trade (termasuk kalau rugi dari posisi ber-notional
// basis+Compound gede) -- 2 angka ini AKAN beda seiring waktu, itu BY DESIGN, bukan bug.
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

// Nentuin ukuran bet trade BERIKUTNYA. Kalkulator Exposure (`hitung()`) SELALU dipanggil PENUH
// dari Trading Capital SAAT INI -- TIAP TRADE, gak pernah di-skip/gantiin (fix v2 dari flaw versi
// pertama, lihat catatan panjang di atas file). Kalau ada Active Compound (lagi nunggang streak
// menang), nilainya TAMBAHAN (`+`) di atas nilaiPosisi hasil kalkulator itu (dibagi 2 dulu kalau
// short -- konsisten sama aturan besi "short = separuh exposure long", lihat
// feedback-nyopet-buyonly.md). `activeCompound === 0` (belum pernah menang/abis LOSS/abis
// rollover) -> hasil PERSIS `hitung()` apa adanya (nambah 0 gak ngubah apa2).
// `freshModal` (opsional) -- modal yang dikirim ke Kalkulator Exposure, default
// `state.tradingCapital` apa adanya. Caller Nyopet ngirim `tradingCapital/modalDivisor` di sini
// (PRESERVE "cheat exposure" yang emang udah jadi identitas sizing Nyopet, lihat
// `nyopetChartPatternFvg.js` -- BUKAN bagian dari ledger ini, cuma dioper lewat).
function computeBetSizing(state, { entry, stopLoss, direction, maxLeverage, freshModal } = {}) {
  const modal = freshModal !== undefined ? freshModal : state.tradingCapital;
  const base = hitungExposure({ modal, entry, stopLoss, direction, maxLeverage });
  const compoundAddon = direction === 'sell' ? state.activeCompound / 2 : state.activeCompound;
  const nilaiPosisi = base.nilaiPosisi + compoundAddon;
  const margin = nilaiPosisi / base.leverage;
  return {
    exposure: base.exposure, // basis (dari `modal`) doang -- nilaiPosisi ASLI udah beda krn ada tambahan compound
    nilaiPosisi,
    leverage: base.leverage,
    margin,
    marginPct: modal > 0 ? margin / modal * 100 : null,
    // `warning` SENGAJA gak diisi ulang (assessMarginRisk() gak diexport dari calculator.js,
    // pesannya didesain buat konteks bet basis biasa) -- caller yang mau kasih tau Olan resiko
    // margin gede bisa liat `marginPct` mentah di atas.
    warning: null,
    usedCompound: state.activeCompound > 0,
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
    // Compound AKUMULATIF (fix v2, 18 Sep 2026 sore) -- NAMBAH ke tumpukan yang udah ada, BUKAN
    // ganti/replace kayak versi pertama. Terus numpuk selama masih menang beruntun, direset ke 0
    // begitu LOSS (lihat branch di bawah).
    return { ...state, secure: state.secure + half, activeCompound: state.activeCompound + half };
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
