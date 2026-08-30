// dxyContext.js (28 Agu 2026, permintaan Olan: "analisa DXY juga buat sinyal kita, jadi ada
// analisa BTC, XAU, dan DXY") -- DXY (US Dollar Index) GAK ADA di Binance sama sekali, jadi ini
// BUKAN aset tradeable kayak BTC/XAU. Sesuai keputusan Olan: DXY cuma jadi KONTEKS/korelasi
// tambahan di pesan sinyal BTC/XAU yang UDAH ADA ("dolar lagi kuat/lemah, biasanya narik harga
// ke arah mana") -- gak ada posisi/eksekusi DXY beneran.
//
// Sumber data: Yahoo Finance chart endpoint (GRATIS, gak perlu API key, dipakai umum secara
// unofficial buat data index kayak gini) -- simbol DX-Y.NYB (ICE US Dollar Index).

const DXY_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1d&range=5d';

// Cache in-memory per proses (28 Agu 2026) -- dipanggil dari BANYAK titik per siklus (tiap kali
// ada sinyal BTC/XAU baru), gak perlu fetch ulang Yahoo tiap panggilan. TTL 10 menit cukup buat
// konteks makro (DXY gak gerak secepat crypto).
let _cache = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

async function fetchDxyContext() {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_TTL_MS) return _cache;

  try {
    const res = await fetch(DXY_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await res.json();
    const meta = data.chart.result[0].meta;
    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose;
    const changePct = ((price - prevClose) / prevClose) * 100;

    let trendLabel;
    if (changePct > 0.15) trendLabel = 'dolar MENGUAT -- historisnya narik BTC/emas ke bawah';
    else if (changePct < -0.15) trendLabel = 'dolar MELEMAH -- historisnya dukung BTC/emas ke atas';
    else trendLabel = 'dolar relatif netral -- efek ke BTC/emas gak dominan hari ini';

    _cache = { ok: true, price, changePct, trendLabel };
  } catch (e) {
    console.log('[DxyContext] Gagal ambil data DXY (dilewatin, konteks aja):', e.message);
    _cache = { ok: false };
  }
  _cacheAt = now;
  return _cache;
}

// Baris pendek buat disisipin di pesan sinyal -- return '' (bukan throw) kalau data gagal diambil,
// biar pesan sinyal utama TETAP kekirim walau DXY down/error (konteks tambahan, bukan syarat).
async function formatDxyLine() {
  const ctx = await fetchDxyContext();
  if (!ctx.ok) return '';
  const arrow = ctx.changePct >= 0 ? '📈' : '📉';
  return `💵 DXY ${ctx.price.toFixed(2)} (${ctx.changePct >= 0 ? '+' : ''}${ctx.changePct.toFixed(2)}%) ${arrow} -- ${ctx.trendLabel}`;
}

// ============ Konfirmasi DXY buat entry LIVE (31 Agu 2026) ============
// Permintaan Olan: "setiap entry juga diyakinkan dengan dxy" -- BEDA dari formatDxyLine() di atas
// (yang cuma day-over-day, buat KONTEKS pesan doang). Ini PERSIS logika yang udah divalidasi ketat
// di backtest (backtest/dxyFilter.js, "dolar LEMAH" = close < SMA20 sendiri) -- lolos 2 tes ketat
// (split era + sensitivitas parameter) khusus buat NYOPET v2 (BTC+Emas). Sniper SENGAJA TIDAK
// dikasih ini -- gagal di dua tes yang sama (edge cuma numpuk di 1 era/tahun, bukan asli), lihat
// memori project-dark-kaela.
//
// Cache in-memory TERPISAH dari fetchDxyContext (butuh HISTORI harian buat SMA, bukan cuma
// harga+prevClose 5 hari) -- TTL 1 jam cukup (SMA20 harian gak berubah drastis dalam sejam).
const DXY_DAILY_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1d&range=3mo';
let _dailyCache = null;
let _dailyCacheAt = 0;
const DAILY_CACHE_TTL_MS = 60 * 60 * 1000;

async function fetchDxyDailyCloses() {
  const now = Date.now();
  if (_dailyCache && now - _dailyCacheAt < DAILY_CACHE_TTL_MS) return _dailyCache;
  const res = await fetch(DXY_DAILY_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await res.json();
  const result = data.chart.result[0];
  const closes = result.indicators.quote[0].close.filter((c) => c != null);
  _dailyCache = closes;
  _dailyCacheAt = now;
  return closes;
}

// Balikin true (lemah, LOLOS filter)/false (kuat, DITOLAK)/null (data gagal diambil -- treat
// sbg LOLOS, sama kayak dxyFilter.js backtest, biar gangguan fetch DXY gak nge-block SEMUA
// trading Nyopet -- ini konfirmasi TAMBAHAN, bukan syarat mutlak sistem baru bisa jalan).
async function isDxyWeak(smaLen = 20) {
  try {
    const { sma } = require('./technicalAnalysis');
    const closes = await fetchDxyDailyCloses();
    if (closes.length < smaLen) return null;
    const smaVal = sma(closes, smaLen);
    const latest = closes[closes.length - 1];
    if (smaVal === null) return null;
    return latest < smaVal;
  } catch (e) {
    console.log('[DxyContext] Gagal cek tren DXY (dilewatin, dianggap lolos):', e.message);
    return null;
  }
}

module.exports = { fetchDxyContext, formatDxyLine, isDxyWeak };
