// ninjaMrTrader.js (30 Sep 2026) -- eksekutor NINJA "Mean Reversion Searah Tren" di BingX, DEMO (VST)
// + REAL berbarengan, pola SAMA PERSIS Ninja lama (ninjaTrader.js): demo selalu jalan, real cuma
// tambahan kalau `allowReal:true` DAN saldo cukup; Sniper Club dapet notif DEMO, Wibowo Hedgefund
// dapet notif REAL kalau real kebuka, kalau nggak (saldo kurang/akun kotor) dapet notif DEMO
// sebagai pengganti (silent, tanpa caveat -- kebijakan Olan 26 Sep 2026). Permintaan Olan 30 Sep
// 2026: "kalo aku tidur, ga ada eksekusi.. otomatisasi ninja di BingX.. jalankan demo, jalankan
// real.. dengan logika yg sama kek dulu".
//
// STRATEGI (riset 30 Sep 2026, BACKTEST-REGISTRY.md bagian Ninja): BTC 15M, tren EMA200, entry pas
// close tembus Bollinger(20; 2,5) LAWAN tren -> masuk balik ke arah tren; SL k x ATR14 (k=4);
// exit = balik ke rata-rata SMA20. Dengan fee BingX realistis (entry limit post-only maker 0,02%,
// exit SMA20 via limit ngendap maker 0,02%, SL taker 0,05%): in-sample +16% PF 1,16, out-of-sample
// 2019-2024 +21% PF 1,07. Versi TP-trailing KALAH begitu exit kena fee taker (impas in-sample) --
// makanya eksekutor ini pakai exit SMA20, beda dari paper 5M tanpa fee (ninjaMrSignal.js) yang
// pakai trailing. Edge TIPIS, 3 dari 8 tahun rugi -- Olan tau & tetap minta jalan (saldo real kecil).
//
// EKSEKUSI:
//   - Sinyal dari candle 15M CLOSED (sumber data-api.binance.vision, SAMA backtest). Entry = order
//     LIMIT post-only 1 tick di sisi baik close (maker), berlaku sampai candle berikutnya close --
//     gak ke-fill = sinyal LEWAT (dicatat `missedEntries`), gak dikejar pakai market.
//   - Begitu fill: pasang STOP_MARKET di SL (proteksi kalau VPS mati) + LIMIT exit di SMA20 (maker),
//     limit exit digeser tiap candle ngikutin SMA20. Backup software: cek harga live tiap menit --
//     SL kena / close candle nembus SMA20 -> tutup market.
//   - 1 posisi aktif. Candle yang nutup posisi gak boleh buka baru (sama backtest).
//   - Akun BingX SAMA dengan Ninja lama (BINGX_API_KEY) -> WAJIB cek journal Ninja lama gak lagi
//     floating + cek posisi nyasar (checkAndClearStrayPosition) sebelum entry.
//   - Fee: dari `commission` order exchange kalau ada; kalau gak kebaca -> fallback TERBURUK 0,05%
//     per sisi (= 0,10% round-trip, aturan Olan). Stats/akumulasi pakai PnL BERSIH.
//
// ⚠️ Endpoint LIMIT/STOP/getOrder/cancelOrder BingX BELUM diverifikasi empiris dari VPS (sesi cloud
// diblokir) -- semua panggilan fail-safe (error = log + skip), posisi diverifikasi lewat
// user/positions (endpoint yang udah terbukti). Alur logika diuji penuh pakai exchange palsu:
// `node ninjaMrTrader.selftest.js`.
//
// Pakai: node ninjaMrTrader.js  (tiap menit dari run-channel-breakout-vultr.sh). Saklar:
// ninja-mr-exec-config.json (enabled / allowReal / entryEnabled).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { prepare, signal } = require('./backtestNinjaResearch3');
const { hitung: hitungExposure } = require('./calculator');
const { roundToStepSize } = require('./bingxExecutor');
const { isInsufficientBalanceError } = require('./balanceAlert');
const { CLOSE_REASON_LABEL, KAELA_ACCESS_URL, toSniperClubLink, formatAutoOpen, formatAutoClosed, formatWinRateLines, SYSTEM_LABEL } = require('./darkKaelaLog');
const { nextSignalId, dayKeyOf } = require('./signalIdGenerator');

const CONFIG_PATH = path.join(__dirname, 'ninja-mr-exec-config.json');
const JOURNAL_PATH = path.join(__dirname, 'ninja-mr-exec-journal.json');
const EXEC_SYMBOL = 'BTC-USDT';
const EXCHANGE_BADGE = '🟣 BingX';
const MODAL_ACTIVE_FRACTION = 1 / 5; // SAMA Ninja lama / konvensi Nyopet
const TF_MS = { '5m': 5 * 60e3, '15m': 15 * 60e3 };
const TICK = 1e-5;                 // limit 1 tick (~0,001%) di sisi baik close -> post-only ngendap (maker)
const FRESH_MS = 3 * 60e3;         // sinyal cuma dieksekusi kalau candle-nya baru closed <= 3 menit (cron tiap menit)
const EXIT_LIMIT_MOVE_MIN_PCT = 0.01; // limit exit SMA20 baru dipasang ulang kalau geser >= 0,01%
const FALLBACK_FEE_PER_SIDE = 0.05;   // % notional -- aturan Olan: fee terburuk 0,1% round-trip
const MASTER_NOMOR = '6281299303888';

function loadConfig() {
  const def = { enabled: false, allowReal: false, entryEnabled: true, tf: '15m', k: 4, bollMult: 2.5 };
  if (!fs.existsSync(CONFIG_PATH)) return def;
  try { return { ...def, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; } catch { return def; }
}

function freshStats() { return { wins: 0, losses: 0, totalPnlUsd: 0 }; }
function freshJournal() {
  return { lastProcessedCloseTime: null, pendingEntry: null, floating: null, closedCount: 0, missedEntries: 0, stats: { demo: freshStats(), real: freshStats() }, dailySignalSeq: { dayKey: null, count: 0 } };
}
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

const positionSideOf = (dir) => (dir === 'long' ? 'LONG' : 'SHORT');
const execDirOf = (dir) => (dir === 'long' ? 'buy' : 'sell');
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
// BingX `commission` = string negatif pas kena fee; 0/kosong dianggap GAK KEBACA (fallback), bukan gratis.
function parseCommission(order) { const c = order ? num(order.commission) : null; return c !== null && c !== 0 ? Math.abs(c) : null; }

// ================= Inti (dependensi disuntik -- biar bisa diuji dgn exchange palsu) =================
// deps: { cfg, journal, execFor(testnet)->client|null, fetchLivePrice(testnet), strayCheck(exec, idrRate)->'clear'|'unsafe',
//         oldNinjaFloating()->bool, notify:{sniperClub(msg), wibowo(msg)}, recordSkipped({dir,entryPrice,sl,tp}),
//         kaelaJournal:{record(mode, entry), update(entryId, patch)}, getIdrRate(), now()->ms, log(msg) }
function createTrader(deps) {
  const { cfg, journal: j } = deps;
  const log = deps.log || ((m) => console.log(`[NinjaMR/exec] ${m}`));
  const now = deps.now || (() => Date.now());
  const tfMs = TF_MS[cfg.tf] || TF_MS['15m'];
  const P = { kind: 'mr', trend: true, k: cfg.k, exit: 'mean' };

  async function safe(label, fn) {
    try { return await fn(); } catch (e) { log(`${label} GAGAL: ${e.message}`); return undefined; }
  }

  function nextId() {
    const d = new Date(now());
    const dayKey = dayKeyOf(d);
    if (!j.dailySignalSeq || j.dailySignalSeq.dayKey !== dayKey) j.dailySignalSeq = { dayKey, count: 0 };
    const id = nextSignalId(j.dailySignalSeq.count, d);
    j.dailySignalSeq.count += 1;
    return id;
  }

  // ---------- pesan WA ----------
  function openMsg(f, leg, isDemo, idrRate) {
    const pos = { id: f.id, signalId: f.signalId, direction: execDirOf(f.dir), entryPrice: leg.entryPrice, tp: leg.exitLimitPrice || f.sma20AtSignal, tpFull: true, sl: leg.sl, marginUsd: leg.margin, nilaiPosisi: leg.nilaiPosisi, leverage: leg.leverage, mode: 'mean_reversion', assetLabel: 'BTC' };
    return formatAutoOpen(pos, new Date(now()), '', isDemo, idrRate, '', null, EXCHANGE_BADGE, SYSTEM_LABEL.NINJA);
  }
  function closeMsg(f, leg, isDemo, idrRate) {
    const trade = { id: f.id, signalId: f.signalId, direction: f.dir, entryPrice: leg.entryPrice, exitPrice: leg.exitPrice, pnlUsd: leg.grossUsd, feeUsd: leg.feeUsd, pnlPct: null, mode: 'mean_reversion', assetLabel: 'BTC' };
    const base = formatAutoClosed(trade, new Date(now()), isDemo, CLOSE_REASON_LABEL[leg.exitReason] || leg.exitReason, idrRate, null, EXCHANGE_BADGE, SYSTEM_LABEL.NINJA);
    const extra = formatWinRateLines(j.stats[isDemo ? 'demo' : 'real'], `Mean Reversion (${isDemo ? 'Demo' : 'Real'})`, idrRate);
    return base.replace(`🔗 ${KAELA_ACCESS_URL}`, extra + `🔗 ${KAELA_ACCESS_URL}`);
  }
  async function sendOpenNotifications(f) {
    const idrRate = await safe('kurs', () => deps.getIdrRate());
    if (f.legs.demo && !f.notified.demo) {
      await safe('WA Sniper Club (buka)', () => deps.notify.sniperClub(toSniperClubLink(openMsg(f, f.legs.demo, true, idrRate))));
      f.notified.demo = true;
    }
    const realUnresolved = j.pendingEntry && j.pendingEntry.legs.real && !j.pendingEntry.legs.real.resolved;
    if (!f.notified.wibowo && !realUnresolved) {
      const msg = f.legs.real ? openMsg(f, f.legs.real, false, idrRate) : f.legs.demo ? openMsg(f, f.legs.demo, true, idrRate) : null;
      if (msg) { await safe('WA Wibowo (buka)', () => deps.notify.wibowo(msg)); f.notified.wibowo = true; }
    }
  }
  async function sendCloseNotifications(f) {
    const idrRate = await safe('kurs', () => deps.getIdrRate());
    if (f.legs.demo) await safe('WA Sniper Club (tutup)', () => deps.notify.sniperClub(toSniperClubLink(closeMsg(f, f.legs.demo, true, idrRate))));
    const msg = f.wibowoRoute === 'real' && f.legs.real ? closeMsg(f, f.legs.real, false, idrRate) : f.legs.demo ? closeMsg(f, f.legs.demo, true, idrRate) : null;
    if (msg) await safe('WA Wibowo (tutup)', () => deps.notify.wibowo(msg));
  }

  // ---------- entry ----------
  async function placeLeg(exec, testnet, dir, limitPrice, slDistPct) {
    const balance = await exec.getAccountBalance(testnet ? 'VST' : 'USDT');
    const modal = balance * MODAL_ACTIVE_FRACTION;
    const calc = hitungExposure({ modal, nyawa: slDistPct, direction: execDirOf(dir) });
    const info = await exec.getSymbolInfo(EXEC_SYMBOL);
    const quantity = roundToStepSize(calc.nilaiPosisi / limitPrice, info.stepSize, info.quantityPrecision);
    const minNotional = num(info.minNotionalUsd) || 0;
    if (quantity <= 0 || calc.nilaiPosisi < minNotional) throw new Error(`Notional must be no smaller than $${minNotional} (saldo ${balance.toFixed(2)}, notional ${calc.nilaiPosisi.toFixed(2)})`);
    await safe('setIsolatedMargin', () => exec.setIsolatedMargin(EXEC_SYMBOL));
    await exec.setLeverage(EXEC_SYMBOL, calc.leverage, positionSideOf(dir));
    const order = await exec.placeLimitEntry({ symbol: EXEC_SYMBOL, direction: execDirOf(dir), quantity, price: limitPrice, postOnly: true });
    return { orderId: order.orderId, clientOrderId: order.clientOrderId, quantity, leverage: calc.leverage, margin: calc.margin, nilaiPosisi: calc.nilaiPosisi, limitPrice, resolved: false };
  }

  async function maybeEnter(candles, ind, i) {
    const x = candles[i];
    if (now() - x.closeTime > FRESH_MS) return; // candle basi (run pertama / cron sempat mati) -- jangan pasang limit di harga lama
    if (ind.atr[i] === null || ind.sma20[i] === null) return;
    const dir = signal(P, candles, ind, i);
    if (!dir) return;
    if (deps.oldNinjaFloating()) { log('Ninja lama (Channel Breakout) masih floating di akun yang sama -- skip entry.'); return; }
    const limitPrice = dir === 'long' ? x.close * (1 - TICK) : x.close * (1 + TICK);
    const slDistPct = (cfg.k * ind.atr[i] / x.close) * 100;
    const slRef = dir === 'long' ? limitPrice * (1 - slDistPct / 100) : limitPrice * (1 + slDistPct / 100);
    const idrRate = await safe('kurs', () => deps.getIdrRate());

    const demoExec = deps.execFor(true);
    if (!demoExec) { log('Akun demo BingX belum di-setup -- skip.'); return; }
    if ((await deps.strayCheck(demoExec, idrRate)) === 'unsafe') { log('Akun demo belum dipastikan bersih -- skip entry siklus ini.'); return; }
    let demoLeg;
    try { demoLeg = await placeLeg(demoExec, true, dir, limitPrice, slDistPct); }
    catch (e) { log(`Gagal pasang limit DEMO: ${e.message}`); return; }

    let realLeg = null;
    if (cfg.allowReal) {
      const realExec = deps.execFor(false);
      if (realExec && (await deps.strayCheck(realExec, idrRate)) === 'unsafe') log('Akun real belum dipastikan bersih -- real skip (demo tetap jalan).');
      else if (realExec) {
        try { realLeg = await placeLeg(realExec, false, dir, limitPrice, slDistPct); }
        catch (e) {
          if (isInsufficientBalanceError(e.message)) { deps.recordSkipped({ dir, entryPrice: limitPrice, sl: slRef, tp: ind.sma20[i] }); log('Real skip -- saldo kurang (dicatat ke rekap harian).'); }
          else log(`Real gagal (BUKAN saldo kurang -- perlu dicek): ${e.message}`);
        }
      }
    }
    j.pendingEntry = { id: crypto.randomUUID(), signalId: nextId(), dir, signalCloseTime: x.closeTime, expiresAtCloseTime: x.closeTime + tfMs, limitPrice, slDistPct, sma20AtSignal: ind.sma20[i], legs: { demo: demoLeg, real: realLeg }, placedAt: now() };
    log(`Sinyal ${dir.toUpperCase()} #${j.pendingEntry.signalId} -- limit ${limitPrice.toFixed(1)} dipasang (demo${realLeg ? ' + real' : ''}), SL ${slDistPct.toFixed(2)}%, berlaku sampai candle berikutnya close.`);
  }

  // ---------- pending -> floating ----------
  function newFloatingFrom(pe) {
    return { id: pe.id, signalId: pe.signalId, dir: pe.dir, slDistPct: pe.slDistPct, sma20AtSignal: pe.sma20AtSignal, openedAt: now(), legs: { demo: null, real: null }, wibowoRoute: 'demo', notified: { demo: false, wibowo: false } };
  }
  async function armLeg(exec, f, leg, mode, ind, i) {
    const f2 = f.slDistPct / 100;
    leg.sl = f.dir === 'long' ? leg.entryPrice * (1 - f2) : leg.entryPrice * (1 + f2);
    const stop = await safe(`STOP_MARKET ${mode}`, () => exec.placeStopMarketClose({ symbol: EXEC_SYMBOL, direction: execDirOf(f.dir), quantity: leg.quantity, stopPrice: leg.sl }));
    leg.stopOrderId = stop ? stop.orderId : null;
    await placeExitLimit(exec, f, leg, mode, ind.sma20[i], null);
    deps.kaelaJournal.record(mode, { entryId: `${f.id}-${mode}`, strategy: 'ninja', asset: 'btc', direction: f.dir, entryPrice: leg.entryPrice, sl: leg.sl, tp: leg.exitLimitPrice || null, status: 'open', openedAt: new Date(now()).toISOString(), note: 'mean-reversion' });
  }
  async function placeExitLimit(exec, f, leg, mode, target, live) {
    if (target === null || target === undefined) return;
    const sideOk = live === null ? true : (f.dir === 'long' ? target > live : target < live); // limit di seberang harga -> ngendap (maker), bukan langsung match
    if (!sideOk) return;
    if (leg.exitLimitPrice && Math.abs(target - leg.exitLimitPrice) / leg.exitLimitPrice * 100 < EXIT_LIMIT_MOVE_MIN_PCT) return;
    if (leg.exitOrderId) { await safe(`cancel limit exit lama ${mode}`, () => exec.cancelOrder(EXEC_SYMBOL, leg.exitOrderId)); leg.exitOrderId = null; }
    const o = await safe(`LIMIT exit ${mode}`, () => exec.placeLimitClose({ symbol: EXEC_SYMBOL, direction: execDirOf(f.dir), quantity: leg.quantity, price: target }));
    leg.exitOrderId = o ? o.orderId : null;
    leg.exitLimitPrice = o ? target : leg.exitLimitPrice;
  }

  async function managePending(newCandle, candles, ind, i) {
    const pe = j.pendingEntry;
    const expired = candles[i].closeTime >= pe.expiresAtCloseTime;
    for (const mode of ['demo', 'real']) {
      const L = pe.legs[mode];
      if (!L || L.resolved) continue;
      const exec = deps.execFor(mode === 'demo');
      if (!exec) { L.resolved = true; continue; }
      let order = await safe(`getOrder ${mode}`, () => exec.getOrder(EXEC_SYMBOL, L.orderId));
      let filledQty = order ? (num(order.executedQty) || 0) : 0;
      if (order && order.status === 'FILLED' && filledQty > 0) { L.resolved = true; L.fill = { entryPrice: num(order.avgPrice) || L.limitPrice, quantity: filledQty, commission: parseCommission(order) }; }
      else if (order && ['CANCELED', 'CANCELLED', 'EXPIRED', 'REJECTED'].includes(String(order.status).toUpperCase())) { L.resolved = true; if (filledQty > 0) L.fill = { entryPrice: num(order.avgPrice) || L.limitPrice, quantity: filledQty, commission: parseCommission(order) }; }
      else if (expired) {
        await safe(`cancel limit entry ${mode}`, () => exec.cancelOrder(EXEC_SYMBOL, L.orderId));
        order = await safe(`getOrder ${mode} (setelah cancel)`, () => exec.getOrder(EXEC_SYMBOL, L.orderId));
        if (order) {
          filledQty = num(order.executedQty) || 0;
          L.resolved = true;
          if (filledQty > 0) L.fill = { entryPrice: num(order.avgPrice) || L.limitPrice, quantity: filledQty, commission: parseCommission(order) }; // partial fill -> posisi ADA, kelola
        } else {
          // getOrder gagal -- JANGAN nebak "gak ke-fill" (resiko posisi yatim). Verifikasi lewat posisi (endpoint terbukti).
          const pos = await safe(`positions ${mode} (verifikasi expiry)`, () => exec.getPositionBySide(EXEC_SYMBOL, positionSideOf(pe.dir)));
          if (pos === undefined) { log(`Gak bisa verifikasi order/posisi ${mode} -- pending dipertahankan, coba lagi siklus berikutnya.`); continue; }
          L.resolved = true;
          if (pos) L.fill = { entryPrice: L.limitPrice, quantity: Math.abs(num(pos.positionAmt)) || L.quantity, commission: null };
        }
      }
      if (L.fill && !L.armed) {
        if (!j.floating) j.floating = newFloatingFrom(pe);
        const leg = { entryPrice: L.fill.entryPrice, quantity: L.fill.quantity, leverage: L.leverage, margin: L.margin, nilaiPosisi: L.fill.entryPrice * L.fill.quantity, entryCommission: L.fill.commission, openedAt: now() };
        j.floating.legs[mode] = leg;
        if (mode === 'real') j.floating.wibowoRoute = 'real';
        await armLeg(exec, j.floating, leg, mode, ind, i);
        L.armed = true;
        log(`FILL ${mode} ${pe.dir} @ ${leg.entryPrice} qty ${leg.quantity} (#${pe.signalId}) -- SL ${leg.sl.toFixed(1)}${leg.stopOrderId ? ' (stop exchange terpasang)' : ' (stop exchange GAGAL, backup software)'}${leg.exitLimitPrice ? `, limit exit ${leg.exitLimitPrice.toFixed(1)}` : ''}.`);
      }
    }
    const allResolved = ['demo', 'real'].every((m) => !pe.legs[m] || pe.legs[m].resolved);
    if (j.floating) await sendOpenNotifications(j.floating);
    if (allResolved) {
      if (!j.floating) { j.missedEntries += 1; log(`Limit gak ke-fill sampai candle berikutnya close -- sinyal #${pe.signalId} LEWAT (total lewat ${j.missedEntries}).`); }
      j.pendingEntry = null;
    }
  }

  // ---------- floating ----------
  function feeFor(leg) {
    const entryFee = leg.entryCommission !== null && leg.entryCommission !== undefined ? leg.entryCommission : leg.entryPrice * leg.quantity * FALLBACK_FEE_PER_SIDE / 100;
    const exitFee = leg.exitCommission !== null && leg.exitCommission !== undefined ? leg.exitCommission : leg.exitPrice * leg.quantity * FALLBACK_FEE_PER_SIDE / 100;
    const src = (leg.entryCommission != null ? 1 : 0) + (leg.exitCommission != null ? 1 : 0);
    return { feeUsd: entryFee + exitFee, feeSource: src === 2 ? 'exchange' : src === 1 ? 'campur' : 'fallback' };
  }
  function closeLeg(f, leg, mode, exit) {
    leg.exitPrice = exit.price; leg.exitReason = exit.reason; leg.exitCommission = exit.commission; leg.closedAt = now();
    leg.grossUsd = (leg.exitPrice - leg.entryPrice) * leg.quantity * (f.dir === 'long' ? 1 : -1);
    const fee = feeFor(leg); leg.feeUsd = fee.feeUsd; leg.feeSource = fee.feeSource; leg.netUsd = leg.grossUsd - leg.feeUsd;
    const st = j.stats[mode]; st.totalPnlUsd += leg.netUsd; if (leg.netUsd >= 0) st.wins += 1; else st.losses += 1;
    deps.kaelaJournal.update(`${f.id}-${mode}`, { status: 'closed', closedAt: new Date(now()).toISOString(), pnlUsd: leg.netUsd });
    log(`TUTUP ${mode} ${f.dir} ${leg.entryPrice} -> ${leg.exitPrice} (${leg.exitReason}) gross ${leg.grossUsd.toFixed(2)} fee ${leg.feeUsd.toFixed(2)} (${leg.feeSource}) net ${leg.netUsd.toFixed(2)}`);
  }

  async function manageFloating(newCandle, candles, ind, i) {
    const f = j.floating;
    const x = candles[i];
    for (const mode of ['demo', 'real']) {
      const L = f.legs[mode];
      if (!L || L.closedAt) continue;
      const exec = deps.execFor(mode === 'demo');
      if (!exec) continue;
      const pos = await safe(`positions ${mode}`, () => exec.getPositionBySide(EXEC_SYMBOL, positionSideOf(f.dir)));
      if (pos === undefined) continue; // gak bisa verifikasi siklus ini -- jangan nebak
      if (pos === null) {
        // Posisi udah gak ada -> ditutup exchange (stop/limit exit) atau manual. Cari order mana yang FILLED.
        let exit = null;
        for (const [oid, reason] of [[L.exitOrderId, 'MR_MEAN'], [L.stopOrderId, 'MR_SL']]) {
          if (!oid) continue;
          const o = await safe(`getOrder ${reason} ${mode}`, () => exec.getOrder(EXEC_SYMBOL, oid));
          if (o && String(o.status).toUpperCase() === 'FILLED' && (num(o.executedQty) || 0) > 0) { exit = { price: num(o.avgPrice) || L.exitLimitPrice || L.sl, commission: parseCommission(o), reason }; break; }
        }
        if (!exit) { const live = await safe(`harga live ${mode}`, () => deps.fetchLivePrice(mode === 'demo')); exit = { price: live || L.entryPrice, commission: null, reason: 'MR_MANUAL' }; }
        for (const oid of [L.exitOrderId, L.stopOrderId]) if (oid) await safe(`cancel sisa order ${mode}`, () => exec.cancelOrder(EXEC_SYMBOL, oid));
        closeLeg(f, L, mode, exit);
        continue;
      }
      const live = await safe(`harga live ${mode}`, () => deps.fetchLivePrice(mode === 'demo'));
      if (live === undefined || live === null) continue;
      const slHit = f.dir === 'long' ? live <= L.sl : live >= L.sl;
      const meanHit = newCandle && ind.sma20[i] !== null && (f.dir === 'long' ? x.close >= ind.sma20[i] : x.close <= ind.sma20[i]);
      if (slHit || meanHit) {
        for (const oid of [L.exitOrderId, L.stopOrderId]) if (oid) await safe(`cancel order sebelum tutup ${mode}`, () => exec.cancelOrder(EXEC_SYMBOL, oid));
        const qty = Math.abs(num(pos.positionAmt)) || L.quantity;
        const r = await safe(`tutup market ${mode}`, () => exec.emergencyCloseMarket({ symbol: EXEC_SYMBOL, direction: execDirOf(f.dir), quantity: qty }));
        if (r === undefined) { log(`Tutup ${mode} GAGAL -- dicoba lagi siklus berikutnya.`); continue; }
        const o = r && r.order ? r.order : r;
        closeLeg(f, L, mode, { price: (o && num(o.avgPrice)) || live, commission: parseCommission(o), reason: slHit ? 'MR_SL' : 'MR_MEAN' });
        continue;
      }
      if (newCandle && ind.sma20[i] !== null) await placeExitLimit(exec, f, L, mode, ind.sma20[i], live);
    }
    if (!f.notified.demo || !f.notified.wibowo) await sendOpenNotifications(f);
    const allDone = ['demo', 'real'].every((m) => !f.legs[m] || f.legs[m].closedAt);
    if (allDone) {
      j.closedCount += 1;
      await sendCloseNotifications(f);
      j.floating = null;
      return true;
    }
    return false;
  }

  async function runCycle(candles) {
    const ind = prepare(candles);
    const i = candles.length - 1;
    const newCandle = j.lastProcessedCloseTime === null || candles[i].closeTime > j.lastProcessedCloseTime;
    let closedNow = false;
    // pending diproses DULU dan TIAP siklus (walau floating udah ada) -- leg real bisa fill belakangan dari demo
    if (j.pendingEntry) await managePending(newCandle, candles, ind, i);
    if (j.floating) closedNow = await manageFloating(newCandle, candles, ind, i);
    if (!j.floating && !j.pendingEntry && newCandle && !closedNow && cfg.entryEnabled !== false) await maybeEnter(candles, ind, i);
    j.lastProcessedCloseTime = candles[i].closeTime;
  }

  return { runCycle };
}

// ================= Wiring produksi =================
async function fetchClosedCandles(tf) {
  const { fetchWithRetry } = require('./httpRetry');
  const res = await fetchWithRetry(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=${tf}&limit=1000`);
  const raw = await res.json();
  const t = Date.now();
  return raw.map((x) => ({ openTime: x[0], open: +x[1], high: +x[2], low: +x[3], close: +x[4], volume: +x[5], closeTime: x[6] })).filter((x) => x.closeTime <= t);
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.enabled) { console.log('[NinjaMR/exec] enabled:false -- gak ngapa-ngapain.'); return; }
  if (!TF_MS[cfg.tf]) { console.log(`[NinjaMR/exec] tf '${cfg.tf}' gak didukung.`); return; }
  const old = require('./ninjaTrader');
  const { sendWhatsAppToSniperClub } = require('./fonnte');
  const { sendWhatsAppToWibowo } = require('./wibowoNotify');
  const { getUsdIdrRate, recordJournalEntry, updateJournalEntry } = require('./kaelaProTraderClient');
  const { recordSkippedInsufficientBalance } = require('./ninjaBalanceRecap');
  const candles = await fetchClosedCandles(cfg.tf);
  if (candles.length < 300) { console.log(`[NinjaMR/exec] Candle kurang (${candles.length}), skip.`); return; }
  const journal = loadJournal();
  const trader = createTrader({
    cfg, journal,
    execFor: (testnet) => old.execFor('trailing', testnet), // akun BingX SAMA Ninja lama (BINGX_API_KEY)
    fetchLivePrice: (testnet) => old.fetchLivePrice(old.baseUrlFor(testnet)),
    strayCheck: (exec, idrRate) => old.checkAndClearStrayPosition(exec, idrRate),
    oldNinjaFloating: () => { try { return !!(old.loadJournal().trailing || {}).floating; } catch { return false; } },
    notify: { sniperClub: (m) => sendWhatsAppToSniperClub(m), wibowo: (m) => sendWhatsAppToWibowo(m) },
    recordSkipped: (x) => recordSkippedInsufficientBalance(x),
    kaelaJournal: {
      record: (mode, e) => recordJournalEntry(MASTER_NOMOR, mode, e).catch((err) => console.log('[NinjaMR/exec] recordJournalEntry gagal:', err.message)),
      update: (id, p) => updateJournalEntry(id, p).catch((err) => console.log('[NinjaMR/exec] updateJournalEntry gagal:', err.message)),
    },
    getIdrRate: () => getUsdIdrRate(),
  });
  try { await trader.runCycle(candles); }
  finally { saveJournal(journal); }
}

if (require.main === module) main().catch((e) => { console.error('[NinjaMR/exec] ERROR:', e.message); process.exit(1); });

module.exports = { createTrader, freshJournal, loadConfig, loadJournal, parseCommission, EXEC_SYMBOL, TICK, FALLBACK_FEE_PER_SIDE, MODAL_ACTIVE_FRACTION };
