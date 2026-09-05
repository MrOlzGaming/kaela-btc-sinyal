// backtest/econReactionBacktest.js -- Uji hipotesis STRATEGI BARU (5 Sep 2026, permintaan Olan:
// "izinkan long/short auto dari hasil data itu") -- SEBELUM auto-trading beneran dibangun, uji
// dulu apa reaksi harga BTC SENDIRI di 5-15 menit pertama abis rilis data ekonomi high-impact
// BENERAN nunjukkin kelanjutan arah (momentum continuation), bukan cuma kelihatan masuk akal
// secara teori (sama disiplin yang dipake nolak parameter gap-age-cap kemarin).
//
// SCOPE: pakai NFP (Non-Farm Payrolls) doang buat backtest INI -- alasan PRAKTIS: tanggal+jam
// rilisnya 100% DETERMINISTIK (Jumat pertama tiap bulan, 8:30 pagi ET), TANPA perlu API/scraping
// data historis kalender ekonomi (yang GRATISnya gak ada -- ForexFactory cuma nyimpen "minggu
// ini", historis di balik API berbayar). FOMC/CPI SENGAJA belum dimasukin (butuh daftar tanggal
// historis manual, rawan typo/gak lengkap gratis) -- bisa ditambah NANTI kalau NFP-nya kebukti
// ada edge asli.
//
// METODE: harga BTC "SEBELUM" (~5 menit sebelum NFP) vs "SINYAL" (~10 menit sesudah -- SAMA
// PERSIS titik tengah jendela T+5..T+15 yang dipake econCalendarLiveMonitor.js beneran) -> reaksi
// % -> di atas threshold noise dianggap sinyal LONG (naik) atau SHORT (turun). Diukur return
// FORWARD dari titik SINYAL (bukan dari waktu event) di beberapa horizon -- BUKAN simulasi
// SL/TP/leverage dulu (itu detail eksekusi buat NANTI kalau hipotesis dasarnya kebukti beneran
// ada edge, bukan hal pertama yang diuji). Breakdown per tahun + split 2 era WAJIB.

const { fetchKlines } = require('./fetchKlines');

const REACTION_THRESHOLD_PCT = 0.10; // BTC gerak >0.10% di jendela reaksi -> dianggap sinyal, bukan noise
const HORIZONS_MIN = { '30m': 30, '1h': 60, '4h': 240, '24h': 1440 };

// ── Tanggal+jam NFP deterministik (Jumat pertama tiap bulan, 8:30 ET) ──────────────────────────
// DST AS konsisten sejak 2007: mulai Minggu ke-2 Maret, berakhir Minggu ke-1 November.
function nthSundayUTC(year, monthIndex, n) {
  const d = new Date(Date.UTC(year, monthIndex, 1));
  let count = 0;
  while (true) {
    if (d.getUTCDay() === 0) { count += 1; if (count === n) return d.getTime(); }
    d.setUTCDate(d.getUTCDate() + 1);
  }
}
function isEDT(dateUTCms) {
  const year = new Date(dateUTCms).getUTCFullYear();
  return dateUTCms >= nthSundayUTC(year, 2, 2) && dateUTCms < nthSundayUTC(year, 10, 1);
}
function firstFridayUTC(year, monthIndex) {
  const d = new Date(Date.UTC(year, monthIndex, 1));
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
function nfpTimestampUTC(year, monthIndex) {
  const friday = firstFridayUTC(year, monthIndex);
  const noonCheck = Date.UTC(year, monthIndex, friday.getUTCDate(), 12);
  const utcHour = isEDT(noonCheck) ? 12 : 13; // 8:30 EDT = 12:30 UTC, 8:30 EST = 13:30 UTC
  return Date.UTC(year, monthIndex, friday.getUTCDate(), utcHour, 30);
}
function generateNfpEvents(startYear, endYear) {
  const events = [];
  for (let y = startYear; y <= endYear; y += 1) {
    for (let m = 0; m < 12; m += 1) {
      const ts = nfpTimestampUTC(y, m);
      if (ts > Date.now()) continue;
      events.push({ label: `NFP ${y}-${String(m + 1).padStart(2, '0')}`, timeMs: ts });
    }
  }
  return events;
}

function findPriceAt(candles, targetMs) {
  for (const c of candles) if (c.openTime >= targetMs) return c.open;
  return null;
}

async function analyzeEvent(ev) {
  const startMs = ev.timeMs - 10 * 60 * 1000;
  const endMs = ev.timeMs + (Math.max(...Object.values(HORIZONS_MIN)) + 15) * 60 * 1000;
  let candles;
  try {
    candles = await fetchKlines('BTCUSDT', '1m', startMs, endMs);
  } catch (e) {
    console.log(`[Skip] ${ev.label}: gagal fetch candle (${e.message})`);
    return null;
  }
  if (candles.length < 20) { console.log(`[Skip] ${ev.label}: candle gak cukup (data historis Binance mungkin belum ada di rentang ini)`); return null; }

  const priceBefore = findPriceAt(candles, ev.timeMs - 5 * 60 * 1000);
  const priceSignal = findPriceAt(candles, ev.timeMs + 10 * 60 * 1000);
  if (priceBefore == null || priceSignal == null) return null;

  const reactionPct = ((priceSignal - priceBefore) / priceBefore) * 100;
  if (Math.abs(reactionPct) < REACTION_THRESHOLD_PCT) return { ev, direction: 'NETRAL', reactionPct, forward: {} };

  const direction = reactionPct > 0 ? 'LONG' : 'SHORT';
  const forward = {};
  for (const [label, mins] of Object.entries(HORIZONS_MIN)) {
    const priceAt = findPriceAt(candles, ev.timeMs + (10 + mins) * 60 * 1000);
    forward[label] = priceAt != null ? ((priceAt - priceSignal) / priceSignal) * 100 * (direction === 'LONG' ? 1 : -1) : null;
  }
  return { ev, direction, reactionPct, forward };
}

// 5 Sep 2026, permintaan Olan ("coba scalp super pendek ~30 menit") -- edge MENTAH di 30m tipis
// banget (+0.049% rata-rata SEMUA sinyal) -- BELUM dipotong biaya transaksi. ROUND_TRIP_COST_PCT
// = perkiraan KONSERVATIF taker fee masuk+keluar Binance Futures (~0.04-0.05%/sisi = ~0.08-0.10%
// pp trip) -- BELUM termasuk slippage (yang justru BISA LEBIH BESAR pas volatilitas tinggi abis
// rilis data, persis momen strategi ini masuk) -- jadi ini estimasi PALING RINGAN, kenyataan bisa
// lebih mahal.
const ROUND_TRIP_COST_PCT = 0.10;

function summarize(rows, label, opts = {}) {
  if (!rows.length) { console.log(`  ${label}: n=0`); return; }
  for (const h of Object.keys(HORIZONS_MIN)) {
    const vals = rows.map((r) => r.forward[h]).filter((v) => v != null);
    if (!vals.length) continue;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const winRate = (vals.filter((v) => v > 0).length / vals.length) * 100;
    const sumWin = vals.filter((v) => v > 0).reduce((a, b) => a + b, 0);
    const sumLoss = Math.abs(vals.filter((v) => v < 0).reduce((a, b) => a + b, 0));
    const pf = sumLoss > 0 ? (sumWin / sumLoss).toFixed(2) : (sumWin > 0 ? 'inf' : '-');
    let netStr = '';
    if (opts.showNetOfCost) {
      const netVals = vals.map((v) => v - ROUND_TRIP_COST_PCT);
      const netAvg = netVals.reduce((a, b) => a + b, 0) / netVals.length;
      const netWinRate = (netVals.filter((v) => v > 0).length / netVals.length) * 100;
      const netSumWin = netVals.filter((v) => v > 0).reduce((a, b) => a + b, 0);
      const netSumLoss = Math.abs(netVals.filter((v) => v < 0).reduce((a, b) => a + b, 0));
      const netPf = netSumLoss > 0 ? (netSumWin / netSumLoss).toFixed(2) : (netSumWin > 0 ? 'inf' : '-');
      netStr = ` || NET biaya(${ROUND_TRIP_COST_PCT}%): avgReturn=${netAvg.toFixed(3)}% winRate=${netWinRate.toFixed(1)}% PF=${netPf}`;
    }
    console.log(`  ${label} @ ${h}: n=${vals.length} avgReturn=${avg.toFixed(3)}% winRate=${winRate.toFixed(1)}% PF=${pf}${netStr}`);
  }
}

async function main() {
  const events = generateNfpEvents(2019, 2026);
  console.log(`Total event NFP dicoba: ${events.length}`);
  const results = [];
  for (const ev of events) {
    const r = await analyzeEvent(ev);
    if (r) results.push(r);
    await new Promise((res) => setTimeout(res, 200)); // jaga rate-limit Binance
  }

  const signaled = results.filter((r) => r.direction !== 'NETRAL');
  console.log(`\nEvent berhasil dianalisa: ${results.length} | Ada sinyal (>${REACTION_THRESHOLD_PCT}%): ${signaled.length} | Netral: ${results.length - signaled.length}`);

  console.log('\n=== SEMUA SINYAL (LONG+SHORT digabung, arah udah dinormalisasi ke "profit kalau lanjut") ===');
  summarize(signaled, 'ALL', { showNetOfCost: true });
  console.log('\n=== LONG signal doang (BTC naik duluan) ===');
  summarize(signaled.filter((r) => r.direction === 'LONG'), 'LONG', { showNetOfCost: true });
  console.log('\n=== SHORT signal doang (BTC turun duluan) ===');
  summarize(signaled.filter((r) => r.direction === 'SHORT'), 'SHORT', { showNetOfCost: true });

  console.log('\n=== BREAKDOWN PER TAHUN (semua sinyal) ===');
  const byYear = {};
  for (const r of signaled) {
    const y = new Date(r.ev.timeMs).getUTCFullYear();
    (byYear[y] = byYear[y] || []).push(r);
  }
  for (const y of Object.keys(byYear).sort()) summarize(byYear[y], `${y} (n_event=${byYear[y].length})`);

  console.log('\n=== SPLIT ERA (before/after 2023-01-01) ===');
  const era1 = signaled.filter((r) => r.ev.timeMs < Date.UTC(2023, 0, 1));
  const era2 = signaled.filter((r) => r.ev.timeMs >= Date.UTC(2023, 0, 1));
  summarize(era1, `Era1 <2023 (n_event=${era1.length})`);
  summarize(era2, `Era2 >=2023 (n_event=${era2.length})`);
}

if (require.main === module) {
  main().catch((e) => { console.error('ERROR econReactionBacktest.js:', e.message); process.exit(1); });
}

module.exports = { generateNfpEvents, nfpTimestampUTC };
