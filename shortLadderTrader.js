// shortLadderTrader.js (11 Okt 2026) -- 🐻 TANGGA SHORT BTC, pasangan 🌾 Farmer di akun BingX yang SAMA (hedge mode, positionSide SHORT).
// Olan: "fikirkan tangga short.. leverage 1 .. window bear bull .. halving" + "bangun dulu dan jadwalkan auto run saat siap misal 2028".
// Aturan FINAL hasil riset (backtest/gridLifetimeStudy.js, STRATEGY-CATALOG, uji BARENG Farmer long):
//   • Cuma jalan di MUSIM BEAR: hari 520-900 sejak halving (halving dari halving.js -- otomatis dari tinggi blok). Berikutnya ~Sep 2029.
//   • Tangga = 10% saldo awal siklus, isolated 1x (likuidasi ~2x harga, praktis gak kena). Tambah tiap BTC NAIK 5% dari entry terakhir,
//     maks 10 tangga (100% saldo awal).
//   • TP: untung >= 10% total modal masuk (rugi likuidasi ikut ketutup) -> tutup semua, siklus ulang pakai saldo terbaru.
//   • PENGAMAN: tangga gak dibuka/ditambah kalau total margin long (Farmer) + short > 70% ekuitas.
//   • Musim bear habis (hari 900) -> sisa short DITUTUP PAKSA walau rugi (Olan: "short rugi & bull datang, close aja, Farm long tetap jalan").
//   • 30 hari sebelum musim mulai -> Olan dikabarin (masih bisa bilang "jangan" ke Kaela).
// Order bertag clientOrderId kaela- (penutup posisi asing ngenalin), jurnal didaftarin di bingxPositionGuard.js.
// Jalan: node shortLadderTrader.js [demo]. Uji: node shortLadderTrader.selftest.js (exchange palsu).
const fs = require('fs');
const path = require('path');
const { daysSinceHalving, halvingIdx, dateOfDay, nextWindowStart } = require('./halving');
const DEMO = process.argv[2] === 'demo';
const CONFIG_PATH = path.join(__dirname, DEMO ? 'short-ladder-demo-config.json' : 'short-ladder-config.json');
const JOURNAL_PATH = path.join(__dirname, DEMO ? 'short-ladder-demo-journal.json' : 'short-ladder-journal.json');
const TAKER = 0.0005;
const OLAN_PRIBADI = '6282134510686';
const fmt$ = (v) => `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const fmtD = (d) => d ? d.toISOString().slice(0, 10) : '?';

function loadConfig() {
  const def = { enabled: false, allowReal: false, symbol: DEMO ? 'BTC-USDT' : 'BTC-USDC', marginAsset: DEMO ? 'VST' : 'USDC', betPct: 10, gapPct: 5, tpPct: 10, leverage: 1, winFrom: 520, winTo: 900, marginCapPct: 70, remindDays: 30 };
  try { return { ...def, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; } catch { return def; }
}
function freshJournal() { return { cycle: null, history: [], stats: { cycles: 0, tp: 0, forced: 0, liqs: 0, pnlUsd: 0 }, alerts: {}, reminded: null }; }
function loadJournal() { try { return { ...freshJournal(), ...JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8')) }; } catch { return freshJournal(); } }
const posQty = (p) => (p ? Math.abs(parseFloat(p.positionAmt)) || 0 : 0);
const posMg = (p) => (p ? parseFloat(p.initialMargin || p.margin) || 0 : 0);

async function runOnce(deps) {
  const { cfg, journal: j } = deps;
  const now = deps.now ? deps.now() : Date.now();
  const log = deps.log || ((m) => console.log(`[ShortLadder] ${m}`));
  if (!cfg.enabled) return { skipped: 'off' };
  if (!deps.isDemo && !cfg.allowReal) return { skipped: 'real off' };
  const days = deps.days || ((t) => daysSinceHalving(t)), hk = (deps.hIdx || halvingIdx)(now);
  const d = days(now), inWin = d >= cfg.winFrom && d < cfg.winTo;
  const tag = deps.isDemo ? ' (Demo)' : ' (Real)';

  // pengingat sebelum musim bear mulai
  if (!inWin && d < cfg.winFrom && j.reminded !== hk) {
    const start = (deps.dateOfDay || dateOfDay)(cfg.winFrom, now);
    if (start && start.getTime() - now <= cfg.remindDays * 864e5 && start.getTime() > now) {
      j.reminded = hk; deps.save();
      await deps.alert(`🐻 Tangga SHORT${tag} mulai jalan ${fmtD(start)} (hari ke-${cfg.winFrom} sejak halving, musim bear) sampai ${fmtD((deps.dateOfDay || dateOfDay)(cfg.winTo, now))}.\nAturan: 10% saldo/tangga 1x, tambah tiap BTC naik 5%, TP 10% total masuk, total margin long+short maks 70%. Farmer long tetap jalan.\nKalau mau ditunda, bilang ke Kaela sebelum tanggal itu.`, `remind:${hk}`);
    }
  }
  let c = j.cycle;
  if (!inWin && !c) return { idle: 'di luar musim bear', day: Math.round(d) };

  const ex = deps.exec; if (!ex) return { skipped: 'no-exec' };
  const sym = cfg.symbol;
  const px = await deps.price(); if (!(px > 0)) return { skipped: 'no-price' };
  const sp = await ex.getPositionBySide(sym, 'SHORT');
  const closeRec = async (reason, exitPx, pnl, fee) => {
    const rec = { id: c.id, signalId: c.signalId, openedAt: c.startedAt, closedAt: now, entry: c.avg, exit: exitPx, qty: c.qty, layers: c.n, putIn: c.putIn, cycleCap: c.cap, grossUsd: pnl + fee, feeUsd: fee, net: pnl, reason };
    j.history.push(rec); if (j.history.length > 300) j.history = j.history.slice(-300);
    j.stats.cycles += 1; j.stats.pnlUsd += pnl; if (reason === 'SHORT_LADDER_TP') j.stats.tp += 1; if (reason === 'SHORT_LADDER_WINDOW') j.stats.forced += 1;
    j.cycle = null; deps.save();
    const { formatAutoClosed, EXCHANGE_BADGE, SYSTEM_LABEL, CLOSE_REASON_LABEL } = require('./darkKaelaLog');
    await deps.notify(formatAutoClosed({ id: rec.id, signalId: rec.signalId, direction: 'short', entryPrice: rec.entry, exitPrice: exitPx, pnlUsd: rec.grossUsd, feeUsd: fee, pnlPct: pnl / Math.max(c.putIn, 1e-9) * 100, assetLabel: sym.replace('-', '') }, new Date(now), !!deps.isDemo, `${CLOSE_REASON_LABEL[reason]} (${c.n} tangga)`, null, null, EXCHANGE_BADGE.bingx, SYSTEM_LABEL.SHORTLADDER));
    return rec;
  };

  // posisi ilang dari exchange
  if (c && c.qty > 0 && posQty(sp) === 0) {
    if (px >= c.liq * 0.97) { // kena likuidasi
      j.stats.liqs += 1; c.realized -= c.mg; c.qty = 0; c.mg = 0; deps.save();
      log(`LIKUIDASI short ${c.signalId} @ ~${fmt$(px)} -- rugi ${fmt$(c.putIn)}`);
      await deps.alert(`🐻 Tangga SHORT${tag} kena likuidasi @ ${fmt$(px)} (rugi ${fmt$(-c.realized)}). Siklus ditutup.`, `liq:${now}`);
      const rec = await closeRec('SHORT_LADDER_LIQ', px, c.realized, 0); return { liquidated: rec };
    }
    const pnl = c.qty * (c.avg - px) - c.qty * px * TAKER + c.realized;
    log(`posisi short ${c.signalId} ilang (ditutup di luar sistem) @ ~${fmt$(px)}`);
    await deps.alert(`⚠️ Tangga SHORT${tag} ${c.signalId} ketutup di luar sistem @ ~${fmt$(px)}. Dicatat tutup, siklus mulai lagi kalau masih musim bear.`, `ext:${now}`);
    return { external: await closeRec('SHORT_LADDER_EXT', px, pnl, c.qty * px * TAKER) };
  }

  // musim bear habis -> tutup paksa
  if (!inWin && c) {
    const q = posQty(sp) || c.qty;
    const o = await ex.emergencyCloseMarket({ symbol: sym, direction: 'sell', quantity: q });
    const exitPx = parseFloat(o && (o.avgPrice || (o.order && o.order.avgPrice))) || px;
    const fee = q * exitPx * TAKER, pnl = q * (c.avg - exitPx) - fee + c.realized;
    log(`musim bear habis (hari ${Math.round(d)}) -> tutup paksa ${q} BTC @ ${fmt$(exitPx)}, PnL ${fmt$(pnl)}`);
    return { forced: await closeRec('SHORT_LADDER_WINDOW', exitPx, pnl, fee) };
  }

  // sinkron dari exchange
  if (c && posQty(sp) > 0) { c.qty = posQty(sp); c.avg = parseFloat(sp.avgPrice) || c.avg; const l = parseFloat(sp.liquidationPrice); if (l > 0) c.liq = l; c.mg = posMg(sp) || c.mg; }

  // TP
  if (c && c.qty > 0) {
    const fee = c.qty * px * TAKER, pnl = c.qty * (c.avg - px) - fee + c.realized;
    if (pnl >= c.putIn * cfg.tpPct / 100) {
      const o = await ex.emergencyCloseMarket({ symbol: sym, direction: 'sell', quantity: c.qty });
      const exitPx = parseFloat(o && (o.avgPrice || (o.order && o.order.avgPrice))) || px;
      const fee2 = c.qty * exitPx * TAKER, pnl2 = c.qty * (c.avg - exitPx) - fee2 + c.realized;
      log(`TP short ${c.signalId}: ${c.n} tangga, untung ${fmt$(pnl2)}`);
      return { tp: await closeRec('SHORT_LADDER_TP', exitPx, pnl2, fee2) };
    }
  }

  // buka / tambah tangga
  const wallet = await ex.getWalletBalance(cfg.marginAsset);
  const lp = await ex.getPositionBySide(sym, 'LONG').catch(() => null);
  const upnl = (p) => (p ? parseFloat(p.unrealizedProfit) || 0 : 0);
  const equity = wallet + upnl(lp) + upnl(sp), used = posMg(lp) + posMg(sp);
  const roomFor = (u) => used + u <= equity * cfg.marginCapPct / 100;
  const L = cfg.leverage;
  const want = !c ? 'open' : (px >= c.lastE * (1 + cfg.gapPct / 100) && c.putIn + c.unit <= c.cap * 1.0001 ? 'add' : null);
  if (!want) { deps.save(); return { idle: 'nunggu', day: Math.round(d) }; }
  const unit = c ? c.unit : wallet * cfg.betPct / 100;
  if (!roomFor(unit)) {
    if (!j.alerts.cap || now - j.alerts.cap > 24 * 3600e3) { j.alerts.cap = now; log(`tangga short ditahan: margin long+short ${fmt$(used)} + ${fmt$(unit)} > ${cfg.marginCapPct}% ekuitas ${fmt$(equity)}`); }
    deps.save(); return { idle: 'batas margin 70%' };
  }
  const info = await ex.getSymbolInfo(sym);
  if (unit * L < Math.max(info.minNotionalUsd || 0, px * info.stepSize) * 1.05) { deps.save(); return { idle: 'saldo kekecilan' }; }
  if (!c) { await ex.setIsolatedMargin(sym).catch((e) => log(`set isolated: ${e.message}`)); await ex.setLeverage(sym, L, 'SHORT').catch((e) => log(`set leverage: ${e.message}`)); }
  const o = await ex.placeMarketEntry({ symbol: sym, direction: 'sell', notionalUsd: unit * L, livePrice: px });
  const fillPx = parseFloat(o.avgPrice) || px, fillQty = parseFloat(o.executedQty) || unit * L / px;
  if (!c) {
    const id = `S${new Date(now).toISOString().slice(0, 10).replace(/-/g, '')}${String(j.stats.cycles + 1).padStart(2, '0')}`;
    j.cycle = c = { id, signalId: id, startedAt: now, halving: hk, cap: wallet, unit, putIn: unit, n: 1, lastE: fillPx, avg: fillPx, qty: fillQty, mg: unit, realized: 0, liq: fillPx * (1 + 1 / L - 0.005) };
  } else {
    c.avg = (c.avg * c.qty + fillPx * fillQty) / (c.qty + fillQty); c.qty += fillQty; c.putIn += unit; c.n += 1; c.lastE = fillPx; c.mg += unit;
  }
  const p2 = await ex.getPositionBySide(sym, 'SHORT').catch(() => null);
  if (p2) { const l = parseFloat(p2.liquidationPrice); if (l > 0) c.liq = l; c.avg = parseFloat(p2.avgPrice) || c.avg; }
  deps.save();
  const tpPx = c.avg - (c.putIn * cfg.tpPct / 100 - c.realized) / c.qty;
  const reason = `Musim BEAR (hari ke-${Math.round(d)} sejak halving, jendela ${cfg.winFrom}-${cfg.winTo}). Tangga #${c.n}: ${cfg.betPct}% saldo awal siklus, 1x isolated${c.n > 1 ? `, BTC naik ${cfg.gapPct}% dari entry terakhir` : ''}. Target untung ${cfg.tpPct}% total masuk (${fmt$(c.putIn * cfg.tpPct / 100)}) @ ${fmt$(tpPx)}. Total margin long+short ${((used + unit) / equity * 100).toFixed(0)}% (maks ${cfg.marginCapPct}%).`;
  log(`${want === 'open' ? 'BUKA' : 'TAMBAH'} short tangga #${c.n}: ${fillQty} BTC @ ${fmt$(fillPx)} (margin ${fmt$(unit)})`);
  const D = require('./darkKaelaLog');
  await deps.notify(want === 'open'
    ? D.formatAutoOpen({ id: c.id, signalId: c.signalId, direction: 'sell', entryPrice: fillPx, marginUsd: unit, leverage: L, nilaiPosisi: fillQty * fillPx, tpText: fmt$(tpPx), slText: `tanpa SL -- tutup paksa akhir musim bear (hari ${cfg.winTo})`, liquidationNote: fmt$(c.liq), assetLabel: sym.replace('-', ''), reasonText: reason }, new Date(now), '', !!deps.isDemo, null, '', null, D.EXCHANGE_BADGE.bingx, D.SYSTEM_LABEL.SHORTLADDER)
    : D.formatAutoAddLayer({ id: c.id, signalId: c.signalId, layers: c.n, entryPrice: c.avg, marginUsd: c.putIn, leverage: L, nilaiPosisi: c.qty * c.avg, assetLabel: sym.replace('-', ''), reasonText: reason }, new Date(now), !!deps.isDemo, null, null, D.EXCHANGE_BADGE.bingx, D.SYSTEM_LABEL.SHORTLADDER));
  return { [want === 'open' ? 'opened' : 'added']: { n: c.n, qty: fillQty, px: fillPx, tpPx } };
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.enabled) return;
  const j = loadJournal();
  const { createBingxClient, loadSecrets } = require('./bingxExecutor');
  const s = loadSecrets();
  const exec = s.BINGX_API_KEY ? createBingxClient({ apiKey: s.BINGX_API_KEY, apiSecret: s.BINGX_API_SECRET, testnet: DEMO }) : null;
  const deps = {
    cfg, journal: j, exec, isDemo: DEMO,
    price: async () => { const r = await (await fetch(`https://open-api.bingx.com/openApi/swap/v2/quote/price?symbol=${cfg.symbol}`, { signal: AbortSignal.timeout(8000) })).json(); return parseFloat(r && r.data && r.data.price); },
    notify: async (m) => {
      if (DEMO) { try { const { toSniperClubLink } = require('./darkKaelaLog'); await require('./fonnte').sendWhatsAppToSniperClub(toSniperClubLink(m)); } catch (e) { console.log('[ShortLadder] WA Sniper Club gagal:', e.message); } }
      try { await require('./wibowoNotify').sendWhatsAppToWibowo(m); } catch (e) { console.log('[ShortLadder] WA Wibowo gagal:', e.message); }
    },
    alert: async (m, kind) => { const a = j.alerts || (j.alerts = {}); if (a[kind] && Date.now() - a[kind] < 6 * 3600e3) return; a[kind] = Date.now(); try { await require('./fonnte').sendWhatsApp(`${DEMO ? '(Demo) ' : ''}${m}\n\n— Kaela`, OLAN_PRIBADI); } catch (e) { console.log('[ShortLadder] WA gagal:', e.message); } },
    log: (m) => console.log(`[${new Date().toISOString()}] [ShortLadder${DEMO ? ' demo' : ''}] ${m}`),
    save: () => fs.writeFileSync(JOURNAL_PATH, JSON.stringify(j, null, 2)),
  };
  try { const r = await runOnce(deps); if (r && r.idle === 'di luar musim bear' && (!j.lastIdleLog || Date.now() - j.lastIdleLog > 7 * 864e5)) { j.lastIdleLog = Date.now(); deps.log(`siaga -- hari ke-${r.day} sejak halving, musim bear berikutnya mulai ${fmtD(nextWindowStart(cfg.winFrom, cfg.winTo))} (hari ${cfg.winFrom} sejak halving)`); deps.save(); } }
  catch (e) { deps.log(`GAGAL: ${e.message}`); await deps.alert(`⚠️ Tangga SHORT error: ${e.message}`, `err:${String(e.message).slice(0, 40)}`); deps.save(); process.exitCode = 1; }
}
if (require.main === module) main();
module.exports = { runOnce, freshJournal, loadConfig };
