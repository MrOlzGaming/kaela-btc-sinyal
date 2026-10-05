// tradeLedger.js (5 Okt 2026, permintaan Olan: "kamu harus punya catatan sendiri walau aku ga lapor-lapor, catatan otomatis buat
// di-review kapan pun.. tiap metode dan cara/alasan entri").
//
// BUKU BESAR TERPADU semua trade Kaela (Sniper / Ranger / Ninja, demo & real, semua exchange) -- MURNI BACA jurnal tiap sistem,
// gak nyentuh jalur trading sama sekali (gagal di sini gak bisa ganggu order apapun). Jalan tiap siklus eksekutor 15 menit.
// Output (git-tracked lewat STATE_FILES, jadi awet & bisa dibaca sesi Kaela manapun / Olan lewat GitHub):
//   trade-ledger.json  -- semua trade, format seragam (buat mesin / analisa)
//   TRADE-LEDGER.md    -- ringkasan per metode + posisi terbuka + trade terakhir lengkap alasan buka & tutup (buat dibaca)
// Alasan buka/tutup pakai label YANG SAMA PERSIS sama pesan WA (darkKaelaLog patternReason / CLOSE_REASON_LABEL).
// Trade yang tutup SEBELUM jurnalnya nyimpen riwayat (mis. Ninja MR #2026100501) dipulihin dari trade-ledger-seed.json.
//
// Pakai: node tradeLedger.js            (sumber & output = folder ini)
//        LEDGER_SRC=<dir> LEDGER_OUT=<dir> node tradeLedger.js   (buat tes pakai salinan jurnal)
const fs = require('fs');
const path = require('path');
const { patternReason, CLOSE_REASON_LABEL } = require('./darkKaelaLog');

const SRC = process.env.LEDGER_SRC || __dirname;
const OUT = process.env.LEDGER_OUT || __dirname;
const OLAN = '6281299303888';

const readJson = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(SRC, rel), 'utf8')); } catch { return null; } };
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const iso = (v) => { if (v === null || v === undefined || v === '') return null; const d = new Date(typeof v === 'number' || /^\d+$/.test(String(v)) ? Number(v) : v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
const dirOf = (d) => (d === null || d === undefined || d === '' ? null : String(d).toLowerCase() === 'long' || String(d).toLowerCase() === 'buy' ? 'LONG' : 'SHORT'); // arah gak dicatat -> null (bukan nebak), 5 Okt 2026

const SYSTEM = { sniper: '🎯 Sniper', ranger: '🏹 Ranger', ninja: '🥷 Ninja' };
const EXCHANGE = { binance: 'Binance', mexc: 'MEXC', bingx: 'BingX', bybit: 'Bybit', bitget: 'Bitget' };

// posisi yang diadopsi (manual Olan / nyasar di exchange, bukan sinyal Kaela) -- patternType 'unknown'/'manual'/kosong
const isAdopted = (p) => !p || p === 'unknown' || p === 'manual';
function reasonOpen(patternType) { if (isAdopted(patternType)) return 'Posisi manual / diadopsi dari exchange (bukan sinyal otomatis Kaela)'; const t = patternReason(patternType); return t || String(patternType); }
// kode tutup lama yang belum ada di CLOSE_REASON_LABEL
const EXTRA_CLOSE = { OFFLINE_UNKNOWN: 'Posisi udah gak ada di exchange tanpa jejak (offline / ditutup manual) -- PnL gak kebaca', UNTRACKED: 'Ditutup di luar pantauan Kaela -- PnL gak kebaca', OFFLINE: 'Posisi udah tutup pas mesin offline -- PnL dari riwayat exchange' };
function reasonClose(code) { if (!code) return null; return CLOSE_REASON_LABEL[code] || EXTRA_CLOSE[code] || String(code); }

// leg apapun -> angka seragam (tiap sistem namain field beda dikit)
function legNums(L) {
  const legPnl = num(L.legPnlUsd);
  const partial = (num(L.partialPnlUsd) || 0) + (num(L.realizedPnlUsd) || 0);
  let net = num(L.netUsd);
  if (net === null) net = num(L.pnlUsd);
  if (net === null && legPnl !== null) net = legPnl + partial;
  return {
    entry: num(L.entryPrice) || null, exit: num(L.exitPrice) || null, sl: num(L.sl !== undefined ? L.sl : L.currentSl) || null, // 0 = gak diketahui
    qty: num(L.qty !== undefined ? L.qty : L.quantity), leverage: num(L.leverage), marginUsd: num(L.marginUsd !== undefined ? L.marginUsd : L.margin),
    grossUsd: num(L.grossUsd), feeUsd: num(L.feeUsd), netUsd: net,
    reasonCode: L.exitReason || L.closeReason || L.reason || null,
    openedAt: iso(L.openedAt), closedAt: iso(L.closedAt),
  };
}

function rec(base, L, extra = {}) {
  const n = legNums(L);
  const closed = !!n.closedAt;
  return {
    key: `${base.systemKey}|${base.id}|${base.mode}`,
    system: SYSTEM[base.systemKey], systemKey: base.systemKey, id: base.id, signalId: base.signalId || null,
    account: base.account, mode: base.mode, exchange: EXCHANGE[base.exchange] || base.exchange, asset: base.asset || 'BTC',
    patternType: base.patternType || null, direction: dirOf(base.direction),
    entry: n.entry, sl: n.sl !== null ? n.sl : num(base.sl), exit: n.exit, qty: n.qty, leverage: n.leverage, marginUsd: n.marginUsd,
    openedAt: n.openedAt || iso(base.openedAt), closedAt: n.closedAt,
    status: closed ? 'tutup' : 'terbuka',
    grossUsd: n.grossUsd, feeUsd: n.feeUsd,
    // PnL 0 + tanpa harga keluar + kode tutup "gak kebaca" = sebenernya GAK DIKETAHUI, bukan impas
    netUsd: !closed ? null : (n.exit === null && n.netUsd === 0 && /UNKNOWN|UNTRACKED/.test(String(n.reasonCode)) ? null : n.netUsd),
    reasonOpen: base.reasonText || reasonOpen(base.patternType), reasonCloseCode: n.reasonCode, reasonClose: closed ? reasonClose(n.reasonCode) : null,
    ...extra,
  };
}
const acct = (mode) => (mode === 'real' ? 'Kaela Real' : 'Kaela Demo');
// Konteks entry LENGKAP (5 Okt, Olan: "rapi dan lengkap.. review & update gak kekurangan data") -- semua field primitif yang dicatat
// sistem di posisi/order (SMA20 pas sinyal, jarak SL, slot, rute Wibowo, besar likuidasi, dll), tanpa leg/riwayat bersarang.
const CTX_SKIP = new Set(['demo', 'real', 'legs', 'history', 'notified', 'liveExecution']);
function ctxOf(o) { const c = {}; for (const [k, v] of Object.entries(o || {})) if (!CTX_SKIP.has(k) && v !== null && v !== undefined && ['string', 'number', 'boolean'].includes(typeof v)) c[k] = v; return c; }

function collect() {
  const out = [];
  // 🎯 Sniper BTC dual-exec (Binance) -- orders{} nyimpen semua (termasuk yang udah tutup)
  const sj = readJson('sniper-btc-dual-exec-journal.json');
  if (sj && sj.orders) for (const [id, o] of Object.entries(sj.orders)) for (const mode of ['demo', 'real']) {
    if (o[mode]) out.push(rec({ systemKey: 'sniper', id, signalId: o.signalId, account: acct(mode), mode, exchange: 'binance', patternType: o.patternType, direction: o.direction, sl: o.sl }, o[mode], { context: ctxOf(o) }));
  }
  // 🎯 Sniper non-BTC (Emas, jalur lama sniper-orders.json -- BTC udah lewat dual-exec di atas, gak dobel)
  const so = readJson('sniper-orders.json');
  for (const o of (so && so.orders) || []) {
    if (String(o.asset || 'btc') === 'btc' || !o.liveExecution) continue;
    const mode = o.liveExecution.testnet ? 'demo' : 'real';
    out.push(rec({ systemKey: 'sniper', id: o.id, signalId: o.signalId, account: acct(mode), mode, exchange: o.exchange || 'mexc', asset: 'Emas', patternType: o.patternType, direction: o.direction, sl: o.sl, openedAt: o.triggeredAt },
      { entryPrice: o.entryPrice, exitPrice: o.exitPrice, pnlUsd: o.pnlUsd, closeReason: o.closeReason, openedAt: o.triggeredAt, closedAt: o.closedAt, leverage: o.leverage }, { context: ctxOf(o) }));
  }
  // 🏹 Ranger BTC dual-exec (Binance USDC) -- 3 slot, floating + history (history mulai 5 Okt)
  const rj = readJson('ranger-btc-dual-exec-journal.json');
  if (rj) for (const slotKey of ['pattern', 'fvg', 'sweep']) {
    const slot = rj[slotKey]; if (!slot) continue;
    for (const f of [slot.floating, ...(slot.history || [])].filter(Boolean)) for (const mode of ['demo', 'real']) {
      if (f[mode]) out.push(rec({ systemKey: 'ranger', id: f.id, signalId: f.signalId, account: acct(mode), mode, exchange: 'binance', patternType: f.patternType, direction: f.direction, sl: f.sl }, f[mode], { slot: slotKey, context: ctxOf(f) }));
    }
  }
  // 🏹 Ranger Rotasi 8 koin (Bybit)
  const rr = readJson('ranger-rotation-journal.json');
  if (rr) for (const f of [rr.floating, ...(rr.history || [])].filter(Boolean)) for (const mode of ['demo', 'real']) {
    const L = f.legs && f.legs[mode]; if (!L) continue;
    out.push(rec({ systemKey: 'ranger', id: f.id, signalId: f.signalId, account: acct(mode), mode, exchange: 'bybit', asset: f.coin, patternType: f.patternType, direction: f.direction, sl: f.sl, openedAt: f.openedAt }, L, { slot: 'rotasi', context: ctxOf(f) }));
  }
  // 🏹 Ranger jalur lama: akun demo default Kaela (Fed Dovish Grid, econ scalp, dll) + akun REAL Olan
  const legacy = [['nyopet-journal.json', 'Kaela Demo', 'demo']];
  try { for (const f of fs.readdirSync(path.join(SRC, 'multi-account-state'))) { const m = f.match(new RegExp(`^${OLAN}-(real|demo)-nyopet\\.json$`)); if (m) legacy.push([`multi-account-state/${f}`, m[1] === 'real' ? 'Olan Real' : 'Olan Demo', m[1]]); } } catch { /* folder gak ada */ }
  for (const [file, account, mode] of legacy) {
    const j = readJson(file);
    for (const o of (j && j.orders) || []) {
      if (!o || !o.id) continue;
      const closed = o.status && o.status !== 'floating';
      out.push(rec({ systemKey: 'ranger', id: o.id, signalId: o.signalId, account, mode, exchange: o.exchange || (o.asset === 'xau' ? 'mexc' : 'binance'), asset: o.asset === 'xau' ? 'Emas' : 'BTC', patternType: o.patternType, direction: o.direction, sl: o.sl, openedAt: o.triggeredAt },
        { entryPrice: o.entryPrice, exitPrice: o.exitPrice, pnlUsd: o.pnlUsd !== undefined ? o.pnlUsd : o.realizedPnlUsd, closeReason: o.closeReason || (o.status === 'closed_untracked' ? 'UNTRACKED' : null), openedAt: o.triggeredAt, closedAt: closed ? (o.closedAt || o.updatedAt || o.triggeredAt) : null, leverage: o.leverage, marginUsd: o.marginUsd }, { legacyFile: file, context: ctxOf(o) }));
    }
  }
  // 🥷 Ninja Mean Reversion (BingX) -- floating + history (history mulai 5 Okt)
  const mr = readJson('ninja-mr-exec-journal.json');
  if (mr) for (const f of [mr.floating, ...(mr.history || [])].filter(Boolean)) for (const mode of ['demo', 'real']) {
    const L = f.legs && f.legs[mode]; if (!L) continue;
    out.push(rec({ systemKey: 'ninja', id: f.id, signalId: f.signalId, account: acct(mode), mode, exchange: 'bingx', patternType: 'mean_reversion', direction: f.dir, openedAt: f.openedAt }, L, { context: ctxOf(f) }));
  }
  // 🥷 Ninja Exhaustion & News (BingX) -- history (detail lengkap mulai 5 Okt) + posisi yang lagi jalan
  for (const [file, pt] of [['ninja-exhaustion-journal.json', 'exhaustion_fade'], ['ninja-news-journal.json', 'news_dxy']]) {
    const j = readJson(file); if (!j) continue;
    for (const h of j.history || []) {
      out.push(rec({ systemKey: 'ninja', id: h.id || `${pt}-${h.at}`, signalId: h.signalId, account: acct(h.mode), mode: h.mode, exchange: 'bingx', patternType: pt, direction: h.dir || null, openedAt: h.openedAt, reasonText: h.reasonText },
        { entryPrice: h.entry, exitPrice: h.exit, sl: h.sl, netUsd: h.net, grossUsd: h.grossUsd, feeUsd: h.feeUsd, exitReason: h.reason, openedAt: h.openedAt, closedAt: h.at }, { ...(h.label ? { event: h.label } : {}), context: ctxOf(h) }));
    }
    const f = j.floating;
    if (f && f.legs) for (const mode of ['demo', 'real']) if (f.legs[mode] && !f.legs[mode].closedAt) {
      out.push(rec({ systemKey: 'ninja', id: f.id, signalId: f.signalId, account: acct(mode), mode, exchange: 'bingx', patternType: pt, direction: f.dir, openedAt: f.openedAt, reasonText: f.reasonText }, f.legs[mode], { context: ctxOf(f) }));
    }
  }
  // Trade yang tutup sebelum jurnalnya nyimpen riwayat (dipulihin manual dari pesan WA -- ditandai `seed`)
  const seed = readJson('trade-ledger-seed.json');
  for (const r of (seed && seed.trades) || []) out.push({ ...r, seed: true });
  // dedup (key sama -> yang paling lengkap/terbaru menang, seed kalah sama data jurnal asli)
  const byKey = new Map();
  for (const r of out) { const prev = byKey.get(r.key); if (!prev || (prev.seed && !r.seed) || (!prev.closedAt && r.closedAt)) byKey.set(r.key, r); }
  // Tambalan (5 Okt 2026): trade dari jurnal LAMA yang riwayatnya cuma {at, net} -- field yang KOSONG diisi dari log/pesan WA
  // (seed.patches[{key, set}]). Gak pernah nimpa data jurnal yang udah ada.
  for (const p of (seed && seed.patches) || []) {
    const r = byKey.get(p.key); if (!r) continue;
    for (const [k, v] of Object.entries(p.set || {})) if (r[k] === null || r[k] === undefined) r[k] = v;
    if (p.set && p.set.reasonCloseCode && !r.reasonClose) r.reasonClose = reasonClose(p.set.reasonCloseCode);
    r.patched = true;
  }
  const recs = [...byKey.values()];
  for (const r of recs) fillPnlFromIncome(r, recs);
  return [...byKey.values()].sort((a, b) => String(b.openedAt || '').localeCompare(String(a.openedAt || '')));
}

// PnL "gak kebaca" (posisi Olan ditutup manual pas sistem offline, 10-14 Sep) -- diisi dari riwayat income Binance yang UDAH
// tersimpan (tradeHistoryStore, multi-account-state/trade-history/, cuma ada di VPS -- gak manggil API apa pun di sini).
// Jumlah REALIZED_PNL + COMMISSION + FUNDING_FEE simbol itu di jendela buka..tutup(+15 mnt). Ditandai `pnlSource: 'income'`
// biar jelas ini rekonstruksi, bukan angka jurnal. Riwayat belum nyampe tanggal tutup / gak ada realisasi -> tetap '?'.
const INCOME_TYPES = new Set(['REALIZED_PNL', 'COMMISSION', 'FUNDING_FEE']);
const _incomeCache = {};
function incomeStore(file) {
  if (!(file in _incomeCache)) _incomeCache[file] = readJson(`multi-account-state/trade-history/${file}`);
  return _incomeCache[file];
}
function fillPnlFromIncome(r, all) {
  if (r.status !== 'tutup' || r.netUsd !== null || r.exchange !== EXCHANGE.binance || r.account !== 'Olan Real' || !r.openedAt || !r.closedAt) return;
  const store = incomeStore(`binance-${OLAN}-real.json`);
  const entries = (store && store.entries) || [];
  // jendela berhenti di buka posisi BERIKUTNYA (akun+exchange sama) biar realisasi trade lain gak kehitung dobel
  const from = Date.parse(r.openedAt);
  const nextOpen = Math.min(...all.filter((x) => x !== r && x.account === r.account && x.exchange === r.exchange && x.openedAt && Date.parse(x.openedAt) > from).map((x) => Date.parse(x.openedAt)));
  const to = Math.min(Date.parse(r.closedAt) + 15 * 60000, nextOpen);
  if (!entries.length || Math.max(...entries.map((e) => e.time)) < to) return; // riwayat belum nyampe -> gak nebak
  for (const sym of ['BTCUSDC', 'BTCUSDT']) {
    const inWin = entries.filter((e) => e.symbol === sym && e.time >= from && e.time <= to && INCOME_TYPES.has(e.type));
    if (!inWin.some((e) => e.type === 'REALIZED_PNL' && e.amount !== 0)) continue;
    const sum = (t) => inWin.filter((e) => e.type === t).reduce((a, e) => a + e.amount, 0);
    r.grossUsd = sum('REALIZED_PNL'); r.feeUsd = -(sum('COMMISSION') + sum('FUNDING_FEE')); r.netUsd = r.grossUsd - r.feeUsd;
    r.pnlSource = 'income'; r.incomeSymbol = sym;
    return;
  }
}

// ---------- tampilan ----------
const usd = (v) => (v === null || v === undefined ? '?' : `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`);
const px = (v) => (v === null || v === undefined ? '?' : v >= 100 ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : String(+v.toPrecision(6)));
const wita = (s) => (s ? new Date(new Date(s).getTime() + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 16) + ' WITA' : '?');
const methodName = (r) => {
  const p = String(r.patternType || '');
  const map = { mean_reversion: 'Mean Reversion', exhaustion_fade: 'Exhaustion', news_dxy: 'News (dolar per detik)', ict_sweep: 'ICT Liquidity Sweep', fed_dovish_grid: 'Fed Dovish Grid', econ_reaction: 'Scalp Rilis Data' };
  if (map[p]) return map[p];
  if (isAdopted(p)) return 'Posisi manual/adopsi';
  if (p.startsWith('fvg')) return 'Fair Value Gap';
  return p ? `Pola Chart (${p.replace(/_/g, ' ')})` : 'Sinyal';
};

// field yang udah tampil di baris lain / gak berguna dibaca manusia -- tetap ADA lengkap di trade-ledger.json
const CTX_HIDE = new Set(['id', 'signalId', 'direction', 'dir', 'patternType', 'mode', 'sl', 'tp', 'entryPrice', 'exitPrice', 'entry', 'exit', 'status', 'at', 'net', 'reason', 'grossUsd', 'feeUsd', 'openedAt', 'closedAt', 'triggeredAt', 'key', 'label', 'asset', 'coin']);

function toMarkdown(trades, now) {
  const L = [];
  L.push('# 📒 Buku Besar Trading Kaela (otomatis)', '');
  L.push(`Diperbarui otomatis: ${wita(now.toISOString())} -- dari jurnal SEMUA sistem (Sniper/Ranger/Ninja, demo & real, semua exchange). JANGAN diedit manual (ketimpa tiap 15 menit). Data mesin: \`trade-ledger.json\`.`, '');
  // ringkasan per sistem + metode + akun
  const groups = new Map();
  for (const r of trades.filter((t) => t.status === 'tutup')) {
    const k = `${r.system} · ${methodName(r)} · ${r.account} (${r.exchange})`;
    const g = groups.get(k) || { n: 0, win: 0, net: 0, unknown: 0 };
    g.n += 1; if (r.netUsd === null) g.unknown += 1; else { g.net += r.netUsd; if (r.netUsd >= 0) g.win += 1; }
    groups.set(k, g);
  }
  L.push('## Ringkasan per metode (trade yang udah tutup)', '');
  if (!groups.size) L.push('- Belum ada trade tutup.');
  for (const [k, g] of [...groups.entries()].sort()) {
    const known = g.n - g.unknown;
    L.push(`- **${k}**: ${g.n} trade, menang ${g.win}/${known}${known ? ` (${(g.win / known * 100).toFixed(0)}%)` : ''}, bersih ${known ? usd(g.net) : '?'}${g.unknown ? ` (${g.unknown} PnL gak kebaca)` : ''}`);
  }
  const open = trades.filter((t) => t.status === 'terbuka');
  L.push('', `## Posisi terbuka (${open.length})`, '');
  if (!open.length) L.push('- Gak ada.');
  for (const r of open) L.push(`- ${r.system} · ${methodName(r)} · ${r.account} · ${r.exchange} · ${r.asset} ${r.direction || "?"} @ ${px(r.entry)} (SL ${px(r.sl)}) sejak ${wita(r.openedAt)}`);
  const closed = trades.filter((t) => t.status === 'tutup').slice(0, 60);
  L.push('', `## Trade terakhir (${closed.length} terbaru)`, '');
  for (const r of closed) {
    L.push(`### ${r.signalId ? '#' + r.signalId + ' — ' : ''}${r.system} · ${methodName(r)} · ${r.account} · ${r.exchange}${r.slot ? ' · slot ' + r.slot : ''}`);
    L.push(`- Buka: ${wita(r.openedAt)} — ${r.asset} ${r.direction || "?"} @ ${px(r.entry)}${r.sl !== null ? ` (SL ${px(r.sl)})` : ''}${r.leverage ? `, ${r.leverage}x` : ''}${r.event ? ` — rilis: ${r.event}` : ''}`);
    L.push(`- Alasan buka: ${r.reasonOpen}`);
    const ctx = Object.entries(r.context || {}).filter(([k]) => !CTX_HIDE.has(k)).slice(0, 12);
    if (ctx.length) L.push(`- Konteks entry: ${ctx.map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(8) : v}`).join(', ')}`);
    L.push(`- Tutup: ${wita(r.closedAt)} @ ${px(r.exit)} — Alasan tutup: ${r.reasonClose || '?'}`);
    L.push(`- Hasil: bersih ${usd(r.netUsd)}${r.grossUsd !== null ? ` (kotor ${usd(r.grossUsd)}, fee $${(r.feeUsd || 0).toFixed(2)})` : ''}${r.seed ? ' _(dipulihin dari pesan WA)_' : ''}${r.pnlSource === 'income' ? ` _(direkonstruksi dari riwayat income Binance ${r.incomeSymbol})_` : ''}`);
    L.push('');
  }
  return L.join('\n') + '\n';
}

function main() {
  const now = new Date();
  const trades = collect();
  fs.writeFileSync(path.join(OUT, 'trade-ledger.json'), JSON.stringify({ updatedAt: now.toISOString(), count: trades.length, trades }, null, 1));
  fs.writeFileSync(path.join(OUT, 'TRADE-LEDGER.md'), toMarkdown(trades, now));
  console.log(`[TradeLedger] ${trades.length} trade (${trades.filter((t) => t.status === 'terbuka').length} terbuka) -> trade-ledger.json + TRADE-LEDGER.md`);
}

if (require.main === module) { try { main(); } catch (e) { console.log('[TradeLedger] ERROR:', e.message); process.exitCode = 1; } }
module.exports = { collect, toMarkdown, legNums };
