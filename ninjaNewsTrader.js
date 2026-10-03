// ninjaNewsTrader.js (3 Okt 2026) -- NINJA NEWS: "copet" gerakan BTC pas rilis data ekonomi besar, dipandu DOLAR per detik.
//
// Ide + pengalaman Olan (3 Okt 2026): "pas jadwal jalan, detektor dxy kerja cepat.. deteksi perdetik saat news.. dxy
// ngaceng btc short dan sebaliknya.. setelah gerakan besar dxy ada sedikit lag buat btc gerak lawan dxy.. satset copet
// sekali, trailing + invalidasi pendek, habis dapet tinggalin.. kalo backtest gagal jangan nyerah, trial di demo sebulan-
// 2 bulan, kalo bisa dimanfaatin baru real".
//
// CARA KERJA:
//   - Jadwal: news-schedule.json (diverifikasi dari situs resmi Fed/BLS/BEA/Census). Cron tiap menit (run-channel-
//     breakout-vultr.sh) cuma ngecek jadwal; ~2 menit sebelum rilis, dia nyalain proses DETEKTOR terpisah (detached).
//   - Detektor: harga EURUSDT + BTCUSDT tiap DETIK (Binance publik). DXY gak punya feed per-detik gratis -> pakai EURUSDT
//     (EUR = 57,6% bobot DXY, geraknya KEBALIKAN DXY). Patokan = harga 1 detik sebelum rilis.
//   - Sinyal: dalam windowSec detik pertama, EUR gerak >= thrPct% -> EUR naik (DXY turun) = BTC LONG, EUR turun (DXY naik)
//     = BTC SHORT. Skip kalau BTC udah keburu lari >= maxChasePct% ke arah itu (lag-nya udah abis).
//   - Eksekusi: BingX (akun Ninja), DEMO (allowReal false sampai uji demo terbukti). 1 transaksi per rilis.
//     SIZE kalkulator exposure (nyawa = slPct, short separuh). SL pendek (stop exchange) + trailing ketat per detik,
//     maks maxHoldMin -> tutup, selesai ("habis dapet tinggalin").
//   - Tiap rilis DICATAT ke ninja-news-research-log.json (gerak EUR & BTC di detik ke-5/10/30/60/90 dan menit 1-15),
//     ADA transaksi atau nggak -- bahan kalibrasi ambang setelah beberapa rilis.
//   - Koordinasi akun: ninjaBusy.js (strategi Ninja lain skip selama jendela news; news skip kalau akun lagi dipegang).
//
// Pakai: node ninjaNewsTrader.js            -> cek jadwal (cron tiap menit), nyalain detektor kalau rilis udah deket
//        node ninjaNewsTrader.js --live KEY -> proses detektor (dinyalain otomatis, jangan manual)
//        node ninjaNewsTrader.js --mechanics-test -> uji MEKANIK di DEMO doang: buka LONG kecil, trailing, tutup <= 2 menit,
//                                                    TANPA WA (buat bukti jalur order BingX beres sebelum rilis pertama)
// Uji logika: node ninjaNewsTrader.selftest.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hitung: hitungExposure } = require('./calculator');
const { isEDT } = require('./fedEvents');

const CONFIG_PATH = path.join(__dirname, 'ninja-news-config.json');
const SCHEDULE_PATH = path.join(__dirname, 'news-schedule.json');
const JOURNAL_PATH = path.join(__dirname, 'ninja-news-journal.json');
const RESEARCH_PATH = path.join(__dirname, 'ninja-news-research-log.json');
const LOG_PATH = path.join(__dirname, 'ninja-news.log');
const EXEC_SYMBOL = 'BTC-USDT';
const EXCHANGE_BADGE = '🟣 BingX';
const MODAL_ACTIVE_FRACTION = 1 / 5;
const FALLBACK_FEE_PER_SIDE = 0.05;
const STOP_UPDATE_MIN_MS = 3000;   // stop exchange digeser maks tiap 3 detik
const STOP_MOVE_MIN_PCT = 0.03;
const MASTER_NOMOR = '6281299303888';

function loadConfig() {
  const def = { enabled: false, allowReal: false, armBeforeSec: 120, preSec: 45, windowSec: 90, thrPct: 0.05, maxChasePct: 0.5, slPct: 0.4, trailActPct: 0.3, trailPct: 0.2, maxHoldMin: 20, recordMin: 15, targetTrades: 30 };
  if (!fs.existsSync(CONFIG_PATH)) return def;
  try { return { ...def, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; } catch { return def; }
}
function freshStats() { return { wins: 0, losses: 0, totalPnlUsd: 0, grossWinUsd: 0, grossLossUsd: 0 }; }
function freshJournal() { return { handled: {}, active: null, floating: null, closedCount: 0, stats: { demo: freshStats(), real: freshStats() } }; }
function loadJournal() {
  if (!fs.existsSync(JOURNAL_PATH)) return freshJournal();
  try { const j = JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8')); return { ...freshJournal(), ...j, stats: { demo: { ...freshStats(), ...(j.stats?.demo || {}) }, real: { ...freshStats(), ...(j.stats?.real || {}) } } }; }
  catch { return freshJournal(); }
}
function saveJournal(j) { fs.writeFileSync(JOURNAL_PATH, JSON.stringify(j, null, 2)); }
function appendResearch(rec) {
  let arr = [];
  try { arr = JSON.parse(fs.readFileSync(RESEARCH_PATH, 'utf8')); } catch { /* baru */ }
  arr.push(rec);
  fs.writeFileSync(RESEARCH_PATH, JSON.stringify(arr, null, 2));
}

// "2026-10-14" + "08:30" ET -> ms UTC (EDT = UTC-4, EST = UTC-5, otomatis)
function eventTimeMs(date, timeET) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = timeET.split(':').map(Number);
  const offset = isEDT(Date.UTC(y, m - 1, d, 12)) ? 4 : 5;
  return Date.UTC(y, m - 1, d, hh + offset, mm);
}
function loadSchedule() {
  try {
    const s = JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf8'));
    return (s.events || []).map((e) => ({ ...e, key: `${e.date}T${e.timeET}`, timeMs: eventTimeMs(e.date, e.timeET) }));
  } catch { return []; }
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const execDirOf = (dir) => (dir === 'long' ? 'buy' : 'sell');
const positionSideOf = (dir) => (dir === 'long' ? 'LONG' : 'SHORT');
function parseCommission(o) { const c = o ? num(o.commission) : null; return c !== null && c !== 0 ? Math.abs(c) : null; }

// ---- sinyal (pure) ----
// eurBase/eurNow = harga EURUSDT; btcBase/btcNow = BTC. Return 'long' | 'short' | {skip:alasan} | null
function decideSignal({ eurBase, eurNow, btcBase, btcNow }, cfg) {
  const re = (eurNow - eurBase) / eurBase * 100;
  if (Math.abs(re) < cfg.thrPct) return null;
  const dir = re > 0 ? 'long' : 'short'; // EUR naik = dolar lemah = BTC naik
  const btcMove = (btcNow - btcBase) / btcBase * 100 * (dir === 'long' ? 1 : -1);
  if (btcMove >= cfg.maxChasePct) return { skip: `BTC udah lari ${btcMove.toFixed(2)}% ke arah sinyal (>= ${cfg.maxChasePct}%) -- lag abis, gak ngejar` };
  return dir;
}
// trailing (pure): leg {entryPrice, sl, best, trailed}, live -> update leg, return true kalau stop berubah
function updateTrail(leg, dir, live, cfg) {
  const isLong = dir === 'long';
  leg.best = isLong ? Math.max(leg.best, live) : Math.min(leg.best, live);
  const gain = (isLong ? leg.best - leg.entryPrice : leg.entryPrice - leg.best) / leg.entryPrice * 100;
  if (gain < cfg.trailActPct) return false;
  const cand = isLong ? leg.best * (1 - cfg.trailPct / 100) : leg.best * (1 + cfg.trailPct / 100);
  if (isLong ? cand > leg.sl : cand < leg.sl) { leg.sl = cand; leg.trailed = true; return true; }
  return false;
}

// ================= Detektor 1 rilis (deps disuntik biar bisa dites) =================
// deps: { cfg, journal, event, prices()->{eur,btc}, sleep(ms), now(), execFor(testnet), strayCheck(exec), busyReason(),
//         notify:{sniperClub, wibowo}|null, kaelaJournal, getIdrRate(), log, save() }
async function runDetector(deps) {
  const { cfg, journal: j, event: ev } = deps;
  const log = deps.log || ((m) => console.log(`[NinjaNews] ${m}`));
  const now = deps.now || (() => Date.now());
  const save = deps.save || (() => {});
  async function safe(label, fn) { try { return await fn(); } catch (e) { log(`${label} GAGAL: ${e.message}`); return undefined; } }

  const rec = { key: ev.key, label: ev.label, timeMs: ev.timeMs, eur: {}, btc: {}, signal: null, trade: null };
  // 1) patokan: harga terakhir sebelum rilis
  let base = null;
  while (now() < ev.timeMs) {
    const p = await safe('harga', () => deps.prices());
    if (p) base = p;
    await deps.sleep(1000);
  }
  if (!base) { log('Gak dapet harga patokan sebelum rilis -- batal.'); rec.error = 'no-base'; return rec; }
  rec.eur.base = base.eur; rec.btc.base = base.btc;
  log(`${ev.label}: patokan EUR ${base.eur} BTC ${base.btc}. Jaga ${cfg.windowSec} detik...`);

  // 2) jendela sinyal per detik
  let dir = null, sigPrice = null;
  const marks = [5, 10, 30, 60, 90];
  while (now() < ev.timeMs + cfg.windowSec * 1000) {
    const p = await safe('harga', () => deps.prices());
    const sec = Math.round((now() - ev.timeMs) / 1000);
    if (p) {
      for (const mk of marks) if (sec >= mk && rec.eur[`s${mk}`] === undefined) { rec.eur[`s${mk}`] = p.eur; rec.btc[`s${mk}`] = p.btc; }
      if (!dir) {
        const d = decideSignal({ eurBase: base.eur, eurNow: p.eur, btcBase: base.btc, btcNow: p.btc }, cfg);
        if (d && d.skip) { rec.signal = { skip: d.skip, sec }; log(`Sinyal di-skip: ${d.skip}`); break; }
        if (d) { dir = d; sigPrice = p; rec.signal = { dir, sec, eurMovePct: (p.eur - base.eur) / base.eur * 100 }; log(`SINYAL detik ke-${sec}: EUR ${rec.signal.eurMovePct.toFixed(3)}% -> BTC ${dir.toUpperCase()}`); break; }
      }
    }
    await deps.sleep(1000);
  }
  if (!dir && !rec.signal) { rec.signal = { none: true }; log(`Gak ada reaksi dolar >= ${cfg.thrPct}% dalam ${cfg.windowSec} detik -- gak entry.`); }

  // 3) eksekusi
  if (dir) {
    const busy = deps.busyReason();
    if (busy) { rec.trade = { skipped: busy }; log(`Akun BingX lagi dipegang (${busy}) -- gak entry.`); }
    else rec.trade = await trade(dir, sigPrice);
  }

  // 4) rekam gerak BTC sampai recordMin menit (buat kalibrasi), kalau belum lewat
  const endRec = ev.timeMs + cfg.recordMin * 60000;
  for (const mn of [1, 2, 5, 10, 15]) {
    if (mn > cfg.recordMin) continue;
    while (now() < ev.timeMs + mn * 60000 && now() < endRec) await deps.sleep(Math.min(5000, ev.timeMs + mn * 60000 - now()));
    const p = await safe('harga', () => deps.prices());
    if (p) { rec.eur[`m${mn}`] = p.eur; rec.btc[`m${mn}`] = p.btc; }
  }
  return rec;

  // ---------- trade ----------
  async function openLeg(exec, testnet, d, live) {
    const balance = await exec.getAccountBalance(testnet ? 'VST' : 'USDT');
    const calc = hitungExposure({ modal: balance * MODAL_ACTIVE_FRACTION, nyawa: cfg.slPct, direction: execDirOf(d) });
    await safe('setIsolatedMargin', () => exec.setIsolatedMargin(EXEC_SYMBOL));
    await exec.setLeverage(EXEC_SYMBOL, calc.leverage, positionSideOf(d));
    const o = await exec.placeMarketEntry({ symbol: EXEC_SYMBOL, direction: execDirOf(d), notionalUsd: calc.nilaiPosisi, livePrice: live });
    const entryPrice = num(o.avgPrice) || live;
    const quantity = num(o.executedQty) || num(o.origQty);
    const sl = d === 'long' ? entryPrice * (1 - cfg.slPct / 100) : entryPrice * (1 + cfg.slPct / 100);
    const stop = await safe('STOP_MARKET', () => exec.placeStopMarketClose({ symbol: EXEC_SYMBOL, direction: execDirOf(d), quantity, stopPrice: sl }));
    return { entryPrice, quantity, sl, best: entryPrice, trailed: false, stopOrderId: stop ? stop.orderId : null, stopSl: sl, stopUpdatedAt: now(), leverage: calc.leverage, margin: calc.margin, nilaiPosisi: entryPrice * quantity, entryCommission: parseCommission(o), openedAt: now() };
  }

  async function trade(d, sp) {
    const legs = {};
    const demoExec = deps.execFor(true);
    if (!demoExec) { log('Akun demo BingX belum di-setup.'); return { error: 'no-demo' }; }
    if ((await deps.strayCheck(demoExec)) === 'unsafe') { log('Akun demo gak bersih -- gak entry.'); return { skipped: 'stray' }; }
    try { legs.demo = await openLeg(demoExec, true, d, sp.btc); } catch (e) { log(`Gagal buka DEMO: ${e.message}`); return { error: e.message }; }
    if (cfg.allowReal) {
      const realExec = deps.execFor(false);
      if (realExec && (await deps.strayCheck(realExec)) !== 'unsafe') {
        try { legs.real = await openLeg(realExec, false, d, sp.btc); } catch (e) { log(`Real skip: ${e.message}`); }
      }
    }
    const f = { id: crypto.randomUUID(), key: ev.key, label: ev.label, dir: d, openedAt: now(), legs };
    j.floating = f; save();
    log(`BUKA ${d.toUpperCase()} demo @ ${legs.demo.entryPrice}${legs.real ? ` + real @ ${legs.real.entryPrice}` : ''}, SL ${legs.demo.sl.toFixed(1)}${legs.demo.stopOrderId ? '' : ' (stop exchange GAGAL, backup per detik)'}`);
    for (const [mode, leg] of Object.entries(legs)) deps.kaelaJournal.record(mode, { entryId: `${f.id}-${mode}`, strategy: 'ninja', asset: 'btc', direction: d, entryPrice: leg.entryPrice, sl: leg.sl, tp: null, status: 'open', openedAt: new Date(now()).toISOString(), note: `news-dxy ${ev.label}` });
    await notifyOpen(f);

    // kelola per detik sampai semua leg tutup
    while (Object.entries(legs).some(([, L]) => !L.closedAt)) {
      await deps.sleep(1000);
      const p = await safe('harga', () => deps.prices());
      for (const [mode, L] of Object.entries(legs)) {
        if (L.closedAt) continue;
        const exec = deps.execFor(mode === 'demo');
        const live = p ? p.btc : null;
        const timeUp = now() - L.openedAt >= cfg.maxHoldMin * 60000;
        const stopHit = live !== null && (d === 'long' ? live <= L.sl : live >= L.sl);
        if (stopHit || timeUp) { await closeLeg(f, L, mode, exec, live, stopHit ? (L.trailed ? 'NW_TRAIL' : 'NW_SL') : 'NW_TIME'); continue; }
        // stop exchange kena duluan (posisi ilang)? cek tiap 5 detik
        if (!L.posCheckedAt || now() - L.posCheckedAt >= 5000) {
          L.posCheckedAt = now();
          const pos = await safe(`posisi ${mode}`, () => exec.getPositionBySide(EXEC_SYMBOL, positionSideOf(d)));
          if (pos === null) {
            const o = L.stopOrderId ? await safe('cek stop', () => exec.getOrder(EXEC_SYMBOL, L.stopOrderId)) : null;
            const filled = o && String(o.status).toUpperCase() === 'FILLED';
            finishLeg(f, L, mode, { price: filled ? (num(o.avgPrice) || L.stopSl) : (live || L.sl), commission: filled ? parseCommission(o) : null, reason: filled ? (L.trailed ? 'NW_TRAIL' : 'NW_SL') : 'NW_MANUAL' });
            continue;
          }
        }
        if (live !== null && updateTrail(L, d, live, cfg)) {
          const moved = Math.abs(L.sl - L.stopSl) / L.stopSl * 100 >= STOP_MOVE_MIN_PCT;
          if (moved && now() - L.stopUpdatedAt >= STOP_UPDATE_MIN_MS) {
            if (L.stopOrderId) await safe('cancel stop lama', () => exec.cancelOrder(EXEC_SYMBOL, L.stopOrderId));
            const s = await safe('stop trailing', () => exec.placeStopMarketClose({ symbol: EXEC_SYMBOL, direction: execDirOf(d), quantity: L.quantity, stopPrice: L.sl }));
            L.stopOrderId = s ? s.orderId : null; L.stopSl = L.sl; L.stopUpdatedAt = now();
          }
        }
      }
    }
    j.closedCount += 1;
    await notifyClose(f);
    j.floating = null; save();
    const out = {};
    for (const [mode, L] of Object.entries(legs)) out[mode] = { dir: d, entry: L.entryPrice, exit: L.exitPrice, reason: L.exitReason, netUsd: L.netUsd, holdSec: Math.round((L.closedAt - L.openedAt) / 1000) };
    return out;
  }

  async function closeLeg(f, L, mode, exec, live, reason) {
    if (L.stopOrderId) await safe('cancel stop', () => exec.cancelOrder(EXEC_SYMBOL, L.stopOrderId));
    const r = await safe(`tutup market ${mode}`, () => exec.emergencyCloseMarket({ symbol: EXEC_SYMBOL, direction: execDirOf(f.dir), quantity: L.quantity }));
    if (r === undefined) return; // coba lagi detik berikutnya
    const o = r && r.order ? r.order : r;
    finishLeg(f, L, mode, { price: (o && num(o.avgPrice)) || live || L.sl, commission: parseCommission(o), reason });
  }
  function finishLeg(f, L, mode, exit) {
    L.exitPrice = exit.price; L.exitReason = exit.reason; L.closedAt = now();
    L.grossUsd = (L.exitPrice - L.entryPrice) * L.quantity * (f.dir === 'long' ? 1 : -1);
    const fee = (L.entryCommission != null ? L.entryCommission : L.entryPrice * L.quantity * FALLBACK_FEE_PER_SIDE / 100)
      + (exit.commission != null ? exit.commission : L.exitPrice * L.quantity * FALLBACK_FEE_PER_SIDE / 100);
    L.feeUsd = fee; L.netUsd = L.grossUsd - fee;
    const st = j.stats[mode]; st.totalPnlUsd += L.netUsd;
    if (L.netUsd >= 0) { st.wins += 1; st.grossWinUsd += L.netUsd; } else { st.losses += 1; st.grossLossUsd += -L.netUsd; }
    deps.kaelaJournal.update(`${f.id}-${mode}`, { status: 'closed', closedAt: new Date(now()).toISOString(), pnlUsd: L.netUsd });
    log(`TUTUP ${mode} ${f.dir} ${L.entryPrice} -> ${L.exitPrice} (${exit.reason}) net ${L.netUsd.toFixed(2)}`);
  }

  async function notifyOpen(f) {
    if (!deps.notify) return;
    const { formatAutoOpen, toSniperClubLink, SYSTEM_LABEL } = require('./darkKaelaLog');
    const idr = await safe('kurs', () => deps.getIdrRate());
    const msg = (leg, isDemo) => formatAutoOpen({ id: f.id, signalId: ev.label, direction: execDirOf(f.dir), entryPrice: leg.entryPrice, tp: null, sl: leg.sl, marginUsd: leg.margin, nilaiPosisi: leg.nilaiPosisi, leverage: leg.leverage, mode: 'news_dxy', patternType: 'news_dxy', assetLabel: 'BTC' }, new Date(now()), '', isDemo, idr, '', null, EXCHANGE_BADGE, SYSTEM_LABEL.NINJA);
    if (f.legs.demo) await safe('WA Sniper Club', () => deps.notify.sniperClub(toSniperClubLink(msg(f.legs.demo, true))));
    const w = f.legs.real ? msg(f.legs.real, false) : f.legs.demo ? msg(f.legs.demo, true) : null;
    if (w) await safe('WA Wibowo', () => deps.notify.wibowo(w));
  }
  async function notifyClose(f) {
    if (!deps.notify) return;
    const { formatAutoClosed, formatWinRateLines, toSniperClubLink, CLOSE_REASON_LABEL, KAELA_ACCESS_URL, SYSTEM_LABEL } = require('./darkKaelaLog');
    const idr = await safe('kurs', () => deps.getIdrRate());
    const msg = (leg, isDemo) => {
      const base = formatAutoClosed({ id: f.id, signalId: ev.label, direction: f.dir, entryPrice: leg.entryPrice, exitPrice: leg.exitPrice, pnlUsd: leg.grossUsd, feeUsd: leg.feeUsd, pnlPct: null, mode: 'news_dxy', patternType: 'news_dxy', assetLabel: 'BTC' }, new Date(now()), isDemo, CLOSE_REASON_LABEL[leg.exitReason] || leg.exitReason, idr, null, EXCHANGE_BADGE, SYSTEM_LABEL.NINJA);
      const st = j.stats[isDemo ? 'demo' : 'real'];
      const extra = formatWinRateLines(st, `News DXY (${isDemo ? 'Demo' : 'Real'})`, idr) + (isDemo ? `🧪 Uji demo strategi baru: ${st.wins + st.losses}/${cfg.targetTrades} rilis\n` : '');
      return base.replace(`🔗 ${KAELA_ACCESS_URL}`, extra + `🔗 ${KAELA_ACCESS_URL}`);
    };
    if (f.legs.demo) await safe('WA Sniper Club', () => deps.notify.sniperClub(toSniperClubLink(msg(f.legs.demo, true))));
    const w = f.legs.real ? msg(f.legs.real, false) : f.legs.demo ? msg(f.legs.demo, true) : null;
    if (w) await safe('WA Wibowo', () => deps.notify.wibowo(w));
  }
}

// ================= Wiring produksi =================
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

function prodDeps(cfg, journal, ev, { quiet } = {}) {
  const old = require('./ninjaTrader');
  const { ninjaBusyReason } = require('./ninjaBusy');
  const { getUsdIdrRate, recordJournalEntry, updateJournalEntry } = require('./kaelaProTraderClient');
  const logLine = (m) => console.log(`[${new Date().toISOString()}] [NinjaNews] ${m}`);
  return {
    cfg, journal, event: ev,
    prices: async () => {
      const res = await fetch('https://data-api.binance.vision/api/v3/ticker/price?symbols=%5B%22EURUSDT%22,%22BTCUSDT%22%5D', { signal: AbortSignal.timeout(2500) });
      const arr = await res.json();
      const m = Object.fromEntries(arr.map((x) => [x.symbol, Number(x.price)]));
      if (!(m.EURUSDT > 0 && m.BTCUSDT > 0)) throw new Error('harga kosong');
      return { eur: m.EURUSDT, btc: m.BTCUSDT };
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms))),
    execFor: (testnet) => old.execFor('trailing', testnet),
    strayCheck: (exec) => old.checkAndClearStrayPosition(exec, null),
    busyReason: () => ninjaBusyReason('news'),
    notify: quiet ? null : { sniperClub: (m) => require('./fonnte').sendWhatsAppToSniperClub(m), wibowo: (m) => require('./wibowoNotify').sendWhatsAppToWibowo(m) },
    kaelaJournal: quiet ? { record: () => {}, update: () => {} } : {
      record: (mode, e) => recordJournalEntry(MASTER_NOMOR, mode, e).catch((err) => logLine(`recordJournalEntry gagal: ${err.message}`)),
      update: (id, p) => updateJournalEntry(id, p).catch((err) => logLine(`updateJournalEntry gagal: ${err.message}`)),
    },
    getIdrRate: () => getUsdIdrRate(),
    log: logLine,
    save: () => saveJournal(journal),
  };
}

// cron tiap menit: nyalain detektor kalau rilis udah deket
function armIfDue() {
  const cfg = loadConfig();
  if (!cfg.enabled) return;
  const j = loadJournal();
  if (j.active && j.active.pid && pidAlive(j.active.pid)) return; // detektor lagi jalan
  const t = Date.now();
  const ev = loadSchedule().find((e) => !j.handled[e.key] && e.timeMs - t <= cfg.armBeforeSec * 1000 && t < e.timeMs + 30000);
  if (!ev) return;
  const { spawn } = require('child_process');
  const out = fs.openSync(LOG_PATH, 'a');
  const child = spawn(process.execPath, [__filename, '--live', ev.key], { detached: true, stdio: ['ignore', out, out], cwd: __dirname });
  child.unref();
  j.active = { key: ev.key, label: ev.label, pid: child.pid, startedAt: t, until: ev.timeMs + (cfg.windowSec + cfg.maxHoldMin * 60 + 120) * 1000 };
  j.handled[ev.key] = { armedAt: new Date(t).toISOString() };
  saveJournal(j);
  console.log(`[NinjaNews] Detektor dinyalain buat ${ev.label} (rilis ${new Date(ev.timeMs).toISOString()}), pid ${child.pid}.`);
}

async function live(key) {
  const cfg = loadConfig();
  const journal = loadJournal();
  const ev = loadSchedule().find((e) => e.key === key);
  if (!ev) { console.log(`[NinjaNews] Event ${key} gak ada di jadwal.`); return; }
  journal.active = { ...(journal.active || {}), key, label: ev.label, pid: process.pid };
  saveJournal(journal);
  let rec;
  try { rec = await runDetector(prodDeps(cfg, journal, ev)); }
  finally {
    journal.active = null;
    journal.handled[key] = { ...(journal.handled[key] || {}), doneAt: new Date().toISOString() };
    saveJournal(journal);
  }
  if (rec) appendResearch(rec);
}

// uji mekanik DEMO (tanpa WA): event palsu 20 detik lagi, sinyal dipaksa LONG, tahan maks 2 menit
async function mechanicsTest() {
  const cfg = { ...loadConfig(), allowReal: false, thrPct: 0.05, maxChasePct: 99, maxHoldMin: 2, windowSec: 5, recordMin: 0 };
  const journal = freshJournal();
  const ev = { key: 'TEST', label: 'UJI MEKANIK (demo, tanpa WA)', timeMs: Date.now() + 20000 };
  const deps = prodDeps(cfg, journal, ev, { quiet: true });
  deps.save = () => {};
  const origPrices = deps.prices;
  let n = 0;
  deps.prices = async () => { const p = await origPrices(); n += 1; return n > 22 ? { ...p, eur: p.eur * 1.001 } : p; }; // paksa "EUR naik" setelah rilis
  const busy = deps.busyReason();
  if (busy) { console.log(`[NinjaNews] Uji mekanik batal -- akun lagi dipegang: ${busy}`); return; }
  const rec = await runDetector(deps);
  console.log('[NinjaNews] HASIL UJI MEKANIK:', JSON.stringify(rec.trade));
}

if (require.main === module) {
  const a = process.argv.slice(2);
  const p = a[0] === '--live' ? live(a[1]) : a[0] === '--mechanics-test' ? mechanicsTest() : Promise.resolve(armIfDue());
  p.catch((e) => { console.error('[NinjaNews] ERROR:', e.message); process.exit(1); });
}

module.exports = { runDetector, decideSignal, updateTrail, eventTimeMs, loadSchedule, freshJournal, loadConfig };
