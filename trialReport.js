// trialReport.js (4 Okt 2026) -- RAPOR UJI DEMO otomatis ke grup Wibowo Hedgefund.
//
// Latar: strategi baru (Ninja Exhaustion, Ninja News, Ninja MR, slot ICT Sweep Ranger) jalan demo dulu sampai target uji
// (lihat STRATEGY-CATALOG.md / GANTUNGAN.md). Biar gak ada yang kelupaan dievaluasi walau gak ada sesi Kaela, sistem lapor
// sendiri: (1) RAPOR MINGGUAN tiap Senin WITA (pola sama teamDigestReport.js: dipanggil tiap siklus 15 mnt, no-op kalau bukan
// Senin / udah kekirim), (2) TONGGAK -- begitu target uji tercapai (Exhaustion 100 transaksi, News 30 transaksi) keluar
// penilaian otomatis SEKALI: layak naik real (keputusan tetap di Olan) atau saran dimatikan.
// Anti-spam: total transaksi semua sistem uji masih 0 -> gak kirim apa-apa.
// Format pesan rapi per baris (arahan Olan: "pesan WhatsApp gunakan enter").
// Pakai: node trialReport.js (dipanggil run-vultr-executor.sh). Uji: node trialReport.selftest.js

const fs = require('fs');
const path = require('path');

const TYPE_WEEKLY = 'trial-report-weekly';
const STATE_PATH = path.join(__dirname, 'trial-report-state.json');

function readJson(file) { try { return JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8')); } catch { return null; } }
const fmtUsd = (v) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`;

// PF dari daftar net per transaksi
function pfOf(nets) {
  const w = nets.filter((x) => x > 0).reduce((a, b) => a + b, 0), l = -nets.filter((x) => x <= 0).reduce((a, b) => a + b, 0);
  return l > 0 ? w / l : (w > 0 ? Infinity : 0);
}
const pfText = (pf) => (pf === Infinity ? '∞' : pf.toFixed(2));

// Penilaian tonggak (aturan dikunci di STRATEGY-CATALOG: PF bersih > 1,2 & gak ada paruh PF < 1)
function verdict(nets) {
  const half = Math.floor(nets.length / 2);
  const pf = pfOf(nets), p1 = pfOf(nets.slice(0, half)), p2 = pfOf(nets.slice(half));
  if (pf > 1.2 && p1 >= 1 && p2 >= 1) return { ok: true, pf, p1, p2, text: '✅ LOLOS -- layak naik ke REAL (keputusan tetap di Olan)' };
  if (pf < 1) return { ok: false, pf, p1, p2, text: '❌ GAGAL -- saran: matikan / revisi aturan' };
  return { ok: false, pf, p1, p2, text: '🟡 BELUM MEYAKINKAN -- untung tipis / gak konsisten, saran lanjut uji demo' };
}

// Kumpulin data tiap sistem uji (demo). Return [{ key, name, n, target, nets|null, wins, losses, totalPnl }]
function collect(read = readJson) {
  const out = [];
  const ex = read('ninja-exhaustion-journal.json');
  if (ex) {
    const nets = (ex.history || []).filter((h) => h.mode === 'demo').map((h) => h.net);
    const st = (ex.stats && ex.stats.demo) || {};
    out.push({ key: 'exhaustion', name: '🥷 Ninja Exhaustion', n: (st.wins || 0) + (st.losses || 0), target: 100, nets, wins: st.wins || 0, losses: st.losses || 0, totalPnl: st.totalPnlUsd || 0, extra: `sinyal ${ex.signals || 0}, di-skip ${ex.skipped || 0}` });
  }
  const nw = read('ninja-news-journal.json');
  if (nw) {
    const nets = (nw.history || []).filter((h) => h.mode === 'demo').map((h) => h.net);
    const st = (nw.stats && nw.stats.demo) || {};
    out.push({ key: 'news', name: '🥷 Ninja News', n: (st.wins || 0) + (st.losses || 0), target: 30, nets, wins: st.wins || 0, losses: st.losses || 0, totalPnl: st.totalPnlUsd || 0, extra: `rilis dijaga ${Object.keys(nw.handled || {}).length}` });
  }
  const mr = read('ninja-mr-exec-journal.json');
  if (mr) {
    const st = (mr.stats && mr.stats.demo) || {};
    out.push({ key: 'mr', name: '🥷 Ninja Mean Reversion', n: (st.wins || 0) + (st.losses || 0), target: null, nets: null, wins: st.wins || 0, losses: st.losses || 0, totalPnl: st.totalPnlUsd || 0, extra: `limit gak ke-fill ${mr.missedEntries || 0}` });
  }
  const rg = read('ranger-btc-dual-exec-journal.json');
  if (rg && rg.sweep) {
    const st = (rg.sweep.stats && rg.sweep.stats.demo) || {};
    out.push({ key: 'sweep', name: '🏹 Ranger slot ICT Sweep', n: (st.wins || 0) + (st.losses || 0), target: null, nets: null, wins: st.wins || 0, losses: st.losses || 0, totalPnl: st.totalPnlUsd || 0, extra: null });
  }
  return out;
}

function systemBlock(s) {
  const lines = [s.name];
  lines.push(`Transaksi demo: ${s.n}${s.target ? ` / ${s.target} (target uji)` : ''}`);
  if (s.n > 0) {
    lines.push(`Menang/kalah: ${s.wins}/${s.losses} (${(s.wins / s.n * 100).toFixed(0)}%)`);
    lines.push(`Hasil bersih: ${fmtUsd(s.totalPnl)}`);
    if (s.nets && s.nets.length) lines.push(`Profit factor: ${pfText(pfOf(s.nets))}`);
  } else lines.push('Belum ada transaksi (nunggu sinyal)');
  if (s.extra) lines.push(`Catatan: ${s.extra}`);
  return lines.join('\n');
}

function formatWeekly(systems) {
  return [
    '📋 RAPOR UJI DEMO · Kaela',
    'Mingguan (tiap Senin)',
    '',
    systems.map(systemBlock).join('\n\n'),
    '',
    'Semua di akun DEMO. Naik ke real cuma kalau target uji tercapai & hasilnya lolos, dan tetap nunggu keputusan Olan.',
    '',
    '— Kaela',
  ].join('\n');
}

function formatMilestone(s, v) {
  return [
    '🏁 TONGGAK UJI DEMO · Kaela',
    s.name,
    `Target ${s.target} transaksi demo tercapai (${s.n})`,
    '',
    `Profit factor: ${pfText(v.pf)}`,
    `Paruh pertama: ${pfText(v.p1)}`,
    `Paruh kedua: ${pfText(v.p2)}`,
    `Hasil bersih: ${fmtUsd(s.totalPnl)}`,
    '',
    `Penilaian: ${v.text}`,
    '',
    '— Kaela',
  ].join('\n');
}

// deps: { now, read, send(msg), archive:{hasEntryToday, addOrReplaceDaily}, loadState, saveState, toLocal }
async function run(deps) {
  const now = deps.now || new Date();
  const systems = collect(deps.read);
  const total = systems.reduce((a, s) => a + s.n, 0);
  const sent = [];
  const st = deps.loadState();
  // tonggak (kapan aja, sekali per sistem)
  for (const s of systems) {
    if (!s.target || !s.nets || s.n < s.target || (st.milestones || {})[s.key]) continue;
    const msg = formatMilestone(s, verdict(s.nets));
    await deps.send(msg); sent.push(msg);
    st.milestones = { ...(st.milestones || {}), [s.key]: new Date(now).toISOString() };
  }
  // mingguan (Senin WITA)
  if (deps.toLocal(now).getUTCDay() === 1 && total > 0 && !deps.archive.hasEntryToday(TYPE_WEEKLY, now)) {
    const msg = formatWeekly(systems);
    deps.archive.addOrReplaceDaily(TYPE_WEEKLY, msg, now);
    await deps.send(msg); sent.push(msg);
  }
  deps.saveState(st);
  return sent;
}

async function main() {
  const { toLocal } = require('./config');
  const archive = require('./archive');
  const { sendWhatsApp } = require('./fonnte');
  const { WIBOWO_GROUP_ID } = require('./wibowoNotify');
  const sent = await run({
    now: new Date(), read: readJson, toLocal, archive,
    send: (m) => sendWhatsApp(m, WIBOWO_GROUP_ID).catch((e) => console.log('[TrialReport] Gagal kirim:', e.message)),
    loadState: () => { try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; } },
    saveState: (s) => fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)),
  });
  console.log(`[TrialReport] ${sent.length ? `${sent.length} pesan terkirim` : 'gak ada yang perlu dikirim'}.`);
}

if (require.main === module) main().catch((e) => { console.error('[TrialReport] ERROR:', e.message); process.exit(1); });

module.exports = { run, collect, verdict, pfOf, formatWeekly, formatMilestone };
