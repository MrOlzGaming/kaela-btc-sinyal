// Arsip permanen semua Report & News yang pernah dibuat Kaela.
// Live nanti ini pindah ke database beneran (lihat ARCHITECTURE.md bagian broadcast_log),
// tapi buat sekarang dipakai file JSON biar gampang diuji & dilihat isinya.

const fs = require('fs');
const path = require('path');

const ARCHIVE_PATH = path.join(__dirname, 'archive.json');

function loadArchive() {
  if (!fs.existsSync(ARCHIVE_PATH)) return [];
  return JSON.parse(fs.readFileSync(ARCHIVE_PATH, 'utf8'));
}

function saveArchive(entries) {
  fs.writeFileSync(ARCHIVE_PATH, JSON.stringify(entries, null, 2));
}

// type: 'report-daily' | 'report-weekly' | 'report-monthly' | 'report-yearly' | 'news'
function addEntry(type, content, date = new Date()) {
  const entries = loadArchive();
  entries.push({ type, date: date.toISOString(), content });
  saveArchive(entries);
  return entries[entries.length - 1];
}

function getLatest(type = null) {
  const entries = loadArchive();
  const filtered = type ? entries.filter((e) => e.type === type) : entries;
  return filtered.length ? filtered[filtered.length - 1] : null;
}

function getAll(type = null) {
  const entries = loadArchive();
  const filtered = type ? entries.filter((e) => e.type === type) : entries;
  return [...filtered].reverse(); // terbaru duluan
}

module.exports = { addEntry, getLatest, getAll };
