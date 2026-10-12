// spotGridTrader.js (11 Okt 2026) -- 🪙 GRID SPOT BingX (tanpa leverage, gak bisa likuidasi). Tingkat ke-2 "Tangga Kekayaan" Olan:
//   🌾 Farmer (futures, cap $10.000) -> lebihnya jadi BTC spot (bibit) -> kantong spot tembus activateAtUsd ($10.000) -> GRID SPOT AKTIF.
// Riset (STRATEGY-CATALOG): grid final 2% modal per tangga, beli tiap -3% dari beli terakhir, tangga x1,15, TP 1,5% total masuk
// (tahan fee 0,1-0,2%, gak pernah rugi, ~9-10%/th) + TRANSISI 30% BTC INTI ditahan / 70% grid (19%/th, rugi cuma 5/94 titik).
// Waktu aktif: 30% BTC dikunci jadi INTI (gak pernah dijual), sisanya dijual jadi USDC = peluru grid (2% langsung jadi tangga #1).
// Uang masuk berikutnya (bibit Farmer) = tambahan peluru grid. Grid dibatasi capUsd ($100.000) -- lebihnya: nanti DOGE (belum dibangun,
// sekarang cuma dikabarin). Semua order spot bertag clientOrderId "kaelaspot". Saklar & angka: spot-grid-config.json.
// Uji: node spotGridTrader.selftest.js (exchange palsu).

const fs = require('fs');
const path = require('path');
const CONFIG_PATH = path.join(__dirname, 'spot-grid-config.json');
const JOURNAL_PATH = path.join(__dirname, 'spot-grid-journal.json');
const FEE = 0.001;
// SIKLUS INTI (11 Okt 2026, Olan: "kalo gak pernah jual BTC kita lewatin peak bull market") -- riset backtest/coreCycleStudy.js +
// coreTrailStudy.js: BTC inti dijual bertahap 5x di hari 400-600 sejak halving (musim puncak), dibeli balik bertahap 5x di hari
// 780-950 (musim dasar). Ngalahin tahan terus di semua titik mulai 2013-2021 (+306% s/d +1.872%); ide "beli <= ATH -50% + trailing"
// diuji juga -- gak konsisten (kena koreksi tengah bull), gak dipakai. USDC hasil jual inti DIPISAH dari peluru grid (coreUsd).
// Tanggal halving dari halving.js (11 Okt 2026): halving berikutnya diperkirakan otomatis dari tinggi blok, tanggal asli diambil
// sendiri begitu bloknya ketambang -- gak ada lagi tanggal 2028 yang ditulis tangan.
const { daysSinceHalving, halvingIdx } = require('./halving');
const fmt$ = (v) => `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

function loadConfig() {
  const def = { enabled: false, symbol: 'BTC-USDC', quote: 'USDC', activateAtUsd: 10000, capUsd: 100000, holdPct: 30, unitPct: 2, stepPct: 3, growth: 1.15, tpPct: 1.5, minOrderUsd: 5.5, coreCycle: { enabled: true, sellFrom: 400, sellTo: 600, buyFrom: 780, buyTo: 950, slices: 5 } };
  try { return { ...def, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; } catch { return def; }
}
function freshJournal() { return { active: false, activatedAt: null, coreBtc: 0, cycle: null, history: [], stats: { cycles: 0, totalPnlUsd: 0 }, alerts: {} }; }
function loadJournal() { try { return { ...freshJournal(), ...JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8')) }; } catch { return freshJournal(); } }

// deps: { cfg, journal, exec{getSpotBalances, spotMarketBuy, spotMarketSell}, price(), now(), notify(msg), alert(msg,kind), log, save }
async function runOnce(deps) {
  const { cfg, journal: j } = deps;
  const log = deps.log || ((m) => console.log(`[SpotGrid] ${m}`));
  const now = deps.now ? deps.now() : Date.now();
  if (!cfg.enabled || !deps.exec) return { skipped: 'off' };
  const ex = deps.exec, base = cfg.symbol.split('-')[0];
  const px = await deps.price();
  if (!(px > 0)) return { skipped: 'no-price' };
  const bals = await ex.getSpotBalances();
  const free = (a) => Number((bals.find((b) => b.asset === a) || {}).free) || 0;
  const btcAll = free(base), cash = Math.max(0, free(cfg.quote) - (j.coreUsd || 0)); // USDC hasil jual inti bukan peluru grid

  // ---- SIAGA: tunggu kantong spot tembus activateAtUsd ----
  if (!j.active) {
    const total = btcAll * px + cash;
    if (total < cfg.activateAtUsd) {
      if (!j.lastIdleLog || now - j.lastIdleLog > 24 * 3600e3) { log(`siaga -- kantong spot ${fmt$(total)} (${btcAll} ${base} + ${fmt$(cash)}), aktif di ${fmt$(cfg.activateAtUsd)}`); j.lastIdleLog = now; deps.save(); }
      return { idle: 'siaga', total };
    }
    // AKTIF: kunci INTI holdPct% BTC, sisain 1 tangga, sisanya dijual jadi peluru USDC
    const core = Math.floor(btcAll * cfg.holdPct / 100 * 1e6) / 1e6;
    const gridBtc = btcAll - core, gridEq = gridBtc * px + cash;
    const unit = gridEq * cfg.unitPct / 100;
    const keepBtc = Math.min(gridBtc, unit / px);
    const sellQty = Math.floor((gridBtc - keepBtc) * 1e6) / 1e6;
    if (sellQty * px >= cfg.minOrderUsd) await ex.spotMarketSell({ symbol: cfg.symbol, quantity: sellQty });
    j.active = true; j.activatedAt = now; j.coreBtc = core;
    j.cycle = { startedAt: now, base: unit, n: 1, invested: keepBtc * px, btc: keepBtc, lastBuy: px };
    deps.save();
    log(`AKTIF -- inti ${core} ${base} dikunci, jual ${sellQty} ${base} jadi peluru grid, tangga #1 = ${keepBtc} ${base} @ ${fmt$(px)}`);
    await deps.alert(`🪙 GRID SPOT AKTIF! Kantong spot udah ${fmt$(total)}.\n• ${core} ${base} (30%) dikunci jadi INTI -- ditahan, gak pernah dijual\n• ${sellQty} ${base} dijual jadi peluru grid (USDC)\n• Grid: beli tiap BTC turun ${cfg.stepPct}%, panen tiap untung ${cfg.tpPct}% dari modal masuk.`, `spotact:${now}`);
    return { activated: { core, sellQty, keepBtc } };
  }

  // ---- SIKLUS INTI: jual bertahap di musim puncak, beli balik bertahap di musim dasar ----
  const cc = cfg.coreCycle || {};
  if (cc.enabled) {
    const d = daysSinceHalving(now), hk = halvingIdx(now), slices = cc.slices || 5;
    const ci = j.coreCycle || (j.coreCycle = {});
    const gapMs = (a, b) => (b - a) / slices * 864e5;
    if (d >= cc.sellFrom && d < cc.sellTo && j.coreBtc > 0) {
      if (ci.sellHalving !== hk) { ci.sellHalving = hk; ci.sellLeft = slices; ci.lastSell = 0; }
      const q = ci.sellLeft > 0 ? Math.floor(j.coreBtc / ci.sellLeft * 1e6) / 1e6 : 0;
      if (q > 0 && now - (ci.lastSell || 0) >= gapMs(cc.sellFrom, cc.sellTo) && q * px >= cfg.minOrderUsd) {
        const o = await ex.spotMarketSell({ symbol: cfg.symbol, quantity: q });
        const got = Number(o && o.cummulativeQuoteQty) || q * px * (1 - FEE);
        j.coreBtc = Math.max(0, j.coreBtc - q); j.coreUsd = (j.coreUsd || 0) + got; ci.sellLeft -= 1; ci.lastSell = now; deps.save();
        log(`INTI jual ${q} ${base} @ ${fmt$(px)} (musim puncak, hari ke-${Math.round(d)}) -- sisa inti ${j.coreBtc}, USDC inti ${fmt$(j.coreUsd)}`);
        await deps.notify(`🪙 GRID SPOT — Inti dijual bertahap (${slices - ci.sellLeft}/${slices})\n\n${q} ${base} @ ${fmt$(px)} = ${fmt$(got)}\nAlasan: musim PUNCAK siklus halving (hari ke-${Math.round(d)}). Dibeli balik bertahap di musim dasar (hari ${cc.buyFrom}-${cc.buyTo}).\nSisa inti: ${j.coreBtc} ${base} | USDC inti: ${fmt$(j.coreUsd)}\n\n— Kaela`);
      }
    }
    if (d >= cc.buyFrom && d < cc.buyTo && (j.coreUsd || 0) > cfg.minOrderUsd) {
      if (ci.buyHalving !== hk) { ci.buyHalving = hk; ci.buyLeft = slices; ci.lastBuy = 0; }
      const u = ci.buyLeft > 0 ? Math.floor(j.coreUsd / ci.buyLeft * 100) / 100 : 0;
      if (u >= cfg.minOrderUsd && now - (ci.lastBuy || 0) >= gapMs(cc.buyFrom, cc.buyTo)) {
        const o = await ex.spotMarketBuy({ symbol: cfg.symbol, quoteQty: u });
        const q = Number(o && o.executedQty) || u * (1 - FEE) / px;
        j.coreBtc += q; j.coreUsd = Math.max(0, j.coreUsd - u); ci.buyLeft -= 1; ci.lastBuy = now; deps.save();
        log(`INTI beli balik ${q} ${base} @ ${fmt$(px)} (musim dasar, hari ke-${Math.round(d)})`);
        await deps.notify(`🪙 GRID SPOT — Inti dibeli balik bertahap (${slices - ci.buyLeft}/${slices})\n\n${q} ${base} @ ${fmt$(px)} (${fmt$(u)})\nAlasan: musim DASAR siklus halving (hari ke-${Math.round(d)}).\nInti sekarang: ${j.coreBtc} ${base}\n\n— Kaela`);
      }
    }
  }

  // ---- AKTIF: grid jalan di BTC di luar inti ----
  const gridBtc = Math.max(0, btcAll - j.coreBtc);
  let c = j.cycle;
  const gridEq = gridBtc * px + cash;
  const dg = await dogeMoonshot({ deps, j, cfg, ex, gridEq, cash, c, now, log });
  if (dg) return dg;
  if (!c || !(c.btc > 0)) { // mulai siklus baru: tangga #1
    const unit = Math.min(cfg.capUsd > 0 ? cfg.capUsd : Infinity, gridEq) * cfg.unitPct / 100;
    if (cash < Math.max(unit, cfg.minOrderUsd)) { deps.save(); return { idle: 'peluru kurang' }; }
    const o = await ex.spotMarketBuy({ symbol: cfg.symbol, quoteQty: unit });
    const q = Number(o && o.executedQty) || unit * (1 - FEE) / px;
    j.cycle = c = { startedAt: now, base: unit, n: 1, invested: unit, btc: q, lastBuy: px };
    deps.save(); log(`siklus baru: tangga #1 ${q} ${base} @ ${fmt$(px)} (${fmt$(unit)})`);
    return { bought: { n: 1, q } };
  }
  // TP: jual BTC grid (bukan inti) kalau untung >= tpPct% total masuk
  const sellVal = c.btc * px * (1 - FEE);
  if (sellVal >= c.invested * (1 + cfg.tpPct / 100)) {
    const qty = Math.min(c.btc, gridBtc);
    const o = await ex.spotMarketSell({ symbol: cfg.symbol, quantity: Math.floor(qty * 1e6) / 1e6 });
    const got = Number(o && o.cummulativeQuoteQty) || sellVal;
    const pnl = got - c.invested;
    const rec = { startedAt: c.startedAt, closedAt: now, rungs: c.n, invested: c.invested, btc: qty, exit: px, pnl };
    j.history.push(rec); if (j.history.length > 500) j.history = j.history.slice(-500);
    j.stats.cycles += 1; j.stats.totalPnlUsd += pnl; j.cycle = null; deps.save();
    log(`PANEN grid spot: ${c.n} tangga, modal ${fmt$(c.invested)} -> untung ${fmt$(pnl)}`);
    await deps.notify(`🪙 GRID SPOT — Panen\n\n${c.n} tangga, modal masuk ${fmt$(c.invested)}, dijual @ ${fmt$(px)}\nUntung: +${fmt$(pnl)} (${(pnl / c.invested * 100).toFixed(2)}%)\nTotal panen: ${j.stats.cycles}x, akumulasi +${fmt$(j.stats.totalPnlUsd)}\nInti BTC ditahan: ${j.coreBtc} ${base}\n\n— Kaela`);
    return { tp: rec };
  }
  // tambah tangga tiap turun stepPct% dari beli terakhir
  if (px <= c.lastBuy * (1 - cfg.stepPct / 100)) {
    const unit = c.base * Math.pow(cfg.growth, c.n);
    const spend = Math.min(unit, cash * 0.995);
    if (spend < cfg.minOrderUsd) { if (!j.alerts.ammo || now - j.alerts.ammo > 24 * 3600e3) { j.alerts.ammo = now; log(`peluru grid habis (${fmt$(cash)}) -- nunggu harga balik / bibit baru`); } deps.save(); return { idle: 'peluru habis' }; }
    const o = await ex.spotMarketBuy({ symbol: cfg.symbol, quoteQty: spend });
    const q = Number(o && o.executedQty) || spend * (1 - FEE) / px;
    c.n += 1; c.invested += spend; c.btc += q; c.lastBuy = px; deps.save();
    log(`tangga #${c.n}: beli ${q} ${base} @ ${fmt$(px)} (${fmt$(spend)}) -- total masuk ${fmt$(c.invested)}`);
    return { bought: { n: c.n, q } };
  }
  deps.save();
  return { idle: 'nunggu' };
}

// 🐕 DOGE MOONSHOT (11 Okt 2026, Olan: "spot grid cap 100k, lebihnya DOGE, DCA, simpan di wallet pribadi, notif buat jual").
// Grid spot lewat capUsd -> USDC nganggur (yang gak dipakai siklus grid) di atas cap dibeliin DOGE spot BingX, dicicil maks
// cfg.doge.maxBuyUsd per hari (DCA). DOGE yang kebeli = punya Olan: dikabarin buat DITARIK ke dompet sendiri (API gak punya izin
// tarik). Jual DOGE = keputusan Olan di dompetnya; Kaela cuma ngingetin pas MUSIM PUNCAK siklus halving (hari sellFrom-sellTo,
// sama kayak inti BTC) -- DOGE historis puncak barengan puncak bull BTC (2017/18, 2021).
async function dogeMoonshot({ deps, j, cfg, ex, gridEq, cash, c, now, log }) {
  const dc = { enabled: true, symbol: 'DOGE-USDC', maxBuyUsd: 1000, minBuyUsd: 50, ...(cfg.doge || {}) };
  if (!dc.enabled || !(cfg.capUsd > 0)) return null;
  const dj = j.doge || (j.doge = { qty: 0, costUsd: 0, buys: 0, lastBuy: 0, notifiedSeason: null });
  const cc = cfg.coreCycle || {};
  const d = daysSinceHalving(now), hk = halvingIdx(now);
  if (dj.qty > 0 && cc.sellFrom != null && d >= cc.sellFrom && d < cc.sellTo && dj.notifiedSeason !== hk) {
    dj.notifiedSeason = hk; deps.save();
    await deps.alert(`🐕 MUSIM PUNCAK DOGE! Hari ke-${Math.round(d)} sejak halving -- musim puncak bull (hari ${cc.sellFrom}-${cc.sellTo}), DOGE biasanya meledak barengan BTC.\nTotal DOGE yang Kaela beliin: ${dj.qty.toLocaleString('en-US')} DOGE (modal ${fmt$(dj.costUsd)}).\n\nSaran: jual BERTAHAP di dompetmu selama musim ini (mis. 5x), jangan nunggu pucuk persis. Keputusan di kamu.`, `dogeseason:${hk}`);
  }
  const over = gridEq - cfg.capUsd;
  const free = cash - (c && c.btc > 0 ? Math.max(0, c.base * Math.pow(cfg.growth, c.n) * 3) : cfg.capUsd * cfg.unitPct / 100); // sisain peluru 3 tangga berikutnya
  const amt = Math.floor(Math.min(over, free, dc.maxBuyUsd) * 100) / 100;
  if (over < dc.minBuyUsd || amt < Math.max(dc.minBuyUsd, cfg.minOrderUsd) || now - (dj.lastBuy || 0) < 20 * 3600e3) return null;
  const o = await ex.spotMarketBuy({ symbol: dc.symbol, quoteQty: amt });
  const q = Number(o && o.executedQty) || 0;
  dj.qty += q; dj.costUsd += amt; dj.buys += 1; dj.lastBuy = now; deps.save();
  log(`DOGE: grid lewat cap ${fmt$(over)} -> beli ${q} DOGE (${fmt$(amt)})`);
  await deps.notify(`🐕 DOGE MOONSHOT — DCA #${dj.buys}\n\nGrid spot ${fmt$(gridEq)} lewat batas ${fmt$(cfg.capUsd)} -> lebihnya ${fmt$(amt)} dibeliin ${q.toLocaleString('en-US')} DOGE.\nTotal DOGE: ${dj.qty.toLocaleString('en-US')} (modal ${fmt$(dj.costUsd)}).\n\n— Kaela`);
  await deps.alert(`🐕 Kaela beliin ${q.toLocaleString('en-US')} DOGE (${fmt$(amt)}) dari kelebihan grid spot. Tarik DOGE-nya dari Spot BingX ke DOMPET DOGE pribadimu ya -- itu tabungan moonshot, dijual pas musim puncak (Kaela ingetin).`, `dogebuy:${now}`);
  return { doge: { q, amt } };
}

async function main() {
  try { const r = await require('./halving').refresh(); if (r && r.actual && r.changedDays === 0 && !(loadJournal().alerts || {})[`halving:${r.block}`]) console.log(`[SpotGrid] halving blok ${r.block} kejadian ${r.date}`); } catch (e) { console.log('[SpotGrid] cek halving gagal (pakai cache):', e.message); }
  const cfg = loadConfig();
  if (!cfg.enabled) return;
  const j = loadJournal();
  const { createBingxClient, loadSecrets } = require('./bingxExecutor');
  const s = loadSecrets();
  if (!s.BINGX_API_KEY) return;
  const exec = createBingxClient({ apiKey: s.BINGX_API_KEY, apiSecret: s.BINGX_API_SECRET, testnet: false });
  const deps = {
    cfg, journal: j, exec,
    price: async () => { const r = await (await fetch(`https://open-api.bingx.com/openApi/swap/v2/quote/price?symbol=${cfg.symbol}`, { signal: AbortSignal.timeout(8000) })).json(); return parseFloat(r && r.data && r.data.price); },
    notify: async (m) => { try { await require('./wibowoNotify').sendWhatsAppToWibowo(m); } catch (e) { console.log('[SpotGrid] WA grup gagal:', e.message); } },
    alert: async (m, kind) => { const a = j.alerts || (j.alerts = {}); if (a[kind] && Date.now() - a[kind] < 6 * 3600e3) return; a[kind] = Date.now(); try { await require('./fonnte').sendWhatsApp(`${m}\n\n— Kaela`, '6282134510686'); } catch (e) { console.log('[SpotGrid] WA gagal:', e.message); } },
    log: (m) => console.log(`[${new Date().toISOString()}] [SpotGrid] ${m}`),
    save: () => fs.writeFileSync(JOURNAL_PATH, JSON.stringify(j, null, 2)),
  };
  // 12 Okt 2026: gangguan sesaat BingX (100500 "network issue", 1 menit doang) gak perlu DM -- kabarin kalau gagal >= 5 menit berturut
  try { await runOnce(deps); if (j.failStreak) { j.failStreak = 0; deps.save(); } }
  catch (e) { j.failStreak = (j.failStreak || 0) + 1; deps.log(`GAGAL (${j.failStreak}x berturut): ${e.message}`); if (j.failStreak >= 5) await deps.alert(`⚠️ Grid spot error ${j.failStreak} menit berturut-turut: ${e.message}`, `err:${String(e.message).slice(0, 40)}`); deps.save(); }
}
if (require.main === module) main();
module.exports = { runOnce, freshJournal, loadConfig };
