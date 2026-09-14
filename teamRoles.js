// "Tim Kaela" -- badge role NEXUS-FORGE di pesan WA (lihat SYSTEM-MAP.md "Tim Kaela" buat tabel
// domain lengkap + histori kenapa konsep ini ada). SATU sumber kebenaran emoji+nama+domain --
// JANGAN hardcode ulang di file lain, pola yang SAMA PERSIS bikin bug harus difix N-kali kalau
// beda (lihat feedback-nyopet-buyonly.md soal tradeHistoryStore/multiAccountExecutor dobel).
//
// 15 Sep 2026 (permintaan eksplisit Olan, "anggap ada" -- bukan sekadar nama tempelan): badge
// PINDAH dari TTD PENUTUP ("— Kaela\n   (laporan: Role · Domain)") ke OPENER narasi di paling
// ATAS pesan ("Role [Domain] lapor ke Kaela, <ringkasan>:") -- role-nya "lapor" ke Kaela duluan,
// baru Kaela yang nyampein isinya (masih Kaela SATU-SATUNYA pengirim WA, searah -- role ini
// spesialisasi/mode-kerja Kaela sendiri, BUKAN tim manusia terpisah, sama prinsip kejujuran yang
// udah dipegang di teamDigestReport.js). Penutup pesan sekarang CUKUP `'— Kaela'` polos (nama
// role udah disebut di opener, gak perlu diulang di bawah).
const ROLES = {
  DRAKE: { emoji: '🐉', name: 'Drake', domain: 'Debug Specialist' },
  PRISM: { emoji: '🔬', name: 'Prism', domain: 'Data QA' },
  REED: { emoji: '📦', name: 'Reed', domain: 'Archive' },
  RAVEN: { emoji: '🐦', name: 'Raven', domain: 'Backend/Infra' },
  MARCUS: { emoji: '🛡️', name: 'Marcus', domain: 'Security Specialist' },
  VECTOR: { emoji: '🧪', name: 'Vector', domain: 'QA Tester' },
  ZANE: { emoji: '🎨', name: 'Zane', domain: 'Frontend/Tampilan' },
  CIPHER: { emoji: '📋', name: 'Cipher', domain: 'Business Analyst' },
  LYRA: { emoji: '✏️', name: 'Lyra', domain: 'UX/Design' },
  NOVA: { emoji: '📚', name: 'Nova', domain: 'Dokumentasi' },
};

// `opening` = kalimat KONTEKSTUAL singkat (bukan generik "ada laporan") -- contoh pemakaian ada
// di tiap call site (checkExecutorStuck.js, pnlCrossCheckMonitor.js, dst). Return 1 baris siap
// ditaruh PALING ATAS pesan, isi pesan lanjut di baris/paragraf berikutnya.
function roleOpener(roleKey, opening) {
  const r = ROLES[roleKey];
  if (!r) throw new Error(`[teamRoles] Role gak dikenal: ${roleKey}`);
  return `${r.emoji} *${r.name} [${r.domain}]* lapor ke Kaela, ${opening}:`;
}

module.exports = { ROLES, roleOpener };
