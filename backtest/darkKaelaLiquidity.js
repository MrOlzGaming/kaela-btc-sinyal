// Dark Kaela -- riset zona likuiditas (15 Agu 2026). BUKAN backtest P&L (Olan: "kaela ga usah
// open posisi") -- ini murni ngecek APAKAH mesin deteksi zona + alert-nya masuk akal: seberapa
// sering nembak, apa dedup-nya kerja (gak spam zona yang sama), apa breakout ke-deteksi wajar.
//
// Mekanisme (hasil diskusi sama Olan):
//   1. Zona likuiditas = swing high/low signifikan (`findSwingPoints`/`clusterLevels`, REUSE dari
//      technicalAnalysis.js -- sama persis dipakai Sniper) + angka bulat psikologis.
//   2. "Signifikan" = touches >= MIN_TOUCHES ATAU zona angka bulat.
//   3. Harga DEKAT zona (dalam NEAR_PCT) -> sinyal (deket zona ATAS = potensi SHORT, deket
//      zona BAWAH = potensi LONG).
//   4. Anti-spam: dilacak per LEVEL HARGA spesifik (bukan cuma arah) -- gak sinyal ulang buat
//      zona yang SAMA. Sinyal baru cuma muncul kalau harga udah deket zona LAIN (beda level),
//      entah itu zona lawan arah (mantul, skenario normal) atau zona SEARAH lebih jauh (kalau
//      ternyata dijebol terus lanjut ke level berikutnya) -- INI JUGA yang otomatis nyelesain
//      masalah "gimana kalau dijebol" tanpa logic terpisah.
//   5. "Zona ditembus" (breakout) -- dideteksi terpisah buat notifikasi informasional doang
//      (pola sama kayak Sniper INVALID): candle CLOSE (bukan cuma high/low nyentuh) ngelewatin
//      zona lebih dari BREAK_CONFIRM_PCT di arah yang salah.
//
// Cuma SATU sinyal boleh aktif per momen (evaluasi 1 kandidat TERDEKAT gabungan support+resistance,
// BUKAN 2 arah independen -- bug awal: evaluasi independen bikin dobel-sinyal tiap candle pas
// harga kebetulan deket support DAN resistance bersamaan, hasilnya 15,5 sinyal/hari, kejauhan
// dari target user "1-10x/hari").

const fs = require('fs');
const path = require('path');
const { findSwingPoints, clusterLevels } = require('../technicalAnalysis');

const CANDLES = JSON.parse(fs.readFileSync(path.join(__dirname, 'hourly-cache.json'), 'utf8'));
const DAILY_CANDLES = JSON.parse(fs.readFileSync(path.join(__dirname, 'daily-cache.json'), 'utf8'));

// Filter TREN (15 Agu 2026, hasil riset online -- "reversal signals work best with... trend
// alignment", "targets align with higher-timeframe trend direction") -- SMA20 vs SMA50 HARIAN,
// precompute sekali (no lookahead -- titik ke-i cuma pakai candle SEBELUM/SAMA index itu).
const DAILY_TREND = (() => {
  const closes = DAILY_CANDLES.map((c) => c.close);
  const trend = new Array(DAILY_CANDLES.length).fill(null);
  for (let i = 50; i < closes.length; i++) {
    const sma20 = closes.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20;
    const sma50 = closes.slice(i - 49, i + 1).reduce((a, b) => a + b, 0) / 50;
    trend[i] = sma20 > sma50 ? 'bullish' : sma20 < sma50 ? 'bearish' : 'netral';
  }
  return trend;
})();

// Cari trend harian TERAKHIR yang closeTime-nya <= timestamp jam-an ini (no lookahead).
function getDailyTrendAt(timestamp) {
  let lo = 0, hi = DAILY_CANDLES.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (DAILY_CANDLES[mid].closeTime <= timestamp) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans >= 0 ? DAILY_TREND[ans] : null;
}

// Konstanta -- gak dites lewat sweep (jarang perlu diubah, beda sifat dari parameter tuning di bawah).
const SWING_LOOKBACK = 3; // sama kayak default technicalAnalysis.js
const CLUSTER_TOLERANCE_PCT = 0.4; // sama kayak default technicalAnalysis.js
const BREAK_CONFIRM_PCT = 0.3; // candle WAJIB close 0,3% lewat zona (bukan cuma nyenggol) buat
                                 // dianggap "beneran ditembus", biar gak overreact ke wick doang

// Parameter yang DITES lewat sweep (BELUM final -- disepakati ditentukan lewat percobaan, bukan
// tebakan) -- objek mutable (bukan const) biar summarize() beneran ngubah perilaku detectZones/run,
// bukan cuma nyimpen angka yang gak kepake (bug ketemu pas nulis versi pertama -- const gak bisa
// di-override sweep meski keliatannya di-assign, functions closure ke const ASLI bukan ke objek ini).
const PARAMS = {
  ZONE_WINDOW_CANDLES: 24 * 14, // 14 hari terakhir (candle hourly) buat cari swing -- cukup buat
                                  // nangkep struktur jangka pendek-menengah relevan sama gaya cepat
                                  // Dark Kaela, gak usah selebar Sniper (yang harian)
  MIN_TOUCHES: 2, // "signifikan" -- minimal ditolak 2x biar dianggap zona likuiditas beneran
  NEAR_PCT: 0.5, // harga dianggap "deket" zona kalau dalam 0,5%
  // Filter REJECTION (15 Agu 2026, upaya perbaiki odds -- ketemu rasio mantul cuma ~32% pas
  // diukur adil relatif entry) -- candle yang MEMICU sinyal wajib udah nunjukkin tanda nolak
  // SENDIRI: wick nyentuh/lewatin zona (syarat NEAR_PCT lama), TAPI close-nya WAJIB udah balik
  // menjauh dari zona minimal REJECTION_MIN_PCT ke arah yang diharapkan. ini yang paling deket
  // mensimulasikan "cek candle rejection" yang manusia lakuin manual sebelum entry. 0 = OFF
  // (perilaku lama, gak ada filter tambahan).
  REJECTION_MIN_PCT: 0,
  // TP_CAP_R (15 Agu 2026, eksperimen -- ide: target zona lawan FULL kadang kejauhan/ketahanan
  // lama, coba batasi ke berapa R maksimal, ambil yang lebih DEKAT antara cap ini vs zona lawan
  // asli). null = OFF (TP selalu zona lawan penuh, perilaku default).
  TP_CAP_R: null,
  // TREND_FILTER: 'off' | 'loose' (buang cuma yang JELAS lawan tren) | 'strict' (WAJIB searah
  // tren, tren netral pun dibuang). Hasil riset online: reversal signals butuh trend alignment
  // buat cegah fakeout -- LONG idealnya pas tren harian bullish, SHORT pas bearish.
  TREND_FILTER: 'off',
  // MAX_TOUCHES (15 Agu 2026, ide dari riset online: "hasn't been retested since it formed"
  // performa lebih baik -- KEBALIKAN dari asumsi awal "makin sering disentuh makin signifikan").
  // null = gak ada batas atas (perilaku lama).
  MAX_TOUCHES: null,
  // SESSION_FILTER: null = OFF, atau [startUTCHour, endUTCHour) -- ide riset online: sweep lebih
  // reliable pas jam buka sesi institusional (London ~07-10 UTC, NY ~13-16 UTC).
  SESSION_FILTER: null,
};

// Snapshot BEKU dari default -- BUG PENTING ketemu 15 Agu 2026 (audit sendiri): summarize*()
// dulu cuma `Object.assign(PARAMS, overrides)` -- parameter yang GAK disebut di overrides tetap
// nempel dari pemanggilan SEBELUMNYA (leakage). Ketauan pas TP_CAP_R=3 (dari eksperimen terakhir
// Ronde 2) diam-diam kebawa ke SEMUA eksperimen Ronde 3+4 (sweep+reclaim, trend filter) yang gak
// pernah nyebut TP_CAP_R sama sekali -- hasil2 itu ternyata bukan "TP penuh ke zona lawan" kayak
// diklaim, tapi ke-cap 3R tanpa sadar. FIX: setiap summarize*() WAJIB reset ke DEFAULT_PARAMS
// dulu SEBELUM apply overrides, bukan numpuk di atas state lama.
const DEFAULT_PARAMS = JSON.parse(JSON.stringify(PARAMS));
function resetParams(overrides) {
  Object.keys(PARAMS).forEach((k) => delete PARAMS[k]);
  Object.assign(PARAMS, DEFAULT_PARAMS, overrides);
}

// Angka bulat psikologis -- step-nya nyesuain skala harga (mirip logika tier OLZ Exposure System
// yang udah ada, cuma buat round-number bukan buat leverage).
function roundNumberStep(price) {
  if (price < 5000) return 250;
  if (price < 20000) return 1000;
  if (price < 100000) return 5000;
  return 10000;
}

function nearestRoundLevels(price) {
  const step = roundNumberStep(price);
  const below = Math.floor(price / step) * step;
  const above = below + step;
  return [below, above].filter((v) => v > 0);
}

// ============ Deteksi zona per titik waktu (NO LOOKAHEAD -- cuma pakai candle SEBELUM index i) ============
function detectZones(candles, i) {
  const start = Math.max(0, i - PARAMS.ZONE_WINDOW_CANDLES);
  const window = candles.slice(start, i); // gak termasuk candle ke-i sendiri
  if (window.length < SWING_LOOKBACK * 4) return { resistance: [], support: [] };
  const price = candles[i].close;
  const { highs, lows } = findSwingPoints(window, SWING_LOOKBACK);
  const resistance = clusterLevels(highs.filter((h) => h.price > price), CLUSTER_TOLERANCE_PCT)
    .filter((z) => z.touches >= PARAMS.MIN_TOUCHES && (PARAMS.MAX_TOUCHES == null || z.touches <= PARAMS.MAX_TOUCHES))
    .map((z) => ({ price: z.price, touches: z.touches, kind: 'swing' }));
  const support = clusterLevels(lows.filter((l) => l.price < price), CLUSTER_TOLERANCE_PCT)
    .filter((z) => z.touches >= PARAMS.MIN_TOUCHES && (PARAMS.MAX_TOUCHES == null || z.touches <= PARAMS.MAX_TOUCHES))
    .map((z) => ({ price: z.price, touches: z.touches, kind: 'swing' }));

  const [roundBelow, roundAbove] = nearestRoundLevels(price);
  if (roundAbove) resistance.push({ price: roundAbove, touches: null, kind: 'round' });
  if (roundBelow) support.push({ price: roundBelow, touches: null, kind: 'round' });

  return { resistance, support };
}

function pctDist(a, b) {
  return Math.abs(a - b) / b * 100;
}

// ============ MODE BARU: SWEEP + RECLAIM (15 Agu 2026, hasil riset online) ============
// Beda dari `run()` (proximity doang, "harga DEKAT zona") -- ini gimana trader beneran definisiin
// liquidity sweep: harga WAJIB nembus (wick) LEWAT zona dulu (bukan cuma nyenggol), BARU CLOSE
// balik ke sisi yang benar (candle "acceptance/reclaim") dalam candle yang SAMA -- versi v1 ini
// cuma sweep 1-candle (bukan multi-candle), disederhanain buat riset awal. SL = ujung sweep-nya
// SENDIRI (low/high candle itu) + buffer kecil, BUKAN harga zona -- beda penting dari model lama.
function runSweepMode() {
  const events = [];
  let lastZone = null;

  for (let i = PARAMS.ZONE_WINDOW_CANDLES; i < CANDLES.length; i++) {
    const c = CANDLES[i];

    // Filter SESI (kalau aktif) -- ide riset online: sweep lebih reliable pas jam buka sesi
    // institusional. [start,end) jam UTC -- di luar jam itu, skip sinyal candle ini sama sekali.
    if (PARAMS.SESSION_FILTER) {
      const hour = new Date(c.closeTime).getUTCHours();
      const [startH, endH] = PARAMS.SESSION_FILTER;
      const inSession = startH < endH ? (hour >= startH && hour < endH) : (hour >= startH || hour < endH);
      if (!inSession) continue;
    }

    const { resistance, support } = detectZones(CANDLES, i);

    const candidates = [];
    support.forEach((z) => {
      // SWEEP support: wick (low) nembus DI BAWAH zona, TAPI close balik DI ATAS zona (reclaim).
      if (c.low < z.price && c.close > z.price) candidates.push({ ...z, direction: 'long', dist: pctDist(c.low, z.price), sweepExtreme: c.low });
    });
    resistance.forEach((z) => {
      if (c.high > z.price && c.close < z.price) candidates.push({ ...z, direction: 'short', dist: pctDist(c.high, z.price), sweepExtreme: c.high });
    });
    // Filter TREN (kalau aktif) -- LONG idealnya searah/gak lawan tren harian, sama buat SHORT.
    const trendFiltered = PARAMS.TREND_FILTER === 'off' ? candidates : candidates.filter((z) => {
      const trend = getDailyTrendAt(c.closeTime);
      if (trend === null) return true; // belum cukup data historis, jangan buang
      if (PARAMS.TREND_FILTER === 'strict') {
        return z.direction === 'long' ? trend === 'bullish' : trend === 'bearish';
      }
      // 'loose' -- buang cuma yang JELAS lawan tren, netral tetap lolos.
      return z.direction === 'long' ? trend !== 'bearish' : trend !== 'bullish';
    });
    trendFiltered.sort((a, b) => a.dist - b.dist);
    const nearest = trendFiltered[0];

    if (nearest) {
      const sameZone = lastZone && pctDist(nearest.price, lastZone.price) <= CLUSTER_TOLERANCE_PCT;
      if (!sameZone) {
        const tpPool = nearest.direction === 'long' ? resistance : support;
        const tpZone = tpPool.slice().sort((a, b) => pctDist(a.price, c.close) - pctDist(b.price, c.close))[0] || null;
        // SL = ujung sweep + buffer kecil (0,15%) ke arah yang salah -- "stop loss a few pips
        // above/below the sweep high/low, not directly on it" (praktik umum, cegah ke-stop lagi
        // dari residual wick/retest).
        const slBuffer = 0.15;
        const slPrice = nearest.direction === 'long'
          ? nearest.sweepExtreme * (1 - slBuffer / 100)
          : nearest.sweepExtreme * (1 + slBuffer / 100);
        events.push({ index: i, time: c.closeTime, type: 'signal', direction: nearest.direction, zonePrice: nearest.price, zoneKind: nearest.kind, touches: nearest.touches, price: c.close, tpPrice: tpZone ? tpZone.price : null, slPrice });
        lastZone = { price: nearest.price, direction: nearest.direction, resolved: false };
      }
    }
  }

  return events;
}

// ============ Jalanin simulasi seluruh histori (baca PARAMS current) ============
function run() {
  const events = []; // {time, type: 'signal'|'break', direction, zonePrice, zoneKind, touches, price}
  let lastZone = null; // { price, direction, resolved }

  for (let i = PARAMS.ZONE_WINDOW_CANDLES; i < CANDLES.length; i++) {
    const c = CANDLES[i];
    const { resistance, support } = detectZones(CANDLES, i);

    // Cek breakout dari zona yang lagi aktif (kalau ada) -- candle WAJIB close lewat, bukan wick.
    if (lastZone && !lastZone.resolved) {
      const brokenDown = lastZone.direction === 'long' && c.close < lastZone.price * (1 - BREAK_CONFIRM_PCT / 100);
      const brokenUp = lastZone.direction === 'short' && c.close > lastZone.price * (1 + BREAK_CONFIRM_PCT / 100);
      if (brokenDown || brokenUp) {
        events.push({ time: c.closeTime, type: 'break', direction: lastZone.direction, zonePrice: lastZone.price, price: c.close });
        lastZone.resolved = true;
      }
    }

    // Gabung SEMUA kandidat (support+resistance) jadi SATU daftar, pilih yang PALING DEKET
    // keseluruhan -- lihat catatan di kepala file soal kenapa bukan 2 arah independen.
    // Filter REJECTION (kalau PARAMS.REJECTION_MIN_PCT>0): wick doang nyentuh zona gak cukup,
    // CLOSE candle itu WAJIB udah balik menjauh dari zona ke arah yang diharapkan -- simulasi
    // "candle rejection" yang biasa dicek manual manusia sebelum percaya sinyal.
    const candidates = [
      ...support.map((z) => ({ ...z, direction: 'long', dist: pctDist(c.low, z.price) })),
      ...resistance.map((z) => ({ ...z, direction: 'short', dist: pctDist(c.high, z.price) })),
    ].filter((z) => z.dist <= PARAMS.NEAR_PCT)
      .filter((z) => {
        if (PARAMS.REJECTION_MIN_PCT <= 0) return true;
        return z.direction === 'long'
          ? c.close > z.price * (1 + PARAMS.REJECTION_MIN_PCT / 100)
          : c.close < z.price * (1 - PARAMS.REJECTION_MIN_PCT / 100);
      })
      .sort((a, b) => a.dist - b.dist);
    const nearest = candidates[0];

    if (nearest) {
      // Dedup per LEVEL HARGA (bukan cuma arah) -- toleransi sama kayak cluster, biar zona yang
      // "sama" secara praktis (misal $63.100 vs $63.150) gak dianggap 2 zona beda gara-gara noise.
      const sameZone = lastZone && pctDist(nearest.price, lastZone.price) <= CLUSTER_TOLERANCE_PCT;
      if (!sameZone) {
        // TP = zona LAWAN TERDEKAT (persis desain live Dark Kaela: "TP = zona lawan itu sendiri").
        // Buat LONG, TP dari `resistance` (di atas harga); buat SHORT, TP dari `support` (di bawah).
        const tpPool = nearest.direction === 'long' ? resistance : support;
        const tpZone = tpPool.slice().sort((a, b) => pctDist(a.price, c.close) - pctDist(b.price, c.close))[0] || null;
        events.push({ index: i, time: c.closeTime, type: 'signal', direction: nearest.direction, zonePrice: nearest.price, zoneKind: nearest.kind, touches: nearest.touches, price: c.close, tpPrice: tpZone ? tpZone.price : null });
        lastZone = { price: nearest.price, direction: nearest.direction, resolved: false };
      }
    }
  }

  return events;
}

// Resolusi nasib TIAP sinyal -- versi RIGOROUS (ganti versi "tersirat" sebelumnya yang cuma nebak
// dari arah sinyal berikutnya). Maju candle demi candle SETELAH sinyal muncul, WAJIB candle CLOSE
// (bukan wick) buat konfirmasi -- BOUNCE_CONFIRM_PCT = harga beneran pergi jauh ke arah yang
// diharapkan, BREAK_CONFIRM_PCT = harga tembus lawan arah. Kalau gak ada yang kejadian dalam
// RESOLVE_TIMEOUT_CANDLES, dianggap 'inconclusive' -- BUKAN dipaksa masuk salah satu kategori,
// biar statistik gak menyesatkan (jujur ada kasus yang emang gak jelas hasilnya).
const BOUNCE_CONFIRM_PCT = 1; // harga closing 1% menjauh dari zona ke arah yang diharapkan
const RESOLVE_TIMEOUT_CANDLES = 72; // 3 hari (candle jam-an) -- cukup buat gaya cepat Dark Kaela

// ============ Simulasi TRADE beneran (SL=zona, TP=zona lawan) -- ide Olan: rasio menang/kalah
// biner gak cukup, mungkin menangnya JAUH lebih besar dari kalahnya (SL tipis nempel zona, TP
// jauh di zona lawan) jadi tetap untung walau win rate rendah. R-multiple = leverage-agnostic
// (leverage cuma skala risiko&untung proporsional, gak ubah rasio R). WAJIB pakai HIGH/LOW
// (wick), BUKAN close -- order SL/TP beneran eksekusi begitu harga TERSENTUH, beda dari
// "konfirmasi sinyal" yang emang sengaja nunggu candle close.
const TRADE_TIMEOUT_CANDLES = 24 * 14; // 14 hari -- kasih waktu lebih lega dari RESOLVE_TIMEOUT
                                          // biasa, karena target (zona lawan) bisa jauh

function simulateTrade(signal) {
  if (signal.tpPrice == null) return { result: 'no-tp', r: null };
  const entry = signal.price;
  // slPrice (mode sweep) = ujung sweep+buffer, LEBIH AKURAT dari zonePrice mentah (mode lama).
  const sl = signal.slPrice != null ? signal.slPrice : signal.zonePrice;
  const dir = signal.direction;
  const riskDist = Math.abs(entry - sl);
  if (riskDist === 0) return { result: 'zero-risk', r: null };
  // TP_CAP_R: ambil yang LEBIH DEKAT antara target zona lawan asli vs batas R maksimal --
  // konservatif (gak nunggu lebih jauh dari yang perlu kalau capping-nya lebih ketat).
  let tp = signal.tpPrice;
  if (PARAMS.TP_CAP_R != null) {
    const capPrice = dir === 'long' ? entry + PARAMS.TP_CAP_R * riskDist : entry - PARAMS.TP_CAP_R * riskDist;
    tp = dir === 'long' ? Math.min(tp, capPrice) : Math.max(tp, capPrice);
  }
  const endIdx = Math.min(CANDLES.length, signal.index + 1 + TRADE_TIMEOUT_CANDLES);

  for (let j = signal.index + 1; j < endIdx; j++) {
    const c = CANDLES[j];
    if (dir === 'long') {
      const hitSl = c.low <= sl;
      const hitTp = c.high >= tp;
      if (hitSl && hitTp) return { result: 'sl', r: -1 }; // 2-2 di candle sama -- konservatif, SL menang
      if (hitSl) return { result: 'sl', r: -1 };
      if (hitTp) return { result: 'tp', r: (tp - entry) / riskDist };
    } else {
      const hitSl = c.high >= sl;
      const hitTp = c.low <= tp;
      if (hitSl && hitTp) return { result: 'sl', r: -1 };
      if (hitSl) return { result: 'sl', r: -1 };
      if (hitTp) return { result: 'tp', r: (entry - tp) / riskDist };
    }
  }
  return { result: 'timeout', r: null };
}

function resolveOutcome(signal) {
  const zone = signal.zonePrice;
  const dir = signal.direction;
  const endIdx = Math.min(CANDLES.length, signal.index + 1 + RESOLVE_TIMEOUT_CANDLES);
  for (let j = signal.index + 1; j < endIdx; j++) {
    const c = CANDLES[j];
    if (dir === 'long') {
      if (c.close < zone * (1 - BREAK_CONFIRM_PCT / 100)) return 'broken';
      if (c.close > zone * (1 + BOUNCE_CONFIRM_PCT / 100)) return 'bounced';
    } else {
      if (c.close > zone * (1 + BREAK_CONFIRM_PCT / 100)) return 'broken';
      if (c.close < zone * (1 - BOUNCE_CONFIRM_PCT / 100)) return 'bounced';
    }
  }
  return 'inconclusive';
}

// CURIGA BUG METODOLOGI (15 Agu 2026, dicek atas inisiatif sendiri sebelum lanjut riset lagi):
// Zona dideteksi dari WICK (high/low candle), TAPI resolveOutcome() ukur mantul/jebol relatif ke
// harga ZONA. Kalau NEAR_PCT lebar, wick bisa jauh dari zona SEMENTARA close candle sinyal itu
// SENDIRI udah duluan deket/lewatin threshold BOUNCE_CONFIRM_PCT -- near% lebar jadi keliatan
// "lebih sering mantul" bukan karena zona-nya beneran nahan, tapi karena definisi mantulnya
// gampang kepenuhi dari titik awal yang emang udah deket. Versi ini ukur relatif ke harga SAAT
// SINYAL (signal.price, closing candle sinyal) -- bebas dari confound itu, harusnya independen
// dari NEAR_PCT kalau bug-nya beneran ada.
function resolveOutcomeFromEntry(signal) {
  const entry = signal.price;
  const dir = signal.direction;
  const endIdx = Math.min(CANDLES.length, signal.index + 1 + RESOLVE_TIMEOUT_CANDLES);
  for (let j = signal.index + 1; j < endIdx; j++) {
    const c = CANDLES[j];
    if (dir === 'long') {
      if (c.close < entry * (1 - BREAK_CONFIRM_PCT / 100)) return 'broken';
      if (c.close > entry * (1 + BOUNCE_CONFIRM_PCT / 100)) return 'bounced';
    } else {
      if (c.close > entry * (1 + BREAK_CONFIRM_PCT / 100)) return 'broken';
      if (c.close < entry * (1 - BOUNCE_CONFIRM_PCT / 100)) return 'bounced';
    }
  }
  return 'inconclusive';
}

// excludeBefore: timestamp (ms) -- buang sinyal SEBELUM ini dari statistik (dipakai buang 2017,
// ketauan itu 1 tahun anomali yang nyumbang LEBIH dari 100% total untung, sisanya net rugi).
// sweepMode: true = pakai runSweepMode() (sweep+reclaim, SL di ujung sweep) ganti run() lama.
function summarizeTrades(label, overrides, excludeBefore, sweepMode) {
  resetParams(overrides);
  const events = sweepMode ? runSweepMode() : run();
  let signals = events.filter((e) => e.type === 'signal');
  if (excludeBefore) signals = signals.filter((s) => s.time >= excludeBefore);
  const trades = signals.map((s) => simulateTrade(s));
  const resolved = trades.filter((t) => t.result === 'tp' || t.result === 'sl');
  const wins = resolved.filter((t) => t.result === 'tp');
  const losses = resolved.filter((t) => t.result === 'sl');
  const totalR = resolved.reduce((s, t) => s + t.r, 0);
  const avgWinR = wins.length ? wins.reduce((s, t) => s + t.r, 0) / wins.length : 0;
  const grossWinR = wins.reduce((s, t) => s + t.r, 0);
  const grossLossR = Math.abs(losses.reduce((s, t) => s + t.r, 0));
  const profitFactor = grossLossR > 0 ? grossWinR / grossLossR : null;
  const winRate = resolved.length ? (wins.length / resolved.length) * 100 : 0;
  const expectancy = resolved.length ? totalR / resolved.length : 0;
  const noTp = trades.filter((t) => t.result === 'no-tp').length;
  const timeout = trades.filter((t) => t.result === 'timeout').length;
  console.log(`\n[${label}]`);
  console.log(`  Sinyal: ${signals.length} | resolved (TP/SL): ${resolved.length} | no-tp (gak ada zona lawan): ${noTp} | timeout (>14hr): ${timeout}`);
  console.log(`  Win rate: ${winRate.toFixed(1)}% | Avg R menang: +${avgWinR.toFixed(2)}R | Profit factor: ${profitFactor === null ? '∞' : profitFactor.toFixed(2)}`);
  console.log(`  Expectancy: ${expectancy >= 0 ? '+' : ''}${expectancy.toFixed(3)}R/trade | Total R (${resolved.length} trade): ${totalR >= 0 ? '+' : ''}${totalR.toFixed(1)}R`);
  return { signals, trades, resolved, wins, losses, winRate, expectancy, profitFactor };
}

// Breakdown PER TAHUN (WAJIB, pelajaran keras dari riset Sniper 4H sebelumnya -- pernah ketemu
// hasil "bagus" yang ternyata 99% untungnya cuma dari 1 tahun anomali 2020, gak boleh keulang).
function summarizeTradesByYear(label, overrides, sweepMode) {
  resetParams(overrides);
  const events = sweepMode ? runSweepMode() : run();
  const signals = events.filter((e) => e.type === 'signal');
  const byYear = {};
  signals.forEach((s) => {
    const t = simulateTrade(s);
    if (t.r === null) return;
    const year = new Date(s.time).getUTCFullYear();
    if (!byYear[year]) byYear[year] = { count: 0, totalR: 0, wins: 0 };
    byYear[year].count++;
    byYear[year].totalR += t.r;
    if (t.result === 'tp') byYear[year].wins++;
  });
  console.log(`\n[${label}] -- breakdown per tahun`);
  Object.keys(byYear).sort().forEach((y) => {
    const d = byYear[y];
    console.log(`  ${y}: ${d.count} trade | win rate ${((d.wins / d.count) * 100).toFixed(1)}% | Total R: ${d.totalR >= 0 ? '+' : ''}${d.totalR.toFixed(1)}R | expectancy ${(d.totalR / d.count) >= 0 ? '+' : ''}${(d.totalR / d.count).toFixed(3)}R/trade`);
  });
  return byYear;
}

function summarize(label, overrides) {
  resetParams(overrides);
  const events = run();
  const signals = events.filter((e) => e.type === 'signal');
  const outcomesZone = { bounced: 0, broken: 0, inconclusive: 0 };
  const outcomesEntry = { bounced: 0, broken: 0, inconclusive: 0 };
  signals.forEach((s) => {
    outcomesZone[resolveOutcome(s)]++;
    outcomesEntry[resolveOutcomeFromEntry(s)]++;
  });
  const avgEntryZoneDist = signals.reduce((sum, s) => sum + pctDist(s.price, s.zonePrice), 0) / signals.length;
  const daysSpan = (CANDLES[CANDLES.length - 1].closeTime - CANDLES[PARAMS.ZONE_WINDOW_CANDLES].closeTime) / 86400000;
  console.log(`\n[${label}] near=${PARAMS.NEAR_PCT}% minTouches=${PARAMS.MIN_TOUCHES} window=${PARAMS.ZONE_WINDOW_CANDLES / 24}hari`);
  console.log(`  Total sinyal: ${signals.length} | rata-rata/hari: ${(signals.length / daysSpan).toFixed(2)} | avg jarak close-sinyal ke zona: ${avgEntryZoneDist.toFixed(3)}%`);
  console.log(`  [relatif ZONA]  Mantul: ${(outcomesZone.bounced / signals.length * 100).toFixed(1)}% | Ditembus: ${(outcomesZone.broken / signals.length * 100).toFixed(1)}% | Timeout: ${(outcomesZone.inconclusive / signals.length * 100).toFixed(1)}%`);
  console.log(`  [relatif ENTRY] Mantul: ${(outcomesEntry.bounced / signals.length * 100).toFixed(1)}% | Ditembus: ${(outcomesEntry.broken / signals.length * 100).toFixed(1)}% | Timeout: ${(outcomesEntry.inconclusive / signals.length * 100).toFixed(1)}%`);
  return { signals, outcomesZone, outcomesEntry, daysSpan };
}

if (require.main === module) {
  console.log('=== Dark Kaela -- riset zona likuiditas ===');
  console.log('Rentang data:', new Date(CANDLES[PARAMS.ZONE_WINDOW_CANDLES].closeTime).toISOString().slice(0, 10), '->', new Date(CANDLES[CANDLES.length - 1].closeTime).toISOString().slice(0, 10));
  console.log('Total candle diproses:', CANDLES.length - PARAMS.ZONE_WINDOW_CANDLES);

  const base = summarize('BASELINE', { NEAR_PCT: 0.5, MIN_TOUCHES: 2, ZONE_WINDOW_CANDLES: 24 * 14 });

  console.log('\n--- 10 sinyal TERAKHIR (baseline, sample) ---');
  base.signals.slice(-10).forEach((s) => {
    console.log(`${new Date(s.time).toISOString().slice(0, 16)} | ${s.direction.toUpperCase()} @ zona $${s.zonePrice.toFixed(0)} (${s.zoneKind}${s.touches ? ', ' + s.touches + 'x' : ''}) | harga saat itu $${s.price.toFixed(0)}`);
  });

  // 2017 KETAHUAN anomali (nyumbang LEBIH dari 100% total untung, 2018-2026 net RUGI) --
  // SEMUA eksperimen mulai dari sini WAJIB exclude 2017, biar gak ketipu lagi.
  const EXCLUDE_2017 = new Date('2018-01-01T00:00:00Z').getTime();

  // Ronde 3 (15 Agu 2026, "cari inspirasi di internet" -- ketemu konsep SWEEP+RECLAIM beneran
  // dipakai trader, beda dari "deket zona" doang yang udah kebukti gak ada edge di Ronde 1-2).
  // SL sekarang di ujung sweep+buffer (bukan harga zona mentah) -- WAJIB exclude 2017.
  console.log('\n=== Ronde 3: mode SWEEP+RECLAIM (wick nembus zona, close balik) -- EXCLUDE 2017 ===');
  [2, 3, 4].forEach((t) => {
    [7, 14, 21].forEach((d) => {
      summarizeTrades(`sweep touches>=${t} window=${d}hari`, { MIN_TOUCHES: t, ZONE_WINDOW_CANDLES: 24 * d }, EXCLUDE_2017, true);
    });
  });

  // Ronde 4 -- dorong lebih jauh (touches lebih tinggi, jendela lebih lebar, pola makin ketat
  // makin mendekati breakeven di Ronde 3) + filter TREN (kunci pencegah fakeout menurut riset).
  console.log('\n=== Ronde 4: dorong lebih ketat + filter tren ===');
  [4, 5, 6].forEach((t) => {
    [21, 30, 45].forEach((d) => {
      summarizeTrades(`sweep touches>=${t} window=${d}hari`, { MIN_TOUCHES: t, ZONE_WINDOW_CANDLES: 24 * d, TREND_FILTER: 'off' }, EXCLUDE_2017, true);
    });
  });
  console.log('\n--- dengan filter tren, di titik terbaik Ronde 3 (touches>=4, window=21hari) ---');
  summarizeTrades('trend=off (baseline)', { MIN_TOUCHES: 4, ZONE_WINDOW_CANDLES: 24 * 21, TREND_FILTER: 'off' }, EXCLUDE_2017, true);
  summarizeTrades('trend=loose (buang lawan tren jelas)', { MIN_TOUCHES: 4, ZONE_WINDOW_CANDLES: 24 * 21, TREND_FILTER: 'loose' }, EXCLUDE_2017, true);
  summarizeTrades('trend=strict (wajib searah tren)', { MIN_TOUCHES: 4, ZONE_WINDOW_CANDLES: 24 * 21, TREND_FILTER: 'strict' }, EXCLUDE_2017, true);

  // Ronde 5 (15 Agu 2026, "cari lagi di internet" -- 2 ide baru: zona FRESH/belum sering
  // diretest justru lebih reliable dari yang sering disentuh KEBALIKAN dari asumsi awal), dan
  // filter jam sesi (London/NY open -- sweep katanya lebih reliable pas jam institusional aktif).
  console.log('\n=== Ronde 5: zona FRESH (touches rendah) + filter sesi ===');
  summarizeTrades('touches TEPAT 2 (paling fresh)', { MIN_TOUCHES: 2, MAX_TOUCHES: 2, ZONE_WINDOW_CANDLES: 24 * 21 }, EXCLUDE_2017, true);
  summarizeTrades('touches 2-3 (fresh)', { MIN_TOUCHES: 2, MAX_TOUCHES: 3, ZONE_WINDOW_CANDLES: 24 * 21 }, EXCLUDE_2017, true);
  summarizeTrades('touches 2-4', { MIN_TOUCHES: 2, MAX_TOUCHES: 4, ZONE_WINDOW_CANDLES: 24 * 21 }, EXCLUDE_2017, true);

  console.log('\n--- filter sesi jam UTC, di titik terbaik (touches>=5, window=21hari) ---');
  summarizeTrades('semua jam (baseline)', { MIN_TOUCHES: 5, ZONE_WINDOW_CANDLES: 24 * 21, SESSION_FILTER: null }, EXCLUDE_2017, true);
  summarizeTrades('London open (07-10 UTC)', { MIN_TOUCHES: 5, ZONE_WINDOW_CANDLES: 24 * 21, SESSION_FILTER: [7, 10] }, EXCLUDE_2017, true);
  summarizeTrades('NY open (13-16 UTC)', { MIN_TOUCHES: 5, ZONE_WINDOW_CANDLES: 24 * 21, SESSION_FILTER: [13, 16] }, EXCLUDE_2017, true);
  summarizeTrades('London+NY (07-16 UTC)', { MIN_TOUCHES: 5, ZONE_WINDOW_CANDLES: 24 * 21, SESSION_FILTER: [7, 16] }, EXCLUDE_2017, true);
  summarizeTrades('luar sesi (16-07 UTC)', { MIN_TOUCHES: 5, ZONE_WINDOW_CANDLES: 24 * 21, SESSION_FILTER: [16, 7] }, EXCLUDE_2017, true);

  // WAJIB: cek per tahun buat konfigurasi yang kelihatan positif (NY session) -- jangan sampai
  // ternyata 1 tahun doang yang nyumbang, pola yang udah berulang kali ketemu malam ini.
  console.log('\n=== WAJIB: breakdown per tahun buat NY session (touches>=5, window=21, NY 13-16 UTC) ===');
  summarizeTradesByYear('NY session -- SEMUA tahun (termasuk 2017)', { MIN_TOUCHES: 5, ZONE_WINDOW_CANDLES: 24 * 21, SESSION_FILTER: [13, 16] }, true);
}

module.exports = { CANDLES, detectZones, run, runSweepMode, roundNumberStep, resolveOutcome, resolveOutcomeFromEntry, simulateTrade, summarize, summarizeTrades, summarizeTradesByYear, PARAMS };
