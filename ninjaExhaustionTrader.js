// ninjaExhaustionTrader.js (3 Okt 2026) -- NINJA "Exhaustion": UJI DEMO otomatis sinyal radar likuidasi KITA SENDIRI.
//
// Permintaan Olan (3 Okt 2026): "manfaatkan sinyal kita sendiri di ninja.. short kehabisan energi atau long kehabisan
// energi.. bisa di uji di demo.. jangan takut eksperimen strategi apapun dengan demo.. di uji backtest, di uji demo misal
// 100 transaksi target strategi barunya". Gantiin WA radar Jalur C yang dulu cuma ajakan fade MANUAL.
//
// SINYAL (logika SAMA radar Jalur C actionableLiquidityRadar.js, tapi dicek TIAP MENIT + ambang lebih gede):
//   episode = likuidasi 1 sisi >= burstUsd dalam 30 menit (data Bybit liquidation-events.jsonl); "kehabisan tenaga" =
//   kecepatan sisi itu turun <= ratio x puncaknya. FADE: long-liq kering -> LONG, short-liq kering -> SHORT (BTC boleh short).
// BACKTEST (backtest/ninjaExhaustionStudy.js, data ~3 minggu): ambang $300rb RUGI di semua variasi exit (PF 0,4-0,8), arah
//   "ikut" juga rugi; ambang $800rb (n=12) ~IMPAS (PF ~1,0-1,1). -> BELUM ada bukti edge. Makanya: DEMO DOANG (allowReal
//   false), target 100 transaksi, baru dinilai. Aturan dikunci SEBELUM uji (gak diutak-atik di tengah jalan).
// EXIT: SL 1% (STOP_MARKET exchange) -> trailing 0,5% dari harga terbaik begitu untung >= +1% (stop exchange digeser) ->
//   batas tahan 8 jam. Backup software tiap menit (harga live).
// SIZE: kalkulator exposure hitung() (modal = saldo x 1/5, nyawa = SL%), short otomatis separuh (direction 'sell').
// AKUN: BingX SAMA dgn Ninja MR (BINGX_API_KEY) -- saling skip: gak entry kalau Ninja MR/Ninja lama lagi pending/floating,
//   dan strayCheck (posisi Kaela nyasar = 'unsafe') bikin Ninja MR juga skip selama posisi ini kebuka.
//
// Pakai: node ninjaExhaustionTrader.js (tiap menit, run-channel-breakout-vultr.sh). Saklar: ninja-exhaustion-config.json.
// Uji logika: node ninjaExhaustionTrader.selftest.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hitung: hitungExposure } = require('./calculator');
const { isInsufficientBalanceError } = require('./balanceAlert');
const { CLOSE_REASON_LABEL, KAELA_ACCESS_URL, toSniperClubLink, formatAutoOpen, formatAutoClosed, formatWinRateLines, SYSTEM_LABEL } = require('./darkKaelaLog');
const { nextSignalId, dayKeyOf } = require('./signalIdGenerator');

const CONFIG_PATH = path.join(__dirname, 'ninja-exhaustion-config.json');
const JOURNAL_PATH = path.join(__dirname, 'ninja-exhaustion-journal.json');
const EVENTS_PATH = path.join(__dirname, 'liquidation-events.jsonl');
const EXEC_SYMBOL = 'BTC-USDT';
const EXCHANGE_BADGE = '🟣 BingX';
const MODAL_ACTIVE_FRACTION = 1 / 5;
const WINDOW_MS = 30 * 60 * 1000;
const EPISODE_MAX_AGE_MS = 6 * 3600 * 1000;
const STOP_MOVE_MIN_PCT = 0.05;      // stop exchange baru dipasang ulang kalau geser >= 0,05%
const FALLBACK_FEE_PER_SIDE = 0.05;  // % notional (taker BingX) kalau commission gak kebaca
const MASTER_NOMOR = '6281299303888';

function loadConfig() {
  const def = { enabled: false, allowReal: false, entryEnabled: true, burstUsd: 800000, ratio: 0.3, slPct: 1, trailPct: 0.5, trailActPct: 1, maxHoldMin: 480, targetTrades: 100 };
  if (!fs.existsSync(CONFIG_PATH)) return def;
  try { return { ...def, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; } catch { return def; }
}
function freshStats() { return { wins: 0, losses: 0, totalPnlUsd: 0, grossWinUsd: 0, grossLossUsd: 0 }; }
function freshJournal() { return { episode: null, floating: null, closedCount: 0, signals: 0, skipped: 0, stats: { demo: freshStats(), real: freshStats() }, dailySignalSeq: { dayKey: null, count: 0 } }; }
function loadJournal() {
  if (!fs.existsSync(JOURNAL_PATH)) return freshJournal();
  try {
    const j = JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8'));
    const m = { ...freshJournal(), ...j };
    m.stats = { demo: { ...freshStats(), ...(j.stats?.demo || {}) }, real: { ...freshStats(), ...(j.stats?.real || {}) } };
    return m;
  } catch { return freshJournal(); }
}
function saveJournal(j) { fs.writeFileSync(JOURNAL_PATH, JSON.stringify(j, null, 2)); }

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const execDirOf = (dir) => (dir === 'long' ? 'buy' : 'sell');
const positionSideOf = (dir) => (dir === 'long' ? 'LONG' : 'SHORT');
function parseCommission(order) { const c = order ? num(order.commission) : null; return c !== null && c !== 0 ? Math.abs(c) : null; }

// ---- sinyal (pure) -- SAMA backtest/ninjaExhaustionStudy.js updateEpisode ----
function summarize(events) {
  let longUsd = 0, shortUsd = 0;
  for (const e of events) { const n = e.price * e.qty; if (e.side === 'BUY') longUsd += n; else shortUsd += n; }
  return { longUsd, shortUsd };
}
function updateEpisode(ep, burst, now, cfg) {
  const stale = ep && (now - ep.startedAt > EPISODE_MAX_AGE_MS);
  if (ep && !stale) {
    const w = ep.side === 'long' ? burst.longUsd : burst.shortUsd;
    const peak = Math.max(ep.peakUsd, w);
    if (peak > 0 && w / peak <= cfg.ratio) return { ep: null, exhausted: ep.side, peak };
    return { ep: { ...ep, peakUsd: peak } };
  }
  const side = burst.longUsd > burst.shortUsd ? 'long' : 'short';
  const usd = Math.max(burst.longUsd, burst.shortUsd);
  return usd >= cfg.burstUsd ? { ep: { side, startedAt: now, peakUsd: usd } } : { ep: null };
}
function readRecentEvents(now) {
  if (!fs.existsSync(EVENTS_PATH)) return [];
  const lines = fs.readFileSync(EVENTS_PATH, 'utf8').split('\n').filter(Boolean).slice(-3000);
  return lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && e.symbol === 'BTCUSDT' && e.timestamp >= now - WINDOW_MS && e.timestamp <= now);
}

// ================= Inti (deps disuntik biar bisa dites pakai exchange palsu) =================
// deps: { cfg, journal, events(now)->[], execFor(testnet), fetchLivePrice(testnet), strayCheck(exec), otherNinjaBusy()->bool,
//         notify:{sniperClub, wibowo}, kaelaJournal:{record, update}, getIdrRate(), now(), log }
function createTrader(deps) {
  const { cfg, journal: j } = deps;
  const log = deps.log || ((m) => console.log(`[NinjaEX] ${m}`));
  const now = deps.now || (() => Date.now());
  async function safe(label, fn) { try { return await fn(); } catch (e) { log(`${label} GAGAL: ${e.message}`); return undefined; } }

  function nextId() {
    const d = new Date(now());
    const dayKey = dayKeyOf(d);
    if (!j.dailySignalSeq || j.dailySignalSeq.dayKey !== dayKey) j.dailySignalSeq = { dayKey, count: 0 };
    const id = nextSignalId(j.dailySignalSeq.count, d);
    j.dailySignalSeq.count += 1;
    return id;
  }

  // ---------- WA ----------
  function progressLine() { const n = j.stats.demo.wins + j.stats.demo.losses; return `🧪 Uji demo strategi baru: ${n}/${cfg.targetTrades} transaksi\n`; }
  function openMsg(f, leg, isDemo, idrRate) {
    const pos = { id: f.id, signalId: f.signalId, direction: execDirOf(f.dir), entryPrice: leg.entryPrice, tp: null, sl: leg.sl, marginUsd: leg.margin, nilaiPosisi: leg.nilaiPosisi, leverage: leg.leverage, mode: 'exhaustion_fade', patternType: 'exhaustion_fade', assetLabel: 'BTC' };
    return formatAutoOpen(pos, new Date(now()), '', isDemo, idrRate, '', null, EXCHANGE_BADGE, SYSTEM_LABEL.NINJA);
  }
  function closeMsg(f, leg, isDemo, idrRate) {
    const trade = { id: f.id, signalId: f.signalId, direction: f.dir, entryPrice: leg.entryPrice, exitPrice: leg.exitPrice, pnlUsd: leg.grossUsd, feeUsd: leg.feeUsd, pnlPct: null, mode: 'exhaustion_fade', patternType: 'exhaustion_fade', assetLabel: 'BTC' };
    const base = formatAutoClosed(trade, new Date(now()), isDemo, CLOSE_REASON_LABEL[leg.exitReason] || leg.exitReason, idrRate, null, EXCHANGE_BADGE, SYSTEM_LABEL.NINJA);
    const extra = formatWinRateLines(j.stats[isDemo ? 'demo' : 'real'], `Exhaustion (${isDemo ? 'Demo' : 'Real'})`, idrRate) + (isDemo ? progressLine() : '');
    return base.replace(`🔗 ${KAELA_ACCESS_URL}`, extra + `🔗 ${KAELA_ACCESS_URL}`);
  }
  async function sendOpen(f) {
    const idrRate = await safe('kurs', () => deps.getIdrRate());
    if (f.legs.demo) await safe('WA Sniper Club (buka)', () => deps.notify.sniperClub(toSniperClubLink(openMsg(f, f.legs.demo, true, idrRate))));
    const msg = f.legs.real ? openMsg(f, f.legs.real, false, idrRate) : f.legs.demo ? openMsg(f, f.legs.demo, true, idrRate) : null;
    if (msg) await safe('WA Wibowo (buka)', () => deps.notify.wibowo(msg));
  }
  async function sendClose(f) {
    const idrRate = await safe('kurs', () => deps.getIdrRate());
    if (f.legs.demo) await safe('WA Sniper Club (tutup)', () => deps.notify.sniperClub(toSniperClubLink(closeMsg(f, f.legs.demo, true, idrRate))));
    const msg = f.legs.real ? closeMsg(f, f.legs.real, false, idrRate) : f.legs.demo ? closeMsg(f, f.legs.demo, true, idrRate) : null;
    if (msg) await safe('WA Wibowo (tutup)', () => deps.notify.wibowo(msg));
  }

  // ---------- entry ----------
  async function openLeg(exec, testnet, dir, livePrice) {
    const balance = await exec.getAccountBalance(testnet ? 'VST' : 'USDT');
    const calc = hitungExposure({ modal: balance * MODAL_ACTIVE_FRACTION, nyawa: cfg.slPct, direction: execDirOf(dir) });
    await safe('setIsolatedMargin', () => exec.setIsolatedMargin(EXEC_SYMBOL));
    await exec.setLeverage(EXEC_SYMBOL, calc.leverage, positionSideOf(dir));
    const order = await exec.placeMarketEntry({ symbol: EXEC_SYMBOL, direction: execDirOf(dir), notionalUsd: calc.nilaiPosisi, livePrice });
    const entryPrice = num(order.avgPrice) || livePrice;
    const quantity = num(order.executedQty) || num(order.origQty);
    const sl = dir === 'long' ? entryPrice * (1 - cfg.slPct / 100) : entryPrice * (1 + cfg.slPct / 100);
    const stop = await safe(`STOP_MARKET ${testnet ? 'demo' : 'real'}`, () => exec.placeStopMarketClose({ symbol: EXEC_SYMBOL, direction: execDirOf(dir), quantity, stopPrice: sl }));
    return { entryPrice, quantity, sl, stopOrderId: stop ? stop.orderId : null, best: entryPrice, trailed: false, leverage: calc.leverage, margin: calc.margin, nilaiPosisi: entryPrice * quantity, entryCommission: parseCommission(order), openedAt: now() };
  }

  async function enter(side, peak) {
    const dir = side === 'long' ? 'long' : 'short'; // FADE: long-liq kering -> LONG, short-liq kering -> SHORT
    j.signals += 1;
    if (cfg.entryEnabled === false) { log(`Sinyal ${dir.toUpperCase()} (puncak $${Math.round(peak)}) -- entryEnabled:false, dicatat doang.`); return; }
    if (deps.otherNinjaBusy()) { j.skipped += 1; log('Ninja MR/lama lagi pegang akun BingX -- sinyal exhaustion di-skip (gak numpuk).'); return; }
    const demoExec = deps.execFor(true);
    if (!demoExec) { log('Akun demo BingX belum di-setup -- skip.'); return; }
    if ((await deps.strayCheck(demoExec)) === 'unsafe') { j.skipped += 1; log('Akun demo belum bersih -- skip.'); return; }
    const live = await safe('harga live demo', () => deps.fetchLivePrice(true));
    if (!live) return;
    let demo;
    try { demo = await openLeg(demoExec, true, dir, live); } catch (e) { log(`Gagal buka DEMO: ${e.message}`); return; }
    let real = null;
    if (cfg.allowReal) {
      const realExec = deps.execFor(false);
      if (realExec && (await deps.strayCheck(realExec)) !== 'unsafe') {
        try { real = await openLeg(realExec, false, dir, live); }
        catch (e) { log(isInsufficientBalanceError(e.message) ? 'Real skip -- saldo kurang.' : `Real gagal: ${e.message}`); }
      }
    }
    const f = { id: crypto.randomUUID(), signalId: nextId(), dir, peakUsd: peak, openedAt: now(), legs: { demo, real } };
    j.floating = f;
    for (const [mode, leg] of Object.entries(f.legs)) {
      if (leg) deps.kaelaJournal.record(mode, { entryId: `${f.id}-${mode}`, strategy: 'ninja', asset: 'btc', direction: dir, entryPrice: leg.entryPrice, sl: leg.sl, tp: null, status: 'open', openedAt: new Date(now()).toISOString(), note: 'Ninja Exhaustion · fade likuidasi kering (uji demo)' });
    }
    log(`BUKA ${dir.toUpperCase()} #${f.signalId} demo @ ${demo.entryPrice}${real ? ` + real @ ${real.entryPrice}` : ''} -- SL ${demo.sl.toFixed(1)}${demo.stopOrderId ? '' : ' (stop exchange GAGAL, backup software)'}.`);
    await sendOpen(f);
  }

  // ---------- floating ----------
  function closeLeg(f, leg, mode, exit) {
    leg.exitPrice = exit.price; leg.exitReason = exit.reason; leg.exitCommission = exit.commission; leg.closedAt = now();
    leg.grossUsd = (leg.exitPrice - leg.entryPrice) * leg.quantity * (f.dir === 'long' ? 1 : -1);
    const entryFee = leg.entryCommission != null ? leg.entryCommission : leg.entryPrice * leg.quantity * FALLBACK_FEE_PER_SIDE / 100;
    const exitFee = leg.exitCommission != null ? leg.exitCommission : leg.exitPrice * leg.quantity * FALLBACK_FEE_PER_SIDE / 100;
    leg.feeUsd = entryFee + exitFee; leg.netUsd = leg.grossUsd - leg.feeUsd;
    const st = j.stats[mode]; st.totalPnlUsd += leg.netUsd;
    if (leg.netUsd >= 0) { st.wins += 1; st.grossWinUsd += leg.netUsd; } else { st.losses += 1; st.grossLossUsd += -leg.netUsd; }
    deps.kaelaJournal.update(`${f.id}-${mode}`, { status: 'closed', closedAt: new Date(now()).toISOString(), pnlUsd: leg.netUsd });
    log(`TUTUP ${mode} ${f.dir} ${leg.entryPrice} -> ${leg.exitPrice} (${leg.exitReason}) net ${leg.netUsd.toFixed(2)}`);
  }
  const stopReason = (leg) => (leg.trailed ? 'EX_TRAIL' : 'EX_SL');

  async function manage() {
    const f = j.floating;
    for (const mode of ['demo', 'real']) {
      const L = f.legs[mode];
      if (!L || L.closedAt) continue;
      const exec = deps.execFor(mode === 'demo');
      if (!exec) continue;
      const pos = await safe(`posisi ${mode}`, () => exec.getPositionBySide(EXEC_SYMBOL, positionSideOf(f.dir)));
      if (pos === undefined) continue;
      if (pos === null) { // udah ketutup exchange (stop) / manual
        let exit = null;
        if (L.stopOrderId) {
          const o = await safe(`cek stop ${mode}`, () => exec.getOrder(EXEC_SYMBOL, L.stopOrderId));
          if (o && String(o.status).toUpperCase() === 'FILLED') exit = { price: num(o.avgPrice) || L.sl, commission: parseCommission(o), reason: stopReason(L) };
        }
        if (!exit) { const live = await safe(`harga ${mode}`, () => deps.fetchLivePrice(mode === 'demo')); exit = { price: live || L.sl, commission: null, reason: 'EX_MANUAL' }; }
        closeLeg(f, L, mode, exit);
        continue;
      }
      const live = await safe(`harga ${mode}`, () => deps.fetchLivePrice(mode === 'demo'));
      if (!live) continue;
      const isLong = f.dir === 'long';
      const stopHit = isLong ? live <= L.sl : live >= L.sl;
      const timeUp = now() - L.openedAt >= cfg.maxHoldMin * 60000;
      if (stopHit || timeUp) {
        if (L.stopOrderId) await safe(`cancel stop ${mode}`, () => exec.cancelOrder(EXEC_SYMBOL, L.stopOrderId));
        const qty = Math.abs(num(pos.positionAmt)) || L.quantity;
        const r = await safe(`tutup market ${mode}`, () => exec.emergencyCloseMarket({ symbol: EXEC_SYMBOL, direction: execDirOf(f.dir), quantity: qty }));
        if (r === undefined) continue;
        const o = r && r.order ? r.order : r;
        closeLeg(f, L, mode, { price: (o && num(o.avgPrice)) || live, commission: parseCommission(o), reason: stopHit ? stopReason(L) : 'EX_TIME' });
        continue;
      }
      // trailing: aktif begitu untung >= trailActPct, jarak trailPct dari harga terbaik, cuma maju
      L.best = isLong ? Math.max(L.best, live) : Math.min(L.best, live);
      const gainPct = (isLong ? L.best - L.entryPrice : L.entryPrice - L.best) / L.entryPrice * 100;
      if (gainPct >= cfg.trailActPct) {
        const cand = isLong ? L.best * (1 - cfg.trailPct / 100) : L.best * (1 + cfg.trailPct / 100);
        const better = isLong ? cand > L.sl * (1 + STOP_MOVE_MIN_PCT / 100) : cand < L.sl * (1 - STOP_MOVE_MIN_PCT / 100);
        if (better) {
          if (L.stopOrderId) await safe(`cancel stop lama ${mode}`, () => exec.cancelOrder(EXEC_SYMBOL, L.stopOrderId));
          const s = await safe(`stop trailing ${mode}`, () => exec.placeStopMarketClose({ symbol: EXEC_SYMBOL, direction: execDirOf(f.dir), quantity: L.quantity, stopPrice: cand }));
          L.stopOrderId = s ? s.orderId : null; // gagal -> backup software tetap pakai L.sl baru
          L.sl = cand; L.trailed = true;
          log(`Trailing ${mode}: stop -> ${cand.toFixed(1)} (terbaik ${L.best.toFixed(1)})${s ? '' : ' [stop exchange GAGAL, backup software]'}`);
        }
      }
    }
    const allDone = ['demo', 'real'].every((m) => !f.legs[m] || f.legs[m].closedAt);
    if (allDone) { j.closedCount += 1; await sendClose(f); j.floating = null; return true; }
    return false;
  }

  async function runCycle() {
    const t = now();
    let closedNow = false;
    if (j.floating) closedNow = await manage();
    // episode dilacak TIAP menit (walau lagi floating) biar puncak/kering kebaca bener, sama kayak backtest
    const r = updateEpisode(j.episode, summarize(deps.events(t)), t, cfg);
    j.episode = r.ep;
    if (r.exhausted) {
      if (j.floating || closedNow) log(`Sinyal exhaustion ${r.exhausted} muncul tapi posisi masih/baru jalan -- di-skip.`);
      else await enter(r.exhausted, r.peak);
    }
  }
  return { runCycle };
}

// ================= Wiring produksi =================
async function main() {
  const cfg = loadConfig();
  if (!cfg.enabled) return;
  const old = require('./ninjaTrader');
  const { sendWhatsAppToSniperClub } = require('./fonnte');
  const { sendWhatsAppToWibowo } = require('./wibowoNotify');
  const { getUsdIdrRate, recordJournalEntry, updateJournalEntry } = require('./kaelaProTraderClient');
  const journal = loadJournal();
  const trader = createTrader({
    cfg, journal,
    events: (t) => readRecentEvents(t),
    execFor: (testnet) => old.execFor('trailing', testnet),
    fetchLivePrice: (testnet) => old.fetchLivePrice(old.baseUrlFor(testnet)),
    strayCheck: (exec) => old.checkAndClearStrayPosition(exec, null),
    otherNinjaBusy: () => !!require('./ninjaBusy').ninjaBusyReason('exhaustion'), // MR/CB/News (ninjaBusy.js)
    notify: { sniperClub: (m) => sendWhatsAppToSniperClub(m), wibowo: (m) => sendWhatsAppToWibowo(m) },
    kaelaJournal: {
      record: (mode, e) => recordJournalEntry(MASTER_NOMOR, mode, e).catch((err) => console.log('[NinjaEX] recordJournalEntry gagal:', err.message)),
      update: (id, p) => updateJournalEntry(id, p).catch((err) => console.log('[NinjaEX] updateJournalEntry gagal:', err.message)),
    },
    getIdrRate: () => getUsdIdrRate(),
  });
  try { await trader.runCycle(); } finally { saveJournal(journal); }
}

if (require.main === module) main().catch((e) => { console.error('[NinjaEX] ERROR:', e.message); process.exit(1); });

module.exports = { createTrader, freshJournal, loadConfig, loadJournal, updateEpisode, summarize, EXEC_SYMBOL };
