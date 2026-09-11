// tvEconActual.js -- ambil ACTUAL hasil rilis ekonomi dari endpoint publik TradingView (gratis,
// gak butuh API key, dipakai jutaan trader tiap hari buat kalender ekonomi mereka sendiri).
// 12 Sep 2026, permintaan Olan (grup nanya "kok netral terus") -- feed gratis ForexFactory
// (nfs.faireconomy.media, dipakai econCalendar.js) STRUKTURAL gak pernah ngisi field `actual`
// (dikonfirmasi langsung 12 Sep). 2 provider RapidAPI dicoba abis itu (HorizonFX -- ternyata gak
// kedaftar di RapidAPI sama sekali; "Economic Events Calendar" by UltimateApps -- kedaftar tapi
// endpoint-nya sendiri di-nonaktifin provider buat paket gratis, HTTP 402). Finnhub juga dicoba,
// endpoint kalender ekonominya di-gembok ke paket berbayar (403). Endpoint TradingView ini KETES
// LANGSUNG (chat 12 Sep) dan beneran ngasih actual real-time buat event high-impact minggu itu
// (CPI/PPI/Michigan Sentiment dst, semua keisi persis pas hari rilisnya).
//
// ⚠️ Endpoint TIDAK RESMI/gak didokumentasiin TradingView (dipakai diam-diam banyak proyek
// komunitas trading, bukan API berkontrak) -- resiko kecil sewaktu-waktu berubah format/diblokir
// tanpa pemberitahuan. Degradasi AMAN kalau gagal/berubah: actual tetap kosong (behavior SAMA
// kayak sebelum fitur ini ada), gak pernah throw ke pemanggil, gak pernah pengaruhi sinyal trading
// (sinyal econ-reaction di econCalendarLiveMonitor.js pakai reaksi harga BTC sendiri, bukan actual).

const { fetchWithRetry } = require('./httpRetry');

const TV_URL = 'https://economic-calendar.tradingview.com/events';
const TV_HEADERS = { Origin: 'https://www.tradingview.com', 'User-Agent': 'Mozilla/5.0' };

async function fetchTvEvents(fromDate, toDate, countries = 'US') {
  const url = `${TV_URL}?from=${fromDate.toISOString()}&to=${toDate.toISOString()}&countries=${countries}`;
  const res = await fetchWithRetry(url, { headers: TV_HEADERS });
  const j = await res.json();
  return (j && j.result) || [];
}

// Tag indikator disederhanakan -- SOLO buat nyocokin "event FF ini = event TV yang mana", BEDA
// dari econDirectionalView.js (yang nentuin arah sebab-akibat). Basis + flag core/mom/yoy WAJIB
// ada -- 12 Sep 2026 kebukti nyata 4 varian CPI (CPI m/m, CPI y/y, Core CPI m/m, Core CPI y/y)
// rilis di JAM YANG PERSIS SAMA, tag doang berbasis waktu bakal ketuker actual-nya.
function _tag(title) {
  const t = (title || '').toLowerCase();
  // "Ex Food, Energy and Trade" dkk -- varian sempit yang TradingView pisahin dari "Core" biasa.
  // FF gak PERNAH pakai wording ini (cuma "Core X m/m" polos) -- kalau gak disaring, bisa ketuker
  // sama angka PPI/CPI polos yang rilis di jam yang sama persis (ketemu nyata 12 Sep 2026, tes).
  if (/\bex\b/.test(t)) return null;
  const core = /\bcore\b/.test(t);
  // TradingView nulis "MoM"/"YoY" (ada huruf 'o'), ForexFactory nulis "m/m"/"y/y" -- DUA-DUANYA
  // wajib ketangkep (bug nyata ketemu 12 Sep 2026: regex lama cuma nangkep gaya FF, semua match TV gagal).
  const yoy = /\byoy\b|y\/?y|year-over-year|\bannual\b/.test(t);
  const mom = !yoy && /\bmom\b|m\/?m|month-over-month|\bmonthly\b/.test(t);
  let base = null;
  if (/\bcpi\b|consumer price index|inflation rate/.test(t)) base = 'cpi';
  else if (/\bppi\b|producer price index/.test(t)) base = 'ppi';
  else if (/non-?farm|nonfarm|payroll/.test(t)) base = 'nfp';
  else if (/unemployment rate/.test(t)) base = 'unemployment';
  else if (/initial jobless claims/.test(t)) base = 'jobless_claims';
  else if (/retail sales/.test(t)) base = 'retail_sales';
  else if (/\bgdp\b|gross domestic product/.test(t)) base = 'gdp';
  else if (/federal funds rate|fomc|interest rate decision|fed interest rate/.test(t)) base = 'fomc';
  else if (/pce price index|personal consumption expenditures/.test(t)) base = 'pce';
  else if (/jolts|job openings/.test(t)) base = 'jolts';
  else if (/michigan|uom consumer sentiment|\bconsumer sentiment\b/.test(t)) base = 'umich';
  else if (/consumer confidence/.test(t)) base = 'cb_confidence';
  else if (/durable goods/.test(t)) base = 'durable_goods';
  else if (/ism manufacturing|ism services|ism non-manufacturing|ism pmi/.test(t)) base = 'ism';
  else if (/existing home sales/.test(t)) base = 'existing_home_sales';
  else if (/new home sales/.test(t)) base = 'new_home_sales';
  else if (/housing starts/.test(t)) base = 'housing_starts';
  else if (/building permits/.test(t)) base = 'building_permits';
  else if (/trade balance/.test(t)) base = 'trade_balance';
  else if (/crude oil inventories/.test(t)) base = 'crude_oil';
  if (!base) return null;
  return `${base}${core ? '_core' : ''}${yoy ? '_yoy' : mom ? '_mom' : ''}`;
}

const MATCH_WINDOW_MS = 10 * 60 * 1000; // +-10 menit -- rilis yang sama harusnya PERSIS/nyaris sama waktunya

// Cari nilai actual TV yang cocok buat 1 event FF -- null kalau gak ketemu match yang yakin
// (SENGAJA gak maksa nebak, mending kosong drpd salah tempel angka indikator lain).
function findTvActual(tvEvents, ffEvent) {
  const tag = _tag(ffEvent.rawTitle);
  if (!tag) return null;
  const candidates = tvEvents.filter((tv) => {
    if (tv.actual === null || tv.actual === undefined) return false;
    if (_tag(tv.title) !== tag) return false;
    return Math.abs(new Date(tv.date).getTime() - ffEvent.timeMs) <= MATCH_WINDOW_MS;
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Math.abs(new Date(a.date).getTime() - ffEvent.timeMs) - Math.abs(new Date(b.date).getTime() - ffEvent.timeMs));
  return candidates[0];
}

// Enrich SEMUA event (mutasi in-place field `.actual`) -- 1x fetch buat seluruh batch, hemat
// request. Gagal fetch TOTAL = semua event tetap actual kosong (degradasi aman, SAMA kayak
// sebelum fitur ini ada, gak pernah throw ke pemanggil).
async function enrichWithTvActual(events, now = new Date()) {
  if (events.length === 0) return events;
  const from = new Date(Math.min(...events.map((e) => e.timeMs)) - 24 * 60 * 60 * 1000);
  const to = new Date(Math.max(now.getTime(), ...events.map((e) => e.timeMs)) + 60 * 60 * 1000);
  let tvEvents = [];
  try {
    tvEvents = await fetchTvEvents(from, to, 'US');
  } catch (e) {
    console.log('[TvEconActual] Gagal ambil data TradingView (dilewatin, degradasi aman):', e.message);
    return events;
  }
  for (const e of events) {
    if (e.actual) continue; // udah keisi (jangan overwrite kalau suatu saat ada sumber lain)
    const match = findTvActual(tvEvents, e);
    if (match) e.actual = String(match.actual);
  }
  return events;
}

module.exports = { fetchTvEvents, findTvActual, enrichWithTvActual, _tag };
