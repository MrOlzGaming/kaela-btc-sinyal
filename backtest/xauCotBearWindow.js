// xauCotBearWindow.js (19 Sep 2026, riset lanjutan short Emas -- lihat memori
// project-kaela-btc-sinyal & RESEARCH-LOG.md) -- setelah SMA200-based bear window buat Emas
// TERBUKTI gagal di segala variasi (SMA150/200/250, forceCloseOnFlip on/off, semua kalah dari
// baseline buy-only $11.469), Olan minta riset "siapa hebat trading Emas di dunia, kita bisa
// tiru" -- ketemu: institusi (Soros dkk) baca lewat MAKRO, bukan pola harga sendiri, dan kerangka
// paling konkret+terukur dari situ adalah posisi COT (Commitment of Traders, CFTC resmi) --
// khusus positioning COMMERCIAL (produser/hedger fisik, BUKAN noncomm/managed-money yang udah
// dipakai `cotReport.js` buat indikator Analyst Terminal, itu speculator/trend-follower).
//
// HIPOTESIS (dari riset web, "extreme net short Commercials sering nandain potensi titik balik
// bawah") -- TAPI belum tau arah pastinya buat dipakai sebagai GATE short/bear-window, jadi kode
// ini TEST DUA ARAH sekaligus (z-score commercial net positioning RENDAH vs TINGGI), gak
// presuppose mana yang bener -- itung-itungan yang mutusin, bukan asumsi.
//
// SUMBER DATA: publicreporting.cftc.gov (CFTC resmi, GRATIS, no-key) -- dataset yang SAMA persis
// dipakai cotReport.js, TERNYATA nyimpen histori sampai 1986 (dicek manual 19 Sep 2026), cukup
// jauh buat nutup rentang backtest Emas (2001-2026). Data MINGGUAN (publish tiap Jumat, "as of"
// hari Selasa) -- WAJIB kasih LAG biar gak lookahead-bias (market baru "tau" data ini beberapa
// hari SETELAH tanggal "as of"-nya, bukan pas itu juga).

const fs = require('fs');
const path = require('path');
const { fetchWithRetry } = require('../httpRetry');

const CFTC_BASE = 'https://publicreporting.cftc.gov/resource/6dca-aqww.json';
const GOLD_MARKET_NAME = 'GOLD - COMMODITY EXCHANGE INC.';
const CACHE_PATH = path.join(__dirname, 'xau-cot-history-cache.json');
// COT report publish Jumat buat data "as of" Selasa minggu itu -- ~3 hari kalender. Kasih extra
// margin jadi 4 hari (aman dari libur/weekend geser jadwal publish).
const PUBLISH_LAG_DAYS = 4;

async function fetchFullGoldCotHistory({ useCache = true } = {}) {
  if (useCache && fs.existsSync(CACHE_PATH)) {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  }
  const rows = [];
  const pageSize = 1000;
  let offset = 0;
  for (;;) {
    const url = `${CFTC_BASE}?market_and_exchange_names=${encodeURIComponent(GOLD_MARKET_NAME)}&$order=report_date_as_yyyy_mm_dd ASC&$limit=${pageSize}&$offset=${offset}`;
    const res = await fetchWithRetry(url);
    const page = await res.json();
    if (!page.length) break;
    rows.push(...page.map((r) => ({
      date: r.report_date_as_yyyy_mm_dd.slice(0, 10),
      commLong: +r.comm_positions_long_all,
      commShort: +r.comm_positions_short_all,
      openInterest: +r.open_interest_all,
    })));
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  if (useCache) fs.writeFileSync(CACHE_PATH, JSON.stringify(rows));
  return rows;
}

// Z-score net positioning Commercial (% dari open interest) vs histori TRAILING sendiri (window
// bergulir, DEFAULT 156 minggu ~ 3 tahun -- cukup panjang buat nangkep siklus, cukup pendek biar
// "ekstrem" berarti relatif ke rezim BARU-BARU ini, bukan ekstrem 40 tahun lalu yang gak relevan
// lagi buat pasar SEKARANG. Pola SAMA kayak anomalyScanner.js -- z-score vs histori SENDIRI).
function computeCommercialZScoreSeries(cotHistory, lookbackWeeks = 156) {
  const netPct = cotHistory.map((r) => ((r.commLong - r.commShort) / r.openInterest) * 100);
  return cotHistory.map((r, i) => {
    if (i < lookbackWeeks) return { date: r.date, z: null };
    const window = netPct.slice(i - lookbackWeeks, i);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / window.length;
    const sd = Math.sqrt(variance);
    const z = sd > 0 ? (netPct[i] - mean) / sd : 0;
    return { date: r.date, z };
  });
}

// `direction`: 'low' = window aktif kalau z-score DI BAWAH -threshold (commercial LEBIH net-short
// dari biasanya -- hipotesis riset web). 'high' = window aktif kalau z-score DI ATAS +threshold
// (commercial LEBIH net-long dari biasanya -- arah kebalikan, dites juga biar gak presuppose).
function makeXauCotBearWindowFn(zScoreSeries, { threshold = 1.5, direction = 'low' } = {}) {
  const map = new Map();
  for (let i = 0; i < zScoreSeries.length; i++) {
    const { date, z } = zScoreSeries[i];
    if (z === null) continue;
    const effectiveDate = new Date(new Date(date).getTime() + PUBLISH_LAG_DAYS * 86400000);
    const active = direction === 'low' ? z < -threshold : z > threshold;
    map.set(effectiveDate.toISOString().slice(0, 10), active);
  }
  // Forward-fill -- window MINGGUAN, tapi backtest butuh nilai per HARI (di antara 2 laporan,
  // status "aktif/nggak" TETAP dari laporan terakhir yang kebaca, bukan kosong).
  const sortedDates = [...map.keys()].sort();
  return (d) => {
    const key = d.toISOString().slice(0, 10);
    let lo = 0, hi = sortedDates.length - 1, best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sortedDates[mid] <= key) { best = sortedDates[mid]; lo = mid + 1; } else hi = mid - 1;
    }
    return best ? map.get(best) : false;
  };
}

module.exports = { fetchFullGoldCotHistory, computeCommercialZScoreSeries, makeXauCotBearWindowFn, CACHE_PATH };
