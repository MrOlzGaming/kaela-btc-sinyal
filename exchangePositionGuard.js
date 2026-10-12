// exchangePositionGuard.js (12 Okt 2026) -- 🚫 PENUTUP POSISI ASING buat exchange yang BELUM dijaga: 🟠 Bybit (demo+real) & 🟢 Bitget (real).
// Olan: "tiap exchange yang ngerjain ini juga kasih keamanan biar aku ga buka apapun posisi di futures". Aturan & mesin SAMA PERSIS
// bingxPositionGuard.js (guardAccount): posisi diizinkan kalau cocok jurnal sistem Kaela ATAU order pembukanya bertag kaela-;
// asing -> ditutup setelah kebaca asing 2x berturut (>= 50 detik), lapor ke grup Wibowo. Exchange lain udah dijaga: BingX =
// bingxPositionGuard.js, Binance & MEXC = positionReconciler.js (auto-close posisi manual sejak 19 Sep 2026).
// Sistem Kaela di exchange ini: Bybit = 🏹 Ranger Rotasi (ranger-rotation-journal.json, kalau config exchange 'bybit');
// Bitget = 🥇 leg FixedTP Emas twin (gold-twin-position-journal.json, execMode 'bitget-real').
// Saklar: exchange-guard-config.json. Uji: node exchangePositionGuard.selftest.js (exchange palsu).
const fs = require('fs');
const path = require('path');
const { guardAccount } = require('./bingxPositionGuard');
const STATE_PATH = path.join(__dirname, 'exchange-guard-state.json');
const CONFIG_PATH = path.join(__dirname, 'exchange-guard-config.json');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8')); } catch { return null; } };
const sideOf = (dir) => (String(dir || '').toLowerCase().startsWith('s') ? 'SHORT' : 'LONG');

// bentuk posisi per exchange -> { symbol, side, qty, upnl }
const NORM = {
  bybit: (p) => ({ symbol: p.symbol, side: p.side === 'Sell' ? 'SHORT' : 'LONG', qty: Math.abs(parseFloat(p.size)) || 0, upnl: p.unrealisedPnl }),
  bitget: (p) => ({ symbol: p.symbol, side: String(p.holdSide || '').toLowerCase() === 'short' ? 'SHORT' : 'LONG', qty: Math.abs(parseFloat(p.total)) || 0, upnl: p.unrealizedPL }),
};

// posisi milik Kaela per exchange: [{ mode, symbol, side, qty|null, owner }]
function kaelaPositions(exchange, read = readJson) {
  const out = [];
  if (exchange === 'bybit') {
    const rcfg = read('ranger-rotation-config.json') || {};
    const f = (read('ranger-rotation-journal.json') || {}).floating;
    if ((rcfg.exchange || 'bybit') === 'bybit' && f && f.coin && f.legs) for (const mode of ['demo', 'real']) {
      const L = f.legs[mode]; if (L) out.push({ mode, symbol: `${f.coin}USDT`, side: sideOf(f.direction), qty: L.remainingQty != null ? Number(L.remainingQty) : (L.qty != null ? Number(L.qty) : null), owner: '🏹 Ranger Rotasi' });
    }
  }
  if (exchange === 'bitget') {
    const g = read('gold-twin-position-journal.json') || {};
    for (const sys of ['ranger', 'sniper']) {
      const f = g[sys] && g[sys].floating;
      if (f && f.fixedTp && f.fixedTp.execMode === 'bitget-real') out.push({ mode: 'real', symbol: f.fixedTp.symbol || 'PAXGUSDT', side: sideOf(f.direction), qty: null, owner: `🥇 Emas twin (${sys})` });
    }
  }
  return out;
}

function venues(cfg) {
  const out = [];
  const on = (ex, mode) => (cfg[ex] || []).includes(mode);
  const { loadSecrets: bybitSecrets, createBybitClient } = require('./bybitExecutor');
  const by = bybitSecrets();
  if (on('bybit', 'demo') && by.BYBIT_API_KEY_DEMO) out.push({ exchange: 'bybit', mode: 'demo', exec: createBybitClient({ apiKey: by.BYBIT_API_KEY_DEMO, apiSecret: by.BYBIT_API_SECRET_DEMO, testnet: true }) });
  if (on('bybit', 'real') && by.BYBIT_API_KEY) out.push({ exchange: 'bybit', mode: 'real', exec: createBybitClient({ apiKey: by.BYBIT_API_KEY, apiSecret: by.BYBIT_API_SECRET, testnet: false }) });
  const { loadSecrets: bitgetSecrets, createBitgetClient } = require('./bitgetExecutor');
  const bg = bitgetSecrets();
  if (on('bitget', 'real') && bg.BITGET_API_KEY) out.push({ exchange: 'bitget', mode: 'real', exec: createBitgetClient({ apiKey: bg.BITGET_API_KEY, apiSecret: bg.BITGET_API_SECRET, passphrase: bg.BITGET_API_PASSPHRASE, testnet: false }) });
  return out;
}

async function main() {
  let cfg = { enabled: true, bybit: ['demo', 'real'], bitget: ['real'], dryRun: false };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; } catch {}
  if (!cfg.enabled) return;
  let state = {}; try { state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch {}
  const save = () => fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  const alert = async (msg) => { try { await require('./wibowoNotify').sendWhatsAppToWibowo(`${msg}\n\n— Kaela`); } catch (e) { console.log('[ExchangeGuard] WA grup gagal:', e.message); } };
  for (const v of venues(cfg)) {
    const label = v.exchange === 'bybit' ? 'Bybit' : 'Bitget';
    const st = state[v.exchange] || (state[v.exchange] = {});
    try { await guardAccount({ mode: v.mode, exec: v.exec, owned: kaelaPositions(v.exchange), state: st, now: Date.now(), alert, save, dryRun: cfg.dryRun, norm: NORM[v.exchange], exLabel: label, log: (m) => console.log(`[${new Date().toISOString()}] [ExchangeGuard ${label}] ${m}`) }); }
    catch (e) { console.log(`[ExchangeGuard ${label}] ${v.mode} error: ${e.message}`); }
  }
}

if (require.main === module) main();
module.exports = { kaelaPositions, NORM };
