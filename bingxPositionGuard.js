// bingxPositionGuard.js (11 Okt 2026) -- 🚫 PENUTUP POSISI ASING di BingX Perpetual (demo + real).
// Aturan Olan: "Apapun posisi yang dibuka bukan Kaela, posisi itu ditutup paksa.. Olan tidak boleh trading, semua akun trading Olan
// dikelola Kaela 100%." Latar belakang: Olan sendiri yang minta -- gak disiplin, suka revenge trading, pernah hilang ±Rp100 juta
// (±$7.600) karena trading sendiri. "Jangan salah tutup posisi."
//
// Posisi DIIZINKAN (gak disentuh) kalau salah satu:
//   1. cocok sama jurnal sistem Kaela yang lagi pegang posisi (Farmer real/demo, Ninja MR/Exhaustion/News, Channel Breakout, Ranger
//      Rotasi kalau exchange-nya BingX) -- simbol + arah, dan qty-nya gak lebih dari jurnal (kelebihan = ditambahin Olan -> dipotong).
//   2. ATAU order pembuka terakhir simbol itu bertag clientOrderId Kaela ("kaela-...", wasLastEntryOrderByKaela).
// Posisi asing ditutup baru kalau KEBACA ASING 2x berturut2 (jarak >= 50 detik) -- jaga2 sistem Kaela lain lagi di tengah buka posisi.
// Cuma Perpetual Futures (swap). Standard Futures / spot gak disentuh. Tiap penutupan: lapor ke grup Wibowo Hedgefund + log. Saklar: bingx-guard-config.json.
// Uji: node bingxPositionGuard.selftest.js (exchange palsu).

const fs = require('fs');
const path = require('path');
const STATE_PATH = path.join(__dirname, 'bingx-guard-state.json');
const CONFIG_PATH = path.join(__dirname, 'bingx-guard-config.json');

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8')); } catch { return null; } };
const sideOf = (dir) => (String(dir || '').toLowerCase().startsWith('s') ? 'SHORT' : 'LONG');

// Daftar posisi milik Kaela dari jurnal: [{ mode, symbol, side, qty|null, owner }]
function kaelaPositionsFromJournals(read = readJson) {
  const out = [];
  for (const [file, mode, cfgFile] of [['grid-journal.json', 'real', 'grid-config.json'], ['grid-demo-journal.json', 'demo', 'grid-demo-config.json']]) {
    const j = read(file), cfg = read(cfgFile) || {};
    const c = j && j.cycle;
    if (c && (c.pos || c.guard)) out.push({ mode, symbol: cfg.symbol || (mode === 'demo' ? 'BTC-USDT' : 'BTC-USDC'), side: 'LONG', qty: c.pos ? c.pos.qty : (c.guard ? c.guard.qty : null), owner: '🌾 Farmer' });
  }
  for (const [file, mode, cfgFile] of [['short-ladder-journal.json', 'real', 'short-ladder-config.json'], ['short-ladder-demo-journal.json', 'demo', 'short-ladder-demo-config.json']]) { // 🐻 Farmer Short (11 Okt 2026)
    const c = (read(file) || {}).cycle, cfg = read(cfgFile) || {};
    if (c) out.push({ mode, symbol: cfg.symbol || (mode === 'demo' ? 'BTC-USDT' : 'BTC-USDC'), side: 'SHORT', qty: c.qty || null, owner: '🐻 Farmer Short' });
  }
  for (const [file, owner] of [['ninja-mr-exec-journal.json', '🥷 Ninja MR'], ['ninja-exhaustion-journal.json', '🥷 Ninja Exhaustion'], ['ninja-news-journal.json', '🥷 Ninja News']]) {
    const f = (read(file) || {}).floating;
    if (f && f.legs) for (const mode of ['demo', 'real']) { const L = f.legs[mode]; if (L && !L.closedAt) out.push({ mode, symbol: f.symbol || 'BTC-USDT', side: sideOf(f.dir || L.direction), qty: null, owner }); }
  }
  const cb = read('channel-breakout-journal.json') || {};
  for (const k of ['tpFixed', 'trailing', 'floating']) { const f = k === 'floating' ? cb.floating : cb[k] && cb[k].floating; if (f) out.push({ mode: f.mode || 'real', symbol: f.symbol || 'BTC-USDT', side: sideOf(f.direction), qty: null, owner: '🥷 Channel Breakout' }); }
  const rcfg = read('ranger-rotation-config.json') || {};
  if (rcfg.exchange === 'bingx') { const f = (read('ranger-rotation-journal.json') || {}).floating; if (f && f.coin) out.push({ mode: 'demo', symbol: `${f.coin}-USDT`, side: sideOf(f.direction), qty: null, owner: '🏹 Ranger Rotasi' }); }
  return out;
}

// 1 putaran untuk 1 akun (mode). deps: { mode, exec, owned:[...], state, now, log, alert, save, dryRun }
async function guardAccount(deps) {
  const { mode, exec, state, now } = deps;
  const log = deps.log || ((m) => console.log(`[BingxGuard] ${m}`));
  // (12 Okt 2026) dipakai ulang buat Bybit/Bitget (exchangePositionGuard.js): deps.norm = bentuk posisi per exchange, deps.exLabel = nama
  const norm = deps.norm || ((p) => ({ symbol: p.symbol, side: p.positionSide === 'SHORT' ? 'SHORT' : 'LONG', qty: Math.abs(parseFloat(p.positionAmt)), upnl: p.unrealizedProfit }));
  const EX = deps.exLabel || 'BingX';
  const positions = ((await exec.getAllPositions()) || []).filter((p) => norm(p).qty > 0);
  const seen = state.suspects || (state.suspects = {});
  const results = [];
  const liveKeys = new Set();
  for (const p of positions) {
    const { symbol, side, qty, upnl } = norm(p);
    const key = `${mode}|${symbol}|${side}`; liveKeys.add(key);
    const own = deps.owned.find((o) => o.mode === mode && o.symbol === symbol && o.side === side);
    let unwantedQty = 0, why = '';
    if (own) {
      if (own.qty != null && qty > own.qty * 1.02 + 1e-9) { unwantedQty = qty - own.qty; why = `qty ${qty} lebih dari jurnal ${own.owner} (${own.qty}) -- kelebihan ditambah di luar sistem`; }
    } else {
      const byKaela = await exec.wasLastEntryOrderByKaela(symbol).catch(() => null);
      if (byKaela === true) { delete seen[key]; continue; } // order pembukanya bertag Kaela -> punya Kaela
      if (byKaela === null) { log(`${key}: riwayat order gak kebaca -- dianggap asing kalau tetap gak cocok jurnal`); }
      unwantedQty = qty; why = 'bukan posisi sistem Kaela (gak ada di jurnal, order pembuka bukan Kaela)';
    }
    if (!(unwantedQty > 0)) { delete seen[key]; continue; }
    const first = seen[key];
    if (!first || now - first.at < 50e3) { // konfirmasi 2x dulu
      if (!first) seen[key] = { at: now, qty };
      log(`${key}: CURIGA asing (${why}) -- dicek ulang siklus berikutnya sebelum ditutup`);
      results.push({ key, pending: true }); continue;
    }
    if (deps.dryRun) { results.push({ key, wouldClose: unwantedQty }); continue; }
    const info = exec.getSymbolInfo ? await exec.getSymbolInfo(symbol).catch(() => null) : null;
    const closeQty = info && exec.roundToStepSize ? exec.roundToStepSize(unwantedQty, info.stepSize, info.quantityPrecision) : unwantedQty;
    try {
      const o = await exec.emergencyCloseMarket({ symbol, direction: side === 'SHORT' ? 'sell' : 'buy', quantity: closeQty });
      const order = o && o.order ? o.order : o;
      delete seen[key];
      const pnlTxt = upnl != null ? ` (PnL ±${Number(upnl).toFixed(2)})` : '';
      log(`DITUTUP PAKSA ${key} ${closeQty}${pnlTxt} -- ${why}`);
      (state.history = state.history || []).push({ at: now, mode, symbol, side, qty: closeQty, why, orderId: order && order.orderId });
      if (state.history.length > 300) state.history = state.history.slice(-300);
      await deps.alert(`🚫 Posisi di luar sistem ditutup -- ${EX} ${mode === 'demo' ? '(Demo)' : '(Real)'}\n\n${symbol} ${side} ${closeQty}${pnlTxt}\nAlasan: ${why}.\n\nAturan: semua akun trading dikelola Kaela 100%, posisi yang bukan dibuka sistem Kaela ditutup otomatis.`);
      results.push({ key, closed: closeQty });
    } catch (e) {
      log(`GAGAL nutup ${key}: ${e.message}`);
      await deps.alert(`⚠️ Kaela gagal nutup posisi asing ${EX} ${mode}: ${symbol} ${side} ${closeQty} -- ${e.message}. Dicoba lagi tiap menit.`);
      results.push({ key, error: e.message });
    }
  }
  for (const k of Object.keys(seen)) if (k.startsWith(`${mode}|`) && !liveKeys.has(k)) delete seen[k]; // posisi udah gak ada
  deps.save && deps.save();
  return results;
}

async function main() {
  let cfg = { enabled: true, modes: ['demo', 'real'], dryRun: false };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; } catch {}
  if (!cfg.enabled) return;
  const { createBingxClient, loadSecrets } = require('./bingxExecutor');
  const s = loadSecrets();
  if (!s.BINGX_API_KEY || !s.BINGX_API_SECRET) return;
  let state = {}; try { state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch {}
  const save = () => fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  const owned = kaelaPositionsFromJournals();
  // (11 Okt 2026, Olan) laporan penutupan ke GRUP Wibowo Hedgefund, bukan DM
  const alert = async (msg) => { try { await require('./wibowoNotify').sendWhatsAppToWibowo(`${msg}\n\n— Kaela`); } catch (e) { console.log('[BingxGuard] WA grup gagal:', e.message); } };
  for (const mode of cfg.modes) {
    const exec = createBingxClient({ apiKey: s.BINGX_API_KEY, apiSecret: s.BINGX_API_SECRET, testnet: mode === 'demo' });
    try { await guardAccount({ mode, exec, owned, state, now: Date.now(), alert, save, dryRun: cfg.dryRun, log: (m) => console.log(`[${new Date().toISOString()}] [BingxGuard] ${m}`) }); }
    catch (e) { console.log(`[BingxGuard] ${mode} error: ${e.message}`); }
  }
}

if (require.main === module) main();
module.exports = { guardAccount, kaelaPositionsFromJournals };
