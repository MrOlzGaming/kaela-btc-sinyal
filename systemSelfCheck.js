// systemSelfCheck.js (1 Okt 2026) -- pemeriksaan MANDIRI harian (Olan: "biasanya mandiri" -- jangan
// nyuruh Olan ketik perintah tes manual). Dipanggil tiap siklus run-vultr-executor.sh, tapi self-gated:
// hampir selalu keluar dalam <1 detik, kerja beneran cuma 1x/hari. Hasil DISIMPAN ke
// system-selfcheck-state.json dan DIBACA dailyAutomationChecklist.js buat laporan Kesehatan Mandor
// 20:00 WITA -- gak kirim WA sendiri (1 laporan harian aja, pola feedback-wa-no-personal-dm-reports).
//
//  1. regressionTests.js -- 1x/hari setelah 03:00 WITA (jam sepi), dijalankan di SALINAN BERSIH repo
//     (`git archive HEAD` ke folder sementara) supaya fixture/backup-restore di suite itu TIDAK pernah
//     nyentuh journal live yang lagi ditulis runner 1 menit (ninjaTrader/ninjaMrSignal/ninjaMrTrader).
//  2. tools/bingxOrderApiCheck.js -- verifikasi endpoint LIMIT/STOP BingX di akun DEMO. Jalan sampai
//     LOLOS sekali, lalu berhenti; jalan lagi cuma kalau bingxExecutor.js/ninjaMrTrader.js berubah
//     (hash) -- dan cuma pas Ninja MR gak lagi pegang posisi/order (biar gak campur). Maks 1x/hari.
//
// Pakai: node systemSelfCheck.js   (opsional: SELFCHECK_FORCE=regression|bingx buat paksa jalan sekarang)

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, execSync } = require('child_process');
const { toLocal, localDateKey } = require('./config');

const STATE_PATH = path.join(__dirname, 'system-selfcheck-state.json');
const REGRESSION_EARLIEST_HOUR = 3; // WITA -- jam sepi
const REGRESSION_TIMEOUT_MS = 10 * 60e3;
const BINGX_TIMEOUT_MS = 3 * 60e3;
const BINGX_HASH_FILES = ['bingxExecutor.js', 'ninjaMrTrader.js'];

function loadState() {
  const def = { regression: null, bingxApi: null };
  if (!fs.existsSync(STATE_PATH)) return def;
  try { return { ...def, ...JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) }; } catch { return def; }
}
function saveState(s) { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); }

function executorHash() {
  const h = crypto.createHash('sha256');
  for (const f of BINGX_HASH_FILES) { try { h.update(fs.readFileSync(path.join(__dirname, f))); } catch { h.update(`missing:${f}`); } }
  return h.digest('hex').slice(0, 16);
}

// Jalanin proses, tangkap stdout+stderr walau exit non-zero (execFileSync throw -> ambil dari error).
function runCapture(args, opts) {
  try { return { code: 0, out: execFileSync('node', args, { encoding: 'utf8', ...opts }) }; }
  catch (e) { return { code: typeof e.status === 'number' ? e.status : 1, out: `${e.stdout || ''}${e.stderr || ''}${e.stdout || e.stderr ? '' : e.message}` }; }
}

function parseRegression(out) {
  const m = out.match(/(\d+) lolos, (\d+) gagal/);
  if (!m) return { passed: null, failed: null, ok: false, summary: 'output gak ada baris "N lolos, M gagal" (crash?)' };
  const passed = +m[1], failed = +m[2];
  const failedNames = out.split('\n').filter((l) => /^\s*GAGAL\s/.test(l)).map((l) => l.replace(/^\s*GAGAL\s+/, '').trim()).slice(0, 5);
  return { passed, failed, ok: failed === 0, summary: `${passed} lolos, ${failed} gagal${failedNames.length ? ' -- ' + failedNames.join(' | ') : ''}` };
}

function parseBingx(out) {
  const m = out.match(/(\d+)\/(\d+) OK\./);
  const failed = (out.match(/GAGAL: ([^\n]*?) -- JANGAN/) || [])[1] || null;
  return { okCount: m ? +m[1] : null, total: m ? +m[2] : null, failedNames: failed, aborted: /⛔/.test(out) };
}

function runRegressionInCleanCopy() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kaela-selfcheck-'));
  const started = Date.now();
  try {
    execSync(`git archive HEAD | tar -x -C "${tmp}"`, { cwd: __dirname, stdio: 'pipe' });
    const r = runCapture([path.join(tmp, 'regressionTests.js')], { cwd: tmp, timeout: REGRESSION_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    return { ...parseRegression(r.out), exitCode: r.code, durationSec: Math.round((Date.now() - started) / 1000), tail: r.out.split('\n').slice(-6).join('\n') };
  } catch (e) {
    return { passed: null, failed: null, ok: false, summary: `gagal nyiapin salinan repo: ${e.message.slice(0, 120)}`, exitCode: -1, durationSec: Math.round((Date.now() - started) / 1000), tail: '' };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* biarin */ }
  }
}

function ninjaMrBusy() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'ninja-mr-exec-journal.json'), 'utf8'));
    return !!(j.floating || j.pendingEntry);
  } catch { return false; }
}
function bingxSecretsPresent() {
  try { const s = require('./bingxExecutor').loadSecrets(); return !!(s.BINGX_API_KEY && s.BINGX_API_SECRET); } catch { return false; }
}

function main() {
  const now = new Date();
  const today = localDateKey(now);
  const hourLocal = toLocal(now).getUTCHours();
  const force = process.env.SELFCHECK_FORCE || '';
  const state = loadState();
  let changed = false;

  // ---- 1. regression test harian ----
  const regDue = force === 'regression' || (!(state.regression && state.regression.dateKey === today) && hourLocal >= REGRESSION_EARLIEST_HOUR);
  if (regDue) {
    console.log('[SelfCheck] Jalanin regressionTests.js di salinan bersih repo...');
    const r = runRegressionInCleanCopy();
    state.regression = { dateKey: today, at: now.toISOString(), ...r };
    changed = true;
    console.log(`[SelfCheck] Regression: ${r.summary} (${r.durationSec}s, exit ${r.exitCode})${r.ok ? '' : '\n' + r.tail}`);
  }

  // ---- 2. verifikasi endpoint BingX (demo) ----
  const hash = executorHash();
  const b = state.bingxApi;
  const bingxNeeded = force === 'bingx' || !b || !b.ok || b.executorHash !== hash;
  const bingxRanToday = b && b.lastRunDateKey === today;
  if (bingxNeeded && !bingxRanToday) {
    if (!bingxSecretsPresent()) { console.log('[SelfCheck] BingX: secrets kosong di mesin ini -- skip.'); }
    else if (ninjaMrBusy()) { console.log('[SelfCheck] BingX: Ninja MR lagi pegang posisi/order -- tunda verifikasi.'); }
    else {
      console.log('[SelfCheck] Jalanin tools/bingxOrderApiCheck.js (demo VST)...');
      const r = runCapture([path.join(__dirname, 'tools', 'bingxOrderApiCheck.js')], { cwd: __dirname, timeout: BINGX_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
      const p = parseBingx(r.out);
      const ok = r.code === 0 && p.okCount !== null && p.okCount === p.total;
      state.bingxApi = { lastRunDateKey: today, at: now.toISOString(), ok, executorHash: hash, verifiedAt: ok ? now.toISOString() : (b && b.verifiedAt) || null, okCount: p.okCount, total: p.total, failedNames: p.failedNames, aborted: p.aborted, exitCode: r.code, tail: r.out.split('\n').slice(-8).join('\n') };
      changed = true;
      console.log(`[SelfCheck] BingX endpoint: ${ok ? 'TERVERIFIKASI' : p.aborted ? 'DITUNDA (akun demo gak kosong)' : 'GAGAL'} ${p.okCount !== null ? `${p.okCount}/${p.total}` : ''}${p.failedNames ? ' -- ' + p.failedNames : ''}${ok ? '' : '\n' + r.out.split('\n').slice(-8).join('\n')}`);
      if (p.aborted && !ok) state.bingxApi.lastRunDateKey = null; // ditunda, bukan gagal -- boleh coba lagi siklus berikutnya
    }
  }

  if (changed) saveState(state);
  else console.log('[SelfCheck] Gak ada yang perlu dijalankan siklus ini.');
}

// Baris laporan buat mandor (dailyAutomationChecklist.js) -- murni baca state, gak jalanin apapun.
function reportLines(now = new Date()) {
  const today = localDateKey(now);
  const s = loadState();
  const lines = [];
  let ok = true;
  const r = s.regression;
  if (!r || r.dateKey !== today) lines.push(`⏳ Regression test belum jalan hari ini (otomatis setelah 0${REGRESSION_EARLIEST_HOUR}:00 WITA)${r ? `; terakhir ${r.dateKey}: ${r.summary}` : ''}.`);
  else if (r.ok) lines.push(`✅ Regression test hari ini: ${r.summary} (${r.durationSec}s, salinan bersih repo).`);
  else { ok = false; lines.push(`⚠️ Regression test hari ini GAGAL: ${r.summary} -- cek local-executor.log (SelfCheck).`); }
  const b = s.bingxApi;
  if (b && b.ok) lines.push(`✅ Endpoint order BingX terverifikasi di demo (${String(b.verifiedAt || '').slice(0, 10)}, ${b.okCount}/${b.total}).`);
  else if (b && !b.ok && !b.aborted) { ok = false; lines.push(`⚠️ Verifikasi endpoint BingX GAGAL: ${b.failedNames || 'lihat log'} -- JANGAN nyalain Ninja MR real sebelum ini beres.`); }
  else lines.push('⏳ Verifikasi endpoint BingX belum jalan (nunggu akun demo kosong / Ninja MR gak pegang posisi).');
  return { ok, lines };
}

if (require.main === module) { try { main(); } catch (e) { console.error('[SelfCheck] ERROR:', e.message); process.exit(1); } }

module.exports = { reportLines, parseRegression, parseBingx, executorHash, loadState };
