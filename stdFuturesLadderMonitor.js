// stdFuturesLadderMonitor.js (1 Okt 2026) -- pengawas "DCA Tangga Leverage" Olan di BingX STANDARD FUTURES.
//
// Latar: Olan mau DCA $3/hari long BTC x3, tiap posisi INDEPENDEN (Standard Futures BingX gak numpuk posisi --
// Olan udah tes sendiri), posisi yang kelikuidasi diganti nominal sama tapi leverage naik x3 -> x5 -> x7 -> x9
// (maks). Backtest: backtest/dcaLeverLadder.js (BACKTEST-REGISTRY.md bagian "Tangga Leverage").
// API Standard Futures BingX CUMA BACA (allPosition / allOrders / balance -- dicek ke dokumen resmi
// github.com/BingX-API/BingX-Standard-Contract-doc, 1 Okt 2026) -> buka/ganti posisi tetap MANUAL oleh Olan,
// script ini yang ngawasin: "Jika ada posisi liquidated, info saya. Jadi bisa segera ku ganti posisi itu pake
// leverage yang lebih gede" (Olan).
//
// Perilaku:
//   - TIDAK PERNAH kirim order apa pun (murni GET).
//   - Run pertama (state kosong) = nyatet posisi yang udah ada DIAM-DIAM (gak WA).
//   - Posisi yang hilang dari allPosition -> cek allOrders (harga tutup) -> LIKUIDASI kalau harga tutup udah
//     di/lewat estimasi harga likuidasi ATAU rugi >= 85% margin -> DM WA Olan + saran leverage pengganti +
//     rugi dicatat (totals.liqLossUsd). Ditutup biasa (untung/rugi kecil) -> dicatat diam-diam, gak WA.
//   - Riwayat belum muncul (lag API) -> ditunggu sampai MAX_WAIT_RUNS siklus; habis itu pakai harga terakhir
//     vs estimasi likuidasi, kalau gak bisa diputusin tetap DM "posisi hilang, cek manual".
//   - Fetch posisi GAGAL -> siklus dilewati (JANGAN anggap posisi hilang = gak ada alarm palsu). Gagal beruntun
//     >= FAIL_ALERT_RUNS -> DM sekali (aturan mandor: otomatisasi gak boleh gagal diam-diam).
//   - Tiap posisi cuma dilaporin SEKALI (status di state).
// State: std-futures-ladder-state.json (git-tracked lewat run-vultr-executor.sh -- data observasi, wajib backup).
// Jalan tiap menit dari run-channel-breakout-vultr.sh.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATE_PATH = path.join(__dirname, 'std-futures-ladder-state.json');
const OLAN_NUMBER = '6281299303888';
const LADDER = [3, 5, 7, 9];
const MMR = 0.005;            // maintenance margin rate perkiraan (sama dgn backtest)
const LIQ_LOSS_FRAC = 0.85;   // rugi >= 85% margin = dianggap likuidasi
const MAX_WAIT_RUNS = 10;     // ~10 menit nunggu riwayat order muncul
const FAIL_ALERT_RUNS = 30;   // ~30 menit gagal baca beruntun -> lapor
// (3 Okt 2026, Olan: "std futures bingx bisa tambahin collateral.. kalo ada posisi yang minus di atas 50% ingatkan aku buat
// tambah collateral") -- rugi floating vs margin SEKARANG: >= 50% -> DM, >= 75% -> DM keras; pulih < 35% -> reset (bisa
// ngingetin lagi kalau turun lagi). Saran nominal = tambahan biar rugi balik ke ~25% margin.
const COLL_WARN_LEVELS = [0.5, 0.75];
const COLL_RESET_BELOW = 0.35;
const COLL_TARGET_LOSS = 0.25;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const fmtUsd = (v) => (v === null || v === undefined ? '-' : '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));

function nextLeverage(lev) {
  const i = LADDER.indexOf(lev);
  if (i >= 0) return LADDER[Math.min(i + 1, LADDER.length - 1)];
  return LADDER.find((x) => x > lev) || LADDER[LADDER.length - 1];
}
// Perkiraan harga likuidasi isolated (BingX gak ngasih field-nya di Standard Futures).
function estimateLiqPrice(side, entry, lev) {
  if (!entry || !lev) return null;
  return side === 'SHORT' ? entry * (1 + 1 / lev - MMR) : entry * (1 - 1 / lev + MMR);
}
function keyOf(p) { return `${p.symbol}|${p.positionSide}|${p.time}|${p.entryPrice}`; }
function normalizePosition(p) {
  const side = String(p.positionSide || 'LONG').toUpperCase();
  const entry = num(p.entryPrice), lev = num(p.leverage);
  return { key: keyOf(p), symbol: p.symbol, side, entry, lev, margin: num(p.initialMargin), openedAt: num(p.time), lastPrice: num(p.currentPrice), liqEst: estimateLiqPrice(side, entry, lev) };
}
// Klasifikasi penutupan dari harga tutup: 'liquidated' | 'closed'
function classifyClose(layer, closePrice) {
  const dirSign = layer.side === 'SHORT' ? -1 : 1;
  const pnlFrac = ((closePrice - layer.entry) / layer.entry) * (layer.effLev || layer.lev) * dirSign; // relatif ke margin SEKARANG (abis tambah collateral)
  const pastLiq = layer.liqEst !== null && (layer.side === 'SHORT' ? closePrice >= layer.liqEst * 0.995 : closePrice <= layer.liqEst * 1.005);
  return { kind: pastLiq || pnlFrac <= -LIQ_LOSS_FRAC ? 'liquidated' : 'closed', pnlUsd: (layer.margin || 0) * pnlFrac };
}
function freshState() {
  return { seeded: false, nextNo: 1, layers: {}, totals: { liqCount: 0, liqLossUsd: 0, closedCount: 0, closedPnlUsd: 0 }, apiFail: { count: 0, alerted: false } };
}
function loadState() {
  try { return { ...freshState(), ...JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) }; } catch { return freshState(); }
}

// rugi floating sebagai pecahan margin sekarang (positif = rugi)
function lossFrac(layer) {
  if (!layer.lastPrice || !layer.entry) return null;
  const dirSign = layer.side === 'SHORT' ? -1 : 1;
  return -((layer.lastPrice - layer.entry) / layer.entry) * (layer.effLev || layer.lev) * dirSign;
}
// (3 Okt 2026, Olan: "jangan DM, masukin ke hedgefund.. peringatan umum aja, silahkan dicek posisi, jangan seolah mau
// liquidated.. peringatan halus biar anggota tidak panik") -- dikirim ke GRUP Wibowo Hedgefund, bahasa tenang: TANPA persen
// minus, TANPA kata bahaya/likuidasi. Revisi Olan: "ga usah sebut tambah collateral, pengingat umum aja suruh aku cek posisi"
// -> cuma ajakan cek posisi (Olan sendiri yang mutusin tambah collateral atau nggak).
function collateralMessage(layer, lf, level) {
  return [
    `🪜 TANGGA DCA · Kaela — 🔔 Pengingat ${level >= 0.75 ? 'lanjutan' : 'rutin'}`,
    '',
    `Waktunya cek posisi DCA #${layer.no} (${layer.symbol.replace('-USDT', '')} ${layer.side === 'SHORT' ? 'short' : 'long'}) ya.`,
    '',
    'Tetap pantau berkala 🙏',
    '',
    '— Kaela',
  ].join('\n');
}

function liqMessage(layer, closePrice, st) {
  const alive = Object.values(st.layers).filter((l) => l.status === 'open').length;
  return [
    '🪜 TANGGA DCA · Kaela — ⚠️ POSISI KENA LIKUIDASI',
    '',
    `Posisi #${layer.no} ${layer.symbol} ${layer.side} x${layer.lev}`,
    `Entry ${fmtUsd(layer.entry)} → tutup ${closePrice ? '~' + fmtUsd(closePrice) : '(harga tutup gak kebaca)'}`,
    `Margin hilang: -${fmtUsd(layer.margin)} (dicatat)`,
    '',
    `👉 Ganti sekarang di Standard Futures: buka ${fmtUsd(layer.margin)} x${nextLeverage(layer.lev)} (anak tangga berikutnya${layer.lev >= LADDER[LADDER.length - 1] ? ', udah maksimal x9' : ''})`,
    '',
    `Rekap: ${alive} posisi hidup | likuidasi total ${st.totals.liqCount}x, rugi ${fmtUsd(st.totals.liqLossUsd)}`,
  ].join('\n');
}

// deps: { fetchPositions() -> array (throw kalau gagal), fetchOrders(symbol, startTime) -> array, notify(msg), now() }
function createMonitor(deps, st) {
  const now = deps.now || (() => Date.now());
  const log = deps.log || ((m) => console.log(`[StdLadder] ${m}`));

  async function resolveGone(layer) {
    let closePrice = null;
    try {
      const orders = await deps.fetchOrders(layer.symbol, (layer.openedAt || now()) - 60e3);
      const cands = (orders || []).filter((o) => String(o.positionSide || '').toUpperCase() === layer.side
        && num(o.time) !== null && num(o.time) >= (layer.openedAt || 0) - 60e3
        && (num(o.leverage) === null || num(o.leverage) === layer.lev)
        && (num(o.closePrice) || num(o.avgPrice)));
      // Tiap order cuma boleh "dipakai" 1 posisi (bug ketemu di test: 2 posisi tutup bareng bisa nyocokin ke
      // order likuidasi yang SAMA). Pilih yg belum kepakai, margin paling mirip, lalu waktu paling deket.
      st.usedOrders = st.usedOrders || [];
      const oid = (o) => String(o.orderId || o.positionId || `${o.time}|${o.closePrice || o.avgPrice}`);
      const free = cands.filter((o) => !st.usedOrders.includes(oid(o)));
      free.sort((a, b) => (Math.abs((num(a.margin) || 0) - (layer.margin || 0)) - Math.abs((num(b.margin) || 0) - (layer.margin || 0)))
        || (Math.abs(num(a.time) - (layer.openedAt || 0)) - Math.abs(num(b.time) - (layer.openedAt || 0))));
      if (free.length) {
        closePrice = num(free[0].closePrice) || num(free[0].avgPrice);
        st.usedOrders.push(oid(free[0]));
        if (st.usedOrders.length > 5000) st.usedOrders = st.usedOrders.slice(-5000);
      }
    } catch (e) { log(`riwayat order gagal dibaca: ${e.message}`); }
    if (closePrice) return { closePrice, ...classifyClose(layer, closePrice) };
    layer.waitRuns = (layer.waitRuns || 0) + 1;
    if (layer.waitRuns < MAX_WAIT_RUNS) return null; // tunggu riwayat muncul
    // fallback: harga terakhir yang kelihatan udah mepet likuidasi?
    if (layer.lastPrice && layer.liqEst && Math.abs(layer.lastPrice - layer.liqEst) / layer.liqEst < 0.03) return { closePrice: null, kind: 'liquidated', pnlUsd: -(layer.margin || 0) };
    return { closePrice: null, kind: 'unknown', pnlUsd: 0 };
  }

  async function runCycle() {
    let positions;
    try { positions = (await deps.fetchPositions()).map(normalizePosition); }
    catch (e) {
      st.apiFail.count += 1;
      log(`gagal baca posisi (${st.apiFail.count}x beruntun): ${e.message}`);
      if (st.apiFail.count >= FAIL_ALERT_RUNS && !st.apiFail.alerted) {
        await deps.notify(`🪜 TANGGA DCA · Kaela — ⚠️ Monitor Standard Futures gagal baca posisi ${st.apiFail.count}x beruntun (~${st.apiFail.count} menit). Likuidasi belum bisa dideteksi sampai pulih -- cek manual dulu ya.\nError: ${e.message}`);
        st.apiFail.alerted = true;
      }
      return { ok: false };
    }
    if (st.apiFail.alerted) await deps.notify('🪜 TANGGA DCA · Kaela — ✅ Monitor Standard Futures pulih, deteksi likuidasi jalan lagi.');
    st.apiFail = { count: 0, alerted: false };

    const seen = new Set();
    // posisi baru -> kasih nomor urut sesuai waktu buka
    for (const p of [...positions].sort((a, b) => (a.openedAt || 0) - (b.openedAt || 0))) {
      seen.add(p.key);
      const L = st.layers[p.key];
      if (!L) { st.layers[p.key] = { ...p, no: st.nextNo++, status: 'open', firstSeenAt: now(), notional0: p.margin !== null && p.lev ? p.margin * p.lev : null }; log(`posisi baru #${st.layers[p.key].no} ${p.symbol} ${p.side} x${p.lev} entry ${p.entry}`); }
      else if (L.status === 'open') {
        L.lastPrice = p.lastPrice;
        if (p.margin !== null) L.margin = p.margin;
        // collateral ditambah -> margin naik -> leverage efektif turun & harga likuidasi menjauh (posisi lama tanpa notional0 diisi skrg)
        if (!L.notional0 && L.margin && L.lev) L.notional0 = L.margin * L.lev;
        if (L.notional0 && L.margin) { L.effLev = L.notional0 / L.margin; L.liqEst = estimateLiqPrice(L.side, L.entry, L.effLev); }
      }
    }
    if (!st.seeded) { st.seeded = true; log(`seed awal: ${positions.length} posisi dicatat diam-diam`); return { ok: true, seeded: true }; }

    const events = [];
    // peringatan tambah collateral (posisi yang MASIH hidup)
    for (const L of Object.values(st.layers)) {
      if (L.status !== 'open' || !seen.has(L.key)) continue;
      const lf = lossFrac(L);
      if (lf === null) continue;
      if (lf < COLL_RESET_BELOW) { L.collAlert = 0; continue; }
      const lvl = [...COLL_WARN_LEVELS].reverse().find((x) => lf >= x);
      if (lvl && (L.collAlert || 0) < lvl) {
        L.collAlert = lvl;
        await (deps.notifyGroup || deps.notify)(collateralMessage(L, lf, lvl));
        events.push({ no: L.no, kind: 'collateral', level: lvl });
      }
    }
    for (const L of Object.values(st.layers)) {
      if (L.status !== 'open' || seen.has(L.key)) continue;
      const r = await resolveGone(L);
      if (!r) continue;
      L.closedAt = now(); L.closePrice = r.closePrice;
      if (r.kind === 'liquidated') {
        L.status = 'liquidated';
        st.totals.liqCount += 1; st.totals.liqLossUsd += L.margin || 0;
        await deps.notify(liqMessage(L, r.closePrice, st));
        events.push({ no: L.no, kind: 'liquidated' });
      } else if (r.kind === 'closed') {
        L.status = 'closed'; st.totals.closedCount += 1; st.totals.closedPnlUsd += r.pnlUsd;
        events.push({ no: L.no, kind: 'closed' });
      } else {
        L.status = 'gone';
        await deps.notify(`🪜 TANGGA DCA · Kaela — ❓ Posisi #${L.no} ${L.symbol} ${L.side} x${L.lev} (entry ${fmtUsd(L.entry)}) udah gak ada, tapi riwayatnya gak ketemu. Ditutup manual atau kena likuidasi? Cek di aplikasi ya.`);
        events.push({ no: L.no, kind: 'gone' });
      }
    }
    return { ok: true, events };
  }
  return { runCycle };
}

// ================= wiring produksi (murni GET) =================
function makeBingxReader() {
  const secrets = require('./secrets');
  const key = secrets.BINGX_API_KEY, secret = secrets.BINGX_API_SECRET;
  if (!key || !secret) throw new Error('BINGX_API_KEY/SECRET kosong');
  async function get(p, params = {}, attempt = 1) {
    const q = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
    const ps = (q ? q + '&' : '') + `timestamp=${Date.now()}`;
    const sig = crypto.createHmac('sha256', secret).update(ps).digest('hex');
    const res = await fetch(`https://open-api.bingx.com${p}?${ps}&signature=${sig}`, { headers: { 'X-BX-APIKEY': key } });
    const j = await res.json();
    if (j.code === 109400 && attempt === 1) return get(p, params, 2); // timestamp invalid -> ulang 1x (GET aman)
    if (j.code !== 0) throw new Error(`BingX std (code ${j.code}): ${j.msg}`);
    return j.data;
  }
  return {
    fetchPositions: async () => { const d = await get('/openApi/contract/v1/allPosition'); if (!Array.isArray(d)) throw new Error('allPosition bukan array'); return d; },
    fetchOrders: async (symbol, startTime) => { const d = await get('/openApi/contract/v1/allOrders', { symbol, startTime: Math.floor(startTime), endTime: Date.now(), limit: 100 }); return Array.isArray(d) ? d : []; },
  };
}

async function main() {
  const st = loadState();
  const reader = makeBingxReader();
  const { sendWhatsApp } = require('./fonnte');
  // likuidasi & gangguan monitor -> DM Olan; pengingat collateral (halus) -> grup Wibowo Hedgefund (permintaan Olan 3 Okt)
  const { WIBOWO_GROUP_ID } = require('./wibowoNotify');
  const mon = createMonitor({ ...reader, notify: (m) => sendWhatsApp(m, OLAN_NUMBER), notifyGroup: (m) => sendWhatsApp(m, WIBOWO_GROUP_ID) }, st);
  try { const r = await mon.runCycle(); if (r.events && r.events.length) console.log('[StdLadder] event:', JSON.stringify(r.events)); }
  finally { fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 2)); }
}

if (require.main === module) main().catch((e) => { console.error('[StdLadder] ERROR:', e.message); process.exit(1); });

module.exports = { createMonitor, freshState, nextLeverage, estimateLiqPrice, classifyClose, normalizePosition, LADDER };
