// ninjaFvg.js (30 Sep 2026) -- mesin entry NINJA berbasis FVG, pengganti Channel Breakout 5M.
// SATU sumber kebenaran: dipakai backtest (backtestNinjaFvg.js) MAUPUN live (ninjaTrader.js),
// pola sama kayak chartPatterns.js/fvgDetector.js. Modul ini MURNI logika (tanpa I/O, tanpa
// exchange) -- state disimpan caller (journal) sebagai JSON biasa.
//
// Kenapa (spesifikasi Olan 30 Sep 2026): Channel Breakout 5M "plin-plan" -- BREAKOUT -> ENTRY ->
// RETRACE DIKIT -> CLOSE, berulang-ulang sebelum gerakan asli, fee numpuk. Histori demo 27-30 Sep
// ngebuktiin: 23 trade dalam ~2,8 hari, 4 menang/19 kalah, net -$376,82 setelah fee (lihat
// BACKTEST-REGISTRY.md bagian Ninja FVG).
//
// ATURAN INTI (spesifikasi Olan, JANGAN dilonggarin tanpa izin):
//   1. FVG = zona ENTRY, BUKAN breakout. Alur: FVG terbentuk -> harga ninggalin zona -> harga balik
//      nyentuh zona -> ENTRY searah FVG (bullish = BUY, bearish = SELL).
//   2. Tiap FVG punya ID unik. SATU FVG = MAKSIMAL SATU ENTRY -> status USED, gak pernah dipakai
//      lagi walau disentuh berkali-kali.
//   3. SATU posisi aktif pada satu waktu. Selama posisi aktif, FVG baru cuma DICATAT (gak entry).
//      Candle yang nutup posisi gak boleh sekaligus buka posisi baru (selesaiin dulu, baru scan).
//   4. SL awal = 2x lebar FVG (persen dari harga entry), BUKAN angka tetap.
//   5. Exit = trailing stop: harga gerak X% ke arah untung -> SL ikut gerak X% (jarak persen TETAP
//      dari harga terbaik). Ratchet SATU ARAH, SL gak pernah melebar balik.
//   6. Ukuran posisi TETAP dari Kalkulator Exposure (calculator.js) -- modul ini gak ngitung size.
//
// Deteksi FVG (konsep "FVG Order Blocks [BigBeluga]", TradingView): pola 3 candle,
//   bullish: high[c1] < low[c3] -> zona [high c1, low c3]
//   bearish: low[c1]  > high[c3] -> zona [high c3, low c1]
// + filter ukuran gap dalam % (`minWidthPct`, padanan "FVG % filter" BigBeluga) + zona MATI kalau
// candle CLOSE nembus sisi seberang (padanan "broken/mitigated" BigBeluga). Source Pine asli
// BigBeluga GAK kebaca dari sesi ini (TradingView diblokir proxy) -- ini implementasi dari prinsip
// yang terdokumentasi, bukan salinan baris-per-baris.
//
// Konvensi arah: 'long' / 'short' (sama kayak ninjaTrader.js).

const DEFAULT_OPTS = {
  minWidthPct: 0.05,    // filter FVG kekecilan (noise + fee lebih gede dari edge)
  slMultiple: 2,        // SL awal = slMultiple x lebar FVG
  maxAgeBars: 288,      // FVG yang gak kesentuh selama ini dianggap basi (EXPIRED)
  maxTrackedFvgs: 50,   // batas jumlah FVG aktif yang dipantau (padanan "max boxes" BigBeluga)
};

function fvgId(tf, dir, c3) { return `NINJA-${tf}-${dir === 'long' ? 'BULL' : 'BEAR'}-${c3.closeTime}`; }

// Deteksi FVG yang DIBENTUK candle index i (c3 = candles[i], c1 = candles[i-2]). null kalau gak ada.
function detectFvgAt(candles, i, tf = 'tf', opts = {}) {
  if (i < 2) return null;
  const { minWidthPct } = { ...DEFAULT_OPTS, ...opts };
  const c1 = candles[i - 2], c3 = candles[i];
  let dir = null, top, bottom;
  if (c1.high < c3.low) { dir = 'long'; bottom = c1.high; top = c3.low; }
  else if (c1.low > c3.high) { dir = 'short'; bottom = c3.high; top = c1.low; }
  if (!dir) return null;
  const mid = (top + bottom) / 2;
  const widthPct = ((top - bottom) / mid) * 100;
  if (!(widthPct >= minWidthPct)) return null;
  return {
    id: fvgId(tf, dir, c3), dir, top, bottom, widthPct,
    createdTime: c3.closeTime, createdIdx: i,
    left: false,          // harga udah pernah ninggalin zona setelah terbentuk?
    status: 'ACTIVE',     // ACTIVE | USED | BROKEN | EXPIRED
  };
}

function newState() { return { fvgs: [], position: null, closed: [] }; }

// Buka posisi dari FVG di harga `entryPrice`. Dipakai backtest (harga sentuh) & live (harga live).
function openPosition(fvg, entryPrice, time, opts = {}) {
  const { slMultiple } = { ...DEFAULT_OPTS, ...opts };
  const slDistPct = fvg.widthPct * slMultiple;
  const f = slDistPct / 100;
  const sl = fvg.dir === 'long' ? entryPrice * (1 - f) : entryPrice * (1 + f);
  fvg.status = 'USED';
  fvg.usedTime = time;
  return { fvgId: fvg.id, dir: fvg.dir, entryPrice, entryTime: time, slDistPct, fvgWidthPct: fvg.widthPct, initialSl: sl, sl, extreme: entryPrice };
}

// Trailing: jarak persen TETAP (slDistPct) dari harga terbaik sejak entry. Ratchet satu arah.
function ratchet(pos, favourablePrice) {
  const f = pos.slDistPct / 100;
  if (pos.dir === 'long') {
    if (favourablePrice > pos.extreme) {
      pos.extreme = favourablePrice;
      pos.sl = Math.max(pos.sl, pos.extreme * (1 - f));
    }
  } else if (favourablePrice < pos.extreme) {
    pos.extreme = favourablePrice;
    pos.sl = Math.min(pos.sl, pos.extreme * (1 + f));
  }
}

function stopHit(pos, low, high) { return pos.dir === 'long' ? low <= pos.sl : high >= pos.sl; }

// Zona yang disentuh candle/harga: bullish kesentuh kalau low <= top, bearish kalau high >= bottom.
function touches(fvg, low, high) { return fvg.dir === 'long' ? low <= fvg.top : high >= fvg.bottom; }

// Harga di luar zona di sisi "ninggalin" (bullish: di atas top, bearish: di bawah bottom).
function isAway(fvg, low, high) { return fvg.dir === 'long' ? low > fvg.top : high < fvg.bottom; }

// Candle CLOSE nembus sisi seberang -> zona rusak (thesis gugur).
function isBrokenByClose(fvg, close) { return fvg.dir === 'long' ? close < fvg.bottom : close > fvg.top; }

// Update daftar FVG pakai 1 candle CLOSED index i: umur/rusak/"udah ninggalin", lalu tambah FVG
// baru yang dibentuk candle i. Gak nyentuh posisi.
function updateFvgs(state, candles, i, tf, opts = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const c = candles[i];
  for (const g of state.fvgs) {
    if (g.status !== 'ACTIVE') continue;
    if (isBrokenByClose(g, c.close)) { g.status = 'BROKEN'; continue; }
    if (g.createdIdx !== undefined && i - g.createdIdx > o.maxAgeBars) { g.status = 'EXPIRED'; continue; }
    if (!g.left && g.createdTime < c.closeTime && isAway(g, c.low, c.high)) g.left = true;
  }
  const fresh = detectFvgAt(candles, i, tf, o);
  if (fresh && !state.fvgs.some((g) => g.id === fresh.id)) state.fvgs.push(fresh);
  // Buang yang udah gak aktif + batasi jumlah (USED disimpan sebentar biar ID-nya tetap ketolak
  // kalau ada rescan -- lihat `usedIds` di state live).
  state.fvgs = state.fvgs.filter((g) => g.status === 'ACTIVE').slice(-o.maxTrackedFvgs);
}

// Pilih FVG kandidat yang kesentuh di range [low, high]. Prioritas: FVG paling BARU.
function pickTouchedFvg(state, low, high, usedIds) {
  const cands = state.fvgs.filter((g) => g.status === 'ACTIVE' && g.left && !(usedIds && usedIds.has(g.id)) && touches(g, low, high));
  if (!cands.length) return null;
  return cands.reduce((a, b) => (b.createdTime > a.createdTime ? b : a));
}

// ================= BACKTEST: satu langkah per candle CLOSED =================
// Asumsi konservatif intrabar: (1) posisi dicek stop DULU pakai SL lama, baru ratchet pakai
// high/low candle yang sama; (2) candle entry: ratchet cuma pakai CLOSE (urutan high/low sesudah
// sentuhan gak diketahui), tapi stop tetap dicek pakai low/high candle itu; (3) gap open nembus SL
// -> exit di OPEN (lebih jelek dari SL); gap open ke dalam zona -> entry di OPEN.
function stepBacktest(state, candles, i, tf, opts = {}) {
  const c = candles[i];
  let closedThisBar = false;

  if (state.position) {
    const p = state.position;
    if (stopHit(p, c.low, c.high)) {
      const exitPrice = p.dir === 'long' ? Math.min(c.open, p.sl) : Math.max(c.open, p.sl);
      state.closed.push({ ...p, exitPrice, exitTime: c.closeTime, exitIdx: i });
      state.position = null;
      closedThisBar = true;
    } else {
      ratchet(p, p.dir === 'long' ? c.high : c.low);
    }
  }

  // Entry dievaluasi SEBELUM FVG di-update candle ini (zona harus udah ada & "ditinggalin" di
  // candle SEBELUMNYA -- gak ada look-ahead).
  if (!state.position && !closedThisBar) {
    const g = pickTouchedFvg(state, c.low, c.high, null);
    if (g) {
      const edge = g.dir === 'long' ? g.top : g.bottom;
      const far = g.dir === 'long' ? g.bottom : g.top;
      const gappedPast = g.dir === 'long' ? c.open < far : c.open > far;
      if (gappedPast) {
        g.status = 'BROKEN'; // buka candle udah di seberang zona -- gak ada harga "sentuh" yang valid
      } else {
        const entryPrice = g.dir === 'long' ? Math.min(c.open, edge) : Math.max(c.open, edge);
        const pos = openPosition(g, entryPrice, c.closeTime, opts);
        pos.entryIdx = i;
        if (stopHit(pos, c.low, c.high)) {
          const exitPrice = pos.sl; // kena di candle yang sama (konservatif: anggap kena)
          state.closed.push({ ...pos, exitPrice, exitTime: c.closeTime, exitIdx: i });
        } else {
          ratchet(pos, c.close);
          state.position = pos;
        }
      }
    }
  }

  updateFvgs(state, candles, i, tf, opts);
}

// Jalanin backtest penuh. Return daftar trade tertutup (kronologis).
function runBacktest(candles, tf, opts = {}) {
  const state = newState();
  for (let i = 0; i < candles.length; i++) stepBacktest(state, candles, i, tf, opts);
  return state.closed;
}

// Return per-trade dalam % NOTIONAL (gross, sebelum fee). Kalkulator Exposure bikin notional per
// trade tetap (modal x exposure), jadi % notional = satuan yang adil buat banding antar-sistem
// (R-multiple beda-beda ukurannya karena SL beda-beda).
function tradeGrossPct(t) { return ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100 * (t.dir === 'long' ? 1 : -1); }

module.exports = {
  DEFAULT_OPTS, detectFvgAt, newState, openPosition, ratchet, stopHit, touches, isAway,
  isBrokenByClose, updateFvgs, pickTouchedFvg, stepBacktest, runBacktest, tradeGrossPct, fvgId,
};
