// gridTrader.js (10 Okt 2026) -- 🕸️ GRID ATH BTC-USDC di BingX Perpetual, REAL langsung (keputusan Olan: "grid gak usah demo,
// backtest cukup, secara matematika oke"). Riset: backtest/gridLab.js (data 1 jam 2017-26, 94 titik mulai, compound).
//
// ATURAN OLAN (persis):
//   1. Deteksi ATH terakhir BTC. Syarat entry: harga <= ATH -15% (minDd).
//   2. Masuk = porsi sesuai kedalaman: tiap 1% di bawah ATH = 1% MODAL GRID (k). Mulai di ATH -34% -> langsung tanam 34%.
//   3. Turun lagi -> auto rebuy tiap level (step 1%) pakai ukuran yang sama.
//   4. Untung bersih >= 15% dari MODAL YANG DITANAM -> tutup SEMUA, siklus selesai.
//   5. Ulang langsung dari acuan ATH (selama masih <= ATH -15%). Modal grid = ekuitas akun saat siklus mulai -> COMPOUND.
//   Volume per level = modal ditanam x pengali (default 1x = tanpa leverage berlebih; eksposur maks <= capExposure x ekuitas).
//   Backtest aturan persis ini (CYCLE step1 k1 x1 TP15): CAGR median ~15%/th, DD terburuk ~59%, gak pernah hangus.
//
// Eksekusi: 1 posisi LONG BTC-USDC CROSS (hedge mode BingX), market order tiap level kesentuh (cek tiap menit dari cron
// run-channel-breakout-vultr.sh). Level yang ukurannya di bawah minimum order (0,0001 BTC) DITUMPUK ke level berikutnya.
// Jurnal: grid-journal.json (git, STATE_FILES). Pesan: Wibowo Hedgefund (real) pakai template darkKaelaLog (SYSTEM_LABEL.GRID).
// Pengaman: posisi di exchange beda dari jurnal -> STOP + lapor (gak nebak/gak nutup posisi orang). Saklar: grid-config.json.
// Uji: node gridTrader.selftest.js (exchange PALSU).

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'grid-config.json');
const JOURNAL_PATH = path.join(__dirname, 'grid-journal.json');
const TAKER = 0.0005;
const OLAN_PRIBADI = '6282134510686';

function loadConfig() {
  const def = { enabled: false, allowReal: false, symbol: 'BTC-USDC', marginAsset: 'USDC', minDd: 15, step: 1, k: 1, tp: 15, volMult: [{ fromDd: 0, x: 1 }], capExposure: 2, leverage: 5 };
  try { return { ...def, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; } catch { return def; }
}
function freshJournal() { return { ath: null, athAt: null, cycle: null, history: [], stats: { cycles: 0, wins: 0, losses: 0, totalPnlUsd: 0 }, seq: { day: null, n: 0 }, alerts: {} }; }
function loadJournal() { try { return { ...freshJournal(), ...JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8')) }; } catch { return freshJournal(); } }
function saveJournal(j) { fs.writeFileSync(JOURNAL_PATH, JSON.stringify(j, null, 2)); }

const multAt = (cfg, ddPct) => { let x = 1; for (const m of cfg.volMult || []) if (ddPct >= m.fromDd) x = m.x; return x; };
const fmt$ = (v) => `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

// ================= 1 siklus cek (deps disuntik biar bisa dites) =================
// deps: { cfg, journal, now(), price()->num, athCandidate()->num (high terbaru), exec, notify(msg), alert(msg), log, save(), idr() }
async function runOnce(deps) {
  const { cfg, journal: j } = deps;
  const log = deps.log || ((m) => console.log(`[Grid] ${m}`));
  const now = deps.now ? deps.now() : Date.now();
  if (!cfg.enabled) return { skipped: 'disabled' };
  if (!cfg.allowReal || !deps.exec) return { skipped: 'real off / key kosong' };
  const sym = cfg.symbol, ex = deps.exec;

  const px = await deps.price();
  const high = await deps.athCandidate().catch(() => null);
  if (!(px > 0)) { log('harga gak kebaca -- skip'); return { skipped: 'no-price' }; }
  const cand = Math.max(high || 0, px);
  if (!(j.ath > 0) || cand > j.ath) { j.ath = cand; j.athAt = now; }
  const dd = (1 - px / j.ath) * 100;

  // ---- rekonsiliasi posisi exchange vs jurnal ----
  const pos = await ex.getPositionBySide(sym, 'LONG');
  const exQty = pos ? Math.abs(parseFloat(pos.positionAmt)) : 0;
  const c = j.cycle;
  const jQty = c ? c.qty : 0;
  if (jQty === 0 && exQty > 0) {
    const msg = `posisi LONG ${sym} ${exQty} ada di exchange tapi jurnal grid kosong -- grid BERHENTI, gak nyentuh posisi itu. Cek manual.`;
    log(msg); await deps.alert(`⚠️ Grid: ${msg}`, 'stray'); deps.save(); return { stopped: 'stray' };
  }
  if (c && jQty > 0 && exQty === 0) {
    log(`posisi grid hilang dari exchange (manual/likuidasi) -- siklus ${c.id} direset`);
    j.history.push({ ...summary(c), closedAt: now, exit: null, grossUsd: null, feeUsd: null, net: null, reason: 'GRID_GONE' });
    j.cycle = null; deps.save();
    await deps.alert(`⚠️ Grid: posisi ${sym} hilang dari exchange (ditutup manual/likuidasi?). Siklus ${c.signalId} direset, PnL gak kebaca.`, 'gone');
    return { gone: true };
  }
  if (c && jQty > 0 && Math.abs(exQty - jQty) / jQty > 0.02) {
    const msg = `qty exchange ${exQty} beda dari jurnal ${jQty.toFixed(4)} -- grid STOP sementara (gak nebak). Cek manual.`;
    log(msg); await deps.alert(`⚠️ Grid: ${msg}`, 'mismatch'); deps.save(); return { stopped: 'mismatch' };
  }

  // ---- TP siklus: untung bersih >= tp% x modal ditanam ----
  if (c && c.qty > 0) {
    const gross = c.qty * px - c.cost, feeClose = c.qty * px * TAKER, net = gross - feeClose - c.feeOpen;
    if (net >= c.planted * cfg.tp / 100) {
      const o = await ex.emergencyCloseMarket({ symbol: sym, direction: 'buy', quantity: c.qty });
      const order = o && o.order ? o.order : o;
      const exit = parseFloat(order && order.avgPrice) || px;
      const g2 = c.qty * exit - c.cost, fee2 = c.feeOpen + c.qty * exit * TAKER, n2 = g2 - fee2;
      const rec = { ...summary(c), closedAt: now, exit, grossUsd: g2, feeUsd: fee2, net: n2, retPlantedPct: n2 / c.planted * 100, reason: 'GRID_TP' };
      j.history.push(rec); if (j.history.length > 500) j.history = j.history.slice(-500);
      j.stats.cycles += 1; j.stats.totalPnlUsd += n2; if (n2 >= 0) j.stats.wins += 1; else j.stats.losses += 1;
      j.cycle = null; deps.save();
      log(`TP siklus ${rec.signalId}: ${c.qty.toFixed(4)} BTC ${rec.entry.toFixed(1)} -> ${exit.toFixed(1)} net ${n2.toFixed(2)} (+${rec.retPlantedPct.toFixed(1)}% modal ditanam)`);
      await deps.notify(closeMsg(rec, j, deps));
      return { tp: rec };
    }
  }

  // ---- entry / rebuy ----
  const lvl = Math.floor(dd / cfg.step + 1e-9);
  if (lvl * cfg.step < cfg.minDd) { deps.save(); return { idle: `dd ${dd.toFixed(1)}% < ${cfg.minDd}%` }; }
  let cy = j.cycle;
  const opening = !cy;
  if (opening) {
    const wallet = await ex.getWalletBalance(cfg.marginAsset);
    if (!(wallet > 1)) {
      if (!j.noBalLogAt || now - j.noBalLogAt > 6 * 3600e3) { log(`saldo ${cfg.marginAsset} ${wallet} -- belum bisa mulai siklus (syarat entry udah terpenuhi: ATH -${dd.toFixed(1)}%)`); j.noBalLogAt = now; }
      deps.save(); return { idle: 'no-balance' };
    }
    if (!j.seq || j.seq.day !== new Date(now).toISOString().slice(0, 10)) j.seq = { day: new Date(now).toISOString().slice(0, 10), n: 0 };
    j.seq.n += 1;
    cy = { id: `grid-${now}`, signalId: `G${j.seq.day.replace(/-/g, '')}${String(j.seq.n).padStart(2, '0')}`, startedAt: now, athAtStart: j.ath, cycleCap: wallet, filledLvl: 0, planted: 0, qty: 0, cost: 0, feeOpen: 0, layers: 0, pendingUsd: 0, pendingVol: 0 };
    await ex.setCrossMargin(sym).catch((e) => log(`set cross: ${e.message}`));
    await ex.setLeverage(sym, cfg.leverage, 'LONG').catch((e) => log(`set leverage: ${e.message}`));
  }
  if (lvl <= cy.filledLvl) { j.cycle = cy.qty > 0 ? cy : (opening ? null : cy); deps.save(); return { idle: 'level sama' }; }
  // tanam semua level baru (pertama kali: level 1..lvl sekaligus = dd%)
  let addUnit = cy.pendingUsd, addVol = cy.pendingVol;
  for (let lv = cy.filledLvl + 1; lv <= lvl; lv++) { const unit = cy.cycleCap * cfg.k / 100 * cfg.step; addUnit += unit; addVol += unit * multAt(cfg, lv * cfg.step); }
  const equity = cy.cycleCap + (cy.qty > 0 ? cy.qty * px - cy.cost : 0);
  if ((cy.qty * px + addVol) / Math.max(equity, 1e-9) > cfg.capExposure) {
    log(`eksposur bakal > ${cfg.capExposure}x ekuitas -- level ${lvl} gak ditambah`);
    cy.filledLvl = lvl; j.cycle = cy.qty > 0 ? cy : null; deps.save(); return { capped: true };
  }
  const info = await ex.getSymbolInfo(sym);
  const qty = ex.roundToStepSize ? ex.roundToStepSize(addVol / px, info.stepSize, info.quantityPrecision) : Math.floor(addVol / px / info.stepSize) * info.stepSize;
  if (!(qty > 0) || qty * px < (info.minNotionalUsd || 0)) {
    cy.pendingUsd = addUnit; cy.pendingVol = addVol; cy.filledLvl = lvl; j.cycle = cy.qty > 0 || cy.pendingUsd > 0 ? cy : null; deps.save();
    log(`level ${lvl}: volume ${fmt$(addVol)} di bawah minimum order -- ditumpuk ke level berikutnya`);
    return { pending: addVol };
  }
  const order = await ex.placeMarketEntry({ symbol: sym, direction: 'buy', notionalUsd: qty * px * 1.0000001, livePrice: px });
  const fillPx = parseFloat(order.avgPrice) || px, fillQty = parseFloat(order.executedQty) || qty;
  cy.qty += fillQty; cy.cost += fillQty * fillPx; cy.feeOpen += fillQty * fillPx * TAKER; cy.planted += addUnit * (fillQty * fillPx) / addVol;
  cy.layers += 1; cy.filledLvl = lvl; cy.pendingUsd = 0; cy.pendingVol = 0; cy.lastDd = dd;
  j.cycle = cy; deps.save();
  log(`${opening ? 'BUKA' : 'TAMBAH'} siklus ${cy.signalId}: ${fillQty} BTC @ ${fillPx} (dd ${dd.toFixed(1)}%, level ${lvl}) -- ditanam ${fmt$(cy.planted)}, posisi ${fmt$(cy.cost)}`);
  await deps.notify(opening ? openMsg(cy, dd, fillPx, deps) : addMsg(cy, dd, fillPx, fillQty, deps));
  return { bought: { opening, qty: fillQty, px: fillPx, lvl } };
}

function summary(c) { return { id: c.id, signalId: c.signalId, openedAt: c.startedAt, entry: c.qty > 0 ? c.cost / c.qty : null, qty: c.qty, planted: c.planted, layers: c.layers, cycleCap: c.cycleCap, athAtStart: c.athAtStart }; }

function openMsg(cy, dd, fillPx, deps) {
  const { formatAutoOpen, EXCHANGE_BADGE, SYSTEM_LABEL } = require('./darkKaelaLog');
  return formatAutoOpen({
    id: cy.id, signalId: cy.signalId, direction: 'buy', entryPrice: fillPx, marginUsd: cy.planted, leverage: Math.max(1, Math.round(cy.cost / Math.max(cy.planted, 1e-9) * 10) / 10), nilaiPosisi: cy.cost,
    tpText: `+${deps.cfg.tp}% dari modal yang ditanam (tutup semua, siklus diulang dari acuan ATH)`,
    slText: 'tanpa SL -- grid nambah tiap BTC turun 1%, eksposur dijaga maks ' + deps.cfg.capExposure + 'x modal grid',
    liquidationNote: 'cross margin -- jauh (eksposur rendah)', assetLabel: 'BTCUSDC',
    reasonText: `Grid ATH: BTC di ATH -${dd.toFixed(1)}% (ATH ${fmt$(cy.athAtStart)}, syarat <= -${deps.cfg.minDd}% terpenuhi) -- tanam ${(cy.planted / cy.cycleCap * 100).toFixed(0)}% modal grid (${fmt$(cy.planted)} dari ${fmt$(cy.cycleCap)})`,
  }, new Date(), '', false, null, '', null, EXCHANGE_BADGE.bingx, SYSTEM_LABEL.GRID);
}
function addMsg(cy, dd, fillPx, fillQty, deps) {
  const { formatAutoAddLayer, EXCHANGE_BADGE, SYSTEM_LABEL } = require('./darkKaelaLog');
  return formatAutoAddLayer({
    id: cy.id, signalId: cy.signalId, layers: cy.layers, entryPrice: cy.cost / cy.qty, marginUsd: cy.planted, leverage: Math.max(1, Math.round(cy.cost / Math.max(cy.planted, 1e-9) * 10) / 10), nilaiPosisi: cy.cost, assetLabel: 'BTCUSDC',
    reasonText: `BTC turun ke ATH -${dd.toFixed(1)}% -> rebuy ${fillQty} BTC @ ${fmt$(fillPx)} (total ditanam ${(cy.planted / cy.cycleCap * 100).toFixed(0)}% modal grid)`,
  }, new Date(), false, null, null, EXCHANGE_BADGE.bingx, SYSTEM_LABEL.GRID);
}
function closeMsg(rec, j, deps) {
  const { formatAutoClosed, formatWinRateLines, CLOSE_REASON_LABEL, EXCHANGE_BADGE, SYSTEM_LABEL, KAELA_ACCESS_URL } = require('./darkKaelaLog');
  const base = formatAutoClosed({ id: rec.id, signalId: rec.signalId, direction: 'long', entryPrice: rec.entry, exitPrice: rec.exit, pnlUsd: rec.grossUsd, feeUsd: rec.feeUsd, pnlPct: rec.retPlantedPct, assetLabel: 'BTCUSDC' }, new Date(), false, `${CLOSE_REASON_LABEL.GRID_TP} (${rec.layers} layer)`, null, null, EXCHANGE_BADGE.bingx, SYSTEM_LABEL.GRID);
  return base.replace(`🔗 ${KAELA_ACCESS_URL}`, formatWinRateLines(j.stats, 'Grid ATH (Real)', null) + `🔗 ${KAELA_ACCESS_URL}`);
}

// ================= Wiring produksi =================
function prodDeps(cfg, journal) {
  const { createBingxClient, loadSecrets } = require('./bingxExecutor');
  const s = loadSecrets();
  const exec = s.BINGX_API_KEY && s.BINGX_API_SECRET ? createBingxClient({ apiKey: s.BINGX_API_KEY, apiSecret: s.BINGX_API_SECRET, testnet: false }) : null;
  const alerts = journal.alerts || (journal.alerts = {});
  return {
    cfg, journal, exec,
    price: async () => {
      const r = await (await fetch(`https://open-api.bingx.com/openApi/swap/v2/quote/price?symbol=${cfg.symbol}`, { signal: AbortSignal.timeout(8000) })).json();
      return parseFloat(r && r.data && r.data.price);
    },
    // ATH: high 1 jam terbaru Binance BTCUSDT (+ inisialisasi sekali dari seluruh riwayat harian kalau jurnal belum punya)
    athCandidate: async () => {
      if (!(journal.ath > 0)) {
        let best = 0, cur = Date.UTC(2017, 7, 17);
        while (cur < Date.now()) {
          const k = await (await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=${cur}&limit=1000`, { signal: AbortSignal.timeout(15000) })).json();
          if (!Array.isArray(k) || !k.length) break;
          for (const x of k) best = Math.max(best, +x[2]);
          cur = k[k.length - 1][0] + 864e5; if (k.length < 1000) break;
        }
        return best;
      }
      const k = await (await fetch('https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=3', { signal: AbortSignal.timeout(8000) })).json();
      return Math.max(...k.map((x) => +x[2]));
    },
    notify: async (msg) => { try { await require('./wibowoNotify').sendWhatsAppToWibowo(msg); } catch (e) { console.log('[Grid] WA Wibowo gagal:', e.message); } },
    // peringatan (gak beres) -> DM Olan HP utama, maks 1x/6 jam per jenis (anti-spam)
    alert: async (msg, kind) => {
      const last = alerts[kind] || 0; if (Date.now() - last < 6 * 3600e3) return;
      alerts[kind] = Date.now();
      try { await require('./fonnte').sendWhatsApp(`${msg}\n\n— Kaela`, OLAN_PRIBADI); } catch (e) { console.log('[Grid] WA alert gagal:', e.message); }
    },
    log: (m) => console.log(`[${new Date().toISOString()}] [Grid] ${m}`),
    save: () => saveJournal(journal),
  };
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.enabled) return;
  const j = loadJournal();
  const deps = prodDeps(cfg, j);
  try { await runOnce(deps); }
  catch (e) {
    deps.log(`GAGAL: ${e.message}`);
    await deps.alert(`⚠️ Grid GAGAL jalan: ${e.message}`, `err:${String(e.message).slice(0, 40)}`);
    saveJournal(j);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { runOnce, loadConfig, freshJournal, multAt };
