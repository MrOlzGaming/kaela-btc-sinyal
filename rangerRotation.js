// rangerRotation.js -- RANGER ROTASI 8 KOIN. v1 (3 Okt 2026, demo BingX) -> v2 (3 Okt 2026): pindah ke BYBIT, leg DEMO +
// REAL, alt LONG doang (short cuma BTC).
//
// Kenapa ada: Ranger BTC sering NGANGGUR nunggu sinyal. Rotasi = 1 posisi modal penuh (BUKAN dibagi2) yang pindah ke koin
// yang lagi ada sinyal Ranger 4H. Riset: BACKTEST-REGISTRY.md "Ranger 4H MULTI-KOIN" + "Upgrade Ranger" +
// rangerMultiCoinPortfolio.js (koin dipilih pakai <2023, dinilai >=2023: 8 koin ~42%/thn vs BTC doang ~19%, DD sama).
//
// Arahan Olan (3 Okt 2026) yang ditanam di sini:
//   - "usahakan trading otomatis nanti ga saling tumpang tindih.. biar ga overtrade.. makanya aku sediakan 7 exchange" ->
//     rotasi punya EXCHANGE SENDIRI (Bybit), gak numpang akun Ninja (BingX) / Sniper+Ranger BTC (Binance) / Emas (MEXC).
//   - "utamakan cari peluang long.. untuk short cuma BTC aja boleh otomatis" -> `shortCoins` (default ['BTC']): koin lain
//     LONG doang. Cek backtest (8 koin, >=2023): aturan ini $100->$1.837 DD 17,9% vs dua arah $1.486 DD 27% (lebih bagus).
//   - "siapkan yang real" -> leg REAL (Bybit real) jalan BARENG demo kalau `allowReal` & saldo cukup; kebijakan WA SAMA
//     sistem lain: demo SELALU ke Sniper Club, Wibowo dapet REAL kalau real kebuka, kalau nggak dapet DEMO (wibowoRoute
//     dikunci pas entry).
//
// Koin (urutan = PRIORITAS): BTC SOL DOGE TRX INJ ETH XLM BNB (PF minimum 2 era tertinggi; FIL dibuang krn gagal >=2023).
// Logika = Ranger live PERSIS: detectPatternSignal(PATTERN_PARAMS_4H) + detectFvgSignal(SMA1200-4H) di candle 4H closed (data
// publik Binance spot); window halving BTC buat semua koin; sizing hitungExposure(saldo leg x 1/5) per leg; exit polling tiap
// 15 mnt: SL / 2R tutup 50% + SL ke entry / trailing SMA60-4H / tutup paksa pas window ganti. Tanpa DXY (sesuai backtest).
// Exchange Bybit DIVERIFIKASI empiris 3 Okt 2026 (demo DOGEUSDT buka-tutup beneran): one-way mode (positionIdx 0), demo
// GAK dukung isolated ("Demo trading are not supported" -> jalan cross, aman krn akun demo khusus rotasi).

const fs = require('fs');
const path = require('path');
const { sma } = require('./technicalAnalysis');
const { detectPatternSignal } = require('./chartPatterns');
const { detectFvgSignal } = require('./fvgDetector');
const { hitung: hitungExposure } = require('./calculator');
const { isBtcBearWindow } = require('./halvingBearWindow');
const { nextSignalId, dayKeyOf } = require('./signalIdGenerator');
// Diambil LANGSUNG dari Ranger live (bukan salinan) biar gak pernah beda kalau Ranger diubah. main() file itu ter-guard.
const { PATTERN_PARAMS_4H, FVG_TREND_SMA_LEN_4H } = require('./rangerAutoTrader');

const CONFIG_PATH = path.join(__dirname, 'ranger-rotation-config.json');
const JOURNAL_PATH = path.join(__dirname, 'ranger-rotation-journal.json');
const DEFAULT_COINS = ['BTC', 'SOL', 'DOGE', 'TRX', 'INJ', 'ETH', 'XLM', 'BNB'];
const TRAIL_SMA_LEN_4H = 60;
const PARTIAL_RR = 2;
const MODAL_ACTIVE_FRACTION = 1 / 5;
const CANDLES_NEEDED_4H = 1560 + 260;
const SYSTEM = { emoji: '🏹', name: 'RANGER ROTASI' };
const MASTER_NOMOR = '6281299303888';
const MODES = ['demo', 'real'];

function loadConfig() {
  const def = { enabled: false, coins: DEFAULT_COINS, dxyFilter: false, exchange: 'bybit', allowReal: true, shortCoins: ['BTC'], partialFrac: 1 / 3, trailRByCoin: { BTC: 3 } };
  try { return { ...def, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; } catch { return def; }
}
const freshStats = () => ({ wins: 0, losses: 0, totalPnlUsd: 0 });
function freshJournal() { return { floating: null, lastScanCloseTime: null, closedCount: 0, stats: { demo: freshStats(), real: freshStats() }, dailySignalSeq: { dayKey: null, count: 0 }, history: [] }; }
function loadJournal() {
  try {
    const j = JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8'));
    const out = { ...freshJournal(), ...j };
    const legacy = j.stats && j.stats.wins !== undefined ? j.stats : null; // v1 = stats rata (demo doang)
    out.stats = { demo: { ...freshStats(), ...(legacy || (j.stats && j.stats.demo) || {}) }, real: { ...freshStats(), ...((j.stats && j.stats.real) || {}) } };
    if (out.floating && !out.floating.legs) out.floating = null; // posisi v1 (BingX) gak dilanjutin di v2 -- v1 belum pernah buka posisi
    return out;
  } catch { return freshJournal(); }
}
function saveJournal(j) { fs.writeFileSync(JOURNAL_PATH, JSON.stringify(j, null, 2)); }

const sideOf = (dir) => (dir === 'buy' ? 'LONG' : 'SHORT');

// Sinyal Ranger 1 koin di candle closed terakhir -> {direction, sl, patternType} | null.
// `shortAllowed` = koin ini boleh short (Olan: cuma BTC) -- kalau false, window bear = gak ada entry sama sekali buat koin itu.
function rangerSignal(candles4h, bearNow, shortAllowed = true) {
  const i = candles4h.length - 1;
  const canShort = bearNow && shortAllowed;
  const params = canShort ? { ...PATTERN_PARAMS_4H, allowShort: true } : PATTERN_PARAMS_4H;
  const cands = [];
  const p = detectPatternSignal(candles4h, i, params); if (p) cands.push(p);
  const f = detectFvgSignal(candles4h, i, { slBufferPct: PATTERN_PARAMS_4H.slBufferPct, trendSmaLen: FVG_TREND_SMA_LEN_4H, allowShort: canShort }); if (f) cands.push(f);
  return cands.find((s) => (s.direction === 'buy' && !bearNow) || (s.direction === 'sell' && canShort)) || null;
}

// deps: { cfg, journal, legs:{demo:{exec,balance(),price(coin)}, real:{...}|null}, symbolOf(coin), fetchCandles(coin,n),
//         notify:{sniperClub(msg), wibowo(msg)}, isBear(date), dxyWeak(), isCoinBusy(coin)?, signalFn?, fmt, kaelaJournal?, now, log }
function createRotation(deps) {
  const { cfg, journal: j } = deps;
  const now = deps.now || (() => Date.now());
  const log = deps.log || ((m) => console.log(`[RangerRotasi] ${m}`));
  const coins = cfg.coins || DEFAULT_COINS;
  const shortCoins = cfg.shortCoins || ['BTC'];
  const signalFn = deps.signalFn || rangerSignal;
  const sym = (coin) => deps.symbolOf(coin);

  async function roundQty(exec, coin, qty) {
    const info = await exec.getSymbolInfo(sym(coin));
    return exec.roundToStepSize(qty, info.stepSize, info.quantityPrecision);
  }
  // jumlah MILIK leg ini yang masih kebuka -- gak pernah nutup lebih dari ini
  const ownQty = (L, pos) => Math.min(L.remainingQty != null ? L.remainingQty : L.qty, Math.abs(Number(pos.positionAmt)));

  // Routing WA (SAMA rangerBtcDualExec.js): leg demo -> Sniper Club; Wibowo dapet leg yang cocok wibowoRoute.
  async function announce(f, mode, msg) {
    if (mode === 'demo') await deps.notify.sniperClub(msg);
    if ((mode === 'real') === (f.wibowoRoute === 'real')) await deps.notify.wibowo(msg);
  }

  async function closeLeg(f, mode, reason, exitPrice, closedQty, untracked) {
    const L = f.legs[mode];
    const legPnl = untracked || !exitPrice ? null : (f.direction === 'buy' ? exitPrice - L.entryPrice : L.entryPrice - exitPrice) * closedQty;
    const total = legPnl === null ? null : (L.realizedPnlUsd || 0) + legPnl;
    Object.assign(L, { closedAt: new Date(now()).toISOString(), exitPrice: exitPrice || null, pnlUsd: total, reason });
    if (total !== null) { const s = j.stats[mode]; if (total >= 0) s.wins += 1; else s.losses += 1; s.totalPnlUsd += total; }
    if (mode === 'real' && deps.kaelaJournal) deps.kaelaJournal.update(`${f.id}-real`, { status: 'closed', closedAt: L.closedAt, pnlUsd: total === null ? 0 : total });
    await announce(f, mode, untracked ? deps.fmt.untracked(f, mode) : deps.fmt.closed(f, mode, reason, j.stats[mode]));
    log(`TUTUP ${mode} ${f.coin} ${f.direction} (${reason}) pnl ${total === null ? '?' : total.toFixed(2)}`);
  }

  async function marketClose(exec, f, qty) {
    const r = await exec.emergencyCloseMarket({ symbol: sym(f.coin), direction: f.direction, quantity: qty });
    const o = r && r.order ? r.order : r;
    return (o && Number(o.avgPrice)) || null;
  }

  async function monitor() {
    const f = j.floating;
    if (!f) return;
    const isLong = f.direction === 'buy';
    const bearNow = deps.isBear(new Date(now()));
    const wrongSide = (isLong && bearNow) || (!isLong && !bearNow);
    let trail; // dihitung lazy sekali per siklus
    for (const mode of MODES) {
      const L = f.legs[mode];
      if (!L || L.closedAt) continue;
      const venue = deps.legs[mode];
      if (!venue) continue;
      const exec = venue.exec;
      const pos = await exec.getPositionBySide(sym(f.coin), sideOf(f.direction)).catch(() => undefined);
      if (pos === undefined) { log(`${mode}: gagal cek posisi ${sym(f.coin)} -- coba siklus depan`); continue; }
      const live = await venue.price(f.coin).catch(() => null);
      if (pos === null || !(Math.abs(Number(pos.positionAmt)) > 0)) {
        // Posisi udah gak ada. Kalau SL native pernah kepasang & harga udah lewat level stop -> ini SL exchange yg kepicu
        // (bukan misteri) -> catat SL di harga stop. Selain itu -> jujur "hilang", PnL gak dihitung.
        const stopHit = L.nativeSl && live && (isLong ? live <= L.sl * 1.003 : live >= L.sl * 0.997);
        const inProfit = isLong ? L.sl > L.entryPrice : L.sl < L.entryPrice;
        if (stopHit) await closeLeg(f, mode, inProfit ? 'TRAIL' : (L.partialDone ? 'SL_BREAKEVEN' : 'SL'), L.sl, L.remainingQty != null ? L.remainingQty : L.qty);
        else await closeLeg(f, mode, 'OFFLINE_UNTRACKED', null, 0, true);
        continue;
      }
      if (!live) { log(`${mode}: harga ${f.coin} gagal -- coba siklus depan`); continue; }
      const closeAll = async (reason) => { const q = ownQty(L, pos); const px = (await marketClose(exec, f, q)) || live; await closeLeg(f, mode, reason, px, q); };
      if (wrongSide) { await closeAll('WINDOW_FLIP'); continue; }
      // ===== TRAILING ATURAN OLAN (3 Okt 2026) -- koin di cfg.trailRByCoin (default BTC: 3) =====
      // SL = harga terbaik - trailR x JARAK INVALIDASI AWAL, cuma naik, TANPA partial, tanpa batas atas profit. Riset
      // rangerExitResearch.js TRAIL_STUDY: BTC 4H trail 3x PF 3,15/2,87 vs partial-SMA 2,72/2,04 (2 era). Alt/emas tetap
      // partial+SMA (trail ketat bikin kegocek, kalah di 2 era).
      const trailR = (cfg.trailRByCoin || {})[f.coin];
      if (trailR) {
        if (isLong ? live <= L.sl : live >= L.sl) { await closeAll((isLong ? L.sl > L.entryPrice : L.sl < L.entryPrice) ? 'TRAIL_STOP' : 'SL'); continue; }
        const risk = L.risk || Math.abs(L.entryPrice - f.sl);
        L.peak = isLong ? Math.max(L.peak != null ? L.peak : L.entryPrice, live) : Math.min(L.peak != null ? L.peak : L.entryPrice, live);
        const cand = isLong ? L.peak - trailR * risk : L.peak + trailR * risk;
        // geser cuma kalau naik >= 0,1% (hemat panggilan API, SL native gak di-spam tiap siklus)
        if (isLong ? cand > L.sl * 1.001 : cand < L.sl * 0.999) {
          L.sl = cand;
          if (L.nativeSl && exec.setPositionStopLoss) await exec.setPositionStopLoss(sym(f.coin), cand).catch((e) => log(`${mode}: geser SL trailing ${f.coin} GAGAL: ${e.message}`));
        }
        continue;
      }
      if (!L.partialDone) {
        if (isLong ? live <= f.sl : live >= f.sl) { await closeAll('SL'); continue; }
        if (isLong ? live >= f.partialTp : live <= f.partialTp) {
          const ownBefore = ownQty(L, pos);
          // (3 Okt 2026) porsi partial dari config (default 1/3) -- riset backtest/rangerExitResearch.js: 33% @2R lebih
          // bagus dari 50% di BTC & 8 koin, DUA era (sisa 2/3 di-trail SMA60 = "biarin yang menang lari").
          const half = await roundQty(exec, f.coin, ownBefore * (cfg.partialFrac != null ? cfg.partialFrac : 1 / 3));
          if (half <= 0) {
            log(`${mode}: qty partial kekecilan buat step -- partial dilewati, SL ke entry`);
            L.partialDone = true; L.sl = L.entryPrice;
            if (L.nativeSl && exec.setPositionStopLoss) await exec.setPositionStopLoss(sym(f.coin), L.entryPrice).catch((e) => log(`${mode}: geser SL native ke breakeven ${f.coin} GAGAL: ${e.message}`));
            continue;
          }
          const px = (await marketClose(exec, f, half)) || live;
          L.realizedPnlUsd = (isLong ? px - L.entryPrice : L.entryPrice - px) * half;
          L.remainingQty = await roundQty(exec, f.coin, ownBefore - half);
          L.partialDone = true; L.sl = L.entryPrice; L.partialAt = new Date(now()).toISOString();
          if (L.nativeSl && exec.setPositionStopLoss) {
            await exec.setPositionStopLoss(sym(f.coin), L.entryPrice).catch((e) => log(`${mode}: geser SL native ke breakeven ${f.coin} GAGAL: ${e.message}`));
          }
          await announce(f, mode, deps.fmt.partial(f, mode));
          log(`PARTIAL ${mode} ${f.coin} @ ${px} realized ${L.realizedPnlUsd.toFixed(2)}`);
        }
        continue;
      }
      if (isLong ? live <= L.sl : live >= L.sl) { await closeAll('SL_BREAKEVEN'); continue; }
      // (5 Okt 2026, audit paritas) trailing SMA60 dinilai di CLOSE candle 4H terakhir yang udah tutup (SAMA backtest), BUKAN
      // harga live -- versi harga-live lebih jelek di dua era (backtest/smaTrailTriggerParity.js, alt PF 2,07/1,61 -> 2,00/1,57).
      if (trail === undefined) { const c = await deps.fetchCandles(f.coin, TRAIL_SMA_LEN_4H + 5).catch(() => []); trail = { sma: sma(c.map((x) => x.close), TRAIL_SMA_LEN_4H), lastClose: c.length ? c[c.length - 1].close : null }; }
      if (trail.sma !== null && trail.lastClose !== null && (isLong ? trail.lastClose < trail.sma : trail.lastClose > trail.sma)) await closeAll('TRAIL');
    }
    if (MODES.every((m) => !f.legs[m] || f.legs[m].closedAt)) {
      j.closedCount += 1;
      j.history.unshift({ id: f.id, signalId: f.signalId, coin: f.coin, direction: f.direction, patternType: f.patternType, openedAt: f.openedAt, wibowoRoute: f.wibowoRoute, legs: f.legs });
      j.history = j.history.slice(0, 100);
      j.floating = null;
    }
  }

  async function openLeg(mode, coin, sig, live) {
    const venue = deps.legs[mode];
    const exec = venue.exec;
    const s = sym(coin);
    const any = await exec.getPositionRisk(s).catch(() => undefined);
    if (any === undefined) throw new Error(`${mode}: gagal cek posisi ${s}`);
    if (any && Math.abs(Number(any.positionAmt)) > 0) throw new Error(`${mode}: ${s} udah ada posisi lain (bukan rotasi) -- gak numpuk`);
    const balance = await venue.balance().catch(() => 0);
    // Kalkulator exposure resmi (calculator.js hitung). Olan 3 Okt 2026: "size alt [diperlakukan seperti short], jadi yang
    // buka full cuma BTC long" -> alt & short BTC = exposure /2 (direction 'sell' = jalur separuh yg UDAH ada di hitung()).
    // Backtest (rangerExitResearch.js, rotasi 8 koin, exit 33%@2R): 2019-22 DD 81% -> 55% (CAGR 90 -> 84%), 2023-26 DD 41 -> 37%.
    const halfSize = sig.direction === 'sell' || coin !== 'BTC';
    const calc = hitungExposure({ modal: (balance || 0) * MODAL_ACTIVE_FRACTION, entry: live, stopLoss: sig.sl, direction: halfSize ? 'sell' : 'buy' });
    if (!(calc.nilaiPosisi > 0)) { const e = new Error(`${mode}: saldo kurang (${(balance || 0).toFixed(2)})`); e.insufficient = true; throw e; }
    await exec.setIsolatedMargin(s, calc.leverage).catch(() => {});
    await exec.setLeverage(s, calc.leverage, sideOf(sig.direction)).catch(() => {});
    const order = await exec.placeMarketEntry({ symbol: s, direction: sig.direction, notionalUsd: calc.nilaiPosisi, livePrice: live });
    const qty = Number(order.executedQty);
    // SL NATIVE dijamin exchange (3 Okt 2026) -- akun Bybit cross margin (SL-via-likuidasi isolated gak berlaku), jadi stop
    // dipasang di level posisi. Gagal -> tetap jalan (polling SL 15 mnt masih aktif) tapi DILAPOR (kata GAGAL -> mandor).
    let nativeSl = false;
    if (exec.setPositionStopLoss) {
      try { await exec.setPositionStopLoss(s, sig.sl); nativeSl = true; }
      catch (e) { log(`${mode}: SL native ${s} GAGAL dipasang (cuma andelin polling): ${e.message}`); }
    }
    return { entryPrice: Number(order.avgPrice) || live, qty, remainingQty: qty, sl: sig.sl, risk: Math.abs((Number(order.avgPrice) || live) - sig.sl), peak: Number(order.avgPrice) || live, leverage: calc.leverage, margin: calc.margin, nilaiPosisi: calc.nilaiPosisi, partialDone: false, realizedPnlUsd: 0, nativeSl };
  }

  async function open(coin, sig) {
    if (deps.isCoinBusy && (await deps.isCoinBusy(coin))) { log(`${coin} lagi dipakai modul lain -- lewati`); return false; }
    const live = await deps.legs.demo.price(coin).catch(() => null);
    if (!live) return false;
    if (sig.direction === 'buy' ? sig.sl >= live : sig.sl <= live) { log(`${coin} SL udah kelewat harga live -- lewati`); return false; }
    let demo;
    try { demo = await openLeg('demo', coin, sig, live); }
    catch (e) { log(`${coin} demo gak kebuka: ${e.message} -- lewati koin ini`); return false; }
    let real = null;
    if (cfg.allowReal && deps.legs.real) {
      try { real = await openLeg('real', coin, sig, live); }
      catch (e) { log(e.insufficient ? `${coin} real skip -- ${e.message}` : `${coin} real gagal (BUKAN saldo kurang, perlu dicek): ${e.message}`); }
    }
    const d = new Date(now());
    if (!j.dailySignalSeq || j.dailySignalSeq.dayKey !== dayKeyOf(d)) j.dailySignalSeq = { dayKey: dayKeyOf(d), count: 0 };
    const signalId = nextSignalId(j.dailySignalSeq.count, d); j.dailySignalSeq.count += 1;
    const r = Math.abs(demo.entryPrice - sig.sl);
    const f = {
      id: `ranger-rotasi-${now()}`, signalId, coin, direction: sig.direction, patternType: sig.patternType, sl: sig.sl,
      // koin trailing (cfg.trailRByCoin) gak punya TP tetap -> null (pesan WA nampilin 'TP: trailing')
      partialTp: (cfg.trailRByCoin || {})[coin] ? null : (sig.direction === 'buy' ? demo.entryPrice + r * PARTIAL_RR : demo.entryPrice - r * PARTIAL_RR),
      openedAt: d.toISOString(), wibowoRoute: real ? 'real' : 'demo', exchange: cfg.exchange, legs: { demo, real },
    };
    j.floating = f;
    if (real && deps.kaelaJournal) deps.kaelaJournal.record('real', { entryId: `${f.id}-real`, strategy: 'ranger-rotasi', asset: coin.toLowerCase(), direction: f.direction, entryPrice: real.entryPrice, sl: f.sl, tp: f.partialTp, leverage: real.leverage, marginUsd: real.margin, status: 'open', openedAt: f.openedAt, note: `ranger-rotasi ${f.patternType}`, exchange: cfg.exchange });
    await announce(f, 'demo', deps.fmt.open(f, 'demo'));
    if (real) await announce(f, 'real', deps.fmt.open(f, 'real'));
    log(`BUKA ${coin} ${sig.direction} demo @ ${demo.entryPrice}${real ? ` + REAL @ ${real.entryPrice}` : ' (real skip)'} SL ${sig.sl} TP1 ${f.partialTp}`);
    return true;
  }

  async function scan() {
    if (j.floating) return;
    const first = await deps.fetchCandles(coins[0], CANDLES_NEEDED_4H);
    if (!first.length) { log('candle kosong -- skip'); return; }
    const clock = first[first.length - 1].closeTime;
    if (j.lastScanCloseTime !== null && clock <= j.lastScanCloseTime) return;
    j.lastScanCloseTime = clock;
    if (now() - clock > 60 * 60e3) { log('candle 4H terakhir udah > 1 jam lalu -- gak entry di harga basi, tunggu candle berikutnya'); return; }
    if (cfg.dxyFilter && (await deps.dxyWeak().catch(() => null)) === false) { log('DXY kuat -- skip semua entry siklus ini'); return; }
    const bearNow = deps.isBear(new Date(now()));
    for (const coin of coins) {
      const c = coin === coins[0] ? first : await deps.fetchCandles(coin, CANDLES_NEEDED_4H).catch(() => []);
      if (c.length < 300) continue;
      const sig = signalFn(c, bearNow, shortCoins.includes(coin), coin);
      if (!sig) continue;
      if (sig.direction === 'sell' && !shortCoins.includes(coin)) continue; // pengaman ganda aturan Olan
      log(`sinyal ${coin} ${sig.patternType} ${sig.direction}`);
      if (await open(coin, sig)) return;
    }
    log(`gak ada sinyal yang bisa dibuka di ${coins.length} koin candle ini`);
  }

  async function runCycle() { await monitor(); if (!j.floating) await scan(); }
  return { runCycle, monitor, scan };
}

// ================= wiring produksi =================
async function fetchCandles4h(coin, count) {
  const { fetchWithRetry } = require('./httpRetry');
  let all = [], endTime = Date.now();
  while (all.length < count) {
    const raw = await (await fetchWithRetry(`https://data-api.binance.vision/api/v3/klines?symbol=${coin}USDT&interval=4h&endTime=${endTime}&limit=1000`)).json();
    if (!Array.isArray(raw) || !raw.length) break;
    const parsed = raw.map((c) => ({ openTime: c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], closeTime: c[6] }));
    all = parsed.concat(all); endTime = parsed[0].openTime - 1;
    if (raw.length < 1000) break;
  }
  const t = Date.now();
  return all.filter((c) => c.closeTime <= t).slice(-count);
}

// Profil exchange -- tiap profil nyiapin leg demo/real dgn kontrak exec yang SAMA (getPositionRisk/getPositionBySide/
// getSymbolInfo/roundToStepSize/setIsolatedMargin/setLeverage/placeMarketEntry/emergencyCloseMarket).
function buildVenues(exchange, secrets) {
  if (exchange === 'bybit') {
    const { createBybitClient } = require('./bybitExecutor');
    const price = (base) => async (coin) => {
      const d = await (await fetch(`${base}/v5/market/tickers?category=linear&symbol=${coin}USDT`)).json();
      const p = Number(d && d.result && d.result.list && d.result.list[0] && d.result.list[0].lastPrice);
      if (!p) throw new Error(`harga ${coin} kosong`); return p;
    };
    const leg = (key, secret, testnet, base) => {
      if (!key || !secret) return null;
      const exec = createBybitClient({ apiKey: key, apiSecret: secret, testnet });
      return { exec, balance: () => exec.getAccountBalance(), price: price(base) };
    };
    return {
      symbolOf: (coin) => `${coin}USDT`, badge: require('./darkKaelaLog').EXCHANGE_BADGE.bybit,
      legs: { demo: leg(secrets.BYBIT_API_KEY_DEMO, secrets.BYBIT_API_SECRET_DEMO, true, 'https://api-demo.bybit.com'), real: leg(secrets.BYBIT_API_KEY, secrets.BYBIT_API_SECRET, false, 'https://api.bybit.com') },
    };
  }
  if (exchange === 'bingx') {
    const { createBingxClient } = require('./bingxExecutor');
    const leg = (testnet) => {
      if (!secrets.BINGX_API_KEY || !secrets.BINGX_API_SECRET) return null;
      const exec = createBingxClient({ apiKey: secrets.BINGX_API_KEY, apiSecret: secrets.BINGX_API_SECRET, testnet });
      const base = testnet ? 'https://open-api-vst.bingx.com' : 'https://open-api.bingx.com';
      return {
        exec, balance: () => exec.getAccountBalance(testnet ? 'VST' : 'USDT'),
        price: async (coin) => { const d = await (await fetch(`${base}/openApi/swap/v2/quote/price?symbol=${coin}-USDT`)).json(); const p = Number(d && d.data && d.data.price); if (!p) throw new Error(`harga ${coin} kosong`); return p; },
      };
    };
    return { symbolOf: (coin) => `${coin}-USDT`, badge: '🟣 BingX', legs: { demo: leg(true), real: leg(false) } };
  }
  throw new Error(`exchange '${exchange}' belum didukung rotasi`);
}

function messageFormatters(badge) {
  const { formatAutoOpen, formatAutoPartial, formatAutoClosed, formatWinRateLines, CLOSE_REASON_LABEL, KAELA_ACCESS_URL } = require('./darkKaelaLog');
  const label = (f) => `${f.coin}USDT`;
  const isDemo = (mode) => mode !== 'real';
  return {
    open: (f, mode) => { const L = f.legs[mode]; return formatAutoOpen({ id: f.id, signalId: f.signalId, direction: f.direction, entryPrice: L.entryPrice, sl: f.sl, tp: f.partialTp, marginUsd: L.margin, leverage: L.leverage, nilaiPosisi: L.nilaiPosisi, patternType: f.patternType, mode: f.patternType, assetLabel: label(f) }, new Date(), '', isDemo(mode), null, '', null, badge, SYSTEM); },
    partial: (f, mode) => { const L = f.legs[mode]; return formatAutoPartial({ id: f.id, signalId: f.signalId, realizedPnlUsd: L.realizedPnlUsd, entryPrice: L.entryPrice, assetLabel: label(f), patternType: f.patternType, mode: f.patternType, trailSmaLen: TRAIL_SMA_LEN_4H }, new Date(), isDemo(mode), null, null, badge, SYSTEM); },
    closed: (f, mode, reason, stats) => {
      const L = f.legs[mode];
      const msg = formatAutoClosed({ id: f.id, signalId: f.signalId, direction: f.direction === 'buy' ? 'long' : 'short', mode: f.patternType, entryPrice: L.entryPrice, exitPrice: L.exitPrice, pnlUsd: L.pnlUsd, pnlPct: L.margin && L.pnlUsd !== null ? (L.pnlUsd / L.margin) * 100 : null, assetLabel: label(f) }, new Date(), isDemo(mode), CLOSE_REASON_LABEL[reason] || reason, null, null, badge, SYSTEM);
      return msg.replace(`🔗 ${KAELA_ACCESS_URL}`, formatWinRateLines(stats, `Ranger Rotasi (${isDemo(mode) ? 'Demo' : 'Real'})`, null) + `🔗 ${KAELA_ACCESS_URL}`);
    },
    // Template formatAutoClosedUntracked (darkKaelaLog.js) ngomongin "journal gak pernah nyatet buka" -- GAK cocok (rotasi
    // nyatet bukanya), jadi pesan sendiri: posisi yg DICATAT hilang dari exchange.
    untracked: (f, mode) => [
      `${SYSTEM.emoji} ${SYSTEM.name}`,
      `Kaela ${label(f)} (${isDemo(mode) ? 'Demo' : 'Real'})`,
      badge,
      `#${f.signalId} — *Posisi Hilang dari Exchange*`,
      `⚠️ ${f.direction === 'buy' ? '🟢 LONG' : '🔴 SHORT'} @ $${f.legs[mode].entryPrice} udah gak ada di exchange -- kemungkinan kena likuidasi di sela pengecekan 15 menit, atau ditutup manual.`,
      'PnL SENGAJA gak dihitung biar gak ngarang angka -- cek riwayat exchange buat angka pastinya.',
      '',
      `🔗 ${KAELA_ACCESS_URL}`,
    ].join('\n'),
  };
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.enabled) { console.log('[RangerRotasi] enabled:false -- gak ngapa-ngapain.'); return; }
  const secrets = require('./secrets');
  const venues = buildVenues(cfg.exchange, secrets);
  if (!venues.legs.demo) { console.log(`[RangerRotasi] key demo ${cfg.exchange} kosong -- skip.`); return; }
  const { sendWhatsAppToSniperClub } = require('./fonnte');
  const { sendWhatsAppToWibowo } = require('./wibowoNotify');
  const { toSniperClubLink } = require('./darkKaelaLog');
  const kaela = require('./kaelaProTraderClient');
  const journal = loadJournal();
  const rot = createRotation({
    cfg, journal, legs: venues.legs, symbolOf: venues.symbolOf,
    fetchCandles: fetchCandles4h,
    notify: {
      sniperClub: (m) => sendWhatsAppToSniperClub(toSniperClubLink(m)).catch((e) => console.log('[RangerRotasi] WA Sniper Club gagal:', e.message)),
      wibowo: (m) => sendWhatsAppToWibowo(m).catch((e) => console.log('[RangerRotasi] WA Wibowo gagal:', e.message)),
    },
    isBear: (d) => isBtcBearWindow(d),
    dxyWeak: async () => require('./dxyContext').isDxyWeak(20),
    kaelaJournal: {
      record: (mode, e) => kaela.recordJournalEntry(MASTER_NOMOR, mode, e).catch((err) => console.log('[RangerRotasi] recordJournalEntry gagal:', err.message)),
      update: (id, p) => kaela.updateJournalEntry(id, p).catch((err) => console.log('[RangerRotasi] updateJournalEntry gagal:', err.message)),
    },
    fmt: messageFormatters(venues.badge),
  });
  try { await rot.runCycle(); } finally { saveJournal(journal); }
}

if (require.main === module) main().catch((e) => { console.error('[RangerRotasi] ERROR:', e.message); process.exit(1); });

module.exports = { createRotation, rangerSignal, loadConfig, loadJournal, freshJournal, messageFormatters, fetchCandles4h, buildVenues, DEFAULT_COINS };
