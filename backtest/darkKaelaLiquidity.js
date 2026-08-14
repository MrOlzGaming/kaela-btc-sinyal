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
};

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
    .filter((z) => z.touches >= PARAMS.MIN_TOUCHES)
    .map((z) => ({ price: z.price, touches: z.touches, kind: 'swing' }));
  const support = clusterLevels(lows.filter((l) => l.price < price), CLUSTER_TOLERANCE_PCT)
    .filter((z) => z.touches >= PARAMS.MIN_TOUCHES)
    .map((z) => ({ price: z.price, touches: z.touches, kind: 'swing' }));

  const [roundBelow, roundAbove] = nearestRoundLevels(price);
  if (roundAbove) resistance.push({ price: roundAbove, touches: null, kind: 'round' });
  if (roundBelow) support.push({ price: roundBelow, touches: null, kind: 'round' });

  return { resistance, support };
}

function pctDist(a, b) {
  return Math.abs(a - b) / b * 100;
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
    const candidates = [
      ...support.map((z) => ({ ...z, direction: 'long', dist: pctDist(c.low, z.price) })),
      ...resistance.map((z) => ({ ...z, direction: 'short', dist: pctDist(c.high, z.price) })),
    ].filter((z) => z.dist <= PARAMS.NEAR_PCT).sort((a, b) => a.dist - b.dist);
    const nearest = candidates[0];

    if (nearest) {
      // Dedup per LEVEL HARGA (bukan cuma arah) -- toleransi sama kayak cluster, biar zona yang
      // "sama" secara praktis (misal $63.100 vs $63.150) gak dianggap 2 zona beda gara-gara noise.
      const sameZone = lastZone && pctDist(nearest.price, lastZone.price) <= CLUSTER_TOLERANCE_PCT;
      if (!sameZone) {
        events.push({ index: i, time: c.closeTime, type: 'signal', direction: nearest.direction, zonePrice: nearest.price, zoneKind: nearest.kind, touches: nearest.touches, price: c.close });
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

function summarize(label, overrides) {
  Object.assign(PARAMS, overrides);
  const events = run();
  const signals = events.filter((e) => e.type === 'signal');
  const outcomes = { bounced: 0, broken: 0, inconclusive: 0 };
  signals.forEach((s) => { outcomes[resolveOutcome(s)]++; });
  const daysSpan = (CANDLES[CANDLES.length - 1].closeTime - CANDLES[PARAMS.ZONE_WINDOW_CANDLES].closeTime) / 86400000;
  console.log(`\n[${label}] near=${PARAMS.NEAR_PCT}% minTouches=${PARAMS.MIN_TOUCHES} window=${PARAMS.ZONE_WINDOW_CANDLES / 24}hari`);
  console.log(`  Total sinyal: ${signals.length} | rata-rata/hari: ${(signals.length / daysSpan).toFixed(2)}`);
  console.log(`  Mantul confirmed: ${outcomes.bounced} (${(outcomes.bounced / signals.length * 100).toFixed(1)}%) | Ditembus confirmed: ${outcomes.broken} (${(outcomes.broken / signals.length * 100).toFixed(1)}%) | Gak jelas (timeout): ${outcomes.inconclusive} (${(outcomes.inconclusive / signals.length * 100).toFixed(1)}%)`);
  return { signals, outcomes, daysSpan };
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

  console.log('\n=== Sensitivitas parameter (sweep) ===');
  summarize('lebih ketat (near=0.3%)', { NEAR_PCT: 0.3, MIN_TOUCHES: 2, ZONE_WINDOW_CANDLES: 24 * 14 });
  summarize('lebih longgar (near=1%)', { NEAR_PCT: 1, MIN_TOUCHES: 2, ZONE_WINDOW_CANDLES: 24 * 14 });
  summarize('signifikansi lebih tinggi (touches>=3)', { NEAR_PCT: 0.5, MIN_TOUCHES: 3, ZONE_WINDOW_CANDLES: 24 * 14 });
  summarize('signifikansi lebih tinggi lagi (touches>=4)', { NEAR_PCT: 0.5, MIN_TOUCHES: 4, ZONE_WINDOW_CANDLES: 24 * 14 });
  summarize('jendela lebih lebar (30 hari)', { NEAR_PCT: 0.5, MIN_TOUCHES: 2, ZONE_WINDOW_CANDLES: 24 * 30 });
  summarize('ketat + signifikan (near=0.3%, touches>=3)', { NEAR_PCT: 0.3, MIN_TOUCHES: 3, ZONE_WINDOW_CANDLES: 24 * 14 });

  // Fokus lebih dalam ke near% (efeknya paling kelihatan dari sweep sebelumnya) -- cari titik
  // belok kurva frekuensi vs rasio mantul.
  console.log('\n=== Sweep khusus near% (efek paling kelihatan sejauh ini) ===');
  [0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3].forEach((n) => {
    summarize(`near=${n}%`, { NEAR_PCT: n, MIN_TOUCHES: 2, ZONE_WINDOW_CANDLES: 24 * 14 });
  });
}

module.exports = { CANDLES, detectZones, run, roundNumberStep, resolveOutcome, summarize, PARAMS };
