// teamDigestReport.js -- "Tim Kaela" role digest (13 Sep 2026, permintaan Olan: "sekarang team
// kaela di aktifkan.. usahakan tiap role berperan.. nanti kasih info ke grup Hedge"). Konsep:
// commit yang Kaela buat ditandai role NEXUS-FORGE paling cocok (`[ROLE] <subject>` di awal pesan
// commit -- lihat SYSTEM-MAP.md buat konvensi lengkap), digest INI rangkum jadi 1 laporan
// MINGGUAN (BUKAN tiap commit -- disepakati eksplisit sama Olan lewat AskUserQuestion, biar gak
// keliatan spam ke grup investor) ke Wibowo Hedgefund. Cadence Senin WITA -- SAMA pola kayak
// "Bloomberg Mini" (groupMonitor.js `willSendWeekly`): dipanggil TIAP siklus 15-menit, no-op
// diam2 kalau bukan Senin atau udah kekirim minggu ini.
//
// ⛔ KEJUJURAN WAJIB (disepakati eksplisit sama Olan, bukan opsional): "tim" ini BUKAN tim manusia
// terpisah -- role2 ini spesialisasi/mode-kerja Kaela sendiri (AI). Disclaimer ini WAJIB ada di
// SETIAP digest (bukan cuma sekali di awal), biar investor baru yang gabung belakangan juga gak
// salah paham ada tim manusia beneran di belakang Kaela.
//
// Kalau minggu ini NOL commit bertanda role -- SKIP kirim total (anti-spam, sama prinsip kayak
// mandor lain di proyek ini) -- gak ada gunanya laporan "gak ada apa-apa" ke grup investor.

const { execFileSync } = require('child_process');
const { toLocal } = require('./config');
const { hasEntryToday, addOrReplaceDaily, getLatest } = require('./archive');
const { sendWhatsApp } = require('./fonnte');
const { WIBOWO_GROUP_ID } = require('./wibowoNotify');

const DIGEST_TYPE = 'team-digest-weekly';

// Roster NEXUS-FORGE yang relevan buat commit KODE (SEIRA dikecualikan -- brainstorm eksternal
// ChatGPT, gak pernah commit; KAELA dikecualikan -- command center, commit TANPA tag role
// dianggap kerjaan umum Kaela sendiri, bukan salah satu spesialis, jadi sengaja gak dihitung).
const ROLE_INFO = {
  CIPHER: { emoji: '📋', label: 'Business Analyst' },
  LYRA: { emoji: '🎨', label: 'UX/Design' },
  RAVEN: { emoji: '🐦', label: 'Backend/Data Pipeline' },
  ZANE: { emoji: '⚡', label: 'Frontend/Tampilan' },
  MARCUS: { emoji: '🛡️', label: 'Security Review' },
  DRAKE: { emoji: '🐉', label: 'Debug Specialist' },
  VECTOR: { emoji: '🔎', label: 'QA Tester' },
  PRISM: { emoji: '🔬', label: 'Data QA' },
  NOVA: { emoji: '🌟', label: 'Dokumentasi' },
  REED: { emoji: '📦', label: 'Archive' },
};

function getCommitSubjectsSince(sinceIso) {
  try {
    const out = execFileSync('git', ['log', `--since=${sinceIso}`, '--pretty=format:%s'], { cwd: __dirname, encoding: 'utf8' });
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (e) {
    console.log('[TeamDigest] Gagal baca git log (dilewatin):', e.message);
    return [];
  }
}

function groupByRole(subjects) {
  const byRole = {};
  for (const subject of subjects) {
    const m = subject.match(/^\[([A-Z]+)\]\s*(.+)/);
    if (m && ROLE_INFO[m[1]]) {
      (byRole[m[1]] = byRole[m[1]] || []).push(m[2]);
    }
  }
  return byRole;
}

function formatDigest(byRole) {
  const lines = ['🛠️ *Update Tim Kaela Minggu Ini*', ''];
  for (const role of Object.keys(byRole)) {
    const info = ROLE_INFO[role];
    const items = byRole[role];
    lines.push(`${info.emoji} *${role}* (${info.label}) — ${items.length} update:`);
    for (const item of items.slice(0, 5)) lines.push(`   • ${item}`);
    if (items.length > 5) lines.push(`   • ...+${items.length - 5} lagi`);
    lines.push('');
  }
  lines.push('ℹ️ "Tim" ini BUKAN tim manusia terpisah — semua peran di atas itu spesialisasi/mode kerja Kaela sendiri (AI), dipakai biar progress lebih gampang dilacak & dilaporkan rapi.');
  lines.push('');
  lines.push('— Kaela');
  return lines.join('\n');
}

async function main(now = new Date()) {
  const local = toLocal(now);
  if (local.getUTCDay() !== 1) { console.log('[TeamDigest] Bukan Senin, skip.'); return; }
  if (hasEntryToday(DIGEST_TYPE, now)) { console.log('[TeamDigest] Udah kekirim minggu ini, skip.'); return; }

  const lastDigest = getLatest(DIGEST_TYPE);
  const sinceIso = lastDigest ? lastDigest.date : new Date(now.getTime() - 7 * 24 * 3600000).toISOString();

  const subjects = getCommitSubjectsSince(sinceIso);
  const byRole = groupByRole(subjects);

  if (Object.keys(byRole).length === 0) {
    console.log('[TeamDigest] Gak ada commit bertanda role minggu ini, skip kirim (anti-spam).');
    return;
  }

  const msg = formatDigest(byRole);
  console.log(msg);
  addOrReplaceDaily(DIGEST_TYPE, msg, now);
  await sendWhatsApp(msg, WIBOWO_GROUP_ID).catch((e) => console.log('[TeamDigest] Gagal kirim:', e.message));
}

module.exports = { main, groupByRole, formatDigest };

if (require.main === module) {
  main().catch((e) => { console.error('ERROR teamDigestReport.js:', e.message); process.exit(1); });
}
