// checkExecutorStuck.js -- "pengawas" macet (14 Sep 2026, Olan: "jangan sampe kejadian macet
// lagi.. perlu pengawas juga?"). Insiden nyata hari ini: run-vultr-executor.sh macet TOTAL 6+ jam
// (19:32-01:41 WITA) gara2 salah satu node script di dalamnya hang tanpa batas waktu (lihat fix
// timeout di run-vultr-executor.sh sendiri) -- ketauan BUKAN dari sistem, tapi Olan sendiri lapor
// "PnL Harian 0%" di web (gejala, bukan akar masalah). dailyAutomationChecklist.js (mandor yang
// UDAH ADA) TETEP GAK NANGKEP ini -- itu ngecek "tugas 1x/hari udah kekirim belum", BUKAN "siklus
// 15-menit beneran jalan tiap 15 menit" -- 2 KELAS masalah beda, butuh pengawas TERPISAH.
//
// Cara kerja: bandingin `cron-heartbeat.log` (bukti CRON NEMBAK, ditulis run-vultr-executor.sh
// SEBELUM nyoba flock -- lihat komentar HEARTBEAT_FILE di situ) vs `local-executor.log` (bukti
// RUN BENERAN MULAI, cuma ketulis SETELAH flock berhasil kepegang). Kalau ada >=3 siklus 15-menit
// berturut-turut (~45 menit) heartbeat nembak TAPI nol "Run mulai" yang cocok -- itu tanda lock
// nyangkut, kayak insiden hari ini.
//
// ⛔ SENGAJA dipanggil dari `run-manual-open-check-vultr.sh` (jadwal 1 menit, TANPA flock/git
// sync sama sekali) -- BUKAN numpang run-vultr-executor.sh yang 15-menit. Ini KRUSIAL: kalau
// pengawas ini numpang lock yang SAMA kayak yang mau diawasin, pas beneran macet si pengawas
// IKUT KETAHAN gak bisa lapor -- persis skenario yang mau dicegah.

const fs = require('fs');
const path = require('path');
const { sendWhatsApp } = require('./fonnte');
const { roleOpener } = require('./teamRoles');
const { WIBOWO_GROUP_ID } = require('./wibowoNotify');

const HEARTBEAT_FILE = path.join(__dirname, 'cron-heartbeat.log');
const EXEC_LOG_FILE = path.join(__dirname, 'local-executor.log');
const STATE_FILE = path.join(__dirname, 'executor-stuck-state.json');

const STUCK_THRESHOLD_CYCLES = 3; // 3x siklus 15-menit berturut-turut skip (~45 menit) baru dianggap "macet", bukan cuma 1 siklus lambat wajar
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // max 1x lapor/jam walau tetap macet -- anti-spam, bukan nunggu pulih baru boleh lapor lagi

// Format "[yyyy-MM-dd HH:mm:ss] ..." (SAMA persis kayak bash `date '+%Y-%m-%d %H:%M:%S'`) --
// SENGAJA TANPA konversi 'T'/offset -- string ini diparse `new Date()` sbg WAKTU LOKAL mesin yang
// jalanin Node ini, PERSIS sama mesin yang nulis log-nya (satu server) -- gak butuh tau timezone
// eksplisit, otomatis konsisten karena baca+tulis di mesin yang sama.
function parseTimestamp(line) {
  const m = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
  return m ? new Date(m[1]).getTime() : null;
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { lastAlertAt: 0 };
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { lastAlertAt: 0 }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

// Logic murni (14 Sep 2026, testability -- lihat regressionTests.js) DIPISAH dari I/O file biar
// bisa ditest langsung pakai data fixture, gak perlu bikin file asli tiap test. `heartbeatTimes`
// = array timestamp (ms) urut naik, `execLines` = baris mentah local-executor.log.
// Balikin `{ stuck: bool, windowStart: number|null }` -- windowStart null kalau histori kurang.
function detectStuck(heartbeatTimes, execLines) {
  if (heartbeatTimes.length < STUCK_THRESHOLD_CYCLES) return { stuck: false, windowStart: null };
  const recentHeartbeats = heartbeatTimes.slice(-STUCK_THRESHOLD_CYCLES);
  const windowStart = recentHeartbeats[0];
  const hadRunMulai = execLines.some((line) => {
    if (!line.includes('Run mulai')) return false;
    const t = parseTimestamp(line);
    return t !== null && t >= windowStart;
  });
  return { stuck: !hadRunMulai, windowStart };
}

async function main() {
  if (!fs.existsSync(HEARTBEAT_FILE)) { console.log('[CheckExecutorStuck] cron-heartbeat.log belum ada, skip (server baru/belum sempat cron sekali pun).'); return; }
  // Baca file UTUH -- cukup ringan buat sekarang (heartbeat.log sendiri udah di-trim 500 baris
  // terakhir sama run-vultr-executor.sh). local-executor.log BELUM ada trimming serupa -- kalau
  // suatu saat kerasa berat (baca tiap menit selamanya), pertimbangkan tail-read proper drpd baca
  // penuh tiap kali.
  const heartbeatLines = fs.readFileSync(HEARTBEAT_FILE, 'utf8').trim().split('\n').filter(Boolean);
  const heartbeatTimes = heartbeatLines.map(parseTimestamp).filter((t) => t !== null);
  const execLines = fs.existsSync(EXEC_LOG_FILE) ? fs.readFileSync(EXEC_LOG_FILE, 'utf8').trim().split('\n') : [];

  const { stuck, windowStart } = detectStuck(heartbeatTimes, execLines);
  if (!stuck) {
    console.log(windowStart === null
      ? '[CheckExecutorStuck] Histori heartbeat masih kurang dari ambang, skip (wajar di awal).'
      : `[CheckExecutorStuck] Sehat -- ada "Run mulai" dalam ${STUCK_THRESHOLD_CYCLES} siklus terakhir.`);
    return;
  }

  const state = loadState();
  const now = Date.now();
  if (now - state.lastAlertAt < ALERT_COOLDOWN_MS) {
    console.log('[CheckExecutorStuck] Macet TERDETEKSI, tapi masih dalam cooldown alert (udah pernah dilaporin <1 jam lalu).');
    return;
  }

  const stuckMinutes = Math.round((now - windowStart) / 60000);
  const msg = `${roleOpener('DRAKE', 'eksekutor VPS kedetek macet')}\n\n`
    + `Udah ${STUCK_THRESHOLD_CYCLES} siklus 15-menit berturut-turut (~${stuckMinutes} menit) cron NEMBAK, tapi lock gak pernah kebuka -- kemungkinan besar ada script yang hang di dalamnya.\n\n`
    + `Cek: SSH ke VPS, "tail -30 ~/kaela-engine/local-executor.log" buat lihat baris terakhir yang beneran jalan, dan "ps aux | grep node" buat cari proses yang nyangkut.\n\n`
    + `🔗 Ini laporan otomatis, BUKAN nunggu checklist 20:00 WITA -- lapor cepat begitu ketauan.\n\n`
    + `— Kaela`;
  console.log(msg);
  // 🐛 FIX 19 Sep 2026 -- `try/catch` di sini CUMA nangkep exception JS asli, PADAHAL kegagalan
  // Fonnte (yang paling sering kejadian -- token invalid/API down) gak pernah `throw`, cuma
  // balikin `{ok:false}` (lihat fonnte.js). Akibatnya `state.lastAlertAt`/`saveState` TETAP jalan
  // walau WA gagal diam-diam -- alert "macet" dianggap terkirim (cooldown 1 jam aktif), padahal
  // Olan belum terima apa-apa PERSIS pas sistem lagi bermasalah (waktu paling butuh alert-nya).
  // Fix: cek hasil eksplisit, cuma update state kalau beneran sukses (atau skipped -- gak ada
  // secrets.js, situasi normal, bukan kegagalan kirim).
  //
  // 21 Sep 2026 (permintaan Olan: "jangan pesan pribadi.. ke grup hedgefund wibowo aja, kalo DM
  // takut ga kebaca") -- pindah dari DM MASTER_NOMOR ke grup Wibowo Hedgefund. LANGSUNG
  // sendWhatsApp+WIBOWO_GROUP_ID (BUKAN sendWhatsAppToWibowo/wibowoNotify.js) -- pola SAMA kayak
  // exchangeWalletTracker.js: ini laporan infra/debug, BUKAN update posisi trading, jadi TETAP
  // harus nyampe walau toggle "Silent Trade" lagi OFF (itu gate KHUSUS visibilitas trade, gak
  // relevan buat "sistem lagi macet").
  try {
    const sendResult = await sendWhatsApp(msg, WIBOWO_GROUP_ID);
    if (sendResult && sendResult.ok === false) {
      console.log('[CheckExecutorStuck] Kirim WA GAGAL (Fonnte nolak/API down) -- state alert TIDAK diupdate, biar dicoba lagi menit depan.');
    } else {
      state.lastAlertAt = now;
      saveState(state);
    }
  } catch (e) {
    console.log('[CheckExecutorStuck] Gagal kirim WA (dicoba lagi menit depan):', e.message);
  }
}

module.exports = { main, parseTimestamp, detectStuck };

if (require.main === module) {
  main().catch((e) => { console.error('ERROR checkExecutorStuck.js:', e.message); process.exit(1); });
}
