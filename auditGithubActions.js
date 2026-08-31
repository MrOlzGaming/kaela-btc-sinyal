// Audit otomatis jadwal GitHub Actions (31 Agu 2026, permintaan Olan: "harus ada Kaela yang
// otomatis audit jalur yang sering ngadat ini"). Latar: news-siang.yml kebukti pernah telat 5+
// jam / skip total gara-gara antrian cron akun ini padat (banyak workflow frekuensi tinggi kayak
// price-alert tiap 5 menit) -- BUKAN bug cron/timezone kita sendiri, tapi tetap butuh deteksi dini
// biar gak nunggu Olan sendiri yang nyadar/lapor.
//
// Numpang di siklus eksekutor lokal/VPS yang tiap 15 menit (run-local-executor.ps1 /
// run-vultr-executor.sh) -- itu JAUH lebih reliable daripada GitHub Actions sendiri (ironis tapi
// kebukti dari investigasi 31 Agu 2026), jadi cocok jadi "pengawas dari luar".
//
// Zero-hardcode: baca cron LANGSUNG dari file .yml di .github/workflows (satu sumber kebenaran,
// bukan didaftar ulang manual di sini -- kalau ada yang nambah/ubah jadwal di YAML, audit ini
// otomatis ikut tanpa disentuh). Cuma workflow yang punya trigger `schedule:` yang diaudit --
// yang manual-only (workflow_dispatch aja) otomatis kelewat.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OWNER = 'MrOlzGaming';
const REPO = 'kaela-btc-sinyal';
const WORKFLOWS_DIR = path.join(__dirname, '.github', 'workflows');

// Token yang SAMA persis kayak yang dipakai git push (nempel di URL remote origin-new) --
// SENGAJA gak diduplikasi ke secrets.js/file baru (secrets.js GITHUB_TOKEN ketauan 31 Agu 2026
// beda/basi, 401 pas dites -- daripada nyimpen kredensial ganda yang gampang divergen, baca
// langsung dari git tiap kali jalan).
function getToken() {
  const url = execFileSync('git', ['remote', 'get-url', 'origin-new'], { cwd: __dirname, encoding: 'utf8' }).trim();
  const m = url.match(/^https:\/\/([^@]+)@/);
  return m ? m[1] : null;
}

// Cuma dukung pola cron SEDERHANA yang beneran dipakai di repo ini (semua "N menit"/"N jam"/
// "harian jam H:M"). Pola lain (gak kekenal) balikin null -- workflow itu di-skip, BUKAN dianggap
// error (aman-default, daripada false alarm gara-gara parser kurang lengkap).
function cronIntervalMinutes(cron) {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;
  if (dom !== '*' || mon !== '*' || dow !== '*') return null;
  if (hour === '*') {
    const m = min.match(/^\*\/(\d+)$/);
    if (m) return parseInt(m[1], 10);
    if (/^\d+$/.test(min)) return 60;
    return null;
  }
  const hm = hour.match(/^\*\/(\d+)$/);
  if (hm && /^\d+$/.test(min)) return parseInt(hm[1], 10) * 60;
  if (/^\d+$/.test(hour) && /^\d+$/.test(min)) return 1440;
  return null;
}

function readScheduledWorkflows() {
  const out = [];
  for (const file of fs.readdirSync(WORKFLOWS_DIR)) {
    if (!file.endsWith('.yml')) continue;
    const text = fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8');
    const cronMatch = text.match(/cron:\s*'([^']+)'/);
    if (!cronMatch) continue; // gak ada trigger schedule -- manual-only, skip
    const interval = cronIntervalMinutes(cronMatch[1]);
    if (interval === null) continue; // pola gak dikenal, skip aman
    const nameMatch = text.match(/^name:\s*(.+)$/m);
    out.push({ file, name: nameMatch ? nameMatch[1].trim() : file, intervalMinutes: interval });
  }
  return out;
}

async function ghApi(token, endpoint) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'kaela-audit', Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const token = getToken();
  if (!token) {
    console.log('[AuditGithubActions] Gak nemu token dari git remote, audit dilewatin siklus ini.');
    return;
  }

  const scheduled = readScheduledWorkflows();
  const workflowList = await ghApi(token, `/repos/${OWNER}/${REPO}/actions/workflows?per_page=100`);
  const byPath = new Map(workflowList.workflows.map((w) => [w.path.split('/').pop(), w]));

  const stale = [];
  const now = Date.now();
  for (const wf of scheduled) {
    const apiWf = byPath.get(wf.file);
    if (!apiWf) continue; // belum ke-push/gak ketemu di API, skip aman
    // SENGAJA gak filter event=schedule -- ketemu 31 Agu 2026: dark-kaela-monitor.yml (dan pola
    // serupa lain) desainnya self-relaunch lewat workflow_dispatch di akhir loop (`schedule:`
    // di situ CUMA jaring pengaman jarang, bukan cadence asli, lihat komentar di file itu) --
    // kalau cuma cek event=schedule, workflow yang justru SEHAT (rantai self-dispatch jalan
    // terus) malah kena false alarm "gak jalan berjam-jam". Run APAPUN (schedule/dispatch/manual)
    // sama validnya sebagai bukti "masih hidup".
    let runs;
    try {
      runs = await ghApi(token, `/repos/${OWNER}/${REPO}/actions/workflows/${apiWf.id}/runs?per_page=1`);
    } catch (e) {
      continue; // 1 workflow gagal dicek gak boleh gugurin yang lain
    }
    const lastRun = runs.workflow_runs && runs.workflow_runs[0];
    if (!lastRun) continue; // belum pernah kejadwal jalan sama sekali (workflow baru), skip
    const elapsedMinutes = (now - new Date(lastRun.created_at).getTime()) / 60000;
    const grace = Math.min(wf.intervalMinutes, 180); // maksimal toleransi 3 jam biarpun jadwalnya harian
    const threshold = wf.intervalMinutes + grace;
    if (elapsedMinutes > threshold) {
      stale.push({ name: wf.name, file: wf.file, elapsedMinutes: Math.round(elapsedMinutes), intervalMinutes: wf.intervalMinutes });
    }
  }

  if (stale.length === 0) {
    console.log(`[AuditGithubActions] ${scheduled.length} workflow terjadwal dicek, semua on-time.`);
    return;
  }
  for (const s of stale) {
    const jam = (s.elapsedMinutes / 60).toFixed(1);
    // Kata "GAGAL" SENGAJA dipakai (bukan sinonim) -- ini yang di-scan run-*-executor buat lapor
    // WA Olan lewat reportCycleErrors.js (lihat komentar di reportCycleErrors.js soal kata kunci).
    console.log(`[AuditGithubActions] GAGAL: "${s.name}" (${s.file}) belum jalan ${jam} jam -- jadwal harusnya tiap ${s.intervalMinutes} menit. Kemungkinan telat/skip di antrian GitHub Actions.`);
  }
}

main().catch((e) => console.log(`[AuditGithubActions] Audit gagal dijalankan (bukan berarti workflow-nya bermasalah): ${e.message}`));
