// econCalendarLiveMonitor.js -- detektor kalender ekonomi jendela SEMPIT (5 Sep 2026, permintaan
// Olan: "detektor tiap 5 menit.. 5 menit sebelum kasih info siap-siap, 5 menit sesudah simpulkan
// hawkish/dovish + deteksi DXY") + STRATEGI SCALP OTOMATIS (permintaan lanjutan Olan: "izinkan
// long/short otomatis dari hasil data itu.. pakai dompet Nyopet USDC.. leverage 50x tetap lewat
// kalkulator exposure.. exit ~30 menit").
//
// ⚠️ RISIKO -- BACA SEBELUM UBAH APAPUN DI SINI:
// Backtest (backtest/econReactionBacktest.js, 93 event NFP 2019-2026) nunjukkin edge cuma
// bertahan ~30 MENIT abis sinyal -- lebih dari itu KEBALIK jadi rugi (PF<1 di horizon 1h/4h/24h).
// SHORT juga tampil lebih lemah dari LONG di semua horizon (konsisten sama aturan lama "Nyopet
// Buy-Only"). Olan SADAR & SETUJU eksplisit override itu KHUSUS strategi ini (short diizinkan,
// exit dipaksa ~30 menit, gak boleh diperpanjang) -- kalau nanti mau ubah durasi exit atau nyalain
// short buat pattern LAIN, itu keputusan BARU, jangan diam-diam ikut numpang dari sini.
//
// SINYAL TRADING pakai REAKSI HARGA BTC SENDIRI (BUKAN DXY) -- persis metodologi yang di-backtest:
// snapshot BTCUSDC PUBLIK (gak butuh API key) di T-5 menit (heads-up) vs T+10 menit (hasil),
// >-+0.10% dianggap sinyal (threshold SAMA PERSIS kayak backtest). DXY reaction TETAP dipakai
// buat pesan INFORMASI hawkish/dovish (econCalendarLog.js) -- itu JALUR TERPISAH, gak dipakai
// buat keputusan buka posisi.
//
// BEDA dari econCalendarMonitor.js (peringatan dini 48 JAM ke depan, GitHub Actions tiap 6 jam,
// TETAP APA ADANYA) -- ini jendela MENIT, jalan SERING (cron VPS tiap 5 menit).
//
// State dedup+tracking (econ-calendar-live-notified.json) MURNI LOKAL, gak perlu git sync.

const fs = require('fs');
const path = require('path');
const { fetchWeekCalendar, getAllHighImpactUsdEvents } = require('./econCalendar');
const { formatHeadsUp, concludeHawkishDovish } = require('./econCalendarLog');
const { enrichWithTvActual } = require('./tvEconActual');
const { recordReaction } = require('./econReactionResearchLog');
const { fetchDxy } = require('./macroData');
const { analyzeSentiment } = require('./marketSentiment');
const { sendWhatsApp } = require('./fonnte');
const { addEntry } = require('./archive');

const kaela = require('./kaelaProTraderClient');
const { createBinanceClient } = require('./binanceExecutor');
const { createNyopetTrader } = require('./nyopetAutoTrader');
const { NYOPET_ASSETS } = require('./nyopetAssetConfig');
const { buildJournalHook, buildSendWA, MASTER_NOMOR } = require('./multiAccountExecutor');
// (5 Sep 2026, permintaan Olan: "atasi sinyal yang numpukin sinyal lain") -- journal REAL Olan
// BISA disentuh proses INI (siklus 5 menit) DAN nyopetAutoTrader.js (siklus 15 menit, chart-
// pattern/FVG/Fed Dovish Grid) buat event FOMC/NFP yang SAMA -- lock cegah race condition,
// wouldFedGridClaim cegah econ_reaction ngerebut sinyal yang harusnya milik Fed Dovish Grid
// (keputusan Olan: Fed Dovish Grid menang krn edge-nya lebih tebal/robust di backtest).
const { withJournalLock } = require('./nyopetJournalLock');
const { fetchKlines } = require('./backtest/fetchKlines');
const { computeSMA, FINAL_RECIPE } = require('./backtest/fedSignalGridBacktest.js');

const HEADSUP_BEFORE_MIN = 5;
const RESULT_AFTER_MIN = [5, 15];
const STATE_PATH = path.join(__dirname, 'econ-calendar-live-notified.json');
const PRUNE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

// ── Konstanta strategi scalp (SAMA PERSIS metodologi backtest/econReactionBacktest.js) ──────────
const BTC_REACTION_THRESHOLD_PCT = 0.10; // ambang sinyal, SAMA kayak REACTION_THRESHOLD_PCT di backtest
const SCALP_NYAWA_PCT = 2; // SL ~2% dari entry -> leverage 100/2=50x pas kena batas MAX_LEVERAGE (permintaan Olan, "leverage 50 aja")
const SCALP_HOLD_MINUTES = 30; // WAJIB dipaksa tutup ~30 menit -- itu satu-satunya jendela yang kebukti backtest, JANGAN diperpanjang tanpa backtest baru
const BTC_ASSET = NYOPET_ASSETS.btc; // BTCUSDC, margin USDC -- "dompet Nyopet" per permintaan Olan

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch (e) { return {}; }
}
function saveState(s) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

async function safeFetchDxyPrice() {
  try { return (await fetchDxy()).latest.value; } catch (e) {
    console.log('[EconCalendarLive] Gagal ambil DXY (dilewatin, gak fatal):', e.message);
    return null;
  }
}

// Harga BTCUSDC PUBLIK (ticker doang, GAK BUTUH API key) -- dipakai buat SNAPSHOT reaksi, beda
// dari trader.fetchLivePrice yang perlu instance trader lengkap (kredensial Olan) -- gak perlu
// bikin trader cuma buat ambil 1 angka publik.
async function safeFetchBtcPrice() {
  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${BTC_ASSET.symbol}`);
    return parseFloat((await res.json()).price);
  } catch (e) {
    console.log('[EconCalendarLive] Gagal ambil harga BTC (dilewatin, gak fatal):', e.message);
    return null;
  }
}

// 12 Sep 2026, permintaan Olan ("riset liq heatmap/long-short ratio", pola mikir "market maker" --
// lihat feedback-market-maker-mindset) -- snapshot POSISI (funding/OI/long-short) SEBELUM rilis,
// diarsipin bareng hasil rilis (econReactionResearchLog.js) biar bisa dicek belakangan "posisi lagi
// numpuk kemana sebelum event ini". `marketSentiment.js` UDAH ADA (dipakai sniperOrderLog.js) --
// dipakai ULANG di sini, bukan bikin sumber data baru. Gagal fetch = null (degradasi aman, SAMA
// pola tryInOrder di dalamnya sendiri).
async function safeFetchPositioning() {
  try { return await analyzeSentiment(); } catch (e) {
    console.log('[EconCalendarLive] Gagal ambil snapshot positioning (dilewatin, gak fatal):', e.message);
    return null;
  }
}

// Trader Nyopet punya OLAN SENDIRI, akun REAL (5 Sep 2026, permintaan Olan: "pakai dompet nyopet
// berarti usdc") -- strategi eksperimental baru, SENGAJA mulai dari akun Olan doang dulu (pola
// sama kayak fitur baru lain di proyek ini -- Sniper/Nyopet live juga mulai dari Olan duluan
// sebelum ke member lain).
// journalPath DIEKSTRAK jadi fungsi sendiri (5 Sep 2026) -- dipakai withJournalLock di bawah,
// WAJIB persis sama path yang dipakai createNyopetTrader di bawah biar lock-nya nge-kunci FILE
// yang bener (sama file yang dipegang nyopetAutoTrader.js buat akun real Olan).
function olanRealNyopetJournalPath() {
  const STATE_DIR = path.join(__dirname, 'multi-account-state');
  const key = String(MASTER_NOMOR).replace(/\D/g, '') + '-real';
  return path.join(STATE_DIR, `${key}-nyopet.json`);
}

async function getOlanNyopetTrader() {
  const accounts = await kaela.getTradingAccounts('binance');
  const account = accounts.find((a) => String(a.phone).replace(/\D/g, '') === String(MASTER_NOMOR).replace(/\D/g, '') && a.mode === 'real');
  if (!account) throw new Error('Akun Binance REAL Olan gak ketemu -- pasang API key dulu di Setting.');

  const client = createBinanceClient({ apiKey: account.apiKey, apiSecret: account.apiSecret, testnet: false });
  const apiCreds = { apiKey: account.apiKey, apiSecret: account.apiSecret, testnet: false };
  const journalHook = buildJournalHook(account, null);
  const sendWA = buildSendWA(account, null);
  return createNyopetTrader({ client, journalPath: olanRealNyopetJournalPath(), apiCreds, onEvent: journalHook, sendWA, phone: account.phone });
}

// Cek judul event pakai pencocokan teks (data live gak selalu dalam format persis sama kayak
// generator tanggal deterministik di fedEvents.js) -- NFP/FOMC doang, SAMA scope kayak yang
// DI-BACKTEST (backtest/econReactionBacktest.js, 93 event NFP 2019-2026). Dipakai 2 tempat:
// (1) wouldFedGridClaim di bawah, (2) gate scope econ_reaction (6 Sep 2026, riset "persiapan
// kalender bulan ini" nemuin econ_reaction LIVE jalan di SEMUA event high-impact -- PPI/CPI/Retail
// Sales/JOLTS/GDP/PCE -- padahal CUMA NFP yang divalidasi backtest. Keputusan Olan: batasi eksekusi
// TRADING ke NFP+FOMC doang, event lain TETAP dapet pesan info/kesimpulan, cuma gak dieksekusi).
function _isNfpTitle(title) {
  const t = (title || '').toLowerCase();
  return t.includes('non-farm') || t.includes('nonfarm') || t.includes('payroll');
}
function _isFomcTitle(title) {
  const t = (title || '').toLowerCase();
  return t.includes('fomc') || t.includes('fed interest rate') || t.includes('federal funds rate');
}
// TETAP diekspor/dipakai apa adanya di wouldFedGridClaim (strategi BEDA, backtest TERPISAH
// fedSignalGridBacktest.js -- gak kesentuh temuan di bawah, NFP+FOMC dua-duanya TETAP eligible
// buat Fed Dovish Grid).
function _isNfpOrFomcTitle(title) { return _isNfpTitle(title) || _isFomcTitle(title); }
async function wouldFedGridClaim(eventTitle, direction) {
  if (direction !== 'buy') return false; // Fed Dovish Grid LONG-only (short kebukti rugi, dibuang)
  if (!_isNfpOrFomcTitle(eventTitle)) return false;
  try {
    const lookbackMs = (FINAL_RECIPE.trendSmaPeriod + 20) * 15 * 60 * 1000;
    const candles = await fetchKlines('BTCUSDT', '15m', Date.now() - lookbackMs, Date.now());
    if (candles.length < FINAL_RECIPE.trendSmaPeriod + 5) return false;
    const closes = candles.map((c) => c.close);
    const sma = computeSMA(closes, FINAL_RECIPE.trendSmaPeriod);
    const last = candles.length - 1;
    return sma[last] != null && candles[last].close > sma[last];
  } catch (e) {
    console.log('[EconCalendarLive] Gagal cek eligibility Fed Dovish Grid (dianggap TIDAK klaim, econ_reaction lanjut apa adanya):', e.message);
    return false;
  }
}

// Buka scalp -- direction 'buy'/'sell' dari reaksi BTC SENDIRI (bukan DXY, lihat catatan atas
// file). SL pakai nyawaPct TETAP (bukan struktur pola kayak sinyal FVG/flag biasa) -- ini strategi
// beda karakter (news-reaction scalp, bukan chart-pattern), wajar rumus size-nya juga beda,
// TETAP lewat hitungExposure yang sama (dijamin gak akan pernah lewat MAX_LEVERAGE global).
// Dibungkus withJournalLock (5 Sep 2026) -- lihat catatan di kepala file soal race condition
// antara proses ini (siklus 5 menit) vs nyopetAutoTrader.js (siklus 15 menit).
async function tryOpenEconScalp(direction, eventLabel) {
  // (6 Sep 2026, keputusan Olan) -- econ_reaction DIBATASI ke NFP+FOMC doang. Backtest ulang
  // CPI+PPI (backtest/econReactionBacktestCpiPpi.js) DITOLAK: CPI net-of-cost PF cuma 1,17 +
  // gak konsisten per tahun (2019 PF=0,21, 2022 PF=17,75 -- lonjakan ekstrem = noise sample
  // kecil, bukan edge asli), PPI malah PF kotor gabungan 0,96 (udah rugi SEBELUM biaya). Event
  // LAIN (Retail Sales/GDP/PCE/JOLTS) tetap dapet pesan info di main(), CUMA gak sampe sini.
  //
  // ⚠️ UPDATE SORE HARI YANG SAMA -- NFP DICABUT lagi dari eksekusi (FOMC TETAP jalan). Lapisan
  // validasi baru (backtest/backtestValidation.js: Monte Carlo Permutation Test + Deflated Sharpe,
  // diadopsi dari riset repo GitHub) diterapkan ke NFP (backtest/nfpAdvancedValidation.js, n=72
  // event 2019-2026, horizon 30m -- satu-satunya yang dipakai live): permutation test p-value~0,20
  // (BELUM signifikan beda dari nebak arah acak), Deflated Sharpe ~0% kalau diasumsikan ~40 variasi
  // parameter pernah dicoba (PSR tanpa penalti 80,6% -- jadi edge-nya TIPIS, bukan pasti nol, tapi
  // gak cukup kuat buat tahan uji ketat ini). Breakdown per-tahun+split-era yang dulu dipakai nerima
  // NFP TIDAK menguji "ini kebetulan dari nyoba banyak parameter atau enggak" -- 2 alat baru ini
  // nutup celah itu. Keputusan Olan (6 Sep 2026 sore, chat sesi ini): "aku ikut Kaela aja terapkan
  // yang terbaik" -- PAUSE eksekusi NFP (bukan dihapus, tinggal balikin includes('non-farm') dst ke
  // _isNfpTitle kalau nanti mau reaktifin) sampai ada bukti lebih kuat (data live lebih banyak/
  // kriteria diperketat). FOMC BELUM diuji lapisan baru ini -- TETAP jalan apa adanya, JANGAN
  // dimatiin bareng tanpa bukti terpisah buat FOMC sendiri.
  if (_isNfpTitle(eventLabel)) {
    console.log(`[EconCalendarLive] "${eventLabel}" NFP -- eksekusi scalp DIPAUSE 6 Sep 2026 (Permutation Test p~0,20 + Deflated Sharpe~0%, lihat backtest/nfpAdvancedValidation.js) -- info doang, gak dieksekusi sampai ada bukti lebih kuat.`);
    return null;
  }
  if (!_isFomcTitle(eventLabel)) {
    console.log(`[EconCalendarLive] "${eventLabel}" BUKAN NFP/FOMC -- skip eksekusi scalp (dibatasi 6 Sep 2026, CPI/PPI ke-backtest & DITOLAK, event lain belum pernah dites sama sekali).`);
    return null;
  }
  return withJournalLock(olanRealNyopetJournalPath(), async () => {
    try {
      const claimedByFedGrid = await wouldFedGridClaim(eventLabel, direction);
      if (claimedByFedGrid) {
        console.log(`[EconCalendarLive] Event "${eventLabel}" juga memenuhi kriteria Fed Dovish Grid (dovish + tren SMA480 konfirmasi) -- econ_reaction NGALAH, biarin Fed Dovish Grid yang dapet slot BTC (keputusan Olan: edge dia lebih tebal/robust).`);
        return null;
      }
      const trader = await getOlanNyopetTrader();
      const journal = trader.loadJournal();
      if (trader.getFloatingOrder(journal, BTC_ASSET.key)) {
        console.log(`[EconCalendarLive] Skip buka scalp -- udah ada posisi BTC floating (dihindari numpuk).`);
        return null;
      }
      const livePrice = await trader.fetchLivePrice(BTC_ASSET.symbol, BTC_ASSET.exchange);
      const sl = direction === 'buy' ? livePrice * (1 - SCALP_NYAWA_PCT / 100) : livePrice * (1 + SCALP_NYAWA_PCT / 100);
      const reasonNote = `Scalp otomatis abis rilis data ekonomi high-impact (${eventLabel}) -- BTC bereaksi ${direction === 'buy' ? 'naik' : 'turun'} duluan, exit paksa ~${SCALP_HOLD_MINUTES} menit (lihat backtest/econReactionBacktest.js).`;
      const order = await trader.openPosition(BTC_ASSET, { direction, sl, patternType: 'econ_reaction', manualReason: reasonNote }, livePrice);
      return order;
    } catch (e) {
      console.log('[EconCalendarLive] GAGAL buka scalp econ_reaction:', e.message);
      return null;
    }
  });
}

async function tryForceCloseEconScalp(eventLabel) {
  return withJournalLock(olanRealNyopetJournalPath(), async () => {
    try {
      const trader = await getOlanNyopetTrader();
      const r = await trader.forceClosePosition(BTC_ASSET.key, 'Kaela (auto econ-reaction scalp)', `Exit paksa ~${SCALP_HOLD_MINUTES} menit abis entry (${eventLabel}) -- jendela profit historisnya cuma sebentar ini, lihat backtest.`);
      if (!r.ok) console.log('[EconCalendarLive] Tutup scalp:', r.error);
      return r.ok;
    } catch (e) {
      console.log('[EconCalendarLive] GAGAL tutup scalp econ_reaction:', e.message);
      return false;
    }
  });
}

async function main() {
  const now = new Date();
  const state = loadState();

  for (const key of Object.keys(state)) {
    const eventTimeMs = new Date(key.split('__')[0]).getTime();
    if (now.getTime() - eventTimeMs > PRUNE_AFTER_MS) delete state[key];
  }

  const allEvents = await fetchWeekCalendar();
  const events = getAllHighImpactUsdEvents(allEvents);
  // 12 Sep 2026 -- isi `actual` dari TradingView (ForexFactory struktural gak pernah ngisinya,
  // lihat tvEconActual.js). Gagal fetch = degradasi aman, actual tetap kosong kayak sebelumnya.
  await enrichWithTvActual(events, now);

  let didSomething = false;

  for (const e of events) {
    const st = state[e.key] || {};
    const minsUntil = (e.timeMs - now.getTime()) / 60000;
    const minsAgo = -minsUntil;

    // ── 1) HEADS-UP -- event 0..5 menit LAGI -- snapshot DXY (info) + BTC (buat sinyal trading) ──
    if (!st.headsup && minsUntil > 0 && minsUntil <= HEADSUP_BEFORE_MIN) {
      const [dxyBefore, btcBefore, positioningBefore] = await Promise.all([safeFetchDxyPrice(), safeFetchBtcPrice(), safeFetchPositioning()]);
      const msg = formatHeadsUp(e);
      console.log(msg);
      addEntry('econ-calendar-headsup', msg, now);
      await sendWhatsApp(msg);
      state[e.key] = { ...st, headsup: true, dxyBefore, btcBefore, positioningBefore };
      didSomething = true;
      continue;
    }

    // ── 2) HASIL -- event 5..15 menit LALU -- EKSEKUSI scalp (reaksi BTC) ──
    // ⛔ PESAN KESIMPULAN HAWKISH/DOVISH/NETRAL DIHAPUS TOTAL (19 Sep 2026, INSIDEN NYATA) --
    // Olan ambil keputusan trading MANUAL di platform lain (BC.Game) berdasar pesan "hasil" ini
    // yang bilang FOMC "NETRAL", padahal The Fed BENERAN naikkan suku bunga 25bps -- duitnya
    // abis. Root cause: `concludeHawkishDovish()` (econCalendarLog.js) label "NETRAL" artinya
    // "actual PERSIS SAMA forecast" (gak ada KEJUTAN), BUKAN "gak ada perubahan" -- pembaca
    // awam (termasuk Olan sendiri) wajar baca "NETRAL" sebagai "gak kejadian apa-apa". Ditambah
    // lagi data "actual" dari feed gratis (ForexFactory) SERING telat/kosong pas jendela reaksi
    // sempit ini (lihat histori bug 12 Sep di econCalendarLog.js) -- gabungan "data gak reliable
    // + label yang gampang disalahartikan" ini TERLALU BERBAHAYA buat terus ditampilin sbg info
    // yang keliatan otoritatif. Keputusan Olan: "kalo emang ga bisa kasih data live.. delete
    // aja! cuma kasih info siap siap" -- pesan HEADS-UP (poin 1 di atas, gak ada klaim
    // arah/kesimpulan apapun) TETAP ada, tapi pesan "HASIL" + "HASIL SUSULAN" (yang bikin klaim
    // HAWKISH/DOVISH/NETRAL) DIHAPUS TOTAL, gak diganti versi lain.
    //
    // Sinyal TRADING OTOMATIS Kaela sendiri (scalp econ_reaction di bawah) TIDAK KEPENGARUH --
    // itu dari REAKSI HARGA BTC BENERAN (bukan label hawkish/dovish/netral ini sama sekali,
    // selalu 2 jalur terpisah sejak awal), TETAP jalan apa adanya.
    if (!st.result && minsAgo >= RESULT_AFTER_MIN[0] && minsAgo <= RESULT_AFTER_MIN[1]) {
      const [dxyAfter, btcAfter] = await Promise.all([safeFetchDxyPrice(), safeFetchBtcPrice()]);
      const dxyChangePct = (st.dxyBefore != null && dxyAfter != null) ? ((dxyAfter - st.dxyBefore) / st.dxyBefore) * 100 : null;

      // Sinyal trading -- REAKSI BTC SENDIRI, SAMA PERSIS metodologi backtest.
      let scalpOrder = null;
      if (st.btcBefore != null && btcAfter != null) {
        const btcReactionPct = ((btcAfter - st.btcBefore) / st.btcBefore) * 100;
        if (Math.abs(btcReactionPct) >= BTC_REACTION_THRESHOLD_PCT) {
          const direction = btcReactionPct > 0 ? 'buy' : 'sell';
          console.log(`[EconCalendarLive] BTC bereaksi ${btcReactionPct.toFixed(3)}% -- buka scalp ${direction.toUpperCase()} (${e.title}).`);
          scalpOrder = await tryOpenEconScalp(direction, e.title);
        } else {
          console.log(`[EconCalendarLive] BTC reaksi ${btcReactionPct.toFixed(3)}% -- di bawah ambang ${BTC_REACTION_THRESHOLD_PCT}%, skip scalp.`);
        }
      }

      // 12 Sep 2026, permintaan Olan ("simpan sendiri hasil kalender ekonomi buat kelak
      // penelitian", riset pola manipulasi market/short squeeze) -- arsip MURNI RISET, gak
      // pernah dikirim ke WA, gak pengaruhi eksekusi apapun (lihat econReactionResearchLog.js).
      // `concludeHawkishDovish()` TETAP dipakai DI SINI DOANG (klasifikasi buat catatan riset
      // internal) -- beda dari pesan WA yang udah dihapus di atas.
      try {
        const rec = recordReaction({ event: e, conclusionLabel: concludeHawkishDovish(e, dxyChangePct).label, dxyChangePct, btcBefore: st.btcBefore, btcAfter, positioningBefore: st.positioningBefore });
        if (rec.divergence) console.log(`[EconCalendarLive] 🔀 DIVERGENSI dicatat -- "${e.title}" kesimpulan ${rec.conclusionLabel} tapi BTC reaksi ${rec.btcReactionPct}% (kebalikan ekspektasi) -- kandidat riset manipulasi/squeeze.`);
      } catch (err) {
        console.log('[EconCalendarLive] Gagal catat riset reaksi (dilewatin, gak fatal):', err.message);
      }

      state[e.key] = { ...st, result: true, scalpOpenedAt: scalpOrder ? Date.now() : null };
      didSomething = true;
    }

    // ── 3) TUTUP PAKSA -- scalp yang dibuka dari event ini udah ~30 menit ──
    if (st.scalpOpenedAt && !st.scalpClosed && (Date.now() - st.scalpOpenedAt) >= SCALP_HOLD_MINUTES * 60 * 1000) {
      console.log(`[EconCalendarLive] Tutup paksa scalp (${e.title}) -- udah ${SCALP_HOLD_MINUTES} menit.`);
      const closed = await tryForceCloseEconScalp(e.title);
      if (closed) { state[e.key] = { ...st, scalpClosed: true }; didSomething = true; }
    }
  }

  if (!didSomething) console.log(`[EconCalendarLive] ${now.toISOString()} -- gak ada event dalam jendela heads-up/hasil sekarang, skip.`);
  saveState(state);
}

main().catch((e) => {
  console.error('ERROR econCalendarLiveMonitor.js:', e.message);
  process.exit(1);
});
