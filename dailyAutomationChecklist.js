// dailyAutomationChecklist.js -- (8 Sep 2026, permintaan Olan setelah insiden berita dobel-kirim:
// "kasih checker nya apa sudah dikirim otomatisasinya... kayak ada AI yang ngechecklist kerjaan
// otomatisasi hari ini").
//
// Latar: pas nyari akar masalah dobel-kirim, ketauan celah LEBIH BESAR -- 3 tugas harian (Sniper
// Analisa Harian, Bloomberg Mini/laporan harian, Anomaly Scanner) TERNYATA cuma jalan di GitHub
// Actions doang, TANPA cadangan Vultr sama sekali (beda dari berita/harga/whale yang udah dicover
// duluan). Kalau GH Actions telat/skip hari itu (KEBUKTI sering kejadian, lihat auditGithubActions.js
// + reference-vultr-vps.md), tugas2 ini beneran gak jalan sama sekali -- gak ada yang "maksa" ulang.
//
// Generalisasi pola runDueNews.js (sekarang PENSIUN, digantiin file ini) ke SEMUA tugas "1x/hari,
// ada jam target": tiap dipanggil (siklus Vultr 15 menit) -- kalau jam WITA sekarang UDAH LEWAT
// target DAN belum kekirim hari ini, coba jalanin sekarang (maksa). Semua script target di bawah
// UDAH punya dedup internal sendiri (lastSentDate/hasEntryToday/riwayat per-tanggal) -- aman
// dipanggil berkali-kali, no-op murah kalau udah beres.
//
// PLUS laporan checklist ke WA 1x/hari (jam FIX, abis SEMUA target lewat) -- biar Olan bisa LIHAT
// LANGSUNG "udah semua beres apa belum" tanpa nebak-nebak atau nunggu lapor manual.
//
// Jam target di bawah SENGAJA disalin manual dari cron masing-masing .github/workflows/*.yml
// (bukan diparse otomatis kayak auditGithubActions.js) -- maknanya beda: "jam WITA SEHARUSNYA
// udah kelar" buat nentuin kapan boleh mulai maksa, bukan "jadwal cron UTC buat GitHub".
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { toLocal, localDateKey } = require('./config');
const { hasEntryToday, addOrReplaceDaily } = require('./archive');
const { sendWhatsApp } = require('./fonnte');
const { birthdayRanToday } = require('./birthdayGreeting');

function runNode(args) {
  execFileSync('node', args, { cwd: __dirname, stdio: 'inherit' });
}

function readJsonSafe(file) {
  const p = path.join(__dirname, file);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// anomalyScanner.js nulis histori PER-INDIKATOR (bukan 1 tanggal tunggal) -- cukup cek salah SATU
// key udah ke-update hari ini (semuanya di-update bareng dalam 1 run yang sama).
function anomalyScannerRanToday(now) {
  const state = readJsonSafe('anomaly-history.json');
  if (!state || !state.history) return false;
  const todayKey = localDateKey(now);
  return Object.values(state.history).some(
    (arr) => Array.isArray(arr) && arr.length && localDateKey(new Date(arr[arr.length - 1].date)) === todayKey
  );
}

// monitor.js nulis lastChecked TIAP kali jalan (gak peduli hasil) -- penanda paling murah buat
// "laporan pribadi udah dihitung ulang hari ini".
function dailyReportPersonalRanToday(now) {
  const state = readJsonSafe('state.json');
  if (!state || !state.lastChecked) return false;
  return localDateKey(new Date(state.lastChecked)) === localDateKey(now);
}

// groupMonitor.js nulis analyst-dashboard.json.updatedAt TIAP kali jalan (independen dari WA
// terkirim apa nggak -- WA-nya sendiri kondisional per-jenis/mingguan). SENGAJA dicek TERPISAH
// dari monitor.js di atas (bukan digabung 1 task) -- kalau monitor.js sukses tapi groupMonitor.js
// throw di tengah, gabungan 1-task bakal salah nganggep "kelar" (monitor.js udah nyimpen tandanya)
// padahal groupMonitor.js belum, dan gak akan PERNAH dipaksa ulang lagi hari itu.
function dailyReportGrupRanToday(now) {
  const dashboard = readJsonSafe('analyst-dashboard.json');
  if (!dashboard || !dashboard.updatedAt) return false;
  return localDateKey(new Date(dashboard.updatedAt)) === localDateKey(now);
}

function sniperDailyRanToday(now) {
  const state = readJsonSafe('sniper-trigger-state.json');
  if (!state || !state.lastSentDate) return false;
  return state.lastSentDate === localDateKey(now);
}

const TASKS = [
  {
    key: 'news-pagi', label: 'Berita Pagi', targetHour: 9, targetMinute: 7,
    isDoneToday: (now) => hasEntryToday('news-pagi', now),
    run: () => runNode(['newsMonitor.js', 'pagi']),
  },
  {
    key: 'news-siang', label: 'Berita Siang', targetHour: 13, targetMinute: 13,
    isDoneToday: (now) => hasEntryToday('news-siang', now),
    run: () => runNode(['newsMonitor.js', 'siang']),
  },
  {
    key: 'news-sore', label: 'Berita Sore', targetHour: 18, targetMinute: 19,
    isDoneToday: (now) => hasEntryToday('news-sore', now),
    run: () => runNode(['newsMonitor.js', 'sore']),
  },
  {
    key: 'anomaly-scanner', label: 'Anomaly Scanner', targetHour: 6, targetMinute: 31,
    isDoneToday: anomalyScannerRanToday,
    run: () => runNode(['anomalyScanner.js']),
  },
  {
    key: 'daily-report-personal', label: 'Bloomberg Mini (laporan pribadi Olan)', targetHour: 7, targetMinute: 3,
    isDoneToday: dailyReportPersonalRanToday,
    run: () => runNode(['monitor.js']),
  },
  {
    key: 'daily-report-grup', label: 'Bloomberg Mini (laporan grup WA)', targetHour: 7, targetMinute: 3,
    isDoneToday: dailyReportGrupRanToday,
    run: () => runNode(['groupMonitor.js']),
  },
  {
    key: 'sniper-daily', label: 'Sniper Analisa Harian', targetHour: 8, targetMinute: 5,
    isDoneToday: sniperDailyRanToday,
    run: () => runNode(['sniperAutoAnalysis.js']),
  },
  {
    // Ucapan Ulang Tahun (8 Sep 2026, permintaan Olan) -- target jam 08:00 WITA, ke Wibowo
    // Hedgefund. birthdayRanToday balikin TRUE tiap hari yang emang gak ada yang ulang tahun,
    // jadi task ini "beres" hampir tiap hari kecuali tanggal-tanggal tertentu.
    key: 'birthday-greeting', label: 'Ucapan Ulang Tahun', targetHour: 8, targetMinute: 0,
    isDoneToday: birthdayRanToday,
    run: () => runNode(['birthdayGreeting.js']),
  },
  {
    // Whale Digest UDAH dipanggil UNCONDITIONAL tiap siklus di run-vultr-executor.sh sendiri
    // (dedup hasEntryToday internal DIA SENDIRI) -- di sini CUMA numpang buat ikut LAPORAN
    // checklist, gak perlu "run" karena udah pasti ke-trigger di tempat lain di siklus yang sama.
    key: 'whale-digest', label: 'Whale Daily Digest', targetHour: 7, targetMinute: 20,
    isDoneToday: (now) => hasEntryToday('whale-daily', now),
    run: null,
  },
];

const CHECKLIST_REPORT_HOUR = 20; // 20:00 WITA -- abis SEMUA target di atas kelewat (paling telat 18:19)
const CHECKLIST_REPORT_TYPE = 'daily-checklist-report';

function minutesSinceMidnight(now) {
  const local = toLocal(now);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

async function sendChecklistReport(now) {
  const lines = TASKS.map((t) => `${t.isDoneToday(now) ? '✅' : '❌ BELUM'} ${t.label}`);
  const anyMissing = TASKS.some((t) => !t.isDoneToday(now));
  const msg = [
    `📋 Kaela Checklist Otomatisasi — ${localDateKey(now)}`,
    '',
    ...lines,
    '',
    anyMissing
      ? '⚠️ Ada yang belum kekirim walau udah dipaksa jalan -- cek log Vultr, kemungkinan datanya emang kosong/skip wajar hari ini (bukan otomatis berarti bug).'
      : 'Semua tugas harian beres. 🎉',
  ].join('\n');
  console.log(msg);
  addOrReplaceDaily(CHECKLIST_REPORT_TYPE, msg, now);
  await sendWhatsApp(msg);
}

async function main() {
  const now = new Date();
  const nowMinutes = minutesSinceMidnight(now);

  // "Istirahat" (8 Sep 2026, permintaan Olan: "ceker istirahat cek jika hari ini = otomatisasi
  // sudah dikirim semua") -- kalau SEMUA tugas udah beres hari ini, gak perlu masuk loop paksa
  // sama sekali lagi cycle ini. Cuma pengecekan status doang (baca file, murah/aman), TIDAK
  // ngurangin cadangan keamanan apapun -- besok (localDateKey ganti) otomatis aktif lagi sendiri.
  const allDoneToday = TASKS.every((t) => t.isDoneToday(now));
  if (allDoneToday) {
    console.log(`[DailyAutomationChecklist] Semua ${TASKS.length} tugas harian udah kekirim hari ini -- istirahat, gak ada yang perlu dipaksa.`);
  } else {
    for (const task of TASKS) {
      if (!task.run) continue; // laporan doang, gak ada aksi buat maksa
      const targetMinutes = task.targetHour * 60 + task.targetMinute;
      if (nowMinutes < targetMinutes) continue;
      if (task.isDoneToday(now)) continue; // udah kekirim -- CUEK, gak disentuh (anti-double: dedup FINAL tetap di script tujuan sendiri, ini cuma gerbang pertama)
      console.log(`[DailyAutomationChecklist] "${task.label}" belum kekirim padahal udah lewat jam target -- MAKSA jalan sekarang.`);
      try {
        task.run();
        if (task.isDoneToday(now)) {
          console.log(`[DailyAutomationChecklist] "${task.label}" berhasil dipaksa jalan.`);
        } else {
          // Bukan otomatis berarti error -- bisa jadi SENGAJA skip (mis. gak ada berita unik hari
          // ini, dst). Kata "GAGAL"/"ERROR" SENGAJA gak dipake di baris ini biar gak false-alarm.
          console.log(`[DailyAutomationChecklist] "${task.label}" udah dipaksa jalan, tapi belum tercatat "selesai" -- cek log di atas, mungkin emang skip wajar.`);
        }
      } catch (e) {
        console.log(`[DailyAutomationChecklist] GAGAL maksa jalanin "${task.label}": ${e.message}`);
      }
    }
  }

  if (nowMinutes >= CHECKLIST_REPORT_HOUR * 60 && !hasEntryToday(CHECKLIST_REPORT_TYPE, now)) {
    await sendChecklistReport(now);
  }
}

// require.main guard (8 Sep 2026, ditambahin abis KEJADIAN NYATA -- lihat feedback-no-local-live-
// script-test.md) -- `require('./dailyAutomationChecklist')` polos (misal buat re-use isDoneToday
// dari script lain) TANPA guard ini bakal ikut ngirim WA/eksekusi trading beneran sebagai efek
// samping. Cuma jalan otomatis kalau file ini DIPANGGIL LANGSUNG (`node dailyAutomationChecklist.js`).
if (require.main === module) {
  main().catch((e) => console.log(`[DailyAutomationChecklist] GAGAL jalan siklus ini: ${e.message}`));
}
